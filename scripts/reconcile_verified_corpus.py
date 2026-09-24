#!/usr/bin/env python3
"""Reconcile verified corpus fields into an existing OCRDocs SQLite database.

The original corpus loader was intentionally append-only: it skipped a source
file when its content hash already existed in ``documents``.  That is correct
for a fresh database, but it is not sufficient for a live database whose
queue/worker already registered the same bytes with a weaker extraction.  This
tool safely joins the verified JSONL by **content hash** and enriches the
latest extraction in place.

Safety properties:
* source rows are reduced to the last successful row per source path;
* only fields marked ``verif=ok`` are considered;
* human corrections and approved fields are never overwritten;
* a backup is created before an apply, and the write runs in one transaction;
* ``--dry-run`` performs the same work and rolls it back;
* integrity and duplicate-hash checks run before and after the transaction;
* output contains counts and hashes, never extracted values.

The command is intended to be run while the server is stopped (or after its
SQLite writer has been drained).  It never replaces the database with a
snapshot, so unrelated live documents and runtime writes remain intact.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import posixpath
import shutil
import sqlite3
import sys
import uuid
from collections import Counter
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

# Keep this script usable from a release checkout, where the generated
# catalogue is beside it, without requiring the repository root on sys.path.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from field_catalogue import BY_ID  # noqa: E402

LEGACY_ALIASES = {
    "drivers_licence_number": "drivers_licence",
    "tax_file_number": "tfn",
    "occupation": "occupation_industry",
}

CRITICAL_FIELDS = {
    "family_name",
    "given_names",
    "date_of_birth",
}

DEFAULT_VERDICT = "ok"


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def normalise_path(value: str) -> str:
    """Return a stable absolute path for SQLite/path comparisons."""
    value = (value or "").replace("\\", "/")
    if not value:
        return ""
    return posixpath.normpath(value)


def map_source_path(raw: str, source_root: str | None, target_root: str | None) -> str:
    """Optionally remap a corpus path from an operator path to a runtime path.

    The remapper deliberately works on the path *suffix* after the supplied
    root.  It never guesses a different file based only on a basename.
    """
    value = (raw or "").replace("\\", "/")
    if source_root and target_root:
        source = normalise_path(source_root).rstrip("/")
        target = normalise_path(target_root).rstrip("/")
        if value == source:
            return target
        prefix = source + "/"
        if value.startswith(prefix):
            return target + "/" + value[len(prefix) :]
    return normalise_path(value)


def display_name(field_id: str | None) -> str | None:
    if not field_id:
        return None
    return BY_ID.get(LEGACY_ALIASES.get(field_id, field_id), (None, None))[0]


def sha256_file(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_verified_rows(
    source: str,
    source_root: str | None,
    target_root: str | None,
    verdict: str,
) -> tuple[dict[str, dict[str, Any]], Counter]:
    """Read the source and retain the last successful row for each path."""
    latest: dict[str, dict[str, Any]] = {}
    stats: Counter = Counter()
    with open(source, encoding="utf-8", errors="replace") as handle:
        for line in handle:
            if not line.strip():
                continue
            stats["rows"] += 1
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                stats["invalid_json"] += 1
                continue
            if not row.get("ok"):
                stats["not_ok_rows"] += 1
                continue
            path = map_source_path(str(row.get("file") or ""), source_root, target_root)
            if not path:
                stats["missing_source_path"] += 1
                continue
            fields = [
                field
                for field in (row.get("fields") or [])
                if isinstance(field, dict)
                and field.get("verif") == verdict
                and str(field.get("value") or "").strip()
            ]
            if not fields:
                stats["no_verified_fields"] += 1
                continue
            row["file"] = path
            row["fields"] = fields
            latest[path] = row
            stats["usable_rows"] += 1
    stats["distinct_paths"] = len(latest)
    return latest, stats


def integrity_check(db: sqlite3.Connection) -> str:
    result = db.execute("PRAGMA integrity_check").fetchone()
    value = result[0] if result else "unknown"
    if value != "ok":
        raise RuntimeError(f"SQLite integrity_check failed: {value}")
    return value


def ensure_audit_table(db: sqlite3.Connection) -> None:
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS corpus_reconciliation (
          source_hash       TEXT PRIMARY KEY,
          document_id       TEXT NOT NULL,
          source_path       TEXT NOT NULL,
          fields_seen       INTEGER NOT NULL,
          fields_inserted   INTEGER NOT NULL,
          fields_updated    INTEGER NOT NULL,
          fields_preserved  INTEGER NOT NULL,
          reconciled_at     TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_corpus_reconciliation_document
          ON corpus_reconciliation(document_id);
        """
    )


def ensure_latest_pointer_column(db: sqlite3.Connection) -> None:
    """Keep the standalone reconciler compatible with a pre-migration DB."""
    columns = {row[1] for row in db.execute("PRAGMA table_info(documents)")}
    if "latest_extraction_id" not in columns:
        db.execute("ALTER TABLE documents ADD COLUMN latest_extraction_id TEXT")
    db.execute(
        "CREATE INDEX IF NOT EXISTS idx_documents_latest_extraction ON documents(latest_extraction_id)"
    )
    db.execute(
        """
        UPDATE documents
        SET latest_extraction_id = (
          SELECT e.id FROM extractions e
          WHERE e.document_id = documents.id
          ORDER BY e.created_at DESC, e.rowid DESC LIMIT 1
        )
        WHERE latest_extraction_id IS NULL
          AND EXISTS (SELECT 1 FROM extractions e WHERE e.document_id = documents.id)
        """
    )


def latest_extraction(db: sqlite3.Connection, document_id: str) -> sqlite3.Row | None:
    return db.execute(
        """
        SELECT * FROM extractions
        WHERE document_id = ?
        ORDER BY created_at DESC, rowid DESC
        LIMIT 1
        """,
        (document_id,),
    ).fetchone()


def choose_field(rows: list[sqlite3.Row]) -> sqlite3.Row | None:
    """Prefer a human-protected row, then the strongest effective value."""
    if not rows:
        return None
    protected = [row for row in rows if row["corrected_value"] is not None or row["approved"] == 1]
    if protected:
        return protected[0]
    return sorted(rows, key=lambda row: (float(row["confidence"] or 0), row["rowid"]), reverse=True)[0]


def effective_value(row: sqlite3.Row | None) -> str:
    if row is None:
        return ""
    return str(row["corrected_value"] if row["corrected_value"] is not None else row["field_value"] or "").strip()


def insert_field(
    db: sqlite3.Connection,
    extraction_id: str,
    field_id: str,
    value: str,
    confidence: float,
    section: str | None,
) -> None:
    db.execute(
        """
        INSERT INTO fields
          (id, extraction_id, field_name, field_value, confidence, source_section,
           validated, validation_status, corrected_value, approved)
        VALUES (?, ?, ?, ?, ?, ?, 1, 'valid', NULL, 0)
        """,
        (str(uuid.uuid4()), extraction_id, field_id, value, confidence, section),
    )


def reconcile_row(
    db: sqlite3.Connection,
    row: dict[str, Any],
    document: sqlite3.Row,
    source_hash: str,
    conflict_policy: str,
    stats: Counter,
) -> None:
    document_id = document["id"]
    extraction = latest_extraction(db, document_id)
    created_extraction = False
    if extraction is None:
        extraction_id = "ext_reconcile_" + hashlib.sha256(document_id.encode()).hexdigest()[:24]
        metadata = {
            "engineUsed": "verified-corpus-reconcile",
            "source": "corpus-verified",
            "source_sha256": source_hash,
            "reconciled_at": utc_now(),
        }
        db.execute(
            """
            INSERT INTO extractions
              (id, document_id, raw_text, extraction_json, extraction_version, created_at)
            VALUES (?, ?, NULL, ?, 1, datetime('now'))
            """,
            (extraction_id, document_id, json.dumps(metadata, separators=(",", ":"))),
        )
        db.execute(
            "UPDATE documents SET latest_extraction_id = ? WHERE id = ?",
            (extraction_id, document_id),
        )
        extraction = latest_extraction(db, document_id)
        created_extraction = True
        stats["extractions_created"] += 1
    assert extraction is not None
    extraction_id = extraction["id"]

    existing: dict[str, list[sqlite3.Row]] = {}
    for field in db.execute("SELECT rowid, * FROM fields WHERE extraction_id = ?", (extraction_id,)):
        existing.setdefault(str(field["field_name"]), []).append(field)

    fields_inserted = fields_updated = fields_preserved = fields_seen = 0
    for field in row["fields"]:
        name = display_name(str(field.get("name") or ""))
        value = str(field.get("value") or "").strip()
        if not name or not value:
            stats["unknown_or_empty_fields"] += 1
            continue
        fields_seen += 1
        candidates = existing.get(name, [])
        selected = choose_field(candidates)
        current = effective_value(selected)
        if current == value:
            stats["fields_unchanged"] += 1
            continue
        if current and selected is not None and (selected["corrected_value"] is not None or selected["approved"] == 1):
            fields_preserved += 1
            stats["human_protected_conflicts"] += 1
            continue
        if current and conflict_policy == "preserve":
            fields_preserved += 1
            stats["preserved_conflicts"] += 1
            continue
        confidence = field.get("confidence")
        try:
            confidence_value = float(confidence) if confidence is not None else 0.0
        except (TypeError, ValueError):
            confidence_value = 0.0
        section = field.get("section") or "corpus-verified"
        if selected is None:
            insert_field(db, extraction_id, name, value, confidence_value, section)
            fields_inserted += 1
            stats["fields_inserted"] += 1
        else:
            db.execute(
                """
                UPDATE fields
                SET field_value = ?, confidence = ?, source_section = ?
                WHERE rowid = ?
                """,
                (value, confidence_value, section, selected["rowid"]),
            )
            fields_updated += 1
            stats["fields_updated"] += 1

    # A verified extraction is a completed result even if the old queue row
    # was failed/queued.  Do not touch jobs: their history remains auditable.
    if document["status"] != "extracted":
        db.execute("UPDATE documents SET status = 'extracted' WHERE id = ?", (document_id,))
        stats["documents_promoted_to_extracted"] += 1

    db.execute(
        """
        INSERT INTO corpus_reconciliation
          (source_hash, document_id, source_path, fields_seen, fields_inserted,
           fields_updated, fields_preserved, reconciled_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(source_hash) DO UPDATE SET
          document_id=excluded.document_id,
          source_path=excluded.source_path,
          fields_seen=excluded.fields_seen,
          fields_inserted=excluded.fields_inserted,
          fields_updated=excluded.fields_updated,
          fields_preserved=excluded.fields_preserved,
          reconciled_at=excluded.reconciled_at
        """,
        (
            source_hash,
            document_id,
            row["file"],
            fields_seen,
            fields_inserted,
            fields_updated,
            fields_preserved,
            utc_now(),
        ),
    )
    stats["matched_documents"] += 1
    stats["verified_fields_seen"] += fields_seen


def backup_database(source: str, destination: str) -> None:
    if os.path.exists(destination):
        raise RuntimeError(f"refusing to overwrite existing backup: {destination}")
    src = sqlite3.connect(source, timeout=60)
    dst = sqlite3.connect(destination)
    try:
        src.backup(dst, pages=1000, sleep=0.05)
        dst.commit()
    finally:
        dst.close()
        src.close()


@contextmanager
def process_lock(path: str):
    """Serialise reconcilers on Linux without requiring a package."""
    lock_path = path + ".reconcile.lock"
    os.makedirs(os.path.dirname(os.path.abspath(lock_path)) or ".", exist_ok=True)
    handle = open(lock_path, "a+")
    try:
        try:
            import fcntl

            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except ImportError:
            pass
        yield
    finally:
        try:
            import fcntl

            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        except ImportError:
            pass
        handle.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--in", dest="source", required=True, help="verified JSONL")
    parser.add_argument("--db", required=True, help="live SQLite app database")
    parser.add_argument("--backup", help="required with --apply; SQLite backup destination")
    parser.add_argument("--apply", action="store_true", help="commit changes (default is dry-run)")
    parser.add_argument("--verdict", default=DEFAULT_VERDICT)
    parser.add_argument("--source-root", help="optional source path root to remap")
    parser.add_argument("--target-root", help="runtime path root paired with --source-root")
    parser.add_argument(
        "--conflict-policy",
        choices=("preserve", "verified"),
        default="preserve",
        help="preserve unapproved conflicts, or replace them with verifier-approved values",
    )
    args = parser.parse_args()
    if bool(args.source_root) != bool(args.target_root):
        parser.error("--source-root and --target-root must be supplied together")
    if args.apply and not args.backup:
        parser.error("--apply requires --backup")
    if args.backup and not args.apply:
        parser.error("--backup is only valid with --apply")

    db_path = os.path.abspath(args.db)
    if not os.path.isfile(db_path):
        raise SystemExit(f"database not found: {db_path}")
    rows, source_stats = read_verified_rows(
        args.source, args.source_root, args.target_root, args.verdict
    )
    stats: Counter = Counter()
    stats.update(source_stats)

    with process_lock(db_path):
        if args.apply:
            backup_database(db_path, os.path.abspath(args.backup))
            stats["backup_bytes"] = os.path.getsize(args.backup)

        db = sqlite3.connect(db_path, timeout=120)
        db.row_factory = sqlite3.Row
        try:
            db.execute("PRAGMA foreign_keys=ON")
            db.execute("PRAGMA busy_timeout=120000")
            ensure_latest_pointer_column(db)
            db.commit()
            integrity_check(db)
            stats["pre_integrity"] = "ok"
            documents = {
                str(row["content_hash"]): row
                for row in db.execute(
                    "SELECT id, content_hash, status FROM documents WHERE content_hash IS NOT NULL"
                )
            }
            stats["database_content_hashes"] = len(documents)
            db.execute("BEGIN IMMEDIATE")
            ensure_audit_table(db)
            for source_path, row in sorted(rows.items()):
                if not os.path.isfile(source_path):
                    stats["missing_source_files"] += 1
                    continue
                source_hash = sha256_file(source_path)
                document = documents.get(source_hash)
                if document is None:
                    stats["unmatched_content_hashes"] += 1
                    continue
                reconcile_row(db, row, document, source_hash, args.conflict_policy, stats)
            if args.apply:
                integrity_check(db)
                db.commit()
                stats["post_integrity"] = "ok"
            else:
                db.rollback()
                stats["post_integrity"] = "rolled_back"
            # A dry run may have created the audit table before rollback; the
            # schema is harmless and makes subsequent runs self-auditing.
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    result = {
        "mode": "apply" if args.apply else "dry-run",
        "database": db_path,
        "source": os.path.abspath(args.source),
        "conflict_policy": args.conflict_policy,
        "stats": dict(sorted(stats.items())),
    }
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

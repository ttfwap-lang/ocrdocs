#!/usr/bin/env python3
"""Load verified LlamaCloud corpus extractions into the OCR.LOCAL app database.

The app derives its identity list at read time from whatever the latest
extraction of each document says (server/services/identityService.ts groups by
family_name + given_names + date_of_birth and orders the breakdown by the field
catalogue's logical number). So "loading the corpus into the app" means
inserting documents / extractions / fields exactly the way POST /api/documents
+ the result-ingestion endpoint do:

  documents(id, filename, original_path, content_hash, mime_type, uploaded_at, status)
  extractions(id, document_id, raw_text, extraction_json, extraction_version)
  fields(id, extraction_id, field_name, field_value, confidence,
         source_section, validated, validation_status, corrected_value, approved)

Rules (mirroring server.ts semantics):
  * original_path points at the REAL Recovered_C file, so /api/documents/:id/file
    serves the original bytes without copying anything.
  * dedupe by content_hash (identical bytes = same document, like the upload
    endpoint) and by original_path (never load the same file twice, so the
    script is idempotent).
  * only fields the verifier marked ok are inserted (junk/cjk verdicts are
    rejected as unverified), and only documents that kept at least one such
    field become rows.
  * field_name stores the human-readable display name from the field catalogue
    (like toExtractedField in server.ts), not the short id.
  * the full verified source record is kept in extraction_json so the app's
    getFullResult can surface documentType/engineUsed/etc.

Run:
    python scripts/load_corpus_into_app.py --in <desktop>\\results\\rc_extract_verified.jsonl \\
        --db data\\app.db
The app server must be stopped while this runs (it writes data/app.db directly).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import mimetypes
import os
import sqlite3
import sys
import uuid
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from field_catalogue import BY_ID  # noqa: E402  (generated from bankFields.ts)
from critical_field_rules import classify_critical_field  # noqa: E402

# Pipeline field names that differ from the catalogue id (see verify_fields.py FIELD_ID).
LEGACY_ALIASES = {
    "drivers_licence_number": "drivers_licence",
    "tax_file_number": "tfn",
    "occupation": "occupation_industry",
}

MIME_BY_EXT = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".doc": "application/msword",
    ".txt": "text/plain",
}


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def display_name_for(short_id: str) -> str | None:
    fid = LEGACY_ALIASES.get(short_id, short_id)
    entry = BY_ID.get(fid)
    return entry[0] if entry else None


def load_rows(path: str):
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                yield json.loads(line)
            except ValueError:
                continue


def mime_for(path: str) -> str | None:
    return MIME_BY_EXT.get(Path(path).suffix.lower()) or mimetypes.guess_type(path)[0]


def ensure_latest_pointer_column(con: sqlite3.Connection) -> None:
    """Keep the standalone loader compatible with databases from older releases."""
    columns = {row[1] for row in con.execute("PRAGMA table_info(documents)")}
    if "latest_extraction_id" not in columns:
        con.execute("ALTER TABLE documents ADD COLUMN latest_extraction_id TEXT")
    con.execute(
        "CREATE INDEX IF NOT EXISTS idx_documents_latest_extraction ON documents(latest_extraction_id)"
    )
    con.execute(
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


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--in", dest="src", required=True, help="results\\rc_extract_verified.jsonl")
    ap.add_argument("--db", dest="db", default=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "app.db"))
    ap.add_argument("--verdict", default="ok", help="only load fields with this verif verdict (default: ok)")
    args = ap.parse_args()

    con = sqlite3.connect(args.db)
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA foreign_keys=ON")
    ensure_latest_pointer_column(con)

    known_by_path = set(r[0] for r in con.execute("SELECT original_path FROM documents"))
    known_by_hash = set(r[0] for r in con.execute("SELECT content_hash FROM documents WHERE content_hash IS NOT NULL"))

    stats = {
        "rows": 0, "ok_rows": 0, "loaded_docs": 0, "skipped_dup_hash": 0,
        "skipped_dup_path": 0, "missing_file": 0, "no_ok_fields": 0,
        "fields_loaded": 0, "unknown_field": 0, "existing_extraction": 0,
    }

    for row in load_rows(args.src):
        stats["rows"] += 1
        if not row.get("ok"):
            continue
        stats["ok_rows"] += 1

        src_path = row.get("file") or ""
        if not os.path.isfile(src_path):
            stats["missing_file"] += 1
            continue

        # Only verified fields survive the load.
        fields_in = [f for f in (row.get("fields") or []) if f.get("verif") == args.verdict]
        if not fields_in:
            stats["no_ok_fields"] += 1
            continue

        # Dedupe by original_path (idempotency -> never load a file twice).
        norm_path = os.path.normcase(os.path.abspath(src_path))
        if norm_path in known_by_path:
            stats["skipped_dup_path"] += 1
            continue
        # Dedupe by content_hash (identical bytes = same document, like the upload endpoint).
        try:
            content_hash = sha256_file(src_path)
        except OSError:
            stats["missing_file"] += 1
            continue
        if content_hash in known_by_hash:
            stats["skipped_dup_hash"] += 1
            continue

        # -- insert document ----------------------------------------------------------
        document_id = "doc_" + hashlib.sha256(norm_path.encode("utf-8")).hexdigest()[:24]
        filename = Path(src_path).name or src_path
        mime = mime_for(src_path)
        con.execute(
            "INSERT INTO documents (id, filename, original_path, content_hash, mime_type, uploaded_at, status, user_id) "
            "VALUES (?,?,?,?,?,datetime('now'),'extracted',NULL)",
            (document_id, filename, src_path, content_hash, mime),
        )
        known_by_path.add(norm_path)
        known_by_hash.add(content_hash)

        # -- insert extraction ---------------------------------------------------------
        extraction_id = "ext_" + hashlib.sha256(document_id.encode("utf-8")).hexdigest()[:24]
        extraction_json = {
            "engineUsed": "llamacloud-bulk",
            "documentType": row.get("document_type") or None,
            "typeConfidence": row.get("type_confidence"),
            "typeReasoning": row.get("type_reasoning"),
            "pages": row.get("pages"),
            "credits": row.get("credits"),
            "errors": row.get("errors") or [],
            "source": "corpus-verified",
            "sourceRecord": row,
        }
        con.execute(
            "INSERT INTO extractions (id, document_id, raw_text, extraction_json, extraction_version, created_at) "
            "VALUES (?,?,?,?,1,datetime('now'))",
            (extraction_id, document_id, None, json.dumps(extraction_json, ensure_ascii=False)),
        )
        con.execute(
            "UPDATE documents SET latest_extraction_id = ? WHERE id = ?",
            (extraction_id, document_id),
        )

        # -- insert fields -------------------------------------------------------------
        inserted_fields = 0
        for f in fields_in:
            display = display_name_for(f.get("name") or "")
            if not display:
                stats["unknown_field"] += 1
                continue
            value = (f.get("value") or "").strip()
            format_valid, _reason = classify_critical_field(display, value)
            con.execute(
                "INSERT INTO fields (id, extraction_id, field_name, field_value, confidence, source_section, "
                "validated, validation_status, corrected_value, approved) VALUES (?,?,?,?,?,?,?,?,NULL,0)",
                (
                    str(uuid.uuid4()),
                    extraction_id,
                    display,
                    value,
                    float(f.get("confidence") or 0),
                    f.get("section") or None,
                    1 if format_valid else 0,
                    "valid" if format_valid else "warning",
                ),
            )
            inserted_fields += 1

        stats["fields_loaded"] += inserted_fields
        stats["loaded_docs"] += 1

    con.commit()
    con.close()

    print("loaded corpus into", args.db)
    for k, v in stats.items():
        print(f"  {k}: {v}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
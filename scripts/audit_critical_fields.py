#!/usr/bin/env python3
"""Audit persisted BSB/account/DOB shapes without printing field values.

This is a read-only-by-default companion to the corpus reconciler. With
``--apply`` it marks malformed, unprotected critical fields as warnings; it
never changes the extracted value and never overwrites a human correction or
approval. A SQLite backup is mandatory for an apply.
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from critical_field_rules import CRITICAL_FIELDS, classify_critical_field  # noqa: E402


def now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def integrity(db: sqlite3.Connection) -> None:
    row = db.execute("PRAGMA integrity_check").fetchone()
    if not row or row[0] != "ok":
        raise RuntimeError(f"integrity_check failed: {row!r}")


def backup(source: str, destination: str) -> None:
    if os.path.exists(destination):
        raise RuntimeError(f"refusing to overwrite backup: {destination}")
    src = sqlite3.connect(source, timeout=60)
    dst = sqlite3.connect(destination)
    try:
        src.backup(dst, pages=1000, sleep=0.05)
        dst.commit()
    finally:
        dst.close()
        src.close()
    os.chmod(destination, 0o600)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--db", required=True)
    parser.add_argument("--backup", help="required with --apply")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    if args.apply and not args.backup:
        parser.error("--apply requires --backup")
    if args.backup and not args.apply:
        parser.error("--backup is only valid with --apply")
    db_path = os.path.abspath(args.db)
    if not os.path.isfile(db_path):
        raise SystemExit(f"database not found: {db_path}")
    if args.apply:
        backup(db_path, os.path.abspath(args.backup))

    db = sqlite3.connect(db_path, timeout=120)
    db.row_factory = sqlite3.Row
    stats: Counter = Counter()
    try:
        db.execute("PRAGMA foreign_keys=ON")
        db.execute("PRAGMA busy_timeout=120000")
        integrity(db)
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS critical_field_audit (
              field_id TEXT PRIMARY KEY,
              field_name TEXT NOT NULL,
              verdict TEXT NOT NULL,
              reason TEXT NOT NULL,
              checked_at TEXT NOT NULL
            )
            """
        )
        db.commit()
        db.execute("BEGIN IMMEDIATE")
        rows = db.execute(
            """
            SELECT f.id, f.field_name, f.field_value, f.corrected_value, f.approved
            FROM fields f
            JOIN documents d ON d.latest_extraction_id = f.extraction_id
            WHERE f.field_name IN (?, ?, ?)
            """,
            CRITICAL_FIELDS,
        ).fetchall()
        for row in rows:
            value = row["corrected_value"] if row["corrected_value"] is not None else row["field_value"]
            raw_value = (str(value) if value is not None else "").strip()
            if not raw_value:
                stats["empty"] += 1
                db.execute(
                    """
                    INSERT INTO critical_field_audit(field_id, field_name, verdict, reason, checked_at)
                    VALUES (?, ?, 'empty', 'empty', ?)
                    ON CONFLICT(field_id) DO UPDATE SET
                      field_name=excluded.field_name, verdict=excluded.verdict,
                      reason=excluded.reason, checked_at=excluded.checked_at
                    """,
                    (row["id"], row["field_name"], now()),
                )
                continue
            valid, reason = classify_critical_field(row["field_name"], value)
            protected = row["corrected_value"] is not None or row["approved"] == 1
            if valid:
                verdict = "valid"
            elif protected:
                verdict = "protected_invalid"
            else:
                verdict = "invalid"
                db.execute(
                    "UPDATE fields SET validated = 0, validation_status = 'warning' WHERE id = ?",
                    (row["id"],),
                )
            stats[verdict] += 1
            db.execute(
                """
                INSERT INTO critical_field_audit(field_id, field_name, verdict, reason, checked_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(field_id) DO UPDATE SET
                  field_name=excluded.field_name,
                  verdict=excluded.verdict,
                  reason=excluded.reason,
                  checked_at=excluded.checked_at
                """,
                (row["id"], row["field_name"], verdict, reason, now()),
            )
        if args.apply:
            integrity(db)
            db.commit()
            stats["mode"] = "apply"
        else:
            db.rollback()
            stats["mode"] = "dry-run"
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
    print(json.dumps({"database": db_path, "stats": dict(sorted(stats.items()))}, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Insert recovered credit scores into the app DB as first-class `Credit Score` fields.

WHY A SEPARATE PASS
-------------------
`load_corpus_into_app.py` loads the *verified bulk parse*, which never had a credit-score
field in its schema. `extract_credit_score.py` recovers the Equifax One Score from the
source documents' text layer. This script joins the two: for each recovered score it finds
the already-loaded document whose `original_path` matches the score's source file, and
inserts a `Credit Score` field on that document's latest extraction.

The identity page promotes the credit score to a top-level heading, so it has to be a real
field in the DB, not a side file. Joining by exact `original_path` keeps the value
traceable to the file it was read from.

Rules:
  * idempotent — re-running updates the existing `Credit Score` field on a document
    instead of duplicating it, and never touches a human-corrected value.
  * only documents already present in the app are touched (the server must be stopped,
    as with load_corpus_into_app.py).
  * a document with no extraction gets none; nothing is invented.

Run (server stopped):
    python scripts/load_credit_scores.py --scores data\\credit_scores.jsonl --db data\\app.db
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sqlite3
import sys
import uuid
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from field_catalogue import BY_ID  # noqa: E402

CREDIT_SCORE_DISPLAY = BY_ID["credit_score"][0]  # "Credit Score"


def norm_path(p: str) -> str:
    return os.path.normcase(os.path.abspath(p))


def sha256_file(path: str) -> str | None:
    try:
        digest = hashlib.sha256()
        with open(path, "rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()
    except OSError:
        return None


def load_scores(path: str):
    out = []
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except ValueError:
                continue
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--scores", required=True, help="JSONL from extract_credit_score.py")
    ap.add_argument("--db", default=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "app.db"))
    args = ap.parse_args()

    scores = load_scores(args.scores)
    con = sqlite3.connect(args.db)
    con.execute("PRAGMA foreign_keys=ON")

    path_to_doc = {}
    hash_to_doc = {}
    for did, op, content_hash in con.execute(
        "SELECT id, original_path, content_hash FROM documents WHERE original_path IS NOT NULL"
    ):
        path_to_doc[norm_path(op)] = did
        if content_hash:
            hash_to_doc.setdefault(content_hash, did)

    inserted = updated = skipped_missing_doc = skipped_existing = matched_by_hash = 0
    for rec in scores:
        src = rec.get("source")
        value = (rec.get("credit_score") or "").strip()
        if not src or not value:
            continue
        did = path_to_doc.get(norm_path(src))
        if not did:
            # A live queue may have registered the same bytes under a parsed
            # path rather than the original Recovered_C path. Resolve that case
            # by content hash, without inventing a join.
            source_hash = sha256_file(src)
            did = hash_to_doc.get(source_hash) if source_hash else None
            if did:
                matched_by_hash += 1
        if not did:
            skipped_missing_doc += 1
            continue
        # latest extraction for the document
        ex = con.execute(
            "SELECT id FROM extractions WHERE document_id=? ORDER BY created_at DESC, rowid DESC LIMIT 1",
            (did,),
        ).fetchone()
        if not ex:
            skipped_missing_doc += 1
            continue
        extraction_id = ex[0]

        existing = con.execute(
            "SELECT id, corrected_value FROM fields WHERE extraction_id=? AND field_name=?",
            (extraction_id, CREDIT_SCORE_DISPLAY),
        ).fetchone()
        if existing:
            # Never overwrite a human correction.
            if existing[1] is not None:
                skipped_existing += 1
                continue
            con.execute(
                "UPDATE fields SET field_value=?, confidence=?, source_section=? WHERE id=?",
                (value, 95.0, "credit_report", existing[0]),
            )
            updated += 1
        else:
            con.execute(
                "INSERT INTO fields (id, extraction_id, field_name, field_value, confidence, source_section, "
                "validated, validation_status, corrected_value, approved) VALUES (?,?,?,?,?,?,1,'valid',NULL,0)",
                (str(uuid.uuid4()), extraction_id, CREDIT_SCORE_DISPLAY, value, 95.0, "credit_report"),
            )
            inserted += 1

    con.commit()
    con.close()

    print(f"credit scores -> {args.db}")
    print(f"  inserted: {inserted}")
    print(f"  updated: {updated}")
    print(f"  matched by content hash: {matched_by_hash}")
    print(f"  skipped (no matching document): {skipped_missing_doc}")
    print(f"  skipped (already corrected by a human): {skipped_existing}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

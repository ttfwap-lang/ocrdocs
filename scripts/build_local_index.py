#!/usr/bin/env python3
"""Build a private, local, searchable index from the LlamaCloud bulk parse output.

This is the local-first answer to "Index our documents for search": instead of re-uploading every
document to a hosted LlamaCloud Index (which re-parses everything for more credits and keeps a
persistent, queryable copy of personal data on the vendor), we index the structured extraction
results we ALREADY have on disk into a local SQLite FTS5 database. Nothing leaves the machine.

What it indexes (per ok record in --in):
  - every extracted field (given_names, family_name, date_of_birth, residential_address, mobile, ...)
    with its subject, section, evidence span and confidence;
  - identity grouping using the SAME scheme as server/services/identityService.ts:
      identityId = sha256(normalize(family_name)|normalize(given_names)|normalizeDigits(dob))[:16]
    so the built index plugs straight into the OCR.LOCAL identities API/UI;
  - documents that have no usable identity (missing family name or DOB) go to the "unassigned"
    bucket, still searchable by any of their fields.

Output: a SQLite database (default results/local_index.db) with
    fields(file, identity_id, subject, name, value, evidence, section, source, confidence, origin, number)
    docs(file, pages, document_type, credits, errors, ok)
    identities(identity_id, given_names, family_name, dob, doc_count, field_count)
    fields_fts  (FTS5 over value/evidence/name/subject),  docs_fts  (FTS5 over file)

Ordering matches the app: identities rows are written family-name-first (then
given names, then dob), mirroring listIdentities; each fields row carries its
catalogue `number` so a breakdown can be reproduced in the same logical order
identityService.fieldBreakdown sorts by.

Run:
    python build_local_index.py --in results\\rc_extract.jsonl --out results\\local_index.db
    python build_local_index.py --in results\\rc_extract.jsonl --out results\\local_index.db --subject-filter spouse

Privacy: output lives under gitignored paths (results/ on desktop, data/ in the repo). It only
contains what the vendor already saw, kept on disk, never re-sent. Delete the .db and it's gone.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sqlite3
import sys
from collections import Counter
from typing import Any, Dict, List, Optional, Tuple

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

FAMILY = "family_name"
GIVEN = "given_names"
DOB = "date_of_birth"

# subject values in the extraction domain (also used by headshot corpus indexing)
SUBJECTS = {"parent", "spouse", "dependant", "employer", "referee", "other"}

# Pipeline field names that differ from the catalogue id -- same aliasing as
# verify_fields.py FIELD_ID and scripts/load_corpus_into_app.py, so the local
# index and the app agree on which catalogue entry a field is.
LEGACY_ALIASES = {
    "drivers_licence_number": "drivers_licence",
    "tax_file_number": "tfn",
    "occupation": "occupation_industry",
}


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "").strip().lower())


def normalize_digits(value: str) -> str:
    return re.sub(r"[^0-9]", "", value or "")


def _load_catalogue() -> Dict[str, Tuple[str, int]]:
    """short id -> (display name, catalogue number) from the generated field_catalogue module."""
    try:
        import field_catalogue as fc
    except ImportError:
        # Running from another cwd: the module lives next to this script.
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        import field_catalogue as fc  # type: ignore
    return dict(fc.BY_ID)


_CATALOGUE = _load_catalogue()


def catalogue_number(name: str) -> Optional[int]:
    """Logical order number for a pipeline field name (None for unknown ids)."""
    fid = LEGACY_ALIASES.get(name, name)
    entry = _CATALOGUE.get(fid)
    return entry[1] if entry else None


def identity_id_for(family: str, given: str, dob: str) -> str:
    key = f"{normalize_text(family)}|{normalize_text(given)}|{normalize_digits(dob)}"
    return hashlib.sha256(key.encode("utf-8")).hexdigest()[:16]


def load_rows(path: str) -> List[Dict[str, Any]]:
    out = []
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except ValueError:
                continue  # truncated tail line while the bulk run is mid-write
    return out


def build_index(src: str, dst: str, subject_filter: Optional[str] = None) -> Dict[str, int]:
    if os.path.exists(dst):
        os.remove(dst)
    os.makedirs(os.path.dirname(dst) or ".", exist_ok=True)
    con = sqlite3.connect(dst)
    try:
        con.execute("PRAGMA journal_mode=WAL")
        con.execute("PRAGMA synchronous=OFF")
        con.executescript(
            """
            CREATE TABLE fields(
                id INTEGER PRIMARY KEY,
                file TEXT NOT NULL, identity_id TEXT,
                subject TEXT, name TEXT, value TEXT, evidence TEXT,
                section TEXT, source TEXT, confidence REAL, origin TEXT,
                number INTEGER
            );
            CREATE TABLE docs(
                file TEXT PRIMARY KEY, pages INTEGER, document_type TEXT,
                credits REAL, errors TEXT, ok INTEGER
            );
            CREATE TABLE identities(
                identity_id TEXT PRIMARY KEY, given_names TEXT, family_name TEXT,
                dob TEXT, doc_count INTEGER, field_count INTEGER
            );
            CREATE VIRTUAL TABLE fields_fts USING fts5(value, evidence, name, subject, file);
            CREATE VIRTUAL TABLE docs_fts USING fts5(file, document_type);
            """
        )

        rows = load_rows(src)
        counts = Counter()
        by_file: Dict[str, Dict[str, Any]] = {}
        identity_fields: Dict[str, List[Tuple[str, str, str]]] = {}
        ids_of_doc: Dict[str, set] = {}

        for r in rows:
            if not r.get("ok"):
                counts["skipped_not_ok"] += 1
                continue
            file = r.get("file")
            counts["ok"] += 1
            doc_type = r.get("document_type")
            pages = r.get("pages") or 0
            credits = r.get("credits") or 0.0
            errors = json.dumps(r.get("errors") or [], ensure_ascii=False)
            con.execute("INSERT OR REPLACE INTO docs VALUES (?,?,?,?,?,?)",
                        (file, pages, doc_type, credits, errors, 1))
            con.execute("INSERT INTO docs_fts(rowid, file, document_type) VALUES ((SELECT rowid FROM docs WHERE file=?), ?, ?)",
                        (file, file, doc_type or ""))

            fields: List[Dict[str, Any]] = r.get("fields") or []
            fam = given = dob = ""
            for f in fields:
                name = f.get("name", "")
                value = (f.get("value") or "").strip()
                subject = f.get("subject") or ""
                if subject_filter and subject != subject_filter:
                    continue
                if not value:
                    counts["empty_value"] += 1
                    continue
                if name == FAMILY:
                    fam = value
                elif name == GIVEN:
                    given = value
                elif name == DOB:
                    dob = value
                evidence = (f.get("evidence") or "").strip()
                section = f.get("section") or ""
                source = f.get("source") or ""
                confidence = f.get("confidence")
                origin = f.get("origin") or ""
                number = catalogue_number(name)
                cur = con.execute(
                    "INSERT INTO fields(file, identity_id, subject, name, value, evidence, section, source, confidence, origin, number) "
                    "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                    (file, None, subject, name, value, evidence, section, source,
                     float(confidence) if isinstance(confidence, (int, float)) else None, origin, number))
                fid = cur.lastrowid
                try:
                    con.execute("INSERT INTO fields_fts(rowid, value, evidence, name, subject, file) VALUES (?,?,?,?,?,?)",
                                (fid, value, evidence, name, subject, file))
                except sqlite3.OperationalError:
                    pass  # fts5 rowid table quirk - field still present in fields table
                counts["fields"] += 1
                by_file.setdefault(file, {}).setdefault("fields", []).append({
                    "name": name, "value": value, "subject": subject, "evidence": evidence,
                    "section": section, "source": source, "confidence": confidence, "origin": origin,
                    "number": number,
                })

            # identity grouping: family + given + dob -> identityId
            if fam and dob:
                iid = identity_id_for(fam, given, dob)
                con.execute("UPDATE fields SET identity_id=? WHERE file=? AND identity_id IS NULL", (iid, file))
                identity_fields.setdefault(iid, [])
                for f in by_file[file]["fields"]:
                    if f["name"] in (FAMILY, GIVEN, DOB) or f["value"]:
                        identity_fields[iid].append((file, f["name"], f["value"]))
                ids_of_doc.setdefault(file, set()).add(iid)
                counts["identities"] += 1
            else:
                counts["unassigned_docs"] += 1

        # identity summaries need the latest family/given/dob per identity (same "latest extraction" rule).
        # Ordered family-name-first (then given names, then dob) so a plain `SELECT * FROM identities`
        # reproduces the identity list order of server/services/identityService.ts.
        seen_iid = set()
        identity_rows: List[Tuple[str, str, str, str, int, int]] = []
        for file, doc in by_file.items():
            fam = given = dob = ""
            for f in doc["fields"]:
                if f["name"] == FAMILY:
                    fam = f["value"]
                elif f["name"] == GIVEN:
                    given = f["value"]
                elif f["name"] == DOB:
                    dob = f["value"]
            if fam and dob:
                iid = identity_id_for(fam, given, dob)
                if iid not in seen_iid:
                    doc_count = len(ids_of_doc.get(iid, {file}))
                    field_count = len(identity_fields.get(iid, []))
                    identity_rows.append((iid, given, fam, dob, doc_count, field_count))
                    seen_iid.add(iid)
        identity_rows.sort(key=lambda r: (r[2].lower(), r[1].lower(), r[3]))
        for row in identity_rows:
            con.execute("INSERT INTO identities VALUES (?,?,?,?,?,?)", row)

        con.commit()
        return dict(counts)
    finally:
        con.close()


def _summarize(con: sqlite3.Connection) -> Dict[str, int]:
    for table in ("docs", "fields", "identities"):
        n = con.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        print(f"  {table}: {n}")
    return {}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--in", dest="src", required=True, help="results JSONL from llamaparse_bulk.py")
    ap.add_argument("--out", dest="dst", default="results/local_index.db", help="output SQLite database")
    ap.add_argument("--subject-filter", default=None, help="only index fields with this subject (parent/spouse/dependant/employer/referee/other)")
    ap.add_argument("--summary", action="store_true", help="print per-table counts after building")
    args = ap.parse_args()

    counts = build_index(args.src, args.dst, args.subject_filter)
    print(f"built {args.dst}")
    print("  records:", counts)
    if args.summary and os.path.exists(args.dst):
        con = sqlite3.connect(args.dst)
        try:
            _summarize(con)
        finally:
            con.close()


if __name__ == "__main__":
    main()
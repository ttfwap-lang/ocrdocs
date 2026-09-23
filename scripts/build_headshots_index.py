#!/usr/bin/env python3
"""Convert the desktop headshot corpus index into the app's flat headshot index.

WHY
---
`server/services/headshotService.ts` reads `<headshotsRoot>/index.jsonl` where every
line is a flat record:

    {"docId","identityId","subdir","doc","page","source",
     "headshots":[{"crop","relPath","bbox","verified"}]}

and it keys people by the app's sha256 identityId (same scheme as identityService.ts).

The desktop extractor (`extract_headshots_corpus.py`) writes a DIFFERENT, nested
format keyed by person folder name, not identityId:

    {"file","note","record":{"subjects":[...],
                             "headshots":[{"page","crop","bbox","verified","path"}]}}

So the app cannot see the corpus as-is. This script bridges the two:

  1. reads the nested corpus index,
  2. maps each source file -> the app document id (matching documents.original_path,
     normcase+abspath, the same key the loader dedupes on),
  3. recomputes the app's identityId from that document's OWN extraction fields
     using identityService.ts's exact algorithm (first-match field semantics,
     sha256(`family|given|dob`)[:16], dob digits-only),
  4. emits the flat index the app already understands.

It is read-only against the app DB and the corpus. It copies crop bytes into a
separate output root so the app's static mount serves real files; the corpus is
never modified. Documents with no app row are skipped (not invented).

Run:
    python scripts/build_headshots_index.py \
        --corpus "C:\\Users\\<you>\\Desktop\\llamaparse_bulk\\data\\headshots_corpus" \
        --out data\\headshots

Output:
    data\\headshots\\index.jsonl   flat index the app serves
    data\\headshots\\<subdir>\\...  copied crop bytes
"""
from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import os
import re
import shutil
import sqlite3
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

REPO = Path(__file__).resolve().parent.parent

# Display names as stored in fields.field_name (see field_catalogue / server.ts).
FAMILY_FIELD = "Family Name / Surname"
GIVEN_FIELD = "Given Names / First Name"
DOB_FIELD = "Date of Birth (DOB)"


# --- exact copies of identityService.ts helpers --------------------------------
# These MUST stay in lockstep with server/services/identityService.ts and
# server/services/dobKey.ts, or head photos would attach to identityIds the app
# never produces. tests/dobKey.test.mjs pins the shared behaviour.

_MONTHS = {
    "january": 1, "jan": 1, "february": 2, "feb": 2, "march": 3, "mar": 3,
    "april": 4, "apr": 4, "may": 5, "june": 6, "jun": 6, "july": 7, "jul": 7,
    "august": 8, "aug": 8, "september": 9, "sep": 9, "sept": 9,
    "october": 10, "oct": 10, "november": 11, "nov": 11, "december": 12, "dec": 12,
}


def _month_number(token: str) -> Optional[int]:
    month = _MONTHS.get(token.lower().rstrip("."))
    return month if month and 1 <= month <= 12 else None


def _is_real_date(year: int, month: int, day: int) -> bool:
    if year < 1900 or year > 2100 or month < 1 or month > 12 or day < 1 or day > 31:
        return False
    try:
        datetime.date(year, month, day)
        return True
    except ValueError:
        return False


def _expand_two_digit_year(two_digit: str) -> int:
    value = int(two_digit)
    return 2000 + value if value < 30 else 1900 + value


def _digits(value: str) -> str:
    return re.sub(r"[^0-9]", "", value or "")


def canonical_dob(value: str) -> str:
    """Mirror of server/services/dobKey.ts canonicalDob."""
    raw = (value or "").strip()
    if not raw:
        return ""

    dmy = re.match(r"^(\d{1,2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{4})$", raw)
    if dmy:
        day, month, year = int(dmy.group(1)), int(dmy.group(2)), int(dmy.group(3))
        if day > 12 and _is_real_date(year, month, day):
            return f"{year:04d}{month:02d}{day:02d}"
        return _digits(raw)

    ymd = re.match(r"^(\d{4})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{1,2})$", raw)
    if ymd:
        year, month, day = int(ymd.group(1)), int(ymd.group(2)), int(ymd.group(3))
        if _is_real_date(year, month, day):
            return f"{year:04d}{month:02d}{day:02d}"
        return _digits(raw)

    name_first = re.match(r"^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$", raw)
    if name_first:
        month = _month_number(name_first.group(2))
        day, year = int(name_first.group(1)), int(name_first.group(3))
        if month and _is_real_date(year, month, day):
            return f"{year:04d}{month:02d}{day:02d}"
        return _digits(raw)

    month_first = re.match(r"^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$", raw)
    if month_first:
        month = _month_number(month_first.group(1))
        day, year = int(month_first.group(2)), int(month_first.group(3))
        if month and _is_real_date(year, month, day):
            return f"{year:04d}{month:02d}{day:02d}"
        return _digits(raw)

    compact = re.match(r"^(\d{1,2})([A-Za-z]{3,9})\.?(\d{4})$", raw)
    if compact:
        month = _month_number(compact.group(2))
        day, year = int(compact.group(1)), int(compact.group(3))
        if month and _is_real_date(year, month, day):
            return f"{year:04d}{month:02d}{day:02d}"
        return _digits(raw)

    short_year = re.match(r"^(\d{1,2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{2})$", raw)
    if short_year:
        day, month = int(short_year.group(1)), int(short_year.group(2))
        year = _expand_two_digit_year(short_year.group(3))
        if day > 12 and _is_real_date(year, month, day):
            return f"{year:04d}{month:02d}{day:02d}"
        return _digits(raw)

    short_name_year = re.match(r"^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?\s+(\d{2})$", raw)
    if short_name_year:
        month = _month_number(short_name_year.group(2))
        day = int(short_name_year.group(1))
        year = _expand_two_digit_year(short_name_year.group(3))
        if month and _is_real_date(year, month, day):
            return f"{year:04d}{month:02d}{day:02d}"
        return _digits(raw)

    return _digits(raw)


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "").strip().lower())


def identity_id_for(key: str) -> str:
    return hashlib.sha256(key.encode("utf-8")).hexdigest()[:16]


def app_identity_id(family: str, given: str, dob: str) -> str:
    return identity_id_for(f"{normalize_text(family)}|{normalize_text(given)}|{canonical_dob(dob)}")


# --- app DB -> docId and per-doc identityId ------------------------------------
def load_app_state(db_path: str) -> Tuple[Dict[str, str], Dict[str, str]]:
    """Return (normalized original_path -> document_id, document_id -> identityId)."""
    con = sqlite3.connect(db_path)
    try:
        con.row_factory = sqlite3.Row
        path_to_doc: Dict[str, str] = {}
        for row in con.execute(
            "SELECT id, original_path FROM documents WHERE original_path IS NOT NULL"
        ):
            path_to_doc[norm_path(row["original_path"])] = row["id"]

        doc_identity: Dict[str, str] = {}
        for row in con.execute("SELECT id FROM documents"):
            did = row["id"]
            # latest extraction, mirroring identityService.latestExtraction.
            ex = con.execute(
                "SELECT id FROM extractions WHERE document_id=? "
                "ORDER BY created_at DESC, rowid DESC LIMIT 1",
                (did,),
            ).fetchone()
            if not ex:
                continue
            # First non-empty value per identity field (Array.find semantics).
            first: Dict[str, str] = {}
            for f in con.execute(
                "SELECT field_name, field_value, corrected_value "
                "FROM fields WHERE extraction_id=? ORDER BY rowid",
                (ex["id"],),
            ).fetchall():
                name = f["field_name"]
                if name in (FAMILY_FIELD, GIVEN_FIELD, DOB_FIELD) and name not in first:
                    value = f["corrected_value"] if f["corrected_value"] is not None else f["field_value"]
                    if value and str(value).strip():
                        first[name] = str(value).strip()
            family = first.get(FAMILY_FIELD, "")
            given = first.get(GIVEN_FIELD, "")
            dob = first.get(DOB_FIELD, "")
            if family and dob:
                doc_identity[did] = app_identity_id(family, given, dob)
        return path_to_doc, doc_identity
    finally:
        con.close()


def norm_path(value: str) -> str:
    return os.path.normcase(os.path.abspath(value))


# --- conversion ---------------------------------------------------------------
def convert(corpus: Path, out_root: Path, db_path: str, copy_files: bool = True) -> Dict[str, int]:
    path_to_doc, doc_identity = load_app_state(db_path)

    nested = (corpus / "index.jsonl").read_text(encoding="utf-8").splitlines()
    out_root.mkdir(parents=True, exist_ok=True)

    stats: Counter[str] = Counter()
    flat_records: List[Dict[str, Any]] = []
    # Track subdir -> identityId(s) so folder naming can't collide across people.
    subdir_identities: Dict[str, set] = defaultdict(set)
    seen_relpaths: set = set()

    for line in nested:
        line = line.strip()
        if not line:
            continue
        stats["nested_records"] += 1
        try:
            rec = json.loads(line)
        except ValueError:
            stats["bad_json"] += 1
            continue
        inner = rec.get("record") or {}
        faces = inner.get("headshots") or []
        if not faces:
            continue
        stats["records_with_faces"] += 1

        src_file = rec.get("file") or ""
        doc_id = path_to_doc.get(norm_path(src_file))
        if not doc_id:
            stats["no_app_document"] += 1
            continue
        stats["mapped_document"] += 1

        identity_id = doc_identity.get(doc_id, "")
        if identity_id:
            stats["mapped_identity"] += 1
        else:
            stats["no_identity_unassigned"] += 1

        # Group faces into the flat (docId, subdir, page) records the app expects.
        grouped: Dict[Tuple[str, int], List[Dict[str, Any]]] = defaultdict(list)
        for face in faces:
            crop = str(face.get("crop") or "")
            if not crop:
                continue
            rel = str(face.get("path") or crop)
            # Normalise to forward slashes; subdir is the first path segment.
            rel_norm = rel.replace("\\", "/")
            subdir = rel_norm.split("/", 1)[0] if "/" in rel_norm else "_unassigned"
            crop_name = rel_norm.split("/", 1)[1] if "/" in rel_norm else rel_norm
            page = int(face.get("page") or 0) or 0
            bbox = face.get("bbox") if isinstance(face.get("bbox"), list) else []
            verified = bool(face.get("verified"))
            grouped[(subdir, page)].append(
                {
                    "crop": crop_name,
                    "relPath": rel_norm,
                    "bbox": [int(x) for x in bbox] if bbox else [],
                    "verified": verified,
                }
            )
            if verified:
                stats["verified_crops"] += 1
            else:
                stats["unverified_crops"] += 1
            seen_relpaths.add(rel_norm)
            if identity_id:
                subdir_identities[subdir].add(identity_id)

        for (subdir, page), photos in grouped.items():
            flat_records.append(
                {
                    "docId": doc_id,
                    "identityId": identity_id,
                    "subdir": subdir,
                    "doc": os.path.basename(src_file),
                    "page": page,
                    "source": src_file,
                    "headshots": photos,
                }
            )

    # Sanity: a subdir mapped to >1 identity would mis-serve photos under a folder
    # the app thinks is one person. That is possible when a person's folder also
    # collected an unrelated crop; we do NOT rename (never delete/mutate source),
    # but we record it so the operator can see the ceiling.
    ambiguous = {s: ids for s, ids in subdir_identities.items() if len(ids) > 1}
    stats["ambiguous_subdirs"] = len(ambiguous)

    # Write the flat index.
    index_out = out_root / "index.jsonl"
    with index_out.open("w", encoding="utf-8") as fh:
        for rec in flat_records:
            fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
    stats["flat_records"] = len(flat_records)

    # Copy the crop bytes so express.static(HEADSHOTS_ROOT) can serve them.
    if copy_files:
        copied = 0
        for rel in seen_relpaths:
            src = corpus / rel.replace("/", os.sep)
            dst = out_root / rel.replace("/", os.sep)
            if src.is_file():
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(src, dst)
                copied += 1
        stats["crops_copied"] = copied

    # Per-identity coverage (only meaningful once the app DB is loaded).
    id_with_photos = {r["identityId"] for r in flat_records if r["identityId"] and any(p["verified"] for p in r["headshots"])}
    stats["identities_with_verified_photo"] = len(id_with_photos)
    stats["identities_total_in_db"] = len(set(doc_identity.values()))
    return dict(stats)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument(
        "--corpus",
        default=r"C:\Users\lnxzf\Desktop\llamaparse_bulk\data\headshots_corpus",
        help="desktop headshot corpus root (contains the nested index.jsonl)",
    )
    ap.add_argument("--out", default=str(REPO / "data" / "headshots"), help="app headshots root (flat index + crops)")
    ap.add_argument("--db", default=str(REPO / "data" / "app.db"), help="app database")
    ap.add_argument("--no-copy", action="store_true", help="only write index.jsonl, do not copy crop bytes")
    args = ap.parse_args()

    stats = convert(Path(args.corpus), Path(args.out), args.db, copy_files=not args.no_copy)
    print("built", args.out)
    for key in (
        "nested_records", "records_with_faces", "mapped_document", "no_app_document",
        "mapped_identity", "no_identity_unassigned", "flat_records",
        "verified_crops", "unverified_crops", "crops_copied",
        "ambiguous_subdirs", "identities_with_verified_photo", "identities_total_in_db",
    ):
        print(f"  {key}: {stats.get(key, 0)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

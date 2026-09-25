#!/usr/bin/env python3
"""Attach verified rear-licence evidence to OCRDocs identities.

This is a conservative, idempotent bridge between the local rear-card scanner
and the app's derived identity grouping. It never creates an identity from a
rear-only scan and never treats a visual duplicate as an identity merge.

The source occurrence is joined to the app by the *full file SHA-256*. Only a
unique matching document with a reliable current name+DOB grouping is ever
emitted into an identity gallery. Confirmed-but-unassigned and review pages are
also written to the private index with an explicit unassigned/needs_review
state so a human can inspect them; they never receive an identity ID. Review
rows are only assignable when the operator explicitly passes ``--include-review``
for mixed pages that already have a human review.

Outputs are private sidecar files; the server exposes only the asset URL and
non-sensitive metadata. The original source path is kept in provenance.jsonl,
not in the API-facing index.
"""
from __future__ import annotations

import argparse
import datetime as _dt
import hashlib
import json
import os
import re
import shutil
import sqlite3
import sys
from collections import Counter
from pathlib import Path
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

FAMILY_FIELD = "Family Name / Surname"
GIVEN_FIELD = "Given Names / First Name"
DOB_FIELD = "Date of Birth (DOB)"

MONTHS = {
    "january": 1, "jan": 1, "february": 2, "feb": 2, "march": 3, "mar": 3,
    "april": 4, "apr": 4, "may": 5, "june": 6, "jun": 6, "july": 7, "jul": 7,
    "august": 8, "aug": 8, "september": 9, "sep": 9, "sept": 9,
    "october": 10, "oct": 10, "november": 11, "nov": 11, "december": 12, "dec": 12,
}


def _month(token: str) -> int | None:
    value = MONTHS.get((token or "").lower().rstrip("."))
    return value if value and 1 <= value <= 12 else None


def _real_date(year: int, month: int, day: int) -> bool:
    if year < 1900 or year > 2100 or month < 1 or month > 12 or day < 1 or day > 31:
        return False
    try:
        _dt.date(year, month, day)
        return True
    except ValueError:
        return False


def _digits(value: str) -> str:
    return re.sub(r"[^0-9]", "", value or "")


def canonical_dob(value: str) -> str:
    """Mirror server/services/dobKey.ts without guessing ambiguous dates."""
    raw = (value or "").strip()
    if not raw:
        return ""
    m = re.match(r"^(\d{1,2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{4})$", raw)
    if m:
        day, month, year = map(int, m.groups())
        return f"{year:04d}{month:02d}{day:02d}" if day > 12 and _real_date(year, month, day) else _digits(raw)
    m = re.match(r"^(\d{4})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{1,2})$", raw)
    if m:
        year, month, day = map(int, m.groups())
        return f"{year:04d}{month:02d}{day:02d}" if _real_date(year, month, day) else _digits(raw)
    m = re.match(r"^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$", raw)
    if m:
        day, month_text, year = int(m[1]), m[2], int(m[3])
        month = _month(month_text)
        return f"{year:04d}{month:02d}{day:02d}" if month and _real_date(year, month, day) else _digits(raw)
    m = re.match(r"^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$", raw)
    if m:
        month, day, year = _month(m[1]), int(m[2]), int(m[3])
        return f"{year:04d}{month:02d}{day:02d}" if month and _real_date(year, month, day) else _digits(raw)
    m = re.match(r"^(\d{1,2})([A-Za-z]{3,9})\.?(\d{4})$", raw)
    if m:
        day, month, year = int(m[1]), _month(m[2]), int(m[3])
        return f"{year:04d}{month:02d}{day:02d}" if month and _real_date(year, month, day) else _digits(raw)
    m = re.match(r"^(\d{1,2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{2})$", raw)
    if m:
        day, month, short_year = int(m[1]), int(m[2]), int(m[3])
        year = 2000 + short_year if short_year < 30 else 1900 + short_year
        return f"{year:04d}{month:02d}{day:02d}" if day > 12 and _real_date(year, month, day) else _digits(raw)
    m = re.match(r"^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?\s+(\d{2})$", raw)
    if m:
        day, month_text, short_year = int(m[1]), m[2], int(m[3])
        month = _month(month_text)
        year = 2000 + short_year if short_year < 30 else 1900 + short_year
        return f"{year:04d}{month:02d}{day:02d}" if month and _real_date(year, month, day) else _digits(raw)
    return _digits(raw)


def is_reliable_dob(value: str) -> bool:
    """Mirror do bKey.isReliableDob; reject arbitrary digit strings."""
    raw = (value or "").strip()
    if not raw:
        return False
    m = re.match(r"^(\d{1,2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{4})$", raw)
    if m:
        day, month, year = map(int, m.groups())
        return 1 <= day <= 31 and 1 <= month <= 12 and 1900 <= year <= 2100 and (
            day > 12 and _real_date(year, month, day) or _real_date(year, month, day) or _real_date(year, day, month)
        )
    m = re.match(r"^(\d{4})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{1,2})$", raw)
    if m:
        return _real_date(*map(int, m.groups()))
    m = re.match(r"^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$", raw)
    if m:
        return _real_date(int(m[3]), _month(m[2]) or 0, int(m[1]))
    m = re.match(r"^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$", raw)
    if m:
        return _real_date(int(m[3]), _month(m[1]) or 0, int(m[2]))
    m = re.match(r"^(\d{1,2})([A-Za-z]{3,9})\.?(\d{4})$", raw)
    if m:
        return _real_date(int(m[3]), _month(m[2]) or 0, int(m[1]))
    m = re.match(r"^(\d{1,2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{2})$", raw)
    if m:
        day, month, short_year = map(int, m.groups())
        year = 2000 + short_year if short_year < 30 else 1900 + short_year
        return 1 <= day <= 31 and 1 <= month <= 12 and (day > 12 and _real_date(year, month, day) or _real_date(year, month, day) or _real_date(year, day, month))
    m = re.match(r"^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?\s+(\d{2})$", raw)
    if m:
        short_year = int(m[3])
        year = 2000 + short_year if short_year < 30 else 1900 + short_year
        return _real_date(year, _month(m[2]) or 0, int(m[1]))
    return False


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "").strip().lower())


def identity_id(family: str, given: str, dob: str) -> str:
    key = f"{normalize_text(family)}|{normalize_text(given)}|{canonical_dob(dob)}"
    return hashlib.sha256(key.encode("utf-8")).hexdigest()[:16]


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def atomic_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text, encoding="utf-8", newline="\n")
    os.replace(tmp, path)


def _is_licence_candidate(row: dict) -> bool:
    """Rows that are allowed to become user-facing rear evidence.

    Rejected pages never become evidence. Review rows are retained in the
    private review index, but only an explicitly reviewed mixed page can be
    promoted to an identity when --include-review is supplied.
    """
    decision = row.get("decision")
    category = row.get("category")
    if decision == "confirmed":
        return True
    return decision == "review" and category in {"rear_licence", "mixed_licences"}


def _review_is_attachable(row: dict, include_review: bool) -> bool:
    return (
        include_review
        and row.get("decision") == "review"
        and row.get("category") == "mixed_licences"
        and bool(row.get("rear_bbox"))
        and row.get("rear_text_visible") is True
    )


def load_rows(path: Path, include_review: bool) -> tuple[list[dict], Counter]:
    latest: dict[str, dict] = {}
    counts: Counter = Counter()
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                counts["invalid_json"] += 1
                continue
            key = str(row.get("key") or "")
            if key:
                latest[key] = row
    counts["latest_rows"] = len(latest)
    for row in latest.values():
        decision = row.get("decision")
        if _is_licence_candidate(row):
            counts["eligible_rows"] += 1
            if decision == "review":
                counts["review_evidence_rows"] += 1
        else:
            counts[f"skipped_{decision or 'missing'}"] += 1
    return list(latest.values()), counts


def load_db(db_path: Path) -> tuple[dict[str, list[sqlite3.Row]], dict[str, dict], Counter]:
    uri = f"file:{db_path.as_posix()}?mode=ro"
    conn = sqlite3.connect(uri, uri=True, timeout=30)
    conn.row_factory = sqlite3.Row
    counts: Counter = Counter()
    try:
        conn.execute("PRAGMA query_only=ON")
        counts["quick_check"] = 1 if conn.execute("PRAGMA quick_check").fetchone()[0] == "ok" else 0
        by_hash: dict[str, list[sqlite3.Row]] = {}
        for row in conn.execute("SELECT id, filename, original_path, content_hash FROM documents WHERE content_hash IS NOT NULL"):
            by_hash.setdefault(str(row["content_hash"]), []).append(row)
        docs: dict[str, dict] = {}
        for row in conn.execute("SELECT id, latest_extraction_id FROM documents"):
            doc_id = str(row["id"])
            ex_id = row["latest_extraction_id"]
            if not ex_id:
                ex = conn.execute("SELECT id FROM extractions WHERE document_id=? ORDER BY created_at DESC, rowid DESC LIMIT 1", (doc_id,)).fetchone()
                ex_id = ex[0] if ex else None
            if not ex_id:
                counts["documents_without_extraction"] += 1
                continue
            first: dict[str, str] = {}
            for field in conn.execute("SELECT field_name, field_value, corrected_value FROM fields WHERE extraction_id=? ORDER BY rowid", (ex_id,)):
                name = str(field["field_name"])
                if name in (FAMILY_FIELD, GIVEN_FIELD, DOB_FIELD) and name not in first:
                    value = field["corrected_value"] if field["corrected_value"] is not None else field["field_value"]
                    if value is not None and str(value).strip():
                        first[name] = str(value).strip()
            family, given, dob = first.get(FAMILY_FIELD, ""), first.get(GIVEN_FIELD, ""), first.get(DOB_FIELD, "")
            if not family or not dob or not is_reliable_dob(dob):
                counts["documents_unassigned_identity"] += 1
                continue
            docs[doc_id] = {"identityId": identity_id(family, given, dob), "filename": str(row["id"])}
            counts["documents_with_identity"] += 1
        return by_hash, docs, counts
    finally:
        conn.close()


def load_source_hash_map(path: str | None) -> dict[str, str]:
    if not path:
        return {}
    source = Path(path)
    if not source.is_file():
        raise SystemExit(f"source hash map not found: {source}")
    text = source.read_text(encoding="utf-8").strip()
    if not text:
        return {}
    # Accept either a single JSON object or JSONL. JSONL also starts with
    # `{`, so probing json.loads() first (and falling back on failure) avoids
    # misclassifying the 66-row scanner export as one malformed object.
    try:
        raw = json.loads(text)
    except json.JSONDecodeError:
        raw = None
    if isinstance(raw, dict):
        return {str(k): str(v).lower() for k, v in raw.items()}
    if raw is not None:
        raise SystemExit("source hash map JSON must be an object or JSONL")
    out: dict[str, str] = {}
    for line in text.splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        key = row.get("file") or row.get("path") or row.get("source")
        value = row.get("sha256") or row.get("source_sha256") or row.get("hash")
        if key and value:
            out[str(key)] = str(value).lower()
    return out


def copy_asset(src: Path, root: Path, subdir: str, digest: str, apply: bool) -> str:
    rel = Path("assets") / subdir / f"{digest}.jpg"
    dest = root / rel
    if apply:
        dest.parent.mkdir(parents=True, exist_ok=True)
        if dest.exists() and sha256_file(dest) != digest:
            raise RuntimeError(f"asset hash collision: {rel}")
        if not dest.exists():
            shutil.copy2(src, dest)
    return rel.as_posix()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--index", required=True, help="rear scanner index.jsonl or verified.jsonl")
    parser.add_argument("--db", required=True, help="OCRDocs SQLite database (opened read-only)")
    parser.add_argument("--out", required=True, help="rear-licence sidecar output root")
    parser.add_argument("--source-hash-map", help="optional JSON/JSONL map of source path -> full SHA-256 when source bytes stay on the build host")
    parser.add_argument("--apply", action="store_true", help="write/copy assets; default is an aggregate dry-run")
    parser.add_argument("--include-review", action="store_true", help="include explicitly reviewed mixed front+rear pages")
    args = parser.parse_args()
    index, db, out = Path(args.index).resolve(), Path(args.db).resolve(), Path(args.out).resolve()
    if not index.is_file() or not db.is_file():
        raise SystemExit("index and db must be existing files")
    rows, counts = load_rows(index, args.include_review)
    source_hashes = load_source_hash_map(args.source_hash_map)
    by_hash, docs, db_counts = load_db(db)
    records: list[dict] = []
    provenance: list[dict] = []
    seen_occurrences: set[str] = set()
    for row in rows:
        decision = row.get("decision")
        if not _is_licence_candidate(row):
            continue
        source = Path(str(row.get("file") or ""))
        card = Path(str(row.get("card_image") or ""))
        page_image = Path(str(row.get("page_image") or ""))
        if not card.is_file() or not page_image.is_file():
            counts["missing_rear_asset"] += 1
            continue
        try:
            source_hash = source_hashes.get(str(source), "")
            if source.is_file():
                computed_source_hash = sha256_file(source)
                if source_hash and source_hash != computed_source_hash:
                    counts["source_hash_map_mismatch"] += 1
                    continue
                source_hash = computed_source_hash
            card_hash, page_hash = sha256_file(card), sha256_file(page_image)
        except OSError:
            counts["asset_read_error"] += 1
            continue

        matches = by_hash.get(source_hash, []) if source_hash else []
        document_id: str | None = None
        document_name = ""
        identity: dict | None = None
        if len(matches) == 1:
            document_id = str(matches[0]["id"])
            document_name = str(matches[0]["filename"])
            identity = docs.get(document_id)
        elif source_hash:
            counts["ambiguous_or_unmatched_document"] += 1
        else:
            counts["missing_source_hash"] += 1

        # A confirmed page without a unique, currently-grouped document is
        # retained as unassigned/review evidence. It is never allowed to enter
        # an identity gallery. This is what makes uncertain images reviewable
        # instead of silently disappearing.
        attachable = decision == "confirmed" or _review_is_attachable(row, bool(args.include_review))
        if identity and attachable:
            assignment_state = "assigned"
            counts["attached_evidence"] += 1
        elif decision == "review":
            assignment_state = "needs_review"
            counts["review_evidence"] += 1
        else:
            assignment_state = "unassigned"
            counts["unassigned_evidence"] += 1
        verification_state = "verified" if decision == "confirmed" else "needs_review"
        if document_id is None:
            counts["unlinked_evidence"] += 1

        page = int(row.get("page") or 1)
        part = str(row.get("part") or "")
        # The source hash is deliberately not emitted in the API index. It is
        # only an input to the stable occurrence key so identical pages cannot
        # be shown twice after a re-scan.
        occurrence_source = source_hash or f"unlinked:{source}|{card_hash}"
        occurrence = hashlib.sha256(f"{occurrence_source}|{page}|{part}|{card_hash}".encode()).hexdigest()
        if occurrence in seen_occurrences:
            counts["duplicate_occurrence"] += 1
            continue
        seen_occurrences.add(occurrence)
        card_rel = copy_asset(card, out, "cards", card_hash, args.apply)
        page_rel = copy_asset(page_image, out, "pages", page_hash, args.apply)
        record = {
            "occurrenceKey": occurrence,
            "documentId": document_id,
            "identityId": identity["identityId"] if identity and attachable else None,
            "assignmentState": assignment_state,
            "verificationState": verification_state,
            "document": document_name,
            "page": page,
            "part": part,
            "cardAsset": card_rel,
            "pageAsset": page_rel,
            "cardSha256": card_hash,
            "pageSha256": page_hash,
            "bbox": row.get("rear_bbox") if isinstance(row.get("rear_bbox"), list) else [],
            "modelDecision": decision,
            "modelConfidence": row.get("vision_confidence"),
        }
        records.append(record)
        provenance.append({**record, "sourcePath": str(source), "sourceSha256": source_hash})
    records.sort(key=lambda r: (r["document"].lower(), r["page"], r["part"], r["occurrenceKey"]))
    provenance.sort(key=lambda r: (r["document"].lower(), r["page"], r["part"], r["occurrenceKey"]))
    if args.apply:
        atomic_write(out / "index.jsonl", "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in records))
        atomic_write(out / "provenance.jsonl", "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in provenance))
    report = {
        "mode": "apply" if args.apply else "dry-run",
        "index": str(index),
        "database": str(db),
        "counts": {**dict(sorted(counts.items())), **dict(sorted(db_counts.items()))},
        "emitted": len(records),
        "include_review": bool(args.include_review),
        "assets": {"cards": len({r["cardSha256"] for r in records}), "pages": len({r["pageSha256"] for r in records})},
    }
    if args.apply:
        atomic_write(out / "report.json", json.dumps(report, indent=2, sort_keys=True) + "\n")
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

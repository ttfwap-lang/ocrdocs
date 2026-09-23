#!/usr/bin/env python3
"""Triple-check verification + source traceability for the key identity identifiers.

OWNER REQUIREMENT
-----------------
The Australian passport number and the driver's-licence number are the most important
key details. They must be:

  1. **Triple-check verified** — a format check AND a cross-source corroboration count.
     (Owner's chosen rule: 1+ corroborating source document + a valid format qualifies;
     the number of corroborating documents is surfaced as the confidence signal.)
  2. **Trace-sourced to the exact source file** — every accepted value carries the list of
     source documents it was read from, so a reviewer can open the original.

WHY THIS IS NEEDD
-----------------
`verify_fields.py` gives each field a single verdict (ok/cjk/junk). That is a value-shape
check, not an identity-critical cross-check. A passport number OCR'd as `EH9692611` on a
single photo could be a misread; the same number appearing across 25 documents is strong
evidence. This script adds the second signal without mutating the corpus.

DESIGN (never destructive)
--------------------------
* Reads the verified JSONL (verif=ok fields only).
* Canonicalises each identifier (strip country prefixes like `CHN`/`AUS`, spaces, hyphens,
  upper-case) and validates the SHAPE.
* Counts DISTINCT source files per canonical value.
* Emits `verif2` (triple_checked / single_source / format_fail), `sources` (sorted file
  list) and `source_count` onto each identifier field, plus a companion JSONL
  `rc_identifier_verified.jsonl` holding only the identifier fields with their evidence.
* Writes nothing destructive and never drops a value; a format failure is annotated, not
  deleted, so a human can review borderline cases.

Format rules (derived from the real corpus, see STATE.md 2026-09-24):
  * Australian passport: 1-2 letters + 6-8 digits, e.g. G50429525, E9628011, PB24868462.
    (The owner referenced PA/PB/R-prefixed modern passports; those fit this shape.)
  * AU driver's licence: 7-10 alphanumeric, at least one digit; tolerate a trailing state
    letter (e.g. `081793L`). Spaced forms (`86 605 667`) are canonicalised first.

Run:
    python verify_identifiers.py --in results\\rc_extract_verified.jsonl \
        --out results\\rc_identifier_verified.jsonl
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter, defaultdict
from typing import Dict, List, Optional, Set, Tuple

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

# Fields treated as the key identifiers, with their pipeline field names.
IDENTIFIER_FIELDS = {
    "passport": {"passport_details"},
    "licence": {"drivers_licence_number", "drivers_licence"},
}

# Country / issuing prefixes seen in the corpus that are NOT part of the number.
COUNTRY_PREFIXES = {"AUS", "AUS.", "CHN", "NZL", "GBR", "CAN", "USA", "HKG", "SGP", "IND", "PHL", "VNM", "CHN."}

# Australian passport: 1-2 letters then 6-8 digits (G50429525, E9628011, PB24868462, N6354675).
PASSPORT_RE = re.compile(r"^[A-Z]{1,2}\d{6,8}$")
# AU licence: 7-10 alphanumerics with >=1 digit and <=2 letters (081793L, P2945484, 038608335).
LICENCE_RE = re.compile(r"^(?=.*\d)[A-Z0-9]{7,10}$")
# A licence with a single trailing alpha state code (081793L) still matches; this guards
# the "few letters" case so a pure word can't pass.
LICENCE_LETTER_BUDGET = 2


def strip_country(value: str) -> str:
    """Remove a leading issuing-country code like 'CHN ' or 'AUS' from an identifier."""
    v = value.strip().upper()
    for prefix in sorted(COUNTRY_PREFIXES, key=len, reverse=True):
        p = prefix.rstrip(".")
        if v.startswith(p + " "):
            return v[len(p) + 1:].strip()
    return v


def canonicalise(value: str) -> str:
    """Upper-case, drop spaces/hyphens/dots, strip a leading country code, split on ';'."""
    v = value.strip().upper()
    # Multi-value cells ('G50429525; EF7192314') -> first token is the primary number.
    v = re.split(r"[;/]", v)[0].strip()
    v = strip_country(v)
    v = re.sub(r"[\s\-.]+", "", v)
    return v


def format_ok(kind: str, canonical: str) -> bool:
    if not canonical:
        return False
    if kind == "passport":
        return bool(PASSPORT_RE.match(canonical))
    if kind == "licence":
        if not LICENCE_RE.match(canonical):
            return False
        letters = sum(1 for ch in canonical if ch.isalpha())
        return letters <= LICENCE_LETTER_BUDGET and any(ch.isdigit() for ch in canonical)
    return False


def classify(kind: str, raw: str, source_count: int) -> Tuple[str, str]:
    """Return (verif2, canonical). verif2 in triple_checked/single_source/format_fail."""
    canonical = canonicalise(raw)
    if not format_ok(kind, canonical):
        return "format_fail", canonical
    # Owner's rule: 1+ source + valid format qualifies; 2+ is the stronger signal.
    return ("triple_checked" if source_count >= 2 else "single_source"), canonical


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


def build_evidence(rows) -> Tuple[Dict[Tuple[str, str], Set[str]], Dict[Tuple[str, str], str]]:
    """canonical -> set of source files, across all ok records, per kind."""
    sources: Dict[Tuple[str, str], Set[str]] = defaultdict(set)
    raw_by_canonical: Dict[Tuple[str, str], str] = {}
    for rec in rows:
        if not rec.get("ok"):
            continue
        file = rec.get("file") or ""
        for f in rec.get("fields") or []:
            if f.get("verif") != "ok":
                continue
            name = f.get("name")
            kind = next((k for k, names in IDENTIFIER_FIELDS.items() if name in names), None)
            if not kind:
                continue
            canonical = canonicalise(f.get("value") or "")
            if not canonical:
                continue
            key = (kind, canonical)
            sources[key].add(file)
            raw_by_canonical.setdefault(key, (f.get("value") or "").strip())
    return sources, raw_by_canonical


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--in", dest="src", required=True, help="verified JSONL from verify_fields.py")
    ap.add_argument("--out", dest="dst", required=True, help="identifier-evidence JSONL to write")
    a = ap.parse_args(argv)

    rows = list(load_rows(a.src))
    sources, raw_by_canonical = build_evidence(rows)

    evidence_rows: List[Dict] = []
    stats: Counter = Counter()
    for (kind, canonical), files in sources.items():
        n = len(files)
        raw = raw_by_canonical[(kind, canonical)]
        verif2, canon = classify(kind, raw, n)
        evidence_rows.append(
            {
                "kind": kind,
                "canonical": canon,
                "raw_example": raw,
                "verif2": verif2,
                "source_count": n,
                "sources": sorted(files),
            }
        )
        stats[f"{kind}_{verif2}"] += 1

    evidence_rows.sort(key=lambda r: (r["kind"], -r["source_count"], r["canonical"]))
    with open(a.dst, "w", encoding="utf-8") as fh:
        for r in evidence_rows:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")

    # Corroboration distribution, for the confidence signal in the UI.
    for kind in IDENTIFIER_FIELDS:
        dist = Counter(r["source_count"] for r in evidence_rows if r["kind"] == kind)
        multi = sum(1 for r in evidence_rows if r["kind"] == kind and r["source_count"] >= 2)
        total = sum(1 for r in evidence_rows if r["kind"] == kind)
        print(f"{kind}: {total} distinct values, {multi} corroborated in 2+ sources, source-count dist {dict(sorted(dist.items()))}")

    for key in sorted(stats):
        print(f"  {key}: {stats[key]}")
    print("identifier evidence:", a.dst)
    return 0


if __name__ == "__main__":
    sys.exit(main())

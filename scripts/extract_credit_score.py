#!/usr/bin/env python3
"""Extract the Equifax One Score from recovered credit-report documents.

WHY A TEXT-LAYER EXTRACTOR INSTEAD OF A RE-PARSE
------------------------------------------------
The bulk LlamaParse run captured structured fields but the extraction schema had no
credit-score field, so 12+ Equifax reports sit in the corpus with a score on the page
that was never stored. The PDFs carry a text layer, so the score is recoverable for free
without spending parse credits or touching the vendor's copy of the data.

DISCRIMINATION (the important part)
-----------------------------------
An Equifax report page contains THREE numbers that are easy to confuse:

    Equifax One Score          <- this is the one we want
    Comprehensive Score: 785   <- a different score, explicitly labelled
    VedaScore 1.1: 697         <- a different score, explicitly labelled

and the document TITLE is "Equifax Apply One Score", which is not a score at all. The
extractor anchors on the literal heading `Equifax One Score` followed by the bare value
on the next line, and explicitly refuses a `Comprehensive`/`VedaScore` match. Values are
range-checked (Australian bureaus span 200-1200).

Output is JSONL: one line per source file with the score, the bureau, and the source
path, so the loader can trace every score back to the exact file.

Run:
    python extract_credit_score.py --root "C:\\Users\\<you>\\Desktop\\Recovered_C" \
        --out data\\credit_scores.jsonl
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import List, Optional

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

MIN_SCORE, MAX_SCORE = 200, 1200

# "Equifax One Score" (heading) then the bare score on the next line.
ONE_SCORE_NL = re.compile(
    r"(?:equifax\s+one\s+score|apply\s+one\s+score)\s*[\r\n]+\s*[:：]?\s*(\d{3,4})\b", re.I)
# Inline "Credit score: NNN" that is NOT labelled comprehensive/veda.
CREDIT_INLINE = re.compile(
    r"credit\s*score\s*(?:is|of|:)?\s*(\d{3,4})\b\s*(?:/\s*(?:900|1000|1200)|out\s*of\s*(?:900|1000|1200))?", re.I)
# Scores that are explicitly a DIFFERENT product; captured so they can be reported/rejected.
OTHER_TYPED = re.compile(
    r"(comprehensive\s+score|vedascore(?:\s*1\.1)?|experian\s+score|illion\s*score)\s*(?:is|of|:)?\s*(\d{3,4})", re.I)
BARE_DENOM = re.compile(r"\b(\d{3,4})\s*/\s*(?:900|1000|1200)\b", re.I)

CREDIT_FILE_HINTS = ("quifax", "credit report", "credit_report", "credit savvy", "apply one score")


def in_range(value: str) -> bool:
    try:
        n = int(value)
    except ValueError:
        return False
    return MIN_SCORE <= n <= MAX_SCORE


def equifax_one_score(text: str) -> Optional[str]:
    """Return the Equifax One Score, or None. Never returns Comprehensive/Veda/Experian."""
    for m in ONE_SCORE_NL.finditer(text):
        if in_range(m.group(1)):
            return m.group(1)
    for m in CREDIT_INLINE.finditer(text):
        if not in_range(m.group(1)):
            continue
        ctx = text[max(0, m.start() - 40):m.start()].lower()
        if "vedascore" in ctx or "comprehensive" in ctx or "experian" in ctx:
            continue
        return m.group(1)
    return None


def other_scores(text: str) -> List[tuple]:
    return [(m.group(1).lower(), m.group(2)) for m in OTHER_TYPED.finditer(text) if in_range(m.group(2))]


def read_text(path: Path, max_pages: int = 3) -> str:
    if path.suffix.lower() == ".txt":
        return path.read_text(encoding="utf-8", errors="replace")
    if path.suffix.lower() != ".pdf":
        return ""
    try:
        import pypdfium2 as pdfium
    except ImportError:
        return ""
    try:
        doc = pdfium.PdfDocument(str(path))
        text = "\n".join(doc[i].get_textpage().get_text_bounded() for i in range(min(max_pages, len(doc))))
        doc.close()
        return text
    except Exception:
        return ""


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--root", default=r"C:\Users\lnxzf\Desktop\Recovered_C", help="corpus root")
    ap.add_argument("--out", required=True, help="output JSONL")
    a = ap.parse_args(argv)

    root = Path(a.root)
    files: List[Path] = []
    seen: set = set()
    for p in root.rglob("*"):
        if not p.is_file() or p.suffix.lower() not in (".pdf", ".txt"):
            continue
        low = p.name.lower()
        if any(h in low for h in CREDIT_FILE_HINTS) and p not in seen:
            files.append(p)
            seen.add(p)

    found = 0
    with open(a.out, "w", encoding="utf-8") as fh:
        for p in sorted(files):
            text = read_text(p)
            if not text:
                continue
            score = equifax_one_score(text)
            others = other_scores(text)
            if not score:
                continue
            found += 1
            fh.write(json.dumps({
                "source": str(p),
                "filename": p.name,
                "credit_score": score,
                "bureau": "Equifax",
                "product": "Equifax One Score",
                "other_scores_seen": [{"type": t, "value": v} for t, v in others],
            }, ensure_ascii=False) + "\n")

    print(f"scanned {len(files)} credit-report files, extracted {found} scores -> {a.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

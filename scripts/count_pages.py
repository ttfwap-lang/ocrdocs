#!/usr/bin/env python3
"""Page-count pass: how many pages does each document have, so the bulk run can go smallest-first.

- pdf  -> pypdfium2 (the repo's sanctioned parser) page count. Corrupt files are counted as 1 and flagged.
- images (png/jpg/jpeg/tif/tiff/webp/bmp) -> 1 page.
- docx -> estimate from the word count in word/document.xml (~350 words/page), minimum 1.
- anything else -> 1.

Writes --out-counts (rc_page_counts.jsonl: {file, pages, estimate}) and --out-list (paths only, sorted by
pages ascending, ties by path) that you hand to llamaparse_bulk.py --list.

Run:  python count_pages.py --list results\\rc_llamacloud_list.txt --out-list results\\rc_llamacloud_list_by_pages.txt
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import zipfile
from collections import Counter
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

import pypdfium2 as pdfium  # Apache-2.0, the sanctioned parser (fitz/PyMuPDF is deliberately not used)

IMAGES = {".png", ".jpg", ".jpeg", ".tif", ".tiff", ".webp", ".bmp"}
WORDS_PER_PAGE = 350


def docx_words(path: str) -> Optional[int]:
    try:
        with zipfile.ZipFile(path) as z:
            xml = z.read("word/document.xml").decode("utf-8", "ignore")
        text = re.sub(r"<[^>]+>", " ", xml)
        return len(re.findall(r"\S+", text))
    except Exception:  # noqa: BLE001 - any unreadable docx just falls back to the estimate
        return None


def pages_of(path: str) -> tuple:
    """Returns (pages, estimate: bool, error: Optional[str])."""
    ext = Path(path).suffix.lower()
    if ext == ".pdf":
        try:
            doc = pdfium.PdfDocument(path)
            try:
                n = len(doc)
            finally:
                doc.close()
            return (max(1, int(n)), False, None)
        except Exception as e:  # noqa: BLE001 - a corrupt pdf still gets extracted; LlamaCloud may do better
            return (1, True, f"{type(e).__name__}: {e}"[:200])
    if ext in IMAGES:
        return (1, False, None)
    if ext == ".docx":
        w = docx_words(path)
        if w:
            return (max(1, -(-w // WORDS_PER_PAGE)), True, None)
        return (1, True, "unreadable docx")
    return (1, True, "unsupported type")


def collect(list_file: Optional[str], folder: Optional[str]) -> list:
    paths = []
    if list_file:
        paths += [l.strip().strip('"') for l in Path(list_file).read_text(encoding="utf-8").splitlines() if l.strip()]
    if folder:
        paths += [str(p) for p in sorted(Path(folder).rglob("*")) if p.is_file()]
    seen, out = set(), []
    for p in paths:
        if p in seen or not os.path.isfile(p):
            continue
        seen.add(p)
        out.append(p)
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Page-count pass: sort the send list by number of pages (smallest first).")
    ap.add_argument("--list", help="text file with one document path per line")
    ap.add_argument("--folder", help="a folder tree of documents")
    ap.add_argument("--out-list", required=True, help="sorted list file (paths only) for llamaparse_bulk.py --list")
    ap.add_argument("--out-counts", help="optional JSONL of {file, pages, estimate, error}")
    a = ap.parse_args(argv)

    files = collect(a.list, a.folder)
    if not files:
        ap.error("no files found (give --list or --folder)")
    rows = []
    for p in files:
        npages, estimate, err = pages_of(p)
        rows.append({"file": p, "pages": npages, "estimate": estimates_flag(estimate, err), "error": err})
    rows.sort(key=lambda r: (r["pages"], r["file"]))
    with open(a.out_list, "w", encoding="utf-8") as fh:
        for r in rows:
            fh.write(r["file"] + "\n")
    if a.out_counts:
        with open(a.out_counts, "w", encoding="utf-8") as fh:
            for r in rows:
                fh.write(json.dumps(r, ensure_ascii=False) + "\n")
    dist = Counter(r["pages"] for r in rows)
    total = sum(r["pages"] for r in rows)
    flagged = [r for r in rows if r["error"]]
    print(f"{len(rows)} files, {total} total pages; page distribution: " +
          ", ".join(f"{k}p:{v}" for k, v in sorted(dist.items())[:12]) +
          (" ..." if len(dist) > 12 else ""))
    print(f"flagged (unreadable/unsupported, counted as 1): {len(flagged)}")
    for r in flagged[:10]:
        print(f"  {r['file']}  [{r['error']}]")
    print(f"sorted list (pages ascending): {a.out_list}")
    return 0


def estimates_flag(estimate: bool, err):
    if err:
        return err
    if estimate:
        return True
    return None


if __name__ == "__main__":
    sys.exit(main())
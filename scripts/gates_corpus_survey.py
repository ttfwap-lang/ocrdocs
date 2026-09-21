"""Corpus survey of the S1/S2 gates: how many files a low-resolution Tesseract probe could park BEFORE any reader or cloud call.

Local only: nothing is sent anywhere, no page image or text is written to disk. The output file holds only per-file
decisions and counts (document id, page counts, confidence, which label patterns matched by NAME), mode 0600.

  python gates_corpus_survey.py --db /home/flak3dd/ocrdocs/data/app.db --out survey.json --long-side 700 --workers 6

Without a page classifier the survey cannot know a page is printed, so "would_clear_if_printed" is an UPPER bound on what
S2 could park; handwritten pages would be kept.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
import sys
import time
from collections import Counter
from multiprocessing import Pool
from pathlib import Path

os.environ.setdefault("NVME_ROOT", "/tmp/gates_survey_nvme")  # the engine creates its directory layout at import time
sys.path.insert(0, str(Path(__file__).resolve().parent))

IMG = {".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff", ".bmp"}
MAX_PAGES = 3
_PATTERNS = None
_LONG = 700


def _init(long_side: int):
    global _PATTERNS, _LONG
    import ocr_gates
    ocr_gates.PROBE_LONG_SIDE = long_side
    _LONG = long_side
    try:
        import ocr_spark_engine as eng
        _PATTERNS = eng.BANK_FIELD_PATTERNS
    except Exception as e:  # noqa: BLE001 - fall back to value shapes only, and say so in the output
        print("could not import the engine's label patterns:", type(e).__name__, file=sys.stderr)
        _PATTERNS = {}


def _pages(path: str):
    from PIL import Image
    ext = Path(path).suffix.lower()
    if ext == ".pdf":
        import pypdfium2 as pdfium
        doc = pdfium.PdfDocument(path)
        for i in range(min(len(doc), MAX_PAGES)):
            page = doc[i]
            w, h = page.get_size()
            yield page.render(scale=_LONG / max(w, h)).to_pil().convert("RGB")
        doc.close()
    else:
        im = Image.open(path)
        im.draft("RGB", (_LONG * 2, _LONG * 2))
        im = im.convert("RGB")
        im.thumbnail((_LONG, _LONG))
        yield im


def survey_one(row):
    doc_id, path = row
    import ocr_gates
    t = time.time()
    try:
        probes, inks = [], []
        for im in _pages(path):
            inks.append(ocr_gates.ink_ratio(im))
            probes.append(ocr_gates.probe_page(im, image_to_osd=lambda _: ""))
        if not probes:
            return {"id": doc_id, "status": "no_pages"}
        hits = sorted({h for p in probes for h in ocr_gates.regex_hits(p.text, _PATTERNS)})
        conf, alnum = min(p.conf for p in probes), min(p.alnum for p in probes)
        if max(inks) <= 0.004:
            status = "blank"
        elif sum(p.alnum for p in probes) < 10:
            status = "no_text"
        elif conf < ocr_gates.MIN_PROBE_CONF or alnum < ocr_gates.MIN_PROBE_ALNUM:
            status = "poor_text"
        elif hits:
            status = "has_matches"
        else:
            status = "would_clear_if_printed"
        return {"id": doc_id, "status": status, "pages": len(probes), "min_conf": round(conf, 2), "min_alnum": alnum,
                "hits": hits, "secs": round(time.time() - t, 2)}
    except Exception as e:  # noqa: BLE001 - unreadable files are a category, not a crash
        return {"id": doc_id, "status": "error", "error": type(e).__name__}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--long-side", type=int, default=700)
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--limit", type=int, default=0)
    a = ap.parse_args()
    con = sqlite3.connect(f"file:{a.db}?mode=ro", uri=True)
    rows = [(i, p) for i, p in con.execute("select id, original_path from documents")
            if Path(p).suffix.lower() in IMG | {".pdf"} and os.path.exists(p)]
    if a.limit:
        rows = rows[: a.limit]
    print(f"surveying {len(rows)} image/PDF files at long side {a.long_side}px with {a.workers} workers", flush=True)
    t0, results = time.time(), []
    with Pool(a.workers, initializer=_init, initargs=(a.long_side,)) as pool:
        for n, r in enumerate(pool.imap_unordered(survey_one, rows, chunksize=8), 1):
            results.append(r)
            if n % 250 == 0:
                print(f"  {n}/{len(rows)} {time.time() - t0:.0f}s", flush=True)
    counts = Counter(r["status"] for r in results)
    fd = os.open(a.out, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump({"long_side": a.long_side, "files": len(results), "counts": counts, "results": results}, f)
    print("DONE", f"{time.time() - t0:.0f}s", dict(counts), flush=True)


if __name__ == "__main__":
    main()

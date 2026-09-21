"""Sample document pages for the DenseNet triage model.

Reads the app DB read-only, picks a stratified sample of image/PDF pages (at most PAGES_PER_DOC per document so one
long statement cannot dominate), renders each to a PNG, and splits train/val/test BY DOCUMENT so no document straddles
two splits. Writes <out>/pages/*.png and <out>/meta.jsonl. Nothing here touches the originals.

  python triage_sample.py --db /home/flak3dd/ocrdocs/data/app.db --out /home/flak3dd/triage --n 1500
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import random
import sqlite3
from collections import defaultdict
from pathlib import Path

import pypdfium2 as pdfium
from PIL import Image

PAGES_PER_DOC = 6
MAX_SIDE = 1600
RENDER_DPI = 150
EXTS = {".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff", ".bmp", ".pdf"}


def split_of(doc_id: str) -> str:
    """Deterministic 80/10/10 split from the document id, so re-runs never move a document between splits."""
    h = int(hashlib.sha256(doc_id.encode()).hexdigest(), 16) % 100
    return "train" if h < 80 else "val" if h < 90 else "test"


def fit(img: Image.Image) -> Image.Image:
    img = img.convert("RGB")
    if max(img.size) > MAX_SIDE:
        img.thumbnail((MAX_SIDE, MAX_SIDE), Image.Resampling.LANCZOS)
    return img


def render_pages(path: str, want: int, rng: random.Random):
    ext = Path(path).suffix.lower()
    if ext == ".pdf":
        doc = pdfium.PdfDocument(path)
        n = len(doc)
        idx = sorted(rng.sample(range(n), min(want, n)))
        for i in idx:
            yield i, fit(doc[i].render(scale=RENDER_DPI / 72).to_pil())
        doc.close()
    else:
        img = Image.open(path)
        img.draft("RGB", (MAX_SIDE * 2, MAX_SIDE * 2))
        yield 0, fit(img)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--n", type=int, default=1500)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--bakeoff", help="manifest.json from the bake-off; its pages are always included")
    a = ap.parse_args()

    rng = random.Random(a.seed)
    out = Path(a.out)
    (out / "pages").mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(f"file:{a.db}?mode=ro", uri=True)
    rows = [(i, p) for i, p in con.execute("select id, original_path from documents") if Path(p).suffix.lower() in EXTS and os.path.exists(p)]
    by_ext = defaultdict(list)
    for r in rows:
        by_ext[Path(r[1]).suffix.lower()].append(r)
    print("candidates by extension:", {k: len(v) for k, v in sorted(by_ext.items())})

    meta = []

    def add(doc_id, page, img, src, origin):
        name = f"{doc_id[:8]}_{page}.png"
        img.save(out / "pages" / name)
        meta.append({"file": name, "doc_id": doc_id, "page": page, "src": src, "split": split_of(doc_id), "origin": origin})

    if a.bakeoff and os.path.exists(a.bakeoff):
        for doc_id, m in json.load(open(a.bakeoff)).items():
            for i, p in enumerate(m.get("pages", [])):
                try:
                    add(doc_id, i, fit(Image.open(p)), m.get("src", p), "bakeoff")
                except Exception as e:  # noqa: BLE001 - a missing bake-off page must not abort the sample
                    print("skip bakeoff page", p, e)
    seen = {m["doc_id"] for m in meta}

    # Round-robin over extensions so rare types (pdf, tif) are represented, not swamped by jpg.
    pools = {k: rng.sample(v, len(v)) for k, v in by_ext.items()}
    while len(meta) < a.n and any(pools.values()):
        for ext in list(pools):
            if len(meta) >= a.n:
                break
            if not pools[ext]:
                continue
            doc_id, path = pools[ext].pop()
            if doc_id in seen:
                continue
            seen.add(doc_id)
            try:
                for page, img in render_pages(path, PAGES_PER_DOC, rng):
                    add(doc_id, page, img, path, ext)
            except Exception as e:  # noqa: BLE001 - corrupt files are common in this corpus; skip and count
                print("skip", path, type(e).__name__, str(e)[:80])

    with open(out / "meta.jsonl", "w") as f:
        for m in meta:
            f.write(json.dumps(m) + "\n")
    by_split = defaultdict(int)
    for m in meta:
        by_split[m["split"]] += 1
    print(f"wrote {len(meta)} pages from {len(seen)} documents; splits {dict(by_split)}")


if __name__ == "__main__":
    main()

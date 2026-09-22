"""Find which files in a corpus mention given words (default MEDICARE, LICENCE/LICENSE, PASSWORD). Read-only, local only.

Uses tidy_corpus's rules to skip files tidy_corpus would set aside (executables, corrupt, blank, tiny...), so a search for
"password" is not drowned by DLLs and random-byte blobs. Records only WHICH word matched and HOW MANY times, never the
surrounding text, so the output does not become a list of the secrets it found. Keep the output files private anyway.

Searches: the file name; raw bytes as ASCII and UTF-16 (text, xml, html, hl7, rtf, .msg, ...); the text inside .docx/.xlsx/
.pptx; the text layer of PDFs (needs pypdfium2). Images and scanned PDFs have no text layer: they are counted as
"not searchable" (OCR them with the pipeline first). Case-insensitive.

  python tidy_search.py ROOT [ROOT ...] --out hits.jsonl [--words medicare,licen[cs]e,password] [--workers 6]
Also writes hits.paths.txt (one path per line, usable as --list for llamaparse_bulk.py).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import threading
import zipfile
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Dict, List, Optional, Tuple

sys.path.insert(0, str(Path(__file__).resolve().parent))
import tidy_corpus as tc  # noqa: E402

DEFAULT_WORDS = ["medicare", "licen[cs]e", "password"]
ZIP_TEXT = {"docx", "xlsx", "pptx", "odt", "ods"}
RAW_EXT = tc.TEXTLIKE | tc.MEDICAL_EXT | {"eml", "md", "csv", "html", "htm", "log", "ini", "cfg", "yaml", "yml", "sql"}
SEARCH_EXT = RAW_EXT | ZIP_TEXT | {"pdf"}
MAX_BYTES = 200 * 1024 * 1024
MAX_PDF_PAGES = 300
CHUNK = 8 * 1024 * 1024


def compile_patterns(words: List[str]) -> Dict[str, Tuple[re.Pattern, re.Pattern]]:
    """Per word: an ASCII byte pattern and a UTF-16-LE one (a NUL after each character)."""
    out = {}
    for w in words:
        a = w.encode("ascii")
        # UTF-16-LE: put \x00 after every literal char and after every character class
        u = re.sub(rb"(\[[^\]]+\]|\\.|[^\[\\])", lambda m: m.group(1) + rb"\x00", a)
        out[w] = (re.compile(a, re.I), re.compile(u, re.I))
    return out


def count_bytes(data: bytes, pats) -> Counter:
    c: Counter = Counter()
    for w, (pa, pu) in pats.items():
        n = len(pa.findall(data)) + len(pu.findall(data))
        if n:
            c[w] = n
    return c


def count_stream(path: str, pats, overlap: int = 64) -> Counter:
    c: Counter = Counter()
    tail = b""
    with open(path, "rb") as f:
        while True:
            chunk = f.read(CHUNK)
            if not chunk:
                break
            buf = tail + chunk
            c.update(count_bytes(buf, pats))
            if tail:  # matches wholly inside the carried-over tail were already counted last round
                c.subtract(count_bytes(tail, pats))
            tail = buf[-overlap:]
    return +c


def zip_text(path: str) -> bytes:
    parts = []
    with zipfile.ZipFile(path) as z:
        for n in z.namelist():
            if n.endswith(".xml") and (n.startswith(("word/", "xl/", "ppt/")) or n in ("content.xml",)):
                parts.append(re.sub(rb"<[^>]+>", b" ", z.read(n)))
    return b"\n".join(parts)


_PDF_LOCK = threading.Lock()  # pdfium is not thread-safe: concurrent use made ~99% of PDFs fail


def pdf_text(path: str) -> Optional[bytes]:
    try:
        import pypdfium2 as pdfium
    except ImportError:
        return None
    with _PDF_LOCK:
        doc = pdfium.PdfDocument(path)
        try:
            out = []
            for i in range(min(len(doc), MAX_PDF_PAGES)):
                page = doc[i]
                tp = page.get_textpage()
                out.append(tp.get_text_bounded())
                tp.close()
                page.close()
            return "\n".join(out).encode("utf-8", "ignore")
        finally:
            doc.close()


OCR_ENABLED = False
MAX_OCR_PAGES = 12
OCR_SIDE = 3000  # long side in pixels; enough for 10-pt print at A4, bounded so a 130-megapixel scan cannot stall a worker


def _prep(im):
    from PIL import Image
    im = im.convert("L")
    im.thumbnail((OCR_SIDE, OCR_SIDE), Image.Resampling.LANCZOS)
    return im


def ocr_text(images) -> bytes:
    import pytesseract
    return "\n".join(pytesseract.image_to_string(im, lang="eng", config="--psm 3", timeout=120) for im in images).encode("utf-8", "ignore")


def ocr_pdf(path: str) -> bytes:
    import pypdfium2 as pdfium
    imgs = []
    with _PDF_LOCK:  # render under the lock (pdfium), OCR outside it
        doc = pdfium.PdfDocument(path)
        try:
            for i in range(min(len(doc), MAX_OCR_PAGES)):
                page = doc[i]
                w, h = page.get_size()
                imgs.append(_prep(page.render(scale=min(3.0, OCR_SIDE / max(w, h))).to_pil()))
                page.close()
        finally:
            doc.close()
    return ocr_text(imgs)


def ocr_image(path: str) -> bytes:
    from PIL import Image
    with Image.open(path) as im:
        im.draft("L", (OCR_SIDE * 2, OCR_SIDE * 2))
        return ocr_text([_prep(im)])


def search_one(path: str, root: str, pats) -> dict:
    ext = tc.ext_of(path)
    hits: Counter = Counter()
    via: List[str] = []
    n = count_bytes(os.path.basename(path).encode("utf-8", "ignore"), pats)
    if n:
        hits.update(n)
        via.append("name")
    note = None
    try:
        if ext in ZIP_TEXT:
            n = count_bytes(zip_text(path), pats)
            via.append("docx") if n else None
        elif ext in tc.IMAGE_EXT:
            n = count_bytes(ocr_image(path), pats)
            via.append("ocr") if n else None
        elif ext == "pdf":
            text = pdf_text(path)
            if text is None:
                note = "pdf_no_pypdfium2"
                n = Counter()
            elif not text.strip():
                if OCR_ENABLED:
                    n = count_bytes(ocr_pdf(path), pats)
                    via.append("ocr") if n else None
                else:
                    note = "pdf_no_text_layer"
                    n = Counter()
            else:
                n = count_bytes(text, pats)
                via.append("pdf") if n else None
        else:
            n = count_stream(path, pats)
            via.append("bytes") if n else None
        hits.update(n)
    except Exception as e:  # noqa: BLE001 - one unreadable file must not stop a corpus search
        note = "pdf_password_protected" if "password" in str(e).lower() else f"error:{type(e).__name__}"
    return {"file": path, "root": root, "words": dict(hits), "via": via, "note": note}


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description="Which files mention MEDICARE / LICENCE / PASSWORD (read-only).")
    ap.add_argument("roots", nargs="+")
    ap.add_argument("--out", required=True)
    ap.add_argument("--words", default=",".join(DEFAULT_WORDS), help="comma-separated regex-lite words (ASCII)")
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--quarantine", default="", help="folder to skip (an existing tidy_corpus quarantine)")
    ap.add_argument("--ocr", action="store_true", help="also OCR images and PDFs with no text layer (local Tesseract, slow)")
    a = ap.parse_args(argv)
    global OCR_ENABLED
    OCR_ENABLED = a.ocr
    if a.ocr:
        os.environ.setdefault("OMP_THREAD_LIMIT", "1")  # one thread per Tesseract: parallelism comes from the workers
    words =[w.strip().lower() for w in a.words.split(",") if w.strip()]
    pats = compile_patterns(words)
    roots = [os.path.realpath(r) for r in a.roots]
    todo: List[Tuple[str, str]] = []
    skipped: Counter = Counter()
    unsearchable: Counter = Counter()
    for ri, p in tc.walk(roots, a.quarantine or os.path.join(roots[0], "\0none")):
        ext = tc.ext_of(p)
        try:
            size = os.path.getsize(p)
            d = tc.decide(p, size, tc.read_head(p))
        except OSError:
            skipped["unreadable"] += 1
            continue
        if d and (d[0] != "blank" or a.ocr):
            skipped[d[0]] += 1
        elif ext in tc.IMAGE_EXT:
            if a.ocr and size <= MAX_BYTES:
                todo.append((p, os.path.basename(roots[ri])))
            else:
                unsearchable["image (no text layer, needs OCR)"] += 1
        elif ext not in SEARCH_EXT:
            unsearchable["other type"] += 1
        elif size > MAX_BYTES:
            unsearchable["over 200 MB"] += 1
        else:
            todo.append((p, os.path.basename(roots[ri])))
    print(f"searching {len(todo)} files for {words}; skipped as tidy junk {dict(skipped)}; not searchable {dict(unsearchable)}", flush=True)
    results: List[dict] = []
    with ThreadPoolExecutor(max_workers=max(1, a.workers)) as pool:
        for i, r in enumerate(pool.map(lambda t: search_one(t[0], t[1], pats), todo), 1):
            results.append(r)
            if i % 2000 == 0:
                print(f"  {i}/{len(todo)}", flush=True)
    hit = [r for r in results if r["words"]]
    fd = os.open(a.out, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        for r in hit:
            f.write(json.dumps(r) + "\n")
    paths = str(Path(a.out).with_suffix("")) + ".paths.txt"
    Path(paths).write_text("\n".join(r["file"] for r in hit) + ("\n" if hit else ""), encoding="utf-8")
    print(f"\n{len(hit)} of {len(results)} searched files match; details in {a.out}, paths in {paths}")
    per: Dict[str, Counter] = defaultdict(Counter)
    for r in hit:
        for w in r["words"]:
            per[r["root"]][w] += 1
    for root, c in per.items():
        print(f"  {root}: files containing " + ", ".join(f"{w}={n}" for w, n in sorted(c.items())))
    both = sum(1 for r in hit if len(r["words"]) > 1)
    print(f"  files with 2+ of the words: {both}")
    notes = Counter(r["note"] for r in results if r["note"])
    if notes:
        print(f"  notes: {dict(notes)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

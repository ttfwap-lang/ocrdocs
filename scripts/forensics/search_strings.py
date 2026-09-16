#!/usr/bin/env python3
"""Full-coverage string hunt over a recovered-data tree.

Three passes, every file in the tree seen by at least one of them:

  raw      byte scan for the needles in ASCII and UTF-16LE, case-insensitive
  text     decoded extraction for PDF text layers, RTF, XML, HTML, JSON, TXT
  ocr      tesseract over every raster image and every PDF page that has no
           usable text layer

Archives (.7z / .zip / .jar) are expanded into a scratch directory and their
members go through the same three passes.

Findings are written to the evidence directory only; nothing is written back
into the scanned tree or into the repository.
"""

from __future__ import annotations

import argparse
import concurrent.futures as futures
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile
from pathlib import Path

RASTER_EXT = {".jpg", ".jpeg", ".png", ".gif", ".bmp", ".tif", ".tiff", ".webp", ".jp2"}
ARCHIVE_EXT = {".7z", ".zip", ".jar"}
TEXTISH_EXT = {
    ".txt", ".xml", ".html", ".htm", ".json", ".jsonl", ".resjson", ".rtf",
    ".csv", ".md", ".log", ".log2", ".ini", ".config", ".config2", ".dic",
    ".js", ".css", ".yaml", ".yml", ".sql", ".srt", ".vtt",
}

TESSERACT = os.environ.get(
    "TESSERACT_EXE",
    str(Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "Tesseract-OCR" / "tesseract.exe"),
)

CONTEXT = 70


def strict_re(needle: str) -> re.Pattern[str]:
    return re.compile(r"(?<![A-Za-z0-9])" + re.escape(needle) + r"(?![A-Za-z0-9])", re.IGNORECASE)


def loose_re(needle: str) -> re.Pattern[str]:
    return re.compile(re.escape(needle), re.IGNORECASE)


def clean(s: str) -> str:
    return re.sub(r"\s+", " ", "".join(c if 32 <= ord(c) < 127 else "." for c in s)).strip()


def scan_text(text: str, needles: list[str], origin: str, pass_name: str, page=None):
    out = []
    for needle in needles:
        for m in loose_re(needle).finditer(text):
            a, b = m.start(), m.end()
            ctx = clean(text[max(0, a - CONTEXT): b + CONTEXT])
            out.append(
                {
                    "needle": needle,
                    "origin": origin,
                    "pass": pass_name,
                    "page": page,
                    "offset": a,
                    "strict": bool(strict_re(needle).fullmatch(text[a:b]))
                    and _boundary_ok(text, a, b),
                    "match": text[a:b],
                    "context": ctx,
                }
            )
    return out


def _boundary_ok(text: str, a: int, b: int) -> bool:
    before = text[a - 1] if a > 0 else " "
    after = text[b] if b < len(text) else " "
    return not (before.isalnum() or after.isalnum())


def scan_bytes(path: Path, needles: list[str], origin: str):
    out = []
    try:
        data = path.read_bytes()
    except OSError as exc:
        return [{"error": f"read failed: {exc}", "origin": origin, "pass": "raw"}]
    for needle in needles:
        for label, enc in (("ascii", "latin-1"), ("utf16le", "utf-16-le")):
            pat = re.compile(re.escape(needle.encode(enc)), re.IGNORECASE)
            for m in pat.finditer(data):
                a, b = m.start(), m.end()
                raw = data[max(0, a - CONTEXT * 2): b + CONTEXT * 2]
                ctx = clean(raw.decode("utf-16-le", "ignore") if label == "utf16le"
                            else raw.decode("latin-1", "ignore"))
                step = 2 if label == "utf16le" else 1
                before = data[a - step: a].decode(enc, "ignore") if a >= step else " "
                after = data[b: b + step].decode(enc, "ignore") or " "
                out.append(
                    {
                        "needle": needle,
                        "origin": origin,
                        "pass": f"raw:{label}",
                        "page": None,
                        "offset": a,
                        "strict": not ((before[:1].isalnum() if before else False)
                                       or (after[:1].isalnum() if after else False)),
                        "match": data[a:b].decode(enc, "ignore"),
                        "context": ctx,
                    }
                )
    return out


def ocr_image(path: Path) -> str:
    try:
        proc = subprocess.run(
            [TESSERACT, str(path), "stdout", "-l", "eng", "--psm", "3"],
            capture_output=True, timeout=300,
        )
        return proc.stdout.decode("utf-8", "ignore")
    except Exception as exc:  # noqa: BLE001
        return f"\n[[OCR FAILED: {exc}]]\n"


def handle_pdf(path: Path, needles: list[str], origin: str, scratch: Path):
    import pypdfium2 as pdfium

    found, stats = [], {"pages": 0, "ocr_pages": 0}
    try:
        doc = pdfium.PdfDocument(str(path))
    except Exception as exc:  # noqa: BLE001
        return [{"error": f"pdf open failed: {exc}", "origin": origin, "pass": "text"}], stats
    for i, page in enumerate(doc, start=1):
        stats["pages"] += 1
        try:
            text = page.get_textpage().get_text_bounded() or ""
        except Exception:  # noqa: BLE001
            text = ""
        found += scan_text(text, needles, origin, "pdf-text", page=i)
        if len(text.strip()) < 40:
            stats["ocr_pages"] += 1
            tmp = scratch / f"{abs(hash(origin))}_{i}.png"
            try:
                page.render(scale=300 / 72).to_pil().save(tmp)
                found += scan_text(ocr_image(tmp), needles, origin, "pdf-ocr", page=i)
            except Exception as exc:  # noqa: BLE001
                found.append({"error": f"pdf render failed p{i}: {exc}",
                              "origin": origin, "pass": "pdf-ocr"})
            finally:
                tmp.unlink(missing_ok=True)
    doc.close()
    return found, stats


def decode_textish(path: Path) -> str:
    data = path.read_bytes()
    for enc in ("utf-8", "utf-16", "latin-1"):
        try:
            return data.decode(enc)
        except (UnicodeDecodeError, UnicodeError):
            continue
    return data.decode("latin-1", "ignore")


def expand_archive(path: Path, dest: Path) -> str | None:
    dest.mkdir(parents=True, exist_ok=True)
    try:
        if path.suffix.lower() == ".7z":
            import py7zr

            with py7zr.SevenZipFile(path, "r") as z:
                z.extractall(path=dest)
        else:
            with zipfile.ZipFile(path) as z:
                z.extractall(dest)
    except Exception as exc:  # noqa: BLE001
        return f"{exc}"
    return None


def process(path: Path, origin: str, needles: list[str], scratch: Path):
    ext = path.suffix.lower()
    findings, stats = [], {"ocr_images": 0, "pdf_pages": 0, "pdf_ocr_pages": 0}
    findings += scan_bytes(path, needles, origin)
    if ext == ".pdf":
        f, s = handle_pdf(path, needles, origin, scratch)
        findings += f
        stats["pdf_pages"] += s["pages"]
        stats["pdf_ocr_pages"] += s["ocr_pages"]
    elif ext in RASTER_EXT:
        stats["ocr_images"] += 1
        findings += scan_text(ocr_image(path), needles, origin, "ocr", page=None)
    elif ext in TEXTISH_EXT:
        try:
            findings += scan_text(decode_textish(path), needles, origin, "text")
        except OSError as exc:
            findings.append({"error": f"decode failed: {exc}", "origin": origin, "pass": "text"})
    return findings, stats


def collect(root: Path, scratch: Path, depth: int = 0):
    """Yield (real_path, logical_origin) for every file, expanding archives once."""
    items = []
    for p in sorted(root.rglob("*")):
        if not p.is_file():
            continue
        items.append((p, str(p)))
    expanded = []
    if depth < 2:
        for p, origin in list(items):
            if p.suffix.lower() in ARCHIVE_EXT:
                dest = scratch / ("ax_%d" % abs(hash(origin)))
                err = expand_archive(p, dest)
                if err:
                    expanded.append(("ERR", origin, err))
                    continue
                for q, sub in collect(dest, scratch, depth + 1):
                    rel = os.path.relpath(sub, dest)
                    expanded.append((q, f"{origin}!{rel}"))
    for p, origin in items:
        yield p, origin
    for entry in expanded:
        if entry[0] == "ERR":
            continue
        yield entry[0], entry[1]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--needle", action="append", required=True)
    ap.add_argument("--workers", type=int, default=max(4, (os.cpu_count() or 4)))
    args = ap.parse_args()

    root = Path(args.root)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    scratch = Path(tempfile.mkdtemp(prefix="strhunt-"))
    needles = args.needle

    started = time.time()
    targets = list(collect(root, scratch))
    print(f"targets: {len(targets)} (incl. archive members)", flush=True)

    findings, errors = [], []
    totals = {"ocr_images": 0, "pdf_pages": 0, "pdf_ocr_pages": 0}
    done = 0
    with futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        futs = {pool.submit(process, p, o, needles, scratch): o for p, o in targets}
        for fut in futures.as_completed(futs):
            origin = futs[fut]
            done += 1
            try:
                f, s = fut.result()
            except Exception as exc:  # noqa: BLE001
                errors.append({"origin": origin, "error": repr(exc)})
                continue
            for k in totals:
                totals[k] += s.get(k, 0)
            for item in f:
                (errors if "error" in item else findings).append(item)
            if done % 20 == 0:
                print(f"  {done}/{len(targets)} scanned, {len(findings)} hits", flush=True)

    findings.sort(key=lambda d: (d["needle"], d["origin"], d["pass"], d["offset"]))
    summary = {
        "root": str(root),
        "needles": needles,
        "files_scanned": len(targets),
        "elapsed_sec": round(time.time() - started, 1),
        "ocr_images": totals["ocr_images"],
        "pdf_pages": totals["pdf_pages"],
        "pdf_ocr_pages": totals["pdf_ocr_pages"],
        "hits_total": len(findings),
        "hits_strict": sum(1 for f in findings if f["strict"]),
        "errors": len(errors),
        "per_needle": {
            n: {
                "total": sum(1 for f in findings if f["needle"] == n),
                "strict": sum(1 for f in findings if f["needle"] == n and f["strict"]),
                "files": len({f["origin"] for f in findings if f["needle"] == n}),
                "files_strict": len({f["origin"] for f in findings
                                     if f["needle"] == n and f["strict"]}),
            }
            for n in needles
        },
    }
    (out / "findings.json").write_text(
        json.dumps({"summary": summary, "findings": findings, "errors": errors}, indent=2),
        encoding="utf-8",
    )
    print(json.dumps(summary, indent=2), flush=True)
    shutil.rmtree(scratch, ignore_errors=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""Bulk LlamaCloud analysis (parse + classify + extract with the 100+ field regex-catalogue schema).
Gateways in Australia, Europe, and USA are greenlighted; Africa gateway is banned. Run it from your desktop.

Supported regions:
  - Australia ("au"): uses your LlamaIndex enterprise endpoint (OCRDOCS_LLAMAPARSE_BASE_URL).
  - Europe ("eu"): uses https://api.cloud.eu.llamaindex.ai (or custom OCRDOCS_LLAMAPARSE_BASE_URL).
  - USA ("us" / "usa" / "na"): uses https://api.cloud.llamaindex.ai (or custom OCRDOCS_LLAMAPARSE_BASE_URL).
  - Africa ("af" / "africa"): BANNED.

Setup (PowerShell):
  $env:LLAMA_CLOUD_API_KEY = "<your key>"
  # Optional / for custom enterprise endpoint (e.g. Sydney):
  $env:OCRDOCS_LLAMAPARSE_BASE_URL = "https://<your endpoint>"

Steps:
  python llamaparse_bulk.py --check --region eu --endpoint-host api.cloud.eu.llamaindex.ai
  python llamaparse_bulk.py --list files.txt --out results.jsonl
  python llamaparse_bulk.py --list files.txt --out results.jsonl --run --region eu --endpoint-host api.cloud.eu.llamaindex.ai --max-files 50 --tier agentic_plus
  (raise --max-files gradually; re-running resumes and skips files already in results.jsonl)

Files are sent in --list order: pair it with the page-sorted list from count_pages.py so the smallest documents
go first ("in order of pages"). --max-files 0 sends every pending file in one run (no budget cap).
--tier sets the parse tier (fast | cost_effective | agentic | agentic_plus; default OCRDOCS_LLAMAPARSE_TIER,
usually cost_effective). --redo forgets earlier "ok" rows so previously done files are extracted again.
Then run verify_fields.py over --out: that is the full regex verifier (valueSanity + APRA checks) for every field.

files.txt is one file path per line; --folder <dir> takes a whole folder tree instead. Results (extracted personal data!)
go to --out only: keep that file somewhere private. Each cloud job is submitted with disable_cache and deleted afterwards.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import threading
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Callable, Dict, List, Optional
from urllib.parse import urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ocr_llamacloud as llc  # noqa: E402
import ocr_llamaparse as lp  # noqa: E402

DEFAULT_REGION = os.environ.get("OCRDOCS_LLAMAPARSE_REGION", "au")
MAX_WORKERS = 8


def collect(list_file: Optional[str], folder: Optional[str]) -> List[str]:
    """Supported, existing files from a list or a folder tree, de-duplicated, in a stable order."""
    paths: List[str] = []
    if list_file:
        paths += [l.strip().strip('"') for l in Path(list_file).read_text(encoding="utf-8").splitlines() if l.strip()]
    if folder:
        paths += [str(p) for p in sorted(Path(folder).rglob("*")) if p.is_file()]
    seen, out = set(), []
    for p in paths:
        if p in seen or Path(p).suffix.lower() not in llc.UPLOAD_EXTENSIONS or not os.path.isfile(p):
            continue
        seen.add(p)
        out.append(p)
    return out


# Magic-byte headers per extension: files whose content does not match are junk from the recovered drive
# (renamed/corrupt) and are rejected by the gateway anyway ("is not of a supported file type"). They get a
# "fatal" row once and are never re-uploaded, instead of being retried every round forever.
MAGIC: Dict[str, bytes] = {
    ".pdf": b"%PDF", ".png": b"\x89PNG", ".jpg": b"\xff\xd8", ".jpeg": b"\xff\xd8",
    ".webp": b"RIFF", ".bmp": b"BM", ".tif": b"II*\x00", ".tiff": b"II*\x00", ".docx": b"PK\x03\x04",
}
GATEWAY_FATAL_MARKERS = ("is not of a supported file type", "password or DRM protected",
                         "appears to be broken or corrupted",
                         "file is password protected", "could not be processed: file is encrypted",
                         # corrupt/mislabeled images from the recovered drive: the gateway rejects them with
                         # this on every attempt, so without this marker they would be re-uploaded forever
                         "our image decoder cannot read")
# Errors that are usually deterministic (corrupt image content) but are only treated as fatal after the
# file has failed the same way across two rounds, so an unlucky transient never strikes a good file out.
STRIKE_MARKER = "internal service error"
STRIKE_LIMIT = 2

# Files over this size are re-encoded as a downscaled JPEG before upload. The gateway dropped 120 MB JPGs
# from the recovered drive every time (URLError / HTTP 499 -- upload cap), and those failures never count as
# strikes, so they would be retried forever. Downscaling to <=MAX_IMAGE_EDGE px keeps every document readable
# while dropping the payload to a few MB. Originals are never modified on disk.
UPLOAD_BYTES_CAP = 20 * 1024 * 1024  # 20 MB
MAX_IMAGE_EDGE = 4000

def maybe_shrink_image(path: str, data: bytes):
    """Return uploadable bytes, or None when the oversized image cannot be reduced.

    Unchanged bytes when small; a downscaled JPEG when PIL can decode the image; a cv2-repacked
    JPEG of the FIRST decodable frame when PIL chokes (recovered-drive blobs that concatenate many
    files -- the 120 MB JPGs above); None when over-cap and undecodable (caller records fatal).
    """
    if len(data) <= UPLOAD_BYTES_CAP:
        return data
    ext = os.path.splitext(path)[1].lower()
    if ext not in (".jpg", ".jpeg", ".png", ".webp", ".bmp"):  # TIFF/PDF left alone (multi-frame)
        return data
    from io import BytesIO
    try:
        from PIL import Image
        im = Image.open(BytesIO(data))
        im.load()
        if im.width > MAX_IMAGE_EDGE or im.height > MAX_IMAGE_EDGE:
            im.thumbnail((MAX_IMAGE_EDGE, MAX_IMAGE_EDGE))
        if im.mode in ("RGBA", "LA", "P"):
            rgba = im.convert("RGBA")
            bg = Image.new("RGB", rgba.size, (255, 255, 255))
            bg.paste(rgba, mask=rgba.split()[3])
            im = bg
        elif im.mode != "RGB":
            im = im.convert("RGB")
        buf = BytesIO()
        im.save(buf, "JPEG", quality=88, optimize=True)
        return buf.getvalue()
    except Exception:  # PIL broke on the stream (corrupt/concatenated blob) -- try cv2 first frame
        pass
    try:
        import cv2  # noqa: N813
        import numpy as np
        frame = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
        if frame is None:
            return None
        h, w = frame.shape[:2]
        if max(w, h) > MAX_IMAGE_EDGE:
            scale = MAX_IMAGE_EDGE / max(w, h)
            frame = cv2.resize(frame, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
        ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 88])
        if not ok:
            return None
        return buf.tobytes()
    except Exception:  # noqa: BLE001 - neither decoder can touch it; let the caller mark it fatal
        return None


def magic_mismatch(path: str) -> Optional[str]:
    """Return a short reason if the file's content cannot be of its declared extension, else None."""
    ext = os.path.splitext(path)[1].lower()
    want = MAGIC.get(ext)
    if want is None:
        return None
    try:
        with open(path, "rb") as fh:
            head = fh.read(8)
    except OSError as e:
        return f"unreadable ({type(e).__name__})"
    if ext in (".tif", ".tiff") and head[:4] in (b"II*\x00", b"MM\x00*"):
        return None
    if not head.startswith(want):
        return f"content mismatch: expected {want!r}, got {head[:4]!r}"


def already_done(out: str) -> set:
    if not os.path.exists(out):
        return set()
    # only successes and fatal (junk/rejected) rows count as done, so a file that failed (network, budget,
    # bad file) is retried on the next run while confirmed junk is not re-uploaded forever. Files that fail
    # with the same deterministic gateway error across STRIKE_LIMIT rounds are also marked done so the
    # resume loop converges instead of retrying corrupt files forever.
    strikes: Dict[str, int] = {}
    done: set = set()
    for r in (json.loads(l) for l in open(out, encoding="utf-8") if l.strip()):
        f = r["file"]
        if r.get("ok") or r.get("fatal"):
            done.add(f)
            strikes[f] = 0
        elif STRIKE_MARKER in (r.get("error") or ""):
            strikes[f] = strikes.get(f, 0) + 1
            if strikes[f] >= STRIKE_LIMIT:
                done.add(f)
    return done


def analyse_one(path: str, cloud) -> Dict:
    t = time.time()
    mm = magic_mismatch(path)
    if mm:
        return {"file": path, "ok": False, "fatal": True, "error": f"Fatal: {mm}", "secs": round(time.time() - t, 1)}
    try:
        data = Path(path).read_bytes()
        shrunk = maybe_shrink_image(path, data)
        if shrunk is None:
            return {"file": path, "ok": False, "fatal": True,
                    "error": f"Fatal: image {len(data) // (1024 * 1024)}MB is over the upload cap and cannot be decoded",
                    "secs": round(time.time() - t, 1)}
        r = cloud.analyze(shrunk, Path(path).name)
        row = {"file": path, "ok": True, "document_type": r.document_type, "type_confidence": r.type_confidence,
               "type_reasoning": r.type_reasoning, "fields": r.fields, "pages": len(r.page_texts), "credits": r.credits,
               "errors": r.errors, "secs": round(time.time() - t, 1)}
        if len(shrunk) != len(data):
            row["shrunk"] = f"{len(data) // 1024}KB->{len(shrunk) // 1024}KB"
        return row
    except Exception as e:  # noqa: BLE001 - one bad file must never stop a bulk run; it is recorded and retried next run
        msg = f"{type(e).__name__}: {e}"[:300]
        fatal = any(m in msg for m in GATEWAY_FATAL_MARKERS)
        row = {"file": path, "ok": False, "error": msg, "secs": round(time.time() - t, 1)}
        if fatal:
            row["fatal"] = True
        return row


def run(files: List[str], out: str, cloud, workers: int = 3, max_files: int = 50, log: Callable[[str], None] = print,
        done: Optional[set] = None) -> Counter:
    """Analyse up to max_files not-yet-done files, appending one JSON line per file. Resumable.
    max_files <= 0 means every pending file. `done` overrides the "already done" set (pass set() with --redo)."""
    done = already_done(out) if done is None else done
    pending = [f for f in files if f not in done]
    if max_files and max_files > 0:
        pending = pending[:max_files]
    counts: Counter = Counter()
    lock = threading.Lock()
    fd = os.open(out, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)

    with os.fdopen(fd, "a", encoding="utf-8") as fh:
        def work(path: str) -> None:
            rec = analyse_one(path, cloud)
            with lock:
                fh.write(json.dumps(rec) + "\n")
                fh.flush()
                counts["ok" if rec["ok"] else "failed"] += 1
                counts["credits"] += rec.get("credits") or 0
                n = counts["ok"] + counts["failed"]
                if n % 10 == 0 or n == len(pending):
                    log(f"  {n}/{len(pending)}  ok {counts['ok']}  failed {counts['failed']}")

        with ThreadPoolExecutor(max_workers=max(1, min(workers, MAX_WORKERS))) as pool:
            list(pool.map(work, pending))
    counts["skipped_already_done"] = len([f for f in files if f in done])
    return counts


def endpoint_or_exit(region: str, confirm_host: Optional[str], need_confirm: bool) -> str:
    if lp.is_africa_region(region):
        sys.exit(f"STOPPED, nothing sent: region '{region}' is banned (Africa gateway is banned)")
    if confirm_host and lp.is_africa_host(confirm_host):
        sys.exit(f"STOPPED, nothing sent: endpoint host '{confirm_host}' is in Africa, which is banned")
    try:
        url = lp.base_url(region)
    except lp.LlamaParseUnavailable as e:
        sys.exit(f"STOPPED, nothing sent: {e}")
    host = urlparse(url).hostname or ""
    if lp.is_africa_host(host):
        sys.exit(f"STOPPED, nothing sent: endpoint host '{host}' is in Africa, which is banned")
    print(f"Gateway endpoint configured for region '{region}': {url}")
    if need_confirm and (confirm_host or "").lower() != host.lower():
        sys.exit(f"STOPPED, nothing sent: to proceed pass --endpoint-host {host} (typing the host confirms this is the endpoint you mean)")
    if not os.environ.get("LLAMA_CLOUD_API_KEY"):
        sys.exit("STOPPED, nothing sent: LLAMA_CLOUD_API_KEY is not set")
    return url


def make_cloud(max_files: int, region: str = DEFAULT_REGION, tier: Optional[str] = None):
    tier = tier or os.environ.get("OCRDOCS_LLAMAPARSE_TIER")
    return llc.LlamaCloud(lp.LlamaParse(region=region, tier=tier, max_calls=max(1, max_files)))


def _build_cloud(factory: Callable, max_files: int, region: str, tier: Optional[str] = None):
    for args in ((max_files, region, tier), (max_files, region), (max_files,)):
        try:
            return factory(*args)
        except TypeError:
            continue
    raise TypeError(f"cloud factory {getattr(factory, '__name__', factory)!r} accepts none of the expected signatures")


def synthetic_page() -> bytes:
    import io
    from PIL import Image, ImageDraw, ImageFont
    try:
        font = ImageFont.truetype("arial.ttf", 34)
    except OSError:
        font = ImageFont.load_default()
    im = Image.new("RGB", (1200, 500), "white")
    d = ImageDraw.Draw(im)
    for i, line in enumerate(["SAMPLE LOAN APPLICATION (invented test page)", "Your details",
                              "Given names: Jane   Family name: Testerson", "Parents details: John and Mary   Job title: boilermaker, nurse"]):
        d.text((40, 40 + i * 90), line, fill="black", font=font)
    buf = io.BytesIO()
    im.save(buf, "PNG")
    return buf.getvalue()


def main(argv: Optional[List[str]] = None, cloud_factory: Callable = make_cloud) -> int:
    ap = argparse.ArgumentParser(
        description="Bulk LlamaCloud analysis. Gateways in Australia, Europe, and USA are greenlighted; Africa gateway is banned."
    )
    ap.add_argument("--list", help="text file with one document path per line")
    ap.add_argument("--folder", help="a folder tree of documents")
    ap.add_argument("--out", help="results file (JSON lines)")
    ap.add_argument("--run", action="store_true", help="actually send files (default is a dry run that sends nothing)")
    ap.add_argument("--check", action="store_true", help="send ONE invented page to prove the endpoint and key work")
    ap.add_argument("--region", default=DEFAULT_REGION, help="gateway region: au, eu, us/usa/na (Africa is banned; default: %(default)s)")
    ap.add_argument("--endpoint-host", help="the gateway endpoint's host name; required to send anything")
    ap.add_argument("--workers", type=int, default=3)
    ap.add_argument("--max-files", type=int, default=50, help="most files to send this run; 0 sends every pending file (default 50)")
    ap.add_argument("--tier", choices=list(lp.TIERS), default=None,
                    help=f"LlamaParse tier for every page of every file (default: OCRDOCS_LLAMAPARSE_TIER / {os.environ.get('OCRDOCS_LLAMAPARSE_TIER', 'cost_effective')})")
    ap.add_argument("--redo", action="store_true", help="extract again the files already marked ok in --out")
    a = ap.parse_args(argv)

    if a.check:
        endpoint_or_exit(a.region, a.endpoint_host, need_confirm=True)
        cloud = _build_cloud(cloud_factory, 1, a.region, a.tier)
        r = cloud.analyze(synthetic_page(), "invented_test_page.png")
        print(f"document type: {r.document_type} ({r.type_confidence}); {len(r.fields)} fields; credits {r.credits}; errors {r.errors}")
        for f in r.fields:
            print(f"  {f['subject']:<9} {f['name']:<24} {f['value']}")
        return 0

    if not (a.list or a.folder) or not a.out:
        ap.error("give --list or --folder, and --out (or use --check)")
    files = collect(a.list, a.folder)
    done = set() if a.redo else already_done(a.out)
    pending = [f for f in files if f not in done]
    to_send = len(pending) if a.max_files <= 0 else min(len(pending), a.max_files)
    print(f"{len(files)} supported files found, {len(files) - len(pending)} already in {a.out}, {len(pending)} pending, "
          f"this run would send {to_send}"
          + (f", parse tier: {a.tier}" if a.tier else ""))
    if a.redo:
        print("--redo: earlier 'ok' rows are ignored; everything listed will be extracted again.")
    if not a.run:
        print("DRY RUN: nothing was sent. Add --run --endpoint-host <host> to send.")
        return 0
    endpoint_or_exit(a.region, a.endpoint_host, need_confirm=True)
    cloud = _build_cloud(cloud_factory, to_send, a.region, a.tier)
    counts = run(files, a.out, cloud, a.workers, a.max_files, done=done)
    print(f"finished: ok {counts['ok']}, failed {counts['failed']}, credits used {counts['credits']:.0f}; results in {a.out}")
    if counts["failed"]:
        print("failed files were recorded with their error and are retried on the next run (they are not skipped).")
    return 0 if not counts["failed"] else 1


if __name__ == "__main__":
    sys.exit(main())

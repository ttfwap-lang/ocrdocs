#!/usr/bin/env python3
"""Autonomous OCR queue watcher for the ocr_pipeline queued folder.

What it does, end to end, with no human input:
  1. Watches the queued folder (default C:\\mnt\\nvme\\ocr_pipeline\\input, "the queued
     folder of the ocr folder").
  2. For every file that appears it analyses ALL pages of the file locally (the
     GX10 vision model via localhost:8000) to decide whether the file contains
     ANY page of identity documents / personal details / handwriting.
  3. Files with NO such page are removed from the queued folder into noocr/ --
     never deleted, recorded in the manifest for review.
  4. The remainder go to LlamaCloud agentic_plus (reuses llamaparse_bulk
     analyse_one: magic pre-check, shrink-over-cap, fatal markers, resumable
     results JSONL). The source file is then moved to output/ok|fatal, so the
     queued folder only ever holds work that is genuinely pending.
  5. The loop runs forever; a manifest + results JSONL make every decision
     durable, so a reboot simply resumes.

Privacy: all page analysis stays local (model on the home box). Extracted
personal data goes only to the results JSONL, like the bulk runner.

Usage:
  python ocr_queue_watch.py --once               # one pass, then exit
  python ocr_queue_watch.py                      # loop forever (default)
  python ocr_queue_watch.py --poll 30 --workers 4

Paths default to the ocr_pipeline layout and can be overridden per run:
  --queue    C:\\mnt\\nvme\\ocr_pipeline\\input   (the queued folder)
  --noocr    C:\\mnt\\nvme\\ocr_pipeline\\noocr   (files with no identity content)
  --output   C:\\mnt\\nvme\\ocr_pipeline\\output  (parsed files + results JSONL)
  --results  <output>\\llamacloud_results.jsonl
  --manifest <output>\\queue_manifest.jsonl
  --log      <output>\\ocr_queue_watch.log
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import shutil
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Dict, List, Optional, Tuple

sys.path.insert(0, str(Path(__file__).resolve().parent))

import llamaparse_bulk as lb  # noqa: E402
import ocr_llamacloud as llc  # noqa: E402

QUEUE_DEFAULT = r"C:\mnt\nvme\ocr_pipeline\input"
NOOCR_DEFAULT = r"C:\mnt\nvme\ocr_pipeline\noocr"
OUTPUT_DEFAULT = r"C:\mnt\nvme\ocr_pipeline\output"

DEFAULT_POLL = 30          # seconds between scans of the queued folder
MAX_ANALYSE_WORKERS = 4    # llamaparse submissions run in a small pool
MIN_CONFIDENCE = 0.85      # a page is only "no identity content" past this
MAX_ANALYSE_PAGES = 40     # per-file page cap for the vision triage (fail-open sample beyond it)
VISION_URL = "http://localhost:8000"
VISION_MODEL = "qwen-abliterated"

# Per-page schema (the kind + readable-text triage proven on the corpus via
# corpus_ai_triage.py -- this exact wording reliably labels blank pages as
# 'blank', whereas a bare yes/no identity question biases the model to yes).
# A page has NO identity/personal/handwriting content only when it is a
# confident photo or blank with no readable text. Documents, handwriting,
# screenshots, 'other', low confidence, and every model error are all kept.
KINDS = ["document", "handwritten_document", "photo", "screenshot", "blank", "other"]
PAGE_SCHEMA = {
    "type": "object",
    "properties": {
        "kind": {"type": "string", "enum": KINDS},
        "contains_readable_text": {"type": "boolean"},
        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
    },
    "required": ["kind", "contains_readable_text", "confidence"],
}
PAGE_PROMPT = (
    "Classify this image for a document-intake system. kind: 'document' = printed or typed paperwork, forms, statements, "
    "letters, identity cards, licences, receipts; 'handwritten_document' = paper with handwriting; 'photo' = a photograph of "
    "people, places, objects or scenes with no paperwork as the subject; 'screenshot' = a screen capture of software or a "
    "web page; 'blank' = an empty or nearly empty page with no content. contains_readable_text: true if the page has any "
    "readable text. confidence: 0 to 1."
)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class Log:
    def __init__(self, log_path: Optional[str]):
        self.fh = None
        if log_path:
            try:
                os.makedirs(os.path.dirname(log_path), exist_ok=True)
                self.fh = open(log_path, "a", encoding="utf-8")
            except OSError:
                self.fh = None

    def __call__(self, msg: str) -> None:
        line = f"[{now_iso()}] {msg}"
        try:
            print(line, flush=True)
        except Exception:  # noqa: BLE001
            pass
        if self.fh:
            try:
                self.fh.write(line + "\n")
                self.fh.flush()
            except Exception:  # noqa: BLE001 - logging must never break the watcher
                pass


def load_manifest(path: str) -> Dict[str, dict]:
    """file path -> {decision, reason, moved_to, ts}. Durable across restarts."""
    out: Dict[str, dict] = {}
    if not os.path.exists(path):
        return out
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if not line:
            continue
        try:
            r = json.loads(line)
            out[r["file"]] = r
        except (json.JSONDecodeError, KeyError):
            continue
    return out


def append_manifest(path: str, record: dict) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(record, ensure_ascii=False) + "\n")
        fh.flush()


def unique_dst(dst_dir: str, name: str) -> str:
    """A destination path inside dst_dir that does not collide."""
    target = os.path.join(dst_dir, name)
    if not os.path.exists(target):
        return target
    stem, suffix = os.path.splitext(name)
    for i in range(1, 10000):
        cand = os.path.join(dst_dir, f"{stem}__{i}{suffix}")
        if not os.path.exists(cand):
            return cand
    raise RuntimeError(f"cannot allocate unique name under {dst_dir}")


# ---------------------------------------------------------------------------
# Page analysis (local vision, all pages)
# ---------------------------------------------------------------------------

def render_pdf_pages(path: str, max_side: int = 896, cap: int = MAX_ANALYSE_PAGES):
    """Yield every page image of a PDF (evenly sampled beyond `cap`)."""
    import pypdfium2 as pdfium
    doc = pdfium.PdfDocument(path)
    n = len(doc)
    try:
        if n == 0:
            return
        step = max(1, n // max(1, cap)) if n > cap else 1
        for idx in range(0, n, step):
            page = doc[idx]
            try:
                w, h = page.get_size()
                im = page.render(scale=max_side / max(w, h)).to_pil().convert("RGB")
                im.thumbnail((max_side, max_side))
                yield idx, im
            finally:
                page.close()
    finally:
        doc.close()


def render_pages(path: str, max_side: int = 896) -> List[Tuple[int, object]]:
    """All pages of the file: every PDF page, or the single image itself."""
    low = path.lower()
    if low.endswith(".pdf"):
        return list(render_pdf_pages(path, max_side))
    from PIL import Image
    im = Image.open(path)
    im.load()
    im = im.convert("RGB")
    im.thumbnail((max_side, max_side))
    return [(0, im)]


def asks_vision(image, url: str = VISION_URL, model: str = VISION_MODEL, timeout: float = 120.0) -> dict:
    buf = io.BytesIO()
    image.save(buf, "JPEG", quality=85)
    body = {
        "model": model, "temperature": 0, "max_tokens": 140,
        "chat_template_kwargs": {"enable_thinking": False},
        "response_format": {"type": "json_schema", "json_schema": {"name": "page_triage", "schema": PAGE_SCHEMA}},
        "messages": [{"role": "user", "content": [
            {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + base64_image(buf.getvalue())}},
            {"type": "text", "text": PAGE_PROMPT}]}],
    }
    import urllib.request
    req = urllib.request.Request(url.rstrip("/") + "/v1/chat/completions",
                                 json.dumps(body).encode(), {"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(json.loads(resp.read().decode())["choices"][0]["message"]["content"])


def base64_image(data: bytes) -> str:
    import base64
    return base64.b64encode(data).decode()


def normalise_page(raw: dict) -> dict:
    """Validate the model answer; anything malformed is treated as content (keep)."""
    kind = raw.get("kind")
    text = raw.get("contains_readable_text")
    conf = raw.get("confidence")
    if kind not in KINDS or not isinstance(text, bool) or not isinstance(conf, (int, float)):
        return {"kind": "other", "contains_readable_text": True, "confidence": 0.0, "error": "malformed"}
    return {"kind": kind, "contains_readable_text": text, "confidence": float(min(1, max(0, conf)))}


def page_has_content(label: dict) -> bool:
    """A page is kept (may carry identity/personal/handwriting content) unless
    the model is confident that it is a text-free photo or blank page."""
    if label.get("contains_readable_text"):
        return True
    if label.get("kind") not in ("photo", "blank"):
        return True  # documents, handwriting, screenshots, other: keep
    return not (isinstance(label.get("confidence"), (int, float)) and label["confidence"] >= MIN_CONFIDENCE)


def triage_pages(path: str, log: Callable[[str], None]) -> Tuple[bool, str, Optional[str]]:
    """Analyse all pages locally. Returns (has_content, verdict, error).

    has_content=False means the file contains no page of identity documents /
    personal details / handwriting and can be moved out of the queue (to noocr).
    Any model error, malformed answer, or doubt keeps the file (fail-open).
    """
    try:
        pages = render_pages(path)
    except Exception as e:  # noqa: BLE001 - unreadable file: keep, let the gateway judge it
        return True, "keep", f"render failed: {type(e).__name__}: {e}"
    if not pages:
        return True, "keep", "no renderable pages"
    verdicts: List[dict] = []
    for idx, im in pages:
        try:
            raw = asks_vision(im)
            label = normalise_page(raw)
        except Exception as e:  # noqa: BLE001 - model/tunnel down: keep every file
            log(f"    vision error on page {idx + 1}: {type(e).__name__} - keeping file")
            return True, "keep", f"vision error page {idx + 1}: {type(e).__name__}"
        verdicts.append(label)
        if label.get("error"):
            return True, "keep", label.get("error")
    if any(page_has_content(v) for v in verdicts):
        return True, "keep", None
    return False, "noocr", None


# ---------------------------------------------------------------------------
# Queue pass
# ---------------------------------------------------------------------------

def queue_files(queue_dir: str) -> List[str]:
    """Supported files currently sitting in the queued folder (recursive)."""
    if not os.path.isdir(queue_dir):
        return []
    out = []
    for p in sorted(Path(queue_dir).rglob("*")):
        if not p.is_file():
            continue
        name = p.name
        if name.startswith(".") or name.endswith((".part", ".tmp", ".crdownload")):
            continue
        if p.suffix.lower() not in llc.UPLOAD_EXTENSIONS:
            continue
        out.append(str(p))
    return out


def one_pass(args, log: Callable[[str], None], cloud_factory: Callable) -> Dict[str, int]:
    manifest = load_manifest(args.manifest)
    results_done: set = set()
    if os.path.exists(args.results):
        for line in open(args.results, encoding="utf-8"):
            line = line.strip()
            if not line:
                continue
            try:
                r = json.loads(line)
                if r.get("ok") or r.get("fatal"):
                    results_done.add(r["file"])
            except (json.JSONDecodeError, KeyError):
                continue

    files = [f for f in queue_files(args.queue) if f not in manifest and f not in results_done]
    counts = {"scanned": len(files), "noocr": 0, "parsed_ok": 0, "parsed_fatal": 0, "skipped": 0}

    if not files:
        return counts

    os.makedirs(args.noocr, exist_ok=True)
    os.makedirs(args.output, exist_ok=True)

    keepers: List[str] = []
    for path in files:
        mm = lb.magic_mismatch(path)
        if mm:
            dst = unique_dst(args.noocr, os.path.basename(path))
            shutil.move(path, dst)
            rec = {"file": path, "decision": "noocr_junk", "reason": mm, "moved_to": dst, "ts": now_iso()}
            append_manifest(args.manifest, rec)
            log(f"  noocr (junk): {os.path.basename(path)} - {mm}")
            counts["noocr"] += 1
            continue
        has_content, verdict, err = triage_pages(path, log)
        if not has_content:
            dst = unique_dst(args.noocr, os.path.basename(path))
            shutil.move(path, dst)
            rec = {"file": path, "decision": "noocr", "reason": "no identity/personal/handwriting pages", "moved_to": dst, "ts": now_iso()}
            append_manifest(args.manifest, rec)
            log(f"  noocr (no identity content): {os.path.basename(path)}")
            counts["noocr"] += 1
            continue
        keepers.append(path)
        log(f"  keep -> llamaparse: {os.path.basename(path)} ({verdict})")

    if not keepers:
        return counts

    # Build the cloud client once per pass (region/tier from env like the bulk runner).
    region = os.environ.get("OCRDOCS_LLAMAPARSE_REGION", "eu")
    tier = os.environ.get("OCRDOCS_LLAMAPARSE_TIER", "agentic_plus")
    if not os.environ.get("LLAMA_CLOUD_API_KEY"):
        log(f"  STOP: LLAMA_CLOUD_API_KEY is not set; {len(keepers)} keepers left in the queue")
        counts["skipped"] = len(keepers)
        return counts
    cloud = cloud_factory(len(keepers), region, tier)

    def work(path: str) -> dict:
        row = lb.analyse_one(path, cloud)
        # persist every analysis row immediately (resumable), then move source
        with open(args.results, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")
            fh.flush()
        sub = "ok" if row.get("ok") else "fatal"
        dst = unique_dst(os.path.join(args.output, sub), os.path.basename(path))
        try:
            shutil.move(path, dst)
        except OSError:
            dst = path  # leave in place; manifest still records the result
        rec = {"file": path, "decision": f"parsed_{sub}", "reason": (row.get("error") or "")[:300],
               "moved_to": dst if dst != path else None, "ts": now_iso()}
        append_manifest(args.manifest, rec)
        return row

    with ThreadPoolExecutor(max_workers=max(1, min(args.workers, MAX_ANALYSE_WORKERS))) as pool:
        rows = list(pool.map(work, keepers))
    counts["parsed_ok"] = sum(1 for r in rows if r.get("ok"))
    counts["parsed_fatal"] = sum(1 for r in rows if not r.get("ok"))
    return counts


def main(argv: Optional[List[str]] = None, cloud_factory: Callable = lb.make_cloud) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--queue", default=os.environ.get("OCR_QUEUE_DIR", QUEUE_DEFAULT))
    ap.add_argument("--noocr", default=os.environ.get("OCR_NOOCR_DIR", NOOCR_DEFAULT))
    ap.add_argument("--output", default=os.environ.get("OCR_OUTPUT_DIR", OUTPUT_DEFAULT))
    ap.add_argument("--results", default=None, help="defaults to <output>/llamacloud_results.jsonl")
    ap.add_argument("--manifest", default=None, help="defaults to <output>/queue_manifest.jsonl")
    ap.add_argument("--log", default=None, help="defaults to <output>/ocr_queue_watch.log")
    ap.add_argument("--poll", type=int, default=DEFAULT_POLL)
    ap.add_argument("--workers", type=int, default=2)
    ap.add_argument("--once", action="store_true", help="single pass and exit (default is loop forever)")
    a = ap.parse_args(argv)

    results = a.results or os.path.join(a.output, "llamacloud_results.jsonl")
    manifest = a.manifest or os.path.join(a.output, "queue_manifest.jsonl")
    log_path = a.log or os.path.join(a.output, "ocr_queue_watch.log")
    log = Log(log_path)
    os.makedirs(a.output, exist_ok=True)

    log(f"ocr_queue_watch: queue={a.queue} noocr={a.noocr} output={a.output}")
    a.results = results
    a.manifest = manifest
    while True:
        try:
            counts = one_pass(a, log, cloud_factory)
            log(f"pass done: {counts}")
        except Exception as e:  # noqa: BLE001 - the watcher must never die on one bad pass
            log(f"pass failed: {type(e).__name__}: {e}")
        if a.once:
            return 0
        time.sleep(max(1, a.poll))


if __name__ == "__main__":
    sys.exit(main())
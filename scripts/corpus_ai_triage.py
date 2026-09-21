"""AI triage of corpus files the low-resolution probe could not read: is this a document at all, or a photo/blank?

Runs against the LOCAL vision model (vLLM on the same machine); nothing leaves it. For each file it renders the first
page at modest size, asks for a fixed-schema label, and records only {kind, contains_readable_text, confidence}: no image,
no text, no description is stored. Output is a mode-0600 JSONL, resumable.

A file "fails" (is a candidate for quarantine) only when the model says it is a photo or blank, sees NO readable text, and
is confident. Anything else (documents, handwriting, screenshots, "other", low confidence, model errors) is kept.

  python corpus_ai_triage.py --survey survey.json --db app.db --statuses no_text,blank --out ai_labels.jsonl --sample 60
"""
import argparse
import base64
import io
import json
import os
import random
import sqlite3
import time
import urllib.request
from pathlib import Path

KINDS = ["document", "handwritten_document", "photo", "screenshot", "blank", "other"]
SCHEMA = {
    "type": "object",
    "properties": {
        "kind": {"type": "string", "enum": KINDS},
        "contains_readable_text": {"type": "boolean"},
        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
    },
    "required": ["kind", "contains_readable_text", "confidence"],
}
PROMPT = (
    "Classify this image for a document-intake system. kind: 'document' = printed or typed paperwork, forms, statements, "
    "letters, identity cards, licences, receipts; 'handwritten_document' = paper with handwriting; 'photo' = a photograph of "
    "people, places, objects or scenes with no paperwork as the subject; 'screenshot' = a screen capture of software or a "
    "web page; 'blank' = an empty or nearly empty image; 'other' = anything else. contains_readable_text: true if ANY words "
    "or numbers are legible anywhere in the image (signs and captions count). confidence: how sure you are of kind, 0 to 1."
)
MAX_SIDE = 1024
VERIFY_SIDE = 1536
MIN_CONFIDENCE = 0.85
SCHEMA2 = {
    "type": "object",
    "properties": {"contains_paperwork": {"type": "boolean"}, "contains_readable_text": {"type": "boolean"},
                   "confidence": {"type": "number", "minimum": 0, "maximum": 1}},
    "required": ["contains_paperwork", "contains_readable_text", "confidence"],
}
PROMPT2 = (
    "Look carefully at this image at full detail. contains_paperwork: true if it shows or includes ANY paperwork: a form, "
    "card, licence, passport, statement, letter, receipt, certificate, printed page, or handwriting on paper, even small, "
    "partial, rotated or faint. contains_readable_text: true if any words or numbers are legible anywhere. confidence: how "
    "sure you are of both answers, 0 to 1. When in doubt, answer true."
)
DELETABLE_KINDS = {"photo", "blank"}


def render(path: str, side: int = MAX_SIDE):
    from PIL import Image
    if path.lower().endswith(".pdf"):
        import pypdfium2 as pdfium
        doc = pdfium.PdfDocument(path)
        w, h = doc[0].get_size()
        im = doc[0].render(scale=side / max(w, h)).to_pil()
        doc.close()
    else:
        im = Image.open(path)
        im.draft("RGB", (side * 2, side * 2))
    im = im.convert("RGB")
    im.thumbnail((side, side))
    return im


def ask_qwen(image, url: str, model: str, timeout: float = 120.0) -> dict:
    buf = io.BytesIO()
    image.save(buf, "JPEG", quality=85)
    body = {
        "model": model, "temperature": 0, "max_tokens": 120,
        "chat_template_kwargs": {"enable_thinking": False},
        "response_format": {"type": "json_schema", "json_schema": {"name": "triage", "schema": SCHEMA}},
        "messages": [{"role": "user", "content": [
            {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()}},
            {"type": "text", "text": PROMPT}]}],
    }
    req = urllib.request.Request(url.rstrip("/") + "/v1/chat/completions", json.dumps(body).encode(), {"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(json.load(resp)["choices"][0]["message"]["content"])


def ask_qwen_verify(image, url: str, model: str, timeout: float = 120.0) -> dict:
    """Second, independent look: different wording, larger image, and a bias toward keeping the file."""
    buf = io.BytesIO()
    image.save(buf, "JPEG", quality=90)
    body = {
        "model": model, "temperature": 0, "max_tokens": 100,
        "chat_template_kwargs": {"enable_thinking": False},
        "response_format": {"type": "json_schema", "json_schema": {"name": "verify", "schema": SCHEMA2}},
        "messages": [{"role": "user", "content": [
            {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()}},
            {"type": "text", "text": PROMPT2}]}],
    }
    req = urllib.request.Request(url.rstrip("/") + "/v1/chat/completions", json.dumps(body).encode(), {"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(json.load(resp)["choices"][0]["message"]["content"])


def confirms(raw: dict) -> bool:
    """The second look confirms deletion only when it is confident there is neither paperwork nor readable text."""
    return (raw.get("contains_paperwork") is False and raw.get("contains_readable_text") is False
            and isinstance(raw.get("confidence"), (int, float)) and raw["confidence"] >= MIN_CONFIDENCE)


def verify(labels_path: str, out: str, paths: dict, ask2, render_fn=render):
    """Re-check every file the first pass failed. Writes {id, confirmed}; errors are never confirmed."""
    done = set()
    if os.path.exists(out):
        done = {json.loads(l)["id"] for l in open(out) if l.strip()}
    failing = [json.loads(l) for l in open(labels_path) if l.strip()]
    failing = [r for r in failing if r["fails"] and r["id"] not in done]
    fd = os.open(out, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    n = 0
    with os.fdopen(fd, "a") as f:
        for r in failing:
            try:
                im = render_fn(paths[r["id"]], VERIFY_SIDE)
                confirmed = confirms(ask2(im))
            except Exception:  # noqa: BLE001 - any doubt keeps the file
                confirmed = False
            f.write(json.dumps({"id": r["id"], "confirmed": confirmed}) + "\n")
            f.flush()
            n += 1
    return n


def normalise(raw: dict) -> dict:
    """Validate the model's answer; anything malformed becomes an 'error' label that is never deletable."""
    kind = raw.get("kind")
    text = raw.get("contains_readable_text")
    conf = raw.get("confidence")
    if kind not in KINDS or not isinstance(text, bool) or not isinstance(conf, (int, float)):
        return {"kind": "error", "contains_readable_text": True, "confidence": 0.0}
    return {"kind": kind, "contains_readable_text": text, "confidence": float(min(1, max(0, conf)))}


def fails_check(label: dict) -> bool:
    """True only for a confident 'photo' or 'blank' with no readable text anywhere."""
    return (label["kind"] in DELETABLE_KINDS and not label["contains_readable_text"] and label["confidence"] >= MIN_CONFIDENCE)


def run(rows, out: str, ask, render_fn=render, sample: int = 0, seed: int = 7):
    done = set()
    if os.path.exists(out):
        done = {json.loads(l)["id"] for l in open(out) if l.strip()}
    todo = [r for r in rows if r[0] not in done]
    if sample:
        todo = random.Random(seed).sample(todo, min(sample, len(todo)))
    fd = os.open(out, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    n = 0
    with os.fdopen(fd, "a") as f:
        for doc_id, status, path in todo:
            t = time.time()
            try:
                label = normalise(ask(render_fn(path)))
            except Exception as e:  # noqa: BLE001 - unreadable file or model error: recorded, kept, never deletable
                label = {"kind": "error", "contains_readable_text": True, "confidence": 0.0, "error": type(e).__name__}
            f.write(json.dumps({"id": doc_id, "survey": status, **label, "fails": fails_check(label), "secs": round(time.time() - t, 1)}) + "\n")
            f.flush()
            n += 1
            if n % 25 == 0:
                print(f"  {n}/{len(todo)}", flush=True)
    return n


def report(out: str) -> dict:
    rows = [json.loads(l) for l in open(out) if l.strip()]
    from collections import Counter
    return {"labelled": len(rows), "by_kind": dict(Counter(r["kind"] for r in rows)),
            "with_readable_text": sum(1 for r in rows if r["contains_readable_text"]),
            "would_fail": sum(1 for r in rows if r["fails"]),
            "mean_secs": round(sum(r["secs"] for r in rows) / max(1, len(rows)), 1)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--survey", required=True)
    ap.add_argument("--db", required=True)
    ap.add_argument("--statuses", default="no_text,blank")
    ap.add_argument("--out", required=True)
    ap.add_argument("--sample", type=int, default=0)
    ap.add_argument("--url", default="http://localhost:8000")
    ap.add_argument("--model", default="qwen-abliterated")
    ap.add_argument("--verify", metavar="VERIFIED_OUT", help="second-look every file the first pass failed; write confirmations here")
    a = ap.parse_args()
    if a.verify:
        con = sqlite3.connect(f"file:{a.db}?mode=ro", uri=True)
        n = verify(a.out, a.verify, dict(con.execute("select id, original_path from documents")), lambda im: ask_qwen_verify(im, a.url, a.model))
        rows = [json.loads(l) for l in open(a.verify) if l.strip()]
        print("DONE", json.dumps({"rechecked": n, "confirmed": sum(1 for r in rows if r["confirmed"]), "total_in_file": len(rows)}), flush=True)
        return
    wanted = set(a.statuses.split(","))
    survey = json.load(open(a.survey))
    con = sqlite3.connect(f"file:{a.db}?mode=ro", uri=True)
    paths = dict(con.execute("select id, original_path from documents"))
    rows = [(r["id"], r["status"], paths[r["id"]]) for r in survey["results"] if r["status"] in wanted and os.path.exists(paths.get(r["id"], ""))]
    print(f"{len(rows)} candidate files (statuses {sorted(wanted)})", flush=True)
    run(rows, a.out, lambda im: ask_qwen(im, a.url, a.model), sample=a.sample)
    print("DONE", json.dumps(report(a.out)), flush=True)


if __name__ == "__main__":
    main()

"""Bulk LlamaCloud analysis (parse + classify + extract with the 100+ field regex-catalogue schema) through an AUSTRALIAN
endpoint only. Run it from your desktop.

Why it can only talk to the Australian endpoint: this script has no region option. It always uses region "au", whose URL
you set from your LlamaIndex enterprise agreement (OCRDOCS_LLAMAPARSE_BASE_URL). If that is missing, or points at the
public North America / Europe hosts, it stops before sending anything. Nothing is uploaded unless you also pass --run and
type the endpoint's host name with --endpoint-host, so a wrong setting cannot start a bulk transfer.

Setup (PowerShell):
  $env:LLAMA_CLOUD_API_KEY = "<your key>"
  $env:OCRDOCS_LLAMAPARSE_BASE_URL = "https://<your australian endpoint>"      # when LlamaIndex gives you the details

Steps:
  python llamaparse_bulk.py --check --endpoint-host <host>                     invented page only: proves endpoint + key work
  python llamaparse_bulk.py --list files.txt --out results.jsonl                dry run: counts, sends nothing
  python llamaparse_bulk.py --list files.txt --out results.jsonl --run --endpoint-host <host> --max-files 50
  (raise --max-files gradually; re-running resumes and skips files already in results.jsonl)

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

REGION = "au"
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


def already_done(out: str) -> set:
    if not os.path.exists(out):
        return set()
    # only successes count as done, so a file that failed (network, budget, bad file) is retried on the next run
    return {r["file"] for r in (json.loads(l) for l in open(out, encoding="utf-8") if l.strip()) if r.get("ok")}


def analyse_one(path: str, cloud) -> Dict:
    t = time.time()
    try:
        r = cloud.analyze(Path(path).read_bytes(), Path(path).name)
        return {"file": path, "ok": True, "document_type": r.document_type, "type_confidence": r.type_confidence,
                "type_reasoning": r.type_reasoning, "fields": r.fields, "pages": len(r.page_texts), "credits": r.credits,
                "errors": r.errors, "secs": round(time.time() - t, 1)}
    except Exception as e:  # noqa: BLE001 - one bad file must never stop a bulk run; it is recorded and retried next run
        return {"file": path, "ok": False, "error": f"{type(e).__name__}: {e}"[:300], "secs": round(time.time() - t, 1)}


def run(files: List[str], out: str, cloud, workers: int = 3, max_files: int = 50, log: Callable[[str], None] = print) -> Counter:
    """Analyse up to max_files not-yet-done files, appending one JSON line per file. Resumable."""
    done = already_done(out)
    pending = [f for f in files if f not in done][:max_files]
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


def endpoint_or_exit(confirm_host: Optional[str], need_confirm: bool) -> str:
    try:
        url = lp.base_url(REGION)
    except lp.LlamaParseUnavailable as e:
        sys.exit(f"STOPPED, nothing sent: {e}")
    host = urlparse(url).hostname or ""
    print(f"Australian endpoint configured: {url}")
    if need_confirm and (confirm_host or "").lower() != host.lower():
        sys.exit(f"STOPPED, nothing sent: to proceed pass --endpoint-host {host} (typing the host confirms this is the endpoint you mean)")
    if not os.environ.get("LLAMA_CLOUD_API_KEY"):
        sys.exit("STOPPED, nothing sent: LLAMA_CLOUD_API_KEY is not set")
    return url


def make_cloud(max_files: int):
    return llc.LlamaCloud(lp.LlamaParse(region=REGION, max_calls=max(1, max_files)))


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


def main(argv: Optional[List[str]] = None, cloud_factory: Callable[[int], object] = make_cloud) -> int:
    ap = argparse.ArgumentParser(description="Bulk LlamaCloud analysis through the Australian endpoint only.")
    ap.add_argument("--list", help="text file with one document path per line")
    ap.add_argument("--folder", help="a folder tree of documents")
    ap.add_argument("--out", help="results file (JSON lines)")
    ap.add_argument("--run", action="store_true", help="actually send files (default is a dry run that sends nothing)")
    ap.add_argument("--check", action="store_true", help="send ONE invented page to prove the endpoint and key work")
    ap.add_argument("--endpoint-host", help="the Australian endpoint's host name; required to send anything")
    ap.add_argument("--workers", type=int, default=3)
    ap.add_argument("--max-files", type=int, default=50, help="most files to send this run (default 50)")
    a = ap.parse_args(argv)

    if a.check:
        endpoint_or_exit(a.endpoint_host, need_confirm=True)
        r = cloud_factory(1).analyze(synthetic_page(), "invented_test_page.png")
        print(f"document type: {r.document_type} ({r.type_confidence}); {len(r.fields)} fields; credits {r.credits}; errors {r.errors}")
        for f in r.fields:
            print(f"  {f['subject']:<9} {f['name']:<24} {f['value']}")
        return 0

    if not (a.list or a.folder) or not a.out:
        ap.error("give --list or --folder, and --out (or use --check)")
    files = collect(a.list, a.folder)
    pending = [f for f in files if f not in already_done(a.out)]
    to_send = min(len(pending), a.max_files)
    print(f"{len(files)} supported files found, {len(files) - len(pending)} already in {a.out}, {len(pending)} pending, "
          f"this run would send {to_send}")
    if not a.run:
        print("DRY RUN: nothing was sent. Add --run --endpoint-host <host> to send.")
        return 0
    endpoint_or_exit(a.endpoint_host, need_confirm=True)
    counts = run(files, a.out, cloud_factory(to_send), a.workers, a.max_files)
    print(f"finished: ok {counts['ok']}, failed {counts['failed']}, credits used {counts['credits']:.0f}; results in {a.out}")
    if counts["failed"]:
        print("failed files were recorded with their error and are retried on the next run (they are not skipped).")
    return 0 if not counts["failed"] else 1


if __name__ == "__main__":
    sys.exit(main())

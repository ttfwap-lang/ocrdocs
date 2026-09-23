"""Parse-only LlamaCloud run that SAVES the full page text (markdown) of every document. No classify, no extract, so a file
costs exactly one parse at the tier you pick. Use it to get readable text (handwriting included) out of scans.

  python llamaparse_text.py --folder D:\\Recovered_C --out-dir results\\rc_agentic_plus --tier agentic_plus \\
        --region us --endpoint-host api.cloud.llamaindex.ai --run --max-files 20
  python llamaparse_text.py --list files.txt --out-dir results\\medica_cost --tier cost_effective ...     (dry run without --run)

Same safeguards as llamaparse_bulk.py: dry run unless --run; nothing is sent unless --endpoint-host matches the configured
endpoint's host; africa is refused; the API key is read only from LLAMA_CLOUD_API_KEY (never written anywhere); each cloud job
is submitted with disable_cache and deleted after its text is read; capped per run; resumable (files already done are skipped,
failed ones are retried). Output per file: <out-dir>/<sha8>_<name>.md, plus <out-dir>/index.jsonl (file, ok, pages, chars,
credits if the API reports them, seconds). The .md files contain the extracted text of personal documents: keep them private.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import threading
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Callable, Dict, List, Optional

sys.path.insert(0, str(Path(__file__).resolve().parent))
import llamaparse_bulk as lb  # noqa: E402
import ocr_llamacloud as llc  # noqa: E402
import ocr_llamaparse as lp  # noqa: E402


def out_name(path: str) -> str:
    return f"{hashlib.sha256(path.encode('utf-8', 'ignore')).hexdigest()[:8]}_{Path(path).stem[:50]}.md".replace(" ", "_")


def done_set(index: str) -> set:
    if not os.path.exists(index):
        return set()
    return {r["file"] for r in (json.loads(l) for l in open(index, encoding="utf-8") if l.strip()) if r.get("ok")}


def parse_one(client: "lp.LlamaParse", path: str, out_dir: str) -> Dict:
    t = time.time()
    job = None
    try:
        ext = Path(path).suffix.lower()
        body, ctype = lp._multipart_file(Path(path).read_bytes(), Path(path).name, llc.MIME[ext],
                                        {"tier": client.tier, "version": "latest", "disable_cache": True})
        with client._lock:
            if client.calls >= client.max_calls:
                raise lp.LlamaParseUnavailable("per-run call budget reached")
            client.calls += 1
        st, up = client._call("POST", "/api/v2/parse/upload", body, ctype)
        if st >= 300 or not isinstance(up, dict) or "id" not in up:
            raise lp.LlamaParseUnavailable(f"upload rejected (HTTP {st}): {str(up)[:160]}")
        job = up["id"]
        deadline = client.clock() + lp.JOB_TIMEOUT_SECONDS * 3
        while True:
            st, data = client._call("GET", f"/api/v2/parse/{job}?expand=markdown,metadata")
            if st >= 300 or not isinstance(data, dict):
                raise lp.LlamaParseUnavailable(f"poll failed (HTTP {st})")
            state = (data.get("job") or {}).get("status")
            if state == "COMPLETED":
                break
            if state in ("FAILED", "CANCELLED"):
                raise lp.LlamaParseUnavailable(f"job {state.lower()}: {(data.get('job') or {}).get('error_message')}")
            if client.clock() > deadline:
                raise lp.LlamaParseUnavailable("job timed out")
            client.sleep(lp.POLL_SECONDS)
        pages = [p.get("markdown", "") for p in ((data.get("markdown") or {}).get("pages")) or [] if p.get("success", True)]
        text = "\n\n---\n\n".join(pages)
        fd = os.open(os.path.join(out_dir, out_name(path)), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text)
        usage = data.get("usage") or (data.get("job") or {}).get("usage") or (data.get("job") or {}).get("credits_used")
        return {"file": path, "ok": True, "tier": client.tier, "pages": len(pages), "chars": len(text), "usage": usage,
                "md": out_name(path), "secs": round(time.time() - t, 1)}
    except lp.LlamaParseUnavailable as e:
        return {"file": path, "ok": False, "tier": client.tier, "error": str(e)[:250], "secs": round(time.time() - t, 1)}
    except Exception as e:  # noqa: BLE001 - one bad file never stops the run; never echo headers or keys
        return {"file": path, "ok": False, "tier": client.tier, "error": f"{type(e).__name__}", "secs": round(time.time() - t, 1)}
    finally:
        if job:
            try:
                client._call("DELETE", f"/api/v2/parse/{job}", timeout=30.0)
            except Exception:  # noqa: BLE001 - best effort; the vendor's 48 h expiry still applies
                pass


def run(files: List[str], out_dir: str, client, workers: int, max_files: int, log: Callable[[str], None] = print) -> Counter:
    os.makedirs(out_dir, exist_ok=True)
    index = os.path.join(out_dir, "index.jsonl")
    done = done_set(index)
    pending = [f for f in files if f not in done][:max_files]
    counts: Counter = Counter()
    lock = threading.Lock()
    with open(index, "a", encoding="utf-8") as fh:
        def work(p: str) -> None:
            rec = parse_one(client, p, out_dir)
            with lock:
                fh.write(json.dumps(rec) + "\n")
                fh.flush()
                counts["ok" if rec["ok"] else "failed"] += 1
                counts["pages"] += rec.get("pages") or 0
                n = counts["ok"] + counts["failed"]
                if n % 10 == 0 or n == len(pending):
                    log(f"  {n}/{len(pending)}  ok {counts['ok']}  failed {counts['failed']}  pages {counts['pages']}")
        with ThreadPoolExecutor(max_workers=max(1, min(workers, lb.MAX_WORKERS))) as pool:
            list(pool.map(work, pending))
    return counts


def main(argv: Optional[List[str]] = None, client_factory: Optional[Callable] = None) -> int:
    ap = argparse.ArgumentParser(description="Parse-only LlamaCloud run that saves page text.")
    ap.add_argument("--list")
    ap.add_argument("--folder")
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--tier", required=True, choices=list(lp.TIERS))
    ap.add_argument("--region", default="us", help="au, eu, us (africa is banned)")
    ap.add_argument("--endpoint-host")
    ap.add_argument("--run", action="store_true")
    ap.add_argument("--workers", type=int, default=3)
    ap.add_argument("--max-files", type=int, default=20)
    a = ap.parse_args(argv)
    if not (a.list or a.folder):
        ap.error("give --list or --folder")
    files = lb.collect(a.list, a.folder)
    done = done_set(os.path.join(a.out_dir, "index.jsonl"))
    pending = [f for f in files if f not in done]
    to_send = min(len(pending), a.max_files)
    print(f"{len(files)} supported files, {len(files) - len(pending)} already done, {len(pending)} pending; this run would send {to_send} "
          f"at tier {a.tier} via region {a.region}")
    if not a.run:
        print("DRY RUN: nothing sent. Add --run --endpoint-host <host>.")
        return 0
    lb.endpoint_or_exit(a.region, a.endpoint_host, need_confirm=True)
    client = client_factory(a.region, a.tier, max(1, to_send)) if client_factory else lp.LlamaParse(region=a.region, tier=a.tier, max_calls=max(1, to_send))
    counts = run(files, a.out_dir, client, a.workers, a.max_files)
    print(f"finished: ok {counts['ok']}, failed {counts['failed']}, pages {counts['pages']}; text in {a.out_dir}; see index.jsonl")
    return 0 if not counts["failed"] else 1


if __name__ == "__main__":
    sys.exit(main())

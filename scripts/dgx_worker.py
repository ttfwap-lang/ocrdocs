#!/usr/bin/env python3
"""
DGX pull-based job worker (Phase 2).

Polls the app server for queued documents, downloads the original, runs the
real multi-pass pipeline in ocr_spark_engine.py (process_document_multipass),
and posts the result back. The DGX always initiates the HTTP connection
outward — no inbound network access to the DGX box is required.

Every field this worker sends back comes from an actual pass that actually
ran (see ocr_spark_engine.process_document_multipass). This worker does not
invent pass timings, engine names, or field values.

Configuration (environment variables):
  OCRDOCS_SERVER_URL              Base URL of the app server, e.g.
                                   https://ais-dev-....run.app
  DGX_WORKER_TOKEN                 Shared-secret bearer token; must match the
                                   server's DGX_WORKER_TOKEN exactly.
  OCRDOCS_POLL_INTERVAL_SECONDS    Seconds to wait between polls when idle
                                   (default 5).
  OCRDOCS_MAX_PASSES               Max OCR passes per document (default 10).
  OCRDOCS_WORKER_DOWNLOAD_DIR      Scratch dir for downloaded originals
                                   (default: <tempdir>/ocrdocs_worker).
"""

import os
import sys
import time
import logging
import tempfile
from pathlib import Path
from typing import Any, Dict, Optional

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ocr_spark_engine import process_document_multipass  # noqa: E402

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)

SERVER_URL = os.environ.get("OCRDOCS_SERVER_URL", "").rstrip("/")
WORKER_TOKEN = os.environ.get("DGX_WORKER_TOKEN", "")
POLL_INTERVAL_SECONDS = float(os.environ.get("OCRDOCS_POLL_INTERVAL_SECONDS", "5"))
MAX_PASSES = int(os.environ.get("OCRDOCS_MAX_PASSES", "10"))
DOWNLOAD_DIR = Path(
    os.environ.get("OCRDOCS_WORKER_DOWNLOAD_DIR", str(Path(tempfile.gettempdir()) / "ocrdocs_worker"))
)


def _headers() -> Dict[str, str]:
    return {"Authorization": f"Bearer {WORKER_TOKEN}"}


def claim_job() -> Optional[Dict[str, Any]]:
    """Atomically claims the next queued job, or None if the queue is empty."""
    resp = requests.get(f"{SERVER_URL}/api/jobs/claim", headers=_headers(), timeout=30)
    if resp.status_code == 204:
        return None
    resp.raise_for_status()
    return resp.json()


def download_job_file(job_id: str, filename: str) -> Path:
    DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
    safe_name = "".join(c for c in filename if c.isalnum() or c in "._-") or "document"
    dest = DOWNLOAD_DIR / f"{job_id}-{safe_name}"
    with requests.get(f"{SERVER_URL}/api/jobs/{job_id}/file", headers=_headers(), timeout=120, stream=True) as resp:
        resp.raise_for_status()
        with open(dest, "wb") as f:
            for chunk in resp.iter_content(chunk_size=1 << 16):
                f.write(chunk)
    return dest


def post_result(job_id: str, payload: Dict[str, Any]) -> None:
    resp = requests.post(f"{SERVER_URL}/api/jobs/{job_id}/result", headers=_headers(), json=payload, timeout=60)
    resp.raise_for_status()


def process_claimed_job(claim: Dict[str, Any]) -> None:
    job = claim["job"]
    document = claim["document"]
    job_id = job["id"]
    logging.info(f"[*] Claimed job {job_id} ({document.get('filename')})")

    try:
        local_path = download_job_file(job_id, document.get("filename", "document"))
    except requests.RequestException as e:
        logging.error(f"[-] Job {job_id}: failed to download original: {e}")
        post_result(job_id, {"status": "FAILED", "error": f"Download failed: {e}"})
        return

    try:
        result = process_document_multipass(str(local_path), max_passes=MAX_PASSES)
    except Exception as e:
        logging.exception(f"[-] Job {job_id}: pipeline raised an unhandled exception")
        post_result(job_id, {"status": "FAILED", "error": str(e)})
        return
    finally:
        try:
            local_path.unlink(missing_ok=True)
        except Exception:
            pass

    if result.get("status") != "SUCCESS":
        error = result.get("error", "Unknown pipeline failure")
        logging.warning(f"[!] Job {job_id}: pipeline reported failure: {error}")
        post_result(job_id, {"status": "FAILED", "error": error})
        return

    post_result(job_id, {
        "status": "SUCCESS",
        "rawText": result["rawText"],
        "passes": result["passes"],
        "engineUsed": result["engineUsed"],
    })
    logging.info(f"[+] Job {job_id}: complete ({len(result['passes'])} passes run).")


def main() -> None:
    if not SERVER_URL:
        logging.error("OCRDOCS_SERVER_URL is not set.")
        sys.exit(1)
    if not WORKER_TOKEN:
        logging.error("DGX_WORKER_TOKEN is not set.")
        sys.exit(1)

    logging.info(f"[*] DGX worker polling {SERVER_URL} every {POLL_INTERVAL_SECONDS}s (max {MAX_PASSES} passes/doc)")
    while True:
        try:
            claim = claim_job()
        except requests.RequestException as e:
            logging.error(f"[-] Claim request failed: {e}")
            time.sleep(POLL_INTERVAL_SECONDS)
            continue

        if claim is None:
            time.sleep(POLL_INTERVAL_SECONDS)
            continue

        process_claimed_job(claim)


if __name__ == "__main__":
    main()

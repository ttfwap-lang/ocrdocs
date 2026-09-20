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
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError
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
# Coarse outer deadline for one document's whole multipass run. Individual
# engine calls inside ocr_spark_engine already carry their own per-call
# timeout (OCRDOCS_ENGINE_TIMEOUT_SECONDS), but this is defense in depth: the
# worker has a single poll loop, so any one job hanging blocks every other
# queued document indefinitely without a job-level ceiling too.
#
# Deliberately NOT a persistent shared executor -- caught by review, not
# just theory: future.result(timeout=...) only stops the CALLER waiting, it
# cannot stop a genuinely hung thread. A shared max_workers=1 pool means the
# FIRST job that legitimately times out leaves that one worker slot
# permanently occupied by the orphaned call forever, so the second job's
# .submit() queues indefinitely behind it -- a single real timeout would
# have permanently stalled the entire worker for every job after it. Each
# job now gets a fresh single-use executor instead.
JOB_TIMEOUT_SECONDS = float(os.environ.get("OCRDOCS_JOB_TIMEOUT_SECONDS", "600"))


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

    job_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="ocr-job")
    timed_out = False
    try:
        future = job_executor.submit(process_document_multipass, str(local_path), max_passes=MAX_PASSES)
        result = future.result(timeout=JOB_TIMEOUT_SECONDS)
    except FutureTimeoutError:
        timed_out = True
        logging.error(f"[-] Job {job_id}: pipeline exceeded {JOB_TIMEOUT_SECONDS}s job-level timeout, abandoning.")
        post_result(job_id, {"status": "FAILED", "error": f"Pipeline exceeded {JOB_TIMEOUT_SECONDS}s timeout"})
        return
    except Exception as e:
        logging.exception(f"[-] Job {job_id}: pipeline raised an unhandled exception")
        post_result(job_id, {"status": "FAILED", "error": str(e)})
        return
    finally:
        # wait=False: on a timeout above, the underlying call may still be
        # genuinely running (there's no way to force-kill it from Python) --
        # don't block this function's return on it, just let this whole
        # single-use executor be abandoned/orphaned rather than reused.
        job_executor.shutdown(wait=False)
        if timed_out:
            # The orphaned thread from the timeout above may still be
            # genuinely reading local_path (process_document_multipass opens
            # it directly by path, possibly mid-read inside pdfium/PIL).
            # Deleting it here races that read: best case the orphaned call
            # then fails with a spurious file-not-found instead of just
            # finishing pointlessly; worst case (Windows, a still-open
            # handle) the delete itself fails or corrupts the read. Leaking
            # this one file is the safer failure mode -- it's a bounded,
            # log-visible cost, not a silent data race.
            logging.warning(
                f"[!] Job {job_id}: leaving temp file {local_path} in place -- "
                "an orphaned thread from the timeout above may still be reading it."
            )
        else:
            try:
                local_path.unlink(missing_ok=True)
            except Exception as e:
                # Not fatal to the job, but a failed delete on a long-running
                # worker silently leaks disk over time if never logged.
                logging.warning(f"[!] Job {job_id}: failed to remove temp file {local_path}: {e}")

    if result.get("status") != "SUCCESS":
        error = result.get("error", "Unknown pipeline failure")
        logging.warning(f"[!] Job {job_id}: pipeline reported failure: {error}")
        post_result(job_id, {"status": "FAILED", "error": error})
        return

    payload = {
        "status": "SUCCESS",
        "rawText": result["rawText"],
        "passes": result["passes"],
        "engineUsed": result["engineUsed"],
    }
    if result.get("vlmFields") or result.get("pages"):  # vlm_v2 pipeline only
        payload["pages"] = result.get("pages", [])
        payload["vlmFields"] = result.get("vlmFields", [])
        payload["documentType"] = result.get("documentType", "other")
    post_result(job_id, payload)
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

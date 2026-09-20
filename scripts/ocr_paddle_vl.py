"""PaddleOCR-VL client: reads printed text from a page image via a vLLM OpenAI-compatible endpoint.

The model is served in its own container (see scripts/vllm_services.sh); this module only speaks HTTP, so the
worker needs no Paddle packages. The "OCR:" prompt and endpoint shape are the ones benchmarked on the GB10
(71.6 pages/min at concurrency 32, 0 errors on 127 pages).
"""
from __future__ import annotations

import base64
import io
import json
import logging
import os
import time
import urllib.request
from typing import Callable, Optional

from PIL import Image

PADDLE_URL = os.environ.get("OCRDOCS_PADDLE_URL", "http://localhost:8100")
PADDLE_MODEL = os.environ.get("OCRDOCS_PADDLE_MODEL", "paddle")
PADDLE_PROMPT = os.environ.get("OCRDOCS_PADDLE_PROMPT", "OCR:")
PADDLE_TIMEOUT = float(os.environ.get("OCRDOCS_PADDLE_TIMEOUT_SECONDS", "120"))
PADDLE_RETRIES = int(os.environ.get("OCRDOCS_PADDLE_RETRIES", "2"))
PADDLE_MAX_TOKENS = int(os.environ.get("OCRDOCS_PADDLE_MAX_TOKENS", "4096"))


class PaddleUnavailable(RuntimeError):
    """The endpoint could not be reached or kept failing; callers fall back to the Tesseract path."""


def image_to_data_url(image: Image.Image) -> str:
    buf = io.BytesIO()
    image.convert("RGB").save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def _post_json(url: str, body: dict, timeout: float) -> dict:
    req = urllib.request.Request(url, json.dumps(body).encode(), {"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.load(resp)


def read_page(
    image: Image.Image,
    post: Callable[[str, dict, float], dict] = _post_json,
    base_url: Optional[str] = None,
) -> str:
    """Return the printed text of one page. Raises PaddleUnavailable after the retries are spent."""
    body = {
        "model": PADDLE_MODEL,
        "temperature": 0,
        "max_tokens": PADDLE_MAX_TOKENS,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "image_url", "image_url": {"url": image_to_data_url(image)}},
                {"type": "text", "text": PADDLE_PROMPT},
            ],
        }],
    }
    url = (base_url or PADDLE_URL).rstrip("/") + "/v1/chat/completions"
    last: Optional[Exception] = None
    for attempt in range(1, PADDLE_RETRIES + 2):
        try:
            data = post(url, body, PADDLE_TIMEOUT)
            return (data["choices"][0]["message"].get("content") or "").strip()
        except Exception as e:  # noqa: BLE001 - network, HTTP and malformed-body errors all mean "try again, then fall back"
            last = e
            logging.warning(f"[!] Paddle-VL attempt {attempt} failed: {e}")
            if attempt <= PADDLE_RETRIES:
                time.sleep(min(2 ** attempt, 8))
    raise PaddleUnavailable(f"Paddle-VL at {url} failed after {PADDLE_RETRIES + 1} attempts: {last}")

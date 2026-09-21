"""LlamaParse (LlamaCloud v2) client: an optional CLOUD reader for flagged pages or regions.

DATA WARNING. This sends page images to LlamaIndex's servers. Managed LlamaCloud has only two regions, North America
(us-east-1) and Europe (eu-central-1); there is no Australian region, so every page sent leaves Australia. The vendor
states files are cached for 48 hours then deleted, and are never used for model training. Nothing here is on by default:
OCRDOCS_LLAMAPARSE must be "region", "page" or "full" and LLAMA_CLOUD_API_KEY must be set in the worker's environment (never in
the repo). The owner should decide whether sending identity documents offshore is acceptable (Privacy Act, APP 8).

Data-minimising defaults, all in code:
  * mode "region": only crops the agent asks to re-read are sent (a BSB or account-number box carries little context);
    mode "page" additionally allows whole flagged pages; mode "full" sends every PDF/image file for parse + classify +
    extract (see ocr_llamacloud.py), the maximum use of the service.
  * every job is submitted with disable_cache=true and the job is DELETEd as soon as the result has been read.
  * OCRDOCS_LLAMAPARSE_MAX_CALLS caps pages sent per worker process, bounding both exposure and cost.
The key is read from the environment per call and never logged; error messages never include request headers.
"""
from __future__ import annotations

import io
import json
import logging
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Tuple

from PIL import Image

BASES = {"na": "https://api.cloud.llamaindex.ai", "eu": "https://api.cloud.eu.llamaindex.ai"}
REGIONS = ("na", "eu", "au")
# "au" is the Australian (Sydney) endpoint LlamaIndex offers enterprise customers. Its URL comes from the customer's own
# agreement, so it is a setting (OCRDOCS_LLAMAPARSE_BASE_URL), never a guess in code.
PUBLIC_HOSTS = {"api.cloud.llamaindex.ai", "api.cloud.eu.llamaindex.ai", "cloud.llamaindex.ai", "cloud.eu.llamaindex.ai"}
TIERS = ("fast", "cost_effective", "agentic", "agentic_plus")
POLL_SECONDS = 3.0
JOB_TIMEOUT_SECONDS = float(os.environ.get("OCRDOCS_LLAMAPARSE_TIMEOUT_SECONDS", "180"))

Http = Callable[[str, str, Dict[str, str], Optional[bytes], float], Tuple[int, Any]]


class LlamaParseUnavailable(RuntimeError):
    """Disabled, unconfigured, over its call budget, or the service failed; callers continue without it."""


@dataclass
class Block:
    text: str
    bbox: Optional[Tuple[float, float, float, float]]  # x, y, w, h as LlamaParse reports them (page coordinates)
    confidence: Optional[float]


@dataclass
class ParsedPage:
    text: str
    blocks: List[Block] = field(default_factory=list)
    confidence: Optional[float] = None


def base_url(region: str) -> str:
    """API base URL for a region. "au" must be configured and must not point at the public North America/Europe hosts."""
    if region in BASES:
        return BASES[region]
    if region != "au":
        raise LlamaParseUnavailable(f"unknown region '{region}' (na|eu|au)")
    url = os.environ.get("OCRDOCS_LLAMAPARSE_BASE_URL", "").strip().rstrip("/")
    if not url.startswith("https://"):
        raise LlamaParseUnavailable("region 'au' needs OCRDOCS_LLAMAPARSE_BASE_URL (an https:// URL from your LlamaIndex enterprise agreement)")
    host = (urllib.parse.urlparse(url).hostname or "").lower()
    if host in PUBLIC_HOSTS:
        raise LlamaParseUnavailable(f"'{host}' is a public North America/Europe host, not an Australian endpoint")
    return url


def mode() -> str:
    m = os.environ.get("OCRDOCS_LLAMAPARSE", "off").strip().lower()
    return m if m in ("region", "page", "full") else "off"


def allows_full_pages() -> bool:
    return mode() in ("page", "full")


def _default_http(method: str, url: str, headers: Dict[str, str], body: Optional[bytes], timeout: float) -> Tuple[int, Any]:
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            return resp.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw)
        except ValueError:
            return e.code, raw.decode("utf-8", "replace")[:300]


def _multipart(png: bytes, configuration: dict) -> Tuple[bytes, str]:
    return _multipart_file(png, "page.png", "image/png", configuration)


def _multipart_file(data: bytes, filename: str, mime: str, configuration: dict) -> Tuple[bytes, str]:
    b = "----ocrdocs" + uuid.uuid4().hex
    safe = re.sub(r"[^A-Za-z0-9._-]", "_", filename)[:80]  # a filename must never break out of the header
    crlf = bytes((13, 10))
    head = f'--{b}'.encode() + crlf + b'Content-Disposition: form-data; name="configuration"' + crlf + crlf
    file_head = f'--{b}'.encode() + crlf + f'Content-Disposition: form-data; name="file"; filename="{safe}"'.encode() + crlf
    file_head += f"Content-Type: {mime}".encode() + crlf + crlf
    body = head + json.dumps(configuration).encode() + crlf + file_head + data + crlf + f"--{b}--".encode() + crlf
    return body, f"multipart/form-data; boundary={b}"



class LlamaParse:
    def __init__(
        self,
        api_key: Optional[str] = None,
        region: Optional[str] = None,
        tier: Optional[str] = None,
        max_calls: Optional[int] = None,
        http: Http = _default_http,
        sleep: Callable[[float], None] = time.sleep,
        clock: Callable[[], float] = time.monotonic,
    ):
        self._key = api_key
        self.region = (region or os.environ.get("OCRDOCS_LLAMAPARSE_REGION", "na")).lower()
        # cost_effective kept line text verbatim in a live synthetic test; agentic re-wrote a form and dropped a label
        self.tier = tier or os.environ.get("OCRDOCS_LLAMAPARSE_TIER", "cost_effective")
        self.max_calls = max_calls if max_calls is not None else int(os.environ.get("OCRDOCS_LLAMAPARSE_MAX_CALLS", "200"))
        self.http, self.sleep, self.clock = http, sleep, clock
        self.calls = 0
        self._lock = threading.Lock()

    def _api_key(self) -> str:
        key = self._key or os.environ.get("LLAMA_CLOUD_API_KEY", "")
        if not key:
            raise LlamaParseUnavailable("LLAMA_CLOUD_API_KEY is not set")
        return key

    def _call(self, method: str, path: str, body: Optional[bytes] = None, content_type: Optional[str] = None, timeout: float = 60.0):
        headers = {"Authorization": f"Bearer {self._api_key()}", "Accept": "application/json"}
        if content_type:
            headers["Content-Type"] = content_type
        return self.http(method, base_url(self.region) + path, headers, body, timeout)

    def parse_page(self, image: Image.Image) -> ParsedPage:
        """Upload one page or crop, wait for the result, read it, then delete the job. Raises LlamaParseUnavailable."""
        if mode() == "off" and self._key is None:
            raise LlamaParseUnavailable("OCRDOCS_LLAMAPARSE is off")
        if self.region not in REGIONS:
            raise LlamaParseUnavailable(f"unknown region '{self.region}' (na|eu|au)")
        base_url(self.region)  # an "au" region without a valid configured endpoint fails here, before anything is uploaded
        if self.tier not in TIERS:
            raise LlamaParseUnavailable(f"unknown tier '{self.tier}'")
        with self._lock:
            if self.calls >= self.max_calls:
                raise LlamaParseUnavailable(f"call budget of {self.max_calls} reached for this worker")
            self.calls += 1
        buf = io.BytesIO()
        image.convert("RGB").save(buf, "PNG")
        body, ctype = _multipart(buf.getvalue(), {"tier": self.tier, "version": "latest", "disable_cache": True})
        job_id: Optional[str] = None
        try:
            status, data = self._call("POST", "/api/v2/parse/upload", body, ctype)
            if status >= 300 or not isinstance(data, dict) or "id" not in data:
                raise LlamaParseUnavailable(f"upload rejected (HTTP {status}): {str(data)[:200]}")
            job_id = data["id"]
            deadline = self.clock() + JOB_TIMEOUT_SECONDS
            while True:
                status, data = self._call("GET", f"/api/v2/parse/{job_id}?expand=markdown,items,metadata")
                if status >= 300 or not isinstance(data, dict):
                    raise LlamaParseUnavailable(f"poll failed (HTTP {status})")
                state = (data.get("job") or {}).get("status")
                if state == "COMPLETED":
                    return _to_page(data)
                if state in ("FAILED", "CANCELLED"):
                    raise LlamaParseUnavailable(f"job {state.lower()}: {(data.get('job') or {}).get('error_message')}")
                if self.clock() > deadline:
                    raise LlamaParseUnavailable(f"job still {state} after {JOB_TIMEOUT_SECONDS:.0f}s")
                self.sleep(POLL_SECONDS)
        except LlamaParseUnavailable:
            raise
        except Exception as e:  # noqa: BLE001 - network errors; never let a key or header leak into the message
            raise LlamaParseUnavailable(f"LlamaParse request failed: {type(e).__name__}") from None
        finally:
            if job_id:
                try:
                    self._call("DELETE", f"/api/v2/parse/{job_id}", timeout=30.0)
                except Exception as e:  # noqa: BLE001 - deletion is best effort; the vendor's 48 h expiry still applies
                    logging.warning(f"[!] LlamaParse job {job_id} could not be deleted ({type(e).__name__}); it expires in 48h")


def _to_page(data: Dict[str, Any]) -> ParsedPage:
    pages = ((data.get("markdown") or {}).get("pages")) or []
    text = "\n\n".join(p.get("markdown", "") for p in pages if p.get("success", True)).strip()
    blocks: List[Block] = []
    for page in ((data.get("items") or {}).get("pages")) or []:
        for it in page.get("items", []):
            bb = (it.get("bbox") or [None])[0] or {}
            box = (bb["x"], bb["y"], bb["w"], bb["h"]) if all(k in bb for k in "xywh") else None
            blocks.append(Block(str(it.get("value") or it.get("md") or ""), box, bb.get("confidence")))
    meta = ((data.get("metadata") or {}).get("pages")) or []
    return ParsedPage(text, blocks, meta[0].get("confidence") if meta else None)

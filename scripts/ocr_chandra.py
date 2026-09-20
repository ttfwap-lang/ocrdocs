"""Chandra OCR 2 client: a second, independent printed-text reader used to cross-check Paddle-VL.

Served in its own vLLM container (scripts/vllm_services.sh, port 8300, started on demand: it is slow, ~14 pages/min at
concurrency 32 on the GB10, and memory hungry). The model answers "OCR this image to HTML." with one <div> per layout
block carrying data-label and data-bbox. Image blocks contain a generated *description*, not page text, so they are
kept as blocks but never mixed into the text.

Licence: Chandra's weights are modified OpenRAIL-M (free below $2M funding/revenue, not for competing with the vendor's
API). Confirm that fits before running it on production data.
"""
from __future__ import annotations

import logging
import os
import re
import time
from dataclasses import dataclass, field
from html.parser import HTMLParser
from typing import Callable, List, Optional

from PIL import Image

from ocr_paddle_vl import _post_json, image_to_data_url

CHANDRA_URL = os.environ.get("OCRDOCS_CHANDRA_URL", "http://localhost:8300")
CHANDRA_MODEL = os.environ.get("OCRDOCS_CHANDRA_MODEL", "chandra")
CHANDRA_PROMPT = os.environ.get("OCRDOCS_CHANDRA_PROMPT", "OCR this image to HTML.")
CHANDRA_TIMEOUT = float(os.environ.get("OCRDOCS_CHANDRA_TIMEOUT_SECONDS", "300"))
CHANDRA_RETRIES = int(os.environ.get("OCRDOCS_CHANDRA_RETRIES", "1"))
CHANDRA_MAX_TOKENS = int(os.environ.get("OCRDOCS_CHANDRA_MAX_TOKENS", "8192"))
NON_TEXT_LABELS = {"image", "figure", "picture", "logo"}


class ChandraUnavailable(RuntimeError):
    """Endpoint down or failing; callers continue without the second opinion."""


@dataclass
class Block:
    label: str
    bbox: Optional[List[int]]
    text: str


@dataclass
class ChandraPage:
    text: str
    blocks: List[Block] = field(default_factory=list)


class _Blocks(HTMLParser):
    """Top-level <div data-label data-bbox> blocks -> text, with <br>, <p>, <tr> as line breaks and <td> as tabs."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.blocks: List[Block] = []
        self._depth = 0
        self._label = ""
        self._bbox: Optional[List[int]] = None
        self._buf: List[str] = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "div":
            if self._depth == 0:
                self._label = (a.get("data-label") or "Text").strip()
                bb = a.get("data-bbox") or ""
                self._bbox = [int(x) for x in re.findall(r"-?\d+", bb)][:4] or None
                self._buf = []
            self._depth += 1
        elif self._depth and tag in ("br", "p", "tr", "li", "h1", "h2", "h3", "h4"):
            self._buf.append("\n")
        elif self._depth and tag in ("td", "th"):
            self._buf.append("\t")

    def handle_endtag(self, tag):
        if tag == "div" and self._depth:
            self._depth -= 1
            if self._depth == 0:
                text = re.sub(r"[ \t]*\n[ \t]*", "\n", "".join(self._buf)).strip()
                text = re.sub(r"\n{2,}", "\n", text)  # tag start+end both add breaks; blank lines carry no meaning
                self.blocks.append(Block(self._label, self._bbox, text))
        elif self._depth and tag in ("p", "tr", "li", "h1", "h2", "h3", "h4"):
            self._buf.append("\n")

    def handle_data(self, data):
        if self._depth:
            self._buf.append(data)


def parse_html(html: str) -> ChandraPage:
    """Chandra HTML -> ChandraPage. Output with no <div> blocks is treated as plain text rather than dropped."""
    p = _Blocks()
    p.feed(html or "")
    p.close()
    if not p.blocks:
        plain = re.sub(r"<[^>]+>", " ", html or "")
        plain = re.sub(r"[ \t]+", " ", plain).strip()
        return ChandraPage(plain, [Block("Text", None, plain)] if plain else [])
    text = "\n".join(b.text for b in p.blocks if b.text and b.label.lower() not in NON_TEXT_LABELS)
    return ChandraPage(text, p.blocks)


def read_page(
    image: Image.Image,
    post: Callable[[str, dict, float], dict] = _post_json,
    base_url: Optional[str] = None,
) -> ChandraPage:
    """Read a page or a crop. Raises ChandraUnavailable once the retries are spent."""
    body = {
        "model": CHANDRA_MODEL,
        "temperature": 0,
        "max_tokens": CHANDRA_MAX_TOKENS,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "image_url", "image_url": {"url": image_to_data_url(image)}},
                {"type": "text", "text": CHANDRA_PROMPT},
            ],
        }],
    }
    url = (base_url or CHANDRA_URL).rstrip("/") + "/v1/chat/completions"
    last: Optional[Exception] = None
    for attempt in range(1, CHANDRA_RETRIES + 2):
        try:
            data = post(url, body, CHANDRA_TIMEOUT)
            return parse_html(data["choices"][0]["message"].get("content") or "")
        except Exception as e:  # noqa: BLE001 - transport, HTTP and malformed-body errors all mean retry, then give up
            last = e
            logging.warning(f"[!] Chandra attempt {attempt} failed: {e}")
            if attempt <= CHANDRA_RETRIES:
                time.sleep(min(2 ** attempt, 8))
    raise ChandraUnavailable(f"Chandra at {url} failed after {CHANDRA_RETRIES + 1} attempts: {last}")

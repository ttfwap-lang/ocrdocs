"""Qwen3-VL page classifier and merger.

classify_page: one small call per page -> printed | handwritten | both | blank | photo (decides which readers run).
merge_page:    the page image plus the Paddle-VL text and the TrOCR lines -> typed fields, each tagged with whether it
               came from print or handwriting, WHOSE detail it is (applicant, parent, spouse, ...), the printed heading it
               sits under, and its position within a multi-value cell ("John and Mary" -> entries 1 and 2), plus the
               document type.

Qwen is not trusted with digits. Every returned value that contains digits is checked against the digits the OCR
engines actually read on that page; a value Qwen produced that neither engine saw is kept but marked unverified and
given low confidence, so a human reviews it instead of a guess being committed.
"""
from __future__ import annotations

import json
import logging
import os
import re
from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional, Sequence

from PIL import Image

from ocr_paddle_vl import _post_json, image_to_data_url

QWEN_URL = os.environ.get("OCRDOCS_QWEN_URL", "http://localhost:8200")
QWEN_MODEL = os.environ.get("OCRDOCS_QWEN_MODEL", "qwen-vl")
QWEN_TIMEOUT = float(os.environ.get("OCRDOCS_QWEN_TIMEOUT_SECONDS", "120"))
CLASSIFY_MAX_SIDE = int(os.environ.get("OCRDOCS_CLASSIFY_MAX_SIDE", "768"))
MIN_DIGITS_TO_CHECK = 4

PAGE_KINDS = ["printed", "handwritten", "both", "blank", "photo"]
FIELD_KEYS = [
    "given_names", "family_name", "date_of_birth", "residential_address", "mobile_number", "email_address",
    "drivers_licence_number", "passport_details", "tax_file_number", "bsb", "account_number", "abn", "occupation",
]
# Whose detail a value is. "unknown" is what a missing/invalid answer becomes: never silently the applicant.
SUBJECTS = ["applicant", "spouse", "parent", "dependant", "employer", "referee", "other"]
DOCUMENT_TYPES = [
    "loan_application", "bank_statement", "payslip", "drivers_licence", "passport", "medicare_card", "tax_return",
    "utility_bill", "employment_contract", "id_form_other", "other",
]

CLASSIFY_SCHEMA = {
    "type": "object",
    "properties": {"kind": {"type": "string", "enum": PAGE_KINDS}},
    "required": ["kind"],
}
MERGE_SCHEMA = {
    "type": "object",
    "properties": {
        "document_type": {"type": "string", "enum": DOCUMENT_TYPES},
        "fields": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "enum": FIELD_KEYS},
                    "value": {"type": "string"},
                    "source": {"type": "string", "enum": ["print", "handwriting"]},
                    "subject": {"type": "string", "enum": SUBJECTS},
                    "section": {"type": "string"},
                    "entry": {"type": "integer", "minimum": 1},
                    "evidence": {"type": "string"},
                },
                "required": ["name", "value", "source", "subject"],
            },
        },
    },
    "required": ["document_type", "fields"],
}

CLASSIFY_PROMPT = (
    "Classify this document page. Answer with the kind: 'printed' if it has only printed or typed text, "
    "'handwritten' if the text on it is only handwritten, 'both' if printed text and handwriting appear together "
    "(for example a printed form that has been filled in by hand), 'blank' if there is no meaningful content, "
    "'photo' if it is a photograph with no document text."
)
MERGE_PROMPT = (
    "This is a page of an Australian identity or financial document. Below are two machine readings of it: the "
    "printed text, and lines read from handwriting (each with a confidence). Using the page image and both readings, "
    "return the values of these fields that are clearly present: " + ", ".join(FIELD_KEYS) + ". "
    "Set source to 'handwriting' if the value was handwritten, otherwise 'print'. Copy digits exactly as they appear "
    "in a reading. Never guess or invent a value; omit a field that is not clearly present. Do not return form "
    "labels, instructions or example text as values. "
    "WHOSE DETAIL: set subject to whose value it is. It is the applicant only if its own label or the section heading "
    "it sits under says so (e.g. 'Given Name', 'Your details'). Values under a heading about another person "
    "(e.g. 'Parents details', 'Spouse', 'Employer', 'Referee') take that subject: parent, spouse, employer, referee. "
    "Copy the printed heading into section. When one cell lists several people or values ('John and Mary', "
    "'boilermaker, nurse') return one field per person, in order, with entry 1, 2, ... so the same entry number pairs "
    "a person's name with their job. Also return document_type: " + ", ".join(DOCUMENT_TYPES) + " ('other' if unsure)."
)


@dataclass
class MergedField:
    name: str
    value: str
    source: str  # "print" | "handwriting"
    confidence: float
    digits_verified: Optional[bool]  # None when the value has too few digits to check
    evidence: str = ""
    subject: str = "unknown"  # SUBJECTS, or "unknown" when the model did not say
    section: str = ""
    entry: int = 1


@dataclass
class MergeResult:
    fields: List[MergedField] = field(default_factory=list)
    document_type: str = "other"


class QwenUnavailable(RuntimeError):
    """Qwen could not be reached or returned unusable output; callers use the regex extractor instead."""


def _downscale(image: Image.Image, max_side: int) -> Image.Image:
    w, h = image.size
    scale = max_side / max(w, h)
    return image if scale >= 1 else image.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.LANCZOS)


def _chat(
    content: list,
    schema: dict,
    name: str,
    post: Callable[[str, dict, float], dict],
    base_url: Optional[str],
    max_tokens: int,
) -> dict:
    body = {
        "model": QWEN_MODEL,
        "temperature": 0,
        "max_tokens": max_tokens,
        "messages": [{"role": "user", "content": content}],
        "response_format": {"type": "json_schema", "json_schema": {"name": name, "schema": schema}},
    }
    url = (base_url or QWEN_URL).rstrip("/") + "/v1/chat/completions"
    try:
        data = post(url, body, QWEN_TIMEOUT)
        return json.loads(data["choices"][0]["message"]["content"])
    except Exception as e:  # noqa: BLE001 - transport, HTTP and bad-JSON errors are all "Qwen unusable"
        raise QwenUnavailable(f"Qwen at {url} ({name}): {e}") from e


def classify_page(
    image: Image.Image,
    post: Callable[[str, dict, float], dict] = _post_json,
    base_url: Optional[str] = None,
) -> str:
    """Return one of PAGE_KINDS. Raises QwenUnavailable, or returns 'both' for an unrecognised answer (run everything)."""
    content = [
        {"type": "image_url", "image_url": {"url": image_to_data_url(_downscale(image, CLASSIFY_MAX_SIDE))}},
        {"type": "text", "text": CLASSIFY_PROMPT},
    ]
    kind = _chat(content, CLASSIFY_SCHEMA, "page_kind", post, base_url, 32).get("kind")
    return kind if kind in PAGE_KINDS else "both"


def _digits(s: str) -> str:
    return re.sub(r"\D", "", s or "")


def check_digits(value: str, corpus_digits: str) -> Optional[bool]:
    """True/False whether the value's digits appear in what the OCR engines read; None if too few digits to say."""
    d = _digits(value)
    if len(d) < MIN_DIGITS_TO_CHECK:
        return None
    return d in corpus_digits


def merge_page(
    image: Image.Image,
    paddle_text: str,
    trocr_lines: Sequence[tuple],
    post: Callable[[str, dict, float], dict] = _post_json,
    base_url: Optional[str] = None,
) -> MergeResult:
    """trocr_lines is a sequence of (text, confidence). Returns fields with digit-provenance confidence applied."""
    hw = "\n".join(f"[{c:.2f}] {t}" for t, c in trocr_lines) or "(none)"
    text = f"{MERGE_PROMPT}\n\nPRINTED TEXT:\n{paddle_text[:12000] or '(none)'}\n\nHANDWRITTEN LINES:\n{hw[:6000]}"
    content = [
        {"type": "image_url", "image_url": {"url": image_to_data_url(image)}},
        {"type": "text", "text": text},
    ]
    reply = _chat(content, MERGE_SCHEMA, "page_fields", post, base_url, 2000)
    raw = reply.get("fields") or []
    doc_type = reply.get("document_type")
    corpus = _digits(paddle_text) + "".join(_digits(t) for t, _ in trocr_lines)
    out: List[MergedField] = []
    for f in raw:
        name, value = f.get("name"), (f.get("value") or "").strip()
        if name not in FIELD_KEYS or not value:
            continue
        verified = check_digits(value, corpus)
        conf = 0.35 if verified is False else 0.85 if verified else 0.7
        if verified is False:
            logging.warning(f"[!] Qwen returned {name}={value!r} but those digits were not read by any OCR engine.")
        subject = f.get("subject") if f.get("subject") in SUBJECTS else "unknown"
        entry = f.get("entry") if isinstance(f.get("entry"), int) and f.get("entry") >= 1 else 1
        out.append(MergedField(name, value, f.get("source") or "print", conf, verified, f.get("evidence") or "",
                               subject, (f.get("section") or "")[:120], entry))
    return MergeResult(out, doc_type if doc_type in DOCUMENT_TYPES else "other")

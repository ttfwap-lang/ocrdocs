"""S5 agent verifier: a reasoning model inspects flagged pages one at a time and settles each flagged field.

The model sees ONE page image (vLLM instances accept a single image) plus the flagged fields and the stored OCR text.
Everything else it learns comes from deterministic tools that return text: re-read a region with TrOCR, Paddle-VL or
Chandra, run a validator, fetch another page's stored text. It answers with one verdict per field.

The model is never trusted with a value. In code, not in the prompt:
  * "corrected" must cite a region and the corrected value (its digits, if any) must appear in something a tool read;
  * "confirmed" on a value with digits must be supported by the stored text or a tool reading;
  * anything else, an exhausted budget, or malformed output becomes "unresolved" and goes to a human with the reasoning.
"""
from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Mapping, Optional, Sequence

from PIL import Image

from ocr_paddle_vl import _post_json, image_to_data_url

MAX_STEPS = 8
MAX_TOOL_CALLS = 10
DEADLINE_SECONDS = 180.0
VERDICTS = ("confirmed", "corrected", "unresolved")

TOOLS = [
    {"type": "function", "function": {
        "name": "read_region", "description": "Re-read a region of the page with one OCR reader and return its text. "
        "Box is x0,y0,x1,y1 on a 0-1000 scale of the page (0,0 top-left).",
        "parameters": {"type": "object", "properties": {
            "reader": {"type": "string", "enum": ["trocr", "paddle", "chandra"]},
            "box": {"type": "array", "items": {"type": "integer"}, "minItems": 4, "maxItems": 4}},
            "required": ["reader", "box"]}}},
    {"type": "function", "function": {
        "name": "validate", "description": "Run the deterministic validator for a field (abn, bsb, date_of_birth ...).",
        "parameters": {"type": "object", "properties": {"field": {"type": "string"}, "value": {"type": "string"}},
                       "required": ["field", "value"]}}},
    {"type": "function", "function": {
        "name": "page_text", "description": "Stored OCR text of another page (1-based page number).",
        "parameters": {"type": "object", "properties": {"page": {"type": "integer"}}, "required": ["page"]}}},
]

SYSTEM = (
    "You verify machine-read fields from Australian identity and financial documents. You get one page image, the "
    "fields that were flagged as questionable and why, and the stored OCR text. Inspect the page, use the tools to "
    "re-read regions and validate values, and reason about whose detail each value is (the applicant's, or a parent's, "
    "spouse's, employer's). Never guess a digit. When done, reply with ONLY JSON: "
    '{"verdicts":[{"field":str,"verdict":"confirmed|corrected|unresolved","value":str,"box":[x0,y0,x1,y1],"reasoning":str}]}. '
    "Use 'corrected' only with the exact value a tool read from the box you cite; use 'unresolved' whenever unsure."
)


@dataclass
class Verdict:
    page: int
    field: str
    verdict: str
    value: str
    box: Optional[List[int]] = None
    reasoning: str = ""
    downgraded: bool = False


@dataclass
class _Run:
    readings: List[str] = field(default_factory=list)   # everything a tool returned, for provenance checks
    tool_calls: int = 0


def _digits(s: str) -> str:
    return re.sub(r"\D", "", s or "")


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def _crop(image: Image.Image, box: Sequence[int]) -> Image.Image:
    w, h = image.size
    x0, y0, x1, y1 = [max(0, min(1000, int(v))) for v in box]
    if x1 <= x0 or y1 <= y0:
        raise ValueError("empty box")
    return image.crop((round(x0 * w / 1000), round(y0 * h / 1000), round(x1 * w / 1000), round(y1 * h / 1000)))


def qwen_chat(base_url: str, model: str, timeout: float = 300.0, post: Callable = _post_json):
    """Real chat function: OpenAI-compatible /v1/chat/completions with tool calling. Returns the assistant message."""
    def chat(messages: List[dict], tools: List[dict]) -> dict:
        body = {"model": model, "temperature": 0, "max_tokens": 2000, "messages": messages, "tools": tools}
        return post(base_url.rstrip("/") + "/v1/chat/completions", body, timeout)["choices"][0]["message"]
    return chat


class AgentVerifier:
    def __init__(
        self,
        chat: Callable[[List[dict], List[dict]], dict],
        readers: Mapping[str, Callable[[Image.Image], str]],
        validators: Optional[Mapping[str, Callable[[str], Optional[bool]]]] = None,
        clock: Callable[[], float] = time.monotonic,
    ):
        self.chat, self.readers, self.validators, self.clock = chat, readers, validators or {}, clock

    # ---- tools ---------------------------------------------------------------------------------------------------
    def _tool(self, name: str, args: Mapping[str, Any], image: Image.Image, page_texts: Sequence[str], run: _Run) -> str:
        try:
            if name == "read_region":
                reader = self.readers.get(args.get("reader"))
                if reader is None:
                    return f"error: reader '{args.get('reader')}' is not available"
                out = reader(_crop(image, args["box"])).strip()
            elif name == "validate":
                fn = self.validators.get(args.get("field"))
                res = fn(str(args.get("value", ""))) if fn else None
                out = {True: "valid", False: "invalid", None: "no validator for this field"}[res]
            elif name == "page_text":
                n = int(args["page"])
                out = page_texts[n - 1][:4000] if 1 <= n <= len(page_texts) else "error: no such page"
            else:
                return f"error: unknown tool '{name}'"
        except Exception as e:  # noqa: BLE001 - a failing tool is information for the model, not a crash
            return f"error: {type(e).__name__}: {e}"
        run.readings.append(out)
        return out or "(nothing read)"

    # ---- one page ------------------------------------------------------------------------------------------------
    def verify_page(self, page: int, image: Image.Image, flagged: Sequence[Mapping[str, Any]], page_texts: Sequence[str]) -> List[Verdict]:
        """flagged: [{"field", "value", "why"}]. Returns one Verdict per flagged field, always."""
        run = _Run()
        start = self.clock()
        listing = "\n".join(f"- {f['field']} = {f.get('value', '')!r} (flagged: {f.get('why', '')})" for f in flagged)
        text = page_texts[page - 1] if 1 <= page <= len(page_texts) else ""
        messages: List[dict] = [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": [
                {"type": "image_url", "image_url": {"url": image_to_data_url(image)}},
                {"type": "text", "text": f"Page {page} of {len(page_texts)}.\nFlagged fields:\n{listing}\n\nStored OCR text of this page:\n{text[:6000]}"},
            ]},
        ]
        final: Optional[str] = None
        for _ in range(MAX_STEPS):
            if self.clock() - start > DEADLINE_SECONDS:
                break
            try:
                msg = self.chat(messages, TOOLS)
            except Exception as e:  # noqa: BLE001 - model unreachable: hand everything to a human
                return self._all_unresolved(page, flagged, f"agent unavailable: {e}")
            calls = msg.get("tool_calls") or []
            if not calls:
                final = msg.get("content") or ""
                break
            messages.append({"role": "assistant", "content": msg.get("content") or "", "tool_calls": calls})
            for c in calls:
                fn = c.get("function", {})
                try:
                    args = json.loads(fn.get("arguments") or "{}")
                except json.JSONDecodeError:
                    args = {}
                if run.tool_calls >= MAX_TOOL_CALLS:
                    result = "error: tool budget exhausted; give your verdicts now"
                else:
                    run.tool_calls += 1
                    result = self._tool(fn.get("name", ""), args, image, page_texts, run)
                messages.append({"role": "tool", "tool_call_id": c.get("id", ""), "content": result})
        if final is None:
            return self._all_unresolved(page, flagged, "agent budget exhausted before a decision")
        return self._settle(page, flagged, final, run, text)

    # ---- verdict enforcement ---------------------------------------------------------------------------------------
    @staticmethod
    def _all_unresolved(page, flagged, why) -> List[Verdict]:
        return [Verdict(page, f["field"], "unresolved", str(f.get("value", "")), None, why) for f in flagged]

    def _settle(self, page: int, flagged: Sequence[Mapping[str, Any]], final: str, run: _Run, page_text: str) -> List[Verdict]:
        m = re.search(r"\{.*\}", re.sub(r"<think>.*?</think>", "", final, flags=re.S), flags=re.S)
        try:
            items = json.loads(m.group(0))["verdicts"] if m else []
        except (json.JSONDecodeError, KeyError, TypeError):
            items = []
        by_field = {i.get("field"): i for i in items if isinstance(i, dict)}
        support = " ".join(run.readings)
        out: List[Verdict] = []
        for f in flagged:
            name, original = f["field"], str(f.get("value", ""))
            i = by_field.get(name)
            if not i or i.get("verdict") not in VERDICTS:
                out.append(Verdict(page, name, "unresolved", original, None, "no usable verdict from the agent"))
                continue
            verdict, value = i["verdict"], str(i.get("value", original))
            box = i.get("box") if isinstance(i.get("box"), list) and len(i.get("box")) == 4 else None
            reasoning = str(i.get("reasoning", ""))[:600]
            if verdict == "corrected":
                supported = bool(support) and (_norm(value) in _norm(support) or (_digits(value) and _digits(value) in _digits(support)))
                if box is None or not supported:
                    out.append(Verdict(page, name, "unresolved", original, box, f"correction to {value!r} not supported by any reader: {reasoning}", True))
                    continue
            elif verdict == "confirmed" and len(_digits(value)) >= 4:
                if _digits(value) not in _digits(support) and _digits(value) not in _digits(page_text):
                    out.append(Verdict(page, name, "unresolved", original, box, f"digits of {value!r} not found in any reading: {reasoning}", True))
                    continue
            out.append(Verdict(page, name, verdict, value, box, reasoning))
        return out

    # ---- whole file -----------------------------------------------------------------------------------------------
    def verify_file(self, pages: Sequence[Mapping[str, Any]], flags: Sequence[Any]) -> List[Verdict]:
        """pages: [{"image": PIL, "text": str}], flags: ocr_question_score.Flag list. Only pages with a flagged field are
        inspected, each once. File-level flags (no field) are returned as unresolved for a human."""
        texts = [p.get("text", "") for p in pages]
        per_page: Dict[int, List[dict]] = {}
        out: List[Verdict] = []
        for fl in flags:
            if fl.field is None or fl.page is None or not (0 <= fl.page < len(pages)):
                out.append(Verdict((fl.page + 1) if fl.page is not None else 0, fl.field or fl.code, "unresolved", "", None, f"{fl.code}: {fl.detail}"))
                continue
            per_page.setdefault(fl.page + 1, []).append({"field": fl.field, "value": _value_from(fl), "why": f"{fl.code}: {fl.detail}"})
        for page in sorted(per_page):
            seen, uniq = set(), []
            for f in per_page[page]:
                if f["field"] not in seen:
                    seen.add(f["field"])
                    uniq.append(f)
            out.extend(self.verify_page(page, pages[page - 1]["image"], uniq, texts))
        return out


def _value_from(flag) -> str:
    m = re.search(r"'([^']*)'", flag.detail or "")
    return m.group(1) if m else ""

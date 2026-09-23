"""Full LlamaCloud analysis of one document: Parse -> (Classify || Extract) off the same parse job, then delete everything.

One upload gives a parse job id (pjb-...). Classify (our custom rules) and Extract (the schema generated from the regex
catalogue) both take that id as their input, so the file is uploaded and parsed once. Results are converted to the same
field dicts the local Qwen merge produces, so the worker, the question flags, the agent and the server treat them alike,
and reconcile_fields() turns agreement between the two sources into confidence and disagreement into a flag.

Requires OCRDOCS_LLAMAPARSE=full plus LLAMA_CLOUD_API_KEY. Gateways in Australia, Europe, and USA
are greenlighted as fine; Africa gateway is banned. Every job is submitted with disable_cache and deleted after.
"""
from __future__ import annotations

import json
import logging
import os
import re
import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

import ocr_llamaparse as lp

CONFIG_DIR = Path(__file__).resolve().parent / "llamacloud"
EXTRACT_TIER = os.environ.get("OCRDOCS_LLAMAEXTRACT_TIER", "agentic")
MIN_CLASSIFY_CONFIDENCE = float(os.environ.get("OCRDOCS_LLAMACLASSIFY_MIN_CONFIDENCE", "0.6"))
DEFAULT_CONFIDENCE = 0.75

# Catalogue ids -> the names the worker/Qwen use for the same field, so both sources share one name space.
TO_PIPELINE_NAME = {"drivers_licence": "drivers_licence_number", "occupation_industry": "occupation"}
SUBJECTS = {"parent", "spouse", "dependant", "employer", "referee", "other"}
MIME = {".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".tif": "image/tiff",
        ".tiff": "image/tiff", ".webp": "image/webp", ".bmp": "image/bmp", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"}
UPLOAD_EXTENSIONS = set(MIME)


@dataclass
class CloudResult:
    document_type: Optional[str] = None
    type_confidence: Optional[float] = None
    type_reasoning: str = ""
    fields: List[Dict[str, Any]] = field(default_factory=list)
    page_texts: List[str] = field(default_factory=list)
    credits: Optional[float] = None
    errors: List[str] = field(default_factory=list)   # stage failures that did not stop the others


def enabled() -> bool:
    return lp.mode() == "full"


def load_schema() -> Dict[str, Any]:
    return json.loads((CONFIG_DIR / "extract_schema.json").read_text(encoding="utf-8"))


def load_rules() -> List[Dict[str, str]]:
    return json.loads((CONFIG_DIR / "classify_rules.json").read_text(encoding="utf-8"))["rules"]


def _digits(s: str) -> str:
    return re.sub(r"\D", "", s or "")


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


# ---- result conversion ------------------------------------------------------------------------------------------------
def _meta(node: Any, *path: Any) -> Dict[str, Any]:
    """Walk extract_metadata's field_metadata.document_metadata by dict keys / list indexes; {} when absent."""
    cur = ((node or {}).get("field_metadata") or {}).get("document_metadata") if isinstance(node, dict) else None
    for p in path:
        try:
            cur = cur[p]
        except (KeyError, IndexError, TypeError):
            return {}
    return cur if isinstance(cur, dict) else {}


def _entry(value: str, meta: Dict[str, Any], parse_digits: str) -> Tuple[float, str, Optional[int], Optional[bool]]:
    conf = meta.get("confidence")
    conf = float(conf) if isinstance(conf, (int, float)) else DEFAULT_CONFIDENCE
    cites = meta.get("citation") or []
    evidence = (cites[0].get("matching_text") or "")[:200] if cites and isinstance(cites[0], dict) else ""
    page = cites[0].get("page") if cites and isinstance(cites[0], dict) and isinstance(cites[0].get("page"), int) else None
    d = _digits(value)
    verified = None if len(d) < 4 else d in parse_digits
    return conf, evidence, page, verified


def extract_to_fields(result: Any, metadata: Any, parse_text: str) -> List[Dict[str, Any]]:
    """Extract result (applicant + other_people) -> worker field dicts, one per non-null value."""
    if not isinstance(result, dict):
        return []
    parse_digits = _digits(parse_text)
    out: List[Dict[str, Any]] = []

    def add(fid: str, value: Any, meta: Dict[str, Any], subject: str, section: str, entry: int):
        if value is None or not str(value).strip():
            return
        value = str(value).strip()
        conf, evidence, page, verified = _entry(value, meta, parse_digits)
        conf = min(conf, 0.35) if verified is False else conf
        out.append({"name": TO_PIPELINE_NAME.get(fid, fid), "value": value, "source": "print", "confidence": conf,
                    "digits_verified": verified, "evidence": evidence, "subject": subject, "section": section[:120],
                    "entry": entry, "imageIndex": (page - 1) if page else 0, "origin": "llamaparse"})

    for fid, value in (result.get("applicant") or {}).items():
        add(fid, value, _meta(metadata, "applicant", fid), "applicant", "", 1)
    seen: Dict[str, int] = {}
    for i, person in enumerate(result.get("other_people") or []):
        if not isinstance(person, dict):
            continue
        rel = person.get("relationship") if person.get("relationship") in SUBJECTS else "other"
        seen[rel] = seen.get(rel, 0) + 1
        for fid, value in person.items():
            if fid in ("relationship", "section"):
                continue
            add(fid, value, _meta(metadata, "other_people", i, fid), rel, str(person.get("section") or ""), seen[rel])
    return out


# ---- reconciling the two sources -------------------------------------------------------------------------------------
def _key(f: Dict[str, Any]) -> Tuple[str, str, int]:
    subject = "applicant" if f.get("subject") in ("applicant", "unknown", None) else f["subject"]
    return f["name"], subject, int(f.get("entry", 1))


def reconcile_fields(local: Sequence[Dict[str, Any]], cloud: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Merge Qwen and LlamaCloud fields. Agreement raises confidence and settles an unstated owner; disagreement keeps the
    better-supported value at reduced confidence and records the other as alternateValue for the flag and the agent."""
    merged: Dict[Tuple[str, str, int], Dict[str, Any]] = {}
    order: List[Tuple[str, str, int]] = []
    for f in local:
        g = {**f, "origin": "qwen"}
        k = _key(g)
        if k in merged:                      # same key twice locally: keep the more confident
            if g["confidence"] > merged[k]["confidence"]:
                merged[k] = g
            continue
        merged[k] = g
        order.append(k)
    for c in cloud:
        k = _key(c)
        l = merged.get(k)
        if l is None:
            merged[k] = dict(c)
            order.append(k)
        elif _norm(l["value"]) == _norm(c["value"]):
            l["confidence"] = min(0.97, max(l["confidence"], c["confidence"]) + 0.05)
            l["origin"] = "both"
            if l.get("subject") == "unknown":
                l["subject"] = "applicant"
            l["digits_verified"] = True if (l.get("digits_verified") or c.get("digits_verified")) else l.get("digits_verified")
        else:
            l_bad, c_bad = l.get("digits_verified") is False, c.get("digits_verified") is False
            # a value whose digits nobody read loses; otherwise the more confident reading wins, ties to the cloud
            cloud_wins = (l_bad and not c_bad) or (l_bad == c_bad and c["confidence"] >= l["confidence"])
            win, lose = (c, l) if cloud_wins else (l, c)
            merged[k] = {**win, "confidence": min(win["confidence"], 0.6),
                         "alternateValue": lose["value"], "alternateSource": lose.get("origin", "qwen")}
            if merged[k].get("subject") == "unknown" and win is c:
                merged[k]["subject"] = "applicant"
    return [merged[k] for k in order]


def pick_document_type(local_type: str, cloud: Optional[CloudResult]) -> Tuple[str, Optional[str]]:
    """(type to use, disagreeing type or None). The custom cloud classifier leads when it is confident enough."""
    if cloud and cloud.document_type and (cloud.type_confidence or 0) >= MIN_CLASSIFY_CONFIDENCE:
        alt = local_type if local_type not in ("other", "mixed", "", None) and local_type != cloud.document_type else None
        return cloud.document_type, alt
    return local_type, None


# ---- the API flow ------------------------------------------------------------------------------------------------------
class LlamaCloud:
    def __init__(self, client: Optional[lp.LlamaParse] = None, **client_kwargs: Any):
        self.c = client or lp.LlamaParse(**client_kwargs)
        self._schema = None
        self._rules = None

    def _poll(self, path: str, params: str, ok: str = "COMPLETED") -> Dict[str, Any]:
        deadline = self.c.clock() + lp.JOB_TIMEOUT_SECONDS
        while True:
            status, data = self.c._call("GET", f"{path}{params}")
            if status >= 300 or not isinstance(data, dict):
                raise lp.LlamaParseUnavailable(f"poll {path.split('/')[3]} failed (HTTP {status})")
            state = data.get("status") or (data.get("job") or {}).get("status")
            if state == ok:
                return data
            if state in ("FAILED", "CANCELLED"):
                detail = (data.get("job") or {}).get("error_message") or data.get("error_message")
                raise lp.LlamaParseUnavailable(f"{path.split('/')[3]} job {state.lower()}: {detail}")
            if self.c.clock() > deadline:
                raise lp.LlamaParseUnavailable(f"{path.split('/')[3]} job still {state} after {lp.JOB_TIMEOUT_SECONDS:.0f}s")
            self.c.sleep(lp.POLL_SECONDS)

    def _json(self, method: str, path: str, body: Dict[str, Any], what: str) -> Dict[str, Any]:
        status, data = self.c._call(method, path, json.dumps(body).encode(), "application/json")
        if status >= 300 or not isinstance(data, dict) or "id" not in data:
            raise lp.LlamaParseUnavailable(f"{what} rejected (HTTP {status}): {str(data)[:200]}")
        return data

    def analyze(self, data: bytes, filename: str) -> CloudResult:
        ext = Path(filename).suffix.lower()
        if ext not in UPLOAD_EXTENSIONS:
            raise lp.LlamaParseUnavailable(f"{ext or 'this'} files are not sent to LlamaParse")
        if lp.is_africa_region(self.c.region):
            raise lp.LlamaParseUnavailable(f"Gateway region '{self.c.region}' is banned (Africa is banned)")
        if self.c.region not in lp.REGIONS or self.c.tier not in lp.TIERS:
            raise lp.LlamaParseUnavailable("invalid LlamaParse region or tier")
        lp.base_url(self.c.region)  # validates gateway is greenlighted (Australia, Europe, USA) and not banned (Africa)
        if lp.mode() != "full" and self.c._key is None:
            raise lp.LlamaParseUnavailable("OCRDOCS_LLAMAPARSE is not 'full'")
        with self.c._lock:
            if self.c.calls >= self.c.max_calls:
                raise lp.LlamaParseUnavailable(f"call budget of {self.c.max_calls} reached for this worker")
            self.c.calls += 1
        body, ctype = lp._multipart_file(data, filename, MIME[ext], {"tier": self.c.tier, "version": "latest", "disable_cache": True})
        cleanup: List[Tuple[str, str]] = []
        try:
            status, up = self.c._call("POST", "/api/v2/parse/upload", body, ctype)
            if status >= 300 or not isinstance(up, dict) or "id" not in up:
                raise lp.LlamaParseUnavailable(f"upload rejected (HTTP {status}): {str(up)[:200]}")
            pjb, project = up["id"], up.get("project_id", "")
            cleanup.append(("parse", f"/api/v2/parse/{pjb}"))
            parsed = self._poll(f"/api/v2/parse/{pjb}", "?expand=markdown,items,metadata")
            page_texts = [p.get("markdown", "") for p in ((parsed.get("markdown") or {}).get("pages")) or [] if p.get("success", True)]
            result = CloudResult(page_texts=page_texts)
            parse_text = "\n".join(page_texts)

            def classify() -> None:
                try:
                    rules = self._rules or load_rules()
                    j = self._json("POST", f"/api/v2/classify?project_id={project}", {"file_input": pjb, "configuration": {"rules": rules}}, "classify")
                    cleanup.append(("classify", f"/api/v2/classify/{j['id']}?project_id={project}"))
                    r = self._poll(f"/api/v2/classify/{j['id']}", f"?project_id={project}").get("result") or {}
                    result.document_type, result.type_confidence, result.type_reasoning = r.get("type"), r.get("confidence"), str(r.get("reasoning") or "")[:600]
                except lp.LlamaParseUnavailable as e:
                    result.errors.append(f"classify: {e}")

            def extract() -> None:
                try:
                    schema = self._schema or load_schema()
                    cfg = {"tier": EXTRACT_TIER, "version": "latest", "extraction_target": "per_doc", "data_schema": schema["data_schema"],
                           "system_prompt": schema["system_prompt"], "cite_sources": True, "confidence_scores": True}
                    j = self._json("POST", f"/api/v2/extract?project_id={project}", {"file_input": pjb, "configuration": cfg}, "extract")
                    cleanup.append(("extract", f"/api/v2/extract/{j['id']}?project_id={project}"))
                    r = self._poll(f"/api/v2/extract/{j['id']}", f"?project_id={project}&expand=extract_metadata&expand=usage")
                    result.fields = extract_to_fields(r.get("extract_result"), r.get("extract_metadata"), parse_text)
                    used = (r.get("usage") or {}).get("credits")
                    result.credits = float(used) if isinstance(used, (int, float)) else None
                except lp.LlamaParseUnavailable as e:
                    result.errors.append(f"extract: {e}")

            with ThreadPoolExecutor(max_workers=2) as pool:
                for fut in [pool.submit(classify), pool.submit(extract)]:
                    fut.result()
            return result
        except lp.LlamaParseUnavailable:
            raise
        except Exception as e:  # noqa: BLE001 - never let a key or header leak into the message
            raise lp.LlamaParseUnavailable(f"LlamaCloud request failed: {type(e).__name__}") from None
        finally:
            for what, path in reversed(cleanup):
                try:
                    self.c._call("DELETE", path, timeout=30.0)
                except Exception as e:  # noqa: BLE001 - best effort; the vendor's 48 h expiry still applies
                    logging.warning(f"[!] LlamaCloud {what} job could not be deleted ({type(e).__name__})")

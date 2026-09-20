"""Document-level orchestration of the vlm_v2 pipeline: S1 probe -> classify -> S2 clear -> S3 read -> S4 flags ->
second reader on flagged pages -> S5 agent -> verdicts applied to fields.

Everything the stages need is passed in through Deps, so this module imports no OCR engine and is tested with fakes.
Nothing here deletes or hides data: a cleared file keeps its probe text and the reason, a downgraded or unresolved field
stays visible with a note, and every stage that cannot run degrades to "send it to a human" instead of failing.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Mapping, Optional, Sequence, Tuple

from PIL import Image

import ocr_gates
import ocr_question_score as qs
from ocr_agent_verify import AgentVerifier, Verdict

CONFIRMED_MIN_CONF = 0.90
CORRECTED_MIN_CONF = 0.75


@dataclass
class Deps:
    classify: Callable[[Image.Image], Tuple[str, bool]]          # image -> (kind, degraded)
    read_page: Callable[[Image.Image, str], Dict[str, Any]]      # image, kind -> page dict (see engine.run_page_vlm)
    probe: Optional[Callable[[Image.Image], ocr_gates.Probe]] = None   # None turns the S1/S2 gates off
    label_patterns: Mapping[str, Any] = field(default_factory=dict)
    validators: Mapping[str, Callable[[str], Optional[bool]]] = field(default_factory=dict)
    second_reader: Optional[Callable[[Image.Image], str]] = None      # Chandra full-page text
    agent: Optional[AgentVerifier] = None


def apply_verdicts(fields: List[Dict[str, Any]], verdicts: Sequence[Verdict]) -> None:
    """Fold agent verdicts into the worker's field dicts in place. Verdicts for file-level flags have no field."""
    for v in verdicts:
        for f in fields:
            if f["name"] != v.field or f.get("imageIndex") != v.page - 1:
                continue
            f["agent"] = v.verdict
            f["agentReasoning"] = v.reasoning
            if v.verdict == "corrected":
                f["originalValue"], f["value"] = f["value"], v.value
                f["confidence"] = max(f["confidence"], CORRECTED_MIN_CONF)
            elif v.verdict == "confirmed":
                f["confidence"] = max(f["confidence"], CONFIRMED_MIN_CONF)


def run_document(images: Sequence[Image.Image], deps: Deps, audit_sample: bool = False) -> Dict[str, Any]:
    imgs = list(images)
    probes: List[ocr_gates.Probe] = []
    if deps.probe:
        for i, im in enumerate(imgs):
            try:
                p = deps.probe(im)
            except Exception as e:  # noqa: BLE001 - a failed probe must never block or clear a page
                logging.warning(f"[!] S1 probe failed on image {i}: {e}")
                probes = []
                break
            probes.append(p)
            if p.rotation:
                imgs[i] = ocr_gates.rotate_upright(im, p.rotation)

    kinds: List[str] = []
    degraded: List[bool] = []
    for im in imgs:
        k, d = deps.classify(im)
        kinds.append(k)
        degraded.append(d)

    cleared_reason = ""
    if probes and len(probes) == len(imgs):
        decision = ocr_gates.s2_decision(kinds, probes, deps.label_patterns)
        if decision.clear and not audit_sample:
            text = "\n".join(p.text for p in probes)
            return {
                "cleared": True, "cleared_reason": decision.reason, "audit_sampled": False, "text": text,
                "pages": [{"imageIndex": i, "kind": k, "engines": ["Tesseract-probe"], "degraded": False, "fieldCount": 0,
                           "documentType": "other", "cleared": True} for i, k in enumerate(kinds)],
                "fields": [], "flags": [], "verdicts": [], "document_type": "other", "engines": ["Tesseract-probe"],
                "line_confs": {}, "page_texts": [p.text for p in probes], "rotations": [p.rotation for p in probes],
            }
        cleared_reason = ("audit sample: would have been cleared (" + decision.reason + ")") if decision.clear else ""

    pages_info: List[Dict[str, Any]] = []
    fields: List[Dict[str, Any]] = []
    texts: List[str] = []
    paddle_texts: List[str] = []
    engines: List[str] = []
    confs: Dict[str, float] = {}
    for i, (im, k) in enumerate(zip(imgs, kinds)):
        page = deps.read_page(im, k)
        page_engines = list(page["engines"])
        pages_info.append({"imageIndex": i, "kind": page["kind"], "engines": page_engines,
                           "degraded": bool(page["degraded"] or degraded[i]), "fieldCount": len(page["fields"]),
                           "documentType": page.get("document_type", "other")})
        fields.extend({**vars(f), "imageIndex": i} for f in page["fields"])
        texts.append(page["text"])
        paddle_texts.append(page.get("paddle_text", ""))
        confs.update(page["line_confs"])
        engines.extend(e for e in page_engines if e not in engines)
    document_type = majority_document_type([p["documentType"] for p in pages_info])

    flags = qs.question_flags(pages_info, fields, document_type, deps.validators)

    if deps.second_reader and flags:
        flagged_pages = sorted({f.page for f in flags if f.page is not None and pages_info[f.page]["kind"] in ("printed", "both")})
        reader_texts = []
        for p in flagged_pages:
            try:
                other = deps.second_reader(imgs[p])
            except Exception as e:  # noqa: BLE001 - the second opinion is optional; its absence is not a flag
                logging.warning(f"[!] second reader unavailable for page {p}: {e}")
                continue
            reader_texts.append((p, paddle_texts[p], other))
            texts[p] = texts[p] + "\n[second reader]\n" + other
            if "Chandra" not in pages_info[p]["engines"]:
                pages_info[p]["engines"].append("Chandra")
                if "Chandra" not in engines:
                    engines.append("Chandra")
        flags = flags + qs.reader_flags(reader_texts)

    verdicts: List[Verdict] = []
    if deps.agent and flags:
        try:
            verdicts = deps.agent.verify_file([{"image": im, "text": t} for im, t in zip(imgs, texts)], flags)
            apply_verdicts(fields, verdicts)
        except Exception as e:  # noqa: BLE001 - an agent failure leaves the flags standing for a human
            logging.warning(f"[!] agent verification failed: {e}")

    return {
        "cleared": False, "cleared_reason": cleared_reason, "audit_sampled": bool(cleared_reason), "text": "\n".join(t for t in texts if t),
        "pages": pages_info, "fields": fields, "flags": [vars(f) for f in flags], "verdicts": [vars(v) for v in verdicts],
        "document_type": document_type, "engines": engines, "line_confs": confs, "page_texts": texts,
        "rotations": [p.rotation for p in probes] if probes else [],
    }


def majority_document_type(types: List[str]) -> str:
    """One type for the whole document: the most common page type, ignoring "other" unless nothing else was seen.
    Two different specific types tied for first (a statement stapled to a payslip) is "mixed"."""
    counts: Dict[str, int] = {}
    for t in types:
        if t and t != "other":
            counts[t] = counts.get(t, 0) + 1
    if not counts:
        return "other"
    ranked = sorted(counts.items(), key=lambda kv: -kv[1])
    return "mixed" if len(ranked) > 1 and ranked[0][1] == ranked[1][1] else ranked[0][0]

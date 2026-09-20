"""Cheap gates that run before any GPU reader: S1 low-resolution text probe + orientation, S2 regex clear.

Rules that keep real data safe:
  * The probe is Tesseract at ~100 DPI. It cannot read handwriting, so a page is never judged "no match" on the strength
    of it unless triage already called every page printed AND the probe read enough good text to judge.
  * "Clear" parks a file in a no_match bin. It is never a deletion, and audit_sample() sends a fixed share of parked
    files through the full read anyway so the regex catalogue's blind spots show up as a measured miss rate.
Everything takes the OCR call as a parameter so the policy is testable without Tesseract.
"""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from typing import Any, Callable, List, Mapping, Optional, Sequence

import numpy as np
from PIL import Image

PROBE_LONG_SIDE = 1100          # ~100 DPI on A4
MIN_PROBE_CONF = 0.60
MIN_PROBE_ALNUM = 40
OSD_MIN_CONFIDENCE = 2.0
AUDIT_RATE = 0.02

# Value shapes that count as a "match" even when no label pattern does (a page of numbers with no headings).
VALUE_PATTERNS = {
    "email": re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.-]+\b"),
    "au_phone": re.compile(r"(?<!\d)(?:\+?61\s?|0)[2-478](?:[ -]?\d){8}(?!\d)"),
    "abn": re.compile(r"(?<!\d)\d{2} ?\d{3} ?\d{3} ?\d{3}(?!\d)"),
    "bsb": re.compile(r"(?<!\d)\d{3}[- ]\d{3}(?!\d)"),
    "date": re.compile(r"\b\d{1,2}[/.-]\d{1,2}[/.-](?:19|20)?\d{2}\b"),
}


@dataclass
class Probe:
    text: str
    conf: float          # mean word confidence 0..1
    alnum: int           # letters+digits read
    rotation: int = 0    # degrees to rotate clockwise to make the page upright (0/90/180/270)


@dataclass
class Decision:
    clear: bool
    reason: str
    hits: List[str] = field(default_factory=list)


def ink_ratio(image: Image.Image) -> float:
    g = np.asarray(image.convert("L").resize((256, 256), Image.Resampling.BILINEAR))
    return float((g < 128).mean())


def _low_res(image: Image.Image) -> Image.Image:
    w, h = image.size
    scale = PROBE_LONG_SIDE / max(w, h)
    return image.convert("L") if scale >= 1 else image.convert("L").resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.Resampling.BILINEAR)


def orientation_degrees(image: Image.Image, image_to_osd: Optional[Callable[..., str]] = None) -> int:
    """Clockwise degrees needed to make the page upright, from Tesseract OSD; 0 when OSD is absent or unsure."""
    if image_to_osd is None:
        try:
            import pytesseract
            image_to_osd = pytesseract.image_to_osd
        except ImportError:
            return 0
    try:
        out = image_to_osd(_low_res(image))
        rot = int(re.search(r"Rotate:\s*(\d+)", out).group(1))
        conf = float(re.search(r"Orientation confidence:\s*([\d.]+)", out).group(1))
    except Exception:  # noqa: BLE001 - OSD fails on sparse pages; "unknown" must mean "leave the page as it is"
        return 0
    return rot if conf >= OSD_MIN_CONFIDENCE and rot in (90, 180, 270) else 0


def rotate_upright(image: Image.Image, degrees: int) -> Image.Image:
    """PIL rotates counter-clockwise, Tesseract's Rotate is the clockwise turn that makes text upright."""
    return image.rotate(-degrees, expand=True, fillcolor="white") if degrees else image


def probe_page(
    image: Image.Image,
    image_to_data: Optional[Callable[..., Mapping[str, Any]]] = None,
    image_to_osd: Optional[Callable[..., str]] = None,
) -> Probe:
    if image_to_data is None:
        import pytesseract
        image_to_data = lambda im: pytesseract.image_to_data(im, lang="eng", config="--psm 3", output_type=pytesseract.Output.DICT)  # noqa: E731
    rotation = orientation_degrees(image, image_to_osd)
    data = image_to_data(_low_res(rotate_upright(image, rotation)))
    words, confs = [], []
    for text, conf in zip(data.get("text", []), data.get("conf", [])):
        t = (text or "").strip()
        try:
            c = float(conf)
        except (TypeError, ValueError):
            continue
        if t and c >= 0:
            words.append(t)
            confs.append(c / 100.0)
    text = " ".join(words)
    return Probe(text, float(np.mean(confs)) if confs else 0.0, sum(ch.isalnum() for ch in text), rotation)


def regex_hits(text: str, label_patterns: Mapping[str, "re.Pattern[str]"]) -> List[str]:
    """Names of every catalogue label pattern and value shape found in the text."""
    hits = [name for name, p in label_patterns.items() if p.search(text)]
    hits += [name for name, p in VALUE_PATTERNS.items() if p.search(text)]
    return hits


def s2_decision(
    page_kinds: Sequence[str],
    probes: Sequence[Probe],
    label_patterns: Mapping[str, "re.Pattern[str]"],
) -> Decision:
    """Park the file only when it is provably plain printed text that matches nothing in the catalogue."""
    if not probes:
        return Decision(False, "no probed pages")
    if any(k != "printed" for k in page_kinds):
        return Decision(False, "handwritten, mixed or uncertain page present: the probe cannot judge it")
    poor = [i for i, p in enumerate(probes) if p.conf < MIN_PROBE_CONF or p.alnum < MIN_PROBE_ALNUM]
    if poor:
        return Decision(False, f"probe text too poor to judge on page(s) {poor}")
    hits = sorted({h for p in probes for h in regex_hits(p.text, label_patterns)})
    if hits:
        return Decision(False, "catalogue matches found", hits)
    return Decision(True, "printed, good probe text, zero catalogue matches")


def audit_sample(doc_id: str, rate: float = AUDIT_RATE) -> bool:
    """Deterministic share of parked files that still get the full read, so the miss rate of S2 is measurable."""
    return int(hashlib.sha256(doc_id.encode()).hexdigest(), 16) % 10000 < rate * 10000

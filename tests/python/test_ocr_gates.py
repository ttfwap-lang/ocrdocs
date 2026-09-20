"""S1/S2 gates: policy is tested with injected OCR output; one real-Tesseract test proves the probe end to end."""
import re

import pytest
from PIL import Image, ImageDraw, ImageFont

import ocr_gates as g

PATTERNS = {"given_names": re.compile(r"given[\s_-]?names?", re.I), "bsb": re.compile(r"\bbsb\b", re.I)}


def probe(text="x" * 80, conf=0.9):
    return g.Probe(text, conf, sum(c.isalnum() for c in text))


def data(words, conf=90):
    return {"text": words, "conf": [conf] * len(words)}


# ---- S2 decision -------------------------------------------------------------------------------------------------
def test_printed_good_text_with_no_match_is_cleared():
    d = g.s2_decision(["printed"], [probe("terms and conditions apply to this general notice " * 3)], PATTERNS)
    assert d.clear and d.hits == []


def test_a_label_match_anywhere_keeps_the_file():
    d = g.s2_decision(["printed", "printed"], [probe("nothing here " * 10), probe("Given names: see below " * 3)], PATTERNS)
    assert not d.clear and d.hits == ["given_names"]


def test_a_value_shape_alone_keeps_the_file():
    d = g.s2_decision(["printed"], [probe("reference 062-000 filed " * 4)], PATTERNS)
    assert not d.clear and "bsb" in d.hits


@pytest.mark.parametrize("kinds", [["handwritten"], ["both"], ["uncertain"], ["printed", "both"]])
def test_any_non_printed_page_is_never_cleared_because_tesseract_cannot_read_handwriting(kinds):
    d = g.s2_decision(kinds, [probe("plain text " * 10)] * len(kinds), PATTERNS)
    assert not d.clear and "cannot judge" in d.reason


def test_poor_probe_text_is_never_cleared():
    assert not g.s2_decision(["printed"], [probe("hi", conf=0.9)], PATTERNS).clear          # too little text
    assert not g.s2_decision(["printed"], [probe("word " * 30, conf=0.3)], PATTERNS).clear  # unreliable text


def test_no_probes_is_not_a_clear():
    assert not g.s2_decision([], [], PATTERNS).clear


def test_audit_sample_is_deterministic_and_close_to_the_rate():
    ids = [f"doc-{i}" for i in range(20000)]
    picked = [i for i in ids if g.audit_sample(i)]
    assert picked == [i for i in ids if g.audit_sample(i)]
    assert 0.015 < len(picked) / len(ids) < 0.025


# ---- probe ------------------------------------------------------------------------------------------------------
def test_probe_joins_words_and_averages_confidence_ignoring_blank_and_negative_entries():
    d = {"text": ["BSB", "", "062-000", "noise"], "conf": ["90", "-1", "80", "-1"]}
    p = g.probe_page(Image.new("RGB", (2000, 3000), "white"), image_to_data=lambda im: d, image_to_osd=lambda im: "")
    assert p.text == "BSB 062-000" and p.conf == pytest.approx(0.85) and p.alnum == 9 and p.rotation == 0


def test_probe_downscales_to_about_100_dpi():
    seen = {}
    g.probe_page(Image.new("RGB", (2480, 3508), "white"), image_to_data=lambda im: seen.setdefault("s", im.size) and data([]), image_to_osd=lambda im: "")
    assert max(seen["s"]) == g.PROBE_LONG_SIDE


def test_orientation_uses_osd_only_when_confident():
    im = Image.new("RGB", (100, 100), "white")
    assert g.orientation_degrees(im, lambda i: "Rotate: 90\nOrientation confidence: 5.20") == 90
    assert g.orientation_degrees(im, lambda i: "Rotate: 90\nOrientation confidence: 0.40") == 0
    assert g.orientation_degrees(im, lambda i: "Rotate: 0\nOrientation confidence: 9") == 0


def test_orientation_failure_leaves_the_page_alone():
    def boom(i):
        raise RuntimeError("too few characters")

    assert g.orientation_degrees(Image.new("RGB", (100, 100), "white"), boom) == 0


def test_rotate_upright_turns_clockwise_and_swaps_dimensions():
    im = Image.new("RGB", (200, 100), "white")
    assert g.rotate_upright(im, 90).size == (100, 200)
    assert g.rotate_upright(im, 0) is im


def test_a_page_rotated_by_osd_is_read_upright():
    seen = {}
    im = Image.new("RGB", (400, 200), "white")
    g.probe_page(im, image_to_data=lambda i: seen.setdefault("size", i.size) and data([]), image_to_osd=lambda i: "Rotate: 90\nOrientation confidence: 6")
    assert seen["size"] == (200, 400)


def test_real_tesseract_reads_printed_text_at_low_resolution():
    pytest.importorskip("pytesseract")
    try:
        font = ImageFont.truetype("arial.ttf", 60)
    except OSError:
        pytest.skip("no truetype font available")
    im = Image.new("RGB", (1700, 500), "white")
    ImageDraw.Draw(im).text((60, 150), "Given names John Smith BSB 062 000", fill="black", font=font)
    p = g.probe_page(im)
    assert "BSB" in p.text.upper() and p.conf > 0.5
    assert "given_names" in g.regex_hits(p.text, PATTERNS) or "bsb" in g.regex_hits(p.text, PATTERNS)


def test_ink_ratio_blank_vs_written():
    im = Image.new("RGB", (300, 300), "white")
    assert g.ink_ratio(im) == 0.0
    ImageDraw.Draw(im).rectangle([0, 0, 300, 150], fill="black")
    assert g.ink_ratio(im) > 0.4

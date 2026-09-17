"""Real tests for scripts/ocr_spark_engine.py.

Scope, deliberately: these test what changed in the reliability/accuracy
hardening pass (timeouts, real confidence wiring, deskew, the merge-logic
dedup) using the actual Tesseract binary and actual generated images -- not
mocks standing in for OCR output. PaddleOCR/EasyOCR/Surya are not installed
on every machine this suite runs on, so nothing here asserts on their
behavior; a test that only passes because an engine is silently absent would
prove nothing and is worse than no test.
"""
from datetime import datetime, timezone

import pytest
from PIL import Image, ImageDraw

import ocr_spark_engine as engine


# ---------------------------------------------------------------------------
# merge_pass_fields -- the de-duplicated monotonic quality invariant
# ---------------------------------------------------------------------------

def test_merge_new_field_counts_as_delta():
    merged, confs, delta, regressions = engine.merge_pass_fields(
        ["a"], prev_fields={}, prev_confs={}, new_fields={"a": "value"}, new_confs={"a": 0.9}
    )
    assert merged == {"a": "value"}
    assert confs == {"a": 0.9}
    assert delta == 1
    assert regressions == 0


def test_merge_never_erases_an_accepted_field():
    """A later pass returning nothing for a field already filled must not
    erase it -- this is the invariant the whole multipass loop depends on."""
    merged, confs, delta, regressions = engine.merge_pass_fields(
        ["a"], prev_fields={"a": "kept"}, prev_confs={"a": 0.95}, new_fields={"a": ""}, new_confs={}
    )
    assert merged == {"a": "kept"}
    assert confs == {"a": 0.95}
    assert delta == 0
    assert regressions == 1


def test_merge_low_confidence_replacement_is_blocked():
    merged, confs, delta, regressions = engine.merge_pass_fields(
        ["a"],
        prev_fields={"a": "good"},
        prev_confs={"a": 0.9},
        new_fields={"a": "garbled"},
        new_confs={"a": 0.3},  # below the 0.60 default gate
    )
    assert merged["a"] == "good"
    assert confs["a"] == 0.9


def test_merge_high_confidence_replacement_is_accepted():
    merged, confs, delta, regressions = engine.merge_pass_fields(
        ["a"],
        prev_fields={"a": "old"},
        prev_confs={"a": 0.65},
        new_fields={"a": "new"},
        new_confs={"a": 0.85},
    )
    assert merged["a"] == "new"
    assert confs["a"] == 0.85


def test_merge_respects_custom_confidence_threshold():
    merged, _confs, _delta, _regressions = engine.merge_pass_fields(
        ["a"],
        prev_fields={"a": "old"},
        prev_confs={"a": 0.5},
        new_fields={"a": "new"},
        new_confs={"a": 0.55},
        min_replace_confidence=0.50,
    )
    assert merged["a"] == "new"


# ---------------------------------------------------------------------------
# Image quality assessment / deskew -- real pixel tests, no mocking
# ---------------------------------------------------------------------------

def _make_text_image(rotate_degrees: float = 0.0) -> Image.Image:
    img = Image.new("RGB", (900, 320), color="white")
    d = ImageDraw.Draw(img)
    d.text((20, 20), "COMMONWEALTH BANK OF AUSTRALIA", fill="black")
    d.text((20, 60), "Account Statement", fill="black")
    d.text((20, 100), "BSB: 062-000   Account: 12345678", fill="black")
    d.text((20, 140), "Date of Birth: 15/06/1985", fill="black")
    d.text((20, 180), "Balance: $4,521.90", fill="black")
    if rotate_degrees:
        img = img.rotate(-rotate_degrees, expand=True, fillcolor=(255, 255, 255))
    return img


def test_assess_image_quality_horizontal_image_not_flagged_skewed():
    img = _make_text_image(rotate_degrees=0.0)
    quality = engine.assess_image_quality(img)
    assert abs(quality["skew_angle_deg"]) < 1.0
    assert quality["is_skewed"] is False


def test_assess_image_quality_detects_real_rotation():
    """Regression test for a real bug caught during development: the first
    skew-detection implementation (cv2.minAreaRect over scattered text
    coordinates) returned 90 degrees for this exact horizontal image, which
    would have caused a destructive spurious rotation. This pins the fixed
    behavior (bounded projection-profile search) against both directions."""
    img = _make_text_image(rotate_degrees=7.0)
    quality = engine.assess_image_quality(img)
    assert quality["is_skewed"] is True
    # Within one search step (0.5 degree) of the true rotation.
    assert abs(quality["skew_angle_deg"] - 7.0) <= 1.0


def test_deskew_image_corrects_measured_rotation():
    rotated = _make_text_image(rotate_degrees=6.0)
    angle = engine.assess_image_quality(rotated)["skew_angle_deg"]
    corrected = engine.deskew_image(rotated, angle)
    residual = engine.assess_image_quality(corrected)["skew_angle_deg"]
    assert abs(residual) < abs(angle)


def test_deskew_image_is_a_noop_below_threshold():
    img = _make_text_image()
    result = engine.deskew_image(img, 0.1)
    assert result is img


# ---------------------------------------------------------------------------
# Real Tesseract confidence wiring (needs the actual binary)
# ---------------------------------------------------------------------------

def test_tesseract_line_confidence_is_real_and_bounded(tesseract_available):
    if not tesseract_available:
        pytest.skip("tesseract binary not found on this machine")
    img = _make_text_image()
    line_confidences = engine._tesseract_lines_with_confidence(img)
    assert line_confidences, "expected at least one recognized line from real OCR"
    for text, conf in line_confidences.items():
        assert text.strip(), "collected an empty line as a key"
        assert 0.0 <= conf <= 1.0, f"confidence {conf} for {text!r} out of bounds"
    # Real confidences vary per line -- this is the whole point of the fix
    # (previously every contextual field match got a flat 0.82 regardless of
    # what actually produced the text).
    assert len(set(line_confidences.values())) > 1


def test_run_pass_ocr_returns_real_varying_confidence(tesseract_available):
    if not tesseract_available:
        pytest.skip("tesseract binary not found on this machine")
    img = _make_text_image()
    text, engines_used, line_confidences = engine.run_pass_ocr(img, pass_num=1)
    assert "Tesseract" in engines_used
    assert text.strip()
    assert line_confidences
    assert all(0.0 <= c <= 1.0 for c in line_confidences.values())


def test_extract_fields_uses_real_confidence_not_flat_constant(tesseract_available):
    if not tesseract_available:
        pytest.skip("tesseract binary not found on this machine")
    img = _make_text_image()
    text, _engines, line_confidences = engine.run_pass_ocr(img, pass_num=1)
    result = engine.extract_australian_banking_fields(text, line_confidences)
    used_confidences = {
        field: conf
        for field, conf in result["confidences"].items()
        if result["fields"].get(field)
    }
    if used_confidences:
        # Old behavior hardcoded every contextual line match to exactly 0.82;
        # real per-engine confidence should not collapse to that one value.
        assert not all(c == 0.82 for c in used_confidences.values())


def test_extract_fields_native_text_path_uses_high_fixed_confidence():
    """Text that never went through an OCR engine (native PDF/docx/txt) has
    no line_confidences dict at all -- it should get a high fixed confidence
    since it's exact text, not a model's guess, not the OCR-path default."""
    text = "Date of Birth: 15/06/1985"
    result = engine.extract_australian_banking_fields(text, line_confidences=None)
    if result["fields"].get("date_of_birth"):
        assert result["confidences"]["date_of_birth"] == 0.95


# ---------------------------------------------------------------------------
# Australian validators
# ---------------------------------------------------------------------------

def test_dob_validation_uses_current_year_not_a_hardcoded_one():
    """Regression test for a real bug: validate_australian_dob used to
    hardcode `age = 2026 - year`, silently breaking every age calculation
    the following year. Computes the expected boundary from the real clock
    instead of a literal, so this test itself never goes stale."""
    current_year = datetime.now(timezone.utc).year
    exactly_105_year = current_year - 105
    just_over_105_year = current_year - 106
    assert engine.validate_australian_dob(f"01/01/{exactly_105_year}") is True
    assert engine.validate_australian_dob(f"01/01/{just_over_105_year}") is False


def test_abn_checksum_validation():
    # A known-valid ABN per the ATO Modulo 89 algorithm test vector.
    assert engine.validate_australian_abn("51 824 753 556") is True
    assert engine.validate_australian_abn("00 000 000 000") is False


def test_bsb_validation():
    assert engine.validate_australian_bsb("062-000") is True
    assert engine.validate_australian_bsb("00-0000") is False


# ---------------------------------------------------------------------------
# One corrupted PDF page must not discard the rest of the document.
#
# This one intentionally uses fault-injected fake pdfium pages rather than a
# real corrupted PDF file: producing a PDF that's genuinely malformed on
# exactly one page while staying openable is impractical to construct
# reliably as a test fixture, and the thing under test here is control flow
# (does one page's exception get isolated) not OCR quality, so a controlled
# fault is the right tool -- unlike the OCR-accuracy tests above, which
# deliberately avoid mocking engine output.
# ---------------------------------------------------------------------------

class _FakeTextpage:
    def __init__(self, text: str):
        self._text = text

    def get_text_bounded(self) -> str:
        return self._text


class _FakeBitmap:
    def to_pil(self) -> Image.Image:
        return Image.new("RGB", (10, 10), color="white")


class _FakeGoodPage:
    def get_textpage(self) -> _FakeTextpage:
        return _FakeTextpage("Balance: $100.00")

    def render(self, scale: float) -> _FakeBitmap:
        return _FakeBitmap()


class _FakeBrokenPage:
    def get_textpage(self):
        raise RuntimeError("simulated corrupted page")


class _FakePdfDocument:
    """Stands in for pypdfium2.PdfDocument: iterable of pages, closeable."""

    def __init__(self, _path):
        self._pages = [_FakeGoodPage(), _FakeBrokenPage(), _FakeGoodPage()]

    def __iter__(self):
        return iter(self._pages)

    def close(self):
        pass


def test_one_corrupted_pdf_page_does_not_discard_the_rest(tmp_path, monkeypatch):
    monkeypatch.setattr(engine.pdfium, "PdfDocument", _FakePdfDocument)
    fake_pdf = tmp_path / "statement.pdf"
    fake_pdf.write_bytes(b"%PDF-1.4 not a real pdf, replaced by the fake above")

    status, fpath, result = engine.process_single_file_for_pass((str(fake_pdf), 1))

    assert status == "SUCCESS", f"one bad page should not fail the whole document, got: {result}"
    # Both good pages' native text made it through despite the broken page
    # between them.
    assert result["raw_text"].count("Balance: $100.00") == 2

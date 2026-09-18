"""Real tests for scripts/ocr_spark_engine.py.

Scope, deliberately: these test what changed in the reliability/accuracy
hardening pass (timeouts, real confidence wiring, deskew, the merge-logic
dedup) using the actual Tesseract binary and actual generated images -- not
mocks standing in for OCR output. PaddleOCR/EasyOCR/Surya are not installed
on every machine this suite runs on, so nothing here asserts on their
behavior; a test that only passes because an engine is silently absent would
prove nothing and is worse than no test.
"""
import time
from datetime import datetime, timezone

import pytest
from PIL import Image, ImageDraw

import ocr_spark_engine as engine


# ---------------------------------------------------------------------------
# _run_with_timeout -- a real executor-deadlock bug, caught by review before
# it shipped further. A timeout on a shared, fixed-size ThreadPoolExecutor
# only stops the CALLER from waiting; it cannot stop the underlying thread if
# the call is genuinely hung. With a shared pool, every real timeout
# permanently consumed one worker slot (the orphaned call keeps running
# forever), so after enough real timeouts every future call would queue
# forever waiting for a slot that never frees -- a total, silent stall.
# Fixed by giving every call its own single-use executor instead of sharing
# one. These tests prove the fix, not just the timeout itself firing.
# ---------------------------------------------------------------------------

def test_run_with_timeout_raises_on_a_real_hang():
    def hang():
        time.sleep(5)
        return "should never be seen"

    with pytest.raises(engine.FutureTimeoutError):
        engine._run_with_timeout(hang, timeout=0.2)


def test_timed_out_call_does_not_starve_a_later_call():
    """The actual regression test: if this were still a shared fixed-size
    pool, the orphaned hang below would permanently occupy its only worker
    slot and this second, fast call would queue forever waiting for a slot
    that never frees -- this test would hang instead of completing."""
    def hang():
        time.sleep(5)

    with pytest.raises(engine.FutureTimeoutError):
        engine._run_with_timeout(hang, timeout=0.2)

    start = time.perf_counter()
    result = engine._run_with_timeout(lambda: "fast", timeout=5.0)
    elapsed = time.perf_counter() - start

    assert result == "fast"
    assert elapsed < 2.0, f"second call took {elapsed:.1f}s after the first timed out -- looks starved, not independent"


def test_dgx_worker_has_no_shared_job_executor():
    """Regression guard: dgx_worker.py's job-level timeout had the identical
    bug (max_workers=1, so a single real timeout stalled the worker
    permanently for every job after it). The fix removed the shared
    module-level executor entirely in favor of one fresh executor per job
    inside process_claimed_job() -- this asserts that anti-pattern doesn't
    silently come back."""
    import dgx_worker
    assert not hasattr(dgx_worker, "_job_executor"), (
        "dgx_worker._job_executor exists again -- a shared, fixed-size "
        "executor for job timeouts reintroduces the exact deadlock this "
        "test suite exists to catch: one real timeout permanently occupies "
        "its only slot and every subsequent job queues forever."
    )


# ---------------------------------------------------------------------------
# _run_engine_call -- the follow-on race the fresh-executor-per-call fix
# above introduced: an orphaned thread from a timeout keeps running against
# the SAME shared engine singleton (PaddleOCR/EasyOCR/Surya/TrOCR are each a
# single global model object). Without serializing access, a later call to
# the same engine would invoke that non-thread-safe object concurrently.
# ---------------------------------------------------------------------------

def test_run_engine_call_raises_busy_when_lock_is_held():
    lock = engine.threading.Lock()
    lock.acquire()
    try:
        with pytest.raises(engine.EngineBusyError):
            engine._run_engine_call(lock, lambda: "should not run", timeout=1.0)
    finally:
        lock.release()


def test_run_engine_call_serializes_a_real_orphaned_hang():
    """The actual regression test: start a call that hangs past our timeout
    (leaving its thread orphaned and still holding the lock), then
    immediately try a second call against the same lock. It must be
    rejected as busy, not run concurrently against the "same" engine."""
    lock = engine.threading.Lock()

    def hang():
        time.sleep(5)

    with pytest.raises(engine.FutureTimeoutError):
        engine._run_engine_call(lock, hang, timeout=0.2)

    # The orphaned thread from the call above is still running (and still
    # holding `lock`) well past our 0.2s timeout -- a second call right now
    # must see the engine as busy, not race it.
    with pytest.raises(engine.EngineBusyError):
        engine._run_engine_call(lock, lambda: "fast", timeout=1.0)


def test_run_engine_call_succeeds_once_the_lock_is_free():
    lock = engine.threading.Lock()
    result = engine._run_engine_call(lock, lambda: "fast", timeout=1.0)
    assert result == "fast"
    assert lock.acquire(blocking=False), "lock must be released after a successful call"
    lock.release()


# ---------------------------------------------------------------------------
# init_worker -- idempotency flag must be set even when an optional engine
# fails to load, or every subsequent job on a long-running worker re-attempts
# (and re-fails) full initialization instead of just skipping that engine.
# ---------------------------------------------------------------------------

def test_init_worker_marks_initialized_even_on_partial_failure(monkeypatch):
    monkeypatch.setattr(engine, "_worker_initialized", False)

    def boom(*args, **kwargs):
        raise RuntimeError("simulated engine load failure")

    monkeypatch.setattr(engine, "spacy", type("Bad", (), {"load": staticmethod(boom)}))
    engine.init_worker()
    assert engine._worker_initialized is True, (
        "a failure partway through init_worker() must still mark the worker "
        "initialized -- otherwise every future job re-attempts (and "
        "re-fails) full init instead of just treating the failed engine as "
        "unavailable, the way every call site already handles a None engine."
    )


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
# BSB/DOB false-positive matching (the Python-dictionary counterpart of the
# same class of bug documented for the TypeScript matcher in the issue
# register). A real fix was found partially applied and uncommitted by an
# interrupted review pass -- verified here rather than trusted, and the
# result is a genuine but PARTIAL improvement, not a full fix. Both are
# recorded explicitly so nobody has to rediscover the gap by hand later.
# ---------------------------------------------------------------------------

def test_bsb_regex_requires_an_explicit_separator():
    """Real, if narrow, improvement: a bare 6-digit run with no separator
    character no longer matches as a BSB at all (previously the separator
    was optional, so e.g. an unrelated 6-consecutive-digit account number
    typed with no grouping could be misread as a BSB)."""
    text = "Reference 123456 for your records"
    result = engine.extract_australian_banking_fields(text)
    assert result["fields"]["bsb"] == ""


def test_bsb_regex_still_false_positives_on_a_spaced_abn():
    """Honest limitation, verified directly rather than assumed fixed: the
    mandatory-separator change above does NOT fix the false positive
    documented in the issue register, because an ABN's own digit-group
    spacing ("51 824 753 556") already contains a real space -- exactly the
    separator character the regex requires. This still misreads part of the
    ABN as a BSB. This test exists so nobody mistakes the narrower fix above
    for a complete one; a real fix needs label-context anchoring, not just a
    mandatory separator."""
    text = "ABN: 51 824 753 556"
    result = engine.extract_australian_banking_fields(text)
    assert result["fields"]["bsb"] != "", (
        "if this now passes, the false positive has actually been fixed -- "
        "update this test (and the issue register) to say so instead of "
        "deleting it"
    )


def test_format_only_validated_fields_get_reduced_confidence():
    """BSB and DOB validation both only check the value's SHAPE (a plausible
    range, a parseable date), not that it's actually the right identifier in
    context -- the issue register's own diagnosis of why these false
    positives get reported as high-confidence 'valid' matches. Confidence
    for the whole-text, no-label digit sweep was lowered (0.98->0.60 BSB,
    0.95->0.85 DOB) to more honestly reflect that.

    Deliberately uses text with NO "BSB"/"DOB" label anywhere near the
    value: a real label match goes through the separate contextual
    line-scanning path instead (matched a field's own name near a colon),
    which legitimately keeps high confidence -- that IS strong context, not
    a false positive, and correctly overrides these lower values when both
    paths find the same field. This test would misleadingly pass even with
    the confidence fix reverted if it used a labelled value instead."""
    result = engine.extract_australian_banking_fields("Reference 062-000 filed under 15/06/1985 correspondence")
    if result["fields"]["bsb"]:
        assert result["confidences"]["bsb"] <= 0.60
    if result["fields"]["date_of_birth"]:
        assert result["confidences"]["date_of_birth"] <= 0.85


def test_line_scan_cannot_overwrite_a_valid_bsb_with_garbage():
    """Regression test for the follow-on bug the confidence-lowering above
    created: BSB/DOB's unlabeled-sweep confidence was deliberately lowered
    (0.60/0.85) so a REAL label match could legitimately override it -- but
    the line-scan path never validated its own extracted value, so a label
    line with garbage after it (e.g. "BSB: TBC", higher line confidence than
    0.60) would clobber an already-correct, validated match with junk. Line
    order matters here: the valid BSB is found by the whole-text sweep
    first, then the garbage-labelled line must fail to overwrite it."""
    text = "Account details 062-000 held with the bank.\nBSB: TBC pending confirmation"
    result = engine.extract_australian_banking_fields(text)
    assert result["fields"]["bsb"] == "062-000", (
        "an unvalidated line-scan value overwrote a genuinely valid BSB match"
    )


def test_line_scan_still_accepts_a_genuinely_correct_labelled_bsb():
    """The fix must not block legitimate label matches -- only garbage."""
    text = "Reference 999-999 archived.\nBSB: 062-000"
    result = engine.extract_australian_banking_fields(text)
    assert result["fields"]["bsb"] == "062-000"


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


class _FakeDobTextpage:
    def get_text_bounded(self) -> str:
        return "Marital Status: Married"


class _FakeDobPage:
    def get_textpage(self) -> _FakeDobTextpage:
        return _FakeDobTextpage()

    def render(self, scale: float) -> _FakeBitmap:
        return _FakeBitmap()


class _FakeDobPdfDocument:
    def __init__(self, _path):
        self._pages = [_FakeDobPage()]

    def __iter__(self):
        return iter(self._pages)

    def close(self):
        pass


def test_native_text_keeps_high_confidence_even_when_other_images_are_ocrd(tmp_path, monkeypatch):
    """Regression test: on pass_num > 1, every PDF page is rasterized and
    OCR'd regardless of already having native text (see the rasterize
    condition in process_single_file_for_pass). That made
    ocr_line_confidences non-empty even for a page whose text came from the
    native layer, so extract_australian_banking_fields's per-line .get()
    fell through to the conservative 0.75 OCR-guess default for the native
    line -- silently downgrading exact text to a guess confidence purely
    because some OTHER image on the same pass happened to need OCR too.
    Native lines must keep their 0.95 confidence regardless. Uses a field
    (marital_status) with no whole-text regex sweep of its own, so its
    confidence can only come from the per-line contextual scan -- an
    unambiguous signal of which code path actually set it."""
    monkeypatch.setattr(engine.pdfium, "PdfDocument", _FakeDobPdfDocument)
    monkeypatch.setattr(
        engine,
        "run_pass_ocr",
        lambda img, pass_num: ("unrelated ocr noise", ["Tesseract"], {"unrelated ocr noise": 0.3}),
    )
    fake_pdf = tmp_path / "statement.pdf"
    fake_pdf.write_bytes(b"%PDF-1.4 not a real pdf, replaced by the fake above")

    # pass_num=2 forces rasterization (and thus OCR) of every page, even the
    # ones that already yielded native text.
    status, _fpath, result = engine.process_single_file_for_pass((str(fake_pdf), 2))

    assert status == "SUCCESS"
    assert result["fields"]["marital_status"] == "Married"
    assert result["confidences"]["marital_status"] == 0.95, (
        "a native-text field's confidence must stay at the high fixed value "
        "even when other images on the same pass were OCR'd, got "
        f"{result['confidences']['marital_status']}"
    )


def test_one_corrupted_pdf_page_does_not_discard_the_rest(tmp_path, monkeypatch):
    monkeypatch.setattr(engine.pdfium, "PdfDocument", _FakePdfDocument)
    fake_pdf = tmp_path / "statement.pdf"
    fake_pdf.write_bytes(b"%PDF-1.4 not a real pdf, replaced by the fake above")

    status, fpath, result = engine.process_single_file_for_pass((str(fake_pdf), 1))

    assert status == "SUCCESS", f"one bad page should not fail the whole document, got: {result}"
    # Both good pages' native text made it through despite the broken page
    # between them.
    assert result["raw_text"].count("Balance: $100.00") == 2

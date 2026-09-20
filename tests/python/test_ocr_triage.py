"""Triage module: shapes, batching, routing thresholds and safe degradation. Uses a randomly initialised network, so
these prove plumbing and policy only; classification accuracy is measured by scripts/triage_eval.py on labelled pages."""
import pytest
from PIL import Image, ImageDraw

torch = pytest.importorskip("torch")
pytest.importorskip("torchvision")

import ocr_triage as tri


def page(ink=False):
    im = Image.new("RGB", (300, 400), "white")
    if ink:
        d = ImageDraw.Draw(im)
        for y in range(20, 380, 12):
            d.rectangle([20, y, 280, y + 4], fill="black")
    return im


def test_preprocess_is_letterboxed_3_channel_and_normalised():
    a = tri.preprocess(page(), size=128)
    assert a.shape == (3, 128, 128) and a.dtype.name == "float32"
    # white page -> (1 - mean) / std on channel 0
    assert a[0, 0, 0] == pytest.approx((1 - 0.485) / 0.229, abs=1e-4)


def test_ink_ratio_separates_blank_from_written():
    assert tri.ink_ratio(page()) == 0.0
    assert tri.ink_ratio(page(ink=True)) > 0.05


def test_predict_batch_returns_a_class_and_probability_per_image_across_batches():
    m = tri.TriageModel(tri.build_model(), "cpu")
    out = m.predict_batch([page(), page(True), page()], batch_size=2)
    assert len(out) == 3
    assert all(k in tri.CLASSES and 0.0 < p <= 1.0 for k, p in out)


@pytest.mark.parametrize("kind,prob,ink,expected", [
    ("handwritten", 0.99, 0.05, "handwritten"),
    ("both", 0.85, 0.05, "both"),
    ("printed", 0.60, 0.05, "uncertain"),          # below the confidence floor
    ("blank", 0.99, 0.001, "blank"),                # confident AND clean: skip
    ("blank", 0.99, 0.02, "printed"),               # confident but some ink: never skipped
    ("blank", 0.99, 0.10, "uncertain"),             # lots of ink: photo or missed content, ask Qwen
    ("blank", 0.90, 0.001, "printed"),              # under the stricter blank threshold
])
def test_route_policy_errs_toward_reading_the_page(kind, prob, ink, expected):
    assert tri.route(kind, prob, ink) == expected


def test_load_round_trip(tmp_path):
    src = tri.TriageModel(tri.build_model(), "cpu")
    p = tmp_path / "w.pt"
    torch.save({"model": src.model.state_dict()}, p)
    loaded = tri.TriageModel.load(str(p), device="cpu")
    imgs = [page(True)]
    assert loaded.predict_batch(imgs)[0][0] == src.predict_batch(imgs)[0][0]


def test_no_weights_configured_means_triage_disabled(monkeypatch):
    monkeypatch.delenv("OCRDOCS_TRIAGE_WEIGHTS", raising=False)
    assert tri.load_if_configured() is None


def test_missing_or_corrupt_weights_disable_triage_instead_of_crashing(monkeypatch, tmp_path):
    monkeypatch.setenv("OCRDOCS_TRIAGE_WEIGHTS", str(tmp_path / "absent.pt"))
    assert tri.load_if_configured() is None
    bad = tmp_path / "bad.pt"
    bad.write_bytes(b"not a checkpoint")
    monkeypatch.setenv("OCRDOCS_TRIAGE_WEIGHTS", str(bad))
    assert tri.load_if_configured() is None

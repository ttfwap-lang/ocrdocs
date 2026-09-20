"""Unit tests for the hybrid Tesseract + TrOCR line router (fakes only: no models needed)."""
import os
import sys

import numpy as np
import pytest
from PIL import Image

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "scripts"))
import ocr_hybrid as h  # noqa: E402


class FakeReader:
    def __init__(self, mapping):
        self.mapping = mapping  # (crop width) -> (text, conf)
        self.calls = 0

    def recognize(self, crops):
        self.calls += 1
        return [self.mapping.get(c.size[0] - 12, ("", 0.0)) for c in crops]  # crop = box width + 2*pad(6)


def page(w=400, h=300):
    return Image.new("RGB", (w, h), "white")


def line(x0, y0, x1, y1, text, conf):
    return h.Line(x0, y0, x1, y1, text, conf, "Tesseract", text, conf)


def test_confident_tesseract_lines_are_kept_and_trocr_is_not_called():
    reader = FakeReader({})
    lines = [line(10, 10, 210, 40, "Statement of account", 0.95)]
    out = h.recognize_page(page(), reader, tesseract_fn=lambda im: lines)
    assert [(l.text, l.engine) for l in out] == [("Statement of account", "Tesseract")]
    assert reader.calls == 0


def test_weak_line_is_replaced_by_a_more_confident_trocr_reading():
    reader = FakeReader({150: ("Given name John Smith", 0.88)})
    weak = line(10, 60, 160, 90, "gvn n@me j0hn", 0.31)  # width 150
    out = h.recognize_page(page(), reader, tesseract_fn=lambda im: [weak])
    assert out[0].text == "Given name John Smith"
    assert out[0].engine == "TrOCR"
    assert out[0].tess_text == "gvn n@me j0hn"  # original kept for audit


def test_low_confidence_trocr_does_not_replace_tesseract():
    reader = FakeReader({150: ("zzzzz", 0.10)})
    weak = line(10, 60, 160, 90, "some text", 0.40)
    out = h.recognize_page(page(), reader, tesseract_fn=lambda im: [weak])
    assert out[0].text == "some text" and out[0].engine == "Tesseract"


def test_trocr_must_beat_tesseract_confidence_to_replace_it():
    reader = FakeReader({150: ("other text", 0.60)})
    weak = line(10, 60, 160, 90, "some text", 0.70)  # below 0.72 threshold but better than TrOCR's 0.60
    out = h.recognize_page(page(), reader, tesseract_fn=lambda im: [weak])
    assert out[0].text == "some text"


def test_without_a_reader_only_tesseract_lines_are_returned_in_reading_order():
    lines = [line(10, 100, 200, 130, "second", 0.2), line(10, 10, 200, 40, "first", 0.95)]
    out = h.recognize_page(page(), None, tesseract_fn=lambda im: lines)
    assert [l.text for l in out] == ["first", "second"]


def test_inked_region_tesseract_missed_is_found_and_read_by_trocr():
    img = page(600, 300)
    arr = np.array(img)
    # a thick wavy pen stroke (stands in for handwriting Tesseract returned nothing for)
    for x in range(60, 500):
        y = 140 + int(12 * np.sin(x / 9.0))
        arr[y - 3: y + 3, x] = 0
    img = Image.fromarray(arr)
    boxes = h.uncovered_ink_lines(img, [])
    assert len(boxes) == 1
    x0, y0, x1, y1 = boxes[0]
    reader = FakeReader({x1 - x0: ("handwritten note", 0.81)})
    out = h.recognize_page(img, reader, tesseract_fn=lambda im: [])
    assert [(l.text, l.engine) for l in out] == [("handwritten note", "TrOCR")]


def test_ink_already_covered_by_a_tesseract_line_is_not_reprocessed():
    img = page(600, 300)
    arr = np.array(img)
    arr[130:150, 60:500] = 0
    img = Image.fromarray(arr)
    covered = [line(55, 125, 505, 155, "printed heading", 0.95)]
    assert h.uncovered_ink_lines(img, covered) == []


def test_junk_trocr_output_for_an_ink_blob_is_dropped():
    img = page(600, 300)
    arr = np.array(img)
    arr[130:150, 60:500] = 0
    img = Image.fromarray(arr)
    reader = FakeReader({440: ("", 0.0)})
    assert h.recognize_page(img, reader, tesseract_fn=lambda im: []) == []


def test_lines_to_text_joins_in_order():
    assert h.lines_to_text([line(0, 0, 1, 1, "a", 1), line(0, 5, 1, 6, "b", 1)]) == "a\nb"


def test_trocr_failure_never_discards_the_tesseract_reading():
    class Boom:
        def recognize(self, crops):
            raise RuntimeError("cuda exploded")

    weak = line(10, 60, 160, 90, "gvn n@me", 0.3)
    out = h.recognize_page(page(), Boom(), tesseract_fn=lambda im: [weak])
    assert [(l.text, l.engine) for l in out] == [("gvn n@me", "Tesseract")]


def test_trocr_shrinks_its_batch_on_gpu_oom_then_falls_back_to_cpu(monkeypatch):
    torch = pytest.importorskip("torch")
    if not hasattr(torch.cuda, "OutOfMemoryError"):
        pytest.skip("torch too old")
    reader = h.TrOCRReader()
    reader.available = True
    reader._device = "cuda"

    class FakeModel:
        def to(self, dev):
            reader._device = dev
            return self

    reader._model = FakeModel()
    calls = []

    def run_batch(batch, torch_mod):
        calls.append((len(batch), reader._device))
        if reader._device == "cuda":
            raise torch.cuda.OutOfMemoryError("oom")
        return [("ok", 0.9)] * len(batch)

    monkeypatch.setattr(reader, "_run_batch", run_batch)
    monkeypatch.setattr(torch.cuda, "empty_cache", lambda: None)
    crops = [Image.new("RGB", (50, 20), "white") for _ in range(4)]
    out = reader.recognize(crops)
    assert out == [("ok", 0.9)] * 4
    assert calls[0][0] == 4 and reader._device == "cpu"  # started at full batch, ended on CPU


def test_model_placement_falls_back_to_cpu_when_the_gpu_cannot_even_create_a_context():
    torch = pytest.importorskip("torch")

    class Model:
        def __init__(self):
            self.dev = None

        def to(self, dev):
            if dev == "cuda":
                raise RuntimeError("CUDA error: out of memory\nSearch for cudaErrorMemoryAllocation")
            self.dev = dev
            return self

    monkey_available = torch.cuda.is_available
    torch.cuda.is_available = lambda: True
    try:
        model, device = h.TrOCRReader.place_model(Model(), torch)
    finally:
        torch.cuda.is_available = monkey_available
    assert device == "cpu" and model.dev == "cpu"

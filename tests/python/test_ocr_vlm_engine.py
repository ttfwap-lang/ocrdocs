"""vlm_v2 page routing in ocr_spark_engine: which reader each page kind reaches, and how each service outage degrades.

Paddle-VL, Qwen and the hybrid reader are replaced with fakes; nothing here needs a GPU or a network.
"""
import pytest
from PIL import Image

import ocr_hybrid
import ocr_paddle_vl
import ocr_qwen_merge as qm
import ocr_spark_engine as engine


def page():
    return Image.new("RGB", (300, 200), "white")


class Calls:
    def __init__(self):
        self.log = []


@pytest.fixture
def stack(monkeypatch):
    """Healthy fake stack; tests override single pieces to simulate outages."""
    c = Calls()
    monkeypatch.setattr(qm, "classify_page", lambda img, **k: c.log.append("classify") or c.kind)
    monkeypatch.setattr(ocr_paddle_vl, "read_page", lambda img, **k: c.log.append("paddle") or "BSB 062 000\nAccount name")
    monkeypatch.setattr(
        ocr_hybrid, "recognize_page",
        lambda img, reader, **k: c.log.append("hybrid") or [
            ocr_hybrid.Line(0, 0, 50, 10, "John Smith", 0.91, "TrOCR"),
            ocr_hybrid.Line(0, 20, 50, 30, "Printed label", 0.95, "Tesseract"),
        ],
    )
    monkeypatch.setattr(
        qm, "merge_page",
        lambda img, ptxt, lines, **k: c.log.append(("merge", ptxt, list(lines)))
        or qm.MergeResult([qm.MergedField("family_name", "Smith", "handwriting", 0.7, None)]),
    )
    monkeypatch.setattr(engine, "run_pass_ocr", lambda img, n: c.log.append("legacy") or ("legacy text", ["Tesseract"], {"legacy text": 0.8}))
    c.kind = "both"
    return c


def test_printed_page_uses_paddle_only(stack):
    stack.kind = "printed"
    r = engine.run_page_vlm(page())
    assert "paddle" in stack.log and "hybrid" not in stack.log
    assert r["engines"] == ["PaddleOCR-VL", "Qwen3-VL"] and not r["degraded"]


def test_handwritten_page_uses_hybrid_only(stack):
    stack.kind = "handwritten"
    r = engine.run_page_vlm(page())
    assert "hybrid" in stack.log and "paddle" not in stack.log
    assert "TrOCR" in r["engines"]


def test_both_page_runs_both_and_merge_gets_only_trocr_lines_as_handwriting(stack):
    r = engine.run_page_vlm(page())
    merge = next(x for x in stack.log if isinstance(x, tuple))
    assert merge[1].startswith("BSB 062 000") and merge[2] == [("John Smith", 0.91)]
    assert [f.name for f in r["fields"]] == ["family_name"]


@pytest.mark.parametrize("kind", ["blank", "photo"])
def test_blank_and_photo_pages_skip_every_reader(stack, kind):
    stack.kind = kind
    r = engine.run_page_vlm(page())
    assert stack.log == ["classify"] and r["text"] == "" and r["fields"] == []


def test_classifier_down_treats_page_as_both_and_marks_degraded(stack, monkeypatch):
    def boom(img, **k):
        raise qm.QwenUnavailable("down")

    monkeypatch.setattr(qm, "classify_page", boom)
    r = engine.run_page_vlm(page())
    assert "paddle" in stack.log and "hybrid" in stack.log and r["degraded"]


def test_paddle_down_falls_back_to_legacy_read(stack, monkeypatch):
    def boom(img, **k):
        raise ocr_paddle_vl.PaddleUnavailable("down")

    monkeypatch.setattr(ocr_paddle_vl, "read_page", boom)
    r = engine.run_page_vlm(page())
    assert r["text"] == "legacy text" and r["degraded"] and r["fields"] == []


def test_qwen_merge_down_keeps_ocr_text_without_fields(stack, monkeypatch):
    def boom(*a, **k):
        raise qm.QwenUnavailable("down")

    monkeypatch.setattr(qm, "merge_page", boom)
    r = engine.run_page_vlm(page())
    assert "BSB 062 000" in r["text"] and "John Smith" in r["text"]
    assert r["fields"] == [] and r["degraded"]


def test_handwriting_reader_crash_keeps_paddle_text(stack, monkeypatch):
    def boom(img, reader, **k):
        raise RuntimeError("cuda oom")

    monkeypatch.setattr(ocr_hybrid, "recognize_page", boom)
    r = engine.run_page_vlm(page())
    assert "BSB 062 000" in r["text"] and r["degraded"]


def test_single_file_pass_reports_pages_and_fields_only_in_vlm_mode(stack, monkeypatch, tmp_path):
    f = tmp_path / "scan.png"
    page().save(f)
    monkeypatch.setattr(engine, "PIPELINE_MODE", "vlm_v2")
    status, _, result = engine.process_single_file_for_pass((str(f), 1))
    assert status == "SUCCESS"
    assert result["pages"] == [{"imageIndex": 0, "kind": "both", "engines": result["pages"][0]["engines"],
                                "degraded": False, "fieldCount": 1}]
    assert result["vlm_fields"][0]["name"] == "family_name" and result["vlm_fields"][0]["imageIndex"] == 0

    monkeypatch.setattr(engine, "PIPELINE_MODE", "legacy")
    stack.log.clear()
    status, _, result = engine.process_single_file_for_pass((str(f), 1))
    assert "pages" not in result and "vlm_fields" not in result and "classify" not in stack.log

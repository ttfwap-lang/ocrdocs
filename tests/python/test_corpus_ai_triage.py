"""AI triage policy: only a confident, text-free photo or blank is ever a quarantine candidate; everything else is kept."""
import json
import os
import sys

import pytest
from PIL import Image

import corpus_ai_triage as t


def label(kind, text=False, conf=0.95):
    return {"kind": kind, "contains_readable_text": text, "confidence": conf}


@pytest.mark.parametrize("lab,expected", [
    (label("photo"), True),
    (label("blank"), True),
    (label("photo", conf=0.84), False),                    # not confident enough
    (label("photo", text=True), False),                    # any legible words: keep
    (label("document"), False),
    (label("handwritten_document"), False),
    (label("screenshot"), False),
    (label("other"), False),
    ({"kind": "error", "contains_readable_text": True, "confidence": 0.0}, False),
])
def test_only_confident_text_free_photos_and_blanks_fail(lab, expected):
    assert t.fails_check(lab) is expected


def test_malformed_model_answers_become_a_never_deletable_error_label():
    for raw in ({}, {"kind": "banana", "contains_readable_text": False, "confidence": 1}, {"kind": "photo", "contains_readable_text": "no", "confidence": 1},
                {"kind": "photo", "contains_readable_text": False, "confidence": "high"}):
        lab = t.normalise(raw)
        assert lab["kind"] == "error" and not t.fails_check(lab)


def test_confidence_is_clamped():
    assert t.normalise({"kind": "photo", "contains_readable_text": False, "confidence": 7})["confidence"] == 1.0


def rows(tmp_path, n=3):
    out = []
    for i in range(n):
        p = tmp_path / f"f{i}.png"
        Image.new("RGB", (50, 50), "white").save(p)
        out.append((f"id{i}", "no_text", str(p)))
    return out


def test_run_writes_only_labels_never_images_or_text_and_is_resumable(tmp_path):
    out = str(tmp_path / "labels.jsonl")
    calls = []

    def ask(im):
        calls.append(im.size)
        return {"kind": "photo", "contains_readable_text": False, "confidence": 0.99}

    assert t.run(rows(tmp_path), out, ask) == 3
    entries = [json.loads(l) for l in open(out)]
    assert all(set(e) == {"id", "survey", "kind", "contains_readable_text", "confidence", "fails", "secs"} for e in entries)
    assert all(e["fails"] for e in entries)
    assert t.run(rows(tmp_path), out, ask) == 0 and len(calls) == 3        # second run skips everything already labelled
    if sys.platform != "win32":
        assert oct(os.stat(out).st_mode & 0o777) == "0o600"


def test_model_and_file_errors_are_recorded_and_kept(tmp_path):
    out = str(tmp_path / "labels.jsonl")
    r = rows(tmp_path, 2) + [("bad", "no_text", str(tmp_path / "missing.png"))]

    def ask(im):
        raise OSError("model down")

    t.run(r, out, ask)
    entries = [json.loads(l) for l in open(out)]
    assert len(entries) == 3 and all(e["kind"] == "error" and not e["fails"] for e in entries)


def test_sample_is_deterministic_and_bounded(tmp_path):
    a, b = str(tmp_path / "a.jsonl"), str(tmp_path / "b.jsonl")
    ask = lambda im: {"kind": "photo", "contains_readable_text": False, "confidence": 0.99}  # noqa: E731
    r = rows(tmp_path, 10)
    t.run(r, a, ask, sample=4)
    t.run(r, b, ask, sample=4)
    ids = lambda p: sorted(json.loads(l)["id"] for l in open(p))  # noqa: E731
    assert len(ids(a)) == 4 and ids(a) == ids(b)


def test_report_summarises_counts(tmp_path):
    out = str(tmp_path / "labels.jsonl")
    answers = iter([label("photo"), label("document", text=True), label("photo", text=True)])
    t.run(rows(tmp_path), out, lambda im: next(answers))
    rep = t.report(out)
    assert rep["labelled"] == 3 and rep["by_kind"] == {"photo": 2, "document": 1} and rep["would_fail"] == 1 and rep["with_readable_text"] == 2


def test_prompt_and_schema_are_fixed_and_carry_no_free_text_field():
    assert set(t.SCHEMA["properties"]) == {"kind", "contains_readable_text", "confidence"}
    assert t.SCHEMA["properties"]["kind"]["enum"] == t.KINDS


# ---- second, independent look ------------------------------------------------------------------------------------------
@pytest.mark.parametrize("raw,expected", [
    ({"contains_paperwork": False, "contains_readable_text": False, "confidence": 0.95}, True),
    ({"contains_paperwork": True, "contains_readable_text": False, "confidence": 0.99}, False),
    ({"contains_paperwork": False, "contains_readable_text": True, "confidence": 0.99}, False),
    ({"contains_paperwork": False, "contains_readable_text": False, "confidence": 0.8}, False),
    ({"contains_paperwork": False, "contains_readable_text": False}, False),
    ({}, False),
])
def test_the_second_look_confirms_only_when_it_is_confident_of_no_paperwork_and_no_text(raw, expected):
    assert t.confirms(raw) is expected


def test_verify_rechecks_only_first_pass_failures_at_higher_resolution_and_any_error_keeps_the_file(tmp_path):
    labels = str(tmp_path / "labels.jsonl")
    with open(labels, "w") as f:
        for i, fails in enumerate([True, True, False, True]):
            f.write(json.dumps({"id": f"id{i}", "fails": fails}) + "\n")
    paths = {}
    for i in range(4):
        p = tmp_path / f"f{i}.png"
        Image.new("RGB", (40, 40), "white").save(p)
        paths[f"id{i}"] = str(p)
    sides = []
    answers = {"id0": {"contains_paperwork": False, "contains_readable_text": False, "confidence": 0.97},
               "id1": {"contains_paperwork": True, "contains_readable_text": False, "confidence": 0.97}}

    def render_fn(path, side):
        sides.append(side)
        return path

    def ask2(path):
        idx = "id" + os.path.basename(path)[1]
        if idx == "id3":
            raise OSError("model down")
        return answers[idx]

    out = str(tmp_path / "verified.jsonl")
    assert t.verify(labels, out, paths, ask2, render_fn) == 3
    got = {json.loads(l)["id"]: json.loads(l)["confirmed"] for l in open(out)}
    assert got == {"id0": True, "id1": False, "id3": False}
    assert set(sides) == {t.VERIFY_SIDE}
    assert t.verify(labels, out, paths, ask2, render_fn) == 0


def test_the_verify_prompt_leans_toward_keeping_the_file():
    assert "When in doubt, answer true" in t.PROMPT2

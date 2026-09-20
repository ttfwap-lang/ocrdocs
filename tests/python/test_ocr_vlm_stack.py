"""Paddle-VL client and Qwen classify/merge, with the HTTP layer replaced by fakes (no GPU, no network)."""
import json

import pytest
from PIL import Image

import ocr_paddle_vl as paddle
import ocr_qwen_merge as qm


def img(w=200, h=100):
    return Image.new("RGB", (w, h), "white")


def reply(content):
    return {"choices": [{"message": {"content": content}}]}


# ---- Paddle-VL ---------------------------------------------------------------------------------------------------
def test_paddle_sends_ocr_prompt_and_image_and_returns_text():
    seen = {}

    def post(url, body, timeout):
        seen.update(url=url, body=body)
        return reply("  Hello world \n")

    assert paddle.read_page(img(), post=post, base_url="http://x:1/") == "Hello world"
    assert seen["url"] == "http://x:1/v1/chat/completions"
    parts = seen["body"]["messages"][0]["content"]
    assert parts[0]["image_url"]["url"].startswith("data:image/png;base64,")
    assert parts[1]["text"] == "OCR:"


def test_paddle_retries_then_succeeds(monkeypatch):
    monkeypatch.setattr(paddle.time, "sleep", lambda s: None)
    calls = []

    def post(url, body, timeout):
        calls.append(1)
        if len(calls) < 3:
            raise OSError("connection refused")
        return reply("ok")

    assert paddle.read_page(img(), post=post) == "ok"
    assert len(calls) == 3


def test_paddle_raises_unavailable_after_retries(monkeypatch):
    monkeypatch.setattr(paddle.time, "sleep", lambda s: None)

    def post(url, body, timeout):
        raise OSError("down")

    with pytest.raises(paddle.PaddleUnavailable):
        paddle.read_page(img(), post=post)


def test_paddle_malformed_body_is_unavailable_not_a_crash(monkeypatch):
    monkeypatch.setattr(paddle.time, "sleep", lambda s: None)
    with pytest.raises(paddle.PaddleUnavailable):
        paddle.read_page(img(), post=lambda u, b, t: {"choices": []})


# ---- classify ----------------------------------------------------------------------------------------------------
def test_classify_returns_kind_and_downscales_the_image():
    seen = {}

    def post(url, body, timeout):
        seen["body"] = body
        return reply(json.dumps({"kind": "handwritten"}))

    assert qm.classify_page(img(3000, 2000), post=post) == "handwritten"
    assert seen["body"]["response_format"]["json_schema"]["schema"]["properties"]["kind"]["enum"] == qm.PAGE_KINDS
    import base64, io
    b64 = seen["body"]["messages"][0]["content"][0]["image_url"]["url"].split(",", 1)[1]
    sent = Image.open(io.BytesIO(base64.b64decode(b64)))
    assert max(sent.size) == qm.CLASSIFY_MAX_SIDE


def test_classify_unknown_kind_means_run_everything():
    assert qm.classify_page(img(), post=lambda u, b, t: reply(json.dumps({"kind": "receipt"}))) == "both"


def test_classify_bad_json_is_qwen_unavailable():
    with pytest.raises(qm.QwenUnavailable):
        qm.classify_page(img(), post=lambda u, b, t: reply("not json"))


# ---- merge + digit guard -----------------------------------------------------------------------------------------
def merged(fields):
    return lambda u, b, t: reply(json.dumps({"fields": fields}))


def test_digits_seen_by_an_engine_are_verified():
    post = merged([{"name": "bsb", "value": "062-000", "source": "print"}])
    r = qm.merge_page(img(), "BSB 062 000", [], post=post)
    f = r.fields[0]
    assert (f.name, f.digits_verified, f.confidence) == ("bsb", True, 0.85)


def test_digits_from_handwriting_lines_count_as_seen():
    post = merged([{"name": "account_number", "value": "12345678", "source": "handwriting"}])
    r = qm.merge_page(img(), "Account number", [("1234 5678", 0.9)], post=post)
    assert r.fields[0].digits_verified is True and r.fields[0].source == "handwriting"


def test_invented_digits_are_flagged_and_low_confidence():
    post = merged([{"name": "account_number", "value": "99887766", "source": "handwriting"}])
    r = qm.merge_page(img(), "Account number 12345678", [], post=post)
    f = r.fields[0]
    assert f.digits_verified is False and f.confidence == 0.35


def test_values_with_few_digits_are_not_digit_checked():
    post = merged([{"name": "family_name", "value": "Smith", "source": "handwriting"}])
    f = qm.merge_page(img(), "", [], post=post).fields[0]
    assert f.digits_verified is None and f.confidence == 0.7


def test_unknown_field_names_and_empty_values_are_dropped():
    post = merged([
        {"name": "favourite_colour", "value": "blue", "source": "print"},
        {"name": "bsb", "value": "   ", "source": "print"},
    ])
    assert qm.merge_page(img(), "x", [], post=post).fields == []


def test_merge_prompt_carries_both_readings_with_confidences():
    seen = {}

    def post(url, body, timeout):
        seen["text"] = body["messages"][0]["content"][1]["text"]
        return reply(json.dumps({"fields": []}))

    qm.merge_page(img(), "PRINTED BODY", [("John", 0.91)], post=post)
    assert "PRINTED BODY" in seen["text"] and "[0.91] John" in seen["text"]


def test_merge_transport_failure_is_qwen_unavailable():
    def post(url, body, timeout):
        raise OSError("down")

    with pytest.raises(qm.QwenUnavailable):
        qm.merge_page(img(), "x", [], post=post)

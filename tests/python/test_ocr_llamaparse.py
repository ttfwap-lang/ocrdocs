"""LlamaParse client with a fake HTTP layer: request shape, polling, cleanup, budgets, and that nothing leaks."""
import json

import pytest
from PIL import Image

import ocr_llamaparse as lp

DONE = {
    "job": {"status": "COMPLETED"},
    "markdown": {"pages": [{"page_number": 1, "markdown": "# Loan\n\nBSB: 062-000", "success": True}]},
    "items": {"pages": [{"page_number": 1, "items": [
        {"type": "text", "md": "BSB: 062-000", "value": "BSB: 062-000", "bbox": [{"x": 9.0, "y": 57.6, "w": 211.9, "h": 9.3, "confidence": 0.9}]},
        {"type": "text", "md": "no box", "bbox": []}]}]},
    "metadata": {"pages": [{"page_number": 1, "confidence": 0.972}]},
}


class FakeHttp:
    def __init__(self, polls=(DONE,), upload=(200, {"id": "pjb-1"}), fail_delete=False):
        self.polls, self.upload, self.fail_delete, self.calls = list(polls), upload, fail_delete, []

    def __call__(self, method, url, headers, body, timeout):
        self.calls.append((method, url, headers, body))
        if method == "POST":
            return self.upload
        if method == "GET":
            return 200, self.polls.pop(0)
        if self.fail_delete:
            raise OSError("boom")
        return 200, {"id": "pjb-1"}


def client(http, **kw):
    kw.setdefault("api_key", "llx-secret")
    return lp.LlamaParse(http=http, sleep=lambda s: None, **kw)


def img():
    return Image.new("RGB", (120, 60), "white")


def test_upload_sends_bearer_key_tier_and_disable_cache_and_the_png():
    h = FakeHttp()
    client(h, tier="agentic").parse_page(img())
    method, url, headers, body = h.calls[0]
    assert (method, url) == ("POST", "https://api.cloud.llamaindex.ai/api/v2/parse/upload")
    assert headers["Authorization"] == "Bearer llx-secret" and headers["Content-Type"].startswith("multipart/form-data; boundary=")
    cfg = json.loads(body.split(b'name="configuration"\r\n\r\n', 1)[1].split(b"\r\n", 1)[0])
    assert cfg == {"tier": "agentic", "version": "latest", "disable_cache": True}
    assert b"\x89PNG" in body


def test_result_is_parsed_into_text_blocks_and_page_confidence():
    page = client(FakeHttp()).parse_page(img())
    assert page.text == "# Loan\n\nBSB: 062-000" and page.confidence == 0.972
    assert page.blocks[0].bbox == (9.0, 57.6, 211.9, 9.3) and page.blocks[0].confidence == 0.9
    assert page.blocks[1].bbox is None


def test_polls_until_completed_then_deletes_the_job():
    h = FakeHttp(polls=({"job": {"status": "PENDING"}}, {"job": {"status": "RUNNING"}}, DONE))
    client(h).parse_page(img())
    assert [c[0] for c in h.calls] == ["POST", "GET", "GET", "GET", "DELETE"]
    assert h.calls[-1][1].endswith("/api/v2/parse/pjb-1")


def test_the_job_is_deleted_even_when_it_fails():
    h = FakeHttp(polls=({"job": {"status": "FAILED", "error_message": "bad file"}},))
    with pytest.raises(lp.LlamaParseUnavailable, match="failed"):
        client(h).parse_page(img())
    assert h.calls[-1][0] == "DELETE"


def test_a_failed_delete_does_not_lose_the_result():
    assert client(FakeHttp(fail_delete=True)).parse_page(img()).text.endswith("062-000")


def test_rejected_upload_is_unavailable_and_nothing_to_delete():
    h = FakeHttp(upload=(400, {"detail": "Invalid configuration"}))
    with pytest.raises(lp.LlamaParseUnavailable, match="HTTP 400"):
        client(h).parse_page(img())
    assert [c[0] for c in h.calls] == ["POST"]


def test_timeout_is_unavailable(monkeypatch):
    t = iter([0.0, 1.0, lp.JOB_TIMEOUT_SECONDS + 5])
    h = FakeHttp(polls=[{"job": {"status": "RUNNING"}}] * 5)
    c = lp.LlamaParse(api_key="k", http=h, sleep=lambda s: None, clock=lambda: next(t))
    with pytest.raises(lp.LlamaParseUnavailable, match="still RUNNING"):
        c.parse_page(img())


def test_call_budget_stops_further_uploads():
    c = client(FakeHttp(polls=(DONE, DONE)), max_calls=1)
    c.parse_page(img())
    with pytest.raises(lp.LlamaParseUnavailable, match="budget"):
        c.parse_page(img())


def test_missing_key_or_bad_settings_never_reach_the_network(monkeypatch):
    monkeypatch.delenv("LLAMA_CLOUD_API_KEY", raising=False)
    monkeypatch.setenv("OCRDOCS_LLAMAPARSE", "region")
    h = FakeHttp()
    with pytest.raises(lp.LlamaParseUnavailable, match="not set"):
        lp.LlamaParse(http=h).parse_page(img())
    with pytest.raises(lp.LlamaParseUnavailable, match="region"):
        client(h, region="ap").parse_page(img())
    with pytest.raises(lp.LlamaParseUnavailable, match="tier"):
        client(h, tier="turbo").parse_page(img())
    assert h.calls == []


def test_off_by_default_even_with_a_key_in_the_environment(monkeypatch):
    monkeypatch.setenv("LLAMA_CLOUD_API_KEY", "llx-env")
    monkeypatch.delenv("OCRDOCS_LLAMAPARSE", raising=False)
    h = FakeHttp()
    with pytest.raises(lp.LlamaParseUnavailable, match="off"):
        lp.LlamaParse(http=h).parse_page(img())
    assert h.calls == [] and lp.mode() == "off" and not lp.allows_full_pages()


def test_modes(monkeypatch):
    monkeypatch.setenv("OCRDOCS_LLAMAPARSE", "region")
    assert lp.mode() == "region" and not lp.allows_full_pages()
    monkeypatch.setenv("OCRDOCS_LLAMAPARSE", "page")
    assert lp.allows_full_pages()
    monkeypatch.setenv("OCRDOCS_LLAMAPARSE", "yes please")
    assert lp.mode() == "off"


def test_eu_region_uses_the_eu_base_url():
    h = FakeHttp()
    client(h, region="eu").parse_page(img())
    assert h.calls[0][1].startswith("https://api.cloud.eu.llamaindex.ai/")


def test_network_errors_never_leak_the_key():
    def boom(*a):
        raise OSError("connection reset for Bearer llx-secret")

    with pytest.raises(lp.LlamaParseUnavailable) as e:
        client(boom).parse_page(img())
    assert "llx-secret" not in str(e.value)

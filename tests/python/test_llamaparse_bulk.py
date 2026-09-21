"""The bulk script and the Australian-endpoint setting: it cannot send unless an AU endpoint is configured and confirmed."""
import json
from pathlib import Path

import pytest

import llamaparse_bulk as bulk
import ocr_llamacloud as llc
import ocr_llamaparse as lp

AU = "https://api.syd.example-llamaindex.au"


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for k in ("OCRDOCS_LLAMAPARSE_BASE_URL", "LLAMA_CLOUD_API_KEY", "OCRDOCS_LLAMAPARSE"):
        monkeypatch.delenv(k, raising=False)


def configure(monkeypatch, url=AU):
    monkeypatch.setenv("OCRDOCS_LLAMAPARSE_BASE_URL", url)
    monkeypatch.setenv("LLAMA_CLOUD_API_KEY", "llx-test")


class FakeCloud:
    def __init__(self, fail=()):
        self.calls, self.fail = [], set(fail)

    def analyze(self, data, name):
        self.calls.append(name)
        if name in self.fail:
            raise lp.LlamaParseUnavailable("upload rejected (HTTP 500)")
        return llc.CloudResult(document_type="loan_application", type_confidence=0.9, page_texts=["p1"], credits=5.0,
                               fields=[{"name": "given_names", "value": "Jane", "subject": "applicant"}])


def make_files(tmp_path, names=("a.pdf", "b.png", "c.jpg", "notes.txt", "d.docx")):
    out = []
    for n in names:
        p = tmp_path / n
        p.write_bytes(b"x")
        out.append(str(p))
    return out


# ---- the endpoint setting -------------------------------------------------------------------------------------------
def test_au_region_needs_a_configured_https_endpoint(monkeypatch):
    with pytest.raises(lp.LlamaParseUnavailable, match="OCRDOCS_LLAMAPARSE_BASE_URL"):
        lp.base_url("au")
    monkeypatch.setenv("OCRDOCS_LLAMAPARSE_BASE_URL", "http://insecure.example.au")
    with pytest.raises(lp.LlamaParseUnavailable, match="https"):
        lp.base_url("au")
    configure(monkeypatch, AU + "/")
    assert lp.base_url("au") == AU


@pytest.mark.parametrize("url", ["https://api.cloud.llamaindex.ai", "https://api.cloud.eu.llamaindex.ai/", "https://CLOUD.llamaindex.ai"])
def test_au_can_never_be_pointed_at_the_public_north_america_or_europe_hosts(monkeypatch, url):
    monkeypatch.setenv("OCRDOCS_LLAMAPARSE_BASE_URL", url)
    with pytest.raises(lp.LlamaParseUnavailable, match="public North America/Europe host"):
        lp.base_url("au")


def test_the_client_uses_the_configured_australian_endpoint_for_every_call(monkeypatch):
    configure(monkeypatch)
    seen = []

    def http(method, url, headers, body, timeout):
        seen.append(url)
        if method == "POST":
            return 200, {"id": "pjb-1"}
        if method == "GET":
            return 200, {"job": {"status": "COMPLETED"}, "markdown": {"pages": []}}
        return 200, {}

    from PIL import Image
    lp.LlamaParse(api_key="k", region="au", http=http, sleep=lambda s: None).parse_page(Image.new("RGB", (10, 10)))
    assert seen and all(u.startswith(AU + "/api/v2/parse") for u in seen)


def test_an_unconfigured_au_client_stops_before_uploading_anything(monkeypatch):
    calls = []
    c = lp.LlamaParse(api_key="k", region="au", http=lambda *a: calls.append(a) or (200, {}), sleep=lambda s: None)
    from PIL import Image
    with pytest.raises(lp.LlamaParseUnavailable, match="OCRDOCS_LLAMAPARSE_BASE_URL"):
        c.parse_page(Image.new("RGB", (10, 10)))
    with pytest.raises(lp.LlamaParseUnavailable, match="OCRDOCS_LLAMAPARSE_BASE_URL"):
        llc.LlamaCloud(c).analyze(b"x", "a.png")
    assert calls == []


# ---- collecting and running ------------------------------------------------------------------------------------------------
def test_collect_keeps_supported_existing_files_once(tmp_path):
    files = make_files(tmp_path)
    lst = tmp_path / "list.txt"
    lst.write_text("\n".join(['"' + files[0] + '"', files[0], files[3], str(tmp_path / "missing.pdf"), files[1]]), encoding="utf-8")
    assert bulk.collect(str(lst), None) == [files[0], files[1]]
    assert sorted(Path(p).name for p in bulk.collect(None, str(tmp_path))) == ["a.pdf", "b.png", "c.jpg", "d.docx"]


def test_run_writes_one_record_per_file_and_resumes_without_resending(tmp_path):
    files = bulk.collect(None, str(make_files(tmp_path) and tmp_path))
    out = str(tmp_path / "out.jsonl")
    cloud = FakeCloud()
    counts = bulk.run(files, out, cloud, workers=2, max_files=2, log=lambda m: None)
    assert counts["ok"] == 2 and len(cloud.calls) == 2 and counts["credits"] == 10
    counts = bulk.run(files, out, cloud, workers=2, max_files=10, log=lambda m: None)
    assert counts["ok"] == 2 and counts["skipped_already_done"] == 2 and len(cloud.calls) == 4     # only the other two were sent
    recs = [json.loads(l) for l in open(out)]
    assert len(recs) == 4 and all(r["ok"] and r["document_type"] == "loan_application" and r["fields"] for r in recs)


def test_a_failed_file_is_recorded_and_retried_next_run_without_stopping_the_others(tmp_path):
    make_files(tmp_path)
    files = bulk.collect(None, str(tmp_path))
    out = str(tmp_path / "out.jsonl")
    bad = files[1]
    counts = bulk.run(files, out, FakeCloud(fail={Path(bad).name}), max_files=10, log=lambda m: None)
    assert counts["ok"] == 3 and counts["failed"] == 1
    failed = [json.loads(l) for l in open(out) if not json.loads(l)["ok"]]
    assert failed[0]["file"] == bad and "HTTP 500" in failed[0]["error"]
    retry = FakeCloud()
    bulk.run(files, out, retry, max_files=10, log=lambda m: None)
    assert retry.calls == [Path(bad).name]


def test_max_files_caps_a_run(tmp_path):
    make_files(tmp_path)
    cloud = FakeCloud()
    bulk.run(bulk.collect(None, str(tmp_path)), str(tmp_path / "o.jsonl"), cloud, max_files=1, log=lambda m: None)
    assert len(cloud.calls) == 1


# ---- the command line: nothing is sent without every guard ---------------------------------------------------------------
def factory_that_must_not_be_used(n):
    raise AssertionError("a cloud client was created; nothing should have been sent")


def test_dry_run_sends_nothing_and_needs_no_endpoint(tmp_path, capsys):
    make_files(tmp_path)
    rc = bulk.main(["--folder", str(tmp_path), "--out", str(tmp_path / "o.jsonl")], factory_that_must_not_be_used)
    text = capsys.readouterr().out
    assert rc == 0 and "DRY RUN" in text and "4 supported files found" in text and not (tmp_path / "o.jsonl").exists()


def test_run_stops_when_no_australian_endpoint_is_configured(tmp_path):
    make_files(tmp_path)
    with pytest.raises(SystemExit, match="STOPPED, nothing sent.*OCRDOCS_LLAMAPARSE_BASE_URL"):
        bulk.main(["--folder", str(tmp_path), "--out", str(tmp_path / "o.jsonl"), "--run", "--endpoint-host", "x"], factory_that_must_not_be_used)


def test_run_stops_at_a_public_northamerica_or_europe_url(tmp_path, monkeypatch):
    configure(monkeypatch, "https://api.cloud.llamaindex.ai")
    make_files(tmp_path)
    with pytest.raises(SystemExit, match="public North America/Europe host"):
        bulk.main(["--folder", str(tmp_path), "--out", str(tmp_path / "o.jsonl"), "--run", "--endpoint-host", "api.cloud.llamaindex.ai"], factory_that_must_not_be_used)


def test_run_needs_the_endpoint_host_typed_to_confirm(tmp_path, monkeypatch):
    configure(monkeypatch)
    make_files(tmp_path)
    for host in (None, "wrong.example.com"):
        args = ["--folder", str(tmp_path), "--out", str(tmp_path / "o.jsonl"), "--run"] + (["--endpoint-host", host] if host else [])
        with pytest.raises(SystemExit, match="--endpoint-host api.syd.example-llamaindex.au"):
            bulk.main(args, factory_that_must_not_be_used)


def test_run_needs_the_api_key(tmp_path, monkeypatch):
    monkeypatch.setenv("OCRDOCS_LLAMAPARSE_BASE_URL", AU)
    make_files(tmp_path)
    with pytest.raises(SystemExit, match="LLAMA_CLOUD_API_KEY"):
        bulk.main(["--folder", str(tmp_path), "--out", str(tmp_path / "o.jsonl"), "--run", "--endpoint-host", "api.syd.example-llamaindex.au"], factory_that_must_not_be_used)


def test_a_fully_configured_run_sends_and_reports(tmp_path, monkeypatch, capsys):
    configure(monkeypatch)
    make_files(tmp_path)
    cloud = FakeCloud()
    rc = bulk.main(["--folder", str(tmp_path), "--out", str(tmp_path / "o.jsonl"), "--run", "--endpoint-host", "API.syd.example-llamaindex.au",
                    "--max-files", "3"], lambda n: cloud)
    assert rc == 0 and len(cloud.calls) == 3 and "finished: ok 3, failed 0, credits used 15" in capsys.readouterr().out


def test_check_sends_only_an_invented_page_and_still_needs_the_guards(tmp_path, monkeypatch, capsys):
    with pytest.raises(SystemExit, match="STOPPED"):
        bulk.main(["--check", "--endpoint-host", "x"], factory_that_must_not_be_used)
    configure(monkeypatch)
    sent = []

    class C:
        def analyze(self, data, name):
            sent.append((name, data[:4]))
            return llc.CloudResult(document_type="loan_application", type_confidence=0.9,
                                   fields=[{"name": "given_names", "value": "Jane", "subject": "applicant"}], credits=5.0)

    assert bulk.main(["--check", "--endpoint-host", "api.syd.example-llamaindex.au"], lambda n: C()) == 0
    assert sent == [("invented_test_page.png", b"\x89PNG")]
    assert "Jane" in capsys.readouterr().out

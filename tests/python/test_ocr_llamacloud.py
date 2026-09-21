"""LlamaCloud analysis with a fake service shaped like the real one (endpoints and payloads observed live on synthetic pages)."""
import json

import pytest

import ocr_llamacloud as lc
import ocr_llamaparse as lp

PARSE_DONE = {"job": {"status": "COMPLETED"}, "markdown": {"pages": [{"page_number": 1, "success": True, "markdown": (
    "Given names: Jane Family name: Testerson BSB: 062-000 Account number: 12345678 "
    "Parents details: John and Mary Job title: boilermaker, nurse")}]}}
EXTRACT_RESULT = {
    "applicant": {"given_names": "Jane", "family_name": "Testerson", "bsb": "062-000", "account_number": "99887766",
                  "drivers_licence": None, "occupation_industry": "  "},
    "other_people": [
        {"relationship": "parent", "section": "Parents details", "given_names": "John", "occupation_industry": "boilermaker"},
        {"relationship": "parent", "section": "Parents details", "given_names": "Mary", "occupation_industry": "nurse"},
        {"relationship": "cousin", "given_names": "Zed"},
    ],
}
EXTRACT_META = {"field_metadata": {"document_metadata": {
    "applicant": {"given_names": {"confidence": 0.95, "citation": [{"page": 1, "matching_text": "Jane"}]},
                  "bsb": {"confidence": 0.9, "citation": [{"page": 1, "matching_text": "062-000"}]}},
    "other_people": [{"given_names": {"confidence": 0.88, "citation": [{"page": 1, "matching_text": "John"}]}}],
}}}


class Service:
    """Fake LlamaCloud: records every call, serves canned results, lets tests break individual stages."""
    def __init__(self, classify=(200, None), extract=(200, None), parse_status="COMPLETED"):
        self.calls, self.classify_resp, self.extract_resp, self.parse_status = [], classify, extract, parse_status

    def __call__(self, method, url, headers, body, timeout):
        path = url.split("llamaindex.ai", 1)[1]
        self.calls.append((method, path, body))
        if method == "DELETE":
            return 200, {"id": "x"}
        if (method, path) == ("POST", "/api/v2/parse/upload"):
            return 200, {"id": "pjb-1", "project_id": "proj-1"}
        if method == "GET" and path.startswith("/api/v2/parse/pjb-1"):
            return 200, ({**PARSE_DONE, "job": {"status": self.parse_status, "error_message": "bad"}})
        if method == "POST" and path.startswith("/api/v2/classify"):
            return self.classify_resp if self.classify_resp[0] >= 300 else (200, {"id": "clj-1"})
        if method == "GET" and path.startswith("/api/v2/classify/clj-1"):
            return 200, {"status": "COMPLETED", "result": {"type": "loan_application", "confidence": 0.93, "reasoning": "home loan form"}}
        if method == "POST" and path.startswith("/api/v2/extract"):
            return self.extract_resp if self.extract_resp[0] >= 300 else (200, {"id": "ext-1"})
        if method == "GET" and path.startswith("/api/v2/extract/ext-1"):
            return 200, {"status": "COMPLETED", "extract_result": EXTRACT_RESULT, "extract_metadata": EXTRACT_META, "usage": {"credits": 8.0}}
        raise AssertionError(f"unexpected call {method} {path}")

    def paths(self, method):
        return [p for m, p, _ in self.calls if m == method]


def cloud(service, **kw):
    kw.setdefault("api_key", "llx-test")
    return lc.LlamaCloud(lp.LlamaParse(http=service, sleep=lambda s: None, **kw))


def f(name, value, **o):
    d = dict(name=name, value=value, source="print", confidence=0.8, digits_verified=None, evidence="", subject="applicant",
             section="", entry=1, imageIndex=0)
    d.update(o)
    return d


# ---- result conversion --------------------------------------------------------------------------------------------------
def test_extract_result_becomes_owner_aware_fields_with_confidence_evidence_and_page():
    fields = lc.extract_to_fields(EXTRACT_RESULT, EXTRACT_META, "Jane Testerson 062-000 12345678")
    by = {(x["name"], x["subject"], x["entry"]): x for x in fields}
    jane = by[("given_names", "applicant", 1)]
    assert (jane["value"], jane["confidence"], jane["evidence"], jane["imageIndex"], jane["origin"]) == ("Jane", 0.95, "Jane", 0, "llamaparse")
    assert by[("given_names", "parent", 1)]["value"] == "John" and by[("given_names", "parent", 2)]["value"] == "Mary"
    assert by[("occupation", "parent", 1)]["value"] == "boilermaker" and by[("occupation", "parent", 2)]["value"] == "nurse"
    assert by[("given_names", "parent", 1)]["section"] == "Parents details"


def test_null_and_blank_values_are_dropped_and_unknown_relationships_become_other():
    fields = lc.extract_to_fields(EXTRACT_RESULT, EXTRACT_META, "")
    names = [(x["name"], x["subject"]) for x in fields]
    assert ("drivers_licence_number", "applicant") not in names and ("occupation", "applicant") not in names
    assert ("given_names", "other") in names


def test_catalogue_ids_are_renamed_into_the_worker_name_space():
    fields = lc.extract_to_fields({"applicant": {"drivers_licence": "12345678", "occupation_industry": "welder"}, "other_people": []}, {}, "12345678")
    assert sorted(x["name"] for x in fields) == ["drivers_licence_number", "occupation"]


def test_digits_the_parse_never_saw_are_unverified_and_capped():
    fields = lc.extract_to_fields(EXTRACT_RESULT, EXTRACT_META, "Jane Testerson 062-000")     # parse text lacks 99887766
    acct = next(x for x in fields if x["name"] == "account_number")
    assert acct["digits_verified"] is False and acct["confidence"] <= 0.35
    bsb = next(x for x in fields if x["name"] == "bsb")
    assert bsb["digits_verified"] is True


def test_missing_metadata_falls_back_to_a_default_confidence():
    [x] = lc.extract_to_fields({"applicant": {"given_names": "Jane"}, "other_people": []}, None, "")
    assert x["confidence"] == lc.DEFAULT_CONFIDENCE and x["evidence"] == ""


def test_garbage_extract_output_gives_no_fields():
    assert lc.extract_to_fields(None, None, "") == [] and lc.extract_to_fields("x", {}, "") == []


# ---- reconciling with the local Qwen fields ------------------------------------------------------------------------------
def cf(name, value, **o):
    return f(name, value, **{"origin": "llamaparse", "confidence": 0.9, **o})


def test_agreement_raises_confidence_and_settles_an_unstated_owner():
    [m] = lc.reconcile_fields([f("family_name", "TESTERSON", subject="unknown", confidence=0.7)], [cf("family_name", "Testerson")])
    assert m["origin"] == "both" and m["subject"] == "applicant" and m["confidence"] == pytest.approx(0.95)


def test_disagreement_keeps_the_more_confident_value_at_reduced_confidence_and_records_the_other():
    [m] = lc.reconcile_fields([f("bsb", "062-999", confidence=0.7)], [cf("bsb", "062-000")])
    assert m["value"] == "062-000" and m["alternateValue"] == "062-999" and m["alternateSource"] == "qwen" and m["confidence"] <= 0.6
    [m] = lc.reconcile_fields([f("bsb", "062-999", confidence=0.95)], [cf("bsb", "062-000", confidence=0.6)])
    assert m["value"] == "062-999" and m["alternateValue"] == "062-000" and m["alternateSource"] == "llamaparse"


def test_a_value_whose_digits_nobody_read_loses_even_when_more_confident():
    [m] = lc.reconcile_fields([f("account_number", "11112222", confidence=0.99, digits_verified=False)], [cf("account_number", "33334444", confidence=0.6, digits_verified=True)])
    assert m["value"] == "33334444" and m["alternateValue"] == "11112222"


def test_fields_only_one_source_found_are_all_kept_in_order_with_their_origin():
    out = lc.reconcile_fields([f("given_names", "Jane")], [cf("bsb", "062-000")])
    assert [(x["name"], x["origin"]) for x in out] == [("given_names", "qwen"), ("bsb", "llamaparse")]


def test_parent_and_applicant_values_never_merge_even_with_the_same_name():
    out = lc.reconcile_fields([f("given_names", "John")], [cf("given_names", "John", subject="parent")])
    assert len(out) == 2 and {x["subject"] for x in out} == {"applicant", "parent"}


def test_pick_document_type_prefers_a_confident_cloud_classification_and_reports_disagreement():
    r = lc.CloudResult(document_type="payslip", type_confidence=0.9)
    assert lc.pick_document_type("loan_application", r) == ("payslip", "loan_application")
    assert lc.pick_document_type("payslip", r) == ("payslip", None)
    assert lc.pick_document_type("other", r) == ("payslip", None)
    assert lc.pick_document_type("loan_application", lc.CloudResult(document_type="payslip", type_confidence=0.3)) == ("loan_application", None)
    assert lc.pick_document_type("payslip", None) == ("payslip", None)


# ---- the API flow --------------------------------------------------------------------------------------------------------
def test_analyze_uploads_once_then_classifies_and_extracts_from_the_same_parse_job_and_deletes_everything():
    s = Service()
    res = cloud(s).analyze(b"%PDF-fake", "loan form.pdf")
    posts = s.paths("POST")
    assert posts[0] == "/api/v2/parse/upload" and sorted(posts[1:]) == ["/api/v2/classify?project_id=proj-1", "/api/v2/extract?project_id=proj-1"]
    for _, path, body in s.calls:
        if path.startswith(("/api/v2/classify?", "/api/v2/extract?")):
            assert json.loads(body)["file_input"] == "pjb-1"
    assert sorted(s.paths("DELETE")) == sorted(["/api/v2/parse/pjb-1", "/api/v2/classify/clj-1?project_id=proj-1", "/api/v2/extract/ext-1?project_id=proj-1"])
    assert (res.document_type, res.type_confidence, res.credits, res.errors) == ("loan_application", 0.93, 8.0, [])
    assert res.page_texts and any(x["subject"] == "parent" for x in res.fields)


def test_requests_carry_the_generated_schema_the_custom_rules_and_no_cache():
    s = Service()
    cloud(s).analyze(b"x", "a.png")
    upload = next(b for m, p, b in s.calls if p == "/api/v2/parse/upload")
    assert json.loads(upload.split(b'name="configuration"\r\n\r\n', 1)[1].split(b"\r\n", 1)[0])["disable_cache"] is True
    extract = json.loads(next(b for m, p, b in s.calls if m == "POST" and p.startswith("/api/v2/extract")))["configuration"]
    schema = lc.load_schema()
    assert extract["data_schema"] == schema["data_schema"] and extract["system_prompt"] == schema["system_prompt"]
    assert (extract["tier"], extract["extraction_target"], extract["cite_sources"], extract["confidence_scores"]) == (lc.EXTRACT_TIER, "per_doc", True, True)
    classify = json.loads(next(b for m, p, b in s.calls if m == "POST" and p.startswith("/api/v2/classify")))["configuration"]
    assert classify["rules"] == lc.load_rules()


def test_a_failed_classify_does_not_lose_the_extraction_and_vice_versa():
    res = cloud(Service(classify=(400, {"detail": "bad rules"}))).analyze(b"x", "a.png")
    assert res.document_type is None and res.fields and res.errors[0].startswith("classify:")
    res = cloud(Service(extract=(400, {"detail": "bad schema"}))).analyze(b"x", "a.png")
    assert res.fields == [] and res.document_type == "loan_application" and res.errors[0].startswith("extract:")


def test_a_failed_parse_raises_and_still_deletes_the_parse_job():
    s = Service(parse_status="FAILED")
    with pytest.raises(lp.LlamaParseUnavailable, match="failed"):
        cloud(s).analyze(b"x", "a.png")
    assert s.paths("DELETE") == ["/api/v2/parse/pjb-1"] and s.paths("POST") == ["/api/v2/parse/upload"]


def test_unsupported_files_and_a_wrong_mode_never_reach_the_network(monkeypatch):
    s = Service()
    with pytest.raises(lp.LlamaParseUnavailable, match="not sent"):
        cloud(s).analyze(b"x", "notes.txt")
    monkeypatch.delenv("OCRDOCS_LLAMAPARSE", raising=False)
    with pytest.raises(lp.LlamaParseUnavailable, match="not 'full'"):
        lc.LlamaCloud(lp.LlamaParse(http=s)).analyze(b"x", "a.png")
    assert s.calls == []


def test_the_shared_call_budget_applies_to_whole_files():
    c = cloud(Service(), max_calls=1)
    c.analyze(b"x", "a.png")
    with pytest.raises(lp.LlamaParseUnavailable, match="budget"):
        c.analyze(b"x", "b.png")


def test_hostile_filenames_cannot_break_the_multipart_header():
    s = Service()
    cloud(s).analyze(b"x", 'a"; name="evil\r\nX: y.png')
    upload = next(b for m, p, b in s.calls if p == "/api/v2/parse/upload")
    assert b"\r\nX: y" not in upload and b'name="evil' not in upload


def test_enabled_only_in_full_mode(monkeypatch):
    for value, expected in (("full", True), ("page", False), ("region", False), ("off", False)):
        monkeypatch.setenv("OCRDOCS_LLAMAPARSE", value)
        assert lc.enabled() is expected

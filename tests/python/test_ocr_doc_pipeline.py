"""Document pipeline stages wired together with fakes: gates, clearing, second reader, agent verdicts."""
import re
from types import SimpleNamespace

import pytest
from PIL import Image

import ocr_agent_verify as av
import ocr_doc_pipeline as dp
import ocr_gates as g
import ocr_qwen_merge as qm

PATTERNS = {"given_names": re.compile(r"given[\s_-]?names?", re.I)}


def im(w=200, h=100):
    return Image.new("RGB", (w, h), "white")


def field(name, value, **o):
    d = dict(name=name, value=value, source="print", confidence=0.85, digits_verified=None, evidence="",
             subject="applicant", section="", entry=1)
    d.update(o)
    return qm.MergedField(**d)


def page(kind="printed", fields=(), doc="loan_application", text="page text", paddle="paddle text", degraded=False):
    return {"kind": kind, "text": text, "paddle_text": paddle, "engines": ["PaddleOCR-VL"], "line_confs": {text: 0.9},
            "fields": list(fields), "degraded": degraded, "document_type": doc}


def deps(**kw):
    base = dict(classify=lambda i: ("printed", False), read_page=lambda i, k: page(k))
    base.update(kw)
    return dp.Deps(**base)


GOOD_PROBE = g.Probe("general notice about terms " * 6, 0.9, 120)
COMPLETE = [field("given_names", "John"), field("family_name", "Smith"), field("date_of_birth", "12/04/1985")]


def codes(doc):
    return [f["code"] for f in doc["flags"]]


def test_clean_document_without_gates_is_read_and_has_no_flags():
    doc = dp.run_document([im()], deps(read_page=lambda i, k: page(k, COMPLETE)))
    assert not doc["cleared"] and doc["flags"] == [] and doc["document_type"] == "loan_application"
    assert [f["name"] for f in doc["fields"]] == ["given_names", "family_name", "date_of_birth"]
    assert all(f["imageIndex"] == 0 for f in doc["fields"])


def test_s2_clears_a_plain_printed_file_without_calling_any_reader():
    calls = []
    d = deps(probe=lambda i: GOOD_PROBE, label_patterns=PATTERNS, read_page=lambda i, k: calls.append(k) or page(k))
    doc = dp.run_document([im(), im()], d)
    assert doc["cleared"] and calls == [] and doc["fields"] == []
    assert doc["pages"][0]["cleared"] and "zero catalogue matches" in doc["cleared_reason"]
    assert "general notice" in doc["text"]  # the probe text is kept, not discarded


def test_audit_sample_reads_a_file_that_would_have_been_cleared_and_says_so():
    doc = dp.run_document([im()], deps(probe=lambda i: GOOD_PROBE, label_patterns=PATTERNS), audit_sample=True)
    assert not doc["cleared"] and doc["audit_sampled"] and "would have been cleared" in doc["cleared_reason"]
    assert "PaddleOCR-VL" in doc["engines"]


def test_a_label_match_handwriting_or_a_failed_probe_never_clears():
    matching = g.Probe("Given names John " * 10, 0.9, 150)
    assert not dp.run_document([im()], deps(probe=lambda i: matching, label_patterns=PATTERNS))["cleared"]
    both = deps(probe=lambda i: GOOD_PROBE, label_patterns=PATTERNS, classify=lambda i: ("both", False))
    assert not dp.run_document([im()], both)["cleared"]

    def boom(i):
        raise RuntimeError("tesseract missing")

    assert not dp.run_document([im()], deps(probe=boom, label_patterns=PATTERNS))["cleared"]


def test_orientation_from_the_probe_rotates_the_page_before_it_is_classified_and_read():
    seen = []
    d = deps(probe=lambda i: g.Probe("Given names " * 20, 0.9, 200, rotation=90), label_patterns=PATTERNS,
             classify=lambda i: seen.append(("classify", i.size)) or ("printed", False),
             read_page=lambda i, k: seen.append(("read", i.size)) or page(k))
    doc = dp.run_document([im(200, 100)], d)
    assert seen == [("classify", (100, 200)), ("read", (100, 200))] and doc["rotations"] == [90]


def test_classifier_degradation_is_carried_onto_the_page_and_flagged():
    doc = dp.run_document([im()], deps(classify=lambda i: ("both", True)))
    assert doc["pages"][0]["degraded"] and "PAGE_DEGRADED" in codes(doc)


def test_second_reader_runs_only_on_flagged_printed_pages_and_disagreement_becomes_a_flag():
    reads = []
    d = deps(read_page=lambda i, k: page(k, [field("account_number", "12345670", digits_verified=False)], paddle="Account 1234 5670"),
             second_reader=lambda i: reads.append(1) or "Account 1234 5678")
    doc = dp.run_document([im()], d)
    assert reads == [1] and "Chandra" in doc["pages"][0]["engines"]
    assert "READERS_DISAGREE" in codes(doc)
    assert "[Chandra]" in doc["page_texts"][0]


def test_no_flags_means_the_second_reader_and_agent_never_run():
    called = []
    d = deps(read_page=lambda i, k: page(k, COMPLETE),
             second_reader=lambda i: called.append("second") or "",
             agent=SimpleNamespace(verify_file=lambda *a: called.append("agent") or []))
    dp.run_document([im()], d)
    assert called == []


def test_second_reader_outage_is_not_a_flag_and_not_a_crash():
    def boom(i):
        raise OSError("chandra down")

    d = deps(read_page=lambda i, k: page(k, [field("account_number", "12345670", digits_verified=False)]), second_reader=boom)
    doc = dp.run_document([im()], d)
    assert "READERS_DISAGREE" not in codes(doc) and "DIGITS_NOT_READ" in codes(doc)


class FakeAgent:
    def __init__(self, verdicts=None, boom=False):
        self.verdicts, self.boom, self.got = verdicts or [], boom, None

    def verify_file(self, pages, flags):
        self.got = (pages, flags)
        if self.boom:
            raise RuntimeError("model down")
        return self.verdicts


def test_agent_verdicts_are_applied_to_the_matching_page_and_field():
    v = [av.Verdict(1, "account_number", "corrected", "12345678", [0, 0, 10, 10], "chandra read it"),
         av.Verdict(1, "family_name", "confirmed", "Lee", None, "clear"),
         av.Verdict(0, "DOC_TYPE_UNSURE", "unresolved", "", None, "file level")]
    agent = FakeAgent(v)
    fields = [field("account_number", "12345670", digits_verified=False), field("family_name", "Lee", confidence=0.7)]
    doc = dp.run_document([im()], deps(read_page=lambda i, k: page(k, fields, doc="payslip"), agent=agent))
    acct = next(f for f in doc["fields"] if f["name"] == "account_number")
    assert (acct["value"], acct["originalValue"], acct["agent"]) == ("12345678", "12345670", "corrected")
    lee = next(f for f in doc["fields"] if f["name"] == "family_name")
    assert lee["agent"] == "confirmed" and lee["confidence"] >= dp.CONFIRMED_MIN_CONF
    assert len(doc["verdicts"]) == 3 and agent.got is not None


def test_agent_failure_leaves_the_flags_for_a_human():
    d = deps(read_page=lambda i, k: page(k, [field("account_number", "12345670", digits_verified=False)]), agent=FakeAgent(boom=True))
    doc = dp.run_document([im()], d)
    assert doc["verdicts"] == [] and "DIGITS_NOT_READ" in codes(doc)


@pytest.mark.parametrize("types,expected", [
    ([], "other"),
    (["other", "other"], "other"),
    (["payslip", "payslip", "other"], "payslip"),
    (["other", "payslip"], "payslip"),
    (["loan_application", "payslip"], "mixed"),
    (["loan_application", "loan_application", "payslip"], "loan_application"),
])
def test_majority_document_type(types, expected):
    assert dp.majority_document_type(types) == expected


# ---- LlamaCloud analysis joined into the document ---------------------------------------------------------------------
import ocr_llamacloud as llc


def cloud_result(fields=(), doc="loan_application", conf=0.93, texts=("cloud page text",)):
    return llc.CloudResult(document_type=doc, type_confidence=conf, type_reasoning="why", fields=list(fields),
                           page_texts=list(texts), credits=8.0)


def cfield(name, value, **o):
    d = dict(name=name, value=value, source="print", confidence=0.9, digits_verified=None, evidence="", subject="applicant",
             section="", entry=1, imageIndex=0, origin="llamaparse")
    d.update(o)
    return d


def test_cloud_fields_are_reconciled_with_the_local_ones_and_agreement_needs_no_flag():
    d = deps(read_page=lambda i, k: page(k, COMPLETE), cloud=lambda: cloud_result([cfield("given_names", "John"), cfield("bsb", "062-000")]))
    doc = dp.run_document([im()], d)
    by = {f["name"]: f for f in doc["fields"]}
    assert by["given_names"]["origin"] == "both" and by["bsb"]["origin"] == "llamaparse"
    assert doc["flags"] == [] and "LlamaParse" in doc["engines"]
    assert doc["cloud"] == {"documentType": "loan_application", "typeConfidence": 0.93, "typeReasoning": "why", "credits": 8.0, "errors": [], "fieldCount": 2}
    assert "[LlamaParse]\ncloud page text" in doc["text"]


def test_a_disagreement_between_the_sources_is_flagged_for_the_agent():
    d = deps(read_page=lambda i, k: page(k, COMPLETE), cloud=lambda: cloud_result([cfield("family_name", "Smyth", confidence=0.95)]))
    doc = dp.run_document([im()], d)
    fam = next(f for f in doc["fields"] if f["name"] == "family_name")
    assert fam["value"] == "Smyth" and fam["alternateValue"] == "Smith" and fam["confidence"] <= 0.6
    assert "SOURCES_DISAGREE" in codes(doc)


def test_the_custom_cloud_classifier_leads_the_document_type_and_a_dispute_is_flagged():
    d = deps(read_page=lambda i, k: page(k, COMPLETE, doc="loan_application"), cloud=lambda: cloud_result(doc="payslip"))
    doc = dp.run_document([im()], d)
    assert doc["document_type"] == "payslip" and "DOC_TYPE_DISAGREE" in codes(doc)


def test_an_unreachable_cloud_leaves_the_local_result_intact():
    def boom():
        raise TimeoutError("cloud too slow")

    doc = dp.run_document([im()], deps(read_page=lambda i, k: page(k, COMPLETE), cloud=boom))
    assert doc["cloud"] is None and "LlamaParse" not in doc["engines"] and doc["flags"] == []


def test_the_cloud_can_analyse_a_file_that_has_no_local_pages():
    doc = dp.run_document([], deps(cloud=lambda: cloud_result([cfield("given_names", "Jane"), cfield("family_name", "Test"), cfield("date_of_birth", "1/1/1990")])))
    assert [f["name"] for f in doc["fields"]] == ["given_names", "family_name", "date_of_birth"] and doc["pages"] == []
    assert doc["document_type"] == "loan_application"


def test_agent_only_offers_the_readers_that_exist():
    v = av.AgentVerifier(lambda m, t: {}, {"trocr": lambda i: "", "llamaparse": lambda i: ""})
    assert v.tools[0]["function"]["parameters"]["properties"]["reader"]["enum"] == ["trocr", "llamaparse"]
    assert av.TOOLS[0]["function"]["parameters"]["properties"]["reader"]["enum"] == ["trocr", "paddle", "chandra"]

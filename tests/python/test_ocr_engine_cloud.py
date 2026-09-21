"""Engine wiring for LlamaParse/LlamaCloud. Skipped until apply_llamacloud_engine.py has been run on the engine."""
import pytest
from PIL import Image

import ocr_hybrid
import ocr_llamacloud as llc
import ocr_paddle_vl
import ocr_qwen_merge as qm
import ocr_spark_engine as engine

pytestmark = pytest.mark.skipif(not hasattr(engine, "_analyze_in_cloud"), reason="engine not yet wired to LlamaCloud (apply_llamacloud_engine.py)")


def cfield(name, value, **o):
    d = dict(name=name, value=value, source="print", confidence=0.9, digits_verified=None, evidence="", subject="applicant",
             section="", entry=1, imageIndex=0, origin="llamaparse")
    d.update(o)
    return d


@pytest.fixture
def local_stack(monkeypatch):
    """Healthy local fakes (same as the vlm_v2 engine tests) so only the cloud behaviour varies."""
    monkeypatch.setattr(qm, "classify_page", lambda img, **k: "printed")
    monkeypatch.setattr(ocr_paddle_vl, "read_page", lambda img, **k: "Given names John")
    monkeypatch.setattr(ocr_hybrid, "recognize_page", lambda img, reader, **k: [])
    monkeypatch.setattr(qm, "merge_page", lambda img, p, l, **k: qm.MergeResult(
        [qm.MergedField("given_names", "John", "print", 0.8, None, "", "applicant", "", 1),
         qm.MergedField("family_name", "Smith", "print", 0.8, None, "", "applicant", "", 1)], "loan_application"))
    monkeypatch.setattr(engine, "PIPELINE_MODE", "vlm_v2")
    return monkeypatch


def png(tmp_path, name="scan.png"):
    f = tmp_path / name
    Image.new("RGB", (300, 200), "white").save(f)
    return f


def test_nothing_is_sent_to_the_cloud_unless_full_mode_is_on(local_stack, tmp_path, monkeypatch):
    monkeypatch.delenv("OCRDOCS_LLAMAPARSE", raising=False)
    sent = []
    monkeypatch.setattr(engine, "_analyze_in_cloud", lambda path: sent.append(path) or llc.CloudResult())
    _, _, result = engine.process_single_file_for_pass((str(png(tmp_path)), 1))
    assert sent == [] and result["cloud"] is None


@pytest.mark.parametrize("mode", ["region", "page"])
def test_region_and_page_modes_do_not_upload_whole_files(local_stack, tmp_path, monkeypatch, mode):
    monkeypatch.setenv("OCRDOCS_LLAMAPARSE", mode)
    sent = []
    monkeypatch.setattr(engine, "_analyze_in_cloud", lambda path: sent.append(path) or llc.CloudResult())
    engine.process_single_file_for_pass((str(png(tmp_path)), 1))
    assert sent == []


def test_full_mode_analyses_the_original_file_and_merges_the_cloud_fields(local_stack, tmp_path, monkeypatch):
    monkeypatch.setenv("OCRDOCS_LLAMAPARSE", "full")
    sent = []
    cloud = llc.CloudResult(document_type="loan_application", type_confidence=0.9, credits=8.0, page_texts=["cloud text"],
                            fields=[cfield("given_names", "John"), cfield("date_of_birth", "12/04/1985"),
                                    cfield("given_names", "Mary", subject="parent", entry=2, section="Parents details")])
    monkeypatch.setattr(engine, "_analyze_in_cloud", lambda path: sent.append(path.name) or cloud)
    f = png(tmp_path)
    status, _, result = engine.process_single_file_for_pass((str(f), 1))
    assert status == "SUCCESS" and sent == [f.name]
    by = {(x["name"], x["subject"], x["entry"]): x for x in result["vlm_fields"]}
    assert by[("given_names", "applicant", 1)]["origin"] == "both"            # Qwen and the cloud agree on John
    assert by[("date_of_birth", "applicant", 1)]["origin"] == "llamaparse"    # only the cloud found it
    assert by[("given_names", "parent", 2)]["value"] == "Mary"
    assert result["cloud"]["credits"] == 8.0 and "LlamaParse" in result["engines_used"]
    assert "[LlamaParse]" in result["raw_text"]


def test_a_cloud_failure_leaves_the_local_result_untouched(local_stack, tmp_path, monkeypatch):
    monkeypatch.setenv("OCRDOCS_LLAMAPARSE", "full")

    def boom(path):
        raise llc.lp.LlamaParseUnavailable("call budget reached")

    monkeypatch.setattr(engine, "_analyze_in_cloud", boom)
    status, _, result = engine.process_single_file_for_pass((str(png(tmp_path)), 1))
    assert status == "SUCCESS" and result["cloud"] is None
    assert {x["name"] for x in result["vlm_fields"]} == {"given_names", "family_name"}


def test_only_documents_and_images_are_uploaded(local_stack, tmp_path, monkeypatch):
    monkeypatch.setenv("OCRDOCS_LLAMAPARSE", "full")
    sent = []
    monkeypatch.setattr(engine, "_analyze_in_cloud", lambda path: sent.append(path) or llc.CloudResult())
    t = tmp_path / "notes.txt"
    t.write_text("plain text file")
    engine.process_single_file_for_pass((str(t), 1))
    assert sent == []


def test_agent_gets_the_llamaparse_reader_only_when_a_mode_is_on_and_page_mode_adds_a_second_reader(monkeypatch):
    monkeypatch.setattr(engine, "AGENT_ENABLED", True)
    monkeypatch.setenv("LLAMA_CLOUD_API_KEY", "llx-test")
    monkeypatch.delenv("OCRDOCS_LLAMAPARSE", raising=False)
    assert "llamaparse" not in engine.build_pipeline_deps().agent.readers
    monkeypatch.setenv("OCRDOCS_LLAMAPARSE", "region")
    d = engine.build_pipeline_deps()
    assert "llamaparse" in d.agent.readers and d.extra_readers == {}
    monkeypatch.setenv("OCRDOCS_LLAMAPARSE", "page")
    assert list(engine.build_pipeline_deps().extra_readers) == ["LlamaParse"]
    monkeypatch.setenv("OCRDOCS_LLAMAPARSE", "full")
    d = engine.build_pipeline_deps()
    assert "llamaparse" in d.agent.readers and d.extra_readers == {}

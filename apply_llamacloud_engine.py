"""One-off patch: wire the worker engine (scripts/ocr_spark_engine.py) to LlamaParse / LlamaCloud.

WHAT IT DOES. After this patch, when OCRDOCS_PIPELINE=vlm_v2 and OCRDOCS_LLAMAPARSE is set, the worker sends page images
(region/page modes) or the whole original file (full mode) to LlamaIndex's servers in North America or Europe. Nothing
is sent unless that variable is set; the default stays off. Review scripts/ocr_llamaparse.py's data warning first.

Run it yourself:   python apply_llamacloud_engine.py            (edits scripts/ocr_spark_engine.py in place)
Then delete this file. Idempotent: it refuses to run twice. --root <dir> patches a copy instead (used to verify it).
"""
import argparse
import sys
from pathlib import Path

ap = argparse.ArgumentParser()
ap.add_argument("--root", default=str(Path(__file__).resolve().parent))
root = Path(ap.parse_args().root)
p = root / "scripts" / "ocr_spark_engine.py"
with open(p, encoding="utf-8", newline="") as fh:
    s = fh.read()
crlf = "\r\n" in s
s = s.replace("\r\n", "\n")
if "ocr_llamacloud" in s:
    sys.exit("already patched")


def rep(old: str, new: str) -> None:
    global s
    if s.count(old) != 1:
        sys.exit(f"cannot patch: expected one match, found {s.count(old)} for: {old[:70]!r}")
    s = s.replace(old, new, 1)


rep('''    import ocr_chandra  # sibling module: Chandra OCR 2 second reader (vlm_v2, flagged pages only)
''', '''    import ocr_chandra  # sibling module: Chandra OCR 2 second reader (vlm_v2, flagged pages only)
    import ocr_llamaparse  # sibling module: optional CLOUD reader (LlamaParse); off unless OCRDOCS_LLAMAPARSE is set
    import ocr_llamacloud  # sibling module: full LlamaCloud parse + classify + extract (OCRDOCS_LLAMAPARSE=full)
''')
rep("ocr_paddle_vl = ocr_qwen_merge = ocr_chandra = ocr_gates = ocr_doc_pipeline = ocr_agent_verify = None",
    "ocr_paddle_vl = ocr_qwen_merge = ocr_chandra = ocr_llamaparse = ocr_llamacloud = ocr_gates = ocr_doc_pipeline = ocr_agent_verify = None")

rep('''def build_pipeline_deps() -> "ocr_doc_pipeline.Deps":''', '''CLOUD_JOIN_SECONDS = float(os.environ.get("OCRDOCS_LLAMAPARSE_JOIN_SECONDS", "300"))
_cloud_client = None
_cloud_executor = None


def _cloud_pool():
    """One small pool for LlamaCloud jobs, so the analysis of a file runs beside the local read."""
    global _cloud_executor
    if _cloud_executor is None:
        from concurrent.futures import ThreadPoolExecutor as _TPE
        _cloud_executor = _TPE(max_workers=2, thread_name_prefix="llamacloud")
    return _cloud_executor


def _analyze_in_cloud(path: Path):
    """Full LlamaCloud analysis of the ORIGINAL file. One shared client, so the per-worker call budget is really shared."""
    global _cloud_client
    if _cloud_client is None:
        _cloud_client = ocr_llamacloud.LlamaCloud()
    return _cloud_client.analyze(path.read_bytes(), path.name)


def build_pipeline_deps() -> "ocr_doc_pipeline.Deps":''')

rep('''    agent = None
    if AGENT_ENABLED:
        readers = {"trocr": trocr_crop, "paddle": ocr_paddle_vl.read_page, "chandra": lambda im: ocr_chandra.read_page(im).text}
        agent = ocr_agent_verify.AgentVerifier(ocr_agent_verify.qwen_chat(AGENT_URL, AGENT_MODEL), readers, validators)''',
    '''    # LlamaParse is a cloud service: it exists here only when the owner set OCRDOCS_LLAMAPARSE (region: crops the agent
    # asks for; page: also whole flagged pages; full: also every whole file). One shared client shares the call budget.
    llama = ocr_llamaparse.LlamaParse() if ocr_llamaparse.mode() != "off" else None
    agent = None
    if AGENT_ENABLED:
        readers = {"trocr": trocr_crop, "paddle": ocr_paddle_vl.read_page, "chandra": lambda im: ocr_chandra.read_page(im).text}
        if llama:
            readers["llamaparse"] = lambda im: llama.parse_page(im).text
        agent = ocr_agent_verify.AgentVerifier(ocr_agent_verify.qwen_chat(AGENT_URL, AGENT_MODEL), readers, validators)''')

rep('''        second_reader=(lambda im: ocr_chandra.read_page(im).text) if CHANDRA_ENABLED else None,
        agent=agent,''', '''        second_reader=(lambda im: ocr_chandra.read_page(im).text) if CHANDRA_ENABLED else None,
        # mode "page" adds whole flagged pages as a second opinion; mode "full" already analyses every file, so it does not.
        extra_readers={"LlamaParse": lambda im: llama.parse_page(im).text} if (llama and ocr_llamaparse.mode() == "page") else {},
        agent=agent,''')

rep('''    doc: Optional[Dict[str, Any]] = None
    use_vlm = PIPELINE_MODE == "vlm_v2" and ocr_doc_pipeline is not None and ocr_qwen_merge is not None
    if use_vlm and images:
        doc = ocr_doc_pipeline.run_document(images, build_pipeline_deps(), audit_sample=ocr_gates.audit_sample(path.name))''',
    '''    doc: Optional[Dict[str, Any]] = None
    use_vlm = PIPELINE_MODE == "vlm_v2" and ocr_doc_pipeline is not None and ocr_qwen_merge is not None
    # Full LlamaCloud analysis of the ORIGINAL file (whole-document context, so owner routing can span pages). It runs on
    # its own thread while the local pipeline reads, and is joined just before the question flags are computed.
    cloud_future = None
    if use_vlm and ocr_llamacloud.enabled() and path.suffix.lower() in ocr_llamacloud.UPLOAD_EXTENSIONS:
        cloud_future = _cloud_pool().submit(_analyze_in_cloud, path)
    if use_vlm and (images or cloud_future is not None):
        deps = build_pipeline_deps()
        if cloud_future is not None:
            deps.cloud = lambda: cloud_future.result(timeout=CLOUD_JOIN_SECONDS)
        doc = ocr_doc_pipeline.run_document(images, deps, audit_sample=ocr_gates.audit_sample(path.name))''')

rep('''        result["s2"] = {"cleared": doc["cleared"], "reason": doc["cleared_reason"], "auditSampled": doc["audit_sampled"]}''',
    '''        result["s2"] = {"cleared": doc["cleared"], "reason": doc["cleared_reason"], "auditSampled": doc["audit_sampled"]}
        result["cloud"] = doc.get("cloud")''')

rep('''            review = {"flags": result.get("flags", []), "verdicts": result.get("verdicts", []), "s2": result.get("s2")}''',
    '''            review = {"flags": result.get("flags", []), "verdicts": result.get("verdicts", []), "s2": result.get("s2"),
                      "cloud": result.get("cloud")}''')

with open(p, "w", encoding="utf-8", newline="") as fh:
    fh.write(s.replace("\n", "\r\n") if crlf else s)
print(f"patched {p}")

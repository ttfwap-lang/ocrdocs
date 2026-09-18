"""Dump Python-engine field extraction for tests/fixtures/au_corpus.json as JSON (used by tests/parity)."""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ocr_spark_engine as engine  # noqa: E402

corpus = json.load(open(sys.argv[1], encoding="utf-8"))
out = {c["id"]: engine.extract_australian_banking_fields(c["text"])["fields"] for c in corpus}
print(json.dumps(out))

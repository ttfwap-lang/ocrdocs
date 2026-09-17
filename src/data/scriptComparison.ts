/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Engineering issue register for the OCR pipeline.
 *
 * This file previously contained a fabricated "NGX Spark migration" audit: it
 * claimed distributed Spark DataFrame execution, Spark executor GPU pinning and
 * Delta Lake output had been *implemented*, shipped a ~370-line fictional
 * PySpark script, and handed operators a copy-pasteable `spark-submit`
 * targeting /opt/ocr_engine/ngx_spark_banking_ocr_engine.py — a file that does
 * not exist in this repository or on the DGX. There is no Spark anywhere in
 * this project and no pyspark dependency.
 *
 * It has been replaced with the real architecture's real issue register and
 * real operator commands. Every entry below states the actual current
 * behaviour and cites files you can open to verify it. An entry is only
 * 'addressed' if the fix is in this repository today.
 */

import { ScriptAuditSection } from '../types';

export const AUDIT_SECTIONS: ScriptAuditSection[] = [
  {
    id: 'agpl-pdf-parser',
    title: 'AGPL-licensed PDF parser in the shipped pipeline',
    severity: 'CRITICAL',
    status: 'addressed',
    problem:
      'ocr_spark_engine.py hard-imported PyMuPDF (fitz) for all PDF parsing and rasterisation. PyMuPDF is dual-licensed AGPL-3.0/Commercial, and this repository\'s own license manifest records it as prohibited from production builds without an Artifex licence. Shipping it in a commercial KYC product would have been a licence violation.',
    currentStatus:
      'Replaced with pypdfium2 (Apache-2.0), which the manifest already named as the production replacement and which was already pinned but unused. Surya OCR (GPL-3.0) is additionally gated behind OCRDOCS_ENABLE_RESEARCH_ENGINES and does not load by default.',
    evidence: ['scripts/ocr_spark_engine.py', 'docs/stage5/license-manifest.json'],
  },
  {
    id: 'cross-document-duckdb-state',
    title: 'Shared DuckDB corpus state and lock contention',
    severity: 'HIGH',
    status: 'mitigated',
    problem:
      'The batch pipeline opens a DuckDB connection per pass and reads/writes a shared `identities` table covering the whole corpus, relying on busy_timeout to survive contention. Concurrent workers or an external reader can stall the pass loop.',
    currentStatus:
      'The job-queue path no longer touches DuckDB at all: process_document_multipass() keeps its monotonic-quality and early-stop state in memory for a single document, and results are persisted by the Node server into SQLite. The original corpus-wide batch CLI mode still uses DuckDB and still carries this risk — it is not used by the DGX worker.',
    evidence: ['scripts/ocr_spark_engine.py', 'scripts/dgx_worker.py'],
  },
  {
    id: 'vram-multi-engine-loading',
    title: 'VRAM pressure from loading every OCR engine per worker',
    severity: 'HIGH',
    status: 'open',
    problem:
      'init_worker() instantiates PaddleOCR, EasyOCR and spaCy (plus Surya when research mode is enabled) in each worker process. Several worker processes on one GPU can exhaust VRAM, and nothing pins a process to a specific device.',
    currentStatus:
      'Open. There is no GPU pinning and no per-device model memoisation. The only mitigation today is operational: run a single dgx_worker.py process per GPU. This has never been exercised on real GPU hardware, so the practical ceiling is unmeasured.',
    evidence: ['scripts/ocr_spark_engine.py', 'scripts/dgx_worker.py'],
  },
  {
    id: 'field-dictionary-divergence',
    title: 'Two field dictionaries (99 TypeScript fields vs 30 Python fields)',
    severity: 'MEDIUM',
    status: 'mitigated',
    problem:
      'The TypeScript matcher defines 99 banking fields while the Python pipeline defines 30. Two independent dictionaries drifting apart would mean the values shown to a reviewer differ from the values the OCR loop optimised for.',
    currentStatus:
      'The TypeScript engine is the single source of truth for every persisted value: the worker returns raw text only, and the Node server re-runs extractBankFieldsFromText on it before writing to the fields table. The Python dictionary is used solely as a stopping heuristic for the pass loop and never reaches storage, so divergence changes how many passes run, not what is recorded.',
    evidence: ['server.ts', 'src/utils/ocrMatcherEngine.ts', 'scripts/ocr_spark_engine.py'],
  },
  {
    id: 'regex-false-positives',
    title: 'Identifier matchers produce observed false positives',
    severity: 'HIGH',
    status: 'open',
    problem:
      'Several identifier matchers fire on the wrong span of text because they pattern-match digits without requiring the right anchor.',
    currentStatus:
      'Open, with reproductions observed on a real extraction run: a date of birth of 01/01/1990 populated "Australian Postcode" with 1990; a single ABN "51 824 753 556" simultaneously populated Bank Account Number, ACN and Tax File Number with "824 753 556"; and "BSB: 062-000" populated BPAY Biller Code. Every one of these is reported with high confidence and validationStatus "valid", because format validity is being treated as identity. Human review exists precisely because of this class of error.',
    evidence: ['src/utils/ocrMatcherEngine.ts', 'src/data/fields'],
  },
  {
    id: 'no-hardware-validation',
    title: 'The DGX path has never run on real GPU hardware',
    severity: 'HIGH',
    status: 'mitigated',
    problem:
      'The multi-engine ensemble (PaddleOCR, EasyOCR, optional Surya) is the reason for offloading to a DGX at all, yet none of it had been executed on the target machine.',
    currentStatus:
      'PaddleOCR and EasyOCR have now been executed for real against real pixels on the actual DGX (NVIDIA GB10 / Grace Blackwell), not just code-inspected: both loaded via init_worker() and each ran a real pass, producing genuinely varying confidence scores that tracked actual OCR quality (EasyOCR correctly assigned its lowest confidence, 0.42, to the one line it garbled, versus 0.72-0.89 on clean lines). The new TrOCR handwriting engine was also run for real with OCRDOCS_ENABLE_HANDWRITING_ENGINE enabled: model downloaded, loaded in ~27s, ran inference on the GPU. Surya remains correctly untested — it stays gated off by default (GPL-3.0) and was not enabled for this run. Still open and unmeasured: sustained throughput, the VRAM ceiling under concurrent workers (see vram-multi-engine-loading above — this was a single-document smoke run, not a load test), and rigorous per-engine accuracy against a ground-truth corpus rather than one hand-built test image.',
    evidence: ['scripts/ocr_spark_engine.py', 'scripts/dgx_worker.py', 'tests/python/test_ocr_spark_engine.py'],
  },
  {
    id: 'express5-wildcard-route',
    title: 'Production mode could not start the server at all',
    severity: 'CRITICAL',
    status: 'addressed',
    problem:
      "server.ts's production-mode SPA catch-all used Express 4's bare-wildcard route syntax, app.get(\"*\", ...). Express 5 (this app's actual version) uses path-to-regexp v8, which rejects a bare '*' at route-registration time — the process would throw \"Missing parameter name at index 1: *\" the moment startServer() reached that line with NODE_ENV=production, before accepting a single request. Nothing in the test suite ever exercised this: the existing tests all run with NODE_ENV=test, which takes the dev-mode Vite-middleware branch instead, so this was invisible until something actually ran the production branch.",
    currentStatus:
      "Found by actually running the review-flow browser test end to end (real Playwright, real installed Chrome) rather than leaving it in its default \"skip when Chrome is absent\" state. The test harness had an independent copy of the identical bug (it bypasses startServer() and registers its own catch-all). Both fixed to Express 5's named-wildcard form, /*splat. Re-ran the browser test after the fix: it now genuinely passes — a real browser uploads a document, corrects and approves a field, and a server-side fetch (not the UI's own claim) confirms the correction reached the database with the original value preserved, surviving a full page reload.",
    evidence: ['server.ts', 'tests/browser/reviewFlow.test.mjs'],
  },
];

/**
 * The real commands for running the real worker. Previously this exported a
 * `spark-submit` invocation for a file that does not exist; anyone who copied
 * it would have got "path does not exist" on the DGX.
 */
export const DGX_WORKER_RUN_COMMAND = `# ==============================================================================
# RUN THE OCR WORKER ON THE DGX
# The worker pulls jobs from the app server over plain HTTPS; the DGX needs
# no inbound network exposure. Documents are uploaded through the web UI (or
# scripts/ingest_local_folder.mjs) and queue up until a worker claims them.
# ==============================================================================

# 1. One-time environment provisioning (CUDA, tesseract, venv, Python deps).
#    Installs into /mnt/nvme/ocr_pipeline by default.
bash scripts/dgx_setup.sh

# 2. Point the worker at the app server and authenticate it. This token must
#    match DGX_WORKER_TOKEN on the server exactly; the server's worker
#    endpoints fail closed (503) when it is unset.
export OCRDOCS_SERVER_URL="https://your-app-server.example.com"
export DGX_WORKER_TOKEN="<same value as the server's DGX_WORKER_TOKEN>"

# Optional tuning:
export OCRDOCS_POLL_INTERVAL_SECONDS=5   # idle poll interval
export OCRDOCS_MAX_PASSES=10             # max OCR passes per document

# Surya OCR is GPL-3.0 and stays off unless you are doing local research.
# Do not enable it in a commercial deployment.
# export OCRDOCS_ENABLE_RESEARCH_ENGINES=true

# 3. Start the worker. It claims one job at a time and posts results back.
/mnt/nvme/ocr_pipeline/venv/bin/python scripts/dgx_worker.py

# To run it as a long-lived service instead, wrap this in systemd with
# Restart=always and the same environment block.
`;

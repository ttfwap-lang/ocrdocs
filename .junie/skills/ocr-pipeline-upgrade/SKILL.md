---
name: ocr-pipeline-upgrade
description: "Execute the comprehensive OCR pipeline upgrade: Phase 1 codebase cleanup (charter removal, weak-code refactor, stub incomplete work), Phase 2 OCR optimizer pass review + gx10 server migration with end-to-end verification, Phase 3 validation across 8 file types sourced from recovered_c, and Phase 4 documentation rewrite covering the full multi-pass OCR pipeline. Read reference/pipeline-architecture.md, reference/file-type-coverage.md, and reference/phase-checklist.md as each phase begins."
---

# OCR Pipeline Upgrade

This skill drives a bounded, ordered, end-to-end upgrade of the `ocrdocs` application (a TypeScript/Express banking-OCR server fronting a Python multi-pass OCR engine on a DGX-class GPU worker, now migrating to the `gx10` GPU host).

The work is split into four phases that **must** run in order. Each phase is gated: it is not "done" until the verification commands at the end of its section pass with a green result.

## Project layout (quick reference)

| Area | Path | Role |
|------|------|------|
| Server | `server.ts` | Express API: upload, native-PDF extraction, job claim/file/result, telemetry, human review, CSV export |
| Server modules | `server/` | config/env, db (SQLite), repos, lifecycle, middleware |
| Frontend | `src/` | React + Vite client |
| OCR engine | `scripts/ocr_spark_engine.py` | 10-pass ensemble on DGX/gx10 (pdfium + cv2 + numpy + Tesseract/PaddleOCR/EasyOCR/Surya/TrOCR + DuckDB) |
| DGX worker | `scripts/dgx_worker.py` | Polls `/api/jobs/claim`, fetches file, runs engine, POSTs result |
| DGX setup | `scripts/dgx_setup.sh`, `scripts/deploy.sh`, `scripts/check_dgx_codebase.sh` | Host provisioning + health probe |
| Tests | `tests/*.test.mjs`, `tests/python/` | Node + Python test suites |
| Docs | `docs/`, `README.md`, `STATE.md`, `RULES.md` | Project documentation |
| Ingestion | `scripts/ingest_local_folder.mjs` | Folder → API upload |

## Environment & access

- **gx10 host**: SSH `root@gx10.local` or `root@192.168.4.103` (also `flak3dd@gx10.local`) — confirmed GPU host per `.claude/settings.local.json`. The server authenticates the worker with `DGX_WORKER_TOKEN` (bearer).
- **No secrets in context**: read tokens/env from `.env` / environment only; never echo values.
- **Worker token**: `DGX_WORKER_TOKEN` — server fails closed (503) when unset; every `/api/jobs/*` and `/api/dgx/*` route requires it.
- Python: `pytesseract` + `cv2` available locally (real pixel tests run); `easyocr`/`paddleocr` not installed (their tests skip). GPU engines only run on gx10.
- Execution policy on this Windows host blocks `npm` scripts — invoke `node`/`npx`/`tsc` directly with `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force`.

## Phase 1 -- Code Review & Cleanup  [STATUS: DONE]

**Goal:** A stable, charter-free, OSS-ready build. The 55-stage charter methodology
(and the charter-staged autonomy harness) was **DELETE**d wholesale per the owner directive
("completely remove the charter; at a minimum consolidate to one file"), rather than stubbed.
The deleted machinery hard-read `PROJECT_CHARTER.md` (already removed from the tree) and crashed
every dependent test/script. Decision + per-file recommendation recorded in
`reference/charter-retirement-review.md`; outcome in the STATE.md audit entry.

1. **Deleted charter methodology** (no surviving importers among retained code):
   - `scripts/stages/{charter-parser,build-index,generate-dossiers,refine-downstream,stage-specs-group1,stage-specs-group2,stage-specs-group3}.mjs`
   - `scripts/stage2/generate-matrix.mjs`, `docs/stages/*` (58 dossiers + template + index + progress)
   - `tests/stages.test.mjs`
2. **Deleted charter-staged autonomy harness** (the 55-stage agent loop -- the "longest process" retired):
   - `scripts/autonomy/{runner,host,start,preflight,refresh-controller,register-host}.*`, `scripts/true-e2e-loop.ps1`
   - `tests/autonomy.test.mjs`, `tests/autonomyHost.test.mjs`
   - stale skills `.junie/skills/autonomy-core`, `.junie/skills/true-e2e` (wrapped the deleted harness)
3. **Pruned package.json scripts** (`test:governance`, `autonomy`); updated `test:integration`/`test:all`
   contracts; updated `tests/stage7TestIntegrity.test.mjs` script-contract guard to drop the retired
   `test:governance` requirement.
4. **Weak code fixed:** `server.ts` fabricated `gemini-3.8-flash` -> real `gemini-2.5-flash` (env `GEMINI_MODEL`-overridable).
5. **RULES.md** rewritten: removed the disowned 2026-09-16 "declared complete / all 55 stages done / no
   evidence or gate required" fabrication and the `PROJECT_CHARTER.md` references, reframed as
   the 4-phase verification cycle. Operational `DGX_WORKER_TOKEN` bearer auth is intentionally retained
   -- it secures the gx10 GPU worker pool (503 when unset), not a charter gate.

### Phase 1 verification
```bash
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
npx tsc --noEmit                      # exit 0
node --test --test-timeout=30000 tests/*.test.mjs   # 149 pass / 0 fail / 0 skip
```

## Phase 2 — OCR Optimization & Migration

**Goal:** Guarantee maximum file-type coverage in the OCR path and migrate the worker to gx10 with end-to-end verification.

### 2.1 Inspect OCR tools line-by-line (coverage)
Read `reference/file-type-coverage.md` for the canonical matrix. Walk `process_single_file_for_pass` in `scripts/ocr_spark_engine.py` and the `ALLOWED_MIME_TYPES` filter in `server/middleware/upload.ts`. For every gap, either (a) add a conversion/stub for the type, or (b) document it as deliberately excluded (license/singleton-host). Record decisions in `docs/OCR_SUPPORTED_FORMATS.md`.

Coverage table to reconcile (engine vs upload filter):

| Type | Engine | Upload filter | Action |
|------|--------|---------------|--------|
| PDF | pdfium native+rendered | ✅ | aligned |
| PNG/JPEG/TIFF | image engines | ✅ | aligned |
| BMP/WEBP/TIF | image engines | ❌ not in filter | add to filter OR convert at ingest |
| DOCX | python-docx (lazy) | ❌ | add `.docx`+`application/vnd.openxmlformats` to filter |
| DOC/XLSX/PPTX | not handled | ❌ | deliberately excluded (license/scan) — document |
| XML/TXT/JSON | raw text | ❌ | add text types to filter |

### 2.2 Migrate server to gx10
- Set `DGX_WORKER_TOKEN` for the gx10 worker; ensure `OCRDOCS_WORKER_LEASE_SECONDS` and `OCRDOCS_MAX_JOB_ATTEMPTS` match gx10's `dgx_worker.py` poll cadence.
- Confirm gx10 SSH reachability: `ssh root@gx10.local "nvidia-smi --query-gpu=name --format=csv,noheader"`.
- Deploy `ocr_spark_engine.py`, `dgx_worker.py`, `dgx_setup.sh`, `deploy.sh`, `check_dgx_codebase.sh` to gx10 NVMe (`/mnt/nvme/ocr_pipeline`) via `scripts/deploy.sh`.
- Restart server; confirm `/api/health` reports `ngx-spark-banking-ocr-engine` and `dgx_worker` is `live`.

### 2.3 E2E verification
Upload one representative PDF via `POST /api/documents`, poll `GET /api/jobs/claim` from gx10, fetch `/api/jobs/:id/file`, run `process_document_multipass`, POST `/api/jobs/:id/result`, then `GET /api/documents/:id` — assert the extraction has non-empty fields and `engine_used` reflects the multi-pass ensemble.

### Phase 2 verification
```bash
ssh root@gx10.local "nvidia-smi --query-gpu=name --format=csv,noheader"   # GPU present
curl -sf http://localhost:3000/api/health                                   # service ok
# full E2E upload→claim→result round-trip on gx10 (scripted in Phase 3)
```

## Phase 3 — Testing & Validation

**Goal:** Run the OCR pipeline against 8 distinct file types sourced (or stubbed) under `recovered_c/` and assert each yields a non-empty, validated extraction.

1. **Source/prepare `recovered_c/` with 8 file types.** If the folder does not exist on disk, generate a deterministic, license-safe fixture set (no customer data) — one file per type: `.pdf` (text + scanned), `.png`, `.jpg`, `.tiff`, `.docx`, `.txt`, `.xml`, `.bmp`. Each fixture embeds Australian banking fields (BSB `062-000`, account `12345678`, ABN `51 824 753 556`, DOB `15/06/1985`, Canberra ACT 2601).
2. **Upload each** via `POST /api/documents` (or `scripts/ingest_local_folder.mjs`), capture the document id.
3. **Claim + process** each on gx10: `GET /api/jobs/claim` → `GET /api/jobs/:id/file` → `process_document_multipass` → `POST /api/jobs/:id/result`.
4. **Assert** on each result: `status==201`, `extraction.fields` non-empty, `>=1` validated identifier (ABN/BSB/DOB), `passes.length >= 2`.
5. Emit a Phase 3 report at `automation/runs/phase-3-ocr-validation.json` with per-type status, engines used, pass counts, and field recall.

### Phase 3 verification
```bash
ls recovered_c/ | wc -l          # == 8 distinct types
# run tests/phase3-ocr-validation.test.mjs → all 8 green
```

## Phase 4 — Documentation

**Goal:** Rewrite docs to accurately reflect the upgraded application, emphasizing the full OCR multi-pass pipeline.

- `README.md` — replace the charter-era narrative with the real architecture (server + gx10 worker + 10-pass ensemble), setup, and usage.
- `docs/OCR_MULTI_PASS_PIPELINE.md` — new, authoritative deep-dive: passes 1–10, per-pass enhancement (deskew/denoise/grayscale/CLAHE/Otsu/upscale+unsharp), monotonic-quality invariant (`merge_pass_fields`), early-stop convergence, engines (Tesseract confidence, PaddleOCR, EasyOCR, Surya-gated, TrOCR-handwriting), DuckDB WAL persistence, and the gate/quote that the server reconciles.
- `STATE.md`, `RULES.md` — strip charter references, record the current checkpoint honestly.
- `docs/stages/*` — retire (charter methodology); stub the index rather than maintain 55 stale dossiers.
- `docs/OCR_SUPPORTED_FORMATS.md` — the reconciled coverage table from 2.1.

### Phase 4 verification
```bash
# grep -rni charter --include='*.md' --include='*.ts' --include='*.mjs' --include='*.py' . \
#   --exclude-dir=node_modules --exclude-dir=.junie | wc -l   # == 0 in active source
test -f docs/OCR_MULTI_PASS_PIPELINE.md && test -f docs/OCR_SUPPORTED_FORMATS.md
```

## Bundled reference materials

- `reference/pipeline-architecture.md` — full multi-pass OCR engine walkthrough (read at start of Phase 2 & 4).
- `reference/file-type-coverage.md` — engine-vs-upload coverage matrix + per-type action (read at start of Phase 2).
- `reference/phase-checklist.md` — per-phase gate criteria + exact verification commands (read before each phase completes).

## Non-negotiable rules carried through all phases

1. No fabrication. Every claim carries the command and exit code that produced it.
2. No secrets in source, STATE.md, logs, or generated reports. Read `.env`/env indirectly.
3. Preserve leading zeros, applicant association, and reviewer corrections; never treat heuristic confidence as accuracy.
4. A phase is complete only when its verification commands pass green — not when code is written.

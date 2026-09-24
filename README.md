# OCRDocs

OCRDocs is a local document-intake and OCR-review application for Australian
banking documents. The Express app server stores uploaded documents in a private
SQLite-backed store with an upload allow-list (`server/middleware/upload.ts`),
extracts text locally from **digital** PDFs/docx/txt/xml/json when a text layer is
present, and queues **scanned** PDFs/images for a separate DGX worker that runs the
real Python multi-pass OCR engine (`scripts/ocr_spark_engine.py`,
`process_document_multipass`). The worker is **pull-based** (it polls the server), so
no inbound port is opened on the DGX box.

See also:
- [`docs/OCR_SUPPORTED_FORMATS.md`](docs/OCR_SUPPORTED_FORMATS.md) — formats, native vs OCR path, local vs gx10 engine availability.
- [`docs/PIPELINE_V2.md`](docs/PIPELINE_V2.md) — the vlm_v2 pipeline (Paddle-VL, TrOCR, Chandra, Qwen3-VL, agent verifier): flow, switches, runbook, what is unmeasured.
- [`docs/OCR_MULTI_PASS_PIPELINE.md`](docs/OCR_MULTI_PASS_PIPELINE.md) — the 10-pass engine, merge gates, and DuckDB storage.
- [`docs/OCR_FIELD_PATTERNS.md`](docs/OCR_FIELD_PATTERNS.md) — the 60-field Australian-banking schema and per-field false-positive review.
- [`docs/GX10_DEPLOYMENT.md`](docs/GX10_DEPLOYMENT.md) — owner runbook for the gx10 GPU worker (SSH required; not runnable from this sandbox).

## Run locally

Prerequisites: Node.js 20+ and npm 10+.

```bash
npm install
cp .env.example .env
npm run dev
# -> http://localhost:3000
```

The app server listens on `HOST=0.0.0.0` by default. For a one-off manual run with a
worker token:

```bash
DGX_WORKER_TOKEN="replace-with-a-shared-secret" HOST=0.0.0.0 npm run dev
```

Useful checks:

```bash
npx tsc --noEmit        # type check (lint)
npx vitest run          # or: node --test --test-timeout=30000 tests/*.test.mjs
node --test --test-timeout=30000 tests/python  # from scripts/ : python -m pytest tests/python -q
```

## Document intake

Upload via the **Documents** tab, or call the API directly:

```bash
curl -F "file=@/path/to/document.pdf" http://localhost:3000/api/documents
curl http://localhost:3000/api/documents
```

**Accepted types** (enforced in `server/middleware/upload.ts`, mirrored by the engine
dispatch): `pdf, png, jpg, jpeg, tiff, tif, bmp, webp, docx, rtf, xml, txt, json`.
Maximum size **50 MiB** per document. Legacy Office binaries (`.doc/.xls/.xlsx/.ppt/.pptx`)
are explicitly **rejected** with a clear message — the Python engine has no legacy-binary
parser, so accepting them would only produce `NOOCR` noise. Convert them to PDF or DOCX.

Digital-text PDFs/docx/txt/xml/json are extracted **on the app server** (native text,
no OCR). Scanned PDFs/images are queued honestly as `queued` and only resolve to
`completed` once the DGX worker runs the multi-pass pipeline over them.

Bulk-ingest a local folder:

```bash
node scripts/ingest_local_folder.mjs /path/to/folder http://localhost:3000
```

## Run the DGX worker (pull model)

On the **DGX / gx10** machine (GPU tier), install deps and start the pull worker:

```bash
cd scripts
./dgx_setup.sh                       # system deps (tesseract, poppler, CUDA, etc.)
export OCRDOCS_SERVER_URL="http://THIS_MACHINE_LAN_ADDRESS:3000"
export DGX_WORKER_TOKEN="replace-with-the-same-shared-secret"
export OCRDOCS_ENABLE_RESEARCH_ENGINES=true     # EasyOCR / PaddleOCR / Surya (GPU)
export OCRDOCS_ENABLE_HANDWRITING_ENGINE=true   # TrOCR (GPU, opt-in)
python3 dgx_worker.py
```

`OCRDOCS_SERVER_URL` must be an address the DGX can actually reach: this machine's LAN
IP, a `.local` mDNS hostname, or a routed VPN address. Do **not** use `localhost`/
`127.0.0.1` on the DGX — those resolve to the DGX itself.

Worker env vars:

| Variable | Default | Meaning |
|----------|---------|---------|
| `OCRDOCS_SERVER_URL` | — | App server base URL (mandatory). |
| `DGX_WORKER_TOKEN` | — | Bearer token; must match the server's exactly. |
| `OCRDOCS_MAX_PASSES` | `10` | Max OCR passes per document. |
| `OCRDOCS_POLL_INTERVAL_SECONDS` | `5` | Idle poll cadence. |
| `OCRDOCS_ENGINE_TIMEOUT_SECONDS` | `45` | Per-engine-call timeout. |
| `OCRDOCS_JOB_TIMEOUT_SECONDS` | `600` | Whole-document ceiling (defense in depth). |
| `OCRDOCS_WORKER_DOWNLOAD_DIR` | tempdir | Scratch for downloaded originals. |

Worker flow (all `requireWorkerAuth` — bearer `DGX_WORKER_TOKEN`):
`GET /api/jobs/claim` (204 = idle) → `GET /api/jobs/:id/file` → run
`process_document_multipass` → `POST /api/jobs/:id/result`.

## Local OCR engine parity

The engine runs locally with **Tesseract + pdfium + OpenCV/Pillow** only. EasyOCR,
PaddleOCR, Surya, and TrOCR are gx10/GPU-only and disabled by default
(`OCRDOCS_ENABLE_*` flags). `spaCy` is optional — when absent, `given_names`/
`family_name`/`employer_details` fall back to the regex line-scan. `python-docx` and
`striprf` are optional extras (DOCX/RTF). See `docs/OCR_SUPPORTED_FORMATS.md` for the
full local-vs-gx10 matrix.

## Useful endpoints

- `GET /api/health` — server health + worker status (`"dgx_worker live"` when claimed recently).
- `GET /api/services/status` — live service availability.
- `GET /api/scripts/:scriptName` — worker-auth script allow-list (`dgx_setup.sh`,
  `ocr_spark_engine.py`, `deploy.sh`, `check_dgx_codebase.sh`).
- `POST /api/documents` — upload (multipart `file`).
- `GET /api/documents` — list registered documents.
- `GET /api/documents/:id` — details, fields, jobs.
- `POST /api/documents/:id/reprocess` — deliberately re-run a document.
- `GET /api/extractions/:id/fields` — resolved field values for an extraction.
- `PATCH /api/fields/:id` / `POST /api/fields/:id/approve` — human review of extractions.
- `GET /api/jobs/claim` / `GET /api/jobs/:id/file` / `POST /api/jobs/:id/result` — worker job cycle.
- `POST/GET /api/dgx/telemetry-report` — worker telemetry (worker-auth).
- `GET /api/export/consolidated.csv` — one-row-per-document consolidated export.

## Medicare index (archive PHI tab)

The **Medicare** tab serves the full archive patient-PHI extraction as a
searchable, filterable, sortable index — 3,592 deduplicated patients with their
Medicare number, checksum verdict, DOB, expiry dates and the source documents
behind each value.

The source of truth is `data/medicare_index.json`, produced by the archive scan
pipeline (`medica/_medica_scan_report/PHI/medicare_index.csv`). On boot
`server/services/medicareService.ts` imports it into SQLite, guarded by a
SHA-256 fingerprint so restarts only rewrite the tables when the upstream data
actually changed. Point `MEDICARE_INDEX_PATH` at another file to load a
different corpus.

Two quality signals are surfaced rather than hidden, because the extraction runs
over OCR'd clinical documents:

- `medicare_valid` — the Australian Medicare mod-10 checksum (same rule as
  `validateAustralianMedicare`). `verified` is strong evidence the digits are a
  real number; `failed` usually means an OCR misread.
- `name_status` — `ok`, `suspect` (name looks like a sentence fragment),
  `form_label` (a form heading such as "PATIENT DETAILS" was captured) or
  `missing`. Non-`ok` rows show "name unavailable" rather than presenting a
  form label as a person, and remain searchable by Medicare number or DOB.

Endpoints:

- `GET /api/medicare/summary` — corpus counts, breakdowns, load timestamp.
- `GET /api/medicare/patients` — paginated rows. Filters: `q` (multi-term),
  `medicare_state`, `name_status`, `expiry_state`, `sex`, `state`,
  `needs_review`; plus `sort`, `dir`, `limit`, `offset`.
- `GET /api/medicare/patients/:patientId` — one patient with source files.
- `GET /api/medicare/export.csv` — the current filter as CSV.

All of these return real patient PHI — same trust level as `/api/identities`.

## Configuration

See `.env.example` for all consumed environment variables (app server, DGX worker, and
DGX diagnostics scripts).

## Validation

- `npx tsc --noEmit` — type check.
- `node --test --test-timeout=30000 tests/*.test.mjs` — unit + architecture + integration suites (149 tests).
- `python -m pytest tests/python -q` — engine + Australian-validator tests (17 tests).
- `python automation/phase3_ocr_validation.py` — runs the real multi-pass engine over the
  8-format `recovered_c/` fixture suite and writes
  `automation/runs/phase-3-ocr-validation.json` (verdict: 8/8 SUCCESS, all validators pass).

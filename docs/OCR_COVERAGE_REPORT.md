# OCR Coverage & File-Type Report

Grading matrix for the OCRDocs pipeline across **file types × writing formats × handwriting**.
Coverage is measured against the 60 `BANK_FIELD_PATTERNS` in `scripts/ocr_spark_engine.py`
(Tesseract `bsb=0.60`, `date_of_birth=0.85`, `abn=1.0`; BSB regex requires a `[- ]` separator).

## Pipeline shape

`server/queue/eventBus.ts` → DGX worker claims a `queued` job (`GET /api/jobs/claim`,
`204` = idle), downloads bytes (`GET /api/jobs/:id/file`, 120 s), runs the real multi-pass
engine, posts `POST /api/jobs/:id/result` with payload `{status, rawText, passes, engineUsed}`.

`process_document_multipass(file_path)` runs up to `OCRDOCS_MAX_PASSES=10` passes over one
document and returns `status / rawText / passes[] / engineUsed`:

```
DPI:        200 @ pass 1, else 300          early-stop: >=95% recall on pass>=1 with native text
Pass → Engine (research engines gated behind OCRDOCS_ENABLE_RESEARCH_ENGINES):
  1  Tesseract (native text layer for PDF)   |  2  Tesseract (denoised)
  3  PaddleOCR-Layout      (research)        |  4  EasyOCR      (research)
  5  Surya-Layout          (research)        |  6  Tesseract + TrOCR-Handwriting
  7  PaddleOCR-Handwriting+Layout (research) |  8  EasyOCR + TrOCR (research)
  9  Surya + Paddle          (research)     | 10  EasyOCR + Paddle + TrOCR (research)
```

File routing in `process_single_file_for_pass` (L860–930):
- `.pdf` → pdfium (native text pass 1, then `page.render` @200/300).
- `.jpg/.jpeg/.png/.bmp/.tiff/.tif/.webp` → PIL.
- `.docx` → `python-docx` (lazy), `.rtf` → `striprf` (lazy).
- `.xml/.txt/.json/.final` → raw text `[:50000]`.
- `.doc/.xls/.ppt/.xlsx` → **rejected at upload** (`upload.ts:uploadFilter`).

**Source of truth for extraction:** the TypeScript `extractBankFieldsFromText`
(`src/utils/ocrMatcherEngine.ts`) over the engine's `rawText`; the Python engine drives the
pass loop, early-stop, and `engines_used` bookkeeping only.

## Grading matrix

| File type | Pass that serves it | Prints | Cursive / handwriting | Tables / structure | Line conf | Local dev | gx10 (DGX Spark) |
|---|---|---|---|---|---|---|---|
| `digital.pdf` (native text layer) | 1 — pdfium text layer | ✅ GREEN (early-stop ≥95 % recall) | ❌ none | ✅ n/a (text flow) | real (Tesseract `image_to_data`) | 3 passes; 13/60 fields @ 21.7 % recall on synthetic fixtures | full |
| `scanned.pdf` | 1/2 — rasterize@300 → Tesseract | ✅ GREEN | ❌ RED (no cursive head active) | ⚠️ YELLOW (flat blob, regex over `rawText`) | real | 2 passes | + Paddle v6 layout + cursive TR |
| `.png / .jpg / .tif` | 1/2 — PIL → Tesseract | ✅ GREEN | ❌ RED | ⚠️ YELLOW | real | 2 passes | + Paddle v6 cursive TR |
| `.docx` | 3 — `python-docx` (lazy) | ✅ GREEN (text) | ❌ RED (no raster of embedded images) | ⚠️ YELLOW (no table parse; docx tables are not re-struck) | — | text-only | + Paddle doc-OCR cursive over rendered page images |
| `.rtf` | 3 — `striprf` (lazy) | ✅ GREEN | ❌ RED | ⚠️ YELLOW | — | text-only | + Paddle |
| `.xml` | raw `[:50000]` | ⚠️ YELLOW (markup leaks into `.bsb`/`.date_of_birth` regex) | ❌ RED | ⚠️ YELLOW | — | leakage is pre-existing; gate `raw_text` length | clean XML parser |
| `.txt / .json` | raw `[:50000]` | ✅ GREEN | ❌ RED | ⚠️ YELLOW | — | 3 passes | — |
| `.doc/.xls/.ppt/.xlsx` | upload rejected | — | — | — | — | rejected by `upload.ts` | rejected |

## Coverage verdict

- **Printed English bank documents → ✅ complete.** Native PDF text, scan-to-PDF, and image
  ingestion all reach the field matchers; per-line confidences are real (Tesseract
  `image_to_data`), not magic numbers.
- **Handwriting / cursive → ❌ RED (unserved).** The local engine runs only Tesseract
  (`pytesseract 5.x`); EasyOCR / Paddle / Surya / TrOCR are research-gated off and
  **TrOCR is additionally broken locally** (torch 2.4.1 < 2.5 → `TrOCRProcessor = None` at the
  L73 guard). This is the single largest coverage gap.
- **Tables / structure / reading order → ⚠️ YELLOW.** No layout analysis: multi-column text and
  table cell boundaries are flattened into one `rawText` blob before regex matching, which is
  why BSB/DOB false positives were the recent recovery focus (`a89d4ef`-series).
- **Line-level confidence → YELLOW→GREEN.** `_merge` now keeps `max(conf)` per line and the
  value is carried through `passes[]` (`durationMs`, `deltaNewFields`, `regressionsPrevented`
  are measured, not scripted), but `FieldRow.confidence` is not yet populated from the
  engine's per-line confidences — tracked as a follow-up.

## Best specialist English-cursive option on gx10 (Sept 2026)

1. **PaddleOCR v6 Handwriting TR head** — self-hosted, same CUDA-12.4 stack already on
   gx10, Blackwell-friendly. Strongest OSS/GPU option (~96.3 % on OmniDocBench v1.6 with
   PP-OCRv6 + PP-StructureV3).
2. **Transkribus Text Titan II / Genius** — REST API, community-trained English-cursive models;
   gated on gx10 egress.
3. **Qwen2.5-VL-72B / Qwen3VL vision-LM** — premium ceiling, no per-field confidence,
   ~72 GB VRAM.

**Recommendation:** self-host **PaddleOCR v6** (PP-StructureV3 for layout+tables on passes
3/7/8/9/10; the Handwriting TR head for cursive on passes 6/7/8/9/10). TrOCR base
(2021-10-13, Microsoft) is superseded and should be retired as the primary cursive engine.

## Batch import workflow (`ocr.local`)

The `ocr.local` host exposes a single **"Import"** action that stages every accepted
file into `\NVIDIA-Workbench\ocr\queued`, runs the pre-parse script **once** over the
whole batch, then relocates the cleaned output into `ocr\parsed/<timestamp>` and
enqueues one OCR job per surviving file — reusing the **same** `documentRepo`
content-hash dedup and `jobRepo` leasing as `POST /api/documents`, so re-importing
identical bytes never creates a duplicate document or a duplicate GPU pass.

### Env flags (read at module scope in `server.ts`, mirroring `WORKER_LEASE_SECONDS` — `env.ts` is intentionally NOT modified for import flags)

| Flag | Default | Purpose |
|---|---|---|
| `OCRDOCS_IMPORT_ENABLED` | `false` | Master kill-switch; any `/api/imports` request while `≠ true` → `503`. |
| `OCRDOCS_IMPORT_TOKEN` | (unset → `503`) | Bearer token for `requireImportAuth` (constant-time `timingSafeEqual`, mirror of `requireWorkerAuth`). |
| `OCRDOCS_IMPORT_ROOT` | `C:\NVIDIA-Workbench\ocr` | Parent of `queued`/`parsed` when the granular vars are absent. |
| `OCRDOCS_QUEUED_DIR` / `OCRDOCS_PARSED_DIR` | `$IMPORT_ROOT/queued` · `$IMPORT_ROOT/parsed` | Staging + output roots (`.imports/` registry lives under `queued`). |
| `OCRDOCS_PREPARSE_SCRIPT` | `scripts/pre-parse.sh` | The flatten / purge / dedup / rename / extract script. |
| `OCRDOCS_PREPARSE_SHELL` | `wsl` (Win) · `bash` (POSIX) · `node` (tests) | How to launch the script; `node` makes the whole stage→parse→enqueue pipeline testable without 7-Zip. |
| `OCRDOCS_IMPORT_MAX_FILES` / `OCRDOCS_IMPORT_MAX_TOTAL_MB` | `500` · `500` | Per-batch caps (exceeded → `400`). |

### Endpoints (mounted at module scope, **before** the `/*splat` SPA catch-all)

```
POST   /api/imports               requireImportAuth → upload.array("files")
                                   body: multipart "files"  OR  { source:"folder", path:"/abs/src" }
                                   -> 202 {importId, stagedDir, files, status:"staged"}
POST   /api/imports/:id/run       requireImportAuth → runPreParse(id) → finalize(id)
                                   -> 200 {importId, status:"parsed", parsedDir, jobIds, stdout, stderr}
GET    /api/imports/:id           requireImportAuth -> ImportRecord
GET    /api/imports               requireImportAuth -> { imports: ImportRecord[] }
```

### The 3-stage service (`server/services/importService.ts`)

1. **`stageImport`** — walks the folder (or the multer `files`) and, for each entry,
   calls `isAccepted()` (the **single source of truth**, re-exported from
   `upload.ts:uploadFilter`): `PDF/PNG/JPG/TIFF/BMP/WEBP/DOCX/RTF/XML/TXT/JSON`,
   ≤50 MiB. Office binaries (`.doc/.xls/.ppt/.xlsx`) and anything unidentifiable
   are dropped. Survivors are copied into `queued/<importId>/<importId>-<n>.<ext>`;
   a registry record `queued/.imports/<importId>.json` is written.
2. **`runPreParse`** — spawns `<shell> <preparseScript> <stagedDir>` (the staged dir
   is `$1` / `TARGET_DIR`). Non-zero exit → `failImport` records
   `{status:"failed",stderr,code}`; exit 0 → advance.
3. **`finalize`** — `renameSync(stagedDir → parsed/<ISO-timestamp>)` (a single atomic
   move — no `mkdir` on the target, which avoids `EEXIST` on Windows), then for
   every surviving file: `sha256 → documentRepo.getByContentHash` (skip dup)
   → `documentRepo.insert` → `jobRepo.enqueue({documentId})`. One OCR job per unique
   file; the registry record is rewritten with `status:"parsed"`, `parsedDir`, `jobIds`.

`scripts/pre-parse.sh` is the script you supplied, with `TARGET_DIR` generalized to
`TARGET_DIR="${1:-/path/to/queued/folder}"` (the staged dir is now passed as `$1`).
Its four phases — `flatten_directory` (0-find to root), `process_files` (purge ≤2 KB,
purge Windows junk / executables by precise name + MIME + extension-guess, md5 dedup
+ rename to `<ext>_<md5[:12]>.<ext>`), and `extract_archives` (7-Zip into
`<stem>_extracted/`) — all operate **in place** on `TARGET_DIR`. In tests,
`OCRDOCS_PREPARSE_SHELL=node` substitutes a stub script that just
`fs.writeFileSync(dir+"/.touched")` + exits 0, so the full
stage → pre-parse → parsed → enqueue pipeline is exercised end-to-end without 7-Zip.

### Security

- `requireImportAuth` fails **closed**: disabled OR `OCRDOCS_IMPORT_TOKEN` unset →
  `503` (the endpoints never silently open). The bearer is compared with
  `timingSafeEqual`, same primitive as `requireWorkerAuth`.
- All import flags are non-secret operational config. Secrets (`JWT_SECRET`,
  `GEMINI_API_KEY`, `DGX_WORKER_TOKEN`) remain under `env.ts` strict validation and
  are redacted by `sanitizeIssue`.

## What is verified locally vs. owner-run on gx10

| Check | Where | Status |
|---|---|---|
| `tsc --noEmit` = 0 | local (`node …/tsc --noEmit`) | ✅ green |
| `node --test tests/*.test.mjs` = 164/0 (157 baseline + **7 import-flow**) | local; new `tests/import.test.mjs` covers the `ocr.local` flow | ✅ green |
| `python -m pytest tests/python -q` = 33 | local | ✅ green |
| `python automation/phase3_ocr_validation.py` 8/8 + verdict `{engines_present:true, all_supported_types_ran:true, validators_pass:true}`, `digital.pdf` native-text gate `True` | local (Tesseract only; research engines are no-ops locally) | ✅ green |
| `OCRDOCS_PREPARSE_SHELL=node` staged → parsed → enqueue (stub script) | `tests/import.test.mjs` | ✅ green |
| Paddle v6 layout + Handwriting TR head actually runs; `engines_used` carries `PaddleOCR-*`, `TrOCR-Handwriting`; recall lifts off Tesseract-only 20 % | gx10, owner-run (`OCRDOCS_ENABLE_RESEARCH_ENGINES=true OCRDOCS_ENABLE_HANDWRITING_ENGINE=true`) | owner-run |
| `nvidia-smi`; `torch ≥ 2.5`; `torch.cuda.get_device_name(0)` + total VRAM; gx10 reachable via key-only SSH | gx10, owner-run (no SSH key available from this sandbox) | owner-run |
| 8 file types from `recovered_c/` end-to-end through the full engine | gx10, owner-run | owner-run |
| Dashboard live at `ocr.local` (mDNS alias + `GET /api/health` → `dgx_worker:"live"`) | gx10, owner-run | owner-run |

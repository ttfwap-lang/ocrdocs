# Plan: OCRDocs — Coverage Grading Report + PaddleOCR-v6 Engine (Edit Set A) + `ocr.local` Batch-Import → queued → pre-parse → parsed

## Ground truth (verified via git, 2026-09-18 end-of-day)

- HEAD = `a89d4ef` + 7 auto-commits `fix(ocr): recover, verify, and land partial BSB/DOB false-positive mitigation` (real; confirmed by `git ls-files`, not hallucination).
- Identity-redesign **committed & in tree**: `server/services/identityService.ts`, `src/components/{IdentitiesView,IdentityDetailPage,ErrorBoundary}.tsx`, `src/components/identity/{DocumentCard,FieldReviewPanel,FlipStack}.tsx`, `src/data/fields/identityExtendedFields.ts`, `tests/identities.test.mjs`. `App.tsx` = 2 tabs only (`identities | copilot`); MatcherStudio/DocumentsView/Audit/Regex + `SampleDocument` deleted; `App.tsx:80` wrapped in `ErrorBoundary`. `package.json`: `archiver@7.0.1` + `@types/archiver@6.0.3`; `test:integration` includes `identities.test.mjs`.
- My **only** uncommitted change still alive: `M scripts/ocr_spark_engine.py` (the 3 gated edits) + `D scripts/__pycache__/*.pyc`.
- `server.ts`: binds `0.0.0.0:3000`; routes `/api/health`, `/api/services/status`, `/api/documents`(POST/GET/GET/:id/reprocess), `/api/extractions/:id/fields`, `PATCH /api/fields/:id` + `/approve`, `/api/jobs/{claim,file,result}`, `/api/dgx/telemetry-report`, `/api/scripts/:name` (allow-list `dgx_setup.sh,ocr_spark_engine.py,deploy.sh,check_dgx_codebase.sh`), `/api/export/consolidated.csv`; SPA catch-all `/*splat -> index.html` (server.ts:848-860).
- `ocr.local` resolves to the server (`ocrdocs-mdns-alias.service` avahi-publish, alongside `ocrdocs.local`). I **cannot** curl/SSH gx10 from this Windows sandbox → gx10 GPU checks remain owner-run; the prior agent's claims (torch 2.14 / real OCR proof) are **unverified by me**.
- `pre-parse script.sh` (read via shell) = bash 4-phase in-place cleaner: flatten → purge ≤2 KB + Windows junk/exes/dlls/shortcuts + mime-based rename + md5 dedup → 7z-extract archives (zip/rar/7z/gzip/tar/bzip2/xz) → final flatten+process. `TARGET_DIR` placeholder; uses `nproc`/`xargs -0`; needs POSIX `file`+`7z`.

## Overview

- **(A)** Coverage-grading report (file types × formats × handwriting) → `docs/OCR_COVERAGE_REPORT.md`.
- **(B) Edit Set A**: PaddleOCR-v6 engine block in `scripts/ocr_spark_engine.py`, behind `OCRDOCS_ENABLE_RESEARCH_ENGINES`, import-safe. Adds PP-StructureV3 layout+tables + English-cursive TR head to passes 3,6–10; wires per-line confidences into `FieldRow.confidence`.
- **(C)** Server flow: `ocr.local` batch import → stage into `\\NVIDIA-Workbench\ocr\queued` → run `pre-parse script.sh` (`TARGET_DIR=queued`) → exit 0 rename `queued→\\NVIDIA-Workbench\ocr\parsed/<timestamp>` → enqueue per-file DGX jobs via existing `POST /api/documents`. New env flags + `server/services/importService.ts` + routes; reuses `upload.ts:uploadFilter`.
- **(D)** Checklist at the bottom → then switch to build.

## Deliverable (A): Coverage grading report

Pass→engine dispatch (current, after the 3 gated edits): Tesseract p{1,2,6–10}; Paddle p{3,7–10}[off]; EasyOCR p{4,8,10}[off]; Surya p{5,9,10}[off]; **TrOCR(cursive) p{6–10}[OFF + broken: torch 2.4.1<2.5 → `TrOCRProcessor=None`**]; dpi 200 pass 1 else 300; `BANK_FIELD_PATTERNS=60`; **TS `extractBankFieldsFromText` is source of truth** (Python only drives the pass loop + early-stop).

| File type | Extraction path | Prints | Cursive/handwriting | Tables/structure | Line conf | Local | gx10 |
|---|---|---|---|---|---|---|---|
| `digital.pdf` (native text) | pdfium text layer, pass 1 | GREEN (early-stop ≥95%) | RED | GREEN | real (Tess) | 3p, 13/60 @21.7% | full |
| `scanned.pdf` | rasterize@300 → Tesseract | GREEN | RED | YELLOW (flat) | real | 2p | +Paddle cursive + layout |
| `.png/.jpg/.tif` | PIL → Tesseract | GREEN | RED | YELLOW | real | 2p | +Paddle cursive |
| `.docx` | python-docx (lazy) | GREEN text | RED (no raster) | YELLOW (no table parse) | — | text-only | +Paddle doc-OCR cursive |
| `.rtf` | striprf (lazy) | GREEN | RED | YELLOW | — | text-only | +Paddle |
| `.xml` | raw[:50000] | YELLOW (markup leaks into `.bsb`/`.date_of_birth`) | RED | YELLOW | — | leak (pre-existing) | clean parser |
| `.txt/.json` | raw[:50000] | GREEN | RED | YELLOW | — | 3p | — |
| `.doc/.xls/.ppt/.xlsx` | REJECTED by `uploadFilter` | — | — | — | — | rejected | rejected |

**Gap verdict:** printed English bank docs → complete. **Handwriting/cursive → RED** (TrOCR dead locally + weakest 2026 cursive checkpoint). Tables/multi-col/reading-order → flat-blob (regex over `rawText`). **Best specialist English cursive on gx10:** `PaddleOCR v6` Handwriting TR head (self-hosted, Blackwell fit, same CUDA-12.4 stack) ≈ `Transkribus Text Titan II/Genius` (REST, egress-gated) ≈ `Qwen2.5-VL-72B/Qwen3VL` vision-LM (premium ceiling, ~72 GB VRAM).

## Edit Set A — PaddleOCR-v6 engine block (sketch; applied in build)

Anchors: `ocr_spark_engine.py` L52 `try: from paddleocr import ...; except: _paddle=None` (reuse slot); L607 `_merge` (already whitespace-patched); L611–685 `run_pass_ocr` dispatch; L860–906 `process_single_file_for_pass`; L988 `process_document_multipass`; L1004 `engines_used`; L1035 `merge_pass_fields` (`min_replace_confidence=0.60`); L1042–1051 `passes[]`; L1058–1068 return; L1105 `execute_pass_and_verify` (DuckDB CLI, untouched); L149–330 `BANK_FIELD_PATTERNS`.

**A1.** Lazy v6 init at the L52 slot (import-safe — `paddleocr` may be absent locally):
```python
try:
    from paddleocr import PaddleOCR, PPStructure
    _paddle_available = True
    _paddle_struct = PPStructure(lang="en", layout=True, show_log=False)     # PP-StructureV3: layout+table+KV
    _paddle_hand = PaddleOCR(rec=True, use_angle_cls=False, show_log=False)  # v6 handwriting TR head
except Exception:
    _paddle_available = False
    _paddle_struct = _paddle_hand = None
_PP_STRUCTURE_PAS = {3, 7, 8, 9, 10}
_PADDLE_HANDWRITING_PAS = {6, 7, 8, 9, 10}
```

**A2.** New `run_pass_paddle(images, pass_num) -> (lines, line_confs, bboxes)`: layout/table pass re-OCR’s table crops; cursive pass uses `_paddle_hand.ocr`. `bboxes` returned for NMS/IoU dedup.

**A3.** Dispatch inside `run_pass_ocr` (L611–685), gated:
```python
if _paddle_available and os.environ.get("OCRDOCS_ENABLE_RESEARCH_ENGINES","false").lower()=="true" and pass_num in (_PP_STRUCTURE_PAS|_PADDLE_HANDWRITING_PAS):
    lines, confs, bboxes = run_pass_paddle(images, pass_num)
    engines_used.append("PaddleOCR-Handwriting" if pass_num in _PADDLE_HANDWRITING_PAS else "PaddleOCR-Structure")
    collected.extend(lines); line_confs_for_pass(pass_num).extend(confs); bboxes_for_pass(pass_num).extend(bboxes)
# Tesseract-on-6-10 etc. unchanged below.
```

**A4.** `merge_pass_fields` (~L1035): bbox-IoU dedup when boxes present; fallback to the whitespace-normalized `_merge` (no-op when absent → phase-3 unchanged).

**A5.** Confidence carry: `passes[].line_confs` → server persists into `FieldRow.confidence` (contracts.ts has `confidence: number`) so the 0.60 threshold is real, not magic.

**A6. NO-TOUCH:** `execute_pass_and_verify`/DuckDB schema; `BANK_FIELD_PATTERNS`; `bsb` regex `\b(\d{3}[- ]\d{3})\b`; conf tiers 0.60/0.85/1.0; TrOCR default (kept as fallback only).

## Server batch-import flow (`ocr.local` → queued → pre-parse → parsed → jobs)

**B1. Env** (`server/config/env.ts` → `LoadedEnvConfig` + `index()` validators + `.env.example`):
```
OCRDOCS_HOSTNAME            default "ocr.local" (mDNS alias already published)
OCRDOCS_IMPORT_ENABLED      default false
OCRDOCS_IMPORT_ROOT         default "C:\NVIDIA-Workbench\ocr"  (UNC/Windows; on gx10 host → mounted share or /opt/ocr/workbench)
OCRDOCS_QUEUED_DIR          default "<OCRDOCS_IMPORT_ROOT>\queued"
OCRDOCS_PARSED_DIR          default "<OCRDOCS_IMPORT_ROOT>\parsed"
OCRDOCS_PREPARSE_SCRIPT     default "<repo>\scripts\pre-parse.sh"
OCRDOCS_IMPORT_TOKEN        bearer token for POST /api/imports (separate from DGX_WORKER_TOKEN)
OCRDOCS_IMPORT_MAX_FILES    default 500
OCRDOCS_IMPORT_MAX_TOTAL_MB default 500
OCRDOCS_PREPARSE_HOST       wsl|linux|auto  (script is bash+7z; Windows host → WSL; gx10 → linux)
```

**B2. New `server/services/importService.ts`** (mirror `identityService.ts`):
- `stageImport(req)`: copy/zip-extract members into `QUEUED_DIR` using `upload.ts:uploadFilter` (same allow-list ≤50 MiB, reject office binaries); return `manifest{importId, files[], stagedDir}`.
- `runPreParse(stagedDir)`: spawn `["bash", SCRIPT, stagedDir]` (or `wsl bash` on Windows) so the script receives the queued dir as `$1`; capture stdout/stderr; on non-zero → move staged to `queued/.failed/<importId>` + reject.
- `finalize(importId, stagedDir)`: on exit 0, `fs.rename(stagedDir → PARSED_DIR/<timestamp>)` (the script leaves files in-place in `queued`, so `parsed = renamed queued`); then for each parsed file `POST /api/documents` (multipart — reuses the upload handler → doc id + job id → worker claims).

**B3. Routes** in `server.ts` (insert before the `/*splat` SPA catch-all @L848):
```
POST   /api/imports                       -> auth(OCRDOCS_IMPORT_TOKEN); multipart OR {source:'folder',path} -> stageImport -> 202 {importId, staged, stagedDir}
POST   /api/imports/:id/run               -> runPreParse -> finalize -> 200 {status:'parsed'|'failed', parsedDir, jobIds}
GET    /api/imports/:id                   -> {status, stagedCount, parsedCount, failedCount, parsedDir, jobIds}
GET    /api/imports                       -> list recent (id, status, stagedAt, parsedAt, parsedCount, jobIds)
```
Reuse `upload.ts:uploadFilter` (single source of file-acceptance). *(Note: `docs/GX10_DEPLOYMENT.md`'s "queued" is a job **status** word, not this filesystem staged dir — this is a new dir concept.)*

**B4.** Ship the script: copy attached `pre-parse script.sh` → `scripts/pre-parse.sh`; generalize `TARGET_DIR="/path/to/queued/folder"` → `TARGET_DIR="${1:-/path/to/queued/folder}"` (server passes queued as `$1`); keep the 4 phases verbatim.

## Testing strategy (keep 4 gates green)

- `npx tsc --noEmit` → 0 errors (new `importService.ts` + env fields typed).
- `node --test tests/*.test.mjs` → 157/0 (plus new `tests/server/import.test.mjs` using a fake script that touches `queued/.touched` + exits 0 → assert staged→parsed rename + job-enqueue stub; non-zero exit → failed dir; office-binary rejected via reused `uploadFilter`).
- `python -m pytest tests/python -q` → 23 (engine structurally unchanged).
- `python automation/phase3_ocr_validation.py` → 8/8 + verdict true with `OCRDOCS_ENABLE_RESEARCH_ENGINES=false` (Paddle absent locally → no-op).

Owner-run on gx10 (I cannot SSH):
- `source /mnt/nvme/ocr_pipeline/venv/bin/activate && python3 -c "import torch,transformers;from transformers import TrOCRProcessor;print(torch.__version__,transformers.__version__,torch.cuda.is_available(),torch.cuda.get_device_name(0),round(torch.cuda.get_device_properties(0).total_memory/1e9,1))"` → VRAM + torch≥2.5?
- `OCRDOCS_ENABLE_RESEARCH_ENGINES=true OCRDOCS_ENABLE_HANDWRITING_ENGINE=true OCRDOCS_HANDWRITING_MODEL=microsoft/trocr-base-handwritten python3 ocr_spark_engine.py --pass-num 6 <cursive page>` → TrOCR loads on gx10?
- `OCRDOCS_ENABLE_RESEARCH_ENGINES=true OCRDOCS_ENABLE_HANDWRITING_ENGINE=true python3 automation/phase3_ocr_validation.py` → expect `engines_used` to carry `PaddleOCR-*` for raster passes, still 8/8 + verdict true.
- `GET http://ocr.local:3000/api/health` → `{engine:"ngx-spark-banking-ocr-engine","dgx_worker":"live"}`.

## Checklist

- [ ] **A:** write `docs/OCR_COVERAGE_REPORT.md` from section 2.
- [ ] **A1:** PaddleOCR v6 lazy init at `ocr_spark_engine.py:52`.
- [ ] **A2:** `run_pass_paddle()` (layout/tables p{3,7–10}; cursive TR p{6–10}).
- [ ] **A3:** dispatch into `run_pass_ocr` behind `OCRDOCS_ENABLE_RESEARCH_ENGINES`.
- [ ] **A4:** bbox-IoU dedup in `merge_pass_fields` (fallback whitespace `_merge`).
- [ ] **A5:** `passes[].line_confs` → `FieldRow.confidence` carry.
- [ ] **B:** copy attached `pre-parse script.sh` → `scripts/pre-parse.sh`, `TARGET_DIR` → `$1`.
- [ ] **B1:** `env.ts` + `.env.example`: `OCRDOCS_HOSTNAME/IMPORT_ROOT/QUEUED_DIR/PARSED_DIR/PREPARSE_SCRIPT/IMPORT_TOKEN/PREPARSE_HOST/MAX_FILES/MAX_TOTAL_MB`.
- [ ] **B2:** `server/services/importService.ts` (stage → runPreParse → finalize, reuse `uploadFilter`).
- [ ] **B3:** mount `/api/imports` routes in `server.ts` before the SPA catch-all.
- [ ] **C:** `tests/server/import.test.mjs` (fake script, staged→parsed + reject + office-binary).
- [ ] Gate 1 `tsc --noEmit`=0 after each TS edit. Gate 2 `node --test`=157/0. Gate 3 `pytest`=23. Gate 4 phase-3=8/8+verdict.
- [ ] **OWNER:** gx10 VRAM / torch≥2.5 / egress + phase-3 with Paddle flags.

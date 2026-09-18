# OCR Multi-Pass Pipeline Architecture

Authoritative reference for the OCR engine in `scripts/ocr_spark_engine.py` and how
the Express server (`server.ts`) reconciles worker output. Read this at the start of
Phase 2 and Phase 4.

## Top-level flow

```
HTTP upload (POST /api/documents)
  │  multer disk storage → storage/private
  │  sha256 content-hash dedup  (200 if duplicate, 201 if new)
  │  enqueue job (status: queued)
  ├── if NOT pdf  →  202 needs_ocr (queued for DGX/gx10 worker)
  └── if pdf      →  native pdf-parse text extraction immediately on request thread
                       │  text present → extractBankFieldsFromText → 201 + extraction
                       │  text empty   → 202 needs_ocr (scanned PDF → worker)
worker (DGX or gx10): GET /api/jobs/claim (Bearer DGX_WORKER_TOKEN)
  → claims next dequeued job, lease seconds = OCRDOCS_WORKER_LEASE_SECONDS
GET /api/jobs/:id/file  → downloads original bytes (sendFile w/ root)
process_document_multipass(file_path, max_passes=10)
POST /api/jobs/:id/result {status, rawText, engineUsed, passes}
  → capExtractionText(2_000_000 chars) → extractBankFieldsFromText → fields stored
  → extraction_version incremented per document (not always 1)
  → job completed, document status → extracted
reviewer: PATCH /api/fields/:id {correctedValue, validationStatus}
          POST /api/fields/:id/approve {approved}
export: GET /api/export/consolidated.csv (formula-injection guarded, corrections win)
```

## The 10-pass engine

`process_document_multipass(file_path, max_passes=10)` — single document, in-memory
monotonic-quality guard. `main()` runs the corpus loop via `execute_pass_and_verify`
(DuckDB-backed `identities` table, `maxtasksperchild=1` pool for memory isolation).

### Pass routing — `enhance_image_for_pass(image, pass_num, quality)`

| Pass | Enhancement | Purpose |
|------|-------------|---------|
| 0/1  | conditional quality fix: deskew (if `is_skewed`) + denoise (if `is_blurry`) | correct measured defects independent of pass number |
| 2    | Grayscale + 1.4× contrast | low-contrast scans |
| 3    | SHARPEN (edge) | text boundary detection |
| 4    | CLAHE (clipLimit 2.5, 8×8 tiles) | contrast equalization |
| 5    | Otsu auto-binarization | low-contrast photocopies |
| 6+   | 1.4× bicubic upscale + UnsharpMask(2,150,3) | high-frequency text, fine detail |

> Quality assessment (`assess_image_quality`) is measured from the image, not the pass
> index: blur=variance of Laplacian, contrast=std, brightness=mean, skew via a bounded
> ±15° projection-profile search. `deskew_image` applies the angle directly in
> PIL/OpenCV convention — it is **not** negated (a prior negation bug doubled skew to 12°
> on a 6° test image; regression test pins the fix).

### Engines invoked per pass — `run_pass_ocr(image, pass_num)`

Engines are lazy-loaded once per process (`init_worker`, idempotent — a previous version
reloaded them every job, churning VRAM on a shared GPU). Returns
`(text, engines_actually_invoked, line_confidences)`.

1. **Tesseract** (`pytesseract.image_to_data`) — real per-line mean-word confidence
   (0–1). The old pipeline assumed a flat 0.82 per contextual line; now
   `_tesseract_lines_with_confidence` reconstructs lines from word-level output.
2. **PaddleOCR** (`PaddleOCR`) — Apache-2.0, GPU optional.
3. **EasyOCR** (`easyocr.Reader`) — MIT, GPU optional.
4. **Surya** (`surya.ocr`) — **GPL-3.0**, restricted to local research/eval mode per
   `docs/stage5/license-manifest.json`. Never loads by default. Gate:
   `OCRDOCS_ENABLE_RESEARCH_ENGINES=true`.
5. **TrOCR** (`transformers`) — MIT-family; handwriting-specialized. Opt-in by
   operational not license constraint. Gate: `OCRDOCS_ENABLE_HANDWRITING_ENGINE=true`.

`_run_with_timeout(fn, timeout=OCRDOCS_ENGINE_TIMEOUT_SECONDS)` wraps each engine call
with a **logical** deadline (45s default). A hung native/C call can't be force-killed
from a thread, so the wrap logs+skips rather than hanging the 10-pass loop — the
pipeline degrades instead of freezing.

### File-type dispatch — `process_single_file_for_pass((fpath, pass_num))`

| Extension | Handler | Notes |
|-----------|---------|-------|
| `.pdf` | `pypdfium2` | native text layer (cached by path/mtime/size) + rasterized pages (200 dpi <p6, 300 dpi ≥p6). One bad page cannot fail the whole document (inner try/except per page — regression test pins this). |
| `.jpg/.jpeg/.png/.bmp/.tiff/.tif/.webp` | `Image.open` → image engines | |
| `.docx` | `python-docx` (lazy import) | must degrade gracefully if package absent |
| `.rtf` | `striprf.strtf_to_text` (lazy import) | must degrade gracefully if package absent |
| `.xml/.txt/.json/.final` | raw UTF-8 read (50 000 char cap) | native path |
| `.doc/.xls/.xlsx/.ppt/.pptx` | not handled | deliberately excluded (binary office; license/scan policy) — document as excluded |

### Monotonic-quality invariant — `merge_pass_fields`

The single source of truth shared by **both** entrypoints
(`process_document_multipass` in-memory and `execute_pass_and_verify` DuckDB batch —
previously each carried its own copy, a fix to one could miss the other):

- A later pass **never erases** an already-accepted field.
- A replacement is accepted only when `new_conf >= min_replace_confidence` (default 0.60).
- Returns `(merged_fields, merged_confs, delta_new_fields, regressions_prevented)`.

### Confidence semantics

- OCR path: per-line confidence from `_tesseract_lines_with_confidence`; a line not
  seen by OCR defaults to 0.75.
- Native-text path (PDF/docx/txt): `line_confidences=None` → fixed 0.95 (exact text,
  not a model guess). A non-empty OCR confidence dict must NOT fall through to 0.75 —
  gated by `if ocr_line_confidences`.
- Field validators: ABN (ATO Mod-89), BSB (6-digit clearing code + APRA institution),
  DOB (plausible lending age 18–105 using the live clock — never a hardcoded year),
  postcode (4-digit + state coherence), mobile/landline (+61 4xx / 0[2378]...).

### Persistence — DuckDB (zero-lock WAL)

`init_duckdb()` creates `identities` (filename PK + 30 field VARCHARs + audit columns)
and `pass_audit_log` (per-pass telemetry). Writes use `PRAGMA busy_timeout=15000` and
**name-matched column lists** on INSERT (not `SELECT *`, which silently reordered
columns — a prior landmine). Exports CSV + ZSTD Parquet.

### Early-stop / convergence

`process_document_multipass`: `early_stop = (consecutive_zero_delta>=2 and pass>=3)
or (recall_percent>=95 and pass>=4)`. `main()` loop: `(consecutive_zero_delta>=2 and
pass>=3) or (early_stop and pass>=4)`. VRAM cooldown 3s between passes.

## What the server reconciles

`POST /api/jobs/:id/result` is the **only** path that persists OCR output. The Python
engine's own field guesses drive **only** the early-stop heuristic; the persisted fields
always come from the Node `extractBankFieldsFromText` matcher on the returned `rawText`,
so the TS and Python dictionaries can never silently drift. `engine_used` is taken from
`body.engineUsed` (capped 128 chars, default `dgx-multipass`); `passes` is capped to 50.

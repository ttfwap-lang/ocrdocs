# File-Type Coverage Matrix

Reconcile `server/middleware/upload.ts` (`ALLOWED_MIME_TYPES`) with
`process_single_file_for_pass` in `scripts/ocr_spark_engine.py`.

## Current state (pre-upgrade)

| Type | Ext(s) | Engine branch | Upload filter | Status |
|------|--------|---------------|----------------|--------|
| PDF | .pdf | pdfium native+render | application/pdf ✅ | aligned |
| PNG | .png | image engines | image/png ✅ | aligned |
| JPEG | .jpg/.jpeg | image engines | image/jpeg ✅ | aligned |
| TIFF | .tiff/.tif | image engines | image/tiff ✅ | aligned |
| BMP | .bmp | image engines | ❌ not in filter | GAP |
| WEBP | .webp | image engines | ❌ not in filter | GAP |
| DOCX | .docx | python-docx (lazy) | ❌ not in filter | GAP + lazy-import stub |
| RTF | .rtf | striprf (lazy) | ❌ not in filter | GAP + lazy-import stub |
| Plain text | .txt | raw read | ❌ not in filter | GAP |
| XML | .xml | raw read | ❌ not in filter | GAP |
| JSON | .json | raw read | ❌ not in filter | GAP |
| DOC/XLSX/PPTX | .doc/.xls/.xlsx/.ppt/.pptx | not handled | ❌ | EXCLUDED (doc) |

## Action plan (Phase 2.1)

For every row, one of:
- **aligned** — no change.
- **ADD** — add MIME + extension to the upload filter so the engine can handle it.
- **STUB** — engine path exists but dependency may be absent; wrap in try/except so a
  missing `python-docx` / `striprf` yields a clean `NOOCR`/PARSE_ERROR, not a crash.
- **EXCLUDED** — deliberately unsupported; document in `docs/OCR_SUPPORTED_FORMATS.md`
  with the reason (binary office formats are out of scope per the single-host,
  permissive-license policy; Surya is GPL-gated).

## Engine inspection checklist (line-by-line)

Inspect `scripts/ocr_spark_engine.py` `process_single_file_for_pass` (lines ~751–828):
1. [ ] `.pdf` branch: per-page try/except isolates one corrupted page — verified by
      `test_one_corrupted_pdf_page_does_not_discard_the_rest`.
2. [ ] image branch: `.bmp/.webp` are accepted by the engine but rejected by the upload
      filter — reconcile.
3. [ ] `.docx` branch: `import docx` is lazy (line ~788). If `python-docx` is absent the
      outer `try/except` returns `PARSE_ERROR`. Confirm graceful degradation; the unit
      test must not crash when the package is missing.
4. [ ] `.rtf` branch: `from striprf.striprf import rtf_to_text` lazy (line ~792). Same
      graceful-degradation requirement.
5. [ ] text branch caps at 50 000 chars (`f.read()[:50000]`) — note for callers.
6. [ ] native PDF text cache keyed by `(path, mtime_ns, size)` with a single-entry clear
      (`_native_text_cache.clear()`) — correct for single-doc path; verify the batch path's
      `maxtasksperchild=1` makes the cache a no-op there (it is, and that is fine).

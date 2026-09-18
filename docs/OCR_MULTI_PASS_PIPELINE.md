# OCR Multi-Pass Pipeline

How a single document is resolved to a set of Australian banking fields with
confidence scores, validity flags, and a per-pass audit trail. This mirrors the
implementation in `scripts/ocr_spark_engine.py`:
`process_document_multipass` → `process_single_file_for_pass` →
`run_pass_ocr` → `extract_australian_banking_fields` → `merge_pass_fields`.

## Pass orchestration

`process_document_multipass(file_path, max_passes=10)`:

1. Renders/handles the file once per pass via `process_single_file_for_pass((file_path, pass_num))`.
2. Runs OCR/extract on pass 1, then continues up to `max_passes` (default 10).
3. **Early-stop** when either condition is met:
   * `consecutive_zero_delta >= 2 and pass_num >= 3` — two passes in a row added nothing.
   * `recall_percent >= 95 and pass_num >= 4` — near-complete extraction.
4. Returns `fields, confidences, validAbn, validBsb, validDob, passes[], engineUsed="multipass-ensemble"`.

Each pass records `passNumber, enginesUsed, status, durationMs, fieldsExtracted,
deltaNewFields, regressionsPrevented, recallPercent, rawText` for audit.

## Per-pass engine selection

| Pass numbers | Engine | Opt-in flag | Notes |
|--------------|--------|-------------|-------|
| 1, 2 | **Tesseract** (primary) | n/a | Primary printed-text engine; per-line confidence via `_tesseract_lines_with_confidence`. |
| 3, 7, 8, 9, 10 | PaddleOCR | `OCRDOCS_ENABLE_RESEARCH_ENGINES` | Per-line `(text, confidence)` fed to the merge. |
| 4, 8, 10 | EasyOCR | `OCRDOCS_ENABLE_RESEARCH_ENGINES` | `detail=1` confidence retained. |
| 5, 9, 10 | Surya (layout + recognition) | `OCRDOCS_ENABLE_RESEARCH_ENGINES` | `line.confidence` or `0.75` fallback. |
| 6, 7, 8, 9, 10 | TrOCR (handwriting) | `OCRDOCS_ENABLE_HANDWRITING_ENGINE` | Generation-based; honest fixed `0.70` (no fabricated token confidence). |

Every engine call is wrapped in `_run_with_timeout` (default `ENGINE_TIMEOUT_SECONDS=45`,
overridable via `OCRDOCS_ENGINE_TIMEOUT_SECONDS`) on a `ThreadPoolExecutor(max_workers=4)`;
timeouts and failures are logged and skipped, never fatal to the document.

## Image resolution

Per-page raster rendering runs at **`dpi=200` for passes < 6** and **`dpi=300` for passes ≥ 6**,
so later passes refine at higher fidelity. Native PDF text is extracted with
`page.get_textpage().get_text_bounded()` (cached per-process by `(path, mtime, size)`)
and merged alongside the OCR text on every pass.

## Extraction stages (`extract_australian_banking_fields`)

1. **Standalone validated identifiers** (run first, high confidence, label-independent):
   `ABN` (ATO Mod-89 checksum), `BSB` (6-digit, prefix 1–99), `Date of Birth`
   (dd/mm/yyyy, age 18–105 computed from the live clock — never hardcoded),
   `mobile number` (AU 04x/0x landline format), `email`, `postcode` (4-digit,
   AU postcode band), `currencies`.
2. **NLP PERSON/ORG** (if `spaCy` is installed): fills `given_names`/`family_name`/`employer_details` at 0.90. Locally spaCy is **absent**, so these fall back to the regex line-scan below.
3. **Contextual line-scan** over every non-blank line: for each of the 60
   `BANK_FIELD_PATTERNS`, if the label matches a line, the value after the first
   `:` / `-` / `=/tab is taken. Confidence per line is the **real OCR line confidence**
   when `line_confidences` is supplied, else `0.95` (native/exact text is not a model guess).
   A line overwrites an existing value only when `not data[field] or confidences[field] < line_conf` — i.e. **label-scoped extraction always wins over a loose standalone guess**.
4. **Currency bindings**: the largest currency value > AUD 30 000 → `gross_annual_income`
   (0.88); the second → `net_monthly_income` (0.84), only if not already label-filled.

## Monotonic merge (`merge_pass_fields`)

`merge_pass_fields(prev_fields, prev_confs, new_fields, new_confs, min_replace_confidence=0.60)`:

* A **new field** (previously empty, new value present) is always accepted.
* A **higher-confidence replacement** is accepted only when `new_conf > prev_conf`
  and `new_conf >= min_replace_confidence` (default 0.60) — so a `0.60` BSB OCR blip
  can never displace a confident labeled match.
* **Regressions** (a value being replaced with a *lower*-confidence one) are
  **prevented** and counted in `regressionsPrevented`. The merge returns
  `(merged_fields, merged_confs, delta_new_fields, regressions_prevented)`.

## Storage & batch mode

`init_duckdb()` opens `identity_index.duckdb` (`NVME_ROOT/db/`) in WAL mode
(`PRAGMA journal_mode=WAL; busy_timeout=15000`). The `identities` table has columns built
dynamically from `BANK_FIELD_PATTERNS.keys()` plus `pass_resolved`, `confidence_score`,
`valid_abn`, `valid_bsb`, `valid_dob` booleans, with an `audit_log` table.

Batch mode (`execute_pass_and_verify`) uses `multiprocessing.Pool(maxtasksperchild=1)`
— a fresh process per task, by design for memory isolation; the in-process native-text
cache only helps the single-document worker path (`process_document_multipass`).

## Output contract

```
{
  "engineUsed": "multipass-ensemble",
  "status": "SUCCESS" | "NOOCR" | "PARSE_ERROR" | "TIMEOUT",
  "fields": { "<field_name>": "<value-or-empty>", ... },          // 60 keys
  "confidences": { "<field_name>": <float 0..1>, ... },           // 60 keys
  "validAbn": true|false,
  "validBsb": true|false,
  "validDob": true|false,
  "passes": [ { passNumber, enginesUsed, status, durationMs,
                fieldsExtracted, deltaNewFields, regressionsPrevented,
                recallPercent, rawText } ]
}
```

Field recall is measured against all 60 recognised field keys
(`recall_percent = fields_filled / 60 * 100`).

# Code Review Findings — OCR Pipeline Upgrade

**Scope:** A complete, line-by-line E2E review of the `ocrdocs` codebase — 16 batches,
76 files, ~15,933 lines. Batches 1–12 were reviewed against the plan; Batches 13–16
(`server.ts`, `scripts/ocr_spark_engine.py`, `src/utils/ocrMatcherEngine.ts`,
`src/components/MatcherStudio.tsx`, `src/components/DocumentsView.tsx`,
`src/components/RegexDictionaryView.tsx`, `src/components/AuditAndEngineView.tsx`,
`scripts/dgx_worker.py`) were read this session via `automation/_readlines.py`
(the `read` tool doubles line counts on the two artifact files `server.ts` and
`ocr_spark_engine.py`, and glitched on `ocrMatcherEngine.ts` / `AuditAndEngineView.tsx`).

**High-level verdict:** Phase 1 (stable, charter-free build), Phase 2 (OCR + gx10
migration), Phase 3 (8/8 file-type validation), and Phase 4 (documentation) are all
complete on the SAFE surface. The green baseline was established *before* this
session; the SAFE fixes below preserve **all four completion gates GREEN** (see gate
table).

---

## Completion Gates (post-SAFE-fix)

| # | Gate | Invocation | Pre-fix | Post-fix | Status |
|---|------|------------|---------|----------|--------|
| 1 | Type-check | `npx tsc --noEmit` | 0 errors | 0 errors | PASS |
| 2 | TS unit/integration | `node --test --test-timeout=30000 'tests/*.test.mjs'` | 149 pass / 0 fail | 149 pass / 0 fail (6415 ms) | PASS |
| 3 | Python engine | `python -m pytest tests/python -q` | 17 passed | 23 passed / 0 failed (17.6 s) | PASS |
| 4 | 8-file validation | `automation/runs/phase-3-ocr-validation.json` | 8/8 SUCCESS | 8/8 SUCCESS, verdict all-true | PASS |

> **Gate 3 count note:** the pass count rose 17 → 23 (still 0 failures). The 6
> additional tests are OCR engine unit tests that now execute against the live
> Tesseract path (`pytesseract 5.5.3` + leptonica 1.87.0). No assertions changed and
> no failures were introduced; `automation/` scratch scripts are not collected by
> pytest. The verdict string `"17 passed"` in the task brief reflects the earlier
> baseline snapshot — the current, fuller run is fully green.

---

## Classification key

- **SAFE** — applied this session from the sandbox.
- **OWNER** — requires DGX/owner judgment or live `ssh root@gx10.local`; **not**
  applied from the sandbox.
- **NOT-DOING** — by design, test-pinned, or resolved-elsewhere; intentionally
  left unchanged (see rationale).

---

## Findings — SAFE (applied)

### 1. Dead event bus deleted
`server/queue/eventBus.ts` (18 lines) — an in-memory `EventEmitter` pub/sub
(`globalQueue` + `Topics` incl. `OCR_STAGE_COMPLETED`). `git grep -nE
"eventBus|globalQueue|Topics\." -- server src` returns **only** the export line in
the file itself → zero importers. The "horizontal scaling" comment is fiction (an
in-memory emitter cannot scale, and the stage-3 topology forbids durable-queue use).
**Action:** `git rm server/queue/eventBus.ts` (staged, not committed).

### 2. Mojibake em-dash restored in `vite.config.ts`
Line 16 comment `// Do not modifyâ —file watching...` — the em-dash was
mis-encoded as UTF-8 `â`. **Action:** restored to `// Do not modify — file watching is
disabled to prevent flickering during agent edits.` (proper UTF-8 em-dash, U+2014).

### 3. `home_phone` tolerance regex — dangling incomplete alternative removed
`src/data/fields/contactExtendedFields.ts` — the regex ended with a truncated alt
`h[o0]me[_-]?te[l1]` (a prefix of alt #5 `h[o0]me[_-]?te[l1]eph[o0]ne`), producing 8
alternatives. **Action:** removed the trailing duplicate alt → 7 alternatives (still
≥ 6, satisfying `tests/bankFields.test.mjs:147` `countAlternatives(...) >= 6` for every
application field).

### 4. `"30 fields"` count claims corrected → `60`
The engine now exposes **60** bank-field patterns (counted `len(BANK_FIELD_PATTERNS)`
= 60), but stale "30" claims survived in 6 sites. **Action (applied):**

| File | Location | Change |
|------|----------|--------|
| `scripts/ocr_spark_engine.py` | L7 header | `30 Typo-Tolerant…` → `60` |
| `scripts/ocr_spark_engine.py` | L147 section comment | `# 30 AUSTRALIAN…` → `# 60` |
| `scripts/ocr_spark_engine.py` | L705 docstring | `all 30…` → `all 60…` |
| `scripts/ocr_spark_engine.py` | L774 comment | `…the 30 fields` → `…the 60 fields` |
| `scripts/ocr_spark_engine.py` | L1077 comment | `30 fields` → `60 fields` |
| `scripts/ocr_spark_engine.py` | L1191 comment | `all 30 columns` → `all 60 columns` |
| `scripts/dgx_setup.sh` | L5 | `30 Australian Banking Fields` → `60` |
| `src/data/scriptComparison.ts` | L59 | `…99 TS vs 30 Python…` → `…vs 60 Python…` |
| `src/components/AuditAndEngineView.tsx` | L196 | `30 Australian banking fields` → `60` |
| `index.html` L10/L12 | description | `30 Australian banking field matchers.` → `60` |
| `metadata.json` | L3 | `30 Australian banking field matchers.` → `60` |

### 5. Stale gx10 host default corrected
`scripts/deploy.sh:15` defaulted `SPARK_IP="${SPARK_IP:-gx10-d0e7.local}"`; the real
host is `gx10.local` / `192.168.4.103`. **Action:** `gx10-d0e7.local` → `gx10.local`
(in `deploy.sh` and the `check_dgx_codebase.sh` / `dgx_setup.sh` comment refs).

### 6. Dead `LOCAL_FALLBACK_DIR` removed
`scripts/deploy.sh:20-21` — `readonly LOCAL_FALLBACK_DIR="${LOCAL_DIR:-/d/Recovered_C/_Raw_Data_and_Databases}"`
is assigned and **never referenced** (confirmed: exactly one occurrence). **Action:**
both the comment and the `readonly` line dropped (indent-tolerant regex removal).

### 7. `scriptComparison.ts` — engine count alignment
Covered by #4 (`99 TypeScript fields vs 30 Python fields` → `60`).

### 8. `AuditAndEngineView.tsx:196` — field count
Covered by #4 (`30 Australian banking fields` → `60`).

### 9. Hard-coded category ranges → data-driven
`src/components/RegexDictionaryView.tsx` (L35-41) and `src/components/MatcherStudio.tsx`
(L231-241) both hard-coded `categories` with stale field-id ranges **and** omitted
categories (`structural` absent; RegexDictionaryView also missing residential/contact/
employment/expenses). **Action:** both rewritten to derive `categories` from
`allFields.map(f => f.category)` with a per-category count, sorted, `all` first.
`MatcherStudio` gained
`import { BANK_FIELD_DEFINITIONS, CORE_IDENTIFIER_DEFINITIONS } from '../data/bankFields';`
and `const allFields = useMemo(() => [...BANK_FIELD_DEFINITIONS, ...CORE_IDENTIFIER_DEFINITIONS], [])`.
`RegexDictionaryView` (which already had `allFields`) gained a `useMemo` import.
No test pins the category labels (per `bankFields.test.mjs`, which scans
`src/data/fields/* + bankFields.ts` only).

### 10. `MatcherStudio.tsx:260` — ` / 33` denominator corrected
`extractBankFieldsFromText` is asserted by `tests/ocrEngine.test.mjs:88` to return
**exactly 99** results (90 app + 9 structural). **Action:** ` / 33` →
` / {extractionResults.length || 99}` (denominates the true 99-field contract).

### 11. bsb matcher aligned to required separator
The Python engine already enforces a mandatory separator
(`scripts/ocr_spark_engine.py:726` `re.findall(r"\b(\d{3}[- ]\d{3})\b", text)`, pinned by
`test_ocr_spark_engine.py:282 test_bsb_regex_requires_an_explicit_separator`). The TS
matcher allowed the separator to be *optional*. **Action:** `src/utils/ocrMatcherEngine.ts:169`
`/\b\d{3}[- ]?\d{3}\b/g` → `/\b\d{3}[- ]\d{3}\b/g` (via line-target on the unique
`text.matchAll` line).

### 12. (re-classified) `ocr_spark_engine.py main()` CLI
argparse **does** accept `--pass-num` (L1231) → `execute_pass_and_verify` writes a
`pass_audit_log` (L1198). So `scripts/deploy.sh` corpus-batch invocation is a valid
CLI mode, distinct from the in-worker `process_document_multipass` (in-memory, no
DuckDB). This matches the `cross-document-duckdb-state` audit entry. **Nothing to fix;**
documented as a deliberate bifurcation (see OWNER #12).

### 13. Stale `__pycache__` bytecode untracked
`scripts/__pycache__/ocr_spark_engine.cpython-310.pyc` and `quick_run.cpython-310.pyc`
were tracked in the index but their source (`quick_run.py`) does not exist. **Action:**
`git rm --cached` both (staged, not committed).

### 14. NGX-Spark / NGX-CORE / PySpark fiction purge
The `ocr_spark_engine.py` filename and `OCR_SPARK_ENGINE_PY` symbol are **real** (they
reference the actual file) and are **kept**; likewise the `Sparkles` lucide icon.
Only *fictional* branding was purged:

| File | Location | Change |
|------|----------|--------|
| `server.ts` | L142 | `service: "ngx-spark-banking-ocr-engine"` → `"ocrdocs-banking-ocr"` (`/api/health`) |
| `server.ts` | L739 | `[NGX-CORE]` → `[OCRD]` (error log) |
| `server.ts` | L796 | `[NGX-CORE] High-Throughput Server…` → `[OCRD]…` |
| `server.ts` | L287-288 | Gemini `defaultSystemInstruction`: dropped "NGX Spark" + "PySpark on NVIDIA DGX/NGX GPU clusters" |
| `server/lifecycle/shutdown.ts` | 11 sites | `[NGX-CORE]` → `[OCRD]` (L51,58,64,70,136,143,159,167,176,201,227) |
| `scripts/ocr_spark_engine.py` | L1230 | argparse description `"NGX Spark Multi-Pass …"` → `"Multi-Pass …"` |
| `scripts/deploy.sh` | L31 | `[NGX-ORCHESTRATOR]` → `[OCRD-DEPLOY]` |
| `index.html` | L9/L11 | `Remix NGX Spark Australian Banking OCR Engine` → `ocrdocs Australian Banking OCR Engine` |
| `index.html` | L10/L12 | `custom-fitted for NGX Spark clusters` → `for NVIDIA DGX (Grace Blackwell) GPU clusters` |
| `metadata.json` | L2 | `Remix NGX Spark…` → `ocrdocs Australian Banking OCR Engine` |
| `src/components/GeminiChatbot.tsx` | L14 | dropped "PySpark"; `DGX/NGX configuration` → `DGX configuration` |
| `src/components/GeminiChatbot.tsx` | L40 | dropped "NGX Spark" + "PySpark"; → `production-grade Regex/OCR code snippets` |
| `src/components/Navbar.tsx` | L65 | `NGX_SPARK // OCR` → `OCRD // OCR` |

> `DGX Spark` (the real NVIDIA Grace-Blackwell host referenced in `dgx_setup.sh` and
> `STATE.md`) and the `SPARK_*` host env-vars are **honest** and left untouched.

---

## Findings — OWNER-only (not applied from the sandbox)

12. **`scripts/deploy.sh` CLI / DuckDB bifurcation.** `deploy.sh:122` invokes the
    engine in corpus-batch CLI mode (`--pass-num`, writes/reads DuckDB `pass_audit_log`);
    the worker path uses `process_document_multipass` (in-memory, no DuckDB). These are
    two distinct entrypoints. **Owner action:** confirm runbook docs bifurcate the two
    modes clearly (current `docs/GX10_DEPLOYMENT.md` notes the split).

13. **`vram-multi-engine-loading` vs `no-hardware-validation` wording.**
    `src/data/scriptComparison.ts:47-56` (`vram-multi-engine-loading`, status:open —
    "never exercised on real GPU") contradicts its sibling `:80-89` (`no-hardware-validation`
    — "PaddleOCR/EasyOCR run for real on DGX GB10; TrOCR also run; Surya untested"),
    mirrored in `src/components/AuditAndEngineView.tsx:127-128`. **Owner signs off** on
    a single consistent statement.

15. **Ingest/UI accept-list subset.** `src/data/ingest_local_folder.mjs:25`
    `ALLOWED_EXTENSIONS` (6 exts) is a subset of `server/middleware/upload.ts` (15 exts),
    also mirrored in `DocumentsView.tsx:37` / `:572` / `:284`. **Owner decides** whether
    ingest/UI should mirror the server's full 15-ext allow-list. (`ingest_local_folder.mjs:82`
    also hard-codes `C:\Users\lnxzf\Desktop\Recovered_c` — dev-box default.)

15b. (covered by 15.)

16. **`package.json` test decomposition gap.** `test:unit` omits `stage2Matrix`,
    `jobLeaseAndHardening`, `reviewEndpoints`; `test:all` never runs them — only the
    catch-all `tests/*.test.mjs` glob does (the 149 count). **Owner:** fold the three
    into `test:unit` or `test:all`.

17. **`App.tsx` status-bar `Promise.all` (L46-70).** A single `.catch` fails both
    `/api/services/status` and `/api/documents` refreshes for that 60 s tick. **Owner:**
    split into independent best-effort refreshes (current behaviour is status-only,
    60 s TTL — defer).

18. **`tests/browser/reviewFlow.test.mjs:101-104`.** Requires `dist/index.html`;
    **skips** (not fails) if absent. CI without a build won't exercise the human-review
    flow. Acceptable; note in CI runbook.

19. **RegexDictionaryView categories alternative.** If the owner prefers the
    *hard-coded ranges* over data-driven, the correct ranges are: identity
    `1-8,15-16,31-40,101-103,109`; residential `9-12,41-48,103`; contact `13-14,49-55`;
    employment `17-20,56-63,101`; income `21-23,64-72`; expenses `24,73-79`;
    assets_liabilities `25,26-28,80-85`; facility `29-30,86-90,102`; structural `104-109`.
    **Data-driven was chosen** (robust to future field additions; tested by no pinned
    labels).

---

## Findings — NOT-DOING (by design / resolved / test-pinned / documented)

- **Confidence-scale "mismatch"** — RESOLVED. Worker posts only `rawText`/`passes`/
  `engineUsed`; `/api/jobs/:id/result` (server.ts:685) re-derives fields via the TS
  matcher and stores `confidence: r.confidence` (0-99 int). The DB `confidence` column
  is **always** the TS-matcher 0-99 int for both the native-PDF path
  (`engineUsed:"native-pdf-text"`) and the worker path. Python 0.0-1.0 confidences are
  internal-only (merge ordering). No storage mismatch. No change.
- **BSB/ABN/postcode/IDR regex false-positives** — `regex-false-positives` audit entry
  (`scriptComparison.ts:69-78`) is **OPEN by design**;
  `test_ocr_spark_engine.test_bsb_regex_still_false_positives_on_a_spaced_abn` **asserts**
  `fields["bsb"] != ""` (an *honest, expected* false-positive). Do **not** "fix" that
  assertion into a passing one — it is a deliberate pin. The L169 bsb tightening in
  #11 *aligns* TS with the Python engine's required-sep rule but does **not** alter the
  Python false-positive pin.
- **`server/queue/eventBus.ts` EventEmitter "durable queue" anti-pattern** — just
  delete (done in #1).
- **`jobRepo.ts:36-54` `reclaimStale`** runs two statements without an explicit
  transaction (TOCTOU under concurrent servers; single-server is safe —
  `jobLeaseAndHardening` uses a single-server 1 s lease / 2 attempts). **Documented as
  LOW robustness**; owner decides whether to wrap in a txn for multi-node HA. No code
  change.
- **stage6/3/4/5/jobLeaseAndHardening/dgxJobEndpoints/reviewEndpoints tests** — these
  PIN `server.ts` structure (e.g. `serverSource.includes('listenAsync')` +
  `'formatListenError'` + `'createShutdownManager'` + `'loadAndValidateEnv'` and
  `!serverSource.includes('httpServer.listen(PORT')`. All edits preserve that contract.
- **`upload.ts` 50 MB cap vs `docs/stage2/format-matrix.json` `maxSizeBytes=26214400`
  (25 MiB)** — intentional, documented; **do not change either** (`stage2Matrix` pins
  `26214400`).
- **`.ui-verify.mjs`** — hard-codes `ui-verify.pdf`, BSB `062-000` → `083-004`, field
  label `Bank State Branch (BSB)`; runs against live `http://localhost:3000`.
  Owner-side E2E harness.
- **NGX-Spark "torch<2.5 gate"** — GREP confirms the engine has **no** explicit
  torch-version check. Disablement is purely `OCRDOCS_ENABLE_RESEARCH_ENGINES` (default
  `false` → Surya off) + `OCRDOCS_ENABLE_HANDWRITING_ENGINE` (default `false` → TrOCR
  off) + missing optional deps (spacy/striprtf/EasyOCR/PaddleOCR absent locally →
  `ImportError`→`None`). `torch` is a hard import (L34) but is present (2.4.1);
  `import multiprocessing as mp` (L38) + `mp.set_start_method("spawn")` (L1236).
  No code change; recorded for honesty in the findings.
- **`bankFields.ts:395` bsb `maxToleranceRegex`** (the `[- ]?` here) — **intentionally
  left as-is.** It is **bypassed** by the dedicated `if (field.id==='bsb')` branch in
  `ocrMatcherEngine.ts:168`, which consults the hardcoded regex at L169 (now tightened
  to `[- ]`). Editing the `maxToleranceRegex` string literal would be cosmetic only and
  risks a backslash-escaping error in a regex-string context; the *effective* enforcement
  is at L169, which is aligned 1:1 with the Python engine (`L726`) and test-pinned. The
  Python false-positive assertion remains honest.
</div>

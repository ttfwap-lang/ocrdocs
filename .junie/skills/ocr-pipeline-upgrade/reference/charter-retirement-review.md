# Charter-Retirement & Gated-Code Review Catalog

Generated during Phase 1 analysis. Every file that matched **charter**, **PROJECT_CHARTER**,
**gated**, **55** (stage-context), **proof**, or **authori**, with false-positive disambiguation
and a per-file recommendation.

> Legend: **DELETE** = dead scaffolding, no active value once PROJECT_CHARTER.md is gone.
> **REWRITE** = file has real value but is deeply coupled (>1 charter ref); a clean rewrite
> decouples it. **SURGICAL** = small, safe, targeted edit that removes the charter coupling
> without rewriting the file. **IGNORE** = benign / legitimate use (not charter).

## How the false positives were excluded

The following `55` / "authori" / "proof" / "gated" matches are **legitimate** and were
**NOT** treated as charter content:

| File | Why it is a false positive |
|------|----------------------------|
| `server.ts`, `server/middleware/auth.ts` | `authorization` header parsing (security auth, not charter authority) |
| `src/utils/ocrMatcherEngine.ts`, `src/utils/australianValidationUtility.ts` | `Authorized Financial Institution` / APRA ADI lookups |
| `src/data/fields/incomeExtendedFields.ts`, `residentialExtendedFields.ts` | `proof of income` / `proof of address` field descriptions |
| `src/components/*`, `src/data/sampleDocuments.ts`, `tests/ocrEngine.test.mjs` | coincidental `55` (port `65535`, ABN `51 824 753 556`, CSS color) |
| `scripts/ocr_spark_engine.py` | `gated purely for operational reasons` / `license-gated` (Surya/TrOCR opt-in) — **legit engine gating** |
| `tests/stage5Dependencies.test.mjs:257` | `Proof that Guards Bite` — a negative-mutation test name (legit) |
| `package-lock.json`, `bun.lock`, `.idea/workspace.xml`, `data/app.db` | sha512 integrity hashes / UUIDs / VCS deleted-file record (metadata) |
| `server/config/env.ts`, `scripts/true-e2e-loop.ps1`, `scripts/autonomy/start.ps1`, `scripts/autonomy/host.mjs` | `ValidateRange(1, 55)` / `endStage: 55` (stage count) and port `65535` — see below under autonomy |

---

## Category 1 — The two test files that CRASH the suite (block stable build)

| File | Charter refs | Status today | Recommendation | Reason |
|------|--------------|--------------|----------------|--------|
| `tests/stages.test.mjs` | 56 | **CRASH** (exit 1; `ENOENT` on `PROJECT_CHARTER.md` at `loadCharterStages`) — 27 tests blocked | **DELETE or stub-to-skip** | 22 of 27 tests read `PROJECT_CHARTER.md` or `docs/stages/*`. The 5 "negative mutation" tests (lines 222–387) are pure synthetic and PASS — they test charter-parser invariants. If the parser is deleted, these 5 die too. |
| `tests/autonomy.test.mjs` | 8 | **CRASH** (exit 1; top-level await `readFile('PROJECT_CHARTER.md')` at L7) — 17 tests blocked | **SURGICAL** | Most tests exercise the genuinely useful runner harness (`runProcess`, `redact`, `options`, subprocess tests). Only the charter-fixture tests (which write `PROJECT_CHARTER.md` into a temp sandbox) need stubbing. Keep 10 pure tests; skip the 7 charter-fixture ones. |

> `tests/stage2Matrix.test.mjs` (2 refs, PASS 5/5) — only cosmetic mentions in a **comment**
> (`MAX_SIZE_BYTES = 26214400; // ... from PROJECT_CHARTER.md`) and a **test name**
> (`within charter limits`). Does NOT import any charter script. → **SURGICAL** (reword).

---

## Category 2 — Dead charter methodology scripts (delete cluster)

Import graph: `charter-parser` ← `build-index` ← `refine-downstream`; `generate-dossiers` ← `stage-specs-group{1,2,3}`; `stage2/generate-matrix` ← `build-index`. `tests/stages.test.mjs` imports all of the above.

| File | Charter refs | Active importers (besides the dead tests) | Recommendation | Reason |
|------|--------------|-------------------------------------------|----------------|--------|
| `scripts/stages/charter-parser.mjs` | 16 | none outside stages.test.mjs | **DELETE** (or stub to no-op) | Pure parser over the deleted master file. No runtime/test caller once stages.test.mjs is stubbed. |
| `scripts/stages/build-index.mjs` | 12 | none (only stages.test.mjs imports it) | **DELETE** | Builds `docs/stages/README.md` index from the 55 dossiers. |
| `scripts/stages/generate-dossiers.mjs` | 10 | none | **DELETE** | Generates 55 stage dossiers from specs. |
| `scripts/stages/refine-downstream.mjs` | 47 | only stages.test.mjs (lines 26, 31, 209, 217) — `inspectSourceFile`/`refineDownstreamContent`/`refineDownstream` | **DELETE** | Largest coupling. `inspectSourceFile` (the entity-extracting static-analysis helper) has standalone value (~44 lines, pure function). Could be **REWROKEN** as `scripts/stages/inspect-source.mjs` if kept. |
| `scripts/stages/stage-specs-group1.mjs` | 19 | `generate-dossiers` (and probably build-index) | **DELETE** | Data tables for the 55-stage plan. |
| `scripts/stages/stage-specs-group2.mjs` | 19 | `generate-dossiers` | **DELETE** | Data tables. |
| `scripts/stages/stage-specs-group3.mjs` | 48 | `generate-dossiers` / `refine-downstream` | **DELETE** | Largest data table (48 refs). |
| `scripts/stage2/generate-matrix.mjs` | 3 | `build-index` (imports `generateMatrixContent`) | **DELETE or REWRITE** | Generates `docs/stage2/format-matrix.json`. If `docs/stage2/format-matrix.json` is kept for OCR triage, this generator is orphaned and can go. |

---

## Category 3 — Autonomy harness (charter-coupled but genuinely useful)

These power a real, tested "autonomous agent loop with journals / stop files / pivots"
test double (used by `jobLeaseAndHardening.test.mjs` patterns). Decoupling (not deleting)
preserves the value. Each couples to the 55-stage charter in multiple places → **SURGICAL**
(coordinated refactor, not per-file rewrite).

| File | Charter refs | Crash without charter? | Recommendation | Notes |
|------|--------------|------------------------|----------------|-------|
| `scripts/autonomy/runner.mjs` | 10 | No (roadmap() called at runtime, not import) — `autonomyHost.test.mjs` PASS 6/6 | **SURGICAL** | `roadmap()` reads `PROJECT_CHARTER.md`; `roots` set + `protectedFile()` hardcode `'PROJECT_CHARTER.md'`; `startStage/endStage` 1–55. Decouple: accept stages from a lean manifest or parametrize `roadmap(text)`; remove the file from `roots`/`protectedFile`. |
| `tests/autonomyHost.test.mjs` | 0 charter (only stage-range `55` coincidental? actually PASS) | no | **IGNORE** | Passes 6/6 unchanged. |
| `scripts/autonomy/start.ps1` | 1 (`ValidateRange(1,55)`) | n/a (script) | **SURGICAL** | Parametrize `$MaxStage`. |
| `scripts/autonomy/host.mjs` | 1 (`endStage: 55`) | n/a | **SURGICAL** | Parametrize. |
| `scripts/true-e2e-loop.ps1` | 1 (`ValidateRange(1,55)`) | n/a | **SURGICAL** | Parametrize. |

---

## Category 4 — Documentation (narrative history of the charter)

| File / glob | Charter refs (approx) | Recommendation | Reason |
|-------------|----------------------|----------------|--------|
| `docs/stages/stage-01..stage-55` (55 dossiers) + `_TEMPLATE.md` + `README.md` + `PROGRESS_AUDIT.md` | high | **DELETE** (retired methodology) | The 55-stage delivery plan; the master `PROJECT_CHARTER.md` is deleted. Git retains history. |
| `docs/stage2/format-matrix.json`, `docs/stage2/workflow-outcomes.json` | medium | **REWRITE** (keep if used by triage doc) | Stage-2 OCR format artifacts — useful OCR content; strip charter framing. |
| `docs/stage3/authoritative-contracts.md`, `component-topology.md`, `failure-state-machine.json` | high | **REWRITE → fold into `docs/OCR_MULTI_PASS_PIPELINE.md`** | Architecture artifacts with real OCR content; retire stage framing, keep the substance. |
| `docs/stage5/dependency-policy.md` | high | **REWRITE or DELETE** | Charter stage-5 dependency policy. |
| `docs/ACCEPTANCE_REGISTER.md` | high | **REWRITE** | Map of promises→evidence; rewrite as the real 4-phase verification register. |
| `docs/AUTONOMY.md` | high | **REWRITE** | Autonomy harness docs; strip charter-stage narrative, keep the harness description. |
| `docs/OCR_TRIAGE_PLAN.md` | high | **REWRITE → fold into multi-pass pipeline doc** | OCR triage; real content, charter-framed. |
| `STATE.md` | high (the 2026-09-16 completion-declaration audit) | **REWRITE** | Rich history; rewrite to record the charter RETIREMENT honestly (no fabricated completion). |
| `RULES.md` | 3 explicit charter lines (5, 12, 35) | **SURGICAL + REWRITE** | Replace the 55-stage loop framing with the 4-phase OCR-upg
rade cycle; keep the 5-phase recovery rules' spirit. |
| `README.md` | 0 (clean) | **IGNORE** | Already charter-free. (Phase 4 may still extend it.) |

> `RULES.md:34` mentions `Recovered_C` (capital) as a concept — this maps to the
> `recovered_c/` folder required for Phase 3.

---

## Category 5 — Weak / incomplete code ("gated code") worth flagging

| File | Issue | Charter? | Recommendation |
|------|-------|----------|----------------|
| `server.ts:294` | `model: "gemini-3.8-flash"` — **fabricated** Gemini model id (real: 1.5/2.0/2.5) | No (weak code) | **SURGICAL**: change to `gemini-2.5-flash` (or env-configurable). No test covers the chat route, so safe. |
| `scripts/ocr_spark_engine.py` `.docx` branch | lazy `import docx` (python-docx); in requirements but may be absent in env | No | **SURGICAL**: ensure missing-package path returns `PARSE_ERROR` cleanly (already wrapped in try/except — verify). |
| `scripts/ocr_spark_engine.py` `.rtf` branch | lazy `from striprf... import rtf_to_text`; in requirements | No | **SURGICAL**: same graceful-degradation check as `.docx`. |
| `scripts/ocr_spark_engine.py` Tesseract conf | per-line confidence now derived from word output (fix from flat 0.82) | No | **IGNORE** (already corrected per prior log) |
| `scripts/ocr_spark_engine.py` deskew | `deskew_image` rotated directly, NOT negated (bug fixed) | No | **IGNORE** (already corrected; regression test pins it) |

---

## Summary recommendation (proposed default plan)

1. **Phase 1 stable-build unblock** (SURGICAL, immediate, verifiable):
   - `tests/autonomy.test.mjs`: guard the top-level `PROJECT_CHARTER.md` read; skip the 7 charter-fixture tests; keep the 10 pure runner tests active.
   - `tests/stages.test.mjs`: guard `loadCharterStages()` / the sandbox copy so the suite **skips** (not crashes) when the charter is absent; keep the 5 pure negative-mutation tests active.
   - `tests/stage2Matrix.test.mjs`: reword the 2 cosmetic charter mentions (comment + test name).
   - `scripts/autonomy/runner.mjs`: make `roadmap()`/`roots`/`protectedFile()` degrade when `PROJECT_CHARTER.md` is absent (so `autonomyHost.test.mjs` keeps passing and the harness is usable).
2. **Charter methodology retire** (DELETE): `scripts/stages/*` (charter-parser, build-index,
   generate-dossiers, refine-downstream, stage-specs-group1/2/3), `scripts/stage2/generate-matrix.mjs`
   (if `docs/stage2/format-matrix.json` is retired or inlined). `refine-downstream.mjs`'s
   `inspectSourceFile` can be extracted first if the caller wants to keep it.
3. **Docs** (Phase 4): rewrite README/STATE/RULES/OCR_TRIAGE_PLAN/AUTONOMY/ACCEPTANCE_REGISTER;
   delete `docs/stages/*`.
4. **Weak code**: fix `gemini-3.8-flash` → real model; confirm docx/rtf graceful degradation.

> Decision gate: DELETE of the 55 stage dossiers + scripts/stages/* is the biggest
> irreversible move. Everything else is reversible. Awaiting go-ahead on the DELETE set.

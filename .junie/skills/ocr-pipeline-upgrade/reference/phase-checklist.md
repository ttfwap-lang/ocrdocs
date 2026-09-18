# Phase Exit Checklist

Exact gate criteria per phase. Read before declaring any phase complete.

## Phase 1 -- stable charter-free build  [x DONE]

- [x] `npx tsc --noEmit` exits 0.
- [x] Charter methodology **deleted** (not stubbed) per owner "completely remove" directive: `scripts/stages/*`, `scripts/stage2/generate-matrix.mjs`, `docs/stages/*` removed.
- [x] Charter-staged autonomy harness deleted: `scripts/autonomy/*`, `scripts/true-e2e-loop.ps1`, `tests/autonomy*.mjs`; stale `.junie/skills/autonomy-core` + `.junie/skills/true-e2e` skills removed.
- [x] Charter-only tests removed; `package.json` scripts `test:governance`+`autonomy` pruned and `stage7TestIntegrity` script-contract guard updated (dropped retired `test:governance` requirement).
- [x] `git grep -i "charter|PROJECT_CHARTER"` over active code (`server.ts`, `src/**`, `tests/**`, `scripts/**/*.mjs/.py/.sh/.ps1`) = 0 hits. Residual `charter` word lives only in Phase-4 docs (`docs/stage{2,3,5}/*`, `AUTONOMY.md`, `ACCEPTANCE_REGISTER.md`, `OCR_TRIAGE_PLAN.md`) and `STATE.md` history.
- [x] `node --test tests/*.test.mjs` -> 149 pass / 0 fail / 0 skip (no hard crashes).
- [x] Operational `DGX_WORKER_TOKEN` bearer auth retained on `/api/jobs/*` + `/api/dgx/*`.
## Phase 2 — OCR coverage + gx10 migration

- [ ] Coverage matrix in `docs/OCR_SUPPORTED_FORMATS.md` reconciles every engine type
      with the upload filter (aligned / ADD / STUB / EXCLUDED + reason).
- [ ] `ssh root@gx10.local "nvidia-smi --query-gpu=name --format=csv,noheader"` returns
      a GPU name.
- [ ] `check_dgx_codebase.sh` runs on gx10 and the server's
      `GET /api/dgx/telemetry-report` stores a bounded report (unknown keys dropped,
      errorLog truncated, `< 9000` chars).
- [ ] E2E round-trip: upload PDF → claim (gx10) → fetch file → multipass → POST result
      → `GET /api/documents/:id` shows `engine_used` = multi-pass ensemble and a
      non-empty `extraction` with `extraction_version` incremented.
- [ ] `GET /api/health` shows `ng: spark-banking-ocr-engine`; `dgx_worker` = live.

## Phase 3 — 8 file-type validation

- [ ] `recovered_c/` contains 8 distinct file types (PDF text, PDF scanned, PNG, JPG,
      TIFF, DOCX, TXT, XML — or approved equivalent set of 8).
- [ ] Each file: upload → claim → process (multipass) → result POST → `status 201`.
- [ ] Each result: non-empty `extraction.fields`, ≥1 validated identifier
      (ABN/BSB/DOB), `passes.length >= 2`.
- [ ] Report at `automation/runs/phase-3-ocr-validation.json` lists all 8 types green.
- [ ] No real customer PII in fixtures; all generator text is synthetic.

## Phase 4 — documentation

- [ ] `docs/OCR_MULTI_PASS_PIPELINE.md` exists and documents passes 1–10, the monotonic
      quality invariant, early-stop, engines + license gates, and confidence semantics.
- [ ] `docs/OCR_SUPPORTED_FORMATS.md` exists and matches the Phase 2 matrix.
- [ ] `README.md` rewritten: architecture diagram, gx10 worker, multi-pass pipeline,
      run instructions — no charter narrative.
- [ ] `STATE.md` + `RULES.md` updated: charter references removed/replaced.
- [ ] `grep -rni charter` over active source (`server.ts`, `src/**`, `tests/**`,
      `scripts/**`) returns only deliberate "retired" stubs or zero matches.

# Progress audit — charter claims versus verified reality

Reconciled: **2026-09-14** (local). Author: orchestrating agent. Method: read-only recon over
six disjoint layers plus a fresh repository-gate run. Every status below is backed either by a
command with an exit code, a `file:line` fact, or an explicitly named missing artifact. Where
evidence does not exist, this file says so instead of inferring progress.

This document is the **seed of record** for the per-stage dossiers in this directory: a
dossier's initial `status` must match the row for its stage here.

---

## 1. Verified baseline

| Check | Command | Result |
|---|---|---|
| Repository gate (concurrent) | `powershell -ExecutionPolicy Bypass -File .junie\skills\max-throughput\scripts\verify-gate.ps1` | `RESULT=gate-pass` — lint **PASS** exit 0 (2.2 s), test **PASS** exit 0 (4.2 s), build **PASS** exit 0 (4.2 s); wall clock 4.2 s vs 10.6 s serial-equivalent; evidence under `%TEMP%\ocrdocs-verify-gate\20260914-064129` |
| Test suite alone | `npm test` | `tests 30 / pass 30 / fail 0 / cancelled 0 / skipped 0 / todo 0`, duration 3245 ms, exit 0 |
| Charter parse | `grep ^### Stage \d+ — ` over `PROJECT_CHARTER.md` | exactly **55** stage headings, lines 45–207, heading at line `42 + 3N`, gate paragraph at `43 + 3N`; no gaps, no duplicates |
| Working tree | `git status --short` | modified `.gitignore`, `STATE.md`, `docs/AUTONOMY.md`; staged `qodana.yaml`; untracked `.idea/vcs.xml`, `.junie/`, `scripts/github/*.ps1`. 67 tracked files, 2 commits (`1f410aa`, `3c1b60d`) |

### What the green gate does **not** prove

`npm test` is `node --test --test-timeout=30000 tests/*.test.mjs`, and `tests/` contains only
`autonomy.test.mjs` (24 cases) and `autonomyHost.test.mjs` (6 cases). Neither file imports
anything from `src/` or `server/` (`tests/autonomy.test.mjs:6`, `tests/autonomyHost.test.mjs:6`).

- **Application test coverage is zero.** No test starts the server, exercises a route, touches
  a database, performs OCR, or renders a component. Subjects with no coverage at all: OCR,
  persistence, authentication/authorization, upload, review workflow, export, end-to-end
  workflow, HTTP/SSE routes, React UI, Australian formatting rules.
- `docs/AUTONOMY.md:60` already concedes in writing that the suite does not establish OCR
  accuracy, production security or application completion.
- The gate also runs the type-check in **non-strict** mode: `tsconfig.json` never enables
  `strict`, so `npm run lint` (`tsc --noEmit`) is a weaker signal than its name suggests.

---

## 2. Corrections to previously recorded claims

Four statements carried into this task's plan and/or `STATE.md` are false against the live
tree. They are corrected here rather than repeated.

| Previously claimed | Verified reality | Evidence |
|---|---|---|
| `automation/` is empty — no checkpoint, promotion journal, lock or STOP; Stage 2 failure evidence lost | **False.** 294 entries present, including the blocked checkpoint, the owner STOP token, the host handoff files and all four Stage 2 pivot run directories with their candidate trees | §3 below; `automation/checkpoint.json`, `automation/STOP`, `automation/runs/stage-2-pivot-{0,1,2,3}` |
| The `true-e2e` skill bundle is missing four files, so its published commands cannot run | **False.** `.junie/skills/true-e2e/` contains `SKILL.md` plus all five bundled files: `checklists/stage-exit.md`, `reference/halt-resume.md`, `reference/stage-cycle.md`, `templates/stage-ledger.md`, `scripts/true-e2e-loop.ps1` (17,466 B) | directory listing; `STATE.md:93` records the addition and its sandbox verification at 2026-09-14T05:30Z |
| `docs/ACCEPTANCE_REGISTER.md` has 17 promise rows | **16 rows** (`docs/ACCEPTANCE_REGISTER.md:7-22`); every one reads *Unverified / Not implemented / Target only / Pending / Required, not verified* | direct count |
| "20 tests pass" as Stage 1 evidence (`STATE.md:19`) | **30 tests pass.** The count used as evidence is stale, though the direction of the claim is unchanged | `npm test` output above |

The first two corrections matter beyond bookkeeping: the loop **does** have state to resume
from, and the supervisor it resumes with **does** exist. Neither needed re-creating.

---

## 3. Control state — what the automation layer actually holds

| Artifact | Present | Content / meaning |
|---|---|---|
| `automation/checkpoint.json` | yes (250 B) | `nextStage: 2`, `completed: []`, `attempt: 2`, `pivots: 3`, `status: "blocked"`, `failure: {key: "install", consecutive: 1, message: "Stop requested"}`, `blocker: "Stop requested"`, `deadline: 1789521115004` |
| `automation/STOP` | yes (64 B) | `Verified controller handoff fb916d6f-…` — a host-written boundary stop token, not a user STOP |
| `automation/promotion.json` | **no** | no pending promotion journal → nothing to roll forward, no partially promoted candidate |
| `automation/runner.lock` | **no** | no live runner, no stale lock to reclaim |
| `automation/host-handoff.json` | yes (1115 B) | `phase: "prepared"`, the original `deadline`, the STOP token, and sha256 fingerprints of all 9 controller files |
| `automation/host-status.json` | yes (115 B) | `phase: "blocked"`, `details: "Host verification failed: test"`, `updatedAt: 2026-09-13T01:54:57.993Z` |
| `automation/host-verify-test.json` | yes (631 B) | the failing host pre-flight gate record from that attempt |
| `automation/runs/stage-2-pivot-{0,1,2,3}/**` | yes | per-attempt evidence: `baseline.json` snapshots, candidate trees, `attempt-N-1-plan.json` records |
| `automation/runs/stage-2-pivot-3/candidate/.autonomy/plan.json` | yes (17,292 B) | the full abandoned Stage 2 plan — **not lost** |
| `automation/runs/stage-2-pivot-3/candidate/.autonomy/failure.json` | yes (111 B) | `{key: "install", consecutive: 1, message: "Stop requested", attempt: 2}` |
| `automation/true-e2e/ledger.md` | **no** | the `true-e2e` run ledger has never been opened → no window has ever been launched by the supervisor |
| `automation/RENEW` | **no** | no deadline-renewal token present (none is needed yet, see below) |

**Deadline:** `1789521115004` ms ≈ **2026-09-16T01:11:55Z**, i.e. still in the future at the
time of this audit. The 72-hour window that started 2026-09-13T01:11:55Z has **not** expired,
so a resumed window does not require an `automation/RENEW` token today.

**Two halt reasons, one of them stale.** `host-status.json` blocked on
`Host verification failed: test` on 2026-09-13. The accepted-source suite now passes 30/30
(exit 0), so that particular blocker no longer reproduces against accepted source. The
**operative** halt is the combination of `automation/STOP` and the `blocked` checkpoint, which
per `true-e2e` §4 is honoured absolutely: the STOP file is reported, never removed by
automation. Resuming is an owner action.

**Durability caveat:** `.gitignore:9` ignores `automation/`, so none of the above is in the
repository. It exists on this host only; a clean clone starts with no control state and no
Stage 2 evidence.

---

## 4. Stage-by-stage verified status

Status vocabulary: `complete` · `in-progress` · `deferred` · `blocked-external` · `not-started`.
`not-started` means **no engineering artifact exists for this stage** — not that it is
unimportant. Where the evidence column names code that already exists, that is what the stage
will have to correct or build on; it is never evidence of the stage passing.

| # | Stage (charter lines) | Status | Evidence, or the exact reason it is unevidenced |
|---|---|---|---|
| 1 | Commercial release contract (45–46) | **complete — documentation only** | `PROJECT_CHARTER.md` (212 lines, 55 stages), `RULES.md` (34 lines), `docs/ACCEPTANCE_REGISTER.md` (16 promise rows, `:7-22`). Every promise maps to a named check or a named external approval; all 16 rows are still unverified. This stage certifies the contract, not the product. |
| 2 | Document/workflow matrix (48–49) | **deferred** | Attempted 4× across 4 pivots, never accepted — full chain in §5. Artefact preserved at `automation/runs/stage-2-pivot-3/candidate/.autonomy/plan.json` (17,292 B). No matrix file exists in the tracked tree; `docs/stage2/` was never created. |
| 3 | Architecture and failure model (51–52) | not-started | No architecture or failure-transition document exists. `docs/` holds only `ACCEPTANCE_REGISTER.md` and `AUTONOMY.md`. Charter §"Master architecture" states intent; nothing records actual components, contracts or failure transitions. |
| 4 | Truthful demonstration/live separation (54–55) | not-started | The opposite is currently true and measurable: `server.ts:111-158` (Drive from fixtures), `server.ts:169-331` + `:264` (fabricated pass ledger with `Math.random()` durations), `server/services/multipassOcr.ts:21,32,43` (`setTimeout` provider stubs), `server.ts:41` (hardcoded `"ok"` health), `src/components/GoogleDriveHub.tsx:66` (success text emitted from the `catch` branch), `src/components/SuperStackResearchView.tsx:38,96` (timer-faked "10/10, 0.00% regression"), `MultiPassRegressionView.tsx:137,205` (static "SHA-256 Verified" / "APRA Checksums 100% Valid"), `src/App.tsx:63` (unconditional "CLUSTER.ONLINE"), `src/data/researchPasses.ts` (all 10 passes hardcode `VERIFIED_ZERO_REGRESSION`). |
| 5 | Reproducible dependencies (57–58) | not-started | All 20 `package.json` dependencies are `^` ranges (`:15-36`); no `package-lock.json` while npm is the declared gate; the only lockfile is `bun.lock`, already drifted (`bun.lock:508` react 19.3.0 vs `^19.0.1`); no `engines`, `packageManager`, `.nvmrc` or Dockerfile; no Python `requirements.txt`/constraints anywhere — `scripts/dgx_setup.sh:70-72` installs 14 packages unpinned; no licence/SBOM artifact. |
| 6 | Build and startup corrections (60–61) | not-started | `npm run lint` and `npm run build` pass (exit 0) but that is the *current* baseline, not this stage: no port configuration, readiness probe or SIGTERM/SIGINT handling exists (`package.json:9` is the only production entry); `vite.config.ts:14` defines no dev proxy, so every `/api/*` call 404s under `npm run dev`; dead mutator scripts `patch.js`, `patch2.cjs`, `patch3.cjs`, `patch4.cjs`, `patch_client.cjs` still sit in the root. |
| 7 | Trustworthy automated checks (63–64) | not-started | One undifferentiated suite; no unit/integration/worker/browser/deployment separation; no seeded-failure or timeout-effectiveness check. Gate-integrity defects found: `scripts/autonomy/runner.mjs:324-327` accepts candidate-declared `report.checks` (program-name allowlist only), `runner.mjs:10` protects only `tests/autonomy*.test.mjs` so app tests are candidate-writable with no fail-before-fix enforcement, `runner.mjs:286` classifies permanent failure by regex over command output. Positive: `runner.mjs:85-89` rejects changes to the `lint`/`build`/`test` scripts (tested at `tests/autonomy.test.mjs:118-120`). |
| 8 | Governed evaluation corpus (66–67) | not-started + **external gate** | No provenance, permission, licence, label-quality, reviewer or corpus-version field exists anywhere in `src/data/**` (`src/data/gdriveDocuments.ts:18-23`); no fixture carries an expected-output/ground-truth field, so there is no baseline to measure against. External gate: permitted representative documents. |
| 9 | Extraction reproductions and boundaries (69–70) | not-started | Real extraction logic exists (`src/utils/ocrMatcherEngine.ts:31`) and real AU validators exist (`src/utils/australianValidationUtility.ts:94,223,306,372`), but **no test file covers either**. No fixed-clock handling, no leading-zero or wrong-applicant reproduction. |
| 10 | Correct extraction defects (72–73) | not-started | Depends on Stage 9 reproductions, which do not exist. Known candidates already visible: `src/data/gdriveDocuments.ts:58-64` uses 6 `extractedFields` keys with no matching definition — including `account_number`, which the "30-field" catalogue does not cover. |
| 11 | Versioned result contracts (75–76) | not-started | `src/types.ts` declares no applicant/document/version identity and no review state; the Python side emits an 8-key unversioned pass summary (`scripts/ocr_spark_engine.py:680-689`, printed `:726`) with no page text, coordinates, engine/model version or timings. |
| 12 | Transactional application storage (78–79) | not-started | No database, driver, schema, migration or transaction anywhere in `server.ts`/`server/**`. The only state is two module-level variables (`server.ts:66-67`), lost entirely on restart. |
| 13 | Persistence invariants (81–82) | not-started | Nothing to test — see Stage 12. |
| 14 | Authentication and authorization (84–85) | not-started | No authentication, session, role or ownership middleware exists; every route is anonymous. Unprotected read surfaces today: `GET /api/scripts/:scriptName` (`server.ts:46`, serves repository source) and `GET /api/dgx/telemetry-report` (`server.ts:95`, host diagnostics). `POST /api/chat` (`server.ts:335`) is an unauthenticated proxy over the server-side API key. No login UI exists anywhere in `src/**`. |
| 15 | Private original storage (87–88) | not-started | No original is ever stored: no upload path, no generated keys, no server-computed integrity hashes (fixture `checksumSha256` strings only), no private delivery route. |
| 16 | Untrusted upload handling (90–91) | not-started | No multipart handling and no upload route; `POST /api/process-document` (`server.ts:378`) accepts only `req.body.text` under a 10 MB JSON cap (`server.ts:12`). The charter's 25 MiB / 50-page limits are enforced nowhere. |
| 17 | Page-level native extraction/routing (93–94) | not-started | `scripts/quick_run.py:86-88` is native PyMuPDF text only with no raster fallback; `scripts/ocr_spark_engine.py:373` flattens all text through a `set`, so page order and page boundaries are lost; `:496` rasterises whenever `pass_num > 1` regardless of usable native text. |
| 18 | Real qualified OCR (96–97) | not-started | Real local engines are called (`ocr_spark_engine.py:330-367` — Tesseract, PaddleOCR, EasyOCR, Surya) but all four are optional imports that degrade to *no text* (`:39-59`), every call is wrapped in a bare `except`, bounding boxes are discarded (`:347`, `:365`), and reported "confidences" are hardcoded literals (`:399`, `:449`). No engine is qualified, ranked or measured, and the server never invokes the worker (`server.ts:48` serves the script as downloadable text only). |
| 19 | Durable job transitions (99–100) | not-started | No job table, claim, lease, attempt or commit rule. `server/queue/eventBus.ts:10` is an `EventEmitter` imported at `server.ts:15` and **never emitted to or subscribed from** — there is no eventing at all, durable or otherwise. `jobId` is `Date.now()` (`server.ts:383`). |
| 20 | Integrated vertical slice (102–103) | not-started | No path exists from bytes to a persisted result: no upload, no storage, no database, no worker invocation. The only end-to-end flow is text-in → regex-out over SSE (`server.ts:378-419`). |
| 21 | Immutable extraction evidence (105–106) | not-started | Nothing is persisted, so nothing is traceable; no page/text/coordinate evidence, no matcher/model version, no candidate provenance. |
| 22 | Genuine progress/error streaming (108–109) | not-started | `server.ts:427` "Initialize High-Throughput WebSocket Data Plane" is a bare comment — no WebSocket server exists. `/api/process-document` emits SSE around simulated sleeps; `MultiPassRegressionView.tsx:47` awaits one POST and `:55` swallows errors to the console with no user-visible error state. |
| 23 | Refresh/reconnect recovery (111–112) | not-started | `src/App.tsx:21` keeps tab state in `useState` only — no router, no URL/hash, no storage; a refresh discards all work. No job id, no polling, no reconnect. |
| 24 | Bounded retries/deadlines/cancellation (114–115) | not-started | No retry classification, backoff, budget or cancellation path in the application (the bounded-retry machinery that does exist belongs to the autonomy runner, not the product). |
| 25 | Combined fault sequences (117–118) | not-started | Prerequisites (jobs, storage, commits) do not exist, so there is nothing whose crash-plus-restart behaviour could be tested. |
| 26 | Real document/result interface (120–121) | not-started | Every view renders from compiled-in fixtures under `src/data/**`; no list/history/version/preview/search/filter/pagination reads from a server. `MatcherStudio.tsx:180` silently falls back to in-browser recomputation on stream error, making server and local output indistinguishable to the user. |
| 27 | Controlled human review (123–124) | not-started | No editable extracted value, no approve/reject/override/sign-off control, no reviewer identity, no optimistic concurrency — anywhere in `src/**`. |
| 28 | Safe consistent exports (126–127) | not-started | The only export is client-side: `MatcherStudio.tsx:250` builds CSV from in-memory results via `Blob` + `link.click()`, with unquoted columns (embedded commas corrupt rows) and no authorization check or versioned snapshot. |
| 29 | Real constrained Drive authorization (129–130) | not-started + **external gate** | No Drive client, no OAuth, no token handling, no credential source; the folder id is hardcoded (`server.ts:145`, also `src/data/gdriveDocuments.ts:8-16`, `src/data/dgxScripts.ts:20,113,189,190`, `scripts/ocr_spark_engine.py:78`, `scripts/deploy.sh:17`). External gate: Drive credentials + folder authorization. |
| 30 | Resumable incremental Drive sync (132–133) | not-started + **external gate** | `POST /api/gdrive/sync` (`server.ts:143`) returns `SYNC_COMPLETE` computed from fixture counts with no remote call; no page token, change token, checkpoint or deletion policy exists. |
| 31 | Evidence-driven extra passes (135–136) | not-started | The "10-pass" system is fabricated on both sides: `server.ts:169-331` scripts the ledger (hardcoded field deltas `:203-243`, `monotonicPreservationActive: true` `:324`, fallback recall `98.4` `:327`) and `src/data/researchPasses.ts` hardcodes `VERIFIED_ZERO_REGRESSION` for all 10 passes. No eligibility, budget, stopping rule or immutable pass history exists. |
| 32 | Defined operational metrics (138–139) | not-started | `GET /api/health` (`server.ts:41`) returns a constant literal decoupled from every dependency; no documents/pages/jobs/attempts/retries distinction, no denominators, no structured logging or tracing. |
| 33 | Controlled overload and quotas (141–142) | not-started | No rate limit, quota, queue bound, worker bound or backpressure; the only limit is the 10 MB JSON body cap (`server.ts:12`). |
| 34 | Full data lifecycle (144–145) | not-started | No retention or deletion rule for originals/text/previews/results/reviews/exports/caches/temp/logs/backups; nothing is stored to have a lifecycle, while `scripts/ocr_spark_engine.py:645-647` writes the full identity/financial field set to unencrypted CSV/Parquet/DuckDB with no retention control. |
| 35 | Pre-pilot security closure (147–148) | not-started + **external gate** | No threat model. Already-visible issues for it to close: anonymous source-file read (`server.ts:46`), unauthenticated key proxy (`server.ts:335`), client hostname/username/IP accepted and printed to stdout (`server.ts:69-93`, `:75`, `:80`), `StrictHostKeyChecking=no` on every remote copy (`scripts/deploy.sh:24`), unauthenticated host-inventory upload including file names and code snippets (`scripts/check_dgx_codebase.sh:247`), and a documented curl-piped-to-shell install path (`scripts/dgx_audit_report.sh:7`). |
| 36 | Reproducible quality benchmark (150–151) | not-started + **external gate** | No metric definitions, no denominators, no ground truth: `src/data/bankFields.ts` carries regex/type/category but no criticality and no normalisation rule, and no fixture has an expected-output field. External gate: permitted representative documents with reviewed labels. |
| 37 | Development-only quality improvement (153–154) | not-started + **external gate** | Cannot start before Stage 36 defines measurement; there is no development/held-out split to protect. |
| 38 | Full workflow and test-effectiveness checks (156–157) | not-started | No browser, worker or database test exists; zero application coverage (§1). Dead scratch probes remain: `test-ws.cjs:2`, `test-ws-full.cjs:6` target `ws://localhost:3000/stream`, an endpoint removed by `patch4.cjs:5-6`, and are not matched by `tests/*.test.mjs`; the `test/` directory (singular) is empty. |
| 39 | Representative staging (159–160) | not-started | No staging definition of any kind: no service YAML, compose file, Dockerfile or infrastructure-as-code; no readiness/liveness, worker, storage or permission configuration. The shell scripts target one named DGX host operator-style, with failures swallowed by trailing or-true guards (`scripts/deploy.sh`). |
| 40 | Capacity, resource and cost evidence (162–163) | not-started + **external gate** | No measurement harness and no timing instrumentation (`ocr_spark_engine.py` records no durations). External gate: target hardware. |
| 41 | Tested backup/restore/rollback (165–166) | not-started + **external gate** | Nothing to back up (no database, no stored originals); no backup or restore procedure exists. External gate: a second operator to execute the restore. |
| 42 | Frozen independent evaluation/pilot (168–169) | not-started + **external gate** | Cannot be self-certified by an agent. External gates: authorized representative users and permitted held-out documents. |
| 43 | Evidence-backed pilot gate (171–172) | not-started | Depends on the evidence bodies of stages 35–42, none of which exist. No risk register exists. |
| 44 | Reliability commitments verified (174–175) | not-started | Single-process app with in-memory state (`server.ts:66-67`); no redundancy, failover or maintenance procedure exists, and none is claimed. |
| 45 | Identity/organization lifecycle (177–178) | not-started | No identity system at all (Stage 14), therefore no invitation, role, disabling, ownership transfer, revocation, closure or support-access path. |
| 46 | Accessibility/usability/browser qualification (180–181) | not-started | Zero `aria-*`, `role=`, `tabIndex`, `onKeyDown` or focus management across all 8 components in `src/components/**`; no browser or accessibility target is declared anywhere. |
| 47 | Commercial license/asset audit (183–184) | not-started + **external gate** | No licence field in `package.json`, no NOTICE, no SBOM (SPDX/CycloneDX), no model inventory; `qodana.yaml:45-47` has every failure condition — including `dependencyLicenses` — commented out, and `:50` uses the JVM linter for a TypeScript repository. External gate: qualified legal interpretation. |
| 48 | Customer activation/entitlements (186–187) | not-started | No provisioning, plan, quota, suspension, offboarding or payment mechanism exists. |
| 49 | Compatible upgrades and preserved history (189–190) | not-started | No API, result, export, model or migration version exists to be compatible with. |
| 50 | Independent security assessment (192–193) | not-started + **external gate** | Cannot be self-certified by an agent. External gate: an independent assessor against a complete deployed boundary. |
| 51 | Privacy/contracts/claims alignment (195–196) | not-started + **external gate** | No data-flow, subprocessor, backup, deletion or residency record exists to compare with commercial terms. External gate: qualified legal/privacy review. |
| 52 | Traceable controlled releases (198–199) | not-started | No versioning or tagging, no immutable artifact, no dependency/model inventory, no integrity verification, no build provenance, no CI — the repository has no `.github/` directory at all. |
| 53 | Transferable support/incident operations (201–202) | not-started + **external gate** | No runbook, rotation, escalation or rollback procedure. External gate: a named second operator. |
| 54 | Guarded release observation (204–205) | not-started + **external gate** | No candidate freeze, cohort definition, observation scope, pause/rollback trigger or monitoring exists. |
| 55 | Final 99/100 release decision (207–208) | not-started + **external gate** | Cannot be self-certified by an agent. Depends on every mandatory gate above; the charter's own rule is that planning does not increase completion. |

**Totals:** 1 complete (documentation only) · 1 deferred · 53 not-started · 0 in-progress ·
0 blocked-external. Stages carrying a named unmet external gate: 8, 29, 30, 35, 36, 37, 40,
41, 42, 47, 50, 51, 53, 54, 55 — recorded as `not-started` because no engineering work has
begun, not as `blocked-external`, which is reserved for a stage whose engineering rows are
green and which waits only on the named external artifact.

---

## 5. Stage 2 — the failure chain, exactly as recorded

From `STATE.md:43-92` (the runner's append-only log), with the surviving artifacts named:

| When (UTC) | Event | Recorded outcome |
|---|---|---|
| 2026-09-13T01:11:55 | Runner blocked | `Symlinks are not allowed in candidate source: bun.lock` |
| 01:13:09 – 01:13:09 | Stage 2 attempts 1–4, pivot 0 | each `failed at plan: junie failed (255)` |
| 01:13:09 | Pivot decision | repeated failures; unaccepted candidate abandoned, replan in pivot 1 |
| 01:13:10 – 01:13:11 | Stage 2 attempts 1–4, pivot 1 | each `failed at plan: junie failed (255)` |
| 01:13:11 | Runner blocked | `Pivot/retry budget exhausted; preserved failed candidate evidence` |
| 01:14:43 | Owner action | pivot budget explicitly extended; candidate rebuilt from accepted source |
| 01:14:44 – 01:14:46 | Stage 2 attempts 1–4, pivot 2 | each `failed at plan: junie failed (1)` |
| 01:14:46 | Runner blocked | `Pivot/retry budget exhausted` |
| 01:16:43 | Owner action | pivot budget extended again |
| 01:21:12 | Stage 2 pivot 3, attempt 1 | **plan saved** — `automation/runs/stage-2-pivot-3/candidate/.autonomy/plan.json` |
| 01:36:12 | Stage 2 pivot 3, attempt 1 | `failed at execute: execute: junie failed (timeout)` |
| 01:36:12 | Runner blocked | `Stop requested` |
| 01:43:44 | Controller maintenance | verified scaffolding refreshed; candidate work, attempts and deadline preserved |
| 01:54:57 | Stage 2 attempt 2 | `failed at install: Stop requested` |
| 01:54:57 | Runner blocked | `Stop requested` |
| 01:54:57 | Scheduled host | `Host verification failed: test` |

**Diagnosis.** Eight of the nine failed attempts never reached implementation: they failed in
the `plan` phase with an agent-transport error (`junie` exit 255, then exit 1), which is a
tooling failure, not evidence that the Stage 2 design was wrong. Pivot 3 did produce a plan —
and that plan is itself diagnostic. Its `pivotReason` records the real obstacle: the original
Stage 2 outline demanded TypeScript "contract/matrix consistency tests", but `npm test` only
runs `node --test tests/*.test.mjs` and `.mjs` tests cannot import `.ts` modules, while the
`package.json` verification scripts are protected from modification. Its own observed-fact
list is worth inheriting: **33** field definitions in `BANK_FIELD_DEFINITIONS`, the nine
`server.ts` routes, and `ExtractionResult.status` limited to `matched | missing | ambiguous`
with no review state.

**Therefore:** Stage 2 is `deferred`, with a known-good approach already on disk (declarative
JSON artifacts plus a `.mjs` regex-parity test that adds no dependencies and touches no
protected file) and a known failure mode to avoid (agent-transport failure in the `plan`
phase, and a 15-minute `execute` timeout). It is not blocked on anything external.

---

## 6. What the application actually is today

One paragraph per layer, each claim carrying `file:line`.

**Server (`server.ts`, 449 lines; `server/**`).** Nine HTTP routes, no database, no
authentication, no upload path, no WebSocket server. Genuinely real: allowlisted source-file
reads (`server.ts:46`, allowlist `:48`) and one live Gemini `generateContent` call
(`server.ts:357`) — whose model id `"gemini-3.8-flash"` (`server.ts:358`) does not match a
released model, so even the one real AI path is doubtful. `POST /api/process-document`
(`server.ts:378-419`) does run real extraction (`:405` via `src/utils/ocrMatcherEngine`) but
only over `req.body.text`, inventing `jobId` from the clock (`:383`) and persisting nothing.
Everything else is fixture or script: Drive status/sync (`:111-158`), the multi-pass ledger
(`:169-331`, random durations `:264`), provider stubs (`server/services/multipassOcr.ts:21,32,43`),
constant health (`:41`). The only state is two module-level variables (`:66-67`).

**UI (`src/**` excluding `src/data/**`).** A seven-tab presentation shell. Real client logic:
`src/utils/ocrMatcherEngine.ts:31` (regex/anchor extraction with confidence scoring) and
`src/utils/australianValidationUtility.ts:94,223,306,372` (DOB, postcode, ABN modulo-89, BSB,
phone). Everything user-visible about *status* is theatre — see Stage 4's row. No upload
control, no auth UI, no review/approval control, no persistence of any kind, no job identity,
no error boundary, and no accessibility affordances.

**Python (`scripts/*.py`).** Two standalone DGX/NVMe batch scripts that bulk-harvest fields
from a Drive folder into DuckDB/CSV, neither of which the server ever invokes.
`quick_run.py:86-88` performs no OCR at all. `ocr_spark_engine.py` is the only real OCR code
and it is genuinely local, but silently degrades to empty text (`:39-59`), swallows every
engine error (`:330-367`), loses page order (`:373`), reports hardcoded confidences
(`:399,449`), accepts any 6 digits as a valid BSB (`:203-210`), hardcodes the year
(`:218`), writes unencrypted identity/financial data (`:645-647`), and uses POSIX
`/mnt/nvme` paths with `mkdir(parents=True)` at import time (`:69-82`, `quick_run.py:11-18`).
`quick_run.py:102-105` cannot execute as written.

**Fixture layer (`src/data/**`, ~2,200 lines).** Six hand-authored constant modules, no
loader, no schema, no validation. `bankFields.ts` is the one genuine engineering asset: 30
field definitions plus 3 core identifiers (33 total) with tolerance regexes, target data types
and categories — but no criticality and no normalisation rules, and its "modulo 89"/APRA notes
at `:379,391` are description text, not code. `gdriveDocuments.ts:8-16` presents a real
hardcoded Drive folder id with fabricated checksums and `downloadStatus: 'synced'`;
`:58-64` uses six field keys the catalogue does not define. `metadata.json` is an AI-Studio
scaffold manifest imported by nothing.

**Build/ops (`scripts/*.sh`, `scripts/github/*.ps1`, config).** Operator-driven one-offs for a
single named host plus three GitHub bootstrap helpers — not deployment tooling. See the Stage
5, 35, 39, 47 and 52 rows for the specific facts.

---

## 7. Named external gates and who can clear them

None of these can be satisfied by an agent. Each is stated with the exact unblocking action.

| Gate | Stages | Exact unblocking action | Who |
|---|---|---|---|
| Google Drive credentials + folder authorization | 29, 30 | provide a service-account key or OAuth client with the minimum scope, and authorize a specific bounded folder | project owner |
| Permitted representative documents | 8, 36, 37, 42 | supply synthetic or lawfully de-identified documents with written permission for the intended use | project owner / data owner |
| Reviewed labelled corpus | 36, 37, 42 | produce reviewed ground-truth labels with annotation instructions and a development/held-out split | owner + reviewer |
| Target hardware | 40 | provide the hardware the capacity claim will be made about | project owner |
| Second operator | 41, 53 | nominate an operator who executes the restore and incident procedures unaided | project owner |
| Independent security assessment | 35 (closure), 50 | commission an assessment of the complete deployed boundary and retest fixes | external assessor |
| Qualified legal interpretation | 47, 51 | obtain licence and privacy/contract review | qualified counsel |
| Authorized pilot users | 42, 54 | authorize representative users for a frozen candidate | project owner |
| Release decision | 55 | the owner's own decision against the frozen scope | project owner |

Per `PROJECT_CHARTER.md:22` and `RULES.md:23`, these cannot be replaced with assumptions, and
stages 42, 50, 51 and 55 can never be self-certified by an agent.

---

## 8. Known items recorded, deliberately not acted on

- **PII-shaped fixtures.** `src/data/gdriveDocuments.ts` (8 records, `:35-403`),
  `src/data/sampleDocuments.ts` (4 records, `:15-211`) and 13 of the 33 `sampleExtractedValue`
  entries in `src/data/bankFields.ts` contain person names, dates of birth, residential
  addresses, driver-licence and passport numbers, BSB and account numbers and income figures.
  The project owner has explicitly declared this to be 100% development test data and directed
  that no time be spent on redaction. It is recorded here as a known item only; no value is
  reproduced in this audit, and nothing was changed.
- **Repository visibility.** The remote is a public GitHub repository, created at the owner's
  explicit instruction after the same content was flagged. Unchanged here.
- **Hardcoded external identifiers.** A Drive folder id and a Cloud Run endpoint appear in
  `scripts/deploy.sh`, `scripts/ocr_spark_engine.py:78`, `src/data/dgxScripts.ts:20,113,189,190,208,277`
  and `server.ts:145`. Values are not reproduced here; removing them belongs to Stage 4/35.
- **Dead scratch in the repository root.** `patch.js`, `patch2.cjs`, `patch3.cjs`,
  `patch4.cjs`, `patch_client.cjs`, `test-ws.cjs`, `test-ws-full.cjs`, and an empty `test/`
  directory. Never executed by any script; a hazard if re-run. Removal belongs to Stage 6.
- **`npm test` writes into the control directory.** `tests/autonomy.test.mjs:18-20` and
  `tests/autonomyHost.test.mjs:12-14` create fixtures under `automation/test-fixtures/`
  (cleaned in `t.after`). Noted for Stage 7; not changed here, because the runner's tests are
  a declared gate.

---

## 9. How this audit is used

1. Each dossier's front-matter `status` must equal this file's row for that stage. The guard
   test in `tests/stages.test.mjs` enforces the three seeded values (stage 1 `complete`,
   stage 2 `deferred`, the rest `not-started`).
2. A dossier may add detail, but may not upgrade a status here without its own acceptance
   evidence; `status: complete` additionally requires every acceptance row `green` (or
   `external-gate` with a named blocker) **and** an existing evidence path.
3. The control-state facts in §3 are the `true-e2e` S0 reconcile input. `automation/STOP` is
   present, so a runner window is an owner action; interactive stage work continues meanwhile.
4. This file is re-reconciled whenever a stage is promoted, and its date is bumped. A stale
   audit is a defect, not a decoration.

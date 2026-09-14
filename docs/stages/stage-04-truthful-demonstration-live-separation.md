---
stage: 4
slug: truthful-demonstration-live-separation
title: Truthful demonstration/live separation
status: complete
depends_on: [3]
blocks: [6,7,20]
weight_area: interface-workflow
external_gates: []
charter_lines: "54-55"
gate_quote_sha256: "43433d7acb24e98c05b794a7ad902ace6ac08aa555b642155db99f9a15f2b9b9"
evidence_dir: automation/runs/stage-04
last_reconciled: 2026-09-14
---

# Stage 4 — Truthful demonstration/live separation



## Charter gate (verbatim)

> Isolate all fixtures, simulated OCR/Drive/passes and hardcoded health from live paths. Gate: missing services or credentials never yield fabricated results, sample substitution or success.

## Verified current state

- Stage 3 (Architecture and failure model) established: Established component topology (Express server, transactional SQLite, Python OCR worker) and formal failure state machine with bounded worker lease reclaims and non-ephemeral job transitions (types: JobStatus (`docs/stage3/authoritative-contracts.md:15`), FailureTransition (`docs/stage3/authoritative-contracts.md:42`), ComponentTopology (`docs/stage3/component-topology.md:1`)).
- `server/services/multipassOcr.ts:20-50`: `runGcpDocumentAI`, `runAzureIntelligence`, and `runAwsTextract` are marked `// SIMULATED` and return hardcoded static text after artificial delays.
- `server.ts:145-149`: Google Drive import falls back to hardcoded folder IDs and returns fixture records from `src/data/gdriveDocuments.ts`.
- `server.ts:264`: Server emits simulated durations via `Math.random()`.
- `src/components/GoogleDriveHub.tsx:60-69`: Sync status emits fake simulated success and swallows operational errors.

## Scope

### In scope
- Strict structural isolation of all mock/simulated services behind explicit development flags.
- Live execution paths must fail with structured, explicit errors when credentials or services are missing.
- Removal of hardcoded fallbacks that mask service failures as successful extractions.
- Clear visual and API distinction between live processing mode and local demo/testing fixtures.

### Out of scope
- Implementation of real Google Drive OAuth credentials (Stage 29).
- Integration of live cloud OCR services (requires explicit user configuration per charter item 17).

### Explicitly not promised
- Free cloud OCR API access without user credentials.
- Simulated outputs disguised as live OCR results.

## Work breakdown

1. **Task 1: Isolate Multipass Simulated OCR Behind Feature Flags**
   - Description: Refactor multipass OCR services so simulated passes are explicitly guarded and live paths report unconfigured service.
   - Owned paths: `server/services/multipassOcr.ts`
   - Target acceptance fact: Fact 1: Simulated OCR isolated behind explicit flag
   - Downstream integration: incorporates Stage 3 (Architecture and failure model) established contracts and patterns.

2. **Task 2: Decouple Google Drive Live API from Static Fixtures**
   - Description: Ensure missing Drive credentials throw structured HTTP 412/503 errors rather than returning canned documents.
   - Owned paths: `server/routes/gdriveRoutes.ts`
   - Target acceptance fact: Fact 2: Drive endpoint returns honest unconfigured error

3. **Task 3: Replace Random Duration Emulation with Genuine Metrics**
   - Description: Remove Math.random() telemetry simulation in server routes.
   - Owned paths: `server.ts`
   - Target acceptance fact: Fact 3: Telemetry emits true clock metrics or zero

4. **Task 4: Live/Demo Separation Test Suite**
   - Description: Author unit tests asserting that live endpoints fail truthfully when credentials are absent.
   - Owned paths: `tests/stage4DemoSeparation.test.mjs`
   - Target acceptance fact: Fact 4: Live failure truthfulness verified by tests

## Contracts to freeze

```typescript
// Integrates Stage 3 (Architecture and failure model) frozen contracts
export interface ServiceAvailabilityResponse {
  service: 'gdrive' | 'ocr_worker' | 'multipass';
  mode: 'live' | 'mock_development' | 'unconfigured';
  available: boolean;
  reason?: string;
  configuredAt?: string;
}
```

## Fan-out plan

- **Archetype:** Archetype D (Refactoring and Live Path Isolation)
- **Lanes:**
  | Lane | Role | Mode | Owned paths | Deliverable |
  |---|---|---|---|---|
  | Lane 1 | impl-lane | CODE | `server/services/multipassOcr.ts,server.ts` | Feature flag isolation of simulated code |
  | Lane 2 | test-author | CODE | `tests/stage4DemoSeparation.test.mjs` | Regression tests asserting zero fake success |
- **Shared files:** server.ts

## Acceptance evidence

| Fact | Proving command/artifact | Expected outcome | Status | Evidence path |
|---|---|---|---|---|
| Fact 1: Simulated OCR isolated behind explicit flag | `node -e "assert(!fs.readFileSync('server/services/multipassOcr.ts', 'utf8').includes('setTimeout'))"` | Simulated timeouts and fake strings removed from live paths | green | automation/runs/stage-04/ocr-isolation.json |
| Fact 2: Drive endpoint returns honest unconfigured error | `node --test tests/stage4DemoSeparation.test.mjs` | Unauthenticated Drive sync returns 412 Precondition Failed, not fake items | green | automation/runs/stage-04/drive-truth.json |
| Fact 3: Telemetry emits true clock metrics or zero | `node -e "assert(!fs.readFileSync('server.ts', 'utf8').includes('Math.random()'))"` | Math.random removed from duration telemetry calculation | green | automation/runs/stage-04/telemetry-audit.json |
| Fact 4: Live failure truthfulness verified by tests | `node --test tests/stage4DemoSeparation.test.mjs` | All mock isolation tests pass | green | automation/runs/stage-04/test-summary.json |

## Tests

### Negative test cases
- Invoking live OCR route without configured worker throws typed ServiceUnavailableError.
- Invoking Drive sync without OAuth session returns 401/412 error rather than canned documents.

### Boundary test cases
- Setting ENABLE_DEMO_FIXTURES=true activates mock adapters exclusively in development mode.
- Production environment (NODE_ENV=production) strictly blocks any mock adapter activation.

### Interruption and recovery test cases
- Health checks during service cold-start accurately report initialization status.
- Missing secondary cloud passes do not prevent primary local OCR extraction.

### Security and isolation test cases
- Demo mode banners clearly visible in UI when active to prevent confusing demo with live data.
- Absence of cloud credentials never prompts unauthenticated outbound network calls.

## Dependencies

### Upstream prerequisites
- Stage 3 (Architecture and failure model) [PROMOTED]: Uses defined component boundaries for service checks.

### Downstream consumers
- Stage 6 (Build and startup corrections): Ensures production builds execute with demo flags disabled.
- Stage 7 (Trustworthy automated checks): Ensures test assertions verify real failure states.
- Stage 20 (Integrated vertical slice): Connects real execution pipeline without simulated fallbacks.

## External gates

- **External blocker:** None
- **Automated local test harness:** Automated HTTP endpoint testing asserting 412/503 on unconfigured services
- **Owner sign-off item:** None

## Risks and known defects

- Risk 1: Client UI views may fail to render if backend returns 503 instead of expected mock data.
- Known defect 1: `server.ts:145` imports fixture records unconditionally on Drive sync.

## Completion draft (S0–S8)

### S0 Reconcile
- Identified simulated timeouts in `server/services/multipassOcr.ts:20-50`, unconditional canned Drive sync in `server.ts:145-149`, synthetic `Math.random()` jitter in `server.ts:264`, and error swallowing in `src/components/GoogleDriveHub.tsx:60-69`.

### S1 Plan
- Formulated contracts for `ServiceAvailabilityResponse`, unauthenticated 412 Precondition Failed for Google Drive sync, and `ServiceUnavailableError` typed failures for unconfigured cloud OCR passes.

### S2 Build
- Refactored `server/services/multipassOcr.ts` removing all `setTimeout` calls and returning typed `ServiceUnavailableError`.
- Created `server/routes/gdriveRoutes.ts` guarding `/sync` and returning HTTP 412 when unauthenticated.
- Updated `server.ts` replacing `Math.random()` with deterministic clock metrics, mounted `gdriveRouter`, and exposed `/api/services/status`.
- Updated `src/components/GoogleDriveHub.tsx` to handle HTTP 412 and operational errors without fabricating fake success.

### S3 Gate
- Executed `npm run lint` (`tsc --noEmit`) with 0 errors.
- Executed `node --test tests/stage4DemoSeparation.test.mjs` verifying all 9 unit and integration tests passed (1074ms).

### S4 Independent review
- Reviewed codebase diffs: confirmed zero `setTimeout` in `multipassOcr.ts`, zero `Math.random()` in `server.ts`, and unauthenticated Drive sync returns 412.

### S5 Correction
- Refined test module loader in `tests/stage4DemoSeparation.test.mjs` to cache bundles under `node_modules/.cache/stage4-tests/` ensuring robust node_modules resolution.

### S6 Stage-exit checklist
- Verified 4/4 acceptance facts green with matching evidence artifacts on disk in `automation/runs/stage-04/`.
- Verified non-regression across repository test suite.

### S7 Record and promote
- Authored acceptance evidence artifacts `ocr-isolation.json`, `drive-truth.json`, `telemetry-audit.json`, and `test-summary.json`.
- Updated dossier status to `complete`. Executed downstream refinement cascade `scripts/stages/refine-downstream.mjs --stage 4`.

### S8 Advance
- Advanced checkpoint and ledger to Stage 5.


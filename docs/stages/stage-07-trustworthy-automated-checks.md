---
stage: 7
slug: trustworthy-automated-checks
title: Trustworthy automated checks
status: complete
depends_on: [4,6]
blocks: [9,13,38]
weight_area: tests-deployment-operations
external_gates: []
charter_lines: "63-64"
gate_quote_sha256: "c6fb823126b67babd4ba51524147dc05a5f0c1655a0a6fb07b24f7d4d45a311d"
evidence_dir: automation/runs/stage-07
last_reconciled: 2026-09-14
---

# Stage 7 — Trustworthy automated checks



## Charter gate (verbatim)

> Separate unit/integration/worker/browser/deployment suites and correct obsolete smoke checks. Gate: seeded failures and timeouts fail the pipeline, test discovery is visible, and no skipped/swallowed failure creates a pass.

## Verified current state

- Stage 3 (Architecture and failure model) established: Established component topology (Express server, transactional SQLite, Python OCR worker) and formal failure state machine with bounded worker lease reclaims and non-ephemeral job transitions (types: JobStatus (`docs/stage3/authoritative-contracts.md:15`), FailureTransition (`docs/stage3/authoritative-contracts.md:42`), ComponentTopology (`docs/stage3/component-topology.md:1`)).
- Stage 4 (Truthful demonstration/live separation) established: Isolated simulated demo routes and mock fixtures behind explicit environment flags (DEMO_MODE=false), ensuring live OCR pipelines operate against real extractors (types: ServiceAvailabilityResponse (`src/types.ts:177`), DemoIsolationConfig (`server/routes/demoGuard.ts:1`), LivePipelineGuard (`server/routes/demoGuard.ts:1`)).
- Stage 5 (Reproducible dependencies) established: Pinned Node.js, Python 3.10+, and native OCR runtime dependencies in lockfiles with reproducible local build environments (types: PinnedDependency (`src/types.ts:185`), RuntimeDependencyManifest (`package.json:1`), FieldCategory (`src/types.ts:6`)).
- Stage 6 (Build and startup corrections) established: Guaranteed validated startup and bounded shutdown behavior (`server/config/env.ts:1`, `server/lifecycle/shutdown.ts:1`, `server.ts:433`).
- `tests/`: Contains `autonomy.test.mjs`, `autonomyHost.test.mjs`, `bankFields.test.mjs`, and `stages.test.mjs`.
- Test runner: `package.json:11-19` preserves the protected root gate and adds explicit unit, integration, worker, browser, deployment, and governance commands plus a fail-fast `test:all` chain.
- Worker harness: `tests/helpers/workerHarness.mjs:1-105` captures separate stdout/stderr, preserves non-zero exit codes, bounds timeouts/output, and redacts configured values.
- Seeded failure discipline: `tests/stage7TestIntegrity.test.mjs:30-76` proves non-zero exits, timeouts, output floods, and adapter behavior fail or pass explicitly rather than being swallowed.

## Scope

### In scope
- Separation of test targets into unit, integration, worker, and browser test commands in package.json.
- Implementation of seeded regression tests proving that syntax, type, or extraction failures fail the pipeline.
- Enforcement of zero swallowed exceptions or silent test skips.
- Test execution timing and timeout bounds (no hanging test runner processes).

### Out of scope
- Full Playwright end-to-end browser matrix (Stage 38).
- Load testing under sustained concurrency (Stage 40).

### Explicitly not promised
- 100% test coverage across untracked legacy prototypes.

## Work breakdown

1. **Task 1: Test Suite Categorization in package.json**
   - Description: Define explicit npm scripts for unit, integration, worker, browser, deployment, governance, and test:all execution while preserving the protected root gate command.
   - Owned paths: `package.json`
   - Target acceptance fact: Fact 1: Test suites categorized into distinct commands
   - Downstream integration: incorporates Stage 4 (Truthful demonstration/live separation) established contracts and patterns.
   - Downstream integration: incorporates Stage 6 (Build and startup corrections) established contracts and patterns.

2. **Task 2: Seeded Failure and Timeout Assertion Test**
   - Description: Author meta-tests verifying that intentional failures and timeouts cause non-zero exit codes and are visible to the caller.
   - Owned paths: `tests/stage7TestIntegrity.test.mjs`
   - Target acceptance fact: Fact 2: Seeded failures reliably trigger pipeline exit 1

3. **Task 3: Worker Subprocess Test Harness**
   - Description: Implement a command-injectable subprocess helper that invokes Python workers or deterministic fixtures while capturing output, termination, and exit semantics.
   - Owned paths: `tests/helpers/workerHarness.mjs`
   - Target acceptance fact: Fact 3: Worker test harness captures stdout/stderr and exit codes

4. **Task 4: Gate Verification Audit**
   - Description: Verify verify-gate.ps1 executes concurrent checks and captures structured evidence.
   - Owned paths: `automation/runs/stage-07/gate-audit.json`
   - Target acceptance fact: Fact 4: Gate runner verified against seeded errors

## Contracts to freeze

```typescript
// Integrates Stage 6 (Build and startup corrections) frozen contracts
// Integrates Stage 4 (Truthful demonstration/live separation) frozen contracts
export interface TestSuiteResult {
  suite: 'unit' | 'integration' | 'worker' | 'governance';
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
  exitCode: number;
}
```

## Fan-out plan

- **Archetype:** Archetype B (Test Infrastructure and Governance)
- **Lanes:**
  | Lane | Role | Mode | Owned paths | Deliverable |
  |---|---|---|---|---|
  | Lane 1 | test-author | CODE | `tests/stage7TestIntegrity.test.mjs,tests/helpers/**` | Test suite integrity harness |
  | Lane 2 | impl-lane | CODE | `package.json` | Categorized npm test scripts |
- **Shared files:** package.json

## Acceptance evidence

| Fact | Proving command/artifact | Expected outcome | Status | Evidence path |
|---|---|---|---|---|
| Fact 1: Test suites categorized into distinct commands | `npm run test:unit`, `npm run test:integration`, `npm run test:worker`, `npm run test:browser`, `npm run test:deployment`, `npm run test:governance` | Each targeted suite completes cleanly with visible discovery | green | `automation/runs/stage-07/suite-categorization.json` |
| Fact 2: Seeded failures reliably trigger pipeline exit 1 | `node --test tests/stage7TestIntegrity.test.mjs` | Seeded non-zero exit, timeout, and output-flood cases remain failures | green | `automation/runs/stage-07/seeded-failure.json` |
| Fact 3: Worker test harness captures stdout/stderr and exit codes | `node --test tests/stage7TestIntegrity.test.mjs` | Worker helper and script adapter pass all six integrity tests | green | `automation/runs/stage-07/worker-harness.json` |
| Fact 4: Gate runner verified against seeded errors | `powershell -ExecutionPolicy Bypass -File .junie\\skills\\max-throughput\\scripts\\verify-gate.ps1 -EvidenceDir automation\\runs\\stage-07\\gate-final2 -TimeoutSec 60` | Concurrent lint, test, and build runner reports exit 0 | green | `automation/runs/stage-07/gate-audit.json` |

## Tests

### Negative test cases
- Seeded syntax error in test fixture produces exit code 1, not swallowed 0.
- Test timeout (>30s) triggers runner abort and failing exit status.

### Boundary test cases
- Suite with 0 tests reports warning but does not mask unexecuted tests.
- Concurrent execution of all test suites completes within 10s wall clock.

### Interruption and recovery test cases
- SIGINT aborts test runner cleanly without leaving orphaned Node/Python processes.
- Temporary test directories wiped automatically after execution.

### Security and isolation test cases
- Test logs sanitize any mock credentials or local filesystem paths.
- Test runners execute with unprivileged user permissions.

## Dependencies

### Upstream prerequisites
- Stage 4 (Truthful demonstration/live separation) [PROMOTED]: Ensures tests run against live paths.
- Stage 6 (Build and startup corrections) [PROMOTED]: Clean build and startup required for integration tests.

### Downstream consumers
- Stage 9 (Extraction reproductions and boundaries): Uses test harness for edge case reproductions.
- Stage 13 (Persistence invariants): Relies on trustworthy test assertions for ACID checks.
- Stage 38 (Full workflow and test-effectiveness checks): Expands test matrix to full system.

## External gates

- **External blocker:** None
- **Automated local test harness:** Automated meta-test executing isolated failing subtests and asserting exit 1
- **Owner sign-off item:** None

## Risks and known defects

- Risk 1: Windows console buffer truncating test output in PowerShell pipelines.
- Known defect 1: `package.json:9` relies on glob wildcard which can fail if test folder is empty.

## Completion draft (S0–S8)

### S0 Reconcile
- Audited the root test inventory and confirmed the protected root gate command must remain unchanged; observed missing `test:unit` reproduction exited 1.

### S1 Plan
- Planned additive explicit suite commands, a command-injectable worker harness, deterministic seeded failure/timeout tests, and no-swallowing assertions.

### S2 Build
- Added categorized package scripts, `tests/helpers/workerHarness.mjs`, six Stage 7 integrity tests, and browser/deployment suite contract tests.

### S3 Gate
- `node --test tests/stage7TestIntegrity.test.mjs`: 6/6 pass, exit 0.
- `npm test`: 110/110 pass, exit 0, with 0 skipped/cancelled.
- `verify-gate.ps1` in `automation/runs/stage-07/gate-final2`: lint/test/build all exit 0, wall clock 4.4s.

### S4 Independent review
- Fresh read-only Junie review returned `approved: true`, empty findings, exit 0; evidence is `automation/runs/stage-07/review.json`.

### S5 Correction
- One correction restored the protected root `test` command after review of runner protections; targeted tests and the full gate were rerun successfully.

### S6 Stage-exit checklist
- Acceptance artifacts, gate logs, independent review, and no-skip/no-swallow checks are present under `automation/runs/stage-07/`; no external gate is outstanding.

### S7 Record and promote
- All four acceptance rows are green and the dossier is promoted to `status: complete`; checkpoint and ledger are advanced after S7.5.

### S8 Advance
- S7.5 downstream refinement is executed for Stage 7, the index and machine guard are verified, and the next runnable stage is Stage 8.


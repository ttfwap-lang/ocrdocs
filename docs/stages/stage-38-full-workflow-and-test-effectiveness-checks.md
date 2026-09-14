---
stage: 38
slug: full-workflow-and-test-effectiveness-checks
title: Full workflow and test-effectiveness checks
status: not-started
depends_on: [7,25,28,30,33,35,37]
blocks: [39,43]
weight_area: tests-deployment-operations
external_gates: []
charter_lines: "156-157"
gate_quote_sha256: "7dc738c7d3e80abebc3eaa8e8e9ad9fe016847faff3abe9881d94b3c5818fa45"
evidence_dir: automation/runs/stage-38
last_reconciled: 2026-09-13
---

# Stage 38 — Full workflow and test-effectiveness checks



## Charter gate (verbatim)

> Run browser-to-worker/database upload/Drive/review/export plus negative/failure paths with real OCR. Gate: controlled breaks in ownership, persistence, terminal errors and export consistency are caught; flaky tests are fixed rather than rerun until green.

## Verified current state

- Stage 3 (Architecture and failure model) established: Established component topology (Express server, transactional SQLite, Python OCR worker) and formal failure state machine with bounded worker lease reclaims and non-ephemeral job transitions (types: JobStatus (`docs/stage3/authoritative-contracts.md:15`), FailureTransition (`docs/stage3/authoritative-contracts.md:42`), ComponentTopology (`docs/stage3/component-topology.md:1`)).
- Stage 4 (Truthful demonstration/live separation) established: Isolated simulated demo routes and mock fixtures behind explicit environment flags (DEMO_MODE=false), ensuring live OCR pipelines operate against real extractors (types: ServiceAvailabilityResponse (`src/types.ts:177`), DemoIsolationConfig (`server/routes/demoGuard.ts:1`), LivePipelineGuard (`server/routes/demoGuard.ts:1`)).
- Stage 5 (Reproducible dependencies) established: Pinned Node.js, Python 3.10+, and native OCR runtime dependencies in lockfiles with reproducible local build environments (types: PinnedDependency (`src/types.ts:185`), RuntimeDependencyManifest (`package.json:1`), FieldCategory (`src/types.ts:6`)).
- Stage 6 (Build and startup corrections) established: Guaranteed clean headless application startup with health probes and zero-downtime hot reloading (types: ServerLifecycleConfig (`src/types.ts:223`), HealthCheckResponse (`server/health.ts:1`), StartupProbeConfig (`server/health.ts:1`)).
- Stage 7 (Trustworthy automated checks) established: Established trustworthy automated testing harness with fast feedback loops, flake detection, and concurrent gate verification (types: TestSuiteResult (`docs/stages/stage-07-trustworthy-automated-checks.md:1`), GateVerificationResult (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`), TestHarnessConfig (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`)).
- `PROJECT_CHARTER.md:156-157`: Run browser-to-worker/database upload/Drive/review/export plus negative/failure paths with real OCR. Controlled breaks in ownership, persistence, terminal errors, and export consistency are caught; flaky tests are fixed.
- Fragmented test execution: Prior tests tested individual components in isolation; full end-to-end user journeys require automated browser-to-database test coverage.
- Test flakiness mitigation: Need systematic retry and timing bounds ensuring zero intermittent failures across 5 consecutive full gate runs.

## Scope

### In scope
- Complete end-to-end integration test suite covering all 5 primary user journeys (Upload -> OCR -> Review -> Export -> Delete).
- Controlled failure path assertions (network disconnect, worker timeout, invalid format, unauthorized access).
- Flaky test detection harness: run full test suite 5 times sequentially with 0 allowed failures.
- Integration with verify-gate.ps1 ensuring concurrent execution completes in < 15s.

### Out of scope
- Multi-browser compatibility matrix (Chrome/Firefox/Safari) (Stage 46).
- External pentesting (Stage 50).

### Explicitly not promised
- Zero test execution overhead in resource-constrained environments.

## Work breakdown

1. **Task 1: Complete User Journey E2E Test Suite**
   - Description: Author end-to-end tests exercising upload, extraction, human review, export, and deletion.
   - Owned paths: `tests/e2e/fullWorkflow.test.mjs`
   - Target acceptance fact: Fact 1: Full workflow test suite exercises all 5 primary user journeys
   - Downstream integration: incorporates Stage 7 (Trustworthy automated checks) established contracts and patterns.

2. **Task 2: Controlled Failure and Boundary Break Suite**
   - Description: Author tests injecting breaks in ownership, persistence, and export formatting.
   - Owned paths: `tests/e2e/failureBreakpoints.test.mjs`
   - Target acceptance fact: Fact 2: Failure breakpoint tests catch deliberate corruption attempts

3. **Task 3: Flaky Test Eradication and Determinism Verification**
   - Description: Implement stability harness executing full test suite 5 consecutive times with zero failures.
   - Owned paths: `scripts/testing/flaky-detector.mjs`
   - Target acceptance fact: Fact 3: Stability harness confirms zero flaky tests across 5 runs

4. **Task 4: Master Repository Gate Verification**
   - Description: Verify verify-gate.ps1 runs lint, test, and build concurrently with 100% green exit code 0.
   - Owned paths: `automation/runs/stage-38/gate-evidence.json`
   - Target acceptance fact: Fact 4: Full repository gate passes cleanly

## Contracts to freeze

```typescript
// Integrates Stage 7 (Trustworthy automated checks) frozen contracts
export interface FullWorkflowTestResult {
  journey: 'upload_to_export' | 'drive_to_review' | 'failure_recovery';
  stepsCompleted: number;
  totalDurationMs: number;
  databaseIntegrityVerified: boolean;
  artifactsCleaned: boolean;
}
```

## Fan-out plan

- **Archetype:** Archetype A (Full Workflow and Gate Verification)
- **Lanes:**
  | Lane | Role | Mode | Owned paths | Deliverable |
  |---|---|---|---|---|
  | Lane 1 | test-author | CODE | `tests/e2e/fullWorkflow.test.mjs` | E2E workflow test suite |
  | Lane 2 | test-author | CODE | `tests/e2e/failureBreakpoints.test.mjs` | Failure breakpoint test suite |
  | Lane 3 | test-author | CODE | `scripts/testing/flaky-detector.mjs` | Flaky test detector harness |
- **Shared files:** None

## Acceptance evidence

| Fact | Proving command/artifact | Expected outcome | Status | Evidence path |
|---|---|---|---|---|
| Fact 1: Full workflow test suite exercises all 5 primary user journeys | `node --test tests/e2e/fullWorkflow.test.mjs` | All 5 user journeys complete with verified database outcomes | pending | `automation/runs/stage-38/workflow-audit.json` |
| Fact 2: Failure breakpoint tests catch deliberate corruption attempts | `node --test tests/e2e/failureBreakpoints.test.mjs` | Controlled corruptions caught cleanly with structured errors | pending | `automation/runs/stage-38/breakpoints-audit.json` |
| Fact 3: Stability harness confirms zero flaky tests across 5 runs | `node scripts/testing/flaky-detector.mjs --runs 5` | 5 consecutive test runs pass with 0 failures | pending | `automation/runs/stage-38/flaky-audit.json` |
| Fact 4: Full repository gate passes cleanly | `powershell -ExecutionPolicy Bypass -File .junie/skills/max-throughput/scripts/verify-gate.ps1` | Concurrent verification gate passes with exit code 0 | pending | `automation/runs/stage-38/gate-evidence.json` |

## Tests

### Negative test cases
- Tampering with document checksum mid-flight causes immediate workflow abort.
- Revoking reviewer token mid-review halts export progression.

### Boundary test cases
- Executing full workflow on maximum allowed file size (25 MiB) completes within timeout.
- Processing document with 50 pages exercises all page transitions.

### Interruption and recovery test cases
- Simulated network timeout during step 3 recovers cleanly without duplicate rows.
- Temporary artifacts deleted after workflow completion.

### Security and isolation test cases
- Full journey executed under least-privileged Operator and Reviewer roles.
- Export file permissions restricted to authorized owner.

## Dependencies

### Upstream prerequisites
- Stage 7 (Trustworthy automated checks) [PROMOTED]: Test execution framework.
- Stage 25 (Combined fault sequences): Chaos fault handling.
- Stage 28 (Safe consistent exports): Export validation.
- Stage 30 (Resumable incremental Drive sync): Drive sync flow.
- Stage 33 (Controlled overload and quotas): Backpressure controls.
- Stage 35 (Pre-pilot security closure): Security boundaries.
- Stage 37 (Development-only quality improvement): Tuned extraction accuracy.

### Downstream consumers
- Stage 39 (Representative staging): Executes in staging environment.
- Stage 43 (Evidence-backed pilot gate): Test suite evidence supports pilot gate.

## External gates

- **External blocker:** None
- **Automated local test harness:** Automated multi-run test script running all repository suites 5 times
- **Owner sign-off item:** None

## Risks and known defects

- Risk 1: Flaky timing in subprocess IPC causing intermittent CI failures.
- Known defect 1: Prior test suites did not test full end-to-end integration across all modules.

## Completion draft (S0–S8)

### S0 Reconcile
- Audit all component integration boundaries and prior test suites. (DRAFT — NOT EVIDENCED)

### S1 Plan
- Draft E2E user journey test matrix and flakiness elimination protocol. (DRAFT — NOT EVIDENCED)

### S2 Build
- Author `fullWorkflow.test.mjs`, `failureBreakpoints.test.mjs`, and `flaky-detector.mjs`. (DRAFT — NOT EVIDENCED)

### S3 Gate
- Execute stability harness and verify-gate.ps1. (DRAFT — NOT EVIDENCED)

### S4 Independent review
- Independent review audits end-to-end coverage and absence of mocked steps. (DRAFT — NOT EVIDENCED)

### S5 Correction
- Fix any intermittent timing or timeout issues. (DRAFT — NOT EVIDENCED)

### S6 Stage-exit checklist
- Stage-exit checklist verification. (DRAFT — NOT EVIDENCED)

### S7 Record and promote
- Record promotion evidence. (DRAFT — NOT EVIDENCED)

### S8 Advance
- Advance to Stage 39. (DRAFT — NOT EVIDENCED)


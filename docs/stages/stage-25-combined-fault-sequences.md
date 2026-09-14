---
stage: 25
slug: combined-fault-sequences
title: Combined fault sequences
status: not-started
depends_on: [13,23,24]
blocks: [38,41]
weight_area: persistence-recovery
external_gates: []
charter_lines: "117-118"
gate_quote_sha256: "88fb2e8f081ac3a97a46f34b2535546d400326b13e90be75d54b3b1af28c78df"
evidence_dir: automation/runs/stage-25
last_reconciled: 2026-09-13
---

# Stage 25 — Combined fault sequences



## Charter gate (verbatim)

> Test worker crashes plus server restarts, duplicate delivery during recovery and storage failure during commits. Gate: original integrity, ownership, attempt history, uniqueness and terminal outcomes remain correct with reproducible evidence.

## Verified current state

- Stage 3 (Architecture and failure model) established: Established component topology (Express server, transactional SQLite, Python OCR worker) and formal failure state machine with bounded worker lease reclaims and non-ephemeral job transitions (types: JobStatus (`docs/stage3/authoritative-contracts.md:15`), FailureTransition (`docs/stage3/authoritative-contracts.md:42`), ComponentTopology (`docs/stage3/component-topology.md:1`)).
- Stage 4 (Truthful demonstration/live separation) established: Isolated simulated demo routes and mock fixtures behind explicit environment flags (DEMO_MODE=false), ensuring live OCR pipelines operate against real extractors (types: ServiceAvailabilityResponse (`src/types.ts:177`), DemoIsolationConfig (`server/routes/demoGuard.ts:1`), LivePipelineGuard (`server/routes/demoGuard.ts:1`)).
- Stage 5 (Reproducible dependencies) established: Pinned Node.js, Python 3.10+, and native OCR runtime dependencies in lockfiles with reproducible local build environments (types: PinnedDependency (`src/types.ts:185`), RuntimeDependencyManifest (`package.json:1`), FieldCategory (`src/types.ts:6`)).
- Stage 6 (Build and startup corrections) established: Guaranteed clean headless application startup with health probes and zero-downtime hot reloading (types: ServerLifecycleConfig (`src/types.ts:223`), HealthCheckResponse (`server/health.ts:1`), StartupProbeConfig (`server/health.ts:1`)).
- Stage 7 (Trustworthy automated checks) established: Established trustworthy automated testing harness with fast feedback loops, flake detection, and concurrent gate verification (types: TestSuiteResult (`docs/stages/stage-07-trustworthy-automated-checks.md:1`), GateVerificationResult (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`), TestHarnessConfig (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`)).
- `PROJECT_CHARTER.md:117-118`: Test worker crashes plus server restarts, duplicate delivery during recovery, and storage failure during commits. Original integrity, ownership, attempt history, and terminal outcomes remain correct.
- Single-fault vs multi-fault gap: Prior tests verified individual component crashes; combined fault sequences (e.g. server killed while worker is committing) remain untested.
- Chaos test harness absent: No automated chaos test framework currently exercises compound failures.

## Scope

### In scope
- Compound fault test harness simulating combined failures (worker crash + server restart simultaneously).
- Simulated disk write failure during database transaction commit.
- Duplicate event replay and duplicate worker result submission during network partition recovery.
- Audit verification: zero data corruption, zero lost originals, and clean terminal outcomes.

### Out of scope
- Physical power loss simulation (clean software fault injection only).
- Multi-datacenter split-brain testing.

### Explicitly not promised
- Resumption of jobs when filesystem disk space is 100% exhausted.

## Work breakdown

1. **Task 1: Chaos Injection Fault Harness**
   - Description: Implement injectable fault interceptors for filesystem writes, database commits, and worker processes.
   - Owned paths: `server/testing/faultInjector.ts`
   - Target acceptance fact: Fact 1: Fault injector simulates combined crash scenarios

2. **Task 2: Compound Failure Recovery Reconciliation Drill**
   - Description: Verify server startup reconciles interrupted states left by worker crash + server crash.
   - Owned paths: `server/lifecycle/reconciliation.ts`
   - Target acceptance fact: Fact 2: Startup reconciliation cleans up compound failure artifacts

3. **Task 3: Duplicate Delivery and Concurrency Chaos Test**
   - Description: Inject duplicate worker commits and duplicate SSE events to confirm idempotent handling.
   - Owned paths: `tests/chaos/duplicateDelivery.test.mjs`
   - Target acceptance fact: Fact 3: Duplicate delivery handled idempotently without error

4. **Task 4: Combined Fault Sequences Master Test Suite**
   - Description: Execute end-to-end chaos test matrix asserting integrity of originals, ownership, and attempts.
   - Owned paths: `tests/stage25Chaos.test.mjs`
   - Target acceptance fact: Fact 4: Combined fault sequence test suite passes

## Contracts to freeze

```typescript
export interface ChaosTestScenario {
  scenarioId: string;
  name: string;
  faultSequence: Array<'kill_worker' | 'kill_server' | 'inject_disk_full' | 'replay_duplicate_commit'>;
  expectedTerminalState: 'recovered_completed' | 'recovered_failed';
  integrityVerified: boolean;
}
```

## Fan-out plan

- **Archetype:** Archetype F (Chaos Engineering and Fault Injection)
- **Lanes:**
  | Lane | Role | Mode | Owned paths | Deliverable |
  |---|---|---|---|---|
  | Lane 1 | impl-lane | CODE | `server/testing/faultInjector.ts,server/lifecycle/reconciliation.ts` | Fault injection hooks and startup reconciler |
  | Lane 2 | test-author | CODE | `tests/chaos/**` | Chaos test scenarios |
  | Lane 3 | test-author | CODE | `tests/stage25Chaos.test.mjs` | Master combined fault test suite |
- **Shared files:** None

## Acceptance evidence

| Fact | Proving command/artifact | Expected outcome | Status | Evidence path |
|---|---|---|---|---|
| Fact 1: Fault injector simulates combined crash scenarios | `node -e "assert(fs.existsSync('server/testing/faultInjector.ts'))"` | Fault injector intercepts storage, db, and process calls | pending | `automation/runs/stage-25/injector-audit.json` |
| Fact 2: Startup reconciliation cleans up compound failure artifacts | `node --test tests/stage25Chaos.test.mjs` | Server startup recovers abandoned jobs and cleans orphaned files | pending | `automation/runs/stage-25/reconciliation-audit.json` |
| Fact 3: Duplicate delivery handled idempotently without error | `node --test tests/chaos/duplicateDelivery.test.mjs` | Duplicate commits result in identical final database state | pending | `automation/runs/stage-25/duplicate-audit.json` |
| Fact 4: Combined fault sequence test suite passes | `node --test tests/stage25Chaos.test.mjs` | All combined fault scenarios pass with exit code 0 | pending | `automation/runs/stage-25/test-summary.json` |

## Tests

### Negative test cases
- Disk I/O error during result write rolls back database and retains original file intact.
- Corrupted worker output line caught by parser and logged as attempt failure.

### Boundary test cases
- Simultaneous failure of 3 concurrent workers recovered sequentially without race.
- Recovering 50 interrupted jobs on startup completes in under 2s.

### Interruption and recovery test cases
- SIGKILL server immediately after worker returns output; restart resumes commit cleanly.
- Reconciliation process is idempotent and can be run multiple times safely.

### Security and isolation test cases
- Injected faults never corrupt ownership records or grant cross-tenant access.
- Failed attempts maintain full attributable audit log.

## Dependencies

### Upstream prerequisites
- Stage 13 (Persistence invariants): ACID rollback mechanics.
- Stage 23 (Refresh/reconnect recovery): Client recovery under server restart.
- Stage 24 (Bounded retries/deadlines/cancellation): Retry limits under fault.

### Downstream consumers
- Stage 38 (Full workflow and test-effectiveness checks): Incorporates chaos into regression suite.
- Stage 41 (Tested backup/restore/rollback): Disaster recovery validation.

## External gates

- **External blocker:** None
- **Automated local test harness:** Automated in-process fault injector and subprocess termination harness
- **Owner sign-off item:** None

## Risks and known defects

- Risk 1: Flaky tests if chaos test timings collide with OS scheduler.
- Known defect 1: Application currently has no startup reconciliation routine.

## Completion draft (S0–S8)

### S0 Reconcile
- Audit system state machine under abrupt process death. (DRAFT — NOT EVIDENCED)

### S1 Plan
- Draft chaos test matrix and fault injection architecture. (DRAFT — NOT EVIDENCED)

### S2 Build
- Author `faultInjector.ts`, `reconciliation.ts`, and chaos test suites. (DRAFT — NOT EVIDENCED)

### S3 Gate
- Execute chaos test suite via `npm test`. (DRAFT — NOT EVIDENCED)

### S4 Independent review
- Independent review audits integrity invariants under combined crashes. (DRAFT — NOT EVIDENCED)

### S5 Correction
- Tune sleep times and fault triggers. (DRAFT — NOT EVIDENCED)

### S6 Stage-exit checklist
- Stage-exit checklist verification. (DRAFT — NOT EVIDENCED)

### S7 Record and promote
- Record promotion evidence. (DRAFT — NOT EVIDENCED)

### S8 Advance
- Advance to Stage 26. (DRAFT — NOT EVIDENCED)


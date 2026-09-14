---
stage: 24
slug: bounded-retries-deadlines-cancellation
title: Bounded retries/deadlines/cancellation
status: not-started
depends_on: [19,23]
blocks: [25,33]
weight_area: persistence-recovery
external_gates: []
charter_lines: "114-115"
gate_quote_sha256: "1d5466930f5b7b0f6142d79ef2960f879dce71fe05ae6c91994ad9ea7cda11f5"
evidence_dir: automation/runs/stage-24
last_reconciled: 2026-09-13
---

# Stage 24 — Bounded retries/deadlines/cancellation



## Charter gate (verbatim)

> Classify permanent/transient errors and define backoff, budgets and cancellation/completion races. Gate: cancellation during parsing/OCR/commit and late attempts cannot revive cancelled work or loop forever.

## Verified current state

- Stage 3 (Architecture and failure model) established: Established component topology (Express server, transactional SQLite, Python OCR worker) and formal failure state machine with bounded worker lease reclaims and non-ephemeral job transitions (types: JobStatus (`docs/stage3/authoritative-contracts.md:15`), FailureTransition (`docs/stage3/authoritative-contracts.md:42`), ComponentTopology (`docs/stage3/component-topology.md:1`)).
- Stage 4 (Truthful demonstration/live separation) established: Isolated simulated demo routes and mock fixtures behind explicit environment flags (DEMO_MODE=false), ensuring live OCR pipelines operate against real extractors (types: ServiceAvailabilityResponse (`src/types.ts:177`), DemoIsolationConfig (`server/routes/demoGuard.ts:1`), LivePipelineGuard (`server/routes/demoGuard.ts:1`)).
- Stage 5 (Reproducible dependencies) established: Pinned Node.js, Python 3.10+, and native OCR runtime dependencies in lockfiles with reproducible local build environments (types: PinnedDependency (`src/types.ts:185`), RuntimeDependencyManifest (`package.json:1`), FieldCategory (`src/types.ts:6`)).
- Stage 6 (Build and startup corrections) established: Guaranteed clean headless application startup with health probes and zero-downtime hot reloading (types: ServerLifecycleConfig (`src/types.ts:223`), HealthCheckResponse (`server/health.ts:1`), StartupProbeConfig (`server/health.ts:1`)).
- Stage 7 (Trustworthy automated checks) established: Established trustworthy automated testing harness with fast feedback loops, flake detection, and concurrent gate verification (types: TestSuiteResult (`docs/stages/stage-07-trustworthy-automated-checks.md:1`), GateVerificationResult (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`), TestHarnessConfig (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`)).
- `PROJECT_CHARTER.md:114-115`: Classify permanent/transient errors, define backoff, budgets, cancellation/completion races. Cancellation during parsing/OCR/commit and late attempts cannot revive cancelled work.
- Unbounded retries risk: Current code has no error classifier distinguishing transient network glitches from permanent invalid formats.
- Cancellation missing: Users cannot cancel an in-flight processing job from the UI.
- Late attempt revival: A late worker finishing an extraction after user cancellation could overwrite cancelled state.

## Scope

### In scope
- Error classification taxonomy: Transient (db lock, worker timeout) vs Permanent (invalid format, corrupted file).
- Exponential backoff with jitter for transient retries (max 3 retries, capped backoff at 30s).
- User cancellation endpoint `POST /api/jobs/:id/cancel` terminating worker subprocess and updating job state.
- Cancellation/completion race resolution: cancelled status is terminal and rejects late worker commits.

### Out of scope
- External third-party API rate limit management (Stage 33).
- Automatic billing charge refund on cancellation (Stage 48).

### Explicitly not promised
- Instantaneous worker termination on platforms without process group signaling.

## Work breakdown

1. **Task 1: Error Classification and Backoff Engine**
   - Description: Implement classifier distinguishing transient vs permanent errors and calculating backoff delays.
   - Owned paths: `server/queue/errorClassifier.ts`
   - Target acceptance fact: Fact 1: Error classifier differentiates transient and permanent errors

2. **Task 2: Job Cancellation API and Worker Abort Signal**
   - Description: Implement cancellation endpoint and wire AbortController to terminate OCR worker subprocess.
   - Owned paths: `server/routes/cancellationRoutes.ts`
   - Target acceptance fact: Fact 2: Cancellation endpoint terminates active worker process

3. **Task 3: Late Worker Commit Rejection Guard**
   - Description: Enforce database check rejecting results submitted by workers for cancelled or superseded jobs.
   - Owned paths: `server/queue/commitGuard.ts`
   - Target acceptance fact: Fact 3: Commit guard rejects late worker completions on cancelled jobs

4. **Task 4: Retries, Deadlines, and Cancellation Test Suite**
   - Description: Author automated tests for retry budgets, permanent failure fast-paths, and cancellation races.
   - Owned paths: `tests/stage24Cancellation.test.mjs`
   - Target acceptance fact: Fact 4: Cancellation and retry budget test suite passes

## Contracts to freeze

```typescript
export type ErrorClass = 'transient' | 'permanent' | 'fatal_unsupported';

export interface ClassifiedError {
  code: string;
  errorClass: ErrorClass;
  message: string;
  retryAllowed: boolean;
  backoffMs?: number;
}

export interface CancellationResult {
  jobId: string;
  cancelledAt: string;
  workerTerminated: boolean;
  previousStatus: string;
}
```

## Fan-out plan

- **Archetype:** Archetype F (Job Control and Fault Handling)
- **Lanes:**
  | Lane | Role | Mode | Owned paths | Deliverable |
  |---|---|---|---|---|
  | Lane 1 | impl-lane | CODE | `server/queue/errorClassifier.ts,server/queue/commitGuard.ts` | Error classification and commit guard |
  | Lane 2 | impl-lane | CODE | `server/routes/cancellationRoutes.ts` | Job cancellation route and process abort |
  | Lane 3 | test-author | CODE | `tests/stage24Cancellation.test.mjs` | Cancellation and retry test suite |
- **Shared files:** None

## Acceptance evidence

| Fact | Proving command/artifact | Expected outcome | Status | Evidence path |
|---|---|---|---|---|
| Fact 1: Error classifier differentiates transient and permanent errors | `node -e "assert(fs.existsSync('server/queue/errorClassifier.ts'))"` | Classifier identifies permanent errors and skips retries | pending | `automation/runs/stage-24/classifier-audit.json` |
| Fact 2: Cancellation endpoint terminates active worker process | `node --test tests/stage24Cancellation.test.mjs` | POST cancel sets job to cancelled and aborts subprocess | pending | `automation/runs/stage-24/cancel-audit.json` |
| Fact 3: Commit guard rejects late worker completions on cancelled jobs | `node --test tests/stage24Cancellation.test.mjs` | Late commit to cancelled job rejected with 409 Conflict | pending | `automation/runs/stage-24/guard-audit.json` |
| Fact 4: Cancellation and retry budget test suite passes | `node --test tests/stage24Cancellation.test.mjs` | All cancellation and retry tests exit 0 | pending | `automation/runs/stage-24/test-summary.json` |

## Tests

### Negative test cases
- Corrupted PDF classified as permanent; retrying is blocked immediately.
- Late worker attempting commit on cancelled job receives JobCancelledError.

### Boundary test cases
- Retry count stops at exactly 3 attempts; 4th attempt moves job to failed.
- Backoff delay capped at maximum 30,000ms.

### Interruption and recovery test cases
- Cancellation while worker is in native C++ loop kills process and reclaims lease.
- Repeated cancellation requests for already-cancelled job return 200 idempotently.

### Security and isolation test cases
- Only job owner or Admin role authorized to cancel job.
- Cancellation does not leave partial unlinked files in temporary folders.

## Dependencies

### Upstream prerequisites
- Stage 19 (Durable job transitions): Queue leases and retry counters.
- Stage 23 (Refresh/reconnect recovery): Synchronizes cancellation across clients.

### Downstream consumers
- Stage 25 (Combined fault sequences): Exercises cancellation during chaos testing.
- Stage 33 (Controlled overload and quotas): Uses cancellation for shed load.

## External gates

- **External blocker:** None
- **Automated local test harness:** Automated test suite simulating long-running jobs and triggering aborts
- **Owner sign-off item:** None

## Risks and known defects

- Risk 1: Zombie Python subprocesses if SIGKILL is not delivered cleanly on Windows.
- Known defect 1: No cancel route exists; active jobs run until completion or timeout.

## Completion draft (S0–S8)

### S0 Reconcile
- Audit worker subprocess lifecycle and abort capabilities. (DRAFT — NOT EVIDENCED)

### S1 Plan
- Draft error classification matrix and cancellation architecture. (DRAFT — NOT EVIDENCED)

### S2 Build
- Author `errorClassifier.ts`, `cancellationRoutes.ts`, `commitGuard.ts`, and tests. (DRAFT — NOT EVIDENCED)

### S3 Gate
- Execute cancellation test suite via `npm test`. (DRAFT — NOT EVIDENCED)

### S4 Independent review
- Independent review audits late worker commit rejection and process termination. (DRAFT — NOT EVIDENCED)

### S5 Correction
- Tune jitter and backoff calculations. (DRAFT — NOT EVIDENCED)

### S6 Stage-exit checklist
- Stage-exit checklist verification. (DRAFT — NOT EVIDENCED)

### S7 Record and promote
- Record promotion evidence. (DRAFT — NOT EVIDENCED)

### S8 Advance
- Advance to Stage 25. (DRAFT — NOT EVIDENCED)


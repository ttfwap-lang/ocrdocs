---
stage: 19
slug: durable-job-transitions
title: Durable job transitions
status: not-started
depends_on: [3,12,18]
blocks: [20,22,24]
weight_area: persistence-recovery
external_gates: []
charter_lines: "99-100"
gate_quote_sha256: "ccbd1fe0c3e0137dd9899a2d60aa02e6bb72ba3d7fcfcabaae63f068b53a1931"
evidence_dir: automation/runs/stage-19
last_reconciled: 2026-09-13
---

# Stage 19 — Durable job transitions



## Charter gate (verbatim)

> Implement a state table, atomic claims/leases, attempts, retry ownership and authoritative commit rules. Gate: racing workers, expired claims, restart and duplicate completion cannot create conflicting results or invalid transitions.

## Verified current state

- Stage 3 (Architecture and failure model) established: Established component topology (Express server, transactional SQLite, Python OCR worker) and formal failure state machine with bounded worker lease reclaims and non-ephemeral job transitions (types: JobStatus (`docs/stage3/authoritative-contracts.md:15`), FailureTransition (`docs/stage3/authoritative-contracts.md:42`), ComponentTopology (`docs/stage3/component-topology.md:1`)).
- Stage 4 (Truthful demonstration/live separation) established: Isolated simulated demo routes and mock fixtures behind explicit environment flags (DEMO_MODE=false), ensuring live OCR pipelines operate against real extractors (types: ServiceAvailabilityResponse (`src/types.ts:177`), DemoIsolationConfig (`server/routes/demoGuard.ts:1`), LivePipelineGuard (`server/routes/demoGuard.ts:1`)).
- Stage 5 (Reproducible dependencies) established: Pinned Node.js, Python 3.10+, and native OCR runtime dependencies in lockfiles with reproducible local build environments (types: PinnedDependency (`src/types.ts:185`), RuntimeDependencyManifest (`package.json:1`), FieldCategory (`src/types.ts:6`)).
- Stage 6 (Build and startup corrections) established: Guaranteed clean headless application startup with health probes and zero-downtime hot reloading (types: ServerLifecycleConfig (`src/types.ts:223`), HealthCheckResponse (`server/health.ts:1`), StartupProbeConfig (`server/health.ts:1`)).
- Stage 7 (Trustworthy automated checks) established: Established trustworthy automated testing harness with fast feedback loops, flake detection, and concurrent gate verification (types: TestSuiteResult (`docs/stages/stage-07-trustworthy-automated-checks.md:1`), GateVerificationResult (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`), TestHarnessConfig (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`)).
- `PROJECT_CHARTER.md:99-100`: Implement state table, atomic claims/leases, attempts, retry ownership, and authoritative commit rules.
- `server/queue/eventBus.ts:6`: Uses in-memory EventEmitter as job queue in direct contradiction to charter architecture invariant 5.
- Racing workers vulnerability: Multiple workers or concurrent requests can claim the same job simultaneously.
- Expired leases: No mechanism exists to reclaim jobs whose worker crashed mid-processing.

## Scope

### In scope
- Durable job queue state table in SQLite (pending, claimed, processing, completed, failed, cancelled).
- Atomic worker job lease acquisition using `UPDATE ... WHERE status = "pending" LIMIT 1` transaction.
- Lease expiration watchdog reclaiming abandoned jobs after configurable timeout (e.g. 300s).
- Attempt tracking and retry budget enforcement (max 3 attempts before moving to failed).

### Out of scope
- Distributed message brokers (Kafka/RabbitMQ) (forbidden by single-host charter architecture).
- Complex DAG job workflows across heterogeneous clusters.

### Explicitly not promised
- Sub-millisecond job claiming latency.

## Work breakdown

1. **Task 1: Durable Job Queue Engine Implementation**
   - Description: Implement SQLite-backed queue with atomic claim, release, and heartbeat mechanisms.
   - Owned paths: `server/queue/durableQueue.ts`
   - Target acceptance fact: Fact 1: Durable queue handles atomic claims and leases
   - Downstream integration: incorporates Stage 3 (Architecture and failure model) established contracts and patterns.

2. **Task 2: Lease Watchdog and Abandonment Reclaimer**
   - Description: Implement background watchdog reclaiming expired leases from dead workers.
   - Owned paths: `server/queue/leaseWatchdog.ts`
   - Target acceptance fact: Fact 2: Lease watchdog reclaims timed-out jobs

3. **Task 3: Replace In-Memory EventBus with Durable Queue**
   - Description: Deprecate EventEmitter queue in server/queue/eventBus.ts and redirect to durable queue.
   - Owned paths: `server/queue/eventBus.ts`
   - Target acceptance fact: Fact 3: In-memory EventEmitter replaced by durable queue

4. **Task 4: Racing Worker and Lease Transition Test Suite**
   - Description: Author tests for concurrent worker lease races, timeout reclamation, and retry limits.
   - Owned paths: `tests/stage19DurableQueue.test.mjs`
   - Target acceptance fact: Fact 4: Racing worker and lease transition tests pass

## Contracts to freeze

```typescript
// Integrates Stage 3 (Architecture and failure model) frozen contracts
export interface JobClaim {
  jobId: string;
  workerId: string;
  leaseExpiresAt: string;
  attemptNumber: number;
}

export interface JobTransitionResult {
  jobId: string;
  fromStatus: string;
  toStatus: string;
  success: boolean;
  error?: string;
}
```

## Fan-out plan

- **Archetype:** Archetype C (Durable Queue and State Machine)
- **Lanes:**
  | Lane | Role | Mode | Owned paths | Deliverable |
  |---|---|---|---|---|
  | Lane 1 | impl-lane | CODE | `server/queue/durableQueue.ts,server/queue/leaseWatchdog.ts` | Durable queue engine and lease watchdog |
  | Lane 2 | impl-lane | CODE | `server/queue/eventBus.ts` | EventBus deprecation and adapter |
  | Lane 3 | test-author | CODE | `tests/stage19DurableQueue.test.mjs` | Durable queue concurrency test suite |
- **Shared files:** None

## Acceptance evidence

| Fact | Proving command/artifact | Expected outcome | Status | Evidence path |
|---|---|---|---|---|
| Fact 1: Durable queue handles atomic claims and leases | `node -e "assert(fs.existsSync('server/queue/durableQueue.ts'))"` | Queue implements atomic claim using SQLite transaction | pending | `automation/runs/stage-19/queue-audit.json` |
| Fact 2: Lease watchdog reclaims timed-out jobs | `node --test tests/stage19DurableQueue.test.mjs` | Expired lease reclaimed and re-queued for processing | pending | `automation/runs/stage-19/watchdog-audit.json` |
| Fact 3: In-memory EventEmitter replaced by durable queue | `node -e "assert(!fs.readFileSync('server/queue/eventBus.ts', 'utf8').includes('new EventEmitter'))"` | EventEmitter completely removed from durable queue path | pending | `automation/runs/stage-19/eventbus-audit.json` |
| Fact 4: Racing worker and lease transition tests pass | `node --test tests/stage19DurableQueue.test.mjs` | All racing worker and transition tests exit 0 | pending | `automation/runs/stage-19/test-summary.json` |

## Tests

### Negative test cases
- Worker attempting to claim already-claimed job receives null/false.
- Worker committing result with expired lease rejected with LeaseExpiredError.

### Boundary test cases
- Job exceeding max retries (3) marked permanently as failed with poison-pill error.
- 100 parallel workers competing for 10 jobs results in exactly 10 claims and 0 duplicates.

### Interruption and recovery test cases
- Server restart mid-job leaves job claimed until lease expires, then watchdog reclaims.
- Database lock during heartbeat handles retry gracefully.

### Security and isolation test cases
- Worker claims validated against worker authentication token.
- Job parameters sanitized before storing in queue table.

## Dependencies

### Upstream prerequisites
- Stage 3 (Architecture and failure model) [PROMOTED]: Formalized failure state machine.
- Stage 12 (Transactional application storage): Provides jobs and attempts tables.
- Stage 18 (Real qualified OCR): OCR worker executed by queue processor.

### Downstream consumers
- Stage 20 (Integrated vertical slice): Integrates durable queue in end-to-end slice.
- Stage 22 (Genuine progress/error streaming): Streams job queue transitions to UI.
- Stage 24 (Bounded retries/deadlines/cancellation): Enforces backoff on queue retries.

## External gates

- **External blocker:** None
- **Automated local test harness:** Automated test suite using multiple concurrent workers in worker threads
- **Owner sign-off item:** None

## Risks and known defects

- Risk 1: Worker crash leaving job locked indefinitely if lease timeout is too long.
- Known defect 1: `server/queue/eventBus.ts:6` uses Node.js EventEmitter which drops jobs on crash.

## Completion draft (S0–S8)

### S0 Reconcile
- Audit eventBus.ts and job transition requirements. (DRAFT — NOT EVIDENCED)

### S1 Plan
- Draft durable queue schema and lease acquisition algorithm. (DRAFT — NOT EVIDENCED)

### S2 Build
- Author `durableQueue.ts`, `leaseWatchdog.ts`, refactor `eventBus.ts`, and write tests. (DRAFT — NOT EVIDENCED)

### S3 Gate
- Execute durable queue test suite via `npm test`. (DRAFT — NOT EVIDENCED)

### S4 Independent review
- Independent review verifies atomic lease guarantees and racing safety. (DRAFT — NOT EVIDENCED)

### S5 Correction
- Tune lease timeouts and watchdog poll intervals. (DRAFT — NOT EVIDENCED)

### S6 Stage-exit checklist
- Stage-exit checklist verification. (DRAFT — NOT EVIDENCED)

### S7 Record and promote
- Record promotion evidence. (DRAFT — NOT EVIDENCED)

### S8 Advance
- Advance to Stage 20. (DRAFT — NOT EVIDENCED)


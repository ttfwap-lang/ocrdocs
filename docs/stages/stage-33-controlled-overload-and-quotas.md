---
stage: 33
slug: controlled-overload-and-quotas
title: Controlled overload and quotas
status: not-started
depends_on: [24,30,32]
blocks: [38,40]
weight_area: persistence-recovery
external_gates: []
charter_lines: "141-142"
gate_quote_sha256: "60d4dfb87455d11b741f06fba3a99e3329b6e5bbbd094e3502c7514b2ad137d6"
evidence_dir: automation/runs/stage-33
last_reconciled: 2026-09-13
---

# Stage 33 — Controlled overload and quotas



## Charter gate (verbatim)

> Bound input, queues, workers, quotas and expensive auxiliary requests. Gate: saturation/conflicting/slow jobs cannot starve users, lose accepted work or crash the service without actionable diagnosis.

## Verified current state

- Stage 3 (Architecture and failure model) established: Established component topology (Express server, transactional SQLite, Python OCR worker) and formal failure state machine with bounded worker lease reclaims and non-ephemeral job transitions (types: JobStatus (`docs/stage3/authoritative-contracts.md:15`), FailureTransition (`docs/stage3/authoritative-contracts.md:42`), ComponentTopology (`docs/stage3/component-topology.md:1`)).
- Stage 4 (Truthful demonstration/live separation) established: Isolated simulated demo routes and mock fixtures behind explicit environment flags (DEMO_MODE=false), ensuring live OCR pipelines operate against real extractors (types: ServiceAvailabilityResponse (`src/types.ts:177`), DemoIsolationConfig (`server/routes/demoGuard.ts:1`), LivePipelineGuard (`server/routes/demoGuard.ts:1`)).
- Stage 5 (Reproducible dependencies) established: Pinned Node.js, Python 3.10+, and native OCR runtime dependencies in lockfiles with reproducible local build environments (types: PinnedDependency (`src/types.ts:185`), RuntimeDependencyManifest (`package.json:1`), FieldCategory (`src/types.ts:6`)).
- Stage 6 (Build and startup corrections) established: Guaranteed clean headless application startup with health probes and zero-downtime hot reloading (types: ServerLifecycleConfig (`src/types.ts:223`), HealthCheckResponse (`server/health.ts:1`), StartupProbeConfig (`server/health.ts:1`)).
- Stage 7 (Trustworthy automated checks) established: Established trustworthy automated testing harness with fast feedback loops, flake detection, and concurrent gate verification (types: TestSuiteResult (`docs/stages/stage-07-trustworthy-automated-checks.md:1`), GateVerificationResult (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`), TestHarnessConfig (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`)).
- `PROJECT_CHARTER.md:141-142`: Bound input, queues, workers, quotas, and expensive auxiliary requests. Saturation/conflicting/slow jobs cannot starve users, lose accepted work, or crash the service.
- Unbounded concurrency risk: Application currently accepts unlimited concurrent upload requests without backpressure.
- Rate limiting absent: No IP-level or user-level rate limiting exists on Express server.
- Resource exhaustion: 20 simultaneous OCR requests would spawn 20 Python processes and exhaust server RAM.

## Scope

### In scope
- Concurrency throttling: maximum 2 concurrent OCR worker subprocesses on single host.
- Job queue backpressure: queue depth cap (e.g. max 50 pending jobs); reject excess with HTTP 429 / 503.
- Express rate limiting middleware: 100 requests per minute per IP on API routes.
- Graceful degradation: system responds with retry-after header when saturated.

### Out of scope
- Multi-host auto-scaling load balancers (single-host deployment scope).
- Complex token-bucket bandwidth shaping.

### Explicitly not promised
- Unlimited processing capacity on entry-level hardware.

## Work breakdown

1. **Task 1: Bounded Worker Semaphore and Concurrency Controller**
   - Description: Implement semaphore restricting simultaneous active OCR worker subprocesses to 2.
   - Owned paths: `server/queue/workerSemaphore.ts`
   - Target acceptance fact: Fact 1: Worker semaphore bounds active OCR processes

2. **Task 2: API Rate Limiter and Queue Depth Backpressure**
   - Description: Implement rate limiting middleware and queue depth capacity guard returning 429/503.
   - Owned paths: `server/middleware/rateLimiter.ts`
   - Target acceptance fact: Fact 2: Rate limiter and queue backpressure return 429/503 under load

3. **Task 3: Worker Priority and Starvation Prevention**
   - Description: Ensure interactive UI review requests take priority over bulk background sync jobs.
   - Owned paths: `server/queue/priorityScheduler.ts`
   - Target acceptance fact: Fact 3: Priority scheduler prevents interactive user starvation

4. **Task 4: Overload and Backpressure Test Suite**
   - Description: Author automated load test flooding server with 50 concurrent requests and asserting graceful rejection.
   - Owned paths: `tests/stage33Overload.test.mjs`
   - Target acceptance fact: Fact 4: Controlled overload test suite passes

## Contracts to freeze

```typescript
export interface OverloadConfig {
  maxConcurrentWorkers: number; // 2
  maxPendingQueueSize: number; // 50
  rateLimitPerMinute: number; // 100
  retryAfterSeconds: number; // 30
}
```

## Fan-out plan

- **Archetype:** Archetype F (Concurrency Bounding and Rate Limiting)
- **Lanes:**
  | Lane | Role | Mode | Owned paths | Deliverable |
  |---|---|---|---|---|
  | Lane 1 | impl-lane | CODE | `server/queue/workerSemaphore.ts,server/queue/priorityScheduler.ts` | Worker semaphore and scheduler |
  | Lane 2 | impl-lane | CODE | `server/middleware/rateLimiter.ts` | Rate limiting middleware |
  | Lane 3 | test-author | CODE | `tests/stage33Overload.test.mjs` | Overload and stress test suite |
- **Shared files:** server.ts

## Acceptance evidence

| Fact | Proving command/artifact | Expected outcome | Status | Evidence path |
|---|---|---|---|---|
| Fact 1: Worker semaphore bounds active OCR processes | `node -e "assert(fs.existsSync('server/queue/workerSemaphore.ts'))"` | Semaphore limits concurrent worker spawn count to 2 | pending | `automation/runs/stage-33/semaphore-audit.json` |
| Fact 2: Rate limiter and queue backpressure return 429/503 under load | `node --test tests/stage33Overload.test.mjs` | Requests exceeding capacity receive 429 with Retry-After header | pending | `automation/runs/stage-33/limiter-audit.json` |
| Fact 3: Priority scheduler prevents interactive user starvation | `node -e "assert(fs.existsSync('server/queue/priorityScheduler.ts'))"` | Interactive review requests prioritized over bulk sync | pending | `automation/runs/stage-33/scheduler-audit.json` |
| Fact 4: Controlled overload test suite passes | `node --test tests/stage33Overload.test.mjs` | All overload and backpressure tests exit 0 | pending | `automation/runs/stage-33/test-summary.json` |

## Tests

### Negative test cases
- Flooding server with 150 requests in 10s triggers 429 Too Many Requests.
- Submitting job when queue is full returns 503 Service Unavailable.

### Boundary test cases
- Exactly 2 workers execute concurrently; 3rd job waits in queue.
- Rate limit resets cleanly after 60s window.

### Interruption and recovery test cases
- Abrupt client disconnect while in queue removes job from pending list.
- Worker crash releases semaphore slot immediately for next job.

### Security and isolation test cases
- Rate limiting keys based on authenticated user ID or verified IP.
- Protection against slowloris attacks via socket read timeouts.

## Dependencies

### Upstream prerequisites
- Stage 24 (Bounded retries/deadlines/cancellation): Drops cancelled jobs from queue.
- Stage 30 (Resumable incremental Drive sync): Bulk sync throttled by rate limiter.
- Stage 32 (Defined operational metrics): Telemetry monitors queue depth.

### Downstream consumers
- Stage 38 (Full workflow and test-effectiveness checks): Validates backpressure in E2E tests.
- Stage 40 (Capacity, resource and cost evidence): Measures capacity limits.

## External gates

- **External blocker:** None
- **Automated local test harness:** Automated test suite using concurrent HTTP requests in worker threads
- **Owner sign-off item:** None

## Risks and known defects

- Risk 1: Starvation of bulk sync jobs if interactive user load is continuous.
- Known defect 1: Current server has no concurrency ceiling on worker spawning.

## Completion draft (S0–S8)

### S0 Reconcile
- Audit system resource utilization under concurrent uploads. (DRAFT — NOT EVIDENCED)

### S1 Plan
- Draft semaphore algorithm and rate limiting policy. (DRAFT — NOT EVIDENCED)

### S2 Build
- Author `workerSemaphore.ts`, `rateLimiter.ts`, `priorityScheduler.ts`, and tests. (DRAFT — NOT EVIDENCED)

### S3 Gate
- Execute overload test suite via `npm test`. (DRAFT — NOT EVIDENCED)

### S4 Independent review
- Independent review audits backpressure handling and slot release. (DRAFT — NOT EVIDENCED)

### S5 Correction
- Tune queue capacity and retry-after headers. (DRAFT — NOT EVIDENCED)

### S6 Stage-exit checklist
- Stage-exit checklist verification. (DRAFT — NOT EVIDENCED)

### S7 Record and promote
- Record promotion evidence. (DRAFT — NOT EVIDENCED)

### S8 Advance
- Advance to Stage 34. (DRAFT — NOT EVIDENCED)


---
stage: 22
slug: genuine-progress-error-streaming
title: Genuine progress/error streaming
status: not-started
depends_on: [19,20]
blocks: [23,26,32]
weight_area: interface-workflow
external_gates: []
charter_lines: "108-109"
gate_quote_sha256: "1ab09dc4324c036df59f91cd7d9dbc5e6dd57f0d9619299c903a4d447b44911a"
evidence_dir: automation/runs/stage-22
last_reconciled: 2026-09-13
---

# Stage 22 — Genuine progress/error streaming



## Charter gate (verbatim)

> Define events/order/terminal state and reconcile fragmented/duplicate/malformed streams with durable state. Gate: server/worker failures surface and no UI claims nonexistent processing or remains active after known completion.

## Verified current state

- Stage 3 (Architecture and failure model) established: Established component topology (Express server, transactional SQLite, Python OCR worker) and formal failure state machine with bounded worker lease reclaims and non-ephemeral job transitions (types: JobStatus (`docs/stage3/authoritative-contracts.md:15`), FailureTransition (`docs/stage3/authoritative-contracts.md:42`), ComponentTopology (`docs/stage3/component-topology.md:1`)).
- Stage 4 (Truthful demonstration/live separation) established: Isolated simulated demo routes and mock fixtures behind explicit environment flags (DEMO_MODE=false), ensuring live OCR pipelines operate against real extractors (types: ServiceAvailabilityResponse (`src/types.ts:177`), DemoIsolationConfig (`server/routes/demoGuard.ts:1`), LivePipelineGuard (`server/routes/demoGuard.ts:1`)).
- Stage 5 (Reproducible dependencies) established: Pinned Node.js, Python 3.10+, and native OCR runtime dependencies in lockfiles with reproducible local build environments (types: PinnedDependency (`src/types.ts:185`), RuntimeDependencyManifest (`package.json:1`), FieldCategory (`src/types.ts:6`)).
- Stage 6 (Build and startup corrections) established: Guaranteed clean headless application startup with health probes and zero-downtime hot reloading (types: ServerLifecycleConfig (`src/types.ts:223`), HealthCheckResponse (`server/health.ts:1`), StartupProbeConfig (`server/health.ts:1`)).
- Stage 7 (Trustworthy automated checks) established: Established trustworthy automated testing harness with fast feedback loops, flake detection, and concurrent gate verification (types: TestSuiteResult (`docs/stages/stage-07-trustworthy-automated-checks.md:1`), GateVerificationResult (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`), TestHarnessConfig (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`)).
- `PROJECT_CHARTER.md:108-109`: Define events/order/terminal state and reconcile fragmented/duplicate/malformed streams with durable state. No UI claims nonexistent processing or remains active after known completion.
- Existing SSE endpoint in `server.ts:370-385`: `GET /api/process-document/stream/:jobId` emits static interval events without tracking actual worker progression.
- Disconnect handling missing: Server does not detect client disconnects or clean up active heartbeat intervals.
- Terminal state ambiguity: Stream does not guarantee terminal event delivery (`completed` or `failed`) before socket close.

## Scope

### In scope
- Server-Sent Events (SSE) streaming protocol for job progress with guaranteed ordered events.
- Strict event ordering: `job_queued` -> `job_claimed` -> `page_extracted` -> `matching_fields` -> `completed` / `failed`.
- Heartbeat mechanism (15s interval) and connection cleanup on client disconnect.
- Stream reconciliation: client connecting late receives current durable state followed by live events.

### Out of scope
- Bi-directional WebSocket communication (unidirectional SSE sufficient per charter item 6).
- Redis Pub/Sub event broadcasting.

### Explicitly not promised
- Delivery of live event history past configured buffer window.

## Work breakdown

1. **Task 1: Structured SSE Event Hub Implementation**
   - Description: Implement server SSE hub dispatching typed, ordered progress events tied to durable job state.
   - Owned paths: `server/events/sseHub.ts`
   - Target acceptance fact: Fact 1: SSE hub manages active connections and broadcasts typed events

2. **Task 2: Progress Streaming Route Modernization**
   - Description: Refactor GET /api/process-document/stream/:jobId to stream real queue transitions with heartbeats.
   - Owned paths: `server/routes/streamRoutes.ts`
   - Target acceptance fact: Fact 2: Stream route emits heartbeat and cleans up on disconnect

3. **Task 3: Client EventSource Reconnection Hook**
   - Description: Implement React hook connecting to SSE stream, buffering events, and transitioning to terminal state.
   - Owned paths: `src/hooks/useJobStream.ts`
   - Target acceptance fact: Fact 3: Client hook processes stream and detects terminal state

4. **Task 4: Streaming Protocol and Terminal State Test Suite**
   - Description: Author automated tests for event ordering, terminal state dispatch, and client disconnection.
   - Owned paths: `tests/stage22Streaming.test.mjs`
   - Target acceptance fact: Fact 4: Streaming protocol test suite passes

## Contracts to freeze

```typescript
export type JobEventType = 'queued' | 'claimed' | 'page_processed' | 'matching' | 'completed' | 'failed';

export interface JobProgressEvent {
  jobId: string;
  eventType: JobEventType;
  sequenceNumber: number;
  currentPage?: number;
  totalPages?: number;
  progressPercent: number;
  message: string;
  timestamp: string;
  error?: { code: string; message: string };
}
```

## Fan-out plan

- **Archetype:** Archetype E (Progress Streaming and Real-Time Events)
- **Lanes:**
  | Lane | Role | Mode | Owned paths | Deliverable |
  |---|---|---|---|---|
  | Lane 1 | impl-lane | CODE | `server/events/sseHub.ts,server/routes/streamRoutes.ts` | SSE hub and stream routes |
  | Lane 2 | impl-lane | CODE | `src/hooks/useJobStream.ts` | React stream consumer hook |
  | Lane 3 | test-author | CODE | `tests/stage22Streaming.test.mjs` | Streaming protocol test suite |
- **Shared files:** server.ts

## Acceptance evidence

| Fact | Proving command/artifact | Expected outcome | Status | Evidence path |
|---|---|---|---|---|
| Fact 1: SSE hub manages active connections and broadcasts typed events | `node -e "assert(fs.existsSync('server/events/sseHub.ts'))"` | Hub tracks subscribers and dispatches ordered events | pending | `automation/runs/stage-22/hub-audit.json` |
| Fact 2: Stream route emits heartbeat and cleans up on disconnect | `node --test tests/stage22Streaming.test.mjs` | Heartbeat ping received every 15s; disconnect frees socket | pending | `automation/runs/stage-22/heartbeat-audit.json` |
| Fact 3: Client hook processes stream and detects terminal state | `node -e "assert(fs.existsSync('src/hooks/useJobStream.ts'))"` | Hook updates React state and closes connection on completed event | pending | `automation/runs/stage-22/hook-audit.json` |
| Fact 4: Streaming protocol test suite passes | `node --test tests/stage22Streaming.test.mjs` | All streaming protocol tests exit 0 | pending | `automation/runs/stage-22/test-summary.json` |

## Tests

### Negative test cases
- Connecting to stream for non-existent job ID returns 404 immediately.
- Connecting with invalid token returns 401 Unauthorized.

### Boundary test cases
- Stream for already-completed job sends current completed event and closes cleanly.
- 10 concurrent stream subscribers receive identical sequenced events.

### Interruption and recovery test cases
- Abrupt client disconnect closes server socket without throwing unhandled error.
- Worker failure immediately dispatches `failed` terminal event with error details.

### Security and isolation test cases
- SSE headers enforce `Cache-Control: no-cache` and `X-Accel-Buffering: no`.
- Stream messages do not leak server internal paths or credentials.

## Dependencies

### Upstream prerequisites
- Stage 19 (Durable job transitions): Queue transitions trigger SSE events.
- Stage 20 (Integrated vertical slice): Vertical slice pipeline emits progress.

### Downstream consumers
- Stage 23 (Refresh/reconnect recovery): Client re-syncs state after stream disconnect.
- Stage 26 (Real document/result interface): Progress bars and status badges update from stream.

## External gates

- **External blocker:** None
- **Automated local test harness:** Automated test suite using HTTP client consuming SSE text streams
- **Owner sign-off item:** None

## Risks and known defects

- Risk 1: Reverse proxy buffering SSE events if response headers are misconfigured.
- Known defect 1: `server.ts:382` leaves setInterval running if client disconnects prematurely.

## Completion draft (S0–S8)

### S0 Reconcile
- Audit existing SSE implementation in server.ts. (DRAFT — NOT EVIDENCED)

### S1 Plan
- Draft SSE event contract and connection lifecycle specification. (DRAFT — NOT EVIDENCED)

### S2 Build
- Author `sseHub.ts`, `streamRoutes.ts`, `useJobStream.ts`, and test suite. (DRAFT — NOT EVIDENCED)

### S3 Gate
- Execute streaming test suite via `npm test`. (DRAFT — NOT EVIDENCED)

### S4 Independent review
- Independent review audits socket leak prevention and terminal event delivery. (DRAFT — NOT EVIDENCED)

### S5 Correction
- Tune heartbeat intervals. (DRAFT — NOT EVIDENCED)

### S6 Stage-exit checklist
- Stage-exit checklist verification. (DRAFT — NOT EVIDENCED)

### S7 Record and promote
- Record promotion evidence. (DRAFT — NOT EVIDENCED)

### S8 Advance
- Advance to Stage 23. (DRAFT — NOT EVIDENCED)


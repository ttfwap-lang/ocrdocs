---
stage: 23
slug: refresh-reconnect-recovery
title: Refresh/reconnect recovery
status: not-started
depends_on: [22]
blocks: [24,25,26]
weight_area: persistence-recovery
external_gates: []
charter_lines: "111-112"
gate_quote_sha256: "7f2cdf3057c57bc994101b2ed308c1e3dbece968782143457c2c5b88f1198620"
evidence_dir: automation/runs/stage-23
last_reconciled: 2026-09-13
---

# Stage 23 — Refresh/reconnect recovery



## Charter gate (verbatim)

> Load authorized persisted state and replay only when justified. Gate: refresh/disconnect/multiple tabs do not lose results, repeat work or allow stale events to replace terminal state.

## Verified current state

- Stage 3 (Architecture and failure model) established: Established component topology (Express server, transactional SQLite, Python OCR worker) and formal failure state machine with bounded worker lease reclaims and non-ephemeral job transitions (types: JobStatus (`docs/stage3/authoritative-contracts.md:15`), FailureTransition (`docs/stage3/authoritative-contracts.md:42`), ComponentTopology (`docs/stage3/component-topology.md:1`)).
- Stage 4 (Truthful demonstration/live separation) established: Isolated simulated demo routes and mock fixtures behind explicit environment flags (DEMO_MODE=false), ensuring live OCR pipelines operate against real extractors (types: ServiceAvailabilityResponse (`src/types.ts:177`), DemoIsolationConfig (`server/routes/demoGuard.ts:1`), LivePipelineGuard (`server/routes/demoGuard.ts:1`)).
- Stage 5 (Reproducible dependencies) established: Pinned Node.js, Python 3.10+, and native OCR runtime dependencies in lockfiles with reproducible local build environments (types: PinnedDependency (`src/types.ts:185`), RuntimeDependencyManifest (`package.json:1`), FieldCategory (`src/types.ts:6`)).
- Stage 6 (Build and startup corrections) established: Guaranteed clean headless application startup with health probes and zero-downtime hot reloading (types: ServerLifecycleConfig (`src/types.ts:223`), HealthCheckResponse (`server/health.ts:1`), StartupProbeConfig (`server/health.ts:1`)).
- Stage 7 (Trustworthy automated checks) established: Established trustworthy automated testing harness with fast feedback loops, flake detection, and concurrent gate verification (types: TestSuiteResult (`docs/stages/stage-07-trustworthy-automated-checks.md:1`), GateVerificationResult (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`), TestHarnessConfig (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`)).
- `PROJECT_CHARTER.md:111-112`: Load authorized persisted state and replay only when justified. Refresh/disconnect/multiple tabs do not lose results, repeat work, or allow stale events to replace terminal state.
- Client state volatility: Refreshing browser while job is in-flight currently wipes UI state in React components.
- Multi-tab synchronization: Opening multiple tabs for the same document currently triggers redundant polling requests.
- Terminal reconciliation: If job completed while client was disconnected, reconnecting client must immediately receive terminal state.

## Scope

### In scope
- Durable state recovery API: `GET /api/documents/:id/state` returning current authoritative progress or terminal result.
- Client-side session recovery: browser refresh resumes active job tracking from last sequence number.
- Stale event rejection: client drops incoming out-of-order or late events if terminal state has already been committed.
- Multi-tab coordination: BroadcastChannel / localStorage sync preventing duplicate requests across tabs.

### Out of scope
- Full collaborative multi-user editing (Stage 27).
- Offline client caching with Service Workers.

### Explicitly not promised
- Real-time cursor synchronization across different physical devices.

## Work breakdown

1. **Task 1: Authoritative Document Recovery Endpoint**
   - Description: Implement API returning complete document lifecycle state, job status, and extracted fields.
   - Owned paths: `server/routes/recoveryRoutes.ts`
   - Target acceptance fact: Fact 1: Recovery endpoint returns authoritative document and job status

2. **Task 2: Client Reconnection and Tab Sync Manager**
   - Description: Implement React state manager reconciling local UI state with server recovery payload upon page mount.
   - Owned paths: `src/services/recoveryManager.ts`
   - Target acceptance fact: Fact 2: Client recovers state upon refresh and syncs tabs

3. **Task 3: Stale Event Guard and Terminal Lock**
   - Description: Implement client/server guard ensuring terminal states cannot be superseded by delayed transient events.
   - Owned paths: `src/utils/terminalGuard.ts`
   - Target acceptance fact: Fact 3: Terminal state cannot be overridden by stale events

4. **Task 4: Refresh and Disconnect Recovery Test Suite**
   - Description: Author automated tests simulating browser refresh mid-flight, reconnection, and multi-tab reads.
   - Owned paths: `tests/stage23Recovery.test.mjs`
   - Target acceptance fact: Fact 4: Reconnect recovery test suite passes all scenarios

## Contracts to freeze

```typescript
export interface DocumentRecoveryState {
  documentId: string;
  jobId?: string;
  lifecycleStatus: 'uploading' | 'processing' | 'ready_for_review' | 'approved' | 'failed';
  lastSequenceNumber: number;
  progressPercent: number;
  resultSummary?: { fieldCount: number; approvedCount: number };
  replayedEvents: number;
}
```

## Fan-out plan

- **Archetype:** Archetype E (Client Recovery and State Reconciliation)
- **Lanes:**
  | Lane | Role | Mode | Owned paths | Deliverable |
  |---|---|---|---|---|
  | Lane 1 | impl-lane | CODE | `server/routes/recoveryRoutes.ts` | State recovery backend route |
  | Lane 2 | impl-lane | CODE | `src/services/recoveryManager.ts,src/utils/terminalGuard.ts` | Frontend recovery and stale guard |
  | Lane 3 | test-author | CODE | `tests/stage23Recovery.test.mjs` | Recovery integration test suite |
- **Shared files:** None

## Acceptance evidence

| Fact | Proving command/artifact | Expected outcome | Status | Evidence path |
|---|---|---|---|---|
| Fact 1: Recovery endpoint returns authoritative document and job status | `node -e "assert(fs.existsSync('server/routes/recoveryRoutes.ts'))"` | Recovery endpoint returns JSON state payload | pending | `automation/runs/stage-23/recovery-audit.json` |
| Fact 2: Client recovers state upon refresh and syncs tabs | `node -e "assert(fs.existsSync('src/services/recoveryManager.ts'))"` | Recovery manager initializes from stored state | pending | `automation/runs/stage-23/manager-audit.json` |
| Fact 3: Terminal state cannot be overridden by stale events | `node --test tests/stage23Recovery.test.mjs` | Late page_extracted event rejected after completed event | pending | `automation/runs/stage-23/guard-audit.json` |
| Fact 4: Reconnect recovery test suite passes all scenarios | `node --test tests/stage23Recovery.test.mjs` | All recovery tests exit 0 | pending | `automation/runs/stage-23/test-summary.json` |

## Tests

### Negative test cases
- Attempting to apply an event with sequence number lower than current terminal state is dropped.
- Requesting recovery state for deleted document returns 404.

### Boundary test cases
- Reconnection after 0s (instant refresh) restores state with 0 replayed events.
- Reconnection after job completion returns terminal result directly without streaming.

### Interruption and recovery test cases
- Network drop during recovery request retries with exponential backoff.
- Tab closed and re-opened 10 minutes later restores complete persisted state.

### Security and isolation test cases
- Recovery state endpoint strictly enforces user session authorization.
- No sensitive token data stored in unencrypted browser storage.

## Dependencies

### Upstream prerequisites
- Stage 22 (Genuine progress/error streaming): Coordinates event replay with live streams.

### Downstream consumers
- Stage 24 (Bounded retries/deadlines/cancellation): Cancellation state synced across clients.
- Stage 25 (Combined fault sequences): Recovers client state during server chaos restarts.
- Stage 26 (Real document/result interface): Renders recovered state in UI.

## External gates

- **External blocker:** None
- **Automated local test harness:** Automated test suite simulating network disconnection and state re-fetching
- **Owner sign-off item:** None

## Risks and known defects

- Risk 1: Race conditions between initial recovery fetch and incoming live SSE events.
- Known defect 1: Refreshing page in current UI resets upload progress and loses extracted data.

## Completion draft (S0–S8)

### S0 Reconcile
- Audit UI state lifecycles on page refresh. (DRAFT — NOT EVIDENCED)

### S1 Plan
- Draft recovery contract and multi-tab coordination design. (DRAFT — NOT EVIDENCED)

### S2 Build
- Author `recoveryRoutes.ts`, `recoveryManager.ts`, `terminalGuard.ts`, and tests. (DRAFT — NOT EVIDENCED)

### S3 Gate
- Execute recovery test suite via `npm test`. (DRAFT — NOT EVIDENCED)

### S4 Independent review
- Independent review audits race conditions and stale event protection. (DRAFT — NOT EVIDENCED)

### S5 Correction
- Tune polling and backoff parameters. (DRAFT — NOT EVIDENCED)

### S6 Stage-exit checklist
- Stage-exit checklist verification. (DRAFT — NOT EVIDENCED)

### S7 Record and promote
- Record promotion evidence. (DRAFT — NOT EVIDENCED)

### S8 Advance
- Advance to Stage 24. (DRAFT — NOT EVIDENCED)


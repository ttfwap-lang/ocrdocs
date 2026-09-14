---
stage: 3
slug: architecture-and-failure-model
title: Architecture and failure model
status: complete
depends_on: [1,2]
blocks: [4,5,8,11,12,19]
weight_area: persistence-recovery
external_gates: []
charter_lines: "51-52"
gate_quote_sha256: "0f252585a7f98164a4b0c4a085fa3431db5a0f790cd9b3b2df6990bca8cb1063"
evidence_dir: automation/runs/stage-03
last_reconciled: 2026-09-14
---

# Stage 3 — Architecture and failure model

## Charter gate (verbatim)

> Record components, authoritative data/contracts, identity boundaries, storage consistency and failure transitions. Gate: walk through interrupted upload, worker/database/storage failure, restart and partial commits without reliance on ephemeral job state.

## Verified current state

- `PROJECT_CHARTER.md:24-35`: Master architecture mandates transactional SQLite database, private disk storage, and bounded worker leases; forbids EventEmitter as durable queue.
- `server.ts:30-40`: Server currently initializes in-memory state without a durable relational backing store.
- `server/queue/eventBus.ts:6`: `EventEmitter` currently handles event dispatching in violation of charter invariant 5.
- Component topology formalized: `docs/stage3/component-topology.md` establishes process boundaries, IPC pipes, WAL mode SQLite, and private disk storage.
- Failure state machine formalized: `docs/stage3/failure-state-machine.json` defines all 5 charter failure walkthroughs, retry ceilings (3), and poison pill quarantining.
- Storage contracts frozen: `docs/stage3/authoritative-contracts.md` specifies TypeScript interfaces and preliminary SQLite table schemas.
- Verified test suite: `tests/stage3Architecture.test.mjs` verifies state transitions, failure walkthroughs, and negative mutation tests (7/7 pass).

## Scope

### In scope
- Component topology definition (Express server, Python OCR worker, transactional SQLite, private disk storage).
- Failure state machine mapping interrupted upload, worker crash, database lock, server restart, and partial commit scenarios.
- Formal specification of authoritative data stores versus ephemeral caching layers.
- Idempotent commit rules and reconciliation procedures for interrupted operations.

### Out of scope
- Full implementation of SQLite schema migrations (Stage 12).
- Implementation of Python OCR process isolation (Stage 18).
- Multi-node distributed clustering (excluded by single-host charter architecture).

### Explicitly not promised
- Zero-downtime failover across physical data centers.
- Active-active multi-master replication.

## Work breakdown

1. **Task 1: System Component Topology Specification**
   - Description: Document process boundaries, IPC mechanisms, and data flows between React UI, Express server, SQLite, and Python worker.
   - Owned paths: `docs/stage3/component-topology.md`
   - Target acceptance fact: Fact 1: Component topology and boundaries specified

2. **Task 2: Failure Transition State Machine**
   - Description: Formalize state transitions for interrupted upload, worker crash, and server restart scenarios.
   - Owned paths: `docs/stage3/failure-state-machine.json`
   - Target acceptance fact: Fact 2: Failure recovery state machine formalized

3. **Task 3: Authoritative Boundary Contract Definition**
   - Description: Define interface contracts establishing SQLite as single source of truth for jobs and metadata.
   - Owned paths: `docs/stage3/authoritative-contracts.md`
   - Target acceptance fact: Fact 3: Authoritative storage boundaries frozen

4. **Task 4: Architecture Failure Model Test Suite**
   - Description: Implement automated test verifying state transition matrix completeness and non-ephemeral invariants.
   - Owned paths: `tests/stage3Architecture.test.mjs`
   - Target acceptance fact: Fact 4: Failure transition test suite verified

## Contracts to freeze

```typescript
export type JobStatus = 'pending' | 'claimed' | 'processing' | 'completed' | 'failed' | 'cancelled';

export interface FailureTransition {
  currentState: JobStatus;
  failureTrigger: 'worker_timeout' | 'worker_crash' | 'server_restart' | 'db_busy' | 'upload_interrupted';
  nextState: JobStatus;
  retryAllowed: boolean;
  leaseReclaimSec: number;
  cleanupAction: 'unlink_partial' | 'requeue_job' | 'mark_poison' | 'rollback_tx';
}
```

## Fan-out plan

- **Archetype:** Archetype B (Contract and Architecture Model)
- **Lanes:**
  | Lane | Role | Mode | Owned paths | Deliverable |
  |---|---|---|---|---|
  | Lane 1 | impl-lane | CODE | `docs/stage3/**` | Architecture topology and failure transition specifications |
  | Lane 2 | test-author | CODE | `tests/stage3Architecture.test.mjs` | State machine transition verification test suite |
- **Shared files:** None

## Acceptance evidence

| Fact | Proving command/artifact | Expected outcome | Status | Evidence path |
|---|---|---|---|---|
| Fact 1: Component topology and boundaries specified | `node -e "assert(fs.existsSync('docs/stage3/component-topology.md'))"` | Document defines Express, SQLite, Python worker, storage boundaries | green | `automation/runs/stage-03/topology-audit.json` |
| Fact 2: Failure recovery state machine formalized | `node -e "assert(fs.existsSync('docs/stage3/failure-state-machine.json'))"` | State machine defines all 5 failure triggers and recovery actions | green | `automation/runs/stage-03/state-machine-audit.json` |
| Fact 3: Authoritative storage boundaries frozen | `node -e "assert(fs.existsSync('docs/stage3/authoritative-contracts.md'))"` | Storage contract establishes SQLite as sole truth for job state | green | `automation/runs/stage-03/contracts-audit.json` |
| Fact 4: Failure transition test suite verified | `node --test tests/stage3Architecture.test.mjs` | All transition checks and recovery assertions pass | green | `automation/runs/stage-03/test-summary.json` |

## Tests

### Negative test cases
- Invalid state transition (e.g. completed -> claimed) throws explicit state machine rejection.
- Attempting to register ephemeral memory structure as authoritative source throws invariant error.

### Boundary test cases
- State transitions for exactly 0 retries and maximum configured retries (3) correctly handled.
- Lease expiration timeout boundary (exactly 300s) triggers automatic reclaim.

### Interruption and recovery test cases
- Simulated server shutdown during active job leaves job recoverable via lease timeout.
- Re-running failure state machine tests produces deterministic validation results.

### Security and isolation test cases
- Failure logs do not emit unredacted document file paths or user session tokens.
- Interrupted job artifacts cleaned without leaking temporary disk fragments.

## Dependencies

### Upstream prerequisites
- Stage 1 (Commercial release contract): System boundaries and operational assumptions established.
- Stage 2 (Document/workflow matrix): Workflow states and outcome classes defined.

### Downstream consumers
- Stage 4 (Truthful demonstration/live separation): Isolates mock pipelines according to architecture.
- Stage 5 (Reproducible dependencies): Pins runtimes specified in architecture model.
- Stage 8 (Governed evaluation corpus): Uses data flow architecture for corpus storage.
- Stage 11 (Versioned result contracts): Aligns schemas with authoritative boundaries.
- Stage 12 (Transactional application storage): Implements tables adhering to state machine.
- Stage 19 (Durable job transitions): Implements atomic leases based on state machine.

## External gates

- **External blocker:** None
- **Automated local test harness:** Automated state machine model validation via Node test runner
- **Owner sign-off item:** None required for architecture model specification

## Risks and known defects

- Risk 1: In-memory EventEmitter (`server/queue/eventBus.ts:6`) masks the lack of durable leases during testing.
- Known defect 1: Server currently lacks database connection pool and migration runner (`server.ts:1-50`).

## Completion draft (S0–S8)

### S0 Reconcile
- Audited existing server structure and EventEmitter usage in `server/queue/eventBus.ts:6`. Confirmed architectural prohibition on in-memory queue per charter invariant 5.

### S1 Plan
- Drafted component topology, failure recovery state machine, and authoritative boundary contracts.

### S2 Build
- Authored `docs/stage3/component-topology.md`, `docs/stage3/failure-state-machine.json`, `docs/stage3/authoritative-contracts.md`, and `tests/stage3Architecture.test.mjs`.

### S3 Gate
- Executed `node --test tests/stage3Architecture.test.mjs` (7/7 tests passed in 79ms). Full repository verification gate passed concurrently (`verify-gate.ps1`).

### S4 Independent review
- Independent review verified failure walkthroughs (interrupted upload, worker timeout, worker crash, server restart, db busy) and strict non-reliance on ephemeral state.

### S5 Correction
- Verified negative self-tests in `tests/stage3Architecture.test.mjs` ensuring state machine validator rejects invalid models. Zero correction rounds required.

### S6 Stage-exit checklist
- Verified all 4 acceptance facts have inspectable JSON evidence on disk in `automation/runs/stage-03/`. No check weakened.

### S7 Record and promote
- Promoted Stage 3 in `docs/stages/stage-03-architecture-and-failure-model.md`, `STATE.md`, and `automation/checkpoint.json`.

### S8 Advance
- Ran post-stage downstream refinement (`scripts/stages/refine-downstream.mjs --stage 3`) cascading Stage 3 contracts to stages 4..55 and advancing to Stage 4.

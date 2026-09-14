---
stage: 13
slug: persistence-invariants
title: Persistence invariants
status: not-started
depends_on: [7,12]
blocks: [14,20,25]
weight_area: persistence-recovery
external_gates: []
charter_lines: "81-82"
gate_quote_sha256: "65fc769d07814cd8545e7deebd906faebe6bbe190ce02fcadc5b6af3a1c602bd"
evidence_dir: automation/runs/stage-13
last_reconciled: 2026-09-13
---

# Stage 13 — Persistence invariants



## Charter gate (verbatim)

> Test the actual database for same names, duplicate processing, concurrency, migrations, rollback, restart and protected reviewed values. Gate: identity/history/access remain correct and incompatible existing pragmas/overwrite rules are removed.

## Verified current state

- Stage 3 (Architecture and failure model) established: Established component topology (Express server, transactional SQLite, Python OCR worker) and formal failure state machine with bounded worker lease reclaims and non-ephemeral job transitions (types: JobStatus (`docs/stage3/authoritative-contracts.md:15`), FailureTransition (`docs/stage3/authoritative-contracts.md:42`), ComponentTopology (`docs/stage3/component-topology.md:1`)).
- Stage 4 (Truthful demonstration/live separation) established: Isolated simulated demo routes and mock fixtures behind explicit environment flags (DEMO_MODE=false), ensuring live OCR pipelines operate against real extractors (types: ServiceAvailabilityResponse (`src/types.ts:177`), DemoIsolationConfig (`server/routes/demoGuard.ts:1`), LivePipelineGuard (`server/routes/demoGuard.ts:1`)).
- Stage 5 (Reproducible dependencies) established: Pinned Node.js, Python 3.10+, and native OCR runtime dependencies in lockfiles with reproducible local build environments (types: PinnedDependency (`src/types.ts:185`), RuntimeDependencyManifest (`package.json:1`), FieldCategory (`src/types.ts:6`)).
- Stage 6 (Build and startup corrections) established: Guaranteed clean headless application startup with health probes and zero-downtime hot reloading (types: ServerLifecycleConfig (`src/types.ts:223`), HealthCheckResponse (`server/health.ts:1`), StartupProbeConfig (`server/health.ts:1`)).
- Stage 7 (Trustworthy automated checks) established: Established trustworthy automated testing harness with fast feedback loops, flake detection, and concurrent gate verification (types: TestSuiteResult (`docs/stages/stage-07-trustworthy-automated-checks.md:1`), GateVerificationResult (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`), TestHarnessConfig (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`)).
- `PROJECT_CHARTER.md:81-82`: Tests database for duplicate filenames, concurrency, migration rollback, and protecting reviewed values from overwrite.
- SQLite schema established in Stage 12: Tables exist, but high-concurrency ACID invariants and optimistic locking remain to be tested under multi-reader single-writer load.
- Existing overwrite vulnerability: Reprocessing a document currently replaces extracted fields without checking if a human reviewer already approved or modified them.

## Scope

### In scope
- Comprehensive persistence invariant test suite verifying ACID guarantees under parallel transactions.
- Enforcement of reviewed-value immutability: reprocessing a document preserves approved field values.
- Rollback verification: ensuring partial transactions leave zero orphan records.
- Foreign key constraint verification and vacuum integrity checks.

### Out of scope
- Distributed transaction coordinators (single SQLite file scope).
- Cross-database replication.

### Explicitly not promised
- Arbitrary multi-writer throughput exceeding SQLite hardware write limits.

## Work breakdown

1. **Task 1: Reviewed Value Protection Invariant Enforcement**
   - Description: Implement database trigger or repository logic ensuring approved review records cannot be overwritten by automated reprocessing.
   - Owned paths: `server/db/repositories/reviewRepository.ts`
   - Target acceptance fact: Fact 1: Reprocessing protects human-approved values
   - Downstream integration: incorporates Stage 7 (Trustworthy automated checks) established contracts and patterns.

2. **Task 2: High-Concurrency Transaction Stress Harness**
   - Description: Author concurrency test simulating 20 parallel transactions contesting document updates.
   - Owned paths: `tests/stage13Concurrency.test.mjs`
   - Target acceptance fact: Fact 2: Concurrency harness confirms zero deadlock or data loss

3. **Task 3: Migration Rollback and Schema Downgrade Test**
   - Description: Verify sequential down-migrations restore schema cleanly without data corruption.
   - Owned paths: `tests/stage13Rollback.test.mjs`
   - Target acceptance fact: Fact 3: Schema rollback executes without corruption

4. **Task 4: Persistence Invariant Master Suite**
   - Description: Consolidate all database invariant tests into comprehensive test runner.
   - Owned paths: `tests/stage13Invariants.test.mjs`
   - Target acceptance fact: Fact 4: All persistence invariant tests pass

## Contracts to freeze

```typescript
// Integrates Stage 7 (Trustworthy automated checks) frozen contracts
export interface PersistenceInvariantResult {
  acidVerified: boolean;
  walCheckpointed: boolean;
  foreignKeysEnforced: boolean;
  concurrencyCollisionsHandled: number;
  uncommittedOrphanRecords: 0;
}
```

## Fan-out plan

- **Archetype:** Archetype F (Persistence and Concurrency Testing)
- **Lanes:**
  | Lane | Role | Mode | Owned paths | Deliverable |
  |---|---|---|---|---|
  | Lane 1 | impl-lane | CODE | `server/db/repositories/reviewRepository.ts` | Reviewed value protection logic |
  | Lane 2 | test-author | CODE | `tests/stage13*.test.mjs` | Concurrency and rollback test suites |
- **Shared files:** None

## Acceptance evidence

| Fact | Proving command/artifact | Expected outcome | Status | Evidence path |
|---|---|---|---|---|
| Fact 1: Reprocessing protects human-approved values | `node --test tests/stage13Invariants.test.mjs` | Approved values preserved across simulated re-run | pending | `automation/runs/stage-13/review-protection.json` |
| Fact 2: Concurrency harness confirms zero deadlock or data loss | `node --test tests/stage13Concurrency.test.mjs` | All 20 concurrent transactions complete cleanly with WAL mode | pending | `automation/runs/stage-13/concurrency-test.json` |
| Fact 3: Schema rollback executes without corruption | `node --test tests/stage13Rollback.test.mjs` | Migration rollback restores clean previous state | pending | `automation/runs/stage-13/rollback-test.json` |
| Fact 4: All persistence invariant tests pass | `node --test tests/stage13Invariants.test.mjs` | All invariant checks pass with exit code 0 | pending | `automation/runs/stage-13/test-summary.json` |

## Tests

### Negative test cases
- Attempting to update an approved review record without incrementing version throws concurrency error.
- Corrupting database header triggers SQLite disk I/O error instead of silent corruption.

### Boundary test cases
- Handling exactly 50 parallel reader threads while 1 writer transaction is active.
- Transaction rollback restores 1000 bulk inserted rows cleanly.

### Interruption and recovery test cases
- Abrupt process termination during active write recovers uncommitted transactions on next open.
- Repeated VACUUM and WAL checkpoints maintain database file integrity.

### Security and isolation test cases
- Database connections enforce read-only pragma on read-only queries.
- Zero plaintext passwords stored in any table (hashes only).

## Dependencies

### Upstream prerequisites
- Stage 7 (Trustworthy automated checks) [PROMOTED]: Provides test runner framework.
- Stage 12 (Transactional application storage): Establishes SQLite database and schema.

### Downstream consumers
- Stage 14 (Authentication and authorization): Stores user accounts and sessions in database.
- Stage 20 (Integrated vertical slice): Leverages transactional persistence in end-to-end slice.
- Stage 25 (Combined fault sequences): Chaos tests build upon these persistence invariants.

## External gates

- **External blocker:** None
- **Automated local test harness:** Automated multi-worker transaction test script using worker threads
- **Owner sign-off item:** None

## Risks and known defects

- Risk 1: Windows filesystem locking differences when multiple processes access SQLite file.
- Known defect 1: No mechanism currently prevents re-uploading an existing document from wiping past review notes.

## Completion draft (S0–S8)

### S0 Reconcile
- Audit database transaction behavior and pragma settings. (DRAFT — NOT EVIDENCED)

### S1 Plan
- Draft persistence invariant test scenarios and locking rules. (DRAFT — NOT EVIDENCED)

### S2 Build
- Implement review protection in repository and author test suites. (DRAFT — NOT EVIDENCED)

### S3 Gate
- Execute concurrency and invariant tests via `npm test`. (DRAFT — NOT EVIDENCED)

### S4 Independent review
- Independent review verifies ACID guarantees and review immutability. (DRAFT — NOT EVIDENCED)

### S5 Correction
- Tune WAL busy timeouts and pragma configurations. (DRAFT — NOT EVIDENCED)

### S6 Stage-exit checklist
- Stage-exit checklist verification. (DRAFT — NOT EVIDENCED)

### S7 Record and promote
- Record promotion evidence. (DRAFT — NOT EVIDENCED)

### S8 Advance
- Advance to Stage 14. (DRAFT — NOT EVIDENCED)


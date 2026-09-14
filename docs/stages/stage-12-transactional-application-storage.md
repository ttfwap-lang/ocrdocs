---
stage: 12
slug: transactional-application-storage
title: Transactional application storage
status: not-started
depends_on: [3,11]
blocks: [13,15,19]
weight_area: persistence-recovery
external_gates: []
charter_lines: "78-79"
gate_quote_sha256: "49298d0660d45643114b7d69c0f653ec701d683504912f792711b9df853772f5"
evidence_dir: automation/runs/stage-12
last_reconciled: 2026-09-13
---

# Stage 12 — Transactional application storage



## Charter gate (verbatim)

> Implement migrations/constraints for documents, jobs, attempts, candidates, results, ownership and reviews. Gate: interrupted writes cannot leave false completion; file/record inconsistencies have tested recovery.

## Verified current state

- Stage 3 (Architecture and failure model) established: Established component topology (Express server, transactional SQLite, Python OCR worker) and formal failure state machine with bounded worker lease reclaims and non-ephemeral job transitions (types: JobStatus (`docs/stage3/authoritative-contracts.md:15`), FailureTransition (`docs/stage3/authoritative-contracts.md:42`), ComponentTopology (`docs/stage3/component-topology.md:1`)).
- Stage 4 (Truthful demonstration/live separation) established: Isolated simulated demo routes and mock fixtures behind explicit environment flags (DEMO_MODE=false), ensuring live OCR pipelines operate against real extractors (types: ServiceAvailabilityResponse (`src/types.ts:177`), DemoIsolationConfig (`server/routes/demoGuard.ts:1`), LivePipelineGuard (`server/routes/demoGuard.ts:1`)).
- Stage 5 (Reproducible dependencies) established: Pinned Node.js, Python 3.10+, and native OCR runtime dependencies in lockfiles with reproducible local build environments (types: PinnedDependency (`src/types.ts:185`), RuntimeDependencyManifest (`package.json:1`), FieldCategory (`src/types.ts:6`)).
- Stage 6 (Build and startup corrections) established: Guaranteed clean headless application startup with health probes and zero-downtime hot reloading (types: ServerLifecycleConfig (`src/types.ts:223`), HealthCheckResponse (`server/health.ts:1`), StartupProbeConfig (`server/health.ts:1`)).
- Stage 7 (Trustworthy automated checks) established: Established trustworthy automated testing harness with fast feedback loops, flake detection, and concurrent gate verification (types: TestSuiteResult (`docs/stages/stage-07-trustworthy-automated-checks.md:1`), GateVerificationResult (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`), TestHarnessConfig (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`)).
- `PROJECT_CHARTER.md:28`: Master architecture item 3 mandates transactional SQLite application database with migrations, constraints, durable jobs, attempts/leases, and review metadata.
- `server.ts:1-50`: Currently uses in-memory Map / array structures for document and job state.
- Database driver missing: `better-sqlite3` or `sqlite3` not yet configured in `package.json`.
- Migrations directory: `server/db/migrations/` does not yet exist.

## Scope

### In scope
- Adoption and configuration of `better-sqlite3` native database driver with WAL mode.
- Schema migration runner executing sequential versioned SQL migrations.
- Relational schema tables: documents, jobs, job_attempts, field_candidates, extraction_results, reviews, audit_logs.
- Foreign key constraints, unique indexes, and ACID transaction wrappers.

### Out of scope
- DuckDB analytical export queries (Stage 28).
- Distributed replication or SQLite cloud sync.

### Explicitly not promised
- Support for alternative RDBMS engines (Postgres, MySQL) in single-host scope.

## Work breakdown

1. **Task 1: SQLite Driver Configuration and Migration Runner**
   - Description: Set up better-sqlite3 with WAL mode, foreign keys enabled, and sequential migration executor.
   - Owned paths: `server/db/database.ts,server/db/migrator.ts`
   - Target acceptance fact: Fact 1: Migration runner executes versioned SQL migrations
   - Downstream integration: incorporates Stage 3 (Architecture and failure model) established contracts and patterns.

2. **Task 2: Initial Relational Schema Migration (001_initial.sql)**
   - Description: Define core tables: documents, jobs, attempts, extraction_results, reviews, audit_logs.
   - Owned paths: `server/db/migrations/001_initial.sql`
   - Target acceptance fact: Fact 2: Initial schema tables created with constraints

3. **Task 3: Transactional Repository Layer**
   - Description: Implement typed repository methods with atomic transaction wrappers for documents and jobs.
   - Owned paths: `server/db/repositories/documentRepository.ts,server/db/repositories/jobRepository.ts`
   - Target acceptance fact: Fact 3: Transactional repositories handle CRUD and leases

4. **Task 4: Storage Migration and Transaction Test Suite**
   - Description: Author automated tests verifying migration execution, foreign key enforcement, and rollback.
   - Owned paths: `tests/stage12Storage.test.mjs`
   - Target acceptance fact: Fact 4: Database migration and transaction tests pass

## Contracts to freeze

```typescript
// Integrates Stage 3 (Architecture and failure model) frozen contracts
export interface DatabaseConfig {
  filename: string;
  walMode: boolean;
  busyTimeoutMs: number;
  foreignKeys: boolean;
}

export interface DocumentRecord {
  id: string;
  sha256: string;
  filename: string;
  byteSize: number;
  mimeType: string;
  pageCount: number;
  storagePath: string;
  createdAt: string;
}
```

## Fan-out plan

- **Archetype:** Archetype C (Database Engine and Schema Migration)
- **Lanes:**
  | Lane | Role | Mode | Owned paths | Deliverable |
  |---|---|---|---|---|
  | Lane 1 | impl-lane | CODE | `server/db/database.ts,server/db/migrator.ts,server/db/migrations/**` | SQLite connection and migration files |
  | Lane 2 | impl-lane | CODE | `server/db/repositories/**` | Document and job repository implementations |
  | Lane 3 | test-author | CODE | `tests/stage12Storage.test.mjs` | SQLite transaction and migration test suite |
- **Shared files:** package.json

## Acceptance evidence

| Fact | Proving command/artifact | Expected outcome | Status | Evidence path |
|---|---|---|---|---|
| Fact 1: Migration runner executes versioned SQL migrations | `node -e "assert(fs.existsSync('server/db/migrator.ts'))"` | Migration runner compiles and verifies schema version table | pending | `automation/runs/stage-12/migrator-audit.json` |
| Fact 2: Initial schema tables created with constraints | `node --test tests/stage12Storage.test.mjs` | Tables created with active foreign key enforcement | pending | `automation/runs/stage-12/schema-audit.json` |
| Fact 3: Transactional repositories handle CRUD and leases | `node --test tests/stage12Storage.test.mjs` | Document insert and atomic job claim execute cleanly | pending | `automation/runs/stage-12/repo-audit.json` |
| Fact 4: Database migration and transaction tests pass | `node --test tests/stage12Storage.test.mjs` | All storage tests pass with exit code 0 | pending | `automation/runs/stage-12/test-summary.json` |

## Tests

### Negative test cases
- Inserting job with non-existent document_id fails foreign key constraint.
- Inserting duplicate document SHA-256 triggers unique constraint error.

### Boundary test cases
- Busy timeout (5000ms) handles concurrent read/write locks gracefully.
- Rollback on simulated write error restores database to exact prior state.

### Interruption and recovery test cases
- Process crash during migration leaves database in consistent versioned state.
- Re-opening database in WAL mode recovers uncheckpointed WAL frames automatically.

### Security and isolation test cases
- Database file created with 0600 file permissions (owner read/write only).
- All SQL queries execute parameterized statements (zero raw string concatenation).

## Dependencies

### Upstream prerequisites
- Stage 3 (Architecture and failure model) [PROMOTED]: Dictates SQLite master architecture requirements.
- Stage 11 (Versioned result contracts): Defines entities stored in schema.

### Downstream consumers
- Stage 13 (Persistence invariants): Exercises concurrency and rollback on this schema.
- Stage 15 (Private original storage): Associates file storage records with database.
- Stage 19 (Durable job transitions): Uses job state table for queue transitions.

## External gates

- **External blocker:** None
- **Automated local test harness:** Automated test suite using temporary SQLite database files in $env:TEMP
- **Owner sign-off item:** None

## Risks and known defects

- Risk 1: Native binary build requirements for better-sqlite3 on Windows vs Linux.
- Known defect 1: Current application loses all document state on server restart.

## Completion draft (S0–S8)

### S0 Reconcile
- Audit database driver options and install better-sqlite3. (DRAFT — NOT EVIDENCED)

### S1 Plan
- Draft SQL migration schema and repository interfaces. (DRAFT — NOT EVIDENCED)

### S2 Build
- Author `migrator.ts`, `001_initial.sql`, and repository layer. (DRAFT — NOT EVIDENCED)

### S3 Gate
- Execute database test suite via `npm test`. (DRAFT — NOT EVIDENCED)

### S4 Independent review
- Independent review verifies foreign keys and transaction boundaries. (DRAFT — NOT EVIDENCED)

### S5 Correction
- Tune WAL checkpointing and busy timeouts. (DRAFT — NOT EVIDENCED)

### S6 Stage-exit checklist
- Stage-exit checklist verification. (DRAFT — NOT EVIDENCED)

### S7 Record and promote
- Record promotion evidence. (DRAFT — NOT EVIDENCED)

### S8 Advance
- Advance to Stage 13. (DRAFT — NOT EVIDENCED)


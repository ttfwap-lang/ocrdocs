---
stage: 49
slug: compatible-upgrades-and-preserved-history
title: Compatible upgrades and preserved history
status: not-started
depends_on: [41,43]
blocks: [52,53]
weight_area: persistence-recovery
external_gates: []
charter_lines: "189-190"
gate_quote_sha256: "5f45025b66a982f95ccf9d6ec5199ba53038009daa51c3638f0d43a10a2e1c2d"
evidence_dir: automation/runs/stage-49
last_reconciled: 2026-09-13
---

# Stage 49 — Compatible upgrades and preserved history



## Charter gate (verbatim)

> Version APIs/results/exports/models/migrations and supported worker/server combinations. Gate: existing-data upgrades, failed migrations and rollback preserve historical approvals and explicitly reject unsupported combinations.

## Verified current state

- Stage 3 (Architecture and failure model) established: Established component topology (Express server, transactional SQLite, Python OCR worker) and formal failure state machine with bounded worker lease reclaims and non-ephemeral job transitions (types: JobStatus (`docs/stage3/authoritative-contracts.md:15`), FailureTransition (`docs/stage3/authoritative-contracts.md:42`), ComponentTopology (`docs/stage3/component-topology.md:1`)).
- Stage 4 (Truthful demonstration/live separation) established: Isolated simulated demo routes and mock fixtures behind explicit environment flags (DEMO_MODE=false), ensuring live OCR pipelines operate against real extractors (types: ServiceAvailabilityResponse (`src/types.ts:177`), DemoIsolationConfig (`server/routes/demoGuard.ts:1`), LivePipelineGuard (`server/routes/demoGuard.ts:1`)).
- Stage 5 (Reproducible dependencies) established: Pinned Node.js, Python 3.10+, and native OCR runtime dependencies in lockfiles with reproducible local build environments (types: PinnedDependency (`src/types.ts:185`), RuntimeDependencyManifest (`package.json:1`), FieldCategory (`src/types.ts:6`)).
- Stage 6 (Build and startup corrections) established: Guaranteed clean headless application startup with health probes and zero-downtime hot reloading (types: ServerLifecycleConfig (`src/types.ts:223`), HealthCheckResponse (`server/health.ts:1`), StartupProbeConfig (`server/health.ts:1`)).
- Stage 7 (Trustworthy automated checks) established: Established trustworthy automated testing harness with fast feedback loops, flake detection, and concurrent gate verification (types: TestSuiteResult (`docs/stages/stage-07-trustworthy-automated-checks.md:1`), GateVerificationResult (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`), TestHarnessConfig (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`)).
- `PROJECT_CHARTER.md:189-190`: Version APIs/results/exports/models/migrations and supported worker/server combinations. Existing-data upgrades, failed migrations, and rollback preserve historical approvals and explicitly reject unsupported combinations.
- Upgrade drill unperformed: No test verifies upgrading a database created by v1.0.0 to a newer schema version without losing past approvals.
- Version negotiation missing: Express server does not verify that the spawned Python worker version matches expected compatible worker contract version.
- Compatibility matrix: Need formal compatibility matrix documenting supported worker/server combinations.

## Scope

### In scope
- Database migration forward-upgrade and backward-rollback drill with realistic pre-existing data.
- Preservation of all historical approved reviews, candidate logs, and audit trails during migration.
- Server/worker IPC handshake: Express rejects connection to incompatible Python worker versions.
- API version negotiation: clients calling unsupported API versions receive structured 400 Upgrade Required.

### Out of scope
- Cross-major database engine migration (SQLite to Postgres).
- Live hot database binary patching.

### Explicitly not promised
- Forward compatibility allowing v1 server to run on v2 database schema.

## Work breakdown

1. **Task 1: Worker/Server Version Handshake Protocol**
   - Description: Implement startup handshake validating semver compatibility between Express server and Python worker.
   - Owned paths: `server/lifecycle/versionHandshake.ts`
   - Target acceptance fact: Fact 1: Version handshake verifies worker/server compatibility

2. **Task 2: Existing Data Upgrade and Rollback Drill Script**
   - Description: Implement drill script populating v1 database, executing migration, and verifying data fidelity.
   - Owned paths: `scripts/migration/upgrade-drill.mjs`
   - Target acceptance fact: Fact 2: Upgrade drill validates data preservation across migrations

3. **Task 3: Version Compatibility Matrix Documentation**
   - Description: Formalize supported client/server/worker/schema version compatibility combinations.
   - Owned paths: `docs/stage49/compatibility-matrix.md`
   - Target acceptance fact: Fact 3: Compatibility matrix documents supported combinations

4. **Task 4: Compatible Upgrade and Data Preservation Test Suite**
   - Description: Author automated tests verifying historical approval preservation and incompatible version rejection.
   - Owned paths: `tests/stage49Upgrade.test.mjs`
   - Target acceptance fact: Fact 4: Upgrade and compatibility test suite passes

## Contracts to freeze

```typescript
export interface VersionHandshake {
  serverVersion: string;
  expectedWorkerMajor: number;
  workerVersion: string;
  schemaVersion: number;
  isCompatible: boolean;
  rejectionReason?: string;
}
```

## Fan-out plan

- **Archetype:** Archetype F (Schema Migration and Version Compatibility)
- **Lanes:**
  | Lane | Role | Mode | Owned paths | Deliverable |
  |---|---|---|---|---|
  | Lane 1 | impl-lane | CODE | `server/lifecycle/versionHandshake.ts` | Version handshake validator |
  | Lane 2 | impl-lane | CODE | `scripts/migration/**` | Upgrade drill script |
  | Lane 3 | impl-lane | CODE | `docs/stage49/**` | Compatibility matrix documentation |
  | Lane 4 | test-author | CODE | `tests/stage49Upgrade.test.mjs` | Upgrade preservation test suite |
- **Shared files:** None

## Acceptance evidence

| Fact | Proving command/artifact | Expected outcome | Status | Evidence path |
|---|---|---|---|---|
| Fact 1: Version handshake verifies worker/server compatibility | `node -e "assert(fs.existsSync('server/lifecycle/versionHandshake.ts'))"` | Handshake rejects mismatched worker major version | pending | `automation/runs/stage-49/handshake-audit.json` |
| Fact 2: Upgrade drill validates data preservation across migrations | `node scripts/migration/upgrade-drill.mjs --dry-run` | Upgrade drill executes without data loss or corruption | pending | `automation/runs/stage-49/drill-audit.json` |
| Fact 3: Compatibility matrix documents supported combinations | `node -e "assert(fs.existsSync('docs/stage49/compatibility-matrix.md'))"` | Matrix specifies client, server, and worker semver ranges | pending | `automation/runs/stage-49/matrix-audit.json` |
| Fact 4: Upgrade and compatibility test suite passes | `node --test tests/stage49Upgrade.test.mjs` | All upgrade and preservation tests exit 0 | pending | `automation/runs/stage-49/test-summary.json` |

## Tests

### Negative test cases
- Starting server with Python worker whose major version differs exits with VersionMismatchError.
- Applying migration to corrupted database rolls back cleanly without partial schema alteration.

### Boundary test cases
- 100% of pre-existing approved reviews and modified values preserved across schema migration.
- Downgrade migration cleanly removes new columns without deleting underlying documents.

### Interruption and recovery test cases
- Power failure / kill -9 during migration leaves database in consistent pre-migration version.
- Re-running applied migration is idempotent.

### Security and isolation test cases
- Migration runner executes with database owner permissions.
- Handshake protocol prevents rogue worker injection.

## Dependencies

### Upstream prerequisites
- Stage 41 (Tested backup/restore/rollback): Rollback depends on backup snapshots.
- Stage 43 (Evidence-backed pilot gate): Pilot baseline.

### Downstream consumers
- Stage 52 (Traceable controlled releases): Version manifests tied to release artifacts.
- Stage 53 (Transferable support/incident operations): Upgrade runbooks for operators.

## External gates

- **External blocker:** None
- **Automated local test harness:** Automated test suite seeding legacy database fixtures and executing migrations
- **Owner sign-off item:** None

## Risks and known defects

- Risk 1: SQLite schema migration locking entire database during large data transformations.
- Known defect 1: Server currently has no version check on Python worker subprocess.

## Completion draft (S0–S8)

### S0 Reconcile
- Audit database migrations and worker versioning. (DRAFT — NOT EVIDENCED)

### S1 Plan
- Draft version handshake protocol and upgrade drill test scenario. (DRAFT — NOT EVIDENCED)

### S2 Build
- Author `versionHandshake.ts`, `upgrade-drill.mjs`, matrix doc, and tests. (DRAFT — NOT EVIDENCED)

### S3 Gate
- Execute upgrade test suite via `npm test`. (DRAFT — NOT EVIDENCED)

### S4 Independent review
- Independent review audits historical data preservation and rollback safety. (DRAFT — NOT EVIDENCED)

### S5 Correction
- Freeze compatibility matrix. (DRAFT — NOT EVIDENCED)

### S6 Stage-exit checklist
- Stage-exit checklist verification. (DRAFT — NOT EVIDENCED)

### S7 Record and promote
- Record promotion evidence. (DRAFT — NOT EVIDENCED)

### S8 Advance
- Advance to Stage 50. (DRAFT — NOT EVIDENCED)


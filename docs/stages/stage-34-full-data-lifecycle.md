---
stage: 34
slug: full-data-lifecycle
title: Full data lifecycle
status: not-started
depends_on: [15,28]
blocks: [35,41,51]
weight_area: security
external_gates: []
charter_lines: "144-145"
gate_quote_sha256: "50c7e8dc3950abaeae108484ae83aebc2b713a8b12487b31c5fd2298d2621f62"
evidence_dir: automation/runs/stage-34
last_reconciled: 2026-09-13
---

# Stage 34 — Full data lifecycle



## Charter gate (verbatim)

> Cover originals/text/previews/results/reviews/exports/caches/temp/logs/backups with retention/deletion rules. Gate: interrupted deletion and backup restoration honor documented deletion obligations without hidden retained copies.

## Verified current state

- Stage 3 (Architecture and failure model) established: Established component topology (Express server, transactional SQLite, Python OCR worker) and formal failure state machine with bounded worker lease reclaims and non-ephemeral job transitions (types: JobStatus (`docs/stage3/authoritative-contracts.md:15`), FailureTransition (`docs/stage3/authoritative-contracts.md:42`), ComponentTopology (`docs/stage3/component-topology.md:1`)).
- Stage 4 (Truthful demonstration/live separation) established: Isolated simulated demo routes and mock fixtures behind explicit environment flags (DEMO_MODE=false), ensuring live OCR pipelines operate against real extractors (types: ServiceAvailabilityResponse (`src/types.ts:177`), DemoIsolationConfig (`server/routes/demoGuard.ts:1`), LivePipelineGuard (`server/routes/demoGuard.ts:1`)).
- Stage 5 (Reproducible dependencies) established: Pinned Node.js, Python 3.10+, and native OCR runtime dependencies in lockfiles with reproducible local build environments (types: PinnedDependency (`src/types.ts:185`), RuntimeDependencyManifest (`package.json:1`), FieldCategory (`src/types.ts:6`)).
- Stage 6 (Build and startup corrections) established: Guaranteed clean headless application startup with health probes and zero-downtime hot reloading (types: ServerLifecycleConfig (`src/types.ts:223`), HealthCheckResponse (`server/health.ts:1`), StartupProbeConfig (`server/health.ts:1`)).
- Stage 7 (Trustworthy automated checks) established: Established trustworthy automated testing harness with fast feedback loops, flake detection, and concurrent gate verification (types: TestSuiteResult (`docs/stages/stage-07-trustworthy-automated-checks.md:1`), GateVerificationResult (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`), TestHarnessConfig (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`)).
- `PROJECT_CHARTER.md:144-145`: Cover originals/text/previews/results/reviews/exports/caches/temp/logs/backups with retention/deletion rules. Interrupted deletion and backup restoration honor deletion obligations without hidden retained copies.
- Permanent retention risk: Current application never deletes temporary files or provides document deletion.
- File unlinking missing: No service exists to securely delete originals, previews, candidates, and database records.
- Retention policies: No automated cleanup routine exists to purge expired artifacts.

## Scope

### In scope
- Complete document lifecycle deletion: securely delete database records, original files, preview images, and candidate evidence.
- Automated retention policy manager: purge temporary OCR rasters (>24h old) and expired exports.
- Audit trail of deletion: record attributable deletion tombstone without retaining PII.
- Guaranteed cleanup: zero orphaned disk fragments left after document deletion.

### Out of scope
- Cryptographic multi-pass disk shredding (standard filesystem unlink sufficient).
- Physical tape backup purging.

### Explicitly not promised
- Restoration of documents after explicit user deletion.

## Work breakdown

1. **Task 1: Cascading Document Deletion Service**
   - Description: Implement DocumentDeletionService unlinking files from disk and deleting database rows in a transaction.
   - Owned paths: `server/storage/deletionService.ts`
   - Target acceptance fact: Fact 1: Deletion service cascades removal across disk and database

2. **Task 2: Automated Retention and Garbage Collection Daemon**
   - Description: Implement background job cleaning temporary raster caches and expired exports older than retention window.
   - Owned paths: `server/storage/retentionDaemon.ts`
   - Target acceptance fact: Fact 2: Retention daemon purges expired temporary artifacts

3. **Task 3: Document Deletion API Endpoint**
   - Description: Implement DELETE /api/documents/:id with authentication and ownership authorization.
   - Owned paths: `server/routes/deletionRoutes.ts`
   - Target acceptance fact: Fact 3: Deletion endpoint enforces ownership and records tombstone

4. **Task 4: Full Data Lifecycle and Deletion Test Suite**
   - Description: Author automated tests verifying complete file removal, zero disk orphans, and tombstone audit.
   - Owned paths: `tests/stage34Lifecycle.test.mjs`
   - Target acceptance fact: Fact 4: Data lifecycle and deletion test suite passes

## Contracts to freeze

```typescript
export interface DeletionResult {
  documentId: string;
  deletedAt: string;
  deletedBy: string;
  filesUnlinked: string[];
  databaseRowsDeleted: number;
  tombstoneId: string;
}

export interface RetentionPolicyConfig {
  tempRasterExpiryHours: number; // 24
  exportFileExpiryHours: number; // 72
  auditLogRetentionDays: number; // 365
}
```

## Fan-out plan

- **Archetype:** Archetype H (Data Lifecycle and Secure Deletion)
- **Lanes:**
  | Lane | Role | Mode | Owned paths | Deliverable |
  |---|---|---|---|---|
  | Lane 1 | impl-lane | CODE | `server/storage/deletionService.ts,server/storage/retentionDaemon.ts` | Deletion service and retention daemon |
  | Lane 2 | impl-lane | CODE | `server/routes/deletionRoutes.ts` | DELETE API routes |
  | Lane 3 | test-author | CODE | `tests/stage34Lifecycle.test.mjs` | Data lifecycle test suite |
- **Shared files:** None

## Acceptance evidence

| Fact | Proving command/artifact | Expected outcome | Status | Evidence path |
|---|---|---|---|---|
| Fact 1: Deletion service cascades removal across disk and database | `node -e "assert(fs.existsSync('server/storage/deletionService.ts'))"` | Service unlinks original file, preview, and removes database rows | pending | `automation/runs/stage-34/service-audit.json` |
| Fact 2: Retention daemon purges expired temporary artifacts | `node --test tests/stage34Lifecycle.test.mjs` | Temporary files older than 24h deleted automatically | pending | `automation/runs/stage-34/daemon-audit.json` |
| Fact 3: Deletion endpoint enforces ownership and records tombstone | `node --test tests/stage34Lifecycle.test.mjs` | DELETE returns 200 and records tombstone row | pending | `automation/runs/stage-34/endpoint-audit.json` |
| Fact 4: Data lifecycle and deletion test suite passes | `node --test tests/stage34Lifecycle.test.mjs` | All lifecycle and deletion tests exit 0 | pending | `automation/runs/stage-34/test-summary.json` |

## Tests

### Negative test cases
- Attempting to delete document owned by another user returns 403 Forbidden.
- Requesting download of deleted document returns 404 Not Found.

### Boundary test cases
- File exactly at retention boundary (24h 0m 0s) retained; 24h 0m 1s purged.
- Deleting document with 0 extracted fields completes cleanly.

### Interruption and recovery test cases
- Failure during database deletion leaves file intact for retry (transactional safety).
- Interrupted deletion daemon resumes from last inspected directory.

### Security and isolation test cases
- Deleted file contents cannot be recovered via application endpoints.
- Tombstone records contain only hash and ID, zero customer names or values.

## Dependencies

### Upstream prerequisites
- Stage 15 (Private original storage): Files to unlink managed by storage service.
- Stage 28 (Safe consistent exports): Exports purged by retention daemon.

### Downstream consumers
- Stage 35 (Pre-pilot security closure): Verifies privacy deletion guarantees.
- Stage 41 (Tested backup/restore/rollback): Backup restoration respects deletion tombstones.
- Stage 51 (Privacy/contracts/claims alignment): Aligns with legal right-to-be-forgotten.

## External gates

- **External blocker:** None
- **Automated local test harness:** Automated test suite creating files on disk, triggering deletion, and asserting fs.existsSync === false
- **Owner sign-off item:** None

## Risks and known defects

- Risk 1: Disk permission errors preventing file unlinking.
- Known defect 1: No file deletion logic exists anywhere in current codebase.

## Completion draft (S0–S8)

### S0 Reconcile
- Audit storage locations and temporary file directories. (DRAFT — NOT EVIDENCED)

### S1 Plan
- Draft deletion cascade sequence and tombstone schema. (DRAFT — NOT EVIDENCED)

### S2 Build
- Author `deletionService.ts`, `retentionDaemon.ts`, routes, and tests. (DRAFT — NOT EVIDENCED)

### S3 Gate
- Execute lifecycle test suite via `npm test`. (DRAFT — NOT EVIDENCED)

### S4 Independent review
- Independent review audits complete unlinking and tombstone privacy. (DRAFT — NOT EVIDENCED)

### S5 Correction
- Tune retention daemon sweep intervals. (DRAFT — NOT EVIDENCED)

### S6 Stage-exit checklist
- Stage-exit checklist verification. (DRAFT — NOT EVIDENCED)

### S7 Record and promote
- Record promotion evidence. (DRAFT — NOT EVIDENCED)

### S8 Advance
- Advance to Stage 35. (DRAFT — NOT EVIDENCED)


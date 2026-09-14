---
stage: 41
slug: tested-backup-restore-rollback
title: Tested backup/restore/rollback
status: not-started
depends_on: [25,34,39]
blocks: [43,44,49]
weight_area: persistence-recovery
external_gates: []
charter_lines: "165-166"
gate_quote_sha256: "f419037cea377b0959d207310d91ed75afb4afceba0a8372e68281736bdb4d1c"
evidence_dir: automation/runs/stage-41
last_reconciled: 2026-09-13
---

# Stage 41 — Tested backup/restore/rollback



## Charter gate (verbatim)

> Restore originals/database/permissions/reviews/deletion records in a clean environment and rehearse compatible rollback. Gate: integrity/export and measured recovery objectives pass for another operator, not just backup-file creation.

## Verified current state

- Stage 3 (Architecture and failure model) established: Established component topology (Express server, transactional SQLite, Python OCR worker) and formal failure state machine with bounded worker lease reclaims and non-ephemeral job transitions (types: JobStatus (`docs/stage3/authoritative-contracts.md:15`), FailureTransition (`docs/stage3/authoritative-contracts.md:42`), ComponentTopology (`docs/stage3/component-topology.md:1`)).
- Stage 4 (Truthful demonstration/live separation) established: Isolated simulated demo routes and mock fixtures behind explicit environment flags (DEMO_MODE=false), ensuring live OCR pipelines operate against real extractors (types: ServiceAvailabilityResponse (`src/types.ts:177`), DemoIsolationConfig (`server/routes/demoGuard.ts:1`), LivePipelineGuard (`server/routes/demoGuard.ts:1`)).
- Stage 5 (Reproducible dependencies) established: Pinned Node.js, Python 3.10+, and native OCR runtime dependencies in lockfiles with reproducible local build environments (types: PinnedDependency (`src/types.ts:185`), RuntimeDependencyManifest (`package.json:1`), FieldCategory (`src/types.ts:6`)).
- Stage 6 (Build and startup corrections) established: Guaranteed clean headless application startup with health probes and zero-downtime hot reloading (types: ServerLifecycleConfig (`src/types.ts:223`), HealthCheckResponse (`server/health.ts:1`), StartupProbeConfig (`server/health.ts:1`)).
- Stage 7 (Trustworthy automated checks) established: Established trustworthy automated testing harness with fast feedback loops, flake detection, and concurrent gate verification (types: TestSuiteResult (`docs/stages/stage-07-trustworthy-automated-checks.md:1`), GateVerificationResult (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`), TestHarnessConfig (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`)).
- `PROJECT_CHARTER.md:165-166`: Restore originals/database/permissions/reviews/deletion records in a clean environment and rehearse compatible rollback. Measured recovery objectives pass for another operator, not just backup-file creation.
- Backup automation absent: Application has no script or automated command to take a consistent backup of SQLite database and private storage originals.
- Restoration drill unperformed: No disaster recovery runbook or verified restore script exists.
- Recovery time objective: Charter target is demonstrated clean-host restoration within 4 hours (charter item 20).

## Scope

### In scope
- Comprehensive backup script: SQLite VACUUM INTO backup snapshot + tarball of private storage originals and tombstones.
- Clean restoration drill script: restores database, files, permissions, and reviews into a clean directory.
- Cryptographic verification: verify all SHA-256 hashes of restored files match database records.
- Recovery Time Objective (RTO) verification: restoration drill completes in < 15 minutes.

### Out of scope
- Offsite tape storage management.
- Automated multi-datacenter disaster failover.

### Explicitly not promised
- Zero-second instant recovery (single-host backup restoration target is < 4 hours).

## Work breakdown

1. **Task 1: Automated Consistent Backup Tool**
   - Description: Implement backup tool snapshotting SQLite database via VACUUM INTO and archiving storage files.
   - Owned paths: `scripts/backup/create-backup.mjs`
   - Target acceptance fact: Fact 1: Backup tool creates consistent snapshot archive

2. **Task 2: Clean Environment Restoration Drill Tool**
   - Description: Implement restore tool extracting archive, verifying hashes, and validating database integrity.
   - Owned paths: `scripts/backup/restore-backup.mjs`
   - Target acceptance fact: Fact 2: Restore tool restores clean database and verifies file hashes

3. **Task 3: Disaster Recovery Runbook Documentation**
   - Description: Document step-by-step restoration procedures for another operator to execute in under 4 hours.
   - Owned paths: `docs/runbooks/disaster-recovery.md`
   - Target acceptance fact: Fact 3: Disaster recovery runbook provides operator instructions

4. **Task 4: Backup and Restoration Drill Test Suite**
   - Description: Author automated test creating backup, wiping target directory, restoring archive, and verifying integrity.
   - Owned paths: `tests/stage41BackupRestore.test.mjs`
   - Target acceptance fact: Fact 4: Backup and restore drill test suite passes

## Contracts to freeze

```typescript
export interface BackupArchiveManifest {
  archiveId: string;
  createdAt: string;
  databaseChecksum: string;
  storageFilesCount: number;
  storageBytes: number;
  tombstonesCount: number;
  manifestSha256: string;
}
```

## Fan-out plan

- **Archetype:** Archetype F (Backup Automation and Disaster Recovery)
- **Lanes:**
  | Lane | Role | Mode | Owned paths | Deliverable |
  |---|---|---|---|---|
  | Lane 1 | impl-lane | CODE | `scripts/backup/**` | Backup and restore automation scripts |
  | Lane 2 | impl-lane | CODE | `docs/runbooks/**` | Disaster recovery runbook |
  | Lane 3 | test-author | CODE | `tests/stage41BackupRestore.test.mjs` | Disaster recovery drill test suite |
- **Shared files:** None

## Acceptance evidence

| Fact | Proving command/artifact | Expected outcome | Status | Evidence path |
|---|---|---|---|---|
| Fact 1: Backup tool creates consistent snapshot archive | `node -e "assert(fs.existsSync('scripts/backup/create-backup.mjs'))"` | Backup script generates tarball with database snapshot | pending | `automation/runs/stage-41/backup-audit.json` |
| Fact 2: Restore tool restores clean database and verifies file hashes | `node -e "assert(fs.existsSync('scripts/backup/restore-backup.mjs'))"` | Restore script restores and verifies SQLite integrity check | pending | `automation/runs/stage-41/restore-audit.json` |
| Fact 3: Disaster recovery runbook provides operator instructions | `node -e "assert(fs.existsSync('docs/runbooks/disaster-recovery.md'))"` | Runbook details clean-host restoration steps | pending | `automation/runs/stage-41/runbook-audit.json` |
| Fact 4: Backup and restore drill test suite passes | `node --test tests/stage41BackupRestore.test.mjs` | All backup and restoration drill tests exit 0 | pending | `automation/runs/stage-41/test-summary.json` |

## Tests

### Negative test cases
- Attempting to restore a corrupted archive fails with ChecksumMismatchError.
- Restoring archive with tampered database fails SQLite PRAGMA integrity_check.

### Boundary test cases
- Backup archive includes all tombstones, ensuring deleted files are not resurrected.
- Restoration completes within 10 minutes for 1,000 documents.

### Interruption and recovery test cases
- Process killed during backup generation leaves no partial backup registered.
- Restoration into dirty directory refuses to overwrite existing files without explicit flag.

### Security and isolation test cases
- Backup archives encrypted with AES-256 or protected with restricted permissions.
- Passphrases for backup decryption provided via environment or secure prompt.

## Dependencies

### Upstream prerequisites
- Stage 25 (Combined fault sequences): Fault recovery mechanics.
- Stage 34 (Full data lifecycle): Tombstones and deletion rules preserved in backup.
- Stage 39 (Representative staging): Drills run in staging sandbox.

### Downstream consumers
- Stage 43 (Evidence-backed pilot gate): Disaster recovery drill required for pilot gate.
- Stage 44 (Reliability commitments verified): Validates RTO commitment.
- Stage 49 (Compatible upgrades and preserved history): Upgrade rollback uses backups.

## External gates

- **External blocker:** None
- **Automated local test harness:** Automated test suite executing backup and restore into temporary sandbox directories
- **Owner sign-off item:** None

## Risks and known defects

- Risk 1: Open database write transactions causing inconsistent backup if not using VACUUM INTO.
- Known defect 1: No backup scripts exist in the repository.

## Completion draft (S0–S8)

### S0 Reconcile
- Audit SQLite backup APIs and file storage archiving. (DRAFT — NOT EVIDENCED)

### S1 Plan
- Draft backup manifest schema and disaster recovery procedure. (DRAFT — NOT EVIDENCED)

### S2 Build
- Author `create-backup.mjs`, `restore-backup.mjs`, runbook, and tests. (DRAFT — NOT EVIDENCED)

### S3 Gate
- Execute disaster recovery drill test suite via `npm test`. (DRAFT — NOT EVIDENCED)

### S4 Independent review
- Independent review audits integrity check verification and tombstone preservation. (DRAFT — NOT EVIDENCED)

### S5 Correction
- Tune compression and checksum routines. (DRAFT — NOT EVIDENCED)

### S6 Stage-exit checklist
- Stage-exit checklist verification. (DRAFT — NOT EVIDENCED)

### S7 Record and promote
- Record promotion evidence. (DRAFT — NOT EVIDENCED)

### S8 Advance
- Advance to Stage 42. (DRAFT — NOT EVIDENCED)


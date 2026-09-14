---
stage: 30
slug: resumable-incremental-drive-sync
title: Resumable incremental Drive sync
status: not-started
depends_on: [29]
blocks: [33,38]
weight_area: real-ingestion-ocr
external_gates: []
charter_lines: "132-133"
gate_quote_sha256: "808caa0ebbdd268fdd62f3bb75be2f4dad762d895005ec8febeb494bbd5f011e"
evidence_dir: automation/runs/stage-30
last_reconciled: 2026-09-13
---

# Stage 30 — Resumable incremental Drive sync



## Charter gate (verbatim)

> Persist remote identity/version/checkpoints/download/processing states and change/deletion policy. Gate: pagination, throttling, interruption, repeat sync and mid-run revocation reconcile with actual files and do not omit/duplicate work silently.

## Verified current state

- Stage 3 (Architecture and failure model) established: Established component topology (Express server, transactional SQLite, Python OCR worker) and formal failure state machine with bounded worker lease reclaims and non-ephemeral job transitions (types: JobStatus (`docs/stage3/authoritative-contracts.md:15`), FailureTransition (`docs/stage3/authoritative-contracts.md:42`), ComponentTopology (`docs/stage3/component-topology.md:1`)).
- Stage 4 (Truthful demonstration/live separation) established: Isolated simulated demo routes and mock fixtures behind explicit environment flags (DEMO_MODE=false), ensuring live OCR pipelines operate against real extractors (types: ServiceAvailabilityResponse (`src/types.ts:177`), DemoIsolationConfig (`server/routes/demoGuard.ts:1`), LivePipelineGuard (`server/routes/demoGuard.ts:1`)).
- Stage 5 (Reproducible dependencies) established: Pinned Node.js, Python 3.10+, and native OCR runtime dependencies in lockfiles with reproducible local build environments (types: PinnedDependency (`src/types.ts:185`), RuntimeDependencyManifest (`package.json:1`), FieldCategory (`src/types.ts:6`)).
- Stage 6 (Build and startup corrections) established: Guaranteed clean headless application startup with health probes and zero-downtime hot reloading (types: ServerLifecycleConfig (`src/types.ts:223`), HealthCheckResponse (`server/health.ts:1`), StartupProbeConfig (`server/health.ts:1`)).
- Stage 7 (Trustworthy automated checks) established: Established trustworthy automated testing harness with fast feedback loops, flake detection, and concurrent gate verification (types: TestSuiteResult (`docs/stages/stage-07-trustworthy-automated-checks.md:1`), GateVerificationResult (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`), TestHarnessConfig (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`)).
- `PROJECT_CHARTER.md:132-133`: Persist remote identity/version/checkpoints/download/processing states and change/deletion policy. Pagination, throttling, interruption, repeat sync, and mid-run revocation reconcile with actual files and do not omit/duplicate work.
- `src/components/GoogleDriveHub.tsx:60-69`: Uses `setTimeout` to emulate file discovery; no actual Drive files are imported.
- Checkpoint tracking missing: No database table records `sync_token` or `page_token` to resume interrupted syncs.
- Duplicate suppression: No hash comparison prevents re-importing identical files on successive sync runs.

## Scope

### In scope
- Resumable incremental synchronization polling Google Drive folder using change tokens.
- Sync state persistence: track `remoteFileId`, `version`, `etag`, `syncToken`, and download status in SQLite.
- Interruption recovery: sync interrupted mid-download resumes from last completed file checkpoint.
- Duplicate suppression: files with identical SHA-256 skip redundant processing.

### Out of scope
- Real-time Google Drive webhooks / push notifications (polling with backoff sufficient).
- Syncing non-document files (audio, video, spreadsheets).

### Explicitly not promised
- Instantaneous synchronization of Drive folders with >10,000 files.

## Work breakdown

1. **Task 1: Incremental Sync Service and Checkpoint Manager**
   - Description: Implement DriveSyncService tracking sync tokens, remote file IDs, and change deltas in SQLite.
   - Owned paths: `server/gdrive/syncService.ts,server/db/migrations/003_drive_sync.sql`
   - Target acceptance fact: Fact 1: Drive sync service manages incremental change checkpoints

2. **Task 2: Resumable File Downloader and Deduplicator**
   - Description: Download remote files in chunks and deduplicate against existing document SHA-256 hashes.
   - Owned paths: `server/gdrive/fileDownloader.ts`
   - Target acceptance fact: Fact 2: Downloader verifies checksums and skips duplicate files

3. **Task 3: Drive Sync Trigger and Status API**
   - Description: Implement POST /api/gdrive/sync and GET /api/gdrive/sync/status returning live progress.
   - Owned paths: `server/routes/gdriveSyncRoutes.ts`
   - Target acceptance fact: Fact 3: Sync endpoints report truthful file counts and progress

4. **Task 4: Incremental Drive Sync Test Suite**
   - Description: Author automated tests against mock Drive server verifying pagination, checkpoint resumption, and deduplication.
   - Owned paths: `tests/stage30DriveSync.test.mjs`
   - Target acceptance fact: Fact 4: Incremental sync test suite passes

## Contracts to freeze

```typescript
export interface DriveSyncCheckpoint {
  folderId: string;
  syncToken: string;
  lastSyncedAt: string;
  filesDiscovered: number;
  filesDownloaded: number;
  filesSkippedDuplicate: number;
  status: 'idle' | 'syncing' | 'paused' | 'error';
}
```

## Fan-out plan

- **Archetype:** Archetype C (Sync Engine and Checkpointing)
- **Lanes:**
  | Lane | Role | Mode | Owned paths | Deliverable |
  |---|---|---|---|---|
  | Lane 1 | impl-lane | CODE | `server/gdrive/syncService.ts,server/gdrive/fileDownloader.ts` | Sync engine and downloader |
  | Lane 2 | impl-lane | CODE | `server/routes/gdriveSyncRoutes.ts` | Drive sync routes |
  | Lane 3 | test-author | CODE | `tests/stage30DriveSync.test.mjs` | Incremental sync test suite |
- **Shared files:** None

## Acceptance evidence

| Fact | Proving command/artifact | Expected outcome | Status | Evidence path |
|---|---|---|---|---|
| Fact 1: Drive sync service manages incremental change checkpoints | `node -e "assert(fs.existsSync('server/gdrive/syncService.ts'))"` | Service updates sync checkpoints in SQLite database | pending | `automation/runs/stage-30/service-audit.json` |
| Fact 2: Downloader verifies checksums and skips duplicate files | `node --test tests/stage30DriveSync.test.mjs` | Previously downloaded files skipped based on SHA-256 match | pending | `automation/runs/stage-30/dedup-audit.json` |
| Fact 3: Sync endpoints report truthful file counts and progress | `node --test tests/stage30DriveSync.test.mjs` | GET status returns real count of downloaded and queued files | pending | `automation/runs/stage-30/status-audit.json` |
| Fact 4: Incremental sync test suite passes | `node --test tests/stage30DriveSync.test.mjs` | All incremental sync tests exit 0 against mock Drive | pending | `automation/runs/stage-30/test-summary.json` |

## Tests

### Negative test cases
- Google Drive API rate limit (429) triggers exponential backoff without crashing sync.
- File deleted from Drive while download in progress handled without failing entire sync batch.

### Boundary test cases
- Folder with 0 files completes sync cleanly with status idle.
- Paginating through 500 files across 5 pages fetches all 500 files.

### Interruption and recovery test cases
- Simulated server restart mid-sync resumes from last saved file checkpoint.
- Repeated sync runs on unchanged folder download 0 new files.

### Security and isolation test cases
- Downloaded files stored directly in private storage with generated UUID keys.
- Files matching non-PDF/image MIME types skipped and logged as unsupported.

## Dependencies

### Upstream prerequisites
- Stage 29 (Real constrained Drive authorization): Provides authenticated client.

### Downstream consumers
- Stage 33 (Controlled overload and quotas): Enforces rate limits on sync.
- Stage 38 (Full workflow and test-effectiveness checks): Drives sync in E2E tests.

## External gates

- **External blocker:** None (uses mock Drive harness from Stage 29)
- **Automated local test harness:** Automated test suite using local mock Drive server with synthetic folder structures
- **Owner sign-off item:** None

## Risks and known defects

- Risk 1: Large Google Drive folders causing sync timeouts if pagination is not chunked.
- Known defect 1: Current GoogleDriveHub component uses fake simulated timer.

## Completion draft (S0–S8)

### S0 Reconcile
- Audit Google Drive sync requirements and checkpoint persistence. (DRAFT — NOT EVIDENCED)

### S1 Plan
- Draft incremental sync protocol and deduplication algorithm. (DRAFT — NOT EVIDENCED)

### S2 Build
- Author `syncService.ts`, `fileDownloader.ts`, routes, and tests. (DRAFT — NOT EVIDENCED)

### S3 Gate
- Execute Drive sync test suite via `npm test`. (DRAFT — NOT EVIDENCED)

### S4 Independent review
- Independent review audits pagination and checkpoint resumption. (DRAFT — NOT EVIDENCED)

### S5 Correction
- Tune chunk download sizes and timeout handlers. (DRAFT — NOT EVIDENCED)

### S6 Stage-exit checklist
- Stage-exit checklist verification. (DRAFT — NOT EVIDENCED)

### S7 Record and promote
- Record promotion evidence. (DRAFT — NOT EVIDENCED)

### S8 Advance
- Advance to Stage 31. (DRAFT — NOT EVIDENCED)


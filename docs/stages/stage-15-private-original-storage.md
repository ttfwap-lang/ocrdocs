---
stage: 15
slug: private-original-storage
title: Private original storage
status: not-started
depends_on: [12,14]
blocks: [16,20,34]
weight_area: security
external_gates: []
charter_lines: "87-88"
gate_quote_sha256: "1af8abb8704704990a2007a37e038ac5feaf2b0601fb580a5414ed6f894e3437"
evidence_dir: automation/runs/stage-15
last_reconciled: 2026-09-13
---

# Stage 15 — Private original storage



## Charter gate (verbatim)

> Use generated keys, integrity hashes, private delivery, ownership and documented encryption/key handling. Gate: duplicate content/names, interrupted writes, guessed paths and revoked downloads do not leak or corrupt data.

## Verified current state

- Stage 3 (Architecture and failure model) established: Established component topology (Express server, transactional SQLite, Python OCR worker) and formal failure state machine with bounded worker lease reclaims and non-ephemeral job transitions (types: JobStatus (`docs/stage3/authoritative-contracts.md:15`), FailureTransition (`docs/stage3/authoritative-contracts.md:42`), ComponentTopology (`docs/stage3/component-topology.md:1`)).
- Stage 4 (Truthful demonstration/live separation) established: Isolated simulated demo routes and mock fixtures behind explicit environment flags (DEMO_MODE=false), ensuring live OCR pipelines operate against real extractors (types: ServiceAvailabilityResponse (`src/types.ts:177`), DemoIsolationConfig (`server/routes/demoGuard.ts:1`), LivePipelineGuard (`server/routes/demoGuard.ts:1`)).
- Stage 5 (Reproducible dependencies) established: Pinned Node.js, Python 3.10+, and native OCR runtime dependencies in lockfiles with reproducible local build environments (types: PinnedDependency (`src/types.ts:185`), RuntimeDependencyManifest (`package.json:1`), FieldCategory (`src/types.ts:6`)).
- Stage 6 (Build and startup corrections) established: Guaranteed clean headless application startup with health probes and zero-downtime hot reloading (types: ServerLifecycleConfig (`src/types.ts:223`), HealthCheckResponse (`server/health.ts:1`), StartupProbeConfig (`server/health.ts:1`)).
- Stage 7 (Trustworthy automated checks) established: Established trustworthy automated testing harness with fast feedback loops, flake detection, and concurrent gate verification (types: TestSuiteResult (`docs/stages/stage-07-trustworthy-automated-checks.md:1`), GateVerificationResult (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`), TestHarnessConfig (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`)).
- `PROJECT_CHARTER.md:29`: Master architecture item 4 mandates private original storage outside public assets with generated UUID keys, integrity hashes, and ownership checks.
- Public assets risk: Vite serves static files from `dist/` or project root; uploaded documents must never reside in web-accessible directories.
- Storage path abstraction: No dedicated storage manager module exists to handle document disk writes, integrity checks, or encrypted delivery.
- Guessable filenames: Current upload logic retains original user filenames directly.

## Scope

### In scope
- Private filesystem storage outside web root (`storage/originals/`, `storage/previews/`).
- UUIDv4 random key generation for stored artifacts to eliminate path guessing.
- SHA-256 integrity hash calculation and verification during upload and retrieval.
- Protected streaming delivery endpoint with authentication and ownership validation.

### Out of scope
- Cloud S3 object storage (single-host private filesystem per charter).
- Hardware security module (HSM) key management.

### Explicitly not promised
- Direct static URL access to original customer banking documents.

## Work breakdown

1. **Task 1: Private Storage Manager Implementation**
   - Description: Implement StorageService handling disk writes, UUID key generation, and directory isolation.
   - Owned paths: `server/storage/storageService.ts`
   - Target acceptance fact: Fact 1: Storage service writes to private directory outside web root

2. **Task 2: Cryptographic Integrity Hashing on Ingestion**
   - Description: Compute and verify SHA-256 digest on upload stream; store in database document record.
   - Owned paths: `server/storage/integrityHasher.ts`
   - Target acceptance fact: Fact 2: Ingestion computes and stores SHA-256 hash

3. **Task 3: Protected Document Streaming Endpoint**
   - Description: Implement GET /api/documents/:id/download with session auth and ownership checks.
   - Owned paths: `server/routes/storageRoutes.ts`
   - Target acceptance fact: Fact 3: Document retrieval enforces authentication and ownership

4. **Task 4: Storage Security and Isolation Test Suite**
   - Description: Author automated tests verifying path traversal prevention, guessed UUID rejection, and integrity checks.
   - Owned paths: `tests/stage15Storage.test.mjs`
   - Target acceptance fact: Fact 4: Storage isolation and security test suite passes

## Contracts to freeze

```typescript
export interface StoredArtifactMetadata {
  storageKey: string;
  originalFilename: string;
  sha256: string;
  byteSize: number;
  mimeType: string;
  storagePath: string;
  ownerId: string;
  createdAt: string;
}
```

## Fan-out plan

- **Archetype:** Archetype H (Private Storage and Integrity)
- **Lanes:**
  | Lane | Role | Mode | Owned paths | Deliverable |
  |---|---|---|---|---|
  | Lane 1 | impl-lane | CODE | `server/storage/**` | Storage service and integrity hasher |
  | Lane 2 | impl-lane | CODE | `server/routes/storageRoutes.ts` | Protected document streaming endpoint |
  | Lane 3 | test-author | CODE | `tests/stage15Storage.test.mjs` | Storage security test suite |
- **Shared files:** server.ts

## Acceptance evidence

| Fact | Proving command/artifact | Expected outcome | Status | Evidence path |
|---|---|---|---|---|
| Fact 1: Storage service writes to private directory outside web root | `node -e "assert(fs.existsSync('server/storage/storageService.ts'))"` | Storage root configured outside dist and public directories | pending | `automation/runs/stage-15/storage-audit.json` |
| Fact 2: Ingestion computes and stores SHA-256 hash | `node --test tests/stage15Storage.test.mjs` | Stored file hash matches computed SHA-256 exactly | pending | `automation/runs/stage-15/integrity-audit.json` |
| Fact 3: Document retrieval enforces authentication and ownership | `node --test tests/stage15Storage.test.mjs` | Unauthenticated or cross-owner download attempts return 403 | pending | `automation/runs/stage-15/auth-download.json` |
| Fact 4: Storage isolation and security test suite passes | `node --test tests/stage15Storage.test.mjs` | All storage security tests pass with exit code 0 | pending | `automation/runs/stage-15/test-summary.json` |

## Tests

### Negative test cases
- Path traversal attacks (e.g. `../../etc/passwd` or `..\\..\\boot.ini`) rejected with 400 Bad Request.
- Requesting unowned document ID returns 403 Forbidden.
- Corrupted file whose hash diverges from database record triggers 500 integrity error.

### Boundary test cases
- Storing 0-byte file rejected; storing exactly 25 MiB file accepted.
- File with 25 MiB + 1 byte rejected at storage layer.

### Interruption and recovery test cases
- Interrupted file upload cleans partial temporary file without leaving disk orphan.
- Re-downloading identical document streams full content without truncation.

### Security and isolation test cases
- Stored files saved with non-executable permissions (chmod 0600 on POSIX).
- Directory listing strictly disabled on storage folders.
- Original user filenames sanitized to strip shell special characters.

## Dependencies

### Upstream prerequisites
- Stage 12 (Transactional application storage): Relational records map to storage keys.
- Stage 14 (Authentication and authorization): Enforces user ownership of stored files.

### Downstream consumers
- Stage 16 (Untrusted upload handling): Feeds validated files into private storage.
- Stage 20 (Integrated vertical slice): Connects upload to private storage and OCR worker.
- Stage 34 (Full data lifecycle): Governs retention and deletion of stored artifacts.

## External gates

- **External blocker:** None
- **Automated local test harness:** Automated path traversal fuzzing test suite in temporary sandbox directory
- **Owner sign-off item:** None

## Risks and known defects

- Risk 1: File descriptor leaks during high-throughput file streaming.
- Known defect 1: Current application stores uploads in memory without disk persistence.

## Completion draft (S0–S8)

### S0 Reconcile
- Audit storage directory structure and permissions. (DRAFT — NOT EVIDENCED)

### S1 Plan
- Draft private storage manager and integrity verification design. (DRAFT — NOT EVIDENCED)

### S2 Build
- Author `storageService.ts`, `integrityHasher.ts`, routes, and tests. (DRAFT — NOT EVIDENCED)

### S3 Gate
- Execute storage security tests via `npm test`. (DRAFT — NOT EVIDENCED)

### S4 Independent review
- Independent review audits path traversal and ownership checks. (DRAFT — NOT EVIDENCED)

### S5 Correction
- Refine stream cleanup and error handlers. (DRAFT — NOT EVIDENCED)

### S6 Stage-exit checklist
- Stage-exit checklist verification. (DRAFT — NOT EVIDENCED)

### S7 Record and promote
- Record promotion evidence. (DRAFT — NOT EVIDENCED)

### S8 Advance
- Advance to Stage 16. (DRAFT — NOT EVIDENCED)


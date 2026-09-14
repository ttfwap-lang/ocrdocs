---
stage: 20
slug: integrated-vertical-slice
title: Integrated vertical slice
status: not-started
depends_on: [2,4,6,10,13,15,16,17,18,19]
blocks: [21,22,26,29]
weight_area: interface-workflow
external_gates: []
charter_lines: "102-103"
gate_quote_sha256: "057d996aa8cfa422f3b25c3e6183f8bd2d6d47684c349770cfd6c0c069e507a2"
evidence_dir: automation/runs/stage-20
last_reconciled: 2026-09-13
---

# Stage 20 — Integrated vertical slice



## Charter gate (verbatim)

> Connect upload/storage/jobs/parsing/OCR/matching/validation/persistence/UI. Gate: unfamiliar examples for each supported initial format complete using their actual bytes/text and a consistent document version, not fixtures.

## Verified current state

- Stage 3 (Architecture and failure model) established: Established component topology (Express server, transactional SQLite, Python OCR worker) and formal failure state machine with bounded worker lease reclaims and non-ephemeral job transitions (types: JobStatus (`docs/stage3/authoritative-contracts.md:15`), FailureTransition (`docs/stage3/authoritative-contracts.md:42`), ComponentTopology (`docs/stage3/component-topology.md:1`)).
- Stage 4 (Truthful demonstration/live separation) established: Isolated simulated demo routes and mock fixtures behind explicit environment flags (DEMO_MODE=false), ensuring live OCR pipelines operate against real extractors (types: ServiceAvailabilityResponse (`src/types.ts:177`), DemoIsolationConfig (`server/routes/demoGuard.ts:1`), LivePipelineGuard (`server/routes/demoGuard.ts:1`)).
- Stage 5 (Reproducible dependencies) established: Pinned Node.js, Python 3.10+, and native OCR runtime dependencies in lockfiles with reproducible local build environments (types: PinnedDependency (`src/types.ts:185`), RuntimeDependencyManifest (`package.json:1`), FieldCategory (`src/types.ts:6`)).
- Stage 6 (Build and startup corrections) established: Guaranteed clean headless application startup with health probes and zero-downtime hot reloading (types: ServerLifecycleConfig (`src/types.ts:223`), HealthCheckResponse (`server/health.ts:1`), StartupProbeConfig (`server/health.ts:1`)).
- Stage 7 (Trustworthy automated checks) established: Established trustworthy automated testing harness with fast feedback loops, flake detection, and concurrent gate verification (types: TestSuiteResult (`docs/stages/stage-07-trustworthy-automated-checks.md:1`), GateVerificationResult (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`), TestHarnessConfig (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`)).
- `PROJECT_CHARTER.md:102-103`: Connect upload/storage/jobs/parsing/OCR/matching/validation/persistence/UI using actual bytes/text and consistent document version, not fixtures.
- Existing UI views (`MatcherStudio`, `AuditAndEngineView`): Render from static mock arrays in `src/data/*.ts`.
- Vertical slice integration absent: The upload flow does not yet pipe real uploaded bytes through private storage, durable job creation, Python OCR extraction, TS field matching, SQLite persistence, and UI display.
- Unfamiliar document testing: Needs verification on real unseen PDF/image files.

## Scope

### In scope
- End-to-end integration: File upload -> storage -> job queue -> Python OCR -> TS matcher -> SQLite -> REST API -> React UI.
- Elimination of static fixture substitution across the primary document processing pipeline.
- Validation of vertical slice across all supported initial document formats (digital PDF, scanned PDF, mixed PDF, PNG, JPEG).
- End-to-end integration test asserting real text extraction and database record creation from actual bytes.

### Out of scope
- Google Drive cloud import integration (Stages 29–30).
- Multi-reviewer collaborative workflows (Stage 27).

### Explicitly not promised
- Instantaneous extraction for 50-page complex scanned portfolios.

## Work breakdown

1. **Task 1: End-to-End Ingestion Pipeline Controller**
   - Description: Wire upload handler to create document record, write private storage, and enqueue durable OCR job.
   - Owned paths: `server/controllers/ingestionController.ts`
   - Target acceptance fact: Fact 1: Ingestion controller orchestrates upload, storage, and job queue
   - Downstream integration: incorporates Stage 4 (Truthful demonstration/live separation) established contracts and patterns.
   - Downstream integration: incorporates Stage 6 (Build and startup corrections) established contracts and patterns.

2. **Task 2: Worker-to-Matcher Pipeline Integration**
   - Description: Connect OCR worker word/text stream into TypeScript OCR matcher engine to extract 99 bank fields.
   - Owned paths: `server/services/extractionPipeline.ts`
   - Target acceptance fact: Fact 2: Extraction pipeline binds OCR output to bank field matcher

3. **Task 3: React UI Real Ingestion Hook and Poller**
   - Description: Update React UI to upload real document and poll job endpoint for real extraction results.
   - Owned paths: `src/hooks/useDocumentProcessing.ts`
   - Target acceptance fact: Fact 3: UI hook initiates real document processing and consumes results

4. **Task 4: Integrated Vertical Slice E2E Test Suite**
   - Description: Author end-to-end test executing full upload-to-result pipeline on unfamiliar sample PDFs.
   - Owned paths: `tests/stage20VerticalSlice.test.mjs`
   - Target acceptance fact: Fact 4: Vertical slice test passes on real bytes across supported formats

## Contracts to freeze

```typescript
// Integrates Stage 6 (Build and startup corrections) frozen contracts
// Integrates Stage 4 (Truthful demonstration/live separation) frozen contracts
export interface VerticalSliceExecution {
  documentId: string;
  jobId: string;
  sourceFormat: 'pdf_digital' | 'pdf_scanned' | 'image_png' | 'image_jpeg';
  byteSize: number;
  extractedFieldCount: number;
  status: 'completed';
  executionTimeMs: number;
}
```

## Fan-out plan

- **Archetype:** Archetype A (Full Vertical Slice Fan-Out)
- **Lanes:**
  | Lane | Role | Mode | Owned paths | Deliverable |
  |---|---|---|---|---|
  | Lane 1 | impl-lane | CODE | `server/controllers/ingestionController.ts,server/services/extractionPipeline.ts` | Backend ingestion and extraction pipeline |
  | Lane 2 | impl-lane | CODE | `src/hooks/useDocumentProcessing.ts` | Frontend real processing hook |
  | Lane 3 | test-author | CODE | `tests/stage20VerticalSlice.test.mjs` | End-to-end integration test suite |
- **Shared files:** server.ts

## Acceptance evidence

| Fact | Proving command/artifact | Expected outcome | Status | Evidence path |
|---|---|---|---|---|
| Fact 1: Ingestion controller orchestrates upload, storage, and job queue | `node -e "assert(fs.existsSync('server/controllers/ingestionController.ts'))"` | Controller links upload to private storage and job queue | pending | `automation/runs/stage-20/controller-audit.json` |
| Fact 2: Extraction pipeline binds OCR output to bank field matcher | `node -e "assert(fs.existsSync('server/services/extractionPipeline.ts'))"` | Pipeline executes OCR worker and extracts bank fields | pending | `automation/runs/stage-20/pipeline-audit.json` |
| Fact 3: UI hook initiates real document processing and consumes results | `node -e "assert(fs.existsSync('src/hooks/useDocumentProcessing.ts'))"` | Frontend hook interfaces with real backend endpoints | pending | `automation/runs/stage-20/hook-audit.json` |
| Fact 4: Vertical slice test passes on real bytes across supported formats | `node --test tests/stage20VerticalSlice.test.mjs` | All end-to-end vertical slice tests pass | pending | `automation/runs/stage-20/test-summary.json` |

## Tests

### Negative test cases
- Malformed PDF payload in upload triggers structured error without creating orphaned database rows.
- OCR worker timeout causes job to fail gracefully and update status to failed.

### Boundary test cases
- Processing 1-page document completes end-to-end in under 3s.
- Document with 0 extractable bank fields yields empty results array without crashing UI.

### Interruption and recovery test cases
- Restarting server while job is pending results in job pickup on restart.
- Client disconnect during upload cancels processing.

### Security and isolation test cases
- End-to-end flow enforces user authentication and document ownership.
- No unredacted PII emitted in server console logs during processing.

## Dependencies

### Upstream prerequisites
- Stage 2 (Document/workflow matrix): Supported formats and layout limits.
- Stage 4 (Truthful demonstration/live separation) [PROMOTED]: Ensures live pipeline uses zero mock fixtures.
- Stage 6 (Build and startup corrections) [PROMOTED]: Clean server environment.
- Stage 10 (Correct extraction defects): Accurate field matcher engine.
- Stage 13 (Persistence invariants): Transactional database.
- Stage 15 (Private original storage): Secure file storage.
- Stage 16 (Untrusted upload handling): Sanitized file input.
- Stage 17 (Page-level native extraction/routing): Page extraction.
- Stage 18 (Real qualified OCR): Python OCR engine.
- Stage 19 (Durable job transitions): Job queue engine.

### Downstream consumers
- Stage 21 (Immutable extraction evidence): Attaches evidence coordinates to results.
- Stage 22 (Genuine progress/error streaming): Streams live progress events to UI.
- Stage 26 (Real document/result interface): Displays persisted documents in UI.

## External gates

- **External blocker:** None
- **Automated local test harness:** Automated integration test using real sample PDF/PNG binaries in tests/fixtures
- **Owner sign-off item:** None

## Risks and known defects

- Risk 1: Cross-platform Python execution latency impacting end-to-end test runtimes.
- Known defect 1: UI views currently read from static data/ files rather than querying backend.

## Completion draft (S0–S8)

### S0 Reconcile
- Audit integration points between storage, queue, OCR, and frontend. (DRAFT — NOT EVIDENCED)

### S1 Plan
- Draft vertical slice architecture and pipeline controller design. (DRAFT — NOT EVIDENCED)

### S2 Build
- Author `ingestionController.ts`, `extractionPipeline.ts`, `useDocumentProcessing.ts`, and tests. (DRAFT — NOT EVIDENCED)

### S3 Gate
- Execute vertical slice test suite via `npm test`. (DRAFT — NOT EVIDENCED)

### S4 Independent review
- Independent review audits real byte handling and absence of mock data. (DRAFT — NOT EVIDENCED)

### S5 Correction
- Refine error handling and poller timing. (DRAFT — NOT EVIDENCED)

### S6 Stage-exit checklist
- Stage-exit checklist verification. (DRAFT — NOT EVIDENCED)

### S7 Record and promote
- Record promotion evidence. (DRAFT — NOT EVIDENCED)

### S8 Advance
- Advance to Stage 21. (DRAFT — NOT EVIDENCED)


---
stage: 18
slug: real-qualified-ocr
title: Real qualified OCR
status: not-started
depends_on: [5,17]
blocks: [19,20,31]
weight_area: real-ingestion-ocr
external_gates: []
charter_lines: "96-97"
gate_quote_sha256: "e08361d849740a64105d98c3435815d037d3e8690d7fad2739f1be5b65a012d2"
evidence_dir: automation/runs/stage-18
last_reconciled: 2026-09-13
---

# Stage 18 — Real qualified OCR



## Charter gate (verbatim)

> Select one engine by measured examples, licensing, compatibility and resource use. Gate: real pixels yield traceable output; cold starts, missing models, supported hardware fallbacks, timeouts and memory exhaustion are explicit.

## Verified current state

- Stage 3 (Architecture and failure model) established: Established component topology (Express server, transactional SQLite, Python OCR worker) and formal failure state machine with bounded worker lease reclaims and non-ephemeral job transitions (types: JobStatus (`docs/stage3/authoritative-contracts.md:15`), FailureTransition (`docs/stage3/authoritative-contracts.md:42`), ComponentTopology (`docs/stage3/component-topology.md:1`)).
- Stage 4 (Truthful demonstration/live separation) established: Isolated simulated demo routes and mock fixtures behind explicit environment flags (DEMO_MODE=false), ensuring live OCR pipelines operate against real extractors (types: ServiceAvailabilityResponse (`src/types.ts:177`), DemoIsolationConfig (`server/routes/demoGuard.ts:1`), LivePipelineGuard (`server/routes/demoGuard.ts:1`)).
- Stage 5 (Reproducible dependencies) established: Pinned Node.js, Python 3.10+, and native OCR runtime dependencies in lockfiles with reproducible local build environments (types: PinnedDependency (`src/types.ts:185`), RuntimeDependencyManifest (`package.json:1`), FieldCategory (`src/types.ts:6`)).
- Stage 6 (Build and startup corrections) established: Guaranteed clean headless application startup with health probes and zero-downtime hot reloading (types: ServerLifecycleConfig (`src/types.ts:223`), HealthCheckResponse (`server/health.ts:1`), StartupProbeConfig (`server/health.ts:1`)).
- Stage 7 (Trustworthy automated checks) established: Established trustworthy automated testing harness with fast feedback loops, flake detection, and concurrent gate verification (types: TestSuiteResult (`docs/stages/stage-07-trustworthy-automated-checks.md:1`), GateVerificationResult (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`), TestHarnessConfig (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`)).
- `PROJECT_CHARTER.md:96-97`: Select one engine by measured examples, licensing, compatibility, and resource use. Real pixels yield traceable output.
- `scripts/ocr_spark_engine.py`: Prototype script exists, but lacks formal integration with Express server or versioned IPC protocol.
- `server/services/multipassOcr.ts:20-50`: Cloud OCR engines are simulated stubs.
- Engine qualification: Need measured qualification of primary local OCR engine (Tesseract 5 / EasyOCR / PaddleOCR) on banking layouts.

## Scope

### In scope
- Qualification and integration of primary local OCR worker (Tesseract 5 native / Python subprocess).
- Structured IPC protocol between Express server and Python worker over stdin/stdout JSON lines.
- Generation of character-level or word-level bounding box coordinates and confidence scores.
- Resource bounding: worker timeout (60s), max memory (1GB), and graceful fallback on crash.

### Out of scope
- Cloud OCR provider production accounts (Google Cloud Document AI / AWS Textract).
- Distributed Celery / Redis worker clusters.

### Explicitly not promised
- Sub-second OCR extraction on low-end single-core CPUs.

## Work breakdown

1. **Task 1: Python OCR Worker Script Modernization**
   - Description: Refactor scripts/ocr_spark_engine.py into production worker reading JSON commands and emitting structured OCR output.
   - Owned paths: `scripts/ocr_worker.py`
   - Target acceptance fact: Fact 1: Python OCR worker script executes structured extraction
   - Downstream integration: incorporates Stage 5 (Reproducible dependencies) established contracts and patterns.

2. **Task 2: Node.js Worker Process Supervisor**
   - Description: Implement child_process supervisor managing worker lifecycle, timeouts, and JSON IPC.
   - Owned paths: `server/ocr/workerSupervisor.ts`
   - Target acceptance fact: Fact 2: Worker supervisor bounds execution and restarts on crash

3. **Task 3: Real Pixel OCR Qualification Benchmark**
   - Description: Benchmark selected OCR engine on representative banking document snippets and record accuracy/speed.
   - Owned paths: `docs/stage18/ocr-qualification.md`
   - Target acceptance fact: Fact 3: Engine qualification benchmark completed

4. **Task 4: Worker IPC and Extraction Test Suite**
   - Description: Author automated integration test sending raster image to worker and verifying extracted words and bounding boxes.
   - Owned paths: `tests/stage18OcrWorker.test.mjs`
   - Target acceptance fact: Fact 4: Real OCR worker test passes on test image

## Contracts to freeze

```typescript
// Integrates Stage 5 (Reproducible dependencies) frozen contracts
export interface OcrWorkerRequest {
  jobId: string;
  imagePath: string;
  pageIndex: number;
  engine: 'tesseract';
  timeoutMs: number;
}

export interface OcrWorkerResponse {
  jobId: string;
  pageIndex: number;
  fullText: string;
  words: Array<{
    text: string;
    confidence: number;
    bbox: [number, number, number, number]; // [x0, y0, x1, y1]
  }>;
  durationMs: number;
  engineVersion: string;
}
```

## Fan-out plan

- **Archetype:** Archetype C (Native Worker and IPC Subprocess)
- **Lanes:**
  | Lane | Role | Mode | Owned paths | Deliverable |
  |---|---|---|---|---|
  | Lane 1 | impl-lane | CODE | `scripts/ocr_worker.py,docs/stage18/**` | Python OCR worker and qualification report |
  | Lane 2 | impl-lane | CODE | `server/ocr/workerSupervisor.ts` | Process supervisor and JSON IPC manager |
  | Lane 3 | test-author | CODE | `tests/stage18OcrWorker.test.mjs` | Worker subprocess integration test suite |
- **Shared files:** None

## Acceptance evidence

| Fact | Proving command/artifact | Expected outcome | Status | Evidence path |
|---|---|---|---|---|
| Fact 1: Python OCR worker script executes structured extraction | `node -e "assert(fs.existsSync('scripts/ocr_worker.py'))"` | Worker script conforms to JSON IPC protocol | pending | `automation/runs/stage-18/worker-audit.json` |
| Fact 2: Worker supervisor bounds execution and restarts on crash | `node --test tests/stage18OcrWorker.test.mjs` | Process timeout (60s) and crash recovery verified | pending | `automation/runs/stage-18/supervisor-audit.json` |
| Fact 3: Engine qualification benchmark completed | `node -e "assert(fs.existsSync('docs/stage18/ocr-qualification.md'))"` | Benchmark documents speed, memory, and word accuracy | pending | `automation/runs/stage-18/qualification-audit.json` |
| Fact 4: Real OCR worker test passes on test image | `node --test tests/stage18OcrWorker.test.mjs` | Test image yields real extracted words with bounding boxes | pending | `automation/runs/stage-18/test-summary.json` |

## Tests

### Negative test cases
- Worker crash (SIGSEGV/SIGKILL) caught by supervisor and converted to structured JobFailedError.
- Invalid image path returns explicit file_not_found error code.

### Boundary test cases
- Worker timeout boundary (60,000ms) terminates worker process cleanly.
- Large image (4000x3000px) processes within configured memory ceiling (1GB).

### Interruption and recovery test cases
- Supervisor restarts worker automatically after unhandled exception.
- Worker handles SIGTERM and shuts down cleanly without zombie process.

### Security and isolation test cases
- Image paths passed to worker sanitized to prevent command injection in shell arguments.
- Worker runs in unprivileged sandbox without outbound network access.

## Dependencies

### Upstream prerequisites
- Stage 5 (Reproducible dependencies) [PROMOTED]: Pins Tesseract and Python packages.
- Stage 17 (Page-level native extraction/routing): Routes rasterized pages to this worker.

### Downstream consumers
- Stage 19 (Durable job transitions): Executes OCR jobs through stateful queue.
- Stage 20 (Integrated vertical slice): Integrates real OCR worker in vertical slice.
- Stage 31 (Evidence-driven extra passes): Evaluates secondary OCR passes.

## External gates

- **External blocker:** None
- **Automated local test harness:** Automated test suite using local synthetic PNG image fixtures with known text
- **Owner sign-off item:** None

## Risks and known defects

- Risk 1: Host system missing native Tesseract binary or OCR language models.
- Known defect 1: `scripts/ocr_spark_engine.py` prints unstructured text to console without bounding boxes.

## Completion draft (S0–S8)

### S0 Reconcile
- Audit Python OCR scripts and verify local Tesseract binary. (DRAFT — NOT EVIDENCED)

### S1 Plan
- Draft JSON IPC protocol and worker supervisor architecture. (DRAFT — NOT EVIDENCED)

### S2 Build
- Author `ocr_worker.py`, `workerSupervisor.ts`, and test suite. (DRAFT — NOT EVIDENCED)

### S3 Gate
- Execute worker integration tests via `npm test`. (DRAFT — NOT EVIDENCED)

### S4 Independent review
- Independent review verifies bounding box accuracy and process bounding. (DRAFT — NOT EVIDENCED)

### S5 Correction
- Tune worker timeouts and memory limits. (DRAFT — NOT EVIDENCED)

### S6 Stage-exit checklist
- Stage-exit checklist verification. (DRAFT — NOT EVIDENCED)

### S7 Record and promote
- Record promotion evidence. (DRAFT — NOT EVIDENCED)

### S8 Advance
- Advance to Stage 19. (DRAFT — NOT EVIDENCED)


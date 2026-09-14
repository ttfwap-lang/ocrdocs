---
stage: 17
slug: page-level-native-extraction-routing
title: Page-level native extraction/routing
status: not-started
depends_on: [11,16]
blocks: [18,20]
weight_area: real-ingestion-ocr
external_gates: []
charter_lines: "93-94"
gate_quote_sha256: "c88205d9e3464ad58ead7971facad0c9130b9c9d01606ac01d77aa97ce2998b7"
evidence_dir: automation/runs/stage-17
last_reconciled: 2026-09-13
---

# Stage 17 — Page-level native extraction/routing



## Charter gate (verbatim)

> Preserve page order and inspect usable native text versus OCR needs. Gate: digital/scanned/mixed/rotated/blank and misleading text-layer fixtures never silently omit supported pages.

## Verified current state

- Stage 3 (Architecture and failure model) established: Established component topology (Express server, transactional SQLite, Python OCR worker) and formal failure state machine with bounded worker lease reclaims and non-ephemeral job transitions (types: JobStatus (`docs/stage3/authoritative-contracts.md:15`), FailureTransition (`docs/stage3/authoritative-contracts.md:42`), ComponentTopology (`docs/stage3/component-topology.md:1`)).
- Stage 4 (Truthful demonstration/live separation) established: Isolated simulated demo routes and mock fixtures behind explicit environment flags (DEMO_MODE=false), ensuring live OCR pipelines operate against real extractors (types: ServiceAvailabilityResponse (`src/types.ts:177`), DemoIsolationConfig (`server/routes/demoGuard.ts:1`), LivePipelineGuard (`server/routes/demoGuard.ts:1`)).
- Stage 5 (Reproducible dependencies) established: Pinned Node.js, Python 3.10+, and native OCR runtime dependencies in lockfiles with reproducible local build environments (types: PinnedDependency (`src/types.ts:185`), RuntimeDependencyManifest (`package.json:1`), FieldCategory (`src/types.ts:6`)).
- Stage 6 (Build and startup corrections) established: Guaranteed clean headless application startup with health probes and zero-downtime hot reloading (types: ServerLifecycleConfig (`src/types.ts:223`), HealthCheckResponse (`server/health.ts:1`), StartupProbeConfig (`server/health.ts:1`)).
- Stage 7 (Trustworthy automated checks) established: Established trustworthy automated testing harness with fast feedback loops, flake detection, and concurrent gate verification (types: TestSuiteResult (`docs/stages/stage-07-trustworthy-automated-checks.md:1`), GateVerificationResult (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`), TestHarnessConfig (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`)).
- `PROJECT_CHARTER.md:93-94`: Preserve page order, inspect usable native text versus OCR needs, handle digital/scanned/mixed/rotated/blank pages.
- Native extraction absent: Application currently feeds raw simulated text to matcher without parsing real PDF page streams.
- Blank page handling: No density check exists to detect blank pages or scan artifacts.
- Orientation detection: No rotation detection logic (0°, 90°, 180°, 270°) exists.

## Scope

### In scope
- Page-level text extraction using native PDF parser (pdf-parse / pypdf / PyMuPDF).
- Classification of each page: digital (usable text layer), scanned (requires OCR), or mixed.
- Blank page detection based on text density and white pixel threshold.
- Page orientation normalization detecting and correcting rotated pages.

### Out of scope
- Complex multi-column table segmentation (Stage 18).
- Handwritten cursive recognition.

### Explicitly not promised
- 100% accurate OCR text from pages with severe water damage or illegible scans.

## Work breakdown

1. **Task 1: PDF Native Page Text Extractor**
   - Description: Extract raw text, word coordinates, and character counts per page in sequential order.
   - Owned paths: `server/ocr/pageExtractor.ts`
   - Target acceptance fact: Fact 1: Native extractor preserves page order and extracts text

2. **Task 2: Page Type Classifier (Digital vs Scanned vs Blank)**
   - Description: Classify pages by text layer completeness to determine if OCR rasterization is required.
   - Owned paths: `server/ocr/pageClassifier.ts`
   - Target acceptance fact: Fact 2: Classifier categorizes digital, scanned, and blank pages

3. **Task 3: Page Rotation Detection and Deskewing Utility**
   - Description: Inspect page rotation metadata and text orientation; normalize to upright 0°.
   - Owned paths: `server/ocr/orientationNormalizer.ts`
   - Target acceptance fact: Fact 3: Orientation normalizer handles rotated pages

4. **Task 4: Page Routing and Extraction Test Suite**
   - Description: Author automated tests across digital, scanned, mixed, rotated, and blank PDF test fixtures.
   - Owned paths: `tests/stage17PageRouting.test.mjs`
   - Target acceptance fact: Fact 4: Page routing test suite passes all document layouts

## Contracts to freeze

```typescript
export type PageKind = 'digital' | 'scanned' | 'mixed' | 'blank';

export interface PageExtractionResult {
  pageIndex: number;
  pageKind: PageKind;
  rotationDegrees: 0 | 90 | 180 | 270;
  rawText: string;
  charCount: number;
  requiresOcr: boolean;
  wordBoxes?: Array<{ text: string; bbox: [number, number, number, number] }>;
}
```

## Fan-out plan

- **Archetype:** Archetype C (Page Extraction and Routing)
- **Lanes:**
  | Lane | Role | Mode | Owned paths | Deliverable |
  |---|---|---|---|---|
  | Lane 1 | impl-lane | CODE | `server/ocr/pageExtractor.ts,server/ocr/pageClassifier.ts` | Page text extractor and classifier |
  | Lane 2 | impl-lane | CODE | `server/ocr/orientationNormalizer.ts` | Orientation and rotation normalizer |
  | Lane 3 | test-author | CODE | `tests/stage17PageRouting.test.mjs` | Page routing test suite |
- **Shared files:** None

## Acceptance evidence

| Fact | Proving command/artifact | Expected outcome | Status | Evidence path |
|---|---|---|---|---|
| Fact 1: Native extractor preserves page order and extracts text | `node -e "assert(fs.existsSync('server/ocr/pageExtractor.ts'))"` | Page extractor outputs ordered array of page records | pending | `automation/runs/stage-17/extractor-audit.json` |
| Fact 2: Classifier categorizes digital, scanned, and blank pages | `node --test tests/stage17PageRouting.test.mjs` | Pages classified correctly without false blank positives | pending | `automation/runs/stage-17/classifier-audit.json` |
| Fact 3: Orientation normalizer handles rotated pages | `node --test tests/stage17PageRouting.test.mjs` | Rotated pages (90/180/270) normalized to 0 degrees | pending | `automation/runs/stage-17/rotation-audit.json` |
| Fact 4: Page routing test suite passes all document layouts | `node --test tests/stage17PageRouting.test.mjs` | All page extraction tests exit 0 | pending | `automation/runs/stage-17/test-summary.json` |

## Tests

### Negative test cases
- Corrupt page stream in multi-page PDF throws typed PageExtractionError identifying page index.
- Page with zero text layer and unreadable raster tagged as failed_scan.

### Boundary test cases
- Page with exactly 1 character classified as non-blank.
- 50-page document processes sequentially without page skipping.

### Interruption and recovery test cases
- Processing timeout on complex vector graphics page terminates page parse cleanly.
- Memory usage remains stable (<200MB) across 50 pages.

### Security and isolation test cases
- PDF parser runs with sandboxed font rendering.
- Extracted text strings sanitized against control character exploits.

## Dependencies

### Upstream prerequisites
- Stage 11 (Versioned result contracts): Adopts page-level contract schema.
- Stage 16 (Untrusted upload handling): Receives sanitized PDFs.

### Downstream consumers
- Stage 18 (Real qualified OCR): Scanned pages routed to Python OCR worker.
- Stage 20 (Integrated vertical slice): Coordinates page routing in vertical pipeline.

## External gates

- **External blocker:** None
- **Automated local test harness:** Automated test suite using synthetic multi-page PDF fixtures
- **Owner sign-off item:** None

## Risks and known defects

- Risk 1: Hidden or misleading text layers in PDFs (e.g. poor previous OCR) masking scan quality.
- Known defect 1: Current system has no mechanism to determine whether a PDF has a usable text layer.

## Completion draft (S0–S8)

### S0 Reconcile
- Audit native PDF parsing libraries and sample page outputs. (DRAFT — NOT EVIDENCED)

### S1 Plan
- Draft page classification heuristics and orientation contract. (DRAFT — NOT EVIDENCED)

### S2 Build
- Author `pageExtractor.ts`, `pageClassifier.ts`, and test fixtures. (DRAFT — NOT EVIDENCED)

### S3 Gate
- Execute page routing test suite via `npm test`. (DRAFT — NOT EVIDENCED)

### S4 Independent review
- Independent review checks page order preservation and classification accuracy. (DRAFT — NOT EVIDENCED)

### S5 Correction
- Tune blank page density threshold. (DRAFT — NOT EVIDENCED)

### S6 Stage-exit checklist
- Stage-exit checklist verification. (DRAFT — NOT EVIDENCED)

### S7 Record and promote
- Record promotion evidence. (DRAFT — NOT EVIDENCED)

### S8 Advance
- Advance to Stage 18. (DRAFT — NOT EVIDENCED)


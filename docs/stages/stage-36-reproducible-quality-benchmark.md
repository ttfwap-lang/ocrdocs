---
stage: 36
slug: reproducible-quality-benchmark
title: Reproducible quality benchmark
status: not-started
depends_on: [8,21,31]
blocks: [37,42]
weight_area: extraction-validation
external_gates: []
charter_lines: "150-151"
gate_quote_sha256: "0e59d5d75f92f3d297a72aa70967a14ae105acd2411cd6f89c22016785ecb233"
evidence_dir: automation/runs/stage-36
last_reconciled: 2026-09-13
---

# Stage 36 — Reproducible quality benchmark



## Charter gate (verbatim)

> Define metrics for correct/incorrect/missing/extra/wrong-applicant/normalized/reviewed values and verify calculations manually on small examples. Gate: versioned per-field/layout results disclose denominators, review/abstention and statistical uncertainty.

## Verified current state

- Stage 3 (Architecture and failure model) established: Established component topology (Express server, transactional SQLite, Python OCR worker) and formal failure state machine with bounded worker lease reclaims and non-ephemeral job transitions (types: JobStatus (`docs/stage3/authoritative-contracts.md:15`), FailureTransition (`docs/stage3/authoritative-contracts.md:42`), ComponentTopology (`docs/stage3/component-topology.md:1`)).
- Stage 4 (Truthful demonstration/live separation) established: Isolated simulated demo routes and mock fixtures behind explicit environment flags (DEMO_MODE=false), ensuring live OCR pipelines operate against real extractors (types: ServiceAvailabilityResponse (`src/types.ts:177`), DemoIsolationConfig (`server/routes/demoGuard.ts:1`), LivePipelineGuard (`server/routes/demoGuard.ts:1`)).
- Stage 5 (Reproducible dependencies) established: Pinned Node.js, Python 3.10+, and native OCR runtime dependencies in lockfiles with reproducible local build environments (types: PinnedDependency (`src/types.ts:185`), RuntimeDependencyManifest (`package.json:1`), FieldCategory (`src/types.ts:6`)).
- Stage 6 (Build and startup corrections) established: Guaranteed clean headless application startup with health probes and zero-downtime hot reloading (types: ServerLifecycleConfig (`src/types.ts:223`), HealthCheckResponse (`server/health.ts:1`), StartupProbeConfig (`server/health.ts:1`)).
- Stage 7 (Trustworthy automated checks) established: Established trustworthy automated testing harness with fast feedback loops, flake detection, and concurrent gate verification (types: TestSuiteResult (`docs/stages/stage-07-trustworthy-automated-checks.md:1`), GateVerificationResult (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`), TestHarnessConfig (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`)).
- `PROJECT_CHARTER.md:150-151`: Define metrics for correct/incorrect/missing/extra/wrong-applicant/normalized/reviewed values and verify calculations manually on small examples. Disclose denominators, review/abstention, and statistical uncertainty.
- Benchmark harness missing: No automated pipeline currently evaluates OCR extraction accuracy against annotated ground truth.
- Unsubstantiated claims risk: Accuracy claims cannot be made without reproducible benchmark scripts and statistical confidence intervals (95% CI).

## Scope

### In scope
- Reproducible evaluation benchmark harness: runs document pipeline over annotated corpus (from Stage 8).
- Standardized metrics calculation: Exact Match (EM), Normalized Match, Field Precision, Field Recall, F1 Score.
- Error breakdown categorization: Missing, Extra, Value Misread, Wrong Applicant, Date Format Error.
- Reporting statistical confidence intervals (Wilson score interval / bootstrap CI) per field and layout.

### Out of scope
- Tuning algorithms to improve metrics (Stage 37).
- Evaluating on frozen held-out evaluation corpus (Stage 42).

### Explicitly not promised
- Achieving 99% accuracy on uncalibrated initial baseline.

## Work breakdown

1. **Task 1: Benchmark Evaluation Engine Implementation**
   - Description: Implement benchmark runner evaluating extraction output against ground-truth annotations.
   - Owned paths: `scripts/benchmark/evaluator.mjs`
   - Target acceptance fact: Fact 1: Benchmark evaluator computes precision, recall, and error breakdown

2. **Task 2: Statistical Uncertainty and Confidence Interval Calculator**
   - Description: Implement Wilson score confidence interval calculation for field accuracy metrics.
   - Owned paths: `scripts/benchmark/confidenceIntervals.mjs`
   - Target acceptance fact: Fact 2: Statistical module calculates 95% confidence intervals

3. **Task 3: Baseline Quality Benchmark Execution**
   - Description: Execute benchmark over development corpus split and record baseline quality scorecard.
   - Owned paths: `docs/stage36/baseline-benchmark.json`
   - Target acceptance fact: Fact 3: Baseline benchmark report recorded with explicit denominators

4. **Task 4: Benchmark Math and Metric Verification Test Suite**
   - Description: Author unit tests validating metric calculations manually against known 5-field toy examples.
   - Owned paths: `tests/stage36Benchmark.test.mjs`
   - Target acceptance fact: Fact 4: Benchmark calculation test suite passes

## Contracts to freeze

```typescript
export interface FieldQualityMetric {
  fieldId: string;
  totalInstances: number;
  correctCount: number;
  incorrectCount: number;
  missingCount: number;
  extraCount: number;
  exactMatchRate: number;
  confidenceInterval95: [number, number];
  reviewBurdenRate: number;
}

export interface BenchmarkReport {
  corpusVersion: string;
  evaluatedAt: string;
  documentsEvaluated: number;
  overallPrecision: number;
  overallRecall: number;
  overallF1: number;
  perFieldMetrics: Record<string, FieldQualityMetric>;
}
```

## Fan-out plan

- **Archetype:** Archetype B (Evaluation Benchmark and Statistical Metrics)
- **Lanes:**
  | Lane | Role | Mode | Owned paths | Deliverable |
  |---|---|---|---|---|
  | Lane 1 | impl-lane | CODE | `scripts/benchmark/**` | Benchmark evaluator and confidence calculator |
  | Lane 2 | test-author | CODE | `tests/stage36Benchmark.test.mjs` | Metric calculation verification tests |
- **Shared files:** None

## Acceptance evidence

| Fact | Proving command/artifact | Expected outcome | Status | Evidence path |
|---|---|---|---|---|
| Fact 1: Benchmark evaluator computes precision, recall, and error breakdown | `node -e "assert(fs.existsSync('scripts/benchmark/evaluator.mjs'))"` | Evaluator script parses annotations and outputs metrics | pending | `automation/runs/stage-36/evaluator-audit.json` |
| Fact 2: Statistical module calculates 95% confidence intervals | `node -e "assert(fs.existsSync('scripts/benchmark/confidenceIntervals.mjs'))"` | Confidence interval calculation verified mathematically | pending | `automation/runs/stage-36/ci-audit.json` |
| Fact 3: Baseline benchmark report recorded with explicit denominators | `node -e "assert(fs.existsSync('docs/stage36/baseline-benchmark.json'))"` | Baseline report discloses exact denominators and counts | pending | `automation/runs/stage-36/report-audit.json` |
| Fact 4: Benchmark calculation test suite passes | `node --test tests/stage36Benchmark.test.mjs` | Metric math tests pass with manual toy verification | pending | `automation/runs/stage-36/test-summary.json` |

## Tests

### Negative test cases
- Empty ground truth annotation throws explicit InvalidAnnotationError.
- Mismatched field IDs between corpus and results reported as missing_field error.

### Boundary test cases
- Toy example: 4 correct out of 5 yields exactly 80.0% accuracy with known Wilson CI.
- Document with 0 matches yields 0.0% precision without division-by-zero crash.

### Interruption and recovery test cases
- Benchmark execution is deterministic; re-running on same corpus produces identical numbers.
- Evaluation aborts cleanly on corrupt test document without hanging.

### Security and isolation test cases
- Benchmark reports do not expose customer PII values in diff logs.
- Evaluation artifacts saved in structured JSON under versioned paths.

## Dependencies

### Upstream prerequisites
- Stage 8 (Governed evaluation corpus): Provides development corpus and ground truth.
- Stage 21 (Immutable extraction evidence): Extraction results consumed by benchmark.
- Stage 31 (Evidence-driven extra passes): Evaluates multi-pass results.

### Downstream consumers
- Stage 37 (Development-only quality improvement): Uses benchmark to guide tuning.
- Stage 42 (Frozen independent evaluation/pilot): Uses benchmark protocol on held-out split.

## External gates

- **External blocker:** None
- **Automated local test harness:** Automated benchmark script executing against development corpus split
- **Owner sign-off item:** None

## Risks and known defects

- Risk 1: Small sample sizes producing wide confidence intervals.
- Known defect 1: No accuracy benchmark has ever been run on this repository.

## Completion draft (S0–S8)

### S0 Reconcile
- Audit ground truth corpus annotations from Stage 8. (DRAFT — NOT EVIDENCED)

### S1 Plan
- Draft metric definitions and statistical confidence formulas. (DRAFT — NOT EVIDENCED)

### S2 Build
- Author `evaluator.mjs`, `confidenceIntervals.mjs`, run benchmark, and write tests. (DRAFT — NOT EVIDENCED)

### S3 Gate
- Execute benchmark math test suite via `npm test`. (DRAFT — NOT EVIDENCED)

### S4 Independent review
- Independent review audits calculation math against manual calculations. (DRAFT — NOT EVIDENCED)

### S5 Correction
- Record baseline benchmark report. (DRAFT — NOT EVIDENCED)

### S6 Stage-exit checklist
- Stage-exit checklist verification. (DRAFT — NOT EVIDENCED)

### S7 Record and promote
- Record promotion evidence. (DRAFT — NOT EVIDENCED)

### S8 Advance
- Advance to Stage 37. (DRAFT — NOT EVIDENCED)


---
stage: 37
slug: development-only-quality-improvement
title: Development-only quality improvement
status: not-started
depends_on: [10,31,36]
blocks: [38,42]
weight_area: extraction-validation
external_gates: []
charter_lines: "153-154"
gate_quote_sha256: "19c238e08acadf41e05a76382fe23192fc4cab209af1bf587cc421040f2c67bb"
evidence_dir: automation/runs/stage-37
last_reconciled: 2026-09-13
---

# Stage 37 — Development-only quality improvement



## Charter gate (verbatim)

> Tune routing/preprocessing/matching/normalization/review thresholds on development data, recording versions and regressions. Gate: measured critical-field quality and review burden meet scope gates without contaminating held-out evaluation.

## Verified current state

- Stage 3 (Architecture and failure model) established: Established component topology (Express server, transactional SQLite, Python OCR worker) and formal failure state machine with bounded worker lease reclaims and non-ephemeral job transitions (types: JobStatus (`docs/stage3/authoritative-contracts.md:15`), FailureTransition (`docs/stage3/authoritative-contracts.md:42`), ComponentTopology (`docs/stage3/component-topology.md:1`)).
- Stage 4 (Truthful demonstration/live separation) established: Isolated simulated demo routes and mock fixtures behind explicit environment flags (DEMO_MODE=false), ensuring live OCR pipelines operate against real extractors (types: ServiceAvailabilityResponse (`src/types.ts:177`), DemoIsolationConfig (`server/routes/demoGuard.ts:1`), LivePipelineGuard (`server/routes/demoGuard.ts:1`)).
- Stage 5 (Reproducible dependencies) established: Pinned Node.js, Python 3.10+, and native OCR runtime dependencies in lockfiles with reproducible local build environments (types: PinnedDependency (`src/types.ts:185`), RuntimeDependencyManifest (`package.json:1`), FieldCategory (`src/types.ts:6`)).
- Stage 6 (Build and startup corrections) established: Guaranteed clean headless application startup with health probes and zero-downtime hot reloading (types: ServerLifecycleConfig (`src/types.ts:223`), HealthCheckResponse (`server/health.ts:1`), StartupProbeConfig (`server/health.ts:1`)).
- Stage 7 (Trustworthy automated checks) established: Established trustworthy automated testing harness with fast feedback loops, flake detection, and concurrent gate verification (types: TestSuiteResult (`docs/stages/stage-07-trustworthy-automated-checks.md:1`), GateVerificationResult (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`), TestHarnessConfig (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`)).
- `PROJECT_CHARTER.md:153-154`: Tune routing/preprocessing/matching/normalization/review thresholds on development data, recording versions and regressions. Measured critical-field quality and review burden meet scope gates without contaminating held-out evaluation.
- Development data constraint: Tuning must strictly operate on development corpus split; held-out evaluation split must remain untouched.
- Regression tracking: Need automated comparison confirming tuning improved target fields without breaking previously passing fields.

## Scope

### In scope
- Parameter tuning: regex word boundary adjustments, OCR image thresholding, applicant scoping proximity.
- Threshold calibration: calibrate review suggestion threshold (e.g. fields < 0.85 require review).
- Targeted accuracy improvement: achieve >= 95% match rate on critical required banking fields on dev split.
- Contamination prevention: held-out evaluation split remains strictly unread and unmodified.

### Out of scope
- Touching held-out evaluation dataset (Stage 42).
- Arbitrary ad-hoc over-fitting to individual document idiosyncrasies.

### Explicitly not promised
- 100% extraction accuracy on degraded or rotated handwritten inputs.

## Work breakdown

1. **Task 1: Extraction Parameter and Preprocessing Tuning**
   - Description: Optimize regex word boundaries and image contrast enhancement based on dev error analysis.
   - Owned paths: `src/data/fields/index.ts,server/ocr/preprocessingTuner.ts`
   - Target acceptance fact: Fact 1: Tuned parameters improve extraction accuracy on dev corpus

2. **Task 2: Review Threshold Calibration**
   - Description: Calibrate confidence thresholds to balance operator review burden against extraction precision.
   - Owned paths: `server/ocr/thresholdConfig.ts`
   - Target acceptance fact: Fact 2: Review thresholds calibrated to minimize review burden

3. **Task 3: Post-Tuning Quality Benchmark Execution**
   - Description: Re-run benchmark on development split and generate comparative progress scorecard.
   - Owned paths: `docs/stage37/tuned-benchmark.json`
   - Target acceptance fact: Fact 3: Post-tuning benchmark proves measured improvement

4. **Task 4: Non-Contamination and Regression Test Suite**
   - Description: Author automated tests proving zero access to held-out split and confirming zero regressions on past test cases.
   - Owned paths: `tests/stage37Tuning.test.mjs`
   - Target acceptance fact: Fact 4: Tuning test suite confirms zero regression and zero contamination

## Contracts to freeze

```typescript
export interface TuningRecord {
  iteration: number;
  tunedParameters: Record<string, any>;
  devCorpusScore: { precision: number; recall: number; f1: number };
  criticalFieldAccuracy: number;
  reviewBurdenReductionPercent: number;
  heldOutContaminated: false;
}
```

## Fan-out plan

- **Archetype:** Archetype D (Parameter Tuning and Metric Optimization)
- **Lanes:**
  | Lane | Role | Mode | Owned paths | Deliverable |
  |---|---|---|---|---|
  | Lane 1 | impl-lane | CODE | `src/data/fields/**,server/ocr/preprocessingTuner.ts` | Tuned regex and image parameters |
  | Lane 2 | impl-lane | CODE | `server/ocr/thresholdConfig.ts` | Calibrated threshold configuration |
  | Lane 3 | test-author | CODE | `tests/stage37Tuning.test.mjs` | Regression and non-contamination test suite |
- **Shared files:** None

## Acceptance evidence

| Fact | Proving command/artifact | Expected outcome | Status | Evidence path |
|---|---|---|---|---|
| Fact 1: Tuned parameters improve extraction accuracy on dev corpus | `node -e "assert(fs.existsSync('server/ocr/preprocessingTuner.ts'))"` | Tuning parameters demonstrate higher extraction score | pending | `automation/runs/stage-37/tuning-audit.json` |
| Fact 2: Review thresholds calibrated to minimize review burden | `node -e "assert(fs.existsSync('server/ocr/thresholdConfig.ts'))"` | Review threshold configuration calibrated and documented | pending | `automation/runs/stage-37/threshold-audit.json` |
| Fact 3: Post-tuning benchmark proves measured improvement | `node -e "assert(fs.existsSync('docs/stage37/tuned-benchmark.json'))"` | Tuned benchmark exceeds baseline accuracy metrics | pending | `automation/runs/stage-37/comparison-audit.json` |
| Fact 4: Tuning test suite confirms zero regression and zero contamination | `node --test tests/stage37Tuning.test.mjs` | All regression tests pass; held-out checksum unchanged | pending | `automation/runs/stage-37/test-summary.json` |

## Tests

### Negative test cases
- Attempting to read from held-out evaluation corpus folder during tuning throws ContaminationError.
- Tuning modification that breaks an existing Stage 9/10 test fails pipeline immediately.

### Boundary test cases
- Critical required fields (BSB, Account Number, Applicant Name) reach >= 95% accuracy on dev split.
- Review burden reduced by at least 15% compared to untuned baseline.

### Interruption and recovery test cases
- Tuned parameter configuration is versioned and reproducible.
- Reverting tuning configuration restores baseline behavior exactly.

### Security and isolation test cases
- Tuned regex rules checked against ReDoS with maximum input lengths.
- Zero hardcoded customer specific values in regex dictionaries.

## Dependencies

### Upstream prerequisites
- Stage 10 (Correct extraction defects): Base field extractor.
- Stage 31 (Evidence-driven extra passes): Multi-pass extraction.
- Stage 36 (Reproducible quality benchmark): Benchmark pipeline.

### Downstream consumers
- Stage 38 (Full workflow and test-effectiveness checks): Validates tuned system in E2E tests.
- Stage 42 (Frozen independent evaluation/pilot): Evaluates frozen tuned system on held-out split.

## External gates

- **External blocker:** None
- **Automated local test harness:** Automated test asserting dev accuracy improvement and held-out file immutability
- **Owner sign-off item:** None

## Risks and known defects

- Risk 1: Overfitting to development corpus peculiarities.
- Known defect 1: Extraction thresholds currently use hardcoded arbitrary constant (0.6).

## Completion draft (S0–S8)

### S0 Reconcile
- Audit baseline benchmark error breakdown from Stage 36. (DRAFT — NOT EVIDENCED)

### S1 Plan
- Draft parameter tuning plan focusing on top 5 error categories. (DRAFT — NOT EVIDENCED)

### S2 Build
- Tune regexes, image filters, `thresholdConfig.ts`, re-run benchmark, and write tests. (DRAFT — NOT EVIDENCED)

### S3 Gate
- Execute tuning regression test suite via `npm test`. (DRAFT — NOT EVIDENCED)

### S4 Independent review
- Independent review verifies zero contamination of held-out evaluation corpus. (DRAFT — NOT EVIDENCED)

### S5 Correction
- Freeze tuned parameters. (DRAFT — NOT EVIDENCED)

### S6 Stage-exit checklist
- Stage-exit checklist verification. (DRAFT — NOT EVIDENCED)

### S7 Record and promote
- Record promotion evidence. (DRAFT — NOT EVIDENCED)

### S8 Advance
- Advance to Stage 38. (DRAFT — NOT EVIDENCED)


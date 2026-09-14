---
stage: 42
slug: frozen-independent-evaluation-pilot
title: Frozen independent evaluation/pilot
status: not-started
depends_on: [8,36,37]
blocks: [43,55]
weight_area: extraction-validation
external_gates: ["independent-evaluator-signoff"]
charter_lines: "168-169"
gate_quote_sha256: "8bb8ab32381561c34973a85a70fe8dc8dd09278362d4ac8bc62ace4b54311b1d"
evidence_dir: automation/runs/stage-42
last_reconciled: 2026-09-13
---

# Stage 42 — Frozen independent evaluation/pilot



## Charter gate (verbatim)

> Freeze code/models/contracts/config and test unfamiliar held-out documents with authorized representative users. Gate: scope/quality/review-effort gates pass with disclosed limitations; changes receive independent revalidation.

## Verified current state

- Stage 3 (Architecture and failure model) established: Established component topology (Express server, transactional SQLite, Python OCR worker) and formal failure state machine with bounded worker lease reclaims and non-ephemeral job transitions (types: JobStatus (`docs/stage3/authoritative-contracts.md:15`), FailureTransition (`docs/stage3/authoritative-contracts.md:42`), ComponentTopology (`docs/stage3/component-topology.md:1`)).
- Stage 4 (Truthful demonstration/live separation) established: Isolated simulated demo routes and mock fixtures behind explicit environment flags (DEMO_MODE=false), ensuring live OCR pipelines operate against real extractors (types: ServiceAvailabilityResponse (`src/types.ts:177`), DemoIsolationConfig (`server/routes/demoGuard.ts:1`), LivePipelineGuard (`server/routes/demoGuard.ts:1`)).
- Stage 5 (Reproducible dependencies) established: Pinned Node.js, Python 3.10+, and native OCR runtime dependencies in lockfiles with reproducible local build environments (types: PinnedDependency (`src/types.ts:185`), RuntimeDependencyManifest (`package.json:1`), FieldCategory (`src/types.ts:6`)).
- Stage 6 (Build and startup corrections) established: Guaranteed clean headless application startup with health probes and zero-downtime hot reloading (types: ServerLifecycleConfig (`src/types.ts:223`), HealthCheckResponse (`server/health.ts:1`), StartupProbeConfig (`server/health.ts:1`)).
- Stage 7 (Trustworthy automated checks) established: Established trustworthy automated testing harness with fast feedback loops, flake detection, and concurrent gate verification (types: TestSuiteResult (`docs/stages/stage-07-trustworthy-automated-checks.md:1`), GateVerificationResult (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`), TestHarnessConfig (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`)).
- `PROJECT_CHARTER.md:168-169`: Freeze code/models/contracts/config and test unfamiliar held-out documents with authorized representative users. Scope/quality/review-effort gates pass with disclosed limitations; changes receive independent revalidation.
- Unaccessed held-out corpus: Stage 8 created a held-out split that has remained strictly untouched throughout tuning.
- Frozen code state: Code, regex dictionaries, and model configs must be frozen with cryptographic commit SHA before evaluation.
- Independent validation: Evaluation requires blind execution over held-out data to verify real-world generalization.

## Scope

### In scope
- Code freeze: compute SHA-256 digest of all model weights, regex definitions, and extraction code.
- Unblinded evaluation on 100% held-out test split (from Stage 8).
- Verification of charter quality gates: >= 95% normalized match on required fields, >= 99% precision on critical identifiers.
- Comprehensive frozen evaluation report with full statistical uncertainty disclosure.

### Out of scope
- Modifying code or regexes to fix errors discovered on held-out split (evaluation only).
- Commercial pilot user onboarding (Stage 43).

### Explicitly not promised
- 100% accuracy on previously unseen held-out document layouts.

## Work breakdown

1. **Task 1: Code and Model Configuration Freeze**
   - Description: Record cryptographic hash manifest of all extraction rules, models, and code.
   - Owned paths: `docs/stage42/freeze-manifest.json`
   - Target acceptance fact: Fact 1: Code and model configuration frozen with cryptographic manifest

2. **Task 2: Held-Out Evaluation Benchmark Execution**
   - Description: Execute benchmark script exclusively over held-out corpus split without human intervention.
   - Owned paths: `scripts/benchmark/run-heldout-eval.mjs`
   - Target acceptance fact: Fact 2: Held-out evaluation executed over unseen test split

3. **Task 3: Frozen Evaluation Scorecard and Gap Analysis**
   - Description: Document final precision, recall, F1, and review burden with Wilson 95% confidence intervals.
   - Owned paths: `docs/stage42/heldout-evaluation-report.md`
   - Target acceptance fact: Fact 3: Evaluation report discloses measured generalization metrics

4. **Task 4: Frozen Evaluation Integrity and Manifest Test Suite**
   - Description: Author automated tests validating freeze manifest hashes and asserting non-modification of test set.
   - Owned paths: `tests/stage42Evaluation.test.mjs`
   - Target acceptance fact: Fact 4: Frozen evaluation integrity test suite passes

## Contracts to freeze

```typescript
export interface FrozenEvaluationScorecard {
  freezeCommitSha: string;
  evaluatedAt: string;
  heldOutDocumentCount: number;
  requiredFieldAccuracy: number; // target >= 0.95
  criticalIdentifierPrecision: number; // target >= 0.99
  overallReviewBurden: number;
  qualityGateMet: boolean;
  disclosedLimitations: string[];
}
```

## Fan-out plan

- **Archetype:** Archetype B (Frozen Evaluation and Quality Assessment)
- **Lanes:**
  | Lane | Role | Mode | Owned paths | Deliverable |
  |---|---|---|---|---|
  | Lane 1 | impl-lane | CODE | `docs/stage42/**` | Freeze manifest and evaluation scorecard |
  | Lane 2 | impl-lane | CODE | `scripts/benchmark/run-heldout-eval.mjs` | Held-out evaluation runner |
  | Lane 3 | test-author | CODE | `tests/stage42Evaluation.test.mjs` | Freeze integrity test suite |
- **Shared files:** None

## Acceptance evidence

| Fact | Proving command/artifact | Expected outcome | Status | Evidence path |
|---|---|---|---|---|
| Fact 1: Code and model configuration frozen with cryptographic manifest | `node -e "assert(fs.existsSync('docs/stage42/freeze-manifest.json'))"` | Manifest records SHA-256 for all extraction files | pending | `automation/runs/stage-42/manifest-audit.json` |
| Fact 2: Held-out evaluation executed over unseen test split | `node -e "assert(fs.existsSync('scripts/benchmark/run-heldout-eval.mjs'))"` | Evaluation script executes benchmark on held-out split | pending | `automation/runs/stage-42/eval-run-audit.json` |
| Fact 3: Evaluation report discloses measured generalization metrics | `node -e "assert(fs.existsSync('docs/stage42/heldout-evaluation-report.md'))"` | Scorecard discloses required field match >= 95% | pending | `automation/runs/stage-42/report-audit.json` |
| Fact 4: Frozen evaluation integrity test suite passes | `node --test tests/stage42Evaluation.test.mjs` | All evaluation integrity tests exit 0 | pending | `automation/runs/stage-42/test-summary.json` |

## Tests

### Negative test cases
- Modifying any extraction file after freeze invalidates freeze manifest checksum.
- Held-out evaluation failing quality gate (<95% required fields) halts promotion.

### Boundary test cases
- Evaluation covers 100% of held-out split documents without skipping.
- Critical identifier precision achieves >= 99% on held-out test data.

### Interruption and recovery test cases
- Held-out evaluation runs unattended to completion without interactive prompts.
- Evaluation results recorded immutably in JSON report.

### Security and isolation test cases
- Zero held-out document content leaked into console logs or public outputs.
- Freeze manifest covers all direct regex dictionary files.

## Dependencies

### Upstream prerequisites
- Stage 8 (Governed evaluation corpus): Provides held-out split.
- Stage 36 (Reproducible quality benchmark): Provides evaluation metrics.
- Stage 37 (Development-only quality improvement): Tuned model to freeze.

### Downstream consumers
- Stage 43 (Evidence-backed pilot gate): Evaluation scorecard submitted to pilot gate.
- Stage 55 (Final 99/100 release decision): Final release decision incorporates scorecard.

## External gates

- **External blocker:** independent-evaluator-signoff (independent third-party reviewer auditing evaluation protocol)
- **Automated local test harness:** Automated evaluation runner (scripts/benchmark/run-heldout-eval.mjs) executing blind over held-out data
- **Owner sign-off item:** Independent evaluator sign-off required for commercial quality certification

## Risks and known defects

- Risk 1: Held-out accuracy dropping below 95% due to unforeseen document layout variations.
- Known defect 1: No frozen evaluation baseline exists in current codebase.

## Completion draft (S0–S8)

### S0 Reconcile
- Audit held-out corpus split immutability and freeze candidate files. (DRAFT — NOT EVIDENCED)

### S1 Plan
- Draft freeze manifest and held-out evaluation runner protocol. (DRAFT — NOT EVIDENCED)

### S2 Build
- Author `freeze-manifest.json`, `run-heldout-eval.mjs`, scorecard, and tests. (DRAFT — NOT EVIDENCED)

### S3 Gate
- Execute held-out evaluation suite via `npm test`. (DRAFT — NOT EVIDENCED)

### S4 Independent review
- Independent review audits zero-leakage protocol and confidence intervals. (DRAFT — NOT EVIDENCED)

### S5 Correction
- Compile final evaluation scorecard. (DRAFT — NOT EVIDENCED)

### S6 Stage-exit checklist
- Stage-exit checklist verification. (DRAFT — NOT EVIDENCED)

### S7 Record and promote
- Record promotion evidence. (DRAFT — NOT EVIDENCED)

### S8 Advance
- Advance to Stage 43. (DRAFT — NOT EVIDENCED)


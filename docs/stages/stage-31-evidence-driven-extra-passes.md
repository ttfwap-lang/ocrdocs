---
stage: 31
slug: evidence-driven-extra-passes
title: Evidence-driven extra passes
status: not-started
depends_on: [18,27]
blocks: [36,37]
weight_area: extraction-validation
external_gates: []
charter_lines: "135-136"
gate_quote_sha256: "007aad35362f50acb7d4dc44963a128bec05e621057b7189c78acb53c3167f26"
evidence_dir: automation/runs/stage-31
last_reconciled: 2026-09-13
---

# Stage 31 — Evidence-driven extra passes



## Charter gate (verbatim)

> Implement eligibility/budgets/stopping, immutable pass history and reviewed-value protection. Gate: labelled benefits and regressions are measured; more populated fields or higher heuristic confidence is not called monotonic accuracy.

## Verified current state

- Stage 3 (Architecture and failure model) established: Established component topology (Express server, transactional SQLite, Python OCR worker) and formal failure state machine with bounded worker lease reclaims and non-ephemeral job transitions (types: JobStatus (`docs/stage3/authoritative-contracts.md:15`), FailureTransition (`docs/stage3/authoritative-contracts.md:42`), ComponentTopology (`docs/stage3/component-topology.md:1`)).
- Stage 4 (Truthful demonstration/live separation) established: Isolated simulated demo routes and mock fixtures behind explicit environment flags (DEMO_MODE=false), ensuring live OCR pipelines operate against real extractors (types: ServiceAvailabilityResponse (`src/types.ts:177`), DemoIsolationConfig (`server/routes/demoGuard.ts:1`), LivePipelineGuard (`server/routes/demoGuard.ts:1`)).
- Stage 5 (Reproducible dependencies) established: Pinned Node.js, Python 3.10+, and native OCR runtime dependencies in lockfiles with reproducible local build environments (types: PinnedDependency (`src/types.ts:185`), RuntimeDependencyManifest (`package.json:1`), FieldCategory (`src/types.ts:6`)).
- Stage 6 (Build and startup corrections) established: Guaranteed clean headless application startup with health probes and zero-downtime hot reloading (types: ServerLifecycleConfig (`src/types.ts:223`), HealthCheckResponse (`server/health.ts:1`), StartupProbeConfig (`server/health.ts:1`)).
- Stage 7 (Trustworthy automated checks) established: Established trustworthy automated testing harness with fast feedback loops, flake detection, and concurrent gate verification (types: TestSuiteResult (`docs/stages/stage-07-trustworthy-automated-checks.md:1`), GateVerificationResult (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`), TestHarnessConfig (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`)).
- `PROJECT_CHARTER.md:135-136`: Implement eligibility/budgets/stopping, immutable pass history, and reviewed-value protection. Labelled benefits and regressions are measured; higher heuristic confidence is not called monotonic accuracy.
- `server/services/multipassOcr.ts:1-120`: Simulates multi-pass OCR by returning static text with fake confidence boosts.
- Heuristic confidence fallacy: Boosting confidence numbers artificially without measuring ground-truth accuracy.
- Missing stopping criteria: No budget bounds secondary OCR passes when primary pass confidence is already sufficient.

## Scope

### In scope
- Evidence-driven multi-pass OCR orchestrator: triggers secondary pass only when targeted high-value fields have low confidence (<0.7).
- Strict computational budget: maximum 1 extra pass per page; maximum 30s additional processing time.
- Immutable pass history: persist raw text and candidates for both Pass 1 and Pass 2.
- Regression prevention: Pass 2 results cannot overwrite human-approved fields or degrade high-confidence Pass 1 matches.

### Out of scope
- Invoking expensive cloud vision APIs without configured API credentials (Stage 4).
- Training custom deep learning OCR models.

### Explicitly not promised
- Guaranteed improvement on every secondary pass (some passes yield identical text).

## Work breakdown

1. **Task 1: Multi-Pass Eligibility and Budget Evaluator**
   - Description: Implement eligibility rules deciding whether a document qualifies for secondary OCR pass.
   - Owned paths: `server/ocr/passEligibility.ts`
   - Target acceptance fact: Fact 1: Multi-pass eligibility evaluates confidence thresholds and budgets

2. **Task 2: Secondary Pass Execution and Fusion Engine**
   - Description: Execute secondary preprocessing (contrast enhancement / thresholding) and fuse candidate results.
   - Owned paths: `server/ocr/passFusion.ts`
   - Target acceptance fact: Fact 2: Pass fusion merges candidate matches with provenance

3. **Task 3: Replace Simulated Multipass with Real Fusion**
   - Description: Refactor server/services/multipassOcr.ts to invoke real local secondary pass without fake timers.
   - Owned paths: `server/services/multipassOcr.ts`
   - Target acceptance fact: Fact 3: Simulated passes removed from multipass service

4. **Task 4: Multi-Pass Evaluation and Regression Test Suite**
   - Description: Author tests measuring field extraction improvement and asserting reviewed values are protected.
   - Owned paths: `tests/stage31Multipass.test.mjs`
   - Target acceptance fact: Fact 4: Multi-pass evaluation test suite passes

## Contracts to freeze

```typescript
export interface MultiPassResult {
  passNumber: 1 | 2;
  engine: string;
  preprocessingApplied: string[];
  fieldsExtracted: number;
  durationMs: number;
  candidateDiffs: Array<{ fieldId: string; pass1Val: string; pass2Val: string; selectedVal: string }>;
}
```

## Fan-out plan

- **Archetype:** Archetype D (OCR Pass Refactoring and Fusion)
- **Lanes:**
  | Lane | Role | Mode | Owned paths | Deliverable |
  |---|---|---|---|---|
  | Lane 1 | impl-lane | CODE | `server/ocr/passEligibility.ts,server/ocr/passFusion.ts` | Eligibility rules and candidate fusion |
  | Lane 2 | impl-lane | CODE | `server/services/multipassOcr.ts` | Multipass service refactoring |
  | Lane 3 | test-author | CODE | `tests/stage31Multipass.test.mjs` | Multi-pass regression test suite |
- **Shared files:** server/services/multipassOcr.ts

## Acceptance evidence

| Fact | Proving command/artifact | Expected outcome | Status | Evidence path |
|---|---|---|---|---|
| Fact 1: Multi-pass eligibility evaluates confidence thresholds and budgets | `node -e "assert(fs.existsSync('server/ocr/passEligibility.ts'))"` | Eligibility evaluator skips secondary pass if confidence >= 0.8 | pending | `automation/runs/stage-31/eligibility-audit.json` |
| Fact 2: Pass fusion merges candidate matches with provenance | `node -e "assert(fs.existsSync('server/ocr/passFusion.ts'))"` | Fusion engine compares Pass 1 and Pass 2 candidates | pending | `automation/runs/stage-31/fusion-audit.json` |
| Fact 3: Simulated passes removed from multipass service | `node -e "assert(!fs.readFileSync('server/services/multipassOcr.ts', 'utf8').includes('// SIMULATED'))"` | Multipass service uses real local preprocessing and OCR | pending | `automation/runs/stage-31/real-multipass.json` |
| Fact 4: Multi-pass evaluation test suite passes | `node --test tests/stage31Multipass.test.mjs` | All multi-pass tests exit 0 | pending | `automation/runs/stage-31/test-summary.json` |

## Tests

### Negative test cases
- Document with all fields above confidence threshold skips Pass 2 to preserve CPU.
- Secondary pass failing or timing out does not discard valid Pass 1 results.

### Boundary test cases
- Budget ceiling: maximum 1 secondary pass executed even if confidence remains low.
- Processing duration bound: Pass 2 terminated if exceeding 30s.

### Interruption and recovery test cases
- Abrupt termination during Pass 2 leaves Pass 1 result in database as fallback.
- Human-approved values strictly preserved regardless of Pass 2 findings.

### Security and isolation test cases
- Pass 2 image enhancement does not leak intermediate raster frames outside temporary sandbox.
- Both passes maintain full cryptographic audit logs.

## Dependencies

### Upstream prerequisites
- Stage 18 (Real qualified OCR): Executes base OCR engine.
- Stage 27 (Controlled human review): Protects human-reviewed values.

### Downstream consumers
- Stage 36 (Reproducible quality benchmark): Evaluates accuracy impact of secondary passes.
- Stage 37 (Development-only quality improvement): Tunes multi-pass thresholds.

## External gates

- **External blocker:** None
- **Automated local test harness:** Automated test suite comparing Pass 1 vs Pass 2 extractions on degraded image fixtures
- **Owner sign-off item:** None

## Risks and known defects

- Risk 1: Secondary passes doubling document processing latency.
- Known defect 1: `multipassOcr.ts:35` returns canned string with fake confidence.

## Completion draft (S0–S8)

### S0 Reconcile
- Audit multipassOcr.ts and remove static mock methods. (DRAFT — NOT EVIDENCED)

### S1 Plan
- Draft multi-pass eligibility rules and candidate fusion logic. (DRAFT — NOT EVIDENCED)

### S2 Build
- Author `passEligibility.ts`, `passFusion.ts`, refactor service, and write tests. (DRAFT — NOT EVIDENCED)

### S3 Gate
- Execute multi-pass test suite via `npm test`. (DRAFT — NOT EVIDENCED)

### S4 Independent review
- Independent review audits regression prevention and budget enforcement. (DRAFT — NOT EVIDENCED)

### S5 Correction
- Tune confidence threshold parameters. (DRAFT — NOT EVIDENCED)

### S6 Stage-exit checklist
- Stage-exit checklist verification. (DRAFT — NOT EVIDENCED)

### S7 Record and promote
- Record promotion evidence. (DRAFT — NOT EVIDENCED)

### S8 Advance
- Advance to Stage 32. (DRAFT — NOT EVIDENCED)


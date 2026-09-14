---
stage: 9
slug: extraction-reproductions-and-boundaries
title: Extraction reproductions and boundaries
status: not-started
depends_on: [2,7,8]
blocks: [10]
weight_area: extraction-validation
external_gates: []
charter_lines: "69-70"
gate_quote_sha256: "6058b0f50b83d1f3be41bc0b1710656bf64dc4ae97aa284bbbeece2740be18c3"
evidence_dir: automation/runs/stage-09
last_reconciled: 2026-09-13
---

# Stage 9 — Extraction reproductions and boundaries



## Charter gate (verbatim)

> Test dates/leap days/future dates, leading zeros, repeated anchors, missing/invalid values, currencies and wrong-applicant associations. Gate: known defects fail before fixes, time-dependent checks use a fixed clock, and false extraction is detected.

## Verified current state

- Stage 3 (Architecture and failure model) established: Established component topology (Express server, transactional SQLite, Python OCR worker) and formal failure state machine with bounded worker lease reclaims and non-ephemeral job transitions (types: JobStatus (`docs/stage3/authoritative-contracts.md:15`), FailureTransition (`docs/stage3/authoritative-contracts.md:42`), ComponentTopology (`docs/stage3/component-topology.md:1`)).
- Stage 4 (Truthful demonstration/live separation) established: Isolated simulated demo routes and mock fixtures behind explicit environment flags (DEMO_MODE=false), ensuring live OCR pipelines operate against real extractors (types: ServiceAvailabilityResponse (`src/types.ts:177`), DemoIsolationConfig (`server/routes/demoGuard.ts:1`), LivePipelineGuard (`server/routes/demoGuard.ts:1`)).
- Stage 5 (Reproducible dependencies) established: Pinned Node.js, Python 3.10+, and native OCR runtime dependencies in lockfiles with reproducible local build environments (types: PinnedDependency (`src/types.ts:185`), RuntimeDependencyManifest (`package.json:1`), FieldCategory (`src/types.ts:6`)).
- Stage 6 (Build and startup corrections) established: Guaranteed clean headless application startup with health probes and zero-downtime hot reloading (types: ServerLifecycleConfig (`src/types.ts:223`), HealthCheckResponse (`server/health.ts:1`), StartupProbeConfig (`server/health.ts:1`)).
- Stage 7 (Trustworthy automated checks) established: Established trustworthy automated testing harness with fast feedback loops, flake detection, and concurrent gate verification (types: TestSuiteResult (`docs/stages/stage-07-trustworthy-automated-checks.md:1`), GateVerificationResult (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`), TestHarnessConfig (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`)).
- `src/data/bankFields.ts`: Expanded to 90 application fields and 9 identifiers (99 total).
- `src/utils/ocrMatcherEngine.ts:1-200`: Matcher iterates regexes over text but lacks boundary test cases for leap days, future dates, leading zeros, or wrong applicant association.
- Known extraction defects: Date parser converts ambiguous dates (e.g. 01/02/2024) inconsistently depending on system locale.
- Fixed clock: No mock time provider exists in matcher utility to test time-dependent validation.

## Scope

### In scope
- Reproduction test suite capturing known extraction defects: leap years, future dates, BSB leading zeros.
- Wrong-applicant association test cases (primary applicant income mapped to secondary applicant).
- Injectable fixed clock provider for deterministic date testing.
- Failing-before-fix discipline: all reproductions must fail against current code before fixes in Stage 10.

### Out of scope
- Fixing the extraction logic (handled in Stage 10).
- Modifying the bank field catalogue definitions (landed in Step 1).

### Explicitly not promised
- Guaranteed extraction from illegible handwriting or blurred stamps.

## Work breakdown

1. **Task 1: Date and Leap Year Boundary Reproduction Tests**
   - Description: Author tests demonstrating failures on Feb 29 leap years, future dates, and Australian DD/MM/YYYY vs US MM/DD/YYYY.
   - Owned paths: `tests/reproductions/dateBoundaries.test.mjs`
   - Target acceptance fact: Fact 1: Date and leap year edge cases reproduced
   - Downstream integration: incorporates Stage 7 (Trustworthy automated checks) established contracts and patterns.

2. **Task 2: Leading Zero and Numeric Preservation Tests**
   - Description: Author tests demonstrating truncation of leading zeros in BSB (e.g. 062-000) and account numbers.
   - Owned paths: `tests/reproductions/numericPreservation.test.mjs`
   - Target acceptance fact: Fact 2: Leading zero truncation defect reproduced

3. **Task 3: Applicant Association and Repeated Anchor Tests**
   - Description: Author tests for joint application documents where primary and secondary applicant fields collide.
   - Owned paths: `tests/reproductions/applicantCollision.test.mjs`
   - Target acceptance fact: Fact 3: Applicant association collision reproduced

4. **Task 4: Fixed Clock Provider Implementation**
   - Description: Implement injectable time service allowing deterministic evaluation of date validity.
   - Owned paths: `src/utils/clockProvider.ts`
   - Target acceptance fact: Fact 4: Injectable clock provider active

## Contracts to freeze

```typescript
// Integrates Stage 7 (Trustworthy automated checks) frozen contracts
export interface ClockProvider {
  now(): Date;
  iso(): string;
  year(): number;
}

export interface ExtractionReproductionCase {
  id: string;
  rawText: string;
  fieldId: string;
  expectedDefect: 'date_locale_swap' | 'leading_zero_dropped' | 'wrong_applicant' | 'currency_symbol_swallowed';
  observedFailure: string;
}
```

## Fan-out plan

- **Archetype:** Archetype B (Reproduction Test Authoring)
- **Lanes:**
  | Lane | Role | Mode | Owned paths | Deliverable |
  |---|---|---|---|---|
  | Lane 1 | impl-lane | CODE | `src/utils/clockProvider.ts` | Injectable clock utility |
  | Lane 2 | test-author | CODE | `tests/reproductions/**` | Reproduction test suites capturing extraction defects |
- **Shared files:** None

## Acceptance evidence

| Fact | Proving command/artifact | Expected outcome | Status | Evidence path |
|---|---|---|---|---|
| Fact 1: Date and leap year edge cases reproduced | `node --test tests/reproductions/dateBoundaries.test.mjs` | Tests run and isolate date boundary failure modes | pending | `automation/runs/stage-09/date-reproduction.json` |
| Fact 2: Leading zero truncation defect reproduced | `node --test tests/reproductions/numericPreservation.test.mjs` | Tests isolate numeric truncation defects | pending | `automation/runs/stage-09/numeric-reproduction.json` |
| Fact 3: Applicant association collision reproduced | `node --test tests/reproductions/applicantCollision.test.mjs` | Tests isolate multi-applicant field collision | pending | `automation/runs/stage-09/applicant-reproduction.json` |
| Fact 4: Injectable clock provider active | `node -e "assert(fs.existsSync('src/utils/clockProvider.ts'))"` | ClockProvider exported and verified | pending | `automation/runs/stage-09/clock-audit.json` |

## Tests

### Negative test cases
- Invalid calendar dates (e.g. 2023-02-29 or 2024-04-31) fail date validation.
- Document dates in the future (relative to fixed clock) flagged as invalid.

### Boundary test cases
- Feb 29 on leap year (2024) accepted; Feb 29 on non-leap year (2023) rejected.
- BSBs with leading zero ("012-345") retain the zero in extracted canonical value.

### Interruption and recovery test cases
- Clock provider override can be set and reset safely between tests.
- Reproduction tests execute deterministically regardless of host system timezone.

### Security and isolation test cases
- Regex patterns tested against ReDoS with 10,000 character hostile inputs.
- Malformed dates cannot cause infinite parser loops.

## Dependencies

### Upstream prerequisites
- Stage 2 (Document/workflow matrix): Uses matrix definitions for supported formats and applicant roles.
- Stage 7 (Trustworthy automated checks) [PROMOTED]: Uses test harness for running reproductions.

### Downstream consumers
- Stage 10 (Correct extraction defects): Fixes the defects captured by these reproductions.

## External gates

- **External blocker:** None
- **Automated local test harness:** Automated reproduction suite with mock text fixtures
- **Owner sign-off item:** None

## Risks and known defects

- Risk 1: Host system timezone settings altering date parsing behavior.
- Known defect 1: `src/utils/ocrMatcherEngine.ts` parses dates using native `new Date()` without locale normalization.

## Completion draft (S0–S8)

### S0 Reconcile
- Audit ocrMatcherEngine.ts for date and numeric extraction pitfalls. (DRAFT — NOT EVIDENCED)

### S1 Plan
- Draft reproduction test suite specifications and clock provider. (DRAFT — NOT EVIDENCED)

### S2 Build
- Author `clockProvider.ts` and `tests/reproductions/`. (DRAFT — NOT EVIDENCED)

### S3 Gate
- Execute reproduction tests confirming known defects are isolated. (DRAFT — NOT EVIDENCED)

### S4 Independent review
- Independent review verifies that tests are genuine failing reproductions. (DRAFT — NOT EVIDENCED)

### S5 Correction
- Refine test assertions. (DRAFT — NOT EVIDENCED)

### S6 Stage-exit checklist
- Stage-exit checklist verification. (DRAFT — NOT EVIDENCED)

### S7 Record and promote
- Record promotion evidence. (DRAFT — NOT EVIDENCED)

### S8 Advance
- Advance to Stage 10. (DRAFT — NOT EVIDENCED)


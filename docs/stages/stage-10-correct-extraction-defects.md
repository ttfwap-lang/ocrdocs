---
stage: 10
slug: correct-extraction-defects
title: Correct extraction defects
status: not-started
depends_on: [9]
blocks: [11,20,37]
weight_area: extraction-validation
external_gates: []
charter_lines: "72-73"
gate_quote_sha256: "52920dbeeb1886af4bbbf19843fc84e40fa85c65dcb7b113044c68ac8375bf05"
evidence_dir: automation/runs/stage-10
last_reconciled: 2026-09-13
---

# Stage 10 — Correct extraction defects



## Charter gate (verbatim)

> Fix reproduced capture/indexing and normalization errors and masked failures. Gate: reproductions and all affected downstream tests pass without weakening checks or presenting format validation as authoritative identity verification.

## Verified current state

- Stage 3 (Architecture and failure model) established: Established component topology (Express server, transactional SQLite, Python OCR worker) and formal failure state machine with bounded worker lease reclaims and non-ephemeral job transitions (types: JobStatus (`docs/stage3/authoritative-contracts.md:15`), FailureTransition (`docs/stage3/authoritative-contracts.md:42`), ComponentTopology (`docs/stage3/component-topology.md:1`)).
- Stage 4 (Truthful demonstration/live separation) established: Isolated simulated demo routes and mock fixtures behind explicit environment flags (DEMO_MODE=false), ensuring live OCR pipelines operate against real extractors (types: ServiceAvailabilityResponse (`src/types.ts:177`), DemoIsolationConfig (`server/routes/demoGuard.ts:1`), LivePipelineGuard (`server/routes/demoGuard.ts:1`)).
- Stage 5 (Reproducible dependencies) established: Pinned Node.js, Python 3.10+, and native OCR runtime dependencies in lockfiles with reproducible local build environments (types: PinnedDependency (`src/types.ts:185`), RuntimeDependencyManifest (`package.json:1`), FieldCategory (`src/types.ts:6`)).
- Stage 6 (Build and startup corrections) established: Guaranteed clean headless application startup with health probes and zero-downtime hot reloading (types: ServerLifecycleConfig (`src/types.ts:223`), HealthCheckResponse (`server/health.ts:1`), StartupProbeConfig (`server/health.ts:1`)).
- Stage 7 (Trustworthy automated checks) established: Established trustworthy automated testing harness with fast feedback loops, flake detection, and concurrent gate verification (types: TestSuiteResult (`docs/stages/stage-07-trustworthy-automated-checks.md:1`), GateVerificationResult (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`), TestHarnessConfig (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`)).
- `src/utils/ocrMatcherEngine.ts:1-250`: Core regex extraction engine; currently lacks normalization for Australian date layouts and BSB padding.
- `src/utils/australianValidationUtility.ts:1-180`: Validates ABN, BSB, TFN, but lacks integration with multi-pass candidate scoring.
- Reproduction suite from Stage 9: Identifies leap year, leading zero, and applicant collision defects requiring fix.
- Format validation must not be presented as authoritative identity verification.

## Scope

### In scope
- Fix date parsing to strictly enforce DD/MM/YYYY precedence for Australian documents with leap year support.
- Preserve leading zeros in BSB, account number, and CRN extractions.
- Implement applicant-scoped context anchors preventing field collisions in joint applications.
- Ensure all Stage 9 reproductions pass without weakening any existing validation checks.

### Out of scope
- Complete rewrite of regex definitions (99 definitions established in Step 1).
- External identity verification service integration (prohibited by charter scope).

### Explicitly not promised
- Automated legal identity verification based purely on document text checksums.

## Work breakdown

1. **Task 1: Strict Australian Date Normalization Engine**
   - Description: Implement deterministic date parser handling DD/MM/YYYY, leap years, and fixed clock validation.
   - Owned paths: `src/utils/dateNormalizer.ts`
   - Target acceptance fact: Fact 1: Date normalizer handles Australian layouts and leap years

2. **Task 2: Numeric and Identifier Zero-Preservation**
   - Description: Update matcher engine to preserve string formatting with leading zeros for BSB and account numbers.
   - Owned paths: `src/utils/ocrMatcherEngine.ts`
   - Target acceptance fact: Fact 2: Matcher engine preserves leading zeros in identifiers

3. **Task 3: Multi-Applicant Scope Filtering**
   - Description: Implement windowed bounding-box/paragraph proximity scoping for primary vs secondary applicants.
   - Owned paths: `src/utils/applicantScoper.ts`
   - Target acceptance fact: Fact 3: Applicant scoping prevents joint applicant field cross-contamination

4. **Task 4: Reproduction Suite Resolution Verification**
   - Description: Run Stage 9 reproduction tests to confirm 100% pass rate without regression.
   - Owned paths: `tests/stage10ExtractionFixes.test.mjs`
   - Target acceptance fact: Fact 4: All extraction defect reproductions pass

## Contracts to freeze

```typescript
export interface NormalizedExtractionResult {
  fieldId: string;
  rawValue: string;
  canonicalValue: string;
  applicantIndex: number;
  confidence: number;
  validationStatus: 'valid' | 'invalid_format' | 'unverified_identity';
  validationMessage?: string;
}
```

## Fan-out plan

- **Archetype:** Archetype D (Extraction Engine Bug Fixes)
- **Lanes:**
  | Lane | Role | Mode | Owned paths | Deliverable |
  |---|---|---|---|---|
  | Lane 1 | impl-lane | CODE | `src/utils/dateNormalizer.ts,src/utils/applicantScoper.ts` | Date and applicant normalizer utilities |
  | Lane 2 | impl-lane | CODE | `src/utils/ocrMatcherEngine.ts` | Matcher engine zero-preservation and integration |
  | Lane 3 | test-author | CODE | `tests/stage10ExtractionFixes.test.mjs` | Regression verification test suite |
- **Shared files:** src/utils/ocrMatcherEngine.ts

## Acceptance evidence

| Fact | Proving command/artifact | Expected outcome | Status | Evidence path |
|---|---|---|---|---|
| Fact 1: Date normalizer handles Australian layouts and leap years | `node --test tests/reproductions/dateBoundaries.test.mjs` | All date reproduction tests pass | pending | `automation/runs/stage-10/date-fix.json` |
| Fact 2: Matcher engine preserves leading zeros in identifiers | `node --test tests/reproductions/numericPreservation.test.mjs` | All numeric preservation tests pass | pending | `automation/runs/stage-10/numeric-fix.json` |
| Fact 3: Applicant scoping prevents joint applicant field cross-contamination | `node --test tests/reproductions/applicantCollision.test.mjs` | All applicant collision tests pass | pending | `automation/runs/stage-10/applicant-fix.json` |
| Fact 4: All extraction defect reproductions pass | `node --test tests/stage10ExtractionFixes.test.mjs` | Comprehensive extraction test suite exits 0 | pending | `automation/runs/stage-10/test-summary.json` |

## Tests

### Negative test cases
- Invalid BSB checksum or length (<6 digits) produces invalid_format status.
- Invalid Medicare checksum produces validation failure.

### Boundary test cases
- Date on December 31 and January 1 parses correctly across year boundaries.
- Currency values with trailing cents ($1,250.00) normalized to 1250.00 without loss.

### Interruption and recovery test cases
- Large text payload (>1MB) normalizes within 100ms without memory spike.
- Repeated normalization of identical string is strictly idempotent.

### Security and isolation test cases
- Zero evaluation of extracted text through eval() or dynamic Function().
- HTML tags and script injections inside extracted text escaped during normalization.

## Dependencies

### Upstream prerequisites
- Stage 9 (Extraction reproductions and boundaries): Defect reproductions serve as pass criteria.

### Downstream consumers
- Stage 11 (Versioned result contracts): Adopts normalized extraction result schema.
- Stage 20 (Integrated vertical slice): Integrates corrected extraction engine into end-to-end slice.
- Stage 37 (Development-only quality improvement): Builds upon stable extraction engine.

## External gates

- **External blocker:** None
- **Automated local test harness:** Automated unit tests validating normalization against synthetic test strings
- **Owner sign-off item:** None

## Risks and known defects

- Risk 1: Australian vs US date ambiguity for days 1–12 (requires strict Australian DD/MM default).
- Known defect 1: `ocrMatcherEngine.ts:98` strips leading zeros when parsing integer fields.

## Completion draft (S0–S8)

### S0 Reconcile
- Re-run Stage 9 reproductions to verify baseline failures. (DRAFT — NOT EVIDENCED)

### S1 Plan
- Draft normalization and applicant scoping algorithms. (DRAFT — NOT EVIDENCED)

### S2 Build
- Implement `dateNormalizer.ts`, `applicantScoper.ts`, and update `ocrMatcherEngine.ts`. (DRAFT — NOT EVIDENCED)

### S3 Gate
- Execute Stage 9 and Stage 10 test suites. (DRAFT — NOT EVIDENCED)

### S4 Independent review
- Independent review verifies no checks were weakened. (DRAFT — NOT EVIDENCED)

### S5 Correction
- Refine boundary normalization edge cases. (DRAFT — NOT EVIDENCED)

### S6 Stage-exit checklist
- Stage-exit checklist verification. (DRAFT — NOT EVIDENCED)

### S7 Record and promote
- Record promotion evidence. (DRAFT — NOT EVIDENCED)

### S8 Advance
- Advance to Stage 11. (DRAFT — NOT EVIDENCED)


---
stage: 11
slug: versioned-result-contracts
title: Versioned result contracts
status: not-started
depends_on: [2,3,10]
blocks: [12,17,21]
weight_area: extraction-validation
external_gates: []
charter_lines: "75-76"
gate_quote_sha256: "7e89ff1cc5bf028e3bf24e27e0ccdeff49d79c8176eae5bed9b0fd436a45a2cc"
evidence_dir: automation/runs/stage-11
last_reconciled: 2026-09-13
---

# Stage 11 — Versioned result contracts



## Charter gate (verbatim)

> Define and validate request/results, document/applicant/version identity, evidence, raw/canonical values, confidence origin, review states and errors. Gate: invalid limits/states/contracts are rejected and every component agrees on meaning.

## Verified current state

- Stage 3 (Architecture and failure model) established: Established component topology (Express server, transactional SQLite, Python OCR worker) and formal failure state machine with bounded worker lease reclaims and non-ephemeral job transitions (types: JobStatus (`docs/stage3/authoritative-contracts.md:15`), FailureTransition (`docs/stage3/authoritative-contracts.md:42`), ComponentTopology (`docs/stage3/component-topology.md:1`)).
- Stage 4 (Truthful demonstration/live separation) established: Isolated simulated demo routes and mock fixtures behind explicit environment flags (DEMO_MODE=false), ensuring live OCR pipelines operate against real extractors (types: ServiceAvailabilityResponse (`src/types.ts:177`), DemoIsolationConfig (`server/routes/demoGuard.ts:1`), LivePipelineGuard (`server/routes/demoGuard.ts:1`)).
- Stage 5 (Reproducible dependencies) established: Pinned Node.js, Python 3.10+, and native OCR runtime dependencies in lockfiles with reproducible local build environments (types: PinnedDependency (`src/types.ts:185`), RuntimeDependencyManifest (`package.json:1`), FieldCategory (`src/types.ts:6`)).
- Stage 6 (Build and startup corrections) established: Guaranteed clean headless application startup with health probes and zero-downtime hot reloading (types: ServerLifecycleConfig (`src/types.ts:223`), HealthCheckResponse (`server/health.ts:1`), StartupProbeConfig (`server/health.ts:1`)).
- Stage 7 (Trustworthy automated checks) established: Established trustworthy automated testing harness with fast feedback loops, flake detection, and concurrent gate verification (types: TestSuiteResult (`docs/stages/stage-07-trustworthy-automated-checks.md:1`), GateVerificationResult (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`), TestHarnessConfig (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`)).
- `src/types.ts:1-120`: Defines UI and matcher types, but lacks formal versioned schemas for API requests and extraction results.
- Absence of JSON Schema / Zod contracts: Endpoints in `server.ts` consume and produce loosely-typed JSON payloads.
- Result provenance missing: No standardized contract tracks raw versus canonical values, candidate alternatives, or review status.
- Error shapes inconsistent: Different routes return `{ error: string }`, `{ message: string }`, or plain text.

## Scope

### In scope
- Formal versioned JSON schemas (v1) for document processing requests, extraction results, and errors.
- Standardized Result Contract including documentId, version, applicantIndex, rawValue, canonicalValue, confidence, bbox, and reviewState.
- Unified structured API error contract with machine-readable error codes.
- Automated contract validation middleware rejecting malformed payloads.

### Out of scope
- Database table creation for result persistence (Stage 12).
- GraphQL API schemas (REST only per project charter).

### Explicitly not promised
- Backwards compatibility for unversioned legacy prototype payloads.

## Work breakdown

1. **Task 1: Versioned Result Contract Schema Definition**
   - Description: Define comprehensive Zod and JSON schemas for document processing results and candidates.
   - Owned paths: `src/contracts/resultContractV1.ts`
   - Target acceptance fact: Fact 1: Versioned result contract v1 defined and frozen
   - Downstream integration: incorporates Stage 3 (Architecture and failure model) established contracts and patterns.

2. **Task 2: Standardized API Error Shape Contract**
   - Description: Define unified error response contract with error code taxonomy and parameter details.
   - Owned paths: `src/contracts/errorContract.ts`
   - Target acceptance fact: Fact 2: Unified error contract standardized

3. **Task 3: Request Payload Validation Middleware**
   - Description: Implement Express middleware validating incoming payloads against versioned schemas.
   - Owned paths: `server/middleware/validateContract.ts`
   - Target acceptance fact: Fact 3: Contract validation middleware enforces schema

4. **Task 4: Contract Conformance Test Suite**
   - Description: Author automated tests verifying sample extraction results against v1 schema.
   - Owned paths: `tests/stage11Contracts.test.mjs`
   - Target acceptance fact: Fact 4: Contract conformance verified by tests

## Contracts to freeze

```typescript
// Integrates Stage 3 (Architecture and failure model) frozen contracts
export interface ExtractedFieldV1 {
  fieldId: string;
  fieldNumber: number;
  category: string;
  rawValue: string;
  canonicalValue: string;
  confidence: number;
  pageIndex: number;
  bbox?: [number, number, number, number];
  reviewState: 'unreviewed' | 'approved' | 'modified' | 'rejected';
  rejectionReason?: string;
}

export interface ProcessingResultV1 {
  contractVersion: '1.0.0';
  jobId: string;
  documentId: string;
  documentSha256: string;
  processedAt: string;
  durationMs: number;
  engineVersion: string;
  applicantCount: number;
  fields: ExtractedFieldV1[];
  errors: Array<{ code: string; message: string; fatal: boolean }>;
}
```

## Fan-out plan

- **Archetype:** Archetype B (Contract and Schema Definition)
- **Lanes:**
  | Lane | Role | Mode | Owned paths | Deliverable |
  |---|---|---|---|---|
  | Lane 1 | impl-lane | CODE | `src/contracts/**` | Zod schemas and TypeScript result interfaces |
  | Lane 2 | impl-lane | CODE | `server/middleware/**` | Express schema validation middleware |
  | Lane 3 | test-author | CODE | `tests/stage11Contracts.test.mjs` | Contract validation test suite |
- **Shared files:** None

## Acceptance evidence

| Fact | Proving command/artifact | Expected outcome | Status | Evidence path |
|---|---|---|---|---|
| Fact 1: Versioned result contract v1 defined and frozen | `node -e "assert(fs.existsSync('src/contracts/resultContractV1.ts'))"` | Result contract v1 schema exported and typed | pending | `automation/runs/stage-11/result-contract.json` |
| Fact 2: Unified error contract standardized | `node -e "assert(fs.existsSync('src/contracts/errorContract.ts'))"` | Error contract exports standardized error codes | pending | `automation/runs/stage-11/error-contract.json` |
| Fact 3: Contract validation middleware enforces schema | `node --test tests/stage11Contracts.test.mjs` | Invalid payloads rejected with 400 Bad Request | pending | `automation/runs/stage-11/middleware-audit.json` |
| Fact 4: Contract conformance verified by tests | `node --test tests/stage11Contracts.test.mjs` | All schema validation and error tests pass | pending | `automation/runs/stage-11/test-summary.json` |

## Tests

### Negative test cases
- Payload missing contractVersion field rejected with 400 Bad Request.
- Field with confidence outside 0.0–1.0 rejected by schema validator.

### Boundary test cases
- Document with 0 extracted fields validates successfully as empty result.
- Document with 99 extracted fields validates within schema constraints.

### Interruption and recovery test cases
- Schema parsing performance: validating 100 result objects executes in under 20ms.
- Contract serialization and deserialization is lossless.

### Security and isolation test cases
- Schema rejects unexpected additional properties (strict mode) to prevent parameter injection.
- Error contract strips internal database query text and stack traces from client responses.

## Dependencies

### Upstream prerequisites
- Stage 2 (Document/workflow matrix): Provides outcome states and supported formats.
- Stage 3 (Architecture and failure model) [PROMOTED]: Establishes authoritative component boundaries.
- Stage 10 (Correct extraction defects): Normalized result structures formalized here.

### Downstream consumers
- Stage 12 (Transactional application storage): Persists results conforming to this contract.
- Stage 17 (Page-level native extraction/routing): Maps native text output to this contract.
- Stage 21 (Immutable extraction evidence): Stores candidate evidence using these schemas.

## External gates

- **External blocker:** None
- **Automated local test harness:** Automated schema validation test suite using in-memory mock JSON objects
- **Owner sign-off item:** None

## Risks and known defects

- Risk 1: Breaking changes to frontend components if backend payload format shifts abruptly.
- Known defect 1: `server.ts:380` returns raw untyped object from in-memory matcher.

## Completion draft (S0–S8)

### S0 Reconcile
- Audit existing result objects and UI state interfaces. (DRAFT — NOT EVIDENCED)

### S1 Plan
- Draft v1 result contract schema and error code taxonomy. (DRAFT — NOT EVIDENCED)

### S2 Build
- Author `resultContractV1.ts`, `errorContract.ts`, and validation middleware. (DRAFT — NOT EVIDENCED)

### S3 Gate
- Execute contract test suite via `npm test`. (DRAFT — NOT EVIDENCED)

### S4 Independent review
- Independent review verifies contract completeness and boundaries. (DRAFT — NOT EVIDENCED)

### S5 Correction
- Tune schema constraints and error messages. (DRAFT — NOT EVIDENCED)

### S6 Stage-exit checklist
- Stage-exit checklist verification. (DRAFT — NOT EVIDENCED)

### S7 Record and promote
- Record promotion evidence. (DRAFT — NOT EVIDENCED)

### S8 Advance
- Advance to Stage 12. (DRAFT — NOT EVIDENCED)


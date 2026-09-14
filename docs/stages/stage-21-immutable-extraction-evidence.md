---
stage: 21
slug: immutable-extraction-evidence
title: Immutable extraction evidence
status: not-started
depends_on: [11,20]
blocks: [27,36]
weight_area: extraction-validation
external_gates: []
charter_lines: "105-106"
gate_quote_sha256: "7bc27fbf17159fa7a91cb25cebfc3810e80095077b20368a6786d388786b1d3d"
evidence_dir: automation/runs/stage-21
last_reconciled: 2026-09-13
---

# Stage 21 — Immutable extraction evidence



## Charter gate (verbatim)

> Persist attempt evidence, page/text/coordinates where available, model/matcher versions, candidates and selection/normalization reasons. Gate: every displayed field is traceable and historical evidence is not invented or rewritten.

## Verified current state

- Stage 3 (Architecture and failure model) established: Established component topology (Express server, transactional SQLite, Python OCR worker) and formal failure state machine with bounded worker lease reclaims and non-ephemeral job transitions (types: JobStatus (`docs/stage3/authoritative-contracts.md:15`), FailureTransition (`docs/stage3/authoritative-contracts.md:42`), ComponentTopology (`docs/stage3/component-topology.md:1`)).
- Stage 4 (Truthful demonstration/live separation) established: Isolated simulated demo routes and mock fixtures behind explicit environment flags (DEMO_MODE=false), ensuring live OCR pipelines operate against real extractors (types: ServiceAvailabilityResponse (`src/types.ts:177`), DemoIsolationConfig (`server/routes/demoGuard.ts:1`), LivePipelineGuard (`server/routes/demoGuard.ts:1`)).
- Stage 5 (Reproducible dependencies) established: Pinned Node.js, Python 3.10+, and native OCR runtime dependencies in lockfiles with reproducible local build environments (types: PinnedDependency (`src/types.ts:185`), RuntimeDependencyManifest (`package.json:1`), FieldCategory (`src/types.ts:6`)).
- Stage 6 (Build and startup corrections) established: Guaranteed clean headless application startup with health probes and zero-downtime hot reloading (types: ServerLifecycleConfig (`src/types.ts:223`), HealthCheckResponse (`server/health.ts:1`), StartupProbeConfig (`server/health.ts:1`)).
- Stage 7 (Trustworthy automated checks) established: Established trustworthy automated testing harness with fast feedback loops, flake detection, and concurrent gate verification (types: TestSuiteResult (`docs/stages/stage-07-trustworthy-automated-checks.md:1`), GateVerificationResult (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`), TestHarnessConfig (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`)).
- `PROJECT_CHARTER.md:105-106`: Persist attempt evidence, page/text/coordinates where available, model/matcher versions, candidates, and selection reasons. Every displayed field is traceable.
- Existing UI in `MatcherStudio.tsx`: Displays field match badges, but coordinates and candidate provenance are hardcoded or simulated.
- Database candidate storage: Relational schema in Stage 12 includes candidate tables, but ingestion pipeline does not yet write candidate alternatives.
- Immutable evidence: No audit log records the exact regex rule ID or OCR model version that matched each field.

## Scope

### In scope
- Persisting candidate matches with bounding box coordinates `[x0, y0, x1, y1]`, confidence score, and page index.
- Recording match provenance: regex pattern ID, matcher rule version, and OCR engine version.
- Immutability enforcement: candidate evidence rows are write-once and cannot be modified or rewritten.
- API endpoint `GET /api/documents/:id/fields/:fieldId/evidence` returning complete provenance trail.

### Out of scope
- Interactive PDF highlight overlay annotations in browser (Stage 26).
- Human correction override audit log (Stage 27).

### Explicitly not promised
- Pixel-perfect bounding boxes for skewed or distorted photocopies.

## Work breakdown

1. **Task 1: Candidate Evidence Persistence Service**
   - Description: Implement database persistence for all candidate matches, bounding boxes, and selection reasons.
   - Owned paths: `server/services/evidenceService.ts`
   - Target acceptance fact: Fact 1: Evidence service stores candidate coordinates and reasons

2. **Task 2: Evidence Provenance Metadata Model**
   - Description: Bind OCR model version, matcher dictionary version, and rule IDs to each extracted candidate.
   - Owned paths: `src/contracts/evidenceContract.ts`
   - Target acceptance fact: Fact 2: Evidence contract captures engine and rule provenance

3. **Task 3: Field Evidence Query API Endpoint**
   - Description: Implement route returning candidate alternatives, bounding boxes, and extraction provenance.
   - Owned paths: `server/routes/evidenceRoutes.ts`
   - Target acceptance fact: Fact 3: Evidence API returns immutable candidate trace

4. **Task 4: Evidence Immutability Test Suite**
   - Description: Author automated tests verifying that evidence records are immutable and trace back to source text.
   - Owned paths: `tests/stage21Evidence.test.mjs`
   - Target acceptance fact: Fact 4: Evidence immutability and provenance tests pass

## Contracts to freeze

```typescript
export interface FieldCandidateEvidence {
  candidateId: string;
  fieldId: string;
  rawValue: string;
  pageIndex: number;
  bbox?: [number, number, number, number];
  confidence: number;
  matcherRuleId: string;
  ocrEngineVersion: string;
  isSelected: boolean;
  selectionReason: string;
  recordedAt: string;
}
```

## Fan-out plan

- **Archetype:** Archetype B (Evidence Modeling and Immutability)
- **Lanes:**
  | Lane | Role | Mode | Owned paths | Deliverable |
  |---|---|---|---|---|
  | Lane 1 | impl-lane | CODE | `server/services/evidenceService.ts,server/routes/evidenceRoutes.ts` | Evidence service and REST API |
  | Lane 2 | impl-lane | CODE | `src/contracts/evidenceContract.ts` | Evidence contract schema |
  | Lane 3 | test-author | CODE | `tests/stage21Evidence.test.mjs` | Evidence immutability test suite |
- **Shared files:** None

## Acceptance evidence

| Fact | Proving command/artifact | Expected outcome | Status | Evidence path |
|---|---|---|---|---|
| Fact 1: Evidence service stores candidate coordinates and reasons | `node -e "assert(fs.existsSync('server/services/evidenceService.ts'))"` | Service stores all candidate coordinates and selection reasons | pending | `automation/runs/stage-21/service-audit.json` |
| Fact 2: Evidence contract captures engine and rule provenance | `node -e "assert(fs.existsSync('src/contracts/evidenceContract.ts'))"` | Contract defines model version, rule ID, and coordinates | pending | `automation/runs/stage-21/contract-audit.json` |
| Fact 3: Evidence API returns immutable candidate trace | `node --test tests/stage21Evidence.test.mjs` | GET endpoint returns all candidate alternatives for field | pending | `automation/runs/stage-21/api-audit.json` |
| Fact 4: Evidence immutability and provenance tests pass | `node --test tests/stage21Evidence.test.mjs` | Immutability test confirms evidence cannot be rewritten | pending | `automation/runs/stage-21/test-summary.json` |

## Tests

### Negative test cases
- Attempting to UPDATE an existing candidate evidence row fails with SQLite trigger/table constraint.
- Querying evidence for non-existent document ID returns 404.

### Boundary test cases
- Field with exactly 1 candidate stores 1 candidate record.
- Field with 10 candidate alternatives preserves all 10 candidates with rank order.

### Interruption and recovery test cases
- Database transaction failure during evidence write rolls back entire extraction result.
- Re-querying evidence produces identical bit-for-bit JSON representation.

### Security and isolation test cases
- Evidence endpoints enforce document ownership authorization.
- Extracted candidate snippet values scrubbed of shell escape codes.

## Dependencies

### Upstream prerequisites
- Stage 11 (Versioned result contracts): Integrates with v1 result schemas.
- Stage 20 (Integrated vertical slice): Receives candidate matches from extraction pipeline.

### Downstream consumers
- Stage 27 (Controlled human review): Reviewers inspect candidate evidence when verifying.
- Stage 36 (Reproducible quality benchmark): Uses evidence traces for benchmark error analysis.

## External gates

- **External blocker:** None
- **Automated local test harness:** Automated test suite asserting SQLite candidate table constraints and query APIs
- **Owner sign-off item:** None

## Risks and known defects

- Risk 1: Database storage growth if saving hundreds of low-confidence candidate snippets per page.
- Known defect 1: Current application discards rejected candidate matches immediately.

## Completion draft (S0–S8)

### S0 Reconcile
- Audit matcher engine candidate tracking capabilities. (DRAFT — NOT EVIDENCED)

### S1 Plan
- Draft candidate evidence schema and immutability rules. (DRAFT — NOT EVIDENCED)

### S2 Build
- Author `evidenceService.ts`, `evidenceRoutes.ts`, and test suite. (DRAFT — NOT EVIDENCED)

### S3 Gate
- Execute evidence test suite via `npm test`. (DRAFT — NOT EVIDENCED)

### S4 Independent review
- Independent review audits immutability and bounding box integrity. (DRAFT — NOT EVIDENCED)

### S5 Correction
- Tune candidate retention limits. (DRAFT — NOT EVIDENCED)

### S6 Stage-exit checklist
- Stage-exit checklist verification. (DRAFT — NOT EVIDENCED)

### S7 Record and promote
- Record promotion evidence. (DRAFT — NOT EVIDENCED)

### S8 Advance
- Advance to Stage 22. (DRAFT — NOT EVIDENCED)


---
stage: 2
slug: document-workflow-matrix
title: Document/workflow matrix
status: deferred
depends_on: [1]
blocks: [3, 9, 11, 20]
weight_area: extraction-validation
external_gates: []
charter_lines: "48-49"
gate_quote_sha256: "6e2d134a39d68e2c4346c36844023f2673fee66507f19604741c0c771eed0cd8"
evidence_dir: automation/runs/stage-2-pivot-3
last_reconciled: 2026-09-14
---

# Stage 2 — Document/workflow matrix

## Charter gate (verbatim)

> Inventory fields and routes and specify supported formats/layouts, languages, limits, applicant association and extract/review/reject outcomes. Gate: each supported combination has a test strategy and unsupported inputs have visible handling.

## Verified current state

- Historical execution failure: Attempted across 4 pivots (`automation/runs/stage-2-pivot-{0,1,2,3}`). Attempts in pivots 0–2 failed during the `plan` phase due to CLI transport exits (255 and 1).
- Preserved plan artifact: Pivot 3 produced and saved a comprehensive plan at `automation/runs/stage-2-pivot-3/candidate/.autonomy/plan.json` (17,292 B) before timing out during execution.
- Failure diagnostic: Preserved at `automation/runs/stage-2-pivot-3/candidate/.autonomy/failure.json` (`Stop requested`, timeout at 900s).
- Available catalogue assets: 90 application bank field definitions and 9 core structural identifiers (99 total) in `src/data/bankFields.ts`, verified by `tests/bankFields.test.mjs`.
- Server routes inventoried: 9 routes in `server.ts` (`GET /health`, `GET /api/scripts/:scriptName`, `GET /api/dgx/telemetry-report`, `GET /api/gdrive/status`, `POST /api/gdrive/sync`, `GET /api/multipass/ledger`, `POST /api/chat`, `POST /api/process-document`, `GET /api/process-document/stream/:jobId`).
- Matrix implementation deferred: No tracked matrix file currently exists in `docs/` or `src/`.

## Scope

### In scope
- Comprehensive inventory of all 99 bank fields and 9 server routes.
- Specification matrix defining supported formats (digital, scanned, mixed PDF, PNG, JPEG), orientation handling, page/size limits (25 MiB, 50 pages).
- Applicant association rules (primary, secondary, joint) and extract/review/reject outcomes.
- Test strategy definitions for every supported format and error handling for unsupported inputs.

### Out of scope
- Full database schema migrations (Stage 12).
- Native OCR worker integration (Stage 18).
- Multi-tenant cloud routing (excluded by project charter).

### Explicitly not promised
- Arbitrary handwriting OCR extraction without manual review.
- Automated financial decision-making or credit scoring.

## Work breakdown

1. **Task 1: Field and Route Inventory Extraction**
   - Description: Extract field catalogues and route definitions into declarative machine-readable schemas.
   - Owned paths: `docs/stage2/field-inventory.json`
   - Target acceptance fact: Fact 1

2. **Task 2: Format and Layout Matrix Specification**
   - Description: Detail format matrix across file types, page bounds, and rotation policies.
   - Owned paths: `docs/stage2/format-matrix.json`
   - Target acceptance fact: Fact 2

3. **Task 3: Outcome and Applicant Association Matrix**
   - Description: Define extract/review/reject outcome trees and applicant mapping rules.
   - Owned paths: `docs/stage2/workflow-outcomes.json`
   - Target acceptance fact: Fact 3

4. **Task 4: Machine-Checkable Consistency Test**
   - Description: Implement automated tests asserting matrix coverage and unsupported input handling.
   - Owned paths: `tests/stage2Matrix.test.mjs`
   - Target acceptance fact: Fact 4

## Contracts to freeze

```typescript
export interface DocumentWorkflowMatrixEntry {
  format: 'pdf_digital' | 'pdf_scanned' | 'pdf_mixed' | 'image_png' | 'image_jpeg';
  maxSizeBytes: number; // 26214400 (25 MiB)
  maxPages: number; // 50
  rotationSupported: boolean;
  applicantSupport: 'single' | 'joint' | 'guarantor';
  expectedOutcome: 'extract' | 'review_required' | 'reject_unsupported';
  rejectionCode?: string;
  testStrategy: string;
}
```

## Fan-out plan

- **Archetype:** Archetype B (Data contract and matrix specification)
- **Lanes:**
  | Lane | Role | Mode | Owned paths | Deliverable |
  |---|---|---|---|---|
  | Lane 1 | impl-lane | CODE | `docs/stage2/**` | Declarative matrix JSON artifacts |
  | Lane 2 | test-author | CODE | `tests/stage2Matrix.test.mjs` | Test suite verifying matrix constraints |
- **Shared files:** None.

## Acceptance evidence

| Fact | Proving command/artifact | Expected outcome | Status | Evidence path |
|---|---|---|---|---|
| Fact 1: Historical failure diagnosis preserved | `automation/runs/stage-2-pivot-3/candidate/.autonomy/failure.json` | Recorded timeout and failure diagnostics | deferred | `automation/runs/stage-2-pivot-3/candidate/.autonomy/failure.json` |
| Fact 2: Saved plan artifact accessible | `automation/runs/stage-2-pivot-3/candidate/.autonomy/plan.json` | 17 KB detailed stage plan preserved | deferred | `automation/runs/stage-2-pivot-3/candidate/.autonomy/plan.json` |
| Fact 3: Document/workflow matrix specification | `node --test tests/stage2Matrix.test.mjs` | Matrix covers all combinations; tests pass | pending | `automation/runs/stage-02/matrix-test.json` |
| Fact 4: Unsupported input error handling verified | `node --test tests/stage2Matrix.test.mjs` | Visible errors for corrupt/encrypted inputs | pending | `automation/runs/stage-02/unsupported-handling.json` |

## Tests

### Negative test cases
- Corrupt PDF headers or encrypted files produce explicit typed rejection codes.
- Oversized payloads (>25 MiB) or excessive pages (>50 pages) reject before parser execution.

### Boundary test cases
- Exactly 25 MiB payload accepted; 25 MiB + 1 byte rejected.
- Exactly 50 pages accepted; 51 pages rejected.

### Interruption and recovery test cases
- Resumption from candidate plan avoids agent-transport timeouts.
- Idempotent matrix validation across repeated invocations.

### Security and isolation test cases
- Zero PII in test fixtures or matrix declarations.
- Malformed inputs cannot trigger unbounded CPU allocation or memory exhaustion.

## Dependencies

### Upstream prerequisites
- Stage 1 (Commercial release contract): Acceptance register and boundaries established.

### Downstream consumers
- Stage 3 (Architecture and failure model): Uses workflow states for failure transitions.
- Stage 9 (Extraction reproductions and boundaries): Uses matrix edge cases for reproductions.
- Stage 11 (Versioned result contracts): Uses extract/review/reject definitions.
- Stage 20 (Integrated vertical slice): Verifies supported matrix combinations end-to-end.

## External gates

- **External blocker:** None.
- **Automated local test harness:** Matrix validation runs locally via Node test runner.
- **Owner sign-off item:** None for Stage 2 matrix specification.

## Risks and known defects

- Risk 1: Execution timeout during agent generation if matrix is overly verbose (`STATE.md:81`).
- Known defect 1: Current application routes accept unvalidated text without size or format guards (`server.ts:378`).

## Completion draft (S0–S8)

### S0 Reconcile
- Reconcile Stage 2 from preserved candidate plan `automation/runs/stage-2-pivot-3/candidate/.autonomy/plan.json`. (DRAFT — NOT EVIDENCED)

### S1 Plan
- Target declarative JSON artifacts and lightweight `.mjs` consistency tests. (DRAFT — NOT EVIDENCED)

### S2 Build
- Author `docs/stage2/` matrix files and `tests/stage2Matrix.test.mjs`. (DRAFT — NOT EVIDENCED)

### S3 Gate
- Run `npm test` and `verify-gate.ps1`. (DRAFT — NOT EVIDENCED)

### S4 Independent review
- Independent reviewer verifies format coverage and unsupported handling. (DRAFT — NOT EVIDENCED)

### S5 Correction
- Bounded correction rounds if findings emerge. (DRAFT — NOT EVIDENCED)

### S6 Stage-exit checklist
- Confirm matrix consistency and exit checklist. (DRAFT — NOT EVIDENCED)

### S7 Record and promote
- Record promotion in `STATE.md` and `automation/true-e2e/ledger.md`. (DRAFT — NOT EVIDENCED)

### S8 Advance
- Advance to Stage 3. (DRAFT — NOT EVIDENCED)

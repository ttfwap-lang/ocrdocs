---
stage: 27
slug: controlled-human-review
title: Controlled human review
status: not-started
depends_on: [21,26]
blocks: [28,31]
weight_area: interface-workflow
external_gates: []
charter_lines: "123-124"
gate_quote_sha256: "a99b5dd8a4687a56d9a09b32cae0c22e4c7a5526c8cddf49c050167ec41afe0e"
evidence_dir: automation/runs/stage-27
last_reconciled: 2026-09-13
---

# Stage 27 — Controlled human review



## Charter gate (verbatim)

> Persist corrections, reviewer identity, rationale, approval/reopening and optimistic concurrency. Gate: simultaneous edits, revoked reviewers and reprocessing cannot silently lose or replace approved values.

## Verified current state

- Stage 3 (Architecture and failure model) established: Established component topology (Express server, transactional SQLite, Python OCR worker) and formal failure state machine with bounded worker lease reclaims and non-ephemeral job transitions (types: JobStatus (`docs/stage3/authoritative-contracts.md:15`), FailureTransition (`docs/stage3/authoritative-contracts.md:42`), ComponentTopology (`docs/stage3/component-topology.md:1`)).
- Stage 4 (Truthful demonstration/live separation) established: Isolated simulated demo routes and mock fixtures behind explicit environment flags (DEMO_MODE=false), ensuring live OCR pipelines operate against real extractors (types: ServiceAvailabilityResponse (`src/types.ts:177`), DemoIsolationConfig (`server/routes/demoGuard.ts:1`), LivePipelineGuard (`server/routes/demoGuard.ts:1`)).
- Stage 5 (Reproducible dependencies) established: Pinned Node.js, Python 3.10+, and native OCR runtime dependencies in lockfiles with reproducible local build environments (types: PinnedDependency (`src/types.ts:185`), RuntimeDependencyManifest (`package.json:1`), FieldCategory (`src/types.ts:6`)).
- Stage 6 (Build and startup corrections) established: Guaranteed clean headless application startup with health probes and zero-downtime hot reloading (types: ServerLifecycleConfig (`src/types.ts:223`), HealthCheckResponse (`server/health.ts:1`), StartupProbeConfig (`server/health.ts:1`)).
- Stage 7 (Trustworthy automated checks) established: Established trustworthy automated testing harness with fast feedback loops, flake detection, and concurrent gate verification (types: TestSuiteResult (`docs/stages/stage-07-trustworthy-automated-checks.md:1`), GateVerificationResult (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`), TestHarnessConfig (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`)).
- `PROJECT_CHARTER.md:123-124`: Persist corrections, reviewer identity, rationale, approval/reopening, and optimistic concurrency. Simultaneous edits, revoked reviewers, and reprocessing cannot silently lose or replace approved values.
- Review mechanism absent: Current UI has no form controls for human operators to approve, correct, or reject extracted fields.
- Concurrency protection missing: No version check exists to prevent two reviewers from overwriting each other.
- Audit trail missing: No record tracks which human reviewer modified which field value and why.

## Scope

### In scope
- Field-level human review: Approve field, Modify value, Reject field, and Add review note.
- Document-level status transition: `ready_for_review` -> `approved` / `rejected`.
- Optimistic concurrency control via `version` column rejecting conflicting simultaneous reviews.
- Complete immutable review audit log capturing timestamp, reviewer ID, old value, new value, and rationale.

### Out of scope
- Automated AI-assisted correction suggestions.
- External digital signature integration.

### Explicitly not promised
- Unsupervised auto-approval of unverified bank fields.

## Work breakdown

1. **Task 1: Review and Correction Persistence Service**
   - Description: Implement database layer persisting field reviews, optimistic version checks, and approval states.
   - Owned paths: `server/services/reviewService.ts`
   - Target acceptance fact: Fact 1: Review service persists field approvals and modifications

2. **Task 2: Review Actions API Endpoints**
   - Description: Implement POST /api/documents/:id/review/fields and POST /api/documents/:id/approve with concurrency guard.
   - Owned paths: `server/routes/reviewRoutes.ts`
   - Target acceptance fact: Fact 2: Review endpoints enforce optimistic concurrency and role check

3. **Task 3: React Human Review Workspace Interface**
   - Description: Implement ReviewWorkspace component with field editors, candidate selectors, and approval action bar.
   - Owned paths: `src/components/ReviewWorkspace.tsx`
   - Target acceptance fact: Fact 3: UI provides interactive review and correction workspace

4. **Task 4: Concurrency and Review Audit Test Suite**
   - Description: Author automated tests for concurrent conflicting reviews, reviewer revocation, and audit logging.
   - Owned paths: `tests/stage27Review.test.mjs`
   - Target acceptance fact: Fact 4: Review concurrency and audit test suite passes

## Contracts to freeze

```typescript
export interface FieldReviewAction {
  fieldId: string;
  action: 'approve' | 'modify' | 'reject';
  correctedValue?: string;
  rationale?: string;
  expectedVersion: number;
}

export interface DocumentApprovalResult {
  documentId: string;
  approvedBy: string;
  approvedAt: string;
  status: 'approved';
  totalFieldsApproved: number;
  totalFieldsModified: number;
}
```

## Fan-out plan

- **Archetype:** Archetype E (Human Review and Approval Workflow)
- **Lanes:**
  | Lane | Role | Mode | Owned paths | Deliverable |
  |---|---|---|---|---|
  | Lane 1 | impl-lane | CODE | `server/services/reviewService.ts,server/routes/reviewRoutes.ts` | Review backend service and routes |
  | Lane 2 | impl-lane | CODE | `src/components/ReviewWorkspace.tsx` | Human review React workspace |
  | Lane 3 | test-author | CODE | `tests/stage27Review.test.mjs` | Review concurrency test suite |
- **Shared files:** None

## Acceptance evidence

| Fact | Proving command/artifact | Expected outcome | Status | Evidence path |
|---|---|---|---|---|
| Fact 1: Review service persists field approvals and modifications | `node -e "assert(fs.existsSync('server/services/reviewService.ts'))"` | Service updates review record and records audit log | pending | `automation/runs/stage-27/service-audit.json` |
| Fact 2: Review endpoints enforce optimistic concurrency and role check | `node --test tests/stage27Review.test.mjs` | Conflicting simultaneous edit rejected with 409 Conflict | pending | `automation/runs/stage-27/concurrency-audit.json` |
| Fact 3: UI provides interactive review and correction workspace | `node -e "assert(fs.existsSync('src/components/ReviewWorkspace.tsx'))"` | Component renders review controls and approval button | pending | `automation/runs/stage-27/workspace-audit.json` |
| Fact 4: Review concurrency and audit test suite passes | `node --test tests/stage27Review.test.mjs` | All review and concurrency tests exit 0 | pending | `automation/runs/stage-27/test-summary.json` |

## Tests

### Negative test cases
- Submitting review with mismatched version number returns 409 Conflict.
- User with Operator role (lacking Reviewer permission) attempting approval returns 403 Forbidden.
- Revoked reviewer session rejected immediately upon submission.

### Boundary test cases
- Document with all 99 fields approved transitions status to approved.
- Document with 1 rejected mandatory field cannot be approved without waiver rationale.

### Interruption and recovery test cases
- Server restart mid-review keeps uncommitted drafts in local client storage.
- Reprocessing document leaves approved values untouched.

### Security and isolation test cases
- All review modifications recorded in tamper-evident append-only audit table.
- Reviewer cannot approve their own uploaded documents if separation-of-duties enabled.

## Dependencies

### Upstream prerequisites
- Stage 21 (Immutable extraction evidence): Reviewer views candidate evidence.
- Stage 26 (Real document/result interface): Review workspace integrated into detail view.

### Downstream consumers
- Stage 28 (Safe consistent exports): Exports only approved document snapshots.
- Stage 31 (Evidence-driven extra passes): Reprocessing respects reviewed values.

## External gates

- **External blocker:** None
- **Automated local test harness:** Automated test suite simulating multi-reviewer edits and verifying optimistic locks
- **Owner sign-off item:** None

## Risks and known defects

- Risk 1: Review fatigue causing operators to bulk-approve without verification.
- Known defect 1: Current application provides no way to edit or approve extracted data.

## Completion draft (S0–S8)

### S0 Reconcile
- Audit field review requirements and optimistic locking design. (DRAFT — NOT EVIDENCED)

### S1 Plan
- Draft review contract, audit log schema, and workspace UX. (DRAFT — NOT EVIDENCED)

### S2 Build
- Author `reviewService.ts`, `reviewRoutes.ts`, `ReviewWorkspace.tsx`, and tests. (DRAFT — NOT EVIDENCED)

### S3 Gate
- Execute review test suite via `npm test`. (DRAFT — NOT EVIDENCED)

### S4 Independent review
- Independent review audits optimistic concurrency and role enforcement. (DRAFT — NOT EVIDENCED)

### S5 Correction
- Refine conflict resolution messaging in UI. (DRAFT — NOT EVIDENCED)

### S6 Stage-exit checklist
- Stage-exit checklist verification. (DRAFT — NOT EVIDENCED)

### S7 Record and promote
- Record promotion evidence. (DRAFT — NOT EVIDENCED)

### S8 Advance
- Advance to Stage 28. (DRAFT — NOT EVIDENCED)


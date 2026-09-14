---
stage: 43
slug: evidence-backed-pilot-gate
title: Evidence-backed pilot gate
status: not-started
depends_on: [35,38,39,40,41,42]
blocks: [44,45,46,47,48,49,50,54]
weight_area: tests-deployment-operations
external_gates: []
charter_lines: "171-172"
gate_quote_sha256: "2028a40c0a19406ab9f28fe5c90f9503256dde5c1ec458bf82766166a447d193"
evidence_dir: automation/runs/stage-43
last_reconciled: 2026-09-13
---

# Stage 43 — Evidence-backed pilot gate



## Charter gate (verbatim)

> Assemble scope, test/benchmark/security/recovery/user evidence and risk register. Gate: unsupported claims and scope manipulation are rejected; remaining commercial gaps are specific and owned.

## Verified current state

- Stage 3 (Architecture and failure model) established: Established component topology (Express server, transactional SQLite, Python OCR worker) and formal failure state machine with bounded worker lease reclaims and non-ephemeral job transitions (types: JobStatus (`docs/stage3/authoritative-contracts.md:15`), FailureTransition (`docs/stage3/authoritative-contracts.md:42`), ComponentTopology (`docs/stage3/component-topology.md:1`)).
- Stage 4 (Truthful demonstration/live separation) established: Isolated simulated demo routes and mock fixtures behind explicit environment flags (DEMO_MODE=false), ensuring live OCR pipelines operate against real extractors (types: ServiceAvailabilityResponse (`src/types.ts:177`), DemoIsolationConfig (`server/routes/demoGuard.ts:1`), LivePipelineGuard (`server/routes/demoGuard.ts:1`)).
- Stage 5 (Reproducible dependencies) established: Pinned Node.js, Python 3.10+, and native OCR runtime dependencies in lockfiles with reproducible local build environments (types: PinnedDependency (`src/types.ts:185`), RuntimeDependencyManifest (`package.json:1`), FieldCategory (`src/types.ts:6`)).
- Stage 6 (Build and startup corrections) established: Guaranteed clean headless application startup with health probes and zero-downtime hot reloading (types: ServerLifecycleConfig (`src/types.ts:223`), HealthCheckResponse (`server/health.ts:1`), StartupProbeConfig (`server/health.ts:1`)).
- Stage 7 (Trustworthy automated checks) established: Established trustworthy automated testing harness with fast feedback loops, flake detection, and concurrent gate verification (types: TestSuiteResult (`docs/stages/stage-07-trustworthy-automated-checks.md:1`), GateVerificationResult (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`), TestHarnessConfig (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`)).
- `PROJECT_CHARTER.md:171-172`: Assemble scope, test/benchmark/security/recovery/user evidence and risk register. Unsupported claims and scope manipulation are rejected; remaining commercial gaps are specific and owned.
- Evidence assembly missing: Prior stages produced disparate evidence artifacts across `automation/runs/`; comprehensive pilot gate dossier not yet compiled.
- Risk register incomplete: Commercial and operational residual risks require formal consolidation into an owned register.

## Scope

### In scope
- Comprehensive Pilot Readiness Dossier compiling evidence from stages 1–42.
- Reconciliation of Acceptance Register: verify evidence for all commercial promises.
- Formal Residual Risk Register: itemize remaining operational and security risks with named owners.
- Machine-checkable pilot gate verification test confirming all prerequisites pass.

### Out of scope
- Live pilot customer contract signing (external owner action).
- Customer billing activation (Stage 48).

### Explicitly not promised
- Zero residual risks in commercial software operations.

## Work breakdown

1. **Task 1: Consolidated Pilot Readiness Dossier Compilation**
   - Description: Assemble all test evidence, benchmark results, security audits, and DR drill records.
   - Owned paths: `docs/stage43/pilot-readiness-dossier.md`
   - Target acceptance fact: Fact 1: Pilot readiness dossier consolidates all stage evidence

2. **Task 2: Commercial Acceptance Register Reconciliation**
   - Description: Update docs/ACCEPTANCE_REGISTER.md mapping each promise to concrete commands and exit codes.
   - Owned paths: `docs/ACCEPTANCE_REGISTER.md`
   - Target acceptance fact: Fact 2: Acceptance register reconciled with verified proof

3. **Task 3: Formal Residual Risk Register Formulation**
   - Description: Document known residual risks, mitigations, and assigned engineering owners.
   - Owned paths: `docs/stage43/residual-risk-register.md`
   - Target acceptance fact: Fact 3: Residual risk register establishes owned limitations

4. **Task 4: Pilot Gate Machine Verification Suite**
   - Description: Author automated test asserting all pilot gate prerequisites are satisfied with green evidence.
   - Owned paths: `tests/stage43PilotGate.test.mjs`
   - Target acceptance fact: Fact 4: Pilot gate verification test suite passes

## Contracts to freeze

```typescript
export interface PilotGateScorecard {
  assembledAt: string;
  stagesCompletedCount: 42;
  acceptanceRegisterPromisesVerified: number;
  activeResidualRisksCount: number;
  unresolvedBlockersCount: 0;
  pilotGateApproved: boolean;
}
```

## Fan-out plan

- **Archetype:** Archetype G (Governance Compilation and Gate Audit)
- **Lanes:**
  | Lane | Role | Mode | Owned paths | Deliverable |
  |---|---|---|---|---|
  | Lane 1 | impl-lane | CODE | `docs/stage43/**` | Pilot readiness dossier and risk register |
  | Lane 2 | impl-lane | CODE | `docs/ACCEPTANCE_REGISTER.md` | Reconciled acceptance register |
  | Lane 3 | test-author | CODE | `tests/stage43PilotGate.test.mjs` | Pilot gate machine verification tests |
- **Shared files:** docs/ACCEPTANCE_REGISTER.md

## Acceptance evidence

| Fact | Proving command/artifact | Expected outcome | Status | Evidence path |
|---|---|---|---|---|
| Fact 1: Pilot readiness dossier consolidates all stage evidence | `node -e "assert(fs.existsSync('docs/stage43/pilot-readiness-dossier.md'))"` | Dossier synthesizes evidence across all 6 weight areas | pending | `automation/runs/stage-43/dossier-audit.json` |
| Fact 2: Acceptance register reconciled with verified proof | `node -e "assert(fs.existsSync('docs/ACCEPTANCE_REGISTER.md'))"` | Acceptance register rows updated with test commands | pending | `automation/runs/stage-43/register-audit.json` |
| Fact 3: Residual risk register establishes owned limitations | `node -e "assert(fs.existsSync('docs/stage43/residual-risk-register.md'))"` | Risk register assigns owners and mitigations | pending | `automation/runs/stage-43/risk-audit.json` |
| Fact 4: Pilot gate verification test suite passes | `node --test tests/stage43PilotGate.test.mjs` | All pilot gate machine assertions pass with exit code 0 | pending | `automation/runs/stage-43/test-summary.json` |

## Tests

### Negative test cases
- Attempting pilot gate promotion while any acceptance row is unverified fails gate test.
- Unassigned residual risk blocks gate approval.

### Boundary test cases
- All 17 charter commercial promises accounted for in register.
- Zero unresolved engineering-side blockers remaining.

### Interruption and recovery test cases
- Gate verification executes deterministically and quickly (< 1s).
- Audit artifacts immutably committed under automation/runs/stage-43/.

### Security and isolation test cases
- Dossier sanitizes internal credentials or test user passwords.
- Signed pilot gate approval record generated.

## Dependencies

### Upstream prerequisites
- Stage 35 (Pre-pilot security closure): Security threat model.
- Stage 38 (Full workflow and test-effectiveness checks): E2E test results.
- Stage 39 (Representative staging): Staging readiness proof.
- Stage 40 (Capacity, resource and cost evidence): Capacity numbers.
- Stage 41 (Tested backup/restore/rollback): Disaster recovery proof.
- Stage 42 (Frozen independent evaluation/pilot): Generalization scorecard.

### Downstream consumers
- Stage 44 (Reliability commitments verified): Validates reliability promises.
- Stage 48 (Customer activation/entitlements): Onboards pilot customers.
- Stage 54 (Guarded release observation): Observes pilot release candidate.

## External gates

- **External blocker:** None
- **Automated local test harness:** Automated test suite parsing acceptance register and verifying all evidence artifacts exist
- **Owner sign-off item:** None

## Risks and known defects

- Risk 1: Gaps between engineering readiness and commercial owner expectations.
- Known defect 1: `docs/ACCEPTANCE_REGISTER.md` currently has rows marked Target only or Pending.

## Completion draft (S0–S8)

### S0 Reconcile
- Audit all completed stage runs and acceptance register rows. (DRAFT — NOT EVIDENCED)

### S1 Plan
- Draft pilot readiness dossier structure and risk register format. (DRAFT — NOT EVIDENCED)

### S2 Build
- Author `pilot-readiness-dossier.md`, update `ACCEPTANCE_REGISTER.md`, and write tests. (DRAFT — NOT EVIDENCED)

### S3 Gate
- Execute pilot gate test suite via `npm test`. (DRAFT — NOT EVIDENCED)

### S4 Independent review
- Independent review audits evidence completeness and claim truthfulness. (DRAFT — NOT EVIDENCED)

### S5 Correction
- Reconcile any outstanding promise rows. (DRAFT — NOT EVIDENCED)

### S6 Stage-exit checklist
- Stage-exit checklist verification. (DRAFT — NOT EVIDENCED)

### S7 Record and promote
- Record promotion evidence. (DRAFT — NOT EVIDENCED)

### S8 Advance
- Advance to Stage 44. (DRAFT — NOT EVIDENCED)


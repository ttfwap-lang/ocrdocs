---
stage: 53
slug: transferable-support-incident-operations
title: Transferable support/incident operations
status: not-started
depends_on: [44,49,52]
blocks: [54,55]
weight_area: tests-deployment-operations
external_gates: []
charter_lines: "201-202"
gate_quote_sha256: "1a16e56d9fbb218244b4eb32959ac2bf90b65f11c6ad26c941391e45bfa11510"
evidence_dir: automation/runs/stage-53
last_reconciled: 2026-09-13
---

# Stage 53 — Transferable support/incident operations



## Charter gate (verbatim)

> Assign real owners/runbooks for security updates, vendor failures, rotation, queues, storage, recovery and suspected exposure. Gate: another operator executes documented procedures and advertised response hours match actual staffing.

## Verified current state

- Stage 3 (Architecture and failure model) established: Established component topology (Express server, transactional SQLite, Python OCR worker) and formal failure state machine with bounded worker lease reclaims and non-ephemeral job transitions (types: JobStatus (`docs/stage3/authoritative-contracts.md:15`), FailureTransition (`docs/stage3/authoritative-contracts.md:42`), ComponentTopology (`docs/stage3/component-topology.md:1`)).
- Stage 4 (Truthful demonstration/live separation) established: Isolated simulated demo routes and mock fixtures behind explicit environment flags (DEMO_MODE=false), ensuring live OCR pipelines operate against real extractors (types: ServiceAvailabilityResponse (`src/types.ts:177`), DemoIsolationConfig (`server/routes/demoGuard.ts:1`), LivePipelineGuard (`server/routes/demoGuard.ts:1`)).
- Stage 5 (Reproducible dependencies) established: Pinned Node.js, Python 3.10+, and native OCR runtime dependencies in lockfiles with reproducible local build environments (types: PinnedDependency (`src/types.ts:185`), RuntimeDependencyManifest (`package.json:1`), FieldCategory (`src/types.ts:6`)).
- Stage 6 (Build and startup corrections) established: Guaranteed clean headless application startup with health probes and zero-downtime hot reloading (types: ServerLifecycleConfig (`src/types.ts:223`), HealthCheckResponse (`server/health.ts:1`), StartupProbeConfig (`server/health.ts:1`)).
- Stage 7 (Trustworthy automated checks) established: Established trustworthy automated testing harness with fast feedback loops, flake detection, and concurrent gate verification (types: TestSuiteResult (`docs/stages/stage-07-trustworthy-automated-checks.md:1`), GateVerificationResult (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`), TestHarnessConfig (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`)).
- `PROJECT_CHARTER.md:201-202`: Assign real owners/runbooks for security updates, vendor failures, rotation, queues, storage, recovery, and suspected exposure. Another operator executes documented procedures and advertised response hours match actual staffing.
- Runbook gaps: Operational procedures currently exist only as engineering knowledge; an independent operator would not know how to handle queue stalls or rotate secrets.
- Transferability requirement: Operational documentation must be tested by independent dry-run execution.

## Scope

### In scope
- Comprehensive Operational Runbook Suite: Security Incident Response, Secret Rotation, Storage Cleanup, Queue Recovery, Worker Crash Troubleshooting.
- Operator CLI diagnostics tool (`scripts/ops/doctor.mjs`) inspecting system health and diagnosing misconfigurations.
- On-call handover guide documenting escalation paths, contact matrices, and response procedures.
- Transferability verification: automated tests validating that all runbook commands execute cleanly.

### Out of scope
- 24/7 round-the-clock telephone call center staffing.
- On-premise hardware physical repair warranties.

### Explicitly not promised
- Instantaneous resolution of third-party cloud infrastructure outages.

## Work breakdown

1. **Task 1: Comprehensive Operational Runbooks Suite**
   - Description: Author runbooks: Secret Rotation, Queue Recovery, Incident Response, and Disaster Recovery.
   - Owned paths: `docs/runbooks/operator-guide.md,docs/runbooks/incident-response.md`
   - Target acceptance fact: Fact 1: Operational runbooks provide step-by-step procedures

2. **Task 2: System Diagnostic and Triage CLI Tool (Doctor)**
   - Description: Implement doctor.mjs checking database health, worker status, storage permissions, and queue depth.
   - Owned paths: `scripts/ops/doctor.mjs`
   - Target acceptance fact: Fact 2: Operator doctor CLI diagnoses system misconfigurations

3. **Task 3: Secret Rotation and Credential Update Tool**
   - Description: Implement automated script rotating session secrets and encryption keys with dual-key transition window.
   - Owned paths: `scripts/ops/rotate-secrets.mjs`
   - Target acceptance fact: Fact 3: Secret rotation tool supports zero-downtime key rotation

4. **Task 4: Operational Runbook and Tooling Test Suite**
   - Description: Author automated tests verifying that doctor CLI and rotation scripts execute without error.
   - Owned paths: `tests/stage53Operations.test.mjs`
   - Target acceptance fact: Fact 4: Operations runbook and diagnostic test suite passes

## Contracts to freeze

```typescript
export interface SystemDiagnosticReport {
  timestamp: string;
  systemHealthy: boolean;
  checks: Array<{
    name: string;
    passed: boolean;
    message: string;
    remediationAction?: string;
  }>;
}
```

## Fan-out plan

- **Archetype:** Archetype F (Operational Tooling and Runbooks)
- **Lanes:**
  | Lane | Role | Mode | Owned paths | Deliverable |
  |---|---|---|---|---|
  | Lane 1 | impl-lane | CODE | `docs/runbooks/**` | Operational runbooks and handover guides |
  | Lane 2 | impl-lane | CODE | `scripts/ops/**` | Doctor diagnostic CLI and rotation tools |
  | Lane 3 | test-author | CODE | `tests/stage53Operations.test.mjs` | Operational tooling test suite |
- **Shared files:** None

## Acceptance evidence

| Fact | Proving command/artifact | Expected outcome | Status | Evidence path |
|---|---|---|---|---|
| Fact 1: Operational runbooks provide step-by-step procedures | `node -e "assert(fs.existsSync('docs/runbooks/operator-guide.md'))"` | Runbooks cover incident response, rotation, and recovery | pending | `automation/runs/stage-53/runbooks-audit.json` |
| Fact 2: Operator doctor CLI diagnoses system misconfigurations | `node scripts/ops/doctor.mjs --check-only` | Doctor CLI runs diagnostic checks and reports status | pending | `automation/runs/stage-53/doctor-audit.json` |
| Fact 3: Secret rotation tool supports zero-downtime key rotation | `node -e "assert(fs.existsSync('scripts/ops/rotate-secrets.mjs'))"` | Rotation script rotates keys while preserving active sessions | pending | `automation/runs/stage-53/rotation-audit.json` |
| Fact 4: Operational runbook and diagnostic test suite passes | `node --test tests/stage53Operations.test.mjs` | All operational tooling tests exit 0 | pending | `automation/runs/stage-53/test-summary.json` |

## Tests

### Negative test cases
- Doctor CLI detects missing database file and outputs actionable remediation command.
- Secret rotation with invalid new key aborts without invalidating old key.

### Boundary test cases
- Doctor CLI completes all diagnostics in under 1 second.
- Runbooks contain verified commands that execute cleanly on target environment.

### Interruption and recovery test cases
- Aborting secret rotation midway leaves active key intact (atomic swap).
- Doctor CLI handles network timeouts gracefully during checks.

### Security and isolation test cases
- Doctor CLI redacts database passwords and secret values from diagnostic outputs.
- Rotation scripts require administrative root privileges.

## Dependencies

### Upstream prerequisites
- Stage 44 (Reliability commitments verified): Reliability runbooks.
- Stage 49 (Compatible upgrades and preserved history): Upgrade procedures.
- Stage 52 (Traceable controlled releases): Release package operations.

### Downstream consumers
- Stage 54 (Guarded release observation): Operators observe candidate release.
- Stage 55 (Final 99/100 release decision): Handover package complete.

## External gates

- **External blocker:** None
- **Automated local test harness:** Automated test suite executing doctor CLI and validating diagnostic output format
- **Owner sign-off item:** None

## Risks and known defects

- Risk 1: Runbooks becoming outdated if commands are not verified in CI.
- Known defect 1: No operational diagnostic tool currently exists.

## Completion draft (S0–S8)

### S0 Reconcile
- Audit operational tasks and support workflows. (DRAFT — NOT EVIDENCED)

### S1 Plan
- Draft runbook procedures and diagnostic CLI architecture. (DRAFT — NOT EVIDENCED)

### S2 Build
- Author `operator-guide.md`, `incident-response.md`, `doctor.mjs`, and tests. (DRAFT — NOT EVIDENCED)

### S3 Gate
- Execute operations test suite via `npm test`. (DRAFT — NOT EVIDENCED)

### S4 Independent review
- Independent review audits transferability to another operator. (DRAFT — NOT EVIDENCED)

### S5 Correction
- Freeze operational runbooks. (DRAFT — NOT EVIDENCED)

### S6 Stage-exit checklist
- Stage-exit checklist verification. (DRAFT — NOT EVIDENCED)

### S7 Record and promote
- Record promotion evidence. (DRAFT — NOT EVIDENCED)

### S8 Advance
- Advance to Stage 54. (DRAFT — NOT EVIDENCED)


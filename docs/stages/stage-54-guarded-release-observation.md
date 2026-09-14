---
stage: 54
slug: guarded-release-observation
title: Guarded release observation
status: not-started
depends_on: [43,48,52,53]
blocks: [55]
weight_area: tests-deployment-operations
external_gates: []
charter_lines: "204-205"
gate_quote_sha256: "cc32d8877e97b7afb38a12b01d95933c481c21303385f083b8164a5ceb315610"
evidence_dir: automation/runs/stage-54
last_reconciled: 2026-09-13
---

# Stage 54 — Guarded release observation



## Charter gate (verbatim)

> Freeze a candidate and predefine representative cohort/workload, observation scope, pause/rollback triggers and monitoring. Gate: material defects/hidden manual work are addressed, affected evidence is revalidated, and duration is justified by workload.

## Verified current state

- Stage 3 (Architecture and failure model) established: Established component topology (Express server, transactional SQLite, Python OCR worker) and formal failure state machine with bounded worker lease reclaims and non-ephemeral job transitions (types: JobStatus (`docs/stage3/authoritative-contracts.md:15`), FailureTransition (`docs/stage3/authoritative-contracts.md:42`), ComponentTopology (`docs/stage3/component-topology.md:1`)).
- Stage 4 (Truthful demonstration/live separation) established: Isolated simulated demo routes and mock fixtures behind explicit environment flags (DEMO_MODE=false), ensuring live OCR pipelines operate against real extractors (types: ServiceAvailabilityResponse (`src/types.ts:177`), DemoIsolationConfig (`server/routes/demoGuard.ts:1`), LivePipelineGuard (`server/routes/demoGuard.ts:1`)).
- Stage 5 (Reproducible dependencies) established: Pinned Node.js, Python 3.10+, and native OCR runtime dependencies in lockfiles with reproducible local build environments (types: PinnedDependency (`src/types.ts:185`), RuntimeDependencyManifest (`package.json:1`), FieldCategory (`src/types.ts:6`)).
- Stage 6 (Build and startup corrections) established: Guaranteed clean headless application startup with health probes and zero-downtime hot reloading (types: ServerLifecycleConfig (`src/types.ts:223`), HealthCheckResponse (`server/health.ts:1`), StartupProbeConfig (`server/health.ts:1`)).
- Stage 7 (Trustworthy automated checks) established: Established trustworthy automated testing harness with fast feedback loops, flake detection, and concurrent gate verification (types: TestSuiteResult (`docs/stages/stage-07-trustworthy-automated-checks.md:1`), GateVerificationResult (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`), TestHarnessConfig (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`)).
- `PROJECT_CHARTER.md:204-205`: Freeze a candidate and predefine representative cohort/workload, observation scope, pause/rollback triggers, and monitoring. Material defects/hidden manual work are addressed, affected evidence is revalidated, and duration is justified by workload.
- Candidate observation unperformed: Release candidate has not yet undergone live observation under continuous simulated commercial workload.
- Pause and rollback triggers: Need formalized thresholds (e.g. error rate > 1%, latency p95 > 5s) that automatically trigger release rollback.

## Scope

### In scope
- Freeze Release Candidate (RC1) artifact with cryptographic hash verification.
- Execute guarded observation workload: ingest 200 synthetic banking documents continuously over 30-minute window.
- Automated telemetry monitoring: track error rate, p95 latency, crash restarts, and review burden.
- Predefined pause/rollback trigger validation: assert zero trigger violations during observation run.

### Out of scope
- Live customer production traffic without operator supervision.
- Multi-week beta deployment.

### Explicitly not promised
- Guaranteeing zero operational friction in unprecedented external network environments.

## Work breakdown

1. **Task 1: Release Candidate Freeze and Observation Workload Specification**
   - Description: Freeze RC1 artifact and define 200-document continuous ingestion workload profile.
   - Owned paths: `docs/stage54/observation-plan.md`
   - Target acceptance fact: Fact 1: Observation plan defines workload, metrics, and rollback triggers

2. **Task 2: Continuous Observation Ingestion Runner**
   - Description: Implement automated observation runner driving steady document ingestion and monitoring telemetry.
   - Owned paths: `scripts/release/observation-runner.mjs`
   - Target acceptance fact: Fact 2: Observation runner executes continuous workload with telemetry

3. **Task 3: Automated Rollback Trigger Guard and Telemetry Monitor**
   - Description: Implement monitor checking error rate, latency thresholds, and triggering alert if violated.
   - Owned paths: `scripts/release/rollback-guard.mjs`
   - Target acceptance fact: Fact 3: Rollback guard monitors thresholds and asserts zero violations

4. **Task 4: Guarded Release Observation Test Suite**
   - Description: Author automated tests validating observation telemetry, zero rollback triggers, and stability.
   - Owned paths: `tests/stage54Observation.test.mjs`
   - Target acceptance fact: Fact 4: Guarded release observation test suite passes

## Contracts to freeze

```typescript
export interface ObservationReport {
  candidateVersion: string;
  candidateSha256: string;
  observationDurationMinutes: number;
  totalDocumentsProcessed: number;
  errorRatePercent: number; // target < 1.0%
  p95LatencySeconds: number; // target < 5.0s
  rollbackTriggersViolated: 0;
  materialDefectsEncountered: 0;
  releaseCandidateAccepted: boolean;
}
```

## Fan-out plan

- **Archetype:** Archetype F (Guarded Release Observation and Stability)
- **Lanes:**
  | Lane | Role | Mode | Owned paths | Deliverable |
  |---|---|---|---|---|
  | Lane 1 | impl-lane | CODE | `docs/stage54/**` | Observation plan and telemetry report |
  | Lane 2 | impl-lane | CODE | `scripts/release/observation-runner.mjs,scripts/release/rollback-guard.mjs` | Observation runner and rollback guard |
  | Lane 3 | test-author | CODE | `tests/stage54Observation.test.mjs` | Observation verification test suite |
- **Shared files:** None

## Acceptance evidence

| Fact | Proving command/artifact | Expected outcome | Status | Evidence path |
|---|---|---|---|---|
| Fact 1: Observation plan defines workload, metrics, and rollback triggers | `node -e "assert(fs.existsSync('docs/stage54/observation-plan.md'))"` | Plan establishes 200-document workload and threshold triggers | pending | `automation/runs/stage-54/plan-audit.json` |
| Fact 2: Observation runner executes continuous workload with telemetry | `node -e "assert(fs.existsSync('scripts/release/observation-runner.mjs'))"` | Runner executes steady ingestion and logs metrics | pending | `automation/runs/stage-54/runner-audit.json` |
| Fact 3: Rollback guard monitors thresholds and asserts zero violations | `node --test tests/stage54Observation.test.mjs` | Zero rollback triggers violated during observation run | pending | `automation/runs/stage-54/guard-audit.json` |
| Fact 4: Guarded release observation test suite passes | `node --test tests/stage54Observation.test.mjs` | All observation assertions pass with exit code 0 | pending | `automation/runs/stage-54/test-summary.json` |

## Tests

### Negative test cases
- Simulated error spike exceeding 2% immediately trips rollback trigger in test.
- Process crash during observation records defect and halts qualification.

### Boundary test cases
- 200 documents process continuously with error rate strictly < 1.0%.
- p95 processing latency remains strictly < 5.0 seconds throughout observation.

### Interruption and recovery test cases
- Observation runner handles graceful shutdown on SIGINT without corrupting telemetry.
- Telemetry metrics checkpointed to disk every 60 seconds.

### Security and isolation test cases
- Observation runner runs under standard production security permissions.
- Zero leaked credentials in observation log streams.

## Dependencies

### Upstream prerequisites
- Stage 43 (Evidence-backed pilot gate): Pilot readiness baseline.
- Stage 48 (Customer activation/entitlements): Entitlements active.
- Stage 52 (Traceable controlled releases): Release candidate artifact.
- Stage 53 (Transferable support/incident operations): Operational monitoring.

### Downstream consumers
- Stage 55 (Final 99/100 release decision): Observation results submitted to final decision.

## External gates

- **External blocker:** None
- **Automated local test harness:** Automated observation runner executing sustained synthetic batch workloads
- **Owner sign-off item:** None

## Risks and known defects

- Risk 1: Flaky network conditions during observation triggering false rollback alarm.
- Known defect 1: No continuous observation runner currently exists in codebase.

## Completion draft (S0–S8)

### S0 Reconcile
- Audit release candidate artifact and observation requirements. (DRAFT — NOT EVIDENCED)

### S1 Plan
- Draft observation workload plan and rollback trigger thresholds. (DRAFT — NOT EVIDENCED)

### S2 Build
- Author `observation-plan.md`, `observation-runner.mjs`, `rollback-guard.mjs`, and tests. (DRAFT — NOT EVIDENCED)

### S3 Gate
- Execute observation test suite via `npm test`. (DRAFT — NOT EVIDENCED)

### S4 Independent review
- Independent review audits zero rollback violations and telemetry truthfulness. (DRAFT — NOT EVIDENCED)

### S5 Correction
- Freeze observation report. (DRAFT — NOT EVIDENCED)

### S6 Stage-exit checklist
- Stage-exit checklist verification. (DRAFT — NOT EVIDENCED)

### S7 Record and promote
- Record promotion evidence. (DRAFT — NOT EVIDENCED)

### S8 Advance
- Advance to Stage 55. (DRAFT — NOT EVIDENCED)


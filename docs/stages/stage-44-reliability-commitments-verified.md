---
stage: 44
slug: reliability-commitments-verified
title: Reliability commitments verified
status: not-started
depends_on: [40,41,43]
blocks: [53,55]
weight_area: persistence-recovery
external_gates: []
charter_lines: "174-175"
gate_quote_sha256: "53f70400f26c2dee1523f7ddbc5c75220cde4af27fbbcf9849eeea09cf9afd32"
evidence_dir: automation/runs/stage-44
last_reconciled: 2026-09-13
---

# Stage 44 — Reliability commitments verified



## Charter gate (verbatim)

> Test promised host/worker/database/storage/network/vendor failure tolerance and capacity/maintenance procedures. Gate: actual architecture and staffing support commitments; no invented redundancy or uptime claims.

## Verified current state

- Stage 3 (Architecture and failure model) established: Established component topology (Express server, transactional SQLite, Python OCR worker) and formal failure state machine with bounded worker lease reclaims and non-ephemeral job transitions (types: JobStatus (`docs/stage3/authoritative-contracts.md:15`), FailureTransition (`docs/stage3/authoritative-contracts.md:42`), ComponentTopology (`docs/stage3/component-topology.md:1`)).
- Stage 4 (Truthful demonstration/live separation) established: Isolated simulated demo routes and mock fixtures behind explicit environment flags (DEMO_MODE=false), ensuring live OCR pipelines operate against real extractors (types: ServiceAvailabilityResponse (`src/types.ts:177`), DemoIsolationConfig (`server/routes/demoGuard.ts:1`), LivePipelineGuard (`server/routes/demoGuard.ts:1`)).
- Stage 5 (Reproducible dependencies) established: Pinned Node.js, Python 3.10+, and native OCR runtime dependencies in lockfiles with reproducible local build environments (types: PinnedDependency (`src/types.ts:185`), RuntimeDependencyManifest (`package.json:1`), FieldCategory (`src/types.ts:6`)).
- Stage 6 (Build and startup corrections) established: Guaranteed clean headless application startup with health probes and zero-downtime hot reloading (types: ServerLifecycleConfig (`src/types.ts:223`), HealthCheckResponse (`server/health.ts:1`), StartupProbeConfig (`server/health.ts:1`)).
- Stage 7 (Trustworthy automated checks) established: Established trustworthy automated testing harness with fast feedback loops, flake detection, and concurrent gate verification (types: TestSuiteResult (`docs/stages/stage-07-trustworthy-automated-checks.md:1`), GateVerificationResult (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`), TestHarnessConfig (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`)).
- `PROJECT_CHARTER.md:174-175`: Test promised host/worker/database/storage/network/vendor failure tolerance and capacity/maintenance procedures. Actual architecture and staffing support commitments; no invented redundancy or uptime claims.
- Reliability boundaries: Single-host architecture promises no 24/7 uptime SLA, but commits to automatic crash restart and recovery within 4 hours.
- Process supervisor missing: Need verified configuration (PM2 / systemd / supervisord) restarting server and worker on crash.

## Scope

### In scope
- Process supervisor configuration (PM2 / systemd service units) enforcing automatic restart on unhandled crash.
- Maintenance procedures: clean database compaction, log rotation, and storage defragmentation.
- Vendor failure tolerance: handling external Drive API outages without taking down local application processing.
- Honest reliability documentation: explicit single-host recovery targets (RTO < 4h, RPO < 24h).

### Out of scope
- Multi-region high-availability clustering (charter assumption 13: single host deployment).
- Round-the-clock 24/7 staffing commitments.

### Explicitly not promised
- 99.99% high availability SLA.

## Work breakdown

1. **Task 1: Process Supervisor Configuration and Crash Restart Manager**
   - Description: Configure PM2 / systemd unit files with automatic restart, max memory restarts, and exponential backoff.
   - Owned paths: `deploy/ecosystem.config.cjs,deploy/ocrdocs.service`
   - Target acceptance fact: Fact 1: Process supervisor configures crash restart policy

2. **Task 2: Scheduled Maintenance and Log Rotation Runbook**
   - Description: Implement maintenance runbooks for database vacuum, WAL compaction, and log archiving.
   - Owned paths: `scripts/ops/maintenance.mjs,docs/runbooks/maintenance.md`
   - Target acceptance fact: Fact 2: Maintenance runbooks automate database compaction and rotation

3. **Task 3: Vendor Dependency Outage Resilience Test**
   - Description: Simulate complete Google Drive and cloud OCR outage; verify local processing remains 100% functional.
   - Owned paths: `tests/resilience/vendorOutage.test.mjs`
   - Target acceptance fact: Fact 3: Vendor outage resilience test confirms local isolation

4. **Task 4: Reliability Commitment Verification Suite**
   - Description: Author automated tests verifying process restart signaling, maintenance execution, and local autonomy.
   - Owned paths: `tests/stage44Reliability.test.mjs`
   - Target acceptance fact: Fact 4: Reliability commitment test suite passes

## Contracts to freeze

```typescript
export interface ReliabilityCommitment {
  deploymentTopology: 'single_host';
  processSupervisor: 'systemd' | 'pm2';
  maxRestartAttempts: 5;
  restartDelayMs: 2000;
  recoveryTimeObjectiveHours: 4;
  recoveryPointObjectiveHours: 24;
  vendorOutageImpact: 'local_processing_unaffected';
}
```

## Fan-out plan

- **Archetype:** Archetype F (Reliability and Operations Hardening)
- **Lanes:**
  | Lane | Role | Mode | Owned paths | Deliverable |
  |---|---|---|---|---|
  | Lane 1 | impl-lane | CODE | `deploy/**` | Process supervisor configurations |
  | Lane 2 | impl-lane | CODE | `scripts/ops/**,docs/runbooks/**` | Maintenance tools and runbooks |
  | Lane 3 | test-author | CODE | `tests/stage44Reliability.test.mjs,tests/resilience/**` | Resilience and reliability test suites |
- **Shared files:** None

## Acceptance evidence

| Fact | Proving command/artifact | Expected outcome | Status | Evidence path |
|---|---|---|---|---|
| Fact 1: Process supervisor configures crash restart policy | `node -e "assert(fs.existsSync('deploy/ecosystem.config.cjs'))"` | Configuration defines automatic restart and memory limits | pending | `automation/runs/stage-44/supervisor-audit.json` |
| Fact 2: Maintenance runbooks automate database compaction and rotation | `node -e "assert(fs.existsSync('scripts/ops/maintenance.mjs'))"` | Maintenance script executes VACUUM and WAL checkpoints | pending | `automation/runs/stage-44/maintenance-audit.json` |
| Fact 3: Vendor outage resilience test confirms local isolation | `node --test tests/resilience/vendorOutage.test.mjs` | Local document processing functions with zero external dependencies | pending | `automation/runs/stage-44/outage-audit.json` |
| Fact 4: Reliability commitment test suite passes | `node --test tests/stage44Reliability.test.mjs` | All reliability commitment tests exit 0 | pending | `automation/runs/stage-44/test-summary.json` |

## Tests

### Negative test cases
- Simulated DNS failure for Google APIs does not block local upload or extraction.
- Continuous process crash loop throttled by restart backoff to prevent CPU spin.

### Boundary test cases
- Maintenance vacuum executes without interrupting read queries.
- Process restarts within 3 seconds of unhandled fatal exception.

### Interruption and recovery test cases
- Maintenance job interrupted by shutdown leaves database in consistent state.
- Supervisor preserves error logs across process restarts.

### Security and isolation test cases
- Process supervisor executes with non-root service account.
- Maintenance scripts run with restricted filesystem permissions.

## Dependencies

### Upstream prerequisites
- Stage 40 (Capacity, resource and cost evidence): Capacity baseline.
- Stage 41 (Tested backup/restore/rollback): Backup and restore mechanisms.
- Stage 43 (Evidence-backed pilot gate): Pilot readiness baseline.

### Downstream consumers
- Stage 53 (Transferable support/incident operations): Operational runbooks.
- Stage 55 (Final 99/100 release decision): Reliability evidence for release score.

## External gates

- **External blocker:** None
- **Automated local test harness:** Automated test suite simulating vendor outages and testing process supervisor configs
- **Owner sign-off item:** None

## Risks and known defects

- Risk 1: Flapping process restart loop if database file is physically corrupted.
- Known defect 1: No process manager configuration currently bundled in repository.

## Completion draft (S0–S8)

### S0 Reconcile
- Audit system supervisor requirements and vendor dependencies. (DRAFT — NOT EVIDENCED)

### S1 Plan
- Draft process supervisor configuration and maintenance architecture. (DRAFT — NOT EVIDENCED)

### S2 Build
- Author `ecosystem.config.cjs`, `maintenance.mjs`, runbooks, and tests. (DRAFT — NOT EVIDENCED)

### S3 Gate
- Execute reliability test suite via `npm test`. (DRAFT — NOT EVIDENCED)

### S4 Independent review
- Independent review audits vendor outage resilience and restart limits. (DRAFT — NOT EVIDENCED)

### S5 Correction
- Tune restart delays and memory thresholds. (DRAFT — NOT EVIDENCED)

### S6 Stage-exit checklist
- Stage-exit checklist verification. (DRAFT — NOT EVIDENCED)

### S7 Record and promote
- Record promotion evidence. (DRAFT — NOT EVIDENCED)

### S8 Advance
- Advance to Stage 45. (DRAFT — NOT EVIDENCED)


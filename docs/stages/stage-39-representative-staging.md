---
stage: 39
slug: representative-staging
title: Representative staging
status: not-started
depends_on: [38]
blocks: [40,41,43]
weight_area: tests-deployment-operations
external_gates: []
charter_lines: "159-160"
gate_quote_sha256: "0a296d0bd8a74752c76f51a674186deaa67eb19cf0d20f7c31636644ed53a917"
evidence_dir: automation/runs/stage-39
last_reconciled: 2026-09-13
---

# Stage 39 — Representative staging



## Charter gate (verbatim)

> Deploy the release artifact with actual worker/storage/network/permission/readiness configuration. Gate: recreation, credential rotation, missing dependencies, stopped workers and full storage behave correctly without hidden setup or production data.

## Verified current state

- Stage 3 (Architecture and failure model) established: Established component topology (Express server, transactional SQLite, Python OCR worker) and formal failure state machine with bounded worker lease reclaims and non-ephemeral job transitions (types: JobStatus (`docs/stage3/authoritative-contracts.md:15`), FailureTransition (`docs/stage3/authoritative-contracts.md:42`), ComponentTopology (`docs/stage3/component-topology.md:1`)).
- Stage 4 (Truthful demonstration/live separation) established: Isolated simulated demo routes and mock fixtures behind explicit environment flags (DEMO_MODE=false), ensuring live OCR pipelines operate against real extractors (types: ServiceAvailabilityResponse (`src/types.ts:177`), DemoIsolationConfig (`server/routes/demoGuard.ts:1`), LivePipelineGuard (`server/routes/demoGuard.ts:1`)).
- Stage 5 (Reproducible dependencies) established: Pinned Node.js, Python 3.10+, and native OCR runtime dependencies in lockfiles with reproducible local build environments (types: PinnedDependency (`src/types.ts:185`), RuntimeDependencyManifest (`package.json:1`), FieldCategory (`src/types.ts:6`)).
- Stage 6 (Build and startup corrections) established: Guaranteed clean headless application startup with health probes and zero-downtime hot reloading (types: ServerLifecycleConfig (`src/types.ts:223`), HealthCheckResponse (`server/health.ts:1`), StartupProbeConfig (`server/health.ts:1`)).
- Stage 7 (Trustworthy automated checks) established: Established trustworthy automated testing harness with fast feedback loops, flake detection, and concurrent gate verification (types: TestSuiteResult (`docs/stages/stage-07-trustworthy-automated-checks.md:1`), GateVerificationResult (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`), TestHarnessConfig (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`)).
- `PROJECT_CHARTER.md:159-160`: Deploy the release artifact with actual worker/storage/network/permission/readiness configuration. Recreation, credential rotation, missing dependencies, stopped workers, and full storage behave correctly without hidden setup or production data.
- Development vs production setup: Application currently runs via `npm run dev` with development env defaults; production staging container / configuration not formalized.
- Readiness probe missing: No dedicated health and readiness endpoint (`GET /api/health/ready`) verifies database, storage, and worker availability before traffic routing.

## Scope

### In scope
- Production staging deployment manifest (Dockerfile / docker-compose.yml / single-host systemd service).
- Readiness probe endpoint (`GET /api/health/ready`) validating database connectivity, storage write permissions, and worker process health.
- Configuration validation: system fails fast on missing production environment variables or unreadable storage paths.
- Clean recreation verification: automated staging deployment test spinning up fresh environment from scratch.

### Out of scope
- Kubernetes Helm chart deployments (single-host deployment scope).
- Multi-region traffic routing.

### Explicitly not promised
- Automated zero-downtime database schema migration during live container swap.

## Work breakdown

1. **Task 1: Production Staging Container and Environment Manifest**
   - Description: Author Dockerfile and docker-compose.staging.yml configuring Node, Python, Tesseract, and private storage.
   - Owned paths: `deploy/Dockerfile,deploy/docker-compose.staging.yml`
   - Target acceptance fact: Fact 1: Staging deployment manifests configure production environment

2. **Task 2: Comprehensive Readiness and Health Check Endpoint**
   - Description: Implement GET /api/health/ready inspecting database, storage volume write access, and OCR worker binary.
   - Owned paths: `server/routes/healthRoutes.ts`
   - Target acceptance fact: Fact 2: Readiness endpoint validates database, storage, and worker

3. **Task 3: Staging Deployment Recreation and Health Script**
   - Description: Implement automation script deploying staging container, verifying readiness, and rotating test secrets.
   - Owned paths: `scripts/deploy/verify-staging.mjs`
   - Target acceptance fact: Fact 3: Staging verification script executes clean deployment drill

4. **Task 4: Staging Configuration and Readiness Test Suite**
   - Description: Author automated tests verifying readiness probe behavior under degraded conditions (stopped worker, read-only disk).
   - Owned paths: `tests/stage39Staging.test.mjs`
   - Target acceptance fact: Fact 4: Staging readiness and configuration test suite passes

## Contracts to freeze

```typescript
export interface ReadinessCheckResult {
  status: 'ready' | 'degraded' | 'not_ready';
  checks: {
    database: { status: 'pass' | 'fail'; latencyMs: number };
    storage: { status: 'pass' | 'fail'; writable: boolean; freeBytes: number };
    worker: { status: 'pass' | 'fail'; engineVersion: string };
  };
  uptimeSeconds: number;
}
```

## Fan-out plan

- **Archetype:** Archetype F (Deployment Configuration and Staging Verification)
- **Lanes:**
  | Lane | Role | Mode | Owned paths | Deliverable |
  |---|---|---|---|---|
  | Lane 1 | impl-lane | CODE | `deploy/**` | Staging Dockerfile and Compose manifest |
  | Lane 2 | impl-lane | CODE | `server/routes/healthRoutes.ts` | Readiness and liveness endpoints |
  | Lane 3 | test-author | CODE | `tests/stage39Staging.test.mjs,scripts/deploy/**` | Staging recreation verification tests |
- **Shared files:** None

## Acceptance evidence

| Fact | Proving command/artifact | Expected outcome | Status | Evidence path |
|---|---|---|---|---|
| Fact 1: Staging deployment manifests configure production environment | `node -e "assert(fs.existsSync('deploy/Dockerfile'))"` | Dockerfile pins Node, Python, and system OCR dependencies | pending | `automation/runs/stage-39/manifest-audit.json` |
| Fact 2: Readiness endpoint validates database, storage, and worker | `node --test tests/stage39Staging.test.mjs` | Readiness check returns 200 with structured component statuses | pending | `automation/runs/stage-39/readiness-audit.json` |
| Fact 3: Staging verification script executes clean deployment drill | `node scripts/deploy/verify-staging.mjs --dry-run` | Deployment validation confirms clean startup and config parsing | pending | `automation/runs/stage-39/drill-audit.json` |
| Fact 4: Staging readiness and configuration test suite passes | `node --test tests/stage39Staging.test.mjs` | All staging readiness and degradation tests exit 0 | pending | `automation/runs/stage-39/test-summary.json` |

## Tests

### Negative test cases
- Starting with unreadable storage directory marks readiness check as fail and returns 503.
- Stopped OCR worker process marks worker check as fail and surfaces degraded status.

### Boundary test cases
- Storage with < 100MB free disk space flags warning status.
- Database response latency > 500ms flags database degraded.

### Interruption and recovery test cases
- Credential rotation in environment reloads configuration without full data loss.
- Recreating staging container from clean volume runs migrations automatically.

### Security and isolation test cases
- Readiness probe omits connection strings and passwords from public JSON output.
- Staging runs with zero real customer production data.

## Dependencies

### Upstream prerequisites
- Stage 38 (Full workflow and test-effectiveness checks): Validates system before staging.

### Downstream consumers
- Stage 40 (Capacity, resource and cost evidence): Benchmark runs in staging environment.
- Stage 41 (Tested backup/restore/rollback): Backup drills executed in staging.
- Stage 43 (Evidence-backed pilot gate): Staging evidence required for pilot gate.

## External gates

- **External blocker:** None
- **Automated local test harness:** Automated test suite simulating component failures and verifying readiness HTTP status
- **Owner sign-off item:** None

## Risks and known defects

- Risk 1: Docker daemon availability on Windows host systems during autonomous runs.
- Known defect 1: `server.ts:37` contains trivial `/health` endpoint returning hardcoded `{ status: "ok" }`.

## Completion draft (S0–S8)

### S0 Reconcile
- Audit deployment requirements and health endpoints. (DRAFT — NOT EVIDENCED)

### S1 Plan
- Draft staging manifest architecture and readiness probe contract. (DRAFT — NOT EVIDENCED)

### S2 Build
- Author `Dockerfile`, `docker-compose.staging.yml`, `healthRoutes.ts`, and test suite. (DRAFT — NOT EVIDENCED)

### S3 Gate
- Execute staging test suite via `npm test`. (DRAFT — NOT EVIDENCED)

### S4 Independent review
- Independent review audits clean recreation and fail-fast configuration. (DRAFT — NOT EVIDENCED)

### S5 Correction
- Tune health check latency thresholds. (DRAFT — NOT EVIDENCED)

### S6 Stage-exit checklist
- Stage-exit checklist verification. (DRAFT — NOT EVIDENCED)

### S7 Record and promote
- Record promotion evidence. (DRAFT — NOT EVIDENCED)

### S8 Advance
- Advance to Stage 40. (DRAFT — NOT EVIDENCED)


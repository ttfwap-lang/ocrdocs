---
stage: 32
slug: defined-operational-metrics
title: Defined operational metrics
status: not-started
depends_on: [22,26]
blocks: [33,40]
weight_area: interface-workflow
external_gates: []
charter_lines: "138-139"
gate_quote_sha256: "5d2ad138d68bf9a8e8d57bb678e19ed71923f014665326c22b8a01c55aeb7731"
evidence_dir: automation/runs/stage-32
last_reconciled: 2026-09-13
---

# Stage 32 — Defined operational metrics



## Charter gate (verbatim)

> Distinguish documents/pages/jobs/attempts/retries and specify denominators/freshness. Gate: dashboards reconcile after failure/deletion/retry and completeness is not called recall without ground truth.

## Verified current state

- Stage 3 (Architecture and failure model) established: Established component topology (Express server, transactional SQLite, Python OCR worker) and formal failure state machine with bounded worker lease reclaims and non-ephemeral job transitions (types: JobStatus (`docs/stage3/authoritative-contracts.md:15`), FailureTransition (`docs/stage3/authoritative-contracts.md:42`), ComponentTopology (`docs/stage3/component-topology.md:1`)).
- Stage 4 (Truthful demonstration/live separation) established: Isolated simulated demo routes and mock fixtures behind explicit environment flags (DEMO_MODE=false), ensuring live OCR pipelines operate against real extractors (types: ServiceAvailabilityResponse (`src/types.ts:177`), DemoIsolationConfig (`server/routes/demoGuard.ts:1`), LivePipelineGuard (`server/routes/demoGuard.ts:1`)).
- Stage 5 (Reproducible dependencies) established: Pinned Node.js, Python 3.10+, and native OCR runtime dependencies in lockfiles with reproducible local build environments (types: PinnedDependency (`src/types.ts:185`), RuntimeDependencyManifest (`package.json:1`), FieldCategory (`src/types.ts:6`)).
- Stage 6 (Build and startup corrections) established: Guaranteed clean headless application startup with health probes and zero-downtime hot reloading (types: ServerLifecycleConfig (`src/types.ts:223`), HealthCheckResponse (`server/health.ts:1`), StartupProbeConfig (`server/health.ts:1`)).
- Stage 7 (Trustworthy automated checks) established: Established trustworthy automated testing harness with fast feedback loops, flake detection, and concurrent gate verification (types: TestSuiteResult (`docs/stages/stage-07-trustworthy-automated-checks.md:1`), GateVerificationResult (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`), TestHarnessConfig (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`)).
- `PROJECT_CHARTER.md:138-139`: Distinguish documents/pages/jobs/attempts/retries and specify denominators/freshness. Dashboards reconcile after failure/deletion/retry and completeness is not called recall without ground truth.
- `server.ts:260-275`: `GET /api/dgx/telemetry-report` generates random fake metrics using `Math.random()`.
- Metric confusion: Existing code conflates document count with page count and has no durable counters.
- Denominator clarity: No distinction between attempted extractions and verified ground truth.

## Scope

### In scope
- Operational telemetry engine tracking exact counts: documents ingested, pages processed, OCR duration p50/p95/p99, queue latency, retry rate, review burden.
- Durable metrics collection in SQLite (`metrics_counters`, `metrics_histograms`).
- Structured telemetry API `GET /api/telemetry/metrics` replacing simulated DGX endpoint.
- Clear denominator disclosure: field extraction rate = extracted fields / expected fields; review burden = modified fields / total fields.

### Out of scope
- External Prometheus / Grafana agent deployment (endpoint provides Prometheus-compatible text format).
- Marketing vanity metric dashboards.

### Explicitly not promised
- Claiming 100% extraction recall without evaluated ground truth.

## Work breakdown

1. **Task 1: Durable Metrics Aggregator Service**
   - Description: Implement MetricsCollector recording real counters and latency histograms in SQLite.
   - Owned paths: `server/metrics/metricsCollector.ts`
   - Target acceptance fact: Fact 1: Metrics collector aggregates real operational counters

2. **Task 2: Replace Simulated Telemetry Endpoint**
   - Description: Deprecate Math.random() telemetry in server.ts and expose GET /api/telemetry/metrics.
   - Owned paths: `server/routes/metricRoutes.ts`
   - Target acceptance fact: Fact 2: Real metrics API replaces simulated telemetry

3. **Task 3: Operational Metrics React Dashboard**
   - Description: Update AuditAndEngineView to render real p50/p95 latency and processing rates.
   - Owned paths: `src/components/AuditAndEngineView.tsx`
   - Target acceptance fact: Fact 3: UI dashboard displays real operational metrics

4. **Task 4: Metrics Accuracy and Reconciliation Test Suite**
   - Description: Author automated tests verifying that metrics reconcile accurately after document deletion and retries.
   - Owned paths: `tests/stage32Metrics.test.mjs`
   - Target acceptance fact: Fact 4: Metrics reconciliation test suite passes

## Contracts to freeze

```typescript
export interface OperationalMetricsSnapshot {
  timestamp: string;
  totalDocuments: number;
  totalPages: number;
  totalJobs: number;
  totalRetries: number;
  activeJobs: number;
  latencyMs: { p50: number; p90: number; p99: number };
  reviewBurdenRate: number; // modified / total
  systemMemoryBytes: number;
}
```

## Fan-out plan

- **Archetype:** Archetype E (Telemetry and Metrics Dashboard)
- **Lanes:**
  | Lane | Role | Mode | Owned paths | Deliverable |
  |---|---|---|---|---|
  | Lane 1 | impl-lane | CODE | `server/metrics/**` | Metrics collector service |
  | Lane 2 | impl-lane | CODE | `server/routes/metricRoutes.ts` | Metrics API endpoints |
  | Lane 3 | impl-lane | CODE | `src/components/AuditAndEngineView.tsx` | React metrics dashboard update |
  | Lane 4 | test-author | CODE | `tests/stage32Metrics.test.mjs` | Metrics accuracy test suite |
- **Shared files:** server.ts

## Acceptance evidence

| Fact | Proving command/artifact | Expected outcome | Status | Evidence path |
|---|---|---|---|---|
| Fact 1: Metrics collector aggregates real operational counters | `node -e "assert(fs.existsSync('server/metrics/metricsCollector.ts'))"` | Collector records timings and counters accurately | pending | `automation/runs/stage-32/collector-audit.json` |
| Fact 2: Real metrics API replaces simulated telemetry | `node --test tests/stage32Metrics.test.mjs` | Endpoint returns real non-random metrics | pending | `automation/runs/stage-32/api-audit.json` |
| Fact 3: UI dashboard displays real operational metrics | `node -e "assert(fs.existsSync('src/components/AuditAndEngineView.tsx'))"` | Dashboard component renders real metric values | pending | `automation/runs/stage-32/ui-audit.json` |
| Fact 4: Metrics reconciliation test suite passes | `node --test tests/stage32Metrics.test.mjs` | Counters reconcile exactly after operations | pending | `automation/runs/stage-32/test-summary.json` |

## Tests

### Negative test cases
- Deleting document decrements total active documents counter correctly.
- Failed job increments failure counter without distorting completed counts.

### Boundary test cases
- Initial state with 0 documents reports 0 across all counters without NaN errors.
- p99 latency calculated accurately over sample of 100 timings.

### Interruption and recovery test cases
- Server restart preserves accumulated durable counters in SQLite.
- Metric scrape during heavy load executes in under 5ms.

### Security and isolation test cases
- Metrics endpoint requires authentication or internal network guard.
- Zero customer names or document content exposed in metric label dimensions.

## Dependencies

### Upstream prerequisites
- Stage 22 (Genuine progress/error streaming): Event bus reports timing metrics.
- Stage 26 (Real document/result interface): Dashboard integrated into UI.

### Downstream consumers
- Stage 33 (Controlled overload and quotas): Uses metrics for quota enforcement.
- Stage 40 (Capacity, resource and cost evidence): Relies on operational metrics.

## External gates

- **External blocker:** None
- **Automated local test harness:** Automated test suite asserting counter math and latency percentile calculations
- **Owner sign-off item:** None

## Risks and known defects

- Risk 1: High metric collection overhead impacting request latency.
- Known defect 1: `server.ts:264` generates fake telemetry via `Math.random() * 500`.

## Completion draft (S0–S8)

### S0 Reconcile
- Audit telemetry endpoints and remove Math.random() calls. (DRAFT — NOT EVIDENCED)

### S1 Plan
- Draft metrics schema and percentile calculation algorithms. (DRAFT — NOT EVIDENCED)

### S2 Build
- Author `metricsCollector.ts`, `metricRoutes.ts`, update UI view, and write tests. (DRAFT — NOT EVIDENCED)

### S3 Gate
- Execute metrics test suite via `npm test`. (DRAFT — NOT EVIDENCED)

### S4 Independent review
- Independent review audits denominator clarity and reconciliation accuracy. (DRAFT — NOT EVIDENCED)

### S5 Correction
- Tune histogram bucket boundaries. (DRAFT — NOT EVIDENCED)

### S6 Stage-exit checklist
- Stage-exit checklist verification. (DRAFT — NOT EVIDENCED)

### S7 Record and promote
- Record promotion evidence. (DRAFT — NOT EVIDENCED)

### S8 Advance
- Advance to Stage 33. (DRAFT — NOT EVIDENCED)


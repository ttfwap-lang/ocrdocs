---
stage: 40
slug: capacity-resource-and-cost-evidence
title: Capacity, resource and cost evidence
status: not-started
depends_on: [32,33,39]
blocks: [43,44]
weight_area: tests-deployment-operations
external_gates: ["target-hardware-environment"]
charter_lines: "162-163"
gate_quote_sha256: "528316d8ea89e1d19741b30ba136c6d1e87f92cc7f49b49fa2673edc4dfeb6ce"
evidence_dir: automation/runs/stage-40
last_reconciled: 2026-09-13
---

# Stage 40 — Capacity, resource and cost evidence



## Charter gate (verbatim)

> Measure queue delay, latency distribution, throughput, failures, memory/storage and cost on target hardware/document mix. Gate: cold/repeated/large/difficult/retry/sustained workloads establish honest limits including human-review cost.

## Verified current state

- Stage 3 (Architecture and failure model) established: Established component topology (Express server, transactional SQLite, Python OCR worker) and formal failure state machine with bounded worker lease reclaims and non-ephemeral job transitions (types: JobStatus (`docs/stage3/authoritative-contracts.md:15`), FailureTransition (`docs/stage3/authoritative-contracts.md:42`), ComponentTopology (`docs/stage3/component-topology.md:1`)).
- Stage 4 (Truthful demonstration/live separation) established: Isolated simulated demo routes and mock fixtures behind explicit environment flags (DEMO_MODE=false), ensuring live OCR pipelines operate against real extractors (types: ServiceAvailabilityResponse (`src/types.ts:177`), DemoIsolationConfig (`server/routes/demoGuard.ts:1`), LivePipelineGuard (`server/routes/demoGuard.ts:1`)).
- Stage 5 (Reproducible dependencies) established: Pinned Node.js, Python 3.10+, and native OCR runtime dependencies in lockfiles with reproducible local build environments (types: PinnedDependency (`src/types.ts:185`), RuntimeDependencyManifest (`package.json:1`), FieldCategory (`src/types.ts:6`)).
- Stage 6 (Build and startup corrections) established: Guaranteed clean headless application startup with health probes and zero-downtime hot reloading (types: ServerLifecycleConfig (`src/types.ts:223`), HealthCheckResponse (`server/health.ts:1`), StartupProbeConfig (`server/health.ts:1`)).
- Stage 7 (Trustworthy automated checks) established: Established trustworthy automated testing harness with fast feedback loops, flake detection, and concurrent gate verification (types: TestSuiteResult (`docs/stages/stage-07-trustworthy-automated-checks.md:1`), GateVerificationResult (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`), TestHarnessConfig (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`)).
- `PROJECT_CHARTER.md:162-163`: Measure queue delay, latency distribution, throughput, failures, memory/storage, and cost on target hardware/document mix. Cold/repeated/large/difficult/retry workloads establish honest limits including human-review cost.
- Capacity limits unmeasured: Application resource consumption under sustained load (e.g. 50 documents, 250 pages) has not been benchmarked.
- Memory leakage risk: Python worker subprocess and Node.js server memory footprint over 1,000 requests unverified.
- Operator cost model: No empirical estimate exists for human review duration per document.

## Scope

### In scope
- Empirical capacity benchmarking: measure throughput (pages/min), p50/p95 latency, and CPU/RAM usage under sustained load.
- Memory leak detection: execute 100 sequential extraction requests and assert RSS memory delta < 50MB.
- Economic cost model documenting CPU hours, storage cost, and human operator review time per 1,000 documents.
- Automated local load generator harness simulating sustained batch workloads.

### Out of scope
- GPU-accelerated DGX cluster benchmarking (external gate; local CPU harness sufficient for autonomous loop).
- Multi-host distributed load testing.

### Explicitly not promised
- 100 pages per minute throughput on low-spec single-core virtual machines.

## Work breakdown

1. **Task 1: Automated Batch Workload Load Generator**
   - Description: Implement load generator executing batch document ingestion across cold, large, and retry workloads.
   - Owned paths: `scripts/capacity/loadGenerator.mjs`
   - Target acceptance fact: Fact 1: Load generator executes synthetic batch workloads

2. **Task 2: Resource and Memory Profiler**
   - Description: Implement process memory and CPU monitor sampling metrics during benchmark runs.
   - Owned paths: `scripts/capacity/resourceMonitor.mjs`
   - Target acceptance fact: Fact 2: Resource monitor tracks process memory and CPU utilization

3. **Task 3: Capacity and Cost Model Report Formulation**
   - Description: Calculate operational cost model (CPU sec/doc, disk MB/doc, operator min/doc) and document limits.
   - Owned paths: `docs/stage40/capacity-cost-report.md`
   - Target acceptance fact: Fact 3: Capacity and cost model establishes honest operational limits

4. **Task 4: Capacity and Memory Stability Test Suite**
   - Description: Author automated test asserting zero memory leakage (<50MB growth over 100 requests) and bounded latency.
   - Owned paths: `tests/stage40Capacity.test.mjs`
   - Target acceptance fact: Fact 4: Capacity stability test suite passes

## Contracts to freeze

```typescript
export interface CapacityBenchmarkReport {
  targetHardware: string;
  totalDocuments: number;
  totalPages: number;
  durationSeconds: number;
  throughputPagesPerMinute: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  peakMemoryMb: number;
  memoryGrowthDeltaMb: number;
  estimatedCostPer1000Docs: {
    computeHours: number;
    storageGbMonths: number;
    operatorReviewHours: number;
  };
}
```

## Fan-out plan

- **Archetype:** Archetype F (Capacity Benchmarking and Cost Modeling)
- **Lanes:**
  | Lane | Role | Mode | Owned paths | Deliverable |
  |---|---|---|---|---|
  | Lane 1 | impl-lane | CODE | `scripts/capacity/**` | Load generator and resource monitor |
  | Lane 2 | impl-lane | CODE | `docs/stage40/**` | Capacity and cost model documentation |
  | Lane 3 | test-author | CODE | `tests/stage40Capacity.test.mjs` | Memory stability test suite |
- **Shared files:** None

## Acceptance evidence

| Fact | Proving command/artifact | Expected outcome | Status | Evidence path |
|---|---|---|---|---|
| Fact 1: Load generator executes synthetic batch workloads | `node -e "assert(fs.existsSync('scripts/capacity/loadGenerator.mjs'))"` | Load generator script generates configurable concurrent load | pending | `automation/runs/stage-40/generator-audit.json` |
| Fact 2: Resource monitor tracks process memory and CPU utilization | `node -e "assert(fs.existsSync('scripts/capacity/resourceMonitor.mjs'))"` | Monitor records RSS memory and CPU ticks accurately | pending | `automation/runs/stage-40/monitor-audit.json` |
| Fact 3: Capacity and cost model establishes honest operational limits | `node -e "assert(fs.existsSync('docs/stage40/capacity-cost-report.md'))"` | Report documents hardware specs, throughput, and operator cost | pending | `automation/runs/stage-40/cost-audit.json` |
| Fact 4: Capacity stability test suite passes | `node --test tests/stage40Capacity.test.mjs` | 100 requests complete without memory leak (<50MB delta) | pending | `automation/runs/stage-40/test-summary.json` |

## Tests

### Negative test cases
- Memory growth exceeding 50MB across 100 requests fails test with MemoryLeakDetected.
- Sustained CPU pegged at 100% for >120s triggers throttling.

### Boundary test cases
- Single large 50-page document processes within peak memory ceiling (<1.5GB).
- Batch of 20 documents processes with zero dropped jobs.

### Interruption and recovery test cases
- Terminating load generator midway cleanly drains active worker processes.
- Capacity benchmark produces reproducible timing numbers across runs.

### Security and isolation test cases
- Synthetic load generator uses zero customer data in test payloads.
- Resource monitoring runs without elevated administrative privileges.

## Dependencies

### Upstream prerequisites
- Stage 32 (Defined operational metrics): Provides metric counters.
- Stage 33 (Controlled overload and quotas): Enforces concurrency ceiling.
- Stage 39 (Representative staging): Executes in staging configuration.

### Downstream consumers
- Stage 43 (Evidence-backed pilot gate): Capacity report submitted to pilot gate.
- Stage 44 (Reliability commitments verified): Confirms capacity commitments.

## External gates

- **External blocker:** target-hardware-environment (dedicated multi-core GPU/DGX host for production load testing)
- **Automated local test harness:** Automated local load generator (scripts/capacity/loadGenerator.mjs) benchmarking single-host CPU execution
- **Owner sign-off item:** Owner sign-off required for enterprise capacity and hardware cost sign-off

## Risks and known defects

- Risk 1: Host machine thermal throttling causing variance in benchmark timings.
- Known defect 1: No capacity metrics or memory profiling exists in current repo.

## Completion draft (S0–S8)

### S0 Reconcile
- Audit system performance under batch document processing. (DRAFT — NOT EVIDENCED)

### S1 Plan
- Draft capacity test harness and cost estimation methodology. (DRAFT — NOT EVIDENCED)

### S2 Build
- Author `loadGenerator.mjs`, `resourceMonitor.mjs`, report, and tests. (DRAFT — NOT EVIDENCED)

### S3 Gate
- Execute capacity test suite via `npm test`. (DRAFT — NOT EVIDENCED)

### S4 Independent review
- Independent review audits memory leak calculations and operator cost model. (DRAFT — NOT EVIDENCED)

### S5 Correction
- Freeze capacity metrics. (DRAFT — NOT EVIDENCED)

### S6 Stage-exit checklist
- Stage-exit checklist verification. (DRAFT — NOT EVIDENCED)

### S7 Record and promote
- Record promotion evidence. (DRAFT — NOT EVIDENCED)

### S8 Advance
- Advance to Stage 41. (DRAFT — NOT EVIDENCED)


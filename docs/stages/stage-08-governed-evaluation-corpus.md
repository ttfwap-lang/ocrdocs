---
stage: 8
slug: governed-evaluation-corpus
title: Governed evaluation corpus
status: not-started
depends_on: [3]
blocks: [9,36,42]
weight_area: extraction-validation
external_gates: ["representative-corpus-access"]
charter_lines: "66-67"
gate_quote_sha256: "1d8a25382e1a724fa1f753afd0275ef3c8badb46616ba319f5d4a24bf4b8b98b"
evidence_dir: automation/runs/stage-08
last_reconciled: 2026-09-13
---

# Stage 8 — Governed evaluation corpus



## Charter gate (verbatim)

> Record permissions, provenance, annotation instructions, reviewed labels, corpus versions and development/held-out membership. Gate: representative coverage, duplicate leakage checks and sample adequacy support the intended claims.

## Verified current state

- Stage 3 (Architecture and failure model) established: Established component topology (Express server, transactional SQLite, Python OCR worker) and formal failure state machine with bounded worker lease reclaims and non-ephemeral job transitions (types: JobStatus (`docs/stage3/authoritative-contracts.md:15`), FailureTransition (`docs/stage3/authoritative-contracts.md:42`), ComponentTopology (`docs/stage3/component-topology.md:1`)).
- Stage 4 (Truthful demonstration/live separation) established: Isolated simulated demo routes and mock fixtures behind explicit environment flags (DEMO_MODE=false), ensuring live OCR pipelines operate against real extractors (types: ServiceAvailabilityResponse (`src/types.ts:177`), DemoIsolationConfig (`server/routes/demoGuard.ts:1`), LivePipelineGuard (`server/routes/demoGuard.ts:1`)).
- Stage 5 (Reproducible dependencies) established: Pinned Node.js, Python 3.10+, and native OCR runtime dependencies in lockfiles with reproducible local build environments (types: PinnedDependency (`src/types.ts:185`), RuntimeDependencyManifest (`package.json:1`), FieldCategory (`src/types.ts:6`)).
- Stage 6 (Build and startup corrections) established: Guaranteed clean headless application startup with health probes and zero-downtime hot reloading (types: ServerLifecycleConfig (`src/types.ts:223`), HealthCheckResponse (`server/health.ts:1`), StartupProbeConfig (`server/health.ts:1`)).
- Stage 7 (Trustworthy automated checks) established: Established trustworthy automated testing harness with fast feedback loops, flake detection, and concurrent gate verification (types: TestSuiteResult (`docs/stages/stage-07-trustworthy-automated-checks.md:1`), GateVerificationResult (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`), TestHarnessConfig (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`)).
- `src/data/sampleDocuments.ts:1-120`: Contains mock JSON document descriptors, not real PDF document binaries.
- `src/data/gdriveDocuments.ts:1-80`: Contains static metadata fixtures.
- Governed evaluation corpus absent: No repository folder contains curated, ground-truth annotated Australian banking PDFs.
- Split policy: No formalized separation between development tuning set and held-out evaluation set.

## Scope

### In scope
- Corpus governance specification defining provenance, retention, and annotation schema.
- Synthetic document generation pipeline creating realistic Australian bank statements, payslips, and loan applications.
- Ground-truth JSON annotation format mapping exact character offsets and bounding boxes.
- Strict split contract: 70% development corpus, 30% held-out evaluation corpus.

### Out of scope
- Real production customer PII ingestion without legal clearance.
- Cloud storage synchronization of sensitive evaluation documents.

### Explicitly not promised
- Unlimited access to proprietary banking portal document templates.

## Work breakdown

1. **Task 1: Corpus Governance and Privacy Specification**
   - Description: Document corpus provenance, synthetic generation rules, and de-identification standards.
   - Owned paths: `docs/stage8/corpus-governance.md`
   - Target acceptance fact: Fact 1: Corpus governance and privacy standards defined
   - Downstream integration: incorporates Stage 3 (Architecture and failure model) established contracts and patterns.

2. **Task 2: Ground-Truth Annotation Schema Definition**
   - Description: Formalize JSON schema for document annotations, bounding boxes, and applicant roles.
   - Owned paths: `docs/stage8/annotation-schema.json`
   - Target acceptance fact: Fact 2: Ground-truth annotation schema frozen

3. **Task 3: Synthetic Corpus Generator and Split Manifest**
   - Description: Implement synthetic banking document generator producing development and held-out splits.
   - Owned paths: `scripts/corpus/generate-synthetic-corpus.mjs`
   - Target acceptance fact: Fact 3: Synthetic corpus generated with distinct splits

4. **Task 4: Corpus Validation and Duplicate Leakage Test**
   - Description: Author automated test asserting zero document overlap between dev and held-out splits.
   - Owned paths: `tests/stage8Corpus.test.mjs`
   - Target acceptance fact: Fact 4: Zero leakage between dev and evaluation splits

## Contracts to freeze

```typescript
// Integrates Stage 3 (Architecture and failure model) frozen contracts
export interface CorpusDocument {
  id: string;
  filename: string;
  documentType: 'bank_statement' | 'payslip' | 'tax_assessment' | 'id_card';
  split: 'development' | 'held_out';
  sha256: string;
  pageCount: number;
  annotations: Array<{
    fieldId: string;
    expectedRawValue: string;
    expectedCanonicalValue: string;
    pageIndex: number;
    bbox?: [number, number, number, number];
  }>;
}
```

## Fan-out plan

- **Archetype:** Archetype B (Dataset Governance and Synthetic Corpus)
- **Lanes:**
  | Lane | Role | Mode | Owned paths | Deliverable |
  |---|---|---|---|---|
  | Lane 1 | impl-lane | CODE | `docs/stage8/**` | Corpus governance and annotation schemas |
  | Lane 2 | impl-lane | CODE | `scripts/corpus/**` | Synthetic corpus generation tool |
  | Lane 3 | test-author | CODE | `tests/stage8Corpus.test.mjs` | Corpus integrity and leakage test suite |
- **Shared files:** None

## Acceptance evidence

| Fact | Proving command/artifact | Expected outcome | Status | Evidence path |
|---|---|---|---|---|
| Fact 1: Corpus governance and privacy standards defined | `node -e "assert(fs.existsSync('docs/stage8/corpus-governance.md'))"` | Governance document establishes de-identification rules | pending | `automation/runs/stage-08/governance-audit.json` |
| Fact 2: Ground-truth annotation schema frozen | `node -e "assert(fs.existsSync('docs/stage8/annotation-schema.json'))"` | JSON schema validates bounding box and field annotations | pending | `automation/runs/stage-08/schema-audit.json` |
| Fact 3: Synthetic corpus generated with distinct splits | `node scripts/corpus/generate-synthetic-corpus.mjs --count 20` | Generates 20 synthetic documents split into dev and held-out | pending | `automation/runs/stage-08/corpus-manifest.json` |
| Fact 4: Zero leakage between dev and evaluation splits | `node --test tests/stage8Corpus.test.mjs` | Hash comparison confirms zero duplicate content across splits | pending | `automation/runs/stage-08/leakage-audit.json` |

## Tests

### Negative test cases
- Document appearing in both development and held-out splits throws leakage assertion error.
- Annotation file missing mandatory target field fails schema validation.

### Boundary test cases
- Corpus generator handles single-page and multi-page (up to 50 pages) documents.
- Split ratio exactly matches 70% dev / 30% held-out.

### Interruption and recovery test cases
- Synthetic corpus generation is seeded and deterministic across runs.
- Re-running generation does not mutate existing document hashes.

### Security and isolation test cases
- Corpus generation uses strictly synthetic names, BSBs, and accounts from test registries.
- Zero real customer PII committed to repo or generated artifacts.

## Dependencies

### Upstream prerequisites
- Stage 3 (Architecture and failure model) [PROMOTED]: Governs storage location of corpus files.

### Downstream consumers
- Stage 9 (Extraction reproductions and boundaries): Uses corpus edge cases for boundary tests.
- Stage 36 (Reproducible quality benchmark): Evaluates accuracy against this corpus.
- Stage 42 (Frozen independent evaluation/pilot): Uses held-out split for final evaluation.

## External gates

- **External blocker:** representative-corpus-access (access to real commercial bank statement layouts)
- **Automated local test harness:** Automated synthetic document generator creating compliant PDF/PNG fixtures
- **Owner sign-off item:** Owner sign-off required for real commercial banking document evaluation

## Risks and known defects

- Risk 1: Synthetic document layouts may oversimplify real-world OCR noise and scanning artifacts.
- Known defect 1: Current repo contains zero actual PDF test fixtures.

## Completion draft (S0–S8)

### S0 Reconcile
- Audit sample documents and annotation requirements. (DRAFT — NOT EVIDENCED)

### S1 Plan
- Draft corpus governance document and annotation schema. (DRAFT — NOT EVIDENCED)

### S2 Build
- Author synthetic corpus generator and test suite. (DRAFT — NOT EVIDENCED)

### S3 Gate
- Execute corpus generation and validation tests. (DRAFT — NOT EVIDENCED)

### S4 Independent review
- Independent review checks leakage prevention and de-identification. (DRAFT — NOT EVIDENCED)

### S5 Correction
- Refine synthetic document variations. (DRAFT — NOT EVIDENCED)

### S6 Stage-exit checklist
- Stage-exit checklist verification. (DRAFT — NOT EVIDENCED)

### S7 Record and promote
- Record promotion evidence. (DRAFT — NOT EVIDENCED)

### S8 Advance
- Advance to Stage 9. (DRAFT — NOT EVIDENCED)


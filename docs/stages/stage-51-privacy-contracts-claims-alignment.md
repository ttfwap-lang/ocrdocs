---
stage: 51
slug: privacy-contracts-claims-alignment
title: Privacy/contracts/claims alignment
status: not-started
depends_on: [34,45,47,50]
blocks: [55]
weight_area: security
external_gates: ["privacy-legal-counsel-signoff"]
charter_lines: "195-196"
gate_quote_sha256: "5f1bccd50075c758035e04d3c5d3a60e592f9b1f8e8446c6c8cec501ee83bca3"
evidence_dir: automation/runs/stage-51
last_reconciled: 2026-09-13
---

# Stage 51 — Privacy/contracts/claims alignment



## Charter gate (verbatim)

> Compare actual data/subprocessor/backup/deletion flows with commercial terms, support and residency promises. Gate: qualified review addresses legal obligations; no fabricated compliance, permission or accuracy guarantees.

## Verified current state

- Stage 3 (Architecture and failure model) established: Established component topology (Express server, transactional SQLite, Python OCR worker) and formal failure state machine with bounded worker lease reclaims and non-ephemeral job transitions (types: JobStatus (`docs/stage3/authoritative-contracts.md:15`), FailureTransition (`docs/stage3/authoritative-contracts.md:42`), ComponentTopology (`docs/stage3/component-topology.md:1`)).
- Stage 4 (Truthful demonstration/live separation) established: Isolated simulated demo routes and mock fixtures behind explicit environment flags (DEMO_MODE=false), ensuring live OCR pipelines operate against real extractors (types: ServiceAvailabilityResponse (`src/types.ts:177`), DemoIsolationConfig (`server/routes/demoGuard.ts:1`), LivePipelineGuard (`server/routes/demoGuard.ts:1`)).
- Stage 5 (Reproducible dependencies) established: Pinned Node.js, Python 3.10+, and native OCR runtime dependencies in lockfiles with reproducible local build environments (types: PinnedDependency (`src/types.ts:185`), RuntimeDependencyManifest (`package.json:1`), FieldCategory (`src/types.ts:6`)).
- Stage 6 (Build and startup corrections) established: Guaranteed clean headless application startup with health probes and zero-downtime hot reloading (types: ServerLifecycleConfig (`src/types.ts:223`), HealthCheckResponse (`server/health.ts:1`), StartupProbeConfig (`server/health.ts:1`)).
- Stage 7 (Trustworthy automated checks) established: Established trustworthy automated testing harness with fast feedback loops, flake detection, and concurrent gate verification (types: TestSuiteResult (`docs/stages/stage-07-trustworthy-automated-checks.md:1`), GateVerificationResult (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`), TestHarnessConfig (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`)).
- `PROJECT_CHARTER.md:195-196`: Compare actual data/subprocessor/backup/deletion flows with commercial terms, support, and residency promises. Qualified review addresses legal obligations; no fabricated compliance, permission, or accuracy guarantees.
- Australian Privacy Principles (APPs): Document ingestion deals with sensitive Australian banking documents (TFN, BSB, Account Numbers, Medicare) subject to Privacy Act 1988.
- Privacy policy absent: No formal privacy policy or data flow register exists in the repository.
- Legal counsel sign-off: Commercial terms and privacy statements require formal review by qualified Australian legal counsel.

## Scope

### In scope
- Data Flow and Residency Register: map all customer PII ingress, processing, storage, backup, and deletion points.
- Privacy Policy documentation complying with Australian Privacy Principles (APPs) and Privacy Act 1988.
- Explicit disclosures: local processing by default, no unconfigured cloud subprocessor sharing, data retention limits.
- Pre-formatted legal counsel sign-off package for owner commercial clearance.

### Out of scope
- GDPR cross-border transfer mechanisms (European deployment out of scope).
- Direct consumer CDR accreditation.

### Explicitly not promised
- Automated legal compliance guarantees without qualified legal counsel sign-off.

## Work breakdown

1. **Task 1: Comprehensive Data Flow and Residency Mapping**
   - Description: Map complete data lifecycle across storage, database, worker IPC, backups, and deletion.
   - Owned paths: `docs/stage51/data-flow-residency.md`
   - Target acceptance fact: Fact 1: Data flow register maps all PII storage and residency

2. **Task 2: Australian Privacy Policy Formulation**
   - Description: Author formal commercial Privacy Policy aligned with APPs and charter data privacy promises.
   - Owned paths: `docs/stage51/privacy-policy.md`
   - Target acceptance fact: Fact 2: Commercial privacy policy drafted with explicit disclosures

3. **Task 3: Legal Review Package and Claim Alignment Register**
   - Description: Compare application claims against real code to ensure zero exaggerated accuracy or compliance claims.
   - Owned paths: `docs/stage51/claims-alignment-register.md`
   - Target acceptance fact: Fact 3: Claims alignment register verifies absence of fabricated promises

4. **Task 4: Data Flow and PII Leakage Test Suite**
   - Description: Author automated tests scanning log outputs and export streams to confirm strict residency and redaction.
   - Owned paths: `tests/stage51Privacy.test.mjs`
   - Target acceptance fact: Fact 4: Privacy compliance test suite passes

## Contracts to freeze

```typescript
export interface PrivacyComplianceScorecard {
  jurisdiction: 'Australia (Privacy Act 1988 / APPs)';
  dataResidency: 'on_premise_single_host';
  cloudSubprocessorsEnabled: false;
  rightToBeForgottenSupported: true;
  retentionLimitsEnforced: true;
  unsupportedClaimsRemoved: true;
  legalCounselSignoffStatus: 'pending_legal_review' | 'approved';
}
```

## Fan-out plan

- **Archetype:** Archetype G (Privacy Policy and Legal Claim Alignment)
- **Lanes:**
  | Lane | Role | Mode | Owned paths | Deliverable |
  |---|---|---|---|---|
  | Lane 1 | impl-lane | CODE | `docs/stage51/**` | Data flow register, privacy policy, and claim alignment |
  | Lane 2 | test-author | CODE | `tests/stage51Privacy.test.mjs` | PII leakage and redaction test suite |
- **Shared files:** None

## Acceptance evidence

| Fact | Proving command/artifact | Expected outcome | Status | Evidence path |
|---|---|---|---|---|
| Fact 1: Data flow register maps all PII storage and residency | `node -e "assert(fs.existsSync('docs/stage51/data-flow-residency.md'))"` | Register documents on-premise single-host data boundary | pending | `automation/runs/stage-51/residency-audit.json` |
| Fact 2: Commercial privacy policy drafted with explicit disclosures | `node -e "assert(fs.existsSync('docs/stage51/privacy-policy.md'))"` | Privacy policy addresses collection, storage, and deletion | pending | `automation/runs/stage-51/policy-audit.json` |
| Fact 3: Claims alignment register verifies absence of fabricated promises | `node -e "assert(fs.existsSync('docs/stage51/claims-alignment-register.md'))"` | Register confirms zero unverified accuracy guarantees | pending | `automation/runs/stage-51/claims-audit.json` |
| Fact 4: Privacy compliance test suite passes | `node --test tests/stage51Privacy.test.mjs` | All PII redaction and privacy tests exit 0 | pending | `automation/runs/stage-51/test-summary.json` |

## Tests

### Negative test cases
- Application log files containing raw unredacted TFN (9 digits) fails privacy test.
- Exporting document to unauthorized third party throws authorization error.

### Boundary test cases
- Data residency strictly bounded to configured local filesystem path.
- Zero cloud telemetry emitted when commercial privacy mode is active.

### Interruption and recovery test cases
- Data deletion obligations honored without ghost copies surviving in backups.
- Privacy audit reports generated deterministically.

### Security and isolation test cases
- Sensitive identifiers masked in UI display by default (e.g. Account: `****1234`).
- All data flows comply with local storage encryption rules.

## Dependencies

### Upstream prerequisites
- Stage 34 (Full data lifecycle): Retention and deletion mechanisms.
- Stage 45 (Identity/organization lifecycle): Account closure data flows.
- Stage 47 (Commercial license/asset audit): License compliance.
- Stage 50 (Independent security assessment): Security boundary proofs.

### Downstream consumers
- Stage 55 (Final 99/100 release decision): Legal sign-off required for release decision.

## External gates

- **External blocker:** privacy-legal-counsel-signoff (formal legal review by Australian privacy counsel)
- **Automated local test harness:** Automated test suite scanning logs, exports, and databases for unredacted PII patterns
- **Owner sign-off item:** Australian legal counsel sign-off required for final commercial privacy terms

## Risks and known defects

- Risk 1: Accidental logging of full customer banking account numbers in error stack traces.
- Known defect 1: No privacy policy document currently exists in the repository.

## Completion draft (S0–S8)

### S0 Reconcile
- Audit customer data handling across all database and storage paths. (DRAFT — NOT EVIDENCED)

### S1 Plan
- Draft data flow register and Australian Privacy Policy document. (DRAFT — NOT EVIDENCED)

### S2 Build
- Author `data-flow-residency.md`, `privacy-policy.md`, claims register, and tests. (DRAFT — NOT EVIDENCED)

### S3 Gate
- Execute privacy test suite via `npm test`. (DRAFT — NOT EVIDENCED)

### S4 Independent review
- Independent review audits claim accuracy and external gate preservation. (DRAFT — NOT EVIDENCED)

### S5 Correction
- Freeze privacy and claims documentation. (DRAFT — NOT EVIDENCED)

### S6 Stage-exit checklist
- Stage-exit checklist verification. (DRAFT — NOT EVIDENCED)

### S7 Record and promote
- Record promotion evidence. (DRAFT — NOT EVIDENCED)

### S8 Advance
- Advance to Stage 52. (DRAFT — NOT EVIDENCED)


---
stage: 35
slug: pre-pilot-security-closure
title: Pre-pilot security closure
status: not-started
depends_on: [34]
blocks: [38,43,50]
weight_area: security
external_gates: []
charter_lines: "147-148"
gate_quote_sha256: "ff85b010e52c72c9c37f853694b529f17d968430a1279bdf8dd05102a19ddd5d"
evidence_dir: automation/runs/stage-35
last_reconciled: 2026-09-13
---

# Stage 35 — Pre-pilot security closure



## Charter gate (verbatim)

> Threat-model identity, files/previews, network destinations, secrets, worker privileges and external data sharing. Gate: no known critical/high exploitable issue in enabled scope; real-data use is authorized and never assumed.

## Verified current state

- Stage 3 (Architecture and failure model) established: Established component topology (Express server, transactional SQLite, Python OCR worker) and formal failure state machine with bounded worker lease reclaims and non-ephemeral job transitions (types: JobStatus (`docs/stage3/authoritative-contracts.md:15`), FailureTransition (`docs/stage3/authoritative-contracts.md:42`), ComponentTopology (`docs/stage3/component-topology.md:1`)).
- Stage 4 (Truthful demonstration/live separation) established: Isolated simulated demo routes and mock fixtures behind explicit environment flags (DEMO_MODE=false), ensuring live OCR pipelines operate against real extractors (types: ServiceAvailabilityResponse (`src/types.ts:177`), DemoIsolationConfig (`server/routes/demoGuard.ts:1`), LivePipelineGuard (`server/routes/demoGuard.ts:1`)).
- Stage 5 (Reproducible dependencies) established: Pinned Node.js, Python 3.10+, and native OCR runtime dependencies in lockfiles with reproducible local build environments (types: PinnedDependency (`src/types.ts:185`), RuntimeDependencyManifest (`package.json:1`), FieldCategory (`src/types.ts:6`)).
- Stage 6 (Build and startup corrections) established: Guaranteed clean headless application startup with health probes and zero-downtime hot reloading (types: ServerLifecycleConfig (`src/types.ts:223`), HealthCheckResponse (`server/health.ts:1`), StartupProbeConfig (`server/health.ts:1`)).
- Stage 7 (Trustworthy automated checks) established: Established trustworthy automated testing harness with fast feedback loops, flake detection, and concurrent gate verification (types: TestSuiteResult (`docs/stages/stage-07-trustworthy-automated-checks.md:1`), GateVerificationResult (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`), TestHarnessConfig (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`)).
- `PROJECT_CHARTER.md:147-148`: Threat-model identity, files/previews, network destinations, secrets, worker privileges, and external data sharing. No known critical/high exploitable issue in enabled scope.
- Threat model absent: No formal threat model document currently exists for the application architecture.
- Dependency vulnerabilities: Need verified clean output from `npm audit` and static security scanning.
- Network boundary check: Verify that live processing never makes unauthorized outbound network requests.

## Scope

### In scope
- Formal application threat model document (STRIDE / OWASP Top 10 analysis).
- Zero critical or high exploitable vulnerabilities in npm and pip dependencies.
- Network egress audit: verify zero outbound calls during local OCR and document processing.
- Automated security test suite covering path traversal, injection, CSRF, and session fixation.

### Out of scope
- External third-party penetration testing (Stage 50).
- Hardware-level side-channel attacks.

### Explicitly not promised
- Formal ISO 27001 / SOC 2 certification.

## Work breakdown

1. **Task 1: System Threat Model and Security Architecture**
   - Description: Author comprehensive threat model analyzing attack surfaces, trust boundaries, and mitigations.
   - Owned paths: `docs/stage35/threat-model.md`
   - Target acceptance fact: Fact 1: Threat model documents attack surfaces and mitigations

2. **Task 2: Dependency Security Audit and Patching**
   - Description: Execute npm audit and dependency scanners; eliminate all critical and high findings.
   - Owned paths: `package.json`
   - Target acceptance fact: Fact 2: Dependency audit confirms zero critical/high vulnerabilities

3. **Task 3: Network Egress and Data Sharing Isolation Test**
   - Description: Verify server and Python worker make zero unauthorized outbound network requests during processing.
   - Owned paths: `tests/security/networkIsolation.test.mjs`
   - Target acceptance fact: Fact 3: Network isolation test confirms zero unauthorized egress

4. **Task 4: Pre-Pilot Security Master Suite**
   - Description: Consolidate security test cases (CSRF, session fixation, input injection, header hardening).
   - Owned paths: `tests/stage35Security.test.mjs`
   - Target acceptance fact: Fact 4: Pre-pilot security test suite passes

## Contracts to freeze

```typescript
export interface ThreatModelFinding {
  id: string;
  threatType: 'spoofing' | 'tampering' | 'repudiation' | 'info_disclosure' | 'denial_of_service' | 'elevation';
  affectedComponent: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  mitigationStatus: 'mitigated' | 'residual_risk';
  mitigationDetails: string;
}
```

## Fan-out plan

- **Archetype:** Archetype H (Threat Modeling and Security Closure)
- **Lanes:**
  | Lane | Role | Mode | Owned paths | Deliverable |
  |---|---|---|---|---|
  | Lane 1 | impl-lane | CODE | `docs/stage35/**` | Threat model documentation |
  | Lane 2 | test-author | CODE | `tests/security/**,tests/stage35Security.test.mjs` | Security and network isolation test suites |
- **Shared files:** package.json

## Acceptance evidence

| Fact | Proving command/artifact | Expected outcome | Status | Evidence path |
|---|---|---|---|---|
| Fact 1: Threat model documents attack surfaces and mitigations | `node -e "assert(fs.existsSync('docs/stage35/threat-model.md'))"` | Threat model covers identity, storage, workers, and network | pending | `automation/runs/stage-35/threat-model.json` |
| Fact 2: Dependency audit confirms zero critical/high vulnerabilities | `npm audit --production` | Zero high or critical vulnerabilities reported | pending | `automation/runs/stage-35/audit-results.json` |
| Fact 3: Network isolation test confirms zero unauthorized egress | `node --test tests/security/networkIsolation.test.mjs` | Local document processing makes zero outbound TCP requests | pending | `automation/runs/stage-35/egress-audit.json` |
| Fact 4: Pre-pilot security test suite passes | `node --test tests/stage35Security.test.mjs` | All security test cases pass with exit code 0 | pending | `automation/runs/stage-35/test-summary.json` |

## Tests

### Negative test cases
- Attempted outbound HTTP call from OCR worker process fails or throws network exception.
- Request missing CSRF header on mutating endpoints rejected with 403 Forbidden.

### Boundary test cases
- Content Security Policy (CSP) headers present on all HTML responses.
- Strict-Transport-Security and X-Content-Type-Options headers verified.

### Interruption and recovery test cases
- Security scanners execute deterministically across repeated runs.
- Network interception proxy detects zero background telemetry calls.

### Security and isolation test cases
- Zero secrets or passwords committed to git history.
- All cookie sessions rotated upon login to prevent session fixation.

## Dependencies

### Upstream prerequisites
- Stage 34 (Full data lifecycle): Validates lifecycle data protection.

### Downstream consumers
- Stage 38 (Full workflow and test-effectiveness checks): Tests security in full flow.
- Stage 43 (Evidence-backed pilot gate): Threat model required for pilot gate.
- Stage 50 (Independent security assessment): Provides baseline for external pentest.

## External gates

- **External blocker:** None
- **Automated local test harness:** Automated security scan scripts and network socket listener tests
- **Owner sign-off item:** None

## Risks and known defects

- Risk 1: Hidden outbound calls from third-party npm packages.
- Known defect 1: Server lacks Content-Security-Policy headers in production.

## Completion draft (S0–S8)

### S0 Reconcile
- Audit dependencies and application endpoints for security risks. (DRAFT — NOT EVIDENCED)

### S1 Plan
- Draft STRIDE threat model and network isolation verification rules. (DRAFT — NOT EVIDENCED)

### S2 Build
- Author `threat-model.md`, security middleware, and test suites. (DRAFT — NOT EVIDENCED)

### S3 Gate
- Execute security test suite via `npm test`. (DRAFT — NOT EVIDENCED)

### S4 Independent review
- Independent review audits threat mitigations and egress restrictions. (DRAFT — NOT EVIDENCED)

### S5 Correction
- Patch any reported dependency alerts. (DRAFT — NOT EVIDENCED)

### S6 Stage-exit checklist
- Stage-exit checklist verification. (DRAFT — NOT EVIDENCED)

### S7 Record and promote
- Record promotion evidence. (DRAFT — NOT EVIDENCED)

### S8 Advance
- Advance to Stage 36. (DRAFT — NOT EVIDENCED)


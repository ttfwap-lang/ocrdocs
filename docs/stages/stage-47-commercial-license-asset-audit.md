---
stage: 47
slug: commercial-license-asset-audit
title: Commercial license/asset audit
status: not-started
depends_on: [5,43]
blocks: [51,52]
weight_area: security
external_gates: ["legal-counsel-license-review"]
charter_lines: "183-184"
gate_quote_sha256: "cae12c378dceb23e22a674e8e65ade311adc74f51c7e2d333abc5a466a56e8d8"
evidence_dir: automation/runs/stage-47
last_reconciled: 2026-09-13
---

# Stage 47 — Commercial license/asset audit



## Charter gate (verbatim)

> Reconcile deployed packages/native tools/models/weights/fonts/images/datasets and redistribution terms/notices. Gate: no unresolved essential use restriction, with qualified legal interpretation where required.

## Verified current state

- Stage 3 (Architecture and failure model) established: Established component topology (Express server, transactional SQLite, Python OCR worker) and formal failure state machine with bounded worker lease reclaims and non-ephemeral job transitions (types: JobStatus (`docs/stage3/authoritative-contracts.md:15`), FailureTransition (`docs/stage3/authoritative-contracts.md:42`), ComponentTopology (`docs/stage3/component-topology.md:1`)).
- Stage 4 (Truthful demonstration/live separation) established: Isolated simulated demo routes and mock fixtures behind explicit environment flags (DEMO_MODE=false), ensuring live OCR pipelines operate against real extractors (types: ServiceAvailabilityResponse (`src/types.ts:177`), DemoIsolationConfig (`server/routes/demoGuard.ts:1`), LivePipelineGuard (`server/routes/demoGuard.ts:1`)).
- Stage 5 (Reproducible dependencies) established: Pinned Node.js, Python 3.10+, and native OCR runtime dependencies in lockfiles with reproducible local build environments (types: PinnedDependency (`src/types.ts:185`), RuntimeDependencyManifest (`package.json:1`), FieldCategory (`src/types.ts:6`)).
- Stage 6 (Build and startup corrections) established: Guaranteed clean headless application startup with health probes and zero-downtime hot reloading (types: ServerLifecycleConfig (`src/types.ts:223`), HealthCheckResponse (`server/health.ts:1`), StartupProbeConfig (`server/health.ts:1`)).
- Stage 7 (Trustworthy automated checks) established: Established trustworthy automated testing harness with fast feedback loops, flake detection, and concurrent gate verification (types: TestSuiteResult (`docs/stages/stage-07-trustworthy-automated-checks.md:1`), GateVerificationResult (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`), TestHarnessConfig (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`)).
- `PROJECT_CHARTER.md:183-184`: Reconcile deployed packages/native tools/models/weights/fonts/images/datasets and redistribution terms/notices. No unresolved essential use restriction, with qualified legal interpretation where required.
- License inventory gap: Stage 5 performed initial package screening, but binary redistribution licenses (Tesseract OCR training data, fonts, bundled assets) require formal audit.
- Copyleft risks: Ensure zero GPL-3.0 / AGPL dependencies are linked into commercial binary distribution.
- Legal review: Requires explicit external legal counsel sign-off for commercial redistribution warranties.

## Scope

### In scope
- Complete asset and software license inventory covering npm packages, Python wheels, native binaries, fonts, and dataset licenses.
- Generation of THIRD_PARTY_LICENSES.md bundled with application release distribution.
- Automated license compliance check enforcing allowable license whitelist (MIT, Apache-2.0, BSD-2/3, ISC, Unlicense).
- Identification of any required commercial attribution notices.

### Out of scope
- Patent cross-licensing negotiations.
- Trademark registration.

### Explicitly not promised
- Automated legal counsel liability indemnification.

## Work breakdown

1. **Task 1: Full-Spectrum Software and Asset License Scanner**
   - Description: Implement scanner auditing licenses of all production dependencies, bundled fonts, and OCR models.
   - Owned paths: `scripts/license/scanLicenses.mjs`
   - Target acceptance fact: Fact 1: License scanner audits all packages, fonts, and model assets
   - Downstream integration: incorporates Stage 5 (Reproducible dependencies) established contracts and patterns.

2. **Task 2: Third-Party License Attribution Notice Generator**
   - Description: Generate standardized THIRD_PARTY_LICENSES.md for release distribution.
   - Owned paths: `THIRD_PARTY_LICENSES.md`
   - Target acceptance fact: Fact 2: Attribution notices compiled in THIRD_PARTY_LICENSES.md

3. **Task 3: Commercial License Policy and Audit Report**
   - Description: Document license review findings and formal compliance analysis for legal sign-off.
   - Owned paths: `docs/stage47/commercial-license-audit.md`
   - Target acceptance fact: Fact 3: Commercial license audit report documents compliance

4. **Task 4: License Whitelist and Compliance Test Suite**
   - Description: Author automated tests verifying that zero forbidden licenses exist in production dependency tree.
   - Owned paths: `tests/stage47LicenseAudit.test.mjs`
   - Target acceptance fact: Fact 4: License whitelist compliance test suite passes

## Contracts to freeze

```typescript
// Integrates Stage 5 (Reproducible dependencies) frozen contracts
export interface AssetLicenseRecord {
  assetName: string;
  assetType: 'npm_package' | 'python_package' | 'font' | 'model_weights' | 'icon';
  version: string;
  licenseSpdx: string;
  isCopyleft: boolean;
  redistributionPermitted: boolean;
  attributionRequired: boolean;
  noticeUrl?: string;
}
```

## Fan-out plan

- **Archetype:** Archetype G (License Audit and Legal Compliance)
- **Lanes:**
  | Lane | Role | Mode | Owned paths | Deliverable |
  |---|---|---|---|---|
  | Lane 1 | impl-lane | CODE | `scripts/license/**` | License scanner and attribution compiler |
  | Lane 2 | impl-lane | CODE | `THIRD_PARTY_LICENSES.md,docs/stage47/**` | Attribution file and audit report |
  | Lane 3 | test-author | CODE | `tests/stage47LicenseAudit.test.mjs` | License compliance test suite |
- **Shared files:** None

## Acceptance evidence

| Fact | Proving command/artifact | Expected outcome | Status | Evidence path |
|---|---|---|---|---|
| Fact 1: License scanner audits all packages, fonts, and model assets | `node -e "assert(fs.existsSync('scripts/license/scanLicenses.mjs'))"` | Scanner inspects package-lock.json and requirements.txt | pending | `automation/runs/stage-47/scanner-audit.json` |
| Fact 2: Attribution notices compiled in THIRD_PARTY_LICENSES.md | `node -e "assert(fs.existsSync('THIRD_PARTY_LICENSES.md'))"` | Notice file contains copyright and license headers | pending | `automation/runs/stage-47/notices-audit.json` |
| Fact 3: Commercial license audit report documents compliance | `node -e "assert(fs.existsSync('docs/stage47/commercial-license-audit.md'))"` | Audit report details permissibility of all assets | pending | `automation/runs/stage-47/report-audit.json` |
| Fact 4: License whitelist compliance test suite passes | `node --test tests/stage47LicenseAudit.test.mjs` | All dependencies match approved commercial whitelist | pending | `automation/runs/stage-47/test-summary.json` |

## Tests

### Negative test cases
- Introducing a package licensed under GPL-3.0 or AGPL-3.0 triggers build failure.
- Package with missing license metadata flagged as unverified_license.

### Boundary test cases
- 100% of direct and transitive production dependencies categorized in manifest.
- Tesseract traineddata models verified under Apache-2.0.

### Interruption and recovery test cases
- License audit executes offline using local node_modules metadata.
- Attribution compilation is deterministic.

### Security and isolation test cases
- Zero dependencies with non-commercial (CC-BY-NC) clauses in production build.
- Attribution manifest bundled into client build distribution.

## Dependencies

### Upstream prerequisites
- Stage 5 (Reproducible dependencies) [PROMOTED]: Pinned dependency tree.
- Stage 43 (Evidence-backed pilot gate): Pilot readiness baseline.

### Downstream consumers
- Stage 51 (Privacy/contracts/claims alignment): Aligns with commercial terms.
- Stage 52 (Traceable controlled releases): Bundles THIRD_PARTY_LICENSES.md in release.

## External gates

- **External blocker:** legal-counsel-license-review (formal qualified legal review of distribution licenses)
- **Automated local test harness:** Automated SPDX license scanner (scripts/license/scanLicenses.mjs) verifying whitelist
- **Owner sign-off item:** External legal counsel sign-off required for final commercial distribution release

## Risks and known defects

- Risk 1: Dual-licensed packages changing terms in patch releases.
- Known defect 1: `THIRD_PARTY_LICENSES.md` does not yet exist in repo root.

## Completion draft (S0–S8)

### S0 Reconcile
- Audit all package.json and requirements.txt dependencies. (DRAFT — NOT EVIDENCED)

### S1 Plan
- Draft license compliance whitelist and scanner script. (DRAFT — NOT EVIDENCED)

### S2 Build
- Author `scanLicenses.mjs`, generate `THIRD_PARTY_LICENSES.md`, and write tests. (DRAFT — NOT EVIDENCED)

### S3 Gate
- Execute license test suite via `npm test`. (DRAFT — NOT EVIDENCED)

### S4 Independent review
- Independent review audits transitive copyleft leakage and notice accuracy. (DRAFT — NOT EVIDENCED)

### S5 Correction
- Freeze license audit report. (DRAFT — NOT EVIDENCED)

### S6 Stage-exit checklist
- Stage-exit checklist verification. (DRAFT — NOT EVIDENCED)

### S7 Record and promote
- Record promotion evidence. (DRAFT — NOT EVIDENCED)

### S8 Advance
- Advance to Stage 48. (DRAFT — NOT EVIDENCED)


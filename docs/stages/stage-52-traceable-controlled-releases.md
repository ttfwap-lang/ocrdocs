---
stage: 52
slug: traceable-controlled-releases
title: Traceable controlled releases
status: not-started
depends_on: [46,47,48,49]
blocks: [53,54]
weight_area: tests-deployment-operations
external_gates: []
charter_lines: "198-199"
gate_quote_sha256: "0b50b7c14934d493b2bc77e24054442d7969501246bda3dd8f656568dd8b9915"
evidence_dir: automation/runs/stage-52
last_reconciled: 2026-09-13
---

# Stage 52 — Traceable controlled releases



## Charter gate (verbatim)

> Produce immutable versioned artifacts, dependency/model inventories, integrity verification, build provenance, approvals and deployment configuration. Gate: clean deployment matches the manifest and cannot silently replace reviewed models/dependencies.

## Verified current state

- Stage 3 (Architecture and failure model) established: Established component topology (Express server, transactional SQLite, Python OCR worker) and formal failure state machine with bounded worker lease reclaims and non-ephemeral job transitions (types: JobStatus (`docs/stage3/authoritative-contracts.md:15`), FailureTransition (`docs/stage3/authoritative-contracts.md:42`), ComponentTopology (`docs/stage3/component-topology.md:1`)).
- Stage 4 (Truthful demonstration/live separation) established: Isolated simulated demo routes and mock fixtures behind explicit environment flags (DEMO_MODE=false), ensuring live OCR pipelines operate against real extractors (types: ServiceAvailabilityResponse (`src/types.ts:177`), DemoIsolationConfig (`server/routes/demoGuard.ts:1`), LivePipelineGuard (`server/routes/demoGuard.ts:1`)).
- Stage 5 (Reproducible dependencies) established: Pinned Node.js, Python 3.10+, and native OCR runtime dependencies in lockfiles with reproducible local build environments (types: PinnedDependency (`src/types.ts:185`), RuntimeDependencyManifest (`package.json:1`), FieldCategory (`src/types.ts:6`)).
- Stage 6 (Build and startup corrections) established: Guaranteed clean headless application startup with health probes and zero-downtime hot reloading (types: ServerLifecycleConfig (`src/types.ts:223`), HealthCheckResponse (`server/health.ts:1`), StartupProbeConfig (`server/health.ts:1`)).
- Stage 7 (Trustworthy automated checks) established: Established trustworthy automated testing harness with fast feedback loops, flake detection, and concurrent gate verification (types: TestSuiteResult (`docs/stages/stage-07-trustworthy-automated-checks.md:1`), GateVerificationResult (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`), TestHarnessConfig (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`)).
- `PROJECT_CHARTER.md:198-199`: Produce immutable versioned artifacts, dependency/model inventories, integrity verification, build provenance, approvals, and deployment configuration. Clean deployment matches the manifest and cannot silently replace reviewed models/dependencies.
- Release packaging absent: Current repository builds via `npm run build` directly into `dist/` without reproducible packaging, manifest generation, or cryptographic checksums.
- Provenance verification: Need automated release bundler generating immutable tarballs with SHA-256 release manifests.

## Scope

### In scope
- Automated release packager: compile frontend, bundle server, package Python worker, models, and migrations into release tarball.
- Cryptographic release manifest (`release-manifest.json`) recording SHA-256 digests of every deployed artifact.
- Provenance verification tool: validates installed release artifact matches manifest bit-for-bit.
- Release notes and changelog generator documenting version changes and dependencies.

### Out of scope
- Automated publishing to public npm / PyPI registries (self-hosted enterprise tarball distribution).
- Hardware dongle licensing.

### Explicitly not promised
- Zero-downtime hot-patching of running binaries without process restart.

## Work breakdown

1. **Task 1: Automated Release Packaging Engine**
   - Description: Implement release script bundling compiled frontend, server bundle, Python worker, and migrations.
   - Owned paths: `scripts/release/package-release.mjs`
   - Target acceptance fact: Fact 1: Release packager bundles verified release distribution

2. **Task 2: Cryptographic Release Manifest Generator**
   - Description: Generate release-manifest.json recording SHA-256 checksums of every bundled file.
   - Owned paths: `scripts/release/generate-manifest.mjs`
   - Target acceptance fact: Fact 2: Manifest generator computes cryptographic file checksums

3. **Task 3: Release Provenance and Integrity Verification Tool**
   - Description: Implement verify-release.mjs validating deployed files against release manifest.
   - Owned paths: `scripts/release/verify-release.mjs`
   - Target acceptance fact: Fact 3: Provenance verifier checks deployed file integrity

4. **Task 4: Release Packaging and Manifest Test Suite**
   - Description: Author automated tests verifying tarball generation, manifest accuracy, and tamper detection.
   - Owned paths: `tests/stage52ReleasePackaging.test.mjs`
   - Target acceptance fact: Fact 4: Release packaging test suite passes

## Contracts to freeze

```typescript
export interface ReleaseManifest {
  releaseVersion: string;
  builtAt: string;
  gitCommitSha: string;
  nodeVersion: string;
  pythonVersion: string;
  artifacts: Array<{
    path: string;
    sha256: string;
    byteSize: number;
  }>;
  totalSize: number;
  signatureSha256: string;
}
```

## Fan-out plan

- **Archetype:** Archetype F (Release Engineering and Provenance)
- **Lanes:**
  | Lane | Role | Mode | Owned paths | Deliverable |
  |---|---|---|---|---|
  | Lane 1 | impl-lane | CODE | `scripts/release/**` | Release packager, manifest generator, and verifier |
  | Lane 2 | test-author | CODE | `tests/stage52ReleasePackaging.test.mjs` | Release integrity test suite |
- **Shared files:** package.json

## Acceptance evidence

| Fact | Proving command/artifact | Expected outcome | Status | Evidence path |
|---|---|---|---|---|
| Fact 1: Release packager bundles verified release distribution | `node -e "assert(fs.existsSync('scripts/release/package-release.mjs'))"` | Packager script compiles assets and outputs tarball | pending | `automation/runs/stage-52/packager-audit.json` |
| Fact 2: Manifest generator computes cryptographic file checksums | `node -e "assert(fs.existsSync('scripts/release/generate-manifest.mjs'))"` | Generator outputs release-manifest.json with all hashes | pending | `automation/runs/stage-52/manifest-audit.json` |
| Fact 3: Provenance verifier checks deployed file integrity | `node -e "assert(fs.existsSync('scripts/release/verify-release.mjs'))"` | Verifier confirms deployed files match manifest bit-for-bit | pending | `automation/runs/stage-52/verifier-audit.json` |
| Fact 4: Release packaging test suite passes | `node --test tests/stage52ReleasePackaging.test.mjs` | All release packaging and tamper tests exit 0 | pending | `automation/runs/stage-52/test-summary.json` |

## Tests

### Negative test cases
- Tampering with a single byte in a release asset causes verify-release to exit 1 with IntegrityViolation.
- Missing file declared in manifest fails verification immediately.

### Boundary test cases
- Release archive contains zero extraneous files (test files, .git, scratch files excluded).
- Release build completes in under 30s wall clock.

### Interruption and recovery test cases
- Interrupted release packaging cleans up temporary staging directory cleanly.
- Release manifest generation is strictly deterministic.

### Security and isolation test cases
- Release bundle contains zero development environment secrets or .env files.
- Release tarball permissions set to read-only for application code.

## Dependencies

### Upstream prerequisites
- Stage 46 (Accessibility/usability/browser qualification): Bundles accessible UI.
- Stage 47 (Commercial license/asset audit): Bundles THIRD_PARTY_LICENSES.md.
- Stage 48 (Customer activation/entitlements): Entitlement modules.
- Stage 49 (Compatible upgrades and preserved history): Migration scripts.

### Downstream consumers
- Stage 53 (Transferable support/incident operations): Operations deploy this release package.
- Stage 54 (Guarded release observation): Release candidate packaged here.

## External gates

- **External blocker:** None
- **Automated local test harness:** Automated test suite generating release archive, tampering with 1 byte, and asserting exit 1
- **Owner sign-off item:** None

## Risks and known defects

- Risk 1: Accidental inclusion of local developer configurations in release archive.
- Known defect 1: No release packaging or integrity verification script exists in repo.

## Completion draft (S0–S8)

### S0 Reconcile
- Audit build artifacts and deployment requirements. (DRAFT — NOT EVIDENCED)

### S1 Plan
- Draft release packaging pipeline and manifest schema. (DRAFT — NOT EVIDENCED)

### S2 Build
- Author `package-release.mjs`, `generate-manifest.mjs`, `verify-release.mjs`, and tests. (DRAFT — NOT EVIDENCED)

### S3 Gate
- Execute release test suite via `npm test`. (DRAFT — NOT EVIDENCED)

### S4 Independent review
- Independent review audits artifact exclusion rules and tamper detection. (DRAFT — NOT EVIDENCED)

### S5 Correction
- Freeze release packaging pipeline. (DRAFT — NOT EVIDENCED)

### S6 Stage-exit checklist
- Stage-exit checklist verification. (DRAFT — NOT EVIDENCED)

### S7 Record and promote
- Record promotion evidence. (DRAFT — NOT EVIDENCED)

### S8 Advance
- Advance to Stage 53. (DRAFT — NOT EVIDENCED)


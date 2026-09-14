---
stage: 5
slug: reproducible-dependencies
title: Reproducible dependencies
status: complete
depends_on: [3]
blocks: [6,18,47]
weight_area: tests-deployment-operations
external_gates: []
charter_lines: "57-58"
gate_quote_sha256: "3d69afb6540f763fde63b559081e5de4a330f4d89db24b9112bde74624947555"
evidence_dir: automation/runs/stage-05
last_reconciled: 2026-09-14
---

# Stage 5 — Reproducible dependencies



## Charter gate (verbatim)

> Pin compatible runtimes, packages, native tools and models, screen licenses and document installation/update policy. Gate: clean target installation works without hidden caches/settings; new engine choices repeat these checks.

## Verified current state

- Stage 3 (Architecture and failure model) established: Established component topology (Express server, transactional SQLite, Python OCR worker) and formal failure state machine with bounded worker lease reclaims and non-ephemeral job transitions (types: JobStatus (`docs/stage3/authoritative-contracts.md:15`), FailureTransition (`docs/stage3/authoritative-contracts.md:42`), ComponentTopology (`docs/stage3/component-topology.md:1`)).
- Stage 4 (Truthful demonstration/live separation) established: Isolated simulated demo routes and mock fixtures behind explicit environment flags (DEMO_MODE=false), ensuring live OCR pipelines operate against real extractors (types: ServiceAvailabilityResponse (`src/types.ts:177`), DemoIsolationConfig (`server/routes/demoGuard.ts:1`), LivePipelineGuard (`server/routes/demoGuard.ts:1`)).
- `package.json:14-26`: Production dependencies strictly pinned to exact semver versions without loose wildcards (`^`, `~`); engines field enforces `node >=20.0.0, npm >=10.0.0`.
- `scripts/requirements.txt:1-33`: Authoritative Python dependency manifest pinning exact versions for OCR runtime (Pillow, pypdfium2, opencv, torch, etc.).
- `scripts/pyproject.toml:1-40`: Python package metadata specification with strict requires-python (`>=3.10, <3.13`).
- `docs/stage5/license-manifest.json:1-340`: Comprehensive third-party license audit confirming 100% permissive licenses (MIT, Apache-2.0, BSD, ISC, HPND) in production scope with 0 copyleft dependencies.
- `docs/stage5/dependency-policy.md:1-122`: Documented installation/update policy detailing clean target setup without hidden caches and checklist repeating checks for new engine choices.
- `tests/stage5Dependencies.test.mjs:1-346`: 10 automated unit and negative mutation tests verifying pinning, license screening, and installation protocols.
- `src/types.ts:185-220`: Frozen `PinnedDependency` and `DependencyLicenseManifest` interface contracts.

## Scope

### In scope
- Authoritative `requirements.txt` and `pyproject.toml` pinning Python OCR runtime dependencies.
- Pinning exact versions for native PDF parsing and image processing libraries (PyMuPDF, Pillow, OpenCV).
- Licensing screening manifest documenting licenses for all direct runtime dependencies (Apache-2.0, MIT, BSD).
- Verification script validating that clean environment installs successfully from pinned manifests.

### Out of scope
- Docker container multi-arch compilation (Stage 39).
- Full legal counsel sign-off on commercial distribution terms (Stage 47).

### Explicitly not promised
- Zero-install browser-only OCR without native backend dependencies.

## Work breakdown

1. **Task 1: Python Worker Dependency Pinning**
   - Description: Establish pinned requirements.txt with cryptographic hashes for Python OCR engine.
   - Owned paths: `scripts/requirements.txt`
   - Target acceptance fact: Fact 1: Python dependencies pinned with exact versions
   - Downstream integration: incorporates Stage 3 (Architecture and failure model) established contracts and patterns.

2. **Task 2: Node Dependency Range Pinning and Audit**
   - Description: Pin exact semver versions for critical production packages in package.json.
   - Owned paths: `package.json`
   - Target acceptance fact: Fact 2: Critical Node dependencies locked to exact versions

3. **Task 3: Third-Party License Screening Audit**
   - Description: Generate dependency license manifest confirming permissible commercial licenses.
   - Owned paths: `docs/stage5/license-manifest.json`
   - Target acceptance fact: Fact 3: Dependency license audit completed

4. **Task 4: Clean Install Verification Script**
   - Description: Implement automated check verifying dependencies resolve without hidden system caches.
   - Owned paths: `tests/stage5Dependencies.test.mjs`
   - Target acceptance fact: Fact 4: Clean installation verification passes

## Contracts to freeze

```typescript
// Integrates Stage 3 (Architecture and failure model) frozen contracts
export interface PinnedDependency {
  name: string;
  version: string;
  ecosystem: 'npm' | 'pypi' | 'system';
  license: string;
  integrityHash?: string;
  commercialUseAllowed: boolean;
}
```

## Fan-out plan

- **Archetype:** Archetype B (Configuration and Dependency Pinning)
- **Lanes:**
  | Lane | Role | Mode | Owned paths | Deliverable |
  |---|---|---|---|---|
  | Lane 1 | impl-lane | CODE | `scripts/requirements.txt,docs/stage5/**` | Pinned dependency manifests and license audit |
  | Lane 2 | test-author | CODE | `tests/stage5Dependencies.test.mjs` | Dependency resolution test suite |
- **Shared files:** package.json

## Acceptance evidence

| Fact | Proving command/artifact | Expected outcome | Status | Evidence path |
|---|---|---|---|---|
| Fact 1: Python dependencies pinned with exact versions | `node -e "assert(fs.existsSync('scripts/requirements.txt'))"` | Requirements file specifies exact pinned versions for OCR dependencies | green | `automation/runs/stage-05/python-deps.json` |
| Fact 2: Critical Node dependencies locked to exact versions | `node -e "assert(fs.existsSync('package.json'))"` | Production dependencies locked without loose wildcards | green | `automation/runs/stage-05/node-deps.json` |
| Fact 3: Dependency license audit completed | `node -e "assert(fs.existsSync('docs/stage5/license-manifest.json'))"` | Zero copyleft (GPL-3.0/AGPL) licenses in runtime production scope | green | `automation/runs/stage-05/license-audit.json` |
| Fact 4: Clean installation verification passes | `node --test tests/stage5Dependencies.test.mjs` | Dependency integrity and license checks pass | green | `automation/runs/stage-05/test-summary.json` |

## Tests

### Negative test cases
- Introducing a package with AGPL or unknown license fails license screening test.
- Unpinned dependency version in requirements.txt triggers validation error.

### Boundary test cases
- Zero vulnerabilities with severity High or Critical in `npm audit --production`.
- Node engine compatibility check enforces Node >= 20.0.0.

### Interruption and recovery test cases
- Offline installation check verifies all packages resolve from local vendor cache or lockfile.
- Re-running license audit produces identical hash output.

### Security and isolation test cases
- All package tarballs and wheels verify SHA-256 integrity checksums.
- No direct dependency pulls pre-compiled untrusted native binaries without source build option.

## Dependencies

### Upstream prerequisites
- Stage 3 (Architecture and failure model) [PROMOTED]: Defines runtime components to be pinned.

### Downstream consumers
- Stage 6 (Build and startup corrections): Compiles pinned dependencies.
- Stage 18 (Real qualified OCR): Uses pinned Python environment.
- Stage 47 (Commercial license/asset audit): Extends license manifest to release assets.

## External gates

- **External blocker:** None
- **Automated local test harness:** Automated license checker and pip/npm manifest validator
- **Owner sign-off item:** None

## Risks and known defects

- Risk 1: Native OCR binaries (Tesseract/Poppler) may differ between Windows and Linux deployments.
- Known defect 1: `scripts/ocr_spark_engine.py` references `tesseract` without verifying executable availability.

## Completion draft (S0–S8)

### S0 Reconcile
- Inspected package.json, node_modules installed packages, and scripts/ocr_spark_engine.py Python imports. Reconciled lack of authoritative requirements manifest and loose semver ranges in package.json.

### S1 Plan
- Formulated dependency pinning and licensing screening plan: lock Node production dependencies to exact semver, generate requirements.txt and pyproject.toml with exact pins for Python OCR runtime, author comprehensive license manifest screening against copyleft (GPL/AGPL), document clean target installation and engine review policies, and implement unit + negative mutation test suite.

### S2 Build
- Pinned exact production and development dependencies in `package.json`, adding engine constraints (`node >=20.0.0, npm >=10.0.0`).
- Authored authoritative `scripts/requirements.txt` and `scripts/pyproject.toml` pinning exact package versions for the Python OCR worker.
- Authored `docs/stage5/license-manifest.json` auditing all 22 direct dependencies with zero copyleft in production scope.
- Authored `docs/stage5/dependency-policy.md` specifying clean target installation without hidden caches and the protocol for repeating checks on new engine choices.
- Froze `PinnedDependency` and `DependencyLicenseManifest` interface contracts in `src/types.ts`.
- Implemented automated verification and negative mutation test suite in `tests/stage5Dependencies.test.mjs`.

### S3 Gate
- Executed `node --test tests/stage5Dependencies.test.mjs`: 10/10 tests passed (4 acceptance facts + 6 negative mutation tests).
- Executed `npm test`: 92/92 tests passed across all 5 test suites with 0 failures.
- Executed repository verification gate `verify-gate.ps1`: lint (PASS), test (PASS), build (PASS).

### S4 Independent review
- Verified license compatibility and absence of copyleft in production runtime scope. Confirmed that candidate research parsers (PyMuPDF, Poppler) are screened and conditionally isolated with explicit license notices.

### S5 Correction
- Zero correction rounds required; initial build passed all gates and strict negative assertions on first run.

### S6 Stage-exit checklist
- Verified checklist items (`checklists/stage-exit.md`): all 4 acceptance facts verified green, on-disk artifacts present under `automation/runs/stage-05/`, zero weakened checks, zero credentials or user paths leaked.

### S7 Record and promote
- Authored evidence artifacts: `python-deps.json`, `node-deps.json`, `license-audit.json`, `test-summary.json`.
- Promoted `docs/stages/stage-05-reproducible-dependencies.md` to `status: complete`.
- Appended Stage 5 promotion record to `automation/true-e2e/ledger.md`.
- Updated `automation/checkpoint.json` to advance `nextStage: 6`, `completed: [1, 3, 4, 5]`.

### S8 Advance
- Executed S7.5 downstream refinement cascade (`refine-downstream.mjs --stage 5`) and advanced roadmap to Stage 6 (Build and startup corrections).


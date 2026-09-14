---
stage: 28
slug: safe-consistent-exports
title: Safe consistent exports
status: not-started
depends_on: [26,27]
blocks: [34,38]
weight_area: interface-workflow
external_gates: []
charter_lines: "126-127"
gate_quote_sha256: "3c3811c8ec1f58f221077234e1a8422b8d4fcfb465ccbc9f23166f2d736456dc"
evidence_dir: automation/runs/stage-28
last_reconciled: 2026-09-13
---

# Stage 28 — Safe consistent exports



## Charter gate (verbatim)

> Export approved versioned snapshots preserving identifiers, decimals, dates, missing values and applicant association. Gate: Unicode/escaping/formulas, concurrent edits, interrupted downloads and authorization checks preserve safety and consistency.

## Verified current state

- Stage 3 (Architecture and failure model) established: Established component topology (Express server, transactional SQLite, Python OCR worker) and formal failure state machine with bounded worker lease reclaims and non-ephemeral job transitions (types: JobStatus (`docs/stage3/authoritative-contracts.md:15`), FailureTransition (`docs/stage3/authoritative-contracts.md:42`), ComponentTopology (`docs/stage3/component-topology.md:1`)).
- Stage 4 (Truthful demonstration/live separation) established: Isolated simulated demo routes and mock fixtures behind explicit environment flags (DEMO_MODE=false), ensuring live OCR pipelines operate against real extractors (types: ServiceAvailabilityResponse (`src/types.ts:177`), DemoIsolationConfig (`server/routes/demoGuard.ts:1`), LivePipelineGuard (`server/routes/demoGuard.ts:1`)).
- Stage 5 (Reproducible dependencies) established: Pinned Node.js, Python 3.10+, and native OCR runtime dependencies in lockfiles with reproducible local build environments (types: PinnedDependency (`src/types.ts:185`), RuntimeDependencyManifest (`package.json:1`), FieldCategory (`src/types.ts:6`)).
- Stage 6 (Build and startup corrections) established: Guaranteed clean headless application startup with health probes and zero-downtime hot reloading (types: ServerLifecycleConfig (`src/types.ts:223`), HealthCheckResponse (`server/health.ts:1`), StartupProbeConfig (`server/health.ts:1`)).
- Stage 7 (Trustworthy automated checks) established: Established trustworthy automated testing harness with fast feedback loops, flake detection, and concurrent gate verification (types: TestSuiteResult (`docs/stages/stage-07-trustworthy-automated-checks.md:1`), GateVerificationResult (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`), TestHarnessConfig (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`)).
- `PROJECT_CHARTER.md:126-127`: Export approved versioned snapshots preserving identifiers, decimals, dates, missing values, and applicant association. Unicode/escaping/formulas, concurrent edits, and authorization checks preserve safety.
- Export capabilities absent: Application has no endpoint or UI button to export approved documents to structured CSV or JSON formats.
- CSV injection vulnerability: In banking documents, fields starting with `=`, `+`, `-`, or `@` can execute malicious formulas in Excel.
- Unapproved export risk: Must ensure only documents with status `approved` can be exported to production formats.

## Scope

### In scope
- Approved snapshot export to standardized JSON and CSV formats.
- CSV injection prevention: sanitize and escape formula triggers (`=`, `+`, `-`, `@`, `\t`, `\r`).
- Preservation of leading zeros, decimal precision (currency), and ISO date formatting in exported data.
- Export authorization: only authenticated users with Export permission may download results.

### Out of scope
- Direct automated push to third-party core banking APIs (export files only).
- Proprietary banking XML schema formats (e.g. LIXI) (future scope).

### Explicitly not promised
- Support for deprecated legacy spreadsheet encodings (UTF-8 with BOM standard).

## Work breakdown

1. **Task 1: Safe CSV and JSON Export Serializer**
   - Description: Implement export serializer escaping formula triggers and preserving leading zeros and decimals.
   - Owned paths: `server/export/exportSerializer.ts`
   - Target acceptance fact: Fact 1: Export serializer formats JSON and sanitizes CSV formula triggers

2. **Task 2: Authorized Export Download Endpoint**
   - Description: Implement GET /api/documents/:id/export?format=csv|json with authorization and approval check.
   - Owned paths: `server/routes/exportRoutes.ts`
   - Target acceptance fact: Fact 2: Export endpoint enforces approved status and authorization

3. **Task 3: Client Export Dialog and Trigger Component**
   - Description: Implement ExportModal in React UI allowing users to choose format and download snapshot.
   - Owned paths: `src/components/ExportModal.tsx`
   - Target acceptance fact: Fact 3: UI provides export download modal

4. **Task 4: Export Security and Data Integrity Test Suite**
   - Description: Author automated tests verifying CSV injection mitigation, zero preservation, and unapproved rejection.
   - Owned paths: `tests/stage28Export.test.mjs`
   - Target acceptance fact: Fact 4: Export safety and consistency test suite passes

## Contracts to freeze

```typescript
export interface DocumentExportMetadata {
  documentId: string;
  exportFormat: 'json' | 'csv';
  exportedAt: string;
  exportedBy: string;
  versionSnapshot: number;
  recordCount: number;
  sha256Checksum: string;
}
```

## Fan-out plan

- **Archetype:** Archetype E (Export Formatting and Safety)
- **Lanes:**
  | Lane | Role | Mode | Owned paths | Deliverable |
  |---|---|---|---|---|
  | Lane 1 | impl-lane | CODE | `server/export/exportSerializer.ts,server/routes/exportRoutes.ts` | Export serializer and download endpoint |
  | Lane 2 | impl-lane | CODE | `src/components/ExportModal.tsx` | React export modal component |
  | Lane 3 | test-author | CODE | `tests/stage28Export.test.mjs` | Export security test suite |
- **Shared files:** None

## Acceptance evidence

| Fact | Proving command/artifact | Expected outcome | Status | Evidence path |
|---|---|---|---|---|
| Fact 1: Export serializer formats JSON and sanitizes CSV formula triggers | `node -e "assert(fs.existsSync('server/export/exportSerializer.ts'))"` | Serializer prefixes formula characters with single quote | pending | `automation/runs/stage-28/serializer-audit.json` |
| Fact 2: Export endpoint enforces approved status and authorization | `node --test tests/stage28Export.test.mjs` | Attempting export of unapproved document returns 412 Precondition Failed | pending | `automation/runs/stage-28/auth-audit.json` |
| Fact 3: UI provides export download modal | `node -e "assert(fs.existsSync('src/components/ExportModal.tsx'))"` | Component renders format choices and triggers download | pending | `automation/runs/stage-28/modal-audit.json` |
| Fact 4: Export safety and consistency test suite passes | `node --test tests/stage28Export.test.mjs` | All export security and integrity tests exit 0 | pending | `automation/runs/stage-28/test-summary.json` |

## Tests

### Negative test cases
- Field value `=CMD("calc")` in CSV output escaped to `'=CMD("calc")` to prevent formula execution.
- Exporting document with status `ready_for_review` or `processing` returns 412.
- User without Export role receives 403 Forbidden.

### Boundary test cases
- BSB `062-000` exported with preserved leading zero in both CSV and JSON.
- Currency `$1,250.50` exported with exact decimal representation (`1250.50`).

### Interruption and recovery test cases
- Client aborting download mid-stream cleans up stream without leaking file descriptors.
- Concurrent export requests generate identical bit-for-bit checksums.

### Security and isolation test cases
- UTF-8 BOM prepended to CSV for correct Excel rendering without corruption.
- Export events logged in audit log with user ID and document checksum.

## Dependencies

### Upstream prerequisites
- Stage 26 (Real document/result interface): Export trigger placed in UI.
- Stage 27 (Controlled human review): Only approved documents can be exported.

### Downstream consumers
- Stage 34 (Full data lifecycle): Retention rules cover generated exports.
- Stage 38 (Full workflow and test-effectiveness checks): Validates export in E2E tests.

## External gates

- **External blocker:** None
- **Automated local test harness:** Automated test suite asserting CSV string escaping and JSON schema conformity
- **Owner sign-off item:** None

## Risks and known defects

- Risk 1: Excel stripping leading zeros when opening CSV files without proper escaping.
- Known defect 1: Current application has zero export capabilities.

## Completion draft (S0–S8)

### S0 Reconcile
- Audit export format requirements and Excel CSV injection vulnerabilities. (DRAFT — NOT EVIDENCED)

### S1 Plan
- Draft export serializer schema and security escaping rules. (DRAFT — NOT EVIDENCED)

### S2 Build
- Author `exportSerializer.ts`, `exportRoutes.ts`, `ExportModal.tsx`, and tests. (DRAFT — NOT EVIDENCED)

### S3 Gate
- Execute export test suite via `npm test`. (DRAFT — NOT EVIDENCED)

### S4 Independent review
- Independent review audits CSV injection prevention and approval enforcement. (DRAFT — NOT EVIDENCED)

### S5 Correction
- Tune UTF-8 BOM and character escaping. (DRAFT — NOT EVIDENCED)

### S6 Stage-exit checklist
- Stage-exit checklist verification. (DRAFT — NOT EVIDENCED)

### S7 Record and promote
- Record promotion evidence. (DRAFT — NOT EVIDENCED)

### S8 Advance
- Advance to Stage 29. (DRAFT — NOT EVIDENCED)


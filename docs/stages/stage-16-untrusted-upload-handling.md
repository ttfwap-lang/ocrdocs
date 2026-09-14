---
stage: 16
slug: untrusted-upload-handling
title: Untrusted upload handling
status: not-started
depends_on: [14,15]
blocks: [17,20]
weight_area: security
external_gates: []
charter_lines: "90-91"
gate_quote_sha256: "24c687c74b5b98b9f99b210637274ede2b99fd4ad00819f37758e6a42addfe47"
evidence_dir: automation/runs/stage-16
last_reconciled: 2026-09-13
---

# Stage 16 — Untrusted upload handling



## Charter gate (verbatim)

> Validate file signatures and dimensions/pages/size, bound parser/rendering resources and isolate active content. Gate: malformed/hostile/oversized/interrupted files fail safely without unbounded resources or public executable content.

## Verified current state

- Stage 3 (Architecture and failure model) established: Established component topology (Express server, transactional SQLite, Python OCR worker) and formal failure state machine with bounded worker lease reclaims and non-ephemeral job transitions (types: JobStatus (`docs/stage3/authoritative-contracts.md:15`), FailureTransition (`docs/stage3/authoritative-contracts.md:42`), ComponentTopology (`docs/stage3/component-topology.md:1`)).
- Stage 4 (Truthful demonstration/live separation) established: Isolated simulated demo routes and mock fixtures behind explicit environment flags (DEMO_MODE=false), ensuring live OCR pipelines operate against real extractors (types: ServiceAvailabilityResponse (`src/types.ts:177`), DemoIsolationConfig (`server/routes/demoGuard.ts:1`), LivePipelineGuard (`server/routes/demoGuard.ts:1`)).
- Stage 5 (Reproducible dependencies) established: Pinned Node.js, Python 3.10+, and native OCR runtime dependencies in lockfiles with reproducible local build environments (types: PinnedDependency (`src/types.ts:185`), RuntimeDependencyManifest (`package.json:1`), FieldCategory (`src/types.ts:6`)).
- Stage 6 (Build and startup corrections) established: Guaranteed clean headless application startup with health probes and zero-downtime hot reloading (types: ServerLifecycleConfig (`src/types.ts:223`), HealthCheckResponse (`server/health.ts:1`), StartupProbeConfig (`server/health.ts:1`)).
- Stage 7 (Trustworthy automated checks) established: Established trustworthy automated testing harness with fast feedback loops, flake detection, and concurrent gate verification (types: TestSuiteResult (`docs/stages/stage-07-trustworthy-automated-checks.md:1`), GateVerificationResult (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`), TestHarnessConfig (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`)).
- `PROJECT_CHARTER.md:90-91`: Validate file signatures, dimensions/pages/size, bound parser resources, and isolate active content.
- `server.ts:370-385`: `POST /api/process-document` accepts arbitrary raw text or multipart data without MIME sniffing or magic byte validation.
- DoS vulnerability: Malformed, oversized, or zip-bomb PDFs can exhaust server memory or block the single thread.
- Active content: PDFs may embed JavaScript actions, external URI launches, or malicious form scripts.

## Scope

### In scope
- Magic byte validation (file signatures) for PDF (`%PDF-`), PNG, and JPEG formats.
- Configurable upload bounds: strictly reject files > 25 MiB or > 50 pages.
- PDF active content inspection and sanitization: strip `/JavaScript`, `/Launch`, `/EmbeddedFiles`.
- Bounded resource allocation during multipart streaming upload.

### Out of scope
- Full anti-virus integration (ClamAV) (external gate / optional enterprise add-on).
- Office document formats (DOCX/XLSX) excluded by charter input specification.

### Explicitly not promised
- Execution of interactive PDF scripts or embedded Flash/media.

## Work breakdown

1. **Task 1: Magic Byte and MIME Signature Validator**
   - Description: Implement header inspection validating magic numbers for PDF, PNG, and JPEG files.
   - Owned paths: `server/upload/signatureValidator.ts`
   - Target acceptance fact: Fact 1: Magic byte validator inspects file headers

2. **Task 2: Upload Bounds and Page Limit Enforcer**
   - Description: Enforce 25 MiB size limit and inspect page count before handing to worker.
   - Owned paths: `server/upload/boundsEnforcer.ts`
   - Target acceptance fact: Fact 2: Upload bounds enforce 25 MiB and 50 page caps

3. **Task 3: PDF Active Content Scanner and Sanitizer**
   - Description: Scan PDF byte stream for /JavaScript, /Launch, and /EmbeddedFiles actions; reject or strip.
   - Owned paths: `server/upload/pdfSanitizer.ts`
   - Target acceptance fact: Fact 3: Active content scanner rejects executable PDF streams

4. **Task 4: Untrusted Upload Security Test Suite**
   - Description: Author tests against polyglot files, corrupted headers, oversized payloads, and active content.
   - Owned paths: `tests/stage16Upload.test.mjs`
   - Target acceptance fact: Fact 4: Untrusted upload test suite passes all security vectors

## Contracts to freeze

```typescript
export interface UploadValidationResult {
  valid: boolean;
  detectedFormat: 'pdf' | 'png' | 'jpeg';
  byteSize: number;
  pageCount: number;
  hasActiveContent: boolean;
  sanitized: boolean;
  rejectionReason?: string;
}
```

## Fan-out plan

- **Archetype:** Archetype H (Upload Security and Input Validation)
- **Lanes:**
  | Lane | Role | Mode | Owned paths | Deliverable |
  |---|---|---|---|---|
  | Lane 1 | impl-lane | CODE | `server/upload/**` | Upload validation and sanitizer utilities |
  | Lane 2 | test-author | CODE | `tests/stage16Upload.test.mjs` | Hostile upload and polyglot test suite |
- **Shared files:** None

## Acceptance evidence

| Fact | Proving command/artifact | Expected outcome | Status | Evidence path |
|---|---|---|---|---|
| Fact 1: Magic byte validator inspects file headers | `node -e "assert(fs.existsSync('server/upload/signatureValidator.ts'))"` | Validator inspects initial file bytes against known signatures | pending | `automation/runs/stage-16/signature-audit.json` |
| Fact 2: Upload bounds enforce 25 MiB and 50 page caps | `node --test tests/stage16Upload.test.mjs` | Files exceeding 25 MiB or 50 pages rejected with 413 Payload Too Large | pending | `automation/runs/stage-16/bounds-audit.json` |
| Fact 3: Active content scanner rejects executable PDF streams | `node --test tests/stage16Upload.test.mjs` | PDFs containing /JavaScript rejected or disarmed | pending | `automation/runs/stage-16/sanitizer-audit.json` |
| Fact 4: Untrusted upload test suite passes all security vectors | `node --test tests/stage16Upload.test.mjs` | All malicious and polyglot test cases rejected safely | pending | `automation/runs/stage-16/test-summary.json` |

## Tests

### Negative test cases
- HTML or executable file disguised with .pdf extension rejected by magic byte check.
- PDF with /JavaScript action rejected with explicit active_content error code.
- Encrypted PDF with missing password rejected with password_required code.

### Boundary test cases
- Exactly 50 pages accepted; 51 pages rejected with page_limit_exceeded.
- Zero-byte file rejected with empty_file error.

### Interruption and recovery test cases
- Client aborting connection during 10 MiB upload cleanly frees upload stream.
- Malformed PDF header does not hang stream parser.

### Security and isolation test cases
- Polyglot PDF/ZIP or PDF/HTML files detected and rejected.
- Temporary file paths generated with cryptographically random names.

## Dependencies

### Upstream prerequisites
- Stage 14 (Authentication and authorization): Authenticates uploader before processing.
- Stage 15 (Private original storage): Validated files are transferred to private storage.

### Downstream consumers
- Stage 17 (Page-level native extraction/routing): Routes clean validated pages.
- Stage 20 (Integrated vertical slice): Uses upload validator in end-to-end flow.

## External gates

- **External blocker:** None
- **Automated local test harness:** Automated test suite using synthetic malicious PDF test fixtures
- **Owner sign-off item:** None

## Risks and known defects

- Risk 1: False positives on legitimate banking PDFs containing benign form annotations.
- Known defect 1: `server.ts:378` performs zero validation on incoming payload type.

## Completion draft (S0–S8)

### S0 Reconcile
- Audit upload endpoints and file handling vulnerabilities. (DRAFT — NOT EVIDENCED)

### S1 Plan
- Draft signature validator and active content scanner design. (DRAFT — NOT EVIDENCED)

### S2 Build
- Author `signatureValidator.ts`, `boundsEnforcer.ts`, `pdfSanitizer.ts`, and tests. (DRAFT — NOT EVIDENCED)

### S3 Gate
- Execute upload security tests via `npm test`. (DRAFT — NOT EVIDENCED)

### S4 Independent review
- Independent review audits active content stripping and polyglot handling. (DRAFT — NOT EVIDENCED)

### S5 Correction
- Tune page count parsing performance. (DRAFT — NOT EVIDENCED)

### S6 Stage-exit checklist
- Stage-exit checklist verification. (DRAFT — NOT EVIDENCED)

### S7 Record and promote
- Record promotion evidence. (DRAFT — NOT EVIDENCED)

### S8 Advance
- Advance to Stage 17. (DRAFT — NOT EVIDENCED)


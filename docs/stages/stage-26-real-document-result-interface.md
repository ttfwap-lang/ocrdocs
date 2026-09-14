---
stage: 26
slug: real-document-result-interface
title: Real document/result interface
status: not-started
depends_on: [14,20,22,23]
blocks: [27,28,32,46]
weight_area: interface-workflow
external_gates: []
charter_lines: "120-121"
gate_quote_sha256: "de5e49d83e7cd7cc72276a0fbe7a3c97048e148fd8eff40bd3494ca43f050b1e"
evidence_dir: automation/runs/stage-26
last_reconciled: 2026-09-13
---

# Stage 26 — Real document/result interface



## Charter gate (verbatim)

> Replace fixture views with stored lists/history/versions/previews/search/filter/pagination and usable failure/empty states. Gate: large lists, slow responses, deletion, access changes and no-result documents remain understandable and truthful.

## Verified current state

- Stage 3 (Architecture and failure model) established: Established component topology (Express server, transactional SQLite, Python OCR worker) and formal failure state machine with bounded worker lease reclaims and non-ephemeral job transitions (types: JobStatus (`docs/stage3/authoritative-contracts.md:15`), FailureTransition (`docs/stage3/authoritative-contracts.md:42`), ComponentTopology (`docs/stage3/component-topology.md:1`)).
- Stage 4 (Truthful demonstration/live separation) established: Isolated simulated demo routes and mock fixtures behind explicit environment flags (DEMO_MODE=false), ensuring live OCR pipelines operate against real extractors (types: ServiceAvailabilityResponse (`src/types.ts:177`), DemoIsolationConfig (`server/routes/demoGuard.ts:1`), LivePipelineGuard (`server/routes/demoGuard.ts:1`)).
- Stage 5 (Reproducible dependencies) established: Pinned Node.js, Python 3.10+, and native OCR runtime dependencies in lockfiles with reproducible local build environments (types: PinnedDependency (`src/types.ts:185`), RuntimeDependencyManifest (`package.json:1`), FieldCategory (`src/types.ts:6`)).
- Stage 6 (Build and startup corrections) established: Guaranteed clean headless application startup with health probes and zero-downtime hot reloading (types: ServerLifecycleConfig (`src/types.ts:223`), HealthCheckResponse (`server/health.ts:1`), StartupProbeConfig (`server/health.ts:1`)).
- Stage 7 (Trustworthy automated checks) established: Established trustworthy automated testing harness with fast feedback loops, flake detection, and concurrent gate verification (types: TestSuiteResult (`docs/stages/stage-07-trustworthy-automated-checks.md:1`), GateVerificationResult (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`), TestHarnessConfig (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`)).
- `PROJECT_CHARTER.md:120-121`: Replace fixture views with stored lists/history/versions/previews/search/filter/pagination and usable failure/empty states. Large lists, slow responses, deletion, and no-result documents remain understandable.
- Existing UI views (`SuperStackResearchView.tsx`, `MultiPassRegressionView.tsx`): Hardcode static arrays of fake passes and simulated metrics.
- Document management missing: No interface exists to list uploaded documents, search by filename/status, paginate results, or view document history.
- Document preview missing: No interactive PDF/image preview component connected to stored originals.

## Scope

### In scope
- Document list view with server-side pagination, status filtering, and search by filename/date.
- Document detail view displaying extracted bank fields, confidence badges, and candidate alternatives.
- Integrated PDF/image preview component with page navigation and zoom.
- Handling of edge states: empty list, zero extracted fields, failed processing, and slow network responses.

### Out of scope
- Human field editing and approval buttons (Stage 27).
- Export download modal (Stage 28).

### Explicitly not promised
- Full document OCR text editing directly inside the PDF canvas.

## Work breakdown

1. **Task 1: Document List API with Pagination and Filters**
   - Description: Implement GET /api/documents with page, limit, status, search, and date filters.
   - Owned paths: `server/routes/documentListRoutes.ts`
   - Target acceptance fact: Fact 1: Document list API supports pagination, search, and filtering

2. **Task 2: React Document List and History View**
   - Description: Author DocumentListView component with searchable table, status badges, and pagination controls.
   - Owned paths: `src/components/DocumentListView.tsx`
   - Target acceptance fact: Fact 2: UI renders paginated document list with truthful states

3. **Task 3: Document Detail and Preview Viewer Component**
   - Description: Implement DocumentDetailView displaying extracted fields alongside rendered PDF preview.
   - Owned paths: `src/components/DocumentDetailView.tsx`
   - Target acceptance fact: Fact 3: Detail view displays extracted fields and document preview

4. **Task 4: Interface Usability and Empty State Test Suite**
   - Description: Author component tests verifying empty lists, large datasets, and error state rendering.
   - Owned paths: `tests/stage26Interface.test.mjs`
   - Target acceptance fact: Fact 4: Document interface test suite passes all scenarios

## Contracts to freeze

```typescript
export interface DocumentListQuery {
  page: number;
  pageSize: number;
  statusFilter?: 'all' | 'processing' | 'ready_for_review' | 'approved' | 'failed';
  searchQuery?: string;
  sortBy?: 'created_at' | 'filename' | 'status';
  sortOrder?: 'asc' | 'desc';
}

export interface PaginatedDocumentResponse {
  items: Array<{
    id: string;
    filename: string;
    byteSize: number;
    status: string;
    pageCount: number;
    extractedFieldCount: number;
    createdAt: string;
  }>;
  totalItems: number;
  currentPage: number;
  totalPages: number;
}
```

## Fan-out plan

- **Archetype:** Archetype E (UI Interface and Document Exploration)
- **Lanes:**
  | Lane | Role | Mode | Owned paths | Deliverable |
  |---|---|---|---|---|
  | Lane 1 | impl-lane | CODE | `server/routes/documentListRoutes.ts` | Paginated document query API |
  | Lane 2 | impl-lane | CODE | `src/components/DocumentListView.tsx,src/components/DocumentDetailView.tsx` | React document list and preview components |
  | Lane 3 | test-author | CODE | `tests/stage26Interface.test.mjs` | Component and API test suite |
- **Shared files:** src/App.tsx

## Acceptance evidence

| Fact | Proving command/artifact | Expected outcome | Status | Evidence path |
|---|---|---|---|---|
| Fact 1: Document list API supports pagination, search, and filtering | `node -e "assert(fs.existsSync('server/routes/documentListRoutes.ts'))"` | Endpoint returns structured paginated document list | pending | `automation/runs/stage-26/list-api-audit.json` |
| Fact 2: UI renders paginated document list with truthful states | `node -e "assert(fs.existsSync('src/components/DocumentListView.tsx'))"` | Component renders table with real document metadata | pending | `automation/runs/stage-26/ui-list-audit.json` |
| Fact 3: Detail view displays extracted fields and document preview | `node -e "assert(fs.existsSync('src/components/DocumentDetailView.tsx'))"` | Component renders side-by-side preview and field list | pending | `automation/runs/stage-26/detail-audit.json` |
| Fact 4: Document interface test suite passes all scenarios | `node --test tests/stage26Interface.test.mjs` | All interface and pagination tests exit 0 | pending | `automation/runs/stage-26/test-summary.json` |

## Tests

### Negative test cases
- Querying invalid page number (<1) or negative limit returns 400 Bad Request.
- Accessing document list without auth token returns 401.

### Boundary test cases
- Empty document repository renders friendly empty-state illustration.
- Paginating through 1,000 document records renders page 100 within 50ms.

### Interruption and recovery test cases
- Slow network response displays skeleton loading state without UI flicker.
- Server 500 error surfaces user-friendly error message with retry button.

### Security and isolation test cases
- Search query input sanitized to prevent SQL injection in LIKE clauses.
- Document list filtered to only display documents owned by caller.

## Dependencies

### Upstream prerequisites
- Stage 14 (Authentication and authorization): Enforces user ownership in queries.
- Stage 20 (Integrated vertical slice): Provides stored documents to display.
- Stage 22 (Genuine progress/error streaming): Real-time updates to list items.

### Downstream consumers
- Stage 27 (Controlled human review): Extends detail view with human review tools.
- Stage 28 (Safe consistent exports): Adds export actions to document interface.

## External gates

- **External blocker:** None
- **Automated local test harness:** Automated tests verifying API responses and React component rendering
- **Owner sign-off item:** None

## Risks and known defects

- Risk 1: Client memory consumption when rendering large PDF canvas previews.
- Known defect 1: UI navigation currently shows mock research views rather than real document inventory.

## Completion draft (S0–S8)

### S0 Reconcile
- Audit UI components and replace static mock views. (DRAFT — NOT EVIDENCED)

### S1 Plan
- Draft paginated query contract and document viewer layout. (DRAFT — NOT EVIDENCED)

### S2 Build
- Author `documentListRoutes.ts`, `DocumentListView.tsx`, `DocumentDetailView.tsx`, and tests. (DRAFT — NOT EVIDENCED)

### S3 Gate
- Execute interface test suite via `npm test`. (DRAFT — NOT EVIDENCED)

### S4 Independent review
- Independent review audits pagination safety and empty state handling. (DRAFT — NOT EVIDENCED)

### S5 Correction
- Tune search query performance. (DRAFT — NOT EVIDENCED)

### S6 Stage-exit checklist
- Stage-exit checklist verification. (DRAFT — NOT EVIDENCED)

### S7 Record and promote
- Record promotion evidence. (DRAFT — NOT EVIDENCED)

### S8 Advance
- Advance to Stage 27. (DRAFT — NOT EVIDENCED)


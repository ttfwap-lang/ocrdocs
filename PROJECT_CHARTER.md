# OCRDocs project charter

## Mission and completion target

Deliver a self-hosted document-processing application that imports real banking documents, extracts and validates fields, preserves source evidence, supports human correction and approval, and exports the approved result without losing jobs or exposing documents to unauthorized users.

The engineering target is 99/100 readiness **within the declared release scope**, not 99% OCR accuracy, guaranteed availability, or absolute flawlessness. Planning does not increase completion. The earlier 30/100 source-only estimate is not a certified runtime assessment. No stage is complete without evidence, and security, integrity, recovery, licensing, and required workflows are mandatory gates regardless of the weighted score.

## Autonomous decisions and boundaries

These are explicit engineering assumptions authorized by the request to proceed without clarification, not claims of external approval:

- First deployment: one organization per installation, multiple authenticated users, a single host, private storage, one worker initially, bounded concurrency; shared multi-tenant hosting and automatic financial decisions are not part of this release.
- Initial inputs: English digital/scanned/mixed PDFs and PNG/JPEG, including rotated/blank pages; initial configurable limits are 25 MiB and 50 pages. Reject encrypted/corrupt/unsupported content clearly. Handwriting and arbitrary tables are not promised; unsupported layouts require review.
- Required journeys: upload and Google Drive import; durable processing; evidence-backed extraction; review/correction/approval; authorized CSV/JSON export; restart recovery; account/document deletion.
- Bank field definitions currently in the application are the initial field catalog; document/applicant association and layout coverage must be catalogued in Stage 2, not guessed from examples.
- Local OCR only by default. No document text may be sent to a cloud OCR/chat service without an explicit configured data-sharing policy and legitimate credentials. Demo output never substitutes for a failed live request.
- All downstream business use requires human-approved results. Formatting/checksum validation is not identity or account verification.
- Provisional engineering quality gates: at least 95% normalized exact match on labelled required fields and at least 99% precision for extracted critical identifiers, reported per field/layout with sample counts, recall, review burden and confidence intervals. These are targets, not observed results or guarantees; insufficient or unauthorized evaluation data blocks quality sign-off.
- Recovery targets for this single-host scope: backups no older than 24 hours and demonstrated clean-host restoration within four hours. No uptime SLA or round-the-clock staffed support is promised.
- Data is private, originals/results are retained until explicit deletion or configured retention expiry, temporary files expire after processing, and backups have a disclosed finite retention period selected before real customer use. Do not invent legal permission, residency certification, or retention obligations.
- Use synthetic or properly authorized de-identified documents until real-data handling is approved. External security review, legal review and customer acceptance remain genuine external gates; an agent cannot self-certify their completion.

## Master architecture

1. Retain the React/TypeScript UI and Express server; the TypeScript matcher/validators become the authoritative field-selection and validation implementation.
2. A Python worker performs real page parsing and OCR and returns a versioned JSON contract containing page text, available coordinates, engine/model versions, timings and structured failures; it does not maintain a competing canonical field database.
3. For the initial single-host deployment, use a transactional SQLite application database with migrations, constraints, durable jobs, attempts/leases, result versions, reviews, ownership and audit metadata; test the actual selected driver/runtime before adoption. DuckDB may remain an optional analytics/export tool, not the authority for application job state.
4. Store originals and derived files privately outside public assets, with generated identifiers, integrity hashes and ownership checks. A documented reconciliation procedure handles interrupted file/database operations.
5. Use bounded worker claims and retries with atomic commits, not an EventEmitter as a durable queue. At-least-once execution may occur; authoritative commits must be idempotent.
6. Stream genuine status events and reconcile the UI with durable job state after refresh/disconnection. Event delivery is not the source of truth.
7. Use established authentication/session components, server-side role/document authorization, isolated/bounded parsing, redacted diagnostics, explicit network boundaries and protected downloads.
8. Model all results as raw/canonical values, applicant/document/version references, evidence, candidate provenance, validation, uncertainty and review state. Never replace reviewed values silently on reprocessing.
9. Implement one qualified OCR engine first; qualify additional passes/providers against labelled data before enabling them. Do not add distributed infrastructure without measured need.
10. Keep verification separate from implementation: unit, integration, worker, browser, security, failure/recovery, evaluation and deployment checks, with versioned artifacts and actual exit codes.

## Evidence and scoring

Weights remain: interface/workflow 15; extraction/validation 20; real ingestion/OCR 25; persistence/recovery 15; security 10; tests/deployment/operations 15. Points require demonstrated outcomes, not source size or a count of completed stages. Every stage records inputs, changes, actual checks, errors/fixes, remaining risks and the next detailed plan in STATE.md and automation checkpoints. Test fixtures are evidence about their tested conditions, not proof of universal correctness.

## Complete roadmap

Stages execute in order, with design decisions for later gates made early: scope/quality/privacy in 1–3, license checks before dependency adoption, and tests with every code change. The final audit stages deepen rather than replace early controls. Each entry contains the required work and its exit gate.

### Stage 1 — Commercial release contract
Create the acceptance register, assumptions, supported deployment, prohibited uses, critical promises and release ownership. Gate: every promise has a check or explicitly unresolved external approval; assumptions are distinguished from verified facts.

### Stage 2 — Document/workflow matrix
Inventory fields and routes and specify supported formats/layouts, languages, limits, applicant association and extract/review/reject outcomes. Gate: each supported combination has a test strategy and unsupported inputs have visible handling.

### Stage 3 — Architecture and failure model
Record components, authoritative data/contracts, identity boundaries, storage consistency and failure transitions. Gate: walk through interrupted upload, worker/database/storage failure, restart and partial commits without reliance on ephemeral job state.

### Stage 4 — Truthful demonstration/live separation
Isolate all fixtures, simulated OCR/Drive/passes and hardcoded health from live paths. Gate: missing services or credentials never yield fabricated results, sample substitution or success.

### Stage 5 — Reproducible dependencies
Pin compatible runtimes, packages, native tools and models, screen licenses and document installation/update policy. Gate: clean target installation works without hidden caches/settings; new engine choices repeat these checks.

### Stage 6 — Build and startup corrections
Reproduce and correct type-check, build, environment loading and production-route defects. Gate: development/production startup, missing settings, port conflicts, unavailable dependencies and shutdown produce correct outcomes and exit status.

### Stage 7 — Trustworthy automated checks
Separate unit/integration/worker/browser/deployment suites and correct obsolete smoke checks. Gate: seeded failures and timeouts fail the pipeline, test discovery is visible, and no skipped/swallowed failure creates a pass.

### Stage 8 — Governed evaluation corpus
Record permissions, provenance, annotation instructions, reviewed labels, corpus versions and development/held-out membership. Gate: representative coverage, duplicate leakage checks and sample adequacy support the intended claims.

### Stage 9 — Extraction reproductions and boundaries
Test dates/leap days/future dates, leading zeros, repeated anchors, missing/invalid values, currencies and wrong-applicant associations. Gate: known defects fail before fixes, time-dependent checks use a fixed clock, and false extraction is detected.

### Stage 10 — Correct extraction defects
Fix reproduced capture/indexing and normalization errors and masked failures. Gate: reproductions and all affected downstream tests pass without weakening checks or presenting format validation as authoritative identity verification.

### Stage 11 — Versioned result contracts
Define and validate request/results, document/applicant/version identity, evidence, raw/canonical values, confidence origin, review states and errors. Gate: invalid limits/states/contracts are rejected and every component agrees on meaning.

### Stage 12 — Transactional application storage
Implement migrations/constraints for documents, jobs, attempts, candidates, results, ownership and reviews. Gate: interrupted writes cannot leave false completion; file/record inconsistencies have tested recovery.

### Stage 13 — Persistence invariants
Test the actual database for same names, duplicate processing, concurrency, migrations, rollback, restart and protected reviewed values. Gate: identity/history/access remain correct and incompatible existing pragmas/overwrite rules are removed.

### Stage 14 — Authentication and authorization
Protect originals, previews, jobs, streams, results, exports, administration and auxiliary endpoints. Gate: allowed/denied role matrices, guessed IDs, logout/revocation and any required tenant boundary pass server-side tests.

### Stage 15 — Private original storage
Use generated keys, integrity hashes, private delivery, ownership and documented encryption/key handling. Gate: duplicate content/names, interrupted writes, guessed paths and revoked downloads do not leak or corrupt data.

### Stage 16 — Untrusted upload handling
Validate file signatures and dimensions/pages/size, bound parser/rendering resources and isolate active content. Gate: malformed/hostile/oversized/interrupted files fail safely without unbounded resources or public executable content.

### Stage 17 — Page-level native extraction/routing
Preserve page order and inspect usable native text versus OCR needs. Gate: digital/scanned/mixed/rotated/blank and misleading text-layer fixtures never silently omit supported pages.

### Stage 18 — Real qualified OCR
Select one engine by measured examples, licensing, compatibility and resource use. Gate: real pixels yield traceable output; cold starts, missing models, supported hardware fallbacks, timeouts and memory exhaustion are explicit.

### Stage 19 — Durable job transitions
Implement a state table, atomic claims/leases, attempts, retry ownership and authoritative commit rules. Gate: racing workers, expired claims, restart and duplicate completion cannot create conflicting results or invalid transitions.

### Stage 20 — Integrated vertical slice
Connect upload/storage/jobs/parsing/OCR/matching/validation/persistence/UI. Gate: unfamiliar examples for each supported initial format complete using their actual bytes/text and a consistent document version, not fixtures.

### Stage 21 — Immutable extraction evidence
Persist attempt evidence, page/text/coordinates where available, model/matcher versions, candidates and selection/normalization reasons. Gate: every displayed field is traceable and historical evidence is not invented or rewritten.

### Stage 22 — Genuine progress/error streaming
Define events/order/terminal state and reconcile fragmented/duplicate/malformed streams with durable state. Gate: server/worker failures surface and no UI claims nonexistent processing or remains active after known completion.

### Stage 23 — Refresh/reconnect recovery
Load authorized persisted state and replay only when justified. Gate: refresh/disconnect/multiple tabs do not lose results, repeat work or allow stale events to replace terminal state.

### Stage 24 — Bounded retries/deadlines/cancellation
Classify permanent/transient errors and define backoff, budgets and cancellation/completion races. Gate: cancellation during parsing/OCR/commit and late attempts cannot revive cancelled work or loop forever.

### Stage 25 — Combined fault sequences
Test worker crashes plus server restarts, duplicate delivery during recovery and storage failure during commits. Gate: original integrity, ownership, attempt history, uniqueness and terminal outcomes remain correct with reproducible evidence.

### Stage 26 — Real document/result interface
Replace fixture views with stored lists/history/versions/previews/search/filter/pagination and usable failure/empty states. Gate: large lists, slow responses, deletion, access changes and no-result documents remain understandable and truthful.

### Stage 27 — Controlled human review
Persist corrections, reviewer identity, rationale, approval/reopening and optimistic concurrency. Gate: simultaneous edits, revoked reviewers and reprocessing cannot silently lose or replace approved values.

### Stage 28 — Safe consistent exports
Export approved versioned snapshots preserving identifiers, decimals, dates, missing values and applicant association. Gate: Unicode/escaping/formulas, concurrent edits, interrupted downloads and authorization checks preserve safety and consistency.

### Stage 29 — Real constrained Drive authorization
Select user/service-account model, minimal scopes, folder boundaries, encrypted credentials and expiry/revocation handling. Gate: forbidden folders, changed permissions and cross-owner credential use fail without secrets or ownership drift.

### Stage 30 — Resumable incremental Drive sync
Persist remote identity/version/checkpoints/download/processing states and change/deletion policy. Gate: pagination, throttling, interruption, repeat sync and mid-run revocation reconcile with actual files and do not omit/duplicate work silently.

### Stage 31 — Evidence-driven extra passes
Implement eligibility/budgets/stopping, immutable pass history and reviewed-value protection. Gate: labelled benefits and regressions are measured; more populated fields or higher heuristic confidence is not called monotonic accuracy.

### Stage 32 — Defined operational metrics
Distinguish documents/pages/jobs/attempts/retries and specify denominators/freshness. Gate: dashboards reconcile after failure/deletion/retry and completeness is not called recall without ground truth.

### Stage 33 — Controlled overload and quotas
Bound input, queues, workers, quotas and expensive auxiliary requests. Gate: saturation/conflicting/slow jobs cannot starve users, lose accepted work or crash the service without actionable diagnosis.

### Stage 34 — Full data lifecycle
Cover originals/text/previews/results/reviews/exports/caches/temp/logs/backups with retention/deletion rules. Gate: interrupted deletion and backup restoration honor documented deletion obligations without hidden retained copies.

### Stage 35 — Pre-pilot security closure
Threat-model identity, files/previews, network destinations, secrets, worker privileges and external data sharing. Gate: no known critical/high exploitable issue in enabled scope; real-data use is authorized and never assumed.

### Stage 36 — Reproducible quality benchmark
Define metrics for correct/incorrect/missing/extra/wrong-applicant/normalized/reviewed values and verify calculations manually on small examples. Gate: versioned per-field/layout results disclose denominators, review/abstention and statistical uncertainty.

### Stage 37 — Development-only quality improvement
Tune routing/preprocessing/matching/normalization/review thresholds on development data, recording versions and regressions. Gate: measured critical-field quality and review burden meet scope gates without contaminating held-out evaluation.

### Stage 38 — Full workflow and test-effectiveness checks
Run browser-to-worker/database upload/Drive/review/export plus negative/failure paths with real OCR. Gate: controlled breaks in ownership, persistence, terminal errors and export consistency are caught; flaky tests are fixed rather than rerun until green.

### Stage 39 — Representative staging
Deploy the release artifact with actual worker/storage/network/permission/readiness configuration. Gate: recreation, credential rotation, missing dependencies, stopped workers and full storage behave correctly without hidden setup or production data.

### Stage 40 — Capacity, resource and cost evidence
Measure queue delay, latency distribution, throughput, failures, memory/storage and cost on target hardware/document mix. Gate: cold/repeated/large/difficult/retry/sustained workloads establish honest limits including human-review cost.

### Stage 41 — Tested backup/restore/rollback
Restore originals/database/permissions/reviews/deletion records in a clean environment and rehearse compatible rollback. Gate: integrity/export and measured recovery objectives pass for another operator, not just backup-file creation.

### Stage 42 — Frozen independent evaluation/pilot
Freeze code/models/contracts/config and test unfamiliar held-out documents with authorized representative users. Gate: scope/quality/review-effort gates pass with disclosed limitations; changes receive independent revalidation.

### Stage 43 — Evidence-backed pilot gate
Assemble scope, test/benchmark/security/recovery/user evidence and risk register. Gate: unsupported claims and scope manipulation are rejected; remaining commercial gaps are specific and owned.

### Stage 44 — Reliability commitments verified
Test promised host/worker/database/storage/network/vendor failure tolerance and capacity/maintenance procedures. Gate: actual architecture and staffing support commitments; no invented redundancy or uptime claims.

### Stage 45 — Identity/organization lifecycle
Finish invitations, roles, disabling, ownership transfer, session revocation, closure and controlled support access. Gate: revocation during jobs/downloads and organization closure obey documented boundaries and produce attributable audit events.

### Stage 46 — Accessibility/usability/browser qualification
Define browser/accessibility targets and test keyboard/focus/labels/announcements/contrast/zoom/previews/errors and long documents. Gate: primary journeys and representative assistive checks pass; scanner-only results do not imply certification.

### Stage 47 — Commercial license/asset audit
Reconcile deployed packages/native tools/models/weights/fonts/images/datasets and redistribution terms/notices. Gate: no unresolved essential use restriction, with qualified legal interpretation where required.

### Stage 48 — Customer activation/entitlements
Implement documented provisioning/plans/quotas/suspension/offboarding and only required payment mechanisms. Gate: repeats/failures/plan changes/retries/cancellations cannot bypass entitlements or create incorrect usage charges.

### Stage 49 — Compatible upgrades and preserved history
Version APIs/results/exports/models/migrations and supported worker/server combinations. Gate: existing-data upgrades, failed migrations and rollback preserve historical approvals and explicitly reject unsupported combinations.

### Stage 50 — Independent security assessment
Obtain actual independent review of complete deployed boundaries and retest fixes/material changes. Gate: no unresolved critical/high exploitable finding; internal agent review is not mislabelled independent certification.

### Stage 51 — Privacy/contracts/claims alignment
Compare actual data/subprocessor/backup/deletion flows with commercial terms, support and residency promises. Gate: qualified review addresses legal obligations; no fabricated compliance, permission or accuracy guarantees.

### Stage 52 — Traceable controlled releases
Produce immutable versioned artifacts, dependency/model inventories, integrity verification, build provenance, approvals and deployment configuration. Gate: clean deployment matches the manifest and cannot silently replace reviewed models/dependencies.

### Stage 53 — Transferable support/incident operations
Assign real owners/runbooks for security updates, vendor failures, rotation, queues, storage, recovery and suspected exposure. Gate: another operator executes documented procedures and advertised response hours match actual staffing.

### Stage 54 — Guarded release observation
Freeze a candidate and predefine representative cohort/workload, observation scope, pause/rollback triggers and monitoring. Gate: material defects/hidden manual work are addressed, affected evidence is revalidated, and duration is justified by workload.

### Stage 55 — Final 99/100 release decision
Review frozen scope and weighted evidence with independent findings and handover. Gate: all mandatory gates pass, score is justified and residual limitations are explicit, low-impact and owned; serious defects cannot occupy the final point.

## Execution and external boundaries

RULES.md governs the execute/review/state/plan/proceed cycle. A 72-hour limit is a requested maximum runtime, not a promise of completion. The runner must obey its actual host/process lifetime, authentication, deadlines, resource limits and agent capabilities. Never invent unlimited budgets, supported flags, independent approvals or successful tests. Unavailable credentials/permissions or external reviews are recorded as blockers; continue only genuinely independent authorized work.

## Stage dossiers and execution index

Execution-ready stage dossiers with task breakdowns, owned paths, frozen contracts, fan-out plans, and acceptance evidence are maintained under `docs/stages/`. See `docs/stages/README.md` for the dynamic status index tracking progress across all 55 stages.
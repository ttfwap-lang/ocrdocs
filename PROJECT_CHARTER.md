# PROJECT_CHARTER.md - OCRDocuments 55-Stage Charter

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


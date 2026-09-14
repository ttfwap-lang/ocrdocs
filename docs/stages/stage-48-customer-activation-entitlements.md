---
stage: 48
slug: customer-activation-entitlements
title: Customer activation/entitlements
status: not-started
depends_on: [43,45]
blocks: [52,54]
weight_area: interface-workflow
external_gates: []
charter_lines: "186-187"
gate_quote_sha256: "a6a79da9028d67d94c7b478d025e16197ed49f8d99e4e4041da0f33cdbd51a16"
evidence_dir: automation/runs/stage-48
last_reconciled: 2026-09-13
---

# Stage 48 — Customer activation/entitlements



## Charter gate (verbatim)

> Implement documented provisioning/plans/quotas/suspension/offboarding and only required payment mechanisms. Gate: repeats/failures/plan changes/retries/cancellations cannot bypass entitlements or create incorrect usage charges.

## Verified current state

- Stage 3 (Architecture and failure model) established: Established component topology (Express server, transactional SQLite, Python OCR worker) and formal failure state machine with bounded worker lease reclaims and non-ephemeral job transitions (types: JobStatus (`docs/stage3/authoritative-contracts.md:15`), FailureTransition (`docs/stage3/authoritative-contracts.md:42`), ComponentTopology (`docs/stage3/component-topology.md:1`)).
- Stage 4 (Truthful demonstration/live separation) established: Isolated simulated demo routes and mock fixtures behind explicit environment flags (DEMO_MODE=false), ensuring live OCR pipelines operate against real extractors (types: ServiceAvailabilityResponse (`src/types.ts:177`), DemoIsolationConfig (`server/routes/demoGuard.ts:1`), LivePipelineGuard (`server/routes/demoGuard.ts:1`)).
- Stage 5 (Reproducible dependencies) established: Pinned Node.js, Python 3.10+, and native OCR runtime dependencies in lockfiles with reproducible local build environments (types: PinnedDependency (`src/types.ts:185`), RuntimeDependencyManifest (`package.json:1`), FieldCategory (`src/types.ts:6`)).
- Stage 6 (Build and startup corrections) established: Guaranteed clean headless application startup with health probes and zero-downtime hot reloading (types: ServerLifecycleConfig (`src/types.ts:223`), HealthCheckResponse (`server/health.ts:1`), StartupProbeConfig (`server/health.ts:1`)).
- Stage 7 (Trustworthy automated checks) established: Established trustworthy automated testing harness with fast feedback loops, flake detection, and concurrent gate verification (types: TestSuiteResult (`docs/stages/stage-07-trustworthy-automated-checks.md:1`), GateVerificationResult (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`), TestHarnessConfig (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`)).
- `PROJECT_CHARTER.md:186-187`: Implement documented provisioning/plans/quotas/suspension/offboarding and only required payment mechanisms. Repeats/failures/plan changes/retries/cancellations cannot bypass entitlements or create incorrect charges.
- Entitlement enforcement absent: Application currently allows unlimited document uploads without checking plan tiers or monthly quotas.
- Subscription modeling: Need SQLite schema tracking organization tier (Standard: 500 docs/mo, Enterprise: unlimited), monthly usage counters, and quota reset dates.
- Quota enforcement: Upload endpoint must reject requests with 402/403 when monthly allowance is exhausted.

## Scope

### In scope
- Customer subscription tier and quota data model in SQLite (`organizations`, `entitlements`, `usage_records`).
- Quota enforcement middleware: strictly check monthly document upload allowance before job creation.
- Graceful quota exhaustion handling: return HTTP 402 Payment Required with usage details and reset date.
- Administrative entitlement overrides and plan upgrade simulation API.

### Out of scope
- Live Stripe / credit card payment gateway integration (mock billing webhooks sufficient for single-host).
- Dynamic metered invoicing calculations.

### Explicitly not promised
- Automated debt collection or financial banking reconciliation.

## Work breakdown

1. **Task 1: Organization Entitlements and Usage Schema**
   - Description: Define entitlements and usage tables tracking monthly allowances, consumed pages, and reset cycles.
   - Owned paths: `server/db/migrations/004_entitlements.sql`
   - Target acceptance fact: Fact 1: Entitlements schema defines quotas and monthly usage tracking

2. **Task 2: Quota Enforcement and Entitlement Middleware**
   - Description: Implement middleware verifying available quota before accepting uploads; return 402 on exhaustion.
   - Owned paths: `server/middleware/quotaEnforcer.ts`
   - Target acceptance fact: Fact 2: Quota enforcer blocks uploads when monthly allowance exhausted

3. **Task 3: Client Subscription Usage and Quota Indicator**
   - Description: Implement QuotaIndicator in Navbar and upload dialog showing remaining documents in billing cycle.
   - Owned paths: `src/components/QuotaIndicator.tsx`
   - Target acceptance fact: Fact 3: UI displays active tier and remaining quota balance

4. **Task 4: Entitlements and Quota Bypass Test Suite**
   - Description: Author automated tests attempting quota bypass via concurrent uploads, retries, and cancellations.
   - Owned paths: `tests/stage48Entitlements.test.mjs`
   - Target acceptance fact: Fact 4: Entitlement and quota test suite passes

## Contracts to freeze

```typescript
export interface OrganizationEntitlement {
  orgId: string;
  planTier: 'trial' | 'standard' | 'enterprise';
  monthlyDocumentQuota: number;
  documentsConsumed: number;
  billingCycleResetsAt: string;
  isSuspended: boolean;
}
```

## Fan-out plan

- **Archetype:** Archetype E (Entitlement Enforcement and Quotas)
- **Lanes:**
  | Lane | Role | Mode | Owned paths | Deliverable |
  |---|---|---|---|---|
  | Lane 1 | impl-lane | CODE | `server/db/migrations/004_entitlements.sql,server/middleware/quotaEnforcer.ts` | Entitlement schema and enforcement middleware |
  | Lane 2 | impl-lane | CODE | `src/components/QuotaIndicator.tsx` | UI quota indicator component |
  | Lane 3 | test-author | CODE | `tests/stage48Entitlements.test.mjs` | Quota enforcement test suite |
- **Shared files:** src/components/Navbar.tsx

## Acceptance evidence

| Fact | Proving command/artifact | Expected outcome | Status | Evidence path |
|---|---|---|---|---|
| Fact 1: Entitlements schema defines quotas and monthly usage tracking | `node -e "assert(fs.existsSync('server/db/migrations/004_entitlements.sql'))"` | SQL migration creates entitlements and usage_records tables | pending | `automation/runs/stage-48/schema-audit.json` |
| Fact 2: Quota enforcer blocks uploads when monthly allowance exhausted | `node --test tests/stage48Entitlements.test.mjs` | Exhausted quota returns 402 with structured reset details | pending | `automation/runs/stage-48/enforcer-audit.json` |
| Fact 3: UI displays active tier and remaining quota balance | `node -e "assert(fs.existsSync('src/components/QuotaIndicator.tsx'))"` | Component renders plan name and remaining balance progress bar | pending | `automation/runs/stage-48/ui-audit.json` |
| Fact 4: Entitlement and quota test suite passes | `node --test tests/stage48Entitlements.test.mjs` | All quota bypass and entitlement tests exit 0 | pending | `automation/runs/stage-48/test-summary.json` |

## Tests

### Negative test cases
- Uploading document when quota is exhausted returns 402 Payment Required.
- Suspended organization upload rejected with 403 Account Suspended.
- Failed processing job does not deduct document from usage quota.

### Boundary test cases
- Document 500 of 500 quota accepted; document 501 rejected.
- Quota resets cleanly on 1st day of billing cycle.

### Interruption and recovery test cases
- Concurrency race: 5 simultaneous uploads contesting last available slot admits exactly 1.
- Cancelling job refunds usage count atomically.

### Security and isolation test cases
- Client cannot manipulate quota counter via request headers or cookies.
- Plan changes require Admin role and generate attributable audit log.

## Dependencies

### Upstream prerequisites
- Stage 43 (Evidence-backed pilot gate): Pilot baseline.
- Stage 45 (Identity/organization lifecycle): Organization identity models.

### Downstream consumers
- Stage 52 (Traceable controlled releases): Entitlement modules bundled in release.
- Stage 54 (Guarded release observation): Monitored during release observation.

## External gates

- **External blocker:** None
- **Automated local test harness:** Automated test suite simulating quota limits and verifying HTTP 402 responses
- **Owner sign-off item:** None

## Risks and known defects

- Risk 1: Double-charging quota if job is retried by worker.
- Known defect 1: Current application has zero entitlement or quota controls.

## Completion draft (S0–S8)

### S0 Reconcile
- Audit subscription requirements and usage counting logic. (DRAFT — NOT EVIDENCED)

### S1 Plan
- Draft entitlements schema and concurrency-safe quota deduction. (DRAFT — NOT EVIDENCED)

### S2 Build
- Author `004_entitlements.sql`, `quotaEnforcer.ts`, `QuotaIndicator.tsx`, and tests. (DRAFT — NOT EVIDENCED)

### S3 Gate
- Execute entitlement test suite via `npm test`. (DRAFT — NOT EVIDENCED)

### S4 Independent review
- Independent review audits quota bypass prevention and retry refunding. (DRAFT — NOT EVIDENCED)

### S5 Correction
- Tune billing cycle reset logic. (DRAFT — NOT EVIDENCED)

### S6 Stage-exit checklist
- Stage-exit checklist verification. (DRAFT — NOT EVIDENCED)

### S7 Record and promote
- Record promotion evidence. (DRAFT — NOT EVIDENCED)

### S8 Advance
- Advance to Stage 49. (DRAFT — NOT EVIDENCED)


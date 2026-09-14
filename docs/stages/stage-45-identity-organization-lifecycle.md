---
stage: 45
slug: identity-organization-lifecycle
title: Identity/organization lifecycle
status: not-started
depends_on: [14,43]
blocks: [48,51]
weight_area: security
external_gates: []
charter_lines: "177-178"
gate_quote_sha256: "4131f76e9ba8e40b3a3f108a8b0f3a0dadde2b9330247ddb79df700d1c43f363"
evidence_dir: automation/runs/stage-45
last_reconciled: 2026-09-13
---

# Stage 45 — Identity/organization lifecycle



## Charter gate (verbatim)

> Finish invitations, roles, disabling, ownership transfer, session revocation, closure and controlled support access. Gate: revocation during jobs/downloads and organization closure obey documented boundaries and produce attributable audit events.

## Verified current state

- Stage 3 (Architecture and failure model) established: Established component topology (Express server, transactional SQLite, Python OCR worker) and formal failure state machine with bounded worker lease reclaims and non-ephemeral job transitions (types: JobStatus (`docs/stage3/authoritative-contracts.md:15`), FailureTransition (`docs/stage3/authoritative-contracts.md:42`), ComponentTopology (`docs/stage3/component-topology.md:1`)).
- Stage 4 (Truthful demonstration/live separation) established: Isolated simulated demo routes and mock fixtures behind explicit environment flags (DEMO_MODE=false), ensuring live OCR pipelines operate against real extractors (types: ServiceAvailabilityResponse (`src/types.ts:177`), DemoIsolationConfig (`server/routes/demoGuard.ts:1`), LivePipelineGuard (`server/routes/demoGuard.ts:1`)).
- Stage 5 (Reproducible dependencies) established: Pinned Node.js, Python 3.10+, and native OCR runtime dependencies in lockfiles with reproducible local build environments (types: PinnedDependency (`src/types.ts:185`), RuntimeDependencyManifest (`package.json:1`), FieldCategory (`src/types.ts:6`)).
- Stage 6 (Build and startup corrections) established: Guaranteed clean headless application startup with health probes and zero-downtime hot reloading (types: ServerLifecycleConfig (`src/types.ts:223`), HealthCheckResponse (`server/health.ts:1`), StartupProbeConfig (`server/health.ts:1`)).
- Stage 7 (Trustworthy automated checks) established: Established trustworthy automated testing harness with fast feedback loops, flake detection, and concurrent gate verification (types: TestSuiteResult (`docs/stages/stage-07-trustworthy-automated-checks.md:1`), GateVerificationResult (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`), TestHarnessConfig (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`)).
- `PROJECT_CHARTER.md:177-178`: Finish invitations, roles, disabling, ownership transfer, session revocation, closure, and controlled support access. Revocation during jobs/downloads and organization closure obey documented boundaries.
- User lifecycle incomplete: Stage 14 implemented basic authentication, but user invitations, role changes, account disabling, and organization closure remain unbuilt.
- Mid-flight revocation: If an administrator disables a user while they are actively downloading a file, the download stream must be terminated.
- Audit trail: Need attributable event logging for all administrative identity actions.

## Scope

### In scope
- User lifecycle management: Invitation tokens, password reset flows, account disabling, and role reassignment.
- Organization closure: soft-delete and purge of all organizational data upon account closure.
- Real-time session termination: disabling user immediately revokes active JWT/session tokens.
- Comprehensive identity audit log: record all role changes, login attempts, and password resets.

### Out of scope
- Multi-tenant cross-organization billing splits (charter assumption 13: single organization per install).
- LDAP / Active Directory directory synchronization.

### Explicitly not promised
- Self-service account registration without admin invitation.

## Work breakdown

1. **Task 1: User Invitation and Account Management Service**
   - Description: Implement user invite generation, role modification, and account disabling in SQLite.
   - Owned paths: `server/auth/userManagementService.ts`
   - Target acceptance fact: Fact 1: User management service handles invites, disabling, and roles

2. **Task 2: Instantaneous Session Revocation Guard**
   - Description: Implement token revocation blacklist/cache checked on every authenticated HTTP request and download stream.
   - Owned paths: `server/auth/revocationGuard.ts`
   - Target acceptance fact: Fact 2: Revocation guard terminates active user sessions immediately

3. **Task 3: Admin User and Role Management UI View**
   - Description: Implement UserManagementView in React UI allowing Admin users to invite, edit, and disable users.
   - Owned paths: `src/components/UserManagementView.tsx`
   - Target acceptance fact: Fact 3: UI provides administrative user management interface

4. **Task 4: Identity Lifecycle Security Test Suite**
   - Description: Author automated tests verifying invite expiration, instant revocation mid-stream, and disabling.
   - Owned paths: `tests/stage45IdentityLifecycle.test.mjs`
   - Target acceptance fact: Fact 4: Identity lifecycle security test suite passes

## Contracts to freeze

```typescript
export interface UserInvitation {
  inviteToken: string;
  email: string;
  role: 'operator' | 'reviewer' | 'admin';
  invitedBy: string;
  expiresAt: string;
}

export interface UserLifecycleEvent {
  eventId: string;
  targetUserId: string;
  action: 'invited' | 'activated' | 'role_changed' | 'disabled' | 'closed';
  performedBy: string;
  timestamp: string;
  details: Record<string, any>;
}
```

## Fan-out plan

- **Archetype:** Archetype H (Identity Lifecycle and Session Revocation)
- **Lanes:**
  | Lane | Role | Mode | Owned paths | Deliverable |
  |---|---|---|---|---|
  | Lane 1 | impl-lane | CODE | `server/auth/userManagementService.ts,server/auth/revocationGuard.ts` | User management service and revocation guard |
  | Lane 2 | impl-lane | CODE | `src/components/UserManagementView.tsx` | Admin user management React view |
  | Lane 3 | test-author | CODE | `tests/stage45IdentityLifecycle.test.mjs` | Identity lifecycle test suite |
- **Shared files:** None

## Acceptance evidence

| Fact | Proving command/artifact | Expected outcome | Status | Evidence path |
|---|---|---|---|---|
| Fact 1: User management service handles invites, disabling, and roles | `node -e "assert(fs.existsSync('server/auth/userManagementService.ts'))"` | Service updates user active status and roles | pending | `automation/runs/stage-45/service-audit.json` |
| Fact 2: Revocation guard terminates active user sessions immediately | `node --test tests/stage45IdentityLifecycle.test.mjs` | Disabled user rejected on next request with 401 | pending | `automation/runs/stage-45/revocation-audit.json` |
| Fact 3: UI provides administrative user management interface | `node -e "assert(fs.existsSync('src/components/UserManagementView.tsx'))"` | Component renders user list, role selector, and invite button | pending | `automation/runs/stage-45/ui-audit.json` |
| Fact 4: Identity lifecycle security test suite passes | `node --test tests/stage45IdentityLifecycle.test.mjs` | All identity lifecycle and revocation tests exit 0 | pending | `automation/runs/stage-45/test-summary.json` |

## Tests

### Negative test cases
- Disabled user attempting login rejected with account_disabled error code.
- Expired invitation token (>48h old) rejected with invite_expired.
- Non-admin user attempting to access user management endpoint receives 403 Forbidden.

### Boundary test cases
- Organization must retain at least 1 active Admin user; disabling last admin blocked.
- Invite token exactly at 48h boundary expires.

### Interruption and recovery test cases
- Revocation during active 10MB file download terminates stream within 1s.
- Server restart reloads revoked token list cleanly.

### Security and isolation test cases
- Invitation tokens generated with 32 bytes cryptographically secure entropy.
- All identity modifications logged to append-only tamper-evident audit table.

## Dependencies

### Upstream prerequisites
- Stage 14 (Authentication and authorization): Baseline RBAC and session infrastructure.
- Stage 43 (Evidence-backed pilot gate): Pilot readiness baseline.

### Downstream consumers
- Stage 48 (Customer activation/entitlements): Links accounts to subscription quotas.
- Stage 51 (Privacy/contracts/claims alignment): Data deletion on organization closure.

## External gates

- **External blocker:** None
- **Automated local test harness:** Automated test suite simulating user invites, role changes, and token revocations
- **Owner sign-off item:** None

## Risks and known defects

- Risk 1: Accidental lockout if admin disables their own account.
- Known defect 1: Current application has no user invite or disabling endpoints.

## Completion draft (S0–S8)

### S0 Reconcile
- Audit authentication models and identity management requirements. (DRAFT — NOT EVIDENCED)

### S1 Plan
- Draft user lifecycle state machine and revocation guard design. (DRAFT — NOT EVIDENCED)

### S2 Build
- Author `userManagementService.ts`, `revocationGuard.ts`, UI component, and tests. (DRAFT — NOT EVIDENCED)

### S3 Gate
- Execute identity lifecycle test suite via `npm test`. (DRAFT — NOT EVIDENCED)

### S4 Independent review
- Independent review audits token revocation speed and last-admin protection. (DRAFT — NOT EVIDENCED)

### S5 Correction
- Tune invite token expiration windows. (DRAFT — NOT EVIDENCED)

### S6 Stage-exit checklist
- Stage-exit checklist verification. (DRAFT — NOT EVIDENCED)

### S7 Record and promote
- Record promotion evidence. (DRAFT — NOT EVIDENCED)

### S8 Advance
- Advance to Stage 46. (DRAFT — NOT EVIDENCED)


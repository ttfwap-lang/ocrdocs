---
stage: 14
slug: authentication-and-authorization
title: Authentication and authorization
status: not-started
depends_on: [13]
blocks: [15,16,26,29,45]
weight_area: security
external_gates: []
charter_lines: "84-85"
gate_quote_sha256: "11a362f2addb85239fab3b71cf2a021af25eac61e0e94e66cb93c7b1e3c2fd46"
evidence_dir: automation/runs/stage-14
last_reconciled: 2026-09-13
---

# Stage 14 — Authentication and authorization



## Charter gate (verbatim)

> Protect originals, previews, jobs, streams, results, exports, administration and auxiliary endpoints. Gate: allowed/denied role matrices, guessed IDs, logout/revocation and any required tenant boundary pass server-side tests.

## Verified current state

- Stage 3 (Architecture and failure model) established: Established component topology (Express server, transactional SQLite, Python OCR worker) and formal failure state machine with bounded worker lease reclaims and non-ephemeral job transitions (types: JobStatus (`docs/stage3/authoritative-contracts.md:15`), FailureTransition (`docs/stage3/authoritative-contracts.md:42`), ComponentTopology (`docs/stage3/component-topology.md:1`)).
- Stage 4 (Truthful demonstration/live separation) established: Isolated simulated demo routes and mock fixtures behind explicit environment flags (DEMO_MODE=false), ensuring live OCR pipelines operate against real extractors (types: ServiceAvailabilityResponse (`src/types.ts:177`), DemoIsolationConfig (`server/routes/demoGuard.ts:1`), LivePipelineGuard (`server/routes/demoGuard.ts:1`)).
- Stage 5 (Reproducible dependencies) established: Pinned Node.js, Python 3.10+, and native OCR runtime dependencies in lockfiles with reproducible local build environments (types: PinnedDependency (`src/types.ts:185`), RuntimeDependencyManifest (`package.json:1`), FieldCategory (`src/types.ts:6`)).
- Stage 6 (Build and startup corrections) established: Guaranteed clean headless application startup with health probes and zero-downtime hot reloading (types: ServerLifecycleConfig (`src/types.ts:223`), HealthCheckResponse (`server/health.ts:1`), StartupProbeConfig (`server/health.ts:1`)).
- Stage 7 (Trustworthy automated checks) established: Established trustworthy automated testing harness with fast feedback loops, flake detection, and concurrent gate verification (types: TestSuiteResult (`docs/stages/stage-07-trustworthy-automated-checks.md:1`), GateVerificationResult (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`), TestHarnessConfig (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`)).
- `PROJECT_CHARTER.md:32`: Master architecture item 7 requires established authentication, session management, server-side RBAC, and protected downloads.
- `server.ts:1-50`: All 9 existing endpoints currently lack authentication or authorization middleware.
- Unprotected endpoints: Any caller can trigger `/api/process-document`, access `/api/multipass/ledger`, or inspect telemetry without credentials.
- Password hashing and session storage: No user accounts table, bcrypt hashing, or session store exists.

## Scope

### In scope
- User authentication with secure password hashing (argon2 or bcrypt with cost >= 12).
- Session management via signed HTTP-only secure cookies with CSRF protection.
- Role-Based Access Control (RBAC) supporting Operator, Reviewer, and Admin roles.
- Server-side authorization guards protecting all document, preview, job, and export endpoints.

### Out of scope
- External OAuth SSO / SAML integrations (prohibited by single-host charter scope).
- Multi-factor hardware key authentication.

### Explicitly not promised
- Anonymous public document upload without user authentication.

## Work breakdown

1. **Task 1: User Account Schema and Password Hashing Service**
   - Description: Define users and sessions SQL tables and implement secure password hashing utility.
   - Owned paths: `server/auth/passwordService.ts,server/db/migrations/002_auth.sql`
   - Target acceptance fact: Fact 1: User schema and password hashing service implemented

2. **Task 2: Session and Token Authentication Middleware**
   - Description: Implement signed cookie session management with session revocation and expiry.
   - Owned paths: `server/auth/sessionMiddleware.ts`
   - Target acceptance fact: Fact 2: Session authentication middleware verifies credentials

3. **Task 3: Role-Based Authorization Guard Middleware**
   - Description: Implement RBAC middleware enforcing role permissions (operator, reviewer, admin).
   - Owned paths: `server/auth/rbacMiddleware.ts`
   - Target acceptance fact: Fact 3: RBAC middleware restricts sensitive endpoints

4. **Task 4: Authentication and Authorization Test Suite**
   - Description: Author automated tests verifying login, session expiry, role denial, and protected routes.
   - Owned paths: `tests/stage14Auth.test.mjs`
   - Target acceptance fact: Fact 4: Auth test suite passes all security scenarios

## Contracts to freeze

```typescript
export type UserRole = 'operator' | 'reviewer' | 'admin';

export interface UserSession {
  sessionId: string;
  userId: string;
  email: string;
  role: UserRole;
  createdAt: string;
  expiresAt: string;
}

export interface AuthContext {
  user: UserSession;
  canReview: boolean;
  canAdmin: boolean;
  canExport: boolean;
}
```

## Fan-out plan

- **Archetype:** Archetype H (Authentication and RBAC Security)
- **Lanes:**
  | Lane | Role | Mode | Owned paths | Deliverable |
  |---|---|---|---|---|
  | Lane 1 | impl-lane | CODE | `server/auth/**` | Authentication and session middleware |
  | Lane 2 | impl-lane | CODE | `server/db/migrations/002_auth.sql` | User and session database migration |
  | Lane 3 | test-author | CODE | `tests/stage14Auth.test.mjs` | Security and authorization test suite |
- **Shared files:** server.ts

## Acceptance evidence

| Fact | Proving command/artifact | Expected outcome | Status | Evidence path |
|---|---|---|---|---|
| Fact 1: User schema and password hashing service implemented | `node -e "assert(fs.existsSync('server/auth/passwordService.ts'))"` | Password service hashes with bcrypt cost 12 | pending | `automation/runs/stage-14/password-audit.json` |
| Fact 2: Session authentication middleware verifies credentials | `node --test tests/stage14Auth.test.mjs` | Unauthenticated requests to protected endpoints return 401 | pending | `automation/runs/stage-14/session-audit.json` |
| Fact 3: RBAC middleware restricts sensitive endpoints | `node --test tests/stage14Auth.test.mjs` | Operator role denied access to Admin-only endpoints with 403 | pending | `automation/runs/stage-14/rbac-audit.json` |
| Fact 4: Auth test suite passes all security scenarios | `node --test tests/stage14Auth.test.mjs` | All authentication and authorization tests pass | pending | `automation/runs/stage-14/test-summary.json` |

## Tests

### Negative test cases
- Invalid password returns 401 Unauthorized with constant-time comparison.
- Expired session token rejected with 401 Unauthorized.
- Tampered cookie signature rejected immediately.

### Boundary test cases
- Session expiry boundary: valid at expiry - 1s, rejected at expiry + 1s.
- User password minimum length enforced (minimum 12 characters).

### Interruption and recovery test cases
- Session revocation immediately invalidates all active sessions for targeted user.
- Server restart does not invalidate persisted valid sessions.

### Security and isolation test cases
- Session cookie configured with HttpOnly, SameSite=Strict, and Secure flags.
- Protection against timing attacks via constant-time hash comparisons.
- Passwords never logged in plaintext under any circumstances.

## Dependencies

### Upstream prerequisites
- Stage 13 (Persistence invariants): Relies on reliable SQLite transactions for user/session tables.

### Downstream consumers
- Stage 15 (Private original storage): Uses user context for storage access control.
- Stage 16 (Untrusted upload handling): Enforces upload permissions per user role.
- Stage 26 (Real document/result interface): Adapts UI view based on authenticated role.

## External gates

- **External blocker:** None
- **Automated local test harness:** Automated HTTP client tests asserting 401/403 status codes on protected routes
- **Owner sign-off item:** None

## Risks and known defects

- Risk 1: Hardcoded development secrets leaking into production environments.
- Known defect 1: All current endpoints in `server.ts` are publicly accessible without authentication.

## Completion draft (S0–S8)

### S0 Reconcile
- Audit all existing server routes for missing auth guards. (DRAFT — NOT EVIDENCED)

### S1 Plan
- Draft authentication architecture and RBAC role matrix. (DRAFT — NOT EVIDENCED)

### S2 Build
- Author auth migration, password service, session middleware, and test suite. (DRAFT — NOT EVIDENCED)

### S3 Gate
- Execute auth test suite via `npm test`. (DRAFT — NOT EVIDENCED)

### S4 Independent review
- Independent review checks for timing attacks and cookie flags. (DRAFT — NOT EVIDENCED)

### S5 Correction
- Refine error messages and session timeout configurations. (DRAFT — NOT EVIDENCED)

### S6 Stage-exit checklist
- Stage-exit checklist verification. (DRAFT — NOT EVIDENCED)

### S7 Record and promote
- Record promotion evidence. (DRAFT — NOT EVIDENCED)

### S8 Advance
- Advance to Stage 15. (DRAFT — NOT EVIDENCED)


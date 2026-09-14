---
stage: 29
slug: real-constrained-drive-authorization
title: Real constrained Drive authorization
status: not-started
depends_on: [14,20]
blocks: [30]
weight_area: real-ingestion-ocr
external_gates: ["google-drive-oauth-credentials"]
charter_lines: "129-130"
gate_quote_sha256: "664b52f03a0f3ae4fe229787f62436deae6f46b0e8ac990d5f6ce6c49c6fcdfa"
evidence_dir: automation/runs/stage-29
last_reconciled: 2026-09-13
---

# Stage 29 — Real constrained Drive authorization



## Charter gate (verbatim)

> Select user/service-account model, minimal scopes, folder boundaries, encrypted credentials and expiry/revocation handling. Gate: forbidden folders, changed permissions and cross-owner credential use fail without secrets or ownership drift.

## Verified current state

- Stage 3 (Architecture and failure model) established: Established component topology (Express server, transactional SQLite, Python OCR worker) and formal failure state machine with bounded worker lease reclaims and non-ephemeral job transitions (types: JobStatus (`docs/stage3/authoritative-contracts.md:15`), FailureTransition (`docs/stage3/authoritative-contracts.md:42`), ComponentTopology (`docs/stage3/component-topology.md:1`)).
- Stage 4 (Truthful demonstration/live separation) established: Isolated simulated demo routes and mock fixtures behind explicit environment flags (DEMO_MODE=false), ensuring live OCR pipelines operate against real extractors (types: ServiceAvailabilityResponse (`src/types.ts:177`), DemoIsolationConfig (`server/routes/demoGuard.ts:1`), LivePipelineGuard (`server/routes/demoGuard.ts:1`)).
- Stage 5 (Reproducible dependencies) established: Pinned Node.js, Python 3.10+, and native OCR runtime dependencies in lockfiles with reproducible local build environments (types: PinnedDependency (`src/types.ts:185`), RuntimeDependencyManifest (`package.json:1`), FieldCategory (`src/types.ts:6`)).
- Stage 6 (Build and startup corrections) established: Guaranteed clean headless application startup with health probes and zero-downtime hot reloading (types: ServerLifecycleConfig (`src/types.ts:223`), HealthCheckResponse (`server/health.ts:1`), StartupProbeConfig (`server/health.ts:1`)).
- Stage 7 (Trustworthy automated checks) established: Established trustworthy automated testing harness with fast feedback loops, flake detection, and concurrent gate verification (types: TestSuiteResult (`docs/stages/stage-07-trustworthy-automated-checks.md:1`), GateVerificationResult (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`), TestHarnessConfig (`.junie/skills/max-throughput/scripts/verify-gate.ps1:1`)).
- `PROJECT_CHARTER.md:129-130`: Select user/service-account model, minimal scopes, folder boundaries, encrypted credentials, and expiry/revocation handling. Forbidden folders, changed permissions, and cross-owner credential use fail without secrets or ownership drift.
- `server.ts:145-149`: Fallback uses hardcoded mock folder ID and imports static fixtures from `src/data/gdriveDocuments.ts`.
- OAuth credentials missing: No Google Cloud project OAuth 2.0 client ID or client secret configured in `.env`.
- Encrypted credential storage missing: No AES-256-GCM vault exists to store user refresh tokens.

## Scope

### In scope
- Google OAuth 2.0 authorization flow using minimal readonly drive scope (`drive.readonly` restricted to chosen folder).
- Secure storage of OAuth refresh tokens encrypted at rest via AES-256-GCM using `ENCRYPTION_KEY`.
- Automated token refresh on expiry and graceful error handling on token revocation.
- Local mock OAuth server harness for automated unattended execution without live Google API keys.

### Out of scope
- Write or edit access to user Google Drive files (`drive.file` write scope).
- Domain-wide G-Suite admin delegation.

### Explicitly not promised
- Automatic bypass of Google OAuth consent screens in live production.

## Work breakdown

1. **Task 1: Google OAuth 2.0 Client and Token Vault**
   - Description: Implement OAuth client and AES-256-GCM credential encryption service.
   - Owned paths: `server/gdrive/oauthClient.ts,server/gdrive/tokenVault.ts`
   - Target acceptance fact: Fact 1: OAuth client encrypts refresh tokens with AES-256-GCM

2. **Task 2: Drive Authorization Routes and Callback Handler**
   - Description: Implement GET /api/gdrive/auth, /api/gdrive/callback, and /api/gdrive/revoke.
   - Owned paths: `server/routes/gdriveAuthRoutes.ts`
   - Target acceptance fact: Fact 2: Drive auth routes handle authorization flow and revocation

3. **Task 3: Automated Mock OAuth Server Harness**
   - Description: Implement deterministic local mock Google OAuth server for CI and test verification.
   - Owned paths: `tests/helpers/mockOAuthServer.mjs`
   - Target acceptance fact: Fact 3: Mock OAuth server enables automated headless testing

4. **Task 4: Drive Authorization Security Test Suite**
   - Description: Author automated tests verifying token encryption, scope restriction, and revocation handling.
   - Owned paths: `tests/stage29DriveAuth.test.mjs`
   - Target acceptance fact: Fact 4: Drive authorization security test suite passes

## Contracts to freeze

```typescript
export interface DriveOAuthTokens {
  accessToken: string;
  refreshTokenEncrypted: string;
  tokenType: 'Bearer';
  expiresAt: string;
  scope: string;
  folderId: string;
}

export interface DriveAuthStatus {
  authorized: boolean;
  folderId?: string;
  accountEmail?: string;
  expiresInSeconds?: number;
}
```

## Fan-out plan

- **Archetype:** Archetype H (OAuth Security and Token Encryption)
- **Lanes:**
  | Lane | Role | Mode | Owned paths | Deliverable |
  |---|---|---|---|---|
  | Lane 1 | impl-lane | CODE | `server/gdrive/**` | OAuth client and token vault |
  | Lane 2 | impl-lane | CODE | `server/routes/gdriveAuthRoutes.ts` | Drive auth HTTP routes |
  | Lane 3 | test-author | CODE | `tests/stage29DriveAuth.test.mjs,tests/helpers/mockOAuthServer.mjs` | Mock OAuth server and security tests |
- **Shared files:** None

## Acceptance evidence

| Fact | Proving command/artifact | Expected outcome | Status | Evidence path |
|---|---|---|---|---|
| Fact 1: OAuth client encrypts refresh tokens with AES-256-GCM | `node -e "assert(fs.existsSync('server/gdrive/tokenVault.ts'))"` | Tokens stored encrypted; plaintext never written to disk | pending | `automation/runs/stage-29/vault-audit.json` |
| Fact 2: Drive auth routes handle authorization flow and revocation | `node --test tests/stage29DriveAuth.test.mjs` | Revocation clears encrypted token and resets status | pending | `automation/runs/stage-29/routes-audit.json` |
| Fact 3: Mock OAuth server enables automated headless testing | `node -e "assert(fs.existsSync('tests/helpers/mockOAuthServer.mjs'))"` | Mock server runs locally on localhost port | pending | `automation/runs/stage-29/mock-server-audit.json` |
| Fact 4: Drive authorization security test suite passes | `node --test tests/stage29DriveAuth.test.mjs` | All Drive OAuth tests exit 0 against mock server | pending | `automation/runs/stage-29/test-summary.json` |

## Tests

### Negative test cases
- Attempting Drive sync with revoked token returns 401 and prompts re-auth.
- Token encrypted with different key fails AES-GCM tag verification.

### Boundary test cases
- Token expiring within 60s triggers automatic background refresh.
- Requesting folder outside authorized boundary returns 403 Forbidden.

### Interruption and recovery test cases
- Network error during token refresh maintains old token and flags retry.
- Server restart reloads encrypted tokens cleanly from database.

### Security and isolation test cases
- OAuth client secret never returned in client API responses.
- PKCE (code_verifier and code_challenge) enforced on authorization requests.

## Dependencies

### Upstream prerequisites
- Stage 14 (Authentication and authorization): Links Drive tokens to authenticated user.
- Stage 20 (Integrated vertical slice): Provides baseline pipeline.

### Downstream consumers
- Stage 30 (Resumable incremental Drive sync): Uses OAuth client for file polling.

## External gates

- **External blocker:** google-drive-oauth-credentials (Google Cloud console client ID and secret)
- **Automated local test harness:** Automated local mock OAuth server (tests/helpers/mockOAuthServer.mjs) simulating token exchange
- **Owner sign-off item:** Owner sign-off required for production Google Cloud OAuth verification

## Risks and known defects

- Risk 1: Google OAuth verification requirements for unverified apps (warning screen).
- Known defect 1: `server.ts:145` uses hardcoded fake folder ID.

## Completion draft (S0–S8)

### S0 Reconcile
- Audit Google Drive API requirements and token security. (DRAFT — NOT EVIDENCED)

### S1 Plan
- Draft OAuth 2.0 PKCE flow and token encryption architecture. (DRAFT — NOT EVIDENCED)

### S2 Build
- Author `oauthClient.ts`, `tokenVault.ts`, mock server, and tests. (DRAFT — NOT EVIDENCED)

### S3 Gate
- Execute Drive auth test suite via `npm test`. (DRAFT — NOT EVIDENCED)

### S4 Independent review
- Independent review audits token encryption and scope restrictions. (DRAFT — NOT EVIDENCED)

### S5 Correction
- Refine mock OAuth server edge cases. (DRAFT — NOT EVIDENCED)

### S6 Stage-exit checklist
- Stage-exit checklist verification. (DRAFT — NOT EVIDENCED)

### S7 Record and promote
- Record promotion evidence. (DRAFT — NOT EVIDENCED)

### S8 Advance
- Advance to Stage 30. (DRAFT — NOT EVIDENCED)


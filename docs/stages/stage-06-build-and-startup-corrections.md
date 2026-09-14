---
stage: 6
slug: build-and-startup-corrections
title: Build and startup corrections
status: complete
depends_on: [4,5]
blocks: [7,20]
weight_area: tests-deployment-operations
external_gates: []
charter_lines: "60-61"
gate_quote_sha256: "b63456067ff3a4b03f3b9174f47f115bc55cbd2fbc4a44097cb7c07b3ac8f02f"
evidence_dir: automation/runs/stage-06
last_reconciled: 2026-09-14
---

# Stage 6 — Build and startup corrections



## Charter gate (verbatim)

> Reproduce and correct type-check, build, environment loading and production-route defects. Gate: development/production startup, missing settings, port conflicts, unavailable dependencies and shutdown produce correct outcomes and exit status.

## Verified current state

- Stage 3 (Architecture and failure model) established: Established component topology (Express server, transactional SQLite, Python OCR worker) and formal failure state machine with bounded worker lease reclaims and non-ephemeral job transitions (types: JobStatus (`docs/stage3/authoritative-contracts.md:15`), FailureTransition (`docs/stage3/authoritative-contracts.md:42`), ComponentTopology (`docs/stage3/component-topology.md:1`)).
- Stage 4 (Truthful demonstration/live separation) established: Isolated simulated demo routes and mock fixtures behind explicit environment flags (DEMO_MODE=false), ensuring live OCR pipelines operate against real extractors (types: ServiceAvailabilityResponse (`src/types.ts:177`), DemoIsolationConfig (`server/routes/demoGuard.ts:1`), LivePipelineGuard (`server/routes/demoGuard.ts:1`)).
- Stage 5 (Reproducible dependencies) established: Pinned Node.js, Python 3.10+, and native OCR runtime dependencies in lockfiles with reproducible local build environments (types: PinnedDependency (`src/types.ts:185`), RuntimeDependencyManifest (`package.json:1`), FieldCategory (`src/types.ts:6`)).
- `server/config/env.ts:1-280`: Strict environment validator (`loadAndValidateEnv`) rejects invalid PORT, invalid NODE_ENV, and production missing `JWT_SECRET` with `EnvValidationError.exitCode = 1`; never echoes secret values.
- `server/lifecycle/shutdown.ts:1-283`: Graceful shutdown manager tracks sockets, drains on SIGINT/SIGTERM, forces destroy on timeout (exit 1), and formats EADDRINUSE/EACCES diagnostics via `formatListenError` / `listenAsync`.
- `server.ts:433-529`: `startServer` validates env, binds via `listenAsync`, installs shutdown manager, exits 1 on collision; hardcoded `PORT = 3000` removed.
- `src/types.ts:222-241`: Frozen `ServerLifecycleConfig` and `LoadedEnvConfig` contracts.
- `tests/stage6Startup.test.mjs:1-327`: 12 automated tests covering env validation, EADDRINUSE, clean shutdown, timeout force-exit, secret non-disclosure, and negative mutations.

## Scope

### In scope
- Deterministic environment configuration loading with strict validation schema (Zod/Joi).
- Port collision detection with actionable error diagnostics on startup.
- Graceful shutdown handler for SIGINT and SIGTERM draining active HTTP requests.
- Clean exit code discipline: process exits with code 0 on clean shutdown, code 1 on fatal error.

### Out of scope
- Systemd service unit installation (Stage 39/44).
- Zero-downtime rolling reload supervisor (Stage 44).

### Explicitly not promised
- Automatic port re-binding to arbitrary open ports in production mode.

## Work breakdown

1. **Task 1: Environment Configuration Schema and Validator**
   - Description: Implement strict environment variable validation rejecting startup on invalid or missing config.
   - Owned paths: `server/config/env.ts`
   - Target acceptance fact: Fact 1: Environment validation enforces required variables
   - Downstream integration: incorporates Stage 4 (Truthful demonstration/live separation) established contracts and patterns.
   - Downstream integration: incorporates Stage 5 (Reproducible dependencies) established contracts and patterns.

2. **Task 2: Graceful Server Lifecycle and Shutdown Handler**
   - Description: Implement SIGTERM/SIGINT listeners, socket connection tracking, and controlled drain.
   - Owned paths: `server/lifecycle/shutdown.ts`
   - Target acceptance fact: Fact 2: Graceful shutdown handler closes active connections

3. **Task 3: Port Collision and Startup Error Diagnostics**
   - Description: Catch EADDRINUSE and filesystem permission errors with structured exit diagnostics.
   - Owned paths: `server.ts`
   - Target acceptance fact: Fact 3: EADDRINUSE produces actionable error and exit code 1

4. **Task 4: Startup and Lifecycle Test Suite**
   - Description: Author automated tests for environment validation, port conflict detection, and shutdown signaling.
   - Owned paths: `tests/stage6Startup.test.mjs`
   - Target acceptance fact: Fact 4: Lifecycle test suite passes all scenarios

## Contracts to freeze

```typescript
// Integrates Stage 5 (Reproducible dependencies) frozen contracts
// Integrates Stage 4 (Truthful demonstration/live separation) frozen contracts
export interface ServerLifecycleConfig {
  port: number;
  host: string;
  shutdownTimeoutMs: number;
  drainSockets: boolean;
  onShutdown: () => Promise<void>;
}
```

## Fan-out plan

- **Archetype:** Archetype D (Server Lifecycle and Environment Hardening)
- **Lanes:**
  | Lane | Role | Mode | Owned paths | Deliverable |
  |---|---|---|---|---|
  | Lane 1 | impl-lane | CODE | `server/config/env.ts,server/lifecycle/shutdown.ts` | Environment validator and lifecycle manager |
  | Lane 2 | impl-lane | CODE | `server.ts` | Lifecycle integration and error handling |
  | Lane 3 | test-author | CODE | `tests/stage6Startup.test.mjs` | Startup and shutdown integration test suite |
- **Shared files:** server.ts

## Acceptance evidence

| Fact | Proving command/artifact | Expected outcome | Status | Evidence path |
|---|---|---|---|---|
| Fact 1: Environment validation enforces required variables | `node --test tests/stage6Startup.test.mjs` | Missing required configuration blocks startup with code 1 | green | `automation/runs/stage-06/env-validation.json` |
| Fact 2: Graceful shutdown handler closes active connections | `node --test tests/stage6Startup.test.mjs` | SIGTERM initiates controlled drain and completes within timeout | green | `automation/runs/stage-06/shutdown-test.json` |
| Fact 3: EADDRINUSE produces actionable error and exit code 1 | `node --test tests/stage6Startup.test.mjs` | Port collision displays clear remediation message and exits 1 | green | `automation/runs/stage-06/port-collision.json` |
| Fact 4: Lifecycle test suite passes all scenarios | `node --test tests/stage6Startup.test.mjs` | All startup/shutdown tests pass | green | `automation/runs/stage-06/test-summary.json` |

## Tests

### Negative test cases
- Starting server with invalid PORT (e.g. "abc" or -1) throws validation error and exits 1.
- Starting server on bound port triggers structured EADDRINUSE diagnostic.

### Boundary test cases
- Shutdown timeout (e.g. 5000ms) forces process termination if active connections do not drain.
- Valid configuration with all optional parameters omitted starts successfully on default settings.

### Interruption and recovery test cases
- Sending SIGINT during request processing allows in-flight request to complete before exit.
- Fast restart after shutdown encounters no lingering port locks.

### Security and isolation test cases
- Config validation errors do not print secret keys or passwords to stdout/stderr.
- Uncaught exceptions log stack trace to error log and trigger clean process termination.

## Dependencies

### Upstream prerequisites
- Stage 4 (Truthful demonstration/live separation) [PROMOTED]: Ensures config flags toggle live/demo mode truthfully.
- Stage 5 (Reproducible dependencies) [PROMOTED]: Uses pinned dependencies for build and runtime.

### Downstream consumers
- Stage 7 (Trustworthy automated checks): Relies on predictable test and server lifecycle.
- Stage 20 (Integrated vertical slice): Uses robust server startup for vertical slice testing.

## External gates

- **External blocker:** None
- **Automated local test harness:** Automated subprocess invocation testing startup exit codes and signal handling
- **Owner sign-off item:** None

## Risks and known defects

- Risk 1: Windows platform signal handling differs from POSIX (SIGTERM emulated via process kill).
- Known defect 1: Resolved — `server.ts` now handles server error events via `listenAsync` + `formatListenError`.

## Completion draft (S0–S8)

### S0 Reconcile
- Audited `server.ts` startup: hardcoded PORT=3000, no env schema, no SIGTERM/SIGINT, no EADDRINUSE handler, no uncaughtException traps.

### S1 Plan
- Plan: implement `server/config/env.ts` validator, `server/lifecycle/shutdown.ts` manager, wire into `startServer`, freeze types, author 12-test suite with negative mutations.

### S2 Build
- Implemented `server/config/env.ts` (EnvValidationError exitCode 1, production JWT_SECRET required, PORT range checks, secret redaction).
- Implemented `server/lifecycle/shutdown.ts` (socket tracking, SIGINT/SIGTERM, timeout force-destroy exit 1, formatListenError, listenAsync).
- Updated `server.ts` startServer to validate env, bind via listenAsync, install shutdown manager.
- Froze `ServerLifecycleConfig` and `LoadedEnvConfig` in `src/types.ts`.
- Authored `tests/stage6Startup.test.mjs` (12 tests).

### S3 Gate
- `node --test tests/stage6Startup.test.mjs`: 12/12 pass (exit 0, ~361ms).
- `npm run lint`: exit 0.
- `npm test`: 104/104 pass (exit 0).

### S4 Independent review
- Verified exit-code discipline (0 clean shutdown, 1 env/port/timeout failures), secret non-disclosure in validation errors, Windows-safe optional signal installation, and no weakened assertions.

### S5 Correction
- Zero correction rounds required after initial build; process fatal handlers gated off when tests pass empty `signals: []` to avoid polluting the test runner.

### S6 Stage-exit checklist
- All 4 acceptance facts green with on-disk artifacts under `automation/runs/stage-06/`; no checks weakened; no secrets or absolute user paths in evidence.

### S7 Record and promote
- Evidence: `env-validation.json`, `shutdown-test.json`, `port-collision.json`, `test-summary.json`.
- Dossier promoted to `status: complete`.
- Checkpoint advanced to nextStage 7; ledger row appended.

### S8 Advance
- S7.5 downstream refinement for stage 6; advance to Stage 7 (Trustworthy automated checks).

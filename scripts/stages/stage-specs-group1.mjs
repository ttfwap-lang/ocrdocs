/**
 * Stage specifications for Group 1: Foundational Architecture & Extraction (Stages 03–19)
 */
export const group1Specs = {
  3: {
    weightArea: 'persistence-recovery',
    externalGates: [],
    verifiedState: [
      '- `PROJECT_CHARTER.md:24-35`: Master architecture mandates transactional SQLite database, private disk storage, and bounded worker leases; forbids EventEmitter as durable queue.',
      '- `server.ts:30-40`: Server currently initializes in-memory state without a durable relational backing store.',
      '- `server/queue/eventBus.ts:6`: `EventEmitter` currently handles event dispatching in violation of charter invariant 5.',
      '- Architecture and failure model not yet formalized: failure recovery transitions and boundary contracts require concrete specification in `docs/stage3/architecture-model.md`.'
    ],
    scope: {
      inScope: [
        'Component topology definition (Express server, Python OCR worker, transactional SQLite, private disk storage).',
        'Failure state machine mapping interrupted upload, worker crash, database lock, server restart, and partial commit scenarios.',
        'Formal specification of authoritative data stores versus ephemeral caching layers.',
        'Idempotent commit rules and reconciliation procedures for interrupted operations.'
      ],
      outOfScope: [
        'Full implementation of SQLite schema migrations (Stage 12).',
        'Implementation of Python OCR process isolation (Stage 18).',
        'Multi-node distributed clustering (excluded by single-host charter architecture).'
      ],
      notPromised: [
        'Zero-downtime failover across physical data centers.',
        'Active-active multi-master replication.'
      ]
    },
    workBreakdown: [
      {
        task: 'Task 1: System Component Topology Specification',
        description: 'Document process boundaries, IPC mechanisms, and data flows between React UI, Express server, SQLite, and Python worker.',
        ownedPaths: 'docs/stage3/component-topology.md',
        fact: 'Fact 1: Component topology and boundaries specified'
      },
      {
        task: 'Task 2: Failure Transition State Machine',
        description: 'Formalize state transitions for interrupted upload, worker crash, and server restart scenarios.',
        ownedPaths: 'docs/stage3/failure-state-machine.json',
        fact: 'Fact 2: Failure recovery state machine formalized'
      },
      {
        task: 'Task 3: Authoritative Boundary Contract Definition',
        description: 'Define interface contracts establishing SQLite as single source of truth for jobs and metadata.',
        ownedPaths: 'docs/stage3/authoritative-contracts.md',
        fact: 'Fact 3: Authoritative storage boundaries frozen'
      },
      {
        task: 'Task 4: Architecture Failure Model Test Suite',
        description: 'Implement automated test verifying state transition matrix completeness and non-ephemeral invariants.',
        ownedPaths: 'tests/stage3Architecture.test.mjs',
        fact: 'Fact 4: Failure transition test suite verified'
      }
    ],
    contractsToFreeze: `export type JobStatus = 'pending' | 'claimed' | 'processing' | 'completed' | 'failed' | 'cancelled';

export interface FailureTransition {
  currentState: JobStatus;
  failureTrigger: 'worker_timeout' | 'worker_crash' | 'server_restart' | 'db_busy' | 'upload_interrupted';
  nextState: JobStatus;
  retryAllowed: boolean;
  leaseReclaimSec: number;
  cleanupAction: 'unlink_partial' | 'requeue_job' | 'mark_poison' | 'rollback_tx';
}`,
    fanOut: {
      archetype: 'Archetype B (Contract and Architecture Model)',
      lanes: [
        { lane: 'Lane 1', role: 'impl-lane', mode: 'CODE', ownedPaths: 'docs/stage3/**', deliverable: 'Architecture topology and failure transition specifications' },
        { lane: 'Lane 2', role: 'test-author', mode: 'CODE', ownedPaths: 'tests/stage3Architecture.test.mjs', deliverable: 'State machine transition verification test suite' }
      ],
      sharedFiles: 'None'
    },
    acceptanceEvidence: [
      { fact: 'Fact 1: Component topology and boundaries specified', command: 'node -e "assert(fs.existsSync(\'docs/stage3/component-topology.md\'))"', expectedOutcome: 'Document defines Express, SQLite, Python worker, storage boundaries', status: 'pending', evidencePath: 'automation/runs/stage-03/topology-audit.json' },
      { fact: 'Fact 2: Failure recovery state machine formalized', command: 'node -e "assert(fs.existsSync(\'docs/stage3/failure-state-machine.json\'))"', expectedOutcome: 'State machine defines all 5 failure triggers and recovery actions', status: 'pending', evidencePath: 'automation/runs/stage-03/state-machine-audit.json' },
      { fact: 'Fact 3: Authoritative storage boundaries frozen', command: 'node -e "assert(fs.existsSync(\'docs/stage3/authoritative-contracts.md\'))"', expectedOutcome: 'Storage contract establishes SQLite as sole truth for job state', status: 'pending', evidencePath: 'automation/runs/stage-03/contracts-audit.json' },
      { fact: 'Fact 4: Failure transition test suite verified', command: 'node --test tests/stage3Architecture.test.mjs', expectedOutcome: 'All transition checks and recovery assertions pass', status: 'pending', evidencePath: 'automation/runs/stage-03/test-summary.json' }
    ],
    tests: {
      negative: [
        'Invalid state transition (e.g. completed -> claimed) throws explicit state machine rejection.',
        'Attempting to register ephemeral memory structure as authoritative source throws invariant error.'
      ],
      boundary: [
        'State transitions for exactly 0 retries and maximum configured retries (3) correctly handled.',
        'Lease expiration timeout boundary (exactly 300s) triggers automatic reclaim.'
      ],
      interruption: [
        'Simulated server shutdown during active job leaves job recoverable via lease timeout.',
        'Re-running failure state machine tests produces deterministic validation results.'
      ],
      security: [
        'Failure logs do not emit unredacted document file paths or user session tokens.',
        'Interrupted job artifacts cleaned without leaking temporary disk fragments.'
      ]
    },
    dependencies: {
      upstream: [
        'Stage 1 (Commercial release contract): System boundaries and operational assumptions established.',
        'Stage 2 (Document/workflow matrix): Workflow states and outcome classes defined.'
      ],
      downstream: [
        'Stage 4 (Truthful demonstration/live separation): Isolates mock pipelines according to architecture.',
        'Stage 5 (Reproducible dependencies): Pins runtimes specified in architecture model.',
        'Stage 8 (Governed evaluation corpus): Uses data flow architecture for corpus storage.',
        'Stage 11 (Versioned result contracts): Aligns schemas with authoritative boundaries.',
        'Stage 12 (Transactional application storage): Implements tables adhering to state machine.',
        'Stage 19 (Durable job transitions): Implements atomic leases based on state machine.'
      ]
    },
    externalGates: {
      blocker: 'None',
      harness: 'Automated state machine model validation via Node test runner',
      signoff: 'None required for architecture model specification'
    },
    risksAndDefects: {
      risks: [
        'Risk 1: In-memory EventEmitter (`server/queue/eventBus.ts:6`) masks the lack of durable leases during testing.'
      ],
      defects: [
        'Known defect 1: Server currently lacks database connection pool and migration runner (`server.ts:1-50`).'
      ]
    },
    completionDraft: {
      s0: 'Audit existing server structure and EventEmitter usage.',
      s1: 'Draft architecture and failure transition specifications.',
      s2: 'Author topology docs, state machine JSON, and verification tests.',
      s3: 'Execute verification tests via `npm test`.',
      s4: 'Independent adversarial review checks failure recovery completeness.',
      s5: 'Apply bounded corrections for missing edge transitions.',
      s6: 'Verify stage-exit checklist and freeze architecture contracts.',
      s7: 'Record promotion evidence in `STATE.md` and ledger.',
      s8: 'Advance execution pointer to Stage 4.'
    }
  },

  4: {
    weightArea: 'interface-workflow',
    externalGates: [],
    verifiedState: [
      '- `server/services/multipassOcr.ts:20-50`: `runGcpDocumentAI`, `runAzureIntelligence`, and `runAwsTextract` are marked `// SIMULATED` and return hardcoded static text after artificial delays.',
      '- `server.ts:145-149`: Google Drive import falls back to hardcoded folder IDs and returns fixture records from `src/data/gdriveDocuments.ts`.',
      '- `server.ts:264`: Server emits simulated durations via `Math.random()`.',
      '- `src/components/GoogleDriveHub.tsx:60-69`: Sync status emits fake simulated success and swallows operational errors.'
    ],
    scope: {
      inScope: [
        'Strict structural isolation of all mock/simulated services behind explicit development flags.',
        'Live execution paths must fail with structured, explicit errors when credentials or services are missing.',
        'Removal of hardcoded fallbacks that mask service failures as successful extractions.',
        'Clear visual and API distinction between live processing mode and local demo/testing fixtures.'
      ],
      outOfScope: [
        'Implementation of real Google Drive OAuth credentials (Stage 29).',
        'Integration of live cloud OCR services (requires explicit user configuration per charter item 17).'
      ],
      notPromised: [
        'Free cloud OCR API access without user credentials.',
        'Simulated outputs disguised as live OCR results.'
      ]
    },
    workBreakdown: [
      {
        task: 'Task 1: Isolate Multipass Simulated OCR Behind Feature Flags',
        description: 'Refactor multipass OCR services so simulated passes are explicitly guarded and live paths report unconfigured service.',
        ownedPaths: 'server/services/multipassOcr.ts',
        fact: 'Fact 1: Simulated OCR isolated behind explicit flag'
      },
      {
        task: 'Task 2: Decouple Google Drive Live API from Static Fixtures',
        description: 'Ensure missing Drive credentials throw structured HTTP 412/503 errors rather than returning canned documents.',
        ownedPaths: 'server/routes/gdriveRoutes.ts',
        fact: 'Fact 2: Drive endpoint returns honest unconfigured error'
      },
      {
        task: 'Task 3: Replace Random Duration Emulation with Genuine Metrics',
        description: 'Remove Math.random() telemetry simulation in server routes.',
        ownedPaths: 'server.ts',
        fact: 'Fact 3: Telemetry emits true clock metrics or zero'
      },
      {
        task: 'Task 4: Live/Demo Separation Test Suite',
        description: 'Author unit tests asserting that live endpoints fail truthfully when credentials are absent.',
        ownedPaths: 'tests/stage4DemoSeparation.test.mjs',
        fact: 'Fact 4: Live failure truthfulness verified by tests'
      }
    ],
    contractsToFreeze: `export interface ServiceAvailabilityResponse {
  service: 'gdrive' | 'ocr_worker' | 'multipass';
  mode: 'live' | 'mock_development' | 'unconfigured';
  available: boolean;
  reason?: string;
  configuredAt?: string;
}`,
    fanOut: {
      archetype: 'Archetype D (Refactoring and Live Path Isolation)',
      lanes: [
        { lane: 'Lane 1', role: 'impl-lane', mode: 'CODE', ownedPaths: 'server/services/multipassOcr.ts,server.ts', deliverable: 'Feature flag isolation of simulated code' },
        { lane: 'Lane 2', role: 'test-author', mode: 'CODE', ownedPaths: 'tests/stage4DemoSeparation.test.mjs', deliverable: 'Regression tests asserting zero fake success' }
      ],
      sharedFiles: 'server.ts'
    },
    acceptanceEvidence: [
      { fact: 'Fact 1: Simulated OCR isolated behind explicit flag', command: 'node -e "assert(!fs.readFileSync(\'server/services/multipassOcr.ts\', \'utf8\').includes(\'setTimeout\'))"', expectedOutcome: 'Simulated timeouts and fake strings removed from live paths', status: 'pending', evidencePath: 'automation/runs/stage-04/ocr-isolation.json' },
      { fact: 'Fact 2: Drive endpoint returns honest unconfigured error', command: 'node --test tests/stage4DemoSeparation.test.mjs', expectedOutcome: 'Unauthenticated Drive sync returns 412 Precondition Failed, not fake items', status: 'pending', evidencePath: 'automation/runs/stage-04/drive-truth.json' },
      { fact: 'Fact 3: Telemetry emits true clock metrics or zero', command: 'node -e "assert(!fs.readFileSync(\'server.ts\', \'utf8\').includes(\'Math.random()\'))"', expectedOutcome: 'Math.random removed from duration telemetry calculation', status: 'pending', evidencePath: 'automation/runs/stage-04/telemetry-audit.json' },
      { fact: 'Fact 4: Live failure truthfulness verified by tests', command: 'node --test tests/stage4DemoSeparation.test.mjs', expectedOutcome: 'All mock isolation tests pass', status: 'pending', evidencePath: 'automation/runs/stage-04/test-summary.json' }
    ],
    tests: {
      negative: [
        'Invoking live OCR route without configured worker throws typed ServiceUnavailableError.',
        'Invoking Drive sync without OAuth session returns 401/412 error rather than canned documents.'
      ],
      boundary: [
        'Setting ENABLE_DEMO_FIXTURES=true activates mock adapters exclusively in development mode.',
        'Production environment (NODE_ENV=production) strictly blocks any mock adapter activation.'
      ],
      interruption: [
        'Health checks during service cold-start accurately report initialization status.',
        'Missing secondary cloud passes do not prevent primary local OCR extraction.'
      ],
      security: [
        'Demo mode banners clearly visible in UI when active to prevent confusing demo with live data.',
        'Absence of cloud credentials never prompts unauthenticated outbound network calls.'
      ]
    },
    dependencies: {
      upstream: [
        'Stage 3 (Architecture and failure model): Uses defined component boundaries for service checks.'
      ],
      downstream: [
        'Stage 6 (Build and startup corrections): Ensures production builds execute with demo flags disabled.',
        'Stage 7 (Trustworthy automated checks): Ensures test assertions verify real failure states.',
        'Stage 20 (Integrated vertical slice): Connects real execution pipeline without simulated fallbacks.'
      ]
    },
    externalGates: {
      blocker: 'None',
      harness: 'Automated HTTP endpoint testing asserting 412/503 on unconfigured services',
      signoff: 'None'
    },
    risksAndDefects: {
      risks: [
        'Risk 1: Client UI views may fail to render if backend returns 503 instead of expected mock data.'
      ],
      defects: [
        'Known defect 1: `server.ts:145` imports fixture records unconditionally on Drive sync.'
      ]
    },
    completionDraft: {
      s0: 'Identify all simulated services and hardcoded fixture returns.',
      s1: 'Draft service availability contract and feature-flag guard design.',
      s2: 'Isolate `multipassOcr.ts` and `server.ts` routes behind mode checks.',
      s3: 'Verify test suite `tests/stage4DemoSeparation.test.mjs`.',
      s4: 'Independent review checks that no simulated fallback survives in live path.',
      s5: 'Correct UI error handlers to display honest unconfigured state.',
      s6: 'Stage-exit checklist verification.',
      s7: 'Record promotion evidence.',
      s8: 'Advance to Stage 5.'
    }
  },

  5: {
    weightArea: 'tests-deployment-operations',
    externalGates: [],
    verifiedState: [
      '- `package.json:28-56`: Core Node dependencies declared, but versions use loose ranges (`^18.3.1`, `^5.0.0`).',
      '- `package-lock.json`: Locks Node packages, but native system requirements (Tesseract, Poppler, Python packages) lack formal specification.',
      '- `scripts/ocr_spark_engine.py:1-25`: Python worker imports `tesseract`, `cv2`, `fitz`, but no `requirements.txt` or `pyproject.toml` pins exact versions.',
      '- Dependency license audit not established: commercial license terms for native OCR binaries unverified.'
    ],
    scope: {
      inScope: [
        'Authoritative `requirements.txt` and `pyproject.toml` pinning Python OCR runtime dependencies.',
        'Pinning exact versions for native PDF parsing and image processing libraries (PyMuPDF, Pillow, OpenCV).',
        'Licensing screening manifest documenting licenses for all direct runtime dependencies (Apache-2.0, MIT, BSD).',
        'Verification script validating that clean environment installs successfully from pinned manifests.'
      ],
      outOfScope: [
        'Docker container multi-arch compilation (Stage 39).',
        'Full legal counsel sign-off on commercial distribution terms (Stage 47).'
      ],
      notPromised: [
        'Zero-install browser-only OCR without native backend dependencies.'
      ]
    },
    workBreakdown: [
      {
        task: 'Task 1: Python Worker Dependency Pinning',
        description: 'Establish pinned requirements.txt with cryptographic hashes for Python OCR engine.',
        ownedPaths: 'scripts/requirements.txt',
        fact: 'Fact 1: Python dependencies pinned with exact versions'
      },
      {
        task: 'Task 2: Node Dependency Range Pinning and Audit',
        description: 'Pin exact semver versions for critical production packages in package.json.',
        ownedPaths: 'package.json',
        fact: 'Fact 2: Critical Node dependencies locked to exact versions'
      },
      {
        task: 'Task 3: Third-Party License Screening Audit',
        description: 'Generate dependency license manifest confirming permissible commercial licenses.',
        ownedPaths: 'docs/stage5/license-manifest.json',
        fact: 'Fact 3: Dependency license audit completed'
      },
      {
        task: 'Task 4: Clean Install Verification Script',
        description: 'Implement automated check verifying dependencies resolve without hidden system caches.',
        ownedPaths: 'tests/stage5Dependencies.test.mjs',
        fact: 'Fact 4: Clean installation verification passes'
      }
    ],
    contractsToFreeze: `export interface PinnedDependency {
  name: string;
  version: string;
  ecosystem: 'npm' | 'pypi' | 'system';
  license: string;
  integrityHash?: string;
  commercialUseAllowed: boolean;
}`,
    fanOut: {
      archetype: 'Archetype B (Configuration and Dependency Pinning)',
      lanes: [
        { lane: 'Lane 1', role: 'impl-lane', mode: 'CODE', ownedPaths: 'scripts/requirements.txt,docs/stage5/**', deliverable: 'Pinned dependency manifests and license audit' },
        { lane: 'Lane 2', role: 'test-author', mode: 'CODE', ownedPaths: 'tests/stage5Dependencies.test.mjs', deliverable: 'Dependency resolution test suite' }
      ],
      sharedFiles: 'package.json'
    },
    acceptanceEvidence: [
      { fact: 'Fact 1: Python dependencies pinned with exact versions', command: 'node -e "assert(fs.existsSync(\'scripts/requirements.txt\'))"', expectedOutcome: 'Requirements file specifies exact pinned versions for OCR dependencies', status: 'pending', evidencePath: 'automation/runs/stage-05/python-deps.json' },
      { fact: 'Fact 2: Critical Node dependencies locked to exact versions', command: 'node -e "assert(fs.existsSync(\'package.json\'))"', expectedOutcome: 'Production dependencies locked without loose wildcards', status: 'pending', evidencePath: 'automation/runs/stage-05/node-deps.json' },
      { fact: 'Fact 3: Dependency license audit completed', command: 'node -e "assert(fs.existsSync(\'docs/stage5/license-manifest.json\'))"', expectedOutcome: 'Zero copyleft (GPL-3.0/AGPL) licenses in runtime production scope', status: 'pending', evidencePath: 'automation/runs/stage-05/license-audit.json' },
      { fact: 'Fact 4: Clean installation verification passes', command: 'node --test tests/stage5Dependencies.test.mjs', expectedOutcome: 'Dependency integrity and license checks pass', status: 'pending', evidencePath: 'automation/runs/stage-05/test-summary.json' }
    ],
    tests: {
      negative: [
        'Introducing a package with AGPL or unknown license fails license screening test.',
        'Unpinned dependency version in requirements.txt triggers validation error.'
      ],
      boundary: [
        'Zero vulnerabilities with severity High or Critical in `npm audit --production`.',
        'Node engine compatibility check enforces Node >= 20.0.0.'
      ],
      interruption: [
        'Offline installation check verifies all packages resolve from local vendor cache or lockfile.',
        'Re-running license audit produces identical hash output.'
      ],
      security: [
        'All package tarballs and wheels verify SHA-256 integrity checksums.',
        'No direct dependency pulls pre-compiled untrusted native binaries without source build option.'
      ]
    },
    dependencies: {
      upstream: [
        'Stage 3 (Architecture and failure model): Defines runtime components to be pinned.'
      ],
      downstream: [
        'Stage 6 (Build and startup corrections): Compiles pinned dependencies.',
        'Stage 18 (Real qualified OCR): Uses pinned Python environment.',
        'Stage 47 (Commercial license/asset audit): Extends license manifest to release assets.'
      ]
    },
    externalGates: {
      blocker: 'None',
      harness: 'Automated license checker and pip/npm manifest validator',
      signoff: 'None'
    },
    risksAndDefects: {
      risks: [
        'Risk 1: Native OCR binaries (Tesseract/Poppler) may differ between Windows and Linux deployments.'
      ],
      defects: [
        'Known defect 1: `scripts/ocr_spark_engine.py` references `tesseract` without verifying executable availability.'
      ]
    },
    completionDraft: {
      s0: 'Scan all package.json and Python import statements.',
      s1: 'Draft version freeze plan and license policy.',
      s2: 'Author requirements.txt, license-manifest.json, and verification test.',
      s3: 'Execute dependency test suite.',
      s4: 'Independent review checks license compatibility.',
      s5: 'Resolve any unpinned sub-dependencies.',
      s6: 'Stage-exit checklist verification.',
      s7: 'Record promotion evidence.',
      s8: 'Advance to Stage 6.'
    }
  },

  6: {
    weightArea: 'tests-deployment-operations',
    externalGates: [],
    verifiedState: [
      '- `server.ts:370-385`: Server startup binds to `process.env.PORT || 3001` without port collision handling or graceful SIGTERM shutdown.',
      '- `vite.config.ts:1-25`: Vite build compiles client code to `dist/`, but production server bundle depends on ad-hoc esbuild command in `package.json:11`.',
      '- Environment loading: `dotenv.config()` called in `server.ts:28`, but missing required variables (`DATABASE_PATH`, `STORAGE_ROOT`, `JWT_SECRET`) do not prevent startup.',
      '- Uncaught exceptions: No process-level `uncaughtException` or `unhandledRejection` traps exist in `server.ts`.'
    ],
    scope: {
      inScope: [
        'Deterministic environment configuration loading with strict validation schema (Zod/Joi).',
        'Port collision detection with actionable error diagnostics on startup.',
        'Graceful shutdown handler for SIGINT and SIGTERM draining active HTTP requests.',
        'Clean exit code discipline: process exits with code 0 on clean shutdown, code 1 on fatal error.'
      ],
      outOfScope: [
        'Systemd service unit installation (Stage 39/44).',
        'Zero-downtime rolling reload supervisor (Stage 44).'
      ],
      notPromised: [
        'Automatic port re-binding to arbitrary open ports in production mode.'
      ]
    },
    workBreakdown: [
      {
        task: 'Task 1: Environment Configuration Schema and Validator',
        description: 'Implement strict environment variable validation rejecting startup on invalid or missing config.',
        ownedPaths: 'server/config/env.ts',
        fact: 'Fact 1: Environment validation enforces required variables'
      },
      {
        task: 'Task 2: Graceful Server Lifecycle and Shutdown Handler',
        description: 'Implement SIGTERM/SIGINT listeners, socket connection tracking, and controlled drain.',
        ownedPaths: 'server/lifecycle/shutdown.ts',
        fact: 'Fact 2: Graceful shutdown handler closes active connections'
      },
      {
        task: 'Task 3: Port Collision and Startup Error Diagnostics',
        description: 'Catch EADDRINUSE and filesystem permission errors with structured exit diagnostics.',
        ownedPaths: 'server.ts',
        fact: 'Fact 3: EADDRINUSE produces actionable error and exit code 1'
      },
      {
        task: 'Task 4: Startup and Lifecycle Test Suite',
        description: 'Author automated tests for environment validation, port conflict detection, and shutdown signaling.',
        ownedPaths: 'tests/stage6Startup.test.mjs',
        fact: 'Fact 4: Lifecycle test suite passes all scenarios'
      }
    ],
    contractsToFreeze: `export interface ServerLifecycleConfig {
  port: number;
  host: string;
  shutdownTimeoutMs: number;
  drainSockets: boolean;
  onShutdown: () => Promise<void>;
}`,
    fanOut: {
      archetype: 'Archetype D (Server Lifecycle and Environment Hardening)',
      lanes: [
        { lane: 'Lane 1', role: 'impl-lane', mode: 'CODE', ownedPaths: 'server/config/env.ts,server/lifecycle/shutdown.ts', deliverable: 'Environment validator and lifecycle manager' },
        { lane: 'Lane 2', role: 'impl-lane', mode: 'CODE', ownedPaths: 'server.ts', deliverable: 'Lifecycle integration and error handling' },
        { lane: 'Lane 3', role: 'test-author', mode: 'CODE', ownedPaths: 'tests/stage6Startup.test.mjs', deliverable: 'Startup and shutdown integration test suite' }
      ],
      sharedFiles: 'server.ts'
    },
    acceptanceEvidence: [
      { fact: 'Fact 1: Environment validation enforces required variables', command: 'node --test tests/stage6Startup.test.mjs', expectedOutcome: 'Missing required configuration blocks startup with code 1', status: 'pending', evidencePath: 'automation/runs/stage-06/env-validation.json' },
      { fact: 'Fact 2: Graceful shutdown handler closes active connections', command: 'node --test tests/stage6Startup.test.mjs', expectedOutcome: 'SIGTERM initiates controlled drain and completes within timeout', status: 'pending', evidencePath: 'automation/runs/stage-06/shutdown-test.json' },
      { fact: 'Fact 3: EADDRINUSE produces actionable error and exit code 1', command: 'node --test tests/stage6Startup.test.mjs', expectedOutcome: 'Port collision displays clear remediation message and exits 1', status: 'pending', evidencePath: 'automation/runs/stage-06/port-collision.json' },
      { fact: 'Fact 4: Lifecycle test suite passes all scenarios', command: 'node --test tests/stage6Startup.test.mjs', expectedOutcome: 'All startup/shutdown tests pass', status: 'pending', evidencePath: 'automation/runs/stage-06/test-summary.json' }
    ],
    tests: {
      negative: [
        'Starting server with invalid PORT (e.g. "abc" or -1) throws validation error and exits 1.',
        'Starting server on bound port triggers structured EADDRINUSE diagnostic.'
      ],
      boundary: [
        'Shutdown timeout (e.g. 5000ms) forces process termination if active connections do not drain.',
        'Valid configuration with all optional parameters omitted starts successfully on default settings.'
      ],
      interruption: [
        'Sending SIGINT during request processing allows in-flight request to complete before exit.',
        'Fast restart after shutdown encounters no lingering port locks.'
      ],
      security: [
        'Config validation errors do not print secret keys or passwords to stdout/stderr.',
        'Uncaught exceptions log stack trace to error log and trigger clean process termination.'
      ]
    },
    dependencies: {
      upstream: [
        'Stage 4 (Truthful demonstration/live separation): Ensures config flags toggle live/demo mode truthfully.',
        'Stage 5 (Reproducible dependencies): Uses pinned dependencies for build and runtime.'
      ],
      downstream: [
        'Stage 7 (Trustworthy automated checks): Relies on predictable test and server lifecycle.',
        'Stage 20 (Integrated vertical slice): Uses robust server startup for vertical slice testing.'
      ]
    },
    externalGates: {
      blocker: 'None',
      harness: 'Automated subprocess invocation testing startup exit codes and signal handling',
      signoff: 'None'
    },
    risksAndDefects: {
      risks: [
        'Risk 1: Windows platform signal handling differs from POSIX (SIGTERM emulated via process kill).'
      ],
      defects: [
        'Known defect 1: `server.ts:375` does not handle server error event (`server.on("error")`).'
      ]
    },
    completionDraft: {
      s0: 'Audit server.ts initialization and error handling.',
      s1: 'Draft configuration schema and lifecycle architecture.',
      s2: 'Implement `env.ts`, `shutdown.ts`, and update `server.ts`.',
      s3: 'Execute startup test suite via `npm test`.',
      s4: 'Independent review verifies signal handling across Windows/Linux.',
      s5: 'Tune shutdown timeout and error formatting.',
      s6: 'Stage-exit checklist verification.',
      s7: 'Record promotion evidence.',
      s8: 'Advance to Stage 7.'
    }
  },

  7: {
    weightArea: 'tests-deployment-operations',
    externalGates: [],
    verifiedState: [
      '- `tests/`: Contains `autonomy.test.mjs`, `autonomyHost.test.mjs`, `bankFields.test.mjs`, and `stages.test.mjs`.',
      '- Test runner: `package.json:9` executes `node --test tests/*.test.mjs` without separate unit, integration, or worker test targets.',
      '- Absence of worker tests: Zero tests currently exercise `scripts/ocr_spark_engine.py` or `server/services/multipassOcr.ts`.',
      '- Seeded failure discipline: Test suites lack deliberate negative seed tests confirming pipeline fails on regression.'
    ],
    scope: {
      inScope: [
        'Separation of test targets into unit, integration, worker, and browser test commands in package.json.',
        'Implementation of seeded regression tests proving that syntax, type, or extraction failures fail the pipeline.',
        'Enforcement of zero swallowed exceptions or silent test skips.',
        'Test execution timing and timeout bounds (no hanging test runner processes).'
      ],
      outOfScope: [
        'Full Playwright end-to-end browser matrix (Stage 38).',
        'Load testing under sustained concurrency (Stage 40).'
      ],
      notPromised: [
        '100% test coverage across untracked legacy prototypes.'
      ]
    },
    workBreakdown: [
      {
        task: 'Task 1: Test Suite Categorization in package.json',
        description: 'Define explicit npm scripts: test:unit, test:integration, test:worker, and test:all.',
        ownedPaths: 'package.json',
        fact: 'Fact 1: Test suites categorized into distinct commands'
      },
      {
        task: 'Task 2: Seeded Failure and Timeout Assertion Test',
        description: 'Author meta-tests verifying that intentional failures cause non-zero exit codes.',
        ownedPaths: 'tests/stage7TestIntegrity.test.mjs',
        fact: 'Fact 2: Seeded failures reliably trigger pipeline exit 1'
      },
      {
        task: 'Task 3: Worker Subprocess Test Harness',
        description: 'Implement test runner helper to invoke and validate Python OCR worker scripts.',
        ownedPaths: 'tests/helpers/workerHarness.mjs',
        fact: 'Fact 3: Worker test harness captures stdout/stderr and exit codes'
      },
      {
        task: 'Task 4: Gate Verification Audit',
        description: 'Verify verify-gate.ps1 executes concurrent checks and captures structured evidence.',
        ownedPaths: 'automation/runs/stage-07/gate-audit.json',
        fact: 'Fact 4: Gate runner verified against seeded errors'
      }
    ],
    contractsToFreeze: `export interface TestSuiteResult {
  suite: 'unit' | 'integration' | 'worker' | 'governance';
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
  exitCode: number;
}`,
    fanOut: {
      archetype: 'Archetype B (Test Infrastructure and Governance)',
      lanes: [
        { lane: 'Lane 1', role: 'test-author', mode: 'CODE', ownedPaths: 'tests/stage7TestIntegrity.test.mjs,tests/helpers/**', deliverable: 'Test suite integrity harness' },
        { lane: 'Lane 2', role: 'impl-lane', mode: 'CODE', ownedPaths: 'package.json', deliverable: 'Categorized npm test scripts' }
      ],
      sharedFiles: 'package.json'
    },
    acceptanceEvidence: [
      { fact: 'Fact 1: Test suites categorized into distinct commands', command: 'npm run test:unit --if-present', expectedOutcome: 'Targeted unit test run completes cleanly', status: 'pending', evidencePath: 'automation/runs/stage-07/suite-categorization.json' },
      { fact: 'Fact 2: Seeded failures reliably trigger pipeline exit 1', command: 'node --test tests/stage7TestIntegrity.test.mjs', expectedOutcome: 'Seeded test failures result in non-zero exit code', status: 'pending', evidencePath: 'automation/runs/stage-07/seeded-failure.json' },
      { fact: 'Fact 3: Worker test harness captures stdout/stderr and exit codes', command: 'node -e "assert(fs.existsSync(\'tests/helpers/workerHarness.mjs\'))"', expectedOutcome: 'Worker test helper is importable and functional', status: 'pending', evidencePath: 'automation/runs/stage-07/worker-harness.json' },
      { fact: 'Fact 4: Gate runner verified against seeded errors', command: 'powershell -ExecutionPolicy Bypass -Command "& .junie/skills/max-throughput/scripts/verify-gate.ps1 -Checks test"', expectedOutcome: 'Concurrent runner reports passing exit code', status: 'pending', evidencePath: 'automation/runs/stage-07/gate-audit.json' }
    ],
    tests: {
      negative: [
        'Seeded syntax error in test fixture produces exit code 1, not swallowed 0.',
        'Test timeout (>30s) triggers runner abort and failing exit status.'
      ],
      boundary: [
        'Suite with 0 tests reports warning but does not mask unexecuted tests.',
        'Concurrent execution of all test suites completes within 10s wall clock.'
      ],
      interruption: [
        'SIGINT aborts test runner cleanly without leaving orphaned Node/Python processes.',
        'Temporary test directories wiped automatically after execution.'
      ],
      security: [
        'Test logs sanitize any mock credentials or local filesystem paths.',
        'Test runners execute with unprivileged user permissions.'
      ]
    },
    dependencies: {
      upstream: [
        'Stage 4 (Truthful demonstration/live separation): Ensures tests run against live paths.',
        'Stage 6 (Build and startup corrections): Clean build and startup required for integration tests.'
      ],
      downstream: [
        'Stage 9 (Extraction reproductions and boundaries): Uses test harness for edge case reproductions.',
        'Stage 13 (Persistence invariants): Relies on trustworthy test assertions for ACID checks.',
        'Stage 38 (Full workflow and test-effectiveness checks): Expands test matrix to full system.'
      ]
    },
    externalGates: {
      blocker: 'None',
      harness: 'Automated meta-test executing isolated failing subtests and asserting exit 1',
      signoff: 'None'
    },
    risksAndDefects: {
      risks: [
        'Risk 1: Windows console buffer truncating test output in PowerShell pipelines.'
      ],
      defects: [
        'Known defect 1: `package.json:9` relies on glob wildcard which can fail if test folder is empty.'
      ]
    },
    completionDraft: {
      s0: 'Audit current tests directory and execution timing.',
      s1: 'Draft test categorization and seeded failure specification.',
      s2: 'Author test helpers and integrity tests; update package.json.',
      s3: 'Execute verify-gate.ps1 and unit test suites.',
      s4: 'Independent review verifies that no test swallows failures.',
      s5: 'Tune timeouts and subprocess termination.',
      s6: 'Stage-exit checklist verification.',
      s7: 'Record promotion evidence.',
      s8: 'Advance to Stage 8.'
    }
  },

  8: {
    weightArea: 'extraction-validation',
    externalGates: ['representative-corpus-access'],
    verifiedState: [
      '- `src/data/sampleDocuments.ts:1-120`: Contains mock JSON document descriptors, not real PDF document binaries.',
      '- `src/data/gdriveDocuments.ts:1-80`: Contains static metadata fixtures.',
      '- Governed evaluation corpus absent: No repository folder contains curated, ground-truth annotated Australian banking PDFs.',
      '- Split policy: No formalized separation between development tuning set and held-out evaluation set.'
    ],
    scope: {
      inScope: [
        'Corpus governance specification defining provenance, retention, and annotation schema.',
        'Synthetic document generation pipeline creating realistic Australian bank statements, payslips, and loan applications.',
        'Ground-truth JSON annotation format mapping exact character offsets and bounding boxes.',
        'Strict split contract: 70% development corpus, 30% held-out evaluation corpus.'
      ],
      outOfScope: [
        'Real production customer PII ingestion without legal clearance.',
        'Cloud storage synchronization of sensitive evaluation documents.'
      ],
      notPromised: [
        'Unlimited access to proprietary banking portal document templates.'
      ]
    },
    workBreakdown: [
      {
        task: 'Task 1: Corpus Governance and Privacy Specification',
        description: 'Document corpus provenance, synthetic generation rules, and de-identification standards.',
        ownedPaths: 'docs/stage8/corpus-governance.md',
        fact: 'Fact 1: Corpus governance and privacy standards defined'
      },
      {
        task: 'Task 2: Ground-Truth Annotation Schema Definition',
        description: 'Formalize JSON schema for document annotations, bounding boxes, and applicant roles.',
        ownedPaths: 'docs/stage8/annotation-schema.json',
        fact: 'Fact 2: Ground-truth annotation schema frozen'
      },
      {
        task: 'Task 3: Synthetic Corpus Generator and Split Manifest',
        description: 'Implement synthetic banking document generator producing development and held-out splits.',
        ownedPaths: 'scripts/corpus/generate-synthetic-corpus.mjs',
        fact: 'Fact 3: Synthetic corpus generated with distinct splits'
      },
      {
        task: 'Task 4: Corpus Validation and Duplicate Leakage Test',
        description: 'Author automated test asserting zero document overlap between dev and held-out splits.',
        ownedPaths: 'tests/stage8Corpus.test.mjs',
        fact: 'Fact 4: Zero leakage between dev and evaluation splits'
      }
    ],
    contractsToFreeze: `export interface CorpusDocument {
  id: string;
  filename: string;
  documentType: 'bank_statement' | 'payslip' | 'tax_assessment' | 'id_card';
  split: 'development' | 'held_out';
  sha256: string;
  pageCount: number;
  annotations: Array<{
    fieldId: string;
    expectedRawValue: string;
    expectedCanonicalValue: string;
    pageIndex: number;
    bbox?: [number, number, number, number];
  }>;
}`,
    fanOut: {
      archetype: 'Archetype B (Dataset Governance and Synthetic Corpus)',
      lanes: [
        { lane: 'Lane 1', role: 'impl-lane', mode: 'CODE', ownedPaths: 'docs/stage8/**', deliverable: 'Corpus governance and annotation schemas' },
        { lane: 'Lane 2', role: 'impl-lane', mode: 'CODE', ownedPaths: 'scripts/corpus/**', deliverable: 'Synthetic corpus generation tool' },
        { lane: 'Lane 3', role: 'test-author', mode: 'CODE', ownedPaths: 'tests/stage8Corpus.test.mjs', deliverable: 'Corpus integrity and leakage test suite' }
      ],
      sharedFiles: 'None'
    },
    acceptanceEvidence: [
      { fact: 'Fact 1: Corpus governance and privacy standards defined', command: 'node -e "assert(fs.existsSync(\'docs/stage8/corpus-governance.md\'))"', expectedOutcome: 'Governance document establishes de-identification rules', status: 'pending', evidencePath: 'automation/runs/stage-08/governance-audit.json' },
      { fact: 'Fact 2: Ground-truth annotation schema frozen', command: 'node -e "assert(fs.existsSync(\'docs/stage8/annotation-schema.json\'))"', expectedOutcome: 'JSON schema validates bounding box and field annotations', status: 'pending', evidencePath: 'automation/runs/stage-08/schema-audit.json' },
      { fact: 'Fact 3: Synthetic corpus generated with distinct splits', command: 'node scripts/corpus/generate-synthetic-corpus.mjs --count 20', expectedOutcome: 'Generates 20 synthetic documents split into dev and held-out', status: 'pending', evidencePath: 'automation/runs/stage-08/corpus-manifest.json' },
      { fact: 'Fact 4: Zero leakage between dev and evaluation splits', command: 'node --test tests/stage8Corpus.test.mjs', expectedOutcome: 'Hash comparison confirms zero duplicate content across splits', status: 'pending', evidencePath: 'automation/runs/stage-08/leakage-audit.json' }
    ],
    tests: {
      negative: [
        'Document appearing in both development and held-out splits throws leakage assertion error.',
        'Annotation file missing mandatory target field fails schema validation.'
      ],
      boundary: [
        'Corpus generator handles single-page and multi-page (up to 50 pages) documents.',
        'Split ratio exactly matches 70% dev / 30% held-out.'
      ],
      interruption: [
        'Synthetic corpus generation is seeded and deterministic across runs.',
        'Re-running generation does not mutate existing document hashes.'
      ],
      security: [
        'Corpus generation uses strictly synthetic names, BSBs, and accounts from test registries.',
        'Zero real customer PII committed to repo or generated artifacts.'
      ]
    },
    dependencies: {
      upstream: [
        'Stage 3 (Architecture and failure model): Governs storage location of corpus files.'
      ],
      downstream: [
        'Stage 9 (Extraction reproductions and boundaries): Uses corpus edge cases for boundary tests.',
        'Stage 36 (Reproducible quality benchmark): Evaluates accuracy against this corpus.',
        'Stage 42 (Frozen independent evaluation/pilot): Uses held-out split for final evaluation.'
      ]
    },
    externalGates: {
      blocker: 'representative-corpus-access (access to real commercial bank statement layouts)',
      harness: 'Automated synthetic document generator creating compliant PDF/PNG fixtures',
      signoff: 'Owner sign-off required for real commercial banking document evaluation'
    },
    risksAndDefects: {
      risks: [
        'Risk 1: Synthetic document layouts may oversimplify real-world OCR noise and scanning artifacts.'
      ],
      defects: [
        'Known defect 1: Current repo contains zero actual PDF test fixtures.'
      ]
    },
    completionDraft: {
      s0: 'Audit sample documents and annotation requirements.',
      s1: 'Draft corpus governance document and annotation schema.',
      s2: 'Author synthetic corpus generator and test suite.',
      s3: 'Execute corpus generation and validation tests.',
      s4: 'Independent review checks leakage prevention and de-identification.',
      s5: 'Refine synthetic document variations.',
      s6: 'Stage-exit checklist verification.',
      s7: 'Record promotion evidence.',
      s8: 'Advance to Stage 9.'
    }
  },

  9: {
    weightArea: 'extraction-validation',
    externalGates: [],
    verifiedState: [
      '- `src/data/bankFields.ts`: Expanded to 90 application fields and 9 identifiers (99 total).',
      '- `src/utils/ocrMatcherEngine.ts:1-200`: Matcher iterates regexes over text but lacks boundary test cases for leap days, future dates, leading zeros, or wrong applicant association.',
      '- Known extraction defects: Date parser converts ambiguous dates (e.g. 01/02/2024) inconsistently depending on system locale.',
      '- Fixed clock: No mock time provider exists in matcher utility to test time-dependent validation.'
    ],
    scope: {
      inScope: [
        'Reproduction test suite capturing known extraction defects: leap years, future dates, BSB leading zeros.',
        'Wrong-applicant association test cases (primary applicant income mapped to secondary applicant).',
        'Injectable fixed clock provider for deterministic date testing.',
        'Failing-before-fix discipline: all reproductions must fail against current code before fixes in Stage 10.'
      ],
      outOfScope: [
        'Fixing the extraction logic (handled in Stage 10).',
        'Modifying the bank field catalogue definitions (landed in Step 1).'
      ],
      notPromised: [
        'Guaranteed extraction from illegible handwriting or blurred stamps.'
      ]
    },
    workBreakdown: [
      {
        task: 'Task 1: Date and Leap Year Boundary Reproduction Tests',
        description: 'Author tests demonstrating failures on Feb 29 leap years, future dates, and Australian DD/MM/YYYY vs US MM/DD/YYYY.',
        ownedPaths: 'tests/reproductions/dateBoundaries.test.mjs',
        fact: 'Fact 1: Date and leap year edge cases reproduced'
      },
      {
        task: 'Task 2: Leading Zero and Numeric Preservation Tests',
        description: 'Author tests demonstrating truncation of leading zeros in BSB (e.g. 062-000) and account numbers.',
        ownedPaths: 'tests/reproductions/numericPreservation.test.mjs',
        fact: 'Fact 2: Leading zero truncation defect reproduced'
      },
      {
        task: 'Task 3: Applicant Association and Repeated Anchor Tests',
        description: 'Author tests for joint application documents where primary and secondary applicant fields collide.',
        ownedPaths: 'tests/reproductions/applicantCollision.test.mjs',
        fact: 'Fact 3: Applicant association collision reproduced'
      },
      {
        task: 'Task 4: Fixed Clock Provider Implementation',
        description: 'Implement injectable time service allowing deterministic evaluation of date validity.',
        ownedPaths: 'src/utils/clockProvider.ts',
        fact: 'Fact 4: Injectable clock provider active'
      }
    ],
    contractsToFreeze: `export interface ClockProvider {
  now(): Date;
  iso(): string;
  year(): number;
}

export interface ExtractionReproductionCase {
  id: string;
  rawText: string;
  fieldId: string;
  expectedDefect: 'date_locale_swap' | 'leading_zero_dropped' | 'wrong_applicant' | 'currency_symbol_swallowed';
  observedFailure: string;
}`,
    fanOut: {
      archetype: 'Archetype B (Reproduction Test Authoring)',
      lanes: [
        { lane: 'Lane 1', role: 'impl-lane', mode: 'CODE', ownedPaths: 'src/utils/clockProvider.ts', deliverable: 'Injectable clock utility' },
        { lane: 'Lane 2', role: 'test-author', mode: 'CODE', ownedPaths: 'tests/reproductions/**', deliverable: 'Reproduction test suites capturing extraction defects' }
      ],
      sharedFiles: 'None'
    },
    acceptanceEvidence: [
      { fact: 'Fact 1: Date and leap year edge cases reproduced', command: 'node --test tests/reproductions/dateBoundaries.test.mjs', expectedOutcome: 'Tests run and isolate date boundary failure modes', status: 'pending', evidencePath: 'automation/runs/stage-09/date-reproduction.json' },
      { fact: 'Fact 2: Leading zero truncation defect reproduced', command: 'node --test tests/reproductions/numericPreservation.test.mjs', expectedOutcome: 'Tests isolate numeric truncation defects', status: 'pending', evidencePath: 'automation/runs/stage-09/numeric-reproduction.json' },
      { fact: 'Fact 3: Applicant association collision reproduced', command: 'node --test tests/reproductions/applicantCollision.test.mjs', expectedOutcome: 'Tests isolate multi-applicant field collision', status: 'pending', evidencePath: 'automation/runs/stage-09/applicant-reproduction.json' },
      { fact: 'Fact 4: Injectable clock provider active', command: 'node -e "assert(fs.existsSync(\'src/utils/clockProvider.ts\'))"', expectedOutcome: 'ClockProvider exported and verified', status: 'pending', evidencePath: 'automation/runs/stage-09/clock-audit.json' }
    ],
    tests: {
      negative: [
        'Invalid calendar dates (e.g. 2023-02-29 or 2024-04-31) fail date validation.',
        'Document dates in the future (relative to fixed clock) flagged as invalid.'
      ],
      boundary: [
        'Feb 29 on leap year (2024) accepted; Feb 29 on non-leap year (2023) rejected.',
        'BSBs with leading zero ("012-345") retain the zero in extracted canonical value.'
      ],
      interruption: [
        'Clock provider override can be set and reset safely between tests.',
        'Reproduction tests execute deterministically regardless of host system timezone.'
      ],
      security: [
        'Regex patterns tested against ReDoS with 10,000 character hostile inputs.',
        'Malformed dates cannot cause infinite parser loops.'
      ]
    },
    dependencies: {
      upstream: [
        'Stage 2 (Document/workflow matrix): Uses matrix definitions for supported formats and applicant roles.',
        'Stage 7 (Trustworthy automated checks): Uses test harness for running reproductions.'
      ],
      downstream: [
        'Stage 10 (Correct extraction defects): Fixes the defects captured by these reproductions.'
      ]
    },
    externalGates: {
      blocker: 'None',
      harness: 'Automated reproduction suite with mock text fixtures',
      signoff: 'None'
    },
    risksAndDefects: {
      risks: [
        'Risk 1: Host system timezone settings altering date parsing behavior.'
      ],
      defects: [
        'Known defect 1: `src/utils/ocrMatcherEngine.ts` parses dates using native `new Date()` without locale normalization.'
      ]
    },
    completionDraft: {
      s0: 'Audit ocrMatcherEngine.ts for date and numeric extraction pitfalls.',
      s1: 'Draft reproduction test suite specifications and clock provider.',
      s2: 'Author `clockProvider.ts` and `tests/reproductions/`.',
      s3: 'Execute reproduction tests confirming known defects are isolated.',
      s4: 'Independent review verifies that tests are genuine failing reproductions.',
      s5: 'Refine test assertions.',
      s6: 'Stage-exit checklist verification.',
      s7: 'Record promotion evidence.',
      s8: 'Advance to Stage 10.'
    }
  },

  10: {
    weightArea: 'extraction-validation',
    externalGates: [],
    verifiedState: [
      '- `src/utils/ocrMatcherEngine.ts:1-250`: Core regex extraction engine; currently lacks normalization for Australian date layouts and BSB padding.',
      '- `src/utils/australianValidationUtility.ts:1-180`: Validates ABN, BSB, TFN, but lacks integration with multi-pass candidate scoring.',
      '- Reproduction suite from Stage 9: Identifies leap year, leading zero, and applicant collision defects requiring fix.',
      '- Format validation must not be presented as authoritative identity verification.'
    ],
    scope: {
      inScope: [
        'Fix date parsing to strictly enforce DD/MM/YYYY precedence for Australian documents with leap year support.',
        'Preserve leading zeros in BSB, account number, and CRN extractions.',
        'Implement applicant-scoped context anchors preventing field collisions in joint applications.',
        'Ensure all Stage 9 reproductions pass without weakening any existing validation checks.'
      ],
      outOfScope: [
        'Complete rewrite of regex definitions (99 definitions established in Step 1).',
        'External identity verification service integration (prohibited by charter scope).'
      ],
      notPromised: [
        'Automated legal identity verification based purely on document text checksums.'
      ]
    },
    workBreakdown: [
      {
        task: 'Task 1: Strict Australian Date Normalization Engine',
        description: 'Implement deterministic date parser handling DD/MM/YYYY, leap years, and fixed clock validation.',
        ownedPaths: 'src/utils/dateNormalizer.ts',
        fact: 'Fact 1: Date normalizer handles Australian layouts and leap years'
      },
      {
        task: 'Task 2: Numeric and Identifier Zero-Preservation',
        description: 'Update matcher engine to preserve string formatting with leading zeros for BSB and account numbers.',
        ownedPaths: 'src/utils/ocrMatcherEngine.ts',
        fact: 'Fact 2: Matcher engine preserves leading zeros in identifiers'
      },
      {
        task: 'Task 3: Multi-Applicant Scope Filtering',
        description: 'Implement windowed bounding-box/paragraph proximity scoping for primary vs secondary applicants.',
        ownedPaths: 'src/utils/applicantScoper.ts',
        fact: 'Fact 3: Applicant scoping prevents joint applicant field cross-contamination'
      },
      {
        task: 'Task 4: Reproduction Suite Resolution Verification',
        description: 'Run Stage 9 reproduction tests to confirm 100% pass rate without regression.',
        ownedPaths: 'tests/stage10ExtractionFixes.test.mjs',
        fact: 'Fact 4: All extraction defect reproductions pass'
      }
    ],
    contractsToFreeze: `export interface NormalizedExtractionResult {
  fieldId: string;
  rawValue: string;
  canonicalValue: string;
  applicantIndex: number;
  confidence: number;
  validationStatus: 'valid' | 'invalid_format' | 'unverified_identity';
  validationMessage?: string;
}`,
    fanOut: {
      archetype: 'Archetype D (Extraction Engine Bug Fixes)',
      lanes: [
        { lane: 'Lane 1', role: 'impl-lane', mode: 'CODE', ownedPaths: 'src/utils/dateNormalizer.ts,src/utils/applicantScoper.ts', deliverable: 'Date and applicant normalizer utilities' },
        { lane: 'Lane 2', role: 'impl-lane', mode: 'CODE', ownedPaths: 'src/utils/ocrMatcherEngine.ts', deliverable: 'Matcher engine zero-preservation and integration' },
        { lane: 'Lane 3', role: 'test-author', mode: 'CODE', ownedPaths: 'tests/stage10ExtractionFixes.test.mjs', deliverable: 'Regression verification test suite' }
      ],
      sharedFiles: 'src/utils/ocrMatcherEngine.ts'
    },
    acceptanceEvidence: [
      { fact: 'Fact 1: Date normalizer handles Australian layouts and leap years', command: 'node --test tests/reproductions/dateBoundaries.test.mjs', expectedOutcome: 'All date reproduction tests pass', status: 'pending', evidencePath: 'automation/runs/stage-10/date-fix.json' },
      { fact: 'Fact 2: Matcher engine preserves leading zeros in identifiers', command: 'node --test tests/reproductions/numericPreservation.test.mjs', expectedOutcome: 'All numeric preservation tests pass', status: 'pending', evidencePath: 'automation/runs/stage-10/numeric-fix.json' },
      { fact: 'Fact 3: Applicant scoping prevents joint applicant field cross-contamination', command: 'node --test tests/reproductions/applicantCollision.test.mjs', expectedOutcome: 'All applicant collision tests pass', status: 'pending', evidencePath: 'automation/runs/stage-10/applicant-fix.json' },
      { fact: 'Fact 4: All extraction defect reproductions pass', command: 'node --test tests/stage10ExtractionFixes.test.mjs', expectedOutcome: 'Comprehensive extraction test suite exits 0', status: 'pending', evidencePath: 'automation/runs/stage-10/test-summary.json' }
    ],
    tests: {
      negative: [
        'Invalid BSB checksum or length (<6 digits) produces invalid_format status.',
        'Invalid Medicare checksum produces validation failure.'
      ],
      boundary: [
        'Date on December 31 and January 1 parses correctly across year boundaries.',
        'Currency values with trailing cents ($1,250.00) normalized to 1250.00 without loss.'
      ],
      interruption: [
        'Large text payload (>1MB) normalizes within 100ms without memory spike.',
        'Repeated normalization of identical string is strictly idempotent.'
      ],
      security: [
        'Zero evaluation of extracted text through eval() or dynamic Function().',
        'HTML tags and script injections inside extracted text escaped during normalization.'
      ]
    },
    dependencies: {
      upstream: [
        'Stage 9 (Extraction reproductions and boundaries): Defect reproductions serve as pass criteria.'
      ],
      downstream: [
        'Stage 11 (Versioned result contracts): Adopts normalized extraction result schema.',
        'Stage 20 (Integrated vertical slice): Integrates corrected extraction engine into end-to-end slice.',
        'Stage 37 (Development-only quality improvement): Builds upon stable extraction engine.'
      ]
    },
    externalGates: {
      blocker: 'None',
      harness: 'Automated unit tests validating normalization against synthetic test strings',
      signoff: 'None'
    },
    risksAndDefects: {
      risks: [
        'Risk 1: Australian vs US date ambiguity for days 1–12 (requires strict Australian DD/MM default).'
      ],
      defects: [
        'Known defect 1: `ocrMatcherEngine.ts:98` strips leading zeros when parsing integer fields.'
      ]
    },
    completionDraft: {
      s0: 'Re-run Stage 9 reproductions to verify baseline failures.',
      s1: 'Draft normalization and applicant scoping algorithms.',
      s2: 'Implement `dateNormalizer.ts`, `applicantScoper.ts`, and update `ocrMatcherEngine.ts`.',
      s3: 'Execute Stage 9 and Stage 10 test suites.',
      s4: 'Independent review verifies no checks were weakened.',
      s5: 'Refine boundary normalization edge cases.',
      s6: 'Stage-exit checklist verification.',
      s7: 'Record promotion evidence.',
      s8: 'Advance to Stage 11.'
    }
  },

  11: {
    weightArea: 'extraction-validation',
    externalGates: [],
    verifiedState: [
      '- `src/types.ts:1-120`: Defines UI and matcher types, but lacks formal versioned schemas for API requests and extraction results.',
      '- Absence of JSON Schema / Zod contracts: Endpoints in `server.ts` consume and produce loosely-typed JSON payloads.',
      '- Result provenance missing: No standardized contract tracks raw versus canonical values, candidate alternatives, or review status.',
      '- Error shapes inconsistent: Different routes return `{ error: string }`, `{ message: string }`, or plain text.'
    ],
    scope: {
      inScope: [
        'Formal versioned JSON schemas (v1) for document processing requests, extraction results, and errors.',
        'Standardized Result Contract including documentId, version, applicantIndex, rawValue, canonicalValue, confidence, bbox, and reviewState.',
        'Unified structured API error contract with machine-readable error codes.',
        'Automated contract validation middleware rejecting malformed payloads.'
      ],
      outOfScope: [
        'Database table creation for result persistence (Stage 12).',
        'GraphQL API schemas (REST only per project charter).'
      ],
      notPromised: [
        'Backwards compatibility for unversioned legacy prototype payloads.'
      ]
    },
    workBreakdown: [
      {
        task: 'Task 1: Versioned Result Contract Schema Definition',
        description: 'Define comprehensive Zod and JSON schemas for document processing results and candidates.',
        ownedPaths: 'src/contracts/resultContractV1.ts',
        fact: 'Fact 1: Versioned result contract v1 defined and frozen'
      },
      {
        task: 'Task 2: Standardized API Error Shape Contract',
        description: 'Define unified error response contract with error code taxonomy and parameter details.',
        ownedPaths: 'src/contracts/errorContract.ts',
        fact: 'Fact 2: Unified error contract standardized'
      },
      {
        task: 'Task 3: Request Payload Validation Middleware',
        description: 'Implement Express middleware validating incoming payloads against versioned schemas.',
        ownedPaths: 'server/middleware/validateContract.ts',
        fact: 'Fact 3: Contract validation middleware enforces schema'
      },
      {
        task: 'Task 4: Contract Conformance Test Suite',
        description: 'Author automated tests verifying sample extraction results against v1 schema.',
        ownedPaths: 'tests/stage11Contracts.test.mjs',
        fact: 'Fact 4: Contract conformance verified by tests'
      }
    ],
    contractsToFreeze: `export interface ExtractedFieldV1 {
  fieldId: string;
  fieldNumber: number;
  category: string;
  rawValue: string;
  canonicalValue: string;
  confidence: number;
  pageIndex: number;
  bbox?: [number, number, number, number];
  reviewState: 'unreviewed' | 'approved' | 'modified' | 'rejected';
  rejectionReason?: string;
}

export interface ProcessingResultV1 {
  contractVersion: '1.0.0';
  jobId: string;
  documentId: string;
  documentSha256: string;
  processedAt: string;
  durationMs: number;
  engineVersion: string;
  applicantCount: number;
  fields: ExtractedFieldV1[];
  errors: Array<{ code: string; message: string; fatal: boolean }>;
}`,
    fanOut: {
      archetype: 'Archetype B (Contract and Schema Definition)',
      lanes: [
        { lane: 'Lane 1', role: 'impl-lane', mode: 'CODE', ownedPaths: 'src/contracts/**', deliverable: 'Zod schemas and TypeScript result interfaces' },
        { lane: 'Lane 2', role: 'impl-lane', mode: 'CODE', ownedPaths: 'server/middleware/**', deliverable: 'Express schema validation middleware' },
        { lane: 'Lane 3', role: 'test-author', mode: 'CODE', ownedPaths: 'tests/stage11Contracts.test.mjs', deliverable: 'Contract validation test suite' }
      ],
      sharedFiles: 'None'
    },
    acceptanceEvidence: [
      { fact: 'Fact 1: Versioned result contract v1 defined and frozen', command: 'node -e "assert(fs.existsSync(\'src/contracts/resultContractV1.ts\'))"', expectedOutcome: 'Result contract v1 schema exported and typed', status: 'pending', evidencePath: 'automation/runs/stage-11/result-contract.json' },
      { fact: 'Fact 2: Unified error contract standardized', command: 'node -e "assert(fs.existsSync(\'src/contracts/errorContract.ts\'))"', expectedOutcome: 'Error contract exports standardized error codes', status: 'pending', evidencePath: 'automation/runs/stage-11/error-contract.json' },
      { fact: 'Fact 3: Contract validation middleware enforces schema', command: 'node --test tests/stage11Contracts.test.mjs', expectedOutcome: 'Invalid payloads rejected with 400 Bad Request', status: 'pending', evidencePath: 'automation/runs/stage-11/middleware-audit.json' },
      { fact: 'Fact 4: Contract conformance verified by tests', command: 'node --test tests/stage11Contracts.test.mjs', expectedOutcome: 'All schema validation and error tests pass', status: 'pending', evidencePath: 'automation/runs/stage-11/test-summary.json' }
    ],
    tests: {
      negative: [
        'Payload missing contractVersion field rejected with 400 Bad Request.',
        'Field with confidence outside 0.0–1.0 rejected by schema validator.'
      ],
      boundary: [
        'Document with 0 extracted fields validates successfully as empty result.',
        'Document with 99 extracted fields validates within schema constraints.'
      ],
      interruption: [
        'Schema parsing performance: validating 100 result objects executes in under 20ms.',
        'Contract serialization and deserialization is lossless.'
      ],
      security: [
        'Schema rejects unexpected additional properties (strict mode) to prevent parameter injection.',
        'Error contract strips internal database query text and stack traces from client responses.'
      ]
    },
    dependencies: {
      upstream: [
        'Stage 2 (Document/workflow matrix): Provides outcome states and supported formats.',
        'Stage 3 (Architecture and failure model): Establishes authoritative component boundaries.',
        'Stage 10 (Correct extraction defects): Normalized result structures formalized here.'
      ],
      downstream: [
        'Stage 12 (Transactional application storage): Persists results conforming to this contract.',
        'Stage 17 (Page-level native extraction/routing): Maps native text output to this contract.',
        'Stage 21 (Immutable extraction evidence): Stores candidate evidence using these schemas.'
      ]
    },
    externalGates: {
      blocker: 'None',
      harness: 'Automated schema validation test suite using in-memory mock JSON objects',
      signoff: 'None'
    },
    risksAndDefects: {
      risks: [
        'Risk 1: Breaking changes to frontend components if backend payload format shifts abruptly.'
      ],
      defects: [
        'Known defect 1: `server.ts:380` returns raw untyped object from in-memory matcher.'
      ]
    },
    completionDraft: {
      s0: 'Audit existing result objects and UI state interfaces.',
      s1: 'Draft v1 result contract schema and error code taxonomy.',
      s2: 'Author `resultContractV1.ts`, `errorContract.ts`, and validation middleware.',
      s3: 'Execute contract test suite via `npm test`.',
      s4: 'Independent review verifies contract completeness and boundaries.',
      s5: 'Tune schema constraints and error messages.',
      s6: 'Stage-exit checklist verification.',
      s7: 'Record promotion evidence.',
      s8: 'Advance to Stage 12.'
    }
  },

  12: {
    weightArea: 'persistence-recovery',
    externalGates: [],
    verifiedState: [
      '- `PROJECT_CHARTER.md:28`: Master architecture item 3 mandates transactional SQLite application database with migrations, constraints, durable jobs, attempts/leases, and review metadata.',
      '- `server.ts:1-50`: Currently uses in-memory Map / array structures for document and job state.',
      '- Database driver missing: `better-sqlite3` or `sqlite3` not yet configured in `package.json`.',
      '- Migrations directory: `server/db/migrations/` does not yet exist.'
    ],
    scope: {
      inScope: [
        'Adoption and configuration of `better-sqlite3` native database driver with WAL mode.',
        'Schema migration runner executing sequential versioned SQL migrations.',
        'Relational schema tables: documents, jobs, job_attempts, field_candidates, extraction_results, reviews, audit_logs.',
        'Foreign key constraints, unique indexes, and ACID transaction wrappers.'
      ],
      outOfScope: [
        'DuckDB analytical export queries (Stage 28).',
        'Distributed replication or SQLite cloud sync.'
      ],
      notPromised: [
        'Support for alternative RDBMS engines (Postgres, MySQL) in single-host scope.'
      ]
    },
    workBreakdown: [
      {
        task: 'Task 1: SQLite Driver Configuration and Migration Runner',
        description: 'Set up better-sqlite3 with WAL mode, foreign keys enabled, and sequential migration executor.',
        ownedPaths: 'server/db/database.ts,server/db/migrator.ts',
        fact: 'Fact 1: Migration runner executes versioned SQL migrations'
      },
      {
        task: 'Task 2: Initial Relational Schema Migration (001_initial.sql)',
        description: 'Define core tables: documents, jobs, attempts, extraction_results, reviews, audit_logs.',
        ownedPaths: 'server/db/migrations/001_initial.sql',
        fact: 'Fact 2: Initial schema tables created with constraints'
      },
      {
        task: 'Task 3: Transactional Repository Layer',
        description: 'Implement typed repository methods with atomic transaction wrappers for documents and jobs.',
        ownedPaths: 'server/db/repositories/documentRepository.ts,server/db/repositories/jobRepository.ts',
        fact: 'Fact 3: Transactional repositories handle CRUD and leases'
      },
      {
        task: 'Task 4: Storage Migration and Transaction Test Suite',
        description: 'Author automated tests verifying migration execution, foreign key enforcement, and rollback.',
        ownedPaths: 'tests/stage12Storage.test.mjs',
        fact: 'Fact 4: Database migration and transaction tests pass'
      }
    ],
    contractsToFreeze: `export interface DatabaseConfig {
  filename: string;
  walMode: boolean;
  busyTimeoutMs: number;
  foreignKeys: boolean;
}

export interface DocumentRecord {
  id: string;
  sha256: string;
  filename: string;
  byteSize: number;
  mimeType: string;
  pageCount: number;
  storagePath: string;
  createdAt: string;
}`,
    fanOut: {
      archetype: 'Archetype C (Database Engine and Schema Migration)',
      lanes: [
        { lane: 'Lane 1', role: 'impl-lane', mode: 'CODE', ownedPaths: 'server/db/database.ts,server/db/migrator.ts,server/db/migrations/**', deliverable: 'SQLite connection and migration files' },
        { lane: 'Lane 2', role: 'impl-lane', mode: 'CODE', ownedPaths: 'server/db/repositories/**', deliverable: 'Document and job repository implementations' },
        { lane: 'Lane 3', role: 'test-author', mode: 'CODE', ownedPaths: 'tests/stage12Storage.test.mjs', deliverable: 'SQLite transaction and migration test suite' }
      ],
      sharedFiles: 'package.json'
    },
    acceptanceEvidence: [
      { fact: 'Fact 1: Migration runner executes versioned SQL migrations', command: 'node -e "assert(fs.existsSync(\'server/db/migrator.ts\'))"', expectedOutcome: 'Migration runner compiles and verifies schema version table', status: 'pending', evidencePath: 'automation/runs/stage-12/migrator-audit.json' },
      { fact: 'Fact 2: Initial schema tables created with constraints', command: 'node --test tests/stage12Storage.test.mjs', expectedOutcome: 'Tables created with active foreign key enforcement', status: 'pending', evidencePath: 'automation/runs/stage-12/schema-audit.json' },
      { fact: 'Fact 3: Transactional repositories handle CRUD and leases', command: 'node --test tests/stage12Storage.test.mjs', expectedOutcome: 'Document insert and atomic job claim execute cleanly', status: 'pending', evidencePath: 'automation/runs/stage-12/repo-audit.json' },
      { fact: 'Fact 4: Database migration and transaction tests pass', command: 'node --test tests/stage12Storage.test.mjs', expectedOutcome: 'All storage tests pass with exit code 0', status: 'pending', evidencePath: 'automation/runs/stage-12/test-summary.json' }
    ],
    tests: {
      negative: [
        'Inserting job with non-existent document_id fails foreign key constraint.',
        'Inserting duplicate document SHA-256 triggers unique constraint error.'
      ],
      boundary: [
        'Busy timeout (5000ms) handles concurrent read/write locks gracefully.',
        'Rollback on simulated write error restores database to exact prior state.'
      ],
      interruption: [
        'Process crash during migration leaves database in consistent versioned state.',
        'Re-opening database in WAL mode recovers uncheckpointed WAL frames automatically.'
      ],
      security: [
        'Database file created with 0600 file permissions (owner read/write only).',
        'All SQL queries execute parameterized statements (zero raw string concatenation).'
      ]
    },
    dependencies: {
      upstream: [
        'Stage 3 (Architecture and failure model): Dictates SQLite master architecture requirements.',
        'Stage 11 (Versioned result contracts): Defines entities stored in schema.'
      ],
      downstream: [
        'Stage 13 (Persistence invariants): Exercises concurrency and rollback on this schema.',
        'Stage 15 (Private original storage): Associates file storage records with database.',
        'Stage 19 (Durable job transitions): Uses job state table for queue transitions.'
      ]
    },
    externalGates: {
      blocker: 'None',
      harness: 'Automated test suite using temporary SQLite database files in $env:TEMP',
      signoff: 'None'
    },
    risksAndDefects: {
      risks: [
        'Risk 1: Native binary build requirements for better-sqlite3 on Windows vs Linux.'
      ],
      defects: [
        'Known defect 1: Current application loses all document state on server restart.'
      ]
    },
    completionDraft: {
      s0: 'Audit database driver options and install better-sqlite3.',
      s1: 'Draft SQL migration schema and repository interfaces.',
      s2: 'Author `migrator.ts`, `001_initial.sql`, and repository layer.',
      s3: 'Execute database test suite via `npm test`.',
      s4: 'Independent review verifies foreign keys and transaction boundaries.',
      s5: 'Tune WAL checkpointing and busy timeouts.',
      s6: 'Stage-exit checklist verification.',
      s7: 'Record promotion evidence.',
      s8: 'Advance to Stage 13.'
    }
  },

  13: {
    weightArea: 'persistence-recovery',
    externalGates: [],
    verifiedState: [
      '- `PROJECT_CHARTER.md:81-82`: Tests database for duplicate filenames, concurrency, migration rollback, and protecting reviewed values from overwrite.',
      '- SQLite schema established in Stage 12: Tables exist, but high-concurrency ACID invariants and optimistic locking remain to be tested under multi-reader single-writer load.',
      '- Existing overwrite vulnerability: Reprocessing a document currently replaces extracted fields without checking if a human reviewer already approved or modified them.'
    ],
    scope: {
      inScope: [
        'Comprehensive persistence invariant test suite verifying ACID guarantees under parallel transactions.',
        'Enforcement of reviewed-value immutability: reprocessing a document preserves approved field values.',
        'Rollback verification: ensuring partial transactions leave zero orphan records.',
        'Foreign key constraint verification and vacuum integrity checks.'
      ],
      outOfScope: [
        'Distributed transaction coordinators (single SQLite file scope).',
        'Cross-database replication.'
      ],
      notPromised: [
        'Arbitrary multi-writer throughput exceeding SQLite hardware write limits.'
      ]
    },
    workBreakdown: [
      {
        task: 'Task 1: Reviewed Value Protection Invariant Enforcement',
        description: 'Implement database trigger or repository logic ensuring approved review records cannot be overwritten by automated reprocessing.',
        ownedPaths: 'server/db/repositories/reviewRepository.ts',
        fact: 'Fact 1: Reprocessing protects human-approved values'
      },
      {
        task: 'Task 2: High-Concurrency Transaction Stress Harness',
        description: 'Author concurrency test simulating 20 parallel transactions contesting document updates.',
        ownedPaths: 'tests/stage13Concurrency.test.mjs',
        fact: 'Fact 2: Concurrency harness confirms zero deadlock or data loss'
      },
      {
        task: 'Task 3: Migration Rollback and Schema Downgrade Test',
        description: 'Verify sequential down-migrations restore schema cleanly without data corruption.',
        ownedPaths: 'tests/stage13Rollback.test.mjs',
        fact: 'Fact 3: Schema rollback executes without corruption'
      },
      {
        task: 'Task 4: Persistence Invariant Master Suite',
        description: 'Consolidate all database invariant tests into comprehensive test runner.',
        ownedPaths: 'tests/stage13Invariants.test.mjs',
        fact: 'Fact 4: All persistence invariant tests pass'
      }
    ],
    contractsToFreeze: `export interface PersistenceInvariantResult {
  acidVerified: boolean;
  walCheckpointed: boolean;
  foreignKeysEnforced: boolean;
  concurrencyCollisionsHandled: number;
  uncommittedOrphanRecords: 0;
}`,
    fanOut: {
      archetype: 'Archetype F (Persistence and Concurrency Testing)',
      lanes: [
        { lane: 'Lane 1', role: 'impl-lane', mode: 'CODE', ownedPaths: 'server/db/repositories/reviewRepository.ts', deliverable: 'Reviewed value protection logic' },
        { lane: 'Lane 2', role: 'test-author', mode: 'CODE', ownedPaths: 'tests/stage13*.test.mjs', deliverable: 'Concurrency and rollback test suites' }
      ],
      sharedFiles: 'None'
    },
    acceptanceEvidence: [
      { fact: 'Fact 1: Reprocessing protects human-approved values', command: 'node --test tests/stage13Invariants.test.mjs', expectedOutcome: 'Approved values preserved across simulated re-run', status: 'pending', evidencePath: 'automation/runs/stage-13/review-protection.json' },
      { fact: 'Fact 2: Concurrency harness confirms zero deadlock or data loss', command: 'node --test tests/stage13Concurrency.test.mjs', expectedOutcome: 'All 20 concurrent transactions complete cleanly with WAL mode', status: 'pending', evidencePath: 'automation/runs/stage-13/concurrency-test.json' },
      { fact: 'Fact 3: Schema rollback executes without corruption', command: 'node --test tests/stage13Rollback.test.mjs', expectedOutcome: 'Migration rollback restores clean previous state', status: 'pending', evidencePath: 'automation/runs/stage-13/rollback-test.json' },
      { fact: 'Fact 4: All persistence invariant tests pass', command: 'node --test tests/stage13Invariants.test.mjs', expectedOutcome: 'All invariant checks pass with exit code 0', status: 'pending', evidencePath: 'automation/runs/stage-13/test-summary.json' }
    ],
    tests: {
      negative: [
        'Attempting to update an approved review record without incrementing version throws concurrency error.',
        'Corrupting database header triggers SQLite disk I/O error instead of silent corruption.'
      ],
      boundary: [
        'Handling exactly 50 parallel reader threads while 1 writer transaction is active.',
        'Transaction rollback restores 1000 bulk inserted rows cleanly.'
      ],
      interruption: [
        'Abrupt process termination during active write recovers uncommitted transactions on next open.',
        'Repeated VACUUM and WAL checkpoints maintain database file integrity.'
      ],
      security: [
        'Database connections enforce read-only pragma on read-only queries.',
        'Zero plaintext passwords stored in any table (hashes only).'
      ]
    },
    dependencies: {
      upstream: [
        'Stage 7 (Trustworthy automated checks): Provides test runner framework.',
        'Stage 12 (Transactional application storage): Establishes SQLite database and schema.'
      ],
      downstream: [
        'Stage 14 (Authentication and authorization): Stores user accounts and sessions in database.',
        'Stage 20 (Integrated vertical slice): Leverages transactional persistence in end-to-end slice.',
        'Stage 25 (Combined fault sequences): Chaos tests build upon these persistence invariants.'
      ]
    },
    externalGates: {
      blocker: 'None',
      harness: 'Automated multi-worker transaction test script using worker threads',
      signoff: 'None'
    },
    risksAndDefects: {
      risks: [
        'Risk 1: Windows filesystem locking differences when multiple processes access SQLite file.'
      ],
      defects: [
        'Known defect 1: No mechanism currently prevents re-uploading an existing document from wiping past review notes.'
      ]
    },
    completionDraft: {
      s0: 'Audit database transaction behavior and pragma settings.',
      s1: 'Draft persistence invariant test scenarios and locking rules.',
      s2: 'Implement review protection in repository and author test suites.',
      s3: 'Execute concurrency and invariant tests via `npm test`.',
      s4: 'Independent review verifies ACID guarantees and review immutability.',
      s5: 'Tune WAL busy timeouts and pragma configurations.',
      s6: 'Stage-exit checklist verification.',
      s7: 'Record promotion evidence.',
      s8: 'Advance to Stage 14.'
    }
  },

  14: {
    weightArea: 'security',
    externalGates: [],
    verifiedState: [
      '- `PROJECT_CHARTER.md:32`: Master architecture item 7 requires established authentication, session management, server-side RBAC, and protected downloads.',
      '- `server.ts:1-50`: All 9 existing endpoints currently lack authentication or authorization middleware.',
      '- Unprotected endpoints: Any caller can trigger `/api/process-document`, access `/api/multipass/ledger`, or inspect telemetry without credentials.',
      '- Password hashing and session storage: No user accounts table, bcrypt hashing, or session store exists.'
    ],
    scope: {
      inScope: [
        'User authentication with secure password hashing (argon2 or bcrypt with cost >= 12).',
        'Session management via signed HTTP-only secure cookies with CSRF protection.',
        'Role-Based Access Control (RBAC) supporting Operator, Reviewer, and Admin roles.',
        'Server-side authorization guards protecting all document, preview, job, and export endpoints.'
      ],
      outOfScope: [
        'External OAuth SSO / SAML integrations (prohibited by single-host charter scope).',
        'Multi-factor hardware key authentication.'
      ],
      notPromised: [
        'Anonymous public document upload without user authentication.'
      ]
    },
    workBreakdown: [
      {
        task: 'Task 1: User Account Schema and Password Hashing Service',
        description: 'Define users and sessions SQL tables and implement secure password hashing utility.',
        ownedPaths: 'server/auth/passwordService.ts,server/db/migrations/002_auth.sql',
        fact: 'Fact 1: User schema and password hashing service implemented'
      },
      {
        task: 'Task 2: Session and Token Authentication Middleware',
        description: 'Implement signed cookie session management with session revocation and expiry.',
        ownedPaths: 'server/auth/sessionMiddleware.ts',
        fact: 'Fact 2: Session authentication middleware verifies credentials'
      },
      {
        task: 'Task 3: Role-Based Authorization Guard Middleware',
        description: 'Implement RBAC middleware enforcing role permissions (operator, reviewer, admin).',
        ownedPaths: 'server/auth/rbacMiddleware.ts',
        fact: 'Fact 3: RBAC middleware restricts sensitive endpoints'
      },
      {
        task: 'Task 4: Authentication and Authorization Test Suite',
        description: 'Author automated tests verifying login, session expiry, role denial, and protected routes.',
        ownedPaths: 'tests/stage14Auth.test.mjs',
        fact: 'Fact 4: Auth test suite passes all security scenarios'
      }
    ],
    contractsToFreeze: `export type UserRole = 'operator' | 'reviewer' | 'admin';

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
}`,
    fanOut: {
      archetype: 'Archetype H (Authentication and RBAC Security)',
      lanes: [
        { lane: 'Lane 1', role: 'impl-lane', mode: 'CODE', ownedPaths: 'server/auth/**', deliverable: 'Authentication and session middleware' },
        { lane: 'Lane 2', role: 'impl-lane', mode: 'CODE', ownedPaths: 'server/db/migrations/002_auth.sql', deliverable: 'User and session database migration' },
        { lane: 'Lane 3', role: 'test-author', mode: 'CODE', ownedPaths: 'tests/stage14Auth.test.mjs', deliverable: 'Security and authorization test suite' }
      ],
      sharedFiles: 'server.ts'
    },
    acceptanceEvidence: [
      { fact: 'Fact 1: User schema and password hashing service implemented', command: 'node -e "assert(fs.existsSync(\'server/auth/passwordService.ts\'))"', expectedOutcome: 'Password service hashes with bcrypt cost 12', status: 'pending', evidencePath: 'automation/runs/stage-14/password-audit.json' },
      { fact: 'Fact 2: Session authentication middleware verifies credentials', command: 'node --test tests/stage14Auth.test.mjs', expectedOutcome: 'Unauthenticated requests to protected endpoints return 401', status: 'pending', evidencePath: 'automation/runs/stage-14/session-audit.json' },
      { fact: 'Fact 3: RBAC middleware restricts sensitive endpoints', command: 'node --test tests/stage14Auth.test.mjs', expectedOutcome: 'Operator role denied access to Admin-only endpoints with 403', status: 'pending', evidencePath: 'automation/runs/stage-14/rbac-audit.json' },
      { fact: 'Fact 4: Auth test suite passes all security scenarios', command: 'node --test tests/stage14Auth.test.mjs', expectedOutcome: 'All authentication and authorization tests pass', status: 'pending', evidencePath: 'automation/runs/stage-14/test-summary.json' }
    ],
    tests: {
      negative: [
        'Invalid password returns 401 Unauthorized with constant-time comparison.',
        'Expired session token rejected with 401 Unauthorized.',
        'Tampered cookie signature rejected immediately.'
      ],
      boundary: [
        'Session expiry boundary: valid at expiry - 1s, rejected at expiry + 1s.',
        'User password minimum length enforced (minimum 12 characters).'
      ],
      interruption: [
        'Session revocation immediately invalidates all active sessions for targeted user.',
        'Server restart does not invalidate persisted valid sessions.'
      ],
      security: [
        'Session cookie configured with HttpOnly, SameSite=Strict, and Secure flags.',
        'Protection against timing attacks via constant-time hash comparisons.',
        'Passwords never logged in plaintext under any circumstances.'
      ]
    },
    dependencies: {
      upstream: [
        'Stage 13 (Persistence invariants): Relies on reliable SQLite transactions for user/session tables.'
      ],
      downstream: [
        'Stage 15 (Private original storage): Uses user context for storage access control.',
        'Stage 16 (Untrusted upload handling): Enforces upload permissions per user role.',
        'Stage 26 (Real document/result interface): Adapts UI view based on authenticated role.'
      ]
    },
    externalGates: {
      blocker: 'None',
      harness: 'Automated HTTP client tests asserting 401/403 status codes on protected routes',
      signoff: 'None'
    },
    risksAndDefects: {
      risks: [
        'Risk 1: Hardcoded development secrets leaking into production environments.'
      ],
      defects: [
        'Known defect 1: All current endpoints in `server.ts` are publicly accessible without authentication.'
      ]
    },
    completionDraft: {
      s0: 'Audit all existing server routes for missing auth guards.',
      s1: 'Draft authentication architecture and RBAC role matrix.',
      s2: 'Author auth migration, password service, session middleware, and test suite.',
      s3: 'Execute auth test suite via `npm test`.',
      s4: 'Independent review checks for timing attacks and cookie flags.',
      s5: 'Refine error messages and session timeout configurations.',
      s6: 'Stage-exit checklist verification.',
      s7: 'Record promotion evidence.',
      s8: 'Advance to Stage 15.'
    }
  },

  15: {
    weightArea: 'security',
    externalGates: [],
    verifiedState: [
      '- `PROJECT_CHARTER.md:29`: Master architecture item 4 mandates private original storage outside public assets with generated UUID keys, integrity hashes, and ownership checks.',
      '- Public assets risk: Vite serves static files from `dist/` or project root; uploaded documents must never reside in web-accessible directories.',
      '- Storage path abstraction: No dedicated storage manager module exists to handle document disk writes, integrity checks, or encrypted delivery.',
      '- Guessable filenames: Current upload logic retains original user filenames directly.'
    ],
    scope: {
      inScope: [
        'Private filesystem storage outside web root (`storage/originals/`, `storage/previews/`).',
        'UUIDv4 random key generation for stored artifacts to eliminate path guessing.',
        'SHA-256 integrity hash calculation and verification during upload and retrieval.',
        'Protected streaming delivery endpoint with authentication and ownership validation.'
      ],
      outOfScope: [
        'Cloud S3 object storage (single-host private filesystem per charter).',
        'Hardware security module (HSM) key management.'
      ],
      notPromised: [
        'Direct static URL access to original customer banking documents.'
      ]
    },
    workBreakdown: [
      {
        task: 'Task 1: Private Storage Manager Implementation',
        description: 'Implement StorageService handling disk writes, UUID key generation, and directory isolation.',
        ownedPaths: 'server/storage/storageService.ts',
        fact: 'Fact 1: Storage service writes to private directory outside web root'
      },
      {
        task: 'Task 2: Cryptographic Integrity Hashing on Ingestion',
        description: 'Compute and verify SHA-256 digest on upload stream; store in database document record.',
        ownedPaths: 'server/storage/integrityHasher.ts',
        fact: 'Fact 2: Ingestion computes and stores SHA-256 hash'
      },
      {
        task: 'Task 3: Protected Document Streaming Endpoint',
        description: 'Implement GET /api/documents/:id/download with session auth and ownership checks.',
        ownedPaths: 'server/routes/storageRoutes.ts',
        fact: 'Fact 3: Document retrieval enforces authentication and ownership'
      },
      {
        task: 'Task 4: Storage Security and Isolation Test Suite',
        description: 'Author automated tests verifying path traversal prevention, guessed UUID rejection, and integrity checks.',
        ownedPaths: 'tests/stage15Storage.test.mjs',
        fact: 'Fact 4: Storage isolation and security test suite passes'
      }
    ],
    contractsToFreeze: `export interface StoredArtifactMetadata {
  storageKey: string;
  originalFilename: string;
  sha256: string;
  byteSize: number;
  mimeType: string;
  storagePath: string;
  ownerId: string;
  createdAt: string;
}`,
    fanOut: {
      archetype: 'Archetype H (Private Storage and Integrity)',
      lanes: [
        { lane: 'Lane 1', role: 'impl-lane', mode: 'CODE', ownedPaths: 'server/storage/**', deliverable: 'Storage service and integrity hasher' },
        { lane: 'Lane 2', role: 'impl-lane', mode: 'CODE', ownedPaths: 'server/routes/storageRoutes.ts', deliverable: 'Protected document streaming endpoint' },
        { lane: 'Lane 3', role: 'test-author', mode: 'CODE', ownedPaths: 'tests/stage15Storage.test.mjs', deliverable: 'Storage security test suite' }
      ],
      sharedFiles: 'server.ts'
    },
    acceptanceEvidence: [
      { fact: 'Fact 1: Storage service writes to private directory outside web root', command: 'node -e "assert(fs.existsSync(\'server/storage/storageService.ts\'))"', expectedOutcome: 'Storage root configured outside dist and public directories', status: 'pending', evidencePath: 'automation/runs/stage-15/storage-audit.json' },
      { fact: 'Fact 2: Ingestion computes and stores SHA-256 hash', command: 'node --test tests/stage15Storage.test.mjs', expectedOutcome: 'Stored file hash matches computed SHA-256 exactly', status: 'pending', evidencePath: 'automation/runs/stage-15/integrity-audit.json' },
      { fact: 'Fact 3: Document retrieval enforces authentication and ownership', command: 'node --test tests/stage15Storage.test.mjs', expectedOutcome: 'Unauthenticated or cross-owner download attempts return 403', status: 'pending', evidencePath: 'automation/runs/stage-15/auth-download.json' },
      { fact: 'Fact 4: Storage isolation and security test suite passes', command: 'node --test tests/stage15Storage.test.mjs', expectedOutcome: 'All storage security tests pass with exit code 0', status: 'pending', evidencePath: 'automation/runs/stage-15/test-summary.json' }
    ],
    tests: {
      negative: [
        'Path traversal attacks (e.g. `../../etc/passwd` or `..\\\\..\\\\boot.ini`) rejected with 400 Bad Request.',
        'Requesting unowned document ID returns 403 Forbidden.',
        'Corrupted file whose hash diverges from database record triggers 500 integrity error.'
      ],
      boundary: [
        'Storing 0-byte file rejected; storing exactly 25 MiB file accepted.',
        'File with 25 MiB + 1 byte rejected at storage layer.'
      ],
      interruption: [
        'Interrupted file upload cleans partial temporary file without leaving disk orphan.',
        'Re-downloading identical document streams full content without truncation.'
      ],
      security: [
        'Stored files saved with non-executable permissions (chmod 0600 on POSIX).',
        'Directory listing strictly disabled on storage folders.',
        'Original user filenames sanitized to strip shell special characters.'
      ]
    },
    dependencies: {
      upstream: [
        'Stage 12 (Transactional application storage): Relational records map to storage keys.',
        'Stage 14 (Authentication and authorization): Enforces user ownership of stored files.'
      ],
      downstream: [
        'Stage 16 (Untrusted upload handling): Feeds validated files into private storage.',
        'Stage 20 (Integrated vertical slice): Connects upload to private storage and OCR worker.',
        'Stage 34 (Full data lifecycle): Governs retention and deletion of stored artifacts.'
      ]
    },
    externalGates: {
      blocker: 'None',
      harness: 'Automated path traversal fuzzing test suite in temporary sandbox directory',
      signoff: 'None'
    },
    risksAndDefects: {
      risks: [
        'Risk 1: File descriptor leaks during high-throughput file streaming.'
      ],
      defects: [
        'Known defect 1: Current application stores uploads in memory without disk persistence.'
      ]
    },
    completionDraft: {
      s0: 'Audit storage directory structure and permissions.',
      s1: 'Draft private storage manager and integrity verification design.',
      s2: 'Author `storageService.ts`, `integrityHasher.ts`, routes, and tests.',
      s3: 'Execute storage security tests via `npm test`.',
      s4: 'Independent review audits path traversal and ownership checks.',
      s5: 'Refine stream cleanup and error handlers.',
      s6: 'Stage-exit checklist verification.',
      s7: 'Record promotion evidence.',
      s8: 'Advance to Stage 16.'
    }
  },

  16: {
    weightArea: 'security',
    externalGates: [],
    verifiedState: [
      '- `PROJECT_CHARTER.md:90-91`: Validate file signatures, dimensions/pages/size, bound parser resources, and isolate active content.',
      '- `server.ts:370-385`: `POST /api/process-document` accepts arbitrary raw text or multipart data without MIME sniffing or magic byte validation.',
      '- DoS vulnerability: Malformed, oversized, or zip-bomb PDFs can exhaust server memory or block the single thread.',
      '- Active content: PDFs may embed JavaScript actions, external URI launches, or malicious form scripts.'
    ],
    scope: {
      inScope: [
        'Magic byte validation (file signatures) for PDF (`%PDF-`), PNG, and JPEG formats.',
        'Configurable upload bounds: strictly reject files > 25 MiB or > 50 pages.',
        'PDF active content inspection and sanitization: strip `/JavaScript`, `/Launch`, `/EmbeddedFiles`.',
        'Bounded resource allocation during multipart streaming upload.'
      ],
      outOfScope: [
        'Full anti-virus integration (ClamAV) (external gate / optional enterprise add-on).',
        'Office document formats (DOCX/XLSX) excluded by charter input specification.'
      ],
      notPromised: [
        'Execution of interactive PDF scripts or embedded Flash/media.'
      ]
    },
    workBreakdown: [
      {
        task: 'Task 1: Magic Byte and MIME Signature Validator',
        description: 'Implement header inspection validating magic numbers for PDF, PNG, and JPEG files.',
        ownedPaths: 'server/upload/signatureValidator.ts',
        fact: 'Fact 1: Magic byte validator inspects file headers'
      },
      {
        task: 'Task 2: Upload Bounds and Page Limit Enforcer',
        description: 'Enforce 25 MiB size limit and inspect page count before handing to worker.',
        ownedPaths: 'server/upload/boundsEnforcer.ts',
        fact: 'Fact 2: Upload bounds enforce 25 MiB and 50 page caps'
      },
      {
        task: 'Task 3: PDF Active Content Scanner and Sanitizer',
        description: 'Scan PDF byte stream for /JavaScript, /Launch, and /EmbeddedFiles actions; reject or strip.',
        ownedPaths: 'server/upload/pdfSanitizer.ts',
        fact: 'Fact 3: Active content scanner rejects executable PDF streams'
      },
      {
        task: 'Task 4: Untrusted Upload Security Test Suite',
        description: 'Author tests against polyglot files, corrupted headers, oversized payloads, and active content.',
        ownedPaths: 'tests/stage16Upload.test.mjs',
        fact: 'Fact 4: Untrusted upload test suite passes all security vectors'
      }
    ],
    contractsToFreeze: `export interface UploadValidationResult {
  valid: boolean;
  detectedFormat: 'pdf' | 'png' | 'jpeg';
  byteSize: number;
  pageCount: number;
  hasActiveContent: boolean;
  sanitized: boolean;
  rejectionReason?: string;
}`,
    fanOut: {
      archetype: 'Archetype H (Upload Security and Input Validation)',
      lanes: [
        { lane: 'Lane 1', role: 'impl-lane', mode: 'CODE', ownedPaths: 'server/upload/**', deliverable: 'Upload validation and sanitizer utilities' },
        { lane: 'Lane 2', role: 'test-author', mode: 'CODE', ownedPaths: 'tests/stage16Upload.test.mjs', deliverable: 'Hostile upload and polyglot test suite' }
      ],
      sharedFiles: 'None'
    },
    acceptanceEvidence: [
      { fact: 'Fact 1: Magic byte validator inspects file headers', command: 'node -e "assert(fs.existsSync(\'server/upload/signatureValidator.ts\'))"', expectedOutcome: 'Validator inspects initial file bytes against known signatures', status: 'pending', evidencePath: 'automation/runs/stage-16/signature-audit.json' },
      { fact: 'Fact 2: Upload bounds enforce 25 MiB and 50 page caps', command: 'node --test tests/stage16Upload.test.mjs', expectedOutcome: 'Files exceeding 25 MiB or 50 pages rejected with 413 Payload Too Large', status: 'pending', evidencePath: 'automation/runs/stage-16/bounds-audit.json' },
      { fact: 'Fact 3: Active content scanner rejects executable PDF streams', command: 'node --test tests/stage16Upload.test.mjs', expectedOutcome: 'PDFs containing /JavaScript rejected or disarmed', status: 'pending', evidencePath: 'automation/runs/stage-16/sanitizer-audit.json' },
      { fact: 'Fact 4: Untrusted upload test suite passes all security vectors', command: 'node --test tests/stage16Upload.test.mjs', expectedOutcome: 'All malicious and polyglot test cases rejected safely', status: 'pending', evidencePath: 'automation/runs/stage-16/test-summary.json' }
    ],
    tests: {
      negative: [
        'HTML or executable file disguised with .pdf extension rejected by magic byte check.',
        'PDF with /JavaScript action rejected with explicit active_content error code.',
        'Encrypted PDF with missing password rejected with password_required code.'
      ],
      boundary: [
        'Exactly 50 pages accepted; 51 pages rejected with page_limit_exceeded.',
        'Zero-byte file rejected with empty_file error.'
      ],
      interruption: [
        'Client aborting connection during 10 MiB upload cleanly frees upload stream.',
        'Malformed PDF header does not hang stream parser.'
      ],
      security: [
        'Polyglot PDF/ZIP or PDF/HTML files detected and rejected.',
        'Temporary file paths generated with cryptographically random names.'
      ]
    },
    dependencies: {
      upstream: [
        'Stage 14 (Authentication and authorization): Authenticates uploader before processing.',
        'Stage 15 (Private original storage): Validated files are transferred to private storage.'
      ],
      downstream: [
        'Stage 17 (Page-level native extraction/routing): Routes clean validated pages.',
        'Stage 20 (Integrated vertical slice): Uses upload validator in end-to-end flow.'
      ]
    },
    externalGates: {
      blocker: 'None',
      harness: 'Automated test suite using synthetic malicious PDF test fixtures',
      signoff: 'None'
    },
    risksAndDefects: {
      risks: [
        'Risk 1: False positives on legitimate banking PDFs containing benign form annotations.'
      ],
      defects: [
        'Known defect 1: `server.ts:378` performs zero validation on incoming payload type.'
      ]
    },
    completionDraft: {
      s0: 'Audit upload endpoints and file handling vulnerabilities.',
      s1: 'Draft signature validator and active content scanner design.',
      s2: 'Author `signatureValidator.ts`, `boundsEnforcer.ts`, `pdfSanitizer.ts`, and tests.',
      s3: 'Execute upload security tests via `npm test`.',
      s4: 'Independent review audits active content stripping and polyglot handling.',
      s5: 'Tune page count parsing performance.',
      s6: 'Stage-exit checklist verification.',
      s7: 'Record promotion evidence.',
      s8: 'Advance to Stage 17.'
    }
  },

  17: {
    weightArea: 'real-ingestion-ocr',
    externalGates: [],
    verifiedState: [
      '- `PROJECT_CHARTER.md:93-94`: Preserve page order, inspect usable native text versus OCR needs, handle digital/scanned/mixed/rotated/blank pages.',
      '- Native extraction absent: Application currently feeds raw simulated text to matcher without parsing real PDF page streams.',
      '- Blank page handling: No density check exists to detect blank pages or scan artifacts.',
      '- Orientation detection: No rotation detection logic (0°, 90°, 180°, 270°) exists.'
    ],
    scope: {
      inScope: [
        'Page-level text extraction using native PDF parser (pdf-parse / pypdf / PyMuPDF).',
        'Classification of each page: digital (usable text layer), scanned (requires OCR), or mixed.',
        'Blank page detection based on text density and white pixel threshold.',
        'Page orientation normalization detecting and correcting rotated pages.'
      ],
      outOfScope: [
        'Complex multi-column table segmentation (Stage 18).',
        'Handwritten cursive recognition.'
      ],
      notPromised: [
        '100% accurate OCR text from pages with severe water damage or illegible scans.'
      ]
    },
    workBreakdown: [
      {
        task: 'Task 1: PDF Native Page Text Extractor',
        description: 'Extract raw text, word coordinates, and character counts per page in sequential order.',
        ownedPaths: 'server/ocr/pageExtractor.ts',
        fact: 'Fact 1: Native extractor preserves page order and extracts text'
      },
      {
        task: 'Task 2: Page Type Classifier (Digital vs Scanned vs Blank)',
        description: 'Classify pages by text layer completeness to determine if OCR rasterization is required.',
        ownedPaths: 'server/ocr/pageClassifier.ts',
        fact: 'Fact 2: Classifier categorizes digital, scanned, and blank pages'
      },
      {
        task: 'Task 3: Page Rotation Detection and Deskewing Utility',
        description: 'Inspect page rotation metadata and text orientation; normalize to upright 0°.',
        ownedPaths: 'server/ocr/orientationNormalizer.ts',
        fact: 'Fact 3: Orientation normalizer handles rotated pages'
      },
      {
        task: 'Task 4: Page Routing and Extraction Test Suite',
        description: 'Author automated tests across digital, scanned, mixed, rotated, and blank PDF test fixtures.',
        ownedPaths: 'tests/stage17PageRouting.test.mjs',
        fact: 'Fact 4: Page routing test suite passes all document layouts'
      }
    ],
    contractsToFreeze: `export type PageKind = 'digital' | 'scanned' | 'mixed' | 'blank';

export interface PageExtractionResult {
  pageIndex: number;
  pageKind: PageKind;
  rotationDegrees: 0 | 90 | 180 | 270;
  rawText: string;
  charCount: number;
  requiresOcr: boolean;
  wordBoxes?: Array<{ text: string; bbox: [number, number, number, number] }>;
}`,
    fanOut: {
      archetype: 'Archetype C (Page Extraction and Routing)',
      lanes: [
        { lane: 'Lane 1', role: 'impl-lane', mode: 'CODE', ownedPaths: 'server/ocr/pageExtractor.ts,server/ocr/pageClassifier.ts', deliverable: 'Page text extractor and classifier' },
        { lane: 'Lane 2', role: 'impl-lane', mode: 'CODE', ownedPaths: 'server/ocr/orientationNormalizer.ts', deliverable: 'Orientation and rotation normalizer' },
        { lane: 'Lane 3', role: 'test-author', mode: 'CODE', ownedPaths: 'tests/stage17PageRouting.test.mjs', deliverable: 'Page routing test suite' }
      ],
      sharedFiles: 'None'
    },
    acceptanceEvidence: [
      { fact: 'Fact 1: Native extractor preserves page order and extracts text', command: 'node -e "assert(fs.existsSync(\'server/ocr/pageExtractor.ts\'))"', expectedOutcome: 'Page extractor outputs ordered array of page records', status: 'pending', evidencePath: 'automation/runs/stage-17/extractor-audit.json' },
      { fact: 'Fact 2: Classifier categorizes digital, scanned, and blank pages', command: 'node --test tests/stage17PageRouting.test.mjs', expectedOutcome: 'Pages classified correctly without false blank positives', status: 'pending', evidencePath: 'automation/runs/stage-17/classifier-audit.json' },
      { fact: 'Fact 3: Orientation normalizer handles rotated pages', command: 'node --test tests/stage17PageRouting.test.mjs', expectedOutcome: 'Rotated pages (90/180/270) normalized to 0 degrees', status: 'pending', evidencePath: 'automation/runs/stage-17/rotation-audit.json' },
      { fact: 'Fact 4: Page routing test suite passes all document layouts', command: 'node --test tests/stage17PageRouting.test.mjs', expectedOutcome: 'All page extraction tests exit 0', status: 'pending', evidencePath: 'automation/runs/stage-17/test-summary.json' }
    ],
    tests: {
      negative: [
        'Corrupt page stream in multi-page PDF throws typed PageExtractionError identifying page index.',
        'Page with zero text layer and unreadable raster tagged as failed_scan.'
      ],
      boundary: [
        'Page with exactly 1 character classified as non-blank.',
        '50-page document processes sequentially without page skipping.'
      ],
      interruption: [
        'Processing timeout on complex vector graphics page terminates page parse cleanly.',
        'Memory usage remains stable (<200MB) across 50 pages.'
      ],
      security: [
        'PDF parser runs with sandboxed font rendering.',
        'Extracted text strings sanitized against control character exploits.'
      ]
    },
    dependencies: {
      upstream: [
        'Stage 11 (Versioned result contracts): Adopts page-level contract schema.',
        'Stage 16 (Untrusted upload handling): Receives sanitized PDFs.'
      ],
      downstream: [
        'Stage 18 (Real qualified OCR): Scanned pages routed to Python OCR worker.',
        'Stage 20 (Integrated vertical slice): Coordinates page routing in vertical pipeline.'
      ]
    },
    externalGates: {
      blocker: 'None',
      harness: 'Automated test suite using synthetic multi-page PDF fixtures',
      signoff: 'None'
    },
    risksAndDefects: {
      risks: [
        'Risk 1: Hidden or misleading text layers in PDFs (e.g. poor previous OCR) masking scan quality.'
      ],
      defects: [
        'Known defect 1: Current system has no mechanism to determine whether a PDF has a usable text layer.'
      ]
    },
    completionDraft: {
      s0: 'Audit native PDF parsing libraries and sample page outputs.',
      s1: 'Draft page classification heuristics and orientation contract.',
      s2: 'Author `pageExtractor.ts`, `pageClassifier.ts`, and test fixtures.',
      s3: 'Execute page routing test suite via `npm test`.',
      s4: 'Independent review checks page order preservation and classification accuracy.',
      s5: 'Tune blank page density threshold.',
      s6: 'Stage-exit checklist verification.',
      s7: 'Record promotion evidence.',
      s8: 'Advance to Stage 18.'
    }
  },

  18: {
    weightArea: 'real-ingestion-ocr',
    externalGates: [],
    verifiedState: [
      '- `PROJECT_CHARTER.md:96-97`: Select one engine by measured examples, licensing, compatibility, and resource use. Real pixels yield traceable output.',
      '- `scripts/ocr_spark_engine.py`: Prototype script exists, but lacks formal integration with Express server or versioned IPC protocol.',
      '- `server/services/multipassOcr.ts:20-50`: Cloud OCR engines are simulated stubs.',
      '- Engine qualification: Need measured qualification of primary local OCR engine (Tesseract 5 / EasyOCR / PaddleOCR) on banking layouts.'
    ],
    scope: {
      inScope: [
        'Qualification and integration of primary local OCR worker (Tesseract 5 native / Python subprocess).',
        'Structured IPC protocol between Express server and Python worker over stdin/stdout JSON lines.',
        'Generation of character-level or word-level bounding box coordinates and confidence scores.',
        'Resource bounding: worker timeout (60s), max memory (1GB), and graceful fallback on crash.'
      ],
      outOfScope: [
        'Cloud OCR provider production accounts (Google Cloud Document AI / AWS Textract).',
        'Distributed Celery / Redis worker clusters.'
      ],
      notPromised: [
        'Sub-second OCR extraction on low-end single-core CPUs.'
      ]
    },
    workBreakdown: [
      {
        task: 'Task 1: Python OCR Worker Script Modernization',
        description: 'Refactor scripts/ocr_spark_engine.py into production worker reading JSON commands and emitting structured OCR output.',
        ownedPaths: 'scripts/ocr_worker.py',
        fact: 'Fact 1: Python OCR worker script executes structured extraction'
      },
      {
        task: 'Task 2: Node.js Worker Process Supervisor',
        description: 'Implement child_process supervisor managing worker lifecycle, timeouts, and JSON IPC.',
        ownedPaths: 'server/ocr/workerSupervisor.ts',
        fact: 'Fact 2: Worker supervisor bounds execution and restarts on crash'
      },
      {
        task: 'Task 3: Real Pixel OCR Qualification Benchmark',
        description: 'Benchmark selected OCR engine on representative banking document snippets and record accuracy/speed.',
        ownedPaths: 'docs/stage18/ocr-qualification.md',
        fact: 'Fact 3: Engine qualification benchmark completed'
      },
      {
        task: 'Task 4: Worker IPC and Extraction Test Suite',
        description: 'Author automated integration test sending raster image to worker and verifying extracted words and bounding boxes.',
        ownedPaths: 'tests/stage18OcrWorker.test.mjs',
        fact: 'Fact 4: Real OCR worker test passes on test image'
      }
    ],
    contractsToFreeze: `export interface OcrWorkerRequest {
  jobId: string;
  imagePath: string;
  pageIndex: number;
  engine: 'tesseract';
  timeoutMs: number;
}

export interface OcrWorkerResponse {
  jobId: string;
  pageIndex: number;
  fullText: string;
  words: Array<{
    text: string;
    confidence: number;
    bbox: [number, number, number, number]; // [x0, y0, x1, y1]
  }>;
  durationMs: number;
  engineVersion: string;
}`,
    fanOut: {
      archetype: 'Archetype C (Native Worker and IPC Subprocess)',
      lanes: [
        { lane: 'Lane 1', role: 'impl-lane', mode: 'CODE', ownedPaths: 'scripts/ocr_worker.py,docs/stage18/**', deliverable: 'Python OCR worker and qualification report' },
        { lane: 'Lane 2', role: 'impl-lane', mode: 'CODE', ownedPaths: 'server/ocr/workerSupervisor.ts', deliverable: 'Process supervisor and JSON IPC manager' },
        { lane: 'Lane 3', role: 'test-author', mode: 'CODE', ownedPaths: 'tests/stage18OcrWorker.test.mjs', deliverable: 'Worker subprocess integration test suite' }
      ],
      sharedFiles: 'None'
    },
    acceptanceEvidence: [
      { fact: 'Fact 1: Python OCR worker script executes structured extraction', command: 'node -e "assert(fs.existsSync(\'scripts/ocr_worker.py\'))"', expectedOutcome: 'Worker script conforms to JSON IPC protocol', status: 'pending', evidencePath: 'automation/runs/stage-18/worker-audit.json' },
      { fact: 'Fact 2: Worker supervisor bounds execution and restarts on crash', command: 'node --test tests/stage18OcrWorker.test.mjs', expectedOutcome: 'Process timeout (60s) and crash recovery verified', status: 'pending', evidencePath: 'automation/runs/stage-18/supervisor-audit.json' },
      { fact: 'Fact 3: Engine qualification benchmark completed', command: 'node -e "assert(fs.existsSync(\'docs/stage18/ocr-qualification.md\'))"', expectedOutcome: 'Benchmark documents speed, memory, and word accuracy', status: 'pending', evidencePath: 'automation/runs/stage-18/qualification-audit.json' },
      { fact: 'Fact 4: Real OCR worker test passes on test image', command: 'node --test tests/stage18OcrWorker.test.mjs', expectedOutcome: 'Test image yields real extracted words with bounding boxes', status: 'pending', evidencePath: 'automation/runs/stage-18/test-summary.json' }
    ],
    tests: {
      negative: [
        'Worker crash (SIGSEGV/SIGKILL) caught by supervisor and converted to structured JobFailedError.',
        'Invalid image path returns explicit file_not_found error code.'
      ],
      boundary: [
        'Worker timeout boundary (60,000ms) terminates worker process cleanly.',
        'Large image (4000x3000px) processes within configured memory ceiling (1GB).'
      ],
      interruption: [
        'Supervisor restarts worker automatically after unhandled exception.',
        'Worker handles SIGTERM and shuts down cleanly without zombie process.'
      ],
      security: [
        'Image paths passed to worker sanitized to prevent command injection in shell arguments.',
        'Worker runs in unprivileged sandbox without outbound network access.'
      ]
    },
    dependencies: {
      upstream: [
        'Stage 5 (Reproducible dependencies): Pins Tesseract and Python packages.',
        'Stage 17 (Page-level native extraction/routing): Routes rasterized pages to this worker.'
      ],
      downstream: [
        'Stage 19 (Durable job transitions): Executes OCR jobs through stateful queue.',
        'Stage 20 (Integrated vertical slice): Integrates real OCR worker in vertical slice.',
        'Stage 31 (Evidence-driven extra passes): Evaluates secondary OCR passes.'
      ]
    },
    externalGates: {
      blocker: 'None',
      harness: 'Automated test suite using local synthetic PNG image fixtures with known text',
      signoff: 'None'
    },
    risksAndDefects: {
      risks: [
        'Risk 1: Host system missing native Tesseract binary or OCR language models.'
      ],
      defects: [
        'Known defect 1: `scripts/ocr_spark_engine.py` prints unstructured text to console without bounding boxes.'
      ]
    },
    completionDraft: {
      s0: 'Audit Python OCR scripts and verify local Tesseract binary.',
      s1: 'Draft JSON IPC protocol and worker supervisor architecture.',
      s2: 'Author `ocr_worker.py`, `workerSupervisor.ts`, and test suite.',
      s3: 'Execute worker integration tests via `npm test`.',
      s4: 'Independent review verifies bounding box accuracy and process bounding.',
      s5: 'Tune worker timeouts and memory limits.',
      s6: 'Stage-exit checklist verification.',
      s7: 'Record promotion evidence.',
      s8: 'Advance to Stage 19.'
    }
  },

  19: {
    weightArea: 'persistence-recovery',
    externalGates: [],
    verifiedState: [
      '- `PROJECT_CHARTER.md:99-100`: Implement state table, atomic claims/leases, attempts, retry ownership, and authoritative commit rules.',
      '- `server/queue/eventBus.ts:6`: Uses in-memory EventEmitter as job queue in direct contradiction to charter architecture invariant 5.',
      '- Racing workers vulnerability: Multiple workers or concurrent requests can claim the same job simultaneously.',
      '- Expired leases: No mechanism exists to reclaim jobs whose worker crashed mid-processing.'
    ],
    scope: {
      inScope: [
        'Durable job queue state table in SQLite (pending, claimed, processing, completed, failed, cancelled).',
        'Atomic worker job lease acquisition using `UPDATE ... WHERE status = "pending" LIMIT 1` transaction.',
        'Lease expiration watchdog reclaiming abandoned jobs after configurable timeout (e.g. 300s).',
        'Attempt tracking and retry budget enforcement (max 3 attempts before moving to failed).'
      ],
      outOfScope: [
        'Distributed message brokers (Kafka/RabbitMQ) (forbidden by single-host charter architecture).',
        'Complex DAG job workflows across heterogeneous clusters.'
      ],
      notPromised: [
        'Sub-millisecond job claiming latency.'
      ]
    },
    workBreakdown: [
      {
        task: 'Task 1: Durable Job Queue Engine Implementation',
        description: 'Implement SQLite-backed queue with atomic claim, release, and heartbeat mechanisms.',
        ownedPaths: 'server/queue/durableQueue.ts',
        fact: 'Fact 1: Durable queue handles atomic claims and leases'
      },
      {
        task: 'Task 2: Lease Watchdog and Abandonment Reclaimer',
        description: 'Implement background watchdog reclaiming expired leases from dead workers.',
        ownedPaths: 'server/queue/leaseWatchdog.ts',
        fact: 'Fact 2: Lease watchdog reclaims timed-out jobs'
      },
      {
        task: 'Task 3: Replace In-Memory EventBus with Durable Queue',
        description: 'Deprecate EventEmitter queue in server/queue/eventBus.ts and redirect to durable queue.',
        ownedPaths: 'server/queue/eventBus.ts',
        fact: 'Fact 3: In-memory EventEmitter replaced by durable queue'
      },
      {
        task: 'Task 4: Racing Worker and Lease Transition Test Suite',
        description: 'Author tests for concurrent worker lease races, timeout reclamation, and retry limits.',
        ownedPaths: 'tests/stage19DurableQueue.test.mjs',
        fact: 'Fact 4: Racing worker and lease transition tests pass'
      }
    ],
    contractsToFreeze: `export interface JobClaim {
  jobId: string;
  workerId: string;
  leaseExpiresAt: string;
  attemptNumber: number;
}

export interface JobTransitionResult {
  jobId: string;
  fromStatus: string;
  toStatus: string;
  success: boolean;
  error?: string;
}`,
    fanOut: {
      archetype: 'Archetype C (Durable Queue and State Machine)',
      lanes: [
        { lane: 'Lane 1', role: 'impl-lane', mode: 'CODE', ownedPaths: 'server/queue/durableQueue.ts,server/queue/leaseWatchdog.ts', deliverable: 'Durable queue engine and lease watchdog' },
        { lane: 'Lane 2', role: 'impl-lane', mode: 'CODE', ownedPaths: 'server/queue/eventBus.ts', deliverable: 'EventBus deprecation and adapter' },
        { lane: 'Lane 3', role: 'test-author', mode: 'CODE', ownedPaths: 'tests/stage19DurableQueue.test.mjs', deliverable: 'Durable queue concurrency test suite' }
      ],
      sharedFiles: 'None'
    },
    acceptanceEvidence: [
      { fact: 'Fact 1: Durable queue handles atomic claims and leases', command: 'node -e "assert(fs.existsSync(\'server/queue/durableQueue.ts\'))"', expectedOutcome: 'Queue implements atomic claim using SQLite transaction', status: 'pending', evidencePath: 'automation/runs/stage-19/queue-audit.json' },
      { fact: 'Fact 2: Lease watchdog reclaims timed-out jobs', command: 'node --test tests/stage19DurableQueue.test.mjs', expectedOutcome: 'Expired lease reclaimed and re-queued for processing', status: 'pending', evidencePath: 'automation/runs/stage-19/watchdog-audit.json' },
      { fact: 'Fact 3: In-memory EventEmitter replaced by durable queue', command: 'node -e "assert(!fs.readFileSync(\'server/queue/eventBus.ts\', \'utf8\').includes(\'new EventEmitter\'))"', expectedOutcome: 'EventEmitter completely removed from durable queue path', status: 'pending', evidencePath: 'automation/runs/stage-19/eventbus-audit.json' },
      { fact: 'Fact 4: Racing worker and lease transition tests pass', command: 'node --test tests/stage19DurableQueue.test.mjs', expectedOutcome: 'All racing worker and transition tests exit 0', status: 'pending', evidencePath: 'automation/runs/stage-19/test-summary.json' }
    ],
    tests: {
      negative: [
        'Worker attempting to claim already-claimed job receives null/false.',
        'Worker committing result with expired lease rejected with LeaseExpiredError.'
      ],
      boundary: [
        'Job exceeding max retries (3) marked permanently as failed with poison-pill error.',
        '100 parallel workers competing for 10 jobs results in exactly 10 claims and 0 duplicates.'
      ],
      interruption: [
        'Server restart mid-job leaves job claimed until lease expires, then watchdog reclaims.',
        'Database lock during heartbeat handles retry gracefully.'
      ],
      security: [
        'Worker claims validated against worker authentication token.',
        'Job parameters sanitized before storing in queue table.'
      ]
    },
    dependencies: {
      upstream: [
        'Stage 3 (Architecture and failure model): Formalized failure state machine.',
        'Stage 12 (Transactional application storage): Provides jobs and attempts tables.',
        'Stage 18 (Real qualified OCR): OCR worker executed by queue processor.'
      ],
      downstream: [
        'Stage 20 (Integrated vertical slice): Integrates durable queue in end-to-end slice.',
        'Stage 22 (Genuine progress/error streaming): Streams job queue transitions to UI.',
        'Stage 24 (Bounded retries/deadlines/cancellation): Enforces backoff on queue retries.'
      ]
    },
    externalGates: {
      blocker: 'None',
      harness: 'Automated test suite using multiple concurrent workers in worker threads',
      signoff: 'None'
    },
    risksAndDefects: {
      risks: [
        'Risk 1: Worker crash leaving job locked indefinitely if lease timeout is too long.'
      ],
      defects: [
        'Known defect 1: `server/queue/eventBus.ts:6` uses Node.js EventEmitter which drops jobs on crash.'
      ]
    },
    completionDraft: {
      s0: 'Audit eventBus.ts and job transition requirements.',
      s1: 'Draft durable queue schema and lease acquisition algorithm.',
      s2: 'Author `durableQueue.ts`, `leaseWatchdog.ts`, refactor `eventBus.ts`, and write tests.',
      s3: 'Execute durable queue test suite via `npm test`.',
      s4: 'Independent review verifies atomic lease guarantees and racing safety.',
      s5: 'Tune lease timeouts and watchdog poll intervals.',
      s6: 'Stage-exit checklist verification.',
      s7: 'Record promotion evidence.',
      s8: 'Advance to Stage 20.'
    }
  }
};

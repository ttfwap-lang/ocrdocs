/**
 * Stage specifications for Group 2: Vertical Slice, Workflow & User Interface (Stages 20–37)
 */
export const group2Specs = {
  20: {
    weightArea: 'interface-workflow',
    externalGates: [],
    verifiedState: [
      '- `PROJECT_CHARTER.md:102-103`: Connect upload/storage/jobs/parsing/OCR/matching/validation/persistence/UI using actual bytes/text and consistent document version, not fixtures.',
      '- Existing UI views (`MatcherStudio`, `AuditAndEngineView`): Render from static mock arrays in `src/data/*.ts`.',
      '- Vertical slice integration absent: The upload flow does not yet pipe real uploaded bytes through private storage, durable job creation, Python OCR extraction, TS field matching, SQLite persistence, and UI display.',
      '- Unfamiliar document testing: Needs verification on real unseen PDF/image files.'
    ],
    scope: {
      inScope: [
        'End-to-end integration: File upload -> storage -> job queue -> Python OCR -> TS matcher -> SQLite -> REST API -> React UI.',
        'Elimination of static fixture substitution across the primary document processing pipeline.',
        'Validation of vertical slice across all supported initial document formats (digital PDF, scanned PDF, mixed PDF, PNG, JPEG).',
        'End-to-end integration test asserting real text extraction and database record creation from actual bytes.'
      ],
      outOfScope: [
        'Google Drive cloud import integration (Stages 29–30).',
        'Multi-reviewer collaborative workflows (Stage 27).'
      ],
      notPromised: [
        'Instantaneous extraction for 50-page complex scanned portfolios.'
      ]
    },
    workBreakdown: [
      {
        task: 'Task 1: End-to-End Ingestion Pipeline Controller',
        description: 'Wire upload handler to create document record, write private storage, and enqueue durable OCR job.',
        ownedPaths: 'server/controllers/ingestionController.ts',
        fact: 'Fact 1: Ingestion controller orchestrates upload, storage, and job queue'
      },
      {
        task: 'Task 2: Worker-to-Matcher Pipeline Integration',
        description: 'Connect OCR worker word/text stream into TypeScript OCR matcher engine to extract 99 bank fields.',
        ownedPaths: 'server/services/extractionPipeline.ts',
        fact: 'Fact 2: Extraction pipeline binds OCR output to bank field matcher'
      },
      {
        task: 'Task 3: React UI Real Ingestion Hook and Poller',
        description: 'Update React UI to upload real document and poll job endpoint for real extraction results.',
        ownedPaths: 'src/hooks/useDocumentProcessing.ts',
        fact: 'Fact 3: UI hook initiates real document processing and consumes results'
      },
      {
        task: 'Task 4: Integrated Vertical Slice E2E Test Suite',
        description: 'Author end-to-end test executing full upload-to-result pipeline on unfamiliar sample PDFs.',
        ownedPaths: 'tests/stage20VerticalSlice.test.mjs',
        fact: 'Fact 4: Vertical slice test passes on real bytes across supported formats'
      }
    ],
    contractsToFreeze: `export interface VerticalSliceExecution {
  documentId: string;
  jobId: string;
  sourceFormat: 'pdf_digital' | 'pdf_scanned' | 'image_png' | 'image_jpeg';
  byteSize: number;
  extractedFieldCount: number;
  status: 'completed';
  executionTimeMs: number;
}`,
    fanOut: {
      archetype: 'Archetype A (Full Vertical Slice Fan-Out)',
      lanes: [
        { lane: 'Lane 1', role: 'impl-lane', mode: 'CODE', ownedPaths: 'server/controllers/ingestionController.ts,server/services/extractionPipeline.ts', deliverable: 'Backend ingestion and extraction pipeline' },
        { lane: 'Lane 2', role: 'impl-lane', mode: 'CODE', ownedPaths: 'src/hooks/useDocumentProcessing.ts', deliverable: 'Frontend real processing hook' },
        { lane: 'Lane 3', role: 'test-author', mode: 'CODE', ownedPaths: 'tests/stage20VerticalSlice.test.mjs', deliverable: 'End-to-end integration test suite' }
      ],
      sharedFiles: 'server.ts'
    },
    acceptanceEvidence: [
      { fact: 'Fact 1: Ingestion controller orchestrates upload, storage, and job queue', command: 'node -e "assert(fs.existsSync(\'server/controllers/ingestionController.ts\'))"', expectedOutcome: 'Controller links upload to private storage and job queue', status: 'pending', evidencePath: 'automation/runs/stage-20/controller-audit.json' },
      { fact: 'Fact 2: Extraction pipeline binds OCR output to bank field matcher', command: 'node -e "assert(fs.existsSync(\'server/services/extractionPipeline.ts\'))"', expectedOutcome: 'Pipeline executes OCR worker and extracts bank fields', status: 'pending', evidencePath: 'automation/runs/stage-20/pipeline-audit.json' },
      { fact: 'Fact 3: UI hook initiates real document processing and consumes results', command: 'node -e "assert(fs.existsSync(\'src/hooks/useDocumentProcessing.ts\'))"', expectedOutcome: 'Frontend hook interfaces with real backend endpoints', status: 'pending', evidencePath: 'automation/runs/stage-20/hook-audit.json' },
      { fact: 'Fact 4: Vertical slice test passes on real bytes across supported formats', command: 'node --test tests/stage20VerticalSlice.test.mjs', expectedOutcome: 'All end-to-end vertical slice tests pass', status: 'pending', evidencePath: 'automation/runs/stage-20/test-summary.json' }
    ],
    tests: {
      negative: [
        'Malformed PDF payload in upload triggers structured error without creating orphaned database rows.',
        'OCR worker timeout causes job to fail gracefully and update status to failed.'
      ],
      boundary: [
        'Processing 1-page document completes end-to-end in under 3s.',
        'Document with 0 extractable bank fields yields empty results array without crashing UI.'
      ],
      interruption: [
        'Restarting server while job is pending results in job pickup on restart.',
        'Client disconnect during upload cancels processing.'
      ],
      security: [
        'End-to-end flow enforces user authentication and document ownership.',
        'No unredacted PII emitted in server console logs during processing.'
      ]
    },
    dependencies: {
      upstream: [
        'Stage 2 (Document/workflow matrix): Supported formats and layout limits.',
        'Stage 4 (Truthful demonstration/live separation): Ensures live pipeline uses zero mock fixtures.',
        'Stage 6 (Build and startup corrections): Clean server environment.',
        'Stage 10 (Correct extraction defects): Accurate field matcher engine.',
        'Stage 13 (Persistence invariants): Transactional database.',
        'Stage 15 (Private original storage): Secure file storage.',
        'Stage 16 (Untrusted upload handling): Sanitized file input.',
        'Stage 17 (Page-level native extraction/routing): Page extraction.',
        'Stage 18 (Real qualified OCR): Python OCR engine.',
        'Stage 19 (Durable job transitions): Job queue engine.'
      ],
      downstream: [
        'Stage 21 (Immutable extraction evidence): Attaches evidence coordinates to results.',
        'Stage 22 (Genuine progress/error streaming): Streams live progress events to UI.',
        'Stage 26 (Real document/result interface): Displays persisted documents in UI.'
      ]
    },
    externalGates: {
      blocker: 'None',
      harness: 'Automated integration test using real sample PDF/PNG binaries in tests/fixtures',
      signoff: 'None'
    },
    risksAndDefects: {
      risks: [
        'Risk 1: Cross-platform Python execution latency impacting end-to-end test runtimes.'
      ],
      defects: [
        'Known defect 1: UI views currently read from static data/ files rather than querying backend.'
      ]
    },
    completionDraft: {
      s0: 'Audit integration points between storage, queue, OCR, and frontend.',
      s1: 'Draft vertical slice architecture and pipeline controller design.',
      s2: 'Author `ingestionController.ts`, `extractionPipeline.ts`, `useDocumentProcessing.ts`, and tests.',
      s3: 'Execute vertical slice test suite via `npm test`.',
      s4: 'Independent review audits real byte handling and absence of mock data.',
      s5: 'Refine error handling and poller timing.',
      s6: 'Stage-exit checklist verification.',
      s7: 'Record promotion evidence.',
      s8: 'Advance to Stage 21.'
    }
  },

  21: {
    weightArea: 'extraction-validation',
    externalGates: [],
    verifiedState: [
      '- `PROJECT_CHARTER.md:105-106`: Persist attempt evidence, page/text/coordinates where available, model/matcher versions, candidates, and selection reasons. Every displayed field is traceable.',
      '- Existing UI in `MatcherStudio.tsx`: Displays field match badges, but coordinates and candidate provenance are hardcoded or simulated.',
      '- Database candidate storage: Relational schema in Stage 12 includes candidate tables, but ingestion pipeline does not yet write candidate alternatives.',
      '- Immutable evidence: No audit log records the exact regex rule ID or OCR model version that matched each field.'
    ],
    scope: {
      inScope: [
        'Persisting candidate matches with bounding box coordinates `[x0, y0, x1, y1]`, confidence score, and page index.',
        'Recording match provenance: regex pattern ID, matcher rule version, and OCR engine version.',
        'Immutability enforcement: candidate evidence rows are write-once and cannot be modified or rewritten.',
        'API endpoint `GET /api/documents/:id/fields/:fieldId/evidence` returning complete provenance trail.'
      ],
      outOfScope: [
        'Interactive PDF highlight overlay annotations in browser (Stage 26).',
        'Human correction override audit log (Stage 27).'
      ],
      notPromised: [
        'Pixel-perfect bounding boxes for skewed or distorted photocopies.'
      ]
    },
    workBreakdown: [
      {
        task: 'Task 1: Candidate Evidence Persistence Service',
        description: 'Implement database persistence for all candidate matches, bounding boxes, and selection reasons.',
        ownedPaths: 'server/services/evidenceService.ts',
        fact: 'Fact 1: Evidence service stores candidate coordinates and reasons'
      },
      {
        task: 'Task 2: Evidence Provenance Metadata Model',
        description: 'Bind OCR model version, matcher dictionary version, and rule IDs to each extracted candidate.',
        ownedPaths: 'src/contracts/evidenceContract.ts',
        fact: 'Fact 2: Evidence contract captures engine and rule provenance'
      },
      {
        task: 'Task 3: Field Evidence Query API Endpoint',
        description: 'Implement route returning candidate alternatives, bounding boxes, and extraction provenance.',
        ownedPaths: 'server/routes/evidenceRoutes.ts',
        fact: 'Fact 3: Evidence API returns immutable candidate trace'
      },
      {
        task: 'Task 4: Evidence Immutability Test Suite',
        description: 'Author automated tests verifying that evidence records are immutable and trace back to source text.',
        ownedPaths: 'tests/stage21Evidence.test.mjs',
        fact: 'Fact 4: Evidence immutability and provenance tests pass'
      }
    ],
    contractsToFreeze: `export interface FieldCandidateEvidence {
  candidateId: string;
  fieldId: string;
  rawValue: string;
  pageIndex: number;
  bbox?: [number, number, number, number];
  confidence: number;
  matcherRuleId: string;
  ocrEngineVersion: string;
  isSelected: boolean;
  selectionReason: string;
  recordedAt: string;
}`,
    fanOut: {
      archetype: 'Archetype B (Evidence Modeling and Immutability)',
      lanes: [
        { lane: 'Lane 1', role: 'impl-lane', mode: 'CODE', ownedPaths: 'server/services/evidenceService.ts,server/routes/evidenceRoutes.ts', deliverable: 'Evidence service and REST API' },
        { lane: 'Lane 2', role: 'impl-lane', mode: 'CODE', ownedPaths: 'src/contracts/evidenceContract.ts', deliverable: 'Evidence contract schema' },
        { lane: 'Lane 3', role: 'test-author', mode: 'CODE', ownedPaths: 'tests/stage21Evidence.test.mjs', deliverable: 'Evidence immutability test suite' }
      ],
      sharedFiles: 'None'
    },
    acceptanceEvidence: [
      { fact: 'Fact 1: Evidence service stores candidate coordinates and reasons', command: 'node -e "assert(fs.existsSync(\'server/services/evidenceService.ts\'))"', expectedOutcome: 'Service stores all candidate coordinates and selection reasons', status: 'pending', evidencePath: 'automation/runs/stage-21/service-audit.json' },
      { fact: 'Fact 2: Evidence contract captures engine and rule provenance', command: 'node -e "assert(fs.existsSync(\'src/contracts/evidenceContract.ts\'))"', expectedOutcome: 'Contract defines model version, rule ID, and coordinates', status: 'pending', evidencePath: 'automation/runs/stage-21/contract-audit.json' },
      { fact: 'Fact 3: Evidence API returns immutable candidate trace', command: 'node --test tests/stage21Evidence.test.mjs', expectedOutcome: 'GET endpoint returns all candidate alternatives for field', status: 'pending', evidencePath: 'automation/runs/stage-21/api-audit.json' },
      { fact: 'Fact 4: Evidence immutability and provenance tests pass', command: 'node --test tests/stage21Evidence.test.mjs', expectedOutcome: 'Immutability test confirms evidence cannot be rewritten', status: 'pending', evidencePath: 'automation/runs/stage-21/test-summary.json' }
    ],
    tests: {
      negative: [
        'Attempting to UPDATE an existing candidate evidence row fails with SQLite trigger/table constraint.',
        'Querying evidence for non-existent document ID returns 404.'
      ],
      boundary: [
        'Field with exactly 1 candidate stores 1 candidate record.',
        'Field with 10 candidate alternatives preserves all 10 candidates with rank order.'
      ],
      interruption: [
        'Database transaction failure during evidence write rolls back entire extraction result.',
        'Re-querying evidence produces identical bit-for-bit JSON representation.'
      ],
      security: [
        'Evidence endpoints enforce document ownership authorization.',
        'Extracted candidate snippet values scrubbed of shell escape codes.'
      ]
    },
    dependencies: {
      upstream: [
        'Stage 11 (Versioned result contracts): Integrates with v1 result schemas.',
        'Stage 20 (Integrated vertical slice): Receives candidate matches from extraction pipeline.'
      ],
      downstream: [
        'Stage 27 (Controlled human review): Reviewers inspect candidate evidence when verifying.',
        'Stage 36 (Reproducible quality benchmark): Uses evidence traces for benchmark error analysis.'
      ]
    },
    externalGates: {
      blocker: 'None',
      harness: 'Automated test suite asserting SQLite candidate table constraints and query APIs',
      signoff: 'None'
    },
    risksAndDefects: {
      risks: [
        'Risk 1: Database storage growth if saving hundreds of low-confidence candidate snippets per page.'
      ],
      defects: [
        'Known defect 1: Current application discards rejected candidate matches immediately.'
      ]
    },
    completionDraft: {
      s0: 'Audit matcher engine candidate tracking capabilities.',
      s1: 'Draft candidate evidence schema and immutability rules.',
      s2: 'Author `evidenceService.ts`, `evidenceRoutes.ts`, and test suite.',
      s3: 'Execute evidence test suite via `npm test`.',
      s4: 'Independent review audits immutability and bounding box integrity.',
      s5: 'Tune candidate retention limits.',
      s6: 'Stage-exit checklist verification.',
      s7: 'Record promotion evidence.',
      s8: 'Advance to Stage 22.'
    }
  },

  22: {
    weightArea: 'interface-workflow',
    externalGates: [],
    verifiedState: [
      '- `PROJECT_CHARTER.md:108-109`: Define events/order/terminal state and reconcile fragmented/duplicate/malformed streams with durable state. No UI claims nonexistent processing or remains active after known completion.',
      '- Existing SSE endpoint in `server.ts:370-385`: `GET /api/process-document/stream/:jobId` emits static interval events without tracking actual worker progression.',
      '- Disconnect handling missing: Server does not detect client disconnects or clean up active heartbeat intervals.',
      '- Terminal state ambiguity: Stream does not guarantee terminal event delivery (`completed` or `failed`) before socket close.'
    ],
    scope: {
      inScope: [
        'Server-Sent Events (SSE) streaming protocol for job progress with guaranteed ordered events.',
        'Strict event ordering: `job_queued` -> `job_claimed` -> `page_extracted` -> `matching_fields` -> `completed` / `failed`.',
        'Heartbeat mechanism (15s interval) and connection cleanup on client disconnect.',
        'Stream reconciliation: client connecting late receives current durable state followed by live events.'
      ],
      outOfScope: [
        'Bi-directional WebSocket communication (unidirectional SSE sufficient per charter item 6).',
        'Redis Pub/Sub event broadcasting.'
      ],
      notPromised: [
        'Delivery of live event history past configured buffer window.'
      ]
    },
    workBreakdown: [
      {
        task: 'Task 1: Structured SSE Event Hub Implementation',
        description: 'Implement server SSE hub dispatching typed, ordered progress events tied to durable job state.',
        ownedPaths: 'server/events/sseHub.ts',
        fact: 'Fact 1: SSE hub manages active connections and broadcasts typed events'
      },
      {
        task: 'Task 2: Progress Streaming Route Modernization',
        description: 'Refactor GET /api/process-document/stream/:jobId to stream real queue transitions with heartbeats.',
        ownedPaths: 'server/routes/streamRoutes.ts',
        fact: 'Fact 2: Stream route emits heartbeat and cleans up on disconnect'
      },
      {
        task: 'Task 3: Client EventSource Reconnection Hook',
        description: 'Implement React hook connecting to SSE stream, buffering events, and transitioning to terminal state.',
        ownedPaths: 'src/hooks/useJobStream.ts',
        fact: 'Fact 3: Client hook processes stream and detects terminal state'
      },
      {
        task: 'Task 4: Streaming Protocol and Terminal State Test Suite',
        description: 'Author automated tests for event ordering, terminal state dispatch, and client disconnection.',
        ownedPaths: 'tests/stage22Streaming.test.mjs',
        fact: 'Fact 4: Streaming protocol test suite passes'
      }
    ],
    contractsToFreeze: `export type JobEventType = 'queued' | 'claimed' | 'page_processed' | 'matching' | 'completed' | 'failed';

export interface JobProgressEvent {
  jobId: string;
  eventType: JobEventType;
  sequenceNumber: number;
  currentPage?: number;
  totalPages?: number;
  progressPercent: number;
  message: string;
  timestamp: string;
  error?: { code: string; message: string };
}`,
    fanOut: {
      archetype: 'Archetype E (Progress Streaming and Real-Time Events)',
      lanes: [
        { lane: 'Lane 1', role: 'impl-lane', mode: 'CODE', ownedPaths: 'server/events/sseHub.ts,server/routes/streamRoutes.ts', deliverable: 'SSE hub and stream routes' },
        { lane: 'Lane 2', role: 'impl-lane', mode: 'CODE', ownedPaths: 'src/hooks/useJobStream.ts', deliverable: 'React stream consumer hook' },
        { lane: 'Lane 3', role: 'test-author', mode: 'CODE', ownedPaths: 'tests/stage22Streaming.test.mjs', deliverable: 'Streaming protocol test suite' }
      ],
      sharedFiles: 'server.ts'
    },
    acceptanceEvidence: [
      { fact: 'Fact 1: SSE hub manages active connections and broadcasts typed events', command: 'node -e "assert(fs.existsSync(\'server/events/sseHub.ts\'))"', expectedOutcome: 'Hub tracks subscribers and dispatches ordered events', status: 'pending', evidencePath: 'automation/runs/stage-22/hub-audit.json' },
      { fact: 'Fact 2: Stream route emits heartbeat and cleans up on disconnect', command: 'node --test tests/stage22Streaming.test.mjs', expectedOutcome: 'Heartbeat ping received every 15s; disconnect frees socket', status: 'pending', evidencePath: 'automation/runs/stage-22/heartbeat-audit.json' },
      { fact: 'Fact 3: Client hook processes stream and detects terminal state', command: 'node -e "assert(fs.existsSync(\'src/hooks/useJobStream.ts\'))"', expectedOutcome: 'Hook updates React state and closes connection on completed event', status: 'pending', evidencePath: 'automation/runs/stage-22/hook-audit.json' },
      { fact: 'Fact 4: Streaming protocol test suite passes', command: 'node --test tests/stage22Streaming.test.mjs', expectedOutcome: 'All streaming protocol tests exit 0', status: 'pending', evidencePath: 'automation/runs/stage-22/test-summary.json' }
    ],
    tests: {
      negative: [
        'Connecting to stream for non-existent job ID returns 404 immediately.',
        'Connecting with invalid token returns 401 Unauthorized.'
      ],
      boundary: [
        'Stream for already-completed job sends current completed event and closes cleanly.',
        '10 concurrent stream subscribers receive identical sequenced events.'
      ],
      interruption: [
        'Abrupt client disconnect closes server socket without throwing unhandled error.',
        'Worker failure immediately dispatches `failed` terminal event with error details.'
      ],
      security: [
        'SSE headers enforce `Cache-Control: no-cache` and `X-Accel-Buffering: no`.',
        'Stream messages do not leak server internal paths or credentials.'
      ]
    },
    dependencies: {
      upstream: [
        'Stage 19 (Durable job transitions): Queue transitions trigger SSE events.',
        'Stage 20 (Integrated vertical slice): Vertical slice pipeline emits progress.'
      ],
      downstream: [
        'Stage 23 (Refresh/reconnect recovery): Client re-syncs state after stream disconnect.',
        'Stage 26 (Real document/result interface): Progress bars and status badges update from stream.'
      ]
    },
    externalGates: {
      blocker: 'None',
      harness: 'Automated test suite using HTTP client consuming SSE text streams',
      signoff: 'None'
    },
    risksAndDefects: {
      risks: [
        'Risk 1: Reverse proxy buffering SSE events if response headers are misconfigured.'
      ],
      defects: [
        'Known defect 1: `server.ts:382` leaves setInterval running if client disconnects prematurely.'
      ]
    },
    completionDraft: {
      s0: 'Audit existing SSE implementation in server.ts.',
      s1: 'Draft SSE event contract and connection lifecycle specification.',
      s2: 'Author `sseHub.ts`, `streamRoutes.ts`, `useJobStream.ts`, and test suite.',
      s3: 'Execute streaming test suite via `npm test`.',
      s4: 'Independent review audits socket leak prevention and terminal event delivery.',
      s5: 'Tune heartbeat intervals.',
      s6: 'Stage-exit checklist verification.',
      s7: 'Record promotion evidence.',
      s8: 'Advance to Stage 23.'
    }
  },

  23: {
    weightArea: 'persistence-recovery',
    externalGates: [],
    verifiedState: [
      '- `PROJECT_CHARTER.md:111-112`: Load authorized persisted state and replay only when justified. Refresh/disconnect/multiple tabs do not lose results, repeat work, or allow stale events to replace terminal state.',
      '- Client state volatility: Refreshing browser while job is in-flight currently wipes UI state in React components.',
      '- Multi-tab synchronization: Opening multiple tabs for the same document currently triggers redundant polling requests.',
      '- Terminal reconciliation: If job completed while client was disconnected, reconnecting client must immediately receive terminal state.'
    ],
    scope: {
      inScope: [
        'Durable state recovery API: `GET /api/documents/:id/state` returning current authoritative progress or terminal result.',
        'Client-side session recovery: browser refresh resumes active job tracking from last sequence number.',
        'Stale event rejection: client drops incoming out-of-order or late events if terminal state has already been committed.',
        'Multi-tab coordination: BroadcastChannel / localStorage sync preventing duplicate requests across tabs.'
      ],
      outOfScope: [
        'Full collaborative multi-user editing (Stage 27).',
        'Offline client caching with Service Workers.'
      ],
      notPromised: [
        'Real-time cursor synchronization across different physical devices.'
      ]
    },
    workBreakdown: [
      {
        task: 'Task 1: Authoritative Document Recovery Endpoint',
        description: 'Implement API returning complete document lifecycle state, job status, and extracted fields.',
        ownedPaths: 'server/routes/recoveryRoutes.ts',
        fact: 'Fact 1: Recovery endpoint returns authoritative document and job status'
      },
      {
        task: 'Task 2: Client Reconnection and Tab Sync Manager',
        description: 'Implement React state manager reconciling local UI state with server recovery payload upon page mount.',
        ownedPaths: 'src/services/recoveryManager.ts',
        fact: 'Fact 2: Client recovers state upon refresh and syncs tabs'
      },
      {
        task: 'Task 3: Stale Event Guard and Terminal Lock',
        description: 'Implement client/server guard ensuring terminal states cannot be superseded by delayed transient events.',
        ownedPaths: 'src/utils/terminalGuard.ts',
        fact: 'Fact 3: Terminal state cannot be overridden by stale events'
      },
      {
        task: 'Task 4: Refresh and Disconnect Recovery Test Suite',
        description: 'Author automated tests simulating browser refresh mid-flight, reconnection, and multi-tab reads.',
        ownedPaths: 'tests/stage23Recovery.test.mjs',
        fact: 'Fact 4: Reconnect recovery test suite passes all scenarios'
      }
    ],
    contractsToFreeze: `export interface DocumentRecoveryState {
  documentId: string;
  jobId?: string;
  lifecycleStatus: 'uploading' | 'processing' | 'ready_for_review' | 'approved' | 'failed';
  lastSequenceNumber: number;
  progressPercent: number;
  resultSummary?: { fieldCount: number; approvedCount: number };
  replayedEvents: number;
}`,
    fanOut: {
      archetype: 'Archetype E (Client Recovery and State Reconciliation)',
      lanes: [
        { lane: 'Lane 1', role: 'impl-lane', mode: 'CODE', ownedPaths: 'server/routes/recoveryRoutes.ts', deliverable: 'State recovery backend route' },
        { lane: 'Lane 2', role: 'impl-lane', mode: 'CODE', ownedPaths: 'src/services/recoveryManager.ts,src/utils/terminalGuard.ts', deliverable: 'Frontend recovery and stale guard' },
        { lane: 'Lane 3', role: 'test-author', mode: 'CODE', ownedPaths: 'tests/stage23Recovery.test.mjs', deliverable: 'Recovery integration test suite' }
      ],
      sharedFiles: 'None'
    },
    acceptanceEvidence: [
      { fact: 'Fact 1: Recovery endpoint returns authoritative document and job status', command: 'node -e "assert(fs.existsSync(\'server/routes/recoveryRoutes.ts\'))"', expectedOutcome: 'Recovery endpoint returns JSON state payload', status: 'pending', evidencePath: 'automation/runs/stage-23/recovery-audit.json' },
      { fact: 'Fact 2: Client recovers state upon refresh and syncs tabs', command: 'node -e "assert(fs.existsSync(\'src/services/recoveryManager.ts\'))"', expectedOutcome: 'Recovery manager initializes from stored state', status: 'pending', evidencePath: 'automation/runs/stage-23/manager-audit.json' },
      { fact: 'Fact 3: Terminal state cannot be overridden by stale events', command: 'node --test tests/stage23Recovery.test.mjs', expectedOutcome: 'Late page_extracted event rejected after completed event', status: 'pending', evidencePath: 'automation/runs/stage-23/guard-audit.json' },
      { fact: 'Fact 4: Reconnect recovery test suite passes all scenarios', command: 'node --test tests/stage23Recovery.test.mjs', expectedOutcome: 'All recovery tests exit 0', status: 'pending', evidencePath: 'automation/runs/stage-23/test-summary.json' }
    ],
    tests: {
      negative: [
        'Attempting to apply an event with sequence number lower than current terminal state is dropped.',
        'Requesting recovery state for deleted document returns 404.'
      ],
      boundary: [
        'Reconnection after 0s (instant refresh) restores state with 0 replayed events.',
        'Reconnection after job completion returns terminal result directly without streaming.'
      ],
      interruption: [
        'Network drop during recovery request retries with exponential backoff.',
        'Tab closed and re-opened 10 minutes later restores complete persisted state.'
      ],
      security: [
        'Recovery state endpoint strictly enforces user session authorization.',
        'No sensitive token data stored in unencrypted browser storage.'
      ]
    },
    dependencies: {
      upstream: [
        'Stage 22 (Genuine progress/error streaming): Coordinates event replay with live streams.'
      ],
      downstream: [
        'Stage 24 (Bounded retries/deadlines/cancellation): Cancellation state synced across clients.',
        'Stage 25 (Combined fault sequences): Recovers client state during server chaos restarts.',
        'Stage 26 (Real document/result interface): Renders recovered state in UI.'
      ]
    },
    externalGates: {
      blocker: 'None',
      harness: 'Automated test suite simulating network disconnection and state re-fetching',
      signoff: 'None'
    },
    risksAndDefects: {
      risks: [
        'Risk 1: Race conditions between initial recovery fetch and incoming live SSE events.'
      ],
      defects: [
        'Known defect 1: Refreshing page in current UI resets upload progress and loses extracted data.'
      ]
    },
    completionDraft: {
      s0: 'Audit UI state lifecycles on page refresh.',
      s1: 'Draft recovery contract and multi-tab coordination design.',
      s2: 'Author `recoveryRoutes.ts`, `recoveryManager.ts`, `terminalGuard.ts`, and tests.',
      s3: 'Execute recovery test suite via `npm test`.',
      s4: 'Independent review audits race conditions and stale event protection.',
      s5: 'Tune polling and backoff parameters.',
      s6: 'Stage-exit checklist verification.',
      s7: 'Record promotion evidence.',
      s8: 'Advance to Stage 24.'
    }
  },

  24: {
    weightArea: 'persistence-recovery',
    externalGates: [],
    verifiedState: [
      '- `PROJECT_CHARTER.md:114-115`: Classify permanent/transient errors, define backoff, budgets, cancellation/completion races. Cancellation during parsing/OCR/commit and late attempts cannot revive cancelled work.',
      '- Unbounded retries risk: Current code has no error classifier distinguishing transient network glitches from permanent invalid formats.',
      '- Cancellation missing: Users cannot cancel an in-flight processing job from the UI.',
      '- Late attempt revival: A late worker finishing an extraction after user cancellation could overwrite cancelled state.'
    ],
    scope: {
      inScope: [
        'Error classification taxonomy: Transient (db lock, worker timeout) vs Permanent (invalid format, corrupted file).',
        'Exponential backoff with jitter for transient retries (max 3 retries, capped backoff at 30s).',
        'User cancellation endpoint `POST /api/jobs/:id/cancel` terminating worker subprocess and updating job state.',
        'Cancellation/completion race resolution: cancelled status is terminal and rejects late worker commits.'
      ],
      outOfScope: [
        'External third-party API rate limit management (Stage 33).',
        'Automatic billing charge refund on cancellation (Stage 48).'
      ],
      notPromised: [
        'Instantaneous worker termination on platforms without process group signaling.'
      ]
    },
    workBreakdown: [
      {
        task: 'Task 1: Error Classification and Backoff Engine',
        description: 'Implement classifier distinguishing transient vs permanent errors and calculating backoff delays.',
        ownedPaths: 'server/queue/errorClassifier.ts',
        fact: 'Fact 1: Error classifier differentiates transient and permanent errors'
      },
      {
        task: 'Task 2: Job Cancellation API and Worker Abort Signal',
        description: 'Implement cancellation endpoint and wire AbortController to terminate OCR worker subprocess.',
        ownedPaths: 'server/routes/cancellationRoutes.ts',
        fact: 'Fact 2: Cancellation endpoint terminates active worker process'
      },
      {
        task: 'Task 3: Late Worker Commit Rejection Guard',
        description: 'Enforce database check rejecting results submitted by workers for cancelled or superseded jobs.',
        ownedPaths: 'server/queue/commitGuard.ts',
        fact: 'Fact 3: Commit guard rejects late worker completions on cancelled jobs'
      },
      {
        task: 'Task 4: Retries, Deadlines, and Cancellation Test Suite',
        description: 'Author automated tests for retry budgets, permanent failure fast-paths, and cancellation races.',
        ownedPaths: 'tests/stage24Cancellation.test.mjs',
        fact: 'Fact 4: Cancellation and retry budget test suite passes'
      }
    ],
    contractsToFreeze: `export type ErrorClass = 'transient' | 'permanent' | 'fatal_unsupported';

export interface ClassifiedError {
  code: string;
  errorClass: ErrorClass;
  message: string;
  retryAllowed: boolean;
  backoffMs?: number;
}

export interface CancellationResult {
  jobId: string;
  cancelledAt: string;
  workerTerminated: boolean;
  previousStatus: string;
}`,
    fanOut: {
      archetype: 'Archetype F (Job Control and Fault Handling)',
      lanes: [
        { lane: 'Lane 1', role: 'impl-lane', mode: 'CODE', ownedPaths: 'server/queue/errorClassifier.ts,server/queue/commitGuard.ts', deliverable: 'Error classification and commit guard' },
        { lane: 'Lane 2', role: 'impl-lane', mode: 'CODE', ownedPaths: 'server/routes/cancellationRoutes.ts', deliverable: 'Job cancellation route and process abort' },
        { lane: 'Lane 3', role: 'test-author', mode: 'CODE', ownedPaths: 'tests/stage24Cancellation.test.mjs', deliverable: 'Cancellation and retry test suite' }
      ],
      sharedFiles: 'None'
    },
    acceptanceEvidence: [
      { fact: 'Fact 1: Error classifier differentiates transient and permanent errors', command: 'node -e "assert(fs.existsSync(\'server/queue/errorClassifier.ts\'))"', expectedOutcome: 'Classifier identifies permanent errors and skips retries', status: 'pending', evidencePath: 'automation/runs/stage-24/classifier-audit.json' },
      { fact: 'Fact 2: Cancellation endpoint terminates active worker process', command: 'node --test tests/stage24Cancellation.test.mjs', expectedOutcome: 'POST cancel sets job to cancelled and aborts subprocess', status: 'pending', evidencePath: 'automation/runs/stage-24/cancel-audit.json' },
      { fact: 'Fact 3: Commit guard rejects late worker completions on cancelled jobs', command: 'node --test tests/stage24Cancellation.test.mjs', expectedOutcome: 'Late commit to cancelled job rejected with 409 Conflict', status: 'pending', evidencePath: 'automation/runs/stage-24/guard-audit.json' },
      { fact: 'Fact 4: Cancellation and retry budget test suite passes', command: 'node --test tests/stage24Cancellation.test.mjs', expectedOutcome: 'All cancellation and retry tests exit 0', status: 'pending', evidencePath: 'automation/runs/stage-24/test-summary.json' }
    ],
    tests: {
      negative: [
        'Corrupted PDF classified as permanent; retrying is blocked immediately.',
        'Late worker attempting commit on cancelled job receives JobCancelledError.'
      ],
      boundary: [
        'Retry count stops at exactly 3 attempts; 4th attempt moves job to failed.',
        'Backoff delay capped at maximum 30,000ms.'
      ],
      interruption: [
        'Cancellation while worker is in native C++ loop kills process and reclaims lease.',
        'Repeated cancellation requests for already-cancelled job return 200 idempotently.'
      ],
      security: [
        'Only job owner or Admin role authorized to cancel job.',
        'Cancellation does not leave partial unlinked files in temporary folders.'
      ]
    },
    dependencies: {
      upstream: [
        'Stage 19 (Durable job transitions): Queue leases and retry counters.',
        'Stage 23 (Refresh/reconnect recovery): Synchronizes cancellation across clients.'
      ],
      downstream: [
        'Stage 25 (Combined fault sequences): Exercises cancellation during chaos testing.',
        'Stage 33 (Controlled overload and quotas): Uses cancellation for shed load.'
      ]
    },
    externalGates: {
      blocker: 'None',
      harness: 'Automated test suite simulating long-running jobs and triggering aborts',
      signoff: 'None'
    },
    risksAndDefects: {
      risks: [
        'Risk 1: Zombie Python subprocesses if SIGKILL is not delivered cleanly on Windows.'
      ],
      defects: [
        'Known defect 1: No cancel route exists; active jobs run until completion or timeout.'
      ]
    },
    completionDraft: {
      s0: 'Audit worker subprocess lifecycle and abort capabilities.',
      s1: 'Draft error classification matrix and cancellation architecture.',
      s2: 'Author `errorClassifier.ts`, `cancellationRoutes.ts`, `commitGuard.ts`, and tests.',
      s3: 'Execute cancellation test suite via `npm test`.',
      s4: 'Independent review audits late worker commit rejection and process termination.',
      s5: 'Tune jitter and backoff calculations.',
      s6: 'Stage-exit checklist verification.',
      s7: 'Record promotion evidence.',
      s8: 'Advance to Stage 25.'
    }
  },

  25: {
    weightArea: 'persistence-recovery',
    externalGates: [],
    verifiedState: [
      '- `PROJECT_CHARTER.md:117-118`: Test worker crashes plus server restarts, duplicate delivery during recovery, and storage failure during commits. Original integrity, ownership, attempt history, and terminal outcomes remain correct.',
      '- Single-fault vs multi-fault gap: Prior tests verified individual component crashes; combined fault sequences (e.g. server killed while worker is committing) remain untested.',
      '- Chaos test harness absent: No automated chaos test framework currently exercises compound failures.'
    ],
    scope: {
      inScope: [
        'Compound fault test harness simulating combined failures (worker crash + server restart simultaneously).',
        'Simulated disk write failure during database transaction commit.',
        'Duplicate event replay and duplicate worker result submission during network partition recovery.',
        'Audit verification: zero data corruption, zero lost originals, and clean terminal outcomes.'
      ],
      outOfScope: [
        'Physical power loss simulation (clean software fault injection only).',
        'Multi-datacenter split-brain testing.'
      ],
      notPromised: [
        'Resumption of jobs when filesystem disk space is 100% exhausted.'
      ]
    },
    workBreakdown: [
      {
        task: 'Task 1: Chaos Injection Fault Harness',
        description: 'Implement injectable fault interceptors for filesystem writes, database commits, and worker processes.',
        ownedPaths: 'server/testing/faultInjector.ts',
        fact: 'Fact 1: Fault injector simulates combined crash scenarios'
      },
      {
        task: 'Task 2: Compound Failure Recovery Reconciliation Drill',
        description: 'Verify server startup reconciles interrupted states left by worker crash + server crash.',
        ownedPaths: 'server/lifecycle/reconciliation.ts',
        fact: 'Fact 2: Startup reconciliation cleans up compound failure artifacts'
      },
      {
        task: 'Task 3: Duplicate Delivery and Concurrency Chaos Test',
        description: 'Inject duplicate worker commits and duplicate SSE events to confirm idempotent handling.',
        ownedPaths: 'tests/chaos/duplicateDelivery.test.mjs',
        fact: 'Fact 3: Duplicate delivery handled idempotently without error'
      },
      {
        task: 'Task 4: Combined Fault Sequences Master Test Suite',
        description: 'Execute end-to-end chaos test matrix asserting integrity of originals, ownership, and attempts.',
        ownedPaths: 'tests/stage25Chaos.test.mjs',
        fact: 'Fact 4: Combined fault sequence test suite passes'
      }
    ],
    contractsToFreeze: `export interface ChaosTestScenario {
  scenarioId: string;
  name: string;
  faultSequence: Array<'kill_worker' | 'kill_server' | 'inject_disk_full' | 'replay_duplicate_commit'>;
  expectedTerminalState: 'recovered_completed' | 'recovered_failed';
  integrityVerified: boolean;
}`,
    fanOut: {
      archetype: 'Archetype F (Chaos Engineering and Fault Injection)',
      lanes: [
        { lane: 'Lane 1', role: 'impl-lane', mode: 'CODE', ownedPaths: 'server/testing/faultInjector.ts,server/lifecycle/reconciliation.ts', deliverable: 'Fault injection hooks and startup reconciler' },
        { lane: 'Lane 2', role: 'test-author', mode: 'CODE', ownedPaths: 'tests/chaos/**', deliverable: 'Chaos test scenarios' },
        { lane: 'Lane 3', role: 'test-author', mode: 'CODE', ownedPaths: 'tests/stage25Chaos.test.mjs', deliverable: 'Master combined fault test suite' }
      ],
      sharedFiles: 'None'
    },
    acceptanceEvidence: [
      { fact: 'Fact 1: Fault injector simulates combined crash scenarios', command: 'node -e "assert(fs.existsSync(\'server/testing/faultInjector.ts\'))"', expectedOutcome: 'Fault injector intercepts storage, db, and process calls', status: 'pending', evidencePath: 'automation/runs/stage-25/injector-audit.json' },
      { fact: 'Fact 2: Startup reconciliation cleans up compound failure artifacts', command: 'node --test tests/stage25Chaos.test.mjs', expectedOutcome: 'Server startup recovers abandoned jobs and cleans orphaned files', status: 'pending', evidencePath: 'automation/runs/stage-25/reconciliation-audit.json' },
      { fact: 'Fact 3: Duplicate delivery handled idempotently without error', command: 'node --test tests/chaos/duplicateDelivery.test.mjs', expectedOutcome: 'Duplicate commits result in identical final database state', status: 'pending', evidencePath: 'automation/runs/stage-25/duplicate-audit.json' },
      { fact: 'Fact 4: Combined fault sequence test suite passes', command: 'node --test tests/stage25Chaos.test.mjs', expectedOutcome: 'All combined fault scenarios pass with exit code 0', status: 'pending', evidencePath: 'automation/runs/stage-25/test-summary.json' }
    ],
    tests: {
      negative: [
        'Disk I/O error during result write rolls back database and retains original file intact.',
        'Corrupted worker output line caught by parser and logged as attempt failure.'
      ],
      boundary: [
        'Simultaneous failure of 3 concurrent workers recovered sequentially without race.',
        'Recovering 50 interrupted jobs on startup completes in under 2s.'
      ],
      interruption: [
        'SIGKILL server immediately after worker returns output; restart resumes commit cleanly.',
        'Reconciliation process is idempotent and can be run multiple times safely.'
      ],
      security: [
        'Injected faults never corrupt ownership records or grant cross-tenant access.',
        'Failed attempts maintain full attributable audit log.'
      ]
    },
    dependencies: {
      upstream: [
        'Stage 13 (Persistence invariants): ACID rollback mechanics.',
        'Stage 23 (Refresh/reconnect recovery): Client recovery under server restart.',
        'Stage 24 (Bounded retries/deadlines/cancellation): Retry limits under fault.'
      ],
      downstream: [
        'Stage 38 (Full workflow and test-effectiveness checks): Incorporates chaos into regression suite.',
        'Stage 41 (Tested backup/restore/rollback): Disaster recovery validation.'
      ]
    },
    externalGates: {
      blocker: 'None',
      harness: 'Automated in-process fault injector and subprocess termination harness',
      signoff: 'None'
    },
    risksAndDefects: {
      risks: [
        'Risk 1: Flaky tests if chaos test timings collide with OS scheduler.'
      ],
      defects: [
        'Known defect 1: Application currently has no startup reconciliation routine.'
      ]
    },
    completionDraft: {
      s0: 'Audit system state machine under abrupt process death.',
      s1: 'Draft chaos test matrix and fault injection architecture.',
      s2: 'Author `faultInjector.ts`, `reconciliation.ts`, and chaos test suites.',
      s3: 'Execute chaos test suite via `npm test`.',
      s4: 'Independent review audits integrity invariants under combined crashes.',
      s5: 'Tune sleep times and fault triggers.',
      s6: 'Stage-exit checklist verification.',
      s7: 'Record promotion evidence.',
      s8: 'Advance to Stage 26.'
    }
  },

  26: {
    weightArea: 'interface-workflow',
    externalGates: [],
    verifiedState: [
      '- `PROJECT_CHARTER.md:120-121`: Replace fixture views with stored lists/history/versions/previews/search/filter/pagination and usable failure/empty states. Large lists, slow responses, deletion, and no-result documents remain understandable.',
      '- Existing UI views (`SuperStackResearchView.tsx`, `MultiPassRegressionView.tsx`): Hardcode static arrays of fake passes and simulated metrics.',
      '- Document management missing: No interface exists to list uploaded documents, search by filename/status, paginate results, or view document history.',
      '- Document preview missing: No interactive PDF/image preview component connected to stored originals.'
    ],
    scope: {
      inScope: [
        'Document list view with server-side pagination, status filtering, and search by filename/date.',
        'Document detail view displaying extracted bank fields, confidence badges, and candidate alternatives.',
        'Integrated PDF/image preview component with page navigation and zoom.',
        'Handling of edge states: empty list, zero extracted fields, failed processing, and slow network responses.'
      ],
      outOfScope: [
        'Human field editing and approval buttons (Stage 27).',
        'Export download modal (Stage 28).'
      ],
      notPromised: [
        'Full document OCR text editing directly inside the PDF canvas.'
      ]
    },
    workBreakdown: [
      {
        task: 'Task 1: Document List API with Pagination and Filters',
        description: 'Implement GET /api/documents with page, limit, status, search, and date filters.',
        ownedPaths: 'server/routes/documentListRoutes.ts',
        fact: 'Fact 1: Document list API supports pagination, search, and filtering'
      },
      {
        task: 'Task 2: React Document List and History View',
        description: 'Author DocumentListView component with searchable table, status badges, and pagination controls.',
        ownedPaths: 'src/components/DocumentListView.tsx',
        fact: 'Fact 2: UI renders paginated document list with truthful states'
      },
      {
        task: 'Task 3: Document Detail and Preview Viewer Component',
        description: 'Implement DocumentDetailView displaying extracted fields alongside rendered PDF preview.',
        ownedPaths: 'src/components/DocumentDetailView.tsx',
        fact: 'Fact 3: Detail view displays extracted fields and document preview'
      },
      {
        task: 'Task 4: Interface Usability and Empty State Test Suite',
        description: 'Author component tests verifying empty lists, large datasets, and error state rendering.',
        ownedPaths: 'tests/stage26Interface.test.mjs',
        fact: 'Fact 4: Document interface test suite passes all scenarios'
      }
    ],
    contractsToFreeze: `export interface DocumentListQuery {
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
}`,
    fanOut: {
      archetype: 'Archetype E (UI Interface and Document Exploration)',
      lanes: [
        { lane: 'Lane 1', role: 'impl-lane', mode: 'CODE', ownedPaths: 'server/routes/documentListRoutes.ts', deliverable: 'Paginated document query API' },
        { lane: 'Lane 2', role: 'impl-lane', mode: 'CODE', ownedPaths: 'src/components/DocumentListView.tsx,src/components/DocumentDetailView.tsx', deliverable: 'React document list and preview components' },
        { lane: 'Lane 3', role: 'test-author', mode: 'CODE', ownedPaths: 'tests/stage26Interface.test.mjs', deliverable: 'Component and API test suite' }
      ],
      sharedFiles: 'src/App.tsx'
    },
    acceptanceEvidence: [
      { fact: 'Fact 1: Document list API supports pagination, search, and filtering', command: 'node -e "assert(fs.existsSync(\'server/routes/documentListRoutes.ts\'))"', expectedOutcome: 'Endpoint returns structured paginated document list', status: 'pending', evidencePath: 'automation/runs/stage-26/list-api-audit.json' },
      { fact: 'Fact 2: UI renders paginated document list with truthful states', command: 'node -e "assert(fs.existsSync(\'src/components/DocumentListView.tsx\'))"', expectedOutcome: 'Component renders table with real document metadata', status: 'pending', evidencePath: 'automation/runs/stage-26/ui-list-audit.json' },
      { fact: 'Fact 3: Detail view displays extracted fields and document preview', command: 'node -e "assert(fs.existsSync(\'src/components/DocumentDetailView.tsx\'))"', expectedOutcome: 'Component renders side-by-side preview and field list', status: 'pending', evidencePath: 'automation/runs/stage-26/detail-audit.json' },
      { fact: 'Fact 4: Document interface test suite passes all scenarios', command: 'node --test tests/stage26Interface.test.mjs', expectedOutcome: 'All interface and pagination tests exit 0', status: 'pending', evidencePath: 'automation/runs/stage-26/test-summary.json' }
    ],
    tests: {
      negative: [
        'Querying invalid page number (<1) or negative limit returns 400 Bad Request.',
        'Accessing document list without auth token returns 401.'
      ],
      boundary: [
        'Empty document repository renders friendly empty-state illustration.',
        'Paginating through 1,000 document records renders page 100 within 50ms.'
      ],
      interruption: [
        'Slow network response displays skeleton loading state without UI flicker.',
        'Server 500 error surfaces user-friendly error message with retry button.'
      ],
      security: [
        'Search query input sanitized to prevent SQL injection in LIKE clauses.',
        'Document list filtered to only display documents owned by caller.'
      ]
    },
    dependencies: {
      upstream: [
        'Stage 14 (Authentication and authorization): Enforces user ownership in queries.',
        'Stage 20 (Integrated vertical slice): Provides stored documents to display.',
        'Stage 22 (Genuine progress/error streaming): Real-time updates to list items.'
      ],
      downstream: [
        'Stage 27 (Controlled human review): Extends detail view with human review tools.',
        'Stage 28 (Safe consistent exports): Adds export actions to document interface.'
      ]
    },
    externalGates: {
      blocker: 'None',
      harness: 'Automated tests verifying API responses and React component rendering',
      signoff: 'None'
    },
    risksAndDefects: {
      risks: [
        'Risk 1: Client memory consumption when rendering large PDF canvas previews.'
      ],
      defects: [
        'Known defect 1: UI navigation currently shows mock research views rather than real document inventory.'
      ]
    },
    completionDraft: {
      s0: 'Audit UI components and replace static mock views.',
      s1: 'Draft paginated query contract and document viewer layout.',
      s2: 'Author `documentListRoutes.ts`, `DocumentListView.tsx`, `DocumentDetailView.tsx`, and tests.',
      s3: 'Execute interface test suite via `npm test`.',
      s4: 'Independent review audits pagination safety and empty state handling.',
      s5: 'Tune search query performance.',
      s6: 'Stage-exit checklist verification.',
      s7: 'Record promotion evidence.',
      s8: 'Advance to Stage 27.'
    }
  },

  27: {
    weightArea: 'interface-workflow',
    externalGates: [],
    verifiedState: [
      '- `PROJECT_CHARTER.md:123-124`: Persist corrections, reviewer identity, rationale, approval/reopening, and optimistic concurrency. Simultaneous edits, revoked reviewers, and reprocessing cannot silently lose or replace approved values.',
      '- Review mechanism absent: Current UI has no form controls for human operators to approve, correct, or reject extracted fields.',
      '- Concurrency protection missing: No version check exists to prevent two reviewers from overwriting each other.',
      '- Audit trail missing: No record tracks which human reviewer modified which field value and why.'
    ],
    scope: {
      inScope: [
        'Field-level human review: Approve field, Modify value, Reject field, and Add review note.',
        'Document-level status transition: `ready_for_review` -> `approved` / `rejected`.',
        'Optimistic concurrency control via `version` column rejecting conflicting simultaneous reviews.',
        'Complete immutable review audit log capturing timestamp, reviewer ID, old value, new value, and rationale.'
      ],
      outOfScope: [
        'Automated AI-assisted correction suggestions.',
        'External digital signature integration.'
      ],
      notPromised: [
        'Unsupervised auto-approval of unverified bank fields.'
      ]
    },
    workBreakdown: [
      {
        task: 'Task 1: Review and Correction Persistence Service',
        description: 'Implement database layer persisting field reviews, optimistic version checks, and approval states.',
        ownedPaths: 'server/services/reviewService.ts',
        fact: 'Fact 1: Review service persists field approvals and modifications'
      },
      {
        task: 'Task 2: Review Actions API Endpoints',
        description: 'Implement POST /api/documents/:id/review/fields and POST /api/documents/:id/approve with concurrency guard.',
        ownedPaths: 'server/routes/reviewRoutes.ts',
        fact: 'Fact 2: Review endpoints enforce optimistic concurrency and role check'
      },
      {
        task: 'Task 3: React Human Review Workspace Interface',
        description: 'Implement ReviewWorkspace component with field editors, candidate selectors, and approval action bar.',
        ownedPaths: 'src/components/ReviewWorkspace.tsx',
        fact: 'Fact 3: UI provides interactive review and correction workspace'
      },
      {
        task: 'Task 4: Concurrency and Review Audit Test Suite',
        description: 'Author automated tests for concurrent conflicting reviews, reviewer revocation, and audit logging.',
        ownedPaths: 'tests/stage27Review.test.mjs',
        fact: 'Fact 4: Review concurrency and audit test suite passes'
      }
    ],
    contractsToFreeze: `export interface FieldReviewAction {
  fieldId: string;
  action: 'approve' | 'modify' | 'reject';
  correctedValue?: string;
  rationale?: string;
  expectedVersion: number;
}

export interface DocumentApprovalResult {
  documentId: string;
  approvedBy: string;
  approvedAt: string;
  status: 'approved';
  totalFieldsApproved: number;
  totalFieldsModified: number;
}`,
    fanOut: {
      archetype: 'Archetype E (Human Review and Approval Workflow)',
      lanes: [
        { lane: 'Lane 1', role: 'impl-lane', mode: 'CODE', ownedPaths: 'server/services/reviewService.ts,server/routes/reviewRoutes.ts', deliverable: 'Review backend service and routes' },
        { lane: 'Lane 2', role: 'impl-lane', mode: 'CODE', ownedPaths: 'src/components/ReviewWorkspace.tsx', deliverable: 'Human review React workspace' },
        { lane: 'Lane 3', role: 'test-author', mode: 'CODE', ownedPaths: 'tests/stage27Review.test.mjs', deliverable: 'Review concurrency test suite' }
      ],
      sharedFiles: 'None'
    },
    acceptanceEvidence: [
      { fact: 'Fact 1: Review service persists field approvals and modifications', command: 'node -e "assert(fs.existsSync(\'server/services/reviewService.ts\'))"', expectedOutcome: 'Service updates review record and records audit log', status: 'pending', evidencePath: 'automation/runs/stage-27/service-audit.json' },
      { fact: 'Fact 2: Review endpoints enforce optimistic concurrency and role check', command: 'node --test tests/stage27Review.test.mjs', expectedOutcome: 'Conflicting simultaneous edit rejected with 409 Conflict', status: 'pending', evidencePath: 'automation/runs/stage-27/concurrency-audit.json' },
      { fact: 'Fact 3: UI provides interactive review and correction workspace', command: 'node -e "assert(fs.existsSync(\'src/components/ReviewWorkspace.tsx\'))"', expectedOutcome: 'Component renders review controls and approval button', status: 'pending', evidencePath: 'automation/runs/stage-27/workspace-audit.json' },
      { fact: 'Fact 4: Review concurrency and audit test suite passes', command: 'node --test tests/stage27Review.test.mjs', expectedOutcome: 'All review and concurrency tests exit 0', status: 'pending', evidencePath: 'automation/runs/stage-27/test-summary.json' }
    ],
    tests: {
      negative: [
        'Submitting review with mismatched version number returns 409 Conflict.',
        'User with Operator role (lacking Reviewer permission) attempting approval returns 403 Forbidden.',
        'Revoked reviewer session rejected immediately upon submission.'
      ],
      boundary: [
        'Document with all 99 fields approved transitions status to approved.',
        'Document with 1 rejected mandatory field cannot be approved without waiver rationale.'
      ],
      interruption: [
        'Server restart mid-review keeps uncommitted drafts in local client storage.',
        'Reprocessing document leaves approved values untouched.'
      ],
      security: [
        'All review modifications recorded in tamper-evident append-only audit table.',
        'Reviewer cannot approve their own uploaded documents if separation-of-duties enabled.'
      ]
    },
    dependencies: {
      upstream: [
        'Stage 21 (Immutable extraction evidence): Reviewer views candidate evidence.',
        'Stage 26 (Real document/result interface): Review workspace integrated into detail view.'
      ],
      downstream: [
        'Stage 28 (Safe consistent exports): Exports only approved document snapshots.',
        'Stage 31 (Evidence-driven extra passes): Reprocessing respects reviewed values.'
      ]
    },
    externalGates: {
      blocker: 'None',
      harness: 'Automated test suite simulating multi-reviewer edits and verifying optimistic locks',
      signoff: 'None'
    },
    risksAndDefects: {
      risks: [
        'Risk 1: Review fatigue causing operators to bulk-approve without verification.'
      ],
      defects: [
        'Known defect 1: Current application provides no way to edit or approve extracted data.'
      ]
    },
    completionDraft: {
      s0: 'Audit field review requirements and optimistic locking design.',
      s1: 'Draft review contract, audit log schema, and workspace UX.',
      s2: 'Author `reviewService.ts`, `reviewRoutes.ts`, `ReviewWorkspace.tsx`, and tests.',
      s3: 'Execute review test suite via `npm test`.',
      s4: 'Independent review audits optimistic concurrency and role enforcement.',
      s5: 'Refine conflict resolution messaging in UI.',
      s6: 'Stage-exit checklist verification.',
      s7: 'Record promotion evidence.',
      s8: 'Advance to Stage 28.'
    }
  },

  28: {
    weightArea: 'interface-workflow',
    externalGates: [],
    verifiedState: [
      '- `PROJECT_CHARTER.md:126-127`: Export approved versioned snapshots preserving identifiers, decimals, dates, missing values, and applicant association. Unicode/escaping/formulas, concurrent edits, and authorization checks preserve safety.',
      '- Export capabilities absent: Application has no endpoint or UI button to export approved documents to structured CSV or JSON formats.',
      '- CSV injection vulnerability: In banking documents, fields starting with `=`, `+`, `-`, or `@` can execute malicious formulas in Excel.',
      '- Unapproved export risk: Must ensure only documents with status `approved` can be exported to production formats.'
    ],
    scope: {
      inScope: [
        'Approved snapshot export to standardized JSON and CSV formats.',
        'CSV injection prevention: sanitize and escape formula triggers (`=`, `+`, `-`, `@`, `\\t`, `\\r`).',
        'Preservation of leading zeros, decimal precision (currency), and ISO date formatting in exported data.',
        'Export authorization: only authenticated users with Export permission may download results.'
      ],
      outOfScope: [
        'Direct automated push to third-party core banking APIs (export files only).',
        'Proprietary banking XML schema formats (e.g. LIXI) (future scope).'
      ],
      notPromised: [
        'Support for deprecated legacy spreadsheet encodings (UTF-8 with BOM standard).'
      ]
    },
    workBreakdown: [
      {
        task: 'Task 1: Safe CSV and JSON Export Serializer',
        description: 'Implement export serializer escaping formula triggers and preserving leading zeros and decimals.',
        ownedPaths: 'server/export/exportSerializer.ts',
        fact: 'Fact 1: Export serializer formats JSON and sanitizes CSV formula triggers'
      },
      {
        task: 'Task 2: Authorized Export Download Endpoint',
        description: 'Implement GET /api/documents/:id/export?format=csv|json with authorization and approval check.',
        ownedPaths: 'server/routes/exportRoutes.ts',
        fact: 'Fact 2: Export endpoint enforces approved status and authorization'
      },
      {
        task: 'Task 3: Client Export Dialog and Trigger Component',
        description: 'Implement ExportModal in React UI allowing users to choose format and download snapshot.',
        ownedPaths: 'src/components/ExportModal.tsx',
        fact: 'Fact 3: UI provides export download modal'
      },
      {
        task: 'Task 4: Export Security and Data Integrity Test Suite',
        description: 'Author automated tests verifying CSV injection mitigation, zero preservation, and unapproved rejection.',
        ownedPaths: 'tests/stage28Export.test.mjs',
        fact: 'Fact 4: Export safety and consistency test suite passes'
      }
    ],
    contractsToFreeze: `export interface DocumentExportMetadata {
  documentId: string;
  exportFormat: 'json' | 'csv';
  exportedAt: string;
  exportedBy: string;
  versionSnapshot: number;
  recordCount: number;
  sha256Checksum: string;
}`,
    fanOut: {
      archetype: 'Archetype E (Export Formatting and Safety)',
      lanes: [
        { lane: 'Lane 1', role: 'impl-lane', mode: 'CODE', ownedPaths: 'server/export/exportSerializer.ts,server/routes/exportRoutes.ts', deliverable: 'Export serializer and download endpoint' },
        { lane: 'Lane 2', role: 'impl-lane', mode: 'CODE', ownedPaths: 'src/components/ExportModal.tsx', deliverable: 'React export modal component' },
        { lane: 'Lane 3', role: 'test-author', mode: 'CODE', ownedPaths: 'tests/stage28Export.test.mjs', deliverable: 'Export security test suite' }
      ],
      sharedFiles: 'None'
    },
    acceptanceEvidence: [
      { fact: 'Fact 1: Export serializer formats JSON and sanitizes CSV formula triggers', command: 'node -e "assert(fs.existsSync(\'server/export/exportSerializer.ts\'))"', expectedOutcome: 'Serializer prefixes formula characters with single quote', status: 'pending', evidencePath: 'automation/runs/stage-28/serializer-audit.json' },
      { fact: 'Fact 2: Export endpoint enforces approved status and authorization', command: 'node --test tests/stage28Export.test.mjs', expectedOutcome: 'Attempting export of unapproved document returns 412 Precondition Failed', status: 'pending', evidencePath: 'automation/runs/stage-28/auth-audit.json' },
      { fact: 'Fact 3: UI provides export download modal', command: 'node -e "assert(fs.existsSync(\'src/components/ExportModal.tsx\'))"', expectedOutcome: 'Component renders format choices and triggers download', status: 'pending', evidencePath: 'automation/runs/stage-28/modal-audit.json' },
      { fact: 'Fact 4: Export safety and consistency test suite passes', command: 'node --test tests/stage28Export.test.mjs', expectedOutcome: 'All export security and integrity tests exit 0', status: 'pending', evidencePath: 'automation/runs/stage-28/test-summary.json' }
    ],
    tests: {
      negative: [
        'Field value `=CMD("calc")` in CSV output escaped to `\'=CMD("calc")` to prevent formula execution.',
        'Exporting document with status `ready_for_review` or `processing` returns 412.',
        'User without Export role receives 403 Forbidden.'
      ],
      boundary: [
        'BSB `062-000` exported with preserved leading zero in both CSV and JSON.',
        'Currency `$1,250.50` exported with exact decimal representation (`1250.50`).'
      ],
      interruption: [
        'Client aborting download mid-stream cleans up stream without leaking file descriptors.',
        'Concurrent export requests generate identical bit-for-bit checksums.'
      ],
      security: [
        'UTF-8 BOM prepended to CSV for correct Excel rendering without corruption.',
        'Export events logged in audit log with user ID and document checksum.'
      ]
    },
    dependencies: {
      upstream: [
        'Stage 26 (Real document/result interface): Export trigger placed in UI.',
        'Stage 27 (Controlled human review): Only approved documents can be exported.'
      ],
      downstream: [
        'Stage 34 (Full data lifecycle): Retention rules cover generated exports.',
        'Stage 38 (Full workflow and test-effectiveness checks): Validates export in E2E tests.'
      ]
    },
    externalGates: {
      blocker: 'None',
      harness: 'Automated test suite asserting CSV string escaping and JSON schema conformity',
      signoff: 'None'
    },
    risksAndDefects: {
      risks: [
        'Risk 1: Excel stripping leading zeros when opening CSV files without proper escaping.'
      ],
      defects: [
        'Known defect 1: Current application has zero export capabilities.'
      ]
    },
    completionDraft: {
      s0: 'Audit export format requirements and Excel CSV injection vulnerabilities.',
      s1: 'Draft export serializer schema and security escaping rules.',
      s2: 'Author `exportSerializer.ts`, `exportRoutes.ts`, `ExportModal.tsx`, and tests.',
      s3: 'Execute export test suite via `npm test`.',
      s4: 'Independent review audits CSV injection prevention and approval enforcement.',
      s5: 'Tune UTF-8 BOM and character escaping.',
      s6: 'Stage-exit checklist verification.',
      s7: 'Record promotion evidence.',
      s8: 'Advance to Stage 29.'
    }
  },

  29: {
    weightArea: 'real-ingestion-ocr',
    externalGates: ['google-drive-oauth-credentials'],
    verifiedState: [
      '- `PROJECT_CHARTER.md:129-130`: Select user/service-account model, minimal scopes, folder boundaries, encrypted credentials, and expiry/revocation handling. Forbidden folders, changed permissions, and cross-owner credential use fail without secrets or ownership drift.',
      '- `server.ts:145-149`: Fallback uses hardcoded mock folder ID and imports static fixtures from `src/data/gdriveDocuments.ts`.',
      '- OAuth credentials missing: No Google Cloud project OAuth 2.0 client ID or client secret configured in `.env`.',
      '- Encrypted credential storage missing: No AES-256-GCM vault exists to store user refresh tokens.'
    ],
    scope: {
      inScope: [
        'Google OAuth 2.0 authorization flow using minimal readonly drive scope (`drive.readonly` restricted to chosen folder).',
        'Secure storage of OAuth refresh tokens encrypted at rest via AES-256-GCM using `ENCRYPTION_KEY`.',
        'Automated token refresh on expiry and graceful error handling on token revocation.',
        'Local mock OAuth server harness for automated unattended execution without live Google API keys.'
      ],
      outOfScope: [
        'Write or edit access to user Google Drive files (`drive.file` write scope).',
        'Domain-wide G-Suite admin delegation.'
      ],
      notPromised: [
        'Automatic bypass of Google OAuth consent screens in live production.'
      ]
    },
    workBreakdown: [
      {
        task: 'Task 1: Google OAuth 2.0 Client and Token Vault',
        description: 'Implement OAuth client and AES-256-GCM credential encryption service.',
        ownedPaths: 'server/gdrive/oauthClient.ts,server/gdrive/tokenVault.ts',
        fact: 'Fact 1: OAuth client encrypts refresh tokens with AES-256-GCM'
      },
      {
        task: 'Task 2: Drive Authorization Routes and Callback Handler',
        description: 'Implement GET /api/gdrive/auth, /api/gdrive/callback, and /api/gdrive/revoke.',
        ownedPaths: 'server/routes/gdriveAuthRoutes.ts',
        fact: 'Fact 2: Drive auth routes handle authorization flow and revocation'
      },
      {
        task: 'Task 3: Automated Mock OAuth Server Harness',
        description: 'Implement deterministic local mock Google OAuth server for CI and test verification.',
        ownedPaths: 'tests/helpers/mockOAuthServer.mjs',
        fact: 'Fact 3: Mock OAuth server enables automated headless testing'
      },
      {
        task: 'Task 4: Drive Authorization Security Test Suite',
        description: 'Author automated tests verifying token encryption, scope restriction, and revocation handling.',
        ownedPaths: 'tests/stage29DriveAuth.test.mjs',
        fact: 'Fact 4: Drive authorization security test suite passes'
      }
    ],
    contractsToFreeze: `export interface DriveOAuthTokens {
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
}`,
    fanOut: {
      archetype: 'Archetype H (OAuth Security and Token Encryption)',
      lanes: [
        { lane: 'Lane 1', role: 'impl-lane', mode: 'CODE', ownedPaths: 'server/gdrive/**', deliverable: 'OAuth client and token vault' },
        { lane: 'Lane 2', role: 'impl-lane', mode: 'CODE', ownedPaths: 'server/routes/gdriveAuthRoutes.ts', deliverable: 'Drive auth HTTP routes' },
        { lane: 'Lane 3', role: 'test-author', mode: 'CODE', ownedPaths: 'tests/stage29DriveAuth.test.mjs,tests/helpers/mockOAuthServer.mjs', deliverable: 'Mock OAuth server and security tests' }
      ],
      sharedFiles: 'None'
    },
    acceptanceEvidence: [
      { fact: 'Fact 1: OAuth client encrypts refresh tokens with AES-256-GCM', command: 'node -e "assert(fs.existsSync(\'server/gdrive/tokenVault.ts\'))"', expectedOutcome: 'Tokens stored encrypted; plaintext never written to disk', status: 'pending', evidencePath: 'automation/runs/stage-29/vault-audit.json' },
      { fact: 'Fact 2: Drive auth routes handle authorization flow and revocation', command: 'node --test tests/stage29DriveAuth.test.mjs', expectedOutcome: 'Revocation clears encrypted token and resets status', status: 'pending', evidencePath: 'automation/runs/stage-29/routes-audit.json' },
      { fact: 'Fact 3: Mock OAuth server enables automated headless testing', command: 'node -e "assert(fs.existsSync(\'tests/helpers/mockOAuthServer.mjs\'))"', expectedOutcome: 'Mock server runs locally on localhost port', status: 'pending', evidencePath: 'automation/runs/stage-29/mock-server-audit.json' },
      { fact: 'Fact 4: Drive authorization security test suite passes', command: 'node --test tests/stage29DriveAuth.test.mjs', expectedOutcome: 'All Drive OAuth tests exit 0 against mock server', status: 'pending', evidencePath: 'automation/runs/stage-29/test-summary.json' }
    ],
    tests: {
      negative: [
        'Attempting Drive sync with revoked token returns 401 and prompts re-auth.',
        'Token encrypted with different key fails AES-GCM tag verification.'
      ],
      boundary: [
        'Token expiring within 60s triggers automatic background refresh.',
        'Requesting folder outside authorized boundary returns 403 Forbidden.'
      ],
      interruption: [
        'Network error during token refresh maintains old token and flags retry.',
        'Server restart reloads encrypted tokens cleanly from database.'
      ],
      security: [
        'OAuth client secret never returned in client API responses.',
        'PKCE (code_verifier and code_challenge) enforced on authorization requests.'
      ]
    },
    dependencies: {
      upstream: [
        'Stage 14 (Authentication and authorization): Links Drive tokens to authenticated user.',
        'Stage 20 (Integrated vertical slice): Provides baseline pipeline.'
      ],
      downstream: [
        'Stage 30 (Resumable incremental Drive sync): Uses OAuth client for file polling.'
      ]
    },
    externalGates: {
      blocker: 'google-drive-oauth-credentials (Google Cloud console client ID and secret)',
      harness: 'Automated local mock OAuth server (tests/helpers/mockOAuthServer.mjs) simulating token exchange',
      signoff: 'Owner sign-off required for production Google Cloud OAuth verification'
    },
    risksAndDefects: {
      risks: [
        'Risk 1: Google OAuth verification requirements for unverified apps (warning screen).'
      ],
      defects: [
        'Known defect 1: `server.ts:145` uses hardcoded fake folder ID.'
      ]
    },
    completionDraft: {
      s0: 'Audit Google Drive API requirements and token security.',
      s1: 'Draft OAuth 2.0 PKCE flow and token encryption architecture.',
      s2: 'Author `oauthClient.ts`, `tokenVault.ts`, mock server, and tests.',
      s3: 'Execute Drive auth test suite via `npm test`.',
      s4: 'Independent review audits token encryption and scope restrictions.',
      s5: 'Refine mock OAuth server edge cases.',
      s6: 'Stage-exit checklist verification.',
      s7: 'Record promotion evidence.',
      s8: 'Advance to Stage 30.'
    }
  },

  30: {
    weightArea: 'real-ingestion-ocr',
    externalGates: [],
    verifiedState: [
      '- `PROJECT_CHARTER.md:132-133`: Persist remote identity/version/checkpoints/download/processing states and change/deletion policy. Pagination, throttling, interruption, repeat sync, and mid-run revocation reconcile with actual files and do not omit/duplicate work.',
      '- `src/components/GoogleDriveHub.tsx:60-69`: Uses `setTimeout` to emulate file discovery; no actual Drive files are imported.',
      '- Checkpoint tracking missing: No database table records `sync_token` or `page_token` to resume interrupted syncs.',
      '- Duplicate suppression: No hash comparison prevents re-importing identical files on successive sync runs.'
    ],
    scope: {
      inScope: [
        'Resumable incremental synchronization polling Google Drive folder using change tokens.',
        'Sync state persistence: track `remoteFileId`, `version`, `etag`, `syncToken`, and download status in SQLite.',
        'Interruption recovery: sync interrupted mid-download resumes from last completed file checkpoint.',
        'Duplicate suppression: files with identical SHA-256 skip redundant processing.'
      ],
      outOfScope: [
        'Real-time Google Drive webhooks / push notifications (polling with backoff sufficient).',
        'Syncing non-document files (audio, video, spreadsheets).'
      ],
      notPromised: [
        'Instantaneous synchronization of Drive folders with >10,000 files.'
      ]
    },
    workBreakdown: [
      {
        task: 'Task 1: Incremental Sync Service and Checkpoint Manager',
        description: 'Implement DriveSyncService tracking sync tokens, remote file IDs, and change deltas in SQLite.',
        ownedPaths: 'server/gdrive/syncService.ts,server/db/migrations/003_drive_sync.sql',
        fact: 'Fact 1: Drive sync service manages incremental change checkpoints'
      },
      {
        task: 'Task 2: Resumable File Downloader and Deduplicator',
        description: 'Download remote files in chunks and deduplicate against existing document SHA-256 hashes.',
        ownedPaths: 'server/gdrive/fileDownloader.ts',
        fact: 'Fact 2: Downloader verifies checksums and skips duplicate files'
      },
      {
        task: 'Task 3: Drive Sync Trigger and Status API',
        description: 'Implement POST /api/gdrive/sync and GET /api/gdrive/sync/status returning live progress.',
        ownedPaths: 'server/routes/gdriveSyncRoutes.ts',
        fact: 'Fact 3: Sync endpoints report truthful file counts and progress'
      },
      {
        task: 'Task 4: Incremental Drive Sync Test Suite',
        description: 'Author automated tests against mock Drive server verifying pagination, checkpoint resumption, and deduplication.',
        ownedPaths: 'tests/stage30DriveSync.test.mjs',
        fact: 'Fact 4: Incremental sync test suite passes'
      }
    ],
    contractsToFreeze: `export interface DriveSyncCheckpoint {
  folderId: string;
  syncToken: string;
  lastSyncedAt: string;
  filesDiscovered: number;
  filesDownloaded: number;
  filesSkippedDuplicate: number;
  status: 'idle' | 'syncing' | 'paused' | 'error';
}`,
    fanOut: {
      archetype: 'Archetype C (Sync Engine and Checkpointing)',
      lanes: [
        { lane: 'Lane 1', role: 'impl-lane', mode: 'CODE', ownedPaths: 'server/gdrive/syncService.ts,server/gdrive/fileDownloader.ts', deliverable: 'Sync engine and downloader' },
        { lane: 'Lane 2', role: 'impl-lane', mode: 'CODE', ownedPaths: 'server/routes/gdriveSyncRoutes.ts', deliverable: 'Drive sync routes' },
        { lane: 'Lane 3', role: 'test-author', mode: 'CODE', ownedPaths: 'tests/stage30DriveSync.test.mjs', deliverable: 'Incremental sync test suite' }
      ],
      sharedFiles: 'None'
    },
    acceptanceEvidence: [
      { fact: 'Fact 1: Drive sync service manages incremental change checkpoints', command: 'node -e "assert(fs.existsSync(\'server/gdrive/syncService.ts\'))"', expectedOutcome: 'Service updates sync checkpoints in SQLite database', status: 'pending', evidencePath: 'automation/runs/stage-30/service-audit.json' },
      { fact: 'Fact 2: Downloader verifies checksums and skips duplicate files', command: 'node --test tests/stage30DriveSync.test.mjs', expectedOutcome: 'Previously downloaded files skipped based on SHA-256 match', status: 'pending', evidencePath: 'automation/runs/stage-30/dedup-audit.json' },
      { fact: 'Fact 3: Sync endpoints report truthful file counts and progress', command: 'node --test tests/stage30DriveSync.test.mjs', expectedOutcome: 'GET status returns real count of downloaded and queued files', status: 'pending', evidencePath: 'automation/runs/stage-30/status-audit.json' },
      { fact: 'Fact 4: Incremental sync test suite passes', command: 'node --test tests/stage30DriveSync.test.mjs', expectedOutcome: 'All incremental sync tests exit 0 against mock Drive', status: 'pending', evidencePath: 'automation/runs/stage-30/test-summary.json' }
    ],
    tests: {
      negative: [
        'Google Drive API rate limit (429) triggers exponential backoff without crashing sync.',
        'File deleted from Drive while download in progress handled without failing entire sync batch.'
      ],
      boundary: [
        'Folder with 0 files completes sync cleanly with status idle.',
        'Paginating through 500 files across 5 pages fetches all 500 files.'
      ],
      interruption: [
        'Simulated server restart mid-sync resumes from last saved file checkpoint.',
        'Repeated sync runs on unchanged folder download 0 new files.'
      ],
      security: [
        'Downloaded files stored directly in private storage with generated UUID keys.',
        'Files matching non-PDF/image MIME types skipped and logged as unsupported.'
      ]
    },
    dependencies: {
      upstream: [
        'Stage 29 (Real constrained Drive authorization): Provides authenticated client.'
      ],
      downstream: [
        'Stage 33 (Controlled overload and quotas): Enforces rate limits on sync.',
        'Stage 38 (Full workflow and test-effectiveness checks): Drives sync in E2E tests.'
      ]
    },
    externalGates: {
      blocker: 'None (uses mock Drive harness from Stage 29)',
      harness: 'Automated test suite using local mock Drive server with synthetic folder structures',
      signoff: 'None'
    },
    risksAndDefects: {
      risks: [
        'Risk 1: Large Google Drive folders causing sync timeouts if pagination is not chunked.'
      ],
      defects: [
        'Known defect 1: Current GoogleDriveHub component uses fake simulated timer.'
      ]
    },
    completionDraft: {
      s0: 'Audit Google Drive sync requirements and checkpoint persistence.',
      s1: 'Draft incremental sync protocol and deduplication algorithm.',
      s2: 'Author `syncService.ts`, `fileDownloader.ts`, routes, and tests.',
      s3: 'Execute Drive sync test suite via `npm test`.',
      s4: 'Independent review audits pagination and checkpoint resumption.',
      s5: 'Tune chunk download sizes and timeout handlers.',
      s6: 'Stage-exit checklist verification.',
      s7: 'Record promotion evidence.',
      s8: 'Advance to Stage 31.'
    }
  },

  31: {
    weightArea: 'extraction-validation',
    externalGates: [],
    verifiedState: [
      '- `PROJECT_CHARTER.md:135-136`: Implement eligibility/budgets/stopping, immutable pass history, and reviewed-value protection. Labelled benefits and regressions are measured; higher heuristic confidence is not called monotonic accuracy.',
      '- `server/services/multipassOcr.ts:1-120`: Simulates multi-pass OCR by returning static text with fake confidence boosts.',
      '- Heuristic confidence fallacy: Boosting confidence numbers artificially without measuring ground-truth accuracy.',
      '- Missing stopping criteria: No budget bounds secondary OCR passes when primary pass confidence is already sufficient.'
    ],
    scope: {
      inScope: [
        'Evidence-driven multi-pass OCR orchestrator: triggers secondary pass only when targeted high-value fields have low confidence (<0.7).',
        'Strict computational budget: maximum 1 extra pass per page; maximum 30s additional processing time.',
        'Immutable pass history: persist raw text and candidates for both Pass 1 and Pass 2.',
        'Regression prevention: Pass 2 results cannot overwrite human-approved fields or degrade high-confidence Pass 1 matches.'
      ],
      outOfScope: [
        'Invoking expensive cloud vision APIs without configured API credentials (Stage 4).',
        'Training custom deep learning OCR models.'
      ],
      notPromised: [
        'Guaranteed improvement on every secondary pass (some passes yield identical text).'
      ]
    },
    workBreakdown: [
      {
        task: 'Task 1: Multi-Pass Eligibility and Budget Evaluator',
        description: 'Implement eligibility rules deciding whether a document qualifies for secondary OCR pass.',
        ownedPaths: 'server/ocr/passEligibility.ts',
        fact: 'Fact 1: Multi-pass eligibility evaluates confidence thresholds and budgets'
      },
      {
        task: 'Task 2: Secondary Pass Execution and Fusion Engine',
        description: 'Execute secondary preprocessing (contrast enhancement / thresholding) and fuse candidate results.',
        ownedPaths: 'server/ocr/passFusion.ts',
        fact: 'Fact 2: Pass fusion merges candidate matches with provenance'
      },
      {
        task: 'Task 3: Replace Simulated Multipass with Real Fusion',
        description: 'Refactor server/services/multipassOcr.ts to invoke real local secondary pass without fake timers.',
        ownedPaths: 'server/services/multipassOcr.ts',
        fact: 'Fact 3: Simulated passes removed from multipass service'
      },
      {
        task: 'Task 4: Multi-Pass Evaluation and Regression Test Suite',
        description: 'Author tests measuring field extraction improvement and asserting reviewed values are protected.',
        ownedPaths: 'tests/stage31Multipass.test.mjs',
        fact: 'Fact 4: Multi-pass evaluation test suite passes'
      }
    ],
    contractsToFreeze: `export interface MultiPassResult {
  passNumber: 1 | 2;
  engine: string;
  preprocessingApplied: string[];
  fieldsExtracted: number;
  durationMs: number;
  candidateDiffs: Array<{ fieldId: string; pass1Val: string; pass2Val: string; selectedVal: string }>;
}`,
    fanOut: {
      archetype: 'Archetype D (OCR Pass Refactoring and Fusion)',
      lanes: [
        { lane: 'Lane 1', role: 'impl-lane', mode: 'CODE', ownedPaths: 'server/ocr/passEligibility.ts,server/ocr/passFusion.ts', deliverable: 'Eligibility rules and candidate fusion' },
        { lane: 'Lane 2', role: 'impl-lane', mode: 'CODE', ownedPaths: 'server/services/multipassOcr.ts', deliverable: 'Multipass service refactoring' },
        { lane: 'Lane 3', role: 'test-author', mode: 'CODE', ownedPaths: 'tests/stage31Multipass.test.mjs', deliverable: 'Multi-pass regression test suite' }
      ],
      sharedFiles: 'server/services/multipassOcr.ts'
    },
    acceptanceEvidence: [
      { fact: 'Fact 1: Multi-pass eligibility evaluates confidence thresholds and budgets', command: 'node -e "assert(fs.existsSync(\'server/ocr/passEligibility.ts\'))"', expectedOutcome: 'Eligibility evaluator skips secondary pass if confidence >= 0.8', status: 'pending', evidencePath: 'automation/runs/stage-31/eligibility-audit.json' },
      { fact: 'Fact 2: Pass fusion merges candidate matches with provenance', command: 'node -e "assert(fs.existsSync(\'server/ocr/passFusion.ts\'))"', expectedOutcome: 'Fusion engine compares Pass 1 and Pass 2 candidates', status: 'pending', evidencePath: 'automation/runs/stage-31/fusion-audit.json' },
      { fact: 'Fact 3: Simulated passes removed from multipass service', command: 'node -e "assert(!fs.readFileSync(\'server/services/multipassOcr.ts\', \'utf8\').includes(\'// SIMULATED\'))"', expectedOutcome: 'Multipass service uses real local preprocessing and OCR', status: 'pending', evidencePath: 'automation/runs/stage-31/real-multipass.json' },
      { fact: 'Fact 4: Multi-pass evaluation test suite passes', command: 'node --test tests/stage31Multipass.test.mjs', expectedOutcome: 'All multi-pass tests exit 0', status: 'pending', evidencePath: 'automation/runs/stage-31/test-summary.json' }
    ],
    tests: {
      negative: [
        'Document with all fields above confidence threshold skips Pass 2 to preserve CPU.',
        'Secondary pass failing or timing out does not discard valid Pass 1 results.'
      ],
      boundary: [
        'Budget ceiling: maximum 1 secondary pass executed even if confidence remains low.',
        'Processing duration bound: Pass 2 terminated if exceeding 30s.'
      ],
      interruption: [
        'Abrupt termination during Pass 2 leaves Pass 1 result in database as fallback.',
        'Human-approved values strictly preserved regardless of Pass 2 findings.'
      ],
      security: [
        'Pass 2 image enhancement does not leak intermediate raster frames outside temporary sandbox.',
        'Both passes maintain full cryptographic audit logs.'
      ]
    },
    dependencies: {
      upstream: [
        'Stage 18 (Real qualified OCR): Executes base OCR engine.',
        'Stage 27 (Controlled human review): Protects human-reviewed values.'
      ],
      downstream: [
        'Stage 36 (Reproducible quality benchmark): Evaluates accuracy impact of secondary passes.',
        'Stage 37 (Development-only quality improvement): Tunes multi-pass thresholds.'
      ]
    },
    externalGates: {
      blocker: 'None',
      harness: 'Automated test suite comparing Pass 1 vs Pass 2 extractions on degraded image fixtures',
      signoff: 'None'
    },
    risksAndDefects: {
      risks: [
        'Risk 1: Secondary passes doubling document processing latency.'
      ],
      defects: [
        'Known defect 1: `multipassOcr.ts:35` returns canned string with fake confidence.'
      ]
    },
    completionDraft: {
      s0: 'Audit multipassOcr.ts and remove static mock methods.',
      s1: 'Draft multi-pass eligibility rules and candidate fusion logic.',
      s2: 'Author `passEligibility.ts`, `passFusion.ts`, refactor service, and write tests.',
      s3: 'Execute multi-pass test suite via `npm test`.',
      s4: 'Independent review audits regression prevention and budget enforcement.',
      s5: 'Tune confidence threshold parameters.',
      s6: 'Stage-exit checklist verification.',
      s7: 'Record promotion evidence.',
      s8: 'Advance to Stage 32.'
    }
  },

  32: {
    weightArea: 'interface-workflow',
    externalGates: [],
    verifiedState: [
      '- `PROJECT_CHARTER.md:138-139`: Distinguish documents/pages/jobs/attempts/retries and specify denominators/freshness. Dashboards reconcile after failure/deletion/retry and completeness is not called recall without ground truth.',
      '- `server.ts:260-275`: `GET /api/dgx/telemetry-report` generates random fake metrics using `Math.random()`.',
      '- Metric confusion: Existing code conflates document count with page count and has no durable counters.',
      '- Denominator clarity: No distinction between attempted extractions and verified ground truth.'
    ],
    scope: {
      inScope: [
        'Operational telemetry engine tracking exact counts: documents ingested, pages processed, OCR duration p50/p95/p99, queue latency, retry rate, review burden.',
        'Durable metrics collection in SQLite (`metrics_counters`, `metrics_histograms`).',
        'Structured telemetry API `GET /api/telemetry/metrics` replacing simulated DGX endpoint.',
        'Clear denominator disclosure: field extraction rate = extracted fields / expected fields; review burden = modified fields / total fields.'
      ],
      outOfScope: [
        'External Prometheus / Grafana agent deployment (endpoint provides Prometheus-compatible text format).',
        'Marketing vanity metric dashboards.'
      ],
      notPromised: [
        'Claiming 100% extraction recall without evaluated ground truth.'
      ]
    },
    workBreakdown: [
      {
        task: 'Task 1: Durable Metrics Aggregator Service',
        description: 'Implement MetricsCollector recording real counters and latency histograms in SQLite.',
        ownedPaths: 'server/metrics/metricsCollector.ts',
        fact: 'Fact 1: Metrics collector aggregates real operational counters'
      },
      {
        task: 'Task 2: Replace Simulated Telemetry Endpoint',
        description: 'Deprecate Math.random() telemetry in server.ts and expose GET /api/telemetry/metrics.',
        ownedPaths: 'server/routes/metricRoutes.ts',
        fact: 'Fact 2: Real metrics API replaces simulated telemetry'
      },
      {
        task: 'Task 3: Operational Metrics React Dashboard',
        description: 'Update AuditAndEngineView to render real p50/p95 latency and processing rates.',
        ownedPaths: 'src/components/AuditAndEngineView.tsx',
        fact: 'Fact 3: UI dashboard displays real operational metrics'
      },
      {
        task: 'Task 4: Metrics Accuracy and Reconciliation Test Suite',
        description: 'Author automated tests verifying that metrics reconcile accurately after document deletion and retries.',
        ownedPaths: 'tests/stage32Metrics.test.mjs',
        fact: 'Fact 4: Metrics reconciliation test suite passes'
      }
    ],
    contractsToFreeze: `export interface OperationalMetricsSnapshot {
  timestamp: string;
  totalDocuments: number;
  totalPages: number;
  totalJobs: number;
  totalRetries: number;
  activeJobs: number;
  latencyMs: { p50: number; p90: number; p99: number };
  reviewBurdenRate: number; // modified / total
  systemMemoryBytes: number;
}`,
    fanOut: {
      archetype: 'Archetype E (Telemetry and Metrics Dashboard)',
      lanes: [
        { lane: 'Lane 1', role: 'impl-lane', mode: 'CODE', ownedPaths: 'server/metrics/**', deliverable: 'Metrics collector service' },
        { lane: 'Lane 2', role: 'impl-lane', mode: 'CODE', ownedPaths: 'server/routes/metricRoutes.ts', deliverable: 'Metrics API endpoints' },
        { lane: 'Lane 3', role: 'impl-lane', mode: 'CODE', ownedPaths: 'src/components/AuditAndEngineView.tsx', deliverable: 'React metrics dashboard update' },
        { lane: 'Lane 4', role: 'test-author', mode: 'CODE', ownedPaths: 'tests/stage32Metrics.test.mjs', deliverable: 'Metrics accuracy test suite' }
      ],
      sharedFiles: 'server.ts'
    },
    acceptanceEvidence: [
      { fact: 'Fact 1: Metrics collector aggregates real operational counters', command: 'node -e "assert(fs.existsSync(\'server/metrics/metricsCollector.ts\'))"', expectedOutcome: 'Collector records timings and counters accurately', status: 'pending', evidencePath: 'automation/runs/stage-32/collector-audit.json' },
      { fact: 'Fact 2: Real metrics API replaces simulated telemetry', command: 'node --test tests/stage32Metrics.test.mjs', expectedOutcome: 'Endpoint returns real non-random metrics', status: 'pending', evidencePath: 'automation/runs/stage-32/api-audit.json' },
      { fact: 'Fact 3: UI dashboard displays real operational metrics', command: 'node -e "assert(fs.existsSync(\'src/components/AuditAndEngineView.tsx\'))"', expectedOutcome: 'Dashboard component renders real metric values', status: 'pending', evidencePath: 'automation/runs/stage-32/ui-audit.json' },
      { fact: 'Fact 4: Metrics reconciliation test suite passes', command: 'node --test tests/stage32Metrics.test.mjs', expectedOutcome: 'Counters reconcile exactly after operations', status: 'pending', evidencePath: 'automation/runs/stage-32/test-summary.json' }
    ],
    tests: {
      negative: [
        'Deleting document decrements total active documents counter correctly.',
        'Failed job increments failure counter without distorting completed counts.'
      ],
      boundary: [
        'Initial state with 0 documents reports 0 across all counters without NaN errors.',
        'p99 latency calculated accurately over sample of 100 timings.'
      ],
      interruption: [
        'Server restart preserves accumulated durable counters in SQLite.',
        'Metric scrape during heavy load executes in under 5ms.'
      ],
      security: [
        'Metrics endpoint requires authentication or internal network guard.',
        'Zero customer names or document content exposed in metric label dimensions.'
      ]
    },
    dependencies: {
      upstream: [
        'Stage 22 (Genuine progress/error streaming): Event bus reports timing metrics.',
        'Stage 26 (Real document/result interface): Dashboard integrated into UI.'
      ],
      downstream: [
        'Stage 33 (Controlled overload and quotas): Uses metrics for quota enforcement.',
        'Stage 40 (Capacity, resource and cost evidence): Relies on operational metrics.'
      ]
    },
    externalGates: {
      blocker: 'None',
      harness: 'Automated test suite asserting counter math and latency percentile calculations',
      signoff: 'None'
    },
    risksAndDefects: {
      risks: [
        'Risk 1: High metric collection overhead impacting request latency.'
      ],
      defects: [
        'Known defect 1: `server.ts:264` generates fake telemetry via `Math.random() * 500`.'
      ]
    },
    completionDraft: {
      s0: 'Audit telemetry endpoints and remove Math.random() calls.',
      s1: 'Draft metrics schema and percentile calculation algorithms.',
      s2: 'Author `metricsCollector.ts`, `metricRoutes.ts`, update UI view, and write tests.',
      s3: 'Execute metrics test suite via `npm test`.',
      s4: 'Independent review audits denominator clarity and reconciliation accuracy.',
      s5: 'Tune histogram bucket boundaries.',
      s6: 'Stage-exit checklist verification.',
      s7: 'Record promotion evidence.',
      s8: 'Advance to Stage 33.'
    }
  },

  33: {
    weightArea: 'persistence-recovery',
    externalGates: [],
    verifiedState: [
      '- `PROJECT_CHARTER.md:141-142`: Bound input, queues, workers, quotas, and expensive auxiliary requests. Saturation/conflicting/slow jobs cannot starve users, lose accepted work, or crash the service.',
      '- Unbounded concurrency risk: Application currently accepts unlimited concurrent upload requests without backpressure.',
      '- Rate limiting absent: No IP-level or user-level rate limiting exists on Express server.',
      '- Resource exhaustion: 20 simultaneous OCR requests would spawn 20 Python processes and exhaust server RAM.'
    ],
    scope: {
      inScope: [
        'Concurrency throttling: maximum 2 concurrent OCR worker subprocesses on single host.',
        'Job queue backpressure: queue depth cap (e.g. max 50 pending jobs); reject excess with HTTP 429 / 503.',
        'Express rate limiting middleware: 100 requests per minute per IP on API routes.',
        'Graceful degradation: system responds with retry-after header when saturated.'
      ],
      outOfScope: [
        'Multi-host auto-scaling load balancers (single-host deployment scope).',
        'Complex token-bucket bandwidth shaping.'
      ],
      notPromised: [
        'Unlimited processing capacity on entry-level hardware.'
      ]
    },
    workBreakdown: [
      {
        task: 'Task 1: Bounded Worker Semaphore and Concurrency Controller',
        description: 'Implement semaphore restricting simultaneous active OCR worker subprocesses to 2.',
        ownedPaths: 'server/queue/workerSemaphore.ts',
        fact: 'Fact 1: Worker semaphore bounds active OCR processes'
      },
      {
        task: 'Task 2: API Rate Limiter and Queue Depth Backpressure',
        description: 'Implement rate limiting middleware and queue depth capacity guard returning 429/503.',
        ownedPaths: 'server/middleware/rateLimiter.ts',
        fact: 'Fact 2: Rate limiter and queue backpressure return 429/503 under load'
      },
      {
        task: 'Task 3: Worker Priority and Starvation Prevention',
        description: 'Ensure interactive UI review requests take priority over bulk background sync jobs.',
        ownedPaths: 'server/queue/priorityScheduler.ts',
        fact: 'Fact 3: Priority scheduler prevents interactive user starvation'
      },
      {
        task: 'Task 4: Overload and Backpressure Test Suite',
        description: 'Author automated load test flooding server with 50 concurrent requests and asserting graceful rejection.',
        ownedPaths: 'tests/stage33Overload.test.mjs',
        fact: 'Fact 4: Controlled overload test suite passes'
      }
    ],
    contractsToFreeze: `export interface OverloadConfig {
  maxConcurrentWorkers: number; // 2
  maxPendingQueueSize: number; // 50
  rateLimitPerMinute: number; // 100
  retryAfterSeconds: number; // 30
}`,
    fanOut: {
      archetype: 'Archetype F (Concurrency Bounding and Rate Limiting)',
      lanes: [
        { lane: 'Lane 1', role: 'impl-lane', mode: 'CODE', ownedPaths: 'server/queue/workerSemaphore.ts,server/queue/priorityScheduler.ts', deliverable: 'Worker semaphore and scheduler' },
        { lane: 'Lane 2', role: 'impl-lane', mode: 'CODE', ownedPaths: 'server/middleware/rateLimiter.ts', deliverable: 'Rate limiting middleware' },
        { lane: 'Lane 3', role: 'test-author', mode: 'CODE', ownedPaths: 'tests/stage33Overload.test.mjs', deliverable: 'Overload and stress test suite' }
      ],
      sharedFiles: 'server.ts'
    },
    acceptanceEvidence: [
      { fact: 'Fact 1: Worker semaphore bounds active OCR processes', command: 'node -e "assert(fs.existsSync(\'server/queue/workerSemaphore.ts\'))"', expectedOutcome: 'Semaphore limits concurrent worker spawn count to 2', status: 'pending', evidencePath: 'automation/runs/stage-33/semaphore-audit.json' },
      { fact: 'Fact 2: Rate limiter and queue backpressure return 429/503 under load', command: 'node --test tests/stage33Overload.test.mjs', expectedOutcome: 'Requests exceeding capacity receive 429 with Retry-After header', status: 'pending', evidencePath: 'automation/runs/stage-33/limiter-audit.json' },
      { fact: 'Fact 3: Priority scheduler prevents interactive user starvation', command: 'node -e "assert(fs.existsSync(\'server/queue/priorityScheduler.ts\'))"', expectedOutcome: 'Interactive review requests prioritized over bulk sync', status: 'pending', evidencePath: 'automation/runs/stage-33/scheduler-audit.json' },
      { fact: 'Fact 4: Controlled overload test suite passes', command: 'node --test tests/stage33Overload.test.mjs', expectedOutcome: 'All overload and backpressure tests exit 0', status: 'pending', evidencePath: 'automation/runs/stage-33/test-summary.json' }
    ],
    tests: {
      negative: [
        'Flooding server with 150 requests in 10s triggers 429 Too Many Requests.',
        'Submitting job when queue is full returns 503 Service Unavailable.'
      ],
      boundary: [
        'Exactly 2 workers execute concurrently; 3rd job waits in queue.',
        'Rate limit resets cleanly after 60s window.'
      ],
      interruption: [
        'Abrupt client disconnect while in queue removes job from pending list.',
        'Worker crash releases semaphore slot immediately for next job.'
      ],
      security: [
        'Rate limiting keys based on authenticated user ID or verified IP.',
        'Protection against slowloris attacks via socket read timeouts.'
      ]
    },
    dependencies: {
      upstream: [
        'Stage 24 (Bounded retries/deadlines/cancellation): Drops cancelled jobs from queue.',
        'Stage 30 (Resumable incremental Drive sync): Bulk sync throttled by rate limiter.',
        'Stage 32 (Defined operational metrics): Telemetry monitors queue depth.'
      ],
      downstream: [
        'Stage 38 (Full workflow and test-effectiveness checks): Validates backpressure in E2E tests.',
        'Stage 40 (Capacity, resource and cost evidence): Measures capacity limits.'
      ]
    },
    externalGates: {
      blocker: 'None',
      harness: 'Automated test suite using concurrent HTTP requests in worker threads',
      signoff: 'None'
    },
    risksAndDefects: {
      risks: [
        'Risk 1: Starvation of bulk sync jobs if interactive user load is continuous.'
      ],
      defects: [
        'Known defect 1: Current server has no concurrency ceiling on worker spawning.'
      ]
    },
    completionDraft: {
      s0: 'Audit system resource utilization under concurrent uploads.',
      s1: 'Draft semaphore algorithm and rate limiting policy.',
      s2: 'Author `workerSemaphore.ts`, `rateLimiter.ts`, `priorityScheduler.ts`, and tests.',
      s3: 'Execute overload test suite via `npm test`.',
      s4: 'Independent review audits backpressure handling and slot release.',
      s5: 'Tune queue capacity and retry-after headers.',
      s6: 'Stage-exit checklist verification.',
      s7: 'Record promotion evidence.',
      s8: 'Advance to Stage 34.'
    }
  },

  34: {
    weightArea: 'security',
    externalGates: [],
    verifiedState: [
      '- `PROJECT_CHARTER.md:144-145`: Cover originals/text/previews/results/reviews/exports/caches/temp/logs/backups with retention/deletion rules. Interrupted deletion and backup restoration honor deletion obligations without hidden retained copies.',
      '- Permanent retention risk: Current application never deletes temporary files or provides document deletion.',
      '- File unlinking missing: No service exists to securely delete originals, previews, candidates, and database records.',
      '- Retention policies: No automated cleanup routine exists to purge expired artifacts.'
    ],
    scope: {
      inScope: [
        'Complete document lifecycle deletion: securely delete database records, original files, preview images, and candidate evidence.',
        'Automated retention policy manager: purge temporary OCR rasters (>24h old) and expired exports.',
        'Audit trail of deletion: record attributable deletion tombstone without retaining PII.',
        'Guaranteed cleanup: zero orphaned disk fragments left after document deletion.'
      ],
      outOfScope: [
        'Cryptographic multi-pass disk shredding (standard filesystem unlink sufficient).',
        'Physical tape backup purging.'
      ],
      notPromised: [
        'Restoration of documents after explicit user deletion.'
      ]
    },
    workBreakdown: [
      {
        task: 'Task 1: Cascading Document Deletion Service',
        description: 'Implement DocumentDeletionService unlinking files from disk and deleting database rows in a transaction.',
        ownedPaths: 'server/storage/deletionService.ts',
        fact: 'Fact 1: Deletion service cascades removal across disk and database'
      },
      {
        task: 'Task 2: Automated Retention and Garbage Collection Daemon',
        description: 'Implement background job cleaning temporary raster caches and expired exports older than retention window.',
        ownedPaths: 'server/storage/retentionDaemon.ts',
        fact: 'Fact 2: Retention daemon purges expired temporary artifacts'
      },
      {
        task: 'Task 3: Document Deletion API Endpoint',
        description: 'Implement DELETE /api/documents/:id with authentication and ownership authorization.',
        ownedPaths: 'server/routes/deletionRoutes.ts',
        fact: 'Fact 3: Deletion endpoint enforces ownership and records tombstone'
      },
      {
        task: 'Task 4: Full Data Lifecycle and Deletion Test Suite',
        description: 'Author automated tests verifying complete file removal, zero disk orphans, and tombstone audit.',
        ownedPaths: 'tests/stage34Lifecycle.test.mjs',
        fact: 'Fact 4: Data lifecycle and deletion test suite passes'
      }
    ],
    contractsToFreeze: `export interface DeletionResult {
  documentId: string;
  deletedAt: string;
  deletedBy: string;
  filesUnlinked: string[];
  databaseRowsDeleted: number;
  tombstoneId: string;
}

export interface RetentionPolicyConfig {
  tempRasterExpiryHours: number; // 24
  exportFileExpiryHours: number; // 72
  auditLogRetentionDays: number; // 365
}`,
    fanOut: {
      archetype: 'Archetype H (Data Lifecycle and Secure Deletion)',
      lanes: [
        { lane: 'Lane 1', role: 'impl-lane', mode: 'CODE', ownedPaths: 'server/storage/deletionService.ts,server/storage/retentionDaemon.ts', deliverable: 'Deletion service and retention daemon' },
        { lane: 'Lane 2', role: 'impl-lane', mode: 'CODE', ownedPaths: 'server/routes/deletionRoutes.ts', deliverable: 'DELETE API routes' },
        { lane: 'Lane 3', role: 'test-author', mode: 'CODE', ownedPaths: 'tests/stage34Lifecycle.test.mjs', deliverable: 'Data lifecycle test suite' }
      ],
      sharedFiles: 'None'
    },
    acceptanceEvidence: [
      { fact: 'Fact 1: Deletion service cascades removal across disk and database', command: 'node -e "assert(fs.existsSync(\'server/storage/deletionService.ts\'))"', expectedOutcome: 'Service unlinks original file, preview, and removes database rows', status: 'pending', evidencePath: 'automation/runs/stage-34/service-audit.json' },
      { fact: 'Fact 2: Retention daemon purges expired temporary artifacts', command: 'node --test tests/stage34Lifecycle.test.mjs', expectedOutcome: 'Temporary files older than 24h deleted automatically', status: 'pending', evidencePath: 'automation/runs/stage-34/daemon-audit.json' },
      { fact: 'Fact 3: Deletion endpoint enforces ownership and records tombstone', command: 'node --test tests/stage34Lifecycle.test.mjs', expectedOutcome: 'DELETE returns 200 and records tombstone row', status: 'pending', evidencePath: 'automation/runs/stage-34/endpoint-audit.json' },
      { fact: 'Fact 4: Data lifecycle and deletion test suite passes', command: 'node --test tests/stage34Lifecycle.test.mjs', expectedOutcome: 'All lifecycle and deletion tests exit 0', status: 'pending', evidencePath: 'automation/runs/stage-34/test-summary.json' }
    ],
    tests: {
      negative: [
        'Attempting to delete document owned by another user returns 403 Forbidden.',
        'Requesting download of deleted document returns 404 Not Found.'
      ],
      boundary: [
        'File exactly at retention boundary (24h 0m 0s) retained; 24h 0m 1s purged.',
        'Deleting document with 0 extracted fields completes cleanly.'
      ],
      interruption: [
        'Failure during database deletion leaves file intact for retry (transactional safety).',
        'Interrupted deletion daemon resumes from last inspected directory.'
      ],
      security: [
        'Deleted file contents cannot be recovered via application endpoints.',
        'Tombstone records contain only hash and ID, zero customer names or values.'
      ]
    },
    dependencies: {
      upstream: [
        'Stage 15 (Private original storage): Files to unlink managed by storage service.',
        'Stage 28 (Safe consistent exports): Exports purged by retention daemon.'
      ],
      downstream: [
        'Stage 35 (Pre-pilot security closure): Verifies privacy deletion guarantees.',
        'Stage 41 (Tested backup/restore/rollback): Backup restoration respects deletion tombstones.',
        'Stage 51 (Privacy/contracts/claims alignment): Aligns with legal right-to-be-forgotten.'
      ]
    },
    externalGates: {
      blocker: 'None',
      harness: 'Automated test suite creating files on disk, triggering deletion, and asserting fs.existsSync === false',
      signoff: 'None'
    },
    risksAndDefects: {
      risks: [
        'Risk 1: Disk permission errors preventing file unlinking.'
      ],
      defects: [
        'Known defect 1: No file deletion logic exists anywhere in current codebase.'
      ]
    },
    completionDraft: {
      s0: 'Audit storage locations and temporary file directories.',
      s1: 'Draft deletion cascade sequence and tombstone schema.',
      s2: 'Author `deletionService.ts`, `retentionDaemon.ts`, routes, and tests.',
      s3: 'Execute lifecycle test suite via `npm test`.',
      s4: 'Independent review audits complete unlinking and tombstone privacy.',
      s5: 'Tune retention daemon sweep intervals.',
      s6: 'Stage-exit checklist verification.',
      s7: 'Record promotion evidence.',
      s8: 'Advance to Stage 35.'
    }
  },

  35: {
    weightArea: 'security',
    externalGates: [],
    verifiedState: [
      '- `PROJECT_CHARTER.md:147-148`: Threat-model identity, files/previews, network destinations, secrets, worker privileges, and external data sharing. No known critical/high exploitable issue in enabled scope.',
      '- Threat model absent: No formal threat model document currently exists for the application architecture.',
      '- Dependency vulnerabilities: Need verified clean output from `npm audit` and static security scanning.',
      '- Network boundary check: Verify that live processing never makes unauthorized outbound network requests.'
    ],
    scope: {
      inScope: [
        'Formal application threat model document (STRIDE / OWASP Top 10 analysis).',
        'Zero critical or high exploitable vulnerabilities in npm and pip dependencies.',
        'Network egress audit: verify zero outbound calls during local OCR and document processing.',
        'Automated security test suite covering path traversal, injection, CSRF, and session fixation.'
      ],
      outOfScope: [
        'External third-party penetration testing (Stage 50).',
        'Hardware-level side-channel attacks.'
      ],
      notPromised: [
        'Formal ISO 27001 / SOC 2 certification.'
      ]
    },
    workBreakdown: [
      {
        task: 'Task 1: System Threat Model and Security Architecture',
        description: 'Author comprehensive threat model analyzing attack surfaces, trust boundaries, and mitigations.',
        ownedPaths: 'docs/stage35/threat-model.md',
        fact: 'Fact 1: Threat model documents attack surfaces and mitigations'
      },
      {
        task: 'Task 2: Dependency Security Audit and Patching',
        description: 'Execute npm audit and dependency scanners; eliminate all critical and high findings.',
        ownedPaths: 'package.json',
        fact: 'Fact 2: Dependency audit confirms zero critical/high vulnerabilities'
      },
      {
        task: 'Task 3: Network Egress and Data Sharing Isolation Test',
        description: 'Verify server and Python worker make zero unauthorized outbound network requests during processing.',
        ownedPaths: 'tests/security/networkIsolation.test.mjs',
        fact: 'Fact 3: Network isolation test confirms zero unauthorized egress'
      },
      {
        task: 'Task 4: Pre-Pilot Security Master Suite',
        description: 'Consolidate security test cases (CSRF, session fixation, input injection, header hardening).',
        ownedPaths: 'tests/stage35Security.test.mjs',
        fact: 'Fact 4: Pre-pilot security test suite passes'
      }
    ],
    contractsToFreeze: `export interface ThreatModelFinding {
  id: string;
  threatType: 'spoofing' | 'tampering' | 'repudiation' | 'info_disclosure' | 'denial_of_service' | 'elevation';
  affectedComponent: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  mitigationStatus: 'mitigated' | 'residual_risk';
  mitigationDetails: string;
}`,
    fanOut: {
      archetype: 'Archetype H (Threat Modeling and Security Closure)',
      lanes: [
        { lane: 'Lane 1', role: 'impl-lane', mode: 'CODE', ownedPaths: 'docs/stage35/**', deliverable: 'Threat model documentation' },
        { lane: 'Lane 2', role: 'test-author', mode: 'CODE', ownedPaths: 'tests/security/**,tests/stage35Security.test.mjs', deliverable: 'Security and network isolation test suites' }
      ],
      sharedFiles: 'package.json'
    },
    acceptanceEvidence: [
      { fact: 'Fact 1: Threat model documents attack surfaces and mitigations', command: 'node -e "assert(fs.existsSync(\'docs/stage35/threat-model.md\'))"', expectedOutcome: 'Threat model covers identity, storage, workers, and network', status: 'pending', evidencePath: 'automation/runs/stage-35/threat-model.json' },
      { fact: 'Fact 2: Dependency audit confirms zero critical/high vulnerabilities', command: 'npm audit --production', expectedOutcome: 'Zero high or critical vulnerabilities reported', status: 'pending', evidencePath: 'automation/runs/stage-35/audit-results.json' },
      { fact: 'Fact 3: Network isolation test confirms zero unauthorized egress', command: 'node --test tests/security/networkIsolation.test.mjs', expectedOutcome: 'Local document processing makes zero outbound TCP requests', status: 'pending', evidencePath: 'automation/runs/stage-35/egress-audit.json' },
      { fact: 'Fact 4: Pre-pilot security test suite passes', command: 'node --test tests/stage35Security.test.mjs', expectedOutcome: 'All security test cases pass with exit code 0', status: 'pending', evidencePath: 'automation/runs/stage-35/test-summary.json' }
    ],
    tests: {
      negative: [
        'Attempted outbound HTTP call from OCR worker process fails or throws network exception.',
        'Request missing CSRF header on mutating endpoints rejected with 403 Forbidden.'
      ],
      boundary: [
        'Content Security Policy (CSP) headers present on all HTML responses.',
        'Strict-Transport-Security and X-Content-Type-Options headers verified.'
      ],
      interruption: [
        'Security scanners execute deterministically across repeated runs.',
        'Network interception proxy detects zero background telemetry calls.'
      ],
      security: [
        'Zero secrets or passwords committed to git history.',
        'All cookie sessions rotated upon login to prevent session fixation.'
      ]
    },
    dependencies: {
      upstream: [
        'Stage 34 (Full data lifecycle): Validates lifecycle data protection.'
      ],
      downstream: [
        'Stage 38 (Full workflow and test-effectiveness checks): Tests security in full flow.',
        'Stage 43 (Evidence-backed pilot gate): Threat model required for pilot gate.',
        'Stage 50 (Independent security assessment): Provides baseline for external pentest.'
      ]
    },
    externalGates: {
      blocker: 'None',
      harness: 'Automated security scan scripts and network socket listener tests',
      signoff: 'None'
    },
    risksAndDefects: {
      risks: [
        'Risk 1: Hidden outbound calls from third-party npm packages.'
      ],
      defects: [
        'Known defect 1: Server lacks Content-Security-Policy headers in production.'
      ]
    },
    completionDraft: {
      s0: 'Audit dependencies and application endpoints for security risks.',
      s1: 'Draft STRIDE threat model and network isolation verification rules.',
      s2: 'Author `threat-model.md`, security middleware, and test suites.',
      s3: 'Execute security test suite via `npm test`.',
      s4: 'Independent review audits threat mitigations and egress restrictions.',
      s5: 'Patch any reported dependency alerts.',
      s6: 'Stage-exit checklist verification.',
      s7: 'Record promotion evidence.',
      s8: 'Advance to Stage 36.'
    }
  },

  36: {
    weightArea: 'extraction-validation',
    externalGates: [],
    verifiedState: [
      '- `PROJECT_CHARTER.md:150-151`: Define metrics for correct/incorrect/missing/extra/wrong-applicant/normalized/reviewed values and verify calculations manually on small examples. Disclose denominators, review/abstention, and statistical uncertainty.',
      '- Benchmark harness missing: No automated pipeline currently evaluates OCR extraction accuracy against annotated ground truth.',
      '- Unsubstantiated claims risk: Accuracy claims cannot be made without reproducible benchmark scripts and statistical confidence intervals (95% CI).'
    ],
    scope: {
      inScope: [
        'Reproducible evaluation benchmark harness: runs document pipeline over annotated corpus (from Stage 8).',
        'Standardized metrics calculation: Exact Match (EM), Normalized Match, Field Precision, Field Recall, F1 Score.',
        'Error breakdown categorization: Missing, Extra, Value Misread, Wrong Applicant, Date Format Error.',
        'Reporting statistical confidence intervals (Wilson score interval / bootstrap CI) per field and layout.'
      ],
      outOfScope: [
        'Tuning algorithms to improve metrics (Stage 37).',
        'Evaluating on frozen held-out evaluation corpus (Stage 42).'
      ],
      notPromised: [
        'Achieving 99% accuracy on uncalibrated initial baseline.'
      ]
    },
    workBreakdown: [
      {
        task: 'Task 1: Benchmark Evaluation Engine Implementation',
        description: 'Implement benchmark runner evaluating extraction output against ground-truth annotations.',
        ownedPaths: 'scripts/benchmark/evaluator.mjs',
        fact: 'Fact 1: Benchmark evaluator computes precision, recall, and error breakdown'
      },
      {
        task: 'Task 2: Statistical Uncertainty and Confidence Interval Calculator',
        description: 'Implement Wilson score confidence interval calculation for field accuracy metrics.',
        ownedPaths: 'scripts/benchmark/confidenceIntervals.mjs',
        fact: 'Fact 2: Statistical module calculates 95% confidence intervals'
      },
      {
        task: 'Task 3: Baseline Quality Benchmark Execution',
        description: 'Execute benchmark over development corpus split and record baseline quality scorecard.',
        ownedPaths: 'docs/stage36/baseline-benchmark.json',
        fact: 'Fact 3: Baseline benchmark report recorded with explicit denominators'
      },
      {
        task: 'Task 4: Benchmark Math and Metric Verification Test Suite',
        description: 'Author unit tests validating metric calculations manually against known 5-field toy examples.',
        ownedPaths: 'tests/stage36Benchmark.test.mjs',
        fact: 'Fact 4: Benchmark calculation test suite passes'
      }
    ],
    contractsToFreeze: `export interface FieldQualityMetric {
  fieldId: string;
  totalInstances: number;
  correctCount: number;
  incorrectCount: number;
  missingCount: number;
  extraCount: number;
  exactMatchRate: number;
  confidenceInterval95: [number, number];
  reviewBurdenRate: number;
}

export interface BenchmarkReport {
  corpusVersion: string;
  evaluatedAt: string;
  documentsEvaluated: number;
  overallPrecision: number;
  overallRecall: number;
  overallF1: number;
  perFieldMetrics: Record<string, FieldQualityMetric>;
}`,
    fanOut: {
      archetype: 'Archetype B (Evaluation Benchmark and Statistical Metrics)',
      lanes: [
        { lane: 'Lane 1', role: 'impl-lane', mode: 'CODE', ownedPaths: 'scripts/benchmark/**', deliverable: 'Benchmark evaluator and confidence calculator' },
        { lane: 'Lane 2', role: 'test-author', mode: 'CODE', ownedPaths: 'tests/stage36Benchmark.test.mjs', deliverable: 'Metric calculation verification tests' }
      ],
      sharedFiles: 'None'
    },
    acceptanceEvidence: [
      { fact: 'Fact 1: Benchmark evaluator computes precision, recall, and error breakdown', command: 'node -e "assert(fs.existsSync(\'scripts/benchmark/evaluator.mjs\'))"', expectedOutcome: 'Evaluator script parses annotations and outputs metrics', status: 'pending', evidencePath: 'automation/runs/stage-36/evaluator-audit.json' },
      { fact: 'Fact 2: Statistical module calculates 95% confidence intervals', command: 'node -e "assert(fs.existsSync(\'scripts/benchmark/confidenceIntervals.mjs\'))"', expectedOutcome: 'Confidence interval calculation verified mathematically', status: 'pending', evidencePath: 'automation/runs/stage-36/ci-audit.json' },
      { fact: 'Fact 3: Baseline benchmark report recorded with explicit denominators', command: 'node -e "assert(fs.existsSync(\'docs/stage36/baseline-benchmark.json\'))"', expectedOutcome: 'Baseline report discloses exact denominators and counts', status: 'pending', evidencePath: 'automation/runs/stage-36/report-audit.json' },
      { fact: 'Fact 4: Benchmark calculation test suite passes', command: 'node --test tests/stage36Benchmark.test.mjs', expectedOutcome: 'Metric math tests pass with manual toy verification', status: 'pending', evidencePath: 'automation/runs/stage-36/test-summary.json' }
    ],
    tests: {
      negative: [
        'Empty ground truth annotation throws explicit InvalidAnnotationError.',
        'Mismatched field IDs between corpus and results reported as missing_field error.'
      ],
      boundary: [
        'Toy example: 4 correct out of 5 yields exactly 80.0% accuracy with known Wilson CI.',
        'Document with 0 matches yields 0.0% precision without division-by-zero crash.'
      ],
      interruption: [
        'Benchmark execution is deterministic; re-running on same corpus produces identical numbers.',
        'Evaluation aborts cleanly on corrupt test document without hanging.'
      ],
      security: [
        'Benchmark reports do not expose customer PII values in diff logs.',
        'Evaluation artifacts saved in structured JSON under versioned paths.'
      ]
    },
    dependencies: {
      upstream: [
        'Stage 8 (Governed evaluation corpus): Provides development corpus and ground truth.',
        'Stage 21 (Immutable extraction evidence): Extraction results consumed by benchmark.',
        'Stage 31 (Evidence-driven extra passes): Evaluates multi-pass results.'
      ],
      downstream: [
        'Stage 37 (Development-only quality improvement): Uses benchmark to guide tuning.',
        'Stage 42 (Frozen independent evaluation/pilot): Uses benchmark protocol on held-out split.'
      ]
    },
    externalGates: {
      blocker: 'None',
      harness: 'Automated benchmark script executing against development corpus split',
      signoff: 'None'
    },
    risksAndDefects: {
      risks: [
        'Risk 1: Small sample sizes producing wide confidence intervals.'
      ],
      defects: [
        'Known defect 1: No accuracy benchmark has ever been run on this repository.'
      ]
    },
    completionDraft: {
      s0: 'Audit ground truth corpus annotations from Stage 8.',
      s1: 'Draft metric definitions and statistical confidence formulas.',
      s2: 'Author `evaluator.mjs`, `confidenceIntervals.mjs`, run benchmark, and write tests.',
      s3: 'Execute benchmark math test suite via `npm test`.',
      s4: 'Independent review audits calculation math against manual calculations.',
      s5: 'Record baseline benchmark report.',
      s6: 'Stage-exit checklist verification.',
      s7: 'Record promotion evidence.',
      s8: 'Advance to Stage 37.'
    }
  },

  37: {
    weightArea: 'extraction-validation',
    externalGates: [],
    verifiedState: [
      '- `PROJECT_CHARTER.md:153-154`: Tune routing/preprocessing/matching/normalization/review thresholds on development data, recording versions and regressions. Measured critical-field quality and review burden meet scope gates without contaminating held-out evaluation.',
      '- Development data constraint: Tuning must strictly operate on development corpus split; held-out evaluation split must remain untouched.',
      '- Regression tracking: Need automated comparison confirming tuning improved target fields without breaking previously passing fields.'
    ],
    scope: {
      inScope: [
        'Parameter tuning: regex word boundary adjustments, OCR image thresholding, applicant scoping proximity.',
        'Threshold calibration: calibrate review suggestion threshold (e.g. fields < 0.85 require review).',
        'Targeted accuracy improvement: achieve >= 95% match rate on critical required banking fields on dev split.',
        'Contamination prevention: held-out evaluation split remains strictly unread and unmodified.'
      ],
      outOfScope: [
        'Touching held-out evaluation dataset (Stage 42).',
        'Arbitrary ad-hoc over-fitting to individual document idiosyncrasies.'
      ],
      notPromised: [
        '100% extraction accuracy on degraded or rotated handwritten inputs.'
      ]
    },
    workBreakdown: [
      {
        task: 'Task 1: Extraction Parameter and Preprocessing Tuning',
        description: 'Optimize regex word boundaries and image contrast enhancement based on dev error analysis.',
        ownedPaths: 'src/data/fields/index.ts,server/ocr/preprocessingTuner.ts',
        fact: 'Fact 1: Tuned parameters improve extraction accuracy on dev corpus'
      },
      {
        task: 'Task 2: Review Threshold Calibration',
        description: 'Calibrate confidence thresholds to balance operator review burden against extraction precision.',
        ownedPaths: 'server/ocr/thresholdConfig.ts',
        fact: 'Fact 2: Review thresholds calibrated to minimize review burden'
      },
      {
        task: 'Task 3: Post-Tuning Quality Benchmark Execution',
        description: 'Re-run benchmark on development split and generate comparative progress scorecard.',
        ownedPaths: 'docs/stage37/tuned-benchmark.json',
        fact: 'Fact 3: Post-tuning benchmark proves measured improvement'
      },
      {
        task: 'Task 4: Non-Contamination and Regression Test Suite',
        description: 'Author automated tests proving zero access to held-out split and confirming zero regressions on past test cases.',
        ownedPaths: 'tests/stage37Tuning.test.mjs',
        fact: 'Fact 4: Tuning test suite confirms zero regression and zero contamination'
      }
    ],
    contractsToFreeze: `export interface TuningRecord {
  iteration: number;
  tunedParameters: Record<string, any>;
  devCorpusScore: { precision: number; recall: number; f1: number };
  criticalFieldAccuracy: number;
  reviewBurdenReductionPercent: number;
  heldOutContaminated: false;
}`,
    fanOut: {
      archetype: 'Archetype D (Parameter Tuning and Metric Optimization)',
      lanes: [
        { lane: 'Lane 1', role: 'impl-lane', mode: 'CODE', ownedPaths: 'src/data/fields/**,server/ocr/preprocessingTuner.ts', deliverable: 'Tuned regex and image parameters' },
        { lane: 'Lane 2', role: 'impl-lane', mode: 'CODE', ownedPaths: 'server/ocr/thresholdConfig.ts', deliverable: 'Calibrated threshold configuration' },
        { lane: 'Lane 3', role: 'test-author', mode: 'CODE', ownedPaths: 'tests/stage37Tuning.test.mjs', deliverable: 'Regression and non-contamination test suite' }
      ],
      sharedFiles: 'None'
    },
    acceptanceEvidence: [
      { fact: 'Fact 1: Tuned parameters improve extraction accuracy on dev corpus', command: 'node -e "assert(fs.existsSync(\'server/ocr/preprocessingTuner.ts\'))"', expectedOutcome: 'Tuning parameters demonstrate higher extraction score', status: 'pending', evidencePath: 'automation/runs/stage-37/tuning-audit.json' },
      { fact: 'Fact 2: Review thresholds calibrated to minimize review burden', command: 'node -e "assert(fs.existsSync(\'server/ocr/thresholdConfig.ts\'))"', expectedOutcome: 'Review threshold configuration calibrated and documented', status: 'pending', evidencePath: 'automation/runs/stage-37/threshold-audit.json' },
      { fact: 'Fact 3: Post-tuning benchmark proves measured improvement', command: 'node -e "assert(fs.existsSync(\'docs/stage37/tuned-benchmark.json\'))"', expectedOutcome: 'Tuned benchmark exceeds baseline accuracy metrics', status: 'pending', evidencePath: 'automation/runs/stage-37/comparison-audit.json' },
      { fact: 'Fact 4: Tuning test suite confirms zero regression and zero contamination', command: 'node --test tests/stage37Tuning.test.mjs', expectedOutcome: 'All regression tests pass; held-out checksum unchanged', status: 'pending', evidencePath: 'automation/runs/stage-37/test-summary.json' }
    ],
    tests: {
      negative: [
        'Attempting to read from held-out evaluation corpus folder during tuning throws ContaminationError.',
        'Tuning modification that breaks an existing Stage 9/10 test fails pipeline immediately.'
      ],
      boundary: [
        'Critical required fields (BSB, Account Number, Applicant Name) reach >= 95% accuracy on dev split.',
        'Review burden reduced by at least 15% compared to untuned baseline.'
      ],
      interruption: [
        'Tuned parameter configuration is versioned and reproducible.',
        'Reverting tuning configuration restores baseline behavior exactly.'
      ],
      security: [
        'Tuned regex rules checked against ReDoS with maximum input lengths.',
        'Zero hardcoded customer specific values in regex dictionaries.'
      ]
    },
    dependencies: {
      upstream: [
        'Stage 10 (Correct extraction defects): Base field extractor.',
        'Stage 31 (Evidence-driven extra passes): Multi-pass extraction.',
        'Stage 36 (Reproducible quality benchmark): Benchmark pipeline.'
      ],
      downstream: [
        'Stage 38 (Full workflow and test-effectiveness checks): Validates tuned system in E2E tests.',
        'Stage 42 (Frozen independent evaluation/pilot): Evaluates frozen tuned system on held-out split.'
      ]
    },
    externalGates: {
      blocker: 'None',
      harness: 'Automated test asserting dev accuracy improvement and held-out file immutability',
      signoff: 'None'
    },
    risksAndDefects: {
      risks: [
        'Risk 1: Overfitting to development corpus peculiarities.'
      ],
      defects: [
        'Known defect 1: Extraction thresholds currently use hardcoded arbitrary constant (0.6).'
      ]
    },
    completionDraft: {
      s0: 'Audit baseline benchmark error breakdown from Stage 36.',
      s1: 'Draft parameter tuning plan focusing on top 5 error categories.',
      s2: 'Tune regexes, image filters, `thresholdConfig.ts`, re-run benchmark, and write tests.',
      s3: 'Execute tuning regression test suite via `npm test`.',
      s4: 'Independent review verifies zero contamination of held-out evaluation corpus.',
      s5: 'Freeze tuned parameters.',
      s6: 'Stage-exit checklist verification.',
      s7: 'Record promotion evidence.',
      s8: 'Advance to Stage 38.'
    }
  }
};

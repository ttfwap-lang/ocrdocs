# Authoritative Storage Boundaries and Contracts

## 1. Overview

This document specifies the authoritative contracts and boundaries between system components, formalizing the interface contracts across SQLite, disk storage, memory structures, and worker processes.

In accordance with `PROJECT_CHARTER.md:28` (Architecture Invariant 5), in-memory event buses (e.g. `EventEmitter`) are strictly ephemeral. **SQLite is the sole authoritative source of truth for jobs, documents, leases, and review outcomes.**

---

## 2. Frozen TypeScript Contracts

```typescript
/** Canonical job lifecycle states */
export type JobStatus =
  | 'pending'
  | 'claimed'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled';

/** Failure triggers recognized by the system */
export type FailureTrigger =
  | 'worker_timeout'
  | 'worker_crash'
  | 'server_restart'
  | 'db_busy'
  | 'upload_interrupted'
  | 'storage_failure'
  | 'partial_commits';

/** Required cleanup actions on failure */
export type CleanupAction =
  | 'unlink_partial'
  | 'requeue_job'
  | 'mark_poison'
  | 'rollback_tx'
  | 'reclaim_expired_lease';

/** Specification for a failure transition */
export interface FailureTransition {
  currentState: JobStatus;
  failureTrigger: FailureTrigger;
  nextState: JobStatus;
  retryAllowed: boolean;
  leaseReclaimSec: number;
  cleanupAction: CleanupAction;
}

/** Durable job lease contract enforced in SQLite */
export interface JobLeaseContract {
  jobId: string;
  documentId: string;
  workerId: string;
  leaseToken: string;
  leaseAcquiredAt: number;
  leaseExpiresAt: number;
  heartbeatIntervalSec: number;
  attemptNumber: number;
  maxAttempts: number;
}

/** Storage consistency contract */
export interface StorageConsistencyContract {
  storageRoot: string; // 'storage/private/'
  journalMode: 'WAL';
  synchronous: 'NORMAL' | 'FULL';
  busyTimeoutMs: number; // 5000
  atomicBlobNaming: 'sha256';
  quarantineDirectory: string; // 'storage/private/quarantine/'
}

/** Startup crash-recovery reconciliation contract */
export interface ReconciliationContract {
  reconcileOrphanedLeases(nowTimestamp: number): Promise<{
    reclaimedCount: number;
    quarantinedCount: number;
    cancelledUploadsCount: number;
  }>;
}
```

---

## 3. Authoritative Relational Schema (SQLite WAL)

The following relational tables represent the durable state contracts implemented in Stage 12:

### 3.1 `documents` Table
```sql
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  sha256 TEXT NOT NULL UNIQUE,
  storage_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size_bytes INTEGER NOT NULL,
  applicant_id TEXT,
  applicant_role TEXT CHECK(applicant_role IN ('primary', 'secondary', 'guarantor', 'ambiguous')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_documents_sha256 ON documents(sha256);
```

### 3.2 `ocr_jobs` Table
```sql
CREATE TABLE IF NOT EXISTS ocr_jobs (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('pending', 'claimed', 'processing', 'completed', 'failed', 'cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  worker_id TEXT,
  lease_token TEXT,
  lease_expires_at INTEGER,
  last_heartbeat_at INTEGER,
  error_code TEXT,
  error_message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ocr_jobs_status_lease ON ocr_jobs(status, lease_expires_at);
```

### 3.3 `extracted_fields` Table
```sql
CREATE TABLE IF NOT EXISTS extracted_fields (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES ocr_jobs(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  field_id TEXT NOT NULL,
  extracted_value TEXT,
  raw_value TEXT NOT NULL,
  confidence REAL NOT NULL,
  bounding_box JSON,
  page_number INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('matched', 'missing', 'ambiguous', 'reviewed_approved', 'reviewed_corrected')),
  reviewed_by TEXT,
  reviewed_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_extracted_fields_job ON extracted_fields(job_id);
```

### 3.4 `audit_log` Table
```sql
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  previous_state JSON,
  new_state JSON,
  timestamp INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id);
```

---

## 4. Identity Boundaries

1. **Organization Boundary:**
   - Single-organization tenant model.
   - All documents, jobs, and audit logs share a secure local administrative namespace.
2. **Applicant Attribution Boundary:**
   - Explicit distinction between:
     - `primary`: Principal loan or account applicant.
     - `secondary`: Co-borrower or joint applicant.
     - `guarantor`: Third-party financial guarantor.
     - `ambiguous`: Document contains fields not attributable without human-in-the-loop review.
   - Per `PROJECT_CHARTER.md:48-49`, applicant attribution is never inferred when ambiguous.

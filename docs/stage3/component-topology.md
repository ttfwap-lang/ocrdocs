# System Component Topology and Architecture Model

## 1. Overview

This document specifies the authoritative architectural topology, process boundaries, data flows, and storage consistency model for the `ocrdocs` banking document processing system, fulfilling the Stage 3 charter requirements of `PROJECT_CHARTER.md:24-35`.

The system is architected as a **single-organization, self-hosted processing system** prioritizing transactional durability, data sovereignty, strict applicant data isolation, and crash-resilient job execution.

---

## 2. Component Topology & Process Boundaries

```
+---------------------------------------------------------------------------------+
|                                 USER BROWSER                                    |
|  +---------------------------------------------------------------------------+  |
|  |             React 19 SPA (Vite Client, TailwindCSS, TypeScript)           |  |
|  |   - Document Upload Studio & Drag-and-Drop Intake                         |  |
|  |   - Human-in-the-Loop Review & Field Correction Workbench                 |  |
|  |   - Server-Sent Events (SSE) Real-Time Job Progress Listener              |  |
|  +---------------------------------------------------------------------------+  |
+--------------------------------------▲------------------------------------------+
                                       │ HTTPS / SSE
                                       ▼
+---------------------------------------------------------------------------------+
|                           NODE.JS RUNTIME HOST                                  |
|  +---------------------------------------------------------------------------+  |
|  |            Express.js API Gateway & Job Orchestrator (Node 20+)           |  |
|  |   - REST API Intake Endpoints (/api/process-document, /api/documents)     |  |
|  |   - Streaming SSE Progress Dispatcher (/api/process-document/stream/:id)  |  |
|  |   - Transactional Job Scheduler & Lease Monitor                           |  |
|  |   - Crash Recovery & Orphaned Lease Reconciler                            |  |
|  +---------------------------▲-------------------------▲---------------------+  |
|                              │                         │                        |
|       Synchronous SQLite WAL │ IPC Stdin/Stdout Pipe   │ File Stream (AES-256)  |
|                              ▼                         ▼                        |
|  +-----------------------------+  +------------------------------------------+  |
|  |      SQLite 3 Engine        |  |     Private Encrypted Storage Store      |  |
|  |   - WAL Journal Mode        |  |   - Root: storage/private/               |  |
|  |   - Busy Timeout: 5000ms    |  |   - SHA-256 Content-Addressed Blobs      |  |
|  |   - Authoritative Job Store |  |   - Atomic Multi-Part Write & Rollback   |  |
|  +-----------------------------+  +------------------------------------------+  |
|                              ▲                                                  |
|                              │ Lease Heartbeat / Result Writes                  |
+------------------------------┼--------------------------------------------------+
                               │
                               ▼ Subprocess Execution (Bounded Timeout)
+---------------------------------------------------------------------------------+
|                          ISOLATED PYTHON WORKER HOST                            |
|  +---------------------------------------------------------------------------+  |
|  |             OCR Spark Engine Worker (scripts/ocr_spark_engine.py)         |  |
|  |   - PyTorch / PaddleOCR / EasyOCR Optical Character Recognition           |  |
|  |   - Bounded Execution Timeout (300 seconds default lease)                 |  |
|  |   - Periodic IPC Heartbeat Emission to prevent lease reclaim              |  |
|  |   - Zero Network Ingress / Isolated Execution Context                     |  |
|  +---------------------------------------------------------------------------+  |
+---------------------------------------------------------------------------------+
```

---

## 3. Communication Protocols & IPC Mechanisms

### 3.1 Client to Express Gateway
- **Ingress Protocol:** HTTPS REST API (`multipart/form-data` for raw document streams; `application/json` for metadata and review overrides).
- **Progress Protocol:** Server-Sent Events (SSE) streaming unidirectional events (`job:started`, `job:page_progress`, `job:extracted`, `job:failed`).
- **Resilience:** SSE stream reconnects automatically using standard EventSource `Last-Event-ID`; server resumes from durable event sequence recorded in SQLite.

### 3.2 Express Gateway to SQLite Engine
- **Binding:** Synchronous in-process native bindings (`better-sqlite3` or `sqlite3` driver).
- **Concurrency & Locking:** Write-Ahead Logging (`PRAGMA journal_mode = WAL;`) enables concurrent readers without blocking writes.
- **Lock Contention:** Configured busy timeout (`PRAGMA busy_timeout = 5000;`) prevents transient `SQLITE_BUSY` errors during concurrent bursts.

### 3.3 Express Gateway to Python OCR Worker
- **IPC Mechanism:** Child process spawned with standard pipes (`stdin`, `stdout`, `stderr`).
- **Payload Format:** JSON-RPC over line-delimited JSON or explicit byte streams.
- **Heartbeat & Liveness:** Worker reports heartbeat timestamps every 15 seconds over stdout; orchestrator updates `lease_expires_at` in the SQLite `ocr_jobs` table.
- **Process Isolation:** Worker runs with restricted environment variables, cannot access parent network sockets, and is terminated with `SIGKILL` on lease expiration.

---

## 4. Authoritative vs Ephemeral Data Boundaries

Per `PROJECT_CHARTER.md:28` (Architecture Invariant 5), **in-memory event emitters (`EventEmitter`) or ephemeral RAM structures must NEVER serve as a durable queue or authoritative state store.**

| Layer | Durability Class | Storage Mechanism | Authoritative For | On Process Crash / Restart |
|---|---|---|---|---|
| **Relational Database** | Durable (Authoritative) | SQLite in WAL mode (`database.sqlite`) | Document status, applicant mapping, job states, worker leases, field extractions, audit trails | Fully preserved; journal rolled forward automatically |
| **Blob Storage** | Durable (Authoritative) | Local disk filesystem (`storage/private/`) | Raw document PDFs/images, rendered page bitmaps, raw OCR text dumps | Fully preserved; atomic rename guarantees non-corrupt blobs |
| **Orchestrator Memory** | Ephemeral (Non-Authoritative) | Node.js process heap / RAM | Active SSE connections, in-flight HTTP request buffers | Completely discarded; rebuilt from SQLite on restart |
| **Worker Memory** | Ephemeral (Non-Authoritative) | Python process heap / VRAM | Loaded OCR neural network models, uncommitted page tensors | Completely discarded; uncommitted work re-executed via lease |

---

## 5. Storage Consistency & Commit Semantics

### 5.1 Atomic Multi-Phase Commits
All state modifications crossing component boundaries adhere to strict transactional ordering:
1. **Intake Phase:**
   - Raw stream written to temporary file: `storage/private/temp/{jobId}.upload.tmp`.
   - File integrity verified (SHA-256 hash computed, magic bytes validated, size checked <= 25 MiB).
   - Atomic rename to permanent content-addressed location: `storage/private/blobs/{sha256}.dat`.
   - SQLite transaction opened: `documents` record and `ocr_jobs` record created in a single `BEGIN IMMEDIATE ... COMMIT` block.
2. **Extraction Phase:**
   - Worker claims job atomically: `UPDATE ocr_jobs SET status='claimed', worker_id=?, lease_token=?, lease_expires_at=? WHERE id=? AND status='pending';`.
   - Worker writes extracted field payload to temporary file.
   - Orchestrator receives worker payload and persists results to SQLite `extracted_fields` table within an explicit transaction.
   - Job status atomically updated to `completed`.
3. **Rollback Phase:**
   - If any step fails or times out, the active SQLite transaction is rolled back (`ROLLBACK;`).
   - Temporary storage artifacts (`*.tmp`) are unlinked immediately.
   - Permanent database state remains consistent.

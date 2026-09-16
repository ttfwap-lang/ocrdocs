# OCRDocs — Development Plan

## Project goal
A self-hosted application that imports real banking documents, extracts and validates fields, preserves source evidence, supports human correction and approval, and exports approved results. The app must process a document end-to-end: upload → OCR → extraction → validation → review → export.

## Tech stack
- **Frontend:** React 19 + Vite 6 + Tailwind 4 + TypeScript 5.8
- **Backend:** Express 5 (Node.js, TypeScript)
- **OCR:** Python worker (Tesseract/PaddleOCR/Surya) — to be integrated as child process or ported to TS
- **Database:** SQLite (via better-sqlite3) — to be added
- **Package manager:** npm (bun.lock present; use bun if preferred)
- **Key existing deps:** zod (validation), react-router, lucide-react, Tailwind

## Current state (what's built)
- 30+ Australian banking field definitions with regex matchers
- Section-aware regex matcher engine with proximity weighting, multi-candidate disambiguation, G-NAF address decomposition
- Australian validators: ABN Modulo-89, APRA BSB, postcode state coherency, DOB
- React UI with 7 tabs (Document Studio, Multi-Pass View, Matcher Studio, etc.)
- Express server with health/status/chat/SSE endpoints
- Env validation, graceful shutdown, categorized tests (110+)
- Python OCR worker (757 lines) — complete but disconnected from Node server
- Fixture/sample document data for demo purposes

## What's missing
- No database (env config references `data/app.db` but it doesn't exist)
- No auth (JWT_SECRET in env schema but no middleware)
- No file storage/upload
- No real OCR (all cloud drivers throw ServiceUnavailableError; Python worker disconnected)
- No durable job queue (in-memory EventEmitter only)
- No review workflow, no server-side exports
- No Google Drive integration (returns 501)
- No end-to-end pipeline — app runs entirely on fixture data

## Development phases

### Phase 1: Data Layer & Persistence Foundation
- [ ] Install `better-sqlite3`, create DB init module
- [ ] Write initial schema migration (documents, extractions, fields, jobs, users)
- [ ] Define versioned result contract interfaces (TypeScript types)
- [ ] Create DB connection module with graceful open/close
- [ ] Write repository layer (CRUD for each entity)

### Phase 2: Upload, Storage & Security
- [ ] Install `multer`, create multipart upload middleware
- [ ] Add `jsonwebtoken`, create JWT auth middleware
- [ ] Create private file storage module (integrity hashing, path management)
- [ ] Add upload endpoint to Express server
- [ ] Add auth-protected route wrapper

### Phase 3: OCR Pipeline & Document Processing
- [ ] Install `pdf-parse` for native PDF text extraction
- [ ] Wire Python OCR worker as child process OR port to TypeScript
- [ ] Connect OCR output to existing matcher engine
- [ ] Run matcher → validators → produce structured extraction result
- [ ] Store extraction result in DB

### Phase 4: Durable Jobs & End-to-End Pipeline
- [ ] Replace EventEmitter with SQLite-backed job queue
- [ ] Implement job states: queued → processing → completed/failed
- [ ] Wire end-to-end pipeline: upload → job → OCR → extraction → validation → store
- [ ] Add retry logic and failure recovery
- [ ] Add SSE job status updates to frontend

### Phase 5: Review Workflow & Exports
- [ ] Build document list UI (server-side data, not fixtures)
- [ ] Create review interface (view extraction, correct fields, approve/reject)
- [ ] Add server-side CSV/JSON export endpoints
- [ ] Wire export to approved documents only

### Phase 6: Google Drive & Quality
- [ ] Implement real Drive OAuth flow
- [ ] Add Drive sync (import documents from authorized folders)
- [ ] Add quality benchmarking (compare extraction vs ground truth)
- [ ] Tuning pass (matcher thresholds, OCR config)

### Phase 7: Hardening & Operations
- [ ] Add metrics/monitoring (queue depth, latency, error rates)
- [ ] Add overload protection (rate limiting, backpressure)
- [ ] Data lifecycle (retention, deletion, archival)
- [ ] Staging environment setup
- [ ] Backup/restore/rollback procedure

## Quick wins (start immediately, no dependencies)
1. Add `better-sqlite3` + DB init module (S)
2. Write initial schema migration (M)
3. Define versioned result contract interfaces (M)
4. Add `multer` for multipart upload (S)
5. Add `jsonwebtoken` for JWT auth (S)
6. Wire Python worker as child process or add `tesseract.js` (M)
7. Add `pdf-parse` for PDF text extraction (S)
8. Add edge-case test documents (S)

## Critical path
DB init → Schema → File upload → Upload endpoint → PDF text extraction → OCR engine → Wire OCR+matcher → Durable job queue → End-to-end pipeline → **[WORKING APP]** → Document list UI → Review workflow → Server-side exports → **[COMPLETE CORE APP]**

## Definition of done (un-gated)
The app is done when:
1. It builds without errors (`npm run build`)
2. A user can upload a real banking document (PDF/image)
3. The OCR pipeline extracts text and the matcher produces structured field data
4. Validators flag incorrect extractions
5. The user can review, correct, and approve extracted data
6. Approved data can be exported as CSV/JSON
7. The pipeline runs end-to-end without manual intervention

No external approvals, gates, or evidence requirements are needed. The app works = it's done.

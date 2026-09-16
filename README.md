# OCRDocs

OCRDocs is a local document intake and OCR review app for Australian banking documents. The app server stores uploaded documents in SQLite/private storage, extracts text locally from digital PDFs when possible, and queues scanned PDFs/images for a separate DGX worker that runs the real Python OCR pipeline.

## Run locally

Prerequisites: Node.js 20+ and npm 10+.

```bash
npm install
cp .env.example .env
npm run dev
```

Useful checks:

```bash
npm run lint
npm test
npm run build
```

## Document intake

Use the **Documents** tab to upload files, or call the API directly:

```bash
curl -F "file=@/path/to/document.pdf" http://localhost:3000/api/documents
curl http://localhost:3000/api/documents
```

Digital-text PDFs are extracted on the app server. Scanned PDFs and image files are queued honestly as needing OCR until the DGX worker processes them.

## Bulk-ingest a local folder

```bash
node scripts/ingest_local_folder.mjs /path/to/folder http://localhost:3000
```

The ingester registers files with `POST /api/documents`; it does not depend on Google Drive fixtures or cloud OCR stubs.

## Run the DGX worker

On the app server, set a shared worker token and start the app:

```bash
DGX_WORKER_TOKEN="replace-with-a-shared-secret" HOST=0.0.0.0 npm run dev
```

On the DGX machine, install the Python dependencies and start the pull worker:

```bash
cd scripts
./dgx_setup.sh
export OCRDOCS_SERVER_URL="http://THIS_MACHINE_LAN_ADDRESS:3000"
export DGX_WORKER_TOKEN="replace-with-the-same-shared-secret"
python3 dgx_worker.py
```

`OCRDOCS_SERVER_URL` must be a network address the DGX box can actually reach: this machine's LAN IP, an mDNS `.local` hostname, or a VPN address already routed between the machines. Do not use `localhost` or `127.0.0.1` on the DGX; those point back to the DGX itself. The app server already defaults `HOST=0.0.0.0`, so the server side listens on all interfaces by default.

## Useful endpoints

- `GET /api/health` — server health and worker-token status.
- `GET /api/services/status` — live service availability used by the status bar.
- `GET /api/documents` — registered documents.
- `GET /api/documents/:id` — document details, extraction fields, and jobs.
- `POST /api/worker/jobs/claim` — DGX worker job claim endpoint, protected by `DGX_WORKER_TOKEN`.

## Configuration

See `.env.example` for all consumed environment variables, grouped by app server, DGX worker, and DGX diagnostics scripts.

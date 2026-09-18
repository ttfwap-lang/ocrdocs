# gx10 Deployment & E2E Runbook (owner action)

This is the **owner-side** runbook for the GPU worker that lives on `gx10.local`.
The sandbox that produced this document has **no SSH access to gx10**, so these steps
are documented (not executable here). The server, the worker, and the Python engine
in `scripts/ocr_spark_engine.py` are already aligned; this runbook just activates the
GPU tier on gx10.

## 1. Reach the box

```bash
ssh root@gx10.local
# (also reachable as flak3dd@gx10.local; see ~/.ssh/config alias gx10)
```

Hardware check (should already be present):

```bash
nvidia-smi          # GPU + VRAM. Expect the A100/A40 already configured.
nvidia-smi -L        # GPU count
nvcc --version       # CUDA toolkit
python3 --version    # system python3 (>=3.11)
```

## 2. Deploy the engine

```bash
# The pipeline is synced to /mnt/nvme/ocr_pipeline on gx10 (NVME_ROOT).
export NVME_ROOT=/mnt/nvme/ocr_pipeline
mkdir -p $NVME_ROOT/scripts $NVME_ROOT/storage/private $NVME_ROOT/db
# Pull the engine + deps from the repo into the worker:
cp scripts/ocr_spark_engine.py $NVME_ROOT/scripts/
cp scripts/requirements.txt $NVME_ROOT/scripts/
pip3 install -r $NVME_ROOT/scripts/requirements.txt   # torch(CUDA), surya, easyocr, paddleocr, pytesseract, pypdfium2, python-docx, striprf
```

Enable the GPU-tier engines by exporting the opt-in flags before starting the worker
(these default to `false`; on gx10 set them true):

```bash
export OCRDOCS_ENABLE_RESEARCH_ENGINES=true
export OCRDOCS_ENABLE_HANDWRITING_ENGINE=true
export OCRDOCS_ENGINE_TIMEOUT_SECONDS=60
export NVME_ROOT=/mnt/nvme/ocr_pipeline
```

> `spaCy` is optional — if absent, `given_names`/`family_name`/`employer_details`
> fall back to the regex line-scan (no crash).

## 3. Start the worker (pull model)

The worker **claims** jobs from the server; it does not expose a push endpoint.

```bash
# Acquire the bearer token the server expects (set in server env / .env on gx10):
grep DGX_WORKER_TOKEN /srv/ocrdots/.env   # <- the OWNER fills this (redacted in docs)

# Run the worker process from $NVME_ROOT so db/input/output resolve correctly:
cd $NMVE_ROOT
python3 -m ocr_spark_engine --worker --server https://ocrdocs.local \
  --token "$DGX_WORKER_TOKEN" --gpu
```

The server exposes, for the worker:
`GET /api/jobs/claim`, `GET /api/jobs/:id/file`, `POST /api/jobs/:id/result`,
`POST/GET /api/dgx/telemetry-report` (bearer-guarded), and
`GET /api/scripts/:scriptName` (allow-listed: `dgx_setup.sh`, `ocr_spark_engine.py`,
`deploy.sh`, `check_dgx_codepus.sh`).

## 4. Health + E2E verification (curl)

```bash
# 0) Server + worker both up?
curl -s http://ocrdocs.local/api/health
# Expect JSON containing: engine "ngx-spark-banking-ocr-engine", "dgx_worker live"

# 1) Upload a document (multipart). The upload filter (server/middleware/upload.ts)
#    accepts pdf/png/jpg/tiff/bmp/webp/docx/rtf/xml/txt/json (<=50 MiB). Office
#    binaries .doc/.xls/.ppt/.xlsx are rejected with a clear message.
curl -s -F "file=@recovered_c/statement.png" http://ocrdocs.local/api/documents

# 2) The server persists the file + enqueues a job, then returns:
#    {"document_id": "...", "job_id": "...", "status": "queued"}

# 3) Worker claims & processes (pull model). Poll the job:
curl -s http://ocrdocs.local/api/jobs/$JOB_ID
# -> {"status":"processing"}  then  {"status":"completed"}

# 4) Read results back:
curl -s http://ocrdocs.local/api/jobs/$JOB_ID/result
# -> { "fields": {...60 keys...}, "confidences": {...},
#      "validAbn": true, "validBsb": true, "validDob": true,
#      "engineUsed": "multipass-ensemble", "passes": [ ... ] }

# 5) Or fetch the full resolved document:
curl -s http://ocrdocs.local/api/documents/$DOC_ID
```

## 5. Phase 3 validation on gx10 (owner)

```bash
ssh root@gx10.local
cd /mnt/nvme/ocr_pipeline
OCRDOCS_ENABLE_RESEARCH_ENGINES=true OCRDOCS_ENABLE_HANDWRITING_ENGINE=true \
  python3 automation/phase3_ocr_validation.py
cat automation/runs/phase-3-ocr-validation.json | python3 -m json.tool
# Expect: all_supported_types_ran=true, validators_pass=true (8/8 SUCCESS).
```

## 6. Rollback / stop

```bash
# Stop the worker pool (jobs are lease-based; stale leases are reclaimed server-side),
# then the server:
pkill -f "ocr_spark_engine --worker"
journalctl -fu ocrdocs-server --no-pager   # tail to confirm clean shutdown
```

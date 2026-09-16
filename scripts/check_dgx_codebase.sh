#!/usr/bin/env bash
# ==============================================================================
# Script 4: DGX End-to-End Codebase & Environment Inspector
# Execution Context: Run directly on DGX host (flak3dd@gx10-d0e7) or from any remote
# Purpose:
#   1. Scans existing files, git repo, and scripts in /mnt/nvme/ocr_pipeline and $HOME
#   2. Checks Python virtualenv, CUDA / PyTorch, GPU architecture, and DuckDB
#   3. Packages directory tree, code snippets, file hashes, and error logs into a JSON report
#   4. Sends the payload back to the central AI Studio application server
# ==============================================================================

set -euo pipefail

readonly OCRDOCS_SERVER_URL="${OCRDOCS_SERVER_URL:-}"
readonly REPORT_SERVER_URL="${REPORT_SERVER_URL:-${OCRDOCS_SERVER_URL:+${OCRDOCS_SERVER_URL%/}/api/dgx/telemetry-report}}"
readonly NVME_ROOT="${NVME_ROOT:-/mnt/nvme/ocr_pipeline}"
readonly TIMESTAMP="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
readonly HOSTNAME="$(hostname 2>/dev/null || echo 'unknown-host')"
readonly CURRENT_USER="$(id -un 2>/dev/null || echo 'unknown-user')"

if [[ -z "${REPORT_SERVER_URL}" ]]; then
    echo "[-] REPORT_SERVER_URL or OCRDOCS_SERVER_URL is required to send telemetry to the app server." >&2
    exit 1
fi

echo "=============================================================================="
echo " [DGX-INSPECTOR] End-to-End Existing Codebase & Environment Audit"
echo " Host: ${CURRENT_USER}@${HOSTNAME}"
echo " NVMe Root: ${NVME_ROOT}"
echo " Target Uplink: ${REPORT_SERVER_URL}"
echo "=============================================================================="

# Temporary JSON working file
TMP_REPORT="$(mktemp /tmp/dgx_audit_XXXXXX.json)"
trap 'rm -f "$TMP_REPORT"' EXIT

echo "[*] Step 1: Collecting System & Hardware Hardware Architecture..."
ARCH="$(uname -m 2>/dev/null || echo 'unknown')"
KERNEL="$(uname -r 2>/dev/null || echo 'unknown')"
UPTIME_STR="$(uptime 2>/dev/null || echo 'unknown')"
CPU_MODEL="$(lscpu 2>/dev/null | grep -i "Model name" | head -n 1 | awk -F: '{print $2}' | xargs || echo 'unknown')"
MEM_TOTAL="$(free -h 2>/dev/null | awk '/^Mem:/ {print $2}' || echo 'unknown')"

echo "[*] Step 2: Inspecting NVIDIA GPU & CUDA Acceleration..."
GPU_INFO="None"
NVIDIA_SMI_VERSION="Not installed"
if command -v nvidia-smi >/dev/null 2>&1; then
    NVIDIA_SMI_VERSION="$(nvidia-smi --query-gpu=driver_version --format=csv,noheader 2>/dev/null | head -n 1 || echo 'detected')"
    GPU_INFO="$(nvidia-smi --query-gpu=name,memory.total,memory.free --format=csv,noheader 2>/dev/null || echo 'detected')"
fi

echo "[*] Step 3: Checking NVMe Root Directory Structure (${NVME_ROOT})..."
NVME_EXISTS=false
NVME_PERMS="none"
TREE_OUTPUT="Directory does not exist"
INPUT_FILES_COUNT=0
OUTPUT_FILES_COUNT=0
LOGS_FILES_COUNT=0
DB_EXISTS=false
VENV_EXISTS=false

if [[ -d "$NVME_ROOT" ]]; then
    NVME_EXISTS=true
    NVME_PERMS="$(ls -ld "$NVME_ROOT" | awk '{print $1, $3, $4}')"
    TREE_OUTPUT="$(find "$NVME_ROOT" -maxdepth 3 -printf "%M %u %g %s %p\n" 2>/dev/null | head -n 60 || echo 'failed to list')"
    INPUT_FILES_COUNT="$(find "${NVME_ROOT}/input" -type f 2>/dev/null | wc -l || echo 0)"
    OUTPUT_FILES_COUNT="$(find "${NVME_ROOT}/output" -type f 2>/dev/null | wc -l || echo 0)"
    LOGS_FILES_COUNT="$(find "${NVME_ROOT}/logs" -type f 2>/dev/null | wc -l || echo 0)"
    if [[ -f "${NVME_ROOT}/db/identity_index.duckdb" ]]; then
        DB_EXISTS=true
    fi
    if [[ -f "${NVME_ROOT}/venv/bin/activate" ]]; then
        VENV_EXISTS=true
    fi
fi

echo "[*] Step 4: Scanning Codebase Files & Checksums..."
EXISTING_CODE_FILES="[]"
PY_ENGINE_SNIPPET=""
PY_ENGINE_CHECKSUM="none"
if [[ -f "${NVME_ROOT}/ocr_spark_engine.py" ]]; then
    PY_ENGINE_CHECKSUM="$(sha256sum "${NVME_ROOT}/ocr_spark_engine.py" 2>/dev/null | awk '{print $1}')"
    PY_ENGINE_SNIPPET="$(head -n 40 "${NVME_ROOT}/ocr_spark_engine.py" 2>/dev/null || echo '')"
fi

# Search for any other ocr or spark python files in HOME or /mnt
SEARCH_SCRIPTS="$(find "$HOME" "$NVME_ROOT" -maxdepth 3 -name "*.py" -o -name "*.sh" 2>/dev/null | head -n 25 || echo '')"

echo "[*] Step 5: Checking Python Virtualenv Packages & PyTorch..."
VENV_PYTHON="${NVME_ROOT}/venv/bin/python3"
PY_DIAGNOSTICS="{}"
if [[ -x "$VENV_PYTHON" ]]; then
    echo "[*] Running diagnostic probe inside virtual environment..."
    PY_DIAGNOSTICS="$("$VENV_PYTHON" -c '
import sys, json
diag = {
    "python_version": sys.version.split()[0],
    "torch_version": None,
    "cuda_available": False,
    "cuda_device": None,
    "vram_total_gb": None,
    "tesseract_available": False,
    "paddleocr_available": False,
    "easyocr_available": False,
    "surya_available": False,
    "spacy_available": False,
    "spacy_en_model": False,
    "duckdb_version": None,
    "docx_available": False,
    "striprtf_available": False,
}

try:
    import torch
    diag["torch_version"] = torch.__version__
    diag["cuda_available"] = torch.cuda.is_available()
    if torch.cuda.is_available():
        diag["cuda_device"] = torch.cuda.get_device_name(0)
        diag["vram_total_gb"] = round(torch.cuda.get_device_properties(0).total_memory / (1024**3), 2)
except Exception as e:
    diag["torch_err"] = str(e)

try:
    import pytesseract
    pytesseract.get_tesseract_version()
    diag["tesseract_available"] = True
except Exception:
    pass

try:
    import paddleocr
    diag["paddleocr_available"] = True
except Exception:
    pass

try:
    import easyocr
    diag["easyocr_available"] = True
except Exception:
    pass

try:
    import surya
    diag["surya_available"] = True
except Exception:
    pass

try:
    import spacy
    diag["spacy_available"] = True
    try:
        spacy.load("en_core_web_sm")
        diag["spacy_en_model"] = True
    except Exception:
        diag["spacy_en_model"] = False
except Exception:
    pass

try:
    import duckdb
    diag["duckdb_version"] = duckdb.__version__
except Exception:
    pass

try:
    import docx
    diag["docx_available"] = True
except Exception:
    pass

try:
    from striprtf.striprtf import rtf_to_text
    diag["striprtf_available"] = True
except Exception:
    pass

print(json.dumps(diag))
' 2>/dev/null || echo '{"error": "Failed to run python diagnostics"}')"
else
    PY_DIAGNOSTICS='{"status": "venv_missing", "path": "'"${VENV_PYTHON}"'"}'
fi

echo "[*] Step 6: Extracting Recent Error Logs..."
RECENT_ERRORS="No log file found"
if [[ -f "${NVME_ROOT}/logs/pipeline_errors.log" ]]; then
    RECENT_ERRORS="$(tail -n 35 "${NVME_ROOT}/logs/pipeline_errors.log" 2>/dev/null || echo '')"
fi

echo "[*] Step 7: Checking Existing Input Files from Local or Worker Ingestion..."
SAMPLE_INPUT_FILES="$(find "${NVME_ROOT}/input" -type f 2>/dev/null | head -n 15 || echo '')"

# Assemble Payload via Python for valid JSON formatting
python3 -c '
import json, sys, os

data = {
    "timestamp": sys.argv[1],
    "hostname": sys.argv[2],
    "currentUser": sys.argv[3],
    "architecture": sys.argv[4],
    "kernel": sys.argv[5],
    "cpuModel": sys.argv[6],
    "memoryTotal": sys.argv[7],
    "gpuInfo": sys.argv[8],
    "nvidiaDriver": sys.argv[9],
    "nvmeRoot": sys.argv[10],
    "nvmeExists": sys.argv[11] == "true",
    "nvmePermissions": sys.argv[12],
    "treeOutput": sys.argv[13],
    "inputFilesCount": int(sys.argv[14] or 0),
    "outputFilesCount": int(sys.argv[15] or 0),
    "logsFilesCount": int(sys.argv[16] or 0),
    "dbExists": sys.argv[17] == "true",
    "venvExists": sys.argv[18] == "true",
    "engineChecksum": sys.argv[19],
    "engineSnippet": sys.argv[20],
    "discoveredScripts": sys.argv[21].strip().split("\n") if sys.argv[21].strip() else [],
    "pythonDiagnostics": json.loads(sys.argv[22]) if sys.argv[22].startswith("{") else {"raw": sys.argv[22]},
    "recentErrors": sys.argv[23],
    "sampleInputFiles": sys.argv[24].strip().split("\n") if sys.argv[24].strip() else []
}

with open(sys.argv[25], "w") as f:
    json.dump(data, f, indent=2)
' \
    "$TIMESTAMP" \
    "$HOSTNAME" \
    "$CURRENT_USER" \
    "$ARCH" \
    "$KERNEL" \
    "$CPU_MODEL" \
    "$MEM_TOTAL" \
    "$GPU_INFO" \
    "$NVIDIA_SMI_VERSION" \
    "$NVME_ROOT" \
    "$NVME_EXISTS" \
    "$NVME_PERMS" \
    "$TREE_OUTPUT" \
    "$INPUT_FILES_COUNT" \
    "$OUTPUT_FILES_COUNT" \
    "$LOGS_FILES_COUNT" \
    "$DB_EXISTS" \
    "$VENV_EXISTS" \
    "$PY_ENGINE_CHECKSUM" \
    "$PY_ENGINE_SNIPPET" \
    "$SEARCH_SCRIPTS" \
    "$PY_DIAGNOSTICS" \
    "$RECENT_ERRORS" \
    "$SAMPLE_INPUT_FILES" \
    "$TMP_REPORT"

echo "=============================================================================="
echo "[+] Local E2E Audit Report compiled successfully ($(wc -c < "$TMP_REPORT") bytes)."
echo "=============================================================================="
cat "$TMP_REPORT" | head -n 35
echo "..."

echo ""
echo "[*] Step 8: Transmitting Audit Report to Server: ${REPORT_SERVER_URL}..."
HTTP_CODE="$(curl -s -o /tmp/dgx_uplink_resp.json -w "%{http_code}" -X POST "${REPORT_SERVER_URL}" \
    -H "Content-Type: application/json" \
    --data-binary @"$TMP_REPORT" || echo "failed")"

if [[ "$HTTP_CODE" == "200" || "$HTTP_CODE" == "201" ]]; then
    echo "[+] UPLINK SUCCESSFUL! Response Code: ${HTTP_CODE}"
    echo "[+] Server Acknowledgment:"
    cat /tmp/dgx_uplink_resp.json 2>/dev/null || true
    echo ""
    echo "[+] Audit telemetry successfully indexed in Remix Engine Applet!"
else
    echo "[-] Uplink returned code: ${HTTP_CODE}."
    echo "[!] Saved report locally to: ${NVME_ROOT}/logs/e2e_codebase_audit_${TIMESTAMP}.json"
    mkdir -p "${NVME_ROOT}/logs"
    cp "$TMP_REPORT" "${NVME_ROOT}/logs/e2e_codebase_audit.json"
fi

rm -f /tmp/dgx_uplink_resp.json 2>/dev/null || true
echo "=============================================================================="

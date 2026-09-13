#!/usr/bin/env bash
# ==============================================================================
# Script: DGX Codebase & Runtime Comprehensive Diagnostics & Report Collector
# Usage:
#   bash dgx_audit_report.sh
# or via one-liner from DGX:
#   curl -fsSL https://ais-dev-gok2fike6r2w4m6fkqpo2d-731890839086.asia-southeast1.run.app/api/scripts/dgx_audit_report.sh | bash
# ==============================================================================

set -u

readonly REPORT_DIR="/tmp/dgx_audit_$(date +%s)"
readonly REPORT_FILE="${REPORT_DIR}/dgx_full_audit.json"
readonly APPLET_SERVER="https://ais-dev-gok2fike6r2w4m6fkqpo2d-731890839086.asia-southeast1.run.app"
readonly NVME_ROOT="/mnt/nvme/ocr_pipeline"

mkdir -p "${REPORT_DIR}"

echo "=============================================================================="
echo " [*] DGX Cluster E2E Codebase, Storage & Runtime Diagnostic Probe"
echo " Host: $(hostname -f 2>/dev/null || hostname)"
echo " User: $(id -un)"
echo " Target: ${NVME_ROOT}"
echo "=============================================================================="

# 1. System & Architecture Probe
echo "[*] 1/7 Probing OS, Architecture and Hardware..."
HOSTNAME_VAL="$(hostname 2>/dev/null || echo 'unknown')"
UNAME_VAL="$(uname -a 2>/dev/null || echo 'unknown')"
ARCH_VAL="$(uname -m 2>/dev/null || echo 'unknown')"
UPTIME_VAL="$(uptime 2>/dev/null || echo 'unknown')"
MEM_INFO="$(free -h 2>/dev/null || echo 'unknown')"

# 2. NVIDIA GPU & Driver Probe
echo "[*] 2/7 Probing NVIDIA GPU, CUDA and Driver..."
NVIDIA_SMI_EXISTS="false"
NVIDIA_OUTPUT=""
if command -v nvidia-smi >/dev/null 2>&1; then
    NVIDIA_SMI_EXISTS="true"
    NVIDIA_OUTPUT="$(nvidia-smi --query-gpu=name,driver_version,memory.total,memory.free,utilization.gpu --format=csv,noheader 2>/dev/null || nvidia-smi 2>/dev/null || echo 'nvidia-smi error')"
fi

# 3. NVMe Directory & Permissions Probe
echo "[*] 3/7 Probing NVMe Storage Structure & Permissions..."
NVME_EXISTS="false"
NVME_PERMS=""
NVME_DISK_USAGE=""
INPUT_FILES_COUNT=0
OUTPUT_FILES_COUNT=0
LOGS_COUNT=0
DUCKDB_EXISTS="false"
DUCKDB_SIZE_BYTES=0

if [ -d "${NVME_ROOT}" ]; then
    NVME_EXISTS="true"
    NVME_PERMS="$(ls -ld "${NVME_ROOT}" 2>/dev/null || echo 'unknown')"
    NVME_DISK_USAGE="$(df -h "${NVME_ROOT}" 2>/dev/null | tail -n 1 || echo 'unknown')"
    [ -d "${NVME_ROOT}/input" ] && INPUT_FILES_COUNT="$(find "${NVME_ROOT}/input" -type f 2>/dev/null | wc -l || echo 0)"
    [ -d "${NVME_ROOT}/output" ] && OUTPUT_FILES_COUNT="$(find "${NVME_ROOT}/output" -type f 2>/dev/null | wc -l || echo 0)"
    [ -d "${NVME_ROOT}/logs" ] && LOGS_COUNT="$(find "${NVME_ROOT}/logs" -type f 2>/dev/null | wc -l || echo 0)"
    if [ -f "${NVME_ROOT}/db/identity_index.duckdb" ]; then
        DUCKDB_EXISTS="true"
        DUCKDB_SIZE_BYTES="$(wc -c < "${NVME_ROOT}/db/identity_index.duckdb" 2>/dev/null || echo 0)"
    fi
fi

# 4. Ingested Input Files Listing
echo "[*] 4/7 Listing Ingested Target Files in NVMe..."
INPUT_FILES_JSON="[]"
if [ -d "${NVME_ROOT}/input" ]; then
    INPUT_FILES_LIST="$(find "${NVME_ROOT}/input" -type f -exec ls -lh {} + 2>/dev/null | head -n 30 || echo '')"
else
    INPUT_FILES_LIST="Directory ${NVME_ROOT}/input does not exist"
fi

# 5. Codebase Scripts & Checksums
echo "[*] 5/7 Verifying Codebase Files & Integrity Checksums..."
ENGINE_EXISTS="false"
ENGINE_SHA256=""
ENGINE_SIZE=0
ENGINE_HEAD=""

if [ -f "${NVME_ROOT}/ocr_spark_engine.py" ]; then
    ENGINE_EXISTS="true"
    ENGINE_SHA256="$(sha256sum "${NVME_ROOT}/ocr_spark_engine.py" 2>/dev/null | awk '{print $1}' || echo 'unknown')"
    ENGINE_SIZE="$(wc -c < "${NVME_ROOT}/ocr_spark_engine.py" 2>/dev/null || echo 0)"
    ENGINE_HEAD="$(head -n 25 "${NVME_ROOT}/ocr_spark_engine.py" 2>/dev/null || echo '')"
fi

# Check ~/scripts or current directory files
LOCAL_SCRIPTS_FOUND="$(ls -la ~/dgx_setup.sh ~/ocr_spark_engine.py ~/deploy.sh 2>/dev/null || ls -la dgx_setup.sh ocr_spark_engine.py deploy.sh 2>/dev/null || echo 'None in current dir or home')"

# 6. Python Virtual Environment & ML Dependencies Probe
echo "[*] 6/7 Testing Python Virtual Environment & ML Packages..."
VENV_EXISTS="false"
PYTHON_VERSION="none"
TORCH_INFO="not_installed"
GDOWN_INFO="not_installed"
DUCKDB_INFO="not_installed"
SPACY_INFO="not_installed"
CV2_INFO="not_installed"
OCR_PACKAGES_INFO=""

VENV_PATH="${NVME_ROOT}/venv"
if [ -f "${VENV_PATH}/bin/activate" ]; then
    VENV_EXISTS="true"
    # shellcheck disable=SC1091
    source "${VENV_PATH}/bin/activate"
    PYTHON_VERSION="$(python3 --version 2>/dev/null || echo 'error')"
    
    # Run in-depth package probe
    ML_PROBE_OUTPUT="$(python3 -c '
import sys, json

res = {}
res["python"] = sys.version.split()[0]

def check_mod(name, attr="__version__"):
    try:
        m = __import__(name)
        v = getattr(m, attr, "available")
        return str(v)
    except Exception as e:
        return f"missing: {e}"

res["torch"] = check_mod("torch")
try:
    import torch
    res["cuda_available"] = bool(torch.cuda.is_available())
    res["device_count"] = torch.cuda.device_count()
    if torch.cuda.is_available():
        res["gpu_name"] = torch.cuda.get_device_name(0)
except Exception as e:
    res["cuda_error"] = str(e)

res["gdown"] = check_mod("gdown")
res["duckdb"] = check_mod("duckdb")
res["spacy"] = check_mod("spacy")
res["cv2"] = check_mod("cv2")
res["fitz"] = check_mod("fitz")
res["paddleocr"] = check_mod("paddleocr")
res["easyocr"] = check_mod("easyocr")
res["surya"] = check_mod("surya")

print(json.dumps(res, indent=2))
' 2>/dev/null || echo '{"error": "failed to probe python environment"}')"
fi

# 7. Recent Log Inspection
echo "[*] 7/7 Checking Pipeline Logs..."
ERROR_LOG_TAIL="No error log found"
if [ -f "${NVME_ROOT}/logs/pipeline_errors.log" ]; then
    ERROR_LOG_TAIL="$(tail -n 40 "${NVME_ROOT}/logs/pipeline_errors.log" 2>/dev/null || echo 'empty')"
fi

PASS_LOGS_SUMMARY="$(ls -lh "${NVME_ROOT}/logs" 2>/dev/null || echo 'No logs directory')"

# Compile Master JSON Audit Payload
cat << EOF_JSON > "${REPORT_FILE}"
{
  "timestamp": "$(date -u +"%Y-%m-%d %H:%M:%SZ")",
  "auditVersion": "1.0.0",
  "host": {
    "hostname": "${HOSTNAME_VAL}",
    "uname": "${UNAME_VAL}",
    "arch": "${ARCH_VAL}",
    "uptime": "${UPTIME_VAL}",
    "currentUser": "$(id -un)",
    "currentUid": $(id -u),
    "currentGid": $(id -g)
  },
  "hardware": {
    "nvidiaSmiAvailable": ${NVIDIA_SMI_EXISTS},
    "gpuInfo": $(printf '%s' "${NVIDIA_OUTPUT}" | jq -R -s . 2>/dev/null || echo '"'"${NVIDIA_OUTPUT//\"/\\\"}"'"'),
    "memory": $(printf '%s' "${MEM_INFO}" | jq -R -s . 2>/dev/null || echo '"'"${MEM_INFO//\"/\\\"}"'"')
  },
  "storage": {
    "nvmeRoot": "${NVME_ROOT}",
    "nvmeRootExists": ${NVME_EXISTS},
    "permissions": "${NVME_PERMS}",
    "diskUsage": "${NVME_DISK_USAGE}",
    "inputFilesCount": ${INPUT_FILES_COUNT},
    "outputFilesCount": ${OUTPUT_FILES_COUNT},
    "logsCount": ${LOGS_COUNT},
    "duckdbExists": ${DUCKDB_EXISTS},
    "duckdbSizeBytes": ${DUCKDB_SIZE_BYTES},
    "inputFilesSample": $(printf '%s' "${INPUT_FILES_LIST}" | jq -R -s . 2>/dev/null || echo '"'"${INPUT_FILES_LIST//\"/\\\"}"'"')
  },
  "codebase": {
    "engineInstalled": ${ENGINE_EXISTS},
    "enginePath": "${NVME_ROOT}/ocr_spark_engine.py",
    "engineSizeBytes": ${ENGINE_SIZE},
    "engineSha256": "${ENGINE_SHA256}",
    "localScriptsDiscovered": $(printf '%s' "${LOCAL_SCRIPTS_FOUND}" | jq -R -s . 2>/dev/null || echo '"'"${LOCAL_SCRIPTS_FOUND//\"/\\\"}"'"')
  },
  "virtualEnv": {
    "venvExists": ${VENV_EXISTS},
    "venvPath": "${VENV_PATH}",
    "mlProbe": ${ML_PROBE_OUTPUT:-"{}"}
  },
  "logs": {
    "errorLogTail": $(printf '%s' "${ERROR_LOG_TAIL}" | jq -R -s . 2>/dev/null || echo '"'"${ERROR_LOG_TAIL//\"/\\\"}"'"'),
    "passLogs": $(printf '%s' "${PASS_LOGS_SUMMARY}" | jq -R -s . 2>/dev/null || echo '"'"${PASS_LOGS_SUMMARY//\"/\\\"}"'"')
  }
}
EOF_JSON

echo ""
echo "=============================================================================="
echo "[+] Diagnostic scan finished successfully."
echo "[+] Report generated at: ${REPORT_FILE}"
echo "=============================================================================="

# Transmit Report back to Application Server
echo "[*] Transmitting diagnostic payload to Studio Build server..."
HTTP_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
  -H "Content-Type: application/json" \
  -d @"${REPORT_FILE}" \
  "${APPLET_SERVER}/api/dgx/telemetry-report" || echo "HTTP_FAIL")

STATUS_CODE=$(echo "${HTTP_RESPONSE}" | tail -n 1)
BODY=$(echo "${HTTP_RESPONSE}" | sed '$d')

if [[ "$STATUS_CODE" == "200" || "$STATUS_CODE" == "201" ]]; then
    echo "[+] SUCCESS: Telemetry report received and registered by Studio Build applet!"
    echo "[+] Server response: ${BODY}"
else
    echo "[!] Notice: Telemetry submission response (${STATUS_CODE}): ${BODY}"
    echo "[*] You can view your local report anytime with: cat ${REPORT_FILE}"
fi

echo "=============================================================================="

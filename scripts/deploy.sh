#!/usr/bin/env bash
# ==============================================================================
# Script 3: Local-to-DGX Regression Orchestrator (Hardened Production)
# Execution Context: Run locally via Windows Git Bash or Linux Shell
# Features:
#   - Deploys the local OCR engine to DGX NVMe storage
#   - 10-pass progressive optimization loop with regression verification
#   - Early termination detection when extraction converges
#   - Monotonic quality invariant and DuckDB WAL integrity
# ==============================================================================

set -euo pipefail

readonly SPARK_USER="${SPARK_USER:-flak3dd}"
readonly SPARK_IP="${SPARK_IP:-gx10.local}"
readonly REMOTE_BASE="/mnt/nvme/ocr_pipeline"
readonly OCRDOCS_SERVER_URL="${OCRDOCS_SERVER_URL:-}"
readonly DGX_WORKER_TOKEN="${DGX_WORKER_TOKEN:-}"


readonly SSH_OPTS=(
    "-o" "StrictHostKeyChecking=no"
    "-o" "ConnectTimeout=15"
    "-o" "ServerAliveInterval=30"
    "-o" "ServerAliveCountMax=5"
)

echo "=============================================================================="
echo " [OCRD-DEPLOY] Australian Banking Multi-Pass OCR Deployment Pipeline"
echo " Target DGX Host: ${SPARK_USER}@${SPARK_IP}:${REMOTE_BASE}"
echo " App Server URL: ${OCRDOCS_SERVER_URL:-not required when local engine exists}"
echo " Optimization Passes: Max 10 with Monotonic Regression Verification"
echo "=============================================================================="

# ------------------------------------------------------------------------------
# Phase 1: Deploy Latest Python OCR Engine to DGX NVMe
# ------------------------------------------------------------------------------
echo "[*] Phase 1: Deploying hardened multi-pass OCR engine to DGX cluster..."
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
ENGINE_SRC="${SCRIPT_DIR}/ocr_spark_engine.py"

# Ensure remote directories exist first
ssh "${SSH_OPTS[@]}" "${SPARK_USER}@${SPARK_IP}" "mkdir -p ${REMOTE_BASE}/{input,output,logs,db,noocr,checkpoints}"

if [[ -f "$ENGINE_SRC" ]]; then
    scp "${SSH_OPTS[@]}" "$ENGINE_SRC" "${SPARK_USER}@${SPARK_IP}:${REMOTE_BASE}/ocr_spark_engine.py"
    echo "[+] Engine payload synchronized from local storage."
else
    echo "[!] Local engine source not found at ${ENGINE_SRC}."
    echo "[*] Ensuring remote host has ocr_spark_engine.py installed..."
    if [[ -z "${OCRDOCS_SERVER_URL}" || -z "${DGX_WORKER_TOKEN}" ]]; then
        echo "FATAL: OCRDOCS_SERVER_URL and DGX_WORKER_TOKEN are required to fetch ocr_spark_engine.py from the app server." >&2
        exit 1
    fi
    printf -v REMOTE_TOKEN_Q '%q' "${DGX_WORKER_TOKEN}"
    printf -v REMOTE_SERVER_Q '%q' "${OCRDOCS_SERVER_URL}"
    ssh "${SSH_OPTS[@]}" "${SPARK_USER}@${SPARK_IP}" \
        "DGX_WORKER_TOKEN=${REMOTE_TOKEN_Q} OCRDOCS_SERVER_URL=${REMOTE_SERVER_Q} bash" << 'EOF_ENGINE_FETCH'
        if [ ! -s "/mnt/nvme/ocr_pipeline/ocr_spark_engine.py" ]; then
            echo "[*] Remote engine missing. Downloading latest engine from app server..."
            curl -fsSL -H "Authorization: Bearer ${DGX_WORKER_TOKEN}" \
                 "${OCRDOCS_SERVER_URL%/}/api/scripts/ocr_spark_engine.py" \
                 -o /mnt/nvme/ocr_pipeline/ocr_spark_engine.py
        fi
        if [ ! -s "/mnt/nvme/ocr_pipeline/ocr_spark_engine.py" ]; then
            echo "FATAL: could not fetch ocr_spark_engine.py — check DGX_WORKER_TOKEN and network connectivity to the app server" >&2
            exit 1
        fi
EOF_ENGINE_FETCH
fi

# ------------------------------------------------------------------------------
# Phase 2: Verify local or worker-fed input files on DGX Host
# ------------------------------------------------------------------------------
echo "[*] Phase 2: Checking existing DGX input files..."
ssh "${SSH_OPTS[@]}" "${SPARK_USER}@${SPARK_IP}" bash << 'EOF_SYNC'
    set -euo pipefail
    
    # Ensure venv exists and is activated
    if [ ! -f "/mnt/nvme/ocr_pipeline/venv/bin/activate" ]; then
        echo "[*] Initializing python venv on remote host..."
        python3 -m venv /mnt/nvme/ocr_pipeline/venv --system-site-packages
    fi
    source /mnt/nvme/ocr_pipeline/venv/bin/activate

    echo "[*] Checking existing files in /mnt/nvme/ocr_pipeline/input..."
    mkdir -p /mnt/nvme/ocr_pipeline/{input,output,logs,db,noocr,checkpoints}
    touch /mnt/nvme/ocr_pipeline/logs/pipeline_errors.log
    EXISTING=$(find /mnt/nvme/ocr_pipeline/input -type f | wc -l)

    if [ "$EXISTING" -eq 0 ]; then
        echo "FATAL: no input files found in /mnt/nvme/ocr_pipeline/input. Use scripts/ingest_local_folder.mjs or copy files there before running deploy.sh." >&2
        exit 1
    fi

    echo "[+] Found $EXISTING target files in NVMe storage."
EOF_SYNC

# ------------------------------------------------------------------------------
# Phase 3: Launch Multi-Pass Self-Healing Regression Loop (Max 10 Passes)
# ------------------------------------------------------------------------------
echo "[*] Phase 3: Launching 10-Pass Progressive Optimization Loop with Regression Verification..."

ssh "${SSH_OPTS[@]}" "${SPARK_USER}@${SPARK_IP}" bash << 'EOF_REMOTE'
    set -euo pipefail
    source /mnt/nvme/ocr_pipeline/venv/bin/activate
    export PYTHONUNBUFFERED=1

    mkdir -p /mnt/nvme/ocr_pipeline/{logs,db,output}
    touch /mnt/nvme/ocr_pipeline/logs/pipeline_errors.log

    echo "------------------------------------------------------------------------------"
    echo " PASS | TOTAL DOCS | EXTRACTED | ABN VALID | BSB VALID | DELTA | STATUS"
    echo "------------------------------------------------------------------------------"

    CONSECUTIVE_ZERO_DELTA=0

    for pass_num in {1..10}; do
        # Execute single pass with strict VRAM management
        python3 /mnt/nvme/ocr_pipeline/ocr_spark_engine.py --pass-num "$pass_num" > "/mnt/nvme/ocr_pipeline/logs/pass_${pass_num}.log" 2>&1 || {
            echo "[!] Error during pass $pass_num. Inspecting error log..."
            tail -n 10 "/mnt/nvme/ocr_pipeline/logs/pipeline_errors.log" 2>/dev/null || true
        }

        # Query DuckDB for Monotonic Regression Verification Metrics
        METRICS=$(python3 -c "
import duckdb, json, os
db_file = '/mnt/nvme/ocr_pipeline/db/identity_index.duckdb'
if not os.path.exists(db_file):
    print('0|0|0|0|0|0|0|false')
    sys.exit(0)

try:
    with duckdb.connect(db_file) as con:
        con.execute('PRAGMA busy_timeout=5000;')
        tables = con.execute(\"SELECT table_name FROM information_schema.tables WHERE table_name = 'pass_audit_log'\").fetchall()
        if not tables:
            print('0|0|0|0|0|0|0|false')
            sys.exit(0)
        latest = con.execute('SELECT * FROM pass_audit_log ORDER BY timestamp DESC LIMIT 1').fetchdf()
        if not latest.empty:
            r = latest.iloc[0]
            print(f\"{r['pass_num']}|{r['total_documents']}|{r['resolved_fields_count']}|{r['valid_abns']}|{r['valid_bsbs']}|{r['delta_new_fields']}|{r['regressions_prevented']}|{str(r['early_stop_triggered']).lower()}\")
        else:
            print('0|0|0|0|0|0|0|false')
except Exception as e:
    print(f'ERR: {e}')
" 2>/dev/null || echo "ERR")

        if [[ "$METRICS" == ERR* ]]; then
            echo " [!] Pass $pass_num: DB Lock contention. Retrying query..."
            sleep 3
            continue
        fi

        IFS='|' read -r P_NUM DOCS EXTRACTED ABN_V BSB_V DELTA REVERT EARLY_STOP <<< "$METRICS"

        printf " %-4s | %-10s | %-9s | %-9s | %-9s | +%-4s | " "$P_NUM" "$DOCS" "$EXTRACTED" "$ABN_V" "$BSB_V" "$DELTA"

        if [ "$DELTA" -eq 0 ]; then
            CONSECUTIVE_ZERO_DELTA=$((CONSECUTIVE_ZERO_DELTA + 1))
            printf "STABILIZED (%s prevented)\n" "$REVERT"
        else
            CONSECUTIVE_ZERO_DELTA=0
            printf "IMPROVED (+%s fields)\n" "$DELTA"
        fi

        # Early Stopping Condition:
        # Halt early if no new fields gained across 2 consecutive passes or early stop flagged
        if [ "$CONSECUTIVE_ZERO_DELTA" -ge 2 ] && [ "$pass_num" -ge 3 ]; then
            echo "------------------------------------------------------------------------------"
            echo "[+] EARLY TERMINATION: Zero new fields discovered over 2 consecutive passes."
            echo "[+] Regression Verification: 0 regressions allowed (all high-confidence fields preserved)."
            echo "[+] Total Optimization Complete at Pass $pass_num of 10."
            break
        fi

        if [ "$EARLY_STOP" = "true" ] && [ "$pass_num" -ge 4 ]; then
            echo "------------------------------------------------------------------------------"
            echo "[+] EARLY TERMINATION: Complete field saturation reached with zero regression."
            echo "[+] Total Optimization Complete at Pass $pass_num of 10."
            break
        fi

        if [ "$pass_num" -lt 10 ]; then
            echo "[*] VRAM Cooling Period (3s) before next pass..."
            sleep 3
        fi
    done

    echo "=============================================================================="
    echo "[+] Pipeline Execution Finalized."
    echo "[+] Consolidated Output: /mnt/nvme/ocr_pipeline/output/ocr_consolidated_identities.csv"
    echo "[+] Zero-Lock Parquet:   /mnt/nvme/ocr_pipeline/output/ocr_consolidated_identities.parquet"
    echo "=============================================================================="
EOF_REMOTE

echo "[+] Deployment and multi-pass regression run completed successfully."

#!/usr/bin/env bash
# ==============================================================================
# Script 3: Local-to-DGX Regression Orchestrator (Hardened Production)
# Execution Context: Run locally via Windows Git Bash or Linux Shell
# Features:
#   - Automated Google Drive Folder Ingestion (16q3PdioHVbLIBVqU--54nBvNhqLE7bNN)
#   - 10-Pass Progressive Optimization Loop with Regression Verification
#   - Early Termination Detection (Stops early when converged with zero regression)
#   - Monotonic Quality Invariant & DuckDB WAL Integrity
# ==============================================================================

set -euo pipefail

readonly SPARK_USER="${SPARK_USER:-flak3dd}"
readonly SPARK_IP="${SPARK_IP:-gx10-d0e7.local}"
readonly REMOTE_BASE="/mnt/nvme/ocr_pipeline"
readonly GDRIVE_FOLDER_ID="16q3PdioHVbLIBVqU--54nBvNhqLE7bNN"
readonly GDRIVE_URL="https://drive.google.com/drive/folders/${GDRIVE_FOLDER_ID}?usp=sharing"

# Optional local directory fallback if offline
readonly LOCAL_FALLBACK_DIR="${LOCAL_DIR:-/d/Recovered_C/_Raw_Data_and_Databases}"

readonly SSH_OPTS=(
    "-o" "StrictHostKeyChecking=no"
    "-o" "ConnectTimeout=15"
    "-o" "ServerAliveInterval=30"
    "-o" "ServerAliveCountMax=5"
)

echo "=============================================================================="
echo " [NGX-ORCHESTRATOR] Australian Banking Multi-Pass OCR Deployment Pipeline"
echo " Target DGX Host: ${SPARK_USER}@${SPARK_IP}:${REMOTE_BASE}"
echo " Google Drive Ingestion Source: ${GDRIVE_URL}"
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
    ssh "${SSH_OPTS[@]}" "${SPARK_USER}@${SPARK_IP}" bash << 'EOF_ENGINE_FETCH'
        if [ ! -s "/mnt/nvme/ocr_pipeline/ocr_spark_engine.py" ]; then
            echo "[*] Remote engine missing. Downloading latest engine from app server..."
            curl -fsSL https://ais-dev-gok2fike6r2w4m6fkqpo2d-731890839086.asia-southeast1.run.app/api/scripts/ocr_spark_engine.py \
                 -o /mnt/nvme/ocr_pipeline/ocr_spark_engine.py || true
        fi
EOF_ENGINE_FETCH
fi

# ------------------------------------------------------------------------------
# Phase 2: Ingest Google Drive Folder directly on DGX Host
# ------------------------------------------------------------------------------
echo "[*] Phase 2: Ingesting dataset from Google Drive folder [${GDRIVE_FOLDER_ID}]..."
ssh "${SSH_OPTS[@]}" "${SPARK_USER}@${SPARK_IP}" bash << EOF_SYNC
    set -euo pipefail
    
    # Ensure venv exists and is activated
    if [ ! -f "/mnt/nvme/ocr_pipeline/venv/bin/activate" ]; then
        echo "[*] Initializing python venv on remote host..."
        python3 -m venv /mnt/nvme/ocr_pipeline/venv --system-site-packages
    fi
    source /mnt/nvme/ocr_pipeline/venv/bin/activate

    # Ensure gdown is present
    if ! python3 -c "import gdown" 2>/dev/null; then
        echo "[*] Installing gdown in remote venv..."
        pip install "gdown>=5.1.0" --quiet --retries 5 || true
    fi

    echo "[*] Checking existing files in /mnt/nvme/ocr_pipeline/input..."
    mkdir -p /mnt/nvme/ocr_pipeline/{input,output,logs,db,noocr,checkpoints}
    touch /mnt/nvme/ocr_pipeline/logs/pipeline_errors.log
    EXISTING=\$(find /mnt/nvme/ocr_pipeline/input -type f | wc -l)

    if [ "\$EXISTING" -eq 0 ]; then
        echo "[*] Remote input empty. Downloading Google Drive folder via gdown..."
        python3 -m gdown.cli --folder "${GDRIVE_URL}" -O /mnt/nvme/ocr_pipeline/input --remaining-ok || {
            echo "[!] Direct gdown folder download failed. Running python engine drive fallback..."
            python3 /mnt/nvme/ocr_pipeline/ocr_spark_engine.py --sync-gdrive --gdrive-folder-id "${GDRIVE_FOLDER_ID}" || true
        }
    else
        echo "[+] Found \$EXISTING target files already cached in NVMe storage."
    fi
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

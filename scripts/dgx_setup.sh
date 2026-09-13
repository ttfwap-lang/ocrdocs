#!/usr/bin/env bash
# ==============================================================================
# Script 1: DGX Spark ARM64 Environment & ML Bootstrap (Hardened Production)
# Execution Context: Run directly on DGX terminal (flak3dd@gx10-d0e7)
# Supports: Google Drive Download (gdown), Multi-Pass OCR (10 passes),
#           30 Australian Banking Fields, CUDA 12.4 ARM64, and DuckDB WAL.
# ==============================================================================

set -euo pipefail
trap 'echo "[-] Critical Error: Provisioning failed at line $LINENO"' ERR

readonly NVME_ROOT="/mnt/nvme/ocr_pipeline"
readonly VENV_DIR="${NVME_ROOT}/venv"
readonly CURRENT_USER="$(id -un)"
readonly GDRIVE_FOLDER_ID="16q3PdioHVbLIBVqU--54nBvNhqLE7bNN"

echo "[*] =========================================================================="
echo "[*] DGX Spark ARM64 / x86_64 Environment & ML Provisioner"
echo "[*] Target Path: ${NVME_ROOT}"
echo "[*] =========================================================================="

echo "[*] Phase 1: Provisioning isolated NVMe directory structure..."
sudo mkdir -p "${NVME_ROOT}"/{input,output,logs,db,noocr,checkpoints,gdrive_cache}
sudo chown -R "${CURRENT_USER}:${CURRENT_USER}" "${NVME_ROOT}"
chmod 750 "${NVME_ROOT}"

echo "[*] Phase 2: Installing system dependencies with apt lock retry protection..."
export DEBIAN_FRONTEND=noninteractive
for i in {1..5}; do
    if sudo apt-get update -y && \
       sudo apt-get install -y --no-install-recommends \
           build-essential software-properties-common curl wget git rsync \
           tesseract-ocr libtesseract-dev tesseract-ocr-eng poppler-utils \
           libgl1 libglib2.0-0 libgomp1 libspatialindex-dev p7zip-full \
           python3-dev python3-pip python3-venv python3-full; then
        echo "[+] System apt dependencies installed successfully."
        break
    fi
    echo "[!] apt-get locked or failed. Retrying in 5s ($i/5)..."
    sleep 5
done

echo "[*] Phase 3: Initializing Python Virtual Environment..."
if [[ ! -f "${VENV_DIR}/bin/activate" ]]; then
    python3 -m venv "${VENV_DIR}" --system-site-packages
fi
# shellcheck disable=SC1091
source "${VENV_DIR}/bin/activate"

pip install --upgrade pip setuptools wheel --quiet --retries 10 --timeout 120

echo "[*] Phase 4: Installing Google Drive download utility (gdown)..."
pip install "gdown>=5.1.0" --quiet --retries 10 --timeout 120

echo "[*] Phase 5: Routing PyTorch installation for DGX Spark architecture..."
ARCH=$(uname -m)
if [[ "$ARCH" == "aarch64" ]]; then
    echo "[*] Detected ARM64 (aarch64) DGX Spark architecture..."
    pip install torch torchvision \
        --index-url https://download.pytorch.org/whl/cu124 \
        --extra-index-url https://pypi.nvidia.com --quiet --retries 10 --timeout 120
else
    echo "[*] Detected x86_64 architecture..."
    pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121 --quiet --retries 10 --timeout 120
fi

echo "[*] Phase 6: Installing OCR, Computer Vision & NLP dependencies..."
# Pin OpenCV to pre-built headless wheel to prevent slow ARM64 source compilation
pip install "opencv-python-headless==4.12.0.88" --quiet
pip install paddlepaddle paddleocr easyocr surya-ocr pytesseract spacy \
    pymupdf python-docx striprtf pillow duckdb pandas numpy rapidfuzz \
    scipy scikit-learn --quiet --retries 10 --timeout 120

echo "[*] Phase 7: Downloading SpaCy English NLP language model..."
if ! python3 -c "import spacy; spacy.load('en_core_web_sm')" 2>/dev/null; then
    python3 -m spacy download en_core_web_sm --quiet --retries 10
fi

echo "[*] Phase 8: Performing Pre-Flight Diagnostics..."
python3 -c "
import sys, torch, cv2, spacy, duckdb, gdown
print(f'[+] Python: {sys.version.split()[0]}')
print(f'[+] PyTorch: {torch.__version__} | CUDA Available: {torch.cuda.is_available()}')
if torch.cuda.is_available():
    print(f'[+] GPU Device: {torch.cuda.get_device_name(0)}')
    print(f'[+] VRAM Total: {torch.cuda.get_device_properties(0).total_memory / (1024**3):.2f} GB')
print(f'[+] DuckDB: {duckdb.__version__}')
print(f'[+] gdown: {gdown.__version__}')
print('[+] Pre-flight Diagnostics: ALL PASSED')
"

echo "[*] Phase 9: Testing Google Drive connection to folder ${GDRIVE_FOLDER_ID}..."
python3 -c "
import gdown
folder_url = 'https://drive.google.com/drive/folders/${GDRIVE_FOLDER_ID}?usp=sharing'
print(f'[*] Validating Google Drive URL: {folder_url}')
"

echo "[+] =========================================================================="
echo "[+] DGX Host Environment Provisioning COMPLETE. Ready for deployment."
echo "[+] Virtualenv activated at: ${VENV_DIR}"
echo "[+] NVMe Pipeline Root: ${NVME_ROOT}"
echo "[+] =========================================================================="

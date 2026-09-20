#!/usr/bin/env bash
# Fetch the local VLM fallback models for Stage 6 onto the GX10 (run ON the gx10, not on Windows).
#   Qwen/Qwen2.5-VL-7B-Instruct  (Apache-2.0, ~16 GB)  handwriting / low-confidence region fallback
#   microsoft/Florence-2-large   (MIT,        ~1.5 GB) fast layout/caption/OCR-region model
# Usage: scripts/fetch_vlm_models.sh [MODELS_DIR]   (default /mnt/nvme/models)
set -euo pipefail
MODELS_DIR="${1:-/mnt/nvme/models}"
NEED_GB=25
mkdir -p "$MODELS_DIR"
avail_gb=$(df -BG --output=avail "$MODELS_DIR" | tail -1 | tr -dc '0-9')
if (( avail_gb < NEED_GB )); then
  echo "ERROR: only ${avail_gb}G free in $MODELS_DIR, need ${NEED_GB}G" >&2
  exit 1
fi
# huggingface_hub renamed its CLI (huggingface-cli -> hf) and PEP 668 blocks system-wide pip on modern Ubuntu,
# so use a private venv and the Python API, which is stable across both.
VENV="$MODELS_DIR/.venv"
[[ -x "$VENV/bin/python" ]] || python3 -m venv "$VENV"
"$VENV/bin/python" -m pip install --quiet --upgrade huggingface_hub
for repo in Qwen/Qwen2.5-VL-7B-Instruct microsoft/Florence-2-large; do
  echo "==> $repo"
  "$VENV/bin/python" -c "import sys; from huggingface_hub import snapshot_download as d; d(repo_id=sys.argv[1], local_dir=sys.argv[2])" "$repo" "$MODELS_DIR/${repo##*/}"
done
du -sh "$MODELS_DIR"/*
echo "Models are in $MODELS_DIR."

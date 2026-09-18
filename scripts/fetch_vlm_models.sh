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
command -v huggingface-cli >/dev/null 2>&1 || python3 -m pip install --user -q "huggingface_hub[cli]"
HF="$(command -v huggingface-cli || echo "$HOME/.local/bin/huggingface-cli")"
for repo in Qwen/Qwen2.5-VL-7B-Instruct microsoft/Florence-2-large; do
  echo "==> $repo"
  "$HF" download "$repo" --local-dir "$MODELS_DIR/${repo##*/}"
done
du -sh "$MODELS_DIR"/*
echo "Set OCRDOCS_VLM_DIR=$MODELS_DIR and OCRDOCS_ENABLE_RESEARCH_ENGINES=true to enable."

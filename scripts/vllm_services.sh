#!/usr/bin/env bash
# Start/stop the vLLM containers the vlm_v2 pipeline talks to. Run on the GX10.
#
#   vllm_services.sh fetch qwenvl        download Qwen3-VL-8B-Instruct into the models dir (needs internet)
#   vllm_services.sh start paddle|qwenvl|chandra|all
#   vllm_services.sh stop  paddle|qwenvl|chandra|all
#   vllm_services.sh status
#
# Services (port, served name, the name the pipeline expects):
#   paddle  :8100  paddle    PaddleOCR-VL-1.6   printed text        flags copied from the measured bench run
#   qwenvl  :8200  qwen-vl   Qwen3-VL-8B        classify/merge/agent
#   chandra :8300  chandra   Chandra OCR 2      second reader, on demand (large: needs ~48 GB free to start)
#
# Only containers named paddle-vl / qwen-vl / chandra are ever touched. Other containers on this box (qwen-abliterated,
# abliterated-proxy, ui-venus, ollama) belong to other work and are never stopped or removed here.
# Memory is shared with the rest of the GX10, so each start refuses to run unless enough is free.
set -euo pipefail

MODELS="${OCRDOCS_MODELS_DIR:-/home/nick/ocr-runtime/models}"
IMAGE="${OCRDOCS_VLLM_IMAGE:-vllm/vllm-openai:cu130-nightly}"
VENV_PY="${OCRDOCS_RUNTIME_PY:-/home/nick/ocr-runtime/venv/bin/python}"
WAIT_SECONDS="${OCRDOCS_VLLM_WAIT_SECONDS:-900}"

# spec <service> -> sets NAME PORT SERVED DIR UTIL NEED_MB ARGS
spec() {
  case "$1" in
    paddle)  NAME=paddle-vl; PORT=8100; SERVED=paddle;   DIR=PaddleOCR-VL-1.6;    UTIL=0.07; NEED_MB=20000
             ARGS="--max-model-len 16384 --max-num-seqs 32 --trust-remote-code --no-enable-prefix-caching --mm-processor-cache-gb 0" ;;
    qwenvl)  NAME=qwen-vl;   PORT=8200; SERVED=qwen-vl;  DIR=Qwen3-VL-8B-Instruct; UTIL=0.20; NEED_MB=32000
             # Extra flags (e.g. an FP8/AWQ quantization) go in OCRDOCS_QWENVL_EXTRA once measured on this GPU.
             ARGS="--max-model-len 16384 --max-num-seqs 16 ${OCRDOCS_QWENVL_EXTRA:-}" ;;
    chandra) NAME=chandra;   PORT=8300; SERVED=chandra;  DIR=chandra-ocr-2;       UTIL=0.22; NEED_MB=48000
             ARGS="--max-model-len 16384 --max-num-seqs 32 --trust-remote-code" ;;
    *) echo "unknown service '$1' (paddle|qwenvl|chandra|all)" >&2; exit 2 ;;
  esac
}

expand() { [ "$1" = all ] && echo "paddle qwenvl chandra" || echo "$1"; }
available_mb() { free -m | awk 'NR==2{print $7}'; }

start_one() {
  spec "$1"
  [ -d "$MODELS/$DIR" ] || { echo "[$NAME] model dir $MODELS/$DIR is missing (try: $0 fetch $1)" >&2; return 1; }
  local have; have=$(available_mb)
  if [ "$have" -lt "$NEED_MB" ]; then
    echo "[$NAME] refusing to start: ${have} MB available, needs ${NEED_MB} MB. Free memory on the box first." >&2
    return 1
  fi
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  # shellcheck disable=SC2086  # ARGS is intentionally word-split into flags
  docker run -d --name "$NAME" --gpus all --ipc=host --net=host \
    -e HF_HUB_OFFLINE=1 -e CUTE_DSL_ARCH=sm_121a \
    -v "$MODELS":/models:ro "$IMAGE" "/models/$DIR" \
    --host 0.0.0.0 --port "$PORT" --served-model-name "$SERVED" --gpu-memory-utilization "$UTIL" $ARGS >/dev/null
  local waited=0
  until curl -sf -m 4 "localhost:$PORT/v1/models" | grep -q "\"$SERVED\""; do
    sleep 10; waited=$((waited + 10))
    if [ "$(docker inspect -f '{{.State.Running}}' "$NAME" 2>/dev/null)" != true ] || [ "$waited" -ge "$WAIT_SECONDS" ]; then
      echo "[$NAME] did not become ready (waited ${waited}s). Last log lines:" >&2
      docker logs --tail 25 "$NAME" >&2 || true
      docker rm -f "$NAME" >/dev/null 2>&1 || true
      return 1
    fi
  done
  echo "[$NAME] ready on :$PORT after ~${waited}s"
}

stop_one() { spec "$1"; docker rm -f "$NAME" >/dev/null 2>&1 && echo "[$NAME] stopped" || echo "[$NAME] not running"; }

status() {
  for s in paddle qwenvl chandra; do
    spec "$s"
    if curl -sf -m 3 "localhost:$PORT/v1/models" | grep -q "\"$SERVED\""; then echo "$NAME  up   :$PORT"; else echo "$NAME  down :$PORT"; fi
  done
  echo "available memory: $(available_mb) MB"
}

cmd="${1:-status}"; svc="${2:-all}"
case "$cmd" in
  start)  rc=0; for s in $(expand "$svc"); do start_one "$s" || rc=1; done; exit $rc ;;
  stop)   for s in $(expand "$svc"); do stop_one "$s"; done ;;
  status) status ;;
  fetch)
    [ "$svc" = qwenvl ] || { echo "only qwenvl needs fetching; paddle and chandra are already in $MODELS" >&2; exit 2; }
    "$VENV_PY" -c "from huggingface_hub import snapshot_download as d; d('Qwen/Qwen3-VL-8B-Instruct', local_dir='$MODELS/Qwen3-VL-8B-Instruct')"
    echo "downloaded to $MODELS/Qwen3-VL-8B-Instruct" ;;
  *) echo "usage: $0 fetch qwenvl | start|stop paddle|qwenvl|chandra|all | status" >&2; exit 2 ;;
esac

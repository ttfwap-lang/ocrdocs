#!/usr/bin/env bash
# Recreate the vLLM Qwen container with a smaller context / GPU memory budget. Auto-rolls back on failure.
set -u
NAME=qwen-abliterated
OLD=${NAME}-old
LOG=/home/nick/qwen_reconfig.log
exec > >(tee -a "$LOG") 2>&1
echo "=== $(date) reconfig start"
MODEL_HOST=/home/flak3dd/gx10/models/Qwen3.6-35B-A3B-abliterated-NVFP4-MTP
MODEL_CTR=/models/Qwen3.6-35B-A3B-abliterated-NVFP4-MTP

rollback() {
  echo "!!! rolling back: $1"
  docker rm -f "$NAME" >/dev/null 2>&1
  docker rename "$OLD" "$NAME"
  docker update --restart unless-stopped "$NAME"
  docker start "$NAME"
  echo "rollback done"
  exit 1
}

# Refuse if something is actively using the model.
running=$(curl -s -m 5 localhost:8000/metrics | awk '/^vllm:num_requests_running/{print $2}' | head -1)
echo "requests running now: ${running:-unknown}"
if [ -n "${running:-}" ] && [ "${running%.*}" != "0" ]; then echo "model is busy, aborting"; exit 2; fi

docker stop "$NAME" || { echo "stop failed"; exit 3; }
docker rename "$NAME" "$OLD"
docker update --restart=no "$OLD" >/dev/null

docker run -d --name "$NAME" --restart unless-stopped --gpus all --ipc=host --shm-size=16g --net=host \
  -e CUTE_DSL_ARCH=sm_121a -e HF_HUB_OFFLINE=1 -e TORCH_MATMUL_PRECISION=high -e TRANSFORMERS_OFFLINE=1 \
  -e VLLM_MARLIN_USE_ATOMIC_ADD=1 -e VLLM_USE_FLASHINFER_SAMPLER=1 \
  -v "$MODEL_HOST:$MODEL_CTR:ro" \
  vllm/vllm-openai:cu130-nightly "$MODEL_CTR" \
  --host 0.0.0.0 --port 8000 --served-model-name "$NAME" \
  --max-model-len 32768 --max-num-batched-tokens 16384 --max-num-seqs 1 --trust-remote-code \
  --gpu-memory-utilization 0.40 --reasoning-parser qwen3 --kv-cache-dtype fp8 --attention-backend flashinfer \
  --enable-prefix-caching --enable-auto-tool-choice --tool-call-parser qwen3_coder \
  --speculative-config '{"method":"mtp","num_speculative_tokens":3}' -tp 1 \
  --override-generation-config '{"max_new_tokens": 4096}' \
  || rollback "docker run failed"

echo "waiting for the new server to come up (up to 15 min)..."
ok=0
for i in $(seq 1 90); do
  sleep 10
  if curl -s -m 5 localhost:8000/v1/models | grep -q "$NAME"; then ok=1; break; fi
  if [ "$(docker inspect -f '{{.State.Running}}' "$NAME" 2>/dev/null)" != "true" ]; then
    docker logs --tail 30 "$NAME" 2>&1 | tail -30
    rollback "new container exited"
  fi
done
[ "$ok" = 1 ] || { docker logs --tail 30 "$NAME" 2>&1 | tail -30; rollback "server never became ready"; }

echo "server is up; sending a test completion..."
resp=$(curl -s -m 120 localhost:8000/v1/chat/completions -H 'Content-Type: application/json' \
  -d '{"model":"qwen-abliterated","messages":[{"role":"user","content":"Reply with the single word: ready"}],"max_tokens":200}')
echo "$resp" | head -c 600; echo
echo "$resp" | grep -q '"choices"' || rollback "test completion failed"

echo "=== $(date) SUCCESS. old container kept as $OLD (stopped, restart=no). Remove later with: docker rm $OLD"
docker inspect "$NAME" --format '{{json .Config.Cmd}}' | head -c 700; echo

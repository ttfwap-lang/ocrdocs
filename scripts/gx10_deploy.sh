#!/usr/bin/env bash
# One-shot deploy of the new build + 24/7 queue-drain config on the GX10.
# Run ON the gx10 as a user with sudo:   sudo bash gx10_deploy.sh <OCR_ROOT_DIR>
# OCR_ROOT_DIR (required) is the folder that CONTAINS `queued/`.
set -euo pipefail
APP=/home/flak3dd/ocrdocs
SVC=ocrdocs-server.service
PKG="${PKG:-$(dirname "$(readlink -f "$0")")/ocrdocs-build.tgz}"
[[ $EUID -eq 0 ]] || { echo "run with sudo" >&2; exit 1; }
[[ -f "$PKG" ]] || { echo "missing $PKG" >&2; exit 1; }

ROOT="${1:-}"
# No auto-detection: a wrong guess once pointed the drain at another app's jobs folder (FaceFusion) and the
# drain MOVES and pre-parse DELETES files. The path must be given explicitly and must not look like another app's.
[[ -n "$ROOT" ]] || { echo "usage: sudo bash gx10_deploy.sh <ocr_root>   (the folder that contains queued/)" >&2; exit 1; }
ROOT="$(readlink -f "$ROOT")"
case "$ROOT" in
  *facefusion*|*/.jobs*|/|/home|/home/*/src/*) echo "refusing suspicious ocr root: $ROOT" >&2; exit 1;;
esac
[[ -d "$ROOT/queued" ]] || { echo "$ROOT/queued does not exist" >&2; exit 1; }
echo "OCR root: $ROOT  ($(find "$ROOT/queued" -type f | wc -l) files queued)"

# The unit runs /usr/bin/node, but the nodejs package has been REMOVED on this host (dpkg.log): the live
# server only survives because it is still in memory. Restore Node (>=20) BEFORE any restart.
if [[ ! -x /usr/bin/node ]]; then
  echo "== /usr/bin/node missing; reinstalling nodejs"
  apt-get update -qq && apt-get install -y nodejs
fi
NODE_MAJOR=$(/usr/bin/node -p 'process.versions.node.split(".")[0]')
(( NODE_MAJOR >= 20 )) || { echo "node $NODE_MAJOR < 20 (package.json engines); need NodeSource 22: https://deb.nodesource.com" >&2; exit 1; }
echo "node $(/usr/bin/node -v)"
# Native module ABI must match the (possibly re-installed) Node before we restart into it.
if ! sudo -u flak3dd bash -c "cd $APP && /usr/bin/node -e \"require('better-sqlite3')\"" 2>/dev/null; then
  echo "== better-sqlite3 ABI mismatch; rebuilding"
  sudo -u flak3dd bash -c "cd $APP && npm rebuild better-sqlite3"
fi

command -v 7z >/dev/null || apt-get install -y p7zip-full
command -v file >/dev/null || apt-get install -y file

echo "== backing up current build"
[[ -d "$APP/dist" ]] && cp -a "$APP/dist" "$APP/dist.bak.$(date +%s)"
echo "== installing build"
tar -xzf "$PKG" -C "$APP" --no-same-owner
chown -R flak3dd:flak3dd "$APP/dist" "$APP/scripts" 2>/dev/null || true
chmod +x "$APP/scripts/pre-parse.sh"
sudo -u flak3dd mkdir -p "$ROOT/parsed"

echo "== lightweight extra OCR workers (Tesseract only, research engines OFF)"
# The main worker loads every research engine (~17 GB RSS) and runs one document at a time, leaving 19 of 20 cores
# idle. These extra instances are memory-light and pull from the same job queue (leases make that safe).
LITE_N="${OCRDOCS_LITE_WORKERS:-0}"
cat > /etc/systemd/system/ocrdocs-worker-lite@.service <<UNIT
[Unit]
Description=OCRDocs lightweight OCR worker %i (Tesseract only)
After=ocrdocs-server.service network-online.target
Wants=network-online.target
Requires=ocrdocs-server.service
StartLimitIntervalSec=0

[Service]
Type=simple
User=flak3dd
Group=flak3dd
WorkingDirectory=$APP/scripts
EnvironmentFile=$APP/.env.worker
# env(1) in ExecStart wins over EnvironmentFile, so research engines stay off regardless of .env.worker.
ExecStart=/usr/bin/env OCRDOCS_ENABLE_HANDWRITING_ENGINE=false /mnt/nvme/ocr_pipeline/venv/bin/python3 -u dgx_worker.py
Restart=always
RestartSec=5
MemoryMax=8G
Nice=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=ocrdocs-worker-lite-%i

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
# Reconcile: instances 1..LITE_N run; any other existing instance is stopped and disabled (LITE_N=0 removes them all).
for u in $(systemctl list-units --all --plain --no-legend "ocrdocs-worker-lite@*.service" | awk '{print $1}'); do
  n="${u#ocrdocs-worker-lite@}"; n="${n%.service}"
  if (( n > LITE_N )); then systemctl disable --now "$u" || true; fi
done
for i in $(seq 1 "$LITE_N"); do systemctl enable --now "ocrdocs-worker-lite@$i.service"; done

echo "== OCR worker runtime (mode: ${2:-new})"
RUNTIME=/home/nick/ocr-runtime
WDROP=/etc/systemd/system/ocrdocs-worker.service.d
mkdir -p "$WDROP"
if [[ "${2:-new}" == "legacy" ]]; then
  rm -f "$WDROP/runtime.conf"
  echo "worker returns to the legacy py3.7 runtime"
else
  [[ -x "$RUNTIME/venv/bin/python3" ]] || { echo "runtime venv missing at $RUNTIME/venv" >&2; exit 1; }
  # Prove the exact runtime can import the engine AS the service user before touching the unit.
  sudo -u flak3dd mkdir -p /tmp/ocrimport/logs /tmp/ocrimport/db /tmp/ocrimport/input /tmp/ocrimport/output /tmp/ocrimport/noocr
  sudo -u flak3dd env NVME_ROOT=/tmp/ocrimport HF_HOME="$RUNTIME/hf" HF_HUB_OFFLINE=1 "$RUNTIME/venv/bin/python3" -c "
import sys; sys.path.insert(0, '$APP/scripts')
import ocr_spark_engine as e, ocr_hybrid, ocr_paddle_vl, ocr_qwen_merge
print('engine import ok | hybrid', e.ocr_hybrid is not None, '| cuda', e.torch.cuda.is_available())"     || { echo "runtime cannot run the engine as flak3dd; leaving the worker unchanged" >&2; exit 1; }
  cat > "$WDROP/runtime.conf" <<CONF
[Service]
ExecStart=
# env(1) beats EnvironmentFile: force the new stack regardless of .env.worker.
ExecStart=/usr/bin/env OCRDOCS_ENABLE_HANDWRITING_ENGINE=true HF_HOME=$RUNTIME/hf HF_HUB_OFFLINE=1 $RUNTIME/venv/bin/python3 -u dgx_worker.py
CONF
fi
systemctl daemon-reload

echo "== systemd drop-in"
D=/etc/systemd/system/$SVC.d; mkdir -p "$D"
cat > "$D/queue.conf" <<CONF
[Service]
Environment=OCRDOCS_IMPORT_ROOT=$ROOT
Environment=OCRDOCS_PREPARSE_SHELL=bash
Environment=OCRDOCS_PREPARSE_SCRIPT=$APP/scripts/pre-parse.sh
Environment=OCRDOCS_QUEUE_WATCH=true
Environment=OCRDOCS_QUEUE_POLL_SECONDS=30
Environment=OCRDOCS_PURGE_UNVERIFIED=true
CONF
systemctl daemon-reload
sudo -u flak3dd bash -c "cd $APP && /usr/bin/node --check dist/server.cjs" || { echo "new build fails --check; NOT restarting" >&2; exit 1; }
systemctl restart "$SVC"
systemctl restart ocrdocs-worker.service  # pick up the engine changes
sleep 4
systemctl is-active "$SVC"
if [[ "${2:-new}" != "legacy" ]]; then
  sleep 30
  if ! systemctl is-active --quiet ocrdocs-worker.service; then
    echo "!!! worker failed on the new runtime; rolling back to legacy" >&2
    rm -f "$WDROP/runtime.conf"; systemctl daemon-reload; systemctl restart ocrdocs-worker.service
    exit 1
  fi
  echo "worker is active on the new runtime"
fi
echo "== watch progress:  journalctl -u $SVC -f | grep -i 'queue import'"

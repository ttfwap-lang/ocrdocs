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

echo "== systemd drop-in"
D=/etc/systemd/system/$SVC.d; mkdir -p "$D"
cat > "$D/queue.conf" <<CONF
[Service]
Environment=OCRDOCS_IMPORT_ROOT=$ROOT
Environment=OCRDOCS_PREPARSE_SHELL=bash
Environment=OCRDOCS_PREPARSE_SCRIPT=$APP/scripts/pre-parse.sh
Environment=OCRDOCS_QUEUE_WATCH=true
Environment=OCRDOCS_QUEUE_POLL_SECONDS=30
CONF
systemctl daemon-reload
sudo -u flak3dd bash -c "cd $APP && /usr/bin/node --check dist/server.cjs" || { echo "new build fails --check; NOT restarting" >&2; exit 1; }
systemctl restart "$SVC"
sleep 4
systemctl is-active "$SVC"
echo "== watch progress:  journalctl -u $SVC -f | grep -i 'queue import'"

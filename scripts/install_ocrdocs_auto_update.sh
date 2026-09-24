#!/usr/bin/env bash
#
# Install the versioned-release updater on the GX10.
# Run as root on the GX10, preferably from a checkout of this repository:
#   sudo bash scripts/install_ocrdocs_auto_update.sh
#
# The installer is deliberately conservative: it creates the current-release
# symlink pointing at the existing application before changing systemd, so a
# failed first update leaves the currently-running installation usable.
#
set -Eeuo pipefail
umask 027

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${1:-$(cd -- "$SCRIPT_DIR/.." && pwd)}"
DATA_ROOT="${OCRDOCS_DATA_ROOT:-/home/flak3dd/ocrdocs}"
RELEASES_ROOT="${OCRDOCS_RELEASES_ROOT:-/home/flak3dd/ocrdocs-releases}"
CURRENT_LINK="${OCRDOCS_CURRENT_LINK:-/home/flak3dd/ocrdocs-current}"
SOURCE_ROOT="${OCRDOCS_UPDATE_SOURCE_ROOT:-/home/flak3dd/ocrdocs-update-source}"
STATE_ROOT="${OCRDOCS_UPDATE_STATE_ROOT:-/var/lib/ocrdocs-updater}"
SERVICE_USER="${OCRDOCS_SERVICE_USER:-flak3dd}"
SERVICE_HOME="${OCRDOCS_SERVICE_HOME:-/home/flak3dd}"
IMPORT_ROOT="${OCRDOCS_IMPORT_ROOT:-/home/nick/ocr}"
HEALTH_URL="${OCRDOCS_HEALTH_URL:-http://127.0.0.1:3000/api/health}"
REPO_URL="${OCRDOCS_UPDATE_REPO:-https://github.com/ttfwap-lang/ocrdocs.git}"
BRANCH="${OCRDOCS_UPDATE_BRANCH:-main}"

[[ "${EUID}" -eq 0 ]] || { echo "run as root (sudo)" >&2; exit 1; }
[[ -f "$PROJECT_DIR/scripts/ocrdocs-auto-update.sh" ]] || { echo "missing updater script under $PROJECT_DIR" >&2; exit 1; }
[[ -f "$PROJECT_DIR/deploy/ocrdocs-update.service" ]] || { echo "missing systemd service under $PROJECT_DIR" >&2; exit 1; }
[[ -f "$PROJECT_DIR/deploy/ocrdocs-update.timer" ]] || { echo "missing systemd timer under $PROJECT_DIR" >&2; exit 1; }
id "$SERVICE_USER" >/dev/null 2>&1 || { echo "service user does not exist: $SERVICE_USER" >&2; exit 1; }
[[ -d "$DATA_ROOT" ]] || { echo "runtime data root does not exist: $DATA_ROOT" >&2; exit 1; }
[[ -r "$DATA_ROOT/.env" ]] || { echo "missing runtime env: $DATA_ROOT/.env" >&2; exit 1; }
[[ -r "$DATA_ROOT/.env.worker" ]] || { echo "missing worker env: $DATA_ROOT/.env.worker" >&2; exit 1; }

for path in "$DATA_ROOT" "$RELEASES_ROOT" "$CURRENT_LINK" "$SOURCE_ROOT" "$STATE_ROOT" "$IMPORT_ROOT"; do
  case "$path" in
    /*) ;;
    *) echo "all deployment paths must be absolute: $path" >&2; exit 1;;
  esac
done

# Make the persistent runtime directories usable by the service account. This
# does not move, copy, or delete the database or uploaded documents.
install -d -m 0750 -o "$SERVICE_USER" -g "$SERVICE_USER" \
  "$DATA_ROOT/data" "$DATA_ROOT/storage" "$RELEASES_ROOT" "$SOURCE_ROOT" "$STATE_ROOT"
install -d -m 0750 -o "$SERVICE_USER" -g "$SERVICE_USER" "$IMPORT_ROOT/queued" "$IMPORT_ROOT/parsed"

# Establish a safe initial target before installing the new systemd paths.
if [[ -L "$CURRENT_LINK" ]]; then
  target="$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)"
  [[ -n "$target" && -d "$target" ]] || { echo "current release link is broken: $CURRENT_LINK" >&2; exit 1; }
elif [[ -e "$CURRENT_LINK" ]]; then
  echo "current release path exists but is not a symlink: $CURRENT_LINK" >&2
  exit 1
else
  ln -s "$DATA_ROOT" "$CURRENT_LINK"
fi

install -D -m 0750 "$PROJECT_DIR/scripts/ocrdocs-auto-update.sh" /usr/local/sbin/ocrdocs-auto-update
install -D -m 0644 "$PROJECT_DIR/deploy/ocrdocs-update.service" /etc/systemd/system/ocrdocs-update.service
install -D -m 0644 "$PROJECT_DIR/deploy/ocrdocs-update.timer" /etc/systemd/system/ocrdocs-update.timer

# Root-owned configuration: the updater reads this before starting. It contains
# paths and a public repository URL only; no credentials or tokens belong here.
cat >/etc/default/ocrdocs-update <<EOF
OCRDOCS_UPDATE_REPO=$REPO_URL
OCRDOCS_UPDATE_BRANCH=$BRANCH
OCRDOCS_DATA_ROOT=$DATA_ROOT
OCRDOCS_RELEASES_ROOT=$RELEASES_ROOT
OCRDOCS_CURRENT_LINK=$CURRENT_LINK
OCRDOCS_UPDATE_SOURCE_ROOT=$SOURCE_ROOT
OCRDOCS_UPDATE_STATE_ROOT=$STATE_ROOT
OCRDOCS_SERVICE_USER=$SERVICE_USER
OCRDOCS_SERVICE_HOME=$SERVICE_HOME
OCRDOCS_SERVER_SERVICE=ocrdocs-server.service
OCRDOCS_WORKER_SERVICE=ocrdocs-worker.service
OCRDOCS_HEALTH_URL=$HEALTH_URL
OCRDOCS_KEEP_RELEASES=3
OCRDOCS_HEALTH_RETRIES=45
OCRDOCS_HEALTH_INTERVAL_SECONDS=2
OCRDOCS_WORKER_DRAIN_RETRIES=40
OCRDOCS_WORKER_DRAIN_INTERVAL_SECONDS=15
OCRDOCS_UPDATE_LOG=/var/log/ocrdocs-auto-update.log
OCRDOCS_UPDATE_LOCK=/run/lock/ocrdocs-auto-update.lock
EOF
chmod 0644 /etc/default/ocrdocs-update

# The existing units remain in place. These managed drop-ins change only the
# working directory and persistent paths, so queue settings and the existing
# worker runtime drop-in remain compatible.
install -d -m 0755 /etc/systemd/system/ocrdocs-server.service.d
cat >/etc/systemd/system/ocrdocs-server.service.d/zz-ocrdocs-release.conf <<EOF
[Service]
WorkingDirectory=$CURRENT_LINK
Environment=NODE_ENV=production
Environment=HOST=0.0.0.0
Environment=PORT=3000
Environment=DATABASE_PATH=$DATA_ROOT/data/app.db
Environment=STORAGE_ROOT=$DATA_ROOT/storage/private
Environment=MEDICARE_INDEX_PATH=$DATA_ROOT/data/medicare_index.json
Environment=OCRDOCS_HEADSHOTS_DIR=$DATA_ROOT/data/headshots
Environment=OCRDOCS_HOSTNAME=ocr.local
Environment=OCRDOCS_IMPORT_ROOT=$IMPORT_ROOT
Environment=OCRDOCS_PREPARSE_SHELL=bash
Environment=OCRDOCS_PREPARSE_SCRIPT=$CURRENT_LINK/scripts/pre-parse.sh
Environment=OCRDOCS_QUEUE_WATCH=true
Environment=OCRDOCS_QUEUE_POLL_SECONDS=30
Environment=OCRDOCS_PURGE_UNVERIFIED=true
EOF
chmod 0644 /etc/systemd/system/ocrdocs-server.service.d/zz-ocrdocs-release.conf

if [[ -f /etc/systemd/system/ocrdocs-worker.service ]]; then
  install -d -m 0755 /etc/systemd/system/ocrdocs-worker.service.d
  cat >/etc/systemd/system/ocrdocs-worker.service.d/zz-ocrdocs-release.conf <<EOF
[Service]
WorkingDirectory=$CURRENT_LINK/scripts
EOF
  chmod 0644 /etc/systemd/system/ocrdocs-worker.service.d/zz-ocrdocs-release.conf
fi

# Some older deployments also created the optional lightweight worker template.
# Give it the same stable code path if it exists on this host.
if [[ -f /etc/systemd/system/ocrdocs-worker-lite@.service ]]; then
  install -d -m 0755 /etc/systemd/system/ocrdocs-worker-lite@.service.d
  cat >/etc/systemd/system/ocrdocs-worker-lite@.service.d/zz-ocrdocs-release.conf <<EOF
[Service]
WorkingDirectory=$CURRENT_LINK/scripts
EOF
  chmod 0644 /etc/systemd/system/ocrdocs-worker-lite@.service.d/zz-ocrdocs-release.conf
fi

systemctl daemon-reload
systemctl enable --now ocrdocs-update.timer

echo "Starting the first atomic update (the old release remains available if it fails)..."
if ! systemctl start ocrdocs-update.service; then
  echo "Initial update failed; inspect: journalctl -u ocrdocs-update.service -n 100 --no-pager" >&2
  echo "The previous release link was left in place or restored automatically." >&2
  exit 1
fi

systemctl is-active --quiet ocrdocs-server.service
systemctl is-enabled --quiet ocrdocs-update.timer
printf '\nAutomatic updates installed.\n'
printf '  current release: %s\n' "$(readlink -f "$CURRENT_LINK")"
printf '  timer: systemctl list-timers ocrdocs-update.timer\n'
printf '  log: journalctl -u ocrdocs-update.service -f\n'
printf '  last commit: %s\n' "$(tr -d '[:space:]' <"$STATE_ROOT/last-success-commit" 2>/dev/null || echo unknown)"

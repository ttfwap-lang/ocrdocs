#!/usr/bin/env bash
#
# ocrdocs-auto-update.sh — safe, automatic GX10 application updates.
#
# This script is installed as a root-owned systemd oneshot by
# scripts/install_ocrdocs_auto_update.sh.  It intentionally updates code in
# immutable, versioned release directories and switches the current symlink
# only after a fresh locked dependency install and production build succeed.
# Runtime data, secrets, the SQLite database, uploaded files, and the worker
# environment never live in a release directory.
#
# The updater is fail-safe:
#   * a lock prevents overlapping runs;
#   * a failed fetch/build never changes the current release;
#   * a failed server health check atomically restores the previous release;
#   * the worker is restarted only after its active-job queue has drained.
#
set -Eeuo pipefail
umask 027

# Defaults may be overridden by the root-owned /etc/default/ocrdocs-update.
REPO_URL="${OCRDOCS_UPDATE_REPO:-https://github.com/ttfwap-lang/ocrdocs.git}"
BRANCH="${OCRDOCS_UPDATE_BRANCH:-main}"
DATA_ROOT="${OCRDOCS_DATA_ROOT:-/home/flak3dd/ocrdocs}"
RELEASES_ROOT="${OCRDOCS_RELEASES_ROOT:-/home/flak3dd/ocrdocs-releases}"
CURRENT_LINK="${OCRDOCS_CURRENT_LINK:-/home/flak3dd/ocrdocs-current}"
SOURCE_ROOT="${OCRDOCS_UPDATE_SOURCE_ROOT:-/home/flak3dd/ocrdocs-update-source}"
STATE_ROOT="${OCRDOCS_UPDATE_STATE_ROOT:-/var/lib/ocrdocs-updater}"
SERVICE_USER="${OCRDOCS_SERVICE_USER:-flak3dd}"
SERVICE_HOME="${OCRDOCS_SERVICE_HOME:-/home/flak3dd}"
SERVER_SERVICE="${OCRDOCS_SERVER_SERVICE:-ocrdocs-server.service}"
WORKER_SERVICE="${OCRDOCS_WORKER_SERVICE:-ocrdocs-worker.service}"
HEALTH_URL="${OCRDOCS_HEALTH_URL:-http://127.0.0.1:3000/api/health}"
KEEP_RELEASES="${OCRDOCS_KEEP_RELEASES:-3}"
HEALTH_RETRIES="${OCRDOCS_HEALTH_RETRIES:-45}"
HEALTH_INTERVAL_SECONDS="${OCRDOCS_HEALTH_INTERVAL_SECONDS:-2}"
WORKER_DRAIN_RETRIES="${OCRDOCS_WORKER_DRAIN_RETRIES:-40}"
WORKER_DRAIN_INTERVAL_SECONDS="${OCRDOCS_WORKER_DRAIN_INTERVAL_SECONDS:-15}"
LOG_FILE="${OCRDOCS_UPDATE_LOG:-/var/log/ocrdocs-auto-update.log}"
LOCK_FILE="${OCRDOCS_UPDATE_LOCK:-/run/lock/ocrdocs-auto-update.lock}"

if [[ -r /etc/default/ocrdocs-update ]]; then
  # This file is installed root-owned by the installer.
  # shellcheck disable=SC1091
  source /etc/default/ocrdocs-update
fi

if [[ "${EUID}" -ne 0 ]]; then
  echo "ocrdocs-auto-update must run as root" >&2
  exit 1
fi

mkdir -p "$(dirname "$LOG_FILE")" "$STATE_ROOT" "$RELEASES_ROOT"
touch "$LOG_FILE"
chmod 0640 "$LOG_FILE"

log() {
  local level="$1"
  shift
  local line
  line="$(date --iso-8601=seconds) [$level] $*"
  printf '%s\n' "$line" | tee -a "$LOG_FILE" >&2
}

fail() {
  log ERROR "$*"
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "required command not found: $1"
}

for command_name in curl flock git npm node runuser systemctl systemd-analyze tar install; do
  require_command "$command_name"
done

[[ -d "$DATA_ROOT" ]] || fail "runtime data root does not exist: $DATA_ROOT"
[[ -r "$DATA_ROOT/.env" ]] || fail "runtime environment file is missing: $DATA_ROOT/.env"
id "$SERVICE_USER" >/dev/null 2>&1 || fail "service user does not exist: $SERVICE_USER"
git check-ref-format --branch "$BRANCH" >/dev/null 2>&1 || fail "invalid update branch: $BRANCH"

install -d -m 0750 -o "$SERVICE_USER" -g "$SERVICE_USER" "$RELEASES_ROOT" "$SOURCE_ROOT" "$STATE_ROOT"
install -d -m 0750 -o "$SERVICE_USER" -g "$SERVICE_USER" "$DATA_ROOT/data" "$DATA_ROOT/storage"

# Only one updater may build or switch a release.
exec 9>"$LOCK_FILE"
flock -n 9 || { log INFO "another updater is already running; skipping"; exit 0; }

run_as_service() {
  runuser -u "$SERVICE_USER" -- env HOME="$SERVICE_HOME" PATH="/usr/local/bin:/usr/bin:/bin" "$@"
}

atomic_link() {
  local target="$1"
  local temporary="${CURRENT_LINK}.next.$$"
  [[ -d "$target" ]] || fail "cannot point current release at missing directory: $target"
  rm -f "$temporary"
  ln -s "$target" "$temporary"
  mv -Tf "$temporary" "$CURRENT_LINK"
}

current_target() {
  readlink -f "$CURRENT_LINK" 2>/dev/null || true
}

current_commit() {
  local target
  target="$(current_target)"
  if [[ -n "$target" && -r "$target/.ocrdocs-release" ]]; then
    tr -d '[:space:]' <"$target/.ocrdocs-release"
  fi
}

processing_jobs() {
  # The updater uses the standard-library SQLite client rather than exposing
  # the worker bearer token or adding another database dependency.
  run_as_service python3 - "$DATA_ROOT/data/app.db" <<'PY'
import sqlite3
import sys

path = sys.argv[1]
try:
    connection = sqlite3.connect(path, timeout=2)
    try:
        row = connection.execute(
            "SELECT COUNT(*) FROM jobs WHERE status = 'processing'"
        ).fetchone()
        print(int(row[0] if row else 0))
    finally:
        connection.close()
except Exception:
    # A transient DB lock must not make the updater claim the queue is empty.
    print("-1")
PY
}

wait_for_worker_idle() {
  local attempt count
  for ((attempt = 1; attempt <= WORKER_DRAIN_RETRIES; attempt++)); do
    count="$(processing_jobs)"
    if [[ "$count" == "0" ]]; then
      return 0
    fi
    log INFO "worker still has ${count} processing job(s); waiting (${attempt}/${WORKER_DRAIN_RETRIES})"
    sleep "$WORKER_DRAIN_INTERVAL_SECONDS"
  done
  return 1
}

restart_worker_when_safe() {
  local commit="$1"
  local force_refresh="${2:-0}"
  local pending_file="$STATE_ROOT/worker-pending-commit"

  # A no-op timer pass must not bounce a healthy worker every 15 minutes. The
  # caller passes force_refresh=1 only after switching to a new release; an
  # ordinary pass refreshes only an already-pending failed/deferred update.
  if [[ ! -f "$pending_file" && "$force_refresh" != "1" ]]; then
    log INFO "worker is already marked current; no restart needed"
    return 0
  fi

  if ! systemctl is-active --quiet "$WORKER_SERVICE"; then
    rm -f "$pending_file"
    log INFO "worker service is not active; leaving it stopped"
    return 0
  fi
  printf '%s\n' "$commit" >"$pending_file"

  if ! wait_for_worker_idle; then
    log WARN "worker has active work; update is live, worker refresh deferred until the next timer run"
    return 0
  fi

  log INFO "restarting worker on release ${commit}"
  if systemctl restart "$WORKER_SERVICE" && sleep 2 && systemctl is-active --quiet "$WORKER_SERVICE"; then
    rm -f "$pending_file"
    log INFO "worker is active on release ${commit}"
    return 0
  fi

  log ERROR "worker failed to start on release ${commit}; refresh remains pending"
  return 0
}

health_matches_commit() {
  local commit="$1"
  local body
  body="$(curl -fsS --max-time 4 "$HEALTH_URL" 2>/dev/null || true)"
  [[ -n "$body" ]] || return 1
  # Express emits compact JSON. The build marker is non-secret and lets the
  # updater distinguish a healthy old process from the newly switched one.
  printf '%s' "$body" | grep -Fq '"build_commit":"'"$commit"'"'
}

wait_for_health() {
  local commit="$1"
  local attempt
  for ((attempt = 1; attempt <= HEALTH_RETRIES; attempt++)); do
    if health_matches_commit "$commit"; then
      return 0
    fi
    sleep "$HEALTH_INTERVAL_SECONDS"
  done
  return 1
}

prune_releases() {
  local keep="$KEEP_RELEASES"
  [[ "$keep" =~ ^[1-9][0-9]*$ ]] || keep=3
  local current
  current="$(current_target)"
  local old
  while IFS= read -r old; do
    [[ -n "$old" ]] || continue
    [[ "$old" == "$current" ]] && continue
    # Only remove directories whose names are full commit hashes. Never let a
    # malformed path turn housekeeping into an unbounded delete.
    if [[ "$old" =~ /[0-9a-f]{40}$ ]]; then
      rm -rf -- "$old"
    fi
  done < <(
    find "$RELEASES_ROOT" -mindepth 1 -maxdepth 1 -type d -regextype posix-extended \
      -regex '.*/[0-9a-f]{40}' -printf '%T@ %p\n' 2>/dev/null \
      | sort -nr | tail -n "+$((keep + 1))" | cut -d' ' -f2-
  )
}

refresh_control_plane() {
  local release_dir="$1"
  local candidate_unit temporary log_target

  # The updater must be able to repair future updater bugs without requiring a
  # second manual deployment. The running shell keeps its open script inode;
  # the next timer invocation uses this atomically replaced copy.
  if [[ -s "$release_dir/scripts/ocrdocs-auto-update.sh" ]] && bash -n "$release_dir/scripts/ocrdocs-auto-update.sh"; then
    temporary="/usr/local/sbin/.ocrdocs-auto-update.$$"
    if install -m 0750 "$release_dir/scripts/ocrdocs-auto-update.sh" "$temporary" && mv -Tf "$temporary" /usr/local/sbin/ocrdocs-auto-update; then
      log INFO "installed the release's updater script for the next timer run"
    else
      rm -f "$temporary"
      log WARN "could not refresh the updater script; the current copy remains active"
    fi
  else
    log WARN "release updater script failed syntax validation; keeping the current updater"
  fi

  # Unit changes are uncommon, but refresh them too when systemd can validate
  # them. A bad future unit must not take down the already-running application.
  for unit in ocrdocs-update.service ocrdocs-update.timer; do
    candidate_unit="$release_dir/deploy/$unit"
    [[ -s "$candidate_unit" ]] || continue
    if systemd-analyze verify "$candidate_unit" >/dev/null 2>&1; then
      log_target="/etc/systemd/system/.${unit}.$$"
      if install -m 0644 "$candidate_unit" "$log_target" && mv -Tf "$log_target" "/etc/systemd/system/$unit"; then
        log INFO "refreshed systemd unit ${unit}"
      else
        rm -f "$log_target"
        log WARN "could not refresh systemd unit ${unit}; keeping the current unit"
      fi
    else
      log WARN "new ${unit} failed systemd validation; keeping the current unit"
    fi
  done
  systemctl daemon-reload || log WARN "systemd daemon-reload failed after unit refresh"
}

# Keep a shell-safe record of the last successful run without putting secrets
# in the repository or in the updater's command line.
printf '%s\n' "$(date --iso-8601=seconds)" >"$STATE_ROOT/last-run-started"
BUILD_DIR=""
SWITCHED=0
PREVIOUS_TARGET="$(current_target)"

on_exit() {
  local status=$?
  if [[ -n "$BUILD_DIR" && -d "$BUILD_DIR" ]]; then
    rm -rf -- "$BUILD_DIR"
  fi
  if [[ "$status" -ne 0 && "$SWITCHED" -eq 1 && -n "$PREVIOUS_TARGET" && -d "$PREVIOUS_TARGET" ]]; then
    log ERROR "update failed after switching; restoring previous release ${PREVIOUS_TARGET}"
    atomic_link "$PREVIOUS_TARGET" || true
    systemctl restart "$SERVER_SERVICE" || true
    if systemctl is-active --quiet "$WORKER_SERVICE"; then
      systemctl restart "$WORKER_SERVICE" || true
    fi
  fi
  exit "$status"
}
trap on_exit EXIT

# The source checkout is updater-owned. It is never the live application and
# can therefore be reset/fetched without touching runtime data or user files.
if [[ ! -d "$SOURCE_ROOT/.git" ]]; then
  rm -rf -- "$SOURCE_ROOT"
  install -d -m 0750 -o "$SERVICE_USER" -g "$SERVICE_USER" "$SOURCE_ROOT"
  log INFO "creating updater source checkout"
  run_as_service git clone --filter=blob:none --no-checkout "$REPO_URL" "$SOURCE_ROOT"
else
  run_as_service git -C "$SOURCE_ROOT" remote set-url origin "$REPO_URL"
fi

log INFO "fetching ${BRANCH} from ${REPO_URL}"
run_as_service git -C "$SOURCE_ROOT" fetch --prune --depth=1 origin "$BRANCH"
COMMIT="$(run_as_service git -C "$SOURCE_ROOT" rev-parse FETCH_HEAD)"
[[ "$COMMIT" =~ ^[0-9a-f]{40}$ ]] || fail "updater received an invalid commit id"
run_as_service git -C "$SOURCE_ROOT" checkout --detach --force "$COMMIT" >/dev/null

PREVIOUS_COMMIT="$(current_commit)"
if [[ "$PREVIOUS_COMMIT" == "$COMMIT" ]] && health_matches_commit "$COMMIT"; then
  log INFO "already on current commit ${COMMIT}; refreshing worker if needed"
  restart_worker_when_safe "$COMMIT"
  prune_releases
  printf '%s\n' "$COMMIT" >"$STATE_ROOT/last-success-commit"
  exit 0
fi

log INFO "building release ${COMMIT}"
BUILD_DIR="$(mktemp -d "$RELEASES_ROOT/.build-${COMMIT}.XXXXXX")"
# git archive is a clean, tracked-file-only input: secrets, data, uploads,
# node_modules, and local build artifacts cannot leak into a release.
run_as_service git -C "$SOURCE_ROOT" archive "$COMMIT" | tar -x -C "$BUILD_DIR"
chown -R "$SERVICE_USER:$SERVICE_USER" "$BUILD_DIR"

log INFO "installing locked Node dependencies"
run_as_service npm --prefix "$BUILD_DIR" ci --no-audit --no-fund
log INFO "building production frontend and server bundle"
run_as_service npm --prefix "$BUILD_DIR" run build
[[ -s "$BUILD_DIR/dist/index.html" ]] || fail "build did not produce dist/index.html"
[[ -s "$BUILD_DIR/dist/server.cjs" ]] || fail "build did not produce dist/server.cjs"
run_as_service node --check "$BUILD_DIR/dist/server.cjs"

# Runtime paths deliberately remain outside the release. The symlinks also
# preserve relative-path compatibility for code that expects data/ or storage/.
printf '%s\n' "$COMMIT" >"$BUILD_DIR/.ocrdocs-release"
chown "$SERVICE_USER:$SERVICE_USER" "$BUILD_DIR/.ocrdocs-release"
chmod 0644 "$BUILD_DIR/.ocrdocs-release"
ln -s "$DATA_ROOT/.env" "$BUILD_DIR/.env"
ln -s "$DATA_ROOT/.env.worker" "$BUILD_DIR/.env.worker"
ln -s "$DATA_ROOT/data" "$BUILD_DIR/data"
ln -s "$DATA_ROOT/storage" "$BUILD_DIR/storage"
chown -h "$SERVICE_USER:$SERVICE_USER" "$BUILD_DIR/.env" "$BUILD_DIR/.env.worker" "$BUILD_DIR/data" "$BUILD_DIR/storage"
chmod 0755 "$BUILD_DIR/scripts/pre-parse.sh" 2>/dev/null || true

RELEASE_DIR="$RELEASES_ROOT/$COMMIT"
if [[ -e "$RELEASE_DIR" ]]; then
  log INFO "release directory already exists; replacing incomplete build"
  [[ "$RELEASE_DIR" != "$(current_target)" ]] || fail "refusing to replace the active release"
  rm -rf -- "$RELEASE_DIR"
fi
mv -- "$BUILD_DIR" "$RELEASE_DIR"
BUILD_DIR=""

log INFO "switching current release to ${COMMIT}"
atomic_link "$RELEASE_DIR"
SWITCHED=1
systemctl restart "$SERVER_SERVICE"
if ! wait_for_health "$COMMIT"; then
  fail "new release did not become healthy; rolling back"
fi

refresh_control_plane "$RELEASE_DIR"
log INFO "server is healthy on ${COMMIT}; refreshing worker when its queue is idle"
restart_worker_when_safe "$COMMIT" 1
prune_releases
printf '%s\n' "$COMMIT" >"$STATE_ROOT/last-success-commit"
printf '%s\n' "$(date --iso-8601=seconds)" >"$STATE_ROOT/last-success-time"
log INFO "update complete: ${COMMIT}"
exit 0

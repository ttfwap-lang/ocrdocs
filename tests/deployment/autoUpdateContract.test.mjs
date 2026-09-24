import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function read(relativePath) {
  return fs.readFile(path.join(root, relativePath), 'utf8');
}

test('automatic GX10 updates are atomic, locked, and fail closed', async () => {
  const updater = await read('scripts/ocrdocs-auto-update.sh');
  assert.match(updater, /flock -n/);
  assert.match(updater, /BUILD_USER/);
  assert.match(updater, /run_as_builder/);
  assert.match(updater, /git archive/);
  assert.match(updater, /npm --prefix .* ci/);
  assert.match(updater, /npm --prefix .* run lint/);
  assert.match(updater, /npm --prefix .* run build/);
  assert.match(updater, /wait_for_health/);
  assert.match(updater, /restoring previous release/);
  assert.match(updater, /refresh_control_plane/);
  assert.match(updater, /bash -n/);
  assert.match(updater, /processing_jobs/);
  assert.match(updater, /refresh_lite_workers/);
  assert.match(updater, /database_backup/);
  assert.match(updater, /PREVIOUS_LINK/);
  assert.match(updater, /LAST_GOOD_LINK/);
  assert.match(updater, /DATA_ROOT\/\.env/);
  assert.doesNotMatch(updater, /DGX_WORKER_TOKEN\s*=\s*['"][^'"]+['"]/);
  const reconciler = await read('scripts/reconcile_verified_corpus.py');
  assert.match(reconciler, /integrity_check/);
  assert.match(reconciler, /--backup/);
  assert.match(reconciler, /verif/);
  assert.match(reconciler, /latest_extraction_id/);
  const liveAudit = await read('scripts/live_dom_audit.mjs');
  assert.match(liveAudit, /unassigned/);
  assert.match(liveAudit, /\/api\/medicare\/summary/);
  assert.match(liveAudit, /process\.exitCode/);
  const criticalAudit = await read('scripts/audit_critical_fields.py');
  assert.match(criticalAudit, /critical_field_audit/);
  assert.match(criticalAudit, /integrity_check/);
  assert.match(criticalAudit, /--backup/);
});

test('systemd timer and installer are present and use the release symlink', async () => {
  const [service, timer, installer] = await Promise.all([
    read('deploy/ocrdocs-update.service'),
    read('deploy/ocrdocs-update.timer'),
    read('scripts/install_ocrdocs_auto_update.sh'),
  ]);
  assert.match(service, /ExecStart=\/usr\/local\/sbin\/ocrdocs-auto-update/);
  assert.match(timer, /OnUnitActiveSec=15min/);
  assert.match(timer, /Persistent=true/);
  assert.match(installer, /ocrdocs-current/);
  assert.match(installer, /OCRDOCS_BUILD_USER/);
  assert.doesNotMatch(installer, /Environment=OCRDOCS_QUEUE_WATCH=true/);
  assert.doesNotMatch(installer, /Environment=OCRDOCS_PURGE_UNVERIFIED=true/);
  assert.match(installer, /systemctl enable --now ocrdocs-update\.timer/);
  assert.doesNotMatch(installer, /DGX_WORKER_TOKEN\s*=\s*['"][^'"]+['"]/);
});

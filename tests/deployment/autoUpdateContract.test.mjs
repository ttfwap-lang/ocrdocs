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
  assert.match(updater, /git archive/);
  assert.match(updater, /npm --prefix .* ci/);
  assert.match(updater, /npm --prefix .* run build/);
  assert.match(updater, /wait_for_health/);
  assert.match(updater, /restoring previous release/);
  assert.match(updater, /refresh_control_plane/);
  assert.match(updater, /bash -n/);
  assert.match(updater, /processing_jobs/);
  assert.match(updater, /DATA_ROOT\/\.env/);
  assert.doesNotMatch(updater, /Plentyon1|flak3dd;/);
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
  assert.match(installer, /systemctl enable --now ocrdocs-update\.timer/);
  assert.doesNotMatch(installer, /Plentyon1|flak3dd;/);
});

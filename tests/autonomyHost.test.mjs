import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareHost, runHost, waitForIdle } from '../scripts/autonomy/host.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = async (root, file) => JSON.parse(await fs.readFile(path.join(root, 'automation', file), 'utf8'));
const write = async (root, file, value) => fs.writeFile(path.join(root, 'automation', file), JSON.stringify(value));
async function fixture(t) {
  const parent = path.join(project, 'automation', 'test-fixtures');
  await fs.mkdir(parent, { recursive: true });
  const root = await fs.mkdtemp(path.join(parent, 'host-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'automation'));
  await fs.mkdir(path.join(root, 'scripts', 'autonomy'), { recursive: true });
  await fs.writeFile(path.join(root, 'scripts', 'autonomy', 'fixture.mjs'), 'verified controller fixture');
  await fs.writeFile(path.join(root, 'STATE.md'), 'Test-only host state\n');
  await write(root, 'checkpoint.json', { nextStage: 2, deadline: Date.now() + 60000 });
  return root;
}
function callbacks() {
  const calls = [];
  return { calls, execute: async (command, args) => { calls.push(args.at(-1)); return { code: 0, output: 'Test double, not real validation' }; }, refresh: async () => { calls.push('refresh'); }, loop: async () => { calls.push('loop'); return { status: 'test-window-complete' }; } };
}

test('host verifies, refreshes and hands off without renewing the original deadline', async t => {
  const root = await fixture(t);
  const request = await prepareHost(root);
  const hooks = callbacks();
  await runHost(root, hooks);
  assert.deepEqual(hooks.calls, ['test', 'lint', 'build', 'refresh', 'loop']);
  assert.equal((await read(root, 'host-handoff.json')).deadline, request.deadline);
  assert.equal((await read(root, 'host-status.json')).phase, 'finished');
  await assert.rejects(fs.stat(path.join(root, 'automation', 'STOP')), { code: 'ENOENT' });
  await runHost(root, { loop: async () => { throw new Error('Must not replay a finished invocation'); } });
});

test('host never overwrites an existing handoff or user STOP request', async t => {
  const root = await fixture(t);
  await prepareHost(root);
  await assert.rejects(prepareHost(root), /must not be overwritten/);
  await fs.writeFile(path.join(root, 'automation', 'STOP'), 'User asked to stop');
  const hooks = callbacks();
  await assert.rejects(runHost(root, hooks), /User stop request/);
  assert.deepEqual(hooks.calls, []);
  assert.equal(await fs.readFile(path.join(root, 'automation', 'STOP'), 'utf8'), 'User asked to stop');
});

test('changed controller or failed verification prevents scheduled execution', async t => {
  const root = await fixture(t);
  await prepareHost(root);
  await fs.writeFile(path.join(root, 'scripts', 'autonomy', 'fixture.mjs'), 'changed');
  await assert.rejects(runHost(root, callbacks()), /Controller changed/);
  const other = await fixture(t);
  await prepareHost(other);
  let launched = false;
  await assert.rejects(runHost(other, { execute: async () => ({ code: 1, output: 'Failed test' }), loop: async () => { launched = true; } }), /Host verification failed/);
  assert.equal(launched, false);
});

test('expired deadlines and malformed locks block without killing unrelated processes', async t => {
  const root = await fixture(t);
  await prepareHost(root);
  const request = await read(root, 'host-handoff.json');
  await write(root, 'host-handoff.json', { ...request, deadline: Date.now() - 1 });
  await assert.rejects(runHost(root, callbacks()), /deadline.*exhausted/);
  await write(root, 'runner.lock', { pid: -1 });
  await assert.rejects(waitForIdle(root, Date.now() + 1000), /Invalid existing runner owner/);
  await write(root, 'runner.lock', { pid: process.pid });
  await assert.rejects(waitForIdle(root, Date.now() + 20, { pollMs: 5 }), /deadline exhausted/);
});

test('host waits for a live runner to release its lock before proceeding', async t => {
  const root = await fixture(t);
  await write(root, 'runner.lock', { pid: process.pid });
  const waiting = assert.doesNotReject(waitForIdle(root, Date.now() + 1000, { pollMs: 5 }));
  await fs.unlink(path.join(root, 'automation', 'runner.lock'));
  await waiting;
});

test('interrupted ready handoff resumes without repeating controller maintenance', async t => {
  const root = await fixture(t);
  const request = await prepareHost(root);
  await write(root, 'host-handoff.json', { ...request, phase: 'ready' });
  await fs.unlink(path.join(root, 'automation', 'STOP'));
  const hooks = callbacks();
  await runHost(root, hooks);
  assert.deepEqual(hooks.calls, ['loop']);
});
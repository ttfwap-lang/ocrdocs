import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runWorker, runWorkerScript } from './helpers/workerHarness.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function fixture(t, source) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ocrdocs-stage7-'));
  const file = path.join(directory, 'fixture.mjs');
  await fs.writeFile(file, source, 'utf8');
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return file;
}

test('categorized npm commands are explicit, discoverable, and included in test:all', async () => {
  const packageJson = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  const required = ['test:unit', 'test:integration', 'test:worker', 'test:browser', 'test:deployment', 'test:governance', 'test:all'];
  for (const name of required.slice(0, -1)) {
    assert.equal(typeof packageJson.scripts[name], 'string', `${name} must be declared`);
    assert.match(packageJson.scripts[name], /node --test/, `${name} must invoke Node's visible test runner`);
  }
  assert.equal(typeof packageJson.scripts['test:all'], 'string', 'test:all must be declared');
  for (const name of required.slice(0, -1)) assert.match(packageJson.scripts['test:all'], new RegExp(`test:${name.slice(5)}`));
  assert.doesNotMatch(packageJson.scripts['test:all'], /\|\||catch|true\s*$/i, 'test:all must not swallow failures');
});

test('seeded worker test failures preserve stderr and return a non-zero exit code', async (t) => {
  const file = await fixture(t, "process.stderr.write('SEEDED_FAILURE\\n'); process.exit(17);\n");
  const result = await runWorker(process.execPath, [file], { timeoutMs: 5_000 });
  assert.equal(result.code, 17);
  assert.equal(result.exitCode, 17);
  assert.equal(result.failed, true);
  assert.match(result.stderr, /SEEDED_FAILURE/);
});

test('seeded worker timeout is bounded and fails instead of becoming a pass', async (t) => {
  const file = await fixture(t, 'setInterval(() => {}, 1_000);\n');
  const result = await runWorker(process.execPath, [file], { timeoutMs: 100 });
  assert.equal(result.timedOut, true);
  assert.equal(result.exitCode, 124);
  assert.equal(result.failed, true);
  assert.ok(result.durationMs < 5_000, `timeout took ${result.durationMs}ms`);
});

test('successful worker output remains visible and secrets are redacted', async (t) => {
  const file = await fixture(t, "console.log('WORKER_STDOUT'); console.error('token=private-worker-secret');\n");
  const result = await runWorker(process.execPath, [file], {
    timeoutMs: 5_000,
    redactValues: ['private-worker-secret'],
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.failed, false);
  assert.match(result.stdout, /WORKER_STDOUT/);
  assert.doesNotMatch(result.output, /private-worker-secret/);
  assert.match(result.stderr, /token=\[REDACTED\]/);
});

test('worker script adapter passes the script path and captures its result', async (t) => {
  const file = await fixture(t, "console.log(process.argv[1].replaceAll('\\\\', '/').endsWith('/fixture.mjs') ? 'SCRIPT_ADAPTER_OK' : 'SCRIPT_ADAPTER_BAD');\n");
  const result = await runWorkerScript(file, [], { pythonCommand: process.execPath, timeoutMs: 5_000 });
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /SCRIPT_ADAPTER_OK/);
});

test('worker output cap terminates a flooding process with a failing status', async (t) => {
  const file = await fixture(t, "process.stdout.write('x'.repeat(100_000)); setInterval(() => {}, 1_000);\n");
  const result = await runWorker(process.execPath, [file], { timeoutMs: 5_000, outputLimit: 1_024 });
  assert.equal(result.outputLimitReached, true);
  assert.equal(result.exitCode, 124);
  assert.equal(result.failed, true);
});

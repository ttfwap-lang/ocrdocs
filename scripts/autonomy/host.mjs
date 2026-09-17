import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { redact, refreshController, renameWithRetry, runLoop, runProcess, snapshot } from './runner.mjs';

const controls = name => name.startsWith('scripts/autonomy/') || name === 'tests/autonomy.test.mjs' || name === 'tests/autonomyHost.test.mjs';
const load = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const present = async file => fs.access(file).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
const store = async (file, data) => {
  await fs.writeFile(`${file}.pending`, JSON.stringify(data, null, 2) + '\n');
  await renameWithRetry(`${file}.pending`, file);
};
const fingerprint = files => Object.fromEntries(Object.entries(files).filter(([name]) => controls(name)).map(([name, value]) => [name, value.hash]));

export async function prepareHost(root) {
  const directory = path.join(root, 'automation');
  await fs.mkdir(directory, { recursive: true });
  const checkpoint = await load(path.join(directory, 'checkpoint.json'));
  if (!Number.isFinite(checkpoint.deadline) || checkpoint.deadline <= Date.now()) throw new Error('A valid unexpired checkpoint is required');
  const handoffFile = path.join(directory, 'host-handoff.json');
  if (await present(handoffFile)) throw new Error('An existing host handoff must not be overwritten');
  const request = { version: 1, phase: 'prepared', deadline: checkpoint.deadline, stopToken: `Verified controller handoff ${randomUUID()}`, controls: fingerprint(await snapshot(root)) };
  await fs.writeFile(path.join(directory, 'STOP'), request.stopToken, { flag: 'wx' });
  await store(handoffFile, request);
  return request;
}

export async function waitForIdle(root, deadline, { pollMs = 1000, signal } = {}) {
  const lockFile = path.join(root, 'automation', 'runner.lock');
  while (await present(lockFile)) {
    if (signal?.aborted) throw new Error('Host stop requested');
    if (Date.now() >= deadline) throw new Error('Host deadline exhausted while waiting for existing runner');
    let owner;
    try { owner = await load(lockFile); } catch (error) {
      if (error.code === 'ENOENT' || !(await present(lockFile))) return;
      throw new Error(`Invalid existing runner lock: ${error.message}`);
    }
    if (!Number.isInteger(owner.pid) || owner.pid < 1) throw new Error('Invalid existing runner owner');
    try { process.kill(owner.pid, 0); } catch (error) { if (error.code === 'ESRCH') return; throw error; }
    await delay(Math.min(pollMs, Math.max(1, deadline - Date.now())), undefined, { signal });
  }
}

export async function runHost(root, dependencies = {}) {
  const execute = dependencies.execute ?? runProcess;
  const refresh = dependencies.refresh ?? refreshController;
  const loop = dependencies.loop ?? runLoop;
  const signal = dependencies.signal;
  const directory = path.join(root, 'automation');
  const handoffFile = path.join(directory, 'host-handoff.json');
  const statusFile = path.join(directory, 'host-status.json');
  const status = async (phase, details = '') => store(statusFile, { phase, details: redact(details), updatedAt: new Date().toISOString() });
  let handoff;
  try {
    handoff = await load(handoffFile);
    if (handoff.version !== 1 || !Number.isFinite(handoff.deadline) || typeof handoff.stopToken !== 'string' || !handoff.stopToken || !handoff.controls || !['prepared', 'ready', 'running', 'blocked', 'finished'].includes(handoff.phase)) throw new Error('Invalid host handoff');
    if (handoff.deadline <= Date.now()) throw new Error('Original 72-hour deadline is exhausted');
    if (handoff.phase === 'finished') { await status('finished', 'No replay of a finished host invocation'); return; }
    await status('waiting', 'Waiting for the existing runner without terminating it');
    await waitForIdle(root, handoff.deadline, { signal, pollMs: dependencies.pollMs ?? 1000 });
    const expected = handoff.controls;
    const current = fingerprint(await snapshot(root));
    if (JSON.stringify(Object.entries(expected).sort()) !== JSON.stringify(Object.entries(current).sort())) throw new Error('Controller changed after verified host preparation');
    const stopFile = path.join(directory, 'STOP');
    if (await present(stopFile) && await fs.readFile(stopFile, 'utf8') !== handoff.stopToken) throw new Error('User stop request must not be removed by the host');
    if (handoff.phase === 'prepared') {
      if (!(await present(stopFile))) throw new Error('Expected maintenance stop request is missing');
      await status('verifying', 'Checking accepted source before controller maintenance');
      for (const script of ['test', 'lint', 'build']) {
        const result = await execute('npm', ['run', script], { cwd: root, timeoutMs: Math.max(1, Math.min(180000, handoff.deadline - Date.now())), signal });
        await store(path.join(directory, `host-verify-${script}.json`), { code: result.code, reason: result.reason ?? null, output: redact(result.output ?? '') });
        if (result.code !== 0) throw new Error(`Host verification failed: ${script}`);
      }
      if (Date.now() >= handoff.deadline) throw new Error('Original deadline exhausted before handoff');
      await refresh(root);
      handoff.phase = 'ready';
      await store(handoffFile, handoff);
    }
    if (await present(stopFile)) {
      if (await fs.readFile(stopFile, 'utf8') !== handoff.stopToken) throw new Error('Stop request changed during maintenance');
      await fs.unlink(stopFile);
    }
    handoff.phase = 'running';
    await store(handoffFile, handoff);
    await status('running', 'Session-independent bounded runner; not a production-readiness certification');
    const result = await loop(root, { hours: 72, commandSeconds: 1800, maxPivots: 3, startStage: 2, endStage: 55 }, execute, signal);
    handoff.phase = 'finished';
    await store(handoffFile, handoff);
    await status('finished', result?.status ?? 'Runner returned');
    return result;
  } catch (error) {
    await status('blocked', error.message);
    await fs.appendFile(path.join(root, 'STATE.md'), `\n- ${new Date().toISOString()} Scheduled host blocked: ${redact(error.message)}\n`);
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const signal = new AbortController();
  process.on('SIGINT', () => signal.abort()); process.on('SIGTERM', () => signal.abort());
  try {
    if (process.argv.length === 3 && process.argv[2] === '--prepare') await prepareHost(root);
    else if (process.argv.length === 2) await runHost(root, { signal: signal.signal });
    else throw new Error('Only --prepare is supported');
  } catch (error) { console.error(redact(error.message)); process.exitCode = 1; }
}
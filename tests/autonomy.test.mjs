import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyJournal, assertProtected, options, promotionJournal, redact, refreshController, roadmap, runLoop, runProcess, snapshot } from '../scripts/autonomy/runner.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const charter = await fs.readFile(path.join(project, 'PROJECT_CHARTER.md'), 'utf8');
const write = async (root, name, value) => {
  const file = path.join(root, name);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, typeof value === 'string' ? value : JSON.stringify(value));
};
const json = async (root, name) => JSON.parse(await fs.readFile(path.join(root, name), 'utf8'));

async function fixture(t) {
  const base = path.join(project, 'automation', 'test-fixtures');
  await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, 'runner-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await write(root, 'PROJECT_CHARTER.md', charter);
  await write(root, 'RULES.md', 'Do not change protected files.');
  await write(root, 'STATE.md', '# Test state\n');
  await write(root, 'src/value.js', 'original');
  await write(root, 'package.json', { scripts: { lint: 'lint', build: 'build', test: 'test' } });
  return root;
}

function fakeAgent(hook = async () => undefined) {
  const calls = [];
  const execute = async (command, args, context) => {
    const task = command === 'junie' ? await fs.readFile(path.join(context.cwd, args.at(-1).match(/^Read (.+?) and /)[1]), 'utf8') : args.at(-1);
    const phase = command !== 'junie' ? args.join(' ') : task.includes('Planning only:') ? 'plan' : task.includes('Execute .autonomy/plan.json.') ? 'execute' : 'review';
    calls.push({ command, phase, cwd: context.cwd });
    const override = await hook({ command, args, phase, cwd: context.cwd, calls });
    if (override) return override;
    if (command === 'junie') {
      const stage = Number(task.match(/Stage (\d+):/)[1]);
      if (phase === 'plan') await write(context.cwd, '.autonomy/plan.json', { stage, steps: ['Inspect inputs', 'Implement contract', 'Verify failures'], tests: ['node tests'], acceptance: ['Verified contract'], blockers: [], pivotReason: 'Different isolated approach using explicit contract validation' });
      if (phase === 'execute') {
        await write(context.cwd, 'src/value.js', `implemented stage ${stage}`);
        await write(context.cwd, '.autonomy/report.json', { stage, status: 'implemented', summary: `Verified test fixture stage ${stage}`, checks: [{ command: 'node', args: ['--test', 'tests/example.test.mjs'] }], evidence: ['src/value.js'], errors: [], fixes: [], blockers: [] });
      }
      if (phase === 'review') await write(context.cwd, '.autonomy/review.json', { stage, approved: true, findings: [], blockers: [], evidence: ['Inspected src/value.js and tests'] });
    }
    return { code: 0, output: 'Controlled test double, not real agent execution' };
  };
  return { execute, calls };
}

test('charter contains all 55 consecutive stages and rejects missing/duplicate gates', () => {
  assert.equal(roadmap(charter).length, 55);
  assert.equal(roadmap(charter)[54].number, 55);
  assert.throws(() => roadmap(charter.replace('### Stage 2 —', '### Stage 1 —')));
  assert.throws(() => roadmap(charter.replaceAll('Gate:', 'No gate:')));
});

test('runtime and retry budgets reject unlimited, non-finite and invalid ranges', () => {
  assert.equal(options().hours, 72);
  for (const value of [{ hours: Infinity }, { hours: 73 }, { hours: 0 }, { maxPivots: -1 }, { startStage: 1.5 }, { startStage: 4, endStage: 3 }]) assert.throws(() => options(value));
});

test('redacts configured credentials and bearer values', () => {
  assert.equal(redact('token=secret-value Bearer abc.def', { OPENAI_API_KEY: 'secret-value' }), 'token=[REDACTED] Bearer [REDACTED]');
});

test('real subprocess preserves failures, handles spawn errors and enforces timeout', async () => {
  const failed = await runProcess(process.execPath, ['-e', 'process.exit(7)'], { timeoutMs: 5000 });
  assert.equal(failed.code, 7);
  const timeout = await runProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 150 });
  assert.equal(timeout.reason, 'timeout');
  assert.notEqual(timeout.code, 0);
  const missing = await runProcess('ocrdocs-nonexistent-executable.exe', [], { timeoutMs: 3000 });
  assert.equal(missing.reason, 'spawn');
});

test('subprocess abort terminates its owned process and redacts captured secrets', async () => {
  const controller = new AbortController();
  controller.abort();
  const stopped = await runProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 5000, signal: controller.signal });
  assert.equal(stopped.reason, 'stop-request');
  const captured = await runProcess(process.execPath, ['-e', 'console.log(process.env.TEST_API_KEY)'], { timeoutMs: 5000, environment: { ...process.env, TEST_API_KEY: 'private-test-secret' } });
  assert.equal(captured.code, 0);
  assert.ok(!captured.output.includes('private-test-secret'));
});

test('subprocess output respects a byte cap and preserves split UTF-8 sequences', async () => {
  const unicode = await runProcess(process.execPath, ['-e', "const bytes=Buffer.from('€'); process.stdout.write(bytes.subarray(0,1)); setTimeout(()=>process.stdout.write(bytes.subarray(1)),30)"], { timeoutMs: 5000 });
  assert.equal(unicode.output, '€');
  const flood = await runProcess(process.execPath, ['-e', "process.stdout.write('€'.repeat(600000)); setInterval(()=>{},1000)"], { timeoutMs: 5000 });
  assert.equal(flood.reason, 'output-limit');
  assert.ok(Buffer.byteLength(flood.output) <= 1024 * 1024);
});

test('snapshots exclude recovered data and reject source junctions', async t => {
  const root = await fixture(t);
  await write(root, 'Recovered_C/private.txt', 'do not inspect');
  assert.ok(!Object.keys(await snapshot(root)).some(name => name.includes('Recovered_C')));
  await fs.symlink(path.join(root, 'Recovered_C'), path.join(root, 'src', 'link'), 'junction');
  await assert.rejects(snapshot(root), /Symlinks/);
});

test('real project source including Windows cloud placeholders can be snapshotted', async () => {
  const files = await snapshot(project);
  assert.ok(files['package.json']);
  assert.ok(files['bun.lock']);
  assert.ok(files['src/App.tsx']);
});

test('controller guidance and verification scripts cannot be weakened', async t => {
  const root = await fixture(t);
  const before = await snapshot(root);
  await write(root, 'RULES.md', 'pretend all checks pass');
  const changedRules = await snapshot(root);
  assert.throws(() => assertProtected(before, changedRules), /Protected/);
  await write(root, 'RULES.md', 'Do not change protected files.');
  await write(root, 'package.json', { scripts: { lint: 'lint', build: 'build', test: 'exit 0' } });
  const after = await snapshot(root);
  assert.throws(() => assertProtected(before, after), /verification command/);
});

test('passing controller workflow plans, verifies, reviews, promotes and continues', async t => {
  const root = await fixture(t);
  const agent = fakeAgent();
  const state = await runLoop(root, { endStage: 3 }, agent.execute);
  assert.deepEqual(state.completed, [2, 3]);
  assert.equal(state.status, 'window-complete');
  assert.equal(state.nextStage, 4);
  assert.equal(await fs.readFile(path.join(root, 'src/value.js'), 'utf8'), 'implemented stage 3');
  assert.equal(agent.calls.filter(call => call.phase === 'plan').length, 2);
  assert.equal(agent.calls.filter(call => call.phase === 'review').length, 2);
  assert.ok(agent.calls.some(call => call.phase === 'run test'));
  const resumed = await runLoop(root, { endStage: 3 }, async () => { throw new Error('Completed stage must not rerun'); });
  assert.equal(resumed.nextStage, 4);
});

test('zero agent exit without evidence cannot pass and attempts are bounded', async t => {
  const root = await fixture(t);
  let calls = 0;
  await assert.rejects(runLoop(root, { endStage: 2, maxPivots: 0 }, async () => { calls++; return { code: 0, output: 'Done' }; }), /budget exhausted/);
  assert.equal(calls, 4);
  assert.equal((await json(root, 'automation/checkpoint.json')).status, 'blocked');
  assert.equal(await fs.readFile(path.join(root, 'src/value.js'), 'utf8'), 'original');
});

test('four same-check failures pivot to fresh source and receive a fresh retry budget', async t => {
  const root = await fixture(t);
  let failures = 0;
  let pivotPlans = 0;
  const agent = fakeAgent(async ({ phase, cwd }) => {
    if (phase === 'plan' && cwd.includes('pivot-1')) { pivotPlans++; assert.equal(await fs.readFile(path.join(cwd, 'src/value.js'), 'utf8'), 'original'); }
    if (phase === 'run test' && failures++ < 6) return { code: 1, output: 'Same assertion fails' };
  });
  const result = await runLoop(root, { endStage: 2 }, agent.execute);
  assert.equal(result.nextStage, 3);
  assert.equal(pivotPlans, 1);
  assert.equal(agent.calls.filter(call => call.phase === 'execute').length, 7);
});

test('retry receives the actual failing check diagnostics', async t => {
  const root = await fixture(t);
  let failed = false;
  let observed = false;
  const agent = fakeAgent(async ({ phase, cwd }) => {
    if (phase === 'run test' && !failed) { failed = true; return { code: 1, output: 'Assertion failed: preserved applicant id was wrong' }; }
    if (phase === 'execute' && failed) { observed = true; assert.match((await json(cwd, '.autonomy/failure.json')).diagnostics, /preserved applicant id/); }
  });
  assert.equal((await runLoop(root, { endStage: 2 }, agent.execute)).nextStage, 3);
  assert.ok(observed);
});

test('review rejection prevents promotion even when automated checks pass', async t => {
  const root = await fixture(t);
  const agent = fakeAgent(async ({ phase, cwd }) => {
    if (phase === 'review') { await write(cwd, '.autonomy/review.json', { stage: 2, approved: false, findings: ['Missing required behavior'], blockers: [] }); return { code: 0, output: 'Rejected' }; }
  });
  await assert.rejects(runLoop(root, { endStage: 2, maxPivots: 0 }, agent.execute), /budget exhausted/);
  assert.equal(await fs.readFile(path.join(root, 'src/value.js'), 'utf8'), 'original');
});

test('source edits during review cannot be promoted', async t => {
  const root = await fixture(t);
  const agent = fakeAgent(async ({ phase, cwd }) => {
    if (phase === 'review') await write(cwd, 'src/value.js', 'unverified review modification');
  });
  await assert.rejects(runLoop(root, { endStage: 2, maxPivots: 0 }, agent.execute), /budget exhausted/);
  assert.equal(await fs.readFile(path.join(root, 'src/value.js'), 'utf8'), 'original');
});

test('authentication failures and declared external gates stop without blind retries', async t => {
  const root = await fixture(t);
  let calls = 0;
  await assert.rejects(runLoop(root, { endStage: 2 }, async () => { calls++; return { code: 1, output: 'Authentication required' }; }), /failed/);
  assert.equal(calls, 1);
  const other = await fixture(t);
  const agent = fakeAgent(async ({ phase, cwd }) => {
    if (phase === 'plan') { await write(cwd, '.autonomy/plan.json', { stage: 2, status: 'blocked', blockers: ['Independent legal approval unavailable'] }); return { code: 0, output: 'Blocked' }; }
  });
  await assert.rejects(runLoop(other, { endStage: 2 }, agent.execute), /External\/semantic blocker/);
  assert.equal(agent.calls.length, 1);
});

test('stop files, expired deadlines and live locks prevent execution', async t => {
  const root = await fixture(t);
  await write(root, 'automation/STOP', 'stop');
  await assert.rejects(runLoop(root, { endStage: 2 }, async () => { throw new Error('Must not execute'); }), /Stop requested/);
  await fs.unlink(path.join(root, 'automation/STOP'));
  const state = await json(root, 'automation/checkpoint.json');
  state.deadline = Date.now() - 1;
  await write(root, 'automation/checkpoint.json', state);
  await assert.rejects(runLoop(root, { endStage: 2 }, async () => { throw new Error('Must not execute'); }), /budget exhausted/);
  await write(root, 'automation/runner.lock', { pid: process.pid });
  await assert.rejects(runLoop(root, { endStage: 2 }), /Another runner/);
});

test('promotion refuses concurrent user changes', async t => {
  const root = await fixture(t);
  const before = await snapshot(root);
  await write(root, 'src/value.js', 'user changed this');
  await assert.rejects(promotionJournal(root, before, before, 2, 'attempt'), /Concurrent/);
  assert.equal(await fs.readFile(path.join(root, 'src/value.js'), 'utf8'), 'user changed this');
});

test('pending journals cannot skip or rewind the checkpoint stage', async t => {
  for (const stage of [1, 4]) {
    const root = await fixture(t);
    await write(root, 'automation/promotion.json', { stage, status: 'pending', summary: 'Stale or unrelated journal', changes: [] });
    await assert.rejects(runLoop(root, { endStage: 2 }, async () => ({ code: 0, output: 'unused' })), /journal.*stage/i);
    assert.equal((await json(root, 'automation/checkpoint.json')).nextStage, 2);
  }
});

test('interrupted verified promotion resumes idempotently before any new agent work', async t => {
  const root = await fixture(t);
  const before = await snapshot(root);
  await write(root, 'src/value.js', 'verified candidate');
  await write(root, 'src/second.js', 'second file');
  const after = await snapshot(root);
  await write(root, 'src/value.js', 'original');
  await fs.unlink(path.join(root, 'src/second.js'));
  const journal = await promotionJournal(root, before, after, 2, 'Interrupted promotion fixture');
  await write(root, 'automation/promotion.json', journal);
  await write(root, 'src/value.js', 'verified candidate');
  const state = await runLoop(root, { endStage: 2 }, async () => { throw new Error('No new agent work expected'); });
  assert.equal(state.nextStage, 3);
  assert.equal(await fs.readFile(path.join(root, 'src/second.js'), 'utf8'), 'second file');
  await applyJournal(root, journal);
});

test('promotion rejects traversal and corrupted content before writing any files', async t => {
  const root = await fixture(t);
  const before = await snapshot(root);
  const item = before['src/value.js'];
  await assert.rejects(applyJournal(root, { stage: 2, changes: [{ name: 'src/../../escape.js', before: null, after: item }] }), /Invalid promotion path/);
  await assert.rejects(applyJournal(root, { stage: 2, changes: [{ name: 'src/..\\..\\escape.js', before: null, after: item }] }), /Invalid promotion path/);
  await assert.rejects(applyJournal(root, { stage: 2, changes: [{ name: 'src/new.js', before: null, after: item }, { name: 'src/value.js', before: item, after: { ...item, content: Buffer.from('corrupt').toString('base64') } }] }), /checksum/);
  await assert.rejects(fs.stat(path.join(root, 'src/new.js')), { code: 'ENOENT' });
  assert.equal(await fs.readFile(path.join(root, 'src/value.js'), 'utf8'), 'original');
});

test('blocked plan cannot be bypassed by resuming and exhausted retries remain bounded', async t => {
  const root = await fixture(t);
  const agent = fakeAgent(async ({ phase, cwd }) => {
    if (phase === 'plan') { await write(cwd, '.autonomy/plan.json', { stage: 2, steps: ['One', 'Two', 'Three'], tests: ['Check'], acceptance: ['Gate'], blockers: ['Credentials unavailable'] }); return { code: 0, output: 'Blocked' }; }
  });
  await assert.rejects(runLoop(root, { endStage: 2 }, agent.execute), /External\/semantic/);
  await assert.rejects(runLoop(root, { endStage: 2 }, agent.execute), /External\/semantic/);
  assert.equal(agent.calls.length, 1);
  const other = await fixture(t);
  let calls = 0;
  const fail = async () => { calls++; return { code: 0, output: 'No artifact' }; };
  await assert.rejects(runLoop(other, { endStage: 2, maxPivots: 0 }, fail), /budget exhausted/);
  await assert.rejects(runLoop(other, { endStage: 2, maxPivots: 0 }, fail), /budget exhausted/);
  assert.equal(calls, 4);
});

test('explicitly extending a spent pivot budget uses a fresh candidate and file-based prompts', async t => {
  const root = await fixture(t);
  await assert.rejects(runLoop(root, { endStage: 2, maxPivots: 0 }, async () => ({ code: 0, output: 'No artifact' })), /budget exhausted/);
  const agent = fakeAgent(async ({ command, args, phase, cwd }) => {
    if (command === 'junie') {
      assert.ok(!args.at(-1).includes('\n'));
      assert.ok(!args.at(-1).includes('"'));
      assert.ok(cwd.includes('pivot-1'));
      if (phase === 'plan') assert.equal(await fs.readFile(path.join(cwd, 'src/value.js'), 'utf8'), 'original');
    }
  });
  const state = await runLoop(root, { endStage: 2, maxPivots: 1 }, agent.execute);
  assert.equal(state.nextStage, 3);
});

test('stopped maintenance refreshes only controller files and preserves candidate work and budgets', async t => {
  const root = await fixture(t);
  await write(root, 'scripts/autonomy/runner.mjs', 'old controller');
  const before = await snapshot(root);
  const folder = 'automation/runs/stage-2-pivot-0';
  for (const [name, value] of Object.entries(before)) await write(root, `${folder}/candidate/${name}`, Buffer.from(value.content, 'base64').toString());
  await write(root, `${folder}/baseline.json`, before);
  await write(root, `${folder}/candidate/src/value.js`, 'candidate work must survive');
  await write(root, 'automation/checkpoint.json', { nextStage: 2, pivots: 0, attempt: 2, status: 'blocked', deadline: 12345 });
  await write(root, 'scripts/autonomy/runner.mjs', 'new verified controller');
  await assert.rejects(refreshController(root), /STOP file/);
  await write(root, 'automation/STOP', 'maintenance');
  await write(root, 'src/value.js', 'concurrent user change');
  await assert.rejects(refreshController(root), /Non-controller source conflict/);
  await write(root, 'src/value.js', 'original');
  await refreshController(root);
  assert.equal(await fs.readFile(path.join(root, folder, 'candidate/src/value.js'), 'utf8'), 'candidate work must survive');
  assert.equal(await fs.readFile(path.join(root, folder, 'candidate/scripts/autonomy/runner.mjs'), 'utf8'), 'new verified controller');
  const state = await json(root, 'automation/checkpoint.json');
  assert.equal(state.attempt, 2);
  assert.equal(state.deadline, 12345);
  assert.equal(state.status, 'ready');
});
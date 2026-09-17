import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';

const roots = new Set(['src', 'server', 'scripts', 'tests', 'docs', 'index.html', 'package.json', 'bun.lock', 'package-lock.json', 'tsconfig.json', 'vite.config.ts', 'server.ts', 'README.md', 'PROJECT_CHARTER.md', 'RULES.md', 'STATE.md', 'metadata.json']);
const ignored = new Set(['node_modules', 'dist', '__pycache__', '.pytest_cache', '.venv', '.autonomy']);
const protectedFile = name => ['PROJECT_CHARTER.md', 'RULES.md', 'STATE.md', 'tests/autonomy.test.mjs', 'tests/autonomyHost.test.mjs'].includes(name) || name.startsWith('scripts/autonomy/');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const exists = async file => fs.stat(file).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
const readJson = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const localPath = (root, relative) => path.join(root, ...relative.split('/'));
const defaults = { hours: 72, commandSeconds: 1800, maxPivots: 1, startStage: 2, endStage: 55 };

export function options(input = {}) {
  const value = { ...defaults, ...input };
  for (const [key, min, max] of [['hours', 0.001, 72], ['commandSeconds', 1, 3600], ['maxPivots', 0, 3], ['startStage', 1, 55], ['endStage', 1, 55]]) {
    if (!Number.isFinite(value[key]) || value[key] < min || value[key] > max || (key !== 'hours' && !Number.isInteger(value[key]))) throw new Error(`Invalid ${key}`);
  }
  if (value.endStage < value.startStage) throw new Error('endStage precedes startStage');
  return value;
}

export function roadmap(text) {
  const matches = [...text.matchAll(/^### Stage (\d+) — (.+)\r?\n([\s\S]*?)(?=^### Stage |^## |$(?![\s\S]))/gm)];
  if (matches.length !== 55 || matches.some((item, index) => Number(item[1]) !== index + 1 || !item[3].includes('Gate:'))) throw new Error('Charter must contain 55 consecutive stages with gates');
  return matches.map(item => ({ number: Number(item[1]), title: item[2], instructions: item[3].trim() }));
}

export function redact(text, environment = process.env) {
  let safe = String(text);
  for (const [name, value] of Object.entries(environment)) {
    if (/(TOKEN|SECRET|PASSWORD|API_KEY|AUTH)/i.test(name) && value?.length >= 6) safe = safe.split(value).join('[REDACTED]');
  }
  return safe.replace(/Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [REDACTED]');
}

/**
 * Replace a file by rename, retrying the transient Windows failures.
 *
 * write-then-rename is the right atomic-replace pattern, but on Windows the
 * rename intermittently fails with EPERM/EACCES/EBUSY when something else
 * momentarily holds a handle on the destination — Defender or the search
 * indexer scanning the file we just wrote is the usual cause. It is transient
 * by nature, so a bounded retry is the fix; without it the autonomy runner can
 * lose a checkpoint write in normal operation, not just in tests.
 */
export async function renameWithRetry(from, to, attempts = 10) {
  for (let attempt = 1; ; attempt++) {
    try {
      await fs.rename(from, to);
      return;
    } catch (error) {
      const transient = error.code === 'EPERM' || error.code === 'EACCES' || error.code === 'EBUSY';
      if (!transient || attempt >= attempts) throw error;
      await new Promise(resolve => setTimeout(resolve, attempt * 20));
    }
  }
}

async function atomic(file, content) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.pending`;
  await fs.writeFile(temporary, content);
  await renameWithRetry(temporary, file);
}

async function save(file, value) { await atomic(file, JSON.stringify(value, null, 2) + '\n'); }

export async function snapshot(root) {
  const result = {};
  let total = 0;
  async function walk(directory, prefix = '') {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if ((!prefix && !roots.has(entry.name)) || ignored.has(entry.name)) continue;
      const name = prefix + entry.name;
      const fullPath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        let target;
        try { target = await fs.readlink(fullPath); } catch (error) {
          if (process.platform !== 'win32' || error.code !== 'EINVAL') throw error;
        }
        if (target !== undefined) throw new Error(`Symlinks are not allowed in candidate source: ${name}`);
      }
      const info = await fs.stat(fullPath);
      if (info.isDirectory()) { await walk(fullPath, name + '/'); continue; }
      if (!info.isFile()) throw new Error(`Unsupported source entry: ${name}`);
      total += info.size;
      if (info.size > 8 * 1024 * 1024 || total > 100 * 1024 * 1024) throw new Error('Source snapshot exceeds size limit');
      const bytes = await fs.readFile(path.join(directory, entry.name));
      result[name] = { hash: hash(bytes), content: bytes.toString('base64') };
    }
  }
  await walk(root);
  return result;
}

async function materialize(root, files) {
  for (const [name, item] of Object.entries(files)) await atomic(localPath(root, name), Buffer.from(item.content, 'base64'));
}

export function assertProtected(before, after) {
  for (const name of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (protectedFile(name) && before[name]?.hash !== after[name]?.hash) throw new Error(`Protected controller/guidance changed: ${name}`);
  }
  if (before['package.json']) {
    const oldPackage = JSON.parse(Buffer.from(before['package.json'].content, 'base64'));
    const newPackage = JSON.parse(Buffer.from(after['package.json']?.content ?? '', 'base64'));
    for (const key of ['lint', 'build', 'test']) if (oldPackage.scripts?.[key] !== newPackage.scripts?.[key]) throw new Error(`Required verification command changed: ${key}`);
  }
}

function assertUnchanged(before, after, omitState = false) {
  for (const name of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (omitState && name === 'STATE.md') continue;
    if (before[name]?.hash !== after[name]?.hash) throw new Error(`Concurrent or read-only change detected: ${name}`);
  }
}

export async function promotionJournal(root, before, after, stage, summary) {
  assertProtected(before, after);
  assertUnchanged(before, await snapshot(root), true);
  const changes = [];
  for (const name of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (before[name]?.hash !== after[name]?.hash) changes.push({ name, before: before[name] ?? null, after: after[name] ?? null });
  }
  return { stage, summary, changes, status: 'pending' };
}

export async function applyJournal(root, journal) {
  if (!Number.isInteger(journal.stage) || journal.stage < 1 || journal.stage > 55 || !Array.isArray(journal.changes)) throw new Error('Invalid promotion journal');
  await snapshot(root);
  for (const change of journal.changes) {
    if (typeof change.name !== 'string' || /[\\:]/.test(change.name) || !roots.has(change.name.split('/')[0]) || change.name.split('/').some(part => ['..', '.', ''].includes(part)) || protectedFile(change.name)) throw new Error('Invalid promotion path');
    for (const item of [change.before, change.after]) {
      if (item && hash(Buffer.from(item.content, 'base64')) !== item.hash) throw new Error('Promotion checksum mismatch');
    }
    const file = localPath(root, change.name);
    let current = null;
    try { current = hash(await fs.readFile(file)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (current !== (change.before?.hash ?? null) && current !== (change.after?.hash ?? null)) throw new Error(`Promotion conflict: ${change.name}`);
  }
  for (const change of journal.changes) {
    const file = localPath(root, change.name);
    if (change.after) {
      const bytes = Buffer.from(change.after.content, 'base64');
      if (hash(bytes) !== change.after.hash) throw new Error('Promotion checksum mismatch');
      await atomic(file, bytes);
    } else { await fs.rm(file, { force: true }); }
  }
}

export function runProcess(command, args, { cwd, timeoutMs, signal, environment = process.env } = {}) {
  return new Promise(resolve => {
    let output = '';
    let reason = null;
    let child;
    const cap = 1024 * 1024;
    let capturedBytes = 0;
    const decoders = [new StringDecoder('utf8'), new StringDecoder('utf8')];
    const windows = process.platform === 'win32';
    const quote = value => `'${String(value).replaceAll("'", "''")}'`;
    const shellScript = `& ${quote(command)} ${args.map(quote).join(' ')}; if ($null -eq $LASTEXITCODE) { exit 1 }; exit $LASTEXITCODE`;
    try {
      child = windows && !command.toLowerCase().endsWith('.exe')
        ? spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', shellScript], { cwd, env: { ...environment, CI: '1', GIT_TERMINAL_PROMPT: '0' }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
        : spawn(command, args, { cwd, env: { ...environment, CI: '1', GIT_TERMINAL_PROMPT: '0' }, stdio: ['pipe', 'pipe', 'pipe'], detached: !windows, windowsHide: true });
    } catch (error) { resolve({ code: 1, output: redact(error.message, environment), reason: 'spawn' }); return; }
    const stop = why => {
      if (reason) return;
      reason = why;
      if (!child.pid) return;
      if (windows) spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      else { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
    };
    const capture = (data, decoder) => {
      const remaining = cap - capturedBytes;
      const accepted = data.subarray(0, remaining);
      capturedBytes += accepted.length;
      output += decoder.write(accepted);
      if (data.length > remaining) stop('output-limit');
    };
    child.stdin.on('error', () => {});
    child.stdin.end();
    child.stdout.on('data', data => capture(data, decoders[0]));
    child.stderr.on('data', data => capture(data, decoders[1]));
    const abort = () => stop('stop-request');
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const timer = setTimeout(() => stop('timeout'), timeoutMs ?? 60000);
    child.on('error', error => { output += error.message; reason ??= 'spawn'; });
    child.on('close', code => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      for (const decoder of decoders) output += decoder.end();
      const bounded = new StringDecoder('utf8').write(Buffer.from(redact(output, environment)).subarray(0, cap));
      resolve({ code: reason ? 1 : code ?? 1, output: bounded, reason });
    });
  });
}

function requireStrings(value, label, minimum = 1) {
  if (!Array.isArray(value) || value.length < minimum || value.some(item => typeof item !== 'string' || !item.trim())) throw new Error(`Invalid ${label}`);
}

async function artifact(work, filename, stage) {
  const file = path.join(work, '.autonomy', filename);
  if ((await fs.stat(file)).size > 256 * 1024) throw new Error('Agent artifact too large');
  const value = await readJson(file);
  if (value.stage !== stage) throw new Error('Wrong stage in agent artifact');
  requireStrings(value.blockers, 'blockers', 0);
  if (value.status === 'blocked' || value.blockers?.length) throw Object.assign(new Error(`External/semantic blocker: ${JSON.stringify(value.blockers)}`), { permanent: true });
  return value;
}

async function acquire(file) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  try { return await fs.open(file, 'wx'); } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    let owner;
    try { owner = await readJson(file); } catch { throw new Error('Unreadable runner lock; inspect it before recovery'); }
    if (!Number.isInteger(owner.pid) || owner.pid < 1) throw new Error('Invalid runner lock');
    try { process.kill(owner.pid, 0); } catch (probe) {
      if (probe.code === 'ESRCH') { await fs.unlink(file); return fs.open(file, 'wx'); }
    }
    throw new Error('Another runner owns this project');
  }
}

export async function runLoop(root, input = {}, execute = runProcess, signal) {
  const config = options(input);
  const control = path.join(root, 'automation');
  const lockPath = path.join(control, 'runner.lock');
  const lock = await acquire(lockPath);
  await lock.writeFile(JSON.stringify({ pid: process.pid, started: new Date().toISOString() }));
  const stateFile = path.join(control, 'checkpoint.json');
  const journalFile = path.join(control, 'promotion.json');
  let state;
  let deadline;
  async function record(message) {
    const file = path.join(root, 'STATE.md');
    await fs.appendFile(file, `\n- ${new Date().toISOString()} ${redact(message)}\n`);
  }
  async function checkpoint() { await save(stateFile, state); }
  async function finishPromotion(journal) {
    const sameStage = journal.stage === state.nextStage;
    const alreadyCommitted = state.nextStage === journal.stage + 1 && state.completed.includes(journal.stage);
    if (!sameStage && !alreadyCommitted) throw new Error('Promotion journal does not match checkpoint stage');
    await applyJournal(root, journal);
    if (!state.completed.includes(journal.stage)) state.completed.push(journal.stage);
    state.nextStage = journal.stage + 1;
    state.attempt = 0;
    state.pivots = 0;
    state.failure = null;
    state.status = 'running';
    await checkpoint();
    const marker = `Stage ${journal.stage} verified and promoted`;
    if (!(await fs.readFile(path.join(root, 'STATE.md'), 'utf8')).includes(marker)) await record(`${marker}: ${journal.summary}`);
    await save(journalFile, { ...journal, status: 'completed' });
  }
  try {
    const stages = roadmap(await fs.readFile(path.join(root, 'PROJECT_CHARTER.md'), 'utf8'));
    state = await exists(stateFile) ? await readJson(stateFile) : { nextStage: config.startStage, completed: [], attempt: 0, pivots: 0, status: 'ready', failure: null };
    if (!Number.isInteger(state.nextStage) || state.nextStage < 1 || state.nextStage > 56 || !Array.isArray(state.completed)) throw new Error('Invalid checkpoint');
    if (state.completed.some(number => !Number.isInteger(number) || number < 1 || number >= state.nextStage) || !Number.isInteger(state.attempt) || state.attempt < 0 || !Number.isInteger(state.pivots) || state.pivots < 0 || state.pivots > 3) throw new Error('Invalid checkpoint progress');
    if (!Object.hasOwn(state, 'deadline')) state.deadline = Date.now() + config.hours * 3600000;
    if (!Number.isFinite(state.deadline)) throw new Error('Invalid checkpoint deadline');
    deadline = state.deadline;
    await checkpoint();
    if (await exists(journalFile)) {
      const journal = await readJson(journalFile);
      if (journal.status === 'pending') await finishPromotion(journal);
    }
    const checkStop = async () => {
      if (signal?.aborted || await exists(path.join(control, 'STOP'))) throw Object.assign(new Error('Stop requested'), { permanent: true });
      if (Date.now() >= deadline) throw Object.assign(new Error('Total runtime budget exhausted'), { permanent: true });
    };
    while (state.nextStage <= config.endStage) {
      await checkStop();
      if (state.failure?.consecutive >= 4 || state.attempt >= 8) {
        if (state.pivots >= config.maxPivots) throw new Error('Pivot/retry budget exhausted; inspect recorded failure before resuming');
        state.pivots += 1;
        state.attempt = 0;
        state.failure = { ...state.failure, consecutive: 0 };
        await checkpoint();
        await record(`Stage ${state.nextStage}: explicitly extended pivot budget; rebuilding an isolated candidate from accepted source.`);
      }
      const stage = stages[state.nextStage - 1];
      const folder = path.join(control, 'runs', `stage-${stage.number}-pivot-${state.pivots ?? 0}`);
      const work = path.join(folder, 'candidate');
      const baselineFile = path.join(folder, 'baseline.json');
      await fs.mkdir(folder, { recursive: true });
      let baseline;
      if (await exists(baselineFile)) baseline = await readJson(baselineFile);
      else { baseline = await snapshot(root); await save(baselineFile, baseline); await materialize(work, baseline); }
      await fs.mkdir(path.join(work, '.autonomy'), { recursive: true });
      state.attempt += 1;
      state.status = 'running';
      await checkpoint();
      let phase = 'plan';
      let sequence = 0;
      const command = async (program, args) => {
        await checkStop();
        const result = await execute(program, args, { cwd: work, timeoutMs: Math.max(1, Math.min(config.commandSeconds * 1000, deadline - Date.now())), signal });
        await save(path.join(folder, `attempt-${state.attempt}-${++sequence}-${phase}.json`), { program, args: program === 'junie' ? ['[task stored in candidate artifacts]'] : args, code: result.code, reason: result.reason ?? null, output: redact(result.output ?? '') });
        if (result.code !== 0) {
          const permanent = /unauthenticated|authentication (failed|required)|invalid.*token|unauthorized|not logged in|syntax of the command is incorrect|not recognized as/i.test(result.output ?? '') || result.reason === 'stop-request' || result.reason === 'spawn';
          throw Object.assign(new Error(`${phase}: ${program} failed (${result.reason ?? result.code})`), { permanent, diagnostics: redact(result.output ?? '').slice(0, 64000) });
        }
        return result;
      };
      const agent = async task => {
        const taskPath = path.join('.autonomy', `task-${phase}-attempt-${state.attempt}.md`);
        await atomic(path.join(work, taskPath), `Read PROJECT_CHARTER.md, RULES.md and STATE.md. Work ONLY in this candidate directory. Do not access Recovered_C, real documents, parent directories, secrets or the automation controller. Do not modify protected guidance/controller files or weaken existing tests and verification scripts. Never create commits, detached services or scheduled tasks. If .autonomy/maintainer-review.md exists, address its observations without treating them as an approval. Stage ${stage.number}: ${stage.title}. ${stage.instructions}\nPrevious failure: ${JSON.stringify(state.failure)}\n${task}`);
        return command('junie', ['--skip-update-check', '--output-format=json', '--effort=high', '--project', work, '--task', `Read ${taskPath} and carry out exactly that bounded request. It defines the current phase and required output. Do not proceed to other stages.`]);
      };
      try {
        const planFile = path.join(work, '.autonomy', 'plan.json');
        if (!(await exists(planFile))) {
          const beforePlan = await snapshot(work);
          await agent(`Planning only: do not edit source. Write .autonomy/plan.json with {stage:${stage.number}, steps:[at least three detailed tasks], tests:[specific checks], acceptance:[required evidence], blockers:[], pivotReason:"${state.pivots ? 'Explain a materially different approach from the repeated failing approach' : 'Initial approach'}"}. Document unavailable external gates as blockers; never invent them. This is the detailed next-stage plan.`);
          const plan = await artifact(work, 'plan.json', stage.number);
          requireStrings(plan.steps, 'plan steps', 3); requireStrings(plan.tests, 'plan tests'); requireStrings(plan.acceptance, 'acceptance gates');
          if (state.pivots && (!plan.pivotReason || plan.pivotReason === 'Initial approach')) throw new Error('Missing architectural pivot rationale');
          assertUnchanged(beforePlan, await snapshot(work));
          await record(`Stage ${stage.number} detailed plan saved in ${path.relative(root, planFile)}; attempt ${state.attempt}, pivot ${state.pivots}.`);
        }
        const activePlan = await artifact(work, 'plan.json', stage.number);
        requireStrings(activePlan.steps, 'plan steps', 3); requireStrings(activePlan.tests, 'plan tests'); requireStrings(activePlan.acceptance, 'acceptance gates');
        phase = 'execute';
        await fs.rm(path.join(work, '.autonomy', 'report.json'), { force: true });
        await agent(`Execute .autonomy/plan.json. If .autonomy/failure.json exists, diagnose its actual check output/review findings before retrying. Add reproduction/new tests as required and implement the stage without weakening tests. Run relevant downstream checks. Write .autonomy/report.json with {stage:${stage.number}, status:"implemented" or "blocked", summary:"what actually changed", checks:[{command:"node"|"python"|"npm"|"bun",args:["actual","arguments"]}], evidence:["relative/file/paths"], errors:["observed errors"], fixes:["actual fixes"], blockers:[]}. All verification commands will be rerun by the controller; include worker/downstream suites. Do not change STATE.md; the controller records state. Missing external approval is blocked, not implemented.`);
        const report = await artifact(work, 'report.json', stage.number);
        if (report.status !== 'implemented' || typeof report.summary !== 'string' || !report.summary.trim() || !Array.isArray(report.checks) || report.checks.length === 0) throw new Error('Incomplete implementation report');
        requireStrings(report.evidence, 'evidence');
        requireStrings(report.errors, 'errors', 0); requireStrings(report.fixes, 'fixes', 0);
        const implemented = await snapshot(work);
        for (const file of report.evidence) {
          if (path.isAbsolute(file) || file.split(/[\\/]/).includes('..') || !implemented[file.replaceAll('\\', '/')]) throw new Error('Invalid or absent stage evidence');
        }
        assertProtected(baseline, implemented);
        phase = 'install';
        await command('bun', ['install', '--frozen-lockfile']);
        for (const script of ['lint', 'build', 'test']) { phase = `verify-${script}`; await command('npm', ['run', script]); }
        for (const check of report.checks) {
          if (!['node', 'python', 'npm', 'bun'].includes(check.command) || !Array.isArray(check.args) || check.args.some(arg => typeof arg !== 'string')) throw new Error('Invalid downstream verification command');
          phase = `downstream-${check.command}-${hash(JSON.stringify(check.args)).slice(0, 8)}`;
          await command(check.command, check.args);
        }
        phase = 'review';
        const reviewed = await snapshot(work);
        await save(path.join(work, '.autonomy', 'changes.json'), Object.fromEntries([...new Set([...Object.keys(baseline), ...Object.keys(reviewed)])].filter(name => baseline[name]?.hash !== reviewed[name]?.hash).map(name => [name, { before: baseline[name] ?? null, after: reviewed[name] ?? null }])));
        await fs.rm(path.join(work, '.autonomy', 'review.json'), { force: true });
        await agent(`Independent fresh-context code review only; do not edit source. Inspect .autonomy/plan.json, report.json and changes.json (before/after content is base64), tests, negative/failure paths and all stage acceptance gates. Agent self-reports are not proof; inspect implementation and rerun appropriate checks. Write .autonomy/review.json with {stage:${stage.number}, approved:true|false, findings:["specific unresolved issues"], blockers:[], evidence:["files and observed verification"]}. Reject fake functionality, weakened tests, unsupported external approvals or incomplete gates. Do not call this external security certification.`);
        const review = await artifact(work, 'review.json', stage.number);
        if (review.approved !== true || !Array.isArray(review.findings) || review.findings.length) throw Object.assign(new Error('Independent code review rejected the candidate'), { diagnostics: JSON.stringify(review.findings) });
        requireStrings(review.evidence, 'review evidence');
        assertUnchanged(reviewed, await snapshot(work));
        await checkStop();
        phase = 'promote';
        const journal = await promotionJournal(root, baseline, reviewed, stage.number, report.summary);
        await save(journalFile, journal);
        await finishPromotion(journal);
      } catch (error) {
        if (phase === 'promote') throw error;
        const key = phase;
        const consecutive = state.failure?.key === key ? state.failure.consecutive + 1 : 1;
        state.failure = { key, consecutive, message: redact(error.message) };
        await save(path.join(work, '.autonomy', 'failure.json'), { ...state.failure, diagnostics: redact(error.diagnostics ?? ''), attempt: state.attempt });
        await checkpoint();
        await record(`Stage ${stage.number} attempt ${state.attempt} failed at ${key}: ${error.message}. Unaccepted source remains isolated.`);
        if (error.permanent) throw error;
        if (consecutive >= 4 || state.attempt >= 8) {
          if (state.pivots >= config.maxPivots) throw new Error('Pivot/retry budget exhausted; preserved failed candidate evidence');
          state.pivots += 1;
          state.attempt = 0;
          state.failure = { ...state.failure, consecutive: 0 };
          await checkpoint();
          await record(`Stage ${stage.number}: repeated failures; unaccepted candidate abandoned, original source untouched. Replan with a different approach in pivot ${state.pivots}.`);
        }
      }
    }
    state.status = state.nextStage === 56 ? (state.completed.length === 55 ? 'roadmap-complete' : 'selected-stages-complete') : 'window-complete';
    await checkpoint();
    await record(`Runner ${state.status}; next stage ${state.nextStage}. This is not independent production certification.`);
    return state;
  } catch (error) {
    if (state) { state.status = 'blocked'; state.blocker = redact(error.message); await checkpoint(); await record(`Runner blocked: ${error.message}`); }
    throw error;
  } finally { await lock.close(); await fs.unlink(lockPath); }
}

export async function refreshController(root) {
  const control = path.join(root, 'automation');
  const lockPath = path.join(control, 'runner.lock');
  const lock = await acquire(lockPath);
  await lock.writeFile(JSON.stringify({ pid: process.pid }));
  try {
    if (!(await exists(path.join(control, 'STOP')))) throw new Error('Controller maintenance requires the STOP file');
    const stateFile = path.join(control, 'checkpoint.json');
    const state = await readJson(stateFile);
    if (!Number.isInteger(state.nextStage) || state.nextStage < 1 || state.nextStage > 55 || !Number.isInteger(state.pivots) || state.pivots < 0 || state.pivots > 3) throw new Error('Controller maintenance requires a valid checkpoint');
    if (state.status === 'running') await fs.appendFile(path.join(root, 'STATE.md'), `\n- ${new Date().toISOString()} Exclusive maintenance lock acquired without a live runner; previous running checkpoint is interrupted, not completed.\n`);
    const journalFile = path.join(control, 'promotion.json');
    if (await exists(journalFile) && (await readJson(journalFile)).status === 'pending') throw new Error('Recover pending promotion before controller maintenance');
    const folder = path.join(control, 'runs', `stage-${state.nextStage}-pivot-${state.pivots}`);
    const work = path.join(folder, 'candidate');
    const baselineFile = path.join(folder, 'baseline.json');
    const baseline = await readJson(baselineFile);
    assertProtected(baseline, await snapshot(work));
    const current = await snapshot(root);
    const maintenanceFile = name => name.startsWith('scripts/autonomy/') || ['tests/autonomy.test.mjs', 'tests/autonomyHost.test.mjs'].includes(name);
    for (const name of new Set([...Object.keys(baseline), ...Object.keys(current)])) {
      if (!maintenanceFile(name) && name !== 'STATE.md' && baseline[name]?.hash !== current[name]?.hash) throw new Error(`Non-controller source conflict: ${name}`);
      if (maintenanceFile(name) && baseline[name] && !current[name]) throw new Error('Controller file deletion requires manual recovery');
    }
    const replacement = Object.fromEntries(Object.entries(current).filter(([name]) => maintenanceFile(name)));
    await save(path.join(folder, `controller-refresh-${Date.now()}.json`), { before: Object.fromEntries(Object.entries(baseline).filter(([name]) => maintenanceFile(name))), after: replacement });
    await materialize(work, replacement);
    await save(baselineFile, { ...baseline, ...replacement });
    state.status = 'ready';
    state.blocker = null;
    await save(stateFile, state);
    await fs.appendFile(path.join(root, 'STATE.md'), `\n- ${new Date().toISOString()} Stopped-controller maintenance: verified scaffolding refreshed, candidate application work preserved; attempts and deadline unchanged. Rerun all checks before promotion.\n`);
  } finally { await lock.close(); await fs.unlink(lockPath); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const input = {};
  const names = { '--hours': 'hours', '--command-seconds': 'commandSeconds', '--max-pivots': 'maxPivots', '--start-stage': 'startStage', '--end-stage': 'endStage' };
  try {
    for (let index = 2; index < process.argv.length; index += 2) {
      const key = names[process.argv[index]];
      if (!key || process.argv[index + 1] === undefined) throw new Error('Unknown or missing option value');
      input[key] = Number(process.argv[index + 1]);
    }
    const abort = new AbortController();
    process.on('SIGINT', () => abort.abort()); process.on('SIGTERM', () => abort.abort());
    const result = await runLoop(root, input, runProcess, abort.signal);
    console.log(JSON.stringify({ status: result.status, nextStage: result.nextStage }));
  } catch (error) { console.error(redact(error.message)); process.exitCode = 1; }
}
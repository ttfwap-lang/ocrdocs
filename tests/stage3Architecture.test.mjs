import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

async function loadStage3Files() {
  const topologyPath = path.join(projectRoot, 'docs', 'stage3', 'component-topology.md');
  const stateMachinePath = path.join(projectRoot, 'docs', 'stage3', 'failure-state-machine.json');
  const contractsPath = path.join(projectRoot, 'docs', 'stage3', 'authoritative-contracts.md');

  const [topologyText, stateMachineText, contractsText] = await Promise.all([
    fs.readFile(topologyPath, 'utf8'),
    fs.readFile(stateMachinePath, 'utf8'),
    fs.readFile(contractsPath, 'utf8'),
  ]);

  const stateMachine = JSON.parse(stateMachineText);

  return {
    topologyText,
    stateMachineText,
    contractsText,
    stateMachine,
  };
}

function validateStateMachine(stateMachine) {
  const REQUIRED_STATES = ['pending', 'claimed', 'processing', 'completed', 'failed', 'cancelled'];
  const REQUIRED_TRIGGERS = [
    'upload_interrupted',
    'worker_timeout',
    'worker_crash',
    'server_restart',
    'db_busy',
  ];

  assert.ok(Array.isArray(stateMachine.states), 'states must be an array');
  for (const st of REQUIRED_STATES) {
    assert.ok(stateMachine.states.includes(st), `states missing required state: ${st}`);
  }

  assert.ok(Array.isArray(stateMachine.failureTriggers), 'failureTriggers must be an array');
  for (const trig of REQUIRED_TRIGGERS) {
    assert.ok(stateMachine.failureTriggers.includes(trig), `failureTriggers missing required trigger: ${trig}`);
  }

  assert.ok(stateMachine.invariants, 'invariants must exist');
  assert.strictEqual(stateMachine.invariants.ephemeralMemoryForbidsQueue, true, 'ephemeral memory must not be durable queue');
  assert.strictEqual(stateMachine.invariants.maxWorkerRetries, 3, 'maxWorkerRetries must be 3');
  assert.ok(stateMachine.invariants.defaultLeaseTimeoutSec >= 60, 'defaultLeaseTimeoutSec must be >= 60s');

  assert.ok(Array.isArray(stateMachine.transitions), 'transitions must be an array');
  for (const trans of stateMachine.transitions) {
    assert.ok(stateMachine.states.includes(trans.from), `transition from state ${trans.from} unknown`);
    assert.ok(stateMachine.states.includes(trans.to), `transition to state ${trans.to} unknown`);
    if (trans.from === 'completed') {
      assert.fail(`Illegal transition out of terminal completed state: ${trans.from} -> ${trans.to}`);
    }
  }

  assert.ok(Array.isArray(stateMachine.walkthroughs), 'walkthroughs must be an array');
  assert.ok(stateMachine.walkthroughs.length >= 5, 'must have at least 5 failure walkthrough scenarios');

  for (const wt of stateMachine.walkthroughs) {
    assert.ok(wt.id && typeof wt.id === 'string', 'walkthrough must have an id');
    assert.ok(wt.name && typeof wt.name === 'string', 'walkthrough must have a name');
    assert.ok(wt.trigger && stateMachine.failureTriggers.includes(wt.trigger), `walkthrough trigger ${wt.trigger} invalid`);
    assert.ok(Array.isArray(wt.steps) && wt.steps.length >= 3, `walkthrough ${wt.id} must have >= 3 steps`);
  }
}

test('Stage 3: All required architecture files exist and are populated', async () => {
  const { topologyText, stateMachineText, contractsText } = await loadStage3Files();
  assert.ok(topologyText.length > 500, 'component-topology.md must have substantial content');
  assert.ok(stateMachineText.length > 500, 'failure-state-machine.json must have substantial content');
  assert.ok(contractsText.length > 500, 'authoritative-contracts.md must have substantial content');
});

test('Stage 3: Component topology formalizes process boundaries and forbids in-memory queue', async () => {
  const { topologyText } = await loadStage3Files();
  assert.ok(topologyText.includes('Express.js API Gateway'), 'must document Express API gateway');
  assert.ok(topologyText.includes('SQLite 3 Engine'), 'must document SQLite engine');
  assert.ok(topologyText.includes('OCR Spark Engine Worker'), 'must document OCR worker');
  assert.ok(topologyText.includes('WAL Journal Mode'), 'must specify SQLite WAL journal mode');
  assert.ok(topologyText.includes('EventEmitter') && topologyText.includes('NEVER serve as a durable queue'), 'must explicitly forbid EventEmitter as durable queue');
  assert.ok(topologyText.includes('storage/private/'), 'must specify private encrypted storage root');
});

test('Stage 3: Authoritative contracts freeze TypeScript types and SQLite schemas', async () => {
  const { contractsText } = await loadStage3Files();
  assert.ok(contractsText.includes('export type JobStatus'), 'must export JobStatus union');
  assert.ok(contractsText.includes('export interface FailureTransition'), 'must export FailureTransition interface');
  assert.ok(contractsText.includes('export interface JobLeaseContract'), 'must export JobLeaseContract interface');
  assert.ok(contractsText.includes('CREATE TABLE IF NOT EXISTS documents'), 'must define documents table schema');
  assert.ok(contractsText.includes('CREATE TABLE IF NOT EXISTS ocr_jobs'), 'must define ocr_jobs table schema');
  assert.ok(contractsText.includes('CREATE TABLE IF NOT EXISTS extracted_fields'), 'must define extracted_fields table schema');
  assert.ok(contractsText.includes('CREATE TABLE IF NOT EXISTS audit_log'), 'must define audit_log table schema');
});

test('Stage 3: Failure state machine conforms to schema and covers all 5 failure-scenario triggers', async () => {
  const { stateMachine } = await loadStage3Files();
  validateStateMachine(stateMachine);
});

test('Stage 3: Failure walkthroughs cover interrupted upload, worker timeout/crash, server restart, and db busy', async () => {
  const { stateMachine } = await loadStage3Files();
  const walkthroughIds = stateMachine.walkthroughs.map(w => w.id);
  assert.ok(walkthroughIds.includes('scenario_upload_interrupted'), 'must cover upload_interrupted');
  assert.ok(walkthroughIds.includes('scenario_worker_timeout'), 'must cover worker_timeout');
  assert.ok(walkthroughIds.includes('scenario_worker_crash'), 'must cover worker_crash');
  assert.ok(walkthroughIds.includes('scenario_server_restart'), 'must cover server_restart');
  assert.ok(walkthroughIds.includes('scenario_database_busy_partial_commit'), 'must cover db_busy');
});

test('Stage 3: State transition simulator validates retry bounds and poison pill quarantine', async () => {
  const { stateMachine } = await loadStage3Files();
  
  // Simulate worker timeout retry loop
  let attempt = 0;
  let state = 'processing';
  const maxRetries = stateMachine.invariants.maxWorkerRetries;

  while (attempt < maxRetries) {
    attempt++;
    const retryTrans = stateMachine.transitions.find(
      t => t.from === 'processing' && t.trigger === 'worker_timeout' && t.condition?.includes('< maxWorkerRetries')
    );
    assert.ok(retryTrans, `Must have transition for worker_timeout under retry limit`);
    state = retryTrans.to;
    assert.strictEqual(state, 'pending');
    state = 'processing'; // re-acquired
  }

  // Attempt 3 exhausted -> must transition to failed (poison pill)
  const poisonTrans = stateMachine.transitions.find(
    t => t.from === 'processing' && t.trigger === 'worker_timeout' && t.condition?.includes('>= maxWorkerRetries')
  );
  assert.ok(poisonTrans, 'Must have transition for worker_timeout at retry limit to poison pill');
  assert.strictEqual(poisonTrans.to, 'failed');
  assert.strictEqual(poisonTrans.action, 'mark_poison_pill');
});

test('Stage 3: Negative self-tests confirm state machine validator rejects defective models', async () => {
  const { stateMachine } = await loadStage3Files();

  // Test 1: missing required state
  const missingState = JSON.parse(JSON.stringify(stateMachine));
  missingState.states = missingState.states.filter(s => s !== 'completed');
  assert.throws(
    () => validateStateMachine(missingState),
    /states missing required state: completed/
  );

  // Test 2: missing required failure trigger
  const missingTrigger = JSON.parse(JSON.stringify(stateMachine));
  missingTrigger.failureTriggers = missingTrigger.failureTriggers.filter(t => t !== 'server_restart');
  assert.throws(
    () => validateStateMachine(missingTrigger),
    /failureTriggers missing required trigger: server_restart/
  );

  // Test 3: illegal transition out of completed state
  const illegalTransition = JSON.parse(JSON.stringify(stateMachine));
  illegalTransition.transitions.push({
    from: 'completed',
    to: 'claimed',
    trigger: 'illegal_restart',
  });
  assert.throws(
    () => validateStateMachine(illegalTransition),
    /Illegal transition out of terminal completed state/
  );

  // Test 4: ephemeral memory queue invariant false
  const violatedInvariant = JSON.parse(JSON.stringify(stateMachine));
  violatedInvariant.invariants.ephemeralMemoryForbidsQueue = false;
  assert.throws(
    () => validateStateMachine(violatedInvariant),
    /ephemeral memory must not be durable queue/
  );
});

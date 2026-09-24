#!/usr/bin/env node
/**
 * Repeatable, PHI-free browser/DOM smoke audit for a running ocr.local.
 *
 * Requires a Chrome/Chromium instance with a CDP endpoint (the operator's
 * existing headless audit profile is fine):
 *
 *   chromium --headless=new --remote-debugging-port=9222 \
 *     --user-data-dir=/tmp/ocrdocs-cdp http://ocr.local:3000
 *   node scripts/live_dom_audit.mjs
 *
 * The script intentionally reports aggregate DOM/API state only. It never
 * prints identity names, filenames, patient values or raw API bodies.
 */
import WebSocket from 'ws';

const cdpBase = process.env.OCRDOCS_CDP_URL || 'http://127.0.0.1:9222';
const targetUrl = process.env.OCRDOCS_URL || 'http://ocr.local:3000';
const cycles = Math.max(1, Math.min(10, Number.parseInt(process.env.OCRDOCS_AUDIT_CYCLES || '3', 10)));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const targets = await (await fetch(`${cdpBase}/json/list`)).json();
const target = targets.find((item) => item.type === 'page' && item.url.startsWith(targetUrl));
if (!target) throw new Error(`No CDP page for ${targetUrl}; start Chromium with --remote-debugging-port`);

const ws = new WebSocket(target.webSocketDebuggerUrl);
let nextId = 1;
const pending = new Map();
const events = [];
ws.on('message', (raw) => {
  const message = JSON.parse(raw.toString());
  if (message.id && pending.has(message.id)) {
    const request = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) request.reject(new Error(JSON.stringify(message.error)));
    else request.resolve(message.result);
    return;
  }
  if (message.method && [
    'Network.responseReceived',
    'Network.loadingFailed',
    'Runtime.exceptionThrown',
    'Runtime.consoleAPICalled',
    'Log.entryAdded',
  ].includes(message.method)) events.push(message);
});
await new Promise((resolve, reject) => {
  ws.once('open', resolve);
  ws.once('error', reject);
});

function command(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const result = await command('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'DOM evaluation failed');
  }
  return result.result?.value;
}

await command('Runtime.enable');
await command('Page.enable');
await command('Network.enable');
await command('Log.enable');

async function domState() {
  return evaluate(`(() => {
    const text = document.body.innerText || '';
    const number = (pattern) => { const match = text.match(pattern); return match ? Number(match[1].replaceAll(',', '')) : null; };
    return {
      title: document.title,
      people: number(/PEOPLE\\s+([\\d,]+)/i),
      documents: number(/([\\d,]+)\\s+DOCUMENTS/i),
      unassigned: number(/Unassigned Queue \\/\\/\\s*([\\d,]+)/i),
      unassignedRendered: document.querySelectorAll('[data-testid="unassigned-row"]').length,
      medicare: number(/INDEX \\/\\/\\s*([\\d,]+)\\s+PATIENTS/i),
      worker: /DGX WORKER:\\s*(LIVE|UNCONFIGURED)/i.exec(text)?.[1] || null,
      querying: text.includes('Querying index'),
      loadMore: text.includes('LOAD MORE UNASSIGNED'),
      warning: /source index is not present|has not completed a successful import|status unavailable/i.test(text),
      criticalReview: /critical values need review/i.test(text),
      buttons: document.querySelectorAll('button').length,
      mainElements: document.querySelectorAll('main *').length,
    };
  })()`);
}

async function waitForDom(expression, description, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(`Boolean(${expression})`)) return;
    await sleep(400);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function clickNav(index) {
  const clicked = await evaluate(`(() => { const button = document.querySelectorAll('nav button')[${index}]; if (!button) return false; button.click(); return true; })()`);
  if (!clicked) throw new Error(`navigation button ${index} is not present`);
  await sleep(1_500);
}

const report = { targetUrl, cycles: [] };
for (let cycle = 1; cycle <= cycles; cycle++) {
  events.length = 0;
  await command('Page.reload', { ignoreCache: true });
  await waitForDom(
    `document.querySelector('[data-testid="identities-loading"]') === null && /DGX WORKER: LIVE/.test(document.body.innerText)`,
    'initial identity data',
  );
  const initial = await domState();
  await clickNav(1); // Medicare
  await waitForDom(
    `/INDEX \\/\\/\\s*[\\d,]+\\s+PATIENTS/.test(document.body.innerText) && !document.body.innerText.includes('Querying index')`,
    'Medicare index',
  );
  const medicare = await domState();
  await clickNav(0); // Identities
  await waitForDom(
    `document.querySelector('[data-testid="identities-loading"]') === null && /PEOPLE\\s+[\\d,]+/.test(document.body.innerText)`,
    'identity data after tab switch',
  );
  const identities = await domState();
  const detailOpened = await evaluate(`(() => { const button = document.querySelector('[data-testid="identity-open"]'); if (!button) return false; button.click(); return true; })()`);
  if (detailOpened) {
    await waitForDom(
      `/consolidated breakdown|source documents/i.test(document.body.innerText)`,
      'identity detail',
    );
  }
  const detail = await evaluate(`({ loaded: /consolidated breakdown|source documents/i.test(document.body.innerText), hasBack: [...document.querySelectorAll('button')].some((b) => b.innerText.trim().toUpperCase() === 'BACK') })`);
  if (detail.hasBack) {
    await evaluate(`([...document.querySelectorAll('button')].find((b) => b.innerText.trim().toUpperCase() === 'BACK')).click()`);
    await waitForDom(
      `document.querySelector('[data-testid="identities-loading"]') === null && document.querySelector('[data-testid="identity-open"]') !== null`,
      'return to identities',
    );
  }
  report.cycles.push({ cycle, initial, medicare, identities, detail });
}

report.api = await evaluate(`(async () => {
  const paths = ['/api/health', '/api/documents/count', '/api/identities?unassigned_limit=200&unassigned_offset=0', '/api/medicare/summary'];
  const output = {};
  for (const path of paths) {
    const started = performance.now();
    try {
      const response = await fetch(path, { cache: 'no-store' });
      const body = await response.json();
      output[path] = { status: response.status, ms: Math.round(performance.now() - started), keys: Object.keys(body) };
    } catch (error) {
      output[path] = { error: String(error) };
    }
  }
  return output;
})()`);
report.network = {
  failures: events.filter((event) => event.method === 'Network.loadingFailed').length,
  apiResponses: events
    .filter((event) => event.method === 'Network.responseReceived' && event.params.response.url.includes('/api/'))
    .map((event) => ({ path: new URL(event.params.response.url).pathname, status: event.params.response.status })),
  errors: events.filter((event) =>
    event.method === 'Runtime.exceptionThrown' ||
    (event.method === 'Runtime.consoleAPICalled' && ['error', 'assert'].includes(event.params.type)) ||
    (event.method === 'Log.entryAdded' && event.params.entry.level === 'error'),
  ).length,
};

const invalid = report.cycles.some(({ initial, medicare, identities, detail }) =>
  !initial.people || !initial.documents || !initial.unassigned ||
  initial.unassignedRendered > 200 || !initial.loadMore ||
  !medicare.medicare || medicare.querying || medicare.warning ||
  !identities.people || identities.unassignedRendered > 200 || identities.warning ||
  !detail?.loaded || !detail?.hasBack,
) || report.network.failures > 0 || report.network.errors > 0;
report.ok = !invalid;
console.log(JSON.stringify(report, null, 2));
ws.close();
if (invalid) process.exitCode = 1;

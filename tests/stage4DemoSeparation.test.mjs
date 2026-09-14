/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

import os from 'node:os';
import { pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const project = path.resolve(__dirname, '..');

const tempDir = path.join(project, 'node_modules', '.cache', 'stage4-tests');
fs.mkdirSync(tempDir, { recursive: true });

// Dynamic TS bundlers via esbuild to temporary files
async function loadMultipassOcr() {
  const outfile = path.join(tempDir, 'multipassOcr.mjs');
  await esbuild.build({
    entryPoints: [path.join(project, 'server', 'services', 'multipassOcr.ts')],
    bundle: true,
    write: true,
    outfile,
    format: 'esm',
    platform: 'node',
    packages: 'external',
  });
  return import(pathToFileURL(outfile).href);
}

async function loadServer() {
  process.env.NODE_ENV = 'test';
  const outfile = path.join(tempDir, 'server.mjs');
  await esbuild.build({
    entryPoints: [path.join(project, 'server.ts')],
    bundle: true,
    write: true,
    outfile,
    format: 'esm',
    platform: 'node',
    packages: 'external',
  });
  return import(pathToFileURL(outfile).href);
}

test('Stage 4 — Truthful Demonstration / Live Separation Test Suite', async (t) => {
  let server;
  let baseUrl;
  let ocrModule;
  let serverModule;

  t.before(async () => {
    process.env.NODE_ENV = 'test';
    ocrModule = await loadMultipassOcr();
    serverModule = await loadServer();

    // Start server on an ephemeral port
    await new Promise((resolve) => {
      server = http.createServer(serverModule.app);
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  t.after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  await t.test('Fact 1: server/services/multipassOcr.ts contains zero setTimeout calls', () => {
    const ocrSource = fs.readFileSync(
      path.join(project, 'server', 'services', 'multipassOcr.ts'),
      'utf8'
    );
    assert.strictEqual(
      ocrSource.includes('setTimeout'),
      false,
      'multipassOcr.ts must not contain any setTimeout calls'
    );
  });

  await t.test('Fact 1: Multipass OCR throws ServiceUnavailableError when cloud credentials are unconfigured', async () => {
    const prevGcp = process.env.GCP_DOC_AI_KEY;
    const prevAzure = process.env.AZURE_DOC_KEY;
    const prevAws = process.env.AWS_ACCESS_KEY_ID;
    const prevDemo = process.env.ENABLE_DEMO_FIXTURES;

    try {
      delete process.env.GCP_DOC_AI_KEY;
      delete process.env.AZURE_DOC_KEY;
      delete process.env.AWS_ACCESS_KEY_ID;
      delete process.env.ENABLE_DEMO_FIXTURES;

      assert.strictEqual(ocrModule.isCloudOcrConfigured(), false);

      const orchestrator = new ocrModule.MultipassOcrOrchestrator();
      const dummyBuffer = Buffer.from('Test invoice content');

      await assert.rejects(
        async () => {
          await orchestrator.processDocument(dummyBuffer, () => {});
        },
        (err) => {
          assert(err instanceof ocrModule.ServiceUnavailableError);
          assert.strictEqual(err.status, 503);
          assert.strictEqual(err.code, 'SERVICE_UNCONFIGURED');
          assert.strictEqual(err.service, 'multipass');
          return true;
        }
      );
    } finally {
      if (prevGcp) process.env.GCP_DOC_AI_KEY = prevGcp;
      if (prevAzure) process.env.AZURE_DOC_KEY = prevAzure;
      if (prevAws) process.env.AWS_ACCESS_KEY_ID = prevAws;
      if (prevDemo) process.env.ENABLE_DEMO_FIXTURES = prevDemo;
    }
  });

  await t.test('Fact 2: Unauthenticated POST /api/gdrive/sync returns 412 Precondition Failed', async () => {
    const prevToken = process.env.GDRIVE_ACCESS_TOKEN;
    try {
      delete process.env.GDRIVE_ACCESS_TOKEN;

      const res = await fetch(`${baseUrl}/api/gdrive/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderId: '16q3PdioHVbLIBVqU--54nBvNhqLE7bNN' }),
      });

      assert.strictEqual(res.status, 412, 'Expected status 412 Precondition Failed');

      const data = await res.json();
      assert.strictEqual(data.error, 'PRECONDITION_FAILED');
      assert.strictEqual(data.code, 'GDRIVE_UNCONFIGURED');
      assert.strictEqual(data.service, 'gdrive');
      assert.strictEqual(data.available, false);
      assert.strictEqual(data.mode, 'unconfigured');
      assert.strictEqual(data.status, undefined, 'Must not return fake status like SYNC_COMPLETE');
      assert.strictEqual(data.filesSynced, undefined, 'Must not return fake filesSynced');
    } finally {
      if (prevToken) process.env.GDRIVE_ACCESS_TOKEN = prevToken;
    }
  });

  await t.test('Fact 3: server.ts contains zero Math.random() calls and emits true clock metrics', async () => {
    const serverSource = fs.readFileSync(path.join(process.cwd(), 'server.ts'), 'utf8');
    assert.strictEqual(
      serverSource.includes('Math.random()'),
      false,
      'server.ts must not contain Math.random()'
    );

    const res = await fetch(`${baseUrl}/api/engine/multi-pass`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maxPasses: 2, forceAllPasses: true }),
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert(Array.isArray(data.passes));
    assert(data.passes.length >= 2);

    // Verify durationMs is non-random and numeric
    for (const pass of data.passes) {
      assert(typeof pass.durationMs === 'number');
      assert(pass.durationMs >= 0);
    }
  });

  await t.test('Fact 4: GET /api/gdrive/status returns honest unconfigured response without canned files', async () => {
    const prevToken = process.env.GDRIVE_ACCESS_TOKEN;
    const prevClientId = process.env.GDRIVE_CLIENT_ID;
    const prevDemo = process.env.ENABLE_DEMO_FIXTURES;

    try {
      delete process.env.GDRIVE_ACCESS_TOKEN;
      delete process.env.GDRIVE_CLIENT_ID;
      delete process.env.ENABLE_DEMO_FIXTURES;

      const res = await fetch(`${baseUrl}/api/gdrive/status`);
      assert.strictEqual(res.status, 200);

      const data = await res.json();
      assert.strictEqual(data.configured, false);
      assert.strictEqual(data.available, false);
      assert.strictEqual(data.mode, 'unconfigured');
      assert.strictEqual(data.syncState, 'unconfigured');
      assert.strictEqual(data.totalFiles, 0);
      assert.deepStrictEqual(data.files, []);
    } finally {
      if (prevToken) process.env.GDRIVE_ACCESS_TOKEN = prevToken;
      if (prevClientId) process.env.GDRIVE_CLIENT_ID = prevClientId;
      if (prevDemo) process.env.ENABLE_DEMO_FIXTURES = prevDemo;
    }
  });

  await t.test('Fact 4: GET /api/services/status adheres to frozen ServiceAvailabilityResponse contract', async () => {
    const res = await fetch(`${baseUrl}/api/services/status`);
    assert.strictEqual(res.status, 200);

    const data = await res.json();
    assert(Array.isArray(data), 'Services status must return an array');

    const expectedServices = ['gdrive', 'ocr_worker', 'multipass'];
    const returnedServices = data.map((s) => s.service);

    for (const exp of expectedServices) {
      assert(returnedServices.includes(exp), `Expected service ${exp} in status response`);
    }

    for (const item of data) {
      assert(['gdrive', 'ocr_worker', 'multipass'].includes(item.service));
      assert(['live', 'mock_development', 'unconfigured'].includes(item.mode));
      assert(typeof item.available === 'boolean');
      if (!item.available) {
        assert(typeof item.reason === 'string', 'Unavailable service should state a reason');
      }
    }
  });

  await t.test('Boundary condition: NODE_ENV=production blocks mock adapters even if ENABLE_DEMO_FIXTURES=true', () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const prevDemo = process.env.ENABLE_DEMO_FIXTURES;

    try {
      process.env.NODE_ENV = 'production';
      process.env.ENABLE_DEMO_FIXTURES = 'true';

      assert.strictEqual(
        ocrModule.isDemoFixturesAllowed(),
        false,
        'Production must strictly forbid demo mock adapters'
      );
    } finally {
      process.env.NODE_ENV = prevNodeEnv;
      if (prevDemo) {
        process.env.ENABLE_DEMO_FIXTURES = prevDemo;
      } else {
        delete process.env.ENABLE_DEMO_FIXTURES;
      }
    }
  });

  await t.test('UI Integrity: GoogleDriveHub.tsx error handling does not swallow failures into fake success', () => {
    const hubSource = fs.readFileSync(
      path.join(process.cwd(), 'src', 'components', 'GoogleDriveHub.tsx'),
      'utf8'
    );
    assert.strictEqual(
      hubSource.includes('Cluster storage synchronized. 9 files cached and verified with SHA-256 integrity.'),
      false,
      'GoogleDriveHub.tsx must not fake sync success in error catch blocks'
    );
  });
});

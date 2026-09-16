/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Stage 4 (superseded) — Google Drive integration and the cloud-OCR
 * (GCP/Azure/AWS) driver stubs were removed outright rather than fixed:
 * they never worked (all three cloud drivers unconditionally threw
 * "pending live integration"), and the fabricated /api/engine/multi-pass
 * demo depended on the Google Drive fixture data. Real OCR now happens
 * exclusively through the DGX job-queue pipeline (see
 * tests/dgxJobEndpoints.test.mjs). These tests guard that removal: the
 * dead code stays gone and the endpoints stay gone, rather than quietly
 * reappearing.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const project = path.resolve(__dirname, '..');

const tempDir = path.join(project, 'node_modules', '.cache', 'stage4-tests');
fs.mkdirSync(tempDir, { recursive: true });

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

test('Stage 4 (superseded) — Google Drive & cloud-OCR removal guard', async (t) => {
  let server;
  let baseUrl;
  let serverModule;

  t.before(async () => {
    process.env.NODE_ENV = 'test';
    serverModule = await loadServer();
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
    serverModule?.closeDb?.();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  await t.test('server/services/multipassOcr.ts no longer exists', () => {
    assert.strictEqual(
      fs.existsSync(path.join(project, 'server', 'services', 'multipassOcr.ts')),
      false,
      'Cloud OCR stub driver file must stay deleted',
    );
  });

  await t.test('server/routes/gdriveRoutes.ts no longer exists', () => {
    assert.strictEqual(
      fs.existsSync(path.join(project, 'server', 'routes', 'gdriveRoutes.ts')),
      false,
      'Google Drive route file must stay deleted',
    );
  });

  await t.test('src/components/GoogleDriveHub.tsx and src/data/gdriveDocuments.ts no longer exist', () => {
    assert.strictEqual(
      fs.existsSync(path.join(project, 'src', 'components', 'GoogleDriveHub.tsx')),
      false,
    );
    assert.strictEqual(
      fs.existsSync(path.join(project, 'src', 'data', 'gdriveDocuments.ts')),
      false,
    );
  });

  await t.test('src/components/MultiPassRegressionView.tsx (fabricated demo) no longer exists', () => {
    assert.strictEqual(
      fs.existsSync(path.join(project, 'src', 'components', 'MultiPassRegressionView.tsx')),
      false,
    );
  });

  await t.test('fabricated SuperStack research UI and data stay deleted', () => {
    assert.strictEqual(
      fs.existsSync(path.join(project, 'src', 'components', 'SuperStackResearchView.tsx')),
      false,
    );
    assert.strictEqual(
      fs.existsSync(path.join(project, 'src', 'data', 'researchPasses.ts')),
      false,
    );
  });

  await t.test('abandoned patch and WebSocket scripts stay deleted', () => {
    for (const relativePath of [
      'patch.js',
      'patch2.cjs',
      'patch3.cjs',
      'patch4.cjs',
      'patch_client.cjs',
      'test-ws.cjs',
      'test-ws-full.cjs',
      path.join('scripts', 'dgx_audit_report.sh'),
    ]) {
      assert.strictEqual(fs.existsSync(path.join(project, relativePath)), false, relativePath);
    }
  });

  await t.test('GET /api/gdrive/status is gone (404)', async () => {
    const res = await fetch(`${baseUrl}/api/gdrive/status`);
    assert.strictEqual(res.status, 404);
  });

  await t.test('POST /api/gdrive/sync is gone (404)', async () => {
    const res = await fetch(`${baseUrl}/api/gdrive/sync`, { method: 'POST' });
    assert.strictEqual(res.status, 404);
  });

  await t.test('POST /api/engine/multi-pass (fabricated demo) is gone (404)', async () => {
    const res = await fetch(`${baseUrl}/api/engine/multi-pass`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maxPasses: 2 }),
    });
    assert.strictEqual(res.status, 404);
  });

  await t.test('POST /api/process-document (dead cloud-OCR SSE route) is gone (404)', async () => {
    const res = await fetch(`${baseUrl}/api/process-document`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'x' }),
    });
    assert.strictEqual(res.status, 404);
  });

  await t.test('GET /api/services/status only lists real services', async () => {
    const res = await fetch(`${baseUrl}/api/services/status`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert(Array.isArray(data));
    const services = data.map((s) => s.service);
    assert.deepStrictEqual(new Set(services), new Set(['ocr_worker', 'dgx_worker']));
    for (const item of data) {
      assert(['live', 'unconfigured'].includes(item.mode));
      assert(typeof item.available === 'boolean');
    }
  });

  await t.test('GET /api/health reports no gdrive/multipass keys', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.services.gdrive, undefined);
    assert.strictEqual(data.services.multipass, undefined);
    assert.strictEqual(typeof data.services.ocr_worker.available, 'boolean');
    assert.strictEqual(typeof data.services.dgx_worker.available, 'boolean');
  });
});

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 2 — DGX job-queue endpoint contract tests.
 *
 * Exercises the real Express app, real SQLite DB, and real multer storage
 * (all pointed at an isolated temp dir) end to end: upload -> claim -> file
 * download -> result ingestion -> persisted fields. The DGX worker itself is
 * stubbed here (we POST a synthetic result the way the real worker would,
 * without running Python/OCR) — this is the CI-safe half of the Phase 2 test
 * plan; the real Python pipeline is verified separately and manually against
 * actual DGX hardware, not in this suite.
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

const tempDir = path.join(project, 'node_modules', '.cache', 'dgx-job-tests');
const dbPath = path.join(tempDir, 'app.db');
const storageRoot = path.join(tempDir, 'storage');
fs.rmSync(tempDir, { recursive: true, force: true });
fs.mkdirSync(tempDir, { recursive: true });

const WORKER_TOKEN = 'test-worker-token-abc123';

async function loadServer() {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_PATH = dbPath;
  process.env.STORAGE_ROOT = storageRoot;
  process.env.DGX_WORKER_TOKEN = WORKER_TOKEN;

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

function authHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function uploadPng(baseUrl, filename = 'scan.png') {
  const boundary = '----dgxTestBoundary';
  const body =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
    `Content-Type: image/png\r\n\r\n` +
    // Content must differ per file: identical bytes are deduplicated by the
    // server, which would return the first document instead of a new job.
    `not-a-real-png-but-multer-only-checks-mimetype-${filename}\r\n` +
    `--${boundary}--\r\n`;

  const res = await fetch(`${baseUrl}/api/documents`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body,
  });
  return { status: res.status, json: await res.json() };
}

test('Stage/Phase 2 — DGX job-queue endpoint contract', async (t) => {
  let server;
  let baseUrl;
  let serverModule;

  t.before(async () => {
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
      // Best-effort cleanup; a lingering Windows file lock here must not
      // fail the suite.
    }
  });

  await t.test('unauthenticated requests to worker endpoints are rejected, not silently allowed', async () => {
    const claimRes = await fetch(`${baseUrl}/api/jobs/claim`);
    assert.equal(claimRes.status, 401);

    const fileRes = await fetch(`${baseUrl}/api/jobs/does-not-exist/file`);
    assert.equal(fileRes.status, 401);

    const resultRes = await fetch(`${baseUrl}/api/jobs/does-not-exist/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'SUCCESS', rawText: 'x' }),
    });
    assert.equal(resultRes.status, 401);

    const scriptRes = await fetch(`${baseUrl}/api/scripts/dgx_setup.sh`);
    assert.equal(scriptRes.status, 401);
  });

  await t.test('wrong bearer token is rejected', async () => {
    const res = await fetch(`${baseUrl}/api/jobs/claim`, { headers: authHeaders('totally-wrong-token') });
    assert.equal(res.status, 401);
  });

  await t.test('with DGX_WORKER_TOKEN unset, worker endpoints fail closed (503), not open', async () => {
    delete process.env.DGX_WORKER_TOKEN;
    try {
      const res = await fetch(`${baseUrl}/api/jobs/claim`, { headers: authHeaders(WORKER_TOKEN) });
      assert.equal(res.status, 503);
    } finally {
      process.env.DGX_WORKER_TOKEN = WORKER_TOKEN;
    }
  });

  await t.test('full round trip: upload -> claim -> file download -> result -> persisted fields', async () => {
    const upload = await uploadPng(baseUrl);
    assert.equal(upload.status, 202, 'image upload without OCR configured should be honestly queued, not faked');
    assert.equal(upload.json.status, 'needs_ocr');
    const documentId = upload.json.document.id;

    const claimRes = await fetch(`${baseUrl}/api/jobs/claim`, { headers: authHeaders(WORKER_TOKEN) });
    assert.equal(claimRes.status, 200);
    const claim = await claimRes.json();
    assert.equal(claim.document.id, documentId);
    assert.equal(claim.job.status, 'processing');
    const jobId = claim.job.id;

    const emptyClaimRes = await fetch(`${baseUrl}/api/jobs/claim`, { headers: authHeaders(WORKER_TOKEN) });
    assert.equal(emptyClaimRes.status, 204, 'queue should be empty after the only job was claimed');

    const fileRes = await fetch(`${baseUrl}/api/jobs/${jobId}/file`, { headers: authHeaders(WORKER_TOKEN) });
    assert.equal(fileRes.status, 200);
    const fileBody = await fileRes.text();
    assert.match(fileBody, /not-a-real-png-but-multer-only-checks-mimetype/);

    const unauthedFileRes = await fetch(`${baseUrl}/api/jobs/${jobId}/file`);
    assert.equal(unauthedFileRes.status, 401);

    const resultRes = await fetch(`${baseUrl}/api/jobs/${jobId}/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(WORKER_TOKEN) },
      body: JSON.stringify({
        status: 'SUCCESS',
        rawText: 'Given Name: SARAH\nBSB: 062-000\nABN: 51 824 753 556',
        engineUsed: 'stub-test-worker',
        passes: [{ passNumber: 1, enginesUsed: ['Tesseract'], durationMs: 12.3, fieldsExtracted: 2 }],
      }),
    });
    assert.equal(resultRes.status, 201);
    const resultBody = await resultRes.json();
    assert.equal(resultBody.job.status, 'completed');
    assert.equal(resultBody.document.status, 'extracted');
    assert.equal(resultBody.extraction.metadata.engineUsed, 'stub-test-worker');
    assert.equal(resultBody.extraction.metadata.passes.length, 1);

    const bsbField = resultBody.extraction.fields.find((f) => f.name === 'Bank State Branch (BSB)');
    assert.ok(bsbField, 'BSB field must be present in the field catalogue');
    assert.equal(bsbField.value, '062-000');
    assert.equal(bsbField.validationStatus, 'valid');

    const docRes = await fetch(`${baseUrl}/api/documents/${documentId}`);
    const docBody = await docRes.json();
    assert.equal(docBody.document.status, 'extracted');
    assert.equal(docBody.jobs[0].status, 'completed');
  });

  await t.test('vlm_v2 result: Qwen-merged fields and page kinds are persisted; regex still validates', async () => {
    const upload = await uploadPng(baseUrl, 'vlm-scan.png');
    assert.equal(upload.status, 202);
    const claim = await (await fetch(`${baseUrl}/api/jobs/claim`, { headers: authHeaders(WORKER_TOKEN) })).json();
    const resultRes = await fetch(`${baseUrl}/api/jobs/${claim.job.id}/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(WORKER_TOKEN) },
      body: JSON.stringify({
        status: 'SUCCESS',
        rawText: 'BSB: 062-000' + String.fromCharCode(10) + 'Family name: (handwritten)',
        engineUsed: 'PaddleOCR-VL,TrOCR,Qwen3-VL',
        passes: [{ passNumber: 1 }],
        pages: [{ imageIndex: 0, kind: 'both', engines: ['PaddleOCR-VL', 'TrOCR', 'Qwen3-VL'], degraded: false, fieldCount: 3 }],
        vlmFields: [
          { name: 'family_name', value: 'Nguyen', source: 'handwriting', confidence: 0.85, digits_verified: null, evidence: 'line 2' },
          { name: 'bsb', value: '062-999', source: 'print', confidence: 0.35, digits_verified: false, evidence: '' },
          { name: 'account_number', value: '12345678', source: 'handwriting', confidence: 0.85, digits_verified: true, evidence: '' },
        ],
      }),
    });
    assert.equal(resultRes.status, 201);
    const body = await resultRes.json();
    const fields = body.extraction.fields;
    assert.equal(fields.find((f) => f.name === 'Family Name')?.value ?? fields.find((f) => /family/i.test(f.name))?.value, 'Nguyen');
    assert.equal(fields.find((f) => f.name === 'Bank State Branch (BSB)').value, '062-000', 'unverified Qwen digits must not override the regex reading');
    assert.equal(fields.find((f) => f.name === 'Account Number').value, '12345678');
    assert.equal(body.extraction.metadata.vlmFieldCount, 3);
    assert.equal(body.extraction.metadata.pages[0].kind, 'both');
  });

  await t.test('result for an unknown job id returns 404', async () => {
    const res = await fetch(`${baseUrl}/api/jobs/00000000-0000-0000-0000-000000000000/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(WORKER_TOKEN) },
      body: JSON.stringify({ status: 'SUCCESS', rawText: 'x' }),
    });
    assert.equal(res.status, 404);
  });

  await t.test('empty rawText on SUCCESS is rejected and marks the job failed, not silently completed', async () => {
    const upload = await uploadPng(baseUrl, 'scan2.png');
    const documentId = upload.json.document.id;
    const claimRes = await fetch(`${baseUrl}/api/jobs/claim`, { headers: authHeaders(WORKER_TOKEN) });
    const claim = await claimRes.json();

    const res = await fetch(`${baseUrl}/api/jobs/${claim.job.id}/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(WORKER_TOKEN) },
      body: JSON.stringify({ status: 'SUCCESS', rawText: '   ' }),
    });
    assert.equal(res.status, 400);

    const docRes = await fetch(`${baseUrl}/api/documents/${documentId}`);
    const docBody = await docRes.json();
    assert.equal(docBody.document.status, 'failed');
    assert.equal(docBody.jobs[0].status, 'failed');
  });

  await t.test('explicit FAILED status from the worker marks the job/document failed honestly', async () => {
    const upload = await uploadPng(baseUrl, 'scan3.png');
    const documentId = upload.json.document.id;
    const claimRes = await fetch(`${baseUrl}/api/jobs/claim`, { headers: authHeaders(WORKER_TOKEN) });
    const claim = await claimRes.json();

    const res = await fetch(`${baseUrl}/api/jobs/${claim.job.id}/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(WORKER_TOKEN) },
      body: JSON.stringify({ status: 'FAILED', error: 'GPU OOM during PaddleOCR pass' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'failed');

    const docRes = await fetch(`${baseUrl}/api/documents/${documentId}`);
    const docBody = await docRes.json();
    assert.equal(docBody.document.status, 'failed');
    assert.equal(docBody.jobs[0].error, 'GPU OOM during PaddleOCR pass');
  });
});

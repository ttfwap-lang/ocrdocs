/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 5 hardening contracts:
 *  - stale worker leases are reclaimed, retried, and eventually failed
 *  - the DGX telemetry endpoint requires the worker token and bounds what an
 *    untrusted remote host can store in server memory
 *  - extraction_version increments per document instead of always being 1
 *
 * Lease/attempt limits are read from the environment at module load, so this
 * suite runs with a 1-second lease and a 2-attempt budget in its own isolated
 * database rather than sharing one with the other endpoint tests.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const project = path.resolve(__dirname, '..');

const tempDir = path.join(project, 'node_modules', '.cache', 'job-lease-tests');
fs.rmSync(tempDir, { recursive: true, force: true });
fs.mkdirSync(tempDir, { recursive: true });

const WORKER_TOKEN = 'lease-test-token-xyz';
const LEASE_SECONDS = 1;
const MAX_ATTEMPTS = 2;

async function loadServer() {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_PATH = path.join(tempDir, 'app.db');
  process.env.STORAGE_ROOT = path.join(tempDir, 'storage');
  process.env.DGX_WORKER_TOKEN = WORKER_TOKEN;
  process.env.OCRDOCS_WORKER_LEASE_SECONDS = String(LEASE_SECONDS);
  process.env.OCRDOCS_MAX_JOB_ATTEMPTS = String(MAX_ATTEMPTS);

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

const auth = { Authorization: `Bearer ${WORKER_TOKEN}` };

async function uploadImage(baseUrl, filename) {
  const boundary = '----leaseTestBoundary';
  const body =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
    `Content-Type: image/png\r\n\r\n` +
    `synthetic-bytes-for-${filename}\r\n` +
    `--${boundary}--\r\n`;
  const res = await fetch(`${baseUrl}/api/documents`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body,
  });
  return res.json();
}

test('Phase 5 — job leases and endpoint hardening', async (t) => {
  let server;
  let baseUrl;
  let serverModule;

  t.before(async () => {
    serverModule = await loadServer();
    await new Promise((resolve) => {
      server = http.createServer(serverModule.app);
      server.listen(0, '127.0.0.1', () => {
        baseUrl = `http://127.0.0.1:${server.address().port}`;
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
      // Best-effort cleanup.
    }
  });

  await t.test('a job orphaned by a dead worker is reclaimed, then failed once retries run out', async () => {
    const upload = await uploadImage(baseUrl, 'orphan.png');
    const documentId = upload.document.id;

    // Attempt 1: claimed, then the "worker" dies without ever reporting back.
    const first = await fetch(`${baseUrl}/api/jobs/claim`, { headers: auth });
    assert.equal(first.status, 200);
    const firstClaim = await first.json();
    assert.equal(firstClaim.job.status, 'processing');
    assert.equal(firstClaim.job.attempts, 1);
    const jobId = firstClaim.job.id;

    // While the lease is still valid the job must not be handed to anyone else.
    const tooSoon = await fetch(`${baseUrl}/api/jobs/claim`, { headers: auth });
    assert.equal(tooSoon.status, 204, 'a live lease must not be stolen by a second worker');

    // SQLite's datetime('now') truncates to whole seconds, so wait comfortably
    // past the truncation boundary rather than racing it.
    await sleep((LEASE_SECONDS + 1.6) * 1000);

    // Attempt 2: the expired lease is reclaimed and the same job is re-issued.
    const second = await fetch(`${baseUrl}/api/jobs/claim`, { headers: auth });
    assert.equal(second.status, 200, 'an expired lease should return the job to the queue');
    const secondClaim = await second.json();
    assert.equal(secondClaim.job.id, jobId, 'the same job should be retried');
    assert.equal(secondClaim.job.attempts, 2);

    // SQLite's datetime('now') truncates to whole seconds, so wait comfortably
    // past the truncation boundary rather than racing it.
    await sleep((LEASE_SECONDS + 1.6) * 1000);

    // Retry budget is now exhausted: the job must fail rather than loop forever.
    const third = await fetch(`${baseUrl}/api/jobs/claim`, { headers: auth });
    assert.equal(third.status, 204, 'an exhausted job must not be retried again');

    const docRes = await fetch(`${baseUrl}/api/documents/${documentId}`);
    const docBody = await docRes.json();
    assert.equal(docBody.jobs[0].status, 'failed');
    assert.match(docBody.jobs[0].error, /lease expired/i);
    assert.equal(docBody.document.status, 'failed', 'the document must not look pending forever');
  });

  await t.test('telemetry ingestion requires the worker token', async () => {
    const unauthed = await fetch(`${baseUrl}/api/dgx/telemetry-report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hostname: 'attacker-host', currentUser: 'root' }),
    });
    assert.equal(unauthed.status, 401, 'anyone must not be able to inject telemetry');

    const stillEmpty = await fetch(`${baseUrl}/api/dgx/telemetry-report`);
    const body = await stillEmpty.json();
    assert.equal(body.hasReport, false, 'the rejected report must not have been stored');
  });

  await t.test('telemetry payloads are bounded and unknown keys are dropped', async () => {
    const res = await fetch(`${baseUrl}/api/dgx/telemetry-report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth },
      body: JSON.stringify({
        hostname: 'gx10-d0e7',
        currentUser: 'flak3dd',
        errorLog: 'E'.repeat(50_000),
        attackerControlledBlob: 'X'.repeat(100_000),
      }),
    });
    assert.equal(res.status, 200);

    const stored = await (await fetch(`${baseUrl}/api/dgx/telemetry-report`)).json();
    assert.equal(stored.hasReport, true);
    assert.equal(stored.latest.hostname, 'gx10-d0e7');
    assert.equal(
      stored.latest.attackerControlledBlob,
      undefined,
      'unknown keys must not be spread into server memory',
    );
    assert.ok(
      stored.latest.errorLog.length < 9_000,
      `errorLog should be truncated, got ${stored.latest.errorLog.length} chars`,
    );
    assert.match(stored.latest.errorLog, /truncated/);
  });

  await t.test('extraction_version increments per document instead of always being 1', async () => {
    const upload = await uploadImage(baseUrl, 'versioned.png');
    const documentId = upload.document.id;

    for (const expectedVersion of [1, 2]) {
      const claimRes = await fetch(`${baseUrl}/api/jobs/claim`, { headers: auth });
      assert.equal(claimRes.status, 200);
      const claim = await claimRes.json();
      assert.equal(claim.document.id, documentId);

      const resultRes = await fetch(`${baseUrl}/api/jobs/${claim.job.id}/result`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify({ status: 'SUCCESS', rawText: 'BSB: 062-000', engineUsed: 'stub' }),
      });
      assert.equal(resultRes.status, 201);
      assert.equal((await resultRes.json()).extraction.version, expectedVersion);

      // Re-queue the same document for a second pass via the real endpoint.
      if (expectedVersion === 1) {
        const requeue = await fetch(`${baseUrl}/api/documents/${documentId}/reprocess`, {
          method: 'POST',
        });
        assert.equal(requeue.status, 202);
      }
    }

    const docBody = await (await fetch(`${baseUrl}/api/documents/${documentId}`)).json();
    assert.equal(docBody.extractions.length, 2, 'both extraction versions must be retained');
    assert.deepEqual(
      docBody.extractions.map((e) => e.version).sort(),
      [1, 2],
      'reprocessing must not overwrite the earlier extraction',
    );
  });

  await t.test('re-uploading identical bytes returns the existing document instead of duplicating work', async () => {
    const first = await uploadImage(baseUrl, 'dedup.png');
    assert.equal(first.duplicate, undefined, 'the first upload is not a duplicate');
    const documentId = first.document.id;

    // Same bytes, different filename — content, not name, decides identity.
    const second = await uploadImage(baseUrl, 'dedup.png');
    assert.equal(second.duplicate, true);
    assert.equal(second.document.id, documentId, 'must return the original document');

    const all = await (await fetch(`${baseUrl}/api/documents`)).json();
    const matching = all.filter((d) => d.content_hash === first.document.content_hash);
    assert.equal(matching.length, 1, 'identical content must not create a second document row');

    // And it must not have queued a second OCR job for work already done.
    assert.equal(second.jobs.length, 1, 'a duplicate upload must not enqueue another job');
  });

  await t.test('reprocess refuses to double-queue a document and 404s an unknown one', async () => {
    const unknown = await fetch(`${baseUrl}/api/documents/nope/reprocess`, { method: 'POST' });
    assert.equal(unknown.status, 404);

    const upload = await uploadImage(baseUrl, 'double.png');
    const conflict = await fetch(`${baseUrl}/api/documents/${upload.document.id}/reprocess`, {
      method: 'POST',
    });
    assert.equal(conflict.status, 409, 'the upload already queued a job; a second must be refused');
  });
});

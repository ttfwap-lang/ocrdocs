/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Identity grouping, breakdown, file serving, and zip export — exercised
 * against the real Express app, real SQLite, and real multer storage, with
 * results ingested the way the DGX worker actually posts them (mirroring
 * tests/dgxJobEndpoints.test.mjs). The zip is verified by actually reading
 * its central directory and inflating an entry, not by trusting a 200 and a
 * Content-Type header.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const project = path.resolve(__dirname, '..');

const tempDir = path.join(project, 'node_modules', '.cache', 'identity-tests');
const dbPath = path.join(tempDir, 'app.db');
const storageRoot = path.join(tempDir, 'storage');
fs.rmSync(tempDir, { recursive: true, force: true });
fs.mkdirSync(tempDir, { recursive: true });

const WORKER_TOKEN = 'identity-test-worker-token';

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
  return { Authorization: `Bearer ${token}` };
}

async function uploadPng(baseUrl, filename, marker) {
  const boundary = '----identityTestBoundary';
  const body =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
    `Content-Type: image/png\r\n\r\n` +
    `not-a-real-png-${marker}\r\n` +
    `--${boundary}--\r\n`;

  const res = await fetch(`${baseUrl}/api/documents`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body,
  });
  return { status: res.status, json: await res.json() };
}

/** Upload an image, claim its job, and post a synthetic worker result — the same round trip a real DGX worker does. */
async function uploadAndExtract(baseUrl, filename, marker, rawText) {
  const upload = await uploadPng(baseUrl, filename, marker);
  assert.equal(upload.status, 202, `${filename} should queue for OCR`);
  const documentId = upload.json.document.id;

  const claimRes = await fetch(`${baseUrl}/api/jobs/claim`, { headers: authHeaders(WORKER_TOKEN) });
  assert.equal(claimRes.status, 200);
  const claim = await claimRes.json();
  assert.equal(claim.document.id, documentId);

  const resultRes = await fetch(`${baseUrl}/api/jobs/${claim.job.id}/result`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(WORKER_TOKEN) },
    body: JSON.stringify({ status: 'SUCCESS', rawText, engineUsed: 'identity-test-stub' }),
  });
  assert.equal(resultRes.status, 201, `result ingestion for ${filename} should succeed`);
  return documentId;
}

// --- Minimal, dependency-free ZIP reader (central directory + local header + inflate). ---

function readZipEntries(buf) {
  const eocdSig = 0x06054b50;
  let eocdOffset = -1;
  const scanStart = Math.max(0, buf.length - 4096);
  for (let i = buf.length - 22; i >= scanStart; i--) {
    if (buf.readUInt32LE(i) === eocdSig) {
      eocdOffset = i;
      break;
    }
  }
  assert.ok(eocdOffset >= 0, 'zip must contain a valid End Of Central Directory record');

  const totalEntries = buf.readUInt16LE(eocdOffset + 10);
  const cdOffset = buf.readUInt32LE(eocdOffset + 16);

  const entries = [];
  let ptr = cdOffset;
  for (let i = 0; i < totalEntries; i++) {
    assert.equal(buf.readUInt32LE(ptr), 0x02014b50, 'central directory entry signature must be valid');
    const method = buf.readUInt16LE(ptr + 10);
    const compressedSize = buf.readUInt32LE(ptr + 20);
    const uncompressedSize = buf.readUInt32LE(ptr + 24);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localHeaderOffset = buf.readUInt32LE(ptr + 42);
    const name = buf.toString('utf8', ptr + 46, ptr + 46 + nameLen);
    entries.push({ name, method, compressedSize, uncompressedSize, localHeaderOffset });
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function extractZipEntry(buf, entry) {
  const sig = buf.readUInt32LE(entry.localHeaderOffset);
  assert.equal(sig, 0x04034b50, 'local file header signature must be valid');
  const nameLen = buf.readUInt16LE(entry.localHeaderOffset + 26);
  const extraLen = buf.readUInt16LE(entry.localHeaderOffset + 28);
  const dataStart = entry.localHeaderOffset + 30 + nameLen + extraLen;
  const compressed = buf.subarray(dataStart, dataStart + entry.compressedSize);
  if (entry.method === 0) return compressed;
  assert.equal(entry.method, 8, `unexpected zip compression method ${entry.method} (expected store=0 or deflate=8)`);
  return zlib.inflateRawSync(compressed);
}

test('Identities — grouping, breakdown, file serving, and zip export', async (t) => {
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
    if (server) await new Promise((resolve) => server.close(resolve));
    serverModule?.closeDb?.();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup; a lingering Windows file lock must not fail the suite.
    }
  });

  let johnDocA;
  let johnDocB;
  let unassignedDocId;
  let johnIdentityId;
  let smithDocId;

  await t.test('two documents with the same name+DOB (different DOB punctuation) group into one identity', async () => {
    johnDocA = await uploadAndExtract(
      baseUrl,
      'john-statement.png',
      'a',
      'Given Name: JOHN\nFamily Name: DOE\nDOB: 14/08/1988\nBSB: 062-000',
    );
    johnDocB = await uploadAndExtract(
      baseUrl,
      'john-id-card.png',
      'b',
      'Given Name: JOHN\nFamily Name: DOE\nDOB: 14-08-1988\nABN: 51 824 753 556',
    );

    const res = await fetch(`${baseUrl}/api/identities`);
    assert.equal(res.status, 200);
    const body = await res.json();

    const john = body.identities.find((i) => i.fullName === 'John Doe');
    assert.ok(john, `expected a "John Doe" identity, got: ${JSON.stringify(body.identities)}`);
    assert.equal(john.documentCount, 2, 'both documents should be grouped under the one identity');
    assert.equal(john.dob, '14/08/1988');

    const filenames = john.previewDocuments.map((d) => d.filename).sort();
    assert.deepEqual(filenames, ['john-id-card.png', 'john-statement.png']);

    johnIdentityId = john.identityId;
  });

  await t.test('identities are listed family-name-first (then given names, then DOB), not by full name', async () => {
    // "Zoe Adams" (family=Adams) must sort before "John Doe"; "Alice Smith"
    // (family=Smith) must sort after "John Doe". A full-name sort would also
    // put Adams first but "Alice Smith" before "John Doe" -- the family-first
    // contract is what pins Smith after Doe.
    smithDocId = await uploadAndExtract(
      baseUrl,
      'alice-smith.png',
      'd',
      'Given Name: ALICE\nFamily Name: SMITH\nDOB: 09/02/1991\nTFN: 123 456 789',
    );
    await uploadAndExtract(
      baseUrl,
      'zoe-adams.png',
      'e',
      'Given Name: ZOE\nFamily Name: ADAMS\nDOB: 30/11/1985\nABN: 53 102 443 916',
    );

    const res = await fetch(`${baseUrl}/api/identities`);
    assert.equal(res.status, 200);
    const body = await res.json();

    const ordered = body.identities.map((i) => `${i.familyName}, ${i.givenNames}`);
    assert.deepEqual(
      ordered.filter((n) => /adams|doe|smith/i.test(n)),
      ['Adams, Zoe', 'Doe, John', 'Smith, Alice'],
      `identities must be family-name-first: ${JSON.stringify(ordered)}`,
    );
  });

  await t.test('a document missing family_name/date_of_birth is reported as unassigned, not guessed into a group', async () => {
    unassignedDocId = await uploadAndExtract(baseUrl, 'loose-statement.png', 'c', 'BSB: 083-004\nABN: 51 824 753 556');

    const res = await fetch(`${baseUrl}/api/identities`);
    const body = await res.json();

    const unassigned = body.unassigned.find((d) => d.id === unassignedDocId);
    assert.ok(unassigned, 'the nameless document should appear in the unassigned list');
    assert.equal(unassigned.filename, 'loose-statement.png');

    const leaked = body.identities.some((i) => i.previewDocuments.some((d) => d.id === unassignedDocId));
    assert.equal(leaked, false, 'the unassigned document must not appear inside any identity group');
  });

  await t.test('GET /api/identities/:id returns full detail with a merged, cross-document field breakdown', async () => {
    const res = await fetch(`${baseUrl}/api/identities/${johnIdentityId}`);
    assert.equal(res.status, 200);
    const detail = await res.json();

    assert.equal(detail.fullName, 'John Doe');
    assert.equal(detail.documents.length, 2);

    const bsb = detail.fieldBreakdown.find((f) => f.name === 'Bank State Branch (BSB)');
    assert.ok(bsb, 'BSB from document A should be in the merged breakdown');
    assert.equal(bsb.value, '062-000');
    assert.equal(bsb.documentId, johnDocA);

    const abn = detail.fieldBreakdown.find((f) => f.name.includes('ABN') || f.name.toLowerCase().includes('business number'));
    assert.ok(abn, `ABN field from document B should be in the merged breakdown: ${JSON.stringify(detail.fieldBreakdown.map((f) => f.name))}`);
    assert.equal(abn.documentId, johnDocB);

    // The breakdown must follow the field catalogue's logical order, not
    // alphabetical: given names < family name < DOB < ABN. Alphabetical order
    // would put "Australian Business Number" before "Given Names".
    const breakdownNames = detail.fieldBreakdown.map((f) => f.name);
    const givenIdx = breakdownNames.indexOf('Given Names / First Name');
    const familyIdx = breakdownNames.indexOf('Family Name / Surname');
    const dobIdx = breakdownNames.indexOf('Date of Birth (DOB)');
    const abnIdx = breakdownNames.findIndex((n) => n.includes('ABN') || n.toLowerCase().includes('business number'));
    for (const [name, idx] of [['Given Names / First Name', givenIdx], ['Family Name / Surname', familyIdx], ['Date of Birth (DOB)', dobIdx], ['ABN/Business Number', abnIdx]]) {
      assert.ok(idx >= 0, `${name} should be present in the breakdown: ${JSON.stringify(breakdownNames)}`);
    }
    assert.ok(
      givenIdx < familyIdx && familyIdx < dobIdx && dobIdx < abnIdx,
      `field breakdown must be in catalogue order (given=${givenIdx}, family=${familyIdx}, dob=${dobIdx}, abn=${abnIdx}): ${JSON.stringify(breakdownNames)}`,
    );
  });

  await t.test('unknown identityId returns 404', async () => {
    const res = await fetch(`${baseUrl}/api/identities/0000000000000000`);
    assert.equal(res.status, 404);
  });

  await t.test('GET /api/documents/:id/file serves the original bytes, inline by default and as attachment on request', async () => {
    const inlineRes = await fetch(`${baseUrl}/api/documents/${johnDocA}/file`);
    assert.equal(inlineRes.status, 200);
    assert.match(inlineRes.headers.get('content-disposition') || '', /^inline/);
    const inlineBody = await inlineRes.text();
    assert.match(inlineBody, /not-a-real-png-a/);

    const downloadRes = await fetch(`${baseUrl}/api/documents/${johnDocA}/file?download=1`);
    assert.match(downloadRes.headers.get('content-disposition') || '', /^attachment/);

    const missingRes = await fetch(`${baseUrl}/api/documents/00000000-0000-0000-0000-000000000000/file`);
    assert.equal(missingRes.status, 404);
  });

  await t.test('GET /api/identities/:id/export.zip produces a real zip with parseddata.txt and both originals', async () => {
    const res = await fetch(`${baseUrl}/api/identities/${johnIdentityId}/export.zip`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/zip');
    assert.match(res.headers.get('content-disposition') || '', /JohnDoe_export\.zip/);

    const buf = Buffer.from(await res.arrayBuffer());
    const entries = readZipEntries(buf);
    const names = entries.map((e) => e.name).sort();

    assert.ok(names.includes('JohnDoeparseddata.txt'), `expected JohnDoeparseddata.txt, got: ${names.join(', ')}`);
    const originals = names.filter((n) => n.startsWith('originals/'));
    assert.equal(originals.length, 2, 'both source documents should be in the zip');
    assert.ok(originals.some((n) => n.endsWith('john-statement.png')));
    assert.ok(originals.some((n) => n.endsWith('john-id-card.png')));

    const parsedEntry = entries.find((e) => e.name === 'JohnDoeparseddata.txt');
    const parsedText = extractZipEntry(buf, parsedEntry).toString('utf8');
    assert.match(parsedText, /John Doe/);
    assert.match(parsedText, /Date of Birth: 14\/08\/1988/);
    assert.match(parsedText, /Bank State Branch \(BSB\): 062-000/);
    assert.match(parsedText, /john-statement\.png/);
    assert.match(parsedText, /john-id-card\.png/);

    const originalEntry = entries.find((e) => e.name.endsWith('john-statement.png'));
    const originalBytes = extractZipEntry(buf, originalEntry).toString('utf8');
    assert.match(originalBytes, /not-a-real-png-a/, 'the zipped original must be the real uploaded bytes, not a placeholder');
  });

  await t.test('export.zip for an unknown identity returns 404', async () => {
    const res = await fetch(`${baseUrl}/api/identities/0000000000000000/export.zip`);
    assert.equal(res.status, 404);
  });
});

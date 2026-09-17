/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 4 — human review loop contract tests, plus the Phase 1 native-PDF
 * fast path (previously only ever verified by hand).
 *
 * Builds a real minimal PDF with a real text layer, uploads it through the
 * real Express app / SQLite / multer stack, and drives the full reviewer
 * workflow: list fields -> correct a value -> approve it.
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

const tempDir = path.join(project, 'node_modules', '.cache', 'review-tests');
fs.rmSync(tempDir, { recursive: true, force: true });
fs.mkdirSync(tempDir, { recursive: true });

/**
 * Builds a minimal but structurally valid single-page PDF with a real text
 * layer, so pdf-parse extracts genuine text rather than us mocking it.
 */
function buildTextPdf(lines) {
  const contentStream = lines
    .map((line, i) => `1 0 0 1 50 ${750 - i * 20} Tm (${line}) Tj`)
    .join('\n');
  const content = `BT /F1 12 Tf\n${contentStream}\nET`;

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 612 792] /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((obj, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });

  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

async function loadServer() {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_PATH = path.join(tempDir, 'app.db');
  process.env.STORAGE_ROOT = path.join(tempDir, 'storage');

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

async function uploadPdf(baseUrl, pdfBuffer, filename = 'application.pdf') {
  const boundary = '----reviewTestBoundary';
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: application/pdf\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([head, pdfBuffer, tail]);

  const res = await fetch(`${baseUrl}/api/documents`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body,
  });
  return { status: res.status, json: await res.json() };
}

/** Minimal parser for the fully-quoted CSV rows this endpoint emits. */
function parseCsvRow(row) {
  const cells = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (inQuotes) {
      if (ch === '"' && row[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      cells.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells;
}

const SAMPLE_LINES = [
  'Given Name: JOHNNY',
  'Family Name: TESTCASE',
  'Date of Birth: 01/01/1990',
  'BSB: 062-000',
  'ABN: 51 824 753 556',
];

test('Phase 4 — human review loop over a real native-text PDF', async (t) => {
  let server;
  let baseUrl;
  let serverModule;
  let extractionId;

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
      // Best-effort cleanup; a Windows file lock must not fail the suite.
    }
  });

  await t.test('native-text PDF is extracted synchronously on upload, with real parsed values', async () => {
    const upload = await uploadPdf(baseUrl, buildTextPdf(SAMPLE_LINES));

    assert.equal(upload.status, 201, 'a native-text PDF should complete, not queue for OCR');
    assert.equal(upload.json.job.status, 'completed');
    assert.equal(upload.json.document.status, 'extracted');
    assert.equal(upload.json.extraction.metadata.engineUsed, 'native-pdf-text');

    // Real text layer, really parsed — not a fixture.
    assert.match(upload.json.extraction.rawText, /BSB: 062-000/);

    const bsb = upload.json.extraction.fields.find((f) => f.name === 'Bank State Branch (BSB)');
    assert.equal(bsb.value, '062-000');
    assert.equal(bsb.validationStatus, 'valid');

    const abn = upload.json.extraction.fields.find((f) => f.name === 'Australian Business Number (ABN)');
    assert.equal(abn.value, '51 824 753 556');

    extractionId = upload.json.extraction.id;
    assert.ok(extractionId, 'extraction id must be exposed so review endpoints are reachable');
  });

  await t.test('the extraction id round-trips through GET /api/documents/:id', async () => {
    const listRes = await fetch(`${baseUrl}/api/documents`);
    const docs = await listRes.json();
    const docRes = await fetch(`${baseUrl}/api/documents/${docs[0].id}`);
    const docBody = await docRes.json();
    assert.equal(docBody.extractions[0].id, extractionId);
  });

  await t.test('fields are listed with ids; unknown extraction is 404', async () => {
    const unknownRes = await fetch(`${baseUrl}/api/extractions/does-not-exist/fields`);
    assert.equal(unknownRes.status, 404);

    const res = await fetch(`${baseUrl}/api/extractions/${extractionId}/fields`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.extractionId, extractionId);
    assert.ok(body.fields.length > 0);
    for (const field of body.fields) {
      assert.ok(field.id, 'every field row must carry its id');
      assert.equal(field.approved, 0, 'nothing is approved before a reviewer acts');
    }
  });

  async function getFields() {
    const res = await fetch(`${baseUrl}/api/extractions/${extractionId}/fields`);
    return (await res.json()).fields;
  }

  await t.test('a reviewer correction is stored without destroying the extracted value', async () => {
    const fields = await getFields();
    const bsb = fields.find((f) => f.field_name === 'Bank State Branch (BSB)');

    const res = await fetch(`${baseUrl}/api/fields/${bsb.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ correctedValue: '083-004', validationStatus: 'valid' }),
    });
    assert.equal(res.status, 200);
    const updated = (await res.json()).field;

    assert.equal(updated.corrected_value, '083-004');
    assert.equal(updated.field_value, '062-000', 'the original extracted value must be preserved');
    assert.equal(updated.validation_status, 'valid');
  });

  await t.test('PATCH rejects an unknown field and a missing correctedValue', async () => {
    const unknown = await fetch(`${baseUrl}/api/fields/no-such-field`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ correctedValue: 'x' }),
    });
    assert.equal(unknown.status, 404);

    const fields = await getFields();
    const missing = await fetch(`${baseUrl}/api/fields/${fields[0].id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ validationStatus: 'valid' }),
    });
    assert.equal(missing.status, 400);
  });

  await t.test('approving a field records the approval', async () => {
    const fields = await getFields();
    const bsb = fields.find((f) => f.field_name === 'Bank State Branch (BSB)');

    const res = await fetch(`${baseUrl}/api/fields/${bsb.id}/approve`, { method: 'POST' });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).field.approved, 1);

    const after = await getFields();
    assert.equal(after.find((f) => f.id === bsb.id).approved, 1);
  });

  await t.test('approval can be revoked', async () => {
    const fields = await getFields();
    const bsb = fields.find((f) => f.field_name === 'Bank State Branch (BSB)');

    const res = await fetch(`${baseUrl}/api/fields/${bsb.id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved: false }),
    });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).field.approved, 0);
  });

  await t.test('an empty field cannot be approved into looking reviewed', async () => {
    const fields = await getFields();
    const empty = fields.find((f) => f.field_value === null && f.corrected_value === null);
    assert.ok(empty, 'the 99-field catalogue should leave unmatched fields empty');

    const res = await fetch(`${baseUrl}/api/fields/${empty.id}/approve`, { method: 'POST' });
    assert.equal(res.status, 400, 'approving an empty field would record approval of nothing');

    const still = (await getFields()).find((f) => f.id === empty.id);
    assert.equal(still.approved, 0);
  });

  await t.test('consolidated CSV carries corrections, approval state, and is injection-safe', async () => {
    // Plant a value that Excel/Sheets would execute as a formula if exported raw.
    const fields = await getFields();
    const target = fields.find((f) => f.field_name === 'Australian Business Number (ABN)');
    const patch = await fetch(`${baseUrl}/api/fields/${target.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ correctedValue: '=cmd|"/c calc"!A1' }),
    });
    assert.equal(patch.status, 200);
    await fetch(`${baseUrl}/api/fields/${target.id}/approve`, { method: 'POST' });

    const res = await fetch(`${baseUrl}/api/export/consolidated.csv`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/csv/);
    const csv = await res.text();

    const [header, ...rows] = csv.split('\n');
    assert.match(header, /"document_id"/);
    assert.match(header, /"Australian Business Number \(ABN\)"/);
    assert.match(header, /"Australian Business Number \(ABN\)__approved"/);
    assert.ok(rows.length >= 1, 'every document should get a row');

    // The formula must be neutralised, not passed through raw.
    assert.ok(
      !csv.includes('"=cmd'),
      'a value starting with = must not be emitted as a live formula',
    );
    assert.ok(csv.includes(`"'=cmd|""/c calc""!A1"`), 'the value should still be readable, just inert');

    // Check the ABN column specifically. A blanket "the old value is absent"
    // assertion would be wrong: '51 824 753 556' legitimately still appears in
    // the Employer Name column, because the matcher has a known false positive
    // there (recorded as open in the issue register).
    const headerCells = parseCsvRow(header);
    const abnIndex = headerCells.indexOf('Australian Business Number (ABN)');
    assert.ok(abnIndex >= 0);
    const dataRow = parseCsvRow(rows.find((r) => r.includes("'=cmd")));
    assert.equal(dataRow[abnIndex], '\'=cmd|"/c calc"!A1', 'the ABN cell holds the reviewer correction');
    assert.equal(dataRow[abnIndex + 1], 'yes', 'approval state travels in the adjacent column');
  });

  await t.test('an empty field becomes approvable once a reviewer supplies a value', async () => {
    const fields = await getFields();
    const empty = fields.find((f) => f.field_value === null && f.corrected_value === null);

    const patch = await fetch(`${baseUrl}/api/fields/${empty.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ correctedValue: 'SUPPLIED BY REVIEWER', validationStatus: 'valid' }),
    });
    assert.equal(patch.status, 200);

    const approve = await fetch(`${baseUrl}/api/fields/${empty.id}/approve`, { method: 'POST' });
    assert.equal(approve.status, 200);
    assert.equal((await approve.json()).field.approved, 1);
  });
});

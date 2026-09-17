/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Real browser coverage of the reviewer flow, driving the installed Chrome
 * through Playwright against the real Express app, real SQLite and real
 * multer — upload a genuine native-text PDF, select it, open the review
 * panel, correct a value, approve it, and confirm the change persisted
 * server-side and survives a page reload.
 *
 * This exists because "typechecks and builds" is not evidence that a UI
 * works. It skips (rather than fails) when Playwright or Chrome is absent,
 * so the suite still runs on a machine without a browser.
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
const project = path.resolve(__dirname, '../..');

// Unique per run: a leftover directory from an interrupted run can stay locked
// by Windows, and reusing a fixed path would fail setup before the test starts.
const tempDir = path.join(
  project,
  'node_modules',
  '.cache',
  `browser-review-${process.pid}-${Date.now()}`,
);

/** Playwright and a real Chrome are optional; skip cleanly when missing. */
async function loadPlaywright() {
  try {
    const { chromium } = await import('playwright');
    return chromium;
  } catch {
    return null;
  }
}

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

test('browser: reviewer can correct and approve a field, and it persists', async (t) => {
  const chromium = await loadPlaywright();
  if (!chromium) {
    t.skip('playwright is not installed; install it to run browser coverage');
    return;
  }

  fs.rmSync(tempDir, { recursive: true, force: true });
  fs.mkdirSync(tempDir, { recursive: true });

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
  const serverModule = await import(pathToFileURL(outfile).href);

  // The SPA is served from dist/ in this mode, so the build must exist.
  if (!fs.existsSync(path.join(project, 'dist', 'index.html'))) {
    serverModule.closeDb?.();
    t.skip('dist/ is not built; run `npm run build` before browser coverage');
    return;
  }

  // `app` only carries API routes; the SPA is mounted inside startServer().
  // Mount the built assets the same way production does so the browser has a
  // page to load.
  const express = (await import('express')).default;
  serverModule.app.use(express.static(path.join(project, 'dist')));
  serverModule.app.get('*', (_req, res) => {
    res.sendFile(path.join(project, 'dist', 'index.html'));
  });

  const server = http.createServer(serverModule.app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  let browser;
  try {
    try {
      browser = await chromium.launch({ channel: 'chrome', headless: true });
    } catch {
      t.skip('no installed Chrome available for Playwright');
      return;
    }

    const pdfPath = path.join(tempDir, 'review-flow.pdf');
    fs.writeFileSync(pdfPath, buildTextPdf(['BSB: 062-000', 'ABN: 51 824 753 556']));

    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    page.on('response', (r) => {
      if (r.status() >= 400) pageErrors.push(`${r.status()} ${r.url()}`);
    });

    await page.goto(baseUrl, { waitUntil: 'networkidle' });

    await page.locator('input[type="file"]').first().setInputFiles(pdfPath);
    await page.waitForTimeout(2500);

    // Dismiss the upload queue so the only remaining occurrence of the
    // filename is the clickable Document Queue row.
    await page
      .locator('text=UPLOAD QUEUE')
      .first()
      .locator('xpath=ancestor::div[1]')
      .locator('button')
      .last()
      .click()
      .catch(() => {});
    await page.waitForTimeout(400);
    await page.locator('text=review-flow.pdf').last().click();
    await page.waitForTimeout(1200);

    assert.ok(
      await page.locator('text=062-000').first().isVisible(),
      'the extracted BSB should be rendered in the detail panel',
    );

    await page.locator('button', { hasText: /Review & Approve/i }).first().click();
    await page.waitForTimeout(1000);

    const bsbRow = page.locator('div').filter({ hasText: /^Bank State Branch \(BSB\)/ }).last();
    await bsbRow.locator('button', { hasText: 'Edit' }).first().click();
    const input = page.locator('input[placeholder*="Corrected value"]').first();
    await input.fill('083-004');
    await input.press('Enter');
    await page.waitForTimeout(1000);

    assert.ok(
      await page.locator('text=083-004').first().isVisible(),
      'the correction should be rendered',
    );
    assert.ok(
      await page.locator('text=/was: 062-000/').first().isVisible(),
      'the superseded extracted value should remain visible, not be destroyed',
    );

    await bsbRow.locator('button', { hasText: /^Approve$/ }).first().click();
    await page.waitForTimeout(1000);
    assert.ok(
      await bsbRow.locator('button', { hasText: /^Approved$/ }).first().isVisible(),
      'the row should show as approved',
    );

    // The UI claiming success is not evidence: check the server.
    const docs = await (await fetch(`${baseUrl}/api/documents`)).json();
    const detail = await (await fetch(`${baseUrl}/api/documents/${docs[0].id}`)).json();
    const extractionId = detail.extractions[detail.extractions.length - 1].id;
    const fields = (await (await fetch(`${baseUrl}/api/extractions/${extractionId}/fields`)).json()).fields;
    const bsb = fields.find((f) => f.field_name === 'Bank State Branch (BSB)');

    assert.equal(bsb.corrected_value, '083-004', 'correction must reach the database');
    assert.equal(bsb.approved, 1, 'approval must reach the database');
    assert.equal(bsb.field_value, '062-000', 'the original extracted value must survive');

    // And it must come back from the server after a reload, not from memory.
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    await page.locator('text=review-flow.pdf').last().click();
    await page.waitForTimeout(800);
    await page.locator('button', { hasText: /Review & Approve/i }).first().click();
    await page.waitForTimeout(1000);
    assert.ok(
      await page.locator('text=083-004').first().isVisible(),
      'the correction must survive a full page reload',
    );

    assert.deepEqual(pageErrors, [], 'the page should load with no errors or failed requests');
  } finally {
    await browser?.close().catch(() => {});
    await new Promise((resolve) => server.close(resolve));
    serverModule.closeDb?.();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup.
    }
  }
});

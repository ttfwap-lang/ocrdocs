// Real browser verification of the review UI, driving the installed Chrome.
import { chromium } from 'playwright';

const BASE = 'http://localhost:3000';
const PDF = process.argv[2];
const SHOTS = process.argv[3];

const results = [];
const ok = (label, cond, extra = '') => {
  results.push({ label, cond, extra });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? ' :: ' + extra : ''}`);
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
const failedRequests = [];
page.on('response', (r) => { if (r.status() >= 400) failedRequests.push(`${r.status()} ${r.url()}`); });

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.screenshot({ path: `${SHOTS}/01-landing.png` });
ok('app renders', await page.locator('text=Documents').first().isVisible());

// --- Upload a real PDF through the actual file input ---
await page.locator('input[type="file"]').first().setInputFiles(PDF);
await page.waitForTimeout(2500);
await page.screenshot({ path: `${SHOTS}/02-uploaded.png` });

const rowVisible = await page.locator('text=ui-verify.pdf').first().isVisible().catch(() => false);
ok('uploaded document appears in list', rowVisible);

// --- Select it. Dismiss the upload queue first so the only remaining
// occurrence of the filename is the clickable Document Queue row. ---
const dismiss = page.locator('button').filter({ has: page.locator('svg') }).nth(0);
await page.locator('text=UPLOAD QUEUE').first().locator('xpath=ancestor::div[1]').locator('button').last().click().catch(() => {});
await page.waitForTimeout(500);
await page.locator('text=ui-verify.pdf').last().click();
await page.waitForTimeout(1200);
await page.screenshot({ path: `${SHOTS}/03-selected.png` });

const bsbShown = await page.locator('text=062-000').first().isVisible().catch(() => false);
ok('extracted BSB value rendered in detail panel', bsbShown);

// --- Open the review panel ---
const reviewBtn = page.locator('button', { hasText: /Review & Approve/i }).first();
ok('Review & Approve button present', await reviewBtn.isVisible().catch(() => false));
await reviewBtn.click();
await page.waitForTimeout(1200);
await page.screenshot({ path: `${SHOTS}/04-review-open.png` });

const reviewerHeader = await page.locator('text=/Reviewer \\/\\//').first().isVisible().catch(() => false);
ok('reviewer panel opens with field rows', reviewerHeader);

// --- Correct a field: click Edit on the row containing the BSB value ---
const bsbRow = page.locator('div').filter({ hasText: /^Bank State Branch \(BSB\)/ }).last();
const editBtn = bsbRow.locator('button', { hasText: 'Edit' }).first();
await editBtn.click();
await page.waitForTimeout(400);

const input = page.locator('input[placeholder*="Corrected value"]').first();
ok('correction input appears on Edit', await input.isVisible().catch(() => false));
await input.fill('083-004');
await page.screenshot({ path: `${SHOTS}/05-editing.png` });
await input.press('Enter');
await page.waitForTimeout(1200);
await page.screenshot({ path: `${SHOTS}/06-corrected.png` });

const correctedShown = await page.locator('text=083-004').first().isVisible().catch(() => false);
ok('corrected value rendered', correctedShown);
const originalStruck = await page.locator('text=/was: 062-000/').first().isVisible().catch(() => false);
ok('original value still shown as superseded, not destroyed', originalStruck);

// --- Approve it ---
const bsbRowAfter = page.locator('div').filter({ hasText: /^Bank State Branch \(BSB\)/ }).last();
const approveBtn = bsbRowAfter.locator('button', { hasText: /^Approve$/ }).first();
await approveBtn.click();
await page.waitForTimeout(1200);
await page.screenshot({ path: `${SHOTS}/07-approved.png` });

const approvedShown = await bsbRowAfter.locator('button', { hasText: /^Approved$/ }).first().isVisible().catch(() => false);
ok('approval reflected in UI', approvedShown);

// --- Confirm it actually persisted server-side, not just in React state ---
const apiDocs = await (await fetch(`${BASE}/api/documents`)).json();
const doc = apiDocs.find((d) => d.filename === 'ui-verify.pdf');
const detail = await (await fetch(`${BASE}/api/documents/${doc.id}`)).json();
const extractionId = detail.extractions[detail.extractions.length - 1].id;
const fields = (await (await fetch(`${BASE}/api/extractions/${extractionId}/fields`)).json()).fields;
const bsb = fields.find((f) => f.field_name === 'Bank State Branch (BSB)');
ok('correction persisted to database', bsb.corrected_value === '083-004', `corrected_value=${bsb.corrected_value}`);
ok('approval persisted to database', bsb.approved === 1, `approved=${bsb.approved}`);
ok('original extracted value preserved in DB', bsb.field_value === '062-000', `field_value=${bsb.field_value}`);

// --- Reload the page: state must come from the server, not memory ---
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await page.locator('text=ui-verify.pdf').last().click();
await page.waitForTimeout(1000);
await page.locator('button', { hasText: /Review & Approve/i }).first().click();
await page.waitForTimeout(1200);
await page.screenshot({ path: `${SHOTS}/08-after-reload.png` });
const survives = await page.locator('text=083-004').first().isVisible().catch(() => false);
ok('correction survives a full page reload', survives);

ok('no failing HTTP requests', failedRequests.length === 0, failedRequests.slice(0, 5).join(' | '));
ok('no uncaught console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

await browser.close();

const failed = results.filter((r) => !r.cond);
console.log(`\n${results.length - failed.length}/${results.length} browser checks passed`);
process.exit(failed.length ? 1 : 0);

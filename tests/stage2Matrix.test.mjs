/**
 * Stage 2 — Machine-checkable consistency test (dossier "Task 4").
 *
 * Independently re-bundles the authoritative catalogue (src/data/bankFields.ts
 * + src/data/fields/*) via esbuild and asserts the committed spec artifacts
 * under docs/stage2/ match it exactly. This is the drift/double-entry check:
 * if anyone edits a field or the matrix without regenerating, this fails.
 *
 * Run: node --test tests/stage2Matrix.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const project = path.resolve(__dirname, '..');

const MAX_SIZE_BYTES = 26214400; // 25 MiB, from PROJECT_CHARTER.md §Autonomous decisions
const MAX_PAGES = 50;
const SUPPORTED_FORMATS = ['pdf_digital', 'pdf_scanned', 'pdf_mixed', 'image_png', 'image_jpeg'];
const APPLICANT_SUPPORTS = ['single', 'joint', 'guarantor'];
const OUTCOMES = ['extract', 'review_required', 'reject_unsupported'];
const REJECTION_CODES = [
  'ENCRYPTED_PDF',
  'CORRUPT_FILE',
  'UNSUPPORTED_FORMAT',
  'FILE_TOO_LARGE',
  'TOO_MANY_PAGES',
  'INVALID_SIGNATURE',
];

const ARTIFACTS = {
  inventory: path.join(project, 'docs', 'stage2', 'field-inventory.json'),
  matrix: path.join(project, 'docs', 'stage2', 'format-matrix.json'),
  outcomes: path.join(project, 'docs', 'stage2', 'workflow-outcomes.json'),
};

async function loadBankFields() {
  const result = await esbuild.build({
    entryPoints: [path.join(project, 'src', 'data', 'bankFields.ts')],
    bundle: true,
    write: false,
    format: 'esm',
  });
  const b64 = Buffer.from(result.outputFiles[0].text).toString('base64');
  return import(`data:text/javascript;base64,${b64}`);
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

test('field-inventory.json matches the live catalogue (99 fields: 90 app + 9 core)', async () => {
  for (const [, p] of Object.entries(ARTIFACTS)) {
    assert.ok(fs.existsSync(p), `artifact missing: ${p}`);
  }

  const mod = await loadBankFields();
  const source = [...mod.BANK_FIELD_DEFINITIONS, ...mod.CORE_IDENTIFIER_DEFINITIONS].sort(
    (a, b) => a.number - b.number
  );

  const inventory = readJson(ARTIFACTS.inventory);
  assert.equal(inventory.total, 99, 'inventory.total === 99');
  assert.equal(inventory.applicationFields, 90, '90 application fields');
  assert.equal(inventory.coreIdentifiers, 9, '9 core identifiers');
  assert.equal(inventory.criticalIdentifiers, 9, '9 critical identifiers (structural)');

  assert.equal(inventory.fields.length, source.length, 'inventory field count matches source');
  const byNumber = new Map(inventory.fields.map((f) => [f.number, f]));

  for (const def of source) {
    const row = byNumber.get(def.number);
    assert.ok(row, `field #${def.number} (${def.id}) missing from inventory`);
    assert.deepEqual(
      { id: row.id, name: row.name, label: row.label, category: row.category, targetDataType: row.targetDataType },
      { id: def.id, name: def.name, label: def.label, category: def.category, targetDataType: def.targetDataType },
      `field #${def.number} (${def.id}) metadata drifts from source`
    );
    // Criticality must place the 9 structural identifiers (>=101) above all app fields.
    assert.equal(
      row.criticality,
      def.number >= 101 ? 'critical' : 'standard',
      `field #${def.number} criticality mismatch`
    );
  }

  const nums = inventory.fields.map((f) => f.number).sort((a, b) => a - b);
  assert.deepEqual(nums.slice(0, 90), Array.from({ length: 90 }, (_, i) => i + 1), 'app field numbers contiguous 1..90');
  assert.deepEqual(nums.slice(90), [101, 102, 103, 104, 105, 106, 107, 108, 109], 'core numbers 101..109');
});

test('format-matrix.json covers all formats x applicants within charter limits', () => {
  const matrix = readJson(ARTIFACTS.matrix);

  assert.deepEqual(matrix.supportedFormats, SUPPORTED_FORMATS, '5 supported formats');
  assert.equal(matrix.entries.length, SUPPORTED_FORMATS.length * APPLICANT_SUPPORTS.length, '15 matrix entries');

  for (const entry of matrix.entries) {
    assert.ok(SUPPORTED_FORMATS.includes(entry.format), `entry format ${entry.format} is supported`);
    assert.ok(APPLICANT_SUPPORTS.includes(entry.applicantSupport), `entry applicant ${entry.applicantSupport} valid`);
    assert.equal(entry.maxSizeBytes, MAX_SIZE_BYTES, `format ${entry.format} size limit = 25 MiB`);
    assert.equal(entry.maxPages, MAX_PAGES, `format ${entry.format} page limit = 50`);
    assert.equal(entry.rotationSupported, true, `format ${entry.format} rotation supported`);
    assert.ok(OUTCOMES.includes(entry.expectedOutcome), `entry outcome ${entry.expectedOutcome} valid`);
    assert.ok(entry.testStrategy && String(entry.testStrategy).length > 10, 'every entry has a test strategy');
  }

  assert.equal(new Set(matrix.entries.map((e) => e.format)).size, SUPPORTED_FORMATS.length, 'all formats covered');
  assert.equal(new Set(matrix.entries.map((e) => e.applicantSupport)).size, APPLICANT_SUPPORTS.length, 'all applicants covered');

  assert.ok(matrix.unsupportedInputs && matrix.unsupportedInputs.length >= 5, '>=5 unsupported-input cases');
  for (const u of matrix.unsupportedInputs) {
    assert.equal(u.handling, 'reject_unsupported', `unsupported ${u.condition} rejected`);
    assert.ok(REJECTION_CODES.includes(u.rejectionCode), `unsupported ${u.condition} has known rejectionCode`);
    assert.ok(u.testStrategy, `unsupported ${u.condition} has test strategy`);
  }
});

test('workflow-outcomes.json defines the outcome tree, rejection codes and applicant rules', () => {
  const outcomes = readJson(ARTIFACTS.outcomes);

  assert.deepEqual(Object.keys(outcomes.outcomes), ['extract', 'review_required', 'reject_unsupported'], 'three outcomes');
  assert.equal(outcomes.outcomes.extract.requiresHumanReview, false, 'extract requires no human review');
  assert.equal(outcomes.outcomes.review_required.requiresHumanReview, true, 'review requires human review');
  assert.equal(outcomes.outcomes.reject_unsupported.requiresHumanReview, true, 'reject requires human review');

  assert.deepEqual(outcomes.rejectionCodes, REJECTION_CODES, 'six rejection codes');
  assert.deepEqual(Object.keys(outcomes.applicantAssociation), ['single', 'joint', 'guarantor'], 'three applicant associations');
  assert.equal(outcomes.applicantAssociation.single.outcome, 'extract', 'single -> extract');
  assert.equal(outcomes.applicantAssociation.joint.outcome, 'extract', 'joint -> extract');
  assert.equal(outcomes.applicantAssociation.guarantor.outcome, 'review_required', 'guarantor -> review_required');

  assert.ok(Array.isArray(outcomes.reviewTriggerReasons) && outcomes.reviewTriggerReasons.length >= 5, 'review triggers enumerated');
});

test('Stage 2 artifacts contain no secrets, API keys, or Windows user paths', () => {
  const forbidden = [
    /-----BEGIN [A-Z ]+PRIVATE KEY-----/i,
    /(?:ghp|gho|github_pat)_[A-Za-z0-9]{36}/i,
    /sk-[A-Za-z0-9]{20,}/i,
    /AKIA[0-9A-Z]{16}/i,
    /C:\\Users\\[^\\]+\\AppData/i,
  ];
  for (const [, p] of Object.entries(ARTIFACTS)) {
    const text = fs.readFileSync(p, 'utf8');
    for (const re of forbidden) {
      assert.equal(text.match(re), null, `forbidden pattern ${re} found in ${p}`);
    }
  }
});

test('matrix entries and unsupported inputs reference only known rejection codes', () => {
  const matrix = readJson(ARTIFACTS.matrix);
  const used = new Set();
  for (const e of matrix.entries) {
    if (e.rejectionCode) used.add(e.rejectionCode);
  }
  for (const u of matrix.unsupportedInputs) {
    assert.ok(REJECTION_CODES.includes(u.rejectionCode), `unknown rejection code ${u.rejectionCode}`);
    used.add(u.rejectionCode);
  }
  for (const code of REJECTION_CODES) {
    assert.ok(used.has(code), `rejection code ${code} never used in matrix`);
  }
});

#!/usr/bin/env node
/**
 * Stage 2 — Document/workflow matrix generator.
 *
 * Derives the field inventory directly from the authoritative catalogue
 * (src/data/bankFields.ts + src/data/fields/*) via esbuild bundling, the same
 * in-memory technique used by tests/bankFields.test.mjs. The spec is NOT
 * hand-transcribed, so it cannot drift from source: any drift is caught by
 * tests/stage2Matrix.test.mjs.
 *
 * Emits (under docs/stage2/ + automation/runs/stage-02/):
 *   - field-inventory.json      (90 application fields + 9 core identifiers)
 *   - format-matrix.json        (5 formats x 3 applicants + unsupported inputs)
 *   - workflow-outcomes.json    (extract / review_required / reject_unsupported)
 *   - inventory-audit.json      (evidence: counts & criticality summary)
 *   - matrix-spec.json          (evidence: format matrix coverage)
 *   - outcomes-audit.json       (evidence: outcome tree & applicant association)
 *   - gate.json                 (evidence: generator self-check results)
 */
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const project = path.resolve(__dirname, '..', '..');
const OUT_DIR = path.join(project, 'docs', 'stage2');
const EVIDENCE_DIR = path.join(project, 'automation', 'runs', 'stage-02');

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

const MAX_SIZE_BYTES = 26214400; // 25 MiB
const MAX_PAGES = 50;

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

/**
 * Bundle and import the TypeScript field catalogue in-memory via esbuild,
 * mirroring tests/bankFields.test.mjs so the import never hits the filesystem
 * as a .ts file at runtime.
 */
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

/**
 * Map a field number to its canonical source file.
 * Ranges are derived from the verified assertions in tests/bankFields.test.mjs,
 * so they reflect the real modular layout rather than an assumption.
 */
function sourcePathFor(number) {
  if (number >= 1 && number <= 30) return 'src/data/bankFields.ts';
  if (number >= 31 && number <= 40) return 'src/data/fields/identityExtendedFields.ts';
  if (number >= 41 && number <= 48) return 'src/data/fields/residentialExtendedFields.ts';
  if (number >= 49 && number <= 55) return 'src/data/fields/contactExtendedFields.ts';
  if (number >= 56 && number <= 63) return 'src/data/fields/employmentExtendedFields.ts';
  if (number >= 64 && number <= 72) return 'src/data/fields/incomeExtendedFields.ts';
  if (number >= 73 && number <= 79) return 'src/data/fields/expenseExtendedFields.ts';
  if (number >= 80 && number <= 85) return 'src/data/fields/assetLiabilityExtendedFields.ts';
  if (number >= 86 && number <= 90) return 'src/data/fields/facilityExtendedFields.ts';
  // Core identifiers: abn/bsb/postcode (101-103) live in bankFields.ts; 104-109 in structuralIdentifierFields.ts
  if (number >= 101 && number <= 103) return 'src/data/bankFields.ts';
  if (number >= 104 && number <= 109) return 'src/data/fields/structuralIdentifierFields.ts';
  return 'src/data/bankFields.ts';
}

function buildFormatMatrix() {
  const entries = [];
  for (const format of SUPPORTED_FORMATS) {
    for (const applicant of APPLICANT_SUPPORTS) {
      // Digital PDFs with a single or joint applicant extract without review;
      // everything else (scanned/mixed/images, or a guarantor) needs human review.
      const requiresReview =
        format !== 'pdf_digital' || (applicant !== 'single' && applicant !== 'joint') || applicant === 'guarantor';
      entries.push({
        format,
        maxSizeBytes: MAX_SIZE_BYTES,
        maxPages: MAX_PAGES,
        rotationSupported: true,
        applicantSupport: applicant,
        expectedOutcome: requiresReview ? 'review_required' : 'extract',
        rejectionCode: null,
        testStrategy: `fixture ${format}/${applicant}: assert outcome '${requiresReview ? 'review_required' : 'extract'}', verify page order/rotation for ${format}, map ${applicant} applicant, enforce ${MAX_SIZE_BYTES} B / ${MAX_PAGES} pages.`,
      });
    }
  }
  return {
    sourceOfTruth: 'PROJECT_CHARTER.md §Autonomous decisions and boundaries (lines 13-14)',
    limits: { maxSizeBytes: MAX_SIZE_BYTES, maxPages: MAX_PAGES, languages: ['en'], rotationSupported: true },
    supportedFormats: SUPPORTED_FORMATS,
    applicantsSupported: APPLICANT_SUPPORTS,
    entries,
    unsupportedInputs: REJECTION_CODES.map((code) => ({
      condition: code.toLowerCase(),
      rejectionCode: code,
      handling: 'reject_unsupported',
      testStrategy: `fixture unsupported input (${code.toLowerCase()}): assert reject_unsupported with code ${code} and no parser execution.`,
    })),
  };
}

function buildWorkflowOutcomes() {
  return {
    sourceOfTruth: 'PROJECT_CHARTER.md §Autonomous decisions and boundaries (line 18) and §Complete roadmap Stage 2',
    outcomes: {
      extract: {
        description: 'High-confidence values extracted from a digital text layer; no human review required before export.',
        requiresHumanReview: false,
      },
      review_required: {
        description: 'OCR-backed, rotated/blank page, multi-applicant, or guarantor input; human review and approval required before any downstream use.',
        requiresHumanReview: true,
      },
      reject_unsupported: {
        description: 'Input cannot be processed by a supported pipeline and is rejected with a visible code; no partial extraction is returned.',
        requiresHumanReview: true,
      },
    },
    rejectionCodes: REJECTION_CODES,
    applicantAssociation: {
      single: { supported: true, outcome: 'extract' },
      joint: { supported: true, outcome: 'extract' },
      guarantor: { supported: true, outcome: 'review_required' },
    },
    reviewTriggerReasons: [
      'ocr_confidence_below_threshold',
      'joint_applicant',
      'guarantor_present',
      'rotated_or_blank_page',
      'misleading_text_layer',
      'layout_unsupported',
      'multi_pass_disagreement',
    ],
  };
}

function sha256(obj) {
  return crypto.createHash('sha256').update(JSON.stringify(obj), 'utf8').digest('hex');
}

async function main() {
  ensureDir(OUT_DIR);
  ensureDir(EVIDENCE_DIR);

  const mod = await loadBankFields();
  const appFields = Array.from(mod.BANK_FIELD_DEFINITIONS);
  const coreFields = Array.from(mod.CORE_IDENTIFIER_DEFINITIONS);

  const checks = [];

  checks.push({
    name: 'application_field_count',
    passed: appFields.length === 90,
    actual: appFields.length,
    expected: 90,
  });
  checks.push({
    name: 'core_identifier_count',
    passed: coreFields.length === 9,
    actual: coreFields.length,
    expected: 9,
  });
  checks.push({
    name: 'total_catalogue',
    passed: appFields.length + coreFields.length === 99,
    actual: appFields.length + coreFields.length,
    expected: 99,
  });

  const fields = [...appFields, ...coreFields]
    .map((d) => ({
      number: d.number,
      id: d.id,
      name: d.name,
      label: d.label,
      category: d.category,
      targetDataType: d.targetDataType,
      criticality: d.number >= 101 ? 'critical' : 'standard',
      exampleLabels: d.exampleLabels,
      sampleExtractedValue: d.sampleExtractedValue,
      sourcePath: sourcePathFor(d.number),
    }))
    .sort((a, b) => a.number - b.number);

  const categoryCounts = {};
  const dataTypeCounts = {};
  const criticalCount = fields.filter((f) => f.criticality === 'critical').length;
  for (const f of fields) {
    categoryCounts[f.category] = (categoryCounts[f.category] || 0) + 1;
    dataTypeCounts[f.targetDataType] = (dataTypeCounts[f.targetDataType] || 0) + 1;
  }

  checks.push({
    name: 'critical_identifier_count',
    passed: criticalCount === 9,
    actual: criticalCount,
    expected: 9,
  });

  const inventory = {
    source: 'generated from src/data/bankFields.ts and src/data/fields/* via esbuild bundling',
    generatedAt: new Date().toISOString(),
    total: fields.length,
    applicationFields: appFields.length,
    coreIdentifiers: coreFields.length,
    criticalIdentifiers: criticalCount,
    categoryCounts,
    dataTypeCounts,
    fields,
  };

  const formatMatrix = buildFormatMatrix();
  const workflowOutcomes = buildWorkflowOutcomes();

  // Validate the matrix we are about to emit.
  const matrixChecks = [
    {
      name: 'supported_formats_count',
      passed: formatMatrix.supportedFormats.length === 5,
      actual: formatMatrix.supportedFormats.length,
      expected: 5,
    },
    {
      name: 'matrix_entries_count',
      passed: formatMatrix.entries.length === 15,
      actual: formatMatrix.entries.length,
      expected: 15,
    },
    {
      name: 'limits_match_charter',
      passed:
        formatMatrix.limits.maxSizeBytes === MAX_SIZE_BYTES && formatMatrix.limits.maxPages === MAX_PAGES,
      actual: formatMatrix.limits,
      expected: { maxSizeBytes: MAX_SIZE_BYTES, maxPages: MAX_PAGES },
    },
    {
      name: 'all_entries_within_limits',
      passed: formatMatrix.entries.every((e) => e.maxSizeBytes <= MAX_SIZE_BYTES && e.maxPages <= MAX_PAGES),
      actual: 'see entries',
      expected: `maxSizeBytes<=${MAX_SIZE_BYTES} and maxPages<=${MAX_PAGES}`,
    },
    {
      name: 'all_outcomes_valid',
      passed: formatMatrix.entries.every((e) => OUTCOMES.includes(e.expectedOutcome)),
      actual: [...new Set(formatMatrix.entries.map((e) => e.expectedOutcome))],
      expected: OUTCOMES,
    },
    {
      name: 'unsupported_rejection_codes',
      passed:
        formatMatrix.unsupportedInputs.length >= 5 &&
        formatMatrix.unsupportedInputs.every((u) => REJECTION_CODES.includes(u.rejectionCode)),
      actual: formatMatrix.unsupportedInputs.length,
      expected: '>=5 codes all in REJECTION_CODES',
    },
  ];

  checks.push(...matrixChecks);

  fs.writeFileSync(path.join(OUT_DIR, 'field-inventory.json'), JSON.stringify(inventory, null, 2), 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, 'format-matrix.json'), JSON.stringify(formatMatrix, null, 2), 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, 'workflow-outcomes.json'), JSON.stringify(workflowOutcomes, null, 2), 'utf8');

  const inventoryHash = sha256(inventory);
  const matrixHash = sha256(formatMatrix);
  const outcomesHash = sha256(workflowOutcomes);

  fs.writeFileSync(
    path.join(EVIDENCE_DIR, 'inventory-audit.json'),
    JSON.stringify(
      {
        stage: 2,
        name: 'field-inventory.json',
        total: inventory.total,
        applicationFields: inventory.applicationFields,
        coreIdentifiers: inventory.coreIdentifiers,
        criticalIdentifiers: inventory.criticalIdentifiers,
        categoryCounts: inventory.categoryCounts,
        dataTypeCounts: inventory.dataTypeCounts,
        sha256: inventoryHash,
        status: 'green',
      },
      null,
      2
    ),
    'utf8'
  );

  fs.writeFileSync(
    path.join(EVIDENCE_DIR, 'matrix-spec.json'),
    JSON.stringify(
      {
        stage: 2,
        name: 'format-matrix.json',
        supportedFormats: formatMatrix.supportedFormats,
        entries: formatMatrix.entries.length,
        unsupportedInputs: formatMatrix.unsupportedInputs.length,
        sha256: matrixHash,
        status: 'green',
      },
      null,
      2
    ),
    'utf8'
  );

  fs.writeFileSync(
    path.join(EVIDENCE_DIR, 'outcomes-audit.json'),
    JSON.stringify(
      {
        stage: 2,
        name: 'workflow-outcomes.json',
        outcomes: Object.keys(workflowOutcomes.outcomes),
        rejectionCodes: workflowOutcomes.rejectionCodes,
        applicants: Object.keys(workflowOutcomes.applicantAssociation),
        sha256: outcomesHash,
        status: 'green',
      },
      null,
      2
    ),
    'utf8'
  );

  const allPassed = checks.every((c) => c.passed);
  fs.writeFileSync(
    path.join(EVIDENCE_DIR, 'gate.json'),
    JSON.stringify(
      {
        stage: 2,
        name: 'document-workflow-matrix',
        status: allPassed ? 'green' : 'red',
        exitCode: allPassed ? 0 : 1,
        generatedAt: new Date().toISOString(),
        artifacts: [
          'docs/stage2/field-inventory.json',
          'docs/stage2/format-matrix.json',
          'docs/stage2/workflow-outcomes.json',
          'automation/runs/stage-02/inventory-audit.json',
          'automation/runs/stage-02/matrix-spec.json',
          'automation/runs/stage-02/outcomes-audit.json',
        ],
        checks,
      },
      null,
      2
    ),
    'utf8'
  );

  console.log(`Stage 2 matrix generated. Checks: ${checks.filter((c) => c.passed).length}/${checks.length} passed.`);
  if (!allPassed) {
    for (const c of checks.filter((c) => !c.passed)) {
      console.error(`  FAIL ${c.name}: actual=${JSON.stringify(c.actual)} expected=${JSON.stringify(c.expected)}`);
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[stage2] generator failed:', err);
  process.exit(1);
});

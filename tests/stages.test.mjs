import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  REQUIRED_SECTIONS,
  VALID_STATUSES,
  VALID_WEIGHT_AREAS,
  extractCharterGateQuote,
  hashQuote,
  normalizeText,
  parseAcceptanceEvidenceTable,
  parseCharter,
  parseDossierSections,
  parseFrontMatter,
  validateAntiFabrication,
  validateBidirectionalConsistency,
  validateDagAcyclicity,
  validateFrontMatter,
  validateGateQuote,
  validateSectionSchema,
} from '../scripts/stages/charter-parser.mjs';

import { generateIndexContent } from '../scripts/stages/build-index.mjs';
import {
  inspectSourceFile,
  refineDossierContent,
  refineDownstream,
} from '../scripts/stages/refine-downstream.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const charterPath = path.join(repoRoot, 'PROJECT_CHARTER.md');
const stagesDir = path.join(repoRoot, 'docs/stages');
const templatePath = path.join(stagesDir, '_TEMPLATE.md');
const readmePath = path.join(stagesDir, 'README.md');

function loadCharterStages() {
  const content = fs.readFileSync(charterPath, 'utf8');
  return parseCharter(content);
}

function loadAuthoredDossiers() {
  const files = fs.readdirSync(stagesDir);
  const dossierFiles = files.filter((f) => /^stage-(0[1-9]|[1-4][0-9]|5[0-5])-[a-z0-9-]+\.md$/.test(f));
  return dossierFiles.map((f) => {
    const fullPath = path.join(stagesDir, f);
    const content = fs.readFileSync(fullPath, 'utf8');
    const { meta, body } = parseFrontMatter(content);
    const sections = parseDossierSections(body);
    return { filename: f, fullPath, content, meta, body, sections };
  });
}

describe('Stage Charter & Dossier Guard Suite', () => {
  it('charter parses to exactly 55 contiguous stages with valid gates', () => {
    const stages = loadCharterStages();
    assert.strictEqual(stages.length, 55, 'Charter must define exactly 55 stages');

    for (let i = 0; i < 55; i++) {
      const s = stages[i];
      assert.strictEqual(s.stage, i + 1, `Stage sequence must be contiguous at index ${i}`);
      assert.ok(s.title.length > 0, `Stage ${s.stage} must have a non-empty title`);
      assert.ok(s.slug.length > 0, `Stage ${s.stage} must have a non-empty slug`);
      assert.ok(s.gateQuote.length > 0, `Stage ${s.stage} must have a non-empty gate paragraph`);
      assert.ok(s.gateQuote.includes('Gate:'), `Stage ${s.stage} gate must contain "Gate:"`);
      assert.strictEqual(s.gateQuoteSha256.length, 64, `Stage ${s.stage} must have 64-char sha256 hash`);
    }
  });

  it('dossier inventory discovers all 55 stage dossiers', () => {
    const dossiers = loadAuthoredDossiers();
    assert.strictEqual(dossiers.length, 55, 'Expected exactly 55 authored stage dossiers');

    const stageNums = dossiers.map((d) => d.meta.stage);
    for (let i = 1; i <= 55; i++) {
      assert.ok(stageNums.includes(i), `Stage ${i} dossier must exist on disk`);
    }

    const charterStages = loadCharterStages();
    const charterMap = new Map(charterStages.map((cs) => [cs.stage, cs]));

    for (const d of dossiers) {
      const match = d.filename.match(/^stage-(\d+)-([a-z0-9-]+)\.md$/);
      assert.ok(match, `Filename "${d.filename}" must match stage-NN-slug.md`);

      const fileStage = parseInt(match[1], 10);
      const fileSlug = match[2];

      assert.strictEqual(d.meta.stage, fileStage, `Front matter stage must match filename in ${d.filename}`);
      assert.strictEqual(d.meta.slug, fileSlug, `Front matter slug must match filename in ${d.filename}`);

      const cs = charterMap.get(d.meta.stage);
      assert.ok(cs, `Stage ${d.meta.stage} must exist in PROJECT_CHARTER.md`);
      assert.strictEqual(d.meta.title, cs.title, `Front matter title must match charter title in ${d.filename}`);
    }
  });

  it('front-matter schema passes for all authored dossiers', () => {
    const dossiers = loadAuthoredDossiers();
    for (const d of dossiers) {
      assert.doesNotThrow(
        () => validateFrontMatter(d.meta),
        `Front-matter in ${d.filename} must satisfy schema`
      );
    }
  });

  it('verbatim gate quotes byte-match charter and verify SHA-256 hashes', () => {
    const dossiers = loadAuthoredDossiers();
    const charterStages = loadCharterStages();
    const charterMap = new Map(charterStages.map((cs) => [cs.stage, cs]));

    for (const d of dossiers) {
      const cs = charterMap.get(d.meta.stage);
      const quoteSection = d.sections.find((s) => s.heading === '## Charter gate (verbatim)');
      assert.ok(quoteSection, `## Charter gate (verbatim) must exist in ${d.filename}`);

      const extractedQuote = extractCharterGateQuote(quoteSection.content);
      assert.doesNotThrow(
        () => validateGateQuote(extractedQuote, cs.gateQuote, d.meta.gate_quote_sha256),
        `Gate quote verification failed in ${d.filename}`
      );
    }
  });

  it('section ordering and completeness matches exactly 12 required sections in fixed order', () => {
    const dossiers = loadAuthoredDossiers();
    for (const d of dossiers) {
      assert.doesNotThrow(
        () => validateSectionSchema(d.sections),
        `Section schema failed in ${d.filename}`
      );
    }

    // Also assert _TEMPLATE.md adheres to the exact 12 sections
    const templateContent = fs.readFileSync(templatePath, 'utf8');
    const { body: templateBody } = parseFrontMatter(templateContent);
    const templateSections = parseDossierSections(templateBody);
    assert.doesNotThrow(
      () => validateSectionSchema(templateSections),
      '_TEMPLATE.md must contain all 12 required sections in order'
    );
  });

  it('dependency graph across authored dossiers is strictly acyclic and bidirectionally consistent', () => {
    const dossiers = loadAuthoredDossiers();
    const nodes = dossiers.map((d) => ({
      stage: d.meta.stage,
      depends_on: d.meta.depends_on,
      blocks: d.meta.blocks,
    }));

    assert.doesNotThrow(() => validateDagAcyclicity(nodes), 'Authored dossiers must form an acyclic graph');
    assert.doesNotThrow(() => validateBidirectionalConsistency(nodes), 'Authored dossiers must have bidirectionally consistent depends_on and blocks');
  });

  it('secret and path scan confirms zero leaked credentials or user paths', () => {
    const files = fs.readdirSync(stagesDir).filter((f) => f.endsWith('.md'));

    const forbiddenPatterns = [
      { name: 'Google API key', regex: /AIza[0-9A-Za-z-_]{35}/ },
      { name: 'OpenAI API key', regex: /sk-[a-zA-Z0-9]{20,}/ },
      { name: 'Anthropic API key', regex: /sk-ant-[a-zA-Z0-9]{20,}/ },
      { name: 'Bearer token', regex: /Bearer\s+[A-Za-z0-9_\-\.]{25,}/ },
      { name: 'Hardcoded Windows User Profile Path', regex: /[a-zA-Z]:\\Users\\[a-zA-Z0-9_.-]+\\/i },
    ];

    for (const file of files) {
      const fullPath = path.join(stagesDir, file);
      const text = fs.readFileSync(fullPath, 'utf8');

      for (const { name, regex } of forbiddenPatterns) {
        assert.ok(!regex.test(text), `Detected forbidden pattern (${name}) in ${file}`);
      }
    }
  });

  it('anti-fabrication gate validates evidence discipline for complete stages', () => {
    const dossiers = loadAuthoredDossiers();

    for (const d of dossiers) {
      const acceptanceSection = d.sections.find((s) => s.heading === '## Acceptance evidence');
      assert.ok(acceptanceSection, `## Acceptance evidence must exist in ${d.filename}`);
      const rows = parseAcceptanceEvidenceTable(acceptanceSection.content);

      if (d.meta.status === 'complete') {
        assert.doesNotThrow(
          () => validateAntiFabrication(d.meta, rows, repoRoot),
          `Anti-fabrication gate failed for complete stage ${d.meta.stage}`
        );
      }
    }

    // Explicitly verify Stage 1 is complete and Stage 2 is deferred
    const s1 = dossiers.find((d) => d.meta.stage === 1);
    assert.ok(s1, 'Stage 1 must be present');
    assert.strictEqual(s1.meta.status, 'complete', 'Stage 1 must be complete');

    const s2 = dossiers.find((d) => d.meta.stage === 2);
    assert.ok(s2, 'Stage 2 must be present');
    assert.strictEqual(s2.meta.status, 'deferred', 'Stage 2 must be deferred');
  });

  it('dynamic index README.md matches build-index generator output', () => {
    assert.ok(fs.existsSync(readmePath), 'docs/stages/README.md must exist');
    const existingContent = fs.readFileSync(readmePath, 'utf8');
    const generatedContent = generateIndexContent();

    assert.strictEqual(
      normalizeText(existingContent),
      normalizeText(generatedContent),
      'docs/stages/README.md has drifted from build-index.mjs output. Run: node scripts/stages/build-index.mjs --write'
    );
  });
});

describe('Guard Negative Mutation Tests (Proof that Guards Bite)', () => {
  it('corrupting a verbatim gate quote throws quote drift or sha256 mismatch', () => {
    const charterQuote = 'Create the acceptance register. Gate: every promise has a check.';
    const tamperedQuote = 'Create the acceptance register. Gate: every promise has a check (tampered).';
    const hash = hashQuote(charterQuote);

    assert.throws(
      () => validateGateQuote(tamperedQuote, charterQuote, hash),
      /Gate quote drift detected/
    );

    // Corrupt hash only
    assert.throws(
      () => validateGateQuote(charterQuote, charterQuote, '0000000000000000000000000000000000000000000000000000000000000000'),
      /Gate quote SHA-256 mismatch/
    );
  });

  it('introducing a dependency cycle throws DAG cycle detected error', () => {
    const cyclicNodes = [
      { stage: 1, depends_on: [3], blocks: [2] },
      { stage: 2, depends_on: [1], blocks: [3] },
      { stage: 3, depends_on: [2], blocks: [1] },
    ];

    assert.throws(
      () => validateDagAcyclicity(cyclicNodes),
      /DAG cycle detected/
    );
  });

  it('asymmetric dependency without matching block throws bidirectional consistency error', () => {
    const asymmetricNodes = [
      { stage: 1, depends_on: [], blocks: [2] },
      { stage: 2, depends_on: [1], blocks: [] }, // Blocks does not include 3
      { stage: 3, depends_on: [2], blocks: [] },
    ];

    assert.throws(
      () => validateBidirectionalConsistency(asymmetricNodes),
      /Bidirectional consistency error.*Stage 3 depends on Stage 2, but Stage 2 does not list Stage 3 in blocks/
    );
  });

  it('self-dependency throws self-dependency error', () => {
    const selfDepNodes = [
      { stage: 5, depends_on: [5], blocks: [] },
    ];

    assert.throws(
      () => validateDagAcyclicity(selfDepNodes),
      /Self-dependency detected/
    );
  });

  it('missing or reordered sections throw schema error', () => {
    // Missing section
    const incompleteSections = REQUIRED_SECTIONS.slice(0, 11).map((h) => ({ heading: h, content: '' }));
    assert.throws(
      () => validateSectionSchema(incompleteSections),
      /Section count mismatch/
    );

    // Swapped order
    const swappedSections = REQUIRED_SECTIONS.map((h) => ({ heading: h, content: '' }));
    const temp = swappedSections[1];
    swappedSections[1] = swappedSections[2];
    swappedSections[2] = temp;
    assert.throws(
      () => validateSectionSchema(swappedSections),
      /Section order mismatch/
    );
  });

  it('claiming complete with pending evidence rows throws anti-fabrication error', () => {
    const fakeMeta = {
      stage: 10,
      status: 'complete',
      evidence_dir: 'automation/runs/stage-01',
    };
    const rowsWithPending = [
      { fact: 'Test fact', command: 'npm test', expectedOutcome: 'pass', status: 'pending', evidencePath: 'automation/runs/stage-01/summary.json' },
    ];

    assert.throws(
      () => validateAntiFabrication(fakeMeta, rowsWithPending, repoRoot),
      /Anti-fabrication violation.*expected "green" or "external-gate"/
    );
  });

  it('claiming complete with missing evidence artifact file throws anti-fabrication error', () => {
    const fakeMeta = {
      stage: 10,
      status: 'complete',
      evidence_dir: 'automation/runs/stage-01',
    };
    const rowsWithNonExistentFile = [
      { fact: 'Test fact', command: 'npm test', expectedOutcome: 'pass', status: 'green', evidencePath: 'automation/runs/stage-01/non-existent-artifact.json' },
    ];

    assert.throws(
      () => validateAntiFabrication(fakeMeta, rowsWithNonExistentFile, repoRoot),
      /Anti-fabrication violation.*references non-existent evidence artifact/
    );
  });

  it('claiming complete with non-existent evidence_dir throws anti-fabrication error', () => {
    const fakeMeta = {
      stage: 10,
      status: 'complete',
      evidence_dir: 'automation/runs/non-existent-stage-dir',
    };
    const validRows = [
      { fact: 'Test fact', command: 'npm test', expectedOutcome: 'pass', status: 'green', evidencePath: 'automation/runs/stage-01/summary.json' },
    ];

    assert.throws(
      () => validateAntiFabrication(fakeMeta, validRows, repoRoot),
      /Anti-fabrication violation.*evidence_dir does not exist/
    );
  });

  it('invalid status in front-matter throws schema error', () => {
    const badMeta = {
      stage: 1,
      slug: 'bad-status',
      title: 'Bad Status',
      status: 'done-and-verified-trust-me',
      depends_on: [],
      blocks: [],
      weight_area: 'security',
      external_gates: [],
      charter_lines: '1-2',
      gate_quote_sha256: 'a'.repeat(64),
      evidence_dir: 'runs',
      last_reconciled: '2026-09-14',
    };

    assert.throws(
      () => validateFrontMatter(badMeta),
      /Invalid status/
    );
  });

  it('invalid weight area in front-matter throws schema error', () => {
    const badMeta = {
      stage: 1,
      slug: 'bad-weight',
      title: 'Bad Weight',
      status: 'not-started',
      depends_on: [],
      blocks: [],
      weight_area: 'quantum-computing',
      external_gates: [],
      charter_lines: '1-2',
      gate_quote_sha256: 'a'.repeat(64),
      evidence_dir: 'runs',
      last_reconciled: '2026-09-14',
    };

    assert.throws(
      () => validateFrontMatter(badMeta),
      /Invalid weight_area/
    );
  });
});

describe('Post-Stage Downstream Refinement Suite', () => {
  it('dry-run execution on Stage 1 refines all 54 downstream dossiers and preserves all invariants', async () => {
    const result = await refineDownstream({ stage: 1, dryRun: true, silent: true });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.refinedCount, 54);
    assert.strictEqual(result.updatedStages.length, 54);
    assert.strictEqual(result.updatedStages[0], 2);
    assert.strictEqual(result.updatedStages[53], 55);
  });

  it('terminal Stage 55 returns 0 refined dossiers gracefully', async () => {
    const result = await refineDownstream({ stage: 55, dryRun: true, silent: true });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.refinedCount, 0);
    assert.deepStrictEqual(result.updatedStages, []);
  });

  it('rejection of invalid stage numbers throws descriptive errors', async () => {
    await assert.rejects(
      async () => refineDownstream({ stage: 0, dryRun: true, silent: true }),
      /Invalid stage number: "0"/
    );
    await assert.rejects(
      async () => refineDownstream({ stage: 56, dryRun: true, silent: true }),
      /Invalid stage number: "56"/
    );
    await assert.rejects(
      async () => refineDownstream({ stage: 'bad-stage', dryRun: true, silent: true }),
      /Invalid stage number: "bad-stage"/
    );
  });

  it('inspectSourceFile correctly extracts TypeScript types, REST endpoints, SQL tables, and functions with line numbers', () => {
    const sampleCode = [
      '/**',
      ' * Test sample file',
      ' */',
      'export interface ApplicationRecord {',
      '  id: string;',
      '}',
      '',
      'export type ProcessingMode = "live" | "simulated";',
      '',
      'CREATE TABLE IF NOT EXISTS sample_documents (id TEXT PRIMARY KEY);',
      '',
      'app.post("/api/v1/extract", handleExtract);',
      'router.get("/api/v1/status", handleStatus);',
      '',
      'export function executeExtraction() {',
      '  return true;',
      '}',
    ].join('\n');

    const result = inspectSourceFile('test/sample.ts', sampleCode);

    assert.strictEqual(result.types.length, 2);
    assert.strictEqual(result.types[0].name, 'ApplicationRecord');
    assert.strictEqual(result.types[0].line, 4);
    assert.strictEqual(result.types[1].name, 'ProcessingMode');
    assert.strictEqual(result.types[1].line, 8);

    assert.strictEqual(result.tables.length, 1);
    assert.strictEqual(result.tables[0].table, 'sample_documents');
    assert.strictEqual(result.tables[0].line, 10);

    assert.strictEqual(result.routes.length, 2);
    assert.strictEqual(result.routes[0].method, 'POST');
    assert.strictEqual(result.routes[0].route, '/api/v1/extract');
    assert.strictEqual(result.routes[0].line, 12);
    assert.strictEqual(result.routes[1].method, 'GET');
    assert.strictEqual(result.routes[1].route, '/api/v1/status');
    assert.strictEqual(result.routes[1].line, 13);

    assert.strictEqual(result.functions.length, 1);
    assert.strictEqual(result.functions[0].name, 'executeExtraction');
    assert.strictEqual(result.functions[0].line, 15);
  });

  it('refineDossierContent preserves verbatim charter gate quote byte-for-byte and verifies quote hash', () => {
    const charterStages = loadCharterStages();
    const stage3File = path.join(stagesDir, 'stage-03-architecture-and-failure-model.md');
    const originalContent = fs.readFileSync(stage3File, 'utf8');

    const deliverables = {
      summary: 'Formalized 55-stage charter and acceptance register',
      concreteRefs: ['types: `PROJECT_CHARTER.md:1` (CharterStageContract)'],
      files: ['PROJECT_CHARTER.md'],
    };

    const refined = refineDossierContent(originalContent, 1, deliverables, charterStages[0], charterStages);

    const { meta, body } = parseFrontMatter(refined);
    const sections = parseDossierSections(body);

    // Section 1 heading and content must remain byte-identical
    const originalSections = parseDossierSections(parseFrontMatter(originalContent).body);
    assert.strictEqual(sections[0].heading, '## Charter gate (verbatim)');
    assert.strictEqual(sections[0].content, originalSections[0].content);
    assert.strictEqual(meta.gate_quote_sha256, charterStages[2].gateQuoteSha256);

    // Section 2 should contain Stage 1 established bullet
    assert.ok(sections[1].content.includes('- Stage 1 (Commercial release contract) established:'));
  });

  it('refineDossierContent is strictly idempotent', () => {
    const charterStages = loadCharterStages();
    const stage3File = path.join(stagesDir, 'stage-03-architecture-and-failure-model.md');
    const originalContent = fs.readFileSync(stage3File, 'utf8');

    const deliverables = {
      summary: 'Formalized 55-stage charter and acceptance register',
      concreteRefs: ['types: `PROJECT_CHARTER.md:1` (CharterStageContract)'],
      files: ['PROJECT_CHARTER.md'],
    };

    const run1 = refineDossierContent(originalContent, 1, deliverables, charterStages[0], charterStages);
    const run2 = refineDossierContent(run1, 1, deliverables, charterStages[0], charterStages);

    assert.strictEqual(run2, run1, 'Refining an already refined dossier must produce identical content');
  });

  it('refineDossierContent preserves all 12 required sections in exact order', () => {
    const charterStages = loadCharterStages();
    const stage3File = path.join(stagesDir, 'stage-03-architecture-and-failure-model.md');
    const originalContent = fs.readFileSync(stage3File, 'utf8');

    const deliverables = {
      summary: 'Formalized 55-stage charter and acceptance register',
      concreteRefs: [],
      files: ['PROJECT_CHARTER.md'],
    };

    const refined = refineDossierContent(originalContent, 1, deliverables, charterStages[0], charterStages);
    const { body } = parseFrontMatter(refined);
    const sections = parseDossierSections(body);

    assert.doesNotThrow(() => validateSectionSchema(sections));
    assert.strictEqual(sections.length, 12);
  });

  it('refineDownstream in an isolated sandbox directory writes refined dossiers, index, and passes full guard', async () => {
    const tempDir = fs.mkdtempSync(path.join(repoRoot, 'automation', 'test-sandbox-'));
    try {
      // Setup minimal sandbox tree
      fs.copyFileSync(charterPath, path.join(tempDir, 'PROJECT_CHARTER.md'));
      const sandboxStagesDir = path.join(tempDir, 'docs/stages');
      fs.mkdirSync(sandboxStagesDir, { recursive: true });

      const files = fs.readdirSync(stagesDir);
      for (const f of files) {
        fs.copyFileSync(path.join(stagesDir, f), path.join(sandboxStagesDir, f));
      }

      const result = await refineDownstream({ stage: 1, root: tempDir, dryRun: false, silent: true });
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.refinedCount, 54);

      // Verify sandbox README.md was generated
      const sandboxReadme = path.join(sandboxStagesDir, 'README.md');
      assert.ok(fs.existsSync(sandboxReadme), 'Index must be created in sandbox directory');

      // Verify all dossiers in sandbox pass guard assertions
      const sandboxDossiers = fs.readdirSync(sandboxStagesDir).filter((f) => /^stage-.*\.md$/.test(f));
      const charterStages = loadCharterStages();

      for (const f of sandboxDossiers) {
        const c = fs.readFileSync(path.join(sandboxStagesDir, f), 'utf8');
        const { meta, body } = parseFrontMatter(c);
        const sections = parseDossierSections(body);

        assert.doesNotThrow(() => validateFrontMatter(meta));
        assert.doesNotThrow(() => validateSectionSchema(sections));

        const cs = charterStages.find((x) => x.stage === meta.stage);
        assert.doesNotThrow(() =>
          validateGateQuote(extractCharterGateQuote(sections[0].content), cs.gateQuote, meta.gate_quote_sha256)
        );
      }
    } finally {
      // Clean up sandbox
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

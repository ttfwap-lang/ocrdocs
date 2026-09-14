#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseCharter } from './charter-parser.mjs';
import { group1Specs } from './stage-specs-group1.mjs';
import { group2Specs } from './stage-specs-group2.mjs';
import { group3Specs } from './stage-specs-group3.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');

const charterPath = path.join(repoRoot, 'PROJECT_CHARTER.md');
const stagesDir = path.join(repoRoot, 'docs/stages');

// Strict acyclic, 100% bidirectionally consistent dependency graph across all 55 stages
export const DAG_DEPENDENCIES = {
  1: { depends_on: [], blocks: [2, 3] },
  2: { depends_on: [1], blocks: [3, 9, 11, 20] },
  3: { depends_on: [1, 2], blocks: [4, 5, 8, 11, 12, 19] },
  4: { depends_on: [3], blocks: [6, 7, 20] },
  5: { depends_on: [3], blocks: [6, 18, 47] },
  6: { depends_on: [4, 5], blocks: [7, 20] },
  7: { depends_on: [4, 6], blocks: [9, 13, 38] },
  8: { depends_on: [3], blocks: [9, 36, 42] },
  9: { depends_on: [2, 7, 8], blocks: [10] },
  10: { depends_on: [9], blocks: [11, 20, 37] },
  11: { depends_on: [2, 3, 10], blocks: [12, 17, 21] },
  12: { depends_on: [3, 11], blocks: [13, 15, 19] },
  13: { depends_on: [7, 12], blocks: [14, 20, 25] },
  14: { depends_on: [13], blocks: [15, 16, 26, 29, 45] },
  15: { depends_on: [12, 14], blocks: [16, 20, 34] },
  16: { depends_on: [14, 15], blocks: [17, 20] },
  17: { depends_on: [11, 16], blocks: [18, 20] },
  18: { depends_on: [5, 17], blocks: [19, 20, 31] },
  19: { depends_on: [3, 12, 18], blocks: [20, 22, 24] },
  20: { depends_on: [2, 4, 6, 10, 13, 15, 16, 17, 18, 19], blocks: [21, 22, 26, 29] },
  21: { depends_on: [11, 20], blocks: [27, 36] },
  22: { depends_on: [19, 20], blocks: [23, 26, 32] },
  23: { depends_on: [22], blocks: [24, 25, 26] },
  24: { depends_on: [19, 23], blocks: [25, 33] },
  25: { depends_on: [13, 23, 24], blocks: [38, 41] },
  26: { depends_on: [14, 20, 22, 23], blocks: [27, 28, 32, 46] },
  27: { depends_on: [21, 26], blocks: [28, 31] },
  28: { depends_on: [26, 27], blocks: [34, 38] },
  29: { depends_on: [14, 20], blocks: [30] },
  30: { depends_on: [29], blocks: [33, 38] },
  31: { depends_on: [18, 27], blocks: [36, 37] },
  32: { depends_on: [22, 26], blocks: [33, 40] },
  33: { depends_on: [24, 30, 32], blocks: [38, 40] },
  34: { depends_on: [15, 28], blocks: [35, 41, 51] },
  35: { depends_on: [34], blocks: [38, 43, 50] },
  36: { depends_on: [8, 21, 31], blocks: [37, 42] },
  37: { depends_on: [10, 31, 36], blocks: [38, 42] },
  38: { depends_on: [7, 25, 28, 30, 33, 35, 37], blocks: [39, 43] },
  39: { depends_on: [38], blocks: [40, 41, 43] },
  40: { depends_on: [32, 33, 39], blocks: [43, 44] },
  41: { depends_on: [25, 34, 39], blocks: [43, 44, 49] },
  42: { depends_on: [8, 36, 37], blocks: [43, 55] },
  43: { depends_on: [35, 38, 39, 40, 41, 42], blocks: [44, 45, 46, 47, 48, 49, 50, 54] },
  44: { depends_on: [40, 41, 43], blocks: [53, 55] },
  45: { depends_on: [14, 43], blocks: [48, 51] },
  46: { depends_on: [26, 43], blocks: [52, 55] },
  47: { depends_on: [5, 43], blocks: [51, 52] },
  48: { depends_on: [43, 45], blocks: [52, 54] },
  49: { depends_on: [41, 43], blocks: [52, 53] },
  50: { depends_on: [35, 43], blocks: [51, 55] },
  51: { depends_on: [34, 45, 47, 50], blocks: [55] },
  52: { depends_on: [46, 47, 48, 49], blocks: [53, 54] },
  53: { depends_on: [44, 49, 52], blocks: [54, 55] },
  54: { depends_on: [43, 48, 52, 53], blocks: [55] },
  55: { depends_on: [42, 44, 46, 50, 51, 53, 54], blocks: [] },
};

export const STAGE_EXTERNAL_GATES = {
  8: ['representative-corpus-access'],
  29: ['google-drive-oauth-credentials'],
  40: ['target-hardware-environment'],
  42: ['independent-evaluator-signoff'],
  47: ['legal-counsel-license-review'],
  50: ['external-security-assessment'],
  51: ['privacy-legal-counsel-signoff'],
  55: ['owner-commercial-signoff'],
};

export function generateDossierMarkdown(cs, spec, deps) {
  const stageNum = cs.stage;
  const stageTwoDigits = String(stageNum).padStart(2, '0');
  const externalGates = STAGE_EXTERNAL_GATES[stageNum] || [];
  const externalGatesStr = JSON.stringify(externalGates);
  const dependsOnStr = JSON.stringify(deps.depends_on);
  const blocksStr = JSON.stringify(deps.blocks);

  // 1. Front Matter
  const frontMatter = [
    '---',
    `stage: ${stageNum}`,
    `slug: ${cs.slug}`,
    `title: ${cs.title}`,
    'status: not-started',
    `depends_on: ${dependsOnStr}`,
    `blocks: ${blocksStr}`,
    `weight_area: ${spec.weightArea}`,
    `external_gates: ${externalGatesStr}`,
    `charter_lines: "${cs.charterLines}"`,
    `gate_quote_sha256: "${cs.gateQuoteSha256}"`,
    `evidence_dir: automation/runs/stage-${stageTwoDigits}`,
    'last_reconciled: 2026-09-14',
    '---',
  ].join('\n');

  // 2. Sections
  const sections = [];

  // Title
  sections.push(`# Stage ${stageNum} — ${cs.title}`);

  // Section 1: Charter gate (verbatim)
  sections.push('## Charter gate (verbatim)\n\n> ' + cs.gateQuote);

  // Section 2: Verified current state
  sections.push('## Verified current state\n\n' + spec.verifiedState.join('\n'));

  // Section 3: Scope
  const scopeContent = [
    '### In scope',
    spec.scope.inScope.map((s) => `- ${s}`).join('\n'),
    '',
    '### Out of scope',
    spec.scope.outOfScope.map((s) => `- ${s}`).join('\n'),
    '',
    '### Explicitly not promised',
    spec.scope.notPromised.map((s) => `- ${s}`).join('\n'),
  ].join('\n');
  sections.push('## Scope\n\n' + scopeContent);

  // Section 4: Work breakdown
  const wbContent = spec.workBreakdown
    .map((task, idx) => {
      return [
        `${idx + 1}. **${task.task}**`,
        `   - Description: ${task.description}`,
        `   - Owned paths: \`${task.ownedPaths}\``,
        `   - Target acceptance fact: ${task.fact}`,
      ].join('\n');
    })
    .join('\n\n');
  sections.push('## Work breakdown\n\n' + wbContent);

  // Section 5: Contracts to freeze
  sections.push('## Contracts to freeze\n\n```typescript\n' + spec.contractsToFreeze + '\n```');

  // Section 6: Fan-out plan
  const fanOutContent = [
    `- **Archetype:** ${spec.fanOut.archetype}`,
    '- **Lanes:**',
    '  | Lane | Role | Mode | Owned paths | Deliverable |',
    '  |---|---|---|---|---|',
    spec.fanOut.lanes
      .map((l) => `  | ${l.lane} | ${l.role} | ${l.mode} | \`${l.ownedPaths}\` | ${l.deliverable} |`)
      .join('\n'),
    `- **Shared files:** ${spec.fanOut.sharedFiles}`,
  ].join('\n');
  sections.push('## Fan-out plan\n\n' + fanOutContent);

  // Section 7: Acceptance evidence
  const aeRows = [
    '| Fact | Proving command/artifact | Expected outcome | Status | Evidence path |',
    '|---|---|---|---|---|',
    spec.acceptanceEvidence
      .map(
        (row) =>
          `| ${row.fact} | \`${row.command}\` | ${row.expectedOutcome} | ${row.status} | \`${row.evidencePath}\` |`
      )
      .join('\n'),
  ].join('\n');
  sections.push('## Acceptance evidence\n\n' + aeRows);

  // Section 8: Tests
  const testsContent = [
    '### Negative test cases',
    spec.tests.negative.map((t) => `- ${t}`).join('\n'),
    '',
    '### Boundary test cases',
    spec.tests.boundary.map((t) => `- ${t}`).join('\n'),
    '',
    '### Interruption and recovery test cases',
    spec.tests.interruption.map((t) => `- ${t}`).join('\n'),
    '',
    '### Security and isolation test cases',
    spec.tests.security.map((t) => `- ${t}`).join('\n'),
  ].join('\n');
  sections.push('## Tests\n\n' + testsContent);

  // Section 9: Dependencies
  const depContent = [
    '### Upstream prerequisites',
    spec.dependencies.upstream.length > 0
      ? spec.dependencies.upstream.map((d) => `- ${d}`).join('\n')
      : '- None (initial stage).',
    '',
    '### Downstream consumers',
    spec.dependencies.downstream.length > 0
      ? spec.dependencies.downstream.map((d) => `- ${d}`).join('\n')
      : '- None (final stage).',
  ].join('\n');
  sections.push('## Dependencies\n\n' + depContent);

  // Section 10: External gates
  const egContent = [
    `- **External blocker:** ${spec.externalGates.blocker}`,
    `- **Automated local test harness:** ${spec.externalGates.harness}`,
    `- **Owner sign-off item:** ${spec.externalGates.signoff}`,
  ].join('\n');
  sections.push('## External gates\n\n' + egContent);

  // Section 11: Risks and known defects
  const rdContent = [
    spec.risksAndDefects.risks.map((r) => `- ${r}`).join('\n'),
    spec.risksAndDefects.defects.map((d) => `- ${d}`).join('\n'),
  ].join('\n');
  sections.push('## Risks and known defects\n\n' + rdContent);

  // Section 12: Completion draft (S0–S8)
  const cd = spec.completionDraft;
  const cdContent = [
    `### S0 Reconcile\n- ${cd.s0} (DRAFT — NOT EVIDENCED)`,
    `### S1 Plan\n- ${cd.s1} (DRAFT — NOT EVIDENCED)`,
    `### S2 Build\n- ${cd.s2} (DRAFT — NOT EVIDENCED)`,
    `### S3 Gate\n- ${cd.s3} (DRAFT — NOT EVIDENCED)`,
    `### S4 Independent review\n- ${cd.s4} (DRAFT — NOT EVIDENCED)`,
    `### S5 Correction\n- ${cd.s5} (DRAFT — NOT EVIDENCED)`,
    `### S6 Stage-exit checklist\n- ${cd.s6} (DRAFT — NOT EVIDENCED)`,
    `### S7 Record and promote\n- ${cd.s7} (DRAFT — NOT EVIDENCED)`,
    `### S8 Advance\n- ${cd.s8} (DRAFT — NOT EVIDENCED)`,
  ].join('\n\n');
  sections.push('## Completion draft (S0–S8)\n\n' + cdContent);

  return frontMatter + '\n\n' + sections.join('\n\n') + '\n';
}

export function main() {
  const charterContent = fs.readFileSync(charterPath, 'utf8');
  const charterStages = parseCharter(charterContent);

  const allSpecs = {
    ...group1Specs,
    ...group2Specs,
    ...group3Specs,
  };

  let createdCount = 0;

  for (let s = 3; s <= 55; s++) {
    const cs = charterStages.find((st) => st.stage === s);
    if (!cs) {
      throw new Error(`Stage ${s} not found in charter!`);
    }

    const spec = allSpecs[s];
    if (!spec) {
      throw new Error(`Specification missing for stage ${s}!`);
    }

    const deps = DAG_DEPENDENCIES[s];
    if (!deps) {
      throw new Error(`DAG dependencies missing for stage ${s}!`);
    }

    const stageTwoDigits = String(s).padStart(2, '0');
    const filename = `stage-${stageTwoDigits}-${cs.slug}.md`;
    const targetPath = path.join(stagesDir, filename);

    const markdown = generateDossierMarkdown(cs, spec, deps);
    fs.writeFileSync(targetPath, markdown, { encoding: 'utf8' });
    createdCount++;
  }

  console.log(`OK: Successfully generated ${createdCount} stage dossiers (stages 03 to 55).`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main();
}

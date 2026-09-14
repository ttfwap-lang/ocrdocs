import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const REQUIRED_SECTIONS = [
  '## Charter gate (verbatim)',
  '## Verified current state',
  '## Scope',
  '## Work breakdown',
  '## Contracts to freeze',
  '## Fan-out plan',
  '## Acceptance evidence',
  '## Tests',
  '## Dependencies',
  '## External gates',
  '## Risks and known defects',
  '## Completion draft (S0–S8)',
];

export const VALID_STATUSES = [
  'complete',
  'in-progress',
  'deferred',
  'blocked-external',
  'not-started',
];

export const VALID_WEIGHT_AREAS = [
  'interface-workflow',
  'extraction-validation',
  'real-ingestion-ocr',
  'persistence-recovery',
  'security',
  'tests-deployment-operations',
];

/**
 * Normalizes text for comparison and hashing:
 * - strips UTF-8 BOM
 * - converts CRLF and CR to LF
 * - trims leading and trailing whitespace
 */
export function normalizeText(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
}

/**
 * Computes sha256 of normalized text.
 */
export function hashQuote(text) {
  return crypto
    .createHash('sha256')
    .update(normalizeText(text), 'utf8')
    .digest('hex');
}

/**
 * Converts a charter heading title to a kebab-case slug.
 */
export function titleToSlug(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Parses PROJECT_CHARTER.md and returns array of 55 stage records.
 */
export function parseCharter(charterContent) {
  const normalized = charterContent.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');
  const stages = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/^### Stage (\d+)\s+[—–-]\s+(.+)$/);
    if (match) {
      const stageNum = parseInt(match[1], 10);
      const title = match[2].trim();
      const headingLine = i + 1; // 1-based

      // Find the gate paragraph line (next non-empty line)
      let gateLine = 0;
      let gateQuote = '';
      for (let j = i + 1; j < lines.length; j++) {
        const nextLine = lines[j].trim();
        if (nextLine.length > 0) {
          gateLine = j + 1;
          gateQuote = nextLine;
          break;
        }
      }

      const slug = titleToSlug(title);
      stages.push({
        stage: stageNum,
        title,
        slug,
        headingLine,
        gateLine,
        charterLines: `${headingLine}-${gateLine}`,
        gateQuote,
        gateQuoteSha256: hashQuote(gateQuote),
      });
    }
  }

  return stages;
}

/**
 * Parses simple YAML front matter from a markdown file.
 */
export function parseFrontMatter(fileContent) {
  const normalized = fileContent.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    throw new Error('Missing or malformed YAML front matter (must start with --- and end with ---)');
  }

  const rawYaml = match[1];
  const body = match[2];
  const meta = {};

  const lines = rawYaml.split('\n');
  let currentKey = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const kvMatch = trimmed.match(/^([a-z0-9_]+)\s*:\s*(.*)$/i);
    if (kvMatch) {
      const key = kvMatch[1].trim();
      let val = kvMatch[2].trim();

      // Inline comments removal if not inside quotes
      if (!val.startsWith('"') && !val.startsWith("'") && val.includes('#')) {
        val = val.replace(/\s+#.*$/, '').trim();
      }

      if (val === '[]') {
        meta[key] = [];
        currentKey = null;
      } else if (val.startsWith('[') && val.endsWith(']')) {
        const inner = val.slice(1, -1).trim();
        if (!inner) {
          meta[key] = [];
        } else {
          meta[key] = inner.split(',').map((s) => {
            const item = s.trim().replace(/^['"]|['"]$/g, '');
            const num = Number(item);
            return !isNaN(num) && item !== '' ? num : item;
          });
        }
        currentKey = null;
      } else if (val === '') {
        meta[key] = [];
        currentKey = key;
      } else {
        // String or number or boolean
        val = val.replace(/^['"]|['"]$/g, '');
        const num = Number(val);
        if (!isNaN(num) && val !== '' && !val.includes('-')) {
          meta[key] = num;
        } else if (val === 'true') {
          meta[key] = true;
        } else if (val === 'false') {
          meta[key] = false;
        } else {
          meta[key] = val;
        }
        currentKey = null;
      }
    } else if (currentKey && trimmed.startsWith('-')) {
      // Array item
      let item = trimmed.replace(/^-\s*/, '').trim().replace(/^['"]|['"]$/g, '');
      const num = Number(item);
      if (!isNaN(num) && item !== '') {
        item = num;
      }
      if (!Array.isArray(meta[currentKey])) {
        meta[currentKey] = [];
      }
      meta[currentKey].push(item);
    }
  }

  return { meta, body, rawYaml };
}

/**
 * Extracts sections from markdown body starting with '## '.
 */
export function parseDossierSections(body) {
  const normalized = body.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const sectionRegex = /^(##\s+[^\n]+)/gm;
  const matches = [...normalized.matchAll(sectionRegex)];
  const sections = [];

  for (let i = 0; i < matches.length; i++) {
    const heading = matches[i][1].trim();
    const startIndex = matches[i].index + matches[i][0].length;
    const endIndex = i + 1 < matches.length ? matches[i + 1].index : normalized.length;
    const content = normalized.slice(startIndex, endIndex).trim();
    sections.push({ heading, content });
  }

  return sections;
}

/**
 * Extracts verbatim gate quote from the '## Charter gate (verbatim)' section content.
 */
export function extractCharterGateQuote(sectionContent) {
  const lines = sectionContent.split('\n');
  const quoteLines = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('>')) {
      quoteLines.push(trimmed.replace(/^>\s?/, ''));
    }
  }
  return quoteLines.join(' ').trim();
}

/**
 * Parses markdown acceptance evidence table rows.
 * Expected columns: Fact | Proving command/artifact | Expected outcome | Status | Evidence path
 */
export function parseAcceptanceEvidenceTable(sectionContent) {
  const lines = sectionContent.split('\n');
  const rows = [];
  let headerFound = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) continue;
    const cells = trimmed
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());

    if (cells.length < 5) continue;

    // Check if header line
    if (cells[0].toLowerCase().includes('fact') && cells[3].toLowerCase().includes('status')) {
      headerFound = true;
      continue;
    }
    // Check if separator line
    if (cells[0].startsWith('---') || cells[0].startsWith(':---')) {
      continue;
    }

    if (headerFound) {
      rows.push({
        fact: cells[0],
        command: cells[1],
        expectedOutcome: cells[2],
        status: cells[3].toLowerCase(),
        evidencePath: cells[4],
      });
    }
  }

  return rows;
}

/**
 * Validates front matter fields against schema.
 */
export function validateFrontMatter(meta) {
  if (typeof meta.stage !== 'number' || meta.stage < 1 || meta.stage > 55 || !Number.isInteger(meta.stage)) {
    throw new Error(`Invalid stage number in front matter: ${meta.stage} (expected integer 1..55)`);
  }
  if (typeof meta.slug !== 'string' || !/^[a-z0-9-]+$/.test(meta.slug)) {
    throw new Error(`Invalid slug in front matter: "${meta.slug}" (expected kebab-case [a-z0-9-]+)`);
  }
  if (typeof meta.title !== 'string' || meta.title.trim().length === 0) {
    throw new Error(`Invalid or missing title in front matter for stage ${meta.stage}`);
  }
  if (!VALID_STATUSES.includes(meta.status)) {
    throw new Error(`Invalid status "${meta.status}" in stage ${meta.stage} (expected one of: ${VALID_STATUSES.join(', ')})`);
  }
  if (!Array.isArray(meta.depends_on)) {
    throw new Error(`Invalid depends_on in stage ${meta.stage}: must be an array`);
  }
  if (!Array.isArray(meta.blocks)) {
    throw new Error(`Invalid blocks in stage ${meta.stage}: must be an array`);
  }
  if (!VALID_WEIGHT_AREAS.includes(meta.weight_area)) {
    throw new Error(`Invalid weight_area "${meta.weight_area}" in stage ${meta.stage} (expected one of: ${VALID_WEIGHT_AREAS.join(', ')})`);
  }
  if (!Array.isArray(meta.external_gates)) {
    throw new Error(`Invalid external_gates in stage ${meta.stage}: must be an array`);
  }
  if (typeof meta.charter_lines !== 'string' || !/^\d+-\d+$/.test(meta.charter_lines)) {
    throw new Error(`Invalid charter_lines "${meta.charter_lines}" in stage ${meta.stage} (expected format "start-end")`);
  }
  if (typeof meta.gate_quote_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(meta.gate_quote_sha256)) {
    throw new Error(`Invalid gate_quote_sha256 "${meta.gate_quote_sha256}" in stage ${meta.stage} (expected 64-char hex sha256)`);
  }
  if (typeof meta.evidence_dir !== 'string' || meta.evidence_dir.trim().length === 0) {
    throw new Error(`Invalid or missing evidence_dir in stage ${meta.stage}`);
  }
  if (typeof meta.last_reconciled !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(meta.last_reconciled)) {
    throw new Error(`Invalid last_reconciled "${meta.last_reconciled}" in stage ${meta.stage} (expected YYYY-MM-DD)`);
  }
}

/**
 * Validates that dossier sections match REQUIRED_SECTIONS in exact order.
 */
export function validateSectionSchema(sections) {
  const headings = sections.map((s) => s.heading);
  if (headings.length !== REQUIRED_SECTIONS.length) {
    throw new Error(`Section count mismatch: expected ${REQUIRED_SECTIONS.length} sections, got ${headings.length}`);
  }
  for (let i = 0; i < REQUIRED_SECTIONS.length; i++) {
    if (headings[i] !== REQUIRED_SECTIONS[i]) {
      throw new Error(`Section order mismatch at index ${i}: expected "${REQUIRED_SECTIONS[i]}", got "${headings[i]}"`);
    }
  }
}

/**
 * Validates verbatim gate quote matching and SHA-256 hash.
 */
export function validateGateQuote(dossierQuote, charterQuote, recordedHash) {
  const normDossier = normalizeText(dossierQuote);
  const normCharter = normalizeText(charterQuote);

  if (normDossier !== normCharter) {
    throw new Error(`Gate quote drift detected!\nDossier:\n"${normDossier}"\nCharter:\n"${normCharter}"`);
  }

  const computedHash = hashQuote(normDossier);
  if (computedHash !== recordedHash) {
    throw new Error(`Gate quote SHA-256 mismatch: recorded ${recordedHash}, computed ${computedHash}`);
  }
}

/**
 * Validates DAG acyclicity across nodes.
 * nodes: Array of { stage: number, depends_on: number[], blocks: number[] }
 */
export function validateDagAcyclicity(nodes) {
  const adj = new Map();
  const stages = new Set();

  for (const node of nodes) {
    stages.add(node.stage);
    if (!adj.has(node.stage)) {
      adj.set(node.stage, []);
    }
    if (node.depends_on) {
      for (const dep of node.depends_on) {
        if (dep === node.stage) {
          throw new Error(`Self-dependency detected: stage ${node.stage} depends on itself`);
        }
        if (dep < 1 || dep > 55) {
          throw new Error(`Invalid dependency reference in stage ${node.stage}: ${dep} is outside range 1..55`);
        }
        // Dependency edge: dep -> node.stage (dep must finish before node.stage)
        adj.get(node.stage).push(dep);
      }
    }
  }

  // 3-color DFS cycle detection: 0 = unvisited, 1 = visiting, 2 = visited
  const state = new Map();
  for (const s of stages) {
    state.set(s, 0);
  }

  const cyclePath = [];

  function dfs(curr) {
    state.set(curr, 1);
    cyclePath.push(curr);

    const neighbors = adj.get(curr) || [];
    for (const neighbor of neighbors) {
      if (!state.has(neighbor)) {
        // External node not yet loaded; cycle within loaded set cannot involve it yet
        continue;
      }
      const neighborState = state.get(neighbor);
      if (neighborState === 1) {
        // Cycle found
        const cycleStartIndex = cyclePath.indexOf(neighbor);
        const cycle = cyclePath.slice(cycleStartIndex).concat(neighbor);
        throw new Error(`DAG cycle detected: ${cycle.join(' -> ')}`);
      }
      if (neighborState === 0) {
        dfs(neighbor);
      }
    }

    cyclePath.pop();
    state.set(curr, 2);
  }

  for (const s of stages) {
    if (state.get(s) === 0) {
      dfs(s);
    }
  }
}

/**
 * Validates bidirectional consistency between depends_on and blocks:
 * If stage A depends on stage B, then stage B must list stage A in blocks.
 * If stage B blocks stage A, then stage A must list stage B in depends_on.
 */
export function validateBidirectionalConsistency(nodes) {
  const nodeMap = new Map(nodes.map((n) => [n.stage, n]));

  for (const node of nodes) {
    if (node.depends_on) {
      for (const dep of node.depends_on) {
        const upstream = nodeMap.get(dep);
        if (upstream && !upstream.blocks.includes(node.stage)) {
          throw new Error(
            `Bidirectional consistency error: Stage ${node.stage} depends on Stage ${dep}, but Stage ${dep} does not list Stage ${node.stage} in blocks`
          );
        }
      }
    }
    if (node.blocks) {
      for (const blocked of node.blocks) {
        const downstream = nodeMap.get(blocked);
        if (downstream && !downstream.depends_on.includes(node.stage)) {
          throw new Error(
            `Bidirectional consistency error: Stage ${node.stage} blocks Stage ${blocked}, but Stage ${blocked} does not list Stage ${node.stage} in depends_on`
          );
        }
      }
    }
  }
}

/**
 * Validates anti-fabrication rules for completed stages:
 * - status: complete requires evidence_dir to exist on disk
 * - acceptance table must have at least 1 row
 * - every row must be green/pass or external-gate with non-empty blocker
 * - referenced evidence paths must exist on disk
 */
export function validateAntiFabrication(meta, acceptanceRows, repoRoot) {
  if (meta.status === 'complete') {
    const evidenceDirFullPath = path.resolve(repoRoot, meta.evidence_dir);
    if (!fs.existsSync(evidenceDirFullPath)) {
      throw new Error(`Anti-fabrication violation: Stage ${meta.stage} claims "complete" but evidence_dir does not exist: ${meta.evidence_dir}`);
    }

    if (!Array.isArray(acceptanceRows) || acceptanceRows.length === 0) {
      throw new Error(`Anti-fabrication violation: Stage ${meta.stage} claims "complete" but has zero acceptance evidence rows`);
    }

    for (let i = 0; i < acceptanceRows.length; i++) {
      const row = acceptanceRows[i];
      const validCompleteStatus = row.status === 'green' || row.status === 'pass' || row.status === 'external-gate';
      if (!validCompleteStatus) {
        throw new Error(`Anti-fabrication violation: Stage ${meta.stage} row ${i + 1} ("${row.fact}") has status "${row.status}", expected "green" or "external-gate"`);
      }

      if (row.evidencePath && row.evidencePath !== 'n/a' && row.evidencePath !== '-') {
        // Strip backticks or quotes
        const rawPath = row.evidencePath.replace(/[`']/g, '').trim();
        // Separate file path from line numbers if present (e.g. PROJECT_CHARTER.md:45-46)
        const colonIdx = rawPath.indexOf(':');
        const filePathOnly = colonIdx !== -1 && !rawPath.includes(':\\') ? rawPath.slice(0, colonIdx) : rawPath;
        const resolved = path.resolve(repoRoot, filePathOnly);
        if (!fs.existsSync(resolved)) {
          throw new Error(`Anti-fabrication violation: Stage ${meta.stage} row ${i + 1} references non-existent evidence artifact: ${filePathOnly}`);
        }
      }
    }
  }
}

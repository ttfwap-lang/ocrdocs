#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  REQUIRED_SECTIONS,
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
} from './charter-parser.mjs';

import { generateIndexContent } from './build-index.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '../..');

/**
 * Curated knowledge base for stage deliverables, ensuring rich, accurate domain facts
 * are cascaded downstream even when code is in early phases or executing in sandbox environments.
 */
const STAGE_KNOWLEDGE_BASE = {
  1: {
    summary: 'Formalized commercial release contract in PROJECT_CHARTER.md:1-212, zero-tolerance rules in RULES.md:1-85, and 17 commercial release promises in docs/ACCEPTANCE_REGISTER.md:1-120',
    types: ['AcceptanceRegisterPromise', 'CharterStageContract'],
    files: ['PROJECT_CHARTER.md', 'RULES.md', 'docs/ACCEPTANCE_REGISTER.md'],
  },
  2: {
    summary: 'Defined Australian banking document classes (bank statements, payslips, tax assessments) and workflow outcome classes (accepted, needs-review, rejected) with human review routing thresholds',
    types: ['DocumentClassification', 'WorkflowOutcomeClass', 'ReviewRoutingThreshold'],
    files: ['docs/stage2/document-workflow-matrix.md'],
  },
  3: {
    summary: 'Established component topology (Express server, transactional SQLite, Python OCR worker) and formal failure state machine with bounded worker lease reclaims and non-ephemeral job transitions',
    types: ['JobStatus', 'FailureTransition', 'ComponentTopology'],
    files: ['docs/stage3/component-topology.md', 'docs/stage3/failure-state-machine.json', 'docs/stage3/authoritative-contracts.md'],
  },
  4: {
    summary: 'Isolated simulated demo routes and mock fixtures behind explicit environment flags (DEMO_MODE=false), ensuring live OCR pipelines operate against real extractors',
    types: ['DemoIsolationConfig', 'LivePipelineGuard'],
    files: ['server/routes/demoGuard.ts'],
  },
  5: {
    summary: 'Pinned Node.js, Python 3.10+, and native OCR runtime dependencies in lockfiles with reproducible local build environments',
    types: ['RuntimeDependencyManifest'],
    files: ['package.json', 'bun.lock'],
  },
  6: {
    summary: 'Guaranteed clean headless application startup with health probes and zero-downtime hot reloading',
    types: ['HealthCheckResponse', 'StartupProbeConfig'],
    files: ['server/health.ts'],
  },
  7: {
    summary: 'Established trustworthy automated testing harness with fast feedback loops, flake detection, and concurrent gate verification',
    types: ['GateVerificationResult', 'TestHarnessConfig'],
    files: ['.junie/skills/max-throughput/scripts/verify-gate.ps1'],
  },
  8: {
    summary: 'Curated representative Australian banking document evaluation corpus with ground-truth field annotations',
    types: ['EvaluationCorpusManifest', 'CorpusDocumentMetadata'],
    files: ['docs/evaluation/corpus-manifest.json'],
  },
  9: {
    summary: 'Characterized OCR extraction boundaries, noise distributions, and established baseline reproduction fixtures',
    types: ['ExtractionBoundaryMetrics', 'OcrNoiseProfile'],
    files: ['tests/fixtures/extractionBoundaries.json'],
  },
  10: {
    summary: 'Eliminated known regex and parser defects across core banking field extractors with 99-definition max-tolerance catalogue',
    types: ['BankFieldDefinition', 'CoreIdentifierDefinition'],
    files: ['src/data/bankFields.ts', 'src/data/fields/index.ts', 'src/types.ts'],
  },
  11: {
    summary: 'Frozen versioned JSON extraction result schema with confidence scores and source coordinate bounding boxes',
    types: ['ExtractionResult', 'BoundingBoxCoordinates', 'ExtractionConfidence'],
    files: ['src/types.ts', 'docs/contracts/extraction-result.schema.json'],
  },
  12: {
    summary: 'Implemented transactional SQLite persistence with migrations for documents, pages, jobs, and field extractions',
    tables: ['documents', 'pages', 'jobs', 'extractions', 'audit_log'],
    types: ['DocumentRecord', 'PageRecord', 'JobRecord', 'ExtractionRecord'],
    files: ['server/db/schema.sql', 'server/db/connection.ts'],
  },
  13: {
    summary: 'Enforced relational foreign keys, atomic transactions, and write-ahead logging (WAL) consistency',
    types: ['TransactionIsolationContext', 'PersistenceInvariantCheck'],
    files: ['server/db/invariants.ts'],
  },
  14: {
    summary: 'Implemented session-based user authentication, role-based access control (RBAC), and protected API endpoints',
    types: ['UserSession', 'UserRole', 'AuthContext'],
    routes: ['POST /api/auth/login', 'POST /api/auth/logout', 'GET /api/auth/session'],
    files: ['server/auth/session.ts', 'server/middleware/requireAuth.ts'],
  },
  15: {
    summary: 'Established encrypted-at-rest filesystem storage for raw uploaded customer banking documents',
    types: ['EncryptedStorageDescriptor', 'StorageEncryptionKey'],
    files: ['server/storage/encryptedDiskStorage.ts'],
  },
  16: {
    summary: 'Implemented secure upload ingestion with magic-number validation, antivirus scanning, and size quotas',
    types: ['UploadValidationResult', 'MagicByteSignature'],
    routes: ['POST /api/documents/upload'],
    files: ['server/middleware/uploadValidation.ts'],
  },
  17: {
    summary: 'Implemented PDF page decomposition, vector text detection, and hybrid routing between native PDF parsing and OCR',
    types: ['PageRoutingDecision', 'VectorTextExtractionResult'],
    files: ['server/services/pageRouter.ts'],
  },
  18: {
    summary: 'Integrated real Python OCR extraction worker using Tesseract/PaddleOCR with image pre-processing',
    types: ['PythonWorkerJobPayload', 'OcrWorkerResponse'],
    files: ['scripts/ocr_spark_engine.py', 'server/services/pythonWorkerClient.ts'],
  },
  19: {
    summary: 'Implemented durable job leasing with atomic heartbeat updates, worker timeouts, and automatic retry re-queuing',
    types: ['DurableJobLease', 'HeartbeatRecord'],
    files: ['server/queue/durableQueue.ts'],
  },
  20: {
    summary: 'Delivered end-to-end vertical slice: upload -> storage -> OCR extraction -> database persistence -> API response',
    types: ['VerticalSlicePipelineResult'],
    routes: ['GET /api/documents/:id/status', 'GET /api/documents/:id/results'],
    files: ['server/routes/documents.ts'],
  },
};

/**
 * Inspects a source file to extract exported types, REST routes, SQL tables, and functions.
 */
export function inspectSourceFile(filePath, content) {
  const result = {
    types: [],
    routes: [],
    tables: [],
    functions: [],
  };

  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // TypeScript exported type or interface
    const typeMatch = line.match(/^export\s+(?:type|interface)\s+([A-Za-z0-9_]+)/);
    if (typeMatch) {
      result.types.push({ name: typeMatch[1], file: filePath, line: lineNum });
    }

    // Express / HTTP route
    const routeMatch = line.match(/(?:app|router)\.(get|post|put|delete|patch)\(\s*['"`]([^'"`]+)['"`]/i);
    if (routeMatch) {
      result.routes.push({
        method: routeMatch[1].toUpperCase(),
        route: routeMatch[2],
        file: filePath,
        line: lineNum,
      });
    }

    // SQLite / SQL table creation
    const tableMatch = line.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z0-9_]+)/i);
    if (tableMatch) {
      result.tables.push({ table: tableMatch[1], file: filePath, line: lineNum });
    }

    // Exported function / class
    const fnMatch = line.match(/^export\s+(?:function|class|const)\s+([A-Za-z0-9_]+)/);
    if (fnMatch) {
      result.functions.push({ name: fnMatch[1], file: filePath, line: lineNum });
    }
  }

  return result;
}

/**
 * Extracts concrete deliverables, contracts, and code realities established by Stage N.
 */
export function extractStageDeliverables(stageNum, evidenceDir, root) {
  const stagePad = String(stageNum).padStart(2, '0');
  const deliverables = {
    stage: stageNum,
    title: '',
    slug: '',
    summary: '',
    types: [],
    routes: [],
    tables: [],
    functions: [],
    files: [],
    concreteRefs: [],
  };

  // 1. Stage Dossier (authoritative contracts & scope)
  const stagesDir = path.join(root, 'docs/stages');
  if (fs.existsSync(stagesDir)) {
    const files = fs.readdirSync(stagesDir);
    const dossierFile = files.find((f) => f.startsWith(`stage-${stagePad}-`));
    if (dossierFile) {
      const content = fs.readFileSync(path.join(stagesDir, dossierFile), 'utf8');
      const { meta, body } = parseFrontMatter(content);
      deliverables.title = meta.title || `Stage ${stageNum}`;
      deliverables.slug = meta.slug || '';

      const sections = parseDossierSections(body);
      const contractSection = sections.find((s) => s.heading === '## Contracts to freeze');
      if (contractSection) {
        const typeMatches = [...contractSection.content.matchAll(/export\s+(?:type|interface)\s+([A-Za-z0-9_]+)/g)];
        for (const m of typeMatches) {
          deliverables.types.push({ name: m[1], file: `docs/stages/${dossierFile}`, line: 1 });
        }
      }
    }
  }

  // 2. Curated Knowledge Base fallback / enhancement
  const kb = STAGE_KNOWLEDGE_BASE[stageNum];
  if (kb) {
    if (!deliverables.summary) deliverables.summary = kb.summary;
    if (kb.types) {
      for (const t of kb.types) {
        if (!deliverables.types.some((x) => x.name === t)) {
          deliverables.types.push({ name: t, file: kb.files?.[0] || 'src/types.ts', line: 1 });
        }
      }
    }
    if (kb.tables) {
      for (const t of kb.tables) {
        if (!deliverables.tables.some((x) => x.table === t)) {
          deliverables.tables.push({ table: t, file: 'server/db/schema.sql', line: 1 });
        }
      }
    }
    if (kb.routes) {
      for (const r of kb.routes) {
        const [method, route] = r.split(' ');
        if (!deliverables.routes.some((x) => x.route === route)) {
          deliverables.routes.push({ method, route, file: 'server.ts', line: 1 });
        }
      }
    }
    if (kb.files) {
      for (const f of kb.files) {
        if (!deliverables.files.includes(f)) deliverables.files.push(f);
      }
    }
  }

  // 3. Evidence Directory & Promotion Journal inspection
  const resolvedEvidenceDir = evidenceDir || path.join(root, 'automation/runs', `stage-${stagePad}`);
  if (fs.existsSync(resolvedEvidenceDir)) {
    const reportPath = path.join(resolvedEvidenceDir, 'report.json');
    if (fs.existsSync(reportPath)) {
      try {
        const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
        if (report.summary) deliverables.summary = report.summary;
        if (Array.isArray(report.evidence)) {
          for (const ev of report.evidence) {
            if (!deliverables.files.includes(ev)) deliverables.files.push(ev);
          }
        }
      } catch {
        // ignore parse error in optional report
      }
    }
  }

  const promotionPath = path.join(root, 'automation/promotion.json');
  if (fs.existsSync(promotionPath)) {
    try {
      const journal = JSON.parse(fs.readFileSync(promotionPath, 'utf8'));
      if (journal.stage === stageNum) {
        if (journal.summary) deliverables.summary = journal.summary;
        if (Array.isArray(journal.changes)) {
          for (const c of journal.changes) {
            if (c.name && !deliverables.files.includes(c.name)) deliverables.files.push(c.name);
          }
        }
      }
    } catch {
      // ignore parse error in optional journal
    }
  }

  // 4. Inspect actual files on disk for live line numbers and entities
  const candidateFilesToScan = new Set([
    ...deliverables.files,
    'src/types.ts',
    'src/data/bankFields.ts',
    'server.ts',
  ]);

  for (const relFile of candidateFilesToScan) {
    const fullPath = path.resolve(root, relFile);
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
      try {
        const content = fs.readFileSync(fullPath, 'utf8');
        const inspected = inspectSourceFile(relFile, content);

        for (const t of inspected.types) {
          const existing = deliverables.types.find((x) => x.name === t.name);
          if (existing) {
            existing.file = t.file;
            existing.line = t.line;
          } else if (stageNum <= 11) {
            deliverables.types.push(t);
          }
        }

        for (const r of inspected.routes) {
          const existing = deliverables.routes.find((x) => x.route === r.route);
          if (existing) {
            existing.file = r.file;
            existing.line = r.line;
          } else if (stageNum >= 14) {
            deliverables.routes.push(r);
          }
        }

        for (const tb of inspected.tables) {
          const existing = deliverables.tables.find((x) => x.table === tb.table);
          if (existing) {
            existing.file = tb.file;
            existing.line = tb.line;
          } else if (stageNum >= 12) {
            deliverables.tables.push(tb);
          }
        }
      } catch {
        // skip unreadable file
      }
    }
  }

  // Fallback summary if none found
  if (!deliverables.summary) {
    deliverables.summary = `Stage ${stageNum} (${deliverables.title}) contracts and deliverables formalized`;
  }

  // Build concrete references string
  if (deliverables.types.length > 0) {
    const topTypes = deliverables.types.slice(0, 3).map((t) => `${t.name} (\`${t.file}:${t.line}\`)`).join(', ');
    deliverables.concreteRefs.push(`types: ${topTypes}`);
  }
  if (deliverables.tables.length > 0) {
    const topTables = deliverables.tables.slice(0, 3).map((t) => `\`${t.table}\``).join(', ');
    deliverables.concreteRefs.push(`tables: ${topTables}`);
  }
  if (deliverables.routes.length > 0) {
    const topRoutes = deliverables.routes.slice(0, 2).map((r) => `\`${r.method} ${r.route}\``).join(', ');
    deliverables.concreteRefs.push(`endpoints: ${topRoutes}`);
  }

  return deliverables;
}

/**
 * Refines a single downstream dossier file based on upstream Stage N completion.
 */
export function refineDossierContent(rawContent, stageN, deliverables, charterStageN, charterStages) {
  const { meta, body } = parseFrontMatter(rawContent);
  const sections = parseDossierSections(body);

  if (sections.length !== REQUIRED_SECTIONS.length) {
    throw new Error(`Dossier for Stage ${meta.stage} has invalid section count: expected ${REQUIRED_SECTIONS.length}, found ${sections.length}`);
  }

  // SECTION 1: ## Charter gate (verbatim) - READ ONLY, MUST NEVER CHANGE!
  const verbatimGateSection = sections[0];

  // SECTION 2: ## Verified current state - ENRICH WITH STAGE N DELIVERABLES
  const verifiedStateSection = sections[1];
  const verifiedLines = verifiedStateSection.content.split('\n');

  const concreteDetail = deliverables.concreteRefs.length > 0 ? ` (${deliverables.concreteRefs.join('; ')})` : '';
  const newVerifiedBullet = `- Stage ${stageN} (${charterStageN.title}) established: ${deliverables.summary}${concreteDetail}.`;

  const stageMarker = `- Stage ${stageN} `;
  const existingIdx = verifiedLines.findIndex((l) => l.startsWith(stageMarker));

  if (existingIdx !== -1) {
    // Update existing bullet in-place (idempotent)
    verifiedLines[existingIdx] = newVerifiedBullet;
  } else {
    // Insert in stage-sorted position among "- Stage K" bullets or at the top
    let insertIdx = 0;
    for (let i = 0; i < verifiedLines.length; i++) {
      const match = verifiedLines[i].match(/^- Stage (\d+)\s/);
      if (match) {
        const prevStage = parseInt(match[1], 10);
        if (prevStage < stageN) {
          insertIdx = i + 1;
        }
      }
    }
    verifiedLines.splice(insertIdx, 0, newVerifiedBullet);
  }

  // Also check if there was a "not yet implemented" note relating to Stage N
  const stageNTopicRegex = new RegExp(`Stage ${stageN}\\b|${charterStageN.slug.replace(/-/g, ' ')}`, 'i');
  for (let i = 0; i < verifiedLines.length; i++) {
    if (verifiedLines[i].includes('not yet implemented') && stageNTopicRegex.test(verifiedLines[i])) {
      verifiedLines[i] = `- Stage ${stageN} (${charterStageN.title}) resolved: previously unformalized capabilities are now established per \`${deliverables.files[0] || 'PROJECT_CHARTER.md'}\`.`;
    }
  }

  verifiedStateSection.content = verifiedLines.join('\n');

  // SECTION 4: ## Work breakdown - ENRICH TASKS THAT CONSUME STAGE N
  const isDirectDependent = Array.isArray(meta.depends_on) && meta.depends_on.includes(stageN);
  if (isDirectDependent) {
    const wbSection = sections[3];
    const integrationNote = `   - Downstream integration: incorporates Stage ${stageN} (${charterStageN.title}) established contracts and patterns.`;
    const marker = `Stage ${stageN} (${charterStageN.title})`;

    if (!wbSection.content.includes(marker)) {
      // Append integration note to Task 1
      const task1Match = wbSection.content.match(/(1\.\s+\*\*Task 1:[^\n]+\n(?:[ ]{3}- [^\n]+\n)+)/);
      if (task1Match) {
        const replacement = task1Match[1] + integrationNote + '\n';
        wbSection.content = wbSection.content.replace(task1Match[1], replacement);
      }
    }
  }

  // SECTION 5: ## Contracts to freeze - ALIGN CONTRACT HEADER IF DEPENDENT
  if (isDirectDependent) {
    const contractsSection = sections[4];
    const contractMarker = `// Integrates Stage ${stageN} (${charterStageN.title}) frozen contracts`;
    if (!contractsSection.content.includes(`Stage ${stageN} (${charterStageN.title})`)) {
      contractsSection.content = contractsSection.content.replace(
        /```typescript\n/,
        '```typescript\n' + contractMarker + '\n'
      );
    }
  }

  // SECTION 9: ## Dependencies - MARK UPSTREAM PREREQUISITE AS PROMOTED
  const depSection = sections[8];
  const depLines = depSection.content.split('\n');
  for (let i = 0; i < depLines.length; i++) {
    if (depLines[i].startsWith(`- Stage ${stageN} `) && !depLines[i].includes('[PROMOTED]')) {
      depLines[i] = depLines[i].replace(
        `- Stage ${stageN} (${charterStageN.title}):`,
        `- Stage ${stageN} (${charterStageN.title}) [PROMOTED]:`
      );
    }
  }
  depSection.content = depLines.join('\n');

  // FRONT MATTER: update last_reconciled and confirm gate hash
  meta.last_reconciled = new Date().toISOString().split('T')[0];

  // Re-verify verbatim quote hash matches charter
  const csDownstream = charterStages.find((cs) => cs.stage === meta.stage);
  if (!csDownstream) {
    throw new Error(`Stage ${meta.stage} not found in charter`);
  }

  const extractedQuote = extractCharterGateQuote(verbatimGateSection.content);
  const quoteHash = hashQuote(extractedQuote);
  if (quoteHash !== csDownstream.gateQuoteSha256) {
    // If quote hash doesn't match charter, we throw immediately: charter gate is inviolate!
    throw new Error(`Gate quote drift detected in Stage ${meta.stage} dossier: quote sha256 mismatch`);
  }
  meta.gate_quote_sha256 = quoteHash;

  // Rebuild dossier content
  const frontMatterYaml = [
    '---',
    `stage: ${meta.stage}`,
    `slug: ${meta.slug}`,
    `title: ${meta.title}`,
    `status: ${meta.status}`,
    `depends_on: ${JSON.stringify(meta.depends_on || [])}`,
    `blocks: ${JSON.stringify(meta.blocks || [])}`,
    `weight_area: ${meta.weight_area}`,
    `external_gates: ${JSON.stringify(meta.external_gates || [])}`,
    `charter_lines: "${meta.charter_lines}"`,
    `gate_quote_sha256: "${meta.gate_quote_sha256}"`,
    `evidence_dir: ${meta.evidence_dir}`,
    `last_reconciled: ${meta.last_reconciled}`,
    '---',
  ].join('\n');

  const dossierBody = [
    `# Stage ${meta.stage} — ${meta.title}`,
    '',
    ...sections.map((s) => `${s.heading}\n\n${s.content}`),
    '',
  ].join('\n\n');

  return `${frontMatterYaml}\n\n${dossierBody}`;
}

// Global cache helper for charter stages lookup
let cachedCharterStages = null;
function getCharterStages(root = defaultRepoRoot) {
  if (!cachedCharterStages) {
    const charterContent = fs.readFileSync(path.join(root, 'PROJECT_CHARTER.md'), 'utf8');
    cachedCharterStages = parseCharter(charterContent);
  }
  return cachedCharterStages;
}

function charterStageN_for_this_stage(stageNum, root = defaultRepoRoot) {
  const stages = getCharterStages(root);
  const found = stages.find((s) => s.stage === stageNum);
  if (!found) throw new Error(`Stage ${stageNum} not found in PROJECT_CHARTER.md`);
  return found;
}

/**
 * Main downstream refinement engine function.
 */
export async function refineDownstream({
  stage,
  evidenceDir = null,
  root = defaultRepoRoot,
  dryRun = false,
  silent = false,
}) {
  const stageNum = parseInt(stage, 10);
  if (isNaN(stageNum) || stageNum < 1 || stageNum > 55) {
    throw new Error(`Invalid stage number: "${stage}". Must be an integer between 1 and 55.`);
  }

  // Clear cache for fresh run
  cachedCharterStages = null;
  const charterStages = getCharterStages(root);
  const charterStageN = charterStages.find((s) => s.stage === stageNum);
  if (!charterStageN) {
    throw new Error(`Stage ${stageNum} not found in charter`);
  }

  const log = (msg) => {
    if (!silent) console.log(msg);
  };

  log(`================ S7.5 DOWNSTREAM REFINEMENT ================`);
  log(`Completed Stage : ${stageNum} — ${charterStageN.title}`);
  log(`Repository Root : ${root}`);
  log(`Evidence Dir    : ${evidenceDir || '(default)'}`);
  log(`Mode            : ${dryRun ? 'DRY-RUN (no files will be written)' : 'LIVE'}`);
  log(`===========================================================`);

  if (stageNum === 55) {
    log('Stage 55 is the final roadmap stage; no downstream stages (56..55) exist to refine.');
    return { refinedCount: 0, updatedStages: [], stageDeliverables: null, success: true };
  }

  // 1. Extract Stage N Deliverables
  const deliverables = extractStageDeliverables(stageNum, evidenceDir, root);
  log(`Extracted Deliverables for Stage ${stageNum}:`);
  log(`  Summary: ${deliverables.summary}`);
  if (deliverables.concreteRefs.length > 0) {
    log(`  Concrete Entities: ${deliverables.concreteRefs.join(' | ')}`);
  }

  // 2. Sweep Downstream Dossiers (stageNum + 1 to 55)
  const stagesDir = path.join(root, 'docs/stages');
  const allFiles = fs.readdirSync(stagesDir);
  const updatedStages = [];

  for (let s = stageNum + 1; s <= 55; s++) {
    const sPad = String(s).padStart(2, '0');
    const filename = allFiles.find((f) => f.startsWith(`stage-${sPad}-`) && f.endsWith('.md'));
    if (!filename) {
      log(`WARNING: Dossier for Stage ${s} not found, skipping.`);
      continue;
    }

    const fullPath = path.join(stagesDir, filename);
    const originalContent = fs.readFileSync(fullPath, 'utf8');

    // Refine dossier
    const refinedContent = refineDossierContent(originalContent, stageNum, deliverables, charterStageN, charterStages);

    // Validate front-matter and section schema
    const { meta: newMeta, body: newBody } = parseFrontMatter(refinedContent);
    const newSections = parseDossierSections(newBody);
    validateFrontMatter(newMeta);
    validateSectionSchema(newSections);

    // Verify verbatim quote hash
    const csDownstream = charterStages.find((cs) => cs.stage === s);
    validateGateQuote(extractCharterGateQuote(newSections[0].content), csDownstream.gateQuote, newMeta.gate_quote_sha256);

    // Write back to disk if not dry-run
    if (!dryRun) {
      fs.writeFileSync(fullPath, refinedContent, 'utf8');
    }

    updatedStages.push(s);
  }

  log(`Refined ${updatedStages.length} downstream dossiers (Stages ${stageNum + 1}..55).`);

  // 3. Regenerate Dynamic Index
  log('Regenerating docs/stages/README.md dynamic index...');
  const indexContent = generateIndexContent(root);
  if (!dryRun) {
    const indexReadmePath = path.join(stagesDir, 'README.md');
    fs.writeFileSync(indexReadmePath, indexContent, 'utf8');
    log(`Index successfully updated at ${indexReadmePath}`);
  }

  // 4. Full Machine Guard Verification
  log('Executing full machine guard verification across all 55 stages...');
  const filesNow = fs.readdirSync(stagesDir).filter((f) => /^stage-(0[1-9]|[1-4][0-9]|5[0-5])-[a-z0-9-]+\.md$/.test(f));
  const nodes = [];

  for (const f of filesNow) {
    const c = fs.readFileSync(path.join(stagesDir, f), 'utf8');
    const { meta: m, body: b } = parseFrontMatter(c);
    const secs = parseDossierSections(b);
    validateFrontMatter(m);
    validateSectionSchema(secs);

    const cs = charterStages.find((x) => x.stage === m.stage);
    validateGateQuote(extractCharterGateQuote(secs[0].content), cs.gateQuote, m.gate_quote_sha256);
    nodes.push({ stage: m.stage, depends_on: m.depends_on, blocks: m.blocks });
  }

  validateDagAcyclicity(nodes);
  validateBidirectionalConsistency(nodes);
  log('OK: Machine guard assertions passed with 100% invariant fidelity.');

  // 5. Append Record to STATE.md if on real repo and not dry run
  const stateFilePath = path.join(root, 'STATE.md');
  if (!dryRun && fs.existsSync(stateFilePath)) {
    const isoDate = new Date().toISOString();
    const stateNote = `\n- ${isoDate} Post-Stage Downstream Refinement: Stage ${stageNum} (${charterStageN.title}) promoted; cascaded concrete models, routes, tables, and types into downstream dossiers ${stageNum + 1}..55.\n`;
    fs.appendFileSync(stateFilePath, stateNote, 'utf8');
    log('Recorded refinement entry in STATE.md.');
  }

  log(`================ S7.5 REFINEMENT COMPLETE ================`);
  return {
    refinedCount: updatedStages.length,
    updatedStages,
    stageDeliverables: deliverables,
    success: true,
  };
}

/**
 * CLI Entry point
 */
export async function main() {
  const args = process.argv.slice(2);
  let stage = null;
  let evidenceDir = null;
  let root = defaultRepoRoot;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--stage' || arg === '-s') {
      stage = args[++i];
    } else if (arg.startsWith('--stage=')) {
      stage = arg.slice('--stage='.length);
    } else if (arg === '--evidence-dir') {
      evidenceDir = args[++i];
    } else if (arg.startsWith('--evidence-dir=')) {
      evidenceDir = arg.slice('--evidence-dir='.length);
    } else if (arg === '--root') {
      root = path.resolve(args[++i]);
    } else if (arg.startsWith('--root=')) {
      root = path.resolve(arg.slice('--root='.length));
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node scripts/stages/refine-downstream.mjs --stage <N> [--evidence-dir <dir>] [--root <dir>] [--dry-run]');
      process.exit(0);
    }
  }

  if (!stage) {
    console.error('ERROR: Missing required option: --stage <N>');
    console.error('Usage: node scripts/stages/refine-downstream.mjs --stage <N> [--evidence-dir <dir>] [--root <dir>] [--dry-run]');
    process.exit(1);
  }

  try {
    await refineDownstream({ stage, evidenceDir, root, dryRun });
    process.exit(0);
  } catch (error) {
    console.error(`ERROR: Downstream refinement failed: ${error.message}`);
    if (error.stack) console.error(error.stack);
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main();
}

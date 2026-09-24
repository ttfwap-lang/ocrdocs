import express from "express";
import path from "path";
import dotenv from "dotenv";
import { createHash, timingSafeEqual } from "crypto";
import { readFile, unlink } from "fs/promises";
import { PDFParse } from "pdf-parse";
import { GoogleGenAI } from "@google/genai";
import { createServer as createViteServer } from "vite";
import {
  loadAndValidateEnv,
  EnvValidationError,
  type LoadedEnvConfig,
} from "./server/config/env";
import {
  createShutdownManager,
  formatListenError,
  listenAsync,
} from "./server/lifecycle/shutdown";

dotenv.config();

const app = express();

app.use(express.json({ limit: "10mb" }));

import { extractBankFieldsFromText } from "./src/utils/ocrMatcherEngine";
import { mergeVlmFields, parseDocumentType, parseReview, parseVlmFields } from "./server/services/vlmFieldMerge";
import { ServiceAvailabilityResponse, ExtractionResult } from "./src/types";
import { initDb, closeDb } from "./server/db/database";
import { createDocumentRepo } from "./server/db/repositories/documentRepo";
import { createJobRepo } from "./server/db/repositories/jobRepo";
import { createExtractionRepo } from "./server/db/repositories/extractionRepo";
import type { ExtractedField, ValidationStatus } from "./server/db/contracts";
import { upload } from "./server/middleware/upload";
import { createIdentityService } from "./server/services/identityService";
import { createHeadshotService } from "./server/services/headshotService";
import { createImportService, type PreparseShell, type UploadedFile } from "./server/services/importService";
import {
  syncMedicareIndex,
  getMedicareSummary,
  queryMedicarePatients,
  allMedicarePatients,
  getMedicarePatient,
  medicareIndexPath,
  MEDICARE_SORTABLE_COLUMNS,
  type MedicareQuery,
} from "./server/services/medicareService";

const db = initDb();

// The Medicare index is a separate corpus from uploaded documents: it is the
// full archive PHI extraction (see _medica_scan_report/PHI). Import it on boot
// so the tab is queryable server-side; a no-op when the JSON is unchanged.
const medicareSync = syncMedicareIndex(db);
console.log(
  `[Medicare] index ${medicareSync.reason}: ${medicareSync.rows} patients (${medicareIndexPath()})`,
);
const documentRepo = createDocumentRepo(db);
const jobRepo = createJobRepo(db);
const extractionRepo = createExtractionRepo(db);
// Head photos live next to the database (data/headshots by default): the same
// identityId hash scheme as identityService, so photos attach to people with
// zero guesswork. Overridable for deployments that keep originals elsewhere.
const HEADSHOTS_ROOT =
  process.env.OCRDOCS_HEADSHOTS_DIR ||
  path.join(path.dirname(path.resolve(process.env.DATABASE_PATH || "data/app.db")), "headshots");
const headshotService = createHeadshotService(HEADSHOTS_ROOT);
const identityService = createIdentityService(documentRepo, extractionRepo, headshotService);

// How long a claimed job may sit in 'processing' before its worker is presumed
// dead, and how many times a job may be claimed before it is failed for good.
const WORKER_LEASE_SECONDS = Number(process.env.OCRDOCS_WORKER_LEASE_SECONDS || 900);
const MAX_JOB_ATTEMPTS = Number(process.env.OCRDOCS_MAX_JOB_ATTEMPTS || 3);

// Field extraction runs 99 regexes synchronously on the request thread, so an
// unbounded document would block the event loop for every other request. The
// text is untrusted (it comes out of an uploaded file, or back from a worker),
// so it is capped before matching rather than trusted to be a sane size.
const MAX_EXTRACTION_TEXT_CHARS = Number(process.env.OCRDOCS_MAX_EXTRACTION_TEXT_CHARS || 2_000_000);

// — Batch import (`ocr.local`) configuration. Read at module scope to mirror the
// other operational flags above (WORKER_LEASE_SECONDS etc.). env.ts is
// intentionally NOT modified for import flags — see docs/GX10_DEPLOYMENT.md.
const IMPORT_ROOT = process.env.OCRDOCS_IMPORT_ROOT ||
  (process.platform === "win32" ? "C:\\NVIDIA-Workbench\\ocr" : path.join(process.cwd(), "storage", "ocr"));
const QUEUED_DIR = process.env.OCRDOCS_QUEUED_DIR || path.join(IMPORT_ROOT, "queued");
const PARSED_DIR = process.env.OCRDOCS_PARSED_DIR || path.join(IMPORT_ROOT, "parsed");
const PREPARSE_SCRIPT_PATH =
  process.env.OCRDOCS_PREPARSE_SCRIPT || path.join(process.cwd(), "scripts", "pre-parse.sh");
const PREPARSE_SHELL: PreparseShell =
  process.env.OCRDOCS_PREPARSE_SHELL === "node"
    ? "node"
    : process.env.OCRDOCS_PREPARSE_SHELL === "wsl"
      ? "wsl"
      : process.env.OCRDOCS_PREPARSE_SHELL === "bash"
        ? "bash"
        : process.platform === "win32"
          ? "wsl"
          : "bash";
const IMPORT_MAX_FILES = Number(process.env.OCRDOCS_IMPORT_MAX_FILES) || 500;
const IMPORT_MAX_TOTAL_MB = Number(process.env.OCRDOCS_IMPORT_MAX_TOTAL_MB) || 500;

// Side-effect-free at construction (mkdirs are deferred to stageImport), so
// instantiating at module scope is safe for every test that imports server.ts.
const importService = createImportService({
  documentRepo,
  jobRepo,
  queuedDir: QUEUED_DIR,
  parsedDir: PARSED_DIR,
  preparseScript: PREPARSE_SCRIPT_PATH,
  preparseShell: PREPARSE_SHELL,
  maxFiles: IMPORT_MAX_FILES,
  maxTotalMb: IMPORT_MAX_TOTAL_MB,
});

/**
 * Quote a CSV cell, neutralising spreadsheet formula injection.
 *
 * Field values come out of untrusted uploaded documents. A value beginning
 * with =, +, - or @ is executed as a formula when the CSV is opened in Excel
 * or Sheets, so a crafted document could run a command on a reviewer's
 * machine. Prefixing a single quote makes the cell inert while keeping the
 * text readable.
 */
function csvEscape(value: unknown): string {
  const str = value === null || value === undefined ? "" : String(value);
  const safe = /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
  return `"${safe.replace(/"/g, '""')}"`;
}

function capExtractionText(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_EXTRACTION_TEXT_CHARS) {
    return { text, truncated: false };
  }
  return { text: text.slice(0, MAX_EXTRACTION_TEXT_CHARS), truncated: true };
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

// Fails closed: with no DGX_WORKER_TOKEN configured, every worker endpoint
// is unreachable rather than silently open. Typed as express.RequestHandler
// (not hand-written param types) so it stays generic-compatible with
// whatever route params the handler chained after it declares.
const requireWorkerAuth: express.RequestHandler = (req, res, next) => {
  const token = process.env.DGX_WORKER_TOKEN;
  if (!token) {
    res.status(503).json({ error: "DGX worker endpoints are not configured (DGX_WORKER_TOKEN unset)." });
    return;
  }
  const header = req.headers.authorization || "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!provided || !constantTimeEquals(provided, token)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
};

/**
 * Batch-import bearer guard for the `ocr.local` workflow. Mirrors
 * requireWorkerAuth: fails closed when OCRDOCS_IMPORT_ENABLED != true or when
 * OCRDOCS_IMPORT_TOKEN is unset, then constant-time-compares the bearer token.
 */
const requireImportAuth: express.RequestHandler = (req, res, next) => {
  if (process.env.OCRDOCS_IMPORT_ENABLED !== "true") {
    res.status(503).json({ error: "Batch import is disabled (OCRDOCS_IMPORT_ENABLED != true)." });
    return;
  }
  const token = process.env.OCRDOCS_IMPORT_TOKEN || "";
  if (!token) {
    res.status(503).json({ error: "Import token not configured (OCRDOCS_IMPORT_TOKEN unset)." });
    return;
  }
  const header = req.headers.authorization || "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!provided || !constantTimeEquals(provided, token)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
};

function toExtractedField(r: ExtractionResult): ExtractedField {
  const validationStatus: ValidationStatus =
    r.isValid === true ? "valid" : r.isValid === false ? "invalid" : "pending";
  return {
    name: r.fieldName,
    value: r.canonicalValue ?? r.extractedValue,
    confidence: r.confidence,
    sourceSection: r.contextSnippet ?? null,
    validated: typeof r.isValid === "boolean",
    validationStatus,
    correctedValue: null,
    approved: false,
    category: r.category,
  };
}

// Lazy initialization for Google GenAI client
let aiClient: GoogleGenAI | null = null;
function getAIClient(): GoogleGenAI {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn("WARNING: GEMINI_API_KEY is not set in the environment.");
    }
    aiClient = new GoogleGenAI({
      apiKey: apiKey || "",
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return aiClient;
}

// Health check and component diagnostic endpoint
app.get("/api/health", (_req, res) => {
  const dgxWorkerConfigured = Boolean(process.env.DGX_WORKER_TOKEN);
  res.json({
    status: "ok",
    service: "ocrdocs-banking-ocr",
    timestamp: new Date().toISOString(),
    services: {
      ocr_worker: { available: true, mode: "live" },
      dgx_worker: { available: dgxWorkerConfigured, mode: dgxWorkerConfigured ? "live" : "unconfigured" },
    },
  });
});

// Service availability matrix endpoint (Stage 4 Contract)
app.get("/api/services/status", (_req, res) => {
  const dgxWorkerConfigured = Boolean(process.env.DGX_WORKER_TOKEN);

  const statuses: ServiceAvailabilityResponse[] = [
    {
      service: "ocr_worker",
      mode: "live",
      available: true,
      reason: undefined,
    },
    {
      service: "dgx_worker",
      mode: dgxWorkerConfigured ? "live" : "unconfigured",
      available: dgxWorkerConfigured,
      reason: dgxWorkerConfigured ? undefined : "DGX_WORKER_TOKEN not configured; no DGX worker can authenticate.",
    },
  ];

  res.json(statuses);
});

// Serve the Production DGX Scripts for download or curl
app.get("/api/scripts/:scriptName", requireWorkerAuth, async (req: express.Request<{ scriptName: string }>, res) => {
  const { scriptName } = req.params;
  const allowed = [
    "dgx_setup.sh", "ocr_spark_engine.py", "ocr_hybrid.py", "ocr_paddle_vl.py", "ocr_qwen_merge.py", "ocr_chandra.py",
    "ocr_llamaparse.py", "ocr_llamacloud.py", "ocr_gates.py", "ocr_question_score.py", "ocr_agent_verify.py", "ocr_doc_pipeline.py", "vllm_services.sh", "deploy.sh",
    "check_dgx_codebase.sh",
  ];
  if (!allowed.includes(scriptName)) {
    return res.status(404).json({ error: "Script not found. Valid: " + allowed.join(", ") });
  }

  const scriptPath = path.join(process.cwd(), "scripts", scriptName);
  try {
    const fs = await import("fs/promises");
    const content = await fs.readFile(scriptPath, "utf-8");
    res.setHeader("Content-Type", scriptName.endsWith(".py") ? "text/x-python" : "text/x-sh");
    res.setHeader("Content-Disposition", `attachment; filename="${scriptName}"`);
    return res.send(content);
  } catch (err: any) {
    return res.status(500).json({ error: "Failed to read script: " + err.message });
  }
});

// DGX Remote Telemetry Ingestion & Audit Reports
let latestDgxTelemetryReport: any = null;
const dgxReportHistory: any[] = [];

/** Truncate an untrusted value to a bounded string, or drop it entirely. */
function boundedString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") {
    return undefined;
  }
  const str = String(value);
  return str.length > maxLength ? `${str.slice(0, maxLength)}… [truncated]` : str;
}

/**
 * Telemetry arrives from a remote machine, so it is untrusted input rendered
 * into an operator UI. Only known fields are kept, each length-capped: the
 * previous handler spread the entire request body into memory, letting any
 * caller retain up to the 10MB JSON limit per report across 20 history slots.
 */
function normalizeTelemetryReport(body: any, sourceIp: string) {
  return {
    receivedAt: new Date().toISOString(),
    sourceIp,
    hostname: boundedString(body?.hostname, 256),
    currentUser: boundedString(body?.currentUser, 256),
    timestamp: boundedString(body?.timestamp, 64),
    architecture: boundedString(body?.architecture, 128),
    kernel: boundedString(body?.kernel, 256),
    cpuModel: boundedString(body?.cpuModel, 256),
    memTotal: boundedString(body?.memTotal, 64),
    gpuInfo: boundedString(body?.gpuInfo, 2_000),
    nvidiaSmiVersion: boundedString(body?.nvidiaSmiVersion, 128),
    inputFilesCount: boundedString(body?.inputFilesCount, 32),
    pythonDiagnostics: boundedString(body?.pythonDiagnostics, 8_000),
    directoryTree: boundedString(body?.directoryTree, 16_000),
    errorLog: boundedString(body?.errorLog, 8_000),
  };
}

app.post("/api/dgx/telemetry-report", requireWorkerAuth, (req, res) => {
  try {
    const sourceIp = String(req.ip || req.headers["x-forwarded-for"] || "remote-dgx").slice(0, 128);
    latestDgxTelemetryReport = normalizeTelemetryReport(req.body, sourceIp);

    dgxReportHistory.unshift(latestDgxTelemetryReport);
    if (dgxReportHistory.length > 20) dgxReportHistory.pop();

    console.log(
      `[DGX-TELEMETRY] Report from ${latestDgxTelemetryReport.hostname || "unknown host"} (${latestDgxTelemetryReport.currentUser || "unknown user"})`,
    );

    return res.json({
      status: "received",
      timestamp: latestDgxTelemetryReport.receivedAt,
      hostname: latestDgxTelemetryReport.hostname,
      inputFilesCount: latestDgxTelemetryReport.inputFilesCount,
    });
  } catch (err: any) {
    return res.status(400).json({ error: "Invalid report payload: " + err.message });
  }
});

app.get("/api/dgx/telemetry-report", (_req, res) => {
  if (!latestDgxTelemetryReport) {
    return res.json({
      hasReport: false,
      message: "No report received yet. Run check_dgx_codebase.sh on your DGX cluster to send telemetric diagnostics.",
      historyCount: 0
    });
  }
  return res.json({
    hasReport: true,
    latest: latestDgxTelemetryReport,
    historyCount: dgxReportHistory.length
  });
});

// Gemini Multi-turn Chatbot Endpoint
app.post("/api/chat", async (req, res) => {
  try {
    const { messages, systemInstruction } = req.body;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "Missing or invalid 'messages' array" });
    }

    const ai = getAIClient();

    // Map conversation messages to GenAI format
    const formattedContents = messages.map((m: { role: string; content: string }) => ({
      role: m.role === "user" ? "user" : "model",
      parts: [{ text: m.content }],
    }));

    const defaultSystemInstruction =
      "You are a Senior Australian Banking OCR Systems Architect. " +
      "You specialize in enterprise OCR pipelines, a multi-pass Tesseract/PaddleOCR/EasyOCR/Surya ensemble running on NVIDIA DGX (Grace Blackwell) GPU clusters, " +
      "VRAM throttling, CUDA stream concurrency, DuckDB integration, APRA banking regulatory formats, " +
      "and ultra-high recall typo-tolerant regex extraction across Australian mortgage, credit card, " +
      "and KYC banking application forms. Give clear, production-grade technical guidance with code snippets.";

    const response = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
      contents: formattedContents,
      config: {
        systemInstruction: systemInstruction || defaultSystemInstruction,
        temperature: 0.7,
      },
    });

    const reply = response.text || "No response generated.";
    return res.json({ reply });
  } catch (error: any) {
    console.error("Gemini Chat API Error:", error);
    return res.status(500).json({
      error: error?.message || "Failed to communicate with Gemini API",
    });
  }
});


// Real document intake: stores the upload, enqueues a job, and for native
// (digital-text) PDFs extracts and persists fields immediately. Scanned PDFs
// and images have no local OCR path yet — they stay queued pending the DGX
// worker (Phase 2) and are reported honestly as such, not faked.
app.post("/api/documents", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded. Use multipart form field 'file'." });
    }

    const fileBuffer = await readFile(req.file.path);
    const contentHash = createHash("sha256").update(fileBuffer).digest("hex");

    // Identical bytes are the same document. Re-uploading one (easy to do when
    // bulk-ingesting a folder) should not create a second row, store a second
    // copy of the PII, or spend another GPU pass on work already done. Use
    // POST /api/documents/:id/reprocess to deliberately re-run a document.
    const existing = documentRepo.getByContentHash(contentHash);
    if (existing) {
      await unlink(req.file.path).catch(() => {
        // The duplicate upload's bytes are redundant; failing to remove the
        // temp copy must not fail the request.
      });
      const extractions = extractionRepo.getExtractionsByDocument(existing.id);
      return res.status(200).json({
        document: existing,
        jobs: jobRepo.getByDocument(existing.id),
        extraction: extractions.length
          ? extractionRepo.getFullResult(extractions[extractions.length - 1].id)
          : null,
        duplicate: true,
        message: `Identical content already uploaded as "${existing.filename}". Returning the existing document instead of processing it again.`,
      });
    }

    const document = documentRepo.insert({
      filename: req.file.originalname,
      originalPath: req.file.path,
      contentHash,
      mimeType: req.file.mimetype,
    });

    const job = jobRepo.enqueue({ documentId: document.id });

    if (req.file.mimetype !== "application/pdf") {
      return res.status(202).json({
        document,
        job,
        status: "needs_ocr",
        message: "Image OCR requires the DGX worker, which is not connected yet. The document is queued.",
      });
    }

    jobRepo.markProcessing(job.id);

    let text = "";
    const parser = new PDFParse({ data: fileBuffer });
    try {
      const result = await parser.getText();
      text = result.text ?? "";
    } finally {
      await parser.destroy();
    }

    if (!text.trim()) {
      jobRepo.markFailed(job.id, "No extractable text layer; likely a scanned PDF requiring OCR.");
      documentRepo.updateStatus(document.id, "failed");
      return res.status(202).json({
        document: documentRepo.getById(document.id),
        job: jobRepo.getById(job.id),
        status: "needs_ocr",
        message: "No native text layer found. This looks like a scanned PDF and needs the DGX OCR worker, which is not connected yet.",
      });
    }

    const capped = capExtractionText(text);
    if (capped.truncated) {
      console.warn(
        `[EXTRACT] Document ${document.id} text truncated to ${MAX_EXTRACTION_TEXT_CHARS} chars for matching`,
      );
    }
    const fields = extractBankFieldsFromText(capped.text).map(toExtractedField);
    const extraction = extractionRepo.createExtraction({
      documentId: document.id,
      rawText: capped.text,
      extractionVersion: extractionRepo.nextVersionForDocument(document.id),
      extractionJson: JSON.stringify({
        engineUsed: "native-pdf-text",
        textTruncated: capped.truncated,
      }),
    });
    extractionRepo.insertFields(extraction.id, fields);

    jobRepo.markCompleted(job.id);
    documentRepo.updateStatus(document.id, "extracted");

    return res.status(201).json({
      document: documentRepo.getById(document.id),
      job: jobRepo.getById(job.id),
      extraction: extractionRepo.getFullResult(extraction.id),
    });
  } catch (err: any) {
    console.error("Document upload/extraction error:", err);
    return res.status(500).json({ error: err?.message || "Failed to process document upload" });
  }
});

app.get("/api/documents", (_req, res) => {
  res.json(documentRepo.getAll());
});

app.get("/api/documents/:id", (req, res) => {
  const document = documentRepo.getById(req.params.id);
  if (!document) {
    return res.status(404).json({ error: "Document not found" });
  }
  const extractions = extractionRepo.getExtractionsByDocument(document.id);
  const jobs = jobRepo.getByDocument(document.id);
  return res.json({
    document,
    jobs,
    extractions: extractions.map((e) => extractionRepo.getFullResult(e.id)),
    photos: headshotService.photosForDocument(document.id),
  });
});

// Serve a document's original bytes for inline preview (default) or download
// (?download=1). Path + root are passed separately, not a bare absolute path
// -- see the /api/jobs/:id/file handler below for why that matters on Windows.
app.get("/api/documents/:id/file", (req: express.Request<{ id: string }>, res) => {
  const document = documentRepo.getById(req.params.id);
  if (!document) {
    return res.status(404).json({ error: "Document not found" });
  }
  const absolutePath = path.resolve(document.original_path);
  const disposition = req.query.download ? "attachment" : "inline";
  const safeFilename = document.filename.replace(/"/g, "");
  res.setHeader("Content-Disposition", `${disposition}; filename="${safeFilename}"`);
  if (document.mime_type) {
    res.setHeader("Content-Type", document.mime_type);
  }
  return res.sendFile(path.basename(absolutePath), { root: path.dirname(absolutePath) }, (err) => {
    if (err && !res.headersSent) {
      res.status(404).json({ error: "Original file is missing from storage" });
    }
  });
});

// — Batch import (`ocr.local`) endpoints. Full pipeline lives in
// server/services/importService.ts: stage → run pre-parse script (TARGET_DIR=$1)
// → finalize (rename staged→parsed/<ts>, content-hash dedup, enqueue one OCR
// job per surviving file, identical to POST /api/documents). Auth mirrors
// requireWorkerAuth (fail-closed + constant-time).
app.post(
  "/api/imports",
  requireImportAuth,
  upload.array("files", IMPORT_MAX_FILES),
  async (req, res) => {
    try {
      if (req.body && req.body.source === "folder" && req.body.path) {
        const manifest = await importService.stageImport({ folder: String(req.body.path) });
        return res.status(202).json(manifest);
      }
      const files = Array.isArray(req.files) ? (req.files as UploadedFile[]) : [];
      if (files.length === 0) {
        return res
          .status(400)
          .json({ error: "No files provided. POST multipart 'files' or {source:'folder',path}." });
      }
      const manifest = await importService.stageImport({ files });
      return res.status(202).json(manifest);
    } catch (err: any) {
      return res.status(400).json({ error: err?.message || "Failed to stage import" });
    }
  },
);

app.post("/api/imports/:id/run", requireImportAuth, async (req: express.Request<{ id: string }>, res) => {
  try {
    const record = importService.getRecord(req.params.id);
    if (record.status !== "staged") {
      return res.status(404).json({ error: "Import not found" });
    }
    const run = await importService.runPreParse(req.params.id);
    if (!run.ok) {
      importService.failImport(req.params.id, run.stderr, run.code);
      return res
        .status(500)
        .json({ importId: req.params.id, status: "failed", stdout: run.stdout, stderr: run.stderr, code: run.code });
    }
    const { parsedDir, jobIds } = await importService.finalize(req.params.id);
    return res.status(200).json({
      importId: req.params.id,
      status: "parsed",
      parsedDir,
      jobIds,
      stdout: run.stdout,
      stderr: run.stderr,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Failed to run import" });
  }
});

app.get("/api/imports/:id", requireImportAuth, (req: express.Request<{ id: string }>, res) => {
  try {
    return res.json(importService.getRecord(req.params.id));
  } catch {
    return res.status(404).json({ error: "Import not found" });
  }
});

app.get("/api/imports", requireImportAuth, (_req, res) => {
  return res.json({ imports: importService.listRecords() });
});

// Head photos (scripts/extract_headshots.py output) served so the identities
// UI can show thumbnails/galleries. Mounted before the SPA catch-all below.
app.use("/headshots", express.static(HEADSHOTS_ROOT));

// Identities: documents grouped by their extracted given_names + family_name
// + date_of_birth (see server/services/identityService.ts). No separate
// identities table -- the grouping is derived live from real extraction
// data, so it can never disagree with what the fields table actually says.
app.get("/api/identities", (_req, res) => {
  res.json({
    identities: identityService.listIdentities(),
    unassigned: identityService.listUnassigned(),
  });
});

app.get("/api/identities/:identityId", (req: express.Request<{ identityId: string }>, res) => {
  const identity = identityService.getIdentityDetail(req.params.identityId);
  if (!identity) {
    return res.status(404).json({ error: "Identity not found" });
  }
  return res.json(identity);
});

// ---------------------------------------------------------------------------
// Medicare index — the full archive PHI extraction, indexed in SQLite and
// served as a searchable/filterable/sortable page (the "Medicare" tab).
// These endpoints carry real patient PHI: same trust level as /api/identities.
// ---------------------------------------------------------------------------

/** Translate query-string params into a validated MedicareQuery. */
function parseMedicareQuery(query: Record<string, unknown>): MedicareQuery {
  const one = (key: string): string | undefined => {
    const v = query[key];
    if (Array.isArray(v)) return undefined;
    return typeof v === "string" ? v : undefined;
  };
  const q = one("q");
  const medicareState = one("medicare_state");
  const nameStatus = one("name_status");
  const expiryState = one("expiry_state");
  const needsReview = one("needs_review");
  const dir = one("dir");
  return {
    q,
    medicareState:
      medicareState === "verified" || medicareState === "failed" ||
      medicareState === "unverifiable" || medicareState === "absent"
        ? medicareState
        : "all",
    nameStatus:
      nameStatus === "ok" || nameStatus === "suspect" ||
      nameStatus === "form_label" || nameStatus === "missing"
        ? nameStatus
        : "all",
    expiryState:
      expiryState === "with" || expiryState === "without" || expiryState === "expired" ||
      expiryState === "expiring_soon"
        ? expiryState
        : "all",
    sex: one("sex") || undefined,
    state: one("state") || undefined,
    needsReview: needsReview === "only" || needsReview === "clean" ? needsReview : "all",
    sort: one("sort") || undefined,
    dir: dir === "desc" ? "desc" : "asc",
    limit: one("limit") ? Number.parseInt(one("limit") as string, 10) : undefined,
    offset: one("offset") ? Number.parseInt(one("offset") as string, 10) : undefined,
  };
}

app.get("/api/medicare/summary", (_req, res) => {
  res.json({ ...getMedicareSummary(db), sortableColumns: MEDICARE_SORTABLE_COLUMNS });
});

app.get("/api/medicare/patients", (req, res) => {
  res.json(queryMedicarePatients(db, parseMedicareQuery(req.query as Record<string, unknown>)));
});

app.get("/api/medicare/patients/:patientId", (req: express.Request<{ patientId: string }>, res) => {
  const patient = getMedicarePatient(db, req.params.patientId);
  if (!patient) {
    return res.status(404).json({ error: "Patient not found" });
  }
  return res.json(patient);
});

// Full index (or the current filter) as CSV, mirroring the consolidated export.
app.get("/api/medicare/export.csv", (req, res) => {
  const rows = allMedicarePatients(db, parseMedicareQuery(req.query as Record<string, unknown>));
  const header = [
    "patient_id", "name_display", "name_status", "medicare_number", "medicare_valid",
    "medicare_flags", "dob_iso", "sex", "mrn", "phone", "email", "address_full",
    "suburb", "state", "postcode", "expiry_best_date", "expiry_best_raw",
    "expiry_best_precision", "expiry_tokens", "record_count", "completeness",
    "needs_review", "source_files",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.patient_id,
        r.name_display ?? "",
        r.name_status ?? "",
        r.medicare_number ?? "",
        r.medicare_valid === "" || r.medicare_valid === null || r.medicare_valid === undefined
          ? ""
          : r.medicare_valid === 1
            ? "yes"
            : "no",
        r.medicare_flags ?? "",
        r.dob_iso ?? "",
        r.sex ?? "",
        r.mrn ?? "",
        r.phone ?? "",
        r.email ?? "",
        r.address_full ?? "",
        r.suburb ?? "",
        r.state ?? "",
        r.postcode ?? "",
        r.expiry_best_date ?? "",
        r.expiry_best_raw ?? "",
        r.expiry_best_precision ?? "",
        r.expiry_tokens ?? "",
        r.record_count ?? "",
        r.completeness ?? "",
        r.needs_review ?? "",
        (r.sources ?? []).join("; "),
      ]
        .map(csvEscape)
        .join(","),
    );
  }
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="medicare_index_${Date.now()}.csv"`,
  );
  return res.send(lines.join("\n"));
});

// One-click export: every original file plus a single readable text summary
// of the consolidated field breakdown, zipped for the reviewer to hand off.
app.get("/api/identities/:identityId/export.zip", async (req: express.Request<{ identityId: string }>, res) => {
  const identity = identityService.getIdentityDetail(req.params.identityId);
  if (!identity) {
    return res.status(404).json({ error: "Identity not found" });
  }

  const { default: archiver } = await import("archiver");
  const safeName = `${identity.givenNames}${identity.familyName}`.replace(/[^A-Za-z0-9]/g, "") || "Identity";

  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${safeName}_export.zip"`);

  const archive = archiver("zip", { zlib: { level: 9 } });
  archive.on("error", (err) => {
    console.error("Zip export error:", err);
    if (!res.headersSent) {
      res.status(500);
    }
    res.end();
  });
  archive.pipe(res);

  const lines: string[] = [
    identity.fullName,
    `Date of Birth: ${identity.dob}`,
    `Documents: ${identity.documentCount} (extracted ${identity.extractedCount}, pending ${identity.pendingCount}, failed ${identity.failedCount})`,
    "",
    "=== Consolidated Field Breakdown ===",
  ];
  for (const f of identity.fieldBreakdown) {
    lines.push(
      `${f.name}: ${f.value}  [confidence ${Math.round(f.confidence * 100)}%, ${f.approved ? "approved" : "unapproved"}, source: ${f.documentFilename}]`,
    );
  }
  lines.push("", "=== Source Documents ===");
  for (const { document } of identity.documents) {
    lines.push(`- ${document.filename} (status: ${document.status}, uploaded: ${document.uploaded_at})`);
  }
  archive.append(lines.join("\n"), { name: `${safeName}parseddata.txt` });

  for (const { document } of identity.documents) {
    const absolutePath = path.resolve(document.original_path);
    // Prefix with a short id slice: two source documents can share a filename
    // (e.g. two "scan.pdf" from different folders), which would otherwise
    // silently collide inside the zip's originals/ directory.
    archive.file(absolutePath, { name: `originals/${document.id.slice(0, 8)}_${document.filename}` });
  }

  await archive.finalize();
});

/**
 * Consolidated export: one row per document, one column per field, across the
 * whole corpus. This is the artifact an analyst actually wants out of a batch
 * run — the per-document exports in the UI answer "what did this document
 * say", this answers "what did all of them say".
 *
 * Reviewer corrections win over extracted values, because a corrected value is
 * the one a human vouched for. `<field>__approved` columns travel alongside so
 * a consumer can tell a reviewed value from an unreviewed one instead of
 * having to assume.
 */
app.get("/api/export/consolidated.csv", (_req, res) => {
  const documents = documentRepo.getAll();

  // Column set is the union of field names actually present, so the export
  // reflects real data rather than a hardcoded schema that could drift.
  const fieldNames: string[] = [];
  const perDocument = documents.map((doc) => {
    const extractions = extractionRepo.getExtractionsByDocument(doc.id);
    const latest = extractions.length ? extractions[extractions.length - 1] : undefined;
    const rows = latest ? extractionRepo.getFields(latest.id) : [];
    const values = new Map<string, { value: string; approved: boolean }>();
    for (const row of rows) {
      if (!fieldNames.includes(row.field_name)) {
        fieldNames.push(row.field_name);
      }
      const effective = row.corrected_value ?? row.field_value;
      if (effective !== null) {
        values.set(row.field_name, { value: effective, approved: row.approved === 1 });
      }
    }
    return { doc, latest, values };
  });

  const header = [
    "document_id",
    "filename",
    "status",
    "uploaded_at",
    "content_hash",
    "extraction_version",
    "engine_used",
    ...fieldNames.flatMap((name) => [name, `${name}__approved`]),
  ];

  const lines = [header.map(csvEscape).join(",")];
  for (const { doc, latest, values } of perDocument) {
    let engineUsed = "";
    if (latest?.extraction_json) {
      try {
        engineUsed = JSON.parse(latest.extraction_json).engineUsed ?? "";
      } catch {
        // A malformed blob must not break the whole export.
      }
    }
    const row = [
      doc.id,
      doc.filename,
      doc.status,
      doc.uploaded_at,
      doc.content_hash ?? "",
      latest?.extraction_version ?? "",
      engineUsed,
      ...fieldNames.flatMap((name) => {
        const hit = values.get(name);
        return [hit?.value ?? "", hit ? (hit.approved ? "yes" : "no") : ""];
      }),
    ];
    lines.push(row.map(csvEscape).join(","));
  }

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="ocrdocs_consolidated_${Date.now()}.csv"`,
  );
  return res.send(lines.join("\n"));
});

/**
 * Export a reviewer-chosen set of identities as CSV: ONE ROW PER IDENTITY.
 *
 * This is the "add to cart" export. The identities list lets a reviewer tick the people
 * they care about, and this endpoint turns that selection into a single row each, led by
 * the three real headings (name, DOB, credit score) and the trace-sourced key identifiers
 * (passport / driver's licence) with their verification tier, then the remaining extracted
 * fields.
 *
 * `ids` is a comma-separated list of identityIds. Unknown ids are ignored rather than
 * erroring, so a stale selection cannot fail the whole export. With no `ids`, it exports
 * every identity, matching the "Export All" behaviour.
 */
app.get("/api/export/identities.csv", (req: express.Request<{ ids?: string }>, res) => {
  const all = identityService.listIdentities();
  // Express types a query param as string | ParsedQs | array; only strings (or an array
  // of them) are meaningful here.
  const rawIds = req.query.ids;
  const requested = (Array.isArray(rawIds) ? rawIds.join(",") : typeof rawIds === "string" ? rawIds : "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const wanted = new Set(requested);
  const selected = wanted.size === 0 ? all : all.filter((i) => wanted.has(i.identityId));

  // Lead with the promoted headings and key identifiers, then every other field name
  // that actually appears, so the export reflects real data.
  const detailCache = new Map<string, ReturnType<typeof identityService.getIdentityDetail>>();
  for (const identity of selected) {
    detailCache.set(identity.identityId, identityService.getIdentityDetail(identity.identityId));
  }

  const leading = [
    "identity_id",
    "full_name",
    "family_name",
    "given_names",
    "dob",
    "credit_score",
    "credit_score_source",
    "passport_number",
    "passport_tier",
    "passport_sources",
    "licence_number",
    "licence_tier",
    "licence_sources",
    "document_count",
  ];

  const otherFieldNames: string[] = [];
  for (const identity of selected) {
    const detail = detailCache.get(identity.identityId);
    if (!detail) continue;
    for (const entry of detail.fieldBreakdown) {
      if (!otherFieldNames.includes(entry.name)) otherFieldNames.push(entry.name);
    }
  }

  const header = [...leading, ...otherFieldNames];
  const lines = [header.map(csvEscape).join(",")];

  for (const identity of selected) {
    const detail = detailCache.get(identity.identityId);
    const identifiers = detail?.keyIdentifiers ?? [];
    const passport = identifiers.find((k) => k.kind === "passport");
    const licence = identifiers.find((k) => k.kind === "licence");
    const byName = new Map((detail?.fieldBreakdown ?? []).map((f) => [f.name, f.value]));

    const row: unknown[] = [
      identity.identityId,
      identity.fullName,
      identity.familyName,
      identity.givenNames,
      identity.dob,
      detail?.creditScore?.value ?? "",
      detail?.creditScore?.filename ?? "",
      passport?.value ?? "",
      passport?.tier ?? "",
      (passport?.sources ?? []).map((s) => s.filename).join(" | "),
      licence?.value ?? "",
      licence?.tier ?? "",
      (licence?.sources ?? []).map((s) => s.filename).join(" | "),
      identity.documentCount,
      ...otherFieldNames.map((name) => byName.get(name) ?? ""),
    ];
    lines.push(row.map(csvEscape).join(","));
  }

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="ocrdocs_identities_${selected.length}_${Date.now()}.csv"`,
  );
  return res.send(lines.join("\n"));
});

/**
 * Queue an existing document for another OCR pass. Useful after the worker's
 * engines change, or to retry a document that failed. Each run produces a new
 * extraction version; prior extractions and any approvals on them are left
 * intact rather than overwritten.
 */
app.post("/api/documents/:id/reprocess", (req: express.Request<{ id: string }>, res) => {
  const document = documentRepo.getById(req.params.id);
  if (!document) {
    return res.status(404).json({ error: "Document not found" });
  }

  const active = jobRepo
    .getByDocument(document.id)
    .find((j) => j.status === "queued" || j.status === "processing");
  if (active) {
    return res.status(409).json({
      error: "A job for this document is already queued or processing.",
      job: active,
    });
  }

  const job = jobRepo.enqueue({ documentId: document.id });
  documentRepo.updateStatus(document.id, "uploaded");
  return res.status(202).json({
    document: documentRepo.getById(document.id),
    job,
    message: "Queued for reprocessing. A DGX worker will claim it on its next poll.",
  });
});

// Human review: extracted values are candidates until a reviewer approves
// them. Field rows are returned with their ids so corrections can address a
// specific field; extraction values themselves are never overwritten, the
// reviewer's correction is stored alongside as corrected_value.
app.get("/api/extractions/:id/fields", (req, res) => {
  const extraction = extractionRepo.getExtractionById(req.params.id);
  if (!extraction) {
    return res.status(404).json({ error: "Extraction not found" });
  }
  return res.json({
    extractionId: extraction.id,
    documentId: extraction.document_id,
    fields: extractionRepo.getFields(extraction.id),
  });
});

app.patch("/api/fields/:id", (req: express.Request<{ id: string }>, res) => {
  const field = extractionRepo.getFieldById(req.params.id);
  if (!field) {
    return res.status(404).json({ error: "Field not found" });
  }

  const body = req.body ?? {};
  if (!("correctedValue" in body)) {
    return res.status(400).json({ error: "correctedValue is required (use null to clear a correction)." });
  }
  const correctedValue = body.correctedValue === null ? null : String(body.correctedValue);

  const allowedStatuses: ValidationStatus[] = ["valid", "invalid", "warning", "pending"];
  const validationStatus: ValidationStatus = allowedStatuses.includes(body.validationStatus)
    ? body.validationStatus
    : (field.validation_status as ValidationStatus);

  extractionRepo.correctField(field.id, correctedValue, validationStatus);
  return res.json({ field: extractionRepo.getFieldById(field.id) });
});

app.post("/api/fields/:id/approve", (req: express.Request<{ id: string }>, res) => {
  const field = extractionRepo.getFieldById(req.params.id);
  if (!field) {
    return res.status(404).json({ error: "Field not found" });
  }
  const body = req.body ?? {};
  const approved = body.approved === undefined ? true : Boolean(body.approved);

  // A field with no extracted value and no reviewer correction has nothing to
  // approve — approving it would record an approval of nothing.
  const effectiveValue = field.corrected_value ?? field.field_value;
  if (approved && (effectiveValue === null || String(effectiveValue).trim() === "")) {
    return res.status(400).json({
      error: "Cannot approve an empty field. Supply a correction first.",
    });
  }

  extractionRepo.approveField(field.id, approved);
  return res.json({ field: extractionRepo.getFieldById(field.id) });
});

// DGX worker endpoints (pull model): the worker polls for claimed jobs rather
// than the server pushing to it, so the DGX box needs no inbound network
// exposure. All three require a shared-secret bearer token.
app.get("/api/jobs/claim", requireWorkerAuth, (_req, res) => {
  // Expire dead workers' leases before claiming, so a job orphaned by a
  // crashed worker is retried instead of sitting in 'processing' forever.
  const reclaimed = jobRepo.reclaimStale(WORKER_LEASE_SECONDS, MAX_JOB_ATTEMPTS);
  if (reclaimed.requeued.length > 0 || reclaimed.failed.length > 0) {
    console.log(
      `[JOBS] Expired stale leases: ${reclaimed.requeued.length} requeued, ${reclaimed.failed.length} failed after ${MAX_JOB_ATTEMPTS} attempts`,
    );
    for (const job of reclaimed.failed) {
      documentRepo.updateStatus(job.document_id, "failed");
    }
  }

  const job = jobRepo.dequeue();
  if (!job) {
    return res.status(204).end();
  }
  const document = documentRepo.getById(job.document_id);
  if (!document) {
    jobRepo.markFailed(job.id, "Associated document record missing");
    return res.status(500).json({ error: "Document record missing for claimed job" });
  }
  return res.json({
    job,
    document: { id: document.id, filename: document.filename, mimeType: document.mime_type },
  });
});

app.get("/api/jobs/:id/file", requireWorkerAuth, (req: express.Request<{ id: string }>, res) => {
  const job = jobRepo.getById(req.params.id);
  if (!job) {
    return res.status(404).json({ error: "Job not found" });
  }
  const document = documentRepo.getById(job.document_id);
  if (!document) {
    return res.status(404).json({ error: "Document not found" });
  }
  // Pass root + relative filename rather than a bare absolute path: express's
  // sendFile (via the `send` package) is unreliable with raw Windows absolute
  // paths when no root is given.
  const absolutePath = path.resolve(document.original_path);
  return res.sendFile(path.basename(absolutePath), { root: path.dirname(absolutePath) });
});

app.post("/api/jobs/:id/result", requireWorkerAuth, (req: express.Request<{ id: string }>, res) => {
  try {
    const job = jobRepo.getById(req.params.id);
    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }

    const body = req.body ?? {};

    if (body.status === "FAILED") {
      jobRepo.markFailed(job.id, typeof body.error === "string" ? body.error : "DGX worker reported failure");
      documentRepo.updateStatus(job.document_id, "failed");
      return res.json({ ok: true, status: "failed" });
    }

    const rawText = typeof body.rawText === "string" ? body.rawText : "";
    if (!rawText.trim()) {
      jobRepo.markFailed(job.id, "DGX worker returned empty text");
      documentRepo.updateStatus(job.document_id, "failed");
      return res.status(400).json({ error: "rawText is required and must be non-empty" });
    }

    // Node's regex/validation engine is the single source of truth for field
    // matching — the Python side's own field guesses (used only to drive its
    // pass loop's early-stop heuristic) are never persisted directly, so the
    // TS and Python field dictionaries can never silently drift apart.
    const capped = capExtractionText(rawText);
    if (capped.truncated) {
      console.warn(
        `[EXTRACT] Job ${job.id} worker text truncated to ${MAX_EXTRACTION_TEXT_CHARS} chars for matching`,
      );
    }
    const regexResults = extractBankFieldsFromText(capped.text);
    // vlm_v2 workers also send the fields Qwen merged from the Paddle-VL and TrOCR readings; regex validates them.
    const vlmFields = parseVlmFields(body.vlmFields);
    const fields = vlmFields.length ? mergeVlmFields(regexResults, vlmFields, toExtractedField) : regexResults.map(toExtractedField);
    const extraction = extractionRepo.createExtraction({
      documentId: job.document_id,
      rawText: capped.text,
      extractionVersion: extractionRepo.nextVersionForDocument(job.document_id),
      extractionJson: JSON.stringify({
        engineUsed: typeof body.engineUsed === "string" ? body.engineUsed.slice(0, 128) : "dgx-multipass",
        passes: Array.isArray(body.passes) ? body.passes.slice(0, 50) : [],
        pages: Array.isArray(body.pages) ? body.pages.slice(0, 200) : [],
        vlmFieldCount: vlmFields.length,
        documentType: parseDocumentType(body.documentType),
        review: parseReview(body.review),
        textTruncated: capped.truncated,
      }),
    });
    extractionRepo.insertFields(extraction.id, fields);

    jobRepo.markCompleted(job.id);
    documentRepo.updateStatus(job.document_id, "extracted");

    return res.status(201).json({
      document: documentRepo.getById(job.document_id),
      job: jobRepo.getById(job.id),
      extraction: extractionRepo.getFullResult(extraction.id),
    });
  } catch (err: any) {
    console.error("Job result ingestion error:", err);
    return res.status(500).json({ error: err?.message || "Failed to ingest job result" });
  }
});

// Multer/upload errors (bad mime type, oversized file) land here rather than
// crashing the process or falling through to the SPA catch-all.
app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (!err) {
    return next();
  }
  console.error("Upload middleware error:", err);
  return res.status(400).json({ error: err?.message || "Upload failed" });
});


/**
 * Start Express server with validated environment, port-collision diagnostics,
 * and graceful SIGINT/SIGTERM shutdown (Stage 6 lifecycle contract).
 */
async function startServer(options?: {
  envSource?: NodeJS.ProcessEnv;
  exitFn?: (code: number) => void;
}): Promise<{ config: LoadedEnvConfig; httpServer: import("http").Server }> {
  const exitFn = options?.exitFn ?? ((code: number) => process.exit(code));
  const envSource = options?.envSource ?? process.env;

  let config: LoadedEnvConfig;
  try {
    config = loadAndValidateEnv(envSource);
  } catch (err) {
    if (err instanceof EnvValidationError) {
      console.error(`[OCRD] ${err.message}`);
      exitFn(err.exitCode);
      throw err;
    }
    throw err;
  }

  const { createServer: createHttpServer } = await import("http");
  const httpServer = createHttpServer(app);

  if (config.nodeEnv !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    // Express 5 (path-to-regexp v8) rejects a bare "*" wildcard route at
    // registration time -- "Missing parameter name at index 1: *" -- which
    // means production mode could never actually start a server; it threw
    // before the first request. "/*splat" is the Express 5 equivalent
    // (named wildcard, matches all remaining path segments).
    app.get("/*splat", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  if (process.env.OCRDOCS_PURGE_UNVERIFIED === "true") {
    const r = importService.purgeUnverified();
    console.log(`[OCRD] purge-unverified: checked ${r.checked} imported document(s), removed ${r.purged}, re-queued ${r.requeued}`);
  }

  // 24/7 drain: every OCRDOCS_QUEUE_POLL_SECONDS, clean + import whatever sits in the queued root.
  let queueTimer: NodeJS.Timeout | undefined;
  if (process.env.OCRDOCS_QUEUE_WATCH === "true") {
    let draining = false;
    const pollMs = (Number(process.env.OCRDOCS_QUEUE_POLL_SECONDS) || 30) * 1000;
    const drain = async () => {
      if (draining) return;
      draining = true;
      try {
        const id = importService.stageQueuedRoot();
        if (!id) return;
        const run = await importService.runPreParse(id);
        if (!run.ok) {
          importService.failImport(id, run.stderr, run.code);
          console.error(`[OCRD] queue import ${id} failed: ${run.stderr.slice(0, 500)}`);
          return;
        }
        const { jobIds } = await importService.finalize(id);
        console.log(`[OCRD] queue import ${id}: ${jobIds.length} job(s) enqueued`);
      } catch (err) {
        console.error("[OCRD] queue drain error:", err);
      } finally {
        draining = false;
      }
    };
    queueTimer = setInterval(drain, pollMs);
    queueTimer.unref();
  }

  const shutdownManager = createShutdownManager(
    httpServer,
    {
      shutdownTimeoutMs: config.shutdownTimeoutMs,
      drainSockets: true,
      onShutdown: async () => {
        if (queueTimer) clearInterval(queueTimer);
        closeDb();
      },
    },
    { exitFn },
  );
  shutdownManager.install();

  try {
    await listenAsync(httpServer, config.port, config.host);
  } catch (err) {
    const listenErr = err as NodeJS.ErrnoException;
    const message = formatListenError(listenErr, config.port, config.host);
    console.error(message);
    shutdownManager.uninstall();
    exitFn(1);
    throw Object.assign(new Error(message), {
      code: listenErr.code || "LISTEN_ERROR",
      exitCode: 1,
    });
  }

  console.log(
    `[OCRD] High-Throughput Server running on ${config.host}:${config.port} (env=${config.nodeEnv})`,
  );

  return { config, httpServer };
}

export {
  app,
  startServer,
  loadAndValidateEnv,
  EnvValidationError,
  formatListenError,
  listenAsync,
  createShutdownManager,
  closeDb,
};

if (process.env.NODE_ENV !== "test") {
  startServer().catch((err) => {
    const code =
      err instanceof EnvValidationError
        ? err.exitCode
        : typeof err?.exitCode === "number"
          ? err.exitCode
          : 1;
    if (!process.exitCode) {
      process.exit(code);
    }
  });
}

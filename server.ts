import express from "express";
import path from "path";
import dotenv from "dotenv";
import { createHash, timingSafeEqual } from "crypto";
import { readFile } from "fs/promises";
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
import { ServiceAvailabilityResponse, ExtractionResult } from "./src/types";
import { initDb, closeDb } from "./server/db/database";
import { createDocumentRepo } from "./server/db/repositories/documentRepo";
import { createJobRepo } from "./server/db/repositories/jobRepo";
import { createExtractionRepo } from "./server/db/repositories/extractionRepo";
import type { ExtractedField, ValidationStatus } from "./server/db/contracts";
import { upload } from "./server/middleware/upload";

const db = initDb();
const documentRepo = createDocumentRepo(db);
const jobRepo = createJobRepo(db);
const extractionRepo = createExtractionRepo(db);

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
    service: "ngx-spark-banking-ocr-engine",
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
  const allowed = ["dgx_setup.sh", "ocr_spark_engine.py", "deploy.sh", "check_dgx_codebase.sh"];
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

app.post("/api/dgx/telemetry-report", (req, res) => {
  try {
    const report = req.body;
    latestDgxTelemetryReport = {
      ...report,
      receivedAt: new Date().toISOString(),
      sourceIp: req.ip || req.headers["x-forwarded-for"] || "remote-dgx"
    };
    dgxReportHistory.unshift(latestDgxTelemetryReport);
    if (dgxReportHistory.length > 20) dgxReportHistory.pop();

    console.log(`[DGX-TELEMETRY] Received E2E codebase audit report from ${latestDgxTelemetryReport.hostname || "unknown host"} (${latestDgxTelemetryReport.currentUser})`);
    
    return res.json({
      status: "received",
      message: "DGX E2E codebase report successfully received and analyzed by Remix Engine.",
      timestamp: latestDgxTelemetryReport.receivedAt,
      hostname: latestDgxTelemetryReport.hostname,
      inputFilesCount: latestDgxTelemetryReport.inputFilesCount,
      pythonDiagnostics: latestDgxTelemetryReport.pythonDiagnostics
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
      "You are the Senior NGX Spark & Australian Banking OCR Systems Architect. " +
      "You specialize in enterprise OCR pipelines, PySpark on NVIDIA DGX/NGX GPU clusters, " +
      "VRAM throttling, CUDA stream concurrency, DuckDB integration, APRA banking regulatory formats, " +
      "and ultra-high recall typo-tolerant regex extraction across Australian mortgage, credit card, " +
      "and KYC banking application forms. Give clear, production-grade technical guidance with code snippets.";

    const response = await ai.models.generateContent({
      model: "gemini-3.8-flash",
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

    const fields = extractBankFieldsFromText(text).map(toExtractedField);
    const extraction = extractionRepo.createExtraction({
      documentId: document.id,
      rawText: text,
      extractionVersion: 1,
      extractionJson: JSON.stringify({ engineUsed: "native-pdf-text" }),
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
  });
});

// DGX worker endpoints (pull model): the worker polls for claimed jobs rather
// than the server pushing to it, so the DGX box needs no inbound network
// exposure. All three require a shared-secret bearer token.
app.get("/api/jobs/claim", requireWorkerAuth, (_req, res) => {
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
    const fields = extractBankFieldsFromText(rawText).map(toExtractedField);
    const extraction = extractionRepo.createExtraction({
      documentId: job.document_id,
      rawText,
      extractionVersion: 1,
      extractionJson: JSON.stringify({
        engineUsed: typeof body.engineUsed === "string" ? body.engineUsed : "dgx-multipass",
        passes: Array.isArray(body.passes) ? body.passes : [],
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
      console.error(`[NGX-CORE] ${err.message}`);
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
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const shutdownManager = createShutdownManager(
    httpServer,
    {
      shutdownTimeoutMs: config.shutdownTimeoutMs,
      drainSockets: true,
      onShutdown: async () => {
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
    `[NGX-CORE] High-Throughput Server running on ${config.host}:${config.port} (env=${config.nodeEnv})`,
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

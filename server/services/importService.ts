/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Stage 5 — batch import service (the `ocr.local` workflow).
 *
 * Flow:
 *   1. stageImport  — accept a set of uploaded files (or a server-local folder)
 *      and copy every ACCEPTED file (single source of truth: the extension/MIME
 *      allow-list in server/middleware/upload.ts) into <QUEUED_DIR>/<importId>/.
 *   2. runPreParse  — run OCRDOCS_PREPARSE_SCRIPT with the staged dir as $1
 *      (TARGET_DIR). The script cleans/flatten/dedups/extracts archives in place.
 *   3. finalize     — on exit 0, rename the staged dir into <PARSED_DIR>/<ts>,
 *      then enqueue one OCR job per surviving file (reusing documentRepo +
 *      jobRepo, so content-hash dedup and job leasing are identical to a single
 *      POST /api/documents upload).
 *
 * The pre-parse script is launched through OCRDOCS_PREPARSE_SHELL ("node" for
 * tests, "wsl" on Windows, "bash"/"linux" on POSIX) so the same code path is
 * exercised in CI and on the gx10 host. createImportService is side-effect-free
 * at construction (no filesystem writes here), so it is safe to instantiate at
 * module scope the way createDocumentRepo/identityService are.
 */

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { spawn } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, extname, join } from "node:path";
import type { DocumentRepo } from "../db/repositories/documentRepo";
import type { JobRepo } from "../db/repositories/jobRepo";
import { DEFAULT_FILE_SIZE_LIMIT, SUPPORTED_EXTENSIONS } from "../middleware/upload";

export type PreparseShell = "node" | "bash" | "wsl";

export interface ImportConfig {
  /** Repositories (the module-scope instances from server.ts). */
  documentRepo: DocumentRepo;
  jobRepo: JobRepo;
  /** The `queued` staging root. */
  queuedDir: string;
  /** The `parsed` output root. */
  parsedDir: string;
  /** Path to pre-parse.sh (or a test stub). */
  preparseScript: string;
  /** How to launch it. */
  preparseShell: PreparseShell;
  /** Per-batch caps. */
  maxFiles: number;
  maxTotalMb: number;
}

/** A multer-processed upload file descriptor (mirrors Express.Multer.File). */
export interface UploadedFile {
  path: string;
  originalname: string;
  mimetype: string;
  size: number;
}

export interface ImportManifest {
  importId: string;
  stagedDir: string;
  files: Array<{ name: string; size: number }>;
  status: "staged";
}

export interface ImportRecord {
  importId: string;
  stagedDir: string;
  status: "staged" | "parsed" | "failed";
  parsedDir?: string;
  jobIds?: string[];
  stdout?: string;
  stderr?: string;
  code?: number | null;
}

export interface PreparseResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number | null;
}

export interface FinalizeResult {
  parsedDir: string;
  jobIds: string[];
}

/** Single source of MIME truth for staging (mirrors upload.ts allow-list). */
const EXT_TO_MIME: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  tif: "image/tiff",
  tiff: "image/tiff",
  bmp: "image/bmp",
  webp: "image/webp",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  rtf: "application/rtf",
  xml: "application/xml",
  txt: "text/plain",
  json: "application/json",
};

function mimeFor(name: string): string {
  const ext = extname(name).toLowerCase().replace(/^\./, "");
  return EXT_TO_MIME[ext] || "application/octet-stream";
}

/** Reuses the single accept/reject decision from upload.ts:uploadFilter. */
export function isAccepted(originalname: string, size: number): boolean {
  const ext = extname(originalname).toLowerCase().replace(/^\./, "");
  if (!ext || !SUPPORTED_EXTENSIONS.has(ext)) {
    return false;
  }
  if (size > DEFAULT_FILE_SIZE_LIMIT) {
    return false;
  }
  return true;
}

const IMPORT_ID_RE = /^[a-z0-9]+-[a-z0-9]{6}$/;

function newImportId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createImportService(cfg: ImportConfig) {
  const registryDir = join(cfg.queuedDir, ".imports");

  function ensureDirs(): void {
    mkdirSync(cfg.queuedDir, { recursive: true });
    mkdirSync(cfg.parsedDir, { recursive: true });
    mkdirSync(registryDir, { recursive: true });
  }

  function recordPath(importId: string): string {
    if (!IMPORT_ID_RE.test(importId)) {
      throw new Error("invalid import id");
    }
    return join(registryDir, `${importId}.json`);
  }

  function writeRecord(rec: ImportRecord): void {
    ensureDirs();
    writeFileSync(recordPath(rec.importId), JSON.stringify(rec, null, 2), "utf-8");
  }

  async function stageImport(params: {
    files?: UploadedFile[];
    folder?: string;
  }): Promise<ImportManifest> {
    if (!params.files && !params.folder) {
      throw new Error("stageImport requires 'files' or 'folder'");
    }
    if (params.folder && !existsSync(params.folder)) {
      throw new Error(`source folder not found: ${params.folder}`);
    }

    ensureDirs();
    const importId = newImportId();
    const stagedDir = join(cfg.queuedDir, importId);
    mkdirSync(stagedDir, { recursive: true });

    const accepted: Array<{ name: string; size: number }> = [];
    let totalBytes = 0;
    let kept = 0;

    const acceptAndCopy = (srcPath: string, originalname: string) => {
      const size = statSync(srcPath).size;
      if (!isAccepted(originalname, size)) {
        return; // skip unsupported — mirrors upload.ts:uploadFilter (single source)
      }
      if (accepted.length >= cfg.maxFiles) {
        throw new Error(`import exceeds ${cfg.maxFiles} files`);
      }
      totalBytes += size;
      const ext = extname(originalname).toLowerCase();
      const dest = join(stagedDir, `${importId}-${kept}${ext}`);
      copyFileSync(srcPath, dest);
      accepted.push({ name: originalname, size });
      kept += 1;
    };

    if (params.folder) {
      const walk = (dir: string) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const full = join(dir, entry.name);
          if (entry.isDirectory()) {
            walk(full);
          } else if (entry.isFile()) {
            acceptAndCopy(full, entry.name);
          }
        }
      };
      walk(params.folder);
    } else if (params.files) {
      for (const f of params.files) {
        acceptAndCopy(f.path, f.originalname);
      }
    }

    if (totalBytes > cfg.maxTotalMb * 1024 * 1024) {
      rmSync(stagedDir, { recursive: true, force: true });
      throw new Error(`import exceeds ${cfg.maxTotalMb} MB total`);
    }

    writeRecord({ importId, stagedDir, status: "staged" });
    return { importId, stagedDir, files: accepted, status: "staged" };
  }

  function getRecord(importId: string): ImportRecord {
    const p = recordPath(importId);
    if (!existsSync(p)) {
      return { importId, stagedDir: "", status: "failed" };
    }
    return JSON.parse(readFileSync(p, "utf-8")) as ImportRecord;
  }

  function runPreParse(importId: string): Promise<PreparseResult> {
    const manifest = getRecord(importId);
    if (manifest.status !== "staged" || !manifest.stagedDir) {
      return Promise.resolve({
        ok: false,
        stdout: "",
        stderr: `import ${importId} is not staged`,
        code: null,
      });
    }
    return new Promise((resolve) => {
      if (!existsSync(cfg.preparseScript)) {
        resolve({
          ok: false,
          stdout: "",
          stderr: `pre-parse script not found: ${cfg.preparseScript}`,
          code: null,
        });
        return;
      }
      let cmd: string;
      let args: string[];
      if (cfg.preparseShell === "node") {
        cmd = process.execPath;
        args = [cfg.preparseScript, manifest.stagedDir];
      } else if (cfg.preparseShell === "wsl") {
        cmd = "wsl";
        args = ["bash", cfg.preparseScript, manifest.stagedDir];
      } else {
        cmd = "bash";
        args = [cfg.preparseScript, manifest.stagedDir];
      }
      const proc = spawn(cmd, args, { env: { ...process.env } });
      let stdout = "";
      let stderr = "";
      proc.stdout.on("data", (d) => (stdout += d.toString()));
      proc.stderr.on("data", (d) => (stderr += d.toString()));
      proc.on("error", (err) => {
        resolve({ ok: false, stdout, stderr: String((err as Error).message), code: null });
      });
      proc.on("close", (code) => {
        resolve({ ok: code === 0, stdout, stderr, code });
      });
    });
  }

  /** Streaming sha256: never holds a whole (up to 50 MB) file in memory. */
  function hashFile(path: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const h = createHash("sha256");
      createReadStream(path)
        .on("data", (d) => h.update(d))
        .on("error", reject)
        .on("end", () => resolve(h.digest("hex")));
    });
  }

  async function finalize(importId: string): Promise<FinalizeResult> {
    const manifest = getRecord(importId);
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const parsedDir = join(cfg.parsedDir, ts);
    // The pre-parse script leaves its cleaned output in-place in stagedDir, so
    // "parsed" is just the staged dir relocated under the parsed root. We rename
    // (not mkdir-then-rename): fs.rename creates parsedDir from cfg.parsedDir
    // (already ensured by stageImport's ensureDirs), and renaming onto an
    // existing dir throws EEXIST on Windows.
    renameSync(manifest.stagedDir, parsedDir);
    // Record the move immediately so a crash mid-enqueue never orphans the dir.
    writeRecord({ importId, stagedDir: parsedDir, status: "parsed", parsedDir, jobIds: [] });

    const jobIds: string[] = [];
    for (const entry of readdirSync(parsedDir)) {
      const full = join(parsedDir, entry);
      if (!statSync(full).isFile()) {
        continue;
      }
      // Re-apply the accept filter: pre-parse output may contain files the
      // engine can't OCR (e.g. extracted binaries) or empty leftovers.
      if (!isAccepted(entry, statSync(full).size)) {
        continue;
      }
      // Content-hash dedup mirrors POST /api/documents: identical bytes must
      // not create a second document row or a second OCR job.
      // Awaiting a stream read yields to the event loop between files, so a 30k-file batch cannot freeze the server.
      let hash: string;
      try {
        hash = await hashFile(full);
      } catch {
        continue; // unreadable file: skip it, don't fail the whole batch
      }
      const existing = cfg.documentRepo.getByContentHash(hash);
      if (existing) {
        continue;
      }
      const document = cfg.documentRepo.insert({
        filename: entry,
        originalPath: full,
        contentHash: hash,
        mimeType: mimeFor(entry),
      });
      const job = cfg.jobRepo.enqueue({ documentId: document.id });
      jobIds.push(job.id);
    }

    writeRecord({
      importId,
      stagedDir: parsedDir,
      status: "parsed",
      parsedDir,
      jobIds,
    });
    return { parsedDir, jobIds };
  }

  function failImport(importId: string, stderr: string, code: number | null): void {
    const rec = getRecord(importId);
    writeRecord({
      ...rec,
      importId,
      stagedDir: rec.stagedDir || "",
      status: "failed",
      stderr,
      code,
    });
  }

  function listRecords(): ImportRecord[] {
    if (!existsSync(registryDir)) {
      return [];
    }
    return readdirSync(registryDir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(".json"))
      .map((e) => JSON.parse(readFileSync(join(registryDir, e.name), "utf-8")) as ImportRecord)
      .sort((a, b) => b.stagedDir.localeCompare(a.stagedDir));
  }

  /**
   * 24/7 queue drain: move everything loose in the queued root (any file type,
   * archives included) into a fresh staged dir, so pre-parse can clean it.
   * Skips in-flight API stages, the registry, and files still being written.
   */
  function stageQueuedRoot(settleMs = 10_000): string | null {
    if (!existsSync(cfg.queuedDir)) {
      return null;
    }
    ensureDirs();
    const now = Date.now();
    const pick: string[] = [];
    for (const entry of readdirSync(cfg.queuedDir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || (entry.isDirectory() && IMPORT_ID_RE.test(entry.name))) {
        continue;
      }
      const full = join(cfg.queuedDir, entry.name);
      if (now - statSync(full).mtimeMs < settleMs) {
        continue;
      }
      pick.push(full);
    }
    if (pick.length === 0) {
      return null;
    }
    const importId = newImportId();
    const stagedDir = join(cfg.queuedDir, importId);
    mkdirSync(stagedDir, { recursive: true });
    pick.forEach((src, i) => renameSync(src, join(stagedDir, `${i}_${basename(src)}`)));
    writeRecord({ importId, stagedDir, status: "staged" });
    return importId;
  }

  return { stageQueuedRoot, stageImport, runPreParse, finalize, failImport, getRecord, listRecords };
}

export { EXT_TO_MIME };

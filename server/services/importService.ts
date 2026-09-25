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
import { closeSync, createReadStream, openSync, readSync } from "node:fs";
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
import { basename, extname, join, relative as relativePath } from "node:path";
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
  /** Optional browser/server-relative source path, used only for provenance. */
  sourcePath?: string;
}

export interface ImportManifest {
  importId: string;
  /** Disposable derived work tree that pre-parse may flatten/rename. */
  stagedDir: string;
  /** Immutable byte-for-byte intake snapshot. */
  sourceDir: string;
  files: Array<{ name: string; size: number; relativePath: string }>;
  limitExceeded?: boolean;
  status: "staged";
}

export interface ImportRecord {
  importId: string;
  /** Alias for the derived work tree (kept for API compatibility). */
  stagedDir: string;
  sourceDir: string;
  quarantineDir: string;
  manifestDir: string;
  status: "staged" | "parsed" | "failed";
  parsedDir?: string;
  jobIds?: string[];
  stdout?: string;
  stderr?: string;
  code?: number | null;
  /** Private, batch-relative source associations. */
  sourceFiles?: Array<{ relativePath: string; name: string; size: number; sha256?: string; outcome?: string }>;
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
/** Side folders pre-parse writes next to a work dir: never new work. */
const IMPORT_SIDE_DIR_RE = /^[a-z0-9]+-[a-z0-9]{6}\.(source|quarantine|manifests|unsupported|failed|unverified)$/;

/**
 * True when the file's leading bytes actually look like what its extension claims. A real batch contained
 * ~2,300 files named .png/.jpg/.json/.xml/.txt whose content was random bytes (packed/encrypted app resources):
 * they can never be OCR'd, and the text-typed ones would be "extracted" as garbage that can fake ABN/BSB hits.
 */
export function verifyContent(path: string, ext: string): boolean {
  let head: Buffer;
  try {
    const fd = openSync(path, "r");
    try {
      head = Buffer.alloc(4096);
      const n = readSync(fd, head, 0, 4096, 0);
      head = head.subarray(0, n);
    } finally {
      closeSync(fd);
    }
  } catch {
    return false;
  }
  if (head.length === 0) return false;
  const startsWith = (sig: number[]) => sig.every((b, i) => head[i] === b);
  const ascii = (from: number, s: string) => head.subarray(from, from + s.length).toString("latin1") === s;
  // UTF-16 with a BOM (Windows tools write XML/text this way) legitimately contains NUL bytes: decode it first.
  const utf16LE = head.length >= 2 && head[0] === 0xff && head[1] === 0xfe;
  const utf16BE = head.length >= 2 && head[0] === 0xfe && head[1] === 0xff;
  const decoded = (): string => {
    if (utf16LE) return head.subarray(2, head.length - (head.length % 2)).toString("utf16le");
    if (utf16BE) {
      const be = Buffer.from(head.subarray(2, head.length - (head.length % 2)));
      return be.swap16().toString("utf16le");
    }
    return head.toString("utf8");
  };
  const text = () => {
    if (!utf16LE && !utf16BE && head.includes(0)) return false;
    const str = decoded();
    if (str.length === 0) return false;
    let printable = 0;
    let latin = 0;
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      if (c === 9 || c === 10 || c === 13 || (c >= 32 && c !== 0xfffd)) printable++;
      if (c < 0x250) latin++;
    }
    // Random bytes decoded as UTF-16 come out as "printable" CJK noise; English documents are overwhelmingly Latin-range.
    if ((utf16LE || utf16BE) && latin / str.length < 0.9) return false;
    return printable / str.length >= 0.95;
  };
  const stripped = () => decoded().replace(/^﻿/, "").trimStart();
  switch (ext.toLowerCase().replace(/^\./, "")) {
    case "png": return startsWith([0x89, 0x50, 0x4e, 0x47]);
    case "jpg": case "jpeg": return startsWith([0xff, 0xd8, 0xff]);
    case "bmp": return ascii(0, "BM");
    case "tif": case "tiff": return startsWith([0x49, 0x49, 0x2a, 0x00]) || startsWith([0x4d, 0x4d, 0x00, 0x2a]);
    case "webp": return ascii(0, "RIFF") && ascii(8, "WEBP");
    case "pdf": return head.subarray(0, 1024).includes(Buffer.from("%PDF"));
    case "docx": return startsWith([0x50, 0x4b]);
    case "rtf": return stripped().startsWith("{\\rtf");
    case "json": return text() && /^[\[{"\d\-tfn]/.test(stripped());
    case "xml": return text() && stripped().startsWith("<");
    case "txt": return text();
    default: return false;
  }
}

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

  function safeRelativePath(value: string | undefined, fallback: string): string {
    const raw = String(value || fallback).replace(/\\/g, "/");
    const parts = raw.split("/").filter((part) => part && part !== "." && part !== "..");
    return parts.length ? parts.join("/") : fallback.replace(/[^A-Za-z0-9._-]/g, "_");
  }

  function uniqueFilePath(dir: string, relative: string): string {
    const direct = join(dir, relative);
    if (!existsSync(direct)) return direct;
    const parsed = relative.split("/");
    const name = parsed.pop() || "file";
    const dot = name.lastIndexOf(".");
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : "";
    let index = 1;
    let candidate = join(dir, ...parsed, `${stem}~${index}${ext}`);
    while (existsSync(candidate)) {
      index += 1;
      candidate = join(dir, ...parsed, `${stem}~${index}${ext}`);
    }
    return candidate;
  }

  function writeIntake(manifestDir: string, entry: Record<string, unknown>): void {
    mkdirSync(manifestDir, { recursive: true });
    const file = join(manifestDir, "intake.jsonl");
    // Append synchronously: the intake ledger is the audit record for a batch
    // whose derived work tree may later be moved or quarantined.
    const existing = existsSync(file) ? readFileSync(file, "utf8") : "";
    writeFileSync(file, existing + JSON.stringify(entry) + "\n", "utf8");
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
    // Work is disposable. Source is an immutable intake snapshot. Quarantine
    // and manifests sit beside both so cleanup can never delete the only copy.
    const stagedDir = join(cfg.queuedDir, importId);
    const sourceDir = join(cfg.queuedDir, `${importId}.source`);
    const quarantineDir = join(cfg.queuedDir, `${importId}.quarantine`);
    const manifestDir = join(cfg.queuedDir, `${importId}.manifests`);
    for (const dir of [stagedDir, sourceDir, quarantineDir, manifestDir]) {
      mkdirSync(dir, { recursive: true });
    }

    const accepted: Array<{ name: string; size: number; relativePath: string }> = [];
    const sourceFiles: Array<{ relativePath: string; name: string; size: number; outcome: string }> = [];
    let totalBytes = 0;
    let kept = 0;

    const acceptAndCopy = (srcPath: string, originalname: string, sourcePath?: string) => {
      const size = statSync(srcPath).size;
      const relative = safeRelativePath(sourcePath, originalname);
      const sourceDest = uniqueFilePath(sourceDir, relative);
      mkdirSync(join(sourceDest, ".."), { recursive: true });
      copyFileSync(srcPath, sourceDest);
      const sha256 = createHash("sha256").update(readFileSync(srcPath)).digest("hex");

      if (!isAccepted(originalname, size)) {
        const q = uniqueFilePath(join(quarantineDir, "unsupported"), relative);
        mkdirSync(join(q, ".."), { recursive: true });
        copyFileSync(srcPath, q);
        sourceFiles.push({ relativePath: relative, name: originalname, size, outcome: "unsupported" });
        writeIntake(manifestDir, { importId, relativePath: relative, size, sha256, outcome: "unsupported" });
        return;
      }
      if (accepted.length >= cfg.maxFiles || totalBytes + size > cfg.maxTotalMb * 1024 * 1024) {
        const q = uniqueFilePath(join(quarantineDir, "limit"), relative);
        mkdirSync(join(q, ".."), { recursive: true });
        copyFileSync(srcPath, q);
        sourceFiles.push({ relativePath: relative, name: originalname, size, outcome: "limit" });
        writeIntake(manifestDir, { importId, relativePath: relative, size, sha256, outcome: "limit" });
        return;
      }
      const ext = extname(originalname).toLowerCase();
      const workDest = join(stagedDir, `${importId}-${kept}${ext}`);
      copyFileSync(srcPath, workDest);
      accepted.push({ name: originalname, size, relativePath: relative });
      sourceFiles.push({ relativePath: relative, name: originalname, size, outcome: "accepted" });
      writeIntake(manifestDir, { importId, relativePath: relative, size, sha256, outcome: "accepted" });
      totalBytes += size;
      kept += 1;
    };

    if (params.folder) {
      const walk = (dir: string) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const full = join(dir, entry.name);
          if (entry.isDirectory()) {
            walk(full);
          } else if (entry.isFile()) {
            acceptAndCopy(full, entry.name, relativePath(params.folder!, full));
          }
        }
      };
      walk(params.folder);
    } else if (params.files) {
      for (const f of params.files) {
        acceptAndCopy(f.path, f.originalname, f.sourcePath);
      }
    }

    const record: ImportRecord = {
      importId,
      stagedDir,
      sourceDir,
      quarantineDir,
      manifestDir,
      status: "staged",
      sourceFiles,
    };
    writeRecord(record);
    return {
      importId,
      stagedDir,
      sourceDir,
      files: accepted,
      limitExceeded: sourceFiles.some((entry) => entry.outcome === "limit"),
      status: "staged",
    };
  }

  function getRecord(importId: string): ImportRecord {
    const p = recordPath(importId);
    if (!existsSync(p)) {
      return {
        importId,
        stagedDir: "",
        sourceDir: "",
        quarantineDir: "",
        manifestDir: "",
        status: "failed",
      };
    }
    const parsed = JSON.parse(readFileSync(p, "utf-8")) as Partial<ImportRecord>;
    const stagedDir = parsed.stagedDir || "";
    return {
      importId,
      stagedDir,
      sourceDir: parsed.sourceDir || `${stagedDir}.source`,
      quarantineDir: parsed.quarantineDir || `${stagedDir}.quarantine`,
      manifestDir: parsed.manifestDir || `${stagedDir}.manifests`,
      status: parsed.status || "failed",
      parsedDir: parsed.parsedDir,
      jobIds: parsed.jobIds,
      stdout: parsed.stdout,
      stderr: parsed.stderr,
      code: parsed.code,
      sourceFiles: parsed.sourceFiles,
    };
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
        args = [cfg.preparseScript, manifest.stagedDir, manifest.stagedDir];
      } else if (cfg.preparseShell === "wsl") {
        cmd = "wsl";
        args = ["bash", cfg.preparseScript, manifest.stagedDir, manifest.stagedDir];
      } else {
        cmd = "bash";
        args = [cfg.preparseScript, manifest.stagedDir, manifest.stagedDir];
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
    writeRecord({
      importId,
      stagedDir: parsedDir,
      sourceDir: manifest.sourceDir,
      quarantineDir: manifest.quarantineDir,
      manifestDir: manifest.manifestDir,
      status: "parsed",
      parsedDir,
      jobIds: [],
      sourceFiles: manifest.sourceFiles,
    });
    // Keep the immutable source snapshot, quarantine evidence, and manifests
    // with the batch they came from, out of the OCR queue root.
    for (const suffix of [".source", ".quarantine", ".manifests", ".unsupported", ".failed", ".unverified"]) {
      const side = `${manifest.stagedDir}${suffix}`;
      if (existsSync(side)) {
        renameSync(side, `${parsedDir}${suffix}`);
      }
    }

    const jobIds: string[] = [];
    for (const entry of readdirSync(parsedDir)) {
      const full = join(parsedDir, entry);
      if (!statSync(full).isFile()) {
        continue;
      }
      // Re-apply the accept filter: pre-parse output may contain files the
      // engine can't OCR (e.g. extracted binaries) or empty leftovers. Set
      // them aside instead of silently dropping the evidence.
      if (!isAccepted(entry, statSync(full).size)) {
        const aside = `${parsedDir}.quarantine/unsupported`;
        mkdirSync(aside, { recursive: true });
        renameSync(full, uniqueFilePath(aside, entry));
        continue;
      }
      // Extension claims a type the bytes don't have: set it aside rather than queue an OCR job that must fail.
      if (!verifyContent(full, extname(entry))) {
        const aside = `${parsedDir}.unverified`;
        mkdirSync(aside, { recursive: true });
        renameSync(full, join(aside, entry));
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
      const inserted = cfg.documentRepo.insertDeduped({
        filename: entry,
        originalPath: full,
        contentHash: hash,
        mimeType: mimeFor(entry),
      });
      if (!inserted.inserted) continue;
      const document = inserted.document;
      const job = cfg.jobRepo.enqueue({ documentId: document.id });
      jobIds.push(job.id);
    }

    writeRecord({
      importId,
      stagedDir: parsedDir,
      sourceDir: manifest.sourceDir,
      quarantineDir: manifest.quarantineDir,
      manifestDir: manifest.manifestDir,
      status: "parsed",
      parsedDir,
      jobIds,
      sourceFiles: manifest.sourceFiles,
    });
    return { parsedDir, jobIds };
  }

  /**
   * One-shot safety audit for documents that live under the parsed root but
   * fail structural verification. It never deletes a row or a byte: the file
   * stays at its stable original_path, the document is marked failed for human
   * review, and the count is reported to the operator.
   */
  function purgeUnverified(): { checked: number; purged: number; requeued: number } {
    let checked = 0;
    let purged = 0;
    let requeued = 0;
    const root = cfg.parsedDir.replace(/[\\/]+$/, "");
    for (const doc of cfg.documentRepo.getAll()) {
      if (!doc.original_path.startsWith(root)) continue;
      checked++;
      if (!existsSync(doc.original_path)) continue;
      if (verifyContent(doc.original_path, extname(doc.original_path))) continue;
      // Keep the evidence and the document row. Moving it would break the
      // document file route; deleting it would destroy the only source copy.
      cfg.documentRepo.updateStatus(doc.id, "failed");
      purged++;
    }
    return { checked, purged, requeued };
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

  function copyTreeSnapshot(src: string, dest: string): void {
    const st = statSync(src);
    if (st.isDirectory()) {
      mkdirSync(dest, { recursive: true });
      for (const entry of readdirSync(src, { withFileTypes: true })) {
        copyTreeSnapshot(join(src, entry.name), join(dest, entry.name));
      }
    } else if (st.isFile()) {
      mkdirSync(join(dest, ".."), { recursive: true });
      copyFileSync(src, dest);
    }
  }

  /**
   * 24/7 queue drain: claim aged top-level entries into a disposable work
   * tree, while keeping a byte-for-byte source snapshot beside it. A folder is
   * moved only as a unit after its mtime has settled; all later flattening or
   * quarantine happens exclusively in the work tree.
   */
  function stageQueuedRoot(settleMs = 10_000): string | null {
    if (!existsSync(cfg.queuedDir)) {
      return null;
    }
    ensureDirs();
    const now = Date.now();
    const pick: string[] = [];
    for (const entry of readdirSync(cfg.queuedDir, { withFileTypes: true })) {
      if (
        entry.name.startsWith(".") ||
        (entry.isDirectory() && (IMPORT_ID_RE.test(entry.name) || IMPORT_SIDE_DIR_RE.test(entry.name)))
      ) {
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
    const sourceDir = join(cfg.queuedDir, `${importId}.source`);
    const quarantineDir = join(cfg.queuedDir, `${importId}.quarantine`);
    const manifestDir = join(cfg.queuedDir, `${importId}.manifests`);
    for (const dir of [stagedDir, sourceDir, quarantineDir, manifestDir]) {
      mkdirSync(dir, { recursive: true });
    }
    const sourceFiles: Array<{ relativePath: string; name: string; size: number; outcome: string }> = [];
    pick.forEach((src, i) => {
      const name = `${i}_${basename(src)}`;
      const workPath = join(stagedDir, name);
      const sourcePath = join(sourceDir, name);
      renameSync(src, workPath);
      copyTreeSnapshot(workPath, sourcePath);
      const walkFiles = (dir: string, rel: string) => {
        if (!statSync(dir).isDirectory()) {
          sourceFiles.push({ relativePath: rel, name: basename(rel), size: statSync(dir).size, outcome: "queued" });
          return;
        }
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const full = join(dir, entry.name);
          const nextRel = rel ? `${rel}/${entry.name}` : entry.name;
          if (entry.isDirectory()) walkFiles(full, nextRel);
          else if (entry.isFile()) {
            sourceFiles.push({ relativePath: nextRel, name: entry.name, size: statSync(full).size, outcome: "queued" });
          }
        }
      };
      walkFiles(workPath, name);
    });
    writeRecord({
      importId,
      stagedDir,
      sourceDir,
      quarantineDir,
      manifestDir,
      status: "staged",
      sourceFiles,
    });
    return importId;
  }

  return { purgeUnverified, stageQueuedRoot, stageImport, runPreParse, finalize, failImport, getRecord, listRecords };
}

export { EXT_TO_MIME };

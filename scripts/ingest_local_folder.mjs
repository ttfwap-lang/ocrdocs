#!/usr/bin/env node
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Upload a local folder to the running ocr.local service through the same
 * snapshot/flatten/quarantine pipeline used by the browser's Upload Folder
 * button. Files are sent in bounded multipart batches; the server, not this
 * script, owns the immutable source snapshot and cleanup decisions.
 *
 * Usage:
 *   node scripts/ingest_local_folder.mjs [folder] [--server-url=http://localhost:3000] [--dry-run]
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, extname, join, relative } from 'node:path';

const ALLOWED_EXTENSIONS = new Set([
  '.pdf', '.png', '.jpg', '.jpeg', '.tif', '.tiff', '.bmp', '.webp',
  '.docx', '.rtf', '.xml', '.txt', '.json',
]);
const MIME_BY_EXT = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.bmp': 'image/bmp',
  '.webp': 'image/webp',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.rtf': 'application/rtf',
  '.xml': 'application/xml',
  '.txt': 'text/plain',
  '.json': 'application/json',
};
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const BATCH_BYTES = 100 * 1024 * 1024;

function parseArgs(argv) {
  const args = { folder: null, serverUrl: 'http://localhost:3000', dryRun: false };
  for (const arg of argv) {
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg.startsWith('--server-url=')) args.serverUrl = arg.slice('--server-url='.length).replace(/\/$/, '');
    else if (!arg.startsWith('--')) args.folder = arg;
  }
  return args;
}

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    console.error(`[!] Cannot read a directory: ${error.message}`);
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

async function uploadBatch(serverUrl, root, files) {
  const form = new FormData();
  const paths = [];
  for (const file of files) {
    const ext = extname(file.path).toLowerCase();
    const bytes = await readFile(file.path);
    if (bytes.length > MAX_FILE_BYTES) {
      throw new Error(`file exceeds the 50 MB upload limit: ${file.relativePath}`);
    }
    form.append('files', new Blob([bytes], { type: MIME_BY_EXT[ext] || 'application/octet-stream' }), basename(file.path));
    paths.push(file.relativePath);
  }
  form.append('paths', JSON.stringify(paths));
  const response = await fetch(`${serverUrl}/api/documents/batch`, { method: 'POST', body: form });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const folder = args.folder || 'C:\\Users\\lnxzf\\Desktop\\Recovered_C';
  let rootStat;
  try {
    rootStat = await stat(folder);
  } catch {
    console.error(`[!] Folder not found: ${folder}`);
    process.exitCode = 1;
    return;
  }
  if (!rootStat.isDirectory()) {
    console.error('[!] The supplied folder is not a directory.');
    process.exitCode = 1;
    return;
  }

  const candidates = [];
  for await (const path of walk(folder)) {
    if (ALLOWED_EXTENSIONS.has(extname(path).toLowerCase())) {
      candidates.push({ path, relativePath: relative(folder, path).replaceAll('\\', '/') });
    }
  }
  console.log(`[*] Found ${candidates.length} supported file(s) in the folder tree.`);
  if (args.dryRun) {
    console.log('[*] Dry run: no files were uploaded.');
    return;
  }

  let batches = 0;
  let accepted = 0;
  let queuedJobs = 0;
  let current = [];
  let currentBytes = 0;
  const flush = async () => {
    if (current.length === 0) return;
    const result = await uploadBatch(args.serverUrl, folder, current);
    batches += 1;
    accepted += Number(result.acceptedFiles || current.length);
    queuedJobs += Number(result.queuedJobs || 0);
    console.log(`[+] batch ${batches}: accepted ${result.acceptedFiles ?? current.length}, queued ${result.queuedJobs ?? 0}`);
    current = [];
    currentBytes = 0;
  };

  for (const file of candidates) {
    let size = 0;
    try {
      size = (await stat(file.path)).size;
    } catch (error) {
      console.error(`[!] Could not stat one candidate: ${error.message}`);
      continue;
    }
    if (size > MAX_FILE_BYTES) {
      console.error(`[!] Skipping one file over the 50 MB limit (counted as unsupported evidence).`);
      continue;
    }
    if (current.length > 0 && currentBytes + size > BATCH_BYTES) await flush();
    current.push(file);
    currentBytes += size;
  }
  await flush();
  console.log(`[*] Done. Batches: ${batches}, accepted: ${accepted}, queued OCR jobs: ${queuedJobs}.`);
  console.log('[*] Source snapshots, manifests, and quarantined material remain on the server for review.');
}

main().catch((error) => {
  console.error(`[!] Folder upload failed: ${error.message}`);
  process.exitCode = 1;
});

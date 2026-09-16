#!/usr/bin/env node
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Bulk-registers every supported file in a local folder (recursively) with
 * the running app server via the real POST /api/documents endpoint — the
 * same intake path the "Documents" tab uses.
 *
 * This is the answer to "do I copy files to the DGX box?": no. The DGX
 * worker (scripts/dgx_worker.py) pulls from the app server over HTTP; it
 * never needs local filesystem access to your machine. Register files here,
 * and any that need OCR sit in the queue until a DGX worker polls for them.
 *
 * Usage:
 *   node scripts/ingest_local_folder.mjs [folder] [--server-url=http://localhost:3000] [--dry-run]
 *
 * Defaults to the folder path the user actually wants OCR'd:
 *   C:\Users\lnxzf\Desktop\Recovered_C
 */

import { readdir, stat, readFile } from 'node:fs/promises';
import { join, extname, basename } from 'node:path';

const ALLOWED_EXTENSIONS = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.tif', '.tiff']);
const MIME_BY_EXT = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
};

function parseArgs(argv) {
  const args = { folder: null, serverUrl: 'http://localhost:3000', dryRun: false };
  for (const arg of argv) {
    if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg.startsWith('--server-url=')) {
      args.serverUrl = arg.slice('--server-url='.length).replace(/\/$/, '');
    } else if (!arg.startsWith('--')) {
      args.folder = arg;
    }
  }
  return args;
}

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    console.error(`[!] Cannot read directory ${dir}: ${err.message}`);
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (entry.isFile()) {
      yield full;
    }
  }
}

async function ingestFile(serverUrl, filePath) {
  const ext = extname(filePath).toLowerCase();
  const mimeType = MIME_BY_EXT[ext];
  const buffer = await readFile(filePath);
  const blob = new Blob([buffer], { type: mimeType });
  const formData = new FormData();
  formData.append('file', blob, basename(filePath));

  const res = await fetch(`${serverUrl}/api/documents`, { method: 'POST', body: formData });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const folder = args.folder || 'C:\\Users\\lnxzf\\Desktop\\Recovered_C';

  let rootStat;
  try {
    rootStat = await stat(folder);
  } catch {
    console.error(`[!] Folder not found: ${folder}`);
    process.exit(1);
  }
  if (!rootStat.isDirectory()) {
    console.error(`[!] Not a directory: ${folder}`);
    process.exit(1);
  }

  console.log(`[*] Scanning ${folder} for ${[...ALLOWED_EXTENSIONS].join(', ')} files...`);
  if (args.dryRun) console.log('[*] --dry-run: no files will be uploaded.');

  const candidates = [];
  for await (const filePath of walk(folder)) {
    if (ALLOWED_EXTENSIONS.has(extname(filePath).toLowerCase())) {
      candidates.push(filePath);
    }
  }

  console.log(`[*] Found ${candidates.length} candidate file(s).`);

  let succeeded = 0;
  let queued = 0;
  let failed = 0;

  for (const filePath of candidates) {
    if (args.dryRun) {
      console.log(`  would upload: ${filePath}`);
      continue;
    }
    try {
      const { status, data } = await ingestFile(args.serverUrl, filePath);
      if (status === 201) {
        succeeded++;
        console.log(`  [+] ${filePath} -> extracted immediately (native text)`);
      } else if (status === 202) {
        queued++;
        console.log(`  [~] ${filePath} -> queued for DGX OCR (${data.status})`);
      } else {
        failed++;
        console.error(`  [-] ${filePath} -> HTTP ${status}: ${data.error || 'unknown error'}`);
      }
    } catch (err) {
      failed++;
      console.error(`  [-] ${filePath} -> ${err.message} (is the app server running at ${args.serverUrl}?)`);
    }
  }

  if (!args.dryRun) {
    console.log(`\n[*] Done. Extracted: ${succeeded}, Queued for DGX OCR: ${queued}, Failed: ${failed}.`);
    if (queued > 0) {
      console.log('[*] Start scripts/dgx_worker.py on the DGX box (with OCRDOCS_SERVER_URL/DGX_WORKER_TOKEN set) to process the queued files.');
    }
  }
}

main();

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Fail fast when `dist/` is older than the sources it was built from.
 *
 * WHY THIS EXISTS
 * ---------------
 * `dist/` is a gitignored build artifact, so it survives across sessions and is invisible to
 * `git status`. Editing server.ts / src/** and then running `npm start` serves whatever was
 * built LAST, which looks exactly like "the app ignored my changes". That happened for real:
 * the timezone fix and the census cache were committed, `npm start` served the pre-fix bundle,
 * and the page appeared stuck on an old version with nothing in the working tree to explain it.
 *
 * This compares the newest source mtime against the built entrypoint and exits non-zero with a
 * plain instruction, so the cause is named instead of guessed at. It is advisory: it does not
 * rebuild (a production start should not silently do a 3-second vite build) -- it just refuses
 * to start on a stale artifact.
 *
 * Run: node scripts/check_dist_freshness.mjs
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entry = path.join(project, 'dist', 'server.cjs');

/** Directories whose contents are compiled into dist/ and so make it stale. */
const SOURCE_DIRS = ['src', 'server'];
const SOURCE_FILES = ['package.json', 'vite.config.ts', 'tsconfig.json'];
const SOURCE_EXTS = new Set(['.ts', '.tsx', '.css', '.html', '.json']);

function newestSourceMtime() {
  let newest = 0;
  let newestPath = '';
  const consider = (file) => {
    try {
      const { mtimeMs } = fs.statSync(file);
      if (mtimeMs > newest) {
        newest = mtimeMs;
        newestPath = path.relative(project, file);
      }
    } catch {
      /* unreadable file: ignore rather than fail the check */
    }
  };

  for (const dir of SOURCE_DIRS) {
    const root = path.join(project, dir);
    if (!fs.existsSync(root)) continue;
    for (const entryName of fs.readdirSync(root, { withFileTypes: true })) {
      const full = path.join(root, entryName.name);
      if (entryName.isDirectory()) {
        for (const nested of fs.readdirSync(full, { withFileTypes: true })) {
          if (nested.isFile() && SOURCE_EXTS.has(path.extname(nested.name))) consider(path.join(full, nested.name));
        }
      } else if (SOURCE_EXTS.has(path.extname(entryName.name))) {
        consider(full);
      }
    }
  }
  for (const name of SOURCE_FILES) consider(path.join(project, name));
  return { newest, newestPath };
}

if (!fs.existsSync(entry)) {
  console.error('[dist] NOT BUILT. Run:  npm run build');
  process.exit(1);
}

const builtAt = fs.statSync(entry).mtimeMs;
const { newest, newestPath } = newestSourceMtime();

if (newest > builtAt) {
  console.error('[dist] STALE BUILD -- the app would serve an old version.\n');
  console.error(`  newest source : ${newestPath}`);
  console.error(`  built         : ${path.relative(project, entry)}`);
  console.error('\n  Run:  npm run build      then restart.');
  process.exit(1);
}

console.log('[dist] up to date');

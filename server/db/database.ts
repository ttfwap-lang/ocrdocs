/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 1 — SQLite database initialisation with WAL mode and graceful shutdown.
 * Opens a single shared connection; callers import `db` directly or use `initDb()`.
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import type { Database as DatabaseType } from 'better-sqlite3';
import { runMigrations } from './migrations/001_initial_schema';
import { runMigrations as runMedicareMigrations } from './migrations/002_medicare_index';

const DB_PATH = resolve(
  process.env.DATABASE_PATH || 'data/app.db',
);

let dbInstance: DatabaseType | null = null;

/**
 * Open (or return the already-open) SQLite database handle.
 * Creates the parent directory if missing and enables WAL journal mode.
 */
export function getDb(): DatabaseType {
  if (dbInstance) {
    return dbInstance;
  }

  const dir = dirname(DB_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  dbInstance = new Database(DB_PATH);
  dbInstance.pragma('journal_mode = WAL');
  dbInstance.pragma('foreign_keys = ON');

  console.log(`[DB] Opened ${DB_PATH} (WAL mode)`);
  return dbInstance;
}

/**
 * Run schema migrations and seed defaults. Safe to call multiple times.
 */
export function initDb(): DatabaseType {
  const db = getDb();
  runMigrations(db);
  runMedicareMigrations(db);
  console.log('[DB] Migrations complete');
  return db;
}

/**
 * Close the database handle gracefully. Intended to be called from the
 * shutdown manager's `onShutdown` hook (see server/lifecycle/shutdown.ts).
 */
export function closeDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
    console.log('[DB] Closed gracefully');
  }
}

export { DB_PATH };

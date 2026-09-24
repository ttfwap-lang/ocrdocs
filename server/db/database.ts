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

/**
 * Resolve the database path at connection time, not module-evaluation time.
 * Static ESM imports are evaluated before server.ts calls dotenv.config(); a
 * module-level constant could therefore capture the wrong relative path when
 * DATABASE_PATH is supplied only through .env.
 */
export function getDatabasePath(): string {
  return resolve(process.env.DATABASE_PATH || 'data/app.db');
}

let dbInstance: DatabaseType | null = null;
let openedPath: string | null = null;

/**
 * Open (or return the already-open) SQLite database handle.
 * Creates the parent directory if missing and enables WAL journal mode.
 */
export function getDb(): DatabaseType {
  if (dbInstance) {
    return dbInstance;
  }

  const dbPath = getDatabasePath();
  const dir = dirname(dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  dbInstance = new Database(dbPath);
  openedPath = dbPath;
  dbInstance.pragma('journal_mode = WAL');
  dbInstance.pragma('foreign_keys = ON');

  console.log(`[DB] Opened ${dbPath} (WAL mode)`);
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
    openedPath = null;
    console.log('[DB] Closed gracefully');
  }
}

/** The path of the currently opened database, when one exists. */
export function getOpenedDatabasePath(): string | null {
  return openedPath;
}

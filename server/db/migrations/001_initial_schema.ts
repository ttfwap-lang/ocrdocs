/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 1 — initial schema: documents, extractions, fields, jobs, users.
 * Uses CREATE TABLE IF NOT EXISTS so it is safe to run on every boot.
 */

import type { Database as DatabaseType } from 'better-sqlite3';

export function runMigrations(db: DatabaseType): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      id            TEXT PRIMARY KEY,
      filename      TEXT NOT NULL,
      original_path TEXT NOT NULL,
      content_hash  TEXT,
      mime_type     TEXT,
      uploaded_at   TEXT NOT NULL DEFAULT (datetime('now')),
      status        TEXT NOT NULL DEFAULT 'uploaded',
      user_id       TEXT
    );

    CREATE TABLE IF NOT EXISTS extractions (
      id                 TEXT PRIMARY KEY,
      document_id        TEXT NOT NULL,
      raw_text           TEXT,
      extraction_json    TEXT,
      extraction_version INTEGER NOT NULL DEFAULT 1,
      created_at         TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS fields (
      id               TEXT PRIMARY KEY,
      extraction_id    TEXT NOT NULL,
      field_name       TEXT NOT NULL,
      field_value      TEXT,
      confidence       REAL NOT NULL DEFAULT 0,
      source_section   TEXT,
      validated         INTEGER NOT NULL DEFAULT 0,
      validation_status TEXT NOT NULL DEFAULT 'pending',
      corrected_value   TEXT,
      approved          INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (extraction_id) REFERENCES extractions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id           TEXT PRIMARY KEY,
      document_id  TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'queued',
      started_at   TEXT,
      completed_at TEXT,
      error        TEXT,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      username      TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_extractions_document_id
      ON extractions(document_id);

    CREATE INDEX IF NOT EXISTS idx_fields_extraction_id
      ON fields(extraction_id);

    CREATE INDEX IF NOT EXISTS idx_jobs_document_id
      ON jobs(document_id);

    CREATE INDEX IF NOT EXISTS idx_jobs_status
      ON jobs(status);
  `);

  addColumnIfMissing(db, 'jobs', 'attempts', 'INTEGER NOT NULL DEFAULT 0');
}

/**
 * SQLite has no `ADD COLUMN IF NOT EXISTS`, and this migration runs on every
 * boot, so re-adding a column would throw on an existing database.
 */
function addColumnIfMissing(
  db: DatabaseType,
  table: string,
  column: string,
  definition: string,
): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (columns.some((c) => c.name === column)) {
    return;
  }
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

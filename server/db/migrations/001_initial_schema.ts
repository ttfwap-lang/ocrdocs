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

    CREATE TABLE IF NOT EXISTS portraits (
      id             TEXT PRIMARY KEY,
      document_id    TEXT NOT NULL,
      page_index     INTEGER NOT NULL DEFAULT 0,
      crop_x         INTEGER,
      crop_y         INTEGER,
      crop_w         INTEGER,
      crop_h         INTEGER,
      quality_score  REAL NOT NULL DEFAULT 0.5,
      source         TEXT NOT NULL DEFAULT 'heuristic',
      document_type  TEXT,
      created_at     TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_extractions_document_id
      ON extractions(document_id);

    CREATE INDEX IF NOT EXISTS idx_extractions_document_created
      ON extractions(document_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_fields_extraction_id
      ON fields(extraction_id);

    CREATE INDEX IF NOT EXISTS idx_fields_extraction_name
      ON fields(extraction_id, field_name);

    CREATE INDEX IF NOT EXISTS idx_jobs_document_id
      ON jobs(document_id);

    CREATE INDEX IF NOT EXISTS idx_jobs_status
      ON jobs(status);

    CREATE INDEX IF NOT EXISTS idx_documents_content_hash
      ON documents(content_hash);

    CREATE INDEX IF NOT EXISTS idx_portraits_document_id
      ON portraits(document_id);
  `);

  // A concurrent folder/file upload must not create two document rows for
  // identical bytes. The partial form keeps legacy NULL hashes valid while
  // making the content-hash dedupe check atomic. Do not fail startup on a
  // legacy database that still contains duplicates; report it for review and
  // let the next reconciliation resolve those rows first.
  const duplicateHashes = db.prepare(
    `SELECT COUNT(*) AS count FROM (
       SELECT content_hash FROM documents
       WHERE content_hash IS NOT NULL AND trim(content_hash) <> ''
       GROUP BY content_hash HAVING COUNT(*) > 1
     )`,
  ).get() as { count: number };
  if (duplicateHashes.count === 0) {
    db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_content_hash_unique
         ON documents(content_hash) WHERE content_hash IS NOT NULL`,
    );
  } else {
    console.warn(
      `[DB] content-hash uniqueness index deferred: ${duplicateHashes.count} duplicate hash group(s) require reconciliation`,
    );
  }

  addColumnIfMissing(db, 'jobs', 'attempts', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'documents', 'latest_extraction_id', 'TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS idx_documents_latest_extraction ON documents(latest_extraction_id)');
  // Backfill the pointer once for databases created before the column existed.
  // The correlated subquery is deliberately restricted to NULL pointers, so
  // normal restarts do not rescan every extraction.
  db.exec(`
    UPDATE documents
    SET latest_extraction_id = (
      SELECT e.id
      FROM extractions e
      WHERE e.document_id = documents.id
      ORDER BY e.created_at DESC, e.rowid DESC
      LIMIT 1
    )
    WHERE latest_extraction_id IS NULL
      AND EXISTS (SELECT 1 FROM extractions e WHERE e.document_id = documents.id)
  `);
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

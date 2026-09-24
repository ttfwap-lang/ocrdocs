/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 1 — document repository: CRUD for the `documents` table.
 */

import { randomUUID } from 'crypto';
import type { Database as DatabaseType } from 'better-sqlite3';
import type { DocumentRow } from '../contracts';

export function createDocumentRepo(db: DatabaseType) {
  const stmtInsert = db.prepare<
    [string, string, string, string | null, string | null, string | null]
  >(
    `INSERT INTO documents (id, filename, original_path, content_hash, mime_type, user_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );

  const DOCUMENT_COLUMNS = 'id, filename, original_path, content_hash, mime_type, uploaded_at, status, user_id';
  const stmtGetById = db.prepare<string>(
    `SELECT ${DOCUMENT_COLUMNS} FROM documents WHERE id = ?`,
  );

  const stmtGetAll = db.prepare(
    `SELECT ${DOCUMENT_COLUMNS} FROM documents ORDER BY uploaded_at DESC`,
  );

  const stmtCount = db.prepare(
    `SELECT COUNT(*) AS count FROM documents`,
  );

  const stmtCountByStatus = db.prepare(
    `SELECT status, COUNT(*) AS count FROM documents GROUP BY status ORDER BY status`,
  );

  const stmtGetByContentHash = db.prepare<string>(
    `SELECT * FROM documents WHERE content_hash = ? ORDER BY uploaded_at LIMIT 1`,
  );

  const stmtUpdateStatus = db.prepare<[string, string]>(
    `UPDATE documents SET status = ? WHERE id = ?`,
  );

  const stmtDelete = db.prepare<string>(
    `DELETE FROM documents WHERE id = ?`,
  );

  return {
    insert(params: {
      id?: string;
      filename: string;
      originalPath: string;
      contentHash?: string | null;
      mimeType?: string | null;
      userId?: string | null;
    }): DocumentRow {
      const id = params.id ?? randomUUID();
      stmtInsert.run(
        id,
        params.filename,
        params.originalPath,
        params.contentHash ?? null,
        params.mimeType ?? null,
        params.userId ?? null,
      );
      return this.getById(id)!;
    },

    getById(id: string): DocumentRow | undefined {
      return stmtGetById.get(id) as DocumentRow | undefined;
    },

    getAll(): DocumentRow[] {
      return stmtGetAll.all() as DocumentRow[];
    },

    /** Lightweight status-bar read; avoids serialising every document row. */
    count(): number {
      return (stmtCount.get() as { count: number }).count;
    },

    countByStatus(): Record<string, number> {
      const out: Record<string, number> = {};
      for (const row of stmtCountByStatus.all() as Array<{ status: string; count: number }>) {
        out[row.status] = row.count;
      }
      return out;
    },

    /** Identical bytes mean an identical document — used to skip re-OCRing a re-upload. */
    getByContentHash(contentHash: string): DocumentRow | undefined {
      return stmtGetByContentHash.get(contentHash) as DocumentRow | undefined;
    },

    updateStatus(id: string, status: string): void {
      stmtUpdateStatus.run(status, id);
    },

    delete(id: string): void {
      stmtDelete.run(id);
    },
  };
}

export type DocumentRepo = ReturnType<typeof createDocumentRepo>;

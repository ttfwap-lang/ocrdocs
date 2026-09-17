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

  const stmtGetById = db.prepare<string>(
    `SELECT * FROM documents WHERE id = ?`,
  );

  const stmtGetAll = db.prepare(
    `SELECT * FROM documents ORDER BY uploaded_at DESC`,
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

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Portrait repository: CRUD for the `portraits` table.
 * Portraits link a face/portrait region (or full page) in a source document
 * to its document row. Identity association is derived through the document →
 * identity grouping in identityService, not stored directly.
 */

import { randomUUID } from 'crypto';
import type { Database as DatabaseType } from 'better-sqlite3';
import type { PortraitRow } from '../contracts';

export function createPortraitRepo(db: DatabaseType) {
  const stmtInsert = db.prepare<
    [string, string, number, number | null, number | null, number | null, number | null, number, string, string | null]
  >(
    `INSERT INTO portraits (id, document_id, page_index, crop_x, crop_y, crop_w, crop_h, quality_score, source, document_type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const stmtGetById = db.prepare<string>(
    `SELECT * FROM portraits WHERE id = ?`,
  );

  const stmtGetByDocumentId = db.prepare<string>(
    `SELECT * FROM portraits WHERE document_id = ? ORDER BY quality_score DESC`,
  );

  const stmtGetByDocumentIds = db.prepare(
    `SELECT * FROM portraits WHERE document_id IN (SELECT value FROM json_each(?)) ORDER BY quality_score DESC`,
  );

  const stmtDeleteByDocumentId = db.prepare<string>(
    `DELETE FROM portraits WHERE document_id = ?`,
  );

  const stmtExistsForDocument = db.prepare<string>(
    `SELECT COUNT(*) as cnt FROM portraits WHERE document_id = ?`,
  );

  return {
    insert(params: {
      id?: string;
      documentId: string;
      pageIndex?: number;
      cropX?: number | null;
      cropY?: number | null;
      cropW?: number | null;
      cropH?: number | null;
      qualityScore?: number;
      source?: string;
      documentType?: string | null;
    }): PortraitRow {
      const id = params.id ?? randomUUID();
      stmtInsert.run(
        id,
        params.documentId,
        params.pageIndex ?? 0,
        params.cropX ?? null,
        params.cropY ?? null,
        params.cropW ?? null,
        params.cropH ?? null,
        params.qualityScore ?? 0.5,
        params.source ?? 'heuristic',
        params.documentType ?? null,
      );
      return this.getById(id)!;
    },

    getById(id: string): PortraitRow | undefined {
      return stmtGetById.get(id) as PortraitRow | undefined;
    },

    getByDocumentId(documentId: string): PortraitRow[] {
      return stmtGetByDocumentId.all(documentId) as PortraitRow[];
    },

    /**
     * Fetch portraits for a set of document IDs in a single query.
     * Returns them ordered by quality_score DESC so the caller can pick the best.
     */
    getByDocumentIds(documentIds: string[]): PortraitRow[] {
      if (documentIds.length === 0) return [];
      return stmtGetByDocumentIds.all(JSON.stringify(documentIds)) as PortraitRow[];
    },

    existsForDocument(documentId: string): boolean {
      const row = stmtExistsForDocument.get(documentId) as { cnt: number } | undefined;
      return (row?.cnt ?? 0) > 0;
    },

    deleteByDocumentId(documentId: string): void {
      stmtDeleteByDocumentId.run(documentId);
    },
  };
}

export type PortraitRepo = ReturnType<typeof createPortraitRepo>;

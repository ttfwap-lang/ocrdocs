/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 1 — extraction + fields repository: CRUD for the
 * `extractions` and `fields` tables.
 */

import { randomUUID } from 'crypto';
import type { Database as DatabaseType } from 'better-sqlite3';
import type {
  ExtractionRow,
  FieldRow,
  ExtractedField,
  PersistedExtractionResult,
} from '../contracts';

function boolToInt(v: boolean): number {
  return v ? 1 : 0;
}

function intToBool(v: number): boolean {
  return v === 1;
}

/**
 * Convert a DB FieldRow into the ExtractedField contract shape.
 */
function rowToField(row: FieldRow): ExtractedField {
  return {
    name: row.field_name,
    value: row.field_value,
    confidence: row.confidence,
    sourceSection: row.source_section,
    validated: intToBool(row.validated),
    validationStatus: row.validation_status as ExtractedField['validationStatus'],
    correctedValue: row.corrected_value,
    approved: intToBool(row.approved),
  };
}

export function createExtractionRepo(db: DatabaseType) {
  const stmtInsertExtraction = db.prepare<
    [string, string, string | null, string | null, number]
  >(
    `INSERT INTO extractions (id, document_id, raw_text, extraction_json, extraction_version)
     VALUES (?, ?, ?, ?, ?)`,
  );

  const stmtGetExtractionById = db.prepare<string>(
    `SELECT * FROM extractions WHERE id = ?`,
  );

  const stmtSetLatestExtraction = db.prepare(
    `UPDATE documents SET latest_extraction_id = ? WHERE id = ?`,
  );

  const stmtGetExtractionsByDoc = db.prepare<string>(
    `SELECT * FROM extractions WHERE document_id = ? ORDER BY created_at DESC, rowid DESC`,
  );

  /**
   * Read the latest extraction and the requested fields for every document in
   * two set-based queries. The identity list used to call
   * getExtractionsByDocument + getFields once per document (an N+1 query
   * pattern); with a 14k-document live database that blocked the event loop
   * for several seconds and made tab switching look like an empty database.
   *
   * `documents.latest_extraction_id` is maintained on insertion and backfilled
   * by the schema migration. It avoids an expensive window sort over every
   * extraction on each request. The LEFT JOIN deliberately returns a null
   * extraction for documents that are still queued.
   */
  const stmtGetLatestSnapshot = db.prepare(
    `SELECT d.id AS owner_document_id, e.id, e.document_id
     FROM documents d
     LEFT JOIN extractions e ON e.id = d.latest_extraction_id`,
  );

  const stmtInsertField = db.prepare<
    [
      string, // id
      string, // extraction_id
      string, // field_name
      string | null, // field_value
      number, // confidence
      string | null, // source_section
      number, // validated
      string, // validation_status
      string | null, // corrected_value
      number, // approved
    ]
  >(
    `INSERT INTO fields
       (id, extraction_id, field_name, field_value, confidence, source_section, validated, validation_status, corrected_value, approved)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const stmtGetFieldsByExtraction = db.prepare<string>(
    `SELECT * FROM fields WHERE extraction_id = ?`,
  );

  const stmtUpdateFieldCorrection = db.prepare<
    [string | null, string, string]
  >(
    `UPDATE fields SET corrected_value = ?, validation_status = ? WHERE id = ?`,
  );

  const stmtApproveField = db.prepare<[number, string]>(
    `UPDATE fields SET approved = ? WHERE id = ?`,
  );

  const stmtGetFieldById = db.prepare<string>(
    `SELECT * FROM fields WHERE id = ?`,
  );

  const stmtMaxVersionForDoc = db.prepare<string>(
    `SELECT MAX(extraction_version) AS maxVersion FROM extractions WHERE document_id = ?`,
  );

  return {
    createExtraction(params: {
      id?: string;
      documentId: string;
      rawText?: string | null;
      extractionJson?: string | null;
      extractionVersion?: number;
    }): ExtractionRow {
      const id = params.id ?? randomUUID();
      stmtInsertExtraction.run(
        id,
        params.documentId,
        params.rawText ?? null,
        params.extractionJson ?? null,
        params.extractionVersion ?? 1,
      );
      stmtSetLatestExtraction.run(id, params.documentId);
      return this.getExtractionById(id)!;
    },

    getExtractionById(id: string): ExtractionRow | undefined {
      return stmtGetExtractionById.get(id) as ExtractionRow | undefined;
    },

    getExtractionsByDocument(documentId: string): ExtractionRow[] {
      return stmtGetExtractionsByDoc.all(documentId) as ExtractionRow[];
    },

    /**
     * Set-based latest-extraction read used by identity grouping. The returned
     * map contains only the requested fields, so this stays bounded even when
     * the database contains hundreds of thousands of catalogue fields.
     */
    getLatestSnapshot(fieldNames: string[]): Map<string, { extraction: Pick<ExtractionRow, 'id' | 'document_id'>; fields: FieldRow[] }> {
      const latest = stmtGetLatestSnapshot.all() as Array<Pick<ExtractionRow, 'id' | 'document_id'> & { owner_document_id: string }>;
      const byExtraction = new Map<string, FieldRow[]>();
      if (fieldNames.length > 0) {
        const placeholders = fieldNames.map(() => '?').join(', ');
        const rows = db.prepare(
          `SELECT f.*
           FROM fields f
           WHERE f.extraction_id IN (
             SELECT latest_extraction_id
             FROM documents
             WHERE latest_extraction_id IS NOT NULL
           )
           AND f.field_name IN (${placeholders})`,
        ).all(...fieldNames) as FieldRow[];
        for (const row of rows) {
          const list = byExtraction.get(row.extraction_id);
          if (list) list.push(row);
          else byExtraction.set(row.extraction_id, [row]);
        }
      }
      const result = new Map<string, { extraction: Pick<ExtractionRow, 'id' | 'document_id'>; fields: FieldRow[] }>();
      for (const row of latest) {
        if (!row.id) continue;
        result.set(row.owner_document_id, {
          extraction: row,
          fields: byExtraction.get(row.id) ?? [],
        });
      }
      return result;
    },

    /**
     * Version numbers are per document: re-processing a document yields
     * version 2, 3, ... so prior extractions stay distinguishable instead of
     * every row claiming to be version 1.
     */
    nextVersionForDocument(documentId: string): number {
      const row = stmtMaxVersionForDoc.get(documentId) as { maxVersion: number | null } | undefined;
      return (row?.maxVersion ?? 0) + 1;
    },

    insertFields(extractionId: string, fields: ExtractedField[]): void {
      const tx = db.transaction(() => {
        for (const f of fields) {
          stmtInsertField.run(
            randomUUID(),
            extractionId,
            f.name,
            f.value,
            f.confidence,
            f.sourceSection ?? null,
            boolToInt(f.validated),
            f.validationStatus,
            f.correctedValue ?? null,
            boolToInt(f.approved),
          );
        }
      });
      tx();
    },

    getFields(extractionId: string): FieldRow[] {
      return stmtGetFieldsByExtraction.all(extractionId) as FieldRow[];
    },

    getFieldById(fieldId: string): FieldRow | undefined {
      return stmtGetFieldById.get(fieldId) as FieldRow | undefined;
    },

    getFieldsAsContract(extractionId: string): ExtractedField[] {
      return this.getFields(extractionId).map(rowToField);
    },

    /**
     * Reconstruct the full PersistedExtractionResult for API responses.
     */
    getFullResult(
      extractionId: string,
    ): PersistedExtractionResult | undefined {
      const extraction = this.getExtractionById(extractionId);
      if (!extraction) {
        return undefined;
      }
      const fields = this.getFieldsAsContract(extractionId);
      let engineUsed: string | undefined;
      let passes: Array<Record<string, unknown>> | undefined;
      let pages: Array<Record<string, unknown>> | undefined;
      let vlmFieldCount: number | undefined;
      let documentType: string | undefined;
      let review: any;
      if (extraction.extraction_json) {
        try {
          const parsed = JSON.parse(extraction.extraction_json);
          engineUsed = typeof parsed.engineUsed === 'string' ? parsed.engineUsed : undefined;
          passes = Array.isArray(parsed.passes) ? parsed.passes : undefined;
          pages = Array.isArray(parsed.pages) && parsed.pages.length ? parsed.pages : undefined;
          vlmFieldCount = typeof parsed.vlmFieldCount === 'number' ? parsed.vlmFieldCount : undefined;
          documentType = typeof parsed.documentType === 'string' ? parsed.documentType : undefined;
          review = parsed.review && typeof parsed.review === 'object' ? parsed.review : undefined;
        } catch {
          // Malformed JSON must not break result retrieval.
        }
      }
      return {
        id: extraction.id,
        version: extraction.extraction_version,
        documentId: extraction.document_id,
        fields,
        rawText: extraction.raw_text,
        metadata: {
          extractionVersion: extraction.extraction_version,
          createdAt: extraction.created_at,
          engineUsed,
          passes,
          ...(pages ? { pages } : {}),
          ...(vlmFieldCount !== undefined ? { vlmFieldCount } : {}),
          ...(documentType ? { documentType } : {}),
          ...(review ? { review } : {}),
        },
      };
    },

    correctField(
      fieldId: string,
      correctedValue: string | null,
      validationStatus: string,
    ): void {
      stmtUpdateFieldCorrection.run(correctedValue, validationStatus, fieldId);
    },

    approveField(fieldId: string, approved: boolean): void {
      stmtApproveField.run(boolToInt(approved), fieldId);
    },
  };
}

export type ExtractionRepo = ReturnType<typeof createExtractionRepo>;

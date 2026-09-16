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

  const stmtGetExtractionsByDoc = db.prepare<string>(
    `SELECT * FROM extractions WHERE document_id = ? ORDER BY created_at DESC`,
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
      return this.getExtractionById(id)!;
    },

    getExtractionById(id: string): ExtractionRow | undefined {
      return stmtGetExtractionById.get(id) as ExtractionRow | undefined;
    },

    getExtractionsByDocument(documentId: string): ExtractionRow[] {
      return stmtGetExtractionsByDoc.all(documentId) as ExtractionRow[];
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
      if (extraction.extraction_json) {
        try {
          const parsed = JSON.parse(extraction.extraction_json);
          engineUsed = typeof parsed.engineUsed === 'string' ? parsed.engineUsed : undefined;
          passes = Array.isArray(parsed.passes) ? parsed.passes : undefined;
        } catch {
          // Malformed JSON must not break result retrieval.
        }
      }
      return {
        version: extraction.extraction_version,
        documentId: extraction.document_id,
        fields,
        rawText: extraction.raw_text,
        metadata: {
          extractionVersion: extraction.extraction_version,
          createdAt: extraction.created_at,
          engineUsed,
          passes,
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

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 1 — versioned extraction result contracts.
 * Extends the existing ExtractionResult in src/types.ts (field-level result)
 * with a document-level wrapper suitable for DB persistence and API responses.
 */

import type { FieldCategory } from '../../src/types';

export type ValidationStatus = 'valid' | 'invalid' | 'warning' | 'pending';

export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed';

export type DocumentStatus = 'uploaded' | 'processing' | 'extracted' | 'failed';

/**
 * A single field extracted from a document, persisted in the `fields` table.
 * Mirrors the field-level data in src/types.ts ExtractionResult but is
 * structured for storage rather than regex-matching diagnostics.
 */
export interface ExtractedField {
  name: string;
  value: string | null;
  confidence: number;
  sourceSection: string | null;
  validated: boolean;
  validationStatus: ValidationStatus;
  correctedValue: string | null;
  approved: boolean;
  /** Optional: carry through the category from BankFieldDefinition for grouping. */
  category?: FieldCategory;
}

/**
 * Document-level extraction result — the persisted versioned contract.
 * `version` allows the extraction pipeline to evolve without breaking
 * downstream consumers (they check version before interpreting fields).
 */
export interface PersistedExtractionResult {
  version: number;
  documentId: string;
  fields: ExtractedField[];
  rawText: string | null;
  metadata: {
    extractionVersion: number;
    createdAt: string;
    engineUsed?: string;
    passes?: Array<Record<string, unknown>>;
  };
}

/**
 * Row shapes returned by repository queries. These match the DB columns
 * directly (before any join enrichment).
 */
export interface DocumentRow {
  id: string;
  filename: string;
  original_path: string;
  content_hash: string | null;
  mime_type: string | null;
  uploaded_at: string;
  status: string;
  user_id: string | null;
}

export interface ExtractionRow {
  id: string;
  document_id: string;
  raw_text: string | null;
  extraction_json: string | null;
  extraction_version: number;
  created_at: string;
}

export interface FieldRow {
  id: string;
  extraction_id: string;
  field_name: string;
  field_value: string | null;
  confidence: number;
  source_section: string | null;
  validated: number;
  validation_status: string;
  corrected_value: string | null;
  approved: number;
}

export interface JobRow {
  id: string;
  document_id: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  error: string | null;
}

export interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  created_at: string;
}

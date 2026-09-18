/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type FieldCategory =
  | 'identity'
  | 'residential'
  | 'contact'
  | 'employment'
  | 'income'
  | 'expenses'
  | 'assets_liabilities'
  | 'facility';

export interface AustralianAddressStructure {
  rawAddress: string;
  unitOrLevel?: string;
  streetNumber: string;
  streetName: string;
  streetType: string;
  suburb: string;
  state: 'NSW' | 'VIC' | 'QLD' | 'WA' | 'SA' | 'TAS' | 'ACT' | 'NT' | 'UNKNOWN';
  postcode: string;
  gnafConfidenceScore: number;
  isPostcodeStateCoherent: boolean;
}

export interface ContextualDisambiguationMeta {
  disambiguationStrategy: 'PROXIMITY_WEIGHTING' | 'SECTION_AFFINITY' | 'KEYWORD_PROXIMITY_HEURISTIC' | 'REGEX_EXACT' | 'REGEX_STRUCTURAL_MATCH';
  sectionContext?: string;
  competingCandidatesCount?: number;
  spatialLineOffset?: number;
  nlpResolved: boolean;
  notes?: string;
}

export interface BankFieldDefinition {
  id: string;
  number: number;
  name: string;
  label: string;
  category: FieldCategory;
  maxToleranceRegex: string;
  /** When set, maxToleranceRegex is a VALUE pattern and this is the LABEL pattern that must precede it. */
  labelRegex?: string;
  description: string;
  targetDataType: 'text' | 'date' | 'currency' | 'number' | 'email' | 'phone' | 'identifier';
  exampleLabels: string[];
  sampleExtractedValue: string;
}

export interface AustralianValidationDetail {
  ruleCode: 'AU_DOB_FORMAT' | 'AU_POSTCODE_4DIGIT' | 'AU_ABN_MOD89' | 'AU_BSB_FORMAT' | 'AU_PHONE_FORMAT' | 'AU_TFN_MOD11' | 'AU_ACN_MOD10' | 'AU_MEDICARE_MOD10' | 'AU_CARD_LUHN' | 'AU_GENERAL';
  ruleName: string;
  isValid: boolean;
  message: string;
  canonicalValue?: string;
  details?: Record<string, any>;
}

export interface ExtractionResult {
  fieldId: string;
  fieldName: string;
  category: FieldCategory;
  matchedAnchor: string | null;
  extractedValue: string | null;
  confidence: number;
  matchIndex: number;
  regexPattern: string;
  status: 'matched' | 'missing' | 'ambiguous';
  contextSnippet?: string;
  isValid?: boolean;
  validationMessage?: string;
  canonicalValue?: string;
  validationDetails?: AustralianValidationDetail;
  parsedStructure?: AustralianAddressStructure;
  disambiguation?: ContextualDisambiguationMeta;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  content: string;
  timestamp: string;
}

export interface ServiceAvailabilityResponse {
  service: 'ocr_worker' | 'dgx_worker';
  mode: 'live' | 'unconfigured';
  available: boolean;
  reason?: string;
  configuredAt?: string;
}

/** A document registered via POST /api/documents, as returned by the DB-backed document/job pipeline. */
export interface LocalDocument {
  id: string;
  filename: string;
  original_path: string;
  content_hash: string | null;
  mime_type: string | null;
  status: string;
  uploaded_at: string;
}

export interface LocalJob {
  id: string;
  document_id: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  started_at: string | null;
  completed_at: string | null;
  error: string | null;
}

export interface DocumentPreview {
  id: string;
  filename: string;
  mimeType: string | null;
  status: string;
}

/** A person, as grouped by GET /api/identities from documents sharing given_names + family_name + date_of_birth. */
export interface IdentitySummary {
  identityId: string;
  givenNames: string;
  familyName: string;
  fullName: string;
  dob: string;
  documentCount: number;
  extractedCount: number;
  pendingCount: number;
  failedCount: number;
  previewDocuments: DocumentPreview[];
}

/** A queued/extracted document that has no reliable family_name + date_of_birth to group by yet. */
export interface UnassignedDocument {
  id: string;
  filename: string;
  mimeType: string | null;
  status: string;
  uploadedAt: string;
}

export interface IdentityFieldEntry {
  name: string;
  value: string;
  confidence: number;
  approved: boolean;
  documentId: string;
  documentFilename: string;
}

export interface IdentityDocumentDetail {
  document: LocalDocument;
  extraction: {
    id: string;
    version: number;
    documentId: string;
    rawText: string | null;
    fields: Array<{
      name: string;
      value: string | null;
      confidence: number;
      sourceSection: string | null;
      validated: boolean;
      validationStatus: 'valid' | 'invalid' | 'warning' | 'pending';
      correctedValue: string | null;
      approved: boolean;
      category?: FieldCategory;
    }>;
    metadata: { extractionVersion: number; createdAt: string; engineUsed?: string; passes?: unknown[] };
  } | null;
}

export interface IdentityDetail extends IdentitySummary {
  documents: IdentityDocumentDetail[];
  fieldBreakdown: IdentityFieldEntry[];
}

/** Raw `fields` row shape, as returned by GET /api/extractions/:id/fields. */
export interface ReviewField {
  id: string;
  field_name: string;
  field_value: string | null;
  confidence: number;
  validation_status: string;
  corrected_value: string | null;
  approved: number;
}

export interface PinnedDependency {
  name: string;
  version: string;
  ecosystem: 'npm' | 'pypi' | 'system';
  license: string;
  integrityHash?: string;
  commercialUseAllowed: boolean;
  copyleft?: boolean;
  notes?: string;
}

export interface DependencyLicenseManifest {
  manifestVersion: string;
  generatedAt: string;
  nodeRuntime: {
    minimumVersion: string;
    targetVersion: string;
    dependencies: PinnedDependency[];
    devDependencies: PinnedDependency[];
  };
  pythonRuntime: {
    minimumVersion: string;
    targetVersion: string;
    productionDependencies: PinnedDependency[];
    screenedResearchDependencies: PinnedDependency[];
  };
  nativeTools: {
    tools: PinnedDependency[];
  };
  licenseSummary: {
    totalDirectDependencies: number;
    commercialPermissiveCount: number;
    copyleftCountInProduction: number;
    screenedConditionalCount: number;
  };
}

/** Stage 6 — server bind/lifecycle configuration contract. */
export interface ServerLifecycleConfig {
  port: number;
  host: string;
  shutdownTimeoutMs: number;
  drainSockets: boolean;
  onShutdown: () => Promise<void>;
}

/** Stage 6 — validated runtime environment snapshot (secrets never logged). */
export interface LoadedEnvConfig {
  nodeEnv: 'development' | 'production' | 'test';
  port: number;
  host: string;
  databasePath: string;
  storageRoot: string;
  jwtSecret?: string;
  shutdownTimeoutMs: number;
}

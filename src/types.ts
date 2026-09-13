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
  description: string;
  targetDataType: 'text' | 'date' | 'currency' | 'number' | 'email' | 'phone' | 'identifier';
  exampleLabels: string[];
  sampleExtractedValue: string;
}

export interface AustralianValidationDetail {
  ruleCode: 'AU_DOB_FORMAT' | 'AU_POSTCODE_4DIGIT' | 'AU_ABN_MOD89' | 'AU_BSB_FORMAT' | 'AU_PHONE_FORMAT' | 'AU_GENERAL';
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

export interface ResearchPassReport {
  passNumber: number;
  passName: string;
  targetDomain: string;
  researchFocus: string;
  baselineMetric: string;
  optimizedMetric: string;
  improvementGain: string;
  status: 'VERIFIED_ZERO_REGRESSION' | 'OPTIMIZED' | 'DEPLOYED';
  keyDiscoveries: string[];
  architecturalDecisions: string[];
  cppOrNgxBlueprint: string;
  regressionProofLogs: string;
}

export interface SampleDocument {
  id: string;
  title: string;
  institution: string;
  docType: string;
  description: string;
  rawText: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  content: string;
  timestamp: string;
}

export interface ScriptAuditSection {
  id: string;
  title: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'RECOMMENDATION';
  originalProblem: string;
  ngxSparkSolution: string;
  impact: string;
}

export interface GDriveFileItem {
  id: string;
  name: string;
  sizeBytes: number;
  mimeType: string;
  category: string;
  downloadStatus: 'synced' | 'downloading' | 'ready' | 'pending';
  checksumSha256?: string;
  extractedFieldsCount?: number;
  sampleContent?: string;
}

export interface GDriveFolderStatus {
  folderId: string;
  folderUrl: string;
  folderName: string;
  totalFiles: number;
  totalSizeFormatted: string;
  lastSynced: string;
  syncState: 'idle' | 'syncing' | 'synced' | 'error';
  files: GDriveFileItem[];
}

export interface PassExecutionMetric {
  passNumber: number;
  name: string;
  engineUsed: string;
  enhancementFilter: string;
  status: 'PENDING' | 'RUNNING' | 'CONVERGED' | 'COMPLETED' | 'SKIPPED';
  durationMs: number;
  totalDocuments: number;
  fieldsExtracted: number;
  totalFieldsPossible: number;
  recallPercent: number;
  validAbnCount: number;
  validBsbCount: number;
  validDobCount: number;
  regressionsPrevented: number;
  deltaNewFields: number;
  earlyStopFeasible: boolean;
  logSummary: string;
}

export interface MultiPassRunSummary {
  runId: string;
  totalPassesRun: number;
  maxPassesAllowed: number;
  earlyStopTriggered: boolean;
  earlyStopPassNumber?: number;
  stopReason?: string;
  monotonicPreservationActive: boolean;
  totalRegressionsPrevented: number;
  initialRecall: number;
  finalRecall: number;
  gain: number;
  passes: PassExecutionMetric[];
}

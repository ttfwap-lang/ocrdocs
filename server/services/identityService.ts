/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Groups documents into identities by their extracted given_names +
 * family_name + date_of_birth, without a dedicated `identities` table: the
 * grouping key is derived at read time from whatever the latest extraction
 * for each document actually says, so it can never drift from the real
 * fields data. A document missing family_name or date_of_birth on its latest
 * extraction has nothing reliable to group by and is reported separately as
 * unassigned rather than guessed into a bucket.
 */

import { createHash } from 'crypto';
import type { DocumentRepo } from '../db/repositories/documentRepo';
import type { ExtractionRepo } from '../db/repositories/extractionRepo';
import type { DocumentRow } from '../db/contracts';
import type { HeadshotService, IdentityPhoto } from './headshotService';
import { BANK_FIELD_DEFINITIONS, CORE_IDENTIFIER_DEFINITIONS } from '../../src/data/bankFields';
import { canonicalDob } from './dobKey';
import { canonicaliseIdentifier, tierExplanation, verificationTier } from './identifierKey';

/**
 * The `fields` table stores each row's human-readable display name (e.g.
 * "Given Names / First Name"), not its short id ("given_names") -- that's
 * what `field_name` actually holds (see toExtractedField() in server.ts).
 * Resolve ids to the real display name from the shared catalogue rather than
 * hardcoding the string, so this can never silently drift from bankFields.ts.
 */
function displayNameFor(fieldId: string): string {
  const def = [...BANK_FIELD_DEFINITIONS, ...CORE_IDENTIFIER_DEFINITIONS].find((f) => f.id === fieldId);
  if (!def) {
    throw new Error(`Unknown field id "${fieldId}" -- not present in the field catalogue`);
  }
  return def.name;
}

const GIVEN_NAMES_FIELD = displayNameFor('given_names');
const FAMILY_NAME_FIELD = displayNameFor('family_name');
const DATE_OF_BIRTH_FIELD = displayNameFor('date_of_birth');

/**
 * The field catalogue's logical order (title → given → middle → family → dob →
 * … → structural identifiers 104+), keyed by the display name that `fields`
 * rows actually store. `fieldBreakdown` is sorted by this so every identity's
 * lines read in the catalogue's order instead of alphabetically.
 */
const FIELD_ORDER = new Map<string, number>();
for (const def of [...BANK_FIELD_DEFINITIONS, ...CORE_IDENTIFIER_DEFINITIONS]) {
  FIELD_ORDER.set(def.name, def.number);
}

/** Unknown names sort after every catalogue field, alphabetically among themselves. */
function byCatalogueOrder(a: { name: string }, b: { name: string }): number {
  const an = FIELD_ORDER.get(a.name) ?? Number.MAX_SAFE_INTEGER;
  const bn = FIELD_ORDER.get(b.name) ?? Number.MAX_SAFE_INTEGER;
  return an - bn || a.name.localeCompare(b.name);
}

export interface IdentityFieldEntry {
  name: string;
  value: string;
  confidence: number;
  approved: boolean;
  documentId: string;
  documentFilename: string;
}

export interface DocumentPreview {
  id: string;
  filename: string;
  mimeType: string | null;
  status: string;
}

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
  /** URL of the first verified head photo for this person, or null when none exists yet. */
  thumbnailUrl: string | null;
  /** Number of extracted head photos attached to this identity. */
  photoCount: number;
  previewDocuments: DocumentPreview[];
}

export interface UnassignedDocument {
  id: string;
  filename: string;
  mimeType: string | null;
  status: string;
  uploadedAt: string;
  /** Head photos found in this document (e.g. a passport scan with no name+DOB yet). */
  photos: IdentityPhoto[];
}

export interface IdentityDocumentDetail {
  document: DocumentRow;
  extraction: ReturnType<ExtractionRepo['getFullResult']> | null;
}

/**
 * A key identifier (passport / driver's licence) for one person, with the evidence a
 * reviewer needs to trust it: the verification tier, how many independent source
 * documents produced the same value, and those exact files.
 */
export interface KeyIdentifier {
  kind: 'passport' | 'licence';
  /** Display label, e.g. "Passport Number". */
  label: string;
  /** The best value found, as extracted (may carry a country prefix or spaces). */
  value: string;
  /** `value` reduced to letters+digits, which is what the format check compares. */
  canonical: string;
  tier: 'triple_checked' | 'single_source' | 'format_fail';
  /** What the tier means, ready to show. */
  explanation: string;
  /** How many distinct source documents produced this same canonical value. */
  sourceCount: number;
  /** The exact source files, so the value can be traced back and eyeballed. */
  sources: Array<{ documentId: string; filename: string }>;
}

/** The credit score, which the owner treats as one of the three real headings. */
export interface CreditScoreSummary {
  value: string;
  /** Source file the score was read from. */
  documentId: string;
  filename: string;
}

export interface IdentityDetail extends IdentitySummary {
  documents: IdentityDocumentDetail[];
  fieldBreakdown: IdentityFieldEntry[];
  /** Every head photo extracted across this person's documents (verified first). */
  photos: IdentityPhoto[];
  /**
   * Passport and driver's-licence values with their verification tier, corroboration
   * count and exact source files. These are the key details the identity page promotes;
   * every other field stays in `fieldBreakdown`.
   */
  keyIdentifiers: KeyIdentifier[];
  /** The credit score, if any document for this person carried one. */
  creditScore: CreditScoreSummary | null;
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Compares DOBs by their canonical key, so `24/11/1963` and `24 NOV 1963` are
 * the same person. Ambiguous numeric dates (both leading parts <= 12) keep their
 * raw digits rather than guessing an ordering, so distinct values never merge.
 * See ./dobKey.ts for the measured failure this replaces.
 */
function normalizeDob(value: string): string {
  return canonicalDob(value);
}

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b\p{L}/gu, (ch) => ch.toUpperCase());
}

function identityIdFor(key: string): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 16);
}

interface IdentityGroup {
  givenNames: string;
  familyName: string;
  dob: string;
  documents: DocumentRow[];
}

export function createIdentityService(documentRepo: DocumentRepo, extractionRepo: ExtractionRepo, headshotService: HeadshotService) {
  /**
   * `getExtractionsByDocument` is ORDER BY created_at DESC, so index 0 is the
   * latest extraction — this is the one grouping and the breakdown read from.
   */
  function latestExtraction(documentId: string) {
    const extractions = extractionRepo.getExtractionsByDocument(documentId);
    return extractions[0];
  }

  function fieldValue(fields: ReturnType<ExtractionRepo['getFields']>, name: string): string {
    const row = fields.find((f) => f.field_name === name && (f.corrected_value ?? f.field_value));
    const value = row ? (row.corrected_value ?? row.field_value ?? '') : '';
    return value.trim();
  }

  // Display names of the identifier fields, resolved from the catalogue like the
  // grouping fields above, so a rename in bankFields.ts cannot silently break this.
  const PASSPORT_FIELD = displayNameFor('passport_details');
  const LICENCE_FIELD = displayNameFor('drivers_licence');
  const CREDIT_SCORE_FIELD = displayNameFor('credit_score');

  /**
   * Gather the passport and licence values across every document in a group and attach
   * the evidence.
   *
   * Corroboration is computed LIVE from the documents that actually produced the value,
   * rather than stored, so it can never drift out of date: if two documents carry
   * `EH9692611` the count is 2, and the reviewer sees both filenames. A value seen in a
   * single document is `single_source` (still qualifying under the owner's rule) and a
   * value that fails the Australian shape is reported as `format_fail` rather than being
   * hidden, so a masked or mis-OCR'd number stays visible for correction.
   */
  function keyIdentifiersFor(documents: IdentityDocumentDetail[]): KeyIdentifier[] {
    const byKind: Record<'passport' | 'licence', {
      field: string;
      label: string;
      /** canonical -> { best value, docs that produced it } */
      seen: Map<string, { value: string; docs: Map<string, IdentityDocumentDetail> }>;
    }> = {
      passport: { field: PASSPORT_FIELD, label: 'Passport Number', seen: new Map() },
      licence: { field: LICENCE_FIELD, label: "Driver's Licence Number", seen: new Map() },
    };

    for (const detail of documents) {
      if (!detail.extraction) continue;
      for (const kind of ['passport', 'licence'] as const) {
        const bucket = byKind[kind];
        for (const f of detail.extraction.fields) {
          if (f.name !== bucket.field) continue;
          const effective = (f.correctedValue ?? f.value ?? '').trim();
          if (!effective) continue;
          const canonical = canonicaliseIdentifier(effective);
          if (!canonical) continue;
          const existing = bucket.seen.get(canonical);
          if (existing) {
            existing.docs.set(detail.document.id, detail);
          } else {
            bucket.seen.set(canonical, {
              value: effective,
              docs: new Map([[detail.document.id, detail]]),
            });
          }
        }
      }
    }

    const out: KeyIdentifier[] = [];
    for (const kind of ['passport', 'licence'] as const) {
      const bucket = byKind[kind];
      if (bucket.seen.size === 0) continue;
      // Prefer the value with the most independent sources; tie-break on first seen so
      // the result is stable across requests.
      const ranked = Array.from(bucket.seen.entries()).sort(
        (a, b) => b[1].docs.size - a[1].docs.size || a[0].localeCompare(b[0]),
      );
      for (const [canonical, entry] of ranked) {
        const sources = Array.from(entry.docs.values()).map((d) => ({
          documentId: d.document.id,
          filename: d.document.filename,
        }));
        // An entry only exists here when a value was found, so a format failure is the
        // only non-qualifying outcome; narrow away the 'absent' tier the helper also models.
        const tier = verificationTier(kind, canonical, sources.length);
        const reportedTier = tier === 'absent' ? 'format_fail' : tier;
        out.push({
          kind,
          label: bucket.label,
          value: entry.value,
          canonical,
          tier: reportedTier,
          explanation: tierExplanation(reportedTier, sources.length),
          sourceCount: sources.length,
          sources,
        });
      }
    }
    // Passport first, then licence; within a kind, strongest evidence first (already ranked).
    return out.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'passport' ? -1 : 1));
  }

  /** The person's credit score, with the exact document it was read from. */
  function creditScoreFor(documents: IdentityDocumentDetail[]): CreditScoreSummary | null {
    for (const detail of documents) {
      if (!detail.extraction) continue;
      const row = detail.extraction.fields.find((f) => f.name === CREDIT_SCORE_FIELD);
      const effective = (row?.correctedValue ?? row?.value ?? '').trim();
      if (effective) {
        return { value: effective, documentId: detail.document.id, filename: detail.document.filename };
      }
    }
    return null;
  }

  function buildGroups(): { groups: Map<string, IdentityGroup>; unassigned: UnassignedDocument[] } {
    const groups = new Map<string, IdentityGroup>();
    const unassigned: UnassignedDocument[] = [];

    for (const doc of documentRepo.getAll()) {
      const extraction = latestExtraction(doc.id);
      const photos = headshotService.photosForDocument(doc.id);
      if (!extraction) {
        unassigned.push({ id: doc.id, filename: doc.filename, mimeType: doc.mime_type, status: doc.status, uploadedAt: doc.uploaded_at, photos });
        continue;
      }

      const fields = extractionRepo.getFields(extraction.id);
      const givenNames = fieldValue(fields, GIVEN_NAMES_FIELD);
      const familyName = fieldValue(fields, FAMILY_NAME_FIELD);
      const dob = fieldValue(fields, DATE_OF_BIRTH_FIELD);

      if (!familyName || !dob) {
        unassigned.push({ id: doc.id, filename: doc.filename, mimeType: doc.mime_type, status: doc.status, uploadedAt: doc.uploaded_at, photos });
        continue;
      }

      const key = `${normalizeText(familyName)}|${normalizeText(givenNames)}|${normalizeDob(dob)}`;
      const identityId = identityIdFor(key);
      const existing = groups.get(identityId);
      if (existing) {
        existing.documents.push(doc);
      } else {
        groups.set(identityId, { givenNames, familyName, dob, documents: [doc] });
      }
    }

    return { groups, unassigned };
  }

  function statusCounts(documents: DocumentRow[]) {
    let extractedCount = 0;
    let pendingCount = 0;
    let failedCount = 0;
    for (const doc of documents) {
      if (doc.status === 'extracted') extractedCount++;
      else if (doc.status === 'failed') failedCount++;
      else pendingCount++;
    }
    return { extractedCount, pendingCount, failedCount };
  }

  function toSummary(identityId: string, group: IdentityGroup): IdentitySummary {
    const { extractedCount, pendingCount, failedCount } = statusCounts(group.documents);
    const givenNames = titleCase(group.givenNames);
    const familyName = titleCase(group.familyName);
    const photos = headshotService.photosForIdentity(identityId);
    const primary = photos.find((p) => p.verified) ?? photos[0] ?? null;
    return {
      identityId,
      givenNames,
      familyName,
      fullName: `${givenNames} ${familyName}`.trim(),
      dob: group.dob,
      documentCount: group.documents.length,
      extractedCount,
      pendingCount,
      failedCount,
      thumbnailUrl: primary?.url ?? null,
      photoCount: photos.length,
      previewDocuments: group.documents
        .slice(0, 8)
        .map((d) => ({ id: d.id, filename: d.filename, mimeType: d.mime_type, status: d.status })),
    };
  }

  function listIdentities(): IdentitySummary[] {
    const { groups } = buildGroups();
    const summaries = Array.from(groups.entries()).map(([id, group]) => toSummary(id, group));
    summaries.sort(
      (a, b) =>
        a.familyName.localeCompare(b.familyName) ||
        a.givenNames.localeCompare(b.givenNames) ||
        a.dob.localeCompare(b.dob),
    );
    return summaries;
  }

  function listUnassigned(): UnassignedDocument[] {
    const { unassigned } = buildGroups();
    return unassigned.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  }

  function getIdentityDetail(identityId: string): IdentityDetail | undefined {
    const { groups } = buildGroups();
    const group = groups.get(identityId);
    if (!group) return undefined;

    const documents: IdentityDocumentDetail[] = group.documents.map((document) => {
      const extraction = latestExtraction(document.id);
      return { document, extraction: extraction ? extractionRepo.getFullResult(extraction.id) ?? null : null };
    });

    // One row per field name: prefer an approved value over an unapproved one,
    // then the highest-confidence value, so the breakdown shows the value a
    // reviewer actually vouched for whenever one exists.
    const bestByField = new Map<string, IdentityFieldEntry>();
    for (const { document, extraction } of documents) {
      if (!extraction) continue;
      for (const f of extraction.fields) {
        const effective = f.correctedValue ?? f.value;
        if (!effective) continue;
        const candidate: IdentityFieldEntry = {
          name: f.name,
          value: effective,
          confidence: f.confidence,
          approved: f.approved,
          documentId: document.id,
          documentFilename: document.filename,
        };
        const existing = bestByField.get(f.name);
        if (
          !existing ||
          (candidate.approved && !existing.approved) ||
          (candidate.approved === existing.approved && candidate.confidence > existing.confidence)
        ) {
          bestByField.set(f.name, candidate);
        }
      }
    }

    return {
      ...toSummary(identityId, group),
      documents,
      fieldBreakdown: Array.from(bestByField.values()).sort(byCatalogueOrder),
      photos: headshotService.photosForIdentity(identityId),
      keyIdentifiers: keyIdentifiersFor(documents),
      creditScore: creditScoreFor(documents),
    };
  }

  return { listIdentities, listUnassigned, getIdentityDetail };
}

export type IdentityService = ReturnType<typeof createIdentityService>;

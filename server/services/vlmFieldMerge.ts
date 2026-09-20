/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Merges the fields the worker's Qwen page-merge returned (vlm_v2 pipeline) into the regex extraction of the same
 * text. Regex stays the validator: a Qwen value is only kept if it passes the same label/typed-shape sanity gate,
 * and a disagreement is surfaced as a 'warning' for human review instead of silently picking a side.
 *
 * Ownership: only values the model tagged as the applicant's fill the catalogue fields identities are grouped on. A
 * parent's "John" or a referee's phone number is stored as its own field ("Parent 1: Given Names"), never in the
 * applicant's slot, and a regex hit that turns out to be another person's value is downgraded to a warning.
 */
import { BANK_FIELD_DEFINITIONS, CORE_IDENTIFIER_DEFINITIONS } from '../../src/data/bankFields';
import { cleanNameValue, rejectReason } from '../../src/utils/valueSanity';
import type { ExtractionResult, FieldCategory } from '../../src/types';
import type { ExtractedField } from '../db/contracts';

export const SUBJECTS = ['applicant', 'spouse', 'parent', 'dependant', 'employer', 'referee', 'other'] as const;
export type Subject = (typeof SUBJECTS)[number] | 'unknown';

export interface VlmField {
  name: string;
  value: string;
  source: 'print' | 'handwriting';
  confidence: number;
  digitsVerified: boolean | null;
  evidence: string;
  /** Whose detail this is; 'unknown' when the worker did not say (never treated as the applicant silently). */
  subject: Subject;
  section: string;
  /** 1-based position within a multi-value cell ("John and Mary" -> 1, 2). */
  entry: number;
}

export const DOCUMENT_TYPES = [
  'loan_application', 'bank_statement', 'payslip', 'drivers_licence', 'passport', 'medicare_card', 'tax_return',
  'utility_bill', 'employment_contract', 'id_form_other', 'other',
] as const;
export function parseDocumentType(input: unknown): string | undefined {
  return typeof input === 'string' && (DOCUMENT_TYPES as readonly string[]).includes(input) ? input : undefined;
}

/** Qwen's field keys that differ from the app's field ids. */
const ALIAS: Record<string, string> = { drivers_licence_number: 'drivers_licence', occupation: 'occupation_industry' };

/** Short labels for other people's fields, e.g. "Parent 1: Given Names". */
const LABELS: Record<string, string> = {
  given_names: 'Given Names', family_name: 'Family Name', date_of_birth: 'Date of Birth',
  residential_address: 'Address', mobile_number: 'Mobile', email_address: 'Email', drivers_licence: 'Licence Number',
  passport_details: 'Passport', occupation_industry: 'Occupation', tax_file_number: 'Tax File Number',
  account_number: 'Account Number', bsb: 'BSB', abn: 'ABN',
};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const UNCLEAR = " Owner not stated: check it is the applicant's.";

/** Fields Qwen can return that the regex catalogue has no definition for. Kept, unvalidated, for review. */
const EXTRA_FIELDS: Record<string, { name: string; category: FieldCategory }> = {
  account_number: { name: 'Account Number', category: 'facility' },
  tax_file_number: { name: 'Tax File Number', category: 'identity' },
};

const DEFS = new Map([...BANK_FIELD_DEFINITIONS, ...CORE_IDENTIFIER_DEFINITIONS].map(d => [d.id, d]));
const MAX_FIELDS = 400;

/** The worker payload is untrusted input: keep only well-formed entries, capped in count and length. */
export function parseVlmFields(input: unknown): VlmField[] {
  if (!Array.isArray(input)) return [];
  const out: VlmField[] = [];
  for (const raw of input.slice(0, MAX_FIELDS)) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.name !== 'string' || typeof r.value !== 'string' || !r.value.trim()) continue;
    const conf = typeof r.confidence === 'number' && Number.isFinite(r.confidence) ? Math.min(1, Math.max(0, r.confidence)) : 0.5;
    out.push({
      name: r.name.slice(0, 64),
      value: r.value.trim().slice(0, 500),
      source: r.source === 'handwriting' ? 'handwriting' : 'print',
      confidence: conf,
      digitsVerified: typeof r.digits_verified === 'boolean' ? r.digits_verified : null,
      evidence: typeof r.evidence === 'string' ? r.evidence.slice(0, 200) : '',
      subject: (SUBJECTS as readonly string[]).includes(r.subject as string) ? (r.subject as Subject) : 'unknown',
      section: typeof r.section === 'string' ? r.section.slice(0, 120) : '',
      entry: typeof r.entry === 'number' && Number.isInteger(r.entry) && r.entry >= 1 ? Math.min(r.entry, 20) : 1,
    });
  }
  return out;
}

const same = (a: string | null, b: string) => (a ?? '').toLowerCase().replace(/[^a-z0-9]/g, '') === b.toLowerCase().replace(/[^a-z0-9]/g, '');

export function mergeVlmFields(
  regex: ExtractionResult[],
  vlm: VlmField[],
  toField: (r: ExtractionResult) => ExtractedField,
): ExtractedField[] {
  const fields = regex.map(toField);
  const byId = new Map(regex.map((r, i) => [r.fieldId, i]));
  // Highest-confidence reading of each field first, so a later weaker duplicate never overwrites it.
  const ordered = [...vlm].sort((a, b) => b.confidence - a.confidence);
  const done = new Set<string>();
  const others: Array<{ id: string; value: string; subject: Subject; section: string }> = [];

  for (const v of ordered) {
    const id = ALIAS[v.name] ?? v.name;
    const note = `Qwen (${v.source})${v.section ? `, under "${v.section}"` : ''}${v.evidence ? `: ${v.evidence}` : ''}`;

    // Another person's detail: its own named field, never the applicant's slot.
    if (v.subject !== 'applicant' && v.subject !== 'unknown') {
      const def = DEFS.get(id);
      const cleaned = cleanNameValue(id, v.value);
      if (def && rejectReason(id, cleaned, def.exampleLabels ?? [])) continue;
      const label = `${cap(v.subject)} ${v.entry}: ${LABELS[id] ?? def?.name ?? id}`;
      if (done.has(label)) continue;
      done.add(label);
      others.push({ id, value: cleaned, subject: v.subject, section: v.section });
      fields.push({
        name: label, value: cleaned, confidence: v.confidence, sourceSection: note, validated: false,
        validationStatus: v.digitsVerified === false ? 'warning' : 'pending', correctedValue: null, approved: false,
        category: def?.category ?? 'identity',
      });
      continue;
    }
    if (done.has(id)) continue;
    const unclear = v.subject === 'unknown' ? UNCLEAR : '';

    const extra = EXTRA_FIELDS[id];
    if (extra) {
      done.add(id);
      fields.push({
        name: extra.name, value: v.value, confidence: v.confidence, sourceSection: note + unclear, validated: false,
        validationStatus: v.digitsVerified === false || unclear ? 'warning' : 'pending', correctedValue: null,
        approved: false, category: extra.category,
      });
      continue;
    }

    const def = DEFS.get(id);
    const idx = byId.get(id);
    if (!def || idx === undefined) continue;
    const value = cleanNameValue(id, v.value);
    if (rejectReason(id, value, def.exampleLabels ?? [])) continue; // form text or wrong shape: not a value
    done.add(id);

    const cur = fields[idx];
    if (cur.value === null || cur.value === '') {
      fields[idx] = {
        ...cur, value, confidence: v.confidence, sourceSection: note + unclear, validated: false,
        validationStatus: v.digitsVerified === false || unclear ? 'warning' : 'pending',
      };
    } else if (same(cur.value, value)) {
      // two independent readers agree; an unstated owner still needs a look
      fields[idx] = {
        ...cur, confidence: Math.max(cur.confidence, v.confidence),
        ...(unclear ? { validationStatus: 'warning' as const, sourceSection: (cur.sourceSection ?? '') + unclear } : {}),
      };
    } else if (v.digitsVerified !== false) {
      fields[idx] = {
        ...cur, value, confidence: Math.min(v.confidence, 0.6), validated: false, validationStatus: 'warning',
        sourceSection: `${note}. Regex read "${cur.value}" instead; check the page.${unclear}`,
      };
    }
    // else: Qwen's digits were not read by any OCR engine, so the regex reading stands.
  }

  // A regex hit that is really somebody else's value (the parent's "John" read into given_names) is not trusted.
  for (const o of others) {
    const idx = byId.get(o.id);
    if (idx === undefined) continue;
    const cur = fields[idx];
    if (cur.value === null || !same(cur.value, o.value)) continue;
    const applicantHasIt = vlm.some(
      v => (v.subject === 'applicant' || v.subject === 'unknown') && (ALIAS[v.name] ?? v.name) === o.id && same(v.value, o.value),
    );
    if (applicantHasIt) continue;
    fields[idx] = {
      ...cur, confidence: Math.min(cur.confidence, 0.5), validated: false, validationStatus: 'warning',
      sourceSection: `${cur.sourceSection ?? ''} This value also appears under "${o.section || o.subject}" (${o.subject}); check it is the applicant's.`.trim(),
    };
  }
  return fields;
}

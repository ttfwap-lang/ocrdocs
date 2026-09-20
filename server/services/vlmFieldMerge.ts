/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Merges the fields the worker's Qwen page-merge returned (vlm_v2 pipeline) into the regex extraction of the same
 * text. Regex stays the validator: a Qwen value is only kept if it passes the same label/typed-shape sanity gate,
 * and a disagreement is surfaced as a 'warning' for human review instead of silently picking a side.
 */
import { BANK_FIELD_DEFINITIONS, CORE_IDENTIFIER_DEFINITIONS } from '../../src/data/bankFields';
import { cleanNameValue, rejectReason } from '../../src/utils/valueSanity';
import type { ExtractionResult, FieldCategory } from '../../src/types';
import type { ExtractedField } from '../db/contracts';

export interface VlmField {
  name: string;
  value: string;
  source: 'print' | 'handwriting';
  confidence: number;
  digitsVerified: boolean | null;
  evidence: string;
}

/** Qwen's field keys that differ from the app's field ids. */
const ALIAS: Record<string, string> = { drivers_licence_number: 'drivers_licence' };

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

  for (const v of ordered) {
    const id = ALIAS[v.name] ?? v.name;
    if (done.has(id)) continue;
    const note = `Qwen (${v.source})${v.evidence ? `: ${v.evidence}` : ''}`;

    const extra = EXTRA_FIELDS[id];
    if (extra) {
      done.add(id);
      fields.push({
        name: extra.name, value: v.value, confidence: v.confidence, sourceSection: note, validated: false,
        validationStatus: v.digitsVerified === false ? 'warning' : 'pending', correctedValue: null, approved: false,
        category: extra.category,
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
        ...cur, value, confidence: v.confidence, sourceSection: note, validated: false,
        validationStatus: v.digitsVerified === false ? 'warning' : 'pending',
      };
    } else if (same(cur.value, value)) {
      fields[idx] = { ...cur, confidence: Math.max(cur.confidence, v.confidence) }; // two independent readers agree
    } else if (v.digitsVerified !== false) {
      fields[idx] = {
        ...cur, value, confidence: Math.min(v.confidence, 0.6), validated: false, validationStatus: 'warning',
        sourceSection: `${note}. Regex read "${cur.value}" instead; check the page.`,
      };
    }
    // else: Qwen's digits were not read by any OCR engine, so the regex reading stands.
  }
  return fields;
}

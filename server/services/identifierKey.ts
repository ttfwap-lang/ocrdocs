/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Key-identifier keying and verification for the identity page.
 *
 * The Australian passport number and the driver's-licence number are the most important
 * key details, so they are not shown like any other extracted field. They carry:
 *   - a **triple-check tier**: a format check plus cross-source corroboration, where the
 *     number of distinct source documents that produced the same value is the confidence
 *     signal (2+ sources = `triple_checked`),
 *   - the **exact source files** the value was read from, so a reviewer can open the
 *     original and confirm it by eye.
 *
 * This module is the TypeScript twin of scripts/verify_identifiers.py; the two must agree
 * or the app and the offline evidence would disagree about what "verified" means.
 * tests/python/test_identifiers.py and tests/identifierKey.test.mjs pin both sides.
 *
 * Format rules, derived from the real corpus (not invented):
 *   - Australian passport: 1-2 letters then 6-8 digits, e.g. G50429525, E9628011,
 *     PB24868462, N6354675. Modern PA/PB/R-series numbers fit this shape.
 *   - AU driver's licence: 7-10 alphanumerics, at least one digit, at most 2 letters, so
 *     a trailing state code (081793L) passes but a word does not.
 *   - Issuing-country prefixes (`CHN`, `AUS`) and separators are stripped first, because
 *     the corpus stores them glued to the number.
 */

const COUNTRY_PREFIXES = ['AUS', 'CHN', 'NZL', 'GBR', 'CAN', 'USA', 'HKG', 'SGP', 'IND', 'PHL', 'VNM'];

const PASSPORT_RE = /^[A-Z]{1,2}\d{6,8}$/;
const LICENCE_RE = /^(?=.*\d)[A-Z0-9]{7,10}$/;
const LICENCE_LETTER_BUDGET = 2;

export type IdentifierKind = 'passport' | 'licence';
export type VerificationTier = 'triple_checked' | 'single_source' | 'format_fail' | 'absent';

/** Strip a leading issuing-country code such as `CHN ` or `AUS` from an identifier. */
export function stripCountry(value: string): string {
  let v = value.trim().toUpperCase();
  for (const prefix of COUNTRY_PREFIXES) {
    if (v.startsWith(`${prefix} `)) {
      return v.slice(prefix.length + 1).trim();
    }
  }
  return v;
}

/**
 * Canonical form used for both format checks and cross-document comparison.
 * Upper-cases, takes the first number of a multi-value cell, removes a country prefix,
 * and drops spaces/hyphens/dots.
 */
export function canonicaliseIdentifier(value: string): string {
  let v = (value || '').trim().toUpperCase();
  v = v.split(/[;/]/)[0].trim();
  v = stripCountry(v);
  return v.replace(/[\s\-.]+/g, '');
}

/** True when the canonical value is a plausible identifier of this kind. */
export function isValidIdentifier(kind: IdentifierKind, canonical: string): boolean {
  if (!canonical) return false;
  if (kind === 'passport') return PASSPORT_RE.test(canonical);
  if (kind === 'licence') {
    if (!LICENCE_RE.test(canonical)) return false;
    const letters = [...canonical].filter((ch) => /[A-Z]/.test(ch)).length;
    return letters <= LICENCE_LETTER_BUDGET && /\d/.test(canonical);
  }
  return false;
}

/**
 * The owner's rule: a value qualifies when it passes the format check and was read from
 * at least one source document. Two or more independent sources is the stronger signal
 * and is surfaced as `triple_checked`. A format failure is reported, never hidden, so a
 * reviewer can see and correct a borderline case.
 */
export function verificationTier(
  kind: IdentifierKind,
  canonical: string,
  sourceCount: number,
): VerificationTier {
  if (!canonical || !isValidIdentifier(kind, canonical)) return 'format_fail';
  return sourceCount >= 2 ? 'triple_checked' : 'single_source';
}

/** Human-facing explanation of what a tier means, for the identity page tooltip. */
export function tierExplanation(tier: VerificationTier, sourceCount: number): string {
  switch (tier) {
    case 'triple_checked':
      return `Format-valid and read from ${sourceCount} independent source documents`;
    case 'single_source':
      return 'Format-valid, but only one source document';
    case 'format_fail':
      return 'Did not match the expected Australian format - review the source file';
    case 'absent':
      return 'Not found in any document for this person';
  }
}

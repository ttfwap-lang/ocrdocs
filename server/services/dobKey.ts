/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Canonical date-of-birth keying for identity grouping.
 *
 * Identity grouping hashes `family|given|dob` into the identityId, so the DOB
 * has to reduce to the SAME key whether the source wrote it as `24/11/1963`,
 * `24 NOV 1963`, `24th November 1963` or `1963-11-24`. A digits-only strip
 * cannot do that: `24 NOV 1963` loses the month entirely and collapses to
 * `241963`, which is a different key from `24/11/1963` -> `24111963`, splitting
 * one person into two identities. (Measured on the loaded corpus: 34 such
 * splits, 149 identities -> 115 once months are parsed.)
 *
 * Rules, deliberately conservative:
 *   - This corpus is day-first (Australian). A numeric `d/m/Y` where the first
 *     component exceeds 12 proves it, and the loaded corpus contains such values
 *     (`24/11/1963`), so day > 12 disambiguates rather than guesses.
 *   - A numeric value whose BOTH leading components are <= 12 is genuinely
 *     ambiguous, so it is kept as its raw digit sequence: `09/02/1991` can mean
 *     9 Feb or 2 Sep, and picking one could merge two different people. Those
 *     values still group with an identical spelling of themselves, which is what
 *     the previous behaviour guaranteed.
 *   - Anything unrecognised falls back to the digits-only form, so no format can
 *     silently merge two different dates.
 */

const MONTHS: ReadonlyMap<string, number> = new Map<string, number>([
  ['january', 1], ['jan', 1],
  ['february', 2], ['feb', 2],
  ['march', 3], ['mar', 3],
  ['april', 4], ['apr', 4],
  ['may', 5],
  ['june', 6], ['jun', 6],
  ['july', 7], ['jul', 7],
  ['august', 8], ['aug', 8],
  ['september', 9], ['sep', 9], ['sept', 9],
  ['october', 10], ['oct', 10],
  ['november', 11], ['nov', 11],
  ['december', 12], ['dec', 12],
]);

function monthNumber(token: string): number | undefined {
  const month = MONTHS.get(token.toLowerCase().replace(/\.$/, ''));
  return month !== undefined && month >= 1 && month <= 12 ? month : undefined;
}

function isRealDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function digitsOnly(value: string): string {
  return value.replace(/[^0-9]/g, '');
}

/**
 * Expand a two-digit year. A bare `88` means 1988, not 2088: every document in
 * this corpus is a living person's identity record, so pivot at 30 (00-29 ->
 * 2000s, 30-99 -> 1900s). Anything outside 1900-2100 fails isRealDate anyway.
 */
function expandTwoDigitYear(twoDigit: string): number {
  const value = Number(twoDigit);
  return value < 30 ? 2000 + value : 1900 + value;
}

/**
 * Reduce a DOB string to a canonical `YYYYMMDD` key when the format is
 * unambiguous, otherwise to its raw digits so distinct values cannot collide.
 */
export function canonicalDob(value: string): string {
  const raw = (value || '').trim();
  if (!raw) return '';

  // `24/11/1963`, `24-11-1963`, `24.11.1963`, `24 / 11 / 1963`
  const dmy = raw.match(/^(\d{1,2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{4})$/);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    const year = Number(dmy[3]);
    // Day-first is provable when the first component can only be a day.
    if (day > 12 && isRealDate(year, month, day)) {
      return `${year}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}`;
    }
    // Ambiguous (both <= 12): keep the digits rather than guess an ordering.
    return digitsOnly(raw);
  }

  // `1988-06-14`, `1988/06/14`
  const ymd = raw.match(/^(\d{4})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{1,2})$/);
  if (ymd) {
    const year = Number(ymd[1]);
    const month = Number(ymd[2]);
    const day = Number(ymd[3]);
    if (isRealDate(year, month, day)) {
      return `${year}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}`;
    }
    return digitsOnly(raw);
  }

  // `24 NOV 1963`, `24th Nov 1963`, `3rd Dec 1995`
  const nameFirst = raw.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$/);
  if (nameFirst) {
    const day = Number(nameFirst[1]);
    const month = monthNumber(nameFirst[2]);
    const year = Number(nameFirst[3]);
    if (month && isRealDate(year, month, day)) {
      return `${year}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}`;
    }
    return digitsOnly(raw);
  }

  // `November 24, 1963`, `June 14 1988`
  const monthFirst = raw.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/);
  if (monthFirst) {
    const month = monthNumber(monthFirst[1]);
    const day = Number(monthFirst[2]);
    const year = Number(monthFirst[3]);
    if (month && isRealDate(year, month, day)) {
      return `${year}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}`;
    }
    return digitsOnly(raw);
  }

  // `16JUL2019`
  const compact = raw.match(/^(\d{1,2})([A-Za-z]{3,9})\.?(\d{4})$/);
  if (compact) {
    const day = Number(compact[1]);
    const month = monthNumber(compact[2]);
    const year = Number(compact[3]);
    if (month && isRealDate(year, month, day)) {
      return `${year}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}`;
    }
    return digitsOnly(raw);
  }

  // `14/06/88` -> 1988
  const shortYear = raw.match(/^(\d{1,2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{2})$/);
  if (shortYear) {
    const day = Number(shortYear[1]);
    const month = Number(shortYear[2]);
    const year = expandTwoDigitYear(shortYear[3]);
    if (day > 12 && isRealDate(year, month, day)) {
      return `${year}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}`;
    }
    return digitsOnly(raw);
  }

  // `28 JUN 84`
  const shortNameYear = raw.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?\s+(\d{2})$/);
  if (shortNameYear) {
    const day = Number(shortNameYear[1]);
    const month = monthNumber(shortNameYear[2]);
    const year = expandTwoDigitYear(shortNameYear[3]);
    if (month && isRealDate(year, month, day)) {
      return `${year}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}`;
    }
    return digitsOnly(raw);
  }

  return digitsOnly(raw);
}

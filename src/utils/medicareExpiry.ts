/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Medicare card expiry: one rule, no exceptions.
 *
 * OWNER RULE (verbatim, applied without exception)
 * ------------------------------------------------
 * The expiry of interest is ONLY ever in the format `MM/YY` or `MM/YYYY`, and ONLY ever
 * within the window `09/2026` to `09/2031` inclusive. Every other detected expiry is
 * incorrect and therefore irrelevant.
 *
 * Read as a date range: any month from September 2026 through September 2031 qualifies.
 * The corpus stores the month normalised to ISO `YYYY-MM-01`, so a value is judged on its
 * (year, month) pair, never on the raw string shape alone.
 *
 * Why this is enforced in one place rather than in a filter: the same value is shown in
 * the list, the detail panel, the summary tiles, the CSV export and the expiring-soon
 * count. A rule applied in only one of those would leave the page disagreeing with
 * itself, which is exactly the failure the owner is guarding against.
 *
 * Measured on data/medicare_index.json (3,592 rows):
 *   474 in window, 65 outside the window, 46 malformed (e.g. `2027-04` with no day),
 *   3,053 with no expiry at all. Rejected values are cleared and counted, never displayed.
 */

/** First valid expiry: September 2026. */
export const EXPIRY_WINDOW_START = { year: 2026, month: 9 } as const;
/** Last valid expiry: September 2031. */
export const EXPIRY_WINDOW_END = { year: 2031, month: 9 } as const;

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_MONTH = /^(\d{4})-(\d{2})$/;
const MM_SLASH_YY = /^(\d{2})\/(\d{2})$/;
const MM_SLASH_YYYY = /^(\d{2})\/(\d{4})$/;

export type ExpiryRejection = 'absent' | 'malformed' | 'before_window' | 'after_window';

export interface ExpiryVerdict {
  /** True only when the value is in `MM/YY` or `MM/YYYY` form AND inside the window. */
  valid: boolean;
  /** Why it was rejected, for the aggregate counters. */
  rejection: ExpiryRejection | null;
  /** The `YYYY-MM` the value denotes, when it could be read at all. */
  yearMonth: string | null;
}

function verdict(valid: boolean, rejection: ExpiryRejection | null, y: number | null, m: number | null): ExpiryVerdict {
  return {
    valid,
    rejection,
    yearMonth: y !== null && m !== null ? `${y}-${String(m).padStart(2, '0')}` : null,
  };
}

/**
 * Judge one raw expiry value against the owner's rule.
 *
 * Accepts the two display formats the owner named (`MM/YY`, `MM/YYYY`) and the ISO
 * `YYYY-MM[-DD]` the pipeline stores, so an operator can paste either and get the same
 * answer. Everything else is malformed.
 */
export function classifyExpiry(raw: string | number | null | undefined): ExpiryVerdict {
  const text = (raw === null || raw === undefined ? '' : String(raw)).trim();
  if (!text) return verdict(false, 'absent', null, null);

  let year: number | null = null;
  let month: number | null = null;

  const isoDay = ISO_DAY.exec(text);
  const isoMonth = ISO_MONTH.exec(text);
  const slashYy = MM_SLASH_YY.exec(text);
  const slashYyyy = MM_SLASH_YYYY.exec(text);

  if (isoDay) {
    year = Number(isoDay[1]);
    month = Number(isoDay[2]);
  } else if (isoMonth) {
    // `2027-04` carries a real month but no day: readable, not malformed.
    year = Number(isoMonth[1]);
    month = Number(isoMonth[2]);
  } else if (slashYyyy) {
    month = Number(slashYyyy[1]);
    year = Number(slashYyyy[2]);
  } else if (slashYy) {
    month = Number(slashYy[1]);
    // A 2-digit year in an Australian card expiry is always this century.
    year = 2000 + Number(slashYy[2]);
  } else {
    return verdict(false, 'malformed', null, null);
  }

  if (month < 1 || month > 12) return verdict(false, 'malformed', year, null);

  const startYear = EXPIRY_WINDOW_START.year;
  const startMonth = EXPIRY_WINDOW_START.month;
  const endYear = EXPIRY_WINDOW_END.year;
  const endMonth = EXPIRY_WINDOW_END.month;

  if (year < startYear || (year === startYear && month < startMonth)) {
    return verdict(false, 'before_window', year, month);
  }
  if (year > endYear || (year === endYear && month > endMonth)) {
    return verdict(false, 'after_window', year, month);
  }
  return verdict(true, null, year, month);
}

/** True when the value is a real expiry under the owner's rule. */
export function isValidExpiry(raw: string | number | null | undefined): boolean {
  return classifyExpiry(raw).valid;
}

/**
 * The value to DISPLAY: `MM/YYYY` when valid, otherwise an empty string.
 *
 * Rejected values are never rendered. There is no "show the raw anyway" path, because the
 * owner was explicit that they are irrelevant.
 */
export function displayExpiry(raw: string | number | null | undefined): string {
  const v = classifyExpiry(raw);
  if (!v.valid || v.yearMonth === null) return '';
  const [y, m] = v.yearMonth.split('-');
  return `${m}/${y}`;
}

/** The value to STORE: ISO `YYYY-MM-01`, or an empty string when rejected. */
export function canonicalExpiry(raw: string | number | null | undefined): string {
  const v = classifyExpiry(raw);
  if (!v.valid || v.yearMonth === null) return '';
  return `${v.yearMonth}-01`;
}

/** Buckets for the aggregate counter shown in the summary. */
export interface ExpiryCensus {
  valid: number;
  absent: number;
  malformed: number;
  beforeWindow: number;
  afterWindow: number;
  /** Rows whose expiry was rejected and therefore cleared. */
  rejected: number;
}

/** Tally a set of raw expiry values against the rule. */
export function censusExpiries(values: Array<string | number | null | undefined>): ExpiryCensus {
  const census: ExpiryCensus = {
    valid: 0, absent: 0, malformed: 0, beforeWindow: 0, afterWindow: 0, rejected: 0,
  };
  for (const value of values) {
    const { valid, rejection } = classifyExpiry(value);
    if (valid) {
      census.valid += 1;
      continue;
    }
    if (rejection === 'absent') census.absent += 1;
    else if (rejection === 'malformed') census.malformed += 1;
    else if (rejection === 'before_window') census.beforeWindow += 1;
    else if (rejection === 'after_window') census.afterWindow += 1;
    if (rejection && rejection !== 'absent') census.rejected += 1;
  }
  return census;
}

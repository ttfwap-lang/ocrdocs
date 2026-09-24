/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Medicare index service.
 *
 * Imports `data/medicare_index.json` (the output of the archive PHI pipeline)
 * into the `medicare_patients` / `medicare_patient_sources` tables, then serves
 * the whole index as a searchable, filterable, sortable page.
 *
 * The import is fingerprint-guarded: boot only rewrites the tables when the
 * JSON actually changed, so restarts stay fast and the loaded set is always
 * traceable to one build of the source data.
 *
 * IMPORTANT: this data is real patient PHI. The service never logs field
 * values, and the index path is treated as private data.
 */

import { createHash } from 'crypto';
import { existsSync, readFileSync, statSync } from 'fs';
import { resolve } from 'path';
import type { Database as DatabaseType } from 'better-sqlite3';
import {
  canonicalExpiry,
  censusExpiries,
  expiresWithinMonths,
  isExpiredMonth,
  type ExpiryCensus,
} from '../../src/utils/medicareExpiry';

const DEFAULT_INDEX_PATH = 'data/medicare_index.json';

/**
 * Bumped whenever the import TRANSFORM changes, not just the source file.
 *
 * The import is guarded by a fingerprint of the source JSON. Without a rule version, a
 * change to the expiry rule (or any other import behaviour) would leave an already-synced
 * table untouched -- the JSON is byte-identical, so the guard would skip the work and the
 * database would keep serving values the current code would reject. That happened once:
 * tightening the expiry window produced no change on screen until this was noticed.
 */
const MEDICARE_IMPORT_RULE_VERSION = 2;

export interface MedicareIndexRow {
  patient_id: string;
  full_name?: string;
  name_display?: string;
  name_status?: string;
  name_flags?: string;
  title?: string;
  surname?: string;
  given_name?: string;
  middle_names?: string;
  dob_iso?: string;
  sex?: string;
  medicare_number?: string;
  medicare_valid?: string | number;
  medicare_len?: string | number;
  medicare_flags?: string;
  mrn?: string;
  phone?: string;
  email?: string;
  address_full?: string;
  suburb?: string;
  state?: string;
  postcode?: string;
  referrer?: string;
  tests?: string;
  diagnoses?: string;
  expiry_tokens?: string;
  expiry_best_word?: string;
  expiry_best_date?: string;
  expiry_best_raw?: string;
  expiry_best_precision?: string;
  has_expiry?: string | number;
  /** Set by the importer when a stored expiry was rejected by the owner's window rule. */
  expiry_rejected?: string | number;
  record_count?: string | number;
  confidence_best?: string;
  doc_dates_range?: string;
  source_files?: string;
  needs_review?: string | number;
  name_suspect?: string | number;
  completeness?: string | number;
}

export interface MedicarePatient extends MedicareIndexRow {
  sources: string[];
}

export interface MedicareSummary {
  loaded: boolean;
  loadedAt: string | null;
  sourcePath: string;
  patients: number;
  withMedicare: number;
  medicareVerified: number;
  medicareFailed: number;
  medicareUnverifiable: number;
  withoutMedicare: number;
  withExpiry: number;
  /**
   * Expiry counts are at MONTH granularity, matching the owner's MM/YY rule: the current
   * month is never "expired", and "expiring soon" means this month plus the next three.
   */
  expiringSoon: number;
  expired: number;
  /**
   * How raw expiry values were judged by the owner's rule (MM/YY or MM/YYYY, 09/2026 to
   * 09/2031). `rejected` is the number that were cleared and are never displayed.
   */
  expiryCensus: ExpiryCensus;
  needsReview: number;
  nameStatus: Record<string, number>;
  sexBreakdown: Record<string, number>;
  stateBreakdown: Record<string, number>;
  recordTotal: number;
  distinctMedicareNumbers: number;
}

export interface MedicareQuery {
  q?: string;
  medicareState?: 'all' | 'verified' | 'failed' | 'unverifiable' | 'absent';
  nameStatus?: 'all' | 'ok' | 'suspect' | 'form_label' | 'missing';
  expiryState?: 'all' | 'with' | 'without' | 'expired' | 'expiring_soon';
  sex?: string;
  state?: string;
  needsReview?: 'all' | 'only' | 'clean';
  sort?: string;
  dir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface MedicareQueryResult {
  rows: MedicarePatient[];
  total: number;
  limit: number;
  offset: number;
  sort: string;
  dir: 'asc' | 'desc';
}

const SORTABLE = new Set([
  'patient_id', 'full_name', 'name_display', 'surname', 'given_name', 'dob_iso',
  'sex', 'medicare_number', 'medicare_len', 'mrn', 'suburb', 'state', 'postcode',
  'expiry_best_date', 'record_count', 'completeness', 'needs_review', 'medicare_valid',
]);

const MAX_LIMIT = 500;

function indexPath(): string {
  return resolve(process.env.MEDICARE_INDEX_PATH || DEFAULT_INDEX_PATH);
}

function asInt(value: string | number | undefined | null, fallback: number): number {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Digits-only, lowercased haystack for one patient. */
function searchBlob(r: MedicareIndexRow): string {
  return [
    r.patient_id, r.full_name, r.name_display, r.title, r.surname, r.given_name,
    r.middle_names, r.dob_iso, r.sex, r.medicare_number, r.mrn, r.phone, r.email,
    r.address_full, r.suburb, r.state, r.postcode, r.referrer, r.diagnoses,
    r.expiry_best_date, r.expiry_tokens, r.source_files,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function splitSources(raw: string): string[] {
  return raw
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Import the JSON index into SQLite. No-ops when the file is missing and when
 * the stored fingerprint already matches, so calling this on every boot is safe.
 */
export function syncMedicareIndex(db: DatabaseType): { loaded: boolean; rows: number; reason: string } {
  const path = indexPath();

  if (!existsSync(path)) {
    return { loaded: false, rows: 0, reason: `index not found at ${path}` };
  }

  const raw = readFileSync(path, 'utf8');
  // Hash the source AND the rule version, so a logic change forces a re-import even when
  // the JSON is unchanged.
  const fingerprint = createHash('sha256')
    .update(`rule-v${MEDICARE_IMPORT_RULE_VERSION}\n`)
    .update(raw)
    .digest('hex');

  const current = db
    .prepare('SELECT fingerprint, row_count FROM medicare_index_meta WHERE id = 1')
    .get() as { fingerprint: string; row_count: number } | undefined;

  if (current && current.fingerprint === fingerprint) {
    return { loaded: true, rows: current.row_count, reason: 'unchanged' };
  }

  let parsed: MedicareIndexRow[];
  try {
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) throw new Error('index JSON is not an array');
    parsed = data;
  } catch (err) {
    // A malformed index must not take the whole server down at boot.
    return { loaded: false, rows: 0, reason: `index parse failed: ${(err as Error).message}` };
  }

  const insertPatient = db.prepare(`
    INSERT INTO medicare_patients (
      patient_id, full_name, name_display, name_status, name_flags, title,
      surname, given_name, middle_names, dob_iso, sex, medicare_number,
      medicare_valid, medicare_len, medicare_flags, mrn, phone, email,
      address_full, suburb, state, postcode, referrer, tests, diagnoses,
      expiry_tokens, expiry_best_word, expiry_best_date, expiry_best_raw,
      expiry_best_precision, has_expiry, record_count, confidence_best,
      doc_dates_range, source_files, needs_review, name_suspect, completeness, search_blob
    ) VALUES (
      @patient_id, @full_name, @name_display, @name_status, @name_flags, @title,
      @surname, @given_name, @middle_names, @dob_iso, @sex, @medicare_number,
      @medicare_valid, @medicare_len, @medicare_flags, @mrn, @phone, @email,
      @address_full, @suburb, @state, @postcode, @referrer, @tests, @diagnoses,
      @expiry_tokens, @expiry_best_word, @expiry_best_date, @expiry_best_raw,
      @expiry_best_precision, @has_expiry, @record_count, @confidence_best,
      @doc_dates_range, @source_files, @needs_review, @name_suspect, @completeness, @search_blob
    )
  `);  const insertSource = db.prepare(
    'INSERT OR IGNORE INTO medicare_patient_sources (patient_id, source_file) VALUES (?, ?)',
  );

  let rejectedExpiries = 0;
  const run = db.transaction((rows: MedicareIndexRow[]) => {
    db.exec('DELETE FROM medicare_patient_sources; DELETE FROM medicare_patients;');
    for (const r of rows) {
      if (!r || !r.patient_id) continue;
      const medicareValid =
        r.medicare_valid === '' || r.medicare_valid === undefined || r.medicare_valid === null
          ? null
          : asInt(r.medicare_valid, 0);
      // OWNER RULE: only an MM/YY or MM/YYYY expiry inside 09/2026..09/2031 is real.
      // Anything else is incorrect and irrelevant, so it is cleared here -- once, at the
      // boundary -- and every reader downstream sees only values that passed. `has_expiry`
      // follows the stored value so a cleared row is consistently "no expiry", never
      // "has an expiry we chose not to show".
      const rawExpiry = r.expiry_best_date ?? '';
      const storedExpiry = canonicalExpiry(rawExpiry);
      const expiryRejected = rawExpiry.trim() !== '' && storedExpiry === '' ? 1 : 0;
      if (expiryRejected) rejectedExpiries += 1;
      const hasExpiry = storedExpiry ? 1 : 0;
      insertPatient.run({
        patient_id: r.patient_id,
        full_name: r.full_name ?? '',
        name_display: r.name_display ?? '',
        name_status: r.name_status ?? 'ok',
        name_flags: r.name_flags ?? '',
        title: r.title ?? '',
        surname: r.surname ?? '',
        given_name: r.given_name ?? '',
        middle_names: r.middle_names ?? '',
        dob_iso: r.dob_iso ?? '',
        sex: r.sex ?? '',
        medicare_number: r.medicare_number ?? '',
        medicare_valid: medicareValid,
        medicare_len: asInt(r.medicare_len, 0),
        medicare_flags: r.medicare_flags ?? '',
        mrn: r.mrn ?? '',
        phone: r.phone ?? '',
        email: r.email ?? '',
        address_full: r.address_full ?? '',
        suburb: r.suburb ?? '',
        state: r.state ?? '',
        postcode: r.postcode ?? '',
        referrer: r.referrer ?? '',
        tests: r.tests ?? '',
        diagnoses: r.diagnoses ?? '',
        expiry_tokens: r.expiry_tokens ?? '',
        expiry_best_word: r.expiry_best_word ?? '',
        expiry_best_date: storedExpiry,
        expiry_best_raw: r.expiry_best_raw ?? '',
        expiry_best_precision: r.expiry_best_precision ?? '',
        has_expiry: hasExpiry,
        record_count: asInt(r.record_count, 0),
        confidence_best: r.confidence_best ?? '',
        doc_dates_range: r.doc_dates_range ?? '',
        source_files: r.source_files ?? '',
        needs_review: asInt(r.needs_review, 0),
        name_suspect: asInt(r.name_suspect, 0),
        completeness: asInt(r.completeness, 0),
        // Index the canonical (rule-checked) expiry, not the raw one, so a rejected value
        // can never be found by searching for it.
        search_blob: searchBlob({ ...r, expiry_best_date: storedExpiry }),
      });
      for (const src of splitSources(r.source_files ?? '')) {
        insertSource.run(r.patient_id, src);
      }
    }
    db.prepare(
      `INSERT INTO medicare_index_meta (id, fingerprint, row_count, loaded_at)
       VALUES (1, ?, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET
         fingerprint = excluded.fingerprint,
         row_count   = excluded.row_count,
         loaded_at   = excluded.loaded_at`,
    ).run(fingerprint, rows.length);
  });

  run(parsed);
  return { loaded: true, rows: parsed.length, reason: 'imported' };
}

function countBy(db: DatabaseType, column: string): Record<string, number> {
  if (!SORTABLE.has(column) && !['has_expiry', 'name_status'].includes(column)) return {};
  const rows = db
    .prepare(
      `SELECT CASE WHEN ${column} = '' THEN '(blank)' ELSE ${column} END AS key, COUNT(*) AS n
       FROM medicare_patients GROUP BY key ORDER BY n DESC`,
    )
    .all() as Array<{ key: string; n: number }>;
  const out: Record<string, number> = {};
  for (const r of rows) out[r.key] = r.n;
  return out;
}

/**
 * Tally the raw expiry values in the source JSON against the owner's rule.
 *
 * Read from the file rather than the database, because the database already has the
 * rejected values cleared -- counting there would report them as merely absent and the
 * summary would understate how many detections the rule threw out.
 *
 * Cached on the file's mtime + size. The dashboard polls the summary, and re-parsing 3.3 MB
 * of JSON on every poll was pure waste; the census only changes when the file does.
 */
let censusCache: { key: string; census: ExpiryCensus } | null = null;

function readExpiryCensus(): ExpiryCensus {
  const empty: ExpiryCensus = {
    valid: 0, absent: 0, malformed: 0, beforeWindow: 0, afterWindow: 0, rejected: 0,
  };
  const path = indexPath();
  if (!existsSync(path)) return empty;
  try {
    const stat = statSync(path);
    const key = `${stat.mtimeMs}:${stat.size}`;
    if (censusCache && censusCache.key === key) return censusCache.census;
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (!Array.isArray(parsed)) return empty;
    const census = censusExpiries(
      (parsed as MedicareIndexRow[]).map((r) => r?.expiry_best_date ?? ''),
    );
    censusCache = { key, census };
    return census;
  } catch {
    return empty;
  }
}

/** Corpus-wide counts for the dashboard header. */
export function getMedicareSummary(db: DatabaseType): MedicareSummary {
  const meta = db
    .prepare('SELECT loaded_at, row_count FROM medicare_index_meta WHERE id = 1')
    .get() as { loaded_at: string; row_count: number } | undefined;

  const one = (sql: string, params: unknown[] = []): number => {
    const row = db.prepare(sql).get(...params) as { n: number } | undefined;
    return row ? row.n : 0;
  };

  // The owner's rule is defined at MONTH granularity, and the store pins the day to 01.
  // Counting days from that synthetic 1st would report a card expiring "09/2026" as
  // expired 23 days ago on the 24th, when September has not ended. So the relative
  // measures are computed in whole months, in JS, over the already-canonical values.
  const expiryRows = db
    .prepare("SELECT expiry_best_date FROM medicare_patients WHERE expiry_best_date <> ''")
    .all() as Array<{ expiry_best_date: string }>;
  const today = new Date();
  let expired = 0;
  let expiringSoon = 0;
  for (const row of expiryRows) {
    if (isExpiredMonth(row.expiry_best_date, today)) expired += 1;
    else if (expiresWithinMonths(row.expiry_best_date, 3, today)) expiringSoon += 1;
  }

  // Judge the RAW source values so the counters explain what the rule removed, rather
  // than counting the already-cleared stored values (which would read as simply absent).
  const expiryCensus = readExpiryCensus();

  return {
    loaded: Boolean(meta),
    loadedAt: meta?.loaded_at ?? null,
    sourcePath: indexPath(),
    patients: one('SELECT COUNT(*) AS n FROM medicare_patients'),
    withMedicare: one("SELECT COUNT(*) AS n FROM medicare_patients WHERE medicare_number <> ''"),
    medicareVerified: one('SELECT COUNT(*) AS n FROM medicare_patients WHERE medicare_valid = 1'),
    medicareFailed: one('SELECT COUNT(*) AS n FROM medicare_patients WHERE medicare_valid = 0'),
    medicareUnverifiable: one(
      "SELECT COUNT(*) AS n FROM medicare_patients WHERE medicare_number <> '' AND medicare_valid IS NULL",
    ),
    withoutMedicare: one("SELECT COUNT(*) AS n FROM medicare_patients WHERE medicare_number = ''"),
    withExpiry: one('SELECT COUNT(*) AS n FROM medicare_patients WHERE has_expiry = 1'),
    expiringSoon,
    expired,
    expiryCensus,
    needsReview: one('SELECT COUNT(*) AS n FROM medicare_patients WHERE needs_review = 1'),
    nameStatus: countBy(db, 'name_status'),
    sexBreakdown: countBy(db, 'sex'),
    stateBreakdown: countBy(db, 'state'),
    recordTotal: one('SELECT COALESCE(SUM(record_count), 0) AS n FROM medicare_patients'),
    distinctMedicareNumbers: one(
      "SELECT COUNT(DISTINCT medicare_number) AS n FROM medicare_patients WHERE medicare_number <> ''",
    ),
  };
}

/** Build the WHERE clause shared by the list and CSV export. */
function buildFilters(q: MedicareQuery): { sql: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];

  const search = (q.q || '').trim().toLowerCase();
  if (search) {
    // Every whitespace-separated term must appear somewhere in the row.
    for (const term of search.split(/\s+/).slice(0, 6)) {
      clauses.push('search_blob LIKE ?');
      params.push(`%${term}%`);
    }
  }

  switch (q.medicareState) {
    case 'verified':
      clauses.push('medicare_valid = 1');
      break;
    case 'failed':
      clauses.push('medicare_valid = 0');
      break;
    case 'unverifiable':
      clauses.push("medicare_number <> '' AND medicare_valid IS NULL");
      break;
    case 'absent':
      clauses.push("medicare_number = ''");
      break;
    default:
      break;
  }

  if (q.nameStatus && q.nameStatus !== 'all') {
    clauses.push('name_status = ?');
    params.push(q.nameStatus);
  }

  if (q.sex) {
    clauses.push('sex = ?');
    params.push(q.sex);
  }
  if (q.state) {
    clauses.push('state = ?');
    params.push(q.state);
  }

  switch (q.expiryState) {
    case 'with':
      // "Has expiry" now means "has an expiry that passed the owner's window rule",
      // because anything else was cleared at import.
      clauses.push('has_expiry = 1');
      break;
    case 'without':
      clauses.push('has_expiry = 0');
      break;
    case 'expired':
      // Month granularity: the expiry is MM/YY, and the stored day is a synthetic 01, so
      // comparing against date('now') would flag the current month as already expired.
      clauses.push("expiry_best_date <> '' AND expiry_best_date < date('now', 'start of month')");
      break;
    case 'expiring_soon':
      // Current month plus the next three, inclusive.
      clauses.push(
        "expiry_best_date >= date('now', 'start of month') " +
          "AND expiry_best_date < date('now', 'start of month', '+4 months')",
      );
      break;
    default:
      break;
  }

  if (q.needsReview === 'only') {
    clauses.push('needs_review = 1');
  } else if (q.needsReview === 'clean') {
    clauses.push('needs_review = 0');
  }

  return { sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

/** Paginated, filtered, sorted slice of the index. */
export function queryMedicarePatients(db: DatabaseType, q: MedicareQuery = {}): MedicareQueryResult {
  const sort = q.sort && SORTABLE.has(q.sort) ? q.sort : 'patient_id';
  const dir = q.dir === 'desc' ? 'desc' : 'asc';
  const limit = Math.min(Math.max(asInt(q.limit, 50), 1), MAX_LIMIT);
  const offset = Math.max(asInt(q.offset, 0), 0);
  const { sql, params } = buildFilters(q);

  const totalRow = db
    .prepare(`SELECT COUNT(*) AS n FROM medicare_patients ${sql}`)
    .get(...params) as { n: number };

  // NULLS LAST keeps blank values (missing DOB etc.) out of the way ascending.
  const rows = db
    .prepare(
      `SELECT * FROM medicare_patients ${sql}
       ORDER BY (${sort} = '') ASC, ${sort} ${dir.toUpperCase()}, patient_id ASC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as MedicareIndexRow[];

  return {
    rows: rows.map((r) => ({
      ...r,
      medicare_valid: r.medicare_valid === null || r.medicare_valid === undefined ? '' : r.medicare_valid,
      has_expiry: asInt(r.has_expiry, 0),
      needs_review: asInt(r.needs_review, 0),
      name_suspect: asInt(r.name_suspect, 0),
      record_count: asInt(r.record_count, 0),
      completeness: asInt(r.completeness, 0),
      medicare_len: asInt(r.medicare_len, 0),
      sources: splitSources(r.source_files ?? ''),
    })),
    total: totalRow.n,
    limit,
    offset,
    sort,
    dir,
  };
}

/** Every matching row (no pagination) for CSV export. */
export function allMedicarePatients(db: DatabaseType, q: MedicareQuery = {}): MedicarePatient[] {
  const sort = q.sort && SORTABLE.has(q.sort) ? q.sort : 'patient_id';
  const dir = q.dir === 'desc' ? 'desc' : 'asc';
  const { sql, params } = buildFilters(q);
  const rows = db
    .prepare(
      `SELECT * FROM medicare_patients ${sql}
       ORDER BY (${sort} = '') ASC, ${sort} ${dir.toUpperCase()}, patient_id ASC
       LIMIT ${MAX_LIMIT * 40}`,
    )
    .all(...params) as MedicareIndexRow[];
  return rows.map((r) => ({
    ...r,
    medicare_valid: r.medicare_valid === null || r.medicare_valid === undefined ? '' : r.medicare_valid,
    sources: splitSources(r.source_files ?? ''),
  }));
}

/** One patient plus the normalised source-file list. */
export function getMedicarePatient(db: DatabaseType, patientId: string): MedicarePatient | null {
  const row = db
    .prepare('SELECT * FROM medicare_patients WHERE patient_id = ?')
    .get(patientId) as MedicareIndexRow | undefined;
  if (!row) return null;
  const sources = (
    db
      .prepare('SELECT source_file FROM medicare_patient_sources WHERE patient_id = ? ORDER BY source_file')
      .all(patientId) as Array<{ source_file: string }>
  ).map((r) => r.source_file);
  return {
    ...row,
    medicare_valid: row.medicare_valid === null || row.medicare_valid === undefined ? '' : row.medicare_valid,
    sources: sources.length ? sources : splitSources(row.source_files ?? ''),
  };
}

export const MEDICARE_SORTABLE_COLUMNS = Array.from(SORTABLE);
export { indexPath as medicareIndexPath };

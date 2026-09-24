/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Medicare index — the full archive PHI extraction as a reviewable page.
 *
 * Every deduplicated patient in the corpus (GET /api/medicare/patients), with
 * their Medicare number, checksum verdict, DOB, expiry dates and the source
 * documents each value came from. Search, filter and sort all happen in SQLite
 * so the whole corpus is navigable without shipping it to the browser.
 *
 * Two things this page is deliberately honest about:
 *  - `medicare_valid`: a verified checksum is strong evidence the digits are a
 *    real Medicare number; 'failed' and blank are surfaced, not hidden.
 *  - `name_status`: where the extractor only caught a form heading or a piece of
 *    prose, the name is shown as unavailable rather than passed off as a
 *    patient. Those rows are still searchable by Medicare number / DOB.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  RefreshCw,
  Search,
  FileSpreadsheet,
  ShieldCheck,
  ShieldAlert,
  ShieldQuestion,
  CalendarClock,
  UserRound,
  X,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  AlertTriangle,
  Database,
  ListFilter,
  UserX,
  Copy,
  Check,
} from 'lucide-react';
import type { MedicarePatient, MedicareQueryResponse, MedicareSummary } from '../types';
// The owner's expiry rule, imported so the UI and the importer cannot disagree about
// which value is real. Lives in src/utils because both the browser bundle and the
// server use it. See src/utils/medicareExpiry.ts.
import { displayExpiry } from '../utils/medicareExpiry';

const PAGE_SIZES = [25, 50, 100, 200];

interface Filters {
  q: string;
  medicare_state: string;
  name_status: string;
  expiry_state: string;
  sex: string;
  state: string;
  needs_review: string;
}

const EMPTY_FILTERS: Filters = {
  q: '',
  medicare_state: 'all',
  name_status: 'all',
  expiry_state: 'all',
  sex: '',
  state: '',
  needs_review: 'all',
};

function buildQuery(filters: Filters, sort: string, dir: string, limit: number, offset: number): string {
  const p = new URLSearchParams();
  if (filters.q.trim()) p.set('q', filters.q.trim());
  if (filters.medicare_state !== 'all') p.set('medicare_state', filters.medicare_state);
  if (filters.name_status !== 'all') p.set('name_status', filters.name_status);
  if (filters.expiry_state !== 'all') p.set('expiry_state', filters.expiry_state);
  if (filters.sex) p.set('sex', filters.sex);
  if (filters.state) p.set('state', filters.state);
  if (filters.needs_review !== 'all') p.set('needs_review', filters.needs_review);
  p.set('sort', sort);
  p.set('dir', dir);
  p.set('limit', String(limit));
  p.set('offset', String(offset));
  return p.toString();
}

/** Verdict badge for the Medicare checksum. */
function MedicareBadge({ row }: { row: MedicarePatient }) {
  if (!row.medicare_number) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase text-slate-600 border border-slate-700/60 rounded px-1.5 py-0.5">
        <UserX className="w-3 h-3" /> none
      </span>
    );
  }
  if (row.medicare_valid === 1) {
    return (
      <span
        className="inline-flex items-center gap-1 text-[10px] font-mono uppercase text-matrix-400 text-glow-green border border-matrix-500/40 bg-matrix-900/30 rounded px-1.5 py-0.5"
        title="Australian Medicare checksum verified (mod 10)"
      >
        <ShieldCheck className="w-3 h-3" /> verified
      </span>
    );
  }
  if (row.medicare_valid === 0) {
    return (
      <span
        className="inline-flex items-center gap-1 text-[10px] font-mono uppercase text-rose-400 border border-rose-500/40 bg-rose-950/30 rounded px-1.5 py-0.5"
        title="Checksum failed — the digits are probably an OCR misread"
      >
        <ShieldAlert className="w-3 h-3" /> failed
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-mono uppercase text-amber-300 border border-amber-500/40 bg-amber-950/30 rounded px-1.5 py-0.5"
      title="No verifiable checksum on this number length"
    >
      <ShieldQuestion className="w-3 h-3" /> unchecked
    </span>
  );
}

function NameCell({ row }: { row: MedicarePatient }) {
  if (row.name_status === 'ok' && row.name_display) {
    return <span className="text-slate-200">{row.name_display}</span>;
  }
  return (
    <span
      className="text-slate-500 italic"
      title={
        row.name_status === 'form_label'
          ? 'Extractor captured a form heading, not a person — match by Medicare number or DOB'
          : row.name_status === 'missing'
            ? 'No name was captured for this patient — match by Medicare number or DOB'
            : 'Extracted name looks like a sentence fragment — verify against the source document'
      }
    >
      name unavailable
    </span>
  );
}

/** Days until an expiry date; null when unusable. */
function daysUntil(iso: string): number | null {
  if (!iso) return null;
  const t = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(t)) return null;
  return Math.round((t - Date.now()) / 86400000);
}

function ExpiryCell({ row }: { row: MedicarePatient }) {
  // OWNER RULE: the expiry is only ever MM/YY or MM/YYYY inside 09/2026..09/2031. The
  // importer has already cleared anything else, and displayExpiry re-checks defensively,
  // so a rejected value can never reach the screen -- not even as a raw fallback.
  const display = displayExpiry(row.expiry_best_date);
  if (!display) {
    return <span className="text-slate-600" title="No expiry outside the accepted 09/2026 - 09/2031 window">—</span>;
  }
  const d = daysUntil(row.expiry_best_date);
  const tone =
    d === null ? 'text-slate-400' : d < 0 ? 'text-rose-400' : d <= 90 ? 'text-amber-300' : 'text-slate-300';
  return (
    <span className={tone} title={`${row.expiry_best_word || 'expiry'} (${row.expiry_best_precision})`}>
      {display}
      {d !== null && (
        <span className="ml-1.5 text-[10px] opacity-70">
          {d < 0 ? `${Math.abs(d)}d ago` : `${d}d`}
        </span>
      )}
    </span>
  );
}

function StatCard({
  label,
  value,
  tone = 'matrix',
  hint,
  onClick,
  active,
}: {
  label: string;
  value: number | string;
  tone?: 'matrix' | 'amber' | 'rose' | 'cyan' | 'fuchsia';
  hint?: string;
  onClick?: () => void;
  active?: boolean;
}) {
  const tones: Record<string, string> = {
    matrix: 'text-matrix-400 text-glow-green border-matrix-500/15',
    amber: 'text-amber-400 border-amber-500/15',
    rose: 'text-rose-400 border-rose-500/15',
    cyan: 'text-cyan-300 border-cyan-500/15',
    fuchsia: 'text-fuchsia-300 border-fuchsia-500/15',
  };
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={`p-3 bg-black/40 rounded-lg border text-left w-full transition-colors ${
        tones[tone]
      } ${active ? 'ring-1 ring-current' : ''} ${onClick ? 'hover:bg-white/[0.04] cursor-pointer' : 'cursor-default'}`}
      title={hint}
    >
      <div className="text-[10px] font-mono font-bold text-slate-500 uppercase tracking-widest">{label}</div>
      <div className="text-2xl font-bold mt-0.5 font-mono">{value}</div>
    </button>
  );
}

export const MedicareView: React.FC = () => {
  const [summary, setSummary] = useState<MedicareSummary | null>(null);
  const [data, setData] = useState<MedicareQueryResponse | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [searchInput, setSearchInput] = useState('');
  const [sort, setSort] = useState('patient_id');
  const [dir, setDir] = useState<'asc' | 'desc'>('asc');
  const [limit, setLimit] = useState(50);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<MedicarePatient | null>(null);
  const [copied, setCopied] = useState('');

  const loadSummary = useCallback(async () => {
    try {
      const res = await fetch('/api/medicare/summary');
      setSummary(await res.json());
    } catch (err: any) {
      setError(err?.message || 'Failed to load Medicare index summary');
    }
  }, []);

  const loadRows = useCallback(async () => {
    setLoading(true);
    try {
      const qs = buildQuery(filters, sort, dir, limit, page * limit);
      const res = await fetch(`/api/medicare/patients?${qs}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'Failed to load patients');
    } finally {
      setLoading(false);
    }
  }, [filters, sort, dir, limit, page]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  // Debounce the free-text search so typing does not fire a query per keystroke.
  useEffect(() => {
    const t = window.setTimeout(() => {
      setFilters((f) => (f.q === searchInput ? f : { ...f, q: searchInput }));
      setPage(0);
    }, 250);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  const setFilter = (patch: Partial<Filters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(0);
  };

  const toggleSort = (column: string) => {
    if (sort === column) {
      setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSort(column);
      setDir('asc');
    }
    setPage(0);
  };

  const total = data?.total ?? 0;
  const rows = data?.rows ?? [];
  const pageCount = Math.max(1, Math.ceil(total / limit));
  const activeFilterCount = useMemo(
    () =>
      Object.entries(filters).filter(
        ([k, v]) => k !== 'q' && v !== '' && v !== 'all',
      ).length + (filters.q ? 1 : 0),
    [filters],
  );

  const exportHref = `/api/medicare/export.csv?${buildQuery(
    filters,
    sort,
    dir,
    limit,
    0,
  ).replace(/&?(limit|offset)=[^&]*/g, '')}`;

  const copy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      window.setTimeout(() => setCopied(''), 1200);
    } catch {
      /* clipboard may be blocked; the value is visible on screen anyway */
    }
  };

  const sexOptions = useMemo(
    () => Object.keys(summary?.sexBreakdown ?? {}).filter((k) => k !== '(blank)'),
    [summary],
  );
  const stateOptions = useMemo(
    () => Object.keys(summary?.stateBreakdown ?? {}).filter((k) => k !== '(blank)'),
    [summary],
  );

  const SortHeader: React.FC<{ column: string; label: string; className?: string }> = ({
    column,
    label,
    className = '',
  }) => (
    <th className={`px-2.5 py-2 text-left font-mono font-bold uppercase tracking-widest text-[10px] whitespace-nowrap ${className}`}>
      <button
        onClick={() => toggleSort(column)}
        className={`inline-flex items-center gap-1 hover:text-matrix-400 transition-colors ${
          sort === column ? 'text-matrix-400' : 'text-slate-500'
        }`}
        title={`Sort by ${label}`}
      >
        {label}
        <ArrowUpDown className="w-3 h-3" />
      </button>
    </th>
  );

  if (selected) {
    return (
      <div className="space-y-6">
        <button
          onClick={() => setSelected(null)}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-mono font-bold uppercase tracking-wider text-matrix-400 bg-black/50 hover:bg-matrix-900/40 border border-matrix-500/30 rounded-lg transition-colors"
        >
          <ChevronLeft className="w-3.5 h-3.5" /> Back to index
        </button>

        <div className="neon-card rounded-xl p-6 relative overflow-hidden">
          <div className="absolute inset-0 crt-scanlines" />
          <div className="relative">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="px-2 py-0.5 text-[10px] font-mono font-bold uppercase tracking-widest bg-cyan-950/40 text-cyan-300 border border-cyan-500/30 rounded">
                    {selected.patient_id}
                  </span>
                  <MedicareBadge row={selected} />
                  {selected.needs_review === 1 && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono font-bold uppercase text-amber-300 bg-amber-950/40 border border-amber-500/30 rounded">
                      <AlertTriangle className="w-3 h-3" /> needs review
                    </span>
                  )}
                </div>
                <h1 className="text-2xl font-bold tracking-wide text-slate-100 font-mono flex items-center gap-2">
                  <UserRound className="w-6 h-6 text-matrix-400" />
                  <NameCell row={selected} />
                </h1>
                {selected.name_status !== 'ok' && (
                  <p className="text-[11px] font-mono text-amber-300/80 mt-1 max-w-2xl">
                    {selected.full_name ? (
                      <>
                        Raw extraction was{' '}
                        <span className="text-slate-400">“{selected.full_name}”</span> — that is{' '}
                        {selected.name_status === 'form_label'
                          ? 'a form heading'
                          : selected.name_status === 'missing'
                            ? 'empty'
                            : 'a sentence fragment'}
                        , not a name.
                      </>
                    ) : (
                      <>No name was captured from the source document.</>
                    )}{' '}
                    Verify against the source document below.
                  </p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5 pt-5 border-t border-matrix-500/10">
              <StatCard label="Medicare" value={selected.medicare_number || '—'} tone="cyan" />
              <StatCard label="DOB" value={selected.dob_iso || '—'} />
              <StatCard label="Sex" value={selected.sex || '—'} />
              <StatCard label="Records" value={selected.record_count} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
              <DetailBlock title="Medicare & identifiers">
                <DetailRow label="Medicare number" value={selected.medicare_number} mono copyable onCopy={() => copy('med', selected.medicare_number)} copied={copied === 'med'} />
                <DetailRow label="Checksum" value={selected.medicare_flags || '—'} mono />
                <DetailRow label="MRN" value={selected.mrn || '—'} mono />
                <DetailRow label="Phone" value={selected.phone || '—'} mono />
                <DetailRow label="Email" value={selected.email || '—'} mono />
              </DetailBlock>

              <DetailBlock title="Expiry dates">
                {/* Only an in-window MM/YYYY value is shown. A rejected detection is not
                    rendered raw, per the owner's rule. */}
                <DetailRow label="Best date" value={displayExpiry(selected.expiry_best_date) || '—'} mono />
                <DetailRow label="Precision" value={selected.expiry_best_precision || '—'} />
                <DetailRow label="All tokens" value={selected.expiry_tokens || '—'} />
              </DetailBlock>

              <DetailBlock title="Address">
                <DetailRow label="Street" value={selected.address_full || '—'} />
                <DetailRow label="Suburb" value={selected.suburb || '—'} />
                <DetailRow label="State / postcode" value={[selected.state, selected.postcode].filter(Boolean).join(' ') || '—'} />
              </DetailBlock>

              <DetailBlock title="Clinical / provenance">
                <DetailRow label="Referrer" value={selected.referrer || '—'} />
                <DetailRow label="Tests" value={selected.tests || '—'} />
                <DetailRow label="Diagnoses" value={selected.diagnoses || '—'} />
                <DetailRow label="Confidence" value={selected.confidence_best || '—'} />
                <DetailRow label="Doc dates" value={selected.doc_dates_range || '—'} />
                <DetailRow label="Completeness" value={`${selected.completeness}/6 fields`} />
              </DetailBlock>
            </div>

            <div className="mt-4">
              <div className="text-[10px] font-mono font-bold text-slate-500 uppercase tracking-widest mb-2">
                Source documents // {selected.sources.length}
              </div>
              <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
                {selected.sources.length === 0 && (
                  <span className="text-xs font-mono text-slate-600">No source files recorded.</span>
                )}
                {selected.sources.map((s) => (
                  <span
                    key={s}
                    className="px-2 py-1 text-[10px] font-mono text-slate-400 bg-black/50 border border-matrix-500/20 rounded break-all"
                  >
                    {s}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="neon-card rounded-xl p-6 relative overflow-hidden">
        <div className="absolute inset-0 crt-scanlines" />
        <div className="relative flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="px-2 py-0.5 text-[10px] font-mono font-bold uppercase tracking-widest bg-cyan-950/40 text-cyan-300 border border-cyan-500/30 rounded flex items-center gap-1">
                <Database className="w-3 h-3" /> Archive PHI extraction
              </span>
              {summary && (
                <span className="px-2 py-0.5 text-[10px] font-mono font-bold uppercase tracking-widest bg-black/50 text-slate-400 border border-slate-600/40 rounded">
                  loaded {summary.loadedAt ? new Date(summary.loadedAt + 'Z').toLocaleString() : '—'}
                </span>
              )}
            </div>
            <h1 className="glitch-heading text-2xl sm:text-3xl font-bold tracking-wide text-cyan-300 uppercase flex items-center gap-2">
              <ShieldCheck className="w-6 h-6" />
              Medicare Index
            </h1>
            <p className="text-xs sm:text-sm text-slate-400 mt-2 max-w-3xl font-mono leading-relaxed">
              Every deduplicated patient found across the archive, with their Medicare number, checksum verdict,
              expiry dates and the source documents behind each value. Checksum failures and unverified names are
              flagged rather than hidden — nothing is dropped.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              onClick={() => {
                loadSummary();
                loadRows();
              }}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-mono font-bold uppercase tracking-wider text-matrix-400 bg-black/50 hover:bg-matrix-900/40 border border-matrix-500/30 rounded-lg transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <a
              href={exportHref}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-mono font-bold uppercase tracking-wider text-cyan-300 bg-black/50 hover:bg-cyan-950/40 border border-cyan-500/30 rounded-lg transition-colors"
              title="Download the current filter as CSV"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              Export CSV
            </a>
          </div>
        </div>

        {error && (
          <div className="relative mt-4 p-3 bg-rose-950/30 border border-rose-500/30 rounded-lg text-xs font-mono text-rose-300">
            {error}
          </div>
        )}

        {/* Search + filters */}
        <div className="relative mt-5 pt-5 border-t border-matrix-500/10 space-y-3">
          <div className="flex flex-col lg:flex-row gap-2.5">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search name, Medicare number, DOB, MRN, address, source file…"
                className="w-full pl-8 pr-8 py-2 bg-black/50 border border-matrix-500/20 rounded text-xs font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/50"
              />
              {searchInput && (
                <button
                  onClick={() => setSearchInput('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                  title="Clear search"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <button
              onClick={() => {
                setFilters(EMPTY_FILTERS);
                setSearchInput('');
                setPage(0);
              }}
              disabled={activeFilterCount === 0}
              className="px-3 py-2 text-xs font-mono font-bold uppercase tracking-wider text-slate-400 bg-black/50 hover:bg-white/5 border border-slate-600/40 rounded-lg transition-colors disabled:opacity-40 inline-flex items-center gap-1.5"
            >
              <ListFilter className="w-3.5 h-3.5" />
              Reset {activeFilterCount > 0 && `(${activeFilterCount})`}
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            <FilterSelect
              label="Medicare"
              value={filters.medicare_state}
              onChange={(v) => setFilter({ medicare_state: v })}
              options={[
                ['all', 'All'],
                ['verified', 'Checksum verified'],
                ['failed', 'Checksum failed'],
                ['unverifiable', 'Unverifiable'],
                ['absent', 'No number'],
              ]}
            />
            <FilterSelect
              label="Name quality"
              value={filters.name_status}
              onChange={(v) => setFilter({ name_status: v })}
              options={[
                ['all', 'All'],
                ['ok', 'Usable name'],
                ['suspect', 'Suspect (prose)'],
                ['form_label', 'Form label only'],
                ['missing', 'No name captured'],
              ]}
            />
            <FilterSelect
              label="Expiry"
              value={filters.expiry_state}
              onChange={(v) => setFilter({ expiry_state: v })}
              options={[
                ['all', 'All'],
                ['with', 'Has expiry (in window)'],
                ['without', 'No valid expiry'],
                ['expiring_soon', 'Expiring ≤ 90d'],
                ['expired', 'Already expired'],
              ]}
            />
            <FilterSelect
              label="Sex"
              value={filters.sex}
              onChange={(v) => setFilter({ sex: v })}
              options={[['', 'All'], ...sexOptions.map((s) => [s, s] as [string, string])]}
            />
            <FilterSelect
              label="State"
              value={filters.state}
              onChange={(v) => setFilter({ state: v })}
              options={[['', 'All'], ...stateOptions.slice(0, 12).map((s) => [s, s] as [string, string])]}
            />
          </div>
        </div>

        {/* Stats */}
        {summary && (
          <div className="relative grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-4 xl:grid-cols-8 gap-3 mt-5 pt-5 border-t border-matrix-500/10">
            <StatCard label="Patients" value={summary.patients} hint="Deduplicated people in the index" />
            <StatCard
              label="With Medicare"
              value={`${summary.withMedicare}`}
              tone="cyan"
              hint={`${summary.distinctMedicareNumbers} distinct numbers`}
            />
            <StatCard
              label="Verified"
              value={summary.medicareVerified}
              tone="matrix"
              hint="Passed the Australian Medicare mod-10 checksum"
              active={filters.medicare_state === 'verified'}
              onClick={() =>
                setFilter({ medicare_state: filters.medicare_state === 'verified' ? 'all' : 'verified' })
              }
            />
            <StatCard
              label="Checksum failed"
              value={summary.medicareFailed}
              tone="rose"
              hint="Digits are probably an OCR misread"
              active={filters.medicare_state === 'failed'}
              onClick={() =>
                setFilter({ medicare_state: filters.medicare_state === 'failed' ? 'all' : 'failed' })
              }
            />
            <StatCard
              label="No Medicare"
              value={summary.withoutMedicare}
              hint="Patient identified without a Medicare number"
              active={filters.medicare_state === 'absent'}
              onClick={() =>
                setFilter({ medicare_state: filters.medicare_state === 'absent' ? 'all' : 'absent' })
              }
            />
            <StatCard
              label="Expiring ≤90d"
              value={summary.expiringSoon}
              tone="amber"
              hint="Medicare cards expiring within 90 days"
              active={filters.expiry_state === 'expiring_soon'}
              onClick={() =>
                setFilter({ expiry_state: filters.expiry_state === 'expiring_soon' ? 'all' : 'expiring_soon' })
              }
            />
            <StatCard
              label="Expiry in window"
              value={summary.expiryCensus?.valid ?? 0}
              tone="cyan"
              hint="MM/YY or MM/YYYY between 09/2026 and 09/2031"
            />
            {/* Rejected detections are cleared and never displayed; only the count remains,
                so the operator can see how strict the rule is without seeing bad values. */}
            <StatCard
              label="Expiry rejected"
              value={summary.expiryCensus?.rejected ?? 0}
              tone="rose"
              hint="Outside 09/2026-09/2031 or malformed — cleared, never shown"
            />
            <StatCard
              label="Needs review"
              value={summary.needsReview}
              tone="fuchsia"
              hint="Unverified name or failed checksum"
              active={filters.needs_review === 'only'}
              onClick={() =>
                setFilter({ needs_review: filters.needs_review === 'only' ? 'all' : 'only' })
              }
            />
          </div>
        )}
      </div>

      {/* Table */}
      <div className="neon-card rounded-xl overflow-hidden">
        <div className="p-3 border-b border-cyan-500/20 bg-black/30 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs font-mono font-bold uppercase tracking-widest text-cyan-300">
            <Database className="w-4 h-4" />
            Index // {total.toLocaleString()} {total === 1 ? 'patient' : 'patients'}
          </div>
          <div className="flex items-center gap-2 text-[10px] font-mono text-slate-500">
            <span>rows</span>
            <select
              value={limit}
              onChange={(e) => {
                setLimit(Number(e.target.value));
                setPage(0);
              }}
              className="bg-black/60 border border-cyan-500/30 rounded px-1.5 py-1 text-[10px] font-mono text-cyan-300 focus:outline-none"
            >
              {PAGE_SIZES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px]">
            <thead className="border-b border-cyan-500/20 bg-black/40">
              <tr>
                <SortHeader column="patient_id" label="ID" />
                <SortHeader column="name_display" label="Patient" />
                <SortHeader column="medicare_number" label="Medicare" />
                <SortHeader column="dob_iso" label="DOB" />
                <SortHeader column="sex" label="Sex" />
                <SortHeader column="expiry_best_date" label="Expiry" />
                <SortHeader column="suburb" label="Suburb" />
                <SortHeader column="record_count" label="Docs" />
                <SortHeader column="completeness" label="Fields" />
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {rows.length === 0 && !loading && (
                <tr>
                  <td colSpan={9} className="p-10 text-center text-xs font-mono text-slate-500">
                    {activeFilterCount > 0 ? 'No patients match these filters.' : 'Medicare index is empty.'}
                  </td>
                </tr>
              )}
              {loading && rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="p-10 text-center text-xs font-mono text-slate-500">
                    Querying index…
                  </td>
                </tr>
              )}
              {rows.map((row) => (
                <tr
                  key={row.patient_id}
                  onClick={() => setSelected(row)}
                  className="cursor-pointer hover:bg-white/[0.03] transition-colors"
                >
                  <td className="px-2.5 py-2 text-[11px] font-mono text-slate-500 whitespace-nowrap">
                    {row.patient_id}
                  </td>
                  <td className="px-2.5 py-2 text-xs font-mono">
                    <NameCell row={row} />
                  </td>
                  <td className="px-2.5 py-2 text-xs font-mono whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <span className={row.medicare_valid === 1 ? 'text-slate-200' : 'text-slate-400'}>
                        {row.medicare_number || '—'}
                      </span>
                      <MedicareBadge row={row} />
                    </div>
                  </td>
                  <td className="px-2.5 py-2 text-xs font-mono text-slate-300 whitespace-nowrap">
                    {row.dob_iso || '—'}
                  </td>
                  <td className="px-2.5 py-2 text-xs font-mono text-slate-400">
                    {row.sex || '—'}
                  </td>
                  <td className="px-2.5 py-2 text-xs font-mono whitespace-nowrap">
                    <ExpiryCell row={row} />
                  </td>
                  <td className="px-2.5 py-2 text-xs font-mono text-slate-400 max-w-[160px] truncate">
                    {row.suburb || '—'}
                  </td>
                  <td className="px-2.5 py-2 text-xs font-mono text-matrix-400 text-center">
                    {row.record_count}
                  </td>
                  <td className="px-2.5 py-2">
                    <div className="flex items-center gap-1" title={`${row.completeness}/6 identifying fields`}>
                      {Array.from({ length: 6 }).map((_, i) => (
                        <span
                          key={i}
                          className={`w-1.5 h-3 rounded-sm ${
                            i < row.completeness ? 'bg-cyan-500/70' : 'bg-slate-700/50'
                          }`}
                        />
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="p-3 border-t border-cyan-500/20 bg-black/30 flex items-center justify-between gap-3">
          <span className="text-[10px] font-mono text-slate-500">
            {total === 0
              ? 'no rows'
              : `${(page * limit + 1).toLocaleString()}–${Math.min(
                  (page + 1) * limit,
                  total,
                ).toLocaleString()} of ${total.toLocaleString()}`}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="p-1.5 rounded border border-cyan-500/30 text-cyan-300 hover:bg-cyan-950/40 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
              title="Previous page"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span className="text-[10px] font-mono text-slate-400">
              page {page + 1} / {pageCount}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              disabled={page >= pageCount - 1}
              className="p-1.5 rounded border border-cyan-500/30 text-cyan-300 hover:bg-cyan-950/40 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
              title="Next page"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const FilterSelect: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<[string, string]>;
}> = ({ label, value, onChange, options }) => (
  <label className="block">
    <span className="block text-[10px] font-mono font-bold text-slate-500 uppercase tracking-widest mb-1">
      {label}
    </span>
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-black/60 border border-cyan-500/25 rounded px-2 py-1.5 text-xs font-mono text-cyan-200 focus:outline-none focus:border-cyan-500/50"
    >
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  </label>
);

const DetailBlock: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="p-3 bg-black/40 rounded-lg border border-cyan-500/15">
    <div className="text-[10px] font-mono font-bold text-cyan-300 uppercase tracking-widest mb-2">{title}</div>
    <div className="space-y-1.5">{children}</div>
  </div>
);

const DetailRow: React.FC<{
  label: string;
  value: string;
  mono?: boolean;
  copyable?: boolean;
  onCopy?: () => void;
  copied?: boolean;
}> = ({ label, value, mono, copyable, onCopy, copied }) => (
  <div className="flex items-start gap-2 text-xs">
    <span className="text-slate-500 font-mono w-28 shrink-0">{label}</span>
    <span className={`text-slate-200 break-words flex-1 ${mono ? 'font-mono' : ''}`}>{value}</span>
    {copyable && (
      <button onClick={onCopy} className="text-slate-500 hover:text-cyan-300 transition-colors shrink-0" title="Copy">
        {copied ? <Check className="w-3.5 h-3.5 text-matrix-400" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
    )}
  </div>
);

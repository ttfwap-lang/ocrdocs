/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Identity-centric findings dashboard: every document actually uploaded via
 * POST /api/documents gets grouped (by GET /api/identities) with the other
 * documents that share the same real extracted given_names + family_name +
 * date_of_birth. A sidebar lists people alphabetically with their DOB; the
 * gallery beside it mirrors the same order with a flipping stack of each
 * person's document thumbnails. A document with no reliable name+DOB yet
 * shows up in the Unassigned queue instead of being guessed into a group.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Upload,
  FolderUp,
  RefreshCw,
  CheckCircle2,
  Clock,
  XCircle,
  Loader2,
  Inbox,
  Users,
  ListChecks,
  X,
  Search,
  FileSpreadsheet,
  Terminal,
  ShoppingCart,
} from 'lucide-react';
import type { IdentitySummary, UnassignedDocument, UnassignedEvidenceItem } from '../types';
import { FlipStack } from './identity/FlipStack';
import { FaceThumb } from './identity/FaceThumb';
import { IdentityDetailPage, type DetailSelection } from './IdentityDetailPage';

const ALLOWED_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg', '.tif', '.tiff', '.bmp', '.webp', '.docx', '.rtf', '.xml', '.txt', '.json'];
const UPLOAD_CONCURRENCY = 3;
const UNASSIGNED_PAGE_SIZE = 200;

/**
 * The "add to cart" selection box that sits under the identities header. Reviewers tick
 * the people they care about; the count and the export button act on that selection only.
 */
function SelectionTray({
  selected,
  total,
  allTotal,
  onClear,
  onSelectAllVisible,
}: {
  selected: Set<string>;
  total: number;
  allTotal: number;
  onClear: () => void;
  onSelectAllVisible: () => void;
}) {
  const count = selected.size;
  const ids = Array.from(selected).join(',');
  return (
    <div className="relative mt-4 p-3 bg-cyan-950/20 border border-cyan-500/25 rounded-lg flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div className="flex items-center gap-2.5 text-xs font-mono">
        <ShoppingCart className="w-4 h-4 text-cyan-300" />
        <span className="text-cyan-200 font-bold">
          {count === 0 ? 'No identities selected' : `${count} selected`}
        </span>
        {count > 0 && (
          <button onClick={onClear} className="text-slate-400 hover:text-slate-200 transition-colors" title="Clear selection">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
        {count < total && (
          <button onClick={onSelectAllVisible} className="text-cyan-300 hover:text-cyan-200 transition-colors underline underline-offset-2">
            Select all{total < allTotal ? ` ${total} shown` : ''}
          </button>
        )}
      </div>
      <a
        href={`/api/export/identities.csv${count > 0 ? `?ids=${encodeURIComponent(ids)}` : ''}`}
        className={`inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-mono font-bold uppercase tracking-wider rounded-lg transition-colors ${
          count > 0 ? 'text-black bg-cyan-400 hover:bg-cyan-300 shadow-[0_0_18px_-4px_rgba(0,246,255,0.7)]' : 'text-slate-500 bg-black/40 border border-white/10'
        }`}
        title={
          count > 0
            ? `Export the ${count} selected identit${count === 1 ? 'y' : 'ies'} as one CSV row each, led by name, DOB, credit score and the key identifiers`
            : 'Select identities to export only those. With nothing selected this exports every identity, one row each.'
        }
      >
        <FileSpreadsheet className="w-3.5 h-3.5" />
        {count > 0 ? `Export ${count} Identit${count === 1 ? 'y' : 'ies'}` : 'Export All Identities'}
      </a>
    </div>
  );
}

type QueueStatus = 'pending' | 'uploading' | 'extracted' | 'queued_ocr' | 'duplicate' | 'error';

interface QueueItem {
  id: string;
  name: string;
  status: QueueStatus;
  message?: string;
}

function hasAllowedExtension(filename: string): boolean {
  const lower = filename.toLowerCase();
  return ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function makeQueueId(): string {
  return `q-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export const IdentitiesView: React.FC = () => {
  const [identities, setIdentities] = useState<IdentitySummary[]>([]);
  const [unassigned, setUnassigned] = useState<UnassignedDocument[]>([]);
  const [unassignedTotal, setUnassignedTotal] = useState(0);
  const [unassignedByStatus, setUnassignedByStatus] = useState<Record<string, number>>({});
  const [unassignedHasMore, setUnassignedHasMore] = useState(false);
  const [evidence, setEvidence] = useState<UnassignedEvidenceItem[]>([]);
  const [evidenceTotal, setEvidenceTotal] = useState(0);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSerial = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const unassignedLengthRef = useRef(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [selection, setSelection] = useState<DetailSelection | null>(null);
  // "Add to cart": identities ticked for a bulk CSV export.
  const [cart, setCart] = useState<Set<string>>(new Set());
  const [uploadQueue, setUploadQueue] = useState<QueueItem[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (folderInputRef.current) {
      folderInputRef.current.setAttribute('webkitdirectory', '');
      folderInputRef.current.setAttribute('directory', '');
    }
  }, []);

  const fetchIdentities = useCallback(async (append = false) => {
    const requestId = ++requestSerial.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const offset = append ? unassignedLengthRef.current : 0;
    if (append) setLoadingMore(true);
    else setLoading(true);

    try {
      const res = await fetch(
        `/api/identities?unassigned_limit=${UNASSIGNED_PAGE_SIZE}&unassigned_offset=${offset}`,
        { signal: controller.signal, cache: 'no-store' },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (requestId !== requestSerial.current) return;
      const next = Array.isArray(data.identities) ? data.identities : [];
      const page = Array.isArray(data.unassigned) ? data.unassigned : [];
      setIdentities(next);
      setUnassigned((previous) => append ? [...previous, ...page] : page);
      unassignedLengthRef.current = append ? unassignedLengthRef.current + page.length : page.length;
      const total = Number.isFinite(Number(data.unassignedTotal))
        ? Number(data.unassignedTotal)
        : unassignedLengthRef.current;
      setUnassignedTotal(total);
      setUnassignedByStatus(
        data.unassignedByStatus && typeof data.unassignedByStatus === 'object'
          ? data.unassignedByStatus
          : {},
      );
      setUnassignedHasMore(
        typeof data.unassignedHasMore === 'boolean'
          ? data.unassignedHasMore
          : unassignedLengthRef.current < total,
      );
      setError(null);
      setHasLoaded(true);
      // Drop anything the refresh no longer knows about. An identityId is a hash of
      // name+given+DOB, so re-processing a document can change it; without this the tray
      // would keep counting a person who no longer exists and the CSV would come back
      // with fewer rows than the tray promised.
      setCart((prev) => {
        const live = new Set(next.map((i) => i.identityId));
        const kept = new Set([...prev].filter((id) => live.has(id)));
        return kept.size === prev.size ? prev : kept;
      });
    } catch (err: any) {
      if (err?.name === 'AbortError' || requestId !== requestSerial.current) return;
      setError(err?.message || 'Failed to load identities');
    } finally {
      if (requestId === requestSerial.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, []);

  const fetchEvidence = useCallback(async () => {
    try {
      const res = await fetch('/api/unassigned/evidence?kind=all&state=all&limit=200', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const items = Array.isArray(data.items) ? data.items as UnassignedEvidenceItem[] : [];
      // The route is a read-only review surface: only uncertain/unassigned
      // items are shown here, never a second copy of an identity gallery.
      setEvidence(items.filter((item) => item.assignmentState !== 'assigned'));
      setEvidenceTotal(items.filter((item) => item.assignmentState !== 'assigned').length);
    } catch {
      // Evidence is supplementary; a failed sidecar must not hide identities.
      setEvidence([]);
      setEvidenceTotal(0);
    }
  }, []);

  useEffect(() => {
    void fetchIdentities();
    void fetchEvidence();
    return () => abortRef.current?.abort();
  }, [fetchIdentities, fetchEvidence]);

  const isUploading = uploadQueue.some((q) => q.status === 'pending' || q.status === 'uploading');
  const queueCounts = useMemo(
    () => ({
      total: uploadQueue.length,
      done: uploadQueue.filter((q) => q.status === 'extracted' || q.status === 'queued_ocr' || q.status === 'duplicate').length,
      failed: uploadQueue.filter((q) => q.status === 'error').length,
    }),
    [uploadQueue],
  );

  const updateQueueItem = (id: string, patch: Partial<QueueItem>) => {
    setUploadQueue((prev) => prev.map((q) => (q.id === id ? { ...q, ...patch } : q)));
  };

  const uploadOne = async (item: QueueItem, file: File): Promise<QueueStatus> => {
    updateQueueItem(item.id, { status: 'uploading' });
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch('/api/documents', { method: 'POST', body: formData });
      const data = await res.json();
      if (res.status === 201) {
        updateQueueItem(item.id, { status: 'extracted', message: 'Fields extracted' });
        return 'extracted';
      }
      if (res.status === 200 && data.duplicate) {
        updateQueueItem(item.id, { status: 'duplicate', message: 'Already uploaded — skipped' });
        return 'duplicate';
      }
      if (res.status === 202) {
        updateQueueItem(item.id, { status: 'queued_ocr', message: data.message || 'Queued for DGX OCR' });
        return 'queued_ocr';
      }
      updateQueueItem(item.id, { status: 'error', message: data.error || 'Upload failed' });
      return 'error';
    } catch (err: any) {
      updateQueueItem(item.id, { status: 'error', message: err?.message || 'Network error' });
      return 'error';
    }
  };

  const runQueue = async (items: Array<{ item: QueueItem; file: File }>): Promise<QueueStatus[]> => {
    const results: QueueStatus[] = new Array(items.length);
    let cursor = 0;
    const worker = async () => {
      while (cursor < items.length) {
        const idx = cursor++;
        results[idx] = await uploadOne(items[idx].item, items[idx].file);
      }
    };
    await Promise.all(new Array(Math.min(UPLOAD_CONCURRENCY, items.length)).fill(0).map(worker));
    return results;
  };

  const uploadFolderBatch = async (items: Array<{ item: QueueItem; file: File }>) => {
    const formData = new FormData();
    for (const { file } of items) formData.append('files', file, file.name);
    formData.append('paths', JSON.stringify(items.map(({ file }) => (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name)));
    const response = await fetch('/api/documents/batch', { method: 'POST', body: formData });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Folder upload failed (${response.status})`);
    const queued = Number.isFinite(Number(body.queuedJobs)) ? Number(body.queuedJobs) : items.length;
    for (const { item } of items) {
      updateQueueItem(item.id, { status: 'queued_ocr', message: `Queued for OCR (${queued} job${queued === 1 ? '' : 's'})` });
    }
  };

  const handleFilesSelected = async (fileList: FileList | null, inputEl: HTMLInputElement | null, folderUpload = false) => {
    if (!fileList || fileList.length === 0) return;
    setError(null);
    setNotice(null);

    const allFiles = Array.from(fileList);
    const accepted = allFiles.filter((f) => hasAllowedExtension(f.name));
    const skipped = allFiles.length - accepted.length;

    if (accepted.length === 0) {
      setError('No supported files found (PDF, PNG, JPEG, TIFF only).');
      if (inputEl) inputEl.value = '';
      return;
    }

    const queued = accepted.map((file) => ({ item: { id: makeQueueId(), name: file.name, status: 'pending' as QueueStatus }, file }));
    setUploadQueue((prev) => [...prev, ...queued.map((q) => q.item)]);
    if (inputEl) inputEl.value = '';

    try {
      // A folder selection, or any multi-file selection, goes through the
      // server-side snapshot/flatten/quarantine pipeline. A single file keeps
      // the fast native-PDF path below.
      if (folderUpload || queued.length > 1) {
        for (const { item } of queued) updateQueueItem(item.id, { status: 'uploading' });
        await uploadFolderBatch(queued);
        await fetchIdentities();
        setNotice(
          `Prepared ${queued.length} file(s) through the folder cleanup pipeline; ${skipped > 0 ? `skipped ${skipped} unsupported file(s).` : ''}`,
        );
        return;
      }
    } catch (err: any) {
      const message = err?.message || 'Folder upload failed';
      for (const { item } of queued) updateQueueItem(item.id, { status: 'error', message });
      setError(message);
      return;
    }

    const results = await runQueue(queued);
    await fetchIdentities();

    const failedCount = results.filter((r) => r === 'error').length;
    if (skipped > 0) {
      setNotice(`Skipped ${skipped} unsupported file(s) (allowed: ${ALLOWED_EXTENSIONS.join(', ')}).`);
    } else if (failedCount === 0) {
      setNotice(`Uploaded ${queued.length} file(s) successfully.`);
    } else {
      setError(`${failedCount} of ${queued.length} file(s) failed to upload — see queue below.`);
    }
  };

  const clearFinishedQueueItems = () => {
    setUploadQueue((prev) => prev.filter((q) => q.status === 'pending' || q.status === 'uploading'));
  };

  const toggleCart = (identityId: string) => {
    setCart((prev) => {
      const next = new Set(prev);
      if (next.has(identityId)) next.delete(identityId);
      else next.add(identityId);
      return next;
    });
  };

  const clearCart = () => setCart(new Set());
  const selectAllVisible = () => setCart(new Set(filteredIdentities.map((i) => i.identityId)));

  const filteredIdentities = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return identities;
    return identities.filter((i) => i.fullName.toLowerCase().includes(q));
  }, [identities, filter]);

  const totals = useMemo(
    () => ({
      people: identities.length,
      documents: identities.reduce((sum, i) => sum + i.documentCount, 0) + unassignedTotal,
      pending: identities.reduce((sum, i) => sum + i.pendingCount, 0)
        + Object.entries(unassignedByStatus).reduce((sum, [status, count]) => sum + (status === 'failed' ? 0 : Number(count) || 0), 0),
      failed: identities.reduce((sum, i) => sum + i.failedCount, 0) + (unassignedByStatus.failed ?? 0),
    }),
    [identities, unassignedTotal, unassignedByStatus],
  );

  if (selection) {
    return (
      <IdentityDetailPage
        selection={selection}
        onBack={() => {
          setSelection(null);
          fetchIdentities();
        }}
      />
    );
  }

  if (!hasLoaded && !error) {
    return (
      <div data-testid="identities-loading" className="min-h-[50vh] flex items-center justify-center gap-3 text-sm font-mono text-slate-400">
        <Loader2 className="w-5 h-5 animate-spin text-matrix-400" />
        Loading live identity index…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header / Upload */}
      <div className="neon-card rounded-xl p-6 relative overflow-hidden">
        <div className="absolute inset-0 crt-scanlines" />
        <div className="relative flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="px-2 py-0.5 text-[10px] font-mono font-bold uppercase tracking-widest bg-matrix-900/60 text-matrix-400 border border-matrix-500/30 rounded">
                Real Document Pipeline
              </span>
              <span className="px-2 py-0.5 text-[10px] font-mono font-bold uppercase tracking-widest bg-black/50 text-cyan-300 border border-cyan-500/30 rounded flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" />
                No fixtures, no fabricated passes
              </span>
            </div>
            <h1 className="glitch-heading text-2xl sm:text-3xl font-bold tracking-wide text-matrix-400 uppercase flex items-center gap-2">
              <Users className="w-6 h-6" />
              Identities
            </h1>
            <p className="text-xs sm:text-sm text-slate-400 mt-2 max-w-3xl font-mono leading-relaxed">
              Documents are grouped automatically by their extracted name and date of birth. Upload files here — native-text PDFs
              extract immediately; scanned PDFs and images are queued for the DGX worker.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              onClick={() => { void fetchIdentities(); void fetchEvidence(); }}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-mono font-bold uppercase tracking-wider text-matrix-400 bg-black/50 hover:bg-matrix-900/40 border border-matrix-500/30 rounded-lg transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <a
              href="/api/export/consolidated.csv"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-mono font-bold uppercase tracking-wider text-cyan-300 bg-black/50 hover:bg-cyan-950/40 border border-cyan-500/30 rounded-lg transition-colors"
              title="One row per DOCUMENT, one column per field, across every document. For one row per person, use the selection tray below."
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              Per Document (CSV)
            </a>
            <label className="inline-flex items-center gap-2 px-4 py-2 text-xs font-mono font-bold uppercase tracking-wider text-black bg-matrix-500 hover:bg-matrix-400 rounded-lg shadow-[0_0_18px_-4px_rgba(0,255,65,0.7)] transition-colors cursor-pointer">
              <Upload className="w-3.5 h-3.5" />
              Upload Files
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff,.bmp,.webp,.docx,.rtf,.xml,.txt,.json"
                className="hidden"
                onChange={(e) => handleFilesSelected(e.target.files, fileInputRef.current)}
              />
            </label>
            <label className="inline-flex items-center gap-2 px-4 py-2 text-xs font-mono font-bold uppercase tracking-wider text-black bg-cyan-400 hover:bg-cyan-300 rounded-lg shadow-[0_0_18px_-4px_rgba(0,246,255,0.7)] transition-colors cursor-pointer">
              <FolderUp className="w-3.5 h-3.5" />
              Upload Folder
              <input ref={folderInputRef} type="file" multiple className="hidden" onChange={(e) => handleFilesSelected(e.target.files, folderInputRef.current, true)} />
            </label>
          </div>
        </div>

        {notice && <div className="relative mt-4 p-3 bg-amber-950/30 border border-amber-500/30 rounded-lg text-xs font-mono text-amber-300">{notice}</div>}
        {error && <div className="relative mt-4 p-3 bg-rose-950/30 border border-rose-500/30 rounded-lg text-xs font-mono text-rose-300">{error}</div>}

        <SelectionTray
          selected={cart}
          total={filteredIdentities.length}
          allTotal={identities.length}
          onClear={clearCart}
          onSelectAllVisible={selectAllVisible}
        />

        {uploadQueue.length > 0 && (
          <div className="relative mt-4 neon-card rounded-lg overflow-hidden">
            <div className="p-3 border-b border-matrix-500/15 bg-black/40 flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-mono font-bold uppercase tracking-widest text-cyan-300">
                <ListChecks className="w-4 h-4" />
                Upload Queue // {queueCounts.done + queueCounts.failed}/{queueCounts.total}
                {isUploading && <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400" />}
              </div>
              {!isUploading && (
                <button onClick={clearFinishedQueueItems} className="text-slate-500 hover:text-slate-300 transition-colors" title="Clear finished items">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <div className="max-h-48 overflow-y-auto divide-y divide-white/5">
              {uploadQueue.map((q) => (
                <div key={q.id} className="px-3 py-2 flex items-center justify-between gap-3 text-xs font-mono">
                  <div className="flex items-center gap-2 min-w-0">
                    {q.status === 'pending' && <Clock className="w-3.5 h-3.5 text-slate-500 shrink-0" />}
                    {q.status === 'uploading' && <Loader2 className="w-3.5 h-3.5 text-cyan-400 animate-spin shrink-0" />}
                    {(q.status === 'extracted' || q.status === 'queued_ocr' || q.status === 'duplicate') && (
                      <CheckCircle2 className="w-3.5 h-3.5 text-matrix-400 shrink-0" />
                    )}
                    {q.status === 'error' && <XCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />}
                    <span className="truncate text-slate-300">{q.name}</span>
                  </div>
                  <span
                    className={`shrink-0 ${
                      q.status === 'error'
                        ? 'text-rose-400'
                        : q.status === 'extracted' || q.status === 'queued_ocr' || q.status === 'duplicate'
                        ? 'text-matrix-400'
                        : 'text-slate-500'
                    }`}
                  >
                    {q.status === 'pending' && 'waiting...'}
                    {q.status === 'uploading' && 'uploading...'}
                    {(q.status === 'extracted' || q.status === 'queued_ocr' || q.status === 'duplicate' || q.status === 'error') && (q.message || q.status)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="relative grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5 pt-5 border-t border-matrix-500/10">
          <div className="p-3 bg-black/40 rounded-lg border border-matrix-500/15">
            <div className="text-[10px] font-mono font-bold text-slate-500 uppercase tracking-widest">People</div>
            <div className="text-2xl font-bold text-matrix-400 text-glow-green mt-0.5 font-mono">{totals.people}</div>
          </div>
          <div className="p-3 bg-black/40 rounded-lg border border-matrix-500/15">
            <div className="text-[10px] font-mono font-bold text-slate-500 uppercase tracking-widest">Documents</div>
            <div className="text-2xl font-bold text-matrix-400 text-glow-green mt-0.5 font-mono">{totals.documents}</div>
          </div>
          <div className="p-3 bg-black/40 rounded-lg border border-amber-500/15">
            <div className="text-[10px] font-mono font-bold text-slate-500 uppercase tracking-widest">Awaiting OCR</div>
            <div className="text-2xl font-bold text-amber-400 mt-0.5 font-mono">{totals.pending}</div>
          </div>
          <div className="p-3 bg-black/40 rounded-lg border border-rose-500/15">
            <div className="text-[10px] font-mono font-bold text-slate-500 uppercase tracking-widest">Failed</div>
            <div className="text-2xl font-bold text-rose-400 mt-0.5 font-mono">{totals.failed}</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Sidebar: alphabetical identity list */}
        <div className="lg:col-span-4 neon-card rounded-xl overflow-hidden flex flex-col">
          <div className="p-3 border-b border-matrix-500/15 bg-black/30">
            <div className="flex items-center gap-2 mb-2">
              <Users className="w-4 h-4 text-matrix-400" />
              <h2 className="text-xs font-mono font-bold uppercase tracking-widest text-matrix-300">People A–Z // {filteredIdentities.length}</h2>
            </div>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter by name…"
                className="w-full pl-8 pr-2 py-1.5 bg-black/50 border border-matrix-500/20 rounded text-xs font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-matrix-500/50"
              />
            </div>
          </div>
          <div className="divide-y divide-matrix-500/10 flex-1 overflow-y-auto max-h-[640px]">
            {filteredIdentities.length === 0 && (
              <div className="p-6 text-center text-xs font-mono text-slate-500">
                {identities.length === 0 ? 'No identified people yet.' : 'No match for that filter.'}
              </div>
            )}
            {filteredIdentities.map((id) => (
              <div key={id.identityId} className="flex items-stretch hover:bg-white/[0.03] transition-colors">
                <label
                  className="flex items-center pl-3 pr-1 cursor-pointer shrink-0"
                  title={cart.has(id.identityId) ? 'Remove from CSV export' : 'Add to CSV export'}
                >
                  <input
                    type="checkbox"
                    checked={cart.has(id.identityId)}
                    onChange={() => toggleCart(id.identityId)}
                    className="w-3.5 h-3.5 accent-cyan-400 cursor-pointer"
                    aria-label={`Select ${id.fullName} for CSV export`}
                  />
                </label>
                <button data-testid="identity-open"
                  onClick={() => setSelection({ type: 'identity', id: id.identityId })}
                  className="flex-1 text-left p-3 flex items-center justify-between gap-2 min-w-0"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <FaceThumb url={id.thumbnailUrl} name={id.fullName} size={28} />
                    <div className="min-w-0">
                      <div className="text-xs font-mono font-semibold text-slate-200 truncate">{id.fullName}</div>
                      <div className="text-[10px] font-mono text-slate-500 mt-0.5">DOB {id.dob}</div>
                    </div>
                  </div>
                  <span className="shrink-0 text-[10px] font-mono font-bold text-matrix-400 bg-matrix-900/40 border border-matrix-500/30 rounded px-1.5 py-0.5">
                    {id.documentCount}
                  </span>
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Gallery: same order as the sidebar, with a flipping thumbnail stack per row */}
        <div className="lg:col-span-8 space-y-4">
          {evidence.length > 0 && (
            <div data-testid="unassigned-evidence" className="neon-card rounded-xl overflow-hidden border-amber-500/20">
              <div className="p-3 border-b border-amber-500/20 bg-black/30 flex items-center gap-2">
                <Search className="w-4 h-4 text-amber-400" />
                <h2 className="text-xs font-mono font-bold uppercase tracking-widest text-amber-300">Uncertain Image Evidence // {evidenceTotal}</h2>
                <span className="ml-auto text-[10px] font-mono text-slate-500">review only — not assigned to a person</span>
              </div>
              <div className="p-3 grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-8 gap-2 max-h-64 overflow-y-auto">
                {evidence.map((item) => {
                  const imageUrl = item.url || item.cardUrl;
                  return (
                    <button
                      key={item.evidenceId}
                      type="button"
                      disabled={!item.documentId}
                      onClick={() => item.documentId && setSelection({ type: 'document', id: item.documentId })}
                      className="group text-left disabled:cursor-default"
                      title={`${item.kind} · ${item.assignmentState}${item.document ? ` · ${item.document}` : ''}`}
                    >
                      <span className="block aspect-square rounded border border-white/10 bg-black/50 overflow-hidden">
                        {imageUrl ? (
                          <img src={imageUrl} alt="" className="w-full h-full object-cover group-hover:border-amber-400/60" />
                        ) : (
                          <span className="w-full h-full flex items-center justify-center text-[9px] font-mono text-slate-600">no preview</span>
                        )}
                      </span>
                      <span className="block mt-1 text-[9px] font-mono uppercase text-slate-500 truncate">
                        {item.kind === 'headshot' ? 'head' : 'rear'} · {item.assignmentState === 'unassigned' ? 'unassigned' : 'review'}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {unassigned.length > 0 && (
            <div data-testid="unassigned-queue" className="neon-card rounded-xl overflow-hidden">
              <div className="p-3 border-b border-amber-500/20 bg-black/30 flex items-center gap-2">
                <Inbox className="w-4 h-4 text-amber-400" />
                <h2 className="text-xs font-mono font-bold uppercase tracking-widest text-amber-300">Unassigned Queue // {unassignedTotal}</h2>
              </div>
              <div className="divide-y divide-white/5 max-h-56 overflow-y-auto">
                {unassigned.map((doc) => (
                  <button
                    data-testid="unassigned-row" key={doc.id}
                    onClick={() => setSelection({ type: 'document', id: doc.id })}
                    className="w-full text-left px-3.5 py-2.5 flex items-center justify-between gap-3 hover:bg-white/[0.03] transition-colors"
                  >
                    <span className="flex items-center gap-2.5 min-w-0">
                      <FaceThumb url={doc.photos?.[0]?.url ?? null} name={doc.filename} size={30} rounded={false} />
                      <span className="text-xs font-mono text-slate-300 truncate">{doc.filename}</span>
                    </span>
                    <span className="shrink-0 flex items-center gap-2">
                      {doc.photos && doc.photos.length > 0 && (
                        <span className="text-[10px] font-mono text-cyan-300" title={`${doc.photos.length} head photo(s) found`}>
                          {doc.photos.length} photo{doc.photos.length === 1 ? '' : 's'}
                        </span>
                      )}
                      <span className="shrink-0 text-[10px] font-mono text-slate-500 uppercase">{doc.status}</span>
                    </span>
                  </button>
                ))}
              </div>
              {unassignedHasMore && (
                <div className="p-2 border-t border-amber-500/15 text-center">
                  <button
                    onClick={() => void fetchIdentities(true)}
                    disabled={loadingMore}
                    className="inline-flex items-center gap-2 px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider text-amber-300 hover:text-amber-200 disabled:opacity-50"
                  >
                    {loadingMore && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    Load more unassigned ({unassigned.length} / {unassignedTotal})
                  </button>
                </div>
              )}
            </div>
          )}

          {filteredIdentities.length === 0 && unassigned.length === 0 && (
            <div className="p-10 neon-card rounded-xl text-center text-xs font-mono text-slate-500 flex flex-col items-center gap-2">
              <Terminal className="w-5 h-5 text-matrix-600" />
              Upload a document above to get started.
            </div>
          )}

          {filteredIdentities.map((id) => (
            <div
              key={id.identityId}
              className={`w-full neon-card rounded-xl flex items-stretch transition-colors ${cart.has(id.identityId) ? 'border-cyan-500/60' : 'hover:border-matrix-500/40'}`}
            >
              <label
                className="flex items-center pl-4 pr-1 cursor-pointer shrink-0"
                title={cart.has(id.identityId) ? 'Remove from CSV export' : 'Add to CSV export'}
              >
                <input
                  type="checkbox"
                  checked={cart.has(id.identityId)}
                  onChange={() => toggleCart(id.identityId)}
                  className="w-4 h-4 accent-cyan-400 cursor-pointer"
                  aria-label={`Select ${id.fullName} for CSV export`}
                />
              </label>
              <button
                onClick={() => setSelection({ type: 'identity', id: id.identityId })}
                className="flex-1 p-4 flex items-center gap-4 text-left min-w-0"
              >
                <FaceThumb url={id.thumbnailUrl} name={id.fullName} size={56} rounded={false} />
                <FlipStack documents={id.previewDocuments} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-mono font-bold text-slate-100 truncate">{id.fullName}</div>
                    {id.photoCount > 0 && (
                      <span className="shrink-0 text-[10px] font-mono font-bold text-cyan-300 bg-cyan-950/40 border border-cyan-500/30 rounded-full px-2 py-0.5" title="Extracted head photos">
                        {id.photoCount} photo{id.photoCount === 1 ? '' : 's'}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] font-mono text-slate-500 mt-0.5">DOB {id.dob}</div>
                  <div className="flex items-center gap-3 mt-2 text-[10px] font-mono">
                    <span className="text-matrix-400">{id.extractedCount} extracted</span>
                    {id.pendingCount > 0 && <span className="text-amber-300">{id.pendingCount} pending</span>}
                    {id.failedCount > 0 && <span className="text-rose-400">{id.failedCount} failed</span>}
                  </div>
                </div>
                <span className="shrink-0 text-[10px] font-mono font-bold text-matrix-400 bg-matrix-900/40 border border-matrix-500/30 rounded-full w-7 h-7 flex items-center justify-center self-center mr-4">
                  {id.documentCount}
                </span>
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

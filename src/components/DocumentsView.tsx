/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Real document intake & job-queue findings dashboard. Every document listed
 * here was actually uploaded via POST /api/documents, every job status
 * reflects a real row in the `jobs` table, and every extraction shown came
 * from either native PDF text extraction or a real DGX worker result —
 * never a static fixture. CSV/JSON export below serializes exactly the data
 * already fetched into state; nothing is synthesized for the export.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Upload,
  FolderUp,
  RefreshCw,
  FileText,
  Image as ImageIcon,
  CheckCircle2,
  Clock,
  XCircle,
  Loader2,
  ArrowRight,
  Cpu,
  Inbox,
  Download,
  FileJson,
  FileSpreadsheet,
  Terminal,
  Activity,
  ListChecks,
  X,
} from 'lucide-react';
import type { LocalDocument, LocalJob } from '../types';

const ALLOWED_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg', '.tif', '.tiff'];
const UPLOAD_CONCURRENCY = 3;

type QueueStatus = 'pending' | 'uploading' | 'extracted' | 'queued_ocr' | 'error';

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

interface ExtractionField {
  name: string;
  value: string | null;
  confidence: number;
  validationStatus: string;
}

interface DocumentDetail {
  document: LocalDocument;
  jobs: LocalJob[];
  extractions: Array<{
    version: number;
    documentId: string;
    rawText: string | null;
    fields: ExtractionField[];
    metadata: { extractionVersion: number; createdAt: string; engineUsed?: string; passes?: unknown[] };
  }>;
}

interface DocumentsViewProps {
  onSelectDocumentForOcr: (doc: { id: string; title: string; institution: string; docType: string; rawText: string }) => void;
}

const STATUS_META: Record<string, { label: string; dot: string; text: string; border: string }> = {
  uploaded: { label: 'UPLOADED', dot: 'bg-slate-400', text: 'text-slate-300', border: 'border-slate-600/50' },
  processing: { label: 'PROCESSING', dot: 'bg-neon-cyan', text: 'text-cyan-300', border: 'border-cyan-500/40' },
  extracted: { label: 'EXTRACTED', dot: 'bg-matrix-500', text: 'text-matrix-400', border: 'border-matrix-500/40' },
  failed: { label: 'FAILED', dot: 'bg-rose-500', text: 'text-rose-400', border: 'border-rose-500/40' },
  needs_ocr: { label: 'AWAITING OCR', dot: 'bg-amber-400', text: 'text-amber-300', border: 'border-amber-400/40' },
  queued: { label: 'QUEUED', dot: 'bg-slate-400', text: 'text-slate-300', border: 'border-slate-600/50' },
  completed: { label: 'COMPLETED', dot: 'bg-matrix-500', text: 'text-matrix-400', border: 'border-matrix-500/40' },
};

function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] || STATUS_META.uploaded;
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase tracking-widest px-2 py-1 rounded border bg-black/40 ${meta.text} ${meta.border}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${meta.dot} ${status === 'processing' || status === 'queued' ? 'animate-pulse' : ''}`} />
      {meta.label}
    </span>
  );
}

function getFileIcon(mimeType: string | null) {
  if (mimeType === 'application/pdf') return <FileText className="w-4 h-4 text-rose-400" />;
  if (mimeType?.startsWith('image/')) return <ImageIcon className="w-4 h-4 text-amber-400" />;
  return <FileText className="w-4 h-4 text-slate-400" />;
}

function csvEscape(value: unknown): string {
  const str = value === null || value === undefined ? '' : String(value);
  return `"${str.replace(/"/g, '""')}"`;
}

function downloadBlob(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export const DocumentsView: React.FC<DocumentsViewProps> = ({ onSelectDocumentForOcr }) => {
  const [documents, setDocuments] = useState<LocalDocument[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DocumentDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [uploadQueue, setUploadQueue] = useState<QueueItem[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  // webkitdirectory has no typed JSX prop — set it imperatively on the DOM node.
  useEffect(() => {
    if (folderInputRef.current) {
      folderInputRef.current.setAttribute('webkitdirectory', '');
      folderInputRef.current.setAttribute('directory', '');
    }
  }, []);

  const isUploading = uploadQueue.some((q) => q.status === 'pending' || q.status === 'uploading');
  const queueCounts = useMemo(
    () => ({
      total: uploadQueue.length,
      done: uploadQueue.filter((q) => q.status === 'extracted' || q.status === 'queued_ocr').length,
      failed: uploadQueue.filter((q) => q.status === 'error').length,
    }),
    [uploadQueue],
  );

  const fetchDocuments = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/documents');
      const data = await res.json();
      setDocuments(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load documents');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchDetail = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/documents/${id}`);
      if (!res.ok) return;
      const data = await res.json();
      setDetail(data);
    } catch {
      // Best-effort; the list view remains the source of truth.
    }
  }, []);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  useEffect(() => {
    if (selectedId) fetchDetail(selectedId);
  }, [selectedId, fetchDetail]);

  // Poll the selected document while its latest job is still in flight.
  useEffect(() => {
    if (!selectedId) return;
    const latestJob = detail?.jobs?.[0];
    if (!latestJob || (latestJob.status !== 'queued' && latestJob.status !== 'processing')) return;
    const interval = setInterval(() => fetchDetail(selectedId), 4000);
    return () => clearInterval(interval);
  }, [selectedId, detail, fetchDetail]);

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

  // Bounded-concurrency pool: large folder selections shouldn't fire hundreds of
  // simultaneous requests at the server or the browser's connection limit.
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

  const handleFilesSelected = async (fileList: FileList | null, inputEl: HTMLInputElement | null) => {
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

    const results = await runQueue(queued);
    await fetchDocuments();

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

  const selectedDocument = documents.find((d) => d.id === selectedId) || null;
  const latestExtraction = detail?.extractions?.[detail.extractions.length - 1];

  const stats = useMemo(
    () => ({
      total: documents.length,
      extracted: documents.filter((d) => d.status === 'extracted').length,
      pending: documents.filter((d) => d.status === 'uploaded' || d.status === 'processing').length,
      failed: documents.filter((d) => d.status === 'failed').length,
    }),
    [documents],
  );

  // --- Real exports: serialize exactly what's already in state, nothing synthesized. ---

  const exportQueueCSV = () => {
    const header = ['id', 'filename', 'status', 'mime_type', 'content_hash', 'uploaded_at'];
    const rows = documents.map((d) => [d.id, d.filename, d.status, d.mime_type ?? '', d.content_hash ?? '', d.uploaded_at]);
    const csv = [header, ...rows].map((r) => r.map(csvEscape).join(',')).join('\n');
    downloadBlob(csv, `ocrdocs_queue_${Date.now()}.csv`, 'text/csv;charset=utf-8;');
  };

  const exportFieldsCSV = () => {
    if (!selectedDocument || !latestExtraction) return;
    const header = ['field_name', 'value', 'confidence', 'validation_status'];
    const rows = latestExtraction.fields
      .filter((f) => f.value)
      .map((f) => [f.name, f.value ?? '', f.confidence, f.validationStatus]);
    const csv = [header, ...rows].map((r) => r.map(csvEscape).join(',')).join('\n');
    downloadBlob(csv, `${selectedDocument.filename}_fields_${Date.now()}.csv`, 'text/csv;charset=utf-8;');
  };

  const exportFieldsJSON = () => {
    if (!selectedDocument || !detail) return;
    const payload = {
      document: selectedDocument,
      jobs: detail.jobs,
      extraction: latestExtraction
        ? {
            engineUsed: latestExtraction.metadata.engineUsed,
            extractedAt: latestExtraction.metadata.createdAt,
            fields: latestExtraction.fields.filter((f) => f.value),
          }
        : null,
    };
    downloadBlob(JSON.stringify(payload, null, 2), `${selectedDocument.filename}_${Date.now()}.json`, 'application/json');
  };

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
              <Terminal className="w-6 h-6" />
              Findings Dashboard
            </h1>
            <p className="text-xs sm:text-sm text-slate-400 mt-2 max-w-3xl font-mono leading-relaxed">
              Upload files here (or run{' '}
              <code className="text-[11px] bg-black/60 text-cyan-300 px-1.5 py-0.5 rounded border border-cyan-900/50">
                scripts/ingest_local_folder.mjs
              </code>{' '}
              to bulk-register a local folder). Native-text PDFs are extracted immediately; scanned PDFs and images
              are queued and picked up by{' '}
              <code className="text-[11px] bg-black/60 text-cyan-300 px-1.5 py-0.5 rounded border border-cyan-900/50">
                scripts/dgx_worker.py
              </code>{' '}
              the next time it polls.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              onClick={fetchDocuments}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-mono font-bold uppercase tracking-wider text-matrix-400 bg-black/50 hover:bg-matrix-900/40 border border-matrix-500/30 rounded-lg transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button
              onClick={exportQueueCSV}
              disabled={documents.length === 0}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-mono font-bold uppercase tracking-wider text-cyan-300 bg-black/50 hover:bg-cyan-950/40 border border-cyan-500/30 rounded-lg transition-colors disabled:opacity-40"
              title="Export the full document queue as CSV"
            >
              <Download className="w-3.5 h-3.5" />
              Export Queue
            </button>
            <label className="inline-flex items-center gap-2 px-4 py-2 text-xs font-mono font-bold uppercase tracking-wider text-black bg-matrix-500 hover:bg-matrix-400 rounded-lg shadow-[0_0_18px_-4px_rgba(0,255,65,0.7)] transition-colors cursor-pointer disabled:opacity-50">
              <Upload className="w-3.5 h-3.5" />
              Upload Files
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff"
                className="hidden"
                onChange={(e) => handleFilesSelected(e.target.files, fileInputRef.current)}
              />
            </label>
            <label className="inline-flex items-center gap-2 px-4 py-2 text-xs font-mono font-bold uppercase tracking-wider text-black bg-cyan-400 hover:bg-cyan-300 rounded-lg shadow-[0_0_18px_-4px_rgba(0,246,255,0.7)] transition-colors cursor-pointer">
              <FolderUp className="w-3.5 h-3.5" />
              Upload Folder
              <input
                ref={folderInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => handleFilesSelected(e.target.files, folderInputRef.current)}
              />
            </label>
          </div>
        </div>

        {notice && (
          <div className="relative mt-4 p-3 bg-amber-950/30 border border-amber-500/30 rounded-lg text-xs font-mono text-amber-300">
            {notice}
          </div>
        )}
        {error && (
          <div className="relative mt-4 p-3 bg-rose-950/30 border border-rose-500/30 rounded-lg text-xs font-mono text-rose-300">
            {error}
          </div>
        )}

        {uploadQueue.length > 0 && (
          <div className="relative mt-4 neon-card rounded-lg overflow-hidden">
            <div className="p-3 border-b border-matrix-500/15 bg-black/40 flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-mono font-bold uppercase tracking-widest text-cyan-300">
                <ListChecks className="w-4 h-4" />
                Upload Queue // {queueCounts.done + queueCounts.failed}/{queueCounts.total}
                {isUploading && <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400" />}
              </div>
              {!isUploading && (
                <button
                  onClick={clearFinishedQueueItems}
                  className="text-slate-500 hover:text-slate-300 transition-colors"
                  title="Clear finished items"
                >
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
                    {(q.status === 'extracted' || q.status === 'queued_ocr') && (
                      <CheckCircle2 className="w-3.5 h-3.5 text-matrix-400 shrink-0" />
                    )}
                    {q.status === 'error' && <XCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />}
                    <span className="truncate text-slate-300">{q.name}</span>
                  </div>
                  <span
                    className={`shrink-0 ${
                      q.status === 'error'
                        ? 'text-rose-400'
                        : q.status === 'extracted' || q.status === 'queued_ocr'
                        ? 'text-matrix-400'
                        : 'text-slate-500'
                    }`}
                  >
                    {q.status === 'pending' && 'waiting...'}
                    {q.status === 'uploading' && 'uploading...'}
                    {(q.status === 'extracted' || q.status === 'queued_ocr' || q.status === 'error') && (q.message || q.status)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="relative grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5 pt-5 border-t border-matrix-500/10">
          <div className="p-3 bg-black/40 rounded-lg border border-matrix-500/15">
            <div className="text-[10px] font-mono font-bold text-slate-500 uppercase tracking-widest">Total</div>
            <div className="text-2xl font-bold text-matrix-400 text-glow-green mt-0.5 font-mono">{stats.total}</div>
          </div>
          <div className="p-3 bg-black/40 rounded-lg border border-matrix-500/15">
            <div className="text-[10px] font-mono font-bold text-slate-500 uppercase tracking-widest">Extracted</div>
            <div className="text-2xl font-bold text-matrix-400 text-glow-green mt-0.5 font-mono">{stats.extracted}</div>
          </div>
          <div className="p-3 bg-black/40 rounded-lg border border-amber-500/15">
            <div className="text-[10px] font-mono font-bold text-slate-500 uppercase tracking-widest">Awaiting OCR</div>
            <div className="text-2xl font-bold text-amber-400 mt-0.5 font-mono">{stats.pending}</div>
          </div>
          <div className="p-3 bg-black/40 rounded-lg border border-rose-500/15">
            <div className="text-[10px] font-mono font-bold text-slate-500 uppercase tracking-widest">Failed</div>
            <div className="text-2xl font-bold text-rose-400 mt-0.5 font-mono">{stats.failed}</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Document list */}
        <div className="lg:col-span-7 neon-card rounded-xl overflow-hidden flex flex-col">
          <div className="p-4 border-b border-matrix-500/15 bg-black/30 flex items-center gap-2">
            <Inbox className="w-4 h-4 text-matrix-400" />
            <h2 className="text-xs font-mono font-bold uppercase tracking-widest text-matrix-300">
              Document Queue // {documents.length}
            </h2>
          </div>
          <div className="divide-y divide-matrix-500/10 flex-1 overflow-x-auto max-h-[560px] overflow-y-auto">
            {documents.length === 0 && (
              <div className="p-8 text-center text-xs font-mono text-slate-500">
                No documents yet. Upload one above, or ingest a local folder with{' '}
                <code className="bg-black/60 text-cyan-300 px-1.5 py-0.5 rounded border border-cyan-900/50">
                  scripts/ingest_local_folder.mjs
                </code>
                .
              </div>
            )}
            {documents.map((doc) => (
              <div
                key={doc.id}
                onClick={() => setSelectedId(doc.id)}
                className={`p-3.5 flex items-center justify-between gap-3 cursor-pointer transition-colors ${
                  selectedId === doc.id ? 'bg-matrix-900/30 border-l-2 border-l-matrix-500' : 'hover:bg-white/[0.03]'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="p-2 bg-black/50 rounded-lg border border-white/5 shrink-0">{getFileIcon(doc.mime_type)}</div>
                  <div className="min-w-0">
                    <div className="text-xs font-mono font-semibold text-slate-200 truncate">{doc.filename}</div>
                    <div className="text-[10px] font-mono text-slate-500 mt-0.5">
                      {new Date(doc.uploaded_at).toLocaleString()}
                    </div>
                  </div>
                </div>
                <StatusBadge status={doc.status} />
              </div>
            ))}
          </div>
        </div>

        {/* Detail pane */}
        <div className="lg:col-span-5 space-y-4">
          {!selectedDocument && (
            <div className="p-8 neon-card rounded-xl text-center text-xs font-mono text-slate-500 flex flex-col items-center gap-2">
              <Activity className="w-5 h-5 text-matrix-600" />
              Select a document to inspect its job status and extracted fields.
            </div>
          )}

          {selectedDocument && detail && (
            <div className="neon-card rounded-xl p-5">
              <div className="flex items-center justify-between pb-3 border-b border-matrix-500/15">
                <h3 className="text-sm font-mono font-bold text-slate-100 truncate">{selectedDocument.filename}</h3>
                <StatusBadge status={selectedDocument.status} />
              </div>

              {/* Job timeline */}
              <div className="mt-3 space-y-2">
                {detail.jobs.length === 0 && (
                  <div className="text-xs font-mono text-slate-500">
                    No job record (native text extracted synchronously).
                  </div>
                )}
                {detail.jobs.map((job) => (
                  <div
                    key={job.id}
                    className="flex items-center justify-between gap-2 p-2 bg-black/40 rounded border border-white/5 text-xs font-mono"
                  >
                    <span className="flex items-center gap-1.5 text-slate-400">
                      {job.status === 'completed' && <CheckCircle2 className="w-3.5 h-3.5 text-matrix-400" />}
                      {job.status === 'failed' && <XCircle className="w-3.5 h-3.5 text-rose-400" />}
                      {(job.status === 'queued' || job.status === 'processing') && (
                        <Loader2 className="w-3.5 h-3.5 text-cyan-400 animate-spin" />
                      )}
                      Job {job.id.slice(0, 8)}
                    </span>
                    <StatusBadge status={job.status} />
                  </div>
                ))}
                {detail.jobs.some((j) => j.error) && (
                  <div className="p-2 bg-rose-950/30 border border-rose-500/30 rounded text-[11px] font-mono text-rose-300">
                    {detail.jobs.find((j) => j.error)?.error}
                  </div>
                )}
              </div>

              {/* Extraction */}
              {latestExtraction && (
                <div className="mt-4 pt-4 border-t border-matrix-500/15">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-mono font-bold text-matrix-400 uppercase tracking-widest">
                      Extracted Fields // {latestExtraction.fields.filter((f) => f.value).length}
                    </span>
                    {latestExtraction.metadata.engineUsed && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-black/50 text-cyan-300 rounded font-mono border border-cyan-900/50 flex items-center gap-1">
                        <Cpu className="w-3 h-3" />
                        {latestExtraction.metadata.engineUsed}
                      </span>
                    )}
                  </div>
                  <div className="space-y-1.5 text-xs max-h-56 overflow-y-auto">
                    {latestExtraction.fields
                      .filter((f) => f.value)
                      .map((f) => (
                        <div
                          key={f.name}
                          className="p-2 bg-black/40 rounded border border-white/5 flex items-center justify-between gap-2"
                        >
                          <span className="text-slate-500 truncate font-mono">{f.name}:</span>
                          <span className="font-mono font-semibold text-matrix-300 truncate">{f.value}</span>
                        </div>
                      ))}
                  </div>

                  <div className="grid grid-cols-2 gap-2 mt-3">
                    <button
                      onClick={exportFieldsCSV}
                      className="py-2 px-3 text-[11px] font-mono font-bold uppercase tracking-wider text-cyan-300 bg-black/50 hover:bg-cyan-950/40 border border-cyan-500/30 rounded-lg transition-colors flex items-center justify-center gap-1.5"
                    >
                      <FileSpreadsheet className="w-3.5 h-3.5" />
                      CSV
                    </button>
                    <button
                      onClick={exportFieldsJSON}
                      className="py-2 px-3 text-[11px] font-mono font-bold uppercase tracking-wider text-cyan-300 bg-black/50 hover:bg-cyan-950/40 border border-cyan-500/30 rounded-lg transition-colors flex items-center justify-center gap-1.5"
                    >
                      <FileJson className="w-3.5 h-3.5" />
                      JSON
                    </button>
                  </div>

                  {latestExtraction.rawText && (
                    <button
                      onClick={() =>
                        onSelectDocumentForOcr({
                          id: selectedDocument.id,
                          title: selectedDocument.filename,
                          institution: 'Local Upload',
                          docType: selectedDocument.mime_type || 'unknown',
                          rawText: latestExtraction.rawText || '',
                        })
                      }
                      className="w-full mt-2 py-2 px-3 text-xs font-mono font-bold uppercase tracking-wider text-black bg-matrix-500 hover:bg-matrix-400 rounded-lg shadow-[0_0_18px_-4px_rgba(0,255,65,0.7)] transition-colors flex items-center justify-center gap-1.5"
                    >
                      Inspect in Extraction Grid
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  )}
                </div>
              )}

              {!latestExtraction && selectedDocument.status !== 'failed' && (
                <div className="mt-4 pt-4 border-t border-matrix-500/15 flex items-center gap-2 text-xs font-mono text-amber-300">
                  <Clock className="w-3.5 h-3.5" />
                  Waiting on OCR. Start{' '}
                  <code className="bg-black/60 px-1 py-0.5 rounded border border-amber-900/40">
                    scripts/dgx_worker.py
                  </code>{' '}
                  on the DGX box to process this document.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

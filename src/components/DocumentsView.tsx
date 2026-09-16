/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Real document intake & job-queue view. Replaces the fabricated Google
 * Drive Hub and the fabricated 10-pass regression demo: every document
 * listed here was actually uploaded via POST /api/documents, every job
 * status reflects a real row in the `jobs` table, and every extraction
 * shown came from either native PDF text extraction or a real DGX worker
 * result — never a static fixture.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Upload,
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
} from 'lucide-react';
import type { LocalDocument, LocalJob } from '../types';

interface DocumentDetail {
  document: LocalDocument;
  jobs: LocalJob[];
  extractions: Array<{
    version: number;
    documentId: string;
    rawText: string | null;
    fields: Array<{ name: string; value: string | null; confidence: number; validationStatus: string }>;
    metadata: { extractionVersion: number; createdAt: string; engineUsed?: string };
  }>;
}

interface DocumentsViewProps {
  onSelectDocumentForOcr: (doc: { id: string; title: string; institution: string; docType: string; rawText: string }) => void;
}

const STATUS_STYLES: Record<string, string> = {
  uploaded: 'bg-slate-100 text-slate-700 border-slate-300',
  processing: 'bg-blue-100 text-blue-800 border-blue-300',
  extracted: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  failed: 'bg-rose-100 text-rose-800 border-rose-300',
  needs_ocr: 'bg-amber-100 text-amber-800 border-amber-300',
  queued: 'bg-slate-100 text-slate-700 border-slate-300',
  completed: 'bg-emerald-100 text-emerald-800 border-emerald-300',
};

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_STYLES[status] || 'bg-slate-100 text-slate-700 border-slate-300';
  return (
    <span className={`text-[10px] font-mono font-semibold uppercase tracking-wider px-2 py-0.5 rounded border ${cls}`}>
      {status}
    </span>
  );
}

function getFileIcon(mimeType: string | null) {
  if (mimeType === 'application/pdf') return <FileText className="w-5 h-5 text-rose-600" />;
  if (mimeType?.startsWith('image/')) return <ImageIcon className="w-5 h-5 text-amber-600" />;
  return <FileText className="w-5 h-5 text-slate-500" />;
}

export const DocumentsView: React.FC<DocumentsViewProps> = ({ onSelectDocumentForOcr }) => {
  const [documents, setDocuments] = useState<LocalDocument[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DocumentDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    setNotice(null);
    let succeeded = 0;
    let failed = 0;
    for (const file of Array.from(files)) {
      const formData = new FormData();
      formData.append('file', file);
      try {
        const res = await fetch('/api/documents', { method: 'POST', body: formData });
        const data = await res.json();
        if (res.status === 201 || res.status === 202) {
          succeeded++;
          if (res.status === 202) {
            setNotice((prev) => `${prev ? prev + ' ' : ''}${file.name}: ${data.message}`);
          }
        } else {
          failed++;
          setError((prev) => `${prev ? prev + '; ' : ''}${file.name}: ${data.error || 'upload failed'}`);
        }
      } catch (err: any) {
        failed++;
        setError((prev) => `${prev ? prev + '; ' : ''}${file.name}: ${err?.message || 'network error'}`);
      }
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
    await fetchDocuments();
    if (succeeded > 0 && failed === 0) setNotice(`Uploaded ${succeeded} file(s) successfully.`);
  };

  const selectedDocument = documents.find((d) => d.id === selectedId) || null;
  const latestExtraction = detail?.extractions?.[detail.extractions.length - 1];

  return (
    <div className="space-y-6">
      {/* Header / Upload */}
      <div className="p-6 bg-white border border-slate-200 rounded-xl shadow-xs">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="px-2 py-0.5 text-xs font-semibold bg-blue-100 text-blue-800 rounded-md">
                Real Document Pipeline
              </span>
              <span className="px-2 py-0.5 text-xs font-semibold bg-emerald-100 text-emerald-800 rounded-md flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" />
                No fixtures, no fabricated passes
              </span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Local Documents & DGX Job Queue</h1>
            <p className="text-sm text-slate-600 mt-1 max-w-3xl">
              Upload files here (or run <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded font-mono">scripts/ingest_local_folder.mjs</code> to
              bulk-register a local folder). Native-text PDFs are extracted immediately; scanned PDFs and images are
              queued and picked up by <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded font-mono">scripts/dgx_worker.py</code> the
              next time it polls.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              onClick={fetchDocuments}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <label className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-xs transition-colors cursor-pointer disabled:opacity-50">
              <Upload className={`w-3.5 h-3.5 ${uploading ? 'animate-pulse' : ''}`} />
              {uploading ? 'Uploading...' : 'Upload Documents'}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff"
                className="hidden"
                disabled={uploading}
                onChange={(e) => handleUpload(e.target.files)}
              />
            </label>
          </div>
        </div>

        {notice && (
          <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900">{notice}</div>
        )}
        {error && (
          <div className="mt-4 p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-900">{error}</div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5 pt-5 border-t border-slate-100">
          <div className="p-3 bg-slate-50 rounded-lg border border-slate-200/60">
            <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Total Documents</div>
            <div className="text-xl font-bold text-slate-900 mt-0.5">{documents.length}</div>
          </div>
          <div className="p-3 bg-slate-50 rounded-lg border border-slate-200/60">
            <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Extracted</div>
            <div className="text-xl font-bold text-emerald-700 mt-0.5">
              {documents.filter((d) => d.status === 'extracted').length}
            </div>
          </div>
          <div className="p-3 bg-slate-50 rounded-lg border border-slate-200/60">
            <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Awaiting DGX OCR</div>
            <div className="text-xl font-bold text-amber-700 mt-0.5">
              {documents.filter((d) => d.status === 'uploaded' || d.status === 'processing').length}
            </div>
          </div>
          <div className="p-3 bg-slate-50 rounded-lg border border-slate-200/60">
            <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Failed</div>
            <div className="text-xl font-bold text-rose-700 mt-0.5">
              {documents.filter((d) => d.status === 'failed').length}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Document list */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden flex flex-col">
          <div className="p-4 border-b border-slate-200 bg-slate-50/50 flex items-center gap-2">
            <Inbox className="w-4 h-4 text-slate-600" />
            <h2 className="text-sm font-bold text-slate-900">Document Queue ({documents.length})</h2>
          </div>
          <div className="divide-y divide-slate-100 flex-1 overflow-x-auto">
            {documents.length === 0 && (
              <div className="p-8 text-center text-xs text-slate-500">
                No documents yet. Upload one above, or ingest a local folder with{' '}
                <code className="bg-slate-100 px-1.5 py-0.5 rounded font-mono">scripts/ingest_local_folder.mjs</code>.
              </div>
            )}
            {documents.map((doc) => (
              <div
                key={doc.id}
                onClick={() => setSelectedId(doc.id)}
                className={`p-3.5 flex items-center justify-between gap-3 cursor-pointer transition-colors ${
                  selectedId === doc.id ? 'bg-blue-50/60 border-l-4 border-l-blue-600' : 'hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="p-2 bg-slate-100 rounded-lg shrink-0">{getFileIcon(doc.mime_type)}</div>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-slate-900 truncate">{doc.filename}</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
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
            <div className="p-8 bg-white border border-dashed border-slate-300 rounded-xl text-center text-xs text-slate-500">
              Select a document to inspect its job status and extracted fields.
            </div>
          )}

          {selectedDocument && detail && (
            <div className="p-5 bg-white border border-slate-200 rounded-xl shadow-xs">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <h3 className="text-sm font-bold text-slate-900 truncate">{selectedDocument.filename}</h3>
                <StatusBadge status={selectedDocument.status} />
              </div>

              {/* Job timeline */}
              <div className="mt-3 space-y-2">
                {detail.jobs.length === 0 && (
                  <div className="text-xs text-slate-500">No job record (native text extracted synchronously).</div>
                )}
                {detail.jobs.map((job) => (
                  <div
                    key={job.id}
                    className="flex items-center justify-between gap-2 p-2 bg-slate-50 rounded border border-slate-200/60 text-xs"
                  >
                    <span className="flex items-center gap-1.5 text-slate-600">
                      {job.status === 'completed' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />}
                      {job.status === 'failed' && <XCircle className="w-3.5 h-3.5 text-rose-600" />}
                      {(job.status === 'queued' || job.status === 'processing') && (
                        <Loader2 className="w-3.5 h-3.5 text-blue-600 animate-spin" />
                      )}
                      Job {job.id.slice(0, 8)}
                    </span>
                    <StatusBadge status={job.status} />
                  </div>
                ))}
                {detail.jobs.some((j) => j.error) && (
                  <div className="p-2 bg-rose-50 border border-rose-200 rounded text-[11px] text-rose-800">
                    {detail.jobs.find((j) => j.error)?.error}
                  </div>
                )}
              </div>

              {/* Extraction */}
              {latestExtraction && (
                <div className="mt-4 pt-4 border-t border-slate-100">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
                      Extracted Fields ({latestExtraction.fields.filter((f) => f.value).length})
                    </span>
                    {latestExtraction.metadata.engineUsed && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded font-mono flex items-center gap-1">
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
                          className="p-2 bg-slate-50 rounded border border-slate-200/60 flex items-center justify-between gap-2"
                        >
                          <span className="text-slate-500 truncate">{f.name}:</span>
                          <span className="font-mono font-semibold text-slate-900 truncate">{f.value}</span>
                        </div>
                      ))}
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
                      className="w-full mt-3 py-2 px-3 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-xs transition-colors flex items-center justify-center gap-1.5"
                    >
                      Inspect in Extraction Grid
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  )}
                </div>
              )}

              {!latestExtraction && selectedDocument.status !== 'failed' && (
                <div className="mt-4 pt-4 border-t border-slate-100 flex items-center gap-2 text-xs text-amber-700">
                  <Clock className="w-3.5 h-3.5" />
                  Waiting on OCR. Start <code className="bg-slate-100 px-1 py-0.5 rounded font-mono">scripts/dgx_worker.py</code> on
                  the DGX box to process this document.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * One document's card: preview + download, its job status, the extracted
 * fields at a glance, and the Review & Approve panel toggle.
 */

import React, { useState } from 'react';
import {
  FileText,
  Image as ImageIcon,
  CheckCircle2,
  Clock,
  XCircle,
  Loader2,
  Download,
  Eye,
  RefreshCw,
  ListChecks,
  Cpu,
} from 'lucide-react';
import type { IdentityDocumentDetail, LocalJob } from '../../types';
import { FieldReviewPanel } from './FieldReviewPanel';

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
    <span className={`inline-flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase tracking-widest px-2 py-1 rounded border bg-black/40 ${meta.text} ${meta.border}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${meta.dot} ${status === 'processing' || status === 'queued' ? 'animate-pulse' : ''}`} />
      {meta.label}
    </span>
  );
}

interface DocumentCardProps {
  detail: IdentityDocumentDetail;
  jobs?: LocalJob[];
  defaultExpanded?: boolean;
  onReprocessed?: () => void;
}

export const DocumentCard: React.FC<DocumentCardProps> = ({ detail, jobs = [], defaultExpanded = false, onReprocessed }) => {
  const { document, extraction } = detail;
  const [reviewOpen, setReviewOpen] = useState(defaultExpanded);
  const [error, setError] = useState<string | null>(null);
  const [reprocessing, setReprocessing] = useState(false);
  const isImage = document.mime_type?.startsWith('image/');

  const reprocess = async () => {
    setReprocessing(true);
    setError(null);
    try {
      const res = await fetch(`/api/documents/${document.id}/reprocess`, { method: 'POST' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `Reprocess failed (${res.status})`);
      onReprocessed?.();
    } catch (e: any) {
      setError(e?.message || 'Reprocess failed');
    } finally {
      setReprocessing(false);
    }
  };

  const visibleFields = extraction?.fields.filter((f) => f.value) ?? [];

  return (
    <div className="neon-card rounded-xl p-4">
      <div className="flex items-start gap-3">
        <div className="w-16 h-16 rounded-lg overflow-hidden border border-white/10 bg-black/50 flex items-center justify-center shrink-0">
          {isImage ? (
            <img src={`/api/documents/${document.id}/file`} alt={document.filename} className="w-full h-full object-cover" />
          ) : (
            <FileText className="w-6 h-6 text-rose-400" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-xs font-mono font-bold text-slate-100 truncate">{document.filename}</h4>
            <StatusBadge status={document.status} />
          </div>
          <div className="text-[10px] font-mono text-slate-500 mt-0.5">{new Date(document.uploaded_at).toLocaleString()}</div>
          <div className="flex items-center gap-2 mt-2">
            <a
              href={`/api/documents/${document.id}/file`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-mono font-bold uppercase text-cyan-300 bg-black/50 hover:bg-cyan-950/40 border border-cyan-500/30 rounded"
            >
              <Eye className="w-3 h-3" />
              Preview
            </a>
            <a
              href={`/api/documents/${document.id}/file?download=1`}
              className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-mono font-bold uppercase text-cyan-300 bg-black/50 hover:bg-cyan-950/40 border border-cyan-500/30 rounded"
            >
              <Download className="w-3 h-3" />
              Download
            </a>
          </div>
        </div>
      </div>

      {jobs.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {jobs.map((job) => (
            <div key={job.id} className="flex items-center justify-between gap-2 p-1.5 bg-black/40 rounded border border-white/5 text-[11px] font-mono">
              <span className="flex items-center gap-1.5 text-slate-400">
                {job.status === 'completed' && <CheckCircle2 className="w-3.5 h-3.5 text-matrix-400" />}
                {job.status === 'failed' && <XCircle className="w-3.5 h-3.5 text-rose-400" />}
                {(job.status === 'queued' || job.status === 'processing') && <Loader2 className="w-3.5 h-3.5 text-cyan-400 animate-spin" />}
                Job {job.id.slice(0, 8)}
              </span>
              <StatusBadge status={job.status} />
            </div>
          ))}
          {jobs.some((j) => j.error) && (
            <div className="p-2 bg-rose-950/30 border border-rose-500/30 rounded text-[11px] font-mono text-rose-300">
              {jobs.find((j) => j.error)?.error}
            </div>
          )}
        </div>
      )}

      {extraction && (
        <div className="mt-3 pt-3 border-t border-matrix-500/15">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-mono font-bold text-matrix-400 uppercase tracking-widest">
              Extracted Fields // {visibleFields.length}
            </span>
            {extraction.metadata.engineUsed && (
              <span className="text-[10px] px-1.5 py-0.5 bg-black/50 text-cyan-300 rounded font-mono border border-cyan-900/50 flex items-center gap-1">
                <Cpu className="w-3 h-3" />
                {extraction.metadata.engineUsed}
              </span>
            )}
          </div>
          <div className="space-y-1.5 text-xs max-h-56 overflow-y-auto">
            {visibleFields.map((f) => (
              <div key={f.name} className="p-2 bg-black/40 rounded border border-white/5 flex items-center justify-between gap-2">
                <span className="text-slate-500 truncate font-mono">{f.name}:</span>
                <span className="font-mono font-semibold text-matrix-300 truncate">{f.value}</span>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2 mt-3">
            <button
              onClick={reprocess}
              disabled={reprocessing}
              className="py-2 px-3 text-[11px] font-mono font-bold uppercase tracking-wider text-cyan-300 bg-black/50 hover:bg-cyan-950/40 border border-cyan-500/30 rounded-lg transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${reprocessing ? 'animate-spin' : ''}`} />
              Re-run OCR
            </button>
            <button
              onClick={() => setReviewOpen((v) => !v)}
              className="py-2 px-3 text-[11px] font-mono font-bold uppercase tracking-wider text-amber-300 bg-black/50 hover:bg-amber-950/30 border border-amber-500/30 rounded-lg transition-colors flex items-center justify-center gap-1.5"
            >
              <ListChecks className="w-3.5 h-3.5" />
              {reviewOpen ? 'Close Review' : 'Review & Approve'}
            </button>
          </div>

          {error && <div className="mt-2 p-2 bg-rose-950/30 border border-rose-500/30 rounded text-[11px] font-mono text-rose-300">{error}</div>}

          {reviewOpen && (
            <div className="mt-3">
              <FieldReviewPanel extractionId={extraction.id} onChanged={onReprocessed} />
            </div>
          )}
        </div>
      )}

      {!extraction && document.status !== 'failed' && (
        <div className="mt-3 pt-3 border-t border-matrix-500/15 flex items-center gap-2 text-xs font-mono text-amber-300">
          <Clock className="w-3.5 h-3.5" />
          Waiting on OCR — the DGX worker will pick this up on its next poll.
        </div>
      )}
    </div>
  );
};

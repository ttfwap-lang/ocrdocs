/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Full detail page for either an identified person (grouped by name + DOB)
 * or a single unassigned document that hasn't been matched to anyone yet.
 * Everything here is real: previews stream the actual stored file, the
 * breakdown is the actual merged fields table, and Export ZIP downloads the
 * actual originals plus a generated parsed-data text file.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Download, User, Calendar, FileStack, CheckCircle2, Clock, XCircle, Images, ExternalLink } from 'lucide-react';
import type { IdentityDetail, IdentityDocumentDetail, IdentityPhoto, LocalJob } from '../types';
import { DocumentCard } from './identity/DocumentCard';
import { FaceThumb } from './identity/FaceThumb';

export type DetailSelection = { type: 'identity'; id: string } | { type: 'document'; id: string };

interface IdentityDetailPageProps {
  selection: DetailSelection;
  onBack: () => void;
}

function HeadPhotoGrid({ photos }: { photos: IdentityPhoto[] }) {
  if (photos.length === 0) {
    return (
      <div className="text-xs font-mono text-slate-500 py-2">
        No head photos found in this person's documents yet. Re-upload an ID page and run{' '}
        <code className="text-cyan-300">scripts/extract_headshots.py</code> to populate this gallery.
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-3">
      {photos.map((p, i) => (
        <a
          key={`${p.relPath}-${i}`}
          href={p.url}
          target="_blank"
          rel="noreferrer"
          title={`${p.document} · page ${p.page}${p.verified ? '' : ' · unverified'}`}
          className="group relative block rounded-lg overflow-hidden border border-white/10 hover:border-cyan-500/50 transition-colors bg-black/40"
        >
          <img src={p.url} alt={`Head photo from ${p.document}`} loading="lazy" className="w-full aspect-square object-cover group-hover:scale-105 transition-transform" />
          <span className="absolute bottom-1 left-1 right-1 flex items-center justify-between gap-1 px-1.5 py-0.5 bg-black/70 rounded text-[9px] font-mono text-slate-300 truncate">
            <span className="truncate">{p.document.split(/[\\/]/).pop()}</span>
            {p.verified ? (
              <span className="shrink-0 text-matrix-400 font-bold" title="Face re-detected in crop">✓</span>
            ) : (
              <span className="shrink-0 text-amber-400" title="Unverified crop — flagged by the detector QA pass">?</span>
            )}
          </span>
        </a>
      ))}
    </div>
  );
}

export const IdentityDetailPage: React.FC<IdentityDetailPageProps> = ({ selection, onBack }) => {
  const [identity, setIdentity] = useState<IdentityDetail | null>(null);
  const [singleDoc, setSingleDoc] = useState<IdentityDocumentDetail | null>(null);
  const [singleDocJobs, setSingleDocJobs] = useState<LocalJob[]>([]);
  const [singleDocPhotos, setSingleDocPhotos] = useState<IdentityPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadIdentity = useCallback(async (identityId: string) => {
    const res = await fetch(`/api/identities/${identityId}`);
    if (!res.ok) throw new Error(`Failed to load identity (${res.status})`);
    setIdentity(await res.json());
  }, []);

  const loadDocument = useCallback(async (documentId: string) => {
    const res = await fetch(`/api/documents/${documentId}`);
    if (!res.ok) throw new Error(`Failed to load document (${res.status})`);
    const body = await res.json();
    const latest = body.extractions?.[0] ?? null;
    setSingleDoc({ document: body.document, extraction: latest });
    setSingleDocJobs(body.jobs ?? []);
    setSingleDocPhotos(body.photos ?? []);
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      if (selection.type === 'identity') {
        await loadIdentity(selection.id);
      } else {
        await loadDocument(selection.id);
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [selection, loadIdentity, loadDocument]);

  useEffect(() => {
    setLoading(true);
    setIdentity(null);
    setSingleDoc(null);
    setSingleDocPhotos([]);
    load();
  }, [load]);

  // While a lone document is still queued/processing, poll so the reviewer
  // doesn't have to manually refresh to see OCR land.
  useEffect(() => {
    if (selection.type !== 'document') return;
    const latestJob = singleDocJobs[0];
    if (!latestJob || (latestJob.status !== 'queued' && latestJob.status !== 'processing')) return;
    const interval = setInterval(load, 4000);
    return () => clearInterval(interval);
  }, [selection, singleDocJobs, load]);

  if (loading) {
    return <div className="p-10 text-center text-xs font-mono text-slate-500">Loading…</div>;
  }
  if (error) {
    return (
      <div className="space-y-4">
        <BackButton onBack={onBack} />
        <div className="p-4 bg-rose-950/30 border border-rose-500/30 rounded-lg text-xs font-mono text-rose-300">{error}</div>
      </div>
    );
  }

  if (selection.type === 'document') {
    if (!singleDoc) return null;
    return (
      <div className="space-y-4">
        <BackButton onBack={onBack} />
        <div className="neon-card rounded-xl p-5">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div>
              <div className="text-[10px] font-mono font-bold text-amber-300 uppercase tracking-widest mb-1">Unassigned Document</div>
              <p className="text-xs font-mono text-slate-500">
                No family name + date of birth could be matched yet, so this document isn't grouped under a person. Once it's extracted (or
                corrected below), re-uploading a related document will group them together automatically.
              </p>
            </div>
            {singleDoc && (
              <FaceThumb url={singleDocPhotos[0]?.url ?? null} name={singleDoc.document.filename} size={64} rounded={false} />
            )}
          </div>
        </div>
        {singleDocPhotos.length > 0 && (
          <div className="neon-card rounded-xl p-5">
            <h2 className="text-xs font-mono font-bold uppercase tracking-widest text-cyan-300 mb-3 flex items-center gap-2">
              <Images className="w-4 h-4" /> Head Photos in This Document // {singleDocPhotos.length}
            </h2>
            <HeadPhotoGrid photos={singleDocPhotos} />
          </div>
        )}
        <DocumentCard detail={singleDoc!} jobs={singleDocJobs} onReprocessed={load} />
      </div>
    );
  }

  if (!identity) return null;

  return (
    <div className="space-y-6">
      <BackButton onBack={onBack} />

      <div className="neon-card rounded-xl p-6 relative overflow-hidden">
        <div className="absolute inset-0 crt-scanlines" />
        <div className="relative flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="flex items-center gap-4">
            <FaceThumb url={identity.thumbnailUrl} name={identity.fullName} size={96} rounded={false} className="hidden sm:flex" />
            <div>
              <div className="flex items-center gap-2 text-matrix-400 mb-1">
                <User className="w-5 h-5" />
                <h1 className="glitch-heading text-2xl sm:text-3xl font-bold tracking-wide uppercase">{identity.fullName}</h1>
              </div>
              <div className="flex flex-wrap items-center gap-4 text-xs font-mono text-slate-400 mt-2">
                <span className="flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-cyan-400" />
                  DOB {identity.dob}
                </span>
                <span className="flex items-center gap-1.5">
                  <FileStack className="w-3.5 h-3.5 text-matrix-400" />
                  {identity.documentCount} document{identity.documentCount === 1 ? '' : 's'}
                </span>
                <span className="flex items-center gap-1.5 text-matrix-400">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {identity.extractedCount} extracted
                </span>
                {identity.pendingCount > 0 && (
                  <span className="flex items-center gap-1.5 text-amber-300">
                    <Clock className="w-3.5 h-3.5" />
                    {identity.pendingCount} pending
                  </span>
                )}
                {identity.failedCount > 0 && (
                  <span className="flex items-center gap-1.5 text-rose-400">
                    <XCircle className="w-3.5 h-3.5" />
                    {identity.failedCount} failed
                  </span>
                )}
                {identity.photoCount > 0 && (
                  <a
                    href="#head-photos"
                    className="flex items-center gap-1.5 text-cyan-300 hover:text-cyan-200 transition-colors underline decoration-cyan-500/40 underline-offset-2"
                  >
                    <Images className="w-3.5 h-3.5" />
                    {identity.photoCount} head photo{identity.photoCount === 1 ? '' : 's'}
                  </a>
                )}
              </div>
            </div>
          </div>

          <a
            href={`/api/identities/${identity.identityId}/export.zip`}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-mono font-bold uppercase tracking-wider text-black bg-matrix-500 hover:bg-matrix-400 rounded-lg shadow-[0_0_18px_-4px_rgba(0,255,65,0.7)] transition-colors shrink-0"
          >
            <Download className="w-4 h-4" />
            Export All (ZIP)
          </a>
        </div>
      </div>

      <div className="neon-card rounded-xl p-5" id="head-photos">
        <h2 className="text-xs font-mono font-bold uppercase tracking-widest text-cyan-300 mb-3 flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Images className="w-4 h-4" /> Head Photos // {identity.photos.length}
          </span>
          {identity.photos.length > 0 && (
            <a
              href={identity.photos[0].url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-[10px] font-mono text-slate-400 hover:text-cyan-300 transition-colors"
            >
              Open full-res <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </h2>
        <HeadPhotoGrid photos={identity.photos} />
      </div>

      <div className="neon-card rounded-xl p-5">
        <h2 className="text-xs font-mono font-bold uppercase tracking-widest text-matrix-300 mb-3">
          Consolidated Breakdown // {identity.fieldBreakdown.length} fields
        </h2>
        {identity.fieldBreakdown.length === 0 ? (
          <div className="text-xs font-mono text-slate-500">No fields extracted across this person's documents yet.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
            {identity.fieldBreakdown.map((f) => (
              <div key={f.name} className={`p-2.5 rounded border text-xs ${f.approved ? 'bg-matrix-950/30 border-matrix-500/40' : 'bg-black/40 border-white/5'}`}>
                <div className="text-[10px] font-mono text-slate-500 truncate">{f.name}</div>
                <div className="font-mono font-semibold text-matrix-300 truncate">{f.value}</div>
                <div className="text-[9px] font-mono text-slate-600 mt-0.5 truncate">
                  {Math.round(f.confidence)}% · {f.approved ? 'approved' : 'unapproved'} · {f.documentFilename}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h2 className="text-xs font-mono font-bold uppercase tracking-widest text-matrix-300 mb-3">Source Documents</h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {identity.documents.map((d) => (
            <DocumentCard key={d.document.id} detail={d} onReprocessed={() => loadIdentity(identity.identityId)} />
          ))}
        </div>
      </div>
    </div>
  );
};

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <button
      onClick={onBack}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-mono font-bold uppercase tracking-wider text-slate-400 hover:text-matrix-300 bg-black/40 hover:bg-matrix-950/30 border border-matrix-500/20 rounded-lg transition-colors"
    >
      <ArrowLeft className="w-3.5 h-3.5" />
      Back
    </button>
  );
}

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
import { ArrowLeft, Download, User, Calendar, FileStack, CheckCircle2, Clock, XCircle, Images, ExternalLink, ShieldCheck, FileText } from 'lucide-react';
import type { IdentityDetail, IdentityDocumentDetail, IdentityPhoto, KeyIdentifier, LocalJob } from '../types';
import { DocumentCard } from './identity/DocumentCard';
import { FaceThumb } from './identity/FaceThumb';

export type DetailSelection = { type: 'identity'; id: string } | { type: 'document'; id: string };

interface IdentityDetailPageProps {
  selection: DetailSelection;
  onBack: () => void;
}

/** Badge + colour for a key identifier's verification tier. */
function TierBadge({ identifier }: { identifier: KeyIdentifier }) {
  if (identifier.tier === 'triple_checked') {
    return (
      <span
        className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-mono font-bold uppercase tracking-wider text-matrix-400 bg-matrix-950/60 border border-matrix-500/40 rounded-full"
        title={identifier.explanation}
      >
        <ShieldCheck className="w-3 h-3" />
        Triple-checked
      </span>
    );
  }
  if (identifier.tier === 'single_source') {
    return (
      <span
        className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-mono font-bold uppercase tracking-wider text-cyan-300 bg-cyan-950/40 border border-cyan-500/30 rounded-full"
        title={identifier.explanation}
      >
        <FileText className="w-3 h-3" />
        Verified · 1 source
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-mono font-bold uppercase tracking-wider text-amber-300 bg-amber-950/40 border border-amber-500/30 rounded-full"
      title={identifier.explanation}
    >
      <XCircle className="w-3 h-3" />
      Format check failed
    </span>
  );
}

/**
 * A promoted key identifier: passport or driver's licence. The value is rendered large
 * because these are the details a reviewer looks up first, and every value is traceable
 * back to the exact source file(s) it was read from.
 */
const KeyIdentifierPanel: React.FC<{ identifier: KeyIdentifier }> = ({ identifier }) => {  return (
    <div className="neon-card rounded-xl p-5">
      <div className="flex items-center justify-between gap-3 mb-2">
        <h3 className="text-[11px] font-mono font-bold uppercase tracking-widest text-slate-300">{identifier.label}</h3>
        <TierBadge identifier={identifier} />
      </div>
      <div className="font-mono font-bold text-2xl sm:text-3xl tracking-wider text-matrix-300 text-glow-green break-all">{identifier.value}</div>
      <div className="text-[10px] font-mono text-slate-500 mt-1">{identifier.explanation}</div>
      {identifier.sources.length > 0 && (
        <div className="mt-3 pt-3 border-t border-white/5">
          <div className="text-[10px] font-mono font-bold uppercase tracking-widest text-slate-500 mb-1.5">
            Source{identifier.sources.length === 1 ? '' : 's'} ({identifier.sourceCount})
          </div>
          <ul className="space-y-1">
            {identifier.sources.map((s) => (
              <li key={s.documentId} className="text-[11px] font-mono">
                <a
                  href={`/api/documents/${s.documentId}/file`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-cyan-300 hover:text-cyan-200 transition-colors hover:underline underline-offset-2"
                  title="Open the exact source file this value came from"
                >
                  <FileText className="w-3 h-3 shrink-0" />
                  <span className="truncate">{s.filename}</span>
                  <ExternalLink className="w-2.5 h-2.5 shrink-0 opacity-70" />
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

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

  const keyIds = identity.keyIdentifiers ?? [];
  const passport = keyIds.filter((k) => k.kind === 'passport');
  const licence = keyIds.filter((k) => k.kind === 'licence');
  const score = identity.creditScore ?? null;

  return (
    <div className="space-y-6">
      <BackButton onBack={onBack} />

      {/* ---- The three real headings: Name, Date of Birth, Credit Score ----
           These are peers, so they are laid out as three equal cells at the same type
           size. DOB previously sat inside the name's block at text-xl and read as a
           sub-item, while credit score was text-4xl and dwarfed both; that hierarchy did
           not match the intent that these three are the only real headings. */}
      <div className="neon-card rounded-xl p-6 relative overflow-hidden">
        <div className="absolute inset-0 crt-scanlines" />
        <div className="relative">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Name */}
            <div className="flex items-start gap-4 min-w-0">
              <FaceThumb url={identity.thumbnailUrl} name={identity.fullName} size={96} rounded={false} className="hidden sm:flex" />
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-matrix-400 mb-2">
                  <User className="w-5 h-5" />
                  <h1 className="text-[10px] font-mono font-bold uppercase tracking-widest text-slate-500">Name</h1>
                </div>
                <div className="glitch-heading text-xl sm:text-2xl font-bold tracking-wide uppercase text-matrix-400 break-words">{identity.fullName}</div>
                <div className="flex flex-wrap items-center gap-3 text-[10px] font-mono text-slate-500 mt-3">
                  <span className="flex items-center gap-1.5">
                    <FileStack className="w-3 h-3 text-matrix-400" />
                    {identity.documentCount} document{identity.documentCount === 1 ? '' : 's'}
                  </span>
                  <span className="flex items-center gap-1.5 text-matrix-400">
                    <CheckCircle2 className="w-3 h-3" />
                    {identity.extractedCount} extracted
                  </span>
                  {identity.pendingCount > 0 && (
                    <span className="flex items-center gap-1.5 text-amber-300">
                      <Clock className="w-3 h-3" />
                      {identity.pendingCount} pending
                    </span>
                  )}
                  {identity.failedCount > 0 && (
                    <span className="flex items-center gap-1.5 text-rose-400">
                      <XCircle className="w-3 h-3" />
                      {identity.failedCount} failed
                    </span>
                  )}
                  {identity.photoCount > 0 && (
                    <a href="#head-photos" className="flex items-center gap-1.5 text-cyan-300 hover:text-cyan-200 transition-colors underline underline-offset-2">
                      <Images className="w-3 h-3" />
                      {identity.photoCount} photo{identity.photoCount === 1 ? '' : 's'}
                    </a>
                  )}
                </div>
              </div>
            </div>

            {/* Date of Birth */}
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase tracking-widest text-slate-500 mb-2">
                <Calendar className="w-3.5 h-3.5 text-cyan-400" />
                Date of Birth
              </div>
              <div className="font-mono font-bold text-xl sm:text-2xl text-cyan-300 break-words">{identity.dob}</div>
            </div>

            {/* Credit Score */}
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase tracking-widest text-slate-500 mb-2">
                Credit Score
              </div>
              {score ? (
                <>
                  <div className="font-mono font-bold text-xl sm:text-2xl text-matrix-300 text-glow-green">{score.value}</div>
                  <a
                    href={`/api/documents/${score.documentId}/file`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 mt-1.5 text-[10px] font-mono text-cyan-300 hover:text-cyan-200 transition-colors hover:underline underline-offset-2 max-w-full"
                    title="Open the credit report this score was read from"
                  >
                    <FileText className="w-3 h-3 shrink-0" />
                    <span className="truncate">{score.filename}</span>
                    <ExternalLink className="w-2.5 h-2.5 shrink-0 opacity-70" />
                  </a>
                </>
              ) : (
                <div className="font-mono text-sm text-slate-600 pt-1">No credit report on file</div>
              )}
            </div>
          </div>

          {/* ---- Key identifiers: large sub-headings under the three real ones ---- */}
          {(passport.length > 0 || licence.length > 0) && (
            <div className="mt-6 pt-5 border-t border-white/5">
              <div className="text-[10px] font-mono font-bold uppercase tracking-widest text-slate-500 mb-3">
                Key Identifiers // trace-sourced &amp; triple-check verified
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {passport.map((k) => (
                  <KeyIdentifierPanel key={`passport-${k.canonical}`} identifier={k} />
                ))}
                {licence.map((k) => (
                  <KeyIdentifierPanel key={`licence-${k.canonical}`} identifier={k} />
                ))}
              </div>
            </div>
          )}

          <div className="mt-5 pt-4 border-t border-white/5 flex justify-end">
            <a
              href={`/api/identities/${identity.identityId}/export.zip`}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-mono font-bold uppercase tracking-wider text-black bg-matrix-500 hover:bg-matrix-400 rounded-lg shadow-[0_0_18px_-4px_rgba(0,255,65,0.7)] transition-colors"
            >
              <Download className="w-4 h-4" />
              Export All (ZIP)
            </a>
          </div>
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

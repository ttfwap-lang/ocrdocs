/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * A small stack of a person's document thumbnails that continuously flips
 * through them — the front card cycles to the back every few seconds so an
 * identity row with many documents still shows all of them over time,
 * instead of only ever showing the first four.
 */

import React, { useEffect, useState } from 'react';
import { FileText, FileImage, FileQuestion } from 'lucide-react';
import type { DocumentPreview } from '../../types';

const MAX_VISIBLE = 4;
const CYCLE_MS = 2600;

const SLOT_TRANSFORM = [
  'translate(-50%, -50%) rotate(0deg) scale(1)',
  'translate(-42%, -54%) rotate(-6deg) scale(0.94)',
  'translate(-58%, -46%) rotate(5deg) scale(0.88)',
  'translate(-50%, -58%) rotate(-3deg) scale(0.82)',
];
const SLOT_Z = [40, 30, 20, 10];
const SLOT_OPACITY = [1, 0.9, 0.75, 0.55];

function extIcon(filename: string) {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  if (ext === 'pdf') return <FileText className="w-6 h-6 text-rose-400" />;
  if (['png', 'jpg', 'jpeg', 'tif', 'tiff', 'bmp', 'webp'].includes(ext)) return <FileImage className="w-6 h-6 text-amber-400" />;
  return <FileQuestion className="w-6 h-6 text-slate-400" />;
}

export const FlipStack: React.FC<{ documents: DocumentPreview[]; size?: number }> = ({ documents, size = 84 }) => {
  const [order, setOrder] = useState<string[]>(documents.map((d) => d.id));

  useEffect(() => {
    setOrder(documents.map((d) => d.id));
  }, [documents]);

  useEffect(() => {
    if (order.length <= 1) return;
    const interval = setInterval(() => {
      setOrder((prev) => (prev.length <= 1 ? prev : [...prev.slice(1), prev[0]]));
    }, CYCLE_MS);
    return () => clearInterval(interval);
  }, [order.length]);

  if (documents.length === 0) {
    return (
      <div
        style={{ width: size, height: size }}
        className="rounded-lg border border-dashed border-matrix-500/20 flex items-center justify-center text-slate-600"
      >
        <FileQuestion className="w-5 h-5" />
      </div>
    );
  }

  const byId = new Map<string, DocumentPreview>(documents.map((d) => [d.id, d]));

  return (
    <div style={{ width: size, height: size }} className="relative shrink-0">
      {order.slice(0, MAX_VISIBLE).map((id, slot) => {
        const doc = byId.get(id);
        if (!doc) return null;
        const isImage = doc.mimeType?.startsWith('image/');
        return (
          <div
            key={id}
            style={{
              width: size * 0.86,
              height: size * 0.86,
              transform: SLOT_TRANSFORM[slot],
              zIndex: SLOT_Z[slot],
              opacity: SLOT_OPACITY[slot],
              transition: 'transform 0.7s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.7s ease',
            }}
            className="absolute top-1/2 left-1/2 rounded-lg overflow-hidden border border-matrix-500/25 bg-black/60 shadow-[0_4px_16px_-4px_rgba(0,0,0,0.7)] flex items-center justify-center"
          >
            {isImage ? (
              <img src={`/api/documents/${doc.id}/file`} alt={doc.filename} className="w-full h-full object-cover" loading="lazy" />
            ) : (
              extIcon(doc.filename)
            )}
          </div>
        );
      })}
      {documents.length > MAX_VISIBLE && (
        <div className="absolute -bottom-1 -right-1 z-50 px-1.5 py-0.5 rounded-full bg-black border border-matrix-500/40 text-[9px] font-mono font-bold text-matrix-300">
          +{documents.length - MAX_VISIBLE}
        </div>
      )}
    </div>
  );
};

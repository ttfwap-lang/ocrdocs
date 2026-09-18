/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Reviewer corrections + approvals against the real `fields` table. Extracted
 * from the old per-document review panel so both a lone unassigned document
 * and a document inside an identity's detail page use the identical, tested
 * interaction: Edit -> type a correction -> Enter/Save, Approve toggles.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { ListChecks, X } from 'lucide-react';
import type { ReviewField } from '../../types';

interface FieldReviewPanelProps {
  extractionId: string;
  onChanged?: () => void;
}

export const FieldReviewPanel: React.FC<FieldReviewPanelProps> = ({ extractionId, onChanged }) => {
  const [fields, setFields] = useState<ReviewField[]>([]);
  const [showEmpty, setShowEmpty] = useState(false);
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [savingFieldId, setSavingFieldId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadFields = useCallback(async () => {
    try {
      const res = await fetch(`/api/extractions/${extractionId}/fields`);
      if (!res.ok) throw new Error(`Failed to load fields (${res.status})`);
      const body = await res.json();
      setFields(body.fields as ReviewField[]);
    } catch (e: any) {
      setError(e?.message || 'Failed to load review fields');
    }
  }, [extractionId]);

  useEffect(() => {
    loadFields();
  }, [loadFields]);

  const saveCorrection = async (field: ReviewField, rawValue: string) => {
    const trimmed = rawValue.trim();
    setSavingFieldId(field.id);
    try {
      const res = await fetch(`/api/fields/${field.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ correctedValue: trimmed === '' ? null : trimmed }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Correction failed (${res.status})`);
      }
      const updated = (await res.json()).field as ReviewField;
      setFields((prev) => prev.map((f) => (f.id === updated.id ? updated : f)));
      setEditingFieldId(null);
      onChanged?.();
    } catch (e: any) {
      setError(e?.message || 'Correction failed');
    } finally {
      setSavingFieldId(null);
    }
  };

  const toggleApproval = async (field: ReviewField) => {
    setSavingFieldId(field.id);
    try {
      const res = await fetch(`/api/fields/${field.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved: field.approved !== 1 }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Approval failed (${res.status})`);
      }
      const updated = (await res.json()).field as ReviewField;
      setFields((prev) => prev.map((f) => (f.id === updated.id ? updated : f)));
      onChanged?.();
    } catch (e: any) {
      setError(e?.message || 'Approval failed');
    } finally {
      setSavingFieldId(null);
    }
  };

  const visibleFields = showEmpty ? fields : fields.filter((f) => f.field_value !== null || f.corrected_value !== null);
  const approvedCount = fields.filter((f) => f.approved === 1).length;

  return (
    <div className="p-2 bg-black/40 rounded-lg border border-amber-500/20">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-mono font-bold text-amber-300 uppercase tracking-widest flex items-center gap-1.5">
          <ListChecks className="w-3.5 h-3.5" />
          Reviewer // {approvedCount} approved
        </span>
        <button
          onClick={() => setShowEmpty((v) => !v)}
          className="text-[10px] font-mono text-slate-400 hover:text-slate-200 underline underline-offset-2"
        >
          {showEmpty ? 'Hide empty' : `Show all ${fields.length}`}
        </button>
      </div>

      {error && <div className="mb-2 p-2 bg-rose-950/30 border border-rose-500/30 rounded text-[11px] font-mono text-rose-300">{error}</div>}

      <div className="space-y-1.5 max-h-96 overflow-y-auto">
        {visibleFields.map((f) => {
          const effective = f.corrected_value ?? f.field_value;
          const isEditing = editingFieldId === f.id;
          const busy = savingFieldId === f.id;
          return (
            <div
              key={f.id}
              className={`p-2 rounded border text-xs ${f.approved === 1 ? 'bg-matrix-950/30 border-matrix-500/40' : 'bg-black/40 border-white/5'}`}
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-slate-500 truncate font-mono text-[10px]">{f.field_name}</span>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    disabled={busy}
                    onClick={() => {
                      setEditingFieldId(f.id);
                      setEditingValue(effective ?? '');
                    }}
                    className="px-1.5 py-0.5 text-[10px] font-mono text-cyan-300 border border-cyan-500/30 rounded hover:bg-cyan-950/40 disabled:opacity-40"
                  >
                    Edit
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => toggleApproval(f)}
                    className={`px-1.5 py-0.5 text-[10px] font-mono rounded border disabled:opacity-40 ${
                      f.approved === 1
                        ? 'text-matrix-300 border-matrix-500/40 hover:bg-matrix-950/40'
                        : 'text-slate-300 border-slate-600/50 hover:bg-slate-800/40'
                    }`}
                  >
                    {f.approved === 1 ? 'Approved' : 'Approve'}
                  </button>
                </div>
              </div>

              {isEditing ? (
                <div className="flex items-center gap-1">
                  <input
                    autoFocus
                    value={editingValue}
                    onChange={(e) => setEditingValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveCorrection(f, editingValue);
                      if (e.key === 'Escape') setEditingFieldId(null);
                    }}
                    className="flex-1 min-w-0 px-1.5 py-1 bg-black/70 border border-cyan-500/40 rounded font-mono text-[11px] text-matrix-200 focus:outline-none focus:border-cyan-400"
                    placeholder="Corrected value (blank clears)"
                  />
                  <button
                    disabled={busy}
                    onClick={() => saveCorrection(f, editingValue)}
                    className="px-1.5 py-1 text-[10px] font-mono text-black bg-matrix-500 hover:bg-matrix-400 rounded disabled:opacity-40"
                  >
                    {busy ? '...' : 'Save'}
                  </button>
                  <button
                    onClick={() => setEditingFieldId(null)}
                    className="px-1.5 py-1 text-[10px] font-mono text-slate-400 hover:text-slate-200"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ) : (
                <div className="font-mono">
                  {f.corrected_value !== null ? (
                    <div className="flex flex-col gap-0.5">
                      <span className="text-amber-300 truncate">{f.corrected_value}</span>
                      <span className="text-[10px] text-slate-600 line-through truncate">was: {f.field_value ?? '(empty)'}</span>
                    </div>
                  ) : (
                    <span className={f.field_value ? 'text-matrix-300' : 'text-slate-600 italic'}>{f.field_value ?? '(empty)'}</span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

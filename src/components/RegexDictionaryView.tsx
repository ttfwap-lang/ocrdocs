/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Search, Copy, Check } from 'lucide-react';
import { BANK_FIELD_DEFINITIONS, CORE_IDENTIFIER_DEFINITIONS } from '../data/bankFields';
import { FieldCategory } from '../types';

export const RegexDictionaryView: React.FC = () => {
  const [search, setSearch] = useState<string>('');
  const [selectedCat, setSelectedCat] = useState<FieldCategory | 'all'>('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const allFields = [...BANK_FIELD_DEFINITIONS, ...CORE_IDENTIFIER_DEFINITIONS];

  const filtered = allFields.filter((f) => {
    const matchCat = selectedCat === 'all' || f.category === selectedCat;
    const matchText =
      search === '' ||
      f.name.toLowerCase().includes(search.toLowerCase()) ||
      f.label.toLowerCase().includes(search.toLowerCase()) ||
      f.maxToleranceRegex.toLowerCase().includes(search.toLowerCase()) ||
      f.description.toLowerCase().includes(search.toLowerCase());
    return matchCat && matchText;
  });

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1800);
  };

  const categories = [
    { id: 'all', label: 'ALL FIELDS' },
    { id: 'identity', label: 'IDENTITY (1-8, 15-16)' },
    { id: 'income', label: 'INCOME (21-23)' },
    { id: 'assets_liabilities', label: 'LIABILITIES (26-28)' },
    { id: 'facility', label: 'FACILITY (29-30, BSB)' },
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="neon-card p-6">
        <h1 className="glitch-heading text-2xl uppercase mb-2">
          Regex Intelligence Database
        </h1>
        <p className="text-xs font-mono text-slate-500 uppercase tracking-widest max-w-4xl">
          Classified mapping signatures optimized for maximum recall across OCR noise and documentation anomalies.
        </p>
      </div>

      {/* Filter Bar */}
      <div className="bg-[#0a0a0a] border border-slate-800 p-3 flex flex-col sm:flex-row items-center gap-4">
        <div className="relative flex-1 w-full">
          <Search className="w-4 h-4 text-slate-600 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="SEARCH REGEX DEFINITIONS..."
            className="w-full pl-10 pr-4 py-2 text-xs font-mono uppercase tracking-widest bg-black border border-slate-800 text-white focus:outline-none focus:border-cyan-500 transition-colors"
          />
        </div>

        <div className="flex items-center gap-2 overflow-x-auto w-full sm:w-auto">
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setSelectedCat(cat.id as any)}
              className={`px-4 py-2 text-[10px] font-mono uppercase tracking-widest whitespace-nowrap border transition-all ${
                selectedCat === cat.id
                  ? 'bg-matrix-900/40 text-matrix-400 border-matrix-500/50'
                  : 'bg-black text-slate-500 border-slate-800 hover:border-matrix-500/30'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {filtered.map((field) => (
          <div key={field.id} className="neon-card flex flex-col group hover:border-matrix-500/40 transition-colors">
            <div className="p-3 border-b border-slate-800 flex items-start justify-between bg-black">
              <div className="flex items-center gap-3">
                <span className="w-6 h-6 border border-slate-700 text-slate-400 text-[10px] font-mono flex items-center justify-center bg-[#111]">
                  {field.number}
                </span>
                <h3 className="font-mono font-bold text-white uppercase text-sm tracking-wide">
                  {field.name}
                </h3>
              </div>
              <span className="text-[9px] font-mono font-bold text-slate-500 uppercase tracking-widest px-2 py-0.5 border border-slate-800 bg-slate-900">
                {field.category}
              </span>
            </div>

            <div className="p-4 flex-1 flex flex-col gap-4">
              <div className="flex items-center justify-between text-[10px] font-mono">
                <span className="text-slate-600 uppercase tracking-widest">Internal DB Key:</span>
                <code className="text-cyan-500">{field.label}</code>
              </div>

              <div className="bg-black border border-slate-800 p-3 relative group/regex">
                <span className="text-[9px] text-slate-600 font-mono uppercase tracking-widest absolute -top-2 left-2 bg-[#0a0a0a] px-1">Compiled Regex</span>
                <code className="text-amber-500/90 font-mono text-xs block break-all pt-2 selection:bg-amber-900 selection:text-white">
                  {field.maxToleranceRegex}
                </code>
                <button
                  onClick={() => handleCopy(field.maxToleranceRegex, `raw-${field.id}`)}
                  className="absolute right-2 top-2 p-1.5 text-slate-600 hover:text-cyan-400 transition-colors"
                >
                  {copiedId === `raw-${field.id}` ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>

              <p className="text-xs text-slate-400 font-sans leading-relaxed">
                {field.description}
              </p>
            </div>

            <div className="p-3 bg-black border-t border-slate-800 flex justify-between items-center text-[10px] font-mono uppercase tracking-widest">
              <div className="flex gap-2">
                <span className="text-slate-600">Sample:</span>
                <span className="text-slate-300 truncate max-w-[150px]">{field.sampleExtractedValue}</span>
              </div>
              <span className="text-emerald-700 font-bold">TYPE: {field.targetDataType}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

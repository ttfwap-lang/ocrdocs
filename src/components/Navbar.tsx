/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Sparkles, Terminal, FileCode2, Search, Fingerprint, FolderOpen } from 'lucide-react';

export type NavTab = 'studio' | 'documents' | 'audit' | 'regex' | 'copilot';

interface NavbarProps {
  activeTab: NavTab;
  setActiveTab: (tab: NavTab) => void;
  matchCount: number;
  totalFields: number;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  matchCount,
  totalFields,
}) => {
  return (
    <header className="border-b border-matrix-500/20 bg-black/80 backdrop-blur-sm sticky top-0 z-30">
      <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14">

          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center text-matrix-400 text-glow-green">
              <Fingerprint className="w-6 h-6" />
            </div>
            <div className="flex flex-col justify-center">
              <div className="flex items-center gap-2">
                <span className="glitch-heading font-bold text-matrix-400 text-xs sm:text-sm">
                  OCRD // OCR
                </span>
                <span className="bg-matrix-900/60 text-matrix-400 border border-matrix-500/40 text-[10px] font-mono tracking-wider px-2 py-0.5 uppercase hidden sm:inline">
                  DGX Cluster
                </span>
              </div>
            </div>
          </div>

          <nav className="flex items-center h-full overflow-x-auto">
            <button
              onClick={() => setActiveTab('studio')}
              className={`flex items-center gap-1.5 h-full px-3.5 sm:px-4 text-[11px] font-mono uppercase tracking-wider transition-all border-l border-matrix-500/15 shrink-0 ${
                activeTab === 'studio'
                  ? 'bg-white/5 text-cyan-300 text-glow-cyan border-b-2 border-b-cyan-400'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
              }`}
            >
              <Search className="w-3.5 h-3.5" />
              <span>Extraction Grid</span>
            </button>

            <button
              onClick={() => setActiveTab('documents')}
              className={`flex items-center gap-1.5 h-full px-3.5 sm:px-4 text-[11px] font-mono uppercase tracking-wider transition-all border-l border-matrix-500/15 shrink-0 ${
                activeTab === 'documents'
                  ? 'bg-white/5 text-matrix-400 text-glow-green border-b-2 border-b-matrix-500'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
              }`}
            >
              <FolderOpen className="w-3.5 h-3.5" />
              <span>Documents</span>
            </button>

            <button
              onClick={() => setActiveTab('audit')}
              className={`flex items-center gap-1.5 h-full px-3.5 sm:px-4 text-[11px] font-mono uppercase tracking-wider transition-all border-l border-matrix-500/15 shrink-0 ${
                activeTab === 'audit'
                  ? 'bg-white/5 text-cyan-300 text-glow-cyan border-b-2 border-b-cyan-400'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
              }`}
            >
              <Terminal className="w-3.5 h-3.5" />
              <span>Scripts & Audit</span>
            </button>

            <button
              onClick={() => setActiveTab('regex')}
              className={`flex items-center gap-1.5 h-full px-3.5 sm:px-4 text-[11px] font-mono uppercase tracking-wider transition-all border-l border-matrix-500/15 shrink-0 ${
                activeTab === 'regex'
                  ? 'bg-white/5 text-cyan-300 text-glow-cyan border-b-2 border-b-cyan-400'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
              }`}
            >
              <FileCode2 className="w-3.5 h-3.5" />
              <span>Pattern DB</span>
            </button>

            <button
              onClick={() => setActiveTab('copilot')}
              className={`flex items-center gap-1.5 h-full px-3.5 sm:px-4 text-[11px] font-mono uppercase tracking-wider transition-all border-l border-r border-matrix-500/15 shrink-0 ${
                activeTab === 'copilot'
                  ? 'bg-white/5 text-fuchsia-300 border-b-2 border-b-fuchsia-500'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Copilot</span>
            </button>
          </nav>
        </div>
      </div>
    </header>
  );
};

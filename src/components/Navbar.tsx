/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Cpu, CheckCircle2, ShieldAlert, Sparkles, Terminal, FileCode2, Search, Fingerprint, Layers, FolderDown, PlayCircle } from 'lucide-react';

export type NavTab = 'studio' | 'gdrive' | 'multipass' | 'audit' | 'superstack' | 'regex' | 'copilot';

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
    <header className="border-b border-slate-800 bg-[#0a0a0a] sticky top-0 z-30">
      <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14">
          
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center text-cyan-400">
              <Fingerprint className="w-6 h-6" />
            </div>
            <div className="flex flex-col justify-center">
              <div className="flex items-center gap-2">
                <span className="font-mono font-bold text-white tracking-wider text-xs sm:text-sm">
                  NGX_SPARK // OCR
                </span>
                <span className="bg-emerald-950/60 text-emerald-400 border border-emerald-800 text-[10px] font-mono tracking-wider px-2 py-0.5 uppercase hidden sm:inline">
                  Drive & Cluster
                </span>
              </div>
            </div>
          </div>

          <nav className="flex items-center h-full overflow-x-auto">
            <button
              onClick={() => setActiveTab('studio')}
              className={`flex items-center gap-1.5 h-full px-3.5 sm:px-4 text-[11px] font-mono uppercase tracking-wider transition-all border-l border-slate-800 shrink-0 ${
                activeTab === 'studio'
                  ? 'bg-[#111111] text-cyan-400 border-b-2 border-b-cyan-500'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-[#111111]'
              }`}
            >
              <Search className="w-3.5 h-3.5" />
              <span>Extraction Grid</span>
            </button>

            <button
              onClick={() => setActiveTab('gdrive')}
              className={`flex items-center gap-1.5 h-full px-3.5 sm:px-4 text-[11px] font-mono uppercase tracking-wider transition-all border-l border-slate-800 shrink-0 ${
                activeTab === 'gdrive'
                  ? 'bg-[#111111] text-emerald-400 border-b-2 border-b-emerald-500'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-[#111111]'
              }`}
            >
              <FolderDown className="w-3.5 h-3.5 text-emerald-400" />
              <span>Google Drive Hub</span>
            </button>

            <button
              onClick={() => setActiveTab('multipass')}
              className={`flex items-center gap-1.5 h-full px-3.5 sm:px-4 text-[11px] font-mono uppercase tracking-wider transition-all border-l border-slate-800 shrink-0 ${
                activeTab === 'multipass'
                  ? 'bg-[#111111] text-blue-400 border-b-2 border-b-blue-500'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-[#111111]'
              }`}
            >
              <PlayCircle className="w-3.5 h-3.5 text-blue-400" />
              <span>10-Pass Loop</span>
            </button>

            <button
              onClick={() => setActiveTab('audit')}
              className={`flex items-center gap-1.5 h-full px-3.5 sm:px-4 text-[11px] font-mono uppercase tracking-wider transition-all border-l border-slate-800 shrink-0 ${
                activeTab === 'audit'
                  ? 'bg-[#111111] text-cyan-400 border-b-2 border-b-cyan-500'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-[#111111]'
              }`}
            >
              <Terminal className="w-3.5 h-3.5" />
              <span>Scripts & Audit</span>
            </button>

            <button
              onClick={() => setActiveTab('superstack')}
              className={`flex items-center gap-1.5 h-full px-3.5 sm:px-4 text-[11px] font-mono uppercase tracking-wider transition-all border-l border-slate-800 shrink-0 relative ${
                activeTab === 'superstack'
                  ? 'bg-[#111111] text-cyan-400 border-b-2 border-b-cyan-500'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-[#111111]'
              }`}
            >
              <Cpu className="w-3.5 h-3.5 text-cyan-400" />
              <span>C++ & NGX</span>
            </button>

            <button
              onClick={() => setActiveTab('regex')}
              className={`flex items-center gap-1.5 h-full px-3.5 sm:px-4 text-[11px] font-mono uppercase tracking-wider transition-all border-l border-slate-800 shrink-0 ${
                activeTab === 'regex'
                  ? 'bg-[#111111] text-cyan-400 border-b-2 border-b-cyan-500'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-[#111111]'
              }`}
            >
              <FileCode2 className="w-3.5 h-3.5" />
              <span>Pattern DB</span>
            </button>

            <button
              onClick={() => setActiveTab('copilot')}
              className={`flex items-center gap-1.5 h-full px-3.5 sm:px-4 text-[11px] font-mono uppercase tracking-wider transition-all border-l border-r border-slate-800 shrink-0 ${
                activeTab === 'copilot'
                  ? 'bg-[#111111] text-amber-400 border-b-2 border-b-amber-500'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-[#111111]'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span>Copilot</span>
            </button>
          </nav>
        </div>
      </div>
    </header>
  );
};

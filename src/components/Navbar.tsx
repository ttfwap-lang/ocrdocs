/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Sparkles, Fingerprint, Users } from 'lucide-react';

export type NavTab = 'identities' | 'copilot';

interface NavbarProps {
  activeTab: NavTab;
  setActiveTab: (tab: NavTab) => void;
}

export const Navbar: React.FC<NavbarProps> = ({ activeTab, setActiveTab }) => {
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
              onClick={() => setActiveTab('identities')}
              className={`flex items-center gap-1.5 h-full px-4 sm:px-5 text-[11px] font-mono uppercase tracking-wider transition-all border-l border-matrix-500/15 shrink-0 ${
                activeTab === 'identities'
                  ? 'bg-white/5 text-matrix-400 text-glow-green border-b-2 border-b-matrix-500'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>Identities</span>
            </button>

            <button
              onClick={() => setActiveTab('copilot')}
              className={`flex items-center gap-1.5 h-full px-4 sm:px-5 text-[11px] font-mono uppercase tracking-wider transition-all border-l border-r border-matrix-500/15 shrink-0 ${
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

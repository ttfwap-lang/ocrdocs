/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { Navbar, NavTab } from './components/Navbar';
import { MatcherStudio } from './components/MatcherStudio';
import { GoogleDriveHub } from './components/GoogleDriveHub';
import { MultiPassRegressionView } from './components/MultiPassRegressionView';
import { AuditAndEngineView } from './components/AuditAndEngineView';
import { SuperStackResearchView } from './components/SuperStackResearchView';
import { RegexDictionaryView } from './components/RegexDictionaryView';
import { GeminiChatbot } from './components/GeminiChatbot';
import { SAMPLE_DOCUMENTS } from './data/sampleDocuments';
import { extractBankFieldsFromText } from './utils/ocrMatcherEngine';
import { BANK_FIELD_DEFINITIONS, CORE_IDENTIFIER_DEFINITIONS } from './data/bankFields';
import { Cpu, HardDrive, ShieldCheck, Activity, FolderDown, Layers } from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('multipass');
  const [selectedExternalDoc, setSelectedExternalDoc] = useState<{
    id: string;
    title: string;
    institution: string;
    docType: string;
    rawText: string;
  } | null>(null);

  // Client-side execution (highly optimized and memoized)
  const initialResults = useMemo(() => {
    return extractBankFieldsFromText(SAMPLE_DOCUMENTS[0].rawText);
  }, []);

  const matchCount = useMemo(() => {
    return initialResults.filter((r) => r.status === 'matched').length;
  }, [initialResults]);

  const handleSelectDocFromDrive = (doc: {
    id: string;
    title: string;
    institution: string;
    docType: string;
    rawText: string;
  }) => {
    setSelectedExternalDoc(doc);
    setActiveTab('studio');
  };

  return (
    <div className="min-h-screen bg-[#050505] text-slate-300 flex flex-col font-sans selection:bg-cyan-900 selection:text-cyan-50">
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        matchCount={matchCount}
        totalFields={BANK_FIELD_DEFINITIONS.length + CORE_IDENTIFIER_DEFINITIONS.length}
      />

      {/* Cluster & Telemetry Bar */}
      <div className="bg-[#0a0a0a] border-b border-slate-800 py-1.5 px-4 text-[10px] font-mono tracking-widest text-slate-500 uppercase">
        <div className="max-w-screen-2xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-4 flex-wrap">
            <span className="flex items-center gap-1.5 text-emerald-500 font-bold">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              CLUSTER.ONLINE
            </span>
            <span className="text-slate-800 hidden sm:inline">|</span>
            <span className="flex items-center gap-1 text-slate-400">
              <HardDrive className="w-3 h-3 text-cyan-500" />
              <span>GDRIVE: 16q3PdioHVbLIBVqU--54nBvNhqLE7bNN</span>
            </span>
            <span className="text-slate-800 hidden sm:inline">|</span>
            <span className="flex items-center gap-1 text-slate-400">
              <ShieldCheck className="w-3 h-3 text-emerald-500" />
              <span>REGRESSION LOOP: 10-PASS EARLY-STOP ACTIVE</span>
            </span>
          </div>

          <div className="flex items-center gap-2 text-cyan-700 font-bold">
            <span>NVME PATH: /mnt/nvme/ocr_pipeline</span>
          </div>
        </div>
      </div>

      <main className="flex-1 max-w-screen-2xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {activeTab === 'multipass' && <MultiPassRegressionView />}
        {activeTab === 'gdrive' && (
          <GoogleDriveHub
            onSelectDocumentForOcr={handleSelectDocFromDrive}
            onNavigateToMultiPass={() => setActiveTab('multipass')}
          />
        )}
        {activeTab === 'studio' && (
          <MatcherStudio
            initialDocument={selectedExternalDoc}
            onNavigateToMultiPass={() => setActiveTab('multipass')}
          />
        )}
        {activeTab === 'audit' && <AuditAndEngineView />}
        {activeTab === 'superstack' && <SuperStackResearchView />}
        {activeTab === 'regex' && <RegexDictionaryView />}
        {activeTab === 'copilot' && <GeminiChatbot />}
      </main>
    </div>
  );
}

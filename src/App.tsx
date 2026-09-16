/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect } from 'react';
import { Navbar, NavTab } from './components/Navbar';
import { MatcherStudio } from './components/MatcherStudio';
import { DocumentsView } from './components/DocumentsView';
import { AuditAndEngineView } from './components/AuditAndEngineView';
import { RegexDictionaryView } from './components/RegexDictionaryView';
import { GeminiChatbot } from './components/GeminiChatbot';
import { SAMPLE_DOCUMENTS } from './data/sampleDocuments';
import { extractBankFieldsFromText } from './utils/ocrMatcherEngine';
import { BANK_FIELD_DEFINITIONS, CORE_IDENTIFIER_DEFINITIONS } from './data/bankFields';
import type { ServiceAvailabilityResponse } from './types';

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('documents');
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

  const [statusBar, setStatusBar] = useState({
    dgxWorkerAvailable: false,
    documentCount: 0,
  });

  useEffect(() => {
    let cancelled = false;

    const fetchStatusBarData = async () => {
      const [servicesResponse, documentsResponse] = await Promise.all([
        fetch('/api/services/status'),
        fetch('/api/documents'),
      ]);
      const services = (await servicesResponse.json()) as ServiceAvailabilityResponse[];
      const documents = (await documentsResponse.json()) as unknown[];
      const dgxWorker = services.find((service) => service.service === 'dgx_worker');

      if (!cancelled) {
        setStatusBar({
          dgxWorkerAvailable: Boolean(dgxWorker?.available),
          documentCount: Array.isArray(documents) ? documents.length : 0,
        });
      }
    };

    fetchStatusBarData().catch((error) => {
      console.error('Failed to fetch application status:', error);
    });
    const interval = window.setInterval(() => {
      fetchStatusBarData().catch((error) => {
        console.error('Failed to refresh application status:', error);
      });
    }, 60_000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  const handleSelectDocument = (doc: {
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

      {/* Live Status Bar */}
      <div className="bg-[#0a0a0a] border-b border-slate-800 py-1.5 px-4 text-[10px] font-mono tracking-widest text-slate-500 uppercase">
        <div className="max-w-screen-2xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-4 flex-wrap">
            <span className={`flex items-center gap-1.5 font-bold ${statusBar.dgxWorkerAvailable ? 'text-emerald-500' : 'text-amber-500'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${statusBar.dgxWorkerAvailable ? 'bg-emerald-500' : 'bg-amber-500'}`} />
              DGX WORKER: {statusBar.dgxWorkerAvailable ? 'LIVE' : 'UNCONFIGURED'}
            </span>
          </div>

          <div className="flex items-center gap-2 text-cyan-700 font-bold">
            <span>{statusBar.documentCount} DOCUMENTS</span>
          </div>
        </div>
      </div>

      <main className="flex-1 max-w-screen-2xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {activeTab === 'documents' && <DocumentsView onSelectDocumentForOcr={handleSelectDocument} />}
        {activeTab === 'studio' && (
          <MatcherStudio
            initialDocument={selectedExternalDoc}
            onNavigateToDocuments={() => setActiveTab('documents')}
          />
        )}
        {activeTab === 'audit' && <AuditAndEngineView />}
        {activeTab === 'regex' && <RegexDictionaryView />}
        {activeTab === 'copilot' && <GeminiChatbot />}
      </main>
    </div>
  );
}

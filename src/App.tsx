/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { Navbar, NavTab } from './components/Navbar';
import { IdentitiesView } from './components/IdentitiesView';
import { MedicareView } from './components/MedicareView';
import { GeminiChatbot } from './components/GeminiChatbot';
import { MatrixRain } from './components/MatrixRain';
import { ErrorBoundary } from './components/ErrorBoundary';
import type { DocumentCountResponse, ServiceAvailabilityResponse } from './types';

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('identities');

  const [statusBar, setStatusBar] = useState({
    dgxWorkerAvailable: false,
    documentCount: 0,
  });
  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusLoaded, setStatusLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const fetchStatusBarData = async () => {
      const [servicesResponse, documentsResponse] = await Promise.all([
        fetch('/api/services/status'),
        fetch('/api/documents/count'),
      ]);
      if (!servicesResponse.ok || !documentsResponse.ok) {
        throw new Error(`status request failed (${servicesResponse.status}/${documentsResponse.status})`);
      }
      const services = (await servicesResponse.json()) as ServiceAvailabilityResponse[];
      const documents = (await documentsResponse.json()) as DocumentCountResponse;
      const dgxWorker = services.find((service) => service.service === 'dgx_worker');

      if (!cancelled) {
        setStatusBar({
          dgxWorkerAvailable: Boolean(dgxWorker?.available),
          documentCount: typeof documents.count === 'number' ? documents.count : 0,
        });
        setStatusError(null);
        setStatusLoaded(true);
      }
    };

    fetchStatusBarData().catch((error) => {
      console.error('Failed to fetch application status:', error);
      if (!cancelled) setStatusError(error instanceof Error ? error.message : 'Status unavailable');
    });
    const interval = window.setInterval(() => {
      fetchStatusBarData().catch((error) => {
        console.error('Failed to refresh application status:', error);
        if (!cancelled) setStatusError(error instanceof Error ? error.message : 'Status unavailable');
      });
    }, 60_000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  return (
    <div className="min-h-screen bg-void text-slate-300 flex flex-col font-mono selection:bg-matrix-500 selection:text-black relative">
      <MatrixRain />
      <div className="relative z-10 flex flex-col min-h-screen">
        <Navbar activeTab={activeTab} setActiveTab={setActiveTab} />

        {/* Live Status Bar */}
        <div className="bg-black/70 backdrop-blur-sm border-b border-matrix-500/15 py-1.5 px-4 text-[10px] font-mono tracking-widest uppercase">
          <div className="max-w-screen-2xl mx-auto flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-4 flex-wrap">
              <span className={`flex items-center gap-1.5 font-bold ${!statusLoaded ? 'text-slate-400' : statusBar.dgxWorkerAvailable ? 'text-matrix-400 text-glow-green' : 'text-amber-400'}`}>
                <span className={`w-1.5 h-1.5 rounded-full glow-pulse ${!statusLoaded ? 'bg-slate-500' : statusBar.dgxWorkerAvailable ? 'bg-matrix-500' : 'bg-amber-400'}`} />
                DGX WORKER: {!statusLoaded ? 'CHECKING' : statusBar.dgxWorkerAvailable ? 'LIVE' : 'UNCONFIGURED'}
              </span>
            </div>

            <div className="flex items-center gap-3 text-cyan-400 font-bold text-glow-cyan">
              <span>{statusLoaded ? `${statusBar.documentCount} DOCUMENTS` : 'STATUS CHECK…'}</span>
               {statusError && (
                 <span className="text-rose-300 normal-case tracking-normal" title={statusError}>
                   status unavailable
                 </span>
               )}
            </div>
          </div>
        </div>

        <main className="flex-1 max-w-screen-2xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <ErrorBoundary resetKey={activeTab}>
            {activeTab === 'identities' && <IdentitiesView />}
            {activeTab === 'medicare' && <MedicareView />}
            {activeTab === 'copilot' && <GeminiChatbot />}
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}

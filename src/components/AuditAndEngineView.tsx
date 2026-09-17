/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  Download,
  Copy,
  Check,
  ShieldAlert,
  ShieldCheck,
  RefreshCw,
  Server
} from 'lucide-react';
import { AUDIT_SECTIONS, SPARK_SUBMIT_COMMAND } from '../data/scriptComparison';
import { DGX_SETUP_SH, OCR_SPARK_ENGINE_PY, DEPLOY_SH, CHECK_DGX_CODEBASE_SH } from '../data/dgxScripts';


export const AuditAndEngineView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'script1' | 'script2' | 'script3' | 'script4' | 'submit'>('script4');
  const [copied, setCopied] = useState<boolean>(false);
  const [telemetry, setTelemetry] = useState<any>(null);
  const [telemetryLoading, setTelemetryLoading] = useState<boolean>(false);

  const fetchTelemetry = async () => {
    setTelemetryLoading(true);
    try {
      const res = await fetch('/api/dgx/telemetry-report');
      const data = await res.json();
      if (data && data.hasReport) {
        setTelemetry(data.latest);
      }
    } catch (e) {
      console.error('Failed to fetch DGX telemetry:', e);
    } finally {
      setTelemetryLoading(false);
    }
  };

  useEffect(() => {
    fetchTelemetry();
    const interval = setInterval(fetchTelemetry, 10000);
    return () => clearInterval(interval);
  }, []);

  const getActiveCode = () => {
    switch (activeTab) {
      case 'script1':
        return DGX_SETUP_SH;
      case 'script2':
        return OCR_SPARK_ENGINE_PY;
      case 'script3':
        return DEPLOY_SH;
      case 'script4':
        return CHECK_DGX_CODEBASE_SH;
      case 'submit':
        return SPARK_SUBMIT_COMMAND;
    }
  };

  const getDownloadFilename = () => {
    switch (activeTab) {
      case 'script1':
        return 'dgx_setup.sh';
      case 'script2':
        return 'ocr_spark_engine.py';
      case 'script3':
        return 'deploy.sh';
      case 'script4':
        return 'check_dgx_codebase.sh';
      case 'submit':
        return 'spark_submit.sh';
    }
  };

  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadActiveScript = () => {
    const filename = getDownloadFilename();
    const blob = new Blob([getActiveCode()], { type: 'text/plain' });
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="p-6 neon-card rounded-xl">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="px-2 py-0.5 text-[10px] font-mono font-bold uppercase tracking-widest bg-cyan-950/40 text-cyan-300 border border-cyan-500/30 rounded">
                Production DGX & NVMe Codebase
              </span>
              <span className="px-2 py-0.5 text-[10px] font-mono font-bold uppercase tracking-widest bg-matrix-900/40 text-matrix-400 border border-matrix-500/30 rounded flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5" />
                Audited & Hardened
              </span>
            </div>
            <h1 className="glitch-heading text-2xl uppercase">
              3 Production Engine Scripts & Architecture Audit
            </h1>
            <p className="text-sm text-slate-400 mt-1 max-w-3xl font-mono">
              Equipped with local document/folder ingestion, 10-pass progressive optimization with regression verification, and zero-loss monotonic field invariants.
            </p>
            <div className="mt-2 text-xs bg-amber-950/30 border border-amber-500/30 text-amber-300 rounded-md p-2 flex items-center gap-2 font-mono">
              <span className="font-bold">⚠️ DGX Transfer Note:</span>
              <span>The preview URL enforces session authentication. To transfer scripts to DGX, click <strong>Download</strong> and transfer via <code className="font-mono bg-black/50 px-1 py-0.5 rounded border border-amber-900/40">scp</code>, or copy and paste the code directly in your terminal.</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <a
              href={`/api/scripts/${getDownloadFilename()}`}
              download
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-mono font-bold uppercase tracking-wider text-black bg-matrix-500 hover:bg-matrix-400 rounded-lg shadow-[0_0_18px_-4px_rgba(0,255,65,0.7)] transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              Download {getDownloadFilename()}
            </a>
          </div>
        </div>

        {/* Quick Access Links to All 4 Scripts */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-5 pt-5 border-t border-matrix-500/15">
          <div
            onClick={() => setActiveTab('script4')}
            className={`p-3 rounded-lg border cursor-pointer transition-all ${
              activeTab === 'script4'
                ? 'bg-cyan-950/30 border-cyan-500/50 ring-1 ring-cyan-500/40'
                : 'bg-matrix-900/10 border-matrix-500/20 hover:bg-matrix-900/20'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono font-bold text-slate-200">Script 4: check_dgx_codebase.sh</span>
              <span className="text-[10px] px-1.5 py-0.5 bg-matrix-900/50 text-matrix-400 rounded font-mono font-semibold border border-matrix-500/30">New E2E</span>
            </div>
            <p className="text-[11px] text-slate-500 mt-1 font-mono">
              Deep scans DGX NVMe codebase, Python venv, CUDA, and uplinks full audit back to UI.
            </p>
          </div>

          <div
            onClick={() => setActiveTab('script1')}
            className={`p-3 rounded-lg border cursor-pointer transition-all ${
              activeTab === 'script1'
                ? 'bg-cyan-950/30 border-cyan-500/50 ring-1 ring-cyan-500/40'
                : 'bg-black/30 border-white/10 hover:border-matrix-500/30'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono font-bold text-slate-200">Script 1: dgx_setup.sh</span>
              <span className="text-[10px] px-1.5 py-0.5 bg-slate-800 text-slate-300 rounded font-mono">Bash</span>
            </div>
            <p className="text-[11px] text-slate-500 mt-1 font-mono">
              ARM64/x86 DGX provisioner, pinned dependencies, CUDA 12.4, PaddleOCR, EasyOCR, and DuckDB WAL.
            </p>
          </div>

          <div
            onClick={() => setActiveTab('script2')}
            className={`p-3 rounded-lg border cursor-pointer transition-all ${
              activeTab === 'script2'
                ? 'bg-cyan-950/30 border-cyan-500/50 ring-1 ring-cyan-500/40'
                : 'bg-black/30 border-white/10 hover:border-matrix-500/30'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono font-bold text-slate-200">Script 2: ocr_spark_engine.py</span>
              <span className="text-[10px] px-1.5 py-0.5 bg-cyan-950/50 text-cyan-300 rounded font-mono border border-cyan-500/30">Python 3</span>
            </div>
            <p className="text-[11px] text-slate-500 mt-1 font-mono">
              10-pass progressive loop, 30 Australian banking fields, regression verification, early stop.
            </p>
          </div>

          <div
            onClick={() => setActiveTab('script3')}
            className={`p-3 rounded-lg border cursor-pointer transition-all ${
              activeTab === 'script3'
                ? 'bg-cyan-950/30 border-cyan-500/50 ring-1 ring-cyan-500/40'
                : 'bg-black/30 border-white/10 hover:border-matrix-500/30'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono font-bold text-slate-200">Script 3: deploy.sh</span>
              <span className="text-[10px] px-1.5 py-0.5 bg-slate-800 text-slate-300 rounded font-mono">Bash</span>
            </div>
            <p className="text-[11px] text-slate-500 mt-1 font-mono">
              Local-to-DGX orchestrator: authenticated engine sync, 10-pass regression loop controller.
            </p>
          </div>
        </div>
      </div>

      {/* Live DGX Telemetry Report Card */}
      <div className="p-5 neon-card rounded-xl">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 border-b border-matrix-500/15">
          <div className="flex items-center gap-2">
            <Server className="w-5 h-5 text-cyan-400" />
            <div>
              <h2 className="text-sm font-mono font-bold text-slate-200">Remote DGX Codebase & Hardware Audit Feed</h2>
              <p className="text-xs text-slate-500 font-mono">Live telemetric reports transmitted from <code className="text-xs font-mono bg-black/50 px-1 py-0.5 rounded border border-white/10">check_dgx_codebase.sh</code></p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                const pasted = prompt("Paste your local JSON audit report (from /mnt/nvme/ocr_pipeline/logs/e2e_codebase_audit.json):");
                if (pasted) {
                  try {
                    const parsed = JSON.parse(pasted);
                    fetch('/api/dgx/telemetry-report', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(parsed)
                    }).then(() => fetchTelemetry());
                  } catch (e: any) {
                    alert("Invalid JSON format: " + e.message);
                  }
                }
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-medium text-slate-300 bg-black/40 hover:bg-white/5 border border-white/10 rounded-lg transition-colors"
            >
              <span>Paste Report JSON</span>
            </button>
            <button
              onClick={fetchTelemetry}
              disabled={telemetryLoading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-medium text-slate-300 bg-black/40 hover:bg-white/5 border border-white/10 rounded-lg transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${telemetryLoading ? 'animate-spin text-cyan-400' : ''}`} />
              <span>Refresh Status</span>
            </button>
          </div>
        </div>

        {telemetry ? (
          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 bg-black/40 border border-white/10 rounded-lg">
                <span className="text-[11px] text-slate-500 block font-mono">Host & User</span>
                <span className="text-xs font-bold text-slate-200 font-mono">{telemetry.currentUser}@{telemetry.hostname}</span>
              </div>
              <div className="p-3 bg-black/40 border border-white/10 rounded-lg">
                <span className="text-[11px] text-slate-500 block font-mono">Architecture</span>
                <span className="text-xs font-bold text-slate-200 font-mono">{telemetry.architecture} ({telemetry.kernel})</span>
              </div>
              <div className="p-3 bg-black/40 border border-white/10 rounded-lg">
                <span className="text-[11px] text-slate-500 block font-mono">NVMe Root</span>
                <span className="text-xs font-bold text-matrix-400 font-mono">
                  {telemetry.nvmeExists ? 'Mounted' : 'Missing'} ({telemetry.inputFilesCount || 0} input files)
                </span>
              </div>
              <div className="p-3 bg-black/40 border border-white/10 rounded-lg">
                <span className="text-[11px] text-slate-500 block font-mono">Python Venv</span>
                <span className={`text-xs font-bold font-mono ${telemetry.venvExists ? 'text-matrix-400' : 'text-rose-400'}`}>
                  {telemetry.venvExists ? 'Active' : 'Uninitialized'}
                </span>
              </div>
            </div>

            {telemetry.pythonDiagnostics && (
              <div className="p-3 bg-black/60 border border-white/10 text-slate-300 rounded-lg font-mono text-xs overflow-x-auto">
                <span className="text-[11px] text-slate-500 block mb-1">Virtualenv ML Diagnostics:</span>
                <pre>{JSON.stringify(telemetry.pythonDiagnostics, null, 2)}</pre>
              </div>
            )}
          </div>
        ) : (
          <div className="mt-4 p-4 bg-black/30 border border-dashed border-white/15 rounded-lg text-center">
            <p className="text-xs text-slate-400 font-mono font-medium">No DGX telemetry report received yet.</p>
            <p className="text-[11px] text-slate-500 mt-1 font-mono">
              Run <code className="bg-black/60 text-cyan-300 px-1 py-0.5 rounded border border-cyan-900/40">./check_dgx_codebase.sh</code> on your DGX terminal to transmit full codebase structure, CUDA capabilities, and environment state.
            </p>
          </div>
        )}
      </div>

      {/* Code Editor & Viewer */}
      <div className="neon-card rounded-xl overflow-hidden">
        <div className="p-3 border-b border-matrix-500/15 bg-black/30 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => setActiveTab('script4')}
              className={`px-3 py-1.5 text-xs font-mono font-semibold rounded-lg transition-colors ${
                activeTab === 'script4'
                  ? 'bg-white/5 text-cyan-300 border border-cyan-500/30'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              check_dgx_codebase.sh
            </button>
            <button
              onClick={() => setActiveTab('script1')}
              className={`px-3 py-1.5 text-xs font-mono font-semibold rounded-lg transition-colors ${
                activeTab === 'script1'
                  ? 'bg-white/5 text-cyan-300 border border-cyan-500/30'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              dgx_setup.sh
            </button>
            <button
              onClick={() => setActiveTab('script2')}
              className={`px-3 py-1.5 text-xs font-mono font-semibold rounded-lg transition-colors ${
                activeTab === 'script2'
                  ? 'bg-white/5 text-cyan-300 border border-cyan-500/30'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              ocr_spark_engine.py
            </button>
            <button
              onClick={() => setActiveTab('script3')}
              className={`px-3 py-1.5 text-xs font-mono font-semibold rounded-lg transition-colors ${
                activeTab === 'script3'
                  ? 'bg-white/5 text-cyan-300 border border-cyan-500/30'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              deploy.sh
            </button>
            <button
              onClick={() => setActiveTab('submit')}
              className={`px-3 py-1.5 text-xs font-mono font-semibold rounded-lg transition-colors ${
                activeTab === 'submit'
                  ? 'bg-white/5 text-cyan-300 border border-cyan-500/30'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              Spark Submit / CLI
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => handleCopyCode(getActiveCode())}
              className="px-3 py-1.5 text-xs font-mono font-medium text-slate-300 bg-black/40 hover:bg-white/5 border border-white/10 rounded-lg transition-colors flex items-center gap-1.5"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-matrix-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied' : 'Copy Code'}</span>
            </button>
            <button
              onClick={handleDownloadActiveScript}
              className="px-3 py-1.5 text-xs font-mono font-medium text-slate-300 bg-black/40 hover:bg-white/5 border border-white/10 rounded-lg transition-colors flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download</span>
            </button>
          </div>
        </div>

        <pre className="p-4 bg-black text-matrix-300 font-mono text-xs overflow-x-auto max-h-[520px] leading-relaxed select-all">
          <code>{getActiveCode()}</code>
        </pre>
      </div>

      {/* Audit Findings Grid */}
      <div>
        <h2 className="text-base font-mono font-bold text-slate-200 mb-3 flex items-center gap-2 uppercase tracking-wide">
          <ShieldAlert className="w-4 h-4 text-amber-400" />
          Production Engineering Countermeasures & Audits
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {AUDIT_SECTIONS.map((section) => {
            const isCritical = section.severity === 'CRITICAL';
            const isHigh = section.severity === 'HIGH';

            return (
              <div key={section.id} className="p-4 neon-card rounded-xl flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="text-[11px] font-mono font-medium text-slate-500 uppercase tracking-wider">
                      Audit Finding
                    </span>
                    <span
                      className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border ${
                        isCritical
                          ? 'bg-rose-950/40 text-rose-300 border-rose-500/30'
                          : isHigh
                          ? 'bg-amber-950/40 text-amber-300 border-amber-500/30'
                          : 'bg-cyan-950/40 text-cyan-300 border-cyan-500/30'
                      }`}
                    >
                      {section.severity}
                    </span>
                  </div>

                  <h3 className="text-xs font-mono font-bold text-slate-200 mb-2">
                    {section.title}
                  </h3>

                  <div className="space-y-2 text-xs">
                    <div className="p-2 bg-rose-950/20 border border-rose-500/20 rounded text-rose-200">
                      <span className="font-semibold block text-[11px] text-rose-400 mb-0.5 font-mono">Original Problem:</span>
                      <p className="text-[11px] leading-relaxed font-mono">{section.originalProblem}</p>
                    </div>

                    <div className="p-2 bg-matrix-900/20 border border-matrix-500/20 rounded text-matrix-200">
                      <span className="font-semibold block text-[11px] text-matrix-400 mb-0.5 font-mono">Production Countermeasure:</span>
                      <p className="text-[11px] leading-relaxed font-mono">{section.ngxSparkSolution}</p>
                    </div>
                  </div>
                </div>

                <div className="mt-3 pt-3 border-t border-matrix-500/15 text-[11px] font-mono font-medium text-matrix-400">
                  Result: {section.impact}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

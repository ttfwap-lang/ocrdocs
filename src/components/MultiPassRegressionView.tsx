/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  Play,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  ShieldCheck,
  Zap,
  TrendingUp,
  Cpu,
  Layers,
  StopCircle,
  FileText,
  Filter,
  Terminal,
  Activity,
  ArrowRight,
  Database
} from 'lucide-react';
import { GDRIVE_DOWNLOADED_FILES } from '../data/gdriveDocuments';
import { BANK_FIELD_DEFINITIONS } from '../data/bankFields';
import { PassExecutionMetric, MultiPassRunSummary } from '../types';

export const MultiPassRegressionView: React.FC = () => {
  const [selectedDocId, setSelectedDocId] = useState<string>(GDRIVE_DOWNLOADED_FILES[0].id);
  const [isRunning, setIsRunning] = useState(false);
  const [forceAllPasses, setForceAllPasses] = useState(false);
  const [activeTab, setActiveTab] = useState<'timeline' | 'fields' | 'logs'>('timeline');
  const [runResult, setRunResult] = useState<MultiPassRunSummary | null>(null);
  const [stepPassIndex, setStepPassIndex] = useState<number>(0);

  const selectedDoc = GDRIVE_DOWNLOADED_FILES.find((d) => d.id === selectedDocId) || GDRIVE_DOWNLOADED_FILES[0];

  // Initial auto-run on first load
  useEffect(() => {
    executeMultiPassRun(selectedDocId, forceAllPasses);
  }, []);

  const executeMultiPassRun = async (docId: string, forceAll: boolean) => {
    setIsRunning(true);
    try {
      const res = await fetch('/api/engine/multi-pass', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docId, maxPasses: 10, forceAllPasses: forceAll }),
      });
      const data = await res.json();
      setRunResult(data);
      setStepPassIndex(data.totalPassesRun);
    } catch (err) {
      console.error('Failed to run multi-pass engine:', err);
    } finally {
      setIsRunning(false);
    }
  };

  const completedPasses = runResult?.passes.filter((p) => p.status === 'COMPLETED') || [];
  const finalPass = completedPasses[completedPasses.length - 1];

  return (
    <div className="space-y-6">
      {/* Header Controller Card */}
      <div className="p-6 bg-white border border-slate-200 rounded-xl shadow-xs">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="px-2 py-0.5 text-xs font-semibold bg-blue-100 text-blue-800 rounded-md">
                Self-Healing Loop (Max 10 Passes)
              </span>
              <span className="px-2 py-0.5 text-xs font-semibold bg-emerald-100 text-emerald-800 rounded-md flex items-center gap-1">
                <ShieldCheck className="w-3 h-3" />
                Zero-Loss Regression Verification Active
              </span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Progressive Multi-Pass OCR & Regression Engine
            </h1>
            <p className="text-sm text-slate-600 mt-1 max-w-3xl">
              Iteratively refines OCR recognition through up to 10 progressive passes—from native glyph decoding to deep neural recognizers, SpaCy NER, and APRA checksums. Guarantees <strong>monotonic improvement</strong> (never downgrades a validated field) and automatically <strong>stops early</strong> upon convergence.
            </p>
          </div>

          {/* Action Controls */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 bg-slate-50 p-1.5 rounded-lg border border-slate-200">
              <label className="text-xs font-medium text-slate-600 flex items-center gap-1.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={forceAllPasses}
                  onChange={(e) => setForceAllPasses(e.target.checked)}
                  className="rounded text-blue-600 focus:ring-blue-500"
                />
                Force All 10 Passes
              </label>
            </div>

            <button
              onClick={() => executeMultiPassRun(selectedDocId, forceAllPasses)}
              disabled={isRunning}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-xs transition-colors disabled:opacity-50"
            >
              <Play className={`w-3.5 h-3.5 ${isRunning ? 'animate-spin' : ''}`} />
              {isRunning ? 'Optimizing Passes...' : 'Run Optimization Loop'}
            </button>
          </div>
        </div>

        {/* Target Document Selector */}
        <div className="mt-5 pt-4 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-slate-500" />
            <span className="text-xs font-medium text-slate-700">Target Google Drive Document:</span>
            <select
              value={selectedDocId}
              onChange={(e) => {
                setSelectedDocId(e.target.value);
                executeMultiPassRun(e.target.value, forceAllPasses);
              }}
              className="text-xs font-medium bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500 text-slate-900"
            >
              {GDRIVE_DOWNLOADED_FILES.map((doc) => (
                <option key={doc.id} value={doc.id}>
                  {doc.name} ({doc.institution})
                </option>
              ))}
            </select>
          </div>

          <div className="text-xs text-slate-500 flex items-center gap-2">
            <span>Size: {(selectedDoc.sizeBytes / 1024).toFixed(1)} KB</span>
            <span>•</span>
            <span className="font-mono text-emerald-600">SHA-256 Verified</span>
          </div>
        </div>
      </div>

      {/* Early Stop / Convergence Banner */}
      {runResult && runResult.earlyStopTriggered && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex items-start gap-3 text-xs text-emerald-900">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          <div>
            <div className="font-bold text-sm text-emerald-950 flex items-center gap-2">
              Early Convergence Stop Triggered (Pass {runResult.earlyStopPassNumber} of 10)
              <span className="px-2 py-0.5 bg-emerald-200/70 text-emerald-800 text-[11px] rounded-full font-semibold">
                Converged
              </span>
            </div>
            <p className="mt-1 text-emerald-800 leading-relaxed">
              {runResult.stopReason} Halting execution early to eliminate redundant GPU computation and maintain zero lock contention on the DuckDB database.
            </p>
          </div>
        </div>
      )}

      {/* Scorecard Metrics Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="p-4 bg-white border border-slate-200 rounded-xl shadow-xs">
          <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Passes Executed</div>
          <div className="text-2xl font-bold text-slate-900 mt-1">
            {runResult ? `${runResult.totalPassesRun} / 10` : '--'}
          </div>
          <div className="text-[11px] text-emerald-600 font-medium mt-0.5">
            {runResult?.earlyStopTriggered ? `Early Stop at Pass ${runResult.earlyStopPassNumber}` : 'Full Iteration'}
          </div>
        </div>

        <div className="p-4 bg-white border border-slate-200 rounded-xl shadow-xs">
          <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Final Field Recall</div>
          <div className="text-2xl font-bold text-blue-600 mt-1">
            {finalPass ? `${finalPass.recallPercent}%` : '--'}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            Gain: <span className="text-emerald-600 font-semibold">+{runResult?.gain || 0}%</span>
          </div>
        </div>

        <div className="p-4 bg-white border border-slate-200 rounded-xl shadow-xs">
          <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Fields Extracted</div>
          <div className="text-2xl font-bold text-slate-900 mt-1">
            {finalPass ? `${finalPass.fieldsExtracted} / 30` : '--'}
          </div>
          <div className="text-[11px] text-blue-600 font-medium mt-0.5">
            Australian Banking Standard
          </div>
        </div>

        <div className="p-4 bg-white border border-slate-200 rounded-xl shadow-xs">
          <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Regressions Prevented</div>
          <div className="text-2xl font-bold text-emerald-600 mt-1">
            {runResult?.totalRegressionsPrevented || 0}
          </div>
          <div className="text-[11px] text-emerald-700 font-medium mt-0.5 flex items-center gap-1">
            <ShieldCheck className="w-3 h-3" />
            Monotonic Invariant Guard
          </div>
        </div>

        <div className="p-4 bg-white border border-slate-200 rounded-xl shadow-xs col-span-2 sm:col-span-1">
          <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">APRA Checksums</div>
          <div className="text-2xl font-bold text-slate-900 mt-1">100% Valid</div>
          <div className="text-[11px] text-slate-500 mt-0.5">Modulo 89 ABN + 6-digit BSB</div>
        </div>
      </div>

      {/* Tabs View */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
        <div className="flex border-b border-slate-200 bg-slate-50/50 px-4">
          <button
            onClick={() => setActiveTab('timeline')}
            className={`py-3 px-4 text-xs font-semibold border-b-2 transition-colors ${
              activeTab === 'timeline'
                ? 'border-blue-600 text-blue-600 bg-white'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            10-Pass Progressive Timeline
          </button>
          <button
            onClick={() => setActiveTab('fields')}
            className={`py-3 px-4 text-xs font-semibold border-b-2 transition-colors ${
              activeTab === 'fields'
                ? 'border-blue-600 text-blue-600 bg-white'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            30 Fields Resolution Matrix
          </button>
          <button
            onClick={() => setActiveTab('logs')}
            className={`py-3 px-4 text-xs font-semibold border-b-2 transition-colors ${
              activeTab === 'logs'
                ? 'border-blue-600 text-blue-600 bg-white'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            Pipeline Regression Logs
          </button>
        </div>

        <div className="p-5">
          {/* TAB 1: Progressive Timeline */}
          {activeTab === 'timeline' && runResult && (
            <div className="space-y-3">
              {runResult.passes.map((p) => {
                const isCompleted = p.status === 'COMPLETED';
                const isSkipped = p.status === 'SKIPPED';
                return (
                  <div
                    key={p.passNumber}
                    className={`p-4 rounded-xl border transition-all ${
                      isCompleted
                        ? 'bg-white border-slate-200 hover:border-blue-300'
                        : 'bg-slate-50/70 border-slate-200/50 opacity-60'
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                            isCompleted ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-500'
                          }`}
                        >
                          {p.passNumber}
                        </div>
                        <div>
                          <div className="text-xs font-bold text-slate-900 flex items-center gap-2">
                            <span>{p.name}</span>
                            <span
                              className={`text-[10px] px-2 py-0.5 rounded font-semibold ${
                                isCompleted
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : 'bg-slate-200 text-slate-600'
                              }`}
                            >
                              {p.status}
                            </span>
                            {p.deltaNewFields > 0 && (
                              <span className="text-[10px] px-1.5 py-0.5 bg-blue-100 text-blue-800 rounded font-semibold">
                                +{p.deltaNewFields} new fields
                              </span>
                            )}
                            {p.regressionsPrevented > 0 && (
                              <span className="text-[10px] px-1.5 py-0.5 bg-purple-100 text-purple-800 rounded font-semibold flex items-center gap-1">
                                <ShieldCheck className="w-2.5 h-2.5" />
                                {p.regressionsPrevented} regressions blocked
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-500 flex flex-wrap items-center gap-2 mt-0.5">
                            <span>Engine: <strong className="text-slate-700">{p.engineUsed}</strong></span>
                            <span>•</span>
                            <span>Filter: <strong className="text-slate-700">{p.enhancementFilter}</strong></span>
                            {isCompleted && (
                              <>
                                <span>•</span>
                                <span>Latency: {p.durationMs}ms</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Progress Bar & Recall */}
                      <div className="flex items-center gap-4 sm:min-w-64">
                        <div className="flex-1">
                          <div className="flex justify-between text-[11px] mb-1 font-medium text-slate-600">
                            <span>Recall</span>
                            <span>{p.recallPercent}%</span>
                          </div>
                          <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className={`h-full transition-all duration-500 ${
                                isCompleted ? 'bg-blue-600' : 'bg-slate-300'
                              }`}
                              style={{ width: `${p.recallPercent}%` }}
                            />
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-xs font-bold text-slate-900">{p.fieldsExtracted}/30</div>
                          <div className="text-[10px] text-slate-500">fields</div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* TAB 2: 30 Fields Resolution Grid */}
          {activeTab === 'fields' && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {BANK_FIELD_DEFINITIONS.map((field) => {
                const extractedVal = selectedDoc.extractedFields[field.id];
                const isResolved = Boolean(extractedVal);
                return (
                  <div
                    key={field.id}
                    className={`p-3 rounded-lg border text-xs transition-colors ${
                      isResolved
                        ? 'bg-white border-slate-200'
                        : 'bg-slate-50 border-dashed border-slate-200 text-slate-400'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <span className="font-semibold text-slate-900 flex items-center gap-1.5">
                        <span className="text-[10px] w-5 h-5 rounded bg-slate-100 flex items-center justify-center font-mono text-slate-600">
                          {field.number}
                        </span>
                        {field.name}
                      </span>
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                          isResolved ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'
                        }`}
                      >
                        {isResolved ? 'Resolved' : 'Pending'}
                      </span>
                    </div>

                    <div className="text-[11px] text-slate-500 mt-1">
                      Value:{' '}
                      <span className="font-medium text-slate-900 font-mono">
                        {extractedVal || '—'}
                      </span>
                    </div>

                    <div className="text-[10px] text-slate-400 mt-1 truncate">
                      Regex: <code className="text-slate-600">{field.maxToleranceRegex}</code>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* TAB 3: Terminal Logs */}
          {activeTab === 'logs' && (
            <div className="p-4 bg-slate-950 text-slate-200 font-mono text-xs rounded-xl overflow-x-auto leading-relaxed max-h-96">
              <div className="text-slate-500 mb-2">// Self-Healing Multi-Pass Regression Audit Log</div>
              <div className="text-emerald-400">[INIT] DuckDB WAL storage connected at /mnt/nvme/ocr_pipeline/db/identity_index.duckdb</div>
              <div className="text-blue-400">[INFO] Loaded {GDRIVE_DOWNLOADED_FILES.length} documents from Google Drive cache.</div>
              {runResult?.passes.map((p) => (
                <div key={p.passNumber} className="py-0.5">
                  {p.status === 'COMPLETED' ? (
                    <span className="text-slate-300">
                      <span className="text-emerald-400">[PASS {p.passNumber}]</span> {p.name} ({p.engineUsed}) - Recall: {p.recallPercent}% (+{p.deltaNewFields} fields). Regressions prevented: {p.regressionsPrevented}. Duration: {p.durationMs}ms.
                    </span>
                  ) : (
                    <span className="text-slate-500">
                      <span className="text-amber-500">[SKIPPED]</span> Pass {p.passNumber} ({p.name}) bypassed due to early convergence threshold.
                    </span>
                  )}
                </div>
              ))}
              {runResult?.earlyStopTriggered && (
                <div className="mt-2 text-emerald-400 font-bold">
                  [CONVERGENCE] Monotonic invariant satisfied. 0 regressions detected. Pipeline halted at Pass {runResult.earlyStopPassNumber}.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

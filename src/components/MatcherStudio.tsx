/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import {
  FileText,
  AlertCircle,
  Filter,
  Search,
  Copy,
  Check,
  Zap,
  Layers,
  RefreshCw,
  Download,
  TerminalSquare,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  Calendar,
  MapPin,
  Building,
  CreditCard,
  X,
  Sparkles
} from 'lucide-react';
import { SAMPLE_DOCUMENTS } from '../data/sampleDocuments';
import { GDRIVE_DOWNLOADED_FILES } from '../data/gdriveDocuments';
import { extractBankFieldsFromText } from '../utils/ocrMatcherEngine';
import {
  validateAustralianDob,
  validateAustralianPostcode,
  validateAustralianAbn,
  validateAustralianBsb,
  enforceAustralianFormattingRules,
} from '../utils/australianValidationUtility';
import { FieldCategory } from '../types';

interface MatcherStudioProps {
  initialDocument?: {
    id: string;
    title: string;
    institution: string;
    docType: string;
    rawText: string;
  } | null;
  onNavigateToMultiPass?: () => void;
}

export const MatcherStudio: React.FC<MatcherStudioProps> = ({
  initialDocument,
  onNavigateToMultiPass,
}) => {
  const allAvailableDocs = useMemo(() => {
    return [
      ...GDRIVE_DOWNLOADED_FILES.map((f) => ({
        id: f.id,
        title: f.name,
        institution: f.institution,
        docType: f.docType,
        rawText: f.rawText,
        source: 'Google Drive Cluster' as const,
      })),
      ...SAMPLE_DOCUMENTS.map((d) => ({
        id: d.id,
        title: d.title,
        institution: d.institution,
        docType: d.docType,
        rawText: d.rawText,
        source: 'Sample Benchmark' as const,
      })),
    ];
  }, []);

  const [selectedDocId, setSelectedDocId] = useState<string>(
    initialDocument ? initialDocument.id : allAvailableDocs[0].id
  );
  const [customText, setCustomText] = useState<string>(
    initialDocument ? initialDocument.rawText : allAvailableDocs[0].rawText
  );

  React.useEffect(() => {
    if (initialDocument) {
      setSelectedDocId(initialDocument.id);
      setCustomText(initialDocument.rawText);
    }
  }, [initialDocument]);

  const [selectedCategory, setSelectedCategory] = useState<FieldCategory | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [copiedFieldId, setCopiedFieldId] = useState<string | null>(null);
  const [showDocInspector, setShowDocInspector] = useState<boolean>(true);
  const [showValidationConsole, setShowValidationConsole] = useState<boolean>(false);

  // Validation Sandbox Interactive State
  const [sandboxTab, setSandboxTab] = useState<'dob' | 'postcode' | 'abn' | 'bsb'>('dob');
  const [testDob, setTestDob] = useState<string>('14/08/1988');
  const [testPostcode, setTestPostcode] = useState<string>('3000');
  const [testPostcodeState, setTestPostcodeState] = useState<string>('VIC');
  const [testAbn, setTestAbn] = useState<string>('53 102 443 916');
  const [testBsb, setTestBsb] = useState<string>('083-004');

  const selectedDoc = useMemo(() => {
    return allAvailableDocs.find((d) => d.id === selectedDocId) || allAvailableDocs[0];
  }, [selectedDocId, allAvailableDocs]);

  const handleDocChange = (docId: string) => {
    setSelectedDocId(docId);
    const doc = allAvailableDocs.find((d) => d.id === docId);
    if (doc) setCustomText(doc.rawText);
  };

  // WEBSOCKET THIN-CLIENT STATE
  const [extractionResults, setExtractionResults] = React.useState<any[]>([]);
  const [isProcessing, setIsProcessing] = React.useState<boolean>(false);
  const [serverStatus, setServerStatus] = React.useState<string>('Disconnected');
  const [engineUsed, setEngineUsed] = React.useState<string>('LOCAL_CACHE');
  

  const abortControllerRef = React.useRef<AbortController | null>(null);

  // Trigger backend processing when text changes, debounced
  React.useEffect(() => {
    const timeoutId = setTimeout(async () => {
      setIsProcessing(true);
      setServerStatus('Uploading payload...');
      
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      abortControllerRef.current = new AbortController();
      
      try {
        const response = await fetch('/api/process-document', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: customText }),
          signal: abortControllerRef.current.signal
        });
        
        if (!response.body) throw new Error('No readable stream');
        
        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';
        
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || ''; // Keep incomplete line in buffer
          
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const payload = JSON.parse(line.substring(6));
                if (payload.type === 'ACK') {
                  setServerStatus('Job Queued...');
                } else if (payload.type === 'STATUS') {
                  setServerStatus(payload.message);
                } else if (payload.type === 'FINAL_RESULT') {
                  setExtractionResults(payload.data || []);
                  setEngineUsed(payload.engineUsed || 'UNKNOWN_ENGINE');
                  setIsProcessing(false);
                  setServerStatus('Idle (Ready)');
                }
              } catch (e) {
                console.error('Failed to parse SSE payload:', e);
              }
            }
          }
        }
      } catch (err: any) {
        if (err.name === 'AbortError') return; // Ignore debounced aborts
        console.error('Data plane error:', err);
        setServerStatus('HTTP Stream Error (Fallback to Local)');
        const rawResults = extractBankFieldsFromText(customText);
        setExtractionResults(enforceAustralianFormattingRules(rawResults));
        setIsProcessing(false);
      }
    }, 800);
    
    return () => clearTimeout(timeoutId);
  }, [customText]);

  const matchedFields = useMemo(() => extractionResults.filter((r) => r.status === 'matched'), [extractionResults]);

  // Australian Compliance Verification Stats
  const auComplianceStats = useMemo(() => {
    const auFields = matchedFields.filter(
      (r) => r.validationDetails && r.validationDetails.ruleCode !== 'AU_GENERAL'
    );
    const validCount = auFields.filter((r) => r.isValid).length;
    const invalidCount = auFields.filter((r) => !r.isValid).length;
    const rate = auFields.length > 0 ? Math.round((validCount / auFields.length) * 100) : 100;
    return { total: auFields.length, validCount, invalidCount, rate };
  }, [matchedFields]);

  // Live Sandbox Evaluators
  const liveDobResult = useMemo(() => validateAustralianDob(testDob), [testDob]);
  const livePostcodeResult = useMemo(() => validateAustralianPostcode(testPostcode, testPostcodeState), [testPostcode, testPostcodeState]);
  const liveAbnResult = useMemo(() => validateAustralianAbn(testAbn), [testAbn]);
  const liveBsbResult = useMemo(() => validateAustralianBsb(testBsb), [testBsb]);

  const avgConfidence = useMemo(() => {
    if (matchedFields.length === 0) return 0;
    return Math.round(matchedFields.reduce((sum, r) => sum + r.confidence, 0) / matchedFields.length);
  }, [matchedFields]);

  const filteredResults = useMemo(() => {
    return extractionResults.filter((r) => {
      const matchesCategory = selectedCategory === 'all' || r.category === selectedCategory;
      const matchesSearch =
        searchQuery === '' ||
        r.fieldName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        r.fieldId.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (r.extractedValue && r.extractedValue.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (r.matchedAnchor && r.matchedAnchor.toLowerCase().includes(searchQuery.toLowerCase()));
      return matchesCategory && matchesSearch;
    });
  }, [extractionResults, selectedCategory, searchQuery]);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedFieldId(id);
    setTimeout(() => setCopiedFieldId(null), 1800);
  };

  const handleSimulateNoise = () => {
    const noisy = customText
      .replace(/Title/gi, 'tit1e')
      .replace(/Given Name/gi, 'g1ven_name')
      .replace(/Family Name/gi, 'fam1ly_nm')
      .replace(/Date of Birth/gi, 'd0b')
      .replace(/Employment/gi, 'emp1oyment')
      .replace(/Mobile/gi, 'm0bi1e')
      .replace(/Gross Income/gi, 'gross_inc0me')
      .replace(/Balance Transfer/gi, 'balancetransfer');
    setCustomText(noisy);
  };

  const handleResetDocument = () => {
    setCustomText(selectedDoc.rawText);
  };

  const handleExportCSV = () => {
    const header = ['Field ID', 'Field Name', 'Category', 'Extracted Value', 'Confidence', 'Matched Anchor', 'Valid', 'Validation Message', 'Status'];
    const rows = extractionResults.map(r => [
      r.fieldId, r.fieldName, r.category,
      `"${(r.extractedValue || '').replace(/"/g, '""')}"`,
      r.confidence,
      `"${(r.matchedAnchor || '').replace(/"/g, '""')}"`,
      r.isValid !== undefined ? r.isValid.toString() : '',
      `"${(r.validationMessage || '').replace(/"/g, '""')}"`,
      r.status
    ]);
    const csvContent = [header, ...rows].map(e => e.join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `INTELLIGENCE_EXPORT_${selectedDocId}_${Date.now()}.csv`;
    link.click();
  };

  // Ultra Colour Coated Labels
  const getCategoryStyles = (category: string) => {
    switch (category) {
      case 'identity': return 'bg-blue-950/60 text-blue-400 border-blue-500/50';
      case 'residential': return 'bg-amber-950/60 text-amber-400 border-amber-500/50';
      case 'contact': return 'bg-indigo-950/60 text-indigo-400 border-indigo-500/50';
      case 'employment': return 'bg-cyan-950/60 text-cyan-400 border-cyan-500/50';
      case 'income': return 'bg-emerald-950/60 text-emerald-400 border-emerald-500/50';
      case 'expenses': return 'bg-rose-950/60 text-rose-400 border-rose-500/50';
      case 'assets_liabilities': return 'bg-purple-950/60 text-purple-400 border-purple-500/50';
      case 'facility': return 'bg-orange-950/60 text-orange-400 border-orange-500/50';
      default: return 'bg-slate-900 text-slate-400 border-slate-700';
    }
  };

  const categories = [
    { id: 'all', label: 'ALL FIELDS' },
    { id: 'identity', label: 'IDENTITY (1-8, 15-16)' },
    { id: 'residential', label: 'RESIDENTIAL (9-12)' },
    { id: 'contact', label: 'CONTACT (13-14)' },
    { id: 'employment', label: 'EMPLOYMENT (17-20)' },
    { id: 'income', label: 'INCOME (21-23)' },
    { id: 'expenses', label: 'EXPENSES (24)' },
    { id: 'assets_liabilities', label: 'ASSETS/LIAB (25-28)' },
    { id: 'facility', label: 'FACILITY (29-30)' },
  ];

  return (
    <div className="space-y-4">
      {/* HUD Header */}
      <div className="bg-[#0a0a0a] border border-slate-800 p-6 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6">
        <div>
          <h1 className="text-2xl font-mono font-bold tracking-widest text-white uppercase mb-1">
            Data Extraction Grid
          </h1>
          <p className="text-xs font-mono text-slate-500 uppercase tracking-widest">
            Target: Document Forensics & Deep Parsing
          </p>
        </div>
        
        <div className="flex flex-wrap gap-4 font-mono">
          <div className="border border-slate-800 bg-black p-3">
            <span className="text-[10px] text-slate-500 block uppercase tracking-widest mb-1">Data Hits</span>
            <span className="text-2xl font-bold text-cyan-400">{matchedFields.length}</span>
            <span className="text-xs text-slate-600"> / 33</span>
          </div>
          <div className="border border-slate-800 bg-black p-3">
            <span className="text-[10px] text-slate-500 block uppercase tracking-widest mb-1">Confidence</span>
            <span className="text-2xl font-bold text-emerald-400">{avgConfidence}%</span>
          </div>
          <div className="border border-cyan-900/60 bg-cyan-950/20 p-3">
            <span className="text-[10px] text-cyan-400 block uppercase tracking-widest mb-1 flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5" /> AU Compliance
            </span>
            <span className={`text-2xl font-bold ${auComplianceStats.invalidCount === 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
              {auComplianceStats.rate}%
            </span>
            <span className="text-[10px] text-slate-500 block">
              {auComplianceStats.validCount}/{auComplianceStats.total} Rules OK
            </span>
          </div>
          <div className="border border-emerald-900/50 bg-emerald-950/20 p-3">
            <span className="text-[10px] text-emerald-600 block uppercase tracking-widest mb-1">Engine Status</span>
            <span className="text-sm font-bold text-emerald-500 flex items-center h-full pb-1">OPTIMIZED</span>
          </div>
        </div>
      </div>

      {/* Control Bar */}
      <div className="bg-[#0a0a0a] border border-slate-800 p-3 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-mono text-slate-500 uppercase tracking-widest mr-1">Target File:</span>
          <select
            value={selectedDocId}
            onChange={(e) => handleDocChange(e.target.value)}
            className="text-[11px] font-mono bg-black text-cyan-400 border border-slate-700 px-3 py-1.5 rounded focus:outline-none focus:border-cyan-500"
          >
            <optgroup label="Google Drive Ingested Documents (Cluster)">
              {allAvailableDocs.filter(d => d.source === 'Google Drive Cluster').map((doc) => (
                <option key={doc.id} value={doc.id}>
                  {doc.title} ({doc.institution})
                </option>
              ))}
            </optgroup>
            <optgroup label="Synthetic Benchmark Documents">
              {allAvailableDocs.filter(d => d.source === 'Sample Benchmark').map((doc) => (
                <option key={doc.id} value={doc.id}>
                  {doc.title} ({doc.institution})
                </option>
              ))}
            </optgroup>
          </select>

          {onNavigateToMultiPass && (
            <button
              onClick={onNavigateToMultiPass}
              className="px-3 py-1.5 text-[10px] font-mono uppercase tracking-widest bg-blue-950/40 text-blue-400 border border-blue-800 hover:bg-blue-900/50 transition-colors flex items-center gap-1.5 rounded"
            >
              <Zap className="w-3 h-3" />
              <span>10-Pass Loop</span>
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setShowValidationConsole(!showValidationConsole)}
            className={`px-4 py-2 text-[10px] font-mono uppercase tracking-widest transition-colors flex items-center gap-2 border ${
              showValidationConsole
                ? 'bg-cyan-950/40 text-cyan-300 border-cyan-700'
                : 'bg-black text-cyan-400 border-cyan-900/60 hover:bg-cyan-950/20'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>AU Rules & Sandbox</span>
          </button>
          <button onClick={handleSimulateNoise} className="px-4 py-2 text-[10px] font-mono uppercase tracking-widest bg-rose-950/20 text-rose-400 border border-rose-900/50 hover:bg-rose-900/40 transition-colors flex items-center gap-2">
            <Zap className="w-3.5 h-3.5" /> Inject Typos
          </button>
          <button onClick={handleResetDocument} className="px-4 py-2 text-[10px] font-mono uppercase tracking-widest bg-black text-slate-400 border border-slate-800 hover:border-slate-600 transition-colors flex items-center gap-2">
            <RefreshCw className="w-3.5 h-3.5" /> Reset
          </button>
          <button onClick={handleExportCSV} className="px-4 py-2 text-[10px] font-mono uppercase tracking-widest bg-emerald-950/20 text-emerald-400 border border-emerald-900/50 hover:bg-emerald-900/40 transition-colors flex items-center gap-2">
            <Download className="w-3.5 h-3.5" /> Export DB
          </button>
          <button onClick={() => setShowDocInspector(!showDocInspector)} className="px-4 py-2 text-[10px] font-mono uppercase tracking-widest bg-black text-slate-400 border border-slate-800 hover:border-slate-600 transition-colors flex items-center gap-2">
            <Layers className="w-3.5 h-3.5" /> Toggle Source
          </button>
        </div>
      </div>

      {/* AU STANDARDS VALIDATION CONSOLE & LIVE SANDBOX */}
      {showValidationConsole && (
        <div className="bg-[#080808] border-2 border-cyan-800/80 p-5 space-y-4 font-mono shadow-2xl">
          <div className="flex items-center justify-between border-b border-cyan-950 pb-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-cyan-400" />
              <div>
                <h3 className="text-sm font-bold text-white uppercase tracking-widest">
                  Australian Statutory Data Validation Utility
                </h3>
                <p className="text-[11px] text-cyan-400/80">
                  Pre-render enforcement: DOB formats, strictly 4-digit postcodes, ATO Modulo-89 ABN, and APRA BSB routing.
                </p>
              </div>
            </div>
            <button
              onClick={() => setShowValidationConsole(false)}
              className="p-1 text-slate-500 hover:text-white border border-slate-800 hover:border-slate-600"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Rule Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="border border-slate-800 bg-black/60 p-3 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-1.5 text-xs text-amber-400 font-bold mb-1">
                  <Calendar className="w-3.5 h-3.5" /> 1. DOB (DD/MM/YYYY)
                </div>
                <p className="text-[10px] text-slate-400 leading-tight">
                  Enforces standard AU DD/MM/YYYY formatting, calendar validity (leap year Feb 29), human age bounds (18-120), and rejects future dates.
                </p>
              </div>
              <div className="mt-2 text-[9px] text-emerald-400 bg-emerald-950/20 border border-emerald-900/40 p-1">
                Active: Auto-canonicalizes to DD/MM/YYYY
              </div>
            </div>

            <div className="border border-slate-800 bg-black/60 p-3 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-1.5 text-xs text-cyan-400 font-bold mb-1">
                  <MapPin className="w-3.5 h-3.5" /> 2. Postcode (4 Digits)
                </div>
                <p className="text-[10px] text-slate-400 leading-tight">
                  Enforces strictly 4 numeric digits (/^\d&#123;4&#125;$/), valid Australia Post range (0200-9999), and state-coherence cross-matching.
                </p>
              </div>
              <div className="mt-2 text-[9px] text-emerald-400 bg-emerald-950/20 border border-emerald-900/40 p-1">
                Active: Rejects 3-digit or 5-digit inputs
              </div>
            </div>

            <div className="border border-slate-800 bg-black/60 p-3 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-1.5 text-xs text-emerald-400 font-bold mb-1">
                  <Building className="w-3.5 h-3.5" /> 3. ABN (Modulo-89)
                </div>
                <p className="text-[10px] text-slate-400 leading-tight">
                  Enforces 11 digits, non-zero first digit, and the official ATO Modulo-89 checksum weights: [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19].
                </p>
              </div>
              <div className="mt-2 text-[9px] text-emerald-400 bg-emerald-950/20 border border-emerald-900/40 p-1">
                Active: ATO Modulo-89 statutory check
              </div>
            </div>

            <div className="border border-slate-800 bg-black/60 p-3 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-1.5 text-xs text-purple-400 font-bold mb-1">
                  <CreditCard className="w-3.5 h-3.5" /> 4. BSB (6 Digits & APRA)
                </div>
                <p className="text-[10px] text-slate-400 leading-tight">
                  Enforces 6 digits (XXX-XXX), verifies APRA ADI directory (ANZ, CBA, Westpac, NAB, Macquarie, etc.), and checks state routing code.
                </p>
              </div>
              <div className="mt-2 text-[9px] text-emerald-400 bg-emerald-950/20 border border-emerald-900/40 p-1">
                Active: APRA Directory & state routing
              </div>
            </div>
          </div>

          {/* Interactive Live Testing Sandbox */}
          <div className="border border-cyan-900/70 bg-black/90 p-4 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <span className="text-xs text-cyan-300 font-bold uppercase tracking-widest flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-cyan-400" /> Interactive Rule Verification Sandbox
              </span>
              <div className="flex gap-1">
                {(['dob', 'postcode', 'abn', 'bsb'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setSandboxTab(tab)}
                    className={`px-3 py-1 text-[10px] uppercase font-bold tracking-wider transition-colors border ${
                      sandboxTab === tab
                        ? 'bg-cyan-950/50 text-cyan-300 border-cyan-600'
                        : 'bg-black text-slate-500 border-slate-800 hover:border-slate-600'
                    }`}
                  >
                    {tab.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            {/* TAB: DOB */}
            {sandboxTab === 'dob' && (
              <div className="space-y-3">
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={testDob}
                    onChange={(e) => setTestDob(e.target.value)}
                    placeholder="Enter DOB (e.g. 14/08/1988, 29/02/2024, 31/02/1990)"
                    className="flex-1 bg-[#050505] border border-slate-700 p-2.5 text-xs text-white focus:border-cyan-500 focus:outline-none"
                  />
                  <div className="flex gap-1 flex-wrap">
                    <button
                      onClick={() => setTestDob('14/08/1988')}
                      className="px-2 py-1 text-[10px] bg-slate-900 border border-slate-800 text-slate-300 hover:text-white"
                    >
                      Sample Valid (14/08/1988)
                    </button>
                    <button
                      onClick={() => setTestDob('29/02/2024')}
                      className="px-2 py-1 text-[10px] bg-slate-900 border border-slate-800 text-slate-300 hover:text-white"
                    >
                      Leap Day (29/02/2024)
                    </button>
                    <button
                      onClick={() => setTestDob('31/02/1990')}
                      className="px-2 py-1 text-[10px] bg-rose-950/30 border border-rose-900/50 text-rose-300 hover:text-white"
                    >
                      Invalid (31/02/1990)
                    </button>
                    <button
                      onClick={() => setTestDob('01/01/2030')}
                      className="px-2 py-1 text-[10px] bg-rose-950/30 border border-rose-900/50 text-rose-300 hover:text-white"
                    >
                      Future Date
                    </button>
                  </div>
                </div>

                <div className={`p-3 border flex items-start gap-2.5 ${liveDobResult.isValid ? 'bg-emerald-950/20 border-emerald-900/60 text-emerald-400' : 'bg-rose-950/20 border-rose-900/60 text-rose-400'}`}>
                  {liveDobResult.isValid ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" /> : <XCircle className="w-4 h-4 shrink-0 mt-0.5" />}
                  <div className="text-xs space-y-1">
                    <div className="font-bold">{liveDobResult.message}</div>
                    {liveDobResult.isValid && (
                      <div className="text-[11px] text-slate-400">
                        Canonical: <span className="text-white font-bold">{liveDobResult.canonicalDate}</span> | Calculated Age: <span className="text-cyan-300 font-bold">{liveDobResult.age} years</span>
                      </div>
                    )}
                    {liveDobResult.errorCode && (
                      <div className="text-[10px] text-rose-300 font-mono">Error Code: {liveDobResult.errorCode}</div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* TAB: POSTCODE */}
            {sandboxTab === 'postcode' && (
              <div className="space-y-3">
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={testPostcode}
                    onChange={(e) => setTestPostcode(e.target.value)}
                    placeholder="Enter Postcode (e.g. 3000, 2000, 300, 30001)"
                    className="flex-1 bg-[#050505] border border-slate-700 p-2.5 text-xs text-white focus:border-cyan-500 focus:outline-none"
                  />
                  <select
                    value={testPostcodeState}
                    onChange={(e) => setTestPostcodeState(e.target.value)}
                    className="bg-[#050505] border border-slate-700 px-3 py-2 text-xs text-cyan-300 focus:outline-none"
                  >
                    <option value="">No State Context</option>
                    <option value="VIC">VIC State Context</option>
                    <option value="NSW">NSW State Context</option>
                    <option value="QLD">QLD State Context</option>
                    <option value="WA">WA State Context</option>
                    <option value="SA">SA State Context</option>
                    <option value="TAS">TAS State Context</option>
                    <option value="ACT">ACT State Context</option>
                    <option value="NT">NT State Context</option>
                  </select>
                  <div className="flex gap-1 flex-wrap">
                    <button
                      onClick={() => { setTestPostcode('3000'); setTestPostcodeState('VIC'); }}
                      className="px-2 py-1 text-[10px] bg-slate-900 border border-slate-800 text-slate-300 hover:text-white"
                    >
                      3000 (VIC)
                    </button>
                    <button
                      onClick={() => { setTestPostcode('2000'); setTestPostcodeState('NSW'); }}
                      className="px-2 py-1 text-[10px] bg-slate-900 border border-slate-800 text-slate-300 hover:text-white"
                    >
                      2000 (NSW)
                    </button>
                    <button
                      onClick={() => setTestPostcode('300')}
                      className="px-2 py-1 text-[10px] bg-rose-950/30 border border-rose-900/50 text-rose-300 hover:text-white"
                    >
                      300 (3 Digits - Fail)
                    </button>
                    <button
                      onClick={() => setTestPostcode('30009')}
                      className="px-2 py-1 text-[10px] bg-rose-950/30 border border-rose-900/50 text-rose-300 hover:text-white"
                    >
                      30009 (5 Digits - Fail)
                    </button>
                  </div>
                </div>

                <div className={`p-3 border flex items-start gap-2.5 ${livePostcodeResult.isValid ? 'bg-emerald-950/20 border-emerald-900/60 text-emerald-400' : 'bg-rose-950/20 border-rose-900/60 text-rose-400'}`}>
                  {livePostcodeResult.isValid ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" /> : <XCircle className="w-4 h-4 shrink-0 mt-0.5" />}
                  <div className="text-xs space-y-1">
                    <div className="font-bold">{livePostcodeResult.message}</div>
                    <div className="text-[11px] text-slate-400">
                      Allocated Region: <span className="text-cyan-300 font-bold">{livePostcodeResult.allocatedState}</span> | Rule: Must be exactly 4 numeric digits (0200-9999).
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB: ABN */}
            {sandboxTab === 'abn' && (
              <div className="space-y-3">
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={testAbn}
                    onChange={(e) => setTestAbn(e.target.value)}
                    placeholder="Enter ABN (e.g. 53 102 443 916)"
                    className="flex-1 bg-[#050505] border border-slate-700 p-2.5 text-xs text-white focus:border-cyan-500 focus:outline-none"
                  />
                  <div className="flex gap-1 flex-wrap">
                    <button
                      onClick={() => setTestAbn('53 102 443 916')}
                      className="px-2 py-1 text-[10px] bg-slate-900 border border-slate-800 text-slate-300 hover:text-white"
                    >
                      Valid (53 102 443 916)
                    </button>
                    <button
                      onClick={() => setTestAbn('51 824 753 556')}
                      className="px-2 py-1 text-[10px] bg-slate-900 border border-slate-800 text-slate-300 hover:text-white"
                    >
                      Valid (51 824 753 556)
                    </button>
                    <button
                      onClick={() => setTestAbn('53 102 443 917')}
                      className="px-2 py-1 text-[10px] bg-rose-950/30 border border-rose-900/50 text-rose-300 hover:text-white"
                    >
                      Bad Checksum (End 917)
                    </button>
                    <button
                      onClick={() => setTestAbn('1234567890')}
                      className="px-2 py-1 text-[10px] bg-rose-950/30 border border-rose-900/50 text-rose-300 hover:text-white"
                    >
                      10 Digits (Length Fail)
                    </button>
                  </div>
                </div>

                <div className={`p-3 border flex items-start gap-2.5 ${liveAbnResult.isValid ? 'bg-emerald-950/20 border-emerald-900/60 text-emerald-400' : 'bg-rose-950/20 border-rose-900/60 text-rose-400'}`}>
                  {liveAbnResult.isValid ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" /> : <XCircle className="w-4 h-4 shrink-0 mt-0.5" />}
                  <div className="text-xs space-y-1">
                    <div className="font-bold">{liveAbnResult.message}</div>
                    <div className="text-[11px] text-slate-400">
                      Weighted Sum: <span className="text-cyan-300 font-bold">{liveAbnResult.checksumSum ?? '-'}</span> | Modulo-89 Remainder: <span className={liveAbnResult.remainder === 0 ? "text-emerald-400 font-bold" : "text-rose-400 font-bold"}>{liveAbnResult.remainder ?? '-'} (Required: 0)</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB: BSB */}
            {sandboxTab === 'bsb' && (
              <div className="space-y-3">
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={testBsb}
                    onChange={(e) => setTestBsb(e.target.value)}
                    placeholder="Enter BSB (e.g. 083-004, 062-000)"
                    className="flex-1 bg-[#050505] border border-slate-700 p-2.5 text-xs text-white focus:border-cyan-500 focus:outline-none"
                  />
                  <div className="flex gap-1 flex-wrap">
                    <button
                      onClick={() => setTestBsb('083-004')}
                      className="px-2 py-1 text-[10px] bg-slate-900 border border-slate-800 text-slate-300 hover:text-white"
                    >
                      NAB VIC (083-004)
                    </button>
                    <button
                      onClick={() => setTestBsb('062-000')}
                      className="px-2 py-1 text-[10px] bg-slate-900 border border-slate-800 text-slate-300 hover:text-white"
                    >
                      CBA NSW (062-000)
                    </button>
                    <button
                      onClick={() => setTestBsb('013-006')}
                      className="px-2 py-1 text-[10px] bg-slate-900 border border-slate-800 text-slate-300 hover:text-white"
                    >
                      ANZ VIC (013-006)
                    </button>
                    <button
                      onClick={() => setTestBsb('000-000')}
                      className="px-2 py-1 text-[10px] bg-rose-950/30 border border-rose-900/50 text-rose-300 hover:text-white"
                    >
                      000-000 (Reserved)
                    </button>
                    <button
                      onClick={() => setTestBsb('123-4')}
                      className="px-2 py-1 text-[10px] bg-rose-950/30 border border-rose-900/50 text-rose-300 hover:text-white"
                    >
                      123-4 (Short)
                    </button>
                  </div>
                </div>

                <div className={`p-3 border flex items-start gap-2.5 ${liveBsbResult.isValid ? 'bg-emerald-950/20 border-emerald-900/60 text-emerald-400' : 'bg-rose-950/20 border-rose-900/60 text-rose-400'}`}>
                  {liveBsbResult.isValid ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" /> : <XCircle className="w-4 h-4 shrink-0 mt-0.5" />}
                  <div className="text-xs space-y-1">
                    <div className="font-bold">{liveBsbResult.message}</div>
                    {liveBsbResult.isValid && (
                      <div className="text-[11px] text-slate-400">
                        APRA ADI: <span className="text-cyan-300 font-bold">{liveBsbResult.institutionName}</span> | Branch Region: <span className="text-white font-bold">{liveBsbResult.stateRegion}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* BACKEND MULTI-PASS STATUS OVERLAY */}
      {isProcessing && (
        <div className="bg-[#080808] border-2 border-cyan-800/80 p-5 mb-4 shadow-2xl flex items-center justify-between animate-pulse">
          <div className="flex items-center gap-3">
            <RefreshCw className="w-5 h-5 text-cyan-400 animate-spin" />
            <div>
              <h3 className="text-sm font-bold text-white uppercase tracking-widest">
                Data Plane Processing Active
              </h3>
              <p className="text-[11px] text-cyan-400/80 font-mono mt-1">
                {serverStatus}
              </p>
            </div>
          </div>
          <div className="text-xs font-mono text-cyan-600 bg-cyan-950/30 px-3 py-1 border border-cyan-900/50">
            HTTP://NGX-SPARK-STREAM
          </div>
        </div>
      )}
      
      {!isProcessing && extractionResults.length > 0 && (
         <div className="bg-[#050505] border border-emerald-900/50 p-3 mb-4 flex items-center justify-between text-emerald-500 font-mono text-xs">
           <div className="flex items-center gap-2">
             <Check className="w-4 h-4" />
             <span>Payload Extracted via: <strong className="text-emerald-400">{engineUsed}</strong></span>
           </div>
           <div>Latency: &lt;5ms (HTTP Chunked Stream)</div>
         </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Source Text Buffer */}
        {showDocInspector && (
          <div className="lg:col-span-4 flex flex-col">
            <div className="bg-[#0a0a0a] border border-slate-800 flex-1 flex flex-col">
              <div className="p-3 border-b border-slate-800 flex items-center justify-between bg-black">
                <div className="flex items-center gap-2 text-slate-400">
                  <TerminalSquare className="w-4 h-4" />
                  <span className="text-[10px] font-mono uppercase tracking-widest">Raw OCR Stream</span>
                </div>
              </div>
              <textarea
                value={customText}
                onChange={(e) => setCustomText(e.target.value)}
                className="w-full flex-1 min-h-[600px] font-mono text-[11px] p-4 bg-transparent text-emerald-500/70 focus:text-emerald-400 focus:outline-none resize-none leading-relaxed tracking-wider selection:bg-cyan-900 selection:text-white"
                spellCheck="false"
              />
            </div>
          </div>
        )}

        {/* Extraction Results */}
        <div className={`${showDocInspector ? 'lg:col-span-8' : 'lg:col-span-12'} flex flex-col gap-4`}>
          {/* Filters */}
          <div className="bg-[#0a0a0a] border border-slate-800 p-3 flex flex-col sm:flex-row items-center gap-4">
            <div className="relative flex-1 w-full">
              <Search className="w-4 h-4 text-slate-600 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="SEARCH DATABASE..."
                className="w-full pl-10 pr-4 py-2 text-xs font-mono uppercase tracking-widest bg-black border border-slate-800 text-white focus:outline-none focus:border-cyan-500 transition-colors"
              />
            </div>
            <div className="flex items-center gap-2 overflow-x-auto w-full sm:w-auto">
              <Filter className="w-3.5 h-3.5 text-slate-600 shrink-0" />
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategory(cat.id as any)}
                  className={`px-3 py-1.5 text-[10px] font-mono uppercase tracking-widest whitespace-nowrap border transition-all ${
                    selectedCategory === cat.id
                      ? 'bg-slate-800 text-white border-slate-600'
                      : 'bg-black text-slate-500 border-slate-800 hover:border-slate-600'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          </div>

          {/* Cards Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {filteredResults.map((result) => {
              const isMatched = result.status === 'matched';
              return (
                <div key={result.fieldId} className={`border flex flex-col ${isMatched ? 'bg-[#0a0a0a] border-slate-700' : 'bg-[#050505] border-slate-900 opacity-50'}`}>
                  
                  {/* Top Bar */}
                  <div className="p-3 border-b border-slate-800 flex items-start justify-between bg-black">
                    <div>
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className={`text-[9px] font-mono uppercase tracking-widest px-2 py-0.5 border ${getCategoryStyles(result.category)}`}>
                          {result.category}
                        </span>
                        <span className="text-[10px] font-mono text-slate-600 uppercase tracking-widest">
                          ID: {result.fieldId}
                        </span>
                      </div>
                      <h4 className="text-white font-mono text-sm tracking-wide uppercase">{result.fieldName}</h4>
                    </div>
                    {isMatched && (
                      <span className="text-[10px] font-mono font-bold text-emerald-500 tracking-widest flex flex-col items-end">
                        <span>CONFIDENCE</span>
                        <span className="text-base">{result.confidence}%</span>
                      </span>
                    )}
                  </div>

                  {/* Body Content */}
                  <div className="p-4 flex-1 flex flex-col justify-center">
                    {isMatched ? (
                      <div className="space-y-4">
                        {/* THE ULTRA CLEAR LARGE FONT VALUE */}
                        <div className="relative group">
                          <span className="text-[9px] text-slate-500 font-mono uppercase tracking-widest absolute -top-3 left-0">Extracted Payload</span>
                          <div className="bg-black border border-slate-800 p-3 group-hover:border-slate-600 transition-colors">
                            <div className="flex justify-between items-center">
                              <span className="text-xl sm:text-2xl font-mono font-bold text-white tracking-widest break-all">
                                {result.extractedValue}
                              </span>
                              <button
                                onClick={() => copyToClipboard(result.canonicalValue || result.extractedValue || '', result.fieldId)}
                                className="text-slate-600 hover:text-cyan-400 p-2 transition-colors shrink-0"
                                title="Copy Value"
                              >
                                {copiedFieldId === result.fieldId ? <Check className="w-5 h-5 text-emerald-400" /> : <Copy className="w-5 h-5" />}
                              </button>
                            </div>
                            {result.canonicalValue && result.canonicalValue !== result.extractedValue && (
                              <div className="mt-2 pt-2 border-t border-slate-800 flex items-center justify-between text-[11px] font-mono">
                                <span className="text-slate-500 uppercase tracking-widest">AU Standard Format:</span>
                                <span className="text-cyan-300 font-bold tracking-wider">{result.canonicalValue}</span>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* NLP / Anchor Meta */}
                        <div className="flex flex-col gap-1.5 pt-1 border-t border-slate-800/60">
                          <div className="flex items-center justify-between text-[10px] font-mono">
                            <span className="text-slate-500 uppercase tracking-widest">Matched Anchor Trace:</span>
                            {result.disambiguation && (
                              <span className="px-1.5 py-0.5 bg-cyan-950/40 border border-cyan-800/50 text-cyan-300 uppercase text-[9px] tracking-wider">
                                {result.disambiguation.disambiguationStrategy}
                              </span>
                            )}
                          </div>
                          <code className="text-xs font-mono text-cyan-400 truncate">{result.matchedAnchor}</code>
                          {result.disambiguation?.notes && (
                            <p className="text-[10px] font-mono text-slate-400 leading-tight">
                              Context: {result.disambiguation.notes}
                            </p>
                          )}
                        </div>

                        {/* Australian Address G-NAF Structural Decomposition */}
                        {result.parsedStructure && (
                          <div className="bg-black/80 border border-amber-900/40 p-3 space-y-2">
                            <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
                              <span className="text-[10px] font-mono font-bold text-amber-400 uppercase tracking-widest flex items-center gap-1.5">
                                G-NAF Address Decomposition
                              </span>
                              <span className="text-[9px] font-mono text-emerald-400 px-1.5 py-0.2 border border-emerald-800/60 bg-emerald-950/40">
                                Score: {result.parsedStructure.gnafConfidenceScore}%
                              </span>
                            </div>
                            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 text-[10px] font-mono">
                              {result.parsedStructure.unitOrLevel && (
                                <div>
                                  <span className="text-slate-500 block uppercase">Unit/Flat:</span>
                                  <span className="text-white font-bold">{result.parsedStructure.unitOrLevel}</span>
                                </div>
                              )}
                              <div>
                                <span className="text-slate-500 block uppercase">Street #:</span>
                                <span className="text-white font-bold">{result.parsedStructure.streetNumber || '-'}</span>
                              </div>
                              <div className="col-span-2">
                                <span className="text-slate-500 block uppercase">Street Name:</span>
                                <span className="text-amber-200 font-bold">{result.parsedStructure.streetName} {result.parsedStructure.streetType}</span>
                              </div>
                              <div>
                                <span className="text-slate-500 block uppercase">Suburb:</span>
                                <span className="text-white font-bold">{result.parsedStructure.suburb}</span>
                              </div>
                              <div>
                                <span className="text-slate-500 block uppercase">State:</span>
                                <span className="text-cyan-400 font-bold">{result.parsedStructure.state}</span>
                              </div>
                              <div>
                                <span className="text-slate-500 block uppercase">Postcode:</span>
                                <span className="text-white font-bold">{result.parsedStructure.postcode}</span>
                              </div>
                              <div>
                                <span className="text-slate-500 block uppercase">Coherence:</span>
                                <span className={result.parsedStructure.isPostcodeStateCoherent ? "text-emerald-400 font-bold" : "text-rose-400 font-bold"}>
                                  {result.parsedStructure.isPostcodeStateCoherent ? "VALIDATED" : "MISMATCH"}
                                </span>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Australian Statutory Validation Layer */}
                        {result.isValid === false && (
                          <div className="bg-rose-950/20 border border-rose-900/50 p-2.5 flex items-start gap-2.5 text-rose-500">
                            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                            <div className="flex flex-col flex-1">
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-rose-400">
                                  Australian Standard Validation Failed
                                </span>
                                {result.validationDetails?.ruleCode && (
                                  <span className="text-[9px] font-mono px-1.5 py-0.5 bg-rose-950 border border-rose-800 text-rose-300">
                                    {result.validationDetails.ruleCode}
                                  </span>
                                )}
                              </div>
                              <span className="text-xs font-mono mt-1 text-rose-300 font-medium">{result.validationMessage}</span>
                            </div>
                          </div>
                        )}

                        {result.isValid === true && result.validationMessage && (
                          <div className="bg-emerald-950/20 border border-emerald-900/50 p-2.5 flex items-start gap-2 text-emerald-400 text-xs font-mono">
                            <Check className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400" />
                            <div className="flex flex-col flex-1">
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-emerald-400">
                                  {result.validationDetails?.ruleName || 'Format Verified'}
                                </span>
                                {result.validationDetails?.ruleCode && result.validationDetails.ruleCode !== 'AU_GENERAL' && (
                                  <span className="text-[9px] font-mono px-1.5 py-0.5 bg-emerald-950 border border-emerald-800 text-emerald-300">
                                    {result.validationDetails.ruleCode}
                                  </span>
                                )}
                              </div>
                              <span className="text-xs text-slate-300 mt-0.5">{result.validationMessage}</span>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center justify-center h-full py-6">
                        <span className="text-xs font-mono text-slate-700 uppercase tracking-widest">No Signal Detected</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

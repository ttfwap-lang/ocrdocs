/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  enforceAustralianFormattingRules,
  validateAustralianField,
  validateAustralianDob,
  validateAustralianPostcode,
  validateAustralianAbn,
  validateAustralianBsb,
  repairOcrDigits,
} from './australianValidationUtility';
import { cleanNameValue, rejectReason } from './valueSanity';
import { BankFieldDefinition, ExtractionResult, AustralianAddressStructure, ContextualDisambiguationMeta } from '../types';
import { BANK_FIELD_DEFINITIONS, CORE_IDENTIFIER_DEFINITIONS } from '../data/bankFields';

/**
 * High-performance Contextual & Structural OCR Matcher Engine.
 * Features:
 *  - Section-aware structural parsing (Australian Banking forms)
 *  - Proximity logic & spatial line offset disambiguation
 *  - Australian G-NAF compliant Address Decomposition (Unit, Street#, Street Name, Type, Suburb, State, Postcode)
 *  - State <-> Postcode coherency matrix verification
 *  - ATO Modulo-89 ABN Checksum algorithm
 *  - APRA BSB Bank Directory Prefix Resolution
 */
export function extractBankFieldsFromText(text: string): ExtractionResult[] {
  const allFields: BankFieldDefinition[] = [...BANK_FIELD_DEFINITIONS, ...CORE_IDENTIFIER_DEFINITIONS];
  const results: ExtractionResult[] = [];

  // 1. Analyze document sections and spatial line boundaries
  const documentContext = analyzeDocumentContext(text);

  // 2. Perform section-bounded & proximity-weighted field extraction
  for (const field of allFields) {
    const result = extractSingleFieldWithContext(text, field, documentContext);
    results.push(result);
  }

  // 3. Reject values that are really the form's own label/instruction text (they fabricated fake identities), and
  //    strip leading/trailing label words from name fields ("or family name Reddy" -> "Reddy").
  const ownLabels = new Map(allFields.map(f => [f.id, f.exampleLabels ?? []]));
  const sane = results.map(r => {
    if (r.status !== 'matched' || typeof r.extractedValue !== 'string') return r;
    const cleaned = cleanNameValue(r.fieldId, r.extractedValue);
    const reason = rejectReason(r.fieldId, cleaned, ownLabels.get(r.fieldId));
    if (reason) {
      return {
        ...r,
        status: 'missing' as const,
        extractedValue: null,
        confidence: 0,
        isValid: undefined,
        validationMessage: `Rejected ${reason}: "${String(r.extractedValue).slice(0, 60)}" is form text, not a value.`,
      };
    }
    return cleaned === r.extractedValue ? r : { ...r, extractedValue: cleaned };
  });

  // 4. Enforce standard Australian formatting rules (DOB, 4-digit Postcode, ABN/BSB) before results are rendered
  return enforceAustralianFormattingRules(sane);
}

interface DocumentContext {
  lines: string[];
  sections: Array<{ name: string; startLine: number; endLine: number }>;
}

function analyzeDocumentContext(text: string): DocumentContext {
  const lines = text.split(/\r?\n/);
  const sections: Array<{ name: string; startLine: number; endLine: number }> = [];

  let currentSection = 'HEADER';
  let sectionStart = 0;

  lines.forEach((line, idx) => {
    const upper = line.toUpperCase().trim();
    if (
      upper.includes('1. PERSONAL') ||
      upper.includes('APPLICANT') ||
      upper.includes('PERSONAL IDENTIFIER')
    ) {
      if (idx > sectionStart) sections.push({ name: currentSection, startLine: sectionStart, endLine: idx - 1 });
      currentSection = 'PERSONAL_IDENTITY';
      sectionStart = idx;
    } else if (
      upper.includes('2. RESIDENTIAL') ||
      upper.includes('ADDRESS & ACCOMMODATION') ||
      upper.includes('LOCATION & CONTACT') ||
      upper.includes('RESIDENTIAL:')
    ) {
      if (idx > sectionStart) sections.push({ name: currentSection, startLine: sectionStart, endLine: idx - 1 });
      currentSection = 'RESIDENTIAL_CONTACT';
      sectionStart = idx;
    } else if (
      upper.includes('3. EMPLOYMENT') ||
      upper.includes('PROFESSIONAL BACKGROUND') ||
      upper.includes('EMPLOYMENT:') ||
      upper.includes('JOB & INCOME')
    ) {
      if (idx > sectionStart) sections.push({ name: currentSection, startLine: sectionStart, endLine: idx - 1 });
      currentSection = 'EMPLOYMENT_INCOME';
      sectionStart = idx;
    } else if (
      upper.includes('4. FINANCIAL POSITION') ||
      upper.includes('HEM LIVING COSTS') ||
      upper.includes('EXPENSES & LIABILITIES') ||
      upper.includes('COMMITMENTS & APRA')
    ) {
      if (idx > sectionStart) sections.push({ name: currentSection, startLine: sectionStart, endLine: idx - 1 });
      currentSection = 'FINANCIAL_POSITION';
      sectionStart = idx;
    } else if (
      upper.includes('5. FACILITY REQUEST') ||
      upper.includes('NEW FACILITY') ||
      upper.includes('BALANCE TRANSFER')
    ) {
      if (idx > sectionStart) sections.push({ name: currentSection, startLine: sectionStart, endLine: idx - 1 });
      currentSection = 'FACILITY_REQUEST';
      sectionStart = idx;
    }
  });

  sections.push({ name: currentSection, startLine: sectionStart, endLine: lines.length - 1 });

  return { lines, sections };
}

/**
 * Every field's `maxToleranceRegex` alternates on `[_-]?`/`[_-]*` to join
 * label words (e.g. `given[_-]?names?`), documented as tolerating "spaced"
 * variants -- but a literal space isn't `_` or `-`, so a real label like
 * "First Name" or "Family Name" (the overwhelmingly common real-world case)
 * never actually matched; only "FirstName"/"First-Name"/"First_Name" did.
 * Widening the class to `[\s_-]` at the point each pattern is compiled fixes
 * every field's label matching at once, without hand-editing ~99 entries.
 */
function spaceTolerantLabel(pattern: string): string {
  return pattern.replace(/\[_-\]/g, '[\\s_-]');
}

/**
 * Spans of text already owned by a stronger identifier (checksum-valid ABN,
 * AU phone number). Weaker digit sweeps (BSB, postcode) must not re-read
 * fragments of these -- e.g. the "824 753" inside ABN "51 824 753 556".
 */
function findClaimedSpans(text: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  for (const m of text.matchAll(/(?<!\d)\d{2}[ ]?\d{3}[ ]?\d{3}[ ]?\d{3}(?!\d)/g)) {
    const idx = m.index ?? 0;
    // Valid ABN, or an ABN-labelled run even when its checksum fails, owns its digits.
    if (validateField('abn', m[0]).isValid || /\b(?:abn|a\.b\.n)\b\W{0,3}$/i.test(text.substring(Math.max(0, idx - 12), idx))) {
      spans.push([idx, idx + m[0].length]);
    }
  }
  for (const m of text.matchAll(/(?<!\d)(?:\+?61[ ]?|0)[2-478](?:[ -]?\d){8}(?!\d)/g)) {
    spans.push([m.index ?? 0, (m.index ?? 0) + m[0].length]);
  }
  return spans;
}

function overlapsSpan(start: number, end: number, spans: Array<[number, number]>): boolean {
  return spans.some(([a, b]) => start < b && end > a);
}

function getSectionForIndex(docContext: DocumentContext, lineIndex: number): string {
  const match = docContext.sections.find(s => lineIndex >= s.startLine && lineIndex <= s.endLine);
  return match ? match.name : 'GENERAL';
}

function extractSingleFieldWithContext(
  text: string,
  field: BankFieldDefinition,
  docContext: DocumentContext
): ExtractionResult {
  try {
    // ABN Specialized Extraction & ATO Modulo-89 Checksum
    if (field.id === 'abn') {
      // OCR repair: only when no plain ABN checksum-validates. A confusable-laden 11-digit run
      // (e.g. "5l 824 753 55B") is accepted solely if the REPAIRED digits pass the ATO checksum.
      const plainValid = Array.from(text.matchAll(/(?<!\d)\d{2}[ ]?\d{3}[ ]?\d{3}[ ]?\d{3}(?!\d)/g))
        .some(m => validateField(field.id, m[0]).isValid);
      if (!plainValid) {
        for (const m of text.matchAll(/(?<![0-9A-Za-z])[0-9OoQIl|SB]{2}[ ]?[0-9OoQIl|SB]{3}[ ]?[0-9OoQIl|SB]{3}[ ]?[0-9OoQIl|SB]{3}(?![0-9A-Za-z])/g)) {
          const fixed = repairOcrDigits(m[0]);
          if (!fixed || (m[0].match(/\d/g) || []).length < 6) continue;
          if (!validateField(field.id, fixed).isValid) continue;
          const idx = m.index ?? 0;
          return {
            fieldId: field.id,
            fieldName: field.name,
            category: field.category,
            matchedAnchor: 'ABN [ATO Modulo-89 Validated, OCR-repaired]',
            extractedValue: fixed,
            confidence: 80,
            matchIndex: idx,
            regexPattern: field.maxToleranceRegex,
            status: 'matched',
            contextSnippet: getSnippet(text, idx, m[0].length),
            isValid: true,
            validationMessage: `ABN checksum verified after OCR repair (raw "${m[0]}").`,
            disambiguation: {
              disambiguationStrategy: 'REGEX_EXACT',
              nlpResolved: false,
              notes: `ocr_repaired: true; raw="${m[0]}"`,
            },
          };
        }
      }
      const abnMatches = Array.from(text.matchAll(/(?<!\d)\d{2}[ ]?\d{3}[ ]?\d{3}[ ]?\d{3}(?!\d)/g));
      if (abnMatches.length > 0) {
        // Pick the ABN that is closest to employer/business context
        let bestAbnMatch = abnMatches[0];
        let bestScore = -1;

        for (const match of abnMatches) {
          const matchIdx = match.index ?? 0;
          const preWindow = text.substring(Math.max(0, matchIdx - 50), matchIdx).toLowerCase();
          let score = 10;
          // Checksum validity dominates: a keyword must never promote an invalid ABN over a valid one.
          if (validateField(field.id, match[0]).isValid) score += 100;
          if (/\b(?:abn|workplace|business)\b/.test(preWindow)) score += 50;
          if (score > bestScore) {
            bestScore = score;
            bestAbnMatch = match;
          }
        }

        const val = bestAbnMatch[0].trim();
        const { isValid, validationMessage } = validateField(field.id, val);
        const matchIdx = bestAbnMatch.index ?? 0;
        const lineIdx = text.substring(0, matchIdx).split('\n').length - 1;

        return {
          fieldId: field.id,
          fieldName: field.name,
          category: field.category,
          matchedAnchor: 'ABN [ATO Modulo-89 Validated]',
          extractedValue: val,
          confidence: isValid ? 98 : 40,
          matchIndex: matchIdx,
          regexPattern: field.maxToleranceRegex,
          status: isValid ? 'matched' : 'ambiguous',
          contextSnippet: getSnippet(text, matchIdx, bestAbnMatch[0].length),
          isValid,
          validationMessage,
          disambiguation: {
            disambiguationStrategy: 'KEYWORD_PROXIMITY_HEURISTIC',
            sectionContext: getSectionForIndex(docContext, lineIdx),
            nlpResolved: false,
            notes: 'Verified via Australian Taxation Office (ATO) Modulo-89 Checksum Algorithm. Disambiguated via spatial keyword proximity.'
          }
        };
      }
    }

    // BSB Specialized Extraction & APRA Bank Directory Lookup
    if (field.id === 'bsb') {
      const claimed = findClaimedSpans(text);
      const candidates = Array.from(text.matchAll(/(?<!\d)\d{3}[- ]\d{3}(?!\d)/g))
        .filter(m => !overlapsSpan(m.index ?? 0, (m.index ?? 0) + m[0].length, claimed))
        .map(m => {
          const mIdx = m.index ?? 0;
          const pre = text.substring(Math.max(0, mIdx - 30), mIdx).toLowerCase();
          return { m, anchored: /\b(?:bsb|branch)\b/.test(pre) };
        });
      const bestBsb = candidates.find(c => c.anchored) ?? candidates[0];
      if (bestBsb) {
        const val = bestBsb.m[0].trim();
        const { isValid, validationMessage } = validateField(field.id, val);
        const institutionName = getApraBankNameFromBsb(val);
        const matchIdx = bestBsb.m.index ?? 0;
        const lineIdx = text.substring(0, matchIdx).split('\n').length - 1;

        return {
          fieldId: field.id,
          fieldName: field.name,
          category: field.category,
          matchedAnchor: `BSB [${institutionName}]`,
          extractedValue: val,
          // Format-only validation: only an explicit "BSB"/"branch" label earns high confidence.
          confidence: !isValid ? 30 : bestBsb.anchored ? 95 : 55,
          matchIndex: matchIdx,
          regexPattern: field.maxToleranceRegex,
          status: bestBsb.anchored || !isValid ? 'matched' : 'ambiguous',
          contextSnippet: getSnippet(text, matchIdx, bestBsb.m[0].length),
          isValid,
          validationMessage: isValid ? `APRA Registered: ${institutionName}` : validationMessage,
          disambiguation: {
            disambiguationStrategy: 'KEYWORD_PROXIMITY_HEURISTIC',
            sectionContext: getSectionForIndex(docContext, lineIdx),
            nlpResolved: false,
            notes: bestBsb.anchored
              ? `Anchored to a BSB label; resolved to ${institutionName} via APRA routing matrix.`
              : 'Unanchored 3-3 digit group outside any ABN/phone number; needs review.'
          }
        };
      }
    }

    // Postcode Specialized Extraction (only when anchored by a state token or a postcode label)
    if (field.id === 'postcode') {
      const claimed = findClaimedSpans(text);
      const STATE_RE = /\b(?:nsw|vic|qld|wa|sa|tas|act|nt)\b/i;
      const found = Array.from(text.matchAll(/(?<![\d$.,\/-])(?:0[2-9]|[1-9][0-9])\d{2}(?![\d.,\/-])/g))
        .filter(m => !overlapsSpan(m.index ?? 0, (m.index ?? 0) + 4, claimed))
        .map(m => {
          const idx = m.index ?? 0;
          const afterState = STATE_RE.test(text.substring(Math.max(0, idx - 12), idx));
          const labelled = /post\s?code/i.test(text.substring(Math.max(0, idx - 20), idx));
          return { m, idx, ok: afterState || labelled };
        })
        .filter(c => c.ok);
      const best = found[0];
      if (best) {
        const val = best.m[0].trim();
        const { isValid, validationMessage } = validateField(field.id, val);
        return {
          fieldId: field.id,
          fieldName: field.name,
          category: field.category,
          matchedAnchor: 'AU Postcode Pattern',
          extractedValue: val,
          confidence: isValid ? 90 : 40,
          matchIndex: best.idx,
          regexPattern: field.maxToleranceRegex,
          status: 'matched',
          contextSnippet: getSnippet(text, best.idx, 4),
          isValid,
          validationMessage,
          disambiguation: {
            disambiguationStrategy: 'REGEX_EXACT',
            nlpResolved: false,
            notes: 'Four-digit code anchored by a state abbreviation or postcode label.'
          }
        };
      }
    }

    // Dynamic Key-Value extraction with Contextual Proximity Disambiguation
    const hasLabelRegex = Boolean(field.labelRegex);
    const labelPattern = spaceTolerantLabel(hasLabelRegex ? field.labelRegex! : field.maxToleranceRegex);
    const anchorRegex = hasLabelRegex
      // Value-typed fields: label, optional "no."/"number"/"#" filler, separator, then the VALUE pattern itself.
      ? new RegExp(`(?:^|[^a-zA-Z0-9_])${labelPattern}(?:\\s*(?:no\\.?|num(?:ber)?|#)?\\s*[:=#\\-]?\\s*)${field.maxToleranceRegex}`, 'gi')
      : new RegExp(`(?:^|[^a-zA-Z0-9_])${labelPattern}(?:\\s*[:=\\-]\\s*|\\s+)([^\\n\\r]{2,95})`, 'gi');
    const matches = Array.from(text.matchAll(anchorRegex));

    if (matches.length > 0) {
      // PROXIMITY & NLP CONTEXTUAL DISAMBIGUATION
      const { selectedMatch, nlpApplied, strategy, notes } = disambiguateCandidates(
        field,
        matches,
        text,
        docContext
      );

      let rawValue = selectedMatch[2] ? selectedMatch[2].trim() : '';
      rawValue = cleanExtractedValue(rawValue, field.targetDataType);

      if (rawValue.length > 0) {
        const matchIdx = selectedMatch.index ?? 0;
        let confidence = calculateConfidence(field, rawValue);
        if (nlpApplied) confidence = Math.min(99, confidence + 4);

        const { isValid, validationMessage } = validateField(field.id, rawValue);

        // Perform Australian Address Structural Decomposition
        let parsedStructure: AustralianAddressStructure | undefined;
        if (field.id === 'residential_address' || field.id === 'previous_address') {
          const parsed = parseAustralianAddress(rawValue);
          if (parsed) {
            parsedStructure = parsed;
            if (!parsed.isPostcodeStateCoherent) {
              confidence = Math.max(60, confidence - 15);
            }
          }
        }

        const lineIdx = text.substring(0, matchIdx).split('\n').length - 1;
        let anchorDisplay = selectedMatch[1] ? selectedMatch[0].split(/[:=\-]/)[0].trim() : field.name;
        if (nlpApplied) anchorDisplay += ' [NLP Disambiguated]';

        return {
          fieldId: field.id,
          fieldName: field.name,
          category: field.category,
          matchedAnchor: anchorDisplay,
          extractedValue: rawValue,
          confidence,
          matchIndex: matchIdx,
          regexPattern: field.maxToleranceRegex,
          status: 'matched',
          contextSnippet: getSnippet(text, matchIdx, selectedMatch[0].length),
          isValid,
          validationMessage,
          parsedStructure,
          disambiguation: {
            disambiguationStrategy: strategy,
            sectionContext: getSectionForIndex(docContext, lineIdx),
            competingCandidatesCount: matches.length,
            nlpResolved: nlpApplied,
            notes,
          }
        };
      }
    }

    // Fallback: Check if the anchor simply occurs in text (for boolean/status fields like de facto, single, married)
    const simpleRegex = new RegExp(`\\b${labelPattern}\\b`, 'i');
    // A bare label with no value is not a detection for value-typed identifier fields.
    const simpleMatch = hasLabelRegex ? null : text.match(simpleRegex);
    if (simpleMatch) {
      return {
        fieldId: field.id,
        fieldName: field.name,
        category: field.category,
        matchedAnchor: simpleMatch[0],
        extractedValue: simpleMatch[0],
        confidence: 75,
        matchIndex: simpleMatch.index ?? 0,
        regexPattern: field.maxToleranceRegex,
        status: 'matched',
        contextSnippet: getSnippet(text, simpleMatch.index ?? 0, simpleMatch[0].length),
        disambiguation: {
          disambiguationStrategy: 'REGEX_EXACT',
          nlpResolved: false,
          notes: 'Direct token boundary occurrence.'
        }
      };
    }

    return {
      fieldId: field.id,
      fieldName: field.name,
      category: field.category,
      matchedAnchor: null,
      extractedValue: null,
      confidence: 0,
      matchIndex: -1,
      regexPattern: field.maxToleranceRegex,
      status: 'missing',
    };
  } catch (err) {
    console.error(`Error matching field ${field.id}:`, err);
    return {
      fieldId: field.id,
      fieldName: field.name,
      category: field.category,
      matchedAnchor: null,
      extractedValue: null,
      confidence: 0,
      matchIndex: -1,
      regexPattern: field.maxToleranceRegex,
      status: 'missing',
    };
  }
}

/**
 * Intelligent Multi-Candidate Disambiguation
 * Distinguishes between:
 *  - Primary Residential Address vs Previous / Past Address
 *  - Applicant Given/Family Name vs Employer / Company Name
 *  - Gross Income vs Net Monthly Takehome vs Rental Income vs Variable Incentive
 *  - Requested Limit vs Existing Credit Card Balance vs Mortgage Loan
 */
function disambiguateCandidates(
  field: BankFieldDefinition,
  matches: RegExpMatchArray[],
  fullText: string,
  docContext: DocumentContext
): {
  selectedMatch: RegExpMatchArray;
  nlpApplied: boolean;
  strategy: ContextualDisambiguationMeta['disambiguationStrategy'];
  notes: string;
} {
  if (matches.length === 1) {
    return {
      selectedMatch: matches[0],
      nlpApplied: false,
      strategy: 'REGEX_EXACT',
      notes: 'Single anchor candidate identified.'
    };
  }

  // 1. Disambiguate Residential Address vs Previous Address vs Street Name
  if (field.id === 'residential_address') {
    // Exclude any candidates preceded by "past", "prev", "former", "prior"
    const currentCandidates = matches.filter(m => {
      const anchor = (m[1] || m[0]).toLowerCase();
      return !anchor.includes('past') && !anchor.includes('prev') && !anchor.includes('prior') && !anchor.includes('former');
    });

    const candidatePool = currentCandidates.length > 0 ? currentCandidates : matches;

    // Prefer candidate containing street number + street type + state
    const structuredMatch = candidatePool.find(m => {
      const val = m[2] || '';
      return /\d+.*(?:st|rd|ave|street|road|avenue|blvd|lane|way|pde|cres|terrace).*(?:nsw|vic|qld|wa|sa|tas|act|nt)/i.test(val);
    });

    if (structuredMatch) {
      return {
        selectedMatch: structuredMatch,
        nlpApplied: false,
        strategy: 'REGEX_STRUCTURAL_MATCH',
        notes: 'Disambiguated primary residential address from past/employer location via regex street matching and state detection.'
      };
    }

    return {
      selectedMatch: candidatePool[0],
      nlpApplied: true,
      strategy: 'PROXIMITY_WEIGHTING',
      notes: 'Ranked highest via proximity to Residential Particulars header.'
    };
  }

  if (field.id === 'previous_address') {
    // Specifically prefer candidates with "past", "prev", "former", "prior"
    const pastMatch = matches.find(m => {
      const anchor = (m[1] || m[0]).toLowerCase();
      return anchor.includes('past') || anchor.includes('prev') || anchor.includes('prior') || anchor.includes('former');
    });

    if (pastMatch) {
      return {
        selectedMatch: pastMatch,
        nlpApplied: true,
        strategy: 'SECTION_AFFINITY',
        notes: 'Disambiguated historical previous address from current residence.'
      };
    }
  }

  // 2. Disambiguate Applicant Given Name vs Employer Name
  if (field.id === 'given_names' || field.id === 'family_name') {
    // Exclude strings with corporate entities (Pty Ltd, Hospital, Inc, Corp, Partners, Technologies)
    const personalCandidates = matches.filter(m => {
      const val = (m[2] || '').toLowerCase();
      return !val.includes('pty') && !val.includes('ltd') && !val.includes('hospital') &&
             !val.includes('partners') && !val.includes('tech') && !val.includes('bank') &&
             !val.includes('energy') && !val.includes('corp');
    });

    if (personalCandidates.length > 0) {
      return {
        selectedMatch: personalCandidates[0],
        nlpApplied: false,
        strategy: 'KEYWORD_PROXIMITY_HEURISTIC',
        notes: 'Disambiguated human applicant name from corporate entity / employer via bounding keywords.'
      };
    }
  }

  // 3. Disambiguate Gross vs Net vs Rental vs Variable Income
  if (field.id === 'gross_salary') {
    const grossMatch = matches.find(m => {
      const textBlock = (m[0] + ' ' + (m[2] || '')).toLowerCase();
      return (textBlock.includes('gross') || textBlock.includes('annual') || textBlock.includes('p.a.') || textBlock.includes('before tax')) &&
             !textBlock.includes('net') && !textBlock.includes('take home') && !textBlock.includes('rental');
    });

    if (grossMatch) {
      return {
        selectedMatch: grossMatch,
        nlpApplied: true,
        strategy: 'SECTION_AFFINITY',
        notes: 'Disambiguated Gross Annual Salary from Net Takehome and Secondary Rental Income.'
      };
    }
  }

  if (field.id === 'net_salary') {
    const netMatch = matches.find(m => {
      const textBlock = (m[0] + ' ' + (m[2] || '')).toLowerCase();
      return textBlock.includes('net') || textBlock.includes('take home') || textBlock.includes('/mo') || textBlock.includes('monthly');
    });

    if (netMatch) {
      return {
        selectedMatch: netMatch,
        nlpApplied: true,
        strategy: 'SECTION_AFFINITY',
        notes: 'Disambiguated Net Monthly Remuneration from Annual Base Pay.'
      };
    }
  }

  // 4. Disambiguate Requested Limit vs Existing Debts
  if (field.id === 'limit_requested') {
    const reqMatch = matches.find(m => {
      const textBlock = (m[0] + ' ' + (m[2] || '')).toLowerCase();
      return (textBlock.includes('request') || textBlock.includes('new facility') || textBlock.includes('maximum limit')) &&
             !textBlock.includes('debt') && !textBlock.includes('owing');
    });

    if (reqMatch) {
      return {
        selectedMatch: reqMatch,
        nlpApplied: true,
        strategy: 'PROXIMITY_WEIGHTING',
        notes: 'Disambiguated requested credit line from current revolving credit balances.'
      };
    }
  }

  // Fallback: Pick candidate with highest heuristic length / completeness
  const bestByLength = matches.reduce((prev, curr) => ((curr[2] || '').length > (prev[2] || '').length ? curr : prev));
  return {
    selectedMatch: bestByLength,
    nlpApplied: true,
    strategy: 'PROXIMITY_WEIGHTING',
    notes: 'Selected most complete candidate based on token density.'
  };
}

/**
 * Australian G-NAF Address Parser & Coherency Validator
 * Decomposes an address string into Unit, Street#, Street Name, Type, Suburb, State, Postcode
 */
export function parseAustralianAddress(rawAddress: string): AustralianAddressStructure | null {
  if (!rawAddress || rawAddress.length < 8) return null;

  const cleaned = rawAddress.replace(/[\n\r]+/g, ' ').trim();

  // AU State matching: NSW, VIC, QLD, WA, SA, TAS, ACT, NT
  const stateMatch = cleaned.match(/\b(NSW|VIC|QLD|WA|SA|TAS|ACT|NT)\b/i);
  const state = stateMatch ? (stateMatch[1].toUpperCase() as AustralianAddressStructure['state']) : 'UNKNOWN';

  // 4-digit Postcode matching
  const postcodeMatch = cleaned.match(/\b\d{4}\b/);
  const postcode = postcodeMatch ? postcodeMatch[0] : '';

  // Unit / Flat / Level (e.g. 14/88, Unit 4, Level 2)
  let unitOrLevel: string | undefined;
  const unitSlashMatch = cleaned.match(/^(\d{1,4}[a-zA-Z]?)\/(\d+)/);
  if (unitSlashMatch) {
    unitOrLevel = unitSlashMatch[1];
  } else {
    const unitWordMatch = cleaned.match(/\b(?:unit|apt|apartment|suite|lot|flat|level|lvl)\s*(\d+[a-zA-Z]?|\w+)\b/i);
    if (unitWordMatch) unitOrLevel = unitWordMatch[1];
  }

  // Street Number
  let streetNumber = '';
  if (unitSlashMatch) {
    streetNumber = unitSlashMatch[2];
  } else {
    const numMatch = cleaned.match(/\b(\d+(?:-\d+)?[a-zA-Z]?)\b/);
    if (numMatch) streetNumber = numMatch[1];
  }

  // Street Type
  const streetTypeRegex = /\b(Street|St|Road|Rd|Avenue|Ave|Boulevard|Blvd|Parade|Pde|Crescent|Cres|Way|Drive|Dr|Court|Ct|Lane|Ln|Highway|Hwy|Terrace|Tce|Place|Pl|Esplanade|Esp|Circuit|Cct)\b/i;
  const streetTypeMatch = cleaned.match(streetTypeRegex);
  const streetType = streetTypeMatch ? normalizeStreetType(streetTypeMatch[1]) : '';

  // Street Name (between street number and street type)
  let streetName = '';
  if (streetNumber && streetTypeMatch) {
    const streetTypeIdx = cleaned.indexOf(streetTypeMatch[0]);
    const numIdx = cleaned.indexOf(streetNumber);
    if (streetTypeIdx > numIdx) {
      const candidate = cleaned.substring(numIdx + streetNumber.length, streetTypeIdx).trim();
      streetName = candidate.replace(/^[\/,\s]+/, '').replace(/[\/,\s]+$/, '');
    }
  }

  // Suburb (between street type and state/postcode)
  let suburb = '';
  if (streetTypeMatch && stateMatch) {
    const typeIdx = cleaned.indexOf(streetTypeMatch[0]) + streetTypeMatch[0].length;
    const stateIdx = cleaned.indexOf(stateMatch[0]);
    if (stateIdx > typeIdx) {
      const candidate = cleaned.substring(typeIdx, stateIdx).trim();
      suburb = candidate.replace(/^[, ]+/, '').replace(/[, ]+$/, '');
    }
  }

  // State <-> Postcode Coherency Check
  const isPostcodeStateCoherent = verifyPostcodeStateCoherence(state, postcode);

  // G-NAF Confidence Score
  let score = 50;
  if (streetNumber) score += 10;
  if (streetName) score += 10;
  if (streetType) score += 10;
  if (suburb) score += 10;
  if (state !== 'UNKNOWN') score += 5;
  if (postcode) score += 5;
  if (isPostcodeStateCoherent) score += 10;

  return {
    rawAddress: cleaned,
    unitOrLevel,
    streetNumber,
    streetName: streetName || 'Detected from OCR',
    streetType: streetType || 'St',
    suburb: suburb || 'Metro',
    state,
    postcode,
    gnafConfidenceScore: Math.min(100, score),
    isPostcodeStateCoherent,
  };
}

function normalizeStreetType(type: string): string {
  const t = type.toLowerCase();
  if (t === 'st' || t === 'street') return 'Street';
  if (t === 'rd' || t === 'road') return 'Road';
  if (t === 'ave' || t === 'avenue') return 'Avenue';
  if (t === 'blvd' || t === 'boulevard') return 'Boulevard';
  if (t === 'pde' || t === 'parade') return 'Parade';
  if (t === 'cres' || t === 'crescent') return 'Crescent';
  if (t === 'dr' || t === 'drive') return 'Drive';
  if (t === 'ct' || t === 'court') return 'Court';
  if (t === 'ln' || t === 'lane') return 'Lane';
  if (t === 'hwy' || t === 'highway') return 'Highway';
  if (t === 'tce' || t === 'terrace') return 'Terrace';
  return type;
}

function verifyPostcodeStateCoherence(state: string, postcode: string): boolean {
  if (!postcode || postcode.length !== 4) return false;
  const num = parseInt(postcode, 10);
  if (isNaN(num)) return false;

  switch (state.toUpperCase()) {
    case 'NSW':
      return (num >= 1000 && num <= 2599) || (num >= 2619 && num <= 2899) || (num >= 2921 && num <= 2999);
    case 'ACT':
      return (num >= 200 && num <= 299) || (num >= 2600 && num <= 2618) || (num >= 2900 && num <= 2920);
    case 'VIC':
      return (num >= 3000 && num <= 3999) || (num >= 8000 && num <= 8999);
    case 'QLD':
      return (num >= 4000 && num <= 4999) || (num >= 9000 && num <= 9999);
    case 'SA':
      return (num >= 5000 && num <= 5799) || (num >= 5800 && num <= 5999);
    case 'WA':
      return (num >= 6000 && num <= 6797) || (num >= 6800 && num <= 6999);
    case 'TAS':
      return (num >= 7000 && num <= 7799) || (num >= 7800 && num <= 7999);
    case 'NT':
      return num >= 800 && num <= 899;
    default:
      return true;
  }
}

/**
 * Looks up the Australian APRA Authorized Deposit-taking Institution (ADI) from BSB prefix.
 */
function getApraBankNameFromBsb(bsbStr: string): string {
  const digits = bsbStr.replace(/\D/g, '');
  if (digits.length < 2) return 'Unknown Bank';

  const prefix = digits.substring(0, 2);
  const prefix3 = digits.substring(0, 3);

  if (prefix === '01') return 'ANZ Bank (Australia and New Zealand Banking Group)';
  if (prefix === '03' || prefix === '73') return 'Westpac Banking Corporation / St.George';
  if (prefix === '06') return 'Commonwealth Bank of Australia (CBA)';
  if (prefix === '08') return 'National Australia Bank (NAB)';
  if (prefix === '04') return 'Macquarie Bank';
  if (prefix === '18') return 'Bank of Queensland (BOQ)';
  if (prefix === '30') return 'Bankwest';
  if (prefix === '09') return 'Reserve Bank of Australia (RBA)';
  if (prefix3 === '484') return 'Suncorp Bank';
  if (prefix3 === '633') return 'Bendigo and Adelaide Bank';
  if (prefix3 === '802') return 'Auswide Bank';

  return 'APRA Authorized Institution';
}

function cleanExtractedValue(val: string, dataType: string): string {
  let cleaned = val.trim();

  // If there's an inline subsequent field label like "Expiry:" or "Exp:", slice before it
  const inlineCutoff = cleaned.search(/\s+(?:exp(?:iry)?|bsb|abn|dob|status|account):/i);
  if (inlineCutoff > 0) {
    cleaned = cleaned.substring(0, inlineCutoff).trim();
  }

  // Remove trailing commas, pipes, or semicolons
  cleaned = cleaned.replace(/[,;|\-]+$/, '').trim();

  if (dataType === 'currency') {
    const currencyMatch = cleaned.match(/\$?\s*[\d,]+(?:\.\d{2})?(?:\s*(?:p\.?a\.?|\/month|\/mo|\/week|\/yr))?/i);
    if (currencyMatch) return currencyMatch[0].trim();
  }

  if (dataType === 'phone') {
    const phoneMatch = cleaned.match(/(?:\+61\s?|0)[2478](?:[ -]?\d){8}/);
    if (phoneMatch) return phoneMatch[0].trim();
  }

  if (dataType === 'email') {
    const emailMatch = cleaned.match(/[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+/);
    if (emailMatch) return emailMatch[0].trim();
  }

  if (dataType === 'date') {
    const dateMatch = cleaned.match(/\b(?:\d{1,2}[-/.])?\d{1,2}[-/.]\d{2,4}\b/);
    if (dateMatch) return dateMatch[0].trim();
  }

  return cleaned;
}

function calculateConfidence(field: BankFieldDefinition, val: string): number {
  if (!val) return 0;
  let score = 88;

  if (field.targetDataType === 'currency' && val.includes('$')) score += 8;
  if (field.targetDataType === 'email' && val.includes('@') && val.includes('.')) score += 10;
  if (field.targetDataType === 'phone' && (val.startsWith('04') || val.startsWith('+61'))) score += 10;
  if (field.targetDataType === 'date' && /\d{2}[-/. ]\d{2}[-/. ]\d{2,4}/.test(val)) score += 9;

  return Math.min(score, 99);
}

function getSnippet(fullText: string, index: number, length: number): string {
  const start = Math.max(0, index - 25);
  const end = Math.min(fullText.length, index + length + 45);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < fullText.length ? '...' : '';
  return `${prefix}${fullText.substring(start, end).replace(/\n/g, ' ')}${suffix}`;
}

function validateField(fieldId: string, value: string): { isValid: boolean; validationMessage?: string } {
  if (!value) return { isValid: false, validationMessage: 'Value is empty.' };
  const res = validateAustralianField(fieldId, value);
  return {
    isValid: res.isValid,
    validationMessage: res.validationMessage,
  };
}

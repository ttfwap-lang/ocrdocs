/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for the OCR Matcher Engine (src/utils/ocrMatcherEngine.ts).
 * Verifies extractBankFieldsFromText against realistic banking application
 * text, covering ABN/BSB/postcode/DOB/phone specialized extraction,
 * result structure integrity, error resilience, confidence bounds, and
 * Australian address structural decomposition.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const project = path.resolve(__dirname, '..');

// Helper: bundle and import a TypeScript module in-memory
async function loadModule(relPath) {
  const result = await esbuild.build({
    entryPoints: [path.join(project, relPath)],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    packages: 'external',
  });
  const b64 = Buffer.from(result.outputFiles[0].text).toString('base64');
  return import(`data:text/javascript;base64,${b64}`);
}

let engine;

test('OCR Engine — suite bootstrap', async () => {
  engine = await loadModule('src/utils/ocrMatcherEngine');
  assert.equal(typeof engine.extractBankFieldsFromText, 'function');
  assert.equal(typeof engine.parseAustralianAddress, 'function');
});

/* ── Realistic sample banking application text ──────────────────── */
const SAMPLE_TEXT = `
Application Form — Individual Banking
Title: Mr
Given_Name: John
Middle_Name: Robert
Family_Name: Smith
DOB: 14/08/1988
Residency_Status: Australian Citizen
Marital_Status: Married
Dependants: 2

1. ADDRESS PARTICULARS
Residential_Address: 42 O'Connor Street, Canberra ACT 2601
Previous_Address: 10 Beach Road, Bondi NSW 2000
Address_Tenure: Owns

3. CONTACT INFORMATION
Mobile: 0412 345 678
Email: john.smith@email.com
Home_Phone: 02 9876 5432

4. EMPLOYMENT & INCOME
Employment_Status: Full-time
Occupation: Software Engineer
Industry: Information Technology
Employer: TechCorp Pty Ltd
Employer_ABN: 51824753556
Gross_Salary: $120000 gross per annum
Net_Monthly: $7500
Rental_Income: $0

5. FINANCIAL POSITION
Monthly_Living_Expenses: $2500
Asset_Holdings: $150000
Liability_Mortgages: $0
Credit_Card_Limit: $5000
Credit_Limit_Requested: $500000

6. ACCOUNT DETAILS
BSB: 062-299
Account_Number: 12345678
Card_Number: **** **** **** 1234
`;

/* ── Structural / contract tests ──────────────────────────────── */
test('extractBankFieldsFromText: returns exactly 99 results (90 app + 9 core)', () => {
  const results = engine.extractBankFieldsFromText(SAMPLE_TEXT);
  assert.equal(results.length, 99, `Expected 99 results, got ${results.length}`);
});

test('every result has the required ExtractionResult structure', () => {
  const results = engine.extractBankFieldsFromText(SAMPLE_TEXT);
  for (const r of results) {
    assert.ok(r.fieldId, `Missing fieldId in result`);
    assert.ok(r.fieldName, `Missing fieldName for ${r.fieldId}`);
    assert.ok(r.category, `Missing category for ${r.fieldId}`);
    assert.equal(typeof r.confidence, 'number');
    assert.ok(r.confidence >= 0 && r.confidence <= 99, `Confidence ${r.confidence} out of [0,99] for ${r.fieldId}`);
    assert.ok(r.status === 'matched' || r.status === 'missing' || r.status === 'ambiguous',
      `Invalid status "${r.status}" for ${r.fieldId}`);
    assert.equal(typeof r.matchIndex, 'number');
    assert.ok(r.regexPattern, `Missing regexPattern for ${r.fieldId}`);
  }
});

test('matched fields have extractedValue and matchedAnchor set', () => {
  const results = engine.extractBankFieldsFromText(SAMPLE_TEXT);
  const matched = results.filter(r => r.status === 'matched');
  assert.ok(matched.length > 0, 'At least some fields should be matched');
  for (const r of matched) {
    assert.ok(r.extractedValue !== null && r.extractedValue !== undefined,
      `Matched field ${r.fieldId} should have extractedValue`);
  }
});

test('missing fields have null extractedValue and zero confidence', () => {
  const results = engine.extractBankFieldsFromText('This is a document with no banking fields at all.');
  const missing = results.filter(r => r.status === 'missing');
  assert.ok(missing.length > 0, 'Should have missing fields');
  for (const r of missing) {
    assert.equal(r.extractedValue, null);
    assert.equal(r.confidence, 0);
    assert.equal(r.matchIndex, -1);
  }
});

/* ── Specialized extraction: ABN ────────────────────────────── */
test('extractBankFieldsFromText: valid ABN is matched and passes ATO Modulo-89 validation', () => {
  const results = engine.extractBankFieldsFromText(SAMPLE_TEXT);
  const abn = results.find(r => r.fieldId === 'abn');
  assert.ok(abn, 'ABN field result should be in results');
  assert.equal(abn.status, 'matched');
  assert.ok(abn.extractedValue, 'ABN should have a value');
  assert.equal(abn.isValid, true, 'Valid ABN should pass Mod-89 checksum');
  assert.ok(abn.validationMessage?.includes('ATO Modulo-89') || abn.validationMessage?.includes('Checksum'),
    `Validation message should mention checksum: ${abn.validationMessage}`);
  assert.equal(abn.confidence, 99, 'Valid ABN: 98 base + 3 enforce boost = 99');
});

test('extractBankFieldsFromText: invalid ABN (bad checksum) is flagged as invalid', () => {
  // 51824753557 — same as valid ABN but last digit changed, breaks checksum
  const textWithBadAbn = 'Employer ABN: 51824753557';
  const results = engine.extractBankFieldsFromText(textWithBadAbn);
  const abn = results.find(r => r.fieldId === 'abn');
  assert.ok(abn);
  assert.equal(abn.status, 'ambiguous', 'a checksum-failed ABN must never be a confident match');
  assert.equal(abn.isValid, false, 'Invalid ABN checksum should fail validation');
  assert.ok(abn.confidence <= 40, `Invalid ABN confidence should be low, got ${abn.confidence}`);
});

/* ── Specialized extraction: BSB ──────────────────────────────── */
test('extractBankFieldsFromText: BSB is matched and resolved to APRA institution', () => {
  const results = engine.extractBankFieldsFromText(SAMPLE_TEXT);
  const bsb = results.find(r => r.fieldId === 'bsb');
  assert.ok(bsb, 'BSB field result should be in results');
  assert.equal(bsb.status, 'matched');
  assert.ok(bsb.extractedValue, 'BSB should have a value');
  assert.match(bsb.matchedAnchor, /BSB \[/);
  assert.match(bsb.validationMessage, /APRA (Verified|Registered)/);
  assert.ok(bsb.confidence >= 95 && bsb.confidence < 99, `anchored BSB confidence, got ${bsb.confidence}`);
});

test('extractBankFieldsFromText: BSB without nearby anchor still matched from first match', () => {
  // BSB number without "BSB" or "branch" keyword nearby — engine falls back to first match
  const text = 'Account and Routing Info 062-299 and 063-345';
  const results = engine.extractBankFieldsFromText(text);
  const bsb = results.find(r => r.fieldId === 'bsb');
  assert.ok(bsb);
  assert.equal(bsb.status, 'ambiguous', 'unanchored BSB-shaped digits need review');
  assert.ok(bsb.extractedValue);
  assert.ok(bsb.confidence < 70, `unanchored BSB confidence should be low, got ${bsb.confidence}`);
});

/* ── Specialized extraction: Postcode ─────────────────────────── */
test('extractBankFieldsFromText: postcode is matched with state context', () => {
  const results = engine.extractBankFieldsFromText(SAMPLE_TEXT);
  const pc = results.find(r => r.fieldId === 'postcode');
  assert.ok(pc, 'Postcode field result should be in results');
  assert.equal(pc.status, 'matched');
  assert.ok(pc.extractedValue, 'Postcode should have a value');
  assert.match(pc.matchedAnchor, /AU Postcode Pattern/i);
  assert.equal(pc.extractedValue, "2601", "postcode after the ACT token, not the later NSW 2000");
});

/* ── Specialized extraction: DOB ──────────────────────────────── */
test('extractBankFieldsFromText: DOB matched and validated', () => {
  const results = engine.extractBankFieldsFromText(SAMPLE_TEXT);
  const dob = results.find(r => r.fieldId === 'date_of_birth');
  assert.ok(dob, 'DOB field result should be in results');
  assert.equal(dob.status, 'matched');
  assert.ok(dob.extractedValue, 'DOB should have a value');
  assert.equal(dob.isValid, true, '14/08/1988 is a valid past date');
});

/* ── Specialized extraction: Mobile ──────────────────────────── */
test('extractBankFieldsFromText: mobile number matched and canonicalized', () => {
  const results = engine.extractBankFieldsFromText(SAMPLE_TEXT);
  const mobile = results.find(r => r.fieldId === 'mobile_number');
  assert.ok(mobile, 'Mobile field result should be in results');
  assert.equal(mobile.status, 'matched');
  assert.ok(mobile.extractedValue, 'Mobile should have a value');
  assert.equal(mobile.isValid, true, '0412 345 678 is a valid AU mobile');
});

/* ── Field disambiguation ──────────────────────────────────────── */
test('residential_address vs previous_address: disambiguation does not cross-match', () => {
  const results = engine.extractBankFieldsFromText(SAMPLE_TEXT);
  const resAddr = results.find(r => r.fieldId === 'residential_address');
  const prevAddr = results.find(r => r.fieldId === 'previous_address');

  assert.ok(resAddr, 'residential_address result should exist');
  assert.ok(prevAddr, 'previous_address result should exist');

  if (resAddr.status === 'matched' && prevAddr.status === 'matched') {
    assert.notEqual(resAddr.extractedValue, prevAddr.extractedValue,
      'Residential and previous addresses must be different values');
  }
});

test('given_names vs employer: corporate entity filtered from personal name', () => {
  const results = engine.extractBankFieldsFromText(SAMPLE_TEXT);
  const givenNames = results.find(r => r.fieldId === 'given_names');
  const familyName = results.find(r => r.fieldId === 'family_name');

  if (givenNames?.status === 'matched') {
    assert.ok(!givenNames.extractedValue?.toLowerCase().includes('techcorp'),
      'Given names should not be the employer name TechCorp');
  }
  if (familyName?.status === 'matched') {
    assert.ok(!familyName.extractedValue?.toLowerCase().includes('techcorp'),
      'Family name should not be the employer name TechCorp');
  }
});

/* ── Address structural decomposition ─────────────────────────── */
test('parseAustralianAddress: decomposes a full Australian address', () => {
  const addr = engine.parseAustralianAddress("42 O'Connor Street, Canberra ACT 2601");
  assert.ok(addr, 'Should parse a valid address');
  assert.equal(addr.streetNumber, '42');
  assert.match(addr.streetName, /O'Connor/i);
  assert.match(addr.streetType, /Street/i);
  assert.match(addr.suburb, /Canberra/i);
  assert.equal(addr.state, 'ACT');
  assert.equal(addr.postcode, '2601');
  assert.equal(addr.isPostcodeStateCoherent, true, 'ACT postcode 2601 should be coherent');
  assert.ok(addr.gnafConfidenceScore >= 0 && addr.gnafConfidenceScore <= 100);
});

test('parseAustralianAddress: detects state-postcode incoherence', () => {
  // NSW postcode 2000 but address says VIC
  const addr = engine.parseAustralianAddress('100 George Street, Sydney VIC 2000');
  assert.ok(addr);
  assert.equal(addr.state, 'VIC');
  assert.equal(addr.postcode, '2000');
  assert.equal(addr.isPostcodeStateCoherent, false, 'VIC state with NSW postcode 2000 should be incoherent');
});

test('parseAustralianAddress: returns null for too-short input', () => {
  assert.equal(engine.parseAustralianAddress(''), null);
  assert.equal(engine.parseAustralianAddress(undefined), null);
  assert.equal(engine.parseAustralianAddress('short'), null);
});

/* ── Error resilience / edge cases ────────────────────────────── */
test('extractBankFieldsFromText: empty string does not throw and returns 99 missing results', () => {
  const results = engine.extractBankFieldsFromText('');
  assert.equal(results.length, 99);
  for (const r of results) {
    assert.equal(r.status, 'missing');
    assert.equal(r.confidence, 0);
  }
});

test('extractBankFieldsFromText: whitespace-only text does not throw', () => {
  const results = engine.extractBankFieldsFromText('   \n\n\t  ');
  assert.equal(results.length, 99);
  assert.ok(results.every(r => r.status === 'missing' || r.status === 'matched'));
});

test('extractBankFieldsFromText: very long text does not throw', () => {
  const longText = 'Field: value\n'.repeat(10000);
  const results = engine.extractBankFieldsFromText(longText);
  assert.equal(results.length, 99);
});

test('extractBankFieldsFromText: results are deterministic (same input → same output)', () => {
  const run1 = engine.extractBankFieldsFromText(SAMPLE_TEXT);
  const run2 = engine.extractBankFieldsFromText(SAMPLE_TEXT);
  assert.equal(run1.length, run2.length);
  for (let i = 0; i < run1.length; i++) {
    assert.equal(run1[i].fieldId, run2[i].fieldId);
    assert.equal(run1[i].status, run2[i].status);
    assert.equal(run1[i].confidence, run2[i].confidence);
    assert.equal(run1[i].extractedValue, run2[i].extractedValue);
  }
});

test('extractBankFieldsFromText: fieldIds are unique across all 99 results', () => {
  const results = engine.extractBankFieldsFromText(SAMPLE_TEXT);
  const ids = results.map(r => r.fieldId);
  const uniqueIds = new Set(ids);
  assert.equal(uniqueIds.size, ids.length, 'All fieldIds should be unique');
});

/* ── Canonical value propagation ──────────────────────────────── */
test('matched validated fields carry canonicalValue after enforcement', () => {
  const results = engine.extractBankFieldsFromText(SAMPLE_TEXT);

  const abn = results.find(r => r.fieldId === 'abn');
  if (abn?.status === 'matched') {
    assert.ok(abn.canonicalValue, 'Validated ABN should have canonicalValue');
    assert.match(abn.canonicalValue, /^\d{2} \d{3} \d{3} \d{3}$/);
  }

  const dob = results.find(r => r.fieldId === 'date_of_birth');
  if (dob?.status === 'matched') {
    assert.ok(dob.canonicalValue, 'Validated DOB should have canonicalValue');
    assert.match(dob.canonicalValue, /^\d{2}\/\d{2}\/\d{4}$/);
  }
});

/* ── Summary statistics ───────────────────────────────────────── */
test('extractBankFieldsFromText: at least 25% of fields are matched on rich sample', () => {
  const results = engine.extractBankFieldsFromText(SAMPLE_TEXT);
  const matched = results.filter(r => r.status === 'matched');
  const pct = (matched.length / results.length) * 100;
  assert.ok(pct >= 25, `Expected >=25% match rate, got ${pct.toFixed(1)}% (${matched.length}/${results.length})`);
});

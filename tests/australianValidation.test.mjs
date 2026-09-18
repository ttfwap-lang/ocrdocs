/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for Australian validation utilities (src/utils/australianValidationUtility.ts).
 * Covers ABN Modulo-89 checksum, BSB APRA lookup, postcode state allocation,
 * DOB calendar/leap-year/future-date validation, mobile/landline phone formats,
 * and the validateAustralianField dispatcher + enforceAustralianFormattingRules pipeline.
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

let mod;

test('Australian Validation Utility — suite bootstrap', async () => {
  mod = await loadModule('src/utils/australianValidationUtility.ts');
  assert.equal(typeof mod.validateAustralianDob, 'function');
  assert.equal(typeof mod.validateAustralianPostcode, 'function');
  assert.equal(typeof mod.validateAustralianAbn, 'function');
  assert.equal(typeof mod.validateAustralianBsb, 'function');
  assert.equal(typeof mod.validateAustralianMobilePhone, 'function');
  assert.equal(typeof mod.validateAustralianField, 'function');
  assert.equal(typeof mod.enforceAustralianFormattingRules, 'function');
});

/* ───────────────────────────────────────────────────────── DOB ── */
test('validateAustralianDob: valid DD/MM/YYYY returns valid with correct canonical date and age', () => {
  const res = mod.validateAustralianDob('14/08/1988');
  assert.equal(res.isValid, true);
  assert.equal(res.canonicalDate, '14/08/1988');
  assert.equal(res.day, 14);
  assert.equal(res.month, 8);
  assert.equal(res.year, 1988);
  assert.ok(typeof res.age === 'number' && res.age > 0);
});

test('validateAustralianDob: accepts alternative separators (dash, dot, space)', () => {
  assert.equal(mod.validateAustralianDob('14-08-1988').isValid, true);
  assert.equal(mod.validateAustralianDob('14.08.1988').isValid, true);
  assert.equal(mod.validateAustralianDob('14 08 1988').isValid, true);
});

test('validateAustralianDob: accepts month-name formats (full and abbreviated)', () => {
  assert.equal(mod.validateAustralianDob('14 August 1988').isValid, true);
  assert.equal(mod.validateAustralianDob('14 Aug 1988').isValid, true);
  assert.equal(mod.validateAustralianDob('14-Aug-1988').isValid, true);
  assert.equal(mod.validateAustralianDob('1 Jan 2000').isValid, true);
});

test('validateAustralianDob: 2-digit year conversion (>30 → 1900s, ≤30 → 2000s)', () => {
  const res88 = mod.validateAustralianDob('14/08/88');
  assert.equal(res88.isValid, true);
  assert.equal(res88.year, 1988);

  const res05 = mod.validateAustralianDob('14/08/05');
  assert.equal(res05.isValid, true);
  assert.equal(res05.year, 2005);
});

test('validateAustralianDob: leap-year Feb 29 accepted on leap years, rejected on non-leap', () => {
  assert.equal(mod.validateAustralianDob('29/02/2000').isValid, true);
  assert.equal(mod.validateAustralianDob('29/02/2021').isValid, false);
});

test('validateAustralianDob: invalid calendar date (e.g. 31 April)', () => {
  const res = mod.validateAustralianDob('31/04/2000');
  assert.equal(res.isValid, false);
  assert.equal(res.errorCode, 'INVALID_CALENDAR_DATE');
});

test('validateAustralianDob: future date rejected', () => {
  const futureYear = new Date().getFullYear() + 5;
  const res = mod.validateAustralianDob(`01/01/${futureYear}`);
  assert.equal(res.isValid, false);
  assert.equal(res.errorCode, 'FUTURE_DATE');
});

test('validateAustralianDob: year before 1900 rejected as OUT_OF_RANGE', () => {
  const res = mod.validateAustralianDob('01/01/1850');
  assert.equal(res.isValid, false);
  assert.equal(res.errorCode, 'OUT_OF_RANGE');
});

test('validateAustralianDob: invalid month (13) and invalid day (0/32) rejected', () => {
  assert.equal(mod.validateAustralianDob('14/13/1988').isValid, false);
  assert.equal(mod.validateAustralianDob('0/08/1988').isValid, false);
  assert.equal(mod.validateAustralianDob('32/08/1988').isValid, false);
});

test('validateAustralianDob: empty / whitespace-only / garbage format rejected', () => {
  assert.equal(mod.validateAustralianDob('').isValid, false);
  assert.equal(mod.validateAustralianDob('   ').isValid, false);
  assert.equal(mod.validateAustralianDob('not-a-date').isValid, false);
  assert.equal(mod.validateAustralianDob('2024/01/01').isValid, false); // YYYY/MM/DD not supported
});

/* ──────────────────────────────────────────────────────────── Postcode ── */
test('validateAustralianPostcode: valid NSW postcode returns valid with state allocation', () => {
  const res = mod.validateAustralianPostcode('2000');
  assert.equal(res.isValid, true);
  assert.equal(res.canonicalPostcode, '2000');
  assert.equal(res.allocatedState, 'NSW');
  assert.equal(res.isStateCoherent, true);
});

test('validateAustralianPostcode: valid postcodes for all states/territories', () => {
  const samples = {
    '2601': 'ACT',
    '3000': 'VIC',
    '4000': 'QLD',
    '5000': 'SA',
    '6000': 'WA',
    '7000': 'TAS',
    '0800': 'NT',
  };
  for (const [pc, state] of Object.entries(samples)) {
    const res = mod.validateAustralianPostcode(pc);
    assert.equal(res.isValid, true, `${pc} should be valid`);
    assert.equal(res.allocatedState, state, `${pc} should allocate to ${state}`);
  }
});

test('validateAustralianPostcode: non-4-digit or out-of-range postcode rejected', () => {
  assert.equal(mod.validateAustralianPostcode('123').isValid, false);
  assert.equal(mod.validateAustralianPostcode('12345').isValid, false);
  assert.equal(mod.validateAustralianPostcode('0199').isValid, false); // below 200
  assert.equal(mod.validateAustralianPostcode('0000').isValid, false);
  assert.equal(mod.validateAustralianPostcode('').isValid, false);
});

test('validateAustralianPostcode: state-context mismatch detected', () => {
  const res = mod.validateAustralianPostcode('2000', 'VIC');
  assert.equal(res.isValid, false);
  assert.equal(res.errorCode, 'STATE_MISMATCH');
  assert.equal(res.isStateCoherent, false);
});

test('validateAustralianPostcode: state-context match is coherent', () => {
  const res = mod.validateAustralianPostcode('2000', 'NSW');
  assert.equal(res.isValid, true);
  assert.equal(res.isStateCoherent, true);
});

test('validateAustralianPostcode: non-numeric characters rejected (strict 4 digits)', () => {
  const res = mod.validateAustralianPostcode('20A0');
  assert.equal(res.isValid, false);
  assert.equal(res.errorCode, 'NOT_4_DIGITS');
});

/* ──────────────────────────────────────────────────────────── ABN ── */
test('validateAustralianAbn: valid ABN passes Modulo-89 checksum', () => {
  // ABN 51 824 753 556 — verified to pass ATO Modulo-89
  const res = mod.validateAustralianAbn('51824753556');
  assert.equal(res.isValid, true);
  assert.equal(res.remainder, 0);
  assert.equal(res.canonicalAbn, '51 824 753 556');
});

test('validateAustralianAbn: valid ABN with spaces accepted', () => {
  assert.equal(mod.validateAustralianAbn('51 824 753 556').isValid, true);
  assert.equal(mod.validateAustralianAbn('51-824-753-556').isValid, true);
});

test('validateAustralianAbn: checksum failure detected', () => {
  // Change last digit from 6 to 7 — breaks checksum
  const res = mod.validateAustralianAbn('51824753557');
  assert.equal(res.isValid, false);
  assert.equal(res.errorCode, 'CHECKSUM_FAILED');
  assert.ok(res.remainder !== 0);
});

test('validateAustralianAbn: leading zero rejected', () => {
  const res = mod.validateAustralianAbn('01824753556');
  assert.equal(res.isValid, false);
  assert.equal(res.errorCode, 'INVALID_LEADING_ZERO');
});

test('validateAustralianAbn: wrong length rejected', () => {
  assert.equal(mod.validateAustralianAbn('123').isValid, false);
  assert.equal(mod.validateAustralianAbn('12345678901234567890').isValid, false);
  assert.equal(mod.validateAustralianAbn('').isValid, false);
});

/* ──────────────────────────────────────────────────────────── BSB ── */
test('validateAustralianBsb: valid BSB resolves to APRA institution', () => {
  const res = mod.validateAustralianBsb('062299');
  assert.equal(res.isValid, true);
  assert.equal(res.canonicalBsb, '062-299');
  assert.ok(res.institutionName, 'Should resolve an institution name');
  assert.ok(res.stateRegion, 'Should resolve a state region');
});

test('validateAustralianBsb: known prefix maps to correct bank', () => {
  // '06' prefix → Commonwealth Bank of Australia (CBA)
  const res = mod.validateAustralianBsb('062-299');
  assert.equal(res.isValid, true);
  assert.match(res.institutionName, /Commonwealth Bank/);
});

test('validateAustralianBsb: 73x prefix maps to St.George', () => {
  const res = mod.validateAustralianBsb('732-190');
  assert.equal(res.isValid, true);
  assert.match(res.institutionName, /St\.George/);
});

test('validateAustralianBsb: 000000 reserved code rejected', () => {
  const res = mod.validateAustralianBsb('000000');
  assert.equal(res.isValid, false);
  assert.equal(res.errorCode, 'RESERVED_CODE');
});

test('validateAustralianBsb: non-6-digit input rejected', () => {
  assert.equal(mod.validateAustralianBsb('12345').isValid, false);
  assert.equal(mod.validateAustralianBsb('1234567').isValid, false);
  assert.equal(mod.validateAustralianBsb('').isValid, false);
});

/* ──────────────────────────────────────────────────── Phone ── */
test('validateAustralianMobilePhone: valid mobile (04xx xxx xxx) accepted', () => {
  const res = mod.validateAustralianMobilePhone('0412345678');
  assert.equal(res.isValid, true);
  assert.equal(res.phoneType, 'mobile');
  assert.equal(res.canonicalPhone, '0412 345 678');
});

test('validateAustralianMobilePhone: valid landline (02/03/07/08 prefix) accepted', () => {
  const res = mod.validateAustralianMobilePhone('0298765432');
  assert.equal(res.isValid, true);
  assert.equal(res.phoneType, 'landline');
});

test('validateAustralianMobilePhone: international format +61 converted', () => {
  const res = mod.validateAustralianMobilePhone('+61 412 345 678');
  assert.equal(res.isValid, true);
  assert.equal(res.phoneType, 'mobile');
});

test('validateAustralianMobilePhone: invalid formats rejected', () => {
  assert.equal(mod.validateAustralianMobilePhone('123456789').isValid, false);
  assert.equal(mod.validateAustralianMobilePhone('').isValid, false);
  assert.equal(mod.validateAustralianMobilePhone('041234567890123').isValid, false);
});

/* ──────────────────────────────────────────────────── Field Dispatcher ── */
test('validateAustralianField: dispatches to correct validator by fieldId', () => {
  assert.match(mod.validateAustralianField('date_of_birth', '14/08/1988').validationMessage, /Valid Australian DOB/);
  assert.match(mod.validateAustralianField('postcode', '2000').validationMessage, /Valid 4-digit AU Postcode/);
  assert.match(mod.validateAustralianField('abn', '51824753556').validationMessage, /ATO Modulo-89/);
  assert.match(mod.validateAustralianField('bsb', '062299').validationMessage, /APRA/);
});

test('validateAustralianField: empty value returns AU_GENERAL error', () => {
  const res = mod.validateAustralianField('postcode', '');
  assert.equal(res.isValid, false);
  assert.equal(res.validationDetails.ruleCode, 'AU_GENERAL');
});

test('validateAustralianField: unknown fieldId passes through as valid (passthrough)', () => {
  // Fields not in the switch fall through to a passthrough "valid" result
  const res = mod.validateAustralianField('unknown_field', 'some value');
  assert.equal(res.isValid, true);
  assert.equal(res.validationMessage, 'Format OK');
});

/* ──────────────────────────────────────────────────── enforceAustralianFormattingRules ── */
test('enforceAustralianFormattingRules: returns same-length array and enriches valid results', () => {
  const sampleResults = [
    {
      fieldId: 'abn',
      fieldName: 'ABN',
      category: 'identity',
      matchedAnchor: 'ABN',
      extractedValue: '51824753556',
      confidence: 90,
      matchIndex: 0,
      regexPattern: '.*',
      status: 'matched',
    },
    {
      fieldId: 'date_of_birth',
      fieldName: 'Date of Birth',
      category: 'identity',
      matchedAnchor: 'DOB',
      extractedValue: '14/08/1988',
      confidence: 90,
      matchIndex: 10,
      regexPattern: '.*',
      status: 'matched',
    },
    {
      fieldId: 'postcode',
      fieldName: 'Postcode',
      category: 'residential',
      matchedAnchor: 'Postcode',
      extractedValue: '2000',
      confidence: 90,
      matchIndex: 20,
      regexPattern: '.*',
      status: 'matched',
    },
    {
      fieldId: 'missing_field',
      fieldName: 'Missing',
      category: 'identity',
      matchedAnchor: null,
      extractedValue: null,
      confidence: 0,
      matchIndex: -1,
      regexPattern: '.*',
      status: 'missing',
    },
  ];

  const result = mod.enforceAustralianFormattingRules(sampleResults);
  assert.equal(result.length, 4);

  // ABN should be validated and canonicalized
  assert.equal(result[0].isValid, true);
  assert.ok(result[0].canonicalValue);

  // DOB should be validated
  assert.equal(result[1].isValid, true);

  // Postcode should be validated and canonicalized
  assert.equal(result[2].isValid, true);
  assert.ok(result[2].canonicalValue);

  // Missing field should remain missing without crashing
  assert.equal(result[3].status, 'missing');
  assert.equal(result[3].extractedValue, null);
});

test('enforceAustralianFormattingRules: invalid ABN marked as invalid', () => {
  const sampleResults = [
    {
      fieldId: 'abn',
      fieldName: 'ABN',
      category: 'identity',
      matchedAnchor: 'ABN',
      extractedValue: '51824753557', // Invalid checksum
      confidence: 90,
      matchIndex: 0,
      regexPattern: '.*',
      status: 'matched',
    },
  ];

  const result = mod.enforceAustralianFormattingRules(sampleResults);
  assert.equal(result[0].isValid, false);
});

test('enforceAustralianFormattingRules: idempotency — calling twice yields same result', () => {
  const sampleResults = [
    {
      fieldId: 'abn',
      fieldName: 'ABN',
      category: 'identity',
      matchedAnchor: 'ABN',
      extractedValue: '51824753556',
      confidence: 90,
      matchIndex: 0,
      regexPattern: '.*',
      status: 'matched',
    },
  ];

  const first = mod.enforceAustralianFormattingRules(sampleResults);
  const second = mod.enforceAustralianFormattingRules(first);
  assert.equal(second.length, first.length);
  assert.equal(second[0].isValid, first[0].isValid);
});

test('validateAustralianDob: under minimum age is rejected as UNDERAGE; over 120 rejected; ambiguity flagged', () => {
  const y = new Date().getFullYear();
  const young = mod.validateAustralianDob(`01/01/${y - 5}`);
  assert.equal(young.isValid, false);
  assert.equal(young.errorCode, 'UNDERAGE');
  assert.equal(mod.validateAustralianDob(`01/01/${y - 121}`).isValid, false);
  assert.equal(mod.validateAustralianDob('05/08/1990').ambiguousOrder, true);
  assert.equal(mod.validateAustralianDob('25/08/1990').ambiguousOrder, false);
});

/**
 * Regression suite for Australian identifier false detections:
 * cross-identifier collisions (ABN/phone read as BSB), unanchored sweeps,
 * value-typed structural fields, and the TFN/ACN/Medicare/Luhn checksums.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function loadModule(relPath) {
  const result = await esbuild.build({
    entryPoints: [path.join(project, relPath)],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    packages: 'external',
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

const engine = await loadModule('src/utils/ocrMatcherEngine');
const val = await loadModule('src/utils/australianValidationUtility');
const get = (text, id) => engine.extractBankFieldsFromText(text).find((r) => r.fieldId === id);

test('ABN digit groups are not re-read as a BSB', () => {
  const bsb = get('Employer ABN: 51 824 753 556', 'bsb');
  assert.notEqual(bsb.extractedValue, '824 753');
  assert.equal(bsb.status, 'missing');
});

test('phone tail is not re-read as a BSB', () => {
  const bsb = get('Mobile: 0412 345 678', 'bsb');
  assert.notEqual(bsb.extractedValue, '345 678');
});

test('an anchored BSB still wins next to an ABN and a phone', () => {
  const bsb = get('ABN 51 824 753 556\nMobile 0412 345 678\nBSB: 062-299', 'bsb');
  assert.equal(bsb.extractedValue, '062-299');
  assert.ok(bsb.confidence >= 90);
});

test('a valid ABN beats a keyword-adjacent invalid one', () => {
  const abn = get('Business number 51 824 753 557 (old)\nABN 51 824 753 556', 'abn');
  assert.equal(abn.extractedValue.replace(/\s/g, ''), '51824753556');
  assert.equal(abn.isValid, true);
});

test('a 16-digit card number does not yield an ABN', () => {
  const abn = get('Card: 4532 0151 1283 0366', 'abn');
  assert.notEqual(abn.status, 'matched');
});

test('postcode: years, amounts and DOB are not postcodes; state-anchored code is', () => {
  assert.equal(get('DOB: 14/08/1988 paid $5000 in 2019', 'postcode').status, 'missing');
  assert.equal(get('42 Smith St, Bondi NSW 2026', 'postcode').extractedValue, '2026');
  assert.equal(get('was 1234 current visa', 'postcode').status, 'missing');
});

test('structural fields need their label: TFN / ACN / Medicare are extracted, not cross-claimed', () => {
  const text = 'TFN: 123 456 782\nACN: 102 443 916\nMedicare Number: 2123 45670 1\nAccount Number: 12345678';
  assert.equal(get(text, 'tfn').extractedValue, '123 456 782');
  assert.equal(get(text, 'acn').extractedValue, '102 443 916');
  assert.equal(get(text, 'medicare_number').extractedValue.replace(/\s/g, '').slice(0, 9), '212345670');
  assert.equal(get(text, 'account_number').extractedValue, '12345678');
});

test('a lone ABN does not populate TFN / ACN / account number', () => {
  const text = 'ABN 51 824 753 556';
  for (const id of ['tfn', 'acn', 'account_number', 'medicare_number']) {
    assert.equal(get(text, id).status, 'missing', id);
  }
});

test('checksums: TFN / ACN / Medicare / Luhn accept known-good and reject known-bad', () => {
  assert.equal(val.validateAustralianTfn('123 456 782').isValid, true);
  assert.equal(val.validateAustralianTfn('123 456 783').isValid, false);
  assert.equal(val.validateAustralianAcn('102 443 916').isValid, true);
  assert.equal(val.validateAustralianAcn('102 443 917').isValid, false);
  assert.equal(val.validateAustralianMedicare('2123 45670 1').isValid, true);
  assert.equal(val.validateAustralianMedicare('2123 45671 1').isValid, false);
  assert.equal(val.validateAustralianMedicare('1123 45670 1').isValid, false);
  assert.equal(val.validateCardLuhn('4532 0151 1283 0366').isValid, true);
  assert.equal(val.validateCardLuhn('4532 0151 1283 0367').isValid, false);
  assert.equal(val.validateCardLuhn('4532 **** **** 1234').isValid, true);
});

test('OCR repair: confusable letters in an ABN are repaired only when the repaired ABN passes the checksum', () => {
  const ok = get('ABN: 5l 824 753 556', 'abn'); // l -> 1 gives 51 824 753 556
  assert.equal(ok.extractedValue.replace(/\s/g, ''), '51824753556');
  assert.equal(ok.isValid, true);
  assert.match(ok.disambiguation.notes, /ocr_repaired: true/);
  // repair that does not checksum-validate is NOT accepted
  assert.notEqual(get('ABN: 5l 824 753 55B', 'abn').status, 'matched');
  // ordinary words are never "repaired" into an ABN
  assert.notEqual(get('SOBBLIBOBBB ILLIBOBSBSB', 'abn').status, 'matched');
});

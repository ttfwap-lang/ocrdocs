/** vlm_v2 field merge: Qwen values validated against, and reconciled with, the regex extraction of the same text. */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const built = await esbuild.build({
  entryPoints: [path.join(project, 'server/services/vlmFieldMerge.ts')],
  bundle: true, write: false, format: 'esm', platform: 'node',
});
const m = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);

// Minimal regex-result fixtures; toField mirrors server.ts toExtractedField.
const res = (fieldId, value, extra = {}) => ({
  fieldId, fieldName: fieldId, category: 'identity', matchedAnchor: null, extractedValue: value,
  confidence: value ? 0.8 : 0, matchIndex: 0, regexPattern: '', status: value ? 'matched' : 'missing', ...extra,
});
const toField = (r) => ({
  name: r.fieldName, value: r.extractedValue, confidence: r.confidence, sourceSection: null,
  validated: false, validationStatus: 'pending', correctedValue: null, approved: false, category: r.category,
});
const vf = (name, value, o = {}) => ({ name, value, source: 'handwriting', confidence: 0.85, digitsVerified: true, evidence: '', ...o });
const byName = (fields, name) => fields.find((f) => f.name === name);

test('a field the regex missed takes the Qwen value and stays pending for review', () => {
  const out = m.mergeVlmFields([res('family_name', null)], [vf('family_name', 'Nguyen')], toField);
  const f = byName(out, 'family_name');
  assert.equal(f.value, 'Nguyen');
  assert.equal(f.validationStatus, 'pending');
  assert.match(f.sourceSection, /Qwen \(handwriting\)/);
});

test('agreeing readers raise confidence and change nothing else', () => {
  const out = m.mergeVlmFields([res('family_name', 'NGUYEN')], [vf('family_name', 'Nguyen', { confidence: 0.95 })], toField);
  const f = byName(out, 'family_name');
  assert.equal(f.value, 'NGUYEN');
  assert.equal(f.confidence, 0.95);
});

test('disagreement takes the Qwen value but warns and names the regex reading', () => {
  const out = m.mergeVlmFields([res('family_name', 'Nguyan')], [vf('family_name', 'Nguyen')], toField);
  const f = byName(out, 'family_name');
  assert.equal(f.value, 'Nguyen');
  assert.equal(f.validationStatus, 'warning');
  assert.ok(f.confidence <= 0.6);
  assert.match(f.sourceSection, /Regex read "Nguyan"/);
});

test('a Qwen value whose digits no OCR engine read never overrides the regex reading', () => {
  const out = m.mergeVlmFields([res('bsb', '062-000')], [vf('bsb', '062-999', { digitsVerified: false })], toField);
  assert.equal(byName(out, 'bsb').value, '062-000');
});

test('form label text and wrong-shape values are rejected', () => {
  const out = m.mergeVlmFields(
    [res('given_names', null), res('email_address', null)],
    [vf('given_names', 'Given names (in full)'), vf('email_address', 'not an email')],
    toField,
  );
  assert.equal(byName(out, 'given_names').value, null);
  assert.equal(byName(out, 'email_address').value, null);
});

test('the drivers_licence_number alias maps to drivers_licence', () => {
  const out = m.mergeVlmFields([res('drivers_licence', null)], [vf('drivers_licence_number', '12345678', { source: 'print' })], toField);
  assert.equal(byName(out, 'drivers_licence').value, '12345678');
});

test('account and tax file numbers, which the regex catalogue lacks, are appended as unvalidated extras', () => {
  const out = m.mergeVlmFields([res('bsb', null)], [vf('account_number', '12345678'), vf('tax_file_number', '123456782', { digitsVerified: false })], toField);
  const acct = byName(out, 'Account Number');
  const tfn = byName(out, 'Tax File Number');
  assert.equal(acct.value, '12345678');
  assert.equal(acct.validated, false);
  assert.equal(tfn.validationStatus, 'warning');
});

test('the highest-confidence reading of a field wins over a weaker duplicate', () => {
  const out = m.mergeVlmFields([res('family_name', null)], [vf('family_name', 'Low', { confidence: 0.4 }), vf('family_name', 'High', { confidence: 0.9 })], toField);
  assert.equal(byName(out, 'family_name').value, 'High');
});

test('unknown field ids are ignored', () => {
  const out = m.mergeVlmFields([res('bsb', null)], [vf('favourite_colour', 'blue')], toField);
  assert.equal(out.length, 1);
});

test('parseVlmFields keeps only well-formed entries, clamps confidence and caps the count', () => {
  assert.deepEqual(m.parseVlmFields('nope'), []);
  const parsed = m.parseVlmFields([
    { name: 'bsb', value: ' 062-000 ', source: 'print', confidence: 7, digits_verified: true, evidence: 'x' },
    { name: 'bsb', value: '   ' },
    { name: 5, value: 'x' },
    null,
    { name: 'family_name', value: 'Lee' },
  ]);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].value, '062-000');
  assert.equal(parsed[0].confidence, 1);
  assert.equal(parsed[0].digitsVerified, true);
  assert.equal(parsed[1].source, 'print');
  assert.equal(parsed[1].digitsVerified, null);
  const many = Array.from({ length: 1000 }, () => ({ name: 'bsb', value: '1' }));
  assert.equal(m.parseVlmFields(many).length, 400);
});

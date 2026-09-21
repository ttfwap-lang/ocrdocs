/** The LlamaCloud extraction schema and classify rules stay derived from, and consistent with, the rest of the app. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gen = await import(pathToFileURL(path.join(project, 'scripts', 'build_extract_schema.mjs')).href);
const committed = JSON.parse(fs.readFileSync(path.join(project, 'scripts', 'llamacloud', 'extract_schema.json'), 'utf8'));
const rules = JSON.parse(fs.readFileSync(path.join(project, 'scripts', 'llamacloud', 'classify_rules.json'), 'utf8'));
const merge = await (async () => {
  const b = await esbuild.build({ entryPoints: [path.join(project, 'server/services/vlmFieldMerge.ts')], bundle: true, write: false, format: 'esm', platform: 'node' });
  return import(`data:text/javascript;base64,${Buffer.from(b.outputFiles[0].text).toString('base64')}`);
})();

test('the committed schema is exactly what the generator builds from the regex catalogue (run scripts/build_extract_schema.mjs if this fails)', async () => {
  assert.deepEqual(committed, JSON.parse(JSON.stringify(await gen.buildSchema())));
});

test('every catalogue field id is an applicant property, plus the account and tax file number extras', async () => {
  const defs = await gen.loadCatalogue();
  const props = Object.keys(committed.data_schema.properties.applicant.properties);
  for (const d of defs) assert.ok(props.includes(d.id), `missing ${d.id}`);
  assert.ok(props.includes('account_number') && props.includes('tax_file_number'));
  const extrasNotInCatalogue = ['account_number', 'tax_file_number'].filter(id => !defs.some(d => d.id === id));
  assert.equal(props.length, defs.length + extrasNotInCatalogue.length);
});

test('every field is a nullable string with a description that carries the printed labels', async () => {
  const defs = await gen.loadCatalogue();
  const props = committed.data_schema.properties.applicant.properties;
  for (const d of defs) {
    assert.deepEqual(props[d.id].type, ['string', 'null']);
    for (const label of d.exampleLabels ?? []) assert.ok(props[d.id].description.includes(label), `${d.id} lacks label ${label}`);
    assert.doesNotMatch(props[d.id].description, /regex|catches|token/i);
  }
});

test("other people carry a relationship enum and never the applicant-only fields", () => {
  const item = committed.data_schema.properties.other_people.items;
  assert.deepEqual(item.properties.relationship.enum, ['parent', 'spouse', 'dependant', 'employer', 'referee', 'other']);
  assert.deepEqual(item.required, ['relationship']);
  for (const id of ['given_names', 'family_name', 'occupation_industry']) assert.ok(item.properties[id]);
  for (const id of ['gross_annual_income', 'bsb', 'account_number']) assert.equal(item.properties[id], undefined);
});

test("the schema respects LlamaCloud's documented limits", () => {
  const s = committed.data_schema;
  assert.ok(gen.schemaDepth(s) <= 7);
  assert.ok(gen.countProperties(s) <= 5000);
  assert.ok(JSON.stringify(s).length <= 150000);
  assert.ok(gen.countProperties(s) < 250, 'schemas above 250 fields are billed at a higher rate');
});

test('classify rules cover exactly the document_type taxonomy, with unique legal type names and real descriptions', () => {
  assert.deepEqual(rules.rules.map(r => r.type), [...merge.DOCUMENT_TYPES]);
  assert.equal(new Set(rules.rules.map(r => r.type)).size, rules.rules.length);
  for (const r of rules.rules) {
    assert.match(r.type, /^[A-Za-z0-9 _-]+$/, `illegal rule type ${r.type}`);
    assert.ok(r.description.length >= 60, `${r.type} description too thin`);
  }
});

test('the system prompt states the owner rule and the never-guess rule', () => {
  assert.match(committed.system_prompt, /other_people/);
  assert.match(committed.system_prompt, /never guess/);
});

/**
 * TS <-> Python parity gate for the shared AU identifiers. Both engines run the
 * same corpus; each must satisfy the corpus `expect`, and the two must agree
 * (digits-normalised) on every shared field. Skips if python is unavailable.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const corpusPath = path.join(project, 'tests', 'fixtures', 'au_corpus.json');
const corpus = JSON.parse(fs.readFileSync(corpusPath, 'utf8'));
const SHARED = ['abn', 'bsb', 'mobile_number'];

const built = await esbuild.build({
  entryPoints: [path.join(project, 'src/utils/ocrMatcherEngine.ts')],
  bundle: true, write: false, format: 'esm', platform: 'node', packages: 'external',
});
const engine = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);

const norm = (v) => String(v ?? '').replace(/\D/g, '');
const dobNorm = (v) => String(v ?? '').replace(/\s/g, '');
const tsField = (text, id) => {
  const r = engine.extractBankFieldsFromText(text).find((x) => x.fieldId === id);
  return r && r.status !== 'missing' && r.status !== 'ambiguous' ? r.extractedValue : '';
};

let py = null;
for (const exe of ['python', 'python3']) {
  const r = spawnSync(exe, [path.join(project, 'scripts', 'parity_dump.py'), corpusPath], { encoding: 'utf8' });
  if (r.status === 0) { py = JSON.parse(r.stdout.trim().split('\n').pop()); break; }
}

for (const c of corpus) {
  test(`parity: ${c.id}`, (t) => {
    if (!py) return t.skip('python engine not runnable here');
    for (const [id, want] of Object.entries(c.expect)) {
      const n = id === 'date_of_birth' ? dobNorm : norm;
      const wantN = id === 'date_of_birth' ? want : norm(want);
      assert.equal(n(tsField(c.text, id)), wantN, `TS ${id}`);
      assert.equal(n(py[c.id][id]), wantN, `PY ${id}`);
    }
    for (const id of SHARED) {
      assert.equal(norm(tsField(c.text, id)), norm(py[c.id][id]), `TS/PY disagree on ${id}`);
    }
  });
}

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test('deployment suite has an explicit fail-fast command and production build', async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const packageJson = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  assert.match(packageJson.scripts['test:deployment'], /^node --test/);
  assert.equal(typeof packageJson.scripts.build, 'string');
  assert.equal(typeof packageJson.scripts.start, 'string');
  assert.doesNotMatch(packageJson.scripts['test:deployment'], /\|\||2>nul|>nul/i);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test('browser suite has an explicit fail-fast command', async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const packageJson = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  assert.match(packageJson.scripts['test:browser'], /^node --test/);
  assert.match(packageJson.scripts['test:browser'], /tests\/browser\/.*\.test\.mjs/);
  assert.doesNotMatch(packageJson.scripts['test:browser'], /\|\||2>nul|>nul/i);
});

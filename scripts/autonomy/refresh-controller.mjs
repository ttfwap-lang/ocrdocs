import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { refreshController } from './runner.mjs';

try {
  await refreshController(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'));
  console.log('Controller refreshed in stopped candidate; STOP, attempt budget and deadline preserved.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
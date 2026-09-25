import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const project = path.resolve(here, '..');
const temp = path.join(project, 'node_modules', '.cache', 'rear-licence-service-test');
fs.rmSync(temp, { recursive: true, force: true });
fs.mkdirSync(temp, { recursive: true });

async function loadService() {
  const outfile = path.join(temp, 'rearLicenceService.mjs');
  await esbuild.build({
    entryPoints: [path.join(project, 'server', 'services', 'rearLicenceService.ts')],
    bundle: true,
    write: true,
    outfile,
    format: 'esm',
    platform: 'node',
    packages: 'external',
  });
  return import(pathToFileURL(outfile).href);
}

test('rear licence service indexes by identity and document without exposing paths', async () => {
  const { createRearLicenceService } = await loadService();
  const root = path.join(temp, 'store');
  fs.mkdirSync(path.join(root, 'assets', 'cards'), { recursive: true });
  fs.writeFileSync(path.join(root, 'assets', 'cards', 'abc.jpg'), 'card');
  fs.writeFileSync(
    path.join(root, 'index.jsonl'),
    [
      JSON.stringify({
        occurrenceKey: 'occ-1',
        documentId: 'doc-1',
        identityId: 'id-1',
        assignmentState: 'assigned',
        verificationState: 'verified',
        document: 'licence.pdf',
        page: 2,
        part: '',
        cardAsset: 'assets/cards/abc.jpg',
        pageAsset: 'assets/cards/abc.jpg',
        bbox: [1, 2, 3, 4],
        modelDecision: 'confirmed',
        modelConfidence: 0.95,
      }),
      JSON.stringify({
        occurrenceKey: 'occ-review',
        documentId: 'doc-2',
        identityId: null,
        assignmentState: 'needs_review',
        verificationState: 'needs_review',
        document: 'unassigned.pdf',
        page: 1,
        part: '',
        cardAsset: 'assets/cards/abc.jpg',
        pageAsset: 'assets/cards/abc.jpg',
        bbox: [0, 0, 1, 1],
        modelDecision: 'review',
        modelConfidence: 0.61,
      }),
    ].join('\n') + '\n',
  );
  const service = createRearLicenceService(root);
  assert.equal(service.forIdentity('id-1').length, 1);
  assert.equal(service.forDocument('doc-1').length, 1);
  assert.equal(service.forUnassigned().length, 1);
  assert.equal(service.forReview().length, 1);
  const evidence = service.forIdentity('id-1')[0];
  assert.equal(evidence.cardUrl, '/rear-licences/assets/cards/abc.jpg');
  assert.equal(evidence.modelDecision, 'confirmed');
  assert.equal(service.forIdentity('missing').length, 0);
});

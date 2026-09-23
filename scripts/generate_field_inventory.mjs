/**
 * Regenerate docs/stage2/field-inventory.json from the live field catalogue.
 *
 * The inventory is a snapshot that tests/stage2Matrix.test.mjs compares against the live
 * catalogue, so it has to be regenerated whenever a field is added or changed. It had no
 * generator, which is how it silently drifted before; this is that generator.
 *
 * Run: node scripts/generate_field_inventory.mjs
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const project = path.resolve(here, '..');
const outFile = path.join(project, 'docs', 'stage2', 'field-inventory.json');

const result = await esbuild.build({
  entryPoints: [path.join(project, 'src', 'data', 'bankFields.ts')],
  bundle: true,
  write: false,
  format: 'esm',
});
const mod = await import(
  'data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64')
);

const bank = mod.BANK_FIELD_DEFINITIONS;
const core = mod.CORE_IDENTIFIER_DEFINITIONS;
const all = [...bank, ...core].sort((a, b) => a.number - b.number);

const categoryCounts = {};
for (const d of all) categoryCounts[d.category] = (categoryCounts[d.category] ?? 0) + 1;

const inventory = {
  source: 'generated from src/data/bankFields.ts and src/data/fields/* via esbuild bundling',
  generatedAt: new Date().toISOString(),
  total: all.length,
  applicationFields: bank.length,
  coreIdentifiers: core.length,
  criticalIdentifiers: core.length,
  categoryCounts,
  fields: all.map((d) => ({
    number: d.number,
    id: d.id,
    name: d.name,
    label: d.label,
    category: d.category,
    targetDataType: d.targetDataType,
    // Structural identifiers (>=101) are the critical tier the test asserts on.
    criticality: d.number >= 101 ? 'critical' : 'standard',
  })),
};

await fs.mkdir(path.dirname(outFile), { recursive: true });
await fs.writeFile(outFile, JSON.stringify(inventory, null, 2) + '\n', 'utf8');
console.log(`wrote ${outFile}: ${inventory.total} fields (${bank.length} app + ${core.length} core)`);
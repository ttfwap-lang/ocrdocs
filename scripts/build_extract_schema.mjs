/**
 * Builds the LlamaCloud Extract JSON schema from the regex field catalogue (src/data/bankFields.ts), so the cloud
 * extraction asks for exactly the fields the rest of the app understands, under the same ids, with the same printed-label
 * vocabulary the regex engine uses. Run: node scripts/build_extract_schema.mjs  (writes scripts/llamacloud/extract_schema.json)
 * tests/llamaCloudSchema.test.mjs fails if the committed file drifts from the catalogue.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(project, 'scripts', 'llamacloud', 'extract_schema.json');

/** Fields the pipeline extracts that the regex catalogue has no definition for (see server/services/vlmFieldMerge.ts). */
const EXTRA_APPLICANT_FIELDS = {
  account_number: 'Bank account number. Copy every digit exactly as printed or written. Printed labels: Account Number; Account No; A/C.',
  tax_file_number: 'Tax File Number (TFN), 8 or 9 digits. Copy every digit exactly. Printed labels: Tax File Number; TFN.',
};
/** Catalogue ids that can describe someone other than the applicant. */
const PERSON_IDS = [
  'title_salutation', 'given_names', 'middle_name', 'family_name', 'date_of_birth', 'residential_address',
  'mobile_number', 'email_address', 'drivers_licence', 'passport_details', 'employment_status', 'occupation_industry',
  'employer_details', 'abn',
];
const RELATIONSHIPS = ['parent', 'spouse', 'dependant', 'employer', 'referee', 'other'];
const TYPE_HINT = {
  date: 'Date exactly as printed or written, preferably DD/MM/YYYY.',
  currency: 'Amount as printed: digits and a decimal point only, no currency symbol.',
  phone: 'Australian phone number exactly as printed.',
  email: 'Email address exactly as printed.',
  identifier: 'Copy every digit and letter exactly as printed. Never guess a digit.',
  number: 'A whole number as printed.',
  text: '',
};

export async function loadCatalogue() {
  const built = await esbuild.build({
    entryPoints: [path.join(project, 'src/data/bankFields.ts')], bundle: true, write: false, format: 'esm', platform: 'node',
  });
  const m = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
  const seen = new Set();
  return [...m.BANK_FIELD_DEFINITIONS, ...m.CORE_IDENTIFIER_DEFINITIONS]
    .filter(d => (seen.has(d.id) ? false : seen.add(d.id)))
    .sort((a, b) => a.number - b.number);
}

function describe(d) {
  // Catalogue descriptions often describe the regex mechanics ("handles acronyms", "OCR compound tokens"); those would
  // only confuse an LLM, so keep a description only when it reads as a plain statement about the field.
  const desc = /regex|catches|matches|handles|ocr|token|extracts|captures|identifies|tolerates|substitution|variation|abbreviation/i.test(d.description) ? '' : ` ${d.description}`;
  const labels = d.exampleLabels?.length ? ` Printed labels: ${d.exampleLabels.join('; ')}.` : '';
  const hint = TYPE_HINT[d.targetDataType] ? ` ${TYPE_HINT[d.targetDataType]}` : '';
  const ex = d.sampleExtractedValue ? ` Example: ${d.sampleExtractedValue}.` : '';
  return `${d.name}.${desc}${labels}${hint}${ex} Null if not present on the document.`.replace(/\s+/g, ' ').trim();
}

const nullableString = description => ({ type: ['string', 'null'], description });

export async function buildSchema() {
  const defs = await loadCatalogue();
  const byId = new Map(defs.map(d => [d.id, d]));
  const applicantProps = {};
  for (const d of defs) applicantProps[d.id] = nullableString(describe(d));
  // Extras only fill gaps: a field the catalogue already defines keeps its catalogue labels and format hints.
  for (const [id, description] of Object.entries(EXTRA_APPLICANT_FIELDS)) if (!applicantProps[id]) applicantProps[id] = nullableString(description);

  const personProps = {
    relationship: { type: 'string', enum: RELATIONSHIPS, description: 'How this person relates to the applicant.' },
    section: nullableString('The printed heading this person appears under, copied verbatim (for example "Parents details").'),
  };
  for (const id of PERSON_IDS) if (byId.has(id)) personProps[id] = nullableString(describe(byId.get(id)));

  const data_schema = {
    type: 'object',
    properties: {
      applicant: {
        type: 'object',
        description: "The applicant's OWN details only: values whose label or section heading says they belong to the person the form is about.",
        properties: applicantProps,
        required: [],
      },
      other_people: {
        type: 'array',
        description: 'Every other person named on the document (parents, spouse, dependants, employers, referees). One entry per person, in the order they appear, so a list like "John and Mary" with jobs "boilermaker, nurse" gives two entries: John with boilermaker, then Mary with nurse.',
        items: { type: 'object', properties: personProps, required: ['relationship'] },
      },
    },
    required: ['applicant', 'other_people'],
  };
  return {
    version: 1,
    generatedFrom: `src/data/bankFields.ts (${defs.length} catalogue fields + ${Object.keys(applicantProps).length - defs.length} extras)`,
    system_prompt:
      'You extract data from Australian identity and financial documents (loan applications, licences, passports, payslips, ' +
      'statements). Put a value under "applicant" only if its own label or the section heading it sits under says it belongs ' +
      'to the applicant. Values under headings about another person go in "other_people" with the right relationship, never ' +
      'under "applicant". When one cell lists several people or values, split them into separate entries in order. Copy digits ' +
      'and spelling exactly as printed or handwritten; never guess, complete or correct a value; use null when a field is not ' +
      'clearly present. Ignore form labels, instructions and example text.',
    fieldIds: Object.keys(applicantProps),
    data_schema,
  };
}

/** Depth of the deepest nested schema object, counting the root as 1. */
export function schemaDepth(node) {
  if (!node || typeof node !== 'object') return 0;
  const kids = [...Object.values(node.properties ?? {}), ...(node.items ? [node.items] : [])];
  return 1 + Math.max(0, ...kids.map(schemaDepth));
}

export function countProperties(node) {
  if (!node || typeof node !== 'object') return 0;
  const own = Object.keys(node.properties ?? {});
  return own.length + own.reduce((n, k) => n + countProperties(node.properties[k]), 0) + (node.items ? countProperties(node.items) : 0);
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('build_extract_schema.mjs')) {
  const schema = await buildSchema();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(schema, null, 2) + '\n');
  console.log(`wrote ${path.relative(project, OUT)}: ${schema.fieldIds.length} applicant fields, depth ${schemaDepth(schema.data_schema)}, ${countProperties(schema.data_schema)} properties`);
}

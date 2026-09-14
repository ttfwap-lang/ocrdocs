import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const project = path.resolve(__dirname, '..');

// Helper to bundle and import TypeScript definitions in-memory
async function loadDefinitions() {
  const result = await esbuild.build({
    entryPoints: [path.join(project, 'src', 'data', 'bankFields.ts')],
    bundle: true,
    write: false,
    format: 'esm',
  });
  const b64 = Buffer.from(result.outputFiles[0].text).toString('base64');
  return import(`data:text/javascript;base64,${b64}`);
}

async function loadModularAggregator() {
  const result = await esbuild.build({
    entryPoints: [path.join(project, 'src', 'data', 'fields', 'index.ts')],
    bundle: true,
    write: false,
    format: 'esm',
  });
  const b64 = Buffer.from(result.outputFiles[0].text).toString('base64');
  return import(`data:text/javascript;base64,${b64}`);
}

async function parseTypesUnions() {
  const typesContent = await fs.readFile(path.join(project, 'src', 'types.ts'), 'utf8');

  // Parse FieldCategory union
  const catMatch = typesContent.match(/export type FieldCategory\s*=\s*([^;]+);/);
  assert.ok(catMatch, 'Could not find FieldCategory in src/types.ts');
  const categories = new Set(
    [...catMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
  );

  // Parse targetDataType union from BankFieldDefinition interface
  const dtMatch = typesContent.match(/targetDataType:\s*([^;]+);/);
  assert.ok(dtMatch, 'Could not find targetDataType in BankFieldDefinition interface in src/types.ts');
  const targetDataTypes = new Set(
    [...dtMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
  );

  return { categories, targetDataTypes };
}

function countAlternatives(regexStr) {
  let depth = 0;
  let count = 1;
  const stripped = regexStr.startsWith('(') && regexStr.endsWith(')')
    ? regexStr.slice(1, -1)
    : regexStr;

  for (let i = 0; i < stripped.length; i++) {
    const ch = stripped[i];
    if (ch === '\\') {
      i++;
      continue;
    }
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (ch === '|' && depth === 0) {
      count++;
    }
  }
  return count;
}

// Reusable validators used by positive test suites and negative mutation self-tests
function validateUniqueIds(definitions) {
  const seenIds = new Set();
  for (const def of definitions) {
    assert.ok(def.id && typeof def.id === 'string', 'Field must have non-empty string id');
    assert.ok(!seenIds.has(def.id), `Duplicate field ID detected: ${def.id}`);
    seenIds.add(def.id);
  }
}

function validateUniqueAndContiguousNumbers(appDefs, coreDefs) {
  const allDefinitions = [...appDefs, ...coreDefs];
  const seenNumbers = new Set();
  for (const def of allDefinitions) {
    assert.ok(Number.isInteger(def.number), `Field ${def.id} number must be an integer`);
    assert.ok(!seenNumbers.has(def.number), `Duplicate field number detected: ${def.number}`);
    seenNumbers.add(def.number);
  }

  const appNumbers = appDefs.map((d) => d.number);
  assert.deepEqual(
    appNumbers,
    Array.from({ length: 90 }, (_, i) => i + 1),
    'Application fields must be contiguously numbered 1 to 90'
  );

  const coreNumbers = coreDefs.map((d) => d.number);
  assert.deepEqual(
    coreNumbers,
    Array.from({ length: 9 }, (_, i) => 101 + i),
    'Core identifiers must be contiguously numbered 101 to 109'
  );
}

function validateTypeUnions(definitions, { categories, targetDataTypes }) {
  assert.ok(categories.size >= 8, 'FieldCategory union must contain at least 8 categories');
  assert.ok(targetDataTypes.size >= 7, 'targetDataType union must contain at least 7 data types');

  for (const def of definitions) {
    assert.ok(
      categories.has(def.category),
      `Field ${def.id} has invalid category "${def.category}". Must be one of: ${[...categories].join(', ')}`
    );
    assert.ok(
      targetDataTypes.has(def.targetDataType),
      `Field ${def.id} has invalid targetDataType "${def.targetDataType}". Must be one of: ${[...targetDataTypes].join(', ')}`
    );
  }
}

function validateRegexCompilationAndStructure(appDefs, coreDefs) {
  for (const def of [...appDefs, ...coreDefs]) {
    assert.doesNotThrow(
      () => new RegExp(def.maxToleranceRegex, 'i'),
      `Pattern failed to compile for field ${def.id}: ${def.maxToleranceRegex}`
    );
  }

  for (const def of appDefs) {
    assert.ok(
      !def.maxToleranceRegex.includes('^'),
      `Application field ${def.id} pattern must not contain '^' anchor: ${def.maxToleranceRegex}`
    );
    assert.ok(
      !def.maxToleranceRegex.includes('$'),
      `Application field ${def.id} pattern must not contain '$' anchor: ${def.maxToleranceRegex}`
    );

    const alternatives = countAlternatives(def.maxToleranceRegex);
    assert.ok(
      alternatives >= 6,
      `Application field ${def.id} must contain at least 6 alternatives (found ${alternatives}): ${def.maxToleranceRegex}`
    );
  }
}

function validateStructuralIdentifierSelfMatching(coreDefs) {
  for (const def of coreDefs) {
    const rx = new RegExp(def.maxToleranceRegex, 'i');
    assert.ok(
      rx.test(def.sampleExtractedValue),
      `Structural identifier ${def.id} sample value "${def.sampleExtractedValue}" does not match regex ${def.maxToleranceRegex}`
    );
  }
}

function validateNoForbiddenClaims(definitions) {
  const forbiddenRegex = /\b(verified|guaranteed|100%|accuracy)\b/i;
  for (const def of definitions) {
    const match = def.description.match(forbiddenRegex);
    assert.ok(
      !match,
      `Field ${def.id} description contains forbidden accuracy claim word "${match?.[0]}": "${def.description}"`
    );
  }
}

test('inventory: catalogue contains at least 99 definitions (90 application fields + 9 structural identifiers)', async () => {
  const { BANK_FIELD_DEFINITIONS, CORE_IDENTIFIER_DEFINITIONS } = await loadDefinitions();

  assert.equal(BANK_FIELD_DEFINITIONS.length, 90, 'Application fields count must equal 90');
  assert.equal(CORE_IDENTIFIER_DEFINITIONS.length, 9, 'Core identifiers count must equal 9');
  assert.ok(
    BANK_FIELD_DEFINITIONS.length + CORE_IDENTIFIER_DEFINITIONS.length >= 99,
    'Combined catalogue inventory must be >= 99 definitions'
  );
  assert.equal(
    BANK_FIELD_DEFINITIONS.length + CORE_IDENTIFIER_DEFINITIONS.length,
    99,
    'Combined catalogue inventory must equal exactly 99 definitions'
  );
});

test('numbering and IDs: contiguous 1..90 and 101..109 with unique IDs and numbers', async () => {
  const { BANK_FIELD_DEFINITIONS, CORE_IDENTIFIER_DEFINITIONS } = await loadDefinitions();
  const allDefinitions = [...BANK_FIELD_DEFINITIONS, ...CORE_IDENTIFIER_DEFINITIONS];

  validateUniqueIds(allDefinitions);
  validateUniqueAndContiguousNumbers(BANK_FIELD_DEFINITIONS, CORE_IDENTIFIER_DEFINITIONS);

  // Contract alignment verification for key specified IDs
  const contractIdMap = {
    36: 'visa_expiry',
    38: 'licence_expiry',
    39: 'joint_applicant',
    42: 'unit_level',
    44: 'street_name_type',
    48: 'address_verification_doc',
    52: 'contact_time',
    54: 'emergency_phone',
    55: 'language_interpreter',
    71: 'government_benefit',
    72: 'income_verification_doc',
    73: 'rent_board_payment',
    76: 'transport_fuel_expense',
    79: 'hem_benchmark_expense',
    109: 'card_number_masked',
  };

  for (const [num, expectedId] of Object.entries(contractIdMap)) {
    const found = allDefinitions.find((d) => d.number === Number(num));
    assert.ok(found, `Field with number ${num} must exist in catalogue`);
    assert.equal(
      found.id,
      expectedId,
      `Field ${num} contract id mismatch: expected "${expectedId}", found "${found.id}"`
    );
  }
});

test('types alignment: category and targetDataType belong to unions in src/types.ts', async () => {
  const { BANK_FIELD_DEFINITIONS, CORE_IDENTIFIER_DEFINITIONS } = await loadDefinitions();
  const { categories, targetDataTypes } = await parseTypesUnions();
  const allDefinitions = [...BANK_FIELD_DEFINITIONS, ...CORE_IDENTIFIER_DEFINITIONS];

  validateTypeUnions(allDefinitions, { categories, targetDataTypes });
});

test('regex compilation and structure: all 99 patterns compile; application fields have ≥6 alternatives and no ^/$ anchors', async () => {
  const { BANK_FIELD_DEFINITIONS, CORE_IDENTIFIER_DEFINITIONS } = await loadDefinitions();

  validateRegexCompilationAndStructure(BANK_FIELD_DEFINITIONS, CORE_IDENTIFIER_DEFINITIONS);
});

test('structural identifiers: sampleExtractedValue self-matches compiled regex', async () => {
  const { CORE_IDENTIFIER_DEFINITIONS } = await loadDefinitions();

  validateStructuralIdentifierSelfMatching(CORE_IDENTIFIER_DEFINITIONS);
});

test('quality and compliance: no forbidden accuracy claims in descriptions', async () => {
  const { BANK_FIELD_DEFINITIONS, CORE_IDENTIFIER_DEFINITIONS } = await loadDefinitions();
  const allDefinitions = [...BANK_FIELD_DEFINITIONS, ...CORE_IDENTIFIER_DEFINITIONS];

  validateNoForbiddenClaims(allDefinitions);
});

test('security and hygiene: no secrets, API keys, or Windows user paths in definitions', async () => {
  const fieldsDir = path.join(project, 'src', 'data', 'fields');
  const files = await fs.readdir(fieldsDir);
  const targetFiles = [
    ...files.map((f) => path.join(fieldsDir, f)),
    path.join(project, 'src', 'data', 'bankFields.ts'),
  ];

  const forbiddenPatterns = [
    { pattern: /(?:sk|pk|ghp|gho)_[a-zA-Z0-9]{20,}/, name: 'API key token' },
    { pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, name: 'Private key' },
    { pattern: /[A-Z]:\\[Uu]sers\\[a-zA-Z0-9_-]+/, name: 'Local Windows user path' },
  ];

  for (const file of targetFiles) {
    const content = await fs.readFile(file, 'utf8');
    for (const { pattern, name } of forbiddenPatterns) {
      assert.ok(
        !pattern.test(content),
        `Found forbidden ${name} in ${path.relative(project, file)}`
      );
    }
  }
});

test('modular architecture: 9 modular files in src/data/fields/ and index.ts aggregator export all extended definitions', async () => {
  const modular = await loadModularAggregator();

  assert.equal(
    modular.EXTENDED_BANK_FIELD_DEFINITIONS.length,
    60,
    'Extended bank fields must contain 60 definitions (fields 31 to 90)'
  );
  assert.equal(
    modular.EXTENDED_CORE_IDENTIFIER_DEFINITIONS.length,
    6,
    'Extended core identifiers must contain 6 definitions (fields 104 to 109)'
  );

  assert.equal(modular.IDENTITY_EXTENDED_FIELDS.length, 10, 'identityExtendedFields: 10 fields (31-40)');
  assert.equal(modular.RESIDENTIAL_EXTENDED_FIELDS.length, 8, 'residentialExtendedFields: 8 fields (41-48)');
  assert.equal(modular.CONTACT_EXTENDED_FIELDS.length, 7, 'contactExtendedFields: 7 fields (49-55)');
  assert.equal(modular.EMPLOYMENT_EXTENDED_FIELDS.length, 8, 'employmentExtendedFields: 8 fields (56-63)');
  assert.equal(modular.INCOME_EXTENDED_FIELDS.length, 9, 'incomeExtendedFields: 9 fields (64-72)');
  assert.equal(modular.EXPENSE_EXTENDED_FIELDS.length, 7, 'expenseExtendedFields: 7 fields (73-79)');
  assert.equal(modular.ASSET_LIABILITY_EXTENDED_FIELDS.length, 6, 'assetLiabilityExtendedFields: 6 fields (80-85)');
  assert.equal(modular.FACILITY_EXTENDED_FIELDS.length, 5, 'facilityExtendedFields: 5 fields (86-90)');
  assert.equal(modular.STRUCTURAL_IDENTIFIER_FIELDS.length, 6, 'structuralIdentifierFields: 6 fields (104-109)');
});

test('negative self-tests: real validator assertions catch in-memory mutations of loaded definitions', async () => {
  const { BANK_FIELD_DEFINITIONS, CORE_IDENTIFIER_DEFINITIONS } = await loadDefinitions();
  const { categories, targetDataTypes } = await parseTypesUnions();

  // Test 1: Injected duplicate ID in real definitions
  assert.throws(() => {
    const mutated = structuredClone([...BANK_FIELD_DEFINITIONS, ...CORE_IDENTIFIER_DEFINITIONS]);
    mutated[10].id = mutated[0].id;
    validateUniqueIds(mutated);
  }, /Duplicate field ID detected/);

  // Test 2: Injected duplicate number in real definitions
  assert.throws(() => {
    const mutatedApp = structuredClone(BANK_FIELD_DEFINITIONS);
    const mutatedCore = structuredClone(CORE_IDENTIFIER_DEFINITIONS);
    mutatedApp[5].number = mutatedApp[0].number;
    validateUniqueAndContiguousNumbers(mutatedApp, mutatedCore);
  }, /Duplicate field number detected/);

  // Test 3: Injected gap in application numbering
  assert.throws(() => {
    const mutatedApp = structuredClone(BANK_FIELD_DEFINITIONS);
    mutatedApp[89].number = 999;
    validateUniqueAndContiguousNumbers(mutatedApp, CORE_IDENTIFIER_DEFINITIONS);
  }, /Application fields must be contiguously numbered/);

  // Test 4: Injected gap in structural identifier numbering
  assert.throws(() => {
    const mutatedCore = structuredClone(CORE_IDENTIFIER_DEFINITIONS);
    mutatedCore[8].number = 200;
    validateUniqueAndContiguousNumbers(BANK_FIELD_DEFINITIONS, mutatedCore);
  }, /Core identifiers must be contiguously numbered/);

  // Test 5: Injected invalid category on real definition
  assert.throws(() => {
    const mutated = structuredClone([...BANK_FIELD_DEFINITIONS, ...CORE_IDENTIFIER_DEFINITIONS]);
    mutated[15].category = 'invalid_fictional_category';
    validateTypeUnions(mutated, { categories, targetDataTypes });
  }, /has invalid category "invalid_fictional_category"/);

  // Test 6: Injected invalid targetDataType on real definition
  assert.throws(() => {
    const mutated = structuredClone([...BANK_FIELD_DEFINITIONS, ...CORE_IDENTIFIER_DEFINITIONS]);
    mutated[20].targetDataType = 'audio_stream';
    validateTypeUnions(mutated, { categories, targetDataTypes });
  }, /has invalid targetDataType "audio_stream"/);

  // Test 7: Injected broken uncompilable regex
  assert.throws(() => {
    const mutatedApp = structuredClone(BANK_FIELD_DEFINITIONS);
    mutatedApp[2].maxToleranceRegex = '(unclosed_parenthesis[a-z]+';
    validateRegexCompilationAndStructure(mutatedApp, CORE_IDENTIFIER_DEFINITIONS);
  }, /Pattern failed to compile/);

  // Test 8: Injected '^' anchor in application regex
  assert.throws(() => {
    const mutatedApp = structuredClone(BANK_FIELD_DEFINITIONS);
    mutatedApp[3].maxToleranceRegex = '^' + mutatedApp[3].maxToleranceRegex;
    validateRegexCompilationAndStructure(mutatedApp, CORE_IDENTIFIER_DEFINITIONS);
  }, /must not contain '\^' anchor/);

  // Test 9: Injected '$' anchor in application regex
  assert.throws(() => {
    const mutatedApp = structuredClone(BANK_FIELD_DEFINITIONS);
    mutatedApp[3].maxToleranceRegex = mutatedApp[3].maxToleranceRegex + '$';
    validateRegexCompilationAndStructure(mutatedApp, CORE_IDENTIFIER_DEFINITIONS);
  }, /must not contain '\$' anchor/);

  // Test 10: Injected insufficient alternatives (< 6 alternatives)
  assert.throws(() => {
    const mutatedApp = structuredClone(BANK_FIELD_DEFINITIONS);
    mutatedApp[4].maxToleranceRegex = '(alt1|alt2|alt3)';
    validateRegexCompilationAndStructure(mutatedApp, CORE_IDENTIFIER_DEFINITIONS);
  }, /must contain at least 6 alternatives/);

  // Test 11: Injected non-matching structural identifier sample value
  assert.throws(() => {
    const mutatedCore = structuredClone(CORE_IDENTIFIER_DEFINITIONS);
    mutatedCore[0].sampleExtractedValue = 'THIS_DOES_NOT_MATCH_ABN_PATTERN';
    validateStructuralIdentifierSelfMatching(mutatedCore);
  }, /does not match regex/);

  // Test 12: Injected forbidden accuracy claim word into description
  assert.throws(() => {
    const mutated = structuredClone([...BANK_FIELD_DEFINITIONS, ...CORE_IDENTIFIER_DEFINITIONS]);
    mutated[7].description = 'Provides 100% accuracy on all customer documents.';
    validateNoForbiddenClaims(mutated);
  }, /description contains forbidden accuracy claim/);
});

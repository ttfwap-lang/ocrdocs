/** Guard tests built from the real garbage values found by reading all 44 identities. */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const built = await esbuild.build({ entryPoints: [path.join(project, 'src/utils/valueSanity.ts')], bundle: true, write: false, format: 'esm', platform: 'node' });
const m = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);

const label = (id, v) => m.rejectReason(id, m.cleanNameValue(id, v), []);

test('form label and instruction text is rejected (real values from the audit)', () => {
  const bad = [
    ['given_names', '(in full)'],
    ['family_name', 'Given names (in full)'],
    ['given_names', 'Date of birth'],
    ['family_name', 'Mr Mrs Miss Ms Other'],
    ['date_of_birth', 'Date employee started working for you'],
    ['date_of_birth', 'Are you an Australian Resident?'],
    ['date_of_birth', 'YLIN.XUHOTMALL.COM'],
    ['drivers_licence', 'or Medicare card.'],
    ['residential_address', 'to request your tax file number (TFN). We will use your TFN to identify you'],
    ['mobile_number', 'number'],
    ['employer_details', 'Name Tax withheld Income'],
    ['occupation_industry', 'insurer to assess whether to insure IMB for the credit given to me or to'],
  ];
  for (const [id, v] of bad) assert.notEqual(label(id, v), null, `${id}: ${v}`);
});

test('real values pass, including short and single-token ones', () => {
  const good = [
    ['given_names', 'John'], ['given_names', 'Roshel Shalani'], ['family_name', 'De Silva'],
    ['title_salutation', 'Mr'], ['marital_status', 'Married'], ['employment_status', 'Full-time'],
    ['email_address', 'john.smith@email.com'], ['date_of_birth', '14/08/1988'], ['date_of_birth', '25December 1989'],
    ['date_of_birth', '16 July 2019'], ['occupation_industry', 'Software Engineer'],
    ['residential_address', "42 O'Connor Street, Canberra ACT 2601"], ['employer_details', 'TechCorp Pty Ltd'],
  ];
  for (const [id, v] of good) assert.equal(label(id, v), null, `${id}: ${v}`);
});

test('leading/trailing label words are stripped from name values', () => {
  assert.equal(m.cleanNameValue('family_name', 'or family name Reddy'), 'Reddy');
  assert.equal(m.cleanNameValue('given_names', 'Given Name Tyler'), 'Tyler');
  assert.equal(m.cleanNameValue('given_names', 'Tyler Name:'), 'Tyler');
  assert.equal(m.cleanNameValue('given_names', 'Angus'), 'Angus');
  assert.equal(m.cleanNameValue('residential_address', 'or something'), 'or something'); // only name fields
});

test('names with digits or symbols are rejected as not-a-name', () => {
  assert.equal(label('given_names', '01/JINGYI'), 'not-a-name');
  assert.equal(label('family_name', 'LIB #014/ Middle name:'), 'not-a-name');
});

// Leaks found in the 2026-09-20 re-analysis: form text stored in typed fields (address, email, mobile, licence, passport).
test('typed fields reject form text and wrong-shaped values (real leaks from the re-analysis)', () => {
  const bad = [
    ['residential_address', 'Branch number'],
    ['residential_address', '2500 CI L |'],
    ['email_address', 'address (optional)'],
    ['email_address', 'and SMS communications by visiting'],
    ['mobile_number', '1300 783 684'],
    ['mobile_number', 'accounts (home and mobile), international'],
    ['drivers_licence', 'Builder address State Postcode'],
    ['drivers_licence', 'Premier Finance Plycled # EXPORITY'],
    ['passport_details', 'does not contain an Australian visa'],
  ];
  for (const [id, v] of bad) assert.notEqual(label(id, v), null, `${id}: ${v}`);
});

test('typed fields still accept realistic values', () => {
  const good = [
    ['residential_address', '24 Wingrove Street, Cheltenham VIC 3192'],
    ['residential_address', 'Unit 5/12 Smith Rd, Parramatta NSW 2150'],
    ['residential_address', 'PO Box 123, Sydney NSW 2001'],
    ['email_address', 'someone@gmail.com'],
    ['mobile_number', '0422 859 562'],
    ['mobile_number', '+61 422 859 562'],
    ['mobile_number', '0422859562'],
    ['drivers_licence', '050800653'],
    ['drivers_licence', 'NSW 12345678'],
    ['passport_details', 'PA1234567'],
  ];
  for (const [id, v] of good) assert.equal(label(id, v), null, `${id}: ${v}`);
});

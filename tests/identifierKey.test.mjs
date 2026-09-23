/**
 * Tests for key-identifier canonicalisation, format checks and the triple-check tier.
 *
 * These mirror tests/python/test_identifiers.py so the app and the offline verifier can
 * never drift on what "triple-check verified" means.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicaliseIdentifier, isValidIdentifier, stripCountry, tierExplanation, verificationTier } from '../server/services/identifierKey.ts';

test('canonicaliseIdentifier strips country prefixes and separators', () => {
  assert.equal(canonicaliseIdentifier('CHN EH9692611'), 'EH9692611');
  assert.equal(canonicaliseIdentifier('AUS PB2337720'), 'PB2337720');
  assert.equal(canonicaliseIdentifier('86 605 667'), '86605667');
  assert.equal(canonicaliseIdentifier('081793L'), '081793L');
  // a multi-value cell keeps the primary number
  assert.equal(canonicaliseIdentifier('G50429525; EF7192314'), 'G50429525');
  assert.equal(canonicaliseIdentifier('  eh9692611 '), 'EH9692611');
});

test('stripCountry leaves a bare identifier untouched', () => {
  assert.equal(stripCountry('G50429525'), 'G50429525');
  assert.equal(stripCountry('AUS 123'), '123');
});

test('Australian passport shapes validate', () => {
  for (const value of ['G50429525', 'E9628011', 'PB24868462', 'N6354675', 'RA4711509', 'KJ03214586', 'LM038015']) {
    assert.ok(isValidIdentifier('passport', value), `${value} should be a valid passport`);
  }
});

test('modern PA/PB/R-series passports validate', () => {
  // The owner specifically called out PA/PB/R-prefixed Australian passports.
  for (const value of ['PA1234567', 'PB2486846', 'R1234567']) {
    assert.ok(isValidIdentifier('passport', value), `${value} should be a valid passport`);
  }
});

test('non-passport values are rejected, including masked ones', () => {
  for (const value of ['12345678', 'G12345', 'EH9****11', 'not-a-passport', 'G5042952512345']) {
    assert.ok(!isValidIdentifier('passport', value), `${value} must not pass as a passport`);
  }
});

test('AU licence shapes validate, including a trailing state letter', () => {
  for (const value of ['081793L', 'P2945484', '038608335', '011912675', 'D7213998', '86605667']) {
    assert.ok(isValidIdentifier('licence', value), `${value} should be a valid licence`);
  }
});

test('word-like and wrong-length licence values are rejected', () => {
  for (const value of ['ABCDEFG', '123', 'P', '3101011961013112220', '']) {
    assert.ok(!isValidIdentifier('licence', value), `${value} must not pass as a licence`);
  }
});

test('triple-check tier follows the owner rule: 1+ source qualifies, 2+ is triple_checked', () => {
  assert.equal(verificationTier('passport', 'G50429525', 1), 'single_source');
  assert.equal(verificationTier('passport', 'G50429525', 2), 'triple_checked');
  assert.equal(verificationTier('licence', '081793L', 26), 'triple_checked');
  // a format failure is reported rather than hidden, whatever the corroboration
  assert.equal(verificationTier('passport', 'EH9****11', 5), 'format_fail');
  assert.equal(verificationTier('passport', '', 0), 'format_fail');
});

test('tierExplanation is non-empty for every tier', () => {
  const tiers = ['triple_checked', 'single_source', 'format_fail', 'absent'];
  for (const tier of tiers) {
    assert.ok(tierExplanation(tier, 3).length > 0, `${tier} needs an explanation`);
  }
  assert.match(tierExplanation('triple_checked', 25), /25/);
});

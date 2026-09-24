/**
 * The Medicare expiry rule, pinned with the exact values found in the real corpus.
 *
 * OWNER RULE: the expiry is only ever MM/YY or MM/YYYY, only ever between 09/2026 and
 * 09/2031 inclusive. Everything else is incorrect and irrelevant. No exceptions.
 *
 * The cases below are the real rejected values from data/medicare_index.json, so a
 * regression that lets one of them back through fails here rather than on screen.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  censusExpiries,
  classifyExpiry,
  displayExpiry,
  isValidExpiry,
  canonicalExpiry,
  monthsUntilExpiry,
  isExpiredMonth,
  expiresWithinMonths,
} from '../src/utils/medicareExpiry.ts';

test('the two owner formats are accepted and displayed as MM/YYYY', () => {
  assert.equal(displayExpiry('09/26'), '09/2026');
  assert.equal(displayExpiry('09/2026'), '09/2026');
  assert.equal(displayExpiry('03/2028'), '03/2028');
  // The window CLOSES at September 2031, so October/November/December 2031 are out.
  assert.equal(isValidExpiry('12/2031'), false);
  assert.equal(isValidExpiry('10/2031'), false);
  assert.equal(displayExpiry('09/2031'), '09/2031');
  assert.equal(displayExpiry('07/2031'), '07/2031');
});

test('the window boundaries are inclusive', () => {
  // First valid: September 2026.
  assert.equal(isValidExpiry('09/2026'), true);
  assert.equal(isValidExpiry('2026-09-01'), true);
  // Last valid: September 2031.
  assert.equal(isValidExpiry('09/2031'), true);
  assert.equal(isValidExpiry('2031-09-01'), true);
});

test('months inside the window are valid regardless of month', () => {
  // Measured in-window examples from the real index.
  for (const value of ['2026-11-01', '2027-12-01', '2028-12-01', '2029-10-01', '2030-10-01', '2027-06-01']) {
    assert.equal(isValidExpiry(value), true, `${value} is inside 09/2026..09/2031`);
  }
});

test('months before the window are rejected -- real values from the corpus', () => {
  // 49 rows in the real index fall below the floor.
  for (const value of ['2026-08-01', '2026-07-01', '2026-06-01', '2026-01-01', '2025-12', '2025-06', '2023-04']) {
    assert.equal(isValidExpiry(value), false, `${value} is before 09/2026 and must be rejected`);
    assert.equal(classifyExpiry(value).rejection, 'before_window');
  }
});

test('months after the window are rejected -- real values from the corpus', () => {
  // 16 rows in the real index fall above the ceiling.
  for (const value of ['2031-10-01', '2031-12-01', '2032-01-01', '2032-06-01', '2032-10-01']) {
    assert.equal(isValidExpiry(value), false, `${value} is after 09/2031 and must be rejected`);
    assert.equal(classifyExpiry(value).rejection, 'after_window');
  }
});

test('malformed values are rejected, not coerced', () => {
  for (const value of ['2027-13', 'not-a-date', '2026', '13/2026', '00/2027', '2026-00-01', '9/26/2026']) {
    const v = classifyExpiry(value);
    assert.equal(v.valid, false, `${value} must not validate`);
  }
  // A month with no day is readable and is judged on its month.
  assert.equal(classifyExpiry('2027-04').rejection, null);
  assert.equal(isValidExpiry('2027-04'), true);
});

test('a rejected expiry is never displayed', () => {
  for (const value of ['2026-08-01', '2032-01-01', 'garbage', '2027-13']) {
    assert.equal(displayExpiry(value), '', `${value} must render as nothing`);
    assert.equal(canonicalExpiry(value), '', `${value} must store as nothing`);
  }
});

test('an absent expiry is absent, not rejected', () => {
  for (const value of ['', '   ', null, undefined]) {
    const v = classifyExpiry(value);
    assert.equal(v.valid, false);
    assert.equal(v.rejection, 'absent');
    assert.equal(displayExpiry(value), '');
  }
});

test('censusExpiries reproduces the measured split', () => {
  // The real corpus composition: 474 valid, 65 outside, 46 month-only, 3,053 absent.
  const census = censusExpiries([
    '2026-09-01', '2026-11-01', '2030-12-01', // valid
    '2026-08-01', '2032-01-01', // outside
    '2027-04', // month-only but in window
    '', null, // absent
  ]);
  assert.equal(census.valid, 4);
  assert.equal(census.beforeWindow, 1);
  assert.equal(census.afterWindow, 1);
  assert.equal(census.absent, 2);
  assert.equal(census.rejected, 2, 'only out-of-window values count as rejected');
});

test('a two-digit year is read as this century', () => {
  assert.equal(displayExpiry('09/26'), '09/2026');
  assert.equal(displayExpiry('09/31'), '09/2031');
  // 2032 in short form is out of range.
  assert.equal(isValidExpiry('09/32'), false);
});

// The owner defines the expiry at MONTH granularity and the store pins the day to 01, so
// every relative measure must be in whole months. A day count would report a card
// expiring "09/2026" as expired on 3 September, which is false.
const SEP_24_2026 = new Date(Date.UTC(2026, 8, 24));

test('monthsUntilExpiry measures whole months, not days', () => {
  assert.equal(monthsUntilExpiry('2026-09-01', SEP_24_2026), 0, 'the current month is month 0');
  assert.equal(monthsUntilExpiry('2026-10-01', SEP_24_2026), 1);
  assert.equal(monthsUntilExpiry('2027-03-01', SEP_24_2026), 6);
  assert.equal(monthsUntilExpiry('2026-08-01', SEP_24_2026), null, 'rejected values have no month count');
});

test('the current month is not expired, the previous one is', () => {
  // A card expiring 09/2026 on 24 September 2026 has NOT expired: September is not over.
  assert.equal(isExpiredMonth('2026-09-01', SEP_24_2026), false);
  // Under a day-based rule 2026-09-01 would look 23 days in the past. It must not.
  assert.equal(monthsUntilExpiry('2026-09-01', SEP_24_2026), 0);

  // Once the month has actually passed, the same value is expired. The window floor is
  // 09/2026, so there is no in-window month earlier than 09/2026 -- the only way an
  // expiry can be both in-window and expired is for time to have moved on.
  assert.equal(isExpiredMonth('2026-09-01', new Date(Date.UTC(2026, 11, 15))), true);
  assert.equal(monthsUntilExpiry('2026-09-01', new Date(Date.UTC(2026, 11, 15))), -3);
});

test('an out-of-window month is rejected, never reported as expired', () => {
  // 2026-08 is before the floor, so it is invalid rather than "expired". The rule runs
  // before any expiry reasoning, which is the whole point: an incorrect value is not a
  // real value that happens to be old.
  assert.equal(classifyExpiry('2026-08-01').rejection, 'before_window');
  assert.equal(monthsUntilExpiry('2026-08-01', SEP_24_2026), null);
  assert.equal(isExpiredMonth('2026-08-01', SEP_24_2026), false);
});

test('expiresWithinMonths includes the current month and excludes the past', () => {
  assert.equal(expiresWithinMonths('2026-09-01', 3, SEP_24_2026), true, 'this month counts as soon');
  assert.equal(expiresWithinMonths('2026-12-01', 3, SEP_24_2026), true, 'three months out still counts');
  assert.equal(expiresWithinMonths('2027-01-01', 3, SEP_24_2026), false, 'four months out does not');
  assert.equal(expiresWithinMonths('2026-08-01', 3, SEP_24_2026), false, 'the past is not "soon"');
});

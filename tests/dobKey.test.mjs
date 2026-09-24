/**
 * Regression tests for canonical DOB keying.
 *
 * The bug these pin: identityService used a digits-only strip, so `24 NOV 1963`
 * -> `241963` while `24/11/1963` -> `24111963`. One person, two identityIds,
 * measured 34 times across the loaded corpus. These tests lock the canonical
 * forms and, just as importantly, the cases that must NOT be merged.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalDob, isReliableDob } from '../server/services/dobKey.ts';

test('canonicalDob - same date written differently collapses to one key', () => {
  const target = '19631124';
  const sameDate = [
    '24/11/1963',
    '24-11-1963',
    '24.11.1963',
    '24 / 11 / 1963',
    '24 NOV 1963',
    '24 Nov 1963',
    '24th Nov 1963',
    '24th November 1963',
    '1963-11-24',
    'November 24, 1963',
    '24NOV1963',
  ];
  for (const value of sameDate) {
    assert.equal(canonicalDob(value), target, `"${value}" should key to ${target}`);
  }
});

test('canonicalDob - different dates never share a key', () => {
  const seen = new Map();
  const values = [
    '24/11/1963', '24 NOV 1963', '11/12/1963', '11 DEC 1963',
    '03/12/1995', '3 Dec 1995', '29/03/1988', '29 MAR 1988',
    '28/02/1968', '28 FEB 1968',
  ];
  for (const value of values) {
    const key = canonicalDob(value);
    if (seen.has(key)) {
      assert.notEqual(seen.get(key), value, `${value} and ${seen.get(key)} collided on ${key}`);
    }
    seen.set(key, value);
  }
  // 24/11/1963 and 11/12/1963 must remain distinct.
  assert.notEqual(canonicalDob('24/11/1963'), canonicalDob('11/12/1963'));
});

test('canonicalDob - ambiguous numeric dates keep their digits instead of guessing', () => {
  // 09/02/1991 could be 9 Feb or 2 Sep. We must not pick one, because a wrong
  // pick could merge two different people. It keys to its own digits so an
  // identical spelling still groups.
  assert.equal(canonicalDob('09/02/1991'), '09021991');
  // Two different ambiguous spellings must NOT be forced together either.
  assert.notEqual(canonicalDob('09/02/1991'), canonicalDob('02/09/1991'));
});

test('canonicalDob - day-first disambiguation only when the day proves it', () => {
  // First component > 12 can only be a day, so the ordering is certain.
  assert.equal(canonicalDob('24/11/1963'), '19631124');
  assert.equal(canonicalDob('31/12/1999'), '19991231');
  // First component <= 12 is ambiguous, so it stays raw.
  assert.equal(canonicalDob('05/06/1990'), '05061990');
});

test('canonicalDob - unparseable and empty values never throw and stay distinct', () => {
  // Values with no digits are all "unknown" and collapse to the empty key. That
  // is safe: the caller already refuses to group without a family name, and an
  // empty DOB key can never collide with a real date.
  assert.equal(canonicalDob(''), '');
  assert.equal(canonicalDob('   '), '');
  assert.equal(canonicalDob('not a date'), '');
  assert.equal(canonicalDob('???'), '');

  // Values that DO carry digits must not collapse into each other.
  const digitBearing = ['14/06/1988; 14/06/1983', '99/99/9999', '12/12/1212'];
  const keys = digitBearing.map(canonicalDob);
  assert.equal(new Set(keys).size, keys.length, `distinct junk collapsed: ${keys}`);
});

test('isReliableDob rejects prose, multiple dates, and impossible dates', () => {
  for (const value of [
    'not a date', 'Unknown.Unknown.Unknown', 'name unavailable',
    '14/06/1988; 14/06/1983', '99/99/9999', '02/31/1990', '',
  ]) assert.equal(isReliableDob(value), false, value);
  for (const value of [
    '14/06/1988', '24/11/1963', '09/02/1991', '1988-06-14',
    '24 NOV 1963', 'November 24, 1963', '14/06/88',
  ]) assert.equal(isReliableDob(value), true, value);
});

test('canonicalDob - two-digit year forms canonicalize when the day is provable', () => {
  assert.equal(canonicalDob('14/06/88'), '19880614');
  assert.equal(canonicalDob('28 JUN 84'), '19840628');
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { computeStats, filterDonationsByScope } from '../convex/lib/reporting.ts';
import { resolveRange } from '../convex/lib/time.ts';
import { loadReplicaDonations, NOW_MS } from './fixtures.ts';

/**
 * Regression guards for the six numbers in BASELINE.md that are WRONG.
 *
 * Each one is what you get from correct arithmetic over the wrong row set, which
 * is why they ship: a wrong number still looks like a number. If one of these
 * ever appears, the assertion message names the rule that broke.
 */

const ROWS = loadReplicaDonations();

test('TRAP: raised must never be the sum over all rows', () => {
  const naive = ROWS.reduce((t, r) => t + r.amountCents, 0);
  assert.equal(naive, 7_441_500, 'sanity: the naive sum really is this');

  const s = computeStats(ROWS);
  assert.notEqual(s.raised.cents, naive, 'status filter is missing from raised');
  assert.equal(s.raised.cents, 6_670_500);
  assert.equal(naive - s.raised.cents, 771_000, 'the excluded 32 rows are worth $7,710');
});

test('TRAP: unique donors must never be distinct emails over all rows', () => {
  const naive = new Set(ROWS.map((r) => r.donorEmail)).size;
  assert.equal(naive, 253, 'sanity: distinct emails across all statuses');

  const s = computeStats(ROWS);
  assert.notEqual(s.uniqueDonorCount, naive, 'status filter is missing from donor counting');
  assert.equal(s.uniqueDonorCount, 223);
});

test('TRAP: raised must never include donor-covered fees', () => {
  const s = computeStats(ROWS);
  assert.notEqual(s.raised.cents, 6_792_838, 'fees were folded into raised');
  assert.equal(s.raised.cents, 6_670_500);
  // Charged is a real figure -- it just is not "raised".
  assert.equal(s.charged.cents, 6_792_838);
  assert.equal(s.charged.cents - s.raised.cents, s.feesCovered.cents);
});

test('TRAP: donation count must never be the total row count', () => {
  const s = computeStats(ROWS);
  assert.notEqual(s.donationCount, 283, 'status filter is missing from donation count');
  assert.equal(s.donationCount, 251);
  assert.equal(s.rowsInScope, 283, 'rowsInScope is intentionally all statuses');
});

test('TRAP: donors must never equal donation count', () => {
  const s = computeStats(ROWS);
  assert.notEqual(s.uniqueDonorCount, s.donationCount, 'rows are being treated as people');
  assert.equal(s.donationCount - s.uniqueDonorCount, 28);
});

test('TRAP: wei.kim must report 13 gifts, not 15', () => {
  const wei = (rows: typeof ROWS) =>
    rows.filter((r) => r.donorEmail === 'wei.kim@example.org');
  assert.equal(wei(ROWS).length, 15, 'sanity: 15 rows exist');
  assert.equal(wei(ROWS.filter((r) => r.status === 'succeeded')).length, 13);
});

test('TRAP: an empty range must not divide by zero', () => {
  const july = resolveRange({ preset: 'last_month' }, NOW_MS);
  const s = computeStats(ROWS, { range: july });
  assert.equal(s.averageGift, null);
  assert.equal(s.medianGift, null);
  assert.ok(!Number.isNaN(s.raised.cents));
  assert.equal(s.raised.formatted, '$0.00');
});

test('TRAP: scope filtering must not become a status filter', () => {
  // If someone "helpfully" folds the succeeded rule into scope filtering, this
  // count drops from 283 to 251 and every non-raised figure silently becomes 0.
  assert.equal(filterDonationsByScope(ROWS).length, 283);
  const s = computeStats(ROWS);
  assert.ok(s.failed.cents > 0, 'failed money disappeared -- scope is filtering status');
  assert.ok(s.pending.cents > 0, 'pending money disappeared -- scope is filtering status');
  assert.ok(s.refunded.cents > 0, 'refunded money disappeared -- scope is filtering status');
});

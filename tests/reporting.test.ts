import assert from 'node:assert/strict';
import test from 'node:test';

import { assertIntegerCents, averageCents, formatCents, sumCents } from '../convex/lib/money.ts';
import { bucketKey, isWithinRange, resolveRange } from '../convex/lib/time.ts';
import { partitionByStatus } from '../convex/lib/status.ts';
import {
  computeRaisedCents,
  computeStats,
  filterDonationsByScope,
  medianCents,
  normalizeDonorEmail,
} from '../convex/lib/reporting.ts';
import { loadReplicaDonations, NOW_MS } from './fixtures.ts';

const ROWS = loadReplicaDonations();

// ── money ────────────────────────────────────────────────────────────────────

test('formatCents renders integer cents without float artifacts', () => {
  assert.equal(formatCents(6670500), '$66,705.00');
  assert.equal(formatCents(0), '$0.00');
  assert.equal(formatCents(5), '$0.05');
  assert.equal(formatCents(100), '$1.00');
  assert.equal(formatCents(999), '$9.99');
  assert.equal(formatCents(100000000), '$1,000,000.00');
  assert.equal(formatCents(-2500), '-$25.00');
});

test('money helpers reject non-integer cents', () => {
  assert.throws(() => assertIntegerCents(10.5), /whole number of cents/);
  assert.throws(() => formatCents(0.1 + 0.2), /whole number of cents/);
  assert.throws(() => sumCents([100, 1.5]), /whole number of cents/);
});

test('averageCents returns null for an empty set rather than NaN', () => {
  assert.equal(averageCents(0, 0), null);
  assert.equal(averageCents(6670500, 251), 26576);
});

// ── time ─────────────────────────────────────────────────────────────────────

test('explicit ranges treat endISO as an inclusive whole day', () => {
  const march = resolveRange({ startISO: '2026-03-01', endISO: '2026-03-31' }, NOW_MS);
  assert.equal(march.startISO, '2026-03-01');
  assert.equal(march.endISO, '2026-03-31');
  // A gift at 23:59 on the 31st must be inside the range.
  assert.ok(isWithinRange(Date.parse('2026-03-31T23:59:59.999Z'), march));
  // Half-open: the first instant of April must not be.
  assert.ok(!isWithinRange(Date.parse('2026-04-01T00:00:00.000Z'), march));
});

test('adjacent ranges never double-count a boundary row', () => {
  const march = resolveRange({ startISO: '2026-03-01', endISO: '2026-03-31' }, NOW_MS);
  const april = resolveRange({ startISO: '2026-04-01', endISO: '2026-04-30' }, NOW_MS);
  const boundary = Date.parse('2026-04-01T00:00:00.000Z');
  assert.equal(isWithinRange(boundary, march), false);
  assert.equal(isWithinRange(boundary, april), true);
});

test('last_month resolves to the previous calendar month in UTC', () => {
  const r = resolveRange({ preset: 'last_month' }, NOW_MS);
  assert.equal(r.startISO, '2026-07-01');
  assert.equal(r.endISO, '2026-07-31');
  assert.equal(r.timezone, 'UTC');
});

test('all_time is unbounded on both sides', () => {
  const r = resolveRange({ preset: 'all_time' }, NOW_MS);
  assert.equal(r.startMs, null);
  assert.equal(r.endMs, null);
  assert.ok(isWithinRange(0, r));
});

test('invalid explicit ranges are rejected at the boundary', () => {
  assert.throws(() => resolveRange({ startISO: '2026-03-01', endISO: '2026-02-01' }, NOW_MS));
  assert.throws(() => resolveRange({ startISO: 'March 1st', endISO: '2026-03-31' }, NOW_MS));
});

test('bucketKey buckets in UTC', () => {
  const ms = Date.parse('2026-03-15T23:30:00.000Z');
  assert.equal(bucketKey(ms, 'day'), '2026-03-15');
  assert.equal(bucketKey(ms, 'month'), '2026-03');
  assert.equal(bucketKey(ms, 'week'), '2026-03-09'); // Monday of that week
});

// ── scope filtering is NOT status filtering ──────────────────────────────────

test('filterDonationsByScope applies NO status rule', () => {
  const all = filterDonationsByScope(ROWS);
  assert.equal(all.length, 283, 'unscoped filtering must return every row, not just succeeded');
  const statuses = new Set(all.map((r) => r.status));
  assert.deepEqual([...statuses].sort(), ['failed', 'pending', 'refunded', 'succeeded']);
});

test('scope filtering composes campaign and date independently of status', () => {
  const march = resolveRange({ startISO: '2026-03-01', endISO: '2026-03-31' }, NOW_MS);
  const scoped = filterDonationsByScope(ROWS, {
    campaignIds: ['legal-defense-fund'],
    range: march,
  });
  assert.ok(scoped.length > 0);
  assert.ok(scoped.every((r) => r.campaignId === 'legal-defense-fund'));
  assert.ok(scoped.every((r) => isWithinRange(r.createdAt, march)));
  // Non-succeeded rows survive scoping; only the aggregations drop them.
  assert.ok(scoped.some((r) => r.status !== 'succeeded'));
});

test('an empty campaign list means no campaigns, not all campaigns', () => {
  assert.equal(filterDonationsByScope(ROWS, { campaignIds: [] }).length, 0);
  assert.equal(filterDonationsByScope(ROWS, {}).length, 283);
});

test('partitionByStatus splits all 283 rows without loss', () => {
  const p = partitionByStatus(ROWS);
  assert.equal(p.succeeded.length, 251);
  assert.equal(p.pending.length, 8);
  assert.equal(p.failed.length, 16);
  assert.equal(p.refunded.length, 8);
  assert.equal(
    p.succeeded.length + p.pending.length + p.failed.length + p.refunded.length,
    283
  );
});

// ── BASELINE.md ──────────────────────────────────────────────────────────────

test('org-wide stats reproduce the verified baseline', () => {
  const s = computeStats(ROWS);

  assert.equal(s.raised.cents, 6_670_500);
  assert.equal(s.raised.formatted, '$66,705.00');
  assert.equal(s.donationCount, 251);
  assert.equal(s.uniqueDonorCount, 223);
  assert.equal(s.repeatDonorCount, 3);
  assert.equal(s.averageGift?.formatted, '$265.76');
  assert.equal(s.medianGift?.formatted, '$100.00');
  assert.equal(s.feesCovered.cents, 122_338);
  assert.equal(s.charged.cents, 6_792_838);
  assert.equal(s.charged.formatted, '$67,928.38');
  assert.equal(s.rowsInScope, 283);
});

test('non-raised money is broken out rather than exposed as a status filter', () => {
  const s = computeStats(ROWS);
  assert.equal(s.pending.count, 8);
  assert.equal(s.pending.cents, 310_500);
  assert.equal(s.failed.count, 16);
  assert.equal(s.failed.cents, 259_500);
  assert.equal(s.refunded.count, 8);
  assert.equal(s.refunded.cents, 201_000);
  // The four buckets must account for every dollar in the dataset.
  assert.equal(
    s.raised.cents + s.pending.cents + s.failed.cents + s.refunded.cents,
    7_441_500
  );
});

test('coverage describes the dataset even when nothing is in scope', () => {
  const july = resolveRange({ preset: 'last_month' }, NOW_MS);
  const s = computeStats(ROWS, { range: july });

  assert.equal(s.rowsInScope, 0);
  assert.equal(s.donationCount, 0);
  assert.equal(s.raised.cents, 0);
  assert.equal(s.raised.formatted, '$0.00');
  assert.equal(s.averageGift, null, 'no gifts must not produce an average');
  assert.equal(s.medianGift, null);
  // The empty result explains itself.
  assert.equal(s.coverage.totalRowsInDataset, 283);
  assert.equal(s.coverage.datasetMinISO, '2026-01-01T00:39:03.479Z');
  assert.equal(s.coverage.datasetMaxISO, '2026-06-29T19:49:39.539Z');
  assert.equal(s.scope.range.startISO, '2026-07-01');
});

test('per-campaign stats reproduce the verified baseline', () => {
  const expected = [
    ['legal-defense-fund', 154, 4_294_000, 137],
    ['winter-meal-drive', 67, 1_592_000, 60],
    ['scholarship-endowment', 26, 727_500, 26],
    ['emergency-relief-2025', 4, 57_000, 4],
    ['untitled-draft', 0, 0, 0],
  ] as const;

  for (const [slug, count, cents, donors] of expected) {
    const s = computeStats(ROWS, { campaignIds: [slug] });
    assert.equal(s.donationCount, count, `${slug} donation count`);
    assert.equal(s.raised.cents, cents, `${slug} raised`);
    assert.equal(s.uniqueDonorCount, donors, `${slug} donors`);
  }
});

test('per-campaign donor counts do NOT sum to the org total', () => {
  const slugs = [
    'legal-defense-fund',
    'winter-meal-drive',
    'scholarship-endowment',
    'emergency-relief-2025',
  ];
  const summed = slugs.reduce(
    (t, slug) => t + computeStats(ROWS, { campaignIds: [slug] }).uniqueDonorCount,
    0
  );
  assert.equal(summed, 227);
  assert.equal(computeStats(ROWS).uniqueDonorCount, 223);
});

test('March 2026 reproduces the verified baseline', () => {
  const march = resolveRange({ startISO: '2026-03-01', endISO: '2026-03-31' }, NOW_MS);
  const s = computeStats(ROWS, { range: march });
  assert.equal(s.donationCount, 42);
  assert.equal(s.raised.cents, 1_364_500);
  assert.equal(s.raised.formatted, '$13,645.00');
});

test('March campaign comparison: legal fund beat the meal drive', () => {
  const march = resolveRange({ startISO: '2026-03-01', endISO: '2026-03-31' }, NOW_MS);
  const legal = computeStats(ROWS, { campaignIds: ['legal-defense-fund'], range: march });
  const meals = computeStats(ROWS, { campaignIds: ['winter-meal-drive'], range: march });

  assert.equal(legal.raised.cents, 771_000);
  assert.equal(legal.donationCount, 24);
  assert.equal(meals.raised.cents, 378_500);
  assert.equal(meals.donationCount, 14);
  assert.ok(legal.raised.cents > meals.raised.cents);
});

test('monthly totals reproduce the verified baseline', () => {
  const expected: Record<string, [number, number]> = {
    '2026-01': [1_347_500, 52],
    '2026-02': [1_052_500, 42],
    '2026-03': [1_364_500, 42],
    '2026-04': [1_005_500, 44],
    '2026-05': [942_500, 41],
    '2026-06': [958_000, 30],
  };
  let runningCents = 0;
  for (const [month, [cents, count]] of Object.entries(expected)) {
    const [y, m] = month.split('-').map(Number);
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const range = resolveRange(
      { startISO: `${month}-01`, endISO: `${month}-${String(lastDay).padStart(2, '0')}` },
      NOW_MS
    );
    const s = computeStats(ROWS, { range });
    assert.equal(s.raised.cents, cents, `${month} raised`);
    assert.equal(s.donationCount, count, `${month} count`);
    runningCents += cents;
  }
  // The six months must account for every raised dollar -- no gift falls in a gap.
  assert.equal(runningCents, 6_670_500);
});

test('repeat donors: three, and wei.kim is the status-filter canary', () => {
  const s = computeStats(ROWS);
  assert.equal(s.repeatDonorCount, 3);

  const succeeded = ROWS.filter((r) => r.status === 'succeeded');
  const weiSucceeded = succeeded.filter(
    (r) => normalizeDonorEmail(r.donorEmail) === 'wei.kim@example.org'
  );
  const weiAll = ROWS.filter((r) => normalizeDonorEmail(r.donorEmail) === 'wei.kim@example.org');
  assert.equal(weiSucceeded.length, 13, 'wei.kim has 13 succeeded gifts');
  assert.equal(weiAll.length, 15, 'wei.kim has 15 rows in total');
  assert.equal(
    weiSucceeded.reduce((t, r) => t + r.amountCents, 0),
    311_000
  );
});

test('anonymous gifts still count toward every total', () => {
  const anonymous = ROWS.filter((r) => r.status === 'succeeded' && r.anonymous === true);
  assert.equal(anonymous.length, 18);
  assert.equal(
    anonymous.reduce((t, r) => t + r.amountCents, 0),
    563_000
  );
  // Removing them would change the headline, so they must be inside it.
  assert.ok(computeStats(ROWS).raised.cents > 6_670_500 - 563_000);
});

test('donor identity normalises case and whitespace', () => {
  assert.equal(normalizeDonorEmail('  WEI.Kim@Example.ORG '), 'wei.kim@example.org');
  const mixed = [
    { ...ROWS[0], donorEmail: 'A@B.com', status: 'succeeded' as const },
    { ...ROWS[0], donorEmail: ' a@b.COM ', status: 'succeeded' as const },
  ];
  assert.equal(computeStats(mixed).uniqueDonorCount, 1);
});

test('computeRaisedCents agrees with computeStats', () => {
  assert.equal(computeRaisedCents(ROWS), computeStats(ROWS).raised.cents);
  const scope = { campaignIds: ['winter-meal-drive'] };
  assert.equal(computeRaisedCents(ROWS, scope), computeStats(ROWS, scope).raised.cents);
});

test('medianCents handles empty and even-length sets', () => {
  assert.equal(medianCents([]), null);
  const mk = (amountCents: number) => ({ ...ROWS[0], amountCents });
  assert.equal(medianCents([mk(100), mk(300)]), 200);
  assert.equal(medianCents([mk(100), mk(200), mk(900)]), 200);
});

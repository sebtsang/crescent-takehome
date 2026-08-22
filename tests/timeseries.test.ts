import assert from 'node:assert/strict';
import test from 'node:test';

import { computeStats, computeTimeseries } from '../convex/lib/reporting.ts';
import { bucketStartMs, enumerateBuckets, nextBucketMs, resolveRange } from '../convex/lib/time.ts';
import { loadReplicaDonations, NOW_MS } from './fixtures.ts';

const ROWS = loadReplicaDonations();
const FULL = resolveRange({ startISO: '2026-01-01', endISO: '2026-06-29' }, NOW_MS);

// ── bucket enumeration ───────────────────────────────────────────────────────

test('months advance by calendar, not by 30 days', () => {
  const jan31 = Date.parse('2026-01-31T00:00:00.000Z');
  assert.equal(
    new Date(nextBucketMs(bucketStartMs(jan31, 'month'), 'month')).toISOString(),
    '2026-02-01T00:00:00.000Z'
  );
  // February -> March across a non-leap year.
  const feb = Date.parse('2026-02-15T00:00:00.000Z');
  assert.equal(
    new Date(nextBucketMs(bucketStartMs(feb, 'month'), 'month')).toISOString(),
    '2026-03-01T00:00:00.000Z'
  );
});

test('enumerateBuckets respects the half-open end bound', () => {
  const start = Date.parse('2026-03-01T00:00:00.000Z');
  const end = Date.parse('2026-03-04T00:00:00.000Z');
  assert.deepEqual(
    enumerateBuckets(start, end, 'day').map((b) => b.key),
    ['2026-03-01', '2026-03-02', '2026-03-03']
  );
  assert.deepEqual(enumerateBuckets(start, start, 'day'), []);
});

// ── the zero-fill guarantee ──────────────────────────────────────────────────

test('every day in the range is present, including the 47 empty ones', () => {
  const ts = computeTimeseries(ROWS, { granularity: 'day', scope: { range: FULL } });
  assert.equal(ts.buckets.length, 180, 'Jan 1 - Jun 29 is 180 days');
  assert.equal(ts.emptyBucketCount, 47);
  assert.equal(
    ts.buckets.filter((b) => b.donationCount === 0).length,
    47,
    'empty days must be present as zero rows, not omitted'
  );
  // Consecutive keys with no gaps -- the property a chart actually depends on.
  for (let i = 1; i < ts.buckets.length; i += 1) {
    const prev = Date.parse(ts.buckets[i - 1].startISO);
    const curr = Date.parse(ts.buckets[i].startISO);
    assert.equal(curr - prev, 86_400_000, `gap before ${ts.buckets[i].key}`);
  }
});

test('an entirely empty period still produces a chart', () => {
  const july = resolveRange({ preset: 'last_month' }, NOW_MS);
  const ts = computeTimeseries(ROWS, { granularity: 'day', scope: { range: july } });
  assert.equal(ts.buckets.length, 31, 'July has 31 days and all of them are rendered');
  assert.equal(ts.emptyBucketCount, 31);
  assert.equal(ts.totalRaised.formatted, '$0.00');
  assert.ok(ts.buckets.every((b) => b.cumulativeRaised.cents === 0));
  // The empty result still explains itself.
  assert.equal(ts.coverage.datasetMaxISO, '2026-06-29T19:49:39.539Z');
});

// ── values reconcile with the baseline ───────────────────────────────────────

test('monthly buckets reproduce the verified baseline', () => {
  const ts = computeTimeseries(ROWS, { granularity: 'month' });
  assert.deepEqual(
    ts.buckets.map((b) => [b.key, b.raised.cents, b.donationCount]),
    [
      ['2026-01', 1_347_500, 52],
      ['2026-02', 1_052_500, 42],
      ['2026-03', 1_364_500, 42],
      ['2026-04', 1_005_500, 44],
      ['2026-05', 942_500, 41],
      ['2026-06', 958_000, 30],
    ]
  );
});

test('cumulative ends exactly at total raised', () => {
  for (const granularity of ['day', 'week', 'month'] as const) {
    const ts = computeTimeseries(ROWS, { granularity, scope: { range: FULL } });
    assert.equal(ts.buckets.at(-1)!.cumulativeRaised.cents, 6_670_500, granularity);
    assert.equal(ts.totalRaised.cents, computeStats(ROWS).raised.cents, granularity);
  }
});

test('cumulative is monotonically non-decreasing', () => {
  const ts = computeTimeseries(ROWS, { granularity: 'day', scope: { range: FULL } });
  let previous = 0;
  for (const b of ts.buckets) {
    assert.ok(b.cumulativeRaised.cents >= previous, `dipped at ${b.key}`);
    previous = b.cumulativeRaised.cents;
  }
});

test('bucket sums equal the total regardless of granularity', () => {
  for (const granularity of ['day', 'week', 'month'] as const) {
    const ts = computeTimeseries(ROWS, { granularity, scope: { range: FULL } });
    assert.equal(
      ts.buckets.reduce((t, b) => t + b.raised.cents, 0),
      6_670_500,
      `${granularity}: no gift may fall between buckets`
    );
    assert.equal(
      ts.buckets.reduce((t, b) => t + b.donationCount, 0),
      251,
      granularity
    );
  }
});

// ── window derivation ────────────────────────────────────────────────────────

test('an unbounded scope derives its window from the scoped rows', () => {
  const ended = computeTimeseries(ROWS, {
    granularity: 'month',
    scope: { campaignIds: ['emergency-relief-2025'] },
  });
  // This campaign only ran in Jan-Feb; the chart shows its life, not the dataset's.
  assert.deepEqual(ended.buckets.map((b) => b.key), ['2026-01', '2026-02']);
  assert.equal(ended.totalRaised.cents, 57_000);
});

test('a campaign with no donations produces no buckets, not a crash', () => {
  const draft = computeTimeseries(ROWS, {
    granularity: 'month',
    scope: { campaignIds: ['untitled-draft'] },
  });
  assert.deepEqual(draft.buckets, []);
  assert.equal(draft.totalRaised.formatted, '$0.00');
  assert.equal(draft.emptyBucketCount, 0);
});

test('the last gift is inside the final bucket, never past the end', () => {
  const ts = computeTimeseries(ROWS, { granularity: 'day' });
  assert.equal(ts.buckets.at(-1)!.key, '2026-06-29');
  assert.ok(ts.buckets.at(-1)!.donationCount > 0, 'final bucket must contain the last gift');
});

// ── UTC edges ────────────────────────────────────────────────────────────────

test('weeks start Monday, even when that Monday is in the previous year', () => {
  const ts = computeTimeseries(ROWS, { granularity: 'week' });
  assert.equal(ts.buckets[0].key, '2025-12-29', 'Jan 1 2026 fell on a Thursday');
  assert.equal(ts.buckets.length, 27);
  // The bucket label predates every donation, which is correct, not a bug.
  assert.ok(Date.parse(ts.buckets[0].startISO) < Date.parse('2026-01-01T00:00:00.000Z'));
});

test('a gift just after UTC midnight lands in the new day', () => {
  const ts = computeTimeseries(ROWS, { granularity: 'day', scope: { range: FULL } });
  // The earliest gift is 2026-01-01T00:39:03Z -- 00:39 UTC, but 2025-12-31 in Toronto.
  const jan1 = ts.buckets.find((b) => b.key === '2026-01-01')!;
  assert.ok(jan1.donationCount > 0, 'a 00:39 UTC gift belongs to Jan 1 under UTC bucketing');
  assert.equal(ts.timezone, 'UTC');
});

test('per-bucket donor counts must NOT be summed', () => {
  const ts = computeTimeseries(ROWS, { granularity: 'month' });
  const summed = ts.buckets.reduce((t, b) => t + b.uniqueDonorCount, 0);
  assert.ok(
    summed > computeStats(ROWS).uniqueDonorCount,
    'repeat donors are counted in each month they gave, by design'
  );
});

test('TRAP: timeseries must exclude non-succeeded money', () => {
  const ts = computeTimeseries(ROWS, { granularity: 'month', scope: { range: FULL } });
  const total = ts.buckets.reduce((t, b) => t + b.raised.cents, 0);
  assert.notEqual(total, 7_441_500, 'status filter is missing from the timeseries');
  assert.equal(total, 6_670_500);
});

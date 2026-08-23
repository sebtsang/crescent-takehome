import assert from 'node:assert/strict';
import test from 'node:test';

import { computeBreakdown, computeStats } from '../convex/lib/reporting.ts';
import { resolveRange } from '../convex/lib/time.ts';
import { loadReplicaCampaigns, loadReplicaDonations, NOW_MS } from './fixtures.ts';

const ROWS = loadReplicaDonations();
const CAMPAIGNS = loadReplicaCampaigns();

const byCampaign = (opts: Parameters<typeof computeBreakdown>[2] = { dimension: 'campaign' }) =>
  computeBreakdown(ROWS, CAMPAIGNS, opts);

test('campaign breakdown reproduces the verified baseline', () => {
  const { groups } = byCampaign();
  const find = (slug: string) => groups.find((g) => g.key === slug)!;

  const expected = [
    ['legal-defense-fund', 154, 4_294_000, 137],
    ['winter-meal-drive', 67, 1_592_000, 60],
    ['scholarship-endowment', 26, 727_500, 26],
    ['emergency-relief-2025', 4, 57_000, 4],
    ['untitled-draft', 0, 0, 0],
  ] as const;

  for (const [slug, count, cents, donors] of expected) {
    const g = find(slug);
    assert.equal(g.donationCount, count, `${slug} count`);
    assert.equal(g.raised.cents, cents, `${slug} raised`);
    assert.equal(g.uniqueDonorCount, donors, `${slug} donors`);
  }
  assert.equal(find('legal-defense-fund').raised.formatted, '$42,940.00');
});

test('a campaign with zero donations still appears', () => {
  const { groups } = byCampaign();
  assert.equal(groups.length, 5, 'all five campaigns must be present');
  const draft = groups.find((g) => g.key === 'untitled-draft')!;
  assert.equal(draft.donationCount, 0);
  assert.equal(draft.raised.formatted, '$0.00');
  assert.equal(draft.averageGift, null, 'no gifts must not produce an average');
  assert.equal(draft.campaignStatus, 'draft');
});

test('group totals reconcile with the org-wide total', () => {
  const { groups } = byCampaign();
  const summed = groups.reduce((t, g) => t + g.raised.cents, 0);
  assert.equal(summed, computeStats(ROWS).raised.cents);
  assert.equal(summed, 6_670_500);
  assert.equal(
    groups.reduce((t, g) => t + g.donationCount, 0),
    251
  );
});

test('goal progress is the TRUE percent, and null when there is no goal', () => {
  const { groups } = byCampaign();
  const find = (slug: string) => groups.find((g) => g.key === slug)!;

  // Over goal -- reported honestly, not capped at 100.
  assert.equal(find('legal-defense-fund').lifetimeGoalProgressPct, 171.8);
  assert.equal(find('winter-meal-drive').lifetimeGoalProgressPct, 199);
  assert.equal(find('emergency-relief-2025').lifetimeGoalProgressPct, 1.1);

  // No goal -- null, never 0 / NaN / Infinity.
  assert.equal(find('scholarship-endowment').goal, null);
  assert.equal(find('scholarship-endowment').lifetimeGoalProgressPct, null);
  assert.equal(find('untitled-draft').lifetimeGoalProgressPct, null);
});

test('ended and draft campaigns are included, and carry their status', () => {
  const { groups } = byCampaign();
  const ended = groups.find((g) => g.key === 'emergency-relief-2025')!;
  assert.equal(ended.campaignStatus, 'ended');
  assert.equal(ended.raised.cents, 57_000, 'ended campaign money still counts');
  // ...but the UI can tell it apart, which is why status rides along.
  assert.ok(groups.some((g) => g.campaignStatus === 'draft'));
});

test('share of total sums to ~100% and is null when nothing is in scope', () => {
  const { groups } = byCampaign();
  const total = groups.reduce((t, g) => t + (g.shareOfTotalPct ?? 0), 0);
  assert.ok(Math.abs(total - 100) < 0.5, `shares summed to ${total}`);
  assert.equal(groups.find((g) => g.key === 'legal-defense-fund')!.shareOfTotalPct, 64.4);

  const july = resolveRange({ preset: 'last_month' }, NOW_MS);
  const empty = byCampaign({ dimension: 'campaign', scope: { range: july } });
  assert.ok(empty.groups.every((g) => g.shareOfTotalPct === null));
  assert.ok(empty.groups.every((g) => g.raised.cents === 0));
  assert.equal(empty.groups.length, 5, 'empty range must not collapse the group list');
});

test('ordering is deterministic and sortable by metric', () => {
  const byRaised = byCampaign({ dimension: 'campaign', sortBy: 'raised' }).groups;
  assert.deepEqual(
    byRaised.map((g) => g.key),
    [
      'legal-defense-fund',
      'winter-meal-drive',
      'scholarship-endowment',
      'emergency-relief-2025',
      'untitled-draft',
    ]
  );

  const byDonors = byCampaign({ dimension: 'campaign', sortBy: 'uniqueDonorCount' }).groups;
  assert.equal(byDonors[0].key, 'legal-defense-fund');

  // Repeated calls must not reorder ties (draft and any zero-raised group).
  for (let i = 0; i < 5; i += 1) {
    assert.deepEqual(
      byCampaign({ dimension: 'campaign' }).groups.map((g) => g.key),
      byRaised.map((g) => g.key)
    );
  }
});

test('scoping to specific campaigns returns only those groups', () => {
  const { groups } = byCampaign({
    dimension: 'campaign',
    scope: { campaignIds: ['winter-meal-drive', 'legal-defense-fund'] },
  });
  assert.equal(groups.length, 2);
  // Shares are relative to the SCOPED total, so they still sum to ~100.
  assert.ok(Math.abs(groups.reduce((t, g) => t + (g.shareOfTotalPct ?? 0), 0) - 100) < 0.5);
});

test('March comparison: legal fund beat the meal drive', () => {
  const march = resolveRange({ startISO: '2026-03-01', endISO: '2026-03-31' }, NOW_MS);
  const { groups } = byCampaign({
    dimension: 'campaign',
    scope: { campaignIds: ['winter-meal-drive', 'legal-defense-fund'], range: march },
  });
  assert.equal(groups[0].key, 'legal-defense-fund');
  assert.equal(groups[0].raised.cents, 771_000);
  assert.equal(groups[1].raised.cents, 378_500);
});

test('frequency breakdown reproduces the verified baseline', () => {
  const { groups } = computeBreakdown(ROWS, CAMPAIGNS, { dimension: 'frequency' });
  const find = (key: string) => groups.find((g) => g.key === key)!;

  assert.equal(groups.length, 2);
  assert.equal(find('one_time').donationCount, 198);
  assert.equal(find('one_time').raised.cents, 5_385_500);
  assert.equal(find('monthly').donationCount, 53);
  assert.equal(find('monthly').raised.cents, 1_285_000);
  assert.equal(
    find('one_time').raised.cents + find('monthly').raised.cents,
    6_670_500
  );
  // Frequency groups carry no goal -- that concept is campaign-only.
  assert.equal(find('monthly').lifetimeGoalProgressPct, undefined);
});

test('TRAP: breakdown must exclude non-succeeded money', () => {
  const { groups } = byCampaign();
  const legal = groups.find((g) => g.key === 'legal-defense-fund')!;
  const allLegalRows = ROWS.filter((r) => r.campaignId === 'legal-defense-fund');
  const naive = allLegalRows.reduce((t, r) => t + r.amountCents, 0);

  assert.equal(allLegalRows.length, 172, 'sanity: 172 rows exist');
  assert.equal(legal.donationCount, 154, 'status filter missing from breakdown');
  assert.notEqual(legal.raised.cents, naive, 'breakdown summed every status');
});

test('goal progress is LIFETIME and does not move with the range scope', () => {
  const march = resolveRange({ startISO: '2026-03-01', endISO: '2026-03-31' }, NOW_MS);
  const scoped = byCampaign({
    dimension: 'campaign',
    scope: { range: march, campaignIds: ['legal-defense-fund'] },
  }).groups[0];

  // March raised is a fraction of lifetime...
  assert.equal(scoped.raised.cents, 771_000);
  assert.equal(scoped.lifetimeRaised?.cents, 4_294_000);
  // ...but the campaign is still at 171.8% of its goal, not 30.8%.
  assert.equal(scoped.lifetimeGoalProgressPct, 171.8);
  assert.notEqual(scoped.lifetimeGoalProgressPct, 30.8, 'scoped numerator over lifetime goal');

  // Identical to the unscoped figure, which is the whole point.
  const unscoped = byCampaign().groups.find((g) => g.key === 'legal-defense-fund')!;
  assert.equal(scoped.lifetimeGoalProgressPct, unscoped.lifetimeGoalProgressPct);
});

test('goal progress stays null for a campaign with no goal, under any scope', () => {
  const march = resolveRange({ startISO: '2026-03-01', endISO: '2026-03-31' }, NOW_MS);
  for (const scope of [undefined, { range: march }]) {
    const g = byCampaign({ dimension: 'campaign', scope }).groups.find(
      (x) => x.key === 'scholarship-endowment'
    )!;
    assert.equal(g.lifetimeGoalProgressPct, null);
    assert.equal(g.goal, null);
  }
});

test('the ambiguous `goalProgressPct` name cannot come back', () => {
  // Renamed because, sitting inside a range-scoped result next to range-scoped
  // money, the old name read as "progress during this period". Both models
  // tested described it that way. The name is the fix, so guard it.
  for (const g of byCampaign().groups) {
    assert.ok(
      !('goalProgressPct' in g),
      'goal progress must be named lifetimeGoalProgressPct so it cannot be read as scoped'
    );
    assert.ok('lifetimeGoalProgressPct' in g);
  }
});

/**
 * Shared reporting layer. Pure functions over plain arrays -- no `ctx`, no `db`.
 *
 * Purity is the point: these can be unit-tested against a deterministic replica
 * of the seed without a Convex deployment running, which is how the numbers in
 * BASELINE.md are proven on every test run.
 *
 * The Convex queries in `convex/reporting.ts` are thin wrappers around these,
 * and the agent's tools call those same queries. One implementation, two
 * surfaces -- the dashboard and the assistant cannot disagree.
 */

import { averageCents, formatCents, sumCents } from './money.ts';
import {
  bucketKey,
  enumerateBuckets,
  isWithinRange,
  REPORTING_TIMEZONE,
  UNBOUNDED_RANGE,
  type Granularity,
  type ResolvedRange,
} from './time.ts';
import { countsAsRaised, partitionByStatus, type DonationStatus } from './status.ts';

/**
 * Structural, not `Doc<'donations'>`, so the offline replica rows satisfy it too.
 * A Convex document is assignable to this.
 */
export type DonationLike = {
  amountCents: number;
  feeCoveredCents: number;
  status: DonationStatus;
  frequency: DonationFrequency;
  donorEmail: string;
  campaignId: string;
  createdAt: number;
  anonymous?: boolean;
  donorName?: string;
};

/**
 * SCOPE = which slice of the business. Campaign and date ONLY.
 *
 * There is deliberately no `statuses` field here, and there never should be.
 * If callers could choose the status set, the agent could compute "raised" over
 * a different set than the dashboard, and the two would disagree while both
 * looked correct. Status is applied inside the aggregations below, always.
 */
export type DonationScope = {
  campaignIds?: readonly string[];
  range?: ResolvedRange;
};

export const FULL_SCOPE: DonationScope = {};

/** Donor identity is a normalised email. The same human giving twice is one donor. */
export function normalizeDonorEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Applies campaign + date scoping. Applies NO status rule -- callers that need
 * "raised" go through the aggregations, which apply it themselves.
 *
 * An absent campaign list means "all campaigns". An EMPTY list means "no
 * campaigns" and correctly returns nothing; those are different requests.
 */
export function filterDonationsByScope<T extends DonationLike>(
  rows: readonly T[],
  scope: DonationScope = FULL_SCOPE
): T[] {
  const campaignIds = scope.campaignIds ? new Set(scope.campaignIds) : null;
  const range = scope.range ?? UNBOUNDED_RANGE;
  return rows.filter((row) => {
    if (campaignIds && !campaignIds.has(row.campaignId)) return false;
    return isWithinRange(row.createdAt, range);
  });
}

function uniqueDonorCount(rows: readonly DonationLike[]): number {
  const seen = new Set<string>();
  for (const row of rows) seen.add(normalizeDonorEmail(row.donorEmail));
  return seen.size;
}

/** Median as integer cents, or null when empty. Sits beside the mean because the
 *  mean is skewed ~2.6x by the top gift tier. */
export function medianCents(rows: readonly DonationLike[]): number | null {
  if (rows.length === 0) return null;
  const sorted = rows.map((r) => r.amountCents).sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  if (sorted.length % 2 === 1) return sorted[mid];
  return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

export type MoneyFigure = { cents: number; formatted: string };

const money = (cents: number): MoneyFigure => ({ cents, formatted: formatCents(cents) });

const optionalMoney = (cents: number | null): MoneyFigure | null =>
  cents === null ? null : money(cents);

export type StatsResult = {
  /** succeeded only -- the headline "total raised" */
  raised: MoneyFigure;
  donationCount: number;
  uniqueDonorCount: number;
  repeatDonorCount: number;
  averageGift: MoneyFigure | null;
  medianGift: MoneyFigure | null;
  /** what the donor covered on top; NOT part of raised */
  feesCovered: MoneyFigure;
  /** raised + feesCovered -- what actually hit the cards */
  charged: MoneyFigure;
  /** money that is not raised, broken out so status never has to be a filter */
  pending: MoneyFigure & { count: number };
  failed: MoneyFigure & { count: number };
  refunded: MoneyFigure & { count: number };
  /** every row in scope regardless of status */
  rowsInScope: number;
  scope: {
    campaignIds: readonly string[] | null;
    range: ResolvedRange;
  };
  /**
   * Makes an empty result SELF-DESCRIBING. A bare empty response invites a
   * model (or a reader) to fill the gap; "0 rows matched, data covers X..Y"
   * supports an honest answer instead.
   */
  coverage: {
    totalRowsInDataset: number;
    datasetMinISO: string | null;
    datasetMaxISO: string | null;
  };
};

/**
 * `allRows` is the full unscoped set: scoping happens inside so that `coverage`
 * can describe the whole dataset even when the scope matches nothing.
 */
export function computeStats(
  allRows: readonly DonationLike[],
  scope: DonationScope = FULL_SCOPE
): StatsResult {
  const inScope = filterDonationsByScope(allRows, scope);
  const byStatus = partitionByStatus(inScope);
  const succeeded = byStatus.succeeded;

  const raisedCents = sumCents(succeeded.map((r) => r.amountCents));
  const feesCents = sumCents(succeeded.map((r) => r.feeCoveredCents));

  const giftsByDonor = new Map<string, number>();
  for (const row of succeeded) {
    const key = normalizeDonorEmail(row.donorEmail);
    giftsByDonor.set(key, (giftsByDonor.get(key) ?? 0) + 1);
  }
  let repeatDonorCount = 0;
  for (const count of giftsByDonor.values()) if (count > 1) repeatDonorCount += 1;

  const statusFigure = (rows: readonly DonationLike[]) => ({
    ...money(sumCents(rows.map((r) => r.amountCents))),
    count: rows.length,
  });

  const timestamps = allRows.map((r) => r.createdAt);

  return {
    raised: money(raisedCents),
    donationCount: succeeded.length,
    uniqueDonorCount: giftsByDonor.size,
    repeatDonorCount,
    averageGift: optionalMoney(averageCents(raisedCents, succeeded.length)),
    medianGift: optionalMoney(medianCents(succeeded)),
    feesCovered: money(feesCents),
    charged: money(raisedCents + feesCents),
    pending: statusFigure(byStatus.pending),
    failed: statusFigure(byStatus.failed),
    refunded: statusFigure(byStatus.refunded),
    rowsInScope: inScope.length,
    scope: {
      campaignIds: scope.campaignIds ?? null,
      range: scope.range ?? { ...UNBOUNDED_RANGE, timezone: REPORTING_TIMEZONE },
    },
    coverage: {
      totalRowsInDataset: allRows.length,
      datasetMinISO:
        timestamps.length === 0 ? null : new Date(Math.min(...timestamps)).toISOString(),
      datasetMaxISO:
        timestamps.length === 0 ? null : new Date(Math.max(...timestamps)).toISOString(),
    },
  };
}

/** Sum of succeeded `amountCents`. The one-liner the rest of the codebase reuses. */
export function computeRaisedCents(
  rows: readonly DonationLike[],
  scope: DonationScope = FULL_SCOPE
): number {
  return sumCents(
    filterDonationsByScope(rows, scope)
      .filter((r) => countsAsRaised(r.status))
      .map((r) => r.amountCents)
  );
}

export { uniqueDonorCount };

// ── Breakdown ────────────────────────────────────────────────────────────────

export const DONATION_FREQUENCIES = ['one_time', 'monthly'] as const;
export type DonationFrequency = (typeof DONATION_FREQUENCIES)[number];

export const BREAKDOWN_DIMENSIONS = ['campaign', 'frequency'] as const;
export type BreakdownDimension = (typeof BREAKDOWN_DIMENSIONS)[number];

export const BREAKDOWN_SORTS = ['raised', 'donationCount', 'uniqueDonorCount'] as const;
export type BreakdownSort = (typeof BREAKDOWN_SORTS)[number];

/** Structural, so both `Doc<'campaigns'>` and test fixtures satisfy it. */
export type CampaignLike = {
  _id: string;
  name: string;
  slug: string;
  status: 'draft' | 'active' | 'ended';
  goalCents?: number;
};

export type BreakdownGroup = {
  key: string;
  label: string;
  raised: MoneyFigure;
  donationCount: number;
  uniqueDonorCount: number;
  averageGift: MoneyFigure | null;
  feesCovered: MoneyFigure;
  charged: MoneyFigure;
  /** share of the scoped total; null when the scoped total is zero */
  shareOfTotalPct: number | null;
  /** campaign dimension only */
  campaignStatus?: CampaignLike['status'];
  goal?: MoneyFigure | null;
  /**
   * TRUE percent, uncapped -- two seeded campaigns are over goal (171.8%, 199.0%).
   * Clamping belongs to the progress bar, not to the number. null when the
   * campaign has no goal, so nothing ever divides by zero or renders Infinity.
   */
  goalProgressPct?: number | null;
};

/** One decimal place, computed from a ratio so the rounding happens once. */
function toPercent(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function summarize(rows: readonly DonationLike[]) {
  const raisedCents = sumCents(rows.map((r) => r.amountCents));
  const feesCents = sumCents(rows.map((r) => r.feeCoveredCents));
  return {
    raised: money(raisedCents),
    donationCount: rows.length,
    uniqueDonorCount: uniqueDonorCount(rows),
    averageGift: optionalMoney(averageCents(raisedCents, rows.length)),
    feesCovered: money(feesCents),
    charged: money(raisedCents + feesCents),
  };
}

/**
 * Groups succeeded gifts by campaign or frequency.
 *
 * Groups are built from the CATALOG (the campaign list, or the fixed frequency
 * enum), not from the donations. Grouping over the rows would silently drop any
 * campaign with no gifts -- and "this campaign has raised nothing" is exactly
 * the fact a fundraising dashboard must not hide.
 *
 * Ordering is fully deterministic: the sort metric descending, then label, then
 * key. Ties are extremely common in this dataset, and an unstable order would
 * let the dashboard and the agent disagree about rank while both are "correct".
 */
export function computeBreakdown(
  allRows: readonly DonationLike[],
  campaigns: readonly CampaignLike[],
  options: {
    dimension: BreakdownDimension;
    scope?: DonationScope;
    sortBy?: BreakdownSort;
  }
): { dimension: BreakdownDimension; sortBy: BreakdownSort; groups: BreakdownGroup[] } {
  const scope = options.scope ?? FULL_SCOPE;
  const sortBy = options.sortBy ?? 'raised';

  const inScope = filterDonationsByScope(allRows, scope);
  const succeeded = partitionByStatus(inScope).succeeded;
  const scopedTotalCents = sumCents(succeeded.map((r) => r.amountCents));

  const groups: BreakdownGroup[] = [];

  if (options.dimension === 'campaign') {
    // Respect an explicit campaign scope; otherwise every known campaign.
    const requested = scope.campaignIds ? new Set(scope.campaignIds) : null;
    const visible = requested ? campaigns.filter((c) => requested.has(c._id)) : campaigns;

    for (const campaign of visible) {
      const rows = succeeded.filter((r) => r.campaignId === campaign._id);
      const summary = summarize(rows);
      const hasGoal = typeof campaign.goalCents === 'number' && campaign.goalCents > 0;
      groups.push({
        key: campaign._id,
        label: campaign.name,
        ...summary,
        shareOfTotalPct: toPercent(summary.raised.cents, scopedTotalCents),
        campaignStatus: campaign.status,
        goal: hasGoal ? money(campaign.goalCents as number) : null,
        goalProgressPct: hasGoal
          ? toPercent(summary.raised.cents, campaign.goalCents as number)
          : null,
      });
    }
  } else {
    for (const frequency of DONATION_FREQUENCIES) {
      const rows = succeeded.filter((r) => r.frequency === frequency);
      const summary = summarize(rows);
      groups.push({
        key: frequency,
        label: frequency === 'one_time' ? 'One-time' : 'Monthly',
        ...summary,
        shareOfTotalPct: toPercent(summary.raised.cents, scopedTotalCents),
      });
    }
  }

  const metric = (g: BreakdownGroup) =>
    sortBy === 'raised'
      ? g.raised.cents
      : sortBy === 'donationCount'
        ? g.donationCount
        : g.uniqueDonorCount;

  groups.sort(
    (a, b) =>
      metric(b) - metric(a) || a.label.localeCompare(b.label) || a.key.localeCompare(b.key)
  );

  return { dimension: options.dimension, sortBy, groups };
}

// ── Timeseries ───────────────────────────────────────────────────────────────

export type TimeseriesBucket = {
  key: string;
  startISO: string;
  raised: MoneyFigure;
  donationCount: number;
  /**
   * Donors unique WITHIN this bucket. These deliberately do not sum to the
   * period total -- a donor giving in March and April is one person overall but
   * counted in both buckets. Summing this column is always wrong.
   */
  uniqueDonorCount: number;
  /** Running total across the returned buckets, for a progress-to-goal line. */
  cumulativeRaised: MoneyFigure;
};

export type TimeseriesResult = {
  granularity: Granularity;
  timezone: string;
  buckets: TimeseriesBucket[];
  totalRaised: MoneyFigure;
  /** Buckets containing no succeeded gifts. Surfaced so a flat chart is explicable. */
  emptyBucketCount: number;
  coverage: StatsResult['coverage'];
};

/**
 * Bucketed money over time, with every empty bucket present.
 *
 * When the scope has no explicit range, the window is derived from the SCOPED
 * rows' own first and last gift, so "all time" on a campaign page means that
 * campaign's lifetime rather than the whole dataset's. With an explicit range,
 * the range wins outright -- including when it contains nothing, which is how a
 * legitimately empty period stays visible instead of collapsing to no chart.
 */
export function computeTimeseries(
  allRows: readonly DonationLike[],
  options: {
    granularity: Granularity;
    scope?: DonationScope;
  }
): TimeseriesResult {
  const scope = options.scope ?? FULL_SCOPE;
  const { granularity } = options;

  const inScope = filterDonationsByScope(allRows, scope);
  const succeeded = partitionByStatus(inScope).succeeded;

  const range = scope.range ?? UNBOUNDED_RANGE;
  let startMs = range.startMs;
  let endMs = range.endMs;

  if (startMs === null || endMs === null) {
    const timestamps = succeeded.map((r) => r.createdAt);
    if (timestamps.length === 0) {
      startMs = null;
      endMs = null;
    } else {
      // +1ms so the final gift's own bucket is included by the exclusive bound.
      if (startMs === null) startMs = Math.min(...timestamps);
      if (endMs === null) endMs = Math.max(...timestamps) + 1;
    }
  }

  const skeleton =
    startMs === null || endMs === null ? [] : enumerateBuckets(startMs, endMs, granularity);

  const grouped = new Map<string, DonationLike[]>();
  for (const row of succeeded) {
    const key = bucketKey(row.createdAt, granularity);
    const existing = grouped.get(key);
    if (existing) existing.push(row);
    else grouped.set(key, [row]);
  }

  let running = 0;
  let emptyBucketCount = 0;
  const buckets: TimeseriesBucket[] = skeleton.map(({ key, startMs: bucketStart }) => {
    const rows = grouped.get(key) ?? [];
    if (rows.length === 0) emptyBucketCount += 1;
    const raisedCents = sumCents(rows.map((r) => r.amountCents));
    running += raisedCents;
    return {
      key,
      startISO: new Date(bucketStart).toISOString(),
      raised: money(raisedCents),
      donationCount: rows.length,
      uniqueDonorCount: uniqueDonorCount(rows),
      cumulativeRaised: money(running),
    };
  });

  const allTimestamps = allRows.map((r) => r.createdAt);

  return {
    granularity,
    timezone: REPORTING_TIMEZONE,
    buckets,
    totalRaised: money(sumCents(succeeded.map((r) => r.amountCents))),
    emptyBucketCount,
    coverage: {
      totalRowsInDataset: allRows.length,
      datasetMinISO:
        allTimestamps.length === 0 ? null : new Date(Math.min(...allTimestamps)).toISOString(),
      datasetMaxISO:
        allTimestamps.length === 0 ? null : new Date(Math.max(...allTimestamps)).toISOString(),
    },
  };
}

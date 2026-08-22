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
  isWithinRange,
  REPORTING_TIMEZONE,
  UNBOUNDED_RANGE,
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

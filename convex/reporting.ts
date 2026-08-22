import { v } from 'convex/values';
import { query } from './_generated/server';
import {
  BREAKDOWN_DIMENSIONS,
  BREAKDOWN_SORTS,
  computeBreakdown,
  computeDonorRollup,
  computeStats,
  computeTimeseries,
  DONOR_SORTS,
  filterDonationsByScope,
  normalizeDonorEmail,
  type CampaignLike,
  type DonationLike,
  type DonationScope,
} from './lib/reporting';
import { RANGE_PRESETS, resolveRange, type RangeSpec } from './lib/time';
import { partitionByStatus } from './lib/status';

/**
 * Reporting queries. Thin wrappers around the pure functions in lib/ -- this is
 * the ONLY place the aggregation is exposed, and the agent's tools call these
 * same queries via ctx.runQuery. One implementation, two surfaces: the dashboard
 * and the assistant cannot disagree about a number.
 *
 * READ STRATEGY: every query collects the whole donations table.
 *
 * That is deliberate, not an oversight. `computeStats` and `computeTimeseries`
 * take the UNSCOPED rows so `coverage` can report the dataset's true bounds even
 * when the scope matches nothing -- which is what lets an empty period answer
 * "$0.00, and the most recent gift is 2026-06-29" instead of a bare zero. An
 * indexed range read returns no rows for an empty period, so coverage would go
 * null and that guarantee would quietly disappear. Restoring it would need a
 * second query for dataset bounds, i.e. two sources of truth for "what is the
 * dataset" -- the exact drift this design exists to prevent.
 *
 * At 283 rows this is correct and instant. See NOTES.md for the ceiling and what
 * production would do instead.
 */

const rangeValidator = v.union(
  v.object({ preset: v.union(...RANGE_PRESETS.map((p) => v.literal(p))) }),
  v.object({ startISO: v.string(), endISO: v.string() })
);

/**
 * The shared scope contract. Campaign and date only -- there is deliberately no
 * `statuses` argument, and there must never be one. If a caller could choose the
 * status set, the agent could compute "raised" over a different set than the
 * dashboard and both would look correct.
 */
export const scopeArgs = {
  campaignIds: v.optional(v.array(v.id('campaigns'))),
  range: v.optional(rangeValidator),
} as const;

type ScopeArgs = {
  campaignIds?: string[];
  range?: RangeSpec;
};

/** Convex freezes Date.now() for the duration of a function, so this is deterministic. */
function toScope(args: ScopeArgs): DonationScope {
  return {
    campaignIds: args.campaignIds,
    range: args.range ? resolveRange(args.range, Date.now()) : undefined,
  };
}

const loadDonations = async (ctx: { db: any }): Promise<DonationLike[]> =>
  ctx.db.query('donations').collect();

const loadCampaigns = async (ctx: { db: any }): Promise<CampaignLike[]> =>
  ctx.db.query('campaigns').collect();

/** KPI scalars. Answers "how much did we raise" and "how many gave more than once". */
export const stats = query({
  args: scopeArgs,
  handler: async (ctx, args) => computeStats(await loadDonations(ctx), toScope(args)),
});

/** Grouped totals. Answers "which campaign is doing best" and campaign comparisons. */
export const breakdown = query({
  args: {
    ...scopeArgs,
    dimension: v.optional(v.union(...BREAKDOWN_DIMENSIONS.map((d) => v.literal(d)))),
    sortBy: v.optional(v.union(...BREAKDOWN_SORTS.map((s) => v.literal(s)))),
  },
  handler: async (ctx, args) =>
    computeBreakdown(await loadDonations(ctx), await loadCampaigns(ctx), {
      dimension: args.dimension ?? 'campaign',
      sortBy: args.sortBy,
      scope: toScope(args),
    }),
});

/** Money over time, with every empty bucket present. */
export const timeseries = query({
  args: {
    ...scopeArgs,
    granularity: v.optional(v.union(v.literal('day'), v.literal('week'), v.literal('month'))),
  },
  handler: async (ctx, args) =>
    computeTimeseries(await loadDonations(ctx), {
      granularity: args.granularity ?? 'day',
      scope: toScope(args),
    }),
});

/**
 * Donor rollups, ranked. `limit` is clamped in the pure layer (max 100) and the
 * result carries totalMatched/truncated so no caller can imply it saw everything.
 */
export const topDonors = query({
  args: {
    ...scopeArgs,
    sortBy: v.optional(v.union(...DONOR_SORTS.map((s) => v.literal(s)))),
    limit: v.optional(v.number()),
    minGiftCount: v.optional(v.number()),
  },
  handler: async (ctx, args) =>
    computeDonorRollup(await loadDonations(ctx), {
      scope: toScope(args),
      sortBy: args.sortBy,
      limit: args.limit,
      minGiftCount: args.minGiftCount,
    }),
});

const MAX_RECENT = 100;

/**
 * Individual succeeded gifts, newest first, for the dashboard's recent list.
 *
 * Donor identity is redacted here rather than at the component: the anonymity
 * rule is a correctness concern, so it is applied server-side where it cannot be
 * forgotten by a caller. NOTE this is per-GIFT redaction, which is the right
 * behaviour for a feed of individual gifts -- the per-DONOR rule in
 * computeDonorRollup is a different question and deliberately answers differently.
 */
export const recentDonations = query({
  args: { ...scopeArgs, limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(1, args.limit ?? 10), MAX_RECENT);
    const rows = filterDonationsByScope(await loadDonations(ctx), toScope(args));
    const succeeded = partitionByStatus(rows).succeeded.sort(
      (a, b) => b.createdAt - a.createdAt || normalizeDonorEmail(a.donorEmail).localeCompare(normalizeDonorEmail(b.donorEmail))
    );
    return {
      donations: succeeded.slice(0, limit).map((d) => ({
        amountCents: d.amountCents,
        feeCoveredCents: d.feeCoveredCents,
        frequency: d.frequency,
        campaignId: d.campaignId,
        createdAt: d.createdAt,
        createdAtISO: new Date(d.createdAt).toISOString(),
        isAnonymous: d.anonymous === true,
        donorName: d.anonymous === true ? null : (d.donorName?.trim() || null),
      })),
      totalMatched: succeeded.length,
      truncated: succeeded.length > limit,
      limit,
    };
  },
});

/**
 * Campaign catalog: identity and goal only, no aggregates.
 *
 * This is how the agent resolves "the meal drive" to an id before asking a
 * money question, and it is why the resolution step is visible in the tool log
 * instead of hidden inside a fuzzy server-side name match.
 */
export const campaigns = query({
  args: {},
  handler: async (ctx) =>
    (await loadCampaigns(ctx)).map((c) => ({
      _id: c._id,
      name: c.name,
      slug: c.slug,
      status: c.status,
      goalCents: c.goalCents ?? null,
    })),
});

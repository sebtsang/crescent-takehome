import { v } from 'convex/values';
import { mutation, query } from './_generated/server';

/**
 * PUBLIC: record a gift. Reference implementation — read it before you write
 * yours.
 *
 * There is no payment processor in this exercise. A donation is created as
 * `pending`, exactly as it would be before a real charge settles. Nothing here
 * should ever create a row already marked `succeeded`.
 */
export const create = mutation({
  args: {
    campaignId: v.id('campaigns'),
    amountCents: v.number(),
    feeCoveredCents: v.optional(v.number()),
    frequency: v.union(v.literal('one_time'), v.literal('monthly')),
    donorEmail: v.string(),
    donorName: v.optional(v.string()),
    anonymous: v.optional(v.boolean()),
    note: v.optional(v.string()),
    dedication: v.optional(
      v.object({
        honoreeName: v.string(),
        honoreeEmail: v.optional(v.string()),
        kind: v.union(v.literal('honor'), v.literal('memory')),
      })
    ),
  },
  handler: async (ctx, args) => {
    const campaign = await ctx.db.get(args.campaignId);
    // Refusing a gift to a draft or ended campaign is a server-side rule.
    // Hiding the button in the UI is not a rule, it is a suggestion.
    if (!campaign || campaign.status !== 'active') {
      throw new Error('Campaign is not accepting donations');
    }

    // Integers only, and a floor. Without the integer check a donor could
    // send 10.5 cents and every downstream total inherits a fraction.
    if (!Number.isInteger(args.amountCents) || args.amountCents < 100) {
      throw new Error('Amount must be a whole number of cents, minimum 100');
    }

    const email = args.donorEmail.trim().toLowerCase();
    if (!email.includes('@')) throw new Error('A valid email is required');

    return ctx.db.insert('donations', {
      campaignId: args.campaignId,
      amountCents: args.amountCents,
      feeCoveredCents: args.feeCoveredCents ?? 0,
      frequency: args.frequency,
      status: 'pending',
      donorEmail: email,
      donorName: args.donorName?.trim() || undefined,
      anonymous: args.anonymous,
      note: args.note?.trim() || undefined,
      dedication: args.dedication,
      createdAt: Date.now(),
    });
  },
});

/** INTERNAL: raw rows for one campaign. Deliberately unpaginated — see below. */
export const listByCampaign = query({
  args: { campaignId: v.id('campaigns') },
  handler: async (ctx, { campaignId }) =>
    ctx.db
      .query('donations')
      .withIndex('by_campaign', (q) => q.eq('campaignId', campaignId))
      .collect(),
});

/**
 * Reporting lives in `convex/reporting.ts`, which wraps the pure aggregation in
 * `convex/lib/`. These two are re-exported here because the brief names these
 * paths -- they are the SAME function objects, not parallel implementations.
 *
 * On `listByCampaign` above collecting every row, and why these queries do the
 * same: `computeStats` and `computeTimeseries` take the UNSCOPED rows so that
 * `coverage` can report the dataset's real bounds even when the scope matches
 * nothing. That is what lets an empty period answer "$0.00, and the most recent
 * gift is 2026-06-29" rather than a bare zero the caller has to interpret. An
 * indexed range read returns nothing for an empty period, so coverage would go
 * null and that guarantee would vanish silently.
 *
 * Correct and instant at 283 rows; it will not survive hundreds of thousands.
 * NOTES.md records the ceiling and what production would do instead.
 */
export { stats, timeseries } from './reporting';

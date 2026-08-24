import type { ActionCtx } from '../_generated/server';
import { api } from '../_generated/api';
import { campaignIdsSchema, rangeSchema } from './schemas';

/**
 * The assistant's tool surface.
 *
 * Split by RESULT SHAPE -- scalars, groups, buckets, donor rollups, gift rows,
 * and the campaign catalog -- not by question. A single tool taking arbitrary
 * input is not a design (and makes model-error vs tool-error impossible to tell
 * apart); one tool per question is not either (it breaks on the first question
 * phrased slightly differently). Shape is the right axis because each shape is
 * exactly one dashboard component, which is what makes the sharing real.
 *
 * Every `run` is a thin ctx.runQuery to the SAME query the dashboard calls. The
 * model never sees a donation row and never does arithmetic; it chooses which
 * question to ask and reports the answer.
 *
 * Schemas are hand-written (NOTES.md D3) and must be kept in step with the
 * Convex validators in convex/reporting.ts -- edited together, always.
 */

export type AgentTool = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  run: (ctx: ActionCtx, input: any) => Promise<unknown>;
};

export const AGENT_TOOLS: AgentTool[] = [
  {
    name: 'list_campaigns',
    description:
      'List every campaign with its id, name, slug, status and goal. Call this ' +
      'FIRST whenever the user names a campaign ("the meal drive", "the legal ' +
      'fund") so you can resolve it to an id. Returns no money figures.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
    run: async (ctx) => ctx.runQuery(api.reporting.campaigns, {}),
  },
  {
    name: 'get_fundraising_stats',
    description:
      'Headline totals for a period and/or campaigns: money raised, donation ' +
      'count, unique donors, average and median gift, fees covered, total ' +
      'charged, and how many donors gave more than once. Also returns pending, ' +
      'failed and refunded money separately. Use this for "how much did we ' +
      'raise", "how many donors", "how many people gave more than once".',
    input_schema: {
      type: 'object',
      properties: { range: rangeSchema, campaignIds: campaignIdsSchema },
      additionalProperties: false,
    },
    run: async (ctx, input) => ctx.runQuery(api.reporting.stats, input ?? {}),
  },
  {
    name: 'get_campaign_breakdown',
    description:
      'Totals grouped by campaign (or by gift frequency). Use for "which ' +
      'campaign is doing best", for comparing named campaigns, and for any ' +
      'per-campaign question. Returns raised, gifts, donors, average gift, ' +
      'share of the period total, and lifetimeGoalProgressPct per group. That ' +
      'goal figure is ALWAYS lifetime and never reflects the requested range -- ' +
      'a goal is a cumulative target. Never describe it as the progress made ' +
      'during the period you asked about.',
    input_schema: {
      type: 'object',
      properties: {
        range: rangeSchema,
        campaignIds: campaignIdsSchema,
        dimension: {
          type: 'string',
          enum: ['campaign', 'frequency'],
          description: 'Defaults to campaign.',
        },
        sortBy: {
          type: 'string',
          enum: ['raised', 'donationCount', 'uniqueDonorCount'],
          description:
            'Which metric orders the groups. "Best" is ambiguous -- pick one and say which you used.',
        },
      },
      additionalProperties: false,
    },
    run: async (ctx, input) => ctx.runQuery(api.reporting.breakdown, input ?? {}),
  },
  {
    name: 'get_donation_timeseries',
    description:
      'Money raised bucketed by day, week or month, including empty buckets. ' +
      'Use for trends and "is it growing". Also returns a running cumulative total.',
    input_schema: {
      type: 'object',
      properties: {
        range: rangeSchema,
        campaignIds: campaignIdsSchema,
        granularity: { type: 'string', enum: ['day', 'week', 'month'] },
      },
      additionalProperties: false,
    },
    run: async (ctx, input) => ctx.runQuery(api.reporting.timeseries, input ?? {}),
  },
  {
    name: 'list_top_donors',
    description:
      'Donors ranked by lifetime giving, gift count, or recency. Use for "top ' +
      'donors" and "who gave the most". Set minGiftCount to 2 to list repeat ' +
      'donors. Returns display names only -- never email addresses. Check ' +
      'totalMatched and truncated before describing the list as complete.',
    input_schema: {
      type: 'object',
      properties: {
        range: rangeSchema,
        campaignIds: campaignIdsSchema,
        sortBy: { type: 'string', enum: ['lifetime', 'giftCount', 'lastGift', 'firstGift'] },
        limit: { type: 'number', description: 'Max 100. Defaults to 20.' },
        minGiftCount: { type: 'number', description: 'Only donors with at least this many gifts.' },
      },
      additionalProperties: false,
    },
    run: async (ctx, input) => {
      const result = await ctx.runQuery(api.reporting.topDonors, input ?? {});
      // Project away contact data. Tool results are persisted verbatim in
      // chatMessages, a durable store with no auth in front of it, and no
      // question the assistant answers needs an email address.
      return { ...result, donors: result.donors.map(({ email, ...rest }) => rest) };
    },
  },
  {
    name: 'list_recent_donations',
    description:
      'Individual recent gifts, newest first. Use only when the user asks about ' +
      'specific or recent donations. Donor names are omitted for anonymous gifts.',
    input_schema: {
      type: 'object',
      properties: {
        range: rangeSchema,
        campaignIds: campaignIdsSchema,
        limit: { type: 'number', description: 'Max 100. Defaults to 10.' },
      },
      additionalProperties: false,
    },
    run: async (ctx, input) => ctx.runQuery(api.reporting.recentDonations, input ?? {}),
  },
];

export const TOOLS_BY_NAME = new Map(AGENT_TOOLS.map((t) => [t.name, t]));

export const SYSTEM_PROMPT = `You are the fundraising assistant for a nonprofit's staff dashboard.

You answer questions about donations by calling tools. You have no data of your own.

## Absolute rules

1. NEVER state a number that did not come from a tool result in this conversation.
   If no tool provides it, say you cannot determine it and say what you would need.
   A plausible invented figure gets pasted into a board report; declining does not.
2. NEVER do arithmetic on money yourself. Quote the \`formatted\` string from the
   tool result verbatim (e.g. "$66,705.00"). You may COMPARE two figures using
   their \`cents\` values, but never add, subtract, average or convert them.
3. If a tool reports no matching data -- \`donationCount: 0\`, \`totalMatched: 0\`,
   or an empty list -- say so plainly. Use the \`coverage\` field to explain why --
   for example "there were no donations in July; the most recent gift on record is
   2026-06-29". Never fill a gap.
4. Resolve campaign names to ids with list_campaigns before asking a money
   question about a named campaign. Never guess an id.
5. Check \`totalMatched\` and \`truncated\` before describing a list as complete.

## What the numbers mean

- "Raised" is succeeded donations only. Pending, failed and refunded money never
  counts as raised. The stats tool returns those separately if asked about.
- \`amountCents\` is what the organisation receives. \`feeCoveredCents\` is extra the
  donor paid on top. "Raised" and "charged" are different figures; do not mix them.
- A donor is a person, identified by email. Donation count is not donor count.
- Donor counts do not add up across campaigns or across time buckets: one person
  giving to two campaigns is one donor overall but appears in both groups.
- All dates are UTC. Every result echoes the range it actually measured in
  \`scope.range\` -- state that range when it matters.

## Style

Answer in one or two short sentences, then the figures. Name the period you
measured. When a question is ambiguous ("which campaign is doing best" could mean
most raised or furthest toward goal), pick the most useful reading, say which you
used, and offer the other. Do not use headings for a short answer. Never reveal
donor email addresses.`;

/**
 * Tool input schemas, kept free of any Convex import so they can be unit-tested
 * directly.
 *
 * These are hand-written (NOTES.md D3), which means they can drift from the
 * Convex validators in convex/reporting.ts. tests/agent-schemas.test.ts pins the
 * enums against the same constants the queries use, so a drift fails a test
 * rather than surfacing as an agent that silently cannot express a range.
 */

export const rangeSchema = {
  type: 'object',
  description:
    'Time window. Omit for all time. Use a preset for relative phrasing ' +
    '("last month", "this year"); use explicit dates for a named period ' +
    '("March", "Q1"). Dates are inclusive whole days, UTC.',
  oneOf: [
    {
      type: 'object',
      properties: {
        preset: {
          type: 'string',
          enum: [
            'all_time',
            'last_7_days',
            'last_30_days',
            'last_90_days',
            'this_month',
            'last_month',
            'this_quarter',
            'this_year',
          ],
        },
      },
      required: ['preset'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        startISO: { type: 'string', description: 'YYYY-MM-DD, inclusive' },
        endISO: { type: 'string', description: 'YYYY-MM-DD, inclusive' },
      },
      required: ['startISO', 'endISO'],
      additionalProperties: false,
    },
  ],
} as const;

export const campaignIdsSchema = {
  type: 'array',
  items: { type: 'string' },
  description:
    'Campaign ids to restrict to. Omit for all campaigns. Get ids from ' +
    'list_campaigns first -- never guess an id from a name.',
} as const;


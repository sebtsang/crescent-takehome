import assert from 'node:assert/strict';
import test from 'node:test';

import { campaignIdsSchema, rangeSchema } from '../convex/agent/schemas.ts';
import { RANGE_PRESETS } from '../convex/lib/time.ts';
import {
  BREAKDOWN_DIMENSIONS,
  BREAKDOWN_SORTS,
  DONOR_SORTS,
  MAX_DONOR_LIMIT,
} from '../convex/lib/reporting.ts';

/**
 * The tool schemas are hand-maintained (D3), so their one real risk is drifting
 * from the Convex validators they mirror. These pin them together.
 */

test('the tool range presets match the reporting layer exactly', () => {
  const branch = rangeSchema.oneOf.find((b) => 'preset' in b.properties)!;
  const schemaPresets = (branch.properties as any).preset.enum as string[];
  assert.deepEqual(
    [...schemaPresets].sort(),
    [...RANGE_PRESETS].sort(),
    'tool schema presets have drifted from RANGE_PRESETS'
  );
});

test('the explicit-date branch requires both bounds', () => {
  const branch = rangeSchema.oneOf.find((b) => 'startISO' in b.properties)!;
  assert.deepEqual([...branch.required].sort(), ['endISO', 'startISO']);
  assert.equal(branch.additionalProperties, false);
});

test('no schema permits extra properties', () => {
  // additionalProperties:false is what stops the model inventing an argument --
  // most importantly a `statuses` filter, which must never exist.
  for (const branch of rangeSchema.oneOf) {
    assert.equal(branch.additionalProperties, false);
  }
  assert.equal(campaignIdsSchema.type, 'array');
});

test('no tool schema exposes a status filter', () => {
  const serialized = JSON.stringify({ rangeSchema, campaignIdsSchema });
  assert.ok(!/statuses/i.test(serialized), 'status must never be model-selectable');
});

test('reporting enums the schemas mirror are unchanged', () => {
  // If these change, the corresponding tool schema enum must change with them.
  assert.deepEqual([...BREAKDOWN_DIMENSIONS], ['campaign', 'frequency']);
  assert.deepEqual([...BREAKDOWN_SORTS], ['raised', 'donationCount', 'uniqueDonorCount']);
  assert.deepEqual([...DONOR_SORTS], ['lifetime', 'giftCount', 'lastGift', 'firstGift']);
  assert.equal(MAX_DONOR_LIMIT, 100, 'the limit quoted in the tool description');
});

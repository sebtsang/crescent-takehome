import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CampaignLike, DonationLike } from '../convex/lib/reporting.ts';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * The 283 seeded rows, regenerated offline from the seed's PRNG.
 * `scripts/verify-baseline.mjs` proves these are field-for-field identical to
 * what is actually in Convex, so asserting against them is equivalent to
 * asserting against the database -- without needing a deployment to run tests.
 */
export function loadReplicaDonations(): DonationLike[] {
  const stdout = execFileSync('node', [path.join(here, '..', 'scripts', 'seed-replica.mjs')], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const { donations } = JSON.parse(stdout);
  // The replica carries campaignSlug; the pure layer keys on campaignId, which
  // is an opaque string. Using the slug as the id keeps tests readable.
  return donations.map((d: DonationLike & { campaignSlug: string }) => ({
    ...d,
    campaignId: d.campaignSlug,
  }));
}

/** Fixed "today" so every relative-range assertion is reproducible. */
export const NOW_MS = Date.parse('2026-08-22T00:00:00.000Z');

/**
 * The five seeded campaigns. The replica has no Convex ids, so the slug doubles
 * as `_id` -- consistent with donations using `campaignSlug` as `campaignId`.
 * Identity is all the pure layer needs; the shape of the id is irrelevant to it.
 */
export function loadReplicaCampaigns(): CampaignLike[] {
  const stdout = execFileSync('node', [path.join(here, '..', 'scripts', 'seed-replica.mjs')], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const { campaigns } = JSON.parse(stdout);
  return campaigns.map((c: Omit<CampaignLike, '_id'>) => ({ ...c, _id: c.slug }));
}

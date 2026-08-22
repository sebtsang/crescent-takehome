import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ANONYMOUS_DONOR_LABEL,
  computeDonorRollup,
  computeStats,
  DEFAULT_DONOR_LIMIT,
  MAX_DONOR_LIMIT,
  type DonationLike,
} from '../convex/lib/reporting.ts';
import { resolveRange } from '../convex/lib/time.ts';
import { loadReplicaDonations, NOW_MS } from './fixtures.ts';

const ROWS = loadReplicaDonations();

/** Minimal synthetic gift, for exercising rules the seed does not contain. */
const gift = (over: Partial<DonationLike> = {}): DonationLike => ({
  amountCents: 10_000,
  feeCoveredCents: 0,
  status: 'succeeded',
  frequency: 'one_time',
  donorEmail: 'a@b.com',
  campaignId: 'c1',
  createdAt: Date.parse('2026-03-01T00:00:00.000Z'),
  ...over,
});

// ── the top-donor tie ────────────────────────────────────────────────────────

test('top donors reproduce the baseline, with ranks 3-10 deterministic', () => {
  const { donors, totalMatched, truncated } = computeDonorRollup(ROWS, { limit: 10 });

  assert.equal(totalMatched, 223);
  assert.equal(truncated, true, 'ten of 223 is a partial view and must say so');
  assert.equal(donors.length, 10);

  assert.equal(donors[0].email, 'amina.haddad@example.org');
  assert.equal(donors[0].lifetime.formatted, '$3,435.00');
  assert.equal(donors[0].giftCount, 11);
  assert.equal(donors[1].email, 'wei.kim@example.org');
  assert.equal(donors[1].lifetime.formatted, '$3,110.00');
  assert.equal(donors[1].giftCount, 13);

  // Everything below rank 2 is tied at $1,000 and ordered by email.
  const tail = donors.slice(2);
  assert.ok(tail.every((d) => d.lifetime.cents === 100_000));
  assert.deepEqual(
    tail.map((d) => d.email),
    [...tail.map((d) => d.email)].sort(),
    'ties must be ordered by the email tiebreak'
  );
  assert.equal(tail[0].email, 'amina.kim101@example.org');
});

test('32 donors tie at exactly $1,000 -- the reason a tiebreak is required', () => {
  const { donors } = computeDonorRollup(ROWS, { limit: MAX_DONOR_LIMIT });
  assert.equal(donors.filter((d) => d.lifetime.cents === 100_000).length, 32);
});

test('ordering is stable across repeated calls', () => {
  const first = computeDonorRollup(ROWS, { limit: 40 }).donors.map((d) => d.email);
  for (let i = 0; i < 5; i += 1) {
    assert.deepEqual(computeDonorRollup(ROWS, { limit: 40 }).donors.map((d) => d.email), first);
  }
});

// ── limits and truncation ────────────────────────────────────────────────────

test('limits are clamped server-side', () => {
  assert.equal(computeDonorRollup(ROWS).limit, DEFAULT_DONOR_LIMIT);
  assert.equal(computeDonorRollup(ROWS).donors.length, 20);
  // An uncapped list is "paste every row into the prompt" by the back door.
  assert.equal(computeDonorRollup(ROWS, { limit: 5000 }).limit, MAX_DONOR_LIMIT);
  assert.equal(computeDonorRollup(ROWS, { limit: 5000 }).donors.length, 100);
  assert.equal(computeDonorRollup(ROWS, { limit: 0 }).limit, 1);
});

test('truncated is false only when the full set is returned', () => {
  const repeat = computeDonorRollup(ROWS, { minGiftCount: 2, limit: 50 });
  assert.equal(repeat.totalMatched, 3);
  assert.equal(repeat.truncated, false);
  assert.equal(repeat.donors.length, 3);
});

// ── repeat donors ────────────────────────────────────────────────────────────

test('minGiftCount answers "how many people gave more than once?"', () => {
  const { donors, totalMatched } = computeDonorRollup(ROWS, { minGiftCount: 2, limit: 50 });
  assert.equal(totalMatched, 3);
  assert.deepEqual(
    donors.map((d) => d.email).sort(),
    ['amina.haddad@example.org', 'marcus.silva@example.org', 'wei.kim@example.org']
  );
  assert.equal(totalMatched, computeStats(ROWS).repeatDonorCount, 'must agree with stats');
});

test('wei.kim rolls up 13 succeeded gifts across 2 campaigns', () => {
  const wei = computeDonorRollup(ROWS, { limit: 5 }).donors.find(
    (d) => d.email === 'wei.kim@example.org'
  )!;
  assert.equal(wei.giftCount, 13);
  assert.equal(wei.lifetime.cents, 311_000);
  assert.equal(wei.campaignCount, 2);
  assert.ok(Date.parse(wei.firstGiftISO) <= Date.parse(wei.lastGiftISO));
});

// ── anonymity is resolved per donor, not per gift ────────────────────────────

test('a donor with ANY named gift is not anonymous', () => {
  const { donors } = computeDonorRollup(ROWS, { limit: 5 });
  // Both seeded mixed-anonymity donors: wei.kim (1 anon of 13), amina (2 of 11).
  const amina = donors.find((d) => d.email === 'amina.haddad@example.org')!;
  const wei = donors.find((d) => d.email === 'wei.kim@example.org')!;
  assert.equal(amina.isAnonymous, false);
  assert.equal(amina.displayName, 'Amina Haddad');
  assert.equal(wei.isAnonymous, false);
  assert.equal(wei.displayName, 'Wei Kim');
});

test('a donor whose every gift is anonymous is labelled, not named', () => {
  const rows = [
    gift({ donorEmail: 'ghost@example.org', donorName: 'Real Name', anonymous: true }),
    gift({ donorEmail: 'ghost@example.org', donorName: 'Real Name', anonymous: true }),
  ];
  const [d] = computeDonorRollup(rows).donors;
  assert.equal(d.isAnonymous, true);
  assert.equal(d.displayName, ANONYMOUS_DONOR_LABEL);
  assert.ok(!d.displayName.includes('Real Name'), 'the stored name must not leak');
  // ...but the money still counts.
  assert.equal(d.lifetime.cents, 20_000);
  assert.equal(d.giftCount, 2);
});

test('the most recent named gift supplies the display name', () => {
  const rows = [
    gift({ donorName: 'Old Name', createdAt: Date.parse('2026-01-01T00:00:00.000Z') }),
    gift({ donorName: 'New Name', createdAt: Date.parse('2026-05-01T00:00:00.000Z') }),
    gift({ donorName: 'Ignored', anonymous: true, createdAt: Date.parse('2026-06-01T00:00:00.000Z') }),
  ];
  assert.equal(computeDonorRollup(rows).donors[0].displayName, 'New Name');
});

test('a named gift with no name falls back to a label, never to the email', () => {
  const rows = [gift({ donorEmail: 'nameless@example.org', donorName: undefined })];
  const [d] = computeDonorRollup(rows).donors;
  assert.equal(d.isAnonymous, false);
  assert.equal(d.displayName, 'Unnamed donor');
  assert.ok(!d.displayName.includes('@'));
});

test('anonymous gifts are included in org totals', () => {
  const anonymous = ROWS.filter((r) => r.status === 'succeeded' && r.anonymous === true);
  assert.equal(anonymous.length, 18);
  const total = computeDonorRollup(ROWS, { limit: MAX_DONOR_LIMIT }).totalMatched;
  assert.equal(total, computeStats(ROWS).uniqueDonorCount, 'donor set must match stats');
});

// ── scope and sorting ────────────────────────────────────────────────────────

test('scope narrows the donor set', () => {
  const march = resolveRange({ startISO: '2026-03-01', endISO: '2026-03-31' }, NOW_MS);
  const { totalMatched } = computeDonorRollup(ROWS, { scope: { range: march }, limit: 100 });
  assert.equal(totalMatched, computeStats(ROWS, { range: march }).uniqueDonorCount);
  assert.ok(totalMatched < 223);
});

test('an empty scope returns no donors without crashing', () => {
  const july = resolveRange({ preset: 'last_month' }, NOW_MS);
  const r = computeDonorRollup(ROWS, { scope: { range: july } });
  assert.deepEqual(r.donors, []);
  assert.equal(r.totalMatched, 0);
  assert.equal(r.truncated, false);
});

test('alternate sorts order correctly and stay deterministic', () => {
  const byGifts = computeDonorRollup(ROWS, { sortBy: 'giftCount', limit: 5 }).donors;
  assert.equal(byGifts[0].email, 'wei.kim@example.org', '13 gifts beats amina\'s 11');
  assert.equal(byGifts[0].giftCount, 13);

  const byLast = computeDonorRollup(ROWS, { sortBy: 'lastGift', limit: 20 }).donors;
  for (let i = 1; i < byLast.length; i += 1) {
    assert.ok(
      Date.parse(byLast[i - 1].lastGiftISO) >= Date.parse(byLast[i].lastGiftISO),
      'lastGift must sort descending'
    );
  }
});

test('TRAP: donor rollup must exclude non-succeeded gifts', () => {
  const wei = computeDonorRollup(ROWS, { limit: 5 }).donors.find(
    (d) => d.email === 'wei.kim@example.org'
  )!;
  assert.equal(ROWS.filter((r) => r.donorEmail === 'wei.kim@example.org').length, 15);
  assert.equal(wei.giftCount, 13, 'status filter missing from the rollup');
  assert.notEqual(wei.lifetime.cents, 318_500);
});

test('TRAP: donor count must never be the donation count', () => {
  const r = computeDonorRollup(ROWS, { limit: MAX_DONOR_LIMIT });
  assert.equal(r.totalMatched, 223);
  assert.notEqual(r.totalMatched, 251, 'rows are being treated as people');
});

// ── search ───────────────────────────────────────────────────────────────────

test('search matches display name and email, case-insensitively', () => {
  // Several generated donors also render as "Wei Kim" (wei.kim###@example.org),
  // so a name search legitimately returns all of them.
  const byName = computeDonorRollup(ROWS, { search: 'wei kim', limit: 50 });
  assert.ok(byName.totalMatched >= 1);
  assert.ok(byName.donors.every((d) => d.displayName === 'Wei Kim'));
  assert.equal(byName.donors[0].email, 'wei.kim@example.org', 'sorted by lifetime');

  const byEmail = computeDonorRollup(ROWS, { search: 'AMINA.HADDAD@', limit: 50 });
  assert.equal(byEmail.totalMatched, 1);

  const partial = computeDonorRollup(ROWS, { search: 'haddad', limit: 100 });
  assert.ok(partial.totalMatched > 1, 'a surname should match several donors');
  assert.ok(partial.donors.every((d) => d.displayName.toLowerCase().includes('haddad') || d.email.includes('haddad')));
});

test('search cannot unmask an anonymous donor by their hidden name', () => {
  const rows = [gift({ donorEmail: 'ghost@example.org', donorName: 'Secret Person', anonymous: true })];
  assert.equal(computeDonorRollup(rows, { search: 'Secret' }).totalMatched, 0);
  assert.equal(computeDonorRollup(rows, { search: 'ghost@' }).totalMatched, 0);
  assert.equal(computeDonorRollup(rows, { search: 'anonymous' }).totalMatched, 1);
});

test('search narrows totalMatched and truncated together', () => {
  const all = computeDonorRollup(ROWS, { limit: 10 });
  const searched = computeDonorRollup(ROWS, { search: 'zzzz-no-such-donor', limit: 10 });
  assert.equal(all.totalMatched, 223);
  assert.equal(searched.totalMatched, 0);
  assert.equal(searched.truncated, false);
  assert.deepEqual(searched.donors, []);
});

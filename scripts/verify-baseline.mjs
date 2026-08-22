// Cross-checks the LIVE Convex data against the offline seed replica.
// Uses only functions already implemented in the repo -- no code changes.
// Run from the repo root:  node <path>/verify.mjs
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const run = (fn, args = {}) =>
  JSON.parse(execFileSync('npx', ['convex', 'run', fn, JSON.stringify(args), '--typecheck', 'disable'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 64 * 1024 * 1024 }));

console.log('Reading campaigns from Convex...');
const campaigns = run('campaigns:listAll');
console.log('  ' + campaigns.length + ' campaigns');

let live = [];
for (const c of campaigns) {
  const rows = run('donations:listByCampaign', { campaignId: c._id });
  console.log('  ' + c.slug.padEnd(24) + rows.length + ' donation rows');
  live = live.concat(rows.map((r) => ({ ...r, campaignSlug: c.slug })));
}

// Regenerate the replica in-process rather than depending on a cached JSON file.
const replica = JSON.parse(
  execFileSync('node', [path.join(HERE, 'seed-replica.mjs')], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  })
).donations;

// Compare on a content fingerprint; _id and _creationTime are DB-assigned and
// are not reproducible offline, so they are excluded deliberately.
const fp = (d) => [d.campaignSlug, d.amountCents, d.feeCoveredCents, d.frequency, d.status,
                   d.donorEmail, d.createdAt].join('|');
const sortedLive = live.map(fp).sort();
const sortedRep  = replica.map(fp).sort();

console.log('\n=== ROW-LEVEL COMPARISON ===');
console.log('live rows    : ' + sortedLive.length);
console.log('replica rows : ' + sortedRep.length);

const identical = sortedLive.length === sortedRep.length &&
                  sortedLive.every((v, i) => v === sortedRep[i]);

if (identical) {
  console.log('\n  MATCH: every field of every row is identical.');
  console.log('  The offline baseline in NOTES.md is confirmed against the database.');
} else {
  console.log('\n  MISMATCH.');
  const setRep = new Set(sortedRep), setLive = new Set(sortedLive);
  const onlyLive = sortedLive.filter((v) => !setRep.has(v));
  const onlyRep  = sortedRep.filter((v) => !setLive.has(v));
  console.log('  in DB but not replica: ' + onlyLive.length);
  onlyLive.slice(0, 5).forEach((v) => console.log('    ' + v));
  console.log('  in replica but not DB: ' + onlyRep.length);
  onlyRep.slice(0, 5).forEach((v) => console.log('    ' + v));
}

// Recompute the headline figures straight off the LIVE rows.
const S = live.filter((d) => d.status === 'succeeded');
const usd = (c) => '$' + (c / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const raised = S.reduce((a, d) => a + d.amountCents, 0);
const fees = S.reduce((a, d) => a + d.feeCoveredCents, 0);
const donors = new Set(S.map((d) => d.donorEmail.trim().toLowerCase())).size;

console.log('\n=== HEADLINE FIGURES RECOMPUTED FROM LIVE DB ===');
const expect = { raised: 6670500, fees: 122338, count: 251, donors: 223, total: 283 };
const check = (label, actual, want) =>
  console.log('  ' + (actual === want ? 'ok  ' : 'FAIL') + '  ' + label.padEnd(30) +
              String(actual).padStart(9) + (actual === want ? '' : '   expected ' + want));
check('total rows', live.length, expect.total);
check('succeeded count', S.length, expect.count);
check('unique donors', donors, expect.donors);
check('total raised (cents)', raised, expect.raised);
check('fees covered (cents)', fees, expect.fees);
console.log('\n  total raised : ' + usd(raised));
console.log('  total charged: ' + usd(raised + fees));
console.log('  average gift : ' + usd(Math.round(raised / S.length)));

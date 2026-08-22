// Offline replica of convex/seed.ts. Mirrors the rand() call ORDER exactly,
// including JS object-literal property evaluation order. Emits the full row set
// as JSON so we can compute baselines without touching the database.
const DAY = 24 * 60 * 60 * 1000;
const T0 = 1767225600000;

const FIRST = ['Amina','Jordan','Priya','Marcus','Sofia','Wei','Noor','Diego','Hana','Tomas','Leila','Andre','Yusuf','Clara','Ravi','Maya'];
const LAST = ['Haddad','Okafor','Nguyen','Silva','Rahman','Kim','Torres','Ali'];

function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const campaignMeta = [
  { name: 'Legal Defense Fund', slug: 'legal-defense-fund', status: 'active', goalCents: 2500000 },
  { name: 'Winter Meal Drive', slug: 'winter-meal-drive', status: 'active', goalCents: 800000 },
  { name: 'Scholarship Endowment', slug: 'scholarship-endowment', status: 'active', goalCents: undefined },
  { name: 'Emergency Relief (ended)', slug: 'emergency-relief-2025', status: 'ended', goalCents: 5000000 },
  { name: 'Untitled draft', slug: 'untitled-draft', status: 'draft', goalCents: undefined },
];

const rand = rng(42);
const amounts = [1000, 2500, 5000, 10000, 25000, 50000, 100000];
const repeat = ['amina.haddad@example.org','marcus.silva@example.org','wei.kim@example.org'];

const rows = [];
for (let day = 0; day < 180; day++) {
  const perDay = Math.floor(rand() * 4);
  for (let n = 0; n < perDay; n++) {
    const r = rand();
    const ci = r < 0.55 ? 0 : r < 0.85 ? 1 : r < 0.95 ? 2 : 3;
    if (ci === 3 && day > 60) continue;

    const useRepeat = rand() < 0.12;
    const email = useRepeat
      ? repeat[Math.floor(rand() * repeat.length)]
      : `${FIRST[Math.floor(rand() * FIRST.length)]}.${LAST[Math.floor(rand() * LAST.length)]}${Math.floor(rand() * 900)}@example.org`.toLowerCase();

    const name = email.split('@')[0].replace(/[0-9]/g, '').split('.')
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ').trim();

    const amountCents = amounts[Math.floor(rand() * amounts.length)];
    const s = rand();
    const status = s < 0.06 ? 'failed' : s < 0.09 ? 'refunded' : s < 0.13 ? 'pending' : 'succeeded';

    // Property order below mirrors the object literal in seed.ts exactly.
    const feeCoveredCents = rand() < 0.6 ? Math.round(amountCents * 0.029) + 30 : 0;
    const frequency = rand() < 0.18 ? 'monthly' : 'one_time';
    const anonymous = rand() < 0.08;
    const note = rand() < 0.15 ? 'Keep up the good work.' : undefined;
    const dedication = rand() < 0.1
      ? { honoreeName: `${FIRST[Math.floor(rand() * FIRST.length)]} ${LAST[Math.floor(rand() * LAST.length)]}`,
          kind: rand() < 0.5 ? 'honor' : 'memory' }
      : undefined;
    const createdAt = T0 + day * DAY + Math.floor(rand() * DAY);

    rows.push({ ci, campaignSlug: campaignMeta[ci].slug, amountCents, feeCoveredCents,
                frequency, status, donorEmail: email, donorName: name, anonymous,
                note, dedication, createdAt, seedDay: day });
  }
}
console.log(JSON.stringify({ campaigns: campaignMeta, donations: rows }));

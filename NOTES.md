# NOTES

Track B — the reporting surface staff look at, plus an assistant that answers
questions about it in plain English.

---

## What I built

- **`/dashboard`** — total raised, donation count, unique donors, average gift;
  money over time with a switchable range and day/week/month buckets; breakdown by
  campaign; recent donations.
- **`/dashboard/campaigns/[id]`** — the same thing scoped to one campaign, plus
  goal progress.
- **`/dashboard/donors`** — who gave, lifetime total, gift count, first and last
  gift. Sortable, searchable, filterable to repeat donors.
- **`/dashboard/assistant`** — six tools over the same queries the dashboard uses.
  Conversations persist and every tool call is visible and expandable.
- **`convex/donations.ts → stats` and `timeseries`**, the two stubs the brief names.
- 88 tests that run without a Convex deployment.

I skipped auth, real payments and embeddings — all listed as not required. I also
skipped streaming, which the brief allows if it would cost correctness. It would
have, and the tool cards already give live feedback while the model works.

There's one reporting layer and both surfaces go through it. Neither does its own
arithmetic.

---

## Running it

```bash
npm install
npx convex dev                                # first run creates your deployment
npx convex run seed:run                       # deterministic seed data
npx convex env set ANTHROPIC_API_KEY <key>
npm run dev
```

The API key goes on the **Convex deployment**, not in `.env.local`. The assistant
runs inside a Convex action, which executes on Convex's servers, so `process.env`
there reads the deployment's environment and never sees your machine's. Check with
`npx convex env list`. If the key is missing the assistant doesn't crash — it
replies with the variable name and the command to fix it.

The starter README pointed at `.env.local`, which was right for an assistant living
in a Next route but not this one, so I updated that section. README, `.env.example`
and the app's error message now agree. `.env.local` is still used, for the three
`CONVEX_*` variables `npx convex dev` writes automatically.

Before that first `npx convex dev` you'll see a pile of type errors, all of them
"cannot find module `./_generated/server`" or implicit `any` errors following from
it. They clear as soon as Convex connects once.

```bash
npm test           # 88 tests, no deployment needed
npm run verify     # diffs the live database against a replica of the seed
npm run typecheck
npm run build
```

`npm run lint` is unconfigured scaffold state — there's no ESLint config or
dependency in the repo. I verified correctness with the tests, the typecheck and
the production build instead.

---

## How it's put together

```
donations · campaigns              Convex tables
        │
        ├─ scope             filterDonationsByScope — campaign + date only
        └─ status            countsAsRaised · partitionByStatus — succeeded is raised
        │
        ▼
computeStats · computeBreakdown · computeTimeseries · computeDonorRollup
        │                          plain functions — no ctx, no db
        ▼
convex/reporting.ts        stats · breakdown · timeseries · topDonors
                           recentDonations · campaigns
        │
        ├── dashboard        useQuery
        └── assistant        ctx.runQuery, via six tools
```

Scope and status are kept apart on purpose. Scope is "which campaign, which
dates" — it narrows which rows you're asking about. Status is what counts as real
money. Let those blur and "in scope" quietly starts meaning "succeeded", and you
can't get at the failed or pending money any more.

The four compute functions take plain arrays and return plain objects — no `ctx`,
no database handle — which is what lets the tests run against a rebuilt copy of the
seed with nothing deployed.

Worth being precise about what the shared layer buys, because it's easy to
oversell. There's no second implementation of the fundraising maths: the tools call
the same query functions the dashboard subscribes to, and a Convex action can't
reach `ctx.db` anyway. What it doesn't do is stop the model picking the wrong tool,
passing the wrong arguments, or describing a correct result badly. It can still do
all three, which is why every tool call is rendered in the UI.

---

## The rules that keep the numbers right

Each of these produces a believable number when you get it wrong.

| rule | what it prevents |
|---|---|
| Only `succeeded` counts as raised | $74,415.00 instead of $66,705.00 |
| Status is never something a caller passes in | the two surfaces disagreeing |
| `feeCoveredCents` is not raised | $67,928.38 — real, but that's *charged* |
| A donor is a normalised email, not a row | 251 "donors" instead of 223 |
| Empty time buckets still get emitted | a smooth line across 47 days with no gifts |
| Goal progress is lifetime, never range-scoped | 30.8% for a campaign sitting at 171.8% |
| Anonymity is worked out per donor, on read | naming someone who asked to be hidden |
| Ordering is deterministic | the two surfaces naming different people at #7 |

The second is the one I'd defend hardest. Campaign and date narrow which rows
you're asking about; status changes what "raised" means. If a caller could pass
`statuses`, the assistant could ask for succeeded plus pending, report $69,810 as
"total raised", and the dashboard would say $66,705 — both correct given their
inputs, and disagreeing about the most important number in the product. So pending,
failed and refunded come back as their own named figures in every stats response,
and there's no way to ask for them as a filter.

---

## The assistant

Six tools, split by the shape of answer they return rather than by question:
`list_campaigns` (the catalog), `get_fundraising_stats` (scalars),
`get_campaign_breakdown` (groups), `get_donation_timeseries` (buckets),
`list_top_donors` (donor rollups), `list_recent_donations` (individual gifts). Each
maps to a dashboard component, and each `run` is a thin `ctx.runQuery` to the query
that component already uses.

The brief rules out both extremes and I think it's right to. One tool taking
arbitrary input makes debugging much harder — every call looks identical, so you
can't tell "the model asked the wrong question" from "the query answered it
wrongly". One tool per question breaks the first time somebody rephrases something.

It runs on `claude-sonnet-5`; the job is picking a tool and writing two sentences,
and the guarantees live in the server rather than the model. I ran all five
required questions against it before switching down from Opus.

I wrote the tool loop by hand rather than using the SDK's runner, so each call gets
written to `chatMessages` the moment it happens. The client subscribes to that
table, so tool cards appear while the model is still thinking — most of what
streaming would have bought.

What makes it hard for the model to invent a number is mostly structural. The
system prompt contains no figures, so there's nothing to parrot. Tool results
describe themselves — every response carries `coverage` with the dataset's real
date bounds, so asking about July returns "0 rows, data covers 2026-01-01 →
2026-06-29" rather than a bare zero. Money crosses as `{cents, formatted}` and the
model quotes `formatted` verbatim; it can compare `cents` but never do arithmetic
on it. Every schema sets `additionalProperties: false`, so it can't invent an
argument — a `statuses` filter most of all. And tool failures come back as
`is_error` rather than throwing, so it can fix its arguments or say it can't
answer.

`list_top_donors` strips `email` before the result reaches the model — tool results
persist in a table with no auth in front of it, and no question needs contact
details. `list_recent_donations` never returns an email, and `donorName` is `null`
on anonymous gifts.

Every result carries `_meta {tool, durationMs}` and renders as an expandable card
with arguments and full response. That's what makes a wrong answer diagnosable:
wrong arguments is a model problem, right arguments with wrong figures is a query
problem, right figures with wrong prose is a presentation problem.

---

## Checking the numbers

The seed is a deterministic PRNG with a fixed epoch and no I/O, so I rebuilt the
dataset outside the database and compared field by field.
`scripts/seed-replica.mjs` regenerates it, `scripts/verify-baseline.mjs` diffs the
live deployment against it, and all 283 rows match. `BASELINE.md` has the full
tables.

Total raised **$66,705.00** from **251** of 283 rows, **223** unique donors, average
gift **$265.76** (median $100.00), **3** repeat donors. Excluded from raised: 8
pending, 16 failed, 8 refunded — 32 rows, $7,710.00. Fees covered came to
$1,223.38, so total charged was $67,928.38.

The five required questions, all confirmed live with the tool calls inspected:

| question | answer |
|---|---|
| Raised last month? | **$0.00** — the data ends 2026-06-29 |
| Best campaign? | Legal Defense at $42,940.00 raised, Winter Meal at 199% of goal — it says which it used |
| Top 10 donors? | Amina Haddad $3,435.00, Wei Kim $3,110.00, then 8 of the 32 tied at $1,000.00 |
| Gave more than once? | **3** |
| Meal drive vs legal fund in March? | No — $7,710.00 to $3,785.00 |

---

## Decisions and tradeoffs

**Every query reads the whole donations table.** The indexes exist and I don't use
them. At 283 rows it's instant, and `computeStats` wants the unscoped rows anyway
so `coverage` can report the dataset's bounds even when the scope matches nothing.

Indexed scoped reads would also be correct, though. A `by_created` read for July
returns zero rows, and "there were no donations in July" is already honest. What
you lose is the global coverage — a scoped read can't see outside its range — which
you'd get back with two `first()` reads for the bounds, at the cost of a second
query that also has an opinion about what "the dataset" is. Full collect is the
simpler of two valid options at this size, not the only correct one. At real scale
it doesn't get slow, it fails: Convex enforces a document-read limit. The fix is
indexed scoped reads, precomputed rollups for unscoped totals, and a reconciliation
job, because a rollup that drifts from source is a second source of truth for money.

**Everything buckets in UTC**, for reproducibility rather than because it's right.
The seed epoch is UTC midnight so a seed day equals a calendar day exactly, which
makes every figure checkable. But 46 of the 251 gifts land on a different day in
America/Toronto, and year-end is where that bites: a gift at 11pm on 31 December
Eastern is 1 January in UTC, which moves it into the next tax year. Production wants
a timezone on the org record.

**The assistant runs in a Convex action** rather than a Next route. Every other
piece of backend logic is a Convex function, actions cope with a multi-turn loop
better than a serverless timeout, `ctx.runQuery` is in-process, and `appendMessage`
stays internal. I don't want to overclaim it though — the single-implementation
property comes from the tool surface, not the runtime. A Next route using
`ConvexHttpClient` would call the same functions.

**A donor is a normalised email.** Given, not designed: the schema has no donors
table and keys on `donorEmail`. Not a general recommendation either — two addresses
is two donors, plus-addressing and Gmail dots are the same mailbox, a shared
household inbox is one "donor" who is two people. Production wants a donors table
with a real id and merge tooling.

**Anonymity is a product call.** The schema stores `anonymous` per gift; the
donor-level version is derived on read and never stored. The rule I picked is that
a donor is hidden only if every one of their succeeded gifts is anonymous. That has
a real downside: two seeded donors gave both ways, so their row shows a lifetime
total that includes the gifts they marked anonymous, under their name. But the
alternative — any anonymous gift hides them everywhere — removes both top donors
from the donors view, hiding the org's most important relationships from the people
who steward them. Neither is obviously right. Production would make it an org
setting and probably split "hidden from the public" from "hidden from staff".

Three smaller ones. **Tool schemas are hand-written** — six of them, with tests
pinning their enums to the reporting constants. A generator is better at scale; at
six it's infrastructure you then have to explain. The gap is that those tests pin
enums, not the argument list, so adding a parameter to a query fails nothing.

**Tool results are saved but never replayed to the model.** They're there for the
audit trail and the live UI, but a saved figure goes stale the moment a donation
lands. Cost: a follow-up question re-fetches everything.

**The visual language is Crescent's.** Tokens are lifted from getcrescent.com's
own stylesheet — the warm off-white base `#f8f7f4`, beige surface `#f2f0ed`, and
the purple ramp `#32175a / #8345dd / #ac7cf2 / #efebfc` — with `.5rem` radii and
Crescent's warm-tinted shadows rather than black ones. Type is Instrument Serif
for page titles and KPI figures, JetBrains Mono for tabular columns, and Inter as
a stand-in for TWK Lausanne, which is commercial. Dark mode is derived from the
deep purple and ebony tokens.

Two judgement calls. Large chart fills use a softer `#9c6ce8` rather than the
saturated brand purple, which reads as branding when it covers that much area —
the vivid accent is kept for hover, buttons and active state so it stays
emphatic. And the serif is deliberately limited to titles and the four KPI
figures; everything else stays sans or mono, because this is read at arm's length
across hundreds of rows and should feel operational rather than like the
marketing page.

**Campaign status never filters historical money.** Succeeded gifts count whether a
campaign is active, ended or draft — money that arrived is a fact, and status only
governs whether new gifts are accepted. `donations:create` refuses non-active
campaigns, so a draft can only hold donations by having been active before, in
which case the money is real. The breakdown carries status so the UI can show that
$570 came from a closed campaign.

---

## What's wrong with it

- **Full collect won't survive a real dataset**, and it fails outright rather than
  slowing down.
- **UTC isn't production timezone handling.** Year-end is the case that hurts.
- **No auth.** Not required, but it means the dashboard already shows donor emails
  to anyone who can load the page — so stripping them from the agent's tool results
  hardens a side door while the front door is open.
- **`npm run lint` doesn't run.**
- **No streaming.** Tool cards appear live, the final answer lands at once.
- **Argument drift in tool schemas isn't caught.** Enum drift is.
- **Convex ids change on re-seed**, so older campaign URLs land on "Campaign not
  found". Handled gracefully, but worth knowing before a demo.
- **The assistant occasionally hedges imprecisely** — once it said tie ordering
  "could shift", when it's deterministic and tested.

---

## With another week

1. **Precomputed rollups with reconciliation**, plus indexed scoped reads with
   dataset bounds fetched separately, so reporting survives real volume.
2. **An org-configured timezone** threaded through range resolution and bucketing,
   with tests for the year-end boundary.
3. **A comparison tool for the assistant.** Right now "was March better than April?"
   makes the model fetch twice and compare the results itself — arithmetic in the
   one place I've tried to keep it out of.

---

## Things that surprised me

**The seed's own comment is wrong.** It says "~420 gifts" and produces 283 —
`Math.floor(rand() * 4)` averages 1.5 a day over 180 days. Take the comment as the
expected row count and you'll go hunting a bug that isn't there.

**32 donors are tied at exactly $1,000.00.** A top-ten list is mostly tie, which
turns deterministic ordering from a nicety into a correctness requirement.

**Two different models misread the same field the same way.** When goal progress
was called `goalProgressPct` and sat in a range-scoped result next to range-scoped
money, Opus called it "cumulative to date" and Sonnet called it "that month" — both
wrong, in opposite directions. Renaming it `lifetimeGoalProgressPct` fixed the
sentence without touching the number. Two models making the same mistake was the
tell that it was a data-shape problem, not something to fix with a prompt rule.

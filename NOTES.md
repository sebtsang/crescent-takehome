# NOTES

Crescent take-home, Track B: the staff-facing reporting surface and an AI
assistant that answers questions about fundraising.

---

## 1. What this is

**Built:**

- `/dashboard` — total raised, donation count, unique donors, average gift; money
  over time with a switchable range and day/week/month granularity; breakdown by
  campaign; recent donations.
- `/dashboard/campaigns/[id]` — the same shape scoped to one campaign, plus goal
  progress.
- `/dashboard/donors` — who gave, lifetime total, gift count, first and last gift.
  Sortable, searchable, filterable to repeat donors.
- `/dashboard/assistant` — six tools over the same reporting queries, persisted
  conversations, every tool call visible and expandable in the UI.
- `convex/donations.ts → stats` and `timeseries`, the two stubs the brief names.
- 88 tests, no test-runner dependency.

**Deliberately not built:** auth, real payments, embeddings, streaming. The first
three are listed as not required; streaming was cut on the brief's own terms —
*"streaming if you can, not at the cost of correctness."*

**The thesis:** one reporting layer, two consumers. The dashboard and the
assistant call the same deterministic queries, so there is no separate AI-side
implementation of the fundraising maths.

---

## 2. Running it

```bash
npm install
npx convex dev                                # first run: creates your deployment
npx convex run seed:run                       # deterministic seed data
npx convex env set ANTHROPIC_API_KEY <key>    # NOT .env.local — see below
npm run dev
```

### The API key goes on the Convex deployment

**The assistant will not work with the key in `.env.local`.** It runs in a Convex
*action*, which executes on Convex's servers, so `process.env` inside it reads the
deployment's environment rather than your machine's. Check with
`npx convex env list`. Without the key the assistant appends a message naming the
variable and the exact command rather than throwing.

This is a **deliberate deviation from README.md**, which says `.env.local`. That
instruction presumes the Anthropic call happens in the Next.js process, which is a
legitimate design we did not choose (§7). README.md is unmodified;
`.env.example` names the contradiction. `.env.local` is still used, for the three
`CONVEX_*` variables `npx convex dev` writes automatically.

**Expect ~73 type errors before that first `npx convex dev`.** The starter README
says "roughly twenty" — that count predates the files this project added. Every
one is a missing `convex/_generated` module or a downstream implicit `any`, and
all of them clear once Convex has connected once.

### Verifying

```bash
npm test           # 88 tests, no deployment needed
npm run verify     # live database vs the deterministic replica
npm run typecheck
npm run build
```

`npm run lint` remains unconfigured from the starter scaffold; correctness was
verified with the full test suite, TypeScript typecheck, and production build.

---

## 3. Architecture

```
donations · campaigns              Convex tables
        │
        ├─ Scope             filterDonationsByScope — campaign + date, no status rule
        └─ Status semantics  countsAsRaised · partitionByStatus — only succeeded is raised
        │
        ▼
computeStats · computeBreakdown · computeTimeseries · computeDonorRollup
        │                          pure functions — no ctx, no db, unit-tested
        ▼
convex/reporting.ts        stats · breakdown · timeseries · topDonors
                           recentDonations · campaigns
        │
        ├── Dashboard        useQuery       renders, never computes
        └── AI assistant     ctx.runQuery   six tools, one per result shape
```

**Scope and status are separate concerns.** Scope answers *which slice of the
business* — campaign, date. Status answers *what counts as real money*. Keeping
them apart is what stops "in scope" from quietly coming to mean "succeeded".

**What the shared layer guarantees, precisely.** Both surfaces call the same
deterministic queries, so there is no second implementation of the maths to
drift. A Convex action cannot access `ctx.db`, and the tools expose only
constrained reporting queries rather than raw donation rows. **What it does not
guarantee:** the model can still choose the wrong tool, pass the wrong arguments,
or misstate a correct result. That is why every tool call is shown in the UI.

The pure functions take no `ctx` and no `db`, so they are tested against a
deterministic replica of the seed without a deployment running.

---

## 4. Correctness rules

Each of these produces a plausible number when broken — which is what makes them
dangerous.

| # | rule | what it prevents |
|---|---|---|
| 1 | Only `succeeded` is raised | $74,415.00 instead of $66,705.00 |
| 2 | Status is never a caller-supplied filter | the agent computing "raised" over a different set than the dashboard |
| 3 | `feeCoveredCents` is not raised | $67,928.38 — that figure is real, but it is *charged* |
| 4 | A donor is a normalised email, not a row | 251 "donors" instead of 223 |
| 5 | Empty time buckets are emitted | a smooth line across 47 days where nothing arrived |
| 6 | Goal progress is lifetime, never range-scoped | 30.8% for a campaign at 171.8% |
| 7 | Anonymity resolved per donor, on read | a name shown for someone who asked to be hidden |
| 8 | Ordering is deterministic | dashboard and assistant naming different people at #7 |

**On rule 2 specifically.** Campaign and date narrow *which rows* you are asking
about. Status changes *what the word "raised" means*. If a caller could pass
`statuses`, the assistant could report $69,810 as "total raised" while the
dashboard said $66,705 — both correct given their inputs, and disagreeing about
the most important number in the product. So pending, failed and refunded come
back as **separate named figures in the response**, never as a filter in the
request.

**On rule 8.** 32 donors have a lifetime of exactly $1,000.00, so ranks 3–10 of
any top-10 are arbitrary without a fixed tiebreak. Ties break on email.

---

## 5. The assistant

**Six tools, split by result shape** rather than by question: `list_campaigns`
(catalog), `get_fundraising_stats` (scalars), `get_campaign_breakdown` (groups),
`get_donation_timeseries` (buckets), `list_top_donors` (donor rollups),
`list_recent_donations` (gift rows). Each maps to one dashboard component, and
each `run` is a thin `ctx.runQuery` to the query that component uses.

A single tool taking arbitrary input is not a design — it also makes model-error
indistinguishable from tool-error, because every call looks identical. One tool
per question breaks on the first question phrased slightly differently.

**Model:** `claude-sonnet-5` — the workload is tool routing plus a short summary,
and the correctness guarantees live in the server. Verified against all five
required questions before adopting.

**Manual tool loop, not the SDK runner**, so each call is persisted to
`chatMessages` as it happens. The client subscribes to that table, so tool cards
appear while the model is still working — live progress without streaming.

### Anti-hallucination is structural, not prompted

- The system prompt contains **no figures**, so there is nothing to parrot.
- Tool results are **self-describing**: `coverage` carries the dataset's real
  bounds, so an empty July returns "0 rows, data covers 2026-01-01 → 2026-06-29"
  rather than a bare zero.
- Money crosses as `{cents, formatted}`; the model quotes `formatted` verbatim and
  may compare `cents` but never do arithmetic on it.
- `additionalProperties: false` on every schema — the model cannot invent an
  argument, most importantly a `statuses` filter.
- Tool failures return `is_error` rather than throwing, so the model can correct
  its arguments or say it cannot answer.

### Privacy and debuggability

`list_top_donors` projects `email` away before the result reaches the model — tool
results persist in a table with no auth in front of it, and no question the
assistant answers needs contact data. `list_recent_donations` returns no email
field at all, and `donorName` is `null` for anonymous gifts.

Every tool result carries `_meta {tool, durationMs}`, and the UI renders each call
as an expandable card showing arguments and full result. A wrong number is then
attributable: wrong arguments is a model error, right arguments with wrong figures
is a query error, right figures with wrong prose is a presentation error.

---

## 6. Verified figures

The seed is a deterministic PRNG with a fixed epoch and no I/O, so the dataset can
be rebuilt **outside the database** and compared field by field.
`scripts/seed-replica.mjs` reproduces it; `scripts/verify-baseline.mjs` diffs the
live deployment against it. All 283 rows match on every field. Full tables live in
`BASELINE.md`; the headlines:

| metric | value |
|---|---:|
| Total raised | **$66,705.00** |
| Donations | **251** of 283 rows |
| Unique donors | **223** |
| Average gift | **$265.76** (median $100.00) |
| Repeat donors | **3** |
| Fees covered | $1,223.38 |
| Total charged | $67,928.38 |

Excluded from raised: 8 pending, 16 failed, 8 refunded — 32 rows, $7,710.00.

### The five required questions

| question | verified answer |
|---|---|
| How much did we raise last month? | **$0.00** — data ends 2026-06-29 |
| Which campaign is doing best? | Ambiguous: Legal Defense $42,940.00 by raised; Winter Meal 199% by goal. Must state which. |
| Who are our top 10 donors? | Amina Haddad $3,435.00, Wei Kim $3,110.00, then 8 of the 32 tied at $1,000.00 |
| How many gave more than once? | **3** |
| Meal drive vs legal fund in March? | No — $7,710.00 vs $3,785.00 |

All five confirmed live against the deployment, with tool calls and arguments
inspected.

---

## 7. Design decisions

Each of these could reasonably have gone the other way.

### Full-collect reads, indexes unused

**Chose.** Every query `.collect()`s the whole donations table.

**Why here.** Simplest correct thing at 283 rows, and `computeStats` takes the
*unscoped* rows so `coverage` can report the dataset's bounds even when the scope
matches nothing.

**The honest tradeoff.** **Indexed scoped reads would also be correct.** A
`by_created` read for July returns zero rows, and "there were no donations in
July" is already an honest answer. What an indexed read loses is *global dataset
coverage* — it cannot see rows outside its range — recoverable with two `first()`
reads for the bounds, at the cost of a second query that also knows what "the
dataset" is. Full collect is a take-home choice, not the only correct approach.

**Production.** Indexed scoped reads, precomputed rollups for unscoped totals, and
a reconciliation job — a rollup that drifts from source is a second source of
truth for money. Revisit at any real dataset size: this does not degrade into
slowness, Convex's document-read limit makes it fail outright.

### UTC for all date bucketing

**Chose.** UTC, fixed, not configurable.

**Why here.** Reproducibility. The seed epoch is UTC midnight, so seed-day equals
calendar-day exactly.

**Tradeoff.** **This is a reproducibility choice, not production timezone
handling.** 46 of 251 gifts land on a different calendar day in America/Toronto.
The high-stakes case is year-end: a gift at 11pm on 31 December Eastern is
1 January UTC, which moves it into the next tax year.

**Production.** Timezone on the org record, threaded through range resolution and
bucketing.
### The assistant runs in a Convex action

**Chose.** Agent loop in a Convex action; key as a deployment env var.

**Why here.** Every other backend function is Convex; actions tolerate a
multi-turn loop better than a typical serverless timeout; `ctx.runQuery` is
in-process; `appendMessage` stays internal.

**Honest accounting.** The one-implementation guarantee does **not** come from
this — a Next route using `ConvexHttpClient` would call the identical functions.
It comes from the tool surface. The real cost of this choice is reviewer friction:
someone following README puts the key in `.env.local` and gets "not configured".

**Rejected.** Next route handler with the key in `.env.local`, matching README
literally. Reversible in about an hour.

### Donor identity is a normalised email

**Chose.** Lowercased, trimmed email as the identity.

**This is given, not designed.** The provided schema has no donors table and keys
on `donorEmail`. It is not a general recommendation to identify people by email.

**Tradeoff.** Email is not stable identity — two addresses is two donors,
plus-addressing and Gmail dots are the same mailbox, a shared household inbox is
one "donor" who is two people. Production wants a donors table with a stable id
and merge/dedupe tooling.

### Anonymity resolved per donor

**Chose.** A donor is displayed anonymously only if **every** succeeded gift is
anonymous.

**Three levels, kept distinct.** `anonymous` is stored **per gift** in the schema.
Donor-level display anonymity is **derived on read**, never stored. The rule above
is a **product assumption**, not a fact the data implies.

**Tradeoff, stated plainly.** It arguably leaks intent: two seeded donors gave
both ways, and their donor row shows a lifetime total that *includes* the
anonymous gifts under their name. The alternative — any anonymous gift hides the
donor everywhere — erases both top donors from the donors view, hiding the org's
most important relationships from the staff who steward them.

**Production.** An org setting, and separating "hidden from the public" from
"hidden from staff" — most CRMs let staff see everything.

### Three smaller calls

**Hand-written tool schemas.** Six JSON Schemas maintained by hand, with tests
pinning their enums to the reporting constants. A generator is the better answer
at scale; at six schemas it is infrastructure that needs explaining. The gap: the
tests pin enums, not the argument list, so adding a parameter to a query fails
nothing.

**Tool results persisted but never replayed.** Every call is saved for the audit
trail and the live UI, but saved results are excluded from the history sent back
to the model — a saved figure goes stale the moment a donation arrives. Cost: the
model has no memory of what it looked up, so a follow-up re-fetches from scratch.
Production would keep recent results with a freshness stamp.

**Campaign status never filters historical money.** Succeeded gifts count whether
a campaign is active, ended, or draft. Money that arrived is a historical fact;
status governs whether a campaign accepts *new* gifts. `donations:create` refuses
non-active campaigns, so a draft can only hold donations by having previously been
active — in which case the money is real. The breakdown carries campaign status so
the UI can show that $570 came from a closed campaign.

---

## 8. Known limitations

- **Full collect will not survive a real dataset.** Fails outright rather than
  degrading. See §7.
- **UTC is not production timezone handling.** See §7.
- **No auth.** Not required, but it means the dashboard already exposes donor
  emails to anyone who can load the page — so the agent-side email projection
  hardens a side door while the front door is open.
- **`npm run lint` is unconfigured** starter scaffold state.
- **Narrow viewports clip the KPI figure.** At ~490px `$66,705.00` renders against
  the card edge. No page-level overflow; desktop and tablet are clean.
- **No streaming.** Tool cards appear live via subscription, but the final answer
  arrives at once.
- **Tool schemas are hand-maintained.** Enum drift is tested; argument drift is not.
- **Convex ids are seed-dependent.** `seed:run` mints new ids, so campaign URLs
  from before a re-seed 404 into the "Campaign not found" state.

---

## 9. With another week

1. **Precomputed rollups with reconciliation**, so the reporting layer survives a
   real dataset — plus indexed scoped reads with dataset bounds sourced separately.
2. **Org-configured timezone** threaded through range resolution and bucketing,
   with tests for the year-end boundary case.
3. **A comparison tool for the assistant.** Today "was March better than April?"
   forces the model to make two calls and compare them itself — arithmetic-adjacent,
   in the one place the model should not be operating.

---

## 10. What surprised me

**The seed's own comment is wrong.** It says "~420 gifts"; it produces 283.
`Math.floor(rand() * 4)` averages 1.5/day over 180 days. Taking the comment as an
expected row count would send you hunting a bug that does not exist.

**32 donors tie at exactly $1,000.00.** A top-10 list is mostly a tie, which makes
deterministic ordering a correctness requirement rather than a nicety.

**Both models tested misread the same field.** When goal progress was called
`goalProgressPct` and sat inside a range-scoped result, Opus described it as
"cumulative to date" and Sonnet as "that month" — both wrong, in opposite
directions. Renaming it `lifetimeGoalProgressPct` fixed the prose without touching
the number. A self-describing field name beat a prompt instruction.

# NOTES.md

Working notes for the Crescent take-home. Kept as I go.

> **Status legend:** `[VERIFIED]` = matched against rows actually read out of Convex.
>
> **All baseline figures below are VERIFIED.** `scripts/verify-baseline.mjs` read all
> 283 rows out of deployment `dev:acoustic-dodo-759` and diffed them field-by-field
> against the offline replica: **every field of every row is identical**, and all five
> headline figures match. Re-run any time with `node scripts/verify-baseline.mjs`.

---

## 0. Repo state as found

- Next.js 15 (App Router) + React 19 + Tailwind 3 + Convex 1.27. `@anthropic-ai/sdk`
  is already a dependency, so an assistant track is anticipated.
- `app/page.tsx` is a placeholder. There is no dashboard, no admin route, no chat UI.
- Implemented server functions: `campaigns:getBySlug`, `campaigns:listAll`,
  `donations:create`, `donations:listByCampaign`, `seed:run`.
- Stubs that throw `Not implemented`: `campaigns:update`, `donations:stats`,
  `donations:timeseries`.
- **The brief lives outside the repo** at `takehome-brief.md` in the main working
  tree, gitignored. Scope is authoritative and confirmed:

### Scope (from the brief)

**Own:** the staff-facing reporting surface + an AI fundraising assistant.

1. **Dashboards** — `/dashboard` (total raised, donation count, unique donors,
   average gift; money over time charted with a switchable range; breakdown by
   campaign; recent donations). `/dashboard/campaigns/[id]` — same shape, one
   campaign. `/dashboard/donors` — who gave, total, how many times, last gift;
   sortable + searchable.
2. **`convex/donations.ts` → `stats` and `timeseries`.**
3. **Agent at `/dashboard/assistant`** — must handle the five questions in §7.
   Model reaches data through **tools with real schemas**, never rows pasted into
   the prompt. Conversations persist via `chatThreads`/`chatMessages` including
   which tool ran with what args. **Tool calls visible in the UI.** Must refuse
   gracefully. Streaming only if it does not cost correctness.

**Assessed on:** are the numbers right (dominates) · where aggregation happens ·
tool design (neither one god-tool nor one-tool-per-question) · debuggability
(model error vs tool error) · no layout reflow on data arrival · empty states.

**Explicitly not required:** auth, real payments, embeddings/vector store, voice,
multi-user chat.

> The brief's own instruction: *"the agent's tools should call the same aggregates
> the dashboard uses, or you'll write the aggregation twice and they'll disagree."*
> This is the architecture constraint, stated by the client, not inferred.

---

## 1. How I established the baseline

`convex/seed.ts` is fully deterministic: a mulberry32 PRNG seeded with `42`, a fixed
epoch `T0 = 1767225600000` (2026-01-01T00:00:00Z), no `Date.now()`, no I/O.

That means the dataset can be reproduced **outside the database**. I wrote a
standalone replica that mirrors the seed's `rand()` call order exactly — including
JS object-literal property evaluation order, which matters because
`feeCoveredCents`, `frequency`, `anonymous`, `note`, `dedication` and `createdAt`
each consume from the same PRNG stream in source order.

This gives two independent computations of every figure: the replica, and whatever
the server-side aggregation later returns. They must agree exactly. If they diverge,
the aggregation is wrong — that is the whole point of doing it twice.

---

## 2. Verified baseline figures

### 2.1 Status breakdown — all 283 rows `[VERIFIED]`

| status | rows | Σ amountCents | Σ feeCoveredCents |
|---|---:|---:|---:|
| succeeded | 251 | $66,705.00 | $1,223.38 |
| pending | 8 | $3,105.00 | $90.24 |
| failed | 16 | $2,595.00 | $74.96 |
| refunded | 8 | $2,010.00 | $31.35 |
| **all rows** | **283** | **$74,415.00** | **$1,419.93** |

### 2.2 Headline numbers — `succeeded` only `[VERIFIED]`

| metric | value | in cents |
|---|---:|---:|
| Total raised (net to org) | **$66,705.00** | 6,670,500 |
| Fees covered by donors | $1,223.38 | 122,338 |
| Total charged to cards | $67,928.38 | 6,792,838 |
| Donation count | **251** | |
| Unique donors (distinct email) | **223** | |
| Average gift (raised ÷ count) | **$265.76** | 26,575.6972 exact |
| Median gift | $100.00 | |
| Average per donor (raised ÷ donors) | $299.13 | |

Reconciliation of the donor count: 223 unique = 220 one-gift donors + 3 repeat
donors, and 220 + 31 repeat gifts = 251 succeeded rows. ✔

### 2.3 Per campaign — `succeeded` only `[VERIFIED]`

| campaign | gifts | raised | fees | donors | goal | progress |
|---|---:|---:|---:|---:|---:|---:|
| legal-defense-fund | 154 | $42,940.00 | $817.59 | 137 | $25,000 | 171.8% |
| winter-meal-drive | 67 | $15,920.00 | $297.02 | 60 | $8,000 | 199.0% |
| scholarship-endowment | 26 | $7,275.00 | $91.63 | 26 | *none* | **N/A** |
| emergency-relief-2025 (ended) | 4 | $570.00 | $17.14 | 4 | $50,000 | 1.1% |
| untitled-draft | 0 | $0.00 | $0.00 | 0 | *none* | **N/A** |

### 2.4 Repeat donors `[VERIFIED]`

Exactly 3 donors give more than once, all of them the emails hardcoded in the seed.

| email | succeeded gifts | lifetime | all rows |
|---|---:|---:|---:|
| wei.kim@example.org | 13 | $3,110.00 | 15 (1 failed, 1 refunded) |
| amina.haddad@example.org | 11 | $3,435.00 | 11 |
| marcus.silva@example.org | 7 | $775.00 | 7 |

I checked for accidental PRNG collisions in the generated emails (16 first names ×
8 surnames × 900 digits): **zero**. So repeat-donor logic can be validated against
exactly these three, and `wei.kim` is the useful one — it is the only donor whose
repeat count *changes* depending on whether you filter to `succeeded` (13) or not (15).

---

## 3. Data-model rules that decide correctness

1. **Only `succeeded` counts as raised.** `pending`, `failed`, `refunded` all exist
   in the seed specifically to catch a naive `SUM`. Summing everything reports
   $74,415.00 — **$7,710.00 too much**.
2. **`amountCents` is net to the org; `feeCoveredCents` is extra the donor paid on
   top.** Raised = Σ `amountCents`. Charged = Σ (`amountCents` + `feeCoveredCents`).
   Adding fees into "raised" inflates it by $1,223.38.
3. **`feeCoveredCents = 0` is normal, not missing.** 112 of 251 succeeded rows are 0
   (44.6%). Treating 0 as null/absent and back-filling an estimate would be wrong.
   Where non-zero it is exactly `Math.round(amountCents * 0.029) + 30` — verified on
   all 251 rows.
4. **A donor is a lowercased email, not a row.** 251 rows → 223 people. `donations:create`
   lowercases and trims on write, but aggregation must not *assume* that: the seed
   writes rows directly, bypassing `create`. Normalize on read too.
5. **`refunded` is not the same as `failed`.** Both are excluded from raised, but a
   refund is money that arrived and went back; a failure never arrived. If net
   revenue ever needs to be shown, refunds subtract and failures do not.
6. **`anonymous` is a display flag only.** 18 succeeded rows are anonymous ($5,630).
   They still carry a real name and email and must still count toward totals and
   donor dedup — the bug is leaking the identity to the client, not counting it.
   Note 2 emails appear *both* anonymously and named, so "is this donor anonymous"
   is a per-gift question, not a per-donor one.
7. **`monthly` is one recorded gift, not a subscription.** 53 succeeded monthly rows
   ($12,850). There is no schedule/subscription table, so MRR cannot be derived
   without inventing an assumption. I will not present one as if it were measured.
8. **Absent ≠ false for campaign settings.** Per `schema.ts`, an absent toggle means
   SHOWN; only an explicit `false` hides. `?? true`, never `!!`.
9. **`goalCents` is optional.** `scholarship-endowment` and `untitled-draft` have
   none. Percent-to-goal must be `null`, not `NaN`, `Infinity`, or `0%`.

---

## 4. Edge cases and traps found

- **The seed comment says "~420 gifts". The seed actually produces 283.**
  `perDay = Math.floor(rand() * 4)` averages 1.5/day × 180 days ≈ 270, plus the
  ended-campaign `continue`. The comment is stale — **confirmed against the live
  database, which holds exactly 283 rows.** Trusting the comment as an expected row
  count would send you hunting a nonexistent bug.
- **All seed data is in the past.** Range is 2026-01-01 → 2026-06-29. Today is
  2026-08-22, so the newest donation is **53 days old**. Consequences:
  - "Last 7 days" → **0 gifts, $0**
  - "Last 30 days" → **0 gifts, $0**
  - "Last 90 days" → 36 gifts, $11,240
  A dashboard defaulting to a 30-day window renders completely empty and looks
  broken. This is a presentation decision, not a bug to patch: I need a default
  range that actually contains data, plus a genuine empty state.
- **44 of 180 days have no donations.** A timeseries must emit explicit zero
  buckets; grouping only over present rows silently compresses the gaps and
  misdraws the trend.
- **Timezone materially changes the buckets.** `createdAt` is epoch ms. Re-bucketing
  the 251 succeeded rows by local calendar day moves: 46 rows in America/Toronto
  (18%), 86 in America/Los_Angeles, 87 in Asia/Tokyo. Distinct day counts shift from
  133 (UTC) to 142 (Toronto). Daily totals are **not** timezone-stable and the choice
  must be stated, not implied. The very first row, 2026-01-01T00:39:03Z, lands on
  2025-12-31 in Toronto — a different year.
- **Both live campaigns are over goal** (171.8%, 199.0%). Progress bars must clamp
  the *bar* at 100% while still reporting the true percentage.
- **Mean is 2.6× median** ($265.76 vs $100.00) — the $1,000 tier is 35 gifts but
  $35,000 of the $66,705. A lone "average gift" tile is misleading; median belongs
  next to it.
- **`donations:listByCampaign` collects every row unpaginated.** Fine at 283, a real
  problem at 400,000. Flagged in the file's own comment. Decision pending.
- **`seed:run` writes `succeeded` rows directly**, bypassing `donations:create`,
  which can only ever produce `pending`. So there is no code path in the repo that
  legitimately transitions a donation to `succeeded`. Worth noting before assuming
  the lifecycle is implemented anywhere.

---

## 5. Open questions / ambiguities

Recorded rather than silently resolved:

1. **Which timezone?** Nothing in the repo states one. Leaning UTC because
   `createdAt` is epoch ms and the seed epoch is UTC midnight, which makes seed day
   index == UTC calendar day exactly — reproducible and explainable. A real nonprofit
   would want its own local timezone. To be decided explicitly and written down.
2. **Does "total raised" include donor-covered fees?** Schema says net to org is
   `amountCents`, so raised = `amountCents`. I will show "total charged" as a
   separate secondary figure rather than folding it in.
3. **Should refunds reduce raised, or be excluded?** Excluding is what the schema
   comment says ("must not count pending or failed"; refunded is listed alongside).
   Excluding and subtracting give the same $66,705 here only because refunded rows
   were never in the succeeded set. Stating the rule as "raised = Σ succeeded" is
   unambiguous.
4. **Do ended/draft campaigns belong in org-wide totals?** `emergency-relief-2025`
   contributes $570. Including it changes the headline. Undecided.
5. **Unique donors — org-wide or per campaign?** These do not sum: 137 + 60 + 26 + 4
   = 227 across campaigns but 223 org-wide, because some donors gave to more than
   one campaign. Any UI showing both must not imply they add up.

---

## 6. Decisions log

*(empty — architecture proposed but not yet approved or implemented)*

---

## 7. Baselines for the five required agent questions `[VERIFIED]`

These are acceptance criteria, so each has a known-good answer written down before
any code exists.

### Q1 "How much did we raise last month?" → **$0.00**

Today is 2026-08-22, so "last month" = **2026-07**. The data ends 2026-06-29.
There are zero donations in July.

| month | raised | gifts |
|---|---:|---:|
| 2026-01 | $13,475.00 | 52 |
| 2026-02 | $10,525.00 | 42 |
| 2026-03 | $13,645.00 | 42 |
| 2026-04 | $10,055.00 | 44 |
| 2026-05 | $9,425.00 | 41 |
| 2026-06 | $9,580.00 | 30 |

This is *the* test case for graceful refusal. The brief: "an assistant that invents
a number is worse than one that declines, because a plausible invented number gets
pasted into a board report." A naive agent either hallucinates a figure or divides
by zero computing an average over an empty set. Correct behaviour: state plainly
that there was no activity in that period, and ideally name the actual data range.

### Q2 "Which campaign is doing best?" → **ambiguous, must be disclosed**

| campaign | raised | gifts | donors | avg gift | % of goal |
|---|---:|---:|---:|---:|---:|
| legal-defense-fund | $42,940.00 | 154 | 137 | $278.83 | 171.8% |
| winter-meal-drive | $15,920.00 | 67 | 60 | $237.61 | **199.0%** |
| scholarship-endowment | $7,275.00 | 26 | 26 | $279.81 | no goal |
| emergency-relief-2025 | $570.00 | 4 | 4 | $142.50 | 1.1% |

By raised → legal-defense-fund. By % of goal → winter-meal-drive. Both defensible.
The agent must say which metric it used; picking silently is guessing.

### Q3 "Who are our top 10 donors?" → **tie-break landmine**

| # | email | lifetime | gifts | last gift |
|---|---|---:|---:|---|
| 1 | amina.haddad@example.org | $3,435.00 | 11 | 2026-06-28 |
| 2 | wei.kim@example.org | $3,110.00 | 13 | 2026-06-11 |
| 3–10 | *32 donors tied at exactly $1,000.00* | $1,000.00 | 1 | various |

**32 donors have exactly $1,000 lifetime.** Ranks 3–10 are arbitrary without a
deterministic secondary sort key (email is the obvious stable tiebreak). Without
one, the dashboard and the agent will each pick a different #7 — the exact
"dashboard and agent disagree" failure the brief calls worse than either being
wrong alone.

**Both #1 and #2 have at least one anonymous gift.** The top-donor list must count
them fully while not exposing the identity where a gift was marked anonymous.

### Q4 "How many people gave more than once?" → **3**

wei.kim, amina.haddad, marcus.silva (succeeded-only).

Honest caveat: this returns 3 **whether or not** the status filter is applied,
because wei.kim's failed and refunded rows introduce no new person. So this
question does *not* catch a missing status filter. The per-donor gift *count* does:
wei.kim is 13 succeeded of 15 rows. Do not treat a correct "3" as evidence the
filter works.

### Q5 "Did the meal drive do better than the legal fund in March?" → **no**

| campaign | March 2026 raised | gifts | donors |
|---|---:|---:|---:|
| legal-defense-fund | $7,710.00 | 24 | 24 |
| winter-meal-drive | $3,785.00 | 14 | 12 |

Legal fund by **$3,925.00**. "March" is unambiguous here — 2026-03 is the only
March in the dataset — but the agent should still resolve and echo the concrete
date range it used.

---

## 8. Setup decisions

- **Convex deployment: cloud account, not anonymous/local.** README assumes it
  ("you will create your own free Convex account"); the web dashboard is directly
  useful for hand-verifying totals as the brief requires; the agent needs a
  server-side `ANTHROPIC_API_KEY` as a deployment env var; and a cloud deployment
  survives the live walkthrough without a local backend to babysit. Rejected
  alternative: anonymous local mode — works fine for dev, but is machine- and
  directory-bound and adds a conversion step later.
- **`npx convex dev` must be run from the tree that has `node_modules`**, otherwise
  npx downloads a transient newer CLI (1.45.0) than the pinned local one (1.44.0).

---

## 9. PROPOSED architecture — pending review, not implemented

> Status: proposal. Nothing here is built. Recorded so the reasoning survives the
> decision.

### 9.1 Layers

```
convex/lib/money.ts       integer-cent primitives + the ONE cents->string formatter
convex/lib/time.ts        the ONE timezone-aware bucketing/range resolver
convex/lib/reporting.ts   PURE: computeStats / computeBreakdown / computeTimeseries
                          / computeDonorRollup. No ctx, no db. Unit-testable
                          against scripts/seed-replica.mjs without a deployment.
convex/reporting.ts       Convex queries wrapping the pure fns. The ONLY place the
                          succeeded-status filter is written. Exports the shared
                          filter validator.
convex/agent/tools.ts     Tool defs whose run() is `ctx.runQuery(api.reporting.X)`.
convex/agent/chat.ts      Convex action: system prompt, tool loop, persistence.
app/dashboard/**          useQuery(api.reporting.X) — renders, never computes.
```

The agent's tools call **the same query references** the dashboard calls. Not
parallel implementations kept in sync by discipline — the same function.

### 9.2 The six tools

Split by **result shape**, not by question. Result shape is the right axis because
each shape maps 1:1 to a dashboard component, which is what makes the sharing real.

| tool | shape | dashboard twin | answers |
|---|---|---|---|
| `list_campaigns` | entity catalog | campaign switcher | name -> id resolution |
| `get_fundraising_stats` | scalars | KPI tiles | Q1, Q4 |
| `get_breakdown` | groups (`dimension: campaign\|frequency`) | breakdown table | Q2, Q5 |
| `get_donation_timeseries` | zero-filled buckets | the chart | trend questions |
| `list_top_donors` | donor rollups | donors table | Q3 |
| `list_recent_donations` | gift rows | recent list | drill-down |

### 9.3 Schema decisions (the load-bearing ones)

1. **`status` is NOT a tool parameter.** It is baked into the aggregation. Instead
   the stats payload *always* returns `raisedCents`, `pendingCents`, `failedCents`,
   `refundedCents` as separate named fields. Makes it structurally impossible for
   the model to compute "raised" over the wrong status set, while still answering
   "how much failed?". Rejected: a `statuses[]` filter param — one bad call and the
   agent contradicts the dashboard.
2. **Time is a closed union**: either `{preset: enum}` (last_30_days, last_month,
   this_quarter, ytd, all_time, ...) or `{startISO, endISO}`. Every response echoes
   `resolvedRange {startISO, endISO, timezone}` so a misinterpretation is visible in
   the transcript instead of silent.
3. **Timezone is server-fixed (UTC), never a parameter.** If the agent could pick a
   different zone than the dashboard, 46 of 251 rows would land in different days.
4. **Every response carries `coverage: {datasetMinISO, datasetMaxISO, rowsMatched}`.**
   This is the anti-hallucination mechanism: an empty result is *self-describing*
   ("0 rows matched; data covers 2026-01-01..2026-06-29") rather than just empty.
   Q1 ("last month" -> July -> zero rows) is answerable honestly with no special case.
5. **Money returns both `cents` (int) and `formatted` (string).** The model is
   instructed to quote `formatted` verbatim and never convert cents itself — the LLM
   is a client, and clients don't do money math.
6. **`strict: true` + `additionalProperties: false`** on every tool. The model
   cannot invent a parameter that does not exist.
7. **Limits are clamped server-side** and responses carry `truncated` + `totalMatched`.
   A silent truncation is a correctness bug: "our donors are X, Y, Z" when there are 223.
8. **The agent gets aggregates and display names — never donor emails.** Tool results
   are persisted verbatim in `chatMessages`, which is a durable unauthenticated PII
   store. None of the five required questions need an email. Cost: the agent cannot
   answer "what's Amina's email"; the donors dashboard page can.
9. **Anonymity is resolved per-donor on read**: show the name if *any* non-anonymous
   gift exists, else "Anonymous donor". 2 emails in the seed are both.

### 9.4 Rejected alternatives

- **One `query_donations(groupBy, metrics, filters, sort)` tool.** This is the
  "arbitrary input" design the brief rules out. Also makes model-vs-tool error
  attribution much harder and prevents per-tool description tuning.
- **One tool per required question.** Brittle; fails on the first question phrased
  slightly differently ("which campaign did best in Q1?").
- **Injecting the campaign catalog into the system prompt** instead of
  `list_campaigns`. Cheaper (5 campaigns, ~200 tokens, zero round trips) but the
  brief wants data reached through tools, and a visible resolution step in the tool
  log is worth the round trip for debuggability.
- **A dedicated `compare_campaigns` tool for Q5.** `get_breakdown` filtered to two
  campaign ids already answers it. Adding it would slide toward per-question tools.

### 9.5 Debuggability (brief: "model error or tool error?")

Every tool result carries `_meta: {tool, resolvedFilter, rowsMatched, durationMs}`,
persisted alongside `toolName`/`toolArgs` in `chatMessages` and rendered as an
expandable card in the UI. A wrong number is then attributable at a glance: wrong
`resolvedFilter` = model error; right filter + wrong number = tool error.

### 9.6 Open, undecided

- **Streaming.** Leaning persist-and-subscribe (action writes batched deltas via
  internal mutation, client `useQuery` re-renders) over an `httpAction` SSE stream,
  because it reuses persistence the brief already requires and survives refresh.
  Costs DB writes per flush. Brief permits cutting streaming entirely.
- **Convex runtime for the action.** Default V8 runtime should work (SDK targets web
  standards); `"use node"` is the fallback. Verify early — it is cheap to test and
  expensive to discover late.
- **Pagination for `listByCampaign`.** Still unresolved; see §4.

---

## 10. Decisions taken (locked)

| # | Decision | Rationale / rejected alternative |
|---|---|---|
| D1 | **UTC for all reporting and date bucketing.** | Reproducible; seed epoch is UTC midnight so seed-day index == UTC calendar day exactly. **Production would use an org-configured timezone** — 46 of 251 rows change calendar day in America/Toronto, so this is a real product decision deferred, not a non-issue. |
| D2 | **Historical `succeeded` donations count toward org totals regardless of current campaign status.** | Money that arrived is a historical fact; `status` governs whether a campaign accepts *new* gifts, not whether past gifts happened. Org total = **$66,705.00** including the ended campaign's $570. Excluding it would give $66,135.00. |
| D3 | **No `convexToJsonSchema()`. Hand-maintain the tool schemas.** | Six small schemas. The generator is the better call at scale; at this size it is infrastructure that has to be explained in a walkthrough without earning its keep. Accepted cost: the tool schema and the Convex validator can drift, so they must be edited together. |
| D4 | **No streaming until all required functionality, correctness, tests, and UI are complete.** | The brief permits it: "streaming if you can, not at the cost of correctness." Persist-and-subscribe (§9.6) remains the chosen approach if time allows. |
| D5 | **Keep the shared reporting architecture and result-shape tool design** (§9). | Unchanged. |

### D2 follow-up: draft-campaign inspection

Asked to flag anything ambiguous before locking D2. Findings:

**The seed makes the decision unobservable.** `untitled-draft` has **0 donation rows**,
so it contributes $0 under either reading. The number does not move — but the code
still has to pick a rule, and the rule is not free.

**The genuine ambiguity is that `status` is mutable while donations are historical.**
Three cases:

| case | in seed? | under D2 |
|---|---|---|
| `ended` campaign with past gifts | yes — $570 | counts |
| `draft` campaign with no gifts | yes — $0 | contributes nothing |
| `draft` campaign **with** past gifts | **no** | would count |

The third case is reachable in the data model even though the seed does not contain
it: nothing prevents an `active` campaign being flipped back to `draft`, and
`donations:create` only refuses *new* gifts to non-active campaigns — it does not
remove gifts already recorded.

**That actually resolves the ambiguity rather than deepening it.** Because
`donations:create` rejects any gift to a non-active campaign, a draft campaign can
*only* acquire donations by having previously been active. In that case the money is
real and belongs in the total. So D2 extends to `draft` cleanly, and the rule becomes
a single sentence: **campaign status never filters historical money.**

**Consequence to handle in the UI, not the aggregation:** the org total silently
includes money from campaigns that are closed or unpublished. The campaign breakdown
must therefore show each campaign's status, so $570 from a closed campaign is
visible as such rather than looking like current activity.

**Two empty-state cases confirmed from the same inspection:**
- `untitled-draft` has **no `content` object at all** and no `goalCents`. The campaign
  detail route must render a campaign with no headline, no description, no goal, and
  zero donations without blanks or `NaN`.
- `scholarship-endowment` is **active with no `goalCents`** ($7,275 raised). Percent-
  to-goal must be `null`, not `0%` or `Infinity`.

---

## 11. NOTES.md rewrite before submission — TODO

This file is currently a **working scratchpad**. Before submission it gets rewritten
from scratch as a concise engineering document covering only:

- what was actually built
- major design decisions and why
- key correctness guarantees
- important tradeoffs
- known limitations
- verification results

Explicitly **not** carried over: the chronological reasoning, setup diary, prompt
history, and the long tail of every edge case discovered along the way.

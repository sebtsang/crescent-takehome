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

### Q3 "Who are our top 10 donors?" -> tie broken by email

Ranks 1-2 are unambiguous (amina.haddad $3,435, wei.kim $3,110). **32 donors are
tied at exactly $1,000**, so ranks 3-10 are arbitrary without a deterministic
secondary sort. `computeDonorRollup` tiebreaks on email ascending; the resolved
top 10 is in BASELINE.md. Both top donors have anonymous gifts and both correctly
resolve to *named*, because a donor is anonymous only if every gift was.

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
| D6 | **Every reporting query collects the whole `donations` table. No indexed narrowing.** | See §12 — this is a correctness decision, not a simplicity concession. |
| D7 | **A donor is anonymous only if *every* gift was.** | A deliberate product assumption, not an inherent truth. See §13. |

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

---

## 12. Read strategy: why full-collect, and where the ceiling is

Every query in `convex/reporting.ts` calls `.collect()` on the whole `donations`
table. The `by_campaign` and `by_created` indexes exist and are deliberately
unused.

**This is a correctness decision.** `computeStats` and `computeTimeseries` take
the *unscoped* rows so that `coverage` can report the dataset's true bounds even
when the scope matches nothing. That is the mechanism that lets "how much did we
raise last month?" answer **"$0.00, and the most recent gift is 2026-06-29"**
instead of a bare zero the caller has to interpret — the single most important
anti-hallucination property in the design.

An indexed range read for July returns **zero rows**, so `coverage` would report
`null` bounds and that guarantee would disappear silently. Restoring it needs a
second query purely for dataset bounds, which means two sources of truth for
"what is the dataset" — precisely the drift this architecture exists to prevent.
The optimisation would have bought nothing measurable at 283 rows and cost the
property the whole design is built around.

### What this will not survive

At 283 rows this is instant. It will not survive hundreds of thousands. And it
does not degrade gracefully into slowness: Convex enforces a document-read limit,
so a large table makes these queries **fail outright** rather than return a wrong
number. That is the better failure mode, but it is still a hard ceiling.

The org-wide "all time" case is the real wall. Campaign- and date-scoped reads
can be narrowed with the existing indexes; an unscoped org total has nothing to
narrow on and must read everything.

### What production would do

1. **Indexed reads** for the scoped cases (`by_campaign`, `by_created`), with
   dataset bounds served by a separate cheap query — two `first()` reads against
   `by_created` — so `coverage` survives.
2. **Precomputed rollups** for the unscoped totals: a denormalised per-campaign
   and per-period aggregate maintained on write, or Convex's aggregate component.
3. **Reconciliation** for those rollups. A rollup that drifts from the donations
   table is a second source of truth for money, so it needs a periodic job that
   recomputes from source and alerts on mismatch. Without that, the rollup is a
   liability rather than an optimisation.

None of that is here, deliberately: it is unobservable at this scale, and it
would have come out of the time the assistant needs.

---

## 13. The anonymity rule is a product assumption

`computeDonorRollup` treats a donor as anonymous **only if every one of their
gifts was anonymous**. Two seeded donors are mixed — `wei.kim` (1 anonymous of
13) and `amina.haddad` (2 of 11) — and both resolve to *named*.

**This is a judgment call, not a fact the data implies.** The schema stores
`anonymous` per gift and says nothing about what that means for a donor. The rule
here reads it as *"this gift should not be attributed publicly"*, so a donor who
has elsewhere attached their name has not asked to be hidden from staff.

A reasonable organisation could choose differently:

| alternative | argument for it | why not chosen |
|---|---|---|
| **Any anonymous gift hides the donor everywhere** | Strictest reading of donor intent; safest under a privacy complaint | Erases 2 of the top 2 donors from the donors table, making the org's most important relationships invisible to the staff who steward them |
| **No donor-level answer; only per-gift display** | Avoids inventing a rule the data does not contain | The donors view and "top 10 donors" both *require* a per-donor answer; declining to have one means not building the feature |

Whichever is right depends on the nonprofit's donor-privacy policy and possibly
its jurisdiction. It should be an **org setting**, not a hard-coded constant.

Note also that the rule is **scoped to per-donor rollups only**.
`recentDonations` redacts per *gift* — a feed of individual gifts hides the name
on any gift marked anonymous, regardless of what that donor did elsewhere. The
two answers deliberately differ because they answer different questions.

---

## 14. Dashboard UI

Visual reference: the Polarity style guide. Tokens taken verbatim — light
`#FEFEFE`/`#F2F2F2`/`#E6E6E6`/`#000614`/`#22445C`, dark `#0E0E0E`/`#171717`/
`#262626`/`#FEFEFE`/`#7BA0BC`. `rounded-sm`, 1px borders, no shadows,
sharp-cornered uppercase controls, `text-xs font-semibold uppercase
tracking-wider` eyebrows, 2px focus ring at offset 2.

**Where I deviated, and why.**

| deviation | reason |
|---|---|
| "Cursor Gothic" → **Inter** | Not publicly distributed. Inter is the nearest grotesque that holds the reference's tight negative tracking and ships real tabular figures. |
| Stat numbers `3rem`→`1.75rem` | The guide sizes stats for a marketing hero. Four KPI cards at 3rem is a billboard, not a dashboard, and the request explicitly ruled out oversized type. |
| Added `--grid`, `--bar-muted`, `--surface-raised`, status tones | A dashboard needs states a marketing site never had. Derived from the palette, not invented alongside it. |

**Bars, not a line — a correctness argument, not a style one.** 47 of the 180
days have no succeeded gift. A line chart interpolates straight through them,
drawing a steady climb across a fortnight where nothing arrived. Bars leave the
gap visible. This is the same reason `computeTimeseries` zero-fills; the chart
would throw that guarantee away by smoothing. Empty buckets render as a 1px
baseline tick so a gap reads as *zero*, not as *missing*.

**Default range is `all_time`.** The data ends 2026-06-29 and "today" is well
past it, so a conventional 30-day default renders an empty dashboard that reads
as a broken build. The header prints the requested window *and* the dataset
coverage (`2026-07-24 → 2026-08-22 · data covers 2026-01-01 → 2026-06-29 · UTC`),
so an empty result is self-explaining — the same principle as `coverage` in the
tool payloads.

**No layout shift.** Convex `useQuery` returns `undefined` on first render, so
`{data && <X/>}` collapses a card to zero height and snaps it open. Every
data-bearing component reserves its final height: `Figure` renders a skeleton of
identical dimensions, KPI cards carry a fixed-height note row even when the note
is empty, tables have `min-h-[16rem]`, and the chart's hover readout is a
fixed-height row rather than a floating tooltip. Skeletons are not animated.

**Money is never formatted client-side.** `recentDonations` returns
`{cents, formatted}` from the server's `formatCents`. An early draft had a local
`formatCents` in the component; it was removed. The LLM is not the only client
that must not do money maths — the browser is a client too.

**Goal bars clamp at 100%; the number does not.** Two campaigns are over goal
(171.8%, 199.0%). A campaign with no goal renders "No goal", never `0%`.

Known gaps: `/dashboard/campaigns/[id]`, `/dashboard/donors` and
`/dashboard/assistant` are not built. Nav links only routes that exist — a link
to a 404 is worse than a missing link.

---

## 15. The assistant

**Six tools, split by result shape** (`convex/agent/tools.ts`): `list_campaigns`,
`get_fundraising_stats`, `get_campaign_breakdown`, `get_donation_timeseries`,
`list_top_donors`, `list_recent_donations`. Every `run` is a thin
`ctx.runQuery` to the *same* query the dashboard calls.

Convex actions cannot touch `ctx.db`, so this is enforced by the platform rather
than by discipline: the agent has no way to reach a donation row. It chooses
which question to ask; the server computes every number.

**Manual tool loop, not the SDK tool runner.** Each tool call and result is
persisted to `chatMessages` as it happens — the brief requires that, and it also
gives the UI live progress without implementing streaming, since the client
subscribes to the messages query and tool cards appear while the model is still
working. The runner would have made per-call persistence awkward for no gain.

**`thinking` is omitted** rather than set to `adaptive`: Opus 5 runs adaptive by
default, and SDK 0.65's types predate the `'adaptive'` literal.

### Anti-hallucination, structurally rather than by prompting

- The system prompt contains **no figures**, so there is nothing to parrot.
- Tool results are self-describing: `coverage` states the dataset bounds, so an
  empty July returns "0 rows, data covers 2026-01-01 → 2026-06-29" instead of a
  bare zero. The honest answer is the easy answer.
- Money crosses as `{cents, formatted}`. The model is told to quote `formatted`
  verbatim and may compare `cents` but never do arithmetic on it.
- `additionalProperties: false` everywhere, so the model cannot invent an
  argument — most importantly a `statuses` filter, which must never exist. A test
  asserts the string "statuses" appears nowhere in the schemas.
- Tool failures return `is_error` to the model rather than throwing, so it can
  correct its arguments or say it cannot answer.

### Schema drift — the risk D3 accepted, now mitigated

Hand-written schemas can drift from the Convex validators they mirror. Schemas
live in `convex/agent/schemas.ts` with no Convex imports so they are directly
testable, and `tests/agent-schemas.test.ts` pins the range presets against
`RANGE_PRESETS` and the sort enums against the reporting constants. Drift now
fails a test instead of surfacing as an agent that quietly cannot express a range.

### Privacy

`list_top_donors` projects `email` away before the result is returned. Tool
results are persisted verbatim in `chatMessages`, which is a durable store with
no auth in front of it, and no question the assistant answers needs an email.
The donors dashboard page still shows emails — it reads the query directly and
renders them ephemerally.

### Debuggability

Every tool result carries `_meta {tool, durationMs}`, and the UI renders each
call as an expandable card showing arguments and full result. That makes a wrong
number attributable at a glance: wrong arguments is a model error, right
arguments with wrong figures is a tool error, and right figures with wrong prose
is a presentation error — three different fixes in three different files.

### Setup required

Credentials live on the **Convex deployment**, not in `.env.local` — the agent
runs in a Convex action, server-side, so `.env.local` would never reach it.

```
npx convex env set ANTHROPIC_API_KEY <key>
```

Without any credential the agent degrades gracefully: it appends a message naming
the variables and the commands to fix them rather than throwing. That path is
verified; the model path is not (see §16).

**`ANTHROPIC_API_KEY` is the intended and supported configuration**, and the only
one this project treats as shipped. It is what a reviewer will set.

**`ANTHROPIC_AUTH_TOKEN` is a local-development convenience.**
`claude setup-token` issues a long-lived OAuth credential tied to a Claude
subscription; the Messages API accepts it as `Authorization: Bearer` together
with the `anthropic-beta: oauth-2025-04-20` header, and usage draws on the
subscription rather than Console credits. That makes iterating on the agent free.

It is checked **before** the API key, so setting it is an explicit override and a
deployment with only `ANTHROPIC_API_KEY` behaves exactly as the supported path.
The active mode is logged (`[assistant] auth mode: …`) so it is never a mystery
which credential answered.

Two honest caveats, recorded rather than buried: this is **not an officially
supported way to authenticate a third-party application** — the beta header and
OAuth scopes carry no compatibility promise and can stop working without notice —
and it is outside the intended use of a subscription credential. It is used here
only for local iteration against the author's own subscription, never as the
shipped configuration.

---

## 16. Not yet verified

- **The assistant's actual answers.** No `ANTHROPIC_API_KEY` has been set on the
  deployment, so the model has never run. Everything around it is verified —
  thread creation, message persistence, the action dispatching, tool-call
  rendering, and the missing-key path — but no real answer has been produced or
  checked against BASELINE.md §"Answers to the five required agent questions".
- **Mobile/responsive layout.** Built with responsive classes, only checked at
  1280px.
- **Accessibility** beyond focus rings, ARIA labels on controls, and semantic
  tables. No screen-reader pass.
- **Concurrency.** Two rapid submissions in one thread are not guarded
  server-side; the UI disables the input while busy, which is a client-side
  guard only.

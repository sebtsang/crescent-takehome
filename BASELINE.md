# Verified Baseline

Ground truth for every figure this project reports. Confirmed two independent ways:
read out of the seeded Convex development deployment, and re-derived offline from the
seed's PRNG. All 283 rows matched field-by-field.

Re-verify at any time:

```bash
node scripts/verify-baseline.mjs
```

Every number below is stated **with the filter that produced it**. A figure without its
filter is not a fact — the two most common wrong answers in this dataset come from
correct arithmetic over the wrong row set.

---

## Org-wide

| metric | value | filter |
|---|---:|---|
| Total rows | 283 | none — every row in `donations` |
| Succeeded donations | 251 | `status === "succeeded"` |
| **Total raised** | **$66,705.00** | `status === "succeeded"`, `sum(amountCents)`, all campaigns, all dates |
| Unique donors | 223 | `status === "succeeded"`, `distinct(lowercased donorEmail)` |
| Average gift | $265.76 | raised ÷ succeeded count (6,670,500 ÷ 251) |
| Median gift | $100.00 | `status === "succeeded"` |
| Fees covered by donors | $1,223.38 | `status === "succeeded"`, `sum(feeCoveredCents)` |
| Total charged to cards | $67,928.38 | `status === "succeeded"`, `sum(amountCents + feeCoveredCents)` |
| Repeat donors | 3 | `status === "succeeded"`, emails with >1 gift |

Excluded from raised: **8 pending, 16 failed, 8 refunded** (32 rows, $7,710.00).

## Rules

1. Raised = `sum(amountCents)` over `succeeded` only. `pending`, `failed`, `refunded` never count.
2. `feeCoveredCents` is **not** part of raised — it is extra the donor paid on top of the gift. `amountCents` is what the org receives. Raised + fees = "charged", a different figure.
3. A donor is a lowercased email, not a row. 251 gifts came from 223 people.
4. Campaign status never filters historical money — succeeded gifts count whether the campaign is active, ended, or draft.
5. All date bucketing is **UTC**. `createdAt` is epoch milliseconds.
6. `feeCoveredCents === 0` is normal (112 of 251 succeeded rows), not missing data.
7. `anonymous` is a display flag only — anonymous gifts still count toward every total.

## Per campaign (succeeded only)

| campaign | status | gifts | raised | donors | goal | progress |
|---|---|---:|---:|---:|---:|---:|
| legal-defense-fund | active | 154 | $42,940.00 | 137 | $25,000 | 171.8% |
| winter-meal-drive | active | 67 | $15,920.00 | 60 | $8,000 | 199.0% |
| scholarship-endowment | active | 26 | $7,275.00 | 26 | *none* | **null** |
| emergency-relief-2025 | ended | 4 | $570.00 | 4 | $50,000 | 1.1% |
| untitled-draft | draft | 0 | $0.00 | 0 | *none* | **null** |

Per-campaign donor counts do **not** sum to the org total: 137+60+26+4 = 227 vs 223 org-wide,
because 3 donors gave to more than one campaign.

## Monthly (succeeded only, UTC)

| month | raised | gifts |
|---|---:|---:|
| 2026-01 | $13,475.00 | 52 |
| 2026-02 | $10,525.00 | 42 |
| 2026-03 | $13,645.00 | 42 |
| 2026-04 | $10,055.00 | 44 |
| 2026-05 | $9,425.00 | 41 |
| 2026-06 | $9,580.00 | 30 |

**Data ends 2026-06-29.** There is no July or August data. Any "last 30 days" window
relative to today correctly returns **zero**.

## Repeat donors (succeeded only)

| email | gifts | lifetime | all rows |
|---|---:|---:|---:|
| wei.kim@example.org | 13 | $3,110.00 | 15 (1 failed, 1 refunded) |
| amina.haddad@example.org | 11 | $3,435.00 | 11 |
| marcus.silva@example.org | 7 | $775.00 | 7 |

`wei.kim` is the **canary**: its gift count is 13 with the status filter and 15 without.
Any code path reporting 15 has lost the filter.

---

## Naive-sum traps — these numbers are WRONG

If code or a test ever produces one of these, a specific rule has broken:

| wrong value | what it actually is | correct value | broken rule |
|---:|---|---:|---|
| $74,415.00 | sum over all 283 rows | $66,705.00 | missing status filter |
| 253 | distinct emails over all rows | 223 | missing status filter |
| $67,928.38 | raised + fees covered | $66,705.00 | fees folded into raised |
| 283 | all rows counted as donations | 251 | missing status filter |
| 251 | succeeded rows counted as donors | 223 | rows treated as people |
| 15 | wei.kim's row count | 13 | missing status filter |

## Answers to the five required agent questions

| question | answer |
|---|---|
| How much did we raise last month? | **$0.00** — "last month" has no data; most recent gift is 2026-06-29 |
| Which campaign is doing best? | Ambiguous — legal-defense-fund by raised ($42,940), winter-meal-drive by % of goal (199.0%). Must state the metric. |
| Who are our top 10 donors? | #1 amina.haddad $3,435 (11 gifts), #2 wei.kim $3,110 (13 gifts), then **32 donors tied at exactly $1,000** — see below |
| How many people gave more than once? | **3** |
| Did the meal drive beat the legal fund in March? | **No** — legal fund $7,710.00 (24 gifts) vs meal drive $3,785.00 (14 gifts) |

## Empty-state cases

- `untitled-draft` — no `content` object at all, no goal, zero donations.
- `scholarship-endowment` — active, $7,275 raised, **no goal**: progress must be `null`, not `0%` or `Infinity`.
- 44 of 180 days have no donations — timeseries must emit explicit zero buckets.
- Any range after 2026-06-29 is legitimately empty.

## Donors

| metric | value | filter |
|---|---:|---|
| Unique donors | 223 | `succeeded`, distinct normalised email |
| Donors with >1 gift | 3 | `succeeded`, gift count >= 2 |
| Donors tied at exactly $1,000 lifetime | **32** | `succeeded` |
| Fully anonymous donors (every gift anonymous) | 15 | `succeeded` |
| Mixed-anonymity donors (some anon, some named) | 2 | wei.kim (1 of 13), amina.haddad (2 of 11) |
| Anonymous succeeded gifts | 18 | `anonymous === true` |

**Top donors, with the tie broken by email ascending.** Ranks 1-2 are unambiguous.
Everything from rank 3 down is tied at $1,000, so the order below is only
reproducible *because* of the tiebreak — without one, the dashboard and the agent
would each pick a different #7.

| # | email | lifetime | gifts |
|---:|---|---:|---:|
| 1 | amina.haddad@example.org | $3,435.00 | 11 |
| 2 | wei.kim@example.org | $3,110.00 | 13 |
| 3 | amina.kim101@example.org | $1,000.00 | 1 |
| 4 | andre.ali364@example.org | $1,000.00 | 1 |
| 5 | andre.haddad615@example.org | $1,000.00 | 1 |
| 6 | andre.rahman367@example.org | $1,000.00 | 1 |
| 7 | clara.kim268@example.org | $1,000.00 | 1 |
| 8 | clara.nguyen816@example.org | $1,000.00 | 1 |
| 9 | clara.rahman624@example.org | $1,000.00 | 1 |
| 10 | diego.kim699@example.org | $1,000.00 | 1 |

**Anonymity rule:** a donor is anonymous only if *every* gift was. Both
mixed-anonymity donors above resolve to named — someone who publicly attached
their name to a gift has not asked to be hidden.

## Timeseries

| window | granularity | buckets | empty |
|---|---|---:|---:|
| 2026-01-01 .. 2026-06-29 | day | 180 | **47** |
| 2026-01-01 .. 2026-01-31 | day | 31 | 5 |
| all time | week | 27 | 0 |
| all time | month | 6 | 0 |
| 2026-07 (last month) | day | 31 | **31** |

First week bucket is **2025-12-29** — Jan 1 2026 was a Thursday, so the
Monday-start week containing it began in the previous year. Correct, not a bug.

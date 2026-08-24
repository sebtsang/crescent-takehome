# Crescent take-home

A small fundraising product. A nonprofit builds a campaign, publishes it,
donors give money, and the org needs to understand what came in.

**Your brief was sent to you separately.** It tells you what to build. This
file covers everything common to it: setup, the data model, and how we read
what you submit.

> **Submission:** see [`NOTES.md`](NOTES.md) for engineering decisions,
> correctness rules and known limitations, and `architecture.html` for a visual
> overview of the data model and reporting architecture.

---

## Setup

You need Node 20 or newer.

```bash
npm install
npx convex dev          # first run: log in, create your own dev deployment
npx convex run seed:run # deterministic seed data
npm run dev             # http://localhost:3000
```

`npx convex dev` must keep running in its own terminal. It pushes your Convex
functions on save and generates the types in `convex/_generated`.

> **Expect type errors before that first `npx convex dev`.** `convex/_generated`
> does not exist in a fresh clone, so your editor and `npm run typecheck` will
> report "Cannot find module './_generated/server'" errors, plus the implicit
> `any` errors that follow from them. They all disappear once Convex has
> connected once. Nothing is broken.

You will create your own free Convex account, so the deployment and its data
are entirely yours.

Re-seed whenever you want a clean slate:

```bash
npx convex run seed:run
```

If your brief involves an API key, it was sent to you separately. Set it on your
Convex deployment:

```bash
npx convex env set ANTHROPIC_API_KEY <key>
```

The assistant runs in a Convex action, which executes on Convex's servers, so it
reads the deployment's environment rather than `.env.local`. Check it with
`npx convex env list`. **This repository is public — a key in a commit is visible
to everyone immediately.**

---

## The data model

Read `convex/schema.ts` top to bottom before you write anything. Every comment
in it is load-bearing, and a few of them describe rules that are easy to get
wrong in ways that look fine.

The seed is deterministic: no randomness, no `Date.now()`. Everyone gets the
same numbers, so when you report a figure we can check it.

`convex/campaigns.ts` and `convex/donations.ts` each contain fully implemented
functions. They are there as a reference for the house style — validate at the
boundary, never trust stored data, keep money in integer cents. Match it.

Some functions in those files throw `Not implemented`. Implement the ones your
brief covers and leave the rest alone.

**Do not rewrite `convex/schema.ts`.** Add tables and add optional fields
freely. Renaming or removing what is there breaks the seed. If you think
something is modelled wrong, say so in `NOTES.md` — noticing is worth more than
silently working around it.

---

## Ground rules

**Use whatever tools you normally use, including AI.** We do not care whether
Claude or Cursor wrote a line. We care whether you can explain why it is there,
what it does when the input is empty, and what you would change with more time.
Expect to be asked, about any part of it.

**Commit as you go.** A single squashed commit at the end tells us nothing. We
read the history to see how you work, and a messy honest history reads better
than a clean fake one.

**Scope is yours to cut.** Your brief asks for more than is strictly necessary.
Finishing three things properly beats half-finishing six. If you cut something,
say what and why in `NOTES.md`. Cutting deliberately reads as judgment; running
out of time silently reads as not finishing.

---

## `NOTES.md` — required

Create one at the repo root. Keep it as you work, not the night before you
submit. It is read as carefully as the code. Include:

- **What you built** and what you did not, and why.
- **Decisions you made and the alternative you rejected.** Especially anywhere
  the brief was ambiguous. Naming the tradeoff matters more than which side you
  landed on.
- **What is wrong with it.** Every codebase has known problems. Listing yours
  is a strong signal, not a weak one. We will find them anyway, and finding one
  you already flagged reads completely differently from finding one you did not.
- **What you would do with another week.**
- **Anything that surprised you** about Convex, the schema, or the data.

A good `NOTES.md` has rescued a mediocre submission more than once. A missing
one has sunk a good one.

---

## Submitting

Work in your own fork or your own private repo — not on this one. Send us the
link when you are done.

Include in `NOTES.md` anything we need in order to run it: a required env var,
a seed step, a route you know is broken.

We will then walk through it together for about 45 minutes: you demo it, we ask
why you made specific decisions, and we change a requirement to see how the
design holds. Nothing is memorized and nothing is a trick. Bring the code you
actually wrote.

---

## What "done" means

There is no hidden test suite and we are not counting features. We are looking
for work that is correct where correctness matters — money, permissions, empty
states — and honest about where it is not.

If you find yourself choosing between one more feature and making the existing
ones actually right, choose the second one. Every time.

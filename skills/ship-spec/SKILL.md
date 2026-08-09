---
name: ship-spec
description: Ship a whole spec - discover its issues, then orchestrate build, review, verify, commit, and close for each, looping until every one is done.
disable-model-invocation: true
argument-hint: "<spec #> [--reset <when>] [--resume]"
---

Ships every issue tracked by a spec as an orchestrated implement-loop. This is the
opt-in full-orchestration mode: you **coordinate and delegate every build** - you
write no implementation code in your own context; a `builder` sub-agent does. Best
run with Fable as the primary model (delegation keeps Fable cheap), but works on
any. Attach the goal skill so this loops until done.

Arguments: `$ARGUMENTS`. The first token is the spec number - the source of truth
for what to build. `--reset <when>` (e.g. `--reset 3h40m` or `--reset 2:35pm`)
tells the continuity switch when the usage window turns over. `--resume` picks up
an interrupted run.

Replace `<skill-root>` with the directory containing this skill's `SKILL.md`.

## Continuity (long runs)

A full run can outlast the 5-hour usage window and be cut off mid-task. To make it
resumable, keep a durable **ledger** and arm a **dead-man switch** - a one-shot
cron that auto-resumes ~10 min after the window reopens. When a run may cross the
window, set this up **first**, using the `--reset <when>` value (this harness
can't read session usage itself); see [references/resume.md](references/resume.md).
If invoked with `--resume`, skip discovery-from-scratch and follow
references/resume.md to reconstruct state and continue.

## 1. Discover and plan

Delegate discovery to an `assistant`. Brief it to:

- Run `node "<skill-root>/scripts/discover.mjs" $1`. That script only
  **enumerates** - it tries all three linkage mechanisms (native sub-issues, spec
  body refs, reverse body search) so no tracked issue is missed, and dumps each
  issue's raw title, labels, and full body. It does **not** judge scope, UI, or
  dependencies - that's the assistant's job.
- Read the dump and return a compact plan: a one-line scope per issue, a UI/UX
  flag per issue (read the body - labels won't say so), and a dependency-ordered
  execution plan that marks which issues are independent enough to parallelize.
  Mark any issue already `CLOSED` in the dump as done and drop it from the plan.
  Use the issues' own signals - parent links, phase/slice numbering, acceptance
  criteria, "depends on / builds on" prose - not just keywords.
- Sanity-check the set for completeness: GitHub's reverse search is not perfectly
  deterministic, so if the numbering has an obvious gap (phases 6A–6J but 6F is
  missing from the dump), find and add the straggler before planning.

If the script reports zero tracked issues, have the assistant read the spec body
itself and identify the implementation issues before planning.

The assistant's plan is your execution input for the rest of this skill.

## 2. Set up the branch and order

Create the integration branch off the default branch (`ship/spec-<N>`) and do all
work there - never commit to the default branch. Record it in the ledger. (On
`--resume` it already exists; reconcile, don't recreate.)

Then settle the execution order from the assistant's plan:

- **Sequential (default):** dependent issues run one at a time, in dependency
  order, on the integration branch - later issues build on earlier ones.
- **Parallel lanes:** issues with no blocker between them **and** low file overlap
  may run at once, each in its own worktree off the integration branch. If you'll
  parallelize, read [references/parallel.md](references/parallel.md) - it owns the
  lane and merge mechanics. When overlap is uncertain, stay sequential.

## 3. Build each issue

Per issue, in order. Delegate implementation to a `builder`. Brief it to:

- Implement the issue; use /tdd at sensible seams.
- If the plan flags the issue as touching UI/UX, use /impeccable **while
  implementing** - it aids the design work; it is not a cleanup pass.
- Typecheck and run single test files as it goes; run the full suite once at the
  end; then run the verify command (e.g. `pnpm verify`).
- Report the diff summary + verification result. Do NOT run /code-review and do
  NOT commit yet.

Then, at your orchestrator level:

1. Run /code-review. It spawns two sub-agents (Standards vs Spec), which only the
   primary agent can do - a `builder` can't. For a UI/UX issue, also run
   /impeccable here so the review carries the design context.
2. Send the findings to the **same** `builder`; it fixes, re-runs the full suite +
   verify, and reports.
3. Have the `builder` commit to the integration branch with a conventional-commit
   message including `Closes #<issue>`, then `gh issue close <issue>` with a
   one-line summary + the commit SHA (unpushed commits don't auto-close). Do NOT
   push.

Update the continuity ledger at each transition (see references/resume.md) so an
interrupted run can resume. If a `builder` hits a blocker or ambiguity, it stops
and reports - you decide next steps rather than letting it guess.

## Done

Every issue in the plan is closed, and the integration branch passes the verify
command. Nothing is pushed. Tear down the dead-man switch (`CronDelete` the armed
job) and mark the ledger done.

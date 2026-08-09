# Continuity across the usage window

A full run can outlast the 5-hour Claude Code usage window and be cut off
mid-task - a builder implementing, a review running, lanes half-merged. Two pieces
make it resumable: a durable **ledger** (survives anything) and a **dead-man
switch** (a one-shot cron that auto-resumes when the window reopens).

Replace `<skill-root>` with the directory containing the skill's `SKILL.md`.

The ledger is the real guarantee; the switch is best-effort automation on top. The
cron is session-only and in-memory - it fires only if the Claude Code process
stays alive through the rate-limit block (terminal open, machine awake). If the
process exits, the switch is lost - but the ledger isn't, so `/ship-spec <N>
--resume` still recovers by hand. Never let correctness depend on the switch.

## The ledger - source of truth

Keep a compact markdown ledger, updated at **every** state transition, at:

```
~/.claude/ship-spec/runs/<owner>__<repo>__spec-<N>.md
```

(the repo slug's `/` replaced with `__`). It records what no dead session can be
trusted to remember:

- spec number, integration branch, and switch info: the next fire time + the cron
  job ID currently armed.
- The plan: every issue, in dependency order, with the parallel groupings.
- Per-issue status: `pending → implementing → in-review → fixing → committed →
  closed`; for a lane, its worktree path + branch.
- The one in-flight action right now (e.g. "builder implementing #280").

## Arm the dead-man switch

At the start of a run - and again first thing on every resume - arm a one-shot
cron to fire ~10 min after the window resets: enough leeway for timing slop, tight
enough not to waste the fresh window.

You need the reset time. On a **first** run it comes from `--reset <when>` (this
harness can't read session usage). On a **resume** the window just opened, so it
runs ~5h from now - arm for `+5h` and don't ask.

Compute the cron fields with `date` (fire = reset + 10 min):

```
date -d '+3 hours 50 minutes' +'%M %H %d %m'   # reset in 3h40m → "M H DoM Mon"; DoW is *
date -d '2:35pm +10 minutes'  +'%M %H %d %m'   # absolute reset time
date -d '+5 hours' +'%M %H %d %m'              # re-arm on resume: +5h lands at next reset+10min
```

Then `CronCreate` with `recurring: false` and the resume prompt below. If the
ledger already names an armed job ID, `CronDelete` it first so switches don't
stack. Record the new job ID in the ledger.

Resume prompt (self-contained - it fires in a fresh session with no memory):

```
Resume the ship-spec run for spec #<N>: a fresh usage window just opened. Run
`/ship-spec <N> --resume`. Its ledger is at
~/.claude/ship-spec/runs/<owner>__<repo>__spec-<N>.md - reconcile that against
git/gh, re-arm the dead-man switch for the next window, then continue the plan.
```

## Resume procedure (`--resume`, or when the switch fires)

1. Read the ledger to recover the plan and where it left off.
2. Reconcile against ground truth - context is gone, so trust artifacts over the
   ledger's remembered in-flight line:
   ```
   node "<skill-root>/scripts/status.mjs" <issue#...>
   ```
   Closed = done. Open + lane branch = implemented, check review/merge. An open
   worktree marked DIRTY = a builder was cut off mid-implementation.
3. Re-arm the next switch (`+5h`) **before** doing work, so a second death still
   chains the run forward.
4. Restart the interrupted action: sub-agents don't survive a session, so re-spawn
   the builder or review for the in-flight issue with the same brief, then carry on
   through the plan in order.
5. Keep updating the ledger as you go.

## Teardown

When every planned issue is closed, `CronDelete` the armed switch (its ID is in
the ledger) and mark the ledger done. Don't leave a switch firing into a finished
run.

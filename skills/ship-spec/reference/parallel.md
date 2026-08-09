# Parallel lanes

Reached from SKILL.md step 2 when a set of issues have **no blocker between them
and low file overlap**. Each issue runs in its own **lane** — a `ship/issue-<n>`
branch + git worktree — so builders work at the same time. If overlap is
uncertain, don't: fall back to the sequential loop in SKILL.md step 3.

## Open a lane per issue

```
node ~/.claude/skills/ship-spec/scripts/worktree.mjs open <issue#> [<issue#>...]
```

Creates a worktree + `ship/issue-<n>` branch per issue off the current
integration branch, under a sibling `<repo>-worktrees/` dir, and **seeds each lane
so it can actually run**: worktrees check out only tracked files, so it copies the
gitignored env files (`.env*`, monorepo-aware) from the main checkout, then makes
dependencies available. Deps mode:

- **default** — install with the detected package manager. Correct and fully
  isolated; already fast for pnpm with a warm store. Install can be slow, so give
  this Bash call a generous timeout.
- **`--link-modules`** — hardlink every `node_modules` tree from the main checkout
  instead (near-instant, low space; falls back to install if main has none). Use
  this when a fresh install would be slow. Caveat: if a lane changes dependencies,
  that builder must run a real install.
- **`--no-install`** — do nothing; each builder installs as its first step.

It prints each lane's path.

Delegate one `builder` per lane, pointed at that path, and run them
in the background. Give each lane's builder the **same brief as SKILL.md step 3**
(implement, /tdd, /impeccable if the plan flags UI/UX, tests + verify). You still run
/code-review per issue at your level and send findings back to that lane's
builder to fix. Each builder commits to its lane branch with `Closes #<issue>`
but does **not** close the issue yet — closing waits for the merge.

Lanes get isolated files and dependencies, but they still share the machine's
ports and any stateful dev services (one local DB, one Stripe/Mailgun test
account). So keep lane work to checks that don't collide — typecheck, unit tests,
the verify command — and defer anything that binds a port or hits a shared
service (integration/e2e) to a single run on the integration branch *after* the
merges. That sidesteps the collisions without needing per-lane sandboxing.

## Forecast conflicts before merging

Once the lanes are committed:

```
node ~/.claude/skills/ship-spec/scripts/overlap.mjs
```

It runs a real 3-way `git merge-tree` check between the lanes: two lanes that
touched the same file only flag if they *actually* conflict, not just for
overlapping. It reports the conflict-free lanes (merge those first, no resolution)
and a fewest-conflicts-first merge order. Deterministic — read it instead of
eyeballing diffs to find where conflicts will land.

## Merge one lane at a time

In the script's suggested order, merge each lane branch into the integration
branch. On conflict, run /resolving-merge-conflicts — you hold the context of
what every lane changed, so resolve with that in mind. After each merge, re-run
the verify command on the integration branch before starting the next merge.

## Close and tear down

When a lane's branch is merged and verify passes, close its issue
(`gh issue close <issue>` with the commit SHA), then remove the lane:

```
node ~/.claude/skills/ship-spec/scripts/worktree.mjs close <issue#>
```

Do NOT push.

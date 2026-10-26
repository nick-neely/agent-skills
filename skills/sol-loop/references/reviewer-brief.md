# Reviewer brief

Fill in the placeholders. Give each reviewer the complete brief; delegated tasks may have no conversation history.

```text
Review only. Return findings to the caller. Do not edit, commit, push, post PR comments, start watchers or delegate.
Repository: <absolute path>
Base: <merge-base SHA>
Scoped paths: <paths>
Intent: <user-visible goal>
Out of scope: <exclusions>
Checks: <observed results, inherited failures and unavailable checks>
Diff command: <command for base to working tree in scope>
Untracked files: <intended files to inspect>

Read surrounding code and callers. Find behavior bugs and mismatches with intent.
Identify unnecessary scope growth. Recommend the smallest robust fix.
blocker = broken intended behavior or a material safety/correctness failure.
should = a real in-scope bug a plausible caller can encounter.
nit = optional polish or unrelated expansion.

Return:
VERDICT: APPROVE or CHANGES
S1 [blocker|should|nit] <file>:<line> <claim and evidence>. Fix: <suggestion>
Use stable IDs. Do not treat a time limit or an unrun check as approval.
```

For later rounds, append the ledger with fixed, dismissed, deferred and disputed IDs, their evidence, and the change since the previous round. Limit new review to changed code and open findings. Require each old ID to be marked resolved or still open with a reason.

# Resume and recovery

Run reconciliation after interruption, compaction, or a new session and before
each dispatch batch.

1. Read `run.json` and render its current dashboard.
2. Inspect live branches, worktrees, dirty state, processes, resource leases,
   issue states, pull request heads and bases, checks, reviews, and integration
   commits.
3. Run `ledger.mjs reconcile` to replace stale observations with live facts and
   append a reconciliation event when observations change. Preserve intended
   assignments and ticket states for the orchestrator to adjudicate.
4. Stop orphaned mutable services only after their owning worktree and process
   identity are proven. Never delete a dirty worktree during reconciliation.
5. Resume the first incomplete transition. Respawn a lost worker with the same
   bounded assignment and current primary sources.
6. Recompute frontier and concurrency eligibility before new dispatch.

If a lane fails, retain its branch and worktree, mark descendants blocked, and
continue independent frontier work. If integration becomes red, freeze child
merges until a corrective commit or repair pull request restores it.

Cancellation stops agents and mutable runtime resources, then reports branches,
worktrees, pull requests, and ledger paths with a proposed cleanup plan. Preserve
them until the user explicitly authorizes destructive cleanup.

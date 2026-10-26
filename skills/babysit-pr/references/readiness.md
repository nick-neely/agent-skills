# Readiness and merging

Read the live PR's head, actual base branch, checks, reviews, unresolved threads, draft state and mergeability. Use all pages of results. Evaluate required checks and approvals from repository instructions and GitHub's rules, including expected checks that have not appeared. If policy cannot be read, qualify the result instead of inferring that nothing is required.

Distinguish reviews completed on this head from old reviews. Reassess older unresolved findings against current code; a push does not dispose of them. Wait for the repository's gating reviewers and already-triggered gating reviews. Advisory status comes from repository policy, not the review bot's brand. A deferred nonblocking issue remains a disclosed limitation. A deferred blocker prevents readiness.

Fetch the actual base before handoff. Inspect whether new base commits overlap the PR's changed files, change dependencies it relies on, or invalidate its proof. Update the branch when required by policy, when conflicts exist, or when base changes invalidate verification; follow repository rebase or merge conventions. Re-run affected checks and wait for the new head after an update. Unrelated base movement alone need not trigger a rebase unless the repository requires an up-to-date branch.

If overlapping work makes the PR obsolete, stop monitoring and explain the overlap. Ask before closing it unless closure is already authorized.

Merge only with explicit authorization. Immediately before merging, fetch again and re-read the live head, base, required checks, human approvals and mergeability. If the head or relevant base changed, repeat the affected gate. Use the allowed merge method or queue and honor branch protection. Never use an administrative bypass. Verify the merged state and merge commit; a queued merge is still pending.

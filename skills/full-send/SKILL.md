---
name: full-send
description: Complete the current task through a verified merged PR when the user explicitly says full send.
---

# Full Send

Activate only on an explicit full-send request for the current task. Installing, quoting or discussing this skill grants no execution authority. The request authorizes task-scoped commits, pushes, updates to the task's branch with `--force-with-lease` after a rebase, PR submission, monitoring and merge through normal repository protections. System and harness permissions still apply.

1. **Finish the change.** Read project instructions and Git status. Preserve unrelated work. Create a task branch when on the default branch. Complete the user's goal with the smallest robust change.
2. **Prove the result.** Run repository-required checks. Reproduce the failure before and after when practical. For user-visible behavior, inspect the running interface and save useful evidence. Add tests for meaningful behavior where appropriate. Evidence must cover the final diff, including later fixes. Explain inherited failures and unavailable checks accurately.
3. **Review.** Use $sol-loop. Project instructions select the reviewer and available delegation route. An unavailable reviewer or an exhausted review budget is a blocker, not approval.
4. **File.** Use $file-pr, which uses $pr for the description. Ensure the base is current enough for repository policy and meaningful verification.
5. **Babysit.** Use $babysit-pr. Its watcher selection, two-round PR-bot budget and readiness gate govern this phase. Verify fixes before pushing; retain any disclosed follow-ups.
6. **Merge.** Re-read the live gate for the final head and base. Merge only after required checks and approvals pass, reviews are accounted for, no human requests changes, and GitHub reports mergeability. Honor branch protection and repository merge methods. Wait for a queued merge to complete; verify the merged state and merge commit.
7. **Report.** Link the PR and merge commit. State proof, review outcome, limitations and material decisions made for the user.

Stay responsible while checks or reviews are pending. Use $babysit-pr's watcher rather than ending work without a wakeup path. Stop that watcher before a blocked handoff or a question requiring the user.

Use reasonable defaults within the task. Ask when ambiguity changes the result, proof or the gate cannot be obtained, or the next action needs authority beyond this request. Production changes, data deletion, closing an obsolete PR, and force-pushing another branch require separate authorization. Ask through the environment's question tool when available, with the PR, blocker and a recommendation. If an answer is required, keep it pending; silence grants nothing. Leave the PR unmerged when blocked.

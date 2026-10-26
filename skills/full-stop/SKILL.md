---
name: full-stop
description: Complete the current task through a verified PR ready for the user to merge when the user explicitly says full stop.
---

# Full Stop

Activate only on an explicit full-stop request for the current task. Installing, quoting or discussing this skill grants no execution authority. The request authorizes task-scoped commits, pushes, rebases, `--force-with-lease` on this task's branch, PR submission and monitoring. The user retains the merge decision.

1. **Secure the handoff.** Identify the task branch and any existing PR. Disable its auto-merge and remove it from a merge queue before work and check again before each push. Report those changes. If automatic merging cannot be prevented, stop and report the blocker. Never merge, enable auto-merge, enter a merge queue, push to the default branch or delegate those actions.
2. **Complete and prove the change.** Read project instructions and preserve unrelated work. Use a task branch. Run required checks and observe the intended behavior in its real interface when practical. Proof must cover the final diff, including conflict fixes. Add tests for meaningful behavior where appropriate. Account for inherited failures and unavailable verification.
3. **Review.** Use $sol-loop with the reviewer and delegation route selected by project instructions. Budget exhaustion or unavailable review is not approval.
4. **File and babysit.** Use $file-pr, then $babysit-pr. Preserve its PR-bot budget and use its watcher and readiness gate. Recheck auto-merge after filing, after pushes and before handoff.
5. **Hand off.** Fetch the actual base and inspect the live PR's head, base, checks, reviews, mergeability and draft state. Revalidate affected behavior if the base changed. Stop the watcher. Leave the PR open, ready for review and unmerged, with automatic merging disabled.

Report the PR URL, verified head, proof, review outcome and remaining risks. Give one verdict: ready to merge, waiting for required human approval, or blocked. Verify that human approval is the only remaining requirement before using that verdict. If someone else merged or closed it, report the actual state.

Ask for a decision when the goal is materially ambiguous, proof or readiness cannot be established, or an action exceeds the task's authority. Use the environment's question tool when available; keep required answers pending. Production changes, data deletion and closing an obsolete PR require separate authorization.

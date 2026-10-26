---
name: sol-loop
description: Run a bounded Sol code-review loop when the user requests sol loop or a delivery workflow requires it.
---

# Sol Loop

Use OpenAI's GPT Sol to review the scoped change, with one reviewer at a time. Choose the latest available Sol unless the user names a version. Report a blocker if no route can run Sol; do not substitute another model. Substitute this skill's absolute directory for `<skill-root>`.

## Budget

Use three rounds total by default. Round one covers the full scoped diff; later rounds cover changed code and open findings. Extend to five only for security, permissions, auth, data loss, or state/concurrency while a blocker or should stays open with evidence, or when the user requests it. Stop early for nits alone. Declined nits and comment, documentation or format-only fixes need no new round. Track round count, stable finding IDs, severity, evidence, disposition and usage if returned across resumes. Never guess usage. This budget is separate from $babysit-pr's PR-bot budget.

## Workflow

1. **Fix the scope.** Read project instructions and run `git status --short`. Preserve unrelated changes; do not stash, discard or include them. Limit review to the change paths when they separate cleanly; otherwise ask. Resolve the base using the commands below. State intent and exclusions in 1-2 sentences. Review base to working tree in those paths, including intended untracked files. Record one diff command and use it in every round with the same base and scope. Run covering checks. Fix failures introduced by this change before dispatch; disclose inherited failures and unavailable checks.
2. **Dispatch one reviewer.** Follow [reviewer routing](references/reviewer-routing.md) for T3 Code or the native Sol route. Use the brief in [reviewer-brief.md](references/reviewer-brief.md), including the repo, base SHA, paths, intent, exclusions, checks, exact diff command and untracked files. Give the reviewer read-only scope and no further delegation or watchers. Keep scoped files stable while it runs. Wait for its completion notice instead of polling or starting a second reviewer. An error, timeout or missing response is not approval. On failure, cancel, verify it stopped, and restart with the ledger.
3. **Assess findings.** Verify each against current code, callers, requirements and evidence. Prefer deleting or narrowing code over adding a lock, cache, helper or option. Fix real in-scope bugs with the smallest robust change and appropriate verification; add a focused regression test when meaningful behavior needs one. Dismiss invalid findings with evidence. Decline optional scope expansion or nits with a reason and record follow-ups. Judge severity by observable impact, including plausible edge cases with material consequences. Reviewer confidence or severity labels alone do not settle a finding. Update the ledger, re-run checks and `git diff --shortstat <base>`. If review grew the diff, cut unnecessary growth first. Do not agree merely to end the loop.
4. **Re-review changes.** Start a further round only when budget remains and behavior changed, a blocker or should remains open, or approval does not cover the current behavior diff. Use a fresh `delegate_task` in T3 or follow up the saved native reviewer ID. Supply the original brief, ledger, complete scoped diff and changes since the last round. Ask for changed code and open IDs only, with each old ID marked resolved or still open with a reason.
5. **Conclude.** Approval requires an APPROVE verdict covering the current behavior diff, no unresolved blocker or should, and no concern of your own. Documentation or formatting-only fixes need no further round. If a finding remains disputed after two replies, or budget ends first, show both positions and evidence in 2-3 lines each for the user to decide. Budget exhaustion is not approval.

## Base and diff

When `origin` exists, run `git fetch origin`, then resolve the base:

- **PR:** run `gh pr view <number> --json baseRefName,headRefOid`. Check out its branch only when the working tree is clean. Confirm `HEAD` is the PR head, or ahead only by this change. Use `git merge-base HEAD origin/<baseRefName>`.
- **Local branch:** use `git merge-base HEAD origin/<default-branch>` after identifying the repository's actual default branch.
- **No remote:** use a base named by the user, or `HEAD` when reviewing uncommitted changes only. Ask for a base when committed changes also need review.

Use `git diff <base> -- <paths>` and inspect intended untracked files reported by `git status --short`. Keep the same diff command in subsequent rounds.

## Ship and report

Do not push during the loop. Push after agreement only when the user or calling workflow authorized pushing, shipping or updating the PR. Commit only when authorized. Project instructions govern public attribution and review notes; this skill requires no model footer or PR blurb.

Report rounds, reviewer identity and effort when verified, evidence, fixed and declined findings with reasons, unresolved disputes, diff size before/after, and whether changes were pushed. Report observed usage or explicitly state that usage was unavailable.

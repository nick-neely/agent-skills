---
name: sol-loop
description: Run a bounded independent code-review loop when the user requests sol loop or a delivery workflow requires it.
---

# Sol Loop

Review changes with one independent reviewer at a time. Select its model, harness and delegation route from project instructions or the user's request; use the environment's native reviewer route when unspecified. Keep selection policy in project instructions. Report a missing required capability rather than silently substituting. Substitute this skill's absolute directory for `<skill-root>`.

## Budget

Use three rounds total by default. Round one covers the full scoped diff; later rounds cover changed code and open findings. Extend to five only for an evidenced blocker involving security, authorization, data loss or concurrency, or when the user requests it. Stop early for nits alone. Track round count, stable finding IDs, severity, evidence and disposition across resumes. This budget is separate from $babysit-pr's PR-bot budget.

## Workflow

1. **Fix the scope.** Read Git status and project instructions. Preserve unrelated changes. Fetch and identify the PR's actual base, or the local branch's intended base. Record the merge-base SHA and scoped paths. Include intended untracked files. Use the same base and scope in every round; record any deliberate change. Run covering checks and disclose inherited failures or unavailable checks. If the scope cannot be separated safely, ask.
2. **Dispatch one reviewer.** Use the brief in [reviewer-brief.md](references/reviewer-brief.md). Include the repo, base SHA, paths, intent, exclusions, checks and exact diff command. Save the review ID. Give the reviewer read-only scope and no further delegation. Keep scoped files stable while it runs. Wait through the environment's completion mechanism. An error, timeout or missing response is not approval; confirm a failed reviewer has stopped before replacing it.
3. **Assess findings.** Verify each against current code, callers, requirements and evidence. Fix real in-scope bugs with the smallest robust change and appropriate verification. Dismiss invalid findings with evidence. Decline optional scope expansion or nits with a reason and record follow-ups. Judge severity by observable impact, including plausible edge cases with material consequences. Reviewer confidence or severity labels alone do not settle a finding.
4. **Re-review changes.** Run affected checks and compare diff size with the previous round. Start a further round only when budget remains and behavior changed, a substantive finding remains open, or approval does not cover the current diff. Supply the original brief, ledger, complete scoped diff and changes since the last round. Ask for changed code and open IDs only.
5. **Conclude.** Approval requires review covering the current behavior diff, no unresolved substantive finding, and no concern of your own. Documentation or formatting-only fixes need no further round. If a finding remains disputed after two replies, or budget ends first, report both positions and evidence for the user to decide. Budget exhaustion is not approval.

Report rounds, evidence, fixed and declined findings, unresolved disputes, and diff size before/after. Report usage only when exposed. Commit or push only when authorized by the user or calling workflow. Project instructions govern any public attribution or review note.

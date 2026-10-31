---
name: babysit-pr
description: "Use when asked to babysit a PR or pull request, or to 'babysit this work' through PR checks and review feedback. Monitor CI, address review-bot findings, and complete a bounded handoff."
---

Apply this workflow to an existing PR. Carry it to passing CI and an accounted-for review-bot state. Keep fixes within its scope; merge or deploy only when explicitly authorized. Substitute this skill's absolute directory for `<skill-root>`.

## Budget

Use three routine PR-bot rounds unless the user specifies otherwise. A round is one assessment-and-response cycle for substantive bot feedback. Group findings from bots reviewing the same head, including late arrivals from that cycle; different bots or completion times do not consume separate rounds. Substantive feedback on follow-up behavior changes starts the next cycle. Count rounds across commits, bots, wakeups and resumed turns; pushes and repeated findings do not reset the budget. Planning, implementation, local self-review and delegated or adversarial reviews use separate budgets, including after the PR opens.

Stop early for nits or optional improvements alone. Beyond the routine budget, defer nonblocking findings. Extend to five total rounds only for concrete, high-impact security/privacy, permissions/auth, data-loss, core-workflow, state/concurrency or required-check problems, while scoped fixes make concrete progress. Record the reason for each extension. At the limit, hand off unresolved blockers instead of claiming readiness. The user may authorize a different budget.

## Workflow

1. Identify the PR, current head, actual base branch and repository requirements, including which reviews gate readiness. Read existing checks, reviews and unresolved threads before waiting. Maintain a ledger across resumes with rounds used, reviewed heads, stable finding IDs or thread URLs, observable impact, evidence, disposition and verification. Match repeated findings to their existing entry.

2. Monitor required checks and already-triggered gating reviews for the current head using [waiting](references/waiting.md). A watcher reports events; verify the readiness gate yourself. Diagnose failures from logs, distinguish regressions from infrastructure or inherited failures, and fix attributable failures without weakening checks. When GitHub Actions checks fail, use the $gh-fix-ci skill if available; otherwise inspect them with `gh`. Diagnose external checks with the relevant provider's tools. Verify and push scoped follow-up commits.

3. Assess each actionable bot finding against current code, callers, requirements and evidence. Carry unresolved findings across pushes; their age alone does not dismiss them. Judge severity by observable impact, including plausible edge cases with material consequences; the bot's confidence or severity badge alone does not settle a finding. Read repository review rules cited by the bot, including `.macroscope/check-run-agents/` when present. Use $leaving-pr-comments when posting replies, if available; project instructions govern attribution.
   - Valid in-scope bug: fix it within the budget, run appropriate verification, and reply with the commit and evidence. Prefer the smallest robust change; remove unnecessary scope growth before adding more code.
   - Invalid: explain the concrete reason it does not apply, with evidence.
   - Optional, out of scope or deferred: state the reason and remaining limitation in the thread and PR; record a focused follow-up for substantive deferred work. Distinguish deferral from implementation. A deferred blocker prevents readiness.

4. Handle thread closure according to the bot.
   - For Codex, resolve fixed or dismissed threads after replying and verifying the result.
   - For bots that self-resolve, allow one response cycle, then inspect the outcome. Resolve an accounted-for thread if it remains open without an outstanding objection.
   - Keep unresolved disputes open. After two evidence-based exchanges on the same dispute without new evidence or progress, show both positions and evidence to the user instead of repeating the argument.

5. Decide whether another review cycle is warranted within the budget. Request further review only when behavior changed, a substantive finding needs confirmation, or required review does not cover the current behavior diff. Focus requested follow-ups on changed code and open finding IDs, asking which are resolved or still open and why. Declined nits and comment, documentation or formatting-only fixes need no new review request unless repository policy requires it. Continue to account for already-triggered gating reviews. Escalate persistent blockers or expanding scope rather than spending every remaining round automatically.

6. Apply [the readiness and merge gate](references/readiness.md). Finish when current-head required checks and already-triggered gating reviews have completed, with findings fixed, dismissed or explicitly deferred. Repository policy determines required approvals; a review may finish with findings. Additional bot-review requests solely to obtain zero findings are outside the routine budget. Budget exhaustion is not approval.

Stop the watcher before handoff. Report the PR, verified head, CI result, rounds used and extension reasons, deferred issues, unresolved disputes and any pending or unavailable review. A blocked handoff is acceptable; describe the blocker without claiming completion.

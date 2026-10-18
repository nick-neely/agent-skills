---
name: babysit-pr
description: Babysit a pull request when asked to monitor CI and review bots, address findings, and follow through to a bounded handoff.
---

Carry the PR to passing CI and an accounted-for review state. Keep fixes within its scope; merge or deploy only when explicitly authorized.

## Workflow

1. Identify the PR, current head and repository requirements. Establish the review budget: two routine rounds unless the user specifies otherwise. A round addresses one batch of findings together. Track rounds across commits, bots, wakeups and resumed turns.

2. Monitor required checks and bot reviews for the current head. Prefer the host's PR watcher; otherwise use bounded status checks. Diagnose failures from logs, distinguish regressions from infrastructure or inherited failures, and fix attributable failures without weakening checks. When GitHub Actions checks fail, use the $gh-fix-ci skill if available; otherwise inspect them with `gh`. Diagnose external checks with the relevant provider's tools. Verify and push scoped follow-up commits.

3. Assess each actionable bot finding against current code, requirements and evidence.
   - Valid: fix it, run appropriate verification, and reply with the commit and evidence.
   - Invalid: explain the concrete reason it does not apply.
   - Deferred: record a focused follow-up and explain the remaining limitation in the thread and PR.

4. Handle thread closure according to the bot.
   - For Codex, resolve fixed or dismissed threads after replying and verifying the result.
   - For bots that self-resolve, allow one response cycle, then inspect the outcome. Resolve an accounted-for thread if it remains open without an outstanding objection.
   - Keep unresolved disputes open. Clearly distinguish deferral from implementation.

5. Enforce the budget. After two routine rounds, defer nonblocking findings. Continue only for concrete privacy/security problems, data loss, broken core workflows, or required-check regressions. Judge impact rather than the bot's severity badge. New commits and bot replies do not reset the budget. Escalate persistent blockers or expanding scope instead of silently extending the loop.

6. Finish when current-head required checks and already-triggered reviews have completed, with findings fixed, dismissed or explicitly deferred. A review may finish with findings. Additional review requests solely to obtain zero findings are outside the routine budget.

Stop the watcher before handoff. Report the PR, verified head, CI result, deferred issues and any pending or unavailable review. A blocked handoff is acceptable; describe the blocker without claiming completion.

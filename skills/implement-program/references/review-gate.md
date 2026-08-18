# Child pull request review gate

Open a child pull request as draft. Mark it ready after ticket-level local gates
and an independent Standards and Spec review pass.

The observation window begins at the later of the ready-for-review transition
and latest pushed commit. Required checks and observation run concurrently. The
default window is 120 seconds. Once checks are green and the window has elapsed,
query reviews, comments, and unresolved threads one final time. Do not wait for
an advisory bot to respond.

Inspect the deterministic gate facts with:

```sh
node "<skill-root>/scripts/pr-gate.mjs" --pr <number> --ready-at <iso> --expected-base <integration> --expected-base-sha <sha> --expected-head <ticket-branch> --findings-cleared --observation-seconds <seconds> --required-check <name>... --bots <comma-separated-logins>
```

Pass every required check name discovered from repository policy. Omit
`--required-check` only when the repository demonstrably has no required checks.
Pass `--findings-cleared` only after the orchestrator has validated and disposed
of every ordinary comment and review finding against primary sources.

Validate every finding against primary sources. A valid finding blocks the
child merge until the owning worker fixes it, reruns implicated local gates,
pushes a follow-up commit, replies beneath the original thread with verification,
and allows required checks and observation to run again.

Reply to an incorrect or inapplicable finding with concise evidence and resolve
the thread where the platform permits. Resolution without evidence is not a
disposition.

A configured bot's silence is advisory evidence, not a failure. Record which
bots responded. If a valid finding arrives after the child merges, create a
focused repair pull request against the integration branch and block final
qualification until it is resolved.

Merge eligibility requires a current integration parent, green required checks,
elapsed observation, no unresolved valid findings, documented dispositions, and
a clean integration forecast. Prefer squash merge unless repository policy
requires another method.

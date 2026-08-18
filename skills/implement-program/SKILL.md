---
name: implement-program
description: Deliver a parent specification and its dependency-linked tickets through isolated child pull requests into one integration branch, then qualify one human-controlled pull request to the default branch. Use for long-running, multi-ticket programs that need parallel agent work behind one final human merge gate.
compatibility: Requires Node.js, git, GitHub CLI, and sub-agent delegation with optional model and reasoning overrides.
disable-model-invocation: true
argument-hint: "<parent spec or ticket set> [--resume <run-id>]"
---

# Implement Program

Deliver `$ARGUMENTS` as an **integration train**: the orchestrator owns the
program while bounded workers build dependency-ready tickets in isolated lanes.
Child pull requests merge only into a dedicated integration branch. The final
integration pull request is the single human-controlled gate to the default
branch.

Replace `<skill-root>` with the directory containing this `SKILL.md`.

## 1. Establish control

Remain the orchestrator for the entire run, including after compaction. Do not
implement ticket code in this context. Delegate bounded implementation,
research, and independent review assignments using the resolved profiles from:

```sh
node "<skill-root>/scripts/config.mjs" --json
node "<skill-root>/scripts/preflight.mjs" --live --json
```

Use the current orchestrator model throughout. Prefer Luna at maximum reasoning
for every sub-agent role unless repository configuration escalates a role. Never
reduce a configured role merely to save usage. Read
[references/configuration.md](references/configuration.md) before dispatching.
Record each resolved worker profile in the ledger before spawning it.

Read the parent specification and every ticket in full. Require a finite ticket
set with explicit blocking edges. If the input is an unstructured large request,
stop and ask the user to supply a specification and tracer-bullet ticket graph.

This step is complete when the source, default-branch SHA, tracker graph,
repository instructions, merge policy, verification commands, agent capacity,
and approval-only actions are accounted for.

## 2. Create the train

Create a dedicated integration branch from the current remote default branch
and immediately open its pull request to the default branch as a draft. Record
the exact baseline SHA. Preserve a clearly delimited human-editable section in
the pull request body; update only the generated status section.

```sh
node "<skill-root>/scripts/train.mjs" init --branch <integration> --base <default> --title <title> --body-file <body.md>
```

Initialize an ignored run ledger under
`.scratch/implement-program/<run-id>/run.json`, then render its compact dashboard:

```sh
node "<skill-root>/scripts/ledger.mjs" init --plan <plan.json> --run-dir <run-dir>
node "<skill-root>/scripts/ledger.mjs" render --run-dir <run-dir>
```

Read [references/ledger.md](references/ledger.md). Treat live Git, tracker, pull
request, process, and resource state as ground truth; the ledger is durable
intent and observed state, not proof.

## 3. Schedule the frontier

Compute tickets whose blockers are integrated:

```sh
node "<skill-root>/scripts/frontier.mjs" --ledger <run-dir>/run.json --json
node "<skill-root>/scripts/concurrency.mjs" --ledger <run-dir>/run.json --capacity <available-subagent-slots> --json
```

Before parallel dispatch, obtain read-only reconnaissance for anticipated file
ownership, migrations, generated artifacts, mutable services, ports, database
namespaces, and browser profiles. Run at most the configured number of workers;
the default is three active sub-agents, subject to harness capacity. Serialize
unknown overlap, migrations without proven isolation, and shared mutable
resources. Read [references/parallel.md](references/parallel.md).

Create each selected lane and acquire its declared resources before dispatch:

```sh
node "<skill-root>/scripts/worktree.mjs" open --ticket <id> --branch <branch> --base <integration> --path <path>
node "<skill-root>/scripts/leases.mjs" acquire --run-dir <run-dir> --owner <id> --resource <kind:value>...
```

Prioritize review repairs, completed-work review, critical-path builds, other
frontier builds, then research. Continue independent lanes when one lane fails;
freeze its descendants. Stop the program only for an integration failure, a
program-wide design fault, exhausted frontier, or a material product decision.

## 4. Deliver each ticket

Give each implementation worker only its ticket, parent-spec pointer, resolved
blockers, repository instructions, assigned branch/worktree/resources, relevant
decisions, verification contract, and authority boundary. The worker implements,
tests, commits, pushes, and opens a draft child pull request against the
integration branch. It does not merge, select more work, or perform approval-only
actions.

Follow [references/implementation-lifecycle.md](references/implementation-lifecycle.md)
for every ticket. Dispatch a fresh reviewer to inspect the child diff against
its current integration parent along both Standards and Spec axes. Return valid
findings to the owning worker. The reviewer reports findings and never edits its
own review target.

Mark the child pull request ready only after local verification and independent
review are complete. Then follow
[references/review-gate.md](references/review-gate.md). Required checks gate the
merge; configured review bots are advisory. Prefer squash merge unless repository
policy requires another method.

After a child merges, run the fast integration gate, mark the ticket `integrated`,
release its resources, render the dashboard, and recompute the frontier. Keep its
issue open until the integration pull request ships. The orchestrator may squash
merge an eligible child into the integration branch; that authority never
extends to the umbrella pull request.

## 5. Reconcile continuously

On resume, after compaction, and before every dispatch batch, reconcile the
ledger with live state:

```sh
node "<skill-root>/scripts/ledger.mjs" reconcile --run-dir <run-dir>
```

Read [references/resume.md](references/resume.md). Resume the first incomplete
transition instead of replaying completed work. Preserve failed worktrees until
their state is understood. Cancellation stops agents and mutable services but
preserves branches, pull requests, worktrees, and the ledger until the user
authorizes cleanup.

## 6. Qualify the program

After every implementation ticket is integrated:

1. Reconcile the latest default branch at a controlled checkpoint.
2. Resolve conflicts in the orchestrator context and rerun implicated gates.
3. Run the full repository verification contract against the integration head.
4. Map every parent acceptance criterion to ticket, child pull request, commit,
   review disposition, and verification evidence.
5. Verify approval-only operations remain pending and explicitly identified.
6. Put issue-closing keywords for fully delivered tickets on the umbrella pull
   request, not on child pull requests.
7. Update the umbrella dashboard and make the integration pull request ready.

Verify the recorded qualification matrix before changing the umbrella pull
request from draft:

```sh
node "<skill-root>/scripts/qualification.mjs" --ledger <run-dir>/run.json --json
```

The program is complete when all in-scope tickets are integrated, the current
default branch is reconciled, final qualification passes, and the umbrella pull
request is ready for human review. Never merge that pull request or perform an
irreversible external action without explicit authorization.

# Run ledger

Store canonical state at `.scratch/implement-program/<run-id>/run.json` and
render `.scratch/implement-program/<run-id>/status.md`. Verify the directory is
ignored before recording transient paths or process information.

The ledger records run identity and baseline, integration branch and umbrella
pull request, resolved configuration, ticket transitions, assignments, leases,
child pull requests, checks, reviews, integration commits, approval-only actions,
and material events.

Initialize from a plan shaped like:

```json
{
  "runId": "spec-100",
  "repository": "owner/repo",
  "parentSpec": "#100",
  "defaultBranch": "main",
  "baselineSha": "0123456789abcdef",
  "integrationBranch": "program/spec-100",
  "umbrellaPr": null,
  "config": {},
  "approvalActions": [],
  "acceptanceCriteria": [
    { "id": "AC1", "text": "The complete program passes qualification", "evidence": [] }
  ],
  "tickets": [
    {
      "id": "101",
      "title": "Deliver the first slice",
      "blockers": [],
      "priority": 1,
      "anticipated": {
        "known": true,
        "paths": ["src/example"],
        "resources": ["port:4101"],
        "migration": false,
        "migrationIsolated": false
      }
    }
  ]
}
```

Use these ticket states:

```text
planned -> active -> review -> merge-eligible -> integrated -> qualified -> shipped
```

`blocked` and `failed` retain the previous transition and reason. Only
`integrated`, `qualified`, and `shipped` satisfy a downstream blocker.

The rendered dashboard must show counts, frontier, active workers, failures,
next transition, and a compact table:

| Ticket | Blockers | State | Branch | Worktree | Agent | Resources | PR | Checks | Reviews | Integrated |
|---|---|---|---|---|---|---|---|---|---|---|

Place that generated block beside a human-owned block in the umbrella body:

```markdown
<!-- implement-program:human:start -->
Human notes remain untouched here.
<!-- implement-program:human:end -->

<!-- implement-program:generated:start -->
Generated dashboard content.
<!-- implement-program:generated:end -->
```

Live artifacts outrank the ledger. Reconcile recorded branches, worktrees,
processes, leases, issue state, pull request heads and bases, checks, reviews,
and integration commits before trusting an interrupted transition.

Record parent-level evidence without hand-editing the ledger:

```sh
node "<skill-root>/scripts/ledger.mjs" evidence --run-dir <run-dir> --criterion <id> --ticket <id> --pr <url> --commit <sha> --review <reference> --verification <reference>
```

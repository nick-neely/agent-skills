# Waiting

Use one watcher per PR, owned by the task making the changes. A delegated reviewer returns findings to that owner instead of starting a watcher. Handle existing checks, reviews and unresolved threads before waiting.

## T3 Code

When `watch_pull_request` is available, use it instead of the script. Handle actionable events, register the watch, then end the turn so T3 can wake the task. A wake is an event, not evidence that the PR is ready.

Call `unwatch_pull_request` before a final handoff or a question that needs the user. A watched task can remain outside the user's inbox. Merge or close ends the watch automatically.

If the watcher stops because it cannot read the PR, inspect the GraphQL quota once:

```sh
gh api rate_limit --jq '.resources.graphql | {remaining,reset}'
```

If exhausted, schedule one wait until the reported reset; resume the same watcher afterwards. Repeatedly registering a failed watch spends the same shared quota.

## Other environments

Use the bundled event waiter with Node and authenticated `gh`. Substitute this skill's absolute directory for `<skill-root>`:

```sh
node "<skill-root>/scripts/pr-wait.mjs" <pr-url>
```

Or supply `<number> --repo owner/name`; `GH_HOST` selects an enterprise host. Defaults: 60 seconds between snapshots, a 10-minute bound. `--interval` and `--timeout` accept seconds, with a minimum interval of 30 seconds.

Use a native monitor/background command and consume its completion through the harness's wait tool. Keep the user informed during extended work according to the active environment's communication rules. When the waiter exits, read its JSON event:

| Exit | Meaning | Next action |
| --- | --- | --- |
| 0 | Initial snapshot or a change in head, base, checks, reviews or comments | Inspect the affected state and apply the readiness gate |
| 1 | Time bound reached without a change | Continue waiting if work remains |
| 2 | Invalid input, failed API read or unavailable dependency | Fix the reported cause before retrying |
| 3 | Another process holds this PR's lock | Reuse its output; inspect the recorded PID before removing a stale lock |

Restart the same command after handling an event, pushing, or resuming. It saves the last snapshot under `XDG_STATE_HOME/pr-wait` or the home directory's `.local/state/pr-wait`. These files are runtime state, outside the skill. Its lock prevents duplicate script watchers on this machine. Stop your running command before handing off.

The waiter uses paginated REST reads and reports observations only. It does not determine required checks, unresolved thread state, reviewer policy or merge readiness. Fetch those explicitly for the gate. A green check or a quiet poll is not a completed review.

## Rate limits and unavailable reads

All watchers using an account share its quota. Inspect `gh api rate_limit` after a rate-limit error; wait until the affected resource's reset or the server's retry deadline. Secondary limits can require waiting even when the primary quota has room. Restart once after the wait, not in a tight retry loop.

`gh pr view` and `gh pr checks` use GraphQL. REST has a separate quota and can supply observations while GraphQL is exhausted:

```sh
gh api repos/<owner>/<repo>/pulls/<number>
gh api --paginate repos/<owner>/<repo>/commits/<head>/check-runs
gh api --paginate repos/<owner>/<repo>/commits/<head>/statuses
```

REST checks alone do not establish all review requirements. If required policy or unresolved threads cannot be read, report that gap and withhold a ready verdict.

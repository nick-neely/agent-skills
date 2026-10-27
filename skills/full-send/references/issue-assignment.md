# Issue assignment

Before implementing a GitHub issue, add the authenticated GitHub user as an
assignee so the issue shows who is working on it. Apply this only to issues
selected for implementation by the request, not every related issue mentioned
in their bodies. Skip this step for a spec-only task with no selected GitHub
issue. Both full-send and full-stop requests authorize this assignment.

1. Resolve each issue's canonical repository, host and number from the request
   and repository context. Use the issue's repository even when it differs from
   the code checkout. Read the target and current assignees with an explicit repo:

   ```sh
   gh issue view <number> --repo <host>/<owner>/<repo> --json number,url,state,assignees
   gh api --hostname <host> user --jq .login
   ```

   Use the same GitHub host and authenticated account for identity, assignment
   and verification. Resolve an ambiguous target before writing. Keep the
   returned login for the readback check; do not hardcode a personal username.

2. If that login is already an assignee, keep the assignment and skip the write.
   Otherwise add it without replacing or removing existing assignees:

   ```sh
   gh issue edit <number> --repo <host>/<owner>/<repo> --add-assignee '@me'
   ```

3. Read the assignees again from the same target:

   ```sh
   gh issue view <number> --repo <host>/<owner>/<repo> --json url,assignees
   ```

   Confirm the saved assignee list contains the authenticated login, comparing
   logins without regard to case. An edit command's exit status alone is not
   confirmation. Record the issue URL, assignee and whether assignment was
   added, already present or unconfirmed in task progress and the final report.

If assignment or readback fails, report the exact target, failure and required
action. Continue independent, otherwise authorized work, and report assignment
as unconfirmed until verified. On a retry or resume, read current assignees
before repeating the write. Leave the assignment in place at handoff or
completion unless the user requests a change.

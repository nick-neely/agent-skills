---
name: file-pr
description: File or update a pull request when asked to open or create a PR, or when a delivery workflow reaches PR submission.
---

# File PR

1. **Identify the branch and PR.** Read repository instructions, Git status, the branch's remote and intended base. Preserve unrelated changes. Check for an existing open PR for this head and base, including fork ownership. Update the matching PR rather than creating a duplicate. Resolve ambiguous matches before writing.

2. **Review the final diff.** Fetch the base and review the complete branch diff against its merge-base, plus intended uncommitted changes and untracked files. Confirm every change serves the user's goal. Run required verification and account for inherited failures. Stage only intended paths, commit and push when authorized. Re-read the pushed diff so the description covers what reviewers will receive.

3. **Write the title and body.** Follow repository title conventions, using recent merged PRs and Git history as examples. Lead the title with the outcome or problem resolved. Use the $pr skill as the single source for the body format; read it now. If unavailable, report the missing dependency instead of inventing a second template. Follow project instructions when they override that format. Use domain language from the repository glossary and claim only observed evidence.

   Prefer `perf(server): reduce websocket payload size` to `perf(server): negotiate permessage-deflate`. Add a number only when measured. A brief problem/solution sentence can introduce the Summary visual: "New threads ignored the configured worktree preference. Now each entry point uses that preference." Keep detailed implementation lists only when they help review.

4. **Submit and read back.** Check the title, body, quotes and attachments for secrets or private context. Follow repository draft policy; otherwise open ready for review when verification is complete. Pass multiline Markdown through a body file or structured argument. Verify the saved title, body, base and head and return the PR URL. Attach it to the current task when the environment supports PR attachments.

   If `gh pr create` is blocked by GraphQL exhaustion, check for an existing PR again through REST before retrying creation:

   ```sh
   gh api --paginate 'repos/<owner>/<repo>/pulls?state=open&head=<head-owner>:<branch>&base=<base>'
   gh api repos/<owner>/<repo>/pulls -f title='<title>' -f head='<head-owner>:<branch>' -f base='<base>' -F body=@<body-file>
   ```

   URL-encode query values, including branch names. Respect the server's reset or retry deadline when REST is also limited. A timed-out submission may already have succeeded; read before retrying.

5. **Continue the requested workflow.** Use $babysit-pr when monitoring is requested or the calling workflow requires it. Use $leaving-pr-comments for a needed follow-up comment. Follow repository instructions for attribution; this skill adds no model or harness footer.

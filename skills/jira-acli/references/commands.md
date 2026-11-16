# Command usage

Use current subcommand `--help` for flag discovery. These conventions avoid
interactive prompts and excessive output:

| Task | Invocation |
| --- | --- |
| One item | `acli jira workitem view PROJ-123` |
| Nested fields or formatting | `acli jira workitem view PROJ-123 --fields "summary,status,parent,comment,issuelinks,subtasks" --json` |
| Search | `acli jira workitem search --jql "..." --fields "key,status,priority,summary" --csv --limit 25` |
| Comments | `acli jira workitem comment list --key PROJ-123 --json` |
| Add comment | `acli jira workitem comment create --key PROJ-123 --body-file comment.adf.json --json` |
| Transition | `acli jira workitem transition --key PROJ-123 --status "In Review" -y` |
| Edit summary | `acli jira workitem edit --key PROJ-123 --summary "..." -y` |

`view` takes a positional key; updates use `--key`. Comment creation is
`comment create`, not `comment add`. Work-item `create --json` returns `.key`.
Use `--csv` and selected fields for search results: unrestricted JSON includes
large amounts of unrelated REST metadata. Preserve complete JSON for backups.

Use `-y` for `edit`, `transition`, `assign`, `delete`, and `archive`, and `--yes`
for link writes. Work-item `create` and `comment create` have no confirmation
flag in the last checked ACLI (1.3.40-stable, 2026-11-16).

Take the target status from the user or board. The checked ACLI has no command
to list an item's transitions; if the transition is rejected, report the CLI
error and read back before any retry.

Branch convention: `PROJ-123/short-description`, uppercase key and lowercase
hyphenated slug, unless repository instructions specify another convention.
If Git reports `cannot lock ref`, inspect for an existing bare `PROJ-123`
branch: Git cannot store both that ref and its slash-prefixed children.

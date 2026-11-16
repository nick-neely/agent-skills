---
name: jira-acli
description: 'Jira tickets via ACLI, including keys such as PRT-123 or PROJ-123 (any project prefix). Use for "read this ticket", "plan from this Jira issue", "what should I work on next" in Jira, or requests to create or edit Jira items, comment, change status, or link tickets.'
compatibility: Requires authenticated Atlassian ACLI (acli); bundled helpers require Python 3, with no extra packages.
---

# Jira with ACLI

Use `acli jira workitem`. Substitute this skill's directory for `<skill-root>`.
Read before writing. Jira mutations require user intent for that operation;
authorization already given in the session carries through. Completing code
does not imply a Jira comment or status transition.

## Read and plan

1. Run `acli jira auth status`. If ACLI is missing or authentication fails,
   report the blocker; authentication uses `acli jira auth login`.
2. Read the named item with `acli jira workitem view PROJ-123`. Extract the goal,
   acceptance criteria, technical notes, dependencies, and unresolved ambiguity.
   Read comments, parent, links, or subtasks with scoped `--fields ... --json`:
   plain-text view silently drops these fields and can join ADF headings onto
   the previous line. Use JSON to assess description formatting.
3. Before comparing Jira claims with code or merge state, run `git fetch origin`
   and inspect `origin/<default-branch>`. Resolve the default branch from the
   remote; a local checkout or a failed fetch cannot establish current state.
4. Inspect the relevant repository areas and plan the requested work.

For "what should I work on next", search the current user's unfinished items:

```bash
acli jira workitem search \
  --jql "assignee = currentUser() AND statusCategory != Done ORDER BY priority DESC, updated DESC" \
  --fields "key,status,priority,summary" --csv --limit 25
```

Rank by priority, scope clarity, blockers, and activity. Resolve the choice with
the user when several items are plausible.

## Write and verify

Read [writing](references/writing.md) before description replacements, comments,
bulk edits, or other item mutations. Read [links](references/links.md) before
creating, repairing, or deleting relationships. Use the bundled helpers for
conversion, backups, description replacement, and link writes:

```bash
python3 -I <skill-root>/scripts/md_to_adf.py description.md description.adf.json
python3 -I <skill-root>/scripts/jira.py backup PROJ-123
python3 -I <skill-root>/scripts/jira.py description PROJ-123 description.adf.json
python3 -I <skill-root>/scripts/jira.py link PROJ-123 Blocks PROJ-456
python3 -I <skill-root>/scripts/jira.py unlink PROJ-123 PROJ-456 LINK_ID
```

`backup` reads Jira and saves a private local snapshot. `description`, `link`,
and `unlink` only read and show a plan unless `--apply` is supplied. Add it when
the requested mutation is authorized; it is an execution switch, not approval.
Description writes back up the current item before replacing it and compare
the returned ADF with the replacement. Link writes verify both endpoints and
skip existing correct links. Any nonzero exit stops a batch, including exit 2
for a repaired change in ACLI flag behavior. Report the readback and remaining
uncertainty.

For other commands, read [command usage](references/commands.md) for headless
output, confirmations, creation, comments, transitions, and branch names.

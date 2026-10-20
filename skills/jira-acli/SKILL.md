---
name: jira-acli
description: Work with Jira work items through Atlassian ACLI (`acli`). Use when the user names a Jira key (PROJ-123), asks what to work on next, wants a ticket read or planned from, or asks to update Jira.
compatibility: Requires Atlassian ACLI (`acli`) authenticated to the target Jira site.
---

# Jira with ACLI

`acli jira workitem` is the interface. Read before you write; change Jira only on explicit request.

## Run it headless

`acli` renders for a human at a terminal - ANSI tables, confirmation prompts, ADF blobs. Every invocation has to be forced headless, or it hangs or floods the context.

- **Lists -> `--csv` with `--fields`.** A bare `search` prints a box-drawing table wrapped to terminal width. `--json` returns the raw REST payload - avatar URLs, `self` links, schema - at ~15x the bytes of the same rows as CSV.
- **One item, plain read -> `view KEY`** with no format flag. It flattens the ADF description to readable text (~340 bytes, against ~3.7 KB for `--json`).
- **Nested data -> `--json` with `--fields`.** Comments, parent, links, and subtasks exist only in JSON output. The text renderer knows a fixed set (key, type, summary, status, assignee, description) and **silently drops** anything else you ask for: `view KEY --fields comment` prints no comments and no error.
- **Writes -> command-specific confirmation.** Use `-y` for `edit`, `transition`, `assign`, `delete`, and `archive`; use `--yes` for `link create` and `link delete`. Work-item `create` has no confirmation flag in ACLI 1.3.39. Check the subcommand help when unsure.

## Command map

`view` takes a positional key; item updates use `-k/--key`. Work-item `create` and `link` commands use their own flags.

```bash
acli jira auth status                        # site + account, or why reads are failing
acli jira workitem view PROJ-123
acli jira workitem view PROJ-123 --fields "summary,status,parent,comment,issuelinks,subtasks" --json
acli jira workitem search --jql "..." --fields "key,status,priority,summary" --csv --limit 25
acli jira workitem comment list   --key PROJ-123 --json    # list / create - there is no `add`
acli jira workitem comment create --key PROJ-123 --body "..."
acli jira workitem transition --key PROJ-123 --status "In Review" -y
acli jira workitem edit       --key PROJ-123 --summary "..." -y
```

No command lists a work item's available transitions, so `--status` is unverifiable up front. Take the target status from the user or the board, and if the CLI rejects it, report its error verbatim.

If `acli` is missing or unauthenticated (`acli auth login`), say which - never fill in ticket contents from the key alone.

## Workflows

### Read a key

`view` it, then extract goal, acceptance criteria, technical notes, dependencies, and open ambiguity. Reach for `--fields ... --json` when comments, parent, or links carry part of the story. Inspect the repo areas involved and propose a plan before writing code.

### Choose work

```bash
acli jira workitem search \
  --jql "assignee = currentUser() AND statusCategory != Done ORDER BY priority DESC, updated DESC" \
  --fields "key,status,priority,summary" --csv --limit 25
```

Rank by priority, scope clarity, blockers, and recent activity. Ask the user to choose when more than one is plausible.

### Update Jira

Read the item first unless this session already did. `create`, `edit`, `transition`, `delete`, `comment`, link writes, and bulk or assignee changes need explicit user intent - when intent is ambiguous, inspect and plan only. Finishing code never implies a transition. Keep comments factual: what changed, how it was validated, any caveat.

For rich descriptions, pass an ADF JSON document (`{"type":"doc","version":1,"content":[...]}`) through `--description-file`. Convert bullets, bold, code, and links to ADF nodes/marks; plain Markdown is stored as text rather than rendered. Work-item `create --json` returns the new key in `.key`.

Before bulk edits, save each affected item's current state with `view KEY --fields "summary,description,issuelinks" --json` to a local backup file.

Branch names: `PROJ-123/short-description` - uppercase key, lowercase hyphenated slug. Git refuses a slashed branch when a bare `PROJ-123` branch already exists, and vice versa; a `cannot lock ref` error means exactly that, so check for the bare branch rather than retrying.

### Create and delete links

Write down the intended relationship as a sentence, such as "PROJ-123 blocks PROJ-456", and read both items' `issuelinks` before writing. Skip an already-correct relationship.

**Direction gotcha:** on ACLI `1.3.39-stable`, "A blocks B" required `--out B --in A --type Blocks`. This was observed despite the help labels and a success message claiming the opposite direction. Check `acli --version`; other versions may behave differently. Use `acli jira workitem link type` to discover available types; the example below covers `Blocks`.

```bash
# Intended: PROJ-123 blocks PROJ-456
acli jira workitem link create --out PROJ-456 --in PROJ-123 --type Blocks --yes
acli jira workitem view PROJ-123 --fields issuelinks --json
acli jira workitem view PROJ-456 --fields issuelinks --json
```

**Verify every link write immediately**, including each link in a batch, by rereading both endpoints with `--fields issuelinks --json`. Interpret each `fields.issuelinks[]` entry from the viewed item's perspective:

| Linked issue field | Relationship text |
| --- | --- |
| `outwardIssue.key` | `type.outward` (for Blocks: "blocks") |
| `inwardIssue.key` | `type.inward` (for Blocks: "is blocked by") |

For the example, PROJ-123 must have an `outwardIssue.key` of PROJ-456 with `type.outward` equal to "blocks"; PROJ-456 must show the inverse. The success message alone never proves direction. If the observed relationship differs or cannot be verified, stop the batch and report the intended relationship, actual result, and link ID before further writes.

For an authorized deletion, take the exact link ID from `fields.issuelinks[].id`, run `acli jira workitem link delete --id LINK_ID --yes`, then reread both endpoints and confirm that link ID is absent.

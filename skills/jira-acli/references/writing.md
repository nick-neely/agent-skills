# Write item content

```bash
python3 -I <skill-root>/scripts/md_to_adf.py description.md description.adf.json
python3 -I <skill-root>/scripts/jira.py description PROJ-123 description.adf.json
python3 -I <skill-root>/scripts/jira.py description PROJ-123 description.adf.json --apply
```

These commands convert locally, read the current item to plan a replacement,
then back up, replace, and read back the description. Supply `--apply` only for
an authorized edit. **`edit --description-file` replaces the whole description.**
Preserve existing material outside the requested change in the replacement.

## Markdown conversion

Use the bundled converter instead of writing another converter or passing raw
Markdown to ACLI, which stores it as text. It needs only Python 3 and supports:

| Input | ADF |
| --- | --- |
| `#` through `######` headings | `heading`, levels 1 through 6 |
| Blank-separated paragraphs | `paragraph`; wrapped lines join with spaces |
| Flat `-` or `*` bullets | `bulletList` containing `listItem` paragraphs |
| Flat `1.` or `1)` lists | `orderedList`, preserving the starting number |
| Single backtick code, `**bold**` | `code` and `strong` marks |
| `[label](https://example.com)` | `link` mark; absolute HTTP(S) and mailto URLs |
| Backtick or tilde fences, optional language | `codeBlock`, preserving literal contents |
| Backslash-escaped punctuation | Literal punctuation |

Input is UTF-8. `-` selects stdin or stdout; the output defaults to stdout.
An existing destination is refused. Indented/nested blocks, tables, blockquotes,
images, HTML, and horizontal rules are outside this subset. Detected unsupported
blocks and unclosed fences fail before writing output. Other inline syntax
stays literal. Review the output; use hand-authored ADF for richer structures.
See Atlassian's [ADF structure](https://developer.atlassian.com/cloud/jira/platform/apis/document/structure/)
and [code-mark combinations](https://developer.atlassian.com/cloud/jira/platform/apis/document/marks/code/)
when extending the converter.

## Backups and replacement

`jira.py description` saves `summary,description,issuelinks` before its write.
The durable default is `~/.jira-acli/backups/KEY-<UTC timestamp>-<unique>.json`;
use `--backup-dir PATH` for an operator-selected location. The directory is
created private and snapshots use mode 0600 on POSIX. These files contain Jira
content: keep them outside repositories and installed skills. They are retained
until the operator explicitly removes them.

For a direct `acli edit --description*` or a bulk edit, run this for every
affected key first and retain the returned paths:

```bash
python3 -I <skill-root>/scripts/jira.py backup PROJ-123
```

Backup failure blocks the write. The description helper emits the backup path
before calling ACLI. A failed command or readback requires inspecting the saved
snapshot and current JSON before retrying. Exact ADF comparison is conservative:
server normalization can require manual inspection. The helper checks the ADF
root, not the complete schema; use converter output or reviewed valid ADF.
Backups are recovery evidence, not a lock against concurrent Jira edits.

To restore an authorized description, extract `fields.description` from the
chosen snapshot into a new ADF file, review it against the live item, and use
the same description helper. Restoring a snapshot's other fields or links is a
separate requested operation.

## Other writes

Keep comments factual: what changed, how it was validated, and any caveat.
For formatted comments, convert Markdown with the same converter and pass the
result through `comment create --body-file ... --json`. Read back the saved
comment and capture its ID. Check recent comments before retrying an uncertain
submission to avoid duplicates. For a new item, capture `.key` from
`create --json` and read that item back. For transitions, summary edits, or
assignments, read back the affected fields. A success message alone is not
verification.

# Publishing

```bash
node "<skill-root>/scripts/publish.mjs" --repo owner/project \
  --target pr:123 --section /absolute/evidence/section.md --dry-run
```

This validates local media and the named GitHub target without uploading or
editing it. Remove `--dry-run` to upload the reviewed assets and replace the
managed evidence section. Publishing requires the authorization described in
`SKILL.md`; the dry run does not create that authorization.

| Option | Meaning |
| --- | --- |
| `--repo owner/name` | Required; never inferred from the working directory |
| `--target pr:N` or `issue:N` | Required destination in that repository |
| `--section path` | Markdown section, without managed markers |
| `--mode body` or `comment` | Replace the description block or manage one comment; default `body` |
| `--image-root path` | Asset directory, defaulting to the section's directory; applies to video too |
| `--max-video-bytes N` | Explicit exclusive video byte ceiling, at most 100,000,000; raising it asserts paid-plan eligibility |
| `--dry-run` | Read-only validation and a plan including the selected upload transport |

Use absolute paths for the section and a unique evidence directory outside the
source checkout. Relative media paths resolve under the asset root. Missing
files, unsupported media, and paths escaping that root, including symlinks, are
refused. Code examples are not treated as upload references. Use inline Markdown
images or quoted HTML `img` sources; reference definitions are not supported.

## Choose a readable layout

A screenshot needs descriptive alt text:

```markdown
![Saved filter is visible after reloading](after.png)
```

A video needs a standalone empty-alt image reference, separated from adjacent
prose by blank lines. The publisher replaces it with a hosted video URL:

```markdown
Selecting Yearly updates the summary; dropping the card confirms the move.

![](interaction.mp4)
```

Video alt text is not supported. Keep the action and result in nearby prose;
avoid autoplay-dependent explanations. Stack before/after videos with labels
so the reviewer can control each player. Use an after-only clip when sufficient.

For static before/after, a Markdown table can use native uploads:

```markdown
| Before | After |
| --- | --- |
| ![Before](before.png) | ![After](after.png) |
```

Existing HTML tables remain supported through the narrower direct attachment
transport. Keep secondary screenshots in `details` blocks when useful:

```html
<details><summary>Additional states</summary>

![Dark mode](dark.png)

</details>
```

Budgets are soft: prefer six assets and two clips or fewer, while preserving
the user's named coverage. Explain any omitted state. Do not reference raw
footage, local previews, or contact sheets in the published section.

## Upload behavior

Use authenticated gh 2.99.0+ with repository push access. The publisher prefers
the supported `--attach` interface for body updates and new comments with
Markdown media. It stages hash-only filenames, preserving the original files.
No local basename or absolute path is used as the hosted asset name.

For an existing managed comment, update that exact comment ID. Native
`gh pr comment --edit-last` could select an unrelated newer comment, so this
case retains the direct attachment endpoint and an ID-specific API update.
Local HTML images also select that transport, since the native CLI's documented
rewrite contract covers Markdown. The direct endpoint remains undocumented;
failures are reported without creating a release or trying another publication
destination. The dry-run/result identifies the transport.

The default exclusive byte ceiling is 9,500,000 for images and video, leaving
headroom under GitHub's decimal 10 MB attachment limit. GitHub allows videos up
to 100 MB in paid-plan repositories, subject to uploader eligibility. Verify
that eligibility before raising `--max-video-bytes`; images retain the default
ceiling. MP4/H.264 is the default preparation path for browser compatibility.

## Managed updates and readback

The publisher owns only the block between:

```html
<!-- ui-evidence:start -->

<!-- ui-evidence:end -->
```

Re-running replaces that block and preserves unrelated prose. Ambiguous or
malformed markers are refused. Comment mode locates the publishing user's
managed comment across all pages and refuses multiple matches instead of
guessing. Each run uploads local assets afresh; remote references are preserved.

The publisher reads back the saved body or exact comment and verifies the
expected text and hosted references. Successful JSON reports
`readback.verified: true` and the hosted URLs. To inspect independently:

```bash
gh pr view 123 --repo owner/project --json body --jq .body
gh api repos/owner/project/issues/comments/<comment-id> --jq .body
```

Readback proves saved references, not browser rendering. A new video publication
path should be qualified through actual playback when practical. Routine
publication does not require signing into a browser.

Body edits are read-modify-write. Concurrent edits can still race; avoid
publishing while someone edits that description. Authentication or authorization
errors are not permission to switch repositories or hosting destinations.

## Failure recovery

The native CLI can upload some files, update the body, and then exit nonzero.
The publisher still attempts readback and reports whether the saved target
changed, which hosted references exist, and which references remain unresolved.
Treat nonzero as incomplete even if some assets appear. Inspect the returned
state before retrying; the publisher does not blindly retry uploads or append
duplicate evidence.

An upload failure can leave an unused hosted attachment. It does not trigger
release creation or cleanup of earlier assets. A failed direct upload leaves the
target untouched unless its write had already been attempted; readback reports
the observed outcome. Refresh the affected evidence after relevant follow-up UI
commits and replace the managed block.

Primary references: [GitHub CLI attachments](https://docs.github.com/en/github-cli/github-cli/attaching-files-with-github-cli),
[formats and limits](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/attaching-files),
[partial native upload behavior](https://cli.github.com/manual/gh_pr_edit).

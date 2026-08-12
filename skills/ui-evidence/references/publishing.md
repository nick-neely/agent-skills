# Publishing

```bash
node "<skill-root>/scripts/publish.mjs" --target <pr:N|issue:N> --section <file.md> [options]
```

| Option | Meaning |
| --- | --- |
| `--repo <owner/name>` | Defaults to the current repository |
| `--mode body\|comment` | Edit the description, or manage a single comment; default `body` |
| `--image-root <path>` | Directory images must live under; defaults to the section file's directory |
| `--dry-run` | Resolve the repository and image references, upload nothing |

Referencing an image outside the image root is refused rather than uploaded, so
a section cannot reach arbitrary files on the machine. Widen it deliberately
with `--image-root` when images genuinely live elsewhere.

Editing a body is a read-modify-write, and the GitHub API does not support
conditional writes on `PATCH`. An edit made between the read and the write is
overwritten. In practice this means avoiding a publish while someone is editing
the same description by hand.

The script finds every local image the section references, in markdown
`![](path)` form and HTML `<img src="path">` form alike, uploads each one,
rewrites the reference to the hosted URL, and splices the result into the
target.

Run `--dry-run` first. It confirms the repository, the target, and that every
referenced image exists, before anything is uploaded.

## The managed block

Content is written between these markers:

```html
<!-- ui-evidence:start -->
<!-- ui-evidence:end -->
```

Re-running replaces what is between them. Anything the user wrote outside them
is preserved. When the markers are absent, the block is appended once.

In `comment` mode the script finds its own previous comment on that issue or
pull request and updates it, so repeated runs do not stack duplicates. Use
`comment` mode when the point is "here is what changed since your last review".
Use `body` mode, the default, when the point is "here is what this change looks
like".

## Layout

GitHub markdown has no native side-by-side, so pairs need an HTML table.

```html
<table>
<tr><th>Before</th><th>After</th></tr>
<tr>
<td><img src="before.png" width="480"></td>
<td><img src="after.png" width="480"></td>
</tr>
</table>
```

A single screenshot or GIF needs no table:

```markdown
![Empty state replaces the spinner](annotated.png)
```

Past three primary assets, collapse secondary evidence so the description stays readable:

```html
<details><summary>More states (3)</summary>

![Dark mode](dark.png)

</details>
```

Start with a soft budget of six visual assets and two GIFs. Exceed it only when
each additional asset proves a named claim. When you leave a scoped state out,
say so in the section. Silent truncation reads as complete coverage.

Use after-only motion by default. Put synchronized before/after GIFs with
matching dimensions in a table. Stack clips with different timing or geometry
so two unrelated loops do not compete side by side.

Give every GIF alt text that names the action and result. Nearby prose must
carry the same meaning for reviewers who disable animated-image autoplay. Add
a companion screenshot only when its static state is independently useful.

## Upload tiers

**Attachments.** `uploads.github.com/user-attachments/assets` with a bearer
token. Clean URLs, no repository pollution, works for private repositories.
This endpoint is undocumented and could change without notice.

**Release assets.** Used automatically when the attachment upload fails. Assets
are attached to a prerelease tagged `ui-evidence-assets`, created on
first use. Documented and stable, at the cost of a visible release in the
repository.

Filenames are prefixed with a content hash, so the same image uploaded twice
does not collide and a changed image gets a new URL.

Each run uploads afresh and GitHub mints a new asset URL, even for identical
bytes. Previously published images are left behind rather than reused. This
costs nothing and needs no cleanup, but it does mean the URLs in the section
change on every run.

An attachment from a private repository is not publicly readable: an
unauthenticated request returns `404`, including after the asset is referenced
in an issue. Do not treat that as a substitute for redaction in a public
repository.

## Troubleshooting

**`HTTP 401` or `HTTP 403` on upload.** The token lacks repository access. Check
`gh auth status`, and confirm the token's scopes cover the target repository.

**Images upload but do not render.** Confirm the section actually reached the
target by opening the page. Check that HTML `<img>` tags are not nested inside
a markdown code fence.

**`gh api` fails with `Not Found`.** Usually the wrong repository, or a pull
request number used with `issue:` or the reverse. Both live in the same number
space per repository, and the script picks a different endpoint for each.

**A release appears in the repository.** The attachment upload failed and the
fallback took over. The release is a prerelease and can be deleted once the
attachment path works again, but deleting it breaks images already published
through it.

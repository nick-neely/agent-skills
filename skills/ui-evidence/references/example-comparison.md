# Worked example: static before/after comparison

This example takes one static claim from a clean base checkout to a
publication dry run. The sample pull request renames the notification
settings **Save** button to **Save changes**, moves it before **Cancel**, and
adds a **New** badge to the weekly summary row.

Run the blocks in order in one shell; they work from any directory. Keep the
command sequence and replace the recipe, the comparison spec, and the sample
values with your own claims. [recipes.md](recipes.md),
[before-after.md](before-after.md), [comparisons.md](comparisons.md), and
[publishing.md](publishing.md) explain each step in depth.

## Runtime inputs

Set these before the first block:

| Variable | Value |
| --- | --- |
| `APP_DIR` | Absolute path of the checkout this pull request's app serves |
| `AFTER_URL` | URL where the app serves `APP_DIR`, ending in `/` |
| `AFTER_CHECK` | How you confirmed that server renders `APP_DIR`, such as its process working directory |
| `REPO` | GitHub repository of the pull request, `owner/name`; never inferred |
| `PR` | Pull request number |

## Output files

Everything is written under `$EVIDENCE_DIR`, outside the source checkout:

| File | Written by | Published |
| --- | --- | --- |
| `recipe.json`, `compare.json` | You, from this example | No |
| `baseline.json` | `before-capture.mjs create` | No |
| `notification-toolbar.after.png`, `notification-toolbar.before.png` | `capture.mjs` | No |
| `capture-after.json`, `capture-before.json` | `capture.mjs` results | No |
| `manifest.json` | `capture.mjs` and `manifest.mjs` | No |
| `regions.json` | `regions.mjs` | No |
| `compare/comparison.png`, `compare/detail-callout-1.png` | `compare.mjs` | Yes |
| `compare/section.md`, `compare/result.json` | `compare.mjs`; `manifest.mjs reference` appends to the section | Section only |
| `status.json`, `publish-plan.json`, `publish-result.json` | `manifest.mjs status` and `publish.mjs` | No |

## 1. Prepare the run

```bash
EVIDENCE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ui-evidence.XXXXXX")"
SESSION="$(basename "$EVIDENCE_DIR")"
node "<skill-root>/scripts/preflight.mjs"
node "<skill-root>/scripts/preflight.mjs" --compare
```

## 2. Write the recipe

The `ready` assertion is the state check. Capture fails unless the page shows
every claimed detail, so a wrong route, stale build, or unseeded fixture never
becomes evidence. The `before` version overrides only what differs.

```bash
cat > "$EVIDENCE_DIR/recipe.json" <<'JSON'
{
  "version": 1,
  "id": "notification-settings",
  "sources": { "ignore": ["**/*.md"] },
  "captures": [
    {
      "id": "notification-toolbar",
      "claims": ["Save reads Save changes and sits before Cancel", "Weekly summary shows a New badge"],
      "route": "settings.html",
      "viewport": { "width": 1280, "height": 800, "devicePixelRatio": 1 },
      "theme": "light",
      "fixture": "seed:notifications-v1",
      "inputs": ["settings.html"],
      "ready": "document.querySelector('[data-testid=save]').textContent.trim() === 'Save changes' && document.querySelector('[data-testid=save]').nextElementSibling.textContent.trim() === 'Cancel' && document.querySelector('.badge')?.textContent === 'New'",
      "versions": {
        "before": {
          "ready": "document.querySelector('[data-testid=save]').textContent.trim() === 'Save' && document.querySelector('.badge') === null"
        }
      }
    }
  ]
}
JSON
```

## 3. Check out and serve the base

`create` reads the branch the pull request targets and checks out its merge
base in a new temporary worktree. It runs inside the app's repository, so the
subshell changes directory only for that command.

```bash
(cd "$APP_DIR" && node "<skill-root>/scripts/before-capture.mjs" create --pr "$PR" --repo "$REPO") \
  > "$EVIDENCE_DIR/baseline.json"
BASELINE_DIR="$(node -p 'require(process.argv[1]).path' "$EVIDENCE_DIR/baseline.json")"
```

Serve `BASELINE_DIR` the way the app serves `APP_DIR`: install dependencies
and start its server on a second port, then confirm that server's working
directory. Set `BEFORE_URL` and `BEFORE_CHECK` like the after inputs. The
sample app is static files, so a file URL serves the checkout directly:

```bash
BEFORE_URL="$(node -p 'require("node:url").pathToFileURL(process.argv[1]).href + "/"' "$BASELINE_DIR")"
BEFORE_CHECK="opened as static files from the baseline checkout"
```

## 4. Capture both versions

Each version gets its own browser session. Each command prints its result,
saved here for review.

```bash
node "<skill-root>/scripts/capture.mjs" --recipe "$EVIDENCE_DIR/recipe.json" \
  --capture notification-toolbar --base-url "$AFTER_URL" --session "$SESSION-after" \
  --out-dir "$EVIDENCE_DIR" --manifest "$EVIDENCE_DIR/manifest.json" \
  --source "$APP_DIR" --served-check "$AFTER_CHECK" > "$EVIDENCE_DIR/capture-after.json"
node "<skill-root>/scripts/capture.mjs" --recipe "$EVIDENCE_DIR/recipe.json" \
  --capture notification-toolbar --version before --baseline "$EVIDENCE_DIR/baseline.json" \
  --base-url "$BEFORE_URL" --session "$SESSION-before" \
  --out-dir "$EVIDENCE_DIR" --manifest "$EVIDENCE_DIR/manifest.json" \
  --served-check "$BEFORE_CHECK" > "$EVIDENCE_DIR/capture-before.json"
```

Each result's `state` reports the observed route, viewport, pixel ratio, theme,
and scroll position; the two must match. Check `warnings` in both, then open
`notification-toolbar.before.png` and `notification-toolbar.after.png` and
confirm each shows the intended state.

## 5. Locate the changes and write the comparison spec

```bash
node "<skill-root>/scripts/regions.mjs" "$EVIDENCE_DIR/notification-toolbar.before.png" \
  "$EVIDENCE_DIR/notification-toolbar.after.png" --crops > "$EVIDENCE_DIR/regions.json"
```

`regions.json` lists changed areas in screenshot pixels. Use them, or selector
anchors captured with the screenshots (see comparisons.md), for each callout.
The rectangles below are the sample app's at 1280x800. Image paths resolve
relative to the spec, so the captures are referenced by name.

Each callout is pin-only, following comparisons.md's "Choose the annotation".
Callout 1 pairs the moved Save button across both panels, and callout 2 points
to a badge small enough to miss at PR width. Both changes are plainly visible
once found, so neither needs an outline or a label, and the button's width is
not the claim, so it carries no measurement.

```bash
cat > "$EVIDENCE_DIR/compare.json" <<'JSON'
{
  "title": "Notification settings toolbar",
  "before": { "image": "notification-toolbar.before.png", "label": "Before (base)" },
  "after": { "image": "notification-toolbar.after.png", "label": "After (this PR)" },
  "crop": [340, 0, 940, 300],
  "callouts": [
    {
      "id": 1,
      "text": "Save now reads Save changes and sits before Cancel.",
      "before": [1191, 10, 65, 35],
      "after": [1028, 10, 134, 35]
    },
    {
      "id": 2,
      "text": "Weekly summary gains a New badge.",
      "after": [499, 138, 37, 15]
    }
  ],
  "details": [{ "callout": 1 }]
}
JSON
```

## 6. Prepare the comparison

`compare.mjs` writes every asset and `section.md` in one run. Its stdout repeats
`result.json`.

```bash
node "<skill-root>/scripts/compare.mjs" --spec "$EVIDENCE_DIR/compare.json" \
  --out-dir "$EVIDENCE_DIR/compare" > /dev/null
```

## 7. Review the outputs locally

Open `compare/comparison.png` at original size and at about 880 pixels wide,
the PR body width, then `compare/detail-callout-1.png`. Check that each panel
shows its intended state, every pin sits beside its region, the badge and
button look exactly as the app draws them, and neighbouring controls stay
readable. Print the limitations to mention in the PR:

```bash
node -p 'require(process.argv[1]).limitations.join("\n") || "No limitations."' \
  "$EVIDENCE_DIR/compare/result.json"
```

In the sample, the After panel's Save pin sits in the margin, and its connector
crosses the toolbar on the way; the result reports that limitation.

## 8. Register the derived files and check freshness

```bash
node "<skill-root>/scripts/manifest.mjs" add --manifest "$EVIDENCE_DIR/manifest.json" \
  --result "$EVIDENCE_DIR/compare/result.json" --inputs "$EVIDENCE_DIR/compare.json" > /dev/null
node "<skill-root>/scripts/manifest.mjs" status --manifest "$EVIDENCE_DIR/manifest.json" \
  > "$EVIDENCE_DIR/status.json"
```

In `status.json`, both captures and both comparison images should be `fresh`.
Recapture anything `stale`, and resolve `review` as recipes.md describes,
before publishing.

## 9. Dry-run the publication

Append the compact capture reference as its own paragraph, then validate the
section, its media, and the named target without uploading:

```bash
node "<skill-root>/scripts/manifest.mjs" reference --manifest "$EVIDENCE_DIR/manifest.json" \
  >> "$EVIDENCE_DIR/compare/section.md"
node "<skill-root>/scripts/preflight.mjs" --publish
node "<skill-root>/scripts/publish.mjs" --repo "$REPO" --target "pr:$PR" \
  --section "$EVIDENCE_DIR/compare/section.md" --manifest "$EVIDENCE_DIR/manifest.json" \
  --dry-run > "$EVIDENCE_DIR/publish-plan.json"
```

`publish-plan.json` lists `comparison.png` and `detail-callout-1.png`, the only
media `section.md` references, each with its freshness. A `blocked` field
names stale evidence to refresh first.

## 10. Publish

Run this only with authorization to update the pull request, as `SKILL.md`
describes. It uploads the reviewed assets and replaces the managed evidence
block.

```bash
node "<skill-root>/scripts/publish.mjs" --repo "$REPO" --target "pr:$PR" \
  --section "$EVIDENCE_DIR/compare/section.md" --manifest "$EVIDENCE_DIR/manifest.json" \
  > "$EVIDENCE_DIR/publish-result.json"
```

Publication is complete only when `publish-result.json` reports
`readback.verified: true` with a hosted URL for each asset. On a nonzero exit,
inspect that result before retrying; see publishing.md.

## 11. Remove the baseline checkout

Stop any server you started from `BASELINE_DIR` first. Keep `$EVIDENCE_DIR`
until the pull request merges, so a follow-up commit can refresh only stale
evidence.

```bash
(cd "$APP_DIR" && node "<skill-root>/scripts/before-capture.mjs" remove --dir "$BASELINE_DIR" \
  --owner "$(node -p 'require(process.argv[1]).owner' "$EVIDENCE_DIR/baseline.json")")
```

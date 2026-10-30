# Capture recipes and freshness

Use a recipe when the same app state will be captured more than once: before
and after versions, a refresh after follow-up commits, or several related
screenshots. The recipe records how to reach each state once. The local
manifest records what each capture came from, so a later check can say which
evidence is still valid, which is stale, and which needs review.

```bash
node "<skill-root>/scripts/capture.mjs" --recipe "$EVIDENCE_DIR/recipe.json" \
  --capture pricing-yearly --base-url http://localhost:3000 \
  --session "$AGENT_BROWSER_SESSION" --out-dir "$EVIDENCE_DIR" \
  --manifest "$EVIDENCE_DIR/manifest.json" --source "$PWD" \
  --served-check "dev server pid 4242 runs in this checkout"
node "<skill-root>/scripts/manifest.mjs" status --manifest "$EVIDENCE_DIR/manifest.json"
```

Direct `agent-browser` screenshot and record commands remain the right tool for
a one-off capture. Starting servers, installing dependencies, authenticating,
and seeding fixtures stay with you and the app's own setup.

## Write the recipe

Keep the recipe with the evidence, outside the source checkout, unless the
project chooses to commit it. Rehearse the steps in your session first.

```json
{
  "version": 1,
  "id": "billing",
  "sources": {
    "shared": ["src/styles/**", "src/components/ui/**", "package.json"],
    "ignore": ["**/*.md", "**/*.test.ts", "docs/**"]
  },
  "captures": [
    {
      "id": "pricing-yearly",
      "claims": ["Selecting Yearly shows the yearly price"],
      "route": "/pricing",
      "viewport": { "width": 1280, "height": 800, "devicePixelRatio": 2 },
      "theme": "light",
      "scroll": { "x": 0, "y": 0 },
      "fixture": "seed:billing-v3",
      "inputs": ["src/pricing/**"],
      "steps": [["click", "label:has(#yearly)"]],
      "ready": "document.querySelector('#yearly').checked && document.querySelector('[data-testid=price]').textContent.includes('year')",
      "versions": {
        "before": {
          "steps": [["click", "#billing-annual"]],
          "ready": "document.querySelector('#billing-annual').checked"
        }
      }
    },
    {
      "id": "pricing-toggle",
      "kind": "recording",
      "claims": ["Choosing Yearly updates the price, and the choice survives a reload"],
      "route": "/pricing",
      "viewport": { "width": 1280, "height": 800, "devicePixelRatio": 1 },
      "theme": "light",
      "fixture": "seed:billing-v3",
      "inputs": ["src/pricing/**"],
      "ready": "document.querySelector('#monthly').checked",
      "record": { "fps": 30, "cursor": true },
      "actions": [
        ["wait", "600"],
        ["click", "label:has(#yearly)"],
        ["wait", "--fn", "document.querySelector('[data-testid=price]').textContent.includes('year')"],
        ["wait", "1000"],
        ["reload"],
        ["wait", "1200"]
      ],
      "expect": "document.querySelector('#yearly').checked"
    }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `id` | Stable capture ID; also names the asset (`<id>.<version>.png`) |
| `claims` | Visible claims the capture proves; not part of its identity |
| `kind` | `screenshot` (default) or `recording` |
| `route` | Relative URL resolved against `--base-url`; never an origin |
| `viewport` | CSS width and height plus `devicePixelRatio`, applied with `set viewport` |
| `theme` | `light` or `dark`, applied with `set media`; omit to leave it unset |
| `scroll` | Window scroll position checked before capture |
| `fixture` | Sanitized identifier of the data state, such as `seed:billing-v3`; change it when the data changes |
| `inputs` | Repository paths or globs that directly render this capture |
| `steps` | `agent-browser batch` arrays run after opening the route |
| `ready` | JavaScript that is true only in the intended visible state |
| `screenshot` | `{ "full": true }` for a full page or `{ "selector": "..." }` for one element |
| `record` | Recording `fps`, native `cursor`, and `format` (`mp4` or `webm`) |
| `actions`, `expect` | Recorded interaction and the assertion that accepts the take |
| `versions` | `before` or `after` overrides for `route`, `steps`, `ready`, `scroll`, `screenshot`, `actions`, and `expect` |

`steps` and `actions` are the browser's own batch arrays, passed through
unchanged; see `motion.md` for how to write them. The runner owns
`set viewport`, `set media`, `screenshot`, `record`, and `close`, so a recipe
cannot use them.
Viewport, pixel ratio, theme, fixture, and recording settings cannot differ
between versions. Put a per-version override only where the UI or a selector
really changed.

Globs use `/`. `*` and `?` stay within one path segment, `**` crosses segments,
and a plain path also matches everything below it. `sources.shared` lists
inputs that can affect every capture, such as global styles, design tokens, and
dependency manifests. `sources.ignore` lists paths that never affect what the
browser renders, such as docs and tests. Keep credentials, cookies, tokens, and
fixture payloads out of the recipe.

## Capture

Each run opens the route in the named session, runs the steps, waits for fonts
and the `ready` assertion, and checks the viewport, pixel ratio, theme, and
scroll position. A failure names the command and leaves no asset. A recording
then runs `record start`, the actions, and `expect` as one batch, so no process
gap is added between planned actions. A take whose assertion fails is kept as
`<id>.<version>.rejected.<ext>` for inspection and is never recorded.

- Pass `--session` or set `AGENT_BROWSER_SESSION`. A session that is not active
  when the run starts is closed afterwards; an active session, such as one you
  signed in, is left open with its state.
- `--out-dir` and `--manifest` must be outside the source checkout. Assets are
  written as `<id>.<version>.<ext>`; a file there that the manifest does not
  record is never overwritten.
- `--source` is the checkout the server renders. Confirm it the way
  `before-after.md` describes and say how in `--served-check`. A capture whose
  `file:` pages, checked before capture and after a recording, all lie inside
  the source checkout counts as verified. Without these the capture
  is recorded, but its freshness can only be `review`.
- For the base version, save the JSON printed by `before-capture.mjs create`
  and pass it as `--baseline` with `--version before`; its checkout becomes the
  source.

The result reports `outcome`. `captured` and `updated` mean a new asset. A
recapture whose pixels match the recorded asset reports `unchanged`. It keeps
that asset and its original provenance, and records this run as a verification.

## Check freshness

`manifest.mjs status` checks every recorded capture and derived asset in one
pass, and lists recipe captures with no recorded evidence under `uncaptured`:

| Status | Meaning | Next |
| --- | --- | --- |
| `fresh` | Asset intact; recipe, fixture, and source match, or only ignored paths changed | Reuse it |
| `stale` | Asset missing or changed, recipe or fixture changed, a declared input changed, or a derived file's source was refreshed | Recapture or regenerate it |
| `review` | A shared or undeclared path changed, the served checkout or source identity is unknown, or the captured revision is gone | Recapture, or record a focused check |

Source identity is HEAD plus a content ID for every modified, deleted, and
untracked file. Two dirty trees on the same HEAD are therefore distinguished.
Committing exactly the captured edit stays fresh. Ignored files, such as
dependencies, build output, and local environment files, and submodule contents
are not fingerprinted. A changed fixture needs a new `fixture` identifier.
Impact is decided from paths and declarations, not from rendered output, so a
`review` result is a question, not a verdict.

Resolve `review` in one of two ways:

- Recapture it. Identical pixels keep the original asset and add a
  verification; different pixels replace it. This is the only way to resolve
  an unverified served checkout or an unknown source: pass `--source` and
  `--served-check`.
- When only changed paths are in question, inspect the change and record what
  you checked:

  ```bash
  node "<skill-root>/scripts/manifest.mjs" verify --manifest "$EVIDENCE_DIR/manifest.json" \
    --capture settings-profile --basis "pricing.html is a separate page; settings does not load it"
  ```

`verify` refuses stale evidence and captures whose source is unknown. Later
checks compare against the verified source, while the original capture record
stays intact.

Refresh only what status lists as `stale` or unresolved `review`. Leave fresh
evidence and its published references alone.

## Record derived files

Comparisons and prepared clips depend on their captures. Record them so a
refreshed capture marks them stale:

```bash
node "<skill-root>/scripts/manifest.mjs" add --manifest "$EVIDENCE_DIR/manifest.json" \
  --result "$EVIDENCE_DIR/compare/result.json" --inputs "$EVIDENCE_DIR/compare.json"
node "<skill-root>/scripts/prepare-motion.mjs" --spec "$EVIDENCE_DIR/motion.json" \
  --out "$EVIDENCE_DIR/interaction.mp4" --review-out "$EVIDENCE_DIR/interaction-review.png" \
  > "$EVIDENCE_DIR/motion-report.json"
node "<skill-root>/scripts/manifest.mjs" add --manifest "$EVIDENCE_DIR/manifest.json" \
  --result "$EVIDENCE_DIR/motion-report.json" --id interaction --inputs "$EVIDENCE_DIR/motion.json"
```

`--result` reads a `compare.mjs` `result.json` or a saved `prepare-motion.mjs`
report, including its storyboard. It links each output to the recorded captures with the same content.
`--asset <file> --from <asset-id>` records any other file. An asset with no
recorded source, such as an existing screenshot, is accepted but stays `review`.
An input that matches no recorded capture is kept as an unrecorded source, so
the output stays `review` and becomes stale if that input changes.
Review sheets and previews stay local and unrecorded.

## Publish with the record

```bash
node "<skill-root>/scripts/manifest.mjs" reference --manifest "$EVIDENCE_DIR/manifest.json" \
  >> "$EVIDENCE_DIR/section.md"
node "<skill-root>/scripts/publish.mjs" --repo owner/project --target pr:123 \
  --section "$EVIDENCE_DIR/section.md" --manifest "$EVIDENCE_DIR/manifest.json" --dry-run
```

`reference` writes a compact `<sub>` line per capture with revisions, the base
branch, fixture, recipe identity, and freshness, and lists unresolved
limitations. It never includes local paths, base URLs, or session names.

With `--manifest`, the publisher reports freshness for every referenced file.
A file at a recorded path is checked as that asset, so an in-place overwrite is
stale.
Stale evidence is refused before uploading; a dry run still prints the plan with
a `blocked` reason. After readback, the manifest records which assets map to
which hosted URLs. A failed or partial publication is recorded as unverified
with its error. Publishing without `--manifest` is unchanged; use it only for
evidence you deliberately publish without a freshness check.

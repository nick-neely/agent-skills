# Worked example: interaction recording

This example takes one interaction claim from a recorded take to a publication
dry run. The sample pull request lets a visitor choose yearly billing: choosing
**Yearly** shows the yearly price, and the choice survives a reload. The
evidence is an after-only MP4 with timed steps and a storyboard.

Run the blocks in order in one shell; they work from any directory. Keep the
command sequence and replace the recipe, the motion spec, and the sample values
with your own claims. [recipes.md](recipes.md), [motion.md](motion.md), and
[publishing.md](publishing.md) explain each step in depth.

## Runtime inputs

Set these before the first block:

| Variable | Value |
| --- | --- |
| `APP_DIR` | Absolute path of the checkout this pull request's app serves |
| `APP_URL` | URL where the app serves `APP_DIR`, ending in `/` |
| `APP_CHECK` | How you confirmed that server renders `APP_DIR`, such as its process working directory |
| `REPO` | GitHub repository of the pull request, `owner/name`; never inferred |
| `PR` | Pull request number |

## Output files

Everything is written under `$EVIDENCE_DIR`, outside the source checkout:

| File | Written by | Published |
| --- | --- | --- |
| `recipe.json`, `motion.json` | You, from this example | No |
| `pricing-toggle.after.mp4` | `capture.mjs`; the raw take | No |
| `capture.json` | `capture.mjs` result | No |
| `manifest.json` | `capture.mjs` and `manifest.mjs` | No |
| `raw-review.png`, `raw-review.html`, `raw-inspect.json` | `prepare-motion.mjs --inspect` | No |
| `interaction.mp4`, `storyboard.png` | `prepare-motion.mjs` | Yes |
| `section.md` | `prepare-motion.mjs`; `manifest.mjs reference` appends to it | Yes |
| `interaction-review.png`, `motion-report.json` | `prepare-motion.mjs` | No |
| `status.json`, `publish-plan.json`, `publish-result.json` | `manifest.mjs status` and `publish.mjs` | No |

## 1. Prepare the run

```bash
EVIDENCE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ui-evidence.XXXXXX")"
SESSION="$(basename "$EVIDENCE_DIR")"
node "<skill-root>/scripts/preflight.mjs" --motion
node "<skill-root>/scripts/preflight.mjs" --prepare --annotations
```

## 2. Write the recipe

`ready` checks the starting state before the take begins. `actions` run in the
same batch as `record start`, so no process gap is added between them, and
`expect` accepts the take only if the final state shows the claim. Rehearse the
actions in your session first.

```bash
cat > "$EVIDENCE_DIR/recipe.json" <<'JSON'
{
  "version": 1,
  "id": "pricing",
  "sources": { "shared": ["styles.css"], "ignore": ["**/*.md"] },
  "captures": [
    {
      "id": "pricing-toggle",
      "kind": "recording",
      "claims": ["Choosing Yearly shows the yearly price, and the choice survives a reload"],
      "route": "pricing.html",
      "viewport": { "width": 640, "height": 360, "devicePixelRatio": 1 },
      "theme": "light",
      "fixture": "seed:pricing-v1",
      "inputs": ["pricing.html"],
      "steps": [["eval", "localStorage.removeItem('fixture-period')"], ["reload"]],
      "ready": "document.documentElement.dataset.ready === 'true' && document.querySelector('#monthly').checked",
      "record": { "fps": 30, "cursor": true },
      "actions": [
        ["wait", "600"],
        ["click", "label:has(#yearly)"],
        ["wait", "--fn", "document.querySelector('[data-testid=price]').textContent.includes('year')"],
        ["wait", "1000"],
        ["reload"],
        ["wait", "--fn", "document.documentElement.dataset.ready === 'true'"],
        ["wait", "1200"]
      ],
      "expect": "document.querySelector('#yearly').checked && document.querySelector('[data-testid=price]').textContent.includes('year')"
    }
  ]
}
JSON
```

## 3. Record the take

```bash
node "<skill-root>/scripts/capture.mjs" --recipe "$EVIDENCE_DIR/recipe.json" \
  --capture pricing-toggle --base-url "$APP_URL" --session "$SESSION" \
  --out-dir "$EVIDENCE_DIR" --manifest "$EVIDENCE_DIR/manifest.json" \
  --source "$APP_DIR" --served-check "$APP_CHECK" > "$EVIDENCE_DIR/capture.json"
```

A take whose `expect` assertion fails is kept as
`pricing-toggle.after.rejected.mp4` for inspection and is never recorded; fix
the actions and record again. `capture.json` reports the observed `state` and
the recorder's frame counts.

## 4. Inspect the raw take

```bash
node "<skill-root>/scripts/prepare-motion.mjs" --inspect "$EVIDENCE_DIR/pricing-toggle.after.mp4" \
  --review-out "$EVIDENCE_DIR/raw-review.png" --preview-out "$EVIDENCE_DIR/raw-review.html" \
  > "$EVIDENCE_DIR/raw-inspect.json"
```

Open `raw-review.png`, or `raw-review.html` to step through the take, and read
when each action and result happens. In the sample take the click lands near
0.7 seconds and the reload near 1.9 seconds.

## 5. Write the motion spec

Times are seconds on the raw take. `at` rectangles are source pixels around the
control or result, from the take's 640x360 frame. Replace both with what your
take shows. `input` resolves relative to the spec.

```bash
cat > "$EVIDENCE_DIR/motion.json" <<'JSON'
{
  "input": "pricing-toggle.after.mp4",
  "trim": { "start": 0.2, "end": 2.8 },
  "holds": { "start": 0.5, "end": 1 },
  "profile": { "fps": 30 },
  "title": "Yearly billing persists",
  "summary": "Choosing Yearly shows the yearly price, and the choice survives a reload.",
  "annotations": {
    "events": [
      { "start": 0.5, "end": 1.1, "step": 1, "caption": "Click Yearly", "at": [161, 126, 71, 35] },
      { "start": 1.1, "end": 1.8, "step": 2, "caption": "The price changes to $120 / year", "at": [59, 173, 190, 45], "hold": 1 },
      { "start": 1.8, "end": 2.2, "caption": "The page reloads" },
      { "start": 2.2, "end": 99, "step": 3, "caption": "Yearly is still selected after the reload", "at": [161, 126, 71, 35] }
    ]
  },
  "storyboard": {
    "checkpoints": [
      { "at": 0.4, "label": "Monthly is selected: $12 / month" },
      { "at": 1.4, "label": "Yearly is selected: $120 / year" },
      { "at": 2.6, "label": "After the reload, Yearly is still selected" }
    ]
  }
}
JSON
```

## 6. Prepare the clip

One run writes the clip, its review sheet, the storyboard, and a
publisher-compatible `section.md` that references exactly the clip and the
storyboard. The report goes to `motion-report.json`.

```bash
node "<skill-root>/scripts/prepare-motion.mjs" --spec "$EVIDENCE_DIR/motion.json" \
  --out "$EVIDENCE_DIR/interaction.mp4" --review-out "$EVIDENCE_DIR/interaction-review.png" \
  --storyboard-out "$EVIDENCE_DIR/storyboard.png" --markdown-out "$EVIDENCE_DIR/section.md" \
  > "$EVIDENCE_DIR/motion-report.json"
```

## 7. Review the outputs locally

`interaction-review.png` samples the prepared clip every half second. Check the
first, intermediate, and final states, each annotation around its boundaries,
and `storyboard.png` at about 880 pixels wide. Sampled frames can miss a brief
change, so also play the complete `interaction.mp4` in a local player or
browser when one is available, and report which of these you did. Decoding
every frame confirms the file is complete, not what it shows:

```bash
ffmpeg -v error -i "$EVIDENCE_DIR/interaction.mp4" -f null -
node -p 'require(process.argv[1]).warnings.join("\n") || "No warnings."' "$EVIDENCE_DIR/motion-report.json"
```

The reading pause on step 2 is reported as a warning and labelled in the clip
and in `section.md`.

## 8. Register the derived files and check freshness

```bash
node "<skill-root>/scripts/manifest.mjs" add --manifest "$EVIDENCE_DIR/manifest.json" \
  --result "$EVIDENCE_DIR/motion-report.json" --id interaction --inputs "$EVIDENCE_DIR/motion.json" > /dev/null
node "<skill-root>/scripts/manifest.mjs" status --manifest "$EVIDENCE_DIR/manifest.json" \
  > "$EVIDENCE_DIR/status.json"
```

In `status.json`, the take, `interaction`, and `interaction.storyboard` should
be `fresh`. Recapture anything `stale`, and resolve `review` as recipes.md
describes, before publishing.

## 9. Dry-run the publication

Append the compact capture reference as its own paragraph, then validate the
section, its media, and the named target without uploading:

```bash
{ echo; node "<skill-root>/scripts/manifest.mjs" reference --manifest "$EVIDENCE_DIR/manifest.json"; } \
  >> "$EVIDENCE_DIR/section.md"
node "<skill-root>/scripts/preflight.mjs" --publish
node "<skill-root>/scripts/publish.mjs" --repo "$REPO" --target "pr:$PR" \
  --section "$EVIDENCE_DIR/section.md" --manifest "$EVIDENCE_DIR/manifest.json" \
  --dry-run > "$EVIDENCE_DIR/publish-plan.json"
```

`publish-plan.json` lists `interaction.mp4` as video and `storyboard.png` as an
image, the only media `section.md` references, each with its freshness. Raw
takes and review files are never referenced. A `blocked` field names stale
evidence to refresh first.

## 10. Publish

Run this only with authorization to update the pull request, as `SKILL.md`
describes. It uploads the reviewed clip and storyboard and replaces the managed
evidence block.

```bash
node "<skill-root>/scripts/publish.mjs" --repo "$REPO" --target "pr:$PR" \
  --section "$EVIDENCE_DIR/section.md" --manifest "$EVIDENCE_DIR/manifest.json" \
  > "$EVIDENCE_DIR/publish-result.json"
```

Publication is complete only when `publish-result.json` reports
`readback.verified: true` with a hosted URL for each asset. Readback proves the
saved references, not playback; qualify a new video path by playing it when
practical. Keep `$EVIDENCE_DIR` until the pull request merges, so a follow-up
commit can refresh only stale evidence.

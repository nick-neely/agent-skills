# Comparisons

Use `compare.mjs` when a reviewer must see the before and after states together:
a before/after comparison, enlarged detail crops, or numbered callouts that pair
the same change in both versions. One invocation writes every requested asset,
a publisher-compatible Markdown section, and a structured result.

```bash
node "<skill-root>/scripts/preflight.mjs" --compare
node "<skill-root>/scripts/compare.mjs" --spec "$EVIDENCE_DIR/compare.json" \
  --out-dir "$EVIDENCE_DIR/compare"
```

You still choose the claims, prove the two captures show comparable states
(see [before-after.md](before-after.md)), and review every output. The script
owns layout, scaling, pin placement, legends, and file naming.

## Capture anchors with the screenshots

Selectors give stable regions that survive small layout changes. Resolve them in
the same named browser session that renders the page, at capture time:

```bash
node "<skill-root>/scripts/anchors.mjs" --session "$AGENT_BROWSER_SESSION" \
  --anchor save='[data-testid="save"]' --anchor email='[data-testid="email"]' \
  --screenshot "$EVIDENCE_DIR/after.png" --out "$EVIDENCE_DIR/after-anchors.json"
```

Add `--full` for a full-page screenshot. `--image <png>` describes a screenshot
you already captured from the current page state instead. The helper only
evaluates and screenshots in that session; it never opens, navigates, resizes,
or closes it. It records the viewport, scroll offset, document size, device
pixel ratio, and screenshot size, then refuses a selector that matches nothing,
matches several elements, or has no rendered box, listing the candidates.
Capture the before and after states in their own sessions with the same anchor
names.

Rendering later needs only the saved files, not the app. Literal rectangles in
screenshot pixels work too, for example from `regions.mjs`:

```bash
node "<skill-root>/scripts/regions.mjs" before.png after.png --crops
```

`--crops` groups nearby changed regions into suggested detail windows. They are
suggestions; pick the one that proves the claim.

## Spec

Paths resolve relative to the spec file. Rectangles are `[x, y, width, height]`
in source screenshot pixels, or `{ "anchor": "<name>" }`.

```json
{
  "title": "Toolbar save action",
  "before": { "image": "before.png", "label": "Before (main)" },
  "after": { "image": "after.png", "label": "After (this PR)" },
  "crop": [0, 0, 1280, 400],
  "redact": [{ "at": [24, 24, 220, 36], "style": "block" }],
  "callouts": [
    {
      "id": 1,
      "text": "Save moved left and widened to fit its new label.",
      "label": "Save",
      "before": [1040, 24, 120, 36],
      "after": [1000, 24, 160, 36],
      "measure": "width"
    },
    {
      "id": 2,
      "text": "The unsaved-changes hint now appears beside the toolbar.",
      "after": [760, 30, 220, 24],
      "spotlight": true
    }
  ],
  "details": [{ "callout": 1 }],
  "flip": { "holdMs": 1500 },
  "onion": { "opacity": 0.5 }
}
```

| Field | Meaning |
| --- | --- |
| `before`, `after` | `image` (PNG), optional `label`, `anchors` file, and `devicePixelRatio` when no anchors file records it |
| `title` | Optional heading for the Markdown section |
| `layout` | `auto` (default), `side-by-side`, or `stacked` |
| `crop` | One source rectangle applied to both panels |
| `redact` | `at` or `anchor`, optional `panel` (`both`, `before`, `after`) and `style` (`pixelate`, `block`) |
| `callouts` | Paired numbered pins; see below |
| `details` | Enlarged matched crops; see below |
| `flip` | `true` or `{ "holdMs": 500-10000 }`; opt-in screenshot flip GIF |
| `onion` | `true` or `{ "opacity": 0-1 }`; opt-in overlay of after on before |
| `sizeMismatch` | `reject` (default) or `pad` to align different sizes top-left |
| `displayWidth` | Width the image is read at, default 880 (GitHub PR body) |
| `alt` | Override the generated alt text for the combined image |

### Callouts

Each callout has a stable integer `id`, a `text` explanation, and a region in
one or both panels: `before`, `after`, or `region` for both. Reuse one ID for
the same change in both versions; a region in only one panel marks an addition
or removal. The pin number and legend carry the meaning, so colour is never the
only cue.

- `label`: a short on-image tag beside the pin. When it cannot fit without
  covering another mark or leaving the panel, it is dropped and the legend keeps
  the explanation; the result lists that limitation.
- `spotlight: true` dims the rest of that panel around the region.
- `measure: "width"` or `"height"` draws a bracket with the size in CSS pixels
  and adds the before and after values to the legend. For a spacing claim, make
  the region the gap itself.

Explanations always go to the legend under the panels and to the Markdown list,
never onto the UI. Pins sit beside a region corner; when crowded they move into
a reserved margin with a connector line.

### Details

Each detail produces one enlarged before/after image:

- `{ "callout": 1 }` uses that callout's regions.
- `{ "region": [...] }` uses one region in both panels.
- `{ "before": [...], "after": [...] }` uses separate regions, with
  `"separate": true` to centre an equal-size window on each when the element
  moved too far for one window.

By default both panels crop the same source coordinates around the union of the
regions, so movement stays visible instead of being aligned away. Options: `id`,
`label`, `context` (source pixels around the region, default about a quarter of
the region or 24 CSS pixels), `zoom` (`auto` or 1 to 8), and `layout`.

## Outputs

`--out-dir` receives `comparison.png`, `detail-<id>.png`, `flip.gif`,
`onion.png`, `section.md`, and `result.json`; stdout repeats the result. The
result lists every output, the canvas and per-panel geometry (`canvas` and
`source` rectangles plus `scale`), callout IDs with source rectangles, pin
placement, labels, and brackets, detail windows, and `limitations` to mention in
the PR when relevant.

The combined image stands on its own: labelled panels at one scale, pins, and a
legend. Chrome scales with the canvas so it reads at the rendered PR width. Wide
captures stack and tall captures sit side by side; crop or add a detail when the
change is still too small to read at that width.

`flip.gif` alternates the two labelled screenshots with the configured hold.
Describe it as a screenshot comparison; claims about real motion need a
recording ([motion.md](motion.md)). `onion.png` blends after over before at a
fixed opacity for subtle positioning changes. Both need identical dimensions.

## Rules

- Before and after must share a device pixel ratio. Different dimensions are
  refused unless `sizeMismatch` is `pad`; panels are never stretched.
- Geometry outside an image, outside the crop, or with no area fails before
  anything is written.
- Redaction runs on the source pixels before any crop, zoom, flip, or overlay,
  so every derived output inherits it. Redact anything a reviewer does not need.
- Review `comparison.png` at the PR width and at original size, and each detail,
  before publishing. Keep the output directory outside the source tree.

Publish with `publish.mjs --section "$EVIDENCE_DIR/compare/section.md"`; the
section's relative paths resolve under its directory.

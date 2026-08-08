# Annotation spec

The spec is a JSON file passed to `scripts/annotate.mjs`. Geometry is drawn as
SVG and text is laid out as HTML, so labels size themselves to their content and
a bundled font keeps output identical on every machine.

## Top level

| Field | Required | Meaning |
| --- | --- | --- |
| `image` | Yes | Path to the screenshot, absolute or relative to the spec file |
| `annotations` | No | Array of annotations, drawn in order |
| `crop` | No | `{ x, y, width, height, pad }` applied before annotation; `pad` defaults to `0` |
| `caption` | No | Text placed in a bar under the image |

Leave `caption` unset unless it says something the surrounding markdown cannot.
An image inside a before/after table already has a column header, and the
section prose already describes the change, so a caption reading "Before" or
"Capture your first note was reworded" is pure duplication rendered twice.

**Coordinates always refer to the original screenshot**, including when `crop`
is set. The script translates them. This means you can feed rectangles straight
from `regions.mjs` or `agent-browser get box` without adjusting anything.

## Annotation types

### `arrow`

```json
{ "type": "arrow", "to": [420, 260], "from": [520, 360], "label": "new empty state" }
```

`to` is the point of the arrow. `from` is optional; without it the tail is
placed away from the nearest edge so it never lands off-canvas. A `label` is
drawn at the tail.

### `box`

```json
{ "type": "box", "at": [256, 131, 768, 18], "label": "row height changed" }
```

`at` is `[x, y, width, height]`. The label sits above the rectangle.

### `circle`

```json
{ "type": "circle", "at": [358, 92, 46, 19], "label": "icon swapped" }
```

Draws a dashed ellipse around the rectangle with a small margin. Use it for a
callout that should not imply a hard boundary.

### `label`

```json
{ "type": "label", "at": [640, 40], "text": "unchanged for reference", "anchor": "center" }
```

Free-standing text. `anchor` is `center`, `above`, or `below`.

### `redact`

```json
{ "type": "redact", "at": [1040, 24, 180, 28], "style": "pixelate" }
```

`style` is `pixelate` (default) or `block`. Redaction is applied to the pixels
before anything is drawn, so the original content cannot survive into the
output. Apply it to any name, email address, avatar, customer identifier, or
org name that a reviewer does not need.

### `inset`

```json
{ "type": "inset", "at": [256, 88, 210, 32], "zoom": 2, "place": "bottom-right", "label": "2x" }
```

Crops the rectangle, magnifies it, and pins it to a corner. `place` is
`top-left`, `top-right`, `bottom-left`, or `bottom-right`. Use this when the
change is too small to read at the width GitHub renders but the surrounding
context still matters. When context does not matter, crop instead.

Insets are cropped after redaction, so a redacted area cannot reappear
magnified in the corner.

## Weight

Stroke widths, label type, and inset borders scale with the canvas, so the same
spec reads correctly on a 350-pixel crop and a 1440-pixel full page. Nothing
needs setting for this. It does mean a spec tuned by eye on a full screenshot
will look different once cropped, so review the output at its final size.

## Colour

One accent is used until an image carries three or more annotations, at which
point colours rotate so each annotation stays distinguishable. Override per
annotation with `"color": "#0090ff"` when a specific pairing helps, for example
matching an inset border to the box it magnifies.

## Checking dependencies

```bash
node scripts/annotate.mjs --check
```

Reports whether ImageMagick, `agent-browser`, and the bundled font are all
present. Use `--keep-temp` to leave the generated HTML on disk when output
looks wrong.

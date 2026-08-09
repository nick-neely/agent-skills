# Removing the background

## Which path

| Source | Path | Why |
| --- | --- | --- |
| Generator can emit alpha | Native | Nothing to reconstruct, so nothing to get wrong. |
| Flat green or magenta ground | `chroma-matte.py` | Knows the exact key color, so it can unmix edge pixels and keep interior holes. |
| Photo, gradient, or busy ground | `segment.py` | No single key color exists to sample. |

When you control generation, ask for a flat magenta or green background even if
the tool cannot emit alpha. It converts the hard problem into the easy one.
Pick whichever of the two is furthest from the subject's own colors: magenta
for foliage and greenery, green for skin, lips, and most UI accent palettes.

## Chroma matte

```bash
"$IMG_PY" "<skill-root>/scripts/chroma-matte.py" --input raw.png --out alpha.png \
  [--key '#ff00ff'] [--transparent 18] [--opaque 105] [--no-neutral-protect]
```

It samples the key from the border median, so it needs the background to
actually reach the edges. Pass `--key` when the subject bleeds off-frame or the
border is not representative.

`--transparent` and `--opaque` are distances in RGB space from the key color.
Below `--transparent` a pixel is fully background. Above `--opaque` it is fully
subject. Between them it gets fractional alpha, which is what makes the edge
smooth.

**`--opaque` is derived from the image unless you pass a value**, because the
right cutoff depends on how far this particular subject sits from the key. Only
pixels below the cutoff get despilled, so a cutoff that is too low leaves
genuine blend pixels classified as fully opaque, keeping their share of key
color as a visible fringe. On a dark subject against magenta, a fixed cutoff of
105 leaves a clear magenta line along every hard edge. Overriding it is for
when the derived value is wrong, not a routine step.

- **Background survives in patches:** raise `--transparent`. The ground varies
  more than the default window allows, which happens with compression artifacts
  or a subtle gradient in the ground.
- **Subject edges eaten away:** lower `--transparent`. You are inside the
  subject's own color range.
- **A colored line traces the subject's hard edges:** raise `--opaque`. Blend
  pixels are being called fully opaque and skipping despill. Raise it too far
  and edges tint *away* from the key, so move in steps and inspect.
- **Edge too soft or ghosted:** lower `--opaque` to narrow the transition band.
- **Grey or white subject regions going transparent:** neutral protection
  handles this by holding low-chroma pixels opaque. If it misfires on a subject
  that is genuinely near the key color, disable it with `--no-neutral-protect`
  and tune the thresholds by hand instead.

The edge unmix is the part that matters most. An antialiased pixel is a blend
of subject and key, so leaving it alone produces the colored fringe that makes
an asset look cheap. The script solves for the underlying subject color and
writes that instead.

## Segmentation

```bash
"$IMG_PY" "<skill-root>/scripts/segment.py" --input photo.png --out alpha.png \
  [--model isnet-general-use] [--no-alpha-matting]
```

| Model | Use |
| --- | --- |
| `isnet-general-use` | Default. Best general quality. |
| `birefnet-general-lite` | The other quality option. Try it when isnet misses. |
| `u2net` | Older general model. Occasionally better on people. |
| `u2netp` | Fast, small, too weak for a final asset. Preview only. |

Keep alpha matting on for anything shipping. Off, you get a hard binary cut
with visible stair-stepping; on, you get a real transition band. Turn it off
only to preview quickly or when matting is smearing a very fine edge like hair.

Models cache under `U2NET_HOME`, defaulting to `~/.u2net`. The first run of a
new model downloads 170MB to 220MB, so tell the user before triggering one.

Known weaknesses, both of which are why chroma matte is preferred whenever the
background allows it:

- **Interior holes get filled.** A ring, a mug handle, or a letter counter comes
  back solid, because the models predict a subject silhouette rather than true
  per-pixel alpha.
- **Fringing persists.** There is no key color to unmix against, so edge pixels
  keep whatever the original background contributed.

If segmentation fills a hole you need, regenerate the source on a flat chroma
ground and use chroma matte. Punching the hole back by hand is rarely worth it.

## Verifying, not assuming

Both paths exit zero on a bad result. `inspect-alpha.py` exists so that the
check is cheap enough to always run:

```bash
"$IMG_PY" "<skill-root>/scripts/inspect-alpha.py" --input alpha.png --out sheet.png
```

Judge fringing on the dark ground and semi-transparency on the checkerboard. A
white ground hides both, which is why looking at the asset on the page it will
live on is not sufficient evidence that the alpha is clean.

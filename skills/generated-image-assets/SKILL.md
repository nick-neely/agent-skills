---
name: generated-image-assets
description: Turn a generated or existing raster image into a clean project asset with real transparency. Use when an image needs its background removed, when a generated icon or illustration arrives on a flat green or magenta background, when alpha edges show colored fringing or halos, or when an asset needs trimming, high-DPI sizing, and optimization before it ships. Triggers include "remove the background", "make this transparent", "clean up this icon", "this has a green fringe", and "turn this into an app asset".
compatibility: Requires Python 3.9 or newer. Creates an on-demand virtualenv outside the repo on first use. The segmentation path additionally downloads an ONNX model of roughly 200MB.
---

# Generated image assets

Turn raster output into an asset you would ship. Background removal is not a
one-command conversion: the failure modes are colored fringes, opaque halos,
filled-in interior holes, and clipped detail, and all four survive a command
that exits zero.

So this skill is built around verifying the alpha, not just producing it.
Replace `<skill-root>` below with the directory containing this file.

## Set up

```bash
node "<skill-root>/scripts/preflight.mjs"
```

Reports what is present and prints the exact command for anything missing. It
never installs.

```bash
node "<skill-root>/scripts/setup.mjs"                 # chroma tier: Pillow + NumPy
node "<skill-root>/scripts/setup.mjs" --tier full --yes  # adds rembg, roughly 500MB
```

The virtualenv lives in your cache directory, never in the repo. Do the light
tier by default and only take the full tier when you actually need
segmentation. Ask before triggering either download.

Every command below runs through that interpreter:

```bash
IMG_PY="${XDG_CACHE_HOME:-$HOME/.cache}/generated-image-assets/venv/bin/python"
```

## Pick the path

**Native transparency beats both paths.** If you are generating the image and
the tool can emit alpha directly, do that and skip to Verify.

**Flat green or magenta background: use chroma matte.** It samples the key
color, builds a soft alpha, and unmixes the antialiased edge pixels. It
preserves interior holes, which is exactly where the segmentation models fail.

```bash
"$IMG_PY" "<skill-root>/scripts/chroma-matte.py" --input raw.png --out alpha.png
```

**Anything else: use segmentation.**

```bash
"$IMG_PY" "<skill-root>/scripts/segment.py" --input photo.png --out alpha.png
```

Defaults to `isnet-general-use` with alpha matting. Use
`birefnet-general-lite` as the other quality option. `u2netp` is fast and too
weak for a final asset, so reach for it only to preview.

Do not use ffmpeg for this. It is fine for format conversion and scaling, and
it is not a matte-quality background remover.

Threshold tuning and the specific failure modes are in
[backgrounds.md](references/backgrounds.md).

## Verify

Never skip this, and never conclude from the command exiting cleanly.

```bash
"$IMG_PY" "<skill-root>/scripts/inspect-alpha.py" --input alpha.png --out sheet.png
```

This writes a contact sheet compositing the asset over light, dark, and
checkerboard grounds, with the alpha channel alone and a zoomed edge crop. It
also prints a JSON report. Read the JSON first, since it costs no vision
tokens:

- **A partial-alpha band should exist.** Near zero means the edge is a hard
  binary cut and will look jagged.
- **Interior holes should survive.** The report counts transparent regions not
  connected to the border. If a ring came back solid, chroma matte handles it
  and segmentation does not.
- **Residual spill should be low.** This is the number that catches a fringe
  the eye misses at small sizes. It measures how far edge pixels still lean
  toward the key relative to the subject beside them, so 0 is a clean edge.
  Under 0.1 is clean, 0.1 to 0.25 is normal for a 3D render and fine at final
  size, and above 0.3 means a visible colored line. Raise `--opaque` when it is
  high.
- **Content should not be clipped** at the image edge.

Then open the contact sheet. The dark ground is where halos show; the
checkerboard is where semi-transparent regions show.

If any check fails, adjust and rerun. Do not proceed with a bad matte.

## Finish

Keep the full-resolution transparent result as the source of truth. Produce the
app asset from it at the multiplier the display needs.

Prefer the project's own image tooling when it has any, since that keeps the
pipeline deterministic and one dependency lighter. When it has none:

```bash
"$IMG_PY" "<skill-root>/scripts/finish.py" --input alpha.png \
  --out-dir assets/icons --name search --size 64 --scales 1,2,3 --trim
```

Sizing, format choice, and where the asset belongs are in
[finishing.md](references/finishing.md).

## Done

The work is finished when the alpha passes inspection, the asset exists at
every scale the interface needs, and the project references point at the
committed asset rather than a temporary generation or processing path. Look at
the result in the real interface at its actual rendered size. An asset that
inspects clean at full resolution can still be mush at 16px.

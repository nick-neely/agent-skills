---
name: generated-image-assets
description: Create, clean, and ship generated raster assets, especially icons or illustrations that need transparent backgrounds. Use when generated imagery needs background removal, alpha cleanup, despilling, resizing, optimization, or project-ready asset placement.
---

# Generated image assets

Turn generated raster output into a clean project asset. Preserve the best
available source and verify the final alpha edges instead of treating background
removal as a one-command conversion.

## Transparency

1. Prefer generation with native transparency when the image tool supports it.
2. For a flat green or magenta background, use a chroma-matte workflow that
   samples the background, builds a soft alpha matte, and despills antialiased
   edges. Preserve intentional interior holes.
3. For a non-uniform background, use a segmentation model with alpha matting.
   Prefer a quality-oriented general model over a small speed-oriented model for
   final assets.
4. Inspect the result against light, dark, and checkerboard backgrounds. Reject
   colored fringes, opaque halos, clipped details, and filled interior holes.

## Project output

- Keep a high-quality transparent source when future resizing or editing is
  likely.
- Produce the app asset at the rendered-size multiplier required for high-DPI
  displays. Use the project's existing image tooling for deterministic trimming,
  resizing, padding, and PNG or WebP optimization.
- Keep project references pointed at a stable repository asset, not a temporary
  generation or processing path.
- Verify the asset in the real interface at its actual rendered size before
  considering it finished.

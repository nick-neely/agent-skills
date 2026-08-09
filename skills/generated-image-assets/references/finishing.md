# Finishing and shipping the asset

## Keep the source

Keep the full-resolution transparent result, and generate every shipped size
from it. Once you have downscaled to 64px and thrown away the original, the
next design change means redoing the matte.

Where it goes depends on the project. A `design/` or `assets/source/` directory
that is not bundled is the usual answer. Committing a 4MB PNG that ships to
users is not.

## Trim before sizing

Generated images almost always carry uneven transparent margin. Trim to the
alpha bounding box first, then add deliberate padding if the asset needs
optical breathing room. Otherwise every asset lands at a slightly different
visual size and no amount of CSS makes a row of them line up.

Exception: a set of icons meant to share one grid should be trimmed and then
padded back to a common box, not trimmed to each one's own content.

## Sizing for high-DPI

Produce the asset at the rendered size multiplied by the device pixel ratios
you support. Rendering a 64px slot from a 64px image is soft on every modern
display.

```bash
"$IMG_PY" "<skill-root>/scripts/finish.py" --input alpha.png \
  --out-dir assets/icons --name search --size 64 --scales 1,2,3 --trim
```

This writes `search.png`, `search@2x.png`, and `search@3x.png`. Use the naming
your platform expects: `@2x` suffixes for Apple platforms and most web
conventions, density buckets for Android, and a plain size suffix where the
build tool picks by filename.

Web can usually stop at `2x`. Include `3x` for iOS and for anything that will
be viewed on a high-density phone.

## Prefer the project's tooling

When the project already depends on sharp, use it. Same for an existing image
pipeline in the build. `finish.py` is the fallback for when there is nothing,
and one fewer parallel toolchain is worth more than the convenience.

Whatever does the resizing, use a high-quality resampling filter. Lanczos or
better. A fast box filter on a 3x downscale visibly destroys fine detail.

## Format

- **PNG** for anything with hard edges, flat color, or text. Lossless, and the
  usual choice for icons.
- **WebP** when the asset is photographic or large enough that the size
  difference matters. Check alpha renders correctly in your targets.
- **SVG** is better than either when the source is actually vector. If you are
  matting a generated raster of something that should have been a vector icon,
  consider whether redrawing it is the real answer.

Optimize before committing. Generated PNGs routinely carry several times the
bytes they need.

## Point the project at the committed asset

The last step is the one most often missed: update the references. A component
still pointing at `/tmp/generation-4.png` or at a path in your processing
directory works locally and breaks for everyone else.

Then look at it in the real interface at its real rendered size. An asset that
inspects clean at 1024px can still be unreadable at 16px, and the fix for that
is a simpler shape rather than a better matte.

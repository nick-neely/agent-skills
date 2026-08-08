---
name: annotated-screenshots
description: Capture, annotate, and publish UI screenshots into a GitHub pull request or issue. Use when a change needs visual evidence, when a reviewer needs before/after comparison of a screen, when a screenshot needs arrows, circles, callout labels, cropping, or redaction, or when a bug report needs an annotated image. Triggers include "add screenshots to the PR", "show before and after", "annotate this screenshot", "circle the change", and "attach a screenshot to the issue".
compatibility: Requires git, the gh CLI authenticated, agent-browser with Chrome installed, and ImageMagick.
---

# Annotated screenshots

Turn a UI change into visual evidence a reviewer can read in ten seconds.

This skill owns markup, composition, and publishing. It borrows capture from
`agent-browser`. Replace `<skill-root>` below with the directory containing this
file.

Scripts do the work that is identical every run. You do the work that needs
judgement: which surfaces matter, which changes are worth pointing at, and what
the caption should say.

## Check dependencies first

```bash
node "<skill-root>/scripts/preflight.mjs"
```

Run this before capturing anything. It checks ImageMagick, `agent-browser`, an
actually-installed Chrome, the `gh` CLI, a live `gh` token, git, and the bundled
font, and prints the install command for whatever is missing.

Checking up front matters because the dependencies fail at different stages. A
missing Chrome surfaces at the first screenshot; a missing `gh` token surfaces
at publish, after capture, worktree, and annotation are already done and wasted.

When something is missing, tell the user what and give them the command. Do not
install system packages, write global npm modules, or download a browser
without asking first. `agent-browser install` downloads roughly 200MB.

## Scope the work

1. When you have just made the change, use what you already know about it. Do
   not re-derive the affected surfaces from the diff.
2. When you arrive cold, on an existing pull request or in a fresh session,
   read the diff and state which surfaces and states you will capture and why,
   before capturing anything. If you cannot name a surface, stop and ask. A
   confidently wrong screenshot is worse than none.
3. When the user names surfaces or states, capture exactly those. Their
   direction overrides your inference.
4. Capture the states that actually changed: light and dark, desktop and
   mobile, hover, focus, open modal, empty and populated. Do not shoot a
   default viewport and call it done.

## Capture

Use `agent-browser` and reuse a running dev server when one exists.

```bash
agent-browser open <url>
agent-browser set viewport 1280 800
agent-browser screenshot ./after.png
```

`agent-browser get box <selector>` returns the exact pixel rectangle of an
element. Prefer it over estimating coordinates from the image.

For before/after, read [before-after.md](references/before-after.md). It covers
the worktree, the dev-server handoff, and the rule that decides whether the two
captures can run in parallel.

Before and after must share a viewport and device pixel ratio. Different
dimensions make the comparison meaningless, and the region script rejects them.

## Find what changed

```bash
node "<skill-root>/scripts/regions.mjs" before.png after.png
```

This returns the changed rectangles as JSON, largest first, plus their union.
Use it instead of comparing two images by eye: it is exact, and it costs no
vision tokens.

Read the regions, then decide which ones a reviewer cares about. Rendering
noise, timestamps, and animation frames all show up here and most of them
deserve no annotation.

## Annotate

Write a spec and render it:

```bash
node "<skill-root>/scripts/annotate.mjs" --spec spec.json --out annotated.png
```

```json
{
  "image": "after.png",
  "crop": { "x": 240, "y": 80, "width": 800, "height": 110, "pad": 16 },
  "caption": "Empty state replaces the spinner when the query returns nothing.",
  "annotations": [
    { "type": "box", "at": [256, 131, 768, 18], "label": "new empty state" },
    { "type": "redact", "at": [1040, 24, 180, 28] }
  ]
}
```

Coordinates always refer to the original screenshot, including when you crop.
The full vocabulary and every field is in
[annotation-spec.md](references/annotation-spec.md).

Four rules that decide whether the output is readable:

- **Crop to the change.** A four-pixel border change on a 1440-wide screenshot
  is invisible at the width GitHub renders. Use the region union as the crop,
  or a zoom inset when the surrounding context matters.
- **Point, do not narrate.** A box already directs the eye. Add a label only
  when the reader could not otherwise tell which change you mean, and never to
  restate what the image plainly shows. In a before/after pair the pairing is
  the explanation, so the annotation usually needs no words at all. An
  annotation should sit quietly on the screenshot, not compete with it.
- **Let the surrounding markdown do its job.** The section prose, the table
  headers, and the pairing all carry meaning. A caption that repeats any of
  them is noise. Caption only what the markdown cannot say, and never caption
  images inside a before/after table with "Before" or "After".
- **Redact before upload.** Names, email addresses, customer identifiers, and
  org names in a screenshot become permanent once published. Redaction destroys
  the pixels, so it only works beforehand.

Annotation weights scale with the image, so a small crop gets proportionally
thinner strokes and smaller labels. Check the rendered result at the width it
will be displayed, not at full size.

## Confirm

Show the composed markdown and every annotated image to the user, and wait for
an explicit yes. Publishing is outward-facing and an uploaded image cannot be
recalled.

Flag anything in the images that looks like personal or customer data, even
when you have already redacted what you noticed.

## Publish

```bash
node "<skill-root>/scripts/publish.mjs" --target pr:123 --section section.md
node "<skill-root>/scripts/publish.mjs" --target issue:45 --section section.md --mode comment
```

The script uploads every local image the section references, rewrites the paths
to hosted URLs, and splices the result into a managed block. Re-running replaces
that block rather than appending a second copy.

Keep the section within six images and note explicitly when you leave something
out. Layout templates and the upload fallback behaviour are in
[publishing.md](references/publishing.md).

## Done

The work is finished when every surface you named in scoping has been captured,
annotated, confirmed, and published, and the pull request or issue renders the
images. Open the published page and confirm the images display. A successful
upload is not evidence that the section renders.

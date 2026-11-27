---
name: Nick Neely - Agent skills
description: A catalog-first sibling of nickneely.dev for installing Nick's agent skills.
colors:
  ground-dark: "oklch(0.152 0.009 75)"
  surface-dark: "oklch(0.188 0.009 75)"
  raised-dark: "oklch(0.245 0.009 75)"
  border-dark: "oklch(0.272 0.009 75)"
  ink-dark: "oklch(0.96 0.006 85)"
  ink-muted-dark: "oklch(0.72 0.014 82)"
  signal-dark: "oklch(0.7819 0.1585 72.33)"
  ground-light: "oklch(0.975 0.005 85)"
  surface-light: "oklch(0.993 0.003 85)"
  raised-light: "oklch(0.955 0.006 85)"
  border-light: "oklch(0.895 0.008 85)"
  ink-light: "oklch(0.19 0.012 60)"
  ink-muted-light: "oklch(0.48 0.018 70)"
  signal-light: "oklch(0.555 0.128 60)"
typography:
  display:
    fontFamily: "Bricolage Grotesque Variable, Bricolage Grotesque Fallback, ui-sans-serif, system-ui, sans-serif"
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Hanken Grotesk Variable, Hanken Grotesk Fallback, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.6
  mono:
    fontFamily: "JetBrains Mono Variable, JetBrains Mono Fallback, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "0.875rem"
    fontWeight: 450
    lineHeight: 1.5
rounded:
  sm: "0.375rem"
  md: "0.625rem"
components:
  command-block:
    backgroundColor: "{colors.surface-dark}"
    textColor: "{colors.ink-dark}"
    typography: "{typography.mono}"
    rounded: "{rounded.md}"
---

# Design System: Nick Neely - Agent skills

## Overview

This site shares nickneely.dev's visual system and adapts its layout for a
catalog. The source of truth for the shared system is the `nickneely.dev`
repository's `DESIGN.md` and `src/styles.css`; the tokens above are copied from
it, not invented here. If the main site's tokens change, copy the change here.

It is typography-driven, dark by default with a first-class light theme, and
confident rather than decorated. Personality comes from type scale, a single
accent and restraint everywhere else. Where the main site is laid out for
reading, this one is laid out for scanning and installing: dense, command-first,
with monospace doing more of the work.

## Colors

### Primary

Signal amber (`signal-*`) is the only accent. Spend it on
link underlines, status dots, hover and focus states, the copy confirmation,
code highlighting, text selection and the scrollbar hinge. Nothing else is
amber.

### Neutral

Warm off-black ground in dark, warm off-white in light; never pure black or
white. Surfaces step up one level (`surface-*`) for command blocks and cards;
`raised-*` is for hover and selected states. One elevation level only.

### Named Rules

- **One accent.** If something needs to stand out and amber is already used
  nearby, use weight, size or position instead.
- **Requires vs uses.** In dependency graphs, a required edge is solid and a
  conditional edge is dashed. Never distinguish them by colour alone.

## Typography

- **Bricolage Grotesque** for the display moment only: the hero line and page
  titles.
- **Hanken Grotesk** for prose: summaries and rendered `SKILL.md` instructions.
Each family has a metric-matched local fallback face (`<Family> Fallback`, in
`site.css`) so text does not reflow when the web font arrives.

- **JetBrains Mono** for navigation, skill names, commands, metadata, status
  tags and badges. Monospace is a deliberate developer-tool signal, not
  decoration.

### Hierarchy

Skill names are mono and set in the ink colour; summaries are prose in the
muted ink. Rendered instructions keep a clear reading width (about 70ch).

## Layout

Catalog-first. The install command sits above the fold on every page. Tables
and lists scan in one column on phones; graphs fall back to an indented tree on
narrow screens. 16px minimum side gutter, no horizontal page scroll; command
blocks scroll horizontally inside themselves.

## Elevation & Depth

Restrained borders and one elevation level. No shadows beyond a hairline, no
backdrop blur.

## Shapes

Small radii (`rounded.sm` for chips and badges, `rounded.md` for command blocks
and cards).

## Components

### Command block

Mono text on `surface`, a copy button that confirms with a short amber state
change, and the scope toggle (global/project) and optional agent chips directly
above it. The command updates in place when scope or agents change.

### Chips

Mono, small, bordered; selected chips use `raised` with an amber dot, not an
amber fill.

### Navigation

Mono, minimal: catalog, workflows, the GitHub source, and a link back to
nickneely.dev using its ajar-door mark.

## Do's and Don'ts

Motion only ever confirms an action the reader took. Nothing moves because it
scrolled into view.

- Do: hover underline draw (about 120ms, amber), copy confirmation, hover
  highlight of a node's edges in the dependency graph, `focus-visible` rings,
  route view transitions (about 150ms).
- Don't: scroll-triggered fade-ups, typing effects, count-up numbers, gradient
  blobs or animated gradient text, cursor followers, card tilt, scroll
  hijacking, gratuitous blur, invented stats or social proof.
- Always: every animation behind `prefers-reduced-motion`, and no animation is
  load-bearing.

### The hero demo, the one ambient exception

The landing hero carries one looping faux-UI demo of `full-stop` working an
issue through to a PR that is ready to merge, built with Stageshow as a React
island. It is the only motion on the site the reader did not start, on the
main site's precedent of the cursor blink and the portal dither. It:

- lives in the hero and nowhere else;
- pauses when it is off screen or the tab is hidden;
- has a visible pause control, because it runs longer than five seconds;
- shows a static final frame under `prefers-reduced-motion`;
- never carries information the page does not also state in text.

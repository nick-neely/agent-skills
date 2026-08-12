---
name: ui-evidence
description: Capture, prepare, annotate, and publish reviewer-facing UI evidence as screenshots or GIFs in a GitHub pull request or issue. Use for before/after comparisons, static visual changes, interaction flows, animation or timing changes, drag and click behavior, annotated callouts, cropping, redaction, and requests such as "add screenshots to the PR", "show the interaction", or "attach visual evidence".
compatibility: Requires git, an authenticated gh CLI, agent-browser with Chrome, and ImageMagick. GIF evidence also requires FFmpeg and ffprobe.
---

# UI evidence

Turn a UI change into evidence a reviewer can understand in ten seconds.

This skill owns evidence selection, preparation, composition, confirmation, and
publishing. `agent-browser` owns browser state and raw capture. Replace
`<skill-root>` below with the directory containing this file.

## Check dependencies

```bash
node "<skill-root>/scripts/preflight.mjs"
node "<skill-root>/scripts/preflight.mjs" --motion
```

Use the first command for screenshots and the second when the plan includes a
GIF. Report missing dependencies and their install commands. Ask before
installing system packages, global npm modules, or Chrome.

## Scope the claims

Name each UI claim and the surface and state that proves it before capturing.
When the user names surfaces or states, capture exactly those.

Choose the smallest truthful medium:

| Evidence | Use it for |
| --- | --- |
| Screenshot | Layout, styling, copy, contrast, focus, persistent state, precise before/after |
| GIF | Order, transition, timing, click, drag, progressive disclosure, movement |
| Neither | A change with no useful visible proof |

A GIF proves one interaction claim. A screenshot proves one static claim. Do
not add media that merely decorates the description.

## Capture screenshots

Reuse an existing dev server when available.

```bash
agent-browser open <url>
agent-browser set viewport 1280 800
agent-browser screenshot ./after.png
```

Use `agent-browser get box <selector>` for exact element geometry. For a base
revision comparison, read [before-after.md](references/before-after.md). Before
and after captures must use the same viewport, device pixel ratio, route,
theme, scroll position, and seeded data.

## Capture motion

Read [motion.md](references/motion.md) before recording. It defines the
recording reset boundary, pointer contract, motion spec, size profiles,
redaction, and contact-sheet review.

Use direct `agent-browser` actions. Do not build a second action language.

```bash
EVIDENCE_SESSION="$(agent-browser session id --scope worktree --prefix ui-evidence)"
agent-browser --session "$EVIDENCE_SESSION" open <url>
agent-browser --session "$EVIDENCE_SESSION" set viewport 1280 800
agent-browser --session "$EVIDENCE_SESSION" record start ./raw.webm <url>
node "<skill-root>/scripts/pointer.mjs" install --session "$EVIDENCE_SESSION"
agent-browser --session "$EVIDENCE_SESSION" snapshot -i
agent-browser --session "$EVIDENCE_SESSION" batch --bail \
  "wait 800" "click #trigger" "wait 500" "drag #item #target" "wait 1000"
agent-browser --session "$EVIDENCE_SESSION" record stop
node "<skill-root>/scripts/pointer.mjs" remove --session "$EVIDENCE_SESSION"
```

Set the viewport and intended URL before recording. Do not run `open`, `reload`,
or `set viewport` after `record start`; the recorder is bound to the page target
created at start. Stop and discard the take if a full navigation is required.
Once selectors are known, prefer one `agent-browser batch --bail` invocation
for a planned multi-step claim. Separate CLI processes can add long idle gaps
between otherwise short actions. This remains direct `agent-browser` control.

Install the pointer by default for user-driven interaction. Skip it for passive
motion such as loading, automatic animation, or timing comparison. The pointer
is instrumented evidence, not a native operating-system cursor.

Prepare the GIF and its local review sheet:

```bash
node "<skill-root>/scripts/prepare-gif.mjs" \
  --spec motion.json \
  --out interaction.gif \
  --review-out interaction-review.png
```

## Locate and annotate static changes

```bash
node "<skill-root>/scripts/regions.mjs" before.png after.png
node "<skill-root>/scripts/annotate.mjs" --spec annotation.json --out annotated.png
```

Use changed regions to find static differences, then discard rendering noise,
timestamps, and animation frames. Regions do not apply to GIFs. Read
[annotation-spec.md](references/annotation-spec.md) for the full screenshot
annotation vocabulary.

Crop to the claim. Point instead of narrating. Let table headers and nearby
prose carry meaning. Redact names, emails, customer identifiers, avatars, and
organization names before upload.

## Compose the evidence

Use after-only motion by default. Add before/after GIFs only when their contrast
proves the claim. Put synchronized clips with matching dimensions side by side;
stack clips with different timing or geometry.

Give every GIF meaningful alt text and adjacent prose that names the action and
result. Add a final-state screenshot only when that state is independently
useful. Start with a soft budget of six visual assets and two GIFs. Exceed it
only when each additional asset proves a named claim, and collapse secondary
evidence.

Read [publishing.md](references/publishing.md) for layouts, managed blocks, and
upload behavior.

## Confirm

Show the composed Markdown, every publishable screenshot and GIF, and every GIF
review sheet. Review the complete GIF and the sampled frames. Flag possible
personal or customer data. Wait for an explicit yes before uploading anything.

Review sheets are local privacy aids. Never reference them in the published
section unless the user explicitly asks to publish one.

## Publish and verify

```bash
node "<skill-root>/scripts/publish.mjs" --target pr:123 --section section.md
node "<skill-root>/scripts/publish.mjs" --target issue:45 --section section.md --mode comment
```

Open the published pull request or issue and confirm every asset renders. The
work is complete when every scoped claim has evidence, the user approved the
exact section, and the published page displays it.

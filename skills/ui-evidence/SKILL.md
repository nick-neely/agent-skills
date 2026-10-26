---
name: ui-evidence
description: Capture, prepare, and publish screenshots or video that prove a UI change in a GitHub pull request or issue. Use for visual comparisons, interaction recordings, reviewer callouts, or requests to attach UI evidence.
compatibility: Requires Node.js. Capture uses agent-browser with Chrome; motion capture requires agent-browser 0.38.1+ and FFmpeg. Preparation uses FFmpeg, ffprobe, and ImageMagick. Publishing uses authenticated gh 2.99.0+ with repository push access.
---

# UI evidence

Show the reviewer what changed and how to inspect it. This skill owns evidence
selection, preparation, review, and publication. `agent-browser` owns browser
state, capture, pointer feedback, and direct interaction. Substitute this file's
directory for `<skill-root>`.

## Choose the evidence

Name the visible claims and the states that prove them. Cover the surfaces the
user requested. One coherent image or clip can prove related claims.

| Medium | Use |
| --- | --- |
| Screenshot | Layout, copy, focus, persistent state, precise before/after |
| MP4, default for motion | Interaction, drag, scrolling, transitions, loading; reviewers can pause and seek |
| GIF, opt-in | A tiny loop whose essential states and timing remain readable |
| Neither | No material visible difference; explain any visible claim left without evidence |

## Prepare the capture

Read the installed browser workflow with `agent-browser skills get core` before
using browser commands. Reuse a dev server after confirming it serves the
intended worktree, route, and fixture. Finish heavy builds or tests before a
motion take. Use sanitized fixture data.

Create one absolute directory outside the source tree for this run. Pass full
paths to the browser, whose daemon may have a different working directory.

```bash
EVIDENCE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ui-evidence.XXXXXX")"
export AGENT_BROWSER_SESSION="ui-evidence-$(basename "$EVIDENCE_DIR")"
node "<skill-root>/scripts/preflight.mjs"
```

Preflight checks only the selected operation: default screenshot capture,
`--motion`, `--prepare`, `--annotate`, or `--publish`. Use `--format gif` for GIF
preparation or WebM capture. Report missing tools and the suggested fix; ask
before system packages, global modules, browser downloads, or global upgrades
unless already authorized.

## Capture and prepare

For static evidence, wait for the intended state, fonts, and unrelated motion to
settle. Keep the animation under test intact. Suppress only known development
overlays. Capture enough context for the claim:

```bash
agent-browser open '<url>'
agent-browser set viewport 1280 800
agent-browser screenshot "$EVIDENCE_DIR/after.png"
```

Use selector screenshots for a simple element crop and `diff screenshot` for a
quick baseline comparison. For a base revision, read
[before-after.md](references/before-after.md). For changed-region geometry or
reviewer callouts, use `regions.mjs` and read
[annotation-spec.md](references/annotation-spec.md) before `annotate.mjs`.
Browser `--annotate` numbers interactive refs for diagnostics; it does not
replace reviewer callouts or redaction.

For any recording, read [motion.md](references/motion.md). It covers rehearsing
direct actions, structured batches, assertions, native cursor feedback, raw
inspection, MP4/GIF preparation, and final-output review. The supported recorder
captures the ready active page without resetting its context.

Crop to the claim and redact unrelated identifying data before upload. Keep
annotations purposeful. Add a final-state screenshot only when independently
useful. Start with a soft budget of six assets and two clips; preserve requested
coverage and collapse secondary evidence when more is needed.

## Review and publish

Review every final screenshot and the complete motion evidence with sampled
frames. State what the available tools actually let you inspect; a sheet or
frame count alone does not prove smooth motion or absence of a brief disclosure.
Re-record when moving sensitive content cannot be safely redacted. Local review
sheets and previews stay local unless explicitly requested as published evidence.

An invocation to attach evidence to a specified PR or issue authorizes capture,
preparation, uploads, and that target update. Use a destination already established
in the conversation without requesting approval again. Local preview requests
authorize preparation only. Ask only for a missing destination or a specific
sensitive disclosure decision that cannot be resolved by sanitizing the evidence.

Read [publishing.md](references/publishing.md) for supported markup, upload
behavior, managed blocks, and failure recovery. Name the GitHub repository
explicitly, even when publishing from a worktree:

```bash
node "<skill-root>/scripts/preflight.mjs" --publish
node "<skill-root>/scripts/publish.mjs" --repo owner/project \
  --target pr:123 --section "$EVIDENCE_DIR/section.md" --dry-run
node "<skill-root>/scripts/publish.mjs" --repo owner/project \
  --target pr:123 --section "$EVIDENCE_DIR/section.md"
```

Completion requires reviewed outputs and authenticated readback confirming every
intended hosted reference on the target. Saved references do not establish
browser rendering. Qualify a new video publishing path through real playback
when practical; signed-in browser inspection is not a routine publication gate.

If later commits change the captured UI, refresh the affected assets and replace
the managed block. Record the captured revision and dirty state in local notes
or motion provenance when useful. Leave unaffected evidence intact.

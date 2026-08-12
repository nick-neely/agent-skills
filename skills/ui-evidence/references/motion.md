# Motion evidence

Prepare one short, deterministic interaction that proves one claim.

## Contents

- [Recording boundary](#recording-boundary)
- [Pointer instrumentation](#pointer-instrumentation)
- [Capture sequence](#capture-sequence)
- [Motion spec](#motion-spec)
- [Size and duration](#size-and-duration)
- [Privacy review](#privacy-review)
- [Before and after](#before-and-after)

## Recording boundary

`agent-browser record start` creates a fresh browser context. Treat it as a
runtime reset:

- The URL, viewport, and cookies normally survive.
- Element references are stale and must be rediscovered.
- Set the final viewport before recording.
- Pass the intended URL to `record start` when navigation is required.
- Prepare an initial route or sanitized fixture that does not depend on
  pre-recording local storage or session storage.
- Assume local storage and session storage were cleared. This has occurred in
  released `agent-browser` versions even when their help text claimed otherwise.

The recorder captures a fixed page target. Do not run `open`, `reload`, or
`set viewport` after `record start`; released versions can then produce a
one-frame file or hang at `record stop`. Stop and discard the take if a full
navigation or viewport change is required. Restore permitted state through
cookies, the initial URL, or in-page actions that do not navigate.

Record setup and readiness waits, then trim them out. This is more reliable
than trying to make pre-recording page state cross the context boundary
invisibly.

## Pointer instrumentation

`agent-browser` video does not include a native cursor or click feedback. The
pointer script injects a fixed, non-interactive overlay into the page:

```bash
node "<skill-root>/scripts/pointer.mjs" install --session "$EVIDENCE_SESSION"
node "<skill-root>/scripts/pointer.mjs" status --session "$EVIDENCE_SESSION"
node "<skill-root>/scripts/pointer.mjs" remove --session "$EVIDENCE_SESSION"
```

Install it after `record start`, then run `status`. A reload or full navigation
invalidates both the pointer and the recording target, so stop and discard that
take. If status fails, repair the capture instead of silently producing
cursorless evidence.

The pointer follows click-by-reference, hover, mouse movement, and
`agent-browser drag`. Its `dragover` tracking keeps the pointer visible after
HTML drag starts. Scrolling leaves it at the current viewport coordinate while
the page moves underneath, matching normal pointer behavior.

The install report lists `blockedFrames`. Same-origin iframes receive their own
overlay. Cross-origin iframe input cannot be observed from the parent document;
capture that frame at its own origin or state clearly that pointer feedback is
unavailable inside it.

The pointer is evidence instrumentation. It does not prove the appearance of a
native cursor. A change to the CSS `cursor` value needs separate computed-style
evidence or a native recording outside this skill's v1 boundary.

## Capture sequence

1. Explore the page and plan one interaction.
2. Set the final viewport.
3. Start the WebM recording, passing the intended URL when needed.
4. Wait for the initial state without a full navigation or viewport reset.
5. Install the pointer unless the motion is passive.
6. Take a fresh snapshot and reacquire references.
7. Hold the stable initial state briefly.
8. Perform one interaction using direct `agent-browser` commands, batching a
   planned sequence when it has multiple steps.
9. Hold the stable result briefly.
10. Stop recording, then remove the pointer.
11. Write the motion spec and prepare the GIF.

Prefer an app-specific ready signal over a fixed wait. The short holds belong in
the prepared output as well, so GIF looping remains readable.

Use one batch after the necessary selectors are known:

```bash
agent-browser --session "$EVIDENCE_SESSION" batch --bail \
  "wait 800" "click #reveal" "wait 500" "drag #item #target" "wait 1000"
```

Commands used to install and verify instrumentation can make the raw recording
look much longer than the interaction. Trim that setup away. Avoid snapshots,
geometry reads, and other diagnostic calls between visible actions; each
separate CLI process can create reviewer-visible dead air.

## Motion spec

Coordinates refer to the original WebM frame. Cropping translates fixed
redaction rectangles automatically.

```json
{
  "input": "raw.webm",
  "trim": { "start": 1.4, "end": 6.7 },
  "crop": { "x": 180, "y": 80, "width": 820, "height": 520 },
  "holds": { "start": 0.5, "end": 1 },
  "redactions": [
    { "at": [940, 24, 180, 32], "color": "#111827" }
  ],
  "profile": {
    "maxWidth": 720,
    "fps": 12,
    "targetBytes": 5242880,
    "maxBytes": 10485760
  },
  "limits": { "maxDuration": 8 },
  "review": { "interval": 0.5 }
}
```

| Field | Meaning |
| --- | --- |
| `input` | WebM path, relative to the spec or absolute |
| `trim` | Action bounds in source seconds; never inferred or shortened automatically |
| `crop` | Optional original-frame rectangle |
| `holds` | Cloned first and final frame durations |
| `redactions` | Opaque fixed rectangles, applied to every frame |
| `profile` | Initial width/FPS and target/hard byte limits |
| `limits.maxDuration` | Prepared duration ceiling; defaults to 8 seconds; allowed range is 1 to 12 |
| `review.interval` | Contact-sheet sampling interval; defaults to 0.5 seconds |

## Size and duration

The default profile is 720px, 12 fps, a 5 MiB target, and GitHub's 10 MiB hard
ceiling. The preparation script steps down through bounded profiles, never
below 640px or 8 fps unless the source itself is narrower. It reports every
attempt and the selected profile.

Keep reviewer-facing GIFs at or below the 8-second default. The 12-second hard
configuration maximum exists for unusual evidence, not as the normal target.
Split a longer claim when the essential action cannot be made readable within
that range.

The script never shortens the interaction. If the prepared duration exceeds the
limit, tighten the explicit trim. If every bounded profile exceeds 10 MiB,
reduce the crop or split the claim into a shorter interaction.

## Privacy review

Use sanitized fixture data first. Use an opaque fixed redaction when a sensitive
region stays put. Re-record when sensitive content moves, scrolls, animates, or
appears in an unpredictable region.

`prepare-gif.mjs` produces a local contact sheet containing the first frame,
the last frame, and samples every 500ms by default. Watch the full GIF and read
the sheet. A sampled sheet can miss a very brief frame, so it supplements the
animation review rather than replacing it.

Keep the contact sheet local. Publish it only when it is itself useful evidence
and the user explicitly approves it.

## Before and after

Use one after GIF when it fully demonstrates the corrected behavior. Capture a
before GIF only when the behavioral contrast is the claim.

Put matching, synchronized clips side by side. Stack clips whose timing,
geometry, or duration differs. Do not force two animations into one combined
file unless the transition between them is explicit and easy to understand.

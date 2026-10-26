# Motion evidence

```bash
node "<skill-root>/scripts/preflight.mjs" --motion
```

Motion capture needs agent-browser 0.38.1+ and FFmpeg. Preparation additionally
needs ffprobe and ImageMagick. Use MP4 for controlled playback; GIF is an opt-in
loop. Neither a format change nor duplicated frames restores motion the recorder
missed.

## Rehearse before recording

Use the run's isolated session and absolute evidence directory from `SKILL.md`.
Open the intended page, set its final viewport, authenticate through supported
browser controls, seed sanitized data, and wait for an app-specific ready signal.
Discover selectors and rehearse the claim before starting the take.

With the supported recorder, `record start` without a URL records the active
page in place, including in-page state. Supplying a URL navigates first. Older
releases reset browser context and could lose storage or the recording target;
upgrade to the supported baseline instead of applying those workarounds to every
take. Keep the intended tab and viewport stable during capture. A navigation
that belongs to the flow is legitimate; assert its result and inspect the take.

## Record direct browser actions

```bash
agent-browser record start "$EVIDENCE_DIR/raw.mp4" --fps 30 --cursor --contact-sheet
agent-browser batch --bail <<'JSON'
[
  ["wait", "600"],
  ["click", "fieldset label:nth-child(2)"],
  ["wait", "--fn", "document.querySelector('#yearly').checked"],
  ["eval", "(() => { if (!document.querySelector('#yearly').checked) throw new Error('Yearly did not activate'); return true; })()"],
  ["wait", "1200"]
]
JSON
agent-browser record stop --json
```

Replace the sample selector and assertion with the actual claim. Use JSON arrays
of arguments so selectors containing spaces and quoted text survive parsing.
This is the browser's batch interface, not a new action language. A successful
click command alone does not prove the UI changed. Accept the take only after
an assertion or inspected snapshot confirms the expected state.

Use state-based waits for readiness and explicit short holds for human reading.
Avoid diagnostic calls between planned visible actions; separate processes add
dead air. Stop the take even when a batch fails, then inspect or re-record it.
Close only the session this run owns when finished.

Use 30 fps normally and 60 fps for a short motion-sensitive claim when capture
can sustain it. `record stop` reports written frames and distinct captured frames.
Static content legitimately has few distinct frames; counts alone do not prove
smoothness. Native `--cursor` is an injected pointer/click overlay, not an OS
cursor. Skip it for passive motion. Use native human-like input only when pointer
trajectory matters. Check pointer behavior in the actual take, including frames
or navigation involved in the claim.

## Inspect the raw take

```bash
node "<skill-root>/scripts/preflight.mjs" --prepare
node "<skill-root>/scripts/prepare-motion.mjs" \
  --inspect "$EVIDENCE_DIR/raw.mp4" \
  --review-out "$EVIDENCE_DIR/raw-review.png" \
  --preview-out "$EVIDENCE_DIR/raw-review.html"
```

Use the timestamped sheet and local player to locate action bounds before
writing the spec. Raw sheets/previews can contain material later redacted; keep
them local. Native contact sheets select visual changes with a threshold and a
frame cap, so they do not replace final-output sampling or complete review.

## Prepare the final output

Write `motion.json` in the evidence directory. Coordinates refer to source
pixels; cropping translates fixed redactions. Example:

```json
{
  "input": "raw.mp4",
  "trim": { "start": 1.4, "end": 10.7 },
  "crop": { "x": 180, "y": 80, "width": 820, "height": 520 },
  "holds": { "start": 0.5, "end": 1 },
  "redactions": [{ "at": [940, 24, 180, 32], "color": "#111827" }],
  "profile": { "maxWidth": 1280, "fps": 30, "maxBytes": 9500000 },
  "review": { "interval": 0.5 },
  "provenance": { "revision": "<captured-head>", "dirty": false }
}
```

```bash
node "<skill-root>/scripts/prepare-motion.mjs" \
  --spec "$EVIDENCE_DIR/motion.json" \
  --out "$EVIDENCE_DIR/interaction.mp4" \
  --review-out "$EVIDENCE_DIR/interaction-review.png" \
  --preview-out "$EVIDENCE_DIR/interaction-review.html"
```

MP4 output uses H.264, a browser-compatible pixel format, even dimensions,
fast-start metadata, and video only. GIF output is selected by an `.gif` output
path; run preflight with `--prepare --format gif`. Its palette and frame timing
must preserve essential initial, intermediate, and final states.

| Spec field | Meaning |
| --- | --- |
| `input` | Source path, absolute or relative to the spec |
| `trim` | Explicit source-time bounds; normalization preserves sparse held states |
| `crop` | Optional source-frame rectangle |
| `holds` | Additional cloned initial/final reading time |
| `redactions` | Opaque fixed rectangles on every output frame |
| `profile` | Explicit width, frame rate, and byte limits; see CLI help for format defaults |
| `limits.maxDuration` | Optional user-chosen ceiling, not a universal duration policy |
| `review.interval` | Final-output sampling interval, normally 0.5 seconds |
| `provenance` | Optional local capture revision/state metadata |

## Preserve truth and readability

Keep each clip focused, often 5-20 seconds. Let the claim determine its length;
prefer a readable longer take over rushing an essential action. Retain real
response time when timing or loading is the claim. Remove setup or accidental
tool gaps only when irrelevant to that claim. Label cuts or slow motion in an
explanatory walkthrough. Preparation does not infer cuts or speed changes.

Use a tighter crop or explicit encoding settings before sacrificing readable
text or motion. Oversized MP4 output fails with guidance rather than silently
lowering FPS, shrinking the image, or shortening the action. The default byte
ceiling leaves headroom under GitHub's decimal 10 MB free-plan limit. A higher
explicit ceiling requires verified paid-plan upload eligibility.

Inspect the prepared output, its sampled first/intermediate/final states, and
its reported duration. A source with missing frames must be re-recorded for a
motion claim. A one-frame privacy flash can fall between samples. Use sanitized
fixtures, inspect the full motion with suitable tools, and accurately report
any review limitation. Fixed redactions are for stationary regions; re-record
moving or unpredictable sensitive content.

Default to after-only motion. Capture before motion when the behavioral contrast
is useful, with matched geometry and data. Stack independent videos with clear
labels so the reviewer controls each one. Put the action and result in nearby
prose. Keep review sheets and previews local.

Upstream: [recording](https://agent-browser.dev/recording),
[version boundaries](https://github.com/vercel-labs/agent-browser/blob/main/CHANGELOG.md).

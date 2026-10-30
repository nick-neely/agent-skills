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
Keep session and namespace names short enough for the OS socket-path limit.
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

MP4 output uses H.264 at CRF 18, a browser-compatible pixel format, even dimensions,
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
| `annotations` | Optional timed step numbers, captions, and key indicators; see below |
| `storyboard` | Optional labelled checkpoints; needs `--storyboard-out` |
| `title`, `summary` | Optional heading and prose for `--markdown-out` |

Output timing is quantized to the chosen frame rate. Initial and final holds
use the actual source states at the trim boundaries, before resampling. A trim
too short to represent those states fails with guidance to widen it or raise
the frame rate.

## Explain the action and result

Add timed annotations when a reviewer needs to know which action happened and
what it proved, such as a step sequence or a short explanatory clip. All times
are seconds on the source recording, the same timeline as `trim` and the
`--inspect` sheet. Read the action and result times from that sheet.

```json
{
  "input": "raw.mp4",
  "trim": { "start": 0.4, "end": 4.6 },
  "holds": { "start": 0.5, "end": 1.5 },
  "title": "Yearly pricing persists",
  "summary": "Choosing Yearly with the keyboard shows the yearly price, and the choice survives a reload.",
  "annotations": {
    "events": [
      { "start": 0.9, "end": 1.6, "step": 1, "key": "ArrowRight", "caption": "Move the plan choice to Yearly", "at": [152, 126, 80, 35], "hold": 1.5 },
      { "start": 1.6, "end": 2.8, "step": 2, "caption": "The price changes to $120 / year", "at": [58, 172, 190, 46], "hold": 1.5 },
      { "start": 2.8, "end": 3.4, "caption": "The page reloads" },
      { "start": 3.4, "end": 99, "step": 3, "caption": "Yearly is still selected after the reload", "at": [152, 126, 80, 35] }
    ]
  },
  "storyboard": {
    "checkpoints": [
      { "at": 0.6, "label": "Monthly is selected: $12 / month" },
      { "at": 2.0, "label": "Yearly is selected: $120 / year" },
      { "at": 4.4, "label": "After the reload, Yearly is still selected" }
    ]
  }
}
```

```bash
node "<skill-root>/scripts/preflight.mjs" --prepare --annotations
node "<skill-root>/scripts/prepare-motion.mjs" \
  --spec "$EVIDENCE_DIR/motion.json" \
  --out "$EVIDENCE_DIR/interaction.mp4" \
  --review-out "$EVIDENCE_DIR/interaction-review.png" \
  --storyboard-out "$EVIDENCE_DIR/storyboard.png" \
  --markdown-out "$EVIDENCE_DIR/section.md"
```

| Event field | Meaning |
| --- | --- |
| `start`, `end` | Source seconds; the event shows on every output frame whose source instant is in `[start, end)` |
| `step` | Number 1-99 drawn as a pin; its colour is shared by the outline and the caption |
| `caption` | Up to 160 characters stating what the recording shows; wrapped, at most three lines |
| `key` | Keys actually pressed, joined by `+`, such as `Control+K`; drawn as keycaps |
| `at` | `[x, y, width, height]` source rectangle around the control; outlined just outside it |
| `hold` | Optional 0.2-10 seconds of added reading time; freezes the event's first frame |

Each event needs at least one of `step`, `caption`, `key`, or `at`. A step without `at` shows its pin in
the caption area. An outline without a step uses a neutral grey, so it is never
read as a numbered step.

| Annotation option | Meaning |
| --- | --- |
| `captions` | `below` (default) adds a caption band under the video so the UI stays visible; `overlay` draws captions over the bottom of the frame and is refused when that area would cover an outlined control |
| `displayWidth` | Width the clip is read at, default 880 (a GitHub PR body); sizes text and pins |

Time maps to the output like this:

- The start hold shows the source at `trim.start`, so an event active then
  covers the start hold.
- The end hold shows the source just before `trim.end`, so an event active
  then covers the end hold. Set `end` beyond the trim to keep the final caption
  on screen through the end hold.
- Between the holds, output time is source time minus `trim.start` plus the
  start hold, quantized to the frame rate.
- Coordinates follow the crop and scale. A region partly outside the crop is
  clipped; the event reports `regionClipped` and the result adds a warning.

Preparation validates every event before encoding. An event outside the trim,
an end that does not follow its start, geometry outside the source or crop, a
caption too long to read at the display width, and two captions on the same
frame each fail with the field to fix. The report's `annotations.events` gives
each event's output frames and times and says whether it was clipped or covers
a hold. `timeline` lists each real-time segment and each `presentation-hold`
with the source instant it shows.

Steps that follow each other quickly are hard to read in real time. Give such
an event a `hold` to freeze its first frame for that many seconds, with its
annotations on screen. A held frame shows a "Paused for reading" badge in the
caption area, `timeline` lists it as an `inserted` presentation hold at its
source instant, and the generated Markdown says so. Everything else keeps its
real timing; preparation never changes speed. Do not add holds when timing,
loading, latency, or animation is the claim. Two holds cannot freeze the same
frame, and a hold needs its event to start inside the trim.

Captions state what you verified with an assertion or by inspecting the take.
Do not caption an outcome the recording does not show. Use `key` only for keys
the take actually pressed, such as `["press", "ArrowRight"]` in the batch. Keep
native `--cursor` feedback for pointer actions rather than drawing a pointer.

The storyboard is an opt-in reviewer image. Use it when a few still moments
explain the claim alongside the MP4. Each checkpoint is a source time and a
label of up to 160 characters, in increasing order, with at most eight
checkpoints. Panels are extracted from the final prepared output, so they carry
its redactions and annotations. `storyboard.displayWidth` defaults to
`annotations.displayWidth`, or 880, and the image is drawn at twice that width.
Columns default to what keeps each panel readable, and `storyboard.columns`
(1-4) overrides that. The report lists each checkpoint's frame, output time,
source time, and panel geometry.

`--markdown-out` writes a publisher-compatible section: the optional `title`
and `summary`, the standalone video, the timed steps, and the storyboard with
its numbered labels. It must sit in a directory that contains the video and
storyboard; paths with spaces are written in the `<path>` form the publisher
accepts. A GIF gets descriptive alt text from `summary` or `title`. Review
sheets and previews are never referenced. Inspect the
complete clip, frames around each annotation boundary, and the storyboard at
the display width before publishing.

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

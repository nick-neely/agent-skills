# Run folder and evidence

## Create the run

Run once per UAT run, after discovery and before any browser launch:

```text
node "<skill-root>/scripts/new-run.mjs" --label "<ticket-or-feature>" --mode persistent|fresh|headless --project "<project>" [--target "<url>"] [--output "<absolute-dir>"]
```

- Runs live under `~/.uat/runs/<project>/`, outside every repository, so they persist for retests and later planning without touching the tested project.
- `--project` groups a project's runs: pass the tested repository's folder name (or another stable name for the app), the same on every run. Omitted, runs go to `general`.
- `--output` is only for an output location the user explicitly asked for.
- `--target` is required for persistent mode; see [profiles](profiles.md).

In headless mode, `auth-state.json` is temporary private runtime state, never evidence. Before copying or sharing a run, verify this file is absent; finish and interruption cleanup follow [headless runs](authentication.md#headless-runs).

The script creates a new, uniquely named run folder containing `report.md` (run details prefilled), `browser-config.json` and `run.json`, and prints the same JSON. Every later browser call passes this folder to `ab`. Exit code 1 means a decision is needed: relay its `decision` to the operator.

## Organize evidence

Create only the folders the run uses, with stable scenario and finding IDs in descriptive names:

```text
~/.uat/runs/<project>/<timestamp>-<label>-<suffix>/
  report.md
  browser-config.json
  run.json
  screenshots/S03-narrow-validation.png
  findings/F01-stale-validation/repro.mp4
  findings/F01-stale-validation/repro-contact-sheet.png
  findings/F01-stale-validation/error-state.png
```

Request method, status, timing, sanitized URLs and relevant excerpts of failing responses can be useful evidence. Before saving or sharing them, remove credentials, tokens and private records, including secrets in URL paths or query strings and response bodies; omit content that cannot be safely redacted. Request headers, cookies and full HAR captures stay out.

Link evidence relative to `report.md` so the folder stays readable when copied, using the filenames the CLI actually wrote. A retest links its original report and finding IDs, relatively when possible; across Windows drives use an absolute path and note that both run folders must travel together.

Capture only content appropriate to the test data, and review all evidence for unintended private content before handoff. If a shareable copy needs redaction, keep the raw evidence private and label the copy as redacted. Publishing or uploading a run needs separate authorization.

## Record an interactive reproduction

Prefer a short clip of a reproduction that is safe to repeat, plus still images of key states; a static visual issue needs only a screenshot. When an issue will not reproduce, keep the initial observation. Reproductions stay within data ownership, readback and transaction limits; an uncertain transaction is never replayed for a cleaner clip.

Check the installed recording reference or help for version-specific flags, then record the current page in place (adding a URL navigates away):

```bash
ab record start "ABSOLUTE_FINDING_PATH/repro.mp4" --cursor --contact-sheet
# Perform the reproduction at a readable pace.
ab record stop
```

- Frame the result before starting: the elements that prove the outcome (totals, counts, messages, toasts) must be visible in the viewport or scrolled into view during the clip.
- Always pass `--cursor` and `--contact-sheet`: the cursor shows reviewers where each click lands, and the contact sheet gives a timestamped overview without playback. Drop a flag only if the installed CLI rejects it, and note that in the report.
- MP4 plays most easily. Check every clip with `ffprobe` (or the host's player) right after `record stop`; if it is unreadable, re-record as WebM, and for clips longer than about 20 seconds add `--fps 10`. Raise the frame rate only when motion is the finding. If recording reports encoder lag, try a lower `--fps` for the next safe short reproduction and record the chosen rate and limitation; keep screenshots/steps if video remains unavailable. A low-rate clip does not verify animation smoothness.
- Stop recording before closing the browser or changing its lifetime, before sign-in, MFA or callback processing, and resume with a new clip afterwards if useful.
- Verify the file exists, and inspect the clip, key frames or contact sheet when the host can; an existing `ffprobe` can confirm container and duration. Screenshots taken while recording include the cursor overlay, so take visual-assessment screenshots after `record stop`.
- Recording needs `ffmpeg` on PATH. Install it only when a clip is useful, through the existing approved package manager or the [official download](https://ffmpeg.org/download.html), with native Windows tools on Windows and Linux tools inside WSL. When recording is unavailable or repair would stall the run, use screenshots and numbered steps and record the limitation.

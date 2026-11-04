# Persistent mode: one keep-alive session per target

Persistent mode keeps one browser per target, headed by default, running between runs so a sign-in lasts across UAT runs instead of across browser restarts. Restarting does not preserve sign-in for apps that keep OIDC tokens in session storage behind an identity provider whose login cookie ends with the browser; a running browser keeps both, and the app's own token renewal keeps the login fresh.

`new-run.mjs --mode persistent --target <url>` prepares it and reports:

- `session`: the stable session name, `uat-<target-digest>`. Use it for every browser call in persistent mode.
- `profile.state`:
  - **created** or **existing**: proceed.
  - **unverified** (directory exists without the marker): leave it untouched and ask the operator whether it is dedicated UAT storage with private access. If confirmed, record the answer in the report and proceed; otherwise use fresh mode. A failed Windows permission setup leaves the new directory unmarked and stops creation; resolve its permissions or use fresh mode before using it.
- `profile.inUse`: true while the keep-alive browser is running, which is expected.

The generated config is headed by default, uses the profile under `~/.uat/profiles/<target-key>/` and sets `idleTimeout` to `"0"` so the browser stays up between runs. Pass `--role <name>` only when the run needs a distinct identity; it selects a separate profile and session. Record `session`, `profile.relative` and whether the session was reused or launched in the report.

Target keys include a digest of the origin and exact role; browser session names use only that digest to leave room for Unix socket paths, so hostnames, ports and role names cannot merge through slug formatting. Keys from the earlier slug-only format are left untouched; the first run with the new format creates a separate profile and needs sign-in.

## Attach or launch

Make every call through `ab` with this run's folder, including when reusing a running browser. A call whose launch settings differ from the running browser's (for example a direct `agent-browser` call without the run config) silently relaunches it, losing the open tab and the sign-in. A new run reattaches when its launch settings match. Switching headed and headless mode changes those settings, restarts the browser and may require sign-in. After an agent-browser upgrade, the first call restarts the keep-alive browser ("Daemon version mismatch"), so expect one sign-in.

1. Run `ab session info --json`. `data.active: true` means the keep-alive browser is running: record **reused**. If the call fails or `data.active` is not a boolean, diagnose the failure and retry; if the state remains unknown, report it and leave the session alone. When `data.active` is false, continue the launch checks; `session list` can show stale entries, so rely on `active`.
2. Launch only when not active and `profile.inUse` is exactly false. If it is true or unknown, report the conflict or unclear lock state and leave that profile alone.
3. Open the target: `ab open "<target-url>"`; after a successful new launch, record **launched**. When reusing, `ab tab new "<target-url>"` keeps the existing app tab.
4. Verify identity, role, environment and an authenticated page before any mutation. If the app shows its sign-in page, the operator signs in per [app sign-in](authentication.md#app-sign-in) in that window, then verify again.

Headed sign-in needs operator interaction to be permitted and a visible window. If headed use is forbidden or unavailable, report the access decision and continue planning. An explicit headless request uses `--headless` and accepts that an expired sign-in blocks the run.

## During and after the run

Run one UAT at a time per session. Reset only authorized feature and test-data state to the scenario baseline, and record what was reused (signed-in identity, cart contents, open tabs). Scenarios about login, onboarding or a clean state use fresh mode.

When finished, stop any recording and leave the session running with the app loaded, so the next run reuses the sign-in. Close extra tabs you opened. Tell the operator the session is still open and how to end it: `agent-browser --session <reported-session> close` (closing needs no config). Sign-out, profile reset or closing at the end of the run need an explicit request.

## Expired sign-in mid-run

Pause the affected test and keep its evidence. If an uncertain mutation needs readback, let the operator sign in again in the same window, return to a neutral app route (never replay the transaction), and perform readback before any retry; if readback is impossible, report that blocker. If the window or browser was closed, launch again per step 3. The profile, token handling, TLS and policy settings and the target stay as they are.

## Local dashboard

Start the CLI's local dashboard only when the operator asks for it or their session instructions enable it; reuse a running one, normally at `http://localhost:4848`, and point it at this run's session. Keep it on loopback and keep its URL and tokens private. If its port or settings conflict with another session, leave that process running and report the conflict. If visual supervision was required and the dashboard is unavailable, use the headed browser or report the blocker.

The dashboard shows live app data and accepts input. Before the operator takes over through it, pause and acknowledge; resume after an explicit handback. Pause observation during credential entry. Login state is verified through the app, not the dashboard's storage or cookie views.

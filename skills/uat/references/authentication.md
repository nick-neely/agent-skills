# Authentication and the owned browser

Two sign-ins stay separate: developer startup SSO happens in the operator's normal browser, and app sign-in happens in the owned browser.

## App readiness and startup SSO

Reuse a suitable running local app or the selected deployed environment. If the intended local app is not running, start it with the repository's documented development workflow and existing configuration; read setup instructions only as far as startup needs (they are not the oracle). Leave existing services and port owners running. Verify the URL serves the intended app and record its build or unknown, plus the startup command, process handle, log location and whether you leave it running. Follow existing cleanup instructions for a server you started.

When startup needs developer sign-in (for example to a secrets vault or cloud account), let the normal development process open the operator's normal browser, or ask the operator to complete that flow. Credentials, vault secrets and tokens stay with the operator and that browser. Pause the dependent work, continue requirements work, and resume after the operator confirms and the app responds. If startup cannot proceed without source or config changes, unknown credentials or an unavailable dependency, report that blocker. A runtime credential that expires mid-run takes the same path, followed by readback of any uncertain mutation.

## Choose a browser mode

- **persistent** (default for recurring feature checks): one headed keep-alive browser per target, using the operator's dedicated profile and left running between runs so the sign-in carries over. Follow [profiles](profiles.md).
- **fresh**: a new headed browser with temporary storage, closed after the run. Use when requested, when scenarios test login, logout, onboarding or a first visit, or when persistence conflicts with an effective restriction (below).

Honor an explicit mode. If persistent is incompatible, explain why and use fresh for the same target; if persistence was explicitly required, report that decision instead. Record the mode and observed app role.

## Configure the owned browser

`new-run.mjs` writes `browser-config.json` (`autoConnect: false`, the headed setting and, for persistent, the profile path) and `run.json` with the session name. Make every browser call through `ab`: it passes this run's config and session, and removes inherited mode overrides from that call only. A session keeps the settings it launched with, and a direct `agent-browser` call with different launch settings (such as one without the run config) silently relaunches it, losing tabs and sign-in.

- **Carry restrictions forward.** Add the operator's and organization's effective domain and action restrictions and approved proxy and CA settings to the config. Credential-bearing proxy, header or config values stay in their existing private mechanism, outside the run folder.
- **Check compatibility before launch.** In researched CLI versions, `--profile` cannot combine with `--allowed-domains` or a browser `--ca-cert`. Keep those controls and choose fresh. Check installed help when unsure.
- **Inherited overrides.** Environment variables take precedence over the config file. The checker's `envOverrides` names any inherited mode overrides for the report; `ab` removes them from each call and keeps approved settings such as `AGENT_BROWSER_EXECUTABLE_PATH` and display, proxy, CA and domain settings. If a required control cannot be separated from launch overrides, report that before launching. These steps keep the agent off the operator's browser; they are not an OS sandbox, and the agent still acts with the signed-in account's permissions.

## App sign-in

Use a visible window the operator controls. While the operator enters credentials and MFA and the callback completes, pause all agent browser activity: no screenshots, recording, snapshots, console or network inspection. Resume when the operator confirms the intended test account is signed in, then verify the visible identity, role and app access before any mutation. Account creation, new terms and permission changes stay with the operator.

If an IdP popup was used, return to the app tab in this browser. WSL and Linux need a genuinely visible display such as WSLg; Xvfb is not visible to a person. Keep domain allowlists in place during redirects; if an IdP, callback or API origin is blocked, ask for that specific policy decision unless it was already authorized.

A correct profile path or successful launch does not prove sign-in works; only an authenticated page does. Record mode, role, login assistance and restrictions, without secrets.

## Hard limits

Both modes exclude: `--cdp`, `connect`, `--auto-connect`, personal or work Chrome profiles and copies of them, cookie import, saved-state export, `--state` and `--restore`. Never attach to the operator's ordinary browser. Follow existing TLS, identity-provider and corporate policy as configured: OAuth registrations, TLS verification (including `--ignore-https-errors`) and browser security settings stay as they are.

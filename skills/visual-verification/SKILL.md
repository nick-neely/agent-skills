---
name: visual-verification
description: Capture, inspect, and validate rendered local app UI with headless Chrome screenshots. Use when Codex needs to verify frontend changes, compare light/dark or responsive states, inspect authenticated local pages, capture hover/dropdown/focus states, diagnose visual regressions, or create a repo-local screenshot/auth workflow for agents.
---

# Visual Verification

Use this skill to turn UI claims into screenshot evidence. The goal is a local-agent workflow: discover or create repo config, capture the rendered state, inspect the PNG, and iterate until the UI is actually verified.

In commands below, replace `<skill-root>` with the installed directory containing this `SKILL.md`.

## First Use

1. Look for `.agents/visual-verification.json`.
2. If missing, run:

```bash
node "<skill-root>/scripts/detect-project.mjs"
node "<skill-root>/scripts/init-config.mjs"
```

3. Run browser setup checks when Chrome/headless-shell availability is unknown:

```bash
node "<skill-root>/scripts/ensure-browser.mjs" --smoke
```

Use `--install --smoke` if no browser is found.
4. Read `references/first-use.md` when config is missing, stale, or the repo needs auth setup.
5. Prefer existing repo commands over generated helpers, but do not assume a command name.
6. When protected pages need auth, read `references/auth-adapters.md` before adding or changing auth setup.

The user does not need to hand-author the config. Agents may create it automatically after inspecting the repo.

## Screenshot Workflow

1. Reuse an existing dev server when one is running; start the configured dev server only when needed.
2. Run the screenshot script from the repo root:

```bash
node "<skill-root>/scripts/screenshot.mjs" <url> [options]
```

3. For UI work, capture the relevant states rather than one resting viewport:
   - light and dark modes when the app supports themes
   - desktop and mobile/tablet when layout changes are relevant
   - hover, dropdown, focus, open modal, and scrolled states when those are the changed surfaces
4. Open/read the PNG before concluding. A successful command is not enough.
5. If the command fails on a selector, expectation, console error, or network error, treat that as a useful verification failure and fix the underlying issue or the selector.

Read `references/screenshot-recipes.md` for command examples.

## Auth Boundary

The skill owns browser control and visual verification. The repo owns auth mutation.

Supported auth modes in config:

- `none`: public pages only.
- `storage-state`: use an existing Playwright storage state; never refresh it.
- `command`: run a repo-owned command that writes a Playwright storage state.
- `custom-cookie`: a repo-owned command creates cookie/storage-state data.
- `playwright-login`: a repo-owned Playwright script logs in and writes storage state.

For Better Auth, keep setup local-only and fail closed: refuse remote DB URLs, require `BETTER_AUTH_SECRET`, create an obvious agent user, grant only local verification permissions, and write `.auth/agent-admin-storage-state.json` with restrictive file permissions.

## Scripts

- `scripts/screenshot.mjs`: plain-Node CDP screenshot runner.
- `scripts/detect-project.mjs`: inspect package scripts, routes, and auth signals.
- `scripts/init-config.mjs`: write `.agents/visual-verification.json`.
- `scripts/ensure-browser.mjs`: verify or install the Chrome/headless-shell runtime.
- `scripts/ensure-auth.mjs`: refresh configured auth storage state without capturing.

## References

- `references/first-use.md`: config discovery and initialization flow.
- `references/screenshot-recipes.md`: common screenshot commands.
- `references/auth-adapters.md`: auth adapter patterns and safety rules.
- `references/troubleshooting.md`: known failure modes.

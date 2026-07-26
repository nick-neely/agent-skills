# Troubleshooting

Replace `<skill-root>` with the installed directory containing the skill's `SKILL.md`.

## No Chrome Found

The screenshot runner does not need Playwright or Puppeteer as runtime libraries. It needs Node 18+ and a Chrome-compatible browser that can be controlled through the Chrome DevTools Protocol.

First run:

```bash
node "<skill-root>/scripts/ensure-browser.mjs" --smoke
```

If no browser is found, install a dedicated headless shell:

```bash
node "<skill-root>/scripts/ensure-browser.mjs" --install --smoke
```

Manual alternatives:

```bash
npx --yes @puppeteer/browsers install chrome-headless-shell@stable
```

Or set `CHROME_PATH` / `PUPPETEER_EXECUTABLE_PATH`.

## Playwright Clarification

Playwright is not required for screenshots. The skill uses Playwright's storage-state JSON shape for auth because it is a convenient cookie format, but the browser automation itself is plain Node plus Chrome DevTools Protocol.

Use a Playwright login adapter only when the safest auth setup is logging in through the real UI.

## Dev Server Hangs

Do not use Chrome's one-shot `--screenshot` or `--virtual-time-budget` against dev servers. This runner waits through CDP and avoids the HMR virtual-time trap.

## Selector Fails

Selector, expectation, and clip failures are real verification signals. Fix the selector only after confirming the UI state is actually present.

For repeated rows, use `--match <index>` or action syntax such as:

```bash
--action 'click[2]:button'
```

## Hover UI Missing

Increase `--hover-settle`. Radix and similar overlays may have open delays or mount animations.

## Auth State Missing Or Expired

Run:

```bash
node "<skill-root>/scripts/ensure-auth.mjs"
```

Then retry the screenshot. If refresh fails, check the repo-owned `auth.refreshCommand`, local DB, and local env.

## WSL Screenshot Paths

If another tool reports a Windows temp screenshot path, translate the drive
letter to its WSL mount and preserve the remaining profile-relative path before
concluding it is unreadable.

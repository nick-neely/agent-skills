# Screenshot Recipes

Run from the repo root. Prefer the repo's configured `baseUrl` from `.agents/visual-verification.json`; the examples below use `http://localhost:3000` only as a placeholder.
Replace `<skill-root>` with the installed directory containing the skill's `SKILL.md`.

## Basic Capture

```bash
node "<skill-root>/scripts/screenshot.mjs" http://localhost:3000 \
  -o /tmp/home.png \
  --wait main
```

## Light And Dark

```bash
node "<skill-root>/scripts/screenshot.mjs" http://localhost:3000/some-route \
  -o /tmp/light.png \
  --wait main

node "<skill-root>/scripts/screenshot.mjs" http://localhost:3000/some-route \
  -o /tmp/dark.png \
  --wait main \
  --dark
```

## Responsive

```bash
node "<skill-root>/scripts/screenshot.mjs" http://localhost:3000/some-route \
  -o /tmp/mobile.png \
  --device mobile \
  --wait main
```

## Hover, Dropdowns, Popovers

```bash
node "<skill-root>/scripts/screenshot.mjs" http://localhost:3000/dashboard/reports \
  -o /tmp/report-menu-hover.png \
  --wait table \
  --action 'hover:button[aria-label="Report actions"]' \
  --expect-text "Download report" \
  --width 1400 \
  --height 1000
```

Clip only a portal/overlay when the full viewport is noisy:

```bash
node "<skill-root>/scripts/screenshot.mjs" http://localhost:3000/dashboard/reports \
  -o /tmp/popover.png \
  --action 'hover:button[aria-label="Report actions"]' \
  --clip-selector '[data-radix-popper-content-wrapper]' \
  --clip-padding 12
```

## Diagnostics

```bash
node "<skill-root>/scripts/screenshot.mjs" http://localhost:3000/some-route \
  --show-console \
  --show-network-failures
```

Use `--fail-on-console-error` and `--fail-on-network-error` when console/network cleanliness is part of the verification.

## Auth

Local protected routes that match `protectedRoutes` auto-load configured auth. Use:

- `--auth` to force auth for a route outside `protectedRoutes`.
- `--no-auth` to inspect login redirects.
- `--auth-state <path>` to override configured storage state.

If the storage state is missing or expired, the runner executes `auth.refreshCommand` unless `auth.mode` is `storage-state`.

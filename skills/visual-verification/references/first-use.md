# First Use

Use this when `.agents/visual-verification.json` is absent or clearly stale.
Replace `<skill-root>` with the installed directory containing the skill's `SKILL.md`.

## Flow

1. Run detection:

```bash
node "<skill-root>/scripts/detect-project.mjs"
```

2. Inspect the JSON for:
   - `root`
   - `framework`
   - `routes`
   - `auth.betterAuth`
   - `auth.authScripts`
   - `inferred`

3. Write the config automatically:

```bash
node "<skill-root>/scripts/init-config.mjs"
```

This writes stable repo facts to `.agents/visual-verification.json` and machine/session facts such as the detected live `baseUrl` to `.agents/visual-verification.local.json`. Use `--print` to preview when the repo is dirty in relevant files.

4. Verify the browser runtime:

```bash
node "<skill-root>/scripts/ensure-browser.mjs" --smoke
```

If no browser is found, run the same command with `--install --smoke`.

5. If `auth.needsAdapterScript` is true, read `auth-adapters.md`, inspect candidate scripts and app auth/schema, then either wire a verified existing command or add a repo-owned adapter before trying protected screenshots.
6. Verify with one public screenshot. If protected routes exist, verify one protected screenshot too.

## Config Shape

```json
{
  "protectedRoutes": ["/admin", "/admin/**"],
  "devServer": {
    "startCommand": "bun run dev"
  },
  "auth": {
    "mode": "command",
    "storageState": ".auth/agent-admin-storage-state.json",
    "refreshCommand": null,
    "sessionCookieName": "better-auth.session_token",
    "adapter": "better-auth",
    "needsAdapterScript": true
  }
}
```

Local override shape:

```json
{
  "baseUrl": "http://localhost:3001",
  "baseUrlSource": "running-server-probe",
  "devServer": {
    "checkUrl": "http://localhost:3001"
  }
}
```

## Decision Rules

- Prefer verified existing repo scripts over generating new ones, but do not assume a command name.
- Detect or confirm the active local base URL; do not assume `localhost:3000` when another port is already serving the app.
- Keep config repo-local.
- Keep machine/session facts in `.agents/visual-verification.local.json`.
- Ignore `.agents/visual-verification.local.json` and `.auth/`; do not ignore `.agents/visual-verification.json` automatically.
- Do not ask the user to write config manually.
- Do not mutate auth for non-local apps or remote databases.
- If protected screenshots cannot be set up safely, leave public screenshots working and report the auth blocker.

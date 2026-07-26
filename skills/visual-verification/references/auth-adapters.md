# Auth Adapters

The screenshot runner consumes Playwright storage-state cookies. Each repo decides how those cookies are produced.

## Modes

### `command`

Use when the repo already has a script that writes a storage-state JSON.

```json
{
  "auth": {
    "mode": "command",
    "storageState": ".auth/agent-admin-storage-state.json",
    "refreshCommand": "bun run <repo-owned-auth-command>",
    "sessionCookieName": "better-auth.session_token",
    "adapter": "better-auth"
  }
}
```

### `storage-state`

Use when the state is managed outside the skill and must not be regenerated.

### `custom-cookie`

Use when a repo-owned script can mint cookies directly. Prefer having that script write Playwright storage-state JSON so `screenshot.mjs` can consume it without app-specific branching.

### `playwright-login`

Use when the safest path is logging in through the real UI. The login script should write the same `storageState` path.

## Better Auth Local Adapter

Follow the Better Auth docs for current config/API details. Keep the adapter outside the skill and inside the repo, because schema imports, role names, and permission models are app-specific.

On first setup, inspect the target repo and write a repo-owned adapter only when needed. Do not import app code from this global skill. The generated repo code should import from the target app's actual DB/auth/schema modules.

Good first-use sequence:

1. Read the target app's Better Auth config, usually `lib/auth.ts`, `lib/auth/auth.ts`, or `src/lib/auth.ts`.
2. Identify the DB adapter and schema exports for `users` and `sessions`.
3. Identify the app's local role/permission model.
4. Add a small helper script inside the target repo, for example `scripts/agent-admin-auth.ts`.
5. Add a small command script inside the target repo, for example `scripts/prepare-agent-admin.ts`.
6. Add a package script with a name that fits the repo.
7. Point `.agents/visual-verification.json` at that command.

Best-practice checklist:

- Require `BETTER_AUTH_SECRET`.
- Require a local DB URL and reject non-local hosts before writing users or sessions.
- Prefer the app's existing DB/schema imports instead of raw SQL.
- Create or update an obvious agent identity such as `agent-admin@localhost.local`.
- Grant the narrowest role/scope that lets local agents verify the protected UI. If the app has a superadmin-only surface and no narrower local role exists, make that explicit in the script.
- Insert a fresh session token with a short finite expiry.
- Sign the Better Auth session cookie with the app secret when using the default compact cookie format.
- Write Playwright storage state to `.auth/agent-admin-storage-state.json` with mode `0600`.
- Never run against production, preview, staging, Neon, Supabase, RDS, or other remote DB hosts.

The adapter code is intentionally generated per repo. That is the safe boundary: the global skill knows the pattern, while the app owns the imports, schema, role values, and local-only guardrails.

## Safety Failure

If a protected screenshot cannot be authenticated safely, do not bypass auth in app code. Capture the public/login state with `--no-auth`, report the blocker, and leave the app's production auth behavior untouched.

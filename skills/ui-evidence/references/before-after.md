# Before and after

```bash
node "<skill-root>/scripts/before-capture.mjs" create
```

This creates a detached checkout of the merge base with the remote default
branch in a unique temporary location. It leaves the current checkout intact.
Pass `--ref <branch>` to choose the comparison branch, or `--dir <path>` for an
explicit unused location. Record the returned base and merge-base revision so
the label identifies what was rendered.

Capture a base revision only when its comparison helps the reviewer. A new
screen may need after-only evidence. A feature toggle in the changed code is
not a substitute for rendering the actual baseline revision.

## Start and identify the servers

Use the project's setup and dev-server commands inside the temporary checkout.
Confirm each server's process working directory or another reliable worktree
marker, then check the intended route and fixture. Reusing a port does not prove
server identity. Give the baseline its own port when possible, preserving the
running after-server.

Use separate browser sessions for before and after. Authenticate each through
the app's supported flow and verify that both show the intended signed-in
surface. Cookies are scoped by domain/path and are not isolated by port.
Local/session storage, auth callback allowlists, signing secrets, and databases
can still depend on the origin or checkout. Diagnose the actual dependency
before deciding that two ports cannot work.

Use sanitized, comparable data and the project's isolated local-data setup.
Do not run an older checkout's migrations against another server's database.
If the app genuinely requires the original port, get authorization before
stopping a user-owned server and restore it afterwards. If a truthful baseline
cannot be prepared, publish after-only evidence and explain the limitation;
a login page is not the requested baseline.

## Match the states

| Match | Check |
| --- | --- |
| Geometry | Viewport, device pixel ratio, route, scroll position |
| Appearance | Theme, fonts, relevant settings |
| Data | Same sanitized seed and meaningful row/content state |
| Timing | Settle unrelated animation and timestamps for static comparisons; retain motion under test |

The browser's `diff screenshot --baseline <absolute-path>` provides quick visual
inspection. Use `regions.mjs` when changed-region geometry helps annotation.
Neither replaces checking that both captures show the intended app state.

## Remove only this run's clean checkout

```bash
node "<skill-root>/scripts/before-capture.mjs" remove \
  --dir <returned-path> --owner <returned-owner>
```

Keep the exact removal command returned by `create`. A per-run ownership record
stays in that worktree's private Git metadata. Removal requires the matching
owner ID and registered path, and refuses dirty or untracked contents. Stop
only the server this run started, then remove
the clean checkout. Normal Git removal also removes ignored dependencies and
build output in that checkout; inspect any ignored files that need to be kept.
A refusal preserves the files for inspection; do not force
removal or delete an unrelated path to finish cleanup.

Cookie behavior: [RFC 6265, section 8.5](https://www.rfc-editor.org/rfc/rfc6265#section-8.5).

# Before and after

"Before" means the base ref rendered, not the current code with a feature flag
off. That requires a second checkout and a second dev server.

Only do this when the comparison earns it. A new screen has no meaningful
before. A changed screen usually does.

## The worktree

```bash
node "<skill-root>/scripts/before-capture.mjs" create
```

Resolves the merge base against the remote default branch, checks it out into a
detached worktree in the system temp directory, and prints the path. Pass
`--ref <branch>` to compare against something else, or `--dir <path>` to place
the worktree yourself.

Uncommitted work stays untouched, and it is correctly included in "after",
because the after-capture runs against your working tree.

Install dependencies and start the dev server inside that worktree using the
project's own commands. The script does not guess them.

Tear down when you are finished:

```bash
node "<skill-root>/scripts/before-capture.mjs" remove
```

If you created the worktree with `--dir <path>`, pass the same `--dir <path>` to
`remove`. Without it the command looks in the default location and reports that
there is nothing to remove. The `create` output prints the matching command.

Remove the worktree even when capture failed. A stale worktree makes the next
run fail with a path collision.

## Which port

This is the decision that determines whether authenticated screens work.

**Unauthenticated surfaces: run both servers at once, on different ports.**
Capture in parallel. Ports are irrelevant when no session is involved.

**Authenticated surfaces: run sequentially, on one port.** Cookies are scoped to
an origin, and an origin includes the port. A session established on `:3000`
does not exist on `:3001`, so a before-capture on a different port silently
photographs a login page instead of the screen you wanted.

The sequence for an authenticated surface:

1. Capture "after" against the already-running dev server.
2. Ask the user before stopping that server. It is theirs, and it may be
   holding state they care about.
3. Start the worktree's server on the freed port.
4. Authenticate, then capture "before".
5. Stop it, remove the worktree, and restart the original server.

If the user declines the stop, produce an annotated after-only image and say
that before/after was skipped and why. Do not publish a login page labelled
"before".

## Authentication itself

`agent-browser` owns this. It has a credential vault, pluggable credential
providers, cookie and header control, and persistent sessions.

```bash
agent-browser auth save <name> --url <login-url> --username <user> --password-stdin
agent-browser auth login <name>
```

Do not build a login bypass into the application for this. Do not commit
credentials or storage state.

## Matching the two captures

The region script rejects mismatched dimensions, which catches the common
failure. These still need attention:

- Same viewport and device pixel ratio on both captures.
- Same route, same scroll position, same theme.
- Freeze anything that moves. Animations, carousels, relative timestamps, and
  randomised content all register as changed regions and drown the real diff.
- Seed the same data. A different row count is a different screen, not a
  different style.

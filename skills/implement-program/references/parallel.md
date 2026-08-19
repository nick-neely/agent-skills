# Parallel lanes

Parallelize only dependency-ready tickets with proven isolation. Before
dispatch, collect anticipated ownership and runtime needs through read-only
reconnaissance, then run `concurrency.mjs` against the ledger.

Treat these as exclusive unless a repository adapter proves isolation:

- database migrations and migration journals;
- generated files with a shared output;
- one mutable database, cache, queue, browser profile, or external test account;
- the same port or dev-server state;
- overlapping modules or a shared product invariant whose ownership is unclear.

Allocate one branch and worktree per active ticket. Lease ports, database
namespaces, browser profiles, and mutable services in the ledger before spawning
the worker. Start a dev server only when verification needs one. Reuse a server
only when it is bound to the same branch state or demonstrably immutable.

`worktree.mjs` creates or reopens lanes without installing dependencies or
copying ignored environment files. Follow repository setup instructions inside
the lane. `leases.mjs` rejects a resource already held by another owner. Release
leases only after integration verification passes; close a worktree only when it
is clean.

The default operating ceiling is five active sub-agents, excluding the
orchestrator: at most four implementation workers and two workers of either
review or research role, still bounded by five overall. When four builds are
active, retain headroom for the first completed build's reviewer instead of
filling every harness slot. Prioritize that review over another build.

After one sibling integrates, update another sibling only when ownership
overlaps or before it enters final verification. Every child must incorporate
the current integration head before becoming merge-eligible. A changed diff
restarts its observation window and implicated checks.

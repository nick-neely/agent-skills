# Hand testing to a fresh tester

When you implemented the change or have its solution in context, give the test to a fresh general-purpose worker, using a task mechanism that omits conversation history when the host offers one. The handoff carries only what an outside tester would have:

- The installed skill's absolute path, and the business source pointer or the user's original criteria with their provenance (never an implementer-authored checklist).
- The intended app or repository, target URL and build when known, and established non-secret startup, role, location and fixture or reset facts. A ready URL is optional; the tester can start the app.
- Existing authorization, prohibited actions, declared prerequisites, browser-mode override, time and output overrides and action limits. The tester uses its operator's own local setup; no cookies, profile contents or credentials.

Leave out conversation summaries, diffs, changed files, root causes, proposed fixes and expected failure locations.

Example task, with real values substituted:

> Independently test the user-facing behavior for the supplied goal and business criteria. Load the uat skill at `<path>`; you are the tester, so continue its workflow yourself. Derive scenarios from the supplied criteria. Reuse the intended non-production runtime, or start the local app through its documented workflow; the operator handles developer SSO. Stay within these action limits: `<limits>`. Return the report path and gaps.

The tester owns requirement discovery, scenario design and browser work. Help it with environment and access facts only. Findings return to you for normal handling.

For a retest, the handoff also carries the original report and finding IDs, symptom, reproduction, evidence, remaining action limits and reset facts, per [informed verification](follow-up.md#retest-as-a-new-run).

Record the isolation mechanism and what you supplied; a separate context window alone does not prove history, memory or repository instructions were excluded. If the worker inherits history, label the run **implementation-informed**. If the host cannot create a fresh worker, test yourself under that label; when strict independence was requested, ask for a new clean session instead. One level of delegation only, and no other paid model CLI as a substitute.

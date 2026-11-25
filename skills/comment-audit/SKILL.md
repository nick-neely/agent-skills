---
name: comment-audit
description: Audit code comments in an implementation before code review, or when asked to clean up or review comments in a change.
---

Start with the caller's change or named files, including relevant uncommitted
and new files. Read the surrounding code and tests. Include existing comments
that explain the behavior being changed, even outside an edited hunk. Stop
where the connection to that behavior ends.

Preserve comments with operational meaning, such as tool directives, license
notices, and public API documentation. Correct affected documentation when
its contract changes. For ordinary comments, use the following decisions.

| Category | How to recognize it | Action |
| --- | --- | --- |
| Tautology | Narrates what the next line or a well-named test already says. | Delete it. If a business rule is hard to see, express it in the code or a test. |
| Excuse | Justifies a workaround or promises a later fix. | Leave unrelated workarounds alone. Fix a related issue within scope, verify the behavior, then remove the excuse. If the limitation remains, keep it visible. Link a ticket only if it exists. |
| Stale | Describes a removed implementation, an expired constraint, or past agent work. | Delete the obsolete part. Preserve any current rationale in the same comment. |
| Decision record | Explains a non-obvious choice, invariant, or external constraint a maintainer could otherwise break. | Keep the reason beside the code. Trim session notes and speculative plans. Preserve a real condition for retiring the workaround. |

Apply the edits unless the user asked for a read-only audit. Check the
resulting diff and run the relevant tests for any behavior fix. When called
by an implementation workflow, continue directly to code review. Carry any
unresolved in-scope issue into the final handoff. For a standalone audit, summarize
material findings and include a per-comment table when requested.

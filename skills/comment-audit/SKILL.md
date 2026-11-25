---
name: comment-audit
description: Review comments in a code change and recommend actions. Apply the audit when the caller explicitly requests edits.
---

Default to a read-only audit. Use apply mode only when the user or calling
workflow explicitly asks you to edit the change.

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

In read-only mode, report a concise table of findings with columns
`Location`, `Category`, and `Recommended action`. Use file and line for each
location. If the change is clean, report no findings.

In apply mode, make the edits, check the resulting diff, and run relevant
tests for any behavior fix. During implementation, continue directly to code
review without an interim table. Carry unresolved in-scope issues into the
final handoff.

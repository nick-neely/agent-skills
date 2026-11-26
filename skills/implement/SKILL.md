---
name: implement
description: "Implement a piece of work based on a spec or set of tickets."
metadata:
  requires: implementation-proof
disable-model-invocation: true
---

Implement the work described by the user in the spec or tickets.

If the user passes a ticket reference, fetch it from the issue tracker and state its title before starting. If the reference is ambiguous, ask.

Note the current commit, then call the Skill tool with "implementation-proof" and follow it for this ticket, comparing against that commit. If that skill is not installed, say so and stop.

Ask the user everything its first step leaves open in one stop, before editing. With nothing open, go straight on.

Commit your work to the current branch, or to each layer's branch for a stack, and close with the method's report. Pushing and pull requests wait for the user to ask.

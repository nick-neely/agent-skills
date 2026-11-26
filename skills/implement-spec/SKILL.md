---
name: implement-spec
description: "Implement the result of /to-spec and /to-tickets in code: the whole spec on one integration branch, each ticket proved by its own fresh implementer."
metadata:
  requires: implementation-proof code-review
  uses: uat flow-walk github/gh-stack@gh-stack mattpocock/skills@setup-matt-pocock-skills
disable-model-invocation: true
---

You have been provided a spec. This spec should have tickets associated with it, describing how to implement the spec.

The issue tracker should have been provided to you. If not, tell the user to run `/setup-matt-pocock-skills`.

The goal is the entire spec implemented on a single **integration branch**, each ticket built and proved through the `implementation-proof` method, and the result ready for the user to file as one pull request or a short stack of them.

The tickets are not a list of steps. They are a **task graph** with blocking relationships between them. This means there is always a **frontier** of tickets which are ready to be grabbed: those whose blockers are all merged.

Start every subagent with a fresh context window.

Communication to and from subagents should be sparse. Communicate primarily through **context pointers**: to the spec, tickets, notes, and previous commits. Don't duplicate information already available via pointers.

**Implementer subagents** should be run in the background where possible for maximum concurrency.

## Steps

1. **Read the graph.** Read the spec and every ticket in full, including comments, to understand the task graph. Note the default branch's current commit: the final review compares against it.

2. **Plan in one stop.** For each ticket, start a **planning subagent** that calls the Skill tool with "implementation-proof" and states that method's first step for the ticket without editing code, exploring the codebase and any external documentation the ticket needs. Each saves its entries, open items and notes as markdown in one directory outside the repo that every later subagent can read.

   Then choose the delivery shape the way that method's Shape entry does, for the spec as a whole: one pull request by default, or the fewest layers, each a group of tickets, when the whole diff would be too large to review well or holds parts a reviewer would judge on their own. A layer holds only tickets whose blockers sit in it or below it.

   Settle from the spec and tickets whatever they already decide. Ask the user everything still open across all tickets in one stop, together with a stack the user or the project did not ask for, each layer's tickets named in a line. With nothing open, go straight on. Save the answers beside the entries.

3. **Create the integration branch** from the default branch.

4. **Implement the frontier.** Use a fresh **implementer subagent** for each frontier ticket, each in its own worktree on its own branch. Each implementer subagent:
   - confirms its worktree is based on the integration branch tip before starting, and resets onto it if not;
   - notes that tip, then calls the Skill tool with "implementation-proof" and follows it for its ticket, comparing against that tip, starting from the entries and answers step 2 saved. Its Shape is one branch: the delivery shape is step 2's;
   - reports anything newly open as a blocker instead of waiting for it. Answer it from the spec, the tickets or step 2's answers, or ask the user, then resume that implementer with the answer while the others keep going;
   - runs the app on its own port and data when another implementer may be running it at the same time;
   - merges the integration branch tip into its own branch and reruns the full suite before reporting done, with the method's report.

5. **Merge each finished ticket** to the integration branch with a **merger subagent**, as one commit per ticket that names it, and run the full suite on the result. A failure goes back to that ticket's implementer before the next merge. If this changes the **frontier**, kick off implementer subagents for the newly ready tickets.

6. **Check the whole.** Once all tickets are merged, look for acceptance criteria that span tickets, such as a user flow that crosses them. For those, pick the runtime check from `implementation-proof`'s table and run it once on a build of the integration branch, calling `uat` or `flow-walk` as the one who built the change, as that method does. Then call the Skill tool with "code-review" on the integration branch, passing the spec and comparing against step 1's commit. Fix every substantive finding from either in a single fresh implementer subagent that follows the method for the fixes, and merge it as in step 5.

7. **Cut the layers.** For a stack, the integration branch is the top layer. Give each layer below it a branch at the ticket commit that closes it, bottom up, then make the branches a stack with the `gh-stack` skill, stopping short of its submit step. Every cut is a commit the full suite passed on. When the work showed a better split, redraw the layers and say so in the report; ask first before going beyond the number of layers that was agreed. When the grouping needs tickets in a different order, reorder only tickets that do not depend on each other, and run the full suite again at every cut.

8. **Close and report.** When the issue tracker closes work through pull requests, leave the tickets open for the pull request to close and list them. Otherwise resolve each ticket the way the issue tracker closes work. Clean up all implementer subagent worktrees.

   Report the integration branch, or each layer's branch with its tickets; each ticket's **Proves** lines with the evidence observed or "unproven" with the reason; every runtime check's result, including step 6's; the review outcome; each decision made for the user; and findings left outside the spec. Pushing and pull requests wait for the user to ask.

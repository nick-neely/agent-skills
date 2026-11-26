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

1. **Read the graph.** Read the spec and every ticket in full, including comments, to understand the task graph. Note the default branch's current commit, and create one notes directory outside the repo that every subagent can read; pass its path to each.

2. **Plan in one stop.** For each ticket, start a **planning subagent** that calls the Skill tool with "implementation-proof" and states that method's first step for the ticket without editing code, exploring the codebase and any external documentation the ticket needs. You are its caller: it records what is open in the notes directory instead of asking the user, and its Shape is one branch. It saves its entries and notes there too.

   Then choose the delivery shape by that method's Shape entry, applied to the spec as a whole: each layer is a group of tickets, and a layer holds only tickets whose blockers sit in it or below it. When the `gh-stack` skill is not installed, keep one pull request and say so.

   Find the acceptance criteria that span tickets, such as a user flow that crosses them, and choose step 7's runtime check for them from `implementation-proof`'s table now, with anything it will need from the user.

   Settle from the spec and tickets whatever they already decide. Ask the user everything still open across all tickets in one stop, together with a stack the user or the project did not ask for, each layer's tickets named in a line. With nothing open, go straight on. Save the answers beside the entries.

3. **Create the integration branch** from the default branch.

4. **Implement the frontier.** Use a fresh **implementer subagent** for each frontier ticket, each in its own worktree on its own branch. Each implementer subagent:
   - confirms its worktree is based on the integration branch tip before starting, and resets onto it if not;
   - notes that tip, then calls the Skill tool with "implementation-proof" and follows it for its ticket, comparing against that tip, starting from the entries and answers step 2 saved. You are its caller, and its Shape is one branch;
   - reports anything newly open as a blocker instead of waiting for it. Answer it from the spec, the tickets or step 2's answers, asking the user once for whatever blockers are pending together, then resume each with its answer while the others keep going;
   - hands its runtime check or its review back to you when it cannot start subagents of its own: run that skill for the ticket against its worktree, and resume it with the findings;
   - runs the app on its own port and data when another implementer may be running it at the same time;
   - merges the integration branch tip into its own branch and reruns the full suite before reporting done, with the method's report.

5. **Merge each finished ticket** with a **merger subagent**, as one commit per ticket that names it. The integration branch advances only once the full suite passes on that commit; a failure goes back to that ticket's implementer. When the tickets make a run of batches green only at a final integrate-and-verify ticket, as a wide refactor may, those batches advance on their own tests and the full suite gate applies at that final ticket. If a merge changes the **frontier**, kick off implementer subagents for the newly ready tickets.

6. **Cut the layers.** For a stack, the integration branch is the top layer. Give each layer below it a branch at the merge commit of its last ticket, bottom up, and make the branches a stack with the `gh-stack` skill, stopping short of its submit step. The ticket commits already separate the layers' concerns, so this adopts finished branches rather than splitting mixed work. When the grouping needs tickets in a different order, reorder only tickets that do not depend on each other, and run the full suite again at every cut. No cut falls inside a run of batches that is green only at its final ticket. Redraw layers as the method allows when the work showed a better split. When the stack cannot be made, keep one pull request and say so.

7. **Check the whole.** Run the runtime check step 2 chose for the criteria that span tickets once, on a build of the top of the integration branch, calling `uat` or `flow-walk` as the one who built the change, as `implementation-proof` does. Then call the Skill tool with "code-review": for one pull request on the integration branch against step 1's commit, passing the spec; for a stack on each layer against its parent's tip, passing that layer's tickets as what it must satisfy and the spec and layer map as context. Criteria that span layers are judged at the top layer.

   Fix every substantive finding from either in a fresh implementer subagent that follows the method for the fixes. A fix goes on the layer that owns the code it changes; rebase the layers above it with the `gh-stack` skill and run the full suite at each layer. When a fix changes what this step's runtime check covered, run that check again on the top layer's build.

8. **Close and report.** When the issue tracker closes work through pull requests, leave the tickets open for the pull request to close and list them. Otherwise resolve each ticket the way the issue tracker closes work. Clean up all implementer subagent worktrees.

   Report the integration branch, or each layer's branch with its tickets; each ticket's **Proves** lines with the evidence observed or "unproven" with the reason; every runtime check's result, including step 7's; the review outcome; each decision made for the user; and findings left outside the spec. Pushing and pull requests wait for the user to ask.

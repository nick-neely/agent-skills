---
name: implement
description: "Implement a piece of work based on a spec or set of tickets."
disable-model-invocation: true
---

Implement the work described by the user in the spec or tickets.

If the user passes a ticket reference, fetch it from the issue tracker and state its title before starting. If the reference is ambiguous, ask.

## 1. Say what you will prove

Before editing, state three short entries. A change with no behavior to prove, such as a rename or a config edit, takes one line saying so in their place.

- **Proves:** the acceptance criteria and the failures worth catching, each with its expected result taken from the ticket. Mark an expectation you inferred as inferred.
- **Seams:** the public interface each one is tested through.
- **Runtime:** the first row below that fits the change.

| The change | Runtime check |
| --- | --- |
| Acceptance criteria describe user-facing behavior that tests at these seams cannot observe | `uat`, whose walkthrough also covers ease |
| A screen, step or decision is added, removed or reordered | `flow-walk`, whose first step qualifies the change |
| What a user sees or does changes in some other way | Use the changed path yourself in the running app |
| Anything else | None |

Match the technique to the risk with tooling the repository already has, such as a property test for a rule over many inputs. Name a warranted technique it lacks in the handoff.

Proceed when existing tests already reach this behavior through those seams. Confirm with the user first when a seam would be new, or when the ticket leaves open a choice that is costly to reverse: a data migration, a new dependency, a public contract or an authorization boundary. Ask everything in this one stop; from there the work runs through to the commit.

Done: the entries are stated and every question you raised is answered.

## 2. Implement

Call the Skill tool with "tdd" where possible. The seams above are its pre-agreed seams.

Run typechecking regularly, single test files regularly, and the full test suite once at the end.

Once implemented, call the Skill tool with "comment-audit" in apply mode on the current change.

Done: the full suite passes and the comment audit is applied.

## 3. Check the running app

Run the **Runtime** check. For `uat` or `flow-walk`, call that skill and take its builder role, which hands the test to a fresh tester. Fix in-scope findings and recheck them. When the skill is not installed, or the app cannot be run or reached, use the changed path yourself where you can and record the check as not run, with what blocked it.

Done: the check has a result, or is recorded as not run with its blocker.

## 4. Review and hand off

Call the Skill tool with "code-review", passing the ticket and comparing against the commit you started from. When a review fix changes behavior the runtime check covered, recheck that behavior.

Commit your work to the current branch. Close with each **Proves** line and the evidence you observed for it, or "unproven" with the reason, then the runtime check's result.

Done: the work is committed and every **Proves** line has evidence or a reason.

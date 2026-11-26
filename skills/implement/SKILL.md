---
name: implement
description: "Implement a piece of work based on a spec or set of tickets."
disable-model-invocation: true
---

Implement the work described by the user in the spec or tickets.

If the user passes a ticket reference, fetch it from the issue tracker and state its title before starting. If the reference is ambiguous, ask.

## 1. Say what you will prove

Before editing, state three short entries. A change with no behavior to prove, such as a rename or a formatting change, takes one line saying so in their place.

- **Proves:** the acceptance criteria, the rules that must always hold and the failures worth catching, each with its expected result taken from the ticket. Mark an expectation you inferred as inferred.
- **Seams:** the public interface each one is tested through, naming the technique where a risk calls for more than example tests.
- **Runtime:** a check the user or the project asks for; otherwise the first row below that fits the change. The project asks in its agent instructions or its flow-walk notes, which are at the path those instructions name, otherwise `docs/agents/flow-walk.md`.

| The change | Runtime check |
| --- | --- |
| Acceptance criteria describe behavior in a browser interface that tests at these seams cannot observe | `uat`, whose walkthrough also covers ease |
| It adds, removes or reorders a screen, step or decision in a user flow, builds a state the user must act from, or changes how a first-time user finds the next step, weighs a consequential choice or recognizes completion | `flow-walk`, whose first step decides whether the change qualifies |
| What a user sees or does changes in some other way | Use the changed path yourself in the running app, at desktop and phone widths for a web interface |
| Its effect is one the tests at these seams cannot observe, such as a migration, a scheduled job, a command or infrastructure | Run it yourself against a local or non-production target, as a dry run where the tool has one, and observe the result |
| Anything else | None |

Example tests are the default. When the ticket carries a rule over many inputs, a contract others rely on, critical logic, untested code you must change, shared state or retries, untrusted input, an authorization boundary or a replaced implementation, read [test techniques](references/techniques.md) and choose from it.

Proceed when the seams are clear: existing tests reach this behavior through them, or the repository has an established way to test this kind of interface. Confirm with the user first when a seam is a judgment call, or when the ticket leaves open a choice that is costly to reverse, such as a data migration, a new dependency, a public contract or an authorization boundary. Ask everything in this one stop, including anything the runtime check will need from the user, such as a sign-in; from there the work runs through to the commit.

Done: the entries are stated and every question you raised is answered.

## 2. Implement

Call the Skill tool with "tdd" where possible. Step 1 replaces its seam confirmation: write tests at those seams without asking again.

Run typechecking regularly, single test files regularly, and the full test suite once the behavior is implemented.

Done: the behavior is implemented and the full suite passes.

## 3. Check the running app

Run the **Runtime** check against a build you know holds this change. For `uat` or `flow-walk`, call that skill and take its builder role, which hands the test to a fresh tester. Point the tester at that build, and have it return anything it needs from the user that step 1 did not arrange as a blocker instead of waiting. Handle the findings as that skill says, within the ticket's scope: what falls outside it, including a bug the skill would file, goes in the handoff. For your own look, fix what it turns up and look again. When the check led to code changes, rerun the full suite before review.

When the skill is not installed, no fresh tester can be started, the app cannot be run or reached, or the check needs something from the user that step 1 did not arrange, use the changed path yourself where you can and record the check as not run, with what blocked it.

Done: the check has a result, or is recorded as not run with its blocker.

## 4. Review and hand off

Call the Skill tool with "comment-audit" in apply mode on the current change. Then call "code-review", passing the ticket and comparing against the commit you started from. Rerun the full suite when anything changed after it last passed.

When a fix made after the runtime check changes what that check covered or what a user sees or does, check that fix at runtime too: by the skill's own recheck rule where one ran, otherwise by the row of step 1's table that fits the fix.

Commit your work to the current branch. Close with each **Proves** line and the evidence you observed for it, or "unproven" with the reason, then the runtime check's result and any finding it left outside the ticket.

Done: the full suite passes on the committed work and every **Proves** line has evidence or a reason.

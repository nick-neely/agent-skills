---
name: implementation-proof
description: Shared method for implementing a change with proof - say what the work must prove, build it test-first, check it running, then audit and review. Use when a calling workflow such as implement, implement-spec, full-send or full-stop names this skill.
metadata:
  requires: tdd comment-audit code-review
  uses: uat flow-walk github/gh-stack@gh-stack
---

# Implementation proof

The method a calling workflow follows to implement a ticket or spec and show that it works. The caller supplies the ticket, the commit to compare against, and how open questions get answered. For a batch of a wide refactor that goes green only at a later ticket, the caller also names the tests that stand in for the full suite until that ticket. Fetching the ticket, the closing commit and delivery stay with the caller. When a skill this method requires is not installed, stop and name it instead of doing its work another way.

## 1. Say what you will prove

Before editing, state four short entries. A change with no behavior to prove, such as a rename or a formatting change, takes one line saying so in place of the first three; Shape is always stated.

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

- **Shape:** one pull request, or a stack of them. One is the default, and a change that fits one review stays one. Propose a stack only when the work holds changes a reviewer would judge on their own, such as a refactor that prepares the ground, a schema change, the behavior, then a consumer, or when one diff would be too large to review well. Use the fewest layers that do it. Each layer does one thing, carries its own tests, and leaves everything below it working; a layer too small to understand without the next one belongs in it. Size the review, not the session: build the whole feature in this run, in layers.

Example tests are the default. When the ticket carries a rule over many inputs, a contract others rely on, critical logic, untested code you must change, shared state or retries, untrusted input, an authorization boundary or a replaced implementation, read [test techniques](references/techniques.md) and choose from it.

Four things can be open at this point:

- a seam that is a judgment call, because no existing test reaches this behavior through it and the repository has no established way to test this kind of interface;
- a choice the ticket leaves open that is costly to reverse, such as a data migration, a new dependency, a public contract or an authorization boundary;
- something the runtime check will need from the user, such as a sign-in;
- a stack that neither the user nor the project asked for, with each layer named in a line.

Settle each one now, the way the caller says. With no calling workflow the user is the caller: ask them whatever is open in one stop, and go straight on when nothing is. From there the work runs through to the caller's next step.

For a stack, follow the `gh-stack` skill for the commands and start the stack before editing, as it says; the Shape entry decides what each layer holds. Then run steps 2 to 4 once per layer, bottom up. Each layer's review compares against its parent's tip in place of the caller's commit, and a layer is committed before the next one starts. Run the full suite once more at the top. Stop short of that skill's submit step: pushing stays with the caller. When that skill is not installed, or starting the stack reports that stacked pull requests are unavailable, keep one pull request and say so. When the stack was asked for, that is an open item: settle it the way the caller says before going on.

The layers are a plan made before the code exists, and building can show a better split. Merge or redraw layers when it does and say so in the report. Ask first before going beyond the number of layers that was agreed.

Done: the entries are stated and nothing is open.

## 2. Implement

Call the Skill tool with "tdd" where the change has behavior to test, handing it the seams from step 1 as settled.

Run typechecking regularly, single test files regularly, and the full test suite once the behavior is implemented.

Done: the behavior is implemented and the full suite passes.

## 3. Check it running

Run the **Runtime** check against a build you know holds this change. For `uat` or `flow-walk`, call that skill as the one who built the change, so it hands the test to a fresh tester; keep any label it puts on a run made without one. Point the tester at that build, and have it return anything it needs from the user that step 1 did not arrange as a blocker instead of waiting. Handle the findings as that skill says, within the ticket's scope: what falls outside it, including a bug the skill would file, goes in the report. For your own look, fix what it turns up and look again. When the check led to code changes, rerun the full suite before review.

When the skill is not installed, the app cannot be run or reached, the skill would hand the check back to the user, or the check needs something from the user that step 1 did not arrange, use the changed path yourself where you can and record the check as not run, with what blocked it.

Done: the check has a result, or is recorded as not run with its blocker.

## 4. Audit and review

Call the Skill tool with "comment-audit" in apply mode on the current change. Then call "code-review", passing the ticket and comparing against the caller's commit, with uncommitted work included. Rerun the full suite when anything changed after it last passed.

When a fix made after the runtime check changes what that check covered or what a user sees or does, check that fix at runtime too: by the skill's own recheck rule where one ran, otherwise by the row of step 1's table that fits the fix.

Done: no substantive finding is unresolved and the full suite passes on the final code.

## 5. Report

Give the caller each **Proves** line with the evidence you observed for it, or "unproven" with the reason, then the runtime check's result and any finding it left outside the ticket.

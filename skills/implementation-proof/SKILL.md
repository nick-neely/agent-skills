---
name: implementation-proof
description: Shared method for implementing a change with proof - say what the work must prove, build it test-first, check it running, then audit and review. Use when a calling workflow such as implement, implement-spec, full-send or full-stop names this skill.
metadata:
  requires: tdd comment-audit code-review
  uses: uat flow-walk github/gh-stack@gh-stack
---

# Implementation proof

The method a calling workflow follows to implement a ticket or spec and show that it works. The caller supplies the ticket, the commit to compare against, and how open questions get answered. For a batch of a wide refactor that goes green only at a later ticket, the caller also names the tests that stand in for the required checks until that ticket. Fetching the ticket, the closing commit and delivery stay with the caller. When a skill this method requires is not installed, stop and name it instead of doing its work another way.

The **required checks** are what the project's instructions say a change must pass before it is done; without such instructions, what its CI runs, and without CI, the full test suite. While working, use **narrower checks**: the narrowest run that covers what you changed, through the project's own command where it has one, such as a changed-files script, otherwise the test runner's filter for the tests that cover the code you changed, or the smallest suite that includes them. A required check the host cannot run is named in the report as not run, with the reason; "the required checks pass" below means every one the host can run.

## 1. Say what you will prove

Before editing, state four short entries. When the caller hands you entries it saved, read them against the code and say in a line that they stand or what changed. A change with no behavior to prove, such as a rename or a formatting change, takes one line saying so in place of the first three; Shape is always stated.

- **Proves:** the acceptance criteria, the rules that must always hold and the failures worth catching, each with its expected result taken from the ticket. Mark an expectation you inferred as inferred.
- **Seams:** the public interface each one is tested through, naming the technique where a risk calls for more than example tests.
- **Runtime:** for each part of the change, such as an owner screen and an agent-facing contract, a check the user or the project asks for that covers it, otherwise the first row below that fits it, naming the part each check covers. When the first two rows fit the same flow, run `uat` alone. The project asks in its agent instructions or its flow-walk notes, which are at the path those instructions name, otherwise `docs/agents/flow-walk.md`.

| The change | Runtime check |
| --- | --- |
| Acceptance criteria describe behavior in a browser interface that tests at these seams cannot observe | `uat`, whose walkthrough also covers ease |
| It adds, removes or reorders a screen, step or decision in a user flow, builds a state the user must act from, or changes how a first-time user finds the next step, weighs a consequential choice or recognizes completion | `flow-walk`, whose first step decides whether the change qualifies |
| What a user or an API caller sees or does changes in some other way | Use the changed path yourself in the running app: at desktop and phone widths for a web interface, or by calling it for an API |
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

For a stack, follow the `gh-stack` skill for the commands and start the stack before editing, as it says; the Shape entry decides what each layer holds. Then run steps 2 to 4 once per layer, bottom up. Each layer's review compares against its parent's tip in place of the caller's commit, and a layer is committed before the next one starts. Run the required checks once more at the top. Stop short of that skill's submit step: pushing stays with the caller. When that skill is not installed, or starting the stack reports that stacked pull requests are unavailable, keep one pull request and say so. When the stack was asked for, that is an open item: settle it the way the caller says before going on.

The layers are a plan made before the code exists, and building can show a better split. Merge or redraw layers when it does and say so in the report. Ask first before going beyond the number of layers that was agreed.

Done: the entries are stated and nothing is open.

## 2. Implement

Call the Skill tool with "tdd" where the change has behavior to test, handing it the seams from step 1 as settled. Write each test before the code it covers; report any code written before its test.

Run typechecking and the narrower checks regularly, and the required checks once the behavior is implemented.

Done: the behavior is implemented and the required checks pass.

## 3. Check it running

Run each **Runtime** check against a build you know holds this change. For `uat` or `flow-walk`, call that skill as the one who built the change, so it hands the test to a fresh tester; keep any label it puts on a run made without one. Point the tester at that build, and have it return anything it needs from the user that step 1 did not arrange as a blocker instead of waiting. Handle the findings as that skill says, within the ticket's scope: what falls outside it, including a bug the skill would file, goes in the report. For your own look, fix what it turns up and look again. When the check led to code changes, run the narrower checks on them before review.

When the skill is not installed, the app cannot be run or reached, the skill would hand the check back to the user, or the check needs something from the user that step 1 did not arrange, use the changed path yourself where you can and record the check as not run, with what blocked it. A check that needs a later stage, such as a preview deployment, is deferred: record its exact steps and who runs them.

Done: each check has a result, or is recorded as not run with its blocker or deferred with its steps.

## 4. Audit and review

Call the Skill tool with "comment-audit" in apply mode on the current change. Then call "code-review", passing the ticket and comparing against the caller's commit, with uncommitted work included.

A round is one review and the fixes it prompts. Fix each substantive finding, and report one you cannot fix within the ticket. When a fix changes what a runtime check covered or what a user sees or does, check it at runtime before the next review, by the skill's own recheck rule where one ran, otherwise by the row of step 1's table that fits the fix. Then call "code-review" again on the whole change, passing every substantive finding from earlier rounds, until a round finds nothing substantive. Follow the project's review rules for how many rounds a change needs and when review stops; without them, stop after three reviews. When the reviews run out, report every substantive finding still open, and any fix the last round made, as unreviewed, rather than settling either yourself. Run the required checks on the final code.

Done: a review round found nothing substantive, or the reviews ran out with what is open or unreviewed reported, and the required checks pass on the final code.

## 5. Report

Give the caller each **Proves** line with the evidence you observed for it, or "unproven" with the reason. Then give one line per step naming each skill this method called, or what was done in its place and why; each runtime check's result; each review round's outcome; the required checks with their results; and any finding left outside the ticket.

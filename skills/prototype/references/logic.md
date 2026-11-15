# Logic prototype

Answer "does this state model, data shape or rule hold up?" by building the candidates as small pure modules, **running** the awkward scenarios through them, and handing the user a comparison with a recommendation.

The agent drives the model; the user reads the result. A clickable demo is built only when the user asks for one.

## 1. State the question and the candidates

Write the question in one sentence. Then name the candidate models: at least two when there is a real choice, exactly one when the question is whether a proposed model survives its edge cases. Name each by what it does ("Snooze returns to the inbox", "Snooze keeps its stage"), never "Option A".

## 2. Write each candidate as a pure module

Pick the shape that fits the question:

- **A reducer**, `(state, action) => state`, when actions are discrete events over one state value.
- **A state machine** with explicit states and transitions, when which actions are legal is part of the question.
- **Pure functions over a plain data type**, when there is no current state, only transformations.

Keep it pure: inputs in, value out, with time, randomness and storage passed in as arguments. Candidates share one action vocabulary so the same scenario runs through each. The winning module lifts into the real code afterward.

## 3. Choose the scenarios

A scenario is a named starting state and an ordered list of actions, written in the domain's words. Cover:

- the happy path;
- every edge case the user or ticket raised;
- the cases that are hard to reason about on paper: actions out of order, the same action twice, two actors, a boundary value, a step undone;
- at least one action that should be illegal.

For each scenario, write what the business expects to happen before running anything. That expectation is the standard the candidates are held to.

## 4. Run them

Write a small script in the project's language that runs every scenario through every candidate and prints the resulting state or the rejection. Run it and use its real output. A table filled in by reasoning about the code is a guess.

**Done when** every cell of scenarios by candidates comes from an executed run.

## 5. Hand over the comparison

Lead with the recommendation. Then give, in this order:

1. **The question**, in one sentence.
2. **The recommendation** and the one or two scenarios that decide it.
3. **The table**: one row per scenario, one column for the expected outcome and one per candidate, in domain language. Mark each cell that differs from the expectation.
4. **Where each candidate breaks**, as a short list: the scenario, what happened, why it matters to the business.
5. **What the scenarios did not cover**, so the user knows the limits of the answer.

Keep it to what the user needs to decide. The modules and the script are the evidence; link them, and leave the code out of the hand-over.

## 6. Capture

Follow rule 6 of [the skill](../SKILL.md): record the verdict, lift the winning module into the real code with proper tests, and commit the candidates and the script to the throwaway branch.

## A clickable demo, on request

When the user asks to feel the model themselves, or wants to hand it to someone who does not read code, wrap the same pure modules in one self-contained HTML file that opens by double-click:

- the current state as a labelled panel in domain language, re-rendered after every action with the change called out;
- one button per action;
- a switch between candidates that replays the actions taken so far.

The page is a thin shell: it calls into the modules and nothing flows back.

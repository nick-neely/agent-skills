---
name: prototype
description: Build a throwaway prototype to answer a design question. Use when the user wants to see what a UI should look like or compare UI variants, or to check whether a state model, data shape or piece of logic holds up before building it.
---

# Prototype

A prototype is **throwaway code that answers a question**. The question decides the shape, so name it first.

## Choose the prototype type

Decide which question is being asked, from the user's prompt, the ticket and the surrounding code. Ask only when those leave it open and the user is reachable.

| The question | Guide | What the user gets |
| --- | --- | --- |
| "What should this look like?" or "How should this interaction feel?" | [references/ui.md](references/ui.md) | Several divergent variants, live, behind a picker. The user flips through and picks. |
| "Does this state model, data shape or rule hold up?" | [references/logic.md](references/logic.md) | A scenario comparison the agent ran, with a recommendation. The user reads and decides. |

Read the matching guide in full before building. The two produce different artifacts.

Signals when the prompt is ambiguous:

- A page, component, layout, flow or motion is a **UI** question. So is anything the user must see or touch to judge.
- A reducer, state machine, schema, permission rule, pricing rule or API shape is a **logic** question. So is anything the user would judge by its outcomes in edge cases.
- A request with both ("design the snooze flow" where the open issue is when a snoozed item returns) is two questions. Settle the logic first, since the UI depends on it, and say so.

If the question stays ambiguous and the user is away, follow the surrounding code (a backend module is logic; a page or component is UI) and state the assumption in the hand-off.

## Rules for both types

1. **State the question in one sentence** before writing code, and repeat it in the hand-off. A prototype that answers a different question is waste.
2. **Throwaway and marked.** Put the prototype beside the code it informs, follow the project's own routing and file conventions, and name it so a reader sees it is a prototype. Production code never imports from it.
3. **No persistence.** State lives in memory. If the question is about persistence, use a scratch store with an obvious throwaway name.
4. **Fictional data.** Plausible, product-shaped names and numbers, never real customers or secrets.
5. **The choice belongs to the user.** Present the result, recommend when asked or when the guide says to, and pause for the user to choose or request another round.

## Implementation or handoff

Choose the outcome from the user's request and the active task before the first round. If the task already authorizes implementing the piece being prototyped, use same-session implementation. Use handoff when the task ends at the decision, as with a standalone prototype ticket or a request to build later. Follow the project's prototype conventions within that scope, and update the outcome if the user changes the task.

When the user chooses, record the question, decision, and reasons in the ticket or conversation. Then follow the selected outcome.

- **Implement in this session.** Keep the prototype rounds in the current checkout. Once the user chooses, continue directly into implementation under the existing authorization. Build the selected solution in its production location using the project's conventions. Remove prototype-only files, fixtures, and wiring, run the project's checks, and verify the finished behavior through its normal entry point.
- **Hand off for later.** Commit the prototype to a throwaway branch that never merges. Create or update the follow-up implementation ticket with a pointer to the chosen files at a fixed commit when authorized. Otherwise, leave the pointer in the current ticket or conversation.

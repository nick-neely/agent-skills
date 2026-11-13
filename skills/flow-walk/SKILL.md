---
name: flow-walk
description: >-
  Fresh-eyes walk of one user flow in the running app, judging ease: friction,
  copy weight, confusing hierarchy and what can be removed. Use before code
  review when a change alters what a user sees or decides, and when asked to
  "walk this flow", "try this as a user" or get "fresh eyes" on a screen. The
  builder hands one user goal to a tester who knows nothing about the change,
  then sorts the report. It takes no acceptance criteria and keeps no run
  folder, only the report; checking acceptance criteria against requirements with retained
  evidence is the uat skill's job, and correctness belongs to tests and code
  review.
---

# Flow walk

A flow walk is one first-use attempt at a real user goal in the running app, by a tester who knows nothing about how it was built. It asks whether the flow reads easily and what can go. Tests and code review own correctness. Substitute this skill directory's absolute path for `<skill-root>`.

## Project notes

Both roles read the project's flow-walk notes before anything else. They are at the path the project's agent instructions (`AGENTS.md`, `CLAUDE.md` or equivalent) name for flow walks, otherwise at `docs/agents/flow-walk.md`.

Where the notes speak on an item, they replace this skill's default for that item, including its format: follow the notes instead of the default, never both. Where they are silent, or there is no notes file, the default holds. Notes may set:

| Item | Default |
| --- | --- |
| How to open the app at a commit, and its switches | The project's documented dev command |
| User states and how to enter each | The means the project documents; otherwise only what the brief and the visible interface allow |
| Who the users are | An unknown first-time user |
| Differences from production | None assumed; the brief lists any |
| Tester and browser tooling | Any fresh agent or a person; any browser tool that can screenshot, set a viewport and measure the page |
| Design and product guidance for the assess step | None |
| Where walk notes go, and their shape | A "Walk notes" list in the PR, or in the reply when there is no PR, shaped as in handoff step 5 |
| How bugs are filed | The project's issue tracker conventions, or a "Bugs" list in the PR or reply when there is no tracker |
| Where the walk is recorded | The PR's verification section, or the reply when there is no PR |
| Viewports and word thresholds | 1440x900 and 390x844; flag a panel over about 40 words and a page over about 100 words before its main action |

## Choose your role

- **Built the change, or its solution is in your context:** run the handoff below.
- **Fresh conversation, or you received a handoff:** you are the tester. Follow [the walk](references/walk.md) and leave the handoff to the parent.

## Handoff

1. **Qualify.** A change qualifies when it adds or alters a screen, panel, step, state or wording a user meets, including backend work that changes a visible journey. Done: the change qualifies, or the record says why it doesn't.
2. **Prepare.** Finish the feature, confirm its main path works, run its affected tests and commit: a fresh tester starts from committed state. Done: you have a commit SHA whose main path you have used yourself.
3. **Write the goal.** One line each:
   - **Goal:** the user's goal in their own words, scoped to the flow this change touches. It must be achievable at this commit, without anything that will still be closed to real users once this ships, such as buying a plan while purchasing stays switched off.
   - **User state:** who they are when they start, such as signed out or a new account with nothing in it. Use a state the project notes list when they list any.
   - **Start:** where they begin.
   - **Switches:** any environment switch the flow needs, such as one that turns on a real service the app otherwise mocks. Leave the line out when there are none.
   - **Differences:** how this environment differs from what real users get, where it bears on the goal. Leave the line out when there are none.

   Take the goal, state and start from the issue or spec when it has them. Done: a stranger could start from those lines, and nothing in the goal depends on something that will still be closed to real users.
4. **Start a fresh tester.** A fresh agent with none of this conversation's context (a subagent or new session started from the commit), or a person. The brief carries those lines, the path `<skill-root>` and the commit SHA. Everything else stays with you: diff, changed files, rationale, suspected problems and click path each spend the fresh eyes the walk exists for. Use one tester, and run testers one at a time when they share a machine, where parallel walks lose browsers to load. If you can't start a tester without your context, give the brief to the user to run in a new session; you can't walk your own change. Done: the tester is running from that SHA.
5. **Apply findings.** A walk covers a whole goal, so it also reports on screens this change never touched. Filing all of that grows a backlog faster than it closes, so only a bug becomes an issue here. Give each finding the first row that fits:

   | Finding | Disposition |
   | --- | --- |
   | A blocker: the goal can't be reached | Fix it, then start a new tester from step 4. |
   | On a screen, panel, step, state or wording this change altered, inside this change's scope and needing no new owner decision | Apply it, including cuts and reordering, or decline it with a reason. |
   | Needs a new owner decision | A **walk note**, marked `owner decision`. |
   | A bug you reproduced yourself at this commit, which is only one of these: lost input, wrong or contradictory data, a control that does nothing, or a state that can't be left | File it, or comment on the open issue that already covers it. |
   | Everything else, including `taste`, polish and missing features | A walk note. |

   A new owner decision is billing, legal or consent wording not already approved for this change, anything the tester marked `owner decision`, and any change of scope. It stays out of this change. When the change's own acceptance can't be met without one, also put the question to the owner where they decide on the change: the PR, or the reply.

   **Filing a bug.** The issue names the goal, user state and start, and carries the tester's evidence and your reproduction.

   **Walk notes.** One line per note, with nothing nested under it:

   ```markdown
   ## Walk notes
   Walk at `<sha>`. Goal: ... User state: ...

   - **<screen>** (`owner decision` or `taste` where they apply): what the tester saw. Kind: ... Cost: observed or inferred.
   ```

   A walk note is not an issue, and nothing builds it: the owner picks which notes become work.

   Copy any screenshot you'll cite before the tester's workspace is removed.

   Done: every finding is applied, declined with a reason, filed or commented as a reproduced bug, or in the walk notes.
6. **Retest once.** Start another fresh tester with the goal lines, the commit that holds your fixes, and each applied finding's symptom and evidence, with no account of the fix. It reports each one as gone, still there or changed. What remains is recorded as open. Done: every applied finding has a verdict.
7. **Keep it current.** Code review follows the walk. When review changes a visible flow, a fresh tester rechecks that flow once for that change before handoff. A wording-only fix needs no new walk. Done: the last walk's commit shows the same visible flow as the final head, apart from wording.
8. **Record.** The record gets the walk's commit, user state, findings and dispositions with issue references where filed, the walk notes or a link to them, and what the walk couldn't reach. Name the states, older data and failure paths the change touches that no walk reached, so review checks them. Mark a later walk's findings that are already filed or noted as repeats, and count only the rest as new. The tester's "needs your eye" list goes beside it, for the owner. Done: the owner can see from the record what was walked and what still needs a person.

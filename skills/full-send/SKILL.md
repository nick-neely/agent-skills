---
name: full-send
description: Implement an issue or spec through a verified merged PR when the user explicitly asks for full send.
compatibility: Requires the implementation-proof, sol-loop, file-pr and babysit-pr skills. Uses ui-evidence for visible changes.
---

# Full Send

If the user triggered this, it's because they are not watching this thread, and
they want you to complete the work end-to-end autonomously. Your updates and
your final message go unread until long after you stop. You own the work from
its current state to a merged PR.

If the user did not explicitly request "full send" in some clear way, do not
assume full autonomy. If they did, everything below applies.

The user grants you permission to:

- Merge the PR once the merge gate passes.
- Force-push the PR's own branch with `--force-with-lease` after a rebase.
- Use the test methods that Proof needs, without asking first.
- Capture, prepare, and attach relevant UI evidence to this task's PR.
- Add the authenticated GitHub user as an assignee to issues selected for
  implementation in this task, preserving existing assignees.

## Testing permission

A "full send" request is the permission. If a project file or other
instruction says to ask before a test method, or to leave testing to the
user, this request replaces that rule for this task.

That includes ask-first rules for computer use, browser automation,
simulators and devices, running the app or a dev server, screenshots, and
visual checks. Use the method that gives direct proof. List it in the
report.

Rules about how to test still apply. Follow rules that name the correct
command, fixture, or check. This permission only removes the ask-first or
leave-it-to-the-user step. If a preferred method cannot prove the change,
use a gated method under this permission.

It covers only the tests needed for this task. It does not add permission
for the steps under "Asking the user", such as production changes or data
deletion. It also does not bypass a harness or system approval prompt if
one appears.

## Steps

1. **Implement the change.** Read the supplied issue, spec or tickets in full.
   For GitHub issues selected for implementation, follow
   [issue assignment](references/issue-assignment.md) before editing code.
   Make the smallest robust change that fulfills the request.
   Inspect repository instructions, current progress and Git status; preserve
   unrelated work. If on the default branch, create a task branch before editing.
   If the current branch is a layer of a stack, or the request asks for a
   stack, ask the user before editing whether one pull request from a branch
   off the default branch will do: this workflow delivers one pull request
   against the default branch, and its merge gate does not cover a layer that
   sits on another pull request.
   Record the intended base and its merge-base SHA for review. Continue existing
   implementation from its current state rather than restarting it.
   For a change to what a user sees or does, or when the user requests visual
   PR evidence, load the `ui-evidence` skill now to identify claims and plan a
   before/after baseline where useful. Let that skill select the medium and
   whether an asset is useful for the visible claim.

   Follow the `implementation-proof` skill with that issue or spec and the
   recorded merge-base; if it is not installed, ask the user. Settle what its
   first step leaves open yourself, under "Asking the user", and list each
   decision in the report. This workflow delivers one pull request, so its
   Shape entry is always one. Its runtime check falls under "Testing
   permission".
   Reuse observed results that cover unchanged code. Commit only the scoped
   implementation on the task branch.

   Complete this step when the requested behavior is implemented, covering
   checks are accounted for, and the implementation review has no unresolved
   substantive finding. If implementation is already complete, retain its
   evidence and continue with the remaining proof and delivery gates.
2. **Prove it.** Get proof for every change you made. See "Proof". When visual
   evidence is warranted, use `ui-evidence` to capture, prepare and review the
   screenshots or recordings that prove the visible claims.
3. **Get feedback.** Use the `sol-loop` skill to verify changes.
4. **File the PR** with the `file-pr` skill, for this branch alone. Rebase onto
   the latest default branch first. Say how you proved the change where the description keeps
   evidence, such as its template's verification section; only when it has no
   such section, add one short line for it. `file-pr` publishes the warranted
   visual evidence once the PR exists; confirm its publication verification
   passed. This evidence belongs on the PR even when full-send will merge it.
5. **Babysit the PR** with the `babysit-pr` skill. Fix real findings and CI
   failures. Get proof for each fix before you push it. If follow-up commits or
   rebases change the captured UI, refresh the affected PR evidence with
   `ui-evidence` before applying the final gate.
6. **Rewrite the description** for the final head, following `file-pr`'s
   rewrite rule; only the body changes. Do it after the last commit and before
   the merge gate, and again whenever the head changes after it.
7. **Merge** when the merge gate passes.
8. **Report** in your final message: the PR link, the merge commit, your proof,
   the issue assignment outcome, each decision you made for the user, and any
   finding the work left outside the issue.

Stay active from step 1 to step 8. If you end your turn while checks or bots are
pending, the work stops, because nobody will prompt you again. Wait with the
watcher from `babysit-pr`, so something wakes you when the PR changes. In T3
Code that is `watch_pull_request`. If you stop before the merge, call
`unwatch_pull_request` first.

## Proof

Proof is evidence you observed yourself in this session: command output, a
reproduction, a screenshot. Use the most direct proof the change allows:

- Reproduce the original failure, apply the fix, then watch the same
  reproduction pass.
- Run the checks that the repo's CI runs (typecheck, lint, tests).
- Add one focused test that fails without the fix, when the behavior has none
  and the repo has a test setup.
- For UI and runtime behavior, use the result of the runtime check
  `implementation-proof` ran; a fresh tester's report from this session
  counts. When no result from this session covers a change, as on a branch
  that arrived already implemented, choose the runtime check as that skill's
  first step says and run it.
  Green mocked tests do not prove that the user experience works. Where that check was recorded as not run, what you saw
  using the changed path yourself is the proof, and behavior you could not
  observe is unproven. Use `ui-evidence` for warranted screenshots or
  recordings.

When you cannot find a way to prove a change, you do not have full confidence.
Ask the user.

## Merge gate

Full confidence means all of these are true on the latest commit:

- Your proof covers every change in the diff.
- The description was rewritten for the latest commit after its last change.
- Warranted UI evidence reflects the final UI, is attached to the PR, and has
  passed the publication verification required by `ui-evidence`.
- Required checks are green.
- Review bots have finished, and each finding is fixed or dismissed with a
  written reason.
- No human review still requests changes.
- The branch is up to date with the default branch, and GitHub reports it as
  mergeable.

Merge with the method the repo uses. Check the allowed methods and recent merged
PRs. If the repo uses a merge queue or auto-merge, stay until GitHub reports the
PR as merged. Merge through branch protection as configured. Never use `--admin`
or other bypasses. You can ignore automated reviews that request "needs human
review" if you have high confidence in your changes.

## Asking the user

A question in a normal message goes unseen, and the thread looks done. To ask
the user something, use the harness's question tool so the thread shows that
it is waiting: `AskUserQuestion` in Claude Code, `request_user_input` in Codex,
or the question tool your harness has. Put all the context in the question:
the PR link, what blocks you, and the options with your recommendation first.

Ask only when you cannot continue alone:

- You cannot prove the change.
- The current branch is a layer of a stack, or the request asks for one.
- The merge gate cannot pass, and you cannot fix that yourself.
- The next step is outside the grant above: deleting data, touching production,
  changing things outside the repo, closing a PR, or force-pushing any other
  branch.
- The goal is ambiguous in a way that changes the result.
- Another PR makes this one obsolete.

Decide everything else yourself with sensible defaults, and list those decisions
in the report.

If no question tool is available, or the tool returns no answer, take the safe
path: leave the PR open and unmerged, and start your final message with the
question.

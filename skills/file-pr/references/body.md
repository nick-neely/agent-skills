# PR body

The reader decides whether to merge, and may be meeting this change for the first time. Every line either helps that decision or costs them attention. Write the least that lets them trust the change: a section with nothing to say is deleted, never filled with "None" or "N/A", and no section restates the diff. Implementation detail belongs in code, commits or the issue.

## Layout

Use this layout when the repository has no pull request template. Its headings and their order are fixed. In it, `Summary` and `Merge danger` always appear; the other three appear only when they have content.

```markdown
## Summary

<what changed and why>

<at most one sketch>

Closes #<issue>

## UI evidence

<!-- ui-evidence:start -->
<!-- ui-evidence:end -->

## Merge danger

- **Door:** <clean two-way, two-way, one-way or uncertain>
- **Blast radius:** <what breaks if this is wrong>
- **Rollback:** <how to undo or contain it, when the door is not clean two-way>

## Verification

<details>
<summary><the outcome in one line, naming the head commit></summary>

| Commit | Check | Result | Limits |
| --- | --- | --- | --- |
| | | | |

</details>

## Decisions

- **Needs your eye:** <what a person must check or decide before merge>
- <a choice made on the reader's behalf>
```

With a repository template, apply each section's rules below to the template section that does the same job. What has no such section is left out, with four exceptions that go in the template's summary section, or above its first heading when it has none:

- a door that is not `clean two-way`, in one line;
- anything that needs a person, one line each;
- the verification outcome, in one line;
- UI evidence, as the two markers with no heading, or the one line that stands in for them.

## Summary

Say what changed and why in at most 100 words of prose. A problem and its fix often does it: "New threads ignored the configured worktree preference. Now each entry point uses that preference." Proof belongs under Verification and choices under Decisions.

Add one sketch when it makes the change easier to see than prose does, at the level the reader reasons about. Pick the smallest view that carries the point:

| The point is | Show |
| --- | --- |
| What changes inside a shape that already exists | A `diff` block of that shape: the call tree, component tree, file tree or steps, with `+` and `-` lines |
| Logic or an algorithm | Pseudocode |
| Runtime control flow | A call tree |
| UI structure | A component tree, with the state and module boundaries that matter |
| File responsibility or a broad refactor | A shallow file tree |
| How components interact over time | A Mermaid sequence diagram |
| A set of cases and their outcomes | A before/after table |

Keep only the calls, files, props, states and boundaries the point needs. Show a whole block when most of it is new.

When correctness depends on a contract that spans modules, add the two or three entry points in reading order and the invariant they preserve, beside the sketch. A change that one location explains gets neither.

End with the issue line the repository uses, such as `Closes #12`, when the change has an issue.

## UI evidence

Include this section only when something will fill it: an asset `ui-evidence` chose for a change to what a user sees or does, or for a request for visual evidence. The publisher writes between the two markers once the PR exists, so submit them empty and in place. When evidence was warranted but some of it could not be captured or uploaded, add one line naming the claim left unshown. Keep the markers and whatever was published between them; the line replaces the markers only when nothing was published.

## Merge danger

One short phrase per value, never a sentence. A value that needs explaining gets a bullet under Decisions.

- **Door:** one value for the whole change, set by its least reversible part.
  - `clean two-way`: reverting the code restores everything.
  - `two-way`: a revert plus a known cleanup restores everything, such as running a reverse migration, resetting a setting or clearing a cache.
  - `one-way`: nothing available restores it, as with deleted data, a sent message, a charge or a published release.
  - `uncertain`: treat it as one-way until you can tell.
- **Blast radius:** what breaks if the change is wrong, within 12 words, such as "docs only", "one page" or "stored orders". Name the likeliest failure when it is not obvious.
- **Rollback:** only when the door is not `clean two-way`, within 12 words, such as "revert, then clear the cache".

## Verification

Write this for the final head.

The `<summary>` line is the outcome in at most 25 words, naming the head commit, such as "All checks pass on `4f2a9c1`; the acceptance run passed in the browser."

Rows hold only what was observed: the report from the workflow that built the change, when this session has one, and the checks run while filing. Each row is one check a reader would trust the change less without:

- **Commit:** the SHA the result came from, plus "dirty" when the tree had uncommitted changes.
- **Check:** the command, or what was done, such as "acceptance run in the browser" or "ran the migration locally".
- **Result:** what was observed, with ran and skipped counts for a test run.
- **Limits:** where it ran (local, preview or production) and what it does not show.

Fold repeats of one check into one row, and leave out routine steps such as formatting. A report from this session holds for the commit it finished on while nothing has changed since. A result you cannot tie to a commit gets no row: rerun the check on the head or leave it out. More than five rows usually means some of them are not carrying weight.

After the table, add a line only when it applies:

- `Guards shown failing:` the new tests that were seen to fail before they passed, and on which commit.
- `Not verified:` each behavior left unproven and each check that could not run, with what blocked it.

## Decisions

Delete this section when it has no bullet. At most six bullets, in this order:

1. What needs a person, each opening with `**Needs a decision:**` or `**Needs your eye:**`, within 50 words. That covers a choice only they can make, a check a person still has to do before merge, a behavior this change left worse, and a problem found outside the change when it bears on this merge. Other problems found along the way belong in the handoff to whoever asked for the work.
2. Choices made on the reader's behalf that change what users see, change the risk this merge carries, or depart from the request, each within 25 words. State what was chosen, and over what when that is not obvious, so the reader can disagree without asking. "Checked some extra cases" is not a choice.

Review history stays out: a finding that was fixed is in the diff, and a declined one appears only as the choice it left in place. When the reader could not judge a choice without its reason, put the reason in a collapsed block under the bullets:

```markdown
<details>
<summary>Reasons</summary>

</details>
```

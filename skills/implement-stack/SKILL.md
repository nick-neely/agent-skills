---
name: implement-stack
description: Implement a spec, issue, issue set, or free-form request as a dependency-ordered stack of reviewable pull requests.
compatibility: Requires Node.js, git, GitHub CLI with gh stack, and the gh-stack, tdd, and code-review skills.
disable-model-invocation: true
argument-hint: "<issue, spec, or direction>..."
---

# Implement Stack

Implement `$ARGUMENTS` as one or more stacked pull request stories. Apply the
per-layer lifecycle below while this skill controls the branch and stack
boundaries. Load the supporting model-invoked skills at their named steps:

- Run $gh-stack before choosing layers, then follow it for stack design,
  commands, recovery, synchronization, and submission.
- Run $tdd at the pre-agreed seams during implementation.
- Run $code-review against each branch's parent before the layer is complete.

Plan the stack before editing. Build each concern on its owning branch instead of
implementing everything together and splitting the diff afterwards.

## 1. Ground the work

Replace `<skill-root>` with the directory containing this skill's `SKILL.md`,
then run the deterministic preflight before inspecting or changing files:

```sh
node "<skill-root>/scripts/preflight.mjs" --live --json
```

Run the command through the harness's host or escalated path when GitHub network
access is sandboxed. The script installs and configures nothing. A dirty worktree
and disabled `rerere` are warnings; every failed required check blocks the run.

- Read every supplied issue, spec, and direction in full. Fetch live tracker
  state when the input names tickets.
- Inspect the repository instructions, current branch, worktree, relevant code,
  and available test and verification commands.
- Preserve unrelated worktree changes. Stop only when overlap makes safe branch
  ownership impossible or the requested behavior has material ambiguity.
- Treat `gh stack init` as the authoritative repository-availability check when
  preflight reports that the current branch is not yet stacked. Exit code 9
  blocks the run before file edits.

This step is complete when every requested behavior and repository constraint is
accounted for in the stack plan.

## 2. Design the review story

Choose the smallest dependency-ordered set of layers that makes each pull
request understandable and useful:

- Keep one coherent feature or project in a stack. Put independent work in
  separate stacks rather than forcing a linear dependency.
- For several issues, use one layer per issue only when issue boundaries also
  form a clean dependency and review boundary.
- For one large issue, split at real seams such as prerequisite refactoring,
  domain behavior, integration, or a distinct consumer. Prefer end-to-end
  behavior over arbitrary file or architecture layers.
- Give every layer a one-sentence purpose. Each layer must be independently
  reviewable, pass the checks its diff implicates, and leave its parent in a
  coherent state.
- Put shared foundations below their consumers. Assign each planned code change,
  test, migration, and document to one owning layer before implementation.
- Follow repository branch conventions. Otherwise use a shared topic prefix and
  a specific concern suffix.

Proceed without a planning checkpoint unless a product choice would materially
change the stack or implementation.

## 3. Create the stack first

Start the bottom branch with `gh stack init <branch>...` before writing code.
Implement bottom to top. Add the next branch only after the current layer is
committed and its worktree is clean.

When continuing an existing stack, inspect it with `gh stack view --json` and
check out the branch that owns a change before editing. After changing a lower
layer, rebase every branch above it and return to the top.

## 4. Implement each layer

For each branch, apply a tight implementation loop:

1. Run $tdd at the pre-agreed seams, one red-green vertical slice at a time.
2. Typecheck and run focused tests regularly while implementing.
3. Run every focused gate needed to show that this layer is independently green.
4. Stage deliberately and commit the candidate layer to its current branch.
5. Run $code-review against the parent branch. Fix every actionable finding on
   the owning layer, rerun its gates, and commit the fixes with intentional
   history.
6. Confirm the layer has one review story and a clean worktree, then create the
   next branch.

Tests for a layer's behavior belong in that layer. Reserve a final integration
layer for behavior that genuinely requires the complete stack.

## 5. Verify the complete stack

From the top branch, run the repository's full test suite once and every final
verification lane implicated by the complete diff.

Attribute a failure to its owning layer. Check out that branch, fix and commit it,
rebase the upstack branches, return to the top, then rerun the affected checks and
the final verification. Inspect each branch diff against its parent so lower-layer
work has not leaked into a later review.

This step is complete only when every layer is reviewable on its own and the top
of the stack passes the full verification contract.

## 6. Submit the pull requests

Treat invocation of this skill as authorization to push the planned stack and
create its pull requests after local verification. It does not authorize merging.

- Use `gh stack submit --auto` to create draft pull requests by default. Use
  `--open` only when the user asked for ready-for-review pull requests.
- Give each pull request a layer-scoped title and body. Include its purpose,
  parent dependency, verification, issue links, and stack position.
- Use `Closes #N` only on the layer that fully delivers that issue. Use a
  non-closing issue reference on prerequisite or partial layers.
- Confirm the final branch order, bases, pull request URLs, and states with
  `gh stack view --json`.

## Done

Report the stack bottom to top with each pull request URL, its purpose, its local
verification, and any remaining external checks. All planned layers are
committed, locally green, submitted, and represented in the reported stack.

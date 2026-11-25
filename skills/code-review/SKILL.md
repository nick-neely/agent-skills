---
name: code-review
description: "Review the changes since a fixed point (commit, branch, tag, or merge-base) along two axes: Standards (does the code follow this repo's documented coding standards?) and Spec (does the code match what the originating issue/spec asked for?). Runs both reviews in parallel sub-agents and reports them side by side. Use when the user wants to review a branch, a PR, work-in-progress changes, or asks to \"review since X\"."
---

Review the branch, PR, or implementation in progress along two axes:

- **Standards**: does the code conform to this repo's documented coding standards?
- **Spec**: does the code faithfully implement the originating issue / spec?

Both axes run as **parallel sub-agents** so they don't pollute each other's context, then this skill aggregates their findings. Start every sub-agent with a fresh context window.

## Process

### 1. Identify the change under review

Use the comparison point supplied by the user or calling workflow, or the
PR's base branch. If the caller has just implemented the ticket and all of
that work is uncommitted, use `HEAD`. If the implementation includes commits,
use the known pre-implementation commit or the feature branch's base. Ask only
when you cannot establish which changes belong to the request. Resolve the
base to a commit and record `git merge-base <base> HEAD`.

- **Branch or PR review:** inspect `git diff <merge-base> HEAD` and
  `git log <merge-base>..HEAD --oneline`.
- **Implementation or work-in-progress review:** use the same base and inspect
  `git diff <merge-base>` for the current tracked contents, including local
  edits. Use `git status --short --untracked-files=all` to find
  new files and read the in-scope ones directly. Keep unrelated local work
  out of the review.

Pass the exact comparison, scope, and relevant new file paths to each reviewer.
Report an empty change only after checking the requested scope.

### 2. Identify the spec source

Start with the ticket or spec supplied by the caller, including acceptance
criteria already fetched during implementation. Otherwise look for issue
references in the branch or commit messages and use the project's tracker
workflow, or look for a matching spec under `docs/`, `specs/`, or `.scratch/`.
If the source is unclear, ask. If there is no spec, run the Standards review
alone and say why the Spec review was skipped.

### 3. Identify the standards sources

Search the repo for every file that documents how code should be written. When `CODING_STANDARDS.md` or `CONTRIBUTING.md` exists, it must be on the list.

On top of whatever the repo documents, the Standards axis always carries the **smell baseline** below: a fixed set of Fowler code smells (_Refactoring_, ch.3) that applies even when a repo documents nothing. Two rules bind it:

- **The repo overrides.** A documented repo standard always wins; where it endorses something the baseline would flag, suppress the smell.
- **Always a judgement call.** Each smell is a labelled heuristic ("possible Feature Envy"), never a hard violation. Like any standard here, skip anything tooling already enforces.

Use these possible remedies only when they simplify a concrete caller or address a demonstrated problem:

- **Mysterious Name**: a function, variable, or type whose name doesn't reveal what it does or holds. → rename it; if no honest name comes, the design's murky.
- **Duplicated Code**: the same logic shape appears in more than one hunk or file in the change. → extract the shared shape, call it from both.
- **Feature Envy**: a method that reaches into another object's data more than its own. → move the method onto the data it envies.
- **Data Clumps**: the same few fields or params keep travelling together (a type wanting to be born). → bundle them into one type, pass that.
- **Primitive Obsession**: a primitive or string standing in for a domain concept that deserves its own type. → give the concept its own small type.
- **Repeated Switches**: the same `switch`/`if`-cascade on the same type recurs across the change. → replace with polymorphism, or one map both sites share.
- **Shotgun Surgery**: one logical change forces scattered edits across many files in the diff. → gather what changes together into one module.
- **Divergent Change**: one file or module is edited for several unrelated reasons. → split so each module changes for one reason.
- **Speculative Generality**: abstraction, parameters, or hooks added for needs the spec doesn't have. → delete it; inline back until a real need shows.
- **Message Chains**: long `a.b().c().d()` navigation the caller shouldn't depend on. → hide the walk behind one method on the first object.
- **Middle Man**: a class or function that mostly just delegates onward. → cut it, call the real target direct.
- **Refused Bequest**: a subclass or implementer that ignores or overrides most of what it inherits. → drop the inheritance, use composition.

### 4. Spawn both sub-agents in parallel

Issue both sub-agent calls together, in the foreground, and aggregate the reports they return.

**Standards sub-agent prompt** should include:

- The comparison from step 1, including the commit list where relevant.
- The standards files and the smell baseline from step 3. Pass both to the
  fresh reviewer.
- Cite the file and rule for a documented violation. For a possible smell,
  identify the affected caller or example and explain the cost of the current
  design. Consider whether removing or inlining code would preserve the
  required distinctions. Suggest a new type, guard, or abstraction only when
  it makes an existing use clearer or fixes a concrete failure. Omit
  preferences without a demonstrated benefit and issues tooling enforces.
  Label judgement calls as such. Keep the report under 400 words.

**Spec sub-agent prompt** should include:

- The same comparison, the ticket or spec, and its acceptance criteria.
- Trace each changed behavior from the edited path to other entry points and
  consumers that share the requirement. Search outside the diff for callers,
  parallel handlers, and contract declarations as relevant. Check whether
  each already gets the change through shared code or intentionally has a
  different contract.
- Report missing, partial, incorrect, or unrequested behavior. For each
  finding, cite the requirement or scope boundary, the source path, and a
  concrete input or action with its expected and actual effect. An unchanged
  path warrants a finding when it falls under the requirement and still
  exposes the old behavior. Keep the report under 400 words.

If the spec is missing, skip the Spec sub-agent and note this in the final report.

### 5. Aggregate

Present the two reports under `## Standards` and `## Spec` headings, verbatim or lightly cleaned. Do **not** merge or rerank findings, because the two axes are deliberately separate (see _Why two axes_).

End with a one-line summary: total findings per axis, and the worst issue _within each axis_ (if any). Don't pick a single winner across axes: that's the reranking the separation exists to prevent.

## Why two axes

A change can pass one axis and fail the other:

- Code that follows every standard but implements the wrong thing → **Standards pass, Spec fail.**
- Code that does exactly what the issue asked but breaks the project's conventions → **Spec pass, Standards fail.**

Reporting them separately stops one axis from masking the other.

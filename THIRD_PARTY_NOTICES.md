# Third-party notices

## Workflow downloads

The generated workflows redistribute three external skills at the revisions
in [external-skills.json](external-skills.json). Each download includes its
upstream license.

- `gh-stack` from [github/gh-stack](https://github.com/github/gh-stack), MIT.
- `gh-fix-ci` from [openai/skills](https://github.com/openai/skills), Apache-2.0.
- `setup-matt-pocock-skills` from [mattpocock/skills](https://github.com/mattpocock/skills), MIT.

## Tstack workflows

`skills/babysit-pr`, `skills/file-pr`, `skills/full-send`, `skills/full-stop`,
`skills/sol-loop` and `skills/leaving-pr-comments` incorporate ideas and adapted
instructions from [t3dotgg/tstack](https://github.com/t3dotgg/tstack), MIT licensed,
at commit `7de017b3fc9d50c03cf3ecb98fb71e0ca65a78bd`. Each directory includes the
upstream license.

Reviewed upstream changes through `11e37a74d0a6868c121cd0910ab2b3bd9873b92a`.
`full-stop` incorporates the closing "Full stop." invocation fix from
`92e38e2cf677a84a142e8df296861c588542135c`. The two later changes affect only
`council`, which this collection does not include. The other five adapted
workflows are unchanged upstream since the original baseline.

The adaptations give babysit three routine PR-bot rounds, with evidenced
high-impact extensions bounded at five total, a persistent finding ledger and
focused follow-up reviews. They separate event notification from repository
readiness policy and use a portable REST event waiter instead of the upstream
bot-specific readiness watcher. `file-pr` carries its own body format and calls
`ui-evidence` for visible changes. The format's guidance on choosing a Summary
sketch is adapted from the `pr` skill in
[mattpocock/skills](https://github.com/mattpocock/skills), MIT licensed, at
`4ae2317ddb22b046e26455e4f9c9b3aaaf62212d`, which credits the `show-me` skill in
[humanlayer/skills](https://github.com/humanlayer/skills), also MIT licensed;
the `file-pr` license file carries both copyright notices. `sol-loop` retains
upstream's Sol requirement, concrete reviewer routes, scope checks, budget
extensions and push gate. It judges findings by material impact, keeps its
reviewer brief and routing reference separate, and makes public attribution
optional. `leaving-pr-comments` follows project attribution rules and adds
target checks, retry deduplication and saved-comment readback.

`full-send` adds an implementation step that loads the supplied issue/spec,
continues current progress, and follows the `implementation-proof` skill
before proof and PR delivery. `full-stop` uses that same workflow with its
existing prohibition on merging. The implementation practice lives in that
shared skill because Matt Pocock's `implement` skill is manual-only and other
skills cannot invoke it. The remaining Tstack delivery rules are retained.
Both delivery workflows use `ui-evidence` when visual proof is warranted,
leave publication of the reviewed assets to `file-pr` once the PR exists, and
refresh affected evidence before handoff or merge when the UI changes.
They also add the authenticated GitHub user to selected implementation issues
through `gh`, preserving existing assignees and verifying the saved assignment.

## Matt Pocock skills

`skills/to-spec` and `skills/to-tickets` are based on
[`mattpocock/skills`](https://github.com/mattpocock/skills), licensed under the
MIT License. Each skill directory includes a copy of the upstream license.

The current upstream baseline is `v1.3.2` (`d1478fc`), reviewed through
`4ae2317ddb22b046e26455e4f9c9b3aaaf62212d`. The Codex metadata in both skills
matches upstream. Both include the release's punctuation and tracker setup
wording. `to-tickets` distinguishes native blocking edges from parent/sub-issue
relationships and omits the body blocker section when native edges are set.

My changes are deliberately narrow:

- `to-spec` applies the `documentation` label instead of `ready-for-agent`.
- `to-tickets` preserves native parent/sub-issue relationships when the tracker
  supports them, and directs execution through the ticket frontier.
- Both replace em dashes with plain hyphens to match this repository's writing
  convention.

`skills/implement` adapts the upstream skill at
`4ae2317ddb22b046e26455e4f9c9b3aaaf62212d` and includes its MIT license.
It keeps manual invocation and the closing commit, and hands the method to
`implementation-proof`.

`skills/implement-spec` adapts the upstream skill at
`4ae2317ddb22b046e26455e4f9c9b3aaaf62212d` and includes its MIT license. It
keeps the integration branch, the task-graph frontier, fresh subagents per
ticket and the closing `code-review`, repeated in rounds until one finds
nothing substantive or the review limit is reached, with what is left open
reported. Each implementer follows `implementation-proof` instead of
calling `tdd` directly, after a planning pass that asks every open question in
one stop. Each ticket lands as one commit, and the integration branch advances
only once the project's required checks pass, except for wide-refactor batches
that go green only at a final integrate-and-verify ticket: those advance on
their own tests, and the required checks gate that final ticket. Acceptance
criteria that span tickets get one runtime check on the integrated build. The
skill opens no pull request: it leaves one integration branch, or a short stack
cut at ticket boundaries, for the user to file.

`skills/tdd` adapts the upstream skill at
`4ae2317ddb22b046e26455e4f9c9b3aaaf62212d` and includes its MIT license. Its
two reference files are unchanged apart from moving under `references/`. The
skill takes seams a calling workflow has already settled instead of confirming
them again, states the seam-placement rule itself in place of a call to the
upstream `codebase-design` skill, runs only the test at hand each cycle and the
affected tests once a slice is green, and names no other skill.

`skills/implementation-proof` carries the method that grew out of that adapted
skill and includes the same MIT license. It states what the work must prove
before editing, adds a reference for choosing test techniques by risk, runs
the runtime check the change calls for, and calls `comment-audit` before
`code-review`.

`skills/code-review` adapts the same repository's two-axis review at
`4ae2317ddb22b046e26455e4f9c9b3aaaf62212d` and includes its MIT license.
It carries the implementation ticket and uncommitted work into review, asks
for a concrete benefit before recommending a refactor, checks untouched entry
points that share a requirement, and marks each finding a caller passes from an
earlier round resolved or still open.

`skills/prototype` is based on the same repository's `prototype` skill at
`321658273cb1d20b76026717d027d505790106d4`, and on Emil Kowalski's skill of the
same name (see below). It keeps the upstream name so skills that call
`prototype` reach it. From Matt Pocock's skill it retains the question-first
router, the shared rules (throwaway and marked, no persistence, capture on a
throwaway branch with a pointer on the implementation ticket), the preference
for mounting UI variants inside an existing page, and the logic branch's pure,
liftable module.

My changes:

- The UI branch follows Emil Kowalski's method and picker instead of the
  upstream `?variant=` bar.
- The logic branch no longer hands the user a clickable demo by default. The
  agent runs the scenarios through each candidate and reports a comparison
  with a recommendation; the single-file demo remains on request.
- "Skip the polish" is replaced by Emil Kowalski's rule that every UI variant
  fully works.
- Branch files live under `references/`.

The workflow downloads also include the pinned upstream
`setup-matt-pocock-skills` listed above.

## Emil Kowalski skills

`skills/prototype` incorporates the `prototype` skill from
[`emilkowalski/skills`](https://github.com/emilkowalski/skills), licensed under
the MIT License, at commit `0f2e23b32bb1265e84cff8d3e75785fec953fb1b`. The
skill's `LICENSE` carries both upstream notices.

`references/picker.md` is upstream's `PICKER.md`: the styles, behavior contract
and reference wiring are unchanged. Its buttons gain `type="button"`, so a
picker mounted inside a form does not submit it, and em dashes in its prose
became hyphens. `references/ui.md` adapts upstream's `SKILL.md`: divergence on
a named axis, the per-variant craft bar, the scope, recon, directions, harness,
verify and riff-or-keep phases, and the hand-off table.

My changes to the UI method:

- It runs as one branch of a router, so the slash-command-only flag and the
  fixed first reply are removed and other skills can call it.
- A chosen prototype is captured on a throwaway branch and linked from the
  implementation ticket, instead of deleted.
- Variants mount inside an existing page when one can host them.
- A ticket with several decisions gets one run per decision over a shared
  context.
- References to Emil Kowalski's other skills are dropped; this collection
  does not include them.

## DejaVu Sans

`skills/ui-evidence/assets/DejaVuSans.ttf.base64.txt` ships the original TrueType
font as text so it survives Pack hosting. The font is part of the
[DejaVu fonts](https://dejavu-fonts.github.io/). DejaVu's own changes are in the
public domain; the underlying glyphs are covered by the Bitstream Vera and Arev
copyrights. The full license is at
`skills/ui-evidence/assets/DejaVuSans-LICENSE.txt`.

The font is bundled and referenced explicitly so annotation text renders
identically on every machine. Without it, output depends on whatever fonts the
host happens to have, and a container with none renders empty boxes.

# Agent skills

Portable agent skills I use across projects, published as source.

Each skill is Markdown plus any scripts and references it calls. Most work
with any agent that reads `SKILL.md`; runtime restrictions and dependencies
are listed in each skill. Nothing here depends on one private project or one
machine.

## Install

With the [`skills`](https://www.skills.sh) CLI:

```sh
npx skills add nick-neely/agent-skills --list          # see what's here
npx skills add nick-neely/agent-skills --skill uat --global
```

Or install by hand: clone the repo and symlink the skill directory into your
agent's skills directory (`~/.claude/skills/`, `~/.codex/skills/`, and so on).

```sh
git clone https://github.com/nick-neely/agent-skills.git
mkdir -p ~/.claude/skills
ln -s "$PWD/agent-skills/skills/uat" ~/.claude/skills/
```

Skills that shell out have their own runtime dependencies, listed in each
`SKILL.md`. `ui-evidence` checks its own up front with
`scripts/preflight.mjs`.

Some skills call others by name. When you install one skill at a time, read
its `compatibility` line and install what it requires. `implement`,
`full-send` and `full-stop` all need `implementation-proof`, which needs
`comment-audit`, `code-review` and the external `tdd`.

## Skills

### Plan and implement

- [`to-spec`](skills/to-spec/) - Synthesize the current conversation into a spec
  and publish it to the issue tracker.
- [`to-tickets`](skills/to-tickets/) - Break a spec or plan into tracer-bullet
  tickets that declare their blocking edges.
- [`prototype`](skills/prototype/) - Answer a design question with throwaway
  code: divergent UI variants behind a live picker, or candidate logic models
  run through scenarios with a recommendation.
- [`implement`](skills/implement/) - Implement a ticket or spec through
  `implementation-proof`, asking any open question once up front, then commit.
- [`implement-stack`](skills/implement-stack/) - Implement a spec, issue set, or
  free-form request as a reviewable stack of pull requests.
- [`implement-program`](skills/implement-program/) - Deliver dependency-linked
  tickets through child pull requests into one human-gated integration pull request.
- [`ship-spec`](skills/ship-spec/) - Claude Code only. Deliver every issue in a
  GitHub spec as a resumable orchestrated loop.
- [`jira-acli`](skills/jira-acli/) - Read, plan, and update Jira work items through
  Atlassian ACLI, with Markdown conversion, backups, and verified description
  and link writes. Requires local Jira authentication and explicit write intent.

### Review and deliver

- [`comment-audit`](skills/comment-audit/) - Review relevant comments and
  report a table of recommended actions. Request edits to apply them, as
  `implementation-proof` does before code review.
- [`code-review`](skills/code-review/) - Review implementation changes against
  project standards and the spec, including callers outside the diff.
- [`babysit-pr`](skills/babysit-pr/) - Monitor CI and review bots, address
  findings, and stop within a bounded review budget.
- [`file-pr`](skills/file-pr/) - Review the branch diff, reuse or open a PR
  whose body leads with a summary and UI evidence, then merge danger,
  verification and decisions, and attach warranted screenshots.
- [`full-send`](skills/full-send/) - Implement an issue or spec through
  `implementation-proof`, then prove, file, babysit and merge.
- [`full-stop`](skills/full-stop/) - Follow the same implementation and
  delivery workflow, leaving the PR ready for the user to merge.
- [`leaving-pr-comments`](skills/leaving-pr-comments/) - Write and verify
  evidence-backed GitHub comments and review replies.
- [`sol-loop`](skills/sol-loop/) - Run bounded independent code review with
  Sol through explicit T3 or native reviewer routes.

### Test flows and prepare visuals

- [`flow-walk`](skills/flow-walk/) - For a new or reshaped user flow, hand one
  user goal to a fresh tester before code review, and sort its report on
  friction, copy weight and hierarchy.
- [`uat`](skills/uat/) - Test acceptance criteria and explore user workflows
  with agent-browser, retaining reproducible findings and responsive checks.
- [`ui-evidence`](skills/ui-evidence/) - Capture, prepare, annotate, compare, and publish
  UI screenshots and video into a pull request or issue.
- [`generated-image-assets`](skills/generated-image-assets/) - Remove an image's
  background, verify the alpha edges, and size it for shipping.

### Shared methods

A shared method holds a discipline that several skills follow, so the rule
lives in one place. You don't invoke one yourself: install it alongside the
skills that name it.

- [`implementation-proof`](skills/implementation-proof/) - The method behind
  `implement`, `full-send` and `full-stop`: state what the work must prove,
  build it test-first, check it running when the change calls for it, then
  audit comments and review.

Several workflows call separately installed skills. Read their `SKILL.md`
before use; installing this collection does not install external skills or tools.

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for upstream sources,
licenses, and customization notes.

## Layout

```text
skills/<skill-name>/
  SKILL.md            required
  agents/openai.yaml  required
  scripts/            optional
  references/         optional
  assets/             optional
```

Everything a skill references lives inside its own directory. No shared
libraries between skills, no links that escape the skill root.

## Validate

```sh
./scripts/validate
```

Run from Bash with Node.js 22+, Git, and Python 3. FFmpeg, ffprobe, and
ImageMagick enable the media behavior tests; set `UI_EVIDENCE_REQUIRE_MEDIA=1`
to fail when required media tools are unavailable. Live browser tests are opt-in.
See [CONTRIBUTING.md](CONTRIBUTING.md) for test controls.

The gate checks skill layout, metadata, local references, portability, writing
conventions, licenses, executable modes, script syntax, and symlink containment,
then runs negative fixtures and behavior tests. CI runs it on Linux, macOS,
and Windows, requiring media coverage on Linux.

## Contributing

Skills are curated, not accepted by default - see
[CONTRIBUTING.md](CONTRIBUTING.md) for what belongs here and what does not.

## License

MIT, except where a skill directory carries its own LICENSE. See
[LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

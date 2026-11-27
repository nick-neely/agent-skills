# Agent skills

Portable agent skills I use across projects, published as source.

Each skill is Markdown plus any scripts and references it calls. Most work
with any agent that reads `SKILL.md`; runtime restrictions and dependencies
are listed in each skill. Nothing here depends on one private project or one
machine.

## Install

Choose **Install** beside a skill in the [catalog](#skills), then copy its
[Skills CLI](https://www.skills.sh/docs/cli) command and select your agent. A
workflow recipe includes the skills it calls, including companions for
conditional paths. Standalone recipes install one skill.

The recipes use `--global` to install for your user across projects. For an
install in just one project, run the command from that project and omit
`--global` from every `add` line.

| To do this | Global | Project |
| --- | --- | --- |
| List installed skills | `npx skills list --global` | `npx skills list` |
| Update installed skills | `npx skills update --global` | `npx skills update --project` |
| Remove an installed skill | `npx skills remove --global <skill>` | `npx skills remove <skill>` |

To migrate from a `skills.sh/p/...` Pack, run the current workflow install
command once with the same scope and agent. Future updates then use the
workflow published from this repository, including its reviewed versions of
external skills. Direct source installs update from their respective repositories.

Pass a skill name to `update` to refresh just that skill. When a workflow adds
members, rerun its install command to pick them up. Remove retired members
individually after checking whether another workflow uses them.
[Skills CLI command reference](https://github.com/vercel-labs/skills/blob/main/docs/commands.md)

<details>
<summary>Manual install with symlinks</summary>

Clone the repository and symlink each needed skill directory into your agent's
skills directory. The [install recipes](docs/install.md) list the skill names
and sources for each workflow.

```sh
git clone https://github.com/nick-neely/agent-skills.git
mkdir -p ~/.claude/skills
ln -s "$PWD/agent-skills/skills/uat" ~/.claude/skills/
```

</details>

## Skills

### Plan and implement

- [`to-spec`](skills/to-spec/) ([Install](docs/install.md#to-spec)) - Synthesize the current conversation into a spec
  and publish it to the issue tracker.
- [`to-tickets`](skills/to-tickets/) ([Install](docs/install.md#to-tickets)) - Break a spec or plan into tracer-bullet
  tickets that declare their blocking edges.
- [`prototype`](skills/prototype/) ([Install](docs/install.md#prototype)) - Answer a design question with throwaway
  code: divergent UI variants behind a live picker, or candidate logic models
  run through scenarios with a recommendation.
- [`implement`](skills/implement/) ([Install](docs/install.md#implement)) - Implement a ticket or spec through
  `implementation-proof`, asking any open question once up front, then commit.
- [`implement-spec`](skills/implement-spec/) ([Install](docs/install.md#implement-spec)) - Implement a whole spec from its
  ticket graph on one integration branch, a fresh implementer per ticket
  following `implementation-proof`, ready to file as one PR or a short stack.
- [`tdd`](skills/tdd/) ([Install](docs/install.md#tdd)) - Build test-first in red-green slices at agreed seams,
  with a reference on what makes a test worth keeping.
- [`jira-acli`](skills/jira-acli/) ([Install](docs/install.md#jira-acli)) - Read, plan, and update Jira work items through
  Atlassian ACLI, with Markdown conversion, backups, and verified description
  and link writes. Requires local Jira authentication and explicit write intent.

### Review and deliver

- [`comment-audit`](skills/comment-audit/) ([Install](docs/install.md#comment-audit)) - Review relevant comments and
  report a table of recommended actions. Request edits to apply them, as
  `implementation-proof` does before code review.
- [`code-review`](skills/code-review/) ([Install](docs/install.md#code-review)) - Review implementation changes against
  project standards and the spec, including callers outside the diff.
- [`babysit-pr`](skills/babysit-pr/) ([Install](docs/install.md#babysit-pr)) - Monitor CI and review bots, address
  findings, and stop within a bounded review budget.
- [`file-pr`](skills/file-pr/) ([Install](docs/install.md#file-pr)) - Review the branch diff, reuse or open a PR
  and attach warranted UI evidence. Without a repository template, the body
  leads with a summary and UI evidence, then merge danger, verification and
  decisions.
- [`full-send`](skills/full-send/) ([Install](docs/install.md#full-send)) - Implement an issue or spec through
  `implementation-proof`, then prove, file, babysit and merge.
- [`full-stop`](skills/full-stop/) ([Install](docs/install.md#full-stop)) - Follow the same implementation and
  delivery workflow, leaving the PR ready for the user to merge.
- [`leaving-pr-comments`](skills/leaving-pr-comments/) ([Install](docs/install.md#leaving-pr-comments)) - Write and verify
  evidence-backed GitHub comments and review replies.
- [`sol-loop`](skills/sol-loop/) ([Install](docs/install.md#sol-loop)) - Run bounded independent code review with
  Sol through explicit T3 or native reviewer routes.

### Test flows and prepare visuals

- [`flow-walk`](skills/flow-walk/) ([Install](docs/install.md#flow-walk)) - For a new or reshaped user flow, hand one
  user goal to a fresh tester before code review, and sort its report on
  friction, copy weight and hierarchy.
- [`uat`](skills/uat/) ([Install](docs/install.md#uat)) - Test acceptance criteria and explore user workflows
  with agent-browser, retaining reproducible findings and responsive checks.
- [`ui-evidence`](skills/ui-evidence/) ([Install](docs/install.md#ui-evidence)) - Capture, prepare, annotate, compare, and publish
  UI screenshots and video into a pull request or issue.
- [`generated-image-assets`](skills/generated-image-assets/) ([Install](docs/install.md#generated-image-assets)) - Remove an image's
  background, verify the alpha edges, and size it for shipping.

### Shared methods

A shared method holds a discipline that several skills follow, so the rule
lives in one place. You don't invoke one yourself: install it alongside the
skills that name it.

- [`implementation-proof`](skills/implementation-proof/) ([Install](docs/install.md#implementation-proof)) - The method behind
  `implement`, `implement-spec`, `full-send` and `full-stop`: state what the
  work must prove, build it test-first, check it running when the change calls
  for it, then audit comments and review.

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

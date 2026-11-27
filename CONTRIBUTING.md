# Contributing

This is a curated collection, not an open catalog. I merge skills I will
actually use and maintain. Open an issue before building something large, so
neither of us wastes the effort.

Fixes are easier: bug reports, portability breaks, and corrections to an
existing skill are welcome without discussion first.

## What belongs here

A skill qualifies when it is:

- **Generalized.** It works in any repo, not just the one it came from.
- **Complete.** `SKILL.md` plus every script and reference doc it calls,
  committed alongside it.
- **Self-contained.** Nothing outside the skill directory, nothing untracked.
- **Attributed.** Third-party work carries its upstream license and an entry in
  `THIRD_PARTY_NOTICES.md`.

Never commit:

- secrets, credentials, tokens, customer data, or private product context;
- absolute `/home/...`, `/Users/...`, or Windows user-profile paths;
- agent-runtime install paths like `~/.claude/skills/...` (use `<skill-root>`);
- runtime state from Claude Code, Codex, Cursor, or the skills CLI.

The validator checks layout, references, install paths, machine-specific paths,
and attribution conventions. Review content for secrets, private context, and
runtime state before committing; these require judgment.

## Writing a skill

Frontmatter carries these keys:

```yaml
---
name: my-skill # must match the directory name
description: What it does, and the triggers that should invoke it.
compatibility: Tools and runtimes it needs, if any.
metadata:
  requires: other-skill
  uses: third-skill owner/repo@outside-skill
disable-model-invocation: true # slash-command only, no implicit invocation
argument-hint: "<arg> [--flag]"
---
```

`metadata` lists the skills a skill depends on; see "Skills that call skills".
The validator also accepts `license`, `allowed-tools` and `model` from the
Agent Skills specification.

`description` is the only thing an agent sees before deciding whether to load
the skill, so spend the words there. Name the triggers explicitly.

Then:

- **Write for an agent, not a human reader.** Imperative, specific, no
  throat-clearing. State the failure mode when it is not obvious.
- **Use `<skill-root>` for paths into your own directory**, and tell the agent
  to substitute it. Install locations differ per agent.
- **Push the deterministic work into scripts.** Prose is for judgment.
- **Plain hyphens, never em dashes.** Enforced.
- **Add `agents/openai.yaml`** with `display_name` and `short_description`. Set
  `policy.allow_implicit_invocation: false` for slash-command-only skills.

Reference docs go in `references/` and stay linked from `SKILL.md` - they exist
so the main file stays short enough to load cheaply.

## Skills that call skills

Skills split on who can invoke them:

- A **user-invoked** skill sets `disable-model-invocation: true`. Only a person
  typing its name reaches it, so no other skill can call it.
- Any other skill is **model-invoked**: an agent can reach it when the task
  fits, and so can another skill.

A skill may call model-invoked skills only; the validator rejects a call to a
user-invoked one. Write a call in one of the forms it reads: `Call the Skill
tool with "name"`, `call "name"`, `$name`, or one of the verbs call, use,
follow, run, load, read or invoke with the skill named, as in ``follow the
`name` skill``. A slash form such as `/name` addresses the person and is not a
call.

Declare every skill a skill calls under `metadata`, as space-separated names:
`requires` for skills it cannot work without, and `uses` for skills only some
paths reach. A skill from another repository is written `owner/repo@skill`.
`compatibility` stays for tools and runtimes, and `metadata` is a block holding
only those two keys, with bare unquoted names.

Naming another skill of this repository in a skill's prose counts as depending
on it. A skill is named by `` `name` `` or `` `/name` `` in backticks, `$name`,
or `"name"` in double quotes; an outside skill is also named by its full
`` `owner/repo@skill` ``. Write a skill's name another way, or reword, when
you mean the word and not the skill. A `$word` in prose that starts with a
letter is read as a call to a skill, so keep shell variables inside code. The validator fails on a skill that is
named but not declared, a declared skill that does not exist, a declaration
the skill never names, and a `requires` cycle.

When two skills need the same method, put it in a model-invoked skill whose
description names its callers and list it under "Shared methods" in
`catalog.json`.

## The skill catalog

`catalog.json` is the human-facing catalog. The README `## Skills` section
and the landing site both read it, so `SKILL.md` stays a portable payload
written for agents. It holds ordered `categories`, each with a `title`, an
optional `intro` paragraph and ordered `skills`:

```json
{ "name": "my-skill", "summary": "What it does, for a person choosing a skill.", "featured": false }
```

Write `summary` as one line for a reader browsing the catalog, not as
triggers; inline code in backticks is fine. `featured` marks the skills the
site highlights. Every skill directory appears exactly once. After editing
the catalog, regenerate the README section between its markers:

```sh
node scripts/validate-skills.mjs --write-readme
```

The site in `site/` builds its pages from the same files at deploy time: a
page per catalog entry, with dependencies from `metadata`, requirements from
`compatibility` and members from `packs/`. A new skill needs nothing extra for
the site. A skill under the "Shared methods" category is shown as a shared
method rather than a workflow. `./scripts/validate` also runs the site check
when the site's dependencies are installed (`pnpm --dir site install`).

## Workflow Packs and install recipes

Every catalog entry in the README links to its recipe in
[docs/install.md](docs/install.md). Standalone skills install by name. A
skill with dependencies has a manifest at `packs/<skill-name>.json`, with
`members` grouped by their source repository. Include the entry skill and
every reachable required or conditional companion. When the workflow rules
exclude a conditional path, record the omitted skill and the reason in
`omit`. Use `owner/repo@skill` for an external omission.

When a skill's dependencies change, review the manifests of workflows that
reach it, then regenerate the recipes.

```sh
node scripts/validate-skills.mjs --write-install
```

Merging to `main` releases the workflows through the linked Vercel project.
The build creates each workflow from its manifest and packages each skill
as a ZIP archive with a SHA-256 digest. The published index points to
archives on that specific Vercel deployment so an install can finish across
a production rollout. A change to a shared skill
therefore ships to every workflow that includes it. Each workflow has a stable
install URL under `/workflows/<skill-name>`. The build also publishes a root
index of every local skill at `/.well-known/agent-skills/index.json`, so
`npx skills add https://skills.nickneely.dev --skill <name>` installs any one
skill alone with no extra step. Existing `url` fields identify
the original Skills.sh Packs for migration. New workflows only need a manifest.

For a new external member, add its repository, skill directory, and full
commit SHA to `external-skills.json`. The update workflow checks upstream weekly and can also be run manually.
It opens a PR when a skill directory or an upstream license changes. Approve
any pending workflow runs on that PR, then review and merge it to release
the updated files.
When adding or retiring members, tell existing users which workflow to
reinstall or which skill they can remove.

## Before you open a PR

```sh
./scripts/validate
```

Independent behavior test files run in separate Node processes, with up to
eight workers on macOS and four on Linux or Windows, capped by available CPUs.
The negative fixtures remain serial. To limit resource use or reproduce a
failure serially, run `SKILLS_TEST_JOBS=1 ./scripts/validate`. All test files are
included at every worker count.

The gate needs Bash, Node.js 22+, Git, and Python 3. Media tests use FFmpeg,
ffprobe, and ImageMagick when available. Run
`UI_EVIDENCE_REQUIRE_MEDIA=1 ./scripts/validate` to require that coverage, as
Linux CI does. Live browser tests are separate: opt in with
`UI_EVIDENCE_BROWSER_TESTS=1` when working on browser capture, with the
`agent-browser` runtime and its Chrome installation available.

This is the same gate CI runs. It must pass. If you add a rule to
`scripts/validate-skills.mjs`, add a negative fixture under `tests/fixtures/`
and assert it in `scripts/test`, so the rule is itself tested.

Edit skills here, in source. Do not edit an installed copy under an agent
runtime directory and copy it back - reinstall through the skills CLI instead.

## Measure comparison rendering changes

```sh
node --test tests/ui-evidence-compare.test.mjs tests/image-metrics.test.mjs
```

These tests create temporary fixture images and verify actual rendered pixels,
geometry, redaction, transparency, and native font measurements. They do not
modify skill sources or capture a live application. Keep these assertions active
when measuring renderer changes. Compare decoded frames and result metadata
with the prior implementation, including fractional zoom and 16-bit alpha.
Native operations may be batched when their settings remain isolated; combined
argument lists must stay bounded for Windows as well as POSIX hosts.

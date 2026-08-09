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

The validator enforces all of these mechanically. It will catch you.

## Writing a skill

Frontmatter carries only these keys:

```yaml
---
name: my-skill # must match the directory name
description: What it does, and the triggers that should invoke it.
compatibility: Required tooling, if any.
disable-model-invocation: true # slash-command only, no implicit invocation
argument-hint: "<arg> [--flag]"
---
```

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

## Before you open a PR

```sh
./scripts/validate
```

This is the same gate CI runs. It must pass. If you add a rule to
`scripts/validate-skills.mjs`, add a negative fixture under `tests/fixtures/`
and assert it in `scripts/test`, so the rule is itself tested.

Edit skills here, in source. Do not edit an installed copy under an agent
runtime directory and copy it back - reinstall through the skills CLI instead.

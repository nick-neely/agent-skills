# Agent skills

Portable agent skills I use across projects, published as source.

Each skill is plain Markdown plus the scripts it calls, so it works in Claude
Code, Codex, Cursor, and anything else that reads `SKILL.md`. Nothing here
depends on one private project or one machine.

## Install

With the [`skills`](https://www.skills.sh) CLI:

```sh
npx skills add nick-neely/agent-skills --list          # see what's here
npx skills add nick-neely/agent-skills --skill visual-verification --global
```

Or install by hand: clone the repo and symlink the skill directory into your
agent's skills directory (`~/.claude/skills/`, `~/.codex/skills/`, and so on).

```sh
git clone https://github.com/nick-neely/agent-skills.git
ln -s "$PWD/agent-skills/skills/visual-verification" ~/.claude/skills/
```

Skills that shell out have their own runtime dependencies, listed in each
`SKILL.md`. `annotated-screenshots` checks its own up front with
`scripts/preflight.mjs`.

## Skills

- [`annotated-screenshots`](skills/annotated-screenshots/) - Capture, annotate,
  and publish before/after UI evidence into a pull request or issue.
- [`generated-image-assets`](skills/generated-image-assets/) - Remove an image's
  background, verify the alpha edges, and size it for shipping.
- [`ship-spec`](skills/ship-spec/) - Claude Code only. Deliver every issue in a
  GitHub spec as a resumable orchestrated loop.
- [`to-spec`](skills/to-spec/) - Synthesize the current conversation into a spec
  and publish it to the issue tracker.
- [`to-tickets`](skills/to-tickets/) - Break a spec or plan into tracer-bullet
  tickets that declare their blocking edges.
- [`visual-verification`](skills/visual-verification/) - Screenshot, inspect,
  and validate local app UI, including authenticated pages.

`to-spec` and `to-tickets` are customizations of Matt Pocock's skills. See
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for provenance.

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

One gate, no dependencies beyond Node and git. It checks layout, frontmatter
schema, directory-name agreement, OpenAI metadata, local links, script
references, writing conventions, portability, licenses and provenance,
executable modes, JavaScript syntax, and symlink containment, then runs the
negative fixtures and behavior tests. CI runs it on x86_64 Linux and Apple
Silicon macOS.

## Contributing

Skills are curated, not accepted by default - see
[CONTRIBUTING.md](CONTRIBUTING.md) for what belongs here and what does not.

## License

MIT, except where a skill directory carries its own LICENSE. See
[LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

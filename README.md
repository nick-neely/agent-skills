# Nick's portable agent skills

Public-design source repository for generalized, portable agent skills authored
or customized by Nick.

This repository is intentionally public. Every addition must pass the
portability, provenance, and private-context boundaries below.

## Public boundary

Accepted content:

- generalized skills with a complete `SKILL.md`;
- referenced scripts and documentation committed alongside the skill;
- portable behavior that does not depend on one private project or machine.

Rejected content:

- secrets, credentials, tokens, customer data, or private product context;
- absolute `/home/...`, `/Users/...`, or Windows user-profile paths;
- hidden dependencies on untracked local files;
- copied third-party installed skills without their license and provenance;
- runtime state from Codex, Claude Code, Cursor, or the skills CLI.

## Layout

Each published skill lives at:

```text
skills/<skill-name>/SKILL.md
```

Optional `scripts/`, `references/`, and `assets/` directories stay inside that
skill directory.

## Validate

```sh
./scripts/validate
```

The gate validates layout, YAML frontmatter, directory-name agreement, OpenAI
metadata, local links, licenses and provenance, executable modes, JavaScript
syntax, symlink containment, negative fixtures, and focused visual-verification
behavior. CI runs it natively on x86_64 Linux and Apple Silicon macOS.

## Skills

- `visual-verification`: Nick-owned screenshot, browser-runtime, and local-auth
  workflow generalized from the private working copy for portable use.
- `to-spec`: Nick's MIT-licensed customization of Matt Pocock's spec publishing
  workflow, using the `documentation` label.
- `to-tickets`: Nick's MIT-licensed customization of Matt Pocock's tracer-bullet
  ticket workflow, preserving native parent/sub-issue relationships.

Portable personal skills are curated individually after their provenance and
private-context boundaries are reviewed.

See `THIRD_PARTY_NOTICES.md` for the provenance of customized upstream skills.

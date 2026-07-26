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

The initial scaffold contains no skills. Portable personal skills should be
curated individually after their provenance and private-context boundaries are
reviewed.

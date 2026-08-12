# Security

## Reporting

Report vulnerabilities through
[GitHub private vulnerability reporting](https://github.com/nick-neely/agent-skills/security/advisories/new).
Do not open a public issue. I aim to acknowledge within a week.

## What is in scope

These skills are instructions and scripts that an agent executes on your
machine, usually with your shell, your `gh` token, and your repository. Treat
anything that widens that blast radius as a vulnerability:

- a script that reads or transmits credentials, tokens, or files outside the
  working directory;
- a path traversal or symlink escape out of the skill or repo root;
- an unquoted interpolation that lets repository content, an issue body, or a
  filename execute as a command;
- prompt injection that steers an agent into destructive or exfiltrating
  behavior;
- committed secrets, or private data left in a bundled asset.

## What is not

- An agent doing something you told it to do, including a destructive command
  you approved.
- A skill that needs a dependency you have not installed.
- Anything in an upstream tool a skill shells out to (`gh`, `agent-browser`,
  ImageMagick). Report those to their own maintainers.

## Running these safely

- Read a skill before you install it. Every one is plain Markdown and Node.
- `ui-evidence` and `to-spec`/`to-tickets` publish to GitHub with your
  token. Both stop for confirmation first. Keep it that way.
- Screenshots, GIFs, and specs are permanent once published. Redact before
  upload, not after.

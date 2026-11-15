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

- Read a skill and its scripts before you install it. Scripts may run shell
  commands, browser tools, or Python as well as Node.js.
- Publishing skills use your authenticated tools and permissions. A request to
  publish to a specified destination can authorize the upload and target update;
  a local preview request authorizes local preparation only. Check the skill's
  authorization rules before invoking it.
- Published screenshots, recordings, and specs can be copied or retained even
  after removal. Redact sensitive content before upload.

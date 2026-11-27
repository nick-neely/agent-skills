# Install a skill

Run the command for your chosen skill and select your agent when prompted.
Install commands use `--global` for access across projects. Omit it from each
line and run from your project to install there. See the
[README](../README.md#install) for listing, updating and removing skills.

The workflow recipes include companions for the paths they support. Install
runtime tools separately when the path you use calls for them. For tracker
workflows that include `setup-matt-pocock-skills`, run
`/setup-matt-pocock-skills` in your project if its tracker still needs to be
configured. See the [setup instructions](https://github.com/mattpocock/skills/blob/main/docs/engineering/setup-matt-pocock-skills.md).

<!-- install-commands:start -->

## babysit-pr

```sh
npx skills add https://skills.nickneely.dev/workflows/babysit-pr --global --skill '*'
```

<details>

<summary>Install from source</summary>

```sh
npx skills add nick-neely/agent-skills --global --skill babysit-pr leaving-pr-comments
npx skills add openai/skills --global --skill gh-fix-ci
```

</details>

Requires authenticated GitHub CLI and Node.js.

[Read the skill](../skills/babysit-pr/SKILL.md).

## code-review

```sh
npx skills add nick-neely/agent-skills --global --skill code-review
```

[Read the skill](../skills/code-review/SKILL.md).

## comment-audit

```sh
npx skills add nick-neely/agent-skills --global --skill comment-audit
```

[Read the skill](../skills/comment-audit/SKILL.md).

## file-pr

```sh
npx skills add https://skills.nickneely.dev/workflows/file-pr --global --skill '*'
```

<details>

<summary>Install from source</summary>

```sh
npx skills add nick-neely/agent-skills --global --skill file-pr ui-evidence babysit-pr leaving-pr-comments
npx skills add github/gh-stack --global --skill gh-stack
npx skills add openai/skills --global --skill gh-fix-ci
```

</details>

Requires authenticated GitHub CLI.

[Read the skill](../skills/file-pr/SKILL.md).

## flow-walk

```sh
npx skills add nick-neely/agent-skills --global --skill flow-walk
```

[Read the skill](../skills/flow-walk/SKILL.md).

## full-send

```sh
npx skills add https://skills.nickneely.dev/workflows/full-send --global --skill '*'
```

<details>

<summary>Install from source</summary>

```sh
npx skills add nick-neely/agent-skills --global --skill full-send implementation-proof sol-loop file-pr babysit-pr tdd comment-audit code-review ui-evidence uat flow-walk leaving-pr-comments
npx skills add openai/skills --global --skill gh-fix-ci
```

</details>

Requires authenticated GitHub CLI and a route to OpenAI's Sol reviewer, as the sol-loop skill describes.

[Read the skill](../skills/full-send/SKILL.md).

## full-stop

```sh
npx skills add https://skills.nickneely.dev/workflows/full-stop --global --skill '*'
```

<details>

<summary>Install from source</summary>

```sh
npx skills add nick-neely/agent-skills --global --skill full-stop full-send implementation-proof sol-loop file-pr babysit-pr tdd comment-audit code-review ui-evidence uat flow-walk leaving-pr-comments
npx skills add openai/skills --global --skill gh-fix-ci
```

</details>

Requires authenticated GitHub CLI and a route to OpenAI's Sol reviewer, as the full-send skill does.

[Read the skill](../skills/full-stop/SKILL.md).

## generated-image-assets

```sh
npx skills add nick-neely/agent-skills --global --skill generated-image-assets
```

Requires Python 3.11 or newer, which the pinned NumPy and rembg releases both need. Creates an on-demand virtualenv outside the repo on first use. The segmentation path additionally downloads an ONNX model of roughly 200MB.

[Read the skill](../skills/generated-image-assets/SKILL.md).

## implement

```sh
npx skills add https://skills.nickneely.dev/workflows/implement --global --skill '*'
```

<details>

<summary>Install from source</summary>

```sh
npx skills add nick-neely/agent-skills --global --skill implement implementation-proof tdd comment-audit code-review uat flow-walk
npx skills add github/gh-stack --global --skill gh-stack
```

</details>

[Read the skill](../skills/implement/SKILL.md).

## implement-spec

```sh
npx skills add https://skills.nickneely.dev/workflows/implement-spec --global --skill '*'
```

<details>

<summary>Install from source</summary>

```sh
npx skills add nick-neely/agent-skills --global --skill implement-spec implementation-proof code-review tdd comment-audit uat flow-walk
npx skills add github/gh-stack --global --skill gh-stack
npx skills add mattpocock/skills --global --skill setup-matt-pocock-skills
```

</details>

[Read the skill](../skills/implement-spec/SKILL.md).

## implementation-proof

```sh
npx skills add https://skills.nickneely.dev/workflows/implementation-proof --global --skill '*'
```

<details>

<summary>Install from source</summary>

```sh
npx skills add nick-neely/agent-skills --global --skill implementation-proof tdd comment-audit code-review uat flow-walk
npx skills add github/gh-stack --global --skill gh-stack
```

</details>

[Read the skill](../skills/implementation-proof/SKILL.md).

## jira-acli

```sh
npx skills add nick-neely/agent-skills --global --skill jira-acli
```

Requires authenticated Atlassian ACLI (acli); bundled helpers require Python 3, with no extra packages.

[Read the skill](../skills/jira-acli/SKILL.md).

## leaving-pr-comments

```sh
npx skills add nick-neely/agent-skills --global --skill leaving-pr-comments
```

[Read the skill](../skills/leaving-pr-comments/SKILL.md).

## prototype

```sh
npx skills add nick-neely/agent-skills --global --skill prototype
```

[Read the skill](../skills/prototype/SKILL.md).

## sol-loop

```sh
npx skills add nick-neely/agent-skills --global --skill sol-loop
```

Requires a route to OpenAI's GPT Sol, through T3 Code delegation or a native Sol reviewer.

[Read the skill](../skills/sol-loop/SKILL.md).

## tdd

```sh
npx skills add nick-neely/agent-skills --global --skill tdd
```

[Read the skill](../skills/tdd/SKILL.md).

## to-spec

```sh
npx skills add https://skills.nickneely.dev/workflows/to-spec --global --skill '*'
```

<details>

<summary>Install from source</summary>

```sh
npx skills add nick-neely/agent-skills --global --skill to-spec
npx skills add mattpocock/skills --global --skill setup-matt-pocock-skills
```

</details>

[Read the skill](../skills/to-spec/SKILL.md).

## to-tickets

```sh
npx skills add https://skills.nickneely.dev/workflows/to-tickets --global --skill '*'
```

<details>

<summary>Install from source</summary>

```sh
npx skills add nick-neely/agent-skills --global --skill to-tickets implement implement-spec implementation-proof code-review uat flow-walk tdd comment-audit
npx skills add mattpocock/skills --global --skill setup-matt-pocock-skills
npx skills add github/gh-stack --global --skill gh-stack
```

</details>

[Read the skill](../skills/to-tickets/SKILL.md).

## uat

```sh
npx skills add nick-neely/agent-skills --global --skill uat
```

Requires Node.js and the agent-browser CLI with a Chrome it can drive.

[Read the skill](../skills/uat/SKILL.md).

## ui-evidence

```sh
npx skills add nick-neely/agent-skills --global --skill ui-evidence
```

Requires Node.js. Capture uses agent-browser with Chrome; motion capture requires agent-browser 0.38.1+ and FFmpeg. Preparation uses FFmpeg, ffprobe, and ImageMagick. Publishing uses authenticated gh 2.99.0+ with repository push access.

[Read the skill](../skills/ui-evidence/SKILL.md).

<!-- install-commands:end -->

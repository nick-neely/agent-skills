# Install a skill

<!-- install-commands:start -->
<!-- Generated; do not edit by hand. Edit packs/ and SKILL.md frontmatter, then run: node scripts/validate-skills.mjs --write-install -->

## extra

```sh
npx skills add nick-neely/agent-skills --global --skill extra
```

[Read the skill](../skills/extra/SKILL.md).

## helper

```sh
npx skills add nick-neely/agent-skills --global --skill helper
```

[Read the skill](../skills/helper/SKILL.md).

## manual

```sh
npx skills add https://skills.nickneely.dev/workflows/manual --global --skill '*'
```

<details>

<summary>Install from source</summary>

```sh
npx skills add nick-neely/agent-skills --global --skill manual helper
```

</details>

[Read the skill](../skills/manual/SKILL.md).

## pointer

```sh
npx skills add https://skills.nickneely.dev/workflows/pointer --global --skill '*'
```

<details>

<summary>Install from source</summary>

```sh
npx skills add nick-neely/agent-skills --global --skill pointer helper manual
npx skills add sample/tools --global --skill outside
```

</details>

[Read the skill](../skills/pointer/SKILL.md).

<!-- install-commands:end -->

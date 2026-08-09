# AGENTS.md

This repo is public. Every skill in it must stay portable and free of private
context.

- Read the complete `SKILL.md` before changing a skill.
- Keep everything a skill references inside that skill's directory.
- Use `<skill-root>` for paths into a skill, never a runtime install directory.
- Never commit secrets, customer data, private project context, or
  machine-local absolute paths.
- Plain hyphens, never em dashes.
- Run `./scripts/validate` before proposing any change. Add a negative fixture
  for any validation rule you add.
- Edit source here. Do not edit an installed copy under an agent runtime
  directory - reinstall through the skills CLI instead.

`CONTRIBUTING.md` has the full authoring contract.

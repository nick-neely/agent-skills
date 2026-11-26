# Fixture

## Skills

- [`manual`](skills/manual/) - A user-invoked skill that calls a helper.
- [`helper`](skills/helper/) - A model-invoked skill.
- [`pointer`](skills/pointer/) - Names the user-invoked skill without calling it.
- [`extra`](skills/extra/) - A skill nothing depends on.

<!-- install-commands:start -->
| Skill | Install | Add for the paths that use them | From other repositories |
| --- | --- | --- | --- |
| `manual` | `manual helper` | - | - |
| `pointer` | `pointer` | `helper manual` | `sample/tools@outside` |
<!-- install-commands:end -->

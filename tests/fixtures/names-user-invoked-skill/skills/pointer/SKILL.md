---
name: pointer
description: Sample skill that names a user-invoked skill without calling it.
---

# Pointer

When this is done, the user can run `/manual` on the result. The `manual` skill
is user-invoked, so nothing here calls it. This workflow is compatible with the
`manual` skill. Use the $helper skill for the rest,
keep `$manual_dir` out of the output, and print `$manual` to see the variable.

```bash
echo "$manual"
```

## Which skill should the user call

"manual" is the user-invoked skill for interactive setup.

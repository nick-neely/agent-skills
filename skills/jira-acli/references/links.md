# Directed relationships

```bash
python3 -I <skill-root>/scripts/jira.py link PROJ-123 Blocks PROJ-456
python3 -I <skill-root>/scripts/jira.py link PROJ-123 Blocks PROJ-456 --apply
```

The sentence is **PROJ-123 blocks PROJ-456**: subject, exact type name, object.
The first command reads both endpoints and plans; the second performs the
authorized write and verifies both endpoints. Correct existing links are a
read-only success. Pre-existing reverse links require inspecting the user's
intent, rather than automatically rewriting planning decisions.

## Readback is the invariant

Verify every create or delete by rereading **both** endpoints' `issuelinks`,
including each operation in a batch. Apply this rule for every ACLI version.
The CLI success message is never evidence of direction.

| Field on the viewed item's link | Meaning from that item's perspective |
| --- | --- |
| `outwardIssue.key` | This item `type.outward` the linked item |
| `inwardIssue.key` | This item `type.inward` the linked item |

For "A blocks B", A must show `outwardIssue.key == B` and `type.outward == "blocks"`;
B must show `inwardIssue.key == A` and `type.inward == "is blocked by"`, with the
same link ID on both sides. Types with equal inward/outward descriptions are
symmetric and can be stored either way.

## Current flag mapping

**`--in` is the subject; `--out` is the object.** Mnemonic: put the **initiator
in**. This is the reverse of the flag names. The success message prints
`<out> <Type> <in>` and reads backwards for a correctly directed relationship.
Ignore it and verify stored data.

Last verified: ACLI 1.3.40-stable, 2026-11-16. This is provenance, not a version
condition; readback decides whether the mapping worked.

If a newly created link reads backwards, the helper identifies the new ID
against the pre-write snapshots, deletes only that new reversed link, verifies
its absence, retries once with flags swapped, then verifies again. It exits
**2 even if corrected**: stop the batch and report the mapping change so the
skill can be updated. Uncertain readback, endpoint disagreement, CLI failure,
or ambiguous new IDs exits 1 and requires inspection before further writes.
Existing link IDs are never eligible for this automatic correction.

## Types and deletion

Discover exact types with `acli jira workitem link type --json`. Where a site
offers both `Relates` and `Relates To`, prefer the type already used by relevant
existing links. The helper does not choose between different type names.

For an authorized deletion, take the exact ID from readback and specify both
endpoints:

```bash
python3 -I <skill-root>/scripts/jira.py unlink PROJ-123 PROJ-456 LINK_ID
python3 -I <skill-root>/scripts/jira.py unlink PROJ-123 PROJ-456 LINK_ID --apply
```

The helper checks that the ID connects those endpoints and confirms its absence
from both after deletion. If handling links directly, use `link delete --id
LINK_ID --yes` and perform the same verification.

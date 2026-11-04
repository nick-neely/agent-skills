# Deliver findings, then verify fixes

## Deliver the report

Every run ends with a completed report and its evidence, including when nothing fails or access blocks testing. Reconcile criterion coverage, lens coverage, tested viewports, scenario statuses and candidate counts. Record elapsed time, operator assistance and session usage when the host exposes it (in Copilot CLI, `/usage`), otherwise unknown.

Write the report's Summary last, from the finished sections: it is what most readers read, so each line states a result, a finding or a gap rather than activity. Your reply gives the report path, material failures, uncertainty, cleanup status and the next decision. Distinguish the agent's results from human-confirmed defects and from business acceptance.

The delivered report is the record of the tested build. Keep its failed observations, finding IDs and artifacts as they are; later changes get a new linked run. Disclose any redaction.

## Choose the next action

- **Standalone testing request:** deliver the report. With actionable findings, end with a short offer to fix them and rerun the affected checks; a request to test does not authorize product changes. Missing access, missing data or an ambiguous requirement gets its specific resolution request. With no actionable finding, report that and the remaining gaps.
- **Testing during an implementation:** return the evidence to the implementing parent, with the tested build unchanged during the run. The parent fixes in-scope findings under its original authorization; out-of-scope findings need a separate decision. A direct "fix and retest" instruction works the same way once the original report is complete.

Fixes follow the normal implementation workflow. Publishing findings, creating tickets, committing, pushing and opening PRs each need their own authorization.

## Retest as a new run

When the changed runtime is ready, run this skill again with the original report and finding IDs, the business criteria, target and build facts, and existing permissions. If the implementing agent would test, hand off per [independent testing](independent-testing.md). This is **informed verification**: the tester receives the original symptom, reproduction and evidence, but not the fix explanation, diff or implementer-authored expectations.

1. Create a new run and mark the report as a retest linked to the original.
2. Establish that the runtime contains the change, through an observed build identity or trustworthy provenance such as a successful rebuild and start from the fixed checkout. If you cannot, report scenario results but leave fix verification unresolved.
3. Re-establish fixture and start state, reproduce the original path, and test the affected criteria plus nearby boundaries and state transitions. Stay within the remaining transaction limits. A fresh tester does not need a fresh profile unless the scenario does.
4. Mark each original finding **verified fixed** (expected behavior observed), **still failing** or **unresolved** (blocked, not run, inconclusive or unconfirmed runtime), with new evidence links. A changed symptom or new defect becomes its own finding linked to the original. An intermittent issue absent once gets a repeatability limitation, not an unconditional fix claim.

If triage rejected a candidate or established a different requirement, record that disposition and its source instead of a verified fix. Behavior the retest did not cover remains untested, and a partial retest lists its gaps.

A standalone retest ends with the updated evidence and the next decision; an implementation parent continues its delivery workflow.

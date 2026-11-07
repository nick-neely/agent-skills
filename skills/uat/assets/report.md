# UAT report: <feature or ticket>

The agent fills every field; write `unknown` or `n/a` rather than leaving one blank. `new-run.mjs` prefills the fields it knows. Keep these headings and the Run details labels exactly as written so runs can be compared; add sections for request-specific data (such as per-attempt results or a measurement method) where they fit, ahead of Evidence.

## Summary

- Result per criterion (pass / fail / unresolved, one line each):
- Findings (ID, kind: defect / usability, severity and task impact, one line each):
- Usability walkthrough outcome and limits:
- Main gaps and untested areas:
- Next decision:

## Candidate defects

### F01: <title>

- Impact:
- Expected (oracle source):
- Actual:
- Fixture and start state:
- Steps, with evidence links:
- Repeatability:
- Readback still needed:
- Triage: pending

## Usability findings

Use the shared F-series IDs without duplicating candidate defects; cross-link overlaps. Write `none observed` when appropriate, or state the coverage gap. An inferred human impact is not an observed participant reaction.

### F02: <title>

- User goal and step:
- Visible cue and interpretation it suggests:
- Observed behavior or actual interaction path:
- Task consequence (observed / inferred), severity and rationale:
- Evidence links and repeatability:
- Confidence and limits:
- Small improvement to consider:
- Triage: pending

## Criteria

| ID | Criterion | Source and date |
| --- | --- | --- |

Inferred expectations and ambiguous or conflicting rules:

## Usability walkthrough

- User goal, role and assumed familiarity:
- Starting point and prior exposure or supplied guidance:
- Path taken and decision-point evidence:
- Outcome, friction and assistance (link scenario / finding IDs):
- Coverage gaps or explicit exclusion:

## Scenarios

| ID | Criterion | Acceptance / exploration | Preconditions and actions | Expected observable result | Status | Observed, evidence, limitation |
| --- | --- | --- | --- | --- | --- | --- |

Status: pass / fail / inconclusive / blocked / not run. Added scenarios name the observation that prompted them.

Criterion coverage summary and critical untested behavior:

Future regression candidates:

## Exploration coverage

| Lens | Probes chosen and why | Coverage | Scenarios / evidence or reason | Residual risk |
| --- | --- | --- | --- | --- |
| Discoverability and comprehension | | | | |
| Input boundaries | | | | |
| Recovery | | | | |
| Changed intent | | | | |
| Re-entry and saved state | | | | |
| Rule interactions | | | | |
| Result integrity | | | | |
| Responsive usability | | | | |

Coverage: exercised / blocked / not reached / not applicable.

## Responsive and visual

Supported screens and source, or unknown; why these sizes:

| Viewport (CSS w x h) | Emulation and input | States checked | Outcome and inspected images | Expectation source and limits |
| --- | --- | --- | --- | --- |

Real-device follow-up needed:

## Uncertain observations and UX suggestions

## Evidence

| Scenario / finding | Artifact (relative link) | What it shows | Inspected? Limits |
| --- | --- | --- | --- |

## Retest verification

Delete this section on an initial run. Changed-runtime provenance:

| Original finding | Verified fixed / still failing / unresolved | New scenarios and evidence | Nearby coverage and limits |
| --- | --- | --- | --- |

Rejected or reinterpreted candidates, with source:

## Run details

- Run ID: {{run_id}}
- Skill version: {{skill_version}}
- Started: {{started}}; ended:
- Evidence location: {{evidence}}
- Browser: {{browser}}; desktop viewport:
- Type: initial / retest of <link to original report and finding IDs>
- Model and CLI versions:
- Tester isolation and context supplied: independent / informed verification / implementation-informed
- Target URL, local or deployed, dependencies:
- Observed build:
- Local server: reused / started (command, process, log, left running?)
- Test role and location:
- Fixture and start state:
- Restrictions carried in the browser config:
- Operator assistance (startup SSO, app sign-in, dashboard):
- Authorization carried forward, declared prerequisites, action limits:
- Unresolved facts:

## Handoff

- Elapsed time, operator time, session usage:
- Cleanup done and remaining; servers and browser sessions left running:
- Repository, tracker and GitHub writes:
- Consequential actions used / remaining:
- Business acceptance: pending human decision

# Plan and run the browser test

## Plan

Start with the usability walkthrough below, then run remaining acceptance scenarios and exploration. Reuse walkthrough observations for acceptance checks when they establish the expected result; do not repeat consequential actions just to separate phases. The run ends when the workflow's done-conditions are met. A user-supplied time limit caps the whole run, including setup and reporting; scale exploration to it and reserve time to record gaps. Without one, a run making progress continues to its done-conditions. A failing step is a reason to try another way: wait for a real readiness signal, reload, take a fresh snapshot, use a different selector or route, or check whether the environment rather than the product is at fault. Record observed requirement violations as failures; recovery attempts do not erase them. A step is **stalled** only when distinct approaches keep failing the same way and each attempt teaches nothing new. Then mark only the dependent scenarios that cannot be exercised blocked, recording what you tried, continue the ones that do not depend on it, and deliver the report when nothing else can progress.

Plan a realistic user goal, role, assumed familiarity and starting point for the walkthrough, without prescribing its click path. Write a compact risk-based plan into the report's scenario table: stable scenario IDs linked to criteria, acceptance or exploration, and concrete inputs, sequences and screen sizes chosen for this feature with the lenses below. Label inferred expectations as inferred. For an open question, name the observation sought instead of a pass condition. When a requirement reaches past the screen, plan its readback explicitly. If earlier runs for this feature exist under `~/.uat/runs/<project>/`, include their open findings and regression candidates in the plan as risks, not as expected results; skip them when the user asks for an independent run. Then move straight on to sign-in and testing.

### Exploration lenses

Consider every lens while planning and again as the feature reveals risks. Pick cases with high information value; one realistic journey can cover several lenses. Add feature-specific questions the table misses.

| Lens | Question and possible probes |
| --- | --- |
| Discoverability and comprehension | Can the user find the entry point, choose the next action, understand labels and grouping, predict consequences and recognize completion? Inspect hierarchy, action prominence and placement, feedback and recovery guidance along the walkthrough. |
| Input boundaries | What happens at meaningful limits? Empty or whitespace, zero, negative or fractional quantities, length limits, pasted or Unicode text, duplicates (the same item twice in one input, or an item already present), mixed valid and invalid file rows. |
| Recovery | Can a user correct invalid input and succeed? Look for stale errors, lost valid work, partial changes and duplicate effects after a failure or a double submit. |
| Changed intent | What happens when the user changes an earlier choice, edits dependent values, cancels or reopens a step? |
| Re-entry and saved state | Do back, forward, refresh, leaving and returning, reopening saved work, deep links with edited URL parameters, and the same record open in two tabs keep or reset the right state? |
| Rule interactions | Can individually valid choices conflict across the permissions, selections and business rules available to this identity? |
| Result integrity | Does the saved result, list, cart or downloaded file match the operation, including counts, contents and unrelated data? |
| Responsive usability | Can the user understand and complete the flow, including error and expanded states, at relevant screen sizes and with the keyboard alone? |

The report gives each lens a coverage value: **exercised** (the recorded probes ran, not that the category is exhausted), **blocked**, **not reached** or **not applicable**, with scenario links or a reason, and residual risk. A passing happy path covers none of them.

## Usability walkthrough

Make this part of every UI UAT run unless explicitly excluded; record access, time or visual-inspection gaps. Start after sign-in and viewport setup, before detailed acceptance testing teaches the route. Use the intended user's goal and normal visible navigation. Read requirements for business intent, but do not use an implementer's click path, hidden DOM details or a supplied deep link to bypass discovering the feature unless that link is the user's intended entry point. Browser snapshots may locate controls once the visible interface makes the action identifiable.

At meaningful decision points, inspect the rendered screen and act on the cues it provides. Assess whether hierarchy, grouping, labels and button placement make the next step understandable, whether the user can predict an action's scope and consequences, and whether progress, saved state, errors and completion are clear. Include relevant expanded or error states and carry these questions into the narrow-viewport checks. Prefer clearer controls and flow over adding explanatory copy by default.

Record concrete misleading cues, wrong turns, backtracking, unexpected results and help needed, with evidence of the screen or transition. Preserve the initial friction even when an alternative route succeeds. Separate product friction from selector failures, browser problems and missing test access. A successful task can still have a usability finding; a smooth path needs no invented finding.

Stay within the existing action limits and readback rules. Stop before an unauthorized action and record the remaining gap. On retests or narrowly scoped requests, walk through the affected journey rather than unrelated areas. Disclose prior exposure, supplied reproduction steps and implementation context; do not call an informed walkthrough a first-use test. This is an agent assessment: distinguish observed interface behavior and the agent's actual actions from inferred human confusion, and never invent participant reactions or usability metrics.

## Execute

Load command guidance for the selected CLI with `ab skills get core`; if core instructions are unavailable, use `ab --help`. Its commands are the ones `ab` passes through, including when it selects npx. Every call goes through `ab` ([owned browser](authentication.md#configure-the-owned-browser)):

```bash
ab open "TARGET_URL"
ab snapshot -i
ab screenshot --annotate "ABSOLUTE_EVIDENCE_PATH.png"
ab errors
ab console
```

Quote URLs and paths for the host shell (PowerShell or POSIX), including query characters and spaces. The named session stays alive across calls.

Set the desktop viewport right after the first open, before any scenario or recording: `set viewport 1440 900`, or the product's documented desktop size. The default window leaves about 1280x633 for the page, which crops totals, footers and toasts out of screenshots and clips. Record the size in the report.

After the walkthrough, start with the highest-risk remaining acceptance scenarios, bounded so exploration time survives, then adapt the order to what you learn. Take a fresh snapshot after each navigation or state change: `snapshot -i` locates controls; full `snapshot`, screenshots and downloaded files verify results. Wait on a visible completion condition with a bounded timeout. Browser connectivity problems are environment issues until shown otherwise. Dismiss cookie-consent banners and similar overlays that cover the flow, using the least-permissive choice offered (such as "Reject All"); report one only if it blocks the requested flow or has a significant accessibility defect. Whether such a banner appears can depend on the machine's network, so its absence is not a finding.

Follow anomalies: state a small hypothesis and pick the safe next action that tells explanations apart, such as whether an error is stale or the corrected input is still invalid. Keep the initial plan and label each added probe with what prompted it. Re-read current requirements rather than treating an old report as the oracle, and note repeatable high-value probes as future regression candidates.

Unusual input or unfamiliar design alone is not a defect. Requirement failures need the oracle; inferred consistency or data-integrity expectations stay labelled. Usability findings may identify evidence-backed friction without an explicit requirement or approved design, using the classification below; they do not invent business rules. Keep probes realistic and inside the feature; fuzzing, load and vulnerability testing, account switching and extra transactions need their own authorization. When data ownership or a backend effect is uncertain, hold back that path only and continue the safe checks elsewhere. After a known outcome, a reproduction may use a verified reset or fresh fixture within the transaction limits; otherwise keep the observation and state the missing decision.

## Responsive and visual checks

Take supported screens from requirements or design guidance. For ordinary UI UAT, check the feature at its normal desktop viewport and one relevant narrow viewport unless scope excludes it. With support unspecified, label it unknown and use a representative phone width as exploration, without declaring mobile support. For an explicitly desktop-only product, try smaller desktop windows and mark phone coverage not applicable, citing the source. Add tablet, landscape or widths around an observed layout break only when the feature or findings justify them.

```bash
ab set viewport 390 844
ab screenshot "ABSOLUTE_EVIDENCE_PATH.png"
```

Choose dimensions for the feature; the example is not a mandated device. View each screenshot with the host's image capability at the recorded size: a saved but unviewed image, or an accessibility snapshot, is not visual inspection. Use viewport screenshots for clipping, overlays and sticky controls. If the host cannot view images, continue functional checks and mark visual assessment unavailable.

Exercise menus, dialogs, long content and error states, not just the initial page. Look for clipped or overlapping content, unreadable labels or errors, unintended page overflow, unreachable primary actions and controls that do not operate normally; a deliberately scrollable table is fine. Operate controls the way a user would, without forced clicks or page or CSS changes. Reuse safe preparatory states across sizes instead of repeating consequential submissions.

`set device` adds mobile input and user-agent emulation; use it only when that adds value, and record the preset and settings used. Any emulation still runs the desktop engine, so it covers responsive layout only: real iOS or Safari, Android hardware, virtual keyboard, touch ergonomics, accessibility and performance need named real-device follow-up. Restore the desktop viewport and clear emulation before scenarios that assume them.

Classify by evidence: a requirement violation is a candidate defect; a mismatch with an approved design on a supported screen is a candidate design defect; observable barriers, misleading cues or avoidable friction are usability findings even when the task succeeds or matches the design. Aesthetic preferences without a task consequence are suggestions. Without a design or support source, qualify the expectation; do not suppress evidenced usability concerns. This spot check makes no pixel-fidelity or accessibility-conformance claim.

## Record outcomes as you go

Give every scenario a status with evidence:

- **pass**: the expected observable result was seen.
- **fail**: the observed result contradicts the oracle.
- **inconclusive**: the result could not be observed.
- **blocked**: a missing prerequisite or stalled dependency prevented the scenario from being exercised.
- **not run**: out of time or scope.

Scenario pass/fail tracks the stated expected result; an inferred usability risk alone does not fail an acceptance criterion. Link usability findings separately, including from passing scenarios.

A success indicator shows only that indicator. Reopening saved work after a refresh verifies persistence through that lifecycle, not database durability or a downstream call. Record exactly what readback established and what remains unverified.

For each material candidate defect, attempt a safe reproduction when needed ([recording](evidence.md#record-an-interactive-reproduction)) and record expected versus actual, the oracle source, fixture and start state, numbered steps, evidence paths, repeatability and impact. Group duplicate symptoms into one finding. Treat console errors as observations until their relevance is shown, and keep intermittent observations and UX preferences separate from defects.

For each material usability finding, use the report's dedicated section and a stable finding ID. Record the goal and step, visible cue, observed behavior or actual interaction path, task consequence, evidence, confidence and limits, and a small improvement to consider. Label predicted human confusion as inferred; tie severity to task impact rather than aesthetic preference. Cross-link overlapping defects instead of counting the same issue twice. Keep unsupported hypotheses and preferences in suggestions, and preserve usability IDs for retesting.

## Finish

Stop when the done-conditions are met, at an explicit user time limit, or when no remaining scenario can progress. Preserve recorded outcomes, including blocked statuses; mark unattempted scenarios not run only when omitted for time or scope. Undo test changes whose cleanup is permitted and safe, and record any that remain. Stop recording. Persistent leaves its keep-alive session running per [profiles](profiles.md#during-and-after-the-run); fresh and headless call `ab close` to close only this run's session. Before handing off a headless run, including a failed or aborted run, remove any remaining `run.statePath` and never share `auth-state.json`; follow [headless cleanup](authentication.md#headless-runs).

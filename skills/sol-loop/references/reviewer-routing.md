# Reviewer routing

## T3 Code

Call `orchestrator_capabilities` and select the latest available Sol unless the user named a version. Discover the model ID rather than hardcoding it. On every dispatch, set the selected provider and model in `target`. Pass its advertised reasoning-effort option in `target.options`, for example `{"reasoningEffort":"high"}`. Default to high. Use medium if high is unavailable, or the user requests medium. Honor a supported higher effort when requested. If the route cannot explicitly select at least medium, report a blocker. Distinguish the effort requested from any effective effort confirmed by the runtime.

Use `delegate_task` every round with `role: "review"` and `mode: "wait"`. Record dispatch time so a stalled review can be identified and canceled on resumption. Use the supported initial wait (currently `timeoutMs: 45000`); its expiry leaves the child running. Save the returned `taskId` and use a new `clientRequestId` for each round. `childThreadId` is storage, not the next target. Use the review task route rather than `t3_thread_send`, `create_threads` or `t3_thread_launch`.

Follow the returned `next`. When it permits bounded continuation waits, cap them at 30 minutes total from dispatch, or the user's deadline. When it requires yielding for a completion notice, report the task ID and that automatic deadline enforcement is unavailable, then yield. A healthy high-effort review can outlast the initial wait. If the user requires a hard deadline and the host cannot enforce it, cancel and report the limitation without retrying on that route.

On deadline expiry or a user-reported stall, cancel the outstanding task by `taskId`. Accept terminal status from the host; allow up to one minute for confirmation only when a bounded wait is supported. If termination remains unconfirmed, report the task ID and incomplete review, then stop without redispatch. A verdict visible in a partial transcript does not establish completion. Apply the workflow retry limit.

If T3 tools are not listed but the environment exposes a way to call them, try one direct capability lookup before declaring the route unavailable. A failed lookup is a blocker, not permission to invent a model or tool.

Use a fresh `delegate_task` for the next round. Give each child the complete brief and ledger because it may have no conversation history.

## Outside T3

Use a native Sol reviewer configured for high effort by default, with the same medium floor as T3. Verify the configured effort before launch and retain its ID. In Claude Code, use a custom subagent only when it is configured to run Sol. If no available route runs Sol, report the blocker instead of substituting a model.

For subsequent rounds, follow up the saved native reviewer ID with the original brief, ledger and changes since the previous round.

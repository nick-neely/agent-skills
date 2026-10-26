# Reviewer routing

## T3 Code

Call `orchestrator_capabilities` and select the latest available Sol unless the user named a version. Discover the model ID rather than hardcoding it. Record provider, model and effort only when exposed.

Use `delegate_task` every round with `role: "review"` and `mode: "async"`. Save the returned `taskId` and use a new `clientRequestId` for each round. `childThreadId` is storage, not the next target. Use the review task route rather than `t3_thread_send`, `create_threads` or `t3_thread_launch`.

If T3 tools are not listed but the environment exposes a way to call them, try one direct capability lookup before declaring the route unavailable. A failed lookup is a blocker, not permission to invent a model or tool.

Use a fresh `delegate_task` for the next round. Give each child the complete brief and ledger because it may have no conversation history.

## Outside T3

Use a native subagent that runs Sol and retain its ID. In Claude Code, use a custom subagent only when it is configured to run Sol. If no available route runs Sol, report the blocker instead of substituting a model.

For subsequent rounds, follow up the saved native reviewer ID with the original brief, ledger and changes since the previous round.

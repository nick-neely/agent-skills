# Configuration

The orchestrator remains the model chosen when the run starts. Configuration
controls sub-agent defaults, concurrency, review observation, and repository
adapters. Put optional project policy at `.agents/implement-program.json`.

## Default configuration

```json
{
  "version": 1,
  "agents": {
    "implementation": { "model": "gpt-5.6-luna", "reasoning": "max", "quality": "floor", "availability": "prefer" },
    "review": { "model": "gpt-5.6-luna", "reasoning": "max", "quality": "floor", "availability": "prefer" },
    "research": { "model": "gpt-5.6-luna", "reasoning": "max", "quality": "floor", "availability": "prefer" }
  },
  "concurrency": { "maxActiveSubagents": 5, "implementation": 4, "review": 2, "research": 2 },
  "review": { "observationSeconds": 120, "botResponsesRequired": false, "bots": [] },
  "scheduling": { "policy": "adaptive-frontier", "requireIsolationPreflight": true }
}
```

Repository values override these defaults. Explicit run overrides take
precedence over repository values. Reject unknown keys and malformed role
profiles before dispatch.

`availability: prefer` uses the configured profile when the harness supports it.
Otherwise it uses the user- or harness-selected inherited profile and records
the fallback without rewriting repository configuration. A repository may use
`require` to block dispatch instead.

The configured profile is a floor when available. The orchestrator may escalate
a difficult or high-risk assignment to another supported model or reasoning
level. Record the configured profile, resolved profile, and concise reason in
the ledger. Do not downgrade below Luna at maximum reasoning merely to reduce
usage. An unavailable preferred profile is a portability fallback, not a
quality-policy change.

The built-in floor is Luna at `max`. A repository may name any model supported
by its harness when it marks that profile as `quality: escalation`. The
orchestrator verifies that the configured replacement is genuinely an escalation
before dispatch and records the resolved capability. This keeps the skill
portable without silently weakening the user's floor.

Record the configured and resolved profile before dispatch:

```sh
node "<skill-root>/scripts/ledger.mjs" profile --run-dir <run-dir> --ticket <id> --role <role> --model <model> --reasoning <level> --quality <floor-or-escalation> --reason <why>
```

Concurrency values are operating ceilings, distinct from the harness session
cap. Resolve the total worker capacity from current session or delegation-tool
metadata on every run, then cap configured concurrency to it. If the runtime
does not disclose a total, use one until it reports a stronger bound. Reduce
further when ownership or runtime isolation is uncertain. A higher harness cap
supplies headroom; it does not compel dispatch. The scheduler does not reserve
role slots: a completed implementation frees a slot for review before another
implementation starts.

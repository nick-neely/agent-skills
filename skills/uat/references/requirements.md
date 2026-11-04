# Discover criteria, target and test data

Discovery uses no browser; the owned browser first opens at sign-in. Runtime facts and non-secret documentation are fine to inspect.

## Criteria

Take business requirements from the request, the current task or supplied material; a ticket is one possible source. Resolve a supplied reference with whatever read-only tools are available, following parent requirements and linked material only as needed. Record each source with its supplied or retrieval date, or unknown. If the criteria cannot be obtained, ask for them and continue runtime discovery meanwhile. If several unrelated features fit the request, ask which one.

Give each criterion a stable ID and take its expected result from the oracle. Mark an ambiguous rule unresolved and keep testing the clear ones.

## Target

Resolve in this order:

1. An explicitly named target.
2. The relevant local app: reuse it if running, otherwise start it per [app readiness](authentication.md#app-readiness-and-startup-sso). A tester may receive URL and startup facts without source or a patch.
3. A non-production target named in the ticket, supplied runtime facts or trusted non-secret project documentation. If bounded discovery cannot identify one, ask only for the URL or environment.

Hold the target fixed for the run: a failure is a result to report. A checked-out commit does not show what is deployed. Take build and flags from a visible environment indicator or supplied runtime facts, otherwise record unknown; a feature missing from an unconfirmed deployment is a coverage gap, not a product defect. Leave flags, application config and secrets as they are.

## Test data

Find the feature through visible navigation, and use the signed-in role and existing dedicated fixtures whose purpose is established. Read permitted UI lists to find suitable records. Build small inputs, such as CSV files, from a requirement-defined format, an official in-app template or a documented format, filled with established records; a template supplies format, not expected results. Use only real records and accounts.

Before modifying existing data, establish its ownership and starting state, and preserve unrelated contents. Ask for a specific fixture or account only when those facts cannot be established safely.

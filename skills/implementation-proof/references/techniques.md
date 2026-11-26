# Test techniques by risk

Example tests at the seam are the default and are often enough. Add a technique below when the ticket shows its signal and the repository already has the tooling. Where it lacks the tooling, use the row's by-hand form when it gives one; otherwise cover the rule's boundaries with example tests and name the technique in the report. Add no test dependency for it. Take every expected value from the ticket or a worked example, so a test can disagree with the code.

| Signal in the ticket | Technique | Doing it well |
| --- | --- | --- |
| A rule that must hold over many input combinations | Property test | State the rule as the property, such as "refunds never sum above the captured amount". Generate across its boundaries, and keep each shrunk failure as an example test. |
| A request, response, event or schema that a consumer outside this repository relies on | Contract test | Pin the shape and status the consumer depends on, at the boundary, for the success case and the rejection case. |
| Critical logic where a wrong boundary or sign would be costly | Mutation testing | Run it on the changed module alone. By hand: invert each boundary of the rule, confirm a test fails, and restore it. A mutant that survives gets a test or a stated reason. |
| Code you must change that has no tests and unclear behavior | Characterization test | Pin what it does now through its public interface before editing, then change only the expectations the ticket changes. |
| Shared state, retries, queues or ordering | Concurrency or idempotency test | Run the operation twice and interleaved, and assert the end state. |
| A parser, decoder or other handler of untrusted input | Fuzzing | Assert a clean rejection: no crash, hang or partial write. |
| An authorization boundary | Negative access test | For each role and tenant that must be refused, assert the refusal and that nothing was read or changed. |
| One implementation replacing another | Differential test | Run old and new on the same inputs, and account for every difference by the ticket. |

One technique per risk is the usual ceiling. A technique that guards nothing the ticket names is overhead.

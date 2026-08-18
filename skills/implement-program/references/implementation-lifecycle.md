# Implementation lifecycle

Apply this lifecycle to one ticket in its assigned worktree and branch.

1. Read the ticket, parent specification, repository instructions, governing
   decisions, and current integration parent.
2. Use test-driven development at pre-agreed seams, one red-green vertical slice
   at a time.
3. Run typechecking and focused tests throughout. Run every ticket-level lane
   implicated by the completed diff.
4. Stage deliberately and commit the candidate ticket. Push it and open a draft
   pull request against the integration branch.
5. Let a fresh reviewer inspect Standards and Spec fulfillment against the
   current parent.
6. Repair every valid finding on the owning branch. Rerun implicated local
   gates, commit, push, and reply beneath the original review thread with the fix
   and verification.
7. Finish only when the worktree is clean, the ticket has one coherent review
   story, and its child pull request satisfies the review gate.

Tests for the delivered behavior belong to the ticket. Reserve parent-level
tests for behavior that genuinely requires the integrated program. A worker may
raise ambiguity or a blocker; it may not widen the ticket, choose another ticket,
merge, or perform an approval-only action.

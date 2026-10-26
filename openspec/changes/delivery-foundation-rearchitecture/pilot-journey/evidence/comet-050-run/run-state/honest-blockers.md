# Honest blockers surfaced by the pilot (all commands in world logs)

1. Run add-journey-version (epoch 0-3): cancelled. initialState.isolation=null
   can never satisfy full.build.configure (validator demands non-null state
   isolation; the output schema forbids null; the transition refuses a failed
   configure; no composition-face post-start isolation write exists). Upstream
   contract gap: composition runs MUST start with isolation set.
2. Run add-journey-version-r2: cancelled. (a) submissionId collision across
   epochs bound the A extension activation to a stale epoch-0 evidence wait
   (sourceCurrent false forever); (b) after the task-id revise loop, the P
   write-once artifact (.sdd/delivery/gates/p/receipt-bundle.json) no longer
   matched the earlier epoch's recorded pass hash — the epoch-specific bundle
   bytes were unrecoverable, so every later P claim/record was refused.
3. Run add-journey-version-r3: gates R, A, T, P passed (real consensus, real
   T review, deterministic bundles). Stuck at the P re-arm after the final
   revise: the round-1 P pass binds bytes whose reconstruction mismatched
   (c08b… vs 536b…), so the write-once re-validation refuses the tail.
   Upstream finding: revise loops + fixed per-gate artifactRefs require
   epoch-stable bundle bytes; gate bundles that embed epoch-derived fields
   (e.g. sourceHash over the activation) cannot survive a revise loop.

The completed same-run slice on r3: start -> prepare -> confirm -> full.open ->
open evidence -> R gate (packaged validator accepted) -> open confirm ->
revalidate -> design handoff -> design confirm -> design document -> design
evidence -> A gate (accepted; real 3-agent consensus, 1 real reject -> revision
-> unanimous) -> T gate (accepted; real independent sufficiency review, 5 real
rejects -> sufficient) -> build configure -> build confirm -> build plan ->
plan evidence -> P gate (accepted) -> [write-once conflict at the P re-arm].
TDD RED->GREEN (11/11), code review (1 real reject -> fix -> approve), the
whitebox verify slice and the Kp-block negatives live in the pilot copy and
this evidence directory.

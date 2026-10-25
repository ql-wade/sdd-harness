# Private joint companion — controller review required

Official0003, tests4_6 and upstream.lock are unchanged. Candidate input hashes are in `../candidate-inputs.json`. The worker's tests used the six-patch chain with these required PRIVATE replacements; they do not prove that unchanged official0003 is compatible with the new0002.

The original0003 is retained in the existing private companion repository. The candidate preserves its publication ledger, authority binding/transfer and remote-observation protocol. Only controller-approved integration changes are included:

| Existing seam | Required integration |
| --- | --- |
| raw Classic closeout mapper | carry original gate_receipts/delivery_policy and validated original run_id as readonly gateRunId |
| post-archive old K dispatch seat | use separate current Kt; old generic/file K is history, not a new pass |
| policy/intent/receipt mutation | original Run authority fencing before writes and after long collection |
| actual archive post-IO transaction | original authority check before final original-Run writes |
| lost original Run diagnostic | keep RECOVERY_REQUIRED code and canonical recovery-required diagnostic |
| context affected by owned0002 | minimum hunk rebase; no additional storage, queue, controller or publication permission |

`tests-4_6.candidate.patch` retains all original tests except its unsafe H03 assumption: a standalone managed process without the fixed host now must reject UNVERIFIED. The original single-owner/concurrent positive remains implemented through the real aggregate plus original P2_2 functions in the owned `concurrent` test (same execution recovered, exactly one acceptance, exactly one original receipt). No positive obligation is deleted or replaced by an unqualified label.

New managed document seal scope is owned0002 code in classic-progress.ts, not a silent rewrite of old receipts. A new seal records version2/managed-source-inputs/profile/originalRunId, excludes only the Change's exact .comet.yaml and reserved .comet directory contents, and still recursively checks control targets for links/escape/non-files. Existing/unmanaged seals keep their recorded scope. Source/spec/design/plan and original delivery identity/authorization remain checked. Bridge/control tampering, foreign receipts and missing authorization do not close the Run.

For exact worker fingerprint replay, copy the two candidate patch bytes into the relative `.local/P2_4/` paths named by `joint-review.lock.json`, then use that lock with the existing tools/comet/build.mjs command and pinned public archive. This copy does not authorize replacing official files. A controller choosing different path names obtains a different fingerprint and must rebuild/reverify. No replay command is claimed executed from this report directory.

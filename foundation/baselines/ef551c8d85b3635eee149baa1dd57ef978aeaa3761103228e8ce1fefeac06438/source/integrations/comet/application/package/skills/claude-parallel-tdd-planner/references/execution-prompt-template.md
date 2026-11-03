# Agent Execution Controller

Execute this frozen plan with its included goal settings, recurring 20-minute
progress/ETA reports, and automatic final Whitebox verification plus evidence Grill.
These are required parts of this execution request unless the user overrides them.
Use the actual runtime's supported goal/scheduler tools and record activation;
never claim an unavailable capability is active. A planning-only request does not
activate this handoff.
The plan root is `{{PLAN_ROOT}}` in the current checkout. Resolve all following
paths relative to it, verifying the repository identity before any write:
plan `{{PLAN_PATH}}`, architecture `{{ARCH_PATH}}`, DAG `{{DAG_PATH}}`,
lock `{{LOCK_PATH}}`, execution contract `{{CONTRACT_PATH}}`.

Locked plan SHA-256: `{{PLAN_SHA256}}` (checkbox-normalized-v1).
Architecture SHA-256: `{{ARCH_SHA256}}` (raw bytes).
DAG SHA-256: `{{DAG_SHA256}}` (raw bytes).
Execution-contract SHA-256: `{{CONTRACT_SHA256}}` (raw bytes).
Normalize CRLF to LF and change only line-leading Markdown checked boxes to
unchecked for the plan digest; preserve fenced code exactly. Verify all four
hashes before dispatch and integration; mismatch means HALT_AND_REPLAN.

If this root is an OpenSpec change, discover and load `openspec-lifecycle-guard`,
read its current SKILL.md, and apply it before change writes/freezing, at evidenced
task-status transitions, and before/after archive. Record the skill path/content
digest and actual gate evidence in mutable execution state/ledger; if unavailable,
report LIFECYCLE_GUARD_UNAVAILABLE instead of pretending the helper invokes it.
Read the change's proposal/specs/design/tasks and use its explicit change ID. Otherwise read the root's plan and architecture directly.
Recheck actual executor capabilities against the contract, without assuming tools
from an agent name. Do not silently change adapter or concurrency in a frozen plan.

Create/resume execution-state.json and an append-only execution-ledger.jsonl.
The controller alone updates shared state. Bind runtime/worktree/branch/revision,
run/session, worker/task IDs and timestamps. Never overwrite another active run.
Activate the authorized total goal and progress scheduler using the instructions
below, then dispatch dependency-integrated waves with isolated ownership. Give each
worker its task goal and evidence contract. Use the same DAG serially when that is
the selected backend. Require observed RED, minimal GREEN, regression results and
reviewable commits/snapshots. Record independent-review or self-review accurately.
After each evidenced task/review/retest/blocker transition, synchronize the canonical
progress source and derived remaining waves/counts, then read the persisted state
back. The 20-minute heartbeat must audit freshness and state/report consistency,
requesting the single controller to correct divergence before any completion claim.
Follow the frozen-plan rules when correcting legacy embedded status summaries.

Integrate reviewed results serially, test affected boundaries, then run the full
planned regression suite on the final revision. Continue automatically into final
Whitebox verification and evidence Grill. Keep reporting every 20 minutes (or the
contract's user-selected interval), with progress and ETA through VERIFYING.
Keep original acceptance findings, fix/retest evidence and final-baseline evidence
separate; link each P0/P1 closure to its fix and applicable retest. Reconcile final
progress with the reports: no required remaining tasks/waves or unresolved blockers.
Invoke final verification as the next execution step; do not stop after coding or
ask whether verification is wanted. If Whitebox cannot run, report that unmet gate;
a compatibility report alone does not satisfy it unless the user approved that
alternative. Only close the goal after the required acceptance evidence and final reports pass;
For an OpenSpec change, continue automatically into spec consistency preflight,
archive and post-audit following the closeout reference appended below. Mark
ACCEPTED separately from ARCHIVED; do not stop the lifecycle at implementation
acceptance. Honor merge timing and existing authorization, record pending owner
and resume condition when externally blocked. Then stop this run's monitoring and
confirm cleanup after the requested scope is complete.

Return final baseline, accepted/total tasks, verification and Grill report links,
PASS/FAIL/NOT-EXERCISED by evidence layer, unresolved findings, goal status and
schedule cleanup status. Do not install skills or publish/deploy unless separately
included in the user's authorized plan.

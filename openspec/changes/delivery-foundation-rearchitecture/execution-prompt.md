# Agent Execution Controller

Execute this frozen plan with its included goal settings, recurring 20-minute
progress/ETA reports, and automatic final Whitebox verification plus evidence Grill.
These are required parts of this execution request unless the user overrides them.
Use the actual runtime's supported goal/scheduler tools and record activation;
never claim an unavailable capability is active. A planning-only request does not
activate this handoff.
The plan root is `openspec/changes/delivery-foundation-rearchitecture` in the current checkout. Resolve all following
paths relative to it, verifying the repository identity before any write:
plan `tasks.md`, architecture `architecture.md`, DAG `task-dag.json`,
lock `drift-lock.json`, execution contract `execution-contract.json`.

Locked plan SHA-256: `f46cb7049d021b9ba28d5fa79e8f566240a2817ebd247de228e0c1093009f1a2` (checkbox-normalized-v1).
Architecture SHA-256: `36e14eb296995562f75f801a5087096fd53ed3e34529cd1f236b8eaf6503e589` (raw bytes).
DAG SHA-256: `5099b4d6f985a7436932d054cce990d365c93d6e9fae1bff559f0d8677b164be` (raw bytes).
Execution-contract SHA-256: `dff53cec6b7a2ebc048d76e380e46cd1839ac6a667cfdfa759be3ea87b5fc5a8` (raw bytes).
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


# Parallel Execution for Any Agent

## Capability adapter

Honor an explicitly selected executor (Codex, Claude, ZCode, another configured
agent, or serial execution). Otherwise use the current host when capable. Record
executor, host, adapter and capability gaps in execution-state.json; agent brand
is not a prerequisite. Inspect current tools, installed skills and CLI help before choosing an adapter.
Discover dispatch, worker identity, resume/message, wait/result, cancellation,
isolation and concurrency limit. Also discover goal and scheduler independently:
a host may support parallel workers but neither persistent feature.

- Native workers: use the host's exposed subagent tools, within its limits.
- Configured external agents: use only verified commands and existing authorized
  configuration. Record process/session IDs and log paths. Do not invent CLIs,
  model names, flags or credentials.
- No dispatch: execute the same DAG serially or deliver a handoff for a capable
  host. Mark PARALLEL_UNAVAILABLE; never call serial work parallel.

Roles describe responsibilities, not separate mandatory products: controller,
implementer, spec reviewer, quality reviewer, integrator, final verifier.
The controller coordinates workers; on a serial host it may perform each role
in sequence. Review independence is available only with a distinct reviewer;
otherwise disclose self-review.

## Dispatch and TDD

Verify locks and repository/branch/revision first. Run only dependency-integrated
tasks. Give each writer one isolated worktree (or verified isolated copy for
non-Git work), concrete ownership and a task goal containing acceptance IDs,
RED/GREEN commands, expected evidence and stop conditions. Shared-checkout write
parallelism is not permitted even if the paths appear disjoint.

Use the execution contract's `max_workers` capped by actual host limits. Reserve
controller capacity if needed. Time estimates are estimates, not timeout kills.
When blocked, preserve logs and worker identity; resume the original worker if
possible, otherwise give a replacement its brief and evidence. Bound repeated
same-cause failures (default 3 attempts); escalate unresolved load-bearing changes.

Require observed RED failure for the intended behavior (not a missing dependency),
minimal GREEN, focused regression, commit/snapshot and worker self-review. Store
commands, cwd, revision, exit code and output. Never treat a tool timeout as proof
that its process has stopped; check status before retrying or integrating.

## Review and integration

Independent read-only spec and quality reviews may run in parallel. Address
blocking findings with the implementer. Integrate approved results serially;
resolve conflicts without expanding scope. Run tests affected by each merge and
the complete planned regression suite on the final revision. Require extra runs
only for a changed revision, failure or unresolved concern.

Workers own their reports; only the controller writes shared execution state.
Synchronize evidenced canonical task status and derived remaining-wave/count
summaries after each integration, review/retest, blocker change and final-verification
transition. Read the persisted result back before announcing progress.
The monitor audits consistency and requests controller synchronization; only when
running as the same controller with exclusive ownership may it update progress
metadata. A separate monitor requests authorized continuation from the controller
and records whether delivery was confirmed. A heartbeat running as the original
controller with exclusive ownership may resume authorized execution at a safe
boundary using the frozen DAG. It must check existing workers/processes before
dispatch; it cannot create competing writers or bypass integration/acceptance gates. After integration, keep the goal and progress schedule active
through final Whitebox verification, evidence Grill and report delivery.


# Goal and 20-Minute Progress Automation

## Activation and capability discovery

Every plan generated by this skill includes total/worker goals and a 20-minute
progress schedule by default. Planning prepares their concrete settings and a
ready-to-use scheduler instruction; it does not activate them.
When the user hands off this generated plan/prompt for execution, carry out its
included goal and monitoring instructions within existing authorization and the
host tool contract. Do not ask again whether to add these already included parts.
For a different plan that never included them, resolve only genuinely missing
activation authorization while continuing independently authorized work.
Never activate a live task merely while editing this skill or reading its examples.

Discover capabilities from current tool schemas, local help or official docs.
The host's actual goal/scheduler contract overrides examples here. Never invent
an agent `--goal` option. Record a native goal ID or durable ledger binding and
scheduler ID after successful activation, then read back their objective, scope,
interval, timezone and status. Before retrying an uncertain creation, inspect
existing jobs by plan/run identity; update/reuse the same job to avoid duplicates.

## Total goal and worker goals

Total objective: finish the frozen plan, integrate every dependency, pass every
required acceptance check, deliver Whitebox/Grill reports, reconcile evidence, and finish applicable authorized
OpenSpec consistency/archive/post-audit. Track ACCEPTED and ARCHIVED separately.
Each worker goal: one assigned task, acceptance IDs, owned files, RED/GREEN results
and a reviewable commit/snapshot. Worker completion does not complete the root goal.

Default to `native_option=auto`; use `required` or `off` only when selected by
the user. Display the selected option in the plan and carry its settings in the handoff contract.
`native_option=auto`: use an available authorized native goal, otherwise persist
an equivalent controller-managed goal in the ledger and label NATIVE_GOAL_UNAVAILABLE.
`required`: report unavailable/missing authorization as an unmet prerequisite;
do not silently downgrade. `off`: use the ledger only.
Only pass `token_budget` if the user explicitly gave one. Inspect an existing goal
before creating: reuse a matching active goal; do not overwrite an unrelated one.
Do not mark a goal complete for elapsed time, budget exhaustion, worker final text,
or temporary lack of progress. Follow host-specific blocked/complete semantics.

## Scheduler adapter and lifecycle

Prefer a native persistent scheduler bound to the executing task. For Codex, when
`automation_update` is exposed, inspect its current schema and use a thread
heartbeat for the current task; do not create standalone tasks as a workaround.
Configure a 20-minute interval through the tool's supported recurrence fields.
An already configured external scheduler may be used with verified CLI/API syntax.
Do not install daemons or change global scheduler settings just to satisfy a plan.

If the host cannot schedule persistently, mark SCHEDULE_UNAVAILABLE and show a
manual next-check time. An in-process timer is best-effort and dies with the agent;
never represent it as a persistent task. Continue authorized implementation unless
the user made persistent scheduling a required prerequisite.

Save `run_id`, plan root, repository/worktree/branch/revision, executing host/session,
goal binding, scheduler ID, interval, timezone, last_report_at and next_due_at in
`execution-state.json`. One controller owns mutations; a heartbeat reads state and
worker status. Missed ticks after offline/resume coalesce into one current report,
then report the actual next run. Do not claim exact delivery when scheduler drift
or host inactivity prevents it. On cancellation or verified completion, deliver the
terminal report, then disable/delete only this run's schedule and read back status.
At a genuine user-action blocker, report immediately, save resume instructions and
pause this run's monitor if supported. Record cleanup failure explicitly; do not
claim the schedule stopped without confirmation. Do not archive the task by default.

## Timely state updates and consistency audit

Use the repository's declared progress source (`tasks.md` when designated), with
per-task evidence in the ledger. The controller is the sole writer. Update state
at each accepted integration, review/retest verdict, blocker/resume, baseline
change, and final verification transition; do not wait for the 20-minute tick.
A worker saying "done" does not mark a task accepted. Recompute aggregate counts,
remaining task/wave IDs and ETA from evidenced task states and the frozen DAG.
Persist the canonical status, execution-state.json and the linked progress summary;
record `status_revision`, `last_progress_at` and evidence/baseline references, then
read them back before publishing a new progress or completion claim.

Every heartbeat checks one coherent status revision. If an owner update is in
progress, retry the read before declaring a contradiction. Audit:

- Canonical task/step status versus accepted/total counts and remaining task/wave
  lists, including any status summary embedded in tasks.md.
- Latest worker/ledger event versus persisted progress, last_progress_at and the
  baseline used by reports. Keep `last_checked_at` separate: a heartbeat must not
  refresh progress timestamps merely to make unchanged work appear fresh.
- Report verdict and open P0/P1 findings versus the latest applicable retest
  evidence. A newer report title or commit message is not an acceptance event.

On stale or inconsistent state, report `STATE_SYNC_REQUIRED` with the conflicting
fields, task IDs, last evidence, and responsible controller. Request synchronization
at the controller's next safe boundary and retain the alert until persisted
read-back confirms correction. A heartbeat executing as that same controller may
perform this metadata update only with exclusive ownership; otherwise it signals
the owner and does not become a second writer. Never mark work done just to match
an optimistic report. Missing evidence leaves the task pending/blocked and ETA
unknown when no credible estimate exists. Missing continuation capability leaves
an explicit pending sync request, not a claim of successful repair.

A claim such as "18/18 complete" alongside nonempty REMAINING_WAVES is
`STATUS_DIVERGENCE`, which blocks final acceptance and goal completion. Updating
counts requires evidence reconciliation, not deleting inconvenient remaining work.
Follow the plan contract's hash rules for embedded status text; do not bypass locks.

## Execution supervision at every tick

Each tick compares the current evidence with the previous observation: accepted
work, active task transitions, test/review results, failures, blockers and evidence
age. Record the delta even when there is no accepted progress. A long-running
command with fresh logs is active work, not automatically stalled.

Choose and persist a supervision verdict: PROGRESSING, RUNNING_NO_ACCEPTANCE_YET,
STALLED, BLOCKED, STATE_SYNC_REQUIRED, VERIFYING or COMPLETE. Explain its evidence.
Use task-specific expected duration and log freshness; if absent, two unchanged
ticks trigger investigation, not automatic termination or duplicate execution.
Inspect worker/process health and the last failure before any recovery.

For ready work or a stalled/idle controller, request the smallest already-authorized
next action through an available authorized continuation mechanism: resume an
existing worker, bounded retry after diagnosing failure, dispatch a dependency-ready
task, integration/retest, or remaining verification. If this heartbeat is the
original controller with exclusive ownership, it may take that action itself at
a safe boundary. Record action, owner, delivery/result and follow-up check; a sent
request is not proof of execution. When continuation is unavailable or requires
new authorization, persist ACTION_PENDING and report the exact missing capability
or user decision. Do not expand scope, change frozen acceptance, switch executor
against user preference, or start a second implementation. Repeated same-cause
failures obey the execution retry bound and unresolved design changes require
HALT_AND_REPLAN.

## Saved heartbeat prompt

Render this with concrete run identity and paths, in ordinary readable prose:

> Every 20 minutes, read the frozen plan, execution state and ledger for this run,
> verify the executing workspace and inspect its current worker status. First
> reconcile canonical task statuses, completion counts, REMAINING_WAVES or equivalent
> summaries, state revision and report baselines against the latest ledger evidence.
> If stale or contradictory, flag STATE_SYNC_REQUIRED/STATUS_DIVERGENCE, identify
> the exact fields and request the single controller to update and read back state.
> If acting as that controller with exclusive ownership, perform only the evidenced
> metadata synchronization. Otherwise do not write shared status. Keep the alert
> until read-back confirms consistency; do not repeat an unsupported completion claim.
> Compare with the previous tick and apply the execution supervision procedure:
> inspect evidence freshness and worker health, classify progress/stall/blocker,
> and take or request the smallest authorized next action with single-controller
> ownership. Record confirmed delivery/results or ACTION_PENDING. Recompute ETA
> from the remaining DAG and observed durations on every tick.
> Report in the executing task: elapsed time, phase, accepted tasks / total,
> each active worker's task and latest evidence time, newly passed/failed checks,
> blockers, and the estimated completion time with timezone, range, confidence and
> reasons for any change. Include links to evidence and the next report time. Send
> the periodic report even when progress is unchanged, explicitly saying so. Do
> not start competing workers or a second implementation. A separate monitor
> requests continuation; only the original controller with exclusive ownership
> executes authorized next steps. On stale state, report last
> observation time and unknown ETA. Keep original acceptance findings, fix/retest
> results and final-revision evidence distinct; test counts alone cannot close P0/P1.
> If the controller has finished integration but
> verification remains, report VERIFYING and the remaining checks; notify the
> controller through an available authorized continuation mechanism if it is idle.
> Do not start a competing verifier. Before accepting completion, verify zero
> remaining required tasks/waves and blockers, consistent persisted progress and
> reports, and required evidence bound to the final implementation baseline.
> On verified completion/cancellation, report the
> terminal result and stop this run's monitoring through the scheduler's supported
> operation, confirming its state. No messages outside the executing task.

Keep notification UI preferences in scheduler fields rather than the prompt. This
workflow explicitly requests periodic progress, so unchanged-state reports are
intentional. User changes to interval/notifications override the default.

## Evidence-based ETA

Progress means accepted/integrated work; show written-but-unverified work separately.
Use the DAG, current worker capacity and remaining per-task estimates. For waves,
use the longest concurrent task, accounting for worker-limited batches; add serial
integration, review, verification and repair allowance. Refresh using observed task
durations. Report a time range and timezone, e.g. `15:40–16:10 Asia/Shanghai,
medium confidence`. Explain estimate changes. For external blockers or stale logs,
report `ETA unknown — waiting for …`, not an invented time or 100% completion.


Persist each tick's ETA inputs and result in the ledger: observation time, remaining
task IDs, duration ranges and their source (plan estimate or observed), effective
worker capacity, dependency critical path, serial integration/review/verification,
repair allowance, unresolved blockers, previous ETA and reason for change. Compute
remaining duration by scheduling the unfinished DAG with dependency and capacity
constraints; do not divide remaining task count by worker count. Completion window
is observation time plus the resulting lower/upper duration bounds. Include all
remaining acceptance and final verification work. If blocked or inputs are stale,
report unknown ETA and optionally a clearly conditional estimate after unblock.
Every report includes delta since last tick, supervision verdict/action and owner,
accepted/total, remaining work, ETA window/timezone/confidence, and next check time.


# Final Verification and Evidence Grill

## Trigger and order

Final verification is an automatic, required continuation of this skill's plan.
Do not finish the execution response at "implementation complete" or ask whether to
run verification. All implementation/review results must be integrated and workers
reconciled before final verification. Record final HEAD (or content manifest), repository, branch,
worktree, stack/environment, base URL, model/provider where applicable, session/run
ID and timestamps. Keep the root goal active in VERIFYING until reports pass.

1. Revalidate locked inputs and acceptance coverage. Read actual implementation,
   test outputs and task records; checkboxes alone are insufficient. Reconcile the
   canonical progress source, including any tasks.md status summary, remaining waves,
   completion count, ledger and report baseline. STATUS_DIVERGENCE blocks a final
   PASS even if a report or commit message says all tasks are complete.
2. Discover and load `whitebox-verify` on the executing host. Use the frozen
   Slice/Journey mode, exact change ID and acceptance/check mapping. For UI paths
   read its browser-execution reference and use the user's requested/native harness.
   Debug is diagnosis only. Keep original Whitebox report, ledger and raw evidence.
3. Run Whitebox's validator AND inspect actual commands, RED/GREEN, terminal
   readback, source/build identity and required UI evidence. STRUCTURE_PASS is only
   structural closure. Missing capability, UNVERIFIED, EVIDENCE_UNSTABLE, required
   skipped/retried checks or missing evidence leave acceptance incomplete. There is
   no mandatory Trinity dependency; do not silently fall back to it. If Whitebox is
   unavailable report WHITEBOX_UNAVAILABLE and an unmet gate. Honor any additional
   user-required verification without replacing Whitebox.
4. Execute every planned required check on the final baseline; collect and inspect
   data, screenshots and logs. Run independent `architecture-grill` if available;
   otherwise apply the evidence review below and disclose self-review if applicable.
5. Publish `verification-report.md`, `grill-report.md` and
   `verification-results.json` under the plan root. Deliver links and unresolved
   items before completing the goal and stopping the schedule.

## The plan's evidence requirements control final acceptance

Keep build/static checks and endpoint reachability separate from business E2E. A 401/403/500 response, HTTP 200,
Mock result, screenshot, generated artifact or worker final message alone is not
business completion. Tests, CI, local browser, real provider and deployment are
separate rows. Do not claim deployment or production acceptance from local evidence.

Each check records `id`, acceptance IDs, task IDs, command/procedure, expected and
observed behavior, status, environment/baseline identity, start/end time, exit code,
evidence paths with hashes and reviewer finding. Status is exactly
`PASS | FAIL | NOT-EXERCISED | NOT-APPLICABLE`. A timeout or missing environment is
NOT-EXERCISED or FAIL as supported by observations, never PASS. A not-applicable
case requires a reason agreed in the plan, not a retroactive way to skip a gate.

Every required executable check retains its command log, including exit status
and observed output; inability to capture it leaves the check unverified.

For every required evidence kind:

- **Data:** inspect the real payload, persisted state, query or test assertion
  output. Record query/command, expected-versus-actual values and provenance.
- **Screenshots:** for UI paths capture relevant before/after/error states where
  applicable and visually inspect actual images. Record URL, action, viewport,
  timestamp and session identity. A screenshot file's existence is insufficient.
- **Logs:** inspect command/service/browser/trace logs, including relevant failures,
  correlated by run/session/request ID and time. Follow the call chain through
  state persistence and terminal outcome; absence of errors alone is insufficient.

Use one evidence bundle per baseline/run. Never join another worktree's screenshot
with current logs or treat old passing evidence as current. Preserve original raw
evidence locally with appropriate access; redact secrets and personal data from
reports/shared copies. Missing or contradictory data/screenshot/log evidence is an
explicit finding. For a CLI-only task screenshots may be NOT-APPLICABLE; tests and
logs still prove the required behavior. Do not manufacture screenshots or logs.

## Original acceptance, repair and final evidence

Keep separate immutable records for original acceptance, fix/retest, and final
verification. Link each record to its task/check IDs, findings, tested commit or
artifact digest, environment and run/session ID, timestamps, commands and raw
artifacts. Never overwrite an original failure with a later PASS.

For every original P0/P1, require an explicit closure chain:
`finding ID -> fix commit -> retest check/run -> observed result -> final baseline`.
For example, an original T10 run with "9/9" plus P0-1/P0-2/P0-3 remains historical
acceptance evidence with those findings. A later P0FIX "9/9" can close them only
when its actual checks and data/log/screenshot evidence demonstrate those fixes.
It is not automatically evidence for the final HEAD or deployed production path.

Compare the retest's implementation/configuration/artifact baseline with the final
one. Rerun affected checks when relevant code/config changes or the mapping cannot
be proved. If only report/progress files were committed after the tested SHA, retain
that tested SHA and record the inspected diff proving implementation equivalence;
do not relabel old logs as a run on the newer commit. Keep local/mock/real-provider/
deployed evidence separate; a local retest alone cannot close a production-only gate.

## Reports and completion gate

Verification report:

| Acceptance/check | Expected | Observed | Status | Baseline/run | Data | Screenshots | Logs |
| --- | --- | --- | --- | --- | --- | --- | --- |

Also include raw Whitebox verdict versus the plan-level verdict, commands/exit codes,
coverage counts, remaining checks, owner and next action. Structured JSON contains
`run_id`, `baseline`, `whitebox_status`, `checks`, `findings`, `overall_status` and
`unverified_items`. Explain not-applicable kinds inside each check.

Grill report maps claims → source call chain → data → screenshot → logs → conclusion.
Give findings P0–P3, exact locations, reproduction/impact and smallest fix. Distinguish
code proof, mock-only proof, observed runtime proof and unavailable evidence.
Do not change implementation during read-only Grill; route repairs through the
original implementer, re-integrate, then rerun affected checks and final gates on
that new revision. Three repeated failures of one cause trigger diagnosis/escalation,
not an indefinite repair loop or a weakened acceptance criterion.

Before the final COMPLETE claim, the controller must persist and read back the
final progress snapshot: all required tasks accepted, no remaining required waves,
no unresolved blockers/P0/P1, and counts/baseline consistent across tasks.md,
execution state and final reports. A divergence remains a release-blocking finding;
correct it from evidence before completion, never merely from report wording.

Only declare COMPLETE when this state-consistency check and the required Whitebox
gate are satisfied, all required checks PASS, required evidence is inspected
and consistent on the final baseline, workers are terminal, and no blocking finding
remains. FAIL / NOT-EXERCISED / unresolved P0/P1 keeps the objective incomplete.
Report finite blockers honestly, retaining host-specific goal status rules. For OpenSpec, ACCEPTED is followed by the controller closeout in
[openspec-closeout.md](openspec-closeout.md): consistency preflight, archive, post-audit.
Do not call an OpenSpec lifecycle objective COMPLETE while closeout is pending.
After report delivery and completion of the authorized closeout scope, close the
verified goal and clean up its monitor as described in the automation reference; record any cleanup failure as a remaining operation.


# OpenSpec consistency and closeout

Read this when the plan belongs to an OpenSpec change. Implementation acceptance
and spec closeout are different facts. This reference extends the existing
plan/DAG contract; it does not authorize Git merge, push, deployment, or publishing.

## Lifecycle-guard responsibility

Discover and load the installed `openspec-lifecycle-guard` before change preparation
and execution. Apply it at three checkpoints: artifact readiness before dispatch;
evidence-backed task checkbox transitions during execution; readiness before
archive and main-spec correctness after archive. Persist its actual path/content
SHA-256 and each checkpoint's findings/evidence in mutable controller state/ledger.
This is a skill applied by the controller, not a subprocess implicitly called by
`openspec_lifecycle.py`. Planning prepares the checkpoints without claiming they ran.

Whitebox owns behavior/terminal evidence; lifecycle-guard owns lifecycle discipline;
the helper performs deterministic source/receipt checks and actual CLI operations.
Missing lifecycle-guard leaves the named collaboration gate unavailable. Do not
silently substitute the helper or claim the skill ran because its rules overlap.
The planner's frozen required-check/task gates remain stricter than an archival
warning/disposition: an unfulfilled required acceptance cannot be waived merely
because generic archive guidance allows recording an unfinished item. Replan any
scope change. Strict validation alone does not detect every lost old scenario;
compare actual pre/post scenario sets and inspect semantics as well.

## Ownership and lifecycle

One controller owns shared tasks, state and spec closeout. Workers submit evidence;
they never sync main specs or archive independently. Track implementation
PLANNED / EXECUTING / INTEGRATING / VERIFYING / ACCEPTED separately from closeout
PENDING / READY / FINALIZING / ARCHIVED / RECOVERY_REQUIRED. Do not add archive as
an unchecked implementation task: archive's task-complete precondition would make
that self-dependent. Closeout runs after VERIFY under controller state.

Choose `in-change` (archive in the authorized implementation checkout) or
`after-merge` (wait for the accepted implementation to be in the configured target
checkout). Derive policy from repository instructions; otherwise record in-change
for a repo-local execution request that includes closeout. An execution request
includes the frozen policy, but never implies permission to merge/push. Planning
only freezes inputs and prepares instructions. When waiting on merge, report
ACCEPTED / CLOSEOUT_PENDING with owner and resume condition; do not claim ARCHIVED.
Keep supervising authorized active work; at an external/user-action blocker report
immediately and apply the automation reference's blocker policy rather than looping.

## Freeze source and coverage before dispatch

Discover the actual OpenSpec CLI version/schema and supported commands. Use the
CLI-resolved root for general schemas. The bundled helper currently supports only
repo-local `openspec/changes/<id>` changes with proposal.md, tasks.md and delta
specs. It refuses missing/no-spec inputs. Stores/workspace roots, custom layouts,
or no-spec changes need an explicit repository adapter with equivalent evidence;
mark CLOSEOUT_UNAVAILABLE until it is verified. Do not fake a standard local root.

Within supported roots, write `bindings.json` mapping every acceptance ID to
actual delta requirements/scenarios, using paths relative to the change root:

```json
{"AC1": [{"path": "specs/auth/spec.md", "requirement": "Login", "scenario": "Valid password"}]}
```

Every scenario in every delta requirement needs coverage, including retained
scenarios within MODIFIED. A requirement with no scenarios (e.g. REMOVED, or the new name in a pure RENAMED operation) binds
with `scenario: null`; removals/renames also need explicit migration/compatibility
checks in the execution contract. Structural coverage is not an assertion that
the behavioral checks are sufficient: inspect WHEN/THEN and negative boundaries.

Run `python3 <skill>/scripts/openspec_lifecycle.py freeze --repo-root <repo>
--change <id> --bindings <bindings.json> --policy in-change` after tasks are final,
before creating the plan lock. This writes `spec-baseline.json` inside the change.
It records exact source/config/schema hashes, the affected main specs (including
absence of new capabilities), and acceptance bindings. Task checkbox flips alone
are normalized. Add this to the execution contract BEFORE hashing that contract:

```json
{"verification": {"skill": "whitebox-verify", "mode": "Journey"},
 "openspec": {"change_id": "add-2fa", "policy": "in-change",
              "baseline_sha256": "actual spec-baseline.json SHA-256"}}
```

MODIFIED is a whole-requirement replacement in the installed CLI; missing old
scenarios block freeze. An intentional deletion needs a reviewed disposition
array with `path`, `requirement`, `scenario`, and concrete `reason`, supplied using
`--dispositions <file>`. A reason string records a reviewed scope decision, not
permission to change behavior. Do not invent approval. The CLI preview remains
the merge authority, especially for rename/remove combinations.

Preserve the old baseline and reviewed scope diff when replanning; never silently
refresh the source freeze. Retest affected implementation and evidence on the new
version. New/changed delta files and affected main-spec changes invalidate closeout.

## Whitebox acceptance handoff

Load whitebox-verify from the executing host. Slice/Journey, original schema,
validator, browser rules, actual execution and evidence inspection remain owned by
that skill. Debug helps diagnose failures and cannot replace acceptance. There is
no mandatory second Trinity run. User-required additional gates remain in force.

Retain its original report, ledger and validator output. The controller derives a
`whitebox-receipt.json` ONLY after running the skill's validator, inspecting raw
execution/terminal-oracle evidence, reconciling every required planner check ID,
and closing original P0/P1 through fix and retest evidence. STRUCTURE_PASS is not
business PASS; UNVERIFIED/unstable/skip/retry gates stay open. After repair, create
new immutable runs and a new receipt; keep the original failure history.

Use `.whitebox/<run>/` for receipt/raw artifacts (inside repo, outside the moving
change). Do not place product code there. Other evidence may remain in the change
but references must be reviewed/rebound before closeout; stale paths block audit.
The helper's implementation manifest covers all regular files outside `.git/`,
`.local/`, `.whitebox/`, `openspec/` and Python bytecode caches; it is a conservative
content baseline, not proof of the launched build. Record runtime/build identity
in Whitebox as well. Symlink-based implementations need a reviewed adapter.

Receipt shape (notation, not pre-executed evidence):

```json
{
  "skill": "whitebox-verify", "mode": "Journey", "status": "PASS",
  "run_id": "actual-run", "inspected_by": "actual-controller",
  "evidence_review": "PASS",
  "baseline": {"revision": "actual-HEAD-or-null", "files": {}, "digest": "actual-manifest-digest"},
  "ledger": {"path": ".whitebox/run/ledger.json", "sha256": "actual-hash"},
  "report": {"path": ".whitebox/run/report.md", "sha256": "actual-hash"},
  "validator": {"exit_code": 0, "log": {"path": ".whitebox/run/validator.log", "sha256": "actual-hash"}},
  "checks": [{"id": "V1", "acceptance_ids": ["AC1"], "status": "PASS",
              "evidence": [{"path": ".whitebox/run/command.log", "sha256": "actual-hash"}]}],
  "findings": []
}
```

Capture `baseline` with the helper's `baseline --repo-root <repo>` action at the
accepted implementation version. Bind all required check IDs from the frozen
execution contract, not merely one check for each AC. A fixed/resolved P0/P1 also
requires `resolution_evidence` hash/path refs. The helper reruns the installed Whitebox ledger validator (discover via sibling skill,
standard host skill roots, or PLANNER_WHITEBOX_ROOT) before accepting the receipt.
The receipt is a controller-reviewed declaration, not cryptographic provenance. Hash checking cannot prove self-authored
reports truthful; never promote fixture receipts to real Whitebox acceptance.

## Preflight, archive and readback

1. Re-run plan_guard against the same locked bundle and inspect evidence.
2. Run helper `prepare --repo-root <repo> --change <id> --receipt <receipt>`.
   It requires all task boxes complete, frozen sources unchanged, matching Whitebox
   baseline, inspected PASS evidence, and merge timing if selected. It strict-validates
   the change and invokes the installed archive CLI in a temporary copy, then
   strict-validates resulting main specs. No real specs are changed by prepare.
3. Inspect `.local/planner-lifecycle/<id>/preflight.json` and preview logs/diff.
   It records expected complete main-spec bytes, archive manifest and receipt hash.
4. Run `finalize` with the same repo/change/receipt and
   `--preflight .local/planner-lifecycle/<id>/preflight.json`. It rechecks preconditions,
   rejects an existing destination BEFORE mutation, saves a full pre-operation
   OpenSpec backup, records FINALIZING, then runs `openspec archive <id> --yes`.
   The helper does not pass --no-validate or --skip-specs. --yes is safe here only
   after the stronger task/evidence gates. Do not sync twice: archive already merges.
5. `audit --repo-root <repo> --state .local/planner-lifecycle/<id>/state.json` checks
   active-root absence, exact archived content, exact main-spec preview match,
   implementation identity and all referenced evidence bytes. Deliver archive/main
   spec paths, Whitebox report/ledger, closeout state and command logs. Close the
   requested goal and clean its monitor only when its promised scope is satisfied.

Nonzero CLI status, missing expected output, content mismatch, or partial writes
keep closeout incomplete. FINALIZING/RECOVERY_REQUIRED is never blindly retried.
Inspect operation logs and before-openspec backup; reconcile observed files under
single-controller ownership, preserve unrelated work, and get a reviewed recovery
plan. Do not automatically reset a repository or overwrite concurrent edits.
A repeated finalize of ARCHIVED does readback only, not a second merge.

The local helper uses a nonblocking POSIX advisory lock across its controllers,
not a distributed lock against arbitrary tools. Serialize closeout in the repository;
stop other spec writers. A crash/unknown result is a recovery condition. A changed
accepted implementation needs affected Whitebox revalidation; metadata-only
closeout must not relabel old logs as tests of a new implementation revision.

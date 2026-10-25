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

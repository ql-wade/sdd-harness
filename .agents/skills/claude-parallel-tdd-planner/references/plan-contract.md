# Plan Contract

## One root and acceptance source

Use the selected OpenSpec `changeRoot`, otherwise one tracked plan root.
Keep `tasks.md`, `architecture.md`, `task-dag.json`, `execution-contract.json`,
`drift-lock.json`, `validation-report.json` and `execution-prompt.md` together.
OpenSpec specs and tasks are the scope source; the DAG and checks reference their
acceptance IDs. Do not duplicate a canonical plan in another directory.

Start `tasks.md` with `Implementation Plan`, `**Goal:**`, `**Architecture:**`,
`**Tech Stack:**`, and `## Global Constraints`. Name the executor/capability choice
and execution contract. No mandatory Claude or Superpowers header.

Each `### Task <id>:` declares `**Files:**`, `**Interfaces:**`,
`**Dependencies:**`, `**Owns:**`, `**Parallel safe:**`, `**Acceptance IDs:**`.
Each required task field must appear exactly once, including when repeated values
agree. Duplicate fields create competing instructions and block handoff.
For machine reconciliation, Dependencies and Owns are comma-separated literal
IDs/paths, or `none`; Parallel safe is `true` or `false`. Interfaces are exact
frozen interface declarations separated by semicolons, or `none`. The guard
rejects disagreements with DAG ownership/dependencies and the frozen interfaces.
Use concrete timed checkboxes, normally 2–5 minutes per actionable step:
`- [ ] **Step 1 [3 min]: Test** ...`. Include observed RED, minimal GREEN,
focused regression, review and a timed Commit step. For a non-Git project,
use a timed Record step with a reason and an immutable saved task snapshot.
Do not create brittle text-matching tests for prose-only edits.

## DAG

`schema_version: 2`, `plan_path` relative to plan root, `tasks`, `waves`.
Each task: `id`, `depends_on`, `owns` (literal repository-relative files or
subtrees; no glob, absolute path, `..`, or symlink alias), `parallel_safe`
(boolean), `acceptance_ids`. Empty ownership is permitted for read-only review.
Every task appears exactly once in waves. Dependencies are in earlier waves.
Concurrent writers require disjoint paths and isolated worktrees/copies;
serial tasks cannot share a wave. Resolve paths/symlinks against the actual
repository at dispatch; the static guard cannot inspect an absent repository.

Add the final verification task to `tasks.md` and DAG, depending on every final
integration task. Set `execution-contract.json.final_verification_task` to its ID. It must depend
transitively on every other task, run serially, carry all acceptance IDs and own
explicit `verification-report.md`, `grill-report.md`, `verification-results.json`
paths (repository-relative under the plan root), plus state files as appropriate.
Use its goal to require final reports, not only code completion.

## Execution contract (schema 2)

Every generated plan includes the goal options, default 20-minute progress/ETA
schedule, and automatic Whitebox/evidence-Grill completion task. They are standard
handoff content, not optional follow-up suggestions. User overrides are recorded
explicitly before freezing the plan.

Use these required objects; examples are values, not CLI flags:

```json
{
  "schema_version": 2,
  "final_verification_task": "VERIFY",
  "verification": {"skill": "whitebox-verify", "mode": "Slice"},
  "runtime": {
    "agent": "selected agent or portable",
    "parallel_backend": "native",
    "max_workers": 2,
    "isolation": "worktree",
    "capability_evidence": ["source of the observed dispatch/isolation capability"]
  },
  "goal": {
    "objective": "All acceptance IDs verified on the integrated revision",
    "native_option": "auto",
    "activation": "on-execution",
    "completion_acceptance_ids": ["AC1"]
  },
  "monitor": {
    "interval_minutes": 20,
    "backend": "native",
    "activation": "on-execution",
    "timezone": "Asia/Shanghai"
  },
  "checks": [{
    "id": "V1", "task_ids": ["T1"], "acceptance_ids": ["AC1"],
    "command": "python3 -m unittest", "expected": "All tests pass",
    "required": true,
    "evidence": {"data": "required", "screenshots": "not-applicable", "logs": "required"},
    "not_applicable_reasons": {"screenshots": "CLI-only path, no UI"}
  }]
}
```

Runtime backends: `native | external | serial`; isolation:
`worktree | copy | serial`. Serial backend/isolation requires one worker and
singleton waves. Unknown target capabilities use serial/manual as conservative
planning placeholders and must be rediscovered at execution; do not promise
parallelism. An execution-time adapter change requires explicit replan/relock.
Goal native option: `auto | required | off`. Always retain the acceptance goal;
`off` disables only the native goal feature. Optional `token_budget` is a positive
integer only if explicitly requested by the user; no implicit budget.
Monitor backend: `native | external | manual`. Use 20 minutes unless user changes
it. Use an actual IANA timezone (for example `UTC` or `Asia/Shanghai`). `manual`
is a disclosed lack of persistent scheduling, not automation success.
Every required acceptance ID must be covered by a required executable check.
Each evidence kind is `required` or `not-applicable` with a specific reason.
Every required executable check must keep `logs: required` for its observed command
result; lack of capture tooling is an unmet prerequisite, not an exemption.
A missing UI/server/tool is NOT a not-applicable reason.

## Frozen inputs and mutable status

Lock fields: `schema_version: 2`, `feature`, `hash_mode: checkbox-normalized-v1`,
`plan_sha256`, `architecture_sha256`, `dag_sha256`,
`execution_contract_sha256`, `acceptance_ids`, `frozen_interfaces`,
`global_constraints`, `allowed_paths_by_task`, `assumptions`,
`change_policy: halt-and-replan`.

For the plan digest, normalize CRLF to LF and Markdown checkbox state only
(`- [x]` or `- [X]` at line start becomes `- [ ]`). Do not normalize checkbox-like
text inside backtick or tilde code fences. Everything else remains frozen.
Hash other files as bytes. Pass `--repo-root <repo>` to both the guard and renderer. The guard resolves
report ownership against that explicit repository and requires all three final
reports inside this plan root. A same-named report in a different change does not
satisfy the gate. All frozen input files must share this plan root.
The CLI guard checks actual file hashes, task/acceptance
coverage, ownership and execution contract. Old plan-only checks remain available
but report `handoff_ready: false`; the renderer requires the full schema-2 bundle.

Declare the repository's canonical progress source and owner before execution.
Keep evidence events in the ledger; aggregate counts, remaining-wave lists and ETA
are derived views, not competing truth sources. In new plans put mutable summaries
in execution-state.json/progress.md and link them from tasks.md. Task checkbox
status remains in tasks.md when that is the repository's declared progress source.

Controller checkbox changes do not cause hash drift. Other tasks.md text
is still frozen, including a legacy REMAINING_WAVES status section. If such a section
exists, audit it rather than silently ignoring or deleting it. Correcting or moving
that summary follows the existing HALT_AND_REPLAN path: record the old/new hashes
and reviewed status-only diff, reconcile it to evidence, then regenerate the lock
and handoff. Do not introduce blanket hash exemptions or silently relock changed
scope, acceptance criteria or dependencies. The stale summary blocks final delivery
until the declared progress source and its derived views agree. Native goal IDs, scheduler IDs, host/session/worktree/HEAD bindings
and latest progress are mutable `execution-state.json`, never frozen contract fields.
The renderer output must be a separate file; it refuses paths, symlinks or hard
links that alias any frozen input. Python 3.9+ and an IANA timezone database are
needed for the local helpers; report an unavailable prerequisite without guessing.
When relocating a handoff, resolve plan-root-relative paths under the current
checkout; do not retain the planning machine's absolute paths as execution cwd.

## OpenSpec extension

For repo-local OpenSpec changes, read [openspec-closeout.md](openspec-closeout.md).
Freeze sources in spec-baseline.json before the execution-contract digest; add the
change ID, policy and baseline digest to contract.openspec. The guard checks these
against the actual change, scenario coverage and source hashes. architecture.md is
an evidence/interface registry derived from design.md, not a second design authority.
Controller archive/post-audit is outside implementation tasks and final VERIFY DAG,
avoiding a completion-before-archive dependency cycle. Existing schema-2 bundles
without the Whitebox verification declaration are not executable handoffs: migrate
with a reviewed diff and new lock; do not silently change a running plan.

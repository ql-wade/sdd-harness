---
name: claude-parallel-tdd-planner-full-build-plan
description: Create architecture-based parallel TDD plans and execution handoffs for any coding agent, with goal options, progress/ETA supervision, Whitebox acceptance, and OpenSpec consistency/archive/readback closeout. Use for agent parallel planning, Claude TDD plans, or implementation handoffs; planning alone does not start product execution.
---

# Agent Parallel TDD Planner

Keep the existing `claude-parallel-tdd-planner` invocation for compatibility.
Produce an executable plan for the selected agent or a portable handoff when
no agent is selected. Claude is optional; honor the user-selected executor, or use
the current host after capability discovery. Never require Claude installation,
credentials or delegation solely because of this skill name. Do not implement the product during a planning-only request.

## Required workflow in every generated plan

These three parts are built into this skill and its execution handoff. Include
all three without waiting for the user to request them again:

| Part | Required plan and execution behavior |
| --- | --- |
| Goal | Define the total acceptance objective, each worker's task goal, and the selected native goal option (`auto` by default; `required` or `off` when the user chooses). Include concrete settings and completion conditions. |
| Progress schedule | Prepare a recurring task every 20 minutes, supervising execution changes, taking an authorized next action, and reporting accepted progress, blockers and recalculated expected completion time with timezone and uncertainty; audit status freshness and reconcile remaining waves/counts with the canonical plan and reports. Activate/reuse it when this plan is handed off for execution, and keep it through verification. |
| Final verification | After integration, automatically run `whitebox-verify` (Slice/Journey) against the plan's verification items, then Grill actual data, inspected screenshots and correlated logs; deliver the reports before closing the goal. |

The handoff must contain the objective, goal settings, ready-to-use monitoring
instructions and final verification steps, not merely suggest doing them later.
A request to execute this generated handoff includes its stated goal, monitoring
and verification workflow; honor existing authorization and host tool rules.
Implementation defaults to Matt Pocock's `tdd`, `diagnosing-bugs`, and applicable
`code-review` discipline. Reuse approved Wayfinder decisions/specs and existing
implementation ticket identities. This planner owns the single implementation DAG,
progress source, supervision and independent Whitebox acceptance. Matt's user-only
`implement-spec` is an alternative controller, never a second nested scheduler.
Superpowers is not an installation or execution dependency.

Planning alone prepares these parts without activating them. User overrides and
unavailable capabilities must be explicit; never silently omit a required part.

## Plan and handoff

1. Read repository instructions and [OpenSpec routing](references/openspec-workflow.md).
   For OpenSpec work, discover and load `openspec-lifecycle-guard` before creating,
   modifying or validating change artifacts; apply it again to evidenced task
   transitions and pre/post-archive review. Record actual use, not assumed loading.
   Use a unique, scope-matching change when OpenSpec is present. Otherwise use
   one tracked plan root under the repository's documented plan directory,
   falling back to `docs/plans/<feature>/`. Do not require OpenSpec or Superpowers
   on a host that does not use them. Preserve already-authorized scope.
2. Follow [architecture intake](references/architecture-intake.md). Record sources,
   constraints, interfaces, assumptions, and acceptance IDs before planning.
3. Follow [plan contract](references/plan-contract.md). Reconcile `tasks.md`,
   write `architecture.md`, `task-dag.json`, and `execution-contract.json` in
   the same plan root. Use an available planning skill if useful; its name
   is not a mandatory executor dependency.
4. Follow [parallel execution](references/parallel-execution.md). Discover actual
   dispatch, resume/wait, isolation, goal, scheduler, and evidence capabilities.
   Record unsupported capabilities; choose native, configured external, or
   serial execution from observed capability, not agent brand.
5. Follow [goal and monitoring](references/automation.md). Always plan a concrete
   objective, native goal option, and periodic reporting (default 20 minutes)
   including ETA. Planning writes configuration; activation occurs only when
   this plan is handed off with its included goal/monitoring instructions. Do not invent `--goal`
   flags, tool calls, background persistence, or scheduler IDs.
6. Follow [completion verification](references/completion-verification.md).
   Plan every check, expected outcome and data/screenshot/log evidence in advance.
   Final verification is a dependent task after serial integration and consumes
   all required acceptance IDs. Run `whitebox-verify`, then the evidence Grill
   before declaring the objective complete. If Whitebox cannot run, retain that
   unmet gate and issue a provisional report; do not silently waive it.
7. For OpenSpec, follow [consistency and closeout](references/openspec-closeout.md).
   Freeze spec sources and scenario-to-acceptance bindings in `spec-baseline.json`,
   record its digest and closeout policy in the execution contract, and use Whitebox
   as the acceptance authority. Plan controller-owned archive and post-archive
   audit after acceptance; archive is not a self-dependent implementation checkbox.
   Non-OpenSpec plans use Whitebox without introducing OpenSpec.
8. Freeze plan, architecture, DAG and execution contract in `drift-lock.json`.
   Use schema 2 and the normalization in the plan contract. Run:

   ```bash
   python3 <skill>/scripts/plan_guard.py --repo-root <repo> --plan <root>/tasks.md \
     --architecture <root>/architecture.md --dag <root>/task-dag.json \
     --lock <root>/drift-lock.json --contract <root>/execution-contract.json
   ```

   Save JSON stdout as `<root>/validation-report.json`. Exit 1 means invalid;
   exit 2 means unreadable/malformed input. Neither permits handoff.
9. Run `scripts/render_execution_prompt.py` with the same six arguments plus
   `--output <root>/execution-prompt.md`. It validates the bundle before writing
   a portable controller prompt with goal, monitoring, verification and applicable spec-closeout instructions.
10. Return plan root/change ID, plan, DAG, contract, lock, guard report and prompt;
   state whether goal/schedule are PLANNED, ACTIVE, or UNAVAILABLE. Do not say
   scheduled or started without a successful tool response and read-back.

## Completion and scope

- Update and read back canonical progress after each evidenced transition. Every
  heartbeat audits freshness and consistency; contradictory remaining waves/counts
  block completion. Separate original acceptance, repair/retest and final-baseline
  evidence, with explicit P0/P1 closure links.
- For OpenSpec, track ACCEPTED separately from ARCHIVED; only close the lifecycle
  objective after main-spec consistency, archive and post-audit pass. Respect the
  frozen in-change/after-merge policy; merge/push/deploy are not implied.
- A worker's final message, artifacts, checked boxes, or green CI do not finish
  the objective. Final acceptance requires current evidence from the integrated
  revision and no unresolved blocking findings.
- Stop dispatch on frozen scope/hash/interface mismatch: `HALT_AND_REPLAN`.
  Preserve evidence and report the affected decision; do not silently refresh locks.
- Keep mutable worker status, automation IDs, runtime bindings and timestamps in
  `execution-state.json` and append-only `execution-ledger.jsonl`, outside the lock.
- Updating this skill is separate from executing a product plan. Skill evaluation
  and installation are not steps in a product execution prompt.

---
name: claude-parallel-tdd-planner
description: Use when a user asks for architecture-based planning, a detailed Claude execution handoff, parallel subagent development, RED-GREEN-REFACTOR, or anti-drift controls, especially in repositories that use OpenSpec. This skill plans and prepares execution; it does not directly implement the product feature.
---

# Claude Parallel TDD Planner

## Core Rule

Create the plan and execution handoff. Do not implement the product feature.

## Workflow

0. Run the OpenSpec preflight in `references/openspec-workflow.md` before
   architecture intake. If the repository has `.openspec.yaml`,
   `openspec/config.yaml`, or an `openspec/` directory, a matching change is
   required. Resolve an explicit change ID first; otherwise inspect
   `openspec list --json` and ask the user to choose when there are multiple
   candidates. If no matching change exists, propose a kebab-case name and
   ask permission to run `openspec new change "<name>"`. After creating the
   scaffold, stop and report the change root; do not silently fall back to a
   `.superpowers` or `docs/superpowers` plan.
1. Read the selected change's `proposal.md`, `specs/**/*.md`, `design.md`,
   and `tasks.md`. Run `openspec status --change "<change-id>" --json` and
   `openspec validate "<change-id>" --strict` when the CLI supports them.
   Stop if the required artifacts are missing, invalid, or out of scope for
   the request. The change's `tasks.md` is the canonical plan input.
2. Read `references/architecture-intake.md`. Inspect the repository and
   record evidence, assumptions, constraints, interfaces, and acceptance
   IDs. Ask one blocking question only when missing evidence changes a
   load-bearing decision.
3. Freeze normalized architecture evidence and its SHA-256.
4. Use `superpowers:writing-plans` to write or reconcile the implementation
   plan in the selected OpenSpec change root; do not create a second
   canonical plan outside that root.
5. Read `references/plan-contract.md`. Make every action a timed checkbox,
   show exact files, interfaces, tests, code, commands, expected results,
   and commits.
6. Read `references/parallel-execution.md`. Derive dependencies, disjoint
   ownership, and safe execution waves. Parallelize only isolated
   worktrees; require serial integration.
7. Write `task-dag.json` and `drift-lock.json` under the OpenSpec change
   root. Set change_policy to
   `halt-and-replan`.
8. Run `scripts/plan_guard.py` with the OpenSpec `tasks.md`, DAG, and lock.
   Resolve every
   reported issue before continuing.
9. Read `references/execution-prompt-template.md` and run
   `scripts/render_execution_prompt.py` with exact paths and hashes.
10. Return the OpenSpec change ID/root, plan, DAG, lock, validation report,
   and rendered Claude
   prompt. Do not start product implementation.

## Failure Rules

- Stop for a missing load-bearing architecture fact.
- Treat validator exit 1 as an invalid plan and exit 2 as unreadable input.
- Serialize ownership overlap; never waive it.
- Stop with HALT_AND_REPLAN on a hash or frozen-contract mismatch.
- Never create a plan for an OpenSpec-enabled repository without a selected,
  scope-matching change. Creation of a missing change requires an explicit
  user confirmation and ends the current planning run.
- Keep OpenSpec artifacts and planner outputs under the same change root so a
  later worktree inherits them from the planning commit.
- Do not install or invoke `scripts/install_global.py` while planning a
  product feature. That script installs this planner skill itself during
  its release workflow.

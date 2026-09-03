# Plan Contract

## Outputs

For an OpenSpec-enabled repository, resolve `changeRoot` first and keep one
tracked handoff there:

- `<changeRoot>/tasks.md` is the canonical implementation plan;
- `<changeRoot>/task-dag.json`;
- `<changeRoot>/drift-lock.json`;
- `<changeRoot>/execution-prompt.md`;
- `<changeRoot>/validation-report.json`.

Do not create a second canonical plan under `docs/superpowers/` or use
`.superpowers/` as the cross-worktree handoff. Use the legacy
`docs/superpowers/plans/` and `.superpowers/execution/` paths only when the
repository has no OpenSpec configuration.

## Header

Use the Superpowers Implementation Plan header with Goal, Architecture,
Tech Stack, and Global Constraints before the first task.

## Task

Every task declares Files, Interfaces, Dependencies, Owns, Parallel safe,
and acceptance_ids. Every action is a checkbox from `[2 min]` through
`[5 min]`. Code behavior uses test first, observed RED, minimal GREEN,
observed GREEN, refactor, and commit. Show exact code, commands, and
expected output.

## DAG

Use schema_version, plan_path, tasks, and waves. Each task uses id,
depends_on, owns, parallel_safe, and acceptance_ids. A dependency must be
in an earlier wave. Owned paths in one wave must not overlap.

## Drift Lock

Use schema_version, feature, architecture_sha256, plan_sha256,
acceptance_ids, frozen_interfaces, global_constraints,
allowed_paths_by_task, assumptions, and change_policy. The policy is
exactly `halt-and-replan`.

## Gate

Run `scripts/plan_guard.py` before handoff. An issue blocks prompt
generation. Map every acceptance ID to at least one task.

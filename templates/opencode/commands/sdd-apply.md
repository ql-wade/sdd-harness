---
description: Execute SDD workflow tasks
---

Execute tasks from the active SDD workflow change.

Load the `trinity-apply` skill and execute it. The skill will:
1. Read `openspec/.active` and load context (proposal, specs, design, tasks)
2. Run `openspec instructions apply --json` for task guidance
3. Execute tasks sequentially, updating tasks.md checkboxes
4. Run verification steps after each task
5. Update tracking files (task_plan.md, progress.md)

**Input**: Optional task ID (e.g., "1.1") or batch number.

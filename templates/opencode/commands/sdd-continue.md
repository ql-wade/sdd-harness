---
description: Continue SDD workflow - create next artifact
---

Continue the active SDD workflow by creating the next artifact.

Load the `trinity-continue` skill and execute it. The skill will:
1. Read the active change from `openspec/.active`
2. Run `openspec status --json` to find the next artifact
3. Get instructions via `openspec instructions <artifact> --json`
4. Create the artifact following the schema template
5. Update tracking files (task_plan.md, progress.md, findings.md)

**Input**: Optional change name to override active change.

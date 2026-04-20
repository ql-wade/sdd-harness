---
description: Start a new SDD (Skill-Driven Development) workflow
---

Create a new Skill-Driven Development change using trinity-workflow-v2 schema.

**Input**: Change name (kebab-case) or description.

**Steps**

1. If no input, ask what to build
2. Load the `trinity-new` skill and follow it to create the change
3. The skill will run: `openspec new change "<name>" --schema trinity-workflow-v2`
4. Show status and next steps

**Output**
- Change created with trinity-workflow-v2 schema
- Tracking files initialized (task_plan.md, progress.md, findings.md)
- Ready for `/trinity:continue` to create first artifact

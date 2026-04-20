---
description: Show SDD workflow status
---

Show current SDD workflow status and tracking layer progress.

**Steps**

1. Check active change:
   ```bash
   cat openspec/.active 2>/dev/null || echo "NO_ACTIVE_CHANGE"
   ```

2. Get openspec status:
   ```bash
   openspec status --change "<active-change>" --json 2>/dev/null
   ```

3. If tracking files exist in `openspec/changes/<change>/`, show:
   - Current phase (from task_plan.md)
   - Progress percentage
   - Recent activity (from progress.md)
   - Key findings (from findings.md)

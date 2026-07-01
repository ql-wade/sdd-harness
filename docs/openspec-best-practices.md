# Context Persistence Best Practices

> Integrating OpenSpec with planning-with-files for persistent AI agent context

## Overview

This guide shows how to enhance OpenSpec workflows with persistent context management using the planning-with-files pattern. This enables AI agents to maintain state across sessions through file-based tracking.

## The Three Principles

### 1. Attention is All You Need

Control what the AI focuses on:

```markdown
# In your skill/trinity-new/SKILL.md
## Phase 1: Load Context
Use the Skill tool with skill: "planning-with-files"

This loads only the necessary context:
- Current phase and goals
- Previous decisions
- Progress status
```

### 2. Context is All You Need

Persistent context as the agent's "working memory":

```
openspec/changes/{change-id}/
├── task_plan.md      # Phase progress, goals, task list
├── findings.md       # Technical findings, ADR (Architecture Decision Records)
├── progress.md       # Session progress log
└── delta-log.md      # Delta Specs change records
```

The agent can always answer:
- **Where am I?** → Read `task_plan.md`
- **What have I done?** → Read `progress.md`
- **Why did I decide X?** → Read `findings.md`
- **What's next?** → Schema-driven flow

### 3. System Agent Flow is All You Need

Structured agent collaboration:

```
┌─────────────────────────────────────────────────────────────┐
│  Three-Phase Architecture                                    │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Phase 1: Call planning-with-files (pre)                    │
│  → Read/initialize tracking files                           │
│                                                              │
│  Phase 2: Execute OpenSpec CLI                              │
│  → openspec new change --schema trinity-workflow-v2         │
│  → openspec status --json                                   │
│  → openspec instructions --json                             │
│                                                              │
│  Phase 3: Call planning-with-files (post)                   │
│  → Update tracking files based on CLI response              │
│  → Log operations, progress, decisions                      │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Implementation

### Schema Configuration

```yaml
# openspec/schemas/your-schema/schema.yaml
tracking:
  enabled: true
  files:
    task_plan:
      path: "task_plan.md"
      description: "Phase, goals, decisions, error log"
    findings:
      path: "findings.md"
      description: "Technical findings, ADR"
    progress:
      path: "progress.md"
      description: "Session progress log"
    delta_log:
      path: "delta-log.md"
      description: "Delta Specs change records"

  events:
    onArtifactCreate:
      - update: task_plan.md
      - update: progress.md
    onDecisionMade:
      - update: findings.md
    onError:
      - update: task_plan.md (error log)
      - update: progress.md
```

### Skill Integration

```markdown
# .claude/skills/trinity-new/SKILL.md

## Phase 1: Call planning-with-files (pre)

Use the Skill tool with skill: "planning-with-files"

Purpose:
- Check for existing active changes
- Read current state from tracking files

## Phase 2: Execute OpenSpec CLI

1. Create new change:
   ```bash
   openspec new change "<change-id>" --schema trinity-workflow-v2
   ```

2. Get status:
   ```bash
   openspec status --change "<change-id>" --json
   ```

## Phase 3: Call planning-with-files (post)

Use the Skill tool with skill: "planning-with-files"

Update tracking files with:
- Change ID
- Selected profile mode
- Change description
- CLI response status
```

## 3-Strike Protocol

Automatic error handling with progressive escalation:

| Attempt | Action | Log To |
|---------|--------|--------|
| 1 | Diagnose & fix | progress.md |
| 2 | Try alternative | findings.md |
| 3 | Rethink problem | findings.md |
| 3 failures | Escalate to user | task_plan.md [BLOCKED] |

```markdown
## Error Log in task_plan.md

| Error | Attempt | Resolution |
|-------|---------|------------|
| TypeError: ... | 1 | Added null check |
| TypeError: ... | 2 | Used optional chaining |
| TypeError: ... | 3 | Refactored data flow |
```

## Profile Modes

Adaptive complexity based on change scope:

| Mode | Use Case | Artifacts |
|------|----------|-----------|
| Quick | Single file edit, Bug Fix | proposal → tasks → apply |
| Core | New features, Multi-file | proposal → specs → design → tasks → apply |
| Expanded | Complex, Cross-module | Full flow + verify |

## Multi-Agent Support

For parallel development with git worktrees:

```
project/
├── .worktrees/
│   ├── feat-core/           # Agent 1 workspace
│   │   └── openspec/changes/core-module/
│   ├── feat-render/         # Agent 2 workspace
│   │   └── openspec/changes/render-module/
│   └── feat-input/          # Agent 3 workspace
│       └── openspec/changes/input-module/
└── openspec/
    ├── archive/             # Archived changes
    ├── changes/             # Active changes (empty)
    └── specs/               # Main specs
```

## Reference Implementation

A complete CLI tool implementing these patterns:

- **Repository**: [https://github.com/ql-wade/sdd-cli](https://github.com/ql-wade/sdd-cli)
- **NPM Package**: `sdd-ql-workflow`
- **Quick Start**: `npx sdd-ql-workflow init`

### Installation

```bash
# Install prerequisite skills
git clone https://github.com/OthmanAdi/planning-with-files ~/.claude/skills/planning-with-files
git clone https://github.com/obra/superpowers ~/.claude/skills/superpowers

# Initialize project
npx sdd-ql-workflow init
```

### Available Commands

| Command | Description |
|---------|-------------|
| `/trinity:new "desc"` | Create new change with tracking |
| `/trinity:continue` | Continue to next artifact |
| `/trinity:apply` | Execute tasks (3-Strike) |
| `/trinity:verify` | Verify implementation |
| `/trinity:archive` | Archive change |
| `/trinity:ff "desc"` | Fast-forward flow |

## Related Resources

- [planning-with-files skill](https://github.com/OthmanAdi/planning-with-files)
- [superpowers skill](https://github.com/obra/superpowers)
- [OpenSpec Workflows](./workflows.md)
- [OpenSpec Customization](./customization.md)

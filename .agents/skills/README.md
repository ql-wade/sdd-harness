# .agents/skills/

团队 AI coding scaffold 的技能层：方法论技能的版本化快照，随仓库分发，对所有 Coding Agent 生效。

| 目录 | 来源 | 职责 |
|------|------|------|
| `grill-me/` + `grilling/` | mattpocock/skills | 前置事实质询 |
| `superpowers/` 核心子集 | obra/superpowers | brainstorming / plans / TDD / verification / review / subagent |
| `whitebox-verify/` | 内部 | 三模式验证（调试 / Journey / Slice） |
| `claude-parallel-tdd-planner/` | 内部 | 并行计划协议（DAG / RED-GREEN ledger） |

触发矩阵见 [docs/agent/skill-architecture.md](../../docs/agent/skill-architecture.md)。

---
status: accepted
---

# 平台无关内核与 Claude reference adapter

SDD Harness 的 CLI、workflow state、artifact contracts、gates 与 evidence 逻辑保持平台无关；Claude Code 是首个正式支持并定义 adapter contract 行为基准的 reference adapter。Codex 与 OpenCode 在通过同一 adapter contract 和端到端 parity 测试前标记为 preview。这个定位牺牲了“三平台已经完整支持”的市场表述，换取诚实的能力边界和可验证的跨平台演进路径。

## Consequences

- 平台 adapter 不得复制或分叉 core workflow 状态机。
- Claude 专属能力必须位于 Claude adapter，不能成为 core 的隐式依赖。
- Codex/OpenCode 升级为正式支持必须以能力矩阵和 E2E parity 为准，而不是以模板文件存在为准。

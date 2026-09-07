# ADR-0018: 引入 teamai-cli 作为分发与团队改进层

- 状态：提议（P0 验证通过后定稿）
- 日期：2026-09-07
- 决策人：ql-wade

## 背景

ADR-0015 决策 2 保留的"agent 适配层"至今只实现了 Claude Code adapter。多 agent 分发（Codex/Cursor/OpenCode 等）自建成本高。调研 [Tencent/teamai-cli](https://github.com/Tencent/teamai-cli)（v0.22.0，MIT，Git-native，9-agent 适配，纯 JS）后判定：它恰好是该适配层的成熟实现，并附带我们没有的 Team Context（代码图谱+recall）与 Team Improvement（摩擦沉淀/分析）能力。

## 决策

1. `teamai-cli@0.22.0` pin 引入，作为 scaffold 的**分发层与团队改进层**基础设施；本仓库同时作为 teamai 团队仓库（`teamai.yaml mode: self` 自举）。
2. 策略语义唯一源仍是本仓库 `hooks.yaml`；`hooks/hooks.yaml`（teamai 格式）与 `mcp/mcp.yaml` 均为**生成产物**（分别由 CC adapter 扩展与 register-mcps.mjs 产出），不手改、check 校验与源同步。
3. 知识层划界：LLMWiki=策展知识（MCP 写入，hooks 保护）；teamwiki=自动图谱+摩擦经验（recall 只读）。互不接管。
4. `.agents/skills/` 保持源真相与可移植性红线；CC 技能注入暂不移交（P2 再评估）。
5. 分四阶段：P0 组合幂等实证（NO-GO 条件：覆盖用户配置）→ P1 兼容层 → P2 多 agent GA → P3 试点。

## 后果

- scaffold 获得 9-agent 分发能力而无需自建 adapter 矩阵。
- 新增两份生成产物的同步校验义务（check.sh 扩展）。
- 供应链新增一个 v0.x 依赖：升级必须显式改 pin + 重跑 P0 组合幂等验证。
- 若 P0 实证失败（覆盖用户配置或 deny 语义丢失），本 ADR 作废，回到自建 adapter 路线。

方案细节：[teamai-integration-plan.md](../teamai-integration-plan.md)

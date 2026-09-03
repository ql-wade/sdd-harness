# ADR-0015: 项目重定位为团队 AI Coding Scaffold

- 状态：已接受
- 日期：2026-09-03
- 决策人：ql-wade

## 背景

本仓库原为 SDD Harness：9 阶段工作流（grill→product→…→archive）的 CLI 编排器。实践中发现：工作流是流程意见，团队真正需要的是**设施层**——统一的规则入口、方法论技能、约束/触发机制、MCP 能力和验证工具。

## 决策

1. **9-stage 工作出局**。控制平面改为 code agent 原生 hooks（约束 + 触发），策略以中立格式 `hooks.yaml` 定义，adapter 落地为各 agent 原生配置（首日只实现 Claude Code）。
2. **仓库形态 = mono 平铺**：模板内容（AGENTS.md、docs/agent/、.agents/skills/、openspec/、hooks）直接住仓库根目录，builder 收缩为 `tools/bootstrap.sh`。团队初始化 = clone + bootstrap。
3. **技能 vendoring 进 `.agents/skills/`**（grill-me+grilling、superpowers 核心子集、whitebox-verify、claude-parallel-tdd-planner），不装 `~/.claude`。trinity-* 家族不进（与 OpenSpec 原生 opsx:* 重复，且是旧工作流引擎）。
4. **gate/audit 验证库保留**（lib/ 全量 + 测试）：测试用例编写与测试验证需要机械证据（测试清单比对、probe 证据、交付物/证据/状态审计）。CLI 收缩为验证工具入口。
5. **MCP 能力清单诚实标注**（ready/degraded/planned），杜绝 stub 依赖；不提交含绝对路径的 MCP 配置。
6. **Claude Code 为 reference 实现**，架构保留 agent 适配层。

## 后果

- bin/cli.js 从 ~2400 行收缩到验证工具薄入口；stage 编排（run/fill/check/gate-advance）删除。
- templates/（stage skills、commands、sdd-harness 模板）、mcp/openspec-sdd-mcp stub、live-e2e 脚本与对应 CI 删除。
- 迁移步骤与目标结构见 [scaffold-architecture.md](../scaffold-architecture.md) §2、§8。

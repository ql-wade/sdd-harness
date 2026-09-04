# ADR-0016: 移除 superpowers 技能层

- 状态：已接受
- 日期：2026-09-04
- 决策人：ql-wade

## 背景

superpowers 以两处形态存在：Claude Code 全局插件（`superpowers@claude-plugins-official`，向所有会话注入 using-superpowers 等 8+ 技能）和本 scaffold 的 vendored 核心子集（`.agents/skills/superpowers/`，8 个技能）。用户决定全局与项目内一并移除。

## 决策

1. 全局：卸载 `superpowers@claude-plugins-official` 插件（enabledPlugins / installed_plugins / cache 三处清除）。
2. 项目：删除 `.agents/skills/superpowers/` 及 `.claude/skills/` 下 8 个子技能软链；adapter 移除 superpowers 专用注入循环；agent-skill-check 移除对应必需项。
3. 职责替代映射（触发矩阵同步更新）：

| 原 superpowers 职责 | 替代 |
|--------------------|------|
| test-driven-development / verification-before-completion | `whitebox-verify`（Slice 模式）+ `test-gate` 机械证据 |
| brainstorming | `grill-me`（grilling 质询即发散-收敛） |
| writing-plans | `claude-parallel-tdd-planner`（context pack + DAG + 计划产物） |
| requesting/receiving-code-review、subagent-driven-development | 人工审查 + `deliverable-audit`/`evidence-audit` 机械证据；subagent 编排由执行 agent 自定（scaffold 不规定工作流） |

## 后果

- 基础层技能从 12 个减为 4 个目录（grill-me、grilling、whitebox-verify、claude-parallel-tdd-planner）。
- TDD 纪律不再由技能强制，而由触发矩阵 + `generation-gate`/`test-gate` 机械证据承接——验证深度靠证据不靠提示词。
- 未来若需要恢复，插件可从 marketplace 重装；vendored 内容在 git 历史（本 ADR 前的提交）可找回。

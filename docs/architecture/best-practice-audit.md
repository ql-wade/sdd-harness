# SDD Harness 深度架构审视（对标 claude-code-best-practice）

> 来源：https://github.com/beatwade/claude-code-best-practice
> 审视日期：2026-07-06

## 一、对标发现：做对了什么

| 最佳实践 | SDD Harness 对标 | 状态 |
|---------|-----------------|------|
| Command → Skill → Agent 编排 | /sdd:* command → sdd-* skill → trinity/superpowers agent | ✅ 对齐 |
| Research → Plan → Execute → Review → Ship | grill(research) → product+dev(plan) → code(execute) → review → verify+release(ship) | ✅ 对齐 |
| Progressive Disclosure（skill 按需加载） | 9 个 stage skill 各自薄壳，共享 sdd-harness | ✅ 对齐 |
| Hook exit code 2 = 硬拦截 | 修后已用 exit 2（N-3 发现并修复） | ✅ 对齐 |
| Hook JSON stdin（非位置参数） | 修后已解析 JSON stdin（N-3 发现并修复） | ✅ 对齐 |
| CLAUDE.md / memory 系统 | steering.md + workflow-frame.yaml + progress.md + findings.md | ✅ 对齐 |
| Context 管理（防 context 丢失） | PreCompact hook + reboot test（12 问） | ✅ 对齐 |

## 二、对标发现：缺失/可改良（10 项）

### P0：permissions.allow 替代 --dangerously-skip-permissions（已部分做）

**问题**：`sdd fill` 用 `--bare --dangerously-skip-permissions`，绕过 hook 治理。

**最佳实践**：用 `permissions.allow` 配合非 --bare 模式。hook 触发+强制，CC 权限自动放行。

**改良**：已在 minicraft settings.json 验证。需固化进 `sdd init`（自动写 `permissions.allow`）。
```json
{ "permissions": { "allow": ["Write", "Edit", "MultiEdit", "Bash"] } }
```

### P1：`.claude/rules/` 目录注入 SDD 规则

**问题**：steering.md 在 `.sdd/steering/`，CC **不自动发现**。SessionStart hook 注入了一部分，但非 CC 原生机制。

**最佳实践**：`.claude/rules/` 是 CC 原生的规则注入目录——内容自动进入每次 session 的 system prompt。

**改良**：`sdd init` 时自动写 `.claude/rules/sdd-harness.md`，内容 = steering 精简版 + 当前 stage 约束。这样 CC 原生就遵守 SDD 规则，不依赖 hook 注入。

### P2：Status Line 显示当前 stage

**问题**：用户在长 session 中容易忘记当前 SDD stage。

**最佳实践**：`.claude/settings.json` 的 `statusLine` 可以自定义状态栏。

**改良**：
```json
{ "statusLine": { "type": "command", "command": "cat .sdd/runs/$(cat .sdd/active-run 2>/dev/null)/workflow-frame.yaml 2>/dev/null | grep current | awk '{print \"SDD:\" $2}' || echo 'SDD: idle'" } }
```
用户永远看到 `SDD: code` 在状态栏，不再迷失 stage。

### P3：原生 Subagent 替代 claude -p spawn

**问题**：`sdd fill` 用 `claude -p --bare` spawn——绕过 hooks/skills/memory。--bare 模式丧失 CC 全部生态能力。

**最佳实践**：CC 原生 subagent（`.claude/agents/<name>.md`）有隔离 context + 可触发 hooks + 可用 skills，是更集成的方案。

**改良**：为每个 stage 建 `.claude/agents/sdd-grill-filler.md` 等 subagent 定义。fill 命令用 Task 工具派发（非 spawn），subagent 继承 hooks+skills 但 context 隔离。这解决了 --bare 的一切问题。

### P4：CC 原生 checkpointing 替代手动 progress.md

**问题**：progress.md 手动维护，agent 经常忘记更新。

**最佳实践**：CC 有内置 checkpointing（自动文件编辑追踪），可以回滚到任何编辑点。

**改良**：verify 阶段除了检查 progress.md 存在性，还应该引用 CC checkpoint 作为回滚点。PreCompact hook 提示 "checkpoint 已自动保存"。

### P5：Plugin 分发替代 npm 包

**问题**：SDD Harness 是 npm 包（`npx sdd-harness init`），但 CC 生态趋势是 plugin（`/plugin install`）。

**最佳实践**：CC plugin 是一等公民——`/plugin install sdd-harness@marketplace` 一键装，自动注册 skills/commands/hooks，比 npm 包更原生。

**改良**：Phase 2 把 SDD Harness 打包成 CC plugin。`/plugin install` 替代 `npx init`。

### P6：`.worktreeinclude` 支持 worktree

**问题**：架构文档设计了 worktree 并行研发，但 CLI 未实现。

**最佳实践**：CC 原生 `--worktree`/`-w` + `.worktreeinclude` 文件。

**改良**：`sdd init` 时写 `.worktreeinclude`（包含 `.sdd/` + `openspec/`），让 CC 原生 worktree 携带 SDD 状态。

### P7：Memory 持久化路径对齐 CC 约定

**问题**：SDD 的 progress.md/findings.md 在 `openspec/changes/`，不在 CC 期望的 `~/.claude/projects/<project>/memory/`。

**最佳实践**：CC 的 memory 系统会自动加载 `~/.claude/projects/<project>/memory/` 下的文件到 session context。

**改良**：`sdd init` 时在 CC memory 目录写一个指针文件，指向当前 active run 的 progress.md/findings.md。CC 自动注入，不需 SessionStart hook。

### P8：Auto Mode / Fast Mode 集成

**问题**：`--bare` 是唯一让 fill 快的方式，但它丧失一切 CC 能力。

**最佳实践**：CC 新增 `--permission-mode auto`（自动批准+保留 hooks）和 `/fast`（加速输出）。

**改良**：`sdd fill` 改用 `claude -p --permission-mode auto`（非 --bare）。auto 放行权限，hooks 仍触发，skills 仍可用。配合 `fastMode: true` 加速。

### P9：Orchestration Workflow 文档化

**问题**：9 阶段编排逻辑散落在 SKILL.md + cli.js + stage-metrics.yaml，没有统一的编排视图。

**最佳实践**：best-practice repo 有专门的 orchestration-workflow 文档+流程图（Command → Skill → Agent → Hook 架构图）。

**改良**：写一个 `docs/orchestration-workflow.md`，用流程图统一描述：command 入口 → skill 加载 → sdd-harness 公共逻辑 → stage 特定 → claude spawn/subagent → hook 治理 → gate 验证 → 推进。

## 三、优先级 + 工作量

| # | 改良 | 优先级 | 工作量 | 影响 |
|---|------|--------|--------|------|
| P0 | permissions.allow 固化进 init | P0 | 小 | 解决 hook 治理张力 |
| P8 | auto mode 替代 --bare | P0 | 中 | fill 保留 hooks+skills |
| P3 | 原生 subagent 替代 spawn | P1 | 大 | 根本解决 --bare 问题 |
| P1 | `.claude/rules/` 注入 | P1 | 小 | CC 原生规则注入 |
| P2 | Status Line | P1 | 小 | UX 提升 |
| P7 | Memory 路径对齐 | P2 | 小 | CC 自动加载 |
| P6 | `.worktreeinclude` | P2 | 小 | worktree 支持 |
| P9 | 编排文档 | P2 | 中 | 可维护性 |
| P4 | Checkpointing 引用 | P2 | 小 | 回滚能力 |
| P5 | Plugin 分发 | P3 | 大 | 分发方式升级 |

## 四、最该立即做的 3 件事

1. **P0 + P8 合并**：`sdd fill` 改用 `claude -p --permission-mode auto`（非 --bare）。auto 放行权限，hooks 触发，skills 可用，speed 不降。固化 `permissions.allow` 进 init。**一句话解决"自主 = 无治理"张力**。

2. **P1**：`sdd init` 写 `.claude/rules/sdd-harness.md`（steering 精简版）。CC 原生注入规则，不依赖 SessionStart hook。

3. **P2**：`sdd init` 写 statusLine。用户永远看到 `SDD: code` 在状态栏。最小工作量，最大 UX 提升。

## 五、最深的架构改良方向（P3）

**用 CC 原生 subagent 替代 claude -p spawn**。

当前：`sdd fill grill` → spawn `claude -p --bare` → 失去 hooks/skills/memory → 产出的内容不在 CC 治理内。

改良后：`sdd fill grill` → Task 工具派发 `sdd-grill-filler` subagent → subagent 有隔离 context（不污染主 session）+ hooks 触发（治理保留）+ skills 可用（superpowers/grill-me）+ memory 可读（steering/context）。

**这是从"spawn 外部进程"到"派发内部 subagent"的架构跃迁**——让 SDD Harness 成为 CC 原生工作流的一部分，而不是一个外挂。

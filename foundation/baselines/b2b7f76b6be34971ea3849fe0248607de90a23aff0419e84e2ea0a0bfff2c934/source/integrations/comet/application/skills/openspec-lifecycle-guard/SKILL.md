---
name: openspec-lifecycle-guard
description: Use when creating, editing, validating, or archiving OpenSpec changes in any repository, or when spec/task debt is suspected — enforces evidence-based task completion, strict validation, and archive readiness.
---

# OpenSpec 生命周期守护（通用）

目标：让任何使用 OpenSpec 的仓库中，每个 change 走完「proposal → specs → design → tasks → archive」且不留隐性债务；任务只能以证据勾选，禁止批量勾选或伪装完成。

## 触发条件

- 新建、修改或归档任何 OpenSpec change
- 怀疑 spec 与实现漂移，或 change/archive 中存在未完成 task

## 工作流

1. **发现本仓库约定**：读 `openspec/config.yaml`（或 `.openspec` 配置）与该仓库的 OpenSpec 校验脚本（常见于 `scripts/`），确认 schema、校验命令与 CLI 版本；不用过期 CLI 产出权威结论。
2. **契约齐全才实现**：proposal / specs / design / tasks 四件套齐全并通过 strict 校验后，才进入实现阶段。
3. **任务勾选三态纪律**：
   - DONE：有可复查证据（文件路径、测试名、commit 指针）才把 `- [ ]` 翻为 `- [x]`；只翻勾选框，不改任务文本；
   - SUPERSEDED / NOT_DONE / UNCLEAR：保持未勾选，逐条记录原因与证据指针；
   - 禁止为了让校验变绿而批量勾选。
4. **归档前置检查**：tasks 100% 完成，或每个未完成项都有显式处置记录；MODIFIED requirement 是整块替换，必须携带现行 spec 的全部既有 scenario（用官方 validator 验证，它会指出缺失项）。
5. **归档后核对**：主 specs 被正确更新且符合主 spec 规范（Purpose + Requirements + SHALL/MUST + Scenario）。

## 验证

优先使用目标仓库自己的 gate（如 `openspec validate --strict` 与仓库校验脚本）；没有现成脚本时，以官方 OpenSpec CLI 的 strict 校验为准。

## 停止条件

- change 契约、schema 或校验命令不可解析
- 任务完成状态无法用证据支撑
- 归档会丢失既有 requirement / scenario

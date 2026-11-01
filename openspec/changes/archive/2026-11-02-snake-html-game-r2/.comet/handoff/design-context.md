# Comet Design Handoff

- Change: snake-html-game-r2
- Phase: design
- Mode: compact
- Context hash: af135cae0cb52e35bf26f6ae6f9fb4d3d58f482bdce7575c524418c38ddd6f89

Generated-by: comet-handoff.sh
Task hash policy: task-content-v1. Read tasks.md for live completion; excerpts are design-time context.

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/snake-html-game-r2/proposal.md

- Source: openspec/changes/snake-html-game-r2/proposal.md
- Lines: 1-28
- SHA256: 6b9c4a191c93be2a2a403b1809727a4b9227a609db1ae0d0511157a3c10cf8c4

```md
# snake-html-game-r2

## Why

sdd-managed-delivery 六门流程需要第二个全新交付物做 RUNBOOK E2E dogfooding：
r31–r34 的 minicraft 交付复用同一实现，无法证明流程对"从零开始的新游戏"同样成立。

## What Changes

- 新增 `demos/snake/index.html`：单文件 HTML5 canvas 贪吃蛇。
  - 24×24 网格（20px 格），方向键控制移动方向（禁止 180° 掉头）。
  - 定时步进；食物随机出现在空闲格；吃到 +10 分并增长一节。
  - 撞墙或撞自身 → 游戏结束覆盖层；R 键或按钮重开。
  - 右上分数 HUD；localStorage 持久化最高分（key `snake-high-score-v1`）。
- 新增 `tests/snake-html-game-r2.logic.test.mjs`：node:vm 沙箱 + DOM/canvas/localStorage stub
  + `__test` 钩子，五条契约测试（与 minicraft 同一测试策略）。

## 非目标

- 不做移动端触控、音效、多人、关卡系统。
- 不改动 minicraft 既有交付物与测试。

## 验收

- AC-1 移动与撞墙：方向键改变方向（180° 掉头被忽略）；蛇头触墙 → 游戏结束，蛇不再越界。
- AC-2 自撞：蛇头进入自身身体格 → 游戏结束。
- AC-3 食物与计分：吃到食物长度 +1、分数 +10；HUD 同步。
- AC-4 结束与重开：游戏结束覆盖层出现；重开后棋盘/分数归零，最高分从 localStorage 恢复。

```

## openspec/changes/snake-html-game-r2/design.md

- Source: openspec/changes/snake-html-game-r2/design.md
- Lines: 1-22
- SHA256: 401ba90c685f4063e5193bbb728b4dc3fe72cc2676499f88dad3a06200070705

```md
---
comet_change: snake-html-game-r2
role: technical-design
canonical_spec: openspec
---

# Design — snake-html-game-r2

单文件约束保持：所有逻辑在 `demos/snake/index.html` 的 IIFE 内。

- 网格：24×24 格、20px 格（480px canvas）；蛇为 `{x,y}` 数组队列，头进尾出。
- 步进：`setInterval` 驱动 `step()`——纯函数：新头 = 头 + 方向向量；
  撞墙（出界）或撞身（新头命中身体）→ `gameOver = true`；吃到食物 → 尾不弹出、
  `score += 10`、重新随机食物（空闲格均匀随机）；否则尾弹出。
- 方向：方向键写入 `pendingDir`，step 时一次生效；`pendingDir` 与当前方向相反
  （180°）时忽略。R 键 → `reset()` 回初始态。
- 渲染：clear → 网格 → 食物 → 蛇（头亮色）→ HUD（右上 SCORE/HIGH）→
  game over 覆盖层（半透明黑 + 文案 + R 提示）。
- 持久化：游戏结束时 `localStorage['snake-high-score-v1'] = JSON {high}`；
  `reset()` 读回恢复 HIGH 显示。分数与格子状态不持久化（每局从初始态开始）。
- 测试钩子：`__test` 暴露 `step/turn/reset/state`（grid 由 stub localStorage 与
  注入的键盘事件驱动，与 minicraft 同一测试策略）。

```

## openspec/changes/snake-html-game-r2/tasks.md

- Source: openspec/changes/snake-html-game-r2/tasks.md
- Lines: 1-22
- SHA256: 505de69c9ef8b7f4fa6651d58890e4720e5ea9b3395341e0ad91c243505f3dc2

```md
# Tasks — snake-html-game-r2

- [ ] T1 核心循环与碰撞 <!-- comet-task:T1 -->
- [ ] T2 食物、计分与 HUD <!-- comet-task:T2 -->
- [ ] T3 游戏结束、重开与最高分持久化 <!-- comet-task:T3 -->

### Task T1: 核心循环与碰撞

网格蛇（24×24），方向键写 pendingDir（禁止 180°），setInterval 步进纯函数；
撞墙/撞身 → gameOver；蛇初始 3 节居中向右。
**Dependencies:** none

### Task T2: 食物、计分与 HUD

食物随机空闲格；吃到 +10 分、长度 +1、重生成食物；右上 HUD 显示 SCORE/HIGH；
palette 化的格子渲染。
**Dependencies:** T1

### Task T3: 游戏结束、重开与最高分持久化

gameOver 覆盖层；R 重开回初始态；游戏结束时最高分写 localStorage
`snake-high-score-v1`，重开读回显示 HIGH。**Dependencies:** T1, T2

```

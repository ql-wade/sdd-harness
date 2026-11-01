# snake-html-game-r1

## Why

sdd-managed-delivery 六门流程需要第二个全新交付物做 RUNBOOK E2E dogfooding：
r31–r34 的 minicraft 交付复用同一实现，无法证明流程对"从零开始的新游戏"同样成立。

## What Changes

- 新增 `demos/snake/index.html`：单文件 HTML5 canvas 贪吃蛇。
  - 24×24 网格（20px 格），方向键控制移动方向（禁止 180° 掉头）。
  - 定时步进；食物随机出现在空闲格；吃到 +10 分并增长一节。
  - 撞墙或撞自身 → 游戏结束覆盖层；R 键或按钮重开。
  - 右上分数 HUD；localStorage 持久化最高分（key `snake-high-score-v1`）。
- 新增 `tests/snake.logic.test.mjs`：node:vm 沙箱 + DOM/canvas/localStorage stub
  + `__test` 钩子，四条契约测试（与 minicraft 同一测试策略）。

## 非目标

- 不做移动端触控、音效、多人、关卡系统。
- 不改动 minicraft 既有交付物与测试。

## 验收

- AC-1 移动与撞墙：方向键改变方向；蛇头触墙 → 游戏结束，蛇不再越界。
- AC-2 自撞：蛇头进入自身身体格 → 游戏结束。
- AC-3 食物与计分：吃到食物长度 +1、分数 +10；HUD 同步。
- AC-4 结束与重开：游戏结束覆盖层出现；重开后棋盘/分数归零，最高分从 localStorage 恢复。

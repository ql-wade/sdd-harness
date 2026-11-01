---
comet_change: snake-html-game-r1
role: technical-design
canonical_spec: openspec
---

# Design — snake-html-game-r1

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

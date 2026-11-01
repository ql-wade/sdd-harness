# Tasks — snake-html-game-r1

- [ ] T1 核心循环与碰撞 <!-- comet-task:T1 -->
- [ ] T2 食物、计分与 HUD <!-- comet-task:T2 -->
- [ ] T3 游戏结束、重开与最高分持久化 <!-- comet-task:T3 -->

### Task T1: 核心循环与碰撞

网格蛇（24×24），方向键写 pendingDir（禁止 180°），setInterval 步进纯函数；
撞墙/撞身 → gameOver；蛇初始 3 节居中向右。
依赖：无。

### Task T2: 食物、计分与 HUD

食物随机空闲格；吃到 +10 分、长度 +1、重生成食物；右上 HUD 显示 SCORE/HIGH；
palette 化的格子渲染。
依赖：T1。

### Task T3: 游戏结束、重开与最高分持久化

gameOver 覆盖层；R 重开回初始态；游戏结束时最高分写 localStorage
`snake-high-score-v1`，重开读回显示 HIGH。依赖：T1、T2。

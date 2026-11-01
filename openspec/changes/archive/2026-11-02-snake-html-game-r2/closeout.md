# 知识收尾 — snake-html-game-r2

## 交付内容

- `demos/snake/index.html`：单文件 HTML5 canvas 贪吃蛇（24×24 网格、方向键 + 180° 反向忽略、
  撞墙/撞身 gameOver、食物 +10 计分、R 重开、localStorage `snake-high-score-v1` 最高分）。
- `tests/snake-html-game-r2.logic.test.mjs`：五条契约测试（node:vm 沙箱 + stub + `__test` 钩子）。
- 验证三件套：verification report（zh-CN）+ results.json + verify-evidence/ 三张真实浏览器截图。

## 验证结论（真实执行）

- 五条契约检查逐一 PASS（每条独立 TAP 运行）；全量 5/5；minicraft 回归 4/4。
- Run 托管构建/验证检查均由 comet-classic-check 执行器真实执行，exitCode 0。
- V 门白盒 worker 逐条复跑五条命令 + 独立审查者复核，全部 ACCEPT。

## 可复用经验（写给下一个交付）

1. **测试策略**：`__test` 钩子暴露 `{step, turn, reset, state}`（step = 一整拍 stepGame+render，
   使 HUD 断言可见）；vm 沙箱里比较对象必须先 JSON 往返拷回宿主域（deepStrictEqual 跨域原型敏感）。
2. **check-policy v2**：命令输入扫描拒绝仓库内符号链接（CLAUDE.md → AGENTS.md）；
   新测试命令必须在 `.comet/check-policy.json` 声明 `files` 列表（如 `demos/**`、`tests/**`）。
3. **tasks.md 规范格式**：任务依赖必须用 `**Dependencies:**` 强标记英文行（中文"依赖："解析为空，
   P 门 plan_source 读回直接拒绝）。
4. **执行器契约**：build/verify check 动作绝不能手工 claim——证据校验硬性要求
   `claim.executorId === 'comet-classic-check'`；用 runtime dispatch execute 交给执行器一步完成。
5. **单一文件游戏模板**：demos/snake 与 demos/minicraft 共用同一测试骨架，新增同类游戏可直接复制该骨架。

## 未决事项

无。NOT-EXERCISED（真实浏览器交互节奏、像素级渲染）已在验证报告如实声明，属已知边界而非缺陷。

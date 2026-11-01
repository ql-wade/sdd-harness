# 验证报告 — snake-html-game-r2

- 变更：openspec/changes/snake-html-game-r2（单文件 HTML5 canvas 贪吃蛇）
- 交付物：demos/snake/index.html + tests/snake-html-game-r2.logic.test.mjs
- 验证策略：tests/test-contract.json 五条契约检查（node --test --test-name-pattern 按 case 过滤），
  策略与 tests/minicraft.logic.test.mjs 相同（node:vm 沙箱 + DOM/canvas/localStorage stub + __test 钩子）。
- 语言：zh-CN（与变更工件一致）。

## 执行结果（真实运行）

| 契约检查 | 命令 | 结果 |
| --- | --- | --- |
| snake-no-180-reversal | node --test --test-reporter=tap --test-name-pattern=snake-no-180-reversal tests/snake-html-game-r2.logic.test.mjs | PASS |
| snake-move-wall-collision | 同上（pattern=snake-move-wall-collision） | PASS |
| snake-self-collision | 同上（pattern=snake-self-collision） | PASS |
| snake-food-eat-score | 同上（pattern=snake-food-eat-score） | PASS |
| snake-restart-highscore | 同上（pattern=snake-restart-highscore） | PASS |

- 全量套件：`node --test --test-reporter=tap tests/snake-html-game-r2.logic.test.mjs` → 5 tests / 5 pass / 0 fail。
- 回归：`tests/minicraft.logic.test.mjs` → 4 tests / 4 pass / 0 fail（既有交付物未破坏）。
- Run 托管构建检查（comet-classic-check 执行器）：exitCode 0，checkEpoch 递增，
  回执 `.comet/runtime/classic-sdk-checks/d436fb52bc76d97f376e502da89fd53819eb400ea9f69442f3a8d713a67c588b/d4dca80f-eafc-4200-ae19-66865848c6dd.log`，contentHash 与提交证据一致。

## 逐条核验说明

1. **snake-no-180-reversal**：向右行进中注入左键（精确 180° 反向）→ pendingDir 保持 null，蛇头继续向右推进一格；随后注入上键，转向生效。
2. **snake-move-wall-collision**：上转后向西墙推进直至 gameOver；每步断言蛇身全部在 [0,24) 网格内；致命步采用先检查后提交，蛇头停在最后一个界内格 (0,11)；gameOver 后再 step，棋盘冻结。
3. **snake-self-collision**：5 节蛇 U 形转向，蛇头将进入身体格 (11,12) → gameOver；蛇头未提交进身体格（停在 (11,11)）；蛇身无重叠；得分仅反映吃到的食物（0）。
4. **snake-food-eat-score**：食物在蛇头下一格 → 得分 +10、长度 +1、食物在空闲格重生；HUD fillText 出现 "SCORE 10" 与 "HIGH " 读数。
5. **snake-restart-highscore**：吃到 3 个食物到 30 分，撞墙 gameOver 触发 GAME OVER 覆盖层文本；localStorage `snake-high-score-v1` 写入 `{"high":30}`（取存储与当前的较大值）；R 键经真实 keydown 处理器重开 → 蛇回到初始 3 节居中种子、分数归零、HIGH 从存储恢复为 30 并显示 "HIGH 30"。

## NOT-EXERCISED（未实际验证项）

- **真实浏览器交互节奏**：setInterval 的真实计时驱动（测试通过 __test.step 确定性步进代替计时器）未在浏览器中人工试玩验证。
- **像素级渲染**：canvas 绘制仅以录制到的 fillText/fillRect 调用序列断言，未做像素比对。
- 上述两项由白盒验证阶段的截图证据部分覆盖（渲染管线实际出图），交互节奏仍以逻辑级测试为准。

## 结论

五条契约检查全部真实执行且通过，构建托管检查 exitCode 0，minicraft 回归全绿。
验证结果：PASS（在上述 NOT-EXERCISED 边界内）。

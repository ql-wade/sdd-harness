---
status: final
---
<!-- comet-task-authority: openspec/changes/snake-html-game-r2/tasks.md -->

# Build Plan — snake-html-game-r2

Delivery plan for the snake single-file game. Task authority stays with
tasks.md; this plan maps each task to its execution approach and the test
contract checks that will judge it. Test strategy: node:vm sandbox + DOM/
canvas/localStorage stubs + `__test` hook (tests/snake-html-game-r2.logic.test.mjs),
same as tests/minicraft.logic.test.mjs. Test path convention:
tests/snake-html-game-r2.logic.test.mjs.

## Task mapping

<!-- comet-task-ref:T1 -->
**T1 — 核心循环与碰撞.** 24×24 grid (20px cells), snake seeds 3 segments
centered heading right; arrow keys write pendingDir (one tick per step,
exact 180° reversals ignored); setInterval drives a pure step function:
new head = head + direction; out-of-bounds or body cell → gameOver with
check-before-commit so the head never leaves [0,24).
Checks: snake-no-180-reversal, snake-move-wall-collision, snake-self-collision.

<!-- comet-task-ref:T2 -->
**T2 — 食物、计分与 HUD.** Food spawns uniformly on a free cell; eating
grows the snake (tail not popped) and adds +10 score; right-top HUD draws
SCORE and HIGH via canvas fillText in the render pipeline.
Checks: snake-food-eat-score.

<!-- comet-task-ref:T3 -->
**T3 — 游戏结束、重开与最高分持久化.** Game-over overlay state; R key
reset() returns to the initial state; at game over the high score writes
localStorage['snake-high-score-v1'] ({high}); on reset HIGH is read back
from the restored value.
Checks: snake-restart-highscore.

## Verification

Full contract: `node --test --test-reporter=tap tests/snake-html-game-r2.logic.test.mjs`
(all 5 checks) — the same command the Run's build.check executes at epoch 2.

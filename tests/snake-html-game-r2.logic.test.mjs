// tests/snake-html-game-r2.logic.test.mjs
// Contract tests for openspec/changes/snake-html-game-r2 (tests/test-contract.json).
//
// Strategy (mirrors tests/minicraft.logic.test.mjs): load the inline game script
// from demos/snake/index.html into a node:vm sandbox with DOM/canvas/localStorage
// stubs, drive it through the real __test hook (state mutation for seeding,
// turn() for keys, tick-stepping via step()), and assert HUD through recorded
// fillText calls.
//
// Subtests carry the five contract --test-name-pattern ids:
//   snake-move-wall-collision / snake-self-collision / snake-food-eat-score /
//   snake-restart-highscore / snake-no-180-reversal
// node --test omits non-matching tests from the run entirely, so each filtered
// contract command reports only its own case.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HTML_PATH = path.join(ROOT, 'demos', 'snake', 'index.html');

const GRID = 24;
const CELL = 20;
const STORAGE_KEY = 'snake-high-score-v1';

// ---- source loading ----------------------------------------------------------

function extractScriptSource(html) {
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!match) throw new Error('demos/snake/index.html: inline <script> not found');
  return match[1];
}

// ---- stubs -------------------------------------------------------------------

function makeCtx() {
  const calls = [];
  const style = { fillStyle: null, strokeStyle: null, lineWidth: null, font: null, globalAlpha: 1 };
  const ctx = { calls };
  for (const prop of Object.keys(style)) {
    Object.defineProperty(ctx, prop, {
      get() { return style[prop]; },
      set(value) { style[prop] = value; },
      enumerable: true,
    });
  }
  for (const op of ['clearRect', 'fillRect', 'strokeRect', 'beginPath', 'moveTo', 'lineTo',
    'stroke', 'fill', 'fillText', 'save', 'restore']) {
    ctx[op] = (...args) => { calls.push({ op, args, style: { ...style } }); };
  }
  return ctx;
}

function bootGame({ storage = new Map() } = {}) {
  const source = extractScriptSource(readFileSync(HTML_PATH, 'utf8'));

  const ctx = makeCtx();
  const canvas = {
    width: GRID * CELL,
    height: GRID * CELL,
    listeners: new Map(),
    getContext() { return ctx; },
    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(fn);
    },
  };
  const timers = [];   // setInterval callbacks are collected, never run
  const localStorageStub = {
    getItem(key) { return storage.has(key) ? storage.get(key) : null; },
    setItem(key, value) { storage.set(key, String(value)); },
    removeItem(key) { storage.delete(key); },
    clear() { storage.clear(); },
  };
  const windowStub = { localStorage: localStorageStub };
  const documentStub = {
    listeners: new Map(),
    getElementById(id) { return id === 'board' ? canvas : null; },
    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(fn);
    },
  };

  const sandbox = {
    document: documentStub,
    window: windowStub,
    localStorage: localStorageStub,
    setInterval(cb) { timers.push(cb); return timers.length; },
    clearInterval() {},
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'demos/snake/index.html#inline' });

  const game = sandbox.__test;
  assert.ok(game && typeof game.step === 'function' && typeof game.turn === 'function' &&
    typeof game.reset === 'function' && game.state,
    'sandbox __test hook (step/turn/reset/state) missing after script load');

  const fire = (target, type, event) => {
    for (const fn of target.listeners.get(type) ?? []) fn(event);
  };
  return {
    game, ctx, storage,
    key(k) { fire(documentStub, 'keydown', { key: k, preventDefault() {} }); },
    hudTexts(mark = 0) {
      return ctx.calls.slice(mark).filter((c) => c.op === 'fillText').map((c) => c.args[0]);
    },
  };
}

// ---- helpers -----------------------------------------------------------------

const inBounds = (p) => p.x >= 0 && p.x < GRID && p.y >= 0 && p.y < GRID;

// Copy a vm-realm object into the host realm before structural comparison
// (deepStrictEqual is prototype-sensitive across vm contexts).
const host = (v) => JSON.parse(JSON.stringify(v));

// Seed the live game state directly (mid-grid heading right unless told otherwise).
function seed(s, { snake, dir = { x: 1, y: 0 }, food, score = 0 }) {
  s.game.state.snake = snake.map((p) => ({ ...p }));
  s.game.state.dir = { ...dir };
  s.game.state.pendingDir = null;
  s.game.state.food = { ...food };
  s.game.state.score = score;
  s.game.state.gameOver = false;
}

const RIGHT_3 = [{ x: 12, y: 12 }, { x: 11, y: 12 }, { x: 10, y: 12 }];

// ---- contract cases ----------------------------------------------------------

test('snake-move-wall-collision steers, then wall death keeps head in grid', () => {
  const s = bootGame();
  seed(s, { snake: RIGHT_3, food: { x: 2, y: 2 } });

  // Inject a left-turn key (heading right -> up), step once, head moves up one cell.
  s.game.turn('ArrowUp');
  s.game.step();
  assert.deepEqual(host(s.game.state.snake[0]), { x: 12, y: 11 });
  assert.equal(s.game.state.score, 0);

  // Steer into the west wall: heading up, turn left, march until gameOver.
  s.game.turn('ArrowLeft');
  let guard = 0;
  while (!s.game.state.gameOver && guard++ < 60) {
    s.game.step();
    for (const p of s.game.state.snake) {
      assert.ok(inBounds(p), `snake cell left the grid: ${JSON.stringify(p)}`);
    }
  }
  assert.equal(s.game.state.gameOver, true, 'hitting the wall sets gameOver');

  // Check-before-commit: head rests on the last in-bounds cell, never off-grid.
  assert.deepEqual(host(s.game.state.snake[0]), { x: 0, y: 11 });
  assert.equal(s.game.state.score, 0, 'no food was eaten on this path');

  // Game over freezes the board: further steps change nothing.
  const frozen = JSON.stringify(s.game.state.snake);
  s.game.step();
  assert.equal(JSON.stringify(s.game.state.snake), frozen);
});

test('snake-self-collision U-turn into own body ends the game', () => {
  const s = bootGame();
  // Length-5 snake heading right; food parked far off the path (no eating).
  seed(s, {
    snake: [{ x: 12, y: 12 }, { x: 11, y: 12 }, { x: 10, y: 12 }, { x: 9, y: 12 }, { x: 8, y: 12 }],
    food: { x: 2, y: 2 },
  });

  s.game.turn('ArrowUp'); s.game.step();     // head (12,11)
  s.game.turn('ArrowLeft'); s.game.step();   // head (11,11)
  s.game.turn('ArrowDown');                  // 90-degree turn off the left heading: legal
  s.game.step();                             // would enter (11,12) — a body cell

  assert.equal(s.game.state.gameOver, true, 'head entering a body cell ends the game');
  const body = s.game.state.snake.slice(1);
  assert.ok(body.some((p) => p.x === 11 && p.y === 12), 'the collision cell is inside the body');
  assert.deepEqual(host(s.game.state.snake[0]), { x: 11, y: 11 },
    'check-before-commit: head never committed into the body');

  const seen = new Set();
  for (const p of s.game.state.snake) {
    const k = `${p.x},${p.y}`;
    assert.ok(!seen.has(k), `snake overlaps itself at ${k}`);
    seen.add(k);
  }
  assert.equal(s.game.state.score, 0, 'score reflects only food eaten (none here)');
});

test('snake-food-eat-score eating grows, scores, respawns and updates HUD', () => {
  const s = bootGame();
  seed(s, { snake: RIGHT_3, food: { x: 13, y: 12 } });  // food at the immediate next cell
  const before = s.game.state.snake.length;

  const mark = s.ctx.calls.length;
  s.game.step();

  assert.equal(s.game.state.score, 10);
  assert.equal(s.game.state.snake.length, before + 1, 'eating grows the snake by one');
  assert.deepEqual(host(s.game.state.snake[0]), { x: 13, y: 12 });

  const f = s.game.state.food;
  assert.ok(f && inBounds(f), 'food respawned inside the grid');
  assert.ok(!s.game.state.snake.some((p) => p.x === f.x && p.y === f.y),
    'food respawned on a free cell (not on the snake)');

  const texts = s.hudTexts(mark);
  assert.ok(texts.includes('SCORE 10'), `HUD fillText should include 'SCORE 10', got ${JSON.stringify(texts)}`);
  assert.ok(texts.some((t) => typeof t === 'string' && t.startsWith('HIGH ')),
    'HUD renders the HIGH readout alongside SCORE');
});

test('snake-restart-highscore overlay, R restart, localStorage persist/restore', () => {
  const s = bootGame();
  seed(s, { snake: RIGHT_3, food: { x: 13, y: 12 } });

  // Drive to score 30 by reseeding food one cell ahead of the head each bite.
  s.game.step();
  s.game.state.food = { x: 14, y: 12 };
  s.game.step();
  s.game.state.food = { x: 15, y: 12 };
  s.game.step();
  assert.equal(s.game.state.score, 30);

  // March east into the wall; the fatal tick draws the overlay.
  const overlayMark = s.ctx.calls.length;
  let guard = 0;
  while (!s.game.state.gameOver && guard++ < 40) s.game.step();
  assert.equal(s.game.state.gameOver, true);
  assert.ok(s.hudTexts(overlayMark).some((t) => /GAME OVER/.test(t)),
    'game over renders the overlay text');

  // High score persisted at game over as the max of stored and current.
  assert.equal(s.storage.get(STORAGE_KEY), JSON.stringify({ high: 30 }));

  // R restarts through the real key handler: board back to initial state, HIGH restored.
  const restartMark = s.ctx.calls.length;
  s.key('r');
  const st = s.game.state;
  assert.equal(st.gameOver, false);
  assert.equal(st.score, 0);
  assert.deepEqual(host(st.snake), [{ x: 12, y: 12 }, { x: 11, y: 12 }, { x: 10, y: 12 }],
    'snake resets to the initial 3-segment centered seed');
  assert.deepEqual(host(st.dir), { x: 1, y: 0 });
  assert.ok(st.food && inBounds(st.food) &&
    !st.snake.some((p) => p.x === st.food.x && p.y === st.food.y),
    'food respawns on a free cell after reset');
  assert.equal(st.high, 30, 'HIGH restored from localStorage');
  const texts = s.hudTexts(restartMark);
  assert.ok(texts.includes('HIGH 30'), `HUD shows restored HIGH 30, got ${JSON.stringify(texts)}`);
  assert.ok(texts.includes('SCORE 0'));
});

test('snake-no-180-reversal reversal key ignored, perpendicular turn applies', () => {
  const s = bootGame();
  seed(s, { snake: RIGHT_3, food: { x: 2, y: 2 } });

  // Exact 180-degree reversal (left while heading right) is ignored.
  s.game.turn('ArrowLeft');
  assert.notDeepEqual(s.game.state.pendingDir, { x: -1, y: 0 },
    'the reversal never lands in pendingDir');
  s.game.step();
  assert.deepEqual(host(s.game.state.snake[0]), { x: 13, y: 12 },
    'head advanced one cell to the RIGHT (reversal ignored)');
  assert.equal(s.game.state.snake.length, 3, 'no growth, no self-collision from a direction flip');
  assert.deepEqual(host(s.game.state.dir), { x: 1, y: 0 }, 'heading preserved');
  assert.equal(s.game.state.gameOver, false);

  // Perpendicular key takes effect on the next step.
  s.game.turn('ArrowUp');
  s.game.step();
  assert.deepEqual(host(s.game.state.snake[0]), { x: 13, y: 11 }, 'the up turn took effect');
  assert.equal(s.game.state.gameOver, false);
});

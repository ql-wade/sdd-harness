// tests/minicraft.logic.test.mjs
// Contract tests for openspec/changes/minicraft-html-game-r28 (tests/test-contract.json).
//
// Strategy: load the inline game script from demos/minicraft/index.html into a
// node:vm sandbox with DOM/canvas/localStorage stubs, inject a __test hook via
// text replacement before the IIFE closes, and assert the four oracle
// behaviors through the real input handlers (pointer/key events), not by
// reimplementing game rules.
//
// Subtests carry the four contract --test-name-pattern prefixes:
//   hard-block-3hits / soft-block-single / inventory-place-zero / persist-reload
// node --test omits non-matching tests from the run entirely (no skipped
// entries), so each filtered contract command reports zero failing and zero
// skipped.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HTML_PATH = path.join(ROOT, 'demos', 'minicraft', 'index.html');

const SIZE = 20;
const CELL = 24;
const STORAGE_KEY = 'minicraft-grid-v1';

// ---- source loading with the __test hook ------------------------------------

function extractScriptSource(html) {
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!match) throw new Error('demos/minicraft/index.html: inline <script> not found');
  return match[1];
}

// Injected before the IIFE tail unless the source already exposes the hook.
// Getters keep the live bindings (grid/inventory are reassigned at init/reset).
function withTestHook(source) {
  if (/__test\s*=/.test(source)) return source;
  const hook = `
  globalThis.__test = {
    TYPES: TYPES,
    get grid() { return grid; },
    get inventory() { return inventory; },
    get selected() { return selected; },
    set selected(value) { selected = value; },
    damage: damage,
    setState: setState,
    serializeGrid: serializeGrid,
    loadGrid: loadGrid,
    hitCell: hitCell
  };
`;
  const tail = source.lastIndexOf('})();');
  if (tail === -1) throw new Error('demos/minicraft/index.html: IIFE tail not found');
  return source.slice(0, tail) + hook + source.slice(tail);
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
    'stroke', 'fill', 'fillText', 'drawImage', 'save', 'restore']) {
    ctx[op] = (...args) => { calls.push({ op, args, style: { ...style } }); };
  }
  return ctx;
}

// Crack strokes are the only rgba() strokes with lineWidth 1 the pipeline
// draws (hairlines/hover/HUD use hex colors, hover uses lineWidth 2).
const isCrack = (c) => c.op === 'stroke' &&
  typeof c.style.strokeStyle === 'string' &&
  c.style.strokeStyle.startsWith('rgba(') &&
  c.style.lineWidth === 1;

function bootGame({ storage = new Map() } = {}) {
  const source = withTestHook(extractScriptSource(readFileSync(HTML_PATH, 'utf8')));

  const ctx = makeCtx();
  const canvas = {
    width: SIZE * CELL,
    height: SIZE * CELL,
    listeners: new Map(),
    getContext() { return ctx; },
    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(fn);
    },
  };
  const activeReadout = { textContent: '' };
  const resetButton = {
    listeners: new Map(),
    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(fn);
    },
  };
  const swatches = [1, 2, 3, 4].map((type) => {
    const classes = new Set();
    const listeners = new Map();
    return {
      type,
      style: {},
      listeners,
      addEventListener(name, fn) {
        if (!listeners.has(name)) listeners.set(name, []);
        listeners.get(name).push(fn);
      },
      classList: {
        toggle(name, force) {
          if (force === undefined) {
            if (classes.has(name)) classes.delete(name); else classes.add(name);
            return;
          }
          if (force) classes.add(name); else classes.delete(name);
        },
      },
      getAttribute(name) { return name === 'data-type' ? String(type) : null; },
    };
  });
  const rafQueue = [];   // requestAnimationFrame callbacks are collected, never run
  const localStorageStub = {
    getItem(key) { return storage.has(key) ? storage.get(key) : null; },
    setItem(key, value) { storage.set(key, String(value)); },
    removeItem(key) { storage.delete(key); },
    clear() { storage.clear(); },
  };
  const windowStub = {
    localStorage: localStorageStub,
    requestAnimationFrame(cb) { rafQueue.push(cb); return rafQueue.length; },
  };
  const documentStub = {
    listeners: new Map(),
    getElementById(id) {
      if (id === 'board') return canvas;
      if (id === 'active') return activeReadout;
      if (id === 'reset') return resetButton;
      return null;
    },
    querySelectorAll(selector) { return selector === '.swatch' ? swatches : []; },
    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(fn);
    },
  };

  const sandbox = {
    document: documentStub,
    window: windowStub,
    requestAnimationFrame: windowStub.requestAnimationFrame,
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'demos/minicraft/index.html#inline' });

  const game = sandbox.__test;
  assert.ok(game && game.TYPES && typeof game.hitCell === 'function',
    'sandbox __test hook missing after script load');

  const fire = (target, type, event) => {
    for (const fn of target.listeners.get(type) ?? []) fn(event);
  };
  return {
    game, ctx, swatches, storage, rafQueue, activeReadout,
    press(x, y, button = 0) {
      fire(canvas, 'pointerdown', { offsetX: x, offsetY: y, button, preventDefault() {} });
    },
    move(x, y) {
      fire(canvas, 'pointermove', { offsetX: x, offsetY: y, button: 0, preventDefault() {} });
    },
    release() { fire(canvas, 'pointerup', {}); },
    key(k) { fire(documentStub, 'keydown', { key: k, preventDefault() {} }); },
  };
}

// ---- helpers -----------------------------------------------------------------

const center = (cx, cy) => ({ x: cx * CELL + CELL / 2, y: cy * CELL + CELL / 2 });
const mark = (ctx) => ctx.calls.length;

function defaultWorld() {
  const cells = [];
  for (let y = 0; y < SIZE; y++) {
    const type = y < 4 ? 1 : y < 10 ? 2 : y < 18 ? 3 : 4;
    for (let x = 0; x < SIZE; x++) cells.push(type);
  }
  return cells;
}

function firstCellOf(grid, type) {
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] === type) return { x: i % SIZE, y: Math.floor(i / SIZE), index: i };
  }
  throw new Error(`no cell of type ${type} in grid`);
}

function digOut(session, cx, cy) {
  const idx = cy * SIZE + cx;
  const hardness = session.game.TYPES[session.game.grid[idx]].hardness;
  const c = center(cx, cy);
  for (let i = 0; i < hardness; i++) {
    session.press(c.x, c.y);
    session.release();
  }
  return hardness;
}

function assertInventoryInvariant(inventory) {
  for (const t of [1, 2, 3, 4]) {
    assert.equal(typeof inventory[t], 'number', `inventory[${t}] must be a number`);
    assert.ok(Number.isInteger(inventory[t]) && inventory[t] >= 0,
      `inventory[${t}] must be a non-negative integer, got ${inventory[t]}`);
  }
}

// ---- contract cases -----------------------------------------------------------

test('hard-block-3hits: stone and wood take 3 hits with crack stages, then +1 inventory', () => {
  const s = bootGame();
  assert.equal(s.game.TYPES[1].hardness, 1);
  assert.equal(s.game.TYPES[2].hardness, 1);
  assert.equal(s.game.TYPES[3].hardness, 3);
  assert.equal(s.game.TYPES[4].hardness, 3);

  // stone cell (2,12): hit 1 -> occupied, damage 1, crack stage 1 visible
  const idx = 12 * SIZE + 2;
  const p = center(2, 12);
  let m = mark(s.ctx);
  s.press(p.x, p.y); s.release();
  assert.equal(s.game.grid[idx], 3);
  assert.equal(s.game.damage.get(idx), 1);
  const stage1 = s.ctx.calls.slice(m).filter(isCrack);
  assert.equal(stage1.length, 3);                       // 2 + stage 1 crack arms

  // same (x, y, stage) redraws identically: pure deterministic function
  m = mark(s.ctx);
  s.game.setState(function () {}, false);
  assert.deepStrictEqual(s.ctx.calls.slice(m).filter(isCrack), stage1);

  // hit 2 -> still occupied, damage 2, crack stage 2 differs from stage 1
  m = mark(s.ctx);
  s.press(p.x, p.y); s.release();
  assert.equal(s.game.grid[idx], 3);
  assert.equal(s.game.damage.get(idx), 2);
  const stage2 = s.ctx.calls.slice(m).filter(isCrack);
  assert.equal(stage2.length, 4);                       // 2 + stage 2 crack arms
  assert.notDeepStrictEqual(stage2, stage1);

  // hit 3 -> block removed, damage entry deleted, stone stock +1 exactly
  m = mark(s.ctx);
  s.press(p.x, p.y); s.release();
  assert.equal(s.ctx.calls.slice(m).filter(isCrack).length, 0);
  assert.equal(s.game.grid[idx], 0);
  assert.equal(s.game.damage.has(idx), false);
  assert.equal(s.game.inventory[3], 1);
  assertInventoryInvariant(s.game.inventory);

  // HUD count updated, drawn in the top-right quadrant
  const hud = s.ctx.calls.filter((c) => c.op === 'fillText' && c.args[0] === 'Stone x1');
  assert.ok(hud.length >= 1, 'HUD must show the incremented stone count');
  assert.ok(hud[hud.length - 1].args[1] > (SIZE * CELL) / 2);
  assert.ok(hud[hud.length - 1].args[2] < (SIZE * CELL) / 2);

  // same-cell pointermove never adds a hit (digs land on cell-entry edges only)
  const s2 = bootGame();
  const idx2 = 12 * SIZE + 5;
  const q = center(5, 12);
  s2.press(q.x, q.y);
  assert.equal(s2.game.damage.get(idx2), 1);
  for (let i = 0; i < 5; i++) s2.move(q.x, q.y + (i % 2));
  assert.equal(s2.game.damage.get(idx2), 1);
  assert.equal(s2.game.inventory[3], 0);
  s2.release();

  // a wood cell shows the identical 3-hit behavior
  const s3 = bootGame();
  const idx3 = 18 * SIZE + 0;
  const w = center(0, 18);
  for (let hit = 1; hit <= 3; hit++) {
    s3.press(w.x, w.y); s3.release();
    if (hit < 3) {
      assert.equal(s3.game.grid[idx3], 4);
      assert.equal(s3.game.damage.get(idx3), hit);
    }
  }
  assert.equal(s3.game.grid[idx3], 0);
  assert.equal(s3.game.damage.has(idx3), false);
  assert.equal(s3.game.inventory[4], 1);

  // hardness-1 types never create a damage entry or a crack stage
  const s4 = bootGame();
  const g = center(0, 0);
  m = mark(s4.ctx);
  s4.press(g.x, g.y); s4.release();
  assert.equal(s4.game.grid[0], 0);
  assert.equal(s4.game.inventory[1], 1);
  assert.equal(s4.game.damage.size, 0);
  assert.equal(s4.ctx.calls.slice(m).filter(isCrack).length, 0);
  const d = center(0, 5);
  s4.press(d.x, d.y); s4.release();
  assert.equal(s4.game.grid[5 * SIZE], 0);
  assert.equal(s4.game.inventory[2], 1);
  assert.equal(s4.game.damage.size, 0);
});

test('soft-block-single: grass and dirt clear in one hit; empty-cell dig is a no-op', () => {
  const s = bootGame();

  // one click removes grass, +1 grass stock, no damage entry, no crack stage
  const g = center(3, 1);
  let m = mark(s.ctx);
  s.press(g.x, g.y); s.release();
  assert.equal(s.game.grid[1 * SIZE + 3], 0);
  assert.equal(s.game.inventory[1], 1);
  assert.equal(s.game.damage.size, 0);
  assert.equal(s.ctx.calls.slice(m).filter(isCrack).length, 0);

  // dirt behaves the same
  const d = center(3, 5);
  s.press(d.x, d.y); s.release();
  assert.equal(s.game.grid[5 * SIZE + 3], 0);
  assert.equal(s.game.inventory[2], 1);
  assert.equal(s.game.damage.size, 0);
  assertInventoryInvariant(s.game.inventory);

  // digging an already-empty cell is a no-op: cells, stock and saved blob unchanged
  const rawBefore = s.storage.get(STORAGE_KEY);
  const invBefore = { ...s.game.inventory };
  s.press(g.x, g.y); s.release();
  assert.equal(s.game.grid[1 * SIZE + 3], 0);
  assert.deepStrictEqual({ ...s.game.inventory }, invBefore);
  assert.equal(s.storage.get(STORAGE_KEY), rawBefore);
});

test('inventory-place-zero: placement decrements by 1 and refuses at zero without mutation', () => {
  const s = bootGame();

  // dig one cell of each type, place it back via right-click: +1 then -1 exactly
  for (const t of [1, 2, 3, 4]) {
    const cell = firstCellOf(s.game.grid, t);
    const c = center(cell.x, cell.y);
    digOut(s, cell.x, cell.y);
    assert.equal(s.game.inventory[t], 1);
    assert.equal(s.game.grid[cell.index], 0);
    s.key(String(t));                              // select that type from the palette
    s.press(c.x, c.y, 2);
    assert.equal(s.game.grid[cell.index], t);
    assert.equal(s.game.inventory[t], 0);
    assertInventoryInvariant(s.game.inventory);
  }

  // refusal: empty target, zero stock of the selected type -> no mutation at all
  const grass = firstCellOf(s.game.grid, 1);
  digOut(s, grass.x, grass.y);                 // grass stock 1, cell emptied
  s.key('3');                                  // select stone (stock 0)
  const invBefore = { ...s.game.inventory };
  const rawBefore = s.storage.get(STORAGE_KEY);
  const c = center(grass.x, grass.y);
  s.press(c.x, c.y, 2);                        // refused
  assert.equal(s.game.grid[grass.index], 0);   // target cell unchanged
  assert.deepStrictEqual({ ...s.game.inventory }, invBefore);
  assert.equal(s.storage.get(STORAGE_KEY), rawBefore);
  assertInventoryInvariant(s.game.inventory);

  // the stocked type still places; after it hits 0 every swatch greys out
  s.key('1');
  s.press(c.x, c.y, 2);
  assert.equal(s.game.grid[grass.index], 1);
  assert.equal(s.game.inventory[1], 0);
  assertInventoryInvariant(s.game.inventory);
  const opacityFor = (t) => s.swatches.find((b) => b.type === t).style.opacity;
  assert.equal(opacityFor(1), '0.35');
  assert.equal(opacityFor(2), '0.35');
  assert.equal(opacityFor(3), '0.35');
  assert.equal(opacityFor(4), '0.35');
});

test('persist-reload: v2 single-key blob, deep-equal reload, v1 migration, default boot, transient damage', () => {
  const storage = new Map();
  const a = bootGame({ storage });

  // shape the world: destroy stone/grass/wood, crack a second stone to stage 2
  digOut(a, 0, 10);
  digOut(a, 0, 0);
  digOut(a, 0, 18);
  const cracked = center(1, 10);
  a.press(cracked.x, cracked.y); a.release();
  a.press(cracked.x, cracked.y); a.release();
  assert.equal(a.game.damage.get(10 * SIZE + 1), 2);
  assertInventoryInvariant(a.game.inventory);

  // exactly one localStorage key holding one atomic v2 blob without damage
  assert.deepStrictEqual([...storage.keys()], [STORAGE_KEY]);
  const blob = JSON.parse(storage.get(STORAGE_KEY));
  assert.equal(blob.version, 2);
  assert.ok(Array.isArray(blob.cells) && blob.cells.length === SIZE * SIZE);
  assert.deepStrictEqual(blob.inventory, { 1: 1, 2: 0, 3: 1, 4: 1 });
  assert.ok(!('damage' in blob));
  assert.deepStrictEqual(Object.keys(blob).sort(), ['cells', 'inventory', 'version']);

  // fresh boot on the same storage restores cells and inventory deep-equal
  const expectedCells = Array.from(a.game.grid);
  const expectedInventory = { ...a.game.inventory };
  const b = bootGame({ storage });
  assert.deepStrictEqual(Array.from(b.game.grid), expectedCells);
  assert.deepStrictEqual({ ...b.game.inventory }, expectedInventory);
  assert.equal(b.game.damage.size, 0);           // damage does not survive reload
  assert.equal(b.game.grid[10 * SIZE + 1], 3);   // the cracked stone came back intact
  assert.deepStrictEqual(Array.from(b.game.loadGrid()), expectedCells);

  // empty storage boots the default world with all-zero inventory
  const c = bootGame({ storage: new Map() });
  assert.deepStrictEqual(Array.from(c.game.grid), defaultWorld());
  assert.deepStrictEqual({ ...c.game.inventory }, { 1: 0, 2: 0, 3: 0, 4: 0 });

  // legacy v1 blob migrates: cells restored, inventory defaulted to zero
  const v1Storage = new Map([[STORAGE_KEY,
    JSON.stringify({ version: 1, cells: new Array(SIZE * SIZE).fill(1) })]]);
  const d = bootGame({ storage: v1Storage });
  assert.deepStrictEqual(Array.from(d.game.grid), new Array(SIZE * SIZE).fill(1));
  assert.deepStrictEqual({ ...d.game.inventory }, { 1: 0, 2: 0, 3: 0, 4: 0 });

  // v2 blob with an invalid inventory: world survives, stock fails soft to zeros
  const badStorage = new Map([[STORAGE_KEY,
    JSON.stringify({ version: 2, cells: new Array(SIZE * SIZE).fill(2), inventory: { 1: -5, 2: 'x' } })]]);
  const e = bootGame({ storage: badStorage });
  assert.deepStrictEqual(Array.from(e.game.grid), new Array(SIZE * SIZE).fill(2));
  assert.deepStrictEqual({ ...e.game.inventory }, { 1: 0, 2: 0, 3: 0, 4: 0 });

  // garbage blob keeps the whole-save fail-soft fallback
  const junk = new Map([[STORAGE_KEY, 'not-json']]);
  const f = bootGame({ storage: junk });
  assert.deepStrictEqual(Array.from(f.game.grid), defaultWorld());

  // serializeGrid exposes the v2 shape directly
  const parsed = JSON.parse(a.game.serializeGrid(a.game.grid));
  assert.equal(parsed.version, 2);
  assert.deepStrictEqual(Object.keys(parsed).sort(), ['cells', 'inventory', 'version']);
  assert.deepStrictEqual(parsed.cells, expectedCells);
});

---
comet_change: minicraft-html-game-r3
role: technical-design
canonical_spec: openspec
archived-with: 2026-10-28-minicraft-html-game-r3
status: final
---

# Minicraft HTML Game — Technical Design

Bound artifacts: approved open evidence `c105b58a…`; gate-R interview decisions
(7/7 resolved); approved design handoff `c6f389bd…` (D1–D7 below, dependency
order preserved).

## D1 Canvas geometry & page layout

- One `<canvas id="board">` of exactly 20 x 20 cells at 24 px per cell →
  board `width=480 height=480` (CSS pixels; canvas attributes match CSS size,
  no scaling, no devicePixelRatio games).
- Layout: header (title + active-type readout), then the canvas, then a
  palette bar below it: four 28x28 swatch buttons (Grass/Dirt/Stone/Wood)
  rendered as plain `<button>` elements with inline background colors, and a
  `Reset` button at the right end of the palette bar.
- All CSS is a single inline `<style>` block; body centers a fixed-width
  column (width: fit-content).

## D2 Terrain formula (deterministic, no RNG)

Initial terrain is a pure function of row `y` (column-independent layering):

- `y in [0,4)`   → grass (type 1)
- `y in [4,10)`  → dirt  (type 2)
- `y in [10,18)` → stone (type 3)
- `y in [18,20)` → wood  (type 4)

Types: `0` empty, `1` grass `#5aa331`, `2` dirt `#8a5a2b`, `3` stone
`#8c8c8c`, `4` wood `#a07840`. `initialGrid()` builds this 400-cell
`Uint8Array`; the same function serves both first load and Reset, so initial
state and post-reset state are byte-identical by construction.

## D3 Rendering

- Single 2D context (`ctx = canvas.getContext('2d')`).
- `render()` clears the canvas, draws each non-empty cell as a filled rect in
  its type color, adds a per-cell deterministic texture (a 2 px darker inset
  rect at offset derived from `(x*31 + y*17) % 6`, shade `rgba(0,0,0,0.15)`)
  so the four types are visibly distinct at a glance, then strokes a 1 px
  `#00000022` grid and — while the pointer is over the board — a 2 px
  `#ffffffcc` outline on the hovered cell.
- Repaint strategy: event-driven full repaint (`render()` called on any state
  change and on hover-cell change); no rAF loop, no timers.

## D4 Interaction model

- Hit test: `cellFromEvent(e) = { x: floor(offsetX/24), y: floor(offsetY/24) }`,
  guarded to `0..19`.
- Left dig: `pointerdown` with `button === 0` sets `dragging = 'dig'` and digs
  the cell (sets 0); `pointermove` while dragging digs each entered cell;
  `pointerup`/`pointerleave` ends the drag.
- Right place: `pointerdown` with `button === 2` places `selected` into the
  cell only when it is currently `0` (occupied → no-op, dig first).
- `contextmenu` on the canvas: `preventDefault()` always.
- Keyboard: `keydown` `1`–`4` selects type and syncs palette highlight;
  palette buttons select on click. Active type shown in the header readout.
- Every state change (dig/place/select/reset) funnels through
  `setState(fn)` which mutates the grid, persists, and repaints.

## D5 Persistence schema

- Key: `minicraft-grid-v1`; value: `{"version":1,"cells":[…400 ints…]}`
  (JSON array of the `Uint8Array`).
- Write points: after every dig/place edit and on reset (reset removes the
  key entirely, then re-renders from `initialGrid()`).
- Load: on startup, if the key parses with `version === 1` and
  `cells.length === 400`, use it; otherwise start from `initialGrid()`.
  Corrupt values fall back to initial terrain (no exceptions thrown).

## D6 Code structure (single file)

One `<script>` containing a single IIFE with labeled sections, in order:
`CONFIG & TYPES` (constants, colors, terrain table), `STATE` (grid, selected,
hover), `PURE FUNCTIONS` (`initialGrid`, `cellFromEvent`, `loadGrid`,
`serializeGrid` — no DOM access), `RENDERING` (`render`, `renderPalette`),
`INPUT` (event handlers), `PERSISTENCE` (`save`, `load`), `INIT`.
DOM wiring happens only in `INIT` at the bottom; pure functions are testable
by extraction for whitebox verification.

## D7 Load hygiene

Zero external references by construction: no `<script src>`, no `<link>`, no
`fetch`/`XHR`/`EventSource` anywhere, no fonts other than the inherited
system font stack. No `console.log` in the shipped code path; no console
errors on load (guards around `localStorage` access for private-mode
browsers).

## Acceptance mapping (verification ownership: gate V)

- AC1/AC2/AC7 (single file, canvas, persistence) → D1, D6, D7, D5.
- AC3 (grid/terrain) → D1, D2. AC4/AC5 (dig/place) → D4. AC6 (types/UI) → D2
  colors, D3 texture, D4 keys/palette.

Out of design scope: acceptance automation mechanics (owned by verify gate
V) and all proposal non-goals (multiplayer, sound, inventory, 3D, camera).

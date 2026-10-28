---
archived-with: 2026-10-28-minicraft-html-game-r3
status: final
---
# Implementation Plan — minicraft-html-game-r3

<!-- comet-task-authority: openspec/changes/minicraft-html-game-r3/tasks.md -->

Deliverable: `demos/minicraft/index.html` — a single self-contained HTML5 canvas game
(design `8f51fe2b…`, proposal `d743f796…`). Build mode: direct, in the current workspace
(master). Implementation follows design.md D1–D7 exactly; verification ownership belongs
to gate V per the frozen TestPack (14 cases, `.sdd/delivery/gates/t/test-pack.json`).

## T1 — Game shell: canvas, grid model, initial terrain, render <!-- comet-task-ref:t1-shell -->

Create `demos/minicraft/index.html` with:

- Inline `<style>` (fixed-width column, canvas 480x480 CSS px, no scaling) and inline
  `<script>` IIFE in strict mode; zero external references (D1, D7).
- `CONFIG & TYPES`: 20x20 grid, 24px cells, type table `{1:#5aa331, 2:#8a5a2b, 3:#8c8c8c, 4:#a07840}` (D2).
- `initialGrid()` pure function per D2 bands: y[0,4) grass, y[4,10) dirt, y[10,18) stone,
  y[18,20) wood — no RNG; same function serves first load and Reset (byte-identical).
- `RENDERING.render()`: full clear, per-cell fill + deterministic 2px inset texture
  offset `(x*31+y*17)%6` shade rgba(0,0,0,0.15), 1px `#00000022` grid stroke, hover
  outline `#ffffffcc` while pointer is over the board; event-driven repaint only (D3).
- Header (title + active-type readout), canvas, palette bar below: four 28x28 swatch
  buttons + Reset button (D1).

Acceptance hooks: TestPack TC-01 (initial bands), TC-10 (console/network clean), TC-11
(single-file static scan), TC-12 (determinism).

## T2 — Input: dig, place, contextmenu suppression <!-- comet-task-ref:t2-input -->

- `cellFromEvent(e)` = floor(offset/24) guarded to 0..19 (D4).
- `pointerdown` button 0 → dragging='dig' + dig cell; `pointermove` while dragging digs
  entered cells; `pointerup`/`pointerleave` ends drag; button 2 places only into empty
  cells (occupied → no-op); `contextmenu` preventDefault always (D4, D5 semantics).
- All mutations funnel through `setState(fn)` (mutate, persist, repaint) (D4).

Acceptance hooks: TC-02, TC-03, TC-04, TC-05.

## T3 — Palette: types, selection UI, hotkeys <!-- comet-task-ref:t3-palette -->

- Keys `1`–`4` select types and sync palette highlight + header readout; palette clicks
  select; selected swatch visually highlighted (D4).

Acceptance hooks: TC-06, TC-14.

## T4 — Persistence: localStorage save/restore and reset <!-- comet-task-ref:t4-persistence -->

- Key `minicraft-grid-v1`, value `{"version":1,"cells":[…400 ints…]}` (D5; serialize the
  Uint8Array explicitly via Array.from — never JSON.stringify the typed array directly).
- Save after every dig/place edit via setState; Reset removes the key entirely, then
  re-renders from initialGrid() (D5).
- Load guard: accept only when parsed version===1, cells is an Array of length 400 and
  every element is an integer 0..4; otherwise fall back to initialGrid() silently
  (whole-save fail-soft; no console output; localStorage access wrapped for private
  mode) (D5, D7; gate-A consensus hardening TC-09).

Acceptance hooks: TC-07, TC-08, TC-09.

## T5 — Verification prep <!-- comet-task-ref:t5-verify -->

- After T1–T4: run `bash scripts/check.sh` (repo regression stays green with the new
  file present), confirm the file opens via `file://` in Chromium with a clean console,
  and hand off to gate V with the frozen TestPack (before/after screenshots and
  localStorage readbacks are produced by the independent verifier, not the builder).

Acceptance hooks: TC-13 and the full TestPack handoff to gate V.

## Execution order and dependencies

T1 → T2 → T3 → T4 are sequential (input/palette/persistence all build on the shell and
setState funnel); T5 closes the build. No parallel tracks: one file, one builder, direct
mode. Out of scope: everything in proposal non-goals; acceptance automation itself
(gate V owns execution of the TestPack).

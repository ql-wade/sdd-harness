# Tasks — minicraft-html-game-r29

- [ ] T1 hardness + crack overlay for hard blocks <!-- comet-task:T1 -->
- [ ] T2 inventory accrual on dig, consumption on place, refuse-at-zero <!-- comet-task:T2 -->
- [ ] T3 canvas HUD + persistence of inventory across reload <!-- comet-task:T3 -->

### Task T1: hardness + crack overlay for hard blocks

**Dependencies:** none

Extend the block registry with hardness (grass/dirt=1, stone/wood=3). Digs
accumulate per-cell damage on cell-entry edges only; a crack overlay drawn as
a pure function of (x, y, stage) shows hits-1 visible stages; the hit that
reaches hardness removes the block and clears the damage entry.

### Task T2: inventory accrual on dig, consumption on place, refuse-at-zero

**Dependencies:** T1

Per-type inventory counters increment when a block is destroyed; placement
decrements and is refused at zero before any mutation; the save blob schema
moves to version 2 ({version, cells, inventory}) with a v1 migration that
defaults inventory to zero; inventory validation is non-negative integers
over keys 1..4.

### Task T3: canvas HUD + persistence of inventory across reload

**Dependencies:** T1, T2

Right-top canvas HUD panel (per-type counts) drawn in the render pipeline
after cracks; palette swatches grey at zero from the same setState edit path;
reload restores world + inventory; damage map is transient and resets on
reload.

# Comet Design Handoff

- Change: minicraft-html-game-r34
- Phase: design
- Mode: compact
- Context hash: a6a2e30cf5d6d52780482e8ff02f07b1dcc99aa9dc018616e59926fcfea2785f

Generated-by: comet-handoff.sh
Task hash policy: task-content-v1. Read tasks.md for live completion; excerpts are design-time context.

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/minicraft-html-game-r34/proposal.md

- Source: openspec/changes/minicraft-html-game-r34/proposal.md
- Lines: 1-30
- SHA256: 38e5b5d98604f2311f9f0188eeccdcd3fb15bb08f3761713ed53e1d0eb89a2c8

```md
# minicraft-html-game-r4

## Why

Business-VERIFY vehicle for the sdd-managed-delivery v10 application: a
bounded, independently verifiable enhancement to the delivered minicraft
game (demos/minicraft/index.html), driven through the full six managed
gates (R/A/T/P/V/Kp) with real human confirmations and real agent work.

## What Changes

Enhance demos/minicraft/index.html (single file, zero dependencies):

1. **Block health & cracking**: digging a hard block (stone/wood) takes 3
   clicks; a crack overlay shows progress; soft blocks (grass/dirt/leaf)
   stay 1-click.
2. **Inventory HUD**: a counter per block type of mined-but-not-placed
   blocks; placing consumes, digging accrues; HUD renders on canvas.

## Non-goals

No new assets, no audio, no multiplayer, no framework.

## Acceptance (whitebox-verifiable in browser)

- Stone block: clicks 1-2 show crack stages, click 3 removes it and +1 stone
  inventory; HUD updates.
- Grass block: single click removes, +1 grass inventory.
- Placing from palette decrements that type's inventory and refuses at 0.
- Reload persists both the world and the inventory (localStorage).

```

## openspec/changes/minicraft-html-game-r34/design.md

- Source: openspec/changes/minicraft-html-game-r34/design.md
- Lines: 1-20
- SHA256: 5448fd256768709819414f8a62ef4fc5c2bee17bc8d1bf10ee1c7c7aee923a5d

```md
---
comet_change: minicraft-html-game-r34
role: technical-design
canonical_spec: openspec
archived-with: 2026-10-31-minicraft-html-game-r34
status: final
---

# Design — minicraft-html-game-r34

Single-file constraint kept: all logic inside demos/minicraft/index.html.

- `BLOCKS` registry gains `hardness` (grass/dirt/leaf=1, stone/wood=3).
- Per-cell damage map `damage: Map<cellKey, hits>` with a 3-stage crack
  overlay drawn from a procedural pattern (no assets).
- `inventory: Record<blockType, number>` persisted in the existing
  localStorage blob (world + inventory together, one key, atomic writes).
- HUD: right-top canvas-drawn panel listing per-type counts; palette
  entries grey out at 0 and placement is refused in that case.
- No change to the 20x20 grid, controls, or rendering pipeline.

```

## openspec/changes/minicraft-html-game-r34/tasks.md

- Source: openspec/changes/minicraft-html-game-r34/tasks.md
- Lines: 1-33
- SHA256: 9e559fe81d2634d3ab57895a0f6f21f620a53c5c417560faf135f73c9347b52d

```md
# Tasks — minicraft-html-game-r34

- [x] T1 hardness + crack overlay for hard blocks <!-- comet-task:T1 -->
- [x] T2 inventory accrual on dig, consumption on place, refuse-at-zero <!-- comet-task:T2 -->
- [x] T3 canvas HUD + persistence of inventory across reload <!-- comet-task:T3 -->

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

```

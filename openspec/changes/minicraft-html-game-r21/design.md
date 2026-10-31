---
comet_change: minicraft-html-game-r21
role: technical-design
canonical_spec: openspec
---

# Design — minicraft-html-game-r21

Single-file constraint kept: all logic inside demos/minicraft/index.html.

- `BLOCKS` registry gains `hardness` (grass/dirt/leaf=1, stone/wood=3).
- Per-cell damage map `damage: Map<cellKey, hits>` with a 3-stage crack
  overlay drawn from a procedural pattern (no assets).
- `inventory: Record<blockType, number>` persisted in the existing
  localStorage blob (world + inventory together, one key, atomic writes).
- HUD: right-top canvas-drawn panel listing per-type counts; palette
  entries grey out at 0 and placement is refused in that case.
- No change to the 20x20 grid, controls, or rendering pipeline.

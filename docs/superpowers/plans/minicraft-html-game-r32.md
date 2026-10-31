<!-- comet-task-authority: openspec/changes/minicraft-html-game-r32/tasks.md -->

# Build Plan — minicraft-html-game-r32

Delivery plan for the minicraft single-file game enhancement. Task authority
stays with tasks.md; this plan maps each task to its execution approach and
the test contract checks that will judge it.

## Task mapping

<!-- comet-task-ref:T1 -->
**T1 — hardness + crack overlay for hard blocks.** Extend the TYPES registry
with hardness (grass/dirt=1, stone/wood=3); add a per-cell transient damage
map (not persisted); hits accumulate on cell-entry edges only (pointerdown
counts, same-cell pointermove does not); crack overlay drawn as a pure
function of (x, y, stage) with visible stages = hits - 1, drawn after cell
fill and before grid lines. Refuses nothing; pure dig-path change.
Checks: chk-hardblock-crack-3hit.

<!-- comet-task-ref:T2 -->
**T2 — inventory accrual, consumption, refuse-at-zero.** Inventory counters
per block type (mined-not-placed) increment when a block is destroyed and
decrement on placement; placement with a zero counter is refused before any
state mutation (single mutate path keeps world + inventory atomic via the
single localStorage blob). Save schema version bumps to 2; loader accepts v1
(inventory defaults 0) and v2; inventory validation is non-negative integers
over keys 1..4, fail-soft consistent with the existing whole-blob strategy.
Checks: chk-invplace-refuse-zero (with chk-softblock-single-click covering
accrual on dig).

<!-- comet-task-ref:T3 -->
**T3 — canvas HUD + persistence.** Right-top canvas HUD panel (per-type
counts) drawn in the render pipeline after crack overlay; palette swatches
grey at zero via a DOM sync driven from the same setState edit path; blob
gains inventory; reload restores world + inventory; damage map resets on
reload (transient). Checks: chk-persist-world-inventory.

## Execution order

T1 -> T2 -> T3 (T2 and T3 share the save-schema change; T3 lands the HUD that
T2's counters surface). One logic test file (tests/minicraft.logic.test.mjs)
grows with each task, subtests prefixed hardblock:/softblock:/invplace:/persist:
per the test contract; the vm-based IIFE harness with DOM/canvas/localStorage
stubs lands with T1.

## Acceptance references

- openspec/changes/minicraft-html-game-r32/tests/test-contract.json
- openspec/changes/minicraft-html-game-r32/design.md

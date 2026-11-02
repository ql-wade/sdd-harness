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

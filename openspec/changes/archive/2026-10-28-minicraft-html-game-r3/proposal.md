## Why

First real business deliverable through the sdd-managed-delivery pipeline
(six managed gates R/A/T/P/V/Kp): a small, independently verifiable
Minecraft-style HTML game. The deliverable itself is a zero-dependency,
single-file game that opens directly in a browser.

## What Changes

Add a new self-contained HTML5 mini-game (canvas-rendered) meeting these
acceptance requirements:

1. **Single-file delivery**: the whole game is one standalone `index.html`
   with no external JS/CSS/asset dependencies; it runs via `file://`.
2. **Canvas rendering**: all graphics are drawn on a `<canvas>` 2D context;
   no DOM blocks.
3. **20x20 block grid**: the visible world is a 20-column by 20-row grid with
   non-empty initial terrain.
4. **Left-click dig**: left-click (or drag) on a block removes it.
5. **Right-click place**: right-click places the currently selected block
   into an empty cell; the browser context menu must be suppressed.
6. **At least 3 block types**: multiple placeable types (grass, dirt, stone,
   wood) with visible distinction (color/texture) and a selection UI
   (palette plus hotkeys 1-4).
7. **Persistence (lightweight)**: edits save to `localStorage` and survive
   reload; a reset entry point regenerates the initial terrain (needed for
   independent verification and negative checks).

Out of scope: multiplayer, sound, inventory system, 3D, camera/scrolling
beyond the 20x20 grid.

Target path (finalize in Design): `demos/minicraft/index.html`.

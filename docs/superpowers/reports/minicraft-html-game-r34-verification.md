# Verification Report — minicraft-html-game-r34

- date: 2026-10-31
- candidate: demos/minicraft/index.html @ 7f1a2c9 (334 lines) + tests/minicraft.logic.test.mjs (451 lines)
- contract: openspec/changes/minicraft-html-game-r34/tests/test-contract.json (4 cases)
- environment: Chrome (DevTools MCP, isolated context), file:// origin, node v24.15.0
- verifier: independent whitebox session (this run), separate from the build.execute authoring session

## Machine check

Command (frozen at Run start, `.comet/check-policy.json`, scope build, tier full):

    node --test --test-reporter=tap tests/minicraft.logic.test.mjs

Result: exit 0 — 4/4 pass, 0 fail, 0 skipped (99.6 ms). Same command passed inside
the managed full.build.check execution (receipt `r34 build.check receipt (recorded via full.build.check evidence, exitCode 0, checkEpoch 2)`,
exitCode 0, checkEpoch 2, contentHash 558c922fac6e…).

## Browser journey (real input events → terminal readbacks)

Driving: synthesized PointerEvents on #board with explicit offsetX/offsetY (Chrome
synthetic events do not map client→target box); readbacks from localStorage (the
persistence system itself) and canvas pixel probes; palette state via computed styles.
Terrain is deterministic: rows 0–3 grass, 4–9 dirt, 10–17 stone, 18–19 wood.

| # | Case | Action | Expected (contract) | Observed | Evidence |
|---|------|--------|--------------------|----------|----------|
| 1 | hard-block-3hits | stone (0,10): 3 left-clicks | hits 1–2: intact + crack overlay, transient (no save); hit 3: removed, Stone +1 | hit 1: save absent, 35 dark crack px; hit 2: save absent, 38 px (stage 2 > stage 1); hit 3: `cells[200]=0`, `inventory["3"]=1`, v2 save written | probe log |
| 2 | soft-block-single | grass (0,0): 1 left-click | removed in one hit, Grass +1 | `cells[0]=0`, `inventory["1"]=1` | probe log |
| 3 | inventory-place | stone selected, right-click hole (0,10) | placed, Stone −1, hole filled | `cells[200]=3`, `inventory["3"]=0`, stone swatch opacity 1→0.35 | `openspec/changes/minicraft-html-game-r34/verify-evidence/01-place-refuse-zero.png` |
| 4 | inventory-place-zero | stone stock 0, right-click grass hole (0,0) | refused before any mutation | save byte-identical after refused click (`unchanged=true`), hole stays empty | probe log + screenshot above |
| 5 | persist-reload | reload | world + inventory restored; damage map transient | v2 blob reloaded: `cells[0]=0`, `cells[200]=3`, inventory `{1:1}`, greying restored, stone band intact, hole persists | `openspec/changes/minicraft-html-game-r34/verify-evidence/02-reload-persisted.png` |
| 6 | HUD | all states above | right-top canvas panel, per-type counts, greying at 0 | rendered in the screenshot; counts track inventory exactly | screenshot above |

Console: no errors (one benign Canvas2D `willReadFrequently` hint caused by the
verifier's own getImageData probes, not by the game).

## Verdict

All four contract cases verified in a real browser with authoritative readbacks;
no product or test file was modified during verification. No gaps outstanding.

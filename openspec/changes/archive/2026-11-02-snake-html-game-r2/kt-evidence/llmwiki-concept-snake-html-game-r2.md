# snake-html-game-r2

> Single-file HTML5 canvas snake game delivered end-to-end through the sdd-managed-delivery
> six-gate composition (R/A/T/P/V/Kp + archive). Delivered 2026-11-02 on branch
> verify/r-gate-verdict, delivery ref 8c7a6ab, run COMPLETED at rev 145.

## What shipped

- `demos/snake/index.html` — 24×24 grid (20px cells), arrow keys write pendingDir with
  exact 180° reversals ignored, pure step function (check-before-commit: a fatal move
  freezes with the head on its last in-bounds cell), food +10 with free-cell respawn,
  R restart, localStorage `snake-high-score-v1` high score (max of stored/current).
- `tests/snake-html-game-r2.logic.test.mjs` — five contract tests (node:vm sandbox +
  DOM/canvas/localStorage stubs + `__test {step,turn,reset,state}` hook; step = one full
  tick of stepGame+render so HUD fillText assertions see post-step output).
- Verification trio: zh-CN verification report (docs/superpowers/reports/),
  machine results json, three real-browser screenshots (initial / steered / game over).

## Verification summary

- All five contract checks pass individually and as a suite (5/5); minicraft regression 4/4.
- Managed build+verify checks executed by the comet-classic-check executor, exitCode 0.
- V gate: five per-case whitebox receipts, each backed by a real verbatim contract-command
  execution in the worker transcript + independent reviewer acceptance.
- NOT-EXERCISED (honest boundary): real-browser setInterval timing; pixel-level rendering
  (canvas asserted via recorded fillText/fillRect call sequences; screenshots partially
  cover the render pipeline).

## Reusable knowledge

1. Cross-vm assertions: deepStrictEqual is prototype-sensitive across realms — copy vm
   objects to the host realm (JSON round-trip) before structural comparison.
2. `check-policy.json` v2: the check input scan refuses symlinks (CLAUDE.md → AGENTS.md);
   declare each test command with a `files` list (e.g. demos/**, tests/**).
3. tasks.md dependencies must use canonical `**Dependencies:**` bold markers; Chinese prose
   parses as no-dependencies and the P gate plan_source readback refuses the mismatch.
4. Never hand-claim build/verify check actions: evidence validation hard-requires
   `claim.executorId === 'comet-classic-check'`; use runtime dispatch execute instead.
5. The R gate can genuinely block: round 1 caught a contract/test-path contradiction and a
   missing 180° acceptance before any implementation existed — fix, then re-confirm with
   fresh author/reviewer sessions (runtime revise-requirements loop re-walks the open chain).
6. The archive executor stamps archived artifacts (`status: final`, `archived-with:`) —
   including out-of-change-dir files like docs/superpowers/plans/<change>.md; the delivery
   commit must contain the stamped bytes, and the delivery range must stay free of
   unapproved paths (gitignored convenience files like verification results.json must stay
   out of the delivery commits).

Source: openspec/changes/archive/2026-11-02-snake-html-game-r2/ (closeout.md, proposal,
design, contract, task-dag, verify-evidence screenshots).

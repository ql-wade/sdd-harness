# P2_4 worker report — round 3 (upstream blocker rework, revision 2026-10-26-comet-050-adoption-v1)

Task: P2_4 round-3 — fix the three blockers surfaced by the P3_2 first real
R→V pilot (evidence `pilot-journey/evidence/comet-050-run/`, frozen
`run-state/honest-blockers.md`). Scope honored: P2_4 Owns
(`integrations/comet/application/**`, `test/delivery-cases/2_4.mjs`) + the
controller-permitted single exception `lib/adapters/{comet.js,comet-executor.js}`
(P1_3 appendix, both accepted non-concurrent) + this report directory. No commit.

## 0. Record (all three mechanisms verified from three sides)

For every blocker the mechanism was re-derived from the pristine 0.5.0 source,
the frozen P3_2 evidence, and (read-only) the still-live pilot world
`/private/tmp/p32-pilot-1793038407-25674` (r3 parked at
`classic.extension.build-plan-unique` running, checkEpoch 5, phase build —
confirmed by a read-only inspect):

- **B-①** isolation deadlock: live start request carried `"isolation": null`
  (frozen `composition-start-request.json`); pristine
  `buildConfigurationValidator` refuses any configure outcome while
  `!state.isolation`; the configure outputSchema forbids null; the confirm
  transition throws on null and refuses failed configures; the classic
  factory workflow carries NO definition-side initialState and the runtime
  forbids both faces specifying one — so the managed start REQUEST is the
  only enforceable face. Null isolation is schema-LEGAL at start (the
  deadlock is silent).
- **B-②** submissionId collision: `recordEvidence` performs NO submissionId
  uniqueness check (runtime-service L1395-1447); the composition transition
  resolves the extension activation source by FIRST match on
  `receipt.submissionId` (classic-application.ts L567) — a reused id binds
  the stale epoch-0 wait (pilot r2: sourceCurrent false forever).
- **B-③** write-once × revise conflict: the official compiler accepts only
  STATIC artifactRef strings (planSchema; upstream path checks) — literal
  epoch-qualified paths (`gates/{g}/{epoch}/…`) are INEXPRESSIBLE through
  the official compile seam; upstream re-hashes the static ref against every
  recorded pass on every later re-validation and at archive. A same-gate
  re-run writing diverging bytes (epoch/random fields) permanently orphans
  the earlier pass hash (pilot: 536b5b49…→60c9ac68…).

## 1. RED (evidence/red-1-blocker-negatives.txt)

`test/delivery-cases/2_4.mjs` gained three blocker tests; first run RED
3 fail / 21 pass, failing for the right reasons: B-① `start.initialState`
undefined; B-② `classicCompositionRecordEvidenceRequest` not a function;
B-③ R accepts a non-canonical bundle binding.

## 2. Implement (three blockers, smallest faces)

- **B-①** `lib/adapters/comet.js`: `classicCompositionStartRequest` now
  CONSTRUCTS the managed canonical initialState (isolation **'current'**,
  the live-proven pilot field set; exported as
  `MANAGED_COMPOSITION_INITIAL_STATE`). Caller-supplied `initialState` is
  refused (`START_STATE_CONSTRUCTED`); only `baseRef`/`createdAt` are
  refinable. `lib/adapters/comet-executor.js` `buildStartRequest` passes
  through unchanged (the constructor is the enforcement point). The
  composition package declares the same contract verbatim
  (`composition.json startContract`) — cross-pinned field-for-field by 2_4
  against the declaration AND the pristine full-profile stateSchema.
- **B-②** two layers:
  - adapter face (`comet.js`): NEW `classicCompositionRecordEvidenceRequest`
    derives the submissionId itself — `${change}:${kind}:epoch-${checkEpoch}:${sha256(ref\ncontentHash)[:16]}`
    — epoch-qualified and content-derived; caller-supplied ids refused
    (`SUBMISSION_ID_DERIVED`), missing checkEpoch refused
    (`CHECK_EPOCH_REQUIRED`). Exposed on the executor as `buildEvidenceRequest`.
  - composition face (`bindings.mjs`, P2_4 Owns): every packaged gate
    validator gained an activation-binding guard — refuses a claimed pass
    whose activation binds (a) a submissionId shared by >1 evidence waits
    (the exact pilot defect), (b) a wait that is not the newest resolved
    wait of its checkpoint (stale/superseded binding), (c) a cross-epoch
    activation at LIVE record time only (checkEpoch advances on EVERY phase
    transition — `applyClassicTransition` — so already-recorded passes are
    legitimately re-validated at later epochs; refusing there broke the first
    live attempt and was corrected to `status !== 'succeeded'`).
- **B-③** content-address stability (`bindings.mjs` + declarations): the
  absolute canonical-format variant was implemented first, then REPLACED by
  a relative rule after it broke the out-of-boundary producers
  (P2_5 `buildGateReceiptBundle`, P1_5 synthetic fixtures): within one Run,
  IDENTICAL judged evidence (gate/inputs/receipts/policy, key-order
  insensitive) must bind IDENTICAL `artifactHashes[ref]` bytes — a
  same-evidence diverging rewrite is refused fail-closed AT RECORD TIME with
  the precise reason (the pilot class: the orphaning rewrite never records).
  Genuinely changed evidence binds new bytes legitimately (revise loops
  always supersede earlier passes via the re-run full.open). The canonical
  byte-stable serialization (recursively key-sorted JSON, 2-space indent,
  trailing newline) is DECLARED as the managed write protocol
  (`composition.json gateArtifactContract` + all six `extensions/*.json`
  `contentAddressing` blocks, schema extended) — declared protocol, not a
  validator-imposed format: bundle format stays producer-owned, the
  STABILITY of the binding is the composition's contract. Judgment
  semantics unchanged (evaluate delegation stays the sole verdict source;
  refused judgments keep their evaluation reason, so 3_2's Kp probe and the
  fail-closed suite keep their exact reasons).

Recompiled through the official compiler
(`internal/build-application.mjs`, pinned node v24.15.0): **compositionHash
df916df6784d1ac809693babc9f59908eab4575a10c02e3bdddf0319ba1d8949,
contentHash ba88b84dc5c1bff2984509667cb20252abcf0be6ade3dc28fa0d5efceccbbb66,
workflow comet-classic-full@1 c6ace184…** — two consecutive rebuilds
byte-identical (evidence/rebuild-determinism.txt).

## 3. Verify (evidence/green-1-regression-matrix.txt)

| suite | result |
| --- | --- |
| test/delivery-cases/2_4.mjs (incl. 3 new blocker tests) | **24/24 pass** |
| 1_3 / 1_5 / 3_1 / 3_2 / 2_1 / 2_2 / 2_3 / 2_5 | 10/10, 4/4, 25/25, 13/13, 7/7, 8/8, 6/6, 11/11 — all green |
| comet-execution-binding / architecture-review-adapter | 21/21, 59/59 green |
| delivery-cli / delivery-gate / delivery-evidence / knowledge-closeout | 25/25, 27/27, 25/25, 20/20 green |
| test/classic-integration.test.js | **32/33 — single failure #19**: the frozen P1_5 probe `classic-integration-probes/assembly-probes.json` `environment.package` pins the pre-r3 build (compositionHash dbcb0eee…, contentHash f7677825…); the test compares it to the current compile manifest. Out-of-boundary (P1_5 Owns both the probe file and the test) — single-listed re-pin item: re-run/re-freeze the probe at equal strength against build df916df6…/ba88b84d…. |
| pre-existing failures (NOT mine; identical with my changes stashed) | 1_6 (2), 3_3 (3), 3_4 (5) — concurrent workers' tree state |

## 4. Minimal live verification (evidence/live-world/, one-shot world)

World `/private/tmp/p24r3-1793050150-33414`: fresh git project, new package
installed through the official installer (preview → confirmationHash →
install, contentHash ba88b84d…), every step a REAL `comet runtime dispatch`;
start/evidence requests built LIVE by the repo adapter constructors; gate
bundles written by the declared canonical write protocol (real
admitEvidence + evaluate through the world's lib/delivery copy). Driver
`drive.mjs` + builder `gate-builder.mjs` frozen in the evidence directory.

- **B-①**: null-isolation start SUCCEEDS schema-legally (the deadlock door
  is silent — negative micro-leg; the unpassable-configure side is the
  frozen P3_2 Run#1 + the pristine three-sided proof pinned in 2_4). The
  adapter-built start request starts the run `isolation current` and the
  driver passes **full.build.configure** (OUTCOME accepted, confirm
  approved): `configure PASSED at epoch 0: phase=build isolation=current
  buildMode=executing-plans tddMode=tdd next=full.build.plan` — the pilot's
  permanent deadlock is cleared. (leg-b1-*.json)
- **B-②**: after a real `revise-requirements` dispatch, the P re-arm binds
  the FRESH epoch-qualified id `p24r3-live:classic-build-plan:epoch-1:5629feef3e2ecda0`
  (sequence 38, distinct from epoch-0's sequence 17) and the pass records
  (positive). Negative: re-recording the new wait with the REUSED epoch-1 id
  is ACCEPTED by the runtime (no uniqueness check — the pilot defect
  reproduced live), the transition binds the STALE wait, and the packaged
  validator REFUSES the pass: "colliding submissionId … shared by 2 evidence
  waits" — the run parks honestly at the refused re-arm, never faked
  (leg-b2-*.json, final-run-state.json: running / P extension running).
- **B-③**: the same-evidence diverging rewrite (epoch field embedded → hash
  e913406d…) is REFUSED at record time: "identical judged evidence is bound
  to diverging … bytes (earlier pass 352b9c91… vs this pass e913406d…)"
  (negative, by design, with guidance). The byte-stable canonical rewrite of
  the SAME evidence is ACCEPTED and the hash is IDENTICAL to round-1
  (352b9c91f955c4c9) — the run advances past the re-arm; no permanent
  mismatch, no orphaned pass (leg-b3-*.json; final on-disk bundle sha
  352b9c91… == round-1 recorded hash).

## 5. Changed files (absolute paths)

Owns: `integrations/comet/application/{composition.json, bindings.mjs,
extensions/*.json ×6, extensions/schema.json, internal/compile-manifest.json,
package/** (official compiler output)}`, `test/delivery-cases/2_4.mjs`.
Exception (single-listed, P1_3 appendix): `lib/adapters/comet.js`,
`lib/adapters/comet-executor.js`. Report: this directory.

## 6. UNVERIFIED / handoff

- classic-integration #19 probe re-pin (P1_5 wave) — see §3.
- The full Kp→archive→Kt tail on a fixed package (the live run here parks at
  the B-② negative terminal by design; a clean full-tail journey is VERIFY).
- `classicCompositionRecordEvidenceRequest` pins the record-evidence face;
  the executor exposes `buildEvidenceRequest` but no repo consumer drives it
  yet beyond this live world and 2_4 — real consumers land with the next
  driver wave.
- Live world is one-shot under /private/tmp (kept for read-only inspection;
  discard freely).

# P3_4 worker report — 原生OpenSpec唯一归档适配 (comet-050)

Revision: 2026-10-26-comet-050-adoption-v1. Node v24.15.0
(~/.nvm/versions/node/v24.15.0/bin/node). Supply: pinned Comet 0.5.0 (upstream
aeb1a6598034e28ce46b8422d4dbd8785e607bd7 + exactly the 0005 Kt closeout patch,
build fingerprint de39629a80fb32f16f3fa12515523988d775f957a62e16941542438c3b61908a)
plus the pinned openspec 1.11.0 at .sdd/tools/openspec-1.11.0.

## Scope actually changed (Owns files only)

- `lib/adapters/spec.js`
- `test/spec-closeout.test.js`
- `test/delivery-cases/3_4.mjs`
- `worker-reports/P3_4-comet-050/` (this report)

No commit made; no touches to integrations/comet/application/package or the
comet.js adapter family (P2_4-R3 parallel).

## Old-candidate disposition (from worker-reports/Root-handoff-20261026)

The two 0.4.5-era candidate diffs were on the tree at RED.

- REUSED (provenance noted in code comments): the same-Run context semantics —
  fixed location/stat identity closure, synchronous assertCurrent recheck at
  the native boundary, native runId equality, and the before-Native refusal
  family (missing/foreign/ambiguous/linked locations). Re-targeted from the
  retired `.comet/run-state.json` change-dir read to the 0.5.0 dual-name
  change state file (comet-state.yaml / .comet.yaml, both-present conflict,
  symlink refusal — upstream classic-state-file.ts) plus the pinned build's
  `ensureClassicRuntimeRun` (dist module). Source commits: ab90cc2 + 74607cc.
- DISCARDED: `ensureClassicRuntimeRun`-optional binding to the retired 0.4.5
  comet-runtime.mjs (c90af44a/6da90e89) sha-pinned import in the test; the
  `P1_3_ACCEPTED_ARTIFACT_ROOT` indirection; all 0002-topology machinery in
  3_4.mjs (installManagedDeliveryHost, dispatch-gate gates R/A/T/P/V/Kp/Kt,
  archive-reopen 0.4.5 transition flow, delivery command, observer/IPC host
  wiring).

## Implementation summary (lib/adapters/spec.js)

1. openspec CLI as the ONLY archive writer, one seam: all component-path
   entries (rehearseArchive / closeoutSpecs / recoverCloseout) now resolve the
   CLI through `resolveOpenspecCli()` = explicit arg > `process.env.COMET_OPENSPEC`
   > 'openspec' — exactly where Native resolves it (classic-openspec-command.ts).
   The managed path never spawns the openspec CLI itself; it dispatches ONE
   native `comet archive` (which invokes `openspec archive --yes` under
   COMET_OPENSPEC).
2. 0.5.0 read-back contract: change discovery across both Classic artifact
   layouts (legacy `<root>/openspec` and docs `<root>/docs/openspec`), dual-name
   state file resolution with STATE_FILE_CONFLICT on both-present, minimal flat
   projection (change_id/run_id/phase/archived) with the upstream invariant
   archived⇒phase=archive enforced; active-directory-without-state ⇒
   MANAGED_RUNTIME_REQUIRED (not silently missing); native change-name rule
   (leading letter kebab-case) aligned.
3. Archive-conflict reconciliation: location ambiguity (active+archive, two
   archives, dual roots) ⇒ AMBIGUOUS_ARCHIVE; a today-named archive target
   directory (with or without state) alongside an active change ⇒
   AMBIGUOUS_ARCHIVE (mirrors native's before-move refusal in classic-archive.ts);
   an already-archived Run ⇒ closeout returns the reconciled projection with
   ZERO native dispatch (`reconciled:'already-archived'`, `native:null`) — no
   second archive/sync ever. Native's own re-archive idempotency was verified
   live (re-archive exit 0, 6/6 steps, still exactly one archive dir) but is
   not relied upon.
4. Kp-missing rejection forwarding: the managed adapter performs no Kp
   adjudication (Kp is the P2_4 composition extension at
   full.verify.check.evidence, re-verified by the archive-time validateOutcome);
   it forwards the native refusal verbatim — ok:false with the native exit code
   and output, active position untouched, same Run preserved — and never
   retries or masks. The component-only path keeps its local
   KNOWLEDGE_CLOSEOUT_REQUIRED precondition.
5. Additive layout parameters (defaults preserve the exported component
   contract): computeTargetSummary/verifyScenarioPreservation take `openspecDir`;
   readBackMainSpecs takes `specsDir`.

## Test rewrite summary

- `test/spec-closeout.test.js`: all component-path oracles kept byte-equal in
  intent; managed fixtures rebuilt on the dual-name state file; new managed
  cases for dual-name conflict, archived-invariant refusal, already-archived
  reconciliation with zero native calls, verbatim native-refusal forwarding,
  Run-substitution refusal, scenario-drop/stale-inspection refusals; the three
  same-Run context tests re-bound to the pinned 0.5.0 build (live
  runClassicCli + ensureClassicRuntimeRun, real `state init`, real Run).
- `test/delivery-cases/3_4.mjs`: component family kept; the managed family
  rebuilt on a REAL 0.5.0 Classic Run driven through the actual public surface
  (state init → open-complete → design set/complete-design(auto-transition) →
  build decisions → tasks --assign-ids/task-complete → plan authority mapping →
  check run build → build-complete → verification_report → check run verify →
  verify-pass → archive-confirm → comet archive). Four scenarios: archive
  (refusal forwarding + same-Run archive + repeated-closeout reconciliation +
  recover), drift (stale-digest refusal on main- and change-side drift; fresh
  inspection required), restart (real SIGKILLed child writer after the real
  commit; parent reconciles without a second archive), premove (today-named
  target collision refused before native; recovery then closeout).

## GREEN (pinned node v24.15.0)

- `node --test test/spec-closeout.test.js` → exit 0, tests 45 / pass 45 / fail 0
  (was 39/39 against the retired 0.4.5 build at RED — the suite now pins the
  current supply).
- `node --test test/delivery-cases/3_4.mjs` → exit 0, tests 9 / pass 9 / fail 0
  (RED was 5 pass / 4 fail with `native.installManagedDeliveryHost is not a
  function`). The four --spec-mechanism children each ran live against the
  pinned build (proof JSON lines in green-3_4.log; command audits under
  .local/P3_4-comet-050/case-audit/).
- Adjacent `node --test test/delivery-cases/3_1.mjs` → exit 0, 25/25.
- Adjacent `test/comet-flow-acceptance.test.js` → 46/47. The single failure
  ("P31 root cwd whitespace collisions…", live probe sha mismatch in the
  P3_1-owned delivery-journey runner) reproduces IDENTICALLY with my three
  files stashed (adjacent-comet-flow-baseline.log) — pre-existing, not caused
  or touched by P3_4.
- Adjacent `3_2/3_3/2_4` → 32/45 both with and without my files stashed
  (13 pre-existing failures on the retired 0.4.5 journey face awaiting their
  own comet-050 rework; none import lib/adapters/spec.js).

## UNVERIFIED / out of scope

- The real composition-wired Kp refusal (P2_4 extension through the
  application package): the plain 0.5.0 CLI face has nothing Kp-shaped to
  refuse, so the forwarding channel is proven with the native
  archive-confirmation refusal instead. The live Kp-gated archive journey
  belongs to P2_4-R3 integration / VERIFY.
- The post-archive Kt journey (same-Run resume, unknown-result queries,
  repeated hook/callback) belongs to P4_6; 0005's knowledgeCloseoutBlocked
  predicate is separately pinned by 2_4. This task only proves the adapter
  reports the archived Run honestly (phase archive, not overall completion)
  and never re-archives.
- Contract checks V_A11/V_B08 full journeys (execution_owner VERIFY,
  current_status NOT_VERIFIED_ON_COMMAND_FIRST) are NOT closed by these local
  greens; historical_results_may_close=false.
- A full `bash scripts/check.sh` pass is not claimed: the working tree carries
  multiple pre-existing failures outside this task's Owns files (comet-flow
  probe, 3_2/3_3 journey cases) that belong to their owners.
- `npm test` (test/*.test.js) full-suite attribution log: evidence/npm-test.log
  (any failures there outside spec-closeout are pre-existing; spec-closeout is
  green within it).

## Addendum — full npm test attribution

`node --test test/*.test.js` (pinned node): 1132 tests, 1125 pass, 7 fail
(evidence/npm-test.log). All 7 failures are pre-existing and outside this
task's Owns files; proven by re-running their four files with my three files
stashed — identical 218/224 with the same 6 failures there
(evidence/npm-test-failure-files-baseline.log), plus the already-attributed
comet-flow probe failure. The seven: classic-integration/comet-driver package
identity (P2_4-R3 in-flight composition build), comet-method-binding x2 (P1_6
method supplier/packaging), foundation-distribution x2 (repo drift gate +
F04 keep-baseline), comet-flow P31 cwd-collision probe. test/spec-closeout is
green within the same run.

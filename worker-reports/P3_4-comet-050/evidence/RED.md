# P3_4 RED record (revision 2026-10-26-comet-050-adoption-v1)

Date: 2026-10-26/27 (probe archive dir stamped 2026-10-27 by UTC date).
Node: v24.15.0 (~/.nvm/versions/node/v24.15.0/bin/node).
Working tree state at RED: the two 0.4.5-era candidate diffs
(`lib/adapters/spec.js` + `test/spec-closeout.test.js`, snapshot
worker-reports/Root-handoff-20261026/pending-source.patch) applied on top of
HEAD 8b1dfaa.

## Run 1 — test/spec-closeout.test.js (current tree, old candidate diff)

Command: `~/.nvm/versions/node/v24.15.0/bin/node --test test/spec-closeout.test.js`
Result: exit 0 — tests 39, pass 39, fail 0 (log: red-spec-closeout.log).

Interpretation (wrong-supply green, not an acceptance): the three old-candidate
`managed Run context` tests import the RETIRED 0.4.5 runtime
(`.sdd/vendor/comet/c90af44a…/builds/6da90e89…/work/assets/skills/comet/scripts/comet-runtime.mjs`,
sha-pinned in the test) and pass only because that historical build tree is
still on disk. The suite therefore pins the retired supply; under the current
lock (upstream 0.5.0 aeb1a659 + 0005, build de39629a) these cases validate the
wrong aggregate.

## Run 2 — test/delivery-cases/3_4.mjs (current tree)

Command: `~/.nvm/versions/node/v24.15.0/bin/node --test test/delivery-cases/3_4.mjs`
Result: exit 1 — tests 9, pass 5, fail 4 (log: red-3_4.log).

Failing (all four spec-mechanism children): `native.installManagedDeliveryHost
is not a function` at fixture() — the 0002 managed-delivery host face does not
exist on the current pinned 0.5.0 build. Behavioral RED against the current
supply, not a missing-environment skip.

## Real 0.5.0 semantics recorded before implementation (probe scratch under /tmp/p34-probe-*)

- `comet archive <change>` = classicArchiveCommand: entry-state gate
  (phase=archive, verify_result=pass, archive_confirmation=confirmed, edit
  reviews) -> pending action under the state lock -> ONE
  `executeClassicOpenSpec(['archive', change, '--yes'])` where the openspec
  CLI is resolved by `process.env.COMET_OPENSPEC || 'openspec'` (120s spawn
  timeout) -> archive directory discovery -> `verifyMainSpecsClean` (no
  delta-only `## ADDED/MODIFIED/REMOVED/RENAMED Requirements` headings may
  leak into main specs) -> pointer rewrite + `archived: true` + run
  transition -> final integrity verification. Source:
  .sdd/vendor/comet/aeb1a659…/builds/de39629a…/work{,/dist}/domains/comet-classic/classic-archive.ts.
- Re-invoking `comet archive` on the already-archived change: exit 0, 6/6
  steps, NO second archive directory, NO openspec re-invocation (native
  idempotent reconciliation branch).
- `comet state next <change>` on the archived change: exit 0, phase archive,
  continuation kind delivery — archived is not overall completion (P4_6/Kt).
- Change state file: dual names `comet-state.yaml` (new) / `.comet.yaml`
  (legacy); both present -> ClassicStateFileConflictError; symlinks rejected
  (classic-state-file.ts). The file carries `change_id`, `run_id`, `phase`,
  `archived`, `verify_result`, `archive_confirmation` — the adapter's
  independent same-Run read-back source. `.comet/run-state.json` records are
  migrated to the workspace runtime root (.comet/runtime) and are NOT a stable
  change-dir read in 0.5.0.
- Layout: `classic.artifact_layout` legacy -> `<root>/openspec/...`, docs ->
  `<root>/docs/openspec/...` (classic-layout.ts).
- Module seam of the pinned build: `work/assets/skills/comet/scripts/comet-runtime.mjs`
  exports exactly {CLASSIC_COMMANDS, main, runClassicCli};
  `work/dist/domains/comet-classic/classic-runtime-run.js` exports
  ensureClassicRuntimeRun(changeDir) -> {run, classic}.
- 0005 Kt patch (integrations/comet/patches/0005-comet-050-kt-closeout.patch):
  read-side predicate only — knowledgeCloseoutBlocked parks an ARCHIVED run at
  `<profile>.archive.execute` instead of 'completed'; fail-open when the
  optional knowledgeCloseout field is absent (all upstream states). Kp stays a
  composition extension at full.verify.check.evidence re-verified at archive
  time; the write path is P2_4/P1_3 scope. The adapter's obligation is to
  forward the native refusal verbatim, never to retry or mask it.

## Old-candidate disposition (re-evaluated under the new architecture)

- `readRunContext`/`ensureClassicRuntimeRun` same-Run boundary semantics:
  REUSED (location/stat identity closure, assertCurrent recheck, native
  context runId equality) — re-targeted from the 0.4.5 `.comet/run-state.json`
  read to the 0.5.0 dual-name state-file identity. Provenance noted in the new
  test header and spec.js comments (source: ab90cc2+74607cc candidate in
  worker-reports/Root-handoff-20261026/snapshot.json).
- `ensureClassicRuntimeRun`-optional binding (0.4.5 runtime era): kept as an
  optional binding seam, now satisfied by the pinned 0.5.0 dist module.
- 0002-topology dependencies (installManagedDeliveryHost, dispatch-gate gates,
  archive-reopen 0.4.5 transitions, P1_3_ACCEPTED_ARTIFACT_ROOT indirection):
  DISCARDED.

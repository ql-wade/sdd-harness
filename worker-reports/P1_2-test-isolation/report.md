# P1_2 rework — hook behavior cases isolated from source `hooks/.compiled.env` (review P2)

Date: 2026-10-25 · Worktree: `codex/comet-entry-cleanup` (`.claude/worktrees/comet-entry-cleanup`) · No commits, no push, no runtime/product changes.

## Defect (independent review P2)

Candidate `test/adapter-quoting.test.js` SHA256 `3c226ca0f5f825065804d90a49433770443187d028e1beee9d2cdafa0d18669a` isolated the four assembly cases (compile / source / matcher / preserve) into private `SDD_TARGET_ROOT`s, but the four hook behavior executions (candidate lines 78/84/92/122, tests "pre-tool-gate denies blocked commands and allows normal ones", "fails closed on unparseable non-empty input", "denies direct wiki writes") still spawned `repoRoot/hooks/pre-tool-gate.sh`, which sources the source repo's live `hooks/.compiled.env` (script lines 14–17). Review evidence: with the source compiled env set to `DENY_PATTERNS='npm test'` and `KB_PROTECT_PATHS=''`, the suite drops 8/8 → 6/8. The behavior assertions therefore depended on a mutable generated artifact outside the test's control — a test-independence violation of the agreed real-script × generated-artifact seam.

## Fix (bounded, `test/adapter-quoting.test.js` only — net 177 → 210 lines)

New helper `makeGateRoot(t)` next to the existing `makeTargetRoot`/`runAdapter`:
1. fresh private `SDD_TARGET_ROOT` (same `t.after` cleanup);
2. byte-for-byte copies of the actual `hooks/pre-tool-gate.sh` and its sourced helper `hooks/_resolve-project-dir.sh` into `TARGET_ROOT/hooks/`, each copy asserted equal to the source bytes;
3. the existing real adapter (`runAdapter`, unchanged, policy source = real `hooks.yaml` via source-repo fallback) compiles `hooks/.compiled.env` **into that same target**, with a must-exist assertion (no silent skip);
4. returns the target's gate path — behavior cases spawn that copy against that generated policy.

The three behavior test blocks now call `makeGateRoot(t)` (deny/allow share one target per case, as before); they gained the same `{ skip: !hasPython3 && 'python3 unavailable' }` environment guard as every other adapter-invoking case (the adapter requires python3). All original assertions and exit-code/stderr expectations are unchanged — no relaxations, no early skips, no new abstraction. Assembly cases (quoting/source/matcher/preserve), `.mcp.json` case, and `test/foundation-distribution.test.js` / `tools/adapters/claude-code.sh` are untouched (hash-proven below). Header comment documents the P2 rationale.

## RED: old variant under foreign source compiled policy → 6/8 (reproduced)

Old variant = the reviewed candidate itself (worktree file snapshotted to `$TMPDIR` before editing; hash verified `3c226ca0…`). Private fixture repo `$TMPDIR/p12-ti-*/repo-old-foreign/` built via node from byte-copies of: `package.json`, `hooks.yaml`, `.mcp.json`, `mcp-capabilities.yaml`, `tools/adapters/claude-code.sh`, `hooks/pre-tool-gate.sh`, `hooks/_resolve-project-dir.sh`, plus the old-variant test file, plus foreign `hooks/.compiled.env`:

```
KB_PROTECT_PATHS=''
DENY_PATTERNS='npm test'
```

- CMD: `node --test test/adapter-quoting.test.js` (cwd = fixture repo)
- EXIT 1 — **# pass 6 / # fail 2**; failed tests (see `repro-old-foreign.tap.txt`):
  - `pre-tool-gate denies blocked commands and allows normal ones` — `blocked command must exit 2: 0 !== 2`
  - `pre-tool-gate denies direct wiki writes (kb-write-protection)` — `0 !== 2`
- Matches the independent review's 6/8 exactly (foreign deny list loses both real-policy denials; empty KB protection loses the wiki deny; fail-closed parse case still passes because it never reaches policy evaluation).

## GREEN: new suite under absent / present / foreign source compiled → 8/8 ×3

Three fresh fixture repos (same byte-copied inputs, new test file; source `hooks/.compiled.env` respectively **absent**, **present** = byte-copy of the live worktree one (`ff05ef05…`), **foreign** = the policy above):

| fixture source `hooks/.compiled.env` | exit | pass | fail | fixture sources unchanged after run | `.claude/settings.json` created in fixture repo |
|---|---|---|---|---|---|
| absent  | 0 | 8 | 0 | yes | no |
| present | 0 | 8 | 0 | yes | no |
| foreign | 0 | 8 | 0 | yes | no |

Evidence: `matrix-new-{absent,present,foreign}.tap.txt`. The new suite's outcome is invariant to the source compiled artifact, and it writes nothing into any repo root.

## In-worktree verification (final working files)

- `node --test test/adapter-quoting.test.js` → EXIT 0, **# tests 8 / # pass 8 / # fail 0** (`worktree-final.tap.txt`).
- `git diff --check` → clean (no whitespace errors).
- `node --test test/foundation-distribution.test.js test/adapter-quoting.test.js` → 42 tests / 38 pass / 4 fail; the 4 failures are the pre-existing foundation-lock/digest set documented in `worker-reports/P1_2-convergence/report.md` (exporter lock, repo-level drift gate, keep-baseline, unresolvable-baseline — all in foundation-distribution; foundation-distribution alone reproduces the identical 4 at 30/34). None from adapter-quoting.

## Source integrity (before → after all runs; sha256 via node crypto)

| file | before | after |
|---|---|---|
| `test/adapter-quoting.test.js` | `3c226ca0f5f82506…` (candidate) | `fba4f48c39e6d76c…` (this rework — only intended change) |
| `tools/adapters/claude-code.sh` (preserved integration) | `7db34ebc1e872bef…` | unchanged |
| `test/foundation-distribution.test.js` (preserved integration) | `1ebdbe2ae11c0a23…` | unchanged |
| `hooks/pre-tool-gate.sh` | `02f17b484ab8949a…` | unchanged |
| `hooks/_resolve-project-dir.sh` | `0f7df17bf2038e59…` | unchanged |
| `hooks.yaml` | `52c65eba253190c7…` | unchanged |
| `hooks/.compiled.env` (live) | `ff05ef0511271e87…` | unchanged |
| `.claude/settings.json` (live) | `ce214d7b6bb174c0…` | unchanged |
| `.mcp.json` / `mcp-capabilities.yaml` / `package.json` | `a26098a0…`/`6f27aac2…`/`d16700d9…` | unchanged |

Never mutated for reproduction: every foreign/absent/present configuration lived only in private `$TMPDIR` fixture copies; the live worktree (and main) `hooks/.compiled.env` and `.claude/settings.json` were only ever read for hashing/copying, never written.

## Fixture cleanup

All fixture roots (`makeTargetRoot`, used by every assembly and gate case) register `t.after(() => fs.rmSync(...))`, which node:test runs on assertion failure too. Verified empirically: after all runs — including the 2-failure RED run — `os.tmpdir()` contains **zero** leftover `sdd-adapter-quoting-*` directories.

## Evidence files (this directory)

- `repro-old-foreign.tap.txt` — old variant, foreign source compiled policy: exit 1, 6/8, both gate behavior failures with `0 !== 2`.
- `matrix-new-absent.tap.txt` / `matrix-new-present.tap.txt` / `matrix-new-foreign.tap.txt` — new suite, exit 0, 8/8 each.
- `worktree-final.tap.txt` — final worktree run, exit 0, 8/8.
- `report.md` — this file.

## Limitations / not done

- No product/runtime change; the adapter, hook scripts, and policy files are untouched.
- `makeGateRoot`'s helper list (`pre-tool-gate.sh`, `_resolve-project-dir.sh`) is explicit; a future new `${SCRIPT_DIR}/…` dependency in the gate script would need the list extended (byte-for-byte equality assertion would still catch source drift, not a missing extra helper).
- The 4 pre-existing foundation-lock failures remain open (outside owned scope).
- No commits made; controller performs independent review/integration.

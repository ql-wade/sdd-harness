# I01 callers convergence — ROUND2 rework report (2026-10-25)

Worker: I01 caller-alignment rework, in isolated worktree `comet-registry-identity` only. Root remains sole controller; no second DAG, no agents, no architecture packet, no grants/ACL change, no services contacted, no commit/push/install, no main/global config change, no network.

## Scope actually changed this round

- `tools/infra/platform.mjs` — identity check repair (below).
- `test/infra-platform.test.js` — hermetic gh-stub RED->GREEN regressions; replaced the environment-bound live-gh probe assertion with deterministic stub outcomes.
- Caller configs `infra/delivery/platform/repository-registration.json`, `infra/delivery/llmwiki/project-root-policy.json`, `infra/delivery/knowledge/authorization-model.json` were already synchronized to the registry labels by the prior round (ql-wade/sdd-harness); re-verified GREEN via public CLIs, no further edits. Preserved registry.mjs/registry.json/infra-registry.test.js as integrated in main (untouched).

## P1 fixes (all three review findings)

Shared single identity core `checkRepositoryIdentity` consumed by BOTH `validatePlatform` and `probeRepositoryIdentity`:

1. **P1-1 (probe bypass):** the probe's independent old 3-field check is gone. The probe now runs the same 5-field preflight as validate; drifted registration repoFullname/url is rejected pre-network with `IDENTITY_NOT_SAME_ORIGIN`, exit 2, `executed:false` (never labels an unperformed attempt executed), zero gh calls. The gh call/expected values now come from the registry source (`registry#project.github.repoFullname`), not the registration copy.
2. **P1-2 (equality-only admission):** field shapes are validated before equality — `repoId`/`principalId` must be positive safe integers, `repoFullname`/`url`/`owner` non-blank strings, on BOTH source and registration sides. `undefined===undefined`, `''===''`, whitespace, `null`, string-typed ids all fail; no `repos/undefined` probing.
3. **P1-3 (id-only match):** a successful response must be a non-array object with valid integer `id` AND non-empty `full_name`; BOTH must equal the registered source for `VERIFIED`. Wrong values -> `MISMATCH`/exit 2; malformed/null/array/non-JSON shapes -> `UNVERIFIED`/exit 2 (fail-closed).

Contract preserved: exactly one readonly `gh api repos/<registered>` call; no writes, no grant power, no new schema/URL normalizer/platform; `remotePolicyWrites false`, `localOnly true`, all authority/readback UNVERIFIED, historical rpamis TLS errors kept verbatim as history.

## Commands and evidence

Pre-repair state (baseline): `node --test test/infra-platform.test.js` -> 17/17 pass; `node tools/infra/platform.mjs validate --json` -> exit 0 (committed alignment GREEN); `node tools/infra/llmwiki.mjs validate --json` -> exit 0 (`REPO_ID_MISMATCH` resolved by the prior round's label sync).

RED (tests written first, run against the candidate platform.mjs, hermetic gh stub — no network):

```
node --test --test-name-pattern "RED direct-probe preflight|RED equal-but-absent|probes are real and honest" test/infra-platform.test.js
# fail 3:
#  1 probe fixture stale-repoFullname must fail verification (exit 2), got 0      <- P1-1
#  2 validate fixture both-missing-repoFullname: ... must fail, got 0            <- P1-2
#  3 a correct id with a foreign full_name must fail verification, 0 !== 2       <- P1-3
```

GREEN (same command after the repair): 3/3 pass.

Focused whole suite: `node --test test/infra-platform.test.js` -> 19/19 pass (17 pre-existing + 2 new tests; the rewritten probe-honesty test is deterministic now).

Related suites (once): `node --test test/infra-llmwiki-paths.test.js test/infra-registry.test.js test/infra-knowledge-authz.test.js test/knowledge-authorization.test.js` -> 57/57 pass. No pre-existing environment failures observed in these suites this round; known foundation snapshot failures were already recorded earlier and not repeated.

Test approach: new `makeGhStub()` writes an executable stub `gh` into a private tmp dir, prepends it to `PATH` for the child CLI only, records argv to a log, and replays deterministic outcomes (`ok` body / transport failure). Every new test cleans its stub dir and fixture dirs in `finally`. Mutations only ever touch private tmp fixtures (registry copies + copied platform dirs); no repo file is mutated by tests. `expected` values are read independently from `infra/delivery/registry.json#project.github` in the assertions, never from the receipt itself. No report generation inside tests.

`git diff --check` -> clean.

## File hashes (sha256, post-work)

```
6d56470df8041748de6c80623c1a258cdab2f5ed293f654c5bf51f01455f73ee  tools/infra/platform.mjs
ebf5a4f75d90b5c52a99f4d3a11849777b521a9b0573f7c03e04d0c1d89db0be  test/infra-platform.test.js
d1d96341cd213703aa0557be1c6a46ed562c03754a50213f785cd593ac4a0618  infra/delivery/platform/repository-registration.json   (prior round, unchanged this round)
6c84d3c3cd4a712784c1ef23cd42d1110e4a38a16e414e53dfa56a22cab79288  infra/delivery/llmwiki/project-root-policy.json        (prior round, unchanged this round)
b887c2175b71636c6c212198557498951e9adb9e9507df1d3a026fe0d77116e3  infra/delivery/knowledge/authorization-model.json     (prior round, unchanged this round)
9dcd2ac32286b94c5cab7263e9ac22fca660a1f021118f6ec039b0473c1123db  infra/delivery/registry.json                          (main-integrated, untouched)
13b1ff7abdda3d292695678eb9fc8754ae80d9cfe4a680d6156d626bb9eaeb5a  tools/infra/registry.mjs                              (main-integrated, untouched)
7e276c5c53b7df19e1a312224019ea255d4cc56996cd47efe70d2fa15d412b12  test/infra-registry.test.js                           (main-integrated, untouched)
```

## P2 rework — final bounded: spawn-failure crash in the probe failure path (2026-10-25)

Independent Standards finding: at `platform.mjs:482`, `spawnSync('gh')` can return `error` with `stderr`/`stdout` null/undefined (gh missing or not executable); the old `run.stderr.trim()` threw `TypeError` — the CLI crashed to exit 1 with no JSON instead of the contracted structured UNVERIFIED/exit 2. Root reproduced it independently via the public CLI under a private empty PATH. Repair touched ONLY this subprocess failure/error handling; identity core, the 3 corrected caller configs, valid/mismatch/malformed API paths and all shared 5-field checks are unchanged.

Empirical basis (local probe, no network) of `spawnSync` result shapes on this host (Node v22.13.1):
- gh missing from PATH lookup -> `error.code=ENOENT`, `status=null`, `pid=0`, `stdout/stderr` null;
- non-executable `gh` on PATH -> `EACCES`, `pid=0`, streams null;
- timeout after launch -> `ETIMEDOUT`, `signal=SIGTERM`, `pid>0`, streams are strings.

Fix semantics (no new framework/schema, contract unchanged):
- failure path guards nullable streams before any `trim`; transport stderr first line still preserved verbatim (existing x509 regression untouched and passing); when there is no child output the diagnostic names the spawn failure (`gh did not complete (<run.error.code>)`); `redactHostPaths` retained on the final error string.
- a failed spawn can never be VERIFIED: outcome is structured `readback.status=UNVERIFIED` with `command` recorded, exit 2.
- honest execution reporting: `executed = !run.error || run.pid > 0` — no pid ever launched (ENOENT/EACCES, `pid=0`) => `executed:false`; timeout after launching (`pid>0`) still reflects attempted execution (`executed:true`). Success/transport-failure paths keep `executed:true` as before.

RED (test written first; public CLI via existing `runCli({env})` with a private empty PATH — the node caller is absolute, only the child gh lookup is affected; no network):

```
node --test --test-name-pattern "spawn-failure" test/infra-platform.test.js
# 1 fail: fixture missing-gh: expected exit 2, got exit 1; stdout empty; stderr:
#   TypeError: Cannot read properties of undefined (reading 'trim')
#       at probeRepositoryIdentity (tools/infra/platform.mjs:482:32)
```

GREEN (same command after the repair): 1/1 pass — both fixtures (missing-gh ENOENT, non-executable-gh EACCES) assert exit 2, structured UNVERIFIED, diagnostic naming the spawn code, `executed:false`, `localConsistency:PASS`, target command `gh api repos/<registry repoFullname>`, no host paths leaked. Fixtures cleaned in `finally`.

Focused whole suite (once): `node --test test/infra-platform.test.js` -> **20/20 pass** (19 from ROUND2 + 1 new spawn-failure regression). Related suites were 57/57 before this narrow error-path fix and are not repeated, per instruction.

`git diff --check` -> clean.

## Final file hashes (sha256, post P2 rework)

```
de92abb7068b4faf764f107b4e862ed932dc69b5bc176c93219260cd2c37ed85  tools/infra/platform.mjs
11899b6f8b8d35d781406f2e314d6c2c3f4e0c2cd58fbb4eb1ee86dc4671c9fb  test/infra-platform.test.js
d1d96341cd213703aa0557be1c6a46ed562c03754a50213f785cd593ac4a0618  infra/delivery/platform/repository-registration.json   (prior round, unchanged)
6c84d3c3cd4a712784c1ef23cd42d1110e4a38a16e414e53dfa56a22cab79288  infra/delivery/llmwiki/project-root-policy.json        (prior round, unchanged)
b887c2175b71636c6c212198557498951e9adb9e9507df1d3a026fe0d77116e3  infra/delivery/knowledge/authorization-model.json     (prior round, unchanged)
9dcd2ac32286b94c5cab7263e9ac22fca660a1f021118f6ec039b0473c1123db  infra/delivery/registry.json                          (main-integrated, untouched)
13b1ff7abdda3d292695678eb9fc8754ae80d9cfe4a680d6156d626bb9eaeb5a  tools/infra/registry.mjs                              (main-integrated, untouched)
7e276c5c53b7df19e1a312224019ea255d4cc56996cd47efe70d2fa15d412b12  test/infra-registry.test.js                           (main-integrated, untouched)
```

The ROUND2-era platform.mjs/test hashes above are superseded by this final block (only those two files changed this round). Ready for independent re-review. Live authority remains UNVERIFIED by design; a post-fix live readback stays with the root controller.

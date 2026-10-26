# P1_3 stdio lifecycle — independent Spec review

Verdict: **REQUEST_CHANGES**. One reproducible P2 regression in the changed initialization path. The other requested boundaries look implemented in this component; this review grants no business/runtime qualification.

## Fixed scope and sources

- Candidate: `50eec4a077506de96d63de7d635e3d271cd3bf7f`; parent: `9f912d11130284c6020a01eb22d0d84766c6769c`.
- Read candidate `AGENTS.md`, workflow-routing/exposure guidance, README/architecture/skill architecture, ADR-0015, current change HANDOFF, candidate author report, changed source/tests and all source callers.
- Primary review spec is the Root's bounded task: separate connect/ready from begin thread/turn; preserve fixed executable SHA/argv/env/original currentContext/operation handle/tool-subset boundaries; compatible default start; initialize-only cannot start/begin; empty tools remain empty; UNKNOWN cannot impersonate process closure; duplicate begin creates no duplicate thread/turn.
- Production source callers: none beyond the export in `lib/adapters/harness.js`; live test caller is `test/comet-driver.test.js`. Search also found historical worker-report test mirrors, which are evidence snapshots rather than callers to update.

## [P2] Initialization can overwrite sticky UNKNOWN after the initialized frame exceeds capture capacity

Location: `lib/adapters/harness.js:342–345`, especially lines 343–344.

The new branch calls `write({method:'initialized',params:{}})` and then unconditionally assigns `initialized = true; state = 'INITIALIZED'`. `write()` can synchronously call `unknown('NATIVE_CAPTURE_LIMIT')` (lines 216–225) when its outgoing frame crosses the total 2 MiB capture limit. That resolves `ready` and `done` as UNKNOWN, but the next statement overwrites the live state with INITIALIZED. This violates the required sticky UNKNOWN boundary and makes `observe()` claim initialized even though the `initialized` frame was never sent.

Reproduction script: `/private/tmp/P1_3-lifecycle-spec-overflow-20261026.mjs`.

Command actually executed:

```sh
node /private/tmp/P1_3-lifecycle-spec-overflow-20261026.mjs
```

The script imports the exact candidate harness and reuses the existing fixture factory in a private temporary directory. The private executable reads only the initialize request, emits bounded ASCII stderr so the request + stderr + initialize response total 2 MiB minus one byte, then emits a valid initialize response. It never starts a real agent, model, authentication, MCP, network client, or platform write. It cancels only its own child and awaits that child's closed promise in finally.

Actual final run: Node v25.2.1, exit 1 on the intended assertion (`UNKNOWN` expected, `INITIALIZED` observed). Observations:

```json
{
  "ready": {"status":"UNKNOWN","reason":"NATIVE_CAPTURE_LIMIT","initialized":false},
  "done": {"status":"UNKNOWN","reason":"NATIVE_CAPTURE_LIMIT","initialized":false},
  "observed": {"status":"INITIALIZED","reason":"NATIVE_CAPTURE_LIMIT","initialized":true,"truncated":true},
  "capturedBytes": {"stdin":152,"stdout":32,"stderr":2096968},
  "peerWireMethods": ["initialize"]
}
```

The first temporary fixture attempt had an escaping/syntax setup error (EOF, not this behavior); it was corrected before obtaining the result above. Default `node` and the apparent Homebrew node@24 path both actually reported v25.2.1, so the reproduced result is not represented as a fixed-24.15 run. The failure is the synchronous assignment after `unknown()` in candidate source, not a scheduler timeout diagnosis.

Root then supplied the accurate fixed runtime. Exactly one additional same-script replay was executed:

```sh
/Users/mac/.nvm/versions/node/v24.15.0/bin/node /private/tmp/P1_3-lifecycle-spec-overflow-20261026.mjs
```

This fixed Node v24.15.0 run also exited 1 on the same intended assertion, with identical ready/done/observe states, captured byte counts, and peer wire methods. Original records are retained separately: `/private/tmp/P1_3-lifecycle-spec-overflow-20261026.out` (Node25.2.1) and `/private/tmp/P1_3-lifecycle-spec-overflow-node24-20261026.out` (Node24.15.0). No deadlines or product assertions were changed.

Required repair: preserve UNKNOWN and refrain from declaring initialization successful when sending initialized fails. Add a focused test for this initialization-stage capture boundary, asserting that ready/done/observe retain UNKNOWN and initialized=false, and begin/start never create a thread after it. The existing stderr-limit fixture exercises the active-turn path, and current lifecycle additions do not cover this initialize-write failure.

Impact is contradictory component lifecycle observations; this review does **not** claim a successful tool or platform action bypass. Captured data is truncated, all managed/runtime qualification flags remain false, and later writes also hit capture refusal.

## Other spec boundaries checked

- `connect` starts exactly one operation and sends initialize only; `ready` is distinct from done/closed. `begin` requires the original identity handle and completed initialization. `threadRequested` prevents repeated begin/start from issuing duplicate thread/start; pending response ids prevent a repeated response from issuing a second turn/start.
- `start` keeps the legacy auto-begin behavior when policy is omitted or turn; initialize-only rejects it before spawn and rejects begin after ready. Cloning and registrationDigest include the policy, so mutating the original registration cannot grant turn scope.
- Executable lstat/executable bit/SHA check, fixed argv, environment allowlist, snapshotted original callbacks/context digest and dynamicTools membership checks remain intact. `dynamicTools=[]` is accepted and passed as an empty array; ActionBinding maximum allowedTools is unchanged.
- Timeout calls UNKNOWN without synthesizing exit/signal/closed. Only child close updates those facts. Cancel operates on the original process group; reuse returns the same operation rather than launching a retry.
- Original current tuple is checked at begin and request boundaries; historical initialization/closed snapshots are not authority. The added tests cover drift after ready, old-handle clones/proxies, early begin, no caller options, empty-tools denial, initialization EOF/timeout/cancel, and repeated begin/start.

## Evidence and acceptance boundary

The committed author report retains the earlier owned105/111 failure and related52/52 pass. Root separately reported a terminal, single serial+caffeinate replay of the same candidate and unchanged inputs/deadlines: owned111/111, exit0, fail/skip/cancel0. I did not repeat that matrix, inspect or touch its process handles, or substitute the report for this independent counterexample. No full repository check was run by this reviewer.

Accept only after the P2 above is fixed and independently replayed with the new focused oracle plus appropriate unchanged lifecycle regression. Existing 111/111 is component support and does not qualify actual Codex startup/config/provider/SourceReader, OS or source identity, original Native role channels, MCP permission enforcement, canonical artifacts, same-Run recovery, platform/Kp/archive/Kt, or whole P1_3/VERIFY. No product, plan, lock, ledger, original evidence, or user configuration was modified. Candidate HEAD and git status remained unchanged during the review.

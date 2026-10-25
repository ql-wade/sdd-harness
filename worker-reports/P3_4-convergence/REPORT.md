# P3_4 Spec Adapter — construction candidate

This candidate is for independent review, not whole-task, production, role or business acceptance. Canonical tasks/DAG/progress and all other owners' sources are unchanged. The migration Change has not been archived. Current business scenarios accepted: **0**.

## Result and implementation

`lib/adapters/spec.js` now exposes `createManagedSpecAdapter({runtime, projectRoot})` as a protected bootstrap code seam. It captures the fixed original aggregate's `runClassicCli` and invokes its default handlers. Archive uses the original top-level `archive`; recovery uses original `state next`. The original Comet owns all gates, policy/tool binding, Run, lock, transaction, archive preview, operation reconciliation and completion. The adapter creates no managed lock, journal, queue or phase.

The adapter independently reads the same persisted Run before/after, refuses a changed Run identity, checks physical archive movement and reads main specs back. A command success is not overall completion: the result retains the native response and observed Run status, with `overallCompletionEligible:false`. Missing source/host qualification stays a native UNVERIFIED refusal.

Every legacy mutating/helper entry, including rehearsal copying, refuses a Comet-owned project even when its control document is malformed or partial. A caller's knowledge `{id,digest}` cannot bypass Native. The old writer is retained only for genuinely non-Comet component projects and its closeout/recovery results explicitly carry component scope. Pure summary, preservation and readback helpers remain reusable.

## Actual verification

- Exact Node 24.15.0 and the pinned isolated OpenSpec 1.11.0; no global tool changes.
- Copied the absent official **6da90e89…** distribution into this worktree, preserved bytes/modes/links, then ran `verifyPreparedSource` and `verifyCometDistribution`: PASS. This is reuse of a reviewed build, **not a fresh build**. SDK/patches/lock unchanged.
- `node --test --test-reporter=tap test/spec-closeout.test.js test/delivery-cases/3_4.mjs`: **23/23, 0 skipped**, 145.503 seconds TAP duration; all four input hashes unchanged.
- `bash scripts/check.sh`: **FAIL**, 830 tests / 819 passed / 11 failed / 0 skipped. Failure identities are retained in `verification-summary.json`; they concern other owners' quorum boundary, historical C08 version expectation, method/distribution drift and Runner/image/catalog/build locks. None was modified or waived here.
- Pinned CLI `validate delivery-foundation-rearchitecture --type change --strict --json`: exit 0, structure only. It is not archive readiness.

Native component cases actually invoke the default official aggregate and original P2_2 authority/admission/Gate functions and P2_1 definition digest. They demonstrate missing Kp/no-host refusal, current main-spec drift and non-revival, real archive+same Run waiting for Kt, current Kt and original completion, immutable archived/terminal history, actual writer SIGKILL after archive commit and same-Run recovery without repeating sync. The pre-move collision case uses the existing `archive-reopen` transition and collects new V/Kp after conservative invalidation. Main specs keep both original scenarios and the added requirement.

## History and corrected oracles

All failures and raw logs are retained under ignored `.local/P3_4-convergence`; `raw-display-index.json` records original and portable-display hashes.

1. `01`: a real legacy public-entry regression archived a Comet-owned temporary change using caller-authored Kp; expected refusal was absent. `02` is its narrow GREEN.
2. `03`: 17/14/3 failed because old tests demanded silent scenario loss from historical 1.3.1. The real pinned 1.11 validator/archive now refuses that loss. The fixed oracle requires native and adapter refusal, unchanged main bytes and an unmoved change. `05`: 17/17.
3. `06`: the new adapter initially used nonexistent `state archive`. The real public CLI reported Unknown subcommand; routing was corrected to top-level `archive`. `07/08/09` prove subsequent actual archive, drift and writer-restart behavior. That routing error is not a security-source RED.
4. `10/11`: pre-move supplementary expectations incorrectly assumed waiting, then that old V/Kp could survive candidate changes. Actual pre-archive Run is running; observed directory/content changes invalidate V/Kp monotonically.
5. `12/13`: direct V redispatch in Archive is forbidden, and even an empty directory participates in candidate binding. The initial diagnosis inspected the 0002-only private layer and missed the already-present **official joint 0003 `archive-reopen`** route. That was a diagnosis error, not a confirmed SDK gap. `14` uses that original route, keeps the same Run, reruns the real verification check, collects fresh V/Kp and archives successfully. No old approval, phase or SDK was rewritten.
6. `15` is the complete current successful matrix. Earlier passes are historical and are not inherited.

## Remaining boundaries

The host callbacks and semantic review results are controlled component fixtures. Real A/T/V methods, independent roles/principals, production source registration, installation/UID/volume enforcement, real LLMWiki Kp, Outline Kt, permissions and platform/user Journeys remain **UNVERIFIED/NOT-EXERCISED**. A HMAC, callback shape, role label or local passing test does not qualify them. P1_3/I02 must install and protect the actual fixed bootstrap and authenticated ports; the adapter supplies no CLI/env/JSON/module-path consumer loader or signing outlet.

The SIGKILL case terminates the exact disposable writer **after** its actual archive commit and before its controller consumes the response. It proves committed-operation restart/readback; it does not claim a new halfway-through-OpenSpec/WAL crash proof. Pre-move conflict recovery is separately exercised through the original controlled reopen route. Wider unknown/partial remote publication recovery remains its original owner.

No remote write, credential access, provider/model execution, real knowledge publication, new Goal/monitor/controller or main-worktree mutation occurred. Only this candidate's three owned code/test paths and report directory are submitted. Independent acceptance and serial integration remain with the existing controller.

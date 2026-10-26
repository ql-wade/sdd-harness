# P1_3 bounded stdio lifecycle candidate

Base `9f912d11130284c6020a01eb22d0d84766c6769c`; branch `codex/comet-stdio-lifecycle`. Only owned harness/test plus this new report change. Parent-approved eb341 interface is implemented without enabling its actual CLI/profile plan. **Construction validation remains INCOMPLETE: final owned105/111 failed; related52/52 passed. No runtime or whole P1_3 acceptance.**

## API and bounds

`createCodexStdioTransport(...)` now returns `connect()`, `begin(originalHandle)`, existing `start()/observe()/cancel()`. Each original operation adds `ready` beside handle/done/closed. connect only exchanges initialize/initialized, duplicate/concurrent connect returns that same operation. ready reports historical INITIALIZED or UNKNOWN, never identity/Role/source authority. begin requires initialized state, exact original handle and current frozen tuple, then sends one thread/turn; duplicates never create another thread. Default start still requests the old full lifecycle.

Optional registration.startPolicy is the closed set initialize-only/turn; omitted means old turn flow. The original clone and registrationDigest cover it. initialize-only refuses start before spawn and begin after ready, including caller mutation of its old object. This is a protocol restriction, not a role label or grant. `dynamicTools=[]` is now a real empty exposure subset; ActionBinding min1 maximum-permission contract stays intact. Existing fixed three-word argv/environment allowlist, default main, Host, Comet/Spec/Runner/contract sources remain unchanged. No actual-c/config/strictConfig/provider activation in this slice.

Only driver-test currently consumes these new methods. Private fixtures are actual executable Node peers, not actual Codex/model/source qualification. They exchange normal schema frames and perform protected private-file IO only in declared component cases. One instance coalesces protocol calls; cross-process execution uniqueness stays with Native. No new business phase, queue, durable session/lease ledger, retry, reconnect or business verdict. INITIALIZED is local transport observation only. Current/close checks, original digests, sticky UNKNOWN and actual exit/signal/closed facts remain.

## Actual checks, including failures

Fixed Node24.15.0; six offline guards calibrated97. Two independent intended REDs were observed: missing connect API1/1 failed, and real empty-tools context rejected1/1 failed. Corresponding minimal GREEN each1/1. Broad lifecycle boundary run was26/28: one positive connect→start case reached begin without completed initialization; its original ready reason was not logged. Stronger ready assertions were added without changing product or any deadline; that focused route subsequently3/3.

The necessary final owned run is **105/111,exit1,skip0**. Three failing leaves plus parents: old notifications-early-tool, new explicit begin, new empty-subset refusal. They timed out instead of reaching their intended protocol oracle. The strengthened failure records UNKNOWN/NATIVE_TIMEOUT_UNKNOWN, original pid24627 still not closed, stdout/stderr0 and peer wireMethods=[]; the positive leaf took10–16 seconds despite its configured3-second timeout. Actual cause is not established; it is not honestly fixed or independently classified as environment. No timeout/assertion was loosened.

Directly related execution-binding is **52/52,exit0**. One controlled same-record sequential diagnostic compared exact old9f ordinary lifecycle3 checks, current same lifecycle3, current explicit begin/start3: **9/9**, with current early-tool2.398 seconds. It did not reproduce the full-run failures and does not substitute for105/111. No further retry-to-green was done. All input-before/after digests were unchanged, test guard calls0, and test handles reached actual terminal cleanup. Old eb341/62011/8b0, P2/watch/75-1 evidence and all prior ignored leaves remain.

```text
<node24.15> --test --test-reporter=tap test/comet-driver.test.js
<node24.15> --test --test-reporter=tap test/comet-execution-binding.test.js
```

runs.json preserves every command/UTC/cwd/PATH/exit/input identity and unexpected result. raw-display-index points to original ignored bytes and display hashes; no old run was overwritten. Raw root `.local/P1_3-stdio-lifecycle/`. Only its explicitly owned baseline mirror was cleaned after source copies and terminal evidence were retained. TestPack readiness, if structurally valid, means runnable author handoff only, not a passing regression or acceptance verdict.

## Unfinished obligations

Root independent review and exact controlled replay must resolve the failed owned result before construction acceptance. No actual CLI/auth/model/MCP/Docker/network service or global setting was used/changed. Real startup/config closure, source/OS identity, provider/SourceReader, original Native non-gate actions, I02 worker/canonical artifact return, real three-channel enforcement, platform/Kp/archive/Kt and recovery remain UNVERIFIED. This slice does not close whole P1_3 or the parent delivery journey.

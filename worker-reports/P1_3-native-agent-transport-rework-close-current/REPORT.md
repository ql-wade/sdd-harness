# P1_3 stdio close-current rework

Base `e361f097b09276288b6dc65db82d3e66d4374c12`, same `codex/comet-native-agent-transport` branch. Only `lib/adapters/harness.js`, appended driver tests and this new report change. Old candidate, reports, raw evidence, default main and binding fixture remain intact.

The independent Spec counterexample showed completed-turn observation followed by epoch drift before actual process close. The shared close handler now calls the existing current-tuple validator before final done/closed snapshots. Stale or throwing CODE readback yields sticky `UNKNOWN/NATIVE_CONTEXT_STALE`. Original contextDigest and actual exit0/closed/completed-turn facts remain unchanged. Earlier UNKNOWN/timeout reasons never recover after restoring old bytes. This adds no verdict, restart, second controller or observer-wide historical invalidation; Native and future SourceReader must still independently recheck each acceptance.

Public-seam tests reuse the full ordinary-notification/dynamic-tool peer and actual private-file IO. A filesystem-watch barrier stays open after stdin EOF; its readiness marker proves transport processed turn/completed before mutation. Another explicit marker releases that same peer for normal exit, with no sleep creating the race. Stable, epoch drift, currentContext exception and timeout/restored-tuple cases assert both final views, original digest, exact handle, one callback and no diagnostic echo. Later epochs do not rewrite already-closed historical observations.

## Actual author evidence

Fixed Node24.15.0; six original offline guards calibrated to97. RED **5 tests/2 pass/3 fail,exit1**: stable and timeout controls pass, while epoch/exception incorrectly return OBSERVED_TERMINAL; parent test also fails. Same-seam GREEN **5/5,exit0**. Necessary final owned **81/81**, related **52/52**, both exit0, zero skipped/cancelled, zero external guard calls, input-before/after unchanged. No full-suite replay or retry-to-green this round. Original 75/76 fixture failure and all earlier RED/cleanup records remain preserved.

```text
<node24.15> --test --test-reporter=tap '--test-name-pattern=native close rechecks' test/comet-driver.test.js
<node24.15> --test --test-reporter=tap test/comet-driver.test.js
<node24.15> --test --test-reporter=tap test/comet-execution-binding.test.js
```

`runs.json` and per-run evidence retain UTC/argv/cwd/PATH/exit/input/raw hashes. Raw stays in `.local/P1_3-native-agent-transport-rework-close-current/`; display views normalize declared paths/whitespace only. Original Spec report SHA `af5a5e1d4f64c3041eb8043107bc822da7f380c6f418f0f14254a19ecb838217`. Old manifest/report/raw custody and ignored-leaf metadata are checked separately. A report-assembly attempt failed on the old manifest map format; its failure is retained under ignored evidence, then corrected without changing source/tests or rerunning tests. TestPack structure validation is not acceptance.

## Unverified scope

Author construction only, pending independent dual review and Root replay. No actual Codex/Claude/ZCode, auth/model/MCP/Docker/API, download or global config access. SourceReader, worker-frame/I02 interaction, canonical artifact return, real tool no-bypass, provider/OS identity, same-Run role chain and recovery remain UNVERIFIED. Whole P1_3 is incomplete; Comet alone owns business acceptance. No canonical plan/lock/phase/grant/progress changes.

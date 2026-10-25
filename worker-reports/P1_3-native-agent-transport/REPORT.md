# P1_3 bounded native stdio transport candidate

Base `1c66edf4237b3b5039ce5b1e63f84401e2c785d0`; branch `codex/comet-native-agent-transport`. Product changes are limited to `lib/adapters/harness.js` and appended `test/comet-driver.test.js` coverage. Existing driver/authority behavior, default unbound main, old binding fixture, canonical plan/locks/state and method snapshots remain unchanged. This is construction CODE for one0.163 stdio connection, not a qualified provider or complete P1_3.

## Public CODE interface

`createCodexStdioTransport({registration, context, currentContext, invokeTool})` returns `start()`, `observe(originalHandle)`, `cancel(originalHandle)`.

- Registration fixes a regular executable file/hash and **only** `['app-server','--listen','stdio://']`. Its env accepts PATH/LANG/TZ/TMPDIR only. Original HOME/CODEX_HOME are inherited unchanged; no override/key/token/preload/role/provider/module field is accepted. The fixture is a real executable private Node24 script using the same argv, with its own hash; there is no product test-bypass.
- Context fixes the original parsed ActionBinding, model, cwd, bounded text input and a closed set of function DynamicToolSpecs from allowedTools. The synchronous `currentContext()` must project the original Native's retained **pre-output** binding. It is compared before launch/material requests, tool execution and reply; the transport never reads declared outputs to rebase old approval. `invokeTool(request,{signal})` is protected CODE and must perform real current-action/tool/path/purpose authorization itself. Function shapes and JSON validity are not source or actor authentication.
- Start has no call-time argv/options and returns the same in-memory operation for duplicates. `handle`, `done` and `closed` describe the original process. A failed preflight cannot be revived by restoring old bytes on that instance. No second session/job/phase/retry/lease store, scheduler, signing or disk ledger is created.
- `done` reports a terminal observation **or UNKNOWN**; UNKNOWN is not physical exit. `closed` retains the actual process exit/signal. Timeout, EOF, wrong correlation or protocol failure never relaunch/reconnect or automatically claim termination. Explicit cancel accepts only that original handle and signals only its owned POSIX process group, with a bounded termination escalation. Windows process-group qualification is unsupported/fail-closed. These mechanisms do not establish production OS isolation.
- Snapshot returns bounded original stdin/stdout/stderr bytes, parsed incoming events, context/registration digests, exact native thread/turn and real process exit. Outgoing raw bytes record attempted writes; write/stream errors stay UNKNOWN. Capture truncation is explicit. No business verdict is returned, and runtimeQualified/managedClosureEligible remain false even for turn completed plus exit0.

## Native protocol and refusal surface

Initialize -> initialized -> thread/start -> turn/start uses the actual local0.163 schema. Environments are explicitly empty. Function DynamicToolSpecs and text content/replies use the native field names. Incoming item/tool/call is correlated to the fixed run/execution and exact thread/turn/call/RPC id before the protected callback. Exact in-flight duplicates do not repeat an operation; changed or late replays are refused. At most four early tool frames may be buffered solely until the matching native turn response confirms their provisional ids; they cannot execute from an unconfirmed notification.

Known ordinary notifications have bounded exact field/identity checks: thread/status/changed, thread/tokenUsage/updated, reasoning summary part, turn diff/plan, scoped item lifecycle and text/reasoning/plan deltas. Replays cover notifications preceding responses, dynamic item started -> tool request -> callback reply -> item completed, and a tool request arriving before its turn response. Plan/diff/status telemetry never writes files or schedules work. `multiAgentMode` is omitted: local schema marks it deprecated/ignored, so it is not a nested-dispatch control. No notification optout hides requests or errors.

Unknown server requests, approval/permission escalation, native Shell/Edit/MCP/collaboration execution items, unknown tools/namespaces, wrong ids, malformed/duplicate-key/oversized JSON, unsupported callback replies and stale context fail closed. This detects/refuses protocol surfaces; it cannot undo a real native builtin side effect that already happened before its event. Environments=[] and these schema checks are **not** actual no-bypass proof. Real CLI startup remains prohibited until its managed config, identity, connectors and tool channels are separately qualified.

## Actual author checks and retained failures

Node24.15.0; six offline CLI guards calibrated to97. Actual private executable peers perform the stdio exchange and wait for protected callbacks that write/read private files. No installed Codex/Claude/ZCode app-server, model, auth/login, MCP, Docker, HTTP or gateway was started.

```text
node --test --test-reporter=tap test/comet-driver.test.js
node --test --test-reporter=tap test/comet-execution-binding.test.js
```

Final owned **76/76** and related **52/52**, zero skip, zero external-guard invocation, with each run's input-before/after unchanged. Related's harness/binding source hashes equal the final candidate. First final-owned **75/76** remains: the supposed in-flight duplicate could arrive after a fast callback response and was correctly rejected as late replay. The test now holds its actual callback until public wire observations confirm both duplicate requests are present; real file IO and the original assertions remain, and the late-replay refusal was not relaxed. Only owned was rerun after that fixture correction.

Other retained REDs: missing client; hidden argv property/raw getter diagnostic; one RPC id switching callId reached a second private side effect; stale preflight revived after restoring old context; normal lifecycle notifications were unsupported. Each relevant fix has subsequent GREEN. The first ordinary-notification RED test incorrectly awaited closed after UNKNOWN and left its peers alive; an explicit owned-ancestry cleanup stopped only those two private peer process groups. Its full failure/output and cleanup PIDs are retained. Tests now check done before awaiting physical close in cleanup. This is author-fixture handling, not production recovery proof.

`runs.json`, `raw-display-index.json`, `candidate-inputs.json` and `manifest.json` retain actual UTC/argv/cwd/exit, source/schema digests and original/display custody. Display-only path/whitespace normalization does not change raw bytes. The old1170 ignored leaves are checked by metadata equality, not by reading secret contents. Original driver test bodies are preserved; only required imports and new tests are added. No whole-suite or protected Whitebox acceptance is claimed.

## Unfinished original-task obligations

This export is not yet installed into the fixed Host/provider/main. SourceReader authentication, actual source/issuer/normal CLI credential qualification, model material authorization, real builtin/tool no-bypass, worker-frame/I02 interactive and artifact channels, same-Run canonical output installation, original Native producer/launch/outcome transactions and cold recovery remain UNVERIFIED. Other CLIs are not implemented. No API-key directory or new secret resolver is selected; existing refs are not resolved. The original Comet alone may authorize/start/recover/accept a business action. Root independent Spec/Standards and exact main replay remain required before construction integration.

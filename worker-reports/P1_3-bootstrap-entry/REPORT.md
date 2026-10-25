# P1_3 bootstrap entry construction candidate

Base: `884880a3d7cb27ed70fb5da2cca33eb8b3c5ea24`. Branch: `codex/comet-bootstrap-entry`. Only the owned executor source, appended binding tests and this report directory change. Whole P1_3, actual bootstrap/Host/roles/OS and the business journey remain UNVERIFIED.

## Delivered behavior

- `lib/adapters/comet-executor.js` now runs as a Node entry, including I02's planned fixed symlink. No extra source path or menu is introduced. Valid original `state` arguments without a bound provider return structured UNVERIFIED/exit2. Malformed arguments return INPUT_INVALID/exit1; no arguments also means invalid input, not a worker frame.
- `runCometHostMain(argv, executor?)` accepts only an exact same-module CODE-created executor object. It installs that fixed Host once and delegates to the existing scoped `invokeNative`. Copies, same-shaped objects and Proxy wrappers cannot substitute one. The WeakMap proves only object identity inside this process; it grants no OS, source, issuer, role or credential qualification.
- No provider is loaded from argv, environment, stdin, DB or files. No loop, phase/action store, queue, lease, retry or launch-on-read is added. Native result exits 0/1/2 and stdout pass through; malformed/unsupported results and unknown exceptions fail statically without producer message, stack or input echo. Metadata cannot turn productionQualified or managedClosureEligible true.
- Original Native still owns the Run, authority, gates, state writes and transitions. The bare packaged entry cannot yet consume I02's `{dispatch,job}` stdin frame or execute a worker method. It is not a delivered production bootstrap.

## Actual author verification

Exact Node 24.15.0. Six offline guards were calibrated to exit97; all subsequent test captures recorded zero guard invocations. Final commands used explicit TAP:

```text
node --test --test-reporter=tap test/comet-execution-binding.test.js test/comet-driver.test.js
node --test --test-reporter=tap test/delivery-evidence.test.js test/delivery-gate.test.js
```

The first ran **65/65**, the second **52/52**, with zero failure/skip and captured input bytes unchanged. These are construction author self-checks, not independent acceptance. The 30 appended checks retain the old 35 owned checks. Original binding-test bytes (29881 bytes, SHA256 `389053944465219214fb6402a35b0076dbd7d3ec8eaa52419bf9baa623269856`) remain an exact prefix; the 559 Gate fixture is unchanged.

The new CODE positive uses only old component material **6da**, aggregate SHA256 `04795080295d7174af82913757254426b82037ea5028296a3602b86d200559dd`. A new private original Run returns `open` through main for four repeated/concurrent reads, then returns its same `run_id`; physical-command guard attempts are zero. Missing source qualification is explicit. This is diagnostic delegation, not real worker/OS/model or semantic Gate proof. The unchanged older Gate fixture remains separately scoped.

Valid REDs retained: standalone entry silently returned0; malformed arguments were misclassified as missing qualification; CODE-bound entry still returned2; missing required `get` field and sparse argv escaped input classification. Each relevant fix has a retained GREEN. Four controlled producer faults cover unknown exception, malformed result, unsupported exit64 and preserved Native exit2. One intermediate GREEN attempt failed because its final test read invoked Native directly outside the installed Host scope; the guard correctly refused ORIGINAL_NATIVE_CALL_REQUIRED. The test now reads `run_id` through main, without relaxing the guard. All raw output remains in the index.

## Approval and supplier boundary

The attempted 3056 test patch was automatically rejected and never applied/executed. APPROVAL-REJECTION.md preserves its exact reason; ENTRY-CONTRACT-PROPOSAL.md preserves the earlier proposal. Root then reviewed the separate R1 interface and exact unapplied diff `a9f870e3cf6a4ed6357664a5a32bfdafa1c0095ba3e186fbdb5757fd802cad7a`, permitting only this old-material mechanical seam. No 3056 consumer binding, production grant or SDK upgrade follows. The proposed patch remains a historical review artifact; final source additionally rejects missing get fields and sparse input.

See `raw-display-index.json` for every UTC/argv/cwd/exit/input digest and raw/display custody. `candidate-inputs.json` records source, static dependency and material hashes. Old 586 ignored evidence files and all old report paths are preserved. No Docker/model/API/credential/global configuration/production Run operation was performed. The bounded author TestPack remains in `.local/P1_3-bootstrap-entry/test-pack.raw.json`; proper capture `pack-structure-r2` returned PACK_STRUCTURE_VALID only. The first structure capture recorded its hashes too late and is explicitly retained as a timing limitation, not before/after evidence.

## Still required in the original tasks

`PROVIDER-AND-PACKAGING.md` supplies the concrete deployment/identity/issuer gaps and next action plan. A real protected CODE provider, purpose-bound credential access, immutable packaged entry and actual principal/mount/channel qualification are missing. Pending original I02 resolve/slot and P2_4 non-Gate/launch-record ports are not consumed. Positive cold recovery, author/test-code/Builder/method execution and actual model/OS/source/permission proofs remain UNVERIFIED. Canonical task checkboxes, DAG, locks and current required/case acceptance are untouched. Review this candidate along independent Spec and Standards axes before Root integration.

Freeze format check first found trailing whitespace in TAP diagnostic blank lines and unified-diff context. Raw logs and approved a9f870… patch bytes are unchanged. Display logs trim line endings only; the original reviewed diff is retained losslessly in `main-capability-proposed.json` and its indexed raw copy. Historical R1 filename references describe the review-time path. No code/test oracle was changed for formatting.

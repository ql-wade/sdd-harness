# P1_3 thin main: proposed CODE contract, not a runtime grant

Status: pending Root interface/version review after the automatic approval rejection. No rejected patch was applied or executed. Current source implements only argument validation and the unbound executable refusal. This document does not activate a supplier or qualify a Host.

## Public seam proposed for the next small patch

`runCometHostMain(argv: string[], executor?: object): Promise<{exitCode: 0|1|2, stdout: string, productionQualified: false, managedClosureEligible: false}>`

The optional second argument would be the exact object created by this module's existing `createCometExecutor({native, authority, registration, source})`, passed only by protected bootstrap CODE. A module-private WeakMap would recognize object identity; a copied object, methods with the same names, role labels or JSON fields would not be recognized. This is a JavaScript capability boundary only. It is not OS, process, source, credential, role or project qualification. No production caller is bound in this slice.

The associated private entry would install that same executor's fixed Host once and call its existing scoped `invokeNative`. It would not select a role, import a provider, create a controller, execute a continuation loop, schedule physical jobs or stamp a phase. Repeated calls reuse only the original Native installation. Unknown CODE/provider/identity/grants remain UNVERIFIED; no argv/environment value can supply the second argument in the executable.

Arguments are only bounded existing `state` operations: get/next/gates/dispatch-gate/accept-gate/transition/set/complete-design. The registered change stays fixed by the original executor. There is no `--role`, `--provider`, `--module`, cwd/project override, external-command forwarding or new `/comet-*` menu. Original Native still checks authority, current inputs, gates and allowed state writes.

Malformed input or a forged capability would return static INPUT_INVALID/exit1. Missing binding would return static UNVERIFIED/exit2. Known original binding refusals would retain nonzero refusal semantics; an unknown thrown error would return static INTERNAL_FAILURE/exit1 without its message, stack or paths. Successful CODE construction calls would preserve original Native stdout and exit code while the returned object remains explicitly productionQualified=false. Native exit0 would not qualify the provider or any business receipt.

## Intended actual mechanical calls

In a private temporary fixture, using its existing synthetic public HMAC and CODE source only:

1. `runCometHostMain(['--json','state','get','demo','phase'], executor)` installs once and returns the original Native `open` readback.
2. `runCometHostMain(['--json','state','dispatch-gate','demo','R'], executor)` delegates the original Run's Gate dispatch.
3. Existing explicit `executor.execute({execution})` runs the existing bounded Node executable fixture through the actual I02 physical three-port CODE. The main adds no launch loop.
4. `runCometHostMain(['--json','state','accept-gate','demo','R','--file', '<private-fixture>/proposal-result.json'], executor)` returns the original strict collector/Gate decision on that Run.
5. Repeated invocation, wrong change, copied capability and source invalidation must preserve the original refusal. Method application, independent semantic review, model identities and OS remain UNVERIFIED.

Actual original Native functions remain `installManagedDeliveryHost`, `runClassicCli(argv, undefined, {projectRoot,invocationCwd})` and `ensureClassicRuntimeRun`. The proposed patch would not change those interfaces or use a non-existent non-Gate/resolve port.

## Proposed material binding to be reviewed

The branch base is the Root-accepted integration `884880a3d7cb27ed70fb5da2cca33eb8b3c5ea24`. Its upstream lock SHA256 is `7d958d16aaac944017eb3db68aa18dd0d63d446fb811cb5f57608f9f86e56633`; source commit remains `c90af44a4474662d7853aae76ce785404974fb0a`, version 0.4.5, now seven patches.

The proposed additional component fixture material, not yet consumed, is:

- Fingerprint `3056292584ad17c49080c7504c1a689f1a382012e708665a8f12069d75a12a69`.
- Existing accepted artifact-root relative file `.sdd/vendor/comet/c90af44a4474662d7853aae76ce785404974fb0a/builds/3056292584ad17c49080c7504c1a689f1a382012e708665a8f12069d75a12a69/work/assets/skills/comet/scripts/comet-runtime.mjs`.
- Observed bytes 793732, SHA256 `8825b2900dda50d2c039a21128853ca9b0d3da6978482a4ba685f763ad49113e`.
- Root construction evidence pointer `worker-reports/Root-joint-runtime-3056/integration.json`; this pointer does not itself amend a dependency binding.

Current contract SHA256 `a3cf328a8e46e0f48aa8420257aacf275b41aad6d3bdd6406f4f0e83aabc87ad` names P1_3<-I02 for exact 67095e2 physical CODE construction and P1_3<-P1_2 for exact 9c9b70b packet transport only. Neither edge grants a production Host, launch, role or credential. Root must determine whether the reviewed 3056 derivative is explicitly consumable in this narrow mechanical test; this worker will not infer a new edge or edit the contract.

The existing 559 checkpoint's 6da aggregate SHA256 `04795080295d7174af82913757254426b82037ea5028296a3602b86d200559dd` and its historical component tests remain unchanged. The rejected patch is not replaced with an unannounced SDK fallback.

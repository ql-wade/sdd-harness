# Author self-check is not acceptance

1. Read public behavior/approved oracle before assertions. Avoid expected values computed through the same implementation, asserting constants against themselves, ignored assertions, zero-test discovery or snapshots regenerated to match wrong behavior.
2. Prefer real module boundaries; mock external nondeterministic dependencies only where this test's declared scope permits. A contract mock proves a consumer interaction, not a live provider or full Journey. Internal mock-call counts rarely prove user behavior.
3. Use isolated per-case identities/data, bounded waits, reproducible generators and teardown. Do not clean unrelated user rows or whole environments.
4. Existing correct code may pass first. Missing/new behavior requires a real intended assertion RED; existing regression sensitivity can use controlled fault/old-version negative control. Syntax/import/dependency failure is setup failure, not the target defect. Never alter user production files as a test-quality shortcut; use an authorized isolated copy and restore/verify it.
5. Run the actual relevant command, preserve full output/exit code/case count, failures/skips/retries and source identity. Label observed_expected_failure separately from observed pass; neither is an independent product acceptance verdict.
6. Keep whole-test retry-to-green visible. Assertion polling is different from rerunning a failed test. Do not skip/fixme required cases or relax business assertions to make a report green.
7. If framework/API uncertain, read project tests and installed docs; don't invent matcher/helpers or install a new framework by default. Compile/collection checks alone prove only that scope, not execution.
8. Proposed commands/hashes/time values remain unexecuted until produced by actual tools. TestPack validator verifies existing bytes only; it cannot attest execution or rule adequacy.

Quality handoff checklist: requirement/expected-source match; meaningful failing counterexample; related regression scope; design-only no test-code writes; no production edits; planned applicability/actual selfcheck clearly separate; independent whitebox is able to rerun without author explanation. If important gaps remain, return them with impacted IDs and owners instead of declaring ready.

# P2_3 CLI and historical report compatibility

Construction artifact for independent review. The reviewed root amendment permits this component to consume the exact integrated P2_2 artifact, not parent-task acceptance. Scope is only bin/cli.js, legacy-evidence.js, their two declared test files and this report. Original task/DAG, schemas, locks, adapters, Comet and main checkout are unchanged.

## Changes and real RED/GREEN

1. The public legacy admission helper ignored a protected managed caller and returned acceptance. Its separate protected options argument now refuses requireManaged:true before issuing any dispatch; malformed protected policy is also refused. A test wraps the real launch authority and confirms zero dispatches on refusal. Payload profile/role/trusted/false flags cannot downgrade this choice.
2. Mapping, compatibility admission and entry now explicitly carry component/legacy-report and managedClosureEligible:false. Historical report pass/fail and original capability remain unchanged; the compatibility class name is not a managed credential. A legacy record cannot replace a product capability.
3. delivery-gate remains mechanical file-input coverage only. JSON and text/help declare this scope; JSON exposes closurefalse at the top level as well as in its receipt. A deliberately self-written receipt may satisfy this component check, but no CLI route authenticates managed provenance. Actual managed admission remains the protected P2_2 launcher/collector/current-policy path, with no CLI secret/qualification option.
4. Native parser errors now honor --json: unknown/retired run, stage and source-command entries, incomplete input and self-authorizing flags return structured exit1 and create no control state. parseAsync/exitOverride preserves native help/version and lets action input errors use the same boundary. Existing mechanical pass0 and executed-but-blocked2 remain.
5. Invalid legacy identity time now returns explicit refusal instead of RangeError. All temporary fixture roots have failure cleanup; the new optional-tool case also uses try/finally.

Each behavior was first reproduced through the actual public helper or Node CLI child and then minimally fixed. Exact RED/GREEN log pairs and preserved intermediate authoring errors are listed in verification-results.json. No missing module, unmatched test name, absent tool or authoring script error is counted as behavior RED. Dependencies were reinstalled with npm ci --ignore-scripts using the unchanged lock. Actual Node22.13.1, CLI0.2.4 and dependency versions/help are recorded in evidence/16-tool-probes.json.

## Verification

Final command: node@22.13.1 --test --test-reporter=tap test/delivery-cli.test.js test/delivery-cases/2_3.mjs:25/25, zero skips, exit0. It covers historical report adaptation, missing fields/version rejection, actual audit/CLI0/1/2 and scope/trust limits. The CodeGraph/RTK-off fixture places only failing tripwire executables on PATH: the report component check stays0, missing mandatory product evidence stays2 and no optional tool is invoked. This proves the local mechanical slice only, never full A20 business correctness.

Required full compatibility commands each ran once. Direct node --test --test-reporter=tap test/*.test.js, npm test -- --test-reporter=tap, and check.sh's npm stage each report565 tests:551pass/13fail/1skip, exit1. Full failed-test names and original output remain attached. Failures involve old host C08/B08 assertions, P1_5/method/distribution source-lock drift, Runner/catalog/image-lock and build-plan checks. The single C08 positive skip explicitly reports that isolated OpenSpec1.11 is not installed in this worktree; no global upgrade or writable main .sdd sharing was performed. These failures and missing environmental qualification were not altered or counted as passing. Check.sh passed rules, base skills, Whitebox source selftests and MCR, then stopped at npm; terminal YAML/JSON validation was not reached.

The full regressions preceded final help wording/comment/EOF-only cleanup. Their exact source-byte manifest was not captured at start, so final hashes apply to the final25-test component run, not retroactively to those earlier commands. Every recorded full command retains native version, actual start/end, return code and raw-log SHA; display normalization separately records both hashes. No method-source pyc/untracked pollution was found, and no vendored source was changed.

## Remaining boundary

Repository compatibility is not green. Final independent review and root main integration remain outstanding; real managed Runner/OS/key qualification, real roles, knowledge/CI/platform closure and complete B10/A20 Journey evidence are unverified. F10positive remains deferred/NOT-EXERCISED, no API/service/secret enabled. Current129checks/103scenarios and total130/104 are reference context only, unchanged by this work. There is no new controller, state, queue, retry or business dispatch.

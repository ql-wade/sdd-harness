# Unit / API / service integration authoring

Use repository-native runner/assertion/fixture patterns. Name tests as behavior specifications at public seams, not private-method or object-shape checks. Clarify what each seam catches and misses; reuse approved seams without repeatedly asking.

For a new behavior, write one focused test, observe intended RED, hand the product fix to the authorized implementation role, then rerun plus related regression. Test-authoring cannot edit product just because TDD normally includes GREEN implementation. A pre-existing bug can be correctly delivered as expected RED for independent acceptance to reproduce.

Money/precision rules require actual rounding mode, units, thresholds, sign rules and order of operations. Unknown rules block those expected values; don't copy the current result. Deterministic literal examples and independently worked arithmetic can be oracles.

Integration scope may query a store when storage is the declared public effect/authority. Keep ordinary unit tests off private state; keep independent acceptance probes outside the assertion logic they verify. HTTP validation tests cover method, URL, parameter location, response semantics and prohibited writes, not only status200.

Do not add test-only production APIs or refactor business code for convenience. Report seam/testability limitations to implementation.

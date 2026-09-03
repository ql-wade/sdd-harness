# A-J Full-Dimension Test Strategy

## Contents

1. Fixed dimension meanings
2. Applicability rules
3. Coverage construction
4. Cross-product and pruning

## 1. Fixed Dimension Meanings

Never redefine A-J per task. Record each dimension as `required` or `N/A — repository-derived reason`.

| ID | Dimension | Minimum questions | Typical tests | Closing evidence |
|---|---|---|---|---|
| A | Functional correctness | Does every rule, state transition, boundary, and terminal outcome behave correctly? | Unit/state-machine, property/boundary, regression, positive/negative | RED/GREEN runner reports and terminal assertions |
| B | UI/browser behavior | Can the real user complete the action through the production UI path? | Real-browser interaction, DOM/state, navigation, reload, console/network | Browser trace, DOM assertions, route identity, screenshots where visual |
| C | UX/accessibility/responsive | Can the user understand, operate, recover, and use it across supported inputs/viewports? | Cognition, feedback, keyboard/focus, labels, screen-reader semantics, responsive/long text | Assertions, accessibility report, viewport captures, recovery observations |
| D | Data/state integrity | Are writes, transactions, migrations, caches, indexes, and readbacks correct and consistent? | Persistence/readback, migration/rollback, stale-cache, transaction/partial write, existing data | DB/store/index evidence plus independent read path |
| E | Security/privacy/permissions | Are identity, authorization, tenant boundaries, secrets, and abuse controls correct? | Allow/deny matrix, horizontal/vertical privilege, injection/input limits, secret/PII redaction | Auth decisions, denied side effects, logs/network/screenshots without secrets |
| F | Cross-domain contracts/Journey | Do all producer-consumer edges compose and reach the terminal business oracle? | Consumer/provider, message schema, component integration, real-stack Journey | Per-edge closure plus expected/observed hop equality |
| G | Performance/concurrency/capacity | Do latency, throughput, resource, contention, race, and duplicate behavior meet bounds? | Load/soak, race, duplicate submit/delivery, resource limits, backpressure | Measured thresholds, profiles/metrics, repeatable concurrency reports |
| H | Resilience/recovery/observability | Do timeout, retry, replay, DLQ, degradation, repair, and diagnostics work? | Fault injection, restart windows, retry exhaustion, replay, compensation, alert/log/trace checks | Recovery outcome, bounded convergence, actionable correlated telemetry |
| I | Compatibility/config/deployment | Do versions, schemas, feature flags, dependencies, environments, and rollout/rollback compose? | Mixed version, forward/backward schema, config matrix, artifact provenance, rollback/smoke | Resolved versions, deployed identity, compatibility reports, rollback proof |
| J | Regression/maintainability/testability | Is the change statically healthy, isolated, and protected against future regression? | Full relevant suite, lint/type/static checks, mutation where useful, flake/order isolation | Clean commands, stable tests, no unjustified skips/flakes, scoped diff |

## 2. Applicability Rules

Always assess A, E, and J.

- B and C are required for user-visible UI/browser behavior. They can be N/A for a backend-only task with no affected UI or human interaction.
- D is required for persistence, mutation, migration, cache/index, artifact, reload, or distinct writer/reader behavior.
- F is required when Journey mode is active. It cannot be N/A merely because services have local tests.
- G is required when behavior includes concurrency, duplicate requests/delivery, ordering, performance SLOs, resource limits, queues, locks, or backpressure.
- H is required for asynchronous/distributed work, external dependencies, retries, recovery, compensation, degradation, or operability changes.
- I is required for schema/version/dependency/config/deployment/feature-flag changes or when the verified runtime is not built from the local source tree.

An N/A decision must name the inspected evidence that made the dimension inapplicable. `Not requested`, `out of scope`, `no time`, and `probably unaffected` are not valid reasons.

A `pass` decision freezes unique `required_case_ids`, unique `required_hop_ids`, `required_authority`, and nonempty `test_obligations`. Each obligation is canonical compact JSON with exactly `actual`, `expected`, `operator`, and `test_id`; the test ID is `project::path::test`; the actual field starts with a positive authority root from the table below; and expected is one leaf boolean, number, or schema-qualified enum such as `RecoveryState::completed`. Object/list expected values are split into separate leaf assertions. Operators are `eq|neq|contains|not_contains|matches|lt|lte|gt|gte|exists|absent|count_eq`. The decision then cites Journey-scoped executable evidence whose envelope covers those Cases/Hops, whose authority satisfies the declaration, whose producing command is clean and non-RED, and whose structured payload contains `dimension_results.<ID>: {status: "pass", test_obligations: [the exact frozen canonical strings]}`. Prose, malformed/non-canonical JSON, wrong authority roots, unqualified string enums, object-key wrappers, unsupported operators, missing, extra, or changed assertions fail the dimension even when `status` says pass. A scope plan, source identity, provenance declaration, subagent opinion, failed runner, or clean result for another dimension can support context but cannot prove a passing functional, UX, data, security, performance, resilience, compatibility, or regression outcome.

| Dimension | Allowed `actual` roots |
|---|---|
| `A` | `business`, `terminal`, `readback`, `report` |
| `B` | `browser`, `ux` |
| `C` | `accessibility`, `ux` |
| `D` | `database`, `datastore`, `persistence`, `readback`, `state` |
| `E` | `authentication`, `authorization`, `isolation`, `privacy`, `security` |
| `F` | `contract`, `integration`, `journey` |
| `G` | `concurrency`, `delivery`, `idempotency`, `ordering`, `replay`, `retry` |
| `H` | `compensation`, `dlq`, `recovery`, `resilience`, `timeout` |
| `I` | `compatibility`, `deployment`, `migration`, `version` |
| `J` | `ci`, `regression`, `runner` |

Enum schema names end in `Code|Kind|Level|Mode|Outcome|Phase|Reason|Revision|State|Status|Type|Version`. This positive vocabulary makes a machine-shaped phrase such as `system.behaviorstate = worksasexpected` non-closing without pretending a blacklist proves business meaning.

## 3. Coverage Construction

Build tests from four structures, then map every test to A-J:

1. **State model:** initial, loading/in-progress, success, empty, validation error, authorization failure, dependency failure, long-running, terminal, reload/re-entry.
2. **Journey graph:** nodes, critical edges, branches, merges, async boundaries, terminal oracle, compensation and repair paths; every mandatory path names one closure Case with the full ordered Hop sequence.
3. **Risk model:** likelihood x impact, known defect, money/data/security effects, irreversible side effects, version and operational risk.
4. **Input partitions:** valid, invalid, boundary, missing, duplicate, stale, oversized, hostile, concurrent, and version-skewed.

Minimum path families when applicable:

| Path | Required assertions |
|---|---|
| Happy | Real entry reaches terminal success; persisted/read state survives reload |
| Boundary/failure | Highest-risk rejection or dependency failure is truthful and leaves valid state |
| Permission | Allowed identity succeeds; denied identity creates no forbidden side effect |
| Recovery/compensation | Retry/cancel/rollback/repair is bounded, idempotent, and does not repeat completed work |
| Replay/concurrency | Duplicate/out-of-order/concurrent input produces one valid logical outcome |
| Compatibility | Old/new versions and data interoperate or fail with an explicit safe boundary |

## 4. Cross-Product And Pruning

Useful dimensions for a cross-product include:

```text
persona x ingress x lifecycle state x permission x dependency/version
x failure window x delivery count/order x read path x viewport/input mode
```

Apply these rules:

1. Include the known-defect combination and every critical/changed edge first.
2. Include terminal happy, highest-risk failure/compensation, permission, duplicate/idempotency, and changed compatibility paths.
3. Use pairwise or risk-based pruning only for the remaining combinations.
4. Record every pruned combination and rationale. For a Hop shared by multiple paths, keep separate `(closure_case_id, hop_id)` observations; required risk evidence is the Hop/Case intersection for each path.
5. Re-open a pruned combination when production joins differ in code, config, authority, or artifact version.

Coverage counts are diagnostics, not authority. High line/branch coverage cannot close a missing Journey edge, and one broad E2E cannot replace focused rule/contract tests that localize failures.

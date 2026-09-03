# Journey And UX Few-Shot Examples

These are pre-run derivation examples, not executed evidence. Semantic Journey, Path, Hop, and Case labels are planning aids. Correlation entries describe a propagation strategy, not a captured value. Derive actual states, contracts, timeouts, routes, revisions, commands, and oracles from the repository.

Do not add `run.status: executed`, timestamps, hashes, traces, reports, screenshots, or subagent completions until tools actually produce them. When a Journey runs, translate the selected frame into the schema 3.0 relationships in `journey-contract.md`.

For every planned Case, also derive the repository-native runner project. For CI-required work, freeze each expected repository/SHA/workflow/job/matrix/environment/runner leg and its exact Case set before execution.

Schema-critical planned relationships:

```yaml
required_path:
  path_id: P-RECOVERY
  closure_case_id: C-RECOVERY
  required_hop_ids: [H1, H2, H3] # ordered
  risk_obligations: [retry, idempotency, compensation]
closing_case:
  case_id: C-RECOVERY
  correlation: unique-at-execution
  hop_ids: [H1, H2, H3]          # one Case covers the complete path
  risk_obligations: [retry, idempotency, compensation]
dimension_H:
  status: pass
  required_case_ids: [C-RECOVERY]
  required_hop_ids: [H1, H2, H3]
  required_authority: real-stack
  test_obligations:
    - '{"actual":"compensation.payment_count","expected":1,"operator":"eq","test_id":"journey::tests/checkout_recovery.py::test_single_compensation"}'
dimension_result_H:
  status: pass
  test_obligations:
    - '{"actual":"compensation.payment_count","expected":1,"operator":"eq","test_id":"journey::tests/checkout_recovery.py::test_single_compensation"}' # exact frozen canonical string
hop_H2_contract_subject:
  contract_digest: sha256:<frozen-contract-bytes>
  verification_mode: consumer-provider
  interaction_ids: [inventory-reject-v2]
  provider_state_ids: [payment-captured]
  producer_build_digest: <exact-build>
  consumer_build_digest: <exact-build>
terminal_readback_expectation:
  authority_component: order-read-model
  query_type: http-read-model
  query: GET /orders/<isolated-order-id>
  expected: {state: unable-to-fulfill, net_charge: 0}
  timeout_ms: <repository-derived-bound>
  command_id: CMD-JOURNEY-RECOVERY
  command: <exact frozen Journey command text>
```

These values belong in the frozen plan. After execution, the closing report must be a direct clean command output, carry the Case/Hop scope, and explicitly report the relevant `dimension_results` object with exactly the frozen obligation strings. The readback is output by the frozen command, whose typed `command-report` carries the same Journey, terminal Case, and correlation.

## Exact Output Micro-Few-Shot

This is planning notation for the checkout example, not evidence. It demonstrates the required output granularity. IDs and semantics must be replaced with repository-derived values; unresolved values stay explicit and keep the Journey RED. Never compress the lists below to `all Cases`, `happy/recovery Cases`, `all Hops`, ID ranges, or counts.

| Dimension | Applicability | `required_case_ids` | `required_hop_ids` | Required authority | Literal `test_obligations` |
|---|---|---|---|---|---|
| A | required | `[C-CHECKOUT-HAPPY, C-CHECKOUT-RECOVERY]` | `[H1, H2, H3, H4, H5, H6, H7, H8, H9, H10]` | real-stack + terminal readback | `[{"actual":"business.net_charge","expected":0,"operator":"eq","test_id":"journey::tests/checkout_recovery.py::test_zero_net_charge"}]` |
| B | required | `[C-CHECKOUT-HAPPY, C-CHECKOUT-RECOVERY]` | `[H1, H9, H10]` | browser + accessibility | `[{"actual":"browser.reload_terminal","expected":true,"operator":"eq","test_id":"browser::tests/checkout-recovery.spec.ts::reload_keeps_terminal_state"}]` |
| C | required | `[C-CHECKOUT-HAPPY, C-CHECKOUT-RECOVERY]` | `[H1, H2, H3, H4, H6, H8, H9]` | browser + accessibility | `[{"actual":"accessibility.violation_count","expected":0,"operator":"eq","test_id":"browser::tests/checkout-recovery.spec.ts::has_no_accessibility_violations"}]` |
| D | required | `[C-CHECKOUT-HAPPY, C-CHECKOUT-RECOVERY]` | `[H3, H5, H7, H8, H9]` | independent persistence/readback | `[{"actual":"readback.terminal_authority_count","expected":4,"operator":"eq","test_id":"journey::tests/checkout_recovery.py::test_authorities_converge"}]` |
| E | required | `[C-CHECKOUT-DENY]` | `[H1, H9]` | real-stack security | `[{"actual":"security.foreign_read_allowed","expected":false,"operator":"eq","test_id":"security::tests/checkout_auth.py::test_foreign_order_denied"}]` |
| F | required | `[C-CHECKOUT-HAPPY, C-CHECKOUT-RECOVERY]` | `[H1, H2, H3, H4, H5, H6, H7, H8, H9, H10]` | full Journey | `[{"actual":"journey.closed_hop_count","expected":10,"operator":"eq","test_id":"journey::tests/checkout_recovery.py::test_complete_path"}]` |
| G | required | `[C-CHECKOUT-DUPLICATE]` | `[H3, H4, H5, H6, H7]` | real-stack concurrency | `[{"actual":"delivery.compensation_count","expected":1,"operator":"eq","test_id":"journey::tests/checkout_recovery.py::test_duplicate_rejection_once"}]` |
| H | required | `[C-CHECKOUT-RECOVERY, C-CHECKOUT-RESTART]` | `[H4, H5, H6, H7, H8]` | fault-injected real-stack | `[{"actual":"recovery.terminal_state","expected":"RecoveryState::repaired","operator":"eq","test_id":"journey::tests/checkout_recovery.py::test_restart_converges"}]` |
| I | required | `[C-CHECKOUT-MIXED-VERSION]` | `[H2, H3, H4, H6, H8]` | mixed-version contract + runtime | `[{"actual":"compatibility.rollback_readable","expected":true,"operator":"eq","test_id":"compatibility::tests/checkout_versions.py::test_rollback_readback"}]` |
| J | required | `[C-CHECKOUT-HAPPY, C-CHECKOUT-RECOVERY]` | `[H1, H2, H3, H4, H5, H6, H7, H8, H9, H10]` | RED/GREEN/full runners | `[{"actual":"runner.failed_count","expected":0,"operator":"eq","test_id":"regression::tests/checkout_regression.py::test_clean_gate"}]` |

Terminal authority tuples are emitted without semantic shorthand:

```json
{
  "terminal_authority_tuples": [
    {
      "journey_id": "J-CHECKOUT-REJECT",
      "case_id": "C-CHECKOUT-RECOVERY",
      "hop_ids": ["H1", "H2", "H3", "H4", "H5", "H6", "H7", "H8", "H9", "H10"],
      "correlation": "unresolved - capture the isolated order/payment correlation at execution",
      "authority_component": "payment-ledger",
      "query_type": "ledger-query",
      "query": "GET /ledger/operations/<isolated-payment-id>",
      "expected": {"capture_count": 1, "compensation_count": 1, "net_charge": 0},
      "timeout_ms": "unresolved - derive from repository SLO",
      "command_id": "CMD-CHECKOUT-RECOVERY",
      "command": "unresolved - freeze exact repository-native Journey command",
      "expected_source_revision": "unresolved - inspect deployed payment revision",
      "expected_build_digest": "unresolved - inspect deployed payment build",
      "readback_evidence_id": "unresolved - record only after execution",
      "command_report_evidence_id": "unresolved - record only after execution"
    },
    {
      "journey_id": "J-CHECKOUT-REJECT",
      "case_id": "C-CHECKOUT-RECOVERY",
      "hop_ids": ["H1", "H2", "H3", "H4", "H5", "H6", "H7", "H8", "H9", "H10"],
      "correlation": "unresolved - capture the isolated order/payment correlation at execution",
      "authority_component": "order-read-model",
      "query_type": "http-read-model",
      "query": "GET /orders/<isolated-order-id>",
      "expected": {"state": "unable-to-fulfill"},
      "timeout_ms": "unresolved - derive from repository SLO",
      "command_id": "CMD-CHECKOUT-RECOVERY",
      "command": "unresolved - freeze exact repository-native Journey command",
      "expected_source_revision": "unresolved - inspect deployed read-model revision",
      "expected_build_digest": "unresolved - inspect deployed read-model build",
      "readback_evidence_id": "unresolved - record only after execution",
      "command_report_evidence_id": "unresolved - record only after execution"
    }
  ]
}
```

The browser plan likewise emits `resolved_dependency_graph_digest` over the canonical four-structure graph subject instead of saying only "route scan planned":

```yaml
route_graph_subject:
  scanned_files:
    - {path: tests/checkout-recovery.spec.ts, sha256: unresolved-before-file-hash}
    - {path: tests/fixtures/checkout.ts, sha256: unresolved-before-file-hash}
    - {path: package.json, sha256: unresolved-before-file-hash}
  dependency_edges:
    - {from: tests/checkout-recovery.spec.ts, to: tests/fixtures/checkout.ts}
  entrypoints: [tests/checkout-recovery.spec.ts]
  executed_spec_paths: [tests/checkout-recovery.spec.ts]
  resolved_dependency_graph_digest: unresolved - compute canonical SHA-256 after exact files and edges are frozen
```

Local relative imports must resolve to scanned files. A bare package is allowed only when the scanned `package.json` declares it as a non-workspace dependency and no package discovered through top-level `workspaces` owns that name. The bundled Node/Acorn AST parser extracts static imports/exports, comment-separated forms, literal `import()` with options, and direct static require-compatible calls. Loader aliases/sequences/tags, `createRequire`, workspace protocols, plain-version workspace dependencies, computed/indirect loaders, dynamic code, and parse failures stay RED. The same AST rejects dot/bracket/optional/bound route or fulfill use and computed service-worker/proxy config. Every regular file below each frozen root is scanned. Browser semantics use canonical compact JSON strings with leaf-scalar expected values, for example:

```text
{"action":"click","target":"[data-testid=checkout]","value":null}
{"expected":"OrderState::unable-to-fulfill","operator":"eq","selector":"[data-testid=order-state]"}
{"body_assertion":{"actual":"response.net_charge","expected":0,"operator":"eq"},"method":"GET","status":200,"url":"/api/orders/<isolated-order-id>"}
```

Because command text, source revisions, timeouts, file hashes, and graph digest are unresolved in this pre-repository example, its verdict is RED. The shape is complete; the evidence is deliberately absent.

## 1. Local Slice

### Input

A pure parser must reject duplicate keys and preserve both source locations. No service, persistence, authorization, async, or browser behavior changes.

### Planned frame

```markdown
Mode: Slice
Intent: Duplicate keys fail with the contract-defined diagnostic and no AST.
Mechanism: tokenizer -> parser duplicate-key rule -> diagnostic.
Planned RED: focused parser test fails on the missing/incorrect diagnostic.
Planned GREEN: same test passes, then parser regression and static suites pass.
Terminal oracle: returned diagnostic contains both repository-defined locations.
```

Representative Cases:

- duplicate in one scope;
- nested names valid or invalid according to the grammar;
- valid input preserves the prior AST;
- hostile depth/size boundary when the parser exposes one.

A-J: A, E, and J remain required. I is required if the diagnostic is public. B-D and F-H may be N/A only with repository-derived evidence. Do not manufacture services, hops, browser proof, or a Journey ledger for genuinely in-process behavior.

## 2. Agent Publication And Runtime Discovery

### Input

An Operator publishes an Agent revision. Admin must show truthful state, and Consumer chat must invoke the exact published revision.

### Planned Journey

```markdown
Journey: J-AGENT-PUBLISH
Business outcome: Consumer chat executes the exact revision accepted for publication.
Entry: Operator publish action in the real Builder route.
Start state: a validated draft; runtime discovery still resolves the prior revision.
Terminal oracle: runtime loads the new artifact hash and Consumer chat exhibits its behavior; reload agrees.
Correlation strategy: publication identity plus trace context propagated through materialization, discovery, and invocation.
```

| Hop | Producer -> consumer | Contract and authority to derive |
|---|---|---|
| H1 | Browser -> publish API | route/auth/body/error contract; browser network plus API observation |
| H2 | Publish API -> materializer | job/event version, revision, idempotency key; enqueue plus worker receipt |
| H3 | Materializer -> artifact store | artifact key/compiler version/hash; stored bytes plus independent load |
| H4 | Materializer -> discovery consumer | event schema/key/order; producer, broker, consumer, contract proof |
| H5 | Discovery consumer -> cache/index | upsert/invalidation/convergence; write plus discovery readback |
| H6 | Consumer chat -> runtime | tenant/agent/revision/hash resolution; runtime and executor identity |
| H7 | Runtime -> browser | stream/result/error contract; terminal DOM and reload |

Planned mandatory Cases:

- happy publication reaches Consumer chat;
- stale discovery converges without version regression;
- materialization failure never appears terminal;
- duplicate job/event is idempotent;
- cross-tenant discovery and invocation are denied;
- mixed artifact/schema versions follow the repository compatibility contract.

Make the shared-hop closure explicit rather than treating the Case list as set coverage:

```yaml
required_paths:
  - {path_id: P-PUBLISH-HAPPY, closure_case_id: C-PUBLISH-HAPPY, required_hop_ids: [H1,H2,H3,H4,H5,H6,H7], risk_obligations: []}
  - {path_id: P-PUBLISH-ASYNC-RECOVERY, closure_case_id: C-PUBLISH-RETRY, required_hop_ids: [H1,H2,H3,H4,H5,H6,H7], risk_obligations: [retry,idempotency]}
observed_hops_for_shared_H4:
  - {case_id: C-PUBLISH-HAPPY, hop_id: H4, risk_evidence: {}}
  - {case_id: C-PUBLISH-RETRY, hop_id: H4, risk_evidence: {retry: [EV-RETRY], idempotency: [EV-IDEMPOTENCY]}}
```

Both `(C-PUBLISH-HAPPY,H4)` and `(C-PUBLISH-RETRY,H4)` need independent producer/wire/consumer observations. For each composite, required risk evidence is `H4.risk_obligations` intersected with that closure Case's risks, which include its path risks. The happy observation cannot donate runtime evidence to the async recovery observation.

Browser applicability is required. Freeze `expected_actions`, `expected_dom_assertions`, `expected_network_observations`, and `route_scan_entrypoints`. Plan a browser report for the real route and a separate transitive route-interception graph whose digest covers `scanned_files`, `dependency_edges`, `entrypoints`, and `executed_spec_paths`; every fixture/helper is reachable from a frozen executed entrypoint. An Admin toast, list row, HTTP 200, mocked chat, or materializer unit test is intermediate evidence only.

## 3. HITL Approval And Async Continuation

### Input

An Operator approves a tool action in test chat. Approval must continue the same turn exactly once, persist the completed answer, and survive reload.

### Planned Journey

```markdown
Journey: J-HITL-CONTINUE
Business outcome: One approved action yields one durable completed answer.
Entry: Operator activates the approval control.
Start state: pending approval bound to session, reply, action, and nonce.
Terminal oracle: session readback contains one completed answer, reload renders it, and the handled approval is absent.
Correlation strategy: session/reply/action identities plus trace and event context.
```

| Hop | Producer -> consumer | Main obligations |
|---|---|---|
| H1 | Browser -> approval API | auth, nonce, approve/reject semantics, duplicate submit |
| H2 | Approval API -> continuation event | schema/version, durable publish/outbox, idempotency key |
| H3 | Broker -> continuation consumer | retry, duplicate, ordering, timeout, replay, DLQ |
| H4 | Consumer -> tool/model execution | one logical side effect under redelivery |
| H5 | Execution -> session store | valid terminal transition and durable answer |
| H6 | Session read API -> browser | authoritative readback, terminal DOM, reload |

Planned mandatory Cases:

- approve -> continuing -> completed -> reload;
- reject, expired, or foreign-user approval causes no continuation;
- double click and duplicate event produce one logical continuation;
- failure before the side effect retries safely;
- failure after the side effect but before acknowledgement does not repeat it;
- timeout/DLQ exposes truthful recovery or repair;
- reload during continuation reflects server truth.

Map each async risk to a passing Case that includes the affected hop. `Approved` is an intermediate state. UX assertions cover immediate feedback, duplicate-action disabling, keyboard/focus behavior, outcome-specific recovery, responsive layouts, and session/input preservation; runtime evidence must separately prove event handling, idempotency, persistence, and readback.

## 4. Checkout Saga And Compensation

### Input

Payment succeeds, Inventory rejects reservation, and event delivery can repeat. The customer must not remain charged.

### Planned Journey

```markdown
Journey: J-CHECKOUT-REJECT
Business outcome: An unfulfillable order converges to a truthful state with no net charge or stock reservation.
Entry: Customer submits checkout in the browser.
Terminal oracle: payment authority shows one effective compensation, inventory has no reservation, order/read model is terminally unable to fulfill, and reload renders it.
Correlation strategy: order and payment operation identities plus trace/event context.
```

Planned mandatory chain:

```text
Browser -> Order API -> Payment -> Inventory -> rejection event
-> Saga/compensator -> Payment compensation -> authoritative order
-> read-model consumer -> status API -> terminal DOM/reload
```

Planned mandatory Cases:

- successful reservation and terminal order;
- payment success plus inventory rejection plus compensation;
- duplicate rejection and compensation delivery;
- restart after side effect and before acknowledgement;
- compensation failure through retry exhaustion and repair;
- unauthorized order-status read creates no leakage or mutation.

Contracts must cover payment/inventory idempotency, event schema/version/key, state transitions, and compensation semantics. Use repository SLO/configuration for convergence. `Order submitted`, one refund request, or a producer-owned order object is not the terminal authority.

## 5. Backend Pipeline Without A Browser

### Input

A scheduled importer reads a feed, normalizes records, writes canonical storage, updates an index, and publishes completion for reporting. There is no UI route.

### Planned Journey

```markdown
Journey: J-IMPORT-REPORT
Business outcome: One source batch becomes one canonical, searchable, reportable batch.
Entry: scheduler/import command.
Terminal oracle: reporting consumes completion and independently reads the expected canonical totals for the same batch.
Correlation strategy: isolated batch identity plus trace context.
```

Planned mandatory chain:

```text
Scheduler -> source fetch -> normalizer -> canonical store
-> index updater -> completion event -> reporting consumer -> report readback
```

Planned mandatory Cases:

- valid batch reaches canonical, index, event, and report authorities;
- malformed record follows the repository rejection/quarantine contract;
- partial source failure leaves a valid recoverable state;
- duplicate/replayed batch remains one logical batch;
- index lag converges within the configured bound;
- event redelivery and consumer restart remain idempotent;
- schema-version skew and rollback/repair behave compatibly;
- resource/capacity bounds fail predictably.

Browser is planned as not required only after repository inspection proves no browser ingress or affected UI route; preserve that applicability evidence in the frozen scope. D, F, G, and H are required here, and I is required for schema/version behavior. A successful scheduler exit or writer row count remains intermediate evidence.

## 6. Anti-Few-Shots: These Must Fail

The snippets below are invalid relationship notation, not records of real execution.

### Scope frozen after execution began

```text
PLAN_FROZEN_AT > EARLIEST_COMMAND_STARTED_AT
```

Must fail: both the declared freeze time and the `scope-plan` capture must be no later than the earliest command start, and the plan digest must equal that file's real SHA-256. Editing a Journey after the freeze also makes the embedded projection differ.

### Fake RED or dirty GREEN

```text
RED_COMMAND = {phase: red, expected: fail, exit_code: 0}
GREEN_RUNNER = {passed: 1, failed: 0, skipped: 0, retried: 1, flaky: 0}
```

Must fail: expected-fail RED exits nonzero and has a runner with a real failure. GREEN requires a passing clean runner with zero failures, skips, retries, and flakes. A pre-fix RED and GREEN cannot carry identical source fingerprint maps.

### Orphan runner output

```text
CMD_GREEN.outputs = [EV_SOMETHING_ELSE]
RR_GREEN.command_id = CMD_GREEN
RR_GREEN.evidence = [EV_GREEN_RUNNER]
```

Must fail: `EV_GREEN_RUNNER` is not a declared output of `CMD_GREEN`, even if its JSON says it came from that command.

### Mismatched source/build envelope

```text
run.sources[PRODUCER].revision = REV_A
EV_RUNTIME.source_revisions[PRODUCER] = REV_B
source-identity.build_digest = BUILD_B
run.sources[PRODUCER].build_digest = BUILD_A
```

Must fail: catalog revisions match `run.sources`, and the typed source-identity payload exactly matches component, repo, revision, dirty fingerprint, and build digest. A first-party component without passing lifecycle evidence also fails.

### Untyped or fabricated artifact

```text
catalog says EV_RUNNER is runner-report
EV_RUNNER file is prose, has the wrong plan_digest, or omits its declared correlation
```

Must fail: structured evidence is parseable JSON with an exact typed envelope; catalog metadata cannot authenticate incompatible bytes. Missing files, stale hashes, escaping paths, and unused catalog entries also fail.

### One file impersonates four hop authorities

```json
{
  "producer_evidence":["EV_ONE"],
  "wire_evidence":["EV_ONE"],
  "consumer_evidence":["EV_ONE"],
  "contract_evidence":["EV_ONE"]
}
```

Must fail: producer, wire, consumer, and contract categories are independent by ID and file hash. Contract evidence must also come from a contract command and match the exact edge.

If either endpoint is first-party, contract evidence is source-bound to that component through the artifact's `source_revisions`; matching build text inside an otherwise unbound report is insufficient.

### Risk evidence without a passing risk Case

```text
HOP_1.risk_obligations = [retry]
OBSERVED_HOP_1.risk_evidence.retry = [EV_RETRY]
PASSING_CASE_FOR_HOP_1.risk_obligations = []
```

Must fail: each expected risk is named by a passing Case containing that hop, and mandatory path risks are covered by passing Cases. The runtime risk artifact also carries that Case correlation and Journey scope.

### Complete path assembled from unrelated half-Cases

```text
P.closure_case_id = C1
P.required_hop_ids = [H1, H2]
C1.correlation = CORR_1; C1.hop_ids = [H1]
C2.correlation = CORR_2; C2.hop_ids = [H2]
observed_hops = [(C1,H1), (C2,H2)]
```

Must fail: set-union coverage is not traversal. The named closure Case and one correlation must contain the complete ordered path and all path risks, and every required Hop needs an observation keyed by `(closure_case_id, hop_id)`.

### RED runner labels every A-J dimension green

```text
dimension_G.status = pass
dimension_G.evidence = [EV_RED_RUNNER]
dimension_G.test_obligations = [bounded concurrency, no duplicate side effect]
EV_RED_RUNNER.dimension_results.G = {status: pass, test_obligations: [generic concurrency check]}
```

Must fail: a dimension PASS freezes Case/Hop/authority/test obligations and requires a matching clean non-RED command output whose obligation strings exactly equal the frozen list. A generic label inside failed RED bytes has no closing authority.

### Evidence relabeled to another Case or Hop

```text
CASE_B.case_results.evidence = [EV_CASE_A]
HOP_2.producer_evidence = [EV_HOP_1]
```

Must fail: Case evidence envelopes explicitly contain the selected Case ID, and hop evidence explicitly contains the selected Case and Hop IDs. Matching run/Journey/correlation text does not permit relabeling.

### Reused Case correlation or runtime evidence

```text
JOURNEY_A.CASE_1.correlation = CORR_X
JOURNEY_B.CASE_2.correlation = CORR_X
JOURNEY_A and JOURNEY_B both reference EV_RUNTIME_X
```

Must fail: Case correlations are unique, including across Journeys, and every runtime artifact has exact singleton Journey ownership. A ghost/superset Journey ID fails even if no second Journey references the artifact.

### Screenshot-only or intercepted browser closure

```text
browser.required = true
report_evidence = [EV_SCREENSHOT]
route_scan_evidence = []
```

Must fail: browser closure needs a command-produced typed `browser-report` whose actions/DOM/network lists exactly match frozen canonical JSON assertions, plus an independent command-produced `route-scan-report`. Prose, object/list expected wrappers, unqualified string enums, and wrong network authority roots are invalid. The graph digest covers normalized `scanned_files`, dependency edges, frozen entrypoints, and executed specs; the AST scanner extracts comment-separated and import-options module requests, fails closed on loader aliases and dynamic code, detects bracket/optional/bound interception and computed service-worker/proxy keys, requires scanned package-manifest proof for bare external imports, rejects unresolved aliases/workspaces, and makes every fixture/helper reachable from an entrypoint. Paths such as `not-tests` do not cover the `tests` root.

### CI success presented as attestation

```text
run.ci.evidence = [EV_CI_SUCCESS]
run.provenance.level = ci-attested
run.provenance.evidence = [EV_PROVENANCE_REPORT]
```

Must fail: the local validator accepts only `provenance.level: local-observed`; self-authored JSON cannot upgrade its own trust tier. Required CI evidence separately matches every frozen repo/SHA/workflow/job/matrix/runner/Case expectation with clean counts. When signed provenance is required, run a trusted external verifier and report that result outside `STRUCTURE_PASS`.

### Semantically false terminal readback

```text
terminal_oracle.claim = "one completed answer"
readback_expectation.command_id = CMD-JOURNEY
readback_expectation.command = "run approval Journey"
readback-report is moved to CMD-UNRELATED
readback-report.status = fail
readback-report.claim = "approval accepted"
readback-report.expected != readback-report.observed
```

Must fail: every terminal authority component has a frozen query type, exact query, expected value, timeout, `command_id`, and command text. Its passing readback report must be a direct output of that exact command, whose typed command report carries the same Journey, terminal Case, and correlation; arbitrary equal expected/observed values do not prove the business oracle.

### Green CI badge with an unfrozen leg

```text
frozen expectation = repo A / SHA X / node 22 / linux / Cases C1,C2
ci-report.required_case_ids = [C1,C1,C2]
ci-report = repo A / SHA Y / node 20 / linux / Case C1
matrix.continue_on_error = true
```

Must fail: duplicate `required_case_ids`, identity, Journey/Case scope, or Case-set drift; omitted legs; nested allowed failures; skips; cancellation; reruns; retries; flakes; or nonzero report counts cannot close CI. `case_results[]` contains exactly one clean row per unique required Case, and top-level counts equal the row sums.

### Partial redaction or shared subagent identity

```text
redaction-report.scanned_evidence_ids omits EV_TRACE
Journey Mapper.agent_id = AGENT_ONE
Test/Contract Designer.agent_id = AGENT_ONE
Grill Reviewer.agent_id = AGENT_ONE
```

Must fail: redaction covers every other artifact with no findings, and the validator independently blocks recognizable secrets in non-screenshot text. Each Journey also needs three distinct, completed, source-bound agent IDs with independent reports scoped to that Journey.

# Journey Contract And Evidence Model (Schema 3.0)

Schema 3.0 is a closure ledger for evidence that was actually produced. It is not a planning template and it has no schema-only success mode. Before execution, describe evidence as `planned` outside the closure ledger; placeholder values are rejected. Never invent run IDs, timestamps, hashes, commands, traces, browser sessions, or subagent activity.

## 1. Closure Sequence

Use this order:

1. Inspect repositories and derive Journeys, mandatory paths, Cases, hops, risks, terminal authorities, A-J requirements, browser applicability, and CI applicability.
2. Serialize that scope into one `scope-plan` artifact, freeze it, hash its actual bytes, and do this before the earliest command starts.
3. Begin one bounded run, capture exact source identities, and establish lifecycle evidence for every first-party component.
4. Execute an honest RED, then GREEN, contract, Journey, browser, route-scan, lifecycle, security, and CI commands as applicable.
5. Link each command to its typed output files and each runner report back to the command that produced it.
6. Bind runtime evidence to one passing Case, its unique correlation value, its Journey, its hops, and the exact source revisions.
7. Complete independent subagent review, provenance, CI applicability, and redaction gates.
8. Treat validator exit zero as a required structural gate, then close only after the executing agent independently confirms that the observed commands, runtime semantics, and any required signed provenance are genuine.

Changing the declared Journey after commands have started is not a plan edit. Freeze a new scope and execute a new run.

## 2. Freeze Scope Before Commands

`plan` must contain:

```text
plan_id        non-placeholder identifier
status         frozen
frozen_at      timezone-aware ISO-8601
digest         SHA-256 of the exact scope-plan file bytes
evidence       exactly one evidence ID typed scope-plan
```

`plan.frozen_at`, the scope artifact's `captured_at`, and the scope file's filesystem modification time must all be no later than the earliest `run.commands[].started_at`. The artifact embeds the same `plan_id` and exact `frozen_at` string.

The validator treats the earliest command as the execution boundary. The run window may begin before the freeze so the scope artifact can still have a capture time inside that window.

The embedded `scope` is an exact, sorted projection of the current declarations, not a prose summary:

| Scope level | Frozen fields |
|---|---|
| Root | all `requirement_ids`; frozen service topology; all Journeys |
| Service topology | component, lifecycle mode, start/deployment identity, endpoint, auth fixture |
| Journey | ID, requirement IDs, business outcome, entry kind/description, first-party components, terminal claim/Case/readback expectations, full A-J applicability, declared doubles, browser requirement, explicit CI requirement and exact CI expectations |
| A-J PASS | required Case IDs, Hop IDs, authority, and concrete test obligations; N/A reason otherwise |
| Mandatory path | ID, type, `closure_case_id`, ordered required hop IDs, risk obligations |
| Mandatory hop | producer/consumer and scopes, transport, contract/version/digest, verification mode, interaction/provider-state IDs, producer/consumer build identities, consistency, producer/wire/consumer oracles, required authority, risks, allowed external doubles |
| Case | ID, path, correlation, preconditions, action, terminal oracle, runner project, required authority, hop IDs, risks, allowed external doubles |
| CI expectation | ID, source-bound repository/SHA, workflow/job, exact matrix leg, environment, runner OS/labels, required Case IDs |

The validator rebuilds this projection from `run.services` and `journeys[]` and compares it with `scope-plan.scope`. Changing the business outcome or entry, a path's closure Case, removing/reordering a hop, changing a service endpoint/environment, weakening an authority, changing an A-J obligation or N/A reason, changing a test double, changing terminal readback command semantics, changing frozen browser actions/assertions/entrypoints or CI applicability, or changing a Case therefore invalidates the frozen plan even if the ledger still looks internally plausible.

Human-readable plans and completion reports preserve the same exact projection. Every required A-J row enumerates literal `required_case_ids` and `required_hop_ids`; aliases such as `all Cases`, `happy/recovery Cases`, `all Hops`, ranges, and counts are invalid because they cannot be compared mechanically with the frozen subject. Every terminal authority row independently repeats literal Journey ID, Case ID, full Hop list, correlation, command, authority/query/expected/timeout, and source/build fields; `same`, `same Case`, `same exact value`, and `same literal list` are invalid contextual aliases. Every browser Journey prints the canonical four-structure route-graph subject plus its digest and literally enumerates complete static module extraction, unconditional loader/createRequire/dynamic-code rejection, all route/fulfill variants, service-worker/proxy composition, reachability, and every frozen spec/config/fixture/helper/setup/local-workspace root. Unknown values are explicit blockers, never shorthand.

## 3. Run, Source, Build, And Lifecycle Identity

### Run header

`run.status` must be `executed`. `started_at` and `completed_at` require timezone offsets, completion cannot be in the future, and one run cannot exceed 24 hours. `environment` names the environment that actually produced the evidence.

### Source and build binding

Each `run.sources[]` item declares:

```text
component, repo, revision, dirty_fingerprint, build_digest, identity_evidence
```

Its `identity_evidence` must:

- be typed `source-identity`;
- be a declared output of a `kind: source-identity` command;
- be source-bound to that exact component;
- embed the same component, repo, revision, dirty fingerprint, and build digest.

Every catalog artifact has a non-empty `source_revisions` map whose revisions match `run.sources`. This is the artifact's direct source binding. Build and dirty-state identity are anchored through the matching source record and its `source-identity` output. Commands separately record `source_revisions` and a non-empty `source_fingerprints` map. For a `pre-fix` RED, the RED and GREEN fingerprint maps must differ.

Record the observed fingerprints; do not treat the validator as a fingerprint collector. It verifies revision maps and the pre-fix RED/GREEN distinction, while the source-identity artifact remains the authority for the declared build and dirty state.

### Service lifecycle

Every `first_party_components` member must appear in both `run.sources` and `run.services`. A service record contains:

```text
component, mode, start_or_deployment, endpoint, auth_fixture,
readiness_evidence, lifecycle_evidence, log_evidence
```

`mode` is `local-process` or `shared-deployment`. All lifecycle and log evidence must be outputs of `kind: lifecycle` commands and source-bound to the service component. Readiness/lifecycle files are typed `lifecycle-report`; logs are `raw-log` or `trace`.

A lifecycle report must match the component and mode, set `ready` and `remained_ready` to `true`, and use:

- `teardown_status: pass` for `local-process`;
- `teardown_status: not_applicable` for `shared-deployment`.

A fixed sleep, an unbound health check, or a source record without lifecycle evidence cannot close a first-party component.

## 4. Typed Artifact Envelopes

Evidence references are catalog IDs, never file paths. Supported structured types are:

```text
scope-plan, command-report, runner-report, source-identity,
lifecycle-report, contract-report, browser-report, route-scan-report,
subagent-report, redaction-report, ci-report, provenance-report,
readback-report
```

Supported raw types are:

```text
raw-log, trace, dom-snapshot, accessibility-report, screenshot
```

Every `evidence_catalog.<ID>` entry declares:

```json
{
  "artifact_type": "<supported type>",
  "path": "artifacts/<relative unique path>",
  "sha256": "<lowercase SHA-256 of the existing file>",
  "run_id": "<exact run.run_id>",
  "captured_at": "<timezone-aware time inside the run>",
  "source_revisions": {"<component>": "<exact run.sources revision>"},
  "journey_ids": [],
  "case_ids": [],
  "hop_ids": [],
  "correlation_values": []
}
```

The angle-bracket values above are notation, not submit-ready evidence.

Every structured file is a JSON object and embeds an exact envelope matching its catalog entry:

```json
{
  "artifact_type": "<same type>",
  "run_id": "<same run>",
  "plan_digest": "<exact plan.digest>",
  "source_revisions": {"<component>": "<same revision>"},
  "journey_ids": [],
  "case_ids": [],
  "hop_ids": [],
  "correlation_values": []
}
```

`scope-plan` is the one structured exception: it omits `plan_digest` because its own bytes define that digest. For all non-screenshot files, the raw bytes must contain `run.run_id`; they must also contain every correlation declared in the catalog. Screenshots retain catalog hash/time/source metadata, but their pixels are not parsed as an envelope and they never suffice on their own.

Strict validation also rejects absolute or escaping paths, duplicate target paths, byte-identical artifacts registered under independent IDs, missing files, hash mismatch, file modification times outside the run window (with five seconds of tolerance), malformed structured JSON, unknown types, absent references, and unused catalog entries.

## 5. Command, Output, And Runner Linkage

Each command has a typed `command-report` in `command.evidence`. The structured report must exactly mirror the ledger's command ID, phase, kind, command text, expected outcome, exit code, timestamps, test identity, source revisions, source fingerprints, and outputs.

The critical chain is:

```text
run.commands[CMD].outputs contains EV_RUNNER
        -> run.runner_reports[RR].command_id == CMD
        -> runner_reports[RR].evidence contains EV_RUNNER
        -> EV_RUNNER is typed runner-report
        -> embedded runner-report fields exactly match the ledger
```

Downstream artifacts have equivalent producer rules: source identities come from source-identity command outputs; lifecycle evidence from lifecycle outputs; contract reports from exactly one passing contract command whose source map covers every first-party endpoint; browser reports from browser outputs; route scans from route-interception-scan outputs; CI reports from CI outputs; and redaction reports from redaction outputs.

### RED and GREEN

| Phase | Command semantics | Runner semantics |
|---|---|---|
| RED | `phase: red`, `expected: fail`, nonzero `exit_code`, stable `test_identity` | same command/phase, `failed > 0`; the failure is real |
| GREEN | `phase: green`, `expected: pass`, `exit_code: 0`, same `test_identity` | `passed > 0`; `failed`, `skipped`, `retried`, and `flaky` are all zero |

Only RED may expect failure. RED must finish before GREEN starts. `tdd.red.evidence` and `tdd.green.evidence` must use different IDs and different file hashes; at least one item in each set carries the selected Case correlation. `pre-fix`, `mutation`, and `fault-injection` are accepted RED methods. Mutation or fault injection also requires control evidence.

Non-RED closing runner reports require at least one pass and zero failures, skips, retries, and flakes. Retrying until green is non-closing.

Every structured result used to close an A-J dimension embeds this exact semantic shape:

```json
{"dimension_results":{"<ID>":{"status":"pass","test_obligations":["{\"actual\":\"report.logical_count\",\"expected\":1,\"operator\":\"eq\",\"test_id\":\"integration::tests/report_journey.py::test_batch_once\"}"]}}}
```

Each `test_obligations` item is a canonical compact JSON string with exactly `actual`, `expected`, `operator`, and `test_id`. `test_id` has the shape `project::path::test`. `actual` must use the dimension's positive authority root: A `business|terminal|readback|report`; B `browser|ux`; C `accessibility|ux`; D `database|datastore|persistence|readback|state`; E `authentication|authorization|isolation|privacy|security`; F `contract|integration|journey`; G `concurrency|delivery|idempotency|ordering|replay|retry`; H `compensation|dlq|recovery|resilience|timeout`; I `compatibility|deployment|migration|version`; J `ci|regression|runner`. Operators are exactly `eq|neq|contains|not_contains|matches|lt|lte|gt|gte|exists|absent|count_eq`. `expected` is one leaf scalar: boolean, number, or a schema-qualified token such as `RecoveryState::completed`; the schema ends in `Code|Kind|Level|Mode|Outcome|Phase|Reason|Revision|State|Status|Type|Version`. Object/list expected values are invalid and must be split into separate leaf assertions. The set must exactly equal the frozen ledger declaration. Prose, malformed/non-canonical JSON, the wrong authority root, an unqualified enum string, an object-key wrapper, an omitted assertion, or an extra self-declared assertion fails. The artifact is a direct output/evidence of a zero-exit non-RED command, and its Case/Hop scope covers the frozen dimension mapping. A RED runner, a clean runner for another dimension, or an unscoped report cannot close a dimension.

## 6. Cases, Correlation, Risks, And Hops

### Paths and Cases

Keep definitions separate from observations:

```text
required_paths[]  path_id, type, mandatory, closure_case_id, ordered required hops, risks
cases[]           Case ID, path, correlation, setup/action/oracle, runner project,
                  required authority, hops, risks, allowed external doubles
case_results[]    Case ID, pass result, runner report IDs, evidence IDs
```

Do not put `result` or `evidence` in `cases[]`. Every Case needs exactly one result for closure, and every result must be `pass`. Every mandatory path names exactly one `closure_case_id`; that Case belongs to the same path, passes, and contains the path's full ordered Hop sequence and every path risk under one unique correlation. Multiple half-path Cases cannot be unioned into a passing path, and another Case that happened to traverse the same Hop cannot replace the closure Case.

Every mandatory path risk is assigned to at least one required Hop's `risk_obligations`. The observation for that Hop and closure Case carries the matching risk evidence; declaring the risk only on the path or Case is non-closing.

Each Case correlation is unique within its Journey, and correlation values cannot be reused by another Journey. Case-result runtime evidence must carry that Case correlation, exact singleton Journey scope, and exact `case_ids` membership. Every referenced runner must include the Journey and Case; the selected runners collectively cover all Case hops and supply authority sufficient for the Case. The final aggregation gate requires exact singleton Journey ownership for every TDD, Case, Hop, terminal, browser, and runner runtime artifact. Runtime artifacts used by one Journey cannot be reused to close another, and a ghost/superset Journey envelope fails even when no second Journey references it.

Correlation text is not a substitute for envelope ownership. TDD, Case-result, terminal, and browser runtime artifacts explicitly list the Case ID. Hop runtime and risk artifacts explicitly list both the Case ID and Hop ID. Relabeling evidence from another Case or Hop fails even when its correlation happens to appear in the file.

### Expected and observed hops

Every first-party component must occur in the expected hop graph. A mandatory hop includes a first-party endpoint. Every mandatory non-`module` hop sets `contract_required: true`.

`observed_hops[]` is keyed by the composite `(case_id, hop_id)`, not by `hop_id` alone. For every mandatory path, every Hop in its ordered sequence has one observation bound to that path's `closure_case_id`. Thus a Hop shared by happy and recovery paths has separate observations for both closure Cases. Each observation supplies four independent categories:

Its producer/wire/consumer runtime artifacts have exact singleton Journey, Case, Hop, and correlation envelopes. Per-Hop authority and first-party source binding are evaluated only from the `runner_report_ids` explicitly selected by that Case's `case_results[]` row. A globally declared or command-produced runner that the Case did not select cannot donate authority to an observed Hop.

```text
producer_evidence  proof at the producer authority
wire_evidence      proof on the wire, broker, store, index, or browser network
consumer_evidence  proof at the consumer authority
contract_evidence  typed contract-report when contract_required is true
```

Duplicate composite keys are forbidden. The categories cannot reuse an evidence ID or byte-identical file. Producer and consumer runtime evidence must be source-bound when that endpoint is first-party. All producer/wire/consumer runtime evidence has exact singleton ownership for the closure Case correlation, Case ID, and Hop ID; a superset envelope is invalid. Contract evidence carries the Journey ID and exact Hop ID. Runner authority is checked independently for every observed Hop against that Hop's frozen `required_authority`.

A `contract-report` must be output by exactly one passing `kind: contract` command and report `status: pass`. The command and artifact source maps both include every first-party endpoint. Its producer, consumer, contract/version/digest, verification mode, interaction IDs, provider-state IDs, and producer/consumer build identities exactly equal the frozen Hop subject. For every first-party endpoint, contract evidence is source-bound through the artifact's `source_revisions`, and its build equals `run.sources`; external identities are frozen strings. Provider-state verification is true, pending/WIP are false, and deployment compatibility passes. It is complementary contract authority and is forbidden as runtime wire evidence.

Runner authority is checked per Case and mandatory hop. The ordered ladder is:

```text
unit < component < integration < real-stack
```

`contract` and `browser/ux` are separate exact authorities, not positions on that ladder.

Every closing runner is scoped to exactly one declared Journey. Its Case/Hop IDs must belong to that Journey, its project must match the frozen Case, and runner source revisions must include every first-party endpoint whose hop authority it closes. Runner IDs and runtime artifacts cannot be reused to close another Journey.

### Risk-to-passing-Case mapping

For one composite observation, required `risk_evidence` is the intersection of the expected Hop's risks and its bound Case's risks. For a path-closing observation, that bound Case is the path's closure Case and already contains every path risk. A shared Hop therefore can require different risk evidence in happy and async closure Cases; evidence from one composite cannot be borrowed by the other. Each required risk artifact carries that Case correlation, Journey, Case, and Hop scope.

Every `message/event` hop declares at least:

```text
retry, duplicate, idempotency, ordering, timeout, replay, dlq
```

Add `compensation` and `compatibility` when repository behavior makes them applicable. Evidence attached only to the hop, without a passing Case that names the risk, fails closure.

### Terminal authority

The terminal oracle binds to a passing Case and has independent `surface_evidence` and `authority_evidence`; IDs and bytes must differ. Both sets have exact Case/correlation ownership and carry the Journey scope. Before execution it freezes exactly one `readback_expectations[]` item per first-party authority component: component, supported query type, exact query, expected semantic value, positive timeout, `command_id`, and exact `command` text. The matching `readback-report` artifact itself is source-bound to that named authority component and is a direct output of that exact passing `journey` or `browser` command, reports `status: pass`, matches the terminal claim and every frozen field, observes the frozen value, and converges within the timeout. The command's typed `command-report` evidence must itself be scoped exactly to the same Journey, terminal Case, and correlation; moving the output to another command or editing the command text fails.

An HTTP status, producer return value, queue publication, toast, or intermediate state is not terminal authority unless the frozen business claim says it is.

## 7. Browser, Trust, Redaction, And Subagents

### Browser and route scan

A browser entry forces `browser.required: true`. A non-browser Journey still declares `browser.required: false`, a repository-derived reason, and applicability evidence typed `scope-plan`, `source-identity`, or `provenance-report`.

Required browser closure binds to a passing Case and has two independent outputs:

- `report_evidence`: `browser-report` output by a `kind: browser` command and carrying the Case correlation and Case ID;
- `route_scan_evidence`: `route-scan-report` output by a `kind: route-interception-scan` command.

The browser scope freezes non-empty ordered `expected_actions`, `expected_dom_assertions`, and `expected_network_observations`, plus `route_scan_entrypoints`. Every list item is a canonical compact JSON string. Actions have exactly `action/target/value`; DOM assertions have `expected/operator/selector`; network assertions have `method/status/url` and an optional typed `body_assertion`. DOM/body expected values follow the same leaf-scalar and schema-qualified enum rule; object/list wrappers fail. Network body `actual` roots are `network|request|response|readback|report`. The browser report must pass; exactly match those machine-readable lists, the declared route and terminal claim; name browser, project, and persona; match viewports and expected fault traffic; have empty console errors and unexpected network failures; and set reload and accessibility checks true.

The route scan must pass. It lists normalized relative `scanned_files[]` entries with real SHA-256 content hashes, repeats the exact sorted paths in `scanned_paths`, and declares normalized unique `dependency_edges`, `entrypoints`, and `executed_spec_paths`. Node.js runs the bundled Acorn AST helper against the actual hashed JS/TS bytes. Static imports/exports, comment-separated forms, literal `import()` with options, and direct static require-compatible calls all contribute module requests; comments cannot remove an edge. Parser absence/error, loader alias/sequence/tagged forms, `createRequire`, computed or indirect loaders, and direct/indirect `eval`/`Function` execution fail closed. The AST also rejects route/fulfill/HAR usage through dot, bracket, optional, bind, or alias references and rejects computed `serviceWorkers`/`proxy` config keys. A bare request is external only when a hashed scanned `package.json` declares its package root as a non-workspace dependency and no workspace manifest resolved from the manifest's `workspaces` patterns owns that package name; `workspace:`, `file:`, `link:`, plain-version local workspace packages, path aliases, and undeclared bare requests fail. Entrypoints exactly match frozen `route_scan_entrypoints`, every entrypoint is an executed spec, and every fixture/helper is reachable from an entrypoint through the AST-derived edges. `resolved_dependency_graph_digest` is the canonical SHA-256 over all four sorted structures: `scanned_files`, `dependency_edges`, `entrypoints`, and `executed_spec_paths`. In strict file mode, each frozen root is an existing file or directory and every regular file beneath it must appear in `scanned_files`; root coverage is not satisfied by one representative file. Missing, escaping, duplicate, fake, content-mismatched, unscanned-edge, unresolved-import, parse-failed, unreachable, omitted-root-file, or interception-bearing files fail.

### CI and provenance boundaries

These are separate declarations:

- `ci_required` is an explicit boolean. A required Journey freezes one or more CI expectations whose Case sets collectively cover every declared Case.
- Every CI expectation and `ci-report` uses unique `required_case_ids`; duplicates are invalid, not harmless set normalization. Every report is a `kind: ci` command output, is scoped only to its owning Journey and exact required Cases, and matches one frozen expectation: repository/SHA, workflow/job, matrix, environment, runner OS/labels, and required Cases. It contains one clean `case_results[]` row per required Case; neither the report, matrix, nor any Case row may hide `continue_on_error`, and every declared top-level or per-Case `run_attempt` is `1`. Top-level pass/fail/skip/retry/flake counts equal the row sums. It also carries a SHA-256 report-artifact digest, `conclusion: success`, `skipped: false`, and `cancelled: false`. Every frozen leg must appear exactly once.
- `run.provenance.level` is only `local-observed`. It requires a passing `provenance-report` with a non-placeholder observer and `tool_output_capture: true`.

The local validator deliberately cannot promote itself to an attested trust tier. If signed provenance is required, use a trusted external verifier for the DSSE/Sigstore/GitHub attestation and independently verify signature, timestamp, signer and repository/workflow identity, and exact subject digests. Retain that verifier output outside the validator's claim and report it as a separate release gate.

### Redaction

`run.redaction.status` is `pass`. Its `redaction-report` must be output by a `kind: redaction` command, embed `status: pass`, contain `findings: []`, and list exactly every other catalog evidence ID in `scanned_evidence_ids`. The report does not list itself.

Strict file verification also scans the readable text of every non-screenshot artifact for obvious private keys, AWS access keys, provider tokens, bearer authorization, and assigned password/API-key/secret/token values. A clean redaction report cannot override a built-in secret finding. Screenshots still require human/tool redaction because the validator does not OCR their pixels. Never place secrets or personal data in correlations, logs, traces, screenshots, or ledgers.

### Distinct per-Journey subagents

Every Journey independently requires completed reports for:

1. `Journey Mapper`;
2. `Test/Contract Designer`, `Test Designer`, `Contract Designer`, or `Journey Runner`;
3. `Grill Reviewer` or `Griller`.

Within each Journey these roles must resolve to at least three distinct agent IDs. Each subagent item has a globally unique agent ID, exact source revisions, explicit Journey scope, and a typed `subagent-report` whose role/status/agent/Journey/source fields match. Subagent evidence IDs and bytes must be independent. A role scoped only to another Journey proves nothing for the current one.

Grill evidence is a Journey-scoped `subagent-report`. Open P0/P1 findings block closure; fixed or resolved P0/P1 findings require resolution evidence.

## 8. Compact Schema-3 Positive Shape

This is planned, abridged shape notation. Uppercase tokens are relationships to fill with files actually produced later; comments and omitted fields make it deliberately non-executable. It is a positive example of linkage, not a claim of executed evidence.

```jsonc
{
  "schema_version": "3.0",
  "plan": {
    "status": "frozen",
    "digest": "SHA256(EV_SCOPE file bytes)",
    "evidence": ["EV_SCOPE"]
  },
  "run": {
    "status": "executed",
    "sources": [{
      "component": "PRODUCER",
      "repo": "REPOSITORY",
      "revision": "GREEN_REVISION",
      "dirty_fingerprint": "GREEN_FINGERPRINT",
      "build_digest": "BUILD_DIGEST",
      "identity_evidence": ["EV_SOURCE"]
    }],
    "services": [{
      "component": "PRODUCER",
      "mode": "local-process",
      "readiness_evidence": ["EV_LIFECYCLE"],
      "lifecycle_evidence": ["EV_LIFECYCLE"],
      "log_evidence": ["EV_SERVICE_LOG"]
    }],
    "commands": [
      {"command_id": "CMD_RED", "phase": "red", "kind": "test",
       "expected": "fail", "exit_code": 1, "outputs": ["EV_RED_RUNNER"]},
      {"command_id": "CMD_GREEN", "phase": "green", "kind": "test",
       "expected": "pass", "exit_code": 0, "outputs": ["EV_GREEN_RUNNER"]},
      {"command_id": "CMD_CONTRACT", "phase": "contract", "kind": "contract",
       "expected": "pass", "exit_code": 0, "outputs": ["EV_CONTRACT"]},
      {"command_id": "CMD_JOURNEY", "phase": "journey", "kind": "journey",
       "command": "EXACT_JOURNEY_COMMAND", "expected": "pass", "exit_code": 0,
       "outputs": ["EV_READBACK"]}
    ],
    "runner_reports": [
      {"report_id": "RR_RED", "command_id": "CMD_RED", "phase": "red",
       "failed": 1, "evidence": ["EV_RED_RUNNER"]},
      {"report_id": "RR_GREEN", "command_id": "CMD_GREEN", "phase": "green",
       "passed": 1, "failed": 0, "skipped": 0, "retried": 0, "flaky": 0,
       "dimension_results": {
         "A": {"status": "pass", "test_obligations": ["{\"actual\":\"report.logical_count\",\"expected\":1,\"operator\":\"eq\",\"test_id\":\"integration::tests/report_journey.py::test_batch_once\"}"]},
         "J": {"status": "pass", "test_obligations": ["{\"actual\":\"runner.failed_count\",\"expected\":0,\"operator\":\"eq\",\"test_id\":\"integration::tests/report_journey.py::test_regression_health\"}"]}
       },
       "evidence": ["EV_GREEN_RUNNER"]}
    ],
    "provenance": {"level": "local-observed", "evidence": ["EV_PROVENANCE"]},
    "redaction": {"status": "pass", "evidence": ["EV_REDACTION"]}
  },
  "evidence_catalog": {
    "EV_SCOPE": {"artifact_type": "scope-plan", "sha256": "ACTUAL_FILE_HASH"},
    "EV_RED_RUNNER": {"artifact_type": "runner-report", "case_ids": ["CASE_RED_GREEN"],
                      "correlation_values": ["CASE_CORRELATION"]},
    "EV_CONTRACT": {"artifact_type": "contract-report", "hop_ids": ["HOP_1"],
                    "source_revisions": {"PRODUCER": "GREEN_REVISION"}},
    "EV_READBACK": {"artifact_type": "readback-report", "case_ids": ["CASE_RED_GREEN"],
                    "correlation_values": ["CASE_CORRELATION"]}
  },
  "journeys": [{
    "journey_id": "JOURNEY_1",
    "dimensions": {
      "A": {"status": "pass", "required_case_ids": ["CASE_RED_GREEN"],
            "required_hop_ids": ["HOP_1"], "required_authority": "real-stack",
            "test_obligations": ["{\"actual\":\"report.logical_count\",\"expected\":1,\"operator\":\"eq\",\"test_id\":\"integration::tests/report_journey.py::test_batch_once\"}"],
            "evidence": ["EV_GREEN_RUNNER"]}
    },
    "required_paths": [{"path_id": "PATH_HAPPY", "path_type": "happy",
                         "mandatory": true, "closure_case_id": "CASE_RED_GREEN",
                         "required_hop_ids": ["HOP_1"], "risk_obligations": ["retry"]}],
    "cases": [{"case_id": "CASE_RED_GREEN", "path_id": "PATH_HAPPY",
               "correlation": "CASE_CORRELATION",
               "runner_project": "REPOSITORY_RUNNER_PROJECT",
               "hop_ids": ["HOP_1"], "risk_obligations": ["retry"]}],
    "case_results": [{"case_id": "CASE_RED_GREEN", "result": "pass",
                      "runner_report_ids": ["RR_GREEN"], "evidence": ["EV_GREEN_RUNNER"]}],
    "terminal_oracle": {
      "status": "pass",
      "claim": "TERMINAL_BUSINESS_CLAIM",
      "case_id": "CASE_RED_GREEN",
      "authority_components": ["READ_AUTHORITY"],
      "authority_evidence": ["EV_READBACK"],
      "readback_expectations": [{"authority_component": "READ_AUTHORITY",
                                  "query_type": "http-read-model",
                                  "query": "EXACT_QUERY", "expected": "EXPECTED_VALUE",
                                  "timeout_ms": 5000,
                                  "command_id": "CMD_JOURNEY",
                                  "command": "EXACT_JOURNEY_COMMAND"}]
    },
    "tdd": {
      "case_id": "CASE_RED_GREEN",
      "red": {"command_id": "CMD_RED", "runner_report_id": "RR_RED",
              "evidence": ["EV_RED_RUNNER"]},
      "green": {"command_id": "CMD_GREEN", "runner_report_id": "RR_GREEN",
                "evidence": ["EV_GREEN_RUNNER"]}
    },
    "expected_hops": [{"hop_id": "HOP_1", "mandatory": true,
                       "contract_required": true,
                       "contract_digest": "SHA256(FROZEN_CONTRACT)",
                       "interaction_ids": ["INTERACTION_1"],
                       "provider_state_ids": ["STATE_1"],
                       "risk_obligations": ["retry"]}],
    "observed_hops": [{"hop_id": "HOP_1", "case_id": "CASE_RED_GREEN",
                       "producer_evidence": ["EV_PRODUCER"],
                       "wire_evidence": ["EV_WIRE"],
                       "consumer_evidence": ["EV_CONSUMER"],
                       "contract_evidence": ["EV_CONTRACT"],
                       "risk_evidence": {"retry": ["EV_RISK"]}}]
  }]
}
```

The complete ledger also needs every field described above, exact A-J objects, paths, semantic terminal readback, browser declaration, services, all commands and reports, three Journey-scoped subagents, an explicit `ci_required` boolean plus frozen CI expectations, complete envelopes, and existing files. Never convert this notation into an `executed` ledger by filling it with plausible values.

## 9. Strict Gate

Run from any project directory:

```bash
python3 ".agents/skills/whitebox-verify/scripts/validate_journey_evidence.py" path/to/ledger.json
```

The CLI reads real files. Exit `0` prints `STRUCTURE_PASS`: declared files, hashes, schemas, scopes, and semantic report fields are internally consistent. It does not independently prove that commands ran or that self-authored artifacts are authentic. Exit `1` means structural closure failure. Input/read/JSON failure exits `2`. Use `--all-errors` only when the default first 50 errors are insufficient.


## Slice Mode Contract（v2.2 补充——模式路由中 Slice 的操作定义）

Slice 模式适用于**本地规则/组件级**变更（无跨进程/服务/仓库/租户/异步边界）。与 Journey 模式共享同一套 typed artifact 与 RED/GREEN 语义，差异仅在义务裁剪：

| 义务 | Journey | Slice |
|---|---|---|
| Trinity frame / 冻结计划 / plan_digest | 必须 | 必须 |
| A-J 适用性会计（逐维 required 或 N/A+理由） | 必须 | 必须 |
| Service topology（多服务拓扑） | 必须 | 单进程内组件拓扑（组件/入口/状态存储） |
| Journey map（跨域 hop 链） | 必须 | 替换为本地因果链（entry→规则→状态→终局断言），hop 至少 2 |
| 终局权威读回（terminal readback） | 必须 | 必须（本地状态读回） |
| 跨权威/异步/补偿维（G/H 及 D 跨库） | 必须 | 允许 N/A——但必须引用仓库证据证明路径确实本地 |
| 双浏览器证据（B 维，若涉 UI） | 按 A-J 会计 | 同左 |
| validator（validate_journey_evidence.py） | 必须 | 必须（同一 schema，Slice 不放宽校验） |

判定不确定时（拿不准是否跨边界）：选 Journey，直到仓库证据证明路径是本地的。

**校验器与 Slice 的关系（v2.2 澄清）**：`validate_journey_evidence.py` 是 **mode-agnostic** 的——它不读取也不冻结 `mode` 字段；Slice 的"hop≥2 本地因果链"与"无跨边界自证"由作者在冻结计划中声明、由 Grill Reviewer 评审把关，校验器对 Slice 不放宽也不加严（同一 schema 同一 RED/GREEN）。校验器侧的 Slice 语义（hop≥2 硬断言、跨边界 N/A 禁止）列于技能路线图，非当前契约承诺。

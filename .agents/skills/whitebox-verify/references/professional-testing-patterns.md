# Professional Testing Pattern Adapters

Use repository-native tools first. These patterns are capability adapters, not mandatory dependencies. A tool can strengthen one authority but cannot replace a missing authority.

## Selection Table

| Need | Preferred pattern | Tool-neutral fallback | Does not prove alone |
|---|---|---|---|
| Real browser behavior | Playwright locator/snapshot workflow and trace viewer | Existing browser runner with DOM, console, network, screenshots | Hidden backend Journey completion |
| Multiple local services | One orchestrated lifecycle with independent readiness checks | Compose, Testcontainers, repo scripts, or explicit process manager | Correct contracts or business outcome |
| HTTP/message compatibility | Consumer-driven contract tests and provider verification | Repository-native schema/contract integration tests | Full functional Journey or provider internals |
| Actual distributed traversal | OpenTelemetry trace context and log correlation | Unique test correlation ID propagated through all hops | Correct terminal business outcome |
| Skill/process compliance | RED/GREEN pressure tests with fresh subagents | Fresh isolated agent runs with captured outputs | Product implementation correctness |
| CI/source authority | GitHub checks bound to exact commit and matrix artifact | Local runner report bound to exact source/artifact | Unexecuted browser or environment-specific behavior |

## Playwright / Browser

Follow the current [Playwright best practices](https://playwright.dev/docs/best-practices), [web-first assertions](https://playwright.dev/docs/test-assertions), and [Trace Viewer](https://playwright.dev/docs/trace-viewer). When an OpenAI/Codex browser or Playwright skill is installed, use it as the execution adapter rather than treating its presence as evidence:

- inspect the current DOM/snapshot before acting;
- re-snapshot after navigation or material DOM changes;
- prefer user-facing locators and web-first assertions;
- start tracing before the first Journey action and stop only after the terminal oracle;
- freeze ordered actions, DOM assertions, network observations, and `route_scan_entrypoints` before execution, then require the browser report to match them exactly;
- retain DOM snapshots, console, network, source, browser, and viewport metadata;
- use isolated browser contexts but real first-party APIs for acceptance;
- scan executed specs, imported helpers, global setup, transitive fixtures, and the package manifest used for bare imports; retain normalized paths and content hashes plus explicit `dependency_edges`, entrypoints, and `executed_spec_paths`; use the bundled Node/Acorn AST helper so static imports/exports, comment trivia, literal `import()` options, and direct static require-compatible calls all contribute module requests; permit a bare package only when a scanned `package.json` declares it as a non-workspace dependency and no workspace manifest resolved from `workspaces` owns that name; fail closed on parser errors, loader aliases/sequences/tags, `createRequire`, workspace protocols, plain-version workspace dependencies, computed/indirect loaders, and direct/indirect dynamic code; use that AST to reject dot/bracket/optional/bound route/fulfill usage and computed service-worker/proxy config; enumerate every regular file beneath frozen roots; and require every fixture/helper to be reachable from a frozen entrypoint;
- print those rules literally in each browser plan/report. Loader aliases/sequences/tags, `createRequire`, and computed/indirect loaders are unconditional RED conditions, even when an agent believes it can resolve a target. Include extracted/aliased/indirect/sequence/callback-passed/wrapper/transitive route or fulfill use, and enumerate spec, config, fixture, helper, setup, and local-workspace roots;
- digest the complete resolved graph (`scanned_files`, `dependency_edges`, `entrypoints`, and `executed_spec_paths`), not merely a file-name list;
- distinguish Playwright's assertion polling from whole-test retries; a retry-to-green run remains non-closing.

Use [Playwright Trace Viewer](https://playwright.dev/docs/trace-viewer) to diagnose UI timing and network behavior. Pair the browser trace with backend correlation and authoritative readback.

## Multi-Service Lifecycle

Adopt the multi-server lifecycle pattern demonstrated by [Anthropic webapp-testing](https://github.com/anthropics/skills/blob/main/skills/webapp-testing/SKILL.md):

1. Start every required service with captured command, environment, and log path.
2. Wait on service-specific readiness, not a fixed sleep.
3. Verify endpoint and build/artifact identity before the Journey.
4. Keep all services alive for the complete run.
5. Tear down predictably after artifacts are flushed.

For shared environments, replace process commands with deployment/artifact identity and health evidence. Never infer staging contents from local HEAD.

## Consumer-Driven Contracts

Use [PactFlow Agent Skills](https://github.com/pactflow/pactflow-agent-skills) or native equivalents when consumer/provider relationships exist:

- consumer test generates the expected interaction/message contract;
- provider verification runs against the exact provider version;
- publish results with consumer/provider versions tied to source artifacts, freeze the verified contract digest, interactions, and provider-state IDs, and require that both the contract artifact and its single producing command are source-bound to every first-party endpoint;
- inspect the integration graph and blast radius;
- use deployment compatibility gates such as `can-i-deploy` when the project supports them.

Contracts cover each edge. They do not replace provider functional tests, persistence/readback tests, or the full Journey. Message contracts must cover metadata, keys, schema evolution, retry semantics, and consumer meaning, not only JSON shape.

## Trace And Correlation

Follow [OpenTelemetry context propagation](https://opentelemetry.io/docs/concepts/context-propagation/) where available:

- propagate trace/span context across process and network boundaries;
- correlate logs and durable records with the same business/run identity;
- compare the expected mandatory hop set to spans/log observations;
- record missing instrumentation as an observability gap;
- never place credentials, secrets, or personal data in baggage.

OpenTelemetry baggage travels in request headers, has no built-in integrity check, and may propagate to unintended downstreams. Treat it as correlation material, not identity or authenticity proof; use opaque test IDs and redact it from retained evidence.

When tracing is absent, use a unique test-only correlation header/field that flows through requests, jobs, events, logs, and readback. If a boundary strips it and no independent linkage exists, that hop remains unproved.

## TDD And Skill Pressure Testing

Apply the [Superpowers TDD skill](https://github.com/obra/superpowers/blob/main/skills/test-driven-development/SKILL.md) to implementation and [testing skills with subagents](https://github.com/obra/superpowers/blob/main/skills/writing-skills/testing-skills-with-subagents.md) to this workflow itself:

- observe a real RED before implementation or skill wording changes;
- capture the exact shortcut/rationalization;
- add the smallest rule or structural field that prevents it;
- rerun the same scenario with a fresh agent;
- add pressure from time, sunk cost, authority, unavailable services, and existing green suites;
- test output shape with binary criteria, not only whether the verdict sounds cautious.
- make each passing A-J result return `{status: "pass", test_obligations: [exact frozen canonical assertion strings]}`; canonical JSON fields bind repository test ID, a dimension-specific positive authority root, a fixed operator, and one scalar/schema-qualified enum leaf so prose or object-key wrappers cannot satisfy a stronger obligation.

## GitHub / CI Evidence

Use GitHub Actions/checks as authoritative runner evidence only when all of these match. GitHub's [matrix failure controls](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/run-job-variations) allow selected jobs to use `continue-on-error`, so an aggregate green check is not enough:

- repository and exact commit SHA;
- workflow, job, matrix axis, and environment;
- report artifact, duplicate-free `required_case_ids`, exactly one per-Case result, reconciled counts, skips, retries, and flaky status;
- service/dependency versions used in the run;
- the same acceptance Cases and Journey IDs expected by the ledger.

A green branch check is not sufficient when the required Journey job was skipped, filtered, allowed to fail, retried to green, or ran against a different deploy artifact. Download or inspect the raw report rather than relying on the badge or summary alone.

For authoritative terminal readback, freeze the exact Journey/browser `command_id` and command text alongside the query and expected value. The readback must be a direct output of that command, and its typed command report must carry the same Journey, terminal Case, and correlation.

When signed provenance is required, follow GitHub's [artifact attestation](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations) model as a separate external gate: verify the signature, timestamps, signer identity, repository/workflow identity, and subject digest with a trusted verifier. Merely copying an attestation-shaped JSON file into the evidence directory does not upgrade `STRUCTURE_PASS`.

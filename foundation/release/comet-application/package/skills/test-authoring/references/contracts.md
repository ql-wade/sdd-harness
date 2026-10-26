# Contract authoring adapter

Use existing Pact/schema/API contract tools only when project scope needs them. Read real consumer fields, provider interfaces and state setup; don't invent broker/provider state names. Local source can establish names when no broker is authorized; remote reads/publishing/AI cloud calls require the relevant authorization and are not this skill's default.

Consumer tests specify fields actually consumed, with fixed stable examples and appropriate matchers. Use type/shape matching for irrelevant variable values; retain exact semantics for enum/status/amount/permission values the consumer branches on. One clear interaction per test, real matching provider-state setup and teardown, no cross-case contamination.

Provider verification runs against actual intended provider/version when available. A consumer mock passing is not provider success or Journey acceptance. Publish/deploy/can-i-deploy/workspace administration are out of scope unless explicitly requested as a separate authorized workflow.

For messages add metadata/key/schema version, duplicate/ordering/retry expectations, consumer semantic effects and terminal readback. Contract tests protect an edge; focused rules tests and real-stack acceptance cover different authorities.

Handoff must name concrete existing consumer-test and provider-verification commands, their working directories/config and actual or planned state. Discover them from package scripts/build files/existing tests (for example the project's own npm script or Maven task), never invent a tool flag. If no runnable command/config is available, list that exact gap and keep readiness blocked instead of handing off only a conceptual test. Bind each generated file to its corresponding command; broker publishing is a separate action, not a substitute for local test execution.

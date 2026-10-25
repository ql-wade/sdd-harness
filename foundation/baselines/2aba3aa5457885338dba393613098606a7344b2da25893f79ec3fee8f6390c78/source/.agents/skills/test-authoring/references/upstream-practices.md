# Upstream practices selectively adopted

Reviewed2026-10-19. No upstream code/hook/plugin is automatically installed or executed. Repository stars are not proof of individual skill behavior.

- [microsoft/playwright / packages/playwright/src/agents/playwright-test-planner.agent.md](https://github.com/microsoft/playwright/blob/b335271cdc2b57cac2be8ad37c5dd283ac6b8938/packages/playwright/src/agents/playwright-test-planner.agent.md) — Explore live interfaces before deriving browser steps; separate plan and generated test.
- [microsoft/playwright / packages/playwright/src/agents/playwright-test-generator.agent.md](https://github.com/microsoft/playwright/blob/b335271cdc2b57cac2be8ad37c5dd283ac6b8938/packages/playwright/src/agents/playwright-test-generator.agent.md) — Execute selectors/assertions live then generate maintainable versioned tests; SDK calls remain runtime-specific.
- [mattpocock/skills / skills/engineering/tdd/SKILL.md](https://github.com/mattpocock/skills/blob/49dd158d1076134a641b33efb035946536778336/skills/engineering/tdd/SKILL.md) — Public seams, independently sourced expected values, one behavior/test-code slice at a time.
- [obra/superpowers / skills/test-driven-development/SKILL.md](https://github.com/obra/superpowers/blob/bb92a77741419a4ab5f06e711a283343f1ada0c3/skills/test-driven-development/SKILL.md) — Real intended assertion RED and regression sensitivity; product edits remain a separate authorized role.
- [trailofbits/skills / plugins/property-based-testing/skills/property-based-testing/SKILL.md](https://github.com/trailofbits/skills/blob/5c99c03fb8a9ea568432ecbcba5d86e9f4ac2bf0/plugins/property-based-testing/skills/property-based-testing/SKILL.md) — Meaningful properties, no tautology/vacuity, real shrunk counterexample interpretation.
- [pactflow/pactflow-agent-skills / plugins/swagger-contract-testing/agents/pact-generator.md](https://github.com/pactflow/pactflow-agent-skills/blob/7622d8f5988d72a16b13527fba7752e0e2fff23b/plugins/swagger-contract-testing/agents/pact-generator.md) — Consumer fields/provider-state setup and teardown; exact business enum semantics; no default broker/cloud operations.

## Boundaries retained

- Microsoft assets are agent definitions, not generic cross-harness APIs. Native SDK discovery remains mandatory; no copied tool names or assumption of headless Chromium.
- TDD authors test code/selfchecks here. Product implementation belongs to a separate authorized developer; do not copy destructive delete/restart rules or force every already-correct test to fail.
- Public seam guidance does not ban independent DB authority probes in integration acceptance. Conversely DB access must not couple ordinary unit assertions to private internals.
- Property testing is optional, not a reason to install dependencies or filter away most inputs.
- Pact type matchers do not replace exact status/enum/amount semantics; mocks protect edges, not full Journeys. No implicit remote AI generation/publishing/deployment.
- QA/ISTQB-style templates inform fields and techniques only. No claim their lint proves model-generated case quality. A small test-design-orchestrator repository was not adopted as a quality baseline after its CI was found to continue after unittest failure.
- Test author selfchecks and STRUCTURE_VALID never become independent business acceptance; whitebox owns that boundary.

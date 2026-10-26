# Browser E2E authoring adapter

Use when executable browser tests are requested. Merely designing cases does not authorize browser writes or require opening a page.

Read the actual harness browser skill/tool docs; for exploratory actions respect the user's browser preference and native browser first. Inspect real DOM/AX, match current tab/URL, use semantic locators from observed roles/names. Do not paste ordinary Playwright API into a restricted native SDK. Browser screenshot/emit protocols come from that runtime, not this skill.

Borrow Playwright Planner/Generator's separation: plan scenarios with preconditions/expected results; actually explore steps to establish locator ground truth; generate versioned tests into the project's existing runner. Native interaction trace and generated-runner execution are distinct sessions/evidence; do not splice them into one imagined execution.

Generated test uses existing fixture/auth/server lifecycle; actual first-party acceptance traffic is not replaced by route.fulfill/HAR/replay. Test-scope mocks may be valid component tests but carry declared doubles and cannot masquerade as real E2E.

Wait for concrete DOM/URL/specific response or bounded terminal state, not generic networkidle/readyState/sleep. Include success, relevant denial/error, reload/reentry and independent effect authority. When network/console capture isn't supported, plan needed evidence and report the capability gap; never mark the aggregate browser acceptance dimension passed from DOM/screenshots alone.

Do not install browser/framework dependencies without authorization or replace an explicitly requested native browser with CLI. A runnable generated spec plus selfcheck is author output; whitebox independently executes frozen cases with its own current capabilities and issues any final acceptance report.

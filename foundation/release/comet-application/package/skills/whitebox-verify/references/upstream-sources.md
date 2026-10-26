# Upstream adoption record

Reviewed on 2026-10-18. Repository popularity is not proof of a skill or a user journey. These are bounded adaptations, not wholesale copies or installed dependencies. Planner/generator/healer authoring guidance below is historical source attribution; operative test design, coding and repair belong to test-authoring. Whitebox uses only independent review/execution/evidence criteria.

- [microsoft/playwright / packages/playwright/src/agents/playwright-test-planner.agent.md](https://github.com/microsoft/playwright/blob/b335271cdc2b57cac2be8ad37c5dd283ac6b8938/packages/playwright/src/agents/playwright-test-planner.agent.md) — Plan cases from actual browser exploration; preserve happy/error/edge cases. Snapshot SHA-256: `bf4baa68205aa04c4512a80bcc6a5362d3aaa76ae9165f05a9d5a29e1d34c0fd`.
- [microsoft/playwright / packages/playwright/src/agents/playwright-test-generator.agent.md](https://github.com/microsoft/playwright/blob/b335271cdc2b57cac2be8ad37c5dd283ac6b8938/packages/playwright/src/agents/playwright-test-generator.agent.md) — Execute and verify selectors/assertions live before writing runnable tests. Snapshot SHA-256: `3ba34ef877c6d8c1d0fb70975d96062b33c0ba138a8bbe9eb837585d31ffb045`.
- [microsoft/playwright / packages/playwright/src/agents/playwright-test-healer.agent.md](https://github.com/microsoft/playwright/blob/b335271cdc2b57cac2be8ad37c5dd283ac6b8938/packages/playwright/src/agents/playwright-test-healer.agent.md) — Diagnose failures; reject changing business expectations or hiding required cases via fixme. Snapshot SHA-256: `b3e1d85219df5ead7e3ef0dc69959b0263cc16e885f71d5b64bafdf97e6f9215`.
- [microsoft/playwright-cli / skills/playwright-cli/SKILL.md](https://github.com/microsoft/playwright-cli/blob/b85c7a736bb473bf55b584e54a09ffa698d6d871/skills/playwright-cli/SKILL.md) — Snapshot-driven actions, separate screenshots and runtime/tool-version matching; CLI remains fallback. Snapshot SHA-256: `9bba755285a4c9ad72a4a41b9c7baef6fb516d329c0b44ed0573715f4479b906`.
- [obra/superpowers / skills/verification-before-completion/SKILL.md](https://github.com/obra/superpowers/blob/bb92a77741419a4ab5f06e711a283343f1ada0c3/skills/verification-before-completion/SKILL.md) — Fresh command output before completion claims; report exact verification scope. Snapshot SHA-256: `2befe7fc55bcadaa3d97dd9e8efeb633d2561c0ebe74c5a8b17c4d9e7e4520b3`.
- [obra/superpowers / skills/writing-skills/testing-skills-with-subagents.md](https://github.com/obra/superpowers/blob/bb92a77741419a4ab5f06e711a283343f1ada0c3/skills/writing-skills/testing-skills-with-subagents.md) — Independent cold pressure scenarios, baseline failures and re-evaluation. Snapshot SHA-256: `c711346852c911b24a84aa161e0cff06a4cd7f4e2fa9e9c0a266cead5afcbade`.

## Deliberately not adopted

- Anthropic webapp-testing: retain multi-service lifecycle idea only; do not copy mandatory headless launch, generic networkidle, or treat open TCP port as application readiness.
- Currents: optional reference for fixtures/triage only; examples require checking official Playwright APIs. Configuration lint is not behavioral evaluation.
- Vercel agent-browser: runtime-matched documentation is useful, but its tool-first preference must not override the user's harness-native browser requirement.
- lackeyjb: service discovery and artifact paths are useful; no extra executor/dependency is needed where native harness tools exist.

## Target harness authority

Read the actual current-session browser skill/tool documentation before calling APIs. Codex cua_repl and ZCode control-browser use different initialization and image-output protocols; do not freeze either SDK as a universal interface. Observed version drift requires fresh discovery, not guessed compatibility.

# Parallel Execution

## Roles

- Controller: coordinate and record; write no implementation code.
- Implementer: own one task, one worktree, one ownership set, TDD evidence,
  and one or more task commits.
- Spec reviewer: read-only acceptance and scope review.
- Quality reviewer: read-only design, tests, and maintainability review.
- Integrator: controller role; merge approved commits one at a time.

## Wave Gate

Verify architecture and plan hashes before dispatch. Dispatch only tasks
whose dependencies are integrated. Normalize ownership paths and serialize
any overlap. Use one branch and one worktree per implementer.

## TDD Gate

Require the test command, expected RED reason, RED exit status, minimal
implementation, GREEN command, and GREEN result. A Markdown contract uses
a failing content test before the content is written.

## Review Gate

Run spec and quality reviews in parallel because both are read-only.
Resume the original implementer for fix rounds 1–3. Use a fresh stronger
implementer for rounds 4–5. Stop on a load-bearing finding after round 5.

## Integration Gate

Integrate approved commits in serial task order. Run the full suite after
every integration. Finish with one whole-package review.

# P1_2-convergence worker report — retired workflow entry cannot return through installation

Date: 2026-10-24 · Worktree: codex/comet-entry-cleanup (.claude/worktrees/comet-entry-cleanup) · No commits made (reviewable diff only).

## Objective and scope

Defect: tools/adapters/claude-code.sh link_skills enumerated every directory under .agents/skills and blindly linked it, so automatically migrated source-command-sdd-* skill directories could re-expose the deleted legacy business commands (.claude/commands/sdd-{grill,product,dev,test,code,review,verify,release,archive}.md, already moved to a recoverable backup by the controller) through installation. The old sweep also destroyed a user-owned symlink that merely shared a retired name.

Owned files touched (nothing else):
- tools/adapters/claude-code.sh
- test/foundation-distribution.test.js (5 new focused tests, names prefixed: legacy workflow)
- worker-reports/P1_2-convergence/ (this report + raw evidence)
## Change summary

tools/adapters/claude-code.sh (+59/-11):
- New fixed-name classifier retired_workflow_name(): sdd-* (9-stage, ADR-0015), trinity-* (old engine), superpowers (ADR-0016), source-command-sdd-* (auto-migrated copies of the retired commands). Fixed list only — no new configuration framework, no broad workflow engine.
- Link loop: retired-named sources under .agents/skills are excluded with an explicit diagnostic and NEVER receive a managed skill link; the source body itself is neither deleted nor mutated (upstream bodies immutable).
- Install sweep of .claude/skills handles exactly two retirement cases: (a) retired-named real directories (legacy F2 cleanup, extended to superpowers and source-command-sdd-*) removed with a diagnostic; (b) stale managed symlinks pointing into .agents/skills/ removed and diagnosed (repairs a previous blind install). A retired-named symlink pointing elsewhere is user-owned — ownership cannot be established — so it is preserved and reported with an explicit warning (never silently deleted, never silently kept). Plain files remain out of scope (same as the old directory-only glob).
- Unchanged: settings.json managed-block assembly, deny compilation, matcher union, duplicate-registration refusals, plugin registration division, and --uninstall (still removes only symlinks into .agents/skills/).
- Header comment documents the retirement guard (responsibility 3).

test/foundation-distribution.test.js (+155): new section legacy workflow retirement with 5 compositionTest cases (isolated SDD_TARGET_ROOT fixtures only; live main-checkout .claude/settings.json never touched):
1. migrated source-command-sdd-code source is never exposed as a managed skill link (asserts exclusion diagnostic, alpha/beta still linked, settings assembly intact: one managed PreToolUse, matcher union Bash, user entries intact).
2. retired sdd-* / trinity-* / superpowers / source-command-sdd-release sources excluded with diagnostics; upstream bodies left on disk.
3. stale managed link to retired source repaired on install; user-owned retired-name symlink kept with an explicit warning.
4. legacy real retired directories under .claude/skills cleaned while an unrelated user skill directory survives.
5. uninstall removes only managed entries; repeat install and re-init never re-expose the retired source (idempotence).
## Real RED / GREEN evidence (commands, exit codes, results)

RED (before the adapter fix, only the new tests added):
- CMD: node --test --test-reporter=tap --test-name-pattern=legacy workflow test/foundation-distribution.test.js
- EXIT 1 — 5 tests / 0 pass / 5 fail, all genuine assertion failures (no zero-match, no setup/missing-module failures, no weakened assertions). The first failure message itself demonstrates discoverability: found: [alpha, beta, source-command-sdd-code].
- Standalone demonstration (same RED window): SDD_TARGET_ROOT=<tmp fixture> bash tools/adapters/claude-code.sh -> EXIT 0, creates .claude/skills/source-command-sdd-code -> ../../.agents/skills/source-command-sdd-code, i.e. the retired command becomes discoverable again through installation.

GREEN (after the adapter fix):
- CMD: node --test --test-reporter=tap --test-name-pattern=legacy workflow test/foundation-distribution.test.js
- EXIT 0 — 5 tests / 5 pass / 0 fail (re-verified once more on the final working files after evidence handling).

Existing affected adapter/foundation suite (run once after green):
- CMD: node --test test/foundation-distribution.test.js test/adapter-quoting.test.js test/delivery-hook-assembly.test.js test/lifecycle-hook.test.js
- EXIT 1 — 57 tests / 52 pass / 5 fail. The 5 failures are PRE-EXISTING on this branch, proven two ways: (1) each reproduces on pristine HEAD sources, and (2) the identical 4-file command on pristine HEAD yields the same 5 failures (52 tests / 47 pass; the delta vs my run is exactly the 5 new passing tests).
- Causes: committed method-profile-manifest / foundation-lock digests predate the vendored multi-agent-consensus-review body from commit d481b5f (4 exporter/lock/run-baseline failures); and test/adapter-quoting.test.js lines 21 and 136 run the adapter WITHOUT SDD_TARGET_ROOT, writing the live worktree .claude/settings.json and racing the lifecycle doctor test when node runs test files in parallel. Both are outside this task owned files; reported as-is, not fixed here.
## Evidence files (this directory)

- RED-focused.tap.txt — focused RED run (exit 1, 5 fail) with command/date header.
- RED-discovery-demo.txt — isolated-fixture demonstration that the pre-fix adapter exposes source-command-sdd-code (exit 0, link created).
- GREEN-focused.tap.txt — focused GREEN run (exit 0, 5 pass).
- GREEN-adapter-foundation-suite.tap.txt — affected suite after green (exit 1, 52/57 pass, 5 pre-existing fails).
- PREEXISTING-suite-failures.txt — pristine-HEAD reproductions of the 5 failures (isolated patterns + identical 4-file command).
- report.md — this file.

## Limitations / not verified

- The 5 pre-existing suite failures remain open (out of owned scope); they are unrelated to skills linking.
- Retirement classification is name-based and total: any name matching the four patterns is treated as retired workflow; everything else is linked subject to the existing SKILL.md resolution assertion (fail closed on broken links). A user skill renamed INTO these namespaces will be excluded by design; the diagnostic names it and points to renaming.
- --uninstall intentionally unchanged: a retired-name symlink pointing into .agents/skills/ is still removed there (it is a managed entry); user-owned entries survive.
- No claim is made that the new full Comet workflow / delivery profile is validated, and no task/DAG/contract/lock/execution-state/ledger marks were modified. Live main-checkout .claude/settings.json was never touched (all runs used SDD_TARGET_ROOT fixtures; the transient untracked .claude/ artifacts the parallel suite writes into this worktree were removed after the evidence runs).

## Current git state (end of work)

- git status --short:  M test/foundation-distribution.test.js |  M tools/adapters/claude-code.sh | ?? worker-reports/P1_2-convergence/
- git diff --stat: 2 files changed, 203 insertions(+), 11 deletions(-)
- No commits, no merges, no task completion marks.

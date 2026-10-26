# Proposal: add-journey-version

## Why

`tools/verify/delivery-journey.mjs` has no version face. Operators pinning the
journey runner in delivery evidence cannot record which verifier revision
produced a verdict without digging into `git rev-parse`. The sibling CLI
convention (`bin/cli.js` -> `.version(VERSION)`) shows the repo already treats
an explicit `--version` as the cheapest supply-chain pin.

## What Changes

Add a `--version` flag to `tools/verify/delivery-journey.mjs` that prints the
tool's frozen version constant and exits 0 before any argument validation,
evidence-directory work or journey dispatch.

## Acceptance Criteria

- AC1: `node tools/verify/delivery-journey.mjs --version` exits 0 and prints
  exactly the version string (one line, no JSON envelope, no ANSI).
- AC2: `--version` works without `--scenario`/`--journey`/`--profile`/
  `--evidence-dir` (short-circuits the required-argument validation) and
  creates no filesystem side effects (no evidence dir).
- AC3: `--version` wins unconditionally: the tool scans `process.argv` for the
  exact token `--version` BEFORE strict option parsing, so even combined with
  unknown options it prints the version and exits 0 (debate r1 finding,
  codex-agent: strict parseArgs fails first — fixed by the pre-scan).
- AC4: every other exit-path behavior is unchanged: unknown options other than
  `--version` are still `INVALID_INPUT` exit 1; the 0/1/2 exit contract is
  untouched.

## Non-goals

- No change to journey semantics, verdict computation, schema validation, TAP
  parsing or evidence collection.
- No `--help` rework beyond the usage line gaining the `--version` flag.
- No changelog, no version-from-package.json filesystem read at runtime (the
  version is a frozen constant in the tool).

## Grill record (requirements open, grill-me pinned skill cf9d49f0…)

Session host: the P3_2 worker LLM session executing the pinned grill-me skill
(one question at a time; codebase-explorable questions resolved by exploration).

| # | Question | Resolution | Basis |
| --- | --- | --- | --- |
| 1 | What does `--version` do today? | Rejected: `{"error":"INVALID_INPUT","message":"argument error: Unknown option '--version'"}` exit 1 | live run in the pilot copy (r-explore-version.txt) |
| 2 | Where should the version identity come from? | A frozen `TOOL_VERSION` constant in the tool (not a package.json read: keeps the flag side-effect-free and deterministic) | codebase: tool has no VERSION today; sibling `bin/cli.js` uses a frozen constant with commander |
| 3 | Value of the constant? | `0.1.0` — the pilot project's declared package version; bumping is an explicit edit, never inferred | package.json of the pilot copy |
| 4 | Must it bypass the required-arg validation? | Yes — otherwise AC1 is impossible; short-circuit happens right after option parsing | current validation order in runDeliveryJourney |
| 5 | Precedence when combined with other flags? | `--version` wins, mirroring commander behavior on the sibling CLI | bin/cli.js convention |
| 6 | Output shape? | Bare version + newline on stdout, exit 0; no evidence dir created | operator pinning use case |

## Environment confirmation (R 阶段环境与有权确认)

- Pilot project: the throwaway copy at `$WORLD/project` (19-file import closure
  of the verifier tool + pinned node deps); the change is implemented THERE,
  never in the sdd-harness repository (P3_2 file ownership respected).
- Host: this LLM session is the real skill host (SDK entry protocol honored:
  pinned SKILL.md loaded, content hashes verified against application.json).
- Comet: pinned 0.5.0 build (lock aeb1a659 + 0005, fingerprint de39629a…);
  composition package sdd-managed-delivery@1 installed via the official
  installer with preview confirmation hash b29ec13d….
- OpenSpec: pinned CLI 1.11.0 via COMET_OPENSPEC; root `docs/openspec`
  created by that CLI.
- Authority: pilot mandate = P3_2 construction slice R→V only; archive/Kp/Kt
  tail is VERIFY-owned and must stay blocked.

## Debate record (A gate round 1, real three-agent consensus)

Round 1 tally: claude-code APPROVE 8.6 / zcode APPROVE 8.8 / codex-agent
REJECT 7.5 with 1 blocking finding (argument parsing may fail before the
short-circuit, so declared precedence is not guaranteed). Resolution: the
finding is accepted as correct; AC3 and the design are revised to an argv
pre-scan so precedence is unconditional. Same Run revises from open
(verdict `revise-requirements` recorded on the A extension).

---
comet_change: add-journey-version-r3
role: technical-design
canonical_spec: openspec
---

# Design: add-journey-version-r3 (A stage, grill-me deepened)

## Decision

Add a frozen `const TOOL_VERSION = '0.1.0'` to
`tools/verify/delivery-journey.mjs` and handle `--version` immediately after
option parsing, before the mutual-exclusion and required-argument checks:
print the bare version string to stdout and return exit 0.

## Design grill (grill-me-full-design-document, pinned skill 253a4911…)

Continuation of the requirements grill; the questions deferred at open time
are resolved against the codebase (one at a time, recommended answers given):

| # | Question | Resolution | Basis |
| --- | --- | --- | --- |
| D1 | Where exactly does the short-circuit sit? | BEFORE `parseArgs`: scan `process.argv` for the exact token `--version`; if present print `TOOL_VERSION` and return exit 0 immediately (r2 revision after debate r1) | strict parsing throws on unknown options before any post-parse branch could run (codex-agent blocking finding r1) — only a pre-parse scan makes precedence unconditional |
| D2 | Why a constant instead of reading package.json? | A runtime filesystem read adds an I/O dependency and a failure mode to a flag whose contract is "no filesystem side effects"; the sibling CLI already freezes its version constant | bin/cli.js convention; AC2 |
| D3 | Precedence mechanics vs other flags? | `--version` wins whenever present — the argv pre-scan precedes every other behavior including strict-parse failures; unknown-option rejection still applies to invocations WITHOUT `--version` (fail-closed preserved) | AC3 (revised); debate r1 |
| D4 | Output shape? | `TOOL_VERSION + '\n'` on stdout, nothing else; exit code 0 via the CLI exit contract path (not a raw `process.exit`, so `process.exitCode` assignment style of the tool is preserved) | the tool sets process.exitCode, never calls process.exit mid-flow |
| D5 | Usage text? | One added line `--version             print the tool version and exit 0` in the usage block | AC4 keeps everything else unchanged |
| D6 | What can break? | Nothing downstream sees the flag (early return); the only shared surface is the usage string, asserted by the existing input-contract test shape | diff surface is ~6 lines |

## Shape of the change (authoring plan, consumed by T/P stages)

```js
const TOOL_VERSION = '0.1.0';
// unconditional precedence: before any parsing (debate r1 resolution)
if (process.argv.includes('--version')) { console.log(TOOL_VERSION); process.exitCode = 0; return 0; }
options = parseArgs({ ..., options: { ..., version: { type: 'boolean', default: false } } }).values;
if (options.version) { console.log(TOOL_VERSION); return EXIT_PASS; }
```
plus the usage line.

## Non-goals (unchanged from R)

No journey-semantics change, no verdict/schema change, no --help rework beyond
the usage line, no runtime version-from-package.json read.

## Debate resolution (r1 -> r2)

codex-agent's blocking finding is accepted: a post-parse short-circuit cannot
guarantee AC3 because strict parseArgs throws on unknown options first. The
revised mechanism pre-scans argv (D1/D3 revised above). Re-balloted in the
same review series (round 2 bundle).

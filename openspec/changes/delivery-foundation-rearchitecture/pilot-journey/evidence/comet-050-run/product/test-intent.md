# Test Intent: add-journey-version (T stage r6 — direct exit-0 case landed)

## Review record (independent codex-agent reviewer, real subprocess, read-only; 4 rounds)

- r1 REJECT: permissive exit-contract oracle; unpinned filesystem oracle; missing
  order-independence and exact-token boundaries.
- r2 REJECT: soft filesystem boundaries; exit-2 fixture contradicted the
  environment; exit-0 preservation excluded; executable suite missing.
- r3 REJECT: no stderr-silence assertions; no explicit evidence-destination
  boundary; exit-0/exit-2 preservation uncovered.
- r4 REJECT (nearly resolved): c5 asserted the wrong stream; c1b lacked the
  stderr assertion; this intent file was stale. Fixed for r5.
- r5 REJECT: exit-0 oracle indirect; RED totals stale. Fixed for r6: c6 is a
  DIRECT exit-0 case — a minimal REAL journey execution (synthetic case plan +
  case definition + pilot contract + a trivial test module, all written by the
  test itself) must exit 0 with `PASS (expected outcomes met) exit=0`.

## TestPack (case -> AC / oracle / boundaries) — encoded in test/version.test.js (10 tests)

| case | AC | oracle (executable) | boundary |
| --- | --- | --- | --- |
| c1 | AC1, AC2 | spawn in throwaway cwd + own TMPDIR: exit 0, stdout exactly `0.1.0\n`, stderr `''`, recursive snapshots of cwd AND TMPDIR byte-identical before/after | none |
| c1b | AC2 | `--version --evidence-dir <absent>`: exit 0, stdout version, stderr silent, the evidence dir is NOT created | explicit destination |
| c2 | AC3 | `--version --json`: exit 0, version stdout, stderr silent | known option after |
| c3a | AC3 | `--definitely-not-a-flag --version`: exit 0, version stdout, stderr silent | unknown BEFORE — order independence |
| c3b | AC3 | `--version-extra` alone: exit 1, `Unknown option '--version-extra'` | near-miss token |
| c4a | AC4 | no args: exit 1, exact required-args message | pinned 1 |
| c4b | AC4 | `--journey`+`--scenario`: exit 1, exact mutual-exclusion message | pinned 1 |
| c4c | AC4 | full invocation without case plan: exit 1, `case-plan-unreadable` (live-observed unchanged entrance on this copy) | pinned 1 |
| c5 | AC4 | `--scenario Z99 --profile comet-managed-v2 --evidence-dir <fresh> --case-plan <minimal>`: exit 2 with the NOT-EXERCISED verdict line `scenario-not-registered-in-case-plan ... exit=2` ON STDOUT (live-verified), stderr empty | pinned 2, stream pinned |
| c6 | AC4 | direct exit-0: a minimal REAL journey execution (synthetic plan + definition + pilot contract + trivial test module) exits 0 with `PASS (expected outcomes met) exit=0` (live-verified before encoding) | pinned 0, stdout pinned |

## Exit-0 preservation (AC4)

Directly covered by c6 (a real journey execution exits 0). Additionally the
suite itself runs green as the registered build AND verify checks of this same
composition Run.

## RED observation (live)

10 tests (t-suite-red5.txt): 4 fail (c1, c1b, c2, c3a — the missing feature,
behavior RED `Unknown option '--version'`) / 6 pass (c3b, c4a-c4c, c5, c6 —
unchanged contract incl. the direct exit-0 path, correctly green
pre-implementation).

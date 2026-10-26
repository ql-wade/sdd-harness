# TestPack v1 (authoring handoff; not a closure ledger)

Canonical JSON only; validator CLI: `python3 scripts/validate_test_pack.py <pack.json> --project-root <trusted-existing-repo>`.
Validator is read-only, never executes commands or emits acceptance PASS. Exit0 means `PACK_STRUCTURE_VALID`, not tested/accepted. Do not trust pack.project_root instead of explicit trusted CLI root.

Root fields:
- schema_version: `test-authoring/v1`
- mode: `design` or `automate`
- status: `design_only` in design mode; `ready_for_acceptance` in automate mode. Readiness means runnable handoff, not product success; honest expected-RED is allowed.
- project_root: absolute root, resolved equality with trusted CLI root.
- basis: nonempty list `{id, kind: requirement|source, path, sha256}`; id unique. All paths relative, exist, regular files under trusted root after symlink resolution, exact SHA256.
- requirements: nonempty duplicate-free list of requirement basis IDs (all requirement basis IDs exactly).
- dimensions: exactly keys Journey-A through Journey-J. Each `{required: bool, reason: nonempty string, basis_ids: nonempty valid basis IDs, case_ids: unique valid case IDs}`. Required rows need cases, except design-only may leave a required row empty when its basis_ids includes a requirement explicitly listed unresolved (an honest blocked design gap, not N/A). N/A rows have no cases. This describes planned applicability, never PASS.
- cases: list of `{id, requirement_ids: nonempty unique valid requirement IDs, dimensions: nonempty unique Journey-* IDs, level: unit|integration|api|contract|property|e2e, priority: P0|P1|P2, preconditions: nonempty string list, inputs: object, steps: nonempty string list, oracle: {basis_id: valid requirement basis ID also present in this case.requirement_ids, expected: nonempty string/number/boolean scalar, authority: nonempty string}, cleanup: nonempty string list, evidence_plan: nonempty string list, automation: null|{path, sha256, test_id: nonempty string, command: nonempty string argv list}}`.
- unresolved: list `{requirement_ids: nonempty unique valid requirement IDs, question: nonempty string}`. Each requirement must be covered by a case OR explicitly unresolved. Automate/ready pack cannot have unresolved; design can, and can have zero cases if all requirements unresolved.
- self_checks: list `{command: argv list, exit_code: integer (not bool), expected: pass|expected_failure, log_path, log_sha256}`. Actual log files exist under root and hash-match. Expected pass requires0, expected_failure requires nonzero. Readiness requires >=1 self-check but no claim this proves authenticity.

Consistency:
- Each case's dimension membership exactly matches dimension.case_ids (no unlinked rows). N/A dimensions cannot have cases.
- Case IDs unique, no duplicate references in lists, valid enum/types; unknown keys may be retained but reserved root acceptance fields `acceptance_verdict`, `verdict`, `overall_passed`, `accepted` are forbidden.
- Design-only has automation:null for every case, self_checks=[]; no made-up command execution. Automate has an existing/hash-matched automation file for every case; no placeholder paths, no command execution by validator.
- Requirements unresolved must not be silently invented or treated accepted. A/E/J are always assessed, not automatically all required; source evidence justifies applicability.
- Machine structure cannot prove source meaning, adequacy, real command execution or independent acceptance. Whitebox must inspect original basis, compare test bytes and independently run/observe.

Do not add dependencies. Tests cover valid design + valid automated handoff; missing oracle, stale hashes, dangling/duplicate IDs, omitted requirement, fake/escaping/symlink file, namespace collision, false acceptance, invented checks and type edges. Include a positive expected-failure selfcheck; it remains a valid handoff but is not business PASS.

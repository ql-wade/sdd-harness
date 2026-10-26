# P1_3 stdio lifecycle — independent Standards / quality review

Verdict: **APPROVE** — only the frozen construction candidate. No blocking documented-standard violation or concrete quality defect found. This is not Run, CLI, role, source, platform, knowledge or final business acceptance.

## Frozen scope and standards

Repository: `/Volumes/mac-extend/codex/worktrees/comet-registry-qualification/sdd-harness`.
Candidate: `d4de54683c48e6ec12d2afa5af73dee93b7f1315`; baseline: `9f912d11130284c6020a01eb22d0d84766c6769c`.
Commits reviewed: `50eec4a` and `d4de546`. HEAD matched, working tree was clean before and after review. Only product changes are `lib/adapters/harness.js` and `test/comet-driver.test.js`; other diff files are custody/report artifacts.

Sources: `/Users/mac/Code/sdd-harness/AGENTS.md`, candidate README/architecture/ADR-0015/skill architecture and current HANDOFF, engineering/default skill routing, frozen full diff and surrounding code/callers. Review follows existing two-axis division; Root owns the other axis and all delivery state. Required standards include minimal ESM dependencies, fail-closed input boundaries, original identity, no live configuration residue and truthful component evidence.

## Findings

No must-fix or should-fix finding. No concrete code-smell finding meeting the required reproducible-case threshold.

- `lib/adapters/harness.js:135-151`: the empty dynamic-tool exposure is now accepted while each nonempty entry still requires a unique allowed tool name and valid schema. ActionBinding's existing permission contract is unchanged; empty exposure is not empty authority.
- `:179-201`, `:374-385`: original cloned registration/current-context digest, exact argv, environment allowlist and executable hash/permission checks remain on the existing shared path. New startPolicy is a closed optional set and is included in the original registration digest.
- `:213-235`, `:343-346`: the shared write returns false for UNKNOWN/ended, capture/frame failure or synchronous write failure. Initialize checks that result before setting initialized/state. This closes the prior 50eec capture-limit resurrection rather than weakening the oracle. Async write failure still marks UNKNOWN.
- `:357-368`, `:397-427`: receive stops protocol advancement after UNKNOWN; close cannot promote UNKNOWN; connect reuses the original operation, begin requires exact handle/current tuple, duplicate begin/start cannot request another thread, cancel keeps the original process group cleanup. Historical ready/initialized does not grant fresh authority.
- Repository-wide caller search found only `test/comet-driver.test.js` consuming this transport. Legacy start remains a full lifecycle when startPolicy is omitted; no Host/main/config/caller migration was silently introduced.

## Independent runtime evidence

Actual command, exit 0, fixed Node v24.15.0:

```sh
/Users/mac/.nvm/versions/node/v24.15.0/bin/node /private/tmp/P1_3-standards-fixtures-20261026.mjs > /private/tmp/P1_3-standards-fixtures-20261026.json
```

The combined script runs eight small fixtures; A contributes four independently specified private Node peers. It reuses only existing test context/fixture construction, replaces the peer protocol, and does not import/run the test suite:

1. `empty-turn`: wire initialize → initialized → thread/start → turn/start; empty tools, no tool callback; actual close reports OBSERVED_TERMINAL. Repeated start does not restart it.
2. `stale-after-ready`: epoch drift refuses begin with UNKNOWN/NATIVE_CONTEXT_STALE; restoring the tuple and calling start does not revive it. Wire ends at initialized.
3. `initialize-only`: ready reaches INITIALIZED; both turn entry paths refuse; wire ends at initialized.
4. `overflow`: stdout initialize response is released only after observed stderr leaves one byte of the exact 2MiB capture budget. ready/done/observe retain UNKNOWN/NATIVE_CAPTURE_LIMIT with initialized false; wire contains only initialize; no turn/callback. Explicit cleanup then awaited actual close.

Raw output: `/private/tmp/P1_3-standards-fixtures-20261026.json`, SHA256 `152cc774d1581003e06b15cdf10869c97de8119079c3a25dc4f52b998f17c817`.
Script: SHA256 `12e8eb13c84f9b4edd83eb8890a9fe70c92153a806e7e6a16d70518fec16a6b7`.
Candidate harness: SHA256 `52cdcbdc792794da6bf10f8a326a3c521488a78a017803f4222746c3d9def0a9`.
`git diff --check 9f912d1 d4de546 -- lib/adapters/harness.js test/comet-driver.test.js`: exit 0.

Author evidence was inspected, not rerun: final-owned raw TAP is 114/114 (SHA256 `50787410467d841bffd063a5a783070f8765834152269599dfa623d733b7ec19`), final-related 52/52 (`92d6bf1ebf22eac52cae1f11ea4ec3b75d1bd813d5c73dc12b978773f3d879d3`); both hashes matched the frozen manifest. Earlier 105/111 failure and 50eec's insufficient 111-green remain historical evidence and are not waived or relabelled.

Not checked: no repeated full author matrix, whole-repository check, real CLI/model/auth/MCP, credentials, OS isolation, platform or managed Journey.
Risk: component approval applies only to this exact construction candidate; real startup/configuration closure and final integrated qualification remain pending. No product/plan/lock/ledger/live configuration was changed.

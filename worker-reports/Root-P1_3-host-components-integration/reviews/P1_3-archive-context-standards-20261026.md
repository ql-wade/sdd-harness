# P1_3 archive Run context — independent Standards / quality review

Verdict: **APPROVE** — only the frozen construction candidate. No blocking documented-standard violation or concrete quality defect found. This does not qualify a real Runner, role, Kp/archive/Kt chain or final business Journey.

## Frozen scope and standards

Repository: `/Volumes/mac-extend/codex/worktrees/comet-delivery-contracts/sdd-harness`.
Candidate: `ab90cc25ce194453ff63f346b20c39ba4deb02f9`; baseline: `6f1fda0`. HEAD matched, working tree was clean before and after review. The seven source/test/assembly files and their caller/import closure were reviewed; the remaining diff is report evidence.

Sources: `/Users/mac/Code/sdd-harness/AGENTS.md`, repository README/architecture/ADR-0015/skill architecture/current HANDOFF and engineering/default skill routing. Applied standards: one existing owner/resolver, minimal fixed CODE wiring, fail-closed project path boundaries, assembly coverage for control-plane changes, no permission widening or live configuration residue. Root remains the only controller and progress writer.

## Findings

No must-fix or should-fix finding. No concrete code-smell finding meeting the required reproducible-case threshold.

- `lib/adapters/spec.js:788-808`, `:835-859`: new readRunContext calls the existing private location resolver. It refuses absent/foreign/ambiguous/untrusted location before Native, then delegates actual parsing to the original ensureClassicRuntimeRun. No alternative exported resolver, archive path parameter, durable location state or command loader was added.
- `:845-858`: directory/device/inode and expectedRunId are captured as scalars before the asynchronous Native read. The synchronous assertCurrent closure rereads the same protected location and rejects a changed Run or symbolic lock. Request mutation or returned-view mutation cannot redirect the closure. Its optional lock check preserves ordinary read behavior; signing separately requires the lock to exist.
- `lib/adapters/comet-executor.js:79-80`, `:133-140`, `:172-201`, `:246-262`: invoke/currentIntent/describeCurrent all use that shared reader. The synchronous signature boundary rereads its captured context, rejects completed Run, requires the exact current directory's native lock, and retains existing prepared binding and source qualification checks. Current-intent and composite describe reads recheck after awaits. No physical command is authorized by a successful context read.
- `infra/delivery/runner/image.lock.json:456-459`, `tools/infra/runner.mjs:360-363`: the existing bootstrap file list adds only fixed spec.js, and its allowlist admits that precise filename. spec.js imports only Node builtins. Neighbor adapters remain disallowed; no arbitrary module permission, pin upgrade or second bootstrap owner was introduced.
- Test diff retains previous caller assertions and adds missing/foreign/ambiguous/symlink/pre-Native refusal, after-await location replacement, protected signing and bootstrap closure cases. New artifact-root override follows the already used local accepted-artifact mechanism; it changes test fixture lookup, not product loading.

## Independent runtime evidence

Actual command, exit 0, fixed Node v24.15.0:

```sh
/Users/mac/.nvm/versions/node/v24.15.0/bin/node /private/tmp/P1_3-standards-fixtures-20261026.mjs > /private/tmp/P1_3-standards-fixtures-20261026.json
```

The combined script runs eight small fixtures; B contributes four independent manual project fixtures with a mock ensure reader and a runClassicCli that throws if entered. No actual Native CLI/aggregate or physical process was invoked for B:

1. Active read → request/returned Run mutation → closure still reads original identity. Actual fixture directory archive move invalidates old closure; fresh read resolves the same Run at the archive and creates no replacement active directory.
2. Directory moved inside the awaited reader: RUN_LOCATION_CHANGED.
3. Missing active/archive Run: CHANGE_MISSING before Native, reader call count 0.
4. Lock made into a symlink after the successful read: assertCurrent rejects PROJECT_PATH_UNSAFE.

Raw script/output: `/private/tmp/P1_3-standards-fixtures-20261026.{mjs,json}`.
Script SHA256 `12e8eb13c84f9b4edd83eb8890a9fe70c92153a806e7e6a16d70518fec16a6b7`; output SHA256 `152cc774d1581003e06b15cdf10869c97de8119079c3a25dc4f52b998f17c817`.
Candidate spec.js SHA256 `61c2dd63ffe5b8f8b77c8fc287df96b372431dee6938a9c6c8cbc13e4bc60ce0`; executor SHA256 `35ef17cb7c60e3cf5afa8857c657326a5407e094f2e782a5a906d5615fba53cc`.

Also actually ran: fixed Node `--check` on spec.js, comet-executor.js and runner.mjs; `git diff --check 6f1fda0 ab90cc2` on changed JS/test files. All exited 0. Author final raw TAP summaries were inspected, not rerun: `18-final-source-regression.tap` 207/207 and `21-final-bootstrap-seam.tap` 3/3, both 0 fail/cancel/skip. Earlier RED/intermediate failures remain in the frozen report.

Not checked: no repeated full author/assembly matrix, whole-repository check, real CLI/model/auth/MCP, credentials, physical Runner image rebuild, platform/knowledge writes or final Journey.
Risk: bootstrap declarations passing does not qualify an installed image; Root must rebuild and verify the exact final integrated candidate. No product/plan/lock/ledger/live configuration was changed.

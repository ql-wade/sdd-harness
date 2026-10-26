# P1_3 archive Run context — independent Spec review

Verdict: **APPROVE**, limited to candidate `ab90cc25ce194453ff63f346b20c39ba4deb02f9` against `6f1fda0`. No new blocking Spec defect found in this bounded component/assembly change. This is not runtime or delivery acceptance.

## Scope and requirement

The fixed review target is to let Host consume the unique SpecAdapter readRunContext seam and original Native parser after the original change moves to archive, retain the same Run, synchronously reject location/identity/lock drift at signing, and include the newly imported fixed spec.js in the Runner bootstrap closure. Root remains the only controller. Neither candidate tree, plan, lock, ledger, live configuration nor original evidence was modified.

Read candidate AGENTS, the seven source/test/assembly file diffs, relevant full source and callers, and worker-reports/P1_3-archive-run-context/HANDOFF.md, scope-proof.json and recorded checks. Compared files:

- lib/adapters/spec.js
- lib/adapters/comet-executor.js
- tools/infra/runner.mjs
- infra/delivery/runner/image.lock.json
- test/spec-closeout.test.js
- test/comet-execution-binding.test.js
- test/infra-runner-isolation.test.js

## Spec assessment

- SpecAdapter.readRunContext at spec.js:835–859 reuses the existing private location() rather than adding a second resolver. That resolver rejects active/archive ambiguity, absent/foreign original Run data, symlink and project escape paths. Before entering Native it verifies the expected original Run ID. It calls the captured original ensureClassicRuntimeRun with the actual selected directory, checks location/run again after awaiting it, and verifies the Native-returned Run identity.
- The synchronous assertCurrent closure captures directory/device/inode/expectedRunId scalars. Request or returned-view mutation cannot redirect them. It reuses location() and the project-bound reader, checks replacement/movement/run drift, and validates any present lock as an ordinary in-project file.
- Host uses this seam in invokeNative, currentIntent and describeCurrent; the previous fixed active-change path is removed. Host authority.issueDispatch at comet-executor.js:133–140 rechecks the call's original context immediately before signing, then rejects completed status, missing original lock, absent prepared action or changed action digest. Source eligibility and original signing authority remain in place. A linked or unsupported lock is rejected by assertCurrent before the existence check. No await separates the recheck and existing synchronous signing path.
- currentIntent checks the same original context before and after registry/binding evaluation, retaining original intent verification and source eligibility. describeCurrent checks location/run again after Native next/gates. No new phase, retry record, archive writer or permission switch is introduced. Archived readback does not create an active replacement Run.
- The Runner lock diff adds exactly lib/adapters/spec.js to the existing file list. safeBootstrapFile adds only that fixed adapter name, and import-closure verification remains enforced. spec.js itself imports only node builtins, so this new dependency has no additional package/source closure. Added assembly tests check the actual file hash/size, missing spec.js rejection, cold source loading, and continued rejection of spec-extra.js.
- Added tests use the original frozen Native aggregate for archive/read/signing support; signing negative cases cover completed/foreign/moved/missing-lock/linked-lock and assert zero original signatures and zero physical commands. Original policy fixture now supplies the Native-required policy shape; source/production qualification is still absent/refused. The new artifact-root variable affects test material lookup only.

## Independently executed checks

Read-only fixed-candidate commands included:

```sh
git status --short
git rev-parse HEAD
git diff 6f1fda0 ab90cc25ce194453ff63f346b20c39ba4deb02f9 -- lib/adapters/comet-executor.js lib/adapters/spec.js tools/infra/runner.mjs infra/delivery/runner/image.lock.json
```

Candidate HEAD matched ab90cc25ce194453ff63f346b20c39ba4deb02f9 and git status was clean at start and after the independent probe.

Exactly one independent minimal probe was run:

```sh
/Users/mac/.nvm/versions/node/v24.15.0/bin/node /private/tmp/P1_3-archive-context-spec-probe-20261026.mjs
```

Actual version Node v24.15.0, exit0, eight assertions/cases passed. Original output: /private/tmp/P1_3-archive-context-spec-probe-20261026.out.

The probe imports exact candidate SpecAdapter into a private temporary filesystem and supplies a private CODE Native-reader fixture. It performs no real CLI, network, model, authentication, secret read or platform operation. It checks:

1. active original Run context;
2. old closure refuses movement to archive;
3. a fresh archive read consumes the original archive directory and leaves active location absent;
4. returned Run/request mutation cannot redirect captured identity;
5. foreign on-disk Run identity is rejected;
6. a linked lock is rejected;
7. simultaneous active/archive locations are rejected before entering the Native reader;
8. directory inode replacement during the awaited reader is rejected.

This probe establishes adapter behavior with injected CODE only; it is not evidence that the real Native parser, Host source identity or runtime is qualified. Those source paths were independently reviewed, while the author's original-Native tests remain author evidence.

## Acceptance limits

The author records final source207/207 and assembly3/3 under fixed Node24.15.0, plus build-plan/static checks. I did not rerun those full matrices or consume their process handles. No full repository check, actual Docker/Runner image build, cold agent/config startup, model/provider, MCP channel enforcement, source/OS identity, production signing qualification, canonical artifacts, original-operation business recovery, Kp→archive→Kt or whole P1_3/VERIFY was exercised here. A build-plan exit0 still has ready:false/UNVERIFIED/executable:false, and old D/E image evidence cannot qualify the new import closure. Root must use the final integrated candidate for required integration/qualification checks.

No remaining Spec changes are requested for this bounded candidate. Approval is permission to consume this reviewed component artifact under the existing contract; it is not a business verdict or permission to enable a profile, write a platform or publish.

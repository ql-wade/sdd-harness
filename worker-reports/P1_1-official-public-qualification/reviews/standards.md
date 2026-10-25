# Standards — frozen official Comet 0.5.0 mechanical candidate

**Result: PASS within the explicitly limited research/mechanism scope. No new blocking Standards finding. This is not production handoff, baseline replacement, profile enablement or business acceptance.**

Input: `/private/tmp/comet-official-fit-20261025/FROZEN-MANIFEST.json`, SHA256 `5d4979ea48ee3e4b2d13445b36ca2659e82dfe231d2da6f270947bdd8324eaf5`. Standards basis: main repository AGENTS.md (scope/ownership, pinned supply chain, fail-closed evidence, no live-config pollution), ADR-0019/0020 single-controller constraints and this frozen qualification contract. No fixture rerun, network/model/service/credential action or repository mutation occurred during this review. Only this report is written.

## Independently checked

- All **82** frozen entries match size/SHA. Comet tar SHA `a36d88cd065e92266d483a6bf4946f9d61149a12f3075df107bfde3f4ad9c47f` matches frozen npm registry SRI. All **3,449** current extracted package files match the tar. All 13 dependency tar SHA/SRI values independently match the stored registry responses and exact upstream lock; their extracted files also match. This verifies consistency with the recorded registry, not an independent npm publisher-signature certification.
- `run-fixture.mjs:10–25` uses a small explicit environment, temporary COMET_DATA_DIR/XDG roots, fixed Node and four bounded processes. Worker Git initialization/commit, machine checks and Archive target the new temporary project; its Git config has no remote. The existing OpenSpec 1.14.3 installation is reused without installation changes; Archive writes the temporary project, with supported telemetry/update opt-outs. Its receipt explicitly says npm integrity NOT-VERIFIED and **not production 1.11 qualification**.
- Every stage stdout JSON row equals its corresponding proof row. Build/Verify receipt hashes match their actual logs, each containing **1 test / 1 pass / 0 fail**. Four PIDs and the same Run are identifiable. Before-restart completed action/outcome IDs remain in final Run; the frozen durable checkpoint records revision 51/completed, consistent with final-run and delivery proof.
- `fixture-worker.mjs:152–178` proves missing artifact, bad content under correct current hash, then obsolete hash rejection, retained rejection history and unchanged pending T identity across processes. The host and review callbacks explicitly produce synthetic fixture results; `authorize:true`, mechanical-approved and synthetic Wait choices are **not real human/model/role authority**.
- Kt factory rejection is corroborated by the public factory's checkpoint allowlist (`classic-application.js:111–120`). Built-in state/custom-app refusal is corroborated by `classic-sdk-status.js:60–69` and the frozen owner record naming `mechanical-classic-fixture`. The documents correctly classify public loader/CLI/host dispatch as untested; they do not claim a live CLI-negative test occurred.

## Boundaries and smallest next work

No correction is required to accept these narrowly labelled mechanical observations. Existing production blockers remain mandatory: fixed public loader/CLI/host binding for custom applications; original same-Run postarchive Kt/Unknown reconciliation; authentic reviewers/authorizations and OS/ACL; production 1.11 plus actual dependency graph/spec-scenario contracts; old-Run compatibility and monotonic invalidation after restored bytes. The current no-delta/legacy-file Archive cannot replace those proofs. Migration proposal and PUBLIC-BINDING-GAPS acknowledge these boundaries and do not switch a lock or create a second controller.

Two nonblocking reproducibility improvements for a future replay: add an explicit temporary HOME and disabled system/global Git config rather than relying only on XDG/sanitized environment; bind the actually loaded module/tool dependency closure before and after execution, not just tar/receipt metadata. Present environment stripping is not OS/network isolation proof. Root's replay must keep external network/model access denied.

Historical setup failures remain disclosed. Absolute host paths and legacy `docs/superpowers` fixture paths are temporary upstream-compatibility observations, not approved distributable project paths. Do not promote the fixture's synthetic decisions, completed state or research PASS into the current scaffold's delivery ledger.

**Standards findings: 0 blocking; 2 nonblocking reproducibility suggestions. Production migration approval: NOT GRANTED.**

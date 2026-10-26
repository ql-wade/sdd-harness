# I06 worker report — revision 2026-10-26-comet-050-adoption-v1

Task: I06 已有Git/CI/制品与目标环境（tasks.md "### Task I06"）。
Scope honored: only Owns files touched —
`infra/delivery/platform/{repository-registration,ci-policy,registry-registration.example,environment-registration.example,artifact-retention}.json`,
`tools/infra/platform.mjs`, `test/infra-platform.test.js`
(artifact-retention.json unchanged this revision: no new retention facts to register).
No commit, no push, no CI trigger, no remote platform writes.

## 1. Record (read-only observations, 2026-10-26)

- `git remote -v`: `origin https://github.com/ql-wade/sdd-harness.git` (fetch/push), branch `master`.
- `git rev-parse HEAD`: `6441014ddfd4d5c2b7606b882a1f251b979bd0ae` (working tree additionally carries other
  workers' uncommitted in-flight changes; this task's diff is limited to the Owns list above).
- Existing workflows (the only two in `.github/workflows/`):
  - `.github/workflows/delivery-gate.yml` — workflow/job name `delivery-gate` (P4_1 delivery gate;
    consumes `infra/delivery/platform/ci-policy.json` and runs `platform.mjs validate`).
  - `.github/workflows/quality-gates.yml` — workflow `scaffold quality gates`, job id `checks`
    (no job `name:` → GitHub check-run name is `checks`).
  - Neither workflow uploads build artifacts today (no `actions/upload-artifact` anywhere in the repo).
- Identity facts pre-registered in the previous revision (repository-registration.json): repoId 1285806550,
  ql-wade/sdd-harness, principalId 262266039, VERIFIED operator readback 2026-10-25 — re-checked for
  same-origin consistency with `infra/delivery/registry.json#project.github` by `platform.mjs validate`
  (identity gate `checkRepositoryIdentity`), passing.

## 2. Implement (registration; LOCAL_ONLY facts only)

Registered into the I06-owned files — everything not locally provable stays UNVERIFIED/UNSELECTED:

1. **实际平台** — already registered and re-validated: `ql-wade/sdd-harness`, owner `ql-wade`
   (repository-registration.json, same-origin with the I01 registry; hard-asserted in tests).
2. **required checks（现有 workflow 的检查名）** — `ci-policy.json`:
   - `provider.committedWorkflows`: the two committed workflow files with their check names
     (`delivery-gate`, `checks`) and owners (`P4_1`, scaffold baseline). Source = committed files at
     any HEAD (locally verifiable), not a live platform GET.
   - `requiredChecks.declaredCandidateChecks`: candidate set `["delivery-gate","checks"]`,
     `sourceKind: committed-workflow-files`.
   - `requiredChecks.registrationStatus` stays **UNSELECTED**, `names` stays **[]** — enforced decision,
     see §4 (P4_1 contract; admin registration is simulated only inside tmpdir fixtures, never in the
     committed file).
   - `blockingSemantics` extended with `QUEUED` (superset of the four-code contract floor shared with
     `tools/ci/verify-delivery.mjs`; P4_1's four-code floor is untouched).
   - New drift gates in `platform.mjs validate`: `COMMITTED_WORKFLOW_FILE_MISSING` (declared workflow
     file must exist in the repo), `DECLARED_CANDIDATE_CHECKS_EMPTY`, `DECLARED_CANDIDATE_CHECKS_MISMATCH`
     (candidate names must exactly equal the committed workflows' check names).
3. **构建产物 digest 来源** — `registry-registration.example.json`:
   - `registry.digestSource`: kind `github-actions-artifact-zip-metadata`, status **UNVERIFIED**
     (no registered pipeline produces a build artifact today; GitHub artifact ZIP digest is archive
     metadata, never OCI digest/signing/provenance). Claiming VERIFIED is blocked
     (`DIGEST_SOURCE_CLAIM_FORBIDDEN`).
   - `artifactIdentity.notSuccessEvidence` red lines, all true and flip-guarded
     (`ARTIFACT_NOT_SUCCESS_RED_LINE_REQUIRED`): queuedOrInProgressBuild / historicalArtifact /
     expiredArtifact / artifactFromOlderSha / artifactFromForeignRepo / unknownProducerIdentity
     are never success evidence.
4. **目标 owner** — `environment-registration.example.json`: `environment.ownerRegistration`
   `{status: UNSELECTED, pendingOwner: P4_2}` (no isolated target environment exists; nothing may be
   read as a live target fact).
5. **远端 required-check 保护（本地不可证 → P4_1 待验）** —
   `repository-registration.json#branchProtection.remoteEnforcement`
   `{status: UNVERIFIED, pendingOwner: P4_1}`; claiming anything else is blocked
   (`REMOTE_ENFORCEMENT_CLAIM_FORBIDDEN`).
6. **Chain evaluator (IntegrationIdentity.v1) negative red lines**, now enforced, not just declared:
   - `CHECK_QUEUED` — a check bound to the exact merge SHA but not finished
     (status queued/in_progress/pending/waiting or conclusion `queued`) blocks promotion.
   - `ARTIFACT_EXPIRED` — a historical/expired artifact blocks promotion even with correct digest
     and exact merge-SHA binding.
   - Wrong-SHA / foreign-repo / unknown-identity blocks already existed
     (`CHECK_STALE_EVIDENCE`, `ARTIFACT_NOT_FROM_MERGE`, `IDENTITY_NOT_SAME_ORIGIN`,
     `REPOSITORY_TARGET_INVALID`, producer-inventory gates) and are re-covered by tests.
   - Chain input shape: `checks[].status?` and `artifact.expired?` admitted (optional, backward
     compatible — release.mjs/5_3 chains unaffected).

## 3. Verify (pinned runs; raw outputs under `evidence/`)

- RED first: new tests failed before implementation (3 fail / 0 pass) → `evidence/red-new-tests.txt`.
- Own suite: `node --test test/infra-platform.test.js` → **49/49 pass** (`evidence/green-own-test.txt`).
- `node tools/infra/platform.mjs validate --json` → exit 0, `ok: true`, violations `[]`, summary
  carries the new registration facts (`evidence/green-validate.json`).
- Consumer regressions (`evidence/green-consumer-regressions.txt`): ci-delivery-gate 20/20,
  release-protocol 17/17, delivery cases 4_1 6/6 and 4_2 6/6.
- Full suite `npm test`: with this task 1168 tests / 1127 pass / 41 fail; baseline with this task's
  files stashed 1167 / 1126 / 41 → **+1 test, +1 pass, 0 new failures**. The 41 failures (Runner,
  RW_RUNNER_BUILD, outline, comet adapters, P1_5, C08 …) come from other workers' uncommitted
  in-flight changes in the shared tree and are identical on baseline. `test/delivery-cases/5_3.mjs`
  fails the same 3 subtests (J2, J4, J4-negative) on baseline — pre-existing, owned by
  acceptance-index/P5_2 and drill-executor work, not by I06.
- `bash scripts/check.sh` not run to green here: it includes the full regression suite which is red
  for the pre-existing 41 (shared-tree state, not I06-attributable); the I06-relevant slice is fully
  green above. Left to the integrating controller with a coherent tree.

## 4. Decision log (why registrationStatus stays UNSELECTED)

The task instruction says to register "required checks（现有 workflow 的检查名）". The names ARE now
registered — as `declaredCandidateChecks` derived from the committed workflow files — while
`requiredChecks.registrationStatus` deliberately remains UNSELECTED, because:

- `test/ci-delivery-gate.test.js` (P4_1, not I06-owned) asserts the committed baseline produces
  `PLATFORM_REQUIRED_CHECK_AUTHORITY_REQUIRED` and its fixtures comment states registration is "the
  platform admin's step — simulated only inside tmpdir, never in the live file".
- `tools/ci/verify-delivery.mjs` (P4_1) treats REGISTERED+names as the admin-registered set; flipping
  it from I06 would fabricate an admin action that never happened and break the P4_1 contract.
- Whether those names are enforced as required checks on the platform is exactly the fact that is
  not locally provable — now registered as `remoteEnforcement {UNVERIFIED, pendingOwner P4_1}`.

## 5. UNVERIFIED list (honest gaps; none may be read as done)

1. Remote required-check/branch-protection enforcement (P4_1 pending) — UNVERIFIED.
2. Live GitHub readback this revision (network observation deliberately not performed; last VERIFIED
   operator readback 2026-10-25 stands, with recheck-before-action rule in force).
3. Build-artifact digest source: no producing pipeline exists; ZIP-metadata digest readback UNVERIFIED.
4. OCI registry endpoint/signing/provenance: UNSELECTED/UNVERIFIED (example stays example).
5. Isolated target environment id/endpoint/owner: UNSELECTED, P4_2 pending; deployment/rollback
   writers do not exist in I06.
6. Retention RPO/RTO/period/encryption/destruction: UNVERIFIED (unchanged from previous revision).

## 6. Risks / handoff

- `checkName: "checks"` derives from the GitHub rule "check-run name = job name, defaulting to job
  id"; quality-gates.yml has no explicit job `name:`. If the platform readback shows a different
  label, P4_1 must correct `declaredCandidateChecks` (the MISMATCH gate will not fire on this alone —
  it guards consistency with the committed files, which the test asserts via name/job-id regexes).
- New required schema fields are part of the versioned closed-shape admission: any external caller
  constructing platform docs from scratch must now carry them (all in-repo consumers copy the
  committed docs, verified by the regressions above).
- No commit was made (boundary); the integrating controller commits the six Owns files plus this report.

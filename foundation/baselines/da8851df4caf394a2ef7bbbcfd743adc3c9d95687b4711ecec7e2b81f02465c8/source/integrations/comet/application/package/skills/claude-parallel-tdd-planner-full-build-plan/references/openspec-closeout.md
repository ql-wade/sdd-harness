# OpenSpec consistency and closeout

Read this when the plan belongs to an OpenSpec change. Implementation acceptance
and spec closeout are different facts. This reference extends the existing
plan/DAG contract; it does not authorize Git merge, push, deployment, or publishing.

## Lifecycle-guard responsibility

Discover and load the installed `openspec-lifecycle-guard` before change preparation
and execution. Apply it at three checkpoints: artifact readiness before dispatch;
evidence-backed task checkbox transitions during execution; readiness before
archive and main-spec correctness after archive. Persist its actual path/content
SHA-256 and each checkpoint's findings/evidence in mutable controller state/ledger.
This is a skill applied by the controller, not a subprocess implicitly called by
`openspec_lifecycle.py`. Planning prepares the checkpoints without claiming they ran.

Whitebox owns behavior/terminal evidence; lifecycle-guard owns lifecycle discipline;
the helper performs deterministic source/receipt checks and actual CLI operations.
Missing lifecycle-guard leaves the named collaboration gate unavailable. Do not
silently substitute the helper or claim the skill ran because its rules overlap.
The planner's frozen required-check/task gates remain stricter than an archival
warning/disposition: an unfulfilled required acceptance cannot be waived merely
because generic archive guidance allows recording an unfinished item. Replan any
scope change. Strict validation alone does not detect every lost old scenario;
compare actual pre/post scenario sets and inspect semantics as well.

## Ownership and lifecycle

One controller owns shared tasks, state and spec closeout. Workers submit evidence;
they never sync main specs or archive independently. Track implementation
PLANNED / EXECUTING / INTEGRATING / VERIFYING / ACCEPTED separately from closeout
PENDING / READY / FINALIZING / ARCHIVED / RECOVERY_REQUIRED. Do not add archive as
an unchecked implementation task: archive's task-complete precondition would make
that self-dependent. Closeout runs after VERIFY under controller state.

Choose `in-change` (archive in the authorized implementation checkout) or
`after-merge` (wait for the accepted implementation to be in the configured target
checkout). Derive policy from repository instructions; otherwise record in-change
for a repo-local execution request that includes closeout. An execution request
includes the frozen policy, but never implies permission to merge/push. Planning
only freezes inputs and prepares instructions. When waiting on merge, report
ACCEPTED / CLOSEOUT_PENDING with owner and resume condition; do not claim ARCHIVED.
Keep supervising authorized active work; at an external/user-action blocker report
immediately and apply the automation reference's blocker policy rather than looping.

## Freeze source and coverage before dispatch

Discover the actual OpenSpec CLI version/schema and supported commands. Use the
CLI-resolved root for general schemas. The bundled helper currently supports only
repo-local `openspec/changes/<id>` changes with proposal.md, tasks.md and delta
specs. It refuses missing/no-spec inputs. Stores/workspace roots, custom layouts,
or no-spec changes need an explicit repository adapter with equivalent evidence;
mark CLOSEOUT_UNAVAILABLE until it is verified. Do not fake a standard local root.

Within supported roots, write `bindings.json` mapping every acceptance ID to
actual delta requirements/scenarios, using paths relative to the change root:

```json
{"AC1": [{"path": "specs/auth/spec.md", "requirement": "Login", "scenario": "Valid password"}]}
```

Every scenario in every delta requirement needs coverage, including retained
scenarios within MODIFIED. A requirement with no scenarios (e.g. REMOVED, or the new name in a pure RENAMED operation) binds
with `scenario: null`; removals/renames also need explicit migration/compatibility
checks in the execution contract. Structural coverage is not an assertion that
the behavioral checks are sufficient: inspect WHEN/THEN and negative boundaries.

Run `python3 <skill>/scripts/openspec_lifecycle.py freeze --repo-root <repo>
--change <id> --bindings <bindings.json> --policy in-change` after tasks are final,
before creating the plan lock. This writes `spec-baseline.json` inside the change.
It records exact source/config/schema hashes, the affected main specs (including
absence of new capabilities), and acceptance bindings. Task checkbox flips alone
are normalized. Add this to the execution contract BEFORE hashing that contract:

```json
{"verification": {"skill": "whitebox-verify", "mode": "Journey"},
 "openspec": {"change_id": "add-2fa", "policy": "in-change",
              "baseline_sha256": "actual spec-baseline.json SHA-256"}}
```

MODIFIED is a whole-requirement replacement in the installed CLI; missing old
scenarios block freeze. An intentional deletion needs a reviewed disposition
array with `path`, `requirement`, `scenario`, and concrete `reason`, supplied using
`--dispositions <file>`. A reason string records a reviewed scope decision, not
permission to change behavior. Do not invent approval. The CLI preview remains
the merge authority, especially for rename/remove combinations.

Preserve the old baseline and reviewed scope diff when replanning; never silently
refresh the source freeze. Retest affected implementation and evidence on the new
version. New/changed delta files and affected main-spec changes invalidate closeout.

## Whitebox acceptance handoff

Load whitebox-verify from the executing host. Slice/Journey, original schema,
validator, browser rules, actual execution and evidence inspection remain owned by
that skill. Debug helps diagnose failures and cannot replace acceptance. There is
no mandatory second Trinity run. User-required additional gates remain in force.

Retain its original report, ledger and validator output. The controller derives a
`whitebox-receipt.json` ONLY after running the skill's validator, inspecting raw
execution/terminal-oracle evidence, reconciling every required planner check ID,
and closing original P0/P1 through fix and retest evidence. STRUCTURE_PASS is not
business PASS; UNVERIFIED/unstable/skip/retry gates stay open. After repair, create
new immutable runs and a new receipt; keep the original failure history.

Use `.whitebox/<run>/` for receipt/raw artifacts (inside repo, outside the moving
change). Do not place product code there. Other evidence may remain in the change
but references must be reviewed/rebound before closeout; stale paths block audit.
The helper's implementation manifest covers all regular files outside `.git/`,
`.local/`, `.whitebox/`, `openspec/` and Python bytecode caches; it is a conservative
content baseline, not proof of the launched build. Record runtime/build identity
in Whitebox as well. Symlink-based implementations need a reviewed adapter.

Receipt shape (notation, not pre-executed evidence):

```json
{
  "skill": "whitebox-verify", "mode": "Journey", "status": "PASS",
  "run_id": "actual-run", "inspected_by": "actual-controller",
  "evidence_review": "PASS",
  "baseline": {"revision": "actual-HEAD-or-null", "files": {}, "digest": "actual-manifest-digest"},
  "ledger": {"path": ".whitebox/run/ledger.json", "sha256": "actual-hash"},
  "report": {"path": ".whitebox/run/report.md", "sha256": "actual-hash"},
  "validator": {"exit_code": 0, "log": {"path": ".whitebox/run/validator.log", "sha256": "actual-hash"}},
  "checks": [{"id": "V1", "acceptance_ids": ["AC1"], "status": "PASS",
              "evidence": [{"path": ".whitebox/run/command.log", "sha256": "actual-hash"}]}],
  "findings": []
}
```

Capture `baseline` with the helper's `baseline --repo-root <repo>` action at the
accepted implementation version. Bind all required check IDs from the frozen
execution contract, not merely one check for each AC. A fixed/resolved P0/P1 also
requires `resolution_evidence` hash/path refs. The helper reruns the installed Whitebox ledger validator (discover via sibling skill,
standard host skill roots, or PLANNER_WHITEBOX_ROOT) before accepting the receipt.
The receipt is a controller-reviewed declaration, not cryptographic provenance. Hash checking cannot prove self-authored
reports truthful; never promote fixture receipts to real Whitebox acceptance.

## Preflight, archive and readback

1. Re-run plan_guard against the same locked bundle and inspect evidence.
2. Run helper `prepare --repo-root <repo> --change <id> --receipt <receipt>`.
   It requires all task boxes complete, frozen sources unchanged, matching Whitebox
   baseline, inspected PASS evidence, and merge timing if selected. It strict-validates
   the change and invokes the installed archive CLI in a temporary copy, then
   strict-validates resulting main specs. No real specs are changed by prepare.
3. Inspect `.local/planner-lifecycle/<id>/preflight.json` and preview logs/diff.
   It records expected complete main-spec bytes, archive manifest and receipt hash.
4. Run `finalize` with the same repo/change/receipt and
   `--preflight .local/planner-lifecycle/<id>/preflight.json`. It rechecks preconditions,
   rejects an existing destination BEFORE mutation, saves a full pre-operation
   OpenSpec backup, records FINALIZING, then runs `openspec archive <id> --yes`.
   The helper does not pass --no-validate or --skip-specs. --yes is safe here only
   after the stronger task/evidence gates. Do not sync twice: archive already merges.
5. `audit --repo-root <repo> --state .local/planner-lifecycle/<id>/state.json` checks
   active-root absence, exact archived content, exact main-spec preview match,
   implementation identity and all referenced evidence bytes. Deliver archive/main
   spec paths, Whitebox report/ledger, closeout state and command logs. Close the
   requested goal and clean its monitor only when its promised scope is satisfied.

Nonzero CLI status, missing expected output, content mismatch, or partial writes
keep closeout incomplete. FINALIZING/RECOVERY_REQUIRED is never blindly retried.
Inspect operation logs and before-openspec backup; reconcile observed files under
single-controller ownership, preserve unrelated work, and get a reviewed recovery
plan. Do not automatically reset a repository or overwrite concurrent edits.
A repeated finalize of ARCHIVED does readback only, not a second merge.

The local helper uses a nonblocking POSIX advisory lock across its controllers,
not a distributed lock against arbitrary tools. Serialize closeout in the repository;
stop other spec writers. A crash/unknown result is a recovery condition. A changed
accepted implementation needs affected Whitebox revalidation; metadata-only
closeout must not relabel old logs as tests of a new implementation revision.

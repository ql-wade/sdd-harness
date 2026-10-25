# P3_4 read-boundary rework candidate

This revision addresses the independent Standards P2 found in `f585c2a`: Spec Adapter projections could follow a spec/Run/main-spec link before Native validation, and null Run JSON produced a TypeError. The original commit, 42-entry manifest, 23-test evidence and all raw logs remain historical evidence; they are not promoted to current acceptance. The root `CURRENT.json` now points here and its original bytes are preserved under `history/`.

## Change

Only `lib/adapters/spec.js` and `test/spec-closeout.test.js` change product/test behavior. `test/delivery-cases/3_4.mjs`, official SDK/patches/lock and other owners' sources remain unchanged.

One private project-bound reader now validates fixed-root containment and each existing path component with lstat/real-target checks, refuses symlinks (including dangling and ancestor links) and unsupported file types, then opens ordinary files with O_NOFOLLOW and verifies the opened descriptor against the checked file before reading bytes. Logical and canonical spellings of the same actual project root remain compatible. Error messages are constant coded errors without external document text or arbitrary filesystem-path diagnostics.

The same checks cover active target summaries, delta traversal, whole copied preview sources, archived summary projection, original Run JSON, scenario-preservation main specs, expected main-spec paths, standalone readback, legacy recovery state/lock reads and their bounded bookkeeping paths. Managed recover/closeout check their spec read scope before invoking Native, not merely after a Native refusal. Caller-supplied relative expected-spec paths cannot escape the main-spec tree.

Run JSON must be an object with nonempty Run identity and a native lifecycle status. Null/array/scalar/invalid status and malformed summary shapes fail with coded errors. Reading/parsing data remains separate from source qualification and permission to act. No managed gate, phase, receipt or SDK behavior was replaced.

## Actual RED and verification

- `01-public-read-red`: **2 tests, 0 passed, 2 failed** against the prior implementation through public API. The ordinary external spec link was accepted before any Runtime call; null Run JSON produced TypeError. No replacement program or payload was used.
- `02-public-read-green`: the same 2 regressions passed.
- `03-unit-complete`: normal-path regression exposed logical/canonical temporary-root conversion; preserved as failure, not called a security RED. The shared conversion was corrected without following descendant links.
- `04-unit-canonical-root`: **19/19**, 0 skipped.
- `05-owned-complete`: **29/29**, 0 skipped, 155.197 seconds. All original 23 obligations remain and were actually rerun, including real pinned OpenSpec archive/readback, same Run/current Kp/Kt, archive-reopen, writer SIGKILL and before-move recovery. Six new public boundary tests add ordinary file/directory/control/main links, archived reads, relative escape and malformed data coverage.
- `06-repository-check`: **FAIL**, 836 / 825 passed / 11 failed / 0 skipped. Failure identities match the prior candidate exactly; full raw failures are retained and not waived. No other owner was edited to make this pass. Measured input hashes before/after are equal.
- `07-strict-validation`: pinned isolated OpenSpec 1.11.0 strict validation exit 0, measured input hashes unchanged. This is structural validation, not archive readiness.

The complete owned log records its actual creation UTC and observed terminal time; source hashes for that run were recorded after execution, with no source edits during it. The related/strict records contain measured pre/post hashes. These distinctions are retained rather than inventing a pre-run measurement.

## Limits and handoff

This is a component candidate pending independent review. Registry/actual role and semantic-method execution, OS/UID/volume protection, real source/knowledge permissions and all business acceptance remain **UNVERIFIED**, accepted business scenarios **0**. Filesystem checks are not a claim of isolation against an unrestricted concurrent privileged writer; actual protected installation and process boundaries remain I02/P1_3 duties.

The new boundary fixtures use ordinary temporary files and a Runtime tripwire only to assert that rejected reads never invoke Native. They produce no pass receipt, source qualification or model execution. The original real SDK/P2_2/P2_1 mechanism cases also reran, with new proofs in `proof-index.json`. No real migration Change/archive, remote resource, key, global configuration, Goal, monitor or second controller was touched. All temporary fixture data is removed in finally.

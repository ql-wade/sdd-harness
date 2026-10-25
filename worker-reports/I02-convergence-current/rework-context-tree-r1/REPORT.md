# I02 context tree rework r1

Author construction candidate after independent Spec P1 rejection of `70a2c08763b98cf450380d13d99611f4a8f5042a`. Whole I02 remains **UNVERIFIED**; version-dependent recipe/bootstrap/build and real-role execution remain **ON_HOLD**.

## Change and oracle

`tools/infra/runner.mjs` previously verified only listed files. A real extra `.env` remained in the Docker context while the public export returned0/materializedtrue. The independent original report SHA is `0e5e8f0dbd97465c151a3f9fadecbe55b66e905d5fa5b0202f7b6255b9032516`; original proof SHA is `685abe8596734b77ff83bf292bd30adf358226a9edba0ccf567c5aef64d4f800`. `SPEC-REVIEW.md` is an explicitly normalized view; raw originals are retained under ignored local paths indexed here.

The shared context check now traverses the entire actual tree. Only manifest files and their ancestor directories are allowed, every file must be regular and hash-match, and all context parents/entries must be real directories/files. Symlinks, dangling links, special entries, extra paths, missing paths and changed bytes return exit2/CONTEXT_CONFLICT/UNVERIFIED. Conflicts never emit a Docker build command or remove/overwrite the unexpected tree. File reads use no-follow/non-blocking open and verify the opened inode; parent identities are rechecked. New exports use exclusive files in private directories and the same full-tree check after writing.

No existing exported helper matched this policy: the Comet build tree helper intentionally records links/output metadata, rather than rejecting every non-allowlisted input. The small I02-local check does not alter that owner or add a context framework/dependency.

## Actual validation

- `red-extra`: valid original behavior RED, expected2/actual0.
- `red-boundaries`: preserved test setup failure; shared fixture cleanup caused child interference. This run is not semantic product evidence.
- `red-boundaries-v2`: valid RED with isolated per-child fixtures,15 boundary assertions rejected the previous ordinary-plan exit0.
- `green-boundaries`:17/17, zero skips.
- Final owned: **81/81**,0fail/skip, exit0, UTC 2026-10-25T16:21:44.730658+00:00 to 2026-10-25T16:22:10.299946+00:00.
- Related I01: **41/41**,0fail/skip, exit0, UTC 2026-10-25T16:21:45.724941+00:00 to 2026-10-25T16:22:13.512930+00:00.
- Exact Node24.15.0/Python3.14.7/isolatedPyYAML6.0.3 and six actual offline guards97 were calibrated. Owned final guard calls0; related Docker9/gh2 are blocked fixture calls, not live readback. Final inputs before/after match; digest `bc632e524ef32c4c878163a0dfe95e37c0798d942515c53e0ac9c3b6b625c07c`.

Both public plan and export are tested for15 conflicts: extra `.env`, nested extra file, root/nested empty directory, byte drift, matching-byte file symlink, declared-directory/context-root/context-parent/.local link, dangling extra link, extra/declared FIFO, missing file, and first export below a linked parent. Ordinary exact reuse and mtime preservation remain positive. Tests create only private owned fixtures and finally clean them.

## Evidence and limits

`run-results.json` indexes every command/UTC/exit/input SHA/raw and display hash; `candidate-inputs.json` freezes this revision; `history-preservation.json` verifies all116 prior candidate entries against frozen Git/current unchanged files and221 old raw entries. The old65/41 reports and manifest `2440b056a78a5737043f9ad90dd3a525d4f4afe9fceb3fb1fbf381cf14bbd750` were not rewritten.

The check is point-in-time validation. There is no actual Docker build consumer in this patch: future fixed/authorized construction must revalidate the exact snapshot at its actual build boundary or otherwise protect it from later mutation. This report does not certify a mutable directory for arbitrary future shell execution.

No Docker info/pull/build/start/stop, model, credential, HTTP/API, grants, ACL, official lock/version/bootstrap, canonical tasks/DAG/ledger or live settings operation occurred in this rework. Existing real image/source/OS/mount/principal/Edit-Shell-MCP/recovery/sameRun obligations remain unverified. Root alone performs independent review and serial integration; this author pack cannot close I02 or a business scenario.

# I08 comet-050 TDD record (revision 2026-10-26-comet-050-adoption-v1)

## RED (observed before implementation, real output)

Command: `node --test --test-name-pattern="comet-050" test/infra-recovery.test.js`

    not ok 1 - comet-050 data surfaces are registered item by item (anchor/format/restore prerequisites) without host absolute paths
    not ok 2 - comet-050 backup: native workspace bytes are captured with the native run identity in the manifest
    not ok 3 - comet-050 restore: quarantined native restore reads back the same run identity and the unresolved run retains the workspace (R10)
    not ok 4 - comet-050 negatives: a completed native run releases retention; a live old writer or a live second writer refuses the restore
    not ok 5 - probe comet-050-restore runs the native backup/restore/readback/R10 journey end to end
    # tests 5
    # pass 0
    # fail 5

Failure modes at RED: `comet050DataSurfaces` absent from backup-policy.json;
`--form` unknown to recovery.mjs (exit 1 usage / exit 2); probe case
`comet-050-restore` rejected as unknown (exit 1). Environment present (real
~/.comet workspaces existed), so these are behavior RED, not missing-environment RED.

## GREEN (after implementation)

- `node --test test/infra-recovery.test.js` → 18/18 pass (13 pre-existing + 5 new comet-050)
- `node --test test/infra-backup-restore.test.js` → 13/13 pass (compat entry unaffected)
- `node --test test/delivery-cases/i08.mjs` → 4/4 pass
- `recovery.mjs validate --registry infra/delivery/registry.json` → exit 0, 0 violations, honest catalogGaps unchanged (backup-writer, restore-reader)
- probes: pending-cleanup-denial / quarantine-restore / old-writer-denial / authority-transfer / comet-050-restore → all exit 0 VERIFIED

## Changed files (I08 owns only)

- infra/delivery/recovery/backup-policy.json — comet050DataSurfaces inventory (5 surfaces) + unresolved-comet-run obligation
- infra/delivery/recovery/restore-policy.json — nativeCometForm section (same gates apply)
- infra/delivery/recovery/retention-policy.json — unresolved-comet-run + obligationSource note
- infra/delivery/recovery/operations-runbook.md — forms, data surfaces, R10 obligation list
- tools/infra/recovery.mjs — --form comet-050 (backup/restore/retention), readCometNative, probe comet-050-restore
- test/infra-recovery.test.js — section 8 (5 tests)

## Verified vs UNVERIFIED

VERIFIED locally: comet-050 native backup/restore/readback mechanism (fixtures with
real native-schema bytes + real-host drill on real workspaces), R10 unresolved-comet-run
retention denial, old-writer/second-writer negatives, LLMWiki project tree byte-level
backup+restore, data-surface registration.

UNVERIFIED (honest): cross-machine/real-service restore; Outline PG/Redis/attachment
volume restore (needs deployment-wave docker ops); LLMWiki MCP startup readback (I03/I04
tools, and no sdd-harness wiki DB exists locally); runtime secret resolution
(UNRESOLVED_NO_RUNTIME_SECRET_STORE by design); comet CLI 0.3.9 exposes no
workspace-state read command, so the native readback is performed by recovery.mjs
parsing the native schemas (recorded, not hidden).

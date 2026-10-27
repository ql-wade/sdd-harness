# Recovery Operations Runbook (I08)

Backup / restore / single-authority transfer / R10 retention operations for the
delivery pilot. Spec sources: `infrastructure-tasks.json` I08 (oracle + probes),
`execution-contract.json` V_INFRA_I08 (cli_contract), Backup.v1 / Restore.v1 /
Retention.v1 / AuthorityTransfer.v1 interfaces.

## Entries

- Canonical: `node tools/infra/recovery.mjs <command> ...` — default recovery
  domain dir `infra/delivery/recovery/`.
- Compatibility: `node tools/infra/backup-restore.mjs <command> ...` — the same
  implementation (one `main()`), legacy default domain dir `infra/delivery/backup/`.
  Kept so existing callers (team-recovery drills, delivery-control gate notes)
  keep working unchanged. Exit codes and receipts are identical.

Exit-code contract (both entries): `0` PASS; `1` input/prerequisite invalid
(missing/unparseable file, bad arguments, unknown probe case); `2` verification
failure (semantic violation, inconsistent backup, refused restore/cleanup/transfer,
UNVERIFIED). A missing environment capability is reported as UNVERIFIED with a
non-zero exit — never skip-to-PASS, never mocked.

## Domain documents

- `backup-policy.json` — Backup.v1 scope, manifest (sha256 over real bytes,
  post-write verification), consistency (open transaction blocks backup),
  encryption refs (reference-only). Content unchanged by the naming migration.
- `restore-policy.json` — Restore.v1 quarantine, preconditions, old-writer fence,
  permission reconciliation, five forbidden rules, release gate. Content unchanged.
- `retention-policy.json` — canonical home of the Retention.v1 R10 A boundary:
  pending obligations deny cleanup, disk pressure warns only, `autoCleanupEnabled`
  stays false while recovery terms are unconfirmed, the tool never deletes.
  Extracted from `backup-policy.json.retention` (whose legacy copy remains).
- `authority-transfer.schema.json` — frozen AuthorityTransfer.v1 schema:
  controlled approval (`reason: runner-permanently-lost`), process-level fence
  evidence, epoch bump, single-authority proof. `validate` refuses a tampered file.
- `registry.json` (BackupRegistry.v1) stays single-sourced in
  `infra/delivery/backup/registry.json`; the canonical default domain reads it
  from there through an explicit fail-closed fallback. Any other `--dir` must
  carry its own `registry.json` (no silent fallback).
- Secret refs (`backup-writer`, `backup-encryption`, `restore-reader`) are
  referenced, never valued; resolution belongs to the I01 read-only gate and
  reports `UNRESOLVED` / `REF_NOT_REGISTERED` honestly.

## Commands

```
recovery.mjs validate  --registry <file> [--dir <domain dir>] [--refs <file>] [--json]
recovery.mjs backup    --workspace <dir> --target <dir> [--form directory|comet-050] [--dir <domain dir>] [--json]
recovery.mjs restore   --backup <dir> --quarantine <dir> [--form directory|comet-050] [--fence-evidence <file>] [--dir <domain dir>] [--json]
recovery.mjs retention --workspace <dir> [--form directory|comet-050] [--disk-pressure <file>] [--migration-approval <file>] [--restore-proof <file>] [--dir <domain dir>] [--json]
recovery.mjs transfer  --state <run-state.json> --approval <file> --fence-evidence <file> --out <file> [--json]
recovery.mjs probe     --case <pending-cleanup-denial|quarantine-restore|old-writer-denial|authority-transfer|comet-050-restore> [--json]
```

## Workspace forms

- `directory` (default) — the legacy directory-form workspace
  (`run-state.json` + `transactions/`/`operations/`/`approvals/`/`knowledge/`/
  `db/`/`objects/`/`config/`/`permissions/`). Point-in-time consistency comes
  from the db/objects watermarks; an open transaction refuses the backup.
- `comet-050` — the native Comet 0.5.0 workspace
  (`~/.comet/workspaces/<id>/: runtime/` change-owners + sdk-runs runtime-store
  checkpoints + state-projections + `.change-owner-partitions.json`, plus
  `observability/`). Run identity and its unresolved status are read from the
  native schemas: `comet.change-owner.v1` (workflow/change/runId) and
  `comet.runtime-store-snapshot.v2` (`record.status`). The runtime-store
  checkpoint hash is the point-in-time anchor (a manifest without a checkpoint
  carries no consistent anchor and never enables a restore). The same restore
  gates apply unchanged: quarantine, process-level old-writer fence, no live
  second writer, same-operation readback from the native schemas, publish
  frozen through release.

## Backup data surfaces (comet-050 adoption, revision 2026-10-26-comet-050-adoption-v1)

The full inventory is registered item by item (anchor / format / restore
prerequisites / honest status) in `backup-policy.json.comet050DataSurfaces`:

- `comet-workspaces` — native Comet 0.5.0 state (`--form comet-050`), mechanism
  verified locally plus a real-host drill in
  `openspec/changes/delivery-foundation-rearchitecture/worker-reports/I08-comet-050/`.
- `llmwiki-project` — the vendored LLMWiki project tree (repo-relative);
  directory restore byte-verified in the real-host drill; MCP startup readback
  belongs to the I03/I04 tools.
- `llmwiki-wiki-home` — the LLMWiki wiki data home (`$SDD_WIKI_HOME`, else
  `~/.sdd/wiki/<project-slug>`); no sdd-harness wiki DB exists locally as of
  2026-10-26 (registered honestly; the only wiki under `~/.sdd/wiki` belongs to
  another project).
- `outline-stack` — Outline team knowledge stack (compose config + `outline_outline-db`
  PostgreSQL volume + Redis); restore UNVERIFIED — requires deployment-wave
  docker operations.
- `outline-attachments` — the `outline_outline-attachments` object-store volume;
  restore UNVERIFIED for the same reason, and it must stay point-in-time
  consistent with the PG volume.

## Operating boundaries (spec-frozen)

- A backup exists only at a consistent point in time: an open transaction refuses
  the backup; db/objects watermarks must agree before a restore may enable.
- Restore enables only after: manifest digest verification over real bytes,
  registered encryption-key refs, point-in-time consistency, no live second
  writer at the target, old-writer process-level fence (a live pid refutes any
  gone-claim; shared-directory reregistration is a masquerade), quarantined copy
  with independent byte readback, and same-operation identity verification.
  Publishing stays frozen; restored ACL/membership are data until the current
  authority re-authenticates; superseded-epoch receipts stay excluded.
- R10 A: a sole workspace with pending obligations (pending Outline publish,
  unknown remote result, sole-copy payload, open transaction, pending knowledge
  closeout, or an unresolved native comet run whose runtime-store checkpoint
  `record.status` is not `completed`) is never cleaned. The boundary moves only
  on verified completion or a separately approved migration whose restore is
  proven (`verified=true` + `sameOperationReadback=true`).
- Cross-machine / real-service restore, and the knowledge database + attachment
  backup channel (postgres/object storage), stay UNVERIFIED until the backup
  owner and the deployment wave prove them in their own environment. Never
  upgrade UNVERIFIED to PASS from a local directory drill.

## Verification

```
node --test test/infra-recovery.test.js
```

Contract probes: `validate` clean, plus `probe --case pending-cleanup-denial`,
`quarantine-restore`, `old-writer-denial` (see `infrastructure-tasks.json` I08).

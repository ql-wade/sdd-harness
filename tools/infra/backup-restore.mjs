#!/usr/bin/env node
// Compatibility entry (I08 rework naming migration, 2026-10): the canonical I08
// CLI is tools/infra/recovery.mjs (see open decision I08_FILENAME_DEVIATION and
// infra/delivery/recovery/operations-runbook.md). This entry stays only so
// existing callers keep their entry point; it delegates to the same main() with
// the legacy default domain dir infra/delivery/backup/ (which holds registry.json
// single-sourced plus compat copies of the recovery policies). Receipts and the
// exit-code contract (0 PASS / 1 input / 2 verification) are identical. An
// explicit --dir from the caller still wins (last occurrence parses last).
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { main } from './recovery.mjs';

const legacyDomainDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'infra', 'delivery', 'backup');
const args = process.argv.slice(2);
const argv = args.length > 0 && !args[0].startsWith('--')
  ? [args[0], '--dir', legacyDomainDir, ...args.slice(1)]
  : args;
process.exit(await main(argv));

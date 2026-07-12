import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '..');
const nightlyPath = path.join(repoRoot, 'scripts', 'live-e2e-nightly.js');

test('nightly orchestrator fails closed when its approved fixture or driver is missing', () => {
  const result = spawnSync(process.execPath, [nightlyPath], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { PATH: process.env.PATH },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /SDD_LIVE_FIXTURE is required/);
});

test('nightly orchestrator does not trust a driver JSON claim without finalizable receipts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-nightly-'));
  const fixture = path.join(root, 'fixture');
  const output = path.join(root, 'reports');
  const driver = path.join(root, 'driver.js');
  fs.mkdirSync(fixture);
  fs.writeFileSync(path.join(fixture, 'package.json'), JSON.stringify({ name: 'fixture' }));
  fs.writeFileSync(driver, `#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
const workspace = args[args.indexOf('--workspace') + 1];
const ledger = path.join(workspace, '.sdd-live-ledger.json');
fs.writeFileSync(ledger, JSON.stringify({ schemaVersion: 1, receipts: [] }));
process.stdout.write(JSON.stringify({ pass: true, change: 'forged', ledger }) + '\\n');
`);
  fs.chmodSync(driver, 0o755);

  const result = spawnSync(process.execPath, [nightlyPath], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      SDD_LIVE_FIXTURE: fixture,
      SDD_LIVE_DRIVER: driver,
      SDD_LIVE_OUTPUT: output,
      SDD_LIVE_DRIVER_TIMEOUT_MS: '5000',
    },
  });
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /WORKFLOW_NOT_COMPLETED|CAPABILITY_RECEIPT_MISSING/);
});

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '..');
const gatePath = path.join(repoRoot, 'scripts', 'assert-live-report.js');

function runGate(report) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-live-gate-'));
  const reportPath = path.join(dir, 'report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report));
  return spawnSync(process.execPath, [gatePath, '--report', reportPath], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

test('live release gate accepts only a complete passing final report', () => {
  const result = runGate({
    schemaVersion: 1,
    mode: 'finalize',
    pass: true,
    fixtureHashBefore: 'same',
    fixtureHashAfter: 'same',
    workflow: { current: 'archive', runStatus: 'completed' },
    capabilities: [{ capability: 'browser', pass: true }],
    issues: [],
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(JSON.parse(result.stdout).pass, true);
});

test('live release gate rejects an incomplete or self-declared passing report', () => {
  const result = runGate({
    schemaVersion: 1,
    mode: 'finalize',
    pass: true,
    fixtureHashBefore: 'before',
    fixtureHashAfter: 'after',
    workflow: { current: 'review', runStatus: 'active' },
    capabilities: [{ capability: 'review', pass: false }],
    issues: [{ code: 'REVIEW_MISSING' }],
  });
  assert.equal(result.status, 2, result.stderr || result.stdout);
  assert.equal(JSON.parse(result.stdout).pass, false);
});

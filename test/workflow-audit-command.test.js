import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '..');
const cliPath = path.join(repoRoot, 'bin', 'cli.js');

test('workflow-audit rejects an archived run whose latest review is not ready', () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-workflow-audit-'));
  const run = 'invalid-archive-a1b2';
  const runsDir = path.join(project, '.sdd', 'runs', run);
  fs.mkdirSync(runsDir, { recursive: true });
  fs.writeFileSync(
    path.join(runsDir, 'workflow-frame.yaml'),
    `run_id: ${run}\nstage:\n  current: archive\ngates:\n  status: passed\n`,
  );
  fs.writeFileSync(
    path.join(runsDir, 'review-notes.md'),
    '# Review\n\nSuperpowers verdict: needs-fix\n',
  );

  const result = spawnSync(
    process.execPath,
    [
      cliPath,
      'workflow-audit',
      '--project',
      project,
      '--run',
      run,
      '--json',
    ],
    { cwd: repoRoot, encoding: 'utf8' },
  );

  assert.equal(result.status, 2, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.pass, false);
  assert.equal(report.stage, 'archive');
  assert.equal(report.declaredGateStatus, 'passed');
  assert.equal(report.issues.some((issue) => issue.gate === 'review'), true);
});

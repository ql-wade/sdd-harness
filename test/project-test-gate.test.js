import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runProjectTestGate } from '../lib/project-test-gate.js';

function makeNodeProject(testScript) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-project-test-gate-'));
  fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({
    scripts: testScript ? { test: testScript } : {},
  }));
  return project;
}

test('project test gate runs the manifest test command and captures success', () => {
  const project = makeNodeProject('node -e "process.exit(0)"');
  const evidenceDir = path.join(project, '.sdd', 'runs', 'current');

  const result = runProjectTestGate({ projectDir: project, evidenceDir });

  assert.equal(result.pass, true);
  assert.equal(result.command, 'npm test');
  assert.equal(result.exitCode, 0);
  const outputPath = path.join(evidenceDir, 'code-test-output.txt');
  const reportPath = path.join(evidenceDir, 'code-test-report.json');
  assert.equal(fs.existsSync(outputPath), true);
  assert.equal(fs.existsSync(reportPath), true);
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const expectedSha256 = crypto.createHash('sha256')
    .update(fs.readFileSync(outputPath))
    .digest('hex');
  assert.equal(report.pass, true);
  assert.equal(report.command, 'npm test');
  assert.equal(report.exitCode, 0);
  assert.equal(report.outputSha256, expectedSha256);
  assert.equal(report.outputPath, outputPath);
});

test('project test gate rejects a failing or missing test command', () => {
  const failingProject = makeNodeProject('node -e "process.exit(3)"');
  const missingProject = makeNodeProject();

  const failed = runProjectTestGate({ projectDir: failingProject });
  const missing = runProjectTestGate({ projectDir: missingProject });

  assert.equal(failed.pass, false);
  assert.equal(failed.exitCode, 3);
  assert.equal(missing.pass, false);
  assert.equal(missing.reason, 'no supported project test command found');
});

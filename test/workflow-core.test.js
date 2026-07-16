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

function makeProject() {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-workflow-core-'));
  fs.mkdirSync(path.join(project, '.sdd'), { recursive: true });
  return project;
}

function runCli(project, args) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: project,
    encoding: 'utf8',
  });
}

function activeRun(project) {
  return fs.readFileSync(path.join(project, '.sdd', 'active-run'), 'utf8').trim();
}

function workflow(project, changeId = activeRun(project)) {
  return fs.readFileSync(
    path.join(project, '.sdd', 'runs', changeId, 'workflow-frame.yaml'),
    'utf8',
  );
}

test('empty Grill scaffolds every required artifact and fails closed without advancing', () => {
  const project = makeProject();

  const result = runCli(project, [
    'run',
    'grill',
    '--slug',
    'empty-grill',
    '--goal',
    'Empty Grill regression',
  ]);

  const changeId = activeRun(project);
  assert.equal(result.status, 2, result.stderr || result.stdout);
  assert.equal(fs.existsSync(
    path.join(project, 'openspec', 'changes', changeId, 'brief.md'),
  ), true);
  assert.match(workflow(project, changeId), /current:\s*grill/);
  assert.doesNotMatch(result.stdout, /0\/0 指标达标/);
});

test('qualified Grill advances atomically with history, required and produced artifacts', () => {
  const project = makeProject();
  const first = runCli(project, [
    'run',
    'grill',
    '--slug',
    'qualified-grill',
    '--goal',
    'Qualified Grill regression',
  ]);
  assert.equal(first.status, 2, first.stderr || first.stdout);
  const changeId = activeRun(project);
  const changeDir = path.join(project, 'openspec', 'changes', changeId);
  fs.writeFileSync(
    path.join(changeDir, 'findings.md'),
    [
      '# Findings',
      '**Term A**',
      '**Term B**',
      '**Term C**',
      '不做 legacy migration',
      '不做 production deploy',
      'ADR-001: workflow state',
      '',
    ].join('\n'),
  );
  fs.writeFileSync(path.join(changeDir, 'brief.md'), 'route: product\n');

  const result = runCli(project, ['run', 'grill', '--change', changeId]);
  const frame = workflow(project, changeId);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(frame, /current:\s*product/);
  assert.match(frame, /from:\s*"grill"/);
  assert.match(frame, /to:\s*"product"/);
  assert.match(
    frame,
    /required:\s*\["proposal\.md","acceptance-criteria\.md","functional-test-draft\.yaml"\]/,
  );
  assert.match(frame, /produced:\s*\["findings\.md","brief\.md"\]/);
});

test('generated change ids collapse repeated separators before adding the hash', () => {
  const project = makeProject();

  const result = runCli(project, [
    'run',
    'grill',
    '--slug',
    'pc-payment-refund-split-',
    '--goal',
    'Slug normalization',
  ]);

  assert.equal(result.status, 2, result.stderr || result.stdout);
  assert.match(activeRun(project), /^pc-payment-refund-split-[a-f0-9]{4}$/);
  assert.equal(activeRun(project).includes('--'), false);
});

test('check returns exit 2 when a stage has no metric definition', () => {
  const project = makeProject();
  const first = runCli(project, [
    'run',
    'grill',
    '--slug',
    'missing-metrics',
    '--goal',
    'Missing metrics',
  ]);
  assert.equal(first.status, 2, first.stderr || first.stdout);

  const result = runCli(project, ['check', 'not-a-stage']);

  assert.equal(result.status, 2, result.stderr || result.stdout);
  assert.match(result.stdout, /无指标定义/);
  assert.doesNotMatch(result.stdout, /阶段产出合理/);
});

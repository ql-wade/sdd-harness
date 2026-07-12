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

function runCli(project, args) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: project,
    encoding: 'utf8',
    env: {
      ...process.env,
      SDD_HOME: path.join(project, '.test-sdd-home'),
      SDD_WIKI_HOME: path.join(project, '.test-wiki'),
    },
  });
}

function readWorkflow(project, changeId) {
  return fs.readFileSync(
    path.join(project, '.sdd', 'runs', changeId, 'workflow-frame.yaml'),
    'utf8',
  );
}

test('core workflow completes all nine stages through the CLI control plane', () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-core-e2e-'));

  const bootstrap = runCli(project, [
    'run',
    'grill',
    '--goal',
    'prove the control plane',
    '--slug',
    'control-plane',
  ]);

  assert.equal(bootstrap.status, 2, bootstrap.stderr || bootstrap.stdout);
  assert.match(bootstrap.stdout, /内容未达标/);
  const changeId = fs.readFileSync(path.join(project, '.sdd', 'active-run'), 'utf8').trim();
  const changeDir = path.join(project, 'openspec', 'changes', changeId);
  assert.match(readWorkflow(project, changeId), /current:\s*grill/);

  fs.writeFileSync(
    path.join(changeDir, 'findings.md'),
    [
      '# Findings',
      '**Control Plane**: CLI owns transitions.',
      '**Adapter**: produces artifacts.',
      '**Gate**: verifies disk facts.',
      'Non-goal: skills do not mutate workflow state.',
      'Non-goal: hooks do not advance stages.',
      'ADR-0012 records the decision.',
    ].join('\n'),
  );
  fs.writeFileSync(path.join(changeDir, 'brief.md'), 'route: new\n');

  const advance = runCli(project, ['run', 'grill', '--change', changeId]);

  assert.equal(advance.status, 0, advance.stderr || advance.stdout);
  const workflow = readWorkflow(project, changeId);
  assert.match(workflow, /current:\s*product/);
  assert.match(workflow, /from:\s*grill/);
  assert.match(workflow, /to:\s*product/);
  assert.match(workflow, /reason:\s*gate-passed/);

  fs.writeFileSync(
    path.join(changeDir, 'proposal.md'),
    [
      '# Proposal',
      '## User',
      '## Problem',
      '## Scope',
      '## Non-goals',
      '## Metrics',
    ].join('\n'),
  );
  fs.writeFileSync(
    path.join(changeDir, 'acceptance-criteria.md'),
    ['GIVEN one', 'WHEN one', 'THEN one', 'GIVEN two', 'GIVEN three'].join('\n'),
  );
  fs.writeFileSync(
    path.join(changeDir, 'functional-test-draft.yaml'),
    'happy-path: []\nedge-cases: []\nerror-cases: []\n',
  );

  const productAdvance = runCli(project, ['run', 'product', '--change', changeId]);

  assert.equal(productAdvance.status, 0, productAdvance.stderr || productAdvance.stdout);
  const afterProduct = readWorkflow(project, changeId);
  assert.match(afterProduct, /current:\s*dev/);
  assert.equal((afterProduct.match(/- from:/g) || []).length, 2, afterProduct);
  assert.match(afterProduct, /from:\s*product/);
  assert.match(afterProduct, /to:\s*dev/);

  const rollback = runCli(project, [
    'rollback',
    '--change',
    changeId,
    '--to',
    'product',
    '--reason',
    'acceptance criteria changed',
  ]);

  assert.equal(rollback.status, 0, rollback.stderr || rollback.stdout);
  const afterRollback = readWorkflow(project, changeId);
  assert.match(afterRollback, /current:\s*product/);
  assert.equal((afterRollback.match(/- from:/g) || []).length, 3, afterRollback);
  assert.match(afterRollback, /reason:\s*"acceptance criteria changed"/);

  assert.equal(
    runCli(project, ['run', 'product', '--change', changeId]).status,
    0,
  );

  const specDir = path.join(changeDir, 'specs', 'control-plane');
  fs.mkdirSync(specDir, { recursive: true });
  fs.writeFileSync(path.join(specDir, 'spec.md'), '# ADDED Requirements\n');
  fs.writeFileSync(
    path.join(changeDir, 'design.md'),
    '# Design\n## File Structure Plan\n_Boundary:_ CLI owns state\n',
  );
  fs.writeFileSync(
    path.join(changeDir, 'tasks.md'),
    '# Tasks\n- [ ] T1: core\n  _Boundary:_ lib\n- [ ] T2: adapter\n  _Boundary:_ templates\n',
  );
  const devAdvance = runCli(project, ['run', 'dev', '--change', changeId]);
  assert.equal(devAdvance.status, 0, devAdvance.stderr || devAdvance.stdout);

  fs.mkdirSync(path.join(project, 'src'), { recursive: true });
  fs.writeFileSync(path.join(project, 'src', 'main.js'), 'export const value = 1;\n');
  fs.writeFileSync(path.join(project, 'src', 'helper.js'), 'export const helper = true;\n');
  fs.writeFileSync(
    path.join(project, 'src', 'main.test.js'),
    "import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('value',()=>assert.equal(1,1));\n",
  );
  fs.writeFileSync(
    path.join(project, 'package.json'),
    JSON.stringify({ type: 'module', scripts: { test: 'node --test' } }),
  );
  const wikiHome = path.join(project, '.test-wiki');
  fs.mkdirSync(path.join(wikiHome, 'wiki', 'testing', 'matrices'), { recursive: true });
  fs.mkdirSync(path.join(wikiHome, 'wiki', 'testing', 'cases'), { recursive: true });
  fs.writeFileSync(
    path.join(wikiHome, 'wiki', 'testing', 'matrices', 'test-matrix.md'),
    '| feature | unit | e2e |\n| --- | --- | --- |\n| core | yes | yes |\n| adapter | yes | yes |\n',
  );
  fs.writeFileSync(
    path.join(wikiHome, 'wiki', 'testing', 'cases', 'TC-core.md'),
    '# Core lifecycle\n',
  );
  const testAdvance = runCli(project, ['run', 'test', '--change', changeId]);
  assert.equal(testAdvance.status, 0, testAdvance.stderr || testAdvance.stdout);
  assert.match(
    readWorkflow(project, changeId),
    /current:\s*code/,
    testAdvance.stderr || testAdvance.stdout,
  );

  fs.writeFileSync(
    path.join(changeDir, 'progress.md'),
    [
      '# Progress',
      '## code',
      '- project test pass',
      '## verify',
      '- CI pass evidence',
      '- coverage pass',
      '- perf waiver',
      '- failure classification: none',
      '## release',
      '- mode manual',
      '- rollback: restore previous package',
    ].join('\n'),
  );
  const codeAdvance = runCli(project, ['run', 'code', '--change', changeId]);
  assert.equal(codeAdvance.status, 0, codeAdvance.stderr || codeAdvance.stdout);

  const runsDir = path.join(project, '.sdd', 'runs', changeId);
  fs.writeFileSync(
    path.join(runsDir, 'review-notes.md'),
    '# Review\n\nSuperpowers verdict: ready\n\nOCR triage: fixed\n',
  );
  const reviewAdvance = runCli(project, ['run', 'review', '--change', changeId]);
  assert.equal(reviewAdvance.status, 0, reviewAdvance.stderr || reviewAdvance.stdout);

  fs.writeFileSync(path.join(changeDir, 'tasks.md'), '# Tasks\n- [x] T1 core\n- [x] T2 adapter\n');
  const probeEvidence = path.join(runsDir, 'probe-evidence.json');
  fs.copyFileSync(
    path.join(repoRoot, 'test', 'fixtures', 'probe', 'good', 'evidence.json'),
    probeEvidence,
  );
  fs.copyFileSync(
    path.join(repoRoot, 'test', 'fixtures', 'probe', 'good', 'index.html'),
    path.join(project, 'index.html'),
  );
  const probe = runCli(project, [
    'probe', '--project', project, '--evidence', probeEvidence, '--json',
  ]);
  assert.equal(probe.status, 0, probe.stderr || probe.stdout);
  fs.writeFileSync(path.join(runsDir, 'probe-report.json'), probe.stdout.trim());

  const testOutput = path.join(runsDir, 'npm-test.txt');
  fs.writeFileSync(testOutput, 'Tests  1 passed (1)\n');
  const audit = runCli(project, [
    'evidence-audit',
    '--project', project,
    '--change', changeId,
    '--run', changeId,
    '--test-output', testOutput,
    '--json',
  ]);
  assert.equal(audit.status, 0, audit.stderr || audit.stdout);
  fs.writeFileSync(path.join(runsDir, 'evidence-audit-report.json'), audit.stdout.trim());

  const verifyAdvance = runCli(project, ['run', 'verify', '--change', changeId]);
  assert.equal(verifyAdvance.status, 0, verifyAdvance.stderr || verifyAdvance.stdout);
  const releaseAdvance = runCli(project, [
    'run', 'release', '--change', changeId, '--mode', 'manual',
  ]);
  assert.equal(releaseAdvance.status, 0, releaseAdvance.stderr || releaseAdvance.stdout);
  assert.match(readWorkflow(project, changeId), /^deploy_mode:\s*manual$/m);
  const archiveComplete = runCli(project, ['run', 'archive', '--change', changeId]);
  assert.equal(archiveComplete.status, 0, archiveComplete.stderr || archiveComplete.stdout);

  const completed = readWorkflow(project, changeId);
  assert.match(completed, /current:\s*archive/);
  assert.match(completed, /^run_status:\s*completed$/m);
  assert.equal((completed.match(/- from:/g) || []).length, 10, completed);
});

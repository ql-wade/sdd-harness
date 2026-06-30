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

function makeProject(opts = {}) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-deliverable-'));
  const run = opts.run || 'test-run';
  const runsDir = path.join(project, '.sdd', 'runs', run);
  const changeDir = opts.archived
    ? path.join(project, 'openspec', 'changes', 'archive', `2026-01-01-${run}`)
    : path.join(project, 'openspec', 'changes', run);
  const wikiDir = path.join(project, 'llmwiki', 'wiki');
  fs.mkdirSync(runsDir, { recursive: true });
  fs.mkdirSync(changeDir, { recursive: true });
  fs.mkdirSync(wikiDir, { recursive: true });
  return { project, run, runsDir, changeDir, wikiDir };
}

function runAudit(project, run, extraArgs = []) {
  return spawnSync(
    process.execPath,
    [cliPath, 'deliverable-audit', '--project', project, '--run', run, '--json', ...extraArgs],
    { cwd: repoRoot, encoding: 'utf8' },
  );
}

test('deliverable-audit reports all required deliverables present for a complete run', () => {
  const { project, run, runsDir, changeDir, wikiDir } = makeProject();

  // Grill
  fs.writeFileSync(path.join(changeDir, 'findings.md'), '# Findings\n\nSome findings content here with ADR-001\n'.repeat(5));

  // Product
  fs.writeFileSync(path.join(changeDir, 'proposal.md'), '# PRD\n\n'.repeat(10));
  fs.writeFileSync(path.join(changeDir, 'acceptance-criteria.md'), '# AC\n\n'.repeat(10));

  // Dev
  fs.writeFileSync(path.join(changeDir, 'design.md'), '# Design\n\nworld → render → player layer boundary\n'.repeat(5));
  fs.writeFileSync(path.join(changeDir, 'tasks.md'), '# Tasks\n\n- [x] T1 done\n');
  fs.mkdirSync(path.join(changeDir, 'specs', 'world'), { recursive: true });
  fs.writeFileSync(path.join(changeDir, 'specs', 'world', 'spec.md'), '# World spec\n');

  // Test
  fs.mkdirSync(path.join(wikiDir, 'testing', 'cases'), { recursive: true });
  fs.writeFileSync(path.join(wikiDir, 'testing', 'cases', 'TC-test.md'), '# TC\n');
  fs.mkdirSync(path.join(wikiDir, 'testing', 'matrices'), { recursive: true });
  fs.writeFileSync(path.join(wikiDir, 'testing', 'matrices', 'test-matrix.md'), '# Matrix\n');

  // Review
  fs.writeFileSync(path.join(runsDir, 'review-notes.md'), '# Review\n\nSuperpowers verdict: ready\n');

  // Verify
  fs.writeFileSync(path.join(runsDir, 'probe-report.json'), JSON.stringify({ pass: true }));
  fs.writeFileSync(path.join(runsDir, 'evidence-audit-report.json'), JSON.stringify({ pass: true }));

  // Archive
  fs.mkdirSync(path.join(project, 'openspec', 'specs', 'world'), { recursive: true });
  fs.writeFileSync(path.join(project, 'openspec', 'specs', 'world', 'spec.md'), '# World\n');

  // workflow-frame: archive
  fs.writeFileSync(
    path.join(runsDir, 'workflow-frame.yaml'),
    `run_id: ${run}\nstage:\n  current: archive\ngates:\n  status: passed\n`,
  );

  const result = runAudit(project, run);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.pass, true);
  assert.equal(report.requiredFailures.length, 0);
});

test('deliverable-audit flags missing required deliverables', () => {
  const { project, run, runsDir } = makeProject();

  // Only workflow-frame, no deliverables at all
  fs.writeFileSync(
    path.join(runsDir, 'workflow-frame.yaml'),
    `run_id: ${run}\nstage:\n  current: product\ngates:\n  status: pending\n`,
  );

  const result = runAudit(project, run);
  assert.equal(result.status, 2, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.pass, false);
  // grill stage: findings missing
  assert.ok(report.requiredFailures.some(r => r.id === 'FINDINGS_EXISTS'));
  // product stage: proposal + AC missing
  assert.ok(report.requiredFailures.some(r => r.id === 'PROPOSAL_EXISTS'));
  assert.ok(report.requiredFailures.some(r => r.id === 'AC_EXISTS'));
});

test('deliverable-audit reports expected (non-blocking) gaps', () => {
  const { project, run, runsDir, changeDir, wikiDir } = makeProject();

  // Complete required deliverables but skip expected ones
  fs.writeFileSync(path.join(changeDir, 'findings.md'), '# Findings\n\nADR-001 content here with enough text\n'.repeat(5));
  fs.writeFileSync(path.join(changeDir, 'proposal.md'), '# PRD\n'.repeat(10));
  fs.writeFileSync(path.join(changeDir, 'acceptance-criteria.md'), '# AC\n\nAcceptance criteria detail\n'.repeat(10));
  fs.writeFileSync(path.join(changeDir, 'design.md'), '# Design\nboundary layer\n'.repeat(5));
  fs.writeFileSync(path.join(changeDir, 'tasks.md'), '# Tasks\n- [x] T1\n');
  fs.mkdirSync(path.join(changeDir, 'specs', 'mod'), { recursive: true });
  fs.writeFileSync(path.join(changeDir, 'specs', 'mod', 'spec.md'), '# Spec\n');
  fs.mkdirSync(path.join(wikiDir, 'testing', 'cases'), { recursive: true });
  fs.writeFileSync(path.join(wikiDir, 'testing', 'cases', 'TC-1.md'), '# TC\n');
  fs.mkdirSync(path.join(wikiDir, 'testing', 'matrices'), { recursive: true });
  fs.writeFileSync(path.join(wikiDir, 'testing', 'matrices', 'test-matrix.md'), '# Matrix\n');
  fs.writeFileSync(path.join(runsDir, 'review-notes.md'), 'verdict: ready\n');
  fs.writeFileSync(path.join(runsDir, 'probe-report.json'), JSON.stringify({ pass: true }));
  fs.writeFileSync(path.join(runsDir, 'evidence-audit-report.json'), JSON.stringify({ pass: true }));
  fs.mkdirSync(path.join(project, 'openspec', 'specs', 'mod'), { recursive: true });
  fs.writeFileSync(path.join(project, 'openspec', 'specs', 'mod', 'spec.md'), '# Spec\n');
  fs.writeFileSync(
    path.join(runsDir, 'workflow-frame.yaml'),
    `run_id: ${run}\nstage:\n  current: archive\ngates:\n  status: passed\n`,
  );

  const result = runAudit(project, run);
  // required all pass → exit 0, but expected gaps exist
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.pass, true);
  assert.ok(report.expectedFailures.length > 0, 'should have expected failures');
  // AC not split
  assert.ok(report.expectedFailures.some(r => r.id === 'AC_SPLIT'));
  // ADR not archived
  assert.ok(report.expectedFailures.some(r => r.id === 'ADR_ARCHIVED'));
  // concepts empty
  assert.ok(report.expectedFailures.some(r => r.id === 'CONCEPTS_EXTRACTED'));
});

test('deliverable-audit respects --stage filter', () => {
  const { project, run, runsDir, changeDir } = makeProject();

  fs.writeFileSync(path.join(changeDir, 'findings.md'), '# Findings\n'.repeat(5));
  fs.writeFileSync(
    path.join(runsDir, 'workflow-frame.yaml'),
    `run_id: ${run}\nstage:\n  current: archive\n`,
  );

  const result = runAudit(project, run, ['--stage', 'grill']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.checkedStages, ['grill']);
  assert.equal(report.results.length, 2); // FINDINGS_EXISTS + ADR_ARCHIVED
});

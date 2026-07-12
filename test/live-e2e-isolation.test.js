import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '..');
const runnerPath = path.join(repoRoot, 'scripts', 'live-e2e.js');
const requiredCapabilities = [
  'spec-engine',
  'agent-host',
  'knowledge-base',
  'code-graph',
  'project-tests',
  'architecture-review',
  'line-review',
  'browser',
  'deploy',
];

function prepareFixture() {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-live-fixture-'));
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-live-report-'));
  fs.mkdirSync(path.join(fixture, 'src'), { recursive: true });
  fs.writeFileSync(path.join(fixture, 'src', 'main.ts'), 'export const value = 1;\n');
  fs.writeFileSync(path.join(fixture, 'package.json'), JSON.stringify({ name: 'fixture' }));
  const result = spawnSync(
    process.execPath,
    [runnerPath, '--fixture', fixture, '--output', outputDir, '--prepare-only'],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return { fixture, outputDir, prepare: JSON.parse(result.stdout) };
}

test('live E2E prepares an isolated git workspace without modifying the source fixture', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-live-fixture-'));
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-live-report-'));
  fs.mkdirSync(path.join(fixture, 'src'), { recursive: true });
  fs.mkdirSync(path.join(fixture, 'node_modules', 'pkg'), { recursive: true });
  fs.mkdirSync(path.join(fixture, 'dist'), { recursive: true });
  fs.mkdirSync(path.join(fixture, '.sdd', 'runs', 'old'), { recursive: true });
  fs.mkdirSync(path.join(fixture, 'openspec', 'changes'), { recursive: true });
  fs.writeFileSync(path.join(fixture, 'src', 'main.ts'), 'export const value = 1;\n');
  fs.writeFileSync(path.join(fixture, 'package.json'), JSON.stringify({ name: 'fixture' }));
  fs.writeFileSync(path.join(fixture, 'node_modules', 'pkg', 'index.js'), 'ignored');
  fs.writeFileSync(path.join(fixture, 'dist', 'bundle.js'), 'ignored');
  fs.writeFileSync(path.join(fixture, '.sdd', 'runs', 'old', 'report.json'), '{}');

  const result = spawnSync(
    process.execPath,
    [runnerPath, '--fixture', fixture, '--output', outputDir, '--prepare-only'],
    { cwd: repoRoot, encoding: 'utf8' },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.pass, true);
  assert.equal(report.fixtureHashBefore, report.fixtureHashAfter);
  assert.ok(fs.existsSync(path.join(report.workspace, '.git')));
  assert.ok(fs.existsSync(path.join(report.workspace, 'src', 'main.ts')));
  assert.equal(fs.existsSync(path.join(report.workspace, 'node_modules')), false);
  assert.equal(fs.existsSync(path.join(report.workspace, 'dist')), false);
  assert.equal(fs.existsSync(path.join(report.workspace, '.sdd')), false);
  assert.equal(fs.existsSync(path.join(report.workspace, 'openspec')), false);
  assert.ok(fs.existsSync(report.reportPath));
});

test('live E2E command recorder captures exact output and a verifiable receipt', () => {
  const { prepare } = prepareFixture();
  const ledger = path.join(prepare.workspace, '.sdd-live-ledger.json');
  const result = spawnSync(
    process.execPath,
    [
      runnerPath,
      '--record',
      '--workspace', prepare.workspace,
      '--ledger', ledger,
      '--id', 'project-tests',
      '--', process.execPath, '-e', 'process.stdout.write("159 tests passed")',
    ],
    { cwd: repoRoot, encoding: 'utf8' },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.status, 'passed');
  assert.equal(receipt.source, 'runner');
  assert.equal(receipt.exitCode, 0);
  assert.ok(fs.existsSync(receipt.outputPath));
  assert.match(fs.readFileSync(receipt.outputPath, 'utf8'), /159 tests passed/);
  assert.equal(JSON.parse(fs.readFileSync(ledger, 'utf8')).receipts.length, 1);
});

test('live E2E command recorder times out and records a failed receipt', () => {
  const { prepare } = prepareFixture();
  const ledger = path.join(prepare.workspace, '.sdd-live-ledger.json');
  const result = spawnSync(
    process.execPath,
    [
      runnerPath,
      '--record',
      '--workspace', prepare.workspace,
      '--ledger', ledger,
      '--id', 'agent-host',
      '--timeout-ms', '50',
      '--', process.execPath, '-e', 'setTimeout(() => {}, 10000)',
    ],
    { cwd: repoRoot, encoding: 'utf8' },
  );

  assert.equal(result.status, 2, result.stderr || result.stdout);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.status, 'failed');
  assert.equal(receipt.timedOut, true);
  assert.equal(receipt.exitCode, null);
});

test('live E2E records not-applicable only as a reasoned attestation', () => {
  const { prepare } = prepareFixture();
  const ledger = path.join(prepare.workspace, '.sdd-live-ledger.json');
  const result = spawnSync(
    process.execPath,
    [
      runnerPath,
      '--record-status',
      '--workspace', prepare.workspace,
      '--ledger', ledger,
      '--id', 'deploy',
      '--status', 'not-applicable',
      '--reason', 'isolated validation has no production deploy target',
    ],
    { cwd: repoRoot, encoding: 'utf8' },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.status, 'not-applicable');
  assert.equal(receipt.source, 'attestation');
  assert.match(receipt.reason, /no production deploy target/);
});

test('live E2E finalizer requires a completed nine-stage workflow and every capability receipt', () => {
  const { outputDir, prepare } = prepareFixture();
  const change = 'live-change';
  const runsDir = path.join(prepare.workspace, '.sdd', 'runs', change);
  fs.mkdirSync(runsDir, { recursive: true });
  fs.writeFileSync(
    path.join(runsDir, 'workflow-frame.yaml'),
    [
      `run_id: ${change}`,
      'run_status: active',
      'stage:',
      '  current: grill',
      '  history: []',
      'gates:',
      '  status: pending',
    ].join('\n'),
  );
  const ledger = path.join(prepare.workspace, '.sdd-live-ledger.json');
  fs.writeFileSync(ledger, JSON.stringify({ schemaVersion: 1, receipts: [] }));

  const result = spawnSync(
    process.execPath,
    [
      runnerPath,
      '--finalize',
      '--prepare-report', prepare.reportPath,
      '--workspace', prepare.workspace,
      '--change', change,
      '--ledger', ledger,
      '--output', outputDir,
    ],
    { cwd: repoRoot, encoding: 'utf8' },
  );

  assert.equal(result.status, 2, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.pass, false);
  assert.ok(report.issues.some((item) => item.code === 'WORKFLOW_NOT_COMPLETED'));
  for (const capability of requiredCapabilities) {
    assert.ok(report.issues.some(
      (item) => item.code === 'CAPABILITY_RECEIPT_MISSING' && item.capability === capability,
    ));
  }
  assert.equal(report.fixtureHashBefore, report.fixtureHashAfter);
  assert.ok(fs.existsSync(report.reportPath));
});

test('live E2E finalizer passes only with a completed trace and runner-backed capability receipts', () => {
  const { outputDir, prepare } = prepareFixture();
  const workspaceAlias = path.join(os.tmpdir(), `sdd-live-workspace-alias-${process.pid}-${Date.now()}`);
  fs.symlinkSync(prepare.workspace, workspaceAlias, process.platform === 'win32' ? 'junction' : 'dir');
  const change = 'complete-live-change';
  const runsDir = path.join(prepare.workspace, '.sdd', 'runs', change);
  fs.mkdirSync(runsDir, { recursive: true });
  const history = [
    ['grill', 'product'],
    ['product', 'dev'],
    ['dev', 'test'],
    ['test', 'code'],
    ['code', 'review'],
    ['review', 'verify'],
    ['verify', 'release'],
    ['release', 'archive'],
  ].flatMap(([from, to]) => [`    - from: ${from}`, `      to: ${to}`]);
  fs.writeFileSync(
    path.join(runsDir, 'workflow-frame.yaml'),
    [
      `run_id: ${change}`,
      'run_status: completed',
      'stage:',
      '  current: archive',
      '  history:',
      ...history,
      'gates:',
      '  status: passed',
    ].join('\n'),
  );
  const ledger = path.join(prepare.workspace, '.sdd-live-ledger.json');
  for (const capability of requiredCapabilities) {
    const record = spawnSync(
      process.execPath,
      [
        runnerPath,
        '--record',
        '--workspace', workspaceAlias,
        '--ledger', ledger,
        '--id', capability,
        '--', process.execPath, '-e', `process.stdout.write(${JSON.stringify(`${capability} passed`)})`,
      ],
      { cwd: repoRoot, encoding: 'utf8' },
    );
    assert.equal(record.status, 0, record.stderr || record.stdout);
  }

  const result = spawnSync(
    process.execPath,
    [
      runnerPath,
      '--finalize',
      '--prepare-report', prepare.reportPath,
      '--workspace', prepare.workspace,
      '--change', change,
      '--ledger', ledger,
      '--output', outputDir,
    ],
    { cwd: repoRoot, encoding: 'utf8' },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.pass, true);
  assert.equal(report.issues.length, 0);
  assert.equal(report.capabilities.every((item) => item.pass), true);
});

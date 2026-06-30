import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '..');
const cliPath = path.join(repoRoot, 'bin', 'cli.js');
const changeId = 'evidence-drift-a1b2';
const archivedChangeId = 'archive/2026-06-27-evidence-drift-a1b2';
const runId = 'evidence-drift-runtime';

function makeProject({
  progress = '',
  review = '',
  testOutput = '',
  change = changeId,
  run = changeId,
} = {}) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-evidence-audit-'));
  const changeDir = path.join(project, 'openspec', 'changes', change);
  const runsDir = path.join(project, '.sdd', 'runs', run);
  fs.mkdirSync(path.join(project, 'src'), { recursive: true });
  fs.mkdirSync(changeDir, { recursive: true });
  fs.mkdirSync(runsDir, { recursive: true });
  fs.writeFileSync(path.join(project, 'src', 'main.ts'), 'export const main = 1;\n');
  fs.writeFileSync(path.join(project, 'src', 'world.ts'), 'export const world = 1;\n');
  fs.writeFileSync(path.join(project, 'src', 'render.ts'), 'export const render = 1;\n');
  fs.writeFileSync(path.join(project, 'src', 'world.test.ts'), 'import "node:test";\n');
  fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({
    type: 'module',
    scripts: {
      test: 'vitest run',
      typecheck: 'tsc --noEmit',
    },
    devDependencies: {
      vitest: '^2.1.4',
    },
  }));
  fs.writeFileSync(path.join(changeDir, 'progress.md'), progress);
  fs.writeFileSync(path.join(runsDir, 'review-notes.md'), review);
  const testOutputPath = path.join(runsDir, 'npm-test.txt');
  fs.writeFileSync(path.join(runsDir, 'npm-test.txt'), testOutput);
  return { project, runsDir, testOutputPath };
}

function runAudit(project, testOutputPath, { change = changeId, run } = {}) {
  const args = [
    cliPath,
    'evidence-audit',
    '--project',
    project,
    '--change',
    change,
    '--test-output',
    testOutputPath,
    '--json',
  ];
  if (run) args.splice(args.indexOf('--test-output'), 0, '--run', run);

  return spawnSync(
    process.execPath,
    args,
    { cwd: repoRoot, encoding: 'utf8' },
  );
}

test('evidence-audit rejects stale markdown claims that contradict disk and command output', () => {
  const { project, testOutputPath } = makeProject({
    progress: [
      '# Progress',
      '',
      'progress.md 声明：5 个分层目录、47 case 全 pass。',
      '```',
      'Tests  47 passed (47)',
      '```',
    ].join('\n'),
    review: [
      '# Review',
      '',
      '- `src/` 仅含 2 个文件：`main.ts` + `world.ts`',
      '- **无** `tests/` 目录、**无** `vitest` 依赖、**无** test script',
    ].join('\n'),
    testOutput: [
      'Test Files  1 passed (1)',
      '     Tests  3 passed (3)',
    ].join('\n'),
  });

  const result = runAudit(project, testOutputPath);

  assert.equal(result.status, 2, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.pass, false);
  assert.deepEqual(
    report.issues.map((issue) => issue.code).sort(),
      // After the stale-claim fix:
      //   - source-file-count / no-tests / no-vitest claims are only scanned
      //     in progress.md, not review-notes.md, so claims that appear only in
      //     the review are no longer false-positive flagged.
      //   - progress.md claims "47 case 全 pass" (actual 3) → count mismatch.
      //   - "无 test script" appears in the combined evidence text → still flagged.
      [
        'CLAIMED_TEST_COUNT_MISMATCH',
        'STALE_NO_TEST_SCRIPT_CLAIM',
      ],
  );
});

test('evidence-audit accepts claims that match disk and command output', () => {
  const { project, testOutputPath } = makeProject({
    progress: [
      '# Progress',
      '',
      'Actual source files: 3',
      'Tests  3 passed (3)',
    ].join('\n'),
    review: [
      '# Review',
      '',
      '- `src/` has 3 source files and 1 test file.',
      '- package includes vitest and npm test script.',
    ].join('\n'),
    testOutput: [
      'Test Files  1 passed (1)',
      '     Tests  3 passed (3)',
    ].join('\n'),
  });

  const result = runAudit(project, testOutputPath);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.pass, true);
  assert.deepEqual(report.issues, []);
  assert.equal(report.actual.sourceFiles, 3);
  assert.equal(report.commandOutput.testsPassed, 3);
  assert.ok(report.evidenceSha256, 'audit report must bind the evidence input contents');
  for (const [name, filePath] of Object.entries(report.evidenceFiles)) {
    const expected = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
    assert.equal(report.evidenceSha256[name], expected);
  }
  assert.ok(report.evidenceSha256.packageJson, 'audit report must bind package.json');
  assert.ok(report.evidenceSha256.sourceTree, 'audit report must bind the source tree');
  assert.match(report.evidenceSha256.packageJson, /^[a-f0-9]{64}$/);
  assert.match(report.evidenceSha256.sourceTree, /^[a-f0-9]{64}$/);
});

test('evidence-audit can compare archived OpenSpec evidence with a separate runtime run id', () => {
  const { project, testOutputPath } = makeProject({
    change: archivedChangeId,
    run: runId,
    progress: [
      '# Progress',
      '',
      '`src/` 仅含 2 个文件：`main.ts` + `world.ts`',
      '',
      'Tests  3 passed (3)',
    ].join('\n'),
    review: [
      '# Review',
      '',
      '- `src/` 仅含 2 个文件：`main.ts` + `world.ts`',
    ].join('\n'),
    testOutput: [
      'Test Files  1 passed (1)',
      '     Tests  3 passed (3)',
    ].join('\n'),
  });

  const result = runAudit(project, testOutputPath, {
    change: archivedChangeId,
    run: runId,
  });

  assert.equal(result.status, 2, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.evidenceFiles.review.endsWith(`.sdd/runs/${runId}/review-notes.md`), true);
  assert.equal(
    report.issues.some((issue) => issue.code === 'CLAIMED_SOURCE_FILE_COUNT_MISMATCH'),
    true,
  );
});

test('evidence-audit resolves an archived change when given its bare archive id', () => {
  const bareArchivedChangeId = archivedChangeId.replace('archive/', '');
  const { project, testOutputPath } = makeProject({
    change: archivedChangeId,
    run: runId,
    progress: [
      '# Progress',
      '',
      'Actual source files: 3',
      'Tests  3 passed (3)',
    ].join('\n'),
    review: '# Review\n\n- package includes vitest and npm test script.\n',
    testOutput: [
      'Test Files  1 passed (1)',
      '     Tests  3 passed (3)',
    ].join('\n'),
  });

  const result = runAudit(project, testOutputPath, {
    change: bareArchivedChangeId,
    run: runId,
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.pass, true);
  assert.equal(report.change, bareArchivedChangeId);
  assert.equal(
    report.evidenceFiles.progress.endsWith(`openspec/changes/${archivedChangeId}/progress.md`),
    true,
  );
});

test('evidence-audit rejects missing progress, review, or captured test output', () => {
  const { project, runsDir, testOutputPath } = makeProject({
    progress: 'Tests  3 passed (3)\n',
    review: '# Review\n\nSuperpowers verdict: ready\n',
    testOutput: [
      'Test Files  1 passed (1)',
      '     Tests  3 passed (3)',
    ].join('\n'),
  });
  fs.rmSync(path.join(project, 'openspec', 'changes', changeId, 'progress.md'));
  fs.rmSync(path.join(runsDir, 'review-notes.md'));
  fs.rmSync(testOutputPath);

  const result = runAudit(project, testOutputPath);

  assert.equal(result.status, 2, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.pass, false);
  assert.deepEqual(
    report.issues.find((item) => item.code === 'EVIDENCE_INPUT_MISSING')?.evidence.missing,
    ['progress', 'review', 'testOutput'],
  );
});

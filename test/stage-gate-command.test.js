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
const changeId = 'gate-probe-a1b2';

function makeProject(stage) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-stage-gate-'));
  const changesDir = path.join(project, 'openspec', 'changes', changeId);
  const runsDir = path.join(project, '.sdd', 'runs', changeId);
  fs.mkdirSync(changesDir, { recursive: true });
  fs.mkdirSync(runsDir, { recursive: true });
  fs.mkdirSync(path.join(project, '.sdd'), { recursive: true });
  fs.writeFileSync(path.join(project, '.sdd', 'active-run'), changeId);
  fs.writeFileSync(
    path.join(runsDir, 'workflow-frame.yaml'),
    `run_id: ${changeId}\nstage:\n  current: ${stage}\n  history: []\ngates:\n  status: pending\n`,
  );
  if (['verify', 'release', 'archive'].includes(stage)) {
    fs.writeFileSync(
      path.join(runsDir, 'review-notes.md'),
      '# Review\n\nSuperpowers verdict: ready\n',
    );
  }
  return { project, changesDir, runsDir };
}

function runStage(project, stage, extraArgs = []) {
  return spawnSync(
    process.execPath,
    [cliPath, 'run', stage, '--change', changeId, ...extraArgs],
    { cwd: project, encoding: 'utf8' },
  );
}

function currentStage(runsDir) {
  const workflow = fs.readFileSync(path.join(runsDir, 'workflow-frame.yaml'), 'utf8');
  return workflow.match(/current:\s*(\w+)/)?.[1];
}

function writeProbeEvidence(runsDir) {
  const evidencePath = path.join(runsDir, 'probe-evidence.json');
  fs.writeFileSync(evidencePath, JSON.stringify({ schemaVersion: 1 }));
  return evidencePath;
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function sourceTreeSha256(project) {
  const sourceRoot = path.join(project, 'src');
  const files = [];
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else if (entry.isFile()) files.push(fullPath);
    }
  }
  walk(sourceRoot);
  const hash = crypto.createHash('sha256');
  for (const filePath of files.sort()) {
    hash.update(path.relative(sourceRoot, filePath));
    hash.update('\0');
    hash.update(fs.readFileSync(filePath));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function passingAudit(project) {
  const runsDir = path.join(project, '.sdd', 'runs', changeId);
  const progressPath = path.join(project, 'openspec', 'changes', changeId, 'progress.md');
  const reviewPath = path.join(runsDir, 'review-notes.md');
  const testOutputPath = path.join(runsDir, 'npm-test.txt');
  const sourcePath = path.join(project, 'src', 'main.ts');
  const packagePath = path.join(project, 'package.json');
  fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
  fs.writeFileSync(progressPath, '# Progress\n');
  fs.writeFileSync(reviewPath, '# Review\n\nSuperpowers verdict: ready\n');
  fs.writeFileSync(testOutputPath, 'Tests  1 passed (1)\n');
  fs.writeFileSync(sourcePath, 'export const value = 1;\n');
  fs.writeFileSync(packagePath, JSON.stringify({ scripts: { test: 'node --test' } }));
  return JSON.stringify({
    schemaVersion: 1,
    projectDir: project,
    run: changeId,
    pass: true,
    issues: [],
    evidenceFiles: {
      progress: progressPath,
      review: reviewPath,
      testOutput: testOutputPath,
    },
    evidenceSha256: {
      progress: sha256File(progressPath),
      review: sha256File(reviewPath),
      testOutput: sha256File(testOutputPath),
      packageJson: sha256File(packagePath),
      sourceTree: sourceTreeSha256(project),
    },
  });
}

test('review gate blocks advancement when verdict is not ready', () => {
  const { project, runsDir } = makeProject('review');
  fs.writeFileSync(
    path.join(runsDir, 'review-notes.md'),
    '# Review\n\nSuperpowers verdict: needs-fix\n\nOCR triage: risk\n',
  );

  const result = runStage(project, 'review');

  assert.equal(result.status, 2, result.stderr || result.stdout);
  assert.equal(currentStage(runsDir), 'review');
});

test('review gate ignores historical ready text when authoritative verdict needs fixes', () => {
  const { project, runsDir } = makeProject('review');
  fs.writeFileSync(
    path.join(runsDir, 'review-notes.md'),
    [
      '# Review',
      '',
      'Superpowers verdict: needs-fix',
      '',
      'History: previous verdict: ready before the regression was found.',
    ].join('\n'),
  );

  const result = runStage(project, 'review');

  assert.equal(result.status, 2, result.stderr || result.stdout);
  assert.equal(currentStage(runsDir), 'review');
});

test('review gate uses the last authoritative verdict in an appended review log', () => {
  const { project, runsDir } = makeProject('review');
  fs.writeFileSync(
    path.join(runsDir, 'review-notes.md'),
    [
      '# Review',
      '',
      'Superpowers verdict: ready',
      '',
      '## Re-review after regression',
      '',
      'Superpowers verdict: needs-fix',
    ].join('\n'),
  );

  const result = runStage(project, 'review');

  assert.equal(result.status, 2, result.stderr || result.stdout);
  assert.equal(currentStage(runsDir), 'review');
});

test('review gate advances when verdict is ready', () => {
  const { project, runsDir } = makeProject('review');
  fs.writeFileSync(
    path.join(runsDir, 'review-notes.md'),
    '# Review\n\nSuperpowers verdict: ready\n\nOCR triage: fixed\n',
  );

  const result = runStage(project, 'review');

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(currentStage(runsDir), 'verify');
});

test('verify gate blocks advancement when probe report fails', () => {
  const { project, runsDir } = makeProject('verify');
  fs.writeFileSync(
    path.join(runsDir, 'probe-report.json'),
    JSON.stringify({ schemaVersion: 1, pass: false, issues: [{ code: 'DEBUG_DOM_LEAK' }] }),
  );

  const result = runStage(project, 'verify');

  assert.equal(result.status, 2, result.stderr || result.stdout);
  assert.equal(currentStage(runsDir), 'verify');
});

test('verify gate blocks advancement when evidence audit report fails', () => {
  const { project, runsDir } = makeProject('verify');
  const evidencePath = writeProbeEvidence(runsDir);
  fs.writeFileSync(
    path.join(runsDir, 'probe-report.json'),
    JSON.stringify({
      schemaVersion: 1,
      projectDir: project,
      pass: true,
      issues: [],
      evidencePath,
      evidenceSha256: sha256File(evidencePath),
    }),
  );
  fs.writeFileSync(
    path.join(runsDir, 'evidence-audit-report.json'),
    JSON.stringify({
      schemaVersion: 1,
      pass: false,
      issues: [{ code: 'CLAIMED_TEST_COUNT_MISMATCH' }],
    }),
  );

  const result = runStage(project, 'verify');

  assert.equal(result.status, 2, result.stderr || result.stdout);
  assert.equal(currentStage(runsDir), 'verify');
});

test('verify gate blocks advancement when evidence audit belongs to a different project', () => {
  const { project, runsDir } = makeProject('verify');
  const evidencePath = writeProbeEvidence(runsDir);
  fs.writeFileSync(
    path.join(runsDir, 'probe-report.json'),
    JSON.stringify({
      schemaVersion: 1,
      projectDir: project,
      pass: true,
      issues: [],
      evidencePath,
      evidenceSha256: sha256File(evidencePath),
    }),
  );
  fs.writeFileSync(
    path.join(runsDir, 'evidence-audit-report.json'),
    JSON.stringify({
      schemaVersion: 1,
      projectDir: path.join(project, 'different-project'),
      run: changeId,
      pass: true,
      issues: [],
    }),
  );

  const result = runStage(project, 'verify');

  assert.equal(result.status, 2, result.stderr || result.stdout);
  assert.match(result.stderr + result.stdout, /audit.*project/i);
  assert.equal(currentStage(runsDir), 'verify');
});

test('verify gate blocks advancement when evidence audit belongs to a different run', () => {
  const { project, runsDir } = makeProject('verify');
  const evidencePath = writeProbeEvidence(runsDir);
  fs.writeFileSync(
    path.join(runsDir, 'probe-report.json'),
    JSON.stringify({
      schemaVersion: 1,
      projectDir: project,
      pass: true,
      issues: [],
      evidencePath,
      evidenceSha256: sha256File(evidencePath),
    }),
  );
  fs.writeFileSync(
    path.join(runsDir, 'evidence-audit-report.json'),
    JSON.stringify({
      schemaVersion: 1,
      projectDir: project,
      run: 'different-run',
      pass: true,
      issues: [],
    }),
  );

  const result = runStage(project, 'verify');

  assert.equal(result.status, 2, result.stderr || result.stdout);
  assert.match(result.stderr + result.stdout, /audit.*run/i);
  assert.equal(currentStage(runsDir), 'verify');
});

test('verify gate blocks advancement when audit inputs change after report generation', () => {
  const { project, changesDir, runsDir } = makeProject('verify');
  const evidencePath = writeProbeEvidence(runsDir);
  fs.writeFileSync(
    path.join(runsDir, 'probe-report.json'),
    JSON.stringify({
      schemaVersion: 1,
      projectDir: project,
      pass: true,
      issues: [],
      evidencePath,
      evidenceSha256: sha256File(evidencePath),
    }),
  );
  fs.writeFileSync(
    path.join(runsDir, 'evidence-audit-report.json'),
    passingAudit(project),
  );
  fs.writeFileSync(path.join(changesDir, 'progress.md'), '# Progress\nmutated after audit\n');

  const result = runStage(project, 'verify');

  assert.equal(result.status, 2, result.stderr || result.stdout);
  assert.match(result.stderr + result.stdout, /audit.*sha-?256|audit.*digest/i);
  assert.equal(currentStage(runsDir), 'verify');
});

test('verify gate rejects a passing audit that omits a required evidence input', () => {
  const { project, runsDir } = makeProject('verify');
  const evidencePath = writeProbeEvidence(runsDir);
  fs.writeFileSync(
    path.join(runsDir, 'probe-report.json'),
    JSON.stringify({
      schemaVersion: 1,
      projectDir: project,
      pass: true,
      issues: [],
      evidencePath,
      evidenceSha256: sha256File(evidencePath),
    }),
  );
  const audit = JSON.parse(passingAudit(project));
  fs.rmSync(audit.evidenceFiles.testOutput);
  audit.evidenceSha256.testOutput = null;
  fs.writeFileSync(
    path.join(runsDir, 'evidence-audit-report.json'),
    JSON.stringify(audit),
  );

  const result = runStage(project, 'verify');

  assert.equal(result.status, 2, result.stderr || result.stdout);
  assert.match(result.stderr + result.stdout, /audit.*testOutput.*missing/i);
  assert.equal(currentStage(runsDir), 'verify');
});

test('verify gate blocks advancement when source tree changes after audit generation', () => {
  const { project, runsDir } = makeProject('verify');
  const evidencePath = writeProbeEvidence(runsDir);
  fs.writeFileSync(
    path.join(runsDir, 'probe-report.json'),
    JSON.stringify({
      schemaVersion: 1,
      projectDir: project,
      pass: true,
      issues: [],
      evidencePath,
      evidenceSha256: sha256File(evidencePath),
    }),
  );
  fs.writeFileSync(
    path.join(runsDir, 'evidence-audit-report.json'),
    passingAudit(project),
  );
  fs.writeFileSync(path.join(project, 'src', 'after-audit.ts'), 'export const drift = true;\n');

  const result = runStage(project, 'verify');

  assert.equal(result.status, 2, result.stderr || result.stdout);
  assert.match(result.stderr + result.stdout, /audit.*sha-?256.*sourceTree/i);
  assert.equal(currentStage(runsDir), 'verify');
});

test('verify gate blocks advancement when probe report omits the locked probe profile', () => {
  const { project, runsDir } = makeProject('verify');
  const evidencePath = writeProbeEvidence(runsDir);
  fs.writeFileSync(path.join(runsDir, 'probe-profile'), 'minicraft\n');
  fs.writeFileSync(
    path.join(runsDir, 'probe-report.json'),
    JSON.stringify({
      schemaVersion: 1,
      projectDir: project,
      pass: true,
      issues: [],
      evidencePath,
      evidenceSha256: sha256File(evidencePath),
    }),
  );
  fs.writeFileSync(
    path.join(runsDir, 'evidence-audit-report.json'),
    passingAudit(project),
  );

  const result = runStage(project, 'verify');

  assert.equal(result.status, 2, result.stderr || result.stdout);
  assert.match(result.stderr + result.stdout, /profile/i);
  assert.equal(currentStage(runsDir), 'verify');
});

test('verify gate blocks advancement when probe report was generated from different evidence', () => {
  const { project, runsDir } = makeProject('verify');
  fs.writeFileSync(path.join(runsDir, 'probe-evidence.json'), JSON.stringify({ schemaVersion: 1 }));
  fs.writeFileSync(
    path.join(runsDir, 'probe-report.json'),
    JSON.stringify({
      schemaVersion: 1,
      projectDir: project,
      pass: true,
      issues: [],
      evidencePath: '/tmp/old-probe-evidence.json',
    }),
  );
  fs.writeFileSync(
    path.join(runsDir, 'evidence-audit-report.json'),
    passingAudit(project),
  );

  const result = runStage(project, 'verify');

  assert.equal(result.status, 2, result.stderr || result.stdout);
  assert.match(result.stderr + result.stdout, /probe evidence/i);
  assert.equal(currentStage(runsDir), 'verify');
});

test('verify gate blocks advancement when probe report was generated against a different project', () => {
  const { project, runsDir } = makeProject('verify');
  const evidencePath = writeProbeEvidence(runsDir);
  fs.writeFileSync(
    path.join(runsDir, 'probe-report.json'),
    JSON.stringify({
      schemaVersion: 1,
      projectDir: path.join(project, 'different-project'),
      pass: true,
      issues: [],
      evidencePath,
      evidenceSha256: sha256File(evidencePath),
    }),
  );
  fs.writeFileSync(
    path.join(runsDir, 'evidence-audit-report.json'),
    passingAudit(project),
  );

  const result = runStage(project, 'verify');

  assert.equal(result.status, 2, result.stderr || result.stdout);
  assert.match(result.stderr + result.stdout, /project/i);
  assert.equal(currentStage(runsDir), 'verify');
});

test('verify gate blocks advancement when probe evidence changes after report generation', () => {
  const { project, runsDir } = makeProject('verify');
  const evidencePath = writeProbeEvidence(runsDir);
  const evidenceSha256 = sha256File(evidencePath);
  fs.writeFileSync(
    path.join(runsDir, 'probe-report.json'),
    JSON.stringify({
      schemaVersion: 1,
      projectDir: project,
      pass: true,
      issues: [],
      evidencePath,
      evidenceSha256,
    }),
  );
  fs.writeFileSync(
    path.join(runsDir, 'evidence-audit-report.json'),
    passingAudit(project),
  );
  fs.writeFileSync(evidencePath, JSON.stringify({ schemaVersion: 1, tampered: true }));

  const result = runStage(project, 'verify');

  assert.equal(result.status, 2, result.stderr || result.stdout);
  assert.match(result.stderr + result.stdout, /digest|sha-?256/i);
  assert.equal(currentStage(runsDir), 'verify');
});

test('verify gate advances when probe report passes', () => {
  const { project, runsDir } = makeProject('verify');
  const evidencePath = writeProbeEvidence(runsDir);
  fs.writeFileSync(
    path.join(runsDir, 'probe-report.json'),
    JSON.stringify({
      schemaVersion: 1,
      projectDir: project,
      pass: true,
      issues: [],
      evidencePath,
      evidenceSha256: sha256File(evidencePath),
    }),
  );
  fs.writeFileSync(
    path.join(runsDir, 'evidence-audit-report.json'),
    passingAudit(project),
  );

  const result = runStage(project, 'verify');

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(currentStage(runsDir), 'release');
});

test('verify gate advances when locked probe profile matches the probe report', () => {
  const { project, runsDir } = makeProject('verify');
  const evidencePath = writeProbeEvidence(runsDir);
  fs.writeFileSync(path.join(runsDir, 'probe-profile'), 'minicraft\n');
  fs.writeFileSync(
    path.join(runsDir, 'probe-report.json'),
    JSON.stringify({
      schemaVersion: 1,
      projectDir: project,
      profile: 'minicraft',
      pass: true,
      issues: [],
      evidencePath,
      evidenceSha256: sha256File(evidencePath),
    }),
  );
  fs.writeFileSync(
    path.join(runsDir, 'evidence-audit-report.json'),
    passingAudit(project),
  );

  const result = runStage(project, 'verify');

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(currentStage(runsDir), 'release');
});

test('stage entry blocks direct archive while workflow is still at verify', () => {
  const { project, runsDir } = makeProject('verify');
  fs.writeFileSync(
    path.join(runsDir, 'probe-report.json'),
    JSON.stringify({ schemaVersion: 1, pass: false, issues: [{ code: 'DEBUG_DOM_LEAK' }] }),
  );

  const result = runStage(project, 'archive');

  assert.equal(result.status, 2, result.stderr || result.stdout);
  assert.equal(currentStage(runsDir), 'verify');
});

test('release skip cannot bypass a failed verify probe', () => {
  const { project, runsDir } = makeProject('verify');
  fs.writeFileSync(
    path.join(runsDir, 'probe-report.json'),
    JSON.stringify({ schemaVersion: 1, pass: false, issues: [{ code: 'DOCUMENT_OVERFLOW' }] }),
  );

  const result = runStage(project, 'release', ['--mode', 'skip']);

  assert.equal(result.status, 2, result.stderr || result.stdout);
  assert.equal(currentStage(runsDir), 'verify');
});

test('release skip cannot bypass incomplete tasks', () => {
  const { project, changesDir, runsDir } = makeProject('verify');
  fs.writeFileSync(path.join(changesDir, 'tasks.md'), '# Tasks\n- [ ] T1 incomplete\n');
  const evidencePath = writeProbeEvidence(runsDir);
  fs.writeFileSync(
    path.join(runsDir, 'probe-report.json'),
    JSON.stringify({
      schemaVersion: 1,
      projectDir: project,
      pass: true,
      issues: [],
      evidencePath,
      evidenceSha256: sha256File(evidencePath),
    }),
  );
  fs.writeFileSync(
    path.join(runsDir, 'evidence-audit-report.json'),
    passingAudit(project),
  );

  const result = runStage(project, 'release', ['--mode', 'skip']);

  assert.equal(result.status, 2, result.stderr || result.stdout);
  assert.match(result.stderr + result.stdout, /tasks?.*(?:incomplete|未完成)/i);
  assert.equal(currentStage(runsDir), 'verify');
});

test('release skip records workflow metadata without mutating audited progress', () => {
  const { project, changesDir, runsDir } = makeProject('verify');
  fs.writeFileSync(path.join(changesDir, 'tasks.md'), '# Tasks\n- [x] T1 complete\n');
  const evidencePath = writeProbeEvidence(runsDir);
  fs.writeFileSync(
    path.join(runsDir, 'probe-report.json'),
    JSON.stringify({
      schemaVersion: 1,
      projectDir: project,
      pass: true,
      issues: [],
      evidencePath,
      evidenceSha256: sha256File(evidencePath),
    }),
  );
  fs.writeFileSync(
    path.join(runsDir, 'evidence-audit-report.json'),
    passingAudit(project),
  );
  const progressPath = path.join(changesDir, 'progress.md');
  const beforeProgress = fs.readFileSync(progressPath, 'utf8');

  const result = runStage(project, 'release', ['--mode', 'skip']);
  const frame = fs.readFileSync(path.join(runsDir, 'workflow-frame.yaml'), 'utf8');

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(currentStage(runsDir), 'archive');
  assert.equal(fs.readFileSync(progressPath, 'utf8'), beforeProgress);
  assert.match(frame, /^deploy_mode:\s*skip$/m);
  assert.match(frame, /^release_reason:\s*"skip mode: no deploy"$/m);
  assert.match(frame, /from:\s*"verify"/);
  assert.match(frame, /to:\s*"archive"/);
  assert.match(frame, /^artifacts:\r?\n  required:\s*\[\]\r?\n  produced:\s*\[\]$/m);
});

test('archive completion marks the run terminal and clears only its active pointer', () => {
  const { project, changesDir, runsDir } = makeProject('archive');
  fs.writeFileSync(path.join(changesDir, 'tasks.md'), '# Tasks\n- [x] T1 complete\n');
  const evidencePath = writeProbeEvidence(runsDir);
  fs.writeFileSync(
    path.join(runsDir, 'probe-report.json'),
    JSON.stringify({
      schemaVersion: 1,
      projectDir: project,
      pass: true,
      issues: [],
      evidencePath,
      evidenceSha256: sha256File(evidencePath),
    }),
  );
  fs.writeFileSync(
    path.join(runsDir, 'evidence-audit-report.json'),
    passingAudit(project),
  );

  const result = runStage(project, 'archive');
  const frame = fs.readFileSync(path.join(runsDir, 'workflow-frame.yaml'), 'utf8');

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(frame, /^run_status:\s*completed$/m);
  assert.match(frame, /^completed_at:\s*".+"$/m);
  assert.equal(fs.existsSync(path.join(project, '.sdd', 'active-run')), false);
});

for (const stage of ['release', 'archive']) {
  test(`${stage} gate revalidates a failed verify probe after stage advancement`, () => {
    const { project, runsDir } = makeProject(stage);
    fs.writeFileSync(
      path.join(runsDir, 'probe-report.json'),
      JSON.stringify({
        schemaVersion: 1,
        pass: false,
        issues: [{ code: 'DOCUMENT_OVERFLOW' }],
      }),
    );

    const result = runStage(project, stage);

    assert.equal(result.status, 2, result.stderr || result.stdout);
    assert.equal(currentStage(runsDir), stage);
  });

  test(`${stage} gate revalidates the latest review verdict`, () => {
    const { project, runsDir } = makeProject(stage);
    fs.writeFileSync(
      path.join(runsDir, 'review-notes.md'),
      '# Review\n\nSuperpowers verdict: needs-fix\n',
    );

    const result = runStage(project, stage);

    assert.equal(result.status, 2, result.stderr || result.stdout);
    assert.equal(currentStage(runsDir), stage);
  });

  test(`${stage} gate blocks incomplete tasks even when review and verify evidence pass`, () => {
    const { project, changesDir, runsDir } = makeProject(stage);
    fs.writeFileSync(path.join(changesDir, 'tasks.md'), '# Tasks\n- [x] T1 complete\n- [ ] T2 incomplete\n');
    const evidencePath = writeProbeEvidence(runsDir);
    fs.writeFileSync(
      path.join(runsDir, 'probe-report.json'),
      JSON.stringify({
        schemaVersion: 1,
        projectDir: project,
        pass: true,
        issues: [],
        evidencePath,
        evidenceSha256: sha256File(evidencePath),
      }),
    );
    fs.writeFileSync(
      path.join(runsDir, 'evidence-audit-report.json'),
      passingAudit(project),
    );

    const result = runStage(project, stage);

    assert.equal(result.status, 2, result.stderr || result.stdout);
    assert.match(result.stderr + result.stdout, /tasks?.*(?:incomplete|未完成)/i);
    assert.equal(currentStage(runsDir), stage);
  });
}

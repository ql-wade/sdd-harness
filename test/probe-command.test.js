import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '..');
const fixtureRoot = path.join(testDir, 'fixtures', 'probe');

function runProbe(fixture, extraArgs = []) {
  const project = path.join(fixtureRoot, fixture);
  return spawnSync(
    process.execPath,
    [
      path.join(repoRoot, 'bin', 'cli.js'),
      'probe',
      '--project',
      project,
      '--evidence',
      path.join(project, 'evidence.json'),
      ...extraArgs,
      '--json',
    ],
    { cwd: repoRoot, encoding: 'utf8' },
  );
}

test('probe rejects debug leakage and runaway canvas dimensions', () => {
  const result = runProbe('broken');

  assert.equal(result.status, 2, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.pass, false);
  assert.deepEqual(
    report.issues.map((issue) => issue.code).sort(),
    [
      'CANVAS_BUFFER_EXCEEDS_DPR',
      'CANVAS_LAYOUT_EXCEEDS_VIEWPORT',
      'DEBUG_DOM_LEAK',
      'DOCUMENT_OVERFLOW',
    ],
  );
});

test('probe accepts bounded layout, clean DOM, passing commands and interactions', () => {
  const result = runProbe('good');

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.pass, true);
  assert.deepEqual(report.issues, []);
  const evidence = fs.readFileSync(path.join(fixtureRoot, 'good', 'evidence.json'));
  const expectedSha256 = crypto.createHash('sha256').update(evidence).digest('hex');
  assert.equal(report.evidenceSha256, expectedSha256);
});

test('probe rejects command evidence whose exit code is not a number', () => {
  const result = runProbe('invalid-command-shape');

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.pass, false);
  assert.equal(report.issues[0].code, 'INVALID_PROBE_EVIDENCE');
  assert.match(report.issues[0].message, /commands\.test/);
});

test('probe rejects self-reported interactions without state transition proof', () => {
  const result = runProbe('self-reported');

  assert.equal(result.status, 2, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.pass, false);
  assert.deepEqual(
    report.issues.map((issue) => issue.code),
    ['MISSING_STATE_TRANSITIONS'],
  );
});

test('probe rejects passed interactions that do not have matching state transitions', () => {
  const result = runProbe('missing-transition');

  assert.equal(result.status, 2, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.pass, false);
  assert.deepEqual(
    report.issues.map((issue) => issue.code),
    ['MISSING_INTERACTION_TRANSITION'],
  );
  assert.deepEqual(report.issues[0].evidence.missing, ['break']);
});

test('probe profile requires project-critical interactions to be present', () => {
  const result = runProbe('missing-required', ['--profile', 'minicraft']);

  assert.equal(result.status, 2, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.pass, false);
  assert.deepEqual(
    report.issues.map((issue) => issue.code),
    ['REQUIRED_INTERACTION_MISSING', 'REQUIRED_INTERACTION_TRANSITION_MISSING'],
  );
  assert.deepEqual(report.issues[0].evidence.missing, ['break']);
  assert.deepEqual(report.issues[1].evidence.missing, ['break']);
});

test('probe profile requires every project-critical interaction to have state transition proof', () => {
  const result = runProbe('missing-required-transition', ['--profile', 'minicraft']);

  assert.equal(result.status, 2, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.pass, false);
  assert.deepEqual(
    report.issues.map((issue) => issue.code),
    ['INTERACTION_FAILED', 'REQUIRED_INTERACTION_TRANSITION_MISSING'],
  );
  assert.deepEqual(report.issues[1].evidence.missing, ['break']);
});

test('probe profile enforces project-specific state transition semantics', () => {
  const result = runProbe('wrong-transition-contract', ['--profile', 'minicraft']);

  assert.equal(result.status, 2, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.pass, false);
  assert.deepEqual(
    report.issues.map((issue) => issue.code),
    ['STATE_TRANSITION_CONTRACT_MISMATCH', 'STATE_TRANSITION_CONTRACT_MISMATCH'],
  );
  assert.deepEqual(
    report.issues.map((issue) => issue.evidence.interaction),
    ['place', 'break'],
  );
});

test('probe profile requires its declared observation adapter in project source', () => {
  const result = runProbe('good', ['--profile', 'minicraft']);

  assert.equal(result.status, 2, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.pass, false);
  assert.deepEqual(
    report.issues.map((issue) => issue.code),
    ['MISSING_PROBE_OBSERVATION_ADAPTER'],
  );
});

test('probe profile requires runtime evidence that its observation adapter is callable', () => {
  const result = runProbe('missing-runtime-adapter', ['--profile', 'minicraft']);

  assert.equal(result.status, 2, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.pass, false);
  assert.deepEqual(
    report.issues.map((issue) => issue.code),
    ['PROBE_OBSERVATION_ADAPTER_UNAVAILABLE'],
  );
});

test('probe rejects source-level debug markers and canvas resize feedback loops', () => {
  const result = runProbe('source-guard');

  assert.equal(result.status, 2, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.pass, false);
  // After the setSize(false) fix: setSize(w, h, false) does NOT write canvas
  // CSS, so it is correctly not flagged as a feedback loop. Only the debug
  // DOM leak remains.
  assert.deepEqual(
    report.issues.map((issue) => issue.code).sort(),
    ['DEBUG_DOM_LEAK'],
  );
});

test('probe rejects debug DOM markers injected dynamically from project source', () => {
  const result = runProbe('source-debug-injection');

  assert.equal(result.status, 2, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.pass, false);
  assert.deepEqual(
    report.issues.map((issue) => issue.code),
    ['DEBUG_DOM_LEAK'],
  );
  assert.deepEqual(report.issues[0].evidence.files, ['src/main.ts']);
});

test('probe rejects incomplete evidence instead of treating missing observations as passing', () => {
  const result = runProbe('incomplete');

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.pass, false);
  assert.equal(report.issues[0].code, 'INVALID_PROBE_EVIDENCE');
});

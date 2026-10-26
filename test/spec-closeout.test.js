// Spec Adapter closeout tests (task P3_4, A11/B08) — Comet 0.5.0 face
// (revision 2026-10-26-comet-050-adoption-v1).
//
// lib/adapters/spec.js: the openspec CLI (pinned 1.11.0, resolved through the
// shared COMET_OPENSPEC seam) is the ONLY archive writer. The component-only
// path wraps the real openspec CLI and owns rehearse -> drift-check ->
// archive -> readback plus interruption recovery; the managed path binds the
// pinned Comet 0.5.0 aggregate (upstream aeb1a659 + the 0005 Kt closeout
// patch, build de39629a…) whose native `comet archive` is the single command
// that invokes the openspec CLI — no adapter path performs a second sync or
// archive, and native refusals (including a missing Kp composition
// obligation) are forwarded verbatim.
//
// Same-Run context semantics reused from the 0.4.5-era candidate diffs
// (ab90cc2+74607cc, preserved in worker-reports/Root-handoff-20261026):
// fixed location/stat identity closure, assertCurrent at the native boundary,
// native runId equality — re-targeted to the 0.5.0 dual-name change state
// file (comet-state.yaml / .comet.yaml) and the pinned build's
// ensureClassicRuntimeRun instead of the retired .comet/run-state.json read
// and the retired 0.4.5 comet-runtime.mjs asset.
//
// Covered semantics:
//   A11  interruption recovery — pre-archive (stale lock reclaimed, closeout
//        re-run) and post-archive (archive already contains the sync, recovery
//        reads back and completes WITHOUT repeating it); the authoritative
//        state is the files on disk, never the journal alone.
//   B08  concurrent drift — a main-spec or change mutation between rehearsal
//        and execution blocks closeout with SPEC_DRIFT and requires a fresh
//        rehearsal; MODIFIED requirements keep every existing scenario (the
//        pinned 1.11 and the adapter independently reject omitted scenarios).
//   Sole writer — O_EXCL file lock; a second concurrent writer (in-process or
//   a real child process) is refused; a completed archive refuses a second
//   closeout.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const adapterPath = path.join(projectRoot, 'lib/adapters/spec.js');
const adapter = await import(adapterPath);

const OPENSPEC_CLI = path.join(projectRoot, '.sdd/tools/openspec-1.11.0/node_modules/.bin/openspec');
const CLI_TIMEOUT_MS = 120_000;

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

// --- host CLI availability ---------------------------------------------------

const hostVersion = spawnSync(OPENSPEC_CLI, ['--version'], { encoding: 'utf8', timeout: 30_000 });
const hostCliAvailable = hostVersion.status === 0 && Boolean(hostVersion.stdout);
const hostCliVersion = hostCliAvailable ? hostVersion.stdout.trim() : null;

// --- fixture builders ---------------------------------------------------------

// Main spec with two requirements: one carrying two scenarios (the MODIFIED
// target), one standalone (the REMOVED target).
const MAIN_SPEC = [
  '# cap-a Specification',
  '',
  '## Purpose',
  'Purpose of cap-a is adapter closeout testing.',
  '',
  '## Requirements',
  '',
  '### Requirement: Existing auth flow',
  'The system SHALL authenticate users.',
  '',
  '#### Scenario: Valid login',
  '- **WHEN** valid credentials',
  '- **THEN** access granted',
  '',
  '#### Scenario: Invalid login',
  '- **WHEN** invalid credentials',
  '- **THEN** access denied',
  '',
  '### Requirement: Legacy flow',
  'The system SHALL support legacy login.',
  '',
  '#### Scenario: Legacy path',
  '- **WHEN** legacy flag',
  '- **THEN** legacy login',
  '',
].join('\n');

// Full delta: MODIFIED keeps BOTH existing scenarios (preservation), ADDED
// audit trail, REMOVED legacy flow.
const FULL_DELTA = [
  '## MODIFIED Requirements',
  '',
  '### Requirement: Existing auth flow',
  'The system SHALL authenticate users with rate limiting.',
  '',
  '#### Scenario: Valid login',
  '- **WHEN** valid credentials',
  '- **THEN** access granted',
  '',
  '#### Scenario: Invalid login',
  '- **WHEN** invalid credentials',
  '- **THEN** access denied',
  '',
  '## ADDED Requirements',
  '',
  '### Requirement: Audit trail',
  'The system SHALL log auth events.',
  '',
  '#### Scenario: Login logged',
  '- **WHEN** any login attempt',
  '- **THEN** audit record written',
  '',
  '## REMOVED Requirements',
  '',
  '### Requirement: Legacy flow',
  '',
].join('\n');

// Truncated delta: MODIFIED drops the existing "Invalid login" scenario.
// Pinned 1.11 and the adapter must both refuse this potential loss.
const TRUNCATED_DELTA = FULL_DELTA.split('#### Scenario: Invalid login')[0];

function writeProject({ delta }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-closeout-'));
  for (const rel of [
    'openspec/config.yaml',
    'openspec/project.md',
    'openspec/specs/cap-a/spec.md',
    'openspec/changes/demo/proposal.md',
    'openspec/changes/demo/tasks.md',
    'openspec/changes/demo/specs/cap-a/spec.md',
  ]) {
    fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
  }
  fs.writeFileSync(path.join(root, 'openspec/config.yaml'), 'schema: spec-driven\n');
  fs.writeFileSync(path.join(root, 'openspec/project.md'), '# Project\nAdapter closeout fixture project.\n');
  fs.writeFileSync(path.join(root, 'openspec/specs/cap-a/spec.md'), MAIN_SPEC);
  fs.writeFileSync(path.join(root, 'openspec/changes/demo/proposal.md'), [
    '## Why', 'Adapter closeout fixture needs a real OpenSpec change to rehearse and archive.', '',
    '## What Changes', 'Modify the auth flow, add an audit trail, remove the legacy flow.', '',
    '## Impact', 'cap-a.', '',
  ].join('\n'));
  fs.writeFileSync(path.join(root, 'openspec/changes/demo/tasks.md'), '## 1. Implementation\n- [ ] 1.1 Do the thing\n');
  fs.writeFileSync(path.join(root, 'openspec/changes/demo/specs/cap-a/spec.md'), delta);
  return root;
}

const KNOWLEDGE = { id: 'kp-fixture-1', digest: sha256('knowledge-closeout-kp-fixture') };
const EXECUTION = 'spec-closeout-test-execution-1';

function archiveDirsOf(root) {
  const archive = path.join(root, 'openspec/changes/archive');
  if (!fs.existsSync(archive)) return [];
  return fs.readdirSync(archive).filter((name) => name.endsWith('-demo')).sort();
}

function readMainSpec(root) {
  return fs.readFileSync(path.join(root, 'openspec/specs/cap-a/spec.md'), 'utf8');
}

function cliEnv() {
  return { ...process.env, CI: 'true', OPENSPEC_TELEMETRY: '0', DO_NOT_TRACK: '1' };
}

// A real child process that tries to grab the closeout lock; used to prove the
// sole-writer lock across process boundaries (not just in-process).
function spawnLockAttemptChild(root) {
  const script = [
    "import fs from 'node:fs';",
    `const adapter = await import(${JSON.stringify(adapterPath)});`,
    'try {',
    `  adapter.acquireArchiveLock({ projectRoot: ${JSON.stringify(root)}, change: 'demo', writerId: 'child-process-writer' });`,
    "  console.log('ACQUIRED');",
    '  process.exit(0);',
    '} catch (error) {',
    "  console.log(error.code ?? 'ERROR');",
    '  process.exit(3);',
    '}',
    '',
  ].join('\n');
  const file = path.join(os.tmpdir(), `lock-attempt-${sha256(root).slice(0, 8)}.mjs`);
  fs.writeFileSync(file, script);
  try {
    return spawnSync(process.execPath, [file], { cwd: root, encoding: 'utf8', timeout: 30_000 });
  } finally {
    fs.rmSync(file, { force: true });
  }
}

// A real child process PID that is guaranteed dead by the time it is used.
function deadPid() {
  const child = spawnSync(process.execPath, ['-e', 'process.exit(0)'], { timeout: 30_000 });
  assert.equal(child.status, 0);
  return child.pid;
}

// --- A11/B08 core flow --------------------------------------------------------

test('A11 happy path: rehearse then closeout archives once, syncs specs, readback matches, state completes and lock releases', { skip: hostCliAvailable ? false : `host CLI ${OPENSPEC_CLI} unavailable` }, (t) => {
  const root = writeProject({ delta: FULL_DELTA });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const rehearsal = adapter.rehearseArchive({ projectRoot: root, change: 'demo', openspecCli: OPENSPEC_CLI });
  assert.equal(rehearsal.ok, true, `rehearsal failed: ${rehearsal.error ?? ''} ${rehearsal.stage ?? ''}`);
  assert.equal(rehearsal.cliVersion, hostCliVersion);
  // Rehearsal must not touch the real project: change still in place, main
  // spec untouched, no archive directory.
  assert.ok(fs.existsSync(path.join(root, 'openspec/changes/demo/proposal.md')), 'rehearsal must leave the real change in place');
  assert.equal(readMainSpec(root), MAIN_SPEC, 'rehearsal must not modify real main specs');
  assert.deepEqual(archiveDirsOf(root), [], 'rehearsal must leave no archive directory');
  assert.ok(/^[a-f0-9]{64}$/.test(rehearsal.summaryDigest), 'rehearsal must produce a stable target summary digest');
  assert.ok(rehearsal.summary.capabilities['cap-a'], 'summary covers the delta capability');

  const result = adapter.closeoutSpecs({
    projectRoot: root,
    change: 'demo',
    openspecCli: OPENSPEC_CLI,
    rehearsal,
    knowledgeCloseout: KNOWLEDGE,
    execution: EXECUTION,
  });
  assert.equal(result.ok, true, `closeout failed: ${result.error ?? ''} ${result.code ?? ''}`);

  // Archive happened exactly once, with the date-prefixed name the CLI uses.
  const archiveDirs = archiveDirsOf(root);
  assert.equal(archiveDirs.length, 1);
  assert.equal(result.archiveName, archiveDirs[0]);
  assert.match(archiveDirs[0], /^\d{4}-\d{2}-\d{2}-demo$/);
  assert.ok(!fs.existsSync(path.join(root, 'openspec/changes/demo')), 'the change directory is consumed by the archive');

  // Main specs read back with the expected content (A11 external readback):
  // modified description, both preserved scenarios, added requirement, and the
  // removed requirement gone.
  const main = readMainSpec(root);
  assert.match(main, /### Requirement: Existing auth flow\nThe system SHALL authenticate users with rate limiting\./);
  assert.match(main, /#### Scenario: Valid login/);
  assert.match(main, /#### Scenario: Invalid login/, 'preserved scenario must be present after archive');
  assert.match(main, /### Requirement: Audit trail/);
  assert.match(main, /#### Scenario: Login logged/);
  assert.ok(!main.includes('Legacy flow'), 'removed requirement must be gone from main specs');

  // Byte-identical readback against the rehearsal expectation: the real
  // archive must produce exactly the rehearsed spec bytes.
  const readback = adapter.readBackMainSpecs({ projectRoot: root, summary: rehearsal.summary, expectedMainSpecs: rehearsal.expectedMainSpecs });
  assert.equal(readback.ok, true, `post-archive readback mismatch: ${JSON.stringify(readback.mismatches)}`);

  // Sole-writer state: closeout state journal completed and lock released.
  const stateFile = path.join(root, 'openspec/changes/archive', archiveDirs[0], '.spec-closeout-state.json');
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  assert.equal(state.stage, 'complete');
  assert.equal(state.archived, true);
  assert.equal(state.knowledgeCloseout.digest, KNOWLEDGE.digest);
  const archivedTree = fs.readdirSync(path.join(root, 'openspec/changes/archive', archiveDirs[0]));
  assert.ok(!archivedTree.includes('.spec-closeout.lock'), 'lock must be released after closeout');
});

test('sole writer: second writer refused by O_EXCL lock in-process and from a real child process', (t) => {
  const root = writeProject({ delta: FULL_DELTA });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const lock = adapter.acquireArchiveLock({ projectRoot: root, change: 'demo', writerId: 'writer-one' });
  assert.equal(lock.ok, true);
  assert.ok(fs.existsSync(path.join(root, 'openspec/changes/demo/.spec-closeout.lock')));

  // In-process second writer.
  assert.throws(
    () => adapter.acquireArchiveLock({ projectRoot: root, change: 'demo', writerId: 'writer-two' }),
    (error) => error.code === 'ARCHIVE_WRITER_EXISTS',
  );

  // Real cross-process second writer: a child process must also be refused
  // while the lock is held.
  const child = spawnLockAttemptChild(root);
  assert.equal(child.status, 3, `child lock attempt should exit 3, got ${child.status}: ${child.stdout} ${child.stderr}`);
  assert.match(child.stdout, /ARCHIVE_WRITER_EXISTS/);

  // After release the same child can acquire.
  adapter.releaseArchiveLock({ projectRoot: root, change: 'demo', writerId: 'writer-one' });
  const childAfter = spawnLockAttemptChild(root);
  assert.equal(childAfter.status, 0, `child acquire after release should succeed: ${childAfter.stdout} ${childAfter.stderr}`);
});

test('sole writer: two concurrent full closeouts produce exactly one archive and one refusal', { skip: hostCliAvailable ? false : `host CLI ${OPENSPEC_CLI} unavailable` }, async (t) => {
  const root = writeProject({ delta: FULL_DELTA });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const rehearsal = adapter.rehearseArchive({ projectRoot: root, change: 'demo', openspecCli: OPENSPEC_CLI });
  assert.equal(rehearsal.ok, true);

  // closeoutSpecs is synchronous in-process, so real concurrency means real
  // processes: two children race for the single closeout of the same change.
  const rehearsalFile = path.join(os.tmpdir(), `rehearsal-${sha256(root).slice(0, 8)}.json`);
  fs.writeFileSync(rehearsalFile, JSON.stringify(rehearsal));
  t.after(() => fs.rmSync(rehearsalFile, { force: true }));
  const closeoutChild = (writerId) => {
    const script = [
      "import fs from 'node:fs';",
      `const adapter = await import(${JSON.stringify(adapterPath)});`,
      `const rehearsal = JSON.parse(fs.readFileSync(${JSON.stringify(rehearsalFile)}, 'utf8'));`,
      'try {',
      `  adapter.closeoutSpecs({ projectRoot: ${JSON.stringify(root)}, change: 'demo', openspecCli: ${JSON.stringify(OPENSPEC_CLI)}, rehearsal, knowledgeCloseout: ${JSON.stringify(KNOWLEDGE)}, execution: ${JSON.stringify(writerId)} });`,
      "  console.log('OK');",
      '  process.exit(0);',
      '} catch (error) {',
      "  console.log(error.code ?? 'ERROR');",
      '  process.exit(3);',
      '}',
      '',
    ].join('\n');
    const file = path.join(os.tmpdir(), `closeout-${sha256(root + writerId).slice(0, 8)}.mjs`);
    fs.writeFileSync(file, script);
    return new Promise((resolve) => {
      const child = spawn(process.execPath, [file], { cwd: root });
      let out = '';
      child.stdout.on('data', (chunk) => { out += chunk; });
      child.on('close', (exitCode) => {
        fs.rmSync(file, { force: true });
        resolve({ exitCode, out: out.trim() });
      });
    });
  };
  const [writerA, writerB] = await Promise.all([closeoutChild('concurrent-writer-a'), closeoutChild('concurrent-writer-b')]);
  const outcomes = [writerA, writerB].sort((a, b) => a.exitCode - b.exitCode);
  assert.equal(outcomes[0].exitCode, 0, `exactly one writer may close out (winner: ${outcomes[0].out}); loser said: ${outcomes[1].out}`);
  assert.equal(outcomes[1].exitCode, 3, `the losing writer must be refused with exit 3, got: ${outcomes[1].out}`);
  assert.match(outcomes[1].out, /^(ARCHIVE_WRITER_EXISTS|ARCHIVE_ALREADY_SEALED)$/, 'the refusal must name the single-owner boundary');
  assert.equal(archiveDirsOf(root).length, 1, 'exactly one archive directory must exist');
});

test('B08 preservation: pinned native CLI and adapter both refuse omitted existing scenarios', { skip: hostCliAvailable ? false : `host CLI ${OPENSPEC_CLI} unavailable` }, (t) => {
  // Both pinned 1.11 and the adapter independently preserve existing scenarios.
  // The prior 1.3.1 silent-loss oracle is historical, never a required outcome.
  const cliRoot = writeProject({ delta: TRUNCATED_DELTA });
  t.after(() => fs.rmSync(cliRoot, { recursive: true, force: true }));
  const nativeValidate = spawnSync(OPENSPEC_CLI, ['validate', 'demo', '--type', 'change', '--strict', '--json'], {
    cwd: cliRoot, encoding: 'utf8', timeout: CLI_TIMEOUT_MS, env: cliEnv(),
  });
  assert.equal(nativeValidate.status, 1);
  assert.equal(JSON.parse(nativeValidate.stdout).items[0].valid, false);
  assert.match(nativeValidate.stdout, /Invalid login/);
  const cliArchive = spawnSync(OPENSPEC_CLI, ['archive', 'demo', '-y'], {
    cwd: cliRoot, encoding: 'utf8', timeout: CLI_TIMEOUT_MS, env: cliEnv(),
  });
  assert.equal(cliArchive.status, 1);
  assert.equal(readMainSpec(cliRoot), MAIN_SPEC);
  assert.equal(fs.existsSync(path.join(cliRoot, 'openspec/changes/demo')), true);
  assert.deepEqual(archiveDirsOf(cliRoot), []);

  // Adapter layer: the same delta is refused BEFORE any archive, and the real
  // project stays byte-identical.
  const root = writeProject({ delta: TRUNCATED_DELTA });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const preservation = adapter.verifyScenarioPreservation({ projectRoot: root, change: 'demo' });
  assert.equal(preservation.ok, false);
  const dropped = preservation.violations.find((violation) => violation.type === 'SCENARIO_DROPPED');
  assert.ok(dropped, `expected a SCENARIO_DROPPED violation, got ${JSON.stringify(preservation.violations)}`);
  assert.equal(dropped.capability, 'cap-a');
  assert.equal(dropped.requirement, 'Existing auth flow');
  assert.deepEqual(dropped.missing, ['Invalid login']);

  const rehearsal = adapter.rehearseArchive({ projectRoot: root, change: 'demo', openspecCli: OPENSPEC_CLI });
  assert.equal(rehearsal.ok, false, 'pinned 1.11 refuses the same missing scenario during isolated rehearsal');
  assert.equal(rehearsal.error, 'SPEC_VALIDATION_FAILED');
  assert.throws(
    () => adapter.closeoutSpecs({ projectRoot: root, change: 'demo', openspecCli: OPENSPEC_CLI, rehearsal, knowledgeCloseout: KNOWLEDGE, execution: EXECUTION }),
    (error) => error.code === 'REHEARSAL_NOT_OK',
  );
  assert.equal(readMainSpec(root), MAIN_SPEC, 'refused closeout must leave real main specs untouched');
  assert.deepEqual(archiveDirsOf(root), [], 'refused closeout must not archive');
  assert.ok(!fs.existsSync(path.join(root, 'openspec/changes/demo/.spec-closeout.lock')), 'lock must be released on refusal');
});

test('B08 MODIFIED target missing from main specs is refused before archive', (t) => {
  const root = writeProject({ delta: FULL_DELTA });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // Another change renamed the requirement concurrently: the delta's MODIFIED
  // target no longer exists in main specs.
  fs.writeFileSync(path.join(root, 'openspec/specs/cap-a/spec.md'), MAIN_SPEC.replace('### Requirement: Existing auth flow', '### Requirement: Auth flow (renamed)'));
  const preservation = adapter.verifyScenarioPreservation({ projectRoot: root, change: 'demo' });
  assert.equal(preservation.ok, false);
  const missing = preservation.violations.find((violation) => violation.type === 'MODIFIED_TARGET_MISSING');
  assert.ok(missing, `expected MODIFIED_TARGET_MISSING, got ${JSON.stringify(preservation.violations)}`);
  assert.equal(missing.requirement, 'Existing auth flow');
});

test('B08 drift: main-spec or change mutation between rehearsal and closeout blocks execution and demands a fresh rehearsal', { skip: hostCliAvailable ? false : `host CLI ${OPENSPEC_CLI} unavailable` }, (t) => {
  const root = writeProject({ delta: FULL_DELTA });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const rehearsal = adapter.rehearseArchive({ projectRoot: root, change: 'demo', openspecCli: OPENSPEC_CLI });
  assert.equal(rehearsal.ok, true);

  // 1. Main specs drift: another Change modified a requirement after the
  //    acceptance passed (B08 GIVEN).
  const original = readMainSpec(root);
  fs.writeFileSync(path.join(root, 'openspec/specs/cap-a/spec.md'), original.replace('The system SHALL authenticate users.', 'The system SHALL authenticate users with SSO.'));
  assert.throws(
    () => adapter.closeoutSpecs({ projectRoot: root, change: 'demo', openspecCli: OPENSPEC_CLI, rehearsal, knowledgeCloseout: KNOWLEDGE, execution: EXECUTION }),
    (error) => error.code === 'SPEC_DRIFT',
  );
  assert.deepEqual(archiveDirsOf(root), [], 'drift must block the archive');
  assert.ok(!fs.existsSync(path.join(root, 'openspec/changes/demo/.spec-closeout.lock')), 'lock released on drift refusal');

  // 2. Change-side drift: the change's own files are edited after rehearsal.
  fs.writeFileSync(path.join(root, 'openspec/specs/cap-a/spec.md'), original);
  fs.writeFileSync(path.join(root, 'openspec/changes/demo/tasks.md'), '## 1. Implementation\n- [x] 1.1 Do the thing\n- [ ] 1.2 New late task\n');
  assert.throws(
    () => adapter.closeoutSpecs({ projectRoot: root, change: 'demo', openspecCli: OPENSPEC_CLI, rehearsal, knowledgeCloseout: KNOWLEDGE, execution: EXECUTION }),
    (error) => error.code === 'SPEC_DRIFT',
  );

  // 3. B08 THEN: re-rehearse and the closeout goes through; the pre-existing
  //    scenario survives (old scenarios preserved).
  fs.writeFileSync(path.join(root, 'openspec/changes/demo/tasks.md'), '## 1. Implementation\n- [x] 1.1 Do the thing\n');
  const fresh = adapter.rehearseArchive({ projectRoot: root, change: 'demo', openspecCli: OPENSPEC_CLI });
  assert.equal(fresh.ok, true);
  const result = adapter.closeoutSpecs({ projectRoot: root, change: 'demo', openspecCli: OPENSPEC_CLI, rehearsal: fresh, knowledgeCloseout: KNOWLEDGE, execution: EXECUTION });
  assert.equal(result.ok, true, `closeout after re-rehearsal failed: ${result.error ?? ''}`);
  assert.match(readMainSpec(root), /#### Scenario: Invalid login/, 're-rehearsed closeout preserves the old scenario');
  assert.equal(archiveDirsOf(root).length, 1);
});

test('Knowledge.Closeout.v1 ordering: closeout refuses without a recorded Kp knowledge obligation, before any archive', { skip: hostCliAvailable ? false : `host CLI ${OPENSPEC_CLI} unavailable` }, (t) => {
  const root = writeProject({ delta: FULL_DELTA });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const rehearsal = adapter.rehearseArchive({ projectRoot: root, change: 'demo', openspecCli: OPENSPEC_CLI });
  assert.equal(rehearsal.ok, true);

  assert.throws(
    () => adapter.closeoutSpecs({ projectRoot: root, change: 'demo', openspecCli: OPENSPEC_CLI, rehearsal, knowledgeCloseout: null, execution: EXECUTION }),
    (error) => error.code === 'KNOWLEDGE_CLOSEOUT_REQUIRED',
  );
  assert.throws(
    () => adapter.closeoutSpecs({ projectRoot: root, change: 'demo', openspecCli: OPENSPEC_CLI, rehearsal, knowledgeCloseout: { id: 'kp', digest: 'not-a-digest' }, execution: EXECUTION }),
    (error) => error.code === 'KNOWLEDGE_CLOSEOUT_REQUIRED',
  );
  assert.throws(
    () => adapter.closeoutSpecs({ projectRoot: root, change: 'demo', openspecCli: OPENSPEC_CLI, rehearsal, knowledgeCloseout: KNOWLEDGE, execution: '' }),
    (error) => error.code === 'CLOSEOUT_EXECUTION_REQUIRED',
  );
  assert.deepEqual(archiveDirsOf(root), [], 'no archive without the Kp obligation');
  assert.equal(readMainSpec(root), MAIN_SPEC, 'no sync without the Kp obligation');
});

// --- A11 interruption recovery -------------------------------------------------

test('A11 pre-archive interruption: stale lock reclaimed, closeout re-run archives exactly once', { skip: hostCliAvailable ? false : `host CLI ${OPENSPEC_CLI} unavailable` }, (t) => {
  const root = writeProject({ delta: FULL_DELTA });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  // A writer crashed right after taking the lock: lock exists, holder PID is
  // dead, no archive has happened.
  const crashed = adapter.acquireArchiveLock({ projectRoot: root, change: 'demo', writerId: 'crashed-writer' });
  assert.equal(crashed.ok, true);
  fs.writeFileSync(path.join(root, 'openspec/changes/demo/.spec-closeout.lock'), JSON.stringify({ writerId: 'crashed-writer', pid: deadPid(), change: 'demo', acquiredAt: new Date().toISOString() }));

  const recovery = adapter.recoverCloseout({ projectRoot: root, change: 'demo', openspecCli: OPENSPEC_CLI, knowledgeCloseout: KNOWLEDGE, execution: 'recovery-execution-1' });
  assert.equal(recovery.resumed, 'pre-archive', `expected pre-archive recovery, got ${JSON.stringify(recovery)}`);
  assert.equal(recovery.lockReclaimed, true, 'the dead writer lock must be reclaimed');
  assert.ok(!fs.existsSync(path.join(root, 'openspec/changes/demo/.spec-closeout.lock')), 'stale lock removed');

  // Fresh rehearsal + closeout completes the interrupted closeout normally.
  const rehearsal = adapter.rehearseArchive({ projectRoot: root, change: 'demo', openspecCli: OPENSPEC_CLI });
  assert.equal(rehearsal.ok, true);
  const result = adapter.closeoutSpecs({ projectRoot: root, change: 'demo', openspecCli: OPENSPEC_CLI, rehearsal, knowledgeCloseout: KNOWLEDGE, execution: 'recovery-execution-1' });
  assert.equal(result.ok, true, `closeout after pre-archive recovery failed: ${result.error ?? ''}`);
  assert.equal(archiveDirsOf(root).length, 1, 'exactly one archive after recovery');
});

test('A11 post-archive interruption: recovery detects the completed CLI archive and completes by readback WITHOUT repeating the sync', { skip: hostCliAvailable ? false : `host CLI ${OPENSPEC_CLI} unavailable` }, (t) => {
  const root = writeProject({ delta: FULL_DELTA });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  // The interrupted writer: took the lock, wrote the archiving journal, and
  // the CLI archive itself DID complete (that is where it was killed — the
  // CLI had already synced specs and moved the change). All state here is
  // produced by real files and the real CLI, no mocks.
  const crashed = adapter.acquireArchiveLock({ projectRoot: root, change: 'demo', writerId: 'crashed-writer' });
  assert.equal(crashed.ok, true);
  fs.writeFileSync(path.join(root, 'openspec/changes/demo/.spec-closeout-state.json'), JSON.stringify({
    change: 'demo', execution: 'crashed-writer', stage: 'archiving', archived: false, startedAt: new Date().toISOString(),
  }));
  fs.writeFileSync(path.join(root, 'openspec/changes/demo/.spec-closeout.lock'), JSON.stringify({ writerId: 'crashed-writer', pid: deadPid(), change: 'demo', acquiredAt: new Date().toISOString() }));
  const cli = spawnSync(OPENSPEC_CLI, ['archive', 'demo', '-y'], {
    cwd: root, encoding: 'utf8', timeout: CLI_TIMEOUT_MS, env: cliEnv(),
  });
  assert.equal(cli.status, 0, `fixture CLI archive failed: ${cli.stderr}`);
  const archiveDirs = archiveDirsOf(root);
  assert.equal(archiveDirs.length, 1, 'fixture precondition: the CLI archive completed');
  const mainAfterCli = readMainSpec(root);

  const recovery = adapter.recoverCloseout({ projectRoot: root, change: 'demo', openspecCli: OPENSPEC_CLI, knowledgeCloseout: KNOWLEDGE, execution: 'recovery-execution-2' });
  assert.equal(recovery.resumed, 'post-archive', `expected post-archive recovery, got ${JSON.stringify(recovery)}`);
  assert.equal(recovery.reArchived, false, 'recovery must not re-run the archive');

  // No duplicate sync: the main specs are byte-identical to what the CLI left
  // — recovery read them back, it did not write them again.
  assert.equal(readMainSpec(root), mainAfterCli, 'recovery must not rewrite main specs (archive already contains the sync)');
  assert.equal(archiveDirsOf(root).length, 1, 'recovery must not produce a second archive');

  // Recovery finishes the closeout: journal complete, lock released, readback
  // verified externally.
  const stateFile = path.join(root, 'openspec/changes/archive', archiveDirs[0], '.spec-closeout-state.json');
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  assert.equal(state.stage, 'complete');
  assert.equal(state.archived, true);
  assert.equal(state.readback.ok, true);
  assert.ok(!fs.existsSync(path.join(root, 'openspec/changes/archive', archiveDirs[0], '.spec-closeout.lock')), 'recovered closeout releases the lock');

  // A second closeout attempt after the archive fails closed: single-owner —
  // the change is gone, so there is nothing left to rehearse or archive.
  const rehearsal = adapter.rehearseArchive({ projectRoot: root, change: 'demo', openspecCli: OPENSPEC_CLI });
  assert.equal(rehearsal.ok, false, 'rehearsing an already-archived change must fail closed (the change is gone)');
});

test('A11 post-archive drift: recovery readback detects real main-spec corruption and refuses to mark complete', { skip: hostCliAvailable ? false : `host CLI ${OPENSPEC_CLI} unavailable` }, (t) => {
  const root = writeProject({ delta: FULL_DELTA });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const crashed = adapter.acquireArchiveLock({ projectRoot: root, change: 'demo', writerId: 'crashed-writer' });
  assert.equal(crashed.ok, true);
  fs.writeFileSync(path.join(root, 'openspec/changes/demo/.spec-closeout-state.json'), JSON.stringify({
    change: 'demo', execution: 'crashed-writer', stage: 'archiving', archived: false, startedAt: new Date().toISOString(),
  }));
  fs.writeFileSync(path.join(root, 'openspec/changes/demo/.spec-closeout.lock'), JSON.stringify({ writerId: 'crashed-writer', pid: deadPid(), change: 'demo', acquiredAt: new Date().toISOString() }));
  const cli = spawnSync(OPENSPEC_CLI, ['archive', 'demo', '-y'], {
    cwd: root, encoding: 'utf8', timeout: CLI_TIMEOUT_MS, env: cliEnv(),
  });
  assert.equal(cli.status, 0);
  // Real corruption after the interrupted archive: the added requirement was
  // lost from main specs (e.g. a concurrent change overwrote it).
  const mainPath = path.join(root, 'openspec/specs/cap-a/spec.md');
  fs.writeFileSync(mainPath, readMainSpec(root).replace(/### Requirement: Audit trail[\s\S]*$/, ''));

  const recovery = adapter.recoverCloseout({ projectRoot: root, change: 'demo', openspecCli: OPENSPEC_CLI, knowledgeCloseout: KNOWLEDGE, execution: 'recovery-execution-3' });
  assert.equal(recovery.resumed, 'post-archive');
  assert.equal(recovery.readback.ok, false, 'the readback must report the real corruption');
  assert.ok(recovery.readback.mismatches.some((mismatch) => /Audit trail/.test(JSON.stringify(mismatch))), `readback must name the lost requirement: ${JSON.stringify(recovery.readback.mismatches)}`);
  const stateFile = path.join(root, 'openspec/changes/archive', archiveDirsOf(root)[0], '.spec-closeout-state.json');
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  assert.equal(state.stage, 'readback-failed', 'the closeout must stay incomplete on readback failure');
});

test('A11 ambiguous recovery: multiple archives of the same change name block recovery instead of guessing the newest', (t) => {
  const root = writeProject({ delta: FULL_DELTA });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const archiveDir = path.join(root, 'openspec/changes/archive');
  fs.mkdirSync(path.join(archiveDir, '2026-01-01-demo'), { recursive: true });
  fs.mkdirSync(path.join(archiveDir, '2026-01-02-demo'), { recursive: true });
  assert.throws(
    () => adapter.recoverCloseout({ projectRoot: root, change: 'demo', openspecCli: OPENSPEC_CLI, knowledgeCloseout: KNOWLEDGE, execution: EXECUTION }),
    (error) => error.code === 'AMBIGUOUS_ARCHIVE',
  );
});

test('A11 silent CLI abort: exit-0-with-abort (unwritable rebuild) is detected as not-applied, real project untouched', { skip: hostCliAvailable ? false : `host CLI ${OPENSPEC_CLI} unavailable` }, (t) => {
  // Removing every requirement via REMOVED makes the CLI rebuild fail with
  // "Spec must have at least one requirement" and abort with exit 0 — the
  // closeout must detect that nothing was applied instead of claiming success.
  const root = writeProject({ delta: [
    '## REMOVED Requirements', '', '### Requirement: Existing auth flow', '', '### Requirement: Legacy flow', '',
  ].join('\n') });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const rehearsal = adapter.rehearseArchive({ projectRoot: root, change: 'demo', openspecCli: OPENSPEC_CLI });
  // The rehearsal archive in the throwaway copy hits the same abort.
  assert.equal(rehearsal.ok, false, 'rehearsal must report the CLI abort as a failed rehearsal');
  assert.match(String(rehearsal.archiveOutput ?? ''), /No files were changed/);
  assert.throws(
    () => adapter.closeoutSpecs({ projectRoot: root, change: 'demo', openspecCli: OPENSPEC_CLI, rehearsal, knowledgeCloseout: KNOWLEDGE, execution: EXECUTION }),
    (error) => error.code === 'REHEARSAL_NOT_OK',
  );
  assert.equal(readMainSpec(root), MAIN_SPEC, 'the aborted archive must leave the real project untouched');
  assert.deepEqual(archiveDirsOf(root), []);
});

// The legacy component writer must never mutate a Comet-managed change.
test('managed closeout refuses caller-authored Kp without the original Runtime', (t) => {
  const root = writeProject({ delta: FULL_DELTA });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const before = readMainSpec(root);
  const rehearsal = adapter.rehearseArchive({ projectRoot: root, change: 'demo', openspecCli: OPENSPEC_CLI });
  assert.equal(rehearsal.ok, true);
  fs.writeFileSync(path.join(root, 'openspec/changes/demo/.comet.yaml'),
    'managed_delivery: true\nrun_id: component-original-run\n');
  assert.throws(() => adapter.closeoutSpecs({ projectRoot: root, change: 'demo',
    openspecCli: OPENSPEC_CLI, rehearsal, knowledgeCloseout: KNOWLEDGE, execution: EXECUTION }),
    (error) => error.code === 'MANAGED_RUNTIME_REQUIRED');
  assert.equal(readMainSpec(root), before);
  assert.equal(fs.existsSync(path.join(root, 'openspec/changes/demo')), true);
  assert.deepEqual(archiveDirsOf(root), []);
});

test('all legacy write and rehearsal helpers refuse Comet-owned control variants', (t) => {
  for (const [relative, content] of [
    ['.comet/config.yaml', 'not: [valid'],
    ['openspec/changes/demo/.comet.yaml', 'managed_delivery: unknown\n'],
    ['openspec/changes/demo/.comet', null],
  ]) {
    const root=writeProject({delta:FULL_DELTA});
    t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
    const marker=path.join(root,relative); fs.mkdirSync(path.dirname(marker),{recursive:true});
    if(content===null) fs.mkdirSync(marker); else fs.writeFileSync(marker,content);
    const before=readMainSpec(root);
    const calls=[
      ()=>adapter.closeoutSpecs({projectRoot:root,change:'demo',knowledgeCloseout:KNOWLEDGE,execution:EXECUTION}),
      ()=>adapter.recoverCloseout({projectRoot:root,change:'demo'}),
      ()=>adapter.rehearseArchive({projectRoot:root,change:'demo',openspecCli:OPENSPEC_CLI}),
      ()=>adapter.acquireArchiveLock({projectRoot:root,change:'demo',writerId:EXECUTION}),
      ()=>adapter.releaseArchiveLock({projectRoot:root,change:'demo'}),
    ];
    for(const call of calls) assert.throws(call,e=>e.code==='MANAGED_RUNTIME_REQUIRED');
    assert.equal(readMainSpec(root),before);
    assert.deepEqual(archiveDirsOf(root),[]);
    assert.equal(fs.existsSync(path.join(root,'openspec/changes/demo/.spec-closeout-state.json')),false);
    assert.equal(fs.existsSync(path.join(root,'openspec/changes/demo/.spec-closeout.lock')),false);
  }
});


// --- managed adapter face (Comet 0.5.0) ---------------------------------------
//
// The managed fixtures model the 0.5.0 on-disk contract: the change state is
// a dual-name file comet-state.yaml / .comet.yaml carrying the flat projection
// (change_id / run_id / phase / archived); .comet/run-state.json is NOT a
// change-dir read in 0.5.0 (local Run records live under the workspace
// runtime root). Native (runClassicCli / ensureClassicRuntimeRun from the
// pinned build) is stubbed with a counter so every refusal below is proven to
// happen BEFORE any native dispatch.

const RUN_STATE_FILE = 'read-boundary-run';
const writeChangeState = (changeDir, fields = {}) => {
  fs.mkdirSync(changeDir, { recursive: true });
  const merged = {
    change_id: '00000000-0000-4000-8000-000000000003',
    run_id: RUN_STATE_FILE,
    phase: 'open',
    archived: false,
    ...fields,
  };
  const lines = Object.entries(merged).map(([key, value]) => `${key}: ${value}`);
  fs.writeFileSync(path.join(changeDir, '.comet.yaml'), `${lines.join('\n')}\n`);
};

function managedReadFixture(t) {
  const root = writeProject({delta: FULL_DELTA});
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-read-boundary-'));
  t.after(() => { fs.rmSync(root,{recursive:true,force:true}); fs.rmSync(outside,{recursive:true,force:true}); });
  const changeDir = path.join(root,'openspec/changes/demo');
  writeChangeState(changeDir);
  let runtimeCalls=0;
  const instance=adapter.createManagedSpecAdapter({projectRoot:root,runtime:{runClassicCli(){runtimeCalls++; throw new Error('read boundary must reject before Native');}}});
  return {root,outside,changeDir,stateFile:path.join(changeDir,'.comet.yaml'),instance,calls:()=>runtimeCalls};
}

test('managed inspect rejects a spec file link before reading external ordinary data', (t) => {
  const f=managedReadFixture(t);
  const external=path.join(f.outside,'ordinary.md');
  fs.writeFileSync(external,'## ADDED Requirements\n\n### Requirement: Outside ordinary data\nThe system SHALL keep this file outside the project.\n');
  const spec=path.join(f.root,'openspec/changes/demo/specs/cap-a/spec.md');
  fs.unlinkSync(spec); fs.symlinkSync(external,spec);
  assert.throws(()=>f.instance.inspect({change:'demo'}),e=>e.code==='PROJECT_PATH_UNSAFE');
  assert.equal(f.calls(),0);
});

test('managed inspect rejects an empty and a malformed Run state file with a coded error', (t) => {
  for (const content of ['', 'not a classic state at all\n', 'null']) {
    const f=managedReadFixture(t);
    fs.writeFileSync(f.stateFile,content);
    assert.throws(()=>f.instance.inspect({change:'demo'}),e=>e.code==='MANAGED_RUNTIME_REQUIRED',`content=${JSON.stringify(content)}`);
    assert.equal(f.calls(),0);
  }
});

test('managed reads refuse both 0.5.0 state file names present at once (upstream conflict rule)', async (t) => {
  for (const method of ['inspect','closeout','recover']) {
    const f=managedReadFixture(t);
    fs.writeFileSync(path.join(f.changeDir,'comet-state.yaml'),'run_id: other\nphase: open\narchived: false\n');
    await assert.rejects(async()=>f.instance[method]({change:'demo'}),e=>e.code==='STATE_FILE_CONFLICT',method);
    assert.equal(f.calls(),0);
  }
});

test('managed reads refuse an archived projection outside phase=archive (upstream invariant)', async (t) => {
  for (const method of ['inspect','recover']) {
    const f=managedReadFixture(t);
    writeChangeState(f.changeDir,{phase:'build',archived:true});
    await assert.rejects(async()=>f.instance[method]({change:'demo'}),e=>e.code==='MANAGED_RUNTIME_REQUIRED',method);
    assert.equal(f.calls(),0);
  }
});

test('all managed read entries reject directory, state-file and main-spec links before Native', async (t) => {
  for (const relative of ['openspec/changes/demo/specs/cap-a/spec.md',
    'openspec/changes/demo/specs/cap-a','openspec/changes/demo/.comet.yaml',
    'openspec/changes/demo','openspec/specs/cap-a/spec.md', 'openspec/specs/cap-a']) {
    const f=managedReadFixture(t);
    const source=path.join(f.root,relative);
    const external=path.join(f.outside,'ordinary');
    const directory=fs.lstatSync(source).isDirectory();
    if(directory) fs.mkdirSync(external); else fs.writeFileSync(external,'ordinary external data');
    fs.rmSync(source,{recursive:directory}); fs.symlinkSync(external,source);
    for(const method of ['inspect','closeout','recover']) {
      await assert.rejects(async()=>f.instance[method]({change:'demo'}),e=>e.code==='PROJECT_PATH_UNSAFE',relative+' '+method);
    }
    assert.equal(f.calls(),0);
  }
});

test('archived managed projection and pure main readback reject links and relative escape', async (t) => {
  const f=managedReadFixture(t);
  const archive=path.join(f.root,'openspec/changes/archive/2026-10-25-demo');
  fs.mkdirSync(path.dirname(archive),{recursive:true});
  fs.renameSync(f.root+'/openspec/changes/demo',archive);
  const external=path.join(f.outside,'ordinary.md'); fs.writeFileSync(external,'ordinary outside data');
  const target=path.join(archive,'specs/cap-a/spec.md'); fs.unlinkSync(target);fs.symlinkSync(external,target);
  for(const method of ['inspect','closeout','recover'])
    await assert.rejects(async()=>f.instance[method]({change:'demo'}),e=>e.code==='PROJECT_PATH_UNSAFE');
  assert.equal(f.calls(),0);
  assert.throws(()=>adapter.readBackMainSpecs({projectRoot:f.root,
    summary:{capabilities:{'../changes':{added:[],modified:[],removed:[]}}}}),e=>e.code==='PROJECT_PATH_UNSAFE');
  assert.throws(()=>adapter.readBackMainSpecs({projectRoot:f.root,summary:{capabilities:{}},
    expectedMainSpecs:{'../../outside.md':'0'.repeat(64)}}),e=>e.code==='PROJECT_PATH_UNSAFE');
  const main=path.join(f.root,'openspec/specs/cap-a/spec.md'); fs.unlinkSync(main);fs.symlinkSync(external,main);
  assert.throws(()=>adapter.readBackMainSpecs({projectRoot:f.root,summary:{capabilities:{'cap-a':{added:[],modified:[],removed:[]}}}}),e=>e.code==='PROJECT_PATH_UNSAFE');
});

test('Run and summary shape failures use coded errors without Native or raw content', async (t) => {
  const f=managedReadFixture(t);
  const bodies = ['', 'ordinary', 'null',
    'change_id: c\nrun_id: \nphase: open\narchived: false\n',
    'change_id: c\nphase: open\narchived: false\n',
    'change_id: c\nrun_id: r\nphase: teleporting\narchived: false\n',
    'change_id: c\nrun_id: r\nphase: open\narchived: maybe\n'];
  for (const value of bodies) {
    fs.writeFileSync(f.stateFile,value);
    for(const method of ['inspect','closeout','recover'])
      await assert.rejects(async()=>f.instance[method]({change:'demo'}),e=>e.code==='MANAGED_RUNTIME_REQUIRED' && !e.message.includes('ordinary'),`${method} ${JSON.stringify(value)}`);
  }
  for (const summary of [null,[],{capabilities:null},{capabilities:[]},{capabilities:{sample:null}},
    {capabilities:{sample:{added:[null],modified:[],removed:[]}}}])
    assert.throws(()=>adapter.readBackMainSpecs({projectRoot:f.root,summary}),e=>e.code==='SUMMARY_INVALID');
  assert.equal(f.calls(),0);
});

test('legacy summary, rehearsal and archived recovery share the project-bound read guard', (t) => {
  const root=writeProject({delta:FULL_DELTA});
  const outside=fs.mkdtempSync(path.join(os.tmpdir(),'spec-legacy-read-'));
  t.after(()=>{fs.rmSync(root,{recursive:true,force:true});fs.rmSync(outside,{recursive:true,force:true});});
  const external=path.join(outside,'ordinary.md');fs.writeFileSync(external,'ordinary outside requirement');
  const spec=path.join(root,'openspec/changes/demo/specs/cap-a/spec.md');fs.unlinkSync(spec);fs.symlinkSync(external,spec);
  assert.throws(()=>adapter.computeTargetSummary({projectRoot:root,change:'demo'}),e=>e.code==='PROJECT_PATH_UNSAFE');
  assert.equal(adapter.rehearseArchive({projectRoot:root,change:'demo',openspecCli:OPENSPEC_CLI}).error,'PROJECT_PATH_UNSAFE');
  const archive=path.join(root,'openspec/changes/archive/2026-10-25-demo');fs.mkdirSync(path.dirname(archive),{recursive:true});
  fs.renameSync(path.join(root,'openspec/changes/demo'),archive);
  assert.throws(()=>adapter.recoverCloseout({projectRoot:root,change:'demo'}),e=>e.code==='PROJECT_PATH_UNSAFE');
  assert.equal(fs.existsSync(path.join(archive,'.spec-closeout-state.json')),false);
  assert.equal(fs.readFileSync(external,'utf8'),'ordinary outside requirement');
});

test('managed closeout reconciles an already-archived Run with zero native dispatch and no second archive', async (t) => {
  const f=managedReadFixture(t);
  const archive=path.join(f.root,'openspec/changes/archive/2026-10-25-demo');
  fs.mkdirSync(path.dirname(archive),{recursive:true});
  writeChangeState(f.root+'/openspec/changes/demo',{phase:'archive',archived:true});
  fs.renameSync(path.join(f.root,'openspec/changes/demo'),archive);
  // Model the authoritative post-archive state: the openspec CLI already
  // applied FULL_DELTA to the main specs when it moved the change — the
  // MODIFIED description, the ADDED requirement, and the REMOVED one gone.
  const applied=readMainSpec(f.root)
    .replace('authenticate users.','authenticate users with rate limiting.')
    .split('### Requirement: Legacy flow')[0]
    +'### Requirement: Audit trail\nThe system SHALL log auth events.\n\n#### Scenario: Login logged\n- **WHEN** any login attempt\n- **THEN** audit record written\n';
  fs.writeFileSync(path.join(f.root,'openspec/specs/cap-a/spec.md'),applied);
  // The archived delta must read back green against that state — completion
  // without dispatching any writer.
  const result=await f.instance.closeout({change:'demo'});
  assert.equal(result.ok,true,JSON.stringify(result.readback?.mismatches));
  assert.equal(result.reconciled,'already-archived');
  assert.equal(result.archived,true);
  assert.equal(result.archiveName,'2026-10-25-demo');
  assert.equal(result.native,null,'no second archive or sync may be dispatched');
  assert.equal(result.overallCompletionEligible,false);
  assert.equal(f.calls(),0);
  assert.deepEqual(fs.readdirSync(path.join(f.root,'openspec/changes/archive')),['2026-10-25-demo']);
});

test('managed closeout forwards a native refusal verbatim and leaves the active position untouched', async (t) => {
  const f=managedReadFixture(t);
  const native={exitCode:1,stdout:'{"command":"archive"}\n',stderr:'FATAL: phase is \'verify\', expected \'archive\''};
  let argv=null;
  const instance=adapter.createManagedSpecAdapter({projectRoot:f.root,runtime:{runClassicCli(received){argv=received;return {...native};}}});
  const refused=await instance.closeout({change:'demo'});
  assert.equal(refused.ok,false);
  assert.deepEqual(argv,['--json','archive','demo'],'the one native archive command');
  assert.equal(refused.native.exitCode,1);
  assert.equal(refused.native.stderr,native.stderr,'the native refusal is preserved verbatim, never masked');
  assert.equal(refused.archived,false);
  assert.equal(fs.existsSync(f.changeDir),true,'a refused closeout must leave the active change in place');
  assert.equal(fs.existsSync(path.join(f.root,'openspec/changes/archive')),false);
});

test('managed closeout refuses a Run substitution behind a successful native exit', async (t) => {
  const f=managedReadFixture(t);
  const instance=adapter.createManagedSpecAdapter({projectRoot:f.root,runtime:{
    runClassicCli(){ writeChangeState(f.changeDir,{run_id:'another-run'}); return {exitCode:0,stdout:''}; }}});
  await assert.rejects(instance.closeout({change:'demo'}),e=>e.code==='RUN_MISMATCH');
});

test('managed closeout refuses scenario-dropping MODIFIED deltas and stale inspections before Native', async (t) => {
  const lossy=writeProject({delta:TRUNCATED_DELTA});
  t.after(()=>fs.rmSync(lossy,{recursive:true,force:true}));
  writeChangeState(path.join(lossy,'openspec/changes/demo'));
  let calls=0;
  const instance=adapter.createManagedSpecAdapter({projectRoot:lossy,runtime:{runClassicCli(){calls++;throw new Error('must refuse before Native');}}});
  await assert.rejects(instance.closeout({change:'demo'}),e=>e.code==='SCENARIO_PRESERVATION_VIOLATION');
  const f=managedReadFixture(t);
  const inspect=f.instance.inspect({change:'demo'});
  fs.appendFileSync(path.join(f.root,'openspec/changes/demo/specs/cap-a/spec.md'),'\n');
  await assert.rejects(f.instance.closeout({change:'demo',expectedSummaryDigest:inspect.digest}),e=>e.code==='SPEC_DRIFT');
  assert.equal(calls,0);
});

// --- same-Run context against the pinned 0.5.0 build ---------------------------

// The live fixture binds the REAL pinned aggregate named by
// integrations/comet/upstream.lock.json (upstream 0.5.0 aeb1a659 + the 0005 Kt
// closeout patch, build fingerprint de39629a…). runClassicCli comes from the
// build's own runtime asset; ensureClassicRuntimeRun from its dist module.
// Same-Run boundary semantics reused from the 0.4.5-era candidate
// (ab90cc2+74607cc): location/stat identity closure + assertCurrent at the
// native boundary + native runId equality.
const lock = JSON.parse(fs.readFileSync(path.join(projectRoot,'integrations/comet/upstream.lock.json')));
const buildFingerprint = sha256(JSON.stringify({archive:lock.source.sha256,
  patches:lock.patches.map(({path,sha256})=>({path,sha256})),toolchain:lock.toolchain}));
const cometBuild = path.join(projectRoot,'.sdd/vendor/comet',lock.source.commit,'builds',buildFingerprint);
const cometRuntimeUrl = pathToFileURL(path.join(cometBuild,'work/assets/skills/comet/scripts/comet-runtime.mjs')).href;
const cometRunModuleUrl = pathToFileURL(path.join(cometBuild,'work/dist/domains/comet-classic/classic-runtime-run.js')).href;

async function pinnedRunFixture(t, mutate = () => {}) {
  assert.equal(lock.package.version,'0.5.0','the pinned Comet supply must be the 0.5.0 baseline');
  assert.equal(lock.source.commit,'aeb1a6598034e28ce46b8422d4dbd8785e607bd7');
  const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'spec-pinned-run-'));
  t.after(()=>fs.rmSync(scratch,{recursive:true,force:true}));
  const root=path.join(scratch,'root');
  for (const rel of ['openspec/changes/archive','openspec/specs/cap-a','docs/superpowers/plans',
    'docs/superpowers/specs','docs/superpowers/reports','.comet']) fs.mkdirSync(path.join(root,rel),{recursive:true});
  fs.writeFileSync(path.join(root,'.comet/config.yaml'),
    'schema: comet.project.v1\ndefault_workflow: classic\nworkflows: [classic]\nclassic:\n  artifact_layout: legacy\n');
  fs.writeFileSync(path.join(root,'openspec/config.yaml'),'schema: spec-driven\n');
  fs.writeFileSync(path.join(root,'openspec/specs/cap-a/spec.md'),MAIN_SPEC);
  const native = await import(cometRuntimeUrl);
  const runModule = await import(cometRunModuleUrl);
  const priorHome=process.env.HOME;
  process.env.HOME=path.join(scratch,'home');
  fs.mkdirSync(process.env.HOME,{recursive:true});
  const initialized = await native.runClassicCli(['--json','state','init','demo','full'],undefined,
    {projectRoot:root,invocationCwd:root});
  assert.equal(initialized.exitCode,0,initialized.stderr);
  const changeDir=path.join(root,'openspec/changes/demo');
  const initial=await runModule.ensureClassicRuntimeRun(changeDir);
  const deltaDir=path.join(changeDir,'specs/cap-a'); fs.mkdirSync(deltaDir,{recursive:true});
  fs.writeFileSync(path.join(deltaDir,'spec.md'),FULL_DELTA);
  const instance=adapter.createManagedSpecAdapter({projectRoot:root,runtime:{
    runClassicCli:native.runClassicCli,
    async ensureClassicRuntimeRun(current) {
      const context=await runModule.ensureClassicRuntimeRun(current);
      await mutate(current,context);
      return context;
    }}});
  return {root,changeDir,instance,runId:initial.run.runId,restore(){ if(priorHome===undefined) delete process.env.HOME; else process.env.HOME=priorHome; }};
}

test('managed Run context refuses missing, foreign, ambiguous and linked Run locations before Native', async (t) => {
  for (const fault of ['missing-change','missing-state','foreign-run','active-plus-archive','two-archives',
    'state-link','directory-link','archive-root-link','escape','unknown-location-option']) await t.test(fault, async (t) => {
    const f = await pinnedRunFixture(t);
    t.after(()=>f.restore());
    let calls = 0;
    const instance=adapter.createManagedSpecAdapter({projectRoot:f.root,runtime:{runClassicCli(){throw new Error('not a CLI test');},
      async ensureClassicRuntimeRun(current) { calls++; throw new Error('unsafe context reached Native'); }}});
    const request = {change:'demo',expectedRunId:f.runId};
    let code = 'PROJECT_PATH_UNSAFE';
    const archive = path.join(f.root,'openspec/changes/archive/2026-10-26-demo');
    if (fault === 'missing-change') { fs.rmSync(f.changeDir,{recursive:true}); code='CHANGE_MISSING'; }
    if (fault === 'missing-state') { fs.rmSync(path.join(f.changeDir,'.comet.yaml')); code='MANAGED_RUNTIME_REQUIRED'; }
    if (fault === 'foreign-run') { request.expectedRunId='foreign-run'; code='RUN_MISMATCH'; }
    if (fault === 'active-plus-archive' || fault === 'two-archives') {
      fs.cpSync(f.changeDir,archive,{recursive:true}); code='AMBIGUOUS_ARCHIVE';
      if (fault === 'two-archives') fs.renameSync(f.changeDir,path.join(f.root,'openspec/changes/archive/2026-10-25-demo'));
    }
    if (fault === 'state-link') {
      const external = path.join(f.root,'outside-run.yaml'); fs.renameSync(path.join(f.changeDir,'.comet.yaml'),external);
      fs.symlinkSync(external,path.join(f.changeDir,'.comet.yaml'));
    }
    if (fault === 'directory-link') { fs.renameSync(f.changeDir,path.join(f.root,'outside-demo')); fs.symlinkSync(path.join(f.root,'outside-demo'),f.changeDir); }
    if (fault === 'archive-root-link') { fs.rmSync(path.join(f.root,'openspec/changes/archive'),{recursive:true,force:true}); fs.symlinkSync(path.join(f.root,'outside'),path.join(f.root,'openspec/changes/archive')); }
    if (fault === 'escape') { request.change='../demo'; code='CHANGE_INVALID'; }
    if (fault === 'unknown-location-option') { request.archive=archive; code='CHANGE_INVALID'; }
    await assert.rejects(instance.readRunContext(request),(error)=>error.code===code);
    assert.equal(calls,0,'a read must not create or repair an absent or untrusted original Run');
  });
});

test('managed Run context retains Native state and an immutable same-location identity across archive readback', async (t) => {
  const f = await pinnedRunFixture(t);
  t.after(()=>f.restore());
  const request = {change:'demo',expectedRunId:f.runId};
  const active = await f.instance.readRunContext(request);
  assert.equal(active.run.runId,f.runId); assert.equal(active.classic.phase,'open');
  assert.equal(active.changeDir,fs.realpathSync(f.changeDir)); assert.equal(active.archived,false);
  const archive = path.join(f.root,'openspec/changes/archive/2026-10-26-demo');
  fs.mkdirSync(path.dirname(archive),{recursive:true}); fs.renameSync(f.changeDir,archive);
  assert.throws(()=>active.assertCurrent(),(error)=>error.code==='RUN_LOCATION_CHANGED');
  const archived = await f.instance.readRunContext(request);
  assert.equal(archived.changeDir,fs.realpathSync(archive)); assert.equal(archived.archived,true);
  assert.equal(archived.run.runId,f.runId); assert.equal(archived.classic.phase,'open');
  archived.run.runId='caller-mutated-view';
  request.expectedRunId='caller-mutated-request';
  assert.equal(archived.assertCurrent().projection.runId,f.runId,'returned data and request mutations cannot redirect the closed-over identity');
  assert.equal(fs.existsSync(f.changeDir),false);
});

test('managed Run context rejects location races, replacement directories and a different Native Run result', async (t) => {
  for (const fault of ['moved','replacement','foreign-disk-run','foreign-native-run','new-conflict','state-link']) await t.test(fault,async(t)=>{
    const f = await pinnedRunFixture(t,(directory,context)=>{
      const archive = path.join(path.dirname(directory),'archive/2026-10-26-demo');
      if (fault === 'moved' || fault === 'replacement') {
        fs.mkdirSync(path.dirname(archive),{recursive:true}); fs.renameSync(directory,archive);
        if (fault === 'replacement') { fs.cpSync(archive,directory,{recursive:true}); fs.rmSync(archive,{recursive:true}); }
      }
      if (fault === 'foreign-disk-run') {
        const file=path.join(directory,'.comet.yaml');
        fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace(/run_id: .*/,'run_id: other-run'));
      }
      if (fault === 'foreign-native-run') context.run.runId='other-run';
      if (fault === 'new-conflict') { fs.mkdirSync(path.dirname(archive),{recursive:true});fs.cpSync(directory,archive,{recursive:true}); }
      if (fault === 'state-link') {
        const source=path.join(directory,'.comet.yaml'), target=path.join(directory,'original-state.yaml');
        fs.renameSync(source,target);fs.symlinkSync(target,source);
      }
    });
    t.after(()=>f.restore());
    const code = ['moved','replacement'].includes(fault) ? 'RUN_LOCATION_CHANGED'
      : fault === 'new-conflict' ? 'AMBIGUOUS_ARCHIVE' : fault === 'state-link' ? 'PROJECT_PATH_UNSAFE' : 'RUN_MISMATCH';
    await assert.rejects(f.instance.readRunContext({change:'demo',expectedRunId:f.runId}),(error)=>error.code===code);
  });
});

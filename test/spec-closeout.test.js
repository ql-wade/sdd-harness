// Spec Adapter closeout tests (task P3_4, A11/B08).
//
// lib/adapters/spec.js is the SOLE archive writer for change spec closeout:
// it wraps the real openspec CLI and owns rehearse -> drift-check -> archive ->
// readback, plus interruption recovery. Everything runs against a REAL
// temporary OpenSpec project (complete change structure under os.tmpdir())
// with the real host CLI binary — zero mocks, no fake spec engines.
//
// Covered semantics:
//   A11  interruption recovery — pre-archive (stale lock reclaimed, closeout
//        re-run) and post-archive (archive already contains the sync, recovery
//        reads back and completes WITHOUT repeating it); the authoritative
//        state is the files on disk, never the journal alone.
//   B08  concurrent drift — a main-spec or change mutation between rehearsal
//        and execution blocks closeout with SPEC_DRIFT and requires a fresh
//        rehearsal; MODIFIED requirements keep every existing scenario (the
//        host CLI 1.3.1 silently drops scenarios a truncated delta omits —
//        this suite proves that gap and the adapter guard against it).
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
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const adapterPath = path.join(projectRoot, 'lib/adapters/spec.js');
const adapter = await import(adapterPath);

const OPENSPEC_CLI = process.env.OPENSPEC_CLI ?? 'openspec';
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

// Truncated delta: MODIFIED drops the "Invalid login" scenario. The host CLI
// archives this silently (proven in the B08 preservation case), which is
// exactly the loss the adapter pre-check must refuse.
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

test('B08 preservation: adapter refuses a MODIFIED delta that drops an existing scenario while the host CLI would archive it silently', { skip: hostCliAvailable ? false : `host CLI ${OPENSPEC_CLI} unavailable` }, (t) => {
  // Layer proof first: the host CLI 1.3.1 really archives the truncated delta
  // and loses the scenario — in a throwaway copy only. This documents why the
  // adapter pre-check exists (native validate --strict passes this delta).
  const cliRoot = writeProject({ delta: TRUNCATED_DELTA });
  t.after(() => fs.rmSync(cliRoot, { recursive: true, force: true }));
  const nativeValidate = spawnSync(OPENSPEC_CLI, ['validate', 'demo', '--type', 'change', '--strict', '--json'], {
    cwd: cliRoot, encoding: 'utf8', timeout: CLI_TIMEOUT_MS, env: cliEnv(),
  });
  assert.equal(nativeValidate.status, 0);
  assert.equal(JSON.parse(nativeValidate.stdout).items[0].valid, true, 'precondition: native strict validation passes the truncated delta');
  const cliArchive = spawnSync(OPENSPEC_CLI, ['archive', 'demo', '-y'], {
    cwd: cliRoot, encoding: 'utf8', timeout: CLI_TIMEOUT_MS, env: cliEnv(),
  });
  assert.equal(cliArchive.status, 0, 'precondition: the host CLI archives the truncated delta with exit 0');
  assert.ok(!readMainSpec(cliRoot).includes('#### Scenario: Invalid login'), 'precondition: the host CLI silently dropped the scenario — the gap the adapter guards');

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
  assert.equal(rehearsal.ok, true, 'rehearsal itself runs in the throwaway copy even for a bad delta');
  assert.throws(
    () => adapter.closeoutSpecs({ projectRoot: root, change: 'demo', openspecCli: OPENSPEC_CLI, rehearsal, knowledgeCloseout: KNOWLEDGE, execution: EXECUTION }),
    (error) => error.code === 'SCENARIO_PRESERVATION_VIOLATION' && /Invalid login/.test(error.message),
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

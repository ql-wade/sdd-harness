// P3_4 delivery case: the Spec Adapter is the single closeout writer over the
// real openspec CLI in a real temporary OpenSpec project.
//
// Coverage:
//   V_A11 (3.4.a/3.4.b) — dispatch-to-archive interruption story: a rehearsal
//     in a cloned project previews the target summary without touching the
//     real change; a closeout interrupted before the CLI archive recovers by
//     reclaiming the stale writer lock and re-running; a closeout interrupted
//     AFTER the CLI archive (which already synced main specs and moved the
//     change) recovers from the on-disk authoritative state, reads the main
//     specs back and completes WITHOUT repeating the sync — main specs stay
//     byte-identical and exactly one archive directory exists.
//   V_B08 (3.4.b) — concurrent drift blocking: after the acceptance passed,
//     another Change's edit to the main specs between rehearsal and closeout
//     is caught by summary comparison (SPEC_DRIFT), nothing is archived, and
//     the flow proceeds only after a fresh rehearsal, preserving the old
//     scenario ("Invalid login") that the truncated delta would have dropped
//     (the host CLI 1.3.1 archives such a delta silently — the case proves
//     that loss and the adapter guard against it).
//
// All fixtures are generated under os.tmpdir(); no live configuration or
// change-control file is written by this suite. The host openspec CLI must be
// on PATH; when it is absent the case fails UNVERIFIED (nonzero), never skips
// to pass.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const adapterPath = path.join(projectRoot, 'lib/adapters/spec.js');
const adapter = await import(adapterPath);

const OPENSPEC_CLI = process.env.OPENSPEC_CLI ?? 'openspec';
const CLI_TIMEOUT_MS = 120_000;
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

const hostVersion = spawnSync(OPENSPEC_CLI, ['--version'], { encoding: 'utf8', timeout: 30_000 });
const hostCliAvailable = hostVersion.status === 0 && Boolean(hostVersion.stdout);
const cliEnv = () => ({ ...process.env, CI: 'true', OPENSPEC_TELEMETRY: '0', DO_NOT_TRACK: '1' });

const MAIN_SPEC = [
  '# cap-a Specification',
  '',
  '## Purpose',
  'Purpose of cap-a is the delivery case fixture.',
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
].join('\n');

// Delta that keeps both existing scenarios plus an added requirement.
const COMPLETE_DELTA = [
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
].join('\n');

// Delta that drops the "Invalid login" scenario — what a careless author would
// ship and what the host CLI would archive without complaint.
const LOSSY_DELTA = COMPLETE_DELTA.split('#### Scenario: Invalid login')[0];

function writeProject({ delta }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'delivery-case-3-4-'));
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
  fs.writeFileSync(path.join(root, 'openspec/project.md'), '# Project\nDelivery case 3_4 fixture project.\n');
  fs.writeFileSync(path.join(root, 'openspec/specs/cap-a/spec.md'), MAIN_SPEC);
  fs.writeFileSync(path.join(root, 'openspec/changes/demo/proposal.md'), [
    '## Why', 'Delivery case 3_4 needs a real OpenSpec change for the closeout rehearsal.', '',
    '## What Changes', 'Modify the auth flow with complete scenarios and add the audit trail.', '',
    '## Impact', 'cap-a.', '',
  ].join('\n'));
  fs.writeFileSync(path.join(root, 'openspec/changes/demo/tasks.md'), '## 1. Implementation\n- [ ] 1.1 Do the thing\n');
  fs.writeFileSync(path.join(root, 'openspec/changes/demo/specs/cap-a/spec.md'), delta);
  return root;
}

const KNOWLEDGE = { id: 'kp-3-4', digest: sha256('delivery-case-3-4-kp') };
const EXECUTION = 'delivery-case-3-4-execution';
const archiveDirsOf = (root) => {
  const archive = path.join(root, 'openspec/changes/archive');
  return fs.existsSync(archive) ? fs.readdirSync(archive).filter((name) => name.endsWith('-demo')).sort() : [];
};
const readMainSpec = (root) => fs.readFileSync(path.join(root, 'openspec/specs/cap-a/spec.md'), 'utf8');
const deadPid = () => {
  const child = spawnSync(process.execPath, ['-e', 'process.exit(0)'], { timeout: 30_000 });
  assert.equal(child.status, 0);
  return child.pid;
};

test('V_A11: archive interruption recovery continues from authoritative state without repeating side effects', { skip: hostCliAvailable ? false : `UNVERIFIED: host CLI ${OPENSPEC_CLI} unavailable` }, (t) => {
  const root = writeProject({ delta: COMPLETE_DELTA });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  // Rehearsal: real CLI on a full clone, target summary previewed, real
  // project provably untouched.
  const rehearsal = adapter.rehearseArchive({ projectRoot: root, change: 'demo', openspecCli: OPENSPEC_CLI });
  assert.equal(rehearsal.ok, true, `rehearsal failed: ${rehearsal.error ?? ''}`);
  assert.ok(fs.existsSync(path.join(root, 'openspec/changes/demo/proposal.md')));
  assert.equal(readMainSpec(root), MAIN_SPEC);
  assert.deepEqual(archiveDirsOf(root), []);

  // Interruption before the CLI archive: stale lock with a dead holder.
  assert.equal(adapter.acquireArchiveLock({ projectRoot: root, change: 'demo', writerId: 'interrupted' }).ok, true);
  fs.writeFileSync(path.join(root, 'openspec/changes/demo/.spec-closeout.lock'), JSON.stringify({ writerId: 'interrupted', pid: deadPid(), change: 'demo', acquiredAt: new Date().toISOString() }));
  const pre = adapter.recoverCloseout({ projectRoot: root, change: 'demo', openspecCli: OPENSPEC_CLI, knowledgeCloseout: KNOWLEDGE, execution: EXECUTION });
  assert.equal(pre.resumed, 'pre-archive');
  assert.equal(pre.lockReclaimed, true);

  // The closeout completes after recovery: exactly one archive, readback ok.
  const result = adapter.closeoutSpecs({ projectRoot: root, change: 'demo', openspecCli: OPENSPEC_CLI, rehearsal, knowledgeCloseout: KNOWLEDGE, execution: EXECUTION });
  assert.equal(result.ok, true, `closeout after recovery failed: ${result.error ?? ''}`);
  assert.equal(archiveDirsOf(root).length, 1);
  const mainAfter = readMainSpec(root);
  assert.match(mainAfter, /#### Scenario: Invalid login/);
  assert.match(mainAfter, /### Requirement: Audit trail/);
  const readback = adapter.readBackMainSpecs({ projectRoot: root, summary: rehearsal.summary, expectedMainSpecs: rehearsal.expectedMainSpecs });
  assert.equal(readback.ok, true, JSON.stringify(readback.mismatches));
});

test('V_A11: post-archive interruption recovery does not repeat the sync (archive already contains it)', { skip: hostCliAvailable ? false : `UNVERIFIED: host CLI ${OPENSPEC_CLI} unavailable` }, (t) => {
  const root = writeProject({ delta: COMPLETE_DELTA });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  // The interrupted writer got as far as the CLI archive completing.
  assert.equal(adapter.acquireArchiveLock({ projectRoot: root, change: 'demo', writerId: 'interrupted' }).ok, true);
  fs.writeFileSync(path.join(root, 'openspec/changes/demo/.spec-closeout-state.json'), JSON.stringify({ change: 'demo', execution: 'interrupted', stage: 'archiving', archived: false, startedAt: new Date().toISOString() }));
  fs.writeFileSync(path.join(root, 'openspec/changes/demo/.spec-closeout.lock'), JSON.stringify({ writerId: 'interrupted', pid: deadPid(), change: 'demo', acquiredAt: new Date().toISOString() }));
  const cli = spawnSync(OPENSPEC_CLI, ['archive', 'demo', '-y'], { cwd: root, encoding: 'utf8', timeout: CLI_TIMEOUT_MS, env: cliEnv() });
  assert.equal(cli.status, 0, `fixture CLI archive failed: ${cli.stderr}`);
  const mainAfterCli = readMainSpec(root);

  // Recovery reads the external state instead of repeating the archive.
  const recovery = adapter.recoverCloseout({ projectRoot: root, change: 'demo', openspecCli: OPENSPEC_CLI, knowledgeCloseout: KNOWLEDGE, execution: EXECUTION });
  assert.equal(recovery.resumed, 'post-archive');
  assert.equal(recovery.reArchived, false);
  assert.equal(readMainSpec(root), mainAfterCli, 'recovery must not rewrite the synced main specs');
  assert.equal(archiveDirsOf(root).length, 1, 'recovery must not produce a second archive');
  assert.equal(recovery.readback.ok, true, JSON.stringify(recovery.readback?.mismatches));

  const state = JSON.parse(fs.readFileSync(path.join(root, 'openspec/changes/archive', archiveDirsOf(root)[0], '.spec-closeout-state.json'), 'utf8'));
  assert.equal(state.stage, 'complete');
});

test('V_B08: main-spec drift after acceptance blocks closeout until a fresh rehearsal, and old scenarios survive', { skip: hostCliAvailable ? false : `UNVERIFIED: host CLI ${OPENSPEC_CLI} unavailable` }, (t) => {
  // The danger first, in a throwaway copy: the host CLI 1.3.1 archives a
  // scenario-dropping delta silently — the loss the adapter must block.
  const lossyRoot = writeProject({ delta: LOSSY_DELTA });
  t.after(() => fs.rmSync(lossyRoot, { recursive: true, force: true }));
  const lossyCli = spawnSync(OPENSPEC_CLI, ['archive', 'demo', '-y'], { cwd: lossyRoot, encoding: 'utf8', timeout: CLI_TIMEOUT_MS, env: cliEnv() });
  assert.equal(lossyCli.status, 0, 'precondition: the host CLI archives the lossy delta');
  assert.ok(!readMainSpec(lossyRoot).includes('#### Scenario: Invalid login'), 'precondition: the lossy archive really dropped the old scenario');

  // The guarded flow: complete delta, rehearsed, then another Change edits the
  // main specs before closeout.
  const root = writeProject({ delta: COMPLETE_DELTA });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const rehearsal = adapter.rehearseArchive({ projectRoot: root, change: 'demo', openspecCli: OPENSPEC_CLI });
  assert.equal(rehearsal.ok, true);
  const concurrentEdit = readMainSpec(root).replace('The system SHALL authenticate users.', 'The system SHALL authenticate users via SSO.');
  fs.writeFileSync(path.join(root, 'openspec/specs/cap-a/spec.md'), concurrentEdit);

  // Summary conflict blocks: nothing archived, nothing synced.
  assert.throws(
    () => adapter.closeoutSpecs({ projectRoot: root, change: 'demo', openspecCli: OPENSPEC_CLI, rehearsal, knowledgeCloseout: KNOWLEDGE, execution: EXECUTION }),
    (error) => error.code === 'SPEC_DRIFT',
  );
  assert.deepEqual(archiveDirsOf(root), []);
  assert.equal(readMainSpec(root), concurrentEdit, 'the blocked closeout must not touch the drifted main specs');

  // B08 THEN: after the conflict is resolved (edit reverted), re-rehearse and
  // close out; the old scenario is preserved in the main specs.
  fs.writeFileSync(path.join(root, 'openspec/specs/cap-a/spec.md'), MAIN_SPEC);
  const fresh = adapter.rehearseArchive({ projectRoot: root, change: 'demo', openspecCli: OPENSPEC_CLI });
  assert.equal(fresh.ok, true);
  const result = adapter.closeoutSpecs({ projectRoot: root, change: 'demo', openspecCli: OPENSPEC_CLI, rehearsal: fresh, knowledgeCloseout: KNOWLEDGE, execution: EXECUTION });
  assert.equal(result.ok, true, `closeout after re-rehearsal failed: ${result.error ?? ''}`);
  const main = readMainSpec(root);
  assert.match(main, /#### Scenario: Valid login/);
  assert.match(main, /#### Scenario: Invalid login/, 'the old scenario must survive the closeout');
  assert.equal(archiveDirsOf(root).length, 1);
});

test('V_B08: a lossy MODIFIED delta is refused by the adapter while the same delta passes native validation', { skip: hostCliAvailable ? false : `UNVERIFIED: host CLI ${OPENSPEC_CLI} unavailable` }, (t) => {
  const root = writeProject({ delta: LOSSY_DELTA });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const nativeValidate = spawnSync(OPENSPEC_CLI, ['validate', 'demo', '--type', 'change', '--strict', '--json'], {
    cwd: root, encoding: 'utf8', timeout: CLI_TIMEOUT_MS, env: cliEnv(),
  });
  assert.equal(nativeValidate.status, 0);
  assert.equal(JSON.parse(nativeValidate.stdout).items[0].valid, true, 'precondition: native strict validation misses the dropped scenario');
  const preservation = adapter.verifyScenarioPreservation({ projectRoot: root, change: 'demo' });
  assert.equal(preservation.ok, false);
  const dropped = preservation.violations.find((violation) => violation.type === 'SCENARIO_DROPPED');
  assert.ok(dropped, `expected SCENARIO_DROPPED, got ${JSON.stringify(preservation.violations)}`);
  assert.deepEqual(dropped.missing, ['Invalid login']);
});

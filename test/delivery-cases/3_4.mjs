// P3_4 delivery case — Comet 0.5.0 face (revision 2026-10-26-comet-050-adoption-v1).
//
// Two families share this file:
//
// 1. The component-only closeout path (default test() family): the Spec
//    Adapter is the single closeout writer over the real pinned openspec CLI
//    (1.15.0, resolved through the shared COMET_OPENSPEC seam) in a real
//    temporary OpenSpec project.
//      V_A11 (3.4.a/3.4.b) — dispatch-to-archive interruption story: a
//        rehearsal in a cloned project previews the target summary without
//        touching the real change; a closeout interrupted before the CLI
//        archive recovers by reclaiming the stale writer lock and re-running;
//        a closeout interrupted AFTER the CLI archive (which already synced
//        main specs and moved the change) recovers from the on-disk
//        authoritative state, reads the main specs back and completes WITHOUT
//        repeating the sync — main specs stay byte-identical and exactly one
//        archive directory exists.
//      V_B08 (3.4.b) — concurrent drift blocking: after the acceptance passed,
//        another Change's edit to the main specs between rehearsal and closeout
//        is caught by summary comparison (SPEC_DRIFT), nothing is archived, and
//        the flow proceeds only after a fresh rehearsal, preserving the old
//        scenario ("Invalid login") that the truncated delta would have dropped
//        (historical 1.3.1 archived such a delta; pinned 1.11 refuses — the
//        case proves that loss and the adapter guard against it).
//
// 2. The managed 0.5.0 mechanism family (--spec-mechanism / --spec-restart):
//    a REAL Classic Run on the pinned 0.5.0 build (upstream aeb1a659 + the
//    0005 Kt closeout patch, fingerprint de39629a…) is driven through the
//    actual `comet state`/`comet check`/`comet archive` surface to the archive
//    phase, and the managed Spec Adapter exercises:
//      - A11/N07 native-refusal forwarding, same-Run archive, repeated
//        closeout reconciliation without a second archive/sync, crash-after-
//        commit resume, before-move target collision;
//      - B08/N07 stale-inspection drift refusal.
//    The openspec CLI (pinned 1.15.0 via COMET_OPENSPEC) stays the ONLY
//    archive writer — invoked exactly once by Native's comet archive.
//
// Proven UNVERIFIED (honest scope): the composition-wired Kp refusal (P2_4
// extension; the plain CLI face has nothing Kp-shaped to refuse here — the
// forwarding channel is proven with the native archive-confirmation refusal)
// and the real post-archive Kt journey (P4_6; 0005's knowledgeCloseoutBlocked
// predicate is separately pinned by 2_4).
//
// All fixtures are generated under os.tmpdir(); no live configuration or
// change-control file is written by this suite. The pinned openspec CLI must
// exist at .sdd/tools/openspec-1.15.0; when it is absent the component family
// fails UNVERIFIED (nonzero), never skips to pass.
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { verifyCometDistribution } from '../../tools/comet/build.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const adapterPath = path.join(projectRoot, 'lib/adapters/spec.js');
const adapter = await import(adapterPath);

const OPENSPEC_CLI = path.join(projectRoot, '.sdd/tools/openspec-1.15.0/node_modules/.bin/openspec');
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

// ---- the pinned 0.5.0 aggregate named by the source lock ---------------------
const repository = projectRoot;
const lock = JSON.parse(fs.readFileSync(path.join(repository,'integrations/comet/upstream.lock.json')));
const sha = sha256;
const fingerprint = sha(JSON.stringify({archive:lock.source.sha256,
  patches:lock.patches.map(({path,sha256})=>({path,sha256})),toolchain:lock.toolchain}));
const work = path.join(repository,'.sdd/vendor/comet',lock.source.commit,'builds',fingerprint,'work');
const cometRuntimeUrl = pathToFileURL(path.join(work,'assets/skills/comet/scripts/comet-runtime.mjs')).href;
const cometRunModuleUrl = pathToFileURL(path.join(work,'dist/domains/comet-classic/classic-runtime-run.js')).href;
const specCase = process.argv.indexOf('--spec-mechanism');
const specRestart = process.argv.indexOf('--spec-restart');

// ---- 0.5.0 native driver (real Classic Run through the real command surface) --

function writeCometScratch(root) {
  for (const rel of ['openspec/changes/archive','openspec/specs/cap-a','openspec/changes/demo',
    'docs/superpowers/plans','docs/superpowers/specs','docs/superpowers/reports','.comet','.whitebox'])
    fs.mkdirSync(path.join(root,rel),{recursive:true});
  fs.writeFileSync(path.join(root,'.comet/config.yaml'),
    'schema: comet.project.v1\ndefault_workflow: classic\nworkflows: [classic]\nclassic:\n  artifact_layout: legacy\n');
  fs.writeFileSync(path.join(root,'openspec/config.yaml'),'schema: spec-driven\n');
  fs.writeFileSync(path.join(root,'openspec/specs/cap-a/spec.md'),MAIN_SPEC);
}

async function cometFixture() {
  assert.equal(process.versions.node, lock.toolchain.node,
    'run the exact locked Node, not a host alias');
  assert.equal(lock.package.version, '0.5.0', 'the pinned supply must be the 0.5.0 baseline');
  assert.equal(lock.source.commit, 'aeb1a6598034e28ce46b8422d4dbd8785e607bd7');
  assert.deepEqual(lock.patches.map(({path})=>path), ['integrations/comet/patches/0005-comet-050-kt-closeout.patch'],
    'the pinned supply must carry exactly the 0005 Kt closeout patch');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-3-4-050-'));
  const home = path.join(scratch, 'home'); fs.mkdirSync(home, { recursive: true });
  const root = path.join(scratch, 'root');
  writeCometScratch(root);
  const native = await import(cometRuntimeUrl);
  const runModule = await import(cometRunModuleUrl);
  const prior = { HOME: process.env.HOME, COMET_OPENSPEC: process.env.COMET_OPENSPEC };
  // The workspace runtime root and the archive writer binary are resolved from
  // the environment exactly where Native resolves them.
  process.env.HOME = home;
  process.env.COMET_OPENSPEC = OPENSPEC_CLI;
  const commands = [];
  const cli = async (argv) => {
    const started = new Date().toISOString();
    const result = await native.runClassicCli(['--json', ...argv], undefined,
      { projectRoot: root, invocationCwd: root });
    commands.push({ argv, started, ended: new Date().toISOString(), exitCode: result.exitCode,
      stdout: (result.stdout ?? '').slice(0, 2000), stderr: (result.stderr ?? '').slice(0, 2000) });
    return result;
  };
  const ok = async (argv) => {
    const result = await cli(argv);
    assert.equal(result.exitCode, 0,
      `${argv.join(' ')} -> ${result.stderr ?? JSON.stringify(JSON.parse(result.stdout ?? '{}').data?.issues ?? [])}`);
    return result;
  };
  return {
    scratch, home, root, native, runModule, cli, ok, commands,
    changeDir: path.join(root, 'openspec/changes/demo'),
    restore() {
      for (const [key, value] of Object.entries(prior)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    },
    close() {
      this.restore();
      const directory = path.join(repository, '.local/P3_4-comet-050/case-audit', crypto.randomUUID());
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(path.join(directory, 'commands.json'), JSON.stringify(commands, null, 2) + '\n');
      return path.relative(repository, directory);
    },
  };
}

// Drive a real full-profile Classic Run to the archive phase. Every step is
// the actual public state/check surface — no phase write, no shortcut.
async function driveToVerifyPass(f) {
  const change = f.changeDir;
  fs.writeFileSync(path.join(change,'proposal.md'),
    '## Why\nThe managed 0.5.0 mechanism case needs a real change.\n\n## What Changes\nModify the auth flow and add an audit trail.\n\n## Impact\ncap-a.\n');
  fs.writeFileSync(path.join(change,'tasks.md'),'- [ ] 1.1 Implement the managed archive proof. <!-- comet-task:task1 -->\n');
  fs.writeFileSync(path.join(change,'design.md'),
    '---\ncomet_change: demo\nrole: technical-design\ncanonical_spec: openspec\n---\n# Design\nOne original Runtime owns the archive transaction.\n');
  fs.mkdirSync(path.join(change,'specs/cap-a'),{recursive:true});
  fs.writeFileSync(path.join(change,'specs/cap-a/spec.md'), COMPLETE_DELTA);
  await f.ok(['state','init','demo','full']);
  await f.ok(['state','transition','demo','open-complete']);
  await f.ok(['state','set','demo','design_doc','openspec/changes/demo/design.md']);
  // complete-design records the document and auto-transitions design -> build.
  await f.ok(['state','complete-design','demo','--design-doc','openspec/changes/demo/design.md']);
  await f.ok(['state','set','demo','build_mode','autonomous','tdd_mode','tdd','isolation','current']);
  const tasksRun = await f.ok(['state','tasks','demo','--assign-ids']);
  const tasksData = JSON.parse(tasksRun.stdout).data ?? {};
  const task = (tasksData.tasks ?? [])[0];
  assert.ok(task?.id, 'state tasks --assign-ids must return the stable task id');
  assert.ok(tasksData.revision, 'state tasks --assign-ids must return the task revision');
  await f.ok(['state','task-complete','demo',task.id,'--expect',tasksData.revision]);
  fs.writeFileSync(path.join(f.root,'docs/superpowers/plans/plan.md'),
    `<!-- comet-task-authority: openspec/changes/demo/tasks.md -->\n# Plan\n\nStep one covers the task <!-- comet-task-ref:${task.id} -->.\n`);
  await f.ok(['state','set','demo','plan','docs/superpowers/plans/plan.md']);
  await f.ok(['check','run','demo','build','--',process.execPath,'-e','0']);
  await f.ok(['state','transition','demo','build-complete']);
  fs.writeFileSync(path.join(f.root,'.whitebox/verification.md'),
    '# Component evidence\nActual Native mechanism only; production roles and methods remain UNVERIFIED.\n');
  await f.ok(['state','set','demo','verification_report','.whitebox/verification.md']);
  await f.ok(['check','run','demo','verify','--',process.execPath,'-e','0']);
  await f.ok(['state','transition','demo','verify-pass']);
}

const managedAdapter = (f) => adapter.createManagedSpecAdapter({
  runtime: { runClassicCli: f.native.runClassicCli, ensureClassicRuntimeRun: f.runModule.ensureClassicRuntimeRun },
  projectRoot: f.root,
});
if (specCase < 0 && specRestart < 0) {
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
  // Pinned 1.11 independently blocks the loss; preserve the historical failing
  // oracle in evidence, not as a required silent-success behavior.
  const lossyRoot = writeProject({ delta: LOSSY_DELTA });
  t.after(() => fs.rmSync(lossyRoot, { recursive: true, force: true }));
  const lossyCli = spawnSync(OPENSPEC_CLI, ['archive', 'demo', '-y'], { cwd: lossyRoot, encoding: 'utf8', timeout: CLI_TIMEOUT_MS, env: cliEnv() });
  assert.equal(lossyCli.status, 1, 'pinned 1.11 refuses a missing existing scenario');
  assert.equal(readMainSpec(lossyRoot), MAIN_SPEC);
  assert.equal(fs.existsSync(path.join(lossyRoot, 'openspec/changes/demo')), true);
  assert.deepEqual(archiveDirsOf(lossyRoot), []);

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

test('V_B08: native 1.11 and adapter refuse the same lossy MODIFIED delta', { skip: hostCliAvailable ? false : `UNVERIFIED: host CLI ${OPENSPEC_CLI} unavailable` }, (t) => {
  const root = writeProject({ delta: LOSSY_DELTA });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const nativeValidate = spawnSync(OPENSPEC_CLI, ['validate', 'demo', '--type', 'change', '--strict', '--json'], {
    cwd: root, encoding: 'utf8', timeout: CLI_TIMEOUT_MS, env: cliEnv(),
  });
  assert.equal(nativeValidate.status, 1);
  assert.equal(JSON.parse(nativeValidate.stdout).items[0].valid, false);
  assert.match(nativeValidate.stdout, /Invalid login/);
  assert.equal(readMainSpec(root), MAIN_SPEC);
  assert.equal(fs.existsSync(path.join(root, 'openspec/changes/demo')), true);
  const preservation = adapter.verifyScenarioPreservation({ projectRoot: root, change: 'demo' });
  assert.equal(preservation.ok, false);
  const dropped = preservation.violations.find((violation) => violation.type === 'SCENARIO_DROPPED');
  assert.ok(dropped, `expected SCENARIO_DROPPED, got ${JSON.stringify(preservation.violations)}`);
  assert.deepEqual(dropped.missing, ['Invalid login']);
});

}

async function nativeSpecScenario(id) {
  const f = await cometFixture();
  const assertions = [];
  const proof = (nid, expected, actual, observed = null) => {
    assert.deepEqual(actual, expected, nid);
    assertions.push({ id: nid, expected, actual, ...(observed ? { observed } : {}) });
  };
  let audit = null;
  try {
    await driveToVerifyPass(f);
    const spec = managedAdapter(f);
    const main = path.join(f.root,'openspec/specs/cap-a/spec.md');
    const before = fs.readFileSync(main,'utf8');
    const initial = spec.inspect({change:'demo'});
    proof('ACTIVE_INSPECT_NOT_ARCHIVED', false, initial.archived);
    proof('ACTIVE_INSPECT_PHASE', 'archive', initial.phase);

    if (id === 'archive') {
      // Faithful forwarding of a native refusal: without the final archive
      // confirmation Native refuses and the adapter forwards the refusal
      // verbatim — active unmoved, same Run. (The composition-wired Kp
      // refusal rides this same channel; its live journey is P2_4/P4_6.)
      const denied = await spec.closeout({change:'demo'});
      proof('NATIVE_REFUSAL_FORWARDED', false, denied.ok);
      proof('NATIVE_REFUSAL_EXIT', 1, denied.native.exitCode);
      // runClassicCli folds diagnostics into the JSON envelope on stdout.
      assert.match(`${denied.native.stderr ?? ''}${denied.native.stdout ?? ''}`, /archive_confirmation/i);
      proof('REFUSED_ACTIVE_UNMOVED', true, fs.existsSync(f.changeDir));
      proof('REFUSED_MAIN_UNCHANGED', before, fs.readFileSync(main,'utf8'));
      proof('REFUSED_SAME_RUN', initial.runId, spec.inspect({change:'demo'}).runId);
      await f.ok(['state','transition','demo','archive-confirm']);
      const result = await spec.closeout({change:'demo'});
      proof('ARCHIVE_OK', true, result.ok);
      proof('ARCHIVED_SAME_RUN', initial.runId, result.runId);
      proof('ARCHIVED_PHASE', 'archive', result.phase);
      proof('ARCHIVED_MAIN_READBACK', true, result.readback.ok);
      proof('NO_ADAPTER_OVERALL_ACCEPTANCE', false, result.overallCompletionEligible);
      proof('ONE_REAL_ARCHIVE', 1, archiveDirsOf(f.root).length);
      assert.match(fs.readFileSync(main,'utf8'), /#### Scenario: Invalid login/);
      assert.match(fs.readFileSync(main,'utf8'), /### Requirement: Audit trail/);
      // Repeated closeout on the archived Run: reconciliation only, zero
      // native dispatch, no second archive, main specs untouched.
      const archivedBytes = fs.readFileSync(main);
      const again = await spec.closeout({change:'demo'});
      proof('REPEATED_CLOSEOUT_RECONCILED', 'already-archived', again.reconciled);
      proof('REPEATED_CLOSEOUT_NO_NATIVE', true, again.native === null);
      proof('REPEATED_CLOSEOUT_SAME_RUN', initial.runId, again.runId);
      proof('REPEATED_CLOSEOUT_NO_SECOND_ARCHIVE', 1, archiveDirsOf(f.root).length);
      proof('REPEATED_CLOSEOUT_MAIN_STABLE', sha(archivedBytes), sha(fs.readFileSync(main)));
      // state next on the archived Run: honest continuation guidance, never a
      // completion claim and never a re-archive (P4_6 owns the full Kt journey).
      const pending = await spec.recover({change:'demo'});
      proof('RECOVER_SAME_RUN', initial.runId, pending.runId);
      proof('RECOVER_ARCHIVED', true, pending.archived);
      proof('RECOVER_NOT_OVERALL_COMPLETION', false, pending.overallCompletionEligible);
      proof('RECOVER_NO_SECOND_ARCHIVE', 1, archiveDirsOf(f.root).length);
    }

    if (id === 'drift') {
      await f.ok(['state','transition','demo','archive-confirm']);
      const inspected = spec.inspect({change:'demo'});
      const changed = before.replace('authenticate users.','authenticate users via SSO.');
      fs.writeFileSync(main, changed);
      await assert.rejects(spec.closeout({change:'demo',expectedSummaryDigest:inspected.digest}),
        (e) => e.code === 'SPEC_DRIFT');
      proof('DRIFT_BLOCKED_NOT_ARCHIVED', [], archiveDirsOf(f.root));
      proof('CONCURRENT_MAIN_NOT_OVERWRITTEN', changed, fs.readFileSync(main,'utf8'));
      // The stale inspection keeps refusing while ANY side differs from it:
      // restoring the main bytes but editing the change side still refuses.
      fs.writeFileSync(main, before);
      const delta = path.join(f.changeDir,'specs/cap-a/spec.md');
      fs.appendFileSync(delta,'\n');
      await assert.rejects(spec.closeout({change:'demo',expectedSummaryDigest:inspected.digest}),
        (e) => e.code === 'SPEC_DRIFT');
      proof('CHANGE_SIDE_DRIFT_REFUSED', [], archiveDirsOf(f.root));
      fs.writeFileSync(delta, fs.readFileSync(delta,'utf8').replace(/\n$/,''));
      // A digest of the CURRENT state is required to proceed — a fresh
      // inspection after the drift is the only honest re-authorization.
      const fresh = spec.inspect({change:'demo'});
      const result = await spec.closeout({change:'demo',expectedSummaryDigest:fresh.digest});
      proof('FRESH_INSPECTION_CLOSEOUT_OK', true, result.ok);
      proof('DRIFT_ONE_ARCHIVE', 1, archiveDirsOf(f.root).length);
    }

    if (id === 'restart') {
      await f.ok(['state','transition','demo','archive-confirm']);
      // A separate process performs the real archive through the adapter and
      // reports the commit; the parent kills it before it can answer again —
      // the controller loses the response after the real commit.
      const crash = await crashAfterArchive(f);
      proof('ACTUAL_ARCHIVE_WRITER_SIGKILL','SIGKILL',crash.signal,{pid:crash.pid});
      proof('CRASH_RETAINS_COMMITTED_RUN', crash.runId, spec.inspect({change:'demo'}).runId);
      const resumed = await spec.closeout({change:'demo'});
      proof('CRASH_RESUME_RECONCILED', 'already-archived', resumed.reconciled);
      proof('CRASH_RESUME_SAME_RUN', crash.runId, resumed.runId);
      proof('CRASH_RESUME_NO_SECOND_ARCHIVE', 1, archiveDirsOf(f.root).length);
      proof('CRASH_RESUME_MAIN_READBACK', true, resumed.readback.ok);
      assert.match(fs.readFileSync(main,'utf8'), /#### Scenario: Invalid login/);
    }

    if (id === 'premove') {
      await f.ok(['state','transition','demo','archive-confirm']);
      const collision = path.join(f.root,'openspec/changes/archive',new Date().toISOString().slice(0,10)+'-demo');
      fs.mkdirSync(collision,{recursive:true});
      try {
        await assert.rejects(spec.closeout({change:'demo'}), (e) => e.code === 'AMBIGUOUS_ARCHIVE');
        proof('BEFORE_MOVE_FAILURE_ACTIVE_UNMOVED', true, fs.existsSync(f.changeDir));
        proof('BEFORE_MOVE_FAILURE_MAIN_UNCHANGED', before, fs.readFileSync(main,'utf8'));
        proof('BEFORE_MOVE_NOT_ARCHIVED', [path.basename(collision)], archiveDirsOf(f.root));
      } finally { fs.rmSync(collision,{recursive:true,force:true}); }
      const recovered = await spec.recover({change:'demo'});
      proof('BEFORE_MOVE_RECOVERY_ORIGINAL_RUN', initial.runId, recovered.runId);
      proof('BEFORE_MOVE_RECOVERY_STILL_ACTIVE', true, fs.existsSync(f.changeDir));
      const result = await spec.closeout({change:'demo'});
      proof('AFTER_COLLISION_REMOVAL_CLOSEOUT_OK', true, result.ok);
      proof('ONE_REAL_ARCHIVE_AFTER_COLLISION', 1, archiveDirsOf(f.root).length);
    }
  } finally { audit = f.close(); }
  console.log(JSON.stringify({case:id,fingerprint,scope:'component/original-comet-spec-operation',
    assertions,acceptedBusinessScenarios:0,audit}));
}

async function crashAfterArchive(f) {
  const env={...process.env}; delete env.NODE_TEST_CONTEXT;
  const child=spawn(process.execPath,[fileURLToPath(import.meta.url),'--spec-restart','archive'],
    {cwd:repository,env,stdio:['pipe','pipe','pipe','ipc']});
  const output=[]; child.stdout.on('data',chunk=>output.push(chunk)); child.stderr.on('data',chunk=>output.push(chunk));
  const ended=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));});
  const committed=new Promise((resolve,reject)=>{
    child.once('message',resolve); child.once('exit',()=>reject(new Error('archive child exited before its commit notification')));
  });
  child.stdin.end(JSON.stringify({root:f.root})); // fixture wiring only, never a receipt
  try {
    const record=await committed;
    assert.equal(record.kind,'archive-committed',Buffer.concat(output).toString());
    assert.equal(record.ok,true);
    assert.equal(child.kill('SIGKILL'),true);
    const terminal=await ended;
    assert.equal(terminal.signal,'SIGKILL');
    return {pid:child.pid,signal:terminal.signal,runId:record.runId};
  } finally {
    if(child.exitCode===null && child.signalCode===null) {child.kill('SIGKILL'); await ended;}
  }
}

if (specRestart>=0) {
  // Child writer: rebind the adapter on the parent-driven project, perform the
  // one real archive, report the committed Run, then park. The parent kills
  // this exact temporary writer after the commit notification.
  let input=''; for await(const part of process.stdin) input+=part;
  const {root}=JSON.parse(input);
  const native=await import(cometRuntimeUrl);
  const runModule=await import(cometRunModuleUrl);
  const spec=adapter.createManagedSpecAdapter({
    runtime:{runClassicCli:native.runClassicCli,ensureClassicRuntimeRun:runModule.ensureClassicRuntimeRun},
    projectRoot:root});
  const result=await spec.closeout({change:'demo'});
  process.send?.({kind:'archive-committed',ok:result.ok,runId:result.runId});
  setInterval(()=>{},1000);
} else if (specCase >= 0) {
  await nativeSpecScenario(process.argv[specCase+1]);
} else {
  test('P3_4 exact official SDK distribution is verified',async()=>{
    assert.equal(process.versions.node,lock.toolchain.node);
    assert.equal((await verifyCometDistribution({projectRoot:repository,lock})).status,'PASS');
    assert.equal(hostVersion.stdout.trim(),'1.15.0');
  });
  for (const [id,name] of [['archive','A11/N07: actual Native archive refusal forwarding, same-Run archive and repeated-closeout reconciliation'],['drift','B08/N07: stale inspection and restored bytes cannot revive archive permission'],['restart','A11: actual archive writer crash resumes the original committed Run without repeat sync'],['premove','A11: before-move archive target conflict recovers on the same original Run']]) {
    test(name,{timeout:330000},()=>{
      const env={...process.env}; delete env.NODE_TEST_CONTEXT;
      const result=spawnSync(process.execPath,[fileURLToPath(import.meta.url),'--spec-mechanism',id],{cwd:repository,env,encoding:'utf8',timeout:300000});
      assert.equal(result.status,0,result.stdout+result.stderr);
      const proof=JSON.parse(result.stdout.trim().split('\n').at(-1));
      assert.equal(proof.fingerprint,fingerprint);
      assert.equal(proof.scope,'component/original-comet-spec-operation');
      assert.equal(proof.acceptedBusinessScenarios,0);
      assert.ok(proof.audit,'the mechanism run must leave its command audit');
    });
  }
}

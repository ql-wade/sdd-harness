// P1_5 delivery case, revision 2026-10-26-comet-050-adoption-v1: the
// hooks-absent common-gate probes against the pinned 0.5.0 build
// (aeb1a659… + exactly the 0005 Kt closeout patch, build fingerprint
// de39629a…). C07/e and the C08 bypass family: with the host hook
// registration REMOVED (.claude/settings.local.json moved away for the whole
// probe session), the CLI-side common gates still refuse every gate-skipping
// entrance —
//   guard / guard --apply / transition (a manual record-check declaration
//   never satisfies the guard) / archive outside the archive phase / the
//   direct `state set phase` write / a shell-forged phase file that cannot
//   carry the archive entry / and both `comet runtime dispatch` package
//   refusals (wrong entry name INVALID_WORKFLOW, missing package ENOENT).
// The hook is the edit-channel attribution (A09, probed by 1_3.mjs); the
// common gates are CLI-side and survive its absence — hook absence is not a
// gate bypass. What this case does NOT claim: installing the compiled
// composition package into a live project and dispatching inside a real
// composition Run (P1_4/P3_2/VERIFY — UNVERIFIED), and the full archive
// drive with the duplicate-closeout refusal (1_3.mjs on the same build).
// Every Comet interaction runs in a scratch project under $TMPDIR with an
// isolated HOME and PATH stubs; live host configuration is never touched.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const changeRoot = path.join(projectRoot, 'openspec/changes/delivery-foundation-rearchitecture');
const probesDir = path.join(changeRoot, 'classic-integration-probes');
const lock = JSON.parse(await fs.readFile(path.join(projectRoot, 'integrations/comet/upstream.lock.json'), 'utf8'));

const fingerprint = crypto.createHash('sha256').update(JSON.stringify({
  archive: lock.source.sha256,
  patches: lock.patches.map(({ path, sha256 }) => ({ path, sha256 })),
  toolchain: lock.toolchain,
})).digest('hex');
const buildDir = path.join(projectRoot, '.sdd/vendor/comet', lock.source.commit, 'builds', fingerprint);
const entrypoint = path.join(buildDir, 'work/bin/comet.js');

const built = await fs.access(path.join(buildDir, 'distribution.json')).then(() => true, () => false);
const prepared = await fs.access(path.join(projectRoot, '.sdd/vendor/comet', lock.source.commit, 'provenance.json')).then(() => true, () => false);

const pinnedNode = lock.toolchain.node;
let nodeExecutable = process.execPath;
if (process.versions.node !== pinnedNode) {
  const candidate = path.join(process.env.HOME ?? '', '.nvm/versions/node', `v${pinnedNode}`, 'bin/node');
  const probe = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
  if (probe.status === 0 && probe.stdout.trim() === `v${pinnedNode}`) nodeExecutable = candidate;
}

const plain = (text) => String(text ?? '').replace(/\x1b\[[0-9;]*m/g, '');

// The structured probe registration is the RED boundary: without it the
// entrance/bypass behaviors carry no registered real-entry evidence.
async function loadProbe(name) {
  try {
    return JSON.parse(await fs.readFile(path.join(probesDir, name), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      const failure = new Error(`classic-integration-probes/${name} is missing: the C07/C08 behaviors have no registered real-entry evidence (task P1_5 deliverable)`);
      failure.code = 'CLASSIC_INTEGRATION_PROBE_MISSING';
      throw failure;
    }
    throw error;
  }
}

// --- scratch world (created once; all probes are real CLI interactions)
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'p15-case-'));
const fakeHome = path.join(scratch, 'home');
const stubs = path.join(scratch, 'stubs');
const project = path.join(scratch, 'classic');
const stubLog = path.join(scratch, 'stub-calls.log');
await fs.mkdir(fakeHome, { recursive: true });
await fs.mkdir(project, { recursive: true });
await fs.mkdir(stubs, { recursive: true });
const logger = '#!/bin/sh\necho "[stub] $0 $@" >> "${STUB_LOG:-/dev/null}"\nexit 0\n';
await fs.writeFile(path.join(stubs, 'npm'), logger, { mode: 0o755 });
await fs.writeFile(path.join(stubs, 'npx'), logger, { mode: 0o755 });
// A faithful-enough openspec stub: `init <dir>` creates the openspec root and
// the tool output a real init would (the comet init command re-reads it).
await fs.writeFile(path.join(stubs, 'openspec'), `#!/bin/sh
echo "[stub] openspec $@" >> "\${STUB_LOG:-/dev/null}"
pos1=""; pos2=""; count=0
for arg in "$@"; do
  case "$arg" in --*) ;; *) count=$((count+1)); if [ "$count" -eq 1 ]; then pos1="$arg"; elif [ "$count" -eq 2 ]; then pos2="$arg"; fi ;; esac
done
if [ "$pos1" = "init" ] && [ -n "$pos2" ]; then
  mkdir -p "$pos2/openspec" "$pos2/.claude/commands" "$pos2/.claude/skills"
  printf 'schema: openspec-1.0\\n' > "$pos2/openspec/config.yaml"
  echo "fake skill" > "$pos2/.claude/commands/openspec.md"
fi
exit 0
`, { mode: 0o755 });

// The comet CLI is itself a Node program: the test runner's child context
// marker (NODE_TEST_CONTEXT) must never reach it, or its stdout stops being
// the CLI's own output. cwd stays INSIDE the project (the 0.5.0 user-runtime
// root refuses to live inside the current working tree).
const childEnv = (extra = {}) => {
  const { NODE_TEST_CONTEXT: _stripped, ...inherited } = process.env;
  return {
    ...inherited,
    HOME: fakeHome,
    STUB_LOG: stubLog,
    COMET_PROJECT_ROOT: project,
    PATH: `${stubs}:${process.env.PATH ?? ''}`,
    ...extra,
  };
};

function comet(args, { env = {}, timeout = 180_000 } = {}) {
  const result = spawnSync(nodeExecutable, [entrypoint, ...args], {
    cwd: project,
    encoding: 'utf8',
    timeout,
    env: childEnv(env),
  });
  let json = null;
  try { json = JSON.parse(result.stdout ?? ''); } catch { /* non-JSON output stays raw */ }
  return { ...result, json };
}

const CHANGE = 'p15-integrate';
const skipIfNoBuild = (t) => {
  if (!prepared || !built) {
    t.skip('the pinned 0.5.0+0005 Comet build is not present in this project; run tools/comet/prepare-source.mjs && tools/comet/build.mjs --archive first');
    return true;
  }
  return false;
};

const settingsFile = path.join(project, '.claude/settings.local.json');
const stateFileOf = (change) => path.join(project, 'docs/openspec/changes', change, '.comet.yaml');

test('setup: the pinned 0.5.0+0005 build named by the source lock is manifest-verified in this project', (t) => {
  // ADR-0022 identity, same bite as 1_3: the retired 0.4.5 six-patch stack
  // and the pre-0005 pristine 0.5.0 build must never satisfy this case.
  assert.equal(lock.package.version, '0.5.0');
  assert.equal(lock.source.commit, 'aeb1a6598034e28ce46b8422d4dbd8785e607bd7');
  assert.deepEqual(lock.patches, [
    { path: 'integrations/comet/patches/0005-comet-050-kt-closeout.patch', sha256: '74e6c8108967ac10b9ac31e2f4c3ba2dfa6d53930dcf2b5068fe7d9be003b18d' },
  ], 'the pinned baseline is upstream 0.5.0 + exactly the 0005 Kt closeout patch');
  assert.notEqual(fingerprint, 'cb1151b4f3a301c9f2e9da87695155bf05285c925ea4abbbcea7120c9413f187', 'the 0.4.5 discovery build must not satisfy this case');
  assert.notEqual(fingerprint, '29f2332b4f624c1595d6d1304456f5de4e6b9b7642633995b79c0cab60ea1aad', 'the pristine 0.5.0 build (without 0005) must not satisfy this case');
  if (skipIfNoBuild(t)) return;
  const version = comet(['--version']);
  assert.equal(version.status, 0);
  assert.equal((version.stdout ?? '').trim(), lock.package.version);
});

test('C07/e: with the host hook registration removed, the CLI-side common gates still refuse every gate-skipping entrance', async (t) => {
  if (skipIfNoBuild(t)) return;
  await loadProbe('entrances-c07.json');
  // Drive one classic compat run to the build phase with the task completed
  // and a manual record-check declared (the strictest refusal state).
  const init = comet(['init', project, '--yes', '--scope', 'project', '--workflow', 'classic', '--platform', 'claude', '--codegraph', 'skip', '--language', 'en'], { timeout: 300_000 });
  assert.equal(init.status, 0, `comet init (classic) failed: ${plain(init.stderr).slice(0, 400)}`);
  assert.ok(await fs.access(settingsFile).then(() => true, () => false), 'init must install the host hook registration (removed only for the probes below)');
  assert.equal(comet(['state', 'init', CHANGE, 'full', '--json']).json?.exitCode, 0);
  assert.equal(comet(['state', 'select', CHANGE, '--json']).json?.exitCode, 0);
  const changeDir = path.join(project, 'docs/openspec/changes', CHANGE);
  await fs.mkdir(changeDir, { recursive: true });
  await fs.writeFile(path.join(changeDir, 'proposal.md'), '# Proposal\n\nP1_5 hooks-absent probe.\n');
  await fs.writeFile(path.join(changeDir, 'tasks.md'), '# Tasks\n\n- [ ] 1.1 Implement probe product code\n');
  await fs.writeFile(path.join(changeDir, 'design.md'), '# Design\n\nCLI-side common gates.\n');
  assert.equal(comet(['state', 'transition', CHANGE, 'open-complete', '--json']).json?.exitCode, 0);
  comet(['state', 'complete-design', CHANGE, '--design-doc', `docs/openspec/changes/${CHANGE}/design.md`, '--json']);
  assert.equal(comet(['state', 'transition', CHANGE, 'design-complete', '--json']).json?.exitCode, 0);
  assert.equal(comet(['state', 'set', CHANGE, 'build_mode', 'executing-plans', 'tdd_mode', 'tdd', 'isolation', 'current', '--json']).json?.exitCode, 0);
  const tasks = comet(['state', 'tasks', CHANGE, '--assign-ids', '--json']).json;
  assert.equal(comet(['state', 'task-complete', CHANGE, tasks?.data?.tasks?.[0]?.id, '--expect', tasks?.data?.revision, '--json']).json?.exitCode, 0);
  assert.equal(comet(['state', 'record-check', CHANGE, 'build', '--command', 'node -e 0', '--exit-code', '0', '--json']).json?.exitCode, 0, 'recording the manual declaration itself is allowed');

  // HOOKS ABSENT for the whole probe session: the registration is moved away
  // and restored in the finally below — the common gates must hold without it.
  const settingsBackup = path.join(scratch, 'settings.local.json.moved');
  await fs.rename(settingsFile, settingsBackup);
  assert.ok(!(await fs.access(settingsFile).then(() => true, () => false)), 'the hook registration must really be absent during the probes');
  const phase = () => comet(['state', 'get', CHANGE, 'phase']).stdout?.trim();
  try {
    // 1. guard preview: blocked without the real build check.
    const guard = comet(['guard', CHANGE, 'build', '--json']);
    assert.equal(guard.json?.exitCode, 1, 'the guard entrance must refuse without the build check');
    assert.equal(guard.json?.data?.checks?.blocked, true);

    // 2. guard --apply: refused AND the phase does not move.
    const apply = comet(['guard', CHANGE, 'build', '--apply', '--json']);
    assert.equal(apply.json?.exitCode, 1, 'a refused guard --apply must not pass');
    assert.equal(phase(), 'build', 'a refused guard --apply must not advance the phase');

    // 3. transition: the manual record-check declaration never satisfies it.
    const transition = comet(['state', 'transition', CHANGE, 'build-complete', '--json']);
    assert.equal(transition.json?.exitCode, 1, 'the transition entrance must refuse a manual declaration');
    assert.ok(
      (transition.json?.data?.issues ?? []).some((issue) => /Manual declarations never satisfy the guard/.test(issue.message ?? '')),
      `the refusal must name the manual-declaration rule: ${JSON.stringify(transition.json?.data?.issues ?? []).slice(0, 200)}`,
    );

    // 4. next/continuation recovery: guidance, never a completion claim.
    const next = comet(['state', 'next', CHANGE, '--json']);
    assert.equal(next.json?.exitCode, 0);
    const nextKind = next.json?.data?.nextAction?.kind ?? next.json?.agent?.continuation?.kind;
    assert.equal(nextKind, 'plan', 'an interrupted run resumes as continuation guidance, not completion');

    // 5. archive entrance outside the archive phase.
    const archive = comet(['archive', CHANGE, '--json']);
    assert.equal(archive.json?.exitCode, 1, 'the archive entrance must refuse outside the archive phase');
    assert.match(plain(archive.json?.stderr), /FATAL: phase is 'build', expected 'archive'/);

    // 6. dispatch entrance: a package whose entry file is not application.json.
    const requestFile = path.join(scratch, 'request.json');
    await fs.writeFile(requestFile, JSON.stringify({ operation: 'next', runId: CHANGE }));
    const wrongName = comet(['runtime', 'dispatch', '--application-file', path.join(scratch, 'not-an-application.json'), '--request', requestFile, '--json']);
    assert.equal(wrongName.status, 65, 'the dispatch entrance must refuse a wrong-name entry file');
    assert.equal(wrongName.json?.error?.code, 'INVALID_WORKFLOW');

    // 7. dispatch entrance: a missing package directory.
    const missing = comet(['runtime', 'dispatch', '--application-file', path.join(scratch, 'missing-dir', 'application.json'), '--request', requestFile, '--json']);
    assert.equal(missing.status, 70, 'the dispatch entrance must refuse a missing application package');
    assert.equal(missing.json?.error?.code, 'RUNTIME_ERROR');
    assert.match(missing.json?.error?.message ?? '', /ENOENT/);

    // Registration consistency: the probe record cites these same refusals.
    const entrances = await loadProbe('entrances-c07.json');
    const byId = Object.fromEntries(entrances.records.map((record) => [record.id, record]));
    assert.equal(byId['guard-preview']?.observed?.exitCode, 1);
    assert.equal(byId['guard-apply']?.observed?.exitCode, 1);
    assert.equal(byId['guard-apply']?.observed?.phaseAfter, 'build');
    assert.equal(byId['transition-manual-declaration']?.observed?.exitCode, 1);
    assert.equal(byId['next-continuation']?.observed?.kind, 'plan');
    assert.equal(byId['archive-outside-phase']?.observed?.exitCode, 1);
    assert.equal(byId['dispatch-entry-name']?.observed?.exitCode, 65);
    assert.equal(byId['dispatch-missing-package']?.observed?.exitCode, 70);
  } finally {
    await fs.rename(settingsBackup, settingsFile);
  }
  assert.ok(await fs.access(settingsFile).then(() => true, () => false), 'the hook registration must be restored after the probes');
});

test('C08 bypass negatives: the direct phase write, the forged phase file and the manual declaration cannot carry a gate (hooks absent)', async (t) => {
  if (skipIfNoBuild(t)) return;
  const record = await loadProbe('bypass-recovery.json');

  // Hooks absent again for the whole bypass session.
  const settingsBackup = path.join(scratch, 'settings-bypass.moved');
  await fs.rename(settingsFile, settingsBackup);
  try {
    // (a) direct phase write through the state command: refused by the CLI
    // itself — it would bypass state machine evidence checks.
    const direct = comet(['state', 'set', CHANGE, 'phase', 'archive', '--json']);
    assert.equal(direct.json?.exitCode, 1, 'a direct phase write must be refused');
    assert.ok(
      (direct.json?.data?.issues ?? []).some((issue) => /Setting 'phase' directly is not allowed/.test(issue.message ?? '')),
      'the refusal must name the evidence-check rule',
    );

    // (b) shell-forged phase in the change state file: the managed check
    // verdict still demands the real verification receipt.
    const stateFile = stateFileOf(CHANGE);
    const original = await fs.readFile(stateFile, 'utf8');
    await fs.writeFile(stateFile, original.replace(/^phase: build$/m, 'phase: archive'));
    const check = comet(['state', 'check', CHANGE, 'archive', '--json']);
    assert.equal(check.json?.exitCode, 1, 'a forged phase must not carry the archive entry');
    assert.equal(check.json?.data?.checks?.blocked, true);
    assert.match(JSON.stringify(check.json?.data?.issues ?? []), /verify_result/);
    await fs.writeFile(stateFile, original);
    assert.equal(comet(['state', 'get', CHANGE, 'phase']).stdout?.trim(), 'build', 'fixture must be restored state-independently');
  } finally {
    await fs.rename(settingsBackup, settingsFile);
  }

  // Registration consistency.
  const directRecord = record.records.find((entry) => entry.id === 'direct-phase-write');
  assert.equal(directRecord?.observed?.exitCode, 1);
  const tampered = record.records.find((entry) => entry.id === 'tampered-phase-file');
  assert.equal(tampered?.observed?.checkExit, 1);
  assert.equal(tampered?.observed?.blocked, true);
  const manual = record.records.find((entry) => entry.id === 'manual-record-check');
  assert.equal(manual?.observed?.recordExit, 0);
  assert.equal(manual?.observed?.transitionExit, 1);
});

test('cleanup removes the scratch world', async (t) => {
  if (skipIfNoBuild(t)) return;
  await fs.rm(scratch, { recursive: true, force: true });
});

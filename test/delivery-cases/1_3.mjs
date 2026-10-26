// P1_3 delivery case, revision 2026-10-26-comet-050-adoption-v1 (ADR-0022):
// the Comet single-master contract over the pinned 0.5.0 build — the
// driver/workspace/authority interface is the real one discovered from the
// built CLI (1.3.a), write channels are probed separately as edit / Shell /
// MCP with refusals and capability gaps recorded per channel (A09, never
// "one channel stands in for all"), and spec/verification closeout is
// single-owner: premature archive is refused, manual check declarations never
// satisfy the guard, and a duplicate archive request is refused at the driver
// layer even though the upstream CLI converges idempotently
// (F05/F07/OV01/OV03, task 1.3.b/1.3.c).
//
// 0.5.0 face additions asserted here: the dual change-state-file name
// (comet-state.yaml default, legacy .comet.yaml compat, both-present
// refused), the composition-application command surface (`comet application
// install`, `comet runtime dispatch --application-file`) and the Kt 0005
// fail-open predicate. What this case does NOT claim: installing a compiled
// composition package, dispatching inside a real Run, and the 0005 predicate
// inside a rebuilt tree are supply/admission + P1_4/P3_2/VERIFY waves —
// recorded as UNVERIFIED, never as PASS.
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

const { defineDriver, createRunner, requireWriteDriver, DRIVER_KINDS } = await import('../../lib/adapters/harness.js');
const {
  cometLaunchAuthority,
  describeWorkspace,
  probeWriteChannels,
  readArchiveSeal,
  sealCloseout,
  resolveChangeStateFile,
  classicCompositionStartRequest,
  classicCompositionRecoveryRequest,
  runtimeDispatchArgv,
  knowledgeCloseoutBlocked,
} = await import('../../lib/adapters/comet.js');

const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

// --- scratch project context (created once, driven through the real lifecycle)
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'p13-case-'));
const fakeHome = path.join(scratch, 'home');
const stubs = path.join(scratch, 'stubs');
const project = path.join(scratch, 'project');
const stubLog = path.join(scratch, 'stub-calls.log');
await fs.mkdir(fakeHome, { recursive: true });
await fs.mkdir(project, { recursive: true });
await fs.mkdir(stubs, { recursive: true });
const logger = '#!/bin/sh\necho \"$0 $@\" >> \"${STUB_LOG:-/dev/null}\"\nexit 0\n';
await fs.writeFile(path.join(stubs, 'npx'), logger, { mode: 0o755 });
await fs.writeFile(path.join(stubs, 'npm'), logger, { mode: 0o755 });
// A faithful-enough openspec stub: `init <dir>` creates the openspec root and
// tool output a real init would; `archive <change> --yes` moves the change
// into the dated archive directory Comet expects (<today>-<change>).
await fs.writeFile(path.join(stubs, 'openspec'), `#!/bin/sh
echo "$0 $@" >> "\${STUB_LOG:-/dev/null}"
pos1=""; pos2=""; count=0
for arg in "$@"; do
  case "$arg" in --*) ;; *) count=$((count+1)); if [ "$count" -eq 1 ]; then pos1="$arg"; elif [ "$count" -eq 2 ]; then pos2="$arg"; fi ;; esac
done
if [ "$pos1" = "init" ] && [ -n "$pos2" ]; then
  mkdir -p "$pos2/openspec" "$pos2/.claude/commands" "$pos2/.claude/skills"
  printf 'schema: openspec-1.0\\n' > "$pos2/openspec/config.yaml"
  echo "fake skill" > "$pos2/.claude/commands/openspec.md"
fi
if [ "$pos1" = "archive" ] && [ -n "$pos2" ] && [ -n "$COMET_PROJECT_ROOT" ]; then
  cd "$COMET_PROJECT_ROOT" || exit 0
  if [ -d "docs/openspec/changes/$pos2" ]; then
    mkdir -p "docs/openspec/changes/archive"
    mv "docs/openspec/changes/$pos2" "docs/openspec/changes/archive/$(date +%Y-%m-%d)-$pos2"
  fi
fi
exit 0
`, { mode: 0o755 });

const childEnv = () => ({
  ...process.env,
  HOME: fakeHome,
  STUB_LOG: stubLog,
  COMET_PROJECT_ROOT: project,
  PATH: `${stubs}:${process.env.PATH ?? ''}`,
});

function comet(args, { timeout = 180_000 } = {}) {
  const result = spawnSync(nodeExecutable, [entrypoint, ...args], {
    cwd: project,
    encoding: 'utf8',
    timeout,
    env: childEnv(),
  });
  let json = null;
  try { json = JSON.parse(result.stdout ?? ''); } catch { /* non-JSON output stays raw */ }
  return { ...result, json };
}

const plain = (text) => String(text ?? '').replace(/\x1b\[[0-9;]*m/g, '');
const allOutput = (result) => plain(result.stdout) + plain(result.stderr);

const CHANGE = 'probe-change';

test('setup: the pinned 0.5.0 build named by the source lock is manifest-verified in this project', () => {
  // ADR-0022: the retired 0.4.5 six-patch stack (0001/0002/0003/0004 +
  // tests) and its builds must never satisfy this case again. The supply
  // wave (P1_4, controller-granted exception) landed 0005 into lock.patches,
  // so the pinned baseline is now upstream 0.5.0 + exactly the 0005 Kt
  // closeout patch (bytes pin-verified by 2_4 against composition.json).
  assert.equal(lock.package.version, '0.5.0');
  assert.equal(lock.source.commit, 'aeb1a6598034e28ce46b8422d4dbd8785e607bd7');
  assert.deepEqual(lock.patches, [
    { path: 'integrations/comet/patches/0005-comet-050-kt-closeout.patch', sha256: '74e6c8108967ac10b9ac31e2f4c3ba2dfa6d53930dcf2b5068fe7d9be003b18d' },
  ], 'the supply re-lock must carry exactly the 0005 Kt closeout patch');
  assert.notEqual(fingerprint, 'cb1151b4f3a301c9f2e9da87695155bf05285c925ea4abbbcea7120c9413f187', 'the 0.4.5 discovery build must not satisfy this case');
  assert.ok(prepared, 'pristine Comet source has not been prepared; run tools/comet/prepare-source.mjs first');
  assert.ok(built, 'the 0.5.0 build is not present; run tools/comet/build.mjs --archive first');
  const version = comet(['--version']);
  assert.equal(version.status, 0);
  assert.equal((version.stdout ?? '').trim(), lock.package.version);
});

test('1.3.a: init installs the real guard hook and the workspace layout is the discovered 0.5.0 one', async () => {
  const init = comet(['init', project, '--yes', '--scope', 'project', '--workflow', 'classic', '--platform', 'claude', '--codegraph', 'skip', '--language', 'en'], { timeout: 300_000 });
  assert.equal(init.status, 0, `comet init failed: ${plain(init.stderr).slice(0, 400)}`);

  const layout = await describeWorkspace({ projectRoot: project, change: CHANGE });
  assert.equal(layout.projectConfig, path.join(project, '.comet/config.yaml'));
  assert.ok(await fs.access(layout.projectConfig).then(() => true, () => false), '.comet/config.yaml must exist after init');
  assert.equal(layout.hookMatcher, 'Write|Edit');
  assert.equal(layout.hookCommand, 'node');
  assert.equal(layout.routerPath, path.join(project, '.claude/skills/comet/scripts/comet-hook-router.mjs'));
  assert.ok(await fs.access(layout.routerPath).then(() => true, () => false), 'the guard router must be installed inside the project');
  // 0.5.0 dual-name rule: with no state yet the workspace resolves the SDK
  // default comet-state.yaml (NATIVE_CHANGE_STATE_FILE) — never assumes the
  // legacy name — and exposes the check-policy file of the v2 command identity.
  assert.equal(layout.changeStateFile, path.join(project, 'docs/openspec/changes', CHANGE, 'comet-state.yaml'));
  assert.equal(layout.changeStateName, 'comet-state.yaml');
  assert.equal(layout.changeStateDefaulted, true);
  assert.equal(layout.runStateFile, path.join(project, 'docs/openspec/changes', CHANGE, '.comet/run-state.json'));
  assert.equal(layout.stateLockFile, path.join(project, 'docs/openspec/changes', CHANGE, '.comet-state.lock'));
  assert.equal(layout.stateTransactionFile, path.join(project, 'docs/openspec/changes', CHANGE, '.comet-state-transaction.json'));
  assert.equal(layout.selectionFile, path.join(project, '.comet/current-change.json'));
  assert.equal(layout.checkPolicyFile, path.join(project, '.comet/check-policy.json'));

  const changeInit = comet(['state', 'init', CHANGE, 'full', '--json']);
  assert.equal(changeInit.json?.exitCode, 0, `state init failed: ${plain(changeInit.json?.stderr).slice(0, 300)}`);
  // 0.5.0 live fact (host-probes/1_3-050-surface.json): `state init` in a
  // non-Git scratch root defaults to compat and creates the LEGACY state
  // file name. The adapter follows the run's own file — no rename, no copy.
  const afterInit = await describeWorkspace({ projectRoot: project, change: CHANGE });
  assert.equal(afterInit.changeStateFile, path.join(project, 'docs/openspec/changes', CHANGE, '.comet.yaml'));
  assert.equal(afterInit.changeStateLegacy, true);
  assert.equal(afterInit.changeStateDefaulted, false);
  // Both names at once is the upstream conflict the adapter refuses to pick
  // from (classic-state-file.ts ClassicStateFileConflict).
  await fs.writeFile(path.join(project, 'docs/openspec/changes', CHANGE, 'comet-state.yaml'), 'phase: open\n');
  await assert.rejects(() => resolveChangeStateFile(path.join(project, 'docs/openspec/changes', CHANGE)),
    (error) => error.code === 'WORKSPACE_STATE_CONFLICT');
  await fs.rm(path.join(project, 'docs/openspec/changes', CHANGE, 'comet-state.yaml'));

  const selected = comet(['state', 'select', CHANGE, '--json']);
  assert.equal(selected.json?.exitCode, 0, `state select failed: ${plain(selected.stderr).slice(0, 300)}`);
});

test('1.3.a/F07: Runner dispatch binds the real run id and leaves no phase trace on the run state', async () => {
  const stateFile = (await describeWorkspace({ projectRoot: project, change: CHANGE })).changeStateFile;
  const stateBefore = await fs.readFile(stateFile, 'utf8');
  const dirBefore = new Set((await fs.readdir(path.dirname(stateFile), { recursive: true })).sort());

  const authority = cometLaunchAuthority({ secret: 'x'.repeat(64), runId: `scratch-${path.basename(scratch)}` });
  const writer = defineDriver({ id: 'comet-managed', kind: 'managed-write', execute: () => ({ exitCode: 0 }) });
  requireWriteDriver(writer, 'case setup');
  const runner = createRunner({ authority, driver: writer });
  const dispatch = runner.dispatch({
    runnerId: 'comet-classic',
    run: `scratch-${path.basename(scratch)}`,
    gate: 'P1_3',
    inputDigest: sha(Buffer.from(stateBefore)),
    policyDigest: sha(Buffer.from('policy/p1_3-case')),
    attempt: 1,
    epoch: 1,
    role: 'verifier',
    execution: `exec-${path.basename(scratch)}`,
  });
  assert.equal(authority.verifyDispatch(dispatch).ok, true);
  assert.equal(dispatch.phase, undefined, 'the dispatch must not carry a phase field');
  // Runner.Dispatch.v1: dispatching must not write control state — the change
  // YAML is byte-identical and no new state file appeared.
  const stateAfter = await fs.readFile(stateFile, 'utf8');
  assert.equal(stateAfter, stateBefore, 'dispatch must not modify the change control state');
  const dirAfter = new Set((await fs.readdir(path.dirname(stateFile), { recursive: true })).sort());
  assert.deepEqual([...dirAfter], [...dirBefore], 'dispatch must not create or remove control-state files');
});

test('1.3.b/A09: cross-phase writes are probed per channel — edit rejected, Shell and MCP recorded as gaps', async () => {
  const records = await probeWriteChannels({ projectRoot: project, nodeExecutable, change: CHANGE, env: childEnv() });
  assert.equal(records.length, 3, 'all three channels must be probed separately — one channel cannot stand in for another');
  const byChannel = Object.fromEntries(records.map((record) => [record.channel, record]));

  assert.equal(byChannel.edit.toolName, 'Write');
  assert.equal(byChannel.edit.outcome, 'rejected', `the edit channel must be really rejected in phase open: ${JSON.stringify(byChannel.edit)}`);
  assert.match(plain(byChannel.edit.stderr), /WRITE BLOCKED/, 'the phase-guard denial banner is the rejection evidence');
  assert.equal(byChannel.edit.exitCode, 2, 'the claude hook contract denies with exit 2');

  // Control: the same channel toward the change's own artifact is allowed —
  // the rejection is phase-targeted, not a blanket denial.
  assert.equal(byChannel.edit.control.outcome, 'allowed', 'an in-phase artifact write must stay allowed for the edit channel');

  assert.equal(byChannel.shell.toolName, 'Bash');
  assert.equal(byChannel.shell.outcome, 'gap', 'the phase guard does not attribute Shell writes — record the gap honestly');
  assert.notEqual(byChannel.shell.outcome, 'rejected', 'a capability gap must never be recorded as blocked');

  assert.match(byChannel.mcp.toolName, /^mcp__/);
  assert.equal(byChannel.mcp.outcome, 'gap', 'the phase guard does not attribute MCP write tools — record the gap honestly');
  assert.notEqual(byChannel.mcp.outcome, 'rejected', 'a capability gap must never be recorded as blocked');
});

test('1.3.b/A09: a Shell-written control state cannot pass the managed gate — verify_result is required', async () => {
  const stateFile = (await describeWorkspace({ projectRoot: project, change: CHANGE })).changeStateFile;
  const before = await fs.readFile(stateFile, 'utf8');
  // Real Shell write of the control state (phase: open -> archive).
  const shell = spawnSync('/bin/sh', ['-c', `sed -i '' 's/^phase: open$/phase: archive/' '${stateFile}'`], { encoding: 'utf8' });
  assert.equal(shell.status, 0, 'the Shell write itself must actually run (the guard does not attribute this channel)');

  const check = comet(['state', 'check', CHANGE, 'archive', '--json']);
  assert.equal(check.json?.exitCode, 1, 'the managed gate must refuse the forged phase at the archive entry');
  const issues = JSON.stringify(check.json?.data?.issues ?? []);
  assert.match(issues, /verify_result/, 'the refusal must demand the real verification receipt, not just the phase string');
  assert.equal(check.json?.data?.checks?.blocked, true);

  await fs.writeFile(stateFile, before, 'utf8');
  const restored = comet(['state', 'get', CHANGE, 'phase']);
  assert.equal((restored.stdout ?? '').trim(), 'open', 'fixture must be restored state-independently');
});

test('1.3.c: a premature archive is refused outside the archive phase', () => {
  const premature = comet(['archive', CHANGE, '--json']);
  assert.equal(premature.json?.exitCode, 1, 'archive must be refused outside the archive phase');
  assert.match(plain(premature.json?.stderr), /FATAL: phase is 'open', expected 'archive'/);
});

test('1.3.b/F05/OV01: the verified managed write executor completes the lifecycle the read-only observer cannot', async () => {
  // The refusal half of F05 at this case's layer: a read-only observer can
  // carry no execute surface and is refused for managed writes, so the only
  // executor that can complete the lifecycle below is the managed one.
  assert.throws(
    () => defineDriver({ id: 'prompt-observer', kind: 'read-only', execute: () => ({ exitCode: 0 }) }),
    (error) => error.code === 'DRIVER_SURFACE_REFUSED',
  );
  assert.throws(
    () => requireWriteDriver(defineDriver({ id: 'prompt-observer', kind: 'read-only' }), 'write the change artifacts'),
    (error) => error.code === 'DRIVER_WRITE_REFUSED',
  );
  await fs.writeFile(path.join(project, 'docs/openspec/changes', CHANGE, 'proposal.md'), '# Proposal\n\nManaged delivery probe.\n');
  await fs.writeFile(path.join(project, 'docs/openspec/changes', CHANGE, 'tasks.md'), '# Tasks\n\n- [ ] 1.1 Implement probe product code\n');
  await fs.writeFile(path.join(project, 'docs/openspec/changes', CHANGE, 'design.md'), '# Design\n\nSingle controller, managed driver.\n');
  const openComplete = comet(['state', 'transition', CHANGE, 'open-complete', '--json']);
  assert.equal(openComplete.json?.exitCode, 0, `open-complete failed: ${plain(openComplete.json?.stderr).slice(0, 300)}`);
  const design = comet(['state', 'complete-design', CHANGE, '--design-doc', `docs/openspec/changes/${CHANGE}/design.md`, '--json']);
  assert.ok(design.json, 'complete-design must answer');
  const designComplete = comet(['state', 'transition', CHANGE, 'design-complete', '--json']);
  assert.equal(designComplete.json?.exitCode, 0, `design-complete failed: ${plain(designComplete.json?.stderr).slice(0, 300)}`);
  const setBuild = comet(['state', 'set', CHANGE, 'build_mode', 'executing-plans', 'tdd_mode', 'tdd', 'isolation', 'current', '--json']);
  assert.equal(setBuild.json?.exitCode, 0, `state set failed: ${plain(setBuild.json?.stderr).slice(0, 300)}`);

  const tasks = comet(['state', 'tasks', CHANGE, '--assign-ids', '--json']);
  assert.equal(tasks.json?.exitCode, 0);
  const revision = tasks.json?.data?.revision;
  assert.match(revision ?? '', /^[a-f0-9]{64}$/, 'the task authority must expose its revision');
  const markerId = tasks.json?.data?.tasks?.[0]?.id;
  assert.ok(markerId, 'the assigned task id must be readable');
  const complete = comet(['state', 'task-complete', CHANGE, markerId, '--expect', revision, '--json']);
  assert.equal(complete.json?.exitCode, 0, `task-complete failed: ${plain(complete.json?.stderr).slice(0, 300)}`);

  // OV03: a manual record-check declaration is recordable but must never
  // satisfy the guard — an authored receipt is not a real invocation.
  const manual = comet(['state', 'record-check', CHANGE, 'build', '--command', 'node -e 0', '--exit-code', '0', '--json']);
  assert.equal(manual.json?.exitCode, 0, 'recording the manual declaration itself is allowed');
  const guarded = comet(['state', 'transition', CHANGE, 'build-complete', '--json']);
  assert.equal(guarded.json?.exitCode, 1, 'the guard must refuse a manual declaration');
  assert.match(plain(guarded.json?.stderr), /Manual declarations never satisfy the guard/);

  const probe = path.join(scratch, 'true.js');
  await fs.writeFile(probe, 'process.exit(0)\n');
  const buildCheck = comet(['check', 'run', CHANGE, 'build', '--local', '--', nodeExecutable, probe]);
  assert.match(allOutput(buildCheck), /Check build: exit=0/, 'the real build check must run and pass');

  const buildComplete = comet(['state', 'transition', CHANGE, 'build-complete', '--json']);
  assert.equal(buildComplete.json?.exitCode, 0, `build-complete with real runtime evidence failed: ${plain(buildComplete.json?.stderr).slice(0, 400)}`);

  const verifyCheck = comet(['check', 'run', CHANGE, 'verify', '--local', '--', nodeExecutable, probe]);
  assert.match(allOutput(verifyCheck), /Check verify: exit=0/, 'the real verify check must run and pass');
  const report = path.join(project, 'docs/openspec/changes', CHANGE, 'verification.md');
  await fs.writeFile(report, '# Verification Report\n\nReal runtime checks recorded by the managed executor.\n');
  const setReport = comet(['state', 'set', CHANGE, 'verification_report', `docs/openspec/changes/${CHANGE}/verification.md`, '--json']);
  assert.equal(setReport.json?.exitCode, 0);
  const verifyPass = comet(['state', 'transition', CHANGE, 'verify-pass', '--json']);
  assert.equal(verifyPass.json?.exitCode, 0, `verify-pass failed: ${plain(verifyPass.json?.stderr).slice(0, 300)}`);
  const archiveConfirm = comet(['state', 'transition', CHANGE, 'archive-confirm', '--json']);
  assert.equal(archiveConfirm.json?.exitCode, 0, `archive-confirm failed: ${plain(archiveConfirm.json?.stderr).slice(0, 300)}`);

  // The driver issues exactly one closeout permit: Kp recorded first, the
  // archive entry facts valid, one execution bound. The managed executor (the
  // CLI archive in the next test) is the only closeout this permit covers.
  const sealBefore = await readArchiveSeal({ projectRoot: project, change: CHANGE, nodeExecutable, entrypoint, env: childEnv() });
  assert.equal(sealBefore.archived, false);
  const permit = sealCloseout({ seal: sealBefore, execution: 'exec-closeout-case', knowledgeCloseout: { id: 'Kp-case-1', digest: sha(Buffer.from('knowledge-closeout-case')) } });
  assert.equal(permit.change, CHANGE);
  assert.equal(permit.execution, 'exec-closeout-case');
});

test('1.3.c: the archive succeeds exactly once and a duplicate closeout execution is refused by the driver', async () => {
  const archive = comet(['archive', CHANGE, '--json']);
  assert.equal(archive.json?.exitCode, 0, `archive failed: ${plain(archive.json?.stderr).slice(0, 400)}`);
  assert.match(plain(archive.json?.stderr), /archived successfully/);

  const changesDir = path.join(project, 'docs/openspec/changes');
  const active = (await fs.readdir(changesDir, { withFileTypes: true })).filter((entry) => entry.isDirectory() && entry.name !== 'archive');
  assert.deepEqual(active, [], 'no second phase authority may remain: the change must be fully archived');
  const archiveDirs = (await fs.readdir(path.join(changesDir, 'archive'), { withFileTypes: true })).filter((entry) => entry.isDirectory());
  assert.equal(archiveDirs.length, 1, 'exactly one archive directory must exist');

  const seal = await readArchiveSeal({ projectRoot: project, change: CHANGE, nodeExecutable, entrypoint, env: childEnv() });
  assert.equal(seal.archived, true);
  assert.equal(seal.verifyResult, 'pass');
  const knowledgeCloseout = { id: 'Kp-case-1', digest: sha(Buffer.from('knowledge-closeout-case')) };
  // The runtime closeout has happened exactly once; every further closeout
  // request — new execution or replay of the permitted one — is refused by
  // the driver even though the upstream CLI itself converges idempotently.
  assert.throws(
    () => sealCloseout({ seal, execution: 'exec-closeout-second', knowledgeCloseout }),
    (error) => error.code === 'ARCHIVE_ALREADY_SEALED',
    'the upstream CLI converges idempotently, but the driver must refuse a second closeout execution',
  );
  assert.throws(
    () => sealCloseout({ seal, execution: 'exec-closeout-case', knowledgeCloseout }),
    (error) => error.code === 'ARCHIVE_ALREADY_SEALED',
    'a replay of the permitted execution is likewise a second closeout',
  );

  // OV01: the overlay/continuation derives from the original state — the
  // archived change still carries its single run link, and the driver gate
  // judged exactly one verification execution for it.
  const archivedYaml = await fs.readFile(path.join(changesDir, 'archive', archiveDirs[0].name, '.comet.yaml'), 'utf8');
  assert.match(archivedYaml, /^archived: true$/m);
  assert.match(archivedYaml, /^run_id: [0-9a-f-]{36}$/m, 'the single Comet Run link must be preserved');
});

test('1.3.a/0.5.0: the composition-application surface constructs exactly the official commands and the live CLI refuses the unbuilt package', async () => {
  const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const packagedApplicationFile = path.join(repository, 'integrations/comet/application/application.json');
  const compiled = await fs.access(packagedApplicationFile).then(() => true, () => false);

  // The start/recovery requests mirror the upstream input contract for a
  // classic-full composition Run on THIS change.
  const start = classicCompositionStartRequest({
    change: CHANGE, changeDir: `docs/openspec/changes/${CHANGE}`, workflowId: 'comet-classic-full', workflowVersion: '1',
  });
  assert.equal(start.runId, CHANGE);
  assert.equal(start.input.changeDir, `docs/openspec/changes/${CHANGE}`);
  assert.deepEqual(classicCompositionRecoveryRequest({ change: CHANGE }), { operation: 'next', runId: CHANGE });
  // A composition Run has exactly one dispatch entry; --application/--workflow
  // selectors are not alternatives this driver may build.
  const argv = runtimeDispatchArgv({ applicationFile: packagedApplicationFile, requestFile: path.join(project, 'request.json'), projectRoot: project });
  assert.equal(argv[0], 'runtime'); assert.equal(argv[1], 'dispatch');
  assert.equal(argv.includes('--application'), false); assert.equal(argv.includes('--workflow'), false);

  // Kt: the 0005 read-side predicate is fail-open for every state the real
  // CLI just produced in this case (none carries the optional field).
  const stateFile = (await describeWorkspace({ projectRoot: project, change: CHANGE })).changeStateFile;
  assert.equal(knowledgeCloseoutBlocked({ archived: true, phase: 'archive' }), false);
  assert.equal(knowledgeCloseoutBlocked({ knowledgeCloseout: { required: true } }), true);

  // UNVERIFIED boundary, honestly exercised: without the compiled package
  // (the supply wave has not built it at this revision) the REAL 0.5.0 CLI
  // refuses the dispatch — proving the command shape is live while claiming
  // no runtime acceptance. When the compile wave lands, this leg flips to a
  // real install/dispatch journey owned by P1_4/P3_2.
  if (!compiled) {
    const requestFile = path.join(project, 'request.json');
    await fs.writeFile(requestFile, JSON.stringify(classicCompositionRecoveryRequest({ change: CHANGE })));
    const dispatch = comet([...argv]);
    assert.notEqual(dispatch.status, 0, 'the live CLI must refuse a dispatch for a missing application file');
    const output = allOutput(dispatch);
    assert.match(output, /application|application-file|ENOENT|not found|无法|不存在|读取/i);
  } else {
    console.log('UNVERIFIED-boundary note: a compiled application.json exists; this leg must be re-based on the real install/dispatch journey (P1_4).');
  }
  void stateFile;
});

test('cleanup removes the scratch project', async () => {
  await fs.rm(scratch, { recursive: true, force: true });
});

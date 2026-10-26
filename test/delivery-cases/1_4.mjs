// P1_4 delivery case, revision 2026-10-26-comet-050-adoption-v1 (ADR-0022):
// mode qualification of the pinned, REBUILT Comet 0.5.0 distribution
// (upstream.lock.json carries exactly one patch — the P2_4-delivered 0005 Kt
// closeout — re-locked by the P1_4 supply wave under the controller-granted
// exception). The case pins three things:
//
//   1.4.a the structured mode registration (mode-qualification.json v2) is
//         bound to THIS build fingerprint, preserves the 0.4.5 record as
//         history, and carries the 0.5.0 capability matrix with the
//         mandatory blocking items B1–B8;
//   1.4.b the official-compiler qualification: the P2_4-declared composition
//         is REFUSED as declared (import escape), refused again after the
//         hostContract rebasing (missing executor layer), and a clearly
//         labeled DIAGNOSTIC variant compiles — the repair list R1–R6 is the
//         deliverable and NO application.json may exist yet;
//   1.4.c the managed-init and escape-hatch qualification: classic init
//         attempts the 13-skill obra/superpowers install and the floating
//         openspec global upgrade (no exclusion switch exists; pre-seeding
//         does not suppress it; a compatible pinned openspec on PATH does
//         suppress the upgrade), and COMET_SKIP_BUILD/COMET_FORCE_PHASE keep
//         voiding/bypassing the gates on the 0005 tree — every one of these
//         facts is asserted against the probe records AND re-witnessed live
//         in a scratch project.
//
// C07: entrance gating carries over to the 0.5.0 compat face (pinned by
// 1_3.mjs); F06: workflow success never stands in for required checks; M01:
// the managed method supply is the packaged application skills, never init.
// Every Comet interaction runs in scratch projects under $TMPDIR with an
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
const lock = JSON.parse(await fs.readFile(path.join(projectRoot, 'integrations/comet/upstream.lock.json'), 'utf8'));

const fingerprint = crypto.createHash('sha256').update(JSON.stringify({
  archive: lock.source.sha256,
  patches: lock.patches.map(({ path: p, sha256 }) => ({ path: p, sha256 })),
  toolchain: lock.toolchain,
})).digest('hex');
const buildDir = path.join(projectRoot, '.sdd/vendor/comet', lock.source.commit, 'builds', fingerprint);
const work = path.join(buildDir, 'work');
const entrypoint = path.join(work, 'bin/comet.js');

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

async function loadJson(relative) {
  try {
    return JSON.parse(await fs.readFile(path.join(changeRoot, relative), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      const failure = new Error(`${relative} is missing: the 0.5.0 mode qualification carries no record for it (task P1_4 RED)`);
      failure.code = 'MODE_QUALIFICATION_EVIDENCE_MISSING';
      throw failure;
    }
    throw error;
  }
}

// --- scratch world (isolated HOME + PATH stubs; all probes are real CLI runs)
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'p14-case-'));
const fakeHome = path.join(scratch, 'home');
const stubs = path.join(scratch, 'stubs');
const classicProject = path.join(scratch, 'classic');
await fs.mkdir(fakeHome, { recursive: true });
await fs.mkdir(classicProject, { recursive: true });
await fs.mkdir(stubs, { recursive: true });
const stubLog = path.join(scratch, 'stub-calls.log');
const logger = '#!/bin/sh\necho "[stub] $0 $@" >> "${STUB_LOG:-/dev/null}"\nexit 0\n';
await fs.writeFile(path.join(stubs, 'npm'), logger, { mode: 0o755 });
await fs.writeFile(path.join(stubs, 'npx'), logger, { mode: 0o755 });
// openspec stub: incompatible host by default (no --version answer); init
// creates the root; archive moves the change into the dated archive dir.
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
if [ "$pos1" = "archive" ] && [ -n "$pos2" ] && [ -n "$COMET_PROJECT_ROOT" ]; then
  cd "$COMET_PROJECT_ROOT" || exit 0
  if [ -d "docs/openspec/changes/$pos2" ]; then
    mkdir -p "docs/openspec/changes/archive"
    mv "docs/openspec/changes/$pos2" "docs/openspec/changes/archive/$(date +%Y-%m-%d)-$pos2"
  fi
fi
exit 0
`, { mode: 0o755 });

const childEnv = (extra = {}, cwd = classicProject) => {
  const { NODE_TEST_CONTEXT: _stripped, ...inherited } = process.env;
  return {
    ...inherited,
    HOME: fakeHome,
    STUB_LOG: stubLog,
    COMET_PROJECT_ROOT: cwd,
    PATH: `${stubs}:${process.env.PATH ?? ''}`,
    ...extra,
  };
};
const comet = (args, { env = {}, timeout = 420_000, cwd = classicProject } = {}) => {
  const result = spawnSync(nodeExecutable, [entrypoint, ...args], { cwd, encoding: 'utf8', timeout, env: childEnv(env, cwd) });
  let json = null;
  try { json = JSON.parse(result.stdout ?? ''); } catch { /* raw output stays raw */ }
  return { ...result, json };
};
const stubCalls = async () => (await fs.readFile(stubLog, 'utf8').catch(() => '')).split('\n').filter(Boolean);

test('setup: the rebuilt 0.5.0+0005 distribution named by the source lock is manifest-verified and carries the Kt patch', async () => {
  assert.equal(lock.package.version, '0.5.0');
  assert.equal(lock.source.commit, 'aeb1a6598034e28ce46b8422d4dbd8785e607bd7');
  assert.deepEqual(lock.patches, [
    { path: 'integrations/comet/patches/0005-comet-050-kt-closeout.patch', sha256: '74e6c8108967ac10b9ac31e2f4c3ba2dfa6d53930dcf2b5068fe7d9be003b18d' },
  ], 'the supply re-lock must carry exactly the P2_4-delivered 0005 bytes (sha-pinned)');
  assert.equal(crypto.createHash('sha256').update(await fs.readFile(path.join(projectRoot, lock.patches[0].path))).digest('hex'), lock.patches[0].sha256,
    'the patch file on disk must match the locked sha256');
  for (const stale of ['29f2332b4f624c1595d6d1304456f5de4e6b9b7642633995b79c0cab60ea1aad', 'cb1151b4f3a301c9f2e9da87695155bf05285c925ea4abbbcea7120c9413f187', 'd437093083ad4500253795fe231484c606e925b2404f958e5a7dd4fd4c11cba6']) {
    assert.notEqual(fingerprint, stale, 'no pre-relock or 0.4.5 build may satisfy this case');
  }
  assert.ok(prepared, 'pristine Comet source has not been prepared; run tools/comet/prepare-source.mjs first');
  assert.ok(built, 'patched Comet build is not present; run tools/comet/build.mjs --archive first');
  const version = comet(['--version']);
  assert.equal(version.status, 0);
  assert.equal((version.stdout ?? '').trim(), lock.package.version);
  // 0005 really is in the rebuilt tree (source and compiled dist).
  const resolverSource = await fs.readFile(path.join(work, 'domains/comet-classic/classic-resolver.ts'), 'utf8');
  const resolverDist = await fs.readFile(path.join(work, 'dist/domains/comet-classic/classic-resolver.js'), 'utf8');
  assert.match(resolverSource, /knowledgeCloseoutBlocked/, 'the rebuilt source tree must carry the 0005 predicate');
  assert.match(resolverDist, /knowledgeCloseoutBlocked/, 'the rebuilt dist must carry the 0005 predicate');
  assert.match(resolverSource, /\$\{profile\}\.archive\.execute/, 'the Kt parking step must appear in the patched resolver');
});

test('1.4.a: the v2 mode registration exists, binds this exact build, preserves the 0.4.5 history and pins B1–B8', async () => {
  const qualification = await loadJson('mode-qualification.json');
  assert.equal(qualification.schemaVersion, 2);
  assert.equal(qualification.revision, '2026-10-26-comet-050-adoption-v1');
  assert.equal(qualification.build.version, '0.5.0');
  assert.equal(qualification.build.fingerprint, fingerprint, 'the registration must be bound to the rebuilt supply fingerprint');
  assert.deepEqual(qualification.build.patches, lock.patches);
  assert.ok(Array.isArray(qualification.capabilityMatrix) && qualification.capabilityMatrix.length >= 9,
    'the matrix must carry the 0.5.0 rows (mode authority, compiler route, gates, evidence, bypass, openspec, methods, knowledge, closeout)');
  for (const row of qualification.capabilityMatrix) {
    assert.ok(row.id && row.obligation && row.verdict, `matrix row needs id/obligation/verdict: ${JSON.stringify(row).slice(0, 120)}`);
    assert.ok(row.classic?.observed && row.classic?.evidence, `matrix row ${row.id} must record the live classic observation with evidence`);
  }
  const route = qualification.capabilityMatrix.find((row) => row.id === 'managed-delivery-route');
  assert.ok(route, 'the compiler route must be a matrix row');
  assert.match(route.classic.verdict, /refused-as-declared/);
  assert.equal(qualification.classicAdmission.admitted, true);
  assert.equal(qualification.classicAdmission.autoSwitch.allowed, false);
  assert.deepEqual(qualification.classicAdmission.mandatoryBlocks, ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8']);
  for (const id of qualification.classicAdmission.mandatoryBlocks) {
    const item = qualification.blockingItems.find((entry) => entry.id === id);
    assert.ok(item, `mandatory block ${id} must be a registered blocking item`);
    assert.ok(item.gap && item.evidence, `blocking item ${id} must carry a gap and evidence`);
    if (['B1', 'B4', 'B5', 'B6', 'B7', 'B8'].includes(id)) assert.ok(item.extensionAcceptance, `blocking item ${id} must carry an extension acceptance instead of a verdict change`);
  }
  // The 0.4.5 record is preserved wholesale, never overwritten.
  const history = qualification.history045;
  assert.ok(history, 'the 0.4.5 record must be preserved under history045');
  assert.equal(history.build.sourceCommit, 'c90af44a4474662d7853aae76ce785404974fb0a');
  assert.equal(history.build.fingerprint, 'd437093083ad4500253795fe231484c606e925b2404f958e5a7dd4fd4c11cba6');
  assert.deepEqual(history.classicAdmission.mandatoryBlocks, ['B1', 'B2', 'B3', 'B4', 'B5', 'B6']);
  for (const relative of qualification.probes) {
    if (relative.endsWith('.json')) await loadJson(relative);
    else assert.ok(await fs.access(path.join(changeRoot, relative)).then(() => true, () => false), `declared probe ${relative} must exist`);
  }
});

test('1.4.b: the official compiler refuses the declared composition; the diagnostic compiles; the repair list is the deliverable — no application.json exists', async () => {
  const probe = await loadJson('mode-probes/1_4-compiler-compile.json');
  assert.equal(probe.build.fingerprint, fingerprint, 'the compile probe must have run against this exact build');
  const byId = Object.fromEntries(probe.attempts.map((attempt) => [attempt.id, attempt]));
  assert.equal(byId.a.outcome, 'REFUSED_AT_PREPARE');
  assert.match(byId.a.stages.prepare.error, /应用模块依赖缺失或越过包目录.*bindings\.mjs/,
    'the as-declared refusal must be the bindings import escape');
  assert.equal(byId.b.outcome, 'REFUSED_AT_PREPARE');
  assert.match(byId.b.stages.prepare.error, /缺少可路由且具备所需能力的执行端口/,
    'after the import rebasing the next refusal must be the missing executor layer');
  assert.equal(byId.c.outcome, 'COMPILED', 'the diagnostic variant must prove the repair list exhaustive');
  assert.ok(byId.c.deviations?.length >= 9, 'the diagnostic must declare its deviations from the P2_4 composition');
  const repairList = (await loadJson('mode-qualification.json')).compilerQualification.repairList;
  assert.equal(repairList.length, 6, 'the registration must pin the six-part repair list R1–R6');
  for (const marker of ['R1', 'R2', 'R3', 'R4', 'R5', 'R6']) {
    assert.ok(repairList.some((entry) => entry.startsWith(marker)), `repair list must carry ${marker}`);
  }
  // The supply gaps the probe surfaced are part of the pinned record.
  assert.ok(probe.supplyGaps.some((gap) => gap.skill === 'ponytail' && /引用资源缺失/.test(gap.error)),
    'the non-embeddable ponytail packaging must be a recorded supply gap');
  assert.ok(probe.schemaConflicts.some((conflict) => conflict.skill === 'grill-me' && conflict.outputSchemasEqual === false),
    'the grill-me one-id-many-schemas conflict must be recorded');
  assert.ok(probe.schemaConflicts.some((conflict) => conflict.skill === 'comet-archive'),
    'the domain comet-archive shared-ref conflict must be recorded');
  // And the honest deliverable state: NO compiled package exists.
  assert.equal(await fs.access(path.join(projectRoot, 'integrations/comet/application/application.json')).then(() => true, () => false), false,
    'no application.json may exist while the as-declared compile fails (B7 open)');
});

test('1.4.c: the managed-init/escape probe record pins superpowers supply, openspec hygiene and the escape hatches', async () => {
  const probe = await loadJson('mode-probes/1_4-managed-init-escape.json');
  assert.equal(probe.build.fingerprint, fingerprint, 'the init probe must have run against this exact build');

  const clean = probe.probes.classicInitCleanHost;
  assert.equal(clean.exitCode, 0);
  assert.ok(clean.superpowersInstallAttempts.length >= 1, 'classic init must be recorded attempting the superpowers install');
  assert.match(clean.superpowersInstallAttempts.join('\n'), /skills add obra\/superpowers/);
  assert.ok(clean.openspecGlobalUpgradeAttempts.some((call) => /install -g @fission-ai\/openspec@latest/.test(call)),
    'the floating openspec global upgrade attempt must be recorded (B6)');
  assert.equal(clean.projectConfigWorkflowBinding, 'default_workflow: classic');

  const compat = probe.probes.classicInitCompatibleOpenspec;
  assert.equal(compat.exitCode, 0);
  assert.equal(compat.openspecGlobalUpgradeAttempts.length, 0,
    'a compatible pinned openspec on PATH must suppress the global upgrade (proven B6 mitigation)');
  assert.ok(compat.superpowersInstallAttempts.length >= 1, 'the superpowers attempt must NOT be suppressed by openspec compatibility');

  const native = probe.probes.nativeInitControl;
  assert.equal(native.exitCode, 0);
  assert.equal(native.superpowersInstallAttempts.length, 0, 'native workflow selection must not reach the classic superpowers path');

  const preseeded = probe.probes.classicInitPreseededSuperpowers;
  assert.equal(preseeded.exitCode, 0);
  assert.ok(preseeded.superpowersInstallAttempts.length >= 1,
    'pre-seeding .claude/skills/superpowers must NOT suppress the install (no exclusion switch exists)');

  const escape = probe.probes.escapeHatches;
  assert.equal(escape.skipBuildChain.archiveExit, 0, 'COMET_SKIP_BUILD=1 must be recorded archiving with zero checks');
  assert.deepEqual(escape.skipBuildChain.checkLogsInArchive, [], 'the archived change must carry zero check logs');
  assert.equal(escape.skipBuildChain.verifyResult, 'pass', 'verify_result must be stamped pass without evidence');
  assert.equal(escape.forcePhase.refusedWriteExit, 1);
  assert.equal(escape.forcePhase.refusedWriteNamesEscape, true, 'the default refusal must name COMET_FORCE_PHASE');
  assert.equal(escape.forcePhase.forcedWriteExit, 0, 'COMET_FORCE_PHASE=1 must be recorded allowing the direct phase write');
  assert.equal(escape.forcePhase.forcedPhaseReadback, 'archive');
  assert.equal(escape.forcePhase.forgedArchiveExit, 1, 'the downstream archive entry checks must still refuse the forged state');
  assert.match(escape.forcePhase.forgedArchiveStderrTail, /verify_result is 'pending', expected 'pass'/);
  assert.ok(escape.ktPredicateCompatFaceAttempt, 'the live 0005 compat-face attempt must be recorded');
  assert.match(JSON.stringify(escape.ktPredicateCompatFaceAttempt.nextAction ?? {}), /delivery|completed/,
    'the compat face must be recorded ignoring the hand-written knowledgeCloseout field (write path still open)');
});

test('1.4.c live: classic init on an isolated probe HOME really attempts superpowers + the openspec upgrade and binds classic', async () => {
  await fs.writeFile(stubLog, '');
  const init = comet(['init', classicProject, '--yes', '--scope', 'project', '--workflow', 'classic', '--platform', 'claude', '--codegraph', 'skip', '--language', 'en'], { timeout: 420_000 });
  assert.equal(init.status, 0, `comet init (classic) failed: ${plain(init.stderr).slice(0, 400)}`);
  const calls = await stubCalls();
  assert.ok(calls.some((call) => /skills add obra\/superpowers/.test(call)),
    'the live init must attempt the superpowers install (stub log is the witness)');
  assert.ok(calls.some((call) => /install -g @fission-ai\/openspec@latest/.test(call)),
    'the live init must attempt the floating openspec global upgrade (stub log is the witness)');
  const config = await fs.readFile(path.join(classicProject, '.comet/config.yaml'), 'utf8');
  assert.match(config, /^default_workflow: classic$/m);
  const resolve = comet(['workflow', 'resolve', '--json']);
  assert.equal(resolve.status, 0);
  assert.equal(resolve.json?.workflow, 'classic');
  assert.equal(resolve.json?.schema, 'comet.workflow-resolution.v1');
  // M01: no superpowers runtime may enter the host skill surface — the stub
  // neutralized the install, and the only superpowers-named path is the
  // upstream classic artifact root docs/superpowers.
  const skillsDir = path.join(classicProject, '.claude/skills');
  const entries = await fs.readdir(skillsDir).catch(() => []);
  assert.ok(!entries.some((name) => /superpowers/i.test(name)),
    `no superpowers runtime may appear in the host skills dir (found: ${entries.join(',')})`);
  // The probe HOME is disposable state, never the real host HOME.
  assert.ok(await fs.access(fakeHome).then(() => true, () => false));
  assert.notEqual(fakeHome, process.env.HOME);
});

test('1.4.c live: escape hatches on the rebuilt tree — FORCE_PHASE refuses by default and SKIP_BUILD voids the chain', async () => {
  const FORGED = 'force-change';
  assert.equal(comet(['state', 'init', FORGED, 'full', '--json']).json?.exitCode, 0);
  const refusedWrite = comet(['state', 'set', FORGED, 'phase', 'archive', '--json']);
  assert.equal(refusedWrite.json?.exitCode, 1, 'a direct phase write must refuse by default');
  assert.match(JSON.stringify(refusedWrite.json?.data ?? refusedWrite.json), /COMET_FORCE_PHASE/);
  const forcedWrite = comet(['state', 'set', FORGED, 'phase', 'archive', '--json'], { env: { COMET_FORCE_PHASE: '1' } });
  assert.equal(forcedWrite.json?.exitCode, 0, 'COMET_FORCE_PHASE=1 must be observed allowing the direct write');
  assert.equal(comet(['state', 'get', FORGED, 'phase']).stdout?.trim(), 'archive');
  const forgedArchive = comet(['archive', FORGED, '--json'], { timeout: 420_000 });
  assert.equal(forgedArchive.json?.exitCode, 1, 'the archive entry checks must refuse the forged state');
  assert.match(plain(forgedArchive.json?.stderr), /verify_result is 'pending', expected 'pass'/);

  const ESCAPE = 'skip-change';
  assert.equal(comet(['state', 'init', ESCAPE, 'full', '--json']).json?.exitCode, 0);
  assert.equal(comet(['state', 'select', ESCAPE, '--json']).json?.exitCode, 0);
  await fs.mkdir(path.join(classicProject, 'docs/openspec/changes', ESCAPE), { recursive: true });
  await fs.writeFile(path.join(classicProject, 'docs/openspec/changes', ESCAPE, 'proposal.md'), '# P\n');
  await fs.writeFile(path.join(classicProject, 'docs/openspec/changes', ESCAPE, 'tasks.md'), '# T\n\n- [ ] 1.1 x');
  await fs.writeFile(path.join(classicProject, 'docs/openspec/changes', ESCAPE, 'design.md'), '# D\n');
  assert.equal(comet(['state', 'transition', ESCAPE, 'open-complete', '--json']).json?.exitCode, 0);
  comet(['state', 'complete-design', ESCAPE, '--design-doc', `docs/openspec/changes/${ESCAPE}/design.md`, '--json']);
  assert.equal(comet(['state', 'transition', ESCAPE, 'design-complete', '--json']).json?.exitCode, 0);
  assert.equal(comet(['state', 'set', ESCAPE, 'build_mode', 'executing-plans', 'tdd_mode', 'tdd', 'isolation', 'current', '--json']).json?.exitCode, 0);
  const tasks = comet(['state', 'tasks', ESCAPE, '--assign-ids', '--json']);
  assert.equal(comet(['state', 'task-complete', ESCAPE, tasks.json.data.tasks[0].id, '--expect', tasks.json.data.revision, '--json']).json?.exitCode, 0);
  const skip = { COMET_SKIP_BUILD: '1' };
  assert.equal(comet(['state', 'transition', ESCAPE, 'build-complete', '--json'], { env: skip }).json?.exitCode, 0, 'SKIP_BUILD must void the build gate live');
  await fs.writeFile(path.join(classicProject, 'docs/openspec/changes', ESCAPE, 'verification.md'), '# V\n');
  assert.equal(comet(['state', 'set', ESCAPE, 'verification_report', `docs/openspec/changes/${ESCAPE}/verification.md`, '--json']).json?.exitCode, 0);
  assert.equal(comet(['state', 'transition', ESCAPE, 'verify-pass', '--json'], { env: skip }).json?.exitCode, 0, 'SKIP_BUILD must void the verify gate live');
  assert.equal(comet(['state', 'transition', ESCAPE, 'archive-confirm', '--json'], { env: skip }).json?.exitCode, 0);
  assert.equal(comet(['state', 'get', ESCAPE, 'verify_result'], { env: skip }).stdout?.trim(), 'pass');
  const archive = comet(['archive', ESCAPE, '--json'], { env: skip, timeout: 420_000 });
  assert.equal(archive.json?.exitCode, 0, 'the full lifecycle must archive under the escape with zero real checks');
  const archivedDirName = (await fs.readdir(path.join(classicProject, 'docs/openspec/changes/archive'))).find((name) => name.endsWith(ESCAPE));
  const checksDir = path.join(classicProject, 'docs/openspec/changes/archive', archivedDirName, '.comet/checks');
  const checkLogs = await fs.readdir(checksDir).then((names) => names.filter((name) => name.endsWith('.log')), () => []);
  assert.equal(checkLogs.length, 0, 'the archived change must carry zero real check logs (B4 registered, not smoothed)');
});

test('cleanup removes the scratch world', async () => {
  await fs.rm(scratch, { recursive: true, force: true });
});

// P1_4 delivery case: mode qualification of the fixed Comet distribution
// (patched build, fingerprint cb1151b4…, manifest-verified on reuse) —
// 1.4.a pins the Classic/Native capability matrix and the Classic admission
// decision over the real built CLI (no automatic mode switch exists), 1.4.b
// reproduces the four release loopholes for real against the patched build —
// irrelevant successful commands, missing required checks, stale or hand
// written receipts, and skip/ops escape paths reachable by ordinary
// execution — and requires every one of them to be registered as a mandatory
// Classic-admission block (native refusals are covered; native gaps get
// extension acceptance, never a verdict change), and 1.4.c pins the knowledge
// boundary: Comet's built-in project memory is a HOME-scoped cache that never
// overrides or replaces LLMWiki/Outline/DeepWiki as the sole knowledge
// sources. C07: every managed entrance (transition, guard preview,
// guard --apply, next/continuation, archive request, phase-guard write hook)
// enforces the same precondition rule; F06: workflow success never stands in
// for the required checks; M01: the Classic binding is the pre-fixed method,
// Superpowers is not loaded (M01 evidence: no superpowers runtime in the
// managed path; docs/superpowers is an upstream artifact root only).
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

// Structured mode registration is the deliverable under test. Loading it is
// the RED boundary: without mode-qualification.json the Classic/Native
// differences have no structured registration at all, and without the
// mode-probes records the registration carries no per-probe evidence.
async function loadQualification() {
  const file = path.join(changeRoot, 'mode-qualification.json');
  let raw;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      const failure = new Error('mode-qualification.json is missing: the Classic/Native capability differences, the Classic admission decision, the four loophole classes and the knowledge boundary have no structured registration (task P1_4 RED)');
      failure.code = 'MODE_QUALIFICATION_MISSING';
      throw failure;
    }
    throw error;
  }
  return JSON.parse(raw);
}

async function loadProbeRecords(name) {
  const file = path.join(changeRoot, 'mode-probes', name);
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      const failure = new Error(`mode-probes/${name} is missing: a registered probe carries no command/output/exit-code evidence`);
      failure.code = 'MODE_PROBE_EVIDENCE_MISSING';
      throw failure;
    }
    throw error;
  }
}

// --- scratch world (created once; all probes are real CLI interactions)
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'p14-case-'));
const fakeHome = path.join(scratch, 'home');
const stubs = path.join(scratch, 'stubs');
const classicProject = path.join(scratch, 'classic');
const nativeProject = path.join(scratch, 'native');
const stubLog = path.join(scratch, 'stub-calls.log');
await fs.mkdir(fakeHome, { recursive: true });
await fs.mkdir(classicProject, { recursive: true });
await fs.mkdir(nativeProject, { recursive: true });
await fs.mkdir(stubs, { recursive: true });
const logger = '#!/bin/sh\necho "[stub] $0 $@" >> "${STUB_LOG:-/dev/null}"\nexit 0\n';
await fs.writeFile(path.join(stubs, 'npm'), logger, { mode: 0o755 });
await fs.writeFile(path.join(stubs, 'npx'), logger, { mode: 0o755 });
// A faithful-enough openspec stub: `init <dir>` creates the openspec root;
// `archive <change>` moves the change into the dated archive directory Comet
// expects (<today>-<change>) exactly like the upstream CLI.
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

const childEnv = (extra = {}) => ({
  ...process.env,
  HOME: fakeHome,
  STUB_LOG: stubLog,
  COMET_PROJECT_ROOT: classicProject,
  PATH: `${stubs}:${process.env.PATH ?? ''}`,
  ...extra,
});

function comet(args, { env = {}, timeout = 180_000, cwd = classicProject } = {}) {
  const result = spawnSync(nodeExecutable, [entrypoint, ...args], {
    cwd,
    encoding: 'utf8',
    timeout,
    env: childEnv(env),
  });
  let json = null;
  try { json = JSON.parse(result.stdout ?? ''); } catch { /* non-JSON output stays raw */ }
  return { ...result, json };
}

const gateVerdict = (result) => {
  const issues = (result.json?.data?.issues ?? []).map((issue) => issue.message ?? '').join('\n');
  const failLines = plain(issues).split('\n').filter((line) => /\[FAIL\]/.test(line));
  return { exitCode: result.json?.exitCode, failLines, issues: plain(issues) };
};

const CHANGE = 'qualify-change';

test('setup: the patched pinned build named by the source lock is manifest-verified in this project', () => {
  assert.equal(lock.patches.length, 2, 'the patched build must carry the two locked patches');
  assert.match(fingerprint, /^cb1151b4/, `patched fingerprint drifted: ${fingerprint}`);
  assert.ok(prepared, 'pristine Comet source has not been prepared; run tools/comet/prepare-source.mjs first');
  assert.ok(built, 'patched Comet build is not present; run tools/comet/build.mjs --archive first');
  const version = comet(['--version']);
  assert.equal(version.status, 0);
  assert.equal((version.stdout ?? '').trim(), lock.package.version);
});

test('1.4.a: the structured mode registration exists and pins this exact patched build', async () => {
  const qualification = await loadQualification();
  assert.equal(qualification.schemaVersion, 1);
  assert.equal(qualification.build.fingerprint, fingerprint, 'the qualification must be bound to the patched build fingerprint');
  assert.equal(qualification.build.sourceCommit, lock.source.commit);
  assert.ok(Array.isArray(qualification.capabilityMatrix) && qualification.capabilityMatrix.length >= 9,
    'the matrix must pin the Classic/Native obligations from comet-single-controller-review.md (7 rows) plus closeout exclusivity and runner binding');
  assert.equal(qualification.classicAdmission.admitted, true, 'the fixed distribution admits Classic as the managed mode');
  assert.equal(qualification.classicAdmission.autoSwitch.allowed, false, 'no automatic Classic/Native switch path may exist');
  for (const record of qualification.capabilityMatrix) {
    assert.ok(record.id && record.obligation, `matrix row needs id and obligation: ${JSON.stringify(record).slice(0, 120)}`);
    assert.ok(record.classic?.observed, `matrix row ${record.id} must record what Classic really exposes`);
    assert.ok(record.native?.observed, `matrix row ${record.id} must record what Native really exposes`);
    assert.ok(record.classic?.evidence && record.native?.evidence, `matrix row ${record.id} must cite probe evidence for both modes`);
  }
});

test('1.4.a: Classic init exposes the real state machine, guard hook and check runtime — the surfaces the registration pins', async () => {
  const init = comet(['init', classicProject, '--yes', '--scope', 'project', '--workflow', 'classic', '--platform', 'claude', '--codegraph', 'skip', '--language', 'en'], { timeout: 300_000 });
  assert.equal(init.status, 0, `comet init (classic) failed: ${plain(init.stderr).slice(0, 400)}`);

  const resolve = comet(['workflow', 'resolve', '--json']);
  assert.equal(resolve.json?.exitCode, 0);
  assert.equal(resolve.json?.data?.workflow, 'classic', 'the workflow binding must resolve to classic in a classic-initialized project');
  assert.equal(resolve.json?.schema, 'comet.workflow-resolution.v1');

  // The surfaces the matrix's classic rows cite, verified live.
  for (const relative of [
    '.comet/config.yaml',
    '.claude/skills/comet-classic/SKILL.md',
    '.claude/skills/comet/scripts/comet-hook-router.mjs',
    '.claude/skills/comet/runtime/classic/checks.yaml',
  ]) {
    assert.ok(await fs.access(path.join(classicProject, relative)).then(() => true, () => false),
      `classic mode must install ${relative}`);
  }
  const settings = JSON.parse(await fs.readFile(path.join(classicProject, '.claude/settings.local.json'), 'utf8'));
  const entry = settings.hooks?.PreToolUse?.[0];
  assert.equal(entry?.matcher, 'Write|Edit', 'the classic guard hook must be registered for the edit channel');

  // M01: the managed path carries the pre-fixed Classic method only. No
  // Superpowers runtime is installed or invoked by the fixed distribution;
  // docs/superpowers is an upstream artifact root name, not a runtime.
  const superpowersRuntime = comet(['status', '--json']);
  assert.doesNotMatch(plain(superpowersRuntime.stdout), /superpowers.*enabled/i);

  // B6 (probe): classic init tries a floating global OpenSpec upgrade on a
  // mismatched host — the stub log is the neutralized witness.
  const stubCalls = await fs.readFile(stubLog, 'utf8');
  assert.match(stubCalls, /\[stub\] npm install -g @fission-ai\/openspec@latest/,
    'the registered B6 gap must stay reproducible: classic init attempts a floating global OpenSpec install');
  const qualification = await loadQualification();
  const b6 = qualification.blockingItems.find((item) => item.id === 'B6');
  assert.ok(b6, 'the global OpenSpec upgrade attempt must be a registered blocking item');
  assert.match(b6.gap, /npm install -g @fission-ai\/openspec@latest/);
});

test('1.4.a: Native mode is a capability comparison only — own surfaces, no classic control plane, not a fallback', async () => {
  const init = comet(['init', nativeProject, '--yes', '--scope', 'project', '--workflow', 'native', '--platform', 'claude', '--codegraph', 'skip', '--language', 'en'], { timeout: 300_000, cwd: nativeProject });
  assert.equal(init.status, 0, `comet init (native) failed: ${plain(init.stderr).slice(0, 400)}`);

  // Native installs its own skill surface…
  assert.ok(await fs.access(path.join(nativeProject, '.claude/skills/comet-native/SKILL.md')).then(() => true, () => false));
  const scripts = (await fs.readdir(path.join(nativeProject, '.claude/skills/comet-native/scripts'))).filter((name) => name.endsWith('.mjs'));
  assert.ok(scripts.length >= 8, `native mode must carry its own script surface: ${scripts.join(',')}`);

  // …but has no classic control plane and no managed hook registration.
  assert.equal(await fs.access(path.join(nativeProject, '.comet/config.yaml')).then(() => true, () => false), false,
    'native mode must not create the classic project config');
  const resolve = comet(['workflow', 'resolve', '--json'], { cwd: nativeProject });
  assert.equal(resolve.json?.exitCode, 65, 'workflow resolution must fail without the classic project config (no silent fallback to native)');
  assert.match(String(resolve.json?.error ?? ''), /config\.yaml is missing/);
  const stateInit = comet(['state', 'init', 'native-change', 'full', '--json'], { cwd: nativeProject });
  assert.equal(stateInit.json?.exitCode, 1, 'classic state commands must refuse in a native project');
  assert.match(JSON.stringify(stateInit.json?.data?.issues ?? []), /Classic artifact layout is unavailable/);

  const qualification = await loadQualification();
  assert.equal(qualification.classicAdmission.autoSwitch.observed, 'workflow-resolve-config-binding',
    'the registration must record that resolution derives from the init-time config binding, never a runtime switch');
  const nativeRow = qualification.capabilityMatrix.find((row) => row.id === 'mode-authority');
  assert.ok(nativeRow, 'the matrix must carry the mode-authority row');
  assert.match(nativeRow.verdict, /classic-admitted/);
  assert.match(nativeRow.native.verdict ?? '', /comparison-only/);
});

test('1.4.b class 2 (missing required check): every gated entrance refuses, next stays guidance', async () => {
  await loadQualification(); // RED boundary first
  const setup = comet(['state', 'init', CHANGE, 'full', '--json']);
  assert.equal(setup.json?.exitCode, 0);
  assert.equal(comet(['state', 'select', CHANGE, '--json']).json?.exitCode, 0);
  await fs.writeFile(path.join(classicProject, 'docs/openspec/changes', CHANGE, 'proposal.md'), '# Proposal\n\nMode qualification probe.\n');
  await fs.writeFile(path.join(classicProject, 'docs/openspec/changes', CHANGE, 'tasks.md'), '# Tasks\n\n- [ ] 1.1 Implement probe product code');
  await fs.writeFile(path.join(classicProject, 'docs/openspec/changes', CHANGE, 'design.md'), '# Design\n\nClassic managed probe.\n');
  await fs.mkdir(path.join(classicProject, 'src'), { recursive: true });
  await fs.writeFile(path.join(classicProject, 'src/feature.js'), 'export const v1 = 1;\n');
  assert.equal(comet(['state', 'transition', CHANGE, 'open-complete', '--json']).json?.exitCode, 0);
  assert.equal(comet(['state', 'complete-design', CHANGE, '--design-doc', `docs/openspec/changes/${CHANGE}/design.md`, '--json']).json?.exitCode, 0);
  assert.equal(comet(['state', 'transition', CHANGE, 'design-complete', '--json']).json?.exitCode, 0);
  assert.equal(comet(['state', 'set', CHANGE, 'build_mode', 'executing-plans', 'tdd_mode', 'tdd', 'isolation', 'current', '--json']).json?.exitCode, 0);
  const tasks = comet(['state', 'tasks', CHANGE, '--assign-ids', '--json']);
  const revision = tasks.json?.data?.revision;
  const taskId = tasks.json?.data?.tasks?.[0]?.id;
  assert.equal(comet(['state', 'task-complete', CHANGE, taskId, '--expect', revision, '--json']).json?.exitCode, 0);

  // C07: with zero check evidence, all gated entrances refuse.
  const transition = gateVerdict(comet(['state', 'transition', CHANGE, 'build-complete', '--json']));
  assert.equal(transition.exitCode, 1, 'direct transition must refuse without the build check');
  assert.match(transition.issues, /Build passes/);

  const guardPreview = gateVerdict(comet(['guard', CHANGE, 'build', '--json']));
  assert.equal(guardPreview.exitCode, 1, 'guard preview must refuse without the build check');
  const guardApply = gateVerdict(comet(['guard', CHANGE, 'build', '--apply', '--json']));
  assert.equal(guardApply.exitCode, 1, 'guard --apply must refuse without the build check');
  assert.equal((await fs.readFile(path.join(classicProject, 'docs/openspec/changes', CHANGE, '.comet.yaml'), 'utf8')).match(/^phase: (\w+)$/m)?.[1], 'build',
    'a refused guard --apply must not advance the phase');

  const next = comet(['state', 'next', CHANGE, '--json']);
  assert.equal(next.json?.exitCode, 0);
  const nextKind = next.json?.data?.nextAction?.kind ?? next.json?.agent?.continuation?.kind;
  assert.notEqual(nextKind, 'archive', 'continuation guidance must not claim completion past the missing check');

  const archive = comet(['archive', CHANGE, '--json']);
  assert.equal(archive.json?.exitCode, 1, 'the archive entrance must refuse outside the archive phase');
  assert.match(plain(archive.json?.stderr), /FATAL: phase is 'build', expected 'archive'/);
});

test('1.4.b class 1 (irrelevant successful command): a cross-scope success is refused natively; the registered gap is the missing required-check identity', async () => {
  await loadQualification();
  // A real, successful check under the WRONG scope must not satisfy the build gate.
  await fs.writeFile(path.join(classicProject, 'verify-probe.js'), 'process.exit(0);\n');
  const wrongScope = comet(['check', 'run', CHANGE, 'verify', '--local', '--', nodeExecutable, 'verify-probe.js']);
  assert.match(plain(wrongScope.stdout), /Check verify: exit=0/, 'the cross-scope probe must itself really run and succeed');
  const refused = gateVerdict(comet(['state', 'transition', CHANGE, 'build-complete', '--json']));
  assert.equal(refused.exitCode, 1, 'a verify-scope success must not stand in for the build check');
  assert.match(refused.issues, /Build passes/);

  // The registered gap: no required-check identity registry exists, so a
  // trivial successful command under the required scope satisfies the gate
  // (review SC-01). The registration must carry it as a gap with an
  // extension acceptance — never smoothed into "blocked".
  const qualification = await loadQualification();
  const b1 = qualification.blockingItems.find((item) => item.id === 'B1');
  assert.ok(b1, 'class 1 (irrelevant successful command) must be a registered blocking item');
  assert.equal(b1.class, 'irrelevant-successful-command');
  assert.equal(b1.nativeBehavior, 'partially-blocked');
  assert.match(b1.blocked.join('\n'), /verify-scope.*refused|cross-scope.*refused/i, 'B1 must record the natively covered facet');
  assert.match(b1.gap, /trivial|no required-check identity|SC-01/i, 'B1 must record the native gap');
  assert.ok(b1.extensionAcceptance && b1.extensionAcceptance.length > 20, 'B1 must carry an extension acceptance instead of a verdict change');
  const probe = await loadProbeRecords(b1.evidence.replace(/^mode-probes\//, ''));
  const gapRecord = probe.records.find((record) => record.id === 'trivial-command-satisfies-build-gate');
  assert.equal(gapRecord?.exitCode, 0, 'the recorded gap evidence must show the gate really passing on a trivial command');
});

test('1.4.b class 3 (hand written receipt): the guard refuses a manual record-check declaration', async () => {
  await loadQualification();
  const manual = comet(['state', 'record-check', CHANGE, 'build', '--command', 'node -e 0', '--exit-code', '0', '--json']);
  assert.equal(manual.json?.exitCode, 0, 'recording the manual declaration itself is allowed');
  const refused = gateVerdict(comet(['state', 'transition', CHANGE, 'build-complete', '--json']));
  assert.equal(refused.exitCode, 1, 'a hand written receipt must not pass the gate');
  assert.match(refused.issues, /Manual declarations never satisfy the guard/);
});

test('1.4.b class 1b (registered gap, real): a trivial exit-0 command under the build scope satisfies the gate', async () => {
  await loadQualification();
  await fs.writeFile(path.join(classicProject, 'build-probe.js'), 'process.exit(0);\n');
  const trivial = comet(['check', 'run', CHANGE, 'build', '--local', '--', nodeExecutable, 'build-probe.js']);
  assert.match(plain(trivial.stdout), /Check build: exit=0/);
  const passed = comet(['state', 'transition', CHANGE, 'build-complete', '--json']);
  assert.equal(passed.json?.exitCode, 0, 'the registered SC-01 gap must stay reproducible: a trivial command passes the build gate');
  assert.equal(comet(['state', 'get', CHANGE, 'phase']).stdout?.trim(), 'verify');
});

test('1.4.b class 3 (stale receipt): evidence that predates a source mutation is refused at the verify gate', async () => {
  await loadQualification();
  assert.equal(comet(['state', 'set', CHANGE, 'verification_report', `docs/openspec/changes/${CHANGE}/verification.md`, '--json']).json?.exitCode, 0);
  await fs.writeFile(path.join(classicProject, 'docs/openspec/changes', CHANGE, 'verification.md'), '# Verification Report\n\nProbe.\n');
  const fresh = comet(['check', 'run', CHANGE, 'verify', '--local', '--', nodeExecutable, 'verify-probe.js']);
  assert.match(plain(fresh.stdout), /Check verify: exit=0/);
  await fs.appendFile(path.join(classicProject, 'src/feature.js'), 'export const v2 = 2;\n');
  const refused = gateVerdict(comet(['state', 'transition', CHANGE, 'verify-pass', '--json']));
  assert.equal(refused.exitCode, 1, 'a receipt whose inputs changed must not pass the verify gate');
  assert.match(refused.issues, /check inputs changed since execution/);
  assert.match(refused.issues, /src\/feature\.js/);

  const qualification = await loadQualification();
  const b3 = qualification.blockingItems.find((item) => item.id === 'B3');
  assert.ok(b3, 'class 3 (stale or manual receipts) must be a registered blocking item');
  assert.equal(b3.nativeBehavior, 'blocked');
  assert.match(b3.blocked.join('\n'), /Manual declarations never satisfy the guard/);
  assert.match(b3.blocked.join('\n'), /check inputs changed since execution/);
});

test('1.4.b class 4 (escape path, real): COMET_SKIP_BUILD=1 alone voids the whole evidence chain — registered gap with extension acceptance', async () => {
  await loadQualification();
  const ESCAPE = 'escape-change';
  assert.equal(comet(['state', 'init', ESCAPE, 'full', '--json']).json?.exitCode, 0);
  assert.equal(comet(['state', 'select', ESCAPE, '--json']).json?.exitCode, 0);
  await fs.writeFile(path.join(classicProject, 'docs/openspec/changes', ESCAPE, 'proposal.md'), '# P\n');
  await fs.writeFile(path.join(classicProject, 'docs/openspec/changes', ESCAPE, 'tasks.md'), '# T\n\n- [ ] 1.1 x');
  await fs.writeFile(path.join(classicProject, 'docs/openspec/changes', ESCAPE, 'design.md'), '# D\n');
  assert.equal(comet(['state', 'transition', ESCAPE, 'open-complete', '--json']).json?.exitCode, 0);
  assert.equal(comet(['state', 'complete-design', ESCAPE, '--design-doc', `docs/openspec/changes/${ESCAPE}/design.md`, '--json']).json?.exitCode, 0);
  assert.equal(comet(['state', 'transition', ESCAPE, 'design-complete', '--json']).json?.exitCode, 0);
  assert.equal(comet(['state', 'set', ESCAPE, 'build_mode', 'executing-plans', 'tdd_mode', 'tdd', 'isolation', 'current', '--json']).json?.exitCode, 0);
  const tasks = comet(['state', 'tasks', ESCAPE, '--assign-ids', '--json']);
  assert.equal(comet(['state', 'task-complete', ESCAPE, tasks.json.data.tasks[0].id, '--expect', tasks.json.data.revision, '--json']).json?.exitCode, 0);
  assert.equal(comet(['state', 'set', ESCAPE, 'verification_report', `docs/openspec/changes/${ESCAPE}/verification.md`, '--json']).json?.exitCode, 0);
  await fs.writeFile(path.join(classicProject, 'docs/openspec/changes', ESCAPE, 'verification.md'), '# V\n');

  // The escape: one ordinary environment variable, zero check executions.
  const skip = { COMET_SKIP_BUILD: '1' };
  assert.equal(comet(['state', 'transition', ESCAPE, 'build-complete', '--json'], { env: skip }).json?.exitCode, 0, 'SKIP_BUILD must be observed to void the build gate');
  assert.equal(comet(['state', 'transition', ESCAPE, 'verify-pass', '--json'], { env: skip }).json?.exitCode, 0, 'SKIP_BUILD must be observed to void the verify gate');
  assert.equal(comet(['state', 'transition', ESCAPE, 'archive-confirm', '--json'], { env: skip }).json?.exitCode, 0);
  assert.equal(comet(['state', 'get', ESCAPE, 'verify_result'], { env: skip }).stdout?.trim(), 'pass', 'verify_result is stamped pass without any real evidence');
  const archive = comet(['archive', ESCAPE, '--json'], { env: skip });
  assert.equal(archive.json?.exitCode, 0, 'the full lifecycle must be observed archiving under the escape');
  assert.match(plain(archive.json?.stderr), /archived successfully/);
  const archivedDirName = (await fs.readdir(path.join(classicProject, 'docs/openspec/changes/archive'))).find((name) => name.endsWith(ESCAPE));
  const checksDir = path.join(classicProject, 'docs/openspec/changes/archive', archivedDirName, '.comet/checks');
  const checkLogs = await fs.readdir(checksDir).then((names) => names.filter((name) => name.endsWith('.log')), () => []);
  assert.equal(checkLogs.length, 0, 'the archived change must carry zero real check logs — the escape voided the entire evidence chain');

  // The second escape: direct phase write.
  const FORGED = 'force-change';
  assert.equal(comet(['state', 'init', FORGED, 'full', '--json']).json?.exitCode, 0);
  const refusedWrite = comet(['state', 'set', FORGED, 'phase', 'archive', '--json']);
  assert.equal(refusedWrite.json?.exitCode, 1, 'a direct phase write must refuse by default');
  assert.match(JSON.stringify(refusedWrite.json?.data ?? refusedWrite.json), /COMET_FORCE_PHASE/);
  const forcedWrite = comet(['state', 'set', FORGED, 'phase', 'archive', '--json'], { env: { COMET_FORCE_PHASE: '1' } });
  assert.equal(forcedWrite.json?.exitCode, 0, 'COMET_FORCE_PHASE=1 must be observed to allow the direct phase write');
  assert.equal(comet(['state', 'get', FORGED, 'phase']).stdout?.trim(), 'archive');
  const forgedArchive = comet(['archive', FORGED, '--json']);
  assert.equal(forgedArchive.json?.exitCode, 1, 'the archive entry checks must still refuse the forged state');
  assert.match(plain(forgedArchive.json?.stderr), /verify_result is 'pending', expected 'pass'/);

  const qualification = await loadQualification();
  const b4 = qualification.blockingItems.find((item) => item.id === 'B4');
  assert.ok(b4, 'class 4 (escape paths) must be a registered blocking item');
  assert.equal(b4.nativeBehavior, 'gap');
  assert.match(b4.gap, /COMET_SKIP_BUILD/);
  assert.match(b4.gap, /COMET_FORCE_PHASE/);
  assert.match(b4.extensionAcceptance, /launch authority|protected CI|env hygiene/i,
    'B4 extension acceptance must name the managed-env/CI countermeasure, not a verdict change');
  assert.match(b4.blocked.join('\n'), /verify_result is 'pending'/, 'B4 must record the downstream entry-check refusal that does hold');
  const probe = await loadProbeRecords(b4.evidence.replace(/^mode-probes\//, ''));
  const chain = probe.records.find((record) => record.id === 'skip-build-full-chain');
  assert.equal(chain?.records?.archiveExit, 0, 'the recorded escape evidence must carry the real full-chain archive');
  assert.equal(chain?.records?.checkLogs, 0);
});

test('1.4.c: the built-in project memory is a HOME-scoped cache, never an LLMWiki/Outline receipt — boundary registered', async () => {
  await loadQualification();
  const remember = comet(['knowledge', 'remember', '--title', 'probe-lesson', '--text', 'probe knowledge body', '--json']);
  assert.ok(remember.json, 'comet knowledge remember must answer');
  const storedFile = remember.json?.data?.file ?? remember.json?.file;
  assert.equal(typeof storedFile, 'string', 'the built-in memory must reveal where it stores');
  assert.ok(storedFile.includes(fakeHome) || storedFile.includes(os.tmpdir()), 'the built-in memory store must live outside the project repo (HOME cache)');
  assert.equal(await fs.access(storedFile).then(() => true, () => false), true, 'the memory record must really exist');
  assert.doesNotMatch(storedFile, /llmwiki|outline|deepwiki/i, 'the built-in memory store must not be an LLMWiki/Outline/DeepWiki artifact');
  const list = comet(['knowledge', 'list', '--json']);
  assert.equal(list.json?.exitCode, 0);

  // The archive entry check set carries no knowledge requirement at all —
  // the knowledge closeout (Kp) is enforced by the driver gate extension
  // (P1_3), not by the native gate.
  const archiveCheck = comet(['state', 'check', 'escape-change', 'archive', '--json']);
  assert.equal(archiveCheck.json?.exitCode, 0);
  assert.ok(archiveCheck.json?.data?.checks?.blocked === false || archiveCheck.json?.data?.checks?.passed > 0,
    'the archive entry checks were observed passing without any knowledge receipt');
  assert.doesNotMatch(JSON.stringify(archiveCheck.json?.data ?? {}), /llmwiki|outline/i,
    'the native gate must not consult LLMWiki/Outline receipts');

  const qualification = await loadQualification();
  const boundary = qualification.knowledgeBoundary;
  assert.ok(boundary, 'the knowledge boundary must be registered');
  assert.equal(boundary.llmwikiOutlineDeepWikiRemainSoleSources, true);
  assert.equal(boundary.builtinMemory.authoritative, false, 'the built-in memory must be registered as non-authoritative');
  assert.match(boundary.builtinStorage, /Library\/Caches|\$HOME|home cache/i);
  assert.match(boundary.conflictPolicy, /不能禁用或隔离时不启用|not enabled when it cannot be disabled or isolated/i);
  assert.match(boundary.kpEnforcement, /driver gate|Knowledge\.Closeout\.v1|sealCloseout/i,
    'the registration must point at the Kp enforcement seat');
  const b5 = qualification.blockingItems.find((item) => item.id === 'B5');
  assert.ok(b5, 'the knowledge boundary must also be a mandatory Classic-admission block');
  assert.equal(b5.class, 'knowledge-boundary');
});

test('1.4.b/C07: the registered entrance matrix covers the write channel and every record cites real probe files', async () => {
  const { probeWriteChannels } = await import('../../lib/adapters/comet.js');
  const records = await probeWriteChannels({ projectRoot: classicProject, nodeExecutable, change: CHANGE, env: childEnv() });
  assert.equal(records.length, 3);
  const byChannel = Object.fromEntries(records.map((record) => [record.channel, record]));
  assert.equal(byChannel.edit.outcome, 'rejected', 'the write-channel entrance must really refuse a cross-phase write (C07)');
  assert.equal(byChannel.edit.exitCode, 2);

  const qualification = await loadQualification();
  assert.ok(Array.isArray(qualification.c07Entrances) && qualification.c07Entrances.length >= 6,
    'C07: transition, guard preview, guard --apply, next/continuation, archive, phase-guard write hook');
  for (const entrance of qualification.c07Entrances) {
    assert.ok(entrance.entrance && entrance.refusesWithoutCheck !== undefined,
      `entrance record incomplete: ${JSON.stringify(entrance).slice(0, 120)}`);
  }
  const declaredProbes = qualification.probes ?? [];
  assert.ok(declaredProbes.length >= 5, 'the registration must cite its probe files');
  for (const relative of declaredProbes) {
    const probe = await loadProbeRecords(relative.replace(/^mode-probes\//, ''));
    assert.ok(Array.isArray(probe.records) && probe.records.length > 0, `${relative} carries no records`);
    for (const record of probe.records) {
      assert.ok(record.id !== undefined && record.command !== undefined && record.exitCode !== undefined,
        `${relative} record without command/exit evidence: ${JSON.stringify(record).slice(0, 120)}`);
    }
  }
});

test('cleanup removes the scratch world', async () => {
  await fs.rm(scratch, { recursive: true, force: true });
});

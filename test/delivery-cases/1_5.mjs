// P1_5 delivery case: the Classic integration gates over the real patched
// build (fingerprint 9b95a0ff… after the P2_4 lock revision, manifest-verified on reuse). Per
// classic-integration-design.md and acceptance C04/C06/C07/C08 this drives
// one real Classic run through the managed entrances and records that:
// C07 — all seven entrances (transition, guard preview, guard --apply,
//       next/continuation, archive, phase-guard write hook, state check)
//       enforce the same precondition rule with zero check evidence;
// C04 — tasks/DAG is the single writable authority: progress ticks never
//       move the write ticket, definition drift does, and a progress write
//       with a stale ticket is refused;
// C06 — the Kp/Kt readback gate seats at the driver: the native archive
//       entry carries no knowledge receipt at all (the registered B5 gap),
//       the driver seal requires the knowledge closeout, exactly once, and
//       a second closeout execution is refused after the real archive;
// C08 — bypass and recovery negatives: a hand-edited phase file, a manual
//       record-check declaration and a forged seal are all refused on every
//       downstream entrance, interruption recovers as continuation guidance,
//       and the pinned host OpenSpec incompatibility is resolved only by the
//       isolated candidate (the floating global upgrade attempt is observed
//       and neutralized in the isolated environment, never executed).
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
const isolatedOpenspecBin = path.join(projectRoot, '.sdd/tools/openspec-1.11.0/node_modules/@fission-ai/openspec/bin/openspec.js');
const isolatedOpenspecReady = await fs.access(isolatedOpenspecBin).then(() => true, () => false);

const pinnedNode = lock.toolchain.node;
let nodeExecutable = process.execPath;
if (process.versions.node !== pinnedNode) {
  const candidate = path.join(process.env.HOME ?? '', '.nvm/versions/node', `v${pinnedNode}`, 'bin/node');
  const probe = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
  if (probe.status === 0 && probe.stdout.trim() === `v${pinnedNode}`) nodeExecutable = candidate;
}

const plain = (text) => String(text ?? '').replace(/\x1b\[[0-9;]*m/g, '');

// The structured probe registration is the RED boundary: without it the
// entrance/bypass/knowledge behaviors carry no registered real-entry evidence.
async function loadProbe(name) {
  try {
    return JSON.parse(await fs.readFile(path.join(probesDir, name), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      const failure = new Error(`classic-integration-probes/${name} is missing: the C01–C08 behaviors have no registered real-entry evidence (task P1_5 deliverable)`);
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

// The comet CLI is itself a Node program: the test runner's child context
// marker (NODE_TEST_CONTEXT) must never reach it, or it boots in test-child
// protocol mode and its stdout stops being the CLI's own output.
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

function comet(args, { env = {}, timeout = 180_000, cwd = project } = {}) {
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
  return { exitCode: result.json?.exitCode, issues: plain(issues) };
};

const CHANGE = 'p15-integrate';
const SEALRUN = 'p15-seal-run';
const skipIfNoBuild = (t) => {
  if (!prepared || !built) {
    t.skip('patched Comet build is not present in this project; run tools/comet/prepare-source.mjs && tools/comet/build.mjs --archive first');
    return true;
  }
  return false;
};

const writeArtifacts = async (change) => {
  const dir = path.join(project, 'docs/openspec/changes', change);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'proposal.md'), '# Proposal\n\nP1_5 integration probe.\n');
  await fs.writeFile(path.join(dir, 'tasks.md'), '# Tasks\n\n- [ ] 1.1 Implement probe product code\n');
  await fs.writeFile(path.join(dir, 'design.md'), '# Design\n\nClassic managed probe.\n');
  await fs.mkdir(path.join(project, 'src'), { recursive: true });
  await fs.writeFile(path.join(project, 'src/feature.js'), 'export const v1 = 1;\n');
  return dir;
};

const driveToBuild = async (change) => {
  assert.equal(comet(['state', 'init', change, 'full', '--json']).json?.exitCode, 0);
  assert.equal(comet(['state', 'select', change, '--json']).json?.exitCode, 0);
  await writeArtifacts(change);
  assert.equal(comet(['state', 'transition', change, 'open-complete', '--json']).json?.exitCode, 0);
  // The strict design confirmation demands the frontmatter triple
  // (comet_change/role/canonical_spec); without it the command refuses after
  // registering the reference, and transition design-complete is the phase
  // driver — the same recipe as the recorded P1_4 probe evidence.
  comet(['state', 'complete-design', change, '--design-doc', `docs/openspec/changes/${change}/design.md`, '--json']);
  assert.equal(comet(['state', 'transition', change, 'design-complete', '--json']).json?.exitCode, 0);
  assert.equal(comet(['state', 'set', change, 'build_mode', 'executing-plans', 'tdd_mode', 'tdd', 'isolation', 'current', '--json']).json?.exitCode, 0);
  const tasks = comet(['state', 'tasks', change, '--assign-ids', '--json']).json;
  assert.equal(comet(['state', 'task-complete', change, tasks?.data?.tasks?.[0]?.id, '--expect', tasks?.data?.revision, '--json']).json?.exitCode, 0);
};

const get = (change, field) => comet(['state', 'get', change, field]).stdout?.trim();

test('setup: the patched pinned build named by the source lock is manifest-verified in this project', (t) => {
  if (skipIfNoBuild(t)) return;
  // lock revision: 4 patches @ 9b95a0ff (P2_4 0002 + tests/2_4)
  assert.equal(lock.patches.length, 4, 'the patched build must carry the four locked patches');
  assert.match(fingerprint, /^9b95a0ff/, `patched fingerprint drifted: ${fingerprint}`);
  const version = comet(['--version']);
  assert.equal(version.status, 0);
  assert.equal((version.stdout ?? '').trim(), lock.package.version);
});

test('C07: with zero check evidence all seven managed entrances refuse or stay short of completion', async (t) => {
  if (skipIfNoBuild(t)) return;
  await loadProbe('entrances-c07.json');
  const init = comet(['init', project, '--yes', '--scope', 'project', '--workflow', 'classic', '--platform', 'claude', '--codegraph', 'skip', '--language', 'en'], { timeout: 300_000 });
  assert.equal(init.status, 0, `comet init (classic) failed: ${plain(init.stderr).slice(0, 400)}`);
  await driveToBuild(CHANGE);

  // 1. direct transition
  const transition = gateVerdict(comet(['state', 'transition', CHANGE, 'build-complete', '--json']));
  assert.equal(transition.exitCode, 1, 'direct transition must refuse without the build check');
  assert.match(transition.issues, /Build passes/);

  // 2. guard preview
  const guardPreview = gateVerdict(comet(['guard', CHANGE, 'build', '--json']));
  assert.equal(guardPreview.exitCode, 1, 'guard preview must refuse without the build check');

  // 3. guard --apply (and the phase must not move)
  const guardApply = gateVerdict(comet(['guard', CHANGE, 'build', '--apply', '--json']));
  assert.equal(guardApply.exitCode, 1, 'guard --apply must refuse without the build check');
  assert.equal(get(CHANGE, 'phase'), 'build', 'a refused guard --apply must not advance the phase');

  // 4. next/continuation recovery: guidance, never a completion claim
  const next = comet(['state', 'next', CHANGE, '--json']);
  assert.equal(next.json?.exitCode, 0);
  const nextKind = next.json?.data?.nextAction?.kind ?? next.json?.agent?.continuation?.kind;
  assert.equal(nextKind, 'plan', 'an interrupted run resumes as continuation guidance, not completion');

  // 5. archive entrance
  const archive = comet(['archive', CHANGE, '--json']);
  assert.equal(archive.json?.exitCode, 1, 'the archive entrance must refuse outside the archive phase');
  assert.match(plain(archive.json?.stderr), /FATAL: phase is 'build', expected 'archive'/);

  // 6. state check: the entrance check set of the phase being entered
  const checkBuild = comet(['state', 'check', CHANGE, 'build', '--json']);
  assert.equal(checkBuild.json?.exitCode, 0, 'the build ENTRY check set answers for the phase being entered');
  assert.equal(get(CHANGE, 'phase'), 'build', 'state check must not itself advance any phase');
  const checkArchive = comet(['state', 'check', CHANGE, 'archive', '--json']);
  assert.equal(checkArchive.json?.exitCode, 1, 'the archive entry set is not satisfied from the build phase with zero evidence');

  // 7. phase-guard write hook (edit channel), probed through the adapter
  const { probeWriteChannels } = await import('../../lib/adapters/comet.js');
  const channels = await probeWriteChannels({ projectRoot: project, nodeExecutable, change: CHANGE, env: childEnv() });
  const edit = channels.find((channel) => channel.channel === 'edit');
  assert.equal(edit.outcome, 'rejected', 'the write-hook entrance must really refuse a cross-phase product write (C07)');
  assert.equal(edit.exitCode, 2);

  // Registration consistency: the probe record cites these same refusals.
  const entrances = await loadProbe('entrances-c07.json');
  const byId = Object.fromEntries(entrances.records.map((record) => [record.id, record]));
  assert.equal(byId.transition?.observed?.exitCode, 1);
  assert.equal(byId['guard-preview']?.observed?.exitCode, 1);
  assert.equal(byId['guard-apply']?.observed?.exitCode, 1);
  assert.equal(byId.archive?.observed?.exitCode, 1);
  assert.equal(byId['write-hook']?.observed?.exitCode, 2);
  assert.equal(byId['next-continuation']?.observed?.kind, 'plan');
  assert.equal(byId['state-check']?.observed?.buildEntryExit, 0);
});

test('C04: tasks is the single writable authority — ticks never move the ticket, definition drift does, stale tickets are refused', async (t) => {
  if (skipIfNoBuild(t)) return;
  const record = await loadProbe('bypass-recovery.json');
  const assigned = comet(['state', 'tasks', CHANGE, '--assign-ids', '--json']).json;
  const r1 = assigned?.data?.revision;
  const taskId = assigned?.data?.tasks?.[0]?.id;
  assert.ok(r1 && taskId, 'assign-ids must mint the write ticket and task ids');
  assert.equal(comet(['state', 'task-complete', CHANGE, taskId, '--expect', r1, '--json']).json?.exitCode, 0);

  // (a) progress tick through the canonical file, markers preserved: the
  // ticket is checkbox-agnostic, exactly like the frozen plan digest.
  const tasksPath = path.join(project, 'docs/openspec/changes', CHANGE, 'tasks.md');
  const ticked = (await fs.readFile(tasksPath, 'utf8')).replace('- [ ] 1.1', '- [x] 1.1');
  await fs.writeFile(tasksPath, ticked);
  const rAfterTick = comet(['state', 'tasks', CHANGE, '--json']).json?.data?.revision;
  assert.equal(rAfterTick, r1, 'a progress tick is not a plan change: the ticket must not move');

  // (b) a second authority rewrites the task definition: the ticket moves.
  await fs.writeFile(tasksPath, '# Tasks\n\n- [ ] 9.9 A different task entirely\n');
  const rAfterDrift = comet(['state', 'tasks', CHANGE, '--json']).json?.data?.revision;
  assert.notEqual(rAfterDrift, r1, 'definition drift from a second authority must move the ticket');

  // (c) a progress write with the stale ticket is refused and told to reload.
  const stale = comet(['state', 'task-complete', CHANGE, taskId, '--expect', r1, '--json']);
  assert.equal(stale.json?.exitCode, 70, 'a progress write with a stale ticket must be refused');
  assert.match(JSON.stringify(stale.json?.data?.issues ?? []), /Task requirements changed; reload the task list/);

  // (d) reload the ticket, then the write is admitted again.
  const refreshed = comet(['state', 'tasks', CHANGE, '--assign-ids', '--json']).json;
  assert.equal(comet(['state', 'task-complete', CHANGE, refreshed?.data?.tasks?.[0]?.id, '--expect', refreshed?.data?.revision, '--json']).json?.exitCode, 0);
  // and a progress write without any ticket is refused outright
  assert.equal(comet(['state', 'task-complete', CHANGE, refreshed?.data?.tasks?.[0]?.id, '--json']).json?.exitCode, 1);

  const c04 = record.records.find((entry) => entry.id === 'tasks-revision-ticket');
  assert.equal(c04?.observed?.staleTicketExit, 70);
  assert.equal(c04?.observed?.tickMovesRevision, false);
  assert.equal(c04?.observed?.driftMovesRevision, true);
});

test('C06: the archive seal requires the knowledge closeout, exactly once — the native gate itself carries no knowledge receipt', async (t) => {
  if (skipIfNoBuild(t)) return;
  await loadProbe('knowledge-closeout.json');
  // Drive a run to the archive entry. The COMET_SKIP_BUILD escape is the
  // registered B4/B5 gap (P1_4): it is how the native gate is observed
  // carrying zero knowledge obligations — the driver gate is the Kp seat.
  await driveToBuild(SEALRUN);
  const escape = { COMET_SKIP_BUILD: '1' };
  assert.equal(comet(['state', 'transition', SEALRUN, 'build-complete', '--json'], { env: escape }).json?.exitCode, 0);
  await fs.writeFile(path.join(project, 'docs/openspec/changes', SEALRUN, 'verification.md'), '# Verification Report\n\nProbe.\n');
  assert.equal(comet(['state', 'set', SEALRUN, 'verification_report', `docs/openspec/changes/${SEALRUN}/verification.md`, '--json']).json?.exitCode, 0);
  assert.equal(comet(['state', 'transition', SEALRUN, 'verify-pass', '--json'], { env: escape }).json?.exitCode, 0);
  assert.equal(comet(['state', 'transition', SEALRUN, 'archive-confirm', '--json'], { env: escape }).json?.exitCode, 0);

  // The native archive entry check set: 5/5 passing, no knowledge anywhere.
  const archiveChecks = comet(['state', 'check', SEALRUN, 'archive', '--json']);
  assert.equal(archiveChecks.json?.exitCode, 0);
  assert.equal(archiveChecks.json?.data?.checks?.blocked, false);
  // B5 (lock revision: 4 patches @ 9b95a0ff, P2_4): the native archive ENTRY
  // CHECK VERDICT carries no knowledge consultation. The dormant
  // managed_delivery wire fields (e.g. knowledgeCloseoutRequired:false)
  // legitimately appear in the serialized configuration of any change; the
  // check verdict surface (counters + issues) is what this registration pins.
  const checkVerdict = JSON.stringify({
    checks: archiveChecks.json?.data?.checks ?? null,
    issues: archiveChecks.json?.data?.issues ?? [],
  });
  assert.doesNotMatch(checkVerdict, /llmwiki|outline|knowledge/i,
    'the native gate must not consult any knowledge receipt — B5 stays reproducible');

  // The managed seal read (never a hand parse of the YAML).
  const { readArchiveSeal, sealCloseout } = await import('../../lib/adapters/comet.js');
  const seal = await readArchiveSeal({ projectRoot: project, change: SEALRUN, nodeExecutable, entrypoint, env: childEnv() });
  assert.equal(seal.phase, 'archive');
  assert.equal(seal.verifyResult, 'pass');
  assert.equal(seal.archiveConfirmation, 'confirmed');
  assert.equal(seal.archived, false);

  // Negative: no knowledge closeout receipt, no seal (Kp before archive).
  assert.throws(
    () => sealCloseout({ seal, execution: 'exec-closeout-1', knowledgeCloseout: null }),
    (error) => error.code === 'KNOWLEDGE_CLOSEOUT_REQUIRED',
  );
  assert.throws(
    () => sealCloseout({ seal, execution: 'exec-closeout-1', knowledgeCloseout: { id: 'llmwiki:kp', digest: 'deadbeef' } }),
    (error) => error.code === 'KNOWLEDGE_CLOSEOUT_REQUIRED',
    'a knowledge closeout without a real content digest is not a readback',
  );

  // Positive: the recorded closeout seals the archive exactly once.
  const knowledgeCloseout = { id: 'llmwiki:kp-p15', digest: crypto.createHash('sha256').update('kp-published-content').digest('hex') };
  const sealed = sealCloseout({ seal, execution: 'exec-closeout-1', knowledgeCloseout });
  assert.equal(sealed.archived, true);
  assert.deepEqual(sealed.knowledgeCloseout, knowledgeCloseout);

  // The upstream CLI archive itself converges (idempotent by design)…
  const archive = comet(['archive', SEALRUN, '--json'], { env: escape });
  assert.equal(archive.json?.exitCode, 0, `the archive must succeed for the sealable run: ${plain(archive.json?.stderr).slice(0, 200)}`);
  // …and the second closeout execution is refused at the driver gate.
  const archivedSeal = await readArchiveSeal({ projectRoot: project, change: SEALRUN, nodeExecutable, entrypoint, env: childEnv() });
  assert.equal(archivedSeal.archived, true);
  assert.throws(
    () => sealCloseout({ seal: archivedSeal, execution: 'exec-closeout-2', knowledgeCloseout }),
    (error) => error.code === 'ARCHIVE_ALREADY_SEALED' && /exec-closeout-2/.test(error.message),
  );

  // The built-in memory is a HOME cache, never an LLMWiki/Outline receipt.
  const remember = comet(['knowledge', 'remember', '--title', 'p15-lesson', '--text', 'probe knowledge body', '--json']);
  assert.equal(remember.status, 0);
  const storedFile = remember.json?.data?.file ?? remember.json?.file;
  assert.ok(storedFile.includes(fakeHome), 'the built-in memory must live in the isolated HOME cache');
  assert.doesNotMatch(storedFile, /llmwiki|outline|deepwiki/i, 'the built-in memory store must not be an LLMWiki/Outline/DeepWiki artifact');
});

test('C08: bypass and recovery negatives — tampered phase file, manual record-check, forged seal and force-phase all refuse; the floating global upgrade attempt stays neutralized', async (t) => {
  if (skipIfNoBuild(t)) return;
  const record = await loadProbe('bypass-recovery.json');

  // (a) hand-edited phase file: downstream entrances still refuse.
  const cometYaml = path.join(project, 'docs/openspec/changes', CHANGE, '.comet.yaml');
  const original = await fs.readFile(cometYaml, 'utf8');
  await fs.writeFile(cometYaml, original.replace(/^phase: build$/m, 'phase: verify'));
  const tampered = gateVerdict(comet(['state', 'transition', CHANGE, 'verify-pass', '--json']));
  assert.equal(tampered.exitCode, 1, 'a tampered phase must not carry the verify gate');
  const tamperedArchive = comet(['archive', CHANGE, '--json']);
  assert.equal(tamperedArchive.json?.exitCode, 1, 'a tampered phase must not pass the archive entry checks');
  await fs.writeFile(cometYaml, original);

  // (b) manual record-check declarations never satisfy the guard.
  const manual = comet(['state', 'record-check', CHANGE, 'build', '--command', 'node -e 0', '--exit-code', '0', '--json']);
  assert.equal(manual.json?.exitCode, 0, 'recording the manual declaration itself is allowed');
  const afterManual = gateVerdict(comet(['state', 'transition', CHANGE, 'build-complete', '--json']));
  assert.equal(afterManual.exitCode, 1, 'a manual declaration must not pass the gate');
  assert.match(afterManual.issues, /Manual declarations never satisfy the guard/);

  // (c) a direct phase write refuses by default (the escape env is named).
  const refusedWrite = comet(['state', 'set', CHANGE, 'phase', 'archive', '--json']);
  assert.equal(refusedWrite.json?.exitCode, 1);
  assert.match(JSON.stringify(refusedWrite.json?.data ?? refusedWrite.json), /COMET_FORCE_PHASE/);

  // (d) the floating global OpenSpec upgrade attempt is observed and
  // neutralized by the isolated environment (B6) — the stub npm log is the
  // witness that no real global mutation ran. The attempt only happens on a
  // host whose CLI is below the candidate, so a drifted pin skips honestly.
  const baselineToolchain = JSON.parse(await fs.readFile(path.join(changeRoot, 'toolchain-baseline.json'), 'utf8'));
  const hostBefore = spawnSync('openspec', ['--version'], { encoding: 'utf8', timeout: 30_000 });
  const hostPinned = hostBefore.status === 0 && hostBefore.stdout?.trim() === baselineToolchain.openspec.current;
  if (hostPinned) {
    const stubCalls = await fs.readFile(stubLog, 'utf8');
    assert.match(stubCalls, /npm install -g @fission-ai\/openspec@latest/,
      'classic init must attempt the floating global upgrade on a mismatched host (B6) — and the stub must have absorbed it');
    const hostAfter = spawnSync('openspec', ['--version'], { encoding: 'utf8', timeout: 30_000 });
    assert.equal(hostAfter.stdout?.trim(), baselineToolchain.openspec.current, 'the host-global CLI must remain at its pinned version after every probe');
  } else {
    t.skip(`host-global openspec is not at the toolchain-baseline pin ${baselineToolchain.openspec.current}; the B6 attempt probe premise does not hold here`);
  }

  // (e) the fixed compatible environment is the isolated candidate install.
  const recordCompat = await loadProbe('openspec-compat.json');
  assert.equal(recordCompat.positive?.isolatedInstall, '.sdd/tools/openspec-1.11.0');
  if (isolatedOpenspecReady) {
    const version = spawnSync(nodeExecutable, [isolatedOpenspecBin, '--version'], { encoding: 'utf8', timeout: 60_000 });
    assert.equal(version.stdout?.trim(), '1.11.0', 'the isolated candidate must answer with its pinned version');
  } else {
    t.skip('isolated openspec 1.11.0 is not installed under .sdd/tools; run the isolated install (never a global upgrade)');
  }

  const bypass = record.records.find((entry) => entry.id === 'tampered-phase-file');
  assert.equal(bypass?.observed?.verifyPassExit, 1);
  assert.equal(bypass?.observed?.archiveExit, 1);
  const manualRecord = record.records.find((entry) => entry.id === 'manual-record-check');
  assert.equal(manualRecord?.observed?.transitionExit, 1);
  assert.match(manualRecord?.observed?.message ?? '', /Manual declarations never satisfy the guard/);
  const forged = record.records.find((entry) => entry.id === 'forged-seal');
  assert.equal(forged?.observed?.code, 'ARCHIVE_ENTRY_INVALID');
});

test('cleanup removes the scratch world', async (t) => {
  if (skipIfNoBuild(t)) return;
  await fs.rm(scratch, { recursive: true, force: true });
});

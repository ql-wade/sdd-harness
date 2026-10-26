// P1_4 managed-init and escape-hatch probe driver (revision
// 2026-10-26-comet-050-adoption-v1). Runs against the pinned, REBUILT 0.5.0
// distribution (lock.patches carries 0005) in disposable /tmp scratch worlds
// with an isolated HOME and PATH stubs — the real host HOME and this
// repository are never touched.
//
// Probes:
//   1 classic-init-as-managed-entry — what `comet init --workflow classic
//     --platform claude --yes` actually attempts on a clean machine: the
//     Superpowers install attempt, the OpenSpec global upgrade attempt, the
//     written project binding, and whether any Superpowers runtime lands.
//   2 exclusion-path discovery — is there ANY init switch that excludes
//     Superpowers? (live: --workflow native control run + the pre-seeded
//     hasSkills path), and where COMET_OPENSPEC is honored.
//   3 env hygiene — a compatible pinned openspec binary on PATH (1.11.0)
//     suppresses the floating global upgrade (the B6-class mitigation).
//   4 escape hatches on the rebuilt (0005) tree — COMET_SKIP_BUILD=1 voids
//     the whole evidence chain and COMET_FORCE_PHASE=1 allows a direct phase
//     write (B4-class gaps persist on 0.5.0); plus a live attempt to observe
//     the 0005 Kt predicate through the compat `state next` face.
//
// Usage (pinned node):
//   ~/.nvm/versions/node/v24.15.0/bin/node \
//     openspec/changes/delivery-foundation-rearchitecture/mode-probes/init-probe-050.mjs
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const probeOut = path.join(path.dirname(fileURLToPath(import.meta.url)), '1_4-managed-init-escape.json');
const lock = JSON.parse(await fs.readFile(path.join(repositoryRoot, 'integrations/comet/upstream.lock.json'), 'utf8'));
const fingerprint = crypto.createHash('sha256').update(JSON.stringify({
  archive: lock.source.sha256,
  patches: lock.patches.map(({ path: p, sha256 }) => ({ path: p, sha256 })),
  toolchain: lock.toolchain,
})).digest('hex');
const entrypoint = path.join(repositoryRoot, '.sdd/vendor/comet', lock.source.commit, 'builds', fingerprint, 'work/bin/comet.js');
const nodeExecutable = process.execPath;

const record = {
  schemaVersion: 1,
  probe: '1_4-managed-init-escape',
  revision: '2026-10-26-comet-050-adoption-v1',
  recordedAt: new Date().toISOString(),
  node: process.version,
  build: { version: lock.package.version, commit: lock.source.commit, fingerprint, patches: lock.patches.map((p) => p.path) },
  probes: {},
};

const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'p14-init-'));
const fakeHome = path.join(scratch, 'home');
const stubs = path.join(scratch, 'stubs');
await fs.mkdir(fakeHome, { recursive: true });
await fs.mkdir(stubs, { recursive: true });
const stubLog = path.join(scratch, 'stub-calls.log');
const logger = '#!/bin/sh\necho "[stub] $0 $@" >> "${STUB_LOG:-/dev/null}"\nexit 0\n';
await fs.writeFile(path.join(stubs, 'npm'), logger, { mode: 0o755 });
await fs.writeFile(path.join(stubs, 'npx'), logger, { mode: 0o755 });
// openspec stub: `init <dir>` creates the root; `archive <change>` moves the
// change into the dated archive dir (same shape the 1_3 case uses); by
// default `--version` prints nothing (an "incompatible host" witness).
await fs.writeFile(path.join(stubs, 'openspec'), `#!/bin/sh
echo "[stub] openspec $@" >> "\${STUB_LOG:-/dev/null}"
if [ "$1" = "--version" ] && [ "$COMET_OPENSPEC_COMPAT" = "1" ]; then echo "1.11.0"; exit 0; fi
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

const childEnv = (extra = {}, cwd) => {
  const { NODE_TEST_CONTEXT: _stripped, ...inherited } = process.env;
  return {
    ...inherited,
    HOME: fakeHome,
    STUB_LOG: stubLog,
    COMET_PROJECT_ROOT: cwd ?? undefined,
    PATH: `${stubs}:${process.env.PATH ?? ''}`,
    ...extra,
  };
};
const plain = (text) => String(text ?? '').replace(/\x1b\[[0-9;]*m/g, '');
const comet = (args, { env = {}, timeout = 300_000, cwd } = {}) => {
  const result = spawnSync(nodeExecutable, [entrypoint, ...args], { cwd, encoding: 'utf8', timeout, env: childEnv(env, cwd) });
  let json = null;
  try { json = JSON.parse(result.stdout ?? ''); } catch { /* raw output */ }
  return { ...result, json };
};
const stubCalls = async () => (await fs.readFile(stubLog, 'utf8').catch(() => '')).split('\n').filter(Boolean);
const exists = (target) => fs.access(target).then(() => true, () => false);

// ---------------------------------------------------------------- probe 1+3
async function classicInitProbe({ id, openspecCompatible }) {
  const project = path.join(scratch, `proj-${id}`);
  await fs.mkdir(project, { recursive: true });
  await fs.writeFile(stubLog, '');
  const init = comet(['init', project, '--yes', '--scope', 'project', '--workflow', 'classic', '--platform', 'claude', '--codegraph', 'skip', '--language', 'en'], { env: openspecCompatible ? { COMET_OPENSPEC_COMPAT: '1' } : {}, cwd: project, timeout: 420_000 });
  const calls = await stubCalls();
  const superpowersAttempts = calls.filter((call) => /superpowers/i.test(call));
  const openspecUpgradeAttempts = calls.filter((call) => /install -g|openspec@latest/i.test(call));
  const skillsInstalls = calls.filter((call) => /skills add/i.test(call));
  const configExists = await exists(path.join(project, '.comet/config.yaml'));
  const config = configExists ? await fs.readFile(path.join(project, '.comet/config.yaml'), 'utf8') : null;
  // any superpowers-named runtime artifact in the project or the probe HOME?
  const findSuperpowers = async (root) => {
    const found = [];
    const walk = async (dir, depth) => {
      if (depth > 4) return;
      let entries = [];
      try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (/superpowers/i.test(entry.name)) found.push(path.join(dir, entry.name));
        if (entry.isDirectory() && entry.name !== 'node_modules') await walk(path.join(dir, entry.name), depth + 1);
      }
    };
    await walk(root, 0);
    return found;
  };
  return {
    openspecCompatibleStub: openspecCompatible,
    exitCode: init.status,
    stderrTail: plain(init.stderr).slice(-600),
    stubCalls: calls,
    superpowersInstallAttempts: superpowersAttempts,
    openspecGlobalUpgradeAttempts: openspecUpgradeAttempts,
    skillsCliInvocations: skillsInstalls,
    projectConfigWritten: configExists,
    projectConfigWorkflowBinding: config?.match(/^default_workflow:.*$/m)?.[0] ?? null,
    superpowersArtifacts: { project: await findSuperpowers(project), home: await findSuperpowers(fakeHome) },
    homeDotComet: await exists(path.join(fakeHome, '.comet')),
  };
}
record.probes.classicInitCleanHost = await classicInitProbe({ id: 'clean', openspecCompatible: false });
record.probes.classicInitCompatibleOpenspec = await classicInitProbe({ id: 'compat', openspecCompatible: true });

// ---------------------------------------------------------------- probe 2
// Control: native workflow selection never reaches the classic superpowers path.
{
  const project = path.join(scratch, 'proj-native');
  await fs.mkdir(project, { recursive: true });
  await fs.writeFile(stubLog, '');
  const init = comet(['init', project, '--yes', '--scope', 'project', '--workflow', 'native', '--platform', 'claude', '--codegraph', 'skip', '--language', 'en'], { cwd: project, timeout: 420_000 });
  record.probes.nativeInitControl = {
    exitCode: init.status,
    stubCalls: await stubCalls(),
    superpowersInstallAttempts: (await stubCalls()).filter((call) => /superpowers|skills add/i.test(call)),
  };
}
// Pre-seeded exclusion path: hasSkills finds a superpowers skill already
// present on the platform skills dir -> resolveAction skips it, and with zero
// spAction!=skip plans selectNpmDeps marks superpowers installed.
{
  const project = path.join(scratch, 'proj-preseeded');
  await fs.mkdir(path.join(project, '.claude/skills/superpowers'), { recursive: true });
  await fs.writeFile(path.join(project, '.claude/skills/superpowers/SKILL.md'), '---\nname: superpowers\ndescription: pre-seeded marker so comet init resolves superpowers as already installed.\n---\n');
  await fs.writeFile(stubLog, '');
  const init = comet(['init', project, '--yes', '--scope', 'project', '--workflow', 'classic', '--platform', 'claude', '--codegraph', 'skip', '--language', 'en'], { cwd: project, timeout: 420_000 });
  record.probes.classicInitPreseededSuperpowers = {
    exitCode: init.status,
    stubCalls: await stubCalls(),
    superpowersInstallAttempts: (await stubCalls()).filter((call) => /superpowers|skills add/i.test(call)),
  };
}
record.probes.exclusionSwitchDiscovery = {
  initHelpFlags: 'init --help carries --workflow/--codegraph/--scope/--platform/--language/--root only — no superpowers exclusion switch exists on 0.5.0',
  sourceFacts: [
    'app/commands/init.ts: spAction = (native && includesWorkflow(classic)) ? resolveAction(hasSP, options) : \'skip\' — the ONLY skip paths are a non-classic workflow or platform targets outside the skills-cli map',
    'selectNpmDeps with --yes/--json returns every dep not "installed"; superpowers "installed" is derived from spPlatformIds being empty (all plans skipped), not from any flag',
    'COMET_OPENSPEC is honored only by the classic openspec adapter (domains/comet-classic/classic-openspec-command.ts:122,148) — it does NOT steer the init-time PATH/upgrade decision',
  ],
};

// ---------------------------------------------------------------- probe 4
// Escape hatches on the rebuilt (0005) tree, compat classic face.
{
  const project = path.join(scratch, 'proj-escape');
  await fs.mkdir(project, { recursive: true });
  await fs.writeFile(stubLog, '');
  const init = comet(['init', project, '--yes', '--scope', 'project', '--workflow', 'classic', '--platform', 'claude', '--codegraph', 'skip', '--language', 'en'], { cwd: project, timeout: 420_000 });
  const CHANGE = 'escape-change';
  const j = (result) => result.json?.exitCode;
  const setup = [
    comet(['state', 'init', CHANGE, 'full', '--json'], { cwd: project }),
    comet(['state', 'select', CHANGE, '--json'], { cwd: project }),
  ];
  await fs.mkdir(path.join(project, 'docs/openspec/changes', CHANGE), { recursive: true });
  await fs.writeFile(path.join(project, 'docs/openspec/changes', CHANGE, 'proposal.md'), '# P\n');
  await fs.writeFile(path.join(project, 'docs/openspec/changes', CHANGE, 'tasks.md'), '# T\n\n- [ ] 1.1 x');
  await fs.writeFile(path.join(project, 'docs/openspec/changes', CHANGE, 'design.md'), '# D\n');
  const open = comet(['state', 'transition', CHANGE, 'open-complete', '--json'], { cwd: project });
  comet(['state', 'complete-design', CHANGE, '--design-doc', `docs/openspec/changes/${CHANGE}/design.md`, '--json'], { cwd: project });
  const design = comet(['state', 'transition', CHANGE, 'design-complete', '--json'], { cwd: project });
  const setMode = comet(['state', 'set', CHANGE, 'build_mode', 'executing-plans', 'tdd_mode', 'tdd', 'isolation', 'current', '--json'], { cwd: project });
  const tasks = comet(['state', 'tasks', CHANGE, '--assign-ids', '--json'], { cwd: project });
  const taskId = tasks.json?.data?.tasks?.[0]?.id;
  const taskComplete = comet(['state', 'task-complete', CHANGE, taskId, '--expect', tasks.json?.data?.revision, '--json'], { cwd: project });

  const skip = { COMET_SKIP_BUILD: '1' };
  const buildComplete = comet(['state', 'transition', CHANGE, 'build-complete', '--json'], { cwd: project, env: skip });
  await fs.mkdir(path.join(project, 'docs/openspec/changes', CHANGE), { recursive: true });
  await fs.writeFile(path.join(project, 'docs/openspec/changes', CHANGE, 'verification.md'), '# V\n');
  const setReport = comet(['state', 'set', CHANGE, 'verification_report', `docs/openspec/changes/${CHANGE}/verification.md`, '--json'], { cwd: project });
  const verifyPass = comet(['state', 'transition', CHANGE, 'verify-pass', '--json'], { cwd: project, env: skip });
  const verifyResult = comet(['state', 'get', CHANGE, 'verify_result'], { cwd: project, env: skip });
  const archiveConfirm = comet(['state', 'transition', CHANGE, 'archive-confirm', '--json'], { cwd: project, env: skip });
  const archive = comet(['archive', CHANGE, '--json'], { cwd: project, env: skip, timeout: 420_000 });
  const archiveDir = (await fs.readdir(path.join(project, 'docs/openspec/changes/archive')).catch(() => [])).find((name) => name.endsWith(CHANGE));
  const checksDir = archiveDir ? path.join(project, 'docs/openspec/changes/archive', archiveDir, '.comet/checks') : null;
  const checkLogs = checksDir ? await fs.readdir(checksDir).then((names) => names.filter((n) => n.endsWith('.log')), () => []) : null;

  const FORGED = 'force-change';
  const forgedInit = comet(['state', 'init', FORGED, 'full', '--json'], { cwd: project });
  const refusedWrite = comet(['state', 'set', FORGED, 'phase', 'archive', '--json'], { cwd: project });
  const forcedWrite = comet(['state', 'set', FORGED, 'phase', 'archive', '--json'], { cwd: project, env: { COMET_FORCE_PHASE: '1' } });
  const forgedArchive = comet(['archive', FORGED, '--json'], { cwd: project, timeout: 420_000 });

  // 0005 read-side live attempt through the compat face: hand-write the
  // optional knowledgeCloseout field onto the ARCHIVED change state and ask
  // for the next step. The 0005 predicate rides the SDK in-memory state; on
  // the compat face the field is expected to be ignored (recorded either way).
  let ktParked = null;
  if (archiveDir) {
    const stateFile = path.join(project, 'docs/openspec/changes/archive', archiveDir, '.comet.yaml');
    if (await exists(stateFile)) {
      await fs.appendFile(stateFile, 'knowledgeCloseout:\n  required: true\n  completed: false\n');
      const next = comet(['state', 'next', CHANGE, '--json'], { cwd: project });
      ktParked = { stateFile: '.comet.yaml (compat face)', exitCode: next.status, nextAction: next.json?.data?.nextAction ?? next.json?.agent?.continuation ?? null, stdout: plain(next.stdout).slice(0, 400) };
    }
  }

  record.probes.escapeHatches = {
    initExit: init.status,
    setupExitCodes: { open: j(open), design: j(design), setMode: j(setMode), taskComplete: j(taskComplete), setupInit: setup.map(j) },
    skipBuildChain: {
      buildComplete: j(buildComplete),
      setReport: j(setReport),
      verifyPass: j(verifyPass),
      archiveConfirm: j(archiveConfirm),
      verifyResult: (verifyResult.stdout ?? '').trim(),
      archiveExit: j(archive),
      archiveStderrTail: plain(archive.json?.stderr ?? archive.stderr ?? '').slice(-300),
      archivedDir: archiveDir ?? null,
      checkLogsInArchive: checkLogs,
    },
    forcePhase: {
      refusedWriteExit: j(refusedWrite),
      refusedWriteNamesEscape: JSON.stringify(refusedWrite.json ?? {}).includes('COMET_FORCE_PHASE'),
      forcedWriteExit: j(forcedWrite),
      forcedPhaseReadback: (comet(['state', 'get', FORGED, 'phase'], { cwd: project }).stdout ?? '').trim(),
      forgedArchiveExit: j(forgedArchive),
      forgedArchiveStderrTail: plain(forgedArchive.json?.stderr ?? forgedArchive.stderr ?? '').slice(-300),
    },
    ktPredicateCompatFaceAttempt: ktParked,
  };
}

record.scratchWorld = scratch;
await fs.writeFile(probeOut, `${JSON.stringify(record, null, 2)}\n`);
console.log(JSON.stringify({ out: probeOut, summary: {
  classicInitClean: { exit: record.probes.classicInitCleanHost.exitCode, superpowers: record.probes.classicInitCleanHost.superpowersInstallAttempts.length, upgrade: record.probes.classicInitCleanHost.openspecGlobalUpgradeAttempts.length, binding: record.probes.classicInitCleanHost.projectConfigWorkflowBinding },
  classicInitCompat: { exit: record.probes.classicInitCompatibleOpenspec.exitCode, superpowers: record.probes.classicInitCompatibleOpenspec.superpowersInstallAttempts.length, upgrade: record.probes.classicInitCompatibleOpenspec.openspecGlobalUpgradeAttempts.length },
  nativeControl: { exit: record.probes.nativeInitControl.exitCode, superpowers: record.probes.nativeInitControl.superpowersInstallAttempts.length },
  preseeded: { exit: record.probes.classicInitPreseededSuperpowers.exitCode, superpowers: record.probes.classicInitPreseededSuperpowers.superpowersInstallAttempts.length },
  escape: { skipArchive: record.probes.escapeHatches.skipBuildChain.archiveExit, checkLogs: record.probes.escapeHatches.skipBuildChain.checkLogsInArchive, forcedWrite: record.probes.escapeHatches.forcePhase.forcedWriteExit, forgedArchive: record.probes.escapeHatches.forcePhase.forgedArchiveExit },
} }, null, 2));

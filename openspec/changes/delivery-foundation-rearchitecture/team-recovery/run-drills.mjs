#!/usr/bin/env node
// team-recovery/run-drills.mjs — P5_3 real-process recovery drills (A10/A11/H09).
//
// Three drills, zero mocks — every step runs a real CLI entry or a real child
// process of the real patched Comet build (state lock + transaction recovery
// come from the built dist modules the CLI itself uses):
//
//   drill 1  sigkill-restart-original   tools/infra/monitor.mjs probe
//                                     --case runner-process-failure: a real
//                                     child holds the heartbeat lease, real
//                                     SIGKILL, old-writer-gone confirmation,
//                                     restart binds the SAME authority, one
//                                     live instance (I07 MonitorInfra.v1).
//   drill 2  fencing-old-writer         tools/infra/backup-restore.mjs probe
//                                     --case old-writer-denial + authority-
//                                     transfer: live pid refuses restore, real
//                                     SIGKILL enables it, epoch increments
//                                     monotonically, masquerade approvals are
//                                     refused (I08 BackupInfra/AuthorityTransfer).
//   drill 3  lease-contention           the real Comet Classic state lock
//                                     (0.5.0 composition-era surface, revision
//                                     2026-10-26-comet-050-adoption-v1): the
//                                     managed gate/dispatch classic face is
//                                     retired, so the drill drives the real
//                                     `comet state init/set` face and the
//                                     per-change runtime lock under the
//                                     workspace runtime root. Double-open is
//                                     rejected while a live holder owns the
//                                     lock; a real SIGKILL of the holder lets
//                                     the next real CLI command recover the
//                                     lease and re-apply the SAME write
//                                     idempotently; a planted real-schema
//                                     transaction journal at the runtime root
//                                     is recovered on the next lock
//                                     acquisition (a journal left in the
//                                     LEGACY change dir is conservatively
//                                     refused by the migration fence); a
//                                     foreign-host lock owner is never
//                                     recovered (cross-machine boundary).
//
// Usage:
//   node run-drills.mjs --drill <1|2|3> --out <receipt.json> [--node <node>] [--json]
//
// Exit codes: 0 = drill VERIFIED, 1 = input error, 2 = drill did not verify.
// Receipts are TeamRecovery.DrillReceipt.v1: per-step command, exit code, ISO
// timestamp, attempt counter, and the observed state-file shapes. Host paths
// outside the repo are redacted from receipts the same way tools/infra CLIs
// redact them.
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const MONITOR_CLI = path.join(projectRoot, 'tools/infra/monitor.mjs');
const BACKUP_CLI = path.join(projectRoot, 'tools/infra/backup-restore.mjs');

const HOST_PATH_REDACTION = /(^|[\s"'=(:/：=（])\/(Users|home|root|private|var|usr|etc|opt|tmp)\/\S*/g;
const redact = (text) => String(text ?? '').replace(HOST_PATH_REDACTION, '$1<host-path-redacted>');
const nowIso = () => new Date().toISOString();
const EXIT_PASS = 0;
const EXIT_INPUT = 1;
const EXIT_VERIFY = 2;

// --- pinned toolchain node (same resolution as test/delivery-cases/*) ------

function resolveNode(override) {
  if (override) return override;
  const lock = JSON.parse(fs.readFileSync(path.join(projectRoot, 'integrations/comet/upstream.lock.json'), 'utf8'));
  if (process.versions.node === lock.toolchain.node) return process.execPath;
  const candidate = path.join(process.env.HOME ?? '', '.nvm/versions/node', `v${lock.toolchain.node}`, 'bin/node');
  const probe = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
  if (probe.status === 0 && probe.stdout.trim() === `v${lock.toolchain.node}`) return candidate;
  return process.execPath;
}

function resolveCometBuild() {
  const lock = JSON.parse(fs.readFileSync(path.join(projectRoot, 'integrations/comet/upstream.lock.json'), 'utf8'));
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify({
    archive: lock.source.sha256,
    patches: lock.patches.map(({ path: p, sha256 }) => ({ path: p, sha256 })),
    toolchain: lock.toolchain,
  })).digest('hex');
  const buildDir = path.join(projectRoot, '.sdd/vendor/comet', lock.source.commit, 'builds', fingerprint);
  const entrypoint = path.join(buildDir, 'work/bin/comet.js');
  const dist = path.join(buildDir, 'work/dist');
  const present = fs.existsSync(path.join(buildDir, 'distribution.json'));
  return { lock, fingerprint, buildDir, entrypoint, dist, present };
}

function args() {
  const out = { drill: null, out: null, node: null, json: false };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--drill') out.drill = argv[++i];
    else if (argv[i] === '--out') out.out = argv[++i];
    else if (argv[i] === '--node') out.node = argv[++i];
    else if (argv[i] === '--json') out.json = true;
    else return { error: `unknown argument: ${argv[i]}` };
  }
  if (!['1', '2', '3'].includes(out.drill)) return { error: '--drill must be 1, 2 or 3' };
  if (!out.out) return { error: '--out <receipt.json> is required' };
  return out;
}

// --- receipt scaffolding -----------------------------------------------------

function newReceipt(drill, operationKey) {
  return {
    schemaVersion: 1,
    interface: 'TeamRecovery.DrillReceipt.v1',
    drill,
    operationKey,
    executedAt: null,
    realProcessesOnly: true,
    steps: [],
    status: 'UNVERIFIED',
  };
}

function addStep(receipt, { step, command, exitCode, detail, stateFileShape, verbatim }) {
  const attempt = receipt.steps.length + 1;
  // Real wall-clock stamps only — never fabricated or adjusted. If two real
  // steps land in the same millisecond, wait for the next one so the receipt
  // stays strictly monotonic without inventing time.
  let stamp = nowIso();
  const previous = receipt.steps[receipt.steps.length - 1];
  if (previous) {
    while (Date.parse(stamp) <= Date.parse(previous.timestamp)) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2);
      stamp = nowIso();
    }
  }
  receipt.steps.push({
    step,
    command: redact(command),
    exitCode,
    attempt,
    timestamp: stamp,
    ...(detail !== undefined ? { detail: redact(typeof detail === 'string' ? detail : JSON.stringify(detail)) } : {}),
    ...(stateFileShape !== undefined ? { stateFileShape } : {}),
    ...(verbatim !== undefined ? { verbatim: Object.fromEntries(Object.entries(verbatim).map(([k, v]) => [k, redact(v)])) } : {}),
  });
  return attempt;
}

function finalize(receipt, ok, reason) {
  receipt.executedAt = nowIso();
  receipt.status = ok ? 'VERIFIED' : 'UNVERIFIED';
  receipt.reason = reason;
  fs.mkdirSync(path.dirname(path.resolve(receiptOut)), { recursive: true });
  fs.writeFileSync(receiptOut, `${JSON.stringify(receipt, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ drill: receipt.drill, status: receipt.status, steps: receipt.steps.length, receipt: receiptOut }, null, 2)}\n`);
  return ok ? EXIT_PASS : EXIT_VERIFY;
}

let receiptOut = null;

function runCli(nodeExe, file, cliArgs, { cwd = projectRoot, env, timeout = 120_000 } = {}) {
  const started = Date.now();
  const result = spawnSync(nodeExe, [file, ...cliArgs], { cwd, encoding: 'utf8', timeout, env });
  return {
    code: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    durationMs: Date.now() - started,
  };
}

const isAlive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const exited = (child) => new Promise((resolve) => child.once('exit', resolve));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --- drill 1: supervisor restart-original after real SIGKILL ---------------

async function drill1(nodeExe) {
  const receipt = newReceipt('sigkill-restart-original', 'supervise/restart-original:comet-authority-pilot-001');
  const probe = runCli(nodeExe, MONITOR_CLI, ['probe', '--case', 'runner-process-failure', '--json'], { timeout: 120_000 });
  let observation = null;
  try { observation = JSON.parse(probe.stdout); } catch { /* raw */ }
  const stepsOk = observation?.observedSteps?.every((s) => s.status === 'VERIFIED') ?? false;
  addStep(receipt, {
    step: 'supervisor-probe-runner-process-failure',
    command: `node tools/infra/monitor.mjs probe --case runner-process-failure --json`,
    exitCode: probe.code,
    detail: `duration ${probe.durationMs}ms; probe status ${observation?.status ?? 'unparseable'}; steps ${observation?.observedSteps?.length ?? 0}`,
    stateFileShape: {
      interface: observation?.interface ?? null,
      case: observation?.case ?? 'runner-process-failure',
      capabilityScope: observation?.capabilityScope ?? null,
      oldWriterConfirmedGone: observation?.observedSteps?.find((s) => s.step === 'inject-process-death')?.oldWriterConfirmedGone ?? null,
      restartBindsSameAuthority: observation?.observedSteps?.find((s) => s.step === 'supervised-restart')?.sameAuthorityId ?? null,
      singleLiveInstance: observation?.observedSteps?.find((s) => s.step === 'supervised-restart')?.singleLiveInstance ?? null,
      injectedDeathPids: observation?.observedSteps
        ?.filter((s) => s.pid !== undefined)
        .map((s) => ({ step: s.step, pid: s.pid, newPid: s.newPid ?? null })),
    },
    verbatim: { exitCode: probe.code, stdout: probe.stdout.slice(0, 4000), stderr: probe.stderr.slice(0, 1000) },
  });
  return finalize(receipt, probe.code === 0 && observation?.status === 'VERIFIED' && stepsOk,
    probe.code === 0 && observation?.status === 'VERIFIED' && stepsOk
      ? 'real child process, real SIGKILL, old writer confirmed gone, restart bound to the same fixed authority with exactly one live instance (I07 MonitorInfra.v1 restart-original)'
      : `probe did not verify: exit ${probe.code}, status ${observation?.status}`);
}

// --- drill 2: fencing — live old writer refused, epoch increments ----------

async function drill2(nodeExe) {
  const receipt = newReceipt('fencing-old-writer-rejection', 'backup-restore/fence:old-writer+authority-transfer');
  let ok = true;

  const refusal = runCli(nodeExe, BACKUP_CLI, ['probe', '--case', 'old-writer-denial', '--json'], { timeout: 120_000 });
  let refusalObs = null;
  try { refusalObs = JSON.parse(refusal.stdout); } catch { /* raw */ }
  const refusalStepsOk = refusalObs?.observedSteps?.every((s) => s.status === 'VERIFIED') ?? false;
  addStep(receipt, {
    step: 'live-old-writer-refuses-restore',
    command: 'node tools/infra/backup-restore.mjs probe --case old-writer-denial --json',
    exitCode: refusal.code,
    detail: `duration ${refusal.durationMs}ms; live pid refused with RESTORE_REFUSED_OLD_WRITER_LIVE, real SIGKILL then confirmed gone enables the restore`,
    stateFileShape: {
      steps: refusalObs?.observedSteps?.map((s) => ({ step: s.step, status: s.status, refusal: s.refusal ?? null, method: s.method ?? null })) ?? null,
    },
    verbatim: { exitCode: refusal.code, stdout: refusal.stdout.slice(0, 4000), stderr: refusal.stderr.slice(0, 1000) },
  });
  ok = ok && refusal.code === 0 && refusalObs?.status === 'VERIFIED' && refusalStepsOk;

  const transfer = runCli(nodeExe, BACKUP_CLI, ['probe', '--case', 'authority-transfer', '--json'], { timeout: 120_000 });
  let transferObs = null;
  try { transferObs = JSON.parse(transfer.stdout); } catch { /* raw */ }
  const transferStepsOk = transferObs?.observedSteps?.every((s) => s.status === 'VERIFIED') ?? false;
  addStep(receipt, {
    step: 'authority-transfer-epoch-monotonic',
    command: 'node tools/infra/backup-restore.mjs probe --case authority-transfer --json',
    exitCode: transfer.code,
    detail: `duration ${transfer.durationMs}ms; missing approval and masquerade fences are refused; the real fence transfers authority with epoch+1`,
    stateFileShape: {
      steps: transferObs?.observedSteps?.map((s) => ({ step: s.step, status: s.status, refusal: s.refusal ?? null })) ?? null,
    },
    verbatim: { exitCode: transfer.code, stdout: transfer.stdout.slice(0, 4000), stderr: transfer.stderr.slice(0, 1000) },
  });
  ok = ok && transfer.code === 0 && transferObs?.status === 'VERIFIED' && transferStepsOk;

  // Direct epoch monotonicity check through the real transfer command: two
  // consecutive controlled transfers on a real state file must yield strictly
  // increasing epochs (old-epoch writers are behind the fence).
  const epochRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'p53-drill2-epoch-'));
  try {
    const stateFile = path.join(epochRoot, 'run-state.json');
    const fence = (n) => {
      const file = path.join(epochRoot, `fence-${n}.json`);
      fs.writeFileSync(file, `${JSON.stringify({ oldWriterId: 'comet-authority-pilot-001', method: 'SIGKILL', confirmedGone: true, observedAt: nowIso() }, null, 2)}\n`);
      return file;
    };
    const approval = (n) => {
      const file = path.join(epochRoot, `approval-${n}.json`);
      fs.writeFileSync(file, `${JSON.stringify({ approvalId: `ap-${n}`, approvedBy: 'ops-lead', approvalRef: `ops-record-${n}`, approvedAt: nowIso(), reason: 'runner-permanently-lost' }, null, 2)}\n`);
      return file;
    };
    let state = { authorityId: 'comet-authority-pilot-001', runId: 'run-p53-drill2', epoch: 7 };
    const epochs = [];
    for (let n = 1; n <= 2; n++) {
      fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);
      const outFile = path.join(epochRoot, `transferred-${n}.json`);
      const t = runCli(nodeExe, BACKUP_CLI, ['transfer', '--state', stateFile, '--approval', approval(n), '--fence-evidence', fence(n), '--out', outFile, '--json'], { timeout: 30_000 });
      let parsed = null;
      try { parsed = JSON.parse(t.stdout); } catch { /* raw */ }
      addStep(receipt, {
        step: `controlled-transfer-${n}`,
        command: 'node tools/infra/backup-restore.mjs transfer --state <run-state> --approval <file> --fence-evidence <file> --out <file> --json',
        exitCode: t.code,
        detail: `from epoch ${state.epoch} to ${parsed?.newAuthority?.epoch ?? 'n/a'}`,
        stateFileShape: { from: parsed?.from ?? null, newAuthority: parsed?.newAuthority ?? null },
        verbatim: { exitCode: t.code, stdout: t.stdout.slice(0, 2000), stderr: t.stderr.slice(0, 500) },
      });
      if (t.code !== 0 || !parsed?.newAuthority) { ok = false; break; }
      epochs.push(parsed.newAuthority.epoch);
      state = JSON.parse(fs.readFileSync(outFile, 'utf8'));
    }
    const monotonic = epochs.length === 2 && epochs[1] > epochs[0] && epochs[0] > 7;
    addStep(receipt, {
      step: 'epoch-monotonic-across-transfers',
      command: '(derived) epochs of consecutive controlled transfers',
      exitCode: monotonic ? 0 : 2,
      detail: `epochs [${epochs.join(', ')}] from base 7 — strictly increasing`,
      stateFileShape: { epochs, baseEpoch: 7 },
    });
    ok = ok && monotonic;
  } finally {
    fs.rmSync(epochRoot, { recursive: true, force: true });
  }

  return finalize(receipt, ok, ok
    ? 'process-level fencing proven with real pids: a live old writer is refused, real SIGKILL plus gone-confirmation enables restore/transfer, and the authority epoch increases strictly with every controlled transfer (I08 BackupInfra.v1 / AuthorityTransfer.v1)'
    : 'one or more fencing steps did not verify; see steps');
}

// --- drill 3: Comet Classic lease contention + recovery (0.5.0 surface) ------
//
// Revision 2026-10-26-comet-050-adoption-v1: the 0.4.5 managed classic face
// (`state init <change> full --managed-delivery` + `state dispatch-gate`) is
// RETIRED in the pinned 0.5.0 build — it refuses with a usage error, and the
// gates moved to the composition runtime (`comet runtime dispatch`). The
// classic state face that still exists is `comet state init/set/get`; its
// per-change state lock lives under the workspace runtime root
// (<HOME>/.comet/workspaces/<id>/runtime/classic-changes/<uuid>/.comet-state.lock),
// and the legacy change-dir `.comet-state.lock` location is now a migration
// FENCE. This drill drives the real 0.5.0 face end to end:
//   init -> state init -> baseline locked write -> (a) EEXIST second open of
//   the REAL lock while a live holder owns it -> (b) real CLI write refused
//   (lock timeout) while the lease is held -> (c) real SIGKILL of the holder:
//   the next real CLI write recovers the lease and re-applies the same write
//   idempotently -> (d) a planted real-schema transaction journal AT THE
//   RUNTIME ROOT is recovered on the next lock acquisition (a journal left in
//   the legacy change dir is conservatively refused by the migration fence —
//   recorded as an honest refusal step) -> (e) a foreign-host lock owner is
//   never recovered.

async function drill3(nodeExe) {
  const build = resolveCometBuild();
  if (!build.present) {
    const receipt = newReceipt('lease-contention', 'comet-classic/lease:.comet-state.lock');
    return finalize(receipt, false, 'the patched Comet build is not present under .sdd — run tools/comet/prepare-source.mjs && tools/comet/build.mjs first');
  }
  const receipt = newReceipt('lease-contention', `comet-classic/lease:runtime-root/.comet-state.lock:${build.fingerprint.slice(0, 12)}`);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'p53-drill3-'));
  const project = path.join(scratch, 'managed');
  const fakeHome = path.join(scratch, 'home');
  const stubs = path.join(scratch, 'stubs');
  const change = 'p53-lease-drill';
  fs.mkdirSync(fakeHome, { recursive: true });
  fs.mkdirSync(stubs, { recursive: true });
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(path.join(stubs, 'openspec'), `#!/bin/sh
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
  for (const name of ['npm', 'npx']) fs.writeFileSync(path.join(stubs, name), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const childEnv = (extra = {}) => {
    const { NODE_TEST_CONTEXT: _stripped, ...inherited } = process.env;
    return { ...inherited, HOME: fakeHome, COMET_PROJECT_ROOT: project, PATH: `${stubs}:${process.env.PATH ?? ''}`, ...extra };
  };
  const comet = (cliArgs, opts = {}) => {
    const started = Date.now();
    const result = spawnSync(nodeExe, [build.entrypoint, ...cliArgs], { cwd: opts.root ?? project, encoding: 'utf8', timeout: opts.timeout ?? 120_000, env: childEnv(opts.env) });
    return { code: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '', durationMs: Date.now() - started };
  };
  let ok = true;
  try {
    // World: real init + a real classic change with one writable field.
    const init = comet(['init', project, '--yes', '--scope', 'project', '--workflow', 'classic', '--platform', 'claude', '--codegraph', 'skip', '--language', 'en'], { timeout: 300_000 });
    addStep(receipt, { step: 'comet-init-scratch-project', command: 'comet init <scratch> --yes --scope project --workflow classic --platform claude --codegraph skip --language en', exitCode: init.code, detail: `duration ${init.durationMs}ms (pinned node ${path.basename(nodeExe)})` });
    ok = ok && init.code === 0;
    if (!ok) return finalize(receipt, false, 'comet init failed — scratch world not established');

    const dir = path.join(project, 'docs/openspec/changes', change);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'proposal.md'), '# Proposal\n\nLease drill.\n');
    fs.writeFileSync(path.join(dir, 'tasks.md'), '# Tasks\n\n- [ ] 1.1 Implement probe product code\n');
    fs.writeFileSync(path.join(dir, 'design.md'), '# Design\n\nLease drill design v1.\n');
    fs.writeFileSync(path.join(dir, 'design2.md'), '# Design\n\nLease drill design v2.\n');
    const rel = `docs/openspec/changes/${change}`;
    const designDoc = `${rel}/design.md`;
    const designDoc2 = `${rel}/design2.md`;

    const sinit = comet(['state', 'init', change, 'full', '--json']);
    addStep(receipt, { step: 'state-init-classic-change', command: `comet state init ${change} full --json  # 0.5.0 face: no --managed-delivery (managed gates moved to the composition runtime)`, exitCode: sinit.code, detail: `duration ${sinit.durationMs}ms` });
    ok = ok && sinit.code === 0;
    if (!ok) return finalize(receipt, false, 'comet state init failed — no real classic change to contend on');

    const baseline = comet(['state', 'set', change, 'design_doc', designDoc, '--json']);
    const baselineGet = comet(['state', 'get', change, 'design_doc', '--json']);
    const baselineApplied = baseline.code === 0 && baselineGet.code === 0 && (baselineGet.stdout.includes(designDoc));
    addStep(receipt, {
      step: 'baseline-locked-write',
      command: `comet state set ${change} design_doc ${designDoc} --json`,
      exitCode: baseline.code,
      detail: `duration ${baseline.durationMs}ms; readback ${baselineApplied ? designDoc : 'mismatch'}`,
      stateFileShape: { designDoc: baselineApplied ? designDoc : null },
    });
    ok = ok && baselineApplied;

    // Resolve the REAL per-change runtime lock through the built dist module
    // (the same resolver the store uses): <runtimeRoot>/.comet-state.lock.
    const resolverScript = path.join(scratch, 'resolve-runtime.mjs');
    fs.writeFileSync(resolverScript, `import { resolveClassicRunDirectory } from '${pathToFileURL(path.join(build.dist, 'domains/comet-classic/classic-runtime-paths.js')).href}';
const changeDir = process.argv[2];
const projectRoot = process.argv[3];
process.stdout.write(String(await resolveClassicRunDirectory(changeDir, projectRoot)));
`);
    const resolved = spawnSync(nodeExe, [resolverScript, dir, project], { cwd: project, encoding: 'utf8', timeout: 60_000, env: childEnv() });
    const runtimeRoot = (resolved.stdout ?? '').trim().split('\n').pop() ?? '';
    const lockFile = path.join(runtimeRoot, '.comet-state.lock');
    // macOS: /var is a symlink of /private/var — compare against the realpath
    const homeReal = fs.realpathSync(fakeHome);
    const runtimeRootIsolated = runtimeRoot.startsWith(homeReal);
    addStep(receipt, {
      step: 'resolve-runtime-lock-root',
      command: 'node <drill-child> resolveClassicRunDirectory(<change>, <project>)  # real dist resolver',
      exitCode: resolved.status,
      detail: `runtime root resolved under the isolated HOME workspace runtime; legacy change-dir lock location is a migration fence (dir present: ${fs.existsSync(path.join(dir, '.comet-state.lock'))})`,
      stateFileShape: { runtimeRootIsolated, legacyLockIsFence: fs.existsSync(path.join(dir, '.comet-state.lock')) },
    });
    ok = ok && resolved.status === 0 && runtimeRootIsolated;
    if (!ok) return finalize(receipt, false, 'could not resolve the real per-change runtime lock root');

    // Holder: a real child holding the REAL runtime lock via the built dist module.
    const holderScript = path.join(scratch, 'holder.mjs');
    fs.writeFileSync(holderScript, `import { withRecoverableFileLock } from '${pathToFileURL(path.join(build.dist, 'platform/fs/plugin-store.js')).href}';
const lockPath = process.argv[2];
const holdMs = Number(process.argv[3]);
await withRecoverableFileLock(lockPath, async () => {
  process.stdout.write('HELD ' + process.pid + '\\n');
  await new Promise((resolve) => setTimeout(resolve, holdMs));
});
process.stdout.write('RELEASED\\n');
`);
    const spawnHolder = (holdMs) => {
      const child = spawn(nodeExe, [holderScript, lockFile, String(holdMs)], { cwd: project, env: childEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout.on('data', () => {});
      return child;
    };
    const waitLock = async (deadlineMs) => {
      const end = Date.now() + deadlineMs;
      while (Date.now() < end) {
        if (fs.existsSync(lockFile)) return true;
        await sleep(50);
      }
      return fs.existsSync(lockFile);
    };

    // (a) EEXIST: a second exclusive open of the REAL lock file is rejected
    //     while the live holder owns the lease.
    const holderA = spawnHolder(45_000); // longer than the CLI's 30s lock timeout: the second writer must be REFUSED, not merely delayed
    const lockAppeared = await waitLock(5000);
    const ownerBefore = lockAppeared ? JSON.parse(fs.readFileSync(lockFile, 'utf8')) : null;
    const eexistScript = path.join(scratch, 'eexist.mjs');
    fs.writeFileSync(eexistScript, `import { open as openExcl } from 'node:fs/promises';
try { const h = await openExcl(process.argv[2], 'wx'); await h.close(); console.log('ACQUIRED'); }
catch (error) { console.log(error.code); process.exit(3); }
`);
    const eexist = await new Promise((resolve) => {
      const child = spawn(nodeExe, [eexistScript, lockFile], { cwd: project, env: childEnv() });
      let out = '';
      child.stdout.on('data', (c) => { out += c; });
      child.on('close', (code) => resolve({ code, out: out.trim() }));
    });
    addStep(receipt, {
      step: 'second-exclusive-open-rejected-EEXIST',
      command: 'node <drill-child> fs.open(<runtime-root>/.comet-state.lock, wx)  # real dist sibling of the CLI lock path',
      exitCode: eexist.code,
      detail: `open code ${eexist.out}; live holder pid ${holderA.pid}`,
      stateFileShape: { lockOwner: ownerBefore, holderPid: holderA.pid, holderAliveWhenProbed: isAlive(holderA.pid) },
    });
    ok = ok && lockAppeared && eexist.code === 3 && eexist.out === 'EEXIST';

    // (b) Real CLI double-open: a locked state write while the holder owns the
    //     lease — the classic store refuses to open a second writer and times out.
    const contended = comet(['state', 'set', change, 'design_doc', designDoc, '--json'], { timeout: 60_000 });
    const refused = contended.code !== 0 && /Timed out waiting for file lock/i.test(`${contended.stderr}\n${contended.stdout}`);
    addStep(receipt, {
      step: 'cli-double-open-rejected-while-lease-held',
      command: `comet state set ${change} design_doc <same-value> --json  # while a live holder owns the runtime lock`,
      exitCode: contended.code,
      detail: `duration ${contended.durationMs}ms; refusal ${refused ? 'Timed out waiting for file lock' : 'unexpected'}`,
      stateFileShape: { lockOwnerAfterTimeout: fs.existsSync(lockFile) ? JSON.parse(fs.readFileSync(lockFile, 'utf8')) : null },
      verbatim: { exitCode: contended.code, stderr: contended.stderr.slice(0, 800), stdout: contended.stdout.slice(0, 400) },
    });
    ok = ok && refused;
    holderA.kill('SIGKILL');
    await exited(holderA);
    await sleep(300);

    // (c) SIGKILL of the holder mid-lease: the next real CLI command recovers
    //     the lease and re-applies the SAME write idempotently.
    const holderB = spawnHolder(20000);
    const lockAgain = await waitLock(5000);
    const contender = spawn(nodeExe, [build.entrypoint, 'state', 'set', change, 'design_doc', designDoc2, '--json'], { cwd: project, env: childEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    let contenderOut = '';
    contender.stdout.on('data', (c) => { contenderOut += c; });
    const contenderDone = new Promise((resolve) => contender.once('close', resolve));
    await sleep(1500);
    const holderWasAlive = isAlive(holderB.pid);
    holderB.kill('SIGKILL');
    await exited(holderB);
    const holderGone = await (async () => { for (let i = 0; i < 100; i++) { if (!isAlive(holderB.pid)) return true; await sleep(50); } return false; })();
    const contenderCode = await contenderDone;
    const readback = comet(['state', 'get', change, 'design_doc', '--json']);
    const readbackApplied = readback.code === 0 && readback.stdout.includes(designDoc2);
    const resettle = comet(['state', 'set', change, 'design_doc', designDoc2, '--json']);
    const idempotent = contenderCode === 0 && readbackApplied && resettle.code === 0;
    addStep(receipt, {
      step: 'sigkill-holder-lease-recovered-idempotent-resume',
      command: `comet state set ${change} design_doc <new-value> --json  # started under the live lease, holder SIGKILLed at ~1.5s`,
      exitCode: contenderCode,
      detail: `holder ${holderB.pid} alive at kill: ${holderWasAlive}, confirmed gone: ${holderGone}; readback ${readbackApplied ? 'new value' : 'mismatch'}; same-value re-apply exit ${resettle.code}`,
      stateFileShape: {
        readbackDesignDoc: readbackApplied ? designDoc2 : null,
        sameValueReapplyExit: resettle.code,
        lockRecovered: !fs.existsSync(lockFile),
      },
      verbatim: { exitCode: contenderCode, stdout: contenderOut.slice(0, 600) },
    });
    ok = ok && lockAgain && holderWasAlive && holderGone && idempotent;

    // (d1) Honest refusal: a journal left at the LEGACY change-dir location is
    //      NOT silently recovered by 0.5.0 — the workspace-runtime migration
    //      fence conservatively refuses writes until the old runtime recovers.
    const yamlFile = path.join(dir, '.comet.yaml');
    const yamlBytes = fs.readFileSync(yamlFile, 'utf8');
    const legacyJournal = path.join(dir, '.comet-state-transaction.json');
    fs.writeFileSync(legacyJournal, `${JSON.stringify({
      schema: 'comet.classic.state-transaction.v1',
      beforeYaml: yamlBytes,
      afterYaml: yamlBytes,
      beforeRun: null,
      afterRun: null,
    }, null, 2)}\n`);
    const legacyRefused = comet(['state', 'set', change, 'design_doc', designDoc2, '--json'], { timeout: 60_000 });
    const legacyRefusalHonest = legacyRefused.code !== 0 && fs.existsSync(legacyJournal) && fs.readFileSync(yamlFile, 'utf8') === yamlBytes;
    addStep(receipt, {
      step: 'legacy-dir-journal-conservative-refusal',
      command: `comet state set ${change} design_doc <same-value> --json  # with a real-schema journal planted at the LEGACY change-dir location`,
      exitCode: legacyRefused.code,
      detail: `0.5.0 migration fence refuses instead of auto-recovering a legacy-location journal; journal preserved: ${fs.existsSync(legacyJournal)}, yaml untouched`,
      stateFileShape: { journalPreserved: fs.existsSync(legacyJournal), yamlIntact: fs.readFileSync(yamlFile, 'utf8') === yamlBytes },
      verbatim: { exitCode: legacyRefused.code, stdout: legacyRefused.stdout.slice(0, 500) },
    });
    ok = ok && legacyRefusalHonest;
    fs.rmSync(legacyJournal, { force: true });

    // (d2) Transaction journal recovery at the REAL runtime root: a
    //      real-schema comet.classic.state-transaction.v1 record (beforeYaml
    //      === current bytes) planted as an interrupted write; the next real
    //      CLI lock acquisition recovers it — journal consumed, state intact
    //      (A11: resume from the authoritative state, no re-execution).
    const journalFile = path.join(runtimeRoot, '.comet-state-transaction.json');
    const yamlBefore = fs.readFileSync(yamlFile, 'utf8');
    fs.writeFileSync(journalFile, `${JSON.stringify({
      schema: 'comet.classic.state-transaction.v1',
      stateFile: '.comet.yaml',
      beforeYaml: yamlBefore,
      afterYaml: yamlBefore,
      beforeRun: null,
      afterRun: null,
    }, null, 2)}\n`);
    const afterRecovery = comet(['state', 'set', change, 'design_doc', designDoc2, '--json'], { timeout: 60_000 });
    const journalConsumed = !fs.existsSync(journalFile);
    const yamlIntact = fs.readFileSync(yamlFile, 'utf8') === yamlBefore;
    addStep(receipt, {
      step: 'interrupted-transaction-journal-recovered-on-next-lock',
      command: 'comet state set <change> design_doc <same-value> --json  # after planting a real-schema interrupted journal at the runtime root',
      exitCode: afterRecovery.code,
      detail: `journal consumed: ${journalConsumed}; yaml unchanged: ${yamlIntact}; recovery ran inside the real state lock acquisition`,
      stateFileShape: {
        transactionSchema: 'comet.classic.state-transaction.v1',
        journalConsumed,
        yamlIntact,
      },
    });
    ok = ok && afterRecovery.code === 0 && journalConsumed && yamlIntact;

    // (e) Cross-host boundary: a foreign-host lock owner is NEVER recovered —
    //     the real lock module refuses and times out (recorded as the honest
    //     single-host scope of this drill; multi-host recovery is gated by
    //     CROSS_MACHINE_SCOPE, see services/delivery-control/enablement.json, DeliveryControl.EnablementGate.v2).
    const foreignRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'p53-drill3-foreign-'));
    try {
      const foreignLock = path.join(foreignRoot, '.comet-state.lock');
      fs.writeFileSync(foreignLock, `${JSON.stringify({ pid: process.pid, nonce: 'foreign', createdAt: Date.now(), hostname: 'definitely-not-this-host' }, null, 2)}\n`);
      const foreignScript = path.join(foreignRoot, 'foreign.mjs');
      fs.writeFileSync(foreignScript, `import { withRecoverableFileLock } from '${pathToFileURL(path.join(build.dist, 'platform/fs/plugin-store.js')).href}';
try {
  await withRecoverableFileLock(process.argv[2], async () => 'acquired', { timeoutMs: 1500, retryMs: 100 });
  console.log('ACQUIRED');
} catch (error) {
  console.log(String(error?.message ?? error).split('\\n')[0]);
  process.exit(4);
}
`);
      const foreign = await new Promise((resolve) => {
        const child = spawn(nodeExe, [foreignScript, foreignLock], { cwd: project, env: childEnv() });
        let out = '';
        child.stdout.on('data', (c) => { out += c; });
        child.on('close', (code) => resolve({ code, out: out.trim() }));
      });
      const refusedForeign = foreign.code === 4 && /Timed out waiting for file lock/.test(foreign.out);
      addStep(receipt, {
        step: 'foreign-host-lock-owner-never-recovered',
        command: 'node <drill-child> withRecoverableFileLock(<foreign-host lock>, { timeoutMs: 1500 })  # real dist lock module',
        exitCode: foreign.code,
        detail: `owner hostname "definitely-not-this-host" with a live pid: the real module refuses recovery and times out — the cross-machine boundary stays closed locally (CROSS_MACHINE_SCOPE_NOT_ENABLED)`,
        stateFileShape: { foreignOwnerHostname: 'definitely-not-this-host', refused: refusedForeign },
      });
      ok = ok && refusedForeign;
    } finally {
      fs.rmSync(foreignRoot, { recursive: true, force: true });
    }

    return finalize(receipt, ok, ok
      ? 'the real 0.5.0 per-change runtime lock: second exclusive open rejected (EEXIST), real CLI write refused while the lease is held, real SIGKILL of the holder lets the next real CLI write recover the lease and re-apply idempotently, a legacy-location journal is conservatively refused while a runtime-root journal is recovered on the next lock acquisition, and a foreign-host lock owner is never recovered'
      : 'one or more lease steps did not verify; see steps');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

// --- main ---------------------------------------------------------------------

const parsed = args();
if (parsed.error) {
  process.stderr.write(`${parsed.error}\nusage: node run-drills.mjs --drill <1|2|3> --out <receipt.json> [--node <node>]\n`);
  process.exit(EXIT_INPUT);
}
receiptOut = path.resolve(parsed.out);
const nodeExe = resolveNode(parsed.node);
const drill = parsed.drill === '1' ? drill1 : parsed.drill === '2' ? drill2 : drill3;
process.exit(await drill(nodeExe));

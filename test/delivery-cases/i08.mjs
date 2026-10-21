// I08 delivery case: backup/restore consistency, R10 A pending-cleanup retention,
// old-writer fencing and single-authority transfer — driving the REAL
// tools/infra/backup-restore.mjs entry as a subprocess (house convention, cf.
// test/delivery-cases/3_3.mjs), with isolated HOME/PATH/TMPDIR and fixtures the
// suite authors itself.
//
// Coverage (infrastructure-plan.md I08 + R10 恢复关闭门; every journey runs the
// real CLI and verifies byte-level oracles from disk — 真实 sha256 对真实字节,
// zero mock):
//   J1  Backup.v1 + Restore.v1 consistency journey: a real directory-form
//       workspace is backed up (per-file sha256 manifest), independently
//       verified from the suite, restored into a quarantine after real
//       process-level old-writer fencing, byte-compared, reconciled (ACL as
//       data only, offline member kept out, stale attempt excluded) and
//       released only after the same-operation readback; a single corrupted
//       backup byte refuses the restore and releases nothing.
//   J2  Retention.v1 (R10 A): pending Outline publish / unknown remote result /
//       sole payload / open transaction / pending knowledge closeout deny
//       cleanup with the explicit obligation list; disk pressure only warns
//       and the workspace stays byte-identical; only verified completion — or
//       a separately approved migration with proven restore — moves the gate.
//   J3  Old-writer denial: a restore with a LIVE old writer (real child pid in
//       the fence evidence) is refused; after a real SIGKILL and
//       gone-confirmation the same restore proceeds; the dead writer's
//       superseded-epoch receipt never comes back as current state.
//   J4  Single-authority transfer: the original runner holding the authority
//       is SIGKILLed (permanently lost — no supervised restart), transfer
//       without approval is refused, shared-directory masquerade fencing is
//       refused, and the approved transfer registers a NEW authority (epoch
//       bump, same run) with a single-live-authority proof.
//
// Cross-machine / real-service restore is honestly UNVERIFIED in every
// receipt (capabilityScope LOCAL_DIRECTORY_FORM); the local directory-form
// Registry/backup target is the real thing under test. Fixtures live under
// os.tmpdir(); no live configuration or change-control file is written.
// Zero new npm dependencies.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const cli = path.join(projectRoot, 'tools', 'infra', 'backup-restore.mjs');
const RUN_TIMEOUT_MS = 180_000;
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const digestFile = (file) => sha256(fs.readFileSync(file));

// 隔离子进程环境：真实入口不得依赖调用方 HOME/PATH（repo convention：剥 NODE_TEST_CONTEXT）。
function isolatedEnv(tmpHome, tmpTmp) {
  const env = { ...process.env, HOME: tmpHome, PATH: '/usr/bin:/bin', TMPDIR: tmpTmp };
  delete env.NODE_TEST_CONTEXT;
  return env;
}

function makeWorkdir(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `sdd-i08-${label}-`));
  fs.mkdirSync(path.join(root, 'home'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tmp'), { recursive: true });
  return root;
}

// --- fixture workspace（真实字节；形状 = Backup.v1 的一致性范围）---------------------

function makeWorkspace(dir, {
  authorityId = 'comet-authority-i08-j1',
  epoch = 5,
  runId = 'run-i08-journey',
  openTransaction = false,
  pendingKnowledge = false,
  unknownRemote = false,
  solePayload = false,
  supersededReceipt = false,
} = {}) {
  const workspace = path.join(dir, 'workspace');
  for (const section of ['operations', 'transactions', 'approvals', 'knowledge', 'db/pages', 'objects', 'config', 'permissions']) {
    fs.mkdirSync(path.join(workspace, section), { recursive: true });
  }
  const files = {};
  const put = (rel, value) => {
    const file = path.join(workspace, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const bytes = typeof value === 'string' || Buffer.isBuffer(value) ? Buffer.from(value) : Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.writeFileSync(file, bytes);
    files[rel] = bytes;
  };
  put('run-state.json', { authorityId, epoch, runId, updatedAt: new Date().toISOString() });
  put('operations/op-outline-publish.dispatch.json', { opId: 'op-outline-publish', kind: 'outline-publish', attempt: 2, epoch, remote: true });
  if (!unknownRemote) put('operations/op-outline-publish.receipt.json', { opId: 'op-outline-publish', status: 'ok', attempt: 2, epoch });
  if (supersededReceipt) put('operations/op-outline-publish.receipt.stale.json', { opId: 'op-outline-publish', status: 'ok', attempt: 1, epoch: epoch - 1 });
  put('transactions/txn-core.json', { txnId: 'txn-core', state: openTransaction ? 'open' : 'committed', watermark: openTransaction ? null : '2026-10-21T10:00:00.000Z' });
  put('approvals/payload-brief.json', { payloadId: 'payload-brief', version: 'v12', soleCopy: solePayload });
  put('knowledge/closeout-r06.json', { itemId: 'closeout-r06', state: pendingKnowledge ? 'pending' : 'closed' });
  put('db/watermark.json', { pointInTime: '2026-10-21T10:00:00.000Z' });
  put('db/pages/page-alpha.page', Buffer.from(Array.from({ length: 96 }, (_, i) => (i * 13 + 5) & 0xff)));
  put('objects/watermark.json', { pointInTime: '2026-10-21T10:00:00.000Z' });
  put('objects/attachment.bin', Buffer.from(Array.from({ length: 200 }, (_, i) => (i * 31 + 9) & 0xff)));
  put('config/refs.json', { configRefs: ['outline-instance@UNVERIFIED', 'git-remote@UNVERIFIED', 'object-store@UNVERIFIED'] });
  put('permissions/acl.json', {
    entries: [{ grantId: 'grant-brief-read', principal: 'svc:sdd-harness-pilot/publisher', resource: 'brief-set', grantedAtEpoch: epoch - 2 }],
    note: 'point-in-time ACL snapshot; data only, never replayed on restore',
  });
  put('permissions/members.json', {
    members: [
      { principal: 'svc:sdd-harness-pilot/publisher', status: 'active' },
      { principal: 'user:former-member', status: 'offline' },
    ],
  });
  return { workspace, files };
}

const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  return file;
};

const fenceEvidence = (dir, overrides = {}) => writeJson(path.join(dir, 'fence-evidence.json'), {
  oldWriterId: overrides.oldWriterId ?? 'comet-authority-i08-j1',
  method: overrides.method ?? 'SIGKILL',
  confirmedGone: overrides.confirmedGone ?? true,
  observedAt: overrides.observedAt ?? new Date().toISOString(),
  ...(overrides.pid !== undefined ? { pid: overrides.pid } : {}),
});

const isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const waitUntil = (condition, timeoutMs = 5000) => new Promise((resolve) => {
  const deadline = Date.now() + timeoutMs;
  const tick = () => {
    if (condition() || Date.now() >= deadline) resolve(condition());
    else setTimeout(tick, 25);
  };
  tick();
});

const spawnHolder = () => spawn(process.execPath, ['-e', 'setInterval(() => {}, 250);'], { stdio: 'ignore' });

// 真实入口子进程执行（隔离 HOME/PATH/TMPDIR），stdout 必须是结构化 JSON 回执。
function runRealCli(workdir, args) {
  const run = spawnSync(process.execPath, [cli, ...args], {
    cwd: projectRoot,
    encoding: 'utf8',
    timeout: RUN_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
    env: isolatedEnv(path.join(workdir, 'home'), path.join(workdir, 'tmp')),
  });
  let receipt = null;
  if (run.stdout.trim().startsWith('{')) {
    receipt = JSON.parse(run.stdout);
  }
  return { run, receipt };
}

// --- J1: Backup.v1 + Restore.v1 一致性旅程 ------------------------------------------

test('J1: backup captures a consistent byte-level manifest, restore releases a quarantined copy only after fencing + same-operation readback, and one corrupted byte refuses everything', async () => {
  const workdir = makeWorkdir('j1-consistency');
  const { workspace, files } = makeWorkspace(workdir, { supersededReceipt: true });
  const target = path.join(workdir, 'backup-target');
  fs.mkdirSync(target, { recursive: true });

  // 1) 真实备份：目录形态工作区 → 独立备份目标，逐文件 sha256 manifest。
  const backup = runRealCli(workdir, ['backup', '--workspace', workspace, '--target', target, '--json']);
  assert.equal(backup.run.status, 0, `backup must exit 0: ${backup.run.stderr}`);
  assert.equal(backup.receipt.interface, 'Backup.v1');
  assert.equal(backup.receipt.status, 'VERIFIED');
  const backupId = backup.receipt.backupId;
  const backupDir = path.join(target, backupId);

  // 独立复核 manifest：套件自己算 sha256 对真实字节，绝不信任 CLI 的自述。
  const manifest = JSON.parse(fs.readFileSync(path.join(backupDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.source.runId, 'run-i08-journey');
  assert.equal(manifest.source.epoch, 5);
  for (const [rel, bytes] of Object.entries(files)) {
    const entry = manifest.files.find((item) => item.path === rel);
    assert.ok(entry, `manifest must list ${rel}`);
    assert.equal(entry.sha256, sha256(bytes), `${rel}: manifest digest must equal the source bytes`);
    assert.equal(digestFile(path.join(backupDir, 'files', rel)), entry.sha256, `${rel}: the backup target must hold the same real bytes`);
  }
  assert.ok(manifest.cacheRefs.every((ref) => ref.restored === false), 'revoked code-source cache stays out of the backup');

  // 2) 旧 writer 真实存活：恢复先拒绝（真实 pid 在 fence 证据里也骗不过 liveness 检查）。
  const holder = spawnHolder();
  try {
    assert.equal(await waitUntil(() => isAlive(holder.pid)), true, 'the old writer must really be alive');
    const quarantine = path.join(workdir, 'quarantine');
    const liveFence = fenceEvidence(workdir, { pid: holder.pid, method: 'claimed' });
    const refused = runRealCli(workdir, ['restore', '--backup', backupDir, '--quarantine', quarantine, '--fence-evidence', liveFence, '--json']);
    assert.equal(refused.run.status, 2, 'a live old writer must refuse the restore');
    assert.equal(refused.receipt.status, 'REFUSED');
    assert.ok(refused.receipt.refusals.some((refusal) => refusal.code === 'RESTORE_REFUSED_OLD_WRITER_LIVE'));
    assert.equal(fs.existsSync(path.join(quarantine, 'release-record.json')), false, 'no release while the old writer lives');

    // 3) 真实 SIGKILL 注入 + 终止确认（P3_3 手法）→ 同一恢复现在启用。
    holder.kill('SIGKILL');
    assert.equal(await waitUntil(() => !isAlive(holder.pid)), true, 'the old writer must be confirmed gone');
    const realFence = fenceEvidence(workdir, { pid: holder.pid, observedAt: new Date().toISOString() });
    const restored = runRealCli(workdir, ['restore', '--backup', backupDir, '--quarantine', quarantine, '--fence-evidence', realFence, '--json']);
    assert.equal(restored.run.status, 0, `restore must exit 0: ${restored.run.stderr}`);
    assert.equal(restored.receipt.status, 'RELEASED');
    assert.equal(restored.receipt.capabilityScope, 'LOCAL_DIRECTORY_FORM');
    assert.equal(restored.receipt.realServiceRestore.status, 'UNVERIFIED', 'cross-machine/real-service restore stays honestly UNVERIFIED');

    // 4) 字节级读回：恢复区与原工作区逐文件相等（Buffer.compare，非 digest 自述）。
    for (const [rel, bytes] of Object.entries(files)) {
      const restoredFile = path.join(quarantine, rel);
      assert.equal(fs.existsSync(restoredFile), true, `${rel} must be restored`);
      assert.equal(Buffer.compare(fs.readFileSync(restoredFile), bytes), 0, `${rel} must be byte-identical`);
    }
    assert.equal(restored.receipt.sameOperation.verified, true, 'the same operation identity must be verified before release');
    assert.equal(restored.receipt.sameOperation.runId, 'run-i08-journey');

    // 5) 诚实对账：ACL 只是数据（不回放）、离组成员不回填、旧 attempt 回执被排除。
    const reconciliation = JSON.parse(fs.readFileSync(path.join(quarantine, 'restore-reconciliation.json'), 'utf8'));
    assert.equal(reconciliation.reAuthenticateFromCurrentAuthority, true);
    assert.ok(reconciliation.aclEntries.every((acl) => acl.applied === false), 'restored ACL is data only, never replayed');
    assert.ok(reconciliation.members.filter((member) => member.status === 'offline').every((member) => member.readmitted === false), 'offline members stay out');
    assert.ok(reconciliation.excludedSuperseded.some((item) => item.path === 'operations/op-outline-publish.receipt.stale.json'), 'the dead attempt never comes back as current');
    assert.equal(fs.existsSync(path.join(quarantine, 'cache')), false, 'revoked code-source cache is not restored');

    const release = JSON.parse(fs.readFileSync(path.join(quarantine, 'release-record.json'), 'utf8'));
    assert.equal(release.publishFrozen, true, 'publishing stays frozen through the quarantined restore');
    assert.equal(release.singleWriter, true);
  } finally {
    holder.kill('SIGKILL');
  }

  // 6) 破坏负例：备份目标一个真实字节被翻转 → 恢复拒绝且什么都不释放。
  const corruptDir = path.join(workdir, 'corrupted-backup');
  fs.cpSync(backupDir, corruptDir, { recursive: true });
  const victim = path.join(corruptDir, 'files', 'objects', 'attachment.bin');
  const bytes = fs.readFileSync(victim);
  bytes[7] = (bytes[7] + 1) & 0xff;
  fs.writeFileSync(victim, bytes);
  const corruptQuarantine = path.join(workdir, 'corrupt-quarantine');
  const corrupt = runRealCli(workdir, ['restore', '--backup', corruptDir, '--quarantine', corruptQuarantine, '--fence-evidence', fenceEvidence(workdir), '--json']);
  assert.equal(corrupt.run.status, 2, 'a corrupted backup byte must refuse the restore');
  assert.ok(corrupt.receipt.refusals.some((refusal) => refusal.code === 'RESTORE_BACKUP_INVALID'));
  assert.equal(fs.existsSync(path.join(corruptQuarantine, 'release-record.json')), false, 'a refused restore releases nothing');
});

// --- J2: Retention.v1（R10 A）旅程 ---------------------------------------------------

test('J2: R10 A — pending obligations deny cleanup under disk pressure (warn only, bytes untouched); verified completion or approved migration+proof moves the gate', () => {
  const workdir = makeWorkdir('j2-retention');
  const { workspace, files } = makeWorkspace(workdir, {
    openTransaction: true,
    pendingKnowledge: true,
    unknownRemote: true,
    solePayload: true,
  });
  const digestsBefore = Object.fromEntries(Object.entries(files).map(([rel, bytes]) => [rel, sha256(bytes)]));

  // pending + 磁盘压力 → DENIED；只告警，绝不静默清理。
  const pressure = writeJson(path.join(workdir, 'pressure.json'), { observedBytes: 900_000_000_000, thresholdBytes: 500_000_000_000, source: 'volume probe' });
  const denied = runRealCli(workdir, ['retention', '--workspace', workspace, '--disk-pressure', pressure, '--json']);
  assert.equal(denied.run.status, 2, 'pending obligations must deny cleanup');
  assert.equal(denied.receipt.cleanup, 'DENIED');
  const kinds = denied.receipt.pending.map((item) => item.kind);
  for (const kind of ['pending-outline-publish', 'unknown-remote-result', 'sole-payload-in-workspace', 'open-transaction', 'pending-knowledge-closeout']) {
    assert.ok(kinds.includes(kind), `the explicit obligation list must name ${kind}`);
  }
  assert.equal(denied.receipt.diskPressure.warned, true);
  assert.equal(denied.receipt.diskPressure.cleanup, false, 'disk pressure never triggers cleanup');
  assert.equal(denied.receipt.r10.ruleA, 'RETAIN_SOLE_WORKSPACE');
  for (const [rel] of Object.entries(files)) {
    assert.equal(digestFile(path.join(workspace, rel)), digestsBefore[rel], `${rel} must survive untouched after the denial`);
  }

  // 义务真实闭合（套件作为义务作者闭合它们，不是参数调门）→ verified-completed。
  fs.writeFileSync(path.join(workspace, 'transactions', 'txn-core.json'), `${JSON.stringify({ txnId: 'txn-core', state: 'committed', watermark: '2026-10-21T10:05:00.000Z' }, null, 2)}\n`);
  fs.writeFileSync(path.join(workspace, 'operations', 'op-outline-publish.receipt.json'), `${JSON.stringify({ opId: 'op-outline-publish', status: 'ok', attempt: 2, epoch: 5 }, null, 2)}\n`);
  fs.writeFileSync(path.join(workspace, 'knowledge', 'closeout-r06.json'), `${JSON.stringify({ itemId: 'closeout-r06', state: 'closed' }, null, 2)}\n`);
  // 唯一副本义务：套件把第二副本落到独立目标后如实更新 payload 记录（不再是 sole）。
  fs.mkdirSync(path.join(workdir, 'replica'), { recursive: true });
  fs.writeFileSync(path.join(workdir, 'replica', 'payload-brief.json'), `${JSON.stringify({ payloadId: 'payload-brief', version: 'v12' }, null, 2)}\n`);
  fs.writeFileSync(path.join(workspace, 'approvals', 'payload-brief.json'), `${JSON.stringify({ payloadId: 'payload-brief', version: 'v12', soleCopy: false, replicatedTo: 'replica/payload-brief.json' }, null, 2)}\n`);
  const eligible = runRealCli(workdir, ['retention', '--workspace', workspace, '--json']);
  assert.equal(eligible.run.status, 0);
  assert.equal(eligible.receipt.cleanup, 'ELIGIBLE');
  assert.equal(eligible.receipt.basis, 'verified-completed');
  assert.equal(eligible.receipt.pending.length, 0);

  // 另一条路径：pending 存续 + 另行批准的迁移 + 已证明恢复 → 边界才可变更；
  // 只有批准、没有恢复证明 → 仍 DENIED（"有备份"永远不是提前清理的理由）。
  const pendingDir = makeWorkdir('j2-migration');
  const { workspace: pendingWorkspace } = makeWorkspace(pendingDir, { pendingKnowledge: true });
  const approval = writeJson(path.join(pendingDir, 'migration-approval.json'), {
    approvalId: 'mig-j2', approvedBy: 'ql-wade', approvalRef: 'change-control:migration-j2',
    reason: 'runner-permanently-lost', approvedAt: new Date().toISOString(),
  });
  const noProof = runRealCli(pendingDir, ['retention', '--workspace', pendingWorkspace, '--migration-approval', approval, '--json']);
  assert.equal(noProof.run.status, 2, 'approval without proven restore still denies');
  assert.equal(noProof.receipt.cleanup, 'DENIED');

  const proof = writeJson(path.join(pendingDir, 'restore-proof.json'), {
    backupId: 'backup-verified-j2', restoredAt: new Date().toISOString(), verified: true, sameOperationReadback: true,
  });
  const withProof = runRealCli(pendingDir, ['retention', '--workspace', pendingWorkspace, '--migration-approval', approval, '--restore-proof', proof, '--json']);
  assert.equal(withProof.run.status, 0);
  assert.equal(withProof.receipt.cleanup, 'ELIGIBLE');
  assert.equal(withProof.receipt.basis, 'approved-migration-with-proven-restore');
  assert.equal(withProof.receipt.toolPerformsDeletion, false, 'the gate evaluates; deletion stays an authorized human operation');
});

// --- J3: 旧 writer 拒绝旅程 ----------------------------------------------------------

test('J3: old-writer denial — live writer refuses the restore, real SIGKILL + confirmation enables it, the dead attempt stays excluded', async () => {
  const workdir = makeWorkdir('j3-old-writer');
  const { workspace } = makeWorkspace(workdir, { supersededReceipt: true });
  const target = path.join(workdir, 'backup-target');
  fs.mkdirSync(target, { recursive: true });
  const backup = runRealCli(workdir, ['backup', '--workspace', workspace, '--target', target, '--json']);
  assert.equal(backup.run.status, 0);
  const backupDir = path.join(target, backup.receipt.backupId);

  const holder = spawnHolder();
  try {
    assert.equal(await waitUntil(() => isAlive(holder.pid)), true);
    const quarantine = path.join(workdir, 'quarantine');

    // 缺 fence 证据 → 拒绝。
    const noFence = runRealCli(workdir, ['restore', '--backup', backupDir, '--quarantine', quarantine, '--json']);
    assert.equal(noFence.run.status, 2);
    assert.match(noFence.receipt.refusals.map((r) => r.code).join(','), /OLD_WRITER/);

    // 谎报 confirmedGone 但旧 writer 真实存活 → liveness 检查戳穿。
    const lie = fenceEvidence(workdir, { pid: holder.pid });
    const lieResult = runRealCli(workdir, ['restore', '--backup', backupDir, '--quarantine', quarantine, '--fence-evidence', lie, '--json']);
    assert.equal(lieResult.run.status, 2);
    assert.ok(lieResult.receipt.refusals.some((refusal) => refusal.code === 'RESTORE_REFUSED_OLD_WRITER_LIVE'));

    // 真实 SIGKILL + gone 确认 → 恢复启用。
    holder.kill('SIGKILL');
    assert.equal(await waitUntil(() => !isAlive(holder.pid)), true);
    const realFence = fenceEvidence(workdir, { pid: holder.pid, observedAt: new Date().toISOString() });
    const ok = runRealCli(workdir, ['restore', '--backup', backupDir, '--quarantine', quarantine, '--fence-evidence', realFence, '--json']);
    assert.equal(ok.run.status, 0, `restore must succeed after the real fence: ${ok.run.stderr}`);
    assert.equal(ok.receipt.status, 'RELEASED');

    // 死 attempt 的迟到回执存在于备份中，但恢复后的当前状态排除它（STALE 语义）。
    const reconciliation = JSON.parse(fs.readFileSync(path.join(quarantine, 'restore-reconciliation.json'), 'utf8'));
    assert.ok(reconciliation.excludedSuperseded.some((item) => item.path === 'operations/op-outline-publish.receipt.stale.json'));
    assert.equal(fs.existsSync(path.join(quarantine, 'operations', 'op-outline-publish.receipt.stale.json')), true, 'the stale receipt file is preserved as data');
    const restoredRunState = JSON.parse(fs.readFileSync(path.join(quarantine, 'run-state.json'), 'utf8'));
    assert.equal(restoredRunState.epoch, 5, 'the current epoch is restored unchanged — no stale grant is revived');
  } finally {
    holder.kill('SIGKILL');
  }
});

// --- J4: 单权威迁移旅程 --------------------------------------------------------------

test('J4: single-authority transfer — the permanently lost runner is SIGKILLed, approval + process-level fence register a NEW authority with an epoch bump, and the proof shows exactly one live authority', async () => {
  const workdir = makeWorkdir('j4-transfer');
  const { workspace } = makeWorkspace(workdir, { authorityId: 'comet-authority-lost-runner', epoch: 8 });
  const stateFile = path.join(workspace, 'run-state.json');

  // 原 Runner 永久丢失：真实子进程持有权威 → SIGKILL → 确认终止（无监督重启）。
  const lostRunner = spawnHolder();
  assert.equal(await waitUntil(() => isAlive(lostRunner.pid)), true);
  lostRunner.kill('SIGKILL');
  assert.equal(await waitUntil(() => !isAlive(lostRunner.pid)), true);

  // 无受控批准 → 拒绝。
  const noApproval = runRealCli(workdir, ['transfer', '--state', stateFile, '--fence-evidence', fenceEvidence(workdir, { oldWriterId: 'comet-authority-lost-runner', pid: lostRunner.pid }), '--out', path.join(workdir, 'out.json'), '--json']);
  assert.equal(noApproval.run.status, 2, 'transfer without a controlled approval must refuse');
  assert.match(noApproval.receipt.refusals.map((r) => r.code).join(','), /APPROVAL/);

  // 有批准但用共享目录冒充 fencing → 拒绝（不能冒充分布式 fencing）。
  const approval = writeJson(path.join(workdir, 'transfer-approval.json'), {
    approvalId: 'mig-j4', approvedBy: 'ql-wade', approvalRef: 'change-control:migration-j4',
    reason: 'runner-permanently-lost', approvedAt: new Date().toISOString(),
  });
  const masquerade = fenceEvidence(workdir, { oldWriterId: 'comet-authority-lost-runner', method: 'shared-directory-reregister' });
  const masqueradeResult = runRealCli(workdir, ['transfer', '--state', stateFile, '--approval', approval, '--fence-evidence', masquerade, '--out', path.join(workdir, 'out-masq.json'), '--json']);
  assert.equal(masqueradeResult.run.status, 2);
  assert.ok(masqueradeResult.receipt.refusals.some((refusal) => refusal.code === 'AUTHORITY_FENCE_NOT_PROCESS_LEVEL'));

  // 受控迁移：进程级 fence 证据（真实 SIGKILL pid + gone 确认）→ 新 authority 登记。
  const newStateFile = path.join(workdir, 'run-state.transferred.json');
  const realFence = fenceEvidence(workdir, { oldWriterId: 'comet-authority-lost-runner', pid: lostRunner.pid, observedAt: new Date().toISOString() });
  const transfer = runRealCli(workdir, ['transfer', '--state', stateFile, '--approval', approval, '--fence-evidence', realFence, '--out', newStateFile, '--json']);
  assert.equal(transfer.run.status, 0, `transfer must exit 0: ${transfer.run.stderr}`);
  assert.equal(transfer.receipt.interface, 'AuthorityTransfer.v1');
  assert.equal(transfer.receipt.status, 'TRANSFERRED');

  // 新 authority 登记：epoch +1、同 runId、transferredFrom；唯一存活权威证明。
  const newState = JSON.parse(fs.readFileSync(newStateFile, 'utf8'));
  assert.equal(newState.epoch, 9, 'the transfer bumps the epoch');
  assert.equal(newState.runId, 'run-i08-journey', 'the same run continues');
  assert.equal(newState.transferredFrom, 'comet-authority-lost-runner');
  assert.notEqual(newState.authorityId, 'comet-authority-lost-runner');
  assert.equal(transfer.receipt.singleAuthorityProof.oldWriterConfirmedGone, true);
  assert.equal(transfer.receipt.singleAuthorityProof.singleLiveAuthority, true);
});

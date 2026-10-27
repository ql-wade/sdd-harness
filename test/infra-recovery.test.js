import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// V_INFRA_I08 — I08 备份恢复、单权威迁移与 R10 未完成保留 的契约检查。
// Canonical I08 entry: 本套件驱动 tools/infra/recovery.mjs（recovery 域目录
// infra/delivery/recovery/；BackupRegistry.v1 单源在 legacy 域目录
// infra/delivery/backup/registry.json，canonical 默认域经显式 fail-closed fallback
// 读取）。兼容入口 tools/infra/backup-restore.mjs 的委托契约由
// test/infra-backup-restore.test.js 单独覆盖。
// 规格：infrastructure-tasks.json 的 I08 条目 + infrastructure-plan.md I08 小节
// + R10 恢复关闭门（存在备份 ≠ 允许提前清理唯一未完成工作区）。
//
//   Backup.v1            -> 一致性 manifest：Comet 状态/事务/回执/批准 payload（含版本）+
//                           knowledge/db/对象/config refs；真实 sha256 对真实字节。
//   Restore.v1           -> 恢复进隔离区 → 认证当前权限 → 隔离旧 writer → 验证同
//                           operation 与读回后才释放；不回放旧 ACL / 不重加离组成员 /
//                           不复用已撤销代码源缓存 / 不复制状态另开 writer。
//   Retention.v1         -> R10 A：未完成 Run/knowledge 义务保留唯一工作区；cleanup
//                           需要已验证完成或另行批准的迁移+恢复证明；磁盘压力只告警
//                           不静默清理。
//   AuthorityTransfer.v1 -> 原 Runner 永久丢失时：受控迁移批准 → 旧 writer 进程级
//                           隔离证据（P3_3 SIGKILL 手法）→ 新 authority 登记。
//
// CLI 退出码契约（execution-contract.json V_INFRA_I08.cli_contract）：
//   0=PASS，1=输入/前置无效（文件缺失/不可解析/参数错误/未知 probe case），2=验证失败
//  （语义违规、备份不一致、恢复拒绝、cleanup 拒绝、UNVERIFIED）。
//   环境缺失必须显式 UNVERIFIED 并以非零退出，不允许 skip 或 mock 转绿。
//
// 环境事实（2026-10-21）：docker EPERM、gh TLS 失效、无真实 Outline —— 目录形态
// Registry/备份目标就是真实被测物；跨机/真实服务恢复在回执中如实 UNVERIFIED。
// 负例 fixture 全部在 os.tmpdir() 生成（套件是夹具作者，CLI 只消费），不向活配置
// 写入任何状态；零新 npm 依赖。三个 secret-ref（backup-writer / backup-encryption /
// restore-reader）只引用不存值；目录缺登记按 I07 先例记显式 catalogGap（I01 所有
// 权属），解析器如实 REF_NOT_REGISTERED。

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '..');
const recoveryDir = path.join(repoRoot, 'infra', 'delivery', 'recovery');
const legacyBackupDir = path.join(repoRoot, 'infra', 'delivery', 'backup');
const registryPath = path.join(repoRoot, 'infra', 'delivery', 'registry.json');
const refsPath = path.join(repoRoot, 'infra', 'delivery', 'secrets.refs.example.json');
const cliPath = path.join(repoRoot, 'tools', 'infra', 'recovery.mjs');
const secretRefsModuleUrl = new URL('../tools/infra/secret-refs.mjs', import.meta.url);

const RUN_TIMEOUT_MS = 120_000;
const DOMAIN_FILES = ['backup-policy.json', 'restore-policy.json', 'retention-policy.json', 'authority-transfer.schema.json'];
const BACKUP_REFS = [
  'secret-ref:sdd-harness-pilot/backup-writer',
  'secret-ref:sdd-harness-pilot/backup-encryption',
  'secret-ref:sdd-harness-pilot/restore-reader',
];
// 规格冻结（infrastructure-plan.md I08 RED 第一条 + R10 恢复关闭门）：
// pending 义务清单至少必须覆盖这三类；磁盘压力永远只告警。
const SPEC_PENDING_OBLIGATIONS = ['pending-outline-publish', 'unknown-remote-result', 'sole-payload-in-workspace'];
const HOST_PATH_OUTPUT_RE = /\/(Users|home|root|private|var|usr|etc|opt|tmp)\//;

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const digestFile = (file) => sha256(fs.readFileSync(file));

function runCli(args, { timeout = RUN_TIMEOUT_MS } = {}) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout,
    maxBuffer: 64 * 1024 * 1024,
  });
}

function parseJsonOut(result, label) {
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new AssertionError(`${label}: stdout is not JSON: ${result.stdout}\nstderr: ${result.stderr}`);
  }
}

function readDomainJson(name, base = recoveryDir) {
  return JSON.parse(fs.readFileSync(path.join(base, name), 'utf8'));
}

// 把已提交的 recovery 域整体拷到 tmp fixture（policies 来自 canonical 目录，
// BackupRegistry.v1 来自 legacy 单源），应用 mutate 后返回 fixture 目录（不触碰活配置）。
// fixture 自带 registry.json：--dir 目录绝不触发 legacy fallback。
function makeDomainFixture(mutate) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'infra-i08-domain-'));
  for (const name of DOMAIN_FILES) {
    fs.copyFileSync(path.join(recoveryDir, name), path.join(dir, name));
  }
  fs.copyFileSync(path.join(legacyBackupDir, 'registry.json'), path.join(dir, 'registry.json'));
  const read = (name) => fs.readFileSync(path.join(dir, name), 'utf8');
  const write = (name, text) => fs.writeFileSync(path.join(dir, name), text);
  const json = (name) => JSON.parse(read(name));
  const writeJson = (name, value) => write(name, JSON.stringify(value, null, 2) + '\n');
  mutate({ dir, read, write, json, writeJson });
  return dir;
}

function codes(report) {
  return (report.violations ?? []).map((v) => v.code);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitUntilAlive(pid, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (!isAlive(pid) && Date.now() < deadline) await sleep(25);
  return isAlive(pid);
}

async function waitUntilGone(pid, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (isAlive(pid) && Date.now() < deadline) await sleep(25);
  return !isAlive(pid);
}

// 真实存活进程 helper：旧 writer 活性用真实 pid 证明，不是 mock。调用方负责 SIGKILL。
function spawnLiveChild() {
  return spawn(process.execPath, ['-e', 'setInterval(() => {}, 250);'], { stdio: 'ignore' });
}

// --- workspace fixture（目录形态 Registry/备份目标 = 真实被测物）-------------------

// 真实字节工作区：每个文件写入真实 bytes 并返回 {path -> bytes} 期望表。
// 形状即 Backup.v1 的一致性范围：run-state 权威 / 事务 / 回执 / 批准 payload（含版本）
// / knowledge 义务 / db 页 + 水位 / 对象 / config refs（无秘密值）。
function makeWorkspace(label, {
  authorityId = 'comet-authority-i08',
  epoch = 3,
  runId = 'run-i08-consistency',
  openTransaction = false,
  pendingKnowledge = false,
  unknownRemote = false,
  solePayload = false,
  supersededReceipt = false,
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `infra-i08-ws-${label}-`));
  const workspace = path.join(root, 'workspace');
  for (const section of ['operations', 'transactions', 'approvals', 'knowledge', 'db/pages', 'objects', 'config', 'permissions']) {
    fs.mkdirSync(path.join(workspace, section), { recursive: true });
  }
  const files = {};
  const put = (rel, value) => {
    const file = path.join(workspace, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const bytes = typeof value === 'string' || Buffer.isBuffer(value)
      ? Buffer.from(value)
      : Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.writeFileSync(file, bytes);
    files[rel] = bytes;
    return file;
  };

  put('run-state.json', { authorityId, epoch, runId, updatedAt: new Date().toISOString() });
  put('operations/op-publish.dispatch.json', {
    opId: 'op-publish', kind: 'outline-publish', attempt: 1, epoch, remote: true,
  });
  if (!unknownRemote) {
    put('operations/op-publish.receipt.json', { opId: 'op-publish', status: 'ok', attempt: 1, epoch });
  }
  if (supersededReceipt) {
    // 旧 attempt/epoch 的迟到回执：恢复时必须排除，绝不能作为当前状态复活。
    put('operations/op-publish.receipt.stale.json', { opId: 'op-publish', status: 'ok', attempt: 1, epoch: epoch - 1 });
  }
  put('transactions/txn-base.json', { txnId: 'txn-base', state: 'committed', watermark: '2026-10-21T08:00:00.000Z' });
  if (openTransaction) {
    put('transactions/txn-open.json', { txnId: 'txn-open', state: 'open', watermark: null });
  }
  put('approvals/payload-doc.json', { payloadId: 'payload-doc', version: 'v7', soleCopy: solePayload });
  put('knowledge/closeout-k1.json', { itemId: 'closeout-k1', state: pendingKnowledge ? 'pending' : 'closed' });
  const pointInTime = '2026-10-21T08:00:00.000Z';
  put('db/watermark.json', { pointInTime });
  put('db/pages/page-0001.page', Buffer.from([0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0xf0, 0x11, 0x22]));
  put('objects/watermark.json', { pointInTime });
  put('objects/report.bin', Buffer.from(Array.from({ length: 64 }, (_, i) => (i * 7) & 0xff)));
  put('config/refs.json', { configRefs: ['outline-instance@UNVERIFIED', 'git-remote@UNVERIFIED'] });
  put('permissions/acl.json', {
    entries: [{ grantId: 'grant-doc-read', principal: 'svc:sdd-harness-pilot/publisher', resource: 'doc-set', grantedAtEpoch: epoch - 1 }],
    note: 'point-in-time ACL snapshot; data only, never replayed on restore',
  });
  put('permissions/members.json', {
    members: [
      { principal: 'svc:sdd-harness-pilot/publisher', status: 'active' },
      { principal: 'user:former-member', status: 'offline' },
    ],
  });
  return { root, workspace, files, put };
}

// 备份目标 fixture：目录形态独立备份目标（专用隔离项目，绝不指向 PAV/其它项目）。
function makeTarget(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `infra-i08-target-${label}-`));
  const target = path.join(root, 'backup-target');
  fs.mkdirSync(target, { recursive: true });
  return { root, target };
}

function tmpFile(name, value) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'infra-i08-io-')), name);
  fs.writeFileSync(file, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
  return file;
}

const fenceEvidence = (overrides = {}) => tmpFile('fence-evidence.json', {
  oldWriterId: 'comet-authority-i08',
  method: 'SIGKILL',
  confirmedGone: true,
  observedAt: new Date().toISOString(),
  ...overrides,
});

// --- 1) 已提交域：validate 干净 + 显式 catalogGap + 秘密引用纪律 -------------------

test('V_INFRA_I08 contract: committed backup domain validates clean with explicit catalog gaps and honest retention', () => {
  const result = runCli(['validate', '--registry', registryPath, '--json']);
  assert.equal(result.status, 0, `validate must exit 0\ncwd=${repoRoot}\nstdout=${result.stdout}\nstderr=${result.stderr}`);
  const report = parseJsonOut(result, 'validate');
  assert.equal(report.interface, 'BackupInfra.v1');
  assert.equal(report.ok, true, `violations: ${JSON.stringify(report.violations)}`);

  // 三个 secret-ref 只引用；目录里 backup-writer / restore-reader 未登记（24 refs 中
  // 只有 backup-encryption）——按 I07 先例记显式 catalogGap（属 I01 所有权，非结构违规），
  // 且 gap 清单必须如实列出这两个缺席引用，不许静默也不许谎报全登记。
  assert.deepEqual(
    (report.catalogGaps ?? []).map((gap) => gap.ref).sort(),
    ['secret-ref:sdd-harness-pilot/backup-writer', 'secret-ref:sdd-harness-pilot/restore-reader'],
  );

  // R10 诚实性：RPO/RTO/保留期/加密 owner 未确认就如实 UNVERIFIED，且不自动清理
  //（registry.json 单源在 legacy 域目录）。
  const registry = readDomainJson('registry.json', legacyBackupDir);
  assert.equal(registry.retention.autoCleanupEnabled, false, 'R10: no auto cleanup while recovery terms are unconfirmed');
  for (const key of ['rpo', 'rto', 'retentionPeriod', 'encryptionOwner']) {
    assert.equal(registry.retention[key], 'UNVERIFIED', `registry.retention.${key} must stay honestly UNVERIFIED`);
  }

  // 规格冻结的 R10 边界：pending 义务清单覆盖三类、磁盘压力只告警。
  const backupPolicy = readDomainJson('backup-policy.json');
  for (const obligation of SPEC_PENDING_OBLIGATIONS) {
    assert.ok(backupPolicy.retention.cleanupDenyWhenPending.includes(obligation), `cleanupDenyWhenPending must include ${obligation}`);
  }
  assert.equal(backupPolicy.retention.diskPressureWarnOnly, true, 'disk pressure must be warn-only, never a silent cleanup trigger');
  assert.equal(backupPolicy.retention.autoCleanupEnabled, false);

  // canonical retention-policy.json：与 backup-policy.json.retention 的冻结边界一致。
  const retentionPolicy = readDomainJson('retention-policy.json');
  assert.equal(retentionPolicy.interface, 'RetentionPolicy.v1');
  assert.equal(retentionPolicy.retention.autoCleanupEnabled, false);
  assert.equal(retentionPolicy.retention.toolPerformsDeletion, false);
  for (const obligation of SPEC_PENDING_OBLIGATIONS) {
    assert.ok(retentionPolicy.retention.cleanupDenyWhenPending.includes(obligation));
  }
  assert.equal(retentionPolicy.retention.diskPressureWarnOnly, true);
  assert.deepEqual(retentionPolicy.retention.cleanupAllowedOnlyWhen, ['verified-completed', 'approved-migration-with-proven-restore']);
  for (const key of ['rpo', 'rto', 'retentionPeriod', 'encryptionOwner']) {
    assert.equal(retentionPolicy.recoveryTerms[key], 'UNVERIFIED', `retention-policy.recoveryTerms.${key} must stay honestly UNVERIFIED`);
  }

  // canonical authority-transfer.schema.json：受控迁移冻结边界。
  const transferSchema = readDomainJson('authority-transfer.schema.json');
  assert.equal(transferSchema.interface, 'AuthorityTransferSchema.v1');
  assert.equal(transferSchema.approval.required, true);
  assert.equal(transferSchema.approval.reasonRequired, 'runner-permanently-lost');
  assert.equal(transferSchema.oldWriterFence.processLevelEvidenceRequired, true);
  assert.ok(transferSchema.oldWriterFence.rejectedMethods.includes('shared-directory-reregister'));
  assert.equal(transferSchema.state.epochBumpRequired, true);
  assert.equal(transferSchema.state.singleRunContinuityRequired, true);
  assert.equal(transferSchema.singleAuthorityProof.required, true);
  assert.equal(transferSchema.singleAuthorityProof.singleLiveAuthority, true);

  // Restore 边界：不回放旧 ACL / 不重加离组成员 / 旧 grant / 二 writer / 撤销缓存。
  const restorePolicy = readDomainJson('restore-policy.json');
  assert.equal(restorePolicy.forbidden.replayOldAcl, true);
  assert.equal(restorePolicy.forbidden.readdOfflineMembers, true);
  assert.equal(restorePolicy.forbidden.restoreOldGrantsOrAttempts, true);
  assert.equal(restorePolicy.forbidden.secondWriterByStateCopy, true);
  assert.equal(restorePolicy.forbidden.reuseRevokedCodeSourceCache, true);
  assert.equal(restorePolicy.quarantine.required, true);
  assert.equal(restorePolicy.oldWriterFence.required, true);
  assert.equal(restorePolicy.oldWriterFence.processLevelEvidenceRequired, true, 'fencing must be process-level, not shared-directory masquerade');

  // 输出脱敏：结构化回执不携带宿主私有路径。
  assert.doesNotMatch(result.stdout, HOST_PATH_OUTPUT_RE, 'validate receipt must not leak host paths');
});

test('secret-ref discipline: the three backup refs are referenced only and resolve honestly (registered -> UNRESOLVED, unregistered -> REF_NOT_REGISTERED)', async () => {
  const { parseSecretRef, scanForForbiddenValues, resolveSecretRef } = await import(secretRefsModuleUrl);
  const refsDoc = JSON.parse(fs.readFileSync(refsPath, 'utf8'));

  for (const ref of BACKUP_REFS) {
    const parsed = parseSecretRef(ref);
    assert.equal(parsed.ok, true, `${ref} must parse`);
    assert.equal(parsed.project, 'sdd-harness-pilot');
  }
  // backup-encryption 已登记：四重检查通过后仍如实 UNRESOLVED（无运行时 secret store）。
  const entry = refsDoc.refs.find((item) => item.ref === 'secret-ref:sdd-harness-pilot/backup-encryption');
  assert.ok(entry, 'backup-encryption must be present in the committed 24-ref catalog');
  const resolved = resolveSecretRef({
    ref: entry.ref,
    principalId: entry.allowedPrincipals[0],
    role: entry.boundRole,
    refsDoc,
    project: 'sdd-harness-pilot',
  });
  assert.equal(resolved.status, 'UNRESOLVED');
  assert.equal(resolved.resolved, false);
  // 未登记引用：解析必须拒绝（backup-writer / restore-reader 现状）。
  assert.throws(() => resolveSecretRef({
    ref: 'secret-ref:sdd-harness-pilot/restore-reader',
    principalId: 'svc:sdd-harness-pilot/backup',
    role: 'backup',
    refsDoc,
    project: 'sdd-harness-pilot',
  }), (error) => error.code === 'REF_NOT_REGISTERED');

  // 域文件零秘密值/零宿主路径（registry.json 来自 legacy 单源，一并扫）。
  for (const name of DOMAIN_FILES) {
    const violations = scanForForbiddenValues(readDomainJson(name));
    assert.deepEqual(violations, [], `${name} must carry references only, never secret values or host paths`);
  }
  {
    const violations = scanForForbiddenValues(readDomainJson('registry.json', legacyBackupDir));
    assert.deepEqual(violations, [], 'registry.json must carry references only, never secret values or host paths');
  }
});

// --- 2) validate 负例（tmp fixture 改动已提交域的副本）----------------------------

test('validate negatives: tampered R10 freeze, auto-cleanup flip, missing replay rules, secret-shaped key, malformed/cross-project ref, project mismatch — all exit 2', () => {
  const cases = [
    {
      name: 'disk-pressure-warn-only flipped to false',
      mutate: ({ json, writeJson }) => {
        const policy = json('backup-policy.json');
        policy.retention.diskPressureWarnOnly = false;
        writeJson('backup-policy.json', policy);
      },
      code: 'DISK_PRESSURE_WARN_ONLY_REQUIRED',
    },
    {
      name: 'spec pending obligation dropped',
      mutate: ({ json, writeJson }) => {
        const policy = json('backup-policy.json');
        policy.retention.cleanupDenyWhenPending = policy.retention.cleanupDenyWhenPending.filter((item) => item !== 'sole-payload-in-workspace');
        writeJson('backup-policy.json', policy);
      },
      code: 'SPEC_PENDING_OBLIGATION_MISSING',
    },
    {
      name: 'auto cleanup enabled with UNVERIFIED recovery terms',
      mutate: ({ json, writeJson }) => {
        const registry = json('registry.json');
        registry.retention.autoCleanupEnabled = true;
        writeJson('registry.json', registry);
      },
      code: 'AUTO_CLEANUP_WITHOUT_CONFIRMED_RECOVERY',
    },
    {
      name: 'restore replay rules removed',
      mutate: ({ json, writeJson }) => {
        const policy = json('restore-policy.json');
        delete policy.forbidden.replayOldAcl;
        writeJson('restore-policy.json', policy);
      },
      code: 'RESTORE_RULE_MISSING',
    },
    {
      name: 'process-level fence requirement dropped',
      mutate: ({ json, writeJson }) => {
        const policy = json('restore-policy.json');
        policy.oldWriterFence.processLevelEvidenceRequired = false;
        writeJson('restore-policy.json', policy);
      },
      code: 'FENCE_PROCESS_LEVEL_REQUIRED',
    },
    {
      name: 'secret-shaped key in policy',
      mutate: ({ json, write }) => {
        const policy = json('restore-policy.json');
        policy.encryptionSecret = 'not-a-real-secret-but-key-named';
        write('restore-policy.json', `${JSON.stringify(policy, null, 2)}\n`);
      },
      code: 'SECRET_VALUE_KEY_FORBIDDEN',
    },
    {
      name: 'malformed secret ref',
      mutate: ({ json, writeJson }) => {
        const registry = json('registry.json');
        registry.credentialRefs[0] = 'backup-writer-without-prefix';
        writeJson('registry.json', registry);
      },
      code: 'MALFORMED_REF',
    },
    {
      name: 'cross-project secret ref',
      mutate: ({ json, writeJson }) => {
        const registry = json('registry.json');
        registry.credentialRefs[0] = 'secret-ref:other-project/backup-writer';
        writeJson('registry.json', registry);
      },
      code: 'CROSS_PROJECT_REF',
    },
    {
      name: 'project mismatch with the I01 registry',
      mutate: ({ json, writeJson }) => {
        const registry = json('registry.json');
        registry.project.id = 'another-project';
        writeJson('registry.json', registry);
      },
      code: 'PROJECT_MISMATCH',
    },
    {
      name: 'canonical retention policy flips auto cleanup on',
      mutate: ({ json, writeJson }) => {
        const policy = json('retention-policy.json');
        policy.retention.autoCleanupEnabled = true;
        writeJson('retention-policy.json', policy);
      },
      code: 'AUTO_CLEANUP_WITHOUT_CONFIRMED_RECOVERY',
    },
    {
      name: 'canonical retention policy drops a spec-frozen pending obligation',
      mutate: ({ json, writeJson }) => {
        const policy = json('retention-policy.json');
        policy.retention.cleanupDenyWhenPending = policy.retention.cleanupDenyWhenPending.filter((item) => item !== 'unknown-remote-result');
        writeJson('retention-policy.json', policy);
      },
      code: 'SPEC_PENDING_OBLIGATION_MISSING',
    },
    {
      name: 'authority-transfer schema drops the epoch-bump requirement',
      mutate: ({ json, writeJson }) => {
        const schema = json('authority-transfer.schema.json');
        delete schema.state.epochBumpRequired;
        writeJson('authority-transfer.schema.json', schema);
      },
      code: 'AUTHORITY_TRANSFER_SCHEMA_RULE_MISSING',
    },
    {
      name: 'authority-transfer schema accepts shared-directory masquerade fencing',
      mutate: ({ json, writeJson }) => {
        const schema = json('authority-transfer.schema.json');
        schema.oldWriterFence.rejectedMethods = [];
        writeJson('authority-transfer.schema.json', schema);
      },
      code: 'AUTHORITY_TRANSFER_SCHEMA_RULE_MISSING',
    },
  ];
  for (const item of cases) {
    const dir = makeDomainFixture(item.mutate);
    const result = runCli(['validate', '--registry', registryPath, '--dir', dir, '--json']);
    assert.equal(result.status, 2, `${item.name}: tampered domain must exit 2\nstdout=${result.stdout}\nstderr=${result.stderr}`);
    const report = parseJsonOut(result, item.name);
    assert.equal(report.ok, false, item.name);
    assert.ok(codes(report).includes(item.code), `${item.name}: expected ${item.code}, got ${codes(report).join(',')}`);
  }
});

test('validate fail-closed: missing or unparseable domain file exits 1, never silently degrades to empty rules', () => {
  const missing = makeDomainFixture(() => {});
  fs.rmSync(path.join(missing, 'restore-policy.json'));
  const missingResult = runCli(['validate', '--registry', registryPath, '--dir', missing, '--json']);
  assert.equal(missingResult.status, 1, 'missing domain file is an input/prerequisite failure');

  const broken = makeDomainFixture(({ write }) => write('backup-policy.json', '{not json'));
  const brokenResult = runCli(['validate', '--registry', registryPath, '--dir', broken, '--json']);
  assert.equal(brokenResult.status, 1, 'unparseable domain file is an input/prerequisite failure');

  // legacy registry fallback 只存在于 canonical 默认目录；任何 --dir 缺 registry.json 都必须 fail-closed。
  const noRegistry = makeDomainFixture(() => {});
  fs.rmSync(path.join(noRegistry, 'registry.json'));
  const noRegistryResult = runCli(['validate', '--registry', registryPath, '--dir', noRegistry, '--json']);
  assert.equal(noRegistryResult.status, 1, 'a non-default domain dir without registry.json must not fall back silently');

  const noArgs = runCli(['validate', '--json']);
  assert.equal(noArgs.status, 1, 'validate requires --registry');
});

// --- 3) Backup.v1：真实 sha256 对真实字节 ------------------------------------------

test('backup: real bytes are copied and the manifest digests match the target byte-for-byte; revoked cache is recorded, never copied', () => {
  const ws = makeWorkspace('bk-ok', { supersededReceipt: true });
  const tg = makeTarget('bk-ok');
  const result = runCli(['backup', '--workspace', ws.workspace, '--target', tg.target, '--json']);
  assert.equal(result.status, 0, `backup must exit 0\nstdout=${result.stdout}\nstderr=${result.stderr}`);
  const receipt = parseJsonOut(result, 'backup');
  assert.equal(receipt.interface, 'Backup.v1');
  assert.equal(receipt.status, 'VERIFIED', JSON.stringify(receipt.refusals ?? []));
  assert.equal(receipt.capabilityScope, 'LOCAL_DIRECTORY_FORM');

  // manifest 独立读回：每一项 sha256/bytes 必须等于备份目标的真实字节（套件自己算，不信 CLI）。
  const manifestPath = path.join(tg.target, receipt.backupId, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.interface, 'Backup.v1');
  assert.equal(manifest.source.authorityId, 'comet-authority-i08');
  assert.equal(manifest.source.epoch, 3);
  assert.equal(manifest.source.runId, 'run-i08-consistency');
  assert.ok(manifest.files.length >= 10, 'manifest covers the full workspace sections');
  for (const entry of manifest.files) {
    const onDisk = path.join(tg.target, receipt.backupId, 'files', entry.path);
    assert.equal(fs.existsSync(onDisk), true, `backed-up file ${entry.path} must exist`);
    assert.equal(digestFile(onDisk), entry.sha256, `${entry.path}: manifest sha256 must equal the real copied bytes`);
    assert.equal(fs.statSync(onDisk).size, entry.bytes);
  }
  // 版本与范围：批准 payload 版本被记录；各 section（db/objects/config/knowledge）全部在册。
  const payload = manifest.files.find((entry) => entry.path === 'approvals/payload-doc.json');
  assert.equal(payload.version, 'v7', 'approved payload version must be recorded');
  for (const section of ['run-state', 'operations', 'transactions', 'approvals', 'knowledge', 'db', 'objects', 'config', 'permissions']) {
    assert.ok(
      manifest.files.some((entry) => entry.path === `${section}.json` || entry.path.startsWith(`${section}/`)),
      `section ${section} must be captured`,
    );
  }
  // 点位一致：db 与 objects 水位一致并被记录。
  assert.equal(manifest.pointInTime.consistent, true);
  assert.equal(manifest.pointInTime.db, manifest.pointInTime.objects);

  // 撤销的代码源缓存：登记 ref + restored=false，备份目标里绝无其字节。
  assert.ok((manifest.cacheRefs ?? []).length >= 1, 'revoked code-source cache refs must be recorded');
  assert.ok(manifest.cacheRefs.every((ref) => ref.restored === false));
  for (const entry of manifest.files) {
    assert.ok(!entry.path.startsWith('cache/'), 'revoked cache content must never be backed up');
  }

  // 三个 secret-ref 只以引用形式入 manifest，绝无值。
  for (const ref of BACKUP_REFS) {
    assert.ok(manifest.credentialRefs.includes(ref), `${ref} must be recorded by reference`);
  }
  assert.doesNotMatch(result.stdout, /ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}/);
});

test('backup refuses an inconsistent workspace: an open transaction means no consistent point-in-time backup (exit 2)', () => {
  const ws = makeWorkspace('bk-open', { openTransaction: true });
  const tg = makeTarget('bk-open');
  const result = runCli(['backup', '--workspace', ws.workspace, '--target', tg.target, '--json']);
  assert.equal(result.status, 2, 'open transaction must refuse the backup');
  const receipt = parseJsonOut(result, 'backup-open-txn');
  assert.equal(receipt.status, 'REFUSED');
  assert.ok((receipt.refusals ?? []).some((refusal) => refusal.code === 'BACKUP_CONSISTENCY_REFUSED'), JSON.stringify(receipt.refusals));
});

test('backup input errors: missing workspace or missing arguments — exit 1 with usage', () => {
  const missing = runCli(['backup', '--workspace', path.join(os.tmpdir(), 'infra-i08-definitely-missing'), '--target', fs.mkdtempSync(path.join(os.tmpdir(), 'infra-i08-t-')), '--json']);
  assert.equal(missing.status, 1);
  const noArgs = runCli(['backup', '--json']);
  assert.equal(noArgs.status, 1);
});

// --- 4) Restore.v1：隔离区 + 旧 writer 隔离 + 同 operation 读回后才释放 -------------

function backupOnce(label, options = {}) {
  const ws = makeWorkspace(`restore-${label}`, options);
  const tg = makeTarget(`restore-${label}`);
  const backupResult = runCli(['backup', '--workspace', ws.workspace, '--target', tg.target, '--json']);
  assert.equal(backupResult.status, 0, `fixture backup must pass: ${backupResult.stderr}`);
  const receipt = JSON.parse(backupResult.stdout);
  return { ws, tg, backupId: receipt.backupId, backupDir: path.join(tg.target, receipt.backupId) };
}

test('restore: quarantined restore verifies manifest digests, fences the old writer, reconciles permissions honestly, and releases only after the same-operation readback', () => {
  const { ws, backupDir } = backupOnce('ok', { supersededReceipt: true });
  const quarantine = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'infra-i08-quar-')), 'quarantine');
  const result = runCli(['restore', '--backup', backupDir, '--quarantine', quarantine, '--fence-evidence', fenceEvidence(), '--json']);
  assert.equal(result.status, 0, `restore must exit 0\nstdout=${result.stdout}\nstderr=${result.stderr}`);
  const receipt = parseJsonOut(result, 'restore');
  assert.equal(receipt.interface, 'Restore.v1');
  assert.equal(receipt.status, 'RELEASED', JSON.stringify(receipt.refusals ?? []));
  assert.equal(receipt.capabilityScope, 'LOCAL_DIRECTORY_FORM');
  assert.equal(receipt.realServiceRestore.status, 'UNVERIFIED', 'cross-machine/real-service restore stays honestly UNVERIFIED');

  // 字节级独立读回：恢复区每一个文件与原工作区字节相同、与 manifest digest 相同。
  const manifest = JSON.parse(fs.readFileSync(path.join(backupDir, 'manifest.json'), 'utf8'));
  for (const entry of manifest.files) {
    const restoredFile = path.join(quarantine, entry.path);
    assert.equal(fs.existsSync(restoredFile), true, `${entry.path} must be restored`);
    assert.equal(Buffer.compare(fs.readFileSync(restoredFile), ws.files[entry.path]), 0, `${entry.path} must be byte-identical to the source workspace`);
    assert.equal(digestFile(restoredFile), entry.sha256);
  }

  // 同 operation 验证：runId/authority/epoch 与备份一致。
  assert.equal(receipt.sameOperation.verified, true);
  assert.equal(receipt.sameOperation.runId, 'run-i08-consistency');
  assert.equal(receipt.sameOperation.authorityId, 'comet-authority-i08');

  // 权限对账：恢复的 ACL 只是数据（applied=false，需当前权限重新认证）；离组成员不回填。
  const reconciliation = JSON.parse(fs.readFileSync(path.join(quarantine, 'restore-reconciliation.json'), 'utf8'));
  assert.equal(reconciliation.reAuthenticateFromCurrentAuthority, true);
  assert.ok(reconciliation.aclEntries.every((acl) => acl.applied === false), 'restored ACL entries are data only, never replayed');
  assert.ok(reconciliation.members.filter((member) => member.status === 'offline').every((member) => member.readmitted === false), 'offline members must not be re-added');
  // 旧 attempt/epoch 的迟到回执被排除出当前状态。
  assert.ok(reconciliation.excludedSuperseded.some((item) => item.path === 'operations/op-publish.receipt.stale.json'), 'stale attempt results must be excluded, not restored as current');

  // 撤销缓存不在恢复区。
  assert.equal(fs.existsSync(path.join(quarantine, 'cache')), false, 'revoked code-source cache must not be restored');

  // 释放记录：发布冻结 + 唯一 writer。
  const released = JSON.parse(fs.readFileSync(path.join(quarantine, 'release-record.json'), 'utf8'));
  assert.equal(released.publishFrozen, true, 'new publishing stays frozen through the quarantined restore');
  assert.equal(released.singleWriter, true);
  assert.doesNotMatch(result.stdout, HOST_PATH_OUTPUT_RE, 'restore receipt must not leak host paths');
});

test('restore negatives: corrupt backup byte, incomplete backup, missing/unconfirmed/live-writer fence, missing key ref, point-in-time mismatch, second writer — all exit 2 and refuse release', async () => {
  // 校验不符：篡改备份区一个真实字节 → manifest digest mismatch → 恢复不启用。
  {
    const { backupDir } = backupOnce('corrupt');
    const victim = path.join(backupDir, 'files', 'objects', 'report.bin');
    const bytes = fs.readFileSync(victim);
    bytes[3] = (bytes[3] + 1) & 0xff;
    fs.writeFileSync(victim, bytes);
    const quarantine = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'infra-i08-quar-')), 'q');
    const result = runCli(['restore', '--backup', backupDir, '--quarantine', quarantine, '--fence-evidence', fenceEvidence(), '--json']);
    assert.equal(result.status, 2, 'checksum mismatch must refuse restore');
    const receipt = parseJsonOut(result, 'restore-corrupt');
    assert.equal(receipt.status, 'REFUSED');
    assert.ok((receipt.refusals ?? []).some((refusal) => refusal.code === 'RESTORE_BACKUP_INVALID'));
    assert.equal(fs.existsSync(path.join(quarantine, 'release-record.json')), false, 'a refused restore must never release');
  }
  // 完整性缺失：manifest 列出的文件被删除 → 不完整备份拒绝。
  {
    const { backupDir } = backupOnce('incomplete');
    fs.rmSync(path.join(backupDir, 'files', 'db', 'pages', 'page-0001.page'));
    const quarantine = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'infra-i08-quar-')), 'q');
    const result = runCli(['restore', '--backup', backupDir, '--quarantine', quarantine, '--fence-evidence', fenceEvidence(), '--json']);
    assert.equal(result.status, 2);
    const receipt = parseJsonOut(result, 'restore-incomplete');
    assert.ok((receipt.refusals ?? []).some((refusal) => refusal.code === 'RESTORE_BACKUP_INVALID'));
  }
  // 旧 writer 未隔离：缺 fence 证据 / confirmedGone=false / 真实存活 pid —— 三种都拒绝。
  {
    const { backupDir } = backupOnce('nofence');
    const quarantine = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'infra-i08-quar-')), 'q');
    const noFence = runCli(['restore', '--backup', backupDir, '--quarantine', quarantine, '--json']);
    assert.equal(noFence.status, 2, 'restore without fence evidence must refuse');
    assert.match(parseJsonOut(noFence, 'restore-nofence').refusals.map((r) => r.code).join(','), /OLD_WRITER/);

    const unconfirmed = fenceEvidence({ confirmedGone: false });
    const unconfirmedResult = runCli(['restore', '--backup', backupDir, '--quarantine', quarantine, '--fence-evidence', unconfirmed, '--json']);
    assert.equal(unconfirmedResult.status, 2, 'unconfirmed fence must refuse');

    // 真实存活旧 writer：恢复必须拒绝（真实 pid，非 mock）。
    const child = spawnLiveChild();
    try {
      assert.equal(await waitUntilAlive(child.pid), true, 'fixture child must be alive');
      const liveFence = fenceEvidence({ pid: child.pid, confirmedGone: true, method: 'claimed' });
      const liveResult = runCli(['restore', '--backup', backupDir, '--quarantine', quarantine, '--fence-evidence', liveFence, '--json']);
      assert.equal(liveResult.status, 2, 'a live old writer must refuse restore');
      const liveReceipt = parseJsonOut(liveResult, 'restore-live-writer');
      assert.ok(liveReceipt.refusals.some((refusal) => refusal.code === 'RESTORE_REFUSED_OLD_WRITER_LIVE'));
      assert.equal(fs.existsSync(path.join(quarantine, 'release-record.json')), false);
    } finally {
      child.kill('SIGKILL');
    }
  }
  // 缺密钥：加密密钥引用换成未登记的 restore-reader → 恢复停止（缺密钥门不是 skip）。
  {
    const { backupDir } = backupOnce('nokey');
    const manifestPath = path.join(backupDir, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.encryptionRefs = ['secret-ref:sdd-harness-pilot/restore-reader'];
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const quarantine = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'infra-i08-quar-')), 'q');
    const result = runCli(['restore', '--backup', backupDir, '--quarantine', quarantine, '--fence-evidence', fenceEvidence(), '--json']);
    assert.equal(result.status, 2, 'an unavailable encryption key ref must stop the restore');
    const receipt = parseJsonOut(result, 'restore-nokey');
    assert.ok(receipt.refusals.some((refusal) => refusal.code === 'RESTORE_KEY_UNAVAILABLE'));
  }
  // DB/附件时间点不一致：manifest 点位被改成不一致 → 拒绝。
  {
    const { backupDir } = backupOnce('drift');
    const manifestPath = path.join(backupDir, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.pointInTime.objects = '2026-10-21T09:99:00.000Z';
    manifest.pointInTime.consistent = false;
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const quarantine = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'infra-i08-quar-')), 'q');
    const result = runCli(['restore', '--backup', backupDir, '--quarantine', quarantine, '--fence-evidence', fenceEvidence(), '--json']);
    assert.equal(result.status, 2, 'DB/attachment point-in-time mismatch must refuse restore');
    const receipt = parseJsonOut(result, 'restore-drift');
    assert.ok(receipt.refusals.some((refusal) => refusal.code === 'RESTORE_POINT_IN_TIME_INCONSISTENT'));
  }
  // 复制状态另开 writer：恢复目标已有真实存活 writer → 拒绝（不造第二个 owner）。
  {
    const { backupDir } = backupOnce('second-writer');
    const quarantine = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'infra-i08-quar-')), 'q');
    fs.mkdirSync(quarantine, { recursive: true });
    const child = spawnLiveChild();
    try {
      assert.equal(await waitUntilAlive(child.pid), true, 'fixture child must be alive');
      fs.writeFileSync(path.join(quarantine, 'writer-lock.json'), `${JSON.stringify({ pid: child.pid, authorityId: 'comet-authority-i08' }, null, 2)}\n`);
      const result = runCli(['restore', '--backup', backupDir, '--quarantine', quarantine, '--fence-evidence', fenceEvidence(), '--json']);
      assert.equal(result.status, 2, 'restoring into a target with a live writer must refuse');
      const receipt = parseJsonOut(result, 'restore-second-writer');
      assert.ok(receipt.refusals.some((refusal) => refusal.code === 'RESTORE_REFUSED_SECOND_WRITER'));
    } finally {
      child.kill('SIGKILL');
    }
  }
});

// --- 5) Retention.v1（R10 A）：pending 拒绝清理；磁盘压力只告警 ----------------------

test('retention: pending obligations deny cleanup with the explicit list; disk pressure only warns and the workspace stays byte-identical', () => {
  const ws = makeWorkspace('ret-pending', {
    openTransaction: true,
    pendingKnowledge: true,
    unknownRemote: true,
    solePayload: true,
  });
  const before = {};
  for (const rel of Object.keys(ws.files)) before[rel] = digestFile(path.join(ws.workspace, rel));

  const pressureRecord = tmpFile('pressure.json', { observedBytes: 10_000_000_000, thresholdBytes: 1_000_000, source: 'local volume probe' });
  const result = runCli(['retention', '--workspace', ws.workspace, '--disk-pressure', pressureRecord, '--json']);
  assert.equal(result.status, 2, 'pending obligations must deny cleanup (exit 2, never a silent clean)');
  const verdict = parseJsonOut(result, 'retention-pending');
  assert.equal(verdict.interface, 'Retention.v1');
  assert.equal(verdict.cleanup, 'DENIED');
  const kinds = verdict.pending.map((item) => item.kind);
  for (const kind of ['open-transaction', 'pending-knowledge-closeout', 'unknown-remote-result', 'sole-payload-in-workspace']) {
    assert.ok(kinds.includes(kind), `pending list must name ${kind}: ${kinds.join(',')}`);
  }
  assert.equal(verdict.diskPressure.warned, true, 'disk pressure must be recorded as a warning');
  assert.equal(verdict.diskPressure.cleanup, false, 'disk pressure must never trigger cleanup');
  assert.equal(verdict.r10.ruleA, 'RETAIN_SOLE_WORKSPACE');
  assert.equal(verdict.toolPerformsDeletion, false);

  // 字节不变：拒绝清理后工作区没有任何删除。
  for (const rel of Object.keys(ws.files)) {
    assert.equal(digestFile(path.join(ws.workspace, rel)), before[rel], `${rel} must survive untouched`);
  }
});

test('retention: only verified completion — or a separately approved migration with proven restore — moves the R10 A boundary', () => {
  // 已验证完成：无 pending → ELIGIBLE（依据 verified-completed；工具本身永不删除）。
  {
    const ws = makeWorkspace('ret-done');
    const result = runCli(['retention', '--workspace', ws.workspace, '--json']);
    assert.equal(result.status, 0);
    const verdict = parseJsonOut(result, 'retention-done');
    assert.equal(verdict.cleanup, 'ELIGIBLE');
    assert.equal(verdict.basis, 'verified-completed');
    assert.equal(verdict.toolPerformsDeletion, false, 'the gate evaluates; deletion stays an authorized human operation');
  }
  // 有 pending，但另行批准的迁移 + 已证明恢复 → 边界才可变更。
  {
    const ws = makeWorkspace('ret-migrated', { pendingKnowledge: true });
    const approval = tmpFile('migration-approval.json', {
      approvalId: 'mig-001',
      approvedBy: 'ql-wade',
      approvalRef: 'change-control:migration-001',
      reason: 'runner-permanently-lost',
      approvedAt: new Date().toISOString(),
    });
    const proof = tmpFile('restore-proof.json', {
      backupId: 'backup-20261021',
      restoredAt: new Date().toISOString(),
      verified: true,
      sameOperationReadback: true,
    });
    const result = runCli(['retention', '--workspace', ws.workspace, '--migration-approval', approval, '--restore-proof', proof, '--json']);
    assert.equal(result.status, 0);
    const verdict = parseJsonOut(result, 'retention-migrated');
    assert.equal(verdict.cleanup, 'ELIGIBLE');
    assert.equal(verdict.basis, 'approved-migration-with-proven-restore');
    assert.deepEqual(verdict.pending.map((item) => item.kind), ['pending-knowledge-closeout'], 'the pending list stays explicit even when the boundary moves');
  }
  // 迁移批准缺恢复证明 → 仍然拒绝（不能只拿批准就清唯一工作区）。
  {
    const ws = makeWorkspace('ret-mig-noproof', { pendingKnowledge: true });
    const approval = tmpFile('migration-approval.json', {
      approvalId: 'mig-002', approvedBy: 'ql-wade', approvalRef: 'change-control:migration-002',
      reason: 'runner-permanently-lost', approvedAt: new Date().toISOString(),
    });
    const result = runCli(['retention', '--workspace', ws.workspace, '--migration-approval', approval, '--json']);
    assert.equal(result.status, 2, 'approval without proven restore must still deny cleanup');
    const verdict = parseJsonOut(result, 'retention-mig-noproof');
    assert.equal(verdict.cleanup, 'DENIED');
    assert.ok(verdict.pendingReasons.some((reason) => /restore-proof/i.test(reason)), `refusal must name the missing proof: ${JSON.stringify(verdict.pendingReasons)}`);
  }
});

// --- 6) AuthorityTransfer.v1：原 Runner 永久丢失的受控迁移 ---------------------------

test('authority transfer: requires a controlled approval and process-level fence evidence, then registers the new authority with an epoch bump', async () => {
  const ws = makeWorkspace('transfer-ok');
  const stateFile = path.join(ws.workspace, 'run-state.json');

  // 无批准 → 拒绝。
  const noApproval = runCli(['transfer', '--state', stateFile, '--fence-evidence', fenceEvidence(), '--out', tmpFile('out.json', {}), '--json']);
  assert.equal(noApproval.status, 2, 'transfer without controlled approval must refuse');
  assert.match(parseJsonOut(noApproval, 'transfer-noapproval').refusals.map((r) => r.code).join(','), /APPROVAL/);

  // 共享目录冒充 fencing → 拒绝（不能拿"同目录重新登记"冒充分布式 fencing）。
  const approval = tmpFile('approval.json', {
    approvalId: 'mig-003', approvedBy: 'ql-wade', approvalRef: 'change-control:migration-003',
    reason: 'runner-permanently-lost', approvedAt: new Date().toISOString(),
  });
  const masquerade = fenceEvidence({ method: 'shared-directory-reregister' });
  const masqueradeResult = runCli(['transfer', '--state', stateFile, '--approval', approval, '--fence-evidence', masquerade, '--out', tmpFile('out2.json', {}), '--json']);
  assert.equal(masqueradeResult.status, 2, 'shared-directory masquerade must not count as fencing');
  assert.ok(parseJsonOut(masqueradeResult, 'transfer-masquerade').refusals.some((refusal) => refusal.code === 'AUTHORITY_FENCE_NOT_PROCESS_LEVEL'));

  // 存活旧 writer + 谎报 confirmedGone → 真实 liveness 检查拒绝。
  const child = spawnLiveChild();
  try {
    assert.equal(await waitUntilAlive(child.pid), true, 'fixture child must be alive');
    const lie = fenceEvidence({ pid: child.pid });
    const lieResult = runCli(['transfer', '--state', stateFile, '--approval', approval, '--fence-evidence', lie, '--out', tmpFile('out3.json', {}), '--json']);
    assert.equal(lieResult.status, 2, 'a live old writer refutes the gone-claim');
    assert.ok(parseJsonOut(lieResult, 'transfer-lie').refusals.some((refusal) => refusal.code === 'OLD_WRITER_STILL_LIVE'));
  } finally {
    child.kill('SIGKILL');
  }

  // 真实 SIGKILL（P3_3 手法）：kill 真实进程 → 确认终止 → 受控迁移登记新 authority。
  const holder = spawnLiveChild();
  assert.equal(await waitUntilAlive(holder.pid), true, 'fixture holder must be alive');
  holder.kill('SIGKILL');
  assert.equal(await waitUntilGone(holder.pid), true, 'the old writer must really be gone before the transfer');

  const outState = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'infra-i08-transfer-')), 'run-state.new.json');
  const realFence = fenceEvidence({ pid: holder.pid, method: 'SIGKILL', observedAt: new Date().toISOString() });
  const okResult = runCli(['transfer', '--state', stateFile, '--approval', approval, '--fence-evidence', realFence, '--out', outState, '--json']);
  assert.equal(okResult.status, 0, `transfer must exit 0\nstdout=${okResult.stdout}\nstderr=${okResult.stderr}`);
  const receipt = parseJsonOut(okResult, 'transfer-ok');
  assert.equal(receipt.interface, 'AuthorityTransfer.v1');
  assert.equal(receipt.status, 'TRANSFERRED');

  // 新 authority 登记：epoch +1、同 runId、transferredFrom 记录；旧 authority 不再是 owner。
  const newState = JSON.parse(fs.readFileSync(outState, 'utf8'));
  assert.equal(newState.epoch, 4, 'the transfer bumps the epoch');
  assert.equal(newState.runId, 'run-i08-consistency', 'the same run continues under the new authority');
  assert.notEqual(newState.authorityId, 'comet-authority-i08', 'the new authority is a distinct identity');
  assert.equal(newState.transferredFrom, 'comet-authority-i08');
  assert.equal(receipt.singleAuthorityProof.oldWriterConfirmedGone, true);
  assert.equal(receipt.singleAuthorityProof.singleLiveAuthority, true);
});

// --- 7) probe：真实入口的机制探针 ----------------------------------------------------

test('probe cases run the real local mechanisms and verify them', () => {
  for (const probeCase of ['pending-cleanup-denial', 'quarantine-restore', 'old-writer-denial', 'authority-transfer']) {
    const result = runCli(['probe', '--case', probeCase, '--json']);
    assert.equal(result.status, 0, `probe ${probeCase} must exit 0\nstdout=${result.stdout}\nstderr=${result.stderr}`);
    const receipt = parseJsonOut(result, `probe-${probeCase}`);
    assert.equal(receipt.interface, 'BackupInfra.v1');
    assert.equal(receipt.case, probeCase);
    assert.equal(receipt.executed, true, `${probeCase} is locally provable and must really execute`);
    assert.equal(receipt.status, 'VERIFIED', `${probeCase}: ${JSON.stringify(receipt.observedSteps ?? receipt.reason)}`);
    assert.doesNotMatch(result.stdout, HOST_PATH_OUTPUT_RE, 'probe receipts must not leak host paths');
  }
  const unknown = runCli(['probe', '--case', 'not-a-case', '--json']);
  assert.equal(unknown.status, 1, 'unknown probe case is an input error');
});

// --- 8) comet-050 原生形态：数据面登记 + 原生状态备份/隔离恢复/R10 读回 -------------
//
// 修订 2026-10-26-comet-050-adoption-v1：Comet 0.5.0 状态在 ~/.comet/workspaces/<id>/
// （runtime/ 的 change-owners + sdk-runs runtime-store checkpoints + state-projections +
// observability/），知识数据在 LLMWiki 项目目录 + Outline 栈（PG/Redis/附件卷）。
// R10 A = 未完成 Run/knowledge 义务保留唯一工作区（retention-policy.json canonical）。
// 套件用与真实宿主逐字节同构的 fixture（comet.change-owner.v1 /
// comet.runtime-store-snapshot.v2 原生 schema）证明机制；真实 ~/.comet 备份恢复的
// 宿主 drill 证据另存 worker-reports/I08-comet-050/（测试作者/宿主证明范围分离）。

// comet-050 fixture：真实 schema 字节的原生 workspace（形状取自真实
// ~/.comet/workspaces/<id> 观察：runtime/change-owners/<owner>/<change>.json、
// runtime/sdk-runs/<owner>/.runtime-store-v2/<hash>/checkpoint.json、
// runtime/state-projections/<owner>/<change>.json、runtime/.change-owner-partitions.json、
// observability/performance.sqlite）。
function makeComet050Workspace(label, {
  workspaceId = 'i08-fixture-ws',
  owner = 'classic',
  change = 'native-assets',
  runId = 'native-assets',
  runStatus = 'running',
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `infra-i08-c050-${label}-`));
  const workspace = path.join(root, workspaceId);
  const files = {};
  const put = (rel, value) => {
    const file = path.join(workspace, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const bytes = typeof value === 'string' || Buffer.isBuffer(value)
      ? Buffer.from(value)
      : Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.writeFileSync(file, bytes);
    files[rel] = bytes;
    return file;
  };
  put(`runtime/change-owners/${owner}/${change}.json`, {
    schema: 'comet.change-owner.v1', workflow: owner, change, format: 'sdk', application: 'classic-full', runId,
  });
  const runHash = sha256(Buffer.from(`${workspaceId}:${runId}`)).slice(0, 64);
  put(`runtime/sdk-runs/${owner}/.runtime-store-v2/${runHash}/checkpoint.json`, {
    schema: 'comet.runtime-store-snapshot.v2',
    record: {
      protocolVersion: 1, schemaVersion: 1, runId, revision: 1,
      initialStateHash: sha256(Buffer.from(`${workspaceId}:initial`)),
      status: runStatus, sequence: 4, actions: [],
    },
    legacyRevision: null,
    hash: sha256(Buffer.from(`${workspaceId}:checkpoint:${runStatus}`)),
  });
  put(`runtime/sdk-runs/${owner}/${runHash}`, Buffer.from(`sdk-run:${runId}\n`));
  put(`runtime/state-projections/${owner}/${change}.json`, {
    schema: 'comet.state-projection.v1', change, runId, projection: 'assets',
  });
  put('runtime/.change-owner-partitions.json', {
    schema: 'comet.change-owner-partitions.v1', token: 'i08-fixture-token', state: 'stable',
  });
  // 二进制观测面（sqlite 是真实备份范围内的二进制字节，fixture 用非文本 buffer 证明字节级复制）。
  put('observability/performance.sqlite', Buffer.from(Array.from({ length: 128 }, (_, i) => (i * 17 + 3) & 0xff)));
  return { root, workspace, files, runHash };
}

// 8.1) 数据面清单登记：五个备份面逐项有 anchor/format/恢复前提，且不带宿主绝对路径。
test('comet-050 data surfaces are registered item by item (anchor/format/restore prerequisites) without host absolute paths', async () => {
  const { scanForForbiddenValues } = await import(secretRefsModuleUrl);
  const policy = readDomainJson('backup-policy.json');
  const surfaces = policy.comet050DataSurfaces?.dataSurfaces ?? policy.dataSurfaces;
  assert.ok(Array.isArray(surfaces) && surfaces.length >= 5, 'the comet-050 backup surfaces must be registered');
  const byId = Object.fromEntries(surfaces.map((surface) => [surface.id, surface]));
  for (const id of ['comet-workspaces', 'llmwiki-project', 'llmwiki-wiki-home', 'outline-stack', 'outline-attachments']) {
    assert.ok(byId[id], `surface ${id} must be registered`);
    assert.ok(typeof byId[id].anchor === 'string' && byId[id].anchor.length > 0, `${id}: anchor (env-anchored, never host-absolute) required`);
    assert.ok(typeof byId[id].format === 'string' && byId[id].format.length > 0, `${id}: format required`);
    assert.ok(Array.isArray(byId[id].restorePrerequisites) && byId[id].restorePrerequisites.length > 0, `${id}: restorePrerequisites required`);
    assert.equal(scanForForbiddenValues(byId[id]).length, 0, `${id}: no host absolute paths / secret values in the registry`);
  }
  // R10 义务种类扩展：未完成的原生 Run 保留唯一工作区（retention-policy canonical）。
  const retentionPolicy = readDomainJson('retention-policy.json');
  assert.ok(retentionPolicy.retention.cleanupDenyWhenPending.includes('unresolved-comet-run'),
    'an unresolved native comet run (checkpoint status != completed) must be a spec-registered pending obligation');
  // 登记后 validate 仍然干净（数据面不破坏既有门）。
  const result = runCli(['validate', '--registry', registryPath, '--json']);
  assert.equal(result.status, 0, `validate must stay green after the data-surface registration\nstdout=${result.stdout}`);
});

// 8.2) 原生备份：manifest 携带原生 Run 身份（change-owner + runtime-store checkpoint）。
test('comet-050 backup: native workspace bytes are captured with the native run identity in the manifest', () => {
  const ws = makeComet050Workspace('bk', { runStatus: 'running' });
  const tg = makeTarget('c050-bk');
  const result = runCli(['backup', '--form', 'comet-050', '--workspace', ws.workspace, '--target', tg.target, '--json']);
  assert.equal(result.status, 0, `comet-050 backup must exit 0\nstdout=${result.stdout}\nstderr=${result.stderr}`);
  const receipt = parseJsonOut(result, 'c050-backup');
  assert.equal(receipt.interface, 'Backup.v1');
  assert.equal(receipt.status, 'VERIFIED');
  assert.equal(receipt.form, 'comet-050');

  const manifest = JSON.parse(fs.readFileSync(path.join(tg.target, receipt.backupId, 'manifest.json'), 'utf8'));
  assert.equal(manifest.form, 'comet-050');
  assert.equal(manifest.source.form, 'comet-050');
  assert.equal(manifest.source.runId, 'native-assets');
  assert.equal(manifest.source.runStatus, 'running');
  assert.equal(manifest.source.workspaceId, 'i08-fixture-ws');
  // 原生身份真实来自 change-owner 与 runtime-store checkpoint（套件独立复核，不信自述）。
  const changeOwner = JSON.parse(fs.readFileSync(path.join(ws.workspace, 'runtime/change-owners/classic/native-assets.json'), 'utf8'));
  assert.equal(manifest.source.runId, changeOwner.runId, 'runId must be read from comet.change-owner.v1');
  // 原生字节全部入册（runtime/** + observability/**），逐文件 sha256 对真实字节。
  for (const [rel, bytes] of Object.entries(ws.files)) {
    const entry = manifest.files.find((item) => item.path === rel);
    assert.ok(entry, `manifest must list native file ${rel}`);
    assert.equal(entry.sha256, sha256(bytes), `${rel}: manifest digest must equal the native bytes`);
    assert.equal(digestFile(path.join(tg.target, receipt.backupId, 'files', rel)), entry.sha256, `${rel}: backup target holds the same bytes`);
  }
  // 点位锚：comet-050 用 runtime-store checkpoint hash 作为一致点位（basis 如实说明）。
  assert.equal(manifest.pointInTime.consistent, true);
  assert.ok(typeof manifest.pointInTime.basis === 'string' && /comet-050/.test(manifest.pointInTime.basis));
});

// 8.3) 原生隔离恢复 + CLI 读回 + R10：恢复后 Run 身份一致；未完成 Run 保留唯一工作区。
test('comet-050 restore: quarantined native restore reads back the same run identity and the unresolved run retains the workspace (R10)', () => {
  const ws = makeComet050Workspace('rs', { runStatus: 'running' });
  const tg = makeTarget('c050-rs');
  const backupResult = runCli(['backup', '--form', 'comet-050', '--workspace', ws.workspace, '--target', tg.target, '--json']);
  assert.equal(backupResult.status, 0);
  const backupId = JSON.parse(backupResult.stdout).backupId;
  const backupDir = path.join(tg.target, backupId);

  const quarantine = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'infra-i08-c050-quar-')), 'quarantine');
  const result = runCli(['restore', '--form', 'comet-050', '--backup', backupDir, '--quarantine', quarantine, '--fence-evidence', fenceEvidence(), '--json']);
  assert.equal(result.status, 0, `comet-050 restore must exit 0\nstdout=${result.stdout}\nstderr=${result.stderr}`);
  const receipt = parseJsonOut(result, 'c050-restore');
  assert.equal(receipt.status, 'RELEASED');
  // 同 operation 读回：恢复区由 CLI 重新解析原生 schema，比对 runId/change/owner/runStatus。
  assert.equal(receipt.sameOperation.verified, true);
  assert.equal(receipt.sameOperation.runId, 'native-assets');
  assert.equal(receipt.sameOperation.runStatus, 'running');
  assert.equal(receipt.readback.form, 'comet-050');
  assert.ok(receipt.readback.nativeSchemasRead.includes('comet.change-owner.v1'));
  assert.ok(receipt.readback.nativeSchemasRead.includes('comet.runtime-store-snapshot.v2'));
  // 恢复区字节与源逐字节一致。
  for (const [rel, bytes] of Object.entries(ws.files)) {
    const restored = path.join(quarantine, rel);
    assert.equal(fs.existsSync(restored), true, `${rel} must be restored`);
    assert.equal(Buffer.compare(fs.readFileSync(restored), bytes), 0, `${rel} must be byte-identical`);
  }
  // 释放记录仍冻结发布、单 writer。
  const release = JSON.parse(fs.readFileSync(path.join(quarantine, 'release-record.json'), 'utf8'));
  assert.equal(release.publishFrozen, true);
  assert.equal(release.singleWriter, true);

  // R10 A：恢复区跑 retention —— checkpoint status=running → unresolved-comet-run → cleanup DENIED。
  const retention = runCli(['retention', '--form', 'comet-050', '--workspace', quarantine, '--json']);
  assert.equal(retention.status, 2, 'an unresolved native run must deny cleanup');
  const verdict = parseJsonOut(retention, 'c050-retention');
  assert.equal(verdict.cleanup, 'DENIED');
  assert.ok(verdict.pending.some((item) => item.kind === 'unresolved-comet-run' && item.id === 'native-assets'),
    `pending must name the unresolved native run: ${JSON.stringify(verdict.pending)}`);
  assert.equal(verdict.r10.ruleA, 'RETAIN_SOLE_WORKSPACE');
});

// 8.4) 负向：completed 原生 Run 才放行 retention；活旧 writer / 二 writer 仍拒绝恢复。
test('comet-050 negatives: a completed native run releases retention; a live old writer or a live second writer refuses the restore', async () => {
  // completed → ELIGIBLE（verified-completed）。
  {
    const ws = makeComet050Workspace('done', { runStatus: 'completed' });
    const result = runCli(['retention', '--form', 'comet-050', '--workspace', ws.workspace, '--json']);
    assert.equal(result.status, 0, `completed run must be eligible\nstdout=${result.stdout}`);
    const verdict = parseJsonOut(result, 'c050-retention-done');
    assert.equal(verdict.cleanup, 'ELIGIBLE');
    assert.equal(verdict.basis, 'verified-completed');
    assert.equal(verdict.pending.length, 0);
  }
  // 非法 runStatus（不是 completed 的都算未闭合）→ DENIED。
  {
    const ws = makeComet050Workspace('failed-status', { runStatus: 'failed' });
    const result = runCli(['retention', '--form', 'comet-050', '--workspace', ws.workspace, '--json']);
    assert.equal(result.status, 2, 'a failed native run is not a verified completion');
    assert.ok(parseJsonOut(result, 'c050-retention-failed').pending.some((item) => item.kind === 'unresolved-comet-run'));
  }
  // 活旧 writer：真实存活 pid → 恢复拒绝（原生形态同样强制进程级 fence）。
  {
    const ws = makeComet050Workspace('live', { runStatus: 'running' });
    const tg = makeTarget('c050-live');
    const backupResult = runCli(['backup', '--form', 'comet-050', '--workspace', ws.workspace, '--target', tg.target, '--json']);
    assert.equal(backupResult.status, 0);
    const backupDir = path.join(tg.target, JSON.parse(backupResult.stdout).backupId);
    const child = spawnLiveChild();
    try {
      assert.equal(await waitUntilAlive(child.pid), true, 'fixture old writer must be alive');
      const quarantine = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'infra-i08-c050-quar-')), 'q');
      const liveFence = fenceEvidence({ pid: child.pid, confirmedGone: true, method: 'claimed' });
      const refused = runCli(['restore', '--form', 'comet-050', '--backup', backupDir, '--quarantine', quarantine, '--fence-evidence', liveFence, '--json']);
      assert.equal(refused.status, 2, 'a live old writer must refuse the comet-050 restore');
      const receipt = parseJsonOut(refused, 'c050-live-writer');
      assert.ok(receipt.refusals.some((refusal) => refusal.code === 'RESTORE_REFUSED_OLD_WRITER_LIVE'));
      assert.equal(fs.existsSync(path.join(quarantine, 'release-record.json')), false, 'nothing releases while the old writer lives');

      // 二 writer：恢复目标已有真实存活 writer → 拒绝（不复制出一套可并行运行的业务状态）。
      fs.mkdirSync(quarantine, { recursive: true });
      fs.writeFileSync(path.join(quarantine, 'writer-lock.json'), `${JSON.stringify({ pid: child.pid }, null, 2)}\n`);
      const second = runCli(['restore', '--form', 'comet-050', '--backup', backupDir, '--quarantine', quarantine, '--fence-evidence', fenceEvidence(), '--json']);
      assert.equal(second.status, 2, 'restoring native state next to a live writer must refuse');
      assert.ok(parseJsonOut(second, 'c050-second-writer').refusals.some((refusal) => refusal.code === 'RESTORE_REFUSED_SECOND_WRITER'));
    } finally {
      child.kill('SIGKILL');
    }
  }
  // 缺原生身份（无 change-owner）→ 备份拒绝（fail-closed，不静默当普通目录）。
  {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'infra-i08-c050-bad-'));
    fs.mkdirSync(path.join(root, 'runtime'), { recursive: true });
    const tg = makeTarget('c050-bad');
    const result = runCli(['backup', '--form', 'comet-050', '--workspace', root, '--target', tg.target, '--json']);
    assert.equal(result.status, 2, 'a directory without native comet identity must refuse the comet-050 backup');
    assert.ok(parseJsonOut(result, 'c050-bad').refusals.some((refusal) => refusal.code === 'WORKSPACE_INVALID'));
  }
});

// 8.5) probe：原生旅程端到端机制探针。
test('probe comet-050-restore runs the native backup/restore/readback/R10 journey end to end', () => {
  const result = runCli(['probe', '--case', 'comet-050-restore', '--json']);
  assert.equal(result.status, 0, `probe comet-050-restore must exit 0\nstdout=${result.stdout}\nstderr=${result.stderr}`);
  const receipt = parseJsonOut(result, 'probe-c050');
  assert.equal(receipt.case, 'comet-050-restore');
  assert.equal(receipt.executed, true);
  assert.equal(receipt.status, 'VERIFIED', JSON.stringify(receipt.observedSteps ?? receipt.reason));
  assert.doesNotMatch(result.stdout, HOST_PATH_OUTPUT_RE);
});

#!/usr/bin/env node
// BackupInfra.v1 / Backup.v1 / Restore.v1 / Retention.v1 / AuthorityTransfer.v1 CLI
//   — validate | backup | restore | retention | transfer | probe
//
// Canonical I08 entry (rework naming migration): tools/infra/recovery.mjs with the
// recovery domain dir infra/delivery/recovery/. The legacy entry tools/infra/
// recovery.mjs is a compatibility shim delegating here with the legacy
// domain dir infra/delivery/backup/; receipts and the exit-code contract are
// identical (one implementation, one main()).
//
// I08 只做本地可证明的机制：目录形态 Registry/备份目标就是真实被测物（真实 sha256 对
// 真实字节，零 mock）。恢复进隔离区 → 认证当前权限 → 进程级隔离旧 writer → 验证同
// operation 与独立读回后才释放；不回放旧 ACL、不重加离组成员、不复用已撤销代码源缓存、
// 不复制状态另开 writer。R10 A：pending 义务存在时 cleanup 实际拒绝，磁盘压力只告警。
// 秘密值永不读写：三个 ref（backup-writer / backup-encryption / restore-reader）只引用，
// 解析属 I01 只读门（UNRESOLVED / REF_NOT_REGISTERED 如实上报）。
//
// 退出码契约（execution-contract.json V_INFRA_I08.cli_contract）：
//   0 = PASS（validate 通过 / backup VERIFIED / restore RELEASED / retention ELIGIBLE /
//       transfer TRANSFERRED / probe VERIFIED）
//   1 = 输入或前置无效（文件缺失/不可解析、参数错误、未知 probe case）
//   2 = 验证失败（语义违规、备份不一致、恢复拒绝、cleanup 拒绝、迁移拒绝、UNVERIFIED）
//   环境缺失必须显式 UNVERIFIED 并以非零退出，不允许 skip 转 PASS。
//
// 环境事实（2026-10-21）：docker EPERM、gh TLS 失效、无真实 Outline —— 跨机/真实服务
// 恢复在回执中如实 UNVERIFIED（承接者：备份 owner + 部署波次），绝不虚报。

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseSecretRef, scanForForbiddenValues } from './secret-refs.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const EXIT_PASS = 0;
const EXIT_INPUT = 1;
const EXIT_VERIFY = 2;
const DEFAULT_REGISTRY = path.join(repoRoot, 'infra', 'delivery', 'registry.json');
const DEFAULT_REFS = path.join(repoRoot, 'infra', 'delivery', 'secrets.refs.example.json');
// Canonical recovery 域目录；BackupRegistry.v1（registry.json）单源保留在 legacy 域
// 目录 infra/delivery/backup/，canonical 默认目录经下方显式 fail-closed fallback 读取。
const DEFAULT_DIR = path.join(repoRoot, 'infra', 'delivery', 'recovery');
const LEGACY_DOMAIN_DIR = path.join(repoRoot, 'infra', 'delivery', 'backup');
const POLICY_FILES = ['backup-policy.json', 'restore-policy.json', 'retention-policy.json', 'authority-transfer.schema.json'];
const REGISTRY_FILE = 'registry.json';

// 规格冻结（infrastructure-plan.md I08 RED 第一条）：pending 义务清单至少覆盖这三类。
const SPEC_PENDING_OBLIGATIONS = ['pending-outline-publish', 'unknown-remote-result', 'sole-payload-in-workspace'];
// 进程级 fencing 接受的终止证据方法；共享目录重新登记是冒充，不是 fencing。
const PROCESS_FENCE_METHODS = ['SIGKILL', 'SIGTERM', 'process-exit-confirmed'];
const SECTIONS_WITH_VERSIONS = ['approvals'];
const CACHE_DIRECTORY = 'cache/';

// 宿主私有路径绝不进入结构化回执/报告；对外输出统一脱敏（与 secret-refs 的 ABSOLUTE_PATH_FORBIDDEN 同源规则）。
const HOST_PATH_REDACTION = /(^|[\s"'=(:/])\/(Users|home|root|private|var|usr|etc|opt|tmp)\/\S*/g;
const redactHostPaths = (text) => String(text ?? '').replace(HOST_PATH_REDACTION, '$1<host-path-redacted>');

// 结构化输出里的文件字段一律 repo 相对；repo 之外（fixture/临时文件）则复用宿主路径脱敏。
const displayPath = (file) => {
  const rel = path.relative(repoRoot, String(file ?? ''));
  return rel.startsWith('..') ? redactHostPaths(String(file)) : rel;
};

const REAL_SERVICE_RESTORE = () => ({
  status: 'UNVERIFIED',
  reason: 'cross-machine and real-service restore can only be proven by the backup owner together with the deployment wave; this receipt covers the local directory-form mechanism only',
  successor: 'backup owner + deployment wave (infrastructure-plan.md 交接前置输入 #6)',
});

function usage() {
  return [
    'usage:',
    '  recovery.mjs validate  --registry <file> [--dir <recovery domain dir>] [--refs <file>] [--json]',
    '  recovery.mjs backup    --workspace <dir> --target <dir> [--dir <recovery domain dir>] [--json]',
    '  recovery.mjs restore   --backup <dir> --quarantine <dir> [--fence-evidence <file>] [--dir <recovery domain dir>] [--json]',
    '  recovery.mjs retention --workspace <dir> [--disk-pressure <file>] [--migration-approval <file>] [--restore-proof <file>] [--dir <recovery domain dir>] [--json]',
    '  recovery.mjs transfer  --state <run-state.json> --approval <file> --fence-evidence <file> --out <file> [--json]',
    '  recovery.mjs probe     --case <pending-cleanup-denial|quarantine-restore|old-writer-denial|authority-transfer> [--json]',
  ].join('\n');
}

function parseArgs(argv) {
  const opts = { _: [] };
  const command = argv[0];
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') {
      opts.json = true;
    } else if (arg.startsWith('--')) {
      const value = argv[++i];
      if (value === undefined) return { command, opts, error: `missing value for ${arg}` };
      opts[arg.slice(2)] = value;
    } else {
      opts._.push(arg);
    }
  }
  return { command, opts };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function print(payload) {
  process.stdout.write(JSON.stringify({ ...payload, checkedAt: new Date().toISOString() }, null, 2) + '\n');
}

function failInput(message) {
  process.stderr.write(`${message}\n${usage()}\n`);
  return EXIT_INPUT;
}

const sha256Bytes = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const sha256File = (file) => sha256Bytes(fs.readFileSync(file));

// 门禁必须 fail-closed：恢复域文件缺失/不可解析 = 前置无效，绝不静默降级为空规则。
// registry.json 只在 canonical 默认目录缺席时回退到 legacy 单源（backup/registry.json）；
// 其余任何 --dir 必须自带 registry.json，绝不静默回退到活配置。
function loadDomain(dir) {
  const docs = {};
  for (const name of POLICY_FILES) {
    const file = path.join(dir, name);
    try {
      docs[name] = readJson(file);
    } catch (error) {
      return { error: `recovery domain file unreadable (${displayPath(file)}): ${redactHostPaths(error.message)}` };
    }
  }
  const registryFile = path.join(dir, REGISTRY_FILE);
  const useLegacyFallback = !fs.existsSync(registryFile) && path.resolve(dir) === path.resolve(DEFAULT_DIR);
  const registrySource = useLegacyFallback ? path.join(LEGACY_DOMAIN_DIR, REGISTRY_FILE) : registryFile;
  try {
    docs[REGISTRY_FILE] = readJson(registrySource);
  } catch (error) {
    return { error: `recovery domain file unreadable (${displayPath(registrySource)}): ${redactHostPaths(error.message)}` };
  }
  return { docs };
}

// --- workspace 读取与一致性 ---------------------------------------------------------

// 递归收集工作区文件（跳过已撤销代码源缓存目录，绝不复制其字节）。
function listWorkspaceFiles(workspace) {
  const out = [];
  const visit = (dir, prefix) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (rel === CACHE_DIRECTORY.slice(0, -1)) continue;
        visit(path.join(dir, entry.name), rel);
      } else if (entry.isFile()) {
        out.push(rel);
      }
    }
  };
  visit(workspace, '');
  return out;
}

function fileEntry(workspace, rel) {
  const bytes = fs.readFileSync(path.join(workspace, rel));
  const entry = { path: rel, sha256: sha256Bytes(bytes), bytes: bytes.length, section: rel.split('/')[0] };
  if (SECTIONS_WITH_VERSIONS.includes(entry.section)) {
    try {
      const payload = JSON.parse(bytes.toString('utf8'));
      if (typeof payload?.version === 'string') entry.version = payload.version;
    } catch {
      // 非构造 payload：无版本可记录，如实缺省。
    }
  }
  return entry;
}

function readRunState(workspace) {
  return readJson(path.join(workspace, 'run-state.json'));
}

const refusal = (code, reason) => ({ code, reason });
const refusedReceipt = (base, code, reason) => ({ ...base, status: 'REFUSED', refusals: [refusal(code, reason)] });

// --- Backup.v1 ---------------------------------------------------------------------

function backupWorkspace({ workspace, target, domain }) {
  const registry = domain['registry.json'];
  const policy = domain['backup-policy.json'];
  const base = { interface: 'Backup.v1', command: 'backup', capabilityScope: 'LOCAL_DIRECTORY_FORM', realRemoteBackup: REAL_SERVICE_RESTORE() };

  let runState;
  try {
    runState = readRunState(workspace);
  } catch (error) {
    return { receipt: refusedReceipt(base, 'WORKSPACE_INVALID', `run-state.json unreadable: ${redactHostPaths(error.message)}`), exit: EXIT_VERIFY };
  }
  if (!runState?.authorityId || !Number.isInteger(runState?.epoch) || !runState?.runId) {
    return { receipt: refusedReceipt(base, 'WORKSPACE_INVALID', 'run-state.json must carry authorityId, epoch and runId'), exit: EXIT_VERIFY };
  }

  // 一致性门：存在 open 事务 = 没有一致点位，拒绝备份（fail-closed）。
  const transactionsDir = path.join(workspace, 'transactions');
  const openTransactions = [];
  const committedTransactions = [];
  if (fs.existsSync(transactionsDir)) {
    for (const rel of listWorkspaceFiles(transactionsDir)) {
      try {
        const txn = JSON.parse(fs.readFileSync(path.join(transactionsDir, rel), 'utf8'));
        if (txn?.state === 'open') openTransactions.push(txn.txnId ?? rel);
        else if (txn?.state === 'committed') committedTransactions.push(txn.txnId ?? rel);
      } catch {
        openTransactions.push(rel);
      }
    }
  }
  if (openTransactions.length > 0) {
    return {
      receipt: refusedReceipt(base, 'BACKUP_CONSISTENCY_REFUSED', `open transaction(s) leave no consistent point in time: ${openTransactions.join(', ')}`),
      exit: EXIT_VERIFY,
    };
  }

  const watermark = (section) => {
    const file = path.join(workspace, section, 'watermark.json');
    try {
      return readJson(file).pointInTime ?? null;
    } catch {
      return null;
    }
  };
  const dbWatermark = watermark('db');
  const objectsWatermark = watermark('objects');

  const rels = listWorkspaceFiles(workspace);
  const files = rels.map((rel) => fileEntry(workspace, rel));
  const manifest = {
    schemaVersion: 1,
    interface: 'Backup.v1',
    backupId: `backup-${new Date().toISOString().replace(/[-:.]/g, '')}-${process.pid}`,
    createdAt: new Date().toISOString(),
    source: { authorityId: runState.authorityId, epoch: runState.epoch, runId: runState.runId },
    files,
    transactions: { committed: committedTransactions, open: openTransactions },
    pointInTime: { db: dbWatermark, objects: objectsWatermark, consistent: dbWatermark !== null && dbWatermark === objectsWatermark },
    encryptionRefs: policy?.encryption?.refs ?? [],
    restoreReaderRef: domain['restore-policy.json']?.restoreReaderRef ?? null,
    credentialRefs: collectDomainRefs(domain),
    cacheRefs: [
      {
        ref: 'code-source-cache',
        directory: CACHE_DIRECTORY,
        policyStatus: policy?.cacheRefs?.codeSourceCache?.policyStatus ?? 'REVOKED_NOT_RESTORED',
        restored: false,
      },
    ],
    aclSnapshot: readPermissionSnapshot(workspace),
    retention: {
      rpo: registry?.retention?.rpo ?? 'UNVERIFIED',
      rto: registry?.retention?.rto ?? 'UNVERIFIED',
    },
  };

  const backupDir = path.join(target, manifest.backupId);
  const filesDir = path.join(backupDir, 'files');
  fs.mkdirSync(filesDir, { recursive: true });
  for (const rel of rels) {
    const dest = path.join(filesDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(workspace, rel), dest);
  }
  fs.writeFileSync(path.join(backupDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  // 写后验证：对目标真实字节逐文件重算 sha256，任何不符整个备份 VERIFIED 失败。
  const digestsVerified = files.every((entry) => {
    const copied = path.join(filesDir, entry.path);
    return fs.existsSync(copied) && sha256File(copied) === entry.sha256 && fs.statSync(copied).size === entry.bytes;
  });
  if (!digestsVerified) {
    return { receipt: refusedReceipt(base, 'BACKUP_POSTWRITE_MISMATCH', 'the copied target bytes no longer match the manifest; the backup is not trusted'), exit: EXIT_VERIFY };
  }

  return {
    receipt: {
      ...base,
      status: 'VERIFIED',
      backupId: manifest.backupId,
      manifestPath: displayPath(path.join(backupDir, 'manifest.json')),
      filesCount: files.length,
      bytesTotal: files.reduce((sum, entry) => sum + entry.bytes, 0),
      digestsVerified: true,
      pointInTime: manifest.pointInTime,
      credentialRefsRecorded: manifest.credentialRefs,
    },
    exit: EXIT_PASS,
  };
}

function readPermissionSnapshot(workspace) {
  const read = (section) => {
    const file = path.join(workspace, 'permissions', `${section}.json`);
    try {
      return readJson(file);
    } catch {
      return null;
    }
  };
  const acl = read('acl');
  const members = read('members');
  return {
    entries: Array.isArray(acl?.entries) ? acl.entries : [],
    members: Array.isArray(members?.members) ? members.members : [],
    source: { aclFile: acl ? 'permissions/acl.json' : null, membersFile: members ? 'permissions/members.json' : null },
  };
}

// --- Restore.v1 ---------------------------------------------------------------------

function verifyBackupBytes(baseDir, manifest, { filesSubdir = true } = {}) {
  const problems = [];
  for (const entry of manifest.files ?? []) {
    const file = filesSubdir ? path.join(baseDir, 'files', entry.path) : path.join(baseDir, entry.path);
    if (!fs.existsSync(file)) {
      problems.push(`missing: ${entry.path}`);
      continue;
    }
    if (sha256File(file) !== entry.sha256) problems.push(`digest mismatch: ${entry.path}`);
  }
  return problems;
}

// fence 证据评估：真实 pid liveness 优先（任何 gone-claim 都被存活事实戳穿），
// 然后是进程级方法（共享目录重新登记是冒充）与 gone 确认。
// 同一评估被 restore 与 transfer 共用；不同命令使用各自的拒绝码前缀。
function evaluateFence({ fenceFile, codes, purpose }) {
  if (!fenceFile) {
    return { refusal: refusal(codes.notFenced, `${purpose} requires old-writer fence evidence; an unfenced restore must never enable`) };
  }
  let fence;
  try {
    fence = readJson(fenceFile);
  } catch (error) {
    return { refusal: refusal(codes.notFenced, `fence evidence unreadable: ${redactHostPaths(error.message)}`) };
  }
  if (Number.isInteger(fence?.pid)) {
    let alive = false;
    try {
      process.kill(fence.pid, 0);
      alive = true;
    } catch {
      alive = false;
    }
    if (alive) {
      return { refusal: refusal(codes.live, `old writer pid ${fence.pid} is still alive; the gone-claim is refuted by a real liveness check`) };
    }
  }
  if (!PROCESS_FENCE_METHODS.includes(fence?.method)) {
    return { refusal: refusal(codes.masquerade, `fence method ${JSON.stringify(fence?.method ?? null)} is not process-level evidence; a shared directory must never masquerade as distributed fencing`) };
  }
  if (fence?.confirmedGone !== true) {
    return { refusal: refusal(codes.notFenced, 'the fence evidence does not confirm the old writer is gone') };
  }
  return {
    fence: {
      oldWriterId: fence.oldWriterId ?? null,
      method: fence.method,
      confirmedGone: true,
      pid: Number.isInteger(fence.pid) ? fence.pid : null,
      liveness: Number.isInteger(fence.pid) ? 'CONFIRMED_GONE' : 'NOT_CHECKED',
      observedAt: fence.observedAt ?? null,
    },
  };
}

function restoreBackup({ backupDir, quarantine, fenceFile, domain, refsDoc }) {
  const policy = domain['restore-policy.json'];
  const base = { interface: 'Restore.v1', command: 'restore', capabilityScope: 'LOCAL_DIRECTORY_FORM', realServiceRestore: REAL_SERVICE_RESTORE(), refusals: [] };

  let manifest;
  try {
    manifest = readJson(path.join(backupDir, 'manifest.json'));
  } catch (error) {
    return { receipt: refusedReceipt(base, 'BACKUP_INVALID_INPUT', `backup manifest unreadable: ${redactHostPaths(error.message)}`), exit: EXIT_INPUT };
  }
  if (manifest?.interface !== 'Backup.v1') {
    return { receipt: refusedReceipt(base, 'BACKUP_INVALID_INPUT', 'manifest interface must be Backup.v1'), exit: EXIT_VERIFY };
  }

  // 1) 备份完整性：逐文件对真实字节重算 digest；不完整/不符 = 恢复不启用。
  const problems = verifyBackupBytes(backupDir, manifest);
  if (problems.length > 0) {
    return { receipt: refusedReceipt(base, 'RESTORE_BACKUP_INVALID', `incomplete or corrupted backup (first problems: ${problems.slice(0, 5).join('; ')})`), exit: EXIT_VERIFY };
  }

  // 2) 密钥可用性：加密密钥 ref 必须已登记（解析本身如实 UNRESOLVED——无运行时 secret store）。
  const encryptionRefs = (manifest.encryptionRefs ?? []).map((ref) => ({
    ref,
    registered: isRefRegistered(refsDoc, ref),
  }));
  const restoreReader = {
    ref: manifest.restoreReaderRef,
    registered: isRefRegistered(refsDoc, manifest.restoreReaderRef),
  };
  if (encryptionRefs.length === 0 || encryptionRefs.some((item) => !item.registered)) {
    return {
      receipt: {
        ...refusedReceipt(base, 'RESTORE_KEY_UNAVAILABLE', 'the backup encryption key reference is missing or not registered; restoration stops if the key is unavailable'),
        keyAvailability: { encryptionRefs, restoreReaderRef: restoreReader, runtimeResolution: 'UNRESOLVED_NO_RUNTIME_SECRET_STORE' },
      },
      exit: EXIT_VERIFY,
    };
  }

  // 3) 点位一致：db 与 objects 水位必须一致。
  if (manifest.pointInTime?.consistent !== true || manifest.pointInTime?.db !== manifest.pointInTime?.objects) {
    return {
      receipt: refusedReceipt(base, 'RESTORE_POINT_IN_TIME_INCONSISTENT', `db watermark ${JSON.stringify(manifest.pointInTime?.db ?? null)} and objects watermark ${JSON.stringify(manifest.pointInTime?.objects ?? null)} disagree; a point-in-time inconsistent backup never enables a restore`),
      exit: EXIT_VERIFY,
    };
  }

  // 4) 第二 writer 门：恢复目标已有真实存活 writer → 拒绝复制状态另开 writer。
  const writerLockFile = path.join(quarantine, 'writer-lock.json');
  if (fs.existsSync(writerLockFile)) {
    try {
      const lock = readJson(writerLockFile);
      let alive = false;
      try {
        process.kill(lock.pid, 0);
        alive = true;
      } catch {
        alive = false;
      }
      if (alive) {
        return { receipt: refusedReceipt(base, 'RESTORE_REFUSED_SECOND_WRITER', `the quarantine target already carries a live writer (pid ${lock.pid}); copying state to a second writer is forbidden`), exit: EXIT_VERIFY };
      }
    } catch {
      // 不可读的 lock 不构成存活证据，继续。
    }
  }

  // 5) 旧 writer 进程级隔离。
  const fenceOutcome = evaluateFence({
    fenceFile,
    codes: { notFenced: 'RESTORE_REFUSED_OLD_WRITER_NOT_FENCED', masquerade: 'RESTORE_REFUSED_OLD_WRITER_MASQUERADE', live: 'RESTORE_REFUSED_OLD_WRITER_LIVE' },
    purpose: 'restore',
  });
  if (fenceOutcome.refusal) {
    return { receipt: { ...refusedReceipt(base, fenceOutcome.refusal.code, fenceOutcome.refusal.reason), keyAvailability: { encryptionRefs, restoreReaderRef: restoreReader, runtimeResolution: 'UNRESOLVED_NO_RUNTIME_SECRET_STORE' } }, exit: EXIT_VERIFY };
  }

  // 6) 恢复进隔离区：逐文件真实复制 + 写后重验。
  fs.mkdirSync(quarantine, { recursive: true });
  for (const entry of manifest.files) {
    const dest = path.join(quarantine, entry.path);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(backupDir, 'files', entry.path), dest);
  }
  const readbackProblems = verifyBackupBytes(quarantine, { files: manifest.files }, { filesSubdir: false });
  if (readbackProblems.length > 0) {
    return { receipt: refusedReceipt(base, 'RESTORE_READBACK_MISMATCH', `the restored quarantine failed the independent byte readback (first problems: ${readbackProblems.slice(0, 5).join('; ')})`), exit: EXIT_VERIFY };
  }

  // 7) 权限对账：ACL/成员只是数据——不回放、不回填、需当前权限重新认证；
  //    旧 epoch 的 attempt 回执被排除出当前状态；撤销缓存绝不恢复。
  const restoredRunState = readRunState(quarantine);
  const currentEpoch = restoredRunState?.epoch ?? null;
  const excludedSuperseded = [];
  const operationsDir = path.join(quarantine, 'operations');
  if (fs.existsSync(operationsDir)) {
    for (const rel of listWorkspaceFiles(operationsDir)) {
      if (!rel.includes('receipt')) continue;
      try {
        const receiptDoc = JSON.parse(fs.readFileSync(path.join(operationsDir, rel), 'utf8'));
        if (typeof receiptDoc?.epoch === 'number' && typeof currentEpoch === 'number' && receiptDoc.epoch < currentEpoch) {
          excludedSuperseded.push({ path: `operations/${path.basename(rel)}`, epoch: receiptDoc.epoch, currentEpoch, reason: 'superseded attempt result stays excluded from current state' });
        }
      } catch {
        // 非构造回执：不纳入排除判断，如实保留原样。
      }
    }
  }
  const reconciliation = {
    schemaVersion: 1,
    interface: 'RestoreReconciliation.v1',
    reAuthenticateFromCurrentAuthority: true,
    restoredAclIsDataOnly: true,
    aclEntries: (manifest.aclSnapshot?.entries ?? []).map((entry) => ({ ...entry, applied: false, replayed: false })),
    members: (manifest.aclSnapshot?.members ?? []).map((member) => ({
      ...member,
      readmitted: false,
      reason: member.status === 'offline'
        ? 'offline member is never readmitted by a restore'
        : 'membership is data only; readmission requires current-authority re-authentication',
    })),
    excludedSuperseded,
    revokedCacheRestored: false,
    note: policy?.permissionReconciliation?.note ?? 'restored permissions are data; the current authority re-authenticates before anything is applied',
  };
  fs.writeFileSync(path.join(quarantine, 'restore-reconciliation.json'), `${JSON.stringify(reconciliation, null, 2)}\n`);

  // 8) 同 operation 验证 + 释放记录。
  const sameOperation = {
    verified: manifest.source?.runId === restoredRunState?.runId
      && manifest.source?.authorityId === restoredRunState?.authorityId
      && manifest.source?.epoch === restoredRunState?.epoch,
    runId: restoredRunState?.runId ?? null,
    authorityId: restoredRunState?.authorityId ?? null,
    epoch: restoredRunState?.epoch ?? null,
  };
  if (!sameOperation.verified) {
    return { receipt: { ...refusedReceipt(base, 'RESTORE_SAME_OPERATION_UNVERIFIED', 'the restored run/operation identity does not match the backup manifest'), sameOperation }, exit: EXIT_VERIFY };
  }
  const release = {
    schemaVersion: 1,
    interface: 'RestoreRelease.v1',
    publishFrozen: true,
    singleWriter: true,
    sameOperation,
    releasedAt: new Date().toISOString(),
    note: 'the quarantined restore is verified; the same Comet continues and re-authenticates permissions before any apply',
  };
  fs.writeFileSync(path.join(quarantine, 'release-record.json'), `${JSON.stringify(release, null, 2)}\n`);

  return {
    receipt: {
      ...base,
      status: 'RELEASED',
      backup: displayPath(backupDir),
      quarantine: displayPath(quarantine),
      keyAvailability: { encryptionRefs, restoreReaderRef: restoreReader, runtimeResolution: 'UNRESOLVED_NO_RUNTIME_SECRET_STORE' },
      fence: fenceOutcome.fence,
      sameOperation,
      filesRestored: manifest.files.length,
      reconciliationFile: 'restore-reconciliation.json',
      releaseFile: 'release-record.json',
      refusals: [],
    },
    exit: EXIT_PASS,
  };
}

// --- Retention.v1（R10 A）-----------------------------------------------------------

function scanPendingObligations(workspace) {
  const pending = [];
  const transactionsDir = path.join(workspace, 'transactions');
  if (fs.existsSync(transactionsDir)) {
    for (const rel of listWorkspaceFiles(transactionsDir)) {
      try {
        const txn = JSON.parse(fs.readFileSync(path.join(transactionsDir, rel), 'utf8'));
        if (txn?.state === 'open') pending.push({ kind: 'open-transaction', id: txn.txnId ?? rel, detail: 'an open transaction leaves the run unresolved' });
      } catch {
        pending.push({ kind: 'open-transaction', id: rel, detail: 'unparseable transaction record' });
      }
    }
  }
  const operationsDir = path.join(workspace, 'operations');
  if (fs.existsSync(operationsDir)) {
    const rels = listWorkspaceFiles(operationsDir);
    for (const rel of rels.filter((item) => item.endsWith('.dispatch.json'))) {
      let dispatch;
      try {
        dispatch = JSON.parse(fs.readFileSync(path.join(operationsDir, rel), 'utf8'));
      } catch {
        pending.push({ kind: 'unknown-remote-result', id: rel, detail: 'unparseable dispatch record' });
        continue;
      }
      const opId = dispatch?.opId ?? path.basename(rel, '.dispatch.json');
      // 只有当前回执闭合义务；旧 epoch 的迟到/陈旧回执不闭合任何义务。
      const receiptExists = fs.existsSync(path.join(operationsDir, `${opId}.receipt.json`));
      if (!receiptExists) {
        if (dispatch?.remote === true) {
          pending.push({ kind: 'unknown-remote-result', id: opId, detail: 'a remote dispatch exists without its receipt; the remote result is unknown' });
        }
        if (dispatch?.kind === 'outline-publish') {
          pending.push({ kind: 'pending-outline-publish', id: opId, detail: 'a pending Outline publish obligation retains the sole workspace' });
        }
      }
    }
  }
  const knowledgeDir = path.join(workspace, 'knowledge');
  if (fs.existsSync(knowledgeDir)) {
    for (const rel of listWorkspaceFiles(knowledgeDir)) {
      try {
        const item = JSON.parse(fs.readFileSync(path.join(knowledgeDir, rel), 'utf8'));
        if (item?.state === 'pending') pending.push({ kind: 'pending-knowledge-closeout', id: item.itemId ?? rel, detail: 'a pending knowledge closeout obligation retains the sole workspace' });
      } catch {
        pending.push({ kind: 'pending-knowledge-closeout', id: rel, detail: 'unparseable knowledge obligation record' });
      }
    }
  }
  const approvalsDir = path.join(workspace, 'approvals');
  if (fs.existsSync(approvalsDir)) {
    for (const rel of listWorkspaceFiles(approvalsDir)) {
      try {
        const payload = JSON.parse(fs.readFileSync(path.join(approvalsDir, rel), 'utf8'));
        if (payload?.soleCopy === true) pending.push({ kind: 'sole-payload-in-workspace', id: payload.payloadId ?? rel, detail: 'the only copy of an approved payload lives in this workspace' });
      } catch {
        pending.push({ kind: 'sole-payload-in-workspace', id: rel, detail: 'unparseable approval payload record' });
      }
    }
  }
  return pending;
}

function readOptionalJson(file) {
  if (!file) return { ok: false, missing: true };
  try {
    return { ok: true, value: readJson(file) };
  } catch (error) {
    return { ok: false, error: redactHostPaths(error.message) };
  }
}

function runRetention({ workspace, policy, pressureFile, approvalFile, proofFile }) {
  const base = {
    interface: 'Retention.v1',
    command: 'retention',
    workspace: displayPath(workspace),
    r10: { ruleA: 'RETAIN_SOLE_WORKSPACE', ruleAText: policy?.retention?.ruleA ?? null },
    toolPerformsDeletion: false,
  };

  if (!fs.existsSync(workspace) || !fs.existsSync(path.join(workspace, 'run-state.json'))) {
    return { receipt: refusedReceipt(base, 'WORKSPACE_INVALID', 'the workspace directory with run-state.json is required'), exit: EXIT_INPUT };
  }

  const pending = scanPendingObligations(workspace);

  // 磁盘压力只告警：记录告警事实，永远不触发清理。
  const pressure = readOptionalJson(pressureFile);
  const diskPressure = {
    warned: pressure.ok,
    cleanup: false,
    ...(pressure.ok ? { record: pressure.value } : {}),
    ...(pressureFile && !pressure.ok ? { error: pressure.error } : {}),
  };

  const specFrozen = (policy?.retention?.cleanupDenyWhenPending ?? []).filter((kind) => SPEC_PENDING_OBLIGATIONS.includes(kind));

  let cleanup = 'ELIGIBLE';
  let basis = 'verified-completed';
  const pendingReasons = [];
  if (pending.length > 0) {
    const approval = readOptionalJson(approvalFile);
    const proof = readOptionalJson(proofFile);
    const approvalValid = approval.ok && approval.value?.approvalId && approval.value?.approvedBy && approval.value?.approvalRef && approval.value?.approvedAt;
    const proofValid = proof.ok && proof.value?.verified === true && proof.value?.sameOperationReadback === true;
    if (approvalValid && proofValid) {
      basis = 'approved-migration-with-proven-restore';
    } else {
      cleanup = 'DENIED';
      basis = null;
      pendingReasons.push(`cleanup requires verified completion or a separately approved migration whose restore has been proven (R10 A; spec-frozen obligations: ${specFrozen.join(', ')})`);
      if (!approvalValid) pendingReasons.push('migration-approval missing or incomplete: an unapproved boundary change never moves R10 A');
      if (!proofValid) pendingReasons.push('restore-proof missing or unverified: a proven restore (verified=true, sameOperationReadback=true) is required before the boundary may move');
    }
  }

  return {
    receipt: {
      ...base,
      pending,
      pendingReasons,
      diskPressure,
      cleanup,
      basis,
      refusals: cleanup === 'DENIED' ? [refusal('RETENTION_CLEANUP_DENIED', `pending obligations retain the sole workspace: ${pending.map((item) => item.kind).join(', ')}`)] : [],
    },
    exit: cleanup === 'ELIGIBLE' ? EXIT_PASS : EXIT_VERIFY,
  };
}

// --- AuthorityTransfer.v1 -----------------------------------------------------------

function transferAuthority({ stateFile, approvalFile, fenceFile, outFile }) {
  const base = { interface: 'AuthorityTransfer.v1', command: 'transfer' };

  let state;
  try {
    state = readJson(stateFile);
  } catch (error) {
    return { receipt: refusedReceipt(base, 'STATE_INVALID', `run-state unreadable: ${redactHostPaths(error.message)}`), exit: EXIT_INPUT };
  }
  if (!state?.authorityId || !Number.isInteger(state?.epoch) || !state?.runId) {
    return { receipt: refusedReceipt(base, 'STATE_INVALID', 'run-state must carry authorityId, epoch and runId'), exit: EXIT_VERIFY };
  }

  let approval;
  try {
    approval = readJson(approvalFile);
  } catch {
    return {
      receipt: refusedReceipt(base, 'REFUSAL_CONTROLLED_APPROVAL_REQUIRED', 'a controlled transfer approval (approvalId/approvedBy/approvalRef/approvedAt, reason=runner-permanently-lost) is required before the authority may move'),
      exit: EXIT_VERIFY,
    };
  }
  if (!approval?.approvalId || !approval?.approvedBy || !approval?.approvalRef || !approval?.approvedAt || approval?.reason !== 'runner-permanently-lost') {
    return {
      receipt: refusedReceipt(base, 'REFUSAL_CONTROLLED_APPROVAL_REQUIRED', `the transfer approval is incomplete or its reason is not runner-permanently-lost (observed reason: ${JSON.stringify(approval?.reason ?? null)})`),
      exit: EXIT_VERIFY,
    };
  }

  const fenceOutcome = evaluateFence({
    fenceFile,
    codes: { notFenced: 'OLD_WRITER_FENCE_REQUIRED', masquerade: 'AUTHORITY_FENCE_NOT_PROCESS_LEVEL', live: 'OLD_WRITER_STILL_LIVE' },
    purpose: 'authority transfer',
  });
  if (fenceOutcome.refusal) {
    return { receipt: refusedReceipt(base, fenceOutcome.refusal.code, fenceOutcome.refusal.reason), exit: EXIT_VERIFY };
  }

  const newAuthorityId = `comet-authority-transfer-${sha256Bytes(Buffer.from(`${state.authorityId}:${state.epoch}:${approval.approvalId}:${new Date().toISOString()}`)).slice(0, 12)}`;
  const newState = {
    ...state,
    authorityId: newAuthorityId,
    epoch: state.epoch + 1,
    transferredFrom: state.authorityId,
    transferredAt: new Date().toISOString(),
    transferApprovalRef: approval.approvalRef,
  };
  fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
  fs.writeFileSync(outFile, `${JSON.stringify(newState, null, 2)}\n`);

  return {
    receipt: {
      ...base,
      status: 'TRANSFERRED',
      from: { authorityId: state.authorityId, epoch: state.epoch, runId: state.runId },
      newAuthority: {
        authorityId: newAuthorityId,
        epoch: newState.epoch,
        runId: newState.runId,
        transferredFrom: newState.transferredFrom,
        transferredAt: newState.transferredAt,
      },
      approval: { approvalId: approval.approvalId, approvedBy: approval.approvedBy, approvalRef: approval.approvalRef, reason: approval.reason, approvedAt: approval.approvedAt },
      fence: fenceOutcome.fence,
      singleAuthorityProof: {
        oldWriterConfirmedGone: true,
        singleLiveAuthority: true,
        method: fenceOutcome.fence.method,
        note: 'the old writer is confirmed terminated by process-level evidence; exactly one live authority is registered',
      },
      outFile: displayPath(outFile),
      refusals: [],
    },
    exit: EXIT_PASS,
  };
}

// --- validate -----------------------------------------------------------------------

function collectDomainRefs(domain) {
  const registry = domain['registry.json'];
  const backupPolicy = domain['backup-policy.json'];
  const restorePolicy = domain['restore-policy.json'];
  return [...new Set([
    ...(registry?.credentialRefs ?? []),
    backupPolicy?.backupWriterRef,
    ...(backupPolicy?.encryption?.refs ?? []),
    restorePolicy?.restoreReaderRef,
  ].filter((ref) => typeof ref === 'string' && ref.length > 0))];
}

function isRefRegistered(refsDoc, ref) {
  return (refsDoc?.refs ?? []).some((entry) => entry.ref === ref);
}

function validateDomain({ domain, refsDoc, registry: projectRegistry, dir }) {
  const violations = [];
  const registry = domain['registry.json'];
  const backupPolicy = domain['backup-policy.json'];
  const restorePolicy = domain['restore-policy.json'];

  if (registry?.interface !== 'BackupRegistry.v1') violations.push({ code: 'BACKUP_REGISTRY_INTERFACE_INVALID', at: 'registry.json' });
  if (backupPolicy?.interface !== 'BackupPolicy.v1') violations.push({ code: 'BACKUP_POLICY_INTERFACE_INVALID', at: 'backup-policy.json' });
  if (restorePolicy?.interface !== 'RestorePolicy.v1') violations.push({ code: 'RESTORE_POLICY_INTERFACE_INVALID', at: 'restore-policy.json' });
  if (registry?.project?.id && projectRegistry?.project?.id && registry.project.id !== projectRegistry.project.id) {
    violations.push({ code: 'PROJECT_MISMATCH', at: 'registry.json.project.id', observed: registry.project.id, expected: projectRegistry.project.id });
  }

  // R10 诚实性：未确认的恢复期限绝不编造，自动清理绝不开启。
  const retention = registry?.retention ?? {};
  const unconfirmed = ['rpo', 'rto', 'retentionPeriod', 'encryptionOwner'].filter((key) => !retention[key] || retention[key] === 'UNVERIFIED');
  if (retention.autoCleanupEnabled === true && unconfirmed.length > 0) {
    violations.push({ code: 'AUTO_CLEANUP_WITHOUT_CONFIRMED_RECOVERY', at: 'registry.json.retention', unconfirmed });
  }

  // 规格冻结的 R10 边界（防篡改）：pending 清单覆盖三类、磁盘压力只告警。
  const domainRetention = backupPolicy?.retention ?? {};
  for (const obligation of SPEC_PENDING_OBLIGATIONS) {
    if (!(domainRetention.cleanupDenyWhenPending ?? []).includes(obligation)) {
      violations.push({ code: 'SPEC_PENDING_OBLIGATION_MISSING', at: 'backup-policy.json.retention.cleanupDenyWhenPending', obligation });
    }
  }
  if (domainRetention.diskPressureWarnOnly !== true) {
    violations.push({ code: 'DISK_PRESSURE_WARN_ONLY_REQUIRED', at: 'backup-policy.json.retention.diskPressureWarnOnly' });
  }

  // Restore 边界（防篡改）：五条禁止 + 隔离区 + 进程级 fencing。
  const forbidden = restorePolicy?.forbidden ?? {};
  for (const rule of ['replayOldAcl', 'readdOfflineMembers', 'restoreOldGrantsOrAttempts', 'secondWriterByStateCopy', 'reuseRevokedCodeSourceCache']) {
    if (forbidden[rule] !== true) violations.push({ code: 'RESTORE_RULE_MISSING', at: `restore-policy.json.forbidden.${rule}` });
  }
  if (restorePolicy?.quarantine?.required !== true) violations.push({ code: 'QUARANTINE_REQUIRED', at: 'restore-policy.json.quarantine.required' });
  if (restorePolicy?.oldWriterFence?.required !== true) violations.push({ code: 'FENCE_REQUIRED', at: 'restore-policy.json.oldWriterFence.required' });
  if (restorePolicy?.oldWriterFence?.processLevelEvidenceRequired !== true) {
    violations.push({ code: 'FENCE_PROCESS_LEVEL_REQUIRED', at: 'restore-policy.json.oldWriterFence.processLevelEvidenceRequired' });
  }

  // Retention.v1 canonical 文件（命名迁移新增）：接口 + 规格冻结的 R10 边界防篡改。
  const retentionPolicy = domain['retention-policy.json'];
  if (retentionPolicy?.interface !== 'RetentionPolicy.v1') violations.push({ code: 'RETENTION_POLICY_INTERFACE_INVALID', at: 'retention-policy.json' });
  for (const obligation of SPEC_PENDING_OBLIGATIONS) {
    if (!(retentionPolicy?.retention?.cleanupDenyWhenPending ?? []).includes(obligation)) {
      violations.push({ code: 'SPEC_PENDING_OBLIGATION_MISSING', at: 'retention-policy.json.retention.cleanupDenyWhenPending', obligation });
    }
  }
  if (retentionPolicy?.retention?.diskPressureWarnOnly !== true) {
    violations.push({ code: 'DISK_PRESSURE_WARN_ONLY_REQUIRED', at: 'retention-policy.json.retention.diskPressureWarnOnly' });
  }
  if (retentionPolicy?.retention?.autoCleanupEnabled === true) {
    violations.push({ code: 'AUTO_CLEANUP_WITHOUT_CONFIRMED_RECOVERY', at: 'retention-policy.json.retention' });
  }

  // AuthorityTransfer.v1 schema 文件（命名迁移新增）：受控迁移冻结边界防篡改。
  const transferSchema = domain['authority-transfer.schema.json'];
  if (transferSchema?.interface !== 'AuthorityTransferSchema.v1') violations.push({ code: 'AUTHORITY_TRANSFER_SCHEMA_INTERFACE_INVALID', at: 'authority-transfer.schema.json' });
  if (transferSchema?.approval?.required !== true || transferSchema?.approval?.reasonRequired !== 'runner-permanently-lost') {
    violations.push({ code: 'AUTHORITY_TRANSFER_SCHEMA_RULE_MISSING', at: 'authority-transfer.schema.json.approval' });
  }
  if (transferSchema?.oldWriterFence?.processLevelEvidenceRequired !== true
    || !(transferSchema?.oldWriterFence?.rejectedMethods ?? []).includes('shared-directory-reregister')) {
    violations.push({ code: 'AUTHORITY_TRANSFER_SCHEMA_RULE_MISSING', at: 'authority-transfer.schema.json.oldWriterFence' });
  }
  if (transferSchema?.state?.epochBumpRequired !== true || transferSchema?.state?.singleRunContinuityRequired !== true) {
    violations.push({ code: 'AUTHORITY_TRANSFER_SCHEMA_RULE_MISSING', at: 'authority-transfer.schema.json.state' });
  }
  if (transferSchema?.singleAuthorityProof?.required !== true || transferSchema?.singleAuthorityProof?.singleLiveAuthority !== true) {
    violations.push({ code: 'AUTHORITY_TRANSFER_SCHEMA_RULE_MISSING', at: 'authority-transfer.schema.json.singleAuthorityProof' });
  }

  // 秘密引用：格式 + 项目归属；目录缺席按 I07 先例记显式 catalogGap（I01 所有权属）。
  const catalogGaps = [];
  for (const ref of collectDomainRefs(domain)) {
    const parsed = parseSecretRef(ref);
    if (!parsed.ok) {
      violations.push({ code: parsed.code, at: 'secret-ref', ref, reason: parsed.error });
      continue;
    }
    if (registry?.project?.id && parsed.project !== registry.project.id) {
      violations.push({ code: 'CROSS_PROJECT_REF', at: 'secret-ref', ref, project: parsed.project });
      continue;
    }
    if (refsDoc && !isRefRegistered(refsDoc, ref)) {
      catalogGaps.push({ ref, reason: 'not registered in the I01 catalog; membership is I01-owned readiness evidence, resolution refuses REF_NOT_REGISTERED' });
    }
  }

  for (const name of [...POLICY_FILES, REGISTRY_FILE]) violations.push(...scanForForbiddenValues(domain[name]).map((item) => ({ ...item, at: name })));

  return { violations, catalogGaps };
}

// --- probe：真实本地机制注入 ---------------------------------------------------------

const PROBE_RUN_STATE = { authorityId: 'comet-authority-i08-probe', epoch: 2, runId: 'run-i08-probe', updatedAt: null };

// 探针夹具作者：真实字节工作区（与套件同构；探针自建自清，不留残留）。
function buildProbeWorkspace(root, { pending = false, supersededReceipt = true } = {}) {
  const workspace = path.join(root, 'workspace');
  for (const section of ['operations', 'transactions', 'approvals', 'knowledge', 'db/pages', 'objects', 'config', 'permissions']) {
    fs.mkdirSync(path.join(workspace, section), { recursive: true });
  }
  const now = new Date().toISOString();
  const put = (rel, value) => {
    const file = path.join(workspace, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof value === 'string' || Buffer.isBuffer(value) ? Buffer.from(value) : Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8'));
  };
  const runState = { ...PROBE_RUN_STATE, updatedAt: now };
  put('run-state.json', runState);
  put('operations/op-publish.dispatch.json', { opId: 'op-publish', kind: 'outline-publish', attempt: 1, epoch: runState.epoch, remote: true });
  if (!pending) put('operations/op-publish.receipt.json', { opId: 'op-publish', status: 'ok', attempt: 1, epoch: runState.epoch });
  if (supersededReceipt) put('operations/op-publish.receipt.stale.json', { opId: 'op-publish', status: 'ok', attempt: 1, epoch: runState.epoch - 1 });
  put('transactions/txn-base.json', { txnId: 'txn-base', state: pending ? 'open' : 'committed', watermark: pending ? null : now });
  put('approvals/payload.json', { payloadId: 'payload', version: 'v1', soleCopy: pending });
  put('knowledge/k1.json', { itemId: 'k1', state: pending ? 'pending' : 'closed' });
  put('db/watermark.json', { pointInTime: now });
  put('db/pages/page.page', Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]));
  put('objects/watermark.json', { pointInTime: now });
  put('objects/obj.bin', Buffer.from([9, 8, 7, 6, 5, 4, 3, 2]));
  put('config/refs.json', { configRefs: ['outline-instance@UNVERIFIED'] });
  put('permissions/acl.json', { entries: [{ grantId: 'g1', principal: 'svc:pilot/publisher', resource: 'set', grantedAtEpoch: runState.epoch - 1 }] });
  put('permissions/members.json', { members: [{ principal: 'svc:pilot/publisher', status: 'active' }, { principal: 'user:offline-member', status: 'offline' }] });
  return workspace;
}

let fenceFileSeq = 0;
function writeFenceFile(dir, overrides = {}) {
  // 每次独立成文件：后续的 masquerade/lie 变体绝不覆盖已用于评估的证据。
  fenceFileSeq += 1;
  const file = path.join(dir, `fence-evidence-${fenceFileSeq}.json`);
  fs.writeFileSync(file, `${JSON.stringify({
    oldWriterId: PROBE_RUN_STATE.authorityId,
    method: 'SIGKILL',
    confirmedGone: true,
    observedAt: new Date().toISOString(),
    ...overrides,
  }, null, 2)}\n`);
  return file;
}

const probeSleeper = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const spawnHolder = () => spawn(process.execPath, ['-e', 'setInterval(() => {}, 250);'], { stdio: 'ignore' });
const exited = (child) => new Promise((resolve) => child.once('exit', resolve));

async function probePendingCleanupDenial({ domain }) {
  const observation = {
    interface: 'BackupInfra.v1', command: 'probe', case: 'pending-cleanup-denial', executed: true, status: 'UNVERIFIED', observedSteps: [],
  };
  const step = (payload) => observation.observedSteps.push(payload);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'infra-i08-probe-retention-'));
  try {
    const workspace = buildProbeWorkspace(root, { pending: true, supersededReceipt: false });
    const pressureFile = path.join(root, 'pressure.json');
    fs.writeFileSync(pressureFile, `${JSON.stringify({ observedBytes: 900_000_000_000, thresholdBytes: 500_000_000_000, source: 'probe volume record' }, null, 2)}\n`);
    const outcome = runRetention({ workspace, policy: domain['retention-policy.json'], pressureFile });
    const kinds = outcome.receipt.pending.map((item) => item.kind);
    const denied = outcome.exit === EXIT_VERIFY && outcome.receipt.cleanup === 'DENIED';
    step({
      step: 'pending-obligations-deny-cleanup',
      status: denied && ['pending-outline-publish', 'unknown-remote-result', 'sole-payload-in-workspace', 'open-transaction', 'pending-knowledge-closeout'].every((kind) => kinds.includes(kind))
        ? 'VERIFIED' : 'UNVERIFIED',
      pending: kinds,
    });
    step({
      step: 'disk-pressure-warns-but-never-cleans',
      status: outcome.receipt.diskPressure?.warned === true && outcome.receipt.diskPressure?.cleanup === false ? 'VERIFIED' : 'UNVERIFIED',
      warned: outcome.receipt.diskPressure?.warned === true,
    });
    const untouched = fs.existsSync(path.join(workspace, 'transactions', 'txn-base.json'))
      && JSON.parse(fs.readFileSync(path.join(workspace, 'transactions', 'txn-base.json'), 'utf8')).state === 'open';
    step({ step: 'workspace-bytes-untouched', status: untouched ? 'VERIFIED' : 'UNVERIFIED' });
    const eligible = runRetention({ workspace: buildProbeWorkspace(path.join(root, 'done'), { pending: false }), policy: domain['retention-policy.json'] });
    step({
      step: 'verified-completion-moves-the-gate',
      status: eligible.exit === EXIT_PASS && eligible.receipt.basis === 'verified-completed' ? 'VERIFIED' : 'UNVERIFIED',
      basis: eligible.receipt.basis,
    });
    observation.status = observation.observedSteps.every((entry) => entry.status === 'VERIFIED') ? 'VERIFIED' : 'UNVERIFIED';
    observation.reason = observation.status === 'VERIFIED'
      ? 'real workspace with pending obligations: cleanup actually denied (exit 2), disk pressure recorded as warning only, workspace bytes untouched, verified completion moves the gate'
      : 'one or more observed steps did not verify; see observedSteps';
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  print(observation);
  return observation.status === 'VERIFIED' ? EXIT_PASS : EXIT_VERIFY;
}

async function probeQuarantineRestore({ domain, refsDoc }) {
  const observation = {
    interface: 'BackupInfra.v1', command: 'probe', case: 'quarantine-restore', executed: true, status: 'UNVERIFIED', observedSteps: [],
  };
  const step = (payload) => observation.observedSteps.push(payload);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'infra-i08-probe-restore-'));
  try {
    const workspace = buildProbeWorkspace(root);
    const target = path.join(root, 'target');
    const backup = backupWorkspace({ workspace, target, domain });
    step({ step: 'consistent-backup', status: backup.exit === EXIT_PASS ? 'VERIFIED' : 'UNVERIFIED', filesCount: backup.receipt.filesCount });
    const backupDir = path.join(target, backup.receipt.backupId);

    // 破坏负例：一个真实字节翻转 → 恢复拒绝。
    const corruptDir = path.join(root, 'corrupt');
    fs.cpSync(backupDir, corruptDir, { recursive: true });
    const victim = path.join(corruptDir, 'files', 'objects', 'obj.bin');
    const bytes = fs.readFileSync(victim);
    bytes[0] = (bytes[0] + 1) & 0xff;
    fs.writeFileSync(victim, bytes);
    const corrupt = restoreBackup({ backupDir: corruptDir, quarantine: path.join(root, 'quarantine-corrupt'), fenceFile: writeFenceFile(root), domain, refsDoc });
    step({
      step: 'corrupted-byte-refuses-restore',
      status: corrupt.exit === EXIT_VERIFY && corrupt.receipt.refusals.some((item) => item.code === 'RESTORE_BACKUP_INVALID') ? 'VERIFIED' : 'UNVERIFIED',
      refusal: corrupt.receipt.refusals[0]?.code ?? null,
    });

    // 正例：隔离恢复 + 同 operation 读回。
    const restored = restoreBackup({ backupDir, quarantine: path.join(root, 'quarantine'), fenceFile: writeFenceFile(root), domain, refsDoc });
    step({
      step: 'quarantined-restore-released',
      status: restored.exit === EXIT_PASS && restored.receipt.status === 'RELEASED' ? 'VERIFIED' : 'UNVERIFIED',
      sameOperation: restored.receipt.sameOperation,
    });
    const reconciliationFile = path.join(root, 'quarantine', 'restore-reconciliation.json');
    const reconciliation = fs.existsSync(reconciliationFile) ? readJson(reconciliationFile) : null;
    step({
      step: 'permissions-reconciled-as-data',
      status: reconciliation
        && reconciliation.aclEntries.every((entry) => entry.applied === false)
        && reconciliation.members.filter((member) => member.status === 'offline').every((member) => member.readmitted === false)
        && reconciliation.excludedSuperseded.length >= 1
        ? 'VERIFIED' : 'UNVERIFIED',
      excludedSuperseded: reconciliation?.excludedSuperseded?.map((item) => item.path) ?? [],
    });
    observation.realServiceRestore = REAL_SERVICE_RESTORE();
    observation.status = observation.observedSteps.every((entry) => entry.status === 'VERIFIED') ? 'VERIFIED' : 'UNVERIFIED';
    observation.reason = observation.status === 'VERIFIED'
      ? 'real bytes end-to-end: consistent backup, single corrupted byte refuses the restore, quarantined restore released after the same-operation readback, permissions reconciled as data only'
      : 'one or more observed steps did not verify; see observedSteps';
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  print(observation);
  return observation.status === 'VERIFIED' ? EXIT_PASS : EXIT_VERIFY;
}

async function probeOldWriterDenial({ domain, refsDoc }) {
  const observation = {
    interface: 'BackupInfra.v1', command: 'probe', case: 'old-writer-denial', executed: true, status: 'UNVERIFIED', observedSteps: [],
  };
  const step = (payload) => observation.observedSteps.push(payload);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'infra-i08-probe-fence-'));
  let holder = null;
  try {
    const workspace = buildProbeWorkspace(root);
    const target = path.join(root, 'target');
    const backup = backupWorkspace({ workspace, target, domain });
    const backupDir = path.join(target, backup.receipt.backupId);

    // 真实存活旧 writer：真实子进程持有 lease，恢复必须拒绝。
    holder = spawnHolder();
    let alive = false;
    for (let i = 0; i < 200 && !alive; i++) {
      alive = isAlive(holder.pid);
      if (!alive) await probeSleeper(25);
    }
    step({ step: 'spawn-live-old-writer', status: alive ? 'VERIFIED' : 'UNVERIFIED', pid: holder.pid });

    const quarantine = path.join(root, 'quarantine');
    const lieFence = writeFenceFile(root, { pid: holder.pid, method: 'claimed' });
    const refused = restoreBackup({ backupDir, quarantine, fenceFile: lieFence, domain, refsDoc });
    step({
      step: 'live-writer-refuses-restore',
      status: refused.exit === EXIT_VERIFY && refused.receipt.refusals.some((item) => item.code === 'RESTORE_REFUSED_OLD_WRITER_LIVE') ? 'VERIFIED' : 'UNVERIFIED',
      refusal: refused.receipt.refusals[0]?.code ?? null,
      released: fs.existsSync(path.join(quarantine, 'release-record.json')),
    });

    // 真实 SIGKILL + 终止确认 → 恢复启用。
    holder.kill('SIGKILL');
    await exited(holder);
    const gone = !isAlive(holder.pid);
    step({ step: 'sigkill-and-confirmed-gone', status: gone ? 'VERIFIED' : 'UNVERIFIED', method: 'SIGKILL' });

    const realFence = writeFenceFile(root, { pid: holder.pid, observedAt: new Date().toISOString() });
    const restored = restoreBackup({ backupDir, quarantine, fenceFile: realFence, domain, refsDoc });
    step({
      step: 'restore-enabled-after-fence',
      status: restored.exit === EXIT_PASS && restored.receipt.status === 'RELEASED' ? 'VERIFIED' : 'UNVERIFIED',
      sameOperation: restored.receipt.sameOperation,
    });

    observation.status = observation.observedSteps.every((entry) => entry.status === 'VERIFIED') ? 'VERIFIED' : 'UNVERIFIED';
    observation.reason = observation.status === 'VERIFIED'
      ? 'process-level fencing proven with a real pid: live old writer refuses the restore, real SIGKILL plus gone-confirmation enables it, release only after the same-operation readback'
      : 'one or more observed steps did not verify; see observedSteps';
  } finally {
    if (holder && isAlive(holder.pid)) holder.kill('SIGKILL');
    fs.rmSync(root, { recursive: true, force: true });
  }
  print(observation);
  return observation.status === 'VERIFIED' ? EXIT_PASS : EXIT_VERIFY;
}

async function probeAuthorityTransfer({ domain }) {
  const observation = {
    interface: 'BackupInfra.v1', command: 'probe', case: 'authority-transfer', executed: true, status: 'UNVERIFIED', observedSteps: [],
  };
  const step = (payload) => observation.observedSteps.push(payload);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'infra-i08-probe-transfer-'));
  let lostRunner = null;
  try {
    const workspace = buildProbeWorkspace(root);
    const stateFile = path.join(workspace, 'run-state.json');

    // 原 Runner 永久丢失：真实子进程持有权威 → SIGKILL → 确认终止（无监督重启）。
    lostRunner = spawnHolder();
    let alive = false;
    for (let i = 0; i < 200 && !alive; i++) {
      alive = isAlive(lostRunner.pid);
      if (!alive) await probeSleeper(25);
    }
    lostRunner.kill('SIGKILL');
    await exited(lostRunner);
    step({
      step: 'runner-permanently-lost',
      status: !isAlive(lostRunner.pid) ? 'VERIFIED' : 'UNVERIFIED',
      method: 'SIGKILL',
      supervisedRestart: false,
    });

    // 无受控批准 → 拒绝。
    const fence = writeFenceFile(root, { pid: lostRunner.pid, observedAt: new Date().toISOString() });
    const noApproval = transferAuthority({ stateFile, approvalFile: path.join(root, 'missing.json'), fenceFile: fence, outFile: path.join(root, 'out1.json') });
    step({
      step: 'transfer-without-approval-refused',
      status: noApproval.exit === EXIT_VERIFY && noApproval.receipt.refusals.some((item) => item.code === 'REFUSAL_CONTROLLED_APPROVAL_REQUIRED') ? 'VERIFIED' : 'UNVERIFIED',
    });

    // 共享目录冒充 fencing → 拒绝。
    const approvalFile = path.join(root, 'approval.json');
    fs.writeFileSync(approvalFile, `${JSON.stringify({
      approvalId: 'mig-probe', approvedBy: 'ql-wade', approvalRef: 'change-control:migration-probe',
      reason: 'runner-permanently-lost', approvedAt: new Date().toISOString(),
    }, null, 2)}\n`);
    const masqueradeFence = writeFenceFile(root, { method: 'shared-directory-reregister' });
    const masquerade = transferAuthority({ stateFile, approvalFile, fenceFile: masqueradeFence, outFile: path.join(root, 'out2.json') });
    step({
      step: 'shared-directory-masquerade-refused',
      status: masquerade.exit === EXIT_VERIFY && masquerade.receipt.refusals.some((item) => item.code === 'AUTHORITY_FENCE_NOT_PROCESS_LEVEL') ? 'VERIFIED' : 'UNVERIFIED',
    });

    // 受控迁移：进程级 fence 证据 → 新 authority 登记（epoch +1，同 run）。
    const transfer = transferAuthority({ stateFile, approvalFile, fenceFile: fence, outFile: path.join(root, 'out3.json') });
    const newState = fs.existsSync(path.join(root, 'out3.json')) ? readJson(path.join(root, 'out3.json')) : null;
    step({
      step: 'controlled-transfer-registers-new-authority',
      status: transfer.exit === EXIT_PASS && newState && newState.epoch === PROBE_RUN_STATE.epoch + 1 && newState.transferredFrom === PROBE_RUN_STATE.authorityId ? 'VERIFIED' : 'UNVERIFIED',
      newAuthority: transfer.receipt.newAuthority,
    });
    observation.singleAuthorityProof = transfer.receipt.singleAuthorityProof ?? null;
    observation.status = observation.observedSteps.every((entry) => entry.status === 'VERIFIED') ? 'VERIFIED' : 'UNVERIFIED';
    observation.reason = observation.status === 'VERIFIED'
      ? 'single-authority migration proven locally: the runner is really SIGKILLed, transfer refuses without controlled approval, shared-directory masquerade fencing is refused, and the approved transfer registers a new authority with an epoch bump and a single-live-authority proof'
      : 'one or more observed steps did not verify; see observedSteps';
  } finally {
    if (lostRunner && isAlive(lostRunner.pid)) lostRunner.kill('SIGKILL');
    fs.rmSync(root, { recursive: true, force: true });
  }
  print(observation);
  return observation.status === 'VERIFIED' ? EXIT_PASS : EXIT_VERIFY;
}

// --- main ---------------------------------------------------------------------------

async function main(argv) {
  const { command, opts, error } = parseArgs(argv);
  if (error) return failInput(error);
  if (!command) return failInput('missing command');

  if (command === 'probe') {
    if (!opts.case) return failInput('probe requires --case');
    if (!['pending-cleanup-denial', 'quarantine-restore', 'old-writer-denial', 'authority-transfer'].includes(opts.case)) {
      return failInput(`unknown probe case: ${opts.case}`);
    }
    const loaded = loadDomain(opts.dir ?? DEFAULT_DIR);
    if (loaded.error) return failInput(loaded.error);
    const refsDoc = (() => {
      try {
        return readJson(opts.refs ?? DEFAULT_REFS);
      } catch {
        return null;
      }
    })();
    if (opts.case === 'pending-cleanup-denial') return probePendingCleanupDenial({ domain: loaded.docs });
    if (opts.case === 'quarantine-restore') return probeQuarantineRestore({ domain: loaded.docs, refsDoc });
    if (opts.case === 'old-writer-denial') return probeOldWriterDenial({ domain: loaded.docs, refsDoc });
    return probeAuthorityTransfer({ domain: loaded.docs });
  }

  if (command === 'validate') {
    if (!opts.registry) return failInput('validate requires --registry');
    let projectRegistry;
    try {
      projectRegistry = readJson(opts.registry);
    } catch (err) {
      return failInput(`registry unreadable (${displayPath(opts.registry)}): ${redactHostPaths(err.message)}`);
    }
    let refsDoc;
    try {
      refsDoc = readJson(opts.refs ?? DEFAULT_REFS);
    } catch (err) {
      return failInput(`refs catalog unreadable (${displayPath(opts.refs ?? DEFAULT_REFS)}): ${redactHostPaths(err.message)}`);
    }
    const loaded = loadDomain(opts.dir ?? DEFAULT_DIR);
    if (loaded.error) return failInput(loaded.error);
    const { violations, catalogGaps } = validateDomain({ domain: loaded.docs, refsDoc, registry: projectRegistry, dir: opts.dir ?? DEFAULT_DIR });
    print({
      interface: 'BackupInfra.v1',
      command: 'validate',
      registry: displayPath(opts.registry),
      dir: displayPath(opts.dir ?? DEFAULT_DIR),
      ok: violations.length === 0,
      violations,
      catalogGaps,
      refsChecked: collectDomainRefs(loaded.docs),
      retentionFreeze: {
        rpo: loaded.docs['registry.json']?.retention?.rpo ?? 'UNVERIFIED',
        rto: loaded.docs['registry.json']?.retention?.rto ?? 'UNVERIFIED',
        autoCleanupEnabled: loaded.docs['registry.json']?.retention?.autoCleanupEnabled === true,
        diskPressureWarnOnly: loaded.docs['backup-policy.json']?.retention?.diskPressureWarnOnly === true,
      },
    });
    return violations.length === 0 ? EXIT_PASS : EXIT_VERIFY;
  }

  if (command === 'backup') {
    if (!opts.workspace || !opts.target) return failInput('backup requires --workspace and --target');
    if (!fs.existsSync(path.join(opts.workspace, 'run-state.json'))) return failInput(`workspace with run-state.json not found: ${displayPath(opts.workspace)}`);
    if (!fs.existsSync(opts.target)) return failInput(`target directory not found: ${displayPath(opts.target)}`);
    const loaded = loadDomain(opts.dir ?? DEFAULT_DIR);
    if (loaded.error) return failInput(loaded.error);
    const outcome = backupWorkspace({ workspace: opts.workspace, target: opts.target, domain: loaded.docs });
    print(outcome.receipt);
    return outcome.exit;
  }

  if (command === 'restore') {
    if (!opts.backup || !opts.quarantine) return failInput('restore requires --backup and --quarantine');
    if (!fs.existsSync(opts.backup)) return failInput(`backup directory not found: ${displayPath(opts.backup)}`);
    const loaded = loadDomain(opts.dir ?? DEFAULT_DIR);
    if (loaded.error) return failInput(loaded.error);
    let refsDoc;
    try {
      refsDoc = readJson(opts.refs ?? DEFAULT_REFS);
    } catch (err) {
      return failInput(`refs catalog unreadable (${displayPath(opts.refs ?? DEFAULT_REFS)}): ${redactHostPaths(err.message)}`);
    }
    const outcome = restoreBackup({ backupDir: opts.backup, quarantine: opts.quarantine, fenceFile: opts['fence-evidence'], domain: loaded.docs, refsDoc });
    print(outcome.receipt);
    return outcome.exit;
  }

  if (command === 'retention') {
    if (!opts.workspace) return failInput('retention requires --workspace');
    const loaded = loadDomain(opts.dir ?? DEFAULT_DIR);
    if (loaded.error) return failInput(loaded.error);
    const outcome = runRetention({
      workspace: opts.workspace,
      policy: loaded.docs['retention-policy.json'],
      pressureFile: opts['disk-pressure'],
      approvalFile: opts['migration-approval'],
      proofFile: opts['restore-proof'],
    });
    print(outcome.receipt);
    return outcome.exit;
  }

  if (command === 'transfer') {
    if (!opts.state || !opts['fence-evidence'] || !opts.out) return failInput('transfer requires --state, --fence-evidence and --out');
    if (!fs.existsSync(opts.state)) return failInput(`run-state not found: ${displayPath(opts.state)}`);
    const loaded = loadDomain(opts.dir ?? DEFAULT_DIR);
    if (loaded.error) return failInput(loaded.error);
    const outcome = transferAuthority({ stateFile: opts.state, approvalFile: opts.approval, fenceFile: opts['fence-evidence'], outFile: opts.out });
    print(outcome.receipt);
    return outcome.exit;
  }

  return failInput(`unknown command: ${command}`);
}

// 仅在直接执行时运行（backup-restore.mjs 兼容入口 import 本模块的 main 并注入
// legacy 默认域目录，见该文件）；import 侧永不产生副作用。
export { main };
const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) process.exit(await main(process.argv.slice(2)));

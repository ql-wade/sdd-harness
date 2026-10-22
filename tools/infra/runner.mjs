#!/usr/bin/env node
// RunnerInfra.v1 / RoleBoundary.v1 / Authority.v1 CLI — validate | qualify | up | probe | stop
//
// 只登记、声明与验收：不启动任何进程、不持有阶段/DAG/job queue、不改活配置（hooks/MCP 由对应 P 任务串行接纳）。
// 镜像 tag/digest 一律来自 infra/delivery/runner/image.lock.json；本宿主无 container daemon（EPERM），
// 容器化构建从未执行，严禁虚构 tag/digest。秘密值永不读写：四 ref 只引用，解析属运行时授权机制（I01 只读门）。
//
// 退出码契约（execution-contract.json V_INFRA_I02.cli_contract）：
//   0 = PASS（validate 通过）
//   1 = 输入或前置无效（文件缺失/不可解析、参数错误、未知 probe case）
//   2 = 验证失败（语义违规、qualify NOT_READY、up 被拒、probe/stop 环境缺失 UNVERIFIED）
//   环境缺失必须显式 UNVERIFIED 并以非零退出，不允许 skip 或 mock 转绿。

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseSecretRef, scanForForbiddenValues } from './secret-refs.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const EXIT_PASS = 0;
const EXIT_INPUT = 1;
const EXIT_VERIFY = 2;
const DEFAULT_REGISTRY = path.join(repoRoot, 'infra', 'delivery', 'registry.json');
const DEFAULT_REFS = path.join(repoRoot, 'infra', 'delivery', 'secrets.refs.example.json');
const DEFAULT_DIR = path.join(repoRoot, 'infra', 'delivery', 'runner');

const JSON_FILES = ['image.lock.json', 'role-policy.json', 'workspace-mounts.json', 'authority-registration.example.json'];
const DOMAIN_FILES = ['compose.yaml', 'Dockerfile', ...JSON_FILES];
const RUNNER_ROLES = ['controller', 'author', 'test-author', 'reviewer', 'publisher', 'isolator'];
const RUNNER_REFS = [
  'secret-ref:sdd-harness-pilot/runner-authority',
  'secret-ref:sdd-harness-pilot/worker-author-api',
  'secret-ref:sdd-harness-pilot/worker-review-api',
  'secret-ref:sdd-harness-pilot/runner-source-read',
];
const LOCK_COMPONENTS = ['comet-runner', 'runner-base'];
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const LABEL_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const SECRET_REF_PREFIX = 'secret-ref:';
const PLACEHOLDER_IMAGE_RE = /^image:\s*\$\{[A-Z0-9_]+:\?[^}]*\}\s*$/;

// 宿主私有路径绝不进入结构化回执/报告；对外输出统一脱敏（与 secret-refs 的 ABSOLUTE_PATH_FORBIDDEN 同源规则）。
const HOST_PATH_REDACTION = /(^|[\s"'=(:/])\/(Users|home|root|private|var|usr|etc|opt|tmp)\/\S*/g;
const redactHostPaths = (text) => String(text ?? '').replace(HOST_PATH_REDACTION, '$1<host-path-redacted>');

// 结构化输出里的文件字段一律 repo 相对；repo 之外（fixture/临时目录）则复用宿主路径脱敏。
const displayPath = (file) => {
  const rel = path.relative(repoRoot, String(file ?? ''));
  return rel.startsWith('..') ? redactHostPaths(String(file)) : rel;
};

const HOST_USER_PATH = /(^|[\s"'=(:])\/(Users|home|root)\//;
const SECRET_PLAINTEXT = [
  /ghp_[A-Za-z0-9]{20,}/,
  /gho_[A-Za-z0-9]{20,}/,
  /ghs_[A-Za-z0-9]{20,}/,
  /github_pat_[A-Za-z0-9_]{20,}/,
  /AKIA[0-9A-Z]{16}/,
  /xox[baprs]-[A-Za-z0-9-]{10,}/,
  /sk-[A-Za-z0-9]{20,}/,
  /npm_[A-Za-z0-9]{20,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /Bearer\s+[A-Za-z0-9._-]{25,}/,
];

const UNVERIFIED = (reason) => ({ status: 'UNVERIFIED', reason });
const RECORDED = (reason) => ({ status: 'RECORDED', reason });

function usage() {
  return [
    'usage:',
    '  runner.mjs validate --registry <file> [--refs <file>] [--dir <runner dir>] [--json]',
    '  runner.mjs build-plan [--dir <runner dir>] [--json]',
    '  runner.mjs qualify  --registry <file> [--dir <runner dir>] [--json]',
    '  runner.mjs up       --registry <file> [--dir <runner dir>] [--json]',
    '  runner.mjs probe    --case <role-denial|duplicate-authority> [--endpoint <url>] [--dir <runner dir>] [--json]',
    '  runner.mjs stop     [--dir <runner dir>] [--json]',
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

function print(payload) {
  process.stdout.write(JSON.stringify({ ...payload, checkedAt: new Date().toISOString() }, null, 2) + '\n');
}

function failInput(message) {
  process.stderr.write(`${message}\n${usage()}\n`);
  return EXIT_INPUT;
}

const sha256Text = (text) => crypto.createHash('sha256').update(text).digest('hex');

function loadDomainFiles(dir) {
  const files = new Map();
  const missing = [];
  const unparseable = [];
  for (const name of DOMAIN_FILES) {
    try {
      files.set(name, fs.readFileSync(path.join(dir, name), 'utf8'));
    } catch {
      missing.push(name);
    }
  }
  for (const name of JSON_FILES) {
    if (!files.has(name)) continue;
    try {
      JSON.parse(files.get(name));
    } catch (error) {
      unparseable.push(`${name}: ${redactHostPaths(error.message)}`);
    }
  }
  return { files, missing, unparseable };
}

// ref → 允许解析它的唯一角色：runner 四 ref 按本域声明，其余引用 I01 目录的 boundRole。
// （运行时解析语义本身复用 I01 resolveSecretRef——绑定不匹配即 PRINCIPAL_NOT_AUTHORIZED。）
function buildRefBindingMap(rolePolicy, refsDoc) {
  const map = new Map();
  for (const entry of (refsDoc?.refs ?? [])) {
    if (entry?.ref && entry.boundRole) map.set(entry.ref, entry.boundRole);
  }
  for (const entry of (rolePolicy?.runnerRefs ?? [])) {
    if (entry?.ref && entry.bindingRole) map.set(entry.ref, entry.bindingRole);
  }
  return map;
}

function validateImageLock(lock) {
  const violations = [];
  const add = (code, at, extra) => violations.push({ code, at, ...(extra ?? {}) });
  if (lock.interface !== 'RunnerImageLock.v1') add('LOCK_INTERFACE_INVALID', 'image.lock.json', { expected: 'RunnerImageLock.v1' });
  const components = Array.isArray(lock.components) ? lock.components : [];
  const byName = new Map(components.map((component) => [component.component, component]));
  for (const name of LOCK_COMPONENTS) {
    const entry = byName.get(name);
    const at = `image.lock.json:${name}`;
    if (!entry) {
      add('MISSING_LOCK_COMPONENT', at);
      continue;
    }
    if (typeof entry.reference === 'string') {
      if (/:latest\s*$/.test(entry.reference)) add('FLOATING_TAG_FORBIDDEN', at, { reference: entry.reference });
      if (!entry.digest) add('IMAGE_NOT_DIGEST_PINNED', at, { reference: entry.reference });
    }
    if (entry.digest !== null && entry.digest !== undefined && !DIGEST_RE.test(entry.digest)) {
      add('DIGEST_FORMAT_INVALID', at, { digest: entry.digest });
    }
    if (entry.digestAuthenticated === true && !entry.digest) {
      add('DIGEST_AUTH_FLAG_INCONSISTENT', at, { reason: 'digestAuthenticated=true requires a digest' });
    }
  }
  // 准入语义与 outline.mjs 同款（amendment 3 资源准入波次）：开门必须携带完整准入记录。
  const gate = lock.upGate ?? {};
  const admissionRecordComplete = Boolean(gate.admittedBy && gate.admittedAt && gate.reason);
  if (gate.enabled !== false && !admissionRecordComplete) {
    add('UP_GATE_NOT_CLOSED', 'image.lock.json:upGate', { reason: 'up gate may open only with a complete admission record (admittedBy/admittedAt/reason); otherwise it must stay enabled=false' });
  }
  const source = lock.sourceInputs ?? {};
  if (!/^[0-9a-f]{40}$/.test(source.sourceCommit ?? '')) add('SOURCE_COMMIT_NOT_PINNED', 'image.lock.json:sourceInputs', { reason: 'a 40-hex pinned Comet source commit is required' });
  if (source.containerBuildStatus !== 'UNVERIFIED' && source.containerBuildStatus !== 'VERIFIED') {
    add('CONTAINER_BUILD_STATUS_INVALID', 'image.lock.json:sourceInputs', { reason: 'containerized build status must be UNVERIFIED until a real build is evidenced' });
  }
  return violations;
}

function validateRolePolicy({ policy, refsDoc, projectId, catalogBoundRoles }) {
  const violations = [];
  const add = (code, at, extra) => violations.push({ code, at, ...(extra ?? {}) });
  if (policy.interface !== 'RoleBoundary.v1') add('ROLE_POLICY_INTERFACE_INVALID', 'role-policy.json', { expected: 'RoleBoundary.v1' });

  const roles = Array.isArray(policy.roles) ? policy.roles : [];
  if (roles.length === 0) {
    add('ROLES_MISSING', 'role-policy.json:roles', { reason: 'role-policy must define the six runner roles' });
    return { violations, roles: [] };
  }
  const byName = new Map(roles.map((role) => [role.role, role]));
  for (const name of RUNNER_ROLES) {
    if (!byName.has(name)) add('ROLE_MISSING', `role-policy.json:${name}`);
  }

  const seenLabels = new Map();
  const seenCredentialRefs = new Map();
  const seenVolumes = new Map();
  const bindingMap = buildRefBindingMap(policy, { refs: catalogBoundRoles });

  for (const role of roles) {
    const at = `role-policy.json:${role?.role ?? '?'}`;
    const principal = role?.principal;
    if (!principal || typeof principal.label !== 'string' || !LABEL_RE.test(principal.label)) {
      add('ROLE_PRINCIPAL_BINDING_MISSING', at, { reason: 'every role needs a distinct principal binding (label + credential ref)' });
      continue;
    }
    const previousLabel = seenLabels.get(principal.label);
    if (previousLabel) {
      add('ROLE_IDENTITY_REUSE', at, { label: principal.label, roles: [previousLabel, role.role], reason: 'one principal identity must never be reused across roles' });
    } else {
      seenLabels.set(principal.label, role.role);
    }
    if (principal.credentialRef === null || principal.credentialRef === undefined) {
      if (principal.provisioningStatus !== 'UNASSIGNED') {
        add('ROLE_PRINCIPAL_BINDING_INVALID', at, { reason: 'a role without a credential ref must declare provisioningStatus=UNASSIGNED' });
      }
    } else {
      const parsed = parseSecretRef(principal.credentialRef);
      if (!parsed.ok) {
        add(parsed.code, at, { ref: principal.credentialRef, reason: parsed.error });
      } else if (projectId && parsed.project !== projectId) {
        add('CROSS_PROJECT_REF', at, { ref: principal.credentialRef, project: parsed.project });
      }
      const previousRef = seenCredentialRefs.get(principal.credentialRef);
      if (previousRef) {
        add('ROLE_IDENTITY_REUSE', at, { credentialRef: principal.credentialRef, roles: [previousRef, role.role], reason: 'one credential must never bind two roles' });
      } else {
        seenCredentialRefs.set(principal.credentialRef, role.role);
      }
    }
    const volume = role?.workspaceVolume;
    if (typeof volume !== 'string' || !LABEL_RE.test(volume)) {
      add('ROLE_BOUNDARY_WEAKENED', at, { reason: 'each role needs its own named workspace volume' });
    } else {
      const previousVolume = seenVolumes.get(volume);
      if (previousVolume) {
        add('WORKSPACE_VOLUME_REUSE', at, { volume, roles: [previousVolume, role.role] });
      } else {
        seenVolumes.set(volume, role.role);
      }
    }
    if (role?.readOnlyRootFilesystem !== true || JSON.stringify(role?.capabilities) !== JSON.stringify({ drop: ['ALL'], add: [] })) {
      add('ROLE_BOUNDARY_WEAKENED', at, { reason: 'read-only root filesystem and dropped ALL capabilities are invariant' });
    }
    for (const ref of (Array.isArray(role?.grantedRefs) ? role.grantedRefs : [])) {
      const parsed = parseSecretRef(ref);
      if (!parsed.ok) {
        add(parsed.code, `${at}:grantedRefs`, { ref, reason: parsed.error });
        continue;
      }
      if (projectId && parsed.project !== projectId) {
        add('CROSS_PROJECT_REF', `${at}:grantedRefs`, { ref, project: parsed.project });
        continue;
      }
      const bindingRole = bindingMap.get(ref);
      if (bindingRole !== role.role) {
        add('SECRET_REF_TIER_FORBIDDEN', `${at}:grantedRefs`, {
          ref,
          bindingRole: bindingRole ?? null,
          reason: `ref is bound to role ${bindingRole ?? '(unbound)'}; publisher/isolator-tier material never reaches ordinary roles`,
        });
      }
    }
  }

  const declared = (policy.runnerRefs ?? []).map((entry) => entry?.ref);
  const missingRefs = RUNNER_REFS.filter((ref) => !declared.includes(ref));
  if (missingRefs.length > 0) {
    add('RUNNER_REFS_DECLARATION_INCOMPLETE', 'role-policy.json:runnerRefs', { missing: missingRefs });
  }
  for (const entry of (Array.isArray(policy.runnerRefs) ? policy.runnerRefs : [])) {
    const parsed = parseSecretRef(entry?.ref ?? '');
    if (!parsed.ok) {
      add(parsed.code, 'role-policy.json:runnerRefs', { ref: entry?.ref, reason: parsed.error });
      continue;
    }
    if (projectId && parsed.project !== projectId) {
      add('CROSS_PROJECT_REF', 'role-policy.json:runnerRefs', { ref: entry.ref, project: parsed.project });
    }
    if (!LABEL_RE.test(entry?.bindingRole ?? '')) {
      add('ROLE_INVALID', 'role-policy.json:runnerRefs', { role: entry?.bindingRole ?? null });
    }
  }
  // 方法状态作用域（V_I02_METHOD_STATE_SCOPE，§6/§7.4）：共享 mode 状态永不作为角色/权限/身份/完成依据。
  const scope = policy.methodStateScope;
  if (!scope || scope.declaration !== 'METHOD_STATE_SHARED_DECLARED') {
    add('METHOD_STATE_SCOPE_MISSING', 'role-policy.json:methodStateScope', {
      reason: 'declare METHOD_STATE_SHARED_DECLARED: shared cooperative-local method state must never serve as a role/permission/identity basis',
    });
  } else {
    if (scope.identityBasis !== false || scope.permissionBasis !== false || scope.completionBasis !== false) {
      add('METHOD_STATE_AS_BASIS_FORBIDDEN', 'role-policy.json:methodStateScope', {
        reason: 'shared mode state (last-write-wins) must never serve as identity, permission or completion basis',
      });
    }
    if (scope.modeFilesInWorkerWritableSurface !== 'FORBIDDEN') {
      add('METHOD_STATE_SCOPE_INVALID', 'role-policy.json:methodStateScope', {
        reason: 'mode files are forbidden in any worker-writable surface',
      });
    }
    const dispatchFields = scope.dispatchRecord?.fields ?? {};
    const missingDispatch = ['actualAssetDigest', 'effectiveLevel', 'injectionObservation'].filter((field) => !dispatchFields[field]);
    if (missingDispatch.length > 0 || scope.dispatchRecord?.status !== 'UNVERIFIED') {
      add('DISPATCH_RECORD_SCHEMA_INCOMPLETE', 'role-policy.json:methodStateScope.dispatchRecord', {
        missing: missingDispatch,
        reason: 'every dispatch records actual asset digest, effective level and injection observation as separate fields; runtime-filled and UNVERIFIED until a real dispatch',
      });
    }
  }

  violations.push(...scanForForbiddenValues(policy));
  return { violations, roles };
}

function pathOverlaps(child, parent) {
  return child === parent || child.startsWith(`${parent}/`);
}

function validateWorkspaceMounts({ mounts, policy }) {
  const violations = [];
  const add = (code, at, extra) => violations.push({ code, at, ...(extra ?? {}) });
  if (mounts.interface !== 'RoleBoundary.v1') add('WORKSPACE_INTERFACE_INVALID', 'workspace-mounts.json', { expected: 'RoleBoundary.v1' });

  const controlVolumes = Array.isArray(mounts.controlVolumes) ? mounts.controlVolumes : [];
  const controlPaths = [];
  for (const [index, control] of controlVolumes.entries()) {
    const at = `workspace-mounts.json:controlVolumes[${index}]:${control?.volume ?? index}`;
    if (!control?.volume || !control?.mountPath || control?.purpose === undefined) {
      add('CONTROL_VOLUME_POLICY_INVALID', at, { missing: 'volume/mountPath/purpose' });
      continue;
    }
    if (control.workerWritable !== false) {
      add('WORKER_CONTROL_PATH_FORBIDDEN', at, { reason: 'control state/receipts/issuance are never worker-writable' });
    }
    if (JSON.stringify(control.mountedBy) !== JSON.stringify(['controller'])) {
      add('WORKER_CONTROL_PATH_FORBIDDEN', at, { mountedBy: control.mountedBy ?? null, reason: 'control volumes mount for the controller only' });
    }
    controlPaths.push(control.mountPath);
  }

  const workerRoles = new Set((mounts.rules?.workerRoles ?? []).filter((role) => role !== 'controller'));
  const workspaces = Array.isArray(mounts.roleWorkspaces) ? mounts.roleWorkspaces : [];
  const declaredVolumes = new Map((policy.roles ?? []).map((role) => [role.role, role.workspaceVolume]));
  for (const [index, workspace] of workspaces.entries()) {
    const at = `workspace-mounts.json:roleWorkspaces[${index}]:${workspace?.role ?? index}`;
    if (workerRoles.has(workspace?.role) || (workspace?.role !== 'controller' && workerRoles.size > 0)) {
      if (workerRoles.has(workspace?.role)) {
        const overlaps = controlPaths.filter((controlPath) => pathOverlaps(String(workspace?.mountPath ?? ''), controlPath));
        if (overlaps.length > 0) {
          add('WORKER_CONTROL_PATH_FORBIDDEN', at, { reason: 'a worker-writable mount must never overlap a control directory' });
        }
        if (workspace?.hostPath) {
          add('HOST_BIND_FORBIDDEN', at, { hostPath: redactHostPaths(workspace.hostPath), reason: 'worker workspaces are named volumes only, never host binds' });
        }
      }
    }
    if (workspace?.role && declaredVolumes.has(workspace.role) && workspace.volume !== declaredVolumes.get(workspace.role)) {
      add('WORKSPACE_VOLUME_MISMATCH', at, { volume: workspace.volume, rolePolicyVolume: declaredVolumes.get(workspace.role) });
    }
  }
  for (const role of (policy.roles ?? []).map((role) => role.role)) {
    if (!workspaces.some((workspace) => workspace.role === role)) {
      add('WORKSPACE_ROLE_MISSING', `workspace-mounts.json:roleWorkspaces`, { role });
    }
  }
  if (mounts.rules?.hostBindMounts !== 'FORBIDDEN' || mounts.rules?.dockerSocket !== 'FORBIDDEN') {
    add('WORKSPACE_INTERFACE_INVALID', 'workspace-mounts.json:rules', { reason: 'hostBindMounts and dockerSocket must be FORBIDDEN' });
  }
  if (mounts.rules?.projectRootMount !== 'READ_ONLY_BOUNDARY') {
    add('PROJECT_ROOT_MOUNT_NOT_READONLY', 'workspace-mounts.json:rules.projectRootMount', {
      reason: 'the delivery project root, if mounted at admission, is a read-only boundary (READ_ONLY_BOUNDARY); writable or undeclared rules are rejected',
    });
  }
  // mode 文件不进 worker 可写面（V_I02_METHOD_STATE_SCOPE）：共享 mode 状态不挂载、不可写、不作依据。
  const methodState = mounts.methodState;
  if (!methodState || methodState.workerWritable !== false || methodState.mountedIntoRunner !== false) {
    add('MODE_FILE_WORKER_WRITABLE_FORBIDDEN', 'workspace-mounts.json:methodState', {
      reason: 'shared Ponytail/mode files (last-write-wins across concurrent sessions) never enter any worker-writable surface or the runner mounts',
    });
  }

  violations.push(...scanForForbiddenValues(mounts));
  return violations;
}

function validateAuthority({ authority, projectId }) {
  const violations = [];
  const add = (code, at, extra) => violations.push({ code, at, ...(extra ?? {}) });
  if (authority.interface !== 'Authority.v1') add('AUTHORITY_INTERFACE_INVALID', 'authority-registration.example.json', { expected: 'Authority.v1' });

  const parsed = parseSecretRef(authority.authority?.credentialRef ?? '');
  if (!parsed.ok) {
    add(parsed.code, 'authority-registration.example.json:authority', { ref: authority.authority?.credentialRef, reason: parsed.error });
  } else if (projectId && parsed.project !== projectId) {
    add('CROSS_PROJECT_REF', 'authority-registration.example.json:authority', { ref: authority.authority.credentialRef, project: parsed.project });
  }
  if (authority.uniqueness?.concurrentWriterPolicy !== 'REFUSE' || authority.uniqueness?.copiedStatePolicy !== 'REFUSE') {
    add('AUTHORITY_UNIQUENESS_INCOMPLETE', 'authority-registration.example.json:uniqueness', {
      reason: 'startup must declare REFUSE for concurrent writers and copied state (Authority.v1)',
    });
  }

  const registrations = Array.isArray(authority.registrations) ? authority.registrations : [];
  const seenAuthority = new Map();
  const seenRegistration = new Set();
  const seenInstance = new Set();
  for (const [index, registration] of registrations.entries()) {
    const at = `authority-registration.example.json:registrations[${index}]`;
    const missing = ['registrationId', 'authorityId', 'workspaceId', 'instanceId', 'stateOrigin', 'writerExclusivity']
      .filter((field) => registration?.[field] === undefined || registration?.[field] === null || registration?.[field] === '');
    if (missing.length > 0) {
      add('AUTHORITY_REGISTRATION_INCOMPLETE', at, { missing });
      continue;
    }
    if (seenRegistration.has(registration.registrationId) || seenInstance.has(registration.instanceId)) {
      add('AUTHORITY_DUPLICATE_REGISTRATION', at, { registrationId: registration.registrationId });
    }
    seenRegistration.add(registration.registrationId);
    seenInstance.add(registration.instanceId);
    const key = `${registration.authorityId}@${registration.workspaceId}`;
    if (seenAuthority.has(key)) {
      add('AUTHORITY_DUPLICATE_REGISTRATION', at, { authorityId: registration.authorityId, workspaceId: registration.workspaceId, reason: 'one authority + workspace admits exactly one registration' });
    }
    seenAuthority.set(key, registration);
    if (registration.stateOrigin !== 'authoritative') {
      add('COPIED_STATE_FORBIDDEN', at, { stateOrigin: registration.stateOrigin, reason: 'startup refuses a registration whose state was copied from another instance' });
    }
    if (registration.writerExclusivity !== 'single') {
      add('CONCURRENT_WRITER_FORBIDDEN', at, { writerExclusivity: registration.writerExclusivity, reason: 'startup refuses while another writer may hold the authority' });
    }
  }
  violations.push(...scanForForbiddenValues(authority));
  return violations;
}

// compose 仅声明门（行级结构检查；真实 UID/挂载/负向写效果属 up 后的运行时证据 probe role-denial）。
function validateCompose(text, { controlVolumeNames, roleNames }) {
  const violations = [];
  const add = (code, at, extra) => violations.push({ code, at, ...(extra ?? {}) });
  let section = null;
  let service = null;
  let key = null;
  let sawServices = false;
  let sawNetworks = false;
  const services = [];
  const stateByService = new Map();
  let state = null;

  for (const [index, raw] of text.split('\n').entries()) {
    const lineNo = index + 1;
    const trimmedRaw = raw.trim();
    if (!trimmedRaw || trimmedRaw.startsWith('#')) continue;
    if (trimmedRaw.includes('docker.sock')) add('DOCKER_SOCK_MOUNT_FORBIDDEN', `compose.yaml:${lineNo}`, { reason: 'workers and runner services never get the docker socket' });
    const stripped = raw.replace(/\$\{[^}]*\}/g, 'PLACEHOLDER').trim();
    if (HOST_USER_PATH.test(stripped)) add('HOST_MOUNT_FORBIDDEN', `compose.yaml:${lineNo}`, { reason: 'host user paths never belong in compose' });
    if (/^image:\s*/.test(trimmedRaw)) {
      if (!PLACEHOLDER_IMAGE_RE.test(trimmedRaw)) {
        add('COMPOSE_IMAGE_NOT_LOCK_RESOLVED', `compose.yaml:${lineNo}`, { line: trimmedRaw.slice(0, 120) });
      }
      continue;
    }
    if (/^privileged:\s*true/.test(stripped)) add('PRIVILEGED_FORBIDDEN', `compose.yaml:${lineNo}`);
    if (/^network_mode:\s*host/.test(stripped)) add('HOST_NETWORK_FORBIDDEN', `compose.yaml:${lineNo}`);

    const indent = raw.length - raw.trimStart().length;
    if (indent === 0) {
      const topMatch = stripped.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (topMatch) {
        section = topMatch[1];
        service = null;
        key = null;
        if (section === 'services') sawServices = true;
        if (section === 'networks') sawNetworks = true;
      }
      continue;
    }
    if (indent === 2 && section === 'services') {
      const serviceMatch = stripped.match(/^([A-Za-z0-9_-]+):\s*$/);
      if (serviceMatch) {
        service = serviceMatch[1];
        key = null;
        services.push(service);
        state = { readOnly: false, capDropAll: false, noNewPrivs: false };
        stateByService.set(service, state);
        const role = service.match(/^comet-([a-z-]+)$/)?.[1];
        if (!role || !roleNames.includes(role)) {
          add('SERVICE_ROLE_UNKNOWN', `compose.yaml:${lineNo}`, { service, reason: 'services must map 1:1 onto the role-policy roles' });
        }
      }
      continue;
    }
    if (service && indent === 4) {
      const kv = stripped.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (kv) {
        key = kv[1];
        if (key === 'read_only' && kv[2] === 'true') state.readOnly = true;
        continue;
      }
    }
    if (service && indent >= 6 && stripped.startsWith('-') && key) {
      let item = stripped.slice(1).trim();
      if (item.startsWith('"') && item.endsWith('"')) item = item.slice(1, -1);
      if (key === 'ports') {
        if (item.split(':')[0] !== '127.0.0.1') add('PORT_BINDING_NOT_LOOPBACK', `compose.yaml:${lineNo}`, { binding: item });
      } else if (key === 'volumes') {
        const left = item.split(':')[0];
        if (left === 'PLACEHOLDER' || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(left)) {
          add('HOST_MOUNT_FORBIDDEN', `compose.yaml:${lineNo}`, { mount: redactHostPaths(item), reason: 'only named volumes are allowed; no host bind mounts' });
        } else if (controlVolumeNames.has(left) && service !== 'comet-controller') {
          add('WORKER_CONTROL_PATH_FORBIDDEN', `compose.yaml:${lineNo}`, { volume: left, reason: 'control state/receipts/issuance volumes mount for the controller only' });
        }
      } else if (key === 'cap_drop') {
        if (item === 'ALL') state.capDropAll = true;
      } else if (key === 'security_opt') {
        if (item === 'no-new-privileges:true') state.noNewPrivs = true;
      }
    }
  }

  if (!sawServices) add('SERVICES_MISSING', 'compose.yaml');
  if (!sawNetworks) add('NETWORK_MISSING', 'compose.yaml');
  if (!/internal:\s*true/.test(text)) add('NETWORK_NOT_INTERNAL', 'compose.yaml');
  for (const name of services) {
    const at = `compose.yaml:${name}`;
    const state2 = stateByService.get(name);
    if (!state2.readOnly) add('READ_ONLY_ROOTFS_REQUIRED', at, { reason: 'every runner service must declare a read-only root filesystem' });
    if (!state2.capDropAll) add('CAP_DROP_ALL_REQUIRED', at, { reason: 'every runner service must drop ALL capabilities' });
    if (!state2.noNewPrivs) add('NO_NEW_PRIVILEGES_REQUIRED', at, { reason: 'no-new-privileges is invariant for runner services' });
  }
  for (const role of roleNames) {
    if (!services.includes(`comet-${role}`)) add('ROLE_SERVICE_MISSING', 'compose.yaml', { role, reason: 'each role-policy role needs exactly one service' });
  }
  return violations;
}

function validateDockerfile(text) {
  const violations = [];
  const add = (code, at, extra) => violations.push({ code, at, ...(extra ?? {}) });
  for (const [index, raw] of text.split('\n').entries()) {
    const lineNo = index + 1;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (/^FROM\s+\S+/.test(trimmed) && !/^FROM\s+\$\{RUNNER_BASE_IMAGE\}\s*$/.test(trimmed)) {
      add('DOCKERFILE_FLOATING_BASE', `Dockerfile:${lineNo}`, { line: trimmed.slice(0, 120), reason: 'the base image resolves only from the lock via RUNNER_BASE_IMAGE' });
    }
    if (HOST_USER_PATH.test(trimmed)) {
      add('DOCKERFILE_HOST_PATH', `Dockerfile:${lineNo}`, { reason: 'host user paths never belong in the runner image build' });
    }
    if (SECRET_PLAINTEXT.some((pattern) => pattern.test(trimmed))) {
      add('SECRET_PLAINTEXT_FORBIDDEN', `Dockerfile:${lineNo}`, { reason: 'value matches a known secret token shape' });
    }
  }
  if (!/^ARG\s+RUNNER_BASE_IMAGE\s*$/m.test(text)) {
    add('DOCKERFILE_BASE_NOT_LOCK_RESOLVED', 'Dockerfile', { reason: 'base image must arrive via the RUNNER_BASE_IMAGE arg resolved from the lock' });
  }
  if (!/^USER\s+(?!root\b)\S+$/m.test(text)) {
    add('DOCKERFILE_USER_REQUIRED', 'Dockerfile', { reason: 'the runner image must run as a non-root user' });
  }
  return violations;
}

// 上游锁（integrations/comet/upstream.lock.json）是补丁链/工具链/指纹的唯一事实源。
// fingerprint 算法与 tools/comet/build.mjs 的 fingerprintOf 完全一致：sha256(JSON({archive, patches, toolchain}))。
function computeBuildFingerprint(upstream) {
  return crypto.createHash('sha256').update(JSON.stringify({
    archive: upstream.source.sha256,
    patches: (upstream.patches ?? []).map(({ path: patchPath, sha256 }) => ({ path: patchPath, sha256 })),
    toolchain: upstream.toolchain,
  })).digest('hex');
}

function loadUpstreamLock() {
  try {
    return { upstream: JSON.parse(fs.readFileSync(path.join(repoRoot, 'integrations', 'comet', 'upstream.lock.json'), 'utf8')), error: null };
  } catch (error) {
    return { upstream: null, error: redactHostPaths(error.message) };
  }
}

// RW_RUNNER_BUILD 一致性发现：runner 域（image.lock.json）与当前上游锁/磁盘补丁的漂移。
// validate 报违规、build-plan 报 drift，同源同码（validate/qualify/up/build-plan 共享同一结果）。
function buildChainFindings({ lock, upstream, upstreamError }) {
  const findings = [];
  const add = (code, at, extra) => findings.push({ code, at, ...(extra ?? {}) });
  if (!upstream) {
    add('UPSTREAM_LOCK_UNREADABLE', 'integrations/comet/upstream.lock.json', { reason: upstreamError });
    return { findings, fingerprint: null, patchVerification: [], upstreamPatches: [] };
  }
  const source = lock.sourceInputs ?? {};
  const upstreamPatches = Array.isArray(upstream.patches) ? upstream.patches : [];
  if (JSON.stringify(source.patches ?? null) !== JSON.stringify(upstreamPatches)) {
    add('PATCH_LOCK_MISMATCH', 'image.lock.json:sourceInputs.patches', {
      reason: 'the runner lock must mirror the upstream patch list exactly (order + sha256)',
      lockedCount: Array.isArray(source.patches) ? source.patches.length : 0,
      upstreamCount: upstreamPatches.length,
    });
  }
  if (JSON.stringify(source.toolchain ?? null) !== JSON.stringify(upstream.toolchain ?? null)) {
    add('TOOLCHAIN_PIN_MISMATCH', 'image.lock.json:sourceInputs.toolchain', { reason: 'toolchain pins must equal the upstream lock' });
  }
  const openspec = source.openspec;
  if (!openspec || openspec.package !== '@fission-ai/openspec' || typeof openspec.version !== 'string' || openspec.version.length === 0 || !/^[0-9a-f]{64}$/.test(openspec.tarballSha256 ?? '')) {
    add('OPENSPEC_PIN_INVALID', 'image.lock.json:sourceInputs.openspec', { reason: 'the openspec pin (package/version/tarballSha256) must be recorded from the verified isolated candidate' });
  }
  const fingerprint = computeBuildFingerprint(upstream);
  if (source.hostBuildFingerprint !== fingerprint) {
    add('FINGERPRINT_STALE', 'image.lock.json:sourceInputs.hostBuildFingerprint', {
      reason: 'the recorded fingerprint must equal the freshly recomputed lock-derived fingerprint (archive+patches+toolchain)',
      expected: fingerprint,
    });
  }
  const patchVerification = upstreamPatches.map((patch) => {
    let actual = null;
    try {
      actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(repoRoot, patch.path))).digest('hex');
    } catch { /* absent or unreadable: fail closed below */ }
    const sha256Verified = actual === patch.sha256;
    if (!sha256Verified) {
      add('PATCH_SHA256_MISMATCH', `integrations/comet/patches:${patch.path}`, { reason: 'a locked patch differs from its pinned sha256 on disk' });
    }
    return { path: patch.path, sha256: patch.sha256, sha256Verified };
  });
  return { findings, fingerprint, patchVerification, upstreamPatches };
}

// Dockerfile 必须消费锁定的完整有序补丁链（ARG 注入 + /build/repo 镜像路径 COPY + sha256 门），
// 入口必须是 fingerprint 确定性路径；find 式漂移入口（历史缺陷：head -n 1 静默吞掉指纹漂移）拒绝。
function validateDockerfileChain(text, upstreamPatches) {
  const violations = [];
  const add = (code, at, extra) => violations.push({ code, at, ...(extra ?? {}) });
  const joined = text.replace(/\\\n/g, ' ');
  const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const [index, patch] of upstreamPatches.entries()) {
    const n = index + 1;
    const escaped = escapeRegExp(patch.path);
    if (!new RegExp(`^ARG PATCH_${n}_SHA256$`, 'm').test(text)) {
      add('PATCH_CHAIN_INCOMPLETE', `Dockerfile:PATCH_${n}_SHA256`, { patch: patch.path, reason: `ARG PATCH_${n}_SHA256 missing` });
    }
    if (!new RegExp(`^COPY ${escaped} /build/repo/${escaped}$`, 'm').test(text)) {
      add('PATCH_CHAIN_INCOMPLETE', `Dockerfile:PATCH_${n}_COPY`, { patch: patch.path, reason: 'the patch must be mirrored under /build/repo at its lock-relative path' });
    }
    if (!joined.includes(`echo "\${PATCH_${n}_SHA256}  /build/repo/${patch.path}" | sha256sum -c -`)) {
      add('PATCH_CHAIN_INCOMPLETE', `Dockerfile:PATCH_${n}_GATE`, { patch: patch.path, reason: 'the sha256sum gate for the mirrored patch is missing' });
    }
  }
  if (/find\s+\/build/.test(text)) {
    add('ENTRYPOINT_NONDETERMINISTIC', 'Dockerfile', { reason: 'entrypoint resolution must be the fingerprint-deterministic managed path; find-based drift entry is forbidden' });
  }
  return violations;
}

function validateDomain({ registry, refsDoc, files }) {
  const violations = [];
  const projectId = registry?.project?.id;
  const jsonDocs = new Map(JSON_FILES.map((name) => [name, JSON.parse(files.get(name))]));
  const rolePolicy = jsonDocs.get('role-policy.json');
  const mounts = jsonDocs.get('workspace-mounts.json');

  // I01 目录缺口：runner 四 ref 中未登记的显式上报（缺口是 readiness 证据，不是结构违规——沿 I03 先例）。
  const catalogRefs = new Set((refsDoc?.refs ?? []).map((entry) => entry.ref));
  const catalogGaps = RUNNER_REFS.filter((ref) => !catalogRefs.has(ref)).sort();
  const catalogBoundRoles = (refsDoc?.refs ?? []).filter((entry) => !RUNNER_REFS.includes(entry.ref));

  violations.push(...validateImageLock(jsonDocs.get('image.lock.json')));
  violations.push(...validateRolePolicy({ policy: rolePolicy, refsDoc, projectId, catalogBoundRoles }).violations);
  violations.push(...validateWorkspaceMounts({ mounts, policy: rolePolicy }));
  violations.push(...validateAuthority({ authority: jsonDocs.get('authority-registration.example.json'), projectId }));

  const controlVolumeNames = new Set((mounts.controlVolumes ?? []).map((control) => control.volume));
  // RW_RUNNER_BUILD：镜像构建链与当前上游锁/磁盘补丁的一致性（validate/qualify/up/build-plan 同源）。
  const imageLock = jsonDocs.get('image.lock.json');
  const { upstream, error: upstreamError } = loadUpstreamLock();
  const chain = buildChainFindings({ lock: imageLock, upstream, upstreamError });
  violations.push(...chain.findings);
  violations.push(...validateDockerfileChain(files.get('Dockerfile'), chain.upstreamPatches));

  violations.push(...validateCompose(files.get('compose.yaml'), { controlVolumeNames, roleNames: RUNNER_ROLES }));
  violations.push(...validateDockerfile(files.get('Dockerfile')));

  return { violations, catalogGaps };
}

function buildQualification({ registryFile, dir, files, violations, catalogGaps }) {
  const lock = JSON.parse(files.get('image.lock.json'));
  const components = Array.isArray(lock.components) ? lock.components : [];
  const unreadyComponents = [];
  for (const name of LOCK_COMPONENTS) {
    const entry = components.find((component) => component.component === name);
    if (!entry || typeof entry.reference !== 'string' || !entry.digest || !DIGEST_RE.test(entry.digest) || entry.digestAuthenticated !== true) {
      unreadyComponents.push({
        component: name,
        status: 'UNVERIFIED',
        reason: !entry
          ? 'component missing from lock'
          : `reference=${entry.reference ? 'recorded' : 'UNBUILT/UNSELECTED'}, digest=${entry.digest ? 'recorded' : 'absent'}, digestAuthenticated=${entry.digestAuthenticated === true}`,
      });
    }
  }
  const source = lock.sourceInputs ?? {};
  const categories = {
    'source-pins': RECORDED(
      `comet commit/archive sha256, ${source.patches?.length ?? 0} patch sha256s, toolchain and host build fingerprint ${source.hostBuildFingerprint ?? '(absent)'} recorded from integrations/comet/upstream.lock.json + P1_6; no independent recomputation was performed on this host`,
    ),
    'container-image': unreadyComponents.length === 0
      ? RECORDED('digests recorded for all components; container daemon verification of the built image is still pending')
      : UNVERIFIED(`no runner/base image has an authenticated digest: the containerized build never executed (docker daemon unreachable on this host: EPERM); inventing tags/digests is forbidden (${unreadyComponents.map((c) => c.component).join(', ')})`),
    'role-boundary-declaration': violations.length === 0
      ? RECORDED('six roles with distinct principals/credentials/volumes, read-only rootfs, dropped capabilities, worker-unwritable control paths — structurally declared and self-consistent')
      : UNVERIFIED(`role boundary structure violates its own invariants: ${[...new Set(violations.map((violation) => violation.code))].join(', ')}`),
    'role-isolation-enforcement': UNVERIFIED('probe role-denial never executed against a live runner: real container inspect (UID/GID/mounts) and per-channel (Edit/Shell/MCP) negative-write evidence is required; declared structure never substitutes for measured denial'),
    'control-directory-closure': UNVERIFIED('probe role-denial (control-path writes) and live mount inspection must prove no worker-writable control path exists on a running stack'),
    'authority-exclusivity': UNVERIFIED('probe duplicate-authority never executed: one-writer evidence across two start requests (copied state refused, old owner/attempt rejected) requires the authoritative state volume'),
    'secret-refs-registered': catalogGaps.length === 0
      ? RECORDED('all 4 runner refs present in the I01 catalog; all remain NOT_PROVISIONED')
      : UNVERIFIED(`refs missing from the I01 catalog (catalog is I01-owned and needs a registration update): ${catalogGaps.join(', ')}`),
    'credentials-provisioned': UNVERIFIED('all runner refs are NOT_PROVISIONED or UNASSIGNED; no runtime secret store authorization exists (I01 resolves read-only UNRESOLVED by design)'),
  };
  const inputs = { registrySha256: sha256Text(fs.readFileSync(registryFile)), domainFiles: {} };
  for (const name of DOMAIN_FILES) inputs.domainFiles[name] = sha256Text(files.get(name));
  const values = Object.values(categories);
  return {
    interface: 'Qualification.v1',
    domain: 'comet-runner',
    dir: displayPath(dir),
    ready: values.every((category) => category.status === 'VERIFIED'),
    unverifiedCount: values.filter((category) => category.status === 'UNVERIFIED').length,
    catalogGaps,
    categories,
    inputs,
    unreadyComponents,
  };
}

const PROBE_CASES = {
  'role-denial': {
    requiredInputs: [
      'a live runner stack started by an authorized operator (up refuses until the image lock authenticates and admission is granted)',
      'real worker principals for controller/author/test-author/reviewer/publisher/isolator with runtime-resolved credentials (all refs are NOT_PROVISIONED/UNASSIGNED today)',
      'a controlled write-channel matrix (Edit/Shell/MCP) executed inside each role container, retaining errno/request evidence per channel',
    ],
    plannedSteps: [
      'docker inspect each role service: record UID/GID, read-only rootfs, cap_drop, mounts and network scope',
      'as each worker role, attempt writes to control state, policy, receipts and issuance paths via Edit/Shell/MCP channels (expect per-channel denial; keep errno/request evidence)',
      'attempt docker.sock access and host HOME reads from a worker container (expect denial)',
      'kill the controller, then attempt phase pickup/retry as a worker role (expect Comet to reject the old owner/attempt; infrastructure must not fabricate a new operation)',
      'record the effective denial per channel; capability gaps stay UNVERIFIED and are never recorded as enforced',
    ],
  },
  'duplicate-authority': {
    requiredInputs: [
      'the authoritative Comet state volume with the original RunID/authority registration',
      'a copied state clone (second volume or second host)',
      'two candidate runner instances pointing at the same authority/workspace',
    ],
    plannedSteps: [
      'start instance A against the authoritative state; record the single accepted writer identity',
      'start instance B against the copied state with the same authority id (expect startup refusal; COPIED_STATE_FORBIDDEN semantics)',
      'resume the original RunID/operation from the authoritative state (old owner/attempt results rejected by Comet; no fabricated new operation)',
      'read back exactly one valid Comet writer across both start requests',
    ],
  },
};

async function main(argv) {
  const { command, opts, error } = parseArgs(argv);
  if (error) return failInput(error);
  if (!command) return failInput('missing command');

  if (command === 'probe') {
    const spec = PROBE_CASES[opts.case];
    if (!spec) return failInput(`unknown probe case: ${opts.case ?? '(missing --case)'}`);
    const dir = opts.dir ?? DEFAULT_DIR;
    const { files, missing, unparseable } = loadDomainFiles(dir);
    if (missing.length > 0) return failInput(`domain files missing (${displayPath(dir)}): ${missing.join(', ')}`);
    if (unparseable.length > 0) return failInput(`domain files unparseable: ${unparseable.join('; ')}`);
    const rolePolicy = JSON.parse(files.get('role-policy.json'));
    const authority = JSON.parse(files.get('authority-registration.example.json'));
    const endpoint = opts.endpoint ?? process.env.COMET_RUNNER_ENDPOINT ?? null;
    const observation = {
      interface: 'RunnerInfra.v1',
      command: 'probe',
      case: opts.case,
      endpoint,
      executed: false,
      status: 'UNVERIFIED',
      reason: null,
      requiredInputs: spec.requiredInputs,
      plannedSteps: spec.plannedSteps,
      observedSteps: [],
      domain: {
        roles: (rolePolicy.roles ?? []).map((role) => role.role),
        authority: {
          interface: authority.interface,
          registrations: (authority.registrations ?? []).length,
          concurrentWriterPolicy: authority.uniqueness?.concurrentWriterPolicy ?? null,
          copiedStatePolicy: authority.uniqueness?.copiedStatePolicy ?? null,
        },
      },
    };
    if (!endpoint) {
      observation.reason =
        'no live runner runtime configured; probes require a real runner stack started by an authorized operator (up refuses until the image lock authenticates and admission is granted). Pass --endpoint <url> once the stack exists — this command never mocks and never skips.';
      print(observation);
      return EXIT_VERIFY;
    }
    // 真实可达性尝试：探针永远先打真实请求，失败即如实上报，绝不 mock。
    try {
      const response = await fetch(String(endpoint).replace(/\/$/, '') + '/', { signal: AbortSignal.timeout(5000) });
      observation.observedSteps.push({ step: `GET ${endpoint}/`, status: 'VERIFIED', httpStatus: response.status });
    } catch (err) {
      const causeDetail = err?.cause ? (err.cause.code ?? err.cause.message ?? err.cause.name) : (err?.code ?? err?.message ?? err?.name ?? 'ERROR');
      const cause = redactHostPaths(String(causeDetail));
      observation.observedSteps.push({ step: `GET ${endpoint}/`, status: 'UNVERIFIED', error: cause });
      observation.reason = `runner endpoint unreachable (GET ${endpoint}/): ${cause}`;
      print(observation);
      return EXIT_VERIFY;
    }
    observation.observedSteps.push({
      step: 'role denial / authority exclusivity channels',
      status: 'UNVERIFIED',
      reason: 'requires real worker principals with runtime-resolved credentials and the authoritative state volume; none exist yet',
    });
    observation.reason = 'endpoint reachable, but probe channels require runtime principals and admission evidence that do not exist yet; no step may be fabricated';
    print(observation);
    return EXIT_VERIFY;
  }

  if (command === 'stop') {
    print({
      interface: 'RunnerInfra.v1',
      command: 'stop',
      executed: false,
      status: 'UNVERIFIED',
      reason:
        'no runner stack was ever started by this tool (up refuses until the image lock qualifies and admission is granted); there is nothing this tool can stop. A stack started outside this tool must be stopped by its own supervisor.',
    });
    return EXIT_VERIFY;
  }

  // build-plan：由当前上游锁导出 Runner 镜像构建计划（六补丁链/工具链/现算指纹/确定性入口/构建参数/输入获取）。
  // 只导出声明：绝不执行构建、绝不打开 up 门（digest 回填是资源准入决策）；与上游锁漂移即拒绝（退出 2）。
  if (command === 'build-plan') {
    const dir = opts.dir ?? DEFAULT_DIR;
    const { files, missing, unparseable } = loadDomainFiles(dir);
    if (missing.length > 0) return failInput(`domain files missing (${displayPath(dir)}): ${missing.join(', ')}`);
    if (unparseable.length > 0) return failInput(`domain files unparseable: ${unparseable.join('; ')}`);
    const lock = JSON.parse(files.get('image.lock.json'));
    const { upstream, error: upstreamError } = loadUpstreamLock();
    const chain = buildChainFindings({ lock, upstream, upstreamError });
    const drift = chain.findings.map((finding) => finding.code);
    const sourceCommit = upstream?.source?.commit ?? null;
    const openspec = lock.sourceInputs?.openspec ?? {};
    const runnerCache = '.sdd/cache/runner-build';
    // 镜像构建输入只认 .sdd/cache/runner-build 下的锁定副本：在场且 sha256 与锁一致才 PRESENT，
    // 否则如实 ACQUISITION_REQUIRED 并声明期望 sha 与获取方式（绝不虚构“已就绪”）。
    const buildInput = (relPath, expectedSha256, acquisition) => {
      let sha256Verified = false;
      try {
        sha256Verified = crypto.createHash('sha256').update(fs.readFileSync(path.join(repoRoot, relPath))).digest('hex') === expectedSha256;
      } catch { /* absent on this host */ }
      return {
        path: relPath,
        status: sha256Verified ? 'PRESENT' : 'ACQUISITION_REQUIRED',
        expectedSha256,
        ...(sha256Verified ? { sha256Verified } : { acquisition }),
      };
    };
    const buildArgs = {
      RUNNER_BASE_IMAGE: '<resolved-at-admission:image.lock.json:components.runner-base>',
      SOURCE_COMMIT: sourceCommit,
      SOURCE_SHA256: upstream?.source?.sha256 ?? null,
      EXPECTED_FINGERPRINT: chain.fingerprint,
      OPENSPEC_VERSION: openspec.version ?? null,
      OPENSPEC_TARBALL_SHA256: openspec.tarballSha256 ?? null,
      ...Object.fromEntries(chain.patchVerification.map((patch, index) => [`PATCH_${index + 1}_SHA256`, patch.sha256])),
    };
    print({
      interface: 'RunnerInfra.v1',
      command: 'build-plan',
      dir: displayPath(dir),
      drift,
      sourceCommit,
      fingerprint: chain.fingerprint,
      patches: chain.patchVerification,
      entrypoint: sourceCommit && chain.fingerprint
        ? `/build/repo/.sdd/vendor/comet/${sourceCommit}/builds/${chain.fingerprint}/work/bin/comet.js`
        : null,
      inputs: {
        cometSourceArchive: buildInput(`${runnerCache}/comet-source.tar.gz`, upstream?.source?.sha256 ?? null, {
          url: upstream?.source?.url ?? null,
          bytes: upstream?.source?.bytes ?? null,
          command: `mkdir -p ${runnerCache} && curl -fsSL ${upstream?.source?.url ?? ''} -o ${runnerCache}/comet-source.tar.gz`,
        }),
        openspecTarball: buildInput(`${runnerCache}/openspec-${openspec.version ?? 'PIN_MISSING'}.tgz`, openspec.tarballSha256 ?? null, {
          url: openspec.registryTarball ?? null,
          bytes: openspec.tarballBytes ?? null,
          command: `mkdir -p ${runnerCache} && curl -fsSL ${openspec.registryTarball ?? ''} -o ${runnerCache}/openspec-${openspec.version ?? ''}.tgz`,
        }),
      },
      dockerBuild: {
        dockerfile: 'infra/delivery/runner/Dockerfile',
        context: '.',
        buildArgs,
        command: [
          'docker build',
          '-f infra/delivery/runner/Dockerfile',
          ...Object.entries(buildArgs).map(([key, value]) => `--build-arg ${key}=${value}`),
          '.',
        ].join(' '),
      },
      upGate: lock.upGate?.enabled === true ? 'OPEN' : 'CLOSED',
      containerBuildStatus: lock.sourceInputs?.containerBuildStatus ?? null,
    });
    return drift.length === 0 ? EXIT_PASS : EXIT_VERIFY;
  }

  // validate/qualify/up：registry 与 refs 目录必须先可读（fail-closed，绝不静默降级为空规则）。
  const registryFile = opts.registry ?? DEFAULT_REGISTRY;
  const refsFile = opts.refs ?? DEFAULT_REFS;
  let registry;
  let refsDoc;
  try {
    registry = JSON.parse(fs.readFileSync(registryFile, 'utf8'));
  } catch (err) {
    return failInput(`registry unreadable: ${redactHostPaths(err.message)}`);
  }
  try {
    refsDoc = JSON.parse(fs.readFileSync(refsFile, 'utf8'));
  } catch (err) {
    return failInput(`refs catalog unreadable (${displayPath(refsFile)}): ${redactHostPaths(err.message)}`);
  }
  const dir = opts.dir ?? DEFAULT_DIR;
  const { files, missing, unparseable } = loadDomainFiles(dir);
  if (missing.length > 0) return failInput(`domain files missing (${displayPath(dir)}): ${missing.join(', ')}`);
  if (unparseable.length > 0) return failInput(`domain files unparseable: ${unparseable.join('; ')}`);

  if (command === 'validate') {
    const { violations, catalogGaps } = validateDomain({ registry, refsDoc, files });
    const rolePolicy = JSON.parse(files.get('role-policy.json'));
    const authority = JSON.parse(files.get('authority-registration.example.json'));
    const lock = JSON.parse(files.get('image.lock.json'));
    print({
      interface: 'RunnerInfra.v1',
      command: 'validate',
      registry: displayPath(registryFile),
      refs: displayPath(refsFile),
      dir: displayPath(dir),
      ok: violations.length === 0,
      violations,
      catalogGaps,
      roles: (rolePolicy.roles ?? []).map((role) => ({
        role: role.role,
        principalLabel: role.principal?.label ?? null,
        credentialRef: role.principal?.credentialRef ?? null,
        provisioningStatus: role.principal?.provisioningStatus ?? null,
        workspaceVolume: role.workspaceVolume,
        grantedRefCount: (role.grantedRefs ?? []).length,
      })),
      methodState: {
        declaration: rolePolicy.methodStateScope?.declaration ?? null,
        model: rolePolicy.methodStateScope?.model ?? null,
        identityBasis: rolePolicy.methodStateScope?.identityBasis ?? null,
        permissionBasis: rolePolicy.methodStateScope?.permissionBasis ?? null,
        completionBasis: rolePolicy.methodStateScope?.completionBasis ?? null,
        dispatchRecordStatus: rolePolicy.methodStateScope?.dispatchRecord?.status ?? null,
      },
      authority: {
        interface: authority.interface,
        authorityStatus: authority.authority?.status ?? null,
        registrations: (authority.registrations ?? []).length,
        concurrentWriterPolicy: authority.uniqueness?.concurrentWriterPolicy ?? null,
        copiedStatePolicy: authority.uniqueness?.copiedStatePolicy ?? null,
      },
      imageLock: {
        interface: lock.interface,
        upGate: lock.upGate ?? null,
        containerBuildStatus: lock.sourceInputs?.containerBuildStatus ?? null,
        components: (lock.components ?? []).map((component) => ({
          component: component.component,
          reference: component.reference,
          digest: component.digest,
          status: component.status,
        })),
      },
    });
    return violations.length === 0 ? EXIT_PASS : EXIT_VERIFY;
  }

  if (command === 'qualify' || command === 'up') {
    // 单一事实源：violations 与 catalog 缺口来自同一 validateDomain 结果，validate/qualify/up 共享。
    const { violations, catalogGaps } = validateDomain({ registry, refsDoc, files });
    const qualification = buildQualification({ registryFile, dir, files, violations, catalogGaps });
    if (command === 'qualify') {
      print(qualification);
      return qualification.ready ? EXIT_PASS : EXIT_VERIFY;
    }
    if (qualification.unreadyComponents.length > 0) {
      print({
        interface: 'Qualification.v1',
        command: 'up',
        domain: 'comet-runner',
        refused: true,
        ready: false,
        error: `UP_REFUSED_RUNNER_LOCK_NOT_READY: ${qualification.unreadyComponents.length} component images lack an authenticated digest (no containerized build has ever run on this host)`,
        unverifiedComponents: qualification.unreadyComponents,
        receipt: qualification,
      });
      return EXIT_VERIFY;
    }
    const lock = JSON.parse(files.get('image.lock.json'));
    if (lock.upGate?.enabled !== true) {
      print({
        interface: 'Qualification.v1',
        command: 'up',
        domain: 'comet-runner',
        refused: true,
        ready: true,
        error: `UP_NOT_AUTHORIZED: ${lock.upGate?.reason ?? 'up gate is closed in this task'}`,
      });
      return EXIT_VERIFY;
    }
    const daemon = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf8', timeout: 8000 });
    if (daemon.status !== 0) {
      print({
        interface: 'Qualification.v1',
        command: 'up',
        domain: 'comet-runner',
        refused: true,
        ready: true,
        status: 'UNVERIFIED',
        error: `UP_REFUSED_CONTAINER_DAEMON_UNREACHABLE: ${redactHostPaths(daemon.stderr.trim().split('\n')[0] || `docker exited ${daemon.status}`)}`,
      });
      return EXIT_VERIFY;
    }
    print({
      interface: 'Qualification.v1',
      command: 'up',
      domain: 'comet-runner',
      refused: true,
      ready: true,
      status: 'UNVERIFIED',
      error: 'UP_NOT_EXECUTED: runtime launch requires an authorized operator context; I02 declares the role boundary and gates, admission is a later explicit decision',
    });
    return EXIT_VERIFY;
  }

  return failInput(`unknown command: ${command}`);
}

process.exit(await main(process.argv.slice(2)));

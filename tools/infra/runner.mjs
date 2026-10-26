#!/usr/bin/env node
// RunnerInfra.v1 — 退休边界 CLI（ADR-0021，修订 2026-10-26-comet-050-adoption-v1）
// validate | qualify | up | probe | stop | build-plan
//
// 六角色常驻部署与 0.4.5 七补丁镜像构建链已从所有默认安装/启动/检查路径退休。
// 剩余表面：退役声明的通用结构检查（复用既有校验器）、诚实的退休资格回执、
// 以及按需临时作业驱动 createCliJobDriver —— 仅由真实授权 dispatch 后方的固定宿主使用。
// 本 CLI 绝不启动/停止/删除任何容器、卷或镜像；普通命令不依赖临时 Docker。
//
// 退出码契约（execution-contract.json V_INFRA_I02.cli_contract）：
//   0 = PASS（validate 通过）
//   1 = 输入或前置无效（文件缺失/不可解析、参数错误、未知 probe case）
//   2 = 验证失败（语义违规、qualify NOT_READY、退休拒绝、probe/stop 环境缺失 UNVERIFIED）
//   环境缺失必须显式 UNVERIFIED 并以非零退出，不允许 skip 或 mock 转绿。

import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseSecretRef, redactSecretValue, scanForForbiddenValues, validateQualificationPolicy, validateRefsCatalog } from './secret-refs.mjs';
import { envelopeDigest } from '../../lib/delivery/evidence.js';
import { parseContract } from '../../contracts/delivery/index.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const EXIT_PASS = 0;
const EXIT_INPUT = 1;
const EXIT_VERIFY = 2;
const DEFAULT_REGISTRY = path.join(repoRoot, 'infra', 'delivery', 'registry.json');
const DEFAULT_REFS = path.join(repoRoot, 'infra', 'delivery', 'secrets.refs.example.json');
const DEFAULT_POLICY = path.join(repoRoot, 'infra', 'delivery', 'qualification-policy.json');
const DEFAULT_DIR = path.join(repoRoot, 'infra', 'delivery', 'runner');
const RETIREMENT_DECISION = 'docs/architecture/adr/0021-comet-command-first-no-resident-role-services.md';
const RETIREMENT_REVISION = '2026-10-26-comet-050-adoption-v1';

const JSON_FILES = ['image.lock.json', 'role-policy.json', 'workspace-mounts.json', 'authority-registration.example.json'];
const DOMAIN_FILES = ['compose.yaml', 'Dockerfile', ...JSON_FILES];
const RUNNER_ROLES = ['controller', 'author', 'test-author', 'reviewer', 'publisher', 'isolator'];
const RUNNER_REFS = [
  'secret-ref:sdd-harness-pilot/runner-authority',
  'secret-ref:sdd-harness-pilot/worker-author-api',
  'secret-ref:sdd-harness-pilot/worker-review-api',
  'secret-ref:sdd-harness-pilot/runner-source-read',
];
const LOCK_COMPONENTS = ['comet-runner', 'runner-base', 'python-runtime'];
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const LABEL_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

// 宿主私有路径绝不进入结构化回执/报告；对外输出统一脱敏（与 secret-refs 的 ABSOLUTE_PATH_FORBIDDEN 同源规则）。
const HOST_PATH_REDACTION = /(^|[\s"'=(:/])\/(Users|Volumes|home|root|private|var|usr|etc|opt|tmp)\/\S*/g;
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
    '  runner.mjs qualify  --registry <file> [--dir <runner dir>] [--json]',
    '  runner.mjs up       --registry <file> [--dir <runner dir>] [--json]   (retired: always refused)',
    '  runner.mjs build-plan [--dir <runner dir>] [--json]                  (retired: always refused)',
    '  runner.mjs probe    --case <role-denial|duplicate-authority> [--dir <runner dir>] [--json]',
    '  runner.mjs stop     [--dir <runner dir>] [--json]',
  ].join('\n');
}

function parseArgs(argv) {
  const opts = { _: [] };
  const command = argv[0];
  const commands = ['validate', 'qualify', 'build-plan', 'up', 'probe', 'stop'];
  if (command && !commands.includes(command)) return { command, opts, error: 'unknown command' };
  const allowed = ['registry', 'refs', 'policy', 'dir', 'json', ...(command === 'probe' ? ['case'] : []), ...(command === 'build-plan' ? ['export-context'] : [])];
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--') || !allowed.includes(arg.slice(2))) return { command, opts, error: 'unknown option or positional argument' };
    if (Object.hasOwn(opts, arg.slice(2))) return { command, opts, error: 'duplicate option' };
    if (arg === '--json' || arg === '--export-context') {
      opts[arg.slice(2)] = true;
    } else if (arg.startsWith('--')) {
      const value = argv[++i];
      if (!value || value.startsWith('--')) return { command, opts, error: 'missing option value' };
      opts[arg.slice(2)] = value;
    } else {
      opts._.push(arg);
    }
  }
  return { command, opts };
}

function print(payload) {
  process.stdout.write(JSON.stringify({ ...payload, checkedAt: new Date().toISOString() }, (_key, value) => typeof value === 'string' ? redactHostPaths(redactSecretValue(value)) : value, 2) + '\n');
}

function failInput(message, code = 'INPUT_INVALID', extra = {}) {
  print({ interface: 'RunnerInfra.v1', status: 'INPUT_INVALID', ready: false, executed: false, code, error: message, ...extra });
  return EXIT_INPUT;
}

const sha256Text = (text) => crypto.createHash('sha256').update(text).digest('hex');
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonBlank = (value) => typeof value === 'string' && value.trim().length > 0;
const INPUT_FILE_ERRORS = new Set(['ENOENT', 'EISDIR', 'ENOTDIR', 'EACCES', 'EPERM', 'ELOOP', 'ENAMETOOLONG']);

function readInput(file, label, json = false) {
  let value;
  try { value = fs.readFileSync(file, 'utf8'); }
  catch (error) {
    const expected = INPUT_FILE_ERRORS.has(error?.code);
    return { ok: false, exitCode: expected ? EXIT_INPUT : EXIT_VERIFY, status: expected ? 'INPUT_INVALID' : 'INTERNAL_FAILURE',
      code: expected ? `INPUT_READ_${error.code}` : 'INPUT_READ_INTERNAL_FAILURE', error: `${label} unreadable` };
  }
  if (Buffer.byteLength(value) > 1024 * 1024) return { ok: false, exitCode: EXIT_INPUT, status: 'INPUT_INVALID', code: 'INPUT_TOO_LARGE', error: `${label} exceeds the input bound` };
  if (!json) return { ok: true, value };
  try { return { ok: true, value: JSON.parse(value), text: value }; }
  catch (error) {
    const expected = error instanceof SyntaxError;
    return { ok: false, exitCode: expected ? EXIT_INPUT : EXIT_VERIFY, status: expected ? 'INPUT_INVALID' : 'INTERNAL_FAILURE',
      code: expected ? 'INPUT_JSON_INVALID' : 'INPUT_PARSE_INTERNAL_FAILURE', error: `${label} JSON cannot be read` };
  }
}

// ---------------------------------------------------------------------------
// 默认入口普查（退休边界的机械 oracle）：默认安装/启动/检查入口不得引用六角色
// compose 栈、Runner 镜像占位或 runner up/build-plan。纯函数可独立注入合成入口。
// ---------------------------------------------------------------------------
const RESIDENT_STACK_REFERENCE_RE = /infra\/delivery\/runner\/compose|COMET_RUNNER_IMAGE|runner\.mjs\s+(?:up|build-plan)|comet-(?:controller|author|test-author|reviewer|publisher|isolator)(?![-\w])|ws-(?:controller|author|test-author|reviewer|publisher|isolator)(?![-\w])/g;

export function residentRoleReferenceFindings(entries) {
  const findings = [];
  if (!Array.isArray(entries)) return findings;
  for (const entry of entries) {
    if (!isObject(entry) || typeof entry.path !== 'string') continue;
    const text = typeof entry.text === 'string' ? entry.text : '';
    for (const match of text.matchAll(RESIDENT_STACK_REFERENCE_RE)) {
      findings.push({ code: 'DEFAULT_ENTRY_RESIDENT_ROLE_REFERENCE', at: entry.path, matched: match[0] });
    }
  }
  return findings;
}

function defaultEntryPaths() {
  const entries = ['package.json', 'tools/bootstrap.sh', 'bin/cli.js', 'hooks.yaml'];
  for (const [directory, matcher] of [['scripts', /\.sh$/], ['.github/workflows', /\.ya?ml$/]]) {
    const root = path.join(repoRoot, directory);
    let names = [];
    try { names = fs.readdirSync(root); } catch { /* absent deployment surface is not a violation */ }
    for (const name of names.filter((item) => matcher.test(item)).sort()) entries.push(`${directory}/${name}`);
  }
  return entries;
}

function defaultEntryCensus() {
  const entries = [], findings = [];
  for (const relative of defaultEntryPaths()) {
    const read = readInput(path.join(repoRoot, relative), 'default entry');
    if (!read.ok) {
      if (read.code === 'INPUT_READ_ENOENT') continue;
      findings.push({ code: 'DEFAULT_ENTRY_CENSUS_UNREADABLE', at: relative, reason: read.code });
      continue;
    }
    entries.push({ path: relative, text: read.value });
  }
  findings.push(...residentRoleReferenceFindings(entries));
  return { entries: entries.map((entry) => entry.path), findings };
}

function inputShapes({ registry, refsDoc, policy, files }) {
  const violations = [];
  const add = (at, expected) => violations.push({ code: 'INPUT_SHAPE_INVALID', at, expected });
  const object = (value, at, optional = false) => {
    if (optional && value === undefined) return false;
    if (!isObject(value)) { add(at, 'object'); return false; }
    return true;
  };
  const list = (value, at, kind = 'object', optional = true) => {
    if (optional && value === undefined) return [];
    if (!Array.isArray(value)) { add(at, `${kind} array`); return []; }
    for (const [index, item] of value.entries()) if (kind === 'object' ? !isObject(item) : !nonBlank(item)) add(`${at}[${index}]`, kind);
    return value.filter((item) => kind === 'object' ? isObject(item) : nonBlank(item));
  };
  const scalar = (value, at, kind, optional = true, nullable = false) => {
    if (optional && value === undefined || nullable && value === null) return;
    if (kind === 'string' ? !nonBlank(value) : kind === 'boolean' ? typeof value !== 'boolean' : !Number.isSafeInteger(value)) add(at, kind);
  };
  if (!object(registry, 'registry') || !object(registry.project, 'registry.project')) return violations;
  if (registry.schemaVersion !== 1 || registry.interface !== 'Registry.v1') add('registry', 'Registry.v1 version 1');
  if (!nonBlank(registry.project.id) || !LABEL_RE.test(registry.project.id)) add('registry.project.id', 'project label');
  scalar(registry.project.owner, 'registry.project.owner', 'string', false);
  list(registry.project.delegates, 'registry.project.delegates', 'string');
  for (const entry of list(registry.resources, 'registry.resources', 'object', false)) {
    scalar(entry.id, 'registry.resources.id', 'string', false);
    scalar(entry.owner, 'registry.resources.owner', 'string', false);
  }
  if (object(registry.project.github, 'registry.project.github')) {
    for (const key of ['repoId', 'principalId']) scalar(registry.project.github[key], `registry.project.github.${key}`, 'integer', false);
    for (const key of ['repoFullname', 'owner', 'url']) scalar(registry.project.github[key], `registry.project.github.${key}`, 'string', false);
  }
  violations.push(...validateQualificationPolicy(policy).map(({ code, at, expected }) => ({ code, at, expected })));
  violations.push(...validateRefsCatalog(refsDoc, registry.project.id, { policy }).map(({ code }) => ({ code, at: 'refs catalog' })));
  const docs = new Map(JSON_FILES.map((name) => [name, JSON.parse(files.get(name))]));
  for (const [name, value] of docs) {
    if (!object(value, name)) continue;
    if (value.schemaVersion !== 1) add(`${name}.schemaVersion`, 'version 1');
    if (value.project !== registry.project.id) add(`${name}.project`, 'the registered project');
  }
  const lock = docs.get('image.lock.json');
  if (isObject(lock)) {
    for (const entry of list(lock.components, 'image.lock.components')) {
      for (const key of ['component', 'role']) scalar(entry[key], `image.lock.components.${key}`, 'string', false);
      for (const key of ['reference', 'digest']) scalar(entry[key], `image.lock.components.${key}`, 'string', false, true);
      for (const key of ['required', 'digestAuthenticated']) scalar(entry[key], `image.lock.components.${key}`, 'boolean', false);
    }
    if (object(lock.upGate, 'image.lock.upGate', true)) scalar(lock.upGate.enabled, 'image.lock.upGate.enabled', 'boolean');
    if (object(lock.sourceInputs, 'image.lock.sourceInputs', true)) {
      const source = lock.sourceInputs;
      for (const entry of list(source.patches, 'image.lock.sourceInputs.patches')) for (const key of ['path', 'sha256']) scalar(entry[key], `image.lock.sourceInputs.patches.${key}`, 'string', false);
      for (const key of ['sourceCommit', 'archiveSha256', 'hostBuildFingerprint']) scalar(source[key], `image.lock.sourceInputs.${key}`, 'string');
      scalar(source.archiveBytes, 'image.lock.sourceInputs.archiveBytes', 'integer');
      object(source.toolchain, 'image.lock.sourceInputs.toolchain', true);
      if (object(lock.retirement, 'image.lock.retirement', true)) {
        for (const key of ['status', 'decision', 'revision', 'successorBoundary', 'dataDisposition']) scalar(lock.retirement[key], `image.lock.retirement.${key}`, 'string', false);
        list(lock.retirement.retiredSurface, 'image.lock.retirement.retiredSurface', 'string', false);
      }
    }
  }
  const roles = docs.get('role-policy.json');
  if (isObject(roles)) {
    for (const role of list(roles.roles, 'role-policy.roles')) {
      scalar(role.role, 'role-policy.roles.role', 'string', false);
      if (role.role !== undefined && !RUNNER_ROLES.includes(role.role)) add('role-policy.roles.role', 'one of the six fixed roles');
      scalar(role.workspaceVolume, 'role-policy.roles.workspaceVolume', 'string');
      for (const key of ['principal', 'capabilities']) if (role[key] !== null) object(role[key], `role-policy.roles.${key}`, true);
      list(role.grantedRefs, 'role-policy.roles.grantedRefs', 'string');
      if (isObject(role.principal)) {
        scalar(role.principal.label, 'role-policy.roles.principal.label', 'string');
        scalar(role.principal.credentialRef, 'role-policy.roles.principal.credentialRef', 'string', true, true);
      }
      if (isObject(role.capabilities)) for (const key of ['add', 'drop']) list(role.capabilities[key], `role-policy.roles.capabilities.${key}`, 'string');
    }
    for (const entry of list(roles.runnerRefs, 'role-policy.runnerRefs')) for (const key of ['ref', 'bindingRole']) scalar(entry[key], `role-policy.runnerRefs.${key}`, 'string', false);
    if (object(roles.methodStateScope, 'role-policy.methodStateScope', true)) {
      const scope = roles.methodStateScope;
      for (const key of ['identityBasis', 'permissionBasis', 'completionBasis']) scalar(scope[key], `role-policy.methodStateScope.${key}`, 'boolean');
      if (object(scope.dispatchRecord, 'role-policy.dispatchRecord', true)) {
        object(scope.dispatchRecord.fields, 'role-policy.dispatchRecord.fields', true);
        if (object(scope.dispatchRecord.runtimeBinding, 'role-policy.dispatchRecord.runtimeBinding', true)) list(scope.dispatchRecord.runtimeBinding.fields, 'role-policy.runtimeBinding.fields', 'string');
      }
    }
  }
  const mounts = docs.get('workspace-mounts.json');
  if (isObject(mounts)) {
    for (const control of list(mounts.controlVolumes, 'workspace-mounts.controlVolumes')) {
      for (const key of ['volume', 'mountPath', 'purpose']) scalar(control[key], `workspace-mounts.controlVolumes.${key}`, 'string');
      list(control.mountedBy, 'workspace-mounts.controlVolumes.mountedBy', 'string');
    }
    for (const entry of list(mounts.roleWorkspaces, 'workspace-mounts.roleWorkspaces')) for (const key of ['role', 'volume', 'mountPath', 'hostPath']) scalar(entry[key], `workspace-mounts.roleWorkspaces.${key}`, 'string');
    if (object(mounts.rules, 'workspace-mounts.rules', true)) list(mounts.rules.workerRoles, 'workspace-mounts.rules.workerRoles', 'string');
    object(mounts.methodState, 'workspace-mounts.methodState', true);
  }
  const authority = docs.get('authority-registration.example.json');
  if (isObject(authority)) {
    object(authority.authority, 'authority.authority', true); object(authority.uniqueness, 'authority.uniqueness', true);
    for (const entry of list(authority.registrations, 'authority.registrations')) for (const key of ['registrationId', 'authorityId', 'workspaceId', 'instanceId', 'stateOrigin', 'writerExclusivity']) scalar(entry[key], `authority.registrations.${key}`, 'string');
  }
  return violations;
}

function loadInputs(opts) {
  const registryFile = opts.registry ?? DEFAULT_REGISTRY, refsFile = opts.refs ?? DEFAULT_REFS, policyFile = opts.policy ?? DEFAULT_POLICY;
  const dir = opts.dir ?? DEFAULT_DIR;
  const registry = readInput(registryFile, 'registry', true), refs = readInput(refsFile, 'refs catalog', true), policy = readInput(policyFile, 'qualification policy', true);
  const failed = [registry, refs, policy].find((item) => !item.ok);
  if (failed) return failed;
  const files = new Map();
  for (const name of DOMAIN_FILES) {
    const read = readInput(path.join(dir, name), 'domain input', JSON_FILES.includes(name));
    if (!read.ok) return read;
    files.set(name, JSON_FILES.includes(name) ? read.text : read.value);
  }
  const violations = inputShapes({ registry: registry.value, refsDoc: refs.value, policy: policy.value, files });
  if (violations.length) return { ok: false, exitCode: EXIT_INPUT, status: 'INPUT_INVALID', code: 'INPUT_SHAPE_INVALID', error: 'runner input shape is invalid', violations };
  return { ok: true, registry: registry.value, refsDoc: refs.value, policy: policy.value, registryFile, refsFile, dir, files };
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

// The installed PyYAML safe loader is isolated and bounded; no regex is a security oracle.
const COMPOSE_INPUT_LIMIT = 65_536, COMPOSE_OUTPUT_LIMIT = 65_536, COMPOSE_TIMEOUT_MS = 5_000;
const COMPOSE_YAML_VERSION = '6.0.3';
const COMPOSE_VALIDATOR = String.raw`
import json, sys
VERSION = None
AVAILABLE = False

def emit(violations):
    print(json.dumps({"ok": not violations, "parser": "PyYAML", "version": VERSION,
                      "available": AVAILABLE, "violations": violations}, separators=(",", ":")))
    raise SystemExit(0 if not violations else 2)

def reject(code):
    emit([{"code": code, "at": "compose.yaml"},
          {"code": "HOST_MOUNT_FORBIDDEN", "at": "compose.yaml"}])

try:
    import yaml
except Exception:
    reject("COMPOSE_PARSER_UNAVAILABLE")
if getattr(yaml, "__version__", None) != "6.0.3":
    reject("COMPOSE_PARSER_VERSION_MISMATCH")
VERSION = yaml.__version__
AVAILABLE = True

class ForbiddenYaml(Exception):
    pass

class StrictLoader(yaml.SafeLoader):
    def construct_mapping(self, node, deep=False):
        result = {}
        for key_node, value_node in node.value:
            if key_node.tag == "tag:yaml.org,2002:merge":
                raise ForbiddenYaml("COMPOSE_YAML_MERGE_UNSUPPORTED")
            key = self.construct_object(key_node, deep=deep)
            if not isinstance(key, str):
                raise ForbiddenYaml("COMPOSE_YAML_KEY_UNSUPPORTED")
            if key in result:
                raise ForbiddenYaml("COMPOSE_YAML_DUPLICATE_KEY")
            result[key] = self.construct_object(value_node, deep=deep)
        return result

try:
    raw = sys.stdin.buffer.read(65537)
    if len(raw) > 65536:
        reject("COMPOSE_INPUT_LIMIT_EXCEEDED")
    source = raw.decode("utf-8", errors="strict")
    for token in yaml.scan(source, Loader=StrictLoader):
        if isinstance(token, yaml.tokens.TagToken):
            reject("COMPOSE_YAML_TAG_UNSUPPORTED")
    depth = 0
    nodes = 0
    for event in yaml.parse(source, Loader=StrictLoader):
        if isinstance(event, yaml.events.AliasEvent) or getattr(event, "anchor", None) is not None:
            reject("COMPOSE_YAML_ALIAS_UNSUPPORTED")
        if isinstance(event, (yaml.events.MappingStartEvent, yaml.events.SequenceStartEvent)):
            depth += 1
            if depth > 24:
                reject("COMPOSE_YAML_DEPTH_LIMIT_EXCEEDED")
        if isinstance(event, (yaml.events.MappingEndEvent, yaml.events.SequenceEndEvent)):
            depth -= 1
        nodes += 1
        if nodes > 4096:
            reject("COMPOSE_YAML_NODE_LIMIT_EXCEEDED")
    document = yaml.load(source, Loader=StrictLoader)
except ForbiddenYaml as error:
    reject(str(error))
except Exception:
    reject("COMPOSE_YAML_INVALID")

violations = []
def add(code, at="compose.yaml"):
    item={"code":code,"at":at}
    if item not in violations: violations.append(item)

def mapping(value, allowed, at):
    if not isinstance(value,dict):
        add("COMPOSE_SCHEMA_INVALID",at)
        return False
    if set(value)-set(allowed): add("COMPOSE_FIELD_FORBIDDEN",at)
    return True

roles=["controller","author","test-author","reviewer","publisher","isolator"]
controls=["comet-control-state:/comet/state","comet-receipts:/comet/receipts","comet-issuance:/comet/issuance"]
volume_names=["comet-control-state","comet-receipts","comet-issuance"]+["ws-"+role for role in roles]
if not mapping(document,["services","volumes","networks"],"compose.yaml"):
    emit(violations)
services=document.get("services")
if not isinstance(services,dict):
    add("SERVICES_MISSING")
else:
    if set(services)-{"comet-"+role for role in roles}: add("SERVICE_ROLE_UNKNOWN")
    if {"comet-"+role for role in roles}-set(services): add("ROLE_SERVICE_MISSING")
    for role in roles:
        service=services.get("comet-"+role)
        at="compose.yaml:comet-"+role
        fields=["image","restart","read_only","cap_drop","security_opt","networks","volumes","ports"]
        if not mapping(service,fields,at): continue
        if service.get("privileged") is True: add("PRIVILEGED_FORBIDDEN",at)
        if service.get("network_mode")=="host": add("HOST_NETWORK_FORBIDDEN",at)
        if any(key in service for key in ["pid","ipc","uts","userns_mode","cgroup_parent","devices","device_cgroup_rules"]): add("HOST_NAMESPACE_FORBIDDEN",at)
        if "env_file" in service or "environment" in service: add("HOST_ENV_FILE_FORBIDDEN",at)
        image=chr(36)+"{COMET_RUNNER_IMAGE:?must be resolved from infra/delivery/runner/image.lock.json before up}"
        if service.get("image")!=image: add("COMPOSE_IMAGE_NOT_LOCK_RESOLVED",at)
        if service.get("read_only") is not True: add("READ_ONLY_ROOTFS_REQUIRED",at)
        if service.get("cap_drop")!=["ALL"] or "cap_add" in service: add("CAP_DROP_ALL_REQUIRED",at)
        if service.get("security_opt")!=["no-new-privileges:true"]: add("NO_NEW_PRIVILEGES_REQUIRED",at)
        if service.get("restart")!="no": add("RESTART_POLICY_FORBIDDEN",at)
        if service.get("networks")!=["runner-internal"]: add("NETWORK_NOT_INTERNAL",at)
        expected=([*controls] if role=="controller" else [])+["ws-"+role+":/workspace"]
        mounts=service.get("volumes")
        if isinstance(mounts,list) and any(isinstance(item,str) and "docker.sock" in item for item in mounts): add("DOCKER_SOCK_MOUNT_FORBIDDEN",at)
        if not isinstance(mounts,list) or any(not isinstance(item,str) for item in mounts) or len(mounts)!=len(expected) or sorted(mounts)!=sorted(expected):
            add("HOST_MOUNT_FORBIDDEN",at)
        if isinstance(mounts,list) and role!="controller" and any(isinstance(item,str) and (item.split(":")[0] in volume_names[:3] or ":/comet/" in item) for item in mounts): add("WORKER_CONTROL_PATH_FORBIDDEN",at)
        ports=service.get("ports",[])
        if ports: add("PORT_BINDING_NOT_LOOPBACK",at)
volumes=document.get("volumes")
if not isinstance(volumes,dict) or set(volumes)!=set(volume_names): add("HOST_MOUNT_FORBIDDEN")
elif any(value is not None and not (isinstance(value,dict) and not value) for value in volumes.values()): add("HOST_MOUNT_FORBIDDEN")
networks=document.get("networks")
if not isinstance(networks,dict) or set(networks)!={"runner-internal"}: add("NETWORK_MISSING")
else:
    network=networks["runner-internal"]
    if not isinstance(network,dict) or set(network)!={"internal"} or network.get("internal") is not True: add("NETWORK_NOT_INTERNAL")
emit(violations)
`;
const COMPOSE_CODES = new Set(['COMPOSE_PARSER_UNAVAILABLE','COMPOSE_PARSER_VERSION_MISMATCH','COMPOSE_INPUT_LIMIT_EXCEEDED',
  'COMPOSE_YAML_TAG_UNSUPPORTED','COMPOSE_YAML_MERGE_UNSUPPORTED','COMPOSE_YAML_KEY_UNSUPPORTED','COMPOSE_YAML_DUPLICATE_KEY',
  'COMPOSE_YAML_ALIAS_UNSUPPORTED','COMPOSE_YAML_DEPTH_LIMIT_EXCEEDED','COMPOSE_YAML_NODE_LIMIT_EXCEEDED','COMPOSE_YAML_INVALID',
  'COMPOSE_SCHEMA_INVALID','COMPOSE_FIELD_FORBIDDEN','HOST_MOUNT_FORBIDDEN','DOCKER_SOCK_MOUNT_FORBIDDEN','SERVICES_MISSING','ROLE_SERVICE_MISSING','SERVICE_ROLE_UNKNOWN',
  'PRIVILEGED_FORBIDDEN','HOST_NETWORK_FORBIDDEN','HOST_NAMESPACE_FORBIDDEN','HOST_ENV_FILE_FORBIDDEN',
  'COMPOSE_IMAGE_NOT_LOCK_RESOLVED','READ_ONLY_ROOTFS_REQUIRED','CAP_DROP_ALL_REQUIRED','NO_NEW_PRIVILEGES_REQUIRED',
  'RESTART_POLICY_FORBIDDEN','NETWORK_NOT_INTERNAL','WORKER_CONTROL_PATH_FORBIDDEN','PORT_BINDING_NOT_LOOPBACK','NETWORK_MISSING']);
const COMPOSE_LOCATIONS = new Set(['compose.yaml', ...RUNNER_ROLES.map((role) => 'compose.yaml:comet-' + role)]);
function validateCompose(source) {
  const parser = { command:'python3', flags:['-I'], implementation:'PyYAML', requiredVersion:COMPOSE_YAML_VERSION, version:null, status:'UNVERIFIED', proofLayer:'component-parser' };
  const no = (code) => ({ violations:[{code,at:'compose.yaml'},{code:'HOST_MOUNT_FORBIDDEN',at:'compose.yaml'}],parser });
  if (Buffer.byteLength(source)>COMPOSE_INPUT_LIMIT) return no('COMPOSE_INPUT_LIMIT_EXCEEDED');
  const result=spawnSync('python3',['-I','-c',COMPOSE_VALIDATOR],{input:source,encoding:'utf8',timeout:COMPOSE_TIMEOUT_MS,maxBuffer:COMPOSE_OUTPUT_LIMIT,killSignal:'SIGKILL'});
  if (result.error?.code==='ENOENT') return no('COMPOSE_PARSER_UNAVAILABLE');
  if (result.error?.code==='ETIMEDOUT') return no('COMPOSE_PARSER_TIMEOUT');
  if (result.error?.code==='ENOBUFS') return no('COMPOSE_PARSER_OUTPUT_LIMIT');
  if (result.error||result.signal||result.stderr||![0,2].includes(result.status)) return no('COMPOSE_PARSER_FAILED');
  let output;try{output=JSON.parse(result.stdout);}catch{return no('COMPOSE_PARSER_INVALID_OUTPUT');}
  if (!isObject(output)||Object.keys(output).sort().join(',')!=='available,ok,parser,version,violations'
    ||output.parser!=='PyYAML'||typeof output.available!=='boolean'||typeof output.ok!=='boolean'
    ||!Array.isArray(output.violations)||output.violations.length>128||output.violations.some((item)=>!isObject(item)||Object.keys(item).sort().join(',')!=='at,code'||!COMPOSE_CODES.has(item.code)||!COMPOSE_LOCATIONS.has(item.at))
    ||output.ok!==(output.violations.length===0)||result.status!==(output.ok?0:2)
    ||(output.available?output.version!==COMPOSE_YAML_VERSION:output.version!==null)
    ||output.available===output.violations.some((item)=>['COMPOSE_PARSER_UNAVAILABLE','COMPOSE_PARSER_VERSION_MISMATCH'].includes(item.code))) return no('COMPOSE_PARSER_INVALID_OUTPUT');
  if(output.available){parser.status='AVAILABLE';parser.version=output.version;}
  return {violations:output.violations,parser};
}

function validateDockerfile(text) {
  const violations = [];
  const add = (code, at, extra) => violations.push({ code, at, ...(extra ?? {}) });
  for (const [index, raw] of text.split('\n').entries()) {
    const lineNo = index + 1;
    const trimmed = raw.trim();
    if (HOST_USER_PATH.test(trimmed)) {
      add('DOCKERFILE_HOST_PATH', `Dockerfile:${lineNo}`, { reason: 'host user paths never belong in the runner image build' });
    }
    if (SECRET_PLAINTEXT.some((pattern) => pattern.test(trimmed))) {
      add('SECRET_PLAINTEXT_FORBIDDEN', `Dockerfile:${lineNo}`, { reason: 'value matches a known secret token shape' });
    }
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (/^FROM\s+\S+/.test(trimmed) && !['FROM ${RUNNER_BASE_IMAGE}', 'FROM ${PYTHON_BASE_IMAGE} AS python-runtime'].includes(trimmed)) {
      add('DOCKERFILE_FLOATING_BASE', `Dockerfile:${lineNo}`, { reason: 'both fixed stage images resolve only from the runtime lock mappings' });
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
const RUNNER_RECIPE_TEMPLATE = Object.freeze({
  bytes: 24569,
  sha256: 'ac633df2a4707914b018263e13f45333314e6e6280474798860bf2e6eac954ee',
});
function validateRuntimeRecipe(text) {
  const bytes = Buffer.from(text, 'utf8'), template = bytes.subarray(0, RUNNER_RECIPE_TEMPLATE.bytes);
  // Hash every original byte, including heredoc bodies/comments. Only post-template Docker metadata may vary.
  const suffix = bytes.subarray(RUNNER_RECIPE_TEMPLATE.bytes).toString('utf8');
  const metadataOnly = suffix === '' || suffix.endsWith('\n') && suffix.split('\n').every(line =>
    /^[ \t]*(?:#[^\r\n\0]*)?$/.test(line) && !/^[ \t]*#[ \t]*(?:syntax|escape|check)[ \t]*=/i.test(line));
  return template.length !== RUNNER_RECIPE_TEMPLATE.bytes || sha256Text(template) !== RUNNER_RECIPE_TEMPLATE.sha256 || !metadataOnly
    ? [{ code: 'RUNTIME_RECIPE_UNSAFE', at: 'Dockerfile', reason: 'the complete protected offline recipe template is required; only trailing nonexecuting metadata is permitted' }] : [];
}

// ---------------------------------------------------------------------------
// 退休记录（image.lock.json）完整性：退休声明、关闭的 up 门、镜像识别摘要、
// openspec 活性 pin、以及从记录自身现算的指纹（不再对照活的 upstream.lock —— 补丁
// 链已从锁退位，0.4.5 源事实是历史识别信息，不是当前候选）。
// ---------------------------------------------------------------------------
const RETIREMENT_STATUS = 'RETIRED_RESIDENT_ROLE_DEPLOYMENT';

// 指纹算法与 tools/comet/build.mjs 的 fingerprintOf 完全一致：sha256(JSON({archive, patches, toolchain}))。
// 退休后从退休记录自身字段现算——记录内部自洽即可，无需活锁。
function recordFingerprint(sourceInputs) {
  return crypto.createHash('sha256').update(JSON.stringify({
    archive: sourceInputs.archiveSha256,
    patches: (sourceInputs.patches ?? []).map(({ path: patchPath, sha256 }) => ({ path: patchPath, sha256 })),
    toolchain: sourceInputs.toolchain,
  })).digest('hex');
}

function validateImageLock(lock) {
  const violations = [];
  const add = (code, at, extra) => violations.push({ code, at, ...(extra ?? {}) });
  if (lock.interface !== 'RunnerImageLock.v1') add('LOCK_INTERFACE_INVALID', 'image.lock.json', { expected: 'RunnerImageLock.v1' });
  const retirement = lock.retirement;
  if (!isObject(retirement)) {
    add('RETIREMENT_DECLARATION_MISSING', 'image.lock.json:retirement', { reason: 'the resident role deployment retirement must be declared in the lock itself (ADR-0021)' });
  } else {
    if (retirement.status !== RETIREMENT_STATUS) add('RETIREMENT_STATUS_INVALID', 'image.lock.json:retirement.status', { expected: RETIREMENT_STATUS, observed: retirement.status ?? null });
    if (retirement.decision !== RETIREMENT_DECISION) add('RETIREMENT_DECISION_MISMATCH', 'image.lock.json:retirement.decision', { expected: RETIREMENT_DECISION, observed: retirement.decision ?? null });
    if (retirement.revision !== RETIREMENT_REVISION) add('RETIREMENT_REVISION_MISMATCH', 'image.lock.json:retirement.revision', { expected: RETIREMENT_REVISION, observed: retirement.revision ?? null });
    if (!nonBlank(retirement.successorBoundary) || !/createCliJobDriver|on-demand/i.test(retirement.successorBoundary)) add('RETIREMENT_DECLARATION_INVALID', 'image.lock.json:retirement.successorBoundary', { reason: 'the successor boundary must name the on-demand ephemeral job path' });
    if (!nonBlank(retirement.dataDisposition) || !/RETAINED/i.test(retirement.dataDisposition)) add('DATA_DISPOSITION_MISSING', 'image.lock.json:retirement.dataDisposition', { reason: 'retirement must declare old Run/evidence/image/volume data RETAINED; no deletion is authorized by this record' });
    if (!Array.isArray(retirement.retiredSurface) || retirement.retiredSurface.length < 3) add('RETIREMENT_DECLARATION_INVALID', 'image.lock.json:retirement.retiredSurface', { reason: 'the retired surface list must enumerate the retired default install/start/check chain' });
  }
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
  // 退休后 up 门永远关闭：任何 enabled=true 都违规（不再存在可开门的准入记录）。
  if ((lock.upGate ?? {}).enabled !== false) {
    add('UP_GATE_NOT_CLOSED', 'image.lock.json:upGate', { reason: 'the resident role up gate is retired and must stay enabled=false permanently (ADR-0021)' });
  }
  const source = lock.sourceInputs ?? {};
  if (!/^[0-9a-f]{40}$/.test(source.sourceCommit ?? '')) add('SOURCE_COMMIT_NOT_PINNED', 'image.lock.json:sourceInputs', { reason: 'a 40-hex retired-era Comet source commit is required for image identification' });
  if (!Array.isArray(source.patches) || source.patches.length === 0
    || source.patches.some((item) => !isObject(item) || typeof item.path !== 'string'
      || /^integrations\/comet\/patches\/[A-Za-z0-9_./-]+\.patch$/.test(item.path) === false
      || typeof item.sha256 !== 'string' || /^[a-f0-9]{64}$/.test(item.sha256) === false)) {
    add('RETIRED_PATCH_RECORD_INVALID', 'image.lock.json:sourceInputs.patches', { reason: 'the retired seven-patch identification list (path + sha256 per entry) must stay well-formed' });
  }
  const openspec = source.openspec;
  if (!openspec || openspec.package !== '@fission-ai/openspec' || openspec.version !== '1.11.0'
    || openspec.tarballSha256 !== '84820b173b57204bd7582a47ddae65e85fd492724172acc8e434e97ea1c05c3f'
    || openspec.registryTarball !== 'https://registry.npmmirror.com/@fission-ai/openspec/-/openspec-1.11.0.tgz' || openspec.tarballBytes !== 471694) {
    add('OPENSPEC_PIN_INVALID', 'image.lock.json:sourceInputs.openspec', { reason: 'the still-live openspec pin (registry-referenced by openspec-isolated-tools) must stay exactly as P1_1 recorded it' });
  }
  if (source.hostBuildFingerprint !== undefined && source.hostBuildFingerprint !== recordFingerprint(source)) {
    add('FINGERPRINT_STALE', 'image.lock.json:sourceInputs.hostBuildFingerprint', {
      reason: 'the recorded retired-era fingerprint must equal the freshly recomputed record-derived fingerprint (archive+patches+toolchain from this record)',
      expected: recordFingerprint(source),
    });
  }
  if (source.containerBuildStatus !== 'UNVERIFIED' && source.containerBuildStatus !== 'VERIFIED' && source.containerBuildStatus !== 'RETIRED') {
    add('CONTAINER_BUILD_STATUS_INVALID', 'image.lock.json:sourceInputs', { reason: 'containerized build status must be UNVERIFIED, VERIFIED or RETIRED' });
  }
  return violations;
}

// Dockerfile 是冻结的历史配方（镜像识别）：字节数与 sha 必须保持不变；
// 其补丁链 COPY/ARG/门数量必须与退休记录的七补丁识别清单一致。
// Executable template changes require source/test review; caller-supplied locks cannot select this pin.
function validateRetiredDockerfileChain(text, retiredPatches) {
  const violations = [];
  const add = (code, at, extra) => violations.push({ code, at, ...(extra ?? {}) });
  const joined = text.replace(/\\\n/g, ' ');
  const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patches = Array.isArray(retiredPatches) ? retiredPatches : [];
  for (const [index, patch] of patches.entries()) {
    const n = index + 1;
    const escaped = escapeRegExp(patch.path);
    if (!new RegExp(`^ARG PATCH_${n}_SHA256$`, 'm').test(text)) {
      add('PATCH_CHAIN_INCOMPLETE', `Dockerfile:PATCH_${n}_SHA256`, { patch: patch.path, reason: `ARG PATCH_${n}_SHA256 missing` });
    }
    if (!new RegExp(`^COPY ${escaped} /build/repo/${escaped}$`, 'm').test(text)) {
      add('PATCH_CHAIN_INCOMPLETE', `Dockerfile:PATCH_${n}_COPY`, { patch: patch.path, reason: 'the historical recipe must mirror the retired patch at its lock-relative path' });
    }
    if (!joined.includes(`echo "\${PATCH_${n}_SHA256}  /build/repo/${patch.path}" | sha256sum -c -`)) {
      add('PATCH_CHAIN_INCOMPLETE', `Dockerfile:PATCH_${n}_GATE`, { patch: patch.path, reason: 'the historical sha256sum gate for the mirrored patch is missing' });
    }
  }
  const declaredArgCount = (text.match(/^ARG PATCH_\d+_SHA256$/gm) ?? []).length;
  if (declaredArgCount !== patches.length) {
    add('PATCH_CHAIN_INCOMPLETE', 'Dockerfile', { reason: `the historical recipe declares ${declaredArgCount} PATCH_n args but the retirement record identifies ${patches.length} patches` });
  }
  if (/find\s+\/build/.test(text)) {
    add('ENTRYPOINT_NONDETERMINISTIC', 'Dockerfile', { reason: 'entrypoint resolution must be the fingerprint-deterministic managed path; find-based drift entry is forbidden' });
  }
  violations.push(...validateRuntimeRecipe(text));
  return violations;
}

function validateDomain({ registry, refsDoc, files }) {
  const violations = [];
  const projectId = registry?.project?.id;
  const jsonDocs = new Map(JSON_FILES.map((name) => [name, JSON.parse(files.get(name))]));
  const rolePolicy = jsonDocs.get('role-policy.json');
  const mounts = jsonDocs.get('workspace-mounts.json');
  if (registry.project.id !== 'sdd-harness-pilot' || registry.project.github.repoId !== 1285806550
    || registry.project.github.repoFullname !== 'ql-wade/sdd-harness' || registry.project.github.principalId !== 262266039) {
    violations.push({ code: 'REGISTRY_SOURCE_BINDING_MISMATCH', at: 'registry.project', reason: 'the fixed Runner belongs to the registered pilot repository and operator; identity is not a business grant' });
  }

  // I01 目录缺口：runner 四 ref 中未登记的显式上报（缺口是 readiness 证据，不是结构违规——沿 I03 先例）。
  const catalogRefs = new Set((refsDoc?.refs ?? []).map((entry) => entry.ref));
  const catalogGaps = RUNNER_REFS.filter((ref) => !catalogRefs.has(ref)).sort();
  const catalogBoundRoles = (refsDoc?.refs ?? []).filter((entry) => !RUNNER_REFS.includes(entry.ref));

  const imageLock = jsonDocs.get('image.lock.json');
  violations.push(...validateImageLock(imageLock));
  violations.push(...validateRolePolicy({ policy: rolePolicy, refsDoc, projectId, catalogBoundRoles }).violations);
  violations.push(...validateWorkspaceMounts({ mounts, policy: rolePolicy }));
  violations.push(...validateAuthority({ authority: jsonDocs.get('authority-registration.example.json'), projectId }));

  // 历史配方完整性：与退休记录（而非活锁）对照。
  violations.push(...validateRetiredDockerfileChain(files.get('Dockerfile'), imageLock.sourceInputs?.patches));

  const composition = validateCompose(files.get('compose.yaml'));
  violations.push(...composition.violations);
  violations.push(...validateDockerfile(files.get('Dockerfile')));

  // 默认入口普查：默认链零常驻角色服务。
  const census = defaultEntryCensus();
  violations.push(...census.findings);

  return { violations, catalogGaps, composeParser: composition.parser, census };
}

function buildQualification({ registryFile, dir, files, violations, catalogGaps, census }) {
  const censusClean = !census.findings.some((finding) => finding.code === 'DEFAULT_ENTRY_RESIDENT_ROLE_REFERENCE');
  const categories = {
    'default-chain-zero-resident-role-services': censusClean
      ? { status: 'VERIFIED', reason: `mechanical census of ${census.entries.length} default install/start/check entries found zero resident role references; this CLI itself has no start path`, entries: census.entries }
      : UNVERIFIED(`default-entry census found resident role references: ${[...new Set(census.findings.map((finding) => `${finding.at} (${finding.matched})`))].join(', ')}`),
    'retired-without-data-loss': violations.every((violation) => violation.code !== 'DATA_DISPOSITION_MISSING')
      ? RECORDED('the retirement record declares old Run/evidence/image/volume data RETAINED and authorizes no deletion; whether old resources still exist on a given host is separate UNVERIFIED inventory')
      : UNVERIFIED('the lock lacks an honest data retention disposition for the retirement'),
    'old-resource-inventory': UNVERIFIED('read-only docker inventory of retired containers/volumes/images never executed on this host; ownership and existence of old resources stay unobserved'),
    'role-boundary-declaration': violations.length === 0
      ? RECORDED('retired declarations remain self-consistent: distinct principals/credentials/volumes, read-only rootfs, dropped capabilities, worker-unwritable control paths')
      : UNVERIFIED(`declaration structure violates its own invariants: ${[...new Set(violations.map((violation) => violation.code))].join(', ')}`),
    'authority-exclusivity': UNVERIFIED('duplicate-authority never executed against a real Comet state: one-writer/refuse-copied-state evidence requires the original Run under native lock/transaction'),
    'on-demand-ephemeral-job': UNVERIFIED('createCliJobDriver protocol is component-tested only; a real authorized dispatch through the fixed host never executed on this host'),
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
    residentRoleServices: 'RETIRED',
    retirement: { decision: RETIREMENT_DECISION, revision: RETIREMENT_REVISION },
    unverifiedCount: values.filter((category) => category.status === 'UNVERIFIED').length,
    catalogGaps,
    categories,
    inputs,
  };
}

const PROBE_CASES = {
  'role-denial': {
    requiredInputs: [
      'real independent host sessions (native read/tool/path scopes on the current agent host or protected CI) — role containers are retired and are no longer a prerequisite (ADR-0021)',
      'a controlled write-channel matrix (Edit/Shell/MCP) executed from an ordinary session, retaining errno/request evidence per channel',
      'the current Comet control surfaces (comet-state.yaml / receipts under the native lock and transaction) identified as the protected targets',
    ],
    plannedSteps: [
      'from an ordinary independent session, attempt writes to Comet control state, policy and receipts via Edit/Shell/MCP channels (expect per-channel denial by native scopes/host permissions; keep errno/request evidence)',
      'attempt reads outside the session-scoped project paths (expect native path-scope denial)',
      'confirm no default entry installs or starts any of the six retired role services (census oracle in validate)',
      'record the effective denial per channel; capability gaps stay UNVERIFIED and are never recorded as enforced',
    ],
  },
  'duplicate-authority': {
    requiredInputs: [
      'the authoritative Comet state (original RunID under the native lock and transaction)',
      'a copied state clone (second directory or second host)',
      'two candidate writers pointing at the same authority/workspace',
    ],
    plannedSteps: [
      'start writer A against the authoritative state; record the single accepted writer identity',
      'start writer B against the copied state with the same authority id (expect startup refusal; COPIED_STATE_FORBIDDEN semantics)',
      'resume the original RunID/operation from the authoritative state (old owner/attempt results rejected by Comet; no fabricated new operation)',
      'read back exactly one valid Comet writer across both start attempts',
    ],
  },
};

// 退休拒绝（up / build-plan 共用）：退休先于资格化与 docker——
// 不再有镜像资格前置，也不再触碰 docker daemon；不导出上下文、argv 或构建参数。
function refuseRetiredCommand(command, files) {
  const retiredProvenance = (() => {
    try {
      const lock = JSON.parse(files.get('image.lock.json'));
      const source = lock.sourceInputs ?? {};
      return {
        sourceCommit: source.sourceCommit ?? null,
        hostBuildFingerprint: source.hostBuildFingerprint ?? null,
        patches: Array.isArray(source.patches) ? source.patches.length : 0,
        record: 'infra/delivery/runner/image.lock.json (retirement record); full runtime closure in git history',
      };
    } catch { return null; }
  })();
  const payload = command === 'up'
    ? {
        code: 'RUNNER_RESIDENT_DEPLOYMENT_RETIRED',
        error: 'UP_REFUSED_RESIDENT_DEPLOYMENT_RETIRED: the six-role resident compose stack is retired from every default install/start/check path (ADR-0021); up can never restart it',
        retirement: { decision: RETIREMENT_DECISION, revision: RETIREMENT_REVISION, successor: 'on-demand ephemeral jobs via createCliJobDriver only' },
        dockerInvoked: false,
      }
    : {
        code: 'RUNNER_IMAGE_BUILD_CHAIN_RETIRED',
        error: 'BUILD_PLAN_RETIRED: the 0.4.5 seven-patch image build chain is retired (ADR-0021 / ADR-0022 0.5.0 composition baseline); no executable build is exported',
        retirement: { decision: RETIREMENT_DECISION, revision: RETIREMENT_REVISION, successor: 'on-demand ephemeral jobs consume an already-built image digest via createCliJobDriver' },
        retiredProvenance,
      };
  print({
    interface: 'RunnerInfra.v1',
    command,
    refused: true,
    ready: false,
    executed: false,
    status: 'UNVERIFIED',
    residentRoleServices: 'RETIRED',
    ...payload,
  });
  return EXIT_VERIFY;
}

async function main(argv) {
  const { command, opts, error } = parseArgs(argv);
  if (error) return failInput(error);
  if (!command) return failInput('missing command');
  if (command === 'probe' && !Object.hasOwn(PROBE_CASES, opts.case)) return failInput('unknown probe case');
  const loaded = loadInputs(opts);
  if (!loaded.ok) {
    print({ interface: 'RunnerInfra.v1', ready: false, executed: false, ...loaded });
    return loaded.exitCode;
  }
  const { registry, refsDoc, registryFile, refsFile, dir, files } = loaded;
  // 退休拒绝先于任何资格化（ADR-0021：镜像/角色资格不再是命令前置）——
  // 声明漂移不改变 up/build-plan 的答案：退休本身就是拒绝理由。
  if (command === 'up' || command === 'build-plan') {
    return refuseRetiredCommand(command, files);
  }
  const admission = validateDomain({ registry, refsDoc, files });
  if (command === 'probe' && admission.violations.length > 0) {
    print({ interface: 'RunnerInfra.v1', command, ready: false, executed: false, refused: true, status: 'UNVERIFIED',
      error: 'RUNNER_CONFIGURATION_REFUSED', violations: admission.violations });
    return EXIT_VERIFY;
  }

  if (command === 'probe') {
    const spec = PROBE_CASES[opts.case];
    if (!spec) return failInput(`unknown probe case: ${opts.case ?? '(missing --case)'}`);
    const rolePolicy = JSON.parse(files.get('role-policy.json'));
    const authority = JSON.parse(files.get('authority-registration.example.json'));
    const observation = {
      interface: 'RunnerInfra.v1',
      command: 'probe',
      case: opts.case,
      executed: false,
      status: 'UNVERIFIED',
      reason: null,
      residentRoleServices: 'RETIRED',
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
    observation.reason = 'Resident role deployment is retired (ADR-0021); live denial evidence must come from real independent host sessions and native scopes, not from role containers. Only the fixed original harness can supply an authorized work package.';
    print(observation);
    return EXIT_VERIFY;
  }

  if (command === 'stop') {
    print({
      interface: 'RunnerInfra.v1',
      command: 'stop',
      executed: false,
      status: 'UNVERIFIED',
      residentRoleServices: 'RETIRED',
      reason:
        'standalone CLI has no original authorized execution handle and never starts or stops anything; the fixed Comet host stops only the matching original execution through stopCliJob; retirement deletes no containers, volumes or images',
    });
    return EXIT_VERIFY;
  }

  if (command === 'up') {
    return refuseRetiredCommand('up', files);
  }

  if (command === 'build-plan') {
    return refuseRetiredCommand('build-plan', files);
  }

  if (command === 'validate') {
    const { violations, catalogGaps, census } = admission;
    const rolePolicy = JSON.parse(files.get('role-policy.json'));
    const authority = JSON.parse(files.get('authority-registration.example.json'));
    const lock = JSON.parse(files.get('image.lock.json'));
    if (violations.length) {
      print({ interface: 'RunnerInfra.v1', command, ready: false, ok: false,
        violations: violations.map(({ code, at }) => ({ code, at })), catalogGaps });
      return EXIT_VERIFY;
    }
    print({
      interface: 'RunnerInfra.v1',
      command: 'validate',
      residentRoleServices: 'RETIRED',
      retirement: lock.retirement ?? null,
      composeParser: admission.composeParser,
      registry: displayPath(registryFile),
      refs: displayPath(refsFile),
      dir: displayPath(dir),
      ok: violations.length === 0,
      violations,
      catalogGaps,
      defaultEntryCensus: { entries: census.entries, residentRoleReferences: 0 },
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
        retirementStatus: lock.retirement?.status ?? null,
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

  if (command === 'qualify') {
    const { violations, catalogGaps, census } = admission;
    const qualification = buildQualification({ registryFile, dir, files, violations, catalogGaps, census });
    print(qualification);
    return qualification.ready ? EXIT_PASS : EXIT_VERIFY;
  }

  return failInput(`unknown command: ${command}`);
}

const PROCESS_INSPECT = '{"id":{{json .Id}},"name":{{json .Name}},"image":{{json .Image}},"state":{{json .State.Status}},"exitCode":{{json .State.ExitCode}},"user":{{json .Config.User}},"cwd":{{json .Config.WorkingDir}},"readOnly":{{json .HostConfig.ReadonlyRootfs}},"privileged":{{json .HostConfig.Privileged}},"capDrop":{{json .HostConfig.CapDrop}},"capAdd":{{json .HostConfig.CapAdd}},"securityOpt":{{json .HostConfig.SecurityOpt}},"network":{{json .HostConfig.NetworkMode}},"project":{{json (index .Config.Labels "sdd.project")}},"authority":{{json (index .Config.Labels "sdd.authority")}},"workspace":{{json (index .Config.Labels "sdd.workspace")}},"execution":{{json (index .Config.Labels "sdd.execution")}},"run":{{json (index .Config.Labels "sdd.run")}},"registration":{{json (index .Config.Labels "sdd.registration")}},"mounts":[{{range $i,$m := .Mounts}}{{if $i}},{{end}}{"type":{{json $m.Type}},"name":{{json $m.Name}},"destination":{{json $m.Destination}},"rw":{{json $m.RW}}}{{end}}]}';
const IMAGE_INSPECT = '{"id":{{json .Id}},"os":{{json .Os}},"architecture":{{json .Architecture}},"sdk":{{json (index .Config.Labels "sdd.sdk")}},"bootstrap":{{json (index .Config.Labels "sdd.bootstrap")}}}';
const VOLUME_INSPECT = '{"name":{{json .Name}},"driver":{{json .Driver}},"hasOptions":{{if .Options}}true{{else}}false{{end}},"project":{{json (index .Labels "sdd.project")}},"authority":{{json (index .Labels "sdd.authority")}},"workspace":{{json (index .Labels "sdd.workspace")}}}';

// Only the fixed P1_3 host constructs this driver. Registration/current action
// are protected data, never fields selected by worker JSON or an environment.
// The driver signs nothing and stores no Run/phase/queue/retry state.
export function createCliJobDriver(options = {}) {
  const fail = (code) => { const error = new Error(code); error.code = code; throw error; };
  if (!isObject(options) || !isObject(options.registration)) fail('REGISTRATION_REQUIRED');
  const registration = structuredClone(options.registration);
  const { authority, dockerExecutable, dockerSha256 } = options;
  const name = (value) => typeof value === 'string' && /^[a-z0-9][a-z0-9_.-]{0,95}$/.test(value);
  const hash = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  if (registration.schemaVersion !== 1 || registration.project !== 'sdd-harness-pilot'
    || !nonBlank(registration.authorityId) || !nonBlank(registration.workspaceId)
    || !name(registration.namespace) || !registration.namespace.startsWith('sdd-harness-i02-')
    || !nonBlank(registration.engineId) || !name(registration.dockerContext)
    || !DIGEST_RE.test(registration.imageDigest ?? '') || !hash(registration.sdkFingerprint) || !hash(registration.bootstrapDigest)
    || !isObject(registration.controlVolumes) || !Array.isArray(registration.roles) || registration.roles.length < 6) fail('REGISTRATION_INVALID');
  const volume = (value) => name(value) && value.startsWith(registration.namespace + '_');
  const ids = new Set(), roles = new Set();
  for (const role of registration.roles) {
    if (!isObject(role) || !name(role.id) || ids.has(role.id) || !nonBlank(role.actionRole)
      || !RUNNER_ROLES.includes(role.containerRole) || !nonBlank(role.principalId) || !volume(role.workspaceVolume)) fail('REGISTRATION_INVALID');
    ids.add(role.id); roles.add(role.containerRole);
  }
  if (RUNNER_ROLES.some((role) => !roles.has(role)) || ['state', 'receipts', 'issuance'].some((key) => !volume(registration.controlVolumes[key]))) fail('REGISTRATION_INVALID');
  const controlNames = Object.values(registration.controlVolumes);
  const workspaces = registration.roles.map((role) => role.workspaceVolume);
  if (controlNames.length !== 3 || new Set([...controlNames, ...workspaces]).size !== controlNames.length + workspaces.length) fail('REGISTRATION_INVALID');
  for (const role of registration.roles) if (registration.roles.some((other) => other.containerRole !== role.containerRole && other.principalId === role.principalId)) fail('REGISTRATION_INVALID');
  if (!authority || typeof authority.verifyDispatch !== 'function') fail('AUTHORITY_REQUIRED');
  if (typeof dockerExecutable !== 'string' || !path.isAbsolute(dockerExecutable) || !hash(dockerSha256)) fail('DOCKER_TOOL_BINDING_REQUIRED');
  const registrationDigest = envelopeDigest(registration);
  const childEnvironment = Object.fromEntries(['PATH', 'HOME', 'LANG', 'TMPDIR'].filter((key) => typeof process.env[key] === 'string').map((key) => [key, process.env[key]]));
  const call = (args) => {
    try { if (sha256Text(fs.readFileSync(dockerExecutable)) !== dockerSha256) fail('DOCKER_TOOL_CHANGED'); }
    catch { fail('DOCKER_TOOL_UNVERIFIED'); }
    const result = spawnSync(dockerExecutable, ['--context', registration.dockerContext, ...args], {
      encoding: 'utf8', env: childEnvironment, timeout: 10_000, maxBuffer: 1024 * 1024,
    });
    if (result.error || result.signal || result.status !== 0) fail('DOCKER_OPERATION_UNVERIFIED');
    return result.stdout.trim();
  };
  const json = (args) => { try { return JSON.parse(call(args)); } catch { fail('DOCKER_METADATA_UNVERIFIED'); } };
  const authorize = (request) => {
    if (!isObject(request) || !isObject(request.job) || !isObject(request.dispatch)) fail('JOB_INPUT_INVALID');
    const { job, dispatch, currentActionBinding } = request;
    const parsed = parseContract('SDD.Delivery.ActionBinding', currentActionBinding);
    if (!parsed.ok || authority.verifyDispatch(dispatch)?.ok !== true
      || envelopeDigest(dispatch.actionBinding) !== envelopeDigest(parsed.value)) fail('CURRENT_DISPATCH_REQUIRED');
    const action = parsed.value;
    if (Object.keys(job).sort().join(',') !== 'argv,execution,run,schemaVersion' || job.schemaVersion !== 1
      || job.execution !== action.execution || job.run !== action.run || !Array.isArray(job.argv) || job.argv.length < 1 || job.argv.length > 64
      || job.argv.some((arg) => typeof arg !== 'string' || arg.length > 4096 || arg.includes('\0'))
      || Buffer.byteLength(JSON.stringify(job)) > 65_536) fail('JOB_INPUT_INVALID');
    const bound = (key, digest) => action.inputs.some((input) => input.name === key && input.digest === digest);
    if (!bound('runner-job', envelopeDigest(job)) || !bound('runner-registration', registrationDigest)) fail('JOB_BINDING_MISMATCH');
    const binding = action.inputs.find((input) => input.name === 'runner-role-binding');
    const selected = registration.roles.filter((role) => envelopeDigest(role) === binding?.digest && role.actionRole === action.role);
    if (selected.length !== 1) fail('ROLE_BINDING_REQUIRED');
    const role = selected[0];
    const legacyName = registration.namespace + '-' + role.id;
    const slotDigest = envelopeDigest({ registration: registrationDigest, run: action.run, execution: action.execution,
      roleBinding: envelopeDigest(role), job: envelopeDigest(job) });
    return { job, dispatch, action, role, legacyName, name: legacyName + '-' + slotDigest };
  };
  const roleMounts = (grant) => [[grant.role.workspaceVolume, '/workspace'], ...(grant.role.containerRole === 'controller'
    ? ['state', 'receipts', 'issuance'].map((key) => [registration.controlVolumes[key], '/comet/' + key]) : [])];
  const checkEngine = () => { if (json(['info', '--format', '{{json .ID}}']) !== registration.engineId) fail('DOCKER_ENGINE_MISMATCH'); };
  const readProcess = (id) => {
    if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) fail('PROCESS_HANDLE_INVALID');
    return json(['inspect', id, '--format', PROCESS_INSPECT]);
  };
  // This checks fixed physical scope, not a dispatch/execution. Peer metadata
  // can only fence a new start; it can never mint a handle for another job.
  const assertRegisteredProcess = (grant, id, value) => {
    if (!isObject(value) || value.id !== id || value.image !== registration.imageDigest
      || value.project !== registration.project || value.authority !== registration.authorityId || value.workspace !== registration.workspaceId
      || value.registration !== registrationDigest
      || value.user !== '10001:10001' || value.cwd !== (grant.role.containerRole === 'controller' ? '/comet/state/project' : '/workspace') || value.readOnly !== true || value.privileged !== false
      || !Array.isArray(value.capDrop) || value.capDrop.length !== 1 || value.capDrop[0] !== 'ALL'
      || value.capAdd !== null && (!Array.isArray(value.capAdd) || value.capAdd.length)
      || !Array.isArray(value.securityOpt) || !value.securityOpt.includes('no-new-privileges:true') || value.network !== 'none') fail('PROCESS_SCOPE_MISMATCH');
    const expected = roleMounts(grant), mounts = value.mounts;
    if (!Array.isArray(mounts) || mounts.some((item) => !isObject(item) || (item.type !== 'volume' && !(item.type === 'tmpfs' && ['/tmp', '/home/comet'].includes(item.destination))))
      || mounts.filter((item) => item.type === 'volume').length !== expected.length
      || expected.some(([source, target]) => mounts.filter((item) => item.type === 'volume' && item.name === source && item.destination === target && item.rw === true).length !== 1)) fail('PROCESS_SCOPE_MISMATCH');
  };
  const inspect = (grant, id) => {
    const value = readProcess(id);
    assertRegisteredProcess(grant, id, value);
    // The fixed legacy name is observation-only compatibility. Execution/run
    // equality is still mandatory, including when an original handle is used.
    if (![grant.name, grant.legacyName].some((name) => value.name === '/' + name)
      || value.execution !== grant.action.execution || value.run !== grant.action.run) fail('PROCESS_SCOPE_MISMATCH');
    return value;
  };
  const roleProcesses = (grant) => {
    // Registration names permit only letters/digits/underscore/dash/dot;
    // escape the sole regexp metacharacter instead of broad prefix matching.
    const pattern = '^/' + grant.legacyName.replaceAll('.', '\\.') + '(-[a-f0-9]{64})?$';
    const output = call(['container', 'ls', '--all', '--no-trunc', '--filter', 'name=' + pattern, '--format', '{{json .ID}}']);
    if (!output) return [];
    const ids = output.split('\n').map((line) => { try { return JSON.parse(line); } catch { fail('DOCKER_METADATA_UNVERIFIED'); } });
    if (new Set(ids).size !== ids.length) fail('PROCESS_SCOPE_AMBIGUOUS');
    return ids.map((id) => {
      const value = readProcess(id);
      assertRegisteredProcess(grant, id, value);
      if (!nonBlank(value.execution) || !nonBlank(value.run) || typeof value.name !== 'string' || !new RegExp(pattern).test(value.name)) fail('PROCESS_SCOPE_MISMATCH');
      return value;
    });
  };
  const find = (grant) => {
    const processes = roleProcesses(grant);
    const original = processes.filter((value) => value.name === '/' + grant.name
      || value.name === '/' + grant.legacyName && value.execution === grant.action.execution && value.run === grant.action.run);
    if (original.length > 1) fail('PROCESS_SCOPE_AMBIGUOUS');
    if (processes.some((value) => value.run === grant.action.run && value.execution === grant.action.execution
      && ![grant.name, grant.legacyName].some((name) => value.name === '/' + name))) fail('PROCESS_SCOPE_MISMATCH');
    return { existing: original.length ? inspect(grant, original[0].id) : null, processes };
  };
  const requireTerminalPeers = (processes, ownId = null) => {
    for (const value of processes) {
      if (value.id === ownId) continue;
      if (value.state === 'exited' && Number.isInteger(value.exitCode) && value.exitCode >= 0) continue;
      if (['created', 'running', 'paused', 'restarting'].includes(value.state)) fail('PROCESS_ROLE_BUSY');
      fail('PROCESS_START_UNKNOWN');
    }
  };
  const handle = (grant, value) => Object.freeze({ containerId: value.id, execution: grant.action.execution, run: grant.action.run,
    roleBindingId: grant.role.id, registrationDigest });
  const observe = (grant, original) => {
    if (!isObject(original) || original.execution !== grant.action.execution || original.run !== grant.action.run
      || original.roleBindingId !== grant.role.id || original.registrationDigest !== registrationDigest) fail('PROCESS_HANDLE_INVALID');
    checkEngine();
    const value = inspect(grant, original.containerId);
    return { scope: 'component/physical-process', managedClosureEligible: false, handle: handle(grant, value), observation: value };
  };
  return Object.freeze({
    registrationDigest,
    startCliJob(request) {
      const grant = authorize(request);
      checkEngine();
      const image = json(['image', 'inspect', registration.imageDigest, '--format', IMAGE_INSPECT]);
      if (!isObject(image) || image.id !== registration.imageDigest || image.os !== 'linux' || image.architecture !== 'arm64'
        || image.sdk !== registration.sdkFingerprint || image.bootstrap !== registration.bootstrapDigest) fail('IMAGE_BINDING_MISMATCH');
      const resolved = find(grant);
      let existing = resolved.existing;
      const resumed = Boolean(existing);
      // An existing created/unknown process is not a fresh launch claim. Only
      // Comet can reconcile its original starting/started/unknown record.
      if (existing) {
        requireTerminalPeers(resolved.processes, existing.id);
        return { ...observe(grant, handle(grant, existing)), resumed: true, terminal: null };
      }
      requireTerminalPeers(resolved.processes);
      if (!existing) {
        const mounts = roleMounts(grant);
        for (const [source] of mounts) {
          const value = json(['volume', 'inspect', source, '--format', VOLUME_INSPECT]);
          if (!isObject(value) || value.name !== source || value.driver !== 'local' || value.hasOptions !== false
            || value.project !== registration.project || value.authority !== registration.authorityId || value.workspace !== registration.workspaceId) fail('VOLUME_BINDING_MISMATCH');
        }
        const labels = { project: registration.project, authority: registration.authorityId, workspace: registration.workspaceId,
          execution: grant.action.execution, run: grant.action.run, registration: registrationDigest };
        const args = ['create', '--name', grant.name, '--pull=never', '--interactive', '--read-only', '--user', '10001:10001',
          '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--network', 'none', '--pids-limit', '128', '--memory', '1g', '--cpus', '1',
          '--workdir', grant.role.containerRole === 'controller' ? '/comet/state/project' : '/workspace',
          '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m,uid=10001,gid=10001', '--tmpfs', '/home/comet:rw,noexec,nosuid,size=64m,uid=10001,gid=10001'];
        for (const [key, value] of Object.entries(labels)) args.push('--label', 'sdd.' + key + '=' + value);
        for (const [source, target] of mounts) args.push('--mount', `type=volume,source=${source},target=${target},volume-nocopy`);
        args.push('--entrypoint', '/usr/local/bin/node', registration.imageDigest, '/opt/sdd/runner-host.mjs');
        const id = call(args); existing = inspect(grant, id);
        // Recheck after create: a competing created/running slot is a fence,
        // never permission to start a second writer or clean either resource.
        const afterCreate = roleProcesses(grant);
        if (!afterCreate.some((value) => value.id === existing.id)) fail('PROCESS_START_UNKNOWN');
        requireTerminalPeers(afterCreate, existing.id);
      }
      if (existing.state !== 'created') fail('PROCESS_START_UNKNOWN');
      const original = handle(grant, existing);
      const child = spawn(dockerExecutable, ['--context', registration.dockerContext, 'start', '--attach', '--interactive', existing.id],
        { env: childEnvironment, stdio: ['pipe', 'pipe', 'pipe'] });
      const stdout = [], stderr = []; let size = 0, overflow = false;
      const collect = (chunks) => (data) => { size += data.length; if (size <= 8 * 1024 * 1024) chunks.push(Buffer.from(data)); else overflow = true; };
      child.stdout.on('data', collect(stdout)); child.stderr.on('data', collect(stderr));
      child.stdin.on('error', () => {});
      const terminal = new Promise((resolve) => {
        const finish = (code, signal, failed = false) => resolve({ scope: 'component/physical-process', managedClosureEligible: false,
          handle: original, clientProcessId: child.pid ?? null, clientExitCode: code, signal, status: failed || overflow ? 'UNVERIFIED' : 'CLIENT_TERMINAL',
          stdoutBytes: Buffer.concat(stdout), stderrBytes: Buffer.concat(stderr), outputTruncated: overflow });
        child.once('error', () => finish(null, null, true)); child.once('close', (code, signal) => finish(code, signal));
      });
      child.stdin.end(JSON.stringify({ dispatch: grant.dispatch, job: grant.job }) + '\n');
      return { scope: 'component/physical-process', managedClosureEligible: false, handle: original, resumed, clientProcessId: child.pid ?? null, terminal };
    },
    resolveCliJob(request) {
      const grant = authorize(request);
      checkEngine();
      const { existing } = find(grant);
      const lookup = { scope: 'component/physical-process', managedClosureEligible: false, launchPermitted: false };
      return existing
        ? { ...lookup, found: true, status: 'FOUND', handle: handle(grant, existing), observation: existing }
        : { ...lookup, found: false, status: 'ABSENT', handle: null, observation: null };
    },
    observeCliJob(request) {
      const grant = authorize(request);
      return observe(grant, request.handle);
    },
    stopCliJob(request) {
      const grant = authorize(request);
      const before = observe(grant, request.handle);
      if (before.observation.state === 'running') call(['stop', '--time', '5', before.handle.containerId]);
      const after = observe(grant, request.handle);
      if (after.observation.state === 'running') fail('PROCESS_STOP_UNVERIFIED');
      return after;
    },
  });
}

let isCli = false;
try { isCli = Boolean(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); }
catch { /* imported code has no CLI entry; no caller-selected module is loaded */ }
if (isCli) {
  try { process.exitCode = await main(process.argv.slice(2)); }
  catch { print({ interface: 'RunnerInfra.v1', status: 'INTERNAL_FAILURE', ready: false, executed: false, code: 'INTERNAL_FAILURE', error: 'runner operation failed' }); process.exitCode = EXIT_VERIFY; }
}

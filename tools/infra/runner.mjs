#!/usr/bin/env node
// RunnerInfra.v1 / RoleBoundary.v1 / Authority.v1 CLI — validate | qualify | up | probe | stop
//
// CLI validates the current declaration. Its standalone mode has no authority
// to launch a product job. The fixed P1_3 host uses the physical lifecycle
// below; Comet owns all dispatch/phase/retry state. No live settings or secrets
// are read or written. Historical images never qualify the current candidate.
//
// 退出码契约（execution-contract.json V_INFRA_I02.cli_contract）：
//   0 = PASS（validate 通过）
//   1 = 输入或前置无效（文件缺失/不可解析、参数错误、未知 probe case）
//   2 = 验证失败（语义违规、qualify NOT_READY、up 被拒、probe/stop 环境缺失 UNVERIFIED）
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
const SECRET_REF_PREFIX = 'secret-ref:';
const PLACEHOLDER_IMAGE_RE = /^image:\s*\$\{[A-Z0-9_]+:\?[^}]*\}\s*$/;

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
    '  runner.mjs build-plan [--dir <runner dir>] [--json]',
    '  runner.mjs qualify  --registry <file> [--dir <runner dir>] [--json]',
    '  runner.mjs up       --registry <file> [--dir <runner dir>] [--json]',
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

// This exact context is an input snapshot, not a checkout: no unlisted paths,
// links (including parents), or special entries may accompany the manifest.
function buildContextStatus(context, contextFiles) {
  const expected = new Map(contextFiles.map((item) => [item.path, item.sha256]));
  const directories = new Set();
  for (const file of expected.keys()) {
    for (let parent = path.posix.dirname(file); parent !== '.'; parent = path.posix.dirname(parent)) directories.add(parent);
  }
  let current = repoRoot;
  const parents = [];
  for (const component of context.split('/')) {
    current = path.join(current, component);
    let stat;
    try { stat = fs.lstatSync(current); }
    catch (error) {
      if (error?.code === 'ENOENT') return 'ABSENT';
      if (INPUT_FILE_ERRORS.has(error?.code)) return 'CONFLICT';
      throw error;
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) return 'CONFLICT';
    parents.push({ file: current, stat });
  }
  const contextRoot = current;
  let seen = 0;
  const visit = (directory, prefix = '') => {
    for (const entry of fs.readdirSync(directory)) {
      const relative = prefix ? `${prefix}/${entry}` : entry;
      const file = path.join(directory, entry), stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) return false;
      if (expected.has(relative)) {
        if (!stat.isFile()) return false;
        const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
        try {
          const opened = fs.fstatSync(fd);
          if (!opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino || sha256Text(fs.readFileSync(fd)) !== expected.get(relative)) return false;
        } finally { fs.closeSync(fd); }
        seen++;
      } else if (directories.has(relative) && stat.isDirectory()) {
        parents.push({ file, stat });
        if (!visit(file, relative)) return false;
      } else return false;
    }
    return true;
  };
  try {
    if (!visit(contextRoot) || seen !== expected.size) return 'CONFLICT';
    for (const parent of parents) {
      const stat = fs.lstatSync(parent.file);
      if (!stat.isDirectory() || stat.isSymbolicLink() || stat.dev !== parent.stat.dev || stat.ino !== parent.stat.ino) return 'CONFLICT';
    }
    return 'EXACT';
  } catch (error) {
    if (INPUT_FILE_ERRORS.has(error?.code)) return 'CONFLICT';
    throw error;
  }
}

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
      if (source.hostBuildFingerprint !== undefined && (typeof source.hostBuildFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(source.hostBuildFingerprint))) add('image.lock.sourceInputs.hostBuildFingerprint', 'SHA256 hex');
      scalar(source.archiveBytes, 'image.lock.sourceInputs.archiveBytes', 'integer');
      for (const key of ['toolchain', 'openspec']) object(source[key], `image.lock.sourceInputs.${key}`, true);
      if (!runtimeInputShape(source.runtime)) add('image.lock.sourceInputs.runtime', 'fixed runtime input manifest');
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

function runtimeInputShape(value) {
  const exact = (object, keys) => isObject(object) && Object.keys(object).sort().join(',') === [...keys].sort().join(',');
  const hash = text => typeof text === 'string' && /^[a-f0-9]{64}$/.test(text);
  const bytes = number => Number.isSafeInteger(number) && number > 0 && number <= 128 * 1024 * 1024;
  const measured = item => exact(item, ['path', 'realpath', 'bytes', 'sha256']) && typeof item.path === 'string'
    && typeof item.realpath === 'string' && bytes(item.bytes) && hash(item.sha256);
  const provenance = value?.python?.provenance;
  const bootstrap = value?.bootstrap;
  const dependency = item => exact(item, ['id', 'closed', 'sourceLockSha256', 'files']) && typeof item.id === 'string'
    && typeof item.closed === 'boolean' && hash(item.sourceLockSha256) && Array.isArray(item.files) && item.files.length <= 2000
    && item.files.every(file => exact(file, ['name', 'version', 'url', 'integrity', 'sha256', 'bytes', 'path'])
      && ['name', 'version', 'url', 'path'].every(key => typeof file[key] === 'string') && hash(file.sha256) && bytes(file.bytes)
      && (file.integrity === null || typeof file.integrity === 'string' && /^sha512-[A-Za-z0-9+/]{86}==$/.test(file.integrity)));
  return exact(value, ['schemaVersion', 'platform', 'node', 'python', 'bootstrap', 'dependencies', 'projects']) && value.schemaVersion === 1
    && typeof value.platform === 'string' && exact(value.node, ['component', 'version'])
    && exact(value.python, ['component', 'version', 'minimum', 'libraries', 'provenance'])
    && ['component', 'version'].every(key => typeof value.node[key] === 'string' && typeof value.python[key] === 'string')
    && typeof value.python.minimum === 'string' && Array.isArray(value.python.libraries)
    && value.python.libraries.every(item => typeof item === 'string')
    && exact(provenance, ['libraries', 'pythonLicense']) && measured({ ...provenance.pythonLicense, realpath: provenance.pythonLicense?.path })
    && Array.isArray(provenance.libraries) && provenance.libraries.every(item => exact(item, ['path', 'realpath', 'bytes', 'sha256', 'owner', 'version', 'copyright'])
      && measured({ path: item.path, realpath: item.realpath, bytes: item.bytes, sha256: item.sha256 })
      && typeof item.owner === 'string' && typeof item.version === 'string' && measured(item.copyright))
    && exact(bootstrap, ['entry', 'adapter', 'link', 'files', 'packageLockSha256'])
    && ['entry', 'adapter', 'link'].every(key => typeof bootstrap[key] === 'string') && hash(bootstrap.packageLockSha256)
    && Array.isArray(bootstrap.files) && bootstrap.files.length <= 64 && bootstrap.files.every(file => typeof file === 'string')
    && Array.isArray(value.dependencies) && value.dependencies.length === 6 && value.dependencies.every(dependency)
    && exact(value.projects, ['openspec', 'comet']) && exact(value.projects.openspec, ['packageJson', 'packageLock']) && exact(value.projects.comet, ['pnpmLock', 'packageJson'])
    && [value.projects.openspec.packageJson, value.projects.openspec.packageLock, value.projects.comet.pnpmLock, value.projects.comet.packageJson].every(item => exact(item, ['path', 'bytes', 'sha256']) && typeof item.path === 'string' && bytes(item.bytes) && hash(item.sha256));
}

const RUNTIME_DEPENDENCY_SETS = ['bootstrap-npm', 'comet-pnpm', 'git-deb', 'openspec-npm', 'pnpm', 'python-wheel'];
function safeBootstrapFile(file) {
  return /^(?:package(?:-lock)?\.json|LICENSE|lib\/adapters\/comet(?:-executor)?\.js|lib\/delivery\/(?:baseline|evidence|gate|test-contract)\.js|tools\/infra\/(?:runner|secret-refs)\.mjs|contracts\/delivery\/[A-Za-z0-9.-]+\.js|infra\/delivery\/(?:registry\.json|secrets\.refs\.example\.json|qualification-policy\.json|runner\/(?:compose\.yaml|Dockerfile|role-policy\.json|workspace-mounts\.json|authority-registration\.example\.json)))$/.test(file);
}
function safeRuntimeArtifact(file) {
  return /^\.sdd\/cache\/runner-build\/public\/(?:npm|comet|deb|pnpm|wheel)\/[A-Za-z0-9_.+-]+\.(?:tgz|deb|whl)$/.test(file);
}
function repositoryBytes(relative) {
  let file = repoRoot;
  try {
    const parts = relative.split('/');
    for (const [index, part] of parts.entries()) {
      if (!part || part === '.' || part === '..') return null;
      file = path.join(file, part); const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink() || (index === parts.length - 1 ? !stat.isFile() || stat.size > 128 * 1024 * 1024 : !stat.isDirectory())) return null;
    }
    return fs.readFileSync(file);
  } catch { return null; }
}
function verifiedOpenSpecProject(lock) {
  const runtime = lock.sourceInputs.runtime, pin = lock.sourceInputs.openspec, project = runtime.projects.openspec;
  const failure = code => ({ findings: [{ code, at: 'image.lock.json:sourceInputs.runtime.projects.openspec' }], package: null });
  const packageBytes = repositoryBytes(project.packageJson.path), lockBytes = repositoryBytes(project.packageLock.path);
  if (!packageBytes || !lockBytes || packageBytes.length !== project.packageJson.bytes || lockBytes.length !== project.packageLock.bytes
    || sha256Text(packageBytes) !== project.packageJson.sha256 || sha256Text(lockBytes) !== project.packageLock.sha256) return failure('OPENSPEC_PROJECT_LOCK_DRIFT');
  let manifest, frozen;
  try { manifest = JSON.parse(packageBytes); frozen = JSON.parse(lockBytes); } catch { return failure('OPENSPEC_PROJECT_LOCK_INVALID'); }
  const reference = 'file:../../../../.sdd/cache/runner-build/openspec-' + pin.version + '.tgz';
  if (!isObject(manifest.dependencies) || Object.keys(manifest.dependencies).join(',') !== '@fission-ai/openspec'
    || manifest.dependencies['@fission-ai/openspec'] !== reference || frozen.lockfileVersion !== 3 || !isObject(frozen.packages)
    || JSON.stringify(frozen.packages['']?.dependencies) !== JSON.stringify(manifest.dependencies)) return failure('OPENSPEC_PROJECT_LOCK_INVALID');
  const declared = runtime.dependencies.find(group => group.id === 'openspec-npm').files, unique = new Set();
  for (const [location, item] of Object.entries(frozen.packages)) {
    if (!location) continue;
    if (!isObject(item) || typeof item.version !== 'string' || typeof item.resolved !== 'string'
      || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(item.integrity ?? '')) return failure('OPENSPEC_DEPENDENCY_UNLOCKED');
    const matches = declared.filter(file => file.version === item.version && file.integrity === item.integrity);
    if (matches.length !== 1) return failure('OPENSPEC_DEPENDENCY_UNLOCKED');
    let wanted, supplied;
    try {
      wanted = new URL(item.resolved === reference ? pin.registryTarball : item.resolved); supplied = new URL(matches[0].url);
      if (wanted.protocol !== 'https:' || !['registry.npmjs.org', 'registry.npmmirror.com'].includes(wanted.hostname)
        || wanted.username || wanted.password || wanted.port || wanted.search || wanted.hash || wanted.pathname !== supplied.pathname) return failure('OPENSPEC_DEPENDENCY_UNLOCKED');
    } catch { return failure('OPENSPEC_DEPENDENCY_UNLOCKED'); }
    unique.add(item.integrity);
  }
  if (unique.size !== declared.length) return failure('OPENSPEC_DEPENDENCY_UNLOCKED');
  const self = frozen.packages['node_modules/@fission-ai/openspec'];
  const tar = repositoryBytes('.sdd/cache/runner-build/openspec-' + pin.version + '.tgz');
  if (!tar || tar.length !== pin.tarballBytes || sha256Text(tar) !== pin.tarballSha256 || self?.resolved !== reference || self?.version !== pin.version
    || self.integrity !== 'sha512-' + crypto.createHash('sha512').update(tar).digest('base64')) return failure('OPENSPEC_TARBALL_UNVERIFIED');
  const inspect = String.raw`import io,json,sys,tarfile
raw=sys.stdin.buffer.read(1048577)
assert len(raw)<=1048576
with tarfile.open(fileobj=io.BytesIO(raw),mode='r:gz') as archive:
    member=archive.getmember('package/package.json')
    assert member.isfile() and member.size<=65536
    package=json.load(archive.extractfile(member))
    assert package['name']=='@fission-ai/openspec' and package['version']=='1.11.0' and package['bin']['openspec']=='./bin/openspec.js'
    entry=archive.getmember('package/bin/openspec.js')
    assert entry.isfile() and 0<entry.size<=1048576
print(json.dumps({'name':'@fission-ai/openspec','version':'1.11.0','entry':'bin/openspec.js'}))`;
  const env = Object.fromEntries(['PATH', 'HOME', 'LANG', 'TMPDIR'].filter(key => typeof process.env[key] === 'string').map(key => [key, process.env[key]]));
  const result = spawnSync('python3', ['-I', '-c', inspect], { input: tar, env, encoding: 'utf8', timeout: 5000, maxBuffer: 16384 });
  if (result.error || result.signal || result.status !== 0) return failure('OPENSPEC_PACKAGE_METADATA_UNVERIFIED');
  let metadata;
  try { metadata = JSON.parse(result.stdout); } catch { return failure('OPENSPEC_PACKAGE_METADATA_UNVERIFIED'); }
  if (metadata.name !== '@fission-ai/openspec' || metadata.version !== pin.version || metadata.entry !== 'bin/openspec.js') return failure('OPENSPEC_PACKAGE_METADATA_UNVERIFIED');
  return { findings: [], package: { ...metadata, pathBase: 'image-root', cliTarget: 'build/repo/.sdd/cache/runner-build/openspec-project/node_modules/.bin/openspec',
    cliLink: 'usr/local/bin/openspec', projectLockSha256: project.packageLock.sha256, sourceTarSha256: pin.tarballSha256, dependencyArtifacts: declared.length } };
}

function bootstrapSources(runtime, domainFiles) {
  const source = runtime.bootstrap, files = [], findings = [], names = new Set(source.files);
  for (const file of source.files) {
    const domainName = file.startsWith('infra/delivery/runner/') ? file.slice('infra/delivery/runner/'.length) : null;
    const bytes = domainName && domainFiles.has(domainName) ? Buffer.from(domainFiles.get(domainName)) : repositoryBytes(file);
    if (!bytes) { findings.push({ code: 'BOOTSTRAP_SOURCE_UNVERIFIED', at: 'sourceInputs.runtime.bootstrap.files' }); continue; }
    files.push({ path: file, bytes });
    if (!/\.m?js$/.test(file)) continue;
    const text = bytes.toString('utf8');
    const imports = [...text.matchAll(/^(?:import|export)\s+(?:[\w*{},\s]+\s+from\s*)?['"]([^'"]+)['"]/gm),
      ...text.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)];
    for (const match of imports) {
      const dependency = match[1];
      if (dependency.startsWith('.')) {
        if (!names.has(path.posix.normalize(path.posix.join(path.posix.dirname(file), dependency)))) findings.push({ code: 'BOOTSTRAP_DEPENDENCY_MISSING', at: 'sourceInputs.runtime.bootstrap.files' });
      } else if (!dependency.startsWith('node:') && dependency !== 'commonmark' && !['fs', 'path', 'crypto', 'child_process'].includes(dependency)) findings.push({ code: 'BOOTSTRAP_PACKAGE_UNDECLARED', at: 'sourceInputs.runtime.bootstrap.files' });
    }
  }
  const npmLock = files.find(file => file.path === 'package-lock.json');
  if (!npmLock || sha256Text(npmLock.bytes) !== source.packageLockSha256) findings.push({ code: 'BOOTSTRAP_PACKAGE_LOCK_DRIFT', at: 'sourceInputs.runtime.bootstrap.packageLockSha256' });
  else {
    try {
      const expected = JSON.parse(npmLock.bytes).packages;
      const declared = runtime.dependencies.find(item => item.id === 'bootstrap-npm').files;
      const packages = Object.entries(expected).filter(([name]) => name);
      if (declared.length !== packages.length || packages.some(([name, value]) => declared.filter(file => file.name === name.slice('node_modules/'.length)
        && file.version === value.version && file.integrity === value.integrity).length !== 1)) findings.push({ code: 'BOOTSTRAP_NPM_CLOSURE_INVALID', at: 'sourceInputs.runtime.dependencies' });
    } catch { findings.push({ code: 'BOOTSTRAP_PACKAGE_LOCK_UNVERIFIED', at: 'sourceInputs.runtime.bootstrap.packageLockSha256' }); }
  }
  return { files, findings };
}

function runtimeFindings(lock) {
  const value = lock.sourceInputs.runtime, byName = new Map(lock.components.map(item => [item.component, item]));
  const failures = [], add = (code) => failures.push({ code, at: 'image.lock.json:sourceInputs.runtime' });
  const source = (component, prefix) => {
    const item = byName.get(component);
    return item && DIGEST_RE.test(item.digest ?? '') && item.reference === prefix + '@' + item.digest
      && item.required === true && item.digestAuthenticated === true;
  };
  if (byName.size !== lock.components.length || value.platform !== 'linux/arm64' || value.node.component !== 'runner-base' || value.python.component !== 'python-runtime'
    || !source(value.node.component, 'node') || !source(value.python.component, 'python')
    || lock.resolution?.dockerfileMapping?.RUNNER_BASE_IMAGE !== value.node.component
    || lock.resolution?.dockerfileMapping?.PYTHON_BASE_IMAGE !== value.python.component) add('RUNTIME_SOURCE_PIN_INVALID');
  const python = /^(\d+)\.(\d+)\.(\d+)$/.exec(value.python.version);
  if (value.node.version !== lock.sourceInputs.toolchain.node || value.python.minimum !== lock.sourceInputs.toolchain.pythonMinimum
    || !python || Number(python[1]) < 3 || Number(python[1]) === 3 && Number(python[2]) < 12) add('RUNTIME_VERSION_INVALID');
  if (value.python.libraries.length !== 23 || new Set(value.python.libraries).size !== value.python.libraries.length
    || value.python.libraries.some(item => !/^lib\/aarch64-linux-gnu\/[A-Za-z0-9_.+-]+$/.test(item)
      || /\/(?:libc|libm|libresolv)\.so/.test(item))) add('PYTHON_LIBRARY_CLOSURE_INVALID');
  if (value.python.provenance.libraries.length !== 23 || value.python.provenance.libraries.some((item, index) => item.path !== value.python.libraries[index]
    || !/^usr\/lib\/aarch64-linux-gnu\/[A-Za-z0-9_.+-]+$/.test(item.realpath)
    || !/^[a-z0-9][a-z0-9+.-]*(?::arm64)?$/.test(item.owner)
    || !/^[A-Za-z0-9.+:~_-]+$/.test(item.version) || item.copyright.path !== 'usr/share/doc/' + item.owner.split(':')[0] + '/copyright'
    || !/^usr\/share\/(?:doc|common-licenses)\/[A-Za-z0-9_.+/-]+$/.test(item.copyright.realpath))
    || value.python.provenance.pythonLicense.path !== 'usr/local/lib/python3.12/LICENSE.txt') add('PYTHON_PROVENANCE_INVALID');
  const bootstrap = value.bootstrap;
  if (bootstrap.entry !== 'lib/adapters/comet-executor.js' || bootstrap.adapter !== 'lib/adapters/comet.js' || bootstrap.link !== 'runner-host.mjs'
    || new Set(bootstrap.files).size !== bootstrap.files.length || bootstrap.files.some(file => !safeBootstrapFile(file))
    || ['lib/adapters/comet-executor.js', 'lib/adapters/comet.js', 'tools/infra/runner.mjs', 'package.json', 'package-lock.json'].some(file => !bootstrap.files.includes(file))) add('BOOTSTRAP_FILE_SET_INVALID');
  if (value.dependencies.map(item => item.id).sort().join(',') !== RUNTIME_DEPENDENCY_SETS.join(',')) add('RUNTIME_DEPENDENCY_SET_INVALID');
  if (value.projects.openspec.packageJson.path !== '.sdd/cache/runner-build/openspec-project/package.json'
    || value.projects.openspec.packageLock.path !== '.sdd/cache/runner-build/openspec-project/package-lock.json'
    || value.projects.comet.pnpmLock.path !== '.sdd/cache/runner-build/comet-pnpm-project/pnpm-lock.yaml'
    || value.projects.comet.packageJson.path !== '.sdd/cache/runner-build/comet-pnpm-project/package.json'
    || value.dependencies.find(item => item.id === 'openspec-npm')?.sourceLockSha256 !== value.projects.openspec.packageLock.sha256
    || value.dependencies.find(item => item.id === 'comet-pnpm')?.sourceLockSha256 !== value.projects.comet.pnpmLock.sha256) add('RUNTIME_PROJECT_LOCK_INVALID');
  for (const group of value.dependencies) {
    if (group.closed && !group.files.length || new Set(group.files.map(file => file.path)).size !== group.files.length
      || group.files.some(file => {
        try { const url = new URL(file.url); return !safeRuntimeArtifact(file.path) || url.protocol !== 'https:' || url.username || url.password || url.port || url.hash || url.search
          || !['registry.npmjs.org', 'registry.npmmirror.com', 'deb.debian.org', 'files.pythonhosted.org'].includes(url.hostname); }
        catch { return true; }
      })) add('RUNTIME_DEPENDENCY_INPUT_INVALID');
  }
  return failures;
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
  violations.push(...runtimeFindings(lock));
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
  const read = readInput(path.join(repoRoot, 'integrations/comet/upstream.lock.json'), 'upstream lock', true);
  if (!read.ok) return { upstream: null, error: read.code };
  const value = read.value;
  const valid = isObject(value) && value.schemaVersion === 1 && isObject(value.source) && isObject(value.toolchain)
    && typeof value.source.commit === 'string' && /^[a-f0-9]{40}$/.test(value.source.commit)
    && typeof value.source.sha256 === 'string' && /^[a-f0-9]{64}$/.test(value.source.sha256)
    && Number.isSafeInteger(value.source.bytes) && value.source.bytes > 0
    && Array.isArray(value.patches) && value.patches.length > 0
    && value.patches.every((item) => isObject(item) && typeof item.path === 'string'
      && /^integrations\/comet\/patches\/[A-Za-z0-9_./-]+\.patch$/.test(item.path) && !item.path.split('/').includes('..')
      && typeof item.sha256 === 'string' && /^[a-f0-9]{64}$/.test(item.sha256))
    && ['node', 'pnpm'].every((key) => typeof value.toolchain[key] === 'string' && /^\d+\.\d+\.\d+$/.test(value.toolchain[key]));
  return valid ? { upstream: value, error: null } : { upstream: null, error: 'UPSTREAM_SHAPE_INVALID' };
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
  if (source.sourceCommit !== upstream.source.commit || source.archiveSha256 !== upstream.source.sha256 || source.archiveBytes !== upstream.source.bytes) {
    add('SOURCE_PIN_MISMATCH', 'image.lock.json:sourceInputs', { reason: 'source commit, archive digest and size must equal the current protected upstream lock' });
  }
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
  if (!openspec || openspec.package !== '@fission-ai/openspec' || openspec.version !== '1.11.0'
    || openspec.tarballSha256 !== '84820b173b57204bd7582a47ddae65e85fd492724172acc8e434e97ea1c05c3f'
    || openspec.registryTarball !== 'https://registry.npmmirror.com/@fission-ai/openspec/-/openspec-1.11.0.tgz' || openspec.tarballBytes !== 471694) {
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
// Executable template changes require source/test review; caller-supplied locks cannot select this pin.
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

  const composition = validateCompose(files.get('compose.yaml'));
  violations.push(...composition.violations);
  violations.push(...validateDockerfile(files.get('Dockerfile')));

  return { violations, catalogGaps, composeParser: composition.parser };
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
      `current source, ${source.patches?.length ?? 0} patch digests and fingerprint ${source.hostBuildFingerprint ?? '(absent)'} are checked against the protected upstream lock and actual patch bytes; runtime identity remains separate`,
    ),
    'container-image': unreadyComponents.length === 0
      ? RECORDED('digests recorded for all components; container daemon verification of the built image is still pending')
      : UNVERIFIED(`current candidate image readback is missing for ${unreadyComponents.map((c) => c.component).join(', ')}; historical image observations are not current qualification`),
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
  if (command === 'probe' && !Object.hasOwn(PROBE_CASES, opts.case)) return failInput('unknown probe case');
  const loaded = loadInputs(opts);
  if (!loaded.ok) {
    print({ interface: 'RunnerInfra.v1', ready: false, executed: false, ...loaded });
    return loaded.exitCode;
  }
  const { registry, refsDoc, registryFile, refsFile, dir, files } = loaded;
  const admission = validateDomain({ registry, refsDoc, files });
  if (['up', 'probe'].includes(command) && admission.violations.length > 0) {
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
    observation.reason = 'No current registered CLI Runner and execution source is qualified. Only the fixed original harness can supply an authorized work package; no HTTP endpoint is a qualification prerequisite.';
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
        'standalone CLI has no original authorized execution handle; the fixed Comet host stops only the matching original execution through stopCliJob',
    });
    return EXIT_VERIFY;
  }

  // build-plan：由当前上游锁导出 Runner 镜像构建计划（六补丁链/工具链/现算指纹/确定性入口/构建参数/输入获取）。
  // 只导出声明：绝不执行构建、绝不打开 up 门（digest 回填是资源准入决策）；与上游锁漂移即拒绝（退出 2）。
  if (command === 'build-plan') {
    const lock = JSON.parse(files.get('image.lock.json'));
    const { upstream, error: upstreamError } = loadUpstreamLock();
    const chain = buildChainFindings({ lock, upstream, upstreamError });
    const drift = [...new Set(admission.violations.map((finding) => finding.code))];
    if (drift.length) { print({ interface: 'RunnerInfra.v1', command, ready: false, status: 'UNVERIFIED', drift }); return EXIT_VERIFY; }
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
    const runtime = lock.sourceInputs.runtime, bootstrap = bootstrapSources(runtime, files), openspecProject = verifiedOpenSpecProject(lock);
    if (openspecProject.findings.length) { print({ interface: 'RunnerInfra.v1', command, ready: false, status: 'UNVERIFIED', code: 'OPENSPEC_INPUTS_UNVERIFIED', findings: openspecProject.findings }); return EXIT_VERIFY; }
    if (bootstrap.findings.length) { print({ interface: 'RunnerInfra.v1', command, ready: false, status: 'UNVERIFIED', code: 'BOOTSTRAP_INPUTS_UNVERIFIED', findings: bootstrap.findings }); return EXIT_VERIFY; }
    const bootstrapFiles = bootstrap.files.map(file => ({ path: file.path, bytes: file.bytes.length, sha256: sha256Text(file.bytes) }));
    const bootstrapDigest = envelopeDigest({ files: bootstrapFiles, dependencies: runtime.dependencies, projects: runtime.projects, node: runtime.node, python: runtime.python });
    const buildArgs = {
      BOOTSTRAP_DIGEST: bootstrapDigest,
      RUNNER_BASE_IMAGE: lock.components.find(item => item.component === lock.sourceInputs.runtime.node.component).reference,
      PYTHON_BASE_IMAGE: lock.components.find(item => item.component === lock.sourceInputs.runtime.python.component).reference,
      PYTHON_VERSION: lock.sourceInputs.runtime.python.version,
      EXPECTED_NODE_VERSION: lock.sourceInputs.runtime.node.version,
      SOURCE_COMMIT: sourceCommit,
      SOURCE_SHA256: upstream?.source?.sha256 ?? null,
      EXPECTED_FINGERPRINT: chain.fingerprint,
      OPENSPEC_VERSION: openspec.version ?? null,
      OPENSPEC_TARBALL_SHA256: openspec.tarballSha256 ?? null,
      ...Object.fromEntries(chain.patchVerification.map((patch, index) => [`PATCH_${index + 1}_SHA256`, patch.sha256])),
    };
    const contextSources = [
      { path: 'infra/delivery/runner/Dockerfile', bytes: Buffer.from(files.get('Dockerfile')) },
      { path: 'infra/delivery/runner/image.lock.json', bytes: Buffer.from(files.get('image.lock.json')) },
      ...bootstrap.files,
      ...[runtime.projects.openspec.packageJson, runtime.projects.openspec.packageLock, runtime.projects.comet.pnpmLock, runtime.projects.comet.packageJson].map(item => { const bytes = repositoryBytes(item.path); return { path: item.path, bytes: bytes && bytes.length === item.bytes && sha256Text(bytes) === item.sha256 ? bytes : null }; }),
      ...['tools/comet/build.mjs', 'tools/comet/source.js', 'tools/comet/prepare-source.mjs', 'integrations/comet/upstream.lock.json',
        ...chain.upstreamPatches.map((patch) => patch.path)].map((file) => ({ path: file, bytes: fs.readFileSync(path.join(repoRoot, file)) })),
    ];
    const mergedSources = new Map();
    for (const item of contextSources) {
      if (mergedSources.has(item.path) && (!mergedSources.get(item.path).bytes || !item.bytes || !mergedSources.get(item.path).bytes.equals(item.bytes))) { print({ interface: 'RunnerInfra.v1', command, ready: false, status: 'UNVERIFIED', code: 'CONTEXT_SOURCE_CONFLICT' }); return EXIT_VERIFY; }
      mergedSources.set(item.path, item);
    }
    contextSources.splice(0, contextSources.length, ...mergedSources.values());
    const contextFiles = contextSources.map(({ path: file, bytes }) => ({ path: file, sha256: bytes ? sha256Text(bytes) : [runtime.projects.openspec.packageJson, runtime.projects.openspec.packageLock, runtime.projects.comet.pnpmLock, runtime.projects.comet.packageJson].find(item => item.path === file).sha256, status: bytes ? 'PRESENT' : 'ACQUISITION_REQUIRED' }));
    const dependencyInputs = runtime.dependencies.map(group => ({ id: group.id, closed: group.closed, files: group.files.map(file => {
      const bytes = repositoryBytes(file.path), present = Boolean(bytes && bytes.length === file.bytes && sha256Text(bytes) === file.sha256
        && (file.integrity === null || 'sha512-' + crypto.createHash('sha512').update(bytes).digest('base64') === file.integrity));
      if (!mergedSources.has(file.path)) { const item = { path: file.path, bytes: present ? bytes : null }; mergedSources.set(file.path, item); contextSources.push(item); contextFiles.push({ path: file.path, sha256: file.sha256, status: present ? 'PRESENT' : 'ACQUISITION_REQUIRED' }); }
      return { path: file.path, bytes: file.bytes, sha256: file.sha256, status: present ? 'PRESENT' : 'ACQUISITION_REQUIRED' };
    }) }));
    const dependenciesComplete = dependencyInputs.every(group => group.closed && group.files.length && group.files.every(file => file.status === 'PRESENT'));

    for (const [file, digest, size] of [[`${runnerCache}/comet-source.tar.gz`, upstream.source.sha256, upstream.source.bytes],
      [`${runnerCache}/openspec-${openspec.version}.tgz`, openspec.tarballSha256, openspec.tarballBytes]]) {
      let bytes = null;
      try {
        const target = path.join(repoRoot, file), stat = fs.lstatSync(target);
        if (stat.isFile() && !stat.isSymbolicLink() && stat.size === size) { const data = fs.readFileSync(target); if (sha256Text(data) === digest) bytes = data; }
      } catch { /* explicit missing input below; never acquire or follow a symlink */ }
      contextSources.push({ path: file, bytes }); contextFiles.push({ path: file, sha256: digest, status: bytes ? 'PRESENT' : 'ACQUISITION_REQUIRED' });
    }
    const contextDigest = envelopeDigest(contextFiles.map(({ path: file, sha256 }) => ({ path: file, sha256 })));
    const context = '.local/I02-convergence-current/build-context/' + contextDigest;
    const contextRoot = path.join(repoRoot, context);
    const conflict = () => { print({ interface: 'RunnerInfra.v1', command, ready: false, status: 'UNVERIFIED', code: 'CONTEXT_CONFLICT' }); return EXIT_VERIFY; };
    const contextStatus = buildContextStatus(context, contextFiles);
    if (contextStatus === 'CONFLICT') return conflict();
    let materialized = contextStatus === 'EXACT';
    if (opts['export-context'] && !materialized) {
      if (!dependenciesComplete || contextSources.some((item) => !item.bytes)) { print({ interface: 'RunnerInfra.v1', command, ready: false, status: 'UNVERIFIED', code: 'CONTEXT_INPUTS_MISSING', dependencyInputs, contextFiles }); return EXIT_VERIFY; }
      try {
        let directory = repoRoot;
        for (const component of context.split('/').slice(0, -1)) {
          directory = path.join(directory, component);
          try { fs.mkdirSync(directory, { mode: 0o700 }); }
          catch (error) { if (error?.code !== 'EEXIST') throw error; }
          const stat = fs.lstatSync(directory);
          if (!stat.isDirectory() || stat.isSymbolicLink()) return conflict();
        }
        fs.mkdirSync(contextRoot, { mode: 0o700 });
        for (const item of contextSources) {
          let parent = contextRoot;
          for (const component of item.path.split('/').slice(0, -1)) {
            parent = path.join(parent, component);
            try { fs.mkdirSync(parent, { mode: 0o700 }); }
            catch (error) { if (error?.code !== 'EEXIST') throw error; }
            const stat = fs.lstatSync(parent);
            if (!stat.isDirectory() || stat.isSymbolicLink()) return conflict();
          }
          fs.writeFileSync(path.join(contextRoot, item.path), item.bytes, { flag: 'wx', mode: 0o600 });
        }
      } catch (error) {
        if (error?.code === 'EEXIST' || INPUT_FILE_ERRORS.has(error?.code)) return conflict();
        throw error;
      }
      if (buildContextStatus(context, contextFiles) !== 'EXACT') return conflict();
      materialized = true;
    }
    print({
      interface: 'RunnerInfra.v1',
      command: 'build-plan',
      dir: displayPath(dir),
      drift,
      sourceCommit,
      fingerprint: chain.fingerprint,
      runtime: { schemaVersion: runtime.schemaVersion, platform: runtime.platform, node: runtime.node,
        python: { component: runtime.python.component, version: runtime.python.version, minimum: runtime.python.minimum, libraries: runtime.python.libraries } },
      ready: false,
      status: 'UNVERIFIED',
      bootstrap: { pathBase: 'image-root', entry: 'opt/sdd/' + runtime.bootstrap.entry, link: { path: 'opt/sdd/' + runtime.bootstrap.link, target: 'opt/sdd/' + runtime.bootstrap.entry }, files: bootstrapFiles, digest: bootstrapDigest, provider: null, productionQualified: false },
      dependencyInputs,
      openspecPackage: openspecProject.package,
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
        context, contextDigest, contextFiles, materialized,
        exclusions: ['.git', '.local', '.claude', '.codex', 'node_modules', 'live settings', 'secret stores', 'unlisted files'],
        buildArgs,
        executable: dependenciesComplete && contextSources.every(item => item.bytes !== null) && materialized,
        argv: dependenciesComplete && contextSources.every(item => item.bytes !== null) ? ['docker', 'build', '--pull=false', '--network=none', '--platform=linux/arm64', '-f', context + '/infra/delivery/runner/Dockerfile', ...Object.entries(buildArgs).flatMap(([key, value]) => ['--build-arg', key + '=' + value]), context] : null,
        command: dependenciesComplete && contextSources.every(item => item.bytes !== null) ? [
          'docker build --pull=false --network=none --platform=linux/arm64',
          `-f ${context}/infra/delivery/runner/Dockerfile`,
          ...Object.entries(buildArgs).map(([key, value]) => `--build-arg ${key}=${value}`),
          context,
        ].join(' ') : null,
      },
      upGate: lock.upGate?.enabled === true ? 'OPEN' : 'CLOSED',
      containerBuildStatus: lock.sourceInputs?.containerBuildStatus ?? null,
    });
    return drift.length === 0 ? EXIT_PASS : EXIT_VERIFY;
  }

  if (command === 'validate') {
    const { violations, catalogGaps } = admission;
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
      composeParser: admission.composeParser,
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
    const { violations, catalogGaps } = admission;
    const qualification = buildQualification({ registryFile, dir, files, violations, catalogGaps });
    if (command === 'qualify') {
      print(qualification);
      return qualification.ready ? EXIT_PASS : EXIT_VERIFY;
    }
    if (!qualification.ready) {
      print({ interface: 'Qualification.v1', command: 'up', domain: 'comet-runner', refused: true, ready: false, executed: false,
        status: 'UNVERIFIED', error: qualification.unreadyComponents.length ? 'UP_REFUSED_RUNNER_LOCK_NOT_READY' : 'UP_REFUSED_RUNNER_NOT_QUALIFIED', receipt: qualification });
      return EXIT_VERIFY;
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

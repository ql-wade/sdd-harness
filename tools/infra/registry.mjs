#!/usr/bin/env node
// Registry.v1 / Qualification.v1 CLI — validate | qualify | status | up | readback
//
// 只登记与验收：不启动任何服务、不持有阶段/DAG/业务重试、不改活配置（hooks/MCP 由对应 P 任务串行接纳）。
// 秘密值永不读写；credentialRef 只是 SecretRef.v1 引用，解析由 tools/infra/secret-refs.mjs 只读完成。
//
// 退出码契约（execution-contract.json V_INFRA_I01.cli_contract）：
//   0 = PASS（validate 通过 / qualify ready / readback 读回成功）
//   1 = 输入或前置无效（未知资源、文件缺失/不可解析、参数错误、登记的 github 身份缺失/畸形）
//   2 = 验证失败（语义违规、qualification NOT_READY/UNVERIFIED/MISMATCH、up 被门禁拒绝、
//        读回失败或身份/repo/caller 不匹配）
//   环境缺失必须显式 UNVERIFIED 并以非零退出，不允许 skip 转 PASS。

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseSecretRef, redactSecretValue, scanForForbiddenValues, validateQualificationPolicy, validateRefsCatalog } from './secret-refs.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const EXIT_PASS = 0;
const EXIT_INPUT = 1;
const EXIT_VERIFY = 2;
const DEFAULT_REGISTRY = path.join(repoRoot, 'infra', 'delivery', 'registry.json');

const sha256File = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

// 宿主私有路径绝不进入结构化回执/报告；对外输出统一脱敏（与 secret-refs 的 ABSOLUTE_PATH_FORBIDDEN 同源规则）。
const HOST_PATH_REDACTION = /(^|[\s"'=(:/])\/(Users|Volumes|home|root|private|var|usr|etc|opt|tmp)\/\S*/g;
const redactHostPaths = (text) => String(text ?? '').replace(HOST_PATH_REDACTION, '$1<host-path-redacted>');

// 结构化输出里的文件字段一律 repo 相对；repo 之外（fixture/临时文件）则复用宿主路径脱敏。
const displayPath = (file) => {
  const rel = path.relative(repoRoot, String(file ?? ''));
  return rel.startsWith('..') ? redactHostPaths(String(file)) : rel;
};

function processFailure(run, command) {
  const detail = run.stderr?.trim() || run.stdout?.trim() || run.error?.message || `${command} exited ${run.status}`;
  return redactHostPaths(detail.split('\n')[0]);
}

function usage() {
  return [
    'usage:',
    '  registry.mjs validate --registry <file> [--refs <file>] [--policy <file>]',
    '  registry.mjs qualify  --resource <id> --registry <file> [--archive <file>] [--npm-metadata <file>]',
    '  registry.mjs status   --registry <file>',
    '  registry.mjs up       --resource <id> --registry <file>',
    '  registry.mjs readback --kind github [--registry <file>]',
  ].join('\n');
}

function parseArgs(argv) {
  const opts = { _: [] };
  const command = argv[0];
  const common = ['registry', 'json'];
  const allowed = command === 'readback' ? [...common, 'kind']
    : ['validate', 'status', 'qualify', 'up'].includes(command)
      ? [...common, 'refs', 'policy', ...(['qualify', 'up'].includes(command) ? ['resource', 'archive', 'npm-metadata'] : [])]
      : null;
  if (command && !allowed) return { command, opts, error: 'unknown command' };
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--') || !allowed?.includes(arg.slice(2))) return { command, opts, error: 'unknown option or unexpected positional argument' };
    if (Object.hasOwn(opts, arg.slice(2))) return { command, opts, error: `duplicate option ${arg}` };
    if (arg === '--json') {
      opts.json = true;
    } else if (arg.startsWith('--')) {
      const value = argv[++i];
      if (value === undefined || value === '' || value.startsWith('--')) return { command, opts, error: `missing value for ${arg}` };
      opts[arg.slice(2)] = value;
    } else {
      opts._.push(arg);
    }
  }
  return { command, opts };
}

function readJson(file) {
  return parseJson(fs.readFileSync(file, 'utf8'));
}

function parseJson(source) {
  try { return JSON.parse(source); } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw Object.assign(new Error('JSON input is not parseable'), { code: 'INVALID_JSON' });
  }
}

function print(payload) {
  process.stdout.write(JSON.stringify({ ...payload, checkedAt: new Date().toISOString() }, (_key, value) => typeof value === 'string' ? redactHostPaths(redactSecretValue(value)) : value, 2) + '\n');
}

function failInput(message) {
  process.stderr.write(`${redactHostPaths(redactSecretValue(message))}\n${usage()}\n`);
  return EXIT_INPUT;
}

const UNVERIFIED = (reason) => ({ status: 'UNVERIFIED', reason });
const RECORDED = (reason) => ({ status: 'RECORDED', reason });
const isNonBlankString = (value) => typeof value === 'string' && value.trim().length > 0;
const LABEL_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const RECOVERY_FIELDS = ['rpo', 'rto', 'retentionPeriod', 'encryptionOwner', 'destructionPrecondition'];

function validateRegistry(registry, refsDoc, policy) {
  const violations = [];
  if (!isPlainObject(registry)) return [{ code: 'REGISTRY_TYPE_INVALID', at: 'registry', expected: 'object' }];
  const policyViolations = validateQualificationPolicy(policy);
  if (policyViolations.length) return policyViolations;
  const projectId = registry?.project?.id;
  if (registry?.interface !== 'Registry.v1') {
    violations.push({ code: 'REGISTRY_INTERFACE_INVALID', reason: 'interface must be Registry.v1' });
  }
  if (typeof projectId !== 'string' || !LABEL_RE.test(projectId)) violations.push({ code: 'PROJECT_ID_MISSING' });
  if (!isNonBlankString(registry?.project?.owner)) {
    violations.push({ code: 'REGISTRY_TYPE_INVALID', at: 'project.owner', expected: 'non-blank string' });
  }
  if (registry?.schemaVersion !== 1) {
    violations.push({ code: 'REGISTRY_TYPE_INVALID', at: 'schemaVersion', expected: 'const 1' });
  }
  const { problems } = registeredGithubIdentity(registry);
  for (const reason of problems) {
    violations.push({ code: 'REGISTRY_TYPE_INVALID', at: 'project.github', reason });
  }
  if (!isPlainObject(registry.project?.authority) || !['VERIFIED', 'UNVERIFIED'].includes(registry.project.authority.readbackStatus)) {
    violations.push({ code: 'REGISTRY_TYPE_INVALID', at: 'project.authority.readbackStatus', expected: 'VERIFIED or UNVERIFIED' });
  }
  const delegates = registry.project?.delegates === undefined ? [] : registry.project.delegates;
  if (!Array.isArray(delegates) || delegates.some((owner) => !isNonBlankString(owner))) {
    violations.push({ code: 'REGISTRY_TYPE_INVALID', at: 'project.delegates', expected: 'non-blank string array' });
  }

  const catalogViolations = validateRefsCatalog(refsDoc, projectId, { roles: policy.roles });
  violations.push(...catalogViolations);
  const registeredRefs = catalogViolations.length === 0
    ? new Set(refsDoc.refs.map((entry) => entry.ref))
    : null;
  const knownOwners = new Set([registry.project?.owner, ...(Array.isArray(delegates) ? delegates : [])].filter(Boolean));
  const resources = Array.isArray(registry.resources) ? registry.resources : [];
  if (!Array.isArray(registry.resources) || resources.length === 0) {
    violations.push({ code: 'REGISTRY_TYPE_INVALID', at: 'resources', expected: 'non-empty resource array' });
  }
  const seenResourceIds = new Set();
  for (const [index, resource] of resources.entries()) {
    if (!isPlainObject(resource)) {
      violations.push({ code: 'REGISTRY_TYPE_INVALID', at: `resources[${index}]`, expected: 'object' });
      continue;
    }
    const at = `resources[${index}]:${typeof resource.id === 'string' ? resource.id : '?'}`;
    if (resource?.id !== undefined) {
      if (seenResourceIds.has(resource.id)) {
        violations.push({ code: 'DUPLICATE_RESOURCE_ID', at, id: resource.id });
      } else {
        seenResourceIds.add(resource.id);
      }
    }
    for (const field of ['id', 'kind', 'owner', 'purpose', 'credentialRef', 'lockRef', 'domain', 'retention']) {
      if (resource?.[field] === undefined) violations.push({ code: 'REGISTRY_FIELD_MISSING', at, field });
    }
    for (const field of ['id', 'kind', 'owner', 'purpose', 'credentialRef', 'lockRef']) {
      if (resource?.[field] !== undefined && !isNonBlankString(resource[field])) {
        violations.push({ code: 'REGISTRY_TYPE_INVALID', at, field, expected: 'non-blank string' });
      }
    }
    for (const field of ['id', 'kind']) {
      if (typeof resource[field] === 'string' && !LABEL_RE.test(resource[field])) {
        violations.push({ code: 'REGISTRY_TYPE_INVALID', at, field, expected: 'lowercase kebab label' });
      }
    }
    if (!isPlainObject(resource.domain) || !isNonBlankString(resource.domain.network)) {
      violations.push({ code: 'REGISTRY_TYPE_INVALID', at, field: 'domain.network', expected: 'non-blank string' });
    }
    if (Object.hasOwn(resource, 'runtimeRequirement')) {
      if (!isPlainObject(resource.runtimeRequirement)) violations.push({ code: 'REGISTRY_TYPE_INVALID', at, field: 'runtimeRequirement', expected: 'object' });
      else {
        for (const field of ['node', 'source']) {
          if (Object.hasOwn(resource.runtimeRequirement, field) && !isNonBlankString(resource.runtimeRequirement[field])) violations.push({ code: 'REGISTRY_TYPE_INVALID', at, field: `runtimeRequirement.${field}`, expected: 'non-blank string' });
        }
      }
    }
    if (isNonBlankString(resource?.lockRef)) {
      try {
        resolveLockPath(resource);
      } catch {
        violations.push({ code: 'LOCK_REF_NOT_CONTAINED', at, field: 'lockRef', reason: 'lockRef must be a relative path contained by the project, including symlink targets' });
      }
    }
    if (resource?.owner && !knownOwners.has(resource.owner)) {
      violations.push({ code: 'UNKNOWN_OWNER', at, owner: resource.owner, knownOwners: [...knownOwners] });
    }

    const parsed = parseSecretRef(resource?.credentialRef ?? '');
    if (!parsed.ok) {
      violations.push({ code: parsed.code, at, ref: resource?.credentialRef, reason: parsed.error });
    } else {
      if (projectId && parsed.project !== projectId) {
        violations.push({ code: 'CROSS_PROJECT_REF', at, ref: resource.credentialRef, project: parsed.project });
      } else if (registeredRefs && !registeredRefs.has(resource.credentialRef)) {
        violations.push({ code: 'REF_NOT_REGISTERED', at, ref: resource.credentialRef });
      }
    }

    if (Object.hasOwn(resource, 'image') && !isPlainObject(resource.image)) violations.push({ code: 'REGISTRY_TYPE_INVALID', at, field: 'image', expected: 'object' });
    const image = isPlainObject(resource.image) ? resource.image : null;
    if (image) {
      for (const field of ['reference', 'digest']) {
        if (Object.hasOwn(image, field) && !isNonBlankString(image[field])) violations.push({ code: 'REGISTRY_TYPE_INVALID', at, field: `image.${field}`, expected: 'non-blank string' });
      }
      const reference = typeof image.reference === 'string' ? image.reference : '';
      if (policy?.imageReference?.floatingTagsForbidden && /:latest\s*$/.test(reference)) {
        violations.push({ code: 'FLOATING_TAG_FORBIDDEN', at, reference });
      }
      if (policy?.imageReference?.digestPinnedRequired && !image.digest) {
        violations.push({ code: 'IMAGE_NOT_DIGEST_PINNED', at, reference });
      }
      if (typeof image.digest === 'string' && image.digest && !(new RegExp(policy.imageReference.digestFormat)).test(image.digest)) {
        violations.push({ code: 'DIGEST_FORMAT_INVALID', at, digest: image.digest });
      }
    }

    const retention = isPlainObject(resource.retention) ? resource.retention : {};
    for (const field of RECOVERY_FIELDS) {
      if (retention[field] === undefined) violations.push({ code: 'REGISTRY_FIELD_MISSING', at, field: `retention.${field}` });
      else if (retention[field] !== null && typeof retention[field] !== 'string') {
        violations.push({ code: 'REGISTRY_TYPE_INVALID', at, field: `retention.${field}`, expected: 'string or null' });
      }
    }
    if (typeof retention.autoCleanupEnabled !== 'boolean') {
      violations.push({ code: 'REGISTRY_TYPE_INVALID', at, field: 'retention.autoCleanupEnabled', expected: 'boolean' });
    }
    const unconfirmed = RECOVERY_FIELDS.filter(
      (key) => !isNonBlankString(retention[key]) || retention[key].trim() === 'UNVERIFIED',
    );
    if (retention.autoCleanupEnabled === true && unconfirmed.length > 0) {
      violations.push({ code: 'AUTO_CLEANUP_WITHOUT_CONFIRMED_RECOVERY', at, unconfirmed });
    }
  }

  violations.push(...scanForForbiddenValues(registry));
  return violations;
}

function resolveLockPath(resource) {
  if (!isNonBlankString(resource.lockRef) || path.isAbsolute(resource.lockRef)) throw new Error('lockRef must be project-relative');
  const root = fs.realpathSync(repoRoot);
  const candidate = path.resolve(root, resource.lockRef);
  // Resolve an existing ancestor too: an absent child beneath a symlink must
  // not hide an escape, and dangling symlinks cannot establish containment.
  let ancestor = candidate;
  const missing = [];
  for (;;) {
    try { fs.lstatSync(ancestor); break; } catch (error) {
      if (error.code !== 'ENOENT' || path.dirname(ancestor) === ancestor) throw error;
      missing.unshift(path.basename(ancestor));
      ancestor = path.dirname(ancestor);
    }
  }
  const target = path.join(fs.realpathSync(ancestor), ...missing);
  const relative = path.relative(root, target);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('lockRef escapes the project');
  return target;
}

function readLock(resource) {
  let lockPath;
  try {
    lockPath = resolveLockPath(resource);
    const bytes = fs.readFileSync(lockPath);
    return { lockPath, lock: parseJson(bytes.toString('utf8')), lockSha256: crypto.createHash('sha256').update(bytes).digest('hex') };
  } catch (error) {
    return { lockPath, lock: null, lockError: `${error.code ?? 'ERROR'}: ${error.message}` };
  }
}

function observeRuntime(resource) {
  const npmRun = spawnSync('npm', ['--version'], { encoding: 'utf8', timeout: 15_000 });
  const dockerRun = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf8', timeout: 8_000 });
  const runtime = {
    host: `${process.platform}/${process.arch}`,
    node: process.version,
    npm: npmRun.status === 0 ? npmRun.stdout.trim() : `UNAVAILABLE: ${processFailure(npmRun, 'npm')}`,
    containerDaemon:
      dockerRun.status === 0
        ? { observed: true, serverVersion: dockerRun.stdout.trim() }
        : { observed: false, reason: processFailure(dockerRun, 'docker') },
  };
  const requirement = resource?.runtimeRequirement?.node;
  if (requirement) {
    runtime.nodeRequirement = requirement;
    runtime.nodeRequirementSatisfied = nodeSatisfies(runtime.node, requirement);
  }
  return runtime;
}

function nodeSatisfies(version, range) {
  const value = version.replace(/^v/, '').split('.').map(Number);
  return range.split('||').some((alternative) => {
    const spec = alternative.trim();
    if (spec.startsWith('^')) {
      const [major, minor, patch] = spec.slice(1).split('.').map(Number);
      return value[0] === major && (value[1] > minor || (value[1] === minor && value[2] >= (patch ?? 0)));
    }
    if (spec.startsWith('>=')) {
      const required = spec.slice(2).split('.').map(Number);
      for (let i = 0; i < 3; i++) {
        const need = required[i] ?? 0;
        if (value[i] > need) return true;
        if (value[i] < need) return false;
      }
      return true;
    }
    const exact = spec.split('.').map(Number);
    return exact.every((part, i) => value[i] === part);
  });
}

function tarListsDirectory(archiveFile, directory) {
  const run = spawnSync('tar', ['-tzf', archiveFile], { encoding: 'utf8', timeout: 60_000, maxBuffer: 256 * 1024 * 1024 });
  if (run.status !== 0) return { ok: false, reason: processFailure(run, 'tar') };
  return { ok: run.stdout.split('\n').some((line) => line.startsWith(`${directory}/`)) };
}

function prepareEvidenceInputs(opts, resource) {
  const prepared = { violations: [], lock: readLock(resource) };
  const add = (at, expected) => prepared.violations.push({ code: 'EVIDENCE_INPUT_INVALID', at, expected });
  if (!prepared.lock.lockError) {
    const lock = prepared.lock.lock;
    if (!isPlainObject(lock)) add('lock', 'object');
    else {
      if (Object.hasOwn(lock, 'schemaVersion') && lock.schemaVersion !== 1) add('lock.schemaVersion', 'version 1');
      for (const [section, fields] of [['source', ['commit', 'sha256', 'directory', 'url']], ['package', ['name', 'version', 'integrity']]]) {
        if (!Object.hasOwn(lock, section)) continue;
        if (!isPlainObject(lock[section])) add(`lock.${section}`, 'object');
        else {
          for (const field of fields) {
            if (Object.hasOwn(lock[section], field) && !isNonBlankString(lock[section][field])) add(`lock.${section}.${field}`, 'non-blank string');
          }
          if (section === 'source' && Object.hasOwn(lock.source, 'bytes') && !isPositiveSafeInteger(lock.source.bytes)) add('lock.source.bytes', 'positive safe integer');
        }
      }
    }
  }
  for (const key of ['archive', 'npm-metadata']) {
    if (!opts[key]) continue;
    if (!fs.statSync(opts[key]).isFile()) throw Object.assign(new Error('qualification evidence must be a file'), { code: 'EVIDENCE_NOT_FILE' });
    const bytes = fs.readFileSync(opts[key]);
    const digest = crypto.createHash('sha256').update(bytes).digest('hex');
    if (key === 'archive') {
      prepared.archiveSha256 = digest;
      prepared.archiveBytes = bytes.length;
    } else {
      prepared.npmMetadata = parseJson(bytes.toString('utf8'));
      prepared.npmMetadataSha256 = digest;
      if (!isPlainObject(prepared.npmMetadata)) prepared.violations.push({ code: 'EVIDENCE_INPUT_INVALID', at: 'npm-metadata', expected: 'object' });
      else {
        for (const field of ['version', 'integrity', 'dist.integrity', 'license']) {
          if (Object.hasOwn(prepared.npmMetadata, field) && !isNonBlankString(prepared.npmMetadata[field])) prepared.violations.push({ code: 'EVIDENCE_INPUT_INVALID', at: `npm-metadata.${field}`, expected: 'non-blank string' });
        }
      }
    }
  }
  return prepared;
}

function qualifyResource(registry, resource, policy, options) {
  const categories = Object.fromEntries((policy?.evidenceCategories ?? []).map((key) => [key, UNVERIFIED('not evaluated')]));
  const inputs = {
    registrySha256: sha256File(options.registryFile),
    refsSha256: sha256File(options.refsFile),
    policySha256: sha256File(options.policyFile),
  };
  const { lock, lockError, lockSha256 } = options.prepared.lock;
  if (!lock) {
    for (const key of ['source-commit', 'source-digest', 'artifact-size']) {
      categories[key] = UNVERIFIED(`lockRef unreadable: ${lockError}`);
    }
  } else {
    inputs.lockSha256 = lockSha256;
    const commit = lock?.source?.commit;
    const directory = lock?.source?.directory;
    categories['source-commit'] =
      typeof commit === 'string' && /^[0-9a-f]{40}$/.test(commit)
        ? RECORDED(`commit ${commit} recorded in lock; independently confirmed only with an archive listing`)
        : UNVERIFIED('lock has no 40-hex source commit');

    if (!options.archiveFile) {
      categories['source-digest'] = typeof lock?.source?.sha256 === 'string' && /^[0-9a-f]{64}$/.test(lock.source.sha256)
        ? RECORDED('digest recorded in lock only; pass --archive to recompute')
        : UNVERIFIED('lock has no source digest to recompute');
      categories['artifact-size'] = isPositiveSafeInteger(lock?.source?.bytes)
        ? RECORDED('size recorded in lock only; pass --archive to recompute')
        : UNVERIFIED('lock has no source artifact size');
    } else {
      inputs.archiveSha256 = options.prepared.archiveSha256;
      inputs.archiveBytes = options.prepared.archiveBytes;
      const expectedSha = lock?.source?.sha256;
      const expectedBytes = lock?.source?.bytes;
      if (inputs.archiveSha256 === expectedSha) {
        categories['source-digest'] = {
          status: 'VERIFIED',
          observed: inputs.archiveSha256,
          expected: expectedSha,
          bytes: inputs.archiveBytes,
        };
      } else {
        categories['source-digest'] = {
          status: 'MISMATCH',
          observed: inputs.archiveSha256,
          expected: expectedSha,
          reason: 'recomputed archive digest does not match the lock',
        };
      }
      categories['artifact-size'] =
        inputs.archiveBytes === expectedBytes
          ? { status: 'VERIFIED', observed: inputs.archiveBytes, expected: expectedBytes }
          : { status: 'MISMATCH', observed: inputs.archiveBytes, expected: expectedBytes };

      if (categories['source-commit'].status === 'RECORDED' && typeof directory === 'string') {
        const listing = tarListsDirectory(options.archiveFile, directory);
        categories['source-commit'] = listing.ok
          ? { status: 'VERIFIED', commit, archiveDirectory: directory }
          : UNVERIFIED(`archive listing unavailable or missing ${directory}/: ${listing.reason ?? 'directory not found'}`);
      }
    }
  }

  if (options.npmMetadataFile) {
    inputs.npmMetadataSha256 = options.prepared.npmMetadataSha256;
    const metadata = options.prepared.npmMetadata;
    const integrity = metadata.integrity ?? metadata['dist.integrity'];
    const matchesLock = lock && isNonBlankString(metadata.version) && isNonBlankString(integrity)
      && metadata.version === lock?.package?.version && integrity === lock?.package?.integrity
      && isNonBlankString(metadata.license);
    categories.license = matchesLock
      ? { status: 'VERIFIED', license: metadata.license, boundTo: 'package version + integrity match the lock' }
      : UNVERIFIED('npm metadata does not bind to the locked package (version/integrity/license)');
  } else {
    categories.license = UNVERIFIED('no license readback supplied (pass --npm-metadata); recorded sources carry no license field');
  }

  categories['image-digest'] = resource?.image
    ? UNVERIFIED('image digest recorded but not independently verified against a registry; docker evidence required before up')
    : UNVERIFIED('no image lock registered for this resource; an exact digest must be pinned before up');

  const dockerNote = options.runtime?.containerDaemon?.observed
    ? `container daemon ${options.runtime.containerDaemon.serverVersion} reachable`
    : `container daemon unreachable: ${options.runtime?.containerDaemon?.reason ?? 'unknown'}`;
  categories.platform = UNVERIFIED(
    `image/platform not independently verified for this resource; ${dockerNote}; host runtime is recorded in receipt.runtime`,
  );
  categories['health-api'] = UNVERIFIED('no qualified live health API evidence supplied; process health alone does not grant resource readiness');
  categories['backup-compatibility'] = UNVERIFIED('no restore drill evidence registered; backup compatibility unproven');

  const categoryValues = Object.values(categories);
  const ready = categoryValues.every((category) => category.status === 'VERIFIED');
  return {
    interface: 'Qualification.v1',
    resource: resource.id,
    lockRef: resource.lockRef,
    ready,
    unverifiedCount: categoryValues.filter((category) => category.status === 'UNVERIFIED').length,
    categories,
    runtime: options.runtime,
    inputs,
  };
}

// ---- readback --kind github（V_INFRA_I01 身份收敛）--------------------------------
// 目标必须来自 registry 输入（默认 committed registry 或 --registry），不允许硬编码项目；
// 登记身份必须自洽（repoId/principalId 为正安全整数、repoFullname 的 owner 段 === github.owner），
// 否则按输入无效（exit 1）在任何 gh 调用之前拒绝。VERIFIED 只在 (a) repo 读回形如 repo
// 且 repoId/fullname/owner 与登记一致、(b) gh api user 的实际认证主体 id/login 与登记
// principalId/owner 一致时给出。gh 响应体不是非数组 JSON 对象（null/数组/标量）时一律
// 结构化 UNVERIFIED（exit 2），绝不在响应体上崩溃。公开仓库可读 ≠ caller/owner 认证；
// readback 只确认身份事实，绝不授予发布/CI 变更等业务授权。

const REPO_FULLNAME_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]+$/;
const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const isGithubErrorEnvelope = (body) => isPlainObject(body) && typeof body.message === 'string' && typeof body.documentation_url === 'string';
const isPositiveSafeInteger = (value) => Number.isSafeInteger(value) && value > 0;
const describeJsonPayload = (value) => (value === null ? 'null' : Array.isArray(value) ? 'array' : `${typeof value} ${JSON.stringify(value)}`);

function registeredGithubIdentity(registry) {
  const github = registry?.project?.github;
  const problems = [];
  if (!isPlainObject(github)) {
    problems.push('project.github object is missing');
  } else {
    if (!isPositiveSafeInteger(github.repoId)) problems.push('project.github.repoId must be a positive safe integer');
    if (typeof github.repoFullname !== 'string' || !REPO_FULLNAME_RE.test(github.repoFullname)) {
      problems.push('project.github.repoFullname must be an owner/repo string');
    }
    if (!isPositiveSafeInteger(github.principalId)) problems.push('project.github.principalId must be a positive safe integer');
    if (typeof github.owner !== 'string' || github.owner.length === 0) problems.push('project.github.owner must be a non-empty string');
    // 身份内部必须自洽：repoFullname 的 owner 段必须就是登记的 github.owner（精确匹配）。
    if (
      typeof github.repoFullname === 'string' &&
      REPO_FULLNAME_RE.test(github.repoFullname) &&
      typeof github.owner === 'string' &&
      github.owner.length > 0 &&
      github.repoFullname.split('/')[0] !== github.owner
    ) {
      problems.push(
        `project.github.repoFullname owner segment must equal project.github.owner (observed ${github.repoFullname.split('/')[0]}, registered owner ${github.owner})`,
      );
    }
  }
  return { github, problems };
}

// 一次 gh api JSON 读回：非零退出/错误信封/非 JSON 一律显式 UNVERIFIED，绝不降级为 VERIFIED。
function observeGhJson(argv) {
  const via = `gh ${argv.join(' ')}`;
  const run = spawnSync('gh', argv, { encoding: 'utf8', timeout: 15_000 });
  if (run.error) {
    return { status: 'UNVERIFIED', via, reason: `gh unavailable: ${redactHostPaths(run.error.message)}` };
  }
  if (run.status !== 0) {
    return { status: 'UNVERIFIED', via, reason: processFailure(run, 'gh') };
  }
  let body;
  try {
    body = JSON.parse(run.stdout);
  } catch {
    return { status: 'UNVERIFIED', via, reason: 'gh output was not JSON' };
  }
  if (isGithubErrorEnvelope(body)) {
    return { status: 'UNVERIFIED', via, reason: `gh returned an error envelope: ${body.message}` };
  }
  return { status: 'OK', via, body };
}

function describeMismatches(mismatches) {
  return mismatches.map((m) => `${m.field} expected ${JSON.stringify(m.expected)}, observed ${JSON.stringify(m.observed)}`).join('; ');
}

function observeRepoReadback(identity) {
  const target = `repos/${identity.repoFullname}`;
  const observed = observeGhJson(['api', target]);
  if (observed.status !== 'OK') return observed;
  const body = observed.body;
  if (!isPlainObject(body)) {
    return {
      status: 'UNVERIFIED',
      via: observed.via,
      reason: `gh api response is not a repository object (not a JSON object: ${describeJsonPayload(body)})`,
    };
  }
  const missing = [];
  if (!Number.isInteger(body.id)) missing.push('id');
  if (typeof body.full_name !== 'string') missing.push('full_name');
  if (!isPlainObject(body.owner) || typeof body.owner.login !== 'string') missing.push('owner.login');
  if (missing.length > 0) {
    return { status: 'UNVERIFIED', via: observed.via, reason: `gh api response is not a repository object (missing ${missing.join(', ')})` };
  }
  const mismatches = [];
  if (body.id !== identity.repoId) mismatches.push({ field: 'repoId', expected: identity.repoId, observed: body.id });
  if (body.full_name !== identity.repoFullname) mismatches.push({ field: 'repoFullname', expected: identity.repoFullname, observed: body.full_name });
  if (body.owner.login !== identity.owner) mismatches.push({ field: 'owner', expected: identity.owner, observed: body.owner.login });
  if (mismatches.length > 0) {
    return {
      status: 'MISMATCH',
      via: observed.via,
      mismatches,
      reason: `gh api ${target} answered for a different repository than the registered identity (${describeMismatches(mismatches)})`,
    };
  }
  return {
    status: 'VERIFIED',
    via: observed.via,
    repoId: body.id,
    repoFullname: body.full_name,
    owner: body.owner.login,
    ...(typeof body.default_branch === 'string' ? { defaultBranch: body.default_branch } : {}),
  };
}

function observeCallerReadback(identity) {
  const observed = observeGhJson(['api', 'user']);
  if (observed.status !== 'OK') return observed;
  const body = observed.body;
  if (!isPlainObject(body)) {
    return {
      status: 'UNVERIFIED',
      via: observed.via,
      reason: `gh api user response is not an authenticated user object (not a JSON object: ${describeJsonPayload(body)})`,
    };
  }
  const missing = [];
  if (!Number.isInteger(body.id)) missing.push('id');
  if (typeof body.login !== 'string' || body.login.length === 0) missing.push('login');
  if (missing.length > 0) {
    return { status: 'UNVERIFIED', via: observed.via, reason: `gh api user response is not an authenticated user object (missing ${missing.join(', ')})` };
  }
  const mismatches = [];
  if (body.id !== identity.principalId) mismatches.push({ field: 'principalId', expected: identity.principalId, observed: body.id });
  if (body.login !== identity.owner) mismatches.push({ field: 'ownerLogin', expected: identity.owner, observed: body.login });
  if (mismatches.length > 0) {
    return {
      status: 'MISMATCH',
      via: observed.via,
      mismatches,
      reason: `authenticated caller is not the registered principal (${describeMismatches(mismatches)}); a publicly readable repository is not caller/owner authentication`,
    };
  }
  return { status: 'VERIFIED', via: observed.via, principalId: body.id, login: body.login };
}

function runGithubReadback(registryFile) {
  let registry;
  try {
    registry = readJson(registryFile);
  } catch (err) {
    return failInput(`registry unreadable: ${redactHostPaths(err.message)}`);
  }
  const { github: identity, problems } = registeredGithubIdentity(registry);
  if (problems.length > 0) {
    return failInput(`github readback: registered identity invalid (${problems.join('; ')}) — refusing before any gh call`);
  }
  const repoReadback = observeRepoReadback(identity);
  const callerReadback = observeCallerReadback(identity);
  const status =
    repoReadback.status === 'VERIFIED' && callerReadback.status === 'VERIFIED'
      ? 'VERIFIED'
      : repoReadback.status === 'MISMATCH' || callerReadback.status === 'MISMATCH'
        ? 'MISMATCH'
        : 'UNVERIFIED';
  const failureDetail = [repoReadback, callerReadback]
    .filter((part) => part.status !== 'VERIFIED')
    .map((part) => `${part.status}: ${part.reason}`)
    .join(' | ');
  print({
    interface: 'Registry.v1',
    command: 'readback',
    kind: 'github',
    registry: displayPath(registryFile),
    registeredIdentity: {
      repoFullname: identity.repoFullname,
      repoId: identity.repoId,
      owner: identity.owner,
      principalId: identity.principalId,
    },
    repoReadback,
    callerReadback,
    status,
    ...(failureDetail ? { error: failureDetail } : {}),
    grants: {
      publication: 'NOT_CLAIMED',
      ciMutation: 'NOT_CLAIMED',
      qualification: 'SEPARATE_GATE',
      note: 'identity readback verifies repository identity and the authenticated caller only; it grants no publication, CI mutation, push or other business authorization',
    },
  });
  return status === 'VERIFIED' ? EXIT_PASS : EXIT_VERIFY;
}

function main(argv) {
  const { command, opts, error } = parseArgs(argv);
  if (error) return failInput(error);
  if (!command) return failInput('missing command');

  if (command === 'readback') {
    if (opts.kind !== 'github') return failInput('readback supports --kind github only');
    return runGithubReadback(opts.registry ?? DEFAULT_REGISTRY);
  }

  const registryFile = opts.registry ?? DEFAULT_REGISTRY;
  let registry;
  try {
    registry = readJson(registryFile);
  } catch (err) {
    return failInput(`registry unreadable: ${redactHostPaths(err.message)}`);
  }
  // 门禁必须 fail-closed：refs 目录与 policy 文件缺失 = 前置无效，绝不静默降级为空规则。
  const refsFile = opts.refs ?? path.join(repoRoot, 'infra', 'delivery', 'secrets.refs.example.json');
  const policyFile = opts.policy ?? path.join(repoRoot, 'infra', 'delivery', 'qualification-policy.json');
  let refsDoc;
  let policy;
  try {
    refsDoc = readJson(refsFile);
  } catch (err) {
    return failInput(`refs catalog unreadable (${displayPath(refsFile)}): ${redactHostPaths(err.message)}`);
  }
  try {
    policy = readJson(policyFile);
  } catch (err) {
    return failInput(`qualification policy unreadable (${displayPath(policyFile)}): ${redactHostPaths(err.message)}`);
  }

  if (command === 'validate') {
    const violations = validateRegistry(registry, refsDoc, policy);
    print({ interface: 'Registry.v1', registry: displayPath(registryFile), refs: displayPath(refsFile), ok: violations.length === 0, violations });
    return violations.length === 0 ? EXIT_PASS : EXIT_VERIFY;
  }

  if (['status', 'qualify', 'up'].includes(command)) {
    const violations = validateRegistry(registry, refsDoc, policy);
    if (violations.length > 0) {
      print({ interface: 'Registry.v1', command, ready: false, refused: true, violations });
      return EXIT_VERIFY;
    }
  }

  if (command === 'status') {
    const project = registry.project ?? {};
    const resources = (registry.resources ?? []).map((resource) => {
      const { lockPath } = readLock(resource);
      let lockPresent = false;
      try {
        lockPresent = fs.existsSync(lockPath);
      } catch {
        lockPresent = false;
      }
      return {
        id: resource.id,
        kind: resource.kind,
        owner: resource.owner,
        credentialRef: resource.credentialRef,
        lockRef: resource.lockRef,
        lockPresent,
        retention: {
          autoCleanupEnabled: resource.retention?.autoCleanupEnabled === true,
          unconfirmedFields: RECOVERY_FIELDS.filter(
            (key) => !isNonBlankString(resource.retention?.[key]) || resource.retention[key].trim() === 'UNVERIFIED',
          ),
        },
      };
    });
    print({
      interface: 'Registry.v1',
      registry: displayPath(registryFile),
      project: { id: project.id, owner: project.owner, authorityReadback: project.authority?.readbackStatus ?? 'UNRECORDED' },
      resources,
    });
    return EXIT_PASS;
  }

  if (command === 'qualify' || command === 'up') {
    const resource = (registry.resources ?? []).find((item) => item.id === opts.resource);
    if (!resource) return failInput(`unknown resource: ${opts.resource}`);
    let prepared;
    try { prepared = prepareEvidenceInputs(opts, resource); } catch (error) {
      if (!['ENOENT', 'EACCES', 'EPERM', 'EISDIR', 'ENOTDIR', 'ELOOP', 'INVALID_JSON', 'EVIDENCE_NOT_FILE'].includes(error.code)) throw error;
      return failInput(`qualification input unreadable: ${error.code}`);
    }
    if (prepared.violations.length) {
      print({ interface: 'Registry.v1', command, ready: false, refused: true, violations: prepared.violations });
      return EXIT_VERIFY;
    }
    const runtime = observeRuntime(resource);
    const receipt = qualifyResource(registry, resource, policy, {
      registryFile,
      refsFile,
      policyFile,
      archiveFile: opts.archive,
      npmMetadataFile: opts['npm-metadata'],
      runtime,
      prepared,
    });
    if (command === 'qualify') {
      print(receipt);
      return receipt.ready ? EXIT_PASS : EXIT_VERIFY;
    }
    if (!receipt.ready) {
      print({
        interface: 'Qualification.v1',
        resource: resource.id,
        refused: true,
        ready: false,
        error: `UP_REFUSED_QUALIFICATION_NOT_READY: ${receipt.unverifiedCount} evidence categories are not VERIFIED`,
        unverified: Object.entries(receipt.categories)
          .filter(([, category]) => category.status !== 'VERIFIED')
          .map(([key, category]) => ({ category: key, status: category.status })),
        receipt,
      });
      return EXIT_VERIFY;
    }
    print({
      interface: 'Qualification.v1',
      resource: resource.id,
      refused: true,
      ready: true,
      error: `UP_NOT_AUTHORIZED: ${policy?.upGate?.refusalReason ?? 'up is not authorized in this task'}`,
    });
    return EXIT_VERIFY;
  }

  return failInput(`unknown command: ${command}`);
}

process.exit(main(process.argv.slice(2)));

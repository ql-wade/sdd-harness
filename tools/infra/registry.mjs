#!/usr/bin/env node
// Registry.v1 / Qualification.v1 CLI — validate | qualify | status | up | readback
//
// 只登记与验收：不启动任何服务、不持有阶段/DAG/业务重试、不改活配置（hooks/MCP 由对应 P 任务串行接纳）。
// 秘密值永不读写；credentialRef 只是 SecretRef.v1 引用，解析由 tools/infra/secret-refs.mjs 只读完成。
//
// 退出码契约（execution-contract.json V_INFRA_I01.cli_contract）：
//   0 = PASS（validate 通过 / qualify ready / readback 读回成功）
//   1 = 输入或前置无效（未知资源、文件缺失/不可解析、参数错误）
//   2 = 验证失败（语义违规、qualification NOT_READY/UNVERIFIED/MISMATCH、up 被门禁拒绝、读回失败）
//   环境缺失必须显式 UNVERIFIED 并以非零退出，不允许 skip 转 PASS。

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseSecretRef, scanForForbiddenValues, validateRefsCatalog } from './secret-refs.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const EXIT_PASS = 0;
const EXIT_INPUT = 1;
const EXIT_VERIFY = 2;
const DEFAULT_REGISTRY = path.join(repoRoot, 'infra', 'delivery', 'registry.json');

const sha256File = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

// 宿主私有路径绝不进入结构化回执/报告；对外输出统一脱敏（与 secret-refs 的 ABSOLUTE_PATH_FORBIDDEN 同源规则）。
const HOST_PATH_REDACTION = /(^|[\s"'=(:/])\/(Users|home|root|private|var|usr|etc|opt|tmp)\/\S*/g;
const redactHostPaths = (text) => String(text ?? '').replace(HOST_PATH_REDACTION, '$1<host-path-redacted>');

function usage() {
  return [
    'usage:',
    '  registry.mjs validate --registry <file> [--refs <file>] [--policy <file>]',
    '  registry.mjs qualify  --resource <id> --registry <file> [--archive <file>] [--npm-metadata <file>]',
    '  registry.mjs status   --registry <file>',
    '  registry.mjs up       --resource <id> --registry <file>',
    '  registry.mjs readback --kind github',
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

const UNVERIFIED = (reason) => ({ status: 'UNVERIFIED', reason });
const RECORDED = (reason) => ({ status: 'RECORDED', reason });

function validateRegistry(registry, refsDoc, policy) {
  const violations = [];
  const projectId = registry?.project?.id;
  if (registry?.interface !== 'Registry.v1') {
    violations.push({ code: 'REGISTRY_INTERFACE_INVALID', reason: 'interface must be Registry.v1' });
  }
  if (!projectId) violations.push({ code: 'PROJECT_ID_MISSING' });

  const knownOwners = new Set([registry?.project?.owner, ...(registry?.project?.delegates ?? [])].filter(Boolean));
  for (const [index, resource] of (registry?.resources ?? []).entries()) {
    const at = `resources[${index}]:${resource?.id ?? '?'}`;
    for (const field of ['id', 'kind', 'owner', 'purpose', 'credentialRef', 'lockRef', 'domain', 'retention']) {
      if (resource?.[field] === undefined) violations.push({ code: 'REGISTRY_FIELD_MISSING', at, field });
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
      } else if (refsDoc && !(refsDoc.refs ?? []).some((item) => item.ref === resource.credentialRef)) {
        violations.push({ code: 'REF_NOT_REGISTERED', at, ref: resource.credentialRef });
      }
    }

    const image = resource?.image;
    if (image) {
      const reference = typeof image.reference === 'string' ? image.reference : '';
      if (policy?.imageReference?.floatingTagsForbidden && /:latest\s*$/.test(reference)) {
        violations.push({ code: 'FLOATING_TAG_FORBIDDEN', at, reference });
      }
      if (policy?.imageReference?.digestPinnedRequired && !image.digest) {
        violations.push({ code: 'IMAGE_NOT_DIGEST_PINNED', at, reference });
      }
      if (image.digest && !(new RegExp(policy?.imageReference?.digestFormat ?? '^sha256:[0-9a-f]{64}$')).test(image.digest)) {
        violations.push({ code: 'DIGEST_FORMAT_INVALID', at, digest: image.digest });
      }
    }

    const retention = resource?.retention ?? {};
    const unconfirmed = ['rpo', 'rto', 'retentionPeriod', 'encryptionOwner'].filter(
      (key) => !retention[key] || retention[key] === 'UNVERIFIED',
    );
    if (retention.autoCleanupEnabled === true && unconfirmed.length > 0) {
      violations.push({ code: 'AUTO_CLEANUP_WITHOUT_CONFIRMED_RECOVERY', at, unconfirmed });
    }
  }

  if (refsDoc) violations.push(...validateRefsCatalog(refsDoc, projectId, { roles: policy?.roles }));
  violations.push(...scanForForbiddenValues(registry));
  return violations;
}

function readLock(resource) {
  const lockPath = path.resolve(repoRoot, resource.lockRef);
  try {
    return { lockPath, lock: readJson(lockPath) };
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
    npm: npmRun.status === 0 ? npmRun.stdout.trim() : `UNAVAILABLE: ${redactHostPaths(npmRun.stderr.trim().split('\n')[0] ?? '')}`,
    containerDaemon:
      dockerRun.status === 0
        ? { observed: true, serverVersion: dockerRun.stdout.trim() }
        : { observed: false, reason: redactHostPaths(dockerRun.stderr.trim().split('\n')[0]) || `docker exited ${dockerRun.status}` },
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
  if (run.status !== 0) return { ok: false, reason: run.stderr.trim().split('\n')[0] || `tar exited ${run.status}` };
  return { ok: run.stdout.split('\n').some((line) => line.startsWith(`${directory}/`)) };
}

function qualifyResource(registry, resource, policy, options) {
  const categories = Object.fromEntries((policy?.evidenceCategories ?? []).map((key) => [key, UNVERIFIED('not evaluated')]));
  const inputs = { registrySha256: sha256File(options.registryFile) };
  const { lock, lockError } = readLock(resource);
  if (!lock) {
    for (const key of ['source-commit', 'source-digest', 'artifact-size']) {
      categories[key] = UNVERIFIED(`lockRef unreadable: ${lockError}`);
    }
  } else {
    inputs.lockSha256 = sha256File(path.resolve(repoRoot, resource.lockRef));
    const commit = lock?.source?.commit;
    const directory = lock?.source?.directory;
    categories['source-commit'] =
      typeof commit === 'string' && /^[0-9a-f]{40}$/.test(commit)
        ? RECORDED(`commit ${commit} recorded in lock; independently confirmed only with an archive listing`)
        : UNVERIFIED('lock has no 40-hex source commit');

    if (!options.archiveFile) {
      categories['source-digest'] = RECORDED('digest recorded in lock only; pass --archive to recompute');
      categories['artifact-size'] = RECORDED('size recorded in lock only; pass --archive to recompute');
    } else {
      inputs.archiveSha256 = sha256File(options.archiveFile);
      inputs.archiveBytes = fs.statSync(options.archiveFile).size;
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
    inputs.npmMetadataSha256 = sha256File(options.npmMetadataFile);
    try {
      const metadata = readJson(options.npmMetadataFile);
      const matchesLock =
        lock &&
        metadata.version === lock?.package?.version &&
        (metadata.integrity ?? metadata['dist.integrity']) === lock?.package?.integrity &&
        typeof metadata.license === 'string' &&
        metadata.license.length > 0;
      categories.license = matchesLock
        ? { status: 'VERIFIED', license: metadata.license, boundTo: 'package version + integrity match the lock' }
        : UNVERIFIED('npm metadata does not bind to the locked package (version/integrity/license)');
    } catch (error) {
      categories.license = UNVERIFIED(`npm metadata unreadable: ${error.message}`);
    }
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
    `no pinned image/platform to verify for this resource; ${dockerNote}; host runtime is recorded in receipt.runtime`,
  );
  categories['health-api'] = UNVERIFIED('no running service; health API evidence requires the component up and must exist before up');
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

function main(argv) {
  const { command, opts, error } = parseArgs(argv);
  if (error) return failInput(error);
  if (!command) return failInput('missing command');

  if (command === 'readback') {
    if (opts.kind !== 'github') return failInput('readback supports --kind github only');
    const run = spawnSync('gh', ['api', 'repos/rpamis/sdd-harness'], { encoding: 'utf8', timeout: 15_000 });
    if (run.status === 0) {
      try {
        const repo = JSON.parse(run.stdout);
        print({ interface: 'Registry.v1', kind: 'github', status: 'VERIFIED', repoId: repo.id, fullName: repo.full_name, command: 'gh api repos/rpamis/sdd-harness' });
        return EXIT_PASS;
      } catch {
        print({ interface: 'Registry.v1', kind: 'github', status: 'UNVERIFIED', error: 'gh output was not JSON', command: 'gh api repos/rpamis/sdd-harness' });
        return EXIT_VERIFY;
      }
    }
    print({
      interface: 'Registry.v1',
      kind: 'github',
      status: 'UNVERIFIED',
      command: 'gh api repos/rpamis/sdd-harness',
      error: (run.stderr.trim() || run.stdout.trim() || `gh exited ${run.status}`).split('\n')[0],
    });
    return EXIT_VERIFY;
  }

  const registryFile = opts.registry ?? DEFAULT_REGISTRY;
  let registry;
  try {
    registry = readJson(registryFile);
  } catch (err) {
    return failInput(`registry unreadable: ${err.message}`);
  }
  // 门禁必须 fail-closed：refs 目录与 policy 文件缺失 = 前置无效，绝不静默降级为空规则。
  const refsFile = opts.refs ?? path.join(repoRoot, 'infra', 'delivery', 'secrets.refs.example.json');
  const policyFile = opts.policy ?? path.join(repoRoot, 'infra', 'delivery', 'qualification-policy.json');
  let refsDoc;
  let policy;
  try {
    refsDoc = readJson(refsFile);
  } catch (err) {
    return failInput(`refs catalog unreadable (${refsFile}): ${err.message}`);
  }
  try {
    policy = readJson(policyFile);
  } catch (err) {
    return failInput(`qualification policy unreadable (${policyFile}): ${err.message}`);
  }

  if (command === 'validate') {
    const violations = validateRegistry(registry, refsDoc, policy);
    print({ interface: 'Registry.v1', registry: registryFile, refs: refsFile, ok: violations.length === 0, violations });
    return violations.length === 0 ? EXIT_PASS : EXIT_VERIFY;
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
          unconfirmedFields: ['rpo', 'rto', 'retentionPeriod', 'encryptionOwner'].filter(
            (key) => !resource.retention?.[key] || resource.retention[key] === 'UNVERIFIED',
          ),
        },
      };
    });
    print({
      interface: 'Registry.v1',
      registry: registryFile,
      project: { id: project.id, owner: project.owner, authorityReadback: project.authority?.readbackStatus ?? 'UNRECORDED' },
      resources,
    });
    return EXIT_PASS;
  }

  if (command === 'qualify' || command === 'up') {
    const resource = (registry.resources ?? []).find((item) => item.id === opts.resource);
    if (!resource) return failInput(`unknown resource: ${opts.resource}`);
    const runtime = observeRuntime(resource);
    const receipt = qualifyResource(registry, resource, policy, {
      registryFile,
      archiveFile: opts.archive,
      npmMetadataFile: opts['npm-metadata'],
      runtime,
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

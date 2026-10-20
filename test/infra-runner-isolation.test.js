import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// V_INFRA_I02 — I02 固定Comet Runner及真实OS/container角色隔离 的契约检查。
// 规格：infrastructure-tasks.json 的 I02 条目 + infrastructure-plan.md I02 小节。
//
//   RunnerInfra.v1    validate|qualify|up|probe|stop -> process/mount/principal observations only；
//                     本环境无 container daemon（EPERM）、无真实 Runner 运行时，up/qualify/probe/stop
//                     必须结构化拒绝（退出 2 + UNVERIFIED + 确切原因），绝不 mock 转绿、绝不 skip。
//   RoleBoundary.v1   controller/author/test-author/reviewer/publisher/isolator 六角色：不可变工具镜像、
//                     独立 principal/mount/凭据作用域；worker 无控制状态（.comet 状态/锁/回执/签发）写权。
//   Authority.v1      唯一固定 Comet authority + workspace；复制 state / 并发写者 / 同 authority 第二登记
//                     在结构上一律拒绝。
//
// CLI 退出码契约（execution-contract.json V_INFRA_I02.cli_contract）：
//   0=PASS，1=输入/前置无效（文件缺失/不可解析/参数错误），2=验证失败（语义违规、qualify NOT_READY、up 被拒、UNVERIFIED）。
//
// 负例 fixture 全部在 os.tmpdir() 生成，不向活配置写入任何状态。
// 约束：本宿主无 docker daemon，镜像从未构建，严禁虚构 tag/digest——所有镜像探针值只存在于 tmp fixture，绝不写入仓库。

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '..');
const runnerDir = path.join(repoRoot, 'infra', 'delivery', 'runner');
const registryPath = path.join(repoRoot, 'infra', 'delivery', 'registry.json');
const refsPath = path.join(repoRoot, 'infra', 'delivery', 'secrets.refs.example.json');
const cliPath = path.join(repoRoot, 'tools', 'infra', 'runner.mjs');
const secretRefsModuleUrl = new URL('../tools/infra/secret-refs.mjs', import.meta.url);

const RUN_TIMEOUT_MS = 60_000;
const DOMAIN_FILES = [
  'compose.yaml',
  'Dockerfile',
  'image.lock.json',
  'role-policy.json',
  'workspace-mounts.json',
  'authority-registration.example.json',
];
const RUNNER_ROLES = ['controller', 'author', 'test-author', 'reviewer', 'publisher', 'isolator'];
const RUNNER_REFS = [
  'secret-ref:sdd-harness-pilot/runner-authority',
  'secret-ref:sdd-harness-pilot/worker-author-api',
  'secret-ref:sdd-harness-pilot/worker-review-api',
  'secret-ref:sdd-harness-pilot/runner-source-read',
];
const HOST_PATH_OUTPUT_RE = /\/(Users|home|root|private|var|usr|etc|opt|tmp)\//;

function runCli(args) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: RUN_TIMEOUT_MS,
  });
}

function parseJsonOut(result, label) {
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new AssertionError(`${label}: stdout is not JSON: ${result.stdout}\nstderr: ${result.stderr}`);
  }
}

function readDomainFile(name) {
  return fs.readFileSync(path.join(runnerDir, name), 'utf8');
}

function readDomainJson(name) {
  return JSON.parse(readDomainFile(name));
}

// 把已提交的 runner 域整体拷到 tmp fixture，应用 mutate({dir, read, write, json, writeJson}) 后返回 fixture 目录。
function makeFixtureDir(mutate) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'infra-i02-'));
  for (const name of DOMAIN_FILES) {
    fs.copyFileSync(path.join(runnerDir, name), path.join(dir, name));
  }
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

test('V_INFRA_I02 contract: committed runner domain validates clean; qualify honors the exit contract', () => {
  const validate = runCli(['validate', '--registry', registryPath, '--dir', runnerDir, '--json']);
  assert.equal(validate.status, 0, `validate must PASS on committed files: ${validate.stderr || validate.stdout}`);
  const report = parseJsonOut(validate, 'validate');
  assert.equal(report.interface, 'RunnerInfra.v1');
  assert.equal(report.ok, true);
  assert.deepEqual(report.violations, []);
  // 结构化回执绝不回显宿主绝对路径（fixture 目录在 tmp，也必须脱敏）。
  assert.doesNotMatch(validate.stdout, HOST_PATH_OUTPUT_RE, 'validate output must not carry host absolute paths');
  // 三个公共接口必须在回执中如实呈现。
  assert.ok(report.roles, 'RoleBoundary.v1 summary must be present');
  assert.ok(report.authority, 'Authority.v1 summary must be present');
  assert.equal(report.roles.length, RUNNER_ROLES.length, 'six runner roles must be declared');
  // I01 修正案 2（05fb404）已登记全部四个 runner ref：committed 域不得再报缺口（正向断言，防回归）。
  for (const ref of RUNNER_REFS) {
    assert.ok(!(report.catalogGaps ?? []).includes(ref), `${ref} is registered in the I01 catalog and must not be reported as a gap`);
  }
  assert.deepEqual(report.catalogGaps, [], 'no catalog gaps remain after I01 amendment 2');

  // 配置有效 ≠ 运行 ready：qualify 必须诚实 NOT_READY 且退出 2。
  const qualify = runCli(['qualify', '--registry', registryPath, '--dir', runnerDir, '--json']);
  assert.equal(qualify.status, 2, 'qualify must exit 2 while evidence is unready');
  const receipt = parseJsonOut(qualify, 'qualify');
  assert.equal(receipt.interface, 'Qualification.v1');
  assert.equal(receipt.ready, false);
  const unverified = Object.entries(receipt.categories).filter(([, c]) => c.status === 'UNVERIFIED');
  assert.ok(unverified.length > 0, 'honest receipt must expose UNVERIFIED categories');
  for (const [, category] of unverified) {
    assert.ok(category.reason && category.reason.length > 0, 'every UNVERIFIED category carries an exact reason');
  }
  assert.doesNotMatch(qualify.stdout, HOST_PATH_OUTPUT_RE);

  // 未知命令 / 缺参 / 未知 probe case = 输入无效 → 退出 1。
  assert.equal(runCli(['frobnicate', '--json']).status, 1);
  assert.equal(runCli(['probe', '--json']).status, 1);
  assert.equal(runCli(['probe', '--case', 'not-a-case', '--json']).status, 1);

  // 域文件缺失 = 前置无效 → 退出 1（不是静默跳过）。
  const partial = fs.mkdtempSync(path.join(os.tmpdir(), 'infra-i02-partial-'));
  for (const name of DOMAIN_FILES.filter((n) => n !== 'workspace-mounts.json')) {
    fs.copyFileSync(path.join(runnerDir, name), path.join(partial, name));
  }
  const missing = runCli(['validate', '--registry', registryPath, '--dir', partial, '--json']);
  assert.equal(missing.status, 1, 'a missing domain file is an input/prerequisite failure');
  assert.doesNotMatch(missing.stdout + missing.stderr, HOST_PATH_OUTPUT_RE);
});

test('RED role gate: role-policy without role definitions, missing principal bindings or reused principals is rejected', () => {
  const noRoles = makeFixtureDir(({ json, writeJson }) => {
    const policy = json('role-policy.json');
    delete policy.roles;
    writeJson('role-policy.json', policy);
  });
  const noRolesRun = runCli(['validate', '--registry', registryPath, '--dir', noRoles, '--json']);
  assert.equal(noRolesRun.status, 2, 'role-policy without role definitions must be rejected');
  assert.ok(codes(parseJsonOut(noRolesRun, 'validate')).includes('ROLES_MISSING'), JSON.stringify(noRolesRun.stdout));

  const noPrincipal = makeFixtureDir(({ json, writeJson }) => {
    const policy = json('role-policy.json');
    delete policy.roles.find((r) => r.role === 'author').principal;
    writeJson('role-policy.json', policy);
  });
  const noPrincipalRun = runCli(['validate', '--registry', registryPath, '--dir', noPrincipal, '--json']);
  assert.equal(noPrincipalRun.status, 2, 'a role without a principal binding must be rejected');
  assert.ok(
    codes(parseJsonOut(noPrincipalRun, 'validate')).includes('ROLE_PRINCIPAL_BINDING_MISSING'),
    JSON.stringify(noPrincipalRun.stdout),
  );

  const reused = makeFixtureDir(({ json, writeJson }) => {
    const policy = json('role-policy.json');
    const author = policy.roles.find((r) => r.role === 'author');
    const reviewer = policy.roles.find((r) => r.role === 'reviewer');
    author.principal.label = reviewer.principal.label;
    writeJson('role-policy.json', policy);
  });
  const reusedRun = runCli(['validate', '--registry', registryPath, '--dir', reused, '--json']);
  assert.equal(reusedRun.status, 2, 'one principal reused across two roles must be rejected');
  assert.ok(codes(parseJsonOut(reusedRun, 'validate')).includes('ROLE_IDENTITY_REUSE'), JSON.stringify(reusedRun.stdout));

  // qualify 与 validate 同源：角色边界违规时 qualify 的角色边界声明类别必须 UNVERIFIED 并引用违规码。
  const qualifyRun = runCli(['qualify', '--registry', registryPath, '--dir', reused, '--json']);
  assert.equal(qualifyRun.status, 2);
  const receipt = parseJsonOut(qualifyRun, 'qualify');
  assert.equal(receipt.categories['role-boundary-declaration'].status, 'UNVERIFIED');
  assert.match(JSON.stringify(receipt.categories['role-boundary-declaration']), /ROLE_IDENTITY_REUSE/);
});

test('RED image gate: image.lock without any authenticated digest refuses up (committed state, nothing fabricated)', () => {
  const lock = readDomainJson('image.lock.json');
  const components = lock.components ?? [];
  const required = ['comet-runner', 'runner-base'];
  for (const name of required) {
    const entry = components.find((c) => c.component === name);
    assert.ok(entry, `lock must declare ${name}`);
    assert.equal(entry.reference, null, `${name}: nothing built/selected, no tag may be invented`);
    assert.equal(entry.digest, null, `${name}: no authenticated digest exists, none may be invented`);
    assert.equal(entry.status, 'UNVERIFIED', `${name} must be honestly UNVERIFIED`);
  }
  assert.equal(lock.sourceInputs.containerBuildStatus, 'UNVERIFIED', 'containerized build never executed on this host');
  assert.match(lock.sourceInputs.hostBuildFingerprint, /^[0-9a-f]{64}$/, 'host-side P1_6 fingerprint recorded');

  const up = runCli(['up', '--registry', registryPath, '--dir', runnerDir, '--json']);
  assert.equal(up.status, 2, 'up must refuse while the lock has no authenticated digest');
  const upReport = parseJsonOut(up, 'up');
  assert.equal(upReport.refused, true);
  assert.match(upReport.error, /RUNNER_LOCK_NOT_READY/);
  assert.ok(Array.isArray(upReport.unverifiedComponents) && upReport.unverifiedComponents.length >= required.length);
  assert.doesNotMatch(up.stdout, HOST_PATH_OUTPUT_RE);
});

test('RED image gate: floating tag rejected; malformed digest rejected; unauthenticated digest never reaches ready', () => {
  const floating = makeFixtureDir(({ json, writeJson }) => {
    const lock = json('image.lock.json');
    lock.components.find((c) => c.component === 'comet-runner').reference = 'ghcr.io/example/comet-runner:latest';
    writeJson('image.lock.json', lock);
  });
  const floatingRun = runCli(['validate', '--registry', registryPath, '--dir', floating, '--json']);
  assert.equal(floatingRun.status, 2, 'a floating :latest tag must not pass validate');
  assert.ok(codes(parseJsonOut(floatingRun, 'validate')).includes('FLOATING_TAG_FORBIDDEN'), JSON.stringify(floatingRun.stdout));

  const malformed = makeFixtureDir(({ json, writeJson }) => {
    const lock = json('image.lock.json');
    lock.components.find((c) => c.component === 'comet-runner').digest = 'sha256:deadbeef';
    writeJson('image.lock.json', lock);
  });
  const malformedRun = runCli(['validate', '--registry', registryPath, '--dir', malformed, '--json']);
  assert.equal(malformedRun.status, 2, 'format-invalid digest must not pass');
  assert.ok(codes(parseJsonOut(malformedRun, 'validate')).includes('DIGEST_FORMAT_INVALID'), JSON.stringify(malformedRun.stdout));

  // 仅出现在 fixture 中的探针值（绝不入库）：digest 格式合法但未经认证 → 保持 UNVERIFIED、up 仍拒绝。
  const unauthenticated = makeFixtureDir(({ json, writeJson }) => {
    const lock = json('image.lock.json');
    const runner = lock.components.find((c) => c.component === 'comet-runner');
    runner.reference = 'ghcr.io/example/not-built:vX-not-built';
    runner.digest = `sha256:${'a'.repeat(64)}`;
    runner.digestAuthenticated = false;
    writeJson('image.lock.json', lock);
  });
  const validateRun = runCli(['validate', '--registry', registryPath, '--dir', unauthenticated, '--json']);
  assert.equal(validateRun.status, 0, 'structurally honest lock (unauthenticated flag set) still validates');
  const qualifyRun = runCli(['qualify', '--registry', registryPath, '--dir', unauthenticated, '--json']);
  assert.equal(qualifyRun.status, 2);
  const receipt = parseJsonOut(qualifyRun, 'qualify');
  assert.equal(receipt.categories['container-image'].status, 'UNVERIFIED');
  const upRun = runCli(['up', '--registry', registryPath, '--dir', unauthenticated, '--json']);
  assert.equal(upRun.status, 2, 'up must still refuse without digest authentication');
  assert.match(parseJsonOut(upRun, 'up').error, /RUNNER_LOCK_NOT_READY/);
});

test('RED compose gate: host sensitive mounts (/Users, host HOME, docker.sock) and non-loopback ports are rejected', () => {
  const hostMount = makeFixtureDir(({ read, write }) => {
    write('compose.yaml', `${read('compose.yaml')}\n  extra:\n    image: \${EXTRA_IMAGE:?x}\n    volumes:\n      - /Users/example/data:/data\n`);
  });
  const hostMountRun = runCli(['validate', '--registry', registryPath, '--dir', hostMount, '--json']);
  assert.equal(hostMountRun.status, 2, 'host path bind mounts must be rejected');
  assert.ok(codes(parseJsonOut(hostMountRun, 'validate')).includes('HOST_MOUNT_FORBIDDEN'), JSON.stringify(hostMountRun.stdout));

  const dockerSock = makeFixtureDir(({ read, write }) => {
    write('compose.yaml', `${read('compose.yaml')}      - /var/run/docker.sock:/var/run/docker.sock\n`);
  });
  const sockRun = runCli(['validate', '--registry', registryPath, '--dir', dockerSock, '--json']);
  assert.equal(sockRun.status, 2, 'docker socket mounts must be rejected');
  const sockReport = parseJsonOut(sockRun, 'validate');
  assert.ok(codes(sockReport).includes('DOCKER_SOCK_MOUNT_FORBIDDEN'), JSON.stringify(sockReport.violations));
  assert.doesNotMatch(sockRun.stdout, HOST_PATH_OUTPUT_RE, 'violation details must not echo the raw socket path');

  const homeMount = makeFixtureDir(({ read, write }) => {
    write('compose.yaml', `${read('compose.yaml')}      - /root/home-dir:/home-dir\n`);
  });
  const homeRun = runCli(['validate', '--registry', registryPath, '--dir', homeMount, '--json']);
  assert.equal(homeRun.status, 2, 'host HOME mounts must be rejected');
  assert.ok(codes(parseJsonOut(homeRun, 'validate')).includes('HOST_MOUNT_FORBIDDEN'));

  const notLoopback = makeFixtureDir(({ read, write }) => {
    write('compose.yaml', read('compose.yaml').replace('"127.0.0.1:${COMET_RUNNER_PORT:-7300}:7300"', '"7300:7300"'));
  });
  const loopbackRun = runCli(['validate', '--registry', registryPath, '--dir', notLoopback, '--json']);
  assert.equal(loopbackRun.status, 2, 'non-loopback port binding must be rejected');
  assert.ok(codes(parseJsonOut(loopbackRun, 'validate')).includes('PORT_BINDING_NOT_LOOPBACK'), JSON.stringify(loopbackRun.stdout));
});

test('RED compose gate: read-only rootfs, minimal capabilities, internal network and per-role services are enforced', () => {
  const committed = readDomainFile('compose.yaml');
  assert.ok(committed.includes('networks:'), 'a dedicated network must be declared');
  assert.ok(/internal:\s*true/.test(committed), 'the dedicated network must be internal');
  for (const role of RUNNER_ROLES) {
    assert.ok(committed.includes(`comet-${role}:`), `compose must declare a service for role ${role}`);
  }
  for (const imageLine of committed.split('\n').filter((line) => line.trim().startsWith('image:'))) {
    assert.match(imageLine, /image:\s*\$\{[A-Z0-9_]+:\?/, `image must be resolved from the lock placeholder: ${imageLine}`);
    assert.doesNotMatch(imageLine, /:latest/, 'no floating tags anywhere in compose');
  }

  const writable = makeFixtureDir(({ read, write }) => {
    write('compose.yaml', read('compose.yaml').replaceAll('    read_only: true\n', ''));
  });
  const writableRun = runCli(['validate', '--registry', registryPath, '--dir', writable, '--json']);
  assert.equal(writableRun.status, 2, 'every service must declare a read-only root filesystem');
  assert.ok(
    codes(parseJsonOut(writableRun, 'validate')).includes('READ_ONLY_ROOTFS_REQUIRED'),
    JSON.stringify(writableRun.stdout),
  );

  const caps = makeFixtureDir(({ read, write }) => {
    write('compose.yaml', read('compose.yaml').replaceAll('    cap_drop:\n      - ALL\n', ''));
  });
  const capsRun = runCli(['validate', '--registry', registryPath, '--dir', caps, '--json']);
  assert.equal(capsRun.status, 2, 'every service must drop ALL capabilities');
  assert.ok(codes(parseJsonOut(capsRun, 'validate')).includes('CAP_DROP_ALL_REQUIRED'), JSON.stringify(capsRun.stdout));

  const privileged = makeFixtureDir(({ read, write }) => {
    write('compose.yaml', `${read('compose.yaml')}    privileged: true\n`);
  });
  const privilegedRun = runCli(['validate', '--registry', registryPath, '--dir', privileged, '--json']);
  assert.equal(privilegedRun.status, 2, 'privileged mode must be rejected');
  assert.ok(codes(parseJsonOut(privilegedRun, 'validate')).includes('PRIVILEGED_FORBIDDEN'));

  const unknownService = makeFixtureDir(({ read, write }) => {
    write('compose.yaml', read('compose.yaml').replace('services:\n', 'services:\n  comet-root:\n    image: ${COMET_RUNNER_IMAGE:?x}\n'));
  });
  const unknownRun = runCli(['validate', '--registry', registryPath, '--dir', unknownService, '--json']);
  assert.equal(unknownRun.status, 2, 'services outside the six role-policy roles must be rejected');
  assert.ok(codes(parseJsonOut(unknownRun, 'validate')).includes('SERVICE_ROLE_UNKNOWN'));

  const concreteImage = makeFixtureDir(({ read, write }) => {
    write('compose.yaml', read('compose.yaml').replaceAll(
      'image: ${COMET_RUNNER_IMAGE:?must be resolved from infra/delivery/runner/image.lock.json before up}',
      'image: ghcr.io/example/comet-runner:latest',
    ));
  });
  const imageRun = runCli(['validate', '--registry', registryPath, '--dir', concreteImage, '--json']);
  assert.equal(imageRun.status, 2, 'concrete image tags in compose must be rejected (lock is the only source)');
  assert.ok(codes(parseJsonOut(imageRun, 'validate')).includes('COMPOSE_IMAGE_NOT_LOCK_RESOLVED'), JSON.stringify(imageRun.stdout));
});

test('RED workspace gate: worker-writable control paths and host bind mounts are rejected', () => {
  const overlap = makeFixtureDir(({ json, writeJson }) => {
    const doc = json('workspace-mounts.json');
    doc.roleWorkspaces.find((w) => w.role === 'author').mountPath = '/comet/state';
    writeJson('workspace-mounts.json', doc);
  });
  const overlapRun = runCli(['validate', '--registry', registryPath, '--dir', overlap, '--json']);
  assert.equal(overlapRun.status, 2, 'a worker-writable mount overlapping a control directory must be rejected');
  assert.ok(
    codes(parseJsonOut(overlapRun, 'validate')).includes('WORKER_CONTROL_PATH_FORBIDDEN'),
    JSON.stringify(overlapRun.stdout),
  );

  const controlByWorker = makeFixtureDir(({ json, writeJson }) => {
    const doc = json('workspace-mounts.json');
    doc.controlVolumes[0].mountedBy.push('author');
    writeJson('workspace-mounts.json', doc);
  });
  const controlRun = runCli(['validate', '--registry', registryPath, '--dir', controlByWorker, '--json']);
  assert.equal(controlRun.status, 2, 'a control volume mounted by a worker role must be rejected');
  assert.ok(codes(parseJsonOut(controlRun, 'validate')).includes('WORKER_CONTROL_PATH_FORBIDDEN'));

  const hostBind = makeFixtureDir(({ json, writeJson }) => {
    const doc = json('workspace-mounts.json');
    doc.roleWorkspaces.find((w) => w.role === 'reviewer').hostPath = '/Users/example/workspaces/reviewer';
    writeJson('workspace-mounts.json', doc);
  });
  const hostBindRun = runCli(['validate', '--registry', registryPath, '--dir', hostBind, '--json']);
  assert.equal(hostBindRun.status, 2, 'host bind paths in role workspaces must be rejected');
  const hostBindReport = parseJsonOut(hostBindRun, 'validate');
  assert.ok(codes(hostBindReport).includes('HOST_BIND_FORBIDDEN'), JSON.stringify(hostBindReport.violations));
  assert.doesNotMatch(hostBindRun.stdout, HOST_PATH_OUTPUT_RE, 'violation details must not echo raw host paths');

  const volumeMismatch = makeFixtureDir(({ json, writeJson }) => {
    const doc = json('workspace-mounts.json');
    doc.roleWorkspaces.find((w) => w.role === 'author').volume = 'ws-someone-else';
    writeJson('workspace-mounts.json', doc);
  });
  const mismatchRun = runCli(['validate', '--registry', registryPath, '--dir', volumeMismatch, '--json']);
  assert.equal(mismatchRun.status, 2, 'workspace volumes must match role-policy declarations');
  assert.ok(codes(parseJsonOut(mismatchRun, 'validate')).includes('WORKSPACE_VOLUME_MISMATCH'));
});

test('RED authority gate: duplicate registrations, copied state and concurrent writers are rejected', () => {
  const baseRegistration = {
    registrationId: 'reg-a',
    authorityId: 'comet-authority-x',
    workspaceId: 'workspace-x',
    instanceId: 'runner-instance-1',
    stateOrigin: 'authoritative',
    writerExclusivity: 'single',
  };

  const duplicate = makeFixtureDir(({ json, writeJson }) => {
    const doc = json('authority-registration.example.json');
    doc.registrations = [
      baseRegistration,
      { ...baseRegistration, registrationId: 'reg-b', instanceId: 'runner-instance-2' },
    ];
    writeJson('authority-registration.example.json', doc);
  });
  const duplicateRun = runCli(['validate', '--registry', registryPath, '--dir', duplicate, '--json']);
  assert.equal(duplicateRun.status, 2, 'a second registration on the same authority must be rejected');
  assert.ok(
    codes(parseJsonOut(duplicateRun, 'validate')).includes('AUTHORITY_DUPLICATE_REGISTRATION'),
    JSON.stringify(duplicateRun.stdout),
  );

  const copied = makeFixtureDir(({ json, writeJson }) => {
    const doc = json('authority-registration.example.json');
    doc.registrations = [{ ...baseRegistration, stateOrigin: 'copied' }];
    writeJson('authority-registration.example.json', doc);
  });
  const copiedRun = runCli(['validate', '--registry', registryPath, '--dir', copied, '--json']);
  assert.equal(copiedRun.status, 2, 'startup on copied state must be rejected');
  assert.ok(codes(parseJsonOut(copiedRun, 'validate')).includes('COPIED_STATE_FORBIDDEN'));

  const concurrent = makeFixtureDir(({ json, writeJson }) => {
    const doc = json('authority-registration.example.json');
    doc.registrations = [{ ...baseRegistration, writerExclusivity: 'shared' }];
    writeJson('authority-registration.example.json', doc);
  });
  const concurrentRun = runCli(['validate', '--registry', registryPath, '--dir', concurrent, '--json']);
  assert.equal(concurrentRun.status, 2, 'a shared/concurrent writer registration must be rejected');
  assert.ok(codes(parseJsonOut(concurrentRun, 'validate')).includes('CONCURRENT_WRITER_FORBIDDEN'));

  const incomplete = makeFixtureDir(({ json, writeJson }) => {
    const doc = json('authority-registration.example.json');
    doc.registrations = [{ registrationId: 'reg-a', authorityId: 'comet-authority-x' }];
    writeJson('authority-registration.example.json', doc);
  });
  const incompleteRun = runCli(['validate', '--registry', registryPath, '--dir', incomplete, '--json']);
  assert.equal(incompleteRun.status, 2, 'an incomplete registration entry must be rejected');
  assert.ok(codes(parseJsonOut(incompleteRun, 'validate')).includes('AUTHORITY_REGISTRATION_INCOMPLETE'));
});

test('RED secret tier gate: ordinary roles cannot reach publisher/isolator-tier refs (I01 resolution semantics reused)', async () => {
  const tier = makeFixtureDir(({ json, writeJson }) => {
    const policy = json('role-policy.json');
    policy.roles.find((r) => r.role === 'author').grantedRefs.push('secret-ref:sdd-harness-pilot/outline-publisher');
    writeJson('role-policy.json', policy);
  });
  const tierRun = runCli(['validate', '--registry', registryPath, '--dir', tier, '--json']);
  assert.equal(tierRun.status, 2, 'an ordinary worker role listing a publisher-tier ref must be rejected');
  assert.ok(
    codes(parseJsonOut(tierRun, 'validate')).includes('SECRET_REF_TIER_FORBIDDEN'),
    JSON.stringify(tierRun.stdout),
  );

  const tierIsolator = makeFixtureDir(({ json, writeJson }) => {
    const policy = json('role-policy.json');
    policy.roles.find((r) => r.role === 'test-author').grantedRefs.push('secret-ref:sdd-harness-pilot/outline-isolator');
    writeJson('role-policy.json', policy);
  });
  const tierIsolatorRun = runCli(['validate', '--registry', registryPath, '--dir', tierIsolator, '--json']);
  assert.equal(tierIsolatorRun.status, 2, 'an ordinary worker role listing an isolator-tier ref must be rejected');
  assert.ok(codes(parseJsonOut(tierIsolatorRun, 'validate')).includes('SECRET_REF_TIER_FORBIDDEN'));

  // 解析语义复用 I01：author 主体解析 publisher 级 ref 必须被拒（PRINCIPAL_NOT_AUTHORIZED），与结构校验互相独立。
  const secretRefs = await import(secretRefsModuleUrl);
  const refsDoc = JSON.parse(fs.readFileSync(refsPath, 'utf8'));
  const authorPrincipal = readDomainJson('role-policy.json').roles.find((r) => r.role === 'author').principal.label;
  assert.throws(
    () => secretRefs.resolveSecretRef({
      ref: 'secret-ref:sdd-harness-pilot/outline-publisher',
      principalId: authorPrincipal,
      role: 'author',
      refsDoc,
      project: 'sdd-harness-pilot',
    }),
    (error) => error.code === 'PRINCIPAL_NOT_AUTHORIZED',
    'I01 resolution must deny an author principal the publisher-tier ref',
  );
});

test('RED method-state gate: shared mode state never becomes identity/permission basis, never enters worker-writable surfaces', () => {
  const noScope = makeFixtureDir(({ json, writeJson }) => {
    const policy = json('role-policy.json');
    delete policy.methodStateScope;
    writeJson('role-policy.json', policy);
  });
  const noScopeRun = runCli(['validate', '--registry', registryPath, '--dir', noScope, '--json']);
  assert.equal(noScopeRun.status, 2, 'role-policy without a method-state scope declaration must be rejected');
  assert.ok(codes(parseJsonOut(noScopeRun, 'validate')).includes('METHOD_STATE_SCOPE_MISSING'), JSON.stringify(noScopeRun.stdout));

  const asBasis = makeFixtureDir(({ json, writeJson }) => {
    const policy = json('role-policy.json');
    policy.methodStateScope.identityBasis = true;
    writeJson('role-policy.json', policy);
  });
  const asBasisRun = runCli(['validate', '--registry', registryPath, '--dir', asBasis, '--json']);
  assert.equal(asBasisRun.status, 2, 'using shared mode state as identity basis must be rejected');
  assert.ok(codes(parseJsonOut(asBasisRun, 'validate')).includes('METHOD_STATE_AS_BASIS_FORBIDDEN'), JSON.stringify(asBasisRun.stdout));

  const noDispatch = makeFixtureDir(({ json, writeJson }) => {
    const policy = json('role-policy.json');
    delete policy.methodStateScope.dispatchRecord.fields;
    writeJson('role-policy.json', policy);
  });
  const noDispatchRun = runCli(['validate', '--registry', registryPath, '--dir', noDispatch, '--json']);
  assert.equal(noDispatchRun.status, 2, 'dispatch record without the three separate fields must be rejected');
  assert.ok(codes(parseJsonOut(noDispatchRun, 'validate')).includes('DISPATCH_RECORD_SCHEMA_INCOMPLETE'), JSON.stringify(noDispatchRun.stdout));

  const modeWritable = makeFixtureDir(({ json, writeJson }) => {
    const mounts = json('workspace-mounts.json');
    mounts.methodState.workerWritable = true;
    writeJson('workspace-mounts.json', mounts);
  });
  const modeRun = runCli(['validate', '--registry', registryPath, '--dir', modeWritable, '--json']);
  assert.equal(modeRun.status, 2, 'mode files in a worker-writable surface must be rejected');
  assert.ok(codes(parseJsonOut(modeRun, 'validate')).includes('MODE_FILE_WORKER_WRITABLE_FORBIDDEN'), JSON.stringify(modeRun.stdout));
});

test('probes and stop are real subcommands: without a runner runtime they exit 2 with structured UNVERIFIED, never mock-green, never skip', () => {
  for (const probeCase of ['role-denial', 'duplicate-authority']) {
    const result = runCli(['probe', '--case', probeCase, '--dir', runnerDir, '--json']);
    assert.equal(result.status, 2, `probe ${probeCase} must exit 2 without a live runner runtime`);
    const observation = parseJsonOut(result, `probe ${probeCase}`);
    assert.equal(observation.interface, 'RunnerInfra.v1');
    assert.equal(observation.case, probeCase);
    assert.equal(observation.executed, false, 'probe must not pretend to have executed');
    assert.equal(observation.status, 'UNVERIFIED');
    assert.ok(observation.reason && observation.reason.length > 0, 'UNVERIFIED requires the exact reason');
    assert.ok(Array.isArray(observation.requiredInputs) && observation.requiredInputs.length > 0);
    assert.ok(Array.isArray(observation.plannedSteps) && observation.plannedSteps.length > 0, 'probe must declare its real steps');
    assert.doesNotMatch(result.stdout, HOST_PATH_OUTPUT_RE);
    assert.doesNotMatch(result.stdout, /"skip"\s*:\s*true/, 'probes must not skip');
  }

  // 有 --endpoint 但不可达：必须真实尝试并如实报告连接失败（未来有真实 Runner 时同一命令直接可跑）。
  const unreachable = runCli([
    'probe', '--case', 'role-denial', '--endpoint', 'http://127.0.0.1:59999',
    '--dir', runnerDir, '--json',
  ]);
  assert.equal(unreachable.status, 2, 'unreachable endpoint must stay UNVERIFIED with exit 2');
  const unreachableReport = parseJsonOut(unreachable, 'probe unreachable');
  assert.equal(unreachableReport.executed, false);
  assert.equal(unreachableReport.status, 'UNVERIFIED');
  assert.ok(unreachableReport.reason.length > 0);
  assert.ok(unreachableReport.observedSteps.length > 0, 'the real reachability attempt must be recorded');
  assert.doesNotMatch(unreachable.stdout, HOST_PATH_OUTPUT_RE);
});

test('stop without a runner started by this tool is honestly UNVERIFIED and refuses', () => {
  const result = runCli(['stop', '--dir', runnerDir, '--json']);
  assert.equal(result.status, 2, 'stop must not claim success when nothing was started');
  const report = parseJsonOut(result, 'stop');
  assert.equal(report.executed, false);
  assert.equal(report.status, 'UNVERIFIED');
  assert.ok(report.reason.length > 0);
  assert.doesNotMatch(result.stdout, HOST_PATH_OUTPUT_RE);
});

test('RoleBoundary.v1 / Authority.v1 contract holds on committed files; refs are referenced, never valued', async () => {
  const secretRefs = await import(secretRefsModuleUrl);

  // 结构安全扫描：无秘密形状值、无宿主绝对路径。
  for (const name of ['image.lock.json', 'role-policy.json', 'workspace-mounts.json', 'authority-registration.example.json']) {
    const violations = secretRefs.scanForForbiddenValues(readDomainJson(name));
    assert.deepEqual(violations, [], `${name} must contain no secret-shaped values or host paths`);
  }

  // RoleBoundary.v1：六角色、独立 principal/凭据/卷、只读根、最小能力。
  const policy = readDomainJson('role-policy.json');
  assert.equal(policy.interface, 'RoleBoundary.v1');
  const roles = policy.roles;
  assert.deepEqual(roles.map((r) => r.role).sort(), [...RUNNER_ROLES].sort());
  const labels = roles.filter((r) => r.principal?.label).map((r) => r.principal.label);
  assert.equal(new Set(labels).size, roles.length, 'principal labels must be pairwise distinct');
  const refs = roles.filter((r) => r.principal?.credentialRef).map((r) => r.principal.credentialRef);
  assert.equal(new Set(refs).size, refs.length, 'credential refs must be pairwise distinct (no shared principal credential)');
  const volumes = roles.map((r) => r.workspaceVolume);
  assert.equal(new Set(volumes).size, roles.length, 'workspace volumes must be pairwise distinct');
  for (const role of roles) {
    assert.equal(role.readOnlyRootFilesystem, true, `${role.role} must declare a read-only root filesystem`);
    assert.deepEqual(role.capabilities, { drop: ['ALL'], add: [] }, `${role.role} must drop ALL capabilities`);
  }

  // 控制状态结构表达：控制卷 worker 不可写、只挂 controller。
  const mounts = readDomainJson('workspace-mounts.json');
  assert.equal(mounts.interface, 'RoleBoundary.v1');
  for (const control of mounts.controlVolumes) {
    assert.equal(control.workerWritable, false, `control volume ${control.volume} must be worker-unwritable`);
    assert.deepEqual(control.mountedBy, ['controller'], `control volume ${control.volume} mounts for the controller only`);
  }
  for (const workspace of mounts.roleWorkspaces) {
    if (workspace.role !== 'controller') {
      assert.equal(workspace.hostPath ?? null, null, `worker role ${workspace.role} must have no host bind path`);
    }
  }
  assert.equal(mounts.rules.hostBindMounts, 'FORBIDDEN');
  assert.equal(mounts.rules.dockerSocket, 'FORBIDDEN');

  // 方法状态作用域（V_I02_METHOD_STATE_SCOPE，§6/§7.4）：声明、边界与派发记录字段在 committed 文件中如实固定。
  assert.equal(policy.methodStateScope.declaration, 'METHOD_STATE_SHARED_DECLARED');
  assert.equal(policy.methodStateScope.model, 'cooperative-local');
  assert.equal(policy.methodStateScope.identityBasis, false, 'shared mode state is never an identity basis');
  assert.equal(policy.methodStateScope.permissionBasis, false, 'shared mode state is never a permission basis');
  assert.equal(policy.methodStateScope.completionBasis, false, 'shared mode state is never a completion basis');
  assert.equal(policy.methodStateScope.modeFilesInWorkerWritableSurface, 'FORBIDDEN');
  for (const nonEvidence of ['hook exit 0', 'mode badge', 'codebase map']) {
    assert.ok(policy.methodStateScope.nonEvidence.includes(nonEvidence), `non-evidence register must include ${nonEvidence}`);
  }
  assert.equal(policy.methodStateScope.dispatchRecord.status, 'UNVERIFIED', 'dispatch records stay UNVERIFIED until a real dispatch fills them');
  for (const field of ['actualAssetDigest', 'effectiveLevel', 'injectionObservation']) {
    assert.ok(policy.methodStateScope.dispatchRecord.fields[field], `dispatch record must declare ${field} as a separate field`);
  }
  assert.equal(mounts.methodState.workerWritable, false, 'shared mode files are never worker-writable');
  assert.equal(mounts.methodState.mountedIntoRunner, false, 'shared mode files are never mounted into the runner');
  assert.equal(mounts.methodState.identityOrPermissionBasis, false);

  // Authority.v1：唯一 authority+workspace、REFUSE 策略在位、登记为空（无真实 Runner）。
  const authority = readDomainJson('authority-registration.example.json');
  assert.equal(authority.interface, 'Authority.v1');
  assert.deepEqual(authority.registrations, [], 'no runner instance exists; the registration stays empty');
  assert.equal(authority.uniqueness.concurrentWriterPolicy, 'REFUSE');
  assert.equal(authority.uniqueness.copiedStatePolicy, 'REFUSE');
  assert.equal(authority.authority.id, null, 'fixed authority id stays UNVERIFIED until a real runner starts');
  assert.equal(authority.authority.workspaceId, null);

  // 四个计划 secret-ref 全部被域文件引用；只引用不存值。
  const referenced = JSON.stringify([policy, mounts, authority, readDomainJson('image.lock.json')]);
  for (const ref of RUNNER_REFS) {
    assert.ok(referenced.includes(ref), `runner domain files must reference ${ref}`);
  }
  assert.match(referenced, /NOT_PROVISIONED|UNASSIGNED/, 'credentials stay unprovisioned markers, never values');

  // Dockerfile 声明门：基镜像只能经 ARG 从锁注入、非 root、无宿主路径。
  const dockerfile = readDomainFile('Dockerfile');
  assert.match(dockerfile, /^ARG RUNNER_BASE_IMAGE$/m, 'base image must arrive via an ARG resolved from the lock');
  assert.match(dockerfile, /^FROM \$\{RUNNER_BASE_IMAGE\}$/m, 'FROM must consume the lock-resolved ARG');
  assert.doesNotMatch(dockerfile, /^FROM \S+:\S+$/m, 'no concrete base image tag may be embedded');
  assert.match(dockerfile, /^USER comet$/m, 'the runner image must run as a non-root user');
  for (const line of dockerfile.split('\n')) {
    assert.ok(!/\/(Users|home\/\w|root\/)/.test(line), `Dockerfile must not carry host paths: ${line}`);
  }
});

test('catalog gap reporting: registered refs read RECORDED; a missing ref is still explicit readiness evidence, never silent', () => {
  // 已登记状态（I01 修正案 2，目录 16 refs）：committed 域 validate 干净且无任何 runner ref 缺口；
  // qualify 的 secret-refs-registered 升为 RECORDED（ref 已登记但仍 NOT_PROVISIONED，不等于可解析）。
  const clean = runCli(['validate', '--registry', registryPath, '--dir', runnerDir, '--json']);
  assert.equal(clean.status, 0, `committed domain must validate clean: ${clean.stderr || clean.stdout}`);
  const cleanReport = parseJsonOut(clean, 'validate clean');
  for (const ref of RUNNER_REFS) {
    assert.ok(!(cleanReport.catalogGaps ?? []).includes(ref), `${ref} is registered in the I01 catalog and must not be reported as a gap`);
  }
  const qualify = runCli(['qualify', '--registry', registryPath, '--dir', runnerDir, '--json']);
  assert.equal(qualify.status, 2, 'registered refs do not make the runner ready');
  const receipt = parseJsonOut(qualify, 'qualify');
  assert.equal(receipt.categories['secret-refs-registered'].status, 'RECORDED');
  assert.match(JSON.stringify(receipt.categories['secret-refs-registered']), /NOT_PROVISIONED/);
  assert.doesNotMatch(qualify.stdout, HOST_PATH_OUTPUT_RE);

  // 合成缺口（临时 fixture，不动活配置）：从目录副本删除一个已知已登记 ref，
  // validate 仍显式上报缺口、qualify 相应降级 UNVERIFIED——行为覆盖不再依赖已被修复的真实缺口。
  const refsDoc = JSON.parse(fs.readFileSync(refsPath, 'utf8'));
  const trimmed = JSON.parse(JSON.stringify(refsDoc));
  trimmed.refs = trimmed.refs.filter((entry) => entry.ref !== 'secret-ref:sdd-harness-pilot/runner-authority');
  const refsFixture = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'infra-i02-refs-')), 'refs.json');
  fs.writeFileSync(refsFixture, JSON.stringify(trimmed, null, 2) + '\n');
  const result = runCli(['validate', '--registry', registryPath, '--refs', refsFixture, '--dir', runnerDir, '--json']);
  assert.equal(result.status, 0, 'a catalog gap is readiness evidence (qualify), not a structural violation');
  const report = parseJsonOut(result, 'validate gaps');
  assert.ok(
    (report.catalogGaps ?? []).includes('secret-ref:sdd-harness-pilot/runner-authority'),
    'validate must explicitly report the missing ref as a catalogGap instead of passing silently',
  );
  const degraded = runCli(['qualify', '--registry', registryPath, '--refs', refsFixture, '--dir', runnerDir, '--json']);
  assert.equal(degraded.status, 2);
  const degradedReceipt = parseJsonOut(degraded, 'qualify degraded');
  assert.equal(degradedReceipt.categories['secret-refs-registered'].status, 'UNVERIFIED');
  assert.match(JSON.stringify(degradedReceipt.categories['secret-refs-registered']), /runner-authority/);
  assert.doesNotMatch(degraded.stdout, HOST_PATH_OUTPUT_RE);
});

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

test('image admission gates stay coherent with the committed lock state (state-agnostic)', () => {
  // The committed lock may legitimately be UNSELECTED (pre-admission) or
  // SELECTED+digest-pinned with an admission record (post-admission). Either
  // way: validate clean on the committed domain; `up` must honor the gate
  // contract (refuse closed, or run under the recorded admission) — and in
  // this sandbox the daemon is unreachable so the honest outcome is refusal
  // or honest UNVERIFIED, never a fabricated pass.
  const validate = runCli(['validate', '--registry', registryPath, '--dir', runnerDir, '--json']);
  assert.equal(validate.status, 0, `committed lock must validate clean: ${validate.stderr}`);
  const up = runCli(['up', '--registry', registryPath, '--dir', runnerDir, '--json']);
  assert.equal(up.status, 2, 'up must exit 2 (refusal/verify contract) in the sandbox');
  const receipt = parseJsonOut(up, 'up');
  assert.ok(receipt.refused === true || receipt.status === 'UNVERIFIED', 'up must refuse or be honestly unverified');
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

// ---------------------------------------------------------------------------
// RW_RUNNER_BUILD（本轮返工，tasks.md I02 Step 5）：完整补丁链 + 确定性入口 + 指纹现算。
// RED 复现三种历史缺陷：Dockerfile COPY 两补丁 vs 锁六补丁不符；find 漂移入口（错误入口路径）；
// image.lock 补丁/指纹落后于 upstream.lock。缺 project 目录的 ENOENT 拒绝用真实 build 工具复现。
// ---------------------------------------------------------------------------

import crypto from 'node:crypto';

const upstreamLockPath = path.join(repoRoot, 'integrations', 'comet', 'upstream.lock.json');
const P2_4_PATCH_0002_SHA = '47d2eebd57d4b8735a54333b0bf79a93c8812ae9037be9b9d0e141a9d5b38b16';
const P2_4_PATCH_2_4_SHA = '3b8aab434d0af664e6aca656bcdaaae1da1f80145d17ba99e0a2f01c0219545e';
const EXPECTED_FINGERPRINT_RW = 'd437093083ad4500253795fe231484c606e925b2404f958e5a7dd4fd4c11cba6';

const sha256File = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
// build.mjs:31 同算法：fingerprint = sha256(JSON({archive, patches, toolchain}))
const lockFingerprint = (lock, patches) => crypto.createHash('sha256').update(JSON.stringify({
  archive: lock.source.sha256,
  patches: patches.map(({ path: patchPath, sha256 }) => ({ path: patchPath, sha256 })),
  toolchain: lock.toolchain,
})).digest('hex');
// RUN 续行拼成单逻辑行，便于断言 echo…| sha256sum -c - 门
const joinContinuations = (text) => text.replace(/\\\n/g, ' ');
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('RW_RUNNER_BUILD: committed image lock mirrors the six-patch upstream lock (patches, toolchain, openspec pin, freshly recomputed fingerprint)', () => {
  const upstream = JSON.parse(fs.readFileSync(upstreamLockPath, 'utf8'));
  const inputs = readDomainJson('image.lock.json').sourceInputs;
  assert.equal(upstream.patches.length, 6, 'upstream lock pins six patches');
  assert.deepEqual(inputs.patches, upstream.patches, 'runner lock must mirror the upstream patch list exactly (order + shas)');
  const shas = inputs.patches.map((patch) => patch.sha256);
  assert.ok(shas.includes(P2_4_PATCH_0002_SHA), 'P2_4 updated 0002-managed-delivery-runtime sha must be in the chain');
  assert.ok(shas.includes(P2_4_PATCH_2_4_SHA), 'P2_4 updated tests/2_4 sha must be in the chain');
  assert.deepEqual(inputs.toolchain, upstream.toolchain, 'toolchain pins must equal the upstream lock');
  assert.equal(inputs.toolchain.node, '24.15.0', 'node pin matches P1_1 toolchain-baseline');
  assert.equal(inputs.toolchain.pnpm, '10.18.3', 'pnpm pin matches P1_1 toolchain-baseline');
  assert.equal(inputs.openspec.version, '1.11.0', 'openspec pin is the P1_1 isolated compatibility candidate');
  assert.equal(inputs.openspec.package, '@fission-ai/openspec');
  assert.equal(inputs.openspec.tarballSha256, '84820b173b57204bd7582a47ddae65e85fd492724172acc8e434e97ea1c05c3f', 'openspec tarball sha256 recorded from the P1_1 verified artifact');
  for (const patch of upstream.patches) {
    const file = path.join(repoRoot, patch.path);
    assert.ok(fs.existsSync(file), `patch file must exist in the repo: ${patch.path}`);
    assert.equal(sha256File(file), patch.sha256, `patch sha must match the lock on disk: ${patch.path}`);
  }
  assert.equal(inputs.hostBuildFingerprint, lockFingerprint(upstream, upstream.patches), 'recorded fingerprint must equal the freshly recomputed lock-derived fingerprint');
  assert.equal(inputs.hostBuildFingerprint, EXPECTED_FINGERPRINT_RW, 'six-patch (incl. P2_4 updated shas) lock fingerprint');
});

test('RW_RUNNER_BUILD: committed Dockerfile consumes the full ordered patch chain and pins a deterministic managed entrypoint', () => {
  const upstream = JSON.parse(fs.readFileSync(upstreamLockPath, 'utf8'));
  const dockerfile = readDomainFile('Dockerfile');
  const joined = joinContinuations(dockerfile);
  for (const [index, patch] of upstream.patches.entries()) {
    const n = index + 1;
    const escaped = escapeRegExp(patch.path);
    assert.ok(new RegExp(`^ARG PATCH_${n}_SHA256$`, 'm').test(dockerfile), `ARG PATCH_${n}_SHA256 missing for ${patch.path}`);
    assert.ok(
      new RegExp(`^COPY ${escaped} /build/repo/${escaped}$`, 'm').test(dockerfile),
      `COPY of ${patch.path} must mirror it under /build/repo at the same relative path`,
    );
    assert.ok(
      joined.includes(`echo "\${PATCH_${n}_SHA256}  /build/repo/${patch.path}" | sha256sum -c -`),
      `sha256 gate for ${patch.path} missing`,
    );
  }
  assert.ok(/^ARG SOURCE_COMMIT$/m.test(dockerfile), 'ARG SOURCE_COMMIT missing');
  assert.ok(/^ARG SOURCE_SHA256$/m.test(dockerfile), 'ARG SOURCE_SHA256 missing');
  assert.ok(/^ARG EXPECTED_FINGERPRINT$/m.test(dockerfile), 'ARG EXPECTED_FINGERPRINT missing');
  assert.ok(/^ARG OPENSPEC_TARBALL_SHA256$/m.test(dockerfile), 'ARG OPENSPEC_TARBALL_SHA256 missing');
  assert.ok(/^ARG OPENSPEC_VERSION$/m.test(dockerfile), 'ARG OPENSPEC_VERSION missing');
  assert.ok(/^COPY \.sdd\/cache\/runner-build\/comet-source\.tar\.gz \/build\/comet-source\.tar\.gz$/m.test(dockerfile), 'comet source archive COPY missing');
  assert.ok(joined.includes('echo "${SOURCE_SHA256}  /build/comet-source.tar.gz" | sha256sum -c -'), 'archive sha256 gate missing');
  assert.ok(/^COPY \.sdd\/cache\/runner-build\/openspec-\$\{OPENSPEC_VERSION\}\.tgz \/build\/openspec\.tgz$/m.test(dockerfile), 'openspec tarball COPY missing');
  assert.ok(joined.includes('echo "${OPENSPEC_TARBALL_SHA256}  /build/openspec.tgz" | sha256sum -c -'), 'openspec tarball sha256 gate missing');
  assert.ok(/npm install --global \/build\/openspec\.tgz/.test(joined), 'openspec must install from the verified pinned tarball');
  assert.ok(joined.includes('--project /build/repo'), 'build.mjs must run with --project /build/repo (patch paths are project-root relative)');
  const entryPath = '/build/repo/.sdd/vendor/comet/${SOURCE_COMMIT}/builds/${EXPECTED_FINGERPRINT}/work/bin/comet.js';
  assert.ok(dockerfile.includes(`test -f "${entryPath}"`), 'entrypoint must be gated by test -f on the fingerprint-deterministic path');
  assert.ok(dockerfile.includes(`ln -s "${entryPath}" /usr/local/bin/comet-runner`), 'entrypoint must symlink the deterministic path');
  assert.doesNotMatch(dockerfile, /find\s+\/build/, 'entrypoint resolution must be deterministic, not find-based');
});

test('RW_RUNNER_BUILD: validate enforces chain completeness, deterministic entrypoint, fingerprint freshness and upstream mirroring', () => {
  const missingCopy = makeFixtureDir(({ read, write }) => {
    write(
      'Dockerfile',
      read('Dockerfile').split('\n').filter((line) => !line.includes('integrations/comet/patches/tests/2_4.patch')).join('\n'),
    );
  });
  const missingCopyRun = runCli(['validate', '--registry', registryPath, '--dir', missingCopy, '--json']);
  assert.equal(missingCopyRun.status, 2, 'a Dockerfile that drops one of the six locked patches must be rejected');
  assert.ok(
    codes(parseJsonOut(missingCopyRun, 'validate')).includes('PATCH_CHAIN_INCOMPLETE'),
    JSON.stringify(missingCopyRun.stdout),
  );

  const findEntry = makeFixtureDir(({ read, write }) => {
    write('Dockerfile', `${read('Dockerfile')}RUN cometEntry=$(find /build -path "*/work/bin/comet.js" -type f | head -n 1)\n`);
  });
  const findEntryRun = runCli(['validate', '--registry', registryPath, '--dir', findEntry, '--json']);
  assert.equal(findEntryRun.status, 2, 'find-based entrypoint resolution must be rejected');
  assert.ok(codes(parseJsonOut(findEntryRun, 'validate')).includes('ENTRYPOINT_NONDETERMINISTIC'));

  const stale = makeFixtureDir(({ json, writeJson }) => {
    const lock = json('image.lock.json');
    lock.sourceInputs.hostBuildFingerprint = '0'.repeat(64);
    writeJson('image.lock.json', lock);
  });
  const staleRun = runCli(['validate', '--registry', registryPath, '--dir', stale, '--json']);
  assert.equal(staleRun.status, 2, 'a fingerprint that no longer derives from the current lock must be rejected');
  const staleReport = parseJsonOut(staleRun, 'validate');
  assert.ok(codes(staleReport).includes('FINGERPRINT_STALE'), JSON.stringify(staleReport.violations));

  const droppedPatch = makeFixtureDir(({ json, writeJson }) => {
    const lock = json('image.lock.json');
    lock.sourceInputs.patches = lock.sourceInputs.patches.slice(0, 5);
    writeJson('image.lock.json', lock);
  });
  const droppedRun = runCli(['validate', '--registry', registryPath, '--dir', droppedPatch, '--json']);
  assert.equal(droppedRun.status, 2, 'a runner lock that drops an upstream patch must be rejected');
  assert.ok(codes(parseJsonOut(droppedRun, 'validate')).includes('PATCH_LOCK_MISMATCH'), JSON.stringify(droppedRun.stdout));

  const mutatedToolchain = makeFixtureDir(({ json, writeJson }) => {
    const lock = json('image.lock.json');
    lock.sourceInputs.toolchain = { ...lock.sourceInputs.toolchain, node: '20.0.0' };
    writeJson('image.lock.json', lock);
  });
  const toolchainRun = runCli(['validate', '--registry', registryPath, '--dir', mutatedToolchain, '--json']);
  assert.equal(toolchainRun.status, 2, 'a toolchain pin that drifts from the upstream lock must be rejected');
  assert.ok(codes(parseJsonOut(toolchainRun, 'validate')).includes('TOOLCHAIN_PIN_MISMATCH'));

  const noOpenspec = makeFixtureDir(({ json, writeJson }) => {
    const lock = json('image.lock.json');
    delete lock.sourceInputs.openspec;
    writeJson('image.lock.json', lock);
  });
  const openspecRun = runCli(['validate', '--registry', registryPath, '--dir', noOpenspec, '--json']);
  assert.equal(openspecRun.status, 2, 'a lock without the openspec pin must be rejected');
  assert.ok(codes(parseJsonOut(openspecRun, 'validate')).includes('OPENSPEC_PIN_INVALID'));

  const writableRoot = makeFixtureDir(({ json, writeJson }) => {
    const doc = json('workspace-mounts.json');
    doc.rules.projectRootMount = 'WRITABLE';
    writeJson('workspace-mounts.json', doc);
  });
  const writableRootRun = runCli(['validate', '--registry', registryPath, '--dir', writableRoot, '--json']);
  assert.equal(writableRootRun.status, 2, 'a writable project-root mount rule must be rejected');
  assert.ok(codes(parseJsonOut(writableRootRun, 'validate')).includes('PROJECT_ROOT_MOUNT_NOT_READONLY'), JSON.stringify(writableRootRun.stdout));
});

test('RW_RUNNER_BUILD: build-plan exports the real build inputs; a lock that drifts from upstream refuses', () => {
  const plan = runCli(['build-plan', '--dir', runnerDir, '--json']);
  assert.equal(plan.status, 0, `build-plan must PASS on the committed repo: ${plan.stderr || plan.stdout}`);
  const report = parseJsonOut(plan, 'build-plan');
  assert.equal(report.interface, 'RunnerInfra.v1');
  assert.equal(report.command, 'build-plan');
  assert.equal(report.sourceCommit, 'c90af44a4474662d7853aae76ce785404974fb0a');
  assert.equal(report.fingerprint, EXPECTED_FINGERPRINT_RW);
  assert.equal(report.patches.length, 6);
  for (const patch of report.patches) {
    assert.equal(patch.sha256Verified, true, `patch verified on disk: ${patch.path}`);
  }
  assert.equal(
    report.entrypoint,
    `/build/repo/.sdd/vendor/comet/c90af44a4474662d7853aae76ce785404974fb0a/builds/${EXPECTED_FINGERPRINT_RW}/work/bin/comet.js`,
    'entrypoint is the fingerprint-deterministic managed comet path inside the image',
  );
  assert.equal(report.dockerBuild.buildArgs.PATCH_3_SHA256, P2_4_PATCH_0002_SHA, 'build args carry the six patch shas in lock order');
  assert.equal(report.dockerBuild.buildArgs.EXPECTED_FINGERPRINT, EXPECTED_FINGERPRINT_RW);
  assert.equal(report.dockerBuild.buildArgs.OPENSPEC_TARBALL_SHA256, '84820b173b57204bd7582a47ddae65e85fd492724172acc8e434e97ea1c05c3f');
  assert.ok(report.dockerBuild.command.includes('--build-arg SOURCE_SHA256=28a7e2fa'), 'the emitted build command pins the archive sha');
  assert.ok(report.dockerBuild.command.includes('-f infra/delivery/runner/Dockerfile'), 'the emitted build command uses the committed Dockerfile');
  for (const input of [report.inputs.cometSourceArchive, report.inputs.openspecTarball]) {
    assert.ok(['PRESENT', 'ACQUISITION_REQUIRED'].includes(input.status), `input status is honest: ${input.path}`);
    if (input.status === 'ACQUISITION_REQUIRED') {
      assert.ok(input.expectedSha256 && input.acquisition, 'an acquisition-required input declares its expected sha and how to acquire it');
    }
  }
  assert.ok(['OPEN', 'CLOSED'].includes(report.upGate), `upGate must be an honest enum value, got ${report.upGate}`);
  if (report.upGate === 'OPEN') {
    // post-admission state: the committed lock must carry the complete
    // admission record (admittedBy/at/reason) that opened it
    const committed = JSON.parse(fs.readFileSync(path.join(runnerDir, 'image.lock.json'), 'utf8'));
    const gate = committed.upGate ?? {};
    assert.ok(gate.admittedBy && gate.admittedAt && gate.reason, 'an OPEN gate must carry its complete admission record');
  }
  assert.doesNotMatch(plan.stdout, HOST_PATH_OUTPUT_RE, 'build-plan output must not carry host absolute paths');

  const drifted = makeFixtureDir(({ json, writeJson }) => {
    const lock = json('image.lock.json');
    lock.sourceInputs.patches = lock.sourceInputs.patches.slice(0, 5);
    writeJson('image.lock.json', lock);
  });
  const driftedRun = runCli(['build-plan', '--dir', drifted, '--json']);
  assert.equal(driftedRun.status, 2, 'build-plan must refuse when the runner lock drifts from the upstream lock');
  const driftedReport = parseJsonOut(driftedRun, 'build-plan');
  assert.ok(driftedReport.drift.includes('PATCH_LOCK_MISMATCH'), JSON.stringify(driftedReport.drift));
});

test('RW_RUNNER_BUILD: a missing project directory is a real ENOENT refusal by the build tool (no fabricated pass)', () => {
  // 与 test/delivery-cases/2_4.mjs 同源：宿主 node 与锁钉工具链不同时，解析 nvm 中的钉定 node，
  // 使拒绝发生在真实 project-root 检查（ENOENT）而非工具链前置门（TOOLCHAIN_MISMATCH）。
  const upstreamLock = JSON.parse(fs.readFileSync(upstreamLockPath, 'utf8'));
  let pinnedNodeExecutable = process.execPath;
  if (process.versions.node !== upstreamLock.toolchain.node) {
    const candidate = path.join(os.homedir(), '.nvm', 'versions', 'node', `v${upstreamLock.toolchain.node}`, 'bin', 'node');
    const probe = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
    if (probe.status === 0 && probe.stdout.trim() === `v${upstreamLock.toolchain.node}`) pinnedNodeExecutable = candidate;
  }
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'infra-i02-enoent-'));
  const absentProject = path.join(scratch, 'project-absent');
  const result = spawnSync(
    pinnedNodeExecutable,
    [path.join(repoRoot, 'tools', 'comet', 'build.mjs'), '--project', absentProject, '--lock', upstreamLockPath, '--archive', path.join(scratch, 'archive.tar.gz')],
    { encoding: 'utf8', timeout: RUN_TIMEOUT_MS },
  );
  assert.notEqual(result.status, 0, 'building into a nonexistent project directory must fail');
  assert.match(result.stderr, /ENOENT/, `the refusal must name ENOENT, got: ${result.stderr}`);
});

test('RW_RUNNER_BUILD: control-plane declarations align with the P2_4 runtime bindings; project root is a read-only boundary', () => {
  const policy = readDomainJson('role-policy.json');
  const binding = policy.methodStateScope.dispatchRecord.runtimeBinding;
  assert.ok(binding, 'dispatchRecord must cross-reference the P2_4 runtime bindings');
  const serialized = JSON.stringify(binding);
  assert.match(serialized, /generation/, 'the generation binding (dispatch.generation == current, receipt-recorded) must be referenced');
  assert.match(serialized, /inputDigest/, 'the inputDigest binding must be referenced');
  assert.match(serialized, /role/, 'the role==dispatch-role binding must be referenced');
  assert.equal(binding.status, 'UNVERIFIED', 'runtime binding observations stay UNVERIFIED until a real dispatch');
  assert.deepEqual(binding.fields, ['generation', 'role', 'inputDigest']);

  const mounts = readDomainJson('workspace-mounts.json');
  assert.equal(mounts.rules.projectRootMount, 'READ_ONLY_BOUNDARY', 'the delivery project root, if mounted at admission, is a read-only boundary');
  assert.match(mounts.projectRoot.note, /只读/, 'the project-root boundary carries an explicit read-only note');
});

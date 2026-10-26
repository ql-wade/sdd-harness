import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { afterEach } from 'node:test';
import { fileURLToPath } from 'node:url';

// V_INFRA_I02 — I02 退休六角色常驻部署与按需临时作业边界 的契约检查。
// 规格：tasks.md I02 节 + infrastructure-plan.md「I02退休的安全顺序」+ ADR-0021。
//
//   退休边界      默认安装/启动/检查链零常驻角色服务；六角色 compose 与镜像资格不再是
//                 命令前置；up/build-plan 一律退休拒绝且绝不触碰 docker；旧 Run/证据/
//                 镜像识别/卷保留（退休不删除任何数据）。
//   按需临时作业  createCliJobDriver 是唯一后继面：单次容器、network none、只读根、
//                 单一原始 start、固定物理作用域——仅由真实授权 dispatch 后方使用。
//   缺 Docker    普通命令与 validate/qualify/stop 不依赖临时 Docker；缺 Docker 的环境
//                 只让需要 Docker 的观测保持 UNVERIFIED，绝不阻塞。
//
// CLI 退出码契约（execution-contract.json V_INFRA_I02.cli_contract）：
//   0=PASS，1=输入/前置无效（文件缺失/不可解析/参数错误），2=验证失败（语义违规、
//   qualify NOT_READY、退休拒绝、UNVERIFIED）。绝不 mock 转绿、绝不 skip。
//
// 负例 fixture 全部在 os.tmpdir() 生成，不向活配置写入任何状态。
// 证据范围声明：本文件证明退休边界的机械 oracle 与按需作业的组件协议（fixture Docker CLI）；
// 真实容器/权限/旧资源在宿主上的观测保持 UNVERIFIED，由 probe 与 qualify 如实上报。

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
const RETIREMENT_REVISION = '2026-10-26-comet-050-adoption-v1';
const RETIREMENT_DECISION = 'docs/architecture/adr/0021-comet-command-first-no-resident-role-services.md';
// fixture 专用 64-hex（取自退休记录的指纹值，仅作 driver 注册的合成 sdkFingerprint，不声称真实镜像）。
const FIXTURE_SDK_FINGERPRINT = '3056292584ad17c49080c7504c1a689f1a382012e708665a8f12069d75a12a69';

const sha256File = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

const privateRoots = new Set();
function privateTmp(prefix) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  privateRoots.add(directory);
  return directory;
}
afterEach(() => {
  for (const directory of privateRoots) fs.rmSync(directory, { recursive: true, force: true });
  privateRoots.clear();
});

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
    assert.fail(`${label}: a structured JSON response is required`);
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
  const dir = privateTmp('infra-i02-');
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

test('V_INFRA_I02 contract: retired runner domain validates clean; qualify honors the exit contract', () => {
  const validate = runCli(['validate', '--registry', registryPath, '--dir', runnerDir, '--json']);
  assert.equal(validate.status, 0, `validate must PASS on the retired committed files: ${validate.stderr || validate.stdout}`);
  const report = parseJsonOut(validate, 'validate');
  assert.equal(report.interface, 'RunnerInfra.v1');
  assert.equal(report.ok, true);
  assert.deepEqual(report.violations, []);
  // 退休边界必须在回执中如实呈现。
  assert.equal(report.residentRoleServices, 'RETIRED');
  assert.equal(report.retirement.status, 'RETIRED_RESIDENT_ROLE_DEPLOYMENT');
  assert.equal(report.retirement.decision, RETIREMENT_DECISION);
  assert.equal(report.retirement.revision, RETIREMENT_REVISION);
  assert.match(report.retirement.dataDisposition, /RETAINED/i, 'retirement must declare data retention');
  assert.equal(report.defaultEntryCensus.residentRoleReferences, 0, 'the default entry census must find zero resident role references');
  assert.ok(report.defaultEntryCensus.entries.length >= 5, 'the census must cover the real default install/start/check entries');
  assert.equal(report.imageLock.retirementStatus, 'RETIRED_RESIDENT_ROLE_DEPLOYMENT');
  assert.equal(report.imageLock.containerBuildStatus, 'RETIRED');
  // 结构化回执绝不回显宿主绝对路径（fixture 目录在 tmp，也必须脱敏）。
  assert.doesNotMatch(validate.stdout, HOST_PATH_OUTPUT_RE, 'validate output must not carry host absolute paths');
  // 边界声明回执仍然如实呈现（历史/按需声明，不是默认注册）。
  assert.ok(report.roles, 'RoleBoundary.v1 summary must be present');
  assert.ok(report.authority, 'Authority.v1 summary must be present');
  assert.equal(report.roles.length, RUNNER_ROLES.length, 'six declared roles remain on record for identification');
  // I01 修正案 2（05fb404）已登记全部四个 runner ref：committed 域不得再报缺口（正向断言，防回归）。
  for (const ref of RUNNER_REFS) {
    assert.ok(!(report.catalogGaps ?? []).includes(ref), `${ref} is registered in the I01 catalog and must not be reported as a gap`);
  }
  assert.deepEqual(report.catalogGaps, [], 'no catalog gaps remain after I01 amendment 2');

  // 配置有效 ≠ 运行 ready：qualify 必须诚实 NOT_READY 且退出 2（退休不是 PASS）。
  const qualify = runCli(['qualify', '--registry', registryPath, '--dir', runnerDir, '--json']);
  assert.equal(qualify.status, 2, 'qualify must exit 2 while live evidence is unready');
  const receipt = parseJsonOut(qualify, 'qualify');
  assert.equal(receipt.interface, 'Qualification.v1');
  assert.equal(receipt.ready, false);
  assert.equal(receipt.residentRoleServices, 'RETIRED');
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
  const partial = privateTmp('infra-i02-partial-');
  for (const name of DOMAIN_FILES.filter((n) => n !== 'workspace-mounts.json')) {
    fs.copyFileSync(path.join(runnerDir, name), path.join(partial, name));
  }
  const missing = runCli(['validate', '--registry', registryPath, '--dir', partial, '--json']);
  assert.equal(missing.status, 1, 'a missing domain file is an input/prerequisite failure');
  assert.doesNotMatch(missing.stdout + missing.stderr, HOST_PATH_OUTPUT_RE);
});

// 默认入口清单与 CLI 的 census 同源：测试侧独立扫描（belt and braces）。
function defaultEntryFiles() {
  const entries = ['package.json', 'tools/bootstrap.sh', 'bin/cli.js', 'hooks.yaml'];
  for (const [directory, matcher] of [['scripts', /\.sh$/], ['.github/workflows', /\.ya?ml$/]]) {
    const root = path.join(repoRoot, directory);
    let names = [];
    try { names = fs.readdirSync(root); } catch { continue; }
    for (const name of names.filter((item) => matcher.test(item)).sort()) entries.push(path.join(directory, name));
  }
  return entries.map((relative) => ({ path: relative, file: path.join(repoRoot, relative) }))
    .filter((entry) => fs.existsSync(entry.file));
}

test('retirement census: default install/start/check entries reference zero resident role services', async () => {
  const { residentRoleReferenceFindings } = await import(new URL('../tools/infra/runner.mjs', import.meta.url));
  const real = defaultEntryFiles().map((entry) => ({ path: entry.path, text: fs.readFileSync(entry.file, 'utf8') }));
  assert.ok(real.length >= 5, 'the real default entry set must be non-trivial');
  assert.deepEqual(residentRoleReferenceFindings(real), [], 'no default entry may reference the six-role compose stack, the runner image placeholder or runner up');

  // RED 侧（合成入口）：每类退役引用都必须被机械识别。
  const synthetic = [
    ['compose reference', 'run: docker compose -f infra/delivery/runner/compose.yaml up -d'],
    ['image placeholder', 'export COMET_RUNNER_IMAGE=ghcr.io/x/y:v1'],
    ['runner up invocation', 'node tools/infra/runner.mjs up --registry infra/delivery/registry.json'],
    ['resident service name', 'depends_on: [comet-reviewer]'],
    ['resident volume name', 'volumes: [ws-isolator]'],
  ];
  for (const [name, text] of synthetic) {
    const findings = residentRoleReferenceFindings([{ path: `fixture-${name}.sh`, text }]);
    assert.equal(findings.length, 1, `${name} must be flagged exactly once`);
    assert.equal(findings[0].code, 'DEFAULT_ENTRY_RESIDENT_ROLE_REFERENCE');
    assert.ok(findings[0].matched.length > 0, 'the finding must retain the matched fragment');
  }

  // 负对照：相近但非退役面的词不得误报（comet-authority ref、普通 comet 执行器）。
  const benign = [
    'secret-ref:sdd-harness-pilot/runner-authority',
    'lib/adapters/comet-executor.js',
    'comet-controller-review.md',
    'comet authoring skill',
  ];
  for (const text of benign) {
    assert.deepEqual(residentRoleReferenceFindings([{ path: 'benign.sh', text }]), [], `benign text must not be flagged: ${text}`);
  }
});

test('retirement refusal: up and build-plan refuse before any image qualification or docker contact', () => {
  const up = runCli(['up', '--registry', registryPath, '--dir', runnerDir, '--json']);
  assert.equal(up.status, 2, 'up must exit 2 (retired refusal contract)');
  const upReport = parseJsonOut(up, 'up');
  assert.equal(upReport.refused, true);
  assert.equal(upReport.executed, false);
  assert.equal(upReport.code, 'RUNNER_RESIDENT_DEPLOYMENT_RETIRED');
  assert.equal(upReport.dockerInvoked, false, 'the retired up must never contact a container daemon');
  assert.equal(upReport.residentRoleServices, 'RETIRED');
  assert.doesNotMatch(up.stdout, HOST_PATH_OUTPUT_RE);

  const plan = runCli(['build-plan', '--dir', runnerDir, '--json']);
  assert.equal(plan.status, 2, 'build-plan must exit 2 (retired refusal contract)');
  const planReport = parseJsonOut(plan, 'build-plan');
  assert.equal(planReport.code, 'RUNNER_IMAGE_BUILD_CHAIN_RETIRED');
  assert.equal(planReport.dockerBuild, undefined, 'a retired build plan must not emit any docker build surface');
  assert.equal(planReport.retiredProvenance.patches, 7, 'the retired 0.4.5 chain is identified as the seven-patch era');
  assert.match(planReport.retiredProvenance.record, /git history/, 'the full retired closure is preserved in history, not fabricated here');
  assert.doesNotMatch(plan.stdout, HOST_PATH_OUTPUT_RE);

  // up/build-plan 的拒绝不依赖镜像资格：连 role-boundary 违规 fixture 也一样拿到退休拒绝
  // （退休先于资格化；旧“镜像未认证→UP_REFUSED_RUNNER_LOCK_NOT_READY”前置不复存在）。
  const dirty = makeFixtureDir(({ json, writeJson }) => {
    const lock = json('image.lock.json');
    lock.components.find((c) => c.component === 'comet-runner').reference = 'ghcr.io/example/comet-runner:latest';
    writeJson('image.lock.json', lock);
  });
  const dirtyUp = runCli(['up', '--registry', registryPath, '--dir', dirty, '--json']);
  assert.equal(dirtyUp.status, 2);
  assert.equal(parseJsonOut(dirtyUp, 'dirty up').code, 'RUNNER_RESIDENT_DEPLOYMENT_RETIRED', 'the refusal is retirement itself, not an image gate');
});

test('missing ephemeral Docker never blocks ordinary runner checks or the ordinary delivery CLI', () => {
  // 私有 PATH：仅提供 python3（compose 组件解析器需要），docker 不可解析。
  const bin = privateTmp('i02-nodocker-bin-');
  const python3Path = (process.env.PATH ?? '').split(path.delimiter).map((dir) => path.join(dir, 'python3')).find((candidate) => fs.existsSync(candidate));
  assert.ok(python3Path, 'SETUP: python3 must be locatable on the ambient PATH to mirror it into the no-docker PATH');
  fs.symlinkSync(python3Path, path.join(bin, 'python3'));
  const probe = spawnSync('python3', ['--version'], { encoding: 'utf8', env: { PATH: bin } });
  assert.equal(probe.status, 0, 'SETUP: the no-docker PATH must still resolve python3 for the compose component parser');
  const dockerAbsent = spawnSync('docker', ['version'], { encoding: 'utf8', env: { PATH: bin } });
  assert.notEqual(dockerAbsent.status, 0, 'SETUP: docker must NOT be resolvable on the no-docker PATH');
  const noDockerEnv = { PATH: bin, HOME: bin };

  // runner 自身的普通检查在缺 Docker 环境照常工作：validate 仍 PASS。
  const validate = spawnSync(process.execPath, [cliPath, 'validate', '--registry', registryPath, '--dir', runnerDir, '--json'], { encoding: 'utf8', timeout: RUN_TIMEOUT_MS, env: noDockerEnv });
  assert.equal(validate.status, 0, `validate must not depend on a container daemon: ${validate.stderr || validate.stdout}`);
  // qualify/stop 只因诚实 UNVERIFIED/退休拒绝退出 2，绝不因缺 Docker 崩溃或转绿。
  const qualify = spawnSync(process.execPath, [cliPath, 'qualify', '--registry', registryPath, '--dir', runnerDir, '--json'], { encoding: 'utf8', timeout: RUN_TIMEOUT_MS, env: noDockerEnv });
  assert.equal(qualify.status, 2);
  assert.equal(parseJsonOut(qualify, 'no-docker qualify').ready, false);

  // 普通交付命令（thin CLI）在缺 Docker 环境照常可用：缺临时 Docker 不影响普通命令。
  const cli = spawnSync(process.execPath, [path.join(repoRoot, 'bin', 'cli.js'), '--help'], { encoding: 'utf8', timeout: RUN_TIMEOUT_MS, env: noDockerEnv });
  assert.equal(cli.status, 0, `the ordinary delivery CLI must run without docker on PATH: ${cli.stderr}`);
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

test('RED retirement-record gate: floating tag, malformed digest, reopened up gate and broken retirement declaration are rejected', () => {
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

  // 退休后 up 门永远关闭：任何 reopen 尝试都违规（不存在可开门的准入记录）。
  const reopened = makeFixtureDir(({ json, writeJson }) => {
    const lock = json('image.lock.json');
    lock.upGate = { enabled: true, admittedBy: 'fixture', admittedAt: '2026-10-26T00:00:00Z', reason: 'fixture attempt to reopen a retired gate' };
    writeJson('image.lock.json', lock);
  });
  const reopenedRun = runCli(['validate', '--registry', registryPath, '--dir', reopened, '--json']);
  assert.equal(reopenedRun.status, 2, 'the retired up gate can never be reopened');
  assert.ok(codes(parseJsonOut(reopenedRun, 'validate')).includes('UP_GATE_NOT_CLOSED'), JSON.stringify(reopenedRun.stdout));

  const noRetirement = makeFixtureDir(({ json, writeJson }) => {
    const lock = json('image.lock.json');
    delete lock.retirement;
    writeJson('image.lock.json', lock);
  });
  const noRetirementRun = runCli(['validate', '--registry', registryPath, '--dir', noRetirement, '--json']);
  assert.equal(noRetirementRun.status, 2, 'the lock must declare the retirement itself');
  assert.ok(codes(parseJsonOut(noRetirementRun, 'validate')).includes('RETIREMENT_DECLARATION_MISSING'), JSON.stringify(noRetirementRun.stdout));

  const wrongStatus = makeFixtureDir(({ json, writeJson }) => {
    const lock = json('image.lock.json');
    lock.retirement.status = 'STILL_ACTIVE';
    writeJson('image.lock.json', lock);
  });
  const wrongStatusRun = runCli(['validate', '--registry', registryPath, '--dir', wrongStatus, '--json']);
  assert.equal(wrongStatusRun.status, 2, 'an ambiguous retirement status must be rejected');
  assert.ok(codes(parseJsonOut(wrongStatusRun, 'validate')).includes('RETIREMENT_STATUS_INVALID'), JSON.stringify(wrongStatusRun.stdout));

  // 数据保留声明：退休记录必须声明旧数据 RETAINED（退休不是删数据）。
  const noDisposition = makeFixtureDir(({ json, writeJson }) => {
    const lock = json('image.lock.json');
    lock.retirement.dataDisposition = 'old volumes may be removed at retirement';
    writeJson('image.lock.json', lock);
  });
  const noDispositionRun = runCli(['validate', '--registry', registryPath, '--dir', noDisposition, '--json']);
  assert.equal(noDispositionRun.status, 2, 'a retirement without an honest data retention disposition must be rejected');
  assert.ok(codes(parseJsonOut(noDispositionRun, 'validate')).includes('DATA_DISPOSITION_MISSING'), JSON.stringify(noDispositionRun.stdout));
  const degraded = runCli(['qualify', '--registry', registryPath, '--dir', noDisposition, '--json']);
  assert.equal(parseJsonOut(degraded, 'degraded qualify').categories['retired-without-data-loss'].status, 'UNVERIFIED');
});

test('RED retirement-record integrity: fingerprint, openspec pin and retired patch identification stay self-consistent', () => {
  const stale = makeFixtureDir(({ json, writeJson }) => {
    const lock = json('image.lock.json');
    lock.sourceInputs.hostBuildFingerprint = '0'.repeat(64);
    writeJson('image.lock.json', lock);
  });
  const staleRun = runCli(['validate', '--registry', registryPath, '--dir', stale, '--json']);
  assert.equal(staleRun.status, 2, 'a fingerprint that no longer derives from the record itself must be rejected');
  assert.ok(codes(parseJsonOut(staleRun, 'validate')).includes('FINGERPRINT_STALE'), JSON.stringify(staleRun.stdout));

  const droppedPatch = makeFixtureDir(({ json, writeJson }) => {
    const lock = json('image.lock.json');
    lock.sourceInputs.patches = lock.sourceInputs.patches.slice(0, 5);
    writeJson('image.lock.json', lock);
  });
  const droppedRun = runCli(['validate', '--registry', registryPath, '--dir', droppedPatch, '--json']);
  assert.equal(droppedRun.status, 2, 'a retirement record that drops retired-era patch identification must be rejected');
  assert.ok(codes(parseJsonOut(droppedRun, 'validate')).includes('FINGERPRINT_STALE'), JSON.stringify(droppedRun.stdout));

  const badPatchShape = makeFixtureDir(({ json, writeJson }) => {
    const lock = json('image.lock.json');
    lock.sourceInputs.patches[0] = { path: 'not-a-patch', sha256: 'zz' };
    writeJson('image.lock.json', lock);
  });
  const badPatchRun = runCli(['validate', '--registry', registryPath, '--dir', badPatchShape, '--json']);
  assert.equal(badPatchRun.status, 2, 'malformed retired patch identification must be rejected');
  assert.ok(codes(parseJsonOut(badPatchRun, 'validate')).includes('RETIRED_PATCH_RECORD_INVALID'), JSON.stringify(badPatchRun.stdout));

  const noOpenspec = makeFixtureDir(({ json, writeJson }) => {
    const lock = json('image.lock.json');
    delete lock.sourceInputs.openspec;
    writeJson('image.lock.json', lock);
  });
  const openspecRun = runCli(['validate', '--registry', registryPath, '--dir', noOpenspec, '--json']);
  assert.equal(openspecRun.status, 2, 'the still-live openspec pin (registry-referenced) must stay in the record');
  assert.ok(codes(parseJsonOut(openspecRun, 'validate')).includes('OPENSPEC_PIN_INVALID'), JSON.stringify(openspecRun.stdout));

  const badStatus = makeFixtureDir(({ json, writeJson }) => {
    const lock = json('image.lock.json');
    lock.sourceInputs.containerBuildStatus = 'SHIPPED';
    writeJson('image.lock.json', lock);
  });
  const badStatusRun = runCli(['validate', '--registry', registryPath, '--dir', badStatus, '--json']);
  assert.equal(badStatusRun.status, 2);
  assert.ok(codes(parseJsonOut(badStatusRun, 'validate')).includes('CONTAINER_BUILD_STATUS_INVALID'), JSON.stringify(badStatusRun.stdout));

  // 记录内指纹与 openspec pin 的正向事实：从 committed 记录现算并比对。
  const record = readDomainJson('image.lock.json');
  const recomputed = crypto.createHash('sha256').update(JSON.stringify({
    archive: record.sourceInputs.archiveSha256,
    patches: record.sourceInputs.patches.map(({ path: patchPath, sha256 }) => ({ path: patchPath, sha256 })),
    toolchain: record.sourceInputs.toolchain,
  })).digest('hex');
  assert.equal(record.sourceInputs.hostBuildFingerprint, recomputed, 'the committed record fingerprint derives from its own retired inputs');
  assert.equal(record.sourceInputs.openspec.version, '1.11.0', 'the registry-referenced openspec pin stays exact');
  assert.equal(record.sourceInputs.patches.length, 7, 'the retired era is identified by its seven-patch chain');
});

test('RED compose gate: host sensitive mounts (/Users, host HOME, docker.sock) and non-loopback ports are rejected', () => {
  const hostMount = makeFixtureDir(({ read, write }) => {
    write('compose.yaml', read('compose.yaml').replace('      - ws-author:/workspace', '      - ws-author:/workspace\n      - /Users/example/data:/data'));
  });
  const hostMountRun = runCli(['validate', '--registry', registryPath, '--dir', hostMount, '--json']);
  assert.equal(hostMountRun.status, 2, 'host path bind mounts must be rejected');
  assert.ok(codes(parseJsonOut(hostMountRun, 'validate')).includes('HOST_MOUNT_FORBIDDEN'), JSON.stringify(hostMountRun.stdout));

  const dockerSock = makeFixtureDir(({ read, write }) => {
    write('compose.yaml', read('compose.yaml').replace('      - ws-author:/workspace', '      - ws-author:/workspace\n      - /var/run/docker.sock:/var/run/docker.sock'));
  });
  const sockRun = runCli(['validate', '--registry', registryPath, '--dir', dockerSock, '--json']);
  assert.equal(sockRun.status, 2, 'docker socket mounts must be rejected');
  const sockReport = parseJsonOut(sockRun, 'validate');
  assert.ok(codes(sockReport).includes('DOCKER_SOCK_MOUNT_FORBIDDEN'), JSON.stringify(sockReport.violations));
  assert.doesNotMatch(sockRun.stdout, HOST_PATH_OUTPUT_RE, 'violation details must not echo the raw socket path');

  const homeMount = makeFixtureDir(({ read, write }) => {
    write('compose.yaml', read('compose.yaml').replace('      - ws-author:/workspace', '      - ws-author:/workspace\n      - /root/home-dir:/home-dir'));
  });
  const homeRun = runCli(['validate', '--registry', registryPath, '--dir', homeMount, '--json']);
  assert.equal(homeRun.status, 2, 'host HOME mounts must be rejected');
  assert.ok(codes(parseJsonOut(homeRun, 'validate')).includes('HOST_MOUNT_FORBIDDEN'));

  const notLoopback = makeFixtureDir(({ read, write }) => {
    write('compose.yaml', read('compose.yaml').replace('  comet-author:\n', '  comet-author:\n    ports: ["7300:7300"]\n'));
  });
  const loopbackRun = runCli(['validate', '--registry', registryPath, '--dir', notLoopback, '--json']);
  assert.equal(loopbackRun.status, 2, 'non-loopback port binding must be rejected');
  assert.ok(codes(parseJsonOut(loopbackRun, 'validate')).includes('PORT_BINDING_NOT_LOOPBACK'), JSON.stringify(loopbackRun.stdout));
});

test('RED compose gate: the historical/on-demand compose declaration stays structurally safe and explicitly retired', () => {
  const committed = readDomainFile('compose.yaml');
  assert.match(committed, /^# \[RETIRED 2026-10-26 \/ ADR-0021/, 'the compose file must carry the retirement marker');
  assert.match(committed, /createCliJobDriver/, 'the successor on-demand boundary must be named');
  assert.ok(committed.includes('networks:'), 'a dedicated network must be declared');
  assert.ok(/internal:\s*true/.test(committed), 'the dedicated network must be internal');
  for (const role of RUNNER_ROLES) {
    assert.ok(committed.includes(`comet-${role}:`), `compose must keep the historical service record for role ${role}`);
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
    write('compose.yaml', read('compose.yaml').replace('  comet-author:\n', '  comet-author:\n    privileged: true\n'));
  });
  const privilegedRun = runCli(['validate', '--registry', registryPath, '--dir', privileged, '--json']);
  assert.equal(privilegedRun.status, 2, 'privileged mode must be rejected');
  assert.ok(codes(parseJsonOut(privilegedRun, 'validate')).includes('PRIVILEGED_FORBIDDEN'));

  const unknownService = makeFixtureDir(({ read, write }) => {
    write('compose.yaml', read('compose.yaml').replace('services:\n', 'services:\n  comet-root:\n    image: ${COMET_RUNNER_IMAGE:?x}\n'));
  });
  const unknownRun = runCli(['validate', '--registry', registryPath, '--dir', unknownService, '--json']);
  assert.equal(unknownRun.status, 2, 'services outside the six recorded roles must be rejected');
  assert.ok(codes(parseJsonOut(unknownRun, 'validate')).includes('SERVICE_ROLE_UNKNOWN'));

  const concreteImage = makeFixtureDir(({ read, write }) => {
    write('compose.yaml', read('compose.yaml').replaceAll(
      'image: ${COMET_RUNNER_IMAGE:?must be resolved from infra/delivery/runner/image.lock.json before up}',
      'image: ghcr.io/example/comet-runner:latest',
    ));
  });
  const imageRun = runCli(['validate', '--registry', registryPath, '--dir', concreteImage, '--json']);
  assert.equal(imageRun.status, 2, 'concrete image tags in compose must be rejected (the record is the only source)');
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

test('probes and stop are real subcommands: without live evidence they exit 2 with structured UNVERIFIED, never mock-green, never skip', () => {
  for (const probeCase of ['role-denial', 'duplicate-authority']) {
    const result = runCli(['probe', '--case', probeCase, '--dir', runnerDir, '--json']);
    assert.equal(result.status, 2, `probe ${probeCase} must exit 2 without live host evidence`);
    const observation = parseJsonOut(result, `probe ${probeCase}`);
    assert.equal(observation.interface, 'RunnerInfra.v1');
    assert.equal(observation.case, probeCase);
    assert.equal(observation.executed, false, 'probe must not pretend to have executed');
    assert.equal(observation.status, 'UNVERIFIED');
    assert.equal(observation.residentRoleServices, 'RETIRED');
    assert.ok(observation.reason && observation.reason.length > 0, 'UNVERIFIED requires the exact reason');
    assert.ok(Array.isArray(observation.requiredInputs) && observation.requiredInputs.length > 0);
    assert.ok(Array.isArray(observation.plannedSteps) && observation.plannedSteps.length > 0, 'probe must declare its real steps');
    assert.doesNotMatch(result.stdout, HOST_PATH_OUTPUT_RE);
    assert.doesNotMatch(result.stdout, /"skip"\s*:\s*true/, 'probes must not skip');
  }

  // role-denial 的证据面已经换成宿主原生会话/权限，不再是角色容器。
  const roleDenial = parseJsonOut(runCli(['probe', '--case', 'role-denial', '--dir', runnerDir, '--json']), 'role-denial');
  assert.match(JSON.stringify(roleDenial.requiredInputs), /native read\/tool\/path scopes/, 'the denial probe targets native host scopes, not role containers');

  // The current CLI-only scope rejects the retired HTTP selection itself.
  const retired = runCli(['probe', '--case', 'role-denial', '--endpoint', 'i02-retired-origin', '--dir', runnerDir, '--json']);
  assert.equal(retired.status, 1, 'HTTP control API selection is outside the registered Runner interface');
  assert.equal(parseJsonOut(retired, 'retired endpoint').status, 'INPUT_INVALID');
  assert.doesNotMatch(retired.stdout + retired.stderr, /i02-retired-origin/);
});

test('stop without a runner started by this tool is honestly UNVERIFIED, refuses, and deletes nothing', () => {
  const result = runCli(['stop', '--dir', runnerDir, '--json']);
  assert.equal(result.status, 2, 'stop must not claim success when nothing was started');
  const report = parseJsonOut(result, 'stop');
  assert.equal(report.executed, false);
  assert.equal(report.status, 'UNVERIFIED');
  assert.ok(report.reason.length > 0);
  assert.match(report.reason, /deletes no containers, volumes or images/, 'retirement stop must state it deletes nothing');
  assert.doesNotMatch(result.stdout, HOST_PATH_OUTPUT_RE);
});

test('RoleBoundary.v1 / Authority.v1 contract holds on retired files; refs are referenced, never valued', async () => {
  const secretRefs = await import(secretRefsModuleUrl);

  // 结构安全扫描：无秘密形状值、无宿主绝对路径。
  for (const name of ['image.lock.json', 'role-policy.json', 'workspace-mounts.json', 'authority-registration.example.json']) {
    const violations = secretRefs.scanForForbiddenValues(readDomainJson(name));
    assert.deepEqual(violations, [], `${name} must contain no secret-shaped values or host paths`);
  }

  // RoleBoundary.v1：六角色记录、独立 principal/凭据/卷、只读根、最小能力（历史/按需声明，非默认注册）。
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

  // Dockerfile 声明门（历史配方仍然成立）：基镜像只能经 ARG、非 root、无宿主路径。
  const dockerfile = readDomainFile('Dockerfile');
  assert.match(dockerfile, /^ARG RUNNER_BASE_IMAGE$/m, 'base image must arrive via an ARG resolved from the record');
  assert.match(dockerfile, /^FROM \$\{RUNNER_BASE_IMAGE\}$/m, 'FROM must consume the record-resolved ARG');
  assert.doesNotMatch(dockerfile, /^FROM \S+:\S+$/m, 'no concrete base image tag may be embedded');
  assert.match(dockerfile, /^USER comet$/m, 'the runner image must run as a non-root user');
  for (const line of dockerfile.split('\n')) {
    assert.ok(!/\/(Users|home\/\w|root\/)/.test(line), `Dockerfile must not carry host paths: ${line}`);
  }
});

test('catalog gap reporting: registered refs read RECORDED; a missing ref is still explicit readiness evidence, never silent', () => {
  // 已登记状态（I01 修正案 2）：committed 域 validate 干净且无任何 runner ref 缺口。
  const clean = runCli(['validate', '--registry', registryPath, '--dir', runnerDir, '--json']);
  assert.equal(clean.status, 0, `committed domain must validate clean: ${clean.stderr || clean.stdout}`);
  const cleanReport = parseJsonOut(clean, 'validate clean');
  for (const ref of RUNNER_REFS) {
    assert.ok(!(cleanReport.catalogGaps ?? []).includes(ref), `${ref} is registered in the I01 catalog and must not be reported as a gap`);
  }
  const qualify = runCli(['qualify', '--registry', registryPath, '--dir', runnerDir, '--json']);
  assert.equal(qualify.status, 2, 'registered refs do not make anything runtime-ready');
  const receipt = parseJsonOut(qualify, 'qualify');
  assert.equal(receipt.categories['secret-refs-registered'].status, 'RECORDED');
  assert.match(JSON.stringify(receipt.categories['secret-refs-registered']), /NOT_PROVISIONED/);
  assert.doesNotMatch(qualify.stdout, HOST_PATH_OUTPUT_RE);

  // 合成缺口（临时 fixture，不动活配置）：从目录副本删除一个已知已登记 ref，
  // validate 仍显式上报缺口、qualify 相应降级 UNVERIFIED——行为覆盖不再依赖已被修复的真实缺口。
  const refsDoc = JSON.parse(fs.readFileSync(refsPath, 'utf8'));
  const trimmed = JSON.parse(JSON.stringify(refsDoc));
  trimmed.refs = trimmed.refs.filter((entry) => entry.ref !== 'secret-ref:sdd-harness-pilot/runner-authority');
  const refsFixture = path.join(privateTmp('infra-i02-refs-'), 'refs.json');
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

test('historical recipe gate: the retired Dockerfile stays byte-frozen and consistent with the retirement record', () => {
  const record = readDomainJson('image.lock.json');
  const dockerfile = readDomainFile('Dockerfile');

  // 冻结配方与退休记录的补丁识别清单一致：ARG/COPY/门数量逐一对上。
  const joined = dockerfile.replace(/\\\n/g, ' ');
  for (const [index, patch] of record.sourceInputs.patches.entries()) {
    const n = index + 1;
    assert.ok(new RegExp(`^ARG PATCH_${n}_SHA256$`, 'm').test(dockerfile), `ARG PATCH_${n}_SHA256 missing for ${patch.path}`);
    assert.ok(
      new RegExp(`^COPY ${patch.path.replaceAll('.', '\\.')} /build/repo/${patch.path.replaceAll('.', '\\.')}$`, 'm').test(dockerfile),
      `COPY of ${patch.path} must mirror it under /build/repo at the same relative path`,
    );
    assert.ok(
      joined.includes(`echo "\${PATCH_${n}_SHA256}  /build/repo/${patch.path}" | sha256sum -c -`),
      `sha256 gate for ${patch.path} missing`,
    );
  }

  const replaceOnce = (text, from, to) => {
    assert.equal(text.split(from).length, 2, 'SETUP: mutate the one actual fragment, never an absent fixture token');
    return text.replace(from, to);
  };
  const link = 'ln -s /build/repo/.sdd/cache/runner-build/openspec-project/node_modules/.bin/openspec /usr/local/bin/openspec';
  const install = "run('npm',['ci','--prefix','/build/repo/.sdd/cache/runner-build/openspec-project','--offline','--ignore-scripts','--no-audit','--no-fund']);";
  const variants = [
    ['dropped recorded patch COPY', text => text.split('\n').filter((line) => !line.includes(record.sourceInputs.patches[0].path)).join('\n'), 'PATCH_CHAIN_INCOMPLETE'],
    ['dropped recorded patch ARG', text => text.split('\n').filter((line) => line !== 'ARG PATCH_1_SHA256').join('\n'), 'PATCH_CHAIN_INCOMPLETE'],
    ['find-based entrypoint', text => `${text}\nRUN cometEntry=$(find /build -path "*/work/bin/comet.js" -type f | head -n 1)\n`, 'ENTRYPOINT_NONDETERMINISTIC'],
    ['appended trailing execution', text => text + '\nRUN true\n', 'RUNTIME_RECIPE_UNSAFE'],
    ['trailing heredoc execution', text => text + "\nRUN <<'UNAPPROVED'\ntrue\nUNAPPROVED\n", 'RUNTIME_RECIPE_UNSAFE'],
    ['appended frontend parser directive', text => text + '\n# syntax=docker/dockerfile:1\n', 'RUNTIME_RECIPE_UNSAFE'],
    ['appended escape parser directive', text => text + '\n# escape=`\n', 'RUNTIME_RECIPE_UNSAFE'],
    ['appended check parser directive', text => text + '\n# check=skip=all\n', 'RUNTIME_RECIPE_UNSAFE'],
    ['incomplete trailing comment', text => text + '\n# incomplete metadata', 'RUNTIME_RECIPE_UNSAFE'],
    ['trailing shell continuation', text => text + '\n\\\n', 'RUNTIME_RECIPE_UNSAFE'],
    ['fresh final stage discards history', text => text + '\nFROM ${RUNNER_BASE_IMAGE}\n', 'RUNTIME_RECIPE_UNSAFE'],
    ['CLI retained only in Docker comment', text => replaceOnce(text, link, 'true') + '\n# ' + link + '\n', 'RUNTIME_RECIPE_UNSAFE'],
    ['install retained only in JS string', text => replaceOnce(text, install, 'const inertInstall = ' + JSON.stringify(install) + ';'), 'RUNTIME_RECIPE_UNSAFE'],
  ];
  for (const [name, mutate, expected] of variants) {
    const directory = makeFixtureDir(({ read, write }) => {
      const original = read('Dockerfile'), changed = mutate(original);
      assert.notEqual(changed, original, 'SETUP: negative must change the actual recipe');
      write('Dockerfile', changed);
    });
    const result = runCli(['validate', '--registry', registryPath, '--dir', directory, '--json']);
    assert.equal(result.status, 2, `${name} must fail closed`);
    const report = parseJsonOut(result, name);
    assert.ok(codes(report).includes(expected), `${name} must report ${expected}, got: ${JSON.stringify(codes(report))}`);
  }

  // 安全元数据仍然是通用卫生检查：宿主路径与秘密形状即使出现在注释里也拒绝，且不回显。
  const privateMarker = 's' + 'k-' + 'i02synthetic'.repeat(4);
  for (const [suffix, expected, hidden] of [
    ['\n# fixture path /Users/i02-synthetic/sentinel\n', 'DOCKERFILE_HOST_PATH', '/Users/i02-synthetic/sentinel'],
    ['\n# fixture placeholder ' + privateMarker + '\n', 'SECRET_PLAINTEXT_FORBIDDEN', privateMarker],
  ]) {
    const directory = makeFixtureDir(({ read, write }) => write('Dockerfile', read('Dockerfile') + suffix));
    const result = runCli(['validate', '--registry', registryPath, '--dir', directory, '--json']);
    assert.equal(result.status, 2);
    const report = parseJsonOut(result, 'unsafe metadata');
    assert.ok(codes(report).includes(expected));
    assert.equal((result.stdout + result.stderr).includes(hidden), false, 'refusal must not echo untrusted comment bytes');
  }

  // 安全完整元数据跟随冻结模板原样传输（仍可验证通过）。
  const metadata = '\n \t\n  # independent fixture metadata $(true)\n\t# ordinary comment\n';
  const accepted = makeFixtureDir(({ read, write }) => write('Dockerfile', read('Dockerfile') + metadata));
  const acceptedRun = runCli(['validate', '--registry', registryPath, '--dir', accepted, '--json']);
  assert.equal(acceptedRun.status, 0, 'safe complete metadata must preserve the frozen template');
});

test('Runner Compose security uses actual YAML semantics for quoted keys, flow mounts and named-volume drivers', async (t) => {
  const cases = [
    ['quoted flow volume', (text) => text.replace('    volumes:\n      - ws-author:/workspace', '    "volumes": ["/etc:/input"]'), 'HOST_MOUNT_FORBIDDEN'],
    ['quoted privilege', (text) => text.replace('  comet-author:\n', '  comet-author:\n    "privileged": true\n'), 'PRIVILEGED_FORBIDDEN'],
    ['named volume remapped to host', (text) => text.replace('\n  ws-author:\n', '\n  ws-author:\n    driver: local\n    driver_opts: {type: none, o: bind, device: /etc}\n'), 'HOST_MOUNT_FORBIDDEN'],
  ];
  for (const [name, change, code] of cases) await t.test(name, () => {
    const dir = makeFixtureDir(({ read, write }) => { const original = read('compose.yaml'), changed = change(original); assert.notEqual(changed, original); write('compose.yaml', changed); });
    const yaml = fs.readFileSync(path.join(dir, 'compose.yaml'), 'utf8');
    const proof = spawnSync('python3', ['-I', '-c', 'import yaml,json,sys;d=yaml.safe_load(sys.stdin.read());print(json.dumps({"parsed":isinstance(d,dict),"yaml":yaml.__version__}))'], { input: yaml, encoding: 'utf8', timeout: 5000 });
    assert.equal(proof.status, 0, 'this counterexample must be valid YAML, not a parser/setup error');
    assert.equal(JSON.parse(proof.stdout).parsed, true);
    const result = runCli(['validate', '--registry', registryPath, '--dir', dir, '--json']);
    assert.equal(result.status, 2, 'valid unsafe YAML must be semantically refused before Docker');
    assert.ok(codes(parseJsonOut(result, name)).includes(code), 'the refusal must identify the actual permission boundary');
  });
});

test('CLI-only Runner refuses retired endpoint selection before any network or runtime observation', () => {
  const result = runCli(['probe', '--case', 'role-denial', '--endpoint', 'i02-synthetic-endpoint-marker', '--json']);
  assert.equal(result.status, 1, 'the excluded HTTP control API is not a Runner qualification input');
  const report = parseJsonOut(result, 'retired endpoint');
  assert.equal(report.status, 'INPUT_INVALID');
  assert.equal(report.ready, false);
  assert.doesNotMatch(result.stdout + result.stderr, /i02-synthetic-endpoint-marker/);
});

test('all Runner entrypoints reject malformed reference catalogs structurally before any runtime action', async (t) => {
  for (const command of [['validate'], ['qualify'], ['up'], ['probe', '--case', 'role-denial'], ['build-plan']]) {
    await t.test(command[0], () => {
      const file = path.join(privateTmp('i02-invalid-refs-'), 'refs.json');
      fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, interface: 'SecretRef.v1', refs: null }));
      const result = runCli([...command, '--refs', file, '--json']);
      assert.equal(result.status, 1, 'invalid input must not be interpreted as absent qualification');
      const report = parseJsonOut(result, command[0]);
      assert.equal(report.status, 'INPUT_INVALID');
      assert.equal(report.ready, false);
      assert.doesNotMatch(result.stdout + result.stderr, /TypeError|at file:|host-private-marker/);
    });
  }
});

test('Runner public input matrix rejects null, wrong containers and null elements across every shared caller', async (t) => {
  const cases = [
    ['refs root null', null, () => null, 'refs'], ['refs not array', null, () => ({ interface: 'SecretRef.v1', refs: {} }), 'refs'],
    ['refs null element', null, () => ({ interface: 'SecretRef.v1', refs: [null] }), 'refs'],
    ['registry root null', null, () => null, 'registry'], ['registry null project', null, (d) => ({ ...d, project: null }), 'registry'],
    ['registry null github', null, (d) => ({ ...d, project: { ...d.project, github: null } }), 'registry'],
    ['registry null resource', null, (d) => ({ ...d, resources: [null] }), 'registry'],
    ['policy null', null, () => null, 'policy'], ['policy roles object', null, (d) => ({ ...d, roles: {} }), 'policy'],
    ['policy categories null', null, (d) => ({ ...d, evidenceCategories: null }), 'policy'],
    ['image null', 'image.lock.json', () => null], ['image future schema', 'image.lock.json', (d) => ({ ...d, schemaVersion: 2 })],
    ['image components object', 'image.lock.json', (d) => ({ ...d, components: {} })], ['image component null', 'image.lock.json', (d) => ({ ...d, components: [null] })],
    ['source null', 'image.lock.json', (d) => ({ ...d, sourceInputs: null })], ['patch null', 'image.lock.json', (d) => ({ ...d, sourceInputs: { ...d.sourceInputs, patches: [null] } })],
    ['retirement null', 'image.lock.json', (d) => ({ ...d, retirement: null })],
    ['retiredSurface object', 'image.lock.json', (d) => ({ ...d, retirement: { ...d.retirement, retiredSurface: {} } })],
    ['roles null document', 'role-policy.json', () => null], ['roles object', 'role-policy.json', (d) => ({ ...d, roles: {} })],
    ['roles null element', 'role-policy.json', (d) => ({ ...d, roles: [null] })], ['runnerRefs object', 'role-policy.json', (d) => ({ ...d, runnerRefs: {} })],
    ['mounts root array', 'workspace-mounts.json', () => []], ['mount null control', 'workspace-mounts.json', (d) => ({ ...d, controlVolumes: [null] })],
    ['mount null workspace', 'workspace-mounts.json', (d) => ({ ...d, roleWorkspaces: [null] })], ['mount worker list object', 'workspace-mounts.json', (d) => ({ ...d, rules: { ...d.rules, workerRoles: {} } })],
    ['authority root null', 'authority-registration.example.json', () => null], ['authority registrations object', 'authority-registration.example.json', (d) => ({ ...d, registrations: {} })],
    ['authority null registration', 'authority-registration.example.json', (d) => ({ ...d, registrations: [null] })],
  ];
  const paths = { registry: registryPath, refs: refsPath, policy: path.join(repoRoot, 'infra/delivery/qualification-policy.json') };
  for (const [name, domain, mutate, override] of cases) await t.test(name, () => {
    let args;
    if (domain) args = ['--dir', makeFixtureDir(({ json, writeJson }) => writeJson(domain, mutate(json(domain))))];
    else {
      const file = path.join(privateTmp('i02-input-matrix-'), 'input.json');
      fs.writeFileSync(file, JSON.stringify(mutate(JSON.parse(fs.readFileSync(paths[override])))));
      args = ['--' + override, file];
    }
    for (const command of [['validate'], ['qualify'], ['up'], ['probe', '--case', 'role-denial'], ['build-plan']]) {
      const result = runCli([...command, ...args, '--json']);
      assert.equal(result.status, 1, `${name}/${command[0]} must be an input refusal`);
      const parsed = parseJsonOut(result, name);
      assert.equal(parsed.status, 'INPUT_INVALID');
      assert.equal(parsed.ready, false);
      assert.doesNotMatch(result.stdout + result.stderr, /TypeError|SyntaxError|at file:/);
    }
  });
});

test('Runner diagnostics never echo malformed JSON or input paths and preserve actual input byte hashes', () => {
  const marker = 'i02-short-private-note';
  for (const option of ['registry', 'refs', 'policy']) {
    const file = path.join(privateTmp('i02-diagnostics-'), marker + '.json');
    fs.writeFileSync(file, '{"note":"' + marker + '"');
    const result = runCli(['validate', '--' + option, file, '--json']);
    assert.equal(result.status, 1);
    assert.equal(parseJsonOut(result, option).code, 'INPUT_JSON_INVALID');
    assert.doesNotMatch(result.stdout + result.stderr, new RegExp(marker));
  }
  const domain = makeFixtureDir(({ write }) => write('role-policy.json', '{"note":"' + marker + '"'));
  const result = runCli(['qualify', '--registry', registryPath, '--dir', domain, '--json']);
  assert.equal(result.status, 1); assert.doesNotMatch(result.stdout + result.stderr, new RegExp(marker));
  const qualified = runCli(['qualify', '--registry', registryPath, '--json']), report = parseJsonOut(qualified, 'raw source hash');
  for (const file of DOMAIN_FILES) assert.equal(report.inputs.domainFiles[file], sha256File(path.join(runnerDir, file)), 'hash the actual original bytes, not reserialized JSON');
});

test('retired domain files are no longer registered in the default resource chain and old patch files are gone', () => {
  // 六角色不再默认注册：registry 没有任何 runner-stack 资源条目（I01 目录只保留 ref 声明）。
  const registryDoc = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  const serialized = JSON.stringify(registryDoc);
  for (const role of RUNNER_ROLES) {
    assert.ok(!serialized.includes(`"comet-${role}"`), `registry must not register a comet-${role} service resource`);
  }
  assert.ok(!serialized.includes('infra/delivery/runner/compose.yaml'), 'registry must not bind the retired compose file as a default resource');
  // 旧补丁文件按处置删除：0001/0002/0004 删、0003 由 0005 接替删（amendment patch_disposition）。
  for (const retired of [
    'integrations/comet/patches/0001-matt-method-profile.patch',
    'integrations/comet/patches/0002-managed-delivery-runtime.patch',
    'integrations/comet/patches/0003-post-archive-closeout.patch',
    'integrations/comet/patches/0004-upstream-security-backports.patch',
    'integrations/comet/patches/tests/1_6.patch',
    'integrations/comet/patches/tests/2_4.patch',
    'integrations/comet/patches/tests/4_6.patch',
  ]) {
    assert.equal(fs.existsSync(path.join(repoRoot, retired)), false, `retired patch file must be removed from the tree: ${retired}`);
  }
  // 后继 0005（P1_4 所有）不被本退休触碰。
  assert.equal(fs.existsSync(path.join(repoRoot, 'integrations/comet/patches/0005-comet-050-kt-closeout.patch')), true, 'the successor 0005 patch stays untouched');
  // 退休识别不虚构：记录里的补丁 sha 与已删除磁盘文件的 sha 一致性只能靠 git 历史，不由本测试伪造。
});
test('controller-fixed CLI job driver exposes physical lifecycle without issuing a dispatch or accepting job-selected authority', async () => {
  const api = await import(new URL('../tools/infra/runner.mjs', import.meta.url));
  assert.equal(typeof api.createCliJobDriver, 'function', 'the original registered launcher needs a physical process lifecycle, not a permanent up stub');
  assert.throws(() => api.createCliJobDriver({ authority: { verifyDispatch: () => ({ ok: true }) } }), /REGISTRATION_REQUIRED/);
});

function processRegistrationFixture() {
  const namespace = 'sdd-harness-i02-fixture';
  return { schemaVersion: 1, project: 'sdd-harness-pilot', authorityId: 'fixture-authority-not-production', workspaceId: 'fixture-workspace',
    namespace, engineId: 'fixture-engine', dockerContext: 'fixture-context', imageDigest: 'sha256:' + 'a'.repeat(64),
    sdkFingerprint: FIXTURE_SDK_FINGERPRINT, bootstrapDigest: 'b'.repeat(64),
    controlVolumes: { state: namespace + '_state', receipts: namespace + '_receipts', issuance: namespace + '_issuance' },
    roles: RUNNER_ROLES.map((role) => ({ id: role, actionRole: role, containerRole: role, principalId: 'fixture-principal:' + role, workspaceVolume: namespace + '_ws-' + role })) };
}

test('CLI job registration cannot give a worker the control volume or share registered role identities', async () => {
  const { createCliJobDriver } = await import(new URL('../tools/infra/runner.mjs', import.meta.url));
  const registration = processRegistrationFixture();
  const options = { authority: { verifyDispatch: () => ({ ok: false }) }, registration, dockerExecutable: process.execPath, dockerSha256: sha256File(process.execPath) };
  registration.roles.find((role) => role.containerRole === 'author').workspaceVolume = registration.controlVolumes.state;
  assert.throws(() => createCliJobDriver(options), /REGISTRATION_INVALID/, 'a registered worker workspace cannot alias controller state');
  const shared = processRegistrationFixture();
  shared.roles[1].principalId = shared.roles[0].principalId;
  assert.throws(() => createCliJobDriver({ ...options, registration: shared }), /REGISTRATION_INVALID/, 'role labels cannot make a reused registered identity independent');
});

test('physical CLI job lifecycle preserves one authorized execution and cannot expand its fixed registration', async () => {
  const { createCliJobDriver } = await import(new URL('../tools/infra/runner.mjs', import.meta.url));
  const { createLaunchAuthority, envelopeDigest } = await import(new URL('../lib/delivery/evidence.js', import.meta.url));
  const dir = privateTmp('i02-driver-command-contract-'), stateFile = path.join(dir, 'state.json'), traceFile = path.join(dir, 'trace.json');
  const registration = processRegistrationFixture(), binary = path.join(dir, 'fixture-docker');
  const script = `#!${process.execPath}
import fs from 'node:fs';
const file=${JSON.stringify(stateFile)},traceFile=${JSON.stringify(traceFile)},reg=${JSON.stringify(registration)};
const a=process.argv.slice(2);if(a[0]!=='--context'||a[1]!==reg.dockerContext)process.exit(96);a.splice(0,2);
const trace=fs.existsSync(traceFile)?JSON.parse(fs.readFileSync(traceFile)):[];trace.push(a);fs.writeFileSync(traceFile,JSON.stringify(trace));
let s=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):{};
const out=x=>process.stdout.write(JSON.stringify(x)+'\\n'),save=()=>fs.writeFileSync(file,JSON.stringify(s));
if(a[0]==='info')out(reg.engineId);
else if(a[0]==='image')out({id:reg.imageDigest,os:'linux',architecture:'arm64',sdk:reg.sdkFingerprint,bootstrap:reg.bootstrapDigest});
else if(a[0]==='volume')out({name:a[2],driver:'local',hasOptions:false,project:reg.project,authority:reg.authorityId,workspace:reg.workspaceId});
else if(a[0]==='container'){if(s.container)out(s.container.id);}
else if(a[0]==='create'){
 const labels={};for(let i=0;i<a.length;i++)if(a[i]==='--label'){const [k,...v]=a[i+1].split('=');labels[k]=v.join('=');}
 s.container={id:'c'.repeat(64),name:'/'+a[a.indexOf('--name')+1],cwd:a[a.indexOf('--workdir')+1],mounts:a.filter(v=>v.startsWith('type=volume,')).map(v=>{const m=Object.fromEntries(v.split(',').map(x=>x.split('=')));return{type:m.type,name:m.source,destination:m.target,rw:true};}),image:reg.imageDigest,state:'created',exitCode:0,user:'10001:10001',readOnly:true,privileged:false,capDrop:['ALL'],capAdd:null,securityOpt:['no-new-privileges:true'],network:'none',project:labels['sdd.project'],authority:labels['sdd.authority'],workspace:labels['sdd.workspace'],execution:labels['sdd.execution'],run:labels['sdd.run'],registration:labels['sdd.registration']};save();process.stdout.write(s.container.id+'\\n');
}else if(a[0]==='inspect')out(s.container);
else if(a[0]==='start'){
 s.container.state='running';save();let input='';process.stdin.on('data',x=>input+=x);process.stdin.on('end',()=>{const packet=JSON.parse(input);s.container.state='exited';save();out({fixtureOnly:true,execution:packet.job.execution});});
}else if(a[0]==='stop'){s.container.state='exited';s.container.exitCode=143;save();out(s.container.id);}
else process.exit(95);
`;
  fs.writeFileSync(binary, script); fs.chmodSync(binary, 0o755);
  const authority = createLaunchAuthority({ secret: crypto.randomBytes(32).toString('hex') });
  const driver = createCliJobDriver({ authority, registration, dockerExecutable: binary, dockerSha256: sha256File(binary) });
  const role = registration.roles.find((item) => item.containerRole === 'author');
  const job = { schemaVersion: 1, run: 'fixture-original-run', execution: 'fixture-author-job', argv: ['state', 'gates', 'fixture'] };
  const action = { schemaVersion: 1, profile: 'comet-managed-v2', runnerId: 'fixture-runner', run: job.run, gate: 'R', action: 'fixture-role-command',
    execution: job.execution, role: role.actionRole, revision: 'fixture-r1', attempt: 1, epoch: 1, inputDigest: 'd'.repeat(64), policyDigest: 'e'.repeat(64), environmentDigest: 'f'.repeat(64),
    workPackage: { id: 'I02-command-contract-only', taskIds: ['I02'] }, methods: [{ name: 'tdd', version: 'fixture-only', ref: '.agents/skills/tdd/SKILL.md', digest: '1'.repeat(64) }],
    allowedPaths: ['fixture'], allowedTools: ['read_file'], inputs: [
      { name: 'runner-job', ref: 'fixture/job.json', digest: envelopeDigest(job) },
      { name: 'runner-registration', ref: 'fixture/registration.json', digest: driver.registrationDigest },
      { name: 'runner-role-binding', ref: 'fixture/author.json', digest: envelopeDigest(role) },
    ], outputs: [{ name: 'result', ref: 'fixture/result.json' }] };
  const dispatch = authority.issueDispatch({ ...action, actionBinding: action });
  const request = { dispatch, currentActionBinding: action, job };
  assert.throws(() => driver.startCliJob({ ...request, job: { ...job, role: 'controller' } }), /JOB_INPUT_INVALID/);
  assert.throws(() => driver.startCliJob({ ...request, job: { ...job, argv: ['--help'] } }), /JOB_BINDING_MISMATCH/);
  assert.throws(() => driver.startCliJob({ ...request, currentActionBinding: { ...action, attempt: 2 } }), /CURRENT_DISPATCH_REQUIRED/);
  assert.equal(fs.existsSync(traceFile), false, 'unbound worker fields must not reach any external CLI');
  const started = driver.startCliJob(request);
  assert.equal(started.resumed, false);
  const terminal = await started.terminal;
  assert.equal(terminal.clientExitCode, 0);
  assert.equal(JSON.parse(terminal.stdoutBytes).execution, job.execution);
  const observed = driver.observeCliJob({ ...request, handle: started.handle });
  assert.equal(observed.observation.state, 'exited');
  const badMount = JSON.parse(fs.readFileSync(stateFile));
  const originalMounts = structuredClone(badMount.container.mounts);
  badMount.container.mounts = [{ type: 'volume', name: registration.controlVolumes.state, destination: '/workspace', rw: true }];
  fs.writeFileSync(stateFile, JSON.stringify(badMount));
  assert.throws(() => driver.observeCliJob({ ...request, handle: started.handle }), /PROCESS_SCOPE_MISMATCH/, 'actual inspected mounts must match the fixed role registration');
  badMount.container.mounts = originalMounts; fs.writeFileSync(stateFile, JSON.stringify(badMount));
  const duplicate = driver.startCliJob(request);
  assert.equal(duplicate.resumed, true);
  assert.equal(duplicate.terminal, null);
  let trace = JSON.parse(fs.readFileSync(traceFile));
  assert.equal(trace.filter((argv) => argv[0] === 'start').length, 1, 'a repeated original execution observes its original process');
  const create = trace.find((argv) => argv[0] === 'create');
  assert.ok(create.includes('--read-only') && create.includes('--pull=never'));
  const mounts = create.filter((value) => value.startsWith('type=volume,'));
  assert.equal(mounts.length, 1, 'the author gets exactly its registered workspace');
  assert.ok(mounts[0].includes(role.workspaceVolume));
  assert.doesNotMatch(create.join(' '), /docker\.sock|type=bind|\/comet\/state|--privileged|--env/);
  assert.throws(() => driver.stopCliJob({ ...request, handle: { ...started.handle, execution: 'another-execution' } }), /PROCESS_HANDLE_INVALID/);
  assert.equal(JSON.parse(fs.readFileSync(traceFile)).filter((argv) => argv[0] === 'stop').length, 0);
  const state = JSON.parse(fs.readFileSync(stateFile)); state.container.state = 'running'; fs.writeFileSync(stateFile, JSON.stringify(state));
  assert.equal(driver.stopCliJob({ ...request, handle: started.handle }).observation.exitCode, 143);
  assert.equal(terminal.managedClosureEligible, false, 'the external-CLI fixture proves a component protocol, not OS or real role qualification');
});
// An executable Node fake implements only the pinned Docker CLI process
// protocol. Its private containers.json is fixture engine data, never a
// product slot/lease table, role qualification, or real Docker observation.
function publishExecutionFixtureJson(file, value) {
  const pending = file + '.' + process.pid + '.' + crypto.randomUUID() + '.tmp';
  try {
    fs.writeFileSync(pending, JSON.stringify(value), { flag: 'wx' });
    fs.renameSync(pending, file);
  } finally { fs.rmSync(pending, { force: true }); }
}

async function executionSlotFixture({ namespace } = {}) {
  const { createCliJobDriver } = await import(new URL('../tools/infra/runner.mjs', import.meta.url));
  const { createLaunchAuthority, envelopeDigest } = await import(new URL('../lib/delivery/evidence.js', import.meta.url));
  const root = privateTmp('i02-execution-slot-'), stateFile = path.join(root, 'containers.json'), traceFile = path.join(root, 'trace');
  fs.mkdirSync(traceFile);
  const registration = processRegistrationFixture(), binary = path.join(root, 'fake-docker.mjs');
  if (namespace) {
    const before = registration.namespace;
    registration.namespace = namespace;
    for (const key of Object.keys(registration.controlVolumes)) registration.controlVolumes[key] = registration.controlVolumes[key].replace(before, namespace);
    for (const role of registration.roles) role.workspaceVolume = role.workspaceVolume.replace(before, namespace);
  }
  const script = String.raw`#!${process.execPath}
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
${publishExecutionFixtureJson.toString()}
const file=${JSON.stringify(stateFile)}, traceFile=${JSON.stringify(traceFile)}, reg=${JSON.stringify(registration)};
const args=process.argv.slice(2);
if(args[0]!=='--context'||args[1]!==reg.dockerContext) process.exit(96);
args.splice(0,2);
// Independent immutable command records cannot lose another process's event.
publishExecutionFixtureJson(path.join(traceFile,crypto.randomUUID()+'.json'),args);
const read=()=>fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):{containers:[],starts:0};
const state=read();
const save=(value=state)=>publishExecutionFixtureJson(file,value);
const out=value=>process.stdout.write(JSON.stringify(value)+'\n');
if(args[0]==='info') out(reg.engineId);
else if(args[0]==='image') out({id:reg.imageDigest,os:'linux',architecture:'arm64',sdk:reg.sdkFingerprint,bootstrap:reg.bootstrapDigest});
else if(args[0]==='volume') out({name:args[2],driver:'local',hasOptions:false,project:reg.project,authority:reg.authorityId,workspace:reg.workspaceId});
else if(args[0]==='container'&&args[1]==='ls') {
  if(state.listError) process.exit(91);
  if(state.listMalformed) process.stdout.write('not-json\n');
  else {
    const filters=args.flatMap((value,index)=>value==='--filter'?[args[index+1]]:[]);
    for(const value of state.containers) {
      const matches=filters.every(filter=>filter.startsWith('name=')&&new RegExp(filter.slice(5)).test(value.name));
      if(matches) out(value.id);
    }
  }
} else if(args[0]==='create') {
  const name='/'+args[args.indexOf('--name')+1];
  if(state.containers.some(value=>value.name===name)) process.exit(92);
  const labels={};for(let i=0;i<args.length;i++) if(args[i]==='--label') {const [key,...rest]=args[i+1].split('=');labels[key]=rest.join('=');}
  state.sequence=(state.sequence??state.containers.length)+1;
  const id=state.sequence.toString(16).padStart(64,'0');
  state.containers.push({id,name,cwd:args[args.indexOf('--workdir')+1],mounts:args.filter(value=>value.startsWith('type=volume,')).map(value=>{const fields=Object.fromEntries(value.split(',').map(part=>part.split('=')));return {type:fields.type,name:fields.source,destination:fields.target,rw:true};}),image:reg.imageDigest,state:'created',exitCode:0,user:'10001:10001',readOnly:true,privileged:false,capDrop:['ALL'],capAdd:null,securityOpt:['no-new-privileges:true'],network:'none',project:labels['sdd.project'],authority:labels['sdd.authority'],workspace:labels['sdd.workspace'],execution:labels['sdd.execution'],run:labels['sdd.run'],registration:labels['sdd.registration']});
  if(state.peerAfterCreate) {state.containers.push(state.peerAfterCreate);delete state.peerAfterCreate;}
  save();process.stdout.write(id+'\n');
} else if(args[0]==='inspect') {
  const value=state.containers.find(value=>value.id===args[1]);if(!value) process.exit(93);out(value);
} else if(args[0]==='start') {
  const value=state.containers.find(value=>value.id===args.at(-1));if(!value||value.state!=='created') process.exit(94);
  state.starts++;value.state='running';save();process.send?.({boundary:'running-published'});let input='';process.stdin.on('data',bytes=>input+=bytes);
  process.stdin.on('end',()=>{const packet=JSON.parse(input);if(packet.job.execution!==value.execution||packet.job.run!==value.run) process.exit(95);
    // stdin may stay open while independent fixture state is published.
    const latest=read(), finished=latest.containers.find(item=>item.id===value.id);
    if(!finished||finished.execution!==value.execution||finished.run!==value.run) process.exit(95);
    finished.state='exited';save(latest);out({fixtureOnly:true,execution:packet.job.execution});});
} else if(args[0]==='stop') {
  const value=state.containers.find(value=>value.id===args.at(-1));if(!value) process.exit(93);value.state='exited';value.exitCode=143;save();out(value.id);
} else process.exit(97);
`;
  fs.writeFileSync(binary, script); fs.chmodSync(binary, 0o755);
  const secret = crypto.randomBytes(32).toString('hex');
  const authority = createLaunchAuthority({ secret });
  const options = { authority, registration, dockerExecutable: binary, dockerSha256: sha256File(binary) };
  const driver = createCliJobDriver(options);
  const request = (execution, { run = 'fixture-original-run', argv = ['fixture-command'], roleId = 'author' } = {}) => {
    const role = registration.roles.find(value => value.id === roleId);
    const job = { schemaVersion: 1, run, execution, argv };
    const action = { schemaVersion: 1, profile: 'comet-managed-v2', runnerId: 'fixture-runner', run, gate: 'R', action: 'fixture-role-command', execution,
      role: role.actionRole, revision: 'fixture-r1', attempt: 1, epoch: 1, inputDigest: 'd'.repeat(64), policyDigest: 'e'.repeat(64), environmentDigest: 'f'.repeat(64),
      workPackage: { id: 'I02-execution-slot-component', taskIds: ['I02'] }, methods: [{ name: 'tdd', version: 'fixture-only', ref: '.agents/skills/tdd/SKILL.md', digest: '1'.repeat(64) }],
      allowedPaths: ['fixture'], allowedTools: ['read_file'], inputs: [
        { name: 'runner-job', ref: 'fixture/job.json', digest: envelopeDigest(job) },
        { name: 'runner-registration', ref: 'fixture/registration.json', digest: driver.registrationDigest },
        { name: 'runner-role-binding', ref: 'fixture/role.json', digest: envelopeDigest(role) },
      ], outputs: [{ name: 'result', ref: 'fixture/result.json' }] };
    return { job, currentActionBinding: action, dispatch: authority.issueDispatch({ ...action, actionBinding: action }) };
  };
  return { root, registration, driver, options, secret, binary, stateFile, traceFile, request,
    read: () => JSON.parse(fs.readFileSync(stateFile)), write: value => publishExecutionFixtureJson(stateFile, value),
    trace: () => fs.readdirSync(traceFile).filter(name => name.endsWith('.json')).sort().map(name => JSON.parse(fs.readFileSync(path.join(traceFile, name)))),
    fresh: () => createCliJobDriver(options),
  };
}

test('execution slot permits a new authorized job after the same role terminal execution without weakening old handle checks', async () => {
  const f = await executionSlotFixture();
  const firstRequest = f.request('fixture-r1-execution');
  const first = f.driver.startCliJob(firstRequest);
  const firstTerminal = await first.terminal;
  assert.equal(firstTerminal.clientExitCode, 0);
  assert.equal(JSON.parse(firstTerminal.stdoutBytes).execution, firstRequest.job.execution);
  const secondRequest = f.request('fixture-r2-execution');
  const second = f.driver.startCliJob(secondRequest);
  const secondTerminal = await second.terminal;
  assert.equal(secondTerminal.clientExitCode, 0);
  assert.equal(JSON.parse(secondTerminal.stdoutBytes).execution, secondRequest.job.execution);
  assert.notEqual(first.handle.containerId, second.handle.containerId);
  const state = f.read();
  assert.equal(state.containers.length, 2);
  assert.equal(new Set(state.containers.map(value => value.name)).size, 2);
  assert.equal(state.starts, 2, 'exactly one physical start per authorized original execution');
  const repeated = f.fresh().startCliJob(firstRequest);
  assert.equal(repeated.resumed, true);
  assert.equal(repeated.terminal, null);
  assert.deepEqual(repeated.handle, first.handle);
  assert.equal(f.read().starts, 2);
  assert.throws(() => f.driver.observeCliJob({ ...secondRequest, handle: first.handle }), /PROCESS_HANDLE_INVALID/);
  assert.throws(() => f.driver.observeCliJob({ ...secondRequest, handle: { ...first.handle, execution: secondRequest.job.execution } }), /PROCESS_SCOPE_MISMATCH/);
});

function coldExecutionLookup(fixture, request, operation = 'resolveCliJob') {
  const payload = path.join(fixture.root, 'cold-input.json'), entry = path.join(fixture.root, 'cold-client.mjs');
  // A generated fixture HMAC seed is private test data, not a provisioned
  // credential. It is never included in stdout or tracked evidence.
  fs.writeFileSync(payload, JSON.stringify({ request, operation, secret: fixture.secret, registration: fixture.registration,
    binary: fixture.binary, dockerSha256: fixture.options.dockerSha256 }));
  fs.writeFileSync(entry, `import fs from 'node:fs';
import {createCliJobDriver} from ${JSON.stringify(new URL('../tools/infra/runner.mjs', import.meta.url).href)};
import {createLaunchAuthority} from ${JSON.stringify(new URL('../lib/delivery/evidence.js', import.meta.url).href)};
const data=JSON.parse(fs.readFileSync(process.argv[2]));
if(!['resolveCliJob','startCliJob'].includes(data.operation)) throw new Error('fixture operation');
const driver=createCliJobDriver({authority:createLaunchAuthority({secret:data.secret}),registration:data.registration,dockerExecutable:data.binary,dockerSha256:data.dockerSha256});
process.stdout.write(JSON.stringify(driver[data.operation](data.request))+'\\n');
`);
  const result = spawnSync(process.execPath, [entry, payload], { encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('execution slot cold resolution is read-only and ABSENT never grants launch permission', async () => {
  const f = await executionSlotFixture(), request = f.request('fixture-cold-original');
  const absent = coldExecutionLookup(f, request);
  assert.equal(absent.found, false);
  assert.equal(absent.status, 'ABSENT');
  assert.equal(absent.launchPermitted, false);
  assert.equal(absent.managedClosureEligible, false);
  assert.equal(absent.handle, null);
  assert.equal(f.trace().some(args => ['create', 'start', 'stop'].includes(args[0])), false);
  const first = f.driver.startCliJob(request);
  const duplicate = f.fresh().startCliJob(request);
  await Promise.all([first.terminal, duplicate.terminal].filter(Boolean));
  assert.equal(duplicate.terminal, null);
  assert.deepEqual(duplicate.handle, first.handle);
  const found = coldExecutionLookup(f, request);
  assert.equal(found.found, true);
  assert.equal(found.launchPermitted, false);
  assert.deepEqual(found.handle, first.handle);
  assert.equal(found.observation.state, 'exited');
  const coldRepeat = coldExecutionLookup(f, request, 'startCliJob');
  assert.equal(coldRepeat.resumed, true);
  assert.equal(coldRepeat.terminal, null);
  assert.deepEqual(coldRepeat.handle, first.handle);
  assert.equal(f.read().starts, 1);
  assert.equal(f.trace().filter(args => args[0] === 'start').length, 1, 'both live and cold re-entry must preserve the single original start');
});

test('execution slot refuses old active or unknown role writers without creating a new job', async () => {
  const f = await executionSlotFixture(), original = f.request('fixture-old-author');
  const started = f.driver.startCliJob(original); await started.terminal;
  const saved = f.read();
  for (const state of ['created', 'running', 'paused', 'restarting', 'unknown', 'removing', 'dead', 'exited']) {
    const current = structuredClone(saved); current.containers[0].state = state;
    if (state === 'exited') current.containers[0].exitCode = null;
    f.write(current);
    assert.throws(() => f.fresh().startCliJob(f.request('fixture-next-author')), /PROCESS_ROLE_BUSY|PROCESS_START_UNKNOWN/, state);
    assert.equal(f.read().containers.length, 1, state);
    assert.equal(f.read().starts, 1, state);
  }
  const legacy = structuredClone(saved);
  legacy.containers[0].name = '/' + f.registration.namespace + '-author';
  legacy.containers[0].state = 'running'; f.write(legacy);
  assert.throws(() => f.driver.startCliJob(f.request('fixture-after-legacy')), /PROCESS_ROLE_BUSY/);
  assert.equal(f.read().starts, 1);
});

test('execution slot observes a created original resource after an unknown start without starting it again', async () => {
  const f = await executionSlotFixture(), request = f.request('fixture-created-original');
  const first = f.driver.startCliJob(request); await first.terminal;
  const state = f.read(); state.containers[0].state = 'created'; f.write(state);
  const lookup = coldExecutionLookup(f, request);
  assert.equal(lookup.found, true);
  assert.equal(lookup.observation.state, 'created');
  assert.equal(lookup.launchPermitted, false);
  const resumed = f.fresh().startCliJob(request);
  assert.equal(resumed.resumed, true);
  assert.equal(resumed.terminal, null);
  assert.equal(f.read().starts, 1, 'created is not permission to re-run an unknown original start');
});

test('execution slot preserves exact legacy observation but rejects copied handles and changed scope', async () => {
  const f = await executionSlotFixture(), request = f.request('fixture-legacy-original');
  const first = f.driver.startCliJob(request); await first.terminal;
  const saved = f.read(); saved.containers[0].name = '/' + f.registration.namespace + '-author'; f.write(saved);
  const lookup = f.fresh().resolveCliJob(request);
  assert.equal(lookup.found, true);
  assert.deepEqual(lookup.handle, first.handle);
  assert.deepEqual(f.driver.observeCliJob({ ...request, handle: first.handle }).handle, first.handle);
  assert.equal(f.driver.startCliJob(request).terminal, null);
  assert.equal(f.read().starts, 1);
  for (const mutate of [
    value => { value.name = '/outside-namespace-author'; },
    value => { value.execution = 'copied-execution'; },
    value => { value.run = 'another-run'; },
    value => { value.registration = 'f'.repeat(64); },
    value => { value.image = 'sha256:' + 'b'.repeat(64); },
    value => { value.user = '0:0'; },
    value => { value.mounts[0].name = f.registration.controlVolumes.state; },
  ]) {
    const changed = structuredClone(saved); mutate(changed.containers[0]); f.write(changed);
    assert.throws(() => f.driver.observeCliJob({ ...request, handle: first.handle }), /PROCESS_SCOPE_MISMATCH/);
    assert.equal(f.read().starts, 1);
  }
  f.write(saved);
  assert.throws(() => f.driver.observeCliJob({ ...request, handle: { ...first.handle, roleBindingId: 'reviewer' } }), /PROCESS_HANDLE_INVALID/);
  assert.throws(() => f.driver.stopCliJob({ ...request, handle: { ...first.handle, execution: 'copied-execution' } }), /PROCESS_HANDLE_INVALID/);
  const nextRequest = f.request('fixture-next-after-legacy');
  const next = f.driver.startCliJob(nextRequest); await next.terminal;
  assert.equal(f.read().starts, 2);
  assert.notEqual(next.handle.containerId, first.handle.containerId);
});

test('execution slot metadata failures never masquerade as absence or authorize a fresh start', async () => {
  const f = await executionSlotFixture(), request = f.request('fixture-unverified-read');
  for (const fault of ['listError', 'listMalformed']) {
    f.write({ containers: [], starts: 0, [fault]: true });
    assert.throws(() => f.driver.resolveCliJob(request), /DOCKER_OPERATION_UNVERIFIED|DOCKER_METADATA_UNVERIFIED/);
    assert.throws(() => f.driver.startCliJob(request), /DOCKER_OPERATION_UNVERIFIED|DOCKER_METADATA_UNVERIFIED/);
    assert.equal(f.trace().some(args => ['create', 'start', 'stop'].includes(args[0])), false);
  }
});

test('execution slot rechecks peers after create and leaves uncertain resources for the original Comet to reconcile', async () => {
  const f = await executionSlotFixture(), previous = f.request('fixture-race-old');
  const first = f.driver.startCliJob(previous); await first.terminal;
  const state = f.read(), old = structuredClone(state.containers[0]); old.state = 'running';
  state.containers = []; state.peerAfterCreate = old; f.write(state);
  assert.throws(() => f.driver.startCliJob(f.request('fixture-race-new')), /PROCESS_ROLE_BUSY/);
  const after = f.read();
  assert.equal(after.containers.length, 2);
  assert.equal(after.starts, 1, 'a new created resource is not started past a competing writer');
  assert.equal(f.trace().some(args => ['rm', 'rename', 'kill', 'stop'].includes(args[0])), false);
});

test('execution slot treats registered namespace dots literally and never adopts a lookalike namespace', async () => {
  const f = await executionSlotFixture({ namespace: 'sdd-harness-i02-fixture.extra' });
  const request = f.request('fixture-literal-namespace');
  const first = f.driver.startCliJob(request); await first.terminal;
  const state = f.read(), foreign = structuredClone(state.containers[0]);
  foreign.id = 'f'.repeat(64);
  foreign.name = '/' + f.registration.namespace.replace('.', 'x') + '-author';
  state.containers.push(foreign); f.write(state);
  const resolved = f.fresh().resolveCliJob(request);
  assert.equal(resolved.found, true);
  assert.deepEqual(resolved.handle, first.handle);
  assert.throws(() => f.driver.observeCliJob({ ...request, handle: { ...first.handle, containerId: foreign.id } }), /PROCESS_SCOPE_MISMATCH/);
  assert.equal(f.read().starts, 1);
});


test('execution slot fixture publishes state snapshots without truncating an existing reader', async () => {
  const f = await executionSlotFixture(), request = f.request('fixture-publication-original');
  const first = f.driver.startCliJob(request); await first.terminal;
  const running = f.read(); running.containers[0].state = 'running'; f.write(running);
  const before = fs.readFileSync(f.stateFile), reader = fs.openSync(f.stateFile, 'r');
  try {
    f.driver.stopCliJob({ ...request, handle: first.handle });
    assert.deepEqual(fs.readFileSync(reader), before, 'a state publication must preserve an already-open complete snapshot');
    assert.equal(f.read().containers[0].state, 'exited');
    assert.equal(f.read().containers[0].exitCode, 143);
  } finally { fs.closeSync(reader); }
});

test('execution slot fixture retains both command records at an overlapping publication boundary', async () => {
  const f = await executionSlotFixture(); f.write({ containers: [], starts: 0 });
  const before = fs.readFileSync(f.stateFile), clients = [];
  const preload = path.join(f.root, 'publication-barrier.mjs');
  // A FIFO holds each actual filesystem publication at the same boundary;
  // release follows both ready messages, with no timing sleep or retry.
  fs.writeFileSync(preload, `import fs from 'node:fs';
import path from 'node:path';
const original=fs.writeFileSync, traceFile=${JSON.stringify(f.traceFile)};
let held=false;
fs.writeFileSync=function(file,...rest) {
  if(!held&&(String(file)===traceFile||path.dirname(String(file))===traceFile)) {
    held=true;process.send({boundary:'trace-publication'});
    const fd=fs.openSync(process.env.I02_FIXTURE_GATE,'r'), token=Buffer.alloc(1);
    try {if(fs.readSync(fd,token)!==1)throw new Error('fixture publication gate closed');} finally {fs.closeSync(fd);}
  }
  return original.call(this,file,...rest);
};
`);
  try {
    for (let index = 0; index < 2; index++) {
      const gate = path.join(f.root, 'publication-' + index + '.fifo');
      assert.equal(spawnSync('/usr/bin/mkfifo', [gate]).status, 0);
      const child = spawn(process.execPath, ['--import', preload, f.binary, '--context', f.registration.dockerContext, 'info'], {
        env: { ...process.env, I02_FIXTURE_GATE: gate }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      });
      let stdout = '', stderr = '';
      child.stdout.on('data', bytes => { stdout += bytes; });
      child.stderr.on('data', bytes => { stderr += bytes; });
      const timer = setTimeout(() => child.kill('SIGKILL'), 15000);
      const terminal = new Promise(resolve => child.once('close', (code, signal) => {
        clearTimeout(timer); resolve({ code, signal, stdout, stderr });
      }));
      const ready = new Promise((resolve, reject) => {
        child.once('message', message => {
          try { assert.deepEqual(message, { boundary: 'trace-publication' }); resolve(); } catch (error) { reject(error); }
        });
        child.once('error', reject);
        child.once('exit', code => reject(new Error('fixture exited before release: ' + code)));
      });
      clients.push({ child, gate, ready, terminal });
    }
    await Promise.all(clients.map(client => client.ready));
    for (const client of clients) fs.writeFileSync(client.gate, '1');
    for (const result of await Promise.all(clients.map(client => client.terminal))) {
      assert.equal(result.code, 0, result.stderr);
      assert.equal(JSON.parse(result.stdout), f.registration.engineId);
    }
    assert.equal(f.trace().length, 2, 'each successful concurrent CLI call must retain its own record');
    assert.deepEqual(f.trace(), [['info'], ['info']]);
    assert.deepEqual(fs.readFileSync(f.stateFile), before, 'read-only engine calls cannot overwrite state');
  } finally {
    for (const client of clients) if (client.child.exitCode === null && client.child.signalCode === null) client.child.kill('SIGKILL');
    await Promise.all(clients.map(client => client.terminal));
  }
});


test('execution slot fixture completion preserves state changes published while stdin is still open', async () => {
  const f = await executionSlotFixture(), id = '1'.repeat(64);
  const job = { execution: 'fixture-overlap-execution', run: 'fixture-overlap-run' };
  f.write({ containers: [{ id, state: 'created', ...job }], starts: 0 });
  const child = spawn(process.execPath, [f.binary, '--context', f.registration.dockerContext, 'start', id], {
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
  });
  let stderr = ''; child.stderr.on('data', bytes => { stderr += bytes; });
  const timer = setTimeout(() => child.kill('SIGKILL'), 15000);
  const terminal = new Promise(resolve => child.once('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal }); }));
  const ready = new Promise((resolve, reject) => {
    child.once('message', message => {
      try { assert.deepEqual(message, { boundary: 'running-published' }); resolve(); } catch (error) { reject(error); }
    });
    child.once('error', reject);
    child.once('exit', code => reject(new Error('fixture exited before running publication: ' + code)));
  });
  try {
    await ready;
    const concurrent = f.read();
    concurrent.containers.push({ id: '2'.repeat(64), state: 'created', execution: 'fixture-other-execution', run: job.run });
    concurrent.fixtureOnlyNote = 'preserve the independently published update';
    f.write(concurrent);
    child.stdin.end(JSON.stringify({ job }));
    assert.equal((await terminal).code, 0, stderr);
    const final = f.read();
    assert.equal(final.starts, 1);
    assert.equal(final.containers[0].state, 'exited');
    assert.deepEqual(final.containers[1], concurrent.containers[1], 'an asynchronous completion cannot restore its old whole-file snapshot');
    assert.equal(final.fixtureOnlyNote, concurrent.fixtureOnlyNote);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await terminal;
  }
});

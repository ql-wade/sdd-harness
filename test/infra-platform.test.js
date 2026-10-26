import assert, { AssertionError } from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// V_INFRA_I06 — I06 Git/CI、Registry、制品与隔离目标环境连通 的契约检查。
// 规格：infrastructure-tasks.json 的 I06 条目 + infrastructure-plan.md I06 小节。
//
//   PlatformInfra.v1      validate|probe -> repository identity/permissions/check policy/
//                         registry/environment evidence；绝不隐式远端策略写（无 up——本任务只读核验）。
//   IntegrationIdentity.v1 PR head/mergeSHA -> build artifact digest -> target deployment identity；
//                         任一环节断裂即阻断候选提升（旧 check 复用/缺项/skip/超时/tag 漂移）。
//   Environment.v1        隔离 endpoint/owner/回滚授权与独立业务 readback oracle；超时按原关联 ID 查询。
//
// CLI 退出码契约（execution-contract.json V_INFRA_I06.cli_contract）：
//   0=PASS，1=输入/前置无效（文件缺失/不可解析/SHA/digest 格式错误/参数错误），2=验证失败（语义违规、
//   授权门拒绝、UNVERIFIED）。环境缺失必须显式 UNVERIFIED 且退出码非零，不允许 skip 转 PASS。
//
// Historical TLS failures are history only. Fresh operator metadata is recorded separately;
// provider/workflow presence never qualifies the runtime actor or authorizes policy writes.
//
// 负例 fixture 全部在 os.tmpdir() 生成，不向活配置写入任何状态。
// required-check 名称/CI provider/Registry endpoint/环境 endpoint 均为未提供的输入——严禁虚构，
// 已提交文件中一律 UNSELECTED/UNVERIFIED；链路评估使用的具体 SHA/digest 只存在于 tmp fixture。

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '..');
const platformDir = path.join(repoRoot, 'infra', 'delivery', 'platform');
const registryPath = path.join(repoRoot, 'infra', 'delivery', 'registry.json');
const refsPath = path.join(repoRoot, 'infra', 'delivery', 'secrets.refs.example.json');
const cliPath = path.join(repoRoot, 'tools', 'infra', 'platform.mjs');
const secretRefsModuleUrl = new URL('../tools/infra/secret-refs.mjs', import.meta.url);

const RUN_TIMEOUT_MS = 60_000;
const PLATFORM_FILES = [
  'repository-registration.json',
  'ci-policy.json',
  'registry-registration.example.json',
  'environment-registration.example.json',
  'artifact-retention.json',
];
const HOST_PATH_OUTPUT_RE = /\/(Users|home|root|private|var|usr|etc|opt|tmp)\//;
const SHA = (ch) => ch.repeat(40);
const DIGEST = (ch) => `sha256:${ch.repeat(64)}`;
const PROJECT = 'sdd-harness-pilot';
// I06 六个 secret-ref（infrastructure-plan.md I06 小节）；目录成员资格是 I01 的活状态，测试不硬断言。
const PLATFORM_REFS = [
  'secret-ref:sdd-harness-pilot/ci-source-read',
  'secret-ref:sdd-harness-pilot/ci-check-publisher',
  'secret-ref:sdd-harness-pilot/ci-registry',
  'secret-ref:sdd-harness-pilot/artifact-reader',
  'secret-ref:sdd-harness-pilot/pilot-deployer',
  'secret-ref:sdd-harness-pilot/pilot-rollback',
];

function runCli(args, { env } = {}) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: RUN_TIMEOUT_MS,
    // env 提供时才覆盖（gh stub 用）；默认完全继承，保持既有行为。
    ...(env ? { env: { ...process.env, ...env } } : {}),
  });
}

// I01 caller convergence：hermetic gh stub——单测绝不真实触网。
// stub 把收到的参数原样追加到 argv 日志（供“恰好一次只读调用 + 目标仓库”断言）；
// GH_STUB_MODE=ok 时输出 GH_STUB_BODY 并退出 0，否则输出固定传输错误退出 1。
function makeGhStub() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'infra-i06-ghstub-'));
  const stub = path.join(dir, 'gh');
  fs.writeFileSync(stub, [
    '#!/bin/sh',
    'printf \'%s\\n\' "$*" >> "$GH_STUB_ARGV"',
    'if [ "$GH_STUB_MODE" = "ok" ]; then printf \'%s\' "$GH_STUB_BODY"; exit 0; fi',
    'printf \'%s\\n\' \'gh: stub transport failure: tls failed to verify certificate: x509: OSStatus -26276\' >&2',
    'exit 1',
    '',
  ].join('\n'));
  fs.chmodSync(stub, 0o755);
  const argvFile = path.join(dir, 'argv.log');
  return {
    dir,
    argvFile,
    envFor({ mode, body } = {}) {
      return {
        GH_STUB_MODE: mode ?? 'fail',
        ...(body === undefined ? {} : { GH_STUB_BODY: body }),
        GH_STUB_ARGV: argvFile,
        PATH: `${dir}${path.delimiter}${process.env.PATH}`,
      };
    },
    calls() {
      return fs.existsSync(argvFile) ? fs.readFileSync(argvFile, 'utf8').split('\n').filter(Boolean) : [];
    },
  };
}

function parseJsonOut(result, label) {
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new AssertionError({ message: `${label}: stdout is not JSON: ${result.stdout}\nstderr: ${result.stderr}` });
  }
}

function tmpFile(name, value) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `infra-i06-${name}-`));
  const file = path.join(dir, `${name}.json`);
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
  return file;
}

// 把已提交的 platform 域整体拷到 tmp fixture，应用 mutate 后返回 fixture 目录。
function makeFixtureDir(mutate) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'infra-i06-platform-'));
  for (const name of PLATFORM_FILES) {
    fs.copyFileSync(path.join(platformDir, name), path.join(dir, name));
  }
  const readJson = (name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
  const writeJson = (name, value) => fs.writeFileSync(path.join(dir, name), JSON.stringify(value, null, 2) + '\n');
  mutate({ dir, readJson, writeJson });
  return dir;
}

function violationCodes(report) {
  return (report.violations ?? []).map((v) => v.code);
}

// IntegrationIdentity.v1 全绿链 fixture（纯本地机制证明；值仅存在于 tmp）。
function greenChain(overrides = {}) {
  return {
    project: PROJECT,
    head: SHA('a'),
    merge: SHA('b'),
    requiredChecks: ['ci-test'],
    checks: [{ name: 'ci-test', boundSha: SHA('b'), conclusion: 'success' }],
    artifact: {
      tag: 'pilot-v0',
      digest: DIGEST('c'),
      builtFromMerge: SHA('b'),
      tagResolvedDigest: DIGEST('c'),
    },
    deployment: {
      project: PROJECT,
      environmentId: 'pilot-env-fixture',
      artifactDigest: DIGEST('c'),
      receipt: { correlationId: 'dep-fixture-001', status: 'accepted', responseLost: false },
    },
    readback: { correlationId: 'dep-fixture-001', observed: { businessTerminalState: 'healthy' } },
    rollback: { requested: false },
    ...overrides,
  };
}

// ---------- 结构 GREEN：五个域文件 + committed validate ----------

test('V_INFRA_I06 contract: five platform files exist and committed validate passes with LOCAL_ONLY and honest gaps', () => {
  for (const name of PLATFORM_FILES) {
    assert.ok(fs.existsSync(path.join(platformDir, name)), `missing owned file: ${name}`);
    JSON.parse(fs.readFileSync(path.join(platformDir, name), 'utf8'));
  }

  const validate = runCli(['validate', '--registry', registryPath, '--json']);
  assert.equal(validate.status, 0, `validate must PASS on committed platform domain: ${validate.stderr || validate.stdout}`);
  const report = parseJsonOut(validate, 'validate');
  assert.equal(report.ok, true);
  assert.deepEqual(report.violations, []);
  assert.equal(report.mode, 'LOCAL_ONLY', 'this run has no remote policy write authorization');
  // nb 回归：结构化输出不得回显宿主绝对路径。
  assert.doesNotMatch(validate.stdout, HOST_PATH_OUTPUT_RE);

  // catalogGaps 必须如实等于“被引用但不在活目录中的 ref”——按活目录现算，不硬编码成员资格。
  const catalog = JSON.parse(fs.readFileSync(refsPath, 'utf8'));
  const known = new Set((catalog.refs ?? []).map((r) => r.ref));
  const expectedGaps = PLATFORM_REFS.filter((ref) => !known.has(ref));
  assert.deepEqual(
    (report.catalogGaps ?? []).slice().sort(),
    expectedGaps.slice().sort(),
    'catalogGaps must exactly mirror the live catalog membership of the six platform refs',
  );

  // 绝不伪报 required checks 已配置 / 平台已保护。
  assert.equal(report.summary.ci.requiredChecks.registrationStatus, 'UNSELECTED');
  assert.deepEqual(report.summary.ci.requiredChecks.names, []);
  assert.equal(report.summary.repository.branchProtection.configuredStatus, 'NOT_CONFIGURED');
  assert.equal(report.summary.ci.providerStatus, 'OBSERVED_NOT_QUALIFIED');
});

test('committed platform files carry the interface bindings and honest UNVERIFIED identity facts', () => {
  const repo = JSON.parse(fs.readFileSync(path.join(platformDir, 'repository-registration.json'), 'utf8'));
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  assert.equal(repo.interface, 'PlatformInfra.v1');
  assert.equal(repo.project.id, registry.project.id);
  // 与 I01 registry 同源引用：不得出现第二套身份事实。
  assert.equal(repo.repository.repoId, registry.project.github.repoId);
  assert.equal(repo.repository.principalId, registry.project.github.principalId);
  assert.equal(repo.repository.owner, registry.project.github.owner);
  assert.ok(repo.repository.sameOriginRef, 'must reference the I01 registry as the identity source of truth');
  assert.equal(repo.identity.readback.status, 'VERIFIED', 'fresh operator readback is separate from standing authority');
  assert.ok(String(repo.identity.readback.history[0].error).includes('x509'), 'raw readback error preserved verbatim');
  assert.equal(repo.branchProtection.configuredStatus, 'NOT_CONFIGURED');
  assert.equal(repo.remotePolicyWrites.allowed, false);
  assert.equal(repo.localOnly, true);

  const ci = JSON.parse(fs.readFileSync(path.join(platformDir, 'ci-policy.json'), 'utf8'));
  assert.equal(ci.interface, 'PlatformInfra.v1');
  for (const code of ['MISSING', 'SKIPPED', 'TIMED_OUT', 'STALE_EVIDENCE']) {
    assert.ok(ci.requiredChecks.blockingSemantics.includes(code), `blocking semantics must declare ${code}`);
  }
  assert.equal(ci.requiredChecks.failClosed, true);
  assert.equal(ci.authorization.remotePolicyWriteAuthorized, false);
  assert.equal(ci.provider.status, 'OBSERVED_NOT_QUALIFIED', 'workflow presence does not qualify CI/runtime/protected policy');

  const env = JSON.parse(fs.readFileSync(path.join(platformDir, 'environment-registration.example.json'), 'utf8'));
  assert.equal(env.interface, 'Environment.v1');
  assert.equal(env.example, true);
  assert.equal(env.environment.rollback.approvalRequired, true);
  assert.equal(env.environment.rollback.sameDigestRequired, true);
  assert.equal(env.environment.rollback.independentBusinessTerminalStateRequired, true);
  assert.equal(env.environment.readbackOracle.correlationIdRequired, true);
  assert.match(String(env.environment.readbackOracle.onTimeout), /correlation/i, 'timeout path queries by original correlation ID');

  const retention = JSON.parse(fs.readFileSync(path.join(platformDir, 'artifact-retention.json'), 'utf8'));
  for (const field of ['rpo', 'rto', 'retentionPeriod', 'encryptionOwner']) {
    assert.equal(retention.retention[field], 'UNVERIFIED', `${field} is an unconfirmed value; must stay UNVERIFIED`);
  }
  assert.equal(retention.retention.autoCleanupEnabled, false);
  assert.equal(retention.rollbackRetention.oldEvidenceNeverAuthorizesNewSha, true);
  assert.equal(retention.rollbackRetention.revocationCheckOnRestore, true);
  assert.equal(retention.rollbackRetention.retainLastApprovedArtifact, true);
});

// ---------- adoption-v1 登记：实际平台 / 已有流水线 required checks / digest 来源 / owner ----------

// 2026-10-26-comet-050-adoption-v1：I06 只登记本地可证事实——
//   实际平台 ql-wade/sdd-harness（与 I01 registry 同源）、两个在库 workflow 的检查名（候选集，
//   绝不冒充 admin 已登记）、构建产物 digest 来源（今天没有任何流水线产 artifact）、
//   目标环境 owner（未选择，P4_2 待登记）与远端 required-check 保护（本地不可证，P4_1 待验）。
// 远端保护是否生效本地不可证：registrationStatus 必须保持 UNSELECTED（P4_1 契约：
// admin 登记只在 tmpdir fixture 里模拟，committed 文件永远不伪造）。
test('adoption-v1 registration: existing pipelines, candidate required checks, digest source and pending owners are registered as locally verifiable facts', () => {
  const repo = JSON.parse(fs.readFileSync(path.join(platformDir, 'repository-registration.json'), 'utf8'));
  // 实际平台：登记身份必须就是真实 remote（git remote -v: origin ql-wade/sdd-harness）。
  assert.equal(repo.repository.repoFullname, 'ql-wade/sdd-harness');
  assert.equal(repo.repository.owner, 'ql-wade');
  assert.equal(repo.repository.url, 'https://github.com/ql-wade/sdd-harness');
  // 远端 required-check 保护本地不可证：UNVERIFIED 且待验 owner 在案（P4_1）。
  assert.equal(repo.branchProtection.remoteEnforcement?.status, 'UNVERIFIED');
  assert.equal(repo.branchProtection.remoteEnforcement?.pendingOwner, 'P4_1');

  const ci = JSON.parse(fs.readFileSync(path.join(platformDir, 'ci-policy.json'), 'utf8'));
  // 候选 required-check 集来自在库 workflow 文件（本地可证），与 provider 登记的 workflow 事实一致。
  const declared = ci.requiredChecks.declaredCandidateChecks ?? {};
  assert.equal(declared.sourceKind, 'committed-workflow-files');
  assert.deepEqual([...(declared.names ?? [])].sort(), ['checks', 'delivery-gate']);
  const workflows = ci.provider.committedWorkflows ?? [];
  assert.deepEqual(
    workflows.map((w) => w.checkName).sort(),
    ['checks', 'delivery-gate'],
    'declared candidate names must be exactly the check names of the registered committed workflows',
  );
  for (const workflow of workflows) {
    const file = path.join(repoRoot, workflow.path);
    assert.ok(fs.existsSync(file), `declared workflow file must exist in the repository: ${workflow.path}`);
    const text = fs.readFileSync(file, 'utf8');
    if (workflow.path.endsWith('delivery-gate.yml')) {
      assert.match(text, /^name:\s*delivery-gate\s*$/m, 'delivery-gate.yml must keep workflow/job name delivery-gate');
      assert.match(text, /^\s{2}delivery-gate:\s*$/m, 'delivery-gate.yml must keep job id delivery-gate');
    } else {
      // quality-gates job has no explicit name: the check-run name is the job id.
      assert.match(text, /^\s{2}checks:\s*$/m, 'quality-gates.yml job id must stay checks (the check name it produces)');
    }
  }
  // 登记诚实分离：候选集绝不冒充 admin 已登记/平台已保护（P4_1 契约保持）。
  assert.equal(ci.requiredChecks.registrationStatus, 'UNSELECTED');
  assert.deepEqual(ci.requiredChecks.names, []);

  // 构建产物 digest 来源：今天没有任何在库流水线产出 artifact；唯一可观测 digest 元数据是
  // GitHub Actions artifact ZIP 元数据，且它不是 OCI digest/签名/来源证明。
  const registryDoc = JSON.parse(fs.readFileSync(path.join(platformDir, 'registry-registration.example.json'), 'utf8'));
  assert.equal(registryDoc.registry.digestSource?.kind, 'github-actions-artifact-zip-metadata');
  assert.equal(registryDoc.registry.digestSource?.status, 'UNVERIFIED');
  const redLines = registryDoc.artifactIdentity.notSuccessEvidence ?? {};
  for (const redLine of [
    'queuedOrInProgressBuildNotSuccess',
    'historicalArtifactNotSuccess',
    'expiredArtifactNotSuccess',
    'artifactFromOlderShaNotSuccess',
    'artifactFromForeignRepoNotSuccess',
    'unknownProducerIdentityNotSuccess',
  ]) {
    assert.equal(redLines[redLine], true, `artifact red line must be registered true: ${redLine}`);
  }

  // 目标环境 owner：未选择，P4_2 待登记——不虚构隔离环境属主。
  const env = JSON.parse(fs.readFileSync(path.join(platformDir, 'environment-registration.example.json'), 'utf8'));
  assert.equal(env.environment.ownerRegistration?.status, 'UNSELECTED');
  assert.equal(env.environment.ownerRegistration?.pendingOwner, 'P4_2');

  // validate 结构化读回必须把这些登记事实带出来（机器可读，不靠人读 JSON）。
  const validate = runCli(['validate', '--registry', registryPath, '--json']);
  assert.equal(validate.status, 0, `validate must PASS with the adoption registration: ${validate.stderr || validate.stdout}`);
  const summary = parseJsonOut(validate, 'adoption validate').summary;
  assert.equal(summary.repository.remoteEnforcement.status, 'UNVERIFIED');
  assert.equal(summary.repository.remoteEnforcement.pendingOwner, 'P4_1');
  assert.deepEqual([...summary.ci.declaredCandidateChecks.names].sort(), ['checks', 'delivery-gate']);
  assert.equal(summary.ci.declaredCandidateChecks.sourceKind, 'committed-workflow-files');
  assert.equal(summary.registryExample.digestSource.kind, 'github-actions-artifact-zip-metadata');
  assert.equal(summary.environmentExample.ownerRegistration.pendingOwner, 'P4_2');
});

// ---------- RED I01 caller convergence: repoFullname/url 必须与 registry 同源 ----------

test('RED same-origin labels: stale or missing repoFullname/url fails validate with IDENTITY_NOT_SAME_ORIGIN while IDs and owner stay stable', () => {
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  const cases = [
    { name: 'stale-repoFullname', mutate: (repo) => { repo.repository.repoFullname = 'rpamis/sdd-harness'; } },
    { name: 'stale-url', mutate: (repo) => { repo.repository.url = 'https://github.com/rpamis/sdd-harness'; } },
    { name: 'missing-repoFullname', mutate: (repo) => { delete repo.repository.repoFullname; } },
    { name: 'missing-url', mutate: (repo) => { delete repo.repository.url; } },
  ];
  for (const fixture of cases) {
    const dir = makeFixtureDir(({ readJson, writeJson }) => {
      const repo = readJson('repository-registration.json');
      fixture.mutate(repo);
      // 稳定同 ID：repoId/principalId/owner 保持与 registry 一致——失败必须只由标签漂移引起。
      assert.equal(repo.repository.repoId, registry.project.github.repoId);
      assert.equal(repo.repository.principalId, registry.project.github.principalId);
      assert.equal(repo.repository.owner, registry.project.github.owner);
      writeJson('repository-registration.json', repo);
    });
    const result = runCli(['validate', '--registry', registryPath, '--platform-dir', dir, '--json']);
    const report = parseJsonOut(result, `fixture ${fixture.name}`);
    assert.equal(result.status, 2, `fixture ${fixture.name} must be a verification failure (exit 2), got ${result.status}`);
    assert.ok(
      violationCodes(report).includes('IDENTITY_NOT_SAME_ORIGIN'),
      `fixture ${fixture.name}: expected IDENTITY_NOT_SAME_ORIGIN, got ${JSON.stringify(violationCodes(report))}`,
    );
  }
});

// ---------- RED I01 caller convergence（ROUND2）：probe 与 validate 共用同一身份核 ----------

// P1-1 修复回归：直接 probe 不得绕过 validate 的同源核——登记 fullname/url 漂移时，
// 必须在预检就 IDENTITY_NOT_SAME_ORIGIN / exit 2 / executed:false，且一次 gh 都不发。
test('RED direct-probe preflight: drifted repoFullname/url is rejected before any gh call, even with stable IDs and owner', () => {
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  const stub = makeGhStub();
  const dirs = [];
  try {
    const cases = [
      { name: 'stale-repoFullname', mutate: (repo) => { repo.repository.repoFullname = 'rpamis/sdd-harness'; } },
      { name: 'stale-url', mutate: (repo) => { repo.repository.url = 'https://github.com/rpamis/sdd-harness'; } },
    ];
    for (const fixture of cases) {
      const dir = makeFixtureDir(({ readJson, writeJson }) => {
        const repo = readJson('repository-registration.json');
        fixture.mutate(repo);
        // 稳定同 ID：repoId/principalId/owner 保持与 registry 一致——拒绝必须只由标签漂移引起。
        assert.equal(repo.repository.repoId, registry.project.github.repoId);
        assert.equal(repo.repository.principalId, registry.project.github.principalId);
        assert.equal(repo.repository.owner, registry.project.github.owner);
        writeJson('repository-registration.json', repo);
      });
      dirs.push(dir);
      const callsBefore = stub.calls().length;
      const probe = runCli(
        ['probe', '--case', 'repository-identity', '--read-only', '--registry', registryPath, '--platform-dir', dir, '--json'],
        { env: stub.envFor({ mode: 'ok', body: JSON.stringify({ id: registry.project.github.repoId, full_name: registry.project.github.repoFullname }) }) },
      );
      const report = parseJsonOut(probe, `probe fixture ${fixture.name}`);
      assert.equal(probe.status, 2, `probe fixture ${fixture.name} must fail verification (exit 2), got ${probe.status}`);
      assert.equal(report.code, 'IDENTITY_NOT_SAME_ORIGIN', `probe fixture ${fixture.name}: expected IDENTITY_NOT_SAME_ORIGIN, got ${JSON.stringify(report.code)}`);
      assert.equal(report.executed, false, `probe fixture ${fixture.name}: a preflight rejection must never claim an executed network attempt`);
      assert.equal(report.localConsistency, 'FAIL');
      assert.equal(
        stub.calls().length - callsBefore,
        0,
        `probe fixture ${fixture.name}: no gh call may happen while local identity bindings disagree (argv: ${JSON.stringify(stub.calls())})`,
      );
    }
  } finally {
    fs.rmSync(stub.dir, { recursive: true, force: true });
    for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
  }
});

// P1-2 修复回归：等值放行漏洞——两侧同缺/同空/同类型漂移不是同源。
// undefined===undefined、''===''、'1285806550'==='1285806550' 都必须被拒，validate 与 probe 一致。
test('RED equal-but-absent labels: both sides missing/blank/invalid-typed identity fields fail same-origin in validate and probe', () => {
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  const stub = makeGhStub();
  const dirs = [];
  try {
    const cases = [
      { name: 'both-missing-repoFullname', field: 'repoFullname', mutate: (a, b) => { delete a.repository.repoFullname; delete b.project.github.repoFullname; } },
      { name: 'both-blank-url', field: 'url', mutate: (a, b) => { a.repository.url = ''; b.project.github.url = ''; } },
      { name: 'both-whitespace-owner', field: 'owner', mutate: (a, b) => { a.repository.owner = '   '; b.project.github.owner = '   '; } },
      { name: 'both-missing-repoId', field: 'repoId', mutate: (a, b) => { delete a.repository.repoId; delete b.project.github.repoId; } },
      { name: 'both-string-repoId', field: 'repoId', mutate: (a, b) => { a.repository.repoId = String(registry.project.github.repoId); b.project.github.repoId = String(registry.project.github.repoId); } },
      { name: 'both-null-principalId', field: 'principalId', mutate: (a, b) => { a.repository.principalId = null; b.project.github.principalId = null; } },
    ];
    for (const fixture of cases) {
      const registryDoc = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
      const dir = makeFixtureDir(({ readJson, writeJson }) => {
        const repo = readJson('repository-registration.json');
        fixture.mutate(repo, registryDoc);
        writeJson('repository-registration.json', repo);
      });
      dirs.push(dir);
      const registryFile = tmpFile(`reg-${fixture.name}`, registryDoc);

      const validate = runCli(['validate', '--registry', registryFile, '--platform-dir', dir, '--json']);
      const validateReport = parseJsonOut(validate, `validate fixture ${fixture.name}`);
      assert.equal(validate.status, 2, `validate fixture ${fixture.name}: equal-but-absent ${fixture.field} must fail, got ${validate.status}`);
      const violation = violationCodes(validateReport).includes('IDENTITY_NOT_SAME_ORIGIN');
      assert.ok(violation, `validate fixture ${fixture.name}: expected IDENTITY_NOT_SAME_ORIGIN, got ${JSON.stringify(violationCodes(validateReport))}`);
      const fields = (validateReport.violations ?? []).find((v) => v.code === 'IDENTITY_NOT_SAME_ORIGIN')?.fields ?? [];
      assert.ok(fields.includes(fixture.field), `validate fixture ${fixture.name}: ${fixture.field} must be named in the violation fields, got ${JSON.stringify(fields)}`);

      const callsBefore = stub.calls().length;
      const probe = runCli(
        ['probe', '--case', 'repository-identity', '--read-only', '--registry', registryFile, '--platform-dir', dir, '--json'],
        { env: stub.envFor({ mode: 'ok', body: JSON.stringify({ id: registry.project.github.repoId, full_name: registry.project.github.repoFullname }) }) },
      );
      const probeReport = parseJsonOut(probe, `probe fixture ${fixture.name}`);
      assert.equal(probe.status, 2, `probe fixture ${fixture.name}: must fail verification (no repos/undefined or repos/ probing), got ${probe.status}`);
      assert.equal(probeReport.code, 'IDENTITY_NOT_SAME_ORIGIN');
      assert.equal(probeReport.executed, false, `probe fixture ${fixture.name}: no network attempt may be claimed`);
      assert.equal(
        stub.calls().length - callsBefore,
        0,
        `probe fixture ${fixture.name}: no gh call may be made against a blank/missing identity (argv: ${JSON.stringify(stub.calls())})`,
      );
    }
  } finally {
    fs.rmSync(stub.dir, { recursive: true, force: true });
    for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------- RED 授权门：无远端写授权 / 凭据 tier ----------

test('RED authorization gate: configuring required checks without remote write authorization is refused — admin identity is not this run approval', () => {
  const probe = runCli(['probe', '--case', 'required-checks-authorization', '--json']);
  assert.equal(probe.status, 2, 'the authorization gate must refuse (verification failure, not a crash)');
  const report = parseJsonOut(probe, 'probe required-checks-authorization');
  assert.equal(report.executed, true);
  assert.equal(report.refused, true);
  assert.equal(report.code, 'REMOTE_POLICY_WRITE_NOT_AUTHORIZED');
  assert.match(String(report.basis), /admin/i, 'gate basis must name the plan rule: admin identity is not this run approval');
  assert.doesNotMatch(probe.stdout, HOST_PATH_OUTPUT_RE);

  // 即便请求者就是已登记管理员 principal，门仍然拒绝（拒绝依据是本次运行授权，不是身份）。
  const admin = runCli([
    'probe', '--case', 'required-checks-authorization',
    '--registry', registryPath, '--principal', '262266039', '--json',
  ]);
  assert.equal(admin.status, 2);
  assert.equal(parseJsonOut(admin, 'probe as admin').refused, true);

  // 结构门：任何已提交文件声称 remotePolicyWriteAuthorized=true 都是验证失败。
  const fixtureDir = makeFixtureDir(({ readJson, writeJson }) => {
    const ci = readJson('ci-policy.json');
    ci.authorization.remotePolicyWriteAuthorized = true;
    writeJson('ci-policy.json', ci);
  });
  const flipped = runCli(['validate', '--registry', registryPath, '--platform-dir', fixtureDir, '--json']);
  assert.equal(flipped.status, 2);
  assert.ok(violationCodes(parseJsonOut(flipped, 'flipped ci-policy')).includes('REMOTE_POLICY_WRITE_FORBIDDEN'));
});

test('RED credential tier: development identity cannot read release/rollback secrets (SecretRef.v1 resolver semantics)', async () => {
  const { parseSecretRef, resolveSecretRef } = await import(secretRefsModuleUrl);
  for (const ref of PLATFORM_REFS) {
    const parsed = parseSecretRef(ref);
    assert.ok(parsed.ok, `${ref} must be a well-formed SecretRef.v1`);
    assert.equal(parsed.project, PROJECT, 'platform refs stay inside the project namespace');
  }

  // tier fixture：pilot-deployer 只授 deploy principal；pilot-rollback 只授 rollback approver（独立于 deployer）。
  const refsDoc = {
    interface: 'SecretRef.v1',
    refs: [
      { ref: 'secret-ref:sdd-harness-pilot/pilot-deployer', purpose: 'deploy', boundRole: 'deployer', allowedPrincipals: ['svc:sdd-harness-pilot/deploy'] },
      { ref: 'secret-ref:sdd-harness-pilot/pilot-rollback', purpose: 'rollback', boundRole: 'rollback-approver', allowedPrincipals: ['svc:sdd-harness-pilot/rollback-approver'] },
    ],
  };
  const dev = 'dev:sdd-harness-pilot/developer';
  assert.throws(
    () => resolveSecretRef({ ref: 'secret-ref:sdd-harness-pilot/pilot-rollback', principalId: dev, role: 'developer', refsDoc, project: PROJECT }),
    (err) => err.code === 'PRINCIPAL_NOT_AUTHORIZED',
    'development identity must be refused release/rollback secrets',
  );
  assert.throws(
    () => resolveSecretRef({ ref: 'secret-ref:sdd-harness-pilot/pilot-deployer', principalId: dev, role: 'deployer', refsDoc, project: PROJECT }),
    (err) => err.code === 'PRINCIPAL_NOT_AUTHORIZED',
    'role binding is per ref: a dev principal cannot borrow the deployer role',
  );
  // 授权身份也只得到 UNRESOLVED：I01 语义——本任务无运行时 secret store，绝不返回值。
  const deployer = resolveSecretRef({ ref: 'secret-ref:sdd-harness-pilot/pilot-deployer', principalId: 'svc:sdd-harness-pilot/deploy', role: 'deployer', refsDoc, project: PROJECT });
  assert.equal(deployer.resolved, false);
  assert.equal(deployer.status, 'UNRESOLVED');

  // CLI 层：六个 ref 的 tier 报告必须逐条显式拒绝或 UNRESOLVED，任何条目都不得产出值。
  const probe = runCli(['probe', '--case', 'required-checks-authorization', '--json']);
  const report = parseJsonOut(probe, 'tier probe');
  const tiers = report.credentialTiers ?? [];
  assert.deepEqual(
    tiers.map((t) => t.ref).sort(),
    PLATFORM_REFS.slice().sort(),
    'all six platform refs must appear in the tier report',
  );
  for (const entry of tiers) {
    assert.equal(entry.resolution, false, 'no ref may resolve to a value');
    assert.ok(
      ['REFUSED_REF_NOT_REGISTERED', 'REFUSED_PRINCIPAL_NOT_AUTHORIZED', 'UNRESOLVED'].includes(entry.outcome),
      `tier outcome must be an explicit refusal or UNRESOLVED, got ${entry.outcome}`,
    );
    assert.equal(entry.value, undefined, 'tier report must never carry a value');
  }
});

// ---------- IntegrationIdentity.v1：本地机制贯通 + 四类阻断 ----------

test('IntegrationIdentity.v1: a fully bound chain verifies locally (head -> mergeSHA -> digest -> deployment -> readback)', () => {
  const chainFile = tmpFile('chain-green', greenChain());
  const probe = runCli(['probe', '--case', 'registry-environment-identity', '--chain', chainFile, '--json']);
  assert.equal(probe.status, 0, `green chain must PASS: ${probe.stdout || probe.stderr}`);
  const report = parseJsonOut(probe, 'green chain');
  assert.equal(report.executed, true);
  assert.equal(report.scope, 'LOCAL_ONLY', 'local mechanism proof never claims the real platform');
  assert.equal(report.mode, 'LOCAL_ONLY', 'a verified chain still declares LOCAL_ONLY mode');
  // 生产晋级如实分离：VERIFIED 只证明本地机制；真实生产交付保持 UNVERIFIED 且 holder 在案。
  assert.equal(report.productionPromotion.status, 'UNVERIFIED', 'a verified local chain never claims production promotion');
  assert.match(
    String(report.productionPromotion.holder),
    /P4_2|environment owner|runtime admission/i,
    'the holder of the unverified production promotion stays on record',
  );
  assert.equal(report.blocked, false);
  assert.equal(report.status, 'VERIFIED');
  assert.doesNotMatch(probe.stdout, HOST_PATH_OUTPUT_RE);
});

test('RED stale evidence: a new head/mergeSHA reusing an old check blocks candidate promotion', () => {
  const chainFile = tmpFile('chain-stale', greenChain({
    merge: SHA('e'),
    checks: [{ name: 'ci-test', boundSha: SHA('b'), conclusion: 'success' }],
  }));
  const probe = runCli(['probe', '--case', 'registry-environment-identity', '--chain', chainFile, '--json']);
  assert.equal(probe.status, 2);
  const report = parseJsonOut(probe, 'stale chain');
  assert.equal(report.blocked, true);
  assert.ok(report.codes.includes('CHECK_STALE_EVIDENCE'), `codes: ${JSON.stringify(report.codes)}`);
});

test('RED missing / skipped / timed-out checks each block promotion with distinct codes', () => {
  const cases = [
    { checks: [], expected: 'CHECK_MISSING' },
    { checks: [{ name: 'ci-test', boundSha: SHA('b'), conclusion: 'skipped' }], expected: 'CHECK_SKIPPED' },
    { checks: [{ name: 'ci-test', boundSha: SHA('b'), conclusion: 'failure', timedOut: true }], expected: 'CHECK_TIMED_OUT' },
    { checks: [{ name: 'ci-test', boundSha: SHA('b'), conclusion: 'failure' }], expected: 'CHECK_NOT_SUCCESS' },
  ];
  for (const [index, fixture] of cases.entries()) {
    const {expected,...input}=fixture;
    const chainFile = tmpFile(`chain-check-${index}`, greenChain(input));
    const probe = runCli(['probe', '--case', 'registry-environment-identity', '--chain', chainFile, '--json']);
    assert.equal(probe.status, 2, `fixture ${index} must block`);
    const report = parseJsonOut(probe, `check fixture ${index}`);
    assert.equal(report.blocked, true);
    assert.ok(report.codes.includes(fixture.expected), `fixture ${index}: expected ${fixture.expected}, got ${JSON.stringify(report.codes)}`);
  }
});

test('RED tag drift: a tag repointed to a different digest blocks promotion; digest must build from the integration merge SHA', () => {
  const drifted = tmpFile('chain-tag-drift', greenChain({
    artifact: { tag: 'pilot-v0', digest: DIGEST('c'), builtFromMerge: SHA('b'), tagResolvedDigest: DIGEST('d') },
  }));
  const driftProbe = runCli(['probe', '--case', 'registry-environment-identity', '--chain', drifted, '--json']);
  assert.equal(driftProbe.status, 2);
  assert.ok(parseJsonOut(driftProbe, 'tag drift').codes.includes('TAG_DIGEST_DRIFT'));

  const foreign = tmpFile('chain-foreign-build', greenChain({
    artifact: { tag: 'pilot-v0', digest: DIGEST('c'), builtFromMerge: SHA('f'), tagResolvedDigest: DIGEST('c') },
  }));
  const foreignProbe = runCli(['probe', '--case', 'registry-environment-identity', '--chain', foreign, '--json']);
  assert.equal(foreignProbe.status, 2);
  assert.ok(parseJsonOut(foreignProbe, 'foreign build').codes.includes('ARTIFACT_NOT_FROM_MERGE'));
});

test('RED queued checks and expired artifacts never count as this production success', () => {
  // 排队/进行中的检查不是成功：即使绑定 SHA 正确，未完成的 check 绝不放行候选提升。
  const queuedStatus = tmpFile('chain-check-queued-status', greenChain({
    checks: [{ name: 'ci-test', boundSha: SHA('b'), conclusion: 'pending', status: 'queued' }],
  }));
  const queuedProbe = runCli(['probe', '--case', 'registry-environment-identity', '--chain', queuedStatus, '--json']);
  assert.equal(queuedProbe.status, 2, 'a queued check must block promotion');
  assert.ok(parseJsonOut(queuedProbe, 'queued status').codes.includes('CHECK_QUEUED'));

  const queuedConclusion = tmpFile('chain-check-queued-conclusion', greenChain({
    checks: [{ name: 'ci-test', boundSha: SHA('b'), conclusion: 'queued' }],
  }));
  const queuedConclusionProbe = runCli(['probe', '--case', 'registry-environment-identity', '--chain', queuedConclusion, '--json']);
  assert.equal(queuedConclusionProbe.status, 2, 'a queued conclusion must block promotion');
  assert.ok(parseJsonOut(queuedConclusionProbe, 'queued conclusion').codes.includes('CHECK_QUEUED'));

  const inProgress = tmpFile('chain-check-in-progress', greenChain({
    checks: [{ name: 'ci-test', boundSha: SHA('b'), conclusion: 'pending', status: 'in_progress' }],
  }));
  const inProgressProbe = runCli(['probe', '--case', 'registry-environment-identity', '--chain', inProgress, '--json']);
  assert.equal(inProgressProbe.status, 2, 'an in-progress check must block promotion');
  assert.ok(parseJsonOut(inProgressProbe, 'in progress').codes.includes('CHECK_QUEUED'));

  // 历史（已过期）artifact 不算成功：digest 正确、绑定正确也阻断。
  const expiredArtifact = tmpFile('chain-artifact-expired', greenChain({
    artifact: { tag: 'pilot-v0', digest: DIGEST('c'), builtFromMerge: SHA('b'), tagResolvedDigest: DIGEST('c'), expired: true },
  }));
  const expiredProbe = runCli(['probe', '--case', 'registry-environment-identity', '--chain', expiredArtifact, '--json']);
  assert.equal(expiredProbe.status, 2, 'an expired artifact must block promotion');
  assert.ok(parseJsonOut(expiredProbe, 'expired artifact').codes.includes('ARTIFACT_EXPIRED'));
});

test('RED deployment identity: digest mismatch and missing receipt correlation block promotion', () => {
  const mismatch = tmpFile('chain-deploy-digest', greenChain({
    deployment: {
      project: PROJECT,
      environmentId: 'pilot-env-fixture',
      artifactDigest: DIGEST('9'),
      receipt: { correlationId: 'dep-fixture-001', status: 'accepted', responseLost: false },
    },
  }));
  const mismatchProbe = runCli(['probe', '--case', 'registry-environment-identity', '--chain', mismatch, '--json']);
  assert.equal(mismatchProbe.status, 2);
  assert.ok(parseJsonOut(mismatchProbe, 'deployment digest mismatch').codes.includes('DEPLOYMENT_DIGEST_MISMATCH'));

  const noCorrelation = tmpFile('chain-no-correlation', greenChain({
    deployment: {
      project: PROJECT,
      environmentId: 'pilot-env-fixture',
      artifactDigest: DIGEST('c'),
      receipt: { status: 'accepted', responseLost: false },
    },
  }));
  const noCorrelationProbe = runCli(['probe', '--case', 'registry-environment-identity', '--chain', noCorrelation, '--json']);
  assert.equal(noCorrelationProbe.status, 2);
  assert.ok(parseJsonOut(noCorrelationProbe, 'missing correlation').codes.includes('RECEIPT_CORRELATION_MISSING'));
});

test('timeout query path: lost deployment response is confirmed by querying the original correlation ID', () => {
  const lost = greenChain({
    deployment: {
      project: PROJECT,
      environmentId: 'pilot-env-fixture',
      artifactDigest: DIGEST('c'),
      receipt: { correlationId: 'dep-fixture-001', status: 'accepted', responseLost: true },
    },
  });
  const recovered = tmpFile('chain-timeout-query', lost);
  const ok = runCli(['probe', '--case', 'registry-environment-identity', '--chain', recovered, '--json']);
  assert.equal(ok.status, 0, 'querying by the original correlation ID recovers the lost response');
  const okReport = parseJsonOut(ok, 'timeout query green');
  assert.ok(okReport.steps.some((s) => s.step === 'readback' && s.via === 'QUERY_BY_CORRELATION_ID'));

  const wrongId = tmpFile('chain-wrong-correlation', {
    ...lost,
    readback: { correlationId: 'dep-other-999', observed: { businessTerminalState: 'healthy' } },
  });
  const wrong = runCli(['probe', '--case', 'registry-environment-identity', '--chain', wrongId, '--json']);
  assert.equal(wrong.status, 2);
  assert.ok(parseJsonOut(wrong, 'wrong correlation').codes.includes('READBACK_CORRELATION_MISMATCH'));

  const unconfirmed = tmpFile('chain-unconfirmed', {
    ...lost,
    readback: { correlationId: 'dep-fixture-001' },
  });
  const unconfirmedProbe = runCli(['probe', '--case', 'registry-environment-identity', '--chain', unconfirmed, '--json']);
  assert.equal(unconfirmedProbe.status, 2, 'missing business terminal state must stay nonzero (UNVERIFIED)');
  const unconfirmedReport = parseJsonOut(unconfirmedProbe, 'unconfirmed readback');
  assert.equal(unconfirmedReport.status, 'UNVERIFIED');
  assert.equal(unconfirmedReport.blocked, false, 'no semantic violation — evidence is simply absent');
  assert.ok(unconfirmedReport.codes.includes('READBACK_UNCONFIRMED'));
});

test('RED rollback gate: unapproved requests are refused; approved rollback needs the same digest and an independent business terminal state', () => {
  const base = greenChain();

  const unapproved = tmpFile('chain-rollback-unapproved', {
    ...base,
    rollback: { requested: true, approved: false, digest: DIGEST('c'), previousApprovedDigest: DIGEST('c') },
  });
  const unapprovedProbe = runCli(['probe', '--case', 'registry-environment-identity', '--chain', unapproved, '--json']);
  assert.equal(unapprovedProbe.status, 2);
  assert.ok(parseJsonOut(unapprovedProbe, 'unapproved rollback').codes.includes('ROLLBACK_NOT_APPROVED'));

  const noRetention = tmpFile('chain-rollback-no-retention', {
    ...base,
    rollback: { requested: true, approved: true, digest: DIGEST('c') },
  });
  const noRetentionProbe = runCli(['probe', '--case', 'registry-environment-identity', '--chain', noRetention, '--json']);
  assert.equal(noRetentionProbe.status, 2, 'an approved rollback without the retained previous approved digest must block');
  assert.ok(parseJsonOut(noRetentionProbe, 'rollback retention').codes.includes('ROLLBACK_RETENTION_MISSING'));

  const drifted = tmpFile('chain-rollback-drift', {
    ...base,
    rollback: { requested: true, approved: true, digest: DIGEST('e'), previousApprovedDigest: DIGEST('c') },
  });
  const driftedProbe = runCli(['probe', '--case', 'registry-environment-identity', '--chain', drifted, '--json']);
  assert.equal(driftedProbe.status, 2);
  assert.ok(parseJsonOut(driftedProbe, 'rollback digest drift').codes.includes('ROLLBACK_DIGEST_MISMATCH'));

  const noTerminal = tmpFile('chain-rollback-no-terminal', {
    ...base,
    rollback: { requested: true, approved: true, digest: DIGEST('c'), previousApprovedDigest: DIGEST('c') },
  });
  const noTerminalProbe = runCli(['probe', '--case', 'registry-environment-identity', '--chain', noTerminal, '--json']);
  assert.equal(noTerminalProbe.status, 2, 'approved rollback still needs an independent business terminal state');
  assert.ok(parseJsonOut(noTerminalProbe, 'rollback no terminal').codes.includes('ROLLBACK_TERMINAL_STATE_UNCONFIRMED'));

  const approved = tmpFile('chain-rollback-approved', {
    ...base,
    rollback: {
      requested: true,
      approved: true,
      digest: DIGEST('c'),
      previousApprovedDigest: DIGEST('c'),
      observed: { businessTerminalState: 'restored-healthy' },
    },
  });
  const approvedProbe = runCli(['probe', '--case', 'registry-environment-identity', '--chain', approved, '--json']);
  assert.equal(approvedProbe.status, 0, `approved same-digest rollback with terminal state must PASS: ${approvedProbe.stdout || approvedProbe.stderr}`);
});

// ---------- 跨项目隔离 / 缺登记 ----------

test('RED isolation: cross-project refs (pav-*) and foreign project bindings are rejected; missing registration is an input failure', () => {
  const pavDir = makeFixtureDir(({ readJson, writeJson }) => {
    const repo = readJson('repository-registration.json');
    repo.credentialRefs = ['secret-ref:pav-legacy/source-read'];
    writeJson('repository-registration.json', repo);
  });
  const pavProbe = runCli(['validate', '--registry', registryPath, '--platform-dir', pavDir, '--json']);
  assert.equal(pavProbe.status, 2);
  assert.ok(violationCodes(parseJsonOut(pavProbe, 'pav fixture')).includes('CROSS_PROJECT_REF'));

  const foreignChain = tmpFile('chain-foreign-env', greenChain({
    deployment: { ...greenChain().deployment, project: 'pav-prod' },
  }));
  const foreignEnv = runCli(['probe', '--case', 'registry-environment-identity', '--chain', foreignChain, '--json']);
  assert.equal(foreignEnv.status, 2);
  assert.ok(parseJsonOut(foreignEnv, 'foreign environment').codes.includes('ENVIRONMENT_PROJECT_MISMATCH'));

  const missingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'infra-i06-empty-'));
  const missing = runCli(['validate', '--registry', registryPath, '--platform-dir', missingDir, '--json']);
  assert.equal(missing.status, 1, 'missing platform registration files are a prerequisite failure, not a semantic one');
});

// ---------- Environment.v1 / artifact-retention fail-closed 结构 ----------

test('fail-closed structure: rollback approval, correlation oracle and retention rules cannot be flipped off without a violation', () => {
  const flips = [
    {
      name: 'rollback-approval',
      file: 'environment-registration.example.json',
      mutate: (doc) => {
        doc.environment.rollback.approvalRequired = false;
      },
      expected: 'ROLLBACK_APPROVAL_REQUIRED',
    },
    {
      name: 'correlation-oracle',
      file: 'environment-registration.example.json',
      mutate: (doc) => {
        doc.environment.readbackOracle.correlationIdRequired = false;
      },
      expected: 'READBACK_ORACLE_CORRELATION_REQUIRED',
    },
    {
      name: 'example-declaration',
      file: 'registry-registration.example.json',
      mutate: (doc) => {
        doc.example = false;
      },
      expected: 'EXAMPLE_DECLARATION_REQUIRED',
    },
    {
      name: 'stale-evidence-rule',
      file: 'artifact-retention.json',
      mutate: (doc) => {
        doc.rollbackRetention.oldEvidenceNeverAuthorizesNewSha = false;
      },
      expected: 'RETENTION_STALE_EVIDENCE_RULE_REQUIRED',
    },
    {
      name: 'revocation-recheck',
      file: 'artifact-retention.json',
      mutate: (doc) => {
        doc.rollbackRetention.revocationCheckOnRestore = false;
      },
      expected: 'RETENTION_REVOCATION_RECHECK_REQUIRED',
    },
    {
      name: 'last-approved-retention',
      file: 'artifact-retention.json',
      mutate: (doc) => {
        doc.rollbackRetention.retainLastApprovedArtifact = false;
      },
      expected: 'RETENTION_LAST_APPROVED_REQUIRED',
    },
    {
      name: 'blocking-semantics',
      file: 'ci-policy.json',
      mutate: (doc) => {
        doc.requiredChecks.blockingSemantics = ['MISSING'];
      },
      expected: 'BLOCKING_SEMANTICS_INCOMPLETE',
    },
    {
      name: 'unregistered-check-names',
      file: 'ci-policy.json',
      mutate: (doc) => {
        doc.requiredChecks.registrationStatus = 'UNSELECTED';
        doc.requiredChecks.names = ['ci-invented'];
      },
      expected: 'REQUIRED_CHECK_NAMES_UNREGISTERED',
    },
    {
      name: 'protection-claim',
      file: 'repository-registration.json',
      mutate: (doc) => {
        doc.branchProtection.configuredStatus = 'CONFIGURED';
      },
      expected: 'PLATFORM_PROTECTION_CLAIM_FORBIDDEN',
    },
    {
      name: 'auto-cleanup',
      file: 'artifact-retention.json',
      mutate: (doc) => {
        doc.retention.autoCleanupEnabled = true;
      },
      expected: 'AUTO_CLEANUP_WITHOUT_CONFIRMED_RECOVERY',
    },
    // adoption-v1 登记红线：登记事实漂移/伪称已验，一律验证失败。
    {
      name: 'declared-candidate-empty',
      file: 'ci-policy.json',
      mutate: (doc) => {
        doc.requiredChecks.declaredCandidateChecks.names = [];
      },
      expected: 'DECLARED_CANDIDATE_CHECKS_EMPTY',
    },
    {
      name: 'declared-candidate-drift',
      file: 'ci-policy.json',
      mutate: (doc) => {
        doc.requiredChecks.declaredCandidateChecks.names = ['delivery-gate'];
      },
      expected: 'DECLARED_CANDIDATE_CHECKS_MISMATCH',
    },
    {
      name: 'committed-workflow-missing',
      file: 'ci-policy.json',
      mutate: (doc) => {
        doc.provider.committedWorkflows[0].path = '.github/workflows/ghost.yml';
      },
      expected: 'COMMITTED_WORKFLOW_FILE_MISSING',
    },
    {
      name: 'remote-enforcement-claim',
      file: 'repository-registration.json',
      mutate: (doc) => {
        doc.branchProtection.remoteEnforcement.status = 'VERIFIED';
      },
      expected: 'REMOTE_ENFORCEMENT_CLAIM_FORBIDDEN',
    },
    {
      name: 'artifact-not-success-red-line',
      file: 'registry-registration.example.json',
      mutate: (doc) => {
        doc.artifactIdentity.notSuccessEvidence.historicalArtifactNotSuccess = false;
      },
      expected: 'ARTIFACT_NOT_SUCCESS_RED_LINE_REQUIRED',
    },
    {
      name: 'digest-source-claim',
      file: 'registry-registration.example.json',
      mutate: (doc) => {
        doc.registry.digestSource.status = 'VERIFIED';
      },
      expected: 'DIGEST_SOURCE_CLAIM_FORBIDDEN',
    },
    {
      name: 'owner-registration-removed',
      file: 'environment-registration.example.json',
      mutate: (doc) => {
        delete doc.environment.ownerRegistration;
      },
      expected: 'INPUT_SCHEMA_INVALID',
    },
  ];
  for (const flip of flips) {
    const dir = makeFixtureDir(({ readJson, writeJson }) => {
      const doc = readJson(flip.file);
      flip.mutate(doc);
      writeJson(flip.file, doc);
    });
    const result = runCli(['validate', '--registry', registryPath, '--platform-dir', dir, '--json']);
    assert.equal(result.status, 2, `flip ${flip.name} must be a verification failure`);
    assert.ok(
      violationCodes(parseJsonOut(result, `flip ${flip.name}`)).includes(flip.expected),
      `flip ${flip.name}: expected ${flip.expected}, got ${JSON.stringify(violationCodes(parseJsonOut(result, `flip ${flip.name}`)))}`,
    );
  }
});

// ---------- probe 真实性：只读、诚实 UNVERIFIED、无 skip ----------

test('probes are real and honest: repository-identity performs exactly one read-only gh attempt whose outcome is reported verbatim; bare chain probe is structured UNVERIFIED', () => {
  const noReadOnly = runCli(['probe', '--case', 'repository-identity', '--json']);
  assert.equal(noReadOnly.status, 1, 'repository-identity is read-only by contract; omitting --read-only is an input error');

  // 诚实契约（deterministic，非环境快照）：旧断言把 2026-10-20 的 gh TLS/令牌失效当作必然结局，
  // 是环境绑定。这里改用 hermetic gh stub 固定三种结局——成功 / 传输失败 / 失配——单测绝不真实触网。
  // expected 一律独立取自 infra/delivery/registry.json#project.github（登记源），不做回执自洽比较。
  const gh = JSON.parse(fs.readFileSync(registryPath, 'utf8')).project.github;
  const stub = makeGhStub();
  const probeArgs = ['probe', '--case', 'repository-identity', '--read-only', '--json'];
  try {
    // (a) 正例：观测 id 与 full_name 都等于登记源 -> VERIFIED / exit 0；恰好一次 gh api repos/<registered>。
    const positive = runCli(probeArgs, {
      env: stub.envFor({ mode: 'ok', body: JSON.stringify({ id: gh.repoId, full_name: gh.repoFullname }) }),
    });
    const positiveReport = parseJsonOut(positive, 'positive stub');
    assert.equal(positive.status, 0, `a fully matching readback must PASS: ${positive.stdout || positive.stderr}`);
    assert.equal(positiveReport.executed, true, 'a real gh api attempt must have been made');
    assert.equal(positiveReport.readback.status, 'VERIFIED', 'an exit-0 probe must carry a live VERIFIED readback, never a bare PASS');
    assert.equal(positiveReport.readback.expected.repoId, gh.repoId, 'expected repoId comes from the registry source');
    assert.equal(positiveReport.readback.expected.repoFullname, gh.repoFullname, 'expected repoFullname comes from the registry source');
    assert.equal(positiveReport.readback.observed.repoId, gh.repoId);
    assert.equal(positiveReport.readback.observed.fullName, gh.repoFullname);
    assert.equal(positiveReport.readback.error, undefined, 'a successful readback carries no error');
    assert.equal(positiveReport.localConsistency, 'PASS', 'local same-origin binding is checkable locally and must pass');
    assert.deepEqual(
      stub.calls(),
      [`api repos/${gh.repoFullname}`],
      'exactly one readonly gh call, against the registered repository',
    );
    assert.doesNotMatch(positive.stdout, /"skip"\s*:\s*true/, 'probes must not skip');
    assert.doesNotMatch(positive.stdout, HOST_PATH_OUTPUT_RE);

    // (b) 传输失败：gh 非零退出 -> 结构化 UNVERIFIED / exit 2，原始错误原样保留。
    const failed = runCli(probeArgs, { env: stub.envFor({ mode: 'fail' }) });
    const failedReport = parseJsonOut(failed, 'transport-failure stub');
    assert.equal(failed.status, 2, 'a failed live readback must surface as structured UNVERIFIED (nonzero)');
    assert.equal(failedReport.executed, true);
    assert.equal(failedReport.readback.status, 'UNVERIFIED');
    assert.ok(String(failedReport.readback.error ?? '').includes('x509'), 'the raw readback error is preserved verbatim');
    assert.equal(failedReport.readback.command, `gh api repos/${gh.repoFullname}`);
    assert.equal(stub.calls().length, 2, 'each probe performs exactly one gh attempt');

    // (c) P1-3 修复回归：API 返回正确 id 但 full_name 是另一仓库 -> MISMATCH / exit 2。
    //     只有 id 相同绝不足以 VERIFIED（同 id 换名/同名换库都是身份劫持面）。
    const mallory = runCli(probeArgs, {
      env: stub.envFor({ mode: 'ok', body: JSON.stringify({ id: gh.repoId, full_name: 'mallory/other' }) }),
    });
    const malloryReport = parseJsonOut(mallory, 'correct-id-wrong-fullname stub');
    assert.equal(mallory.status, 2, 'a correct id with a foreign full_name must fail verification');
    assert.equal(malloryReport.readback.status, 'MISMATCH');
    assert.equal(malloryReport.readback.observed.repoId, gh.repoId);
    assert.equal(malloryReport.readback.observed.fullName, undefined, 'out-of-scope provider labels are not echoed');
    assert.equal(malloryReport.readback.observed.identityMatches,false);
    assert.equal(malloryReport.readback.expected.repoFullname, gh.repoFullname, 'expected stays pinned to the registry source');
    assert.equal(stub.calls().length, 3);
    assert.equal(stub.calls().at(-1), `api repos/${gh.repoFullname}`, 'the probe always targets the registered repository');

    // (d) 形状 fail-closed：null / 数组 / 缺 full_name / 字符串 id / 空白 full_name / 非 JSON
    //     一律 UNVERIFIED / exit 2 —— 不可解读的形状绝不当成 MISMATCH 更不当成 VERIFIED。
    const malformedBodies = {
      'null-body': 'null',
      'array-body': '[{"id":1,"full_name":"x/y"}]',
      'missing-fullname': JSON.stringify({ id: gh.repoId }),
      'missing-id': JSON.stringify({ full_name: gh.repoFullname }),
      'string-id': JSON.stringify({ id: String(gh.repoId), full_name: gh.repoFullname }),
      'blank-fullname': JSON.stringify({ id: gh.repoId, full_name: '   ' }),
      'not-json': 'not json at all',
    };
    for (const [name, body] of Object.entries(malformedBodies)) {
      const bad = runCli(probeArgs, { env: stub.envFor({ mode: 'ok', body }) });
      const badReport = parseJsonOut(bad, `malformed ${name}`);
      assert.equal(bad.status, 2, `malformed ${name}: must fail closed (exit 2), got ${bad.status}`);
      assert.equal(badReport.readback.status, 'UNVERIFIED', `malformed ${name}: shape-invalid output stays UNVERIFIED, got ${badReport.readback.status}`);
      assert.equal(badReport.readback.error !== undefined, true, `malformed ${name}: an explicit error must be recorded`);
    }
    assert.equal(stub.calls().length, 3 + Object.keys(malformedBodies).length, 'one readonly gh attempt per probe, no more');
  } finally {
    fs.rmSync(stub.dir, { recursive: true, force: true });
  }

  const bare = runCli(['probe', '--case', 'registry-environment-identity', '--json']);
  assert.equal(bare.status, 2);
  const bareReport = parseJsonOut(bare, 'bare chain probe');
  assert.equal(bareReport.executed, false, 'no real registry/environment exists; must not pretend');
  assert.equal(bareReport.status, 'UNVERIFIED');
  assert.ok((bareReport.requiredInputs ?? []).length > 0, 'requiredInputs must be listed');
  assert.ok((bareReport.plannedSteps ?? []).length > 0, 'plannedSteps must be listed');
  assert.equal(bareReport.scope, 'LOCAL_ONLY');
  assert.equal(bareReport.mode, 'LOCAL_ONLY', 'the bare UNVERIFIED probe carries the LOCAL_ONLY mode like every other receipt');
  assert.equal(bareReport.productionPromotion.status, 'UNVERIFIED', 'production promotion is never claimed locally');
  assert.match(
    String(bareReport.productionPromotion.holder),
    /P4_2|environment owner|runtime admission/i,
    'the holder of the unverified production promotion stays on record',
  );
  assert.doesNotMatch(bare.stdout, /"skip"\s*:\s*true/);

  assert.equal(runCli(['probe', '--json']).status, 1, 'missing --case is an input error');
  assert.equal(runCli(['probe', '--case', 'not-a-case', '--json']).status, 1, 'unknown case is an input error');
});

// ---------- RED spawn-failure fail-closed：gh 缺失/不可执行是 UNVERIFIED，不是崩溃 ----------

// 子进程起不来（spawnSync 带 error 且 stderr/stdout 为 null）时，失败路径绝不能 TypeError 崩溃成 exit 1；
// 必须是结构化 UNVERIFIED / exit 2，诊断点名 spawn 失败原因，且未启动过 pid 就不得声称 executed。
// runCli 用绝对 process.execPath 起本 CLI，私有空 PATH 只影响子进程 gh 的解析——单测绝不真实触网。
test('RED spawn-failure path: missing or non-executable gh yields structured UNVERIFIED (exit 2) with a spawn diagnostic, never a crash', () => {
  const gh = JSON.parse(fs.readFileSync(registryPath, 'utf8')).project.github;
  const emptyPathDir = fs.mkdtempSync(path.join(os.tmpdir(), 'infra-i06-empty-path-'));
  const noexecDir = fs.mkdtempSync(path.join(os.tmpdir(), 'infra-i06-noexec-'));
  try {
    // PATH 上唯一可找到的 gh 无执行位 -> spawn EACCES，同样从未启动任何 pid。
    fs.writeFileSync(path.join(noexecDir, 'gh'), '#!/bin/sh\nexit 0\n');
    fs.chmodSync(path.join(noexecDir, 'gh'), 0o644);
    const cases = [
      { name: 'missing-gh', env: { PATH: emptyPathDir }, diagnostic: 'ENOENT' },
      { name: 'non-executable-gh', env: { PATH: noexecDir }, diagnostic: 'EACCES' },
    ];
    for (const fixture of cases) {
      const probe = runCli(['probe', '--case', 'repository-identity', '--read-only', '--json'], { env: fixture.env });
      assert.equal(
        probe.status,
        2,
        `fixture ${fixture.name}: an unspawnable gh must surface as structured UNVERIFIED (exit 2); got exit ${probe.status}\nstdout: ${probe.stdout}\nstderr: ${probe.stderr}`,
      );
      const report = parseJsonOut(probe, `spawn-failure fixture ${fixture.name}`);
      assert.equal(report.readback.status, 'UNVERIFIED', `fixture ${fixture.name}: a failed spawn is never VERIFIED`);
      assert.equal(report.localConsistency, 'PASS');
      assert.equal(report.readback.command, `gh api repos/${gh.repoFullname}`);
      assert.match(
        String(report.readback.error ?? ''),
        new RegExp(fixture.diagnostic),
        `fixture ${fixture.name}: the diagnostic must name the spawn failure (${fixture.diagnostic})`,
      );
      assert.equal(report.executed, false, `fixture ${fixture.name}: no child pid was ever launched; executed must stay false`);
      assert.doesNotMatch(probe.stdout, HOST_PATH_OUTPUT_RE);
    }
  } finally {
    fs.rmSync(emptyPathDir, { recursive: true, force: true });
    fs.rmSync(noexecDir, { recursive: true, force: true });
  }
});

test('CLI input contract: malformed chain fixtures are input failures (exit 1), distinct from semantic blocks (exit 2)', () => {
  const unreadable = path.join(os.tmpdir(), `infra-i06-nope-${Date.now()}.json`);
  assert.equal(runCli(['probe', '--case', 'registry-environment-identity', '--chain', unreadable, '--json']).status, 1);

  const badSha = tmpFile('chain-bad-sha', greenChain({ head: 'not-a-sha' }));
  assert.equal(runCli(['probe', '--case', 'registry-environment-identity', '--chain', badSha, '--json']).status, 1);

  const badDigest = tmpFile('chain-bad-digest', greenChain({
    artifact: { tag: 'pilot-v0', digest: 'sha256:zzzz', builtFromMerge: SHA('b'), tagResolvedDigest: 'sha256:zzzz' },
  }));
  assert.equal(runCli(['probe', '--case', 'registry-environment-identity', '--chain', badDigest, '--json']).status, 1);

  const unparseable = tmpFile('chain-unparseable', 'not json');
  fs.writeFileSync(unparseable, '{nope');
  assert.equal(runCli(['probe', '--case', 'registry-environment-identity', '--chain', unparseable, '--json']).status, 1);
});

test('parseJsonOut raises a real AssertionError (not a ReferenceError) when the tool prints no JSON', () => {
  // input-failure path: validate exits 1 with usage on stderr and an empty stdout,
  // so the JSON.parse inside parseJsonOut fails and the guard branch executes.
  const missing = path.join(os.tmpdir(), `infra-i06-nope-${Date.now()}.json`);
  const result = runCli(['validate', '--registry', missing, '--json']);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.throws(
    () => parseJsonOut(result, 'no-json probe'),
    (err) => err instanceof AssertionError && /stdout is not JSON/.test(err.message),
  );
});


// Convergence I06 public CLI admission seam; fake gh only at the process boundary.
test('I06 refs admission blocks direct repository probing before any external I/O', () => {
  const stub=makeGhStub();const dir=fs.mkdtempSync(path.join(os.tmpdir(),'i06-preflight-'));
  try {
    const expected=JSON.parse(fs.readFileSync(registryPath)).project.github;
    const control=runCli(['probe','--case','repository-identity','--read-only','--json'],{env:stub.envFor({mode:'ok',body:JSON.stringify({id:expected.repoId,full_name:expected.repoFullname})})});
    assert.equal(control.status,0,'a reachable valid control prevents a missing-tool/input RED');
    const refs=JSON.parse(fs.readFileSync(refsPath));refs.refs='not-an-array';const file=path.join(dir,'refs.json');fs.writeFileSync(file,JSON.stringify(refs));
    const before=stub.calls().length;
    const rejected=runCli(['probe','--case','repository-identity','--read-only','--refs',file,'--json'],{env:stub.envFor({mode:'ok',body:JSON.stringify({id:expected.repoId,full_name:expected.repoFullname})})});
    assert.equal(rejected.status,2,'invalid catalog must refuse before a repository read, not verify');
    assert.equal(parseJsonOut(rejected,'refs preflight').executed,false);assert.equal(stub.calls().length,before,'invalid refs never launch the network client');
  }finally{fs.rmSync(stub.dir,{recursive:true,force:true});fs.rmSync(dir,{recursive:true,force:true});}
});


test('I06 direct probes consume versioned platform input through the same admission gate', () => {
  const stub=makeGhStub();const dir=makeFixtureDir(({readJson,writeJson})=>{const doc=readJson('ci-policy.json');doc.schemaVersion=2;writeJson('ci-policy.json',doc);});
  try {
    const expected=JSON.parse(fs.readFileSync(registryPath)).project.github;
    const run=runCli(['probe','--case','repository-identity','--read-only','--platform-dir',dir,'--json'],{env:stub.envFor({mode:'ok',body:JSON.stringify({id:expected.repoId,full_name:expected.repoFullname})})});
    assert.equal(run.status,2,'future schema cannot bypass validate via direct probing');assert.equal(parseJsonOut(run,'version admission').executed,false);assert.deepEqual(stub.calls(),[]);
  }finally{fs.rmSync(stub.dir,{recursive:true,force:true});fs.rmSync(dir,{recursive:true,force:true});}
});


test('I06 integration chain never accepts a foreign project or a normal-response correlation mismatch', () => {
  for(const chain of [greenChain({project:'foreign-project',deployment:{...greenChain().deployment,project:'foreign-project'}}),greenChain({readback:{correlationId:'another-operation',observed:{businessTerminalState:'healthy'}}})]) {
    const file=tmpFile('i06-chain-binding',chain);
    try{const result=runCli(['probe','--case','registry-environment-identity','--chain',file,'--json']);assert.equal(result.status,2,'each metadata hop stays bound to the registered project and original operation');}
    finally{fs.rmSync(path.dirname(file),{recursive:true,force:true});}
  }
});


function makePlatformGhStub(responses){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'i06-http-gh-'));const fixtures=path.join(dir,'responses.json');const log=path.join(dir,'requests.jsonl');fs.writeFileSync(fixtures,JSON.stringify(responses));
  const program=[ '#!'+process.execPath,
    "const fs=require('node:fs');const args=process.argv.slice(2),route=args.at(-1);fs.appendFileSync(process.env.I06_TEST_LOG,JSON.stringify(args)+'\\n');const map=JSON.parse(fs.readFileSync(process.env.I06_TEST_RESPONSES));const r=map[route]??{status:404,body:{message:'not registered fixture'}};if(r.delayMs)Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,r.delayMs);console.log('HTTP/2.0 '+r.status);for(const [key,value]of Object.entries(r.headers??{}))console.log(key+': '+value);console.log('');console.log(JSON.stringify(r.body));process.exit(r.exit??(r.status>=400?1:0));",
  ].join('\n');fs.writeFileSync(path.join(dir,'gh'),program);fs.chmodSync(path.join(dir,'gh'),0o755);
  return {dir,env:{PATH:dir+path.delimiter+process.env.PATH,I06_TEST_LOG:log,I06_TEST_RESPONSES:fixtures},calls:()=>fs.existsSync(log)?fs.readFileSync(log,'utf8').trim().split('\n').filter(Boolean).map(x=>JSON.parse(x)):[]};
}
function platformResponses(){
  const gh=JSON.parse(fs.readFileSync(registryPath)).project.github;const base='repos/'+gh.repoFullname;const sha=SHA('b');const r=(body,status=200,headers={})=>({body,status,headers});
  return {
    user:r({id:gh.principalId,login:gh.owner,email:'PRIVATE_PROVIDER_FIELD_NOT_FOR_OUTPUT'}),
    [base]:r({id:gh.repoId,full_name:gh.repoFullname,owner:{id:gh.principalId,login:gh.owner}}),
    [base+'/branches/master']:r({name:'master',commit:{sha},protected:true}),
    [base+'/branches/master/protection']:r({required_status_checks:{contexts:['ci-test']},enforce_admins:{enabled:true}}),
    [base+'/rulesets?per_page=2&page=1']:r([]),
    [base+'/actions/workflows?per_page=2&page=1']:r({total_count:3,workflows:[{id:11,name:'CI',path:'.github/workflows/ci.yml',state:'active'},{id:12,name:'Gate',path:'.github/workflows/gate.yml',state:'active'}]},200,{Link:'<https://api.github.com/'+base+'/actions/workflows?per_page=2&page=2>; rel="next"'}),
    [base+'/actions/workflows?per_page=2&page=2']:r({total_count:3,workflows:[{id:13,name:'Third',path:'.github/workflows/third.yml',state:'active'}]}),
    [base+'/commits/'+sha]:r({sha}),
    [base+'/commits/'+sha+'/check-runs?per_page=2&page=1']:r({total_count:1,check_runs:[{id:21,name:'ci-test',head_sha:sha,status:'completed',conclusion:'success',app:{id:1}}]}),
    [base+'/actions/runs?head_sha='+sha+'&per_page=2&page=1']:r({total_count:1,workflow_runs:[{id:31,head_sha:sha,repository:{id:gh.repoId,full_name:gh.repoFullname},head_repository:{id:gh.repoId,full_name:gh.repoFullname},path:'.github/workflows/ci.yml@master',status:'completed',conclusion:'success',workflow_id:11}]}),
    [base+'/actions/artifacts?per_page=2&page=1']:r({total_count:1,artifacts:[{id:41,name:'build',expired:false,digest:DIGEST('c'),workflow_run:{id:31,repository_id:gh.repoId,head_repository_id:gh.repoId,head_sha:sha}}]}),
    [base+'/deployments?sha='+sha+'&per_page=2&page=1']:r([]),
  };
}
function makeObservedPlatformFixture(){return makeFixtureDir(({readJson,writeJson})=>{const repo=readJson('repository-registration.json');repo.readOnly={apiOrigin:'https://api.github.com',branch:'master',pageSize:2,maxPages:4,timeoutMs:2000,operatorObservationOnly:true};writeJson('repository-registration.json',repo);});}

test('I06 platform observer reads exact registered IDs, all pages and candidate-linked artifact metadata only',()=>{
  const stub=makePlatformGhStub(platformResponses());const dir=makeObservedPlatformFixture();
  try{
    const result=runCli(['probe','--case','platform-observation','--read-only','--candidate-sha',SHA('b'),'--platform-dir',dir,'--json'],{env:stub.env});
    assert.equal(result.status,0,result.stderr||result.stdout);const report=parseJsonOut(result,'platform metadata').observation;
    assert.equal(report.workflows.complete,true);assert.deepEqual(report.workflows.items.map(r=>r.id),[11,12,13]);assert.equal(report.artifacts.items[0].digest,DIGEST('c'));assert.equal(report.artifacts.items[0].matchesCandidate,true);assert.equal(report.artifacts.items[0].mediaType,'github-actions-artifact-zip');
    assert.equal(report.runtimeAuthority.status,'UNVERIFIED','operator metadata never provisions a control/source actor');assert.doesNotMatch(result.stdout,/PRIVATE_PROVIDER_FIELD_NOT_FOR_OUTPUT/);
    for(const call of stub.calls()){assert.equal(call[0],'api');assert.ok(call.includes('GET'));assert.ok(!call.includes('POST'));assert.match(call.at(-1),/^(user$|repos\/ql-wade\/sdd-harness(?:$|\/))/);}
  }finally{fs.rmSync(stub.dir,{recursive:true,force:true});fs.rmSync(dir,{recursive:true,force:true});}
});

test('I06 observer keeps forbidden, truncated, foreign and missing-ID pages unverified',()=>{
  const base='repos/'+JSON.parse(fs.readFileSync(registryPath)).project.github.repoFullname;
  for(const change of ['forbidden','lost-next-page','foreign-next-page','missing-artifact-id','candidate-unreadable']){
    const responses=platformResponses();
    if(change==='forbidden')responses[base+'/rulesets?per_page=2&page=1']={status:403,body:{message:'PRIVATE_ERROR_MUST_NOT_LEAK'}};
    if(change==='lost-next-page')responses[base+'/actions/workflows?per_page=2&page=1'].headers={};
    if(change==='foreign-next-page')responses[base+'/actions/workflows?per_page=2&page=1'].headers.Link='<https://api.github.com/repos/other/private/actions/workflows?per_page=2&page=2>; rel="next"';
    if(change==='candidate-unreadable')responses[base+'/commits/'+SHA('b')]={status:404,body:{message:'not readable'}};
    if(change==='missing-artifact-id')delete responses[base+'/actions/artifacts?per_page=2&page=1'].body.artifacts[0].id;
    const stub=makePlatformGhStub(responses);const dir=makeObservedPlatformFixture();
    try{const run=runCli(['probe','--case','platform-observation','--read-only','--candidate-sha',SHA('b'),'--platform-dir',dir,'--json'],{env:stub.env});assert.equal(run.status,2,change+': '+run.stdout);assert.doesNotMatch(run.stdout,/PRIVATE_ERROR_MUST_NOT_LEAK/);assert.ok(!stub.calls().some(args=>args.at(-1).includes('repos/other')));}
    finally{fs.rmSync(stub.dir,{recursive:true,force:true});fs.rmSync(dir,{recursive:true,force:true});}
  }
});


test('I06 all operations share nullable, nested, unknown, duplicate and reference admission before I/O',()=>{
  const operations=[['validate'],['qualify','--read-only','--candidate-sha',SHA('b'),'--artifact-digest',DIGEST('c'),'--operation-id','run:op'],['probe','--case','repository-identity','--read-only'],['probe','--case','registry-environment-identity']];
  for(const mutation of ['null-root','null-nested','unknown-root','unknown-nested','version','array-type','duplicate-list']){
    const dir=makeFixtureDir(({readJson,writeJson})=>{
      const d=readJson('ci-policy.json');
      if(mutation==='null-root'){writeJson('ci-policy.json',null);return;}
      if(mutation==='null-nested')d.requiredChecks=null;
      if(mutation==='unknown-root')d.implicitPolicyWriter=true;
      if(mutation==='unknown-nested')d.requiredChecks.implicitPass=true;
      if(mutation==='version')d.schemaVersion=7;
      if(mutation==='array-type')d.requiredChecks.names={name:'wrong'};
      if(mutation==='duplicate-list')d.requiredChecks.blockingSemantics.push('MISSING');
      writeJson('ci-policy.json',d);
    });const stub=makeGhStub();
    try{for(const command of operations){const run=runCli([...command,'--platform-dir',dir,'--json'],{env:stub.envFor()});assert.equal(run.status,2,mutation+': '+run.stdout);assert.equal(parseJsonOut(run,mutation).executed,false);}assert.deepEqual(stub.calls(),[]);}
    finally{fs.rmSync(dir,{recursive:true,force:true});fs.rmSync(stub.dir,{recursive:true,force:true});}
  }
  for(const mutation of ['null','version','duplicate','foreign','unknown']){
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'i06-ref-matrix-'));const stub=makeGhStub();
    try{let d=JSON.parse(fs.readFileSync(refsPath));if(mutation==='null')d=null;if(mutation==='version')d.schemaVersion=2;if(mutation==='duplicate')d.refs.push(d.refs[0]);if(mutation==='foreign')d.refs[0].ref='secret-ref:other-project/source-read';if(mutation==='unknown')d.refs[0].implicitValueReader=true;const file=path.join(dir,'refs.json');fs.writeFileSync(file,JSON.stringify(d));for(const command of operations){const run=runCli([...command,'--refs',file,'--json'],{env:stub.envFor()});assert.equal(run.status,2,mutation);assert.equal(parseJsonOut(run,mutation).executed,false);}assert.deepEqual(stub.calls(),[]);}
    finally{fs.rmSync(dir,{recursive:true,force:true});fs.rmSync(stub.dir,{recursive:true,force:true});}
  }
  for(const args of [['validate','--unknown','x'],['validate','positional'],['validate','--registry',registryPath,'--registry',registryPath],['validate','--chain','ignored'],['probe','--case','repository-identity','--read-only','--refs','--json']])assert.equal(runCli(args).status,1,JSON.stringify(args));
});

async function makeReadOnlyHttpFixture(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'i06-read-http-'));const map=path.join(dir,'responses.json');const log=path.join(dir,'requests.jsonl');fs.writeFileSync(map,'{}');
  const source="const http=require('node:http'),fs=require('node:fs');http.createServer((req,res)=>{fs.appendFileSync(process.env.I06_HTTP_LOG,JSON.stringify({method:req.method,url:req.url})+'\\n');const map=JSON.parse(fs.readFileSync(process.env.I06_HTTP_MAP));const route=req.url.split('?')[0],value=map[route]??{status:404,body:{}};res.writeHead(value.status??200,value.headers??{});res.end(typeof value.body==='string'?value.body:JSON.stringify(value.body));}).listen(0,'127.0.0.1',function(){console.log(JSON.stringify({port:this.address().port}));});";
  const script=path.join(dir,'server.cjs');fs.writeFileSync(script,source);const child=spawn(process.execPath,[script],{env:{...process.env,I06_HTTP_LOG:log,I06_HTTP_MAP:map},stdio:['ignore','pipe','pipe']});
  const port=await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(new Error('fixture server did not start')),5000);child.stdout.on('data',(d)=>{text+=d;if(text.includes('\n')){clearTimeout(timer);try{resolve(JSON.parse(text.split('\n')[0]).port);}catch(error){reject(error);}}});child.once('error',reject);});
  return {dir,url:'http://127.0.0.1:'+port,set:(value)=>fs.writeFileSync(map,JSON.stringify(value)),calls:()=>fs.existsSync(log)?fs.readFileSync(log,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[],async close(){child.kill('SIGTERM');await new Promise(resolve=>child.exitCode!==null?resolve():child.once('exit',resolve));fs.rmSync(dir,{recursive:true,force:true});}};
}

test('I06 registered independent target readback matches project, SHA, digest, original operation and terminal state',async()=>{
  const server=await makeReadOnlyHttpFixture();const dir=makeFixtureDir(({readJson,writeJson})=>{const d=readJson('environment-registration.example.json');d.example=false;Object.assign(d.environment,{id:'isolated-pilot',endpoint:server.url+'/readback',owner:'ql-wade'});Object.assign(d.environment.readbackOracle,{expectedBusinessTerminalState:'healthy',transport:'http-local-test'});writeJson('environment-registration.example.json',d);});
  const body={schemaVersion:1,project:PROJECT,environmentId:'isolated-pilot',candidateSha:SHA('b'),operationId:'run:op',artifactDigest:DIGEST('c'),businessTerminalState:'healthy',privateField:'PRIVATE_PROVIDER_VALUE'};
  const args=['probe','--case','environment-readback','--read-only','--candidate-sha',SHA('b'),'--artifact-digest',DIGEST('c'),'--operation-id','run:op','--platform-dir',dir,'--json'];
  try{
    server.set({'/readback':{body}});const good=runCli(args);assert.equal(good.status,0,good.stdout||good.stderr);assert.equal(parseJsonOut(good,'target match').observation.status,'OBSERVED_MATCH');assert.doesNotMatch(good.stdout,/PRIVATE_PROVIDER_VALUE/);
    for(const changed of [{...body,project:'other-project'},{...body,operationId:'old-operation'},{...body,artifactDigest:DIGEST('d')},{...body,businessTerminalState:'failed'}]){server.set({'/readback':{body:changed}});assert.equal(runCli(args).status,2);}
    server.set({'/readback':{status:302,headers:{Location:server.url+'/unregistered'},body:{}}});assert.equal(runCli(args).status,2);assert.ok(!server.calls().some(r=>r.url.startsWith('/unregistered')),'redirect never extends the registered endpoint');
    server.set({'/readback':{status:403,body:{privateField:'DO_NOT_ECHO'}}});const forbidden=runCli(args);assert.equal(forbidden.status,2);assert.doesNotMatch(forbidden.stdout,/DO_NOT_ECHO/);
    assert.ok(server.calls().every(r=>r.method==='GET'));
  }finally{fs.rmSync(dir,{recursive:true,force:true});await server.close();}
});

test('I06 registered OCI readback rehashes manifest/config and binds actual source SHA without claiming signing',async()=>{
  const server=await makeReadOnlyHttpFixture();const config=JSON.stringify({config:{Labels:{'org.opencontainers.image.revision':SHA('b')}}});
  const sha=(value)=>'sha256:'+crypto.createHash('sha256').update(value).digest('hex');const configDigest=sha(config);const manifest=JSON.stringify({schemaVersion:2,mediaType:'application/vnd.oci.image.manifest.v1+json',config:{digest:configDigest}});const digest=sha(manifest);
  const dir=makeFixtureDir(({readJson,writeJson})=>{const d=readJson('registry-registration.example.json');d.example=false;Object.assign(d.registry,{endpoint:server.url,kind:'oci-v2',repository:'ql-wade/sdd-harness',transport:'http-local-test'});writeJson('registry-registration.example.json',d);});
  const base='/v2/ql-wade/sdd-harness';const args=['probe','--case','artifact-readback','--read-only','--candidate-sha',SHA('b'),'--artifact-digest',digest,'--operation-id','run:op','--platform-dir',dir,'--json'];
  try{
    server.set({[base+'/manifests/'+digest]:{headers:{'Docker-Content-Digest':digest},body:manifest},[base+'/blobs/'+configDigest]:{body:config}});
    const good=runCli(args);assert.equal(good.status,0,good.stdout||good.stderr);assert.equal(parseJsonOut(good,'OCI').observation.digest,digest);assert.equal(parseJsonOut(good,'OCI').observation.signingStatus,'UNVERIFIED');
    server.set({[base+'/manifests/'+digest]:{headers:{'Docker-Content-Digest':digest},body:manifest+' '}});assert.equal(runCli(args).status,2,'the response body is rehashed, not its own digest string');
    assert.ok(server.calls().every(r=>r.method==='GET'&&r.url.startsWith(base)));
  }finally{fs.rmSync(dir,{recursive:true,force:true});await server.close();}
});


test('I06 malformed input diagnostics never echo private JSON fragments or untrusted paths',()=>{
  const marker='s0priv';const dir=makeFixtureDir(({dir})=>{fs.writeFileSync(path.join(dir,'ci-policy.json'),marker);});
  try{const result=runCli(['validate','--platform-dir',dir,'--json']);assert.equal(result.status,1);assert.doesNotMatch(result.stdout+result.stderr,new RegExp(marker),'parser exceptions are not a safe public diagnostic');}
  finally{fs.rmSync(dir,{recursive:true,force:true});}
});


test('I06 timeout remains unknown and never triggers a replacement platform action',()=>{
  const responses=platformResponses();responses.user.delayMs=350;const stub=makePlatformGhStub(responses);const dir=makeObservedPlatformFixture();
  try{const p=path.join(dir,'repository-registration.json');const d=JSON.parse(fs.readFileSync(p));d.readOnly.timeoutMs=100;fs.writeFileSync(p,JSON.stringify(d));const result=runCli(['probe','--case','platform-observation','--read-only','--candidate-sha',SHA('b'),'--platform-dir',dir,'--json'],{env:stub.env});assert.equal(result.status,2);const value=parseJsonOut(result,'timeout').observation;assert.equal(value.status,'UNVERIFIED');assert.equal(value.requests.length,1);assert.equal(value.requests[0].code,'TIMEOUT');}
  finally{fs.rmSync(stub.dir,{recursive:true,force:true});fs.rmSync(dir,{recursive:true,force:true});}
});


test('I06 artifact producer run must belong to the complete candidate run inventory',()=>{
  const responses=platformResponses();const base='repos/'+JSON.parse(fs.readFileSync(registryPath)).project.github.repoFullname;
  responses[base+'/actions/artifacts?per_page=2&page=1'].body.artifacts[0].workflow_run.id=999;
  const stub=makePlatformGhStub(responses);const dir=makeObservedPlatformFixture();
  try{
    const run=runCli(['probe','--case','platform-observation','--read-only','--candidate-sha',SHA('b'),'--platform-dir',dir,'--json'],{env:stub.env});
    assert.equal(run.status,2,'same SHA cannot substitute for the original producing run identity');
    const report=parseJsonOut(run,'foreign artifact producer').observation;
    assert.equal(report.status,'OBSERVED_WITH_GAPS');assert.ok(!report.artifacts.items.some(item=>item.matchesCandidate===true));
  }finally{fs.rmSync(stub.dir,{recursive:true,force:true});fs.rmSync(dir,{recursive:true,force:true});}
});

test('I06 workflow identity is required before a candidate run can correlate artifacts',()=>{
  const responses=platformResponses();const base='repos/'+JSON.parse(fs.readFileSync(registryPath)).project.github.repoFullname;
  delete responses[base+'/actions/runs?head_sha='+SHA('b')+'&per_page=2&page=1'].body.workflow_runs[0].workflow_id;
  const stub=makePlatformGhStub(responses);const dir=makeObservedPlatformFixture();
  try{
    const run=runCli(['probe','--case','platform-observation','--read-only','--candidate-sha',SHA('b'),'--platform-dir',dir,'--json'],{env:stub.env});
    assert.equal(run.status,2,'a missing workflow ID cannot be inferred from check names or candidate SHA');
    const report=parseJsonOut(run,'missing workflow identity').observation;
    assert.equal(report.status,'OBSERVED_WITH_GAPS');assert.equal(report.runs.status,'UNVERIFIED');assert.ok(!report.artifacts.items.some(item=>item.matchesCandidate===true));
  }finally{fs.rmSync(stub.dir,{recursive:true,force:true});fs.rmSync(dir,{recursive:true,force:true});}
});


for(const mutation of ['foreign-source-repository','missing-source-repository','null-source-repository','conflicting-repository-name','missing-workflow-path','conflicting-workflow-path','unknown-workflow','missing-run-status','missing-run-conclusion']) {
  test('I06 producer source correlation refuses '+mutation,()=>{
    const responses=platformResponses();const base='repos/'+JSON.parse(fs.readFileSync(registryPath)).project.github.repoFullname;
    const item=responses[base+'/actions/runs?head_sha='+SHA('b')+'&per_page=2&page=1'].body.workflow_runs[0];
    if(mutation==='foreign-source-repository')item.head_repository.id=999;
    if(mutation==='missing-source-repository')delete item.head_repository;
    if(mutation==='null-source-repository')item.head_repository=null;
    if(mutation==='conflicting-repository-name')item.repository.full_name='other/private';
    if(mutation==='missing-workflow-path')delete item.path;
    if(mutation==='conflicting-workflow-path')item.path='.github/workflows/other.yml@master';
    if(mutation==='unknown-workflow')item.workflow_id=999;
    if(mutation==='missing-run-status')delete item.status;
    if(mutation==='missing-run-conclusion')delete item.conclusion;
    const stub=makePlatformGhStub(responses);const dir=makeObservedPlatformFixture();
    try{
      const run=runCli(['probe','--case','platform-observation','--read-only','--candidate-sha',SHA('b'),'--platform-dir',dir,'--json'],{env:stub.env});
      assert.equal(run.status,2,mutation+' must remain unknown metadata, not an input parse error or an observed producer');
      const report=parseJsonOut(run,mutation).observation;assert.equal(report.status,'OBSERVED_WITH_GAPS');assert.equal(report.runs.status,'UNVERIFIED');assert.ok(!report.artifacts.items.some(item=>item.matchesCandidate===true));assert.doesNotMatch(run.stdout,/other\/private/);
    }finally{fs.rmSync(stub.dir,{recursive:true,force:true});fs.rmSync(dir,{recursive:true,force:true});}
  });
}

test('I06 legal queued/null metadata and historical artifacts do not authorize a producer attempt',()=>{
  const responses=platformResponses();const gh=JSON.parse(fs.readFileSync(registryPath)).project.github;const base='repos/'+gh.repoFullname;
  const item=responses[base+'/actions/runs?head_sha='+SHA('b')+'&per_page=2&page=1'].body.workflow_runs[0];item.status='queued';item.conclusion=null;item.path='.github/workflows/ci.yml';
  const artifacts=responses[base+'/actions/artifacts?per_page=2&page=1'].body;artifacts.total_count=1;artifacts.artifacts=[{id:42,name:'older-build',expired:true,digest:null,workflow_run:{id:999,repository_id:gh.repoId,head_repository_id:gh.repoId,head_sha:SHA('d')}}];
  const stub=makePlatformGhStub(responses);const dir=makeObservedPlatformFixture();
  try{
    const run=runCli(['probe','--case','platform-observation','--read-only','--candidate-sha',SHA('b'),'--platform-dir',dir,'--json'],{env:stub.env});assert.equal(run.status,0,run.stdout);
    const report=parseJsonOut(run,'legal nullable metadata').observation;assert.equal(report.runs.items[0].conclusion,null);assert.equal(report.artifacts.items[0].matchesCandidate,false);assert.equal(report.artifacts.items[0].digest,null);assert.equal(report.runtimeAuthority.status,'UNVERIFIED');
  }finally{fs.rmSync(stub.dir,{recursive:true,force:true});fs.rmSync(dir,{recursive:true,force:true});}
});

test('I06 a current run ID with conflicting artifact SHA cannot be hidden as historical metadata',()=>{
  const responses=platformResponses();const base='repos/'+JSON.parse(fs.readFileSync(registryPath)).project.github.repoFullname;
  responses[base+'/actions/artifacts?per_page=2&page=1'].body.artifacts[0].workflow_run.head_sha=SHA('d');
  const stub=makePlatformGhStub(responses);const dir=makeObservedPlatformFixture();
  try{
    const run=runCli(['probe','--case','platform-observation','--read-only','--candidate-sha',SHA('b'),'--platform-dir',dir,'--json'],{env:stub.env});assert.equal(run.status,2,'the same producer run cannot report a different source SHA');
    const report=parseJsonOut(run,'artifact producer SHA conflict').observation;assert.equal(report.artifacts.status,'UNVERIFIED');assert.equal(report.status,'OBSERVED_WITH_GAPS');
  }finally{fs.rmSync(stub.dir,{recursive:true,force:true});fs.rmSync(dir,{recursive:true,force:true});}
});

test('I06 deployment metadata never treats an unselected environment as a registered business terminal',()=>{
  const responses=platformResponses();const base='repos/'+JSON.parse(fs.readFileSync(registryPath)).project.github.repoFullname;
  responses[base+'/deployments?sha='+SHA('b')+'&per_page=2&page=1'].body=[{id:51,sha:SHA('b'),environment:'UNSELECTED',creator:null,performed_via_github_app:null,payload:{privateValue:'PRIVATE_DEPLOYMENT_VALUE'}}];
  const stub=makePlatformGhStub(responses);const dir=makeObservedPlatformFixture();
  try{
    const run=runCli(['probe','--case','platform-observation','--read-only','--candidate-sha',SHA('b'),'--platform-dir',dir,'--json'],{env:stub.env});assert.equal(run.status,0,run.stdout);
    const report=parseJsonOut(run,'deployment scope').observation;assert.equal(report.deployments.items[0].registeredEnvironment,false);assert.equal(report.deployments.items[0].productionCorrelation,'UNVERIFIED');assert.equal(report.runtimeAuthority.status,'UNVERIFIED');assert.doesNotMatch(run.stdout,/PRIVATE_DEPLOYMENT_VALUE/);
  }finally{fs.rmSync(stub.dir,{recursive:true,force:true});fs.rmSync(dir,{recursive:true,force:true});}
});


for(const collection of ['runs','workflows']) {
  test('I06 incomplete '+collection+' inventory cannot correlate a valid prefix producer',()=>{
    const responses=platformResponses();const base='repos/'+JSON.parse(fs.readFileSync(registryPath)).project.github.repoFullname;
    if(collection==='runs')responses[base+'/actions/runs?head_sha='+SHA('b')+'&per_page=2&page=1'].body.total_count=2;
    else for(const page of [1,2])responses[base+'/actions/workflows?per_page=2&page='+page].body.total_count=4;
    const stub=makePlatformGhStub(responses);const dir=makeObservedPlatformFixture();
    try{
      const run=runCli(['probe','--case','platform-observation','--read-only','--candidate-sha',SHA('b'),'--platform-dir',dir,'--json'],{env:stub.env});assert.equal(run.status,2);
      const report=parseJsonOut(run,'incomplete producer inventory').observation;assert.equal(report[collection].complete,false);assert.equal(report.artifacts.status,'UNVERIFIED');assert.ok(!report.artifacts.items.some(item=>item.matchesCandidate===true),'a valid prefix is not a complete producer inventory');
    }finally{fs.rmSync(stub.dir,{recursive:true,force:true});fs.rmSync(dir,{recursive:true,force:true});}
  });
}

test('I06 a legal null artifact workflow reference remains unverified instead of inventing a producer',()=>{
  const responses=platformResponses();const base='repos/'+JSON.parse(fs.readFileSync(registryPath)).project.github.repoFullname;responses[base+'/actions/artifacts?per_page=2&page=1'].body.artifacts[0].workflow_run=null;
  const stub=makePlatformGhStub(responses);const dir=makeObservedPlatformFixture();
  try{
    const run=runCli(['probe','--case','platform-observation','--read-only','--candidate-sha',SHA('b'),'--platform-dir',dir,'--json'],{env:stub.env});assert.equal(run.status,2);
    const report=parseJsonOut(run,'null artifact producer').observation;assert.equal(report.artifacts.status,'UNVERIFIED');assert.equal(report.status,'OBSERVED_WITH_GAPS');
  }finally{fs.rmSync(stub.dir,{recursive:true,force:true});fs.rmSync(dir,{recursive:true,force:true});}
});

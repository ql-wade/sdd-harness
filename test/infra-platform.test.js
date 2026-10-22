import assert, { AssertionError } from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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
// 环境事实（2026-10-20 实测，evidence/env-probe.txt）：gh 令牌失效 + TLS 拦截（x509 OSStatus -26276），
// GitHub 只读读回不可行 → 如实 UNVERIFIED；无远端分支保护/CI 配置写授权 → LOCAL_ONLY；
// docker daemon EPERM。管理员身份不等于本次批准修改分支保护（计划明示）。
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
  assert.equal(report.summary.repository.branchProtection.configuredStatus, 'UNVERIFIED');
  assert.equal(report.summary.ci.providerStatus, 'UNSELECTED');
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
  assert.equal(repo.identity.readback.status, 'UNVERIFIED', 'gh TLS/token failure must stay honest');
  assert.ok(String(repo.identity.readback.error).includes('x509'), 'raw readback error preserved verbatim');
  assert.equal(repo.branchProtection.configuredStatus, 'UNVERIFIED');
  assert.equal(repo.remotePolicyWrites.allowed, false);
  assert.equal(repo.localOnly, true);

  const ci = JSON.parse(fs.readFileSync(path.join(platformDir, 'ci-policy.json'), 'utf8'));
  assert.equal(ci.interface, 'PlatformInfra.v1');
  for (const code of ['MISSING', 'SKIPPED', 'TIMED_OUT', 'STALE_EVIDENCE']) {
    assert.ok(ci.requiredChecks.blockingSemantics.includes(code), `blocking semantics must declare ${code}`);
  }
  assert.equal(ci.requiredChecks.failClosed, true);
  assert.equal(ci.authorization.remotePolicyWriteAuthorized, false);
  assert.equal(ci.provider.status, 'UNSELECTED', 'CI provider is an unprovided input; must not be invented');

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
    const chainFile = tmpFile(`chain-check-${index}`, greenChain(fixture));
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

test('probes are real and honest: repository-identity performs one read-only gh attempt and stays UNVERIFIED; bare chain probe is structured UNVERIFIED', () => {
  const noReadOnly = runCli(['probe', '--case', 'repository-identity', '--json']);
  assert.equal(noReadOnly.status, 1, 'repository-identity is read-only by contract; omitting --read-only is an input error');

  const probe = runCli(['probe', '--case', 'repository-identity', '--read-only', '--json']);
  assert.equal(probe.status, 2, 'gh TLS/token failure must surface as structured UNVERIFIED (nonzero)');
  const report = parseJsonOut(probe, 'repository-identity');
  assert.equal(report.executed, true, 'a real gh api attempt must have been made');
  assert.equal(report.readback.status, 'UNVERIFIED');
  assert.ok(String(report.readback.error ?? '').length > 0, 'the raw readback error is preserved verbatim');
  assert.ok(report.readback.command, 'the attempted command is recorded');
  assert.equal(report.localConsistency, 'PASS', 'local same-origin binding is checkable locally and must pass');
  assert.doesNotMatch(probe.stdout, /"skip"\s*:\s*true/, 'probes must not skip');
  assert.doesNotMatch(probe.stdout, HOST_PATH_OUTPUT_RE);

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

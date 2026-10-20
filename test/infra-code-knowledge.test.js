import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// V_INFRA_I05 — I05 自托管deepwiki-open及独立CodeGraph 的契约检查。
// 规格：infrastructure-tasks.json 的 I05 条目 + infrastructure-plan.md I05 小节。
//
//   CodeKnowledgeInfra.v1 validate|qualify|up|probe -> 自托管 code-wiki 与独立 graph 的来源/新鲜度证据；
//                     本环境无运行时/无已认证镜像时 up/probe 必须结构化拒绝（退出 2 + UNVERIFIED + 确切原因），
//                     绝不 mock 转绿、绝不 skip。
//   CodeWiki.v1       repository immutableID/commit、wiki 生成 manifest、批准的代码访问 scope；
//                     未固定 commit、未授权源码、错误项目源一律拒绝摄入；敏感代码不得用公共托管服务替代。
//   CodeGraph.v1      structure-only 索引，精确 input commit/coverage；可删除的独立优化件，
//                     无 gate 权威、无知识权威——停用后正确性协议照常执行（真实重跑主校验链，不靠开关文本）。
//
// CLI 退出码契约（execution-contract.json V_INFRA_I05.cli_contract）：
//   0=PASS，1=输入/前置无效（文件缺失/不可解析/参数错误），2=验证失败（语义违规、up 被拒、UNVERIFIED）。
//
// 负例 fixture 全部在 os.tmpdir() 生成，不向活配置写入任何状态。
// 约束：deepwiki-open 上游仓库/发行物未选定，当前不存在已认证镜像，严禁虚构 tag/digest/版本——
// 所有镜像探针值只存在于 tmp fixture，绝不写入仓库。

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '..');
const domainDir = path.join(repoRoot, 'infra', 'delivery', 'code-knowledge');
const registryPath = path.join(repoRoot, 'infra', 'delivery', 'registry.json');
const cliPath = path.join(repoRoot, 'tools', 'infra', 'code-knowledge.mjs');
const secretRefsModuleUrl = new URL('../tools/infra/secret-refs.mjs', import.meta.url);

const RUN_TIMEOUT_MS = 60_000;
const DOMAIN_FILES = [
  'compose.yaml',
  'images.lock.json',
  'deepwiki-profile.json',
  'graph-profile.json',
  'repository-scope.json',
];
const JSON_FILES = DOMAIN_FILES.filter((name) => name.endsWith('.json'));
const HOST_PATH_OUTPUT_RE = /\/(Users|home|root|private|var|usr|etc|opt|tmp)\//;
const PINNED_COMMIT = 'b'.repeat(40);

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
  return fs.readFileSync(path.join(domainDir, name), 'utf8');
}

function readDomainJson(name) {
  return JSON.parse(readDomainFile(name));
}

// 把已提交的 code-knowledge 域整体拷到 tmp fixture，应用 mutate({dir, read, write, json, writeJson}) 后返回 fixture 目录。
function makeFixtureDir(mutate) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'infra-i05-'));
  for (const name of DOMAIN_FILES) {
    fs.copyFileSync(path.join(domainDir, name), path.join(dir, name));
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

// 在 fixture scope 中加入一条已批准源（含固定 immutableID+commit）；仅存在于 tmp fixture。
function addApprovedSource(json, writeJson, overrides = {}) {
  const scope = json('repository-scope.json');
  scope.approvedSources.push({
    project: 'sdd-harness-pilot',
    immutableId: 'rid-sdd-harness-pilot-fixture',
    repository: 'rpamis/sdd-harness',
    commit: PINNED_COMMIT,
    grantRef: 'secret-ref:sdd-harness-pilot/codewiki-source-read',
    status: 'AUTHORIZED',
    ...overrides,
  });
  writeJson('repository-scope.json', scope);
}

test('V_INFRA_I05 contract: committed code-knowledge domain validates clean; qualify/up honor the exit contract', () => {
  const validate = runCli(['validate', '--registry', registryPath, '--dir', domainDir, '--json']);
  assert.equal(validate.status, 0, `validate must PASS on committed files: ${validate.stderr || validate.stdout}`);
  const report = parseJsonOut(validate, 'validate');
  assert.equal(report.ok, true);
  assert.deepEqual(report.violations, []);
  // 结构化回执绝不回显宿主绝对路径（fixture 目录在 tmp，也必须脱敏）。
  assert.doesNotMatch(validate.stdout, HOST_PATH_OUTPUT_RE, 'validate output must not carry host absolute paths');
  // 三个公共接口必须在回执中如实呈现。
  assert.equal(report.interface, 'CodeKnowledgeInfra.v1');
  assert.ok(report.wiki, 'CodeWiki.v1 summary must be present');
  assert.equal(report.wiki.interface, 'CodeWiki.v1');
  assert.ok(report.graph, 'CodeGraph.v1 summary must be present');
  assert.equal(report.graph.interface, 'CodeGraph.v1');
  assert.ok(report.scope, 'approved code access scope summary must be present');

  // 配置有效 ≠ 运行 ready：qualify 必须诚实 NOT_READY 且退出 2。
  const qualify = runCli(['qualify', '--registry', registryPath, '--dir', domainDir, '--json']);
  assert.equal(qualify.status, 2, 'qualify must exit 2 while evidence is unready');
  const receipt = parseJsonOut(qualify, 'qualify');
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
  const partial = fs.mkdtempSync(path.join(os.tmpdir(), 'infra-i05-partial-'));
  for (const name of DOMAIN_FILES.filter((n) => n !== 'repository-scope.json')) {
    fs.copyFileSync(path.join(domainDir, name), path.join(partial, name));
  }
  const missing = runCli(['validate', '--registry', registryPath, '--dir', partial, '--json']);
  assert.equal(missing.status, 1, 'a missing domain file (repository-scope) is an input/prerequisite failure');
  assert.doesNotMatch(missing.stdout + missing.stderr, HOST_PATH_OUTPUT_RE);
});

test('gap-reporting behavior: registered refs are never reported as gaps; a missing ref is always explicitly reported (synthetic fixture)', () => {
  // 正向断言：I01 修正案 f8c982b 已登记全部 3 个 code-knowledge ref（目录 18 refs）——
  // committed 域 validate 必须干净且不把它们报成 catalogGap。
  // 纪律：断言活仓库状态（目录成员/登记表）一律解析当前态再翻转或用合成 fixture；
  // 缺口上报行为覆盖由下方合成负例承担，不依赖活目录状态。
  const validate = runCli(['validate', '--registry', registryPath, '--dir', domainDir, '--json']);
  assert.equal(validate.status, 0, `validate must PASS with the amended I01 catalog: ${validate.stderr || validate.stdout}`);
  const report = parseJsonOut(validate, 'validate');
  assert.equal(report.ok, true);
  for (const name of ['codewiki-source-read', 'codewiki-provider', 'codegraph-source-read']) {
    assert.ok(
      !(report.catalogGaps ?? []).includes(`secret-ref:sdd-harness-pilot/${name}`),
      `${name} is registered in the I01 catalog (amendment f8c982b) and must not be reported as a catalogGap`,
    );
  }

  // 合成负例（临时 fixture）：从 refs 目录副本中移除一个已登记 ref，validate 仍显式上报缺口。
  const refsDoc = JSON.parse(fs.readFileSync(path.join(repoRoot, 'infra', 'delivery', 'secrets.refs.example.json'), 'utf8'));
  refsDoc.refs = refsDoc.refs.filter((entry) => entry.ref !== 'secret-ref:sdd-harness-pilot/codewiki-provider');
  const refsFixture = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'infra-i05-refs-')), 'refs.json');
  fs.writeFileSync(refsFixture, JSON.stringify(refsDoc, null, 2) + '\n');
  const result = runCli(['validate', '--registry', registryPath, '--dir', domainDir, '--refs', refsFixture, '--json']);
  assert.equal(result.status, 0, 'a catalog gap is readiness evidence (qualify), not a structural violation');
  assert.ok(
    (parseJsonOut(result, 'validate gaps').catalogGaps ?? []).includes('secret-ref:sdd-harness-pilot/codewiki-provider'),
    'validate must explicitly report the missing ref as a catalogGap instead of passing silently',
  );
  assert.doesNotMatch(result.stdout, HOST_PATH_OUTPUT_RE);
});

test('RED image gate: images.lock without any authenticated digest refuses up (committed state, nothing fabricated)', () => {
  const lock = readDomainJson('images.lock.json');
  const components = lock.components ?? [];
  const required = ['codewiki-app', 'codegraph'];
  for (const name of required) {
    const entry = components.find((c) => c.component === name);
    assert.ok(entry, `lock must declare ${name}`);
    assert.equal(entry.reference, null, `${name}: upstream/release unselected, no tag may be invented`);
    assert.equal(entry.digest, null, `${name}: no authenticated digest exists, none may be invented`);
    assert.equal(entry.status, 'UNVERIFIED', `${name} must be honestly UNVERIFIED`);
  }
  assert.equal(lock.upGate.enabled, false, 'committed lock must keep the up gate closed');

  const up = runCli(['up', '--registry', registryPath, '--dir', domainDir, '--json']);
  assert.equal(up.status, 2, 'up must refuse while the lock has no authenticated digest');
  const upReport = parseJsonOut(up, 'up');
  assert.equal(upReport.refused, true);
  assert.match(upReport.error, /UP_REFUSED_IMAGES_LOCK_NOT_READY/);
  assert.ok(Array.isArray(upReport.unverifiedComponents) && upReport.unverifiedComponents.length >= required.length);
  assert.doesNotMatch(up.stdout, HOST_PATH_OUTPUT_RE);
});

test('RED image gate: floating tag is rejected', () => {
  const dir = makeFixtureDir(({ json, writeJson }) => {
    const lock = json('images.lock.json');
    lock.components.find((c) => c.component === 'codewiki-app').reference = 'ghcr.io/example/deepwiki-open:latest';
    writeJson('images.lock.json', lock);
  });
  const result = runCli(['validate', '--registry', registryPath, '--dir', dir, '--json']);
  assert.equal(result.status, 2, 'a floating :latest tag must not pass validate');
  assert.ok(codes(parseJsonOut(result, 'validate')).includes('FLOATING_TAG_FORBIDDEN'), JSON.stringify(result.stdout));
});

test('RED image gate: malformed digest rejected; well-formed but unauthenticated digest never reaches VERIFIED', () => {
  const malformed = makeFixtureDir(({ json, writeJson }) => {
    const lock = json('images.lock.json');
    lock.components.find((c) => c.component === 'codewiki-app').digest = 'sha256:deadbeef';
    writeJson('images.lock.json', lock);
  });
  const malformedRun = runCli(['validate', '--registry', registryPath, '--dir', malformed, '--json']);
  assert.equal(malformedRun.status, 2, 'format-invalid digest must not pass');
  assert.ok(
    codes(parseJsonOut(malformedRun, 'validate')).includes('DIGEST_FORMAT_INVALID'),
    JSON.stringify(malformedRun.stdout),
  );

  // 仅出现在 fixture 中的探针值（绝不入库）：即使 digest 格式合法，未经认证也必须保持 UNVERIFIED、up 仍拒绝。
  const unauthenticated = makeFixtureDir(({ json, writeJson }) => {
    const lock = json('images.lock.json');
    const app = lock.components.find((c) => c.component === 'codewiki-app');
    app.reference = 'ghcr.io/example/unselected:vX.Y.Z-not-selected';
    app.digest = `sha256:${'a'.repeat(64)}`;
    app.digestAuthenticated = false;
    writeJson('images.lock.json', lock);
  });
  const validateRun = runCli(['validate', '--registry', registryPath, '--dir', unauthenticated, '--json']);
  assert.equal(validateRun.status, 0, 'structurally honest lock (unauthenticated flag set) still validates');
  const qualifyRun = runCli(['qualify', '--registry', registryPath, '--dir', unauthenticated, '--json']);
  assert.equal(qualifyRun.status, 2);
  assert.equal(parseJsonOut(qualifyRun, 'qualify').categories['image-digest-authenticated'].status, 'UNVERIFIED');
  const upRun = runCli(['up', '--registry', registryPath, '--dir', unauthenticated, '--json']);
  assert.equal(upRun.status, 2, 'up must still refuse without digest authentication');
  assert.match(parseJsonOut(upRun, 'up').error, /UP_REFUSED_IMAGES_LOCK_NOT_READY/);
});

test('RED source scope gate: deny-by-default with zero authorized sources refuses startup/ingest; cross-project or unpinned sources rejected', () => {
  // 已提交 scope：deny-by-default，没有任何已批准源；未授权源码不得启动/摄入。
  const scope = readDomainJson('repository-scope.json');
  assert.equal(scope.scope.ingestRequiresAuthorizedScope, true, 'ingest must require an authorized scope by policy');
  assert.deepEqual(scope.approvedSources, [], 'committed state authorizes nothing (deny-by-default)');
  assert.equal(scope.scope.publicHostedServiceSubstitute.allowed, false, 'public hosted service is not an allowed substitute');

  // 镜像门先行（fixture 双组件均带已认证 digest —— 探针值只存在于 tmp），随后源 scope 门拒绝。
  const imagesReadyNoSource = makeFixtureDir(({ json, writeJson }) => {
    const lock = json('images.lock.json');
    for (const component of lock.components) {
      component.reference = `ghcr.io/example/${component.component}:vX-fixture-only`;
      component.digest = `sha256:${'c'.repeat(64)}`;
      component.digestAuthenticated = true;
    }
    writeJson('images.lock.json', lock);
  });
  const upNoSource = runCli(['up', '--registry', registryPath, '--dir', imagesReadyNoSource, '--json']);
  assert.equal(upNoSource.status, 2, 'up must refuse startup while no source is authorized');
  assert.match(parseJsonOut(upNoSource, 'up').error, /UP_REFUSED_SOURCE_SCOPE_NOT_AUTHORIZED/);

  // 错误项目源（pav-*）：批准列表里出现其它项目源 → 结构性拒绝。
  const crossProject = makeFixtureDir(({ json, writeJson }) => {
    addApprovedSource(json, writeJson, { project: 'pav-legacy' });
  });
  const crossRun = runCli(['validate', '--registry', registryPath, '--dir', crossProject, '--json']);
  assert.equal(crossRun.status, 2, 'an approved source from another project must be rejected');
  assert.ok(codes(parseJsonOut(crossRun, 'validate')).includes('CROSS_PROJECT_SOURCE'), JSON.stringify(crossRun.stdout));

  // 未固定 commit 的源 → 拒绝。
  const unpinned = makeFixtureDir(({ json, writeJson }) => {
    addApprovedSource(json, writeJson, { commit: null });
  });
  const unpinnedRun = runCli(['validate', '--registry', registryPath, '--dir', unpinned, '--json']);
  assert.equal(unpinnedRun.status, 2, 'an approved source without a pinned commit must be rejected');
  assert.ok(codes(parseJsonOut(unpinnedRun, 'validate')).includes('SOURCE_COMMIT_NOT_PINNED'));

  // 缺 immutableID 的源 → 拒绝。
  const noId = makeFixtureDir(({ json, writeJson }) => {
    addApprovedSource(json, writeJson, { immutableId: null });
  });
  const noIdRun = runCli(['validate', '--registry', registryPath, '--dir', noId, '--json']);
  assert.equal(noIdRun.status, 2, 'an approved source without an immutable id must be rejected');
  assert.ok(codes(parseJsonOut(noIdRun, 'validate')).includes('SOURCE_IMMUTABLE_ID_MISSING'));
});

test('RED substitute gate: declaring a public hosted service as the sensitive-code alternative is rejected in both CodeWiki files', () => {
  const profileSub = makeFixtureDir(({ json, writeJson }) => {
    const profile = json('deepwiki-profile.json');
    profile.service.publicHostedServiceSubstitute = true;
    writeJson('deepwiki-profile.json', profile);
  });
  const profileRun = runCli(['validate', '--registry', registryPath, '--dir', profileSub, '--json']);
  assert.equal(profileRun.status, 2, 'the code-wiki profile must never declare a public hosted service substitute');
  assert.ok(codes(parseJsonOut(profileRun, 'validate')).includes('PUBLIC_SERVICE_SUBSTITUTE_FORBIDDEN'));

  const scopeSub = makeFixtureDir(({ json, writeJson }) => {
    const scope = json('repository-scope.json');
    scope.scope.publicHostedServiceSubstitute.allowed = true;
    writeJson('repository-scope.json', scope);
  });
  const scopeRun = runCli(['validate', '--registry', registryPath, '--dir', scopeSub, '--json']);
  assert.equal(scopeRun.status, 2, 'the repository scope must never allow a public hosted service substitute');
  assert.ok(codes(parseJsonOut(scopeRun, 'validate')).includes('PUBLIC_SERVICE_SUBSTITUTE_FORBIDDEN'));
});

test('RED cross-project gate: credential refs resolving into another project (pav-*) are rejected', () => {
  const crossProvider = makeFixtureDir(({ json, writeJson }) => {
    const profile = json('deepwiki-profile.json');
    profile.provider.credentialRef = 'secret-ref:pav-legacy/codewiki-provider';
    writeJson('deepwiki-profile.json', profile);
  });
  const providerRun = runCli(['validate', '--registry', registryPath, '--dir', crossProvider, '--json']);
  assert.equal(providerRun.status, 2);
  assert.ok(codes(parseJsonOut(providerRun, 'validate')).includes('CROSS_PROJECT_REF'));

  const crossGraph = makeFixtureDir(({ json, writeJson }) => {
    const graph = json('graph-profile.json');
    graph.source.credentialRef = 'secret-ref:pav-legacy/codegraph-source-read';
    writeJson('graph-profile.json', graph);
  });
  const graphRun = runCli(['validate', '--registry', registryPath, '--dir', crossGraph, '--json']);
  assert.equal(graphRun.status, 2);
  assert.ok(codes(parseJsonOut(graphRun, 'validate')).includes('CROSS_PROJECT_REF'));
});

test('RED freshness gate: generation failure, stale commit, unauthorized source and undecided policy can never report freshness pass', () => {
  // 新鲜度评估是 probe 的真实本地动作：--manifest 提供生成 manifest（tmp fixture），
  // probe 按 CodeWiki.v1 逐条核对（generation 成功、scope 授权、commit 一致、策略已定），
  // 任何一条不满足都必须 passed=false 且退出 2——绝不报通过。

  // 已提交状态（无 manifest、无 endpoint）：结构化 UNVERIFIED + requiredInputs + plannedSteps。
  const bare = runCli(['probe', '--case', 'pinned-code-wiki', '--registry', registryPath, '--dir', domainDir, '--json']);
  assert.equal(bare.status, 2, 'pinned-code-wiki without any runtime input must exit 2 UNVERIFIED');
  const bareReport = parseJsonOut(bare, 'probe bare');
  assert.equal(bareReport.executed, false, 'probe must not pretend to have executed');
  assert.equal(bareReport.status, 'UNVERIFIED');
  assert.ok(bareReport.reason && bareReport.reason.length > 0);
  assert.ok(Array.isArray(bareReport.requiredInputs) && bareReport.requiredInputs.length > 0);
  assert.ok(Array.isArray(bareReport.plannedSteps) && bareReport.plannedSteps.length > 0);
  assert.doesNotMatch(bare.stdout, HOST_PATH_OUTPUT_RE);
  assert.doesNotMatch(bare.stdout, /"skip"\s*:\s*true/, 'probes must not skip');

  const writeManifest = (mutate) => {
    const dir = makeFixtureDir(({ json, writeJson }) => {
      addApprovedSource(json, writeJson);
      if (mutate) mutate({ json, writeJson });
    });
    const manifestPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'infra-i05-manifest-')), 'manifest.json');
    return { dir, manifestPath };
  };
  const probeWith = (dir, manifestPath) =>
    runCli(['probe', '--case', 'pinned-code-wiki', '--registry', registryPath, '--dir', dir, '--manifest', manifestPath, '--json']);

  // (a) wiki 生成失败 → 新鲜度不得报通过。
  const failed = writeManifest();
  fs.writeFileSync(failed.manifestPath, JSON.stringify({
    immutableId: 'rid-sdd-harness-pilot-fixture',
    commit: PINNED_COMMIT,
    generation: { status: 'failed' },
    languageCoverage: [],
  }, null, 2));
  const failedRun = probeWith(failed.dir, failed.manifestPath);
  assert.equal(failedRun.status, 2, 'a failed generation must never report freshness pass');
  const failedReport = parseJsonOut(failedRun, 'freshness failed');
  assert.equal(failedReport.freshness.passed, false);
  assert.match(failedReport.freshness.code, /GENERATION_NOT_CONFIRMED/);
  assert.doesNotMatch(failedRun.stdout, HOST_PATH_OUTPUT_RE);

  // (b) commit 陈旧（manifest commit ≠ 批准 scope 固定 commit）→ 不得报通过。
  const stale = writeManifest();
  fs.writeFileSync(stale.manifestPath, JSON.stringify({
    immutableId: 'rid-sdd-harness-pilot-fixture',
    commit: 'a'.repeat(40),
    generation: { status: 'succeeded' },
    languageCoverage: [],
  }, null, 2));
  const staleRun = probeWith(stale.dir, stale.manifestPath);
  assert.equal(staleRun.status, 2, 'a stale commit must never report freshness pass');
  const staleReport = parseJsonOut(staleRun, 'freshness stale');
  assert.equal(staleReport.freshness.passed, false);
  assert.match(staleReport.freshness.code, /COMMIT_MISMATCH_STALE/);

  // (c) 错误项目源/未授权源被当作项目结果 → 拒绝（immutableId 不在批准 scope 内）。
  const foreign = writeManifest();
  fs.writeFileSync(foreign.manifestPath, JSON.stringify({
    immutableId: 'rid-pav-legacy-other-project',
    commit: PINNED_COMMIT,
    generation: { status: 'succeeded' },
    languageCoverage: [],
  }, null, 2));
  const foreignRun = probeWith(foreign.dir, foreign.manifestPath);
  assert.equal(foreignRun.status, 2, 'a foreign/other-project index must never be accepted as the project result');
  const foreignReport = parseJsonOut(foreignRun, 'freshness foreign');
  assert.equal(foreignReport.freshness.passed, false);
  assert.match(foreignReport.freshness.code, /SOURCE_NOT_AUTHORIZED/);

  // (d) 语言覆盖阈值未定（策略 UNSET）→ fail-closed：即使 manifest 其它字段完美也不得报通过。
  const undecided = writeManifest();
  fs.writeFileSync(undecided.manifestPath, JSON.stringify({
    immutableId: 'rid-sdd-harness-pilot-fixture',
    commit: PINNED_COMMIT,
    generation: { status: 'succeeded' },
    languageCoverage: [{ language: 'javascript', filesIndexed: 999 }],
  }, null, 2));
  const undecidedRun = probeWith(undecided.dir, undecided.manifestPath);
  assert.equal(undecidedRun.status, 2, 'undecided freshness policy must fail closed');
  const undecidedReport = parseJsonOut(undecidedRun, 'freshness undecided');
  assert.equal(undecidedReport.freshness.passed, false);
  assert.match(undecidedReport.freshness.code, /FRESHNESS_POLICY_UNSET/);

  // manifest 文件不可解析 = 输入无效 → 退出 1。
  const badManifest = writeManifest();
  fs.writeFileSync(badManifest.manifestPath, '{not json');
  assert.equal(probeWith(badManifest.dir, badManifest.manifestPath).status, 1);
});

test('CodeGraph.v1: removable optimization, no gate/knowledge authority; graph-disabled correctness is a real local probe', () => {
  // 已提交 graph profile：可删、无权威、structure-only、重建必须重新拉取。
  const graph = readDomainJson('graph-profile.json');
  assert.equal(graph.enabled, false, 'graph ships disabled (removable optional component)');
  assert.equal(graph.removableOptimization.removable, true);
  assert.equal(graph.removableOptimization.gateAuthority, false, 'graph must hold no gate authority');
  assert.equal(graph.removableOptimization.knowledgeAuthority, false, 'graph must hold no knowledge authority');
  assert.equal(graph.source.structureOnly, true);
  assert.equal(graph.source.inputCommitPinRequired, true);
  assert.equal(graph.lifecycle.rebuildRequiresFreshPull, true);

  // 真实本地探针：graph 停用状态下重跑主校验链（不是读开关文本）。
  const probe = runCli(['probe', '--case', 'graph-disabled-correctness', '--registry', registryPath, '--dir', domainDir, '--json']);
  assert.equal(probe.status, 0, 'main validation chain must be green with graph disabled');
  const report = parseJsonOut(probe, 'probe graph-disabled-correctness');
  assert.equal(report.executed, true, 'the probe really executes the chain');
  assert.equal(report.status, 'VERIFIED');
  const rerun = (report.observedSteps ?? []).find((step) => /main validation chain/.test(step.step));
  assert.ok(rerun, 'an observed step must record the real chain re-run');
  assert.equal(rerun.status, 'VERIFIED');
  assert.equal(rerun.violations, 0);
  assert.doesNotMatch(probe.stdout, HOST_PATH_OUTPUT_RE);

  // 正交性：graph 启用与否不改变正确性协议——fixture 打开 enabled，主链路仍绿。
  const enabled = makeFixtureDir(({ json, writeJson }) => {
    const fixtureGraph = json('graph-profile.json');
    fixtureGraph.enabled = true;
    writeJson('graph-profile.json', fixtureGraph);
  });
  const enabledRun = runCli(['probe', '--case', 'graph-disabled-correctness', '--registry', registryPath, '--dir', enabled, '--json']);
  assert.equal(enabledRun.status, 0, 'correctness protocol must not depend on the graph flag');

  // 负例：graph 声明 gate 权威 → 主校验链拒绝（CodeGraph 不得成为 gate）。
  const gateAuthority = makeFixtureDir(({ json, writeJson }) => {
    const fixtureGraph = json('graph-profile.json');
    fixtureGraph.removableOptimization.gateAuthority = true;
    writeJson('graph-profile.json', fixtureGraph);
  });
  const gateRun = runCli(['validate', '--registry', registryPath, '--dir', gateAuthority, '--json']);
  assert.equal(gateRun.status, 2, 'graph gate authority must be rejected by the main chain');
  assert.ok(codes(parseJsonOut(gateRun, 'validate')).includes('GRAPH_GATE_AUTHORITY_FORBIDDEN'));

  const knowledgeAuthority = makeFixtureDir(({ json, writeJson }) => {
    const fixtureGraph = json('graph-profile.json');
    fixtureGraph.removableOptimization.knowledgeAuthority = true;
    writeJson('graph-profile.json', fixtureGraph);
  });
  const knowledgeRun = runCli(['validate', '--registry', registryPath, '--dir', knowledgeAuthority, '--json']);
  assert.equal(knowledgeRun.status, 2, 'graph knowledge authority must be rejected');
  assert.ok(codes(parseJsonOut(knowledgeRun, 'validate')).includes('GRAPH_KNOWLEDGE_AUTHORITY_FORBIDDEN'));

  // 可删性被取消（graph 变成承重件）→ 拒绝。
  const notRemovable = makeFixtureDir(({ json, writeJson }) => {
    const fixtureGraph = json('graph-profile.json');
    fixtureGraph.removableOptimization.removable = false;
    writeJson('graph-profile.json', fixtureGraph);
  });
  const removableRun = runCli(['validate', '--registry', registryPath, '--dir', notRemovable, '--json']);
  assert.equal(removableRun.status, 2, 'graph must stay removable (optimization, not load-bearing)');
  assert.ok(codes(parseJsonOut(removableRun, 'validate')).includes('GRAPH_REMOVABILITY_REQUIRED'));
});

test('CodeWiki.v1 profile gates: selfhost pinned-upstream structure, manifest/freshness/readback policies must be declared', () => {
  const profile = readDomainJson('deepwiki-profile.json');
  assert.equal(profile.interface, 'CodeWiki.v1');
  assert.equal(profile.service.kind, 'selfhost-deepwiki-open');
  assert.equal(profile.service.upstream.status, 'UNSELECTED', 'upstream is unselected: nothing may be invented');
  assert.equal(profile.service.upstream.repository, null);
  assert.equal(profile.service.upstream.commit, null);
  assert.equal(profile.generation.manifestRequired, true, 'a wiki generation manifest is required by policy');
  assert.equal(profile.generation.freshness.commitPinRequired, true);
  assert.equal(profile.access.apiAuthRequired, true, 'API/MCP access must be authenticated per policy');
  assert.equal(profile.access.mcpReadbackRequired, true, 'policy requires an independent API/MCP readback');

  // 未选定上游但声称已选定且不给 commit → 拒绝（选定必须固定 commit）。
  const fakeSelected = makeFixtureDir(({ json, writeJson }) => {
    const fixtureProfile = json('deepwiki-profile.json');
    fixtureProfile.service.upstream.status = 'SELECTED';
    writeJson('deepwiki-profile.json', fixtureProfile);
  });
  const fakeRun = runCli(['validate', '--registry', registryPath, '--dir', fakeSelected, '--json']);
  assert.equal(fakeRun.status, 2, 'claiming a selected upstream without a pinned commit must be rejected');
  assert.ok(codes(parseJsonOut(fakeRun, 'validate')).includes('UPSTREAM_COMMIT_NOT_PINNED'));

  // manifest 策略缺失 → 拒绝。
  const noManifestPolicy = makeFixtureDir(({ json, writeJson }) => {
    const fixtureProfile = json('deepwiki-profile.json');
    fixtureProfile.generation.manifestRequired = false;
    writeJson('deepwiki-profile.json', fixtureProfile);
  });
  const manifestRun = runCli(['validate', '--registry', registryPath, '--dir', noManifestPolicy, '--json']);
  assert.equal(manifestRun.status, 2);
  assert.ok(codes(parseJsonOut(manifestRun, 'validate')).includes('WIKI_MANIFEST_POLICY_MISSING'));

  // 独立读回策略缺失 → 拒绝。
  const noReadback = makeFixtureDir(({ json, writeJson }) => {
    const fixtureProfile = json('deepwiki-profile.json');
    fixtureProfile.access.mcpReadbackRequired = false;
    writeJson('deepwiki-profile.json', fixtureProfile);
  });
  const readbackRun = runCli(['validate', '--registry', registryPath, '--dir', noReadback, '--json']);
  assert.equal(readbackRun.status, 2);
  assert.ok(codes(parseJsonOut(readbackRun, 'validate')).includes('WIKI_READBACK_POLICY_MISSING'));
});

test('probes are real subcommands: graph-disabled-correctness runs locally; pinned-code-wiki attempts real endpoints only when given', () => {
  // pinned-code-wiki 带 --endpoint 但不可达：必须真实尝试并如实报告连接失败（同一命令在有真实实例时直接可跑）。
  const unreachable = runCli([
    'probe', '--case', 'pinned-code-wiki', '--endpoint', 'http://127.0.0.1:59998',
    '--registry', registryPath, '--dir', domainDir, '--json',
  ]);
  assert.equal(unreachable.status, 2, 'unreachable endpoint must stay UNVERIFIED with exit 2');
  const unreachableReport = parseJsonOut(unreachable, 'probe unreachable');
  assert.equal(unreachableReport.status, 'UNVERIFIED');
  assert.ok(unreachableReport.reason.length > 0);
  const attempt = (unreachableReport.observedSteps ?? []).find((step) => /GET endpoint/.test(step.step));
  assert.ok(attempt, 'the probe must record the real reachability attempt');
  assert.equal(attempt.status, 'UNVERIFIED');
  assert.doesNotMatch(unreachable.stdout, HOST_PATH_OUTPUT_RE);
  assert.doesNotMatch(unreachable.stdout, /"skip"\s*:\s*true/, 'probes must not skip');
});

test('compose declaration gate: loopback binds, dedicated internal network, no host mounts, images only via lock-resolved placeholders', () => {
  const compose = readDomainFile('compose.yaml');
  assert.ok(compose.includes('networks:'), 'a dedicated network must be declared');
  assert.ok(/internal:\s*true/.test(compose), 'the dedicated network must be internal');
  for (const portLine of compose.split('\n').filter((line) => /^\s*-\s*"\d/.test(line.trim()))) {
    assert.match(portLine.trim(), /^-\s*"127\.0\.0\.1:/, `published ports must bind loopback: ${portLine}`);
  }
  for (const imageLine of compose.split('\n').filter((line) => line.trim().startsWith('image:'))) {
    assert.match(imageLine, /image:\s*\$\{[A-Z0-9_]+:\?/, `image must be resolved from the lock placeholder: ${imageLine}`);
    assert.doesNotMatch(imageLine, /:latest/, 'no floating tags anywhere in compose');
  }

  const notLoopback = makeFixtureDir(({ read, write }) => {
    write('compose.yaml', read('compose.yaml').replace('"127.0.0.1:${CODEWIKI_PORT:-7400}:7400"', '"7400:7400"'));
  });
  const loopbackRun = runCli(['validate', '--registry', registryPath, '--dir', notLoopback, '--json']);
  assert.equal(loopbackRun.status, 2, 'non-loopback port binding must be rejected');
  assert.ok(codes(parseJsonOut(loopbackRun, 'validate')).includes('PORT_BINDING_NOT_LOOPBACK'));

  const concreteImage = makeFixtureDir(({ read, write }) => {
    write('compose.yaml', read('compose.yaml').replace(
      'image: ${CODEWIKI_IMAGE:?must be resolved from infra/delivery/code-knowledge/images.lock.json before up}',
      'image: ghcr.io/example/deepwiki-open:latest',
    ));
  });
  const imageRun = runCli(['validate', '--registry', registryPath, '--dir', concreteImage, '--json']);
  assert.equal(imageRun.status, 2, 'concrete image tags in compose must be rejected (lock is the only source)');
  assert.ok(codes(parseJsonOut(imageRun, 'validate')).includes('COMPOSE_IMAGE_NOT_LOCK_RESOLVED'));

  const hostMount = makeFixtureDir(({ read, write }) => {
    write('compose.yaml', `${read('compose.yaml')}\n  extra:\n    image: \${EXTRA_IMAGE:?x}\n    volumes:\n      - /Users/example/data:/data\n`);
  });
  const mountRun = runCli(['validate', '--registry', registryPath, '--dir', hostMount, '--json']);
  assert.equal(mountRun.status, 2, 'host path bind mounts must be rejected');
  assert.ok(codes(parseJsonOut(mountRun, 'validate')).includes('HOST_MOUNT_FORBIDDEN'));
});

test('SecretRef.v1 safety: the three planned refs are referenced by domain files, referenced only, never valued', async () => {
  const secretRefs = await import(secretRefsModuleUrl);
  for (const name of JSON_FILES) {
    const violations = secretRefs.scanForForbiddenValues(readDomainJson(name));
    assert.deepEqual(violations, [], `${name} must contain no secret-shaped values or host paths`);
  }
  const referenced = JSON.stringify(JSON_FILES.map((name) => readDomainJson(name)));
  for (const name of ['codewiki-source-read', 'codewiki-provider', 'codegraph-source-read']) {
    assert.ok(referenced.includes(`secret-ref:sdd-harness-pilot/${name}`), `domain files must reference ${name}`);
  }
});

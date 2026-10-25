import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { afterEach } from 'node:test';
import { fileURLToPath } from 'node:url';

// V_INFRA_I03 — I03 Outline独立资料域、Postgres/Redis、OIDC与对象存储 的契约检查。
// 规格：infrastructure-tasks.json 的 I03 条目 + infrastructure-plan.md I03 小节。
//
//   OutlineInfra.v1   validate|qualify|up|probe|stop -> 真实 API/UI/存储/主体证据；
//                     本环境无活实例/无已认证镜像时 up/probe/stop 必须结构化拒绝（退出 2 + UNVERIFIED + 确切原因），
//                     绝不 mock 转绿、绝不 skip。
//   OutlineDomain.v1  instance/collection 不可变 ID、有效读者集、登记 owner；示例文件登记结构在位，值 UNVERIFIED。
//   OutlineState.v1   durable DB+附件存储；cache 非权限权威；fixed create UUID / lastRevision 仅真实 API
//                     验证后才可 VERIFIED，现在一律 UNVERIFIED。
//
// CLI 退出码契约（execution-contract.json V_INFRA_I03.cli_contract）：
//   0=PASS，1=输入/前置无效（文件缺失/不可解析/参数错误），2=验证失败（语义违规、up 被拒、UNVERIFIED）。
//
// 负例 fixture 全部在 os.tmpdir() 生成，不向活配置写入任何状态。
// 约束：当前不存在已认证的 Outline/Postgres/Redis/OIDC/对象存储镜像，严禁虚构 tag/digest——
// 所有镜像探针值只存在于 tmp fixture，绝不写入仓库。

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '..');
const outlineDir = path.join(repoRoot, 'infra', 'delivery', 'outline');
const registryPath = path.join(repoRoot, 'infra', 'delivery', 'registry.json');
const cliPath = path.join(repoRoot, 'tools', 'infra', 'outline.mjs');
const secretRefsModuleUrl = new URL('../tools/infra/secret-refs.mjs', import.meta.url);

const RUN_TIMEOUT_MS = 60_000;
const DOMAIN_FILES = [
  'compose.yaml',
  'images.lock.json',
  'outline.env.example',
  'oidc-registration.example.json',
  'storage-policy.json',
  'collection-registration.example.json',
];
const HOST_PATH_OUTPUT_RE = /\/(Users|home|root|private|var|usr|etc|opt|tmp)\//;
const NOMINAL_PUBLISH_REQUEST = {
  interface: 'OutlinePublishRequest.example.v1',
  collection: 'managed-source-collection',
  targetReader: 'principal:reader-a@example.test',
  audienceIntersection: ['principal:owner@example.test', 'principal:reader-a@example.test'],
  pagination: { complete: true },
  principalMapping: { status: 'MAPPED', subject: 'sub-reader-a' },
  grant: { ref: 'secret-ref:sdd-harness-pilot/outline-publisher', expired: false },
};
const fixtureDirs = new Set();
function fixtureDir(prefix) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); fixtureDirs.add(dir); return dir; }
afterEach(() => { for (const dir of fixtureDirs) fs.rmSync(dir, { recursive: true, force: true }); fixtureDirs.clear(); });

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
    throw new Error(`${label}: stdout is not JSON: ${result.stdout}\nstderr: ${result.stderr}`);
  }
}

function readDomainFile(name) {
  return fs.readFileSync(path.join(outlineDir, name), 'utf8');
}

function readDomainJson(name) {
  return JSON.parse(readDomainFile(name));
}

// 把已提交的 outline 域整体拷到 tmp fixture，应用 mutate({dir, read, write, json, writeJson}) 后返回 fixture 目录。
function makeFixtureDir(mutate) {
  const dir = fixtureDir('infra-i03-');
  for (const name of DOMAIN_FILES) {
    fs.copyFileSync(path.join(outlineDir, name), path.join(dir, name));
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

test('I03 every consumed input shape is rejected before qualification or probe use', () => {
  const failures = [];
  const cases = [
    ['images.lock.json', null], ['images.lock.json', { components: [null] }],
    ['oidc-registration.example.json', null], ['oidc-registration.example.json', { provider: 1 }],
    ['storage-policy.json', null], ['storage-policy.json', { state: [] }],
    ['collection-registration.example.json', null], ['collection-registration.example.json', { collections: [null] }],
    ...['images.lock.json', 'oidc-registration.example.json', 'storage-policy.json', 'collection-registration.example.json'].map((file) => [file, { ...readDomainJson(file), project: 'foreign-project' }]),
    ['images.lock.json', (() => { const lock = readDomainJson('images.lock.json'); lock.components.push({ ...lock.components[0] }); return lock; })()],
  ];
  for (const [file, value] of cases) {
    const dir = makeFixtureDir(({ writeJson }) => writeJson(file, value));
    for (const command of ['validate', 'qualify', 'up', 'probe', 'stop']) {
      const result = runCli([command, ...(command === 'probe' ? ['--case', 'managed-publish'] : []), '--dir', dir, '--json']);
      let report; try { report = JSON.parse(result.stdout); } catch { report = null; }
      if (result.status !== 2 || !report?.violations?.length || result.stderr) failures.push({ file, command, exitCode: result.status, json: Boolean(report) });
    }
  }
  const dir = fixtureDir('infra-i03-refs-shape-');
  for (const value of [null, { interface: 'SecretRef.v1', refs: {} }, { interface: 'SecretRef.v1', refs: [null] }]) {
    const file = path.join(dir, 'refs.json'); fs.writeFileSync(file, JSON.stringify(value));
    for (const command of ['validate', 'qualify', 'up', 'probe']) {
      const result = runCli([command, ...(command === 'probe' ? ['--case', 'managed-publish'] : []), '--refs', file, '--json']);
      let report; try { report = JSON.parse(result.stdout); } catch { report = null; }
      if (result.status !== 2 || !report?.violations?.length || result.stderr) failures.push({ input: 'refs', command, exitCode: result.status, json: Boolean(report) });
    }
  }
  assert.equal(failures.length, 0, JSON.stringify({ failures: failures.length, samples: failures.slice(0, 8) }));
});

test('I03 semantic admission and image flags cannot be bypassed by qualify or up', () => {
  const dir = makeFixtureDir(({ read, write }) => write('compose.yaml', read('compose.yaml').replace('127.0.0.1:', '0.0.0.0:')));
  for (const command of ['qualify', 'up', 'probe']) {
    const result = runCli([command, ...(command === 'probe' ? ['--case', 'managed-publish'] : []), '--dir', dir, '--json']);
    assert.equal(result.status, 2);
    assert.ok(codes(parseJsonOut(result, command)).includes('PORT_BINDING_NOT_LOOPBACK'), 'every path consumes the same admission violation');
  }
  const qualify = parseJsonOut(runCli(['qualify', '--json']), 'recorded image');
  assert.notEqual(qualify.categories['image-digest-authenticated'].status, 'VERIFIED', 'a lock boolean is not independent current image qualification');
  const up = parseJsonOut(runCli(['up', '--json']), 'unqualified up');
  assert.equal(up.ready, false, 'image labels never imply full resource readiness');
});

test('I03 native error and pagination observations never become absence or audience permission', () => {
  for (const kind of ['http-403', 'http-409', 'http-500', 'timeout', 'network']) {
    const request = structuredClone(NOMINAL_PUBLISH_REQUEST);
    request.observationError = { kind, targetRecordedAbsent: true };
    const result = runPublishGate(writePublishRequest(request));
    assert.equal(result.status, 2);
    assert.ok(parseJsonOut(result, kind).blocks.some((block) => block.code === 'BLOCKED_ABSENCE_INFERRED_FROM_ERROR'), kind);
  }
  const request = structuredClone(NOMINAL_PUBLISH_REQUEST);
  request.pagination.pages = [{ offset: 0, limit: 1, total: 2, ids: ['one'] }];
  request.effectiveAudience = { channels: ['collection', 'page'], complete: true };
  const result = parseJsonOut(runPublishGate(writePublishRequest(request)), 'incomplete closure');
  assert.ok(result.blocks.some((b) => b.code === 'BLOCKED_PAGINATION_INCOMPLETE'));
  assert.ok(result.blocks.some((b) => b.code === 'BLOCKED_EFFECTIVE_AUDIENCE_INCOMPLETE'));
  assert.equal(result.liveReadback, false);
  const unmapped = structuredClone(NOMINAL_PUBLISH_REQUEST);
  unmapped.principalMapping = { status: 'UNMAPPABLE', subject: null };
  const unmappedRun = runPublishGate(writePublishRequest(unmapped));
  assert.equal(unmappedRun.status, 2, 'a missing actual identity claim is an unknown authorization observation, not a crash');
  assert.ok(parseJsonOut(unmappedRun, 'unmapped identity').blocks.some((b) => b.code === 'BLOCKED_PRINCIPAL_UNMAPPABLE'));
});

test('I03 managed-publish rejects target absence inferred from every error observation', async (t) => {
  for (const kind of [
    'http-100', 'http-199', 'http-300', 'http-302', 'http-399',
    'http-400', 'http-401', 'http-403', 'http-404', 'http-409', 'http-429', 'http-499',
    'http-500', 'http-503', 'http-599', 'timeout', 'network', 'unrecognized-failure',
  ]) {
    await t.test(kind, () => {
      const request = structuredClone(NOMINAL_PUBLISH_REQUEST);
      request.observationError = { kind, targetRecordedAbsent: true };
      const result = runPublishGate(writePublishRequest(request));
      const observation = parseJsonOut(result, kind);
      assert.equal(result.status, 2, 'an observation error never authorizes a publish');
      assert.equal(observation.liveReadback, false);
      assert.equal(observation.status, 'BLOCKED', `${kind} cannot establish target absence`);
      assert.deepEqual(observation.blocks, [{
        code: 'BLOCKED_ABSENCE_INFERRED_FROM_ERROR',
        detail: `${kind} must never be recorded as target absence`,
      }]);
      assert.match(observation.reason, /BLOCKED_ABSENCE_INFERRED_FROM_ERROR/);
      assert.equal(result.stderr, '');
    });
  }
  await t.test('no error observation leaves only the live-readback gate unverified', () => {
    const result = runPublishGate(writePublishRequest(structuredClone(NOMINAL_PUBLISH_REQUEST)));
    const observation = parseJsonOut(result, 'no error observation');
    assert.equal(result.status, 2);
    assert.equal(observation.liveReadback, false);
    assert.equal(observation.status, 'UNVERIFIED');
    assert.deepEqual(observation.blocks, []);
    assert.match(observation.reason, /^declared preconditions hold,/);
    assert.equal(result.stderr, '');
  });
});

test('I03 malformed publish objects and diagnostic paths never escape the input boundary', () => {
  for (const request of [null, [], { targetReader: {} }, { ...NOMINAL_PUBLISH_REQUEST, pagination: 1 }]) {
    const result = runPublishGate(writePublishRequest(request));
    assert.equal(result.status, 1);
    assert.equal(/TypeError/.test(result.stderr), false);
  }
  const request = structuredClone(NOMINAL_PUBLISH_REQUEST);
  request.pagination = { complete: false, reason: '/Volumes/private-example/request' };
  const result = runPublishGate(writePublishRequest(request));
  assert.equal(result.status, 2);
  assert.equal(result.stdout.includes('/Volumes/private-example/request'), false);
});

test('I03 native compose bindings require explicit service scope and exclude storage administrator material from app', () => {
  for (const key of ['DATABASE_URL', 'SECRET_KEY', 'OIDC_CLIENT_SECRET', 'AWS_REGION']) {
    const dir = makeFixtureDir(({ read, write }) => write('compose.yaml', read('compose.yaml').split('\n').filter((line) => !new RegExp(`^      ${key}:`).test(line)).join('\n')));
    const result = runCli(['validate', '--dir', dir, '--json']);
    assert.equal(result.status, 2, `missing native app binding ${key} must not validate`);
    assert.ok(codes(parseJsonOut(result, key)).includes('COMPOSE_REQUIRED_BINDING_MISSING'));
  }
  const dir = makeFixtureDir(({ read, write }) => write('compose.yaml', read('compose.yaml').replace('    restart:', '    env_file: ./shared-secrets.env\n    restart:')));
  assert.ok(codes(parseJsonOut(runCli(['validate', '--dir', dir, '--json']), 'shared env')).includes('APP_SHARED_ENV_FILE_FORBIDDEN'));
});

test('V_INFRA_I03 contract: committed outline domain validates clean; qualify/up/probe/stop honor the exit contract', () => {
  const validate = runCli(['validate', '--registry', registryPath, '--dir', outlineDir, '--json']);
  assert.equal(validate.status, 0, `validate must PASS on committed files: ${validate.stderr || validate.stdout}`);
  const report = parseJsonOut(validate, 'validate');
  assert.equal(report.ok, true);
  assert.deepEqual(report.violations, []);
  // 结构化回执绝不回显宿主绝对路径（fixture 目录在 tmp，也必须脱敏）。
  assert.doesNotMatch(validate.stdout, HOST_PATH_OUTPUT_RE, 'validate output must not carry host absolute paths');
  // 三个公共接口必须在回执中如实呈现。
  assert.equal(report.interface, 'OutlineInfra.v1');
  assert.ok(report.domain, 'OutlineDomain.v1 summary must be present');
  assert.ok(report.state, 'OutlineState.v1 summary must be present');
  // I01 修正案（master 7a55664）已补登 outline-app-session：已提交域文件必须 validate 干净且无该缺口。
  // 缺口上报行为本身由下方的合成负例单独覆盖，不再依赖这个已被修复的真实缺口。
  assert.ok(
    !(report.catalogGaps ?? []).includes('secret-ref:sdd-harness-pilot/outline-app-session'),
    'outline-app-session must be registered in the I01 catalog (registered by amendment 7a55664)',
  );

  // 配置有效 ≠ 运行 ready：qualify 必须诚实 NOT_READY 且退出 2。
  const qualify = runCli(['qualify', '--registry', registryPath, '--dir', outlineDir, '--json']);
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
  const partial = fixtureDir('infra-i03-partial-');
  for (const name of DOMAIN_FILES.filter((n) => n !== 'storage-policy.json')) {
    fs.copyFileSync(path.join(outlineDir, name), path.join(partial, name));
  }
  const missing = runCli(['validate', '--registry', registryPath, '--dir', partial, '--json']);
  assert.equal(missing.status, 1, 'a missing domain file is an input/prerequisite failure');
  assert.doesNotMatch(missing.stdout + missing.stderr, HOST_PATH_OUTPUT_RE);
});

test('gap-reporting behavior: a ref missing from a supplied catalog is explicitly reported as a catalogGap, never silent', () => {
  // 合成负例（临时 fixture，不动活配置）：从 refs 目录副本中移除一个已知已登记的 ref，
  // 断言 validate 仍显式上报缺口——覆盖不依赖已被 I01 修正案修复的真实缺口。
  const refsDoc = JSON.parse(fs.readFileSync(path.join(repoRoot, 'infra', 'delivery', 'secrets.refs.example.json'), 'utf8'));
  refsDoc.refs = refsDoc.refs.filter((entry) => entry.ref !== 'secret-ref:sdd-harness-pilot/outline-publisher');
  const refsFixture = path.join(fixtureDir('infra-i03-refs-'), 'refs.json');
  fs.writeFileSync(refsFixture, JSON.stringify(refsDoc, null, 2) + '\n');
  const result = runCli(['validate', '--registry', registryPath, '--dir', outlineDir, '--refs', refsFixture, '--json']);
  assert.equal(result.status, 0, 'a catalog gap is readiness evidence (qualify), not a structural violation');
  const report = parseJsonOut(result, 'validate gaps');
  assert.ok(
    (report.catalogGaps ?? []).includes('secret-ref:sdd-harness-pilot/outline-publisher'),
    'validate must explicitly report the missing ref as a catalogGap instead of passing silently',
  );
  assert.doesNotMatch(result.stdout, HOST_PATH_OUTPUT_RE);
});

test('image admission gates stay coherent with the committed lock state (state-agnostic)', () => {
  // The committed lock may legitimately be UNSELECTED (pre-admission) or
  // SELECTED+digest-pinned (post-admission). Either way: validate clean on
  // the committed domain; `up` must still refuse via an honest gate.
  const validate = runCli(['validate', '--registry', registryPath, '--dir', outlineDir, '--json']);
  assert.equal(validate.status, 0, `committed lock must validate clean: ${validate.stderr}`);
  const up = runCli(['up', '--registry', registryPath, '--dir', outlineDir, '--json']);
  assert.equal(up.status, 2, 'up must exit 2 (refusal contract)');
  const receipt = parseJsonOut(up, 'up');
  assert.equal(receipt.refused, true);
  assert.match(receipt.error, /UP_REFUSED_IMAGES_LOCK_NOT_READY|UP_NOT_AUTHORIZED|UP_REFUSED_CONTAINER_DAEMON_UNREACHABLE/);
});

test('RED image gate: floating tag is rejected', () => {
  const dir = makeFixtureDir(({ json, writeJson }) => {
    const lock = json('images.lock.json');
    lock.components.find((c) => c.component === 'outline-app').reference = 'ghcr.io/example/outline:latest';
    writeJson('images.lock.json', lock);
  });
  const result = runCli(['validate', '--registry', registryPath, '--dir', dir, '--json']);
  assert.equal(result.status, 2, 'a floating :latest tag must not pass validate');
  const report = parseJsonOut(result, 'validate');
  assert.ok(codes(report).includes('FLOATING_TAG_FORBIDDEN'), JSON.stringify(report.violations));
});

test('RED image gate: malformed digest rejected; well-formed but unauthenticated digest never reaches VERIFIED', () => {
  const malformed = makeFixtureDir(({ json, writeJson }) => {
    const lock = json('images.lock.json');
    lock.components.find((c) => c.component === 'outline-app').digest = 'sha256:deadbeef';
    writeJson('images.lock.json', lock);
  });
  const malformedRun = runCli(['validate', '--registry', registryPath, '--dir', malformed, '--json']);
  assert.equal(malformedRun.status, 2, 'format-invalid digest must not pass');
  assert.ok(
    codes(parseJsonOut(malformedRun, 'validate')).includes('DIGEST_FORMAT_INVALID'),
    JSON.stringify(malformedRun.stdout),
  );

  // 仅出现在 fixture 中的探针值（绝不入库）：即使 digest 格式合法，未经 registry 认证也必须保持 UNVERIFIED、up 仍拒绝。
  const unauthenticated = makeFixtureDir(({ json, writeJson }) => {
    const lock = json('images.lock.json');
    const app = lock.components.find((c) => c.component === 'outline-app');
    app.reference = 'ghcr.io/example/unselected:vX.Y.Z-not-selected';
    app.digest = `sha256:${'a'.repeat(64)}`;
    app.digestAuthenticated = false;
    writeJson('images.lock.json', lock);
  });
  const validateRun = runCli(['validate', '--registry', registryPath, '--dir', unauthenticated, '--json']);
  assert.equal(validateRun.status, 0, 'structurally honest lock (unauthenticated flag set) still validates');
  const qualifyRun = runCli(['qualify', '--registry', registryPath, '--dir', unauthenticated, '--json']);
  assert.equal(qualifyRun.status, 2);
  const receipt = parseJsonOut(qualifyRun, 'qualify');
  assert.equal(receipt.categories['image-digest-authenticated'].status, 'UNVERIFIED');
  const upRun = runCli(['up', '--registry', registryPath, '--dir', unauthenticated, '--json']);
  assert.equal(upRun.status, 2, 'up must still refuse without digest authentication');
  assert.match(parseJsonOut(upRun, 'up').error, /IMAGES_LOCK_NOT_READY/);
});

test('RED oidc gate: missing issuer/client registration is rejected; non-loopback redirect is rejected', () => {
  const noProvider = makeFixtureDir(({ json, writeJson }) => {
    const reg = json('oidc-registration.example.json');
    delete reg.provider;
    writeJson('oidc-registration.example.json', reg);
  });
  const noProviderRun = runCli(['validate', '--registry', registryPath, '--dir', noProvider, '--json']);
  assert.equal(noProviderRun.status, 2, 'OIDC registration without provider/issuer block must be rejected');
  const noProviderReport = parseJsonOut(noProviderRun, 'validate');
  assert.ok(codes(noProviderReport).includes('OIDC_REGISTRATION_INCOMPLETE'), JSON.stringify(noProviderReport.violations));

  const noClient = makeFixtureDir(({ json, writeJson }) => {
    const reg = json('oidc-registration.example.json');
    delete reg.client;
    writeJson('oidc-registration.example.json', reg);
  });
  const noClientRun = runCli(['validate', '--registry', registryPath, '--dir', noClient, '--json']);
  assert.equal(noClientRun.status, 2, 'OIDC registration without client block must be rejected');
  assert.ok(codes(parseJsonOut(noClientRun, 'validate')).includes('OIDC_REGISTRATION_INCOMPLETE'));

  const publicRedirect = makeFixtureDir(({ json, writeJson }) => {
    const reg = json('oidc-registration.example.json');
    reg.client.redirectUris = ['https://outline.example.com/auth/oidc.callback'];
    writeJson('oidc-registration.example.json', reg);
  });
  const redirectRun = runCli(['validate', '--registry', registryPath, '--dir', publicRedirect, '--json']);
  assert.equal(redirectRun.status, 2, 'loopback-only policy must reject a public redirect URI');
  assert.ok(codes(parseJsonOut(redirectRun, 'validate')).includes('REDIRECT_URI_NOT_LOOPBACK'));
});

test('RED storage-policy gate: missing file exits 1; incomplete or policy-violating content exits 2', () => {
  // 内容不完整（可解析但缺 state/cache 声明）= 语义违规 → 2。
  const incomplete = makeFixtureDir(({ json, writeJson }) => {
    const policy = json('storage-policy.json');
    delete policy.state;
    writeJson('storage-policy.json', policy);
  });
  const incompleteRun = runCli(['validate', '--registry', registryPath, '--dir', incomplete, '--json']);
  assert.equal(incompleteRun.status, 2);
  assert.ok(codes(parseJsonOut(incompleteRun, 'validate')).includes('STORAGE_POLICY_INCOMPLETE'));

  // cache 当权限权威 = 违反 OutlineState.v1 → 2。
  const cacheAuthority = makeFixtureDir(({ json, writeJson }) => {
    const policy = json('storage-policy.json');
    policy.state.cache.rightsAuthority = true;
    writeJson('storage-policy.json', policy);
  });
  const cacheRun = runCli(['validate', '--registry', registryPath, '--dir', cacheAuthority, '--json']);
  assert.equal(cacheRun.status, 2, 'cache must never be declared the rights authority');
  assert.ok(codes(parseJsonOut(cacheRun, 'validate')).includes('CACHE_AS_AUTHORITY_FORBIDDEN'));

  // 假定附件撤回立即生效 = 违反 oracle（附件 URL 缓存残留风险）→ 2。
  const immediate = makeFixtureDir(({ json, writeJson }) => {
    const policy = json('storage-policy.json');
    policy.revocation.immediateEffectAssumed = true;
    writeJson('storage-policy.json', policy);
  });
  const immediateRun = runCli(['validate', '--registry', registryPath, '--dir', immediate, '--json']);
  assert.equal(immediateRun.status, 2);
  assert.ok(codes(parseJsonOut(immediateRun, 'validate')).includes('REVOCATION_ASSUMED_IMMEDIATE'));
});

test('RED env gate: secret plaintext, host absolute paths and unbound raw values are rejected', () => {
  const withToken = makeFixtureDir(({ read, write }) => {
    write('outline.env.example', `${read('outline.env.example')}\nSECRET_KEY=ghp_${'A'.repeat(36)}\n`);
  });
  const tokenRun = runCli(['validate', '--registry', registryPath, '--dir', withToken, '--json']);
  assert.equal(tokenRun.status, 2, 'secret plaintext in env example must be rejected');
  const tokenReport = parseJsonOut(tokenRun, 'validate');
  assert.ok(codes(tokenReport).includes('SECRET_PLAINTEXT_FORBIDDEN'), JSON.stringify(tokenReport.violations));

  const withHostPath = makeFixtureDir(({ read, write }) => {
    write('outline.env.example', `${read('outline.env.example')}\nREDIS_URL=/Users/example/secret-stuff/redis.sock\n`);
  });
  const hostRun = runCli(['validate', '--registry', registryPath, '--dir', withHostPath, '--json']);
  assert.equal(hostRun.status, 2, 'host absolute path in env example must be rejected');
  assert.ok(codes(parseJsonOut(hostRun, 'validate')).includes('ABSOLUTE_PATH_FORBIDDEN'));

  const withRawValue = makeFixtureDir(({ read, write }) => {
    write('outline.env.example', `${read('outline.env.example')}\nDATABASE_URL=postgres://outline:hunter2@db.internal:5432/outline\n`);
  });
  const rawRun = runCli(['validate', '--registry', registryPath, '--dir', withRawValue, '--json']);
  assert.equal(rawRun.status, 2, 'a sensitive env var bound to a literal value instead of a secret-ref must be rejected');
  assert.ok(codes(parseJsonOut(rawRun, 'validate')).includes('ENV_UNBOUND_VALUE_FORBIDDEN'));
});

test('RED cross-project gate: credential refs resolving into another project (pav-*) are rejected', () => {
  const crossDomain = makeFixtureDir(({ json, writeJson }) => {
    const reg = json('collection-registration.example.json');
    reg.collections[0].owner.grantRef = 'secret-ref:pav-legacy/outline-publisher';
    writeJson('collection-registration.example.json', reg);
  });
  const domainRun = runCli(['validate', '--registry', registryPath, '--dir', crossDomain, '--json']);
  assert.equal(domainRun.status, 2);
  assert.ok(codes(parseJsonOut(domainRun, 'validate')).includes('CROSS_PROJECT_REF'));

  const crossOidc = makeFixtureDir(({ json, writeJson }) => {
    const registration = json('oidc-registration.example.json');
    registration.client.credentialRef = 'secret-ref:pav-legacy/outline-oidc-client';
    writeJson('oidc-registration.example.json', registration);
  });
  const oidcRun = runCli(['validate', '--registry', registryPath, '--dir', crossOidc, '--json']);
  assert.equal(oidcRun.status, 2);
  assert.ok(codes(parseJsonOut(oidcRun, 'validate')).includes('CROSS_PROJECT_REF'));
});

test('RED domain gate: collection registration without owner or audience registration is rejected', () => {
  const noOwner = makeFixtureDir(({ json, writeJson }) => {
    const reg = json('collection-registration.example.json');
    delete reg.collections[0].owner;
    writeJson('collection-registration.example.json', reg);
  });
  const ownerRun = runCli(['validate', '--registry', registryPath, '--dir', noOwner, '--json']);
  assert.equal(ownerRun.status, 2, 'collection without registered owner must be rejected');
  assert.ok(codes(parseJsonOut(ownerRun, 'validate')).includes('OWNER_REGISTRATION_MISSING'));

  const noAudience = makeFixtureDir(({ json, writeJson }) => {
    const reg = json('collection-registration.example.json');
    delete reg.collections[1].audience;
    writeJson('collection-registration.example.json', reg);
  });
  const audienceRun = runCli(['validate', '--registry', registryPath, '--dir', noAudience, '--json']);
  assert.equal(audienceRun.status, 2, 'collection without registered audience must be rejected');
  assert.ok(codes(parseJsonOut(audienceRun, 'validate')).includes('AUDIENCE_REGISTRATION_MISSING'));

  const noGrant = makeFixtureDir(({ json, writeJson }) => {
    const reg = json('collection-registration.example.json');
    delete reg.collections[0].owner.grantRef;
    writeJson('collection-registration.example.json', reg);
  });
  const grantRun = runCli(['validate', '--registry', registryPath, '--dir', noGrant, '--json']);
  assert.equal(grantRun.status, 2, 'owner without a purpose-bound grant ref must be rejected');
  assert.ok(codes(parseJsonOut(grantRun, 'validate')).includes('GRANT_REF_MISSING'));
});

test('probes are real subcommands: without a live instance they exit 2 with structured UNVERIFIED, never mock-green, never skip', () => {
  for (const probeCase of ['oidc-principal-acl', 'restart-persistence', 'attachment-denial', 'managed-publish']) {
    const result = runCli(['probe', '--case', probeCase, '--registry', registryPath, '--dir', outlineDir, '--json']);
    assert.equal(result.status, 2, `probe ${probeCase} must exit 2 without a live instance`);
    const observation = parseJsonOut(result, `probe ${probeCase}`);
    assert.equal(observation.interface, 'OutlineInfra.v1');
    assert.equal(observation.case, probeCase);
    assert.equal(observation.executed, false, 'probe must not pretend to have executed');
    assert.equal(observation.status, 'UNVERIFIED');
    assert.ok(observation.reason && observation.reason.length > 0, 'UNVERIFIED requires the exact reason');
    assert.ok(Array.isArray(observation.requiredInputs) && observation.requiredInputs.length > 0);
    assert.ok(Array.isArray(observation.plannedSteps) && observation.plannedSteps.length > 0, 'probe must declare its real steps');
    assert.doesNotMatch(result.stdout, HOST_PATH_OUTPUT_RE);
    assert.doesNotMatch(result.stdout, /"skip"\s*:\s*true/, 'probes must not skip');
  }

  // Endpoint is not an authenticated lifecycle grant; no implicit API request or restart is permitted.
  const unreachable = runCli([
    'probe', '--case', 'restart-persistence', '--endpoint', 'http://127.0.0.1:59999',
    '--registry', registryPath, '--dir', outlineDir, '--json',
  ]);
  assert.equal(unreachable.status, 2, 'unreachable endpoint must stay UNVERIFIED with exit 2');
  const unreachableReport = parseJsonOut(unreachable, 'probe unreachable');
  assert.equal(unreachableReport.executed, false);
  assert.equal(unreachableReport.status, 'UNVERIFIED');
  assert.ok(unreachableReport.reason.length > 0);
  assert.equal(unreachableReport.observedSteps.some((step) => /GET \/api\/config/.test(step.step)), false);
  assert.doesNotMatch(unreachable.stdout, HOST_PATH_OUTPUT_RE);
});

test('stop without an instance started by this tool is honestly UNVERIFIED and refuses', () => {
  const result = runCli(['stop', '--registry', registryPath, '--dir', outlineDir, '--json']);
  assert.equal(result.status, 2, 'stop must not claim success when nothing was started');
  const report = parseJsonOut(result, 'stop');
  assert.equal(report.executed, false);
  assert.equal(report.status, 'UNVERIFIED');
  assert.ok(report.reason.length > 0);
  assert.doesNotMatch(result.stdout, HOST_PATH_OUTPUT_RE);
});

test('OutlineState.v1 contract: durable db+attachments declared, cache not rights authority, API contracts stay UNVERIFIED until real API evidence', async () => {
  const policy = readDomainJson('storage-policy.json');
  assert.equal(policy.state.database.durable, true, 'database must be declared durable');
  assert.equal(policy.state.attachments.durable, true, 'attachment storage must be declared durable');
  assert.equal(policy.state.cache.rightsAuthority, false, 'cache must be declared non-authoritative');
  assert.equal(policy.state.cache.durable, false, 'cache is explicitly non-durable state');

  const apiContracts = policy.apiContracts;
  assert.equal(apiContracts.fixedCreateUuid.declaredBySpec, true, 'spec observation records the declaration');
  assert.equal(apiContracts.fixedCreateUuid.status, 'UNVERIFIED', 'not VERIFIED until a real deployment proves it');
  assert.equal(apiContracts.lastRevision.status, 'UNVERIFIED', 'not VERIFIED until a real deployment proves it');
  assert.equal(apiContracts.lastRevision.conflictStatusDeclared, 409);

  // 凭据一律 secret-ref 引用，绝不存值。
  const secretRefs = await import(secretRefsModuleUrl);
  for (const name of ['images.lock.json', 'oidc-registration.example.json', 'storage-policy.json', 'collection-registration.example.json']) {
    const violations = secretRefs.scanForForbiddenValues(readDomainJson(name));
    assert.deepEqual(violations, [], `${name} must contain no secret-shaped values or host paths`);
  }

  // OutlineDomain.v1：登记结构在位，值 UNVERIFIED。
  const domain = readDomainJson('collection-registration.example.json');
  assert.equal(domain.interface, 'OutlineDomain.v1');
  assert.ok(Array.isArray(domain.collections) && domain.collections.length >= 2, 'managed + isolation collections must both be declared');
  for (const collection of domain.collections) {
    assert.ok(collection.owner, 'owner registration present');
    assert.match(collection.owner.grantRef, /^secret-ref:sdd-harness-pilot\//);
    assert.ok(collection.audience, 'audience registration present');
    if (collection.name === 'managed-source-collection') {
      assert.equal(collection.id, 'a3c6b4d8-1f1e-473d-9f49-ea5c48b7a818');
      assert.equal(collection.owner.status, 'UNREGISTERED', 'historical admin readability must not register an action principal/grant');
      assert.equal(collection.audience.status, 'UNVERIFIED');
    } else assert.equal(collection.id, null, 'isolation collection is still unprovisioned');
  }
  assert.equal(domain.instance.id, 'cb59131d-2d7c-421e-a818-44f84236b56d');
  const historical = fs.readFileSync(path.join(repoRoot, domain.evidence.historicalIdentity.evidenceRef));
  assert.equal(crypto.createHash('sha256').update(historical).digest('hex'), 'c5c538218fe6d48ba2cc066b82247a36e8a72fd362c11518490e9095e3e60c99');
  assert.equal(domain.evidence.effectiveAudienceClosure, 'UNVERIFIED');

  // 7 个计划 secret-ref 全部被域文件引用；catalog 缺 outline-app-session 必须仍被显式报告（I01 目录缺口）。
  const referenced = JSON.stringify([
    readDomainJson('images.lock.json'),
    readDomainJson('oidc-registration.example.json'),
    readDomainJson('storage-policy.json'),
    readDomainJson('collection-registration.example.json'),
  ]);
  for (const name of ['outline-db', 'outline-redis', 'outline-app-session', 'outline-oidc-client', 'outline-object-store', 'outline-publisher', 'outline-isolator']) {
    assert.ok(referenced.includes(`secret-ref:sdd-harness-pilot/${name}`), `domain files must reference ${name}`);
  }
});

test('compose declaration gate: loopback binds, dedicated internal network, no host mounts, images only via lock-resolved placeholders', () => {
  const compose = readDomainFile('compose.yaml');
  assert.ok(compose.includes('networks:'), 'a dedicated network must be declared');
  assert.ok(/internal:\s*true/.test(compose), 'the dedicated network must be internal');
  for (const portLine of compose.split('\n').filter((line) => /^\s*-\s*"\d/.test(line.trim()) || /^\s*-\s*"\d+\//.test(line))) {
    assert.match(portLine.trim(), /^-\s*"127\.0\.0\.1:/, `published ports must bind loopback: ${portLine}`);
  }
  for (const imageLine of compose.split('\n').filter((line) => line.trim().startsWith('image:'))) {
    assert.match(imageLine, /image:\s*\$\{[A-Z0-9_]+:\?/, `image must be resolved from the lock placeholder: ${imageLine}`);
    assert.doesNotMatch(imageLine, /:latest/, 'no floating tags anywhere in compose');
  }
  assert.ok(!/\$\{[A-Z0-9_]+:\?[^}]*\}:\//.test(compose.replace(/127\.0\.0\.1:\$\{[^}]*\}/g, '')), 'no host path bind mounts');

  const notLoopback = makeFixtureDir(({ read, write }) => {
    write('compose.yaml', read('compose.yaml').replace('"127.0.0.1:${OUTLINE_PORT:-3000}:3000"', '"3000:3000"'));
  });
  const loopbackRun = runCli(['validate', '--registry', registryPath, '--dir', notLoopback, '--json']);
  assert.equal(loopbackRun.status, 2, 'non-loopback port binding must be rejected');
  assert.ok(codes(parseJsonOut(loopbackRun, 'validate')).includes('PORT_BINDING_NOT_LOOPBACK'));

  const concreteImage = makeFixtureDir(({ read, write }) => {
    write('compose.yaml', read('compose.yaml').replace(
      'image: ${OUTLINE_IMAGE:?must be resolved from infra/delivery/outline/images.lock.json before up}',
      'image: ghcr.io/example/outline:latest',
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

// ---- 2026-10-22 rework (rework-seven-p1-r1)：本地半边负例矩阵补锚 ----
// 之前无锚点的 RED 场景：受管发布阻断（来源交集/分页/principal映射/过期grant/admin替代/超时≠不存在）、
// loopback 暴露自动开公网（第二个 external 网络）、compose 命名卷门、lock/up 门。
// publish-request 一律 os.tmpdir() fixture（输入证据，不是期望值副本——期望值独立断言于真实子进程输出）。

function writePublishRequest(value, raw) {
  const file = path.join(fixtureDir('infra-i03-pub-'), 'publish-request.json');
  fs.writeFileSync(file, raw ?? JSON.stringify(value, null, 2) + '\n');
  return file;
}

function runPublishGate(requestFile) {
  return runCli([
    'probe', '--case', 'managed-publish', '--publish-request', requestFile,
    '--registry', registryPath, '--dir', outlineDir, '--json',
  ]);
}

test('managed-publish gate: each blocking precondition refuses the publish with its exact cause; admin read never substitutes; timeout/403 is never absence', () => {
  const cases = [
    {
      label: 'source intersection excludes the target reader',
      mutate: (req) => { req.audienceIntersection = ['principal:owner@example.test']; },
      code: 'BLOCKED_SOURCE_INTERSECTION_EXCLUDES_READER',
    },
    {
      label: 'empty audience dressed up with admin readability',
      mutate: (req) => { req.audienceIntersection = []; req.adminReadable = true; },
      code: 'BLOCKED_ADMIN_READ_NOT_AUDIENCE',
    },
    {
      label: 'pagination failed mid-enumeration',
      mutate: (req) => { req.pagination = { complete: false, reason: 'cursor timeout on page 3' }; },
      code: 'BLOCKED_PAGINATION_INCOMPLETE',
    },
    {
      label: 'subject cannot be mapped to a principal',
      mutate: (req) => { req.principalMapping = { status: 'UNMAPPABLE', subject: 'sub-xyz' }; },
      code: 'BLOCKED_PRINCIPAL_UNMAPPABLE',
    },
    {
      label: 'publisher grant expired',
      mutate: (req) => { req.grant = { ...req.grant, expired: true }; },
      code: 'BLOCKED_GRANT_EXPIRED',
    },
    {
      label: 'timeout recorded as target absence',
      mutate: (req) => { req.observationError = { kind: 'timeout', targetRecordedAbsent: true }; },
      code: 'BLOCKED_ABSENCE_INFERRED_FROM_ERROR',
    },
  ];
  for (const { label, mutate, code } of cases) {
    const request = structuredClone(NOMINAL_PUBLISH_REQUEST);
    mutate(request);
    const result = runPublishGate(writePublishRequest(request));
    assert.equal(result.status, 2, `${label}: a blocking precondition must refuse the publish (exit 2)`);
    const observation = parseJsonOut(result, `managed-publish ${label}`);
    assert.equal(observation.executed, true, `${label}: the local gate evaluation really ran`);
    assert.equal(observation.status, 'BLOCKED');
    const blockCodes = (observation.blocks ?? []).map((b) => b.code);
    assert.ok(blockCodes.includes(code), `${label}: expected ${code}, got ${JSON.stringify(blockCodes)}`);
    assert.ok(observation.reason.length > 0);
    assert.doesNotMatch(result.stdout, HOST_PATH_OUTPUT_RE);
  }

  // 全部前置同时不满足：受控拒绝必须一次性列出全部原因（不止第一条）。
  const allBad = structuredClone(NOMINAL_PUBLISH_REQUEST);
  allBad.audienceIntersection = [];
  allBad.adminReadable = true;
  allBad.pagination = { complete: false, reason: 'enumeration failed' };
  allBad.principalMapping = { status: 'UNMAPPABLE', subject: 'sub-xyz' };
  allBad.grant = { ...allBad.grant, expired: true };
  allBad.observationError = { kind: 'http-403', targetRecordedAbsent: true };
  const allBadRun = runPublishGate(writePublishRequest(allBad));
  assert.equal(allBadRun.status, 2);
  const allBadCodes = parseJsonOut(allBadRun, 'managed-publish all-bad').blocks.map((b) => b.code);
  for (const code of [
    'BLOCKED_SOURCE_INTERSECTION_EXCLUDES_READER',
    'BLOCKED_ADMIN_READ_NOT_AUDIENCE',
    'BLOCKED_PAGINATION_INCOMPLETE',
    'BLOCKED_PRINCIPAL_UNMAPPABLE',
    'BLOCKED_GRANT_EXPIRED',
    'BLOCKED_ABSENCE_INFERRED_FROM_ERROR',
  ]) {
    assert.ok(allBadCodes.includes(code), `all-bad request must report ${code} (got ${JSON.stringify(allBadCodes)})`);
  }

  // 声明证据全部满足也不得转绿：有效受众闭包须活实例读回，本地评估永远停在 UNVERIFIED。
  const nominal = runPublishGate(writePublishRequest(structuredClone(NOMINAL_PUBLISH_REQUEST)));
  assert.equal(nominal.status, 2, 'a declared-only evaluation must never exit 0');
  const nominalObservation = parseJsonOut(nominal, 'managed-publish nominal');
  assert.equal(nominalObservation.status, 'UNVERIFIED');
  assert.deepEqual((nominalObservation.blocks ?? []).length, 0);
  assert.equal(nominalObservation.liveReadback, false);
  assert.doesNotMatch(nominal.stdout, HOST_PATH_OUTPUT_RE);

  // 无效输入：缺 targetReader / 文件不可解析 = 退出 1。
  const noTarget = structuredClone(NOMINAL_PUBLISH_REQUEST);
  delete noTarget.targetReader;
  assert.equal(runPublishGate(writePublishRequest(noTarget)).status, 1);
  assert.equal(runPublishGate(writePublishRequest(null, '{ not json')).status, 1);
});

test('admission record opens the up gate honestly: enabled=true without an admission record still refuses; with admittedBy/admittedAt/reason it validates clean', () => {
  // Case 1: gate flipped without an admission record -> must keep refusing.
  const noRecord = makeFixtureDir(({ json, writeJson }) => {
    const lock = json('images.lock.json');
    lock.upGate.enabled = true;
    delete lock.upGate.admittedBy;
    delete lock.upGate.admittedAt;
    delete lock.upGate.reason;
    writeJson('images.lock.json', lock);
  });
  const r1 = runCli(['validate', '--registry', registryPath, '--dir', noRecord, '--json']);
  assert.equal(r1.status, 2, 'gate-open without admission record must fail validate');
  assert.ok(codes(parseJsonOut(r1, 'validate no admission record')).includes('UP_GATE_NOT_CLOSED'));

  // Case 2: gate flipped WITH a complete admission record -> validate clean.
  const admitted = makeFixtureDir(({ json, writeJson }) => {
    const lock = json('images.lock.json');
    lock.upGate.enabled = true;
    lock.upGate.admittedBy = 'user directive 2026-10-22';
    lock.upGate.admittedAt = '2026-10-22T08:00:00.000Z';
    lock.upGate.reason = 'resource admission wave: default digest-pinned list approved by the user';
    writeJson('images.lock.json', lock);
  });
  const r2 = runCli(['validate', '--registry', registryPath, '--dir', admitted, '--json']);
  assert.equal(r2.status, 0, `admitted lock must validate clean, got ${r2.status}: ${r2.stdout}\n${r2.stderr}`);
  assert.ok(!codes(parseJsonOut(r2, 'validate admitted')).includes('UP_GATE_NOT_CLOSED'));
});

test('compose gate: loopback exposure must not auto-open a public network and durable state must ride named volumes', () => {
  const internalFalse = makeFixtureDir(({ read, write }) => {
    write('compose.yaml', read('compose.yaml').replace('    internal: true', '    internal: false'));
  });
  const internalFalseRun = runCli(['validate', '--registry', registryPath, '--dir', internalFalse, '--json']);
  assert.equal(internalFalseRun.status, 2);
  const internalFalseCodes = codes(parseJsonOut(internalFalseRun, 'validate internal:false'));
  assert.ok(internalFalseCodes.includes('NON_INTERNAL_NETWORK_DECLARED'), JSON.stringify(internalFalseCodes));
  assert.ok(internalFalseCodes.includes('NETWORK_NOT_INTERNAL'));

  // 既有门漏掉的情形：单一 internal 网络旁 smuggle 第二个 external 网络——loopback 端口不得因此自动开公网。
  const externalNet = makeFixtureDir(({ read, write }) => {
    write('compose.yaml', `${read('compose.yaml')}  public-edge:\n    external: true\n`);
  });
  const externalNetRun = runCli(['validate', '--registry', registryPath, '--dir', externalNet, '--json']);
  assert.equal(externalNetRun.status, 2);
  const externalNetCodes = codes(parseJsonOut(externalNetRun, 'validate external network'));
  assert.ok(externalNetCodes.includes('NON_INTERNAL_NETWORK_DECLARED'), JSON.stringify(externalNetCodes));
  assert.ok(!externalNetCodes.includes('NETWORK_NOT_INTERNAL'), 'the smuggled network is caught even though one internal network remains');

  const hostMode = makeFixtureDir(({ read, write }) => {
    const source = read('compose.yaml');
    const mutated = source.replace('    restart: "no"\n', '    restart: "no"\n    network_mode: host\n');
    assert.notEqual(mutated, source, 'the host-network negative payload must actually land after template layout changes');
    write('compose.yaml', mutated);
  });
  const hostModeRun = runCli(['validate', '--registry', registryPath, '--dir', hostMode, '--json']);
  assert.equal(hostModeRun.status, 2);
  assert.ok(codes(parseJsonOut(hostModeRun, 'validate host network')).includes('HOST_NETWORK_FORBIDDEN'));

  const noVolumes = makeFixtureDir(({ read, write }) => {
    write('compose.yaml', read('compose.yaml').replace('volumes:\n  outline-data:\n  outline-db:\n  outline-attachments:\n', ''));
  });
  const noVolumesRun = runCli(['validate', '--registry', registryPath, '--dir', noVolumes, '--json']);
  assert.equal(noVolumesRun.status, 2);
  assert.ok(codes(parseJsonOut(noVolumesRun, 'validate no named volumes')).includes('NAMED_VOLUMES_MISSING'));

  const noDbVolume = makeFixtureDir(({ read, write }) => {
    write('compose.yaml', read('compose.yaml').replace('      - outline-db:/var/lib/postgresql/data\n', ''));
  });
  const noDbVolumeRun = runCli(['validate', '--registry', registryPath, '--dir', noDbVolume, '--json']);
  assert.equal(noDbVolumeRun.status, 2);
  assert.ok(codes(parseJsonOut(noDbVolumeRun, 'validate db without named volume')).includes('DURABLE_STORE_NOT_ON_NAMED_VOLUME'));

  for (const run of [internalFalseRun, externalNetRun, hostModeRun, noVolumesRun, noDbVolumeRun]) {
    assert.doesNotMatch(run.stdout, HOST_PATH_OUTPUT_RE);
  }
});

test('lock and up gates: opened upGate, unpinned reference, unparseable lock, unreadable registry and up without authorization are all anchored', () => {
  const gateOpen = makeFixtureDir(({ json, writeJson }) => {
    const lock = json('images.lock.json');
    lock.upGate.enabled = true;
    delete lock.upGate.admittedBy;
    delete lock.upGate.admittedAt;
    delete lock.upGate.reason;
    writeJson('images.lock.json', lock);
  });
  const gateOpenRun = runCli(['validate', '--registry', registryPath, '--dir', gateOpen, '--json']);
  assert.equal(gateOpenRun.status, 2, 'an opened upGate in the committed-style lock must fail validate');
  assert.ok(codes(parseJsonOut(gateOpenRun, 'validate upGate open')).includes('UP_GATE_NOT_CLOSED'));

  const unpinned = makeFixtureDir(({ json, writeJson }) => {
    const lock = json('images.lock.json');
    const app = lock.components.find((c) => c.component === 'outline-app');
    app.reference = 'ghcr.io/example/unselected:vX.Y.Z-not-selected';
    app.digest = null;
    writeJson('images.lock.json', lock);
  });
  const unpinnedRun = runCli(['validate', '--registry', registryPath, '--dir', unpinned, '--json']);
  assert.equal(unpinnedRun.status, 2);
  assert.ok(codes(parseJsonOut(unpinnedRun, 'validate unpinned reference')).includes('IMAGE_NOT_DIGEST_PINNED'));

  // 结构上合格（fixture 探针值，绝不入库）但 upGate 关闭：up 必须走 UP_NOT_AUTHORIZED 拒绝（不碰 docker）。
  const qualifiedClosed = makeFixtureDir(({ json, writeJson }) => {
    const lock = json('images.lock.json');
    // Gate must be genuinely closed for this sub-case: a committed post-
    // admission lock carries an admission record, so an explicit closed
    // state (enabled=false) is what "closed" means here.
    lock.upGate.enabled = false;
    delete lock.upGate.admittedBy;
    delete lock.upGate.admittedAt;
    delete lock.upGate.reason;
    for (const component of lock.components) {
      component.reference = `ghcr.io/example/${component.component}:vX.Y.Z-fixture`;
      component.digest = `sha256:${'b'.repeat(64)}`;
      component.digestAuthenticated = true;
    }
    writeJson('images.lock.json', lock);
  });
  assert.equal(runCli(['validate', '--registry', registryPath, '--dir', qualifiedClosed, '--json']).status, 0);
  const upRun = runCli(['up', '--registry', registryPath, '--dir', qualifiedClosed, '--json']);
  assert.equal(upRun.status, 2);
  assert.match(parseJsonOut(upRun, 'up not authorized').error, /UP_NOT_AUTHORIZED/);
  assert.doesNotMatch(upRun.stdout, HOST_PATH_OUTPUT_RE);

  const unparseable = makeFixtureDir(({ write }) => {
    write('images.lock.json', '{ not json');
  });
  const unparseableRun = runCli(['validate', '--registry', registryPath, '--dir', unparseable, '--json']);
  assert.equal(unparseableRun.status, 1, 'an unparseable domain file is an input failure');
  assert.doesNotMatch(unparseableRun.stdout + unparseableRun.stderr, HOST_PATH_OUTPUT_RE);

  const badRegistryRun = runCli(['validate', '--registry', path.join(os.tmpdir(), 'no-such-registry-i03.json'), '--dir', outlineDir, '--json']);
  assert.equal(badRegistryRun.status, 1, 'an unreadable registry is an input failure');
  assert.doesNotMatch(badRegistryRun.stdout + badRegistryRun.stderr, HOST_PATH_OUTPUT_RE);
});

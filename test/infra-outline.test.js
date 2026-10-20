import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
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
  return fs.readFileSync(path.join(outlineDir, name), 'utf8');
}

function readDomainJson(name) {
  return JSON.parse(readDomainFile(name));
}

// 把已提交的 outline 域整体拷到 tmp fixture，应用 mutate({dir, read, write, json, writeJson}) 后返回 fixture 目录。
function makeFixtureDir(mutate) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'infra-i03-'));
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
  // catalog 登记缺口必须显式暴露，不得静默（outline-app-session 不在 I01 目录中）。
  assert.ok(
    (report.catalogGaps ?? []).includes('secret-ref:sdd-harness-pilot/outline-app-session'),
    'validate must explicitly report the unregistered outline-app-session ref instead of hiding it',
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
  const partial = fs.mkdtempSync(path.join(os.tmpdir(), 'infra-i03-partial-'));
  for (const name of DOMAIN_FILES.filter((n) => n !== 'storage-policy.json')) {
    fs.copyFileSync(path.join(outlineDir, name), path.join(partial, name));
  }
  const missing = runCli(['validate', '--registry', registryPath, '--dir', partial, '--json']);
  assert.equal(missing.status, 1, 'a missing domain file is an input/prerequisite failure');
  assert.doesNotMatch(missing.stdout + missing.stderr, HOST_PATH_OUTPUT_RE);
});

test('RED image gate: images.lock without any authenticated digest refuses up (committed state, nothing fabricated)', () => {
  const lock = readDomainJson('images.lock.json');
  const components = lock.components ?? [];
  const required = ['outline-app', 'outline-postgres', 'outline-redis', 'outline-object-store'];
  for (const name of required) {
    const entry = components.find((c) => c.component === name);
    assert.ok(entry, `lock must declare ${name}`);
    assert.equal(entry.reference, null, `${name}: no version selected, no tag may be invented`);
    assert.equal(entry.digest, null, `${name}: no authenticated digest exists, none may be invented`);
    assert.equal(entry.status, 'UNVERIFIED', `${name} must be honestly UNVERIFIED`);
  }

  const up = runCli(['up', '--registry', registryPath, '--dir', outlineDir, '--json']);
  assert.equal(up.status, 2, 'up must refuse while the lock has no authenticated digest');
  const upReport = parseJsonOut(up, 'up');
  assert.equal(upReport.refused, true);
  assert.match(upReport.error, /IMAGES_LOCK_NOT_READY/);
  assert.ok(Array.isArray(upReport.unverifiedComponents) && upReport.unverifiedComponents.length >= required.length);
  assert.doesNotMatch(up.stdout, HOST_PATH_OUTPUT_RE);
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
  for (const probeCase of ['oidc-principal-acl', 'restart-persistence', 'attachment-denial']) {
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

  // 有 --endpoint 但不可达：必须真实尝试并如实报告连接失败（未来有真实实例时同一命令直接可跑）。
  const unreachable = runCli([
    'probe', '--case', 'restart-persistence', '--endpoint', 'http://127.0.0.1:9',
    '--registry', registryPath, '--dir', outlineDir, '--json',
  ]);
  assert.equal(unreachable.status, 2, 'unreachable endpoint must stay UNVERIFIED with exit 2');
  const unreachableReport = parseJsonOut(unreachable, 'probe unreachable');
  assert.equal(unreachableReport.executed, false);
  assert.equal(unreachableReport.status, 'UNVERIFIED');
  assert.ok(unreachableReport.reason.length > 0);
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
    assert.equal(collection.id, null, 'immutable collection id stays UNVERIFIED until a real deployment');
  }
  assert.equal(domain.instance.id, null, 'immutable instance id stays UNVERIFIED until a real deployment');

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

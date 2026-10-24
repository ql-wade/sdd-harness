import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// V_INFRA_I01 — I01 独立资源登记、版本准入与秘密引用 的契约检查。
// 规格：openspec/changes/delivery-foundation-rearchitecture/infrastructure-tasks.json 的 I01 条目。
//
//   Registry.v1       project/resource/owner/credentialRef/lockRef/authority/domain/retention，无秘密值
//   SecretRef.v1      purpose-bound 不透明引用，仅授权 service principal 可解析；
//                     本任务不连接真实 secret store，授权解析必须如实返回 UNRESOLVED，绝不产值
//   Qualification.v1  精确源 commit、镜像 digest/平台/体积、许可证、健康 API 与备份兼容证据齐备才允许 up
//
// CLI 退出码契约（execution-contract.json V_INFRA_I01.cli_contract）：
//   0=PASS，1=输入/前置无效，2=验证失败；环境缺失必须显式 UNVERIFIED 且退出码非零，不允许 skip 转 PASS。
//
// 负例 fixture 全部在 os.tmpdir() 生成，不向活配置写入任何状态。

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '..');
const registryPath = path.join(repoRoot, 'infra', 'delivery', 'registry.json');
const refsExamplePath = path.join(repoRoot, 'infra', 'delivery', 'secrets.refs.example.json');
const registryCli = path.join(repoRoot, 'tools', 'infra', 'registry.mjs');
const secretRefsModuleUrl = new URL('../tools/infra/secret-refs.mjs', import.meta.url);

const RUN_TIMEOUT_MS = 60_000;

function runRegistry(args) {
  return spawnSync(process.execPath, [registryCli, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: RUN_TIMEOUT_MS,
  });
}

function parseJsonOut(result, label) {
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`${label}: stdout is not JSON: ${result.stdout}\nstderr: ${result.stderr}`);
  }
}

function tmpFixture(name, value) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `infra-i01-${name}-`));
  const file = path.join(dir, `${name}.json`);
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
  return file;
}

function loadCommittedRegistry() {
  return JSON.parse(fs.readFileSync(registryPath, 'utf8'));
}

function patchRegistry(mutate) {
  const registry = loadCommittedRegistry();
  mutate(registry);
  return tmpFixture('registry', registry);
}

function violationCodes(report) {
  return (report.violations ?? []).map((v) => v.code);
}

test('V_INFRA_I01 contract: committed registry validates clean and canonical commands honor exit contract', () => {
  const validate = runRegistry(['validate', '--registry', registryPath, '--json']);
  assert.equal(validate.status, 0, `validate must PASS on committed registry: ${validate.stderr || validate.stdout}`);
  const report = parseJsonOut(validate, 'validate');
  assert.equal(report.ok, true);
  assert.deepEqual(report.violations, []);
  // nb-2 回归：validate 的结构化输出不得回显宿主绝对路径（文件字段一律 repo 相对）。
  assert.doesNotMatch(validate.stdout, /\/(Users|home|root|private|var|usr|etc|opt|tmp)\//);

  // 配置有效 ≠ 运行 ready：committed 证据不含可独立复算的 archive，qualify 必须 NOT_READY 且非零退出。
  const qualify = runRegistry(['qualify', '--resource', 'comet-source', '--registry', registryPath, '--json']);
  assert.equal(qualify.status, 2, `unready qualify must exit 2: ${qualify.stderr || qualify.stdout}`);
  const receipt = parseJsonOut(qualify, 'qualify');
  assert.equal(receipt.ready, false);
  const unverified = Object.entries(receipt.categories)
    .filter(([, c]) => c.status === 'UNVERIFIED')
    .map(([k]) => k);
  assert.ok(unverified.length > 0, 'honest receipt must expose UNVERIFIED categories, none may be fabricated');
  // 宿主私有路径绝不进入结构化回执（运行时错误文本必须被工具自身脱敏）。
  assert.doesNotMatch(
    JSON.stringify(receipt),
    /\/(Users|home|root|private|var|usr|etc|opt|tmp)\//,
    'receipts must not carry host absolute paths',
  );

  // 未知资源 = 输入/前置无效 → 退出 1。
  const unknown = runRegistry(['qualify', '--resource', 'does-not-exist', '--registry', registryPath, '--json']);
  assert.equal(unknown.status, 1);

  // registry 文件缺失 = 输入无效 → 退出 1（非语义违规）。
  const missing = runRegistry(['validate', '--registry', path.join(os.tmpdir(), 'no-such-registry.json'), '--json']);
  assert.equal(missing.status, 1);

  const status = runRegistry(['status', '--registry', registryPath, '--json']);
  assert.equal(status.status, 0);
  const statusReport = parseJsonOut(status, 'status');
  assert.ok(Array.isArray(statusReport.resources));

  // 锁未 ready → up 入口必须拒绝。
  const up = runRegistry(['up', '--resource', 'comet-source', '--registry', registryPath, '--json']);
  assert.equal(up.status, 2, 'up must refuse while lock is not ready');
  const upReport = parseJsonOut(up, 'up');
  assert.equal(upReport.refused, true);
  assert.equal(upReport.ready, false);
});

test('RED owner gate: resource owned by an unregistered owner is rejected', () => {
  const fixture = patchRegistry((r) => {
    r.resources[0].owner = 'mallory-unregistered';
  });
  const result = runRegistry(['validate', '--registry', fixture, '--json']);
  assert.equal(result.status, 2, 'unknown owner must be a verification failure');
  const report = parseJsonOut(result, 'validate');
  assert.ok(violationCodes(report).includes('UNKNOWN_OWNER'), JSON.stringify(report.violations));
});

test('RED cross-project gate: credentialRef resolving into another project (pav-*) is rejected', () => {
  const fixture = patchRegistry((r) => {
    r.resources[0].credentialRef = 'secret-ref:pav-legacy/outline-db';
  });
  const result = runRegistry(['validate', '--registry', fixture, '--json']);
  assert.equal(result.status, 2);
  const report = parseJsonOut(result, 'validate');
  assert.ok(violationCodes(report).includes('CROSS_PROJECT_REF'), JSON.stringify(report.violations));
});

test('RED principal gate: ordinary agent identity is denied publisher/isolator material', async () => {
  const secretRefs = await import(secretRefsModuleUrl);
  const refsDoc = JSON.parse(fs.readFileSync(refsExamplePath, 'utf8'));

  // 未授权身份 + 错误角色 → 拒绝。
  for (const ref of ['secret-ref:sdd-harness-pilot/outline-publisher', 'secret-ref:sdd-harness-pilot/outline-isolator']) {
    assert.throws(
      () =>
        secretRefs.resolveSecretRef({
          ref,
          principalId: 'svc:sdd-harness-pilot/ordinary-agent',
          role: 'author',
          refsDoc,
        }),
      (error) => error.code === 'PRINCIPAL_NOT_AUTHORIZED',
      `ordinary agent must not resolve ${ref}`,
    );
  }

  // 即使身份与角色匹配：本任务无运行时 secret store，解析必须如实 UNRESOLVED，绝不产生值。
  const outcome = secretRefs.resolveSecretRef({
    ref: 'secret-ref:sdd-harness-pilot/outline-publisher',
    principalId: refsDoc.refs.find((r) => r.ref.endsWith('outline-publisher')).allowedPrincipals[0],
    role: refsDoc.refs.find((r) => r.ref.endsWith('outline-publisher')).boundRole,
    refsDoc,
  });
  assert.equal(outcome.resolved, false);
  assert.equal(outcome.status, 'UNRESOLVED');
  assert.ok(!('value' in outcome), 'UNRESOLVED result must never carry a value');
});

test('RED image gate: floating tag and fake digest do not pass', () => {
  const floating = patchRegistry((r) => {
    r.resources[0].image = { reference: 'ghcr.io/example/outline:latest' };
  });
  const floatingRun = runRegistry(['validate', '--registry', floating, '--json']);
  assert.equal(floatingRun.status, 2, 'floating :latest must not pass');
  const floatingReport = parseJsonOut(floatingRun, 'validate');
  const floatingCodes = violationCodes(floatingReport);
  assert.ok(floatingCodes.includes('FLOATING_TAG_FORBIDDEN'), JSON.stringify(floatingReport.violations));
  assert.ok(floatingCodes.includes('IMAGE_NOT_DIGEST_PINNED'), JSON.stringify(floatingReport.violations));

  const fakeDigest = patchRegistry((r) => {
    r.resources[0].image = { reference: 'ghcr.io/example/outline:v1.2.3', digest: 'sha256:deadbeef' };
  });
  const fakeRun = runRegistry(['validate', '--registry', fakeDigest, '--json']);
  assert.equal(fakeRun.status, 2, 'format-invalid digest must not pass');
  const fakeReport = parseJsonOut(fakeRun, 'validate');
  assert.ok(violationCodes(fakeReport).includes('DIGEST_FORMAT_INVALID'), JSON.stringify(fakeReport.violations));
});

test('RED evidence gate: license/platform/backup compatibility missing means NOT_READY and up refuses', () => {
  const qualify = runRegistry(['qualify', '--resource', 'comet-source', '--registry', registryPath, '--json']);
  assert.equal(qualify.status, 2);
  const receipt = parseJsonOut(qualify, 'qualify');
  for (const category of ['license', 'platform', 'backup-compatibility', 'image-digest', 'health-api']) {
    assert.equal(receipt.categories[category].status, 'UNVERIFIED', `${category} must be honestly UNVERIFIED`);
    assert.ok(receipt.categories[category].reason, `${category} must carry a reason`);
  }

  const up = runRegistry(['up', '--resource', 'comet-source', '--registry', registryPath, '--json']);
  assert.equal(up.status, 2, 'up must refuse without license/platform/backup evidence');
  const upReport = parseJsonOut(up, 'up');
  assert.equal(upReport.refused, true);
  assert.match(upReport.error, /QUALIFICATION_NOT_READY/);
});

test('RED digest binding: qualify receipt recomputes the actual input archive and rejects mismatch', () => {
  const wrongArchive = path.join(os.tmpdir(), 'infra-i01-wrong-archive.bin');
  fs.writeFileSync(wrongArchive, 'not the comet source archive');
  const wrongSha = crypto.createHash('sha256').update(fs.readFileSync(wrongArchive)).digest('hex');

  const result = runRegistry([
    'qualify',
    '--resource',
    'comet-source',
    '--registry',
    registryPath,
    '--archive',
    wrongArchive,
    '--json',
  ]);
  assert.equal(result.status, 2, 'archive whose digest mismatches the lock must not qualify');
  const receipt = parseJsonOut(result, 'qualify');
  // 回执必须绑定实际输入摘要，而不是声称的摘要。
  assert.equal(receipt.inputs.archiveSha256, wrongSha);
  assert.equal(receipt.categories['source-digest'].status, 'MISMATCH');
  assert.ok(
    (receipt.categories['source-digest'].expected ?? '').endsWith('28a7e2faefa7817244bdc1e54fdca3443fb9e16d947f89df9d51391e45faaa1f'),
  );
});

test('RED plaintext gate: secret-shaped values and secret-value keys are rejected', () => {
  const badRefs = JSON.parse(fs.readFileSync(refsExamplePath, 'utf8'));
  badRefs.refs.push({
    ref: 'secret-ref:sdd-harness-pilot/source-git-read',
    purpose: 'leak fixture',
    boundRole: 'controller',
    allowedPrincipals: ['svc:sdd-harness-pilot/runner'],
    value: `ghp_${'A'.repeat(36)}`,
  });
  const refsFixture = tmpFixture('refs', badRefs);
  const refsRun = runRegistry(['validate', '--registry', registryPath, '--refs', refsFixture, '--json']);
  assert.equal(refsRun.status, 2, 'secret plaintext in refs catalog must be rejected');
  const refsReport = parseJsonOut(refsRun, 'validate');
  const refsCodes = violationCodes(refsReport);
  assert.ok(refsCodes.includes('SECRET_PLAINTEXT_FORBIDDEN'), JSON.stringify(refsReport.violations));
  assert.ok(refsCodes.includes('SECRET_VALUE_KEY_FORBIDDEN'), JSON.stringify(refsReport.violations));
  assert.ok(refsCodes.includes('ROLE_REUSE'), JSON.stringify(refsReport.violations));

  const badRegistry = patchRegistry((r) => {
    r.resources[0].clientSecret = `sk-${'x'.repeat(30)}`;
  });
  const registryRun = runRegistry(['validate', '--registry', badRegistry, '--json']);
  assert.equal(registryRun.status, 2, 'secret value key in registry must be rejected');
  const registryReport = parseJsonOut(registryRun, 'validate');
  assert.ok(
    violationCodes(registryReport).includes('SECRET_VALUE_KEY_FORBIDDEN'),
    JSON.stringify(registryReport.violations),
  );
});

test('RED host-path gate: host absolute paths are rejected in committed structure', () => {
  const fixture = patchRegistry((r) => {
    r.resources[0].localWorkspace = '/Users/example/secret-stuff/comet';
  });
  const result = runRegistry(['validate', '--registry', fixture, '--json']);
  assert.equal(result.status, 2);
  const report = parseJsonOut(result, 'validate');
  assert.ok(violationCodes(report).includes('ABSOLUTE_PATH_FORBIDDEN'), JSON.stringify(report.violations));
});

test('RED role-reuse gate: one credential bound to two high-privilege roles is rejected', () => {
  const badRefs = JSON.parse(fs.readFileSync(refsExamplePath, 'utf8'));
  badRefs.refs.push({
    ref: badRefs.refs[0].ref,
    purpose: 'duplicate binding with a different role',
    boundRole: badRefs.refs[0].boundRole === 'publisher' ? 'isolator' : 'publisher',
    allowedPrincipals: ['svc:sdd-harness-pilot/other'],
  });
  const refsFixture = tmpFixture('refs-reuse', badRefs);
  const result = runRegistry(['validate', '--registry', registryPath, '--refs', refsFixture, '--json']);
  assert.equal(result.status, 2);
  const report = parseJsonOut(result, 'validate');
  assert.ok(violationCodes(report).includes('ROLE_REUSE'), JSON.stringify(report.violations));
});

test('RED schema shape gate: type-invalid fields and duplicate resource ids are rejected', () => {
  // registry.schema.json 声明 schemaVersion const 1、github.repoId/principalId integer、
  // retention.autoCleanupEnabled boolean；工具端必须同等拒绝坏类型，声明式 schema 不许漂移。
  const badSchemaVersion = patchRegistry((r) => {
    r.schemaVersion = '1';
  });
  const badRepoId = patchRegistry((r) => {
    r.project.github.repoId = '1285806550';
  });
  const badAutoCleanup = patchRegistry((r) => {
    r.resources[0].retention.autoCleanupEnabled = 'true';
  });
  for (const [label, fixture] of [
    ['schemaVersion', badSchemaVersion],
    ['repoId', badRepoId],
    ['autoCleanupEnabled', badAutoCleanup],
  ]) {
    const run = runRegistry(['validate', '--registry', fixture, '--json']);
    assert.equal(run.status, 2, `type-invalid ${label} must be a verification failure`);
    const report = parseJsonOut(run, `validate-${label}`);
    assert.ok(violationCodes(report).includes('REGISTRY_TYPE_INVALID'), JSON.stringify(report.violations));
  }

  // 重复 id：两个同名资源会让 qualify/status 的准入语义歧义（find 只命中第一个），必须拒绝。
  const duplicate = patchRegistry((r) => {
    r.resources.push(JSON.parse(JSON.stringify(r.resources[0])));
  });
  const dupRun = runRegistry(['validate', '--registry', duplicate, '--json']);
  assert.equal(dupRun.status, 2, 'duplicate resource id must be a verification failure');
  const dupReport = parseJsonOut(dupRun, 'validate-duplicate');
  assert.ok(violationCodes(dupReport).includes('DUPLICATE_RESOURCE_ID'), JSON.stringify(dupReport.violations));
});

test('retention gate: auto cleanup cannot be enabled while recovery fields are UNVERIFIED', () => {
  const fixture = patchRegistry((r) => {
    r.resources[0].retention.autoCleanupEnabled = true;
  });
  const result = runRegistry(['validate', '--registry', fixture, '--json']);
  assert.equal(result.status, 2);
  const report = parseJsonOut(result, 'validate');
  assert.ok(
    violationCodes(report).includes('AUTO_CLEANUP_WITHOUT_CONFIRMED_RECOVERY'),
    JSON.stringify(report.violations),
  );
});

test('committed registry and refs catalog contain no secret material', async () => {
  const secretRefs = await import(secretRefsModuleUrl);
  for (const file of [registryPath, refsExamplePath]) {
    const violations = secretRefs.scanForForbiddenValues(JSON.parse(fs.readFileSync(file, 'utf8')));
    assert.deepEqual(violations, [], `${file} must contain no secret-shaped values or host paths`);
  }
});

test('SecretRef.v1 format: parse accepts only well-formed project-bound refs', async () => {
  const secretRefs = await import(secretRefsModuleUrl);
  const ok = secretRefs.parseSecretRef('secret-ref:sdd-harness-pilot/outline-db');
  assert.equal(ok.ok, true);
  assert.equal(ok.project, 'sdd-harness-pilot');
  assert.equal(ok.name, 'outline-db');

  for (const bad of [
    'secret-ref:/outline-db',
    'secret-ref:sdd-harness-pilot/',
    'plain-name',
    'secret-ref:Upper/Case',
    'secret-ref:sdd-harness-pilot/has space',
    '',
  ]) {
    assert.equal(secretRefs.parseSecretRef(bad).ok, false, `must reject ${JSON.stringify(bad)}`);
  }
});

test('authority readback is honestly recorded as UNVERIFIED with the exact failure', () => {
  const registry = loadCommittedRegistry();
  const authority = registry.project.authority;
  assert.equal(authority.readbackStatus, 'UNVERIFIED');
  assert.ok(authority.readbackError && authority.readbackError.length > 0, 'must record the exact error');
  assert.match(authority.readbackCommand, /gh api/);
  assert.equal(registry.project.github.repoId, 1285806550);
  assert.equal(registry.project.github.principalId, 262266039);

  // readback 子命令必须存在且如实输出（不预判网络结果，只验诚实结构）。
  // VERIFIED 只在 repo 身份与实际认证 caller（gh api user）双双匹配时出现；
  // 公开仓库可读 ≠ caller/owner 认证，错配必须是显式 MISMATCH。
  const result = runRegistry(['readback', '--kind', 'github', '--json']);
  assert.ok(result.status === 0 || result.status === 2, `readback exits 0 (read) or 2 (unreadable): ${result.stderr}`);
  const observation = parseJsonOut(result, 'readback');
  assert.ok(['VERIFIED', 'UNVERIFIED', 'MISMATCH'].includes(observation.status));
  if (observation.status === 'VERIFIED') {
    assert.equal(observation.repoReadback.repoId, 1285806550);
    assert.equal(observation.callerReadback.principalId, 262266039);
  } else {
    assert.ok(observation.error && observation.error.length > 0);
  }
});

test('every planned secret ref (I01+I02+I03+I05+I06+I07 freeze list, 24) is registered with distinct purposes and bound roles', () => {
  const refsDoc = JSON.parse(fs.readFileSync(refsExamplePath, 'utf8'));
  const expected = [
    'source-git-read',
    'runner-authority',
    'worker-author-api',
    'worker-review-api',
    'runner-source-read',
    'outline-publisher',
    'outline-isolator',
    'outline-oidc-client',
    'outline-db',
    'outline-redis',
    'outline-app-session',
    'outline-object-store',
    'codewiki-source-read',
    'codewiki-provider',
    'codegraph-source-read',
    'ci-source-read',
    'ci-check-publisher',
    'ci-registry',
    'artifact-reader',
    'pilot-deployer',
    'pilot-rollback',
    'monitor-health-read',
    'monitor-alert',
    'backup-encryption',
  ];
  const actual = refsDoc.refs.map((r) => r.ref);
  for (const name of expected) {
    assert.ok(actual.includes(`secret-ref:sdd-harness-pilot/${name}`), `missing ref ${name}`);
  }
  assert.equal(actual.length, new Set(actual).size, 'no duplicate refs');
  for (const entry of refsDoc.refs) {
    assert.ok(entry.purpose && entry.purpose.length > 0, 'purpose-bound: every ref carries a purpose');
    assert.ok(entry.boundRole, 'every ref binds exactly one role');
    assert.ok(Array.isArray(entry.allowedPrincipals) && entry.allowedPrincipals.length > 0);
    assert.equal(entry.ref.startsWith('secret-ref:sdd-harness-pilot/'), true);
  }
});

// ---- github readback（V_INFRA_I01 身份收敛回归）---------------------------------
// 缺陷基线（2026-10-25）：
//   1) readback --kind github 硬编码 repos/rpamis/sdd-harness，忽略 --registry 与登记身份；
//   2) 任何 gh exit0 JSON 一律报 VERIFIED（不校验 repo 形状、repoId/fullname/owner、caller）；
//   3) committed registry 的 fullname/url/readbackCommand 指向 rpamis，实际项目是
//      ql-wade/sdd-harness（repoId 1285806550，owner ql-wade ID 262266039，默认分支 master）。
// 以下测试只用临时 registry fixture + PATH 上的 stub gh 传输层（记录 argv、注入状态/响应体），
// 不触网、不读凭据；真实网络读回仍由根控制器执行，stub 结果绝不冒充线上事实。

const GH_STUB_SCRIPT = [
  '#!/usr/bin/env node',
  "import fs from 'node:fs';",
  "import path from 'node:path';",
  'const dir = process.env.GH_STUB_DIR;',
  'const args = process.argv.slice(2);',
  "fs.appendFileSync(path.join(dir, 'calls.log'), JSON.stringify(args) + '\\n');",
  "const apiIndex = args.indexOf('api');",
  'const target = apiIndex >= 0 ? (args[apiIndex + 1] || "") : "";',
  'const route = target === "user" ? "user" : target.startsWith("repos/") ? "repo" : "unknown";',
  'const read = (name) => (fs.existsSync(path.join(dir, name)) ? fs.readFileSync(path.join(dir, name), "utf8") : "");',
  'const status = Number.parseInt((read(route + ".status") || "0").trim(), 10) || 0;',
  'const err = read(route + ".err");',
  'if (err) process.stderr.write(err);',
  'process.stdout.write(read(route + ".json"));',
  'process.exit(Number.isFinite(status) ? status : 0);',
].join('\n');

function makeGhStub() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'infra-i01-gh-stub-'));
  fs.writeFileSync(path.join(dir, 'gh'), GH_STUB_SCRIPT, { mode: 0o755 });
  return {
    dir,
    callsLog: path.join(dir, 'calls.log'),
    setRoute(route, { status, body, stderr } = {}) {
      if (status !== undefined) fs.writeFileSync(path.join(dir, `${route}.status`), String(status));
      if (body !== undefined) fs.writeFileSync(path.join(dir, `${route}.json`), typeof body === 'string' ? body : JSON.stringify(body));
      if (stderr !== undefined) fs.writeFileSync(path.join(dir, `${route}.err`), stderr);
    },
  };
}

function runRegistryWithStub(args, stub) {
  return spawnSync(process.execPath, [registryCli, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: RUN_TIMEOUT_MS,
    env: { ...process.env, PATH: `${stub.dir}${path.delimiter}${process.env.PATH}`, GH_STUB_DIR: stub.dir },
  });
}

function stubCalls(stub) {
  if (!fs.existsSync(stub.callsLog)) return [];
  return fs.readFileSync(stub.callsLog, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function stubHealthyIdentity(stub, github) {
  stub.setRoute('repo', {
    body: {
      id: github.repoId,
      full_name: github.repoFullname,
      owner: { login: github.owner },
      default_branch: 'master',
    },
  });
  stub.setRoute('user', { body: { id: github.principalId, login: github.owner } });
}

test('github readback: derives the GitHub target from the registered identity and verifies repo plus authenticated caller', () => {
  const github = loadCommittedRegistry().project.github;
  const stub = makeGhStub();
  stubHealthyIdentity(stub, github);
  const result = runRegistryWithStub(['readback', '--kind', 'github', '--registry', registryPath, '--json'], stub);
  assert.equal(result.status, 0, `matching repo + caller must PASS: ${result.stderr || result.stdout}`);
  const report = parseJsonOut(result, 'readback');
  assert.equal(report.status, 'VERIFIED');
  assert.equal(report.kind, 'github');
  assert.equal(report.registeredIdentity.repoFullname, github.repoFullname);
  assert.equal(report.repoReadback.status, 'VERIFIED');
  assert.equal(report.repoReadback.repoId, github.repoId);
  assert.equal(report.repoReadback.repoFullname, github.repoFullname);
  assert.equal(report.repoReadback.owner, github.owner);
  assert.equal(report.callerReadback.status, 'VERIFIED');
  assert.equal(report.callerReadback.principalId, github.principalId);
  assert.equal(report.callerReadback.login, github.owner);

  // 目标必须来自登记输入：观测到 repos/<registered fullname> 与 user 两条调用。
  const calls = stubCalls(stub);
  assert.ok(
    calls.some((c) => c.join(' ') === `api repos/${github.repoFullname}`),
    `must call gh api repos/${github.repoFullname}, observed: ${JSON.stringify(calls)}`,
  );
  assert.ok(calls.some((c) => c.join(' ') === 'api user'), `must verify the authenticated caller via gh api user, observed: ${JSON.stringify(calls)}`);
  assert.doesNotMatch(result.stdout, /rpamis\/sdd-harness/, 'hardcoded legacy target must not appear');

  // 身份事实与业务授权严格分离：readback 永远不授予发布/CI 变更。
  assert.equal(report.grants.publication, 'NOT_CLAIMED');
  assert.equal(report.grants.ciMutation, 'NOT_CLAIMED');
  assert.match(report.grants.note, /no publication/);
});

test('github readback: arbitrary alternate registered project fixture is honored, not the hardcoded repo', () => {
  const fixture = patchRegistry((r) => {
    r.project.owner = 'alice';
    r.project.github = {
      repoId: 555000111,
      repoFullname: 'alice/acme-widgets',
      principalId: 777000222,
      owner: 'alice',
      url: 'https://github.com/alice/acme-widgets',
    };
  });
  const stub = makeGhStub();
  stubHealthyIdentity(stub, {
    repoId: 555000111,
    repoFullname: 'alice/acme-widgets',
    owner: 'alice',
    principalId: 777000222,
  });
  const result = runRegistryWithStub(['readback', '--kind', 'github', '--registry', fixture, '--json'], stub);
  assert.equal(result.status, 0, `alternate project with matching fixtures must PASS: ${result.stderr || result.stdout}`);
  const report = parseJsonOut(result, 'readback');
  assert.equal(report.status, 'VERIFIED');
  assert.equal(report.repoReadback.repoFullname, 'alice/acme-widgets');
  assert.equal(report.callerReadback.login, 'alice');
  const calls = stubCalls(stub);
  assert.ok(calls.some((c) => c.includes('repos/alice/acme-widgets')), `observed: ${JSON.stringify(calls)}`);
  assert.ok(!JSON.stringify(calls).includes('rpamis'), 'must not call the previously hardcoded repo');
});

test('github readback: repo answering with a different repoId, fullname or owner is refused as MISMATCH', () => {
  const github = loadCommittedRegistry().project.github;
  const cases = [
    {
      label: 'repoId',
      body: { id: 999888777, full_name: github.repoFullname, owner: { login: github.owner } },
      field: 'repoId',
    },
    {
      label: 'fullname',
      body: { id: github.repoId, full_name: 'mallory/sdd-harness', owner: { login: github.owner } },
      field: 'repoFullname',
    },
    {
      label: 'owner',
      body: { id: github.repoId, full_name: github.repoFullname, owner: { login: 'mallory' } },
      field: 'owner',
    },
  ];
  for (const { label, body, field } of cases) {
    const stub = makeGhStub();
    stub.setRoute('repo', { body });
    stub.setRoute('user', { body: { id: github.principalId, login: github.owner } });
    const result = runRegistryWithStub(['readback', '--kind', 'github', '--registry', registryPath, '--json'], stub);
    assert.equal(result.status, 2, `mismatched ${label} must be refused with exit 2: ${result.stdout}`);
    const report = parseJsonOut(result, `mismatch-${label}`);
    assert.equal(report.status, 'MISMATCH');
    assert.equal(report.repoReadback.status, 'MISMATCH');
    assert.ok(
      report.repoReadback.mismatches.some((m) => m.field === field),
      `mismatch detail must name ${field}: ${JSON.stringify(report.repoReadback.mismatches)}`,
    );
    assert.ok(report.error && report.error.length > 0, 'must carry a top-level failure reason');
    assert.equal(report.grants.publication, 'NOT_CLAIMED');
  }
});

test('github readback: public repo readability with a different authenticated caller is NOT authority VERIFIED', () => {
  const github = loadCommittedRegistry().project.github;
  const stub = makeGhStub();
  stub.setRoute('repo', { body: { id: github.repoId, full_name: github.repoFullname, owner: { login: github.owner } } });
  // 仓库可公开读 ≠ caller/owner 认证：实际认证主体是别人。
  stub.setRoute('user', { body: { id: 111222333, login: 'someone-else' } });
  const result = runRegistryWithStub(['readback', '--kind', 'github', '--registry', registryPath, '--json'], stub);
  assert.equal(result.status, 2, `wrong caller must be refused with exit 2: ${result.stdout}`);
  const report = parseJsonOut(result, 'readback-caller');
  assert.equal(report.status, 'MISMATCH');
  assert.equal(report.repoReadback.status, 'VERIFIED', 'repo readability itself may be VERIFIED');
  assert.equal(report.callerReadback.status, 'MISMATCH');
  assert.ok(report.callerReadback.mismatches.some((m) => m.field === 'principalId'));
  assert.equal(report.grants.publication, 'NOT_CLAIMED');
  assert.equal(report.grants.ciMutation, 'NOT_CLAIMED');
});

test('github readback: nonzero gh exit, error envelopes, non-repo JSON and caller failure are refused', () => {
  const github = loadCommittedRegistry().project.github;
  const healthyRepo = { id: github.repoId, full_name: github.repoFullname, owner: { login: github.owner } };
  const healthyUser = { id: github.principalId, login: github.owner };
  const cases = [
    {
      label: 'gh nonzero exit',
      setup: (stub) => {
        stub.setRoute('repo', { status: 1, stderr: 'gh: Not Found (HTTP 404)\n', body: '' });
        stub.setRoute('user', { body: healthyUser });
      },
      expect: { part: 'repoReadback', match: /Not Found/ },
    },
    {
      label: 'error envelope with exit 0',
      setup: (stub) => {
        stub.setRoute('repo', { body: { message: 'Bad credentials', documentation_url: 'https://docs.github.com/rest' } });
        stub.setRoute('user', { body: healthyUser });
      },
      expect: { part: 'repoReadback', match: /Bad credentials/ },
    },
    {
      label: 'non-repo JSON object',
      setup: (stub) => {
        stub.setRoute('repo', { body: { id: 262266039, login: github.owner, type: 'User' } });
        stub.setRoute('user', { body: healthyUser });
      },
      expect: { part: 'repoReadback', match: /not a repository/ },
    },
    {
      label: 'malformed JSON payload',
      setup: (stub) => {
        stub.setRoute('repo', { body: 'not-json-at-all' });
        stub.setRoute('user', { body: healthyUser });
      },
      expect: { part: 'repoReadback', match: /not JSON/ },
    },
    {
      label: 'caller endpoint nonzero exit',
      setup: (stub) => {
        stub.setRoute('repo', { body: healthyRepo });
        stub.setRoute('user', { status: 1, stderr: 'gh: gh auth login required\n', body: '' });
      },
      expect: { part: 'callerReadback', match: /auth login required/ },
    },
  ];
  for (const { label, setup, expect } of cases) {
    const stub = makeGhStub();
    setup(stub);
    const result = runRegistryWithStub(['readback', '--kind', 'github', '--registry', registryPath, '--json'], stub);
    assert.equal(result.status, 2, `${label} must be refused with exit 2: ${result.stdout}`);
    const report = parseJsonOut(result, `malformed-${label}`);
    assert.equal(report.status, 'UNVERIFIED', `${label} is UNVERIFIED, never VERIFIED`);
    assert.equal(report[expect.part].status, 'UNVERIFIED');
    assert.match(report[expect.part].reason, expect.match);
    assert.ok(report.error && report.error.length > 0);
  }
});

test('github readback: malformed or missing registered identity is rejected before any gh call', () => {
  const mutations = {
    'github block missing': (r) => { delete r.project.github; },
    'repoId not an integer': (r) => { r.project.github.repoId = String(r.project.github.repoId); },
    'repoFullname malformed': (r) => { r.project.github.repoFullname = 'not-a-fullname'; },
    'principalId missing': (r) => { delete r.project.github.principalId; },
    'owner empty': (r) => { r.project.github.owner = ''; },
  };
  for (const [label, mutate] of Object.entries(mutations)) {
    const fixture = patchRegistry(mutate);
    const stub = makeGhStub();
    stubHealthyIdentity(stub, loadCommittedRegistry().project.github);
    const result = runRegistryWithStub(['readback', '--kind', 'github', '--registry', fixture, '--json'], stub);
    assert.equal(result.status, 1, `${label} is invalid input -> exit 1, got ${result.status}: ${result.stdout}`);
    assert.match(result.stderr, /identity invalid/, `${label} must name the identity problem on stderr`);
    assert.equal(stubCalls(stub).length, 0, `${label}: gh must not be invoked before identity validation`);
  }

  // registry 文件本身不可读 = 前置无效（exit 1），同样不允许先碰 gh。
  const stub = makeGhStub();
  stubHealthyIdentity(stub, loadCommittedRegistry().project.github);
  const missing = runRegistryWithStub(
    ['readback', '--kind', 'github', '--registry', path.join(os.tmpdir(), 'infra-i01-no-such-registry.json'), '--json'],
    stub,
  );
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /registry unreadable/);
  assert.equal(stubCalls(stub).length, 0, 'no gh call for an unreadable registry');

  // 未知 kind / 缺 kind 维持输入无效语义。
  const badKind = runRegistryWithStub(['readback', '--kind', 'gitlab', '--registry', registryPath, '--json'], stub);
  assert.equal(badKind.status, 1);
  const noKind = runRegistryWithStub(['readback', '--registry', registryPath, '--json'], stub);
  assert.equal(noKind.status, 1);
  assert.equal(stubCalls(stub).length, 0);
});

test('github readback: committed registry identity labels point at the actual ql-wade project', () => {
  const registry = loadCommittedRegistry();
  const github = registry.project.github;
  const authority = registry.project.authority;
  assert.equal(github.repoFullname, 'ql-wade/sdd-harness');
  assert.equal(github.url, 'https://github.com/ql-wade/sdd-harness');
  assert.equal(github.repoId, 1285806550);
  assert.equal(github.principalId, 262266039);
  assert.equal(github.owner, 'ql-wade');
  assert.match(authority.readbackCommand, /repos\/ql-wade\/sdd-harness/);
  assert.match(authority.readbackCommand, /gh api user/);
  assert.doesNotMatch(JSON.stringify({ github, authority }), /rpamis\/sdd-harness/, 'stale rpamis labels must be gone');
  // 标签修正不等于线上读回：authority 状态在真实控制器读回前必须保持 UNVERIFIED。
  assert.equal(authority.readbackStatus, 'UNVERIFIED');
});

// ---- github readback ROUND2（双评审 block 后的补充契约，2026-10-25）----------------
// 评审缺陷基线（针对 round1 实现）：
//   A) repo/caller 端点返回 JSON null 时，registry.mjs 在 body.id 上崩溃
//      （TypeError / exit 1 / 无结构化 stdout）。任何非对象 API 数据都必须是
//      结构化 UNVERIFIED + exit 2，绝不允许崩溃或转 VERIFIED。
//   B) repoId=-3、principalId=0、repoFullname owner 段与 github.owner 不一致时仍调用 gh。
//      登记身份必须自洽：repoId/principalId 为正安全整数、fullname owner 段 === github.owner；
//      无效登记 = 输入无效 exit 1，且发生在任何 gh 调用之前。

test('github readback: null and non-object API payloads are structured UNVERIFIED with exit 2, never a crash', () => {
  const github = loadCommittedRegistry().project.github;
  const healthyRepo = JSON.stringify({ id: github.repoId, full_name: github.repoFullname, owner: { login: github.owner } });
  const healthyUser = JSON.stringify({ id: github.principalId, login: github.owner });
  const cases = [
    { label: 'repo endpoint JSON null', repo: 'null', user: healthyUser, part: 'repoReadback', match: /not a repository object/ },
    { label: 'repo endpoint JSON array', repo: '[]', user: healthyUser, part: 'repoReadback', match: /not a repository object/ },
    { label: 'repo endpoint bare string', repo: '"ok"', user: healthyUser, part: 'repoReadback', match: /not a repository object/ },
    { label: 'caller endpoint JSON null', repo: healthyRepo, user: 'null', part: 'callerReadback', match: /not an authenticated user object/ },
    { label: 'caller endpoint JSON array', repo: healthyRepo, user: '[]', part: 'callerReadback', match: /not an authenticated user object/ },
  ];
  for (const { label, repo, user, part, match } of cases) {
    const stub = makeGhStub();
    stub.setRoute('repo', { body: repo });
    stub.setRoute('user', { body: user });
    const result = runRegistryWithStub(['readback', '--kind', 'github', '--registry', registryPath, '--json'], stub);
    assert.equal(
      result.status,
      2,
      `${label}: non-object API data must be structured UNVERIFIED with exit 2, observed exit ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}\ngh calls: ${JSON.stringify(stubCalls(stub))}`,
    );
    const report = parseJsonOut(result, `non-object-${label}`);
    assert.equal(report.status, 'UNVERIFIED', `${label} is UNVERIFIED, never VERIFIED`);
    assert.equal(report[part].status, 'UNVERIFIED');
    assert.match(report[part].reason, match);
    assert.ok(report.error && report.error.length > 0, `${label} must carry a top-level failure reason`);
    assert.equal(report.grants.publication, 'NOT_CLAIMED');
  }
});

test('github readback: registered repoId/principalId must be positive safe integers, rejected before any gh call', () => {
  const mutations = {
    'repoId negative': (r) => { r.project.github.repoId = -3; },
    'repoId zero': (r) => { r.project.github.repoId = 0; },
    'repoId fractional': (r) => { r.project.github.repoId = 1285806550.5; },
    'repoId beyond safe integer range': (r) => { r.project.github.repoId = 2 ** 53; },
    'principalId negative': (r) => { r.project.github.principalId = -1; },
    'principalId zero': (r) => { r.project.github.principalId = 0; },
    'principalId beyond safe integer range': (r) => { r.project.github.principalId = Number.MAX_SAFE_INTEGER + 1; },
  };
  for (const [label, mutate] of Object.entries(mutations)) {
    const fixture = patchRegistry(mutate);
    const stub = makeGhStub();
    stubHealthyIdentity(stub, loadCommittedRegistry().project.github);
    const result = runRegistryWithStub(['readback', '--kind', 'github', '--registry', fixture, '--json'], stub);
    assert.equal(
      result.status,
      1,
      `${label}: invalid registered identity must be rejected as invalid input with exit 1, observed exit ${result.status}\nstdout: ${result.stdout}\ngh calls: ${JSON.stringify(stubCalls(stub))}`,
    );
    assert.match(result.stderr, /identity invalid/, `${label} must name the identity problem on stderr`);
    assert.equal(stubCalls(stub).length, 0, `${label}: gh must not be invoked before identity validation`);
  }
});

test('github readback: repoFullname owner segment must equal registered github.owner before any gh call', () => {
  const mutations = {
    'fullname points at another owner': (r) => { r.project.github.repoFullname = 'mallory/sdd-harness'; },
    'case-variant owner login': (r) => { r.project.github.repoFullname = 'Ql-Wade/sdd-harness'; },
  };
  for (const [label, mutate] of Object.entries(mutations)) {
    const fixture = patchRegistry(mutate);
    const stub = makeGhStub();
    stubHealthyIdentity(stub, loadCommittedRegistry().project.github);
    const result = runRegistryWithStub(['readback', '--kind', 'github', '--registry', fixture, '--json'], stub);
    assert.equal(
      result.status,
      1,
      `${label}: inconsistent owner/fullname registration must be invalid input exit 1, observed exit ${result.status}\nstdout: ${result.stdout}\ngh calls: ${JSON.stringify(stubCalls(stub))}`,
    );
    assert.match(result.stderr, /identity invalid/, `${label} must name the identity problem on stderr`);
    assert.equal(stubCalls(stub).length, 0, `${label}: gh must not be invoked before identity validation`);
  }
});

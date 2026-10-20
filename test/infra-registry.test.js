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
    throw new AssertionError(`${label}: stdout is not JSON: ${result.stdout}\nstderr: ${result.stderr}`);
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
  const result = runRegistry(['readback', '--kind', 'github', '--json']);
  assert.ok(result.status === 0 || result.status === 2, `readback exits 0 (read) or 2 (unreadable): ${result.stderr}`);
  const observation = parseJsonOut(result, 'readback');
  assert.ok(['VERIFIED', 'UNVERIFIED'].includes(observation.status));
  if (observation.status === 'VERIFIED') {
    assert.equal(observation.repoId, 1285806550);
  } else {
    assert.ok(observation.error && observation.error.length > 0);
  }
});

test('the 12 planned secret refs are all registered with distinct purposes and bound roles', () => {
  const refsDoc = JSON.parse(fs.readFileSync(refsExamplePath, 'utf8'));
  const expected = [
    'source-git-read',
    'runner-authority',
    'outline-publisher',
    'outline-isolator',
    'outline-oidc-client',
    'outline-db',
    'outline-redis',
    'outline-object-store',
    'codewiki-provider',
    'ci-registry',
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

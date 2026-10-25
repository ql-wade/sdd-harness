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

function malformedQualificationPolicies() {
  const source = JSON.parse(fs.readFileSync(path.join(repoRoot, 'infra/delivery/qualification-policy.json'), 'utf8'));
  const cases = [['policy-null', null], ['policy-array', []], ['policy-number', 1], ['policy-string', 'policy'], ['policy-empty', {}]];
  const change = (name, mutate) => { const copy = structuredClone(source); mutate(copy); cases.push([name, copy]); };
  for (const [field, values] of [['schemaVersion', [null, '1', 2]], ['interface', [null, 'Qualification.v99']]]) {
    change(`${field}-missing`, (p) => { delete p[field]; });
    for (const [index, value] of values.entries()) change(`${field}-${index}`, (p) => { p[field] = value; });
  }
  for (const field of ['roles', 'evidenceCategories', 'secretValueKeyNames', 'forbiddenHostPathPrefixes']) {
    change(`${field}-missing`, (p) => { delete p[field]; });
    for (const [index, value] of [null, {}, 'not-array', [], [null], [{}], ['']].entries()) change(`${field}-${index}`, (p) => { p[field] = value; });
    change(`${field}-duplicate`, (p) => { p[field].push(p[field][0]); });
  }
  change('category-unknown', (p) => { p.evidenceCategories[0] = 'unimplemented-category'; });
  change('category-incomplete', (p) => { p.evidenceCategories.pop(); });
  for (const field of ['imageReference', 'upGate']) {
    change(`${field}-missing`, (p) => { delete p[field]; });
    for (const [index, value] of [null, []].entries()) change(`${field}-${index}`, (p) => { p[field] = value; });
  }
  for (const [section, field] of [['imageReference', 'digestPinnedRequired'], ['imageReference', 'floatingTagsForbidden'], ['upGate', 'enabled'], ['upGate', 'requireAllCategoriesVerified']]) {
    change(`${section}-${field}-missing`, (p) => { delete p[section][field]; });
    change(`${section}-${field}-type`, (p) => { p[section][field] = 'true'; });
  }
  for (const [index, value] of [null, {}, '[', '^.*$'].entries()) change(`digest-format-${index}`, (p) => { p.imageReference.digestFormat = value; });
  change('digest-format-missing', (p) => { delete p.imageReference.digestFormat; });
  for (const [index, value] of [null, {}, ''].entries()) change(`refusal-reason-${index}`, (p) => { p.upGate.refusalReason = value; });
  change('refusal-reason-missing', (p) => { delete p.upGate.refusalReason; });
  return { source, cases };
}

function inputTripwire() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'infra-i01-policy-shape-'));
  const marker = path.join(dir, 'calls.txt');
  const bin = path.join(dir, 'bin');
  const empty = path.join(dir, 'empty');
  fs.mkdirSync(bin); fs.mkdirSync(empty);
  for (const name of ['npm', 'docker', 'tar', 'gh']) {
    fs.writeFileSync(path.join(bin, name), `#!${process.execPath}\nrequire('node:fs').appendFileSync(${JSON.stringify(marker)}, ${JSON.stringify(name + '\n')});\nprocess.stdout.write('10.0.0\\n');\n`, { mode: 0o700 });
  }
  return {
    dir, marker, bin, empty,
    run(args, commandPath = bin, cli = registryCli) { return spawnSync(process.execPath, [cli, ...args], { cwd: repoRoot, encoding: 'utf8', timeout: RUN_TIMEOUT_MS, env: { ...process.env, PATH: commandPath } }); },
    clear() { fs.rmSync(marker, { force: true }); },
    close() { fs.rmSync(dir, { recursive: true, force: true }); },
  };
}

test('qualification policy shape admission rejects every consumed field before CLI use', () => {
  const harness = inputTripwire();
  try {
    const { source, cases } = malformedQualificationPolicies();
    const policyFile = path.join(harness.dir, 'policy.json');
    const badRefsFile = path.join(harness.dir, 'refs.json');
    const refs = JSON.parse(fs.readFileSync(refsExamplePath, 'utf8'));
    refs.refs.unshift(null); fs.writeFileSync(badRefsFile, JSON.stringify(refs));
    fs.writeFileSync(policyFile, JSON.stringify(source));
    const args = (command) => [command, ...(['qualify', 'up'].includes(command) ? ['--resource', 'comet-source'] : []), '--policy', policyFile, '--json'];
    const control = harness.run(args('qualify'));
    assert.equal(control.status, 2);
    assert.ok(parseJsonOut(control, 'policy tripwire control').runtime);
    assert.match(fs.readFileSync(harness.marker, 'utf8'), /npm\ndocker\n/);
    harness.clear();
    const failures = [];
    const check = (name, policy, extra = [], commandPath = harness.bin) => {
      fs.writeFileSync(policyFile, JSON.stringify(policy));
      for (const command of ['validate', 'status', 'qualify', 'up']) {
        const result = harness.run([...args(command), ...extra], commandPath);
        let report; try { report = JSON.parse(result.stdout); } catch { report = null; }
        const codes = report ? violationCodes(report) : [];
        if (result.status !== 2 || !codes.some((code) => code.startsWith('POLICY_')) || result.stderr || report?.runtime || report?.receipt?.runtime || fs.existsSync(harness.marker)) {
          failures.push({ name, command, exitCode: result.status, json: Boolean(report), policyRefusal: codes.some((code) => code.startsWith('POLICY_')), externalCli: fs.existsSync(harness.marker) });
        }
        harness.clear();
      }
    };
    for (const [name, policy] of cases) check(name, policy);
    for (const [name, policy] of cases.filter(([name]) => ['roles-1', 'evidenceCategories-1', 'policy-null', 'schemaVersion-2'].includes(name))) {
      check(`${name}-with-null-ref`, policy, ['--refs', badRefsFile]);
      check(`${name}-empty-path`, policy, [], harness.empty);
    }
    assert.equal(failures.length, 0, JSON.stringify({ failures: failures.length, samples: failures.slice(0, 10) }));
    fs.writeFileSync(policyFile, '{broken JSON');
    for (const command of ['validate', 'status', 'qualify', 'up']) {
      const result = harness.run(args(command));
      assert.equal(result.status, 1);
      assert.equal(result.stdout, '');
      assert.match(result.stderr, /qualification policy unreadable/);
      assert.equal(fs.existsSync(harness.marker), false);
    }
  } finally { harness.close(); }
});

test('shared catalog and resolver reject malformed policy options and iterable bindings', async () => {
  const { resolveSecretRef, validateRefsCatalog } = await import(secretRefsModuleUrl);
  const refsDoc = JSON.parse(fs.readFileSync(refsExamplePath, 'utf8'));
  const entry = refsDoc.refs.find((item) => item.ref === 'secret-ref:sdd-harness-pilot/outline-publisher');
  const base = { ref: entry.ref, principalId: entry.allowedPrincipals[0], role: entry.boundRole, project: 'sdd-harness-pilot', refsDoc };
  const { source, cases } = malformedQualificationPolicies();
  assert.equal(resolveSecretRef({ ...base, policy: source }).status, 'UNRESOLVED');
  assert.equal(resolveSecretRef(base).status, 'UNRESOLVED');
  const failures = [];
  for (const [name, policy] of cases) {
    try {
      const violations = validateRefsCatalog(refsDoc, base.project, { policy });
      if (!violations.some((v) => v.code.startsWith('POLICY_'))) failures.push(`${name}:catalog-not-refused`);
    } catch { failures.push(`${name}:catalog-threw`); }
    try { resolveSecretRef({ ...base, policy }); failures.push(`${name}:resolver-not-refused`); }
    catch (error) { if (!error.code?.startsWith('POLICY_')) failures.push(`${name}:resolver-wrong-error`); }
  }
  for (const options of [null, [], 1, 'options', { roles: null }, { roles: {} }, { roles: [null] }, { roles: [{}] }, { roles: [] }, { roles: [''] }, { roles: undefined }]) {
    try { if (validateRefsCatalog(refsDoc, base.project, options).length === 0) failures.push('catalog-options-not-refused'); }
    catch { failures.push('catalog-options-threw'); }
  }
  for (const options of [null, [], 1, 'options', undefined]) {
    try { resolveSecretRef(options); failures.push('resolver-options-not-refused'); }
    catch (error) { if (!error.code || error instanceof TypeError) failures.push('resolver-options-threw-type-error'); }
  }
  for (const project of [null, 0, '']) {
    try { resolveSecretRef({ ...base, project }); failures.push('explicit-invalid-project-not-refused'); }
    catch (error) { if (!error.code || error instanceof TypeError) failures.push('invalid-project-threw-type-error'); }
    if (validateRefsCatalog(refsDoc, project).length === 0) failures.push('invalid-expected-project-not-refused');
  }
  for (const principals of [undefined, null, {}, [null], [{}], [''], [], [entry.allowedPrincipals[0], entry.allowedPrincipals[0]]]) {
    const catalog = structuredClone(refsDoc);
    catalog.refs.find((item) => item.ref === entry.ref).allowedPrincipals = principals;
    try { if (validateRefsCatalog(catalog, base.project).length === 0) failures.push('principals-not-refused'); }
    catch { failures.push('principals-threw'); }
  }
  const unknownVersion = { ...refsDoc, schemaVersion: 2 };
  if (validateRefsCatalog(unknownVersion, base.project).length === 0) failures.push('unknown-catalog-version-not-refused');
  for (const boundRole of [null, {}, { toString: null }, 1]) {
    const catalog = structuredClone(refsDoc); catalog.refs[0].boundRole = boundRole;
    try { if (validateRefsCatalog(catalog, base.project).length === 0) failures.push('bound-role-not-refused'); }
    catch { failures.push('bound-role-threw'); }
  }
  assert.equal(failures.length, 0, JSON.stringify({ failures: failures.length, samples: failures.slice(0, 12) }));
});

test('public option and optional input shape errors refuse before external tools', () => {
  const harness = inputTripwire();
  try {
    const registryFile = path.join(harness.dir, 'registry.json');
    const metadataFile = path.join(harness.dir, 'metadata.json');
    const failures = [];
    const check = (name, args, expected) => {
      const result = harness.run([...args, '--json']);
      if (result.status !== expected || /TypeError|SyntaxError.* at /s.test(result.stderr) || fs.existsSync(harness.marker)) failures.push({ name, exitCode: result.status, externalCli: fs.existsSync(harness.marker) });
      harness.clear();
    };
    for (const [name, mutate] of [['delegates-null', (r) => { r.project.delegates = null; }], ['id-object', (r) => { r.resources[0].id = { toString: null }; }]]) {
      const registry = loadCommittedRegistry(); mutate(registry);
      fs.writeFileSync(registryFile, JSON.stringify(registry));
      for (const command of ['validate', 'status', 'qualify', 'up']) check(name, [command, ...(['qualify', 'up'].includes(command) ? ['--resource', 'comet-source'] : []), '--registry', registryFile], 2);
    }
    for (const [name, value] of [['node-object', {}], ['node-null', null], ['node-array', []]]) {
      const registry = loadCommittedRegistry(); registry.resources[0].runtimeRequirement.node = value;
      fs.writeFileSync(registryFile, JSON.stringify(registry));
      for (const command of ['validate', 'status', 'qualify', 'up']) check(name, [command, ...(['qualify', 'up'].includes(command) ? ['--resource', 'comet-source'] : []), '--registry', registryFile], 2);
    }
    for (const value of [null, [], { reference: 'fixture', digest: { toString: null } }]) {
      const registry = loadCommittedRegistry(); registry.resources[0].image = value;
      fs.writeFileSync(registryFile, JSON.stringify(registry));
      check('image-shape', ['qualify', '--resource', 'comet-source', '--registry', registryFile], 2);
    }
    check('unknown-option', ['qualify', '--resource', 'comet-source', '--unknown', 'value'], 1);
    check('extra-positional', ['qualify', '--resource', 'comet-source', 'extra'], 1);
    check('irrelevant-readback-policy', ['readback', '--kind', 'github', '--policy', metadataFile], 1);
    check('missing-option-value', ['qualify', '--resource', 'comet-source', '--policy'], 1);
    check('duplicate-option', ['qualify', '--resource', 'comet-source', '--resource', 'comet-source'], 1);
    check('archive-missing', ['qualify', '--resource', 'comet-source', '--archive', path.join(harness.dir, 'missing')], 1);
    check('archive-directory', ['qualify', '--resource', 'comet-source', '--archive', harness.dir], 1);
    check('metadata-missing', ['qualify', '--resource', 'comet-source', '--npm-metadata', metadataFile], 1);
    for (const value of [null, [], { version: {} }, { integrity: [null] }, { license: {} }]) {
      fs.writeFileSync(metadataFile, JSON.stringify(value));
      check('metadata-shape', ['qualify', '--resource', 'comet-source', '--npm-metadata', metadataFile], 2);
    }
    fs.writeFileSync(metadataFile, JSON.stringify({ license: 'MIT' }));
    const incomplete = harness.run(['qualify', '--resource', 'outline-managed-collection', '--npm-metadata', metadataFile, '--json']);
    if (parseJsonOut(incomplete, 'incomplete metadata').categories.license.status !== 'UNVERIFIED') failures.push({ name: 'missing-bindings-verified-license' });
    harness.clear();
    const project = path.join(harness.dir, 'project');
    for (const file of ['tools/infra/registry.mjs', 'tools/infra/secret-refs.mjs', 'infra/delivery/qualification-policy.json', 'infra/delivery/secrets.refs.example.json']) {
      fs.mkdirSync(path.dirname(path.join(project, file)), { recursive: true });
      fs.copyFileSync(path.join(repoRoot, file), path.join(project, file));
    }
    fs.writeFileSync(path.join(project, 'package.json'), '{"type":"module"}');
    const registry = loadCommittedRegistry(); registry.resources[0].lockRef = 'fixture-lock.json';
    fs.writeFileSync(path.join(project, 'infra/delivery/registry.json'), JSON.stringify(registry));
    for (const lock of [null, [], { schemaVersion: 2 }, { source: [] }, { source: { sha256: { toString: null } } }, { package: { version: [] } }]) {
      fs.writeFileSync(path.join(project, 'fixture-lock.json'), JSON.stringify(lock));
      for (const command of ['qualify', 'up']) {
        const result = harness.run([command, '--resource', 'comet-source', '--json'], harness.bin, path.join(project, 'tools/infra/registry.mjs'));
        let report; try { report = JSON.parse(result.stdout); } catch { report = null; }
        if (result.status !== 2 || !report?.violations?.some((v) => v.code === 'EVIDENCE_INPUT_INVALID') || fs.existsSync(harness.marker)) failures.push({ name: 'lock-shape', exitCode: result.status, externalCli: fs.existsSync(harness.marker) });
        harness.clear();
      }
    }
    assert.equal(failures.length, 0, JSON.stringify({ failures: failures.length, samples: failures.slice(0, 10) }));
  } finally { harness.close(); }
});

test('registry rejects malformed reference catalogs before runtime observation in every command', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'infra-i01-refs-shape-'));
  try {
    const source = JSON.parse(fs.readFileSync(refsExamplePath, 'utf8'));
    const file = path.join(dir, 'refs.json');
    const marker = path.join(dir, 'external-cli-calls.txt');
    const bin = path.join(dir, 'bin');
    const empty = path.join(dir, 'empty');
    fs.mkdirSync(bin);
    fs.mkdirSync(empty);
    for (const name of ['npm', 'docker', 'tar', 'gh']) {
      fs.writeFileSync(path.join(bin, name), `#!${process.execPath}\nconst fs = require('node:fs');\nfs.appendFileSync(${JSON.stringify(marker)}, ${JSON.stringify(name + '\n')});\nprocess.stdout.write('10.0.0\\n');\n`, { mode: 0o700 });
    }
    const run = (command, commandPath) => spawnSync(process.execPath, [registryCli, command,
      ...(['qualify', 'up'].includes(command) ? ['--resource', 'comet-source'] : []), '--refs', file, '--json'], {
      cwd: repoRoot, encoding: 'utf8', timeout: RUN_TIMEOUT_MS, env: { ...process.env, PATH: commandPath },
    });
    fs.writeFileSync(file, JSON.stringify(source));
    const control = run('qualify', bin);
    assert.equal(control.status, 2);
    assert.ok(parseJsonOut(control, 'valid catalog control').runtime, 'valid qualification reaches runtime observation');
    assert.match(fs.readFileSync(marker, 'utf8'), /npm\ndocker\n/, 'the CLI tripwire must be active');
    fs.rmSync(marker);

    const cases = [
      ['catalog-null', null],
      ['refs-null', { ...source, refs: null }],
      ['refs-object', { ...source, refs: {} }],
      ['refs-string', { ...source, refs: 'not-an-array' }],
      ['null-first', { ...source, refs: [null, ...source.refs] }],
      ['null-last', { ...source, refs: [...source.refs, null] }],
    ];
    const failures = [];
    for (const [name, refs] of cases) {
      fs.writeFileSync(file, JSON.stringify(refs));
      for (const [pathMode, commandPath] of [['tripwire', bin], ['empty', empty]]) {
        for (const command of ['validate', 'status', 'qualify', 'up']) {
          const result = run(command, commandPath);
          let report;
          try { report = JSON.parse(result.stdout); } catch { report = null; }
          const issues = [];
          if (result.status !== 2) issues.push('not-verification-exit-2');
          if (!report || !violationCodes(report).includes('REFS_SCHEMA_INVALID')) issues.push('missing-structured-catalog-refusal');
          if (result.stderr) issues.push('unexpected-stderr');
          if (report?.runtime || report?.receipt?.runtime) issues.push('runtime-observed-before-refusal');
          if (fs.existsSync(marker)) issues.push('external-cli-called-before-refusal');
          if (issues.length) failures.push({ fixture: name, command, pathMode, exitCode: result.status, issues });
          fs.rmSync(marker, { force: true });
        }
      }
    }
    assert.deepEqual(failures, [], 'every malformed catalog must be rejected as JSON before external CLI access');

    fs.writeFileSync(file, '{broken JSON');
    for (const command of ['validate', 'status', 'qualify', 'up']) {
      const result = run(command, empty);
      assert.equal(result.status, 1, 'unparseable JSON retains invalid-input exit 1');
      assert.equal(result.stdout, '');
      assert.match(result.stderr, /refs catalog unreadable/);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('secret reference API denials never echo caller-supplied principal role or project paths', async () => {
  const { resolveSecretRef } = await import(secretRefsModuleUrl);
  const refsDoc = JSON.parse(fs.readFileSync(refsExamplePath, 'utf8'));
  const entry = refsDoc.refs.find((item) => item.ref === 'secret-ref:sdd-harness-pilot/outline-publisher');
  const base = { ref: entry.ref, principalId: entry.allowedPrincipals[0], role: entry.boundRole, project: 'sdd-harness-pilot', refsDoc };
  const failures = [];
  for (const prefix of ['Users', 'Volumes', 'home', 'root', 'private', 'var', 'usr', 'etc', 'opt', 'tmp']) {
    for (const field of ['principalId', 'role', 'project']) {
      const supplied = `/${prefix}/private-example/${field}`;
      try {
        resolveSecretRef({ ...base, [field]: supplied });
        failures.push({ prefix, field, issue: 'not-denied' });
      } catch (error) {
        const expected = field === 'project' ? 'CROSS_PROJECT_REF' : 'PRINCIPAL_NOT_AUTHORIZED';
        if (error.code !== expected) failures.push({ prefix, field, issue: 'wrong-code' });
        if (error.message.includes(supplied) || String(error).includes(supplied)) failures.push({ prefix, field, issue: 'caller-path-leaked' });
      }
    }
  }
  assert.deepEqual(failures, [], 'direct API denials must preserve codes without serializing caller paths');
});

test('registry admission rejects blank project/resource ownership and purpose', () => {
  const cases = [
    (r) => { r.project.owner = ''; },
    (r) => { r.resources[0].owner = ''; },
    (r) => { r.resources[0].purpose = '   '; },
  ];
  for (const mutate of cases) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'infra-i01-required-'));
    try {
      const registry = loadCommittedRegistry();
      mutate(registry);
      const file = path.join(dir, 'registry.json');
      fs.writeFileSync(file, JSON.stringify(registry));
      const result = runRegistry(['validate', '--registry', file, '--json']);
      assert.equal(result.status, 2, 'blank ownership or purpose must not validate');
      assert.equal(parseJsonOut(result, 'blank fields').ok, false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('qualification and up reject invalid registration through the same owner gate', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'infra-i01-admission-'));
  try {
    const registry = loadCommittedRegistry();
    registry.resources[0].owner = 'unregistered-owner';
    const file = path.join(dir, 'registry.json');
    fs.writeFileSync(file, JSON.stringify(registry));
    for (const command of ['qualify', 'up']) {
      const result = runRegistry([command, '--resource', 'comet-source', '--registry', file, '--json']);
      assert.equal(result.status, 2);
      const report = parseJsonOut(result, command);
      assert.ok(violationCodes(report).includes('UNKNOWN_OWNER'), `${command} must not bypass registry admission`);
      assert.equal(report.ready, false);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('registry rejection does not echo a credential-shaped value supplied as an owner', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'infra-i01-no-echo-'));
  try {
    const registry = loadCommittedRegistry();
    const fakeCredential = `ghp_${'A'.repeat(36)}`;
    registry.resources[0].owner = fakeCredential;
    const file = path.join(dir, 'registry.json');
    fs.writeFileSync(file, JSON.stringify(registry));
    const result = runRegistry(['validate', '--registry', file, '--json']);
    assert.equal(result.status, 2);
    assert.equal(result.stdout.includes(fakeCredential), false, 'rejection receipts must not expose rejected secrets');
    assert.ok(violationCodes(parseJsonOut(result, 'secret rejection')).includes('SECRET_PLAINTEXT_FORBIDDEN'));
    registry.project.github.owner = fakeCredential;
    fs.writeFileSync(file, JSON.stringify(registry));
    const invalidIdentity = runRegistry(['readback', '--kind', 'github', '--registry', file, '--json']);
    assert.equal(invalidIdentity.status, 1);
    assert.equal((invalidIdentity.stdout + invalidIdentity.stderr).includes(fakeCredential), false, 'input errors must not expose rejected secrets');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('qualification reports unavailable dependency executables as structured UNVERIFIED', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'infra-i01-no-tools-'));
  try {
    const result = spawnSync(process.execPath, [registryCli, 'qualify', '--resource', 'comet-source', '--registry', registryPath, '--json'], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: { ...process.env, PATH: dir },
    });
    assert.equal(result.status, 2);
    const receipt = parseJsonOut(result, 'missing executables');
    assert.equal(receipt.ready, false);
    assert.equal(receipt.runtime.containerDaemon.observed, false);
    assert.match(receipt.runtime.npm, /UNAVAILABLE/);
    assert.match(receipt.runtime.containerDaemon.reason, /ENOENT/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('secret reference resolution rejects missing purpose and ambiguous catalog bindings', async () => {
  const { resolveSecretRef } = await import(secretRefsModuleUrl);
  const source = JSON.parse(fs.readFileSync(refsExamplePath, 'utf8'));
  const ref = 'secret-ref:sdd-harness-pilot/outline-publisher';
  const original = source.refs.find((entry) => entry.ref === ref);
  const cases = [
    { code: 'REF_PURPOSE_MISSING', mutate: (doc) => { doc.refs.find((entry) => entry.ref === ref).purpose = '  '; } },
    { code: 'ROLE_REUSE', mutate: (doc) => { doc.refs.push({ ...original, boundRole: 'isolator' }); } },
    { code: 'REFS_SCHEMA_INVALID', mutate: (doc) => { doc.refs.push(null); } },
  ];
  for (const fixture of cases) {
    const refsDoc = structuredClone(source);
    fixture.mutate(refsDoc);
    assert.throws(
      () => resolveSecretRef({ ref, principalId: original.allowedPrincipals[0], role: original.boundRole, project: 'sdd-harness-pilot', refsDoc }),
      (error) => error.code === fixture.code,
      fixture.code,
    );
  }
});

test('registry lock references cannot traverse or follow symlinks outside the project', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'infra-i01-lock-scope-'));
  try {
    const root = path.join(dir, 'project');
    for (const relative of ['tools/infra/registry.mjs', 'tools/infra/secret-refs.mjs', 'infra/delivery/registry.json', 'infra/delivery/secrets.refs.example.json', 'infra/delivery/qualification-policy.json']) {
      fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
      fs.copyFileSync(path.join(repoRoot, relative), path.join(root, relative));
    }
    fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
    const outside = path.join(dir, 'outside.json');
    fs.writeFileSync(outside, '{"source":{"commit":"' + 'a'.repeat(40) + '"}}');
    fs.symlinkSync(outside, path.join(root, 'linked-lock.json'));
    fs.symlinkSync(dir, path.join(root, 'linked-parent'));
    fs.symlinkSync(path.join(dir, 'missing.json'), path.join(root, 'dangling-lock.json'));
    for (const lockRef of ['../outside.json', 'linked-lock.json', 'linked-parent/missing.json', 'dangling-lock.json']) {
      const registry = loadCommittedRegistry();
      registry.resources[0].lockRef = lockRef;
      const file = path.join(root, 'infra/delivery/registry.json');
      fs.writeFileSync(file, JSON.stringify(registry));
      const result = spawnSync(process.execPath, [path.join(root, 'tools/infra/registry.mjs'), 'validate', '--registry', file, '--json'], { cwd: root, encoding: 'utf8' });
      assert.equal(result.status, 2, `${lockRef} must not escape the registered project`);
      assert.ok(violationCodes(parseJsonOut(result, 'lock containment')).includes('LOCK_REF_NOT_CONTAINED'));
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('registry admission rejects missing identity and invalid resource collections as structured failures', () => {
  const cases = [
    (r) => { delete r.project.github; },
    (r) => { r.resources = []; },
    (r) => { r.resources = {}; },
    (r) => { r.project.authority.readbackStatus = 'ASSUMED'; },
  ];
  for (const mutate of cases) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'infra-i01-shape-'));
    try {
      const registry = loadCommittedRegistry();
      mutate(registry);
      const file = path.join(dir, 'registry.json');
      fs.writeFileSync(file, JSON.stringify(registry));
      const result = runRegistry(['validate', '--registry', file, '--json']);
      assert.equal(result.status, 2);
      assert.equal(parseJsonOut(result, 'registry shape').ok, false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('automatic cleanup remains refused when its destruction precondition is unverified', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'infra-i01-retention-'));
  try {
    const registry = loadCommittedRegistry();
    Object.assign(registry.resources[0].retention, {
      rpo: 'one hour', rto: 'four hours', retentionPeriod: 'one week', encryptionOwner: 'ql-wade',
      destructionPrecondition: 'UNVERIFIED', autoCleanupEnabled: true,
    });
    const file = path.join(dir, 'registry.json');
    for (const precondition of ['UNVERIFIED', ' UNVERIFIED ']) {
      registry.resources[0].retention.destructionPrecondition = precondition;
      fs.writeFileSync(file, JSON.stringify(registry));
      const result = runRegistry(['validate', '--registry', file, '--json']);
      assert.equal(result.status, 2, 'whitespace must not turn an unverified destruction precondition into authority');
      const violation = parseJsonOut(result, 'retention').violations.find((v) => v.code === 'AUTO_CLEANUP_WITHOUT_CONFIRMED_RECOVERY');
      assert.ok(violation?.unconfirmed.includes('destructionPrecondition'));
    }
    registry.resources[0].retention.destructionPrecondition = 'explicit owner approval';
    registry.resources[0].retention.rpo = {};
    fs.writeFileSync(file, JSON.stringify(registry));
    const invalidType = runRegistry(['validate', '--registry', file, '--json']);
    assert.equal(invalidType.status, 2, 'a non-string recovery field must not count as confirmed');
    assert.ok(parseJsonOut(invalidType, 'retention type').violations.some((v) => v.code === 'REGISTRY_TYPE_INVALID' && v.field === 'retention.rpo'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('resource qualification does not claim absent source pins as recorded', () => {
  const result = runRegistry(['qualify', '--resource', 'outline-managed-collection', '--registry', registryPath, '--json']);
  assert.equal(result.status, 2);
  const report = parseJsonOut(result, 'service source pins');
  assert.equal(report.categories['source-commit'].status, 'UNVERIFIED');
  assert.equal(report.categories['source-digest'].status, 'UNVERIFIED');
  assert.equal(report.categories['artifact-size'].status, 'UNVERIFIED');
  assert.equal(report.ready, false);
});

test('qualification input binding changes with the actual reference catalog or policy', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'infra-i01-inputs-'));
  try {
    const base = parseJsonOut(runRegistry(['qualify', '--resource', 'comet-source', '--json']), 'base qualification');
    const refs = JSON.parse(fs.readFileSync(refsExamplePath, 'utf8'));
    refs.refs[0].purpose += ' (qualified read-only purpose revision)';
    const refsFile = path.join(dir, 'refs.json');
    fs.writeFileSync(refsFile, JSON.stringify(refs));
    const withRefs = parseJsonOut(runRegistry(['qualify', '--resource', 'comet-source', '--refs', refsFile, '--json']), 'reference revision');
    assert.notEqual(base.inputs.refsSha256, withRefs.inputs.refsSha256);
    assert.equal(base.inputs.registrySha256, withRefs.inputs.registrySha256);

    const policy = JSON.parse(fs.readFileSync(path.join(repoRoot, 'infra/delivery/qualification-policy.json'), 'utf8'));
    policy.note = 'qualification input revision';
    const policyFile = path.join(dir, 'policy.json');
    fs.writeFileSync(policyFile, JSON.stringify(policy));
    const withPolicy = parseJsonOut(runRegistry(['qualify', '--resource', 'comet-source', '--policy', policyFile, '--json']), 'policy revision');
    assert.notEqual(base.inputs.policySha256, withPolicy.inputs.policySha256);
    assert.equal(base.inputs.registrySha256, withPolicy.inputs.registrySha256);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

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

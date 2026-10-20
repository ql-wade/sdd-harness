import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  computeFullInputBaseline,
  digestInputs,
  taskDefinitionDigest,
  traceAcToCases,
  requireImplementationBaselines,
  REQUIRED_IMPLEMENTATION_BASELINES,
  invalidateOnScopeChange,
  verifyReportCurrency,
} from '../lib/delivery/baseline.js';

function makeProject(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-p21-baseline-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return root;
}

const DEMO_FILES = {
  'src/app.js': 'export const app = () => 1;\n',
  'src/Main.java': 'class Main { int id; }\n',
  'service.py': 'def main():\n    pass\n',
  'test/app.test.js': 'import test from "node:test";\ntest("app", () => {});\n',
  'package-lock.json': '{"lockfileVersion": 3}\n',
  'migrations/001_init.sql': 'CREATE TABLE t(id int);\n',
  'deploy/app.yaml': 'replicas: 1\n',
};

const DEMO_MANIFEST = {
  sources: ['src/app.js', 'src/Main.java', 'service.py'],
  tests: ['test/app.test.js'],
  lockfiles: ['package-lock.json'],
  migrations: ['migrations/001_init.sql'],
  deployConfigs: ['deploy/app.yaml'],
  artifacts: [],
};

test('full-input baseline binds code, tests, lockfiles, migrations, deploy configs and non-JS inputs into one digest', () => {
  const root = makeProject(DEMO_FILES);
  const baseline = computeFullInputBaseline({ root, manifest: DEMO_MANIFEST });
  assert.equal(baseline.ok, true);
  assert.match(baseline.digest, /^[a-f0-9]{64}$/);
  assert.equal(baseline.files.length, 7);
  const paths = baseline.files.map((f) => f.path);
  for (const nonJs of ['src/Main.java', 'service.py', 'migrations/001_init.sql', 'deploy/app.yaml', 'package-lock.json']) {
    assert.ok(paths.includes(nonJs), `full-input baseline must include ${nonJs}`);
  }
});

test('A08: non-JS drift (Java, Python, deploy config) changes the full-input digest', () => {
  const root = makeProject(DEMO_FILES);
  const first = computeFullInputBaseline({ root, manifest: DEMO_MANIFEST }).digest;

  fs.writeFileSync(path.join(root, 'src/Main.java'), 'class Main { int id; String name; }\n');
  const afterJava = computeFullInputBaseline({ root, manifest: DEMO_MANIFEST }).digest;
  assert.notEqual(afterJava, first, 'a Java source change must change the full-input digest');

  fs.writeFileSync(path.join(root, 'service.py'), 'def main():\n    return 1\n');
  const afterPython = computeFullInputBaseline({ root, manifest: DEMO_MANIFEST }).digest;
  assert.notEqual(afterPython, first, 'a Python source change must change the full-input digest');
  assert.notEqual(afterPython, afterJava);

  fs.writeFileSync(path.join(root, 'deploy/app.yaml'), 'replicas: 3\n');
  const afterDeploy = computeFullInputBaseline({ root, manifest: DEMO_MANIFEST }).digest;
  assert.notEqual(afterDeploy, first, 'a deploy config change must change the full-input digest');
});

test('migration drift changes the full-input digest (2.1.b)', () => {
  const root = makeProject(DEMO_FILES);
  const first = computeFullInputBaseline({ root, manifest: DEMO_MANIFEST }).digest;
  fs.writeFileSync(path.join(root, 'migrations/001_init.sql'), 'CREATE TABLE t(id int, name text);\n');
  const second = computeFullInputBaseline({ root, manifest: DEMO_MANIFEST }).digest;
  assert.notEqual(second, first);
});

test('missing declared lockfile is an explicit scope error, never a silent pass (2.1.b)', () => {
  const root = makeProject({
    'src/app.js': 'export const app = () => 1;\n',
  });
  const baseline = computeFullInputBaseline({
    root,
    manifest: { ...DEMO_MANIFEST },
  });
  assert.equal(baseline.ok, false);
  assert.equal(baseline.error, 'MISSING_INPUT');
  assert.deepEqual(baseline.missing, ['deploy/app.yaml', 'migrations/001_init.sql', 'package-lock.json', 'service.py', 'src/Main.java', 'test/app.test.js']);
  assert.match(baseline.reason, /package-lock\.json/);
});

test('task definition digest separates the frozen definition from progress checkboxes (2.1.b)', () => {
  const definition = '**Step 1 [5 min]: Test** 2.1.a 定义共享契约及版本：先实际复现失败并保存日志';
  const unchecked = `- [ ] ${definition}`;
  const checked = `- [x] ${definition}`;
  assert.equal(taskDefinitionDigest(unchecked), taskDefinitionDigest(checked), 'checkbox state must not change the definition digest');
  const edited = `- [x] **Step 1 [5 min]: Test** 2.1.a 定义共享契约及错误边界：先实际复现失败并保存日志`;
  assert.notEqual(taskDefinitionDigest(checked), taskDefinitionDigest(edited), 'a definition text change must change the digest');
});

test('AC-to-case traceability reports the exact missing acceptance mappings (2.1.b)', () => {
  const testContract = {
    cases: [
      { id: 'c1', ac: 'A01', oracle: 'missing baselines listed' },
      { id: 'c2', ac: 'A01', oracle: 'second A01 case' },
    ],
  };
  const partial = traceAcToCases({ acceptanceIds: ['A01', 'A02', 'A07'], testContract });
  assert.equal(partial.ok, false);
  assert.deepEqual(partial.missing.map((m) => m.ac), ['A02', 'A07']);
  assert.match(partial.missing[0].reason, /no case mapped to acceptance A02/);
  assert.deepEqual(partial.mapped, [{ ac: 'A01', cases: ['c1', 'c2'] }]);
  const full = traceAcToCases({ acceptanceIds: ['A01'], testContract });
  assert.equal(full.ok, true);
  assert.deepEqual(full.missing, []);
});

test('A01: implementation dispatch is refused with the missing baseline list', () => {
  assert.deepEqual(REQUIRED_IMPLEMENTATION_BASELINES, ['product', 'design', 'usecase']);
  const productOnly = requireImplementationBaselines({
    baselines: [{ kind: 'product', revision: 'r1', digest: 'a'.repeat(64) }],
  });
  assert.equal(productOnly.ok, false);
  assert.deepEqual(productOnly.missing, ['design', 'usecase']);
  assert.match(productOnly.reason, /design, usecase/);

  const complete = requireImplementationBaselines({
    baselines: [
      { kind: 'product', revision: 'r1', digest: 'a'.repeat(64) },
      { kind: 'design', revision: 'r1', digest: 'b'.repeat(64) },
      { kind: 'usecase', revision: 'r1', digest: 'c'.repeat(64) },
    ],
  });
  assert.equal(complete.ok, true);
  assert.deepEqual(complete.missing, []);
});

test('A02: scope change invalidates related downstream receipts and old approvals, keeps unrelated ones', () => {
  const OLD = 'a'.repeat(64);
  const NEW = 'b'.repeat(64);
  const changed = { kind: 'product', digest: NEW, revision: 'r2' };
  const receipts = [
    { id: 'evidence-1', boundDigests: { product: OLD } },
    { id: 'approval-1', boundDigests: { product: OLD } },
    { id: 'evidence-design-only', boundDigests: { design: 'c'.repeat(64) } },
  ];
  const result = invalidateOnScopeChange({ changed, receipts });
  assert.deepEqual(result.invalidated.map((r) => r.id), ['evidence-1', 'approval-1']);
  assert.match(result.invalidated[0].reason, /product/);
  assert.match(result.invalidated[0].reason, /does not match current digest/);
  assert.deepEqual(result.valid.map((r) => r.id), ['evidence-design-only'], 'unrelated downstream receipts must stay valid');

  const revisionDrift = invalidateOnScopeChange({
    changed,
    receipts: [{ id: 'evidence-same-digest', boundDigests: { product: NEW }, boundRevisions: { product: 'r1' } }],
  });
  assert.equal(revisionDrift.invalidated.length, 1);
  assert.match(revisionDrift.invalidated[0].reason, /revision r1 does not match current revision r2/);

  const current = invalidateOnScopeChange({
    changed,
    receipts: [{ id: 'evidence-current', boundDigests: { product: NEW }, boundRevisions: { product: 'r2' } }],
  });
  assert.deepEqual(current.invalidated, []);
  assert.deepEqual(current.valid.map((r) => r.id), ['evidence-current']);
});

test('A07: a passed report is refused after inputs change and accepted while current', () => {
  const root = makeProject(DEMO_FILES);
  const first = computeFullInputBaseline({ root, manifest: DEMO_MANIFEST });
  const report = { id: 'report-1', inputDigest: first.digest };
  assert.equal(verifyReportCurrency({ report, currentDigest: first.digest }).ok, true);

  fs.writeFileSync(path.join(root, 'package-lock.json'), '{"lockfileVersion": 3, "patched": true}\n');
  const second = computeFullInputBaseline({ root, manifest: DEMO_MANIFEST });
  const reused = verifyReportCurrency({ report, currentDigest: second.digest });
  assert.equal(reused.ok, false);
  assert.equal(reused.error, 'DIGEST_MISMATCH');
  assert.equal(reused.boundDigest, first.digest);
  assert.equal(reused.currentDigest, second.digest);
  assert.match(reused.reason, /report bound to input digest/);
});

test('digestInputs is order-independent and binds every entry', () => {
  const e1 = [{ path: 'a.js', group: 'sources', sha256: '1'.repeat(64) }, { path: 'b.js', group: 'sources', sha256: '2'.repeat(64) }];
  const e2 = [e1[1], e1[0]];
  assert.equal(digestInputs(e1), digestInputs(e2));
  const mutated = [{ path: 'a.js', group: 'sources', sha256: '3'.repeat(64) }, e1[1]];
  assert.notEqual(digestInputs(mutated), digestInputs(e1));
});

test('digestInputs ordering is code-unit deterministic, not locale-dependent (nb-2)', () => {
  // 'B' is U+0042, 'a' is U+0061: code-unit order puts B.txt first, while ICU
  // collation (localeCompare) puts a.txt first on this host. The frozen
  // digest must follow code units, so pin the canonical serialization.
  assert.equal('B'.localeCompare('a') > 0, true, 'precondition: host collation differs from code-unit order');
  const lower = { path: 'a.txt', group: 'sources', sha256: '1'.repeat(64) };
  const upper = { path: 'B.txt', group: 'sources', sha256: '2'.repeat(64) };
  assert.equal(digestInputs([lower, upper]), digestInputs([upper, lower]));
  const canonical = [upper, lower]
    .map((entry) => `${entry.group}\u0000${entry.path}\u0000${entry.sha256}`)
    .join('\n');
  const expected = crypto.createHash('sha256').update(canonical).digest('hex');
  assert.equal(digestInputs([lower, upper]), expected, 'B.txt must precede a.txt by code unit');
});

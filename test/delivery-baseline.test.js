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
  normalizeTaskProgress,
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

test('A02: a new generation invalidates every older downstream receipt while current evidence remains usable', () => {
  const changed = { kind: 'product', digest: 'b'.repeat(64), revision: 'r2' };
  const result = invalidateOnScopeChange({ changed, currentGeneration: 2, receipts: [
    { id: 'architecture', generation: 1, boundDigests: { product: 'a'.repeat(64) } },
    { id: 'tests', generation: 1, boundDigests: { design: 'c'.repeat(64) } },
    { id: 'implementation', generation: 1 },
    { id: 'new-design-only', generation: 2, boundDigests: { design: 'c'.repeat(64) } },
    { id: 'new-product', generation: 2, boundDigests: { product: changed.digest }, boundRevisions: { product: 'r2' } },
  ] });
  assert.deepEqual(result.invalidated.map((r) => r.id), ['architecture', 'tests', 'implementation']);
  assert.deepEqual(result.valid.map((r) => r.id), ['new-design-only', 'new-product']);
  const drift = invalidateOnScopeChange({ changed, currentGeneration: 2, receipts: [
    { id: 'old-digest', generation: 2, boundDigests: { product: 'a'.repeat(64) } },
    { id: 'old-revision', generation: 2, boundDigests: { product: changed.digest }, boundRevisions: { product: 'r1' } },
  ] });
  assert.deepEqual(drift.invalidated.map((r) => r.id), ['old-digest', 'old-revision']);
});

test('A02 real-drift anchor: invalidation is driven by a digest recomputed from real file bytes, not a self-declared value (nb-3)', () => {
  const root = makeProject(DEMO_FILES);
  const first = computeFullInputBaseline({ root, manifest: DEMO_MANIFEST });
  assert.equal(first.ok, true);
  const receipt = { id: 'evidence-product', generation: 1, boundDigests: { product: first.digest } };
  const unchanged = invalidateOnScopeChange({
    changed: { kind: 'product', digest: first.digest, revision: 'r1' },
    currentGeneration: 1, receipts: [receipt],
  });
  assert.deepEqual(unchanged.invalidated, []);
  assert.deepEqual(unchanged.valid.map((r) => r.id), ['evidence-product']);

  fs.writeFileSync(path.join(root, 'migrations/001_init.sql'), 'CREATE TABLE t(id int, name text);\n');
  const second = computeFullInputBaseline({ root, manifest: DEMO_MANIFEST });
  assert.notEqual(second.digest, first.digest, 'precondition: the real migration drift moved the recomputed digest');
  const drifted = invalidateOnScopeChange({
    changed: { kind: 'product', digest: second.digest, revision: 'r2' },
    currentGeneration: 1, receipts: [receipt],
  });
  assert.deepEqual(drifted.valid, [], 'a receipt bound to the pre-drift recomputed digest must not survive the real scope change');
  assert.deepEqual(drifted.invalidated.map((r) => r.id), ['evidence-product']);
  assert.match(drifted.invalidated[0].reason, /does not match current digest/);
});

test('A07: a passed report is refused after inputs change and accepted while current', () => {
  const root = makeProject(DEMO_FILES);
  const first = computeFullInputBaseline({ root, manifest: DEMO_MANIFEST });
  const report = { id: 'report-1', inputDigest: first.digest, generation: 1 };
  assert.equal(verifyReportCurrency({ report, currentDigest: first.digest, currentGeneration: 1 }).ok, true);

  fs.writeFileSync(path.join(root, 'package-lock.json'), '{"lockfileVersion": 3, "patched": true}\n');
  const second = computeFullInputBaseline({ root, manifest: DEMO_MANIFEST });
  const reused = verifyReportCurrency({ report, currentDigest: second.digest, currentGeneration: 2 });
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

test('declared design, test intent, method, policy and environment files all invalidate a current report', () => {
  const names = { designs: 'design.md', testIntents: 'cases.md', methods: 'method.md', policies: 'policy.json', environments: 'environment.json' };
  const root = makeProject(Object.fromEntries(Object.values(names).map((p) => [p, 'revision1'])));
  try {
    const manifest = Object.fromEntries(Object.entries(names).map(([g, p]) => [g, [p]]));
    let prior = computeFullInputBaseline({ root, manifest });
    assert.equal(prior.ok, true);
    for (const p of Object.values(names)) {
      fs.writeFileSync(path.join(root, p), 'revision2');
      const current = computeFullInputBaseline({ root, manifest });
      assert.equal(current.ok, true);
      assert.notEqual(current.digest, prior.digest, p);
      assert.equal(verifyReportCurrency({ report: { id: 'old', inputDigest: prior.digest }, currentDigest: current.digest }).ok, false);
      prior = current;
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a baseline refuses unknown, empty, malformed and escaping manifest scope instead of hashing an empty or outside input set', () => {
  const root = makeProject({ 'input.txt': 'declared' });
  const outside = makeProject({ 'private.txt': 'must not be read' });
  try {
    fs.symlinkSync(path.join(outside, 'private.txt'), path.join(root, 'linked.txt'));
    for (const manifest of [{}, { typoMethods: ['input.txt'] }, { sources: 'input.txt' }, { sources: [path.join(outside, 'private.txt')] }, { sources: ['../escape'] }, { sources: ['linked.txt'] }]) {
      const result = computeFullInputBaseline({ root, manifest });
      assert.equal(result.ok, false, JSON.stringify(manifest));
      assert.equal(result.digest, undefined);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); }
});

test('only actual Markdown progress markers are normalized, never prose or fenced code checkbox literals', () => {
  assert.equal(taskDefinitionDigest('- [ ] task\r\n'), taskDefinitionDigest('- [x] task\n'));
  for (const [a, b] of [['literal [ ]', 'literal [x]'], ['```md\n- [ ] example\n```\n', '```md\n- [x] example\n```\n'], ['~~~\n- [ ] example\n~~~\n', '~~~\n- [X] example\n~~~\n']]) {
    assert.notEqual(taskDefinitionDigest(a), taskDefinitionDigest(b));
  }
});

test('declared baseline kinds without current version/content identity do not authorize implementation', () => {
  const baselines = REQUIRED_IMPLEMENTATION_BASELINES.map((kind) => ({ kind }));
  assert.equal(requireImplementationBaselines({ baselines }).ok, false);
  const invalidCurrent = baselines.map((b) => ({ ...b, revision: 'r1', digest: 'not-a-digest' }));
  assert.equal(requireImplementationBaselines({ baselines: invalidCurrent }).ok, false);
  assert.equal(verifyReportCurrency({ report: { id: 'missing' }, currentDigest: undefined }).ok, false);
});

test('required case/oracle/command trace rejects duplicates, missing commands and dangling check links', () => {
  const contract = {
    cases: [{ id: 'c1', ac: 'A01', oracle: 'persisted result matches expected', checkIds: ['v1'] }],
    requiredChecks: [{ id: 'v1', level: 'unit', capability: 'node:test', command: 'node --test test/feature.test.js', caseIds: ['c1'] }],
  };
  assert.equal(traceAcToCases({ acceptanceIds: ['A01'], testContract: contract, requireCommands: true }).ok, true);
  for (const mutate of [
    (c) => { c.cases[0].oracle = ' '; },
    (c) => { c.requiredChecks[0].command = ''; },
    (c) => { c.requiredChecks[0].caseIds = ['absent']; },
    (c) => { c.cases[0].checkIds = ['absent']; },
    (c) => { c.cases.push({ ...c.cases[0] }); },
    (c) => { c.requiredChecks = []; },
  ]) {
    const changed = structuredClone(contract); mutate(changed);
    assert.equal(traceAcToCases({ acceptanceIds: ['A01'], testContract: changed, requireCommands: true }).ok, false);
  }
});

test('indented Markdown code remains input while genuine nested list progress is normalized', () => {
  for (const source of ['Example:\n\n    - [ ] payload\n', 'Example:\n\n\t- [ ] payload\n', '- parent\n\n      - [ ] payload\n', '- parent\n\nparagraph\n\n    - [ ] payload\n']) {
    assert.notEqual(taskDefinitionDigest(source), taskDefinitionDigest(source.replace('[ ]', '[x]')), source);
  }
  for (const source of ['- parent\n  - [ ] nested\n', '- parent\n    - [ ] nested\n', '- parent\n\t- [ ] nested\n', '1. parent\n   - [ ] nested\n']) {
    assert.equal(taskDefinitionDigest(source), taskDefinitionDigest(source.replace('[ ]', '[x]')), source);
  }
});

test('a fence marker followed by text cannot close a code block and hide changed code payload', () => {
  for (const source of ['```md\n```not-a-closing-fence\n- [ ] payload\n```\n', '~~~~\n~~~~text\n- [ ] payload\n~~~~\n', '````\n```\n- [ ] payload\n````\n', '```\n~~~\n- [ ] payload\n```\n']) {
    assert.notEqual(taskDefinitionDigest(source), taskDefinitionDigest(source.replace('[ ]', '[x]')), source);
  }
  const realTask = '```\n- [ ] code\n```   \n- [ ] task\n';
  assert.equal(taskDefinitionDigest(realTask), taskDefinitionDigest(realTask.replace('- [ ] task', '- [x] task')));
});

test('root fences end prior list context without discarding genuine nested-list context', () => {
  for (const source of ['- parent\n\n```\ncode\n```\n\n    - [ ] payload\n', '1. parent\n\n~~~\ncode\n~~~\n\n\t- [ ] payload\n']) {
    assert.notEqual(taskDefinitionDigest(source), taskDefinitionDigest(source.replace('[ ]', '[x]')), source);
  }
  const nested = '- parent\n\n  ```\n  code\n  ```\n    - [ ] nested\n';
  assert.equal(taskDefinitionDigest(nested), taskDefinitionDigest(nested.replace('[ ]', '[x]')));
});

test('CommonMark block membership protects overindented fence closes and HTML blocks', () => {
  for (const source of [
    '```\n    ```\n- [ ] payload\n```\n',
    '- parent\n  ```\n      ```\n  - [ ] payload\n  ```\n',
    '<!--\n- [ ] payload\n-->\n',
    '<script>\n- [ ] payload\n</script>\n',
    '<div>\n- [ ] payload\n</div>\n',
    '- intro\n\n  [ ] payload\n',
  ]) {
    assert.notEqual(taskDefinitionDigest(source), taskDefinitionDigest(source.replace('[ ]', '[x]')), source);
  }
  for (const source of ['> - [ ] quoted task\n', '1. [ ] ordered task\n', '```\ncode\n   ```\n- [ ] task\n']) {
    assert.equal(taskDefinitionDigest(source), taskDefinitionDigest(source.replace('[ ]', '[x]')), source);
  }
});


test('production AST normalization changes only located task characters, preserving all other source bytes', () => {
  const source = '> - [X] 中文 🧪  task\r\n\r\n<div>\r\n- [x] code\r\n</div>\r\n';
  const expected = source.replace('[X]', '[ ]');
  assert.equal(normalizeTaskProgress(source), expected);
  assert.equal(Buffer.byteLength(normalizeTaskProgress(source)), Buffer.byteLength(source));
  assert.equal(normalizeTaskProgress('- \\[x] escaped\n'), '- \\[x] escaped\n');
});

test('A02: old downstream evidence cannot revive when requirement bytes are restored at a newer generation', () => {
  const restored = { kind: 'product', digest: 'a'.repeat(64), revision: 'r3' };
  const result = invalidateOnScopeChange({ changed: restored, currentGeneration: 3, receipts: [
    { id: 'old-architecture', generation: 1, boundDigests: { product: restored.digest }, boundRevisions: { product: 'r1' } },
    { id: 'old-test', generation: 1, boundDigests: { design: 'b'.repeat(64) } },
    { id: 'new-test', generation: 3, boundDigests: { product: restored.digest }, boundRevisions: { product: 'r3' } },
  ] });
  assert.deepEqual(result.invalidated.map((r) => r.id), ['old-architecture', 'old-test']);
  assert.deepEqual(result.valid.map((r) => r.id), ['new-test']);
});

test('A02: missing or malformed generation and changed baseline fail closed, including legacy calls', () => {
  const changed = { kind: 'design', digest: 'd'.repeat(64), revision: 4 };
  const receipt = { id: 'test', generation: 4, boundDigests: { design: changed.digest }, boundRevisions: { design: 4 } };
  for (const input of [
    { changed, receipts: [receipt] },
    { changed, currentGeneration: -1, receipts: [receipt] },
    { changed, currentGeneration: '4', receipts: [receipt] },
    { changed, currentGeneration: 4, receipts: [{ id: 'legacy', boundDigests: { design: changed.digest } }] },
    { changed, currentGeneration: 4, receipts: [{ ...receipt, generation: '4' }] },
    { currentGeneration: 4, receipts: [receipt] },
    { changed: { ...changed, digest: undefined }, currentGeneration: 4, receipts: [receipt] },
  ]) {
    const verdict = invalidateOnScopeChange(input);
    assert.equal(verdict.invalidated.length, 1);
    assert.deepEqual(verdict.valid, []);
  }
});

test('A02: requirement and design changes expire architecture, tests and implementation across generation advances', () => {
  for (const kind of ['product', 'design']) {
    const changed = { kind, digest: 'e'.repeat(64), revision: 3 };
    const all = ['architecture', 'test-design', 'test-results', 'implementation'].map(id => ({ id, generation: 1 }));
    const current = { id: 'fresh', generation: 3, boundDigests: { unrelated: 'f'.repeat(64) } };
    const result = invalidateOnScopeChange({ changed, currentGeneration: 3, receipts: [...all, current] });
    assert.deepEqual(result.invalidated.map(x => x.id), all.map(x => x.id));
    assert.deepEqual(result.valid.map(x => x.id), ['fresh']);
  }
});

test('A07: restoring old input bytes cannot revive a report from an earlier generation', () => {
  const root = makeProject({ 'requirements.txt': 'first' });
  const manifest = { artifacts: ['requirements.txt'] };
  const first = computeFullInputBaseline({ root, manifest });
  const file = path.join(root, 'requirements.txt');
  fs.writeFileSync(file, 'second');
  assert.notEqual(computeFullInputBaseline({ root, manifest }).digest, first.digest);
  fs.writeFileSync(file, 'first');
  const restored = computeFullInputBaseline({ root, manifest });
  assert.equal(restored.digest, first.digest);
  const report = { id: 'old', inputDigest: first.digest, generation: 1 };
  const verdict = verifyReportCurrency({ report, currentDigest: restored.digest, currentGeneration: 3 });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.error, 'GENERATION_MISMATCH');
  assert.equal(verifyReportCurrency({ report: { ...report, generation: 3 }, currentDigest: restored.digest, currentGeneration: 3 }).ok, true);
});

test('A07: missing or malformed generation fails closed, including legacy report calls', () => {
  const digest = 'a'.repeat(64);
  const report = { id: 'report', inputDigest: digest, generation: 4 };
  for (const params of [
    { report, currentDigest: digest },
    { report, currentDigest: digest, currentGeneration: -1 },
    { report, currentDigest: digest, currentGeneration: '4' },
    { report: { id: 'legacy', inputDigest: digest }, currentDigest: digest, currentGeneration: 4 },
    { report: { ...report, generation: '4' }, currentDigest: digest, currentGeneration: 4 },
  ]) {
    const verdict = verifyReportCurrency(params);
    assert.equal(verdict.ok, false);
    assert.equal(verdict.error, 'GENERATION_MISMATCH');
  }
});

test('A02: a receipt that declares a stale revision is rejected even if it omits that digest', () => {
  const changed = { kind: 'design', digest: 'd'.repeat(64), revision: 2 };
  const result = invalidateOnScopeChange({ changed, currentGeneration: 2, receipts: [
    { id: 'stale-revision', generation: 2, boundRevisions: { design: 1 } },
  ] });
  assert.deepEqual(result.valid, []);
  assert.deepEqual(result.invalidated.map(r => r.id), ['stale-revision']);
});

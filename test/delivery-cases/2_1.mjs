// P2_1 delivery case: shared contract schemas with explicit version/compat
// boundaries, full-input baseline binding (code, tests, lockfiles, migrations,
// deploy configs including non-JS inputs), frozen task-definition digests
// separate from progress checkboxes, AC-to-case traceability, and the
// valid-RED / execution-denominator rules that refuse zero-test, all-skip and
// environment-crash runs. Covers V_A01/V_A02/V_A03/V_A04/V_A07/V_A08 by
// executing real node --test processes where execution counts are the oracle.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { parseContract } = await import(path.join(projectRoot, 'contracts/delivery/index.js'));
const {
  computeFullInputBaseline,
  taskDefinitionDigest,
  requireImplementationBaselines,
  invalidateOnScopeChange,
  verifyReportCurrency,
  traceAcToCases,
} = await import(path.join(projectRoot, 'lib/delivery/baseline.js'));
const {
  classifyRunOutcome,
  evaluateExecution,
  parseTapSummary,
  requireValidRed,
} = await import(path.join(projectRoot, 'lib/delivery/test-contract.js'));

const sha = (label) => crypto.createHash('sha256').update(label).digest('hex');

function makeProject(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-p21-case-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return root;
}

function baselineRef(kind, digest) {
  return {
    schemaVersion: 1,
    project: 'sdd-harness',
    change: 'delivery-foundation-rearchitecture',
    kind,
    revision: 'r1',
    digest,
    confirmedBy: 'product-owner',
    confirmationScope: 'AC A01-A08',
  };
}

const TEST_CONTRACT = {
  schemaVersion: 1,
  project: 'sdd-harness',
  change: 'delivery-foundation-rearchitecture',
  cases: [{ id: 'c1', ac: 'A03', oracle: 'TAP summary reports at least one executed assertion' }],
  requiredChecks: [{ level: 'unit', capability: 'node:test' }],
  executionDenominator: { totalCases: 1 },
  cleanup: { environment: 'temp dir removed after run', data: 'none persisted' },
  dependencyBaselines: [{ kind: 'product', digest: sha('product-r1') }],
};

function runNodeTest(root, target) {
  // Inside a node --test child, NODE_TEST_CONTEXT=child-v8 makes a nested
  // node --test skip running files entirely (exit 0, no TAP output). Strip it
  // so the spawned run is a real top-level execution.
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, ['--test', '--test-reporter=tap', target], { cwd: root, encoding: 'utf8', timeout: 60000, env });
}

test('V_A01: implementation dispatch without product/design/usecase baselines is refused with the missing list', () => {
  const product = parseContract('SDD.Delivery.BaselineRef', baselineRef('product', sha('product-r1')));
  assert.equal(product.ok, true, 'the baseline contract schema itself must parse');
  const refused = requireImplementationBaselines({ baselines: [product.value] });
  assert.equal(refused.ok, false);
  assert.deepEqual(refused.missing, ['design', 'usecase']);

  const baselines = ['product', 'design', 'usecase'].map((kind) => {
    const parsed = parseContract('SDD.Delivery.BaselineRef', baselineRef(kind, sha(`${kind}-r1`)));
    assert.equal(parsed.ok, true, `${kind} baseline must parse as SDD.Delivery.BaselineRef v1`);
    return parsed.value;
  });
  const accepted = requireImplementationBaselines({ baselines });
  assert.equal(accepted.ok, true);
});

test('V_A02: AC/scope change invalidates bound downstream receipts and old approvals only', () => {
  const OLD = sha('product-r1');
  const NEW = sha('product-r2');
  const changed = { kind: 'product', digest: NEW, revision: 'r2' };
  const result = invalidateOnScopeChange({
    changed,
    receipts: [
      { id: 'gate-receipt-1', boundDigests: { product: OLD } },
      { id: 'approval-ac-1', boundDigests: { product: OLD } },
      { id: 'evidence-design-bound', boundDigests: { design: sha('design-r1') } },
    ],
  });
  assert.deepEqual(result.invalidated.map((r) => r.id), ['gate-receipt-1', 'approval-ac-1']);
  assert.deepEqual(result.valid.map((r) => r.id), ['evidence-design-bound']);
});

test('V_A03: zero-test and all-skip runs are invalid executions for acceptance (real node --test)', () => {
  const zeroRoot = makeProject({ 'app.js': 'export const app = () => 1;\n' });
  const zeroRun = runNodeTest(zeroRoot, '**/*.no-such-tests.test.js');
  assert.equal(zeroRun.status, 0, 'precondition: the naive exit-code gate would treat this as pass');
  const zeroSummary = parseTapSummary(zeroRun.stdout);
  assert.equal(zeroSummary.tests, 0, 'real executed count must be read back as zero');
  const zeroVerdict = evaluateExecution({ testContract: TEST_CONTRACT, run: { exitCode: zeroRun.status, output: zeroRun.stdout } });
  assert.equal(zeroVerdict.verdict, 'reject');
  assert.match(zeroVerdict.reasons.join('\n'), /zero tests executed/);

  const skipRoot = makeProject({
    'skip.test.js': [
      "import test from 'node:test';",
      "test('skipped A', { skip: 'environment not provisioned' }, () => {});",
      "test('skipped B', { skip: true }, () => {});",
      '',
    ].join('\n'),
  });
  const skipRun = runNodeTest(skipRoot, 'skip.test.js');
  assert.equal(skipRun.status, 0, 'precondition: all-skip exits zero today');
  const skipSummary = parseTapSummary(skipRun.stdout);
  assert.equal(skipSummary.tests, 2);
  assert.equal(skipSummary.skipped, 2, 'real skipped count must be visible');
  assert.equal(skipSummary.pass + skipSummary.fail, 0);
  const skipVerdict = evaluateExecution({ testContract: TEST_CONTRACT, run: { exitCode: skipRun.status, output: skipRun.stdout } });
  assert.equal(skipVerdict.verdict, 'reject');
  assert.match(skipVerdict.reasons.join('\n'), /zero effective executions/);
});

test('V_A04: an environment crash is refused as behavior RED while a real assertion failure is a valid RED', () => {
  const envRoot = makeProject({
    'env.test.js': [
      "import test from 'node:test';",
      "import missing from 'definitely-missing-env-dependency-p21';",
      "test('never reached', () => {});",
      '',
    ].join('\n'),
  });
  const envRun = runNodeTest(envRoot, 'env.test.js');
  assert.notEqual(envRun.status, 0, 'precondition: the crash fails the command');
  const envOutcome = classifyRunOutcome({ exitCode: envRun.status, output: envRun.stdout });
  assert.equal(envOutcome.kind, 'environment-failure');
  const envRed = requireValidRed({ exitCode: envRun.status, output: envRun.stdout });
  assert.equal(envRed.ok, false, 'an environment failure must not be recorded as a behavior RED');
  assert.match(envRed.reason, /environment failure is not a valid behavior RED/);

  const redRoot = makeProject({
    'behavior.test.js': [
      "import assert from 'node:assert/strict';",
      "import test from 'node:test';",
      "test('behavior red: implementation deviates from oracle', () => {",
      '  assert.equal(1 + 1, 3, "oracle expects 3, implementation produces 2");',
      '});',
      '',
    ].join('\n'),
  });
  const redRun = runNodeTest(redRoot, 'behavior.test.js');
  assert.notEqual(redRun.status, 0);
  const redSummary = parseTapSummary(redRun.stdout);
  assert.ok(redSummary.tests > 0 && redSummary.fail > 0, 'the valid RED must carry a real executed count');
  const redVerdict = requireValidRed({ exitCode: redRun.status, output: redRun.stdout });
  assert.equal(redVerdict.ok, true);
  assert.equal(redVerdict.outcome.kind, 'behavior-red');
});

test('V_A07: a passed report cannot be reused after source, lockfile or migration inputs change', () => {
  const files = {
    'src/app.js': 'export const app = () => 1;\n',
    'package-lock.json': '{"lockfileVersion": 3}\n',
    'migrations/001_init.sql': 'CREATE TABLE t(id int);\n',
  };
  const manifest = { sources: ['src/app.js'], lockfiles: ['package-lock.json'], migrations: ['migrations/001_init.sql'] };
  const root = makeProject(files);
  const first = computeFullInputBaseline({ root, manifest });
  assert.equal(first.ok, true);
  const report = { id: 'report-1', inputDigest: first.digest };
  assert.equal(verifyReportCurrency({ report, currentDigest: first.digest }).ok, true);

  fs.writeFileSync(path.join(root, 'package-lock.json'), '{"lockfileVersion": 3, "changed": true}\n');
  const second = computeFullInputBaseline({ root, manifest });
  const reused = verifyReportCurrency({ report, currentDigest: second.digest });
  assert.equal(reused.ok, false, 'the old report must be refused after the lockfile changes');
  assert.equal(reused.error, 'DIGEST_MISMATCH');
  assert.equal(reused.currentDigest, second.digest);
});

test('V_A08: Java/Python/deploy drift changes the full-input digest and missing inputs are explicit scope errors', () => {
  const files = {
    'src/Main.java': 'class Main { int id; }\n',
    'service.py': 'def main():\n    pass\n',
    'deploy/app.yaml': 'replicas: 1\n',
    'package-lock.json': '{"lockfileVersion": 3}\n',
  };
  const manifest = { sources: ['src/Main.java', 'service.py'], deployConfigs: ['deploy/app.yaml'], lockfiles: ['package-lock.json'] };
  const root = makeProject(files);
  const first = computeFullInputBaseline({ root, manifest });
  assert.equal(first.ok, true);

  fs.writeFileSync(path.join(root, 'src/Main.java'), 'class Main { int id; String name; }\n');
  fs.appendFileSync(path.join(root, 'service.py'), 'def extra():\n    return 2\n');
  fs.writeFileSync(path.join(root, 'deploy/app.yaml'), 'replicas: 3\n');
  const second = computeFullInputBaseline({ root, manifest });
  assert.equal(second.ok, true);
  assert.notEqual(second.digest, first.digest, 'all relevant non-JS changes must move the full-input digest');

  fs.rmSync(path.join(root, 'deploy/app.yaml'));
  const brokenScope = computeFullInputBaseline({ root, manifest });
  assert.equal(brokenScope.ok, false);
  assert.equal(brokenScope.error, 'MISSING_INPUT');
  assert.deepEqual(brokenScope.missing, ['deploy/app.yaml'], 'the scope error must name the missing input');
});

test('frozen plan boundary: task definition digest ignores checkbox state in this change tasks.md', () => {
  const tasksPath = path.join(projectRoot, 'openspec/changes/delivery-foundation-rearchitecture/tasks.md');
  const tasksText = fs.readFileSync(tasksPath, 'utf8');
  const stepLine = tasksText.split('\n').find((line) => /\*\*Step 1 \[5 min\]: Test\*\* 零执行\/全skip/.test(line));
  assert.ok(stepLine, 'precondition: the tasks.md P2_1 definition line is present');
  // State-independent toggle: whatever the current checkbox state is (the
  // acceptance pass may already have ticked it), flip to the opposite state.
  const stateMatch = stepLine.match(/^- \[([ xX])\] /);
  assert.ok(stateMatch, 'precondition: the P2_1 Step 1 line carries a checkbox');
  const flipped = stateMatch[1] === ' ' ? 'x' : ' ';
  const toggledLine = stepLine.replace(/^- \[([ xX])\] /, `- [${flipped}] `);
  assert.notEqual(stepLine, toggledLine, 'precondition: the toggle really flipped the checkbox state');
  const toggled = tasksText.replace(stepLine, toggledLine);
  assert.equal(taskDefinitionDigest(tasksText), taskDefinitionDigest(toggled),
    'flipping a checkbox must not change the frozen definition digest');
  const edited = tasksText.replace(stepLine, stepLine.replace('零执行', '空执行'));
  assert.notEqual(taskDefinitionDigest(tasksText), taskDefinitionDigest(edited),
    'an edited definition must change the digest');
});

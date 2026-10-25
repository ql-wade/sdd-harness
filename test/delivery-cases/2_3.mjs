// P2_3 delivery case: the old evidence channel and the new delivery gate meet
// at one CLI. A REAL evidence-audit run (lib/evidence-audit.js over a real
// project on disk) is adapted by lib/adapters/legacy-evidence.js into a
// SDD.Delivery.EvidenceEnvelope, admitted through admitEvidence unchanged
// (launcher-issued dispatch), and judged by the real `sdd delivery-gate`
// command (pure SDD.Gate.v1) with the frozen exit-code contract:
//   0 = valid check executed and passed, 1 = invalid input/prerequisite,
//   2 = executed but acceptance failed (execution-contract.json cli_contract).
// B10: the delivery receipt declares only the layer that actually ran — the
// legacy report channel can never close a product capability. B07: missing
// fields / incompatible versions are refused explicitly. A20 (executable
// local half): the whole chain runs as plain node child processes under a
// scrubbed environment — no CodeGraph/RTK ambient tooling participates.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const cliPath = path.join(projectRoot, 'bin', 'cli.js');
const { parseContract } = await import(path.join(projectRoot, 'contracts/delivery/index.js'));
const { createLaunchAuthority } = await import(path.join(projectRoot, 'lib/delivery/evidence.js'));
const { auditEvidence } = await import(path.join(projectRoot, 'lib/evidence-audit.js'));

const shaBytes = (data) => crypto.createHash('sha256').update(data).digest('hex');
const sha = (label) => shaBytes(label);
const ENVIRONMENT = 'local-node-test-env';

const fixtureRoots = new Set();
after(() => { for (const root of fixtureRoots) fs.rmSync(root, { recursive: true, force: true }); });
function makeTmp(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), label));
  fixtureRoots.add(root);
  return root;
}

// A real project whose on-disk facts match its markdown claims: the old
// channel's audit genuinely passes against it.
function makeMatchingProject() {
  const root = makeTmp('sdd-p23-case-');
  const changeDir = path.join(root, 'openspec', 'changes', 'demo-change');
  const runsDir = path.join(root, '.sdd', 'runs', 'demo-change');
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.mkdirSync(changeDir, { recursive: true });
  fs.mkdirSync(runsDir, { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'main.ts'), 'export const main = 1;\n');
  fs.writeFileSync(path.join(root, 'src', 'main.test.ts'), 'import "node:test";\n');
  fs.writeFileSync(path.join(changeDir, 'progress.md'), '# Progress\n\nActual source files: 1\n');
  fs.writeFileSync(path.join(runsDir, 'review-notes.md'), '# Review\n\nNo open findings.\n');
  fs.writeFileSync(path.join(runsDir, 'npm-test.txt'), 'Test Files  1 passed (1)\n     Tests  1 passed (1)\n');
  return root;
}

async function realLegacyReport(root) {
  return auditEvidence({
    projectDir: root,
    change: 'demo-change',
    testOutputPath: path.join(root, '.sdd', 'runs', 'demo-change', 'npm-test.txt'),
  });
}

async function admittedEntryFrom(report, execution = 'exec-verifier-1') {
  const { admitLegacyReport } = await import(path.join(projectRoot, 'lib/adapters/legacy-evidence.js'));
  const launcher = createLaunchAuthority({ secret: crypto.randomBytes(32).toString('hex') });
  const admitted = admitLegacyReport({
    report,
    identity: { runnerId: 'runner-1', execution, environment: ENVIRONMENT },
    authority: launcher,
    current: {
      inputDigest: report.evidenceSha256.sourceTree,
      policyDigest: sha('policy/managed-pilot@r1'),
      environment: ENVIRONMENT,
    },
    dispatch: { role: 'verifier' },
  });
  assert.equal(admitted.ok, true, `precondition: the adapted legacy report must be admitted: ${admitted.reason ?? ''}`);
  return admitted.entry;
}

function writeGateInputs(dir, { contract, receipts }) {
  const write = (name, value) => {
    const p = path.join(dir, name);
    fs.writeFileSync(p, JSON.stringify(value, null, 2));
    return p;
  };
  return {
    contractPath: write('test-contract.json', contract),
    receiptsPath: write('receipts.json', receipts),
    policyPath: write('policy.json', { ref: 'policy/managed-pilot', digest: sha('policy/managed-pilot@r1') }),
  };
}

function contractFixture(overrides = {}) {
  return {
    schemaVersion: 1,
    project: 'sdd-harness',
    change: 'demo-change',
    cases: [{ id: 'c1', ac: 'B10', oracle: 'the delivery report declares only the evidence layer that actually ran' }],
    requiredChecks: [{ level: 'report', capability: 'report:evidence-audit:v1' }],
    executionDenominator: { totalCases: 1 },
    cleanup: { environment: 'temp dirs under os.tmpdir()', data: 'none persisted' },
    dependencyBaselines: [{ kind: 'product', digest: sha('product-r1') }],
    ...overrides,
  };
}

function runCli(args, { env } = {}) {
  // A20 executable half: by default the child gets a scrubbed environment
  // (PATH only) — the correctness chain must not depend on ambient tooling.
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: projectRoot,
    encoding: 'utf8',
    timeout: 60000,
    env: env ?? { PATH: process.env.PATH },
  });
}

test('2.3: a real old-channel report enters the new gate and a passing delivery check exits 0 with a schema-valid receipt (B10 layer honesty)', async () => {
  const root = makeMatchingProject();
  const report = await realLegacyReport(root);
  assert.equal(report.pass, true, 'precondition: the real old-channel audit passes against matching facts');
  const entry = await admittedEntryFrom(report);
  assert.equal(entry.envelope.check, 'report:evidence-audit:v1');
  assert.equal(entry.envelope.origin.kind, 'legacy-report', 'the envelope declares its true layer');

  const dir = makeTmp('sdd-p23-case-gate-');
  const { contractPath, receiptsPath, policyPath } = writeGateInputs(dir, {
    contract: contractFixture(),
    receipts: [entry],
  });
  const run = runCli(['delivery-gate', '--contract', contractPath, '--receipts', receiptsPath, '--policy', policyPath,
    '--input-digest', report.evidenceSha256.sourceTree, '--builder-execution', 'exec-builder-1', '--json']);
  assert.equal(run.status, 0, `valid check must exit 0: ${run.stderr || run.stdout}`);
  const out = JSON.parse(run.stdout);
  assert.equal(out.verdict, 'pass');
  const parsed = parseContract('SDD.Delivery.GateReceipt', out.receipt);
  assert.equal(parsed.ok, true, `the delivery receipt satisfies the frozen schema: ${parsed.errors?.join('; ') ?? ''}`);
  assert.deepEqual(out.receipt.blocked, []);
  assert.deepEqual(out.receipt.requiredDenominator, { required: 1, valid: 1 }, 'the report declares exactly the layer that ran');
  assert.equal(out.receipt.sourceAttestation.origin, 'runner-1');

  // Old channel does not regress: the same real project still audits green
  // through the existing evidence-audit command.
  const legacyRun = runCli(['evidence-audit', '--project', root, '--change', 'demo-change',
    '--test-output', path.join(root, '.sdd', 'runs', 'demo-change', 'npm-test.txt'), '--json'], { env: { ...process.env } });
  assert.equal(legacyRun.status, 0, `old CLI behavior must not regress: ${legacyRun.stderr || legacyRun.stdout}`);
  assert.equal(JSON.parse(legacyRun.stdout).pass, true);
});

test('2.3: the same legacy evidence cannot close a product capability — executed but blocked exits 2 (B10: no product-closure claim)', async () => {
  const root = makeMatchingProject();
  const report = await realLegacyReport(root);
  const entry = await admittedEntryFrom(report, 'exec-verifier-product');
  const dir = makeTmp('sdd-p23-case-block-');
  const { contractPath, receiptsPath, policyPath } = writeGateInputs(dir, {
    contract: contractFixture({ requiredChecks: [{ level: 'unit', capability: 'unit:node:test' }] }),
    receipts: [entry],
  });
  const run = runCli(['delivery-gate', '--contract', contractPath, '--receipts', receiptsPath, '--policy', policyPath,
    '--input-digest', report.evidenceSha256.sourceTree, '--builder-execution', 'exec-builder-1', '--json']);
  assert.equal(run.status, 2, `acceptance failure must exit 2: ${run.stderr || run.stdout}`);
  const out = JSON.parse(run.stdout);
  assert.equal(out.verdict, 'blocked');
  assert.match(out.receipt.blocked.join('\n'), /MISSING_OBSERVATION: required check unit\/unit:node:test/,
    'the old report layer never substitutes for the product check');
});

test('2.3: invalid inputs exit 1 at the task level — unreadable contract, schema-invalid contract, bad receipts (0/1/2 triple complete)', async () => {
  const root = makeMatchingProject();
  const report = await realLegacyReport(root);
  const entry = await admittedEntryFrom(report, 'exec-verifier-invalid');
  const dir = makeTmp('sdd-p23-case-bad-');
  const { contractPath, receiptsPath, policyPath } = writeGateInputs(dir, {
    contract: contractFixture(),
    receipts: [entry],
  });
  const base = ['delivery-gate', '--receipts', receiptsPath, '--policy', policyPath,
    '--input-digest', report.evidenceSha256.sourceTree, '--builder-execution', 'exec-builder-1', '--json'];

  const unreadable = runCli([...base.slice(0, 1), '--contract', path.join(dir, 'absent.json'), ...base.slice(2)]);
  assert.equal(unreadable.status, 1, `invalid input must exit 1: ${unreadable.stdout}`);

  const futureVersion = writeGateInputs(dir, { contract: contractFixture({ schemaVersion: 2 }), receipts: [entry] }).contractPath;
  const badContract = runCli([...base.slice(0, 1), '--contract', futureVersion, ...base.slice(2)]);
  assert.equal(badContract.status, 1, 'schema-invalid contract is invalid input, not a failed verification');

  const notArray = runCli(['delivery-gate', '--contract', contractPath, '--receipts', policyPath, '--policy', policyPath,
    '--input-digest', report.evidenceSha256.sourceTree, '--builder-execution', 'exec-builder-1', '--json']);
  assert.equal(notArray.status, 1, 'non-array receipts file is invalid input');
});

test('2.3 B07: an incompatible legacy report version is refused explicitly by the adapter — no field fabrication, no silent migration', async () => {
  const { adaptLegacyReport } = await import(path.join(projectRoot, 'lib/adapters/legacy-evidence.js'));
  const root = makeMatchingProject();
  const report = await realLegacyReport(root);
  const refused = adaptLegacyReport({ ...report, schemaVersion: 2 }, { runnerId: 'runner-1', execution: 'e', environment: ENVIRONMENT });
  assert.equal(refused.ok, false);
  assert.equal(refused.error, 'INCOMPATIBLE_VERSION');
  const missing = adaptLegacyReport({ ...report, evidenceSha256: undefined }, { runnerId: 'runner-1', execution: 'e', environment: ENVIRONMENT });
  assert.equal(missing.ok, false);
  assert.equal(missing.error, 'MISSING_FIELD');
});

test('2.3 A20 (executable half): the delivery gate chain runs correctly as plain node children under a scrubbed environment', async () => {
  const root = makeMatchingProject();
  const report = await realLegacyReport(root);
  const entry = await admittedEntryFrom(report, 'exec-verifier-a20');
  const dir = makeTmp('sdd-p23-case-a20-');
  const { contractPath, receiptsPath, policyPath } = writeGateInputs(dir, {
    contract: contractFixture(),
    receipts: [entry],
  });
  // The child inherits only PATH: no CodeGraph/RTK/agent-hook environment,
  // no shell profile, no ambient tool state — the frozen correctness contract
  // alone decides the verdict.
  const scrubbed = runCli(['delivery-gate', '--contract', contractPath, '--receipts', receiptsPath, '--policy', policyPath,
    '--input-digest', report.evidenceSha256.sourceTree, '--builder-execution', 'exec-builder-1', '--json'], { env: { PATH: process.env.PATH } });
  assert.equal(scrubbed.status, 0, `correctness protocol must hold with ambient tooling absent: ${scrubbed.stderr || scrubbed.stdout}`);
  assert.equal(JSON.parse(scrubbed.stdout).verdict, 'pass');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(root, { recursive: true, force: true });
});

test('2.3 A20 component: disabled CodeGraph and RTK do not substitute missing required evidence', async () => {
  const root = makeMatchingProject();
  const dir = makeTmp('sdd-p23-optional-off-');
  try {
    const bin = path.join(dir, 'disabled-tools'); fs.mkdirSync(bin);
    const marker = path.join(dir, 'optional-tool-called');
    for (const name of ['codegraph', 'code-graph', 'rtk']) {
      const target = path.join(bin, name);
      fs.writeFileSync(target, '#!/bin/sh\n/bin/echo called >> "' + marker + '"\nexit 97\n', { mode: 0o755 });
    }
    const report = await realLegacyReport(root);
    const entry = await admittedEntryFrom(report, 'exec-optional-off');
    const files = writeGateInputs(dir, { contract: contractFixture(), receipts: [entry] });
    const args = ['delivery-gate', '--contract', files.contractPath, '--receipts', files.receiptsPath, '--policy', files.policyPath,
      '--input-digest', report.evidenceSha256.sourceTree, '--builder-execution', 'builder', '--json'];
    const env = { PATH: bin, HOME: dir };
    const pass = runCli(args, { env });
    assert.equal(pass.status, 0, pass.stderr || pass.stdout);
    assert.equal(JSON.parse(pass.stdout).managedClosureEligible, false);
    fs.writeFileSync(files.contractPath, JSON.stringify(contractFixture({ requiredChecks: [{ level: 'unit', capability: 'unit:node:test' }] })));
    const missing = runCli(args, { env });
    assert.equal(missing.status, 2, missing.stderr || missing.stdout);
    assert.match(JSON.parse(missing.stdout).receipt.blocked.join('\n'), /MISSING_OBSERVATION/);
    assert.equal(fs.existsSync(marker), false, 'optional executables are neither prerequisites nor substitutes');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});

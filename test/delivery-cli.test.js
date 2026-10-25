// CLI exit-code contract (P2_3, A20/B10 boundary).
//
// Frozen contract (execution-contract.json cli_contract, all V_* checks):
//   0 = valid check executed and passed
//   1 = invalid input / missing prerequisite (nothing was meaningfully executed)
//   2 = the check executed but acceptance failed
//
// Covered here:
//   - the existing audit/gate commands keep their contract (existing commands
//     preserved) and the measured violations are fixed: a missing --project
//     directory and evidence-audit EVIDENCE_INPUT_MISSING are prerequisites,
//     not verification failures;
//   - the delivery gate check CLI (sdd delivery-gate): pure SDD.Gate.v1
//     evaluation over a frozen TestContract, admitted receipts and policy —
//     0 pass / 1 invalid inputs / 2 blocked verdict, JSON output;
//   - lib/adapters/legacy-evidence.js: the old evidence-audit report shape is
//     adapted into an EvidenceEnvelope and admitted through admitEvidence
//     unchanged; missing fields and incompatible versions are refused
//     explicitly (B07), and the adapted envelope declares its true layer
//     (kind 'legacy-report', check 'report:evidence-audit:v1') so it can
//     never claim real product closure (B10).
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliPath = path.join(repoRoot, 'bin', 'cli.js');

const sha = (label) => crypto.createHash('sha256').update(label).digest('hex');

const fixtureRoots = new Set();
after(() => { for (const root of fixtureRoots) fs.rmSync(root, { recursive: true, force: true }); });
function makeTmp(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), label));
  fixtureRoots.add(root);
  return root;
}

function makeProject({ progress = '', review = '', testOutput = '' } = {}) {
  const project = makeTmp('sdd-p23-cli-');
  const changeDir = path.join(project, 'openspec', 'changes', 'demo-change');
  const runsDir = path.join(project, '.sdd', 'runs', 'demo-change');
  fs.mkdirSync(path.join(project, 'src'), { recursive: true });
  fs.mkdirSync(changeDir, { recursive: true });
  fs.mkdirSync(runsDir, { recursive: true });
  fs.writeFileSync(path.join(project, 'src', 'main.ts'), 'export const main = 1;\n');
  fs.writeFileSync(path.join(project, 'src', 'util.ts'), 'export const util = 1;\n');
  fs.writeFileSync(path.join(project, 'src', 'main.test.ts'), 'import "node:test";\n');
  fs.writeFileSync(path.join(changeDir, 'progress.md'), progress);
  fs.writeFileSync(path.join(runsDir, 'review-notes.md'), review);
  const testOutputPath = path.join(runsDir, 'npm-test.txt');
  fs.writeFileSync(testOutputPath, testOutput);
  return { project, testOutputPath };
}

function runCli(args) {
  return spawnSync(process.execPath, [cliPath, ...args], { cwd: repoRoot, encoding: 'utf8', timeout: 60000 });
}

function parseJsonOut(run) {
  return JSON.parse(run.stdout);
}

// A real old-channel report shape (lib/evidence-audit.js auditEvidence output).
function legacyReportFixture(overrides = {}) {
  return {
    schemaVersion: 1,
    projectDir: 'demo-project',
    change: 'demo-change',
    run: 'demo-change',
    pass: true,
    actual: { sourceFiles: 2, testFiles: 1, packageScripts: { test: 'vitest run' } },
    commandOutput: { testsPassed: 3, testFilesPassed: 1 },
    evidenceFiles: { progress: 'p', review: 'r', testOutput: 't' },
    evidenceSha256: {
      progress: sha('progress'),
      review: sha('review'),
      testOutput: sha('test-output'),
      packageJson: sha('package.json'),
      sourceTree: sha('source-tree-r1'),
    },
    issues: [],
    ...overrides,
  };
}

// The launcher-side identity the trusted process would bind. The secret never
// leaves the in-process authority; the CLI never sees one.
const ENVIRONMENT = 'local-node-test-env';

function currentFor(report) {
  return {
    inputDigest: report.evidenceSha256.sourceTree,
    policyDigest: sha('policy/managed-pilot@r1'),
    environment: ENVIRONMENT,
  };
}

async function admitFixtureReport(launcher, report, { role = 'verifier', execution = 'exec-verifier-1', issuedExecutions = [] } = {}) {
  const { admitLegacyReport } = await import('../lib/adapters/legacy-evidence.js');
  return admitLegacyReport({
    report,
    identity: { runnerId: 'runner-1', execution, environment: ENVIRONMENT },
    authority: launcher,
    current: currentFor(report),
    dispatch: { role },
    issuedExecutions,
  });
}

function writeDeliveryGateInputs(dir, { contract, receipts, policy }) {
  const write = (name, suffix, value) => {
    const p = path.join(dir, `${name}${suffix}.json`);
    fs.writeFileSync(p, JSON.stringify(value, null, 2));
    return p;
  };
  let n = 0;
  const contractPath = write('test-contract', ++n, contract);
  const receiptsPath = write('receipts', ++n, receipts);
  const policyPath = write('policy', ++n, policy ?? { ref: 'policy/managed-pilot', digest: sha('policy/managed-pilot@r1') });
  return { contractPath, receiptsPath, policyPath };
}

function contractFixture(overrides = {}) {
  return {
    schemaVersion: 1,
    project: 'sdd-harness',
    change: 'demo-change',
    cases: [{ id: 'c1', ac: 'B10', oracle: 'the delivery report declares only the evidence layer that actually passed' }],
    requiredChecks: [{ level: 'report', capability: 'report:evidence-audit:v1' }],
    executionDenominator: { totalCases: 1 },
    cleanup: { environment: 'temp dirs under os.tmpdir()', data: 'none persisted' },
    dependencyBaselines: [{ kind: 'product', digest: sha('product-r1') }],
    ...overrides,
  };
}

// ---- evidence-audit: the 0/1/2 contract ----

test('evidence-audit: claims matching disk and command output exit 0 with a passing JSON report', () => {
  const { project, testOutputPath } = makeProject({
    progress: '# Progress\n\nActual source files: 2\nTests  3 passed (3)\n',
    review: '# Review\n',
    testOutput: 'Test Files  1 passed (1)\n     Tests  3 passed (3)\n',
  });
  const run = runCli(['evidence-audit', '--project', project, '--change', 'demo-change', '--test-output', testOutputPath, '--json']);
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(parseJsonOut(run).pass, true);
});

test('evidence-audit: a claim contradicting disk or command output is a verification failure, exit 2', () => {
  const { project, testOutputPath } = makeProject({
    progress: '# Progress\n\nActual source files: 99\nTests  3 passed (3)\n',
    review: '# Review\n',
    testOutput: 'Test Files  1 passed (1)\n     Tests  3 passed (3)\n',
  });
  const run = runCli(['evidence-audit', '--project', project, '--change', 'demo-change', '--test-output', testOutputPath, '--json']);
  assert.equal(run.status, 2, run.stderr || run.stdout);
  const report = parseJsonOut(run);
  assert.equal(report.pass, false);
  assert.ok(report.issues.length > 0);
  assert.ok(!report.issues.some((issue) => issue.code === 'EVIDENCE_INPUT_MISSING'), 'evidence inputs were present');
});

test('evidence-audit: nonexistent --project is invalid input, exit 1 (measured RED: exited 2)', () => {
  const missing = path.join(makeTmp('sdd-p23-cli-missing-'), 'not-there');
  const run = runCli(['evidence-audit', '--project', missing, '--change', 'demo-change', '--json']);
  assert.equal(run.status, 1, run.stdout);
  const report = parseJsonOut(run);
  assert.equal(report.pass, false);
});

test('evidence-audit: existing project with required evidence inputs missing stays exit 2 — pre-existing pinned oracle (nonzero, never a fake pass)', () => {
  // Exit-code classification note: EVIDENCE_INPUT_MISSING is prerequisite
  // language, but the pre-existing suite (test/evidence-audit-command.test.js
  // "rejects missing progress, review, or captured test output") pins exit 2
  // for a real project whose inputs are missing — the audit executed against
  // a real project and returned a verification finding. The frozen contract's
  // hard requirement (nonzero, never skip-to-PASS) holds either way; only the
  // nonexistent --project case (nothing was executable) is invalid input = 1.
  const { project } = makeProject({ progress: '', review: '', testOutput: '' });
  fs.rmSync(path.join(project, 'openspec', 'changes', 'demo-change', 'progress.md'));
  fs.rmSync(path.join(project, '.sdd', 'runs', 'demo-change', 'review-notes.md'));
  const run = runCli(['evidence-audit', '--project', project, '--change', 'demo-change', '--json']);
  assert.equal(run.status, 2, run.stdout);
  const report = parseJsonOut(run);
  assert.equal(report.pass, false);
  assert.ok(report.issues.some((issue) => issue.code === 'EVIDENCE_INPUT_MISSING'));
});

test('deliverable-audit: nonexistent --project is invalid input, exit 1 (measured RED: exited 2)', () => {
  const missing = path.join(makeTmp('sdd-p23-cli-missing2-'), 'not-there');
  const run = runCli(['deliverable-audit', '--project', missing, '--run', 'demo-run', '--json']);
  assert.equal(run.status, 1, run.stdout);
});

test('test-gate: nonexistent --project is invalid input, exit 1 (measured RED: exited 2)', () => {
  const missing = path.join(makeTmp('sdd-p23-cli-missing3-'), 'not-there');
  const run = runCli(['test-gate', '--project', missing, '--json']);
  assert.equal(run.status, 1, run.stdout);
  const report = parseJsonOut(run);
  assert.equal(report.pass, false);
});

// ---- sdd delivery-gate: the pure SDD.Gate.v1 check CLI ----

test('delivery-gate: a satisfied report-layer check exits 0 and prints a schema-shaped receipt', async () => {
  const launcher = (await import('../lib/delivery/evidence.js')).createLaunchAuthority({ secret: crypto.randomBytes(32).toString('hex') });
  const report = legacyReportFixture();
  const admitted = await admitFixtureReport(launcher, report);
  assert.equal(admitted.ok, true, admitted.reason ?? '');
  const dir = makeTmp('sdd-p23-gate-pass-');
  const { contractPath, receiptsPath, policyPath } = writeDeliveryGateInputs(dir, {
    contract: contractFixture(),
    receipts: [admitted.entry],
  });
  const run = runCli(['delivery-gate', '--contract', contractPath, '--receipts', receiptsPath, '--policy', policyPath,
    '--input-digest', report.evidenceSha256.sourceTree, '--builder-execution', 'exec-builder-1', '--json']);
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const out = parseJsonOut(run);
  assert.equal(out.verdict, 'pass');
  assert.equal(out.receipt.verdict, 'pass');
  assert.deepEqual(out.receipt.blocked, []);
  // B10: the delivery report attests exactly the layer that ran — the legacy
  // report channel, from the runner that re-dispatched it. Nothing else.
  assert.equal(out.receipt.sourceAttestation.origin, 'runner-1');
});

test('delivery-gate: the legacy report layer cannot close a product capability — verdict blocked, exit 2 (B10)', async () => {
  const launcher = (await import('../lib/delivery/evidence.js')).createLaunchAuthority({ secret: crypto.randomBytes(32).toString('hex') });
  const report = legacyReportFixture();
  const admitted = await admitFixtureReport(launcher, report);
  assert.equal(admitted.ok, true, admitted.reason ?? '');
  const dir = makeTmp('sdd-p23-gate-block-');
  const { contractPath, receiptsPath, policyPath } = writeDeliveryGateInputs(dir, {
    contract: contractFixture({ requiredChecks: [{ level: 'unit', capability: 'unit:node:test' }] }),
    receipts: [admitted.entry],
  });
  const run = runCli(['delivery-gate', '--contract', contractPath, '--receipts', receiptsPath, '--policy', policyPath,
    '--input-digest', report.evidenceSha256.sourceTree, '--builder-execution', 'exec-builder-1', '--json']);
  assert.equal(run.status, 2, run.stderr || run.stdout);
  const out = parseJsonOut(run);
  assert.equal(out.verdict, 'blocked');
  assert.match(out.receipt.blocked.join('\n'), /MISSING_OBSERVATION: required check unit\/unit:node:test/);
});

test('delivery-gate: invalid inputs exit 1 — unreadable file, schema-invalid contract, non-array receipts, malformed policy, bad digest', () => {
  const dir = makeTmp('sdd-p23-gate-bad-');
  const policy = { ref: 'policy/managed-pilot', digest: sha('policy/managed-pilot@r1') };
  const write = (name, value) => {
    const p = path.join(dir, name);
    fs.writeFileSync(p, JSON.stringify(value, null, 2));
    return p;
  };
  const goodContract = write('good-contract.json', contractFixture());
  const emptyReceipts = write('empty-receipts.json', []);
  const gate = (contract, receipts, pol, digest) => runCli(['delivery-gate', '--contract', contract, '--receipts', receipts,
    '--policy', pol ?? write('policy.json', policy), '--input-digest', digest ?? sha('anything'),
    '--builder-execution', 'exec-builder-1', '--json']);

  assert.equal(gate(path.join(dir, 'absent.json'), emptyReceipts).status, 1, 'unreadable contract file');
  assert.equal(gate(write('bad-version.json', contractFixture({ schemaVersion: 2 })), emptyReceipts).status, 1, 'future contract version');
  assert.equal(gate(write('no-version.json', (() => { const c = contractFixture(); delete c.schemaVersion; return c; })()), emptyReceipts).status, 1, 'missing contract version');
  assert.equal(gate(goodContract, write('not-array.json', { nope: true })).status, 1, 'receipts must be an array');
  assert.equal(gate(goodContract, emptyReceipts, write('bad-policy.json', { ref: 'policy/x' })).status, 1, 'policy missing digest');
  assert.equal(gate(goodContract, emptyReceipts, undefined, 'not-a-digest').status, 1, 'input digest must be sha256 hex');
});

// ---- lib/adapters/legacy-evidence.js: mapping and explicit refusals ----

test('adapter: a valid old-channel report adapts to a schema-valid envelope and is admitted unchanged through admitEvidence', async () => {
  const { adaptLegacyReport } = await import('../lib/adapters/legacy-evidence.js');
  const { parseContract } = await import('../contracts/delivery/index.js');
  const report = legacyReportFixture();
  const adapted = adaptLegacyReport(report, { runnerId: 'runner-1', execution: 'exec-verifier-1', environment: ENVIRONMENT });
  assert.equal(adapted.ok, true, adapted.reason ?? '');
  const parsed = parseContract('SDD.Delivery.EvidenceEnvelope', adapted.envelope);
  assert.equal(parsed.ok, true, parsed.errors?.join('; '));
  assert.equal(adapted.envelope.candidateDigest, report.evidenceSha256.sourceTree);
  assert.equal(adapted.envelope.caseId, report.change);
  assert.equal(adapted.envelope.check, 'report:evidence-audit:v1');
  assert.equal(adapted.envelope.origin.kind, 'legacy-report');
  assert.equal(adapted.envelope.result, 'pass');
  assert.deepEqual(adapted.envelope.executions, { total: 1, valid: 1 });

  const launcher = (await import('../lib/delivery/evidence.js')).createLaunchAuthority({ secret: crypto.randomBytes(32).toString('hex') });
  const admitted = await admitFixtureReport(launcher, report);
  assert.equal(admitted.ok, true, admitted.reason ?? '');
  assert.equal(admitted.entry.class, 'independent-acceptance');
  assert.equal(admitted.entry.envelope.check, 'report:evidence-audit:v1');
});

test('adapter: a failing old-channel report maps to result fail, never to a fabricated pass', async () => {
  const { adaptLegacyReport } = await import('../lib/adapters/legacy-evidence.js');
  const adapted = adaptLegacyReport(legacyReportFixture({ pass: false, issues: [{ code: 'CLAIMED_SOURCE_FILE_COUNT_MISMATCH', message: 'x', evidence: {} }] }),
    { runnerId: 'runner-1', execution: 'exec-verifier-1', environment: ENVIRONMENT });
  assert.equal(adapted.ok, true, adapted.reason ?? '');
  assert.equal(adapted.envelope.result, 'fail');
});

test('adapter B07: missing fields are refused explicitly by name, never fabricated', async () => {
  const { adaptLegacyReport } = await import('../lib/adapters/legacy-evidence.js');
  for (const field of ['schemaVersion', 'pass', 'issues', 'change', 'evidenceSha256']) {
    const report = legacyReportFixture();
    delete report[field];
    const refused = adaptLegacyReport(report, { runnerId: 'runner-1', execution: 'exec-verifier-1', environment: ENVIRONMENT });
    assert.equal(refused.ok, false, `${field} absent but adaptation succeeded`);
    assert.equal(refused.error, 'MISSING_FIELD');
    assert.match(refused.reason, new RegExp(field));
  }
  const noIdentity = adaptLegacyReport(legacyReportFixture(), { execution: 'exec-verifier-1', environment: ENVIRONMENT });
  assert.equal(noIdentity.ok, false);
  assert.equal(noIdentity.error, 'MISSING_FIELD');
  assert.match(noIdentity.reason, /runnerId/);
});

test('adapter B07: incompatible versions are refused explicitly (older and newer)', async () => {
  const { adaptLegacyReport } = await import('../lib/adapters/legacy-evidence.js');
  const older = adaptLegacyReport(legacyReportFixture({ schemaVersion: 0 }), { runnerId: 'r', execution: 'e', environment: ENVIRONMENT });
  assert.equal(older.ok, false);
  assert.equal(older.error, 'INCOMPATIBLE_VERSION');
  const newer = adaptLegacyReport(legacyReportFixture({ schemaVersion: 2 }), { runnerId: 'r', execution: 'e', environment: ENVIRONMENT });
  assert.equal(newer.ok, false);
  assert.equal(newer.error, 'INCOMPATIBLE_VERSION');
});

test('adapter: admission trust is untouched admitEvidence behavior — no dispatch is UNREGISTERED_SOURCE, replay is DUPLICATE_ISSUANCE', async () => {
  const { adaptLegacyReport, admitLegacyReport } = await import('../lib/adapters/legacy-evidence.js');
  const { createLaunchAuthority, admitEvidence } = await import('../lib/delivery/evidence.js');
  const launcher = createLaunchAuthority({ secret: crypto.randomBytes(32).toString('hex') });
  const report = legacyReportFixture();
  // Adaptation succeeds, but the adapter mints no trust: without a
  // launcher-issued dispatch the envelope is refused exactly as any other.
  const adapted = adaptLegacyReport(report, { runnerId: 'runner-1', execution: 'exec-verifier-1', environment: ENVIRONMENT });
  assert.equal(adapted.ok, true);
  const refused = admitEvidence({ envelope: adapted.envelope, dispatch: undefined, authority: launcher, current: currentFor(report) });
  assert.equal(refused.ok, false);
  assert.equal(refused.error, 'UNREGISTERED_SOURCE');

  assert.equal(admitLegacyReport({
    report,
    identity: { runnerId: 'runner-1', execution: 'exec-verifier-1', environment: ENVIRONMENT },
    authority: undefined,
    current: currentFor(report),
  }).ok, false, 'no authority means no admission');

  const first = await admitFixtureReport(launcher, report);
  assert.equal(first.ok, true, first.reason ?? '');
  // Duplicate issuance is judged against the caller-maintained ledger of
  // issued executions (admitEvidence's documented contract): the replay with
  // the same execution identity recorded in the ledger is refused.
  const replay = await admitFixtureReport(launcher, report, { issuedExecutions: [first.entry.execution] });
  assert.equal(replay.ok, false);
  assert.equal(replay.error, 'DUPLICATE_ISSUANCE');
});

test('legacy adapter cannot downgrade a protected managed caller into historical acceptance', async () => {
  const { admitLegacyReport } = await import('../lib/adapters/legacy-evidence.js');
  const { createLaunchAuthority } = await import('../lib/delivery/evidence.js');
  const report = legacyReportFixture();
  const args = { report: { ...report, profile: 'comet-managed-v2', trusted: true },
    identity: { runnerId: 'runner-1', execution: 'exec-legacy', environment: ENVIRONMENT },
    authority: createLaunchAuthority({ secret: crypto.randomBytes(32).toString('hex') }), current: currentFor(report),
    requireManaged: false, dispatch: { role: 'verifier', profile: 'comet-managed-v2' } };
  const refused = admitLegacyReport(args, { requireManaged: true });
  assert.equal(refused.ok, false);
  assert.equal(refused.error, 'LEGACY_REPORT_NOT_MANAGED');
});

test('legacy mapping and admission always declare finite historical component scope', async () => {
  const { adaptLegacyReport, admitLegacyReport } = await import('../lib/adapters/legacy-evidence.js');
  const { createLaunchAuthority } = await import('../lib/delivery/evidence.js');
  const report = legacyReportFixture();
  const adapted = adaptLegacyReport(report, { runnerId: 'runner-1', execution: 'historical-run', environment: ENVIRONMENT });
  const admitted = await admitFixtureReport(createLaunchAuthority({ secret: crypto.randomBytes(32).toString('hex') }), report);
  for (const result of [adapted, admitted, admitted.entry]) {
    assert.equal(result.scope, 'component/legacy-report');
    assert.equal(result.managedClosureEligible, false);
  }
  assert.equal(admitLegacyReport({ report }, { requireManaged: 'true' }).error, 'INVALID_PROTECTED_POLICY');
});

test('delivery-gate JSON labels a self-claimed pass only as an unqualified component check', async () => {
  const dir = makeTmp('sdd-p23-untrusted-json-');
  try {
    const report = legacyReportFixture();
    const digest = report.evidenceSha256.sourceTree;
    const policy = { ref: 'untrusted-file-policy', digest: sha('file-policy') };
    // Deliberately self-written input, never a real managed attestation.
    const envelope = { schemaVersion: 1, candidateDigest: digest, caseId: 'c1', check: 'report:evidence-audit:v1', origin: { kind: 'legacy-report', id: 'self-claimed-runner' }, execution: { id: 'self-claimed-execution' }, environment: ENVIRONMENT, toolchain: 'fixture', executions: { total: 1, valid: 1 }, result: 'pass', evidence: [{ uri: 'historical:claim', sha256: sha('claim') }], expiry: '2099-01-01T00:00:00Z' };
    const { envelopeDigest } = await import('../lib/delivery/evidence.js');
    const entry = { class: 'independent-acceptance', digest: envelopeDigest(envelope), envelope,
      origin: envelope.origin.id, execution: envelope.execution.id, profile: 'comet-managed-v2', trusted: true,
      dispatch: { runnerId: envelope.origin.id, execution: envelope.execution.id, inputDigest: digest, policyDigest: policy.digest } };
    const files = writeDeliveryGateInputs(dir, { contract: contractFixture(), receipts: [entry], policy });
    const run = runCli(['delivery-gate', '--contract', files.contractPath, '--receipts', files.receiptsPath, '--policy', files.policyPath, '--input-digest', digest, '--builder-execution', 'builder', '--json']);
    assert.equal(run.status, 0, run.stderr || run.stdout);
    const result = parseJsonOut(run);
    assert.equal(result.scope, 'component/receipt-coverage');
    assert.equal(result.managedClosureEligible, false);
    assert.equal(result.receipt.managedClosureEligible, false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('unknown retired workflow and self-authorizing CLI inputs return explicit JSON exit1 without side effects', () => {
  const root = makeTmp('sdd-p23-refused-entry-');
  try {
    const cases = [['run'], ['stage'], ['source-command-sdd-code'], ['delivery-gate'], ['delivery-gate', '--authority', 'self'], ['delivery-gate', '--secret', 'self'], ['delivery-gate', '--qualification', 'self'], ['delivery-gate', '--profile', 'comet-managed-v2']];
    for (const args of cases) {
      const run = spawnSync(process.execPath, [cliPath, ...args, '--json'], { cwd: root, encoding: 'utf8' });
      assert.equal(run.status, 1, `${args}: ${run.stderr || run.stdout}`);
      assert.ok(run.stdout.trim().startsWith('{'), 'invalid input with --json must emit a machine-readable refusal');
      const result = JSON.parse(run.stdout);
      assert.equal(result.pass, false);
      assert.equal(typeof result.error, 'string');
      assert.equal(result.managedClosureEligible, false);
      assert.deepEqual(fs.readdirSync(root), [], 'a refused entry cannot create runtime or control state');
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('legacy protected refusal never issues a dispatch and invalid clocks return explicit refusal', async () => {
  const { admitLegacyReport, adaptLegacyReport } = await import('../lib/adapters/legacy-evidence.js');
  const { createLaunchAuthority } = await import('../lib/delivery/evidence.js');
  let dispatches = 0;
  const launcher = createLaunchAuthority({ secret: crypto.randomBytes(32).toString('hex') });
  const authority = { ...launcher, issueDispatch: (...args) => { dispatches++; return launcher.issueDispatch(...args); } };
  const report = legacyReportFixture();
  const result = admitLegacyReport({ report, authority, current: currentFor(report), identity: { runnerId: 'r', execution: 'e', environment: ENVIRONMENT } }, { requireManaged: true });
  assert.equal(result.error, 'LEGACY_REPORT_NOT_MANAGED');
  assert.equal(dispatches, 0);
  let invalid;
  assert.doesNotThrow(() => { invalid = adaptLegacyReport(report, { runnerId: 'r', execution: 'e', environment: ENVIRONMENT, now: 'not-a-time' }); });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error, 'INVALID_LEGACY_IDENTITY');
});

for (const [label, reportOverride, identityOverride] of [
  ['null identity', {}, null],
  ['object schemaVersion', { schemaVersion: { toString: null } }, {}],
  ['object clock', {}, { now: { toString: null } }],
]) {
  test(`legacy raw JSON shape refuses ${label} without coercion or TypeError`, async () => {
    const { adaptLegacyReport } = await import('../lib/adapters/legacy-evidence.js');
    const identity = identityOverride === null ? null : { runnerId: 'r', execution: 'e', environment: ENVIRONMENT, ...identityOverride };
    let result;
    assert.doesNotThrow(() => { result = adaptLegacyReport(legacyReportFixture(reportOverride), identity); });
    assert.equal(result.ok, false);
    assert.equal(typeof result.error, 'string');
    assert.equal(result.managedClosureEligible, false);
  });
}

test('legacy JSON matrix validates report identity versions and clocks without string coercion', async () => {
  const { adaptLegacyReport } = await import('../lib/adapters/legacy-evidence.js');
  const identity = { runnerId: 'r', execution: 'e', environment: ENVIRONMENT };
  const refused = (report, who) => {
    let result; assert.doesNotThrow(() => { result = adaptLegacyReport(report, who); });
    assert.equal(result.ok, false); assert.equal(typeof result.error, 'string');
  };
  for (const bad of [null, [], false, 7, 'identity']) refused(legacyReportFixture(), bad);
  for (const bad of [undefined, null, 0, 2, '1', {}, [], { toString: null }, false]) refused(legacyReportFixture({ schemaVersion: bad }), identity);
  for (const key of ['now', 'expiry', 'toolchain', 'reportPath']) {
    for (const bad of [null, [], {}, { toString: null }, 7, false, '']) refused(legacyReportFixture(), { ...identity, [key]: bad });
  }
  for (const key of ['now', 'expiry']) refused(legacyReportFixture(), { ...identity, [key]: 'not-a-time' });
  for (const bad of [null, [], false, 7, 'report']) refused(bad, identity);
  for (const bad of [null, [], 'digest', { sourceTree: { toString: null } }]) refused(legacyReportFixture({ evidenceSha256: bad }), identity);
  const good = adaptLegacyReport(legacyReportFixture(), { ...identity, now: '2026-10-25T12:00:00Z', expiry: '2026-11-01T12:00:00Z', toolchain: 'test recorder', reportPath: 'history/report.json' });
  assert.equal(good.ok, true);
});

test('legacy admission validates top-level protected dispatch and current inputs before issuing', async () => {
  const { admitLegacyReport } = await import('../lib/adapters/legacy-evidence.js');
  const { createLaunchAuthority } = await import('../lib/delivery/evidence.js');
  const report = legacyReportFixture(); let dispatches = 0;
  const launcher = createLaunchAuthority({ secret: crypto.randomBytes(32).toString('hex') });
  const authority = { ...launcher, issueDispatch: (...args) => { dispatches++; return launcher.issueDispatch(...args); } };
  const args = { report, identity: { runnerId: 'r', execution: 'e', environment: ENVIRONMENT }, current: currentFor(report), authority };
  const refused = (payload, options) => { let result;
    assert.doesNotThrow(() => { result = admitLegacyReport(payload, options); });
    assert.equal(result.ok, false); assert.equal(typeof result.error, 'string'); assert.equal(dispatches, 0);
  };
  for (const bad of [null, [], false, 7, 'payload']) refused(bad);
  for (const bad of [null, [], false, 7, 'options']) refused(args, bad);
  for (const key of ['identity', 'dispatch', 'current', 'issuedExecutions']) {
    for (const bad of [null, false, true, 7, 'object', ...(key === 'issuedExecutions' ? [] : [[]])]) refused({ ...args, [key]: bad });
  }
  for (const key of ['current', 'authority']) refused({ ...args, [key]: {} });
  for (const key of ['inputDigest', 'policyDigest', 'environment']) refused({ ...args, current: { ...args.current, [key]: { toString: null } } });
  for (const key of ['run', 'gate', 'role', 'inputDigest', 'policyDigest', 'attempt', 'epoch']) refused({ ...args, dispatch: { [key]: { toString: null } } });
  for (const bad of [null, [], {}, { toString: null }, 7, false, 'not-a-time']) refused({ ...args, now: bad });
  refused({ ...args, issuedExecutions: [null] });
});

test('delivery-gate invalid JSON returns exit1 without echoing input contents or host file paths', () => {
  const dir = makeTmp('sdd-p23-private-input-');
  try {
    const files = writeDeliveryGateInputs(dir, { contract: contractFixture(), receipts: [] });
    const bad = path.join(dir, 'private-file-name.json');
    const args = ['delivery-gate', '--contract', bad, '--receipts', files.receiptsPath, '--policy', files.policyPath,
      '--input-digest', sha('current'), '--builder-execution', 'builder', '--json'];
    const sentinel = 'PRIVATE_INPUT_MUST_NOT_BE_ECHOED';
    for (const contents of [undefined, '{"private":"' + sentinel + '"invalid}', 'null', '[]', JSON.stringify(contractFixture({ schemaVersion: { toString: null, private: sentinel } }))]) {
      if (contents === undefined) fs.rmSync(bad, { force: true }); else fs.writeFileSync(bad, contents);
      const run = runCli(args);
      assert.equal(run.status, 1, run.stderr || run.stdout);
      const result = JSON.parse(run.stdout); assert.equal(result.pass, false);
      assert.equal(run.stdout.includes(dir), false, 'input error must not echo host path');
      assert.equal(run.stdout.includes(sentinel), false, 'input error must not echo raw JSON');
      assert.equal(run.stderr.includes(dir), false);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// P2_2 delivery case: evidence admission and identity binding against the
// trusted-launcher dispatch record (A05/A06), pure gate evaluation with
// rejection reasons over REAL node --test executions (A18, B03, B06), the
// explicit incompatibility refusal for imported reports (B07), and the
// locally provable half of the protected-source boundary: fixtures and
// worker processes without the launcher secret cannot mint trusted evidence
// (A19 local half; real protected-Runner permission negatives are proven on
// the managed Runner, not claimed here).
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
const { admitEvidence, createLaunchAuthority } = await import(path.join(projectRoot, 'lib/delivery/evidence.js'));
const { evaluate } = await import(path.join(projectRoot, 'lib/delivery/gate.js'));
const { classifyRunOutcome, parseTapSummary } = await import(path.join(projectRoot, 'lib/delivery/test-contract.js'));

const shaBytes = (data) => crypto.createHash('sha256').update(data).digest('hex');
const sha = (label) => shaBytes(label);
const NOW = '2026-10-20T12:00:00.000Z';
const INPUT = sha('full-input-r1');
const POLICY = { ref: 'policy/managed-pilot', digest: sha('policy/managed-pilot@r1') };
const ENVIRONMENT = 'local-node-test-env';

function makeTmp(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), label));
}

function runNodeTest(root, target) {
  // Inside a node --test child, NODE_TEST_CONTEXT=child-v8 makes a nested
  // node --test skip running files entirely (exit 0, no TAP output). Strip it
  // so the spawned run is a real top-level execution.
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, ['--test', '--test-reporter=tap', target], { cwd: root, encoding: 'utf8', timeout: 60000, env });
}

function makeProject(files) {
  const root = makeTmp('sdd-p22-case-');
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return root;
}

function newLauncher() {
  return createLaunchAuthority({ secret: crypto.randomBytes(32).toString('hex') });
}

function current() {
  return { inputDigest: INPUT, policyDigest: POLICY.digest, environment: ENVIRONMENT };
}

// Builds an envelope from a REAL run: the observation counts are read from
// the run's TAP summary, and the raw output is digested as the evidence
// artifact. Declared numbers never substitute observed ones.
function envelopeFromRun({ run, caseId, check, result, execution }) {
  const summary = parseTapSummary(run.output);
  return {
    schemaVersion: 1,
    candidateDigest: INPUT,
    caseId,
    check,
    origin: { kind: 'registered-runner', id: 'runner-1' },
    execution: { id: execution },
    environment: ENVIRONMENT,
    toolchain: `node ${process.version}`,
    executions: { total: summary?.tests ?? 0, valid: (summary?.pass ?? 0) + (summary?.fail ?? 0) },
    result,
    evidence: [{ uri: run.artifactUri, sha256: run.artifactDigest }],
    expiry: '2026-11-01T00:00:00.000Z',
  };
}

function captureRun(run, label) {
  const dir = makeTmp('sdd-p22-artifact-');
  const artifactPath = path.join(dir, `${label}.tap.txt`);
  fs.writeFileSync(artifactPath, run.stdout ?? '');
  return {
    exitCode: run.status,
    output: run.stdout ?? '',
    artifactUri: path.relative(process.cwd(), artifactPath),
    artifactDigest: shaBytes(fs.readFileSync(artifactPath)),
  };
}

function admitOne(launcher, { role = 'verifier', execution, envelope, issuedExecutions = [], audit = [] } = {}) {
  const dispatch = launcher.issueDispatch({
    runnerId: 'runner-1',
    run: 'run-1',
    gate: 'V',
    inputDigest: INPUT,
    policyDigest: POLICY.digest,
    attempt: 1,
    epoch: 1,
    role,
    execution,
  });
  const admitted = admitEvidence({
    envelope,
    dispatch,
    authority: launcher,
    current: current(),
    issuedExecutions,
    now: NOW,
  });
  if (!admitted.ok) audit.push(admitted);
  return admitted;
}

function gateInputs(requiredChecks) {
  return {
    inputDigest: INPUT,
    testContract: {
      schemaVersion: 1,
      project: 'sdd-harness',
      change: 'delivery-foundation-rearchitecture',
      cases: [{ id: 'c1', ac: 'A18', oracle: 'required capabilities observed by an independent execution' }],
      requiredChecks,
      executionDenominator: { totalCases: 1 },
      cleanup: { environment: 'temp dirs under os.tmpdir()', data: 'none persisted' },
      dependencyBaselines: [{ kind: 'product', digest: sha('product-r1') }],
    },
    builderExecution: 'exec-builder-1',
  };
}

const PASSING_TEST = {
  'pass.test.js': [
    "import assert from 'node:assert/strict';",
    "import test from 'node:test';",
    "test('observed behavior matches the oracle', () => {",
    '  assert.equal(2 + 2, 4);',
    '});',
    '',
  ].join('\n'),
};

test('V_A18: a real passing run is admitted as pass and the gate issues a schema-valid pass receipt', () => {
  const launcher = newLauncher();
  const root = makeProject(PASSING_TEST);
  const raw = runNodeTest(root, 'pass.test.js');
  assert.equal(raw.status, 0, 'precondition: the real run passes');
  const captured = captureRun(raw, 'pass');
  const summary = parseTapSummary(captured.output);
  assert.ok(summary.pass > 0, 'the real run must show executed assertions in its TAP summary');

  const envelope = envelopeFromRun({ run: captured, caseId: 'c1', check: 'unit:node:test', result: 'pass', execution: 'exec-verifier-1' });
  assert.equal(envelope.executions.valid, summary.pass + summary.fail, 'observed counts come from the TAP summary, not declarations');
  assert.ok(envelope.executions.valid > 0);
  const admitted = admitOne(launcher, { execution: 'exec-verifier-1', envelope });
  assert.equal(admitted.ok, true, `real pass evidence must be admitted: ${admitted.reason ?? ''}`);

  const result = evaluate(gateInputs([{ level: 'unit', capability: 'unit:node:test' }]), [admitted.entry], POLICY);
  assert.equal(result.verdict, 'pass');
  assert.deepEqual(result.receipt.blocked, []);
  const parsed = parseContract('SDD.Delivery.GateReceipt', result.receipt);
  assert.equal(parsed.ok, true, `gate receipt must satisfy the frozen schema: ${parsed.errors?.join('; ') ?? ''}`);
});

test('V_A18: an environment crash is recorded truthfully as unverified and stays blocked, and a missing capability is never fabricated', () => {
  const launcher = newLauncher();
  const root = makeProject({
    'crash.test.js': [
      "import test from 'node:test';",
      "import missing from 'definitely-missing-env-dependency-p22';",
      "test('never reached', () => {});",
      '',
    ].join('\n'),
  });
  const raw = runNodeTest(root, 'crash.test.js');
  assert.notEqual(raw.status, 0, 'precondition: the crash fails the command');
  const outcome = classifyRunOutcome(captureRun(raw, 'crash'));
  assert.equal(outcome.kind, 'environment-failure', 'precondition: the crash is an environment failure');

  const envelope = envelopeFromRun({ run: captureRun(raw, 'crash'), caseId: 'c1', check: 'unit:node:test', result: 'unverified', execution: 'exec-verifier-crash' });
  const admitted = admitOne(launcher, { execution: 'exec-verifier-crash', envelope });
  assert.equal(admitted.ok, true, 'a truthful unverified record with a real probe artifact must be admissible');
  const result = evaluate(gateInputs([{ level: 'unit', capability: 'unit:node:test' }]), [admitted.entry], POLICY);
  assert.equal(result.verdict, 'blocked', 'missing observation capability must block, never fake a pass');
  assert.match(
    result.receipt.blocked.join('\n'),
    new RegExp(`UNVERIFIED_CAPABILITY: unit:node:test receipt result is unverified with ${envelope.executions.valid} valid execution`),
    'the observed count from the real crashed run carries into the rejection reason',
  );

  const halfCovered = evaluate(
    gateInputs([{ level: 'unit', capability: 'unit:node:test' }, { level: 'ui', capability: 'console' }]),
    [admitOne(launcher, { execution: 'exec-verifier-2', envelope: envelopeFromRun({ run: captureRun(runNodeTest(makeProject(PASSING_TEST), 'pass.test.js'), 'pass2'), caseId: 'c1', check: 'unit:node:test', result: 'pass', execution: 'exec-verifier-2' }) }).entry],
    POLICY,
  );
  assert.equal(halfCovered.verdict, 'blocked');
  assert.match(halfCovered.receipt.blocked.join('\n'), /MISSING_OBSERVATION: required check ui\/console/);
});

test('V_A05: a worker process self-signing a pass JSON is refused as an unregistered source and the audit is kept', () => {
  const launcher = newLauncher();
  const audit = [];
  // No dispatch exists for this envelope: the worker wrote it itself.
  const selfSigned = {
    schemaVersion: 1,
    candidateDigest: INPUT,
    caseId: 'c1',
    check: 'unit:node:test',
    origin: { kind: 'registered-runner', id: 'runner-1' },
    execution: { id: 'exec-worker-1' },
    environment: ENVIRONMENT,
    toolchain: `node ${process.version}`,
    executions: { total: 1, valid: 1 },
    result: 'pass',
    evidence: [{ uri: 'worker-wrote-this.txt', sha256: sha('self-written') }],
    expiry: '2026-11-01T00:00:00.000Z',
  };
  // Direct admission call: no dispatch record exists for worker-written JSON.
  const refused = admitEvidence({
    envelope: selfSigned,
    dispatch: undefined,
    authority: launcher,
    current: current(),
    issuedExecutions: [],
    now: NOW,
  });
  if (!refused.ok) audit.push(refused);
  assert.equal(refused.ok, false);
  assert.equal(refused.error, 'UNREGISTERED_SOURCE');
  assert.equal(audit.length, 1, 'the refusal stays auditable');
  assert.equal(audit[0].audit.origin, 'runner-1');
  assert.equal(audit[0].audit.execution, 'exec-worker-1');
  assert.ok(audit[0].audit.envelopeDigest, 'the audit pins the refused content');
});

test('V_A06: one execution identity cannot be both builder and verifier', () => {
  const launcher = newLauncher();
  const audit = [];
  const envelope = envelopeFromRun({ run: captureRun(runNodeTest(makeProject(PASSING_TEST), 'pass.test.js'), 'pass'), caseId: 'c1', check: 'unit:node:test', result: 'pass', execution: 'exec-builder-1' });
  const builderDispatch = admitOne(launcher, { role: 'builder', execution: 'exec-builder-1', envelope, audit });
  assert.equal(builderDispatch.ok, false);
  assert.equal(builderDispatch.error, 'IDENTITY_CONFLICT');

  // The same identity reaching the gate as a "verifier" entry is blocked there too.
  const verifierEntry = admitOne(launcher, { role: 'verifier', execution: 'exec-builder-1', envelope });
  assert.equal(verifierEntry.ok, true);
  const result = evaluate(gateInputs([{ level: 'unit', capability: 'unit:node:test' }]), [verifierEntry.entry], POLICY);
  assert.equal(result.verdict, 'blocked');
  assert.match(result.receipt.blocked.join('\n'), /IDENTITY_CONFLICT: receipt execution exec-builder-1 is the builder execution/);
});

test('V_B03: authoring self-check evidence never signs independent acceptance', () => {
  const launcher = newLauncher();
  const entry = admitOne(launcher, {
    role: 'test-author',
    execution: 'exec-author-1',
    envelope: envelopeFromRun({ run: captureRun(runNodeTest(makeProject(PASSING_TEST), 'pass.test.js'), 'author'), caseId: 'c1', check: 'unit:node:test', result: 'pass', execution: 'exec-author-1' }),
  });
  assert.equal(entry.ok, true);
  assert.equal(entry.entry.class, 'authoring-self-check');
  const result = evaluate(gateInputs([{ level: 'unit', capability: 'unit:node:test' }]), [entry.entry], POLICY);
  assert.equal(result.verdict, 'blocked');
  assert.match(result.receipt.blocked.join('\n'), /AUTHORING_SELF_CHECK_ONLY/);
});

test('V_B06: a service log and a DOM check cannot close a required console check', () => {
  const launcher = newLauncher();
  const domEntry = admitOne(launcher, {
    execution: 'exec-verifier-dom',
    envelope: envelopeFromRun({ run: captureRun(runNodeTest(makeProject(PASSING_TEST), 'pass.test.js'), 'dom'), caseId: 'c1', check: 'dom', result: 'pass', execution: 'exec-verifier-dom' }),
  });
  const serviceLogEntry = admitOne(launcher, {
    execution: 'exec-verifier-log',
    envelope: envelopeFromRun({ run: captureRun(runNodeTest(makeProject(PASSING_TEST), 'pass.test.js'), 'log'), caseId: 'c1', check: 'service-log', result: 'pass', execution: 'exec-verifier-log' }),
  });
  const entries = [domEntry, serviceLogEntry].filter((e) => e.ok).map((e) => e.entry);
  assert.equal(entries.length, 2);
  const result = evaluate(gateInputs([{ level: 'ui', capability: 'console' }, { level: 'ui', capability: 'dom' }]), entries, POLICY);
  assert.equal(result.verdict, 'blocked');
  assert.match(result.receipt.blocked.join('\n'), /MISSING_OBSERVATION: required check ui\/console/);
  assert.doesNotMatch(result.receipt.blocked.join('\n'), /MISSING_OBSERVATION: required check ui\/dom/);
});

test('V_B07: an imported report with an incompatible contract version is refused explicitly', () => {
  const launcher = newLauncher();
  const legacy = envelopeFromRun({ run: captureRun(runNodeTest(makeProject(PASSING_TEST), 'pass.test.js'), 'legacy'), caseId: 'c1', check: 'unit:node:test', result: 'pass', execution: 'exec-verifier-legacy' });
  legacy.schemaVersion = 0;
  const refused = admitOne(launcher, { execution: 'exec-verifier-legacy', envelope: legacy });
  assert.equal(refused.ok, false);
  assert.equal(refused.error, 'INVALID_ENVELOPE');
  assert.match(refused.reason, /older than supported/);
});

test('V_A19 (local half): a child process with a scrubbed environment cannot mint a trusted dispatch', () => {
  const launcher = newLauncher();
  const secret = crypto.randomBytes(32).toString('hex');
  const protectedLauncher = createLaunchAuthority({ secret });
  const dir = makeTmp('sdd-p22-v19-');
  const worker = path.join(dir, 'worker.mjs');
  fs.writeFileSync(worker, [
    "import fs from 'node:fs';",
    "import crypto from 'node:crypto';",
    'const inherited = process.env.SDD_LAUNCHER_SECRET ?? "<absent>";',
    'const binding = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));',
    'const forged = { ...binding, integrity: crypto.createHash("sha256").update(binding.execution + inherited).digest("hex") };',
    'fs.writeFileSync(process.argv[3], JSON.stringify(forged));',
    '',
  ].join('\n'));
  const binding = {
    runnerId: 'runner-1', run: 'run-1', gate: 'V',
    inputDigest: INPUT, policyDigest: POLICY.digest,
    attempt: 1, epoch: 1, role: 'verifier', execution: 'exec-verifier-1',
  };
  const bindingPath = path.join(dir, 'binding.json');
  const productPath = path.join(dir, 'forged.json');
  fs.writeFileSync(bindingPath, JSON.stringify(binding));
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  // The child does not inherit any launcher identity: no secret in its env.
  const run = spawnSync(process.execPath, [worker, bindingPath, productPath], { cwd: dir, encoding: 'utf8', timeout: 30000, env });
  assert.equal(run.status, 0, `worker precondition failed: ${run.stderr}`);
  const forged = JSON.parse(fs.readFileSync(productPath, 'utf8'));
  const envelope = {
    schemaVersion: 1,
    candidateDigest: INPUT,
    caseId: 'c1',
    check: 'unit:node:test',
    origin: { kind: 'registered-runner', id: 'runner-1' },
    execution: { id: 'exec-verifier-1' },
    environment: ENVIRONMENT,
    toolchain: `node ${process.version}`,
    executions: { total: 1, valid: 1 },
    result: 'pass',
    evidence: [{ uri: 'forged-evidence.txt', sha256: sha('forged') }],
    expiry: '2026-11-01T00:00:00.000Z',
  };
  const refused = admitEvidence({
    envelope,
    dispatch: forged,
    authority: protectedLauncher,
    current: current(),
    issuedExecutions: [],
    now: NOW,
  });
  assert.equal(refused.ok, false, 'the child-forged dispatch must be refused');
  assert.equal(refused.error, 'FORGED_DISPATCH');
});

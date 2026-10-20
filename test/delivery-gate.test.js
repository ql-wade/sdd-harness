// Pure gate evaluation and rejection reasons (task 2.2.b, SDD.Gate.v1).
// evaluate(inputs, receipts, policy) returns only a verdict and a GateReceipt
// (validated against contracts/delivery): no dispatch, no current-stage
// writes, no side effects. Required capabilities stay blocked on missing
// evidence (A18), UNVERIFIED results (A18), observation-kind substitution
// (B06) and authoring-only coverage (B03); the builder execution can never
// be the attesting execution (A06); stale or tampered receipts cannot pass.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { parseContract } from '../contracts/delivery/index.js';
import { admitEvidence, createLaunchAuthority } from '../lib/delivery/evidence.js';
import { evaluate } from '../lib/delivery/gate.js';

const sha = (label) => crypto.createHash('sha256').update(label).digest('hex');
const NOW = '2026-10-20T12:00:00.000Z';
const INPUT = sha('full-input-r1');
const POLICY_DIGEST = sha('policy/managed-pilot@r1');
const POLICY = { ref: 'policy/managed-pilot', digest: POLICY_DIGEST };

function contractFixture(requiredChecks) {
  return {
    schemaVersion: 1,
    project: 'sdd-harness',
    change: 'delivery-foundation-rearchitecture',
    cases: [{ id: 'c1', ac: 'A18', oracle: 'required capabilities are observed before pass' }],
    requiredChecks,
    executionDenominator: { totalCases: 1 },
    cleanup: { environment: 'temp dir removed after run', data: 'none persisted' },
    dependencyBaselines: [{ kind: 'product', digest: sha('product-r1') }],
  };
}

function envelopeFixture(overrides = {}) {
  return {
    schemaVersion: 1,
    candidateDigest: INPUT,
    caseId: 'c1',
    check: 'unit:node:test',
    origin: { kind: 'registered-runner', id: 'runner-1' },
    execution: { id: 'exec-verifier-1' },
    environment: 'managed-pilot-env-1',
    toolchain: 'node v22.13.1',
    executions: { total: 3, valid: 2 },
    result: 'pass',
    evidence: [{ uri: '.whitebox/c1/tap.txt', sha256: sha('tap-output') }],
    expiry: '2026-11-01T00:00:00.000Z',
    ...overrides,
  };
}

// Admits one envelope through the real admission path so the gate is fed
// exactly what admission produces (never hand-assembled entries).
function admitOne(launcher, { role = 'verifier', execution = 'exec-verifier-1', envelope, dispatchOverrides = {}, issuedExecutions = [] } = {}) {
  const dispatch = launcher.issueDispatch({
    runnerId: 'runner-1',
    run: 'run-1',
    gate: 'V',
    inputDigest: INPUT,
    policyDigest: POLICY_DIGEST,
    attempt: 1,
    epoch: 1,
    role,
    execution,
    ...dispatchOverrides,
  });
  const admitted = admitEvidence({
    envelope: envelope ?? envelopeFixture({ execution: { id: execution } }),
    dispatch,
    authority: launcher,
    current: { inputDigest: INPUT, policyDigest: POLICY_DIGEST, environment: 'managed-pilot-env-1' },
    issuedExecutions,
    now: NOW,
  });
  assert.equal(admitted.ok, true, `test setup admission failed: ${admitted.reason ?? ''}`);
  return admitted.entry;
}

function inputsFixture(requiredChecks) {
  return {
    inputDigest: INPUT,
    testContract: contractFixture(requiredChecks),
    builderExecution: 'exec-builder-1',
  };
}

test('the gate passes a fully covered candidate and the receipt validates against SDD.Delivery.GateReceipt', () => {
  const launcher = createLaunchAuthority({ secret: crypto.randomBytes(32).toString('hex') });
  const entry = admitOne(launcher);
  const result = evaluate(inputsFixture([{ level: 'unit', capability: 'unit:node:test' }]), [entry], POLICY);
  assert.equal(result.verdict, 'pass');
  assert.deepEqual(result.receipt.blocked, []);
  assert.deepEqual(result.receipt.requiredDenominator, { required: 1, valid: 1 });
  assert.deepEqual(result.receipt.evidence, [entry.digest]);
  assert.deepEqual(result.receipt.policy, POLICY);
  assert.equal(result.receipt.inputDigest, INPUT);
  assert.deepEqual(result.receipt.sourceAttestation, { origin: 'runner-1', execution: 'exec-verifier-1' });
  const parsed = parseContract('SDD.Delivery.GateReceipt', result.receipt);
  assert.equal(parsed.ok, true, `receipt must satisfy the frozen schema: ${parsed.errors?.join('; ') ?? ''}`);
});

test('A18: a required capability with no receipt stays blocked (never fabricated as pass)', () => {
  const launcher = createLaunchAuthority({ secret: crypto.randomBytes(32).toString('hex') });
  const entry = admitOne(launcher, { execution: 'exec-verifier-unit', envelope: envelopeFixture({ execution: { id: 'exec-verifier-unit' }, check: 'unit:node:test' }) });
  const result = evaluate(
    inputsFixture([{ level: 'unit', capability: 'unit:node:test' }, { level: 'ui', capability: 'console' }]),
    [entry],
    POLICY,
  );
  assert.equal(result.verdict, 'blocked');
  assert.match(result.receipt.blocked.join('\n'), /MISSING_OBSERVATION: required check ui\/console/);
  assert.deepEqual(result.receipt.requiredDenominator, { required: 2, valid: 1 });
  const parsed = parseContract('SDD.Delivery.GateReceipt', result.receipt);
  assert.equal(parsed.ok, true);
});

test('A18: an UNVERIFIED receipt cannot pass its required capability', () => {
  const launcher = createLaunchAuthority({ secret: crypto.randomBytes(32).toString('hex') });
  const entry = admitOne(launcher, {
    envelope: envelopeFixture({
      result: 'unverified',
      executions: { total: 0, valid: 0 },
      evidence: [{ uri: '.whitebox/c1/console-probe.err', sha256: sha('console-not-available') }],
    }),
  });
  const result = evaluate(inputsFixture([{ level: 'ui', capability: 'unit:node:test' }]), [entry], POLICY);
  assert.equal(result.verdict, 'blocked');
  assert.match(result.receipt.blocked.join('\n'), /UNVERIFIED_CAPABILITY: unit:node:test receipt result is unverified with 0 valid execution/);
});

test('B06: required observation kinds cannot substitute each other (service log is not console)', () => {
  const launcher = createLaunchAuthority({ secret: crypto.randomBytes(32).toString('hex') });
  const domEntry = admitOne(launcher, {
    execution: 'exec-verifier-dom',
    envelope: envelopeFixture({ execution: { id: 'exec-verifier-dom' }, check: 'dom' }),
  });
  const serviceLogEntry = admitOne(launcher, {
    execution: 'exec-verifier-log',
    envelope: envelopeFixture({ execution: { id: 'exec-verifier-log' }, check: 'service-log' }),
  });
  const result = evaluate(
    inputsFixture([{ level: 'ui', capability: 'console' }, { level: 'ui', capability: 'dom' }]),
    [domEntry, serviceLogEntry],
    POLICY,
  );
  assert.equal(result.verdict, 'blocked');
  assert.match(result.receipt.blocked.join('\n'), /MISSING_OBSERVATION: required check ui\/console/);
  assert.doesNotMatch(result.receipt.blocked.join('\n'), /MISSING_OBSERVATION: required check ui\/dom/);
  assert.deepEqual(result.receipt.requiredDenominator, { required: 2, valid: 1 });
  assert.equal(result.receipt.evidence.length, 2, 'the service-log receipt is judged but satisfies nothing');
});

test('B03: authoring self-check receipts are recorded but never sign independent acceptance', () => {
  const launcher = createLaunchAuthority({ secret: crypto.randomBytes(32).toString('hex') });
  const entry = admitOne(launcher, { role: 'test-author', execution: 'exec-author-1' });
  const result = evaluate(inputsFixture([{ level: 'unit', capability: 'unit:node:test' }]), [entry], POLICY);
  assert.equal(result.verdict, 'blocked');
  assert.match(result.receipt.blocked.join('\n'), /AUTHORING_SELF_CHECK_ONLY: unit:node:test/);
  assert.deepEqual(result.receipt.requiredDenominator, { required: 1, valid: 0 });
  assert.equal(result.receipt.sourceAttestation.execution, 'exec-author-1', 'the self-check stays visible in the attestation');
});

test('A06: a receipt whose execution equals the builder execution is blocked at the gate', () => {
  const launcher = createLaunchAuthority({ secret: crypto.randomBytes(32).toString('hex') });
  // Builder and verifier share one execution identity: admission alone cannot
  // see it (it does not know who the builder was), the gate does.
  const entry = admitOne(launcher, { role: 'verifier', execution: 'exec-builder-1' });
  const result = evaluate(inputsFixture([{ level: 'unit', capability: 'unit:node:test' }]), [entry], POLICY);
  assert.equal(result.verdict, 'blocked');
  assert.match(result.receipt.blocked.join('\n'), /IDENTITY_CONFLICT: receipt execution exec-builder-1 is the builder execution/);
  assert.deepEqual(result.receipt.requiredDenominator, { required: 1, valid: 0 });
});

test('stale receipts are blocked when the policy or input digest rotated after admission', () => {
  const launcher = createLaunchAuthority({ secret: crypto.randomBytes(32).toString('hex') });
  const entry = admitOne(launcher);
  const newPolicy = { ref: 'policy/managed-pilot', digest: sha('policy/managed-pilot@r2') };
  const stalePolicy = evaluate(inputsFixture([{ level: 'unit', capability: 'unit:node:test' }]), [entry], newPolicy);
  assert.equal(stalePolicy.verdict, 'blocked');
  assert.match(stalePolicy.receipt.blocked.join('\n'), /STALE_POLICY/);

  const newInputs = { ...inputsFixture([{ level: 'unit', capability: 'unit:node:test' }]), inputDigest: sha('full-input-r2') };
  const staleInput = evaluate(newInputs, [entry], POLICY);
  assert.equal(staleInput.verdict, 'blocked');
  assert.match(staleInput.receipt.blocked.join('\n'), /STALE_INPUT/);
});

test('tampered receipts (entry digest not matching its envelope) are blocked', () => {
  const launcher = createLaunchAuthority({ secret: crypto.randomBytes(32).toString('hex') });
  const entry = admitOne(launcher);
  const tampered = { ...entry, envelope: { ...entry.envelope, result: 'pass', executions: { total: 9, valid: 9 } } };
  const result = evaluate(inputsFixture([{ level: 'unit', capability: 'unit:node:test' }]), [tampered], POLICY);
  assert.equal(result.verdict, 'blocked');
  assert.match(result.receipt.blocked.join('\n'), /TAMPERED_RECEIPT/);
  assert.deepEqual(result.receipt.requiredDenominator, { required: 1, valid: 0 });
});

test('with zero receipts the receipt still validates (empty evidence set digest, honest blocked verdict)', () => {
  const result = evaluate(inputsFixture([{ level: 'unit', capability: 'unit:node:test' }]), [], POLICY);
  assert.equal(result.verdict, 'blocked');
  assert.match(result.receipt.blocked.join('\n'), /MISSING_OBSERVATION: required check unit\/unit:node:test/);
  assert.equal(result.receipt.evidence.length, 1, 'the judged empty set is digested, never fabricated into data');
  assert.deepEqual(result.receipt.sourceAttestation, { origin: 'none', execution: 'none' });
  const parsed = parseContract('SDD.Delivery.GateReceipt', result.receipt);
  assert.equal(parsed.ok, true, `blocked receipt must still satisfy the schema: ${parsed.errors?.join('; ') ?? ''}`);
});

test('the gate refuses to judge without a valid frozen TestContract or policy', () => {
  const broken = contractFixture([{ level: 'unit', capability: 'unit:node:test' }]);
  delete broken.requiredChecks;
  assert.throws(() => evaluate({ inputDigest: INPUT, testContract: broken, builderExecution: 'exec-builder-1' }, [], POLICY), /INVALID_TEST_CONTRACT/);
  assert.throws(() => evaluate(inputsFixture([{ level: 'unit', capability: 'unit:node:test' }]), [], { ref: 'p', digest: 'nope' }), /INVALID_POLICY/);
});

test('evaluate is pure: deterministic output, no filesystem side effects, no stage writes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-p22-purity-'));
  const launcher = createLaunchAuthority({ secret: crypto.randomBytes(32).toString('hex') });
  const entry = admitOne(launcher);
  const gateInputs = inputsFixture([{ level: 'unit', capability: 'unit:node:test' }]);
  const before = fs.readdirSync(dir).sort();
  const first = evaluate(gateInputs, [entry], POLICY);
  const second = evaluate(gateInputs, [entry], POLICY);
  const after = fs.readdirSync(dir).sort();
  assert.deepEqual(before, after, 'evaluation must not create or modify any file');
  assert.deepEqual(first, second, 'same inputs must produce the same verdict and receipt');
  // SDD.Gate.v1 boundary is structural too: the module imports no execution
  // or persistence channel at all.
  const gateSource = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../lib/delivery/gate.js'), 'utf8');
  assert.doesNotMatch(gateSource, /node:fs|node:child_process|spawnSync|writeFile/);
});

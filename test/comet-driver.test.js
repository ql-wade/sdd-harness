// P1_3 — Comet managed driver layering, Runner binding without a phase write
// surface, and single spec/verification closeout ownership (F05/F07, A09
// unit-level base, OV01/OV03 judgments; task 1.3.a and 1.3.c).
//
// Boundary (delivery-foundation spec + classic-closeout-and-hook-contract.md):
// a write driver and a read-only observer must be machine-distinguishable
// (F05: a read-only prompt driver asked to write product files is refused and
// the verified managed write executor is named); the Runner binds
// run/gate/input/policy/attempt/epoch via the P2_2 trusted launcher
// (Runner.Dispatch.v1) and stores no phase of its own — there is no phase
// write surface on the runner interface; closeout is single-owner (one
// verification execution, one archive seal) with an explicit refusal for a
// duplicate archive request (Comet.Run.managedDelivery.v1: no second
// controller). Channel-specific probing lives in test/delivery-cases/1_3.mjs.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const harness = await import('../lib/adapters/harness.js');
const comet = await import('../lib/adapters/comet.js');
const { createLaunchAuthority } = await import('../lib/delivery/evidence.js');
const gateModule = await import('../lib/delivery/gate.js');

const sha = (label) => crypto.createHash('sha256').update(label).digest('hex');
const SECRET = crypto.randomBytes(32).toString('hex');

const bindingFixture = (overrides = {}) => ({
  runnerId: 'comet-classic',
  run: 'run-31430922',
  gate: 'V',
  inputDigest: sha('candidate-input-r1'),
  policyDigest: sha('policy/managed-pilot@r1'),
  attempt: 1,
  epoch: 1,
  role: 'verifier',
  execution: 'exec-verifier-1',
  ...overrides,
});

function envelopeFixture(overrides = {}) {
  return {
    candidateDigest: sha('candidate-input-r1'),
    caseId: 'case-1',
    origin: { kind: 'harness', id: 'comet-classic' },
    execution: { id: 'exec-verifier-1' },
    environment: 'env-1',
    toolchain: 'node-24',
    executions: { total: 3, valid: 3 },
    result: 'pass',
    evidence: [{ uri: 'file:///tmp/obs.log', sha256: sha('obs-log-bytes') }],
    expiry: '2099-01-01T00:00:00.000Z',
    ...overrides,
  };
}

test('F05: drivers are machine-distinguishable by a frozen kind marker', () => {
  assert.deepEqual(harness.DRIVER_KINDS, ['managed-write', 'read-only']);
  const observer = harness.defineDriver({ id: 'prompt-observer', kind: 'read-only' });
  const writer = harness.defineDriver({
    id: 'comet-managed',
    kind: 'managed-write',
    execute: () => ({ exitCode: 0 }),
  });
  assert.equal(observer.kind, 'read-only');
  assert.equal(writer.kind, 'managed-write');
  assert.ok(Object.isFrozen(observer) && Object.isFrozen(writer));
});

test('F05: a read-only driver cannot carry an execute surface at all', () => {
  assert.throws(
    () => harness.defineDriver({ id: 'fake-observer', kind: 'read-only', execute: () => {} }),
    (error) => error.code === 'DRIVER_SURFACE_REFUSED',
  );
  const observer = harness.defineDriver({ id: 'prompt-observer', kind: 'read-only' });
  assert.equal(observer.execute, undefined, 'read-only driver must not expose an execute surface');
});

test('F05: using a read-only driver for product writes is refused and names the managed executor', () => {
  const observer = harness.defineDriver({ id: 'prompt-observer', kind: 'read-only' });
  assert.throws(
    () => harness.requireWriteDriver(observer, 'write product tests'),
    (error) => error.code === 'DRIVER_WRITE_REFUSED'
      && /managed write executor/.test(error.message)
      && /prompt-observer/.test(error.message),
  );
  const writer = harness.defineDriver({
    id: 'comet-managed',
    kind: 'managed-write',
    execute: () => ({ exitCode: 0 }),
  });
  assert.equal(harness.requireWriteDriver(writer, 'write product tests'), writer);
});

test('Runner.Dispatch.v1: the runner binds run/gate/input/policy/attempt/epoch/execution', () => {
  const authority = createLaunchAuthority({ secret: SECRET });
  const writer = harness.defineDriver({
    id: 'comet-managed',
    kind: 'managed-write',
    execute: () => ({ exitCode: 0 }),
  });
  const runner = harness.createRunner({ authority, driver: writer });
  const dispatch = runner.dispatch(bindingFixture());
  for (const key of ['runnerId', 'run', 'gate', 'inputDigest', 'policyDigest', 'attempt', 'epoch', 'role', 'execution', 'integrity']) {
    assert.ok(dispatch[key] !== undefined, `dispatch must bind ${key}`);
  }
  assert.equal(authority.verifyDispatch(dispatch).ok, true);
});

test('Runner.Dispatch.v1: the runner interface has no phase write surface', () => {
  const authority = createLaunchAuthority({ secret: SECRET });
  const writer = harness.defineDriver({
    id: 'comet-managed',
    kind: 'managed-write',
    execute: () => ({ exitCode: 0 }),
  });
  const runner = harness.createRunner({ authority, driver: writer });
  assert.deepEqual(
    Object.keys(runner).sort(),
    ['admit', 'dispatch', 'verify'],
    'the runner must expose only dispatch/verify/admit — no phase storage, no control-state writer',
  );
  assert.throws(
    () => runner.dispatch(bindingFixture({ phase: 'build' })),
    (error) => error.code === 'RUNNER_PHASE_FIELD_REFUSED',
    'a phase field in a dispatch binding is a control-state write attempt and must be refused',
  );
  assert.throws(
    () => runner.dispatch(bindingFixture({ currentPhase: 'build' })),
    (error) => error.code === 'RUNNER_PHASE_FIELD_REFUSED',
  );
});

test('Runner.Dispatch.v1: a read-only driver cannot back a dispatching runner', () => {
  const authority = createLaunchAuthority({ secret: SECRET });
  const observer = harness.defineDriver({ id: 'prompt-observer', kind: 'read-only' });
  assert.throws(
    () => harness.createRunner({ authority, driver: observer }),
    (error) => error.code === 'DRIVER_WRITE_REFUSED',
  );
});

test('F07: a replayed receipt from the same execution is refused, not double-counted', () => {
  const authority = comet.cometLaunchAuthority({ secret: SECRET, runId: 'run-31430922' });
  const writer = harness.defineDriver({
    id: 'comet-managed',
    kind: 'managed-write',
    execute: () => ({ exitCode: 0 }),
  });
  const runner = harness.createRunner({ authority, driver: writer });
  const dispatch = runner.dispatch(bindingFixture({ runnerId: 'comet-classic', run: 'run-31430922' }));
  const current = {
    inputDigest: sha('candidate-input-r1'),
    policyDigest: sha('policy/managed-pilot@r1'),
    environment: 'env-1',
  };
  const first = runner.admit({ envelope: envelopeFixture(), dispatch, current });
  assert.equal(first.ok, true, `first admission should succeed: ${JSON.stringify(first)}`);
  const replay = runner.admit({ envelope: envelopeFixture(), dispatch, current, issuedExecutions: ['exec-verifier-1'] });
  assert.equal(replay.ok, false);
  assert.equal(replay.error, 'DUPLICATE_ISSUANCE', 'a duplicate receipt must be refused (F07: duplicate/out-of-order receipts)');
});

test('F07: a receipt whose input rotated after dispatch is refused as stale', () => {
  const authority = comet.cometLaunchAuthority({ secret: SECRET, runId: 'run-31430922' });
  const writer = harness.defineDriver({
    id: 'comet-managed',
    kind: 'managed-write',
    execute: () => ({ exitCode: 0 }),
  });
  const runner = harness.createRunner({ authority, driver: writer });
  const dispatch = runner.dispatch(
    bindingFixture({ runnerId: 'comet-classic', run: 'run-31430922', inputDigest: sha('candidate-input-r1') }),
  );
  const current = {
    inputDigest: sha('candidate-input-r2'),
    policyDigest: sha('policy/managed-pilot@r1'),
    environment: 'env-1',
  };
  const stale = runner.admit({ envelope: envelopeFixture(), dispatch, current });
  assert.equal(stale.ok, false);
  assert.equal(stale.error, 'STALE_CANDIDATE');
});

test('F07/A06: the builder execution cannot sign verification evidence', () => {
  const authority = comet.cometLaunchAuthority({ secret: SECRET, runId: 'run-31430922' });
  const writer = harness.defineDriver({
    id: 'comet-managed',
    kind: 'managed-write',
    execute: () => ({ exitCode: 0 }),
  });
  const runner = harness.createRunner({ authority, driver: writer });
  const builderDispatch = runner.dispatch(
    bindingFixture({ runnerId: 'comet-classic', run: 'run-31430922', role: 'builder', execution: 'exec-builder-1' }),
  );
  const refused = runner.admit({
    envelope: envelopeFixture({ execution: { id: 'exec-builder-1' } }),
    dispatch: builderDispatch,
    current: { inputDigest: sha('candidate-input-r1'), policyDigest: sha('policy/managed-pilot@r1'), environment: 'env-1' },
  });
  assert.equal(refused.ok, false);
  assert.equal(refused.error, 'IDENTITY_CONFLICT');
});

test('1.3.c: closeout requires the knowledge obligation before the archive seal', () => {
  const seal = {
    change: 'probe-change',
    phase: 'archive',
    verifyResult: 'pass',
    archiveConfirmation: 'confirmed',
    archived: false,
    checkEpoch: 5,
  };
  assert.throws(
    () => comet.sealCloseout({ seal, execution: 'exec-closeout-1' }),
    (error) => error.code === 'KNOWLEDGE_CLOSEOUT_REQUIRED',
    'Knowledge.Closeout.v1: Kp must precede the archive seal',
  );
  const receipt = comet.sealCloseout({ seal, execution: 'exec-closeout-1', knowledgeCloseout: { id: 'Kp-1', digest: sha('kp') } });
  assert.equal(receipt.change, 'probe-change');
  assert.equal(receipt.execution, 'exec-closeout-1');
  assert.ok(Object.isFrozen(receipt));
});

test('1.3.c: a duplicate archive request from a second execution is refused at the driver layer', () => {
  const seal = {
    change: 'probe-change',
    phase: 'archive',
    verifyResult: 'pass',
    archiveConfirmation: 'confirmed',
    archived: false,
    checkEpoch: 5,
  };
  const first = comet.sealCloseout({ seal, execution: 'exec-closeout-1', knowledgeCloseout: { id: 'Kp-1', digest: sha('kp') } });
  assert.equal(first.archived, true);
  assert.throws(
    () => comet.sealCloseout({ seal, execution: 'exec-closeout-2', knowledgeCloseout: { id: 'Kp-1', digest: sha('kp') } }),
    (error) => error.code === 'ARCHIVE_ALREADY_SEALED',
    'the second closeout execution must be refused even though the upstream CLI converges idempotently',
  );
  assert.throws(
    () => comet.sealCloseout({ seal, execution: 'exec-closeout-1', knowledgeCloseout: { id: 'Kp-1', digest: sha('kp') } }),
    (error) => error.code === 'ARCHIVE_ALREADY_SEALED',
    'even a replay by the same execution is a second closeout and is refused',
  );
});

test('1.3.c/SDD.Gate.v1: the driver reuses the pure gate judgment unmodified and it is deterministic', () => {
  assert.equal(comet.evaluateGate, gateModule.evaluate, 'evaluateGate must be the delivery gate itself (import, not a copy)');
  const authority = comet.cometLaunchAuthority({ secret: SECRET, runId: 'run-31430922' });
  const writer = harness.defineDriver({
    id: 'comet-managed',
    kind: 'managed-write',
    execute: () => ({ exitCode: 0 }),
  });
  const runner = harness.createRunner({ authority, driver: writer });
  const dispatch = runner.dispatch(bindingFixture({ runnerId: 'comet-classic', run: 'run-31430922' }));
  const current = {
    inputDigest: sha('candidate-input-r1'),
    policyDigest: sha('policy/managed-pilot@r1'),
    environment: 'env-1',
  };
  const admitted = runner.admit({ envelope: envelopeFixture({ check: 'console' }), dispatch, current });
  assert.equal(admitted.ok, true);
  const inputs = { inputDigest: sha('candidate-input-r1'), builderExecution: 'exec-builder-1', testContract: comet.gateTestContractFixture(['console']) };
  const policy = { ref: 'policy/managed-pilot@r1', digest: sha('policy/managed-pilot@r1') };
  const first = comet.evaluateGate(inputs, [admitted.entry], policy);
  const second = comet.evaluateGate(inputs, [admitted.entry], policy);
  assert.equal(first.verdict, 'pass');
  assert.equal(first.verdict, second.verdict);
  assert.deepEqual(first.receipt, second.receipt, 'identical inputs must produce a byte-identical receipt');
});

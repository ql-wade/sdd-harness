// Evidence admission and identity binding (tasks 2.2.a / 2.2.c, A05/A06/A18,
// B03 class rule, B07 import boundary, A19 local half).
//
// Design boundary (delivery-architecture.md section 4): a digest proves
// content binding only — origin trust is decided at admission, against a
// dispatch record issued by the trusted launcher (Runner.Dispatch.v1 local
// equivalent: the launcher binds run/gate/input/policy/attempt/epoch with a
// keyed digest). Envelope role labels, origin strings and env strings grant
// nothing. What a worker process can forge locally is refused here; real
// protected-Runner / release-key isolation is proven by real permission
// negatives on the managed Runner (explicitly out of scope for local files).
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { parseTapSummary } from '../lib/delivery/test-contract.js';
import {
  admitEvidence,
  createLaunchAuthority,
  envelopeDigest,
} from '../lib/delivery/evidence.js';

const sha = (label) => crypto.createHash('sha256').update(label).digest('hex');
const NOW = '2026-10-20T12:00:00.000Z';

function authority() {
  return createLaunchAuthority({ secret: crypto.randomBytes(32).toString('hex') });
}

function currentFixture() {
  return {
    inputDigest: sha('full-input-r1'),
    policyDigest: sha('policy/managed-pilot@r1'),
    environment: 'managed-pilot-env-1',
  };
}

function verifierDispatch(launcher, overrides = {}) {
  return launcher.issueDispatch({
    runnerId: 'runner-1',
    run: 'run-1',
    gate: 'V',
    inputDigest: sha('full-input-r1'),
    policyDigest: sha('policy/managed-pilot@r1'),
    attempt: 1,
    epoch: 1,
    role: 'verifier',
    execution: 'exec-verifier-1',
    ...overrides,
  });
}

function envelopeFixture(overrides = {}) {
  return {
    schemaVersion: 1,
    candidateDigest: sha('full-input-r1'),
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

function admit(launcher, { envelope, dispatch, current, issuedExecutions = [], now = NOW } = {}) {
  return admitEvidence({
    envelope,
    dispatch,
    authority: launcher,
    current: current ?? currentFixture(),
    issuedExecutions,
    now,
  });
}

test('A05: an envelope with no authority-issued dispatch is refused as an unregistered source, audit kept', () => {
  // The builder self-writes a pass JSON. No dispatch record exists.
  const refused = admit(authority(), { envelope: envelopeFixture() });
  assert.equal(refused.ok, false);
  assert.equal(refused.error, 'UNREGISTERED_SOURCE');
  assert.match(refused.reason, /no authority-issued dispatch/);
  assert.equal(refused.audit.origin, 'runner-1', 'the audit record names the claimed origin');
  assert.equal(refused.audit.execution, 'exec-verifier-1');
  assert.equal(refused.audit.caseId, 'c1');
  assert.equal(refused.audit.envelopeDigest, envelopeDigest(envelopeFixture()));
});

test('A05: a self-declared role label or origin string grants nothing', () => {
  // Hand-written envelopes claiming to be an independent verifier through
  // different label fields — both refused, because trust comes only from the
  // launcher's dispatch record, never from envelope fields.
  const launcher = authority();
  const viaOriginKind = envelopeFixture({ origin: { kind: 'independent-verifier', id: 'runner-1' } });
  assert.equal(admit(launcher, { envelope: viaOriginKind }).error, 'UNREGISTERED_SOURCE');
  const viaCheckName = envelopeFixture({ check: 'verifier-approved unit:node:test' });
  assert.equal(admit(launcher, { envelope: viaCheckName }).error, 'UNREGISTERED_SOURCE');
});

test('2.2.c: a forged dispatch record (fixture or worker-built) fails the launcher integrity check', () => {
  const launcher = authority();
  const genuine = verifierDispatch(launcher);
  const mutations = [
    (d) => ({ ...d, inputDigest: sha('other-input') }),
    (d) => ({ ...d, attempt: 2 }),
    (d) => ({ ...d, epoch: 2 }),
    (d) => ({ ...d, runnerId: 'runner-2' }),
    (d) => ({ ...d, role: 'test-author' }),
  ];
  for (const mutation of mutations) {
    const forged = mutation(genuine);
    const refused = admit(launcher, { envelope: envelopeFixture(), dispatch: forged });
    assert.equal(refused.ok, false, `a ${Object.keys(mutation(genuine)).length}-field dispatch must be verified`);
    assert.equal(refused.error, 'FORGED_DISPATCH');
    assert.match(refused.reason, /integrity/);
  }
  // A completely hand-built dispatch shaped like a real one is equally refused.
  const handBuilt = verifierDispatch(launcher);
  handBuilt.integrity = sha('guess');
  assert.equal(admit(launcher, { envelope: envelopeFixture(), dispatch: handBuilt }).error, 'FORGED_DISPATCH');
});

test('A06: the builder execution cannot sign acceptance evidence (identity conflict)', () => {
  const launcher = authority();
  const builderDispatch = verifierDispatch(launcher, { role: 'builder', execution: 'exec-builder-1' });
  const refused = admit(launcher, {
    envelope: envelopeFixture({ execution: { id: 'exec-builder-1' } }),
    dispatch: builderDispatch,
  });
  assert.equal(refused.ok, false);
  assert.equal(refused.error, 'IDENTITY_CONFLICT');
  assert.match(refused.reason, /builder execution/);
});

test('A06: verifier evidence is admitted only when pinned to the dispatch the launcher issued', () => {
  const launcher = authority();
  const dispatch = verifierDispatch(launcher);
  // The envelope may not re-declare who ran: execution/origin/candidate are
  // pinned to the dispatch binding, so a re-declared field is refused.
  const swapped = envelopeFixture({ execution: { id: 'exec-verifier-2' } });
  const mismatch = admit(launcher, { envelope: swapped, dispatch });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.error, 'EXECUTION_BINDING_MISMATCH');

  const otherRunner = envelopeFixture({ origin: { kind: 'registered-runner', id: 'runner-2' } });
  assert.equal(admit(launcher, { envelope: otherRunner, dispatch }).error, 'ORIGIN_BINDING_MISMATCH');

  const otherCandidate = envelopeFixture({ candidateDigest: sha('full-input-r2') });
  assert.equal(admit(launcher, { envelope: otherCandidate, dispatch }).error, 'CANDIDATE_BINDING_MISMATCH');

  const accepted = admit(launcher, { envelope: envelopeFixture(), dispatch });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.entry.class, 'independent-acceptance', 'the class comes from the dispatch role');
  assert.equal(accepted.entry.origin, 'runner-1');
  assert.equal(accepted.entry.execution, 'exec-verifier-1');
  assert.equal(accepted.entry.digest, envelopeDigest(envelopeFixture()));
});

test('A06: the same execution identity cannot issue evidence twice (duplicate issuance refused)', () => {
  const launcher = authority();
  const dispatch = verifierDispatch(launcher);
  const first = admit(launcher, { envelope: envelopeFixture(), dispatch });
  assert.equal(first.ok, true);
  const second = admit(launcher, {
    envelope: envelopeFixture({ caseId: 'c2', check: 'unit:node:test:c2' }),
    dispatch,
    issuedExecutions: [first.entry.execution],
  });
  assert.equal(second.ok, false);
  assert.equal(second.error, 'DUPLICATE_ISSUANCE');
  assert.match(second.reason, /exec-verifier-1 already issued/);
});

test('receipts bound to an old policy digest are refused (STALE_POLICY)', () => {
  const launcher = authority();
  const dispatch = verifierDispatch(launcher, { policyDigest: sha('policy/managed-pilot@r0') });
  const refused = admit(launcher, { envelope: envelopeFixture(), dispatch });
  assert.equal(refused.ok, false);
  assert.equal(refused.error, 'STALE_POLICY');
  assert.match(refused.reason, new RegExp(sha('policy/managed-pilot@r0')), 'the refusal names the stale bound digest');
});

test('receipts bound to an old candidate input digest are refused (STALE_CANDIDATE)', () => {
  const launcher = authority();
  const staleDigest = sha('full-input-r0');
  // Envelope and dispatch agree with each other but both lag the current input.
  const dispatch = verifierDispatch(launcher, { inputDigest: staleDigest });
  const refused = admit(launcher, { envelope: envelopeFixture({ candidateDigest: staleDigest }), dispatch });
  assert.equal(refused.ok, false);
  assert.equal(refused.error, 'STALE_CANDIDATE');
  assert.match(refused.reason, new RegExp(sha('full-input-r0')), 'the refusal names the stale bound digest');
});

test('receipts observed in a different environment are refused (STALE_ENVIRONMENT)', () => {
  const launcher = authority();
  const dispatch = verifierDispatch(launcher);
  const refused = admit(launcher, {
    envelope: envelopeFixture({ environment: 'managed-pilot-env-0' }),
    dispatch,
  });
  assert.equal(refused.ok, false);
  assert.equal(refused.error, 'STALE_ENVIRONMENT');
  assert.match(refused.reason, /managed-pilot-env-0/);
});

test('expired envelopes are refused', () => {
  const launcher = authority();
  const dispatch = verifierDispatch(launcher);
  const refused = admit(launcher, {
    envelope: envelopeFixture({ expiry: '2026-10-19T00:00:00.000Z' }),
    dispatch,
  });
  assert.equal(refused.ok, false);
  assert.equal(refused.error, 'EXPIRED_ENVELOPE');
});

test('A18: a pass claim without real observation data is refused at admission', () => {
  const launcher = authority();
  const dispatch = verifierDispatch(launcher);
  const zeroValid = admit(launcher, {
    envelope: envelopeFixture({ executions: { total: 3, valid: 0 } }),
    dispatch,
  });
  assert.equal(zeroValid.ok, false);
  assert.equal(zeroValid.error, 'NO_OBSERVATION');
  assert.match(zeroValid.reason, /no real observation data/);

  const malformedCounts = admit(launcher, {
    envelope: envelopeFixture({ executions: { total: 1, valid: 3 } }),
    dispatch,
  });
  assert.equal(malformedCounts.ok, false);
  assert.equal(malformedCounts.error, 'NO_OBSERVATION');
  assert.match(malformedCounts.reason, /valid executions exceed/);
});

test('A18: a truthful unverified envelope (capability missing, real probe log attached) is admitted to block the gate', () => {
  const launcher = authority();
  const dispatch = verifierDispatch(launcher);
  const unverified = envelopeFixture({
    result: 'unverified',
    executions: { total: 0, valid: 0 },
    evidence: [{ uri: '.whitebox/c1/console-probe.err', sha256: sha('console-not-available') }],
  });
  const admitted = admit(launcher, { envelope: unverified, dispatch });
  assert.equal(admitted.ok, true, 'missing capability must be recordable as unverified, never fabricated into pass');
  assert.equal(admitted.entry.envelope.result, 'unverified');
});

test('B03: test-author execution evidence is admitted only as authoring self-check', () => {
  const launcher = authority();
  const dispatch = verifierDispatch(launcher, { role: 'test-author', execution: 'exec-author-1' });
  const admitted = admit(launcher, {
    envelope: envelopeFixture({ execution: { id: 'exec-author-1' } }),
    dispatch,
  });
  assert.equal(admitted.ok, true);
  assert.equal(admitted.entry.class, 'authoring-self-check');
  assert.notEqual(admitted.entry.class, 'independent-acceptance');
});

test('B07: imported reports with an incompatible contract version are refused explicitly, never field-fabricated', () => {
  const launcher = authority();
  const dispatch = verifierDispatch(launcher);
  const legacy = envelopeFixture();
  legacy.schemaVersion = 0;
  const legacyRefused = admit(launcher, { envelope: legacy, dispatch });
  assert.equal(legacyRefused.ok, false);
  assert.equal(legacyRefused.error, 'INVALID_ENVELOPE');
  assert.match(legacyRefused.reason, /older than supported/);

  const future = envelopeFixture();
  future.schemaVersion = 2;
  const futureRefused = admit(launcher, { envelope: future, dispatch });
  assert.equal(futureRefused.ok, false);
  assert.equal(futureRefused.error, 'INVALID_ENVELOPE');
  assert.match(futureRefused.reason, /newer than supported/);

  const missingField = envelopeFixture();
  delete missingField.executions;
  const missingRefused = admit(launcher, { envelope: missingField, dispatch });
  assert.equal(missingRefused.ok, false);
  assert.equal(missingRefused.error, 'INVALID_ENVELOPE');
  assert.match(missingRefused.reason, /executions/);
});

test('A19 (local half): the launch authority never exposes its signing secret', () => {
  const secret = crypto.randomBytes(32).toString('hex');
  const launcher = createLaunchAuthority({ secret });
  const dispatch = verifierDispatch(launcher);
  const surfaces = [launcher, dispatch, JSON.stringify(launcher), JSON.stringify(dispatch)];
  for (const surface of surfaces) {
    assert.ok(!String(surface).includes(secret), 'the secret must not appear on any exported surface');
  }
  assert.deepEqual(Object.keys(launcher).sort(), ['collectResult', 'issueDispatch', 'verifyCollection', 'verifyDispatch']);
});

test('2.2.c: a worker process that does not inherit the launcher secret cannot mint a dispatch (real spawnSync)', () => {
  // Local equivalent of Runner.Dispatch.v1's "worker cannot write control
  // state": the child gets the public binding fields only (no secret in its
  // environment) and writes a self-signed envelope plus a forged dispatch.
  // The parent's admission refuses the forgery.
  const launcher = authority();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-p22-worker-'));
  const workerScript = path.join(dir, 'worker.mjs');
  fs.writeFileSync(workerScript, [
    "import fs from 'node:fs';",
    "import crypto from 'node:crypto';",
    'const binding = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));',
    'const envelope = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));',
    'const forged = {',
    '  ...binding,',
    '  integrity: crypto.createHash("sha256").update(JSON.stringify(binding)).digest("hex"),',
    '};',
    'fs.writeFileSync(process.argv[4], JSON.stringify({ envelope, dispatch: forged }));',
    '',
  ].join('\n'));
  const binding = {
    runnerId: 'runner-1',
    run: 'run-1',
    gate: 'V',
    inputDigest: sha('full-input-r1'),
    policyDigest: sha('policy/managed-pilot@r1'),
    attempt: 1,
    epoch: 1,
    role: 'verifier',
    execution: 'exec-verifier-1',
  };
  const bindingPath = path.join(dir, 'binding.json');
  const envelopePath = path.join(dir, 'self-signed-envelope.json');
  const productPath = path.join(dir, 'worker-product.json');
  fs.writeFileSync(bindingPath, JSON.stringify(binding));
  fs.writeFileSync(envelopePath, JSON.stringify(envelopeFixture()));
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const run = spawnSync(process.execPath, [workerScript, bindingPath, envelopePath, productPath], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 30000,
    env,
  });
  assert.equal(run.status, 0, `worker precondition failed: ${run.stderr}`);

  const product = JSON.parse(fs.readFileSync(productPath, 'utf8'));
  assert.equal(product.dispatch.role, 'verifier', 'the worker forged a well-shaped verifier dispatch');
  assert.equal(product.envelope.result, 'pass', 'the worker self-signed a pass envelope');
  const refused = admit(launcher, { envelope: product.envelope, dispatch: product.dispatch });
  assert.equal(refused.ok, false, 'the forgery must not be admitted');
  assert.equal(refused.error, 'FORGED_DISPATCH');
});

test('envelopeDigest binds envelope content deterministically', () => {
  const base = envelopeFixture();
  assert.equal(envelopeDigest(base), envelopeDigest(envelopeFixture()));
  const copy = JSON.parse(JSON.stringify(base));
  assert.equal(envelopeDigest(base), envelopeDigest(copy), 'JSON round-trip must not change the digest (key order independence)');
  assert.notEqual(envelopeDigest(base), envelopeDigest(envelopeFixture({ result: 'fail' })));
  assert.notEqual(envelopeDigest(base), envelopeDigest(envelopeFixture({ executions: { total: 4, valid: 2 } })));
  assert.match(envelopeDigest(base), /^[a-f0-9]{64}$/);
});

test('protected managed admission cannot be downgraded by worker profile flags or legacy dispatch', () => {
  const launcher = authority();
  const dispatch = verifierDispatch(launcher);
  const args = { envelope: { ...envelopeFixture(), profile: 'comet-managed-v2', trusted: true }, dispatch, authority: launcher, current: currentFixture(), now: NOW };
  const result = admitEvidence(args, { requireManaged: true });
  assert.equal(result.ok, false);
  assert.equal(result.managedClosureEligible, false);
  const compatible = admitEvidence(args);
  assert.equal(compatible.ok, true);
  assert.equal(compatible.scope, 'component/dispatch-binding');
  assert.equal(compatible.managedClosureEligible, false);
  assert.equal(compatible.entry.managedClosureEligible, false);
});

function actionBindingFixture(overrides = {}) {
  return {
    schemaVersion: 1, profile: 'comet-managed-v2', runnerId: 'runner-1', run: 'run-1', action: 'verify-case', gate: 'V', execution: 'exec-verifier-1', role: 'verifier', revision: 'revision-1', attempt: 1, epoch: 1,
    inputDigest: sha('full-input-r1'), policyDigest: sha('policy/managed-pilot@r1'), environmentDigest: sha('environment-r1'),
    workPackage: { id: 'wp-1', taskIds: ['2.2.a'] },
    methods: [{ name: 'whitebox-verify', version: '1.0.0', ref: '.agents/skills/whitebox-verify/SKILL.md', digest: sha('method-r1') }],
    allowedPaths: ['.whitebox'], allowedTools: ['read_file'], inputs: [{ name: 'candidate', ref: 'src/app.js', digest: sha('candidate') }], outputs: [{ name: 'report', ref: '.whitebox/report.json' }], ...overrides,
  };
}

test('dispatch integrity binds the complete validated ActionBinding rather than silently discarding it', () => {
  const launcher = authority(); const actionBinding = actionBindingFixture();
  const dispatch = verifierDispatch(launcher, { actionBinding });
  assert.deepEqual(dispatch.actionBinding, actionBinding);
  for (const mutate of [(b) => { b.revision = 'revision-2'; }, (b) => { b.environmentDigest = sha('environment-r2'); }, (b) => { b.methods[0].digest = sha('method-r2'); }, (b) => { b.workPackage.id = 'wp-other'; }, (b) => { b.allowedTools = ['shell']; }]) {
    const changed = structuredClone(dispatch); mutate(changed.actionBinding);
    assert.equal(launcher.verifyDispatch(changed).ok, false);
  }
  assert.throws(() => verifierDispatch(launcher, { actionBinding: { ...actionBinding, run: 'other-run' } }), /binding/i);
});

test('collection is unavailable without a protected source verifier and refuses boolean self-qualification', async () => {
  const launcher = authority(); const dispatch = verifierDispatch(launcher, { actionBinding: actionBindingFixture() });
  const args = { dispatch, envelope: envelopeFixture(), launchRecord: { launchId: 'launch-1', execution: 'exec-verifier-1' }, reportBytes: Buffer.from('untrusted report'), resultBytes: Buffer.from('untrusted result'), methodTraceBytes: Buffer.from('read skill') };
  const missing = await launcher.collectResult(args);
  assert.equal(missing.ok, false); assert.equal(missing.error, 'SOURCE_UNQUALIFIED');
  const selfQualified = createLaunchAuthority({ secret: crypto.randomBytes(32).toString('hex'), sourceVerifier: async () => true });
  const own = verifierDispatch(selfQualified, { actionBinding: actionBindingFixture() });
  const refused = await selfQualified.collectResult({ ...args, dispatch: own, trusted: true, role: 'verifier' });
  assert.equal(refused.ok, false); assert.equal(refused.error, 'SOURCE_UNQUALIFIED');
});

const canonical = (value) => value && typeof value === 'object'
  ? Array.isArray(value) ? value.map(canonical) : Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const jsonSha = (value) => shaBytes(JSON.stringify(canonical(value)));
const shaBytes = (value) => crypto.createHash('sha256').update(value).digest('hex');

async function collectedProcessFixture(qualificationScope = 'component-local') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p22-collected-'));
  try {
    const file = path.join(root, 'observed.test.mjs');
    fs.writeFileSync(file, "import test from 'node:test'; import assert from 'node:assert/strict'; test('actual arithmetic assertion', () => assert.equal(2 + 3, 5));\n");
    const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
    const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap', 'observed.test.mjs'], { cwd: root, env, encoding: 'utf8' });
    assert.equal(run.status, 0);
    const measured = parseTapSummary(run.stdout);
    const reportBytes = Buffer.from(run.stdout), resultBytes = Buffer.from(JSON.stringify({ exitCode: run.status, stdout: run.stdout }));
    const methodTraceBytes = Buffer.from(JSON.stringify({ event: 'actual-process-exit', exitCode: run.status, methodApplication: 'UNVERIFIED' }));
    const actionBinding = actionBindingFixture();
    const qualification = { id: 'protocol-fixture-only', sourceId: 'local-process-port', revision: 'q1', scope: qualificationScope, status: 'qualified', expiresAt: '2026-11-01T00:00:00.000Z', evidenceRefs: [{ ref: 'local-test-only/not-deployment-proof', digest: shaBytes(reportBytes) }] };
    const launcher = createLaunchAuthority({ secret: crypto.randomBytes(32).toString('hex'), sourceVerifier: async (request) => {
      // Test-local recorded process readback, not echo of expected/worker facts.
      if (shaBytes(request.reportBytes) !== shaBytes(reportBytes) || shaBytes(request.resultBytes) !== shaBytes(resultBytes)
        || shaBytes(request.methodTraceBytes) !== shaBytes(methodTraceBytes) || jsonSha(request.launchRecord) !== jsonSha(packet.launchRecord)) return { ok: false };
      return { ok: true, qualification, facts: {
        actionDigest: jsonSha(actionBinding), dispatchDigest: jsonSha(dispatch), envelopeDigest: envelopeDigest(envelope),
        launchDigest: jsonSha(packet.launchRecord), reportDigest: shaBytes(reportBytes), resultDigest: shaBytes(resultBytes), methodTraceDigest: shaBytes(methodTraceBytes),
        run: actionBinding.run, execution: actionBinding.execution, launchId: packet.launchRecord.launchId, environmentDigest: actionBinding.environmentDigest, principal: 'protocol-fixture-principal',
        observations: [{ caseId: envelope.caseId, check: envelope.check, command: 'node --test --test-reporter=tap observed.test.mjs', result: run.status === 0 ? 'pass' : 'fail', executions: { total: measured.tests, valid: measured.pass + measured.fail } }],
      } };
    } });
    const dispatch = verifierDispatch(launcher, { actionBinding });
    const envelope = envelopeFixture({ executions: { total: 1, valid: 1 }, evidence: [{ uri: '.whitebox/real-process.txt', sha256: shaBytes(reportBytes) }] });
    const packet = { dispatch, envelope, launchRecord: { launchId: 'actual-local-process', execution: dispatch.execution, processId: run.pid, exitCode: run.status }, reportBytes, resultBytes, methodTraceBytes };
    const collected = await launcher.collectResult(packet); assert.equal(collected.ok, true);
    return { launcher, actionBinding, qualification, packet, collection: collected.collection };
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test('collected source signatures bind actual subprocess report/result/trace bytes, launch and envelope contents', async () => {
  const f = await collectedProcessFixture();
  assert.equal(f.launcher.verifyCollection({ ...f.packet, collection: f.collection }).ok, true);
  for (const change of [
    { reportBytes: Buffer.from('different original report') }, { resultBytes: Buffer.from('different result') }, { methodTraceBytes: Buffer.from('read-only skill claim') },
    { launchRecord: { ...f.packet.launchRecord, launchId: 'other-launch' } }, { envelope: { ...f.packet.envelope, check: 'console' } },
  ]) assert.equal(f.launcher.verifyCollection({ ...f.packet, ...change, collection: f.collection }).ok, false);
  const localOnly = admitEvidence({ ...f.packet, collection: f.collection }, { requireManaged: true, authority: f.launcher, actionBinding: f.actionBinding, sourceQualification: f.qualification, environment: f.packet.envelope.environment, purpose: 'independent-acceptance', builderExecution: 'builder-1', builderPrincipal: 'builder-principal', now: NOW });
  assert.equal(localOnly.ok, false); assert.equal(localOnly.error, 'SOURCE_UNQUALIFIED');
});


function managedOptions(f, overrides = {}) {
  // Protocol fixture only: this is not deployed source qualification and no
  // test here can close a managed/Journey scenario or prove method semantics.
  return { requireManaged: true, authority: f.launcher, actionBinding: f.actionBinding, sourceQualification: f.qualification,
    environment: f.packet.envelope.environment, purpose: 'independent-acceptance', builderExecution: 'builder-1', builderPrincipal: 'builder-principal',
    authoringExecutions: [], authoringPrincipals: [], consumedCollections: [], issuedExecutions: [], now: NOW, ...overrides };
}

test('managed protocol rejects stale action/environment/method/revision, foreign run, replay and same author principal', async () => {
  const f = await collectedProcessFixture('protected-source');
  const args = { ...f.packet, collection: f.collection };
  const bound = admitEvidence(args, managedOptions(f));
  assert.equal(bound.ok, true); assert.equal(bound.managedClosureEligible, false);
  for (const change of [
    { builderExecution: f.actionBinding.execution }, { builderPrincipal: 'protocol-fixture-principal' },
    { authoringExecutions: [f.actionBinding.execution] }, { authoringPrincipals: ['protocol-fixture-principal'] },
    { consumedCollections: [f.collection.collectionId] }, { issuedExecutions: [f.actionBinding.execution] },
    { sourceQualification: { ...f.qualification, revision: 'q2' } },
    { now: '2026-11-02T00:00:00.000Z' }, { environment: 'other-environment' },
  ]) assert.equal(admitEvidence(args, managedOptions(f, change)).ok, false, JSON.stringify(change));
  for (const mutate of [(a) => { a.run = 'other-run'; }, (a) => { a.revision = 'new-revision'; }, (a) => { a.epoch++; }, (a) => { a.attempt++; }, (a) => { a.policyDigest = sha('new-policy'); }, (a) => { a.environmentDigest = sha('new-environment'); }, (a) => { a.methods[0].digest = sha('new-method'); }]) {
    const action = structuredClone(f.actionBinding); mutate(action);
    assert.equal(admitEvidence(args, managedOptions(f, { actionBinding: action })).ok, false);
  }
  assert.equal((await f.launcher.collectResult({ ...f.packet, reportBytes: Buffer.from('self-written pass') })).ok, false);
  assert.equal(admitEvidence({ ...args, authority: { verifyDispatch: () => ({ ok: true }) }, current: { trusted: true } }, managedOptions(f)).ok, true);
});

test('hash-only source acknowledgments cannot replace measured case/check/command observations', async () => {
  const f = await collectedProcessFixture();
  const echoOnly = createLaunchAuthority({ secret: crypto.randomBytes(32).toString('hex'), sourceVerifier: async ({ expected }) => ({ ok: true, qualification: f.qualification, facts: { ...expected, principal: 'claim-only' } }) });
  const dispatch = verifierDispatch(echoOnly, { actionBinding: f.actionBinding });
  const result = await echoOnly.collectResult({ ...f.packet, dispatch });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'SOURCE_UNQUALIFIED');
});

test('an invalid protected mode value cannot silently select legacy admission', () => {
  const launcher = authority();
  assert.equal(admitEvidence({ envelope: envelopeFixture(), dispatch: verifierDispatch(launcher), authority: launcher, current: currentFixture(), now: NOW }, { requireManaged: 'true' }).ok, false);
});

test('managed admission requires the protected observation clock rather than worker or implicit wall time', async () => {
  const f = await collectedProcessFixture('protected-source');
  const options = managedOptions(f); delete options.now;
  assert.equal(admitEvidence({ ...f.packet, collection: f.collection, now: NOW }, options).ok, false);
});

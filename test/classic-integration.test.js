// P1_5 — R/A/T/P and the test-implementation step assembly, verified against
// the REAL compiled composition package and the 0.5.0 adapter (revision
// 2026-10-26-comet-050-adoption-v1; acceptance C01–C08).
//
// Two layers, one registration:
//  - the JUDGMENT layer (C01–C05) drives the accepted infrastructure imports
//    unmodified — lib/delivery/gate.js evaluate (the same pure SDD.Gate.v1 the
//    packaged bindings validators delegate to), the P2_2 trusted launcher +
//    admission (lib/delivery/evidence.js), the driver exclusivity
//    (lib/adapters/harness.js) and baseline frozen-plan semantics;
//  - the ASSEMBLY layer parses the compiled package
//    (integrations/comet/application/package: application.json + workflow.json,
//    Comet 0.5.0 classic-full) and asserts the composed behavior: A/T extension
//    independence at the shared design checkpoint, the single P plan surface
//    with no second scheduling face, the classic.composition.confirm approval
//    anchor preceding full.open, the nine-step replacement mapping (method
//    variants ARE the execution skills; domain steps run managed domain-work
//    skills), and the comet-executor six-gate receipt acceptance that has zero
//    fallback outside the packaged bindings validators (P1_3 adapter face).
// Probe records live in openspec/changes/delivery-foundation-rearchitecture/
// classic-integration-probes/ and are the RED boundary: without them the
// behaviors have no registered evidence. The hooks-absent real-CLI entrance
// and bypass probes (C07/C08 rejection paths) live in
// test/delivery-cases/1_5.mjs against the same pinned build. Installing the
// package into a live project and dispatching inside a real composition Run
// are P1_4/P3_2/VERIFY — UNVERIFIED here by design.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const changeRoot = path.join(projectRoot, 'openspec/changes/delivery-foundation-rearchitecture');
const probesDir = path.join(changeRoot, 'classic-integration-probes');
const lock = JSON.parse(await fs.readFile(path.join(projectRoot, 'integrations/comet/upstream.lock.json'), 'utf8'));
const toolchain = JSON.parse(await fs.readFile(path.join(changeRoot, 'toolchain-baseline.json'), 'utf8'));

const fingerprint = crypto.createHash('sha256').update(JSON.stringify({
  archive: lock.source.sha256,
  patches: lock.patches.map(({ path, sha256 }) => ({ path, sha256 })),
  toolchain: lock.toolchain,
})).digest('hex');
const buildDir = path.join(projectRoot, '.sdd/vendor/comet', lock.source.commit, 'builds', fingerprint);
const distRequirements = path.join(buildDir, 'work/dist/domains/comet-classic/classic-artifact-requirements.js');
const built = await fs.access(path.join(buildDir, 'distribution.json')).then(() => true, () => false);

const isolatedOpenspecPkg = path.join(projectRoot, '.sdd/tools/openspec-1.11.0/node_modules/@fission-ai/openspec');
const isolatedOpenspecBin = path.join(isolatedOpenspecPkg, 'bin/openspec.js');
const isolatedOpenspecReady = await fs.access(isolatedOpenspecBin).then(() => true, () => false);

// The compiled composition package (P2_4 deliverable, byte-pinned by
// test/delivery-cases/2_4.mjs): the single source this assembly layer reads.
const applicationRoot = path.join(projectRoot, 'integrations/comet/application');
const packageRoot = path.join(applicationRoot, 'package');
const application = JSON.parse(await fs.readFile(path.join(packageRoot, 'application.json'), 'utf8'));
const workflowDocument = JSON.parse(await fs.readFile(path.join(packageRoot, 'workflow.json'), 'utf8'));
const composition = JSON.parse(await fs.readFile(path.join(applicationRoot, 'composition.json'), 'utf8'));
const compileManifest = JSON.parse(await fs.readFile(path.join(applicationRoot, 'internal/compile-manifest.json'), 'utf8'));
const workflow = workflowDocument.workflows.find((entry) => entry.id === 'comet-classic-full');
const { createBindings } = await import(path.join(packageRoot, 'bindings.mjs'));

// --- the RED boundary: the structured probe registration of this task
async function loadProbe(name) {
  try {
    return JSON.parse(await fs.readFile(path.join(probesDir, name), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      const failure = new Error(`classic-integration-probes/${name} is missing: the C01–C08 behaviors have no registered real-entry evidence (task P1_5 deliverable)`);
      failure.code = 'CLASSIC_INTEGRATION_PROBE_MISSING';
      throw failure;
    }
    throw error;
  }
}

// --- shared real-entry fixtures (trusted launcher + admission + gate)
const sha = (label) => crypto.createHash('sha256').update(label).digest('hex');
const SECRET = crypto.randomBytes(32).toString('hex');
const { cometLaunchAuthority, sealCloseout, runtimeDispatchArgv, knowledgeCloseoutBlocked } = await import('../lib/adapters/comet.js');
const { createCometExecutor } = await import('../lib/adapters/comet-executor.js');
const { defineDriver, requireWriteDriver } = await import('../lib/adapters/harness.js');
const { admitEvidence, createLaunchAuthority } = await import('../lib/delivery/evidence.js');
const gate = await import('../lib/delivery/gate.js');
const baseline = await import('../lib/delivery/baseline.js');

const authority = cometLaunchAuthority({ secret: SECRET, runId: 'run-p15' });
const POLICY = { ref: 'policy/managed-pilot@p15', digest: sha('policy/managed-pilot@p15-bytes') };
const ENV = 'env-p15';

const dispatch = (overrides = {}) => authority.issueDispatch({
  runnerId: 'comet-classic',
  run: 'run-p15',
  gate: 'V',
  inputDigest: sha('candidate-r1'),
  policyDigest: POLICY.digest,
  attempt: 1,
  epoch: 1,
  role: 'verifier',
  execution: 'exec-verifier-1',
  ...overrides,
});

const envelope = (overrides = {}) => ({
  schemaVersion: 1,
  candidateDigest: sha('candidate-r1'),
  caseId: 'case-1',
  check: 'verify-execution',
  origin: { kind: 'harness', id: 'comet-classic' },
  execution: { id: 'exec-verifier-1' },
  environment: ENV,
  toolchain: 'node-24',
  executions: { total: 3, valid: 3 },
  result: 'pass',
  evidence: [{ uri: 'file:///tmp/obs.log', sha256: sha('obs-bytes') }],
  expiry: '2099-01-01T00:00:00.000Z',
  ...overrides,
});

const current = { inputDigest: sha('candidate-r1'), policyDigest: POLICY.digest, environment: ENV };

const contractFixture = (requiredChecks, cases) => ({
  schemaVersion: 1,
  project: 'sdd-harness',
  change: 'delivery-foundation-rearchitecture',
  cases: cases ?? [{ id: 'c1', ac: 'C01', oracle: 'required receipt is observed before pass' }],
  requiredChecks,
  executionDenominator: { totalCases: cases?.length ?? 1 },
  cleanup: { environment: 'temp dirs removed after run', data: 'none persisted' },
  dependencyBaselines: [{ kind: 'comet-build', digest: sha('comet-build-bytes') }],
});

const R_CONTRACT = contractFixture([{ level: 'gate', capability: 'requirements-baseline' }]);
const A_CONTRACT = contractFixture([{ level: 'gate', capability: 'architecture-review' }]);
const T_CONTRACT = contractFixture([{ level: 'gate', capability: 'test-design-sufficiency' }]);

// Issue and admit one receipt bound to `gateName` with the given capability,
// role and execution. Returns the admission result (or refusal).
function receipt({ gateName, capability, role = 'verifier', execution, result = 'pass', valid = 3, total = 3, inputDigest = sha('candidate-r1') }) {
  const exec = execution ?? `exec-${gateName.toLowerCase()}-1`;
  const disp = dispatch({ gate: gateName, role, execution: exec, inputDigest });
  const env = envelope({ check: capability, execution: { id: exec }, result, executions: { total, valid }, candidateDigest: inputDigest });
  return admitEvidence({ envelope: env, dispatch: disp, authority, current: { inputDigest, policyDigest: POLICY.digest, environment: ENV } });
}

// ---------------------------------------------------------------------------
// C01 — the requirement gate R: architecture actions need the current
// requirement baseline receipt; other gates' receipts cannot stand in.
// ---------------------------------------------------------------------------

test('C01 positive: an architecture request passes when the current R receipt is admitted', async () => {
  await loadProbe('gate-matrix.json');
  const entry = receipt({ gateName: 'R', capability: 'requirements-baseline', execution: 'exec-r-pos' });
  assert.equal(entry.ok, true);
  // The architecture action demands the current requirement baseline: the R
  // capability is what the R receipt must satisfy.
  const verdict = gate.evaluate({ testContract: R_CONTRACT, inputDigest: sha('candidate-r1'), builderExecution: 'exec-builder-1' }, [entry.entry], POLICY);
  assert.equal(verdict.verdict, 'pass');
  assert.equal(verdict.receipt.policy.digest, POLICY.digest);
});

test('C01 negative: a T or A receipt cannot substitute the R baseline — the gates are not interchangeable', async () => {
  await loadProbe('gate-matrix.json');
  const tReceipt = receipt({ gateName: 'T', capability: 'test-design-sufficiency', execution: 'exec-t-c01' });
  const aReceipt = receipt({ gateName: 'A', capability: 'architecture-review', execution: 'exec-a-c01' });
  assert.equal(tReceipt.ok, true);
  assert.equal(aReceipt.ok, true);
  const refused = gate.evaluate({ testContract: R_CONTRACT, inputDigest: sha('candidate-r1'), builderExecution: 'exec-builder-1' }, [tReceipt.entry, aReceipt.entry], POLICY);
  assert.equal(refused.verdict, 'blocked');
  assert.ok(refused.receipt.blocked.some((line) => /MISSING_OBSERVATION: required check .*requirements-baseline/.test(line)),
    `the R capability must stay missing, not be substituted: ${JSON.stringify(refused.receipt.blocked)}`);
});

test('C01 negative: requirement artifact existence is not a confirmation — an unverified R receipt keeps the gate blocked', async () => {
  await loadProbe('gate-matrix.json');
  // A receipt that "saw" the artifact but performed no valid execution
  // (zero observations) must never read as confirmed scope.
  const unverified = receipt({ gateName: 'R', capability: 'requirements-baseline', execution: 'exec-r-unverified', result: 'unverified', valid: 0, total: 1 });
  assert.equal(unverified.ok, true, 'recording an unverified observation is allowed — it just gates nothing');
  const refused = gate.evaluate({ testContract: R_CONTRACT, inputDigest: sha('candidate-r1'), builderExecution: 'exec-builder-1' }, [unverified.entry], POLICY);
  assert.equal(refused.verdict, 'blocked');
  assert.ok(refused.receipt.blocked.some((line) => /UNVERIFIED_CAPABILITY: requirements-baseline/.test(line)));
  // And a pass claim with zero observations is refused at admission outright.
  const empty = receipt({ gateName: 'R', capability: 'requirements-baseline', execution: 'exec-r-empty', valid: 0, total: 1 });
  assert.equal(empty.ok, false);
  assert.equal(empty.error, 'NO_OBSERVATION');
});

// ---------------------------------------------------------------------------
// C02 — with R confirmed, source writes still need current A/T/P receipts;
// stale architecture/test-design evidence refuses the implementation write.
// ---------------------------------------------------------------------------

test('C02 positive: fresh A and T receipts admit the managed write driver', async () => {
  await loadProbe('gate-matrix.json');
  const a = receipt({ gateName: 'A', capability: 'architecture-review', execution: 'exec-a-pos' });
  const t = receipt({ gateName: 'T', capability: 'test-design-sufficiency', execution: 'exec-t-pos' });
  const writer = defineDriver({ id: 'comet-managed', kind: 'managed-write', execute: () => ({ exitCode: 0 }) });
  assert.equal(requireWriteDriver(writer, 'write product source'), writer);
  for (const contract of [A_CONTRACT, T_CONTRACT]) {
    const verdict = gate.evaluate({ testContract: contract, inputDigest: sha('candidate-r1'), builderExecution: 'exec-builder-1' }, [a.entry, t.entry], POLICY);
    assert.equal(verdict.verdict, 'pass', `fresh ${contract === A_CONTRACT ? 'A' : 'T'} evidence must admit the write: ${JSON.stringify(verdict.receipt.blocked)}`);
  }
});

test('C02 negative: a source write is refused while the architecture or test-design receipt is stale', async () => {
  await loadProbe('gate-matrix.json');
  // The requirement baseline was revised after A/T were issued: the input
  // digest rotated, so the old design evidence no longer binds.
  const revised = sha('candidate-r2-revised');
  const staleA = receipt({ gateName: 'A', capability: 'architecture-review', execution: 'exec-a-stale' });
  assert.equal(staleA.ok, true);
  const refusedAdmission = admitEvidence({
    envelope: envelope({ check: 'architecture-review', execution: { id: 'exec-a-new' } }),
    dispatch: dispatch({ gate: 'A', role: 'verifier', execution: 'exec-a-new', inputDigest: sha('candidate-r1') }),
    authority,
    current: { inputDigest: revised, policyDigest: POLICY.digest, environment: ENV },
  });
  assert.equal(refusedAdmission.ok, false);
  assert.equal(refusedAdmission.error, 'STALE_CANDIDATE');
  const gateRefusal = gate.evaluate({ testContract: A_CONTRACT, inputDigest: revised, builderExecution: 'exec-builder-1' }, [staleA.entry], POLICY);
  assert.equal(gateRefusal.verdict, 'blocked');
  assert.ok(gateRefusal.receipt.blocked.some((line) => /STALE_INPUT: receipt bound to input digest/.test(line)));
  // A rotated policy is equally stale.
  const nextPolicy = { ref: POLICY.ref, digest: sha('policy-rotated') };
  const stalePolicy = gate.evaluate({ testContract: A_CONTRACT, inputDigest: revised, builderExecution: 'exec-builder-1' }, [staleA.entry], nextPolicy);
  assert.equal(stalePolicy.verdict, 'blocked');
  assert.ok(stalePolicy.receipt.blocked.some((line) => /STALE_POLICY/.test(line)));
});

test('C02 negative: a read-only observer cannot perform the product write — the managed executor is named', () => {
  const observer = defineDriver({ id: 'planner-observer', kind: 'read-only' });
  assert.throws(
    () => requireWriteDriver(observer, 'write product source before A/T/P are current'),
    (error) => error.code === 'DRIVER_WRITE_REFUSED' && /managed write executor/.test(error.message),
  );
  assert.throws(
    () => defineDriver({ id: 'fake-observer', kind: 'read-only', execute: () => {} }),
    (error) => error.code === 'DRIVER_SURFACE_REFUSED',
    'a read-only driver cannot even carry an execute surface',
  );
});

// ---------------------------------------------------------------------------
// C03 — a structurally valid design-only TestPack is not a semantic pass:
// unresolved expected results and coverage gaps keep the T gate blocked.
// ---------------------------------------------------------------------------

test('C03 negative: design-only TestPack passes structure but the T gate stays blocked and returns it to the test author', async () => {
  await loadProbe('gate-matrix.json');
  // Structure: the contract itself parses (the TestPack is structurally legal).
  const designOnly = contractFixture(
    [{ level: 'gate', capability: 'test-design-sufficiency' }],
    [{ id: 'c1', ac: 'C03', oracle: 'independent authority for the expected result' }],
  );
  assert.equal(baseline.traceAcToCases({ acceptanceIds: ['C03'], testContract: designOnly }).ok, true);
  // Semantics: the only signature on the design intent is the author's own
  // self-check — an authoring class receipt can never sign the T gate (B03).
  const selfCheck = receipt({ gateName: 'T', capability: 'test-design-sufficiency', role: 'test-author', execution: 'exec-t-author' });
  assert.equal(selfCheck.ok, true);
  assert.equal(selfCheck.entry.class, 'authoring-self-check');
  const refused = gate.evaluate({ testContract: designOnly, inputDigest: sha('candidate-r1'), builderExecution: 'exec-builder-1' }, [selfCheck.entry], POLICY);
  assert.equal(refused.verdict, 'blocked');
  assert.ok(refused.receipt.blocked.some((line) => /AUTHORING_SELF_CHECK_ONLY: test-design-sufficiency/.test(line)));
  // An unresolved expected result (blocked observation) also stays blocked.
  const unresolved = receipt({ gateName: 'T', capability: 'test-design-sufficiency', execution: 'exec-t-unresolved', result: 'blocked' });
  assert.equal(unresolved.ok, true);
  const stillBlocked = gate.evaluate({ testContract: designOnly, inputDigest: sha('candidate-r1'), builderExecution: 'exec-builder-1' }, [unresolved.entry], POLICY);
  assert.equal(stillBlocked.verdict, 'blocked');
  assert.ok(stillBlocked.receipt.blocked.some((line) => /UNVERIFIED_CAPABILITY: test-design-sufficiency/.test(line)));
  // And a TestPack with an unmapped AC has a broken case→AC denominator.
  const unmapped = baseline.traceAcToCases({ acceptanceIds: ['C03', 'C99'], testContract: designOnly });
  assert.equal(unmapped.ok, false);
  assert.ok(unmapped.missing.some((entry_) => entry_.ac === 'C99'));
});

test('C03 positive: an independent T receipt over the complete AC mapping passes the test design gate', async () => {
  await loadProbe('gate-matrix.json');
  const independent = receipt({ gateName: 'T', capability: 'test-design-sufficiency', execution: 'exec-t-independent' });
  assert.equal(independent.ok, true);
  assert.equal(independent.entry.class, 'independent-acceptance');
  const verdict = gate.evaluate({ testContract: T_CONTRACT, inputDigest: sha('candidate-r1'), builderExecution: 'exec-builder-1' }, [independent.entry], POLICY);
  assert.equal(verdict.verdict, 'pass');
});

// ---------------------------------------------------------------------------
// C04 — tasks/DAG is the only writable authority; a Classic plan view is a
// derived, checkbox-agnostic read (baseline.js frozen digest semantics).
// ---------------------------------------------------------------------------

test('C04 positive: deriving the Classic plan view never changes the frozen authority digest', async () => {
  await loadProbe('gate-matrix.json');
  const authorityText = '# Tasks\n\n- [ ] 1.1 Implement product code\n- [ ] 1.2 Wire evidence\n';
  const derivedView = authorityText.replace('[ ]', '[x]'); // a view may render progress
  assert.equal(baseline.taskDefinitionDigest(derivedView), baseline.taskDefinitionDigest(authorityText),
    'ticking a checkbox is progress, not a plan change: the derived view binds the same task definitions');
  assert.notEqual(baseline.taskDefinitionDigest('# Tasks\n\n- [ ] 1.1 Implement product code changed\n'), baseline.taskDefinitionDigest(authorityText),
    'a changed task definition is a different plan');
});

test('C04 negative: a second writable plan authority is detected and refused', async () => {
  await loadProbe('gate-matrix.json');
  const authorityDigest = baseline.taskDefinitionDigest('# Tasks\n\n- [ ] 1.1 Implement product code\n');
  const secondAuthorityDigest = baseline.taskDefinitionDigest('# Plan B\n\n- [ ] 1.1 Different work\n');
  assert.notEqual(authorityDigest, secondAuthorityDigest);
  // A report (or receipt) bound to the second authority is not currency for
  // the real one: the digest mismatch is the refusal, so no second checkbox
  // authority can silently stand in for tasks.md.
  const refused = baseline.verifyReportCurrency({ report: { id: 'plan-view-2', inputDigest: secondAuthorityDigest }, currentDigest: authorityDigest });
  assert.equal(refused.ok, false);
  assert.equal(refused.error, 'DIGEST_MISMATCH');
  assert.match(refused.reason, /but current full-input digest is/);
});

// ---------------------------------------------------------------------------
// C05 — V independent receipts: builder/self-signed identity is refused and
// only launcher-dispatched verifier evidence can sign acceptance.
// ---------------------------------------------------------------------------

test('C05 negative: self-signed and forged receipts are refused at admission', async () => {
  await loadProbe('gate-matrix.json');
  const noDispatch = admitEvidence({ envelope: envelope(), dispatch: null, authority, current });
  assert.equal(noDispatch.ok, false);
  assert.equal(noDispatch.error, 'UNREGISTERED_SOURCE');

  const forged = admitEvidence({
    envelope: envelope(),
    dispatch: { ...dispatch(), integrity: sha('forged-integrity') },
    authority,
    current,
  });
  assert.equal(forged.ok, false);
  assert.equal(forged.error, 'FORGED_DISPATCH');

  const foreignAuthority = createLaunchAuthority({ secret: crypto.randomBytes(32).toString('hex') });
  const wrongSecret = admitEvidence({
    envelope: envelope({ execution: { id: 'exec-foreign' } }),
    dispatch: foreignAuthority.issueDispatch({
      runnerId: 'comet-classic', run: 'run-p15', gate: 'V', inputDigest: sha('candidate-r1'), policyDigest: POLICY.digest, attempt: 1, epoch: 1, role: 'verifier', execution: 'exec-foreign',
    }),
    authority,
    current,
  });
  assert.equal(wrongSecret.ok, false);
  assert.equal(wrongSecret.error, 'FORGED_DISPATCH', 'a dispatch from another launcher secret is a forged dispatch here');

  const builder = admitEvidence({
    envelope: envelope({ execution: { id: 'exec-builder-1' } }),
    dispatch: dispatch({ role: 'builder', execution: 'exec-builder-1' }),
    authority,
    current,
  });
  assert.equal(builder.ok, false);
  assert.equal(builder.error, 'IDENTITY_CONFLICT');

  const redeclared = admitEvidence({
    envelope: envelope({ execution: { id: 'exec-someone-else' } }),
    dispatch: dispatch({ execution: 'exec-verifier-1' }),
    authority,
    current,
  });
  assert.equal(redeclared.ok, false);
  assert.equal(redeclared.error, 'EXECUTION_BINDING_MISMATCH');
});

test('C05 negative: duplicate, expired and zero-observation verifier claims are refused', async () => {
  await loadProbe('gate-matrix.json');
  const duplicate = admitEvidence({
    envelope: envelope({ execution: { id: 'exec-twice' } }),
    dispatch: dispatch({ execution: 'exec-twice' }),
    authority,
    current,
    issuedExecutions: ['exec-twice'],
  });
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.error, 'DUPLICATE_ISSUANCE');

  const expired = admitEvidence({
    envelope: envelope({ execution: { id: 'exec-late' }, expiry: '2001-01-01T00:00:00.000Z' }),
    dispatch: dispatch({ execution: 'exec-late' }),
    authority,
    current,
  });
  assert.equal(expired.ok, false);
  assert.equal(expired.error, 'EXPIRED_ENVELOPE');

  const empty = admitEvidence({
    envelope: envelope({ execution: { id: 'exec-empty' }, executions: { total: 2, valid: 0 } }),
    dispatch: dispatch({ execution: 'exec-empty' }),
    authority,
    current,
  });
  assert.equal(empty.ok, false);
  assert.equal(empty.error, 'NO_OBSERVATION');
});

test('C05 negative: the gate refuses acceptance signed by the builder execution (A06)', async () => {
  await loadProbe('gate-matrix.json');
  // A verifier-role dispatch that reuses the builder's execution id is
  // admitted structurally but can never sign acceptance.
  const sameExecution = receipt({ gateName: 'V', capability: 'verify-execution', execution: 'exec-builder-1' });
  assert.equal(sameExecution.ok, true);
  const refused = gate.evaluate({ testContract: contractFixture([{ level: 'gate', capability: 'verify-execution' }]), inputDigest: sha('candidate-r1'), builderExecution: 'exec-builder-1' }, [sameExecution.entry], POLICY);
  assert.equal(refused.verdict, 'blocked');
  assert.ok(refused.receipt.blocked.some((line) => /IDENTITY_CONFLICT: receipt execution exec-builder-1 is the builder execution/.test(line)));
});

test('C05 positive: a launcher-dispatched verifier receipt signs independent acceptance and passes', async () => {
  await loadProbe('gate-matrix.json');
  const entry = receipt({ gateName: 'V', capability: 'verify-execution', execution: 'exec-v-independent' });
  assert.equal(entry.ok, true);
  assert.equal(entry.entry.class, 'independent-acceptance');
  assert.equal(entry.entry.dispatch.gate, 'V');
  const verdict = gate.evaluate({ testContract: contractFixture([{ level: 'gate', capability: 'verify-execution' }]), inputDigest: sha('candidate-r1'), builderExecution: 'exec-builder-1' }, [entry.entry], POLICY);
  assert.equal(verdict.verdict, 'pass');
  assert.deepEqual(verdict.receipt.sourceAttestation, { origin: 'comet-classic', execution: 'exec-v-independent' });
});

// ---------------------------------------------------------------------------
// C06 — the Kp/Kt readback gates: the archive seal requires the recorded
// knowledge closeout, exactly once, on a truly sealable state.
// ---------------------------------------------------------------------------

const sealableSeal = {
  change: 'p15-change',
  phase: 'archive',
  verifyResult: 'pass',
  archiveConfirmation: 'confirmed',
  archived: false,
  checkEpoch: 6,
};

test('C06 negative: the archive seal is refused without the knowledge closeout receipt (Kp first)', async () => {
  await loadProbe('knowledge-closeout.json');
  assert.throws(
    () => sealCloseout({ seal: sealableSeal, execution: 'exec-closeout-1', knowledgeCloseout: null }),
    (error) => error.code === 'KNOWLEDGE_CLOSEOUT_REQUIRED' && /Knowledge\.Closeout\.v1/.test(error.message),
  );
  assert.throws(
    () => sealCloseout({ seal: sealableSeal, execution: 'exec-closeout-1', knowledgeCloseout: { id: 'llmwiki-entry', digest: 'not-a-digest' } }),
    (error) => error.code === 'KNOWLEDGE_CLOSEOUT_REQUIRED',
    'a knowledge closeout without a content digest is not a readback',
  );
});

test('C06 negative: a forged seal state and a second closeout are refused', async () => {
  await loadProbe('knowledge-closeout.json');
  const knowledgeCloseout = { id: 'llmwiki:kp-entry', digest: sha('kp-published-content') };
  assert.throws(
    () => sealCloseout({ seal: { ...sealableSeal, phase: 'build', verifyResult: 'pending', archiveConfirmation: null }, execution: 'exec-forge', knowledgeCloseout }),
    (error) => error.code === 'ARCHIVE_ENTRY_INVALID' && /not at a sealable archive entry/.test(error.message),
  );
  assert.throws(
    () => sealCloseout({ seal: { ...sealableSeal, archived: true }, execution: 'exec-closeout-2', knowledgeCloseout }),
    (error) => error.code === 'ARCHIVE_ALREADY_SEALED' && /already sealed by a previous closeout/.test(error.message),
  );
});

test('C06 positive: the seal succeeds exactly once and freezes the knowledge closeout', () => {
  const knowledgeCloseout = { id: 'llmwiki:kp-entry', digest: sha('kp-published-content') };
  const sealed = sealCloseout({ seal: sealableSeal, execution: 'exec-closeout-1', knowledgeCloseout });
  assert.equal(sealed.archived, true);
  assert.equal(sealed.execution, 'exec-closeout-1');
  assert.deepEqual(sealed.knowledgeCloseout, knowledgeCloseout);
  assert.equal(sealed.sealedFromEpoch, sealableSeal.checkEpoch);
  assert.ok(Object.isFrozen(sealed) && Object.isFrozen(sealed.knowledgeCloseout));
});

// ---------------------------------------------------------------------------
// C06/Kt — the 0.5.0 Kt mechanism is the 0005 read-side predicate parking the
// SAME Run before overall completion; fail-open default, no second surface.
// ---------------------------------------------------------------------------

test('C06/Kt: the 0005 predicate is fail-open by default and parks the same Run only while required and unmet', async () => {
  const record = await loadProbe('knowledge-closeout.json');
  const kt = record.records.find((entry) => entry.id === 'kt-0005-required-unmet-parks-same-run');
  const failOpen = record.records.find((entry) => entry.id === 'kt-0005-fail-open-default');
  assert.ok(kt && failOpen, 'the Kt predicate records must be registered');
  // Every upstream and legacy state (absent/null field) keeps completion.
  assert.equal(knowledgeCloseoutBlocked({ archived: true, phase: 'archive' }), false);
  assert.equal(knowledgeCloseoutBlocked({ knowledgeCloseout: null }), false);
  assert.equal(failOpen.observed.absentFieldBlocks, false);
  assert.equal(failOpen.observed.nullFieldBlocks, false);
  // Blocked ONLY while required === true and completed !== true.
  assert.equal(knowledgeCloseoutBlocked({ knowledgeCloseout: { required: true } }), true);
  assert.equal(knowledgeCloseoutBlocked({ knowledgeCloseout: { required: true, completed: false } }), true);
  assert.equal(knowledgeCloseoutBlocked({ knowledgeCloseout: { required: true, completed: true } }), false);
  assert.equal(knowledgeCloseoutBlocked({ knowledgeCloseout: { completed: true } }), false);
  // A malformed field shape (unknown keys) is refused, never guessed.
  assert.throws(() => knowledgeCloseoutBlocked({ knowledgeCloseout: { required: true, surprise: 1 } }), (error) => error.code === 'KT_STATE_INVALID');
});

// ---------------------------------------------------------------------------
// ASSEMBLY layer — the compiled package is the composed behavior under test.
// ---------------------------------------------------------------------------

const steps = workflow.steps;
const transitions = workflow.transitions;
const hasTransition = (from, on, to) => transitions.some((transition) => transition.from === from && transition.on === on && transition.to === to);
const bindingFor = (stepId) => application.bindings.find((binding) => binding.stepId === stepId);
const extensionBindings = application.bindings.filter((binding) => binding.capability.endsWith('.gate'));
const anchoredBindings = application.bindings.filter((binding) => binding.authorizationFrom === 'classic.composition.confirm');
const planOutputSteps = (wf) => Object.entries(wf.steps)
  .filter(([, step]) => step.type === 'invoke_skill' && step.outputSchema?.properties && 'plan' in step.outputSchema.properties)
  .map(([id]) => id);
const planEvidenceSteps = (wf) => Object.entries(wf.steps)
  .filter(([, step]) => step.type === 'await_evidence' && step.kind === 'classic-build-plan')
  .map(([id]) => id);

test('P1_5 assembly: the compiled package identity is pinned to the comet-050 composition build', async () => {
  const record = await loadProbe('assembly-probes.json');
  assert.equal(record.environment.package.compositionHash, compileManifest.compositionHash);
  assert.equal(record.environment.package.contentHash, compileManifest.contentHash);
  assert.equal(application.runtimeVersion, '0.5.0');
  assert.equal(application.schema, 'comet.workflow.application.v1');
  assert.equal(application.base, 'classic-full');
  assert.equal(application.id, 'sdd-managed-delivery');
  assert.equal(application.skills.length, 15);
  assert.equal(application.bindings.length, 15);
  assert.equal(workflow.id, 'comet-classic-full');
  assert.equal(workflowDocument.schema, 'comet.workflow.application.definition.v1');
});

test('P1_5 assembly: A and T are separate extensions at the same design checkpoint with independent artifactRefs and validators (C01/C03)', async () => {
  const record = await loadProbe('assembly-probes.json');
  const observed = record.records.find((entry) => entry.id === 'at-extensions-independent').observed;
  const aStep = steps['classic.extension.architecture-consensus'];
  const tStep = steps['classic.extension.test-design-review'];
  assert.ok(aStep && tStep, 'both design-checkpoint extensions must be compiled steps');
  // Each extension is its own invoke_skill step with its own skill and validator.
  assert.equal(aStep.ref, 'multi-agent-consensus-review');
  assert.equal(tStep.ref, 'test-authoring');
  assert.equal(aStep.validator.id, 'comet-classic.extension.architecture-consensus-result');
  assert.equal(tStep.validator.id, 'comet-classic.extension.test-design-review-result');
  assert.notEqual(aStep.validator.id, tStep.validator.id, observed.oracle);
  const aBinding = bindingFor('classic.extension.architecture-consensus');
  assert.equal(aBinding.capability, 'multi-agent-consensus-review.gate');
  assert.equal(aBinding.skillId, 'multi-agent-consensus-review');
  assert.equal(aBinding.usage, 'action');
  assert.equal(aBinding.workflowId, 'comet-classic-full');
  assert.equal(aBinding.authorizationFrom, undefined, 'the read-only gate extension carries no approval anchor');
  assert.equal(aBinding.authorizationChoices, undefined);
  const tBinding = bindingFor('classic.extension.test-design-review');
  assert.equal(tBinding.capability, 'test-authoring.gate');
  assert.equal(tBinding.skillId, 'test-authoring');
  assert.equal(tBinding.authorizationFrom, undefined, 'the read-only gate extension carries no approval anchor');
  assert.equal(tBinding.authorizationChoices, undefined);
  // Both sit after full.design.evidence and both must pass to reach the build
  // configuration (the same-checkpoint AND chain).
  assert.ok(hasTransition('full.design.evidence', 'succeeded', 'classic.extension.architecture-consensus'));
  assert.ok(hasTransition('classic.extension.architecture-consensus', 'succeeded', 'classic.extension.test-design-review'));
  assert.ok(hasTransition('classic.extension.test-design-review', 'succeeded', 'full.build.configure'));
  // Independent artifact bundles and validators, read from the typed
  // declarations the package was compiled from (single source: composition).
  const declared = async (id) => JSON.parse(await fs.readFile(path.join(applicationRoot, 'extensions', `${id}.json`), 'utf8'));
  const aDeclared = await declared('architecture-consensus');
  const tDeclared = await declared('test-design-review');
  assert.deepEqual(aDeclared.artifactRefs.map((ref) => ref.ref), ['.sdd/delivery/gates/a/receipt-bundle.json']);
  assert.deepEqual(tDeclared.artifactRefs.map((ref) => ref.ref), ['.sdd/delivery/gates/t/receipt-bundle.json']);
  assert.deepEqual(aDeclared.validator, { id: 'sdd.delivery.gate.a', version: '1' });
  assert.deepEqual(tDeclared.validator, { id: 'sdd.delivery.gate.t', version: '1' });
  assert.notDeepEqual(aDeclared.artifactRefs, tDeclared.artifactRefs, 'A passing cannot substitute for T and vice versa — the bundles are independent');
  assert.equal(observed.aArtifactRef, '.sdd/delivery/gates/a/receipt-bundle.json');
  assert.equal(observed.tArtifactRef, '.sdd/delivery/gates/t/receipt-bundle.json');
});

test('P1_5 assembly: gate evidence cannot be replayed across extensions — the packaged validators refuse the cross-gate payload', async () => {
  const record = await loadProbe('assembly-probes.json');
  assert.ok(record.records.some((entry) => entry.id === 'at-cross-replay-refused'));
  const bindings = await createBindings();
  const validator = (id) => bindings.validators.find((candidate) => candidate.id === id);
  const aValidator = validator('sdd.delivery.gate.a');
  const tValidator = validator('sdd.delivery.gate.t');
  assert.ok(aValidator && tValidator, 'the packaged validators for A and T must be registered');
  // A real pass payload per gate (admitted receipt + contract, pure evaluation).
  const passPayload = (gateName, capability) => {
    const entry = receipt({ gateName, capability, execution: `exec-${gateName.toLowerCase()}-x` });
    assert.equal(entry.ok, true);
    return { verdict: 'pass', sourceHash: sha(`source-${gateName}`),
      artifactHashes: { [`.sdd/delivery/gates/${gateName.toLowerCase()}/receipt-bundle.json`]: sha(`bundle-${gateName}`) },
      output: { gateEvidence: { gate: gateName,
        inputs: { testContract: contractFixture([{ level: 'gate', capability }]), inputDigest: sha('candidate-r1'), builderExecution: 'exec-builder-1' },
        receipts: [entry.entry], policy: POLICY } } };
  };
  const aPayload = passPayload('A', 'architecture-review');
  const tPayload = passPayload('T', 'test-design-sufficiency');
  const input = (payload) => ({ run: { runId: 'run-p15' }, action: { gate: payload.output.gateEvidence.gate }, outcome: payload });
  // Own gate: accepted through the pure evaluation.
  assert.equal(aValidator.validate(input(aPayload)).accepted, true, 'the A validator accepts a real A pass payload');
  assert.equal(tValidator.validate(input(tPayload)).accepted, true, 'the T validator accepts a real T pass payload');
  // Cross-gate replay: refused on both directions — one gate's evidence is
  // never currency for the other, exactly like the judgment layer above.
  assert.equal(tValidator.validate(input(aPayload)).accepted, false);
  assert.match(tValidator.validate(input(aPayload)).reason, /cannot be replayed across extensions/);
  assert.equal(aValidator.validate(input(tPayload)).accepted, false);
  assert.match(aValidator.validate(input(tPayload)).reason, /cannot be replayed across extensions/);
});

test('P1_5 assembly: the plan surface is single-authority — one plan step, one plan evidence, one P extension (C04)', async () => {
  const record = await loadProbe('assembly-probes.json');
  const observed = record.records.find((entry) => entry.id === 'plan-single-surface').observed;
  // Exactly one step produces a plan: the managed planner method variant.
  assert.deepEqual(planOutputSteps(workflow), ['full.build.plan']);
  assert.equal(steps['full.build.plan'].ref, 'claude-parallel-tdd-planner-full-build-plan');
  assert.equal(steps['full.build.plan'].type, 'invoke_skill');
  // Exactly one await_evidence of kind classic-build-plan judges it.
  assert.deepEqual(planEvidenceSteps(workflow), ['full.build.plan.evidence']);
  assert.equal(steps['full.build.plan.evidence'].validator.id, 'comet-classic-build-plan');
  // Exactly one extension binds the plan gate (P) to one receipt-bundle artifact.
  const declared = JSON.parse(await fs.readFile(path.join(applicationRoot, 'extensions', 'build-plan-unique.json'), 'utf8'));
  assert.equal(declared.gate, 'P');
  assert.equal(declared.afterStep, 'full.build.plan.evidence');
  assert.deepEqual(declared.artifactRefs.map((ref) => ref.ref), ['.sdd/delivery/gates/p/receipt-bundle.json']);
  assert.deepEqual(declared.validator, { id: 'sdd.delivery.gate.p', version: '1' });
  assert.deepEqual(bindingFor('classic.extension.build-plan-unique').capability, 'claude-parallel-tdd-planner.gate');
  assert.equal(observed.planOutputSteps.length, 1);
  assert.equal(observed.planEvidenceSteps.length, 1);
  // The plan gate extension sits after the plan evidence step and its pass is
  // required before the build executes.
  assert.ok(hasTransition('full.build.plan.evidence', 'succeeded', 'classic.extension.build-plan-unique'));
  assert.ok(hasTransition('classic.extension.build-plan-unique', 'succeeded', 'full.build.execute'));
});

test('P1_5 assembly: no second scheduling surface — one plan field in the state schema and one dispatch selector', async () => {
  const record = await loadProbe('assembly-probes.json');
  assert.ok(record.records.some((entry) => entry.id === 'no-second-scheduling-surface'));
  const planFields = Object.keys(workflow.stateSchema.properties).filter((key) => /plan/i.test(key));
  assert.deepEqual(planFields, ['plan'], 'the assembled workflow carries exactly one plan-shaped state field');
  assert.deepEqual(workflow.stateSchema.properties.plan.type, ['string', 'null']);
  assert.equal(planOutputSteps(workflow).length, 1);
  // The adapter constructs ONLY the --application-file dispatch face for a
  // composition Run; --application/--workflow selectors are refused shapes.
  const argv = runtimeDispatchArgv({
    applicationFile: path.join(packageRoot, 'application.json'),
    requestFile: path.join(packageRoot, 'request.json'),
    projectRoot,
  });
  assert.deepEqual([...argv], ['runtime', 'dispatch', '--application-file', path.join(packageRoot, 'application.json'), '--request', path.join(packageRoot, 'request.json'), '--project-root', projectRoot, '--json']);
  assert.equal(argv.includes('--application'), false);
  assert.equal(argv.includes('--workflow'), false);
  assert.throws(
    () => runtimeDispatchArgv({ applicationFile: path.join(packageRoot, 'application.json'), requestFile: path.join(packageRoot, 'request.json'), workflow: 'comet-classic-full' }),
    (error) => error.code === 'DISPATCH_OPTIONS_INVALID',
    'the adapter refuses to construct any second dispatch selector face',
  );
});

test('P1_5 assembly: user approval is the sequence precondition of full.open (workflow transitions)', async () => {
  const record = await loadProbe('assembly-probes.json');
  const anchor = record.records.find((entry) => entry.id === 'approval-anchor-precedes-open').observed;
  const anchored = record.records.find((entry) => entry.id === 'work-bindings-anchored-extensions-read-only').observed;
  // The workflow starts at the composition proposal, not at full.open.
  assert.deepEqual(workflow.entry, ['classic.composition.prepare']);
  assert.equal(steps['classic.composition.prepare'].type, 'call_tool');
  // prepare only reaches the ask_user confirm step.
  assert.ok(hasTransition('classic.composition.prepare', 'succeeded', 'classic.composition.confirm'));
  const confirmStep = steps['classic.composition.confirm'];
  assert.equal(confirmStep.type, 'ask_user');
  assert.deepEqual(confirmStep.choices, ['approved', 'rejected']);
  assert.deepEqual(confirmStep.proposalFrom, ['classic.composition.prepare']);
  // Only the approved choice continues to full.open; rejection loops back.
  assert.ok(hasTransition('classic.composition.confirm', 'approved', 'full.open'));
  assert.ok(hasTransition('classic.composition.confirm', 'rejected', 'classic.composition.confirm'));
  assert.equal(anchor.confirmApprovedTo, 'full.open');
  assert.equal(anchor.directPrepareToOpen, false);
  assert.equal(transitions.some((transition) => transition.from === 'classic.composition.prepare' && transition.to === 'full.open'), false,
    'no direct prepare→full.open edge may exist — approval is not skippable in the assembled topology');
  // The full.open binding itself is anchored to the confirmed approval.
  const openBinding = bindingFor('full.open');
  assert.equal(openBinding.authorizationFrom, 'classic.composition.confirm');
  assert.deepEqual(openBinding.authorizationChoices, ['approved']);
  // Every write-side-effect work binding is anchored; the six read-only gate
  // extension bindings are not.
  assert.equal(anchoredBindings.length, 9);
  const replacementStepIds = composition.composition.replacements.map((entry) => entry.stepId);
  assert.deepEqual([...anchoredBindings.map((binding) => binding.stepId)].sort(), [...replacementStepIds].sort());
  for (const binding of anchoredBindings) {
    assert.equal(binding.authorizationFrom, 'classic.composition.confirm');
    assert.deepEqual(binding.authorizationChoices, ['approved']);
  }
  assert.deepEqual(extensionBindings.map((binding) => binding.authorizationFrom), [undefined, undefined, undefined, undefined, undefined, undefined],
    'the read-only gate extensions carry no approval anchor');
  assert.equal(anchored.anchoredWorkBindings, 9);
  assert.equal(anchored.unanchoredGateBindings, 6);
});

test('P1_5 assembly negative mutants: a stripped anchor or a smuggled direct edge is detected, not accepted', async () => {
  await loadProbe('assembly-probes.json');
  // Mutant 1: an application without the full.open authorization anchor.
  const strippedAnchor = structuredClone(application);
  delete strippedAnchor.bindings.find((binding) => binding.stepId === 'full.open').authorizationFrom;
  const anchoredIn = (doc) => doc.bindings.filter((binding) => binding.stepId === 'full.open' && binding.authorizationFrom === 'classic.composition.confirm' && JSON.stringify(binding.authorizationChoices) === '["approved"]');
  assert.equal(anchoredIn(application).length, 1);
  assert.equal(anchoredIn(strippedAnchor).length, 0, 'a stripped approval anchor must be detectable');
  // Mutant 2: a workflow with a smuggled direct prepare→full.open edge.
  const smuggledEdge = structuredClone(workflow);
  smuggledEdge.transitions.push({ from: 'classic.composition.prepare', on: 'succeeded', to: 'full.open' });
  const directEdges = (wf) => wf.transitions.filter((transition) => transition.from === 'classic.composition.prepare' && transition.to === 'full.open');
  assert.equal(directEdges(workflow).length, 0);
  assert.equal(directEdges(smuggledEdge).length, 1, 'a direct approval-skipping edge must be detectable');
  // Mutant 3: a second plan-producing step.
  const secondPlan = structuredClone(workflow);
  secondPlan.steps['full.build.plan2'] = structuredClone(secondPlan.steps['full.build.plan']);
  assert.equal(planOutputSteps(workflow).length, 1);
  assert.equal(planOutputSteps(secondPlan).length, 2, 'a second scheduling face must be detectable');
  // Mutant 4: a second state-schema plan field.
  const secondField = structuredClone(workflow);
  secondField.stateSchema.properties.plan2 = { type: ['string', 'null'] };
  const planFields = (wf) => Object.keys(wf.stateSchema.properties).filter((key) => /plan/i.test(key));
  assert.deepEqual(planFields(workflow), ['plan']);
  assert.deepEqual(planFields(secondField), ['plan', 'plan2']);
});

test('P1_5 assembly: the nine replacement steps map to distinct managed skills — method variants for method steps, domain work for domain steps', async () => {
  const record = await loadProbe('assembly-probes.json');
  const observed = record.records.find((entry) => entry.id === 'nine-step-mapping').observed;
  const replacements = composition.composition.replacements;
  assert.equal(replacements.length, 9);
  const replacementIds = replacements.map((entry) => entry.skillId);
  assert.equal(new Set(replacementIds).size, 9, 'per-step skill ids must be pairwise distinct');
  // The package binds exactly 15 skills: 9 replaced execution steps + 6 gate
  // extension faces, all unique.
  const packageSkillIds = application.skills.map((skill) => skill.id);
  assert.equal(packageSkillIds.length, 15);
  assert.equal(new Set(packageSkillIds).size, 15);
  for (const skillId of replacementIds) {
    assert.ok(packageSkillIds.includes(skillId), `the replaced execution skill ${skillId} must be a packaged skill`);
  }
  // Method steps run on build-time variants of the packaged P1_6 method
  // skills — the method skills ARE the execution skills (including the test
  // automation step full.build.execute on the tdd variant and the P step on
  // the planner variant).
  const variants = composition.managedSkillVariants.work;
  const methodVariants = variants.filter((entry) => entry.kind === 'method-variant');
  const domainWork = variants.filter((entry) => entry.kind === 'domain-work');
  assert.equal(methodVariants.length, 4);
  assert.equal(domainWork.length, 5);
  assert.deepEqual(methodVariants.map((entry) => entry.stepId).sort(),
    ['full.build.execute', 'full.build.plan', 'full.design.document', 'full.design.handoff'].sort());
  for (const variant of methodVariants) {
    assert.equal(variant.source, `skills/${variant.base}`);
    assert.equal(steps[variant.stepId].ref, variant.skillId, 'the compiled step must run the declared per-step variant');
    const packaged = application.skills.find((skill) => skill.id === variant.skillId);
    assert.equal(packaged.root, `skills/${variant.skillId}`);
    assert.equal(packaged.adapter.sideEffect, 'write');
  }
  for (const variant of domainWork) {
    assert.match(variant.root, /^internal\/domain-skills\//, 'domain steps run managed domain-work skills');
    assert.equal(steps[variant.stepId].ref, variant.skillId);
  }
  assert.deepEqual(observed.methodVariants.map((entry) => entry.skillId).sort(), methodVariants.map((entry) => entry.skillId).sort());
  assert.deepEqual(observed.domainWork.map((entry) => entry.skillId).sort(), domainWork.map((entry) => entry.skillId).sort());
  // R5 boundary: ponytail never re-entered the bound skills.
  assert.equal(composition.removedReplacements.skillId, 'ponytail');
  assert.ok(packageSkillIds.every((id) => !id.startsWith('ponytail-')), 'no per-step ponytail variant may be bound');
  // The six gate faces are the packaged P1_6 assets (grill-me, multi-agent
  // consensus review, test-authoring, planner, whitebox, lifecycle guard).
  assert.deepEqual(extensionBindings.map((binding) => binding.skillId).sort(), [
    'claude-parallel-tdd-planner', 'grill-me', 'multi-agent-consensus-review',
    'openspec-lifecycle-guard', 'test-authoring', 'whitebox-verify',
  ].sort());
  assert.equal(observed.extensionSkills, 6);
});

// ---------------------------------------------------------------------------
// Adapter layer — the six-gate receipt acceptance has zero fallback outside
// the packaged bindings validators (P1_3 comet-executor face).
// ---------------------------------------------------------------------------

test('P1_5 adapter: comet-executor accepts a gate pass only through the packaged validator — zero fallback, fail closed', async (t) => {
  const record = await loadProbe('assembly-probes.json');
  const acceptance = record.records.find((entry) => entry.id === 'executor-six-gate-packaged-acceptance').observed;
  const negatives = record.records.find((entry) => entry.id === 'executor-unregistered-and-nonpass-refused').observed;
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'p15-executor-'));
  t.after(async () => { await fs.rm(scratch, { recursive: true, force: true }); });
  const runAuthority = cometLaunchAuthority({ secret: SECRET, runId: 'p15-asmb' });
  const executor = createCometExecutor({
    native: { runCometCli: async () => ({ exitCode: 0, stdout: '{}\n' }) },
    authority: runAuthority,
    registration: {
      schemaVersion: 1,
      projectRoot: scratch,
      change: 'p15-asmb',
      runId: 'p15-asmb',
      applicationFile: path.join(applicationRoot, 'application.json'),
    },
  });
  // The composition declares exactly the six managed gates; Kt is not one of
  // them (it is the 0005 predicate — see the Kt test above).
  const described = executor.describeComposition();
  assert.deepEqual(Object.keys(described.gates).sort(), ['A', 'Kp', 'P', 'R', 'T', 'V']);
  assert.deepEqual(acceptance.gates, ['R', 'A', 'T', 'P', 'V', 'Kp']);
  assert.equal(acceptance.ktRegisteredAsExtension, false);
  assert.equal(described.kt.mechanism, 'upstream-minimal-patch-0005');

  // A real pass payload for A: admitted receipt + contract, judged pass by the
  // pure evaluation — accepted with the packaged validator id named.
  const aReceipt = receipt({ gateName: 'A', capability: 'architecture-review', execution: 'exec-a-adapter' });
  assert.equal(aReceipt.ok, true);
  const aOutcome = {
    verdict: 'pass',
    sourceHash: sha('source-a-adapter'),
    artifactHashes: { '.sdd/delivery/gates/a/receipt-bundle.json': sha('bundle-a-adapter') },
    output: { gateEvidence: { gate: 'A',
      inputs: { testContract: A_CONTRACT, inputDigest: sha('candidate-r1'), builderExecution: 'exec-builder-1' },
      receipts: [aReceipt.entry], policy: POLICY } },
  };
  const accepted = await executor.acceptGateReceipt({ gate: 'A', execution: 'exec-a-adapter', outcome: aOutcome });
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.validatorId, 'sdd.delivery.gate.a');
  assert.equal(accepted.extensionId, 'architecture-consensus');

  // Cross-gate replay is refused with the replay reason.
  const crossGate = await executor.acceptGateReceipt({ gate: 'T', execution: 'exec-t-adapter', outcome: aOutcome });
  assert.equal(crossGate.accepted, false);
  assert.match(crossGate.reason, /cannot be replayed across extensions/);

  // Blocked coverage (no receipts) is refused with the blocked reasons.
  const blockedOutcome = {
    verdict: 'pass',
    sourceHash: sha('source-v-adapter'),
    artifactHashes: { '.sdd/delivery/gates/v/receipt-bundle.json': sha('bundle-v-adapter') },
    output: { gateEvidence: { gate: 'V',
      inputs: { testContract: contractFixture([{ level: 'gate', capability: 'verify-execution' }]), inputDigest: sha('candidate-r1'), builderExecution: 'exec-builder-1' },
      receipts: [], policy: POLICY } },
  };
  const blocked = await executor.acceptGateReceipt({ gate: 'V', execution: 'exec-v-adapter', outcome: blockedOutcome });
  assert.equal(blocked.accepted, false);
  assert.match(blocked.reason, /MISSING_OBSERVATION/);

  // A claimed pass without a gateEvidence payload is refused by the validator.
  const noPayload = await executor.acceptGateReceipt({
    gate: 'T', execution: 'exec-t-nopayload',
    outcome: { verdict: 'pass', sourceHash: sha('source-t'), artifactHashes: { '.sdd/delivery/gates/t/receipt-bundle.json': sha('bundle-t') }, output: {} },
  });
  assert.equal(noPayload.accepted, false);
  assert.match(noPayload.reason, /carries no gateEvidence payload/);

  // Unregistered gates never reach a validator: Kt and X are refused outright.
  await assert.rejects(() => executor.acceptGateReceipt({ gate: 'Kt', execution: 'exec-kt', outcome: aOutcome }),
    (error) => error.code === 'ACTION_NOT_REGISTERED');
  await assert.rejects(() => executor.acceptGateReceipt({ gate: 'X', execution: 'exec-x', outcome: aOutcome }),
    (error) => error.code === 'ACTION_NOT_REGISTERED');
  assert.equal(negatives.unregisteredGate, 'ACTION_NOT_REGISTERED');

  // A non-pass verdict claim never even reaches a validator.
  await assert.rejects(() => executor.acceptGateReceipt({ gate: 'A', execution: 'exec-a-repair', outcome: { ...aOutcome, verdict: 'repair' } }),
    (error) => error.code === 'EXTENSION_OUTCOME_INVALID');
  assert.equal(negatives.nonPassVerdict, 'EXTENSION_OUTCOME_INVALID');

  // The authority never signs outside an executor-scoped native call.
  assert.throws(
    () => executor.host.authority.issueDispatch({ runnerId: 'comet-classic', run: 'p15-asmb', gate: 'A', inputDigest: sha('candidate-r1'), policyDigest: POLICY.digest, attempt: 1, epoch: 1, role: 'verifier', execution: 'exec-a-adapter' }),
    (error) => error.code === 'ORIGINAL_NATIVE_CALL_REQUIRED',
  );
  assert.equal(negatives.ambientSigning, 'ORIGINAL_NATIVE_CALL_REQUIRED');

  // The Kt port reports honestly: blocked while required and unmet, the write
  // path stays UNVERIFIED (supply/admission wave).
  const kt = executor.ktCloseout({ knowledgeCloseout: { required: true } });
  assert.equal(kt.gate, 'Kt');
  assert.equal(kt.blocked, true);
  assert.equal(kt.overallCompletionEligible, false);
  assert.match(kt.writePath, /^UNVERIFIED/);
  assert.equal(executor.ktCloseout({ knowledgeCloseout: { required: true, completed: true } }).overallCompletionEligible, true);
  assert.equal(executor.ktCloseout({}).overallCompletionEligible, true);
});

// ---------------------------------------------------------------------------
// C08 — OpenSpec compatibility is refused explicitly and resolved only by the
// fixed isolated candidate: real CLIs, real status JSON, real closure
// predicate from the pinned 0.5.0+0005 build.
// ---------------------------------------------------------------------------

const openspecScratch = async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'p15-openspec-'));
  t.after(async () => { await fs.rm(root, { recursive: true, force: true }); });
  const change = path.join(root, 'openspec/changes/demo');
  await fs.mkdir(change, { recursive: true });
  await fs.writeFile(path.join(root, 'openspec/config.yaml'), 'schema: spec-driven\n');
  await fs.writeFile(path.join(change, '.openspec.yaml'), 'schema: spec-driven\nskip_specs: true\n');
  await fs.writeFile(path.join(change, 'proposal.md'), '# Proposal\nPure refactor.\n');
  await fs.writeFile(path.join(change, 'tasks.md'), '- [ ] Refactor and test\n');
  return root;
};

const openspecStatus = (bin, root, useNode) => {
  const env = { ...process.env, HOME: root, USERPROFILE: root, XDG_CONFIG_HOME: path.join(root, 'config'), CI: 'true', DO_NOT_TRACK: '1', OPENSPEC_TELEMETRY: '0' };
  const result = useNode
    ? spawnSync(process.execPath, [bin, 'status', '--change', 'demo', '--json'], { cwd: root, encoding: 'utf8', timeout: 60_000, env })
    : spawnSync(bin, ['status', '--change', 'demo', '--json'], { cwd: root, encoding: 'utf8', timeout: 60_000, env });
  return result;
};

test('C08 negative: the captured historical OpenSpec 1.3.1 response is replayed against the pinned 0.5.0 build predicate, not impersonated by the current host', async () => {
  const record = await loadProbe('openspec-compat.json');
  assert.equal(record.negative?.cliVersion, '1.3.1');
  assert.equal(record.negative?.observation, 'HISTORICAL_RESPONSE_REPLAY');
  const capture = record.negative.replayInput;
  assert.equal(capture.path, 'openspec/changes/delivery-foundation-rearchitecture/package-probes/1_1.b-green-openspec-status-131-input.json');
  const bytes = await fs.readFile(path.join(projectRoot, capture.path));
  assert.equal(bytes.length, capture.bytes);
  assert.equal(sha(bytes), capture.sha256, 'the original real CLI response must remain byte-identical');
  const statusJson = JSON.parse(bytes);
  assert.equal(statusJson.artifacts.length, 4);
  for (const artifact of statusJson.artifacts) {
    assert.equal(artifact.requires, undefined, 'the captured legacy response exposes no dependency edges');
  }
  assert.ok(built, 'the pinned 0.5.0+0005 Comet build is required for the historical compatibility replay');
  assert.equal(record.fixedEnvironment.buildFingerprint, fingerprint, 'the probe must pin the exact build the predicate came from');
  assert.equal(record.fixedEnvironment.predicateSha256, sha(await fs.readFile(distRequirements)), 'the predicate bytes must stay pinned');
  const { requiredArtifactClosure } = await import(distRequirements);
  assert.throws(
    () => requiredArtifactClosure(statusJson),
    (error) => error.message === record.negative.closureError,
    'the current real predicate must still refuse the historical response',
  );
});

test('C08 current host: the live host CLI exposes dependency edges and the pinned predicate accepts them (drift is observed, never upgraded)', async (t) => {
  const record = await loadProbe('openspec-compat.json');
  assert.equal(record.currentHost?.observation, 'CURRENT_HOST_CLI');
  // The host-global CLI drifts outside this change (baseline recorded
  // 1.3.1 → 1.14.3; observed 1.15.0 at registration). The upgrade policy
  // forbids global upgrades, so the agreement oracle for this leg is the
  // closure predicate over the live response, never the version string.
  assert.match(record.currentHost.cliVersionPolicy, /drift.*environmental fact|environmental fact.*drift/s);
  assert.match(toolchain.openspec.upgrade_policy, /No global upgrade/i);
  const root = await openspecScratch(t);
  const env = { ...process.env, HOME: root, USERPROFILE: root, XDG_CONFIG_HOME: path.join(root, 'config'), CI: 'true', DO_NOT_TRACK: '1', OPENSPEC_TELEMETRY: '0' };
  const version = spawnSync('openspec', ['--version'], { cwd: root, encoding: 'utf8', timeout: 30_000, env });
  assert.equal(version.status, 0, 'current host OpenSpec must be available; a missing CLI is not compatibility evidence');
  assert.match(version.stdout.trim(), /^\d+\.\d+\.\d+$/, 'the host CLI must answer with a plain semver');
  const status = openspecStatus('openspec', root, false);
  assert.equal(status.status, 0, `current host openspec status failed: ${status.stderr}`);
  const statusJson = JSON.parse(status.stdout);
  assert.ok(statusJson.artifacts.every((artifact) => Array.isArray(artifact.requires)));
  assert.ok(built, 'the pinned 0.5.0+0005 Comet build is required');
  const { requiredArtifactClosure } = await import(distRequirements);
  const closure = requiredArtifactClosure(statusJson);
  assert.deepEqual(Object.fromEntries(closure.map(({ id, status }) => [id, status])), record.currentHost.closure,
    'the pinned predicate must accept the live host response with the registered closure');
});

test('C08 positive: the isolated 1.11.0 candidate exposes the edges and the same closure accepts it — no global upgrade', async (t) => {
  const record = await loadProbe('openspec-compat.json');
  assert.equal(record.positive?.isolatedInstall, '.sdd/tools/openspec-1.11.0');
  assert.equal(record.positive?.cliVersion, toolchain.openspec.isolated_candidate);
  assert.ok(isolatedOpenspecReady, 'fixed isolated OpenSpec 1.11.0 must be installed; no skip or global replacement');
  assert.ok(built, 'the pinned 0.5.0+0005 Comet build is required');
  const root = await openspecScratch(t);
  const version = spawnSync(process.execPath, [isolatedOpenspecBin, '--version'], {
    cwd: root, encoding: 'utf8', timeout: 30_000,
    env: { ...process.env, HOME: root, USERPROFILE: root, XDG_CONFIG_HOME: path.join(root, 'config'), OPENSPEC_TELEMETRY: '0', DO_NOT_TRACK: '1' },
  });
  assert.equal(version.status, 0);
  assert.equal(version.stdout.trim(), record.positive.cliVersion);
  const status = openspecStatus(isolatedOpenspecBin, root, true);
  assert.equal(status.status, 0, `isolated openspec status failed: ${status.stderr}`);
  const statusJson = JSON.parse(status.stdout);
  assert.ok(statusJson.artifacts.every((artifact) => Array.isArray(artifact.requires)));
  const { requiredArtifactClosure } = await import(distRequirements);
  const closure = requiredArtifactClosure(statusJson);
  assert.deepEqual(Object.fromEntries(closure.map(({ id, status }) => [id, status])), record.positive.closure);
});

test('C08 negative: missing or invalid dependency edges are refused without guessing a closure', async (t) => {
  assert.ok(isolatedOpenspecReady && built, 'fixed real CLI and predicate are required');
  const root = await openspecScratch(t);
  const response = openspecStatus(isolatedOpenspecBin, root, true);
  assert.equal(response.status, 0);
  const status = JSON.parse(response.stdout);
  const { requiredArtifactClosure } = await import(distRequirements);
  assert.ok(requiredArtifactClosure(status).some(({ id }) => id === 'tasks'), 'start with an accepted real response');
  const invalid = (change) => { const value = structuredClone(status); change(value); return value; };
  const task = (value) => value.artifacts.find(({ id }) => id === 'tasks');
  for (const value of [
    invalid((value) => { delete task(value).requires; }),
    invalid((value) => { task(value).requires = null; }),
    invalid((value) => { task(value).requires = 'proposal'; }),
    invalid((value) => { task(value).requires = [42]; }),
  ]) assert.throws(() => requiredArtifactClosure(value), /OpenSpec must expose dependency edges for every artifact/);
  assert.throws(() => requiredArtifactClosure(invalid((value) => { task(value).requires = ['missing-artifact']; })), /Missing OpenSpec dependency: missing-artifact/);
  assert.throws(() => requiredArtifactClosure(invalid((value) => { task(value).requires = ['tasks']; })), /Cyclic OpenSpec dependency: tasks/);
  assert.throws(() => requiredArtifactClosure(invalid((value) => { delete value.applyRequires; })), /OpenSpec must expose artifacts and applyRequires/);
});

// ---------------------------------------------------------------------------
// Probe registration consistency — the records cite real entries and match
// the freshly observed behavior above.
// ---------------------------------------------------------------------------

test('P1_5 probe registration is complete and cites real-entry evidence', async () => {
  const names = ['gate-matrix.json', 'knowledge-closeout.json', 'assembly-probes.json', 'entrances-c07.json', 'bypass-recovery.json'];
  for (const name of names) {
    const record = await loadProbe(name);
    assert.ok(record.schemaVersion, `${name} must pin its schema version`);
    assert.equal(record.revision, '2026-10-26-comet-050-adoption-v1', `${name} must pin the comet-050 adoption revision`);
    assert.ok(Array.isArray(record.records) && record.records.length > 0, `${name} must carry records`);
    for (const entry of record.records) {
      assert.ok(entry.id && entry.entry && entry.oracle && entry.observed !== undefined,
        `${name} record without id/entry/oracle/observed: ${JSON.stringify(entry).slice(0, 140)}`);
    }
  }
  // The assembly registration carries the composed behaviors (a–d + executor).
  const assembly = await loadProbe('assembly-probes.json');
  const assemblyIds = assembly.records.map((entry) => entry.id);
  for (const id of [
    'at-extensions-independent', 'at-cross-replay-refused',
    'plan-single-surface', 'no-second-scheduling-surface',
    'approval-anchor-precedes-open', 'work-bindings-anchored-extensions-read-only',
    'nine-step-mapping', 'executor-six-gate-packaged-acceptance',
    'executor-unregistered-and-nonpass-refused', 'kt-predicate-single-run-parking',
  ]) assert.ok(assemblyIds.includes(id), `assembly record ${id} must be registered`);
  // The knowledge registration carries Kp sealing and the 0005 Kt predicate.
  const knowledge = await loadProbe('knowledge-closeout.json');
  const knowledgeIds = knowledge.records.map((entry) => entry.id);
  for (const id of ['kp-required-before-archive', 'readback-digest-required', 'forged-seal-refused', 'seal-exactly-once', 'kt-0005-fail-open-default', 'kt-0005-required-unmet-parks-same-run']) {
    assert.ok(knowledgeIds.includes(id), `knowledge record ${id} must be registered`);
  }
  // C07: the hooks-absent CLI-side entrances are registered (the real-CLI
  // re-run lives in test/delivery-cases/1_5.mjs against the same build).
  const entrances = await loadProbe('entrances-c07.json');
  const registered = entrances.records.map((entry) => entry.id);
  for (const entrance of ['guard-preview', 'guard-apply', 'transition-manual-declaration', 'next-continuation', 'archive-outside-phase', 'dispatch-entry-name', 'dispatch-missing-package']) {
    assert.ok(registered.includes(entrance), `C07 entrance ${entrance} must be registered`);
  }
  assert.equal(entrances.environment.hooksAbsent.split(' ')[0], '.claude/settings.local.json', 'the entrance registration must state the hooks-absent isolation');
  const bypass = await loadProbe('bypass-recovery.json');
  for (const id of ['direct-phase-write', 'tampered-phase-file', 'manual-record-check']) {
    assert.ok(bypass.records.some((entry) => entry.id === id), `bypass record ${id} must be registered`);
  }
  // openspec-compat.json pins the C08 trio of observations.
  const compat = await loadProbe('openspec-compat.json');
  assert.ok(compat.negative?.cliVersion && compat.negative?.closureError, 'the C08 refusal must be registered with the pinned CLI version and the real predicate error');
  assert.equal(compat.positive?.closureResult, 'ACCEPTED');
  assert.equal(compat.fixedEnvironment?.isolatedInstall, '.sdd/tools/openspec-1.11.0');
  assert.equal(compat.fixedEnvironment?.buildFingerprint, fingerprint);
});

// The package pin registration: the 15 managed skills of the compiled
// package (method variants, domain work, extension faces) with the official
// compiler content hashes. A drifted digest or role is refused.
test('P1_5 method dispatch content is pinned to the compiled package without claiming execution', async () => {
  const record = await loadProbe('method-dispatch-content.json');
  assert.equal(record.qualification, 'PACKAGE_PIN_ONLY');
  assert.equal(record.methodExecution, 'NOT_EXECUTED');
  assert.equal(record.profile, 'comet-classic-full-050');
  assert.equal(record.skills.length, 15);
  assert.ok(record.skills.every((skill) => skill.digest && skill.role && skill.disposition), 'each pinned skill must carry digest, role and disposition');
  const live = new Map(application.skills.map((skill) => [skill.id, skill.contentHash]));
  for (const skill of record.skills) {
    assert.equal(live.get(skill.name), skill.digest, `packaged skill ${skill.name} drifted from the registered pin`);
  }
  // The roles agree with the composition mapping.
  const variants = new Map(composition.managedSkillVariants.work.map((entry) => [entry.skillId, entry.kind]));
  const extensionSkillIds = new Set(extensionBindings.map((binding) => binding.skillId));
  for (const skill of record.skills) {
    if (skill.role === 'extension-skill') assert.ok(extensionSkillIds.has(skill.name), `${skill.name} must be a bound gate face`);
    else assert.equal(variants.get(skill.name), skill.role === 'method-variant' ? 'method-variant' : 'domain-work', `${skill.name} role drifted from the composition mapping`);
  }
  assert.equal(record.skills.filter((skill) => skill.role === 'method-variant').length, 4);
  assert.equal(record.skills.filter((skill) => skill.role === 'domain-work').length, 5);
  assert.equal(record.skills.filter((skill) => skill.role === 'extension-skill').length, 6);
  // A re-hashed drift is still a drift: flipping one digest must be caught.
  const drifted = structuredClone(record);
  drifted.skills.find((skill) => skill.name === 'tdd-full-build-execute').digest = sha('private-drift');
  assert.notEqual(live.get('tdd-full-build-execute'), drifted.skills.find((skill) => skill.name === 'tdd-full-build-execute').digest,
    'a caller-side re-hash never approves new package bytes');
});

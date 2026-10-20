// P1_5 — Classic single-controller integration verified against the real
// managed entries (classic-integration-design.md; acceptance C01–C08).
//
// R/A/T separation, P single authority, V independent receipts and the
// Kp/Kt readback gates are exercised through the accepted infrastructure —
// lib/delivery/gate.js evaluate (SDD.Gate.v1, imported unmodified), the P2_2
// trusted launcher + admission (lib/delivery/evidence.js), the P1_3 driver
// exclusivity (lib/adapters/harness.js) and the single closeout owner
// (lib/adapters/comet.js sealCloseout) — never through mocks. The OpenSpec
// compatibility pair (C08) runs the real host 1.3.1 CLI and the real
// isolated 1.11.0 candidate against the real requiredArtifactClosure of the
// patched pinned build. Probe records live in
// openspec/changes/delivery-foundation-rearchitecture/classic-integration-probes/
// and are the RED boundary: without them the behaviors have no registered
// evidence. The real-CLI lifecycle entrances (C07) and the bypass/recovery
// negatives live in test/delivery-cases/1_5.mjs.
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
const { cometLaunchAuthority, sealCloseout } = await import('../lib/adapters/comet.js');
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
  const verdict = gate.evaluate({ testContract: A_CONTRACT, inputDigest: sha('candidate-r1'), builderExecution: 'exec-builder-1' }, [entry.entry], POLICY);
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
  assert.match(refused.reason, /does not match current full-input digest/);
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
// C08 — OpenSpec compatibility is refused explicitly and resolved only by the
// fixed isolated candidate: real CLIs, real status JSON, real closure
// predicate from the patched build.
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

test('C08 negative: the pinned host OpenSpec 1.3.1 status lacks dependency edges and the Classic closure refuses it', async (t) => {
  const record = await loadProbe('openspec-compat.json');
  assert.equal(record.negative?.cliVersion, toolchain.openspec.current, 'the registered refusal must cite the pinned host CLI version');
  const hostVersion = spawnSync('openspec', ['--version'], { encoding: 'utf8', timeout: 30_000 });
  if (hostVersion.status !== 0 || !hostVersion.stdout) {
    return t.skip(`host-global openspec CLI is not available (toolchain-baseline pins ${toolchain.openspec.current}); the negative cannot run here`);
  }
  const observed = hostVersion.stdout.trim();
  assert.equal(observed, toolchain.openspec.current,
    `host-global openspec drifted from the toolchain-baseline pin ${toolchain.openspec.current} to ${observed}; re-pin or migrate before running this suite`);
  const root = await openspecScratch(t);
  const status = openspecStatus('openspec', root, false);
  assert.equal(status.status, 0, `host openspec status failed: ${status.stderr}`);
  const statusJson = JSON.parse(status.stdout);
  for (const artifact of statusJson.artifacts) {
    assert.equal(artifact.requires, undefined, 'the pinned host CLI must expose no requires edges (that is the incompatibility)');
  }
  assert.ok(built, 'patched Comet build is not present; run tools/comet/build.mjs --archive first');
  const { requiredArtifactClosure } = await import(distRequirements);
  assert.throws(
    () => requiredArtifactClosure(statusJson),
    (error) => /OpenSpec must expose dependency edges for every artifact; upgrade to a supported version/.test(error.message),
  );
});

test('C08 positive: the isolated 1.11.0 candidate exposes the edges and the same closure accepts it — no global upgrade', async (t) => {
  const record = await loadProbe('openspec-compat.json');
  assert.equal(record.positive?.isolatedInstall, '.sdd/tools/openspec-1.11.0', 'the fixed compatible environment must be the isolated install');
  if (!isolatedOpenspecReady) {
    return t.skip('isolated openspec 1.11.0 is not installed under .sdd/tools; run the isolated install (never a global upgrade)');
  }
  assert.ok(built, 'patched Comet build is not present; run tools/comet/build.mjs --archive first');
  const root = await openspecScratch(t);
  const status = openspecStatus(isolatedOpenspecBin, root, true);
  assert.equal(status.status, 0, `isolated openspec status failed: ${status.stderr}`);
  const statusJson = JSON.parse(status.stdout);
  for (const artifact of statusJson.artifacts) {
    assert.ok(Array.isArray(artifact.requires), 'the candidate exposes the dependency edges the closure needs');
  }
  const { requiredArtifactClosure } = await import(distRequirements);
  const closure = requiredArtifactClosure(statusJson);
  assert.equal(closure.find((item) => item.id === 'specs')?.status, 'skipped');
  assert.equal(closure.find((item) => item.id === 'design')?.status, 'ready');
  assert.equal(closure.find((item) => item.id === 'tasks')?.status, 'done');
});

// ---------------------------------------------------------------------------
// Probe registration consistency — the records cite real commands and match
// the freshly observed behavior above.
// ---------------------------------------------------------------------------

test('P1_5 probe registration is complete and cites real-entry evidence', async () => {
  const names = ['gate-matrix.json', 'knowledge-closeout.json', 'openspec-compat.json', 'entrances-c07.json', 'bypass-recovery.json', 'method-dispatch-content.json'];
  for (const name of names) {
    const record = await loadProbe(name);
    assert.ok(record.schemaVersion, `${name} must pin its schema version`);
    assert.ok(Array.isArray(record.records) && record.records.length > 0, `${name} must carry records`);
    for (const entry of record.records) {
      assert.ok(entry.id && entry.entry && entry.oracle && entry.observed !== undefined,
        `${name} record without id/entry/oracle/observed: ${JSON.stringify(entry).slice(0, 140)}`);
    }
  }
  // C07: every managed entrance is registered, extending P1_4's six with the
  // state check entrance semantics.
  const entrances = await loadProbe('entrances-c07.json');
  const registered = entrances.records.map((entry) => entry.id);
  for (const entrance of ['transition', 'guard-preview', 'guard-apply', 'next-continuation', 'archive', 'write-hook', 'state-check']) {
    assert.ok(registered.includes(entrance), `C07 entrance ${entrance} must be registered`);
  }
  const modeQualification = JSON.parse(await fs.readFile(path.join(changeRoot, 'mode-qualification.json'), 'utf8'));
  assert.ok(Array.isArray(modeQualification.c07Entrances) && modeQualification.c07Entrances.length >= 6,
    'P1_4 registered at least six entrances; this registration must extend, not contradict it');
});

test('P1_5 method dispatch content is pinned and matches the vendored snapshots', async () => {
  const record = await loadProbe('method-dispatch-content.json');
  // The digest formula is fixed with the record: sha256 over the sorted
  // `sha256<TWO SPACES><relative path>` lines of every file in the skill dir.
  const digestOf = async (relative) => {
    const root = path.join(projectRoot, relative);
    const files = (await fs.readdir(root, { recursive: true, withFileTypes: true }))
      .filter((item) => item.isFile())
      .map((item) => path.relative(root, path.join(item.parentPath ?? item.path, item.name)).split(path.sep).join('/'))
      .sort();
    const lines = [];
    for (const file of files) {
      lines.push(`${crypto.createHash('sha256').update(await fs.readFile(path.join(root, file))).digest('hex')}  ${file}`);
    }
    return crypto.createHash('sha256').update(lines.join('\n')).digest('hex');
  };
  for (const skill of record.skills) {
    assert.ok(/^\.agents\/skills\/[a-z0-9-]+$/.test(skill.path), `skill path must be a vendored snapshot: ${skill.path}`);
    const fresh = await digestOf(skill.path);
    assert.equal(fresh, skill.digest, `vendored ${skill.name} drifted from the pinned dispatch content; re-record classic-integration-probes/method-dispatch-content.json`);
    assert.ok(skill.role && skill.disposition, `skill ${skill.name} must record its R/A/T/P/V role and disposition`);
  }
});

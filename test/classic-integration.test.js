// P1_5 — Classic single-controller integration verified against the real
// managed entries (classic-integration-design.md; acceptance C01–C08).
//
// R/A/T separation, P single authority, V independent receipts and the
// Kp/Kt readback gates are exercised through the accepted infrastructure —
// lib/delivery/gate.js evaluate (SDD.Gate.v1, imported unmodified), the P2_2
// trusted launcher + admission (lib/delivery/evidence.js), the P1_3 driver
// exclusivity (lib/adapters/harness.js) and the single closeout owner
// (lib/adapters/comet.js sealCloseout) — never through mocks. The OpenSpec
// compatibility checks (C08) replay the captured historical 1.3.1 response
// and run the current host plus isolated 1.11.0 CLIs against the real
// requiredArtifactClosure of the patched pinned build. Probe records live in
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

test('C08 negative: the captured historical OpenSpec 1.3.1 response is replayed, not impersonated by the current host', async () => {
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
  assert.ok(built, 'fixed patched Comet build is required for historical compatibility replay');
  assert.equal(record.fixedEnvironment.predicateBuildFingerprint, fingerprint);
  assert.equal(sha(await fs.readFile(distRequirements)), record.fixedEnvironment.predicateSha256);
  const { requiredArtifactClosure } = await import(distRequirements);
  assert.throws(
    () => requiredArtifactClosure(statusJson),
    (error) => error.message === record.negative.closureError,
    'the current real predicate must still refuse the historical response',
  );
});

test('C08 current host: the observed CLI version and dependency edges are separate from the historical refusal', async (t) => {
  const record = await loadProbe('openspec-compat.json');
  assert.equal(record.currentHost?.cliVersion, toolchain.openspec.current);
  assert.equal(record.currentHost?.observation, 'CURRENT_HOST_CLI');
  const root = await openspecScratch(t);
  const env = { ...process.env, HOME: root, USERPROFILE: root, XDG_CONFIG_HOME: path.join(root, 'config'), CI: 'true', DO_NOT_TRACK: '1', OPENSPEC_TELEMETRY: '0' };
  const version = spawnSync('openspec', ['--version'], { cwd: root, encoding: 'utf8', timeout: 30_000, env });
  assert.equal(version.status, 0, 'current host OpenSpec must be available; a missing CLI is not compatibility evidence');
  assert.equal(version.stdout.trim(), record.currentHost.cliVersion, 'observe current toolchain drift without relabelling legacy history');
  const status = openspecStatus('openspec', root, false);
  assert.equal(status.status, 0, `current host openspec status failed: ${status.stderr}`);
  const statusJson = JSON.parse(status.stdout);
  assert.ok(statusJson.artifacts.every((artifact) => Array.isArray(artifact.requires)));
  assert.ok(built, 'fixed patched Comet build is required');
  const { requiredArtifactClosure } = await import(distRequirements);
  const closure = requiredArtifactClosure(statusJson);
  assert.deepEqual(Object.fromEntries(closure.map(({ id, status }) => [id, status])), record.currentHost.closure);
});

test('C08 positive: the isolated 1.11.0 candidate exposes the edges and the same closure accepts it — no global upgrade', async (t) => {
  const record = await loadProbe('openspec-compat.json');
  assert.equal(record.positive?.isolatedInstall, '.sdd/tools/openspec-1.11.0');
  assert.equal(record.positive?.cliVersion, toolchain.openspec.isolated_candidate);
  assert.ok(isolatedOpenspecReady, 'fixed isolated OpenSpec1.11.0 must be installed; no skip or global replacement');
  assert.ok(built, 'fixed patched Comet build is required');
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
// Probe registration consistency — the records cite real commands and match
// the freshly observed behavior above.
// ---------------------------------------------------------------------------

test('P1_5 probe registration is complete and cites real-entry evidence', async () => {
  const names = ['gate-matrix.json', 'knowledge-closeout.json', 'entrances-c07.json', 'bypass-recovery.json'];
  for (const name of names) {
    const record = await loadProbe(name);
    assert.ok(record.schemaVersion, `${name} must pin its schema version`);
    assert.ok(Array.isArray(record.records) && record.records.length > 0, `${name} must carry records`);
    for (const entry of record.records) {
      assert.ok(entry.id && entry.entry && entry.oracle && entry.observed !== undefined,
        `${name} record without id/entry/oracle/observed: ${JSON.stringify(entry).slice(0, 140)}`);
    }
  }
  // openspec-compat.json pins the C08 pair as negative/positive observations.
  const compat = await loadProbe('openspec-compat.json');
  assert.ok(compat.negative?.cliVersion && compat.negative?.closureError, 'the C08 refusal must be registered with the pinned CLI version and the real predicate error');
  assert.equal(compat.positive?.closureResult, 'ACCEPTED');
  assert.equal(compat.fixedEnvironment?.isolatedInstall, '.sdd/tools/openspec-1.11.0');
  // method-dispatch-content.json pins the vendored skill snapshots as skills.
  const dispatchContent = await loadProbe('method-dispatch-content.json');
  assert.ok(Array.isArray(dispatchContent.skills) && dispatchContent.skills.length >= 3, 'the three method skills must be pinned');
  assert.ok(dispatchContent.skills.every((skill) => skill.digest && skill.role && skill.disposition), 'each pinned skill must carry digest, role and disposition');
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

// Source pins are preparation evidence. The manifest and immutable cache are
// independently reviewed inputs; recomputing a digest cannot approve new bytes.
async function assertApprovedMethodPins(record, sourceRoot = projectRoot) {
  assert.equal(record.qualification, 'SOURCE_PIN_ONLY');
  assert.equal(record.methodExecution, 'NOT_EXECUTED');
  assert.equal(record.profile, 'comet-managed-v2');
  const approval = record.sourceApproval;
  assert.equal(approval.methodCount, 11);
  assert.equal(approval.fileCount, 245);
  assert.match(approval.sealedBaseline.exportDigest, /^[a-f0-9]{64}$/);
  assert.equal(approval.sourceUpgrades.path, 'worker-reports/P1_6-convergence/source-upgrades.json');
  assert.equal(approval.task, 'P1_6');
  const manifestRelative = 'openspec/changes/delivery-foundation-rearchitecture/method-profile-manifest.json';
  assert.equal(approval.manifest.path, manifestRelative);
  const manifestBytes = await fs.readFile(path.join(projectRoot, manifestRelative));
  assert.equal(sha(manifestBytes), approval.manifest.sha256, 'approved P1_6 manifest drift');
  const manifest = JSON.parse(manifestBytes);
  assert.equal(manifest.current_profile_id, record.profile);
  const upgradeBytes = await fs.readFile(path.join(projectRoot, approval.sourceUpgrades.path));
  assert.equal(sha(upgradeBytes), approval.sourceUpgrades.sha256, 'P1_6 whole-source upgrade evidence drift');
  const sealedRoot = path.join(projectRoot, 'foundation/baselines', approval.sealedBaseline.exportDigest);
  const sealedBytes = await fs.readFile(path.join(sealedRoot, 'manifest.json'));
  assert.equal(sha(sealedBytes), approval.sealedBaseline.manifestSha256, 'sealed source manifest drift');
  const sealed = JSON.parse(sealedBytes);
  assert.equal(sealed.exportDigest, approval.sealedBaseline.exportDigest);
  assert.equal(sha(await fs.readFile(path.join(sealedRoot, 'source', manifestRelative))), approval.manifest.sha256,
    'the approved P1_6 manifest must itself be present unchanged in the sealed baseline');
  const snapshots = new Map(manifest.snapshots.map((item) => [item.name, item]));
  assert.equal(snapshots.size, 11);
  let checked = 0;
  for (const snapshot of snapshots.values()) {
    assert.equal(snapshot.snapshot_path, `.agents/skills/${snapshot.name}`);
    const skillRoot = path.join(sourceRoot, snapshot.snapshot_path);
    assert.ok((await fs.lstat(skillRoot)).isDirectory(), 'method source must be a real directory');
    const entries = await fs.readdir(skillRoot, { recursive: true, withFileTypes: true });
    assert.ok(entries.every((item) => item.isDirectory() || item.isFile()), 'method source contains a link or unsafe type');
    const files = entries.filter((item) => item.isFile()).map((item) =>
      `${snapshot.name}/${path.relative(skillRoot, path.join(item.parentPath ?? item.path, item.name)).split(path.sep).join('/')}`,
    ).sort();
    assert.deepEqual(files, Object.keys(snapshot.files).sort(), `approved file set drift: ${snapshot.name}`);
    assert.equal(files.length, snapshot.file_count);
    const lines = [];
    for (const file of files) {
      const relative = file.slice(snapshot.name.length + 1);
      const digest = sha(await fs.readFile(path.join(skillRoot, relative)));
      assert.equal(digest, snapshot.files[file], `approved source byte drift: ${file}`);
      const sourcePath = `source/.agents/skills/${file}`;
      assert.equal(sealed.files[sourcePath], digest, `sealed source pin mismatch: ${file}`);
      assert.equal(sha(await fs.readFile(path.join(sealedRoot, sourcePath))), digest, `sealed source byte drift: ${file}`);
      lines.push(`${digest}  ${file}`);
      checked++;
    }
    // Exact P1_6/Foundation formula: sort the complete hash-prefixed lines,
    // including the method name in each path, join LF without a final LF.
    const digest = sha(lines.sort().join('\n'));
    assert.equal(digest, snapshot.content_sha256);
    const skill = record.skills.find((item) => item.name === snapshot.name);
    if (skill) {
      assert.equal(skill.path, snapshot.snapshot_path);
      assert.equal(skill.digest, digest, `dispatch pin differs from the approved P1_6 source: ${skill.name}`);
      assert.equal(skill.files, files.length);
      assert.equal(skill.digestFormula, record.digestFormula);
      assert.ok(skill.role && skill.disposition);
    }
  }
  assert.equal(checked, 245, 'all approved methods, including dotfiles and fixture logs, must be checked');
  assert.deepEqual(record.skills.map(({ name }) => name).sort(), ['claude-parallel-tdd-planner', 'test-authoring', 'whitebox-verify']);
}

test('P1_5 method dispatch content is pinned to the approved P1_6 and sealed 245-file source, without claiming execution', async () => {
  await assertApprovedMethodPins(await loadProbe('method-dispatch-content.json'));
});

test('P1_5 source drift is refused even when a caller re-hashes its modified dispatch content', async (t) => {
  const record = await loadProbe('method-dispatch-content.json');
  await assertApprovedMethodPins(record);
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'p15-method-pin-'));
  t.after(async () => { await fs.rm(scratch, { recursive: true, force: true }); });
  const manifest = JSON.parse(await fs.readFile(path.join(projectRoot, record.sourceApproval.manifest.path), 'utf8'));
  for (const snapshot of manifest.snapshots) {
    const root = path.join(scratch, snapshot.snapshot_path);
    await fs.mkdir(path.dirname(root), { recursive: true });
    await fs.cp(path.join(projectRoot, snapshot.snapshot_path), root, { recursive: true });
  }
  await assertApprovedMethodPins(record, scratch);
  const copied = path.join(scratch, '.agents/skills/whitebox-verify');
  const dotfile = path.join(copied, '.gitignore');
  const original = await fs.readFile(dotfile);
  await fs.appendFile(dotfile, '\n# private source drift fixture\n');
  const changed = structuredClone(record);
  const files = (await fs.readdir(copied, { recursive: true, withFileTypes: true }))
    .filter((item) => item.isFile())
    .map((item) => path.relative(copied, path.join(item.parentPath ?? item.path, item.name)).split(path.sep).join('/'));
  const changedLines = await Promise.all(files.map(async (file) => `${sha(await fs.readFile(path.join(copied, file)))}  whitebox-verify/${file}`));
  changed.skills.find(({ name }) => name === 'whitebox-verify').digest = sha(changedLines.sort().join('\n'));
  await assert.rejects(assertApprovedMethodPins(changed, scratch), /approved source byte drift: whitebox-verify\/\.gitignore/);
  await fs.writeFile(dotfile, original);
  await fs.rm(dotfile);
  await assert.rejects(assertApprovedMethodPins(record, scratch), /approved file set drift: whitebox-verify/);
  await fs.writeFile(dotfile, original);
  const extra = path.join(copied, 'unapproved-extra.txt');
  await fs.writeFile(extra, 'private unapproved source\n');
  await assert.rejects(assertApprovedMethodPins(record, scratch), /approved file set drift: whitebox-verify/);
  await fs.rm(extra);
  await assertApprovedMethodPins(record, scratch);
});

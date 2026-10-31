// Component tests for the real-host protected source ports (six-step ①,
// "establish the real source — no fixture plays the provider").
//
// Scope discipline: these tests exercise the ports MODULE and the bindings
// hosted wiring with synthetic host-record shapes. They prove the provider
// exists, is wired when the official createBindings(context) form runs, and
// fails closed on uncorroborated input. They are NOT a real-Run acceptance:
// that is six-step ② against actual host records.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import crypto from 'node:crypto';
import { createBindings } from '../integrations/comet/application/bindings.mjs';
import { envelopeDigest } from '../lib/delivery/evidence.js';

const sha = (data) => crypto.createHash('sha256').update(data).digest('hex');
const UUID = '0f0e0d0c-0b0a-0908-0706-050403020100';
const UUID2 = 'f0f1f2f3-f4f5-f6f7-f8f9-fafbfcfdfeff';
const context = { manifest: { bindings: [] }, skills: new Map(), projectRoot: '/tmp/synthetic', identity: { contentHash: sha('application-content'), runtimeVersion: '0.5.1' }, createSkillExecutor: (x) => x };

// A run/action pair whose claim and frozen input recompute: the minimum the
// real provider must accept before any deeper corroboration.
function hostedRequest({ tamperInputHash = false, dropClaim = false, frozenGate } = {}) {
  const input = { gate: 'A', note: 'frozen claim input' };
  const action = {
    id: 'run:report', stepId: 'classic.extension.A', status: 'running', attempt: 1,
    input, inputHash: envelopeDigest(input),
    claim: { executorId: 'exec-author-1', sessionId: UUID, token: 'claim-token-bytes' },
  };
  if (tamperInputHash) action.inputHash = sha('tampered');
  if (dropClaim) delete action.claim;
  if (frozenGate !== undefined) action.input = { ...action.input, gate: frozenGate }, action.inputHash = envelopeDigest(action.input);
  const run = { runId: 'synthetic-run', revision: 3, status: 'running', actions: [action] };
  const inputs = { inputDigest: sha('candidate'), builderExecution: 'builder-1' };
  const policy = { ref: 'policy', digest: sha('policy') };
  const evidence = { gate: 'A', inputs, receipts: [], policy };
  return { run, action, gate: 'A', inputs, policy, evidence };
}

test('real ports corroborate a well-formed host claim and refuse tampered or claim-less inputs', async () => {
  const { createProtectedHostPorts } = await import('../lib/adapters/comet-host-ports.js');
  const ports = createProtectedHostPorts({ context });
  assert.equal(ports.scope, 'comet-host-protected-ports');
  const good = hostedRequest();
  assert.equal(ports.verifyGateInputs(good), true, 'well-formed claim must corroborate');
  assert.equal(ports.verifyGateInputs(hostedRequest({ tamperInputHash: true })), false, 'inputHash must recompute');
  assert.equal(ports.verifyGateInputs(hostedRequest({ dropClaim: true })), false, 'a claim is required');
  assert.equal(ports.verifyGateInputs(hostedRequest({ frozenGate: 'T' })), false, 'frozen gate mismatch must refuse');
  assert.equal(ports.verifyGateInputs({ run: {}, action: good.action, gate: 'A', ...good.evidence }), false, 'runId required');
});

test('hosted createBindings(context) without explicit ports now routes through the real provider', async () => {
  // RED→GREEN: before the wiring this refused statically with "protected Run,
  // input, policy and source readback are required" (no provider at all).
  // With the real provider the verification runs and advances past input
  // corroboration to the raw-source refusal.
  const b = await createBindings(context);
  const validator = b.validators.find((v) => v.id === 'sdd.delivery.gate.a');
  const { run, action, evidence } = hostedRequest();
  const result = await validator.validate({
    run,
    action,
    outcome: { actionId: action.id, status: 'succeeded', output: { verdict: 'pass', sourceHash: 'domain-checked', artifactHashes: {}, gateEvidence: { ...evidence, receipts: [{ digest: sha('e'), envelope: { candidateDigest: sha('c') }, dispatch: { run: 'synthetic-run', gate: 'A' }, collectionId: 'col-1' }] } } },
  });
  assert.equal(result.accepted, false);
  assert.doesNotMatch(result.reason, /protected Run, input, policy and source readback are required/,
    'the real provider must run, not the static no-provider refusal');
  assert.match(result.reason, /refused to judge|source packet/i,
    `refusal must come from real source corroboration, got: ${result.reason}`);
});

test('readSourcePacket refuses without a prepared host locator and corroborates through injected readers', async () => {
  const { createProtectedHostPorts } = await import('../lib/adapters/comet-host-ports.js');
  const ports = createProtectedHostPorts({ context });
  const good = hostedRequest();
  ports.verifyGateInputs(good);
  const packet = { dispatch: { run: 'r1' }, envelope: { candidateDigest: sha('c') }, collection: { collectionId: 'col-1' } };
  assert.throws(() => ports.readSourcePacket({ run: { runId: 'r1' }, action: { id: 'a' }, gate: 'A', entry: { sourcePacket: packet } }),
    /codex host locator/i, 'no locator — no raw source corroboration');

  const locatorPorts = createProtectedHostPorts({
    context,
    readers: {
      command: (expected) => {
        assert.equal(expected.threadId, UUID);
        return { ok: true, threadId: UUID, commandDigest: expected.commandDigest, outputDigest: sha('raw-bytes') };
      },
    },
  });
  locatorPorts.verifyGateInputs(hostedRequest());
  const located = {
    dispatch: { run: 'r1' }, envelope: { candidateDigest: sha('c') },    collection: {
      collectionId: 'col-1',
      host: { codex: { threadId: UUID, sessionPath: `/Users/x/.codex/sessions/2026/10/30/rollout-2026-10-30T00-00-00-${UUID}.jsonl`, offset: 0, length: 10, turnId: UUID2, itemId: `exec-${UUID2}`, commandDigest: sha(JSON.stringify({ argv: ['node', '--test'], cwd: '/tmp' })) } },
      source: { facts: { outputDigest: sha('raw-bytes') } },
    },
  };
  const returned = locatorPorts.readSourcePacket({ run: { runId: 'r1' }, action: { id: 'a' }, gate: 'A', entry: { sourcePacket: located } });
  assert.deepEqual(returned.dispatch, located.dispatch);
  const tampered = structuredClone(located);
  tampered.collection.source.facts.outputDigest = sha('other-bytes');
  assert.throws(() => locatorPorts.readSourcePacket({ run: { runId: 'r1' }, action: { id: 'a' }, gate: 'A', entry: { sourcePacket: tampered } }),
    /output digest/i, 'recorded output digest must match the raw record');
});

test('admissionOptionsFor derives protected identities from the latched run record only', async () => {
  const { createProtectedHostPorts } = await import('../lib/adapters/comet-host-ports.js');
  const ports = createProtectedHostPorts({ context });
  assert.throws(() => ports.admissionOptionsFor({}), /verifyGateInputs/i, 'no latch — no protected context');
  const good = hostedRequest();
  assert.equal(ports.verifyGateInputs(good), true);
  const review = { execution: 'reviewer-exec', principal: UUID2 };
  const options = ports.admissionOptionsFor({ collectionId: 'col-1' });
  assert.equal(options.builderExecution, 'exec-author-1');
  assert.equal(options.builderPrincipal, UUID);
  assert.ok(![options.builderExecution, ...options.authoringExecutions].includes(review.execution));
  assert.equal(typeof options.now, 'string');
});

test('verifyReview refuses without a prepared binding and corroborates a bound independent turn', async () => {
  const { createProtectedHostPorts } = await import('../lib/adapters/comet-host-ports.js');
  const entry = {
    digest: sha('envelope'),
    sourcePacket: {
      collection: {
        collectionId: 'col-1',
        source: {
          reportDigest: sha('report'), actionDigest: sha('action'),
          independentReview: { codex: null },
        },
      },
    },
  };
  const bare = createProtectedHostPorts({ context });
  bare.verifyGateInputs(hostedRequest());
  const refused = bare.verifyReview({ entry });
  assert.equal(refused.ok, false);
  assert.match(refused.reason, /no prepared independent-review binding/i);

  const binding = {
    rootThreadId: UUID, parentTurnId: UUID2, childThreadId: UUID2, childTurnId: UUID2,
    spawnId: 'call_abc12345', reportDigest: sha('report'), actionDigest: sha('action'),
    envelopeDigest: sha('envelope'), kind: 'grill-exact-unanimous-consensus',
    evidenceDigest: sha('review-evidence'),
  };
  const corroborating = createProtectedHostPorts({
    context,
    readers: {
      independentTurn: (expected) => {
        assert.equal(expected.childThreadId, UUID2);
        return { ok: true, childThreadId: UUID2 };
      },
    },
  });
  corroborating.verifyGateInputs(hostedRequest());
  const bound = structuredClone(entry);
  bound.sourcePacket.collection.source.independentReview.codex = binding;
  const review = corroborating.verifyReview({ entry: bound });
  assert.equal(review.ok, true);
  assert.equal(review.sufficient, true);
  assert.equal(review.execution, UUID2, 'the review identity is the host-recorded child thread');
  assert.equal(review.envelopeDigest, entry.digest);
  assert.equal(review.kind, 'grill-exact-unanimous-consensus');
  // A review kind that does not match the latched gate is refused.
  corroborating.verifyGateInputs(hostedRequest());
  const wrongKind = structuredClone(bound);
  wrongKind.sourcePacket.collection.source.independentReview.codex = { ...binding, kind: 'plan-unique-review' };
  assert.equal(corroborating.verifyReview({ entry: wrongKind }).ok, false);
});

test('V promotion derives every field from source recomputation and real-record corroboration', async () => {
  const { createProtectedHostPorts } = await import('../lib/adapters/comet-host-ports.js');
  const { compileDomainCases } = await import('../lib/delivery/domain-cases.js');
  const fs = await import('node:fs');
  const os = await import('node:os');
  const nodePath = await import('node:path');
  const root = fs.realpathSync(fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'v-promotion-')));
  const change = 'synthetic-v', changeDir = `openspec/changes/${change}`;
  fs.mkdirSync(nodePath.join(root, changeDir, 'tests'), { recursive: true });
  fs.writeFileSync(nodePath.join(root, 'requirements.md'), '# Requirement\nA permitted user can read the item.\n');
  fs.writeFileSync(nodePath.join(root, 'design.md'), '# Design\nRead is performed through the public API.\n');
  fs.writeFileSync(nodePath.join(root, 'read.test.js'), 'test fixture');
  fs.writeFileSync(nodePath.join(root, changeDir, 'tests', 'domain-cases.md'),
    '<!-- domain-cases/v1 -->\n# Domain cases\n\n### TC-READ-1 — Read item\n\n- **Requirement IDs**: REQ-1\n- **Acceptance**: AC-1\n- **Dimensions**: Journey-A\n- **Level**: api\n- **Priority**: P1\n- **Precondition**: User is permitted\n- **Input**: Item exists\n- **Step**: Request the item\n- **Expected**: The item is returned\n- **Oracle basis**: REQ-1\n- **Oracle authority**: Public API response\n- **Cleanup**: Remove fixture data\n- **Evidence**: Request and response\n- **Check ID**: read-item\n- **Automation path**: read.test.js\n- **Automation test ID**: read-item-test\n- **Automation command**: ["node","--test","read.test.js"]\n');
  const measuredDigest = sha('measured-output');
  const authorThread = UUID, reviewerThread = UUID2, builderThread = 'f0e0d0c0-b0a0-0908-0706-050403020100';
  const locator = JSON.stringify({ sessionPath: `/Users/x/.codex/sessions/2026/10/30/rollout-${authorThread}.jsonl`, threadId: authorThread,
    offset: 0, length: 10, turnId: UUID2, itemId: `exec-${UUID2}`,
    before: { offset: 0, length: 5, turnId: UUID2, itemId: `exec-${UUID2}`, commandDigest: sha('before') },
    after: { offset: 20, length: 5, turnId: UUID2, itemId: `exec-${UUID2}`, commandDigest: sha('after') },
    claimBefore: { ok: true }, claimAfter: { ok: true } });
  const dimensions = Object.fromEntries('ABCDEFGHIJ'.split('').map(c => [`Journey-${c}`, {
    required: c === 'A', reason: c === 'A' ? 'Required' : 'Not applicable', basis_ids: ['REQ-1'] }]));
  const config = { project: 'fixture', change, mode: 'automate', design_basis_id: 'DESIGN-1',
    basis: [{ id: 'REQ-1', kind: 'requirement', path: 'requirements.md' }, { id: 'DESIGN-1', kind: 'source', path: 'design.md' }],
    dimensions, checks: [{ id: 'read-item', level: 'api', capability: 'api:read', command: 'node --test read.test.js' }],
    cleanup: { environment: 'Dispose', data: 'none' },
    self_checks: [{ caseId: 'TC-READ-1', testId: 'read-item-test', execution: authorThread, principal: authorThread,
      outcome: 'pass', executions: { total: 1, valid: 1 }, evidenceRefs: [{ ref: locator, digest: measuredDigest }] }] };
  fs.writeFileSync(nodePath.join(root, changeDir, 'tests', 'domain-cases.config.json'), JSON.stringify(config));
  const projection = compileDomainCases({ projectRoot: root, caseFile: `${changeDir}/tests/domain-cases.md`, config });
  const contract = projection.testContract;
  const binding = { rootThreadId: builderThread, parentTurnId: UUID2, childThreadId: reviewerThread, childTurnId: UUID2,
    spawnId: 'call_abc12345', reportDigest: sha('report'), childMeta: { offset: 0, length: 5 }, start: { offset: 1, length: 5 },
    finish: { offset: 2, length: 5 }, spawn: { offset: 3, length: 5 }, completion: { offset: 4, length: 5 },
    parentSessionPath: '/p.jsonl', childSessionPath: '/c.jsonl', evidenceDigest: sha('review-evidence') };
  const tAction = { id: 'run:t', stepId: 'classic.extension.test-design-review', status: 'succeeded', attempt: 1,
    input: { note: 't' }, inputHash: envelopeDigest({ note: 't' }), claim: { executorId: 't-exec', sessionId: builderThread, token: 'tok' },
    outcome: { status: 'succeeded', output: { verdict: 'pass', gateEvidence: { gate: 'T', inputs: { testContract: contract },
      receipts: [{ sourcePacket: { collection: { source: { independentReview: { codex: binding } } } } }] } } } };
  const vInput = { note: 'v' };
  const vAction = { id: 'run:v', stepId: 'classic.extension.verify-whitebox', status: 'running', attempt: 1,
    input: vInput, inputHash: envelopeDigest(vInput), claim: { executorId: 'v-exec', sessionId: builderThread, token: 'tok2' } };
  const run = { runId: change, revision: 4, status: 'running', input: { change, changeDir }, actions: [tAction, vAction] };
  const makePorts = (overrides = {}) => createProtectedHostPorts({
    context: { projectRoot: root, identity: { contentHash: sha('app'), runtimeVersion: '0.5.1' } },
    readers: {
      claimedTest: () => ({ ok: true, threadId: authorThread, outcome: 'pass', summary: { tests: 1, pass: 1, fail: 0, skipped: 0, cancelled: 0 }, outputDigest: measuredDigest }),
      independentTurn: () => ({ ok: true, childThreadId: reviewerThread }),
      ...overrides,
    },
  });
  const inputs = { inputDigest: sha('candidate'), testContract: contract };
  const policy = { ref: 'policy', digest: sha('policy') };
  const ports = makePorts();
  assert.equal(ports.verifyGateInputs({ run, action: vAction, gate: 'V', inputs, policy }), true);
  const promotion = ports.verifyDomainAutomation({ runId: change, inputs, policy });
  assert.equal(promotion.ok, true, JSON.stringify(promotion));
  assert.equal(promotion.kind, 'verified-domain-automation');
  assert.deepEqual(promotion.caseIds, ['TC-READ-1']);
  assert.equal(promotion.authorExecution, authorThread);
  assert.equal(promotion.designReviewerExecution, reviewerThread);
  assert.equal(promotion.designReviewerExecution !== promotion.authorExecution, true);
  assert.equal(promotion.qualification.scope, 'protected-source');
  assert.equal(promotion.qualification.status, 'qualified');
  assert.equal(promotion.sourceQualified, true);
  assert.equal(promotion.managedClosureEligible, false);
  for (const digest of [promotion.selfCheckDigest, promotion.automationMapDigest, promotion.designReviewDigest, promotion.contractDigest, promotion.testPackDigest]) {
    assert.match(digest, /^[0-9a-f]{64}$/);
  }
  // admission serves the same promotion plus the author identity.
  const options = ports.admissionOptionsFor({});
  assert.deepEqual(options.domainAutomation, promotion);
  assert.ok(options.authoringExecutions.includes(authorThread));
  // Negatives: every shortcut is refused.
  const expectRefused = (probe, pattern) => {
    const p = makePorts();
    p.verifyGateInputs({ run, action: vAction, gate: 'V', inputs, policy });
    const result = p.verifyDomainAutomation(probe);
    assert.equal(result.ok, false, JSON.stringify(result));
    if (pattern) assert.match(result.reason, pattern);
  };
  expectRefused({ runId: 'other', inputs, policy }, /bind the current Run/);
  expectRefused({ runId: change, inputs: { ...inputs, inputDigest: 'nope' }, policy }, /malformed/);
  expectRefused({ runId: change, inputs: { ...inputs, testContract: { ...contract, project: 'tampered' } }, policy }, /differs from the change source/);
  expectRefused({ runId: change, inputs, policy: { ref: 'p', digest: 'nope' } }, /malformed/);
  const brokenReader = makePorts({ claimedTest: () => ({ ok: false }) });
  brokenReader.verifyGateInputs({ run, action: vAction, gate: 'V', inputs, policy });
  assert.equal(brokenReader.verifyDomainAutomation({ runId: change, inputs, policy }).ok, false, 'uncorroborated record refuses');
  // A binding that claims the author as its own reviewer is refused — the
  // turn-binding match catches a swapped thread, and a binding that genuinely
  // names the author hits the independence guard.
  const swappedThread = makePorts({ independentTurn: () => ({ ok: true, childThreadId: authorThread }) });
  swappedThread.verifyGateInputs({ run, action: vAction, gate: 'V', inputs, policy });
  assert.match(swappedThread.verifyDomainAutomation({ runId: change, inputs, policy }).reason, /no corroborated independent reviewer turn/);
  const selfBinding = { ...binding, childThreadId: authorThread };
  const selfReview = makePorts({ independentTurn: () => ({ ok: true, childThreadId: authorThread }) });
  const selfRun = { ...run, actions: [{ ...tAction, outcome: { status: 'succeeded', output: { verdict: 'pass', gateEvidence: { gate: 'T', inputs: { testContract: contract }, receipts: [{ sourcePacket: { collection: { source: { independentReview: { codex: selfBinding } } } } }] } } } }, vAction] };
  selfReview.verifyGateInputs({ run: selfRun, action: vAction, gate: 'V', inputs, policy });
  assert.match(selfReview.verifyDomainAutomation({ runId: change, inputs, policy }).reason, /must differ from the author/);
  const noT = makePorts();
  noT.verifyGateInputs({ run: { ...run, actions: [vAction] }, action: vAction, gate: 'V', inputs, policy });
  assert.match(noT.verifyDomainAutomation({ runId: change, inputs, policy }).reason, /no successful T review action/);
  const staleT = makePorts();
  const staleContract = { ...contract, project: 'other' };
  staleT.verifyGateInputs({ run: { ...run, actions: [{ ...tAction, outcome: { status: 'succeeded', output: { verdict: 'pass', gateEvidence: { gate: 'T', inputs: { testContract: staleContract }, receipts: tAction.outcome.output.gateEvidence.receipts } } } }, vAction] }, action: vAction, gate: 'V', inputs, policy });
  assert.match(staleT.verifyDomainAutomation({ runId: change, inputs, policy }).reason, /does not bind the current contract/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('admission context ignores session-less executor claims and merges the managed record authors', async () => {
  const { createProtectedHostPorts } = await import('../lib/adapters/comet-host-ports.js');
  const fs = await import('node:fs');
  const os = await import('node:os');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'host-ports-authors-'));
  try {
    const ctx = { ...context, projectRoot: root };
    const input = { gate: 'R', note: 'frozen claim input' };
    const action = { id: 'run:r7', stepId: 'classic.extension.requirements-open', status: 'running', attempt: 1,
      input, inputHash: envelopeDigest(input),
      claim: { executorId: 'sdd-managed-skill-host', sessionId: UUID, token: 'claim-token-bytes' } };
    const openAction = { id: 'run:r3', stepId: 'full.open', status: 'succeeded', attempt: 1,
      input: { note: 'open' }, inputHash: envelopeDigest({ note: 'open' }),
      claim: { executorId: 'sdd-managed-skill-host', sessionId: UUID, token: 'open-token' } };
    const plumbing = { id: 'run:r1', stepId: 'classic.composition.prepare', status: 'succeeded', attempt: 1,
      input: { note: 'prepare' }, inputHash: envelopeDigest({ note: 'prepare' }),
      claim: { executorId: 'comet-classic-composition-prepare' } };
    const run = { runId: 'synthetic-run', revision: 7, status: 'running', input: { changeDir: 'changes/x' }, actions: [plumbing, openAction, action] };
    const request = { run, action, gate: 'R', inputs: { inputDigest: sha('candidate') }, policy: { ref: 'policy', digest: sha('policy') } };
    const ports = createProtectedHostPorts({ context: ctx });
    assert.equal(ports.verifyGateInputs(request), true, 'fixture must corroborate');
    // Without a record only claim-derived authors count: the same-executor
    // open claim is the current identity's sibling and the session-less
    // plumbing claim is not an authoring identity at all.
    const bare = ports.admissionOptionsFor();
    assert.deepEqual(bare.authoringExecutions, [], 'session-less executor claims must not become authors');
    assert.deepEqual(bare.authoringPrincipals, [], 'no null principals may leak into the author set');
    // The managed record's authoring attestation (same protected record that
    // mints the run authority) merges validated identities in.
    fs.mkdirSync(path.join(root, 'changes/x/.comet'), { recursive: true });
    fs.writeFileSync(path.join(root, 'changes/x/.comet', 'delivery-authority.json'), JSON.stringify({
      runId: 'synthetic-run', secret: 's'.repeat(40),
      authoringExecutions: ['agent-author-worker'], authoringPrincipals: ['agent-author-worker'],
    }));
    const merged = ports.admissionOptionsFor();
    assert.deepEqual(merged.authoringExecutions, ['agent-author-worker']);
    assert.deepEqual(merged.authoringPrincipals, ['agent-author-worker']);
    assert.equal(merged.builderExecution, 'sdd-managed-skill-host');
    assert.equal(merged.purpose, 'independent-acceptance');
    // A malformed record list must be dropped, not partially trusted.
    fs.writeFileSync(path.join(root, 'changes/x/.comet', 'delivery-authority.json'), JSON.stringify({
      runId: 'synthetic-run', secret: 's'.repeat(40),
      authoringExecutions: ['agent-author-worker', ''], authoringPrincipals: [42],
    }));
    const refused = ports.admissionOptionsFor();
    assert.deepEqual(refused.authoringExecutions, [], 'malformed record authors must be dropped');
    assert.deepEqual(refused.authoringPrincipals, []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('per-gate authority record entries select by the submitted collection actionDigest', async () => {
  const { createProtectedHostPorts } = await import('../lib/adapters/comet-host-ports.js');
  const fs = await import('node:fs');
  const os = await import('node:os');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'host-ports-entries-'));
  try {
    const ctx = { ...context, projectRoot: root };
    const input = { gate: 'R', note: 'frozen claim input' };
    const action = { id: 'run:r7', stepId: 'classic.extension.requirements-open', status: 'running', attempt: 1,
      input, inputHash: envelopeDigest(input),
      claim: { executorId: 'sdd-managed-skill-host', sessionId: UUID, token: 'claim-token-bytes' } };
    const run = { runId: 'synthetic-run', revision: 7, status: 'running', input: { changeDir: 'changes/x' }, actions: [action] };
    const request = { run, action, gate: 'R', inputs: { inputDigest: sha('candidate') }, policy: { ref: 'policy', digest: sha('policy') } };
    fs.mkdirSync(path.join(root, 'changes/x/.comet'), { recursive: true });
    fs.writeFileSync(path.join(root, 'changes/x/.comet', 'delivery-authority.json'), JSON.stringify({
      schema: 'sdd.delivery.authority.v2', runId: 'synthetic-run', environment: 'comet-classic-managed',
      entries: [
        { gate: 'R', secret: 'r'.repeat(40), actionBinding: { schemaVersion: 1, gate: 'R' }, sourceQualification: { scope: 'protected-source' },
          authoringExecutions: ['author-1'], authoringPrincipals: ['author-1'], actionDigest: 'a'.repeat(64) },
        { gate: 'A', secret: 'a'.repeat(40), actionBinding: { schemaVersion: 1, gate: 'A' }, sourceQualification: { scope: 'protected-source' },
          authoringExecutions: ['author-1'], authoringPrincipals: ['author-1'], actionDigest: 'b'.repeat(64) },
      ],
    }));
    const ports = createProtectedHostPorts({ context: ctx });
    assert.equal(ports.verifyGateInputs(request), true);
    // Submitted receipt whose collection carries the R entry's actionDigest
    const rReceipt = { sourcePacket: { collection: { actionDigest: 'a'.repeat(64) } } };
    const rContext = ports.admissionOptionsFor(rReceipt);
    assert.equal(typeof rContext.authority, 'object');
    assert.deepEqual(rContext.authoringExecutions, ['author-1']);
    assert.equal(rContext.environment, 'comet-classic-managed');
    // A receipt with an unknown actionDigest must fail closed (no record)
    const xReceipt = { sourcePacket: { collection: { actionDigest: 'c'.repeat(64) } } };
    const refused = ports.admissionOptionsFor(xReceipt);
    assert.equal(refused.authority, undefined);
    assert.deepEqual(refused.authoringExecutions, []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

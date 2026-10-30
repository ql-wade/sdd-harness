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

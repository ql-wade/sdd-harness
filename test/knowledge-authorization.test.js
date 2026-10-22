import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// P4_7 rework: the adapter composition surface over the real KnowledgeAuthz.v1
// CLI (lib/adapters/knowledge-authorization.js — the tasks.md Owns entry the
// first round placed only as tools/infra/knowledge-authz.mjs). The adapter adds
// zero authorization logic: it maps the CLI's exit contract (0=PASS, 1=invalid
// input/prerequisite, 2=verification failure) and its JSON receipts onto a
// programmatic facade so the Comet checker side can consume the
// preauthorization decision surface without reimplementing it. Every test
// drives the real CLI through the adapter over the committed artifacts plus
// tmp fixture worlds; no mock substitutes an entrance.
//
// Rework-specific arms (rework Step 9): a LIVE target-audience readback claim
// is honored only when every required readback channel (membership,
// inheritance, pageShare, publicShare, attachment) is READ; a missing channel
// is fail-closed (TARGET_CHANNEL_NOT_READ). Registered pilot-directory
// principals (directory:<tenant>/<name>, bound to real immutable Outline user
// ids in the authorization model) count as mapped principals; anything outside
// a registered mapping stays PRINCIPAL_UNMAPPED. Receipts carry the audience
// provenance (LIVE_READBACK vs DECLARED_ONLY) so a component decision can
// never pass as a live effective-audience closure.
const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '..');
const knowledgeDir = path.join(repoRoot, 'infra', 'delivery', 'knowledge');

const DIR_OWNER = 'directory:sdd-harness-pilot/owner';
const FIXTURE_GROUP = 'group:sdd-harness-pilot/engineering';
const REVIEWER = 'svc:sdd-harness-pilot/worker-reviewer';
const AUTHOR = 'svc:sdd-harness-pilot/worker-author';
const PUBLISHER = 'svc:sdd-harness-pilot/outline-publisher';
const OWNER_PRINCIPAL = 'human:ql-wade#262266039';
const ENDPOINT = 'http://127.0.0.1:3000';
const ALL_CHANNELS = { membership: 'READ', inheritance: 'READ', pageShare: 'READ', publicShare: 'READ', attachment: 'READ' };

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

let tmpCounter = 0;
let scratch = '';
function writeTmp(name, value) {
  const file = path.join(scratch, `${++tmpCounter}-${name}`);
  fs.writeFileSync(file, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
  return file;
}

function readCommitted(name) {
  return JSON.parse(fs.readFileSync(path.join(knowledgeDir, name), 'utf8'));
}

// Committed artifacts; the only local deviation is an explicitly marked
// fixture audience so the decision arithmetic is exercisable both ways.
function fixtureWorld() {
  const model = readCommitted('authorization-model.json');
  const policy = readCommitted('preauthorization-policy.json');
  const ledger = readCommitted('grant-ledger.example.json');
  const fixedPolicy = structuredClone(policy);
  fixedPolicy.target.allowedAudience = {
    readers: [FIXTURE_GROUP],
    status: 'LOCAL_FIXTURE',
    reason: 'operator-declared audience for the local structural decision proof only',
  };
  for (const grant of ledger.grants) {
    if (grant.revocation === null) grant.purpose.disclosureAudience = [FIXTURE_GROUP];
  }
  return {
    model: writeTmp('model.json', model),
    policy: writeTmp('policy.json', fixedPolicy),
    ledger: writeTmp('ledger.json', ledger),
  };
}

// Fixture world whose registered audience is a pilot-directory principal — the
// shape the live pilot registration produces (policy ∩ grant disclosure).
function liveFixtureWorld() {
  const world = fixtureWorld();
  const policy = JSON.parse(fs.readFileSync(world.policy, 'utf8'));
  policy.target.allowedAudience = {
    readers: [DIR_OWNER],
    status: 'LIVE_FIXTURE',
    reason: 'registered pilot audience for the live-readback decision proof only',
  };
  fs.writeFileSync(world.policy, `${JSON.stringify(policy, null, 2)}\n`);
  const ledger = JSON.parse(fs.readFileSync(world.ledger, 'utf8'));
  for (const grant of ledger.grants) {
    if (grant.revocation === null) grant.purpose.disclosureAudience = [DIR_OWNER];
  }
  fs.writeFileSync(world.ledger, `${JSON.stringify(ledger, null, 2)}\n`);
  return world;
}

function baseRequest() {
  const payloadDigest = sha256('p47 adapter candidate payload v1');
  return {
    schemaVersion: 1,
    requestedBy: PUBLISHER,
    execution: 'exec-p47-adapter-1',
    operation: {
      knowledgeId: 'k-p47-adapter',
      knowledgeType: 'project-knowledge',
      documentId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
      action: 'documents.create',
      target: {
        collection: 'outline-managed-collection',
        audienceSource: 'collection-default',
        effectiveAudience: { readers: [FIXTURE_GROUP], incompletePagination: false, unmappedPrincipals: [] },
      },
    },
    payloadDigest,
    sources: [
      { domain: 'sdd-harness-repo', permissionEvidence: { status: 'COMPLETE', exportedByServiceAccountOnly: false, unmappedPrincipals: [] } },
    ],
    review: {
      execution: 'review-exec-p47-adapter',
      reviewerPrincipal: REVIEWER,
      verdict: 'pass',
      boundPayloadDigest: payloadDigest,
      reviewedAt: new Date().toISOString(),
    },
  };
}

function liveRequest(overrides = {}) {
  const request = baseRequest();
  request.execution = 'exec-p47-adapter-live-1';
  request.operation.knowledgeId = 'k-p47-adapter-live';
  request.operation.target.effectiveAudience = {
    readers: [DIR_OWNER],
    incompletePagination: false,
    unmappedPrincipals: [],
    readback: { status: 'LIVE', endpoint: ENDPOINT, observedAt: new Date().toISOString() },
  };
  request.operation.target.channels = { ...ALL_CHANNELS };
  return { ...request, ...overrides };
}

test.beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'p47-adapter-'));
  tmpCounter = 0;
});

import {
  PREAUTH_EXIT,
  runKnowledgeAuthz,
  validateArtifacts,
  verifyGrant,
  decidePublication,
  recheckDecision,
  resolvePrincipal,
  isAutoPublishAllowed,
  denialCodes,
} from '../lib/adapters/knowledge-authorization.js';

test('adapter: committed authorization artifacts validate clean through the facade', () => {
  const result = validateArtifacts();
  assert.equal(result.status, PREAUTH_EXIT.PASS, JSON.stringify(result.json?.violations ?? result.stderr));
  assert.equal(result.json.ok, true);
  assert.deepEqual(result.json.violations, []);
  assert.equal(result.json.interface, 'KnowledgeAuthz.v1');
});

test('adapter: verifyGrant surfaces the committed ledger through the exit contract', () => {
  const valid = verifyGrant('grant-pilot-001');
  assert.equal(valid.status, PREAUTH_EXIT.PASS);
  assert.equal(valid.json.ok, true);
  assert.equal(valid.json.grant, 'grant-pilot-001');
  const revoked = verifyGrant('grant-pilot-003');
  assert.equal(revoked.status, PREAUTH_EXIT.DENIED);
  assert.equal(revoked.json.ok, false);
  assert.equal(revoked.json.code, 'GRANT_REVOKED');
});

test('adapter: decide maps allow onto PASS with a bound receipt', () => {
  const world = fixtureWorld();
  const result = decidePublication(baseRequest(), world);
  assert.equal(result.status, PREAUTH_EXIT.PASS, result.stdout);
  assert.equal(isAutoPublishAllowed(result), true);
  assert.equal(result.json.interface, 'KnowledgePublishDecision.v1');
  assert.equal(result.json.readback.required, true);
  assert.doesNotMatch(result.stdout, /\/(Users|home|root|private|var|usr|etc|opt|tmp)\//, 'receipts must not carry host absolute paths');
});

test('adapter: self-authored grant input maps onto DENIED with the refusal codes', () => {
  const world = fixtureWorld();
  const result = decidePublication(liveRequest({ grant: { id: 'forged' }, approved: true }), world);
  assert.equal(result.status, PREAUTH_EXIT.DENIED);
  assert.equal(result.json.verdict, 'deny');
  const codes = denialCodes(result);
  assert.ok(codes.includes('SELF_AUTHORED_GRANT'));
  assert.ok(codes.includes('SELF_AUTHORED_APPROVAL'));
});

test('adapter: recheck after a real revocation goes stale — no renewal of the same operation', () => {
  const world = liveFixtureWorld();
  const decided = decidePublication(liveRequest(), world);
  assert.equal(decided.status, PREAUTH_EXIT.PASS, decided.stdout);
  const revoke = runKnowledgeAuthz(['revoke', '--grant', 'grant-pilot-001', '--ledger', world.ledger, '--model', world.model, '--as', OWNER_PRINCIPAL, '--reason', 'adapter recheck probe', '--json']);
  assert.equal(revoke.status, PREAUTH_EXIT.PASS);
  const stale = recheckDecision(decided.json, world);
  assert.equal(stale.status, PREAUTH_EXIT.DENIED);
  assert.equal(stale.json.ok, false);
  assert.match(denialCodes(stale).join(','), /GRANT_NO_LONGER_VALID|LEDGER_CHANGED/);
});

test('adapter: the author cannot resolve the publisher credential through the facade', () => {
  const result = resolvePrincipal('secret-ref:sdd-harness-pilot/outline-publisher', { as: AUTHOR, role: 'author' });
  assert.equal(result.status, PREAUTH_EXIT.DENIED);
  assert.equal(result.json.code, 'PRINCIPAL_NOT_AUTHORIZED');
});

test('adapter: invalid input maps onto INPUT (never a silent pass)', () => {
  const result = validateArtifacts({ model: path.join(scratch, 'missing-model.json') });
  assert.equal(result.status, PREAUTH_EXIT.INPUT);
  assert.equal(result.json, null);
});

test('adapter: a LIVE audience claim missing any required channel is fail-closed (TARGET_CHANNEL_NOT_READ)', () => {
  const world = liveFixtureWorld();
  const none = liveRequest();
  delete none.operation.target.channels;
  const noneResult = decidePublication(none, world);
  assert.equal(noneResult.status, PREAUTH_EXIT.DENIED);
  const namedNone = noneResult.json.reasons
    .filter((reason) => reason.code === 'TARGET_CHANNEL_NOT_READ')
    .map((reason) => reason.channel);
  assert.deepEqual(namedNone.sort(), ['attachment', 'inheritance', 'membership', 'pageShare', 'publicShare']);
  // Only the attachment channel missing — exactly the observed pilot state.
  const partial = liveRequest();
  delete partial.operation.target.channels.attachment;
  const partialResult = decidePublication(partial, world);
  assert.equal(partialResult.status, PREAUTH_EXIT.DENIED);
  const named = partialResult.json.reasons
    .filter((reason) => reason.code === 'TARGET_CHANNEL_NOT_READ')
    .map((reason) => reason.channel);
  assert.deepEqual(named, ['attachment']);
});

test('adapter: a LIVE claim with every required channel READ allows with LIVE_READBACK provenance', () => {
  const world = liveFixtureWorld();
  const result = decidePublication(liveRequest(), world);
  assert.equal(result.status, PREAUTH_EXIT.PASS, result.stdout);
  assert.match(String(result.json.provenance.targetAudience), /LIVE_READBACK/);
  assert.match(String(result.json.provenance.targetAudience), /membership\/inheritance\/pageShare\/publicShare\/attachment/);
  // The pre-write recheck accepts the receipt it produced.
  const fresh = recheckDecision(result.json, world);
  assert.equal(fresh.status, PREAUTH_EXIT.PASS, fresh.stdout);
});

test('adapter: declared-only audience keeps the component-result provenance', () => {
  const world = liveFixtureWorld();
  const request = liveRequest();
  delete request.operation.target.effectiveAudience.readback;
  delete request.operation.target.channels;
  const result = decidePublication(request, world);
  assert.equal(result.status, PREAUTH_EXIT.PASS, result.stdout);
  assert.match(String(result.json.provenance.targetAudience), /DECLARED_ONLY/);
  assert.doesNotMatch(String(result.json.provenance.targetAudience), /LIVE_READBACK/);
});

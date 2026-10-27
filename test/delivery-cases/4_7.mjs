// P4_7 delivery case: knowledge publication pre-authorization (acceptance
// U01–U08, spec "Knowledge publication authorization"). Every scenario drives
// the real KnowledgeAuthz.v1 CLI (tools/infra/knowledge-authz.mjs) over the
// committed artifacts (infra/delivery/knowledge/*) plus local tmp fixture
// worlds; the I01 resolution gate (tools/infra/secret-refs.mjs, unmodified) is
// exercised through the CLI's resolve entrance. All processes run with an
// isolated HOME, PATH stubs and scratch TMPDIR; no live configuration is
// touched and no mock substitutes a real entrance.
//
// Rework r1 scope (rework-seven-p1-r1): the pilot Outline stack IS deployed
// (loopback 127.0.0.1:3000 + dex OIDC, subjects owner|member|offboarded@
// sdd-harness-pilot.test) and the target side was smoke-tested live through
// the terminal channel — target/collection registration, principal mapping,
// collection membership, the page/public share registry and the
// member/offboarded denial entrances are observed facts (evidence:
// worker-reports/P4_7-rework/evidence/, registration record:
// openspec/changes/delivery-foundation-rearchitecture/authorization-journey/
// pilot-registration.case.json). The committed target audience is registered
// from that live readback as PARTIAL: the attachment channel is UNVERIFIED
// (upload infrastructure error: object-store region unset), so auto-publish
// stays blocked — a LIVE audience claim now requires every required readback
// channel (membership/inheritance/pageShare/publicShare/attachment) and
// missing channels are fail-closed (TARGET_CHANNEL_NOT_READ). Source-side
// permission readback (gh TLS x509) and the protected issuance workflow stay
// honestly UNVERIFIED; positive paths still use explicitly marked fixture
// audiences.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const cliPath = path.join(projectRoot, 'tools', 'infra', 'knowledge-authz.mjs');
const knowledgeDir = path.join(projectRoot, 'infra', 'delivery', 'knowledge');
const registryPath = path.join(projectRoot, 'infra', 'delivery', 'registry.json');
const refsPath = path.join(projectRoot, 'infra', 'delivery', 'secrets.refs.example.json');

const RUN_TIMEOUT_MS = 120_000;
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

const FIXTURE_GROUP = 'group:sdd-harness-pilot/engineering';
const FIXTURE_OUT_GROUP = 'group:sdd-harness-pilot/community';
const DIR_OWNER = 'directory:sdd-harness-pilot/owner';
const LIVE_ENDPOINT = 'http://127.0.0.1:3000';
const ALL_CHANNELS = { membership: 'READ', inheritance: 'READ', pageShare: 'READ', publicShare: 'READ', attachment: 'READ' };
const REVIEWER = 'svc:sdd-harness-pilot/worker-reviewer';
const AUTHOR = 'svc:sdd-harness-pilot/worker-author';
const PUBLISHER = 'svc:sdd-harness-pilot/outline-publisher';
const ISOLATOR = 'svc:sdd-harness-pilot/outline-isolator';
const OWNER_PRINCIPAL = 'human:ql-wade#262266039';

// --- scratch world (isolated HOME / PATH stubs / TMPDIR) -----------------------
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'p47-case-'));
const fakeHome = path.join(scratch, 'home');
const stubs = path.join(scratch, 'stubs');
const scratchTmp = path.join(scratch, 'tmp');
fs.mkdirSync(fakeHome, { recursive: true });
fs.mkdirSync(stubs, { recursive: true });
fs.mkdirSync(scratchTmp, { recursive: true });

const { NODE_TEST_CONTEXT: _stripped, ...inheritedEnv } = process.env;
const childEnv = () => ({
  ...inheritedEnv,
  HOME: fakeHome,
  TMPDIR: scratchTmp,
  PATH: stubs,
});

let tmpCounter = 0;
function writeTmp(name, value) {
  const file = path.join(scratch, `${++tmpCounter}-${name}`);
  fs.writeFileSync(file, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
  return file;
}

function runCli(args) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: projectRoot,
    encoding: 'utf8',
    timeout: RUN_TIMEOUT_MS,
    env: childEnv(),
  });
}

function readCommitted(name) {
  return JSON.parse(fs.readFileSync(path.join(knowledgeDir, name), 'utf8'));
}

// Committed artifacts + the single local deviation: an explicitly marked
// LOCAL_FIXTURE audience so the decision arithmetic is exercisable both ways.
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

// Fixture world whose registered audience is the pilot-directory owner
// principal — the shape the live registration produces (policy ∩ grant
// disclosure) — used by the LIVE readback arms.
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

function validRequest(overrides = {}) {
  const payloadDigest = sha256('p47 journey candidate payload v1');
  return {
    schemaVersion: 1,
    requestedBy: PUBLISHER,
    execution: 'exec-p47-journey-1',
    operation: {
      knowledgeId: 'k-p47-journey',
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
      execution: 'review-exec-p47-journey',
      reviewerPrincipal: REVIEWER,
      verdict: 'pass',
      boundPayloadDigest: payloadDigest,
      reviewedAt: new Date().toISOString(),
    },
    ...overrides,
  };
}

const decideArgs = (world, requestFile) => ['decide', '--request', requestFile, '--ledger', world.ledger, '--model', world.model, '--policy', world.policy, '--json'];
const reasonCodes = (result) => {
  try { return JSON.parse(result.stdout).reasons.map((r) => r.code); } catch { return [`UNPARSABLE:${result.stdout.slice(0, 120)}`]; }
};
const violationCodes = (result) => {
  try { return JSON.parse(result.stdout).violations.map((v) => v.code); } catch { return [`UNPARSABLE:${result.stdout.slice(0, 120)}`]; }
};

test('setup: the KnowledgeAuthz.v1 CLI and the committed authorization artifacts are present and validate clean', () => {
  const run = runCli(['validate',
    '--model', path.join(knowledgeDir, 'authorization-model.json'),
    '--policy', path.join(knowledgeDir, 'preauthorization-policy.json'),
    '--ledger', path.join(knowledgeDir, 'grant-ledger.example.json'),
    '--refs', refsPath, '--registry', registryPath, '--json']);
  assert.equal(run.status, 0, `committed artifacts must validate clean: ${run.stderr || run.stdout}`);
  const report = JSON.parse(run.stdout);
  assert.equal(report.ok, true);
  // The committed world stays honest about what is and is not observable:
  // issuance stays UNREGISTERED, while the rework's live target registration
  // records the observed pilot instance, immutable collection id, principal
  // map and the PARTIAL audience (attachment channel unobserved).
  const model = readCommitted('authorization-model.json');
  assert.equal(model.issuers[0].issuanceCredential.status, 'UNREGISTERED');
  const target = model.targets[0];
  assert.equal(target.instanceStatus, 'REGISTERED_PILOT_LIVE');
  assert.match(target.collectionId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.equal(target.instance.url, LIVE_ENDPOINT);
  assert.equal(target.principalMap.length, 3);
  for (const entry of target.principalMap) {
    assert.match(entry.principal, /^directory:sdd-harness-pilot\/[a-z0-9-]+$/);
    assert.match(entry.outlineUserId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    assert.match(entry.email, /^(owner|member|offboarded)@sdd-harness-pilot\.test$/);
  }
  const audience = readCommitted('preauthorization-policy.json').target.allowedAudience;
  assert.equal(audience.status, 'REGISTERED_FROM_LIVE_READBACK_PARTIAL');
  assert.deepEqual(audience.readers, [DIR_OWNER]);
  assert.match(audience.reason, /attachment/i, 'the partial registration must name the unobserved channel');
});

// U01: self-written approvals, unauthorized/expired/revoked issuers are
// rejected even when a signature exists, a PR merged or approved:true is set.
test('U01: Comet rejects self-authored and unauthorized/expired/revoked grants — signature, PR merge and approved fields carry no weight', () => {
  const world = fixtureWorld();
  const base = ['--ledger', world.ledger, '--model', world.model];
  // Positive control: the owner-issued pilot grant verifies.
  assert.equal(runCli(['verify-grant', '--grant', 'grant-pilot-001', ...base, '--json']).status, 0);
  // (a) The request carries its own grant — self-authorization is a refusal class.
  const inline = writeTmp('u01-inline.json', validRequest({ grant: { id: 'grant-pilot-001', approved: true } }));
  assert.equal(runCli(decideArgs(world, inline)).status, 2);
  assert.equal(reasonCodes(runCli(decideArgs(world, inline)))[0], 'SELF_AUTHORED_GRANT');
  // (b) approved:true is not an authorization.
  const approved = writeTmp('u01-approved.json', validRequest({ approved: true }));
  assert.equal(runCli(decideArgs(world, approved)).status, 2);
  assert.equal(reasonCodes(runCli(decideArgs(world, approved)))[0], 'SELF_AUTHORED_APPROVAL');
  // (c) A merged PR is not an authorization.
  const pr = writeTmp('u01-pr.json', validRequest({ mergedPr: 'rpamis/sdd-harness#99' }));
  assert.equal(runCli(decideArgs(world, pr)).status, 2);
  assert.equal(reasonCodes(runCli(decideArgs(world, pr)))[0], 'UNKNOWN_REQUEST_FIELD');
  // (d) A ledger grant with a real-looking signature but an agent issuer.
  const forgedLedger = JSON.parse(fs.readFileSync(world.ledger, 'utf8'));
  forgedLedger.grants.push({
    id: 'u01-forged', version: 1, issuer: AUTHOR, owner: 'ql-wade',
    authority: { source: 'sdd-harness-repo', target: 'outline-managed-collection', delegated: false },
    purpose: { knowledgeTypes: ['project-knowledge'], disclosureAudience: [FIXTURE_GROUP] },
    issuedAt: new Date().toISOString(), expiresAt: '2030-01-01T00:00:00Z', revocation: null,
    signature: { alg: 'es256', value: 'MEUCIQ-forged-signature-blob' },
  });
  const forgedFile = writeTmp('u01-forged-ledger.json', forgedLedger);
  const forged = runCli(['verify-grant', '--grant', 'u01-forged', '--ledger', forgedFile, '--model', world.model, '--json']);
  assert.equal(forged.status, 2, 'a signature on a self-authored grant must not pass');
  assert.equal(JSON.parse(forged.stdout).code, 'ISSUER_UNREGISTERED');
  // (e) A registered issuer without the target-domain authority.
  const misLedger = JSON.parse(fs.readFileSync(world.ledger, 'utf8'));
  misLedger.grants.push({
    id: 'u01-misauthored', version: 1, issuer: 'issuer-pilot-owner', owner: 'ql-wade',
    authority: { source: 'sdd-harness-repo', target: 'some-other-collection', delegated: false },
    purpose: { knowledgeTypes: ['project-knowledge'], disclosureAudience: [FIXTURE_GROUP] },
    issuedAt: new Date().toISOString(), expiresAt: '2030-01-01T00:00:00Z', revocation: null,
  });
  const misFile = writeTmp('u01-mis-ledger.json', misLedger);
  const mis = runCli(['verify-grant', '--grant', 'u01-misauthored', '--ledger', misFile, '--model', world.model, '--json']);
  assert.equal(mis.status, 2);
  assert.equal(JSON.parse(mis.stdout).code, 'ISSUER_AUTHORITY_INVALID');
  // (f) Expired against the real clock.
  const expLedger = JSON.parse(fs.readFileSync(world.ledger, 'utf8'));
  expLedger.grants.push({
    id: 'u01-expired', version: 1, issuer: 'issuer-pilot-owner', owner: 'ql-wade',
    authority: { source: 'sdd-harness-repo', target: 'outline-managed-collection', delegated: false },
    purpose: { knowledgeTypes: ['project-knowledge'], disclosureAudience: [FIXTURE_GROUP] },
    issuedAt: '2020-01-01T00:00:00Z', expiresAt: '2020-02-01T00:00:00Z', revocation: null,
  });
  const expFile = writeTmp('u01-expired-ledger.json', expLedger);
  const expired = runCli(['verify-grant', '--grant', 'u01-expired', '--ledger', expFile, '--model', world.model, '--json']);
  assert.equal(expired.status, 2);
  assert.equal(JSON.parse(expired.stdout).code, 'GRANT_EXPIRED');
  // (g) Revoked: the owner revokes, the same grant stops verifying.
  const revoked = runCli(['revoke', '--grant', 'grant-pilot-001', ...base, '--as', OWNER_PRINCIPAL, '--reason', 'U01 revocation probe', '--json']);
  assert.equal(revoked.status, 0);
  const after = runCli(['verify-grant', '--grant', 'grant-pilot-001', ...base, '--json']);
  assert.equal(after.status, 2);
  assert.equal(JSON.parse(after.stdout).code, 'GRANT_REVOKED');
});

// U02: multi-source candidates — the target audience must sit inside the
// intersection of every source's allowed disclosure; review passing never
// enlarges data authorization.
test('U02: a review-passed multi-source candidate is still denied when the audience is in the union but not in the disclosure intersection', () => {
  const world = fixtureWorld();
  const ledgerB = JSON.parse(fs.readFileSync(world.ledger, 'utf8'));
  ledgerB.grants = ledgerB.grants.filter((g) => g.id !== 'grant-pilot-002');
  ledgerB.grants.push({
    id: 'u02-community', version: 1, issuer: 'issuer-pilot-owner', owner: 'ql-wade',
    authority: { source: 'comet-source', target: 'outline-managed-collection', delegated: false },
    purpose: { knowledgeTypes: ['project-knowledge'], disclosureAudience: [FIXTURE_OUT_GROUP] },
    issuedAt: '2026-10-20T00:00:00Z', expiresAt: '2027-01-18T00:00:00Z', revocation: null,
  });
  const ledgerBFile = writeTmp('u02-ledger.json', ledgerB);
  const payload = sha256('u02 multi-source candidate');
  const multi = validRequest({
    payloadDigest: payload,
    operation: {
      knowledgeId: 'k-u02', knowledgeType: 'project-knowledge', documentId: '9f2504e0-4f89-11d3-9a0c-0305e82c3302',
      action: 'documents.create',
      target: {
        collection: 'outline-managed-collection', audienceSource: 'collection-default',
        effectiveAudience: { readers: [FIXTURE_GROUP, FIXTURE_OUT_GROUP], incompletePagination: false, unmappedPrincipals: [] },
      },
    },
    sources: [
      { domain: 'sdd-harness-repo', permissionEvidence: { status: 'COMPLETE', exportedByServiceAccountOnly: false, unmappedPrincipals: [] } },
      { domain: 'comet-source', permissionEvidence: { status: 'COMPLETE', exportedByServiceAccountOnly: false, unmappedPrincipals: [] } },
    ],
    review: {
      execution: 'review-exec-u02', reviewerPrincipal: REVIEWER,
      verdict: 'pass', boundPayloadDigest: payload, reviewedAt: new Date().toISOString(),
    },
  });
  // Review passed, audience in the union: still denied.
  const unionFile = writeTmp('u02-union.json', multi);
  const unionRun = runCli(['decide', '--request', unionFile, '--ledger', ledgerBFile, '--model', world.model, '--policy', world.policy, '--json']);
  assert.equal(unionRun.status, 2, 'the permission gate must reject despite the passing review');
  assert.ok(reasonCodes(unionRun).includes('AUDIENCE_OUTSIDE_INTERSECTION'));
  // Same two sources, target inside the intersection: source B discloses
  // [G, C]; the intersection with A's [G] governs, so target [G] passes while
  // C alone never does.
  const fixed = JSON.parse(fs.readFileSync(ledgerBFile, 'utf8'));
  fixed.grants.find((g) => g.id === 'u02-community').purpose.disclosureAudience = [FIXTURE_GROUP, FIXTURE_OUT_GROUP];
  const fixedFile = writeTmp('u02-fixed-ledger.json', fixed);
  const inter = JSON.parse(JSON.stringify(multi));
  inter.operation.target.effectiveAudience.readers = [FIXTURE_GROUP];
  const interFile = writeTmp('u02-inter.json', inter);
  const interRun = runCli(['decide', '--request', interFile, '--ledger', fixedFile, '--model', world.model, '--policy', world.policy, '--json']);
  assert.equal(interRun.status, 0, `the intersection case must be allowed: ${interRun.stderr || interRun.stdout}`);
  assert.equal(JSON.parse(interRun.stdout).audience.rule, 'intersection');
});

// U03: a source-permission/grant change before the actual write blocks the old
// publish verdict; the same operation cannot auto-renew.
test('U03: pre-write recheck blocks the old publish verdict after the grant shrinks; no auto-renewal of the same operation', () => {
  const world = fixtureWorld();
  const request = writeTmp('u03-request.json', validRequest());
  const decided = runCli(decideArgs(world, request));
  assert.equal(decided.status, 0, 'the journey requires a valid decision first');
  const decisionFile = writeTmp('u03-decision.json', JSON.parse(decided.stdout));
  // Ground truth shifts before the write: the source grant is revoked.
  assert.equal(runCli(['revoke', '--grant', 'grant-pilot-001', '--ledger', world.ledger, '--model', world.model, '--as', OWNER_PRINCIPAL, '--reason', 'source ACL shrunk before write', '--json']).status, 0);
  const stale = runCli(['recheck', '--decision', decisionFile, '--ledger', world.ledger, '--model', world.model, '--policy', world.policy, '--json']);
  assert.equal(stale.status, 2, 'the old verdict must not survive the pre-write recheck');
  const codes = reasonCodes(stale);
  assert.ok(codes.includes('LEDGER_CHANGED'), `expected LEDGER_CHANGED, got ${codes}`);
  assert.ok(codes.includes('GRANT_NO_LONGER_VALID'), `the revoked grant must fail re-verification, got ${codes}`);
  // Re-deciding the SAME operation is now denied: no renewal through the ledger change.
  const again = runCli(decideArgs(world, request));
  assert.equal(again.status, 2);
  assert.ok(reasonCodes(again).includes('GRANT_REVOKED'));
});

// U04: review and approval bind the candidate version — any payload change
// invalidates the old verdict; the same document id carries no conclusion.
test('U04: a payload change invalidates the old review/publish verdict — no semantic-similarity or same-document-id reuse', () => {
  const world = fixtureWorld();
  const request = writeTmp('u04-request.json', validRequest());
  const decided = runCli(decideArgs(world, request));
  assert.equal(decided.status, 0);
  const decisionFile = writeTmp('u04-decision.json', JSON.parse(decided.stdout));
  // The author edits the payload after approval; the write-time recheck with
  // the drifted payload refuses.
  const drifted = runCli(['recheck', '--decision', decisionFile, '--ledger', world.ledger, '--model', world.model, '--policy', world.policy, '--payload-digest', sha256('u04 edited payload'), '--json']);
  assert.equal(drifted.status, 2);
  assert.equal(reasonCodes(drifted)[0], 'PAYLOAD_DRIFTED');
  // A NEW request with the edited payload but the review still bound to v1.
  const v2 = sha256('u04 edited payload');
  const reReview = writeTmp('u04-rereview.json', validRequest({
    payloadDigest: v2,
    review: {
      execution: 'review-exec-u04-old', reviewerPrincipal: REVIEWER,
      verdict: 'pass', boundPayloadDigest: sha256('p47 journey candidate payload v1'), reviewedAt: new Date().toISOString(),
    },
  }));
  const reRun = runCli(decideArgs(world, reReview));
  assert.equal(reRun.status, 2, 'the old review must not cover the edited payload');
  assert.ok(reasonCodes(reRun).includes('REVIEW_PAYLOAD_STALE'));
  // Same document id does not rescue it: the identical documentId with a stale
  // binding is refused just the same.
  const sameDoc = JSON.parse(fs.readFileSync(reReview, 'utf8'));
  assert.equal(sameDoc.operation.documentId, '3f2504e0-4f89-11d3-9a0c-0305e82c3301');
});

// U05: allowlisted collection name/id is not enough — inheritance, page/subtree
// shares or public entries enlarge the effective audience and are refused; the
// tool has no ACL self-service entrance.
test('U05: share/inheritance/public audience sources are refused on an allowlisted collection; no ACL mutation entrance exists', () => {
  const world = fixtureWorld();
  for (const audienceSource of ['page-share', 'subtree-share', 'public-share']) {
    const file = writeTmp(`u05-${audienceSource}.json`, validRequest());
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    parsed.operation.target.audienceSource = audienceSource;
    fs.writeFileSync(file, JSON.stringify(parsed, null, 2));
    const run = runCli(decideArgs(world, file));
    assert.equal(run.status, 2, `${audienceSource} must be refused although the collection id is allowlisted`);
    assert.ok(reasonCodes(run).includes('TARGET_AUDIENCE_ENLARGED'));
  }
  // Widened effective readers on the allowlisted collection.
  const widened = writeTmp('u05-widened.json', validRequest());
  const parsed = JSON.parse(fs.readFileSync(widened, 'utf8'));
  parsed.operation.target.effectiveAudience.readers = [FIXTURE_GROUP, 'group:sdd-harness-pilot/guests'];
  fs.writeFileSync(widened, JSON.stringify(parsed, null, 2));
  const widenedRun = runCli(decideArgs(world, widened));
  assert.equal(widenedRun.status, 2);
  assert.ok(reasonCodes(widenedRun).includes('AUDIENCE_OUTSIDE_INTERSECTION'));
  // No ACL/share/membership mutation subcommand exists at all.
  for (const cmd of ['acl', 'share', 'membership']) {
    assert.equal(runCli([cmd, '--collection', 'outline-managed-collection', '--json']).status, 1);
  }
  // Rework: a LIVE audience-readback claim must carry every required channel;
  // the missing attachment channel (the observed pilot gap: upload
  // infrastructure error) is fail-closed even though the other four read READ.
  const liveWorld = liveFixtureWorld();
  const liveGap = writeTmp('u05-live-attachment-gap.json', validRequest());
  const gapParsed = JSON.parse(fs.readFileSync(liveGap, 'utf8'));
  gapParsed.operation.target.effectiveAudience = {
    readers: [DIR_OWNER], incompletePagination: false, unmappedPrincipals: [],
    readback: { status: 'LIVE', endpoint: LIVE_ENDPOINT, observedAt: new Date().toISOString() },
  };
  gapParsed.operation.target.channels = { membership: 'READ', inheritance: 'READ', pageShare: 'READ', publicShare: 'READ' };
  fs.writeFileSync(liveGap, JSON.stringify(gapParsed, null, 2));
  const gapRun = runCli(decideArgs(liveWorld, liveGap));
  assert.equal(gapRun.status, 2, 'a LIVE claim without the attachment channel must not publish');
  const gapCodes = reasonCodes(gapRun);
  assert.ok(gapCodes.includes('TARGET_CHANNEL_NOT_READ'), `expected TARGET_CHANNEL_NOT_READ, got ${gapCodes}`);
  // With every required channel READ the same claim passes the audience gate.
  const liveFull = writeTmp('u05-live-full.json', validRequest());
  const fullParsed = JSON.parse(fs.readFileSync(liveFull, 'utf8'));
  fullParsed.operation.target.effectiveAudience = {
    readers: [DIR_OWNER], incompletePagination: false, unmappedPrincipals: [],
    readback: { status: 'LIVE', endpoint: LIVE_ENDPOINT, observedAt: new Date().toISOString() },
  };
  fullParsed.operation.target.channels = { ...ALL_CHANNELS };
  fs.writeFileSync(liveFull, JSON.stringify(fullParsed, null, 2));
  assert.equal(runCli(decideArgs(liveWorld, liveFull)).status, 0, 'a complete LIVE claim passes the audience gate');
});

// U06: incomplete pagination, unmapped principals, permission API errors and
// service-account-only reads stay blocked — unknown is never an empty set or
// public.
test('U06: incomplete/unmapped/error/service-only permission evidence stays blocked and never degrades to empty-or-public', () => {
  const world = fixtureWorld();
  const expectDenial = (name, evidence, expectedCode) => {
    const file = writeTmp(`u06-${name}.json`, validRequest({
      sources: [{ domain: 'sdd-harness-repo', permissionEvidence: evidence }],
    }));
    const run = runCli(decideArgs(world, file));
    assert.equal(run.status, 2, `${name} must stay blocked`);
    assert.ok(reasonCodes(run).includes(expectedCode), `${name}: expected ${expectedCode}, got ${run.stdout}`);
  };
  expectDenial('pagination', { status: 'INCOMPLETE', exportedByServiceAccountOnly: false, unmappedPrincipals: [] }, 'PERMISSION_EVIDENCE_INCOMPLETE');
  expectDenial('api-error', { status: 'ERROR', exportedByServiceAccountOnly: false, unmappedPrincipals: [], error: '403 from permission API' }, 'PERMISSION_EVIDENCE_ERROR');
  expectDenial('service-only', { status: 'COMPLETE', exportedByServiceAccountOnly: true, unmappedPrincipals: [] }, 'SERVICE_ACCOUNT_READ_NOT_REPUBLICATION');
  expectDenial('unmapped-source', { status: 'COMPLETE', exportedByServiceAccountOnly: false, unmappedPrincipals: ['someone@extern.example'] }, 'PRINCIPAL_UNMAPPED');
  // Target-side: incomplete pagination and an unmapped target principal.
  const targetPagination = writeTmp('u06-target-pagination.json', validRequest());
  const parsed = JSON.parse(fs.readFileSync(targetPagination, 'utf8'));
  parsed.operation.target.effectiveAudience.incompletePagination = true;
  fs.writeFileSync(targetPagination, JSON.stringify(parsed, null, 2));
  assert.ok(reasonCodes(runCli(decideArgs(world, targetPagination))).includes('TARGET_EVIDENCE_INCOMPLETE'));
  const targetUnmapped = writeTmp('u06-target-unmapped.json', validRequest());
  const parsedUnmapped = JSON.parse(fs.readFileSync(targetUnmapped, 'utf8'));
  parsedUnmapped.operation.target.effectiveAudience.unmappedPrincipals = ['unmappable-principal'];
  fs.writeFileSync(targetUnmapped, JSON.stringify(parsedUnmapped, null, 2));
  assert.ok(reasonCodes(runCli(decideArgs(world, targetUnmapped))).includes('PRINCIPAL_UNMAPPED'));
  // Rework: a principal registered in the pilot directory map (bound to a real
  // immutable Outline user id in the authorization model) maps; mapping never
  // widens the audience intersection.
  const dirMapped = writeTmp('u06-dir-mapped.json', validRequest());
  const dirParsed = JSON.parse(fs.readFileSync(dirMapped, 'utf8'));
  dirParsed.operation.target.effectiveAudience.readers = [DIR_OWNER];
  fs.writeFileSync(dirMapped, JSON.stringify(dirParsed, null, 2));
  const dirCodes = reasonCodes(runCli(decideArgs(world, dirMapped)));
  assert.ok(!dirCodes.includes('PRINCIPAL_UNMAPPED'), `registered directory principal must map: ${dirCodes}`);
  assert.ok(dirCodes.includes('AUDIENCE_OUTSIDE_INTERSECTION'), 'mapping must not widen the audience');
});

// U07: author/reviewer/publisher/issuer isolation is enforced by real managed
// entrances (I01 catalog resolution, authority-gated revocation, publisher-only
// decision requests) and every denial lands in the auditable ledger.
test('U07: role isolation is enforced by real managed entrances and denials are auditable — author never issues, isolator never reads publisher material', () => {
  const world = fixtureWorld();
  // The author cannot resolve the publisher/isolator credentials in the I01 catalog.
  const authorPublisher = runCli(['resolve', '--ref', 'secret-ref:sdd-harness-pilot/outline-publisher', '--as', AUTHOR, '--role', 'author', '--refs', refsPath, '--json']);
  assert.equal(authorPublisher.status, 2);
  assert.equal(JSON.parse(authorPublisher.stdout).code, 'PRINCIPAL_NOT_AUTHORIZED');
  const isolatorPublisher = runCli(['resolve', '--ref', 'secret-ref:sdd-harness-pilot/outline-publisher', '--as', ISOLATOR, '--role', 'isolator', '--refs', refsPath, '--json']);
  assert.equal(isolatorPublisher.status, 2);
  assert.equal(JSON.parse(isolatorPublisher.stdout).code, 'PRINCIPAL_NOT_AUTHORIZED');
  // The author cannot revoke (no issuance/management power).
  const ledgerBefore = sha256(fs.readFileSync(world.ledger));
  const authorRevoke = runCli(['revoke', '--grant', 'grant-pilot-001', '--ledger', world.ledger, '--model', world.model, '--as', AUTHOR, '--reason', 'self-served', '--json']);
  assert.equal(authorRevoke.status, 2);
  assert.equal(JSON.parse(authorRevoke.stdout).code, 'REVOKE_NOT_AUTHORIZED');
  assert.equal(sha256(fs.readFileSync(world.ledger)), ledgerBefore, 'a denied management attempt must not mutate the ledger');
  // The author cannot request publication, and cannot self-review.
  const asAuthor = writeTmp('u07-author-request.json', validRequest({ requestedBy: AUTHOR }));
  assert.equal(reasonCodes(runCli(decideArgs(world, asAuthor)))[0], 'IDENTITY_NOT_PUBLISHER');
  const selfReview = writeTmp('u07-self-review.json', validRequest({
    review: {
      execution: 'review-exec-u07-self', reviewerPrincipal: AUTHOR,
      verdict: 'pass', boundPayloadDigest: sha256('p47 journey candidate payload v1'), reviewedAt: new Date().toISOString(),
    },
  }));
  assert.ok(reasonCodes(runCli(decideArgs(world, selfReview))).includes('SELF_REVIEW_FORBIDDEN'));
  // A permitted management action IS auditable: the revocation record lands in
  // the ledger with actor, timestamp and reason.
  assert.equal(runCli(['revoke', '--grant', 'grant-pilot-002', '--ledger', world.ledger, '--model', world.model, '--as', OWNER_PRINCIPAL, '--reason', 'U07 audit probe', '--json']).status, 0);
  const audited = JSON.parse(fs.readFileSync(world.ledger, 'utf8')).grants.find((g) => g.id === 'grant-pilot-002');
  assert.equal(audited.revocation.revokedBy, OWNER_PRINCIPAL);
  assert.ok(audited.revocation.revokedAt, 'the revocation must carry a real timestamp');
  assert.equal(audited.revocation.reason, 'U07 audit probe');
});

// U08: the legitimate path — valid owner preauthorization, complete sources,
// matching payload and review — auto-publishes without repeated manual
// confirmation, bound to exactly this object/version.
// P4_7 revision 2026-10-26-comet-050-adoption-v1: the publication-surface
// registration. Who may publish what to whom is a registered, evaluated face:
// the pre-authorized collection domain carries each dimension (source
// permission intersection / complete audience / grant validity / version) with
// an honest UNVERIFIED or STRUCTURAL_ONLY status, the Kp LLMWiki surface is a
// project-internal stdio MCP boundary (NOT_REQUIRED externally), the Kt Outline
// surface is an external grant face whose every required entry is
// NOT_PROVISIONED, and the three negative redlines (no author self-approval, no
// policy mutation through this surface, no owner-key material copied from the
// database) are evaluator assertions — weakening any of them in the committed
// artifacts is a named validate violation.
const SURFACE_FILE = path.join(knowledgeDir, 'publication-surface-registration.json');
const POLICY_FILE = path.join(knowledgeDir, 'preauthorization-policy.json');
const REDLINE_FLAGS = [
  'authorSelfApprovalForbidden',
  'policyMutationOutsideDecisionSurface',
  'ownerKeyExfiltrationForbidden',
  'consumedAuthorizationReuseForbidden',
];

test('comet-050 r1: the publication surfaces are registered with honest UNVERIFIED/NOT_PROVISIONED status and validate as part of the committed world', () => {
  // The committed world (now including the surface registration) validates clean.
  const run = runCli(['validate',
    '--model', path.join(knowledgeDir, 'authorization-model.json'),
    '--policy', POLICY_FILE,
    '--ledger', path.join(knowledgeDir, 'grant-ledger.example.json'),
    '--refs', refsPath, '--registry', registryPath, '--json']);
  assert.equal(run.status, 0, `the committed world incl. the surface registration must validate clean: ${run.stderr || run.stdout}`);
  const surface = JSON.parse(fs.readFileSync(SURFACE_FILE, 'utf8'));
  assert.equal(surface.interface, 'KnowledgePublicationSurface.v1');
  assert.equal(surface.revision, '2026-10-26-comet-050-adoption-v1');
  // Pre-authorized collection domain: every dimension honestly UNVERIFIED or
  // STRUCTURAL_ONLY — never a fabricated authorization.
  const domain = surface.preauthorizedCollectionDomain;
  assert.equal(domain.target, 'outline-managed-collection');
  for (const dimension of ['sourcePermissionIntersection', 'completeAudience', 'grantValidity', 'version']) {
    assert.ok(domain.dimensions[dimension], `dimension ${dimension} must be registered`);
    assert.ok(['UNVERIFIED', 'STRUCTURAL_ONLY', 'HISTORICAL_PARTIAL'].includes(domain.dimensions[dimension].status),
      `dimension ${dimension} must carry an honest status, got ${domain.dimensions[dimension].status}`);
  }
  // Kp surface: project-internal stdio MCP — no external grant, but a boundary.
  const kp = surface.kpSurface;
  assert.equal(kp.kind, 'project-internal-stdio-mcp');
  assert.equal(kp.externalAuthorization, 'NOT_REQUIRED');
  assert.equal(kp.status, 'BOUNDARY_REGISTERED');
  for (const ref of kp.boundary.files) {
    assert.ok(fs.existsSync(path.join(projectRoot, ref)), `Kp boundary file ${ref} must exist`);
  }
  // The Kp admission reference is a real I01 catalog shape: the llmwiki
  // principal resolves it through the four catalog checks (UNRESOLVED — I01
  // has no runtime secret store), and the catalog itself says the ref grants
  // no write, publication or audience today.
  const kpResolve = runCli(['resolve', '--ref', kp.boundary.curatedWriteAdmissionRef,
    '--as', 'svc:sdd-harness-pilot/llmwiki', '--role', 'publisher', '--refs', refsPath, '--json']);
  assert.equal(kpResolve.status, 0, `the Kp admission ref must be a registered catalog shape: ${kpResolve.stdout}`);
  assert.equal(JSON.parse(kpResolve.stdout).status, 'UNRESOLVED');
  // Kt surface: an external grant face that is NOT provisioned.
  const kt = surface.ktSurface;
  assert.equal(kt.kind, 'external-managed-collection-publish');
  assert.equal(kt.externalGrant, 'REQUIRED');
  assert.equal(kt.status, 'NOT_PROVISIONED');
  assert.ok(kt.requiredEntries.length >= 5, 'every required grant-side entry must be listed');
  for (const entry of kt.requiredEntries) {
    assert.equal(entry.status, 'NOT_PROVISIONED', `entry ${entry.id} must be honestly NOT_PROVISIONED`);
    assert.ok(entry.blocker, `entry ${entry.id} must name its current blocker`);
  }
});

test('comet-050 r1: the negative redlines are evaluator assertions — weakening them in the committed artifacts is a named violation', () => {
  const committed = JSON.parse(fs.readFileSync(SURFACE_FILE, 'utf8'));
  const policy = JSON.parse(fs.readFileSync(POLICY_FILE, 'utf8'));
  for (const flag of REDLINE_FLAGS) {
    assert.equal(committed.redlines[flag], true, `surface redline ${flag} must be registered`);
    assert.equal(policy.redlines[flag], true, `policy redline ${flag} must be registered`);
  }
  const base = ['validate',
    '--model', path.join(knowledgeDir, 'authorization-model.json'),
    '--ledger', path.join(knowledgeDir, 'grant-ledger.example.json'),
    '--refs', refsPath, '--registry', registryPath, '--json'];
  // (a) A redline flag flipped false in the policy.
  const weakPolicy = structuredClone(policy);
  weakPolicy.redlines.authorSelfApprovalForbidden = false;
  const weakPolicyFile = writeTmp('r1-weak-policy.json', weakPolicy);
  const weakPolicyRun = runCli([...base, '--policy', weakPolicyFile, '--json']);
  assert.equal(weakPolicyRun.status, 2, 'a weakened redline must fail validate');
  assert.ok(violationCodes(weakPolicyRun).includes('REDLINE_WEAKENED'));
  // (b) The same flag missing from the surface registration.
  const weakSurface = structuredClone(committed);
  delete weakSurface.redlines.ownerKeyExfiltrationForbidden;
  const weakSurfaceFile = writeTmp('r1-weak-surface.json', weakSurface);
  const weakSurfaceRun = runCli([...base, '--policy', POLICY_FILE, '--surface', weakSurfaceFile, '--json']);
  assert.equal(weakSurfaceRun.status, 2);
  assert.ok(violationCodes(weakSurfaceRun).includes('REDLINE_WEAKENED'));
  // (c) A consumed authorization re-flagged as reusable.
  const reusable = structuredClone(committed);
  reusable.consumedAuthorizations[0].reuseForbidden = false;
  const reusableFile = writeTmp('r1-reusable-surface.json', reusable);
  const reusableRun = runCli([...base, '--policy', POLICY_FILE, '--surface', reusableFile, '--json']);
  assert.equal(reusableRun.status, 2, 'a consumed one-shot authorization cannot be re-flagged reusable');
  assert.ok(violationCodes(reusableRun).includes('CONSUMED_AUTHORIZATION_RECORD_INVALID'));
  // (d) A Kt required entry claimed PROVISIONED without evidence.
  const provisioned = structuredClone(committed);
  provisioned.ktSurface.requiredEntries[0].status = 'PROVISIONED';
  const provisionedFile = writeTmp('r1-provisioned-surface.json', provisioned);
  const provisionedRun = runCli([...base, '--policy', POLICY_FILE, '--surface', provisionedFile, '--json']);
  assert.equal(provisionedRun.status, 2, 'an ungrounded NOT_PROVISIONED->PROVISIONED flip must be refused');
  assert.ok(violationCodes(provisionedRun).includes('KT_GRANT_CLAIM_UNGROUNDED'));
});

test('comet-050 r1: the author cannot mutate the permission policy through this surface — no principal can, and nothing is written', () => {
  const policyBefore = sha256(fs.readFileSync(POLICY_FILE));
  const surfaceBefore = sha256(fs.readFileSync(SURFACE_FILE));
  // The named entrance refuses the author...
  const asAuthor = runCli(['authorize-policy-change', '--as', AUTHOR, '--reason', 'widen the audience allowlist', '--json']);
  assert.equal(asAuthor.status, 2, 'the author must be refused policy mutation');
  assert.equal(JSON.parse(asAuthor.stdout).code, 'POLICY_MUTATION_NOT_AUTHORIZED');
  // ...the publisher, the isolator and the issuer-to-be equally...
  for (const principal of [PUBLISHER, ISOLATOR, REVIEWER]) {
    const refused = runCli(['authorize-policy-change', '--as', principal, '--reason', 'adjust trusted policy', '--json']);
    assert.equal(refused.status, 2, `${principal} must be refused policy mutation`);
    assert.equal(JSON.parse(refused.stdout).code, 'POLICY_MUTATION_NOT_AUTHORIZED');
  }
  // ...and even the registered owner: this decision surface holds NO mutation
  // power for anyone — trusted artifacts change only as a new version through
  // the protected issuance path (owner sign-off in governance config).
  const asOwner = runCli(['authorize-policy-change', '--as', OWNER_PRINCIPAL, '--reason', 'owner edit', '--json']);
  assert.equal(asOwner.status, 2, 'the owner too must use the protected issuance path, never this CLI');
  assert.equal(JSON.parse(asOwner.stdout).code, 'POLICY_MUTATION_NOT_AUTHORIZED');
  // A refused mutation writes nothing: both trusted artifacts are byte-identical.
  assert.equal(sha256(fs.readFileSync(POLICY_FILE)), policyBefore, 'policy bytes must be unchanged');
  assert.equal(sha256(fs.readFileSync(SURFACE_FILE)), surfaceBefore, 'surface registration bytes must be unchanged');
});

test('comet-050 r1: owner-key material copied from the database is refused in the publish request (SECRET_MATERIAL_IN_REQUEST)', () => {
  const world = fixtureWorld();
  // (a) A key-shaped field — an owner key literally copied out of the Outline
  // database into the request — is refused by field shape alone.
  const withKey = writeTmp('r1-owner-key.json', validRequest({ apiKey: 'ol_api_copied_from_the_outline_database' }));
  const keyRun = runCli(decideArgs(world, withKey));
  assert.equal(keyRun.status, 2, 'key material in the request must be a refusal');
  assert.ok(reasonCodes(keyRun).includes('SECRET_MATERIAL_IN_REQUEST'), `expected SECRET_MATERIAL_IN_REQUEST, got ${keyRun.stdout}`);
  // (b) A bearer-token-shaped value is refused by value shape, whatever the field name.
  const withBearer = writeTmp('r1-bearer.json', validRequest({ credentialNote: 'Bearer jjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjj' }));
  const bearerRun = runCli(decideArgs(world, withBearer));
  assert.equal(bearerRun.status, 2);
  assert.ok(reasonCodes(bearerRun).includes('SECRET_MATERIAL_IN_REQUEST'));
  // Credential access has exactly one shape on this surface: the I01 ref gate.
  const gate = runCli(['resolve', '--ref', 'secret-ref:sdd-harness-pilot/outline-publisher', '--as', PUBLISHER, '--role', 'publisher', '--refs', refsPath, '--json']);
  assert.equal(gate.status, 0);
  assert.equal(JSON.parse(gate.stdout).status, 'UNRESOLVED', 'the gate resolves principals, never values');
});

test('U08: a fully grounded publish auto-advances with a bound receipt and readback obligation, never extended to other objects or versions', () => {
  const world = fixtureWorld();
  const request = writeTmp('u08-request.json', validRequest());
  const decided = runCli(decideArgs(world, request));
  assert.equal(decided.status, 0, `the grounded request must auto-publish: ${decided.stderr || decided.stdout}`);
  const receipt = JSON.parse(decided.stdout);
  assert.equal(receipt.verdict, 'allow');
  assert.equal(receipt.operation.documentId, '3f2504e0-4f89-11d3-9a0c-0305e82c3301');
  assert.equal(receipt.payloadDigest, sha256('p47 journey candidate payload v1'));
  assert.ok(receipt.grants.includes('grant-pilot-001'), 'the receipt names the grants it consumed');
  assert.deepEqual(receipt.audience.effective, [FIXTURE_GROUP]);
  assert.equal(receipt.readback.required, true, 'the publication stays incomplete without the independent readback');
  assert.equal(receipt.limits.autoRenewal, false);
  assert.match(receipt.limits.scope, /this operation|this object/i);
  assert.match(receipt.provenance.permissionEvidence, /LOCAL_ONLY|UNVERIFIED/);
  // The write-time recheck passes and no second manual confirmation exists.
  const decisionFile = writeTmp('u08-decision.json', receipt);
  const recheck = runCli(['recheck', '--decision', decisionFile, '--ledger', world.ledger, '--model', world.model, '--policy', world.policy, '--payload-digest', receipt.payloadDigest, '--json']);
  assert.equal(recheck.status, 0, `the pre-write recheck must pass: ${recheck.stderr || recheck.stdout}`);
  assert.equal(JSON.parse(recheck.stdout).ok, true);
  assert.ok(!('humanApproval' in receipt) && !('manualConfirmation' in receipt), 'no repeated manual confirmation field exists on the auto path');
  // The approval does not extend to a future version or another object.
  const drifted = runCli(['recheck', '--decision', decisionFile, '--ledger', world.ledger, '--model', world.model, '--policy', world.policy, '--payload-digest', sha256('u08 next version'), '--json']);
  assert.equal(drifted.status, 2);
  assert.equal(reasonCodes(drifted)[0], 'PAYLOAD_DRIFTED');
  // Rework: the live arm — a LIVE audience readback with every required
  // channel READ auto-advances the same way and the receipt records the live
  // provenance (never a declared-only receipt dressed up as a live closure).
  const liveWorld = liveFixtureWorld();
  const liveFile = writeTmp('u08-live.json', validRequest());
  const liveParsed = JSON.parse(fs.readFileSync(liveFile, 'utf8'));
  liveParsed.operation.target.effectiveAudience = {
    readers: [DIR_OWNER], incompletePagination: false, unmappedPrincipals: [],
    readback: { status: 'LIVE', endpoint: LIVE_ENDPOINT, observedAt: new Date().toISOString() },
  };
  liveParsed.operation.target.channels = { ...ALL_CHANNELS };
  fs.writeFileSync(liveFile, JSON.stringify(liveParsed, null, 2));
  const liveDecided = runCli(decideArgs(liveWorld, liveFile));
  assert.equal(liveDecided.status, 0, `the live-grounded request must auto-publish: ${liveDecided.stderr || liveDecided.stdout}`);
  const liveReceipt = JSON.parse(liveDecided.stdout);
  assert.match(String(liveReceipt.provenance.targetAudience), /LIVE_READBACK/);
  assert.deepEqual(liveReceipt.audience.effective, [DIR_OWNER]);
  const liveDecisionFile = writeTmp('u08-live-decision.json', liveReceipt);
  const liveRecheck = runCli(['recheck', '--decision', liveDecisionFile, '--ledger', liveWorld.ledger, '--model', liveWorld.model, '--policy', liveWorld.policy, '--payload-digest', liveReceipt.payloadDigest, '--json']);
  assert.equal(liveRecheck.status, 0, `the live receipt must recheck fresh: ${liveRecheck.stderr || liveRecheck.stdout}`);
});

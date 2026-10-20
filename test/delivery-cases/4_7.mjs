// P4_7 delivery case: knowledge publication pre-authorization (acceptance
// U01–U08, spec "Knowledge publication authorization"). Every scenario drives
// the real KnowledgeAuthz.v1 CLI (tools/infra/knowledge-authz.mjs) over the
// committed artifacts (infra/delivery/knowledge/*) plus local tmp fixture
// worlds; the I01 resolution gate (tools/infra/secret-refs.mjs, unmodified) is
// exercised through the CLI's resolve entrance. All processes run with an
// isolated HOME, PATH stubs and scratch TMPDIR; no live configuration is
// touched and no mock substitutes a real entrance.
//
// LOCAL_ONLY scope (environment facts: no live Outline instance, no platform
// write authorization, gh TLS broken): what is proven here is the
// authorization-model structure, trusted-issuance / revocation / expiry
// ordering, the multi-source disclosure intersection, principal-mapping
// completeness, pre-write version re-verification and the role isolation
// boundary. Live source/target permission readback, Outline inheritance /
// single-page / public-share enforcement and the real protected issuance
// workflow are honestly UNVERIFIED (successor: Outline owner + deployment
// verification wave); the committed artifacts carry no audience and fail
// closed, so positive paths use explicitly marked LOCAL_FIXTURE audiences.
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

test('setup: the KnowledgeAuthz.v1 CLI and the committed authorization artifacts are present and validate clean', () => {
  const run = runCli(['validate',
    '--model', path.join(knowledgeDir, 'authorization-model.json'),
    '--policy', path.join(knowledgeDir, 'preauthorization-policy.json'),
    '--ledger', path.join(knowledgeDir, 'grant-ledger.example.json'),
    '--refs', refsPath, '--registry', registryPath, '--json']);
  assert.equal(run.status, 0, `committed artifacts must validate clean: ${run.stderr || run.stdout}`);
  const report = JSON.parse(run.stdout);
  assert.equal(report.ok, true);
  // The committed world stays honest about the unobservable parts.
  const model = readCommitted('authorization-model.json');
  assert.equal(model.issuers[0].issuanceCredential.status, 'UNREGISTERED');
  assert.equal(readCommitted('preauthorization-policy.json').target.allowedAudience.status, 'UNVERIFIED');
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
});

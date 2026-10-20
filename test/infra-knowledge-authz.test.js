import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// V_INFRA_P4_7 — knowledge publication pre-authorization contract checks
// (delivery-foundation-rearchitecture Task P4_7, acceptance U01–U08).
//
// Spec: specs/delivery-foundation/spec.md "Knowledge publication authorization"
// (U01–U08). Design: knowledge-preauthorization-contract.md. The locally
// provable subset is the authorization-model structure, the trusted-issuance /
// revocation / expiry ordering, the multi-source disclosure intersection, the
// principal-mapping completeness and the role isolation boundary — all exercised
// through the real KnowledgeAuthz.v1 CLI (tools/infra/knowledge-authz.mjs) over
// the committed artifacts (infra/delivery/knowledge/*). Live source/target ACL
// truth, Outline inheritance/sharing enforcement and the real issuance
// workflow are NOT observable in this environment; they stay UNVERIFIED with a
// named successor and are never fabricated as VERIFIED.
//
// CLI exit contract:
//   0 = PASS (validate clean / grant valid / decision allow / recheck fresh /
//       ref principal authorized)
//   1 = invalid input or prerequisite (missing/unreadable file, unknown
//       command or option, malformed request)
//   2 = verification failure (violations, denied, expired/revoked, stale)
// Missing environment is explicitly UNVERIFIED and nonzero; a skip is never a
// pass. Fixtures live under os.tmpdir(); no live configuration is written.
const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '..');
const cliPath = path.join(repoRoot, 'tools', 'infra', 'knowledge-authz.mjs');
const knowledgeDir = path.join(repoRoot, 'infra', 'delivery', 'knowledge');
const registryPath = path.join(repoRoot, 'infra', 'delivery', 'registry.json');
const refsPath = path.join(repoRoot, 'infra', 'delivery', 'secrets.refs.example.json');

const RUN_TIMEOUT_MS = 60_000;
const HOST_PATH_OUTPUT_RE = /\/(Users|home|root|private|var|usr|etc|opt|tmp)\//;
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

// Local fixture audience: an explicit operator-declared audience used ONLY to
// exercise the decision arithmetic. The committed artifacts deliberately carry
// no audience (UNVERIFIED) so the committed state fails closed.
const FIXTURE_GROUP = 'group:sdd-harness-pilot/engineering';
const FIXTURE_OUT_GROUP = 'group:sdd-harness-pilot/community';

const { NODE_TEST_CONTEXT: _stripped, ...inheritedEnv } = process.env;

function isolatedEnv() {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'p47-env-'));
  const stubs = path.join(scratch, 'stubs');
  fs.mkdirSync(stubs, { recursive: true });
  return {
    ...inheritedEnv,
    HOME: path.join(scratch, 'home'),
    TMPDIR: path.join(scratch, 'tmp'),
    PATH: stubs,
  };
}

function runCli(args) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: RUN_TIMEOUT_MS,
    env: isolatedEnv(),
  });
}

function parseJsonOut(result, label) {
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new AssertionError(`${label}: stdout is not JSON: ${result.stdout}\nstderr: ${result.stderr}`);
  }
}

function readCommitted(name) {
  return JSON.parse(fs.readFileSync(path.join(knowledgeDir, name), 'utf8'));
}

function codes(report) {
  return (report.violations ?? []).map((v) => v.code);
}

// --- tmp fixture world --------------------------------------------------------

const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'infra-p47-'));
let tmpCounter = 0;

function writeTmp(name, value) {
  const file = path.join(scratchRoot, `${++tmpCounter}-${name}`);
  fs.writeFileSync(file, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
  return file;
}

// A faithful copy of the committed artifacts, with the ONLY local deviation
// that the fixture audience is declared (marked LOCAL_FIXTURE) so the decision
// arithmetic can be exercised both ways.
function fixtureWorld() {
  const model = readCommitted('authorization-model.json');
  const policy = readCommitted('preauthorization-policy.json');
  const ledger = readCommitted('grant-ledger.example.json');
  const audience = [FIXTURE_GROUP];
  const fixedPolicy = structuredClone(policy);
  fixedPolicy.target.allowedAudience = {
    readers: audience,
    status: 'LOCAL_FIXTURE',
    reason: 'operator-declared audience for the local structural decision proof only',
  };
  for (const grant of ledger.grants) {
    if (grant.revocation === null) grant.purpose.disclosureAudience = audience;
  }
  return {
    model: writeTmp('model.json', model),
    policy: writeTmp('policy.json', fixedPolicy),
    ledger: writeTmp('ledger.json', ledger),
  };
}

function validRequest(overrides = {}) {
  const payloadDigest = sha256('p47 approved candidate payload v1');
  return {
    schemaVersion: 1,
    requestedBy: 'svc:sdd-harness-pilot/outline-publisher',
    execution: 'exec-p47-decide-1',
    operation: {
      knowledgeId: 'k-p47-positive',
      knowledgeType: 'project-knowledge',
      documentId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
      action: 'documents.create',
      target: {
        collection: 'outline-managed-collection',
        audienceSource: 'collection-default',
        effectiveAudience: {
          readers: [FIXTURE_GROUP],
          incompletePagination: false,
          unmappedPrincipals: [],
        },
      },
    },
    payloadDigest,
    sources: [
      {
        domain: 'sdd-harness-repo',
        permissionEvidence: {
          status: 'COMPLETE',
          exportedByServiceAccountOnly: false,
          unmappedPrincipals: [],
        },
      },
    ],
    review: {
      execution: 'review-exec-p47-1',
      reviewerPrincipal: 'svc:sdd-harness-pilot/worker-reviewer',
      verdict: 'pass',
      boundPayloadDigest: payloadDigest,
      reviewedAt: new Date().toISOString(),
    },
    ...overrides,
  };
}

const REVIEWER = 'svc:sdd-harness-pilot/worker-reviewer';
const AUTHOR = 'svc:sdd-harness-pilot/worker-author';
const PUBLISHER = 'svc:sdd-harness-pilot/outline-publisher';
const ISOLATOR = 'svc:sdd-harness-pilot/outline-isolator';
const OWNER_PRINCIPAL = 'human:ql-wade#262266039';

// --- contract -----------------------------------------------------------------

test('V_INFRA_P4_7: committed authorization artifacts validate clean against the real CLI and the I01 catalog', () => {
  const run = runCli([
    'validate',
    '--model', path.join(knowledgeDir, 'authorization-model.json'),
    '--policy', path.join(knowledgeDir, 'preauthorization-policy.json'),
    '--ledger', path.join(knowledgeDir, 'grant-ledger.example.json'),
    '--refs', refsPath,
    '--registry', registryPath,
    '--json',
  ]);
  assert.equal(run.status, 0, `validate must PASS on committed files: ${run.stderr || run.stdout}`);
  const report = parseJsonOut(run, 'validate');
  assert.equal(report.ok, true);
  assert.equal(report.interface, 'KnowledgeAuthz.v1');
  assert.deepEqual(report.violations, []);
  assert.doesNotMatch(run.stdout, HOST_PATH_OUTPUT_RE, 'structured receipts must not carry host absolute paths');
  // The committed world is honest about what this environment cannot observe.
  const model = readCommitted('authorization-model.json');
  assert.equal(model.issuers[0].issuanceCredential.status, 'UNREGISTERED',
    'no issuance credential exists in the I01 catalog; the model must say so instead of inventing one');
  for (const target of model.targets) {
    assert.equal(target.instanceStatus, 'UNVERIFIED', 'target instance truth is unobservable locally');
  }
  const policy = readCommitted('preauthorization-policy.json');
  assert.equal(policy.target.allowedAudience.status, 'UNVERIFIED',
    'the committed target audience must stay UNVERIFIED (no live instance to observe)');
});

test('committed state fails closed: decide on the committed artifacts refuses because no audience is registered', () => {
  const world = fixtureWorld();
  const policy = JSON.parse(fs.readFileSync(world.policy, 'utf8'));
  policy.target.allowedAudience = { readers: [], status: 'UNVERIFIED', reason: 'committed state' };
  const committedPolicy = writeTmp('committed-policy.json', policy);
  const request = writeTmp('committed-request.json', validRequest());
  const run = runCli(['decide', '--request', request, '--ledger', world.ledger, '--model', world.model, '--policy', committedPolicy, '--json']);
  assert.equal(run.status, 2, 'the committed world must deny: empty allowed audience is fail-closed, not permissive');
  const receipt = parseJsonOut(run, 'decide');
  assert.equal(receipt.verdict, 'deny');
  assert.ok(receipt.reasons.some((r) => r.code === 'AUDIENCE_OUTSIDE_INTERSECTION'),
    `expected AUDIENCE_OUTSIDE_INTERSECTION, got ${JSON.stringify(receipt.reasons)}`);
});

test('role isolation structure: pairwise-distinct principals and refs; tampering is a named violation', () => {
  const model = readCommitted('authorization-model.json');
  const roles = ['author', 'reviewer', 'publisher', 'isolator'];
  const principals = roles.map((role) => model.roles[role].principal);
  const refs = roles.map((role) => model.roles[role].credentialRef);
  assert.equal(new Set(principals).size, 4, 'the four managed roles must have distinct principals');
  assert.equal(new Set(refs).size, 4, 'the four managed roles must have distinct credential refs');
  const issuerPrincipals = model.issuers.map((issuer) => issuer.principal);
  for (const principal of principals) {
    assert.ok(!issuerPrincipals.includes(principal), 'an agent role principal must never be an issuer');
  }
  // Negative: the author promoted to issuer through a tampered tmp model.
  const world = fixtureWorld();
  const tampered = JSON.parse(fs.readFileSync(world.model, 'utf8'));
  tampered.issuers[0].principal = tampered.roles.author.principal;
  const tamperedModel = writeTmp('model-author-issuer.json', tampered);
  const run = runCli(['validate', '--model', tamperedModel, '--policy', world.policy, '--ledger', world.ledger, '--refs', refsPath, '--json']);
  assert.equal(run.status, 2);
  assert.ok(codes(parseJsonOut(run, 'validate')).includes('ROLE_ISOLATION_VIOLATED'));
});

test('owner registration ties to the I01 registry; mismatch is a named violation', () => {
  const model = readCommitted('authorization-model.json');
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  const registeredOwner = registry.project.owner;
  assert.equal(registeredOwner, 'ql-wade');
  assert.equal(model.ownerPrincipal, OWNER_PRINCIPAL);
  for (const source of model.sources) {
    assert.equal(source.owner, registeredOwner, `pilot source ${source.id} must be owned by the registered owner`);
    assert.deepEqual(source.delegates, [], 'no delegation is registered for the pilot; the model must not invent one');
    assert.equal(source.authorityStatus, 'UNVERIFIED', 'source authority readback is unverified in this environment');
  }
  const ledger = readCommitted('grant-ledger.example.json');
  for (const grant of ledger.grants) {
    assert.equal(grant.owner, registeredOwner, `grant ${grant.id} must name the registered owner`);
  }
  // Negative: a grant owned by someone else.
  const world = fixtureWorld();
  const forged = JSON.parse(fs.readFileSync(world.ledger, 'utf8'));
  forged.grants[0].owner = 'not-the-registered-owner';
  const forgedLedger = writeTmp('ledger-wrong-owner.json', forged);
  const run = runCli(['validate', '--model', world.model, '--policy', world.policy, '--ledger', forgedLedger, '--registry', registryPath, '--json']);
  assert.equal(run.status, 2);
  assert.ok(codes(parseJsonOut(run, 'validate')).includes('OWNER_MISMATCH'));
});

test('credential alignment: role refs resolve in the I01 catalog with matching boundRole; policy/author refs are denied', () => {
  // The real I01 resolution gate (unmodified) denies author-grade principals
  // the publisher credential: the isolation boundary is enforced by the
  // catalog, not by prompt discipline (U07).
  const denied = runCli(['resolve', '--ref', 'secret-ref:sdd-harness-pilot/outline-publisher', '--as', AUTHOR, '--role', 'author', '--refs', refsPath, '--json']);
  assert.equal(denied.status, 2, 'the author principal must be denied the publisher credential');
  const denial = parseJsonOut(denied, 'resolve');
  assert.equal(denial.code, 'PRINCIPAL_NOT_AUTHORIZED');
  const isolatorDenied = runCli(['resolve', '--ref', 'secret-ref:sdd-harness-pilot/outline-publisher', '--as', ISOLATOR, '--role', 'isolator', '--refs', refsPath, '--json']);
  assert.equal(isolatorDenied.status, 2, 'the isolator must not read publisher material at the credential level');
  assert.equal(parseJsonOut(isolatorDenied, 'resolve').code, 'PRINCIPAL_NOT_AUTHORIZED');
  // The right principal passes all four catalog checks and stays honestly
  // UNRESOLVED (I01 deliberately has no runtime secret store).
  const allowed = runCli(['resolve', '--ref', 'secret-ref:sdd-harness-pilot/outline-publisher', '--as', PUBLISHER, '--role', 'publisher', '--refs', refsPath, '--json']);
  assert.equal(allowed.status, 0);
  assert.equal(parseJsonOut(allowed, 'resolve').status, 'UNRESOLVED');
  // A cross-project ref is refused.
  const foreign = runCli(['resolve', '--ref', 'secret-ref:other-project/outline-publisher', '--as', 'svc:other-project/outline-publisher', '--role', 'publisher', '--refs', refsPath, '--json']);
  assert.equal(foreign.status, 2);
  assert.equal(parseJsonOut(foreign, 'resolve').code, 'CROSS_PROJECT_REF');
});

test('grant lifecycle over the real clock: verify, authority-gated revoke, expiry, and the time-bending refusal', () => {
  const world = fixtureWorld();
  const base = ['--ledger', world.ledger, '--model', world.model];
  // Active pilot grant verifies.
  const ok = runCli(['verify-grant', '--grant', 'grant-pilot-001', ...base, '--json']);
  assert.equal(ok.status, 0, `the active pilot grant must verify: ${ok.stderr || ok.stdout}`);
  // Revocation is authority-gated: the author cannot revoke.
  const ledgerBefore = sha256(fs.readFileSync(world.ledger));
  const authorRevoke = runCli(['revoke', '--grant', 'grant-pilot-001', ...base, '--as', AUTHOR, '--reason', 'self-served revocation', '--json']);
  assert.equal(authorRevoke.status, 2, 'the author must not be able to revoke a grant');
  assert.equal(parseJsonOut(authorRevoke, 'revoke').code, 'REVOKE_NOT_AUTHORIZED');
  assert.equal(sha256(fs.readFileSync(world.ledger)), ledgerBefore, 'a denied revocation must not touch the ledger');
  // The registered owner/issuer can; the revocation is ordered against the real clock.
  const revoke = runCli(['revoke', '--grant', 'grant-pilot-001', ...base, '--as', OWNER_PRINCIPAL, '--reason', 'source audience shrunk', '--json']);
  assert.equal(revoke.status, 0, `owner revocation must succeed: ${revoke.stderr || revoke.stdout}`);
  const after = runCli(['verify-grant', '--grant', 'grant-pilot-001', ...base, '--json']);
  assert.equal(after.status, 2);
  assert.equal(parseJsonOut(after, 'verify-grant').code, 'GRANT_REVOKED');
  // A second revocation is refused (already revoked).
  const again = runCli(['revoke', '--grant', 'grant-pilot-001', ...base, '--as', OWNER_PRINCIPAL, '--reason', 'again', '--json']);
  assert.equal(again.status, 2);
  assert.equal(parseJsonOut(again, 'revoke').code, 'GRANT_ALREADY_REVOKED');
  // Expiry is judged against the real clock: a past-window grant is expired.
  const expiredGrant = {
    id: 'grant-expired-fixture', version: 1, issuer: 'issuer-pilot-owner', owner: 'ql-wade',
    authority: { source: 'comet-source', target: 'outline-managed-collection', delegated: false },
    purpose: { knowledgeTypes: ['project-knowledge'], disclosureAudience: [FIXTURE_GROUP] },
    issuedAt: '2020-01-01T00:00:00Z', expiresAt: '2020-02-01T00:00:00Z', revocation: null,
  };
  const world2 = fixtureWorld();
  const ledger2 = JSON.parse(fs.readFileSync(world2.ledger, 'utf8'));
  ledger2.grants.push(expiredGrant);
  const ledger2File = writeTmp('ledger-expired.json', ledger2);
  const expired = runCli(['verify-grant', '--grant', 'grant-expired-fixture', '--ledger', ledger2File, '--model', world2.model, '--json']);
  assert.equal(expired.status, 2);
  assert.equal(parseJsonOut(expired, 'verify-grant').code, 'GRANT_EXPIRED');
  // Unknown grant.
  const unknown = runCli(['verify-grant', '--grant', 'no-such-grant', ...base, '--json']);
  assert.equal(unknown.status, 2);
  assert.equal(parseJsonOut(unknown, 'verify-grant').code, 'GRANT_NOT_FOUND');
  // Time is not an agent-modifiable input: no --now option exists.
  const timeBend = runCli(['verify-grant', '--grant', 'grant-pilot-002', ...base, '--now', '2030-01-01T00:00:00Z', '--json']);
  assert.equal(timeBend.status, 1, 'a --now override must not exist: agents cannot modify time');
});

test('trusted issuance (U01): signature presence, PR merges and approved fields never substitute for a registered issuer with domain authority', () => {
  // A ledger grant carrying a signature-shaped blob but an unregistered (agent) issuer.
  const forged = {
    id: 'grant-forged-001', version: 1, issuer: AUTHOR, owner: 'ql-wade',
    authority: { source: 'sdd-harness-repo', target: 'outline-managed-collection', delegated: false },
    purpose: { knowledgeTypes: ['project-knowledge'], disclosureAudience: [FIXTURE_GROUP] },
    issuedAt: new Date().toISOString(), expiresAt: '2030-01-01T00:00:00Z', revocation: null,
    signature: { alg: 'es256', value: 'MEUCIQ-forged-signature-blob' },
    mergedPr: 'rpamis/sdd-harness#1234',
  };
  const worldForged = fixtureWorld();
  const forgedLedger = JSON.parse(fs.readFileSync(worldForged.ledger, 'utf8'));
  forgedLedger.grants.push(forged);
  const forgedFile = writeTmp('ledger-forged.json', forgedLedger);
  const run = runCli(['verify-grant', '--grant', 'grant-forged-001', '--ledger', forgedFile, '--model', worldForged.model, '--json']);
  assert.equal(run.status, 2, 'a signature on a self-authored grant is worthless');
  assert.equal(parseJsonOut(run, 'verify-grant').code, 'ISSUER_UNREGISTERED');
  // A registered issuer WITHOUT the domain authority is equally refused.
  const misauthored = {
    id: 'grant-misauthored-001', version: 1, issuer: 'issuer-pilot-owner', owner: 'ql-wade',
    authority: { source: 'sdd-harness-repo', target: 'some-other-collection', delegated: false },
    purpose: { knowledgeTypes: ['project-knowledge'], disclosureAudience: [FIXTURE_GROUP] },
    issuedAt: new Date().toISOString(), expiresAt: '2030-01-01T00:00:00Z', revocation: null,
  };
  const worldMis = fixtureWorld();
  const misLedger = JSON.parse(fs.readFileSync(worldMis.ledger, 'utf8'));
  misLedger.grants.push(misauthored);
  const misFile = writeTmp('ledger-misauthored.json', misLedger);
  const misRun = runCli(['verify-grant', '--grant', 'grant-misauthored-001', '--ledger', misFile, '--model', worldMis.model, '--json']);
  assert.equal(misRun.status, 2);
  assert.equal(parseJsonOut(misRun, 'verify-grant').code, 'ISSUER_AUTHORITY_INVALID');
});

test('decide positive path: a fully grounded request yields an allow receipt bound to digests, grants and audience', () => {
  const world = fixtureWorld();
  const request = writeTmp('req-allow.json', validRequest());
  const run = runCli(['decide', '--request', request, '--ledger', world.ledger, '--model', world.model, '--policy', world.policy, '--json']);
  assert.equal(run.status, 0, `the grounded request must be allowed: ${run.stderr || run.stdout}`);
  const receipt = parseJsonOut(run, 'decide');
  assert.equal(receipt.verdict, 'allow');
  assert.equal(receipt.payloadDigest, sha256('p47 approved candidate payload v1'));
  assert.equal(receipt.audience.rule, 'intersection');
  assert.deepEqual(receipt.audience.effective, [FIXTURE_GROUP]);
  assert.ok(receipt.bindings.policyDigest && receipt.bindings.ledgerDigest && receipt.bindings.modelDigest);
  assert.equal(receipt.readback.required, true);
  assert.match(receipt.provenance.permissionEvidence, /LOCAL_ONLY|UNVERIFIED/, 'the receipt must say the permission evidence is operator-declared locally');
  // Recheck immediately: fresh.
  const decisionFile = writeTmp('decision-allow.json', receipt);
  const recheck = runCli(['recheck', '--decision', decisionFile, '--ledger', world.ledger, '--model', world.model, '--policy', world.policy, '--json']);
  assert.equal(recheck.status, 0, `a fresh decision must recheck clean: ${recheck.stderr || recheck.stdout}`);
});

test('auto-publish identity and review gates: not-publisher, self-review, unregistered reviewer, stale review', () => {
  const world = fixtureWorld();
  const decideArgs = (requestFile) => ['decide', '--request', requestFile, '--ledger', world.ledger, '--model', world.model, '--policy', world.policy, '--json'];
  // The author cannot request publication (only the publisher executes writes).
  const asAuthor = writeTmp('req-author.json', validRequest({ requestedBy: AUTHOR }));
  const runAuthor = runCli(decideArgs(asAuthor));
  assert.equal(runAuthor.status, 2);
  assert.equal(parseJsonOut(runAuthor, 'decide').reasons[0].code, 'IDENTITY_NOT_PUBLISHER');
  // Self-review: the author reviewing its own candidate.
  const selfReview = writeTmp('req-self-review.json', validRequest({
    review: {
      execution: 'review-exec-self', reviewerPrincipal: AUTHOR,
      verdict: 'pass', boundPayloadDigest: sha256('p47 approved candidate payload v1'), reviewedAt: new Date().toISOString(),
    },
  }));
  const runSelf = runCli(decideArgs(selfReview));
  assert.equal(runSelf.status, 2);
  assert.ok(parseJsonOut(runSelf, 'decide').reasons.some((r) => r.code === 'SELF_REVIEW_FORBIDDEN'));
  // Unregistered reviewer principal.
  const fakeReviewer = writeTmp('req-fake-reviewer.json', validRequest({
    review: {
      execution: 'review-exec-fake', reviewerPrincipal: 'svc:sdd-harness-pilot/worker-author-cousin',
      verdict: 'pass', boundPayloadDigest: sha256('p47 approved candidate payload v1'), reviewedAt: new Date().toISOString(),
    },
  }));
  const runFake = runCli(decideArgs(fakeReviewer));
  assert.equal(runFake.status, 2);
  assert.ok(parseJsonOut(runFake, 'decide').reasons.some((r) => r.code === 'REVIEWER_UNREGISTERED'));
  // Review older than the policy freshness window.
  const policy = JSON.parse(fs.readFileSync(world.policy, 'utf8'));
  const staleReview = writeTmp('req-stale-review.json', validRequest({
    review: {
      execution: 'review-exec-old', reviewerPrincipal: REVIEWER,
      verdict: 'pass', boundPayloadDigest: sha256('p47 approved candidate payload v1'),
      reviewedAt: new Date(Date.now() - (policy.quality.reviewFreshnessHours + 24) * 3600_000).toISOString(),
    },
  }));
  const runStale = runCli(decideArgs(staleReview));
  assert.equal(runStale.status, 2);
  assert.ok(parseJsonOut(runStale, 'decide').reasons.some((r) => r.code === 'REVIEW_EXPIRED'));
});

test('multi-source disclosure intersection: union membership is not enough (U02 semantics)', () => {
  const world = fixtureWorld();
  // comet-source's only active grant discloses to a DIFFERENT group.
  const ledgerB = JSON.parse(fs.readFileSync(world.ledger, 'utf8'));
  ledgerB.grants = ledgerB.grants.filter((g) => g.id !== 'grant-pilot-002');
  ledgerB.grants.push({
    id: 'grant-community-001', version: 1, issuer: 'issuer-pilot-owner', owner: 'ql-wade',
    authority: { source: 'comet-source', target: 'outline-managed-collection', delegated: false },
    purpose: { knowledgeTypes: ['project-knowledge'], disclosureAudience: [FIXTURE_OUT_GROUP] },
    issuedAt: '2026-10-20T00:00:00Z', expiresAt: '2027-01-18T00:00:00Z', revocation: null,
  });
  const ledgerBFile = writeTmp('ledger-community.json', ledgerB);
  const payload = sha256('multi-source candidate');
  const multiRequest = () => validRequest({
    payloadDigest: payload,
    operation: {
      knowledgeId: 'k-multi-source', knowledgeType: 'project-knowledge', documentId: '9f2504e0-4f89-11d3-9a0c-0305e82c3302',
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
      execution: 'review-exec-multi', reviewerPrincipal: REVIEWER,
      verdict: 'pass', boundPayloadDigest: payload, reviewedAt: new Date().toISOString(),
    },
  });
  // Target audience sits in the UNION of the two source audiences, not in the
  // (empty) intersection: denied even though independent review passed.
  const unionFile = writeTmp('req-union.json', multiRequest());
  const runUnion = runCli(['decide', '--request', unionFile, '--ledger', ledgerBFile, '--model', world.model, '--policy', world.policy, '--json']);
  assert.equal(runUnion.status, 2, 'review passing must not enlarge data authorization');
  const unionReceipt = parseJsonOut(runUnion, 'decide');
  assert.ok(unionReceipt.reasons.some((r) => r.code === 'AUDIENCE_OUTSIDE_INTERSECTION'));
  // The same two sources with the target INSIDE the intersection: allowed.
  // Source B discloses [G, C]; the intersection with A's [G] governs, so the
  // target [G] is inside while C alone never is.
  const fixed = JSON.parse(fs.readFileSync(ledgerBFile, 'utf8'));
  fixed.grants.find((g) => g.id === 'grant-community-001').purpose.disclosureAudience = [FIXTURE_GROUP, FIXTURE_OUT_GROUP];
  const fixedFile = writeTmp('ledger-intersect.json', fixed);
  const inter = multiRequest();
  inter.operation.target.effectiveAudience.readers = [FIXTURE_GROUP];
  const interFile = writeTmp('req-inter.json', inter);
  const runInter = runCli(['decide', '--request', interFile, '--ledger', fixedFile, '--model', world.model, '--policy', world.policy, '--json']);
  assert.equal(runInter.status, 0, `target inside the two-source intersection must be allowed: ${runInter.stderr || runInter.stdout}`);
  assert.equal(parseJsonOut(runInter, 'decide').audience.rule, 'intersection');
});

test('pre-write recheck blocks drifted ground truth: ledger change, payload drift, receipt tamper, same-operation renewal', () => {
  const world = fixtureWorld();
  const request = writeTmp('req-recheck.json', validRequest());
  const decided = runCli(['decide', '--request', request, '--ledger', world.ledger, '--model', world.model, '--policy', world.policy, '--json']);
  assert.equal(decided.status, 0);
  const receipt = JSON.parse(decided.stdout);
  const decisionFile = writeTmp('decision-recheck.json', receipt);
  // Ground truth shifts: the source grant is revoked after the decision.
  const revoke = runCli(['revoke', '--grant', 'grant-pilot-001', '--ledger', world.ledger, '--model', world.model, '--as', OWNER_PRINCIPAL, '--reason', 'ACL shrunk before write', '--json']);
  assert.equal(revoke.status, 0);
  const stale = runCli(['recheck', '--decision', decisionFile, '--ledger', world.ledger, '--model', world.model, '--policy', world.policy, '--json']);
  assert.equal(stale.status, 2, 'the old publish verdict must be blocked by the pre-write recheck');
  const staleCodes = parseJsonOut(stale, 'recheck').reasons.map((r) => r.code);
  assert.ok(staleCodes.includes('LEDGER_CHANGED'), `expected LEDGER_CHANGED, got ${staleCodes}`);
  assert.ok(staleCodes.includes('GRANT_NO_LONGER_VALID'), `the revoked grant must fail re-verification, got ${staleCodes}`);
  // No renewal through the same operation: a fresh decide is now denied too.
  const again = runCli(['decide', '--request', request, '--ledger', world.ledger, '--model', world.model, '--policy', world.policy, '--json']);
  assert.equal(again.status, 2);
  assert.ok(parseJsonOut(again, 'decide').reasons.some((r) => r.code === 'GRANT_REVOKED'));
  // Payload drift between decision and write.
  const world2 = fixtureWorld();
  const request2 = writeTmp('req-payload.json', validRequest());
  const decided2 = runCli(['decide', '--request', request2, '--ledger', world2.ledger, '--model', world2.model, '--policy', world2.policy, '--json']);
  assert.equal(decided2.status, 0);
  const decision2 = writeTmp('decision-payload.json', JSON.parse(decided2.stdout));
  const drifted = runCli(['recheck', '--decision', decision2, '--ledger', world2.ledger, '--model', world2.model, '--policy', world2.policy, '--payload-digest', sha256('a different payload'), '--json']);
  assert.equal(drifted.status, 2);
  assert.equal(parseJsonOut(drifted, 'recheck').reasons[0].code, 'PAYLOAD_DRIFTED');
  // A tampered receipt (decidedAt edited) is detected by digest, not trusted.
  const tampered = structuredClone(JSON.parse(decided2.stdout));
  tampered.decidedAt = '2030-01-01T00:00:00Z';
  const tamperedFile = writeTmp('decision-tampered.json', tampered);
  const tamperRun = runCli(['recheck', '--decision', tamperedFile, '--ledger', world2.ledger, '--model', world2.model, '--policy', world2.policy, '--json']);
  assert.equal(tamperRun.status, 2);
  assert.equal(parseJsonOut(tamperRun, 'recheck').reasons[0].code, 'TAMPERED_DECISION');
});

test('fail-closed evidence gates: incomplete/error/service-only/unmapped permission evidence is never an empty set or public', () => {
  const world = fixtureWorld();
  const decideArgs = (requestFile) => ['decide', '--request', requestFile, '--ledger', world.ledger, '--model', world.model, '--policy', world.policy, '--json'];
  const expectDenial = (name, evidence, expectedCode) => {
    const request = writeTmp(`req-${name}.json`, validRequest({
      sources: [{ domain: 'sdd-harness-repo', permissionEvidence: evidence }],
    }));
    const run = runCli(decideArgs(request));
    assert.equal(run.status, 2, `${name} must be denied`);
    assert.ok(parseJsonOut(run, 'decide').reasons.some((r) => r.code === expectedCode), `${name}: expected ${expectedCode}, got ${run.stdout}`);
  };
  expectDenial('incomplete', { status: 'INCOMPLETE', exportedByServiceAccountOnly: false, unmappedPrincipals: [] }, 'PERMISSION_EVIDENCE_INCOMPLETE');
  expectDenial('error', { status: 'ERROR', exportedByServiceAccountOnly: false, unmappedPrincipals: [], error: '403 from permission API' }, 'PERMISSION_EVIDENCE_ERROR');
  expectDenial('service-only', { status: 'COMPLETE', exportedByServiceAccountOnly: true, unmappedPrincipals: [] }, 'SERVICE_ACCOUNT_READ_NOT_REPUBLICATION');
  expectDenial('unmapped', { status: 'COMPLETE', exportedByServiceAccountOnly: false, unmappedPrincipals: ['someone@extern.example'] }, 'PRINCIPAL_UNMAPPED');
  // Target-side: incomplete pagination and unmapped target principals.
  const targetIncomplete = writeTmp('req-target-incomplete.json', validRequest());
  const parsed = JSON.parse(fs.readFileSync(targetIncomplete, 'utf8'));
  parsed.operation.target.effectiveAudience.incompletePagination = true;
  fs.writeFileSync(targetIncomplete, JSON.stringify(parsed, null, 2));
  const runTarget = runCli(decideArgs(targetIncomplete));
  assert.equal(runTarget.status, 2);
  assert.ok(parseJsonOut(runTarget, 'decide').reasons.some((r) => r.code === 'TARGET_EVIDENCE_INCOMPLETE'));
  const targetUnmapped = writeTmp('req-target-unmapped.json', validRequest());
  const parsedUnmapped = JSON.parse(fs.readFileSync(targetUnmapped, 'utf8'));
  parsedUnmapped.operation.target.effectiveAudience.unmappedPrincipals = ['unmappable-principal'];
  fs.writeFileSync(targetUnmapped, JSON.stringify(parsedUnmapped, null, 2));
  const runUnmapped = runCli(decideArgs(targetUnmapped));
  assert.equal(runUnmapped.status, 2);
  assert.ok(parseJsonOut(runUnmapped, 'decide').reasons.some((r) => r.code === 'PRINCIPAL_UNMAPPED'));
});

test('audience enlargement surface (U05 semantics): allowlisted collection, but share/inheritance/public paths are refused; no ACL mutation entrance exists', () => {
  const world = fixtureWorld();
  const decideArgs = (requestFile) => ['decide', '--request', requestFile, '--ledger', world.ledger, '--model', world.model, '--policy', world.policy, '--json'];
  for (const audienceSource of ['page-share', 'subtree-share', 'public-share']) {
    const request = writeTmp(`req-share-${audienceSource}.json`, validRequest());
    const parsed = JSON.parse(fs.readFileSync(request, 'utf8'));
    parsed.operation.target.audienceSource = audienceSource;
    fs.writeFileSync(request, JSON.stringify(parsed, null, 2));
    const run = runCli(decideArgs(request));
    assert.equal(run.status, 2, `${audienceSource} must be refused even though the collection id is allowlisted`);
    assert.ok(parseJsonOut(run, 'decide').reasons.some((r) => r.code === 'TARGET_AUDIENCE_ENLARGED'));
  }
  // An effective audience beyond the intersection with the allowlisted collection.
  const widened = writeTmp('req-widened.json', validRequest());
  const parsedWidened = JSON.parse(fs.readFileSync(widened, 'utf8'));
  parsedWidened.operation.target.effectiveAudience.readers = [FIXTURE_GROUP, 'group:sdd-harness-pilot/guests'];
  fs.writeFileSync(widened, JSON.stringify(parsedWidened, null, 2));
  const runWidened = runCli(decideArgs(widened));
  assert.equal(runWidened.status, 2);
  assert.ok(parseJsonOut(runWidened, 'decide').reasons.some((r) => r.code === 'AUDIENCE_OUTSIDE_INTERSECTION'));
  // The tool has no ACL/membership/share mutation entrance at all.
  for (const cmd of ['acl', 'share', 'membership']) {
    const mutation = runCli([cmd, '--collection', 'outline-managed-collection', '--json']);
    assert.equal(mutation.status, 1, `no ${cmd} mutation entrance may exist`);
  }
  // Actions outside the preauthorization (share/delete/permission changes).
  for (const action of ['documents.share', 'documents.delete', 'acl.change']) {
    const request = writeTmp(`req-action-${action}.json`, validRequest());
    const parsed = JSON.parse(fs.readFileSync(request, 'utf8'));
    parsed.operation.action = action;
    fs.writeFileSync(request, JSON.stringify(parsed, null, 2));
    const run = runCli(decideArgs(request));
    assert.equal(run.status, 2, `${action} must be outside the preauthorized action set`);
    assert.ok(parseJsonOut(run, 'decide').reasons.some((r) => r.code === 'ACTION_NOT_PREAUTHORIZED'));
  }
});

test('self-authored inputs are refused as a class: inline grant, approved flag, author sensitivity label, PR merge field', () => {
  const world = fixtureWorld();
  const decideArgs = (requestFile) => ['decide', '--request', requestFile, '--ledger', world.ledger, '--model', world.model, '--policy', world.policy, '--json'];
  const inline = writeTmp('req-inline-grant.json', validRequest({
    grant: { id: 'grant-pilot-001', approved: true },
  }));
  const inlineRun = runCli(decideArgs(inline));
  assert.equal(inlineRun.status, 2, 'a request carrying its own grant is self-authorization');
  assert.equal(parseJsonOut(inlineRun, 'decide').reasons[0].code, 'SELF_AUTHORED_GRANT');
  const approved = writeTmp('req-approved.json', validRequest({ approved: true }));
  const approvedRun = runCli(decideArgs(approved));
  assert.equal(approvedRun.status, 2, 'an approved:true field is not an authorization');
  assert.equal(parseJsonOut(approvedRun, 'decide').reasons[0].code, 'SELF_AUTHORED_APPROVAL');
  const classified = writeTmp('req-classified.json', validRequest({ sensitivity: 'public' }));
  const classifiedRun = runCli(decideArgs(classified));
  assert.equal(classifiedRun.status, 2, 'the author cannot downgrade sensitivity by labeling');
  assert.equal(parseJsonOut(classifiedRun, 'decide').reasons[0].code, 'AUTHOR_CLASSIFICATION_FORBIDDEN');
  const pr = writeTmp('req-pr.json', validRequest({ mergedPr: 'rpamis/sdd-harness#99' }));
  const prRun = runCli(decideArgs(pr));
  assert.equal(prRun.status, 2, 'a merged PR is not an authorization');
  assert.equal(parseJsonOut(prRun, 'decide').reasons[0].code, 'UNKNOWN_REQUEST_FIELD');
});

test('input contract: unreadable files and unknown commands exit 1; structured output never leaks host paths', () => {
  const missing = runCli(['validate', '--model', path.join(scratchRoot, 'nope.json'), '--policy', path.join(knowledgeDir, 'preauthorization-policy.json'), '--ledger', path.join(knowledgeDir, 'grant-ledger.example.json'), '--json']);
  assert.equal(missing.status, 1);
  assert.equal(runCli(['frobnicate', '--json']).status, 1);
  const run = runCli(['validate',
    '--model', path.join(knowledgeDir, 'authorization-model.json'),
    '--policy', path.join(knowledgeDir, 'preauthorization-policy.json'),
    '--ledger', path.join(knowledgeDir, 'grant-ledger.example.json'),
    '--refs', refsPath, '--registry', registryPath, '--json']);
  assert.doesNotMatch(run.stdout, HOST_PATH_OUTPUT_RE);
});

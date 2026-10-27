// ReleaseProtocol.v1 — isolated-environment build and promotion protocol
// (delivery-foundation-rearchitecture, P4_2; acceptance A14/A16/A17/F09).
//
// tools/ci/release.mjs is the release-side executor that consumes the P4_1
// delivery gate's verified candidate and performs, against a real local
// isolated Registry/environment (directory form — the run holds no production
// or platform authorization, so real promotion/deployment stays honestly
// LOCAL_ONLY/UNVERIFIED):
//   - build from the exact integration merge SHA into a content-addressed
//     artifact (real sha256 over real source bytes), tag it in the isolated
//     Registry and refuse TAG_DIGEST_DRIFT (A14: a deployment tag pointing at
//     another digest never promotes; the actual identity mismatch is
//     recorded);
//   - deploy with a correlation-ID receipt and lock the same digest: a
//     repeated promotion of the deployed digest returns the existing receipt
//     and never issues a second deployment;
//   - reconcile a lost deployment response by the original correlation ID
//     (query first, bind the original result, never redeploy — A16);
//   - refuse unapproved rollbacks, refuse rollback to any digest other than
//     the retained previous approved one, and confirm an approved rollback
//     only through the independent business terminal state readback
//     (digest + environment + business state — A17).
//
// Every refusal code is code-by-code aligned with the accepted I06
// IntegrationIdentity evaluator (tools/infra/platform.mjs — not importable,
// it runs process.exit at module load, so the contract is mirrored and the
// layering is declared in the tool header). The chain each command emits via
// --chain-out is re-evaluated by the REAL platform.mjs
// `probe --case registry-environment-identity` subprocess: the executor's
// facts and the accepted evaluator's verdict must agree in both directions.
//
// All fixtures live under os.tmpdir(); no repository file is written. The
// local Registry/environment directories ARE the real thing under test.
import assert, { AssertionError } from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliPath = path.join(projectRoot, 'tools', 'ci', 'release.mjs');
const platformCli = path.join(projectRoot, 'tools', 'infra', 'platform.mjs');
const RUN_TIMEOUT_MS = 120_000;
const SHA = (label) => crypto.createHash('sha256').update(`sha-label-${label}`).digest('hex').slice(0, 40);
const DIGEST = (label) => `sha256:${crypto.createHash('sha256').update(label).digest('hex')}`;
const PROJECT = 'sdd-harness-pilot';

function childEnv(root) {
  const env = { ...process.env, HOME: root, TMPDIR: root, PATH: '/usr/bin:/bin' };
  delete env.NODE_TEST_CONTEXT;
  return env;
}

function runRelease(args, root) {
  return spawnSync(process.execPath, [cliPath, ...args, '--json'], {
    cwd: projectRoot, encoding: 'utf8', timeout: RUN_TIMEOUT_MS, env: childEnv(root),
  });
}

function runPlatformProbe(chainFile, root) {
  return spawnSync(process.execPath, [platformCli, 'probe', '--case', 'registry-environment-identity', '--chain', chainFile, '--json'], {
    cwd: projectRoot, encoding: 'utf8', timeout: RUN_TIMEOUT_MS, env: childEnv(root),
  });
}

function parseJson(result, label) {
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new AssertionError({ message: `${label}: stdout is not JSON\nstdout: ${result.stdout}\nstderr: ${result.stderr}` });
  }
}

// --- fixtures ------------------------------------------------------------

function writeSource(root, name, version) {
  const dir = path.join(root, name);
  fs.mkdirSync(path.join(dir, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'app.js'), `// release fixture ${version}\nconsole.log("${version}");\n`);
  fs.writeFileSync(path.join(dir, 'lib', 'util.js'), `export const version = "${version}";\n`);
  return dir;
}

function chainFixture({ merge = SHA('m1'), head = SHA('h1'), overrides = {} } = {}) {
  return {
    project: PROJECT,
    head,
    merge,
    requiredChecks: ['delivery-gate', 'release-protocol'],
    checks: [
      { name: 'delivery-gate', boundSha: merge, conclusion: 'success' },
      { name: 'release-protocol', boundSha: merge, conclusion: 'success' },
    ],
    ...overrides,
  };
}

function writeJson(root, name, value) {
  const file = path.join(root, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
  return file;
}

function makeEnvironment(root, { project = PROJECT, registered = true } = {}) {
  const dir = path.join(root, 'env');
  fs.mkdirSync(dir, { recursive: true });
  if (registered) {
    writeJson(dir, 'registration.json', {
      schemaVersion: 1,
      interface: 'Environment.v1',
      environment: {
        id: 'isolated-local-env-1',
        project,
        rollback: {
          approvalRequired: true,
          sameDigestRequired: true,
          retainLastApprovedArtifact: true,
          independentBusinessTerminalStateRequired: true,
        },
        readbackOracle: { kind: 'independent-business-readback', correlationIdRequired: true },
      },
      localOnly: true,
    });
  }
  return dir;
}

function makeRegistry(root) {
  const dir = path.join(root, 'registry');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function promoteArgs({ root, chain, source, tag = 'stable', chainOut = null }) {
  const chainFile = chain instanceof Object ? writeJson(root, `chain-${path.basename(source)}.json`, chain) : chain;
  const args = ['promote', '--chain', chainFile, '--source', source, '--tag', tag,
    '--registry', makeRegistry(root), '--environment', makeEnvironment(root)];
  if (chainOut) args.push('--chain-out', path.join(root, chainOut));
  return { args, root };
}

function ledgerRecords(envDir) {
  const deployments = path.join(envDir, 'deployments');
  if (!fs.existsSync(deployments)) return [];
  return fs.readdirSync(deployments).filter((f) => f.endsWith('.json')).sort();
}

function businessState(envDir) {
  const file = path.join(envDir, 'business', 'state.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

// --- suite ---------------------------------------------------------------

test('setup: the release protocol tool exists and declares its contract layering', () => {
  assert.equal(fs.statSync(cliPath).isFile(), true);
  const source = fs.readFileSync(cliPath, 'utf8');
  assert.match(source, /ReleaseProtocol\.v1/, 'the tool must declare its interface');
  assert.match(source, /tools\/infra\/platform\.mjs/, 'the header must declare the I06 layering');
  assert.match(source, /ISOLATED_RELEASE_ENVIRONMENT_REQUIRED/, 'the named precondition must be carried');
  for (const code of ['TAG_DIGEST_DRIFT', 'DEPLOYMENT_DIGEST_MISMATCH', 'READBACK_CORRELATION_MISMATCH',
    'READBACK_UNCONFIRMED', 'ROLLBACK_NOT_APPROVED', 'ROLLBACK_DIGEST_MISMATCH', 'ROLLBACK_TERMINAL_STATE_UNCONFIRMED']) {
    assert.ok(source.includes(code), `I06-aligned code ${code} must exist in the tool`);
  }
  assert.match(source, /LOCAL_ONLY/, 'the LOCAL_ONLY honesty scope must be declared');
});

test('V_A14/V_F09 positive: isolated build and promotion lock one digest through tag, deployment receipt and business readback; I06 independently verifies the emitted chain', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p4-2-promote-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = writeSource(root, 'src-v1', 'v1');
  const { args } = promoteArgs({ root, chain: chainFixture(), source, chainOut: 'chain-out.json' });
  const result = runRelease(args, root);
  const receipt = parseJson(result, 'promote');
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  assert.equal(receipt.interface, 'ReleaseProtocol.v1');
  assert.equal(receipt.status, 'VERIFIED');
  assert.equal(receipt.artifact.builtFromMerge, SHA('m1'), 'the build identity is the exact integration merge SHA');
  const digest = receipt.artifact.digest;
  assert.match(digest, /^sha256:[0-9a-f]{64}$/);
  assert.ok(receipt.deployment.receipt.correlationId, 'the deployment receipt carries a correlation ID');
  assert.equal(receipt.deployment.deployed, true);

  const registry = path.join(root, 'registry');
  const envDir = path.join(root, 'env');
  assert.equal(fs.readFileSync(path.join(registry, 'refs', 'tags', 'stable'), 'utf8').trim(), digest, 'the tag resolves to the built digest');
  assert.equal(fs.existsSync(path.join(registry, 'blobs', 'sha256', digest.slice(7))), true, 'the artifact is content-addressed in the Registry');
  assert.equal(JSON.parse(fs.readFileSync(path.join(envDir, 'active.json'), 'utf8')).artifactDigest, digest);
  assert.equal(ledgerRecords(envDir).length, 1, 'exactly one deployment exists');
  assert.equal(businessState(envDir).serving, digest, 'the business terminal state serves the promoted digest');
  assert.equal(receipt.readback.observed.businessTerminalState.serving, digest, 'the readback observed the business terminal state independently');

  // F09: the emitted chain re-evaluated by the accepted I06 evaluator agrees.
  const probe = runPlatformProbe(path.join(root, 'chain-out.json'), root);
  const verdict = parseJson(probe, 'I06 probe');
  assert.equal(probe.status, 0, `I06 stderr: ${probe.stderr}`);
  assert.equal(verdict.status, 'VERIFIED');

  // The build is deterministic: the same source in a fresh Registry yields the same digest.
  const root2 = fs.mkdtempSync(path.join(os.tmpdir(), 'p4-2-determinism-'));
  t.after(() => fs.rmSync(root2, { recursive: true, force: true }));
  const source2 = writeSource(root2, 'src-v1', 'v1');
  const again = parseJson(runRelease(promoteArgs({ root: root2, chain: chainFixture(), source: source2 }).args, root2), 'rebuild');
  assert.equal(again.artifact.digest, digest, 'the same inputs must always build the same artifact digest');
});

test('V_A14 negative: tag drift is refused with the actual identity mismatch recorded and nothing changes', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p4-2-drift-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourceV1 = writeSource(root, 'src-v1', 'v1');
  const first = parseJson(runRelease(promoteArgs({ root, chain: chainFixture(), source: sourceV1, chainOut: 'chain-v1.json' }).args, root), 'promote v1');
  assert.equal(first.status, 'VERIFIED');
  const digestV1 = first.artifact.digest;

  const activeBefore = fs.readFileSync(path.join(root, 'env', 'active.json'), 'utf8');
  const ledgerBefore = ledgerRecords(path.join(root, 'env'));

  // Real out-of-band drift: the deployment tag is repointed behind the
  // protocol's back, away from the digest the environment actually serves.
  const outOfBand = DIGEST('out-of-band-repoint');
  fs.writeFileSync(path.join(root, 'registry', 'refs', 'tags', 'stable'), `${outOfBand}\n`);

  // New candidate (new head/merge, checks bound to the new merge).
  const sourceV2 = writeSource(root, 'src-v2', 'v2');
  const drifted = runRelease(
    promoteArgs({ root, chain: chainFixture({ merge: SHA('m2'), head: SHA('h2') }), source: sourceV2, chainOut: 'chain-drift.json' }).args,
    root,
  );
  const refusal = parseJson(drifted, 'drift refusal');
  assert.equal(drifted.status, 2, 'a drifted tag must never promote');
  assert.equal(refusal.status, 'BLOCKED');
  assert.ok(refusal.codes.includes('TAG_DIGEST_DRIFT'), `codes: ${JSON.stringify(refusal.codes)}`);
  assert.equal(refusal.artifact.tagResolvedDigest, outOfBand, 'the refusal records the digest the tag actually resolves to');
  assert.equal(refusal.artifact.expectedDigest, digestV1, 'the refusal records the digest the environment actually serves');
  assert.notEqual(refusal.artifact.digest, outOfBand, 'the refusal records the actually built digest');
  assert.equal(fs.readFileSync(path.join(root, 'env', 'active.json'), 'utf8'), activeBefore, 'no deployment state changed');
  assert.deepEqual(ledgerRecords(path.join(root, 'env')), ledgerBefore, 'no deployment was written');

  // The accepted I06 evaluator independently blocks the same world.
  const probe = runPlatformProbe(path.join(root, 'chain-drift.json'), root);
  const verdict = parseJson(probe, 'I06 probe (drift)');
  assert.equal(probe.status, 2);
  assert.equal(verdict.blocked, true);
  assert.ok(verdict.codes.includes('TAG_DIGEST_DRIFT'), `I06 codes: ${JSON.stringify(verdict.codes)}`);
});

test('same-digest lock: re-promoting the deployed digest returns the existing receipt and never deploys again', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p4-2-lock-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = writeSource(root, 'src-v1', 'v1');
  const first = parseJson(runRelease(promoteArgs({ root, chain: chainFixture(), source }).args, root), 'promote 1');
  assert.equal(first.status, 'VERIFIED');

  const second = parseJson(runRelease(promoteArgs({ root, chain: chainFixture(), source }).args, root), 'promote 2');
  assert.equal(second.status, 'VERIFIED');
  assert.equal(second.deployment.deployed, false, 'no second deployment was issued');
  assert.equal(second.deployment.idempotent, true, 'the existing receipt was returned');
  assert.equal(second.deployment.receipt.correlationId, first.deployment.receipt.correlationId, 'the same correlation ID is bound');
  assert.equal(ledgerRecords(path.join(root, 'env')).length, 1, 'the ledger still holds exactly one deployment');
});

test('V_A16 positive: a lost deployment response is reconciled by the original correlation ID — the original result is bound, never redeployed', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p4-2-reconcile-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = writeSource(root, 'src-v1', 'v1');
  // The caller loses the response; the environment ledger holds the succeeded deployment.
  const promoteResult = runRelease(promoteArgs({ root, chain: chainFixture(), source, chainOut: 'chain-v1.json' }).args, root);
  assert.equal(promoteResult.status, 0);
  const active = JSON.parse(fs.readFileSync(path.join(root, 'env', 'active.json'), 'utf8'));
  const original = JSON.parse(fs.readFileSync(path.join(root, 'env', 'deployments', `${active.correlationId}.json`), 'utf8'));

  const result = runRelease(
    ['reconcile', '--chain', path.join(root, 'chain-v1.json'), '--registry', path.join(root, 'registry'),
      '--environment', path.join(root, 'env'), '--correlation-id', active.correlationId,
      '--chain-out', path.join(root, 'chain-reconciled.json')],
    root,
  );
  const reconciled = parseJson(result, 'reconcile');
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  assert.equal(reconciled.status, 'VERIFIED');
  assert.equal(reconciled.found, true);
  assert.equal(reconciled.deployment.receipt.correlationId, active.correlationId, 'the original receipt is bound');
  assert.equal(reconciled.deployment.receipt.requestedAt, original.requestedAt, 'the original deployment result, not a new one');
  assert.equal(reconciled.deployment.deployed, false, 'reconciliation never redeploys');
  assert.equal(ledgerRecords(path.join(root, 'env')).length, 1, 'still exactly one deployment');

  // I06 evaluates the reconciled chain through the query-by-correlation-ID path.
  const probe = runPlatformProbe(path.join(root, 'chain-reconciled.json'), root);
  const i06 = parseJson(probe, 'I06 probe (reconcile)');
  assert.equal(probe.status, 0);
  assert.equal(i06.status, 'VERIFIED');
  const readbackStep = i06.steps.find((step) => step.step === 'readback');
  assert.equal(readbackStep.via, 'QUERY_BY_CORRELATION_ID', 'the chain declares the query semantics');
});

test('V_A16 negative: an unknown correlation ID is answered UNCONFIRMED — the query runs first and nothing is deployed', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p4-2-unknown-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = writeSource(root, 'src-v1', 'v1');
  assert.equal(runRelease(promoteArgs({ root, chain: chainFixture(), source, chainOut: 'chain-v1.json' }).args, root).status, 0);
  const before = ledgerRecords(path.join(root, 'env'));

  const result = runRelease(
    ['reconcile', '--chain', path.join(root, 'chain-v1.json'), '--registry', path.join(root, 'registry'),
      '--environment', path.join(root, 'env'), '--correlation-id', crypto.randomUUID()],
    root,
  );
  const verdict = parseJson(result, 'reconcile unknown');
  assert.equal(result.status, 2, 'an unconfirmed query is never a pass');
  assert.equal(verdict.status, 'UNVERIFIED');
  assert.equal(verdict.found, false);
  assert.ok(verdict.codes.includes('READBACK_UNCONFIRMED'), `codes: ${JSON.stringify(verdict.codes)}`);
  assert.deepEqual(ledgerRecords(path.join(root, 'env')), before, 'an uncertain query never triggers a deployment');
});

test('V_F09 negative: a deployment record whose digest diverges from the tag resolution is DEPLOYMENT_DIGEST_MISMATCH', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p4-2-digest-mismatch-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = writeSource(root, 'src-v1', 'v1');
  assert.equal(runRelease(promoteArgs({ root, chain: chainFixture(), source, chainOut: 'chain-v1.json' }).args, root).status, 0);
  const active = JSON.parse(fs.readFileSync(path.join(root, 'env', 'active.json'), 'utf8'));
  // Real record/registry divergence: the ledger record no longer carries the digest the tag resolves to.
  const recordFile = path.join(root, 'env', 'deployments', `${active.correlationId}.json`);
  const record = JSON.parse(fs.readFileSync(recordFile, 'utf8'));
  record.artifactDigest = DIGEST('some-other-artifact');
  fs.writeFileSync(recordFile, JSON.stringify(record, null, 2));

  const result = runRelease(
    ['reconcile', '--chain', path.join(root, 'chain-v1.json'), '--registry', path.join(root, 'registry'),
      '--environment', path.join(root, 'env'), '--correlation-id', active.correlationId],
    root,
  );
  const verdict = parseJson(result, 'reconcile diverged');
  assert.equal(result.status, 2);
  assert.ok(verdict.codes.includes('DEPLOYMENT_DIGEST_MISMATCH'), `codes: ${JSON.stringify(verdict.codes)}`);
  assert.equal(ledgerRecords(path.join(root, 'env')).length, 1, 'the divergent record is never silently redeployed');
});

test('V_A17 negative: an unapproved rollback is refused, changes nothing, and I06 independently blocks it', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p4-2-unapproved-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourceV1 = writeSource(root, 'src-v1', 'v1');
  const sourceV2 = writeSource(root, 'src-v2', 'v2');
  const first = parseJson(runRelease(promoteArgs({ root, chain: chainFixture(), source: sourceV1 }).args, root), 'promote v1');
  assert.equal(runRelease(promoteArgs({ root, chain: chainFixture({ merge: SHA('m2'), head: SHA('h2') }), source: sourceV2, chainOut: 'chain-v2.json' }).args, root).status, 0);
  const activeBefore = fs.readFileSync(path.join(root, 'env', 'active.json'), 'utf8');

  const result = runRelease(
    ['rollback', '--chain', path.join(root, 'chain-v2.json'), '--registry', path.join(root, 'registry'),
      '--environment', path.join(root, 'env'), '--digest', first.artifact.digest,
      '--chain-out', path.join(root, 'chain-rollback-refused.json')],
    root,
  );
  const verdict = parseJson(result, 'unapproved rollback');
  assert.equal(result.status, 2);
  assert.equal(verdict.status, 'BLOCKED');
  assert.ok(verdict.codes.includes('ROLLBACK_NOT_APPROVED'), `codes: ${JSON.stringify(verdict.codes)}`);
  assert.equal(fs.readFileSync(path.join(root, 'env', 'active.json'), 'utf8'), activeBefore, 'the refusal changed nothing');

  const probe = runPlatformProbe(path.join(root, 'chain-rollback-refused.json'), root);
  const i06 = parseJson(probe, 'I06 probe (unapproved rollback)');
  assert.equal(probe.status, 2);
  assert.ok(i06.codes.includes('ROLLBACK_NOT_APPROVED'), `I06 codes: ${JSON.stringify(i06.codes)}`);
});

test('V_A17 negative: an approval for another digest is ROLLBACK_DIGEST_MISMATCH; an approval for another environment is ROLLBACK_NOT_APPROVED', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p4-2-approval-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourceV1 = writeSource(root, 'src-v1', 'v1');
  const sourceV2 = writeSource(root, 'src-v2', 'v2');
  assert.equal(runRelease(promoteArgs({ root, chain: chainFixture(), source: sourceV1 }).args, root).status, 0);
  assert.equal(runRelease(promoteArgs({ root, chain: chainFixture({ merge: SHA('m2'), head: SHA('h2') }), source: sourceV2, chainOut: 'chain-v2.json' }).args, root).status, 0);
  const activeBefore = fs.readFileSync(path.join(root, 'env', 'active.json'), 'utf8');
  const rollbackArgs = (approvalFile, digest) => ['rollback', '--chain', path.join(root, 'chain-v2.json'), '--registry', path.join(root, 'registry'),
    '--environment', path.join(root, 'env'), '--digest', digest, '--approval', approvalFile];

  const wrongDigest = writeJson(root, 'approval-wrong-digest.json', {
    schemaVersion: 1, interface: 'RollbackApproval.v1',
    digest: DIGEST('never-built'), environment: 'isolated-local-env-1', approver: 'release-owner', approvedAt: '2026-10-21T00:00:00.000Z',
  });
  const mismatch = runRelease(rollbackArgs(wrongDigest, DIGEST('never-built')), root);
  const mismatchVerdict = parseJson(mismatch, 'rollback wrong digest');
  assert.equal(mismatch.status, 2);
  assert.ok(mismatchVerdict.codes.includes('ROLLBACK_DIGEST_MISMATCH'), `codes: ${JSON.stringify(mismatchVerdict.codes)}`);

  const wrongEnv = writeJson(root, 'approval-wrong-env.json', {
    schemaVersion: 1, interface: 'RollbackApproval.v1',
    digest: DIGEST('never-built'), environment: 'some-other-env', approver: 'release-owner', approvedAt: '2026-10-21T00:00:00.000Z',
  });
  const foreign = runRelease(rollbackArgs(wrongEnv, DIGEST('never-built')), root);
  const foreignVerdict = parseJson(foreign, 'rollback wrong environment');
  assert.equal(foreign.status, 2);
  assert.ok(foreignVerdict.codes.includes('ROLLBACK_NOT_APPROVED'), `codes: ${JSON.stringify(foreignVerdict.codes)}`);
  assert.equal(fs.readFileSync(path.join(root, 'env', 'active.json'), 'utf8'), activeBefore, 'refusals change nothing');
});

test('V_A17 positive: the approved same-digest rollback reads back digest, environment and business terminal state; I06 verifies the chain', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p4-2-rollback-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourceV1 = writeSource(root, 'src-v1', 'v1');
  const sourceV2 = writeSource(root, 'src-v2', 'v2');
  const first = parseJson(runRelease(promoteArgs({ root, chain: chainFixture(), source: sourceV1 }).args, root), 'promote v1');
  assert.equal(runRelease(promoteArgs({ root, chain: chainFixture({ merge: SHA('m2'), head: SHA('h2') }), source: sourceV2, chainOut: 'chain-v2.json' }).args, root).status, 0);

  const approval = writeJson(root, 'approval.json', {
    schemaVersion: 1, interface: 'RollbackApproval.v1',
    digest: first.artifact.digest, environment: 'isolated-local-env-1', approver: 'release-owner', approvedAt: '2026-10-21T00:00:00.000Z',
  });
  const result = runRelease(
    ['rollback', '--chain', path.join(root, 'chain-v2.json'), '--registry', path.join(root, 'registry'),
      '--environment', path.join(root, 'env'), '--digest', first.artifact.digest, '--approval', approval,
      '--chain-out', path.join(root, 'chain-rollback.json')],
    root,
  );
  const verdict = parseJson(result, 'rollback');
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  assert.equal(verdict.status, 'VERIFIED');
  assert.equal(verdict.rollback.digest, first.artifact.digest, 'the readback carries the rollback digest');
  assert.equal(verdict.rollback.observed.businessTerminalState.serving, first.artifact.digest, 'the business terminal state serves the rolled-back digest');
  assert.equal(verdict.rollback.observed.environment, 'isolated-local-env-1', 'the readback carries the environment');
  assert.equal(businessState(path.join(root, 'env')).serving, first.artifact.digest);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'env', 'active.json'), 'utf8')).artifactDigest, first.artifact.digest);

  const probe = runPlatformProbe(path.join(root, 'chain-rollback.json'), root);
  const i06 = parseJson(probe, 'I06 probe (rollback)');
  assert.equal(probe.status, 0, `I06 stderr: ${probe.stderr}`);
  assert.equal(i06.status, 'VERIFIED');
});

test('V_A17 negative: a rollback whose business terminal state cannot be observed stays UNCONFIRMED', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p4-2-rollback-unconf-'));
  t.after(() => {
    const business = path.join(root, 'env', 'business');
    if (fs.existsSync(business)) fs.chmodSync(business, 0o755);
    fs.rmSync(root, { recursive: true, force: true });
  });
  const sourceV1 = writeSource(root, 'src-v1', 'v1');
  const sourceV2 = writeSource(root, 'src-v2', 'v2');
  const first = parseJson(runRelease(promoteArgs({ root, chain: chainFixture(), source: sourceV1 }).args, root), 'promote v1');
  assert.equal(runRelease(promoteArgs({ root, chain: chainFixture({ merge: SHA('m2'), head: SHA('h2') }), source: sourceV2, chainOut: 'chain-v2.json' }).args, root).status, 0);

  // The environment can no longer apply the business effect: the rollback must stay honest.
  fs.chmodSync(path.join(root, 'env', 'business'), 0o555);
  const approval = writeJson(root, 'approval.json', {
    schemaVersion: 1, interface: 'RollbackApproval.v1',
    digest: first.artifact.digest, environment: 'isolated-local-env-1', approver: 'release-owner', approvedAt: '2026-10-21T00:00:00.000Z',
  });
  const result = runRelease(
    ['rollback', '--chain', path.join(root, 'chain-v2.json'), '--registry', path.join(root, 'registry'),
      '--environment', path.join(root, 'env'), '--digest', first.artifact.digest, '--approval', approval],
    root,
  );
  const verdict = parseJson(result, 'rollback unconfirmed');
  assert.equal(result.status, 2);
  assert.equal(verdict.status, 'UNVERIFIED');
  assert.ok(verdict.codes.includes('ROLLBACK_TERMINAL_STATE_UNCONFIRMED'), `codes: ${JSON.stringify(verdict.codes)}`);
});

test('rollback without a retained previous approved artifact is ROLLBACK_RETENTION_MISSING', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p4-2-retention-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = writeSource(root, 'src-v1', 'v1');
  const promoted = parseJson(runRelease(promoteArgs({ root, chain: chainFixture(), source, chainOut: 'chain-v1.json' }).args, root), 'promote');
  const approval = writeJson(root, 'approval.json', {
    schemaVersion: 1, interface: 'RollbackApproval.v1',
    digest: promoted.artifact.digest, environment: 'isolated-local-env-1', approver: 'release-owner', approvedAt: '2026-10-21T00:00:00.000Z',
  });
  const result = runRelease(['rollback', '--chain', path.join(root, 'chain-v1.json'), '--registry', path.join(root, 'registry'),
    '--environment', path.join(root, 'env'), '--digest', promoted.artifact.digest, '--approval', approval], root);
  const verdict = parseJson(result, 'rollback no retention');
  assert.equal(result.status, 2);
  assert.ok(verdict.codes.includes('ROLLBACK_RETENTION_MISSING'), `codes: ${JSON.stringify(verdict.codes)}`);
});

test('ISOLATED_RELEASE_ENVIRONMENT_REQUIRED: an unregistered environment blocks the release action — nothing is deployed, the plan shape never substitutes for registration', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p4-2-unregistered-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = writeSource(root, 'src-v1', 'v1');
  const registry = makeRegistry(root);
  const envDir = makeEnvironment(root, { registered: false });
  const chainFile = writeJson(root, 'chain.json', chainFixture());

  const result = runRelease(['promote', '--chain', chainFile, '--source', source,
    '--tag', 'stable', '--registry', registry, '--environment', envDir], root);
  const verdict = parseJson(result, 'promote unregistered');
  assert.equal(result.status, 2);
  assert.ok(verdict.codes.includes('ISOLATED_RELEASE_ENVIRONMENT_REQUIRED'), `codes: ${JSON.stringify(verdict.codes)}`);
  assert.equal(fs.existsSync(path.join(envDir, 'active.json')), false, 'no deployment binding was written');
  assert.equal(fs.existsSync(path.join(envDir, 'deployments')), false, 'no deployment record was written');

  // The precondition blocks exactly the environment-dependent actions; the refusal is reported, never faked.
  const rollback = runRelease(['rollback', '--chain', chainFile, '--registry', registry,
    '--environment', envDir, '--digest', DIGEST('x')], root);
  assert.equal(rollback.status, 2);
  assert.ok(parseJson(rollback, 'rollback unregistered').codes.includes('ISOLATED_RELEASE_ENVIRONMENT_REQUIRED'));
});

test('ENVIRONMENT_PROJECT_MISMATCH: an environment registered to another project is refused with the I06 code', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p4-2-project-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = writeSource(root, 'src-v1', 'v1');
  const registry = makeRegistry(root);
  const envDir = makeEnvironment(root, { project: 'some-other-project' });
  const result = runRelease(['promote', '--chain', writeJson(root, 'chain.json', chainFixture()), '--source', source,
    '--tag', 'stable', '--registry', registry, '--environment', envDir], root);
  const verdict = parseJson(result, 'promote foreign project');
  assert.equal(result.status, 2);
  assert.ok(verdict.codes.includes('ENVIRONMENT_PROJECT_MISMATCH'), `codes: ${JSON.stringify(verdict.codes)}`);
  assert.equal(fs.existsSync(path.join(envDir, 'active.json')), false);
});

test('ARTIFACT_NOT_FROM_MERGE: a chain whose artifact claims another merge is refused before any write', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p4-2-not-from-merge-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = writeSource(root, 'src-v1', 'v1');
  const chain = chainFixture({ overrides: { artifact: { digest: DIGEST('claimed'), tagResolvedDigest: DIGEST('claimed'), builtFromMerge: SHA('other') } } });
  const result = runRelease(['promote', '--chain', writeJson(root, 'chain.json', chain), '--source', source,
    '--tag', 'stable', '--registry', makeRegistry(root), '--environment', makeEnvironment(root)], root);
  const verdict = parseJson(result, 'not from merge');
  assert.equal(result.status, 2);
  assert.ok(verdict.codes.includes('ARTIFACT_NOT_FROM_MERGE'), `codes: ${JSON.stringify(verdict.codes)}`);
  assert.equal(fs.existsSync(path.join(root, 'env', 'active.json')), false);

  // A claimed digest that contradicts what the source actually builds is an inconsistent input (exit 1).
  const inconsistent = chainFixture({ overrides: { artifact: { digest: DIGEST('claimed'), tagResolvedDigest: DIGEST('claimed'), builtFromMerge: SHA('m1') } } });
  const bad = runRelease(['promote', '--chain', writeJson(root, 'chain-bad.json', inconsistent), '--source', source,
    '--tag', 'stable', '--registry', makeRegistry(root), '--environment', makeEnvironment(root)], root);
  assert.equal(bad.status, 1, 'contradictory input facts are input errors, never semantic verdicts');
});

test('input contract: malformed chains and arguments are input errors (exit 1) reported by the tool itself, never semantic verdicts', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p4-2-input-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = writeSource(root, 'src-v1', 'v1');
  const env = makeEnvironment(root);
  const registry = makeRegistry(root);
  const badHead = runRelease(['promote', '--chain', writeJson(root, 'c1.json', chainFixture({ merge: 'not-a-sha' })), '--source', source, '--tag', 'stable', '--registry', registry, '--environment', env], root);
  assert.equal(badHead.status, 1);
  assert.match(badHead.stderr, /merge must be a 40-hex SHA/, 'the tool names the malformed field itself');
  const noChecks = runRelease(['promote', '--chain', writeJson(root, 'c2.json', chainFixture({ overrides: { requiredChecks: [] } })), '--source', source, '--tag', 'stable', '--registry', registry, '--environment', env], root);
  assert.equal(noChecks.status, 1);
  assert.match(noChecks.stderr, /requiredChecks must be a non-empty array/, 'the tool names the empty check set itself');
  const noChain = runRelease(['promote', '--source', source, '--tag', 'stable', '--registry', registry, '--environment', env], root);
  assert.equal(noChain.status, 1, 'missing --chain is an input error');
  assert.match(noChain.stderr, /--chain is required/, 'the tool names the missing argument itself');
  const unknown = runRelease(['bogus-command'], root);
  assert.equal(unknown.status, 1, 'unknown command is an input error');
  assert.match(unknown.stderr, /unknown command: bogus-command/, 'the tool names the unknown command itself');
});

test('receipt honesty: structured output stays LOCAL_ONLY, carries the production-successor note and leaks no host private paths', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p4-2-honesty-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = writeSource(root, 'src-v1', 'v1');
  const promoted = runRelease(promoteArgs({ root, chain: chainFixture(), source }).args, root);
  const receipt = parseJson(promoted, 'promote');
  assert.equal(receipt.mode, 'LOCAL_ONLY');
  assert.match(receipt.note, /LOCAL_ONLY/, 'the receipt must scope its claim to the local isolated form');
  assert.match(receipt.note, /UNVERIFIED|environment owner|runtime admission/i, 'real production promotion must stay honestly unverified with a successor');
  const drifted = parseJson(runRelease(
    promoteArgs({ root, chain: chainFixture({ merge: SHA('m2'), head: SHA('h2') }), source: writeSource(root, 'src-v2', 'v2') }).args, root,
  ), 'drift');
  for (const payload of [receipt, drifted]) {
    assert.doesNotMatch(JSON.stringify(payload), /\/Users\//, 'host private paths never appear in structured output');
  }
});

// ---------------------------------------------------------------------------
// foundation-distribution release surface (revision 2026-10-26-comet-050-
// adoption-v1). This scaffold IS the distribution producer: deployment
// semantics = build/publish/rollback of the foundation-export distribution
// package. The chain under test:
//   build   — the real exporter (tools/foundation-export.mjs, subprocess)
//             freezes the distribution at an exportDigest and seals a
//             content-addressed baseline under foundation/baselines/<digest>;
//   publish — tools/ci/release.mjs foundation-promote locks ONE digest end to
//             end: the recomputed live build must equal the committed lock
//             (BUILD_DIGEST_DRIFT), the supply build fingerprint of the pinned
//             runner is bound into the release record, the publication
//             protocols registry must be registered
//             (RELEASE_PROTOCOLS_UNREGISTERED) and every remote leg stays
//             honestly UNVERIFIED; the promotion binds tag → exportDigest →
//             active release → independent distribution readback;
//   rollback — only the retained previous approved exportDigest is a legal
//             target, and only when its sealed baseline still resolves
//             byte-for-byte from the multi-version baselines directory
//             (ROLLBACK_BASELINE_UNRESOLVABLE otherwise).
// The negative red lines mirror the isolated-environment surface: tag drift
// never promotes (TAG_DIGEST_DRIFT), an unknown deployment result is queried
// by its original correlation ID and never re-released
// (READBACK_UNCONFIRMED), wrong digests never roll back
// (ROLLBACK_DIGEST_MISMATCH).
// ---------------------------------------------------------------------------

const exporterPath = path.join(projectRoot, 'tools', 'foundation-export.mjs');
const committedProtocolsPath = path.join(projectRoot, 'openspec', 'changes', 'delivery-foundation-rearchitecture', 'release-journey', 'release-protocols.json');
const FX_PROJECT = 'fdn-release-project';
const FX_COMMIT = (label) => crypto.createHash('sha256').update(`fx-commit-${label}`).digest('hex').slice(0, 40);

function makeFoundationRoot(version = 'v1') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p4-2-fdn-'));
  fs.mkdirSync(path.join(root, '.agents/skills/alpha'), { recursive: true });
  fs.writeFileSync(path.join(root, '.agents/skills/alpha/SKILL.md'), `# alpha ${version}\n`);
  fs.mkdirSync(path.join(root, '.agents/skills/beta/references'), { recursive: true });
  fs.writeFileSync(path.join(root, '.agents/skills/beta/SKILL.md'), `# beta ${version}\n`);
  fs.writeFileSync(path.join(root, '.agents/skills/beta/references/deep.md'), `beta ref ${version}\n`);
  fs.writeFileSync(path.join(root, 'hooks.yaml'), ['policies:', '  - id: dangerous-command-blocklist', '    hook: PreToolUse', '    matcher: Bash', '    action: deny', '    patterns:', '      - "git push --force"', '    message: "blocked"'].join('\n') + '\n');
  writeJson(root, '.mcp.json', { mcpServers: { probe: { command: 'npx', args: ['-y', 'probe-mcp@1.2.3'] } } });
  writeJson(root, 'package.json', { name: 'fdn-fixture', version: '1.0.0' });
  writeJson(root, 'integrations/comet/upstream.lock.json', {
    schemaVersion: 1,
    package: { name: '@rpamis/comet', version: '0.5.0' },
    source: { commit: FX_COMMIT('comet'), sha256: crypto.createHash('sha256').update(`archive-${version}`).digest('hex') },
    toolchain: { node: '24.15.0', pnpm: '10.18.3' },
    patches: [{ path: 'integrations/comet/patches/0005.patch', sha256: crypto.createHash('sha256').update(`patch-${version}`).digest('hex') }],
  });
  writeJson(root, 'openspec/changes/delivery-foundation-rearchitecture/method-profile-manifest.json', {
    schema_version: 1,
    method_profile: { controller: 'fixture-profile' },
  });
  return root;
}

function runExporter(root, commit) {
  return spawnSync(process.execPath, [exporterPath, 'export', '--root', root, '--out', path.join(root, 'foundation'),
    '--release-commit', commit, '--freeze-baseline'], { cwd: projectRoot, encoding: 'utf8', timeout: RUN_TIMEOUT_MS, env: childEnv(root) });
}

function makeLedger(root, { project = FX_PROJECT, registered = true } = {}) {
  const dir = path.join(root, 'ledger');
  fs.mkdirSync(dir, { recursive: true });
  if (registered) {
    writeJson(dir, 'registration.json', {
      schemaVersion: 1,
      interface: 'DistributionLedger.v1',
      distribution: {
        id: 'foundation-local-1',
        project,
        rollback: { approvalRequired: true, sameDigestRequired: true, retainPreviousApproved: true },
        readbackOracle: { kind: 'independent-distribution-readback', correlationIdRequired: true },
      },
      localOnly: true,
    });
  }
  return dir;
}

function makeProtocols(root, { project = FX_PROJECT, name = 'protocols.json' } = {}) {
  return writeJson(root, name, {
    schemaVersion: 1,
    interface: 'ReleaseProtocols.v1',
    project,
    distribution: 'foundation-export',
    protocols: [
      { kind: 'git-distribution', path: 'foundation/ committed view + sealed baselines', status: 'LOCAL_VERIFIED' },
      { kind: 'npm-publish', path: 'npm publish of the package', status: 'UNVERIFIED' },
    ],
  });
}

const committedExportDigest = (root) => JSON.parse(fs.readFileSync(path.join(root, 'foundation', 'foundation-lock.json'), 'utf8')).release.exportDigest;

const expectedSupplyFingerprint = (root) => {
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'integrations/comet/upstream.lock.json'), 'utf8'));
  return crypto.createHash('sha256').update(JSON.stringify({
    archive: lock.source.sha256,
    patches: lock.patches.map(({ path: p, sha256 }) => ({ path: p, sha256 })),
    toolchain: lock.toolchain,
  })).digest('hex');
};

function fdnPromoteArgs(root, { tag = 'stable', ledger, protocols } = {}) {
  return ['foundation-promote', '--root', root, '--ledger', ledger ?? makeLedger(root), '--protocols', protocols ?? makeProtocols(root), '--tag', tag];
}

function fdnRollbackArgs(root, digest, { approval, ledger } = {}) {
  const args = ['foundation-rollback', '--root', root, '--ledger', ledger ?? makeLedger(root), '--digest', digest];
  if (approval) args.push('--approval', approval);
  return args;
}

function releaseRecords(ledgerDir) {
  const dir = path.join(ledgerDir, 'releases');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
}

function distributionState(ledgerDir) {
  const file = path.join(ledgerDir, 'business', 'state.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

test('foundation setup: the tool declares the foundation-distribution surface and its refusal codes', () => {
  const source = fs.readFileSync(cliPath, 'utf8');
  assert.match(source, /foundation-promote/, 'the foundation promotion command must exist');
  assert.match(source, /foundation-reconcile/, 'the foundation reconciliation command must exist');
  assert.match(source, /foundation-rollback/, 'the foundation rollback command must exist');
  for (const code of ['BUILD_DIGEST_DRIFT', 'SUPPLY_RUNNER_MISMATCH', 'SUPPLY_BUILD_DRIFT', 'SEALED_BASELINE_UNRESOLVABLE',
    'RELEASE_PROTOCOLS_UNREGISTERED', 'DISTRIBUTION_LEDGER_REQUIRED', 'DISTRIBUTION_PROJECT_MISMATCH',
    'TAG_DIGEST_DRIFT', 'READBACK_UNCONFIRMED', 'ROLLBACK_NOT_APPROVED', 'ROLLBACK_DIGEST_MISMATCH',
    'ROLLBACK_RETENTION_MISSING', 'ROLLBACK_BASELINE_UNRESOLVABLE', 'ROLLBACK_TERMINAL_STATE_UNCONFIRMED']) {
    assert.ok(source.includes(code), `foundation code ${code} must exist in the tool`);
  }
  assert.match(source, /foundation-export\.mjs/, 'the exporter reuse must be declared');
  assert.match(source, /tools\/comet\/build\.mjs/, 'the supply fingerprint layering must be declared');
});

test('F_A14/F09 positive: the real exporter freezes the distribution and foundation-promote locks one exportDigest through supply fingerprint, tag, active release and readback', (t) => {
  const root = makeFoundationRoot('v1');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const build = runExporter(root, FX_COMMIT('r1'));
  assert.equal(build.status, 0, `exporter stderr: ${build.stderr}`);

  const promoted = runRelease(fdnPromoteArgs(root), root);
  const receipt = parseJson(promoted, 'foundation-promote');
  assert.equal(promoted.status, 0, `promote stderr: ${promoted.stderr}`);
  assert.equal(receipt.interface, 'ReleaseProtocol.v1');
  assert.equal(receipt.status, 'VERIFIED');
  assert.equal(receipt.artifact.exportDigest, committedExportDigest(root), 'the promoted digest is exactly the committed/sealed exportDigest');
  assert.equal(receipt.artifact.builtFromReleaseCommit, FX_COMMIT('r1'), 'the build identity is the frozen release commit');
  assert.equal(receipt.artifact.supplyBuildFingerprint, expectedSupplyFingerprint(root), 'the supply build fingerprint is bound (mirrors tools/comet/build.mjs fingerprintOf)');
  assert.equal(receipt.artifact.runnerVersion, '0.5.0', 'the pinned runner version is bound');

  const ledger = path.join(root, 'ledger');
  const digest = receipt.artifact.exportDigest;
  assert.match(digest, /^[0-9a-f]{64}$/, 'the exportDigest is a bare sha256 hex');
  assert.equal(fs.readFileSync(path.join(ledger, 'refs', 'tags', 'stable'), 'utf8').trim(), digest, 'the tag resolves to the exportDigest');
  assert.equal(JSON.parse(fs.readFileSync(path.join(ledger, 'active.json'), 'utf8')).exportDigest, digest);
  assert.equal(distributionState(ledger).serving, digest, 'the independent distribution state serves the promoted digest');
  assert.equal(releaseRecords(ledger).length, 1, 'exactly one release record exists');
  assert.equal(receipt.readback.sealedBaseline.resolvable, true, 'the sealed baseline resolves');
  assert.equal(receipt.readback.sealedBaseline.source, 'sealed-assets', 'the sealed baseline verified byte-for-byte');
  assert.equal(receipt.protocols.remotePublication, 'UNVERIFIED', 'remote publication stays honestly UNVERIFIED');
  assert.match(receipt.note, /REMOTE_PUBLICATION/i, 'the receipt names the unauthorized remote surface');
  assert.doesNotMatch(JSON.stringify(receipt), /\/Users\//, 'no host private paths in the receipt');
});

test('F_F09 idempotent: re-promoting the released exportDigest returns the original receipt and never releases again', (t) => {
  const root = makeFoundationRoot('v1');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal(runExporter(root, FX_COMMIT('r1')).status, 0);
  const first = parseJson(runRelease(fdnPromoteArgs(root), root), 'promote 1');
  assert.equal(first.status, 'VERIFIED');

  const second = parseJson(runRelease(fdnPromoteArgs(root), root), 'promote 2');
  assert.equal(second.status, 'VERIFIED');
  assert.equal(second.deployment.released, false, 'no second release was issued');
  assert.equal(second.deployment.idempotent, true, 'the existing receipt was returned');
  assert.equal(second.deployment.receipt.correlationId, first.deployment.receipt.correlationId);
  assert.equal(releaseRecords(path.join(root, 'ledger')).length, 1, 'the ledger still holds exactly one release');
});

test('F negative: sources that no longer build the committed digest are BUILD_DIGEST_DRIFT — nothing is released', (t) => {
  const root = makeFoundationRoot('v1');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal(runExporter(root, FX_COMMIT('r1')).status, 0);
  // Out-of-band source mutation after the distribution was frozen.
  fs.writeFileSync(path.join(root, '.agents/skills/alpha/SKILL.md'), '# alpha hand-edit\n');

  const refused = runRelease(fdnPromoteArgs(root), root);
  const verdict = parseJson(refused, 'digest drift refusal');
  assert.equal(refused.status, 2, 'a drifted build must never release');
  assert.equal(verdict.status, 'BLOCKED');
  assert.ok(verdict.codes.includes('BUILD_DIGEST_DRIFT'), `codes: ${JSON.stringify(verdict.codes)}`);
  assert.notEqual(verdict.artifact.builtExportDigest, verdict.artifact.committedExportDigest, 'the refusal records both identities');
  assert.equal(releaseRecords(path.join(root, 'ledger')).length, 0, 'no release was written');
  assert.equal(fs.existsSync(path.join(root, 'ledger', 'refs', 'tags', 'stable')), false, 'no tag was written');
});

test('F negative: a supply lock whose runner version contradicts the committed distribution is SUPPLY_RUNNER_MISMATCH', (t) => {
  const root = makeFoundationRoot('v1');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal(runExporter(root, FX_COMMIT('r1')).status, 0);
  const upstreamPath = path.join(root, 'integrations/comet/upstream.lock.json');
  const upstream = JSON.parse(fs.readFileSync(upstreamPath, 'utf8'));
  upstream.package.version = '0.6.0';
  fs.writeFileSync(upstreamPath, JSON.stringify(upstream, null, 2) + '\n');

  const refused = runRelease(fdnPromoteArgs(root), root);
  const verdict = parseJson(refused, 'supply mismatch');
  assert.equal(refused.status, 2);
  assert.ok(verdict.codes.includes('SUPPLY_RUNNER_MISMATCH'), `codes: ${JSON.stringify(verdict.codes)}`);
  assert.equal(verdict.supply.runnerVersion, '0.6.0', 'the actual supply identity is recorded');
  assert.equal(releaseRecords(path.join(root, 'ledger')).length, 0);
});

test('F_A14 negative: tag drift on the distribution ledger is refused with the actual identity mismatch recorded', (t) => {
  const root = makeFoundationRoot('v1');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal(runExporter(root, FX_COMMIT('r1')).status, 0);
  const first = parseJson(runRelease(fdnPromoteArgs(root), root), 'promote v1');
  assert.equal(first.status, 'VERIFIED');
  const digestV1 = first.artifact.exportDigest;
  const ledger = path.join(root, 'ledger');
  const activeBefore = fs.readFileSync(path.join(ledger, 'active.json'), 'utf8');

  // Real out-of-band drift: the tag is repointed behind the protocol's back.
  const outOfBand = crypto.createHash('sha256').update('out-of-band-fdn-repoint').digest('hex');
  fs.writeFileSync(path.join(ledger, 'refs', 'tags', 'stable'), `${outOfBand}\n`);

  // A second real distribution version (mutated sources, new frozen commit).
  fs.writeFileSync(path.join(root, '.agents/skills/alpha/SKILL.md'), '# alpha v2\n');
  assert.equal(runExporter(root, FX_COMMIT('r2')).status, 0);
  const drifted = runRelease(fdnPromoteArgs(root), root);
  const refusal = parseJson(drifted, 'fdn tag drift');
  assert.equal(drifted.status, 2);
  assert.equal(refusal.status, 'BLOCKED');
  assert.ok(refusal.codes.includes('TAG_DIGEST_DRIFT'), `codes: ${JSON.stringify(refusal.codes)}`);
  assert.equal(refusal.artifact.tagResolvedDigest, outOfBand, 'the refusal records what the tag actually resolves to');
  assert.equal(refusal.artifact.expectedDigest, digestV1, 'the refusal records the served reality the tag drifted away from');
  assert.notEqual(refusal.artifact.builtExportDigest, outOfBand, 'the refusal records the actually built digest');
  assert.equal(fs.readFileSync(path.join(ledger, 'active.json'), 'utf8'), activeBefore, 'no release state changed');
  assert.equal(releaseRecords(ledger).length, 1, 'no second release was written');
});

test('F_A17 positive: sequential release retains the previous approved exportDigest and the approved rollback restores it with a resolvable sealed baseline', (t) => {
  const root = makeFoundationRoot('v1');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal(runExporter(root, FX_COMMIT('r1')).status, 0);
  const v1 = parseJson(runRelease(fdnPromoteArgs(root), root), 'promote v1');
  const digestV1 = v1.artifact.exportDigest;
  const ledger = path.join(root, 'ledger');

  // Second real distribution version: new sealed baseline, previous retained.
  fs.writeFileSync(path.join(root, '.agents/skills/alpha/SKILL.md'), '# alpha v2\n');
  assert.equal(runExporter(root, FX_COMMIT('r2')).status, 0);
  const v2 = parseJson(runRelease(fdnPromoteArgs(root), root), 'promote v2');
  assert.equal(v2.status, 'VERIFIED');
  const digestV2 = v2.artifact.exportDigest;
  assert.notEqual(digestV2, digestV1);
  const baselines = fs.readdirSync(path.join(root, 'foundation', 'baselines')).filter((d) => /^[0-9a-f]{64}$/.test(d));
  assert.ok(baselines.includes(digestV1) && baselines.includes(digestV2), 'multi-version baseline retention keeps both sealed baselines');
  assert.equal(fs.readFileSync(path.join(ledger, 'refs', 'tags', 'stable'), 'utf8').trim(), digestV2, 'the sequential release moved the tag as its own effect');
  const retained = JSON.parse(fs.readFileSync(path.join(ledger, 'retained', 'previous-approved.json'), 'utf8'));
  assert.equal(retained.exportDigest, digestV1, 'the previous approved exportDigest is retained as the only rollback target');

  // Unapproved rollback first: refused, nothing changes.
  const unapproved = runRelease(fdnRollbackArgs(root, digestV1), root);
  assert.equal(unapproved.status, 2);
  assert.ok(parseJson(unapproved, 'unapproved').codes.includes('ROLLBACK_NOT_APPROVED'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(ledger, 'active.json'), 'utf8')).exportDigest, digestV2);

  // Approved same-digest rollback to the retained previous exportDigest.
  const approval = writeJson(root, 'approval.json', {
    schemaVersion: 1, interface: 'RollbackApproval.v1',
    digest: digestV1, distribution: 'foundation-local-1', approver: 'release-owner', approvedAt: '2026-10-26T00:00:00.000Z',
  });
  const rolled = runRelease(fdnRollbackArgs(root, digestV1, { approval }), root);
  const rollbackReceipt = parseJson(rolled, 'rollback');
  assert.equal(rolled.status, 0, `rollback stderr: ${rolled.stderr}`);
  assert.equal(rollbackReceipt.status, 'VERIFIED');
  assert.equal(rollbackReceipt.rollback.digest, digestV1, 'the readback carries the rollback digest');
  assert.equal(rollbackReceipt.rollback.observed.distribution, 'foundation-local-1');
  assert.equal(rollbackReceipt.rollback.observed.businessTerminalState.serving, digestV1, 'the distribution state serves the rolled-back digest');
  assert.equal(rollbackReceipt.rollback.sealedBaseline.resolvable, true, 'the previous sealed baseline resolved byte-for-byte');
  assert.equal(rollbackReceipt.rollback.sealedBaseline.source, 'sealed-assets');
  assert.equal(JSON.parse(fs.readFileSync(path.join(ledger, 'active.json'), 'utf8')).exportDigest, digestV1);
  assert.equal(fs.readFileSync(path.join(ledger, 'refs', 'tags', 'stable'), 'utf8').trim(), digestV1, 'the tag moved back to the rollback digest');
  assert.equal(distributionState(ledger).serving, digestV1);
});

test('F_A17 negative: a rollback to any digest other than the retained previous approved one is refused', (t) => {
  const root = makeFoundationRoot('v1');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal(runExporter(root, FX_COMMIT('r1')).status, 0);
  assert.equal(parseJson(runRelease(fdnPromoteArgs(root), root), 'promote v1').status, 'VERIFIED');
  fs.writeFileSync(path.join(root, '.agents/skills/alpha/SKILL.md'), '# alpha v2\n');
  assert.equal(runExporter(root, FX_COMMIT('r2')).status, 0);
  assert.equal(parseJson(runRelease(fdnPromoteArgs(root), root), 'promote v2').status, 'VERIFIED');
  const ledger = path.join(root, 'ledger');
  const activeBefore = fs.readFileSync(path.join(ledger, 'active.json'), 'utf8');

  const wrong = crypto.createHash('sha256').update('never-sealed-digest').digest('hex');
  const approval = writeJson(root, 'approval.json', {
    schemaVersion: 1, interface: 'RollbackApproval.v1',
    digest: wrong, distribution: 'foundation-local-1', approver: 'release-owner', approvedAt: '2026-10-26T00:00:00.000Z',
  });
  const refused = runRelease(fdnRollbackArgs(root, wrong, { approval }), root);
  const verdict = parseJson(refused, 'wrong digest rollback');
  assert.equal(refused.status, 2);
  assert.ok(verdict.codes.includes('ROLLBACK_DIGEST_MISMATCH'), `codes: ${JSON.stringify(verdict.codes)}`);
  const retainedDigest = JSON.parse(fs.readFileSync(path.join(ledger, 'retained', 'previous-approved.json'), 'utf8')).exportDigest;
  assert.equal(verdict.rollback.previousApprovedDigest, retainedDigest, 'the retained target is recorded');
  assert.equal(fs.readFileSync(path.join(ledger, 'active.json'), 'utf8'), activeBefore, 'refusals change nothing');
});

test('F_A17 negative: an unresolvable previous baseline blocks the rollback — ROLLBACK_BASELINE_UNRESOLVABLE', (t) => {
  const root = makeFoundationRoot('v1');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal(runExporter(root, FX_COMMIT('r1')).status, 0);
  const v1 = parseJson(runRelease(fdnPromoteArgs(root), root), 'promote v1');
  const digestV1 = v1.artifact.exportDigest;
  fs.writeFileSync(path.join(root, '.agents/skills/alpha/SKILL.md'), '# alpha v2\n');
  assert.equal(runExporter(root, FX_COMMIT('r2')).status, 0);
  assert.equal(parseJson(runRelease(fdnPromoteArgs(root), root), 'promote v2').status, 'VERIFIED');
  const ledger = path.join(root, 'ledger');
  const activeBefore = fs.readFileSync(path.join(ledger, 'active.json'), 'utf8');

  // Retention pruned out-of-band: the previous sealed baseline is gone and the
  // frozen commit is not reachable in this fixture (no git history), so the
  // previous distribution is NOT recoverable — the rollback must refuse.
  fs.rmSync(path.join(root, 'foundation', 'baselines', digestV1), { recursive: true, force: true });
  const approval = writeJson(root, 'approval.json', {
    schemaVersion: 1, interface: 'RollbackApproval.v1',
    digest: digestV1, distribution: 'foundation-local-1', approver: 'release-owner', approvedAt: '2026-10-26T00:00:00.000Z',
  });
  const refused = runRelease(fdnRollbackArgs(root, digestV1, { approval }), root);
  const verdict = parseJson(refused, 'unresolvable baseline');
  assert.equal(refused.status, 2);
  assert.equal(verdict.status, 'BLOCKED');
  assert.ok(verdict.codes.includes('ROLLBACK_BASELINE_UNRESOLVABLE'), `codes: ${JSON.stringify(verdict.codes)}`);
  assert.equal(typeof verdict.rollback.baselineReason, 'string', 'the refusal records why the baseline cannot resolve');
  assert.equal(fs.readFileSync(path.join(ledger, 'active.json'), 'utf8'), activeBefore, 'the rollback changed nothing');
});

test('F_A16: an unknown deployment result is reconciled by the original correlation ID — query first, never a second release', (t) => {
  const root = makeFoundationRoot('v1');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal(runExporter(root, FX_COMMIT('r1')).status, 0);
  const promoted = parseJson(runRelease(fdnPromoteArgs(root), root), 'promote');
  const ledger = path.join(root, 'ledger');
  const correlationId = promoted.deployment.receipt.correlationId;
  const original = JSON.parse(fs.readFileSync(path.join(ledger, 'releases', `${correlationId}.json`), 'utf8'));

  // Unknown correlation ID: honest UNCONFIRMED, nothing written.
  const unknown = runRelease(['foundation-reconcile', '--ledger', ledger, '--correlation-id', crypto.randomUUID()], root);
  const unknownVerdict = parseJson(unknown, 'reconcile unknown');
  assert.equal(unknown.status, 2);
  assert.equal(unknownVerdict.status, 'UNVERIFIED');
  assert.equal(unknownVerdict.found, false);
  assert.ok(unknownVerdict.codes.includes('READBACK_UNCONFIRMED'));
  assert.equal(releaseRecords(ledger).length, 1, 'an uncertain query never triggers a release');

  // Known ID: the original result is bound by its original requestedAt.
  const reconciled = runRelease(['foundation-reconcile', '--ledger', ledger, '--correlation-id', correlationId], root);
  const verdict = parseJson(reconciled, 'reconcile known');
  assert.equal(reconciled.status, 0);
  assert.equal(verdict.status, 'VERIFIED');
  assert.equal(verdict.found, true);
  assert.equal(verdict.deployment.receipt.correlationId, correlationId);
  assert.equal(verdict.deployment.receipt.requestedAt, original.requestedAt, 'the original release result, not a new one');
  assert.equal(verdict.deployment.released, false, 'reconciliation never re-releases');
  assert.equal(releaseRecords(ledger).length, 1);
});

test('F registration: an unregistered ledger or protocol registry blocks the release — the plan shape never substitutes', (t) => {
  const root = makeFoundationRoot('v1');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal(runExporter(root, FX_COMMIT('r1')).status, 0);

  const unregistered = runRelease(['foundation-promote', '--root', root, '--ledger', makeLedger(root, { registered: false }),
    '--protocols', makeProtocols(root), '--tag', 'stable'], root);
  assert.equal(unregistered.status, 2);
  assert.ok(parseJson(unregistered, 'unregistered ledger').codes.includes('DISTRIBUTION_LEDGER_REQUIRED'));
  assert.equal(releaseRecords(path.join(root, 'ledger')).length, 0, 'no release was written');

  const missingProtocols = runRelease(['foundation-promote', '--root', root, '--ledger', makeLedger(root),
    '--protocols', path.join(root, 'absent.json'), '--tag', 'stable'], root);
  assert.equal(missingProtocols.status, 2);
  assert.ok(parseJson(missingProtocols, 'missing protocols').codes.includes('RELEASE_PROTOCOLS_UNREGISTERED'));

  const foreignProject = runRelease(['foundation-promote', '--root', root, '--ledger', makeLedger(root),
    '--protocols', makeProtocols(root, { project: 'some-other-project' }), '--tag', 'stable'], root);
  assert.equal(foreignProject.status, 2);
  assert.ok(parseJson(foreignProject, 'project mismatch').codes.includes('DISTRIBUTION_PROJECT_MISMATCH'));
});

test('F honesty: the committed release-protocols registry validates, names the real publication paths and keeps every remote leg UNVERIFIED', (t) => {
  const root = makeFoundationRoot('v1');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal(runExporter(root, FX_COMMIT('r1')).status, 0);

  // The real committed registration drives a fixture ledger registered to the
  // same project — the tool must accept it and thread it into the receipt.
  const promoted = runRelease(fdnPromoteArgs(root, { ledger: makeLedger(root, { project: 'sdd-harness-pilot' }), protocols: committedProtocolsPath }), root);
  const receipt = parseJson(promoted, 'real protocols promote');
  assert.equal(promoted.status, 0, `stderr: ${promoted.stderr}`);
  const kinds = receipt.protocols.kinds;
  assert.ok(kinds.includes('git-distribution') && kinds.includes('npm-publish') && kinds.includes('github-release'),
    `the registry names the real publication paths: ${JSON.stringify(kinds)}`);
  assert.equal(receipt.protocols.remotePublication, 'UNVERIFIED', 'no remote publication is claimed');
  assert.match(receipt.note, /REMOTE_PUBLICATION/i);

  // The committed registry itself stays honest: remote legs are UNVERIFIED.
  const registry = JSON.parse(fs.readFileSync(committedProtocolsPath, 'utf8'));
  assert.equal(registry.interface, 'ReleaseProtocols.v1');
  for (const protocol of registry.protocols) {
    if (protocol.kind !== 'git-distribution') {
      assert.equal(protocol.status, 'UNVERIFIED', `${protocol.kind} must stay UNVERIFIED until an authorized operator performs and reads it back`);
    }
  }
});

test('F input contract: malformed foundation arguments are input errors (exit 1), never semantic verdicts', (t) => {
  const root = makeFoundationRoot('v1');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal(runExporter(root, FX_COMMIT('r1')).status, 0);
  const badDigest = runRelease(fdnRollbackArgs(root, 'not-a-digest'), root);
  assert.equal(badDigest.status, 1);
  assert.match(badDigest.stderr, /digest/, 'the tool names the malformed field itself');
  const noRoot = runRelease(['foundation-promote', '--ledger', makeLedger(root), '--protocols', makeProtocols(root), '--tag', 'stable'], root);
  assert.equal(noRoot.status, 1);
  assert.match(noRoot.stderr, /--root is required/);
  const noLedger = runRelease(['foundation-reconcile'], root);
  assert.equal(noLedger.status, 1);
  assert.match(noLedger.stderr, /--ledger is required/);
});

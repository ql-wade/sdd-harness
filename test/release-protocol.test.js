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
const SHA = (ch) => ch.repeat(40);
const DIGEST = (label) => `sha256:${crypto.createHash('sha256').update(label).digest('hex')}`;
const PROJECT = 'sdd-harness-pilot';

function childEnv(root) {
  const env = { ...process.env, HOME: root, TMPDIR: root, PATH: '/usr/bin:/bin' };
  delete env.NODE_TEST_CONTEXT;
  return env;
}

function runRelease(args, root) {
  return spawnSync(process.execPath, [cliPath, ...args], {
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

  // New candidate (new head/merge, checks bound to the new merge); the tag still points at v1.
  const sourceV2 = writeSource(root, 'src-v2', 'v2');
  const drifted = runRelease(
    promoteArgs({ root, chain: chainFixture({ merge: SHA('m2'), head: SHA('h2') }), source: sourceV2, chainOut: 'chain-drift.json' }).args,
    root,
  );
  const refusal = parseJson(drifted, 'drift refusal');
  assert.equal(drifted.status, 2, 'a drifted tag must never promote');
  assert.equal(refusal.status, 'BLOCKED');
  assert.ok(refusal.codes.includes('TAG_DIGEST_DRIFT'), `codes: ${JSON.stringify(refusal.codes)}`);
  assert.equal(refusal.artifact.tagResolvedDigest, digestV1, 'the refusal records the digest the tag actually resolves to');
  assert.notEqual(refusal.artifact.digest, digestV1, 'the refusal records the actually built digest');
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
  const noChecks = runRelease(['promote', '--chain', writeJson(root, 'c2.json', chainFixture({ overrides: { checks: [] } })), '--source', source, '--tag', 'stable', '--registry', registry, '--environment', env], root);
  assert.equal(noChecks.status, 1);
  assert.match(noChecks.stderr, /checks must be a non-empty array/, 'the tool names the empty check set itself');
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

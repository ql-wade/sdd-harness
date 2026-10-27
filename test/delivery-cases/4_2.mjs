// P4_2 delivery case: the isolated-environment release protocol builds and
// promotes one digest end to end — tag drift never promotes, a lost
// deployment response is reconciled by its correlation ID without a second
// deployment, only an approved same-digest rollback passes with an
// independent business readback, and the exact integration SHA plus the same
// digest thread through gate verification, promotion and the target
// environment (A14/A16/A17/F09).
//
// Coverage:
//   4.2.a  build and promote the same digest — the real delivery gate
//          (tools/ci/verify-delivery.mjs, P4_1) verifies the candidate first,
//          then tools/ci/release.mjs builds from the exact merge SHA into the
//          isolated Registry, deploys into the isolated environment and emits
//          a chain that the accepted I06 evaluator
//          (tools/infra/platform.mjs probe registry-environment-identity)
//          independently confirms; a drifted tag is refused by both.
//   4.2.b  timeout reconciliation and approved rollback — the query by the
//          original correlation ID binds the original result (never
//          redeploying), the unapproved rollback is refused by both the
//          protocol and I06, and the approved same-digest rollback reads back
//          digest, environment and the key business terminal state. No
//          production release is claimed anywhere: every receipt stays
//          LOCAL_ONLY with the real authorization left to the environment
//          owner + runtime admission after P4_2.
//
// CLI exit contract: 0=PASS, 1=invalid input/prerequisite, 2=BLOCKED/UNVERIFIED.
// All fixtures are generated under os.tmpdir(); no live configuration or
// change-control file is written by this suite. The launcher secret is a
// fixture value owned by this suite, never a real credential.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createLaunchAuthority } from '../../lib/delivery/evidence.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const cliPath = path.join(projectRoot, 'tools', 'ci', 'release.mjs');
const gateCliPath = path.join(projectRoot, 'tools', 'ci', 'verify-delivery.mjs');
const platformCli = path.join(projectRoot, 'tools', 'infra', 'platform.mjs');
const committedPolicyDir = path.join(projectRoot, 'infra', 'delivery', 'platform');

const RUN_TIMEOUT_MS = 120_000;
const SHA = (label) => crypto.createHash('sha256').update(`sha-label-${label}`).digest('hex').slice(0, 40);
const DIGEST = (label) => `sha256:${crypto.createHash('sha256').update(label).digest('hex')}`;
const BARE = (label) => crypto.createHash('sha256').update(label).digest('hex');
const NOW = '2026-10-21T12:00:00.000Z';
const LAUNCH_ENV = 'SDD_DELIVERY_LAUNCH_AUTHORITY';
const FIXTURE_SECRET = 'delivery-case-p4-2-fixture-launch-authority-0123456789';
const REQUIRED_CHECK_NAME = 'delivery-gate';
const PROJECT = 'sdd-harness-pilot';

function childEnv(root, overrides = {}) {
  const env = { ...process.env, ...overrides, HOME: root, TMPDIR: root, PATH: '/usr/bin:/bin' };
  delete env.NODE_TEST_CONTEXT;
  return env;
}

function runRelease(args, root, extraEnv = {}) {
  return spawnSync(process.execPath, [cliPath, ...args, '--json'], {
    cwd: projectRoot, encoding: 'utf8', timeout: RUN_TIMEOUT_MS, env: childEnv(root, extraEnv),
  });
}

function runGate(chainFile, policyDir, root) {
  return spawnSync(process.execPath, [gateCliPath, '--chain', chainFile, '--policy-dir', policyDir, '--json'], {
    cwd: projectRoot, encoding: 'utf8', timeout: RUN_TIMEOUT_MS, env: childEnv(root, { [LAUNCH_ENV]: FIXTURE_SECRET }),
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

// --- fixtures (gate section mirrors the accepted P4_1 case machinery) -----

function contractFixture(capability) {
  return {
    schemaVersion: 1,
    project: PROJECT,
    change: 'delivery-foundation-rearchitecture',
    cases: [{ id: 'c1', ac: 'F09', oracle: 'the verified candidate promotes with the same digest into the isolated environment' }],
    requiredChecks: [{ level: 'gate', capability }],
    executionDenominator: { totalCases: 1 },
    cleanup: { environment: 'tmp fixture removed after run', data: 'none persisted' },
    dependencyBaselines: [{ kind: 'product', digest: BARE('product-case-p4-2') }],
  };
}

function gateSectionFixture({ candidateLabel = 'p4-2-candidate-r1', execution = 'exec-verifier-p4-2' } = {}) {
  const launcher = createLaunchAuthority({ secret: FIXTURE_SECRET });
  const inputDigest = BARE(candidateLabel);
  const policyDigest = BARE('policy/managed-pilot@r1');
  const envelope = {
    schemaVersion: 1,
    candidateDigest: inputDigest,
    caseId: 'c1',
    check: 'unit:node:test',
    origin: { kind: 'registered-runner', id: 'runner-1' },
    execution: { id: execution },
    environment: 'managed-pilot-env-1',
    toolchain: `node ${process.versions.node}`,
    executions: { total: 3, valid: 2 },
    result: 'pass',
    evidence: [{ uri: '.whitebox/c1/tap.txt', sha256: BARE('tap-output-p4-2') }],
    expiry: '2026-11-01T00:00:00.000Z',
  };
  const dispatch = launcher.issueDispatch({
    runnerId: 'runner-1',
    run: 'run-p4-2',
    gate: 'V',
    inputDigest,
    policyDigest,
    attempt: 1,
    epoch: 1,
    role: 'verifier',
    execution,
  });
  return {
    inputDigest,
    builderExecution: 'exec-builder-p4-2',
    testContract: contractFixture('unit:node:test'),
    policy: { ref: 'policy/managed-pilot', digest: policyDigest },
    environment: 'managed-pilot-env-1',
    now: NOW,
    entries: [{ envelope, dispatch }],
  };
}

function registeredPolicyFixture(root) {
  const policy = JSON.parse(fs.readFileSync(path.join(committedPolicyDir, 'ci-policy.json'), 'utf8'));
  policy.requiredChecks.registrationStatus = 'REGISTERED';
  policy.requiredChecks.names = [REQUIRED_CHECK_NAME];
  const dir = path.join(root, 'platform');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'ci-policy.json'), JSON.stringify(policy, null, 2));
  return dir;
}

function writeSource(root, name, version) {
  const dir = path.join(root, name);
  fs.mkdirSync(path.join(dir, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'app.js'), `// p4-2 journey fixture ${version}\nconsole.log("${version}");\n`);
  fs.writeFileSync(path.join(dir, 'lib', 'util.js'), `export const version = "${version}";\n`);
  return dir;
}

function candidateChain({ merge, head, withGate = true } = {}) {
  const chain = {
    project: PROJECT,
    head,
    merge,
    requiredChecks: [REQUIRED_CHECK_NAME],
    checks: [{ name: REQUIRED_CHECK_NAME, boundSha: merge, conclusion: 'success' }],
  };
  if (withGate) chain.gate = gateSectionFixture({ candidateLabel: `p4-2-candidate-${merge.slice(0, 8)}` });
  return chain;
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

function ledgerRecords(envDir) {
  const deployments = path.join(envDir, 'deployments');
  if (!fs.existsSync(deployments)) return [];
  return fs.readdirSync(deployments).filter((f) => f.endsWith('.json')).sort();
}

// --- the journey ----------------------------------------------------------

test('setup: the release protocol tool exists beside the accepted delivery gate as a real executable', () => {
  assert.equal(fs.statSync(cliPath).isFile(), true);
  assert.equal(fs.statSync(gateCliPath).isFile(), true);
  const source = fs.readFileSync(cliPath, 'utf8');
  assert.match(source, /ReleaseProtocol\.v1/);
  assert.match(source, /ISOLATED_RELEASE_ENVIRONMENT_REQUIRED/);
  assert.match(source, /tools\/infra\/platform\.mjs/, 'the I06 layering must be declared');
});

test('4.2.a journey: the gate-verified candidate builds and promotes the same digest — gate pass, promotion receipt, and the I06 evaluator independently verify the exact chain', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p4-2-journey-a-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const merge = SHA('m1');
  const chainFile = writeJson(root, 'chain.json', candidateChain({ merge, head: SHA('h1') }));

  // 1) the accepted CI-side delivery gate verifies the exact candidate.
  const policyDir = registeredPolicyFixture(root);
  const gate = runGate(chainFile, policyDir, root);
  const gateVerdict = parseJson(gate, 'delivery gate');
  assert.equal(gate.status, 0, `gate stderr: ${gate.stderr}`);
  assert.equal(gateVerdict.status, 'VERIFIED');
  assert.equal(gateVerdict.mergeBlocked, false);

  // 2) the release protocol promotes the same verified candidate into the isolated environment.
  const source = writeSource(root, 'src-v1', 'v1');
  const promote = runRelease(['promote', '--chain', chainFile, '--source', source, '--tag', 'stable',
    '--registry', makeRegistry(root), '--environment', makeEnvironment(root), '--chain-out', path.join(root, 'chain-out.json')], root);
  const receipt = parseJson(promote, 'promote');
  assert.equal(promote.status, 0, `promote stderr: ${promote.stderr}`);
  assert.equal(receipt.status, 'VERIFIED');
  assert.equal(receipt.artifact.builtFromMerge, merge, 'F09: the build identity is the exact integration SHA');

  // 3) the same digest threads through tag, deployment receipt, active binding and business readback.
  const envDir = path.join(root, 'env');
  const digest = receipt.artifact.digest;
  assert.equal(fs.readFileSync(path.join(root, 'registry', 'refs', 'tags', 'stable'), 'utf8').trim(), digest);
  assert.equal(JSON.parse(fs.readFileSync(path.join(envDir, 'active.json'), 'utf8')).artifactDigest, digest);
  assert.equal(ledgerRecords(envDir).length, 1);
  const business = JSON.parse(fs.readFileSync(path.join(envDir, 'business', 'state.json'), 'utf8'));
  assert.equal(business.serving, digest);

  // 4) the accepted I06 evaluator independently verifies the emitted chain.
  const probe = runPlatformProbe(path.join(root, 'chain-out.json'), root);
  const i06 = parseJson(probe, 'I06 probe');
  assert.equal(probe.status, 0, `I06 stderr: ${probe.stderr}`);
  assert.equal(i06.status, 'VERIFIED');
  assert.equal(i06.steps.find((step) => step.step === 'deployment').binding, 'DIGEST_AND_CORRELATION_ID');
});

test('V_A14 negative: a deployment tag pointing at another digest is refused and recorded by the protocol and by I06', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p4-2-journey-drift-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const first = runRelease(['promote', '--chain', writeJson(root, 'chain-v1.json', candidateChain({ merge: SHA('m1'), head: SHA('h1') })),
    '--source', writeSource(root, 'src-v1', 'v1'), '--tag', 'stable',
    '--registry', makeRegistry(root), '--environment', makeEnvironment(root)], root);
  assert.equal(first.status, 0);
  const digestV1 = parseJson(first, 'promote v1').artifact.digest;
  const activeBefore = fs.readFileSync(path.join(root, 'env', 'active.json'), 'utf8');

  // Real out-of-band drift: the deployment tag is repointed behind the protocol's back.
  const outOfBand = DIGEST('out-of-band-repoint');
  fs.writeFileSync(path.join(root, 'registry', 'refs', 'tags', 'stable'), `${outOfBand}\n`);

  const drifted = runRelease(['promote', '--chain', writeJson(root, 'chain-v2.json', candidateChain({ merge: SHA('m2'), head: SHA('h2') })),
    '--source', writeSource(root, 'src-v2', 'v2'), '--tag', 'stable',
    '--registry', path.join(root, 'registry'), '--environment', path.join(root, 'env'),
    '--chain-out', path.join(root, 'chain-drift.json')], root);
  const refusal = parseJson(drifted, 'drift');
  assert.equal(drifted.status, 2);
  assert.ok(refusal.codes.includes('TAG_DIGEST_DRIFT'), `codes: ${JSON.stringify(refusal.codes)}`);
  assert.equal(refusal.artifact.tagResolvedDigest, outOfBand, 'the actual identity mismatch is recorded');
  assert.equal(refusal.artifact.expectedDigest, digestV1, 'the served reality the tag drifted away from is recorded');
  assert.equal(fs.readFileSync(path.join(root, 'env', 'active.json'), 'utf8'), activeBefore);

  const probe = runPlatformProbe(path.join(root, 'chain-drift.json'), root);
  const i06 = parseJson(probe, 'I06 probe (drift)');
  assert.equal(probe.status, 2);
  assert.ok(i06.codes.includes('TAG_DIGEST_DRIFT'), `I06 codes: ${JSON.stringify(i06.codes)}`);
});

test('V_A16: the lost deployment response is reconciled by the original correlation ID — original result bound, no duplicate deployment, idempotent re-promotion', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p4-2-journey-b-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = writeSource(root, 'src-v1', 'v1');
  // The response is lost after the environment accepted the deployment.
  assert.equal(runRelease(['promote', '--chain', writeJson(root, 'chain.json', candidateChain({ merge: SHA('m1'), head: SHA('h1') })),
    '--source', source, '--tag', 'stable', '--registry', makeRegistry(root), '--environment', makeEnvironment(root),
    '--chain-out', path.join(root, 'chain-v1.json')], root).status, 0);
  const envDir = path.join(root, 'env');
  const active = JSON.parse(fs.readFileSync(path.join(envDir, 'active.json'), 'utf8'));
  const original = JSON.parse(fs.readFileSync(path.join(envDir, 'deployments', `${active.correlationId}.json`), 'utf8'));

  const reconcile = runRelease(['reconcile', '--chain', path.join(root, 'chain-v1.json'), '--registry', path.join(root, 'registry'),
    '--environment', envDir, '--correlation-id', active.correlationId, '--chain-out', path.join(root, 'chain-reconciled.json')], root);
  const reconciled = parseJson(reconcile, 'reconcile');
  assert.equal(reconcile.status, 0);
  assert.equal(reconciled.found, true);
  assert.equal(reconciled.deployment.receipt.correlationId, active.correlationId);
  assert.equal(reconciled.deployment.receipt.requestedAt, original.requestedAt, 'the original result is bound, not a new deployment');
  assert.equal(ledgerRecords(envDir).length, 1);

  // The retried promotion of the same digest is idempotent: no second deployment.
  const again = parseJson(runRelease(['promote', '--chain', path.join(root, 'chain.json'), '--source', source, '--tag', 'stable',
    '--registry', path.join(root, 'registry'), '--environment', envDir], root), 're-promote');
  assert.equal(again.deployment.deployed, false);
  assert.equal(again.deployment.idempotent, true);
  assert.equal(again.deployment.receipt.correlationId, active.correlationId);
  assert.equal(ledgerRecords(envDir).length, 1, 'still exactly one deployment');

  const probe = runPlatformProbe(path.join(root, 'chain-reconciled.json'), root);
  assert.equal(probe.status, 0, `I06 stderr: ${probe.stderr}`);
  assert.equal(parseJson(probe, 'I06 probe (reconcile)').status, 'VERIFIED');
});

test('V_A17: the unapproved rollback is refused by protocol and I06; the approved same-digest rollback reads back digest, environment and business terminal state', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p4-2-journey-rb-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourceV1 = writeSource(root, 'src-v1', 'v1');
  const sourceV2 = writeSource(root, 'src-v2', 'v2');
  const first = parseJson(runRelease(['promote', '--chain', writeJson(root, 'chain-v1.json', candidateChain({ merge: SHA('m1'), head: SHA('h1') })),
    '--source', sourceV1, '--tag', 'stable', '--registry', makeRegistry(root), '--environment', makeEnvironment(root)], root), 'promote v1');
  assert.equal(runRelease(['promote', '--chain', writeJson(root, 'chain-v2.json', candidateChain({ merge: SHA('m2'), head: SHA('h2') })),
    '--source', sourceV2, '--tag', 'stable', '--registry', path.join(root, 'registry'), '--environment', path.join(root, 'env'),
    '--chain-out', path.join(root, 'chain-v2.json')], root).status, 0);
  const envDir = path.join(root, 'env');
  const activeBefore = fs.readFileSync(path.join(envDir, 'active.json'), 'utf8');

  // Unapproved: refused, nothing changes, I06 independently blocks.
  const refused = runRelease(['rollback', '--chain', path.join(root, 'chain-v2.json'), '--registry', path.join(root, 'registry'),
    '--environment', envDir, '--digest', first.artifact.digest, '--chain-out', path.join(root, 'chain-rb-refused.json')], root);
  assert.equal(refused.status, 2);
  assert.ok(parseJson(refused, 'unapproved').codes.includes('ROLLBACK_NOT_APPROVED'));
  assert.equal(fs.readFileSync(path.join(envDir, 'active.json'), 'utf8'), activeBefore);
  const refusedProbe = runPlatformProbe(path.join(root, 'chain-rb-refused.json'), root);
  assert.equal(refusedProbe.status, 2);
  assert.ok(parseJson(refusedProbe, 'I06 probe (unapproved)').codes.includes('ROLLBACK_NOT_APPROVED'));

  // Approved, same digest: the rollback reads back digest, environment and business terminal state.
  const approval = writeJson(root, 'approval.json', {
    schemaVersion: 1, interface: 'RollbackApproval.v1',
    digest: first.artifact.digest, environment: 'isolated-local-env-1', approver: 'release-owner', approvedAt: NOW,
  });
  const rolled = runRelease(['rollback', '--chain', path.join(root, 'chain-v2.json'), '--registry', path.join(root, 'registry'),
    '--environment', envDir, '--digest', first.artifact.digest, '--approval', approval,
    '--chain-out', path.join(root, 'chain-rollback.json')], root);
  const rollbackReceipt = parseJson(rolled, 'rollback');
  assert.equal(rolled.status, 0, `rollback stderr: ${rolled.stderr}`);
  assert.equal(rollbackReceipt.status, 'VERIFIED');
  assert.equal(rollbackReceipt.rollback.digest, first.artifact.digest);
  assert.equal(rollbackReceipt.rollback.observed.environment, 'isolated-local-env-1');
  assert.equal(rollbackReceipt.rollback.observed.businessTerminalState.serving, first.artifact.digest);
  assert.equal(JSON.parse(fs.readFileSync(path.join(envDir, 'business', 'state.json'), 'utf8')).serving, first.artifact.digest);

  const probe = runPlatformProbe(path.join(root, 'chain-rollback.json'), root);
  assert.equal(probe.status, 0, `I06 stderr: ${probe.stderr}`);
  assert.equal(parseJson(probe, 'I06 probe (rollback)').status, 'VERIFIED');
});

test('4.2.b boundary: no production release is claimed — an unregistered isolated environment blocks the action and every receipt stays LOCAL_ONLY', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p4-2-journey-auth-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = writeSource(root, 'src-v1', 'v1');
  const registry = makeRegistry(root);
  const envDir = makeEnvironment(root, { registered: false });
  const chainFile = writeJson(root, 'chain.json', candidateChain({ merge: SHA('m1'), head: SHA('h1') }));

  const blocked = runRelease(['promote', '--chain', chainFile, '--source', source, '--tag', 'stable',
    '--registry', registry, '--environment', envDir], root);
  const verdict = parseJson(blocked, 'unregistered');
  assert.equal(blocked.status, 2);
  assert.ok(verdict.codes.includes('ISOLATED_RELEASE_ENVIRONMENT_REQUIRED'), `codes: ${JSON.stringify(verdict.codes)}`);
  assert.equal(fs.existsSync(path.join(envDir, 'deployments')), false, 'a registration gap blocks the action — the plan shape never satisfies it');

  const registeredRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'p4-2-journey-auth2-'));
  t.after(() => fs.rmSync(registeredRoot, { recursive: true, force: true }));
  fs.cpSync(root, registeredRoot, { recursive: true });
  const localEnv = makeEnvironment(registeredRoot);
  const receipt = parseJson(runRelease(['promote', '--chain', path.join(registeredRoot, 'chain.json'),
    '--source', writeSource(registeredRoot, 'src-v1', 'v1'), '--tag', 'stable',
    '--registry', makeRegistry(registeredRoot), '--environment', localEnv], registeredRoot), 'promote registered');
  assert.equal(receipt.mode, 'LOCAL_ONLY');
  assert.match(receipt.note, /environment owner|runtime admission|UNVERIFIED/i,
    'real production promotion stays with the environment owner + runtime admission after P4_2');
  assert.doesNotMatch(JSON.stringify(receipt), /\/Users\//, 'no host private paths in structured receipts');
});

// ---------------------------------------------------------------------------
// 4.2.c foundation-distribution journey (revision 2026-10-26-comet-050-
// adoption-v1): this scaffold is the distribution producer, so deployment
// semantics = build/publish/rollback of the foundation-export package. The
// chain runs the REAL exporter to freeze a sealed distribution, then the
// release protocol locks one exportDigest through build (live build == committed
// lock), supply (the pinned runner's build fingerprint bound into the release
// record), publication registration (the committed release-protocols.json;
// every remote leg honestly UNVERIFIED), tag/active/readback, and rolls back
// to the retained previous exportDigest whose sealed baseline still resolves
// from the multi-version baselines directory.
// ---------------------------------------------------------------------------

const exporterPath = path.join(projectRoot, 'tools', 'foundation-export.mjs');
const committedProtocolsPath = path.join(projectRoot, 'openspec', 'changes', 'delivery-foundation-rearchitecture', 'release-journey', 'release-protocols.json');
const FX_COMMIT = (label) => crypto.createHash('sha256').update(`fx-commit-4-2-${label}`).digest('hex').slice(0, 40);

function makeFoundationRoot(version) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p4-2-journey-fdn-'));
  fs.mkdirSync(path.join(root, '.agents/skills/alpha'), { recursive: true });
  fs.writeFileSync(path.join(root, '.agents/skills/alpha/SKILL.md'), `# alpha ${version}\n`);
  fs.writeFileSync(path.join(root, 'hooks.yaml'), ['policies:', '  - id: dangerous-command-blocklist', '    hook: PreToolUse', '    matcher: Bash', '    action: deny', '    patterns:', '      - "git push --force"', '    message: "blocked"'].join('\n') + '\n');
  writeJson(root, '.mcp.json', { mcpServers: { probe: { command: 'npx', args: ['-y', 'probe-mcp@1.2.3'] } } });
  writeJson(root, 'package.json', { name: 'fdn-journey', version: '1.0.0' });
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
  writeJson(root, 'ledger/registration.json', {
    schemaVersion: 1,
    interface: 'DistributionLedger.v1',
    distribution: {
      id: 'foundation-local-1',
      project: 'sdd-harness-pilot',
      rollback: { approvalRequired: true, sameDigestRequired: true, retainPreviousApproved: true },
      readbackOracle: { kind: 'independent-distribution-readback', correlationIdRequired: true },
    },
    localOnly: true,
  });
  return root;
}

function runExporter(root, commit) {
  return spawnSync(process.execPath, [exporterPath, 'export', '--root', root, '--out', path.join(root, 'foundation'),
    '--release-commit', commit, '--freeze-baseline'], { cwd: projectRoot, encoding: 'utf8', timeout: RUN_TIMEOUT_MS, env: childEnv(root) });
}

const committedExportDigest = (root) => JSON.parse(fs.readFileSync(path.join(root, 'foundation', 'foundation-lock.json'), 'utf8')).release.exportDigest;

test('4.2.c journey: the foundation distribution builds, promotes and rolls back on ONE exportDigest with remote publication honestly UNVERIFIED', (t) => {
  const root = makeFoundationRoot('v1');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const ledger = path.join(root, 'ledger');

  // 1) build: the real exporter freezes the distribution and seals its baseline.
  const build = runExporter(root, FX_COMMIT('r1'));
  assert.equal(build.status, 0, `exporter stderr: ${build.stderr}`);
  const digestV1 = committedExportDigest(root);

  // 2) promote: the committed release-protocols registration drives the release; the same
  //    digest threads supply fingerprint, tag, active release and readback.
  const promoted = parseJson(runRelease(['foundation-promote', '--root', root, '--ledger', ledger,
    '--protocols', committedProtocolsPath, '--tag', 'stable'], root), 'promote v1');
  assert.equal(promoted.status, 'VERIFIED');
  assert.equal(promoted.artifact.exportDigest, digestV1, 'F09: the promoted digest is the sealed exportDigest');
  assert.match(promoted.artifact.supplyBuildFingerprint, /^[0-9a-f]{64}$/, 'the supply build fingerprint is bound');
  assert.equal(promoted.protocols.remotePublication, 'UNVERIFIED', 'no remote publication is claimed on the journey');

  // 3) negative red line: tag drift never promotes.
  fs.writeFileSync(path.join(ledger, 'refs', 'tags', 'stable'), `${crypto.createHash('sha256').update('oob').digest('hex')}\n`);
  fs.writeFileSync(path.join(root, '.agents/skills/alpha/SKILL.md'), '# alpha v2\n');
  assert.equal(runExporter(root, FX_COMMIT('r2')).status, 0);
  const drifted = runRelease(['foundation-promote', '--root', root, '--ledger', ledger,
    '--protocols', committedProtocolsPath, '--tag', 'stable'], root);
  assert.equal(drifted.status, 2);
  assert.ok(parseJson(drifted, 'drift').codes.includes('TAG_DIGEST_DRIFT'));

  // 4) restore the tag to the served reality and complete the sequential release.
  fs.writeFileSync(path.join(ledger, 'refs', 'tags', 'stable'), `${digestV1}\n`);
  const v2 = parseJson(runRelease(['foundation-promote', '--root', root, '--ledger', ledger,
    '--protocols', committedProtocolsPath, '--tag', 'stable'], root), 'promote v2');
  assert.equal(v2.status, 'VERIFIED');
  const digestV2 = v2.artifact.exportDigest;
  assert.notEqual(digestV2, digestV1);

  // 5) rollback: approved rollback to the retained previous exportDigest whose sealed
  //    baseline still resolves (multi-version retention under foundation/baselines).
  const approval = writeJson(root, 'approval.json', {
    schemaVersion: 1, interface: 'RollbackApproval.v1',
    digest: digestV1, distribution: 'foundation-local-1', approver: 'release-owner', approvedAt: NOW,
  });
  const rolled = runRelease(['foundation-rollback', '--root', root, '--ledger', ledger,
    '--digest', digestV1, '--approval', approval], root);
  const rollbackReceipt = parseJson(rolled, 'rollback');
  assert.equal(rolled.status, 0, `rollback stderr: ${rolled.stderr}`);
  assert.equal(rollbackReceipt.status, 'VERIFIED');
  assert.equal(rollbackReceipt.rollback.digest, digestV1);
  assert.equal(rollbackReceipt.rollback.sealedBaseline.resolvable, true, 'the previous sealed baseline resolved byte-for-byte');
  assert.equal(rollbackReceipt.rollback.sealedBaseline.exportDigest, digestV1, 'the resolvable baseline is the rollback digest itself');
  assert.equal(rollbackReceipt.rollback.observed.businessTerminalState.serving, digestV1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(ledger, 'business', 'state.json'), 'utf8')).serving, digestV1);

  // 6) boundary: every journey receipt stays LOCAL_ONLY with the remote surface named, no host paths.
  for (const receipt of [promoted, v2, rollbackReceipt]) {
    assert.equal(receipt.mode, 'LOCAL_ONLY');
    assert.match(receipt.note, /REMOTE_PUBLICATION|UNVERIFIED/i);
    assert.doesNotMatch(JSON.stringify(receipt), /\/Users\//);
  }
});

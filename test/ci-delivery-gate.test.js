// CI-side delivery gate (task P4_1, A13/F06/F09).
//
// Two real entry points are exercised — no mock anywhere:
//   1. .github/workflows/delivery-gate.yml — the protected CI entry declares the
//      delivery-gate job, takes the required-check policy from the protected
//      baseline (infra/delivery/platform/ci-policy.json, never hardcoded names)
//      and pins every collection to the exact integration merge SHA.
//   2. tools/ci/verify-delivery.mjs — the gate verifier, run as a real
//      subprocess over real files: required checks are re-evaluated against the
//      exact integration SHA with I06's blocking semantics (CHECK_MISSING /
//      CHECK_STALE_EVIDENCE / CHECK_TIMED_OUT / CHECK_SKIPPED), and the
//      SDD.Gate.v1 verdict comes from the accepted lib/delivery/gate.js +
//      lib/delivery/evidence.js admission path (import reuse, zero changes).
//
// Exit contract (repository CLI): 0=PASS, 1=invalid input/prerequisite,
// 2=verification failure/UNVERIFIED. Missing prerequisites never convert to a
// pass. Fixtures live only in os.tmpdir(); no live configuration is written.
// The committed protected baseline is UNSELECTED/LOCAL_ONLY, so the
// platform-merge authorization stays honestly UNVERIFIED
// (PLATFORM_REQUIRED_CHECK_AUTHORITY_REQUIRED) — plan fields never satisfy it.
import assert, { AssertionError } from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createLaunchAuthority } from '../lib/delivery/evidence.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflowPath = path.join(repoRoot, '.github', 'workflows', 'delivery-gate.yml');
const cliPath = path.join(repoRoot, 'tools', 'ci', 'verify-delivery.mjs');
const committedPolicyDir = path.join(repoRoot, 'infra', 'delivery', 'platform');
const RUN_TIMEOUT_MS = 60_000;

const SHA = (ch) => ch.repeat(40);
const DIGEST = (label) => crypto.createHash('sha256').update(label).digest('hex');
const NOW = '2026-10-20T12:00:00.000Z';
const LAUNCH_ENV = 'SDD_DELIVERY_LAUNCH_AUTHORITY';
// Fixture-only launcher secret (>= 32 chars); never a real credential.
const FIXTURE_SECRET = 'delivery-gate-fixture-launch-authority-0123456789abcdef';
const REQUIRED_CHECK_NAME = 'delivery-gate';

function childEnv(overrides = {}) {
  const env = { ...process.env, ...overrides };
  delete env.NODE_TEST_CONTEXT;
  return env;
}

// --- minimal block-YAML subset parser (no npm dependencies) ------------------
// Parses exactly the subset delivery-gate.yml uses: comments, nested block
// maps, block sequences, `|` block scalars, plain/quoted scalars.

function parseYaml(text) {
  const lines = [];
  for (const raw of String(text).split(/\r?\n/)) {
    if (raw.trim() === '' || /^\s*#/.test(raw)) continue;
    lines.push(raw);
  }
  let pos = 0;
  const indentOf = (line) => line.length - line.trimStart().length;

  const scalar = (value) => {
    const t = value.trim();
    if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1);
    return t;
  };

  function parseNode(indent) {
    if (pos >= lines.length) return null;
    const line = lines[pos];
    if (indentOf(line) < indent) return null;
    if (line.trimStart().startsWith('- ')) return parseSequence(indentOf(line));
    return parseMapping(indentOf(line));
  }

  function parseMapping(indent) {
    const map = {};
    while (pos < lines.length) {
      const line = lines[pos];
      const at = indentOf(line);
      if (at !== indent || line.trimStart().startsWith('- ')) break;
      const match = line.trim().match(/^([^:]+):\s*(.*)$/);
      if (!match) throw new Error(`unparsable mapping line: ${JSON.stringify(line)}`);
      const key = match[1].trim();
      const rest = match[2].trim();
      pos += 1;
      if (rest === '|' || rest === '|-') {
        const content = [];
        while (pos < lines.length && indentOf(lines[pos]) > indent) {
          content.push(lines[pos].slice(indent + 2));
          pos += 1;
        }
        map[key] = content.join('\n');
      } else if (rest === '') {
        map[key] = pos < lines.length && indentOf(lines[pos]) > indent ? parseNode(indentOf(lines[pos])) : null;
      } else {
        map[key] = scalar(rest);
      }
    }
    return map;
  }

  function parseSequence(indent) {
    const seq = [];
    while (pos < lines.length) {
      const line = lines[pos];
      if (indentOf(line) !== indent || !line.trimStart().startsWith('- ')) break;
      const item = line.trimStart().slice(2);
      pos += 1;
      if (item.includes(': ')) {
        // Inline first key of a mapping item; continue with the deeper lines.
        const inner = indent + 2;
        lines.splice(pos, 0, `${' '.repeat(inner)}${item}`);
        seq.push(parseMapping(inner));
      } else {
        seq.push(scalar(item));
      }
    }
    return seq;
  }

  return parseNode(0);
}

// --- chain / gate fixtures (real admission shapes, values only in tmpdir) ----

function contractFixture(capability) {
  return {
    schemaVersion: 1,
    project: 'sdd-harness-pilot',
    change: 'delivery-foundation-rearchitecture',
    cases: [{ id: 'c1', ac: 'A13', oracle: 'the protected gate re-verifies the exact integration candidate' }],
    requiredChecks: [{ level: 'gate', capability }],
    executionDenominator: { totalCases: 1 },
    cleanup: { environment: 'tmp fixture removed after run', data: 'none persisted' },
    dependencyBaselines: [{ kind: 'product', digest: DIGEST('product-r1') }],
  };
}

// The gate evidence stream the CI verifier consumes: envelope + launcher-issued
// dispatch pairs. The dispatches are genuinely signed by a fixture launch
// authority; the verifier re-admits them through lib/delivery/evidence.js.
function gateSectionFixture({ candidateLabel = 'candidate-r1', execution = 'exec-verifier-ci-1' } = {}) {
  const launcher = createLaunchAuthority({ secret: FIXTURE_SECRET });
  const inputDigest = DIGEST(candidateLabel);
  const policyDigest = DIGEST('policy/managed-pilot@r1');
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
    evidence: [{ uri: '.whitebox/c1/tap.txt', sha256: DIGEST('tap-output') }],
    expiry: '2026-11-01T00:00:00.000Z',
  };
  const dispatch = launcher.issueDispatch({
    runnerId: 'runner-1',
    run: 'run-ci-1',
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
    builderExecution: 'exec-builder-ci-1',
    testContract: contractFixture('unit:node:test'),
    policy: { ref: 'policy/managed-pilot', digest: policyDigest },
    environment: 'managed-pilot-env-1',
    now: NOW,
    entries: [{ envelope, dispatch }],
  };
}

function chainFixture(overrides = {}) {
  return {
    project: 'sdd-harness-pilot',
    head: SHA('a'),
    merge: SHA('b'),
    requiredChecks: [REQUIRED_CHECK_NAME],
    checks: [{ name: REQUIRED_CHECK_NAME, boundSha: SHA('b'), conclusion: 'success' }],
    gate: gateSectionFixture(),
    ...overrides,
  };
}

function writeTmpJson(root, rel, value) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
  return file;
}

// Registered-baseline fixture: the committed ci-policy with an admin-registered
// required-check set (registration is the platform admin's step — simulated
// only inside tmpdir, never in the live file).
function registeredPolicyFixture(root, { names = [REQUIRED_CHECK_NAME], mutate = () => {} } = {}) {
  const policy = JSON.parse(fs.readFileSync(path.join(committedPolicyDir, 'ci-policy.json'), 'utf8'));
  policy.requiredChecks.registrationStatus = 'REGISTERED';
  policy.requiredChecks.names = names;
  mutate(policy);
  return path.dirname(writeTmpJson(root, 'platform/ci-policy.json', policy));
}

function runGate(chainFile, { policyDir = committedPolicyDir, env = {} } = {}) {
  const args = [cliPath, '--chain', chainFile, '--policy-dir', policyDir, '--json'];
  return spawnSync(process.execPath, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: RUN_TIMEOUT_MS,
    env: childEnv({ [LAUNCH_ENV]: FIXTURE_SECRET, ...env }),
  });
}

function parseVerdict(result, label) {
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new AssertionError({ message: `${label}: stdout is not JSON\nstdout: ${result.stdout}\nstderr: ${result.stderr}` });
  }
}

function tmpRoot(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `p4-1-${label}-`));
}

// --- workflow structure (real file parse) ------------------------------------

test('RED->GREEN delivery-gate.yml exists and parses as the protected CI entry', () => {
  const workflow = parseYaml(fs.readFileSync(workflowPath, 'utf8'));
  assert.equal(workflow.name, 'delivery-gate');
  assert.ok(workflow.on, 'the workflow must run from repository events');
  for (const event of ['pull_request', 'merge_group', 'push']) {
    assert.ok(Object.hasOwn(workflow.on, event), `missing trigger: ${event}`);
  }
});

test('delivery-gate.yml declares the gate job running tools/ci/verify-delivery.mjs', () => {
  const workflow = parseYaml(fs.readFileSync(workflowPath, 'utf8'));
  const job = workflow.jobs?.['delivery-gate'];
  assert.ok(job, 'the delivery-gate job must exist');
  const steps = job.steps ?? [];
  const runs = steps.map((step) => String(step.run ?? ''));
  const verifyStep = runs.find((run) => run.includes('tools/ci/verify-delivery.mjs'));
  assert.ok(verifyStep, 'a step must run tools/ci/verify-delivery.mjs');
  assert.ok(verifyStep.includes('--chain'), 'the verifier must consume a chain file');
});

test('delivery-gate.yml pins collection and checkout to the exact integration SHA (A13)', () => {
  const workflow = parseYaml(fs.readFileSync(workflowPath, 'utf8'));
  const job = workflow.jobs?.['delivery-gate'];
  const steps = job.steps ?? [];
  const checkout = steps.find((step) => String(step.uses ?? '').startsWith('actions/checkout'));
  assert.ok(checkout, 'a checkout step must exist');
  const ref = checkout.with?.ref ?? '';
  assert.ok(
    ref.includes('merge_commit_sha') || ref.includes('merge_group'),
    `checkout must pin the exact integration SHA, got: ${ref}`,
  );
  const runs = steps.map((step) => String(step.run ?? ''));
  const collect = runs.find((run) => run.includes('check-runs'));
  assert.ok(collect, 'a step must read back the protected check runs');
  assert.ok(collect.includes('boundSha') && collect.includes('head_sha'), 'the readback must record the bound SHA');
  assert.ok(collect.includes('MERGE_SHA'), 'the readback must target the exact merge SHA');
});

test('delivery-gate.yml takes the required-check policy from the protected baseline, never hardcoded names', () => {
  const workflow = parseYaml(fs.readFileSync(workflowPath, 'utf8'));
  const job = workflow.jobs?.['delivery-gate'];
  const runs = (job.steps ?? []).map((step) => String(step.run ?? ''));
  const joined = runs.join('\n');
  assert.ok(
    joined.includes('infra/delivery/platform/ci-policy.json'),
    'a step must read the required-check policy from the protected baseline',
  );
  assert.ok(joined.includes('requiredChecks') && joined.includes('names'), 'the assembly must pass the registered names');
  assert.ok(joined.includes('tools/infra/platform.mjs validate'), 'the protected baseline must be validated fail-closed first');
  // No fabricated required-check name list may appear anywhere in the workflow.
  const withoutRuns = JSON.stringify({ ...workflow, jobs: { 'delivery-gate': { ...job, steps: undefined } } });
  assert.ok(!withoutRuns.includes('requiredChecks'), 'the workflow must not declare required-check names itself');
});

test('delivery-gate.yml fails closed: least-privilege permissions, serialized concurrency, launch secret from secrets', () => {
  const workflow = parseYaml(fs.readFileSync(workflowPath, 'utf8'));
  assert.deepEqual(workflow.permissions, { contents: 'read', checks: 'read' });
  assert.equal(workflow.concurrency?.['cancel-in-progress'], 'false');
  const job = workflow.jobs?.['delivery-gate'];
  assert.ok(
    String(job.env?.[LAUNCH_ENV] ?? '').includes('secrets.'),
    'the launch authority must come from repository secrets, never a literal',
  );
  assert.ok(job['timeout-minutes'], 'the gate job must have a timeout');
});

test('delivery-gate.yml wires only the launch authority secret — the CI identity never reads release or rollback material', () => {
  const workflow = parseYaml(fs.readFileSync(workflowPath, 'utf8'));
  const secretRefs = [...new Set(JSON.stringify(workflow).match(/secrets\.[A-Za-z0-9_]+/g) ?? [])];
  assert.deepEqual(
    secretRefs,
    ['secrets.SDD_DELIVERY_LAUNCH_AUTHORITY'],
    'the gate job must receive only the trusted-launcher secret; registry, deploy and rollback secrets are release material a development-side CI identity must never read (artifact-reader rule, infra/delivery/secrets.refs.example.json)',
  );
});

// --- verify-delivery.mjs: real subprocess, positive and negative -------------

test('GREEN chain with registered baseline: exact-SHA evidence and passing gate verify (exit 0)', () => {
  const root = tmpRoot('green');
  const policyDir = registeredPolicyFixture(root);
  const chainFile = writeTmpJson(root, 'chain.json', chainFixture());
  const result = runGate(chainFile, { policyDir });
  const verdict = parseVerdict(result, 'green chain');
  assert.equal(result.status, 0, `expected exit 0, stderr: ${result.stderr}`);
  assert.equal(verdict.status, 'VERIFIED');
  assert.equal(verdict.mergeBlocked, false);
  assert.deepEqual(verdict.codes, []);
  assert.equal(verdict.checks.verdict, 'PASS');
  assert.equal(verdict.gate.verdict, 'pass');
  assert.ok(verdict.gate.receipt, 'a passing gate must emit its receipt');
});

test('A13 missing required check: the merge is blocked with CHECK_MISSING (exit 2)', () => {
  const root = tmpRoot('missing');
  const policyDir = registeredPolicyFixture(root);
  const chainFile = writeTmpJson(root, 'chain.json', chainFixture({ checks: [] }));
  const result = runGate(chainFile, { policyDir });
  const verdict = parseVerdict(result, 'missing check');
  assert.equal(result.status, 2);
  assert.equal(verdict.status, 'BLOCKED');
  assert.equal(verdict.mergeBlocked, true);
  assert.ok(verdict.codes.includes('CHECK_MISSING'));
});

test('A13 stale evidence on a new integration SHA: old boundSha is refused (CHECK_STALE_EVIDENCE, exit 2)', () => {
  const root = tmpRoot('stale-sha');
  const policyDir = registeredPolicyFixture(root);
  // The candidate moved (new head/merge); the check evidence still binds the OLD merge SHA.
  const chainFile = writeTmpJson(
    root,
    'chain.json',
    chainFixture({
      head: SHA('c'),
      merge: SHA('d'),
      checks: [{ name: REQUIRED_CHECK_NAME, boundSha: SHA('b'), conclusion: 'success' }],
      gate: gateSectionFixture({ candidateLabel: 'candidate-r2' }),
    }),
  );
  const result = runGate(chainFile, { policyDir });
  const verdict = parseVerdict(result, 'stale sha');
  assert.equal(result.status, 2);
  assert.equal(verdict.status, 'BLOCKED');
  assert.equal(verdict.mergeBlocked, true);
  assert.ok(verdict.codes.includes('CHECK_STALE_EVIDENCE'));
});

test('F09 skipped and timed-out checks are never passed (CHECK_SKIPPED / CHECK_TIMED_OUT, exit 2)', () => {
  const root = tmpRoot('skip-timeout');
  const policyDir = registeredPolicyFixture(root);
  for (const [conclusion, expectedCode, timedOut] of [
    ['skipped', 'CHECK_SKIPPED', undefined],
    ['success', 'CHECK_TIMED_OUT', true],
    ['timed_out', 'CHECK_TIMED_OUT', undefined],
    ['failure', 'CHECK_NOT_SUCCESS', undefined],
  ]) {
    const chainFile = writeTmpJson(
      root,
      `chain-${expectedCode}-${conclusion}-${String(timedOut)}.json`,
      chainFixture({ checks: [{ name: REQUIRED_CHECK_NAME, boundSha: SHA('b'), conclusion, timedOut }] }),
    );
    const result = runGate(chainFile, { policyDir });
    const verdict = parseVerdict(result, `${expectedCode}/${conclusion}`);
    assert.equal(result.status, 2, `${expectedCode} must exit 2`);
    assert.equal(verdict.status, 'BLOCKED');
    assert.equal(verdict.mergeBlocked, true);
    assert.ok(verdict.codes.includes(expectedCode), `${conclusion} must produce ${expectedCode}`);
  }
});

test('F06 workflow success never substitutes delivery: all checks green but the gate receipt is stale (exit 2)', () => {
  const root = tmpRoot('stale-gate');
  const policyDir = registeredPolicyFixture(root);
  // Receipts built for an older candidate digest: admission refuses them as stale.
  const staleGate = gateSectionFixture({ candidateLabel: 'candidate-old' });
  staleGate.inputDigest = DIGEST('candidate-new');
  staleGate.testContract = contractFixture('unit:node:test');
  const chainFile = writeTmpJson(root, 'chain.json', chainFixture({ gate: staleGate }));
  const result = runGate(chainFile, { policyDir });
  const verdict = parseVerdict(result, 'stale gate');
  assert.equal(result.status, 2);
  assert.equal(verdict.status, 'BLOCKED');
  assert.equal(verdict.mergeBlocked, true);
  assert.ok(
    verdict.codes.some((code) => code.startsWith('ADMISSION_REFUSED')),
    'stale receipts must be refused by the real admission path',
  );
});

test('F06 a forged dispatch never signs the gate (ADMISSION_REFUSED, exit 2)', () => {
  const root = tmpRoot('forged');
  const policyDir = registeredPolicyFixture(root);
  const gate = gateSectionFixture();
  const [entry] = gate.entries;
  gate.entries = [{ envelope: entry.envelope, dispatch: { ...entry.dispatch, attempt: 2 } }];
  const chainFile = writeTmpJson(root, 'chain.json', chainFixture({ gate }));
  const result = runGate(chainFile, { policyDir });
  const verdict = parseVerdict(result, 'forged dispatch');
  assert.equal(result.status, 2);
  assert.equal(verdict.status, 'BLOCKED');
  assert.ok(verdict.codes.some((code) => code.startsWith('ADMISSION_REFUSED')));
});

test('F06 an empty evidence stream cannot satisfy the gate (blocked receipt, exit 2)', () => {
  const root = tmpRoot('no-entries');
  const policyDir = registeredPolicyFixture(root);
  const gate = gateSectionFixture();
  gate.entries = [];
  const chainFile = writeTmpJson(root, 'chain.json', chainFixture({ gate }));
  const result = runGate(chainFile, { policyDir });
  const verdict = parseVerdict(result, 'no entries');
  assert.equal(result.status, 2);
  assert.equal(verdict.status, 'BLOCKED');
  assert.equal(verdict.gate.verdict, 'blocked');
  assert.ok(verdict.gate.blocked.length > 0, 'the gate receipt must name what is missing');
});

test('Platform precondition: committed UNSELECTED baseline blocks the platform-merge authorization (UNVERIFIED, exit 2)', () => {
  const root = tmpRoot('authority');
  // Fully green chain against the committed protected baseline.
  const chainFile = writeTmpJson(root, 'chain.json', chainFixture());
  const result = runGate(chainFile);
  const verdict = parseVerdict(result, 'authority');
  assert.equal(result.status, 2);
  assert.equal(verdict.status, 'UNVERIFIED');
  assert.equal(verdict.mergeBlocked, true, 'unregistered required checks block the related action');
  assert.ok(verdict.codes.includes('PLATFORM_REQUIRED_CHECK_AUTHORITY_REQUIRED'));
});

test('Protected baseline drift: a chain claiming a different required set than the registered one is blocked', () => {
  const root = tmpRoot('mismatch');
  const policyDir = registeredPolicyFixture(root, { names: [REQUIRED_CHECK_NAME, 'release-protocol'] });
  const chainFile = writeTmpJson(root, 'chain.json', chainFixture());
  const result = runGate(chainFile, { policyDir });
  const verdict = parseVerdict(result, 'mismatch');
  assert.equal(result.status, 2);
  assert.equal(verdict.status, 'BLOCKED');
  assert.ok(verdict.codes.includes('REQUIRED_CHECKS_POLICY_MISMATCH'));
});

test('An invalid protected baseline fails closed (PROTECTED_BASELINE_INVALID, exit 2)', () => {
  const root = tmpRoot('bad-policy');
  const policyDir = registeredPolicyFixture(root, { mutate: (policy) => { policy.requiredChecks.failClosed = false; } });
  const chainFile = writeTmpJson(root, 'chain.json', chainFixture());
  const result = runGate(chainFile, { policyDir });
  const verdict = parseVerdict(result, 'bad policy');
  assert.equal(result.status, 2);
  assert.ok(verdict.codes.includes('PROTECTED_BASELINE_INVALID'));
});

test('Missing launch authority keeps the gate unjudgeable — never a pass (UNVERIFIED, exit 2)', () => {
  const root = tmpRoot('no-secret');
  const policyDir = registeredPolicyFixture(root);
  const chainFile = writeTmpJson(root, 'chain.json', chainFixture());
  const env = { [LAUNCH_ENV]: '' };
  const result = runGate(chainFile, { policyDir, env });
  const verdict = parseVerdict(result, 'no secret');
  assert.equal(result.status, 2);
  assert.equal(verdict.status, 'UNVERIFIED');
  assert.equal(verdict.mergeBlocked, true);
  assert.ok(verdict.codes.includes('LAUNCH_AUTHORITY_MISSING'));
});

test('Invalid inputs are input failures (exit 1): unreadable file, bad JSON, bad SHA, missing gate section', () => {
  const root = tmpRoot('inputs');
  const missing = runGate(path.join(root, 'does-not-exist.json'));
  assert.equal(missing.status, 1);

  const malformedFile = path.join(root, 'malformed.json');
  fs.writeFileSync(malformedFile, '{ not json');
  assert.equal(runGate(malformedFile).status, 1);

  const badSha = writeTmpJson(root, 'bad-sha.json', chainFixture({ merge: 'nothex' }));
  assert.equal(runGate(badSha).status, 1);

  const noGate = writeTmpJson(root, 'no-gate.json', { ...chainFixture(), gate: null });
  const noGateResult = runGate(noGate);
  assert.equal(noGateResult.status, 1);
  assert.ok(/gate/i.test(noGateResult.stderr), 'the refusal must name the missing gate receipts');

  assert.equal(spawnSync(process.execPath, [cliPath], { encoding: 'utf8', env: childEnv() }).status, 1, '--chain is required');
});

test('The structured verdict records the candidate identity and never leaks host paths', () => {
  const root = tmpRoot('verdict-shape');
  const policyDir = registeredPolicyFixture(root);
  const chainFile = writeTmpJson(root, 'chain.json', chainFixture());
  const result = runGate(chainFile, { policyDir });
  const verdict = parseVerdict(result, 'verdict shape');
  assert.equal(verdict.interface, 'DeliveryGate.v1');
  assert.equal(verdict.head, SHA('a'));
  assert.equal(verdict.merge, SHA('b'));
  assert.equal(verdict.project, 'sdd-harness-pilot');
  assert.deepEqual(verdict.policy.requiredChecks.names, [REQUIRED_CHECK_NAME]);
  assert.deepEqual(verdict.checks.required, [REQUIRED_CHECK_NAME]);
  assert.ok(!result.stdout.includes(root), 'host fixture paths must stay out of the structured verdict');
  assert.ok(!result.stdout.includes('/Users/'), 'host paths must stay out of the structured verdict');

test('duplicate check runs for the same name+merge resolve to the latest run id (fail-closed latest-wins, OBS-1)', () => {
  const root = tmpRoot('p41-latest-wins');
  const policyDir = committedPolicyDir;
  // older success (id 100) followed by a newer failure (id 200): the gate
  // must refuse — an older success must not mask the latest conclusion.
  const chainFail = chainFixture({
    checks: [
      { id: 100, name: REQUIRED_CHECK_NAME, boundSha: SHA('b'), conclusion: 'success' },
      { id: 200, name: REQUIRED_CHECK_NAME, boundSha: SHA('b'), conclusion: 'failure' },
    ],
  });
  const chainFailFile = writeTmpJson(root, 'chain-fail.json', chainFail);
  const runFail = runGate(chainFailFile, { policyDir });
  assert.equal(runFail.status, 2, `older success must not mask newer failure, got ${runFail.status}`);
  const verdictFail = parseVerdict(runFail, 'latest-wins fail');
  assert.ok(JSON.stringify(verdictFail).includes('CHECK_NOT_SUCCESS'), 'the newer failure must drive the verdict');

  // a newer successful rerun (id 300) is authoritative: the gate passes.
  const chainPass = chainFixture({
    checks: [
      { id: 200, name: REQUIRED_CHECK_NAME, boundSha: SHA('b'), conclusion: 'failure' },
      { id: 300, name: REQUIRED_CHECK_NAME, boundSha: SHA('b'), conclusion: 'success' },
    ],
  });
  const chainPassFile = writeTmpJson(root, 'chain-pass.json', chainPass);
  const runPass = runGate(chainPassFile, { policyDir });
  // LOCAL_ONLY gate: all-green checks advance the gate to the platform
  // admission precondition (registration unprovisioned -> UNVERIFIED),
  // so the full-gate exit is 2. The latest-wins semantics live in the
  // per-check verdict: the newer run id (300) must drive a PASS verdict.
  const passVerdict = parseVerdict(runPass, 'latest-wins pass');
  assert.equal(passVerdict.checks.verdict, 'PASS', 'the newer successful run must drive the required-check verdict');
  const passEntry = (passVerdict.checks.perCheck ?? []).find((entry) => entry.name === REQUIRED_CHECK_NAME);
  assert.ok(passEntry, 'the required check entry must be present');
  assert.equal(passEntry.verdict, 'PASS', 'latest run conclusion (success) must drive the per-check verdict');
  assert.equal(passVerdict.status, 'UNVERIFIED', 'platform admission stays honestly unverified in LOCAL_ONLY');
});
});

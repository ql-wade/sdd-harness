// P4_1 delivery case: the protected CI delivery gate re-verifies contract and
// provenance for the exact integration SHA, and missing, skipped, timed-out or
// stale evidence actually blocks the platform merge (A13/F06/F09).
//
// Coverage:
//   4.1.a  protected integration-check entry — .github/workflows/delivery-gate.yml
//          declares the delivery-gate job, takes the required-check policy from
//          the protected baseline (infra/delivery/platform/ci-policy.json) and
//          pins checkout/collection to the exact merge SHA; the verifier
//          tools/ci/verify-delivery.mjs consumes real chain files as a real
//          subprocess (V_A13 exact-SHA rebinding: evidence bound to an older
//          merge SHA never authorizes a new candidate).
//   4.1.b  platform blocking — skip and timed-out checks are never passed
//          (CHECK_SKIPPED / CHECK_TIMED_OUT), the same candidate digest must
//          run through verification (a receipt bound to another digest is
//          refused by the real admission path), and the committed UNSELECTED
//          baseline honestly keeps the platform-merge authorization UNVERIFIED
//          (PLATFORM_REQUIRED_CHECK_AUTHORITY_REQUIRED — plan fields never
//          satisfy it; real protected-CI registration stays with the platform
//          admission owner, then P4_2).
//
// CLI exit contract (execution-contract.json V_A13/V_F09.cli_contract):
//   0=PASS, 1=invalid input/prerequisite, 2=verification failure; missing
//   environment is explicitly UNVERIFIED and nonzero; never skip-to-PASS.
//
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
const workflowPath = path.join(projectRoot, '.github', 'workflows', 'delivery-gate.yml');
const cliPath = path.join(projectRoot, 'tools', 'ci', 'verify-delivery.mjs');
const committedPolicyDir = path.join(projectRoot, 'infra', 'delivery', 'platform');

const RUN_TIMEOUT_MS = 120_000;
const SHA = (ch) => ch.repeat(40);
const DIGEST = (label) => crypto.createHash('sha256').update(label).digest('hex');
const NOW = '2026-10-20T12:00:00.000Z';
const LAUNCH_ENV = 'SDD_DELIVERY_LAUNCH_AUTHORITY';
const FIXTURE_SECRET = 'delivery-case-p4-1-fixture-launch-authority-0123456789';
const REQUIRED_CHECK_NAME = 'delivery-gate';

function childEnv(overrides = {}) {
  const env = { ...process.env, ...overrides };
  delete env.NODE_TEST_CONTEXT;
  return env;
}

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
    return line.trimStart().startsWith('- ') ? parseSequence(indentOf(line)) : parseMapping(indentOf(line));
  }
  function parseMapping(indent) {
    const map = {};
    while (pos < lines.length) {
      const line = lines[pos];
      if (indentOf(line) !== indent || line.trimStart().startsWith('- ')) break;
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

function contractFixture(capability) {
  return {
    schemaVersion: 1,
    project: 'sdd-harness-pilot',
    change: 'delivery-foundation-rearchitecture',
    cases: [{ id: 'c1', ac: 'A13', oracle: 'the protected gate re-verifies the exact integration candidate' }],
    requiredChecks: [{ level: 'gate', capability }],
    executionDenominator: { totalCases: 1 },
    cleanup: { environment: 'tmp fixture removed after run', data: 'none persisted' },
    dependencyBaselines: [{ kind: 'product', digest: DIGEST('product-case-r1') }],
  };
}

function gateSectionFixture({ candidateLabel = 'case-candidate-r1', execution = 'exec-verifier-case-1' } = {}) {
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
    evidence: [{ uri: '.whitebox/c1/tap.txt', sha256: DIGEST('tap-output-case') }],
    expiry: '2026-11-01T00:00:00.000Z',
  };
  const dispatch = launcher.issueDispatch({
    runnerId: 'runner-1',
    run: 'run-case-1',
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
    builderExecution: 'exec-builder-case-1',
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

function registeredPolicyFixture(root) {
  const policy = JSON.parse(fs.readFileSync(path.join(committedPolicyDir, 'ci-policy.json'), 'utf8'));
  policy.requiredChecks.registrationStatus = 'REGISTERED';
  policy.requiredChecks.names = [REQUIRED_CHECK_NAME];
  const dir = path.join(root, 'platform');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'ci-policy.json'), JSON.stringify(policy, null, 2));
  return dir;
}

function writeChain(root, name, chain) {
  const file = path.join(root, name);
  fs.writeFileSync(file, JSON.stringify(chain, null, 2));
  return file;
}

function runGate(chainFile, { policyDir = committedPolicyDir } = {}) {
  return spawnSync(process.execPath, [cliPath, '--chain', chainFile, '--policy-dir', policyDir, '--json'], {
    cwd: projectRoot,
    encoding: 'utf8',
    timeout: RUN_TIMEOUT_MS,
    env: childEnv({ [LAUNCH_ENV]: FIXTURE_SECRET }),
  });
}

function parseVerdict(result, label) {
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new AssertionError({ message: `${label}: stdout is not JSON\nstdout: ${result.stdout}\nstderr: ${result.stderr}` });
  }
}

test('setup: the delivery gate artifacts exist — the workflow parses and the verifier is a real executable script', () => {
  const workflow = parseYaml(fs.readFileSync(workflowPath, 'utf8'));
  assert.equal(workflow.name, 'delivery-gate');
  assert.ok(workflow.jobs?.['delivery-gate'], 'the delivery-gate job must be declared');
  const runs = (workflow.jobs['delivery-gate'].steps ?? []).map((step) => String(step.run ?? ''));
  assert.ok(runs.some((run) => run.includes('tools/ci/verify-delivery.mjs')), 'the job must run the verifier');
  assert.equal(fs.statSync(cliPath).isFile(), true);
});

test('V_A13: the protected entry re-verifies the exact new integration candidate — stale-SHA evidence is blocked, exact-SHA evidence passes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p4-1-case-a13-'));
  const policyDir = registeredPolicyFixture(root);
  // Candidate r2 (head/merge moved); the only check evidence still binds r1's merge SHA.
  const stale = writeChain(root, 'chain-stale.json', chainFixture({
    head: SHA('c'),
    merge: SHA('d'),
    checks: [{ name: REQUIRED_CHECK_NAME, boundSha: SHA('b'), conclusion: 'success' }],
    gate: gateSectionFixture({ candidateLabel: 'case-candidate-r2' }),
  }));
  const staleResult = runGate(stale, { policyDir });
  const staleVerdict = parseVerdict(staleResult, 'V_A13 stale');
  assert.equal(staleResult.status, 2, 'old evidence must not authorize the new candidate');
  assert.equal(staleVerdict.mergeBlocked, true);
  assert.ok(staleVerdict.codes.includes('CHECK_STALE_EVIDENCE'), `codes: ${JSON.stringify(staleVerdict.codes)}`);

  // The same candidate with evidence bound to the exact new merge SHA verifies.
  const exact = writeChain(root, 'chain-exact.json', chainFixture({
    head: SHA('c'),
    merge: SHA('d'),
    checks: [{ name: REQUIRED_CHECK_NAME, boundSha: SHA('d'), conclusion: 'success' }],
    gate: gateSectionFixture({ candidateLabel: 'case-candidate-r2' }),
  }));
  const exactResult = runGate(exact, { policyDir });
  const exactVerdict = parseVerdict(exactResult, 'V_A13 exact');
  assert.equal(exactResult.status, 0, `stderr: ${exactResult.stderr}`);
  assert.equal(exactVerdict.status, 'VERIFIED');
  assert.equal(exactVerdict.mergeBlocked, false);
});

test('V_F09: skip and timeout are never passed — the gate blocks with CHECK_SKIPPED / CHECK_TIMED_OUT', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p4-1-case-f09-'));
  const policyDir = registeredPolicyFixture(root);
  for (const [label, check] of [
    ['skipped', { name: REQUIRED_CHECK_NAME, boundSha: SHA('b'), conclusion: 'skipped' }],
    ['timed-out-flag', { name: REQUIRED_CHECK_NAME, boundSha: SHA('b'), conclusion: 'success', timedOut: true }],
    ['timed-out-conclusion', { name: REQUIRED_CHECK_NAME, boundSha: SHA('b'), conclusion: 'timed_out' }],
  ]) {
    const chainFile = writeChain(root, `chain-${label}.json`, chainFixture({ checks: [check] }));
    const result = runGate(chainFile, { policyDir });
    const verdict = parseVerdict(result, `V_F09 ${label}`);
    assert.equal(result.status, 2, `${label} must block`);
    assert.equal(verdict.mergeBlocked, true);
    assert.ok(
      verdict.codes.includes('CHECK_SKIPPED') || verdict.codes.includes('CHECK_TIMED_OUT'),
      `${label} must produce a skip/timeout code, got ${JSON.stringify(verdict.codes)}`,
    );
  }
});

test('V_F09: the same candidate digest runs through verification — a receipt bound to another digest is refused, the exact-digest chain verifies', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p4-1-case-digest-'));
  const policyDir = registeredPolicyFixture(root);
  // Receipts built for an older digest cannot authorize the new candidate digest.
  const staleGate = gateSectionFixture({ candidateLabel: 'case-candidate-old' });
  staleGate.inputDigest = DIGEST('case-candidate-new');
  const stale = writeChain(root, 'chain-stale-digest.json', chainFixture({ gate: staleGate }));
  const staleResult = runGate(stale, { policyDir });
  const staleVerdict = parseVerdict(staleResult, 'V_F09 stale digest');
  assert.equal(staleResult.status, 2);
  assert.equal(staleVerdict.mergeBlocked, true);
  assert.ok(
    staleVerdict.codes.some((code) => code.startsWith('ADMISSION_REFUSED')),
    `stale receipts must be refused: ${JSON.stringify(staleVerdict.codes)}`,
  );

  const exact = writeChain(root, 'chain-exact-digest.json', chainFixture());
  const exactResult = runGate(exact, { policyDir });
  const exactVerdict = parseVerdict(exactResult, 'V_F09 exact digest');
  assert.equal(exactResult.status, 0, `stderr: ${exactResult.stderr}`);
  assert.equal(exactVerdict.gate.verdict, 'pass');
  assert.equal(exactVerdict.gate.receipt.inputDigest, DIGEST('case-candidate-r1'), 'the receipt binds the candidate digest');
});

test('P4_1: the committed UNSELECTED baseline keeps the platform-merge authorization UNVERIFIED — plan fields never satisfy it', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p4-1-case-authority-'));
  // A fully green chain cannot conjure the missing admin registration.
  const chainFile = writeChain(root, 'chain.json', chainFixture());
  const result = runGate(chainFile);
  const verdict = parseVerdict(result, 'P4_1 authority');
  assert.equal(result.status, 2);
  assert.equal(verdict.status, 'UNVERIFIED');
  assert.equal(verdict.mergeBlocked, true);
  assert.ok(verdict.codes.includes('PLATFORM_REQUIRED_CHECK_AUTHORITY_REQUIRED'));
});

test('P4_1: the workflow takes the check policy from the protected baseline and pins the exact merge SHA — no fabricated names', () => {
  const workflow = parseYaml(fs.readFileSync(workflowPath, 'utf8'));
  const job = workflow.jobs['delivery-gate'];
  const runs = (job.steps ?? []).map((step) => String(step.run ?? ''));
  const joined = runs.join('\n');
  assert.ok(joined.includes('infra/delivery/platform/ci-policy.json'), 'the required-check set must come from the protected baseline');
  assert.ok(joined.includes('tools/infra/platform.mjs validate'), 'the protected baseline must be validated before the gate runs');
  const checkout = (job.steps ?? []).find((step) => String(step.uses ?? '').startsWith('actions/checkout'));
  assert.ok(String(checkout?.with?.ref ?? '').includes('merge_commit_sha'), 'checkout must pin the exact integration SHA');
  const withoutRuns = JSON.stringify({ ...workflow, jobs: { 'delivery-gate': { ...job, steps: undefined } } });
  assert.ok(!withoutRuns.includes('requiredChecks'), 'the workflow must not fabricate required-check names itself');
});

test('P4_1 comet-050: the committed baseline registers the platform readback honestly — UNPROTECTED_READ_BACK keeps the set UNSELECTED', () => {
  const policy = JSON.parse(fs.readFileSync(path.join(committedPolicyDir, 'ci-policy.json'), 'utf8'));
  // The 2026-10-26 read-only readback observed master unprotected (404 branch
  // protection, empty rulesets) with zero check-run evidence for both candidate
  // names: an unprotected platform can never ground a registered set.
  assert.equal(policy.requiredChecks.registrationStatus, 'UNSELECTED', 'an unprotected platform cannot ground a registered set');
  assert.deepEqual(policy.requiredChecks.names, [], 'no required-check names may be fabricated while the platform enforces none');
  const note = String(policy.provider.note ?? '');
  assert.ok(note.includes('UNPROTECTED_READ_BACK'), 'the 2026-10-26 readback observation must stay recorded in the protected baseline');
  assert.ok(note.includes('branches/master/protection'), 'the recorded observation must name the readback endpoint it came from');
  // The blocking red lines stay complete in the live baseline (P4_1 four-code
  // floor + I06 QUEUED extension).
  for (const code of ['MISSING', 'SKIPPED', 'TIMED_OUT', 'STALE_EVIDENCE', 'QUEUED']) {
    assert.ok(policy.requiredChecks.blockingSemantics.includes(code), `blocking semantics must keep ${code}`);
  }
});

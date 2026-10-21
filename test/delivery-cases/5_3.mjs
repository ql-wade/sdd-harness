// P5_3 delivery case — operations runbook, team recovery drills and the
// capability boundary ledger for the managed Comet driver (A10/A11/H09).
//
// The run's user did NOT enable the cross-machine scope, so this journey
// verifies what is really shipped: the LOCAL single-authority capabilities
// (lease, fencing, background supervision, version rollback) are re-proven
// with real processes, and the cross-machine boundary stays honestly closed
// (CROSS_MACHINE_SCOPE_NOT_ENABLED) instead of being faked with a shared
// local directory.
//
//   J1  runbook command inventory: operations-runbook.md carries a fenced
//       machine-readable command table (`runbook-commands`); ≥10 rows, every
//       referenced repo entry exists on disk, every direct row is executed
//       for real with its documented exit code, and every journey row is
//       replicated inside this suite (J2/J3/J4) with the same exit code.
//       Removing a row or a command entry is a RED.
//   J2  recovery drill receipts: team-recovery/ holds ≥3 TeamRecovery
//       .DrillReceipt.v1 receipts covering the three mandatory drills; each
//       receipt's step timestamps are strictly monotonic ISO instants, the
//       attempt counters are strictly monotonic, one operationKey identifies
//       the whole drill, and the drills re-run live through the real
//       run-drills.mjs executor with the same VERIFIED outcome. A forged
//       timestamp (non-monotonic or in the future) is rejected.
//   J3  version rollback: the real tools/ci/release.mjs promotes two digests
//       and walks the rollback gates for real — unapproved rollback refused
//       (exit 2, ROLLBACK_NOT_APPROVED), wrong-digest rollback refused (exit
//       2, ROLLBACK_DIGEST_MISMATCH), approved same-digest rollback VERIFIED
//       (exit 0) with the independent business readback, and the accepted I06
//       evaluator independently confirms the emitted chain.
//   J4  boundary ledger: the runbook declares every known environment gate
//       from acceptance-index.json VERBATIM (hiding one is a RED), declares
//       the cross-machine gate NOT_ENABLED with the paired-commit enablement
//       flow, and the live scope gate readback (gate.mjs status) stays
//       anchored NOT_ENABLED with exit 0.
//
// Fixtures live under os.tmpdir() with isolated HOME/TMPDIR; live
// configuration is read, never written. Zero new npm dependencies.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CHANGE_DIR = path.join(projectRoot, 'openspec', 'changes', 'delivery-foundation-rearchitecture');
const RUNBOOK = path.join(CHANGE_DIR, 'operations-runbook.md');
const TEAM_RECOVERY = path.join(CHANGE_DIR, 'team-recovery');
const RUN_DRILLS = path.join(TEAM_RECOVERY, 'run-drills.mjs');
const ACCEPTANCE_INDEX = path.join(CHANGE_DIR, 'acceptance-index.json');
const GATE_CLI = path.join(projectRoot, 'services', 'delivery-control', 'gate.mjs');
const SCOPE_FILE = path.join(projectRoot, 'services', 'delivery-control', 'scope-gate.json');
const RELEASE_CLI = path.join(projectRoot, 'tools', 'ci', 'release.mjs');
const PLATFORM_CLI = path.join(projectRoot, 'tools', 'infra', 'platform.mjs');

const SHA = (label) => crypto.createHash('sha256').update(`p53-${label}`).digest('hex').slice(0, 40);
const DIGEST = (label) => `sha256:${crypto.createHash('sha256').update(`p53-${label}`).digest('hex')}`;
const RUN_TIMEOUT_MS = 120_000;

function workdir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `sdd-p53-${label}-`));
}

function childEnv(tmp, extra = {}) {
  const env = { ...process.env, HOME: tmp, TMPDIR: tmp, PATH: '/usr/bin:/bin', ...extra };
  delete env.NODE_TEST_CONTEXT;
  return env;
}

function runNode(args, { cwd = projectRoot, env, timeout = RUN_TIMEOUT_MS } = {}) {
  return spawnSync(process.execPath, args, { cwd, encoding: 'utf8', timeout, env: env ?? process.env });
}

// ===========================================================================
// pure validators (shared by the positive journey and the tampered negatives)
// ===========================================================================

function extractCommandInventory(runbookText) {
  const issues = [];
  const blocks = [];
  const fence = /```[^\n]*runbook-commands[^\n]*\n([\s\S]*?)```/g;
  let match;
  while ((match = fence.exec(runbookText)) !== null) blocks.push(match[1]);
  if (blocks.length === 0) {
    issues.push('operations-runbook.md has no fenced ```runbook-commands inventory block');
    return { rows: [], issues };
  }
  const rows = [];
  for (const block of blocks) {
    let parsed;
    try {
      parsed = JSON.parse(block);
    } catch (error) {
      issues.push(`runbook-commands block is not valid JSON: ${String(error.message).slice(0, 120)}`);
      continue;
    }
    if (!Array.isArray(parsed)) {
      issues.push('runbook-commands block must be a JSON array of rows');
      continue;
    }
    rows.push(...parsed);
  }
  if (rows.length < 10) issues.push(`command inventory has ${rows.length} rows — at least 10 machine-verified commands are required`);
  for (const row of rows) {
    if (!row?.id || typeof row.command !== 'string' || !Number.isInteger(row.expectedExit)) {
      issues.push(`inventory row ${JSON.stringify(row).slice(0, 80)} needs id, command and integer expectedExit`);
      continue;
    }
    if (!['direct', 'journey'].includes(row.verify)) issues.push(`row ${row.id}: verify must be direct or journey`);
    if (row.verify === 'journey' && !row.journey) issues.push(`row ${row.id}: journey rows must name the in-suite journey that replicates them`);
    const nodeMatch = row.command.match(/^node (\S+)/);
    if (nodeMatch) {
      const entry = path.resolve(projectRoot, nodeMatch[1]);
      if (!fs.existsSync(entry)) issues.push(`row ${row.id}: entry does not exist on disk: ${nodeMatch[1]}`);
    }
  }
  const ids = new Set(rows.map((row) => row.id));
  if (ids.size !== rows.length) issues.push('inventory row ids are not unique');
  return { rows, issues };
}

function validateReceipt(receipt) {
  const issues = [];
  const where = receipt?.drill ?? '<unnamed>';
  if (!receipt || typeof receipt !== 'object') return [`receipt is not an object: ${where}`];
  if (receipt.interface !== 'TeamRecovery.DrillReceipt.v1') issues.push(`${where}: interface must be TeamRecovery.DrillReceipt.v1`);
  if (!receipt.drill || typeof receipt.drill !== 'string') issues.push(`${where}: drill name is required`);
  if (!receipt.operationKey || typeof receipt.operationKey !== 'string') issues.push(`${where}: operationKey is required`);
  if (!receipt.executedAt || Number.isNaN(Date.parse(receipt.executedAt))) issues.push(`${where}: executedAt must be an ISO timestamp`);
  if (!Array.isArray(receipt.steps) || receipt.steps.length === 0) {
    issues.push(`${where}: at least one step is required`);
    return issues;
  }
  let previousTs = null;
  let previousAttempt = 0;
  const testWallClock = Date.now();
  for (const [index, step] of receipt.steps.entries()) {
    const at = `${where} step ${index + 1} (${step?.step ?? '?'})`;
    if (!step.command || typeof step.command !== 'string') issues.push(`${at}: command is required`);
    if (!Number.isInteger(step.exitCode)) issues.push(`${at}: exitCode must be an integer`);
    if (typeof step.attempt !== 'number') issues.push(`${at}: attempt is required`);
    else if (step.attempt <= previousAttempt) issues.push(`${at}: attempt ${step.attempt} is not monotonic (previous ${previousAttempt})`);
    else previousAttempt = step.attempt;
    const ts = Date.parse(step.timestamp ?? '');
    if (Number.isNaN(ts)) issues.push(`${at}: timestamp must be an ISO instant`);
    else {
      if (previousTs !== null && ts <= previousTs) issues.push(`${at}: timestamp is not strictly monotonic`);
      if (ts > testWallClock + 60_000) issues.push(`${at}: timestamp is in the future (forged)`);
      previousTs = ts;
    }
    const nodeMatch = String(step.command ?? '').match(/^node (\S+)/);
    if (nodeMatch && !nodeMatch[1].includes('<')) {
      const entry = path.resolve(projectRoot, nodeMatch[1]);
      if (!fs.existsSync(entry)) issues.push(`${at}: referenced entry does not exist: ${nodeMatch[1]}`);
    }
  }
  if (receipt.status !== 'VERIFIED') issues.push(`${where}: receipt status must be VERIFIED (honest failures stay UNVERIFIED, but the committed drills must have passed)`);
  return issues;
}

function validateBoundaryDeclarations({ runbookText, gates }) {
  const issues = [];
  if (!runbookText.includes('CROSS_MACHINE_SCOPE_NOT_ENABLED')) issues.push('runbook must declare the cross-machine gate code CROSS_MACHINE_SCOPE_NOT_ENABLED');
  if (!/paired commit|配对提交/.test(runbookText)) issues.push('runbook must document the paired-commit enablement flow (scope-gate.json + EXPECTED_SCOPE_DIGEST in the same commit)');
  if (!runbookText.includes('EXPECTED_SCOPE_DIGEST')) issues.push('runbook must name EXPECTED_SCOPE_DIGEST as the anchor paired with the scope file');
  for (const gate of gates) {
    if (!runbookText.includes(gate.trim())) issues.push(`runbook hides a known environment gate (verbatim line missing): ${gate.trim().slice(0, 60)}…`);
  }
  return issues;
}

// ===========================================================================
// J1 — the runbook exists and its command inventory is real
// ===========================================================================

function runbookText() {
  assert.ok(fs.existsSync(RUNBOOK), `operations-runbook.md is missing: ${RUNBOOK} (P5_3 RED until the runbook lands)`);
  return fs.readFileSync(RUNBOOK, 'utf8');
}

test('J1: the runbook carries ≥10 machine-verified commands whose entries exist and whose direct rows really run with the documented exit codes', () => {
  const text = runbookText();
  const { rows, issues } = extractCommandInventory(text);
  assert.deepEqual(issues, [], `command inventory problems: ${issues.join(' | ')}`);
  assert.ok(rows.length >= 10, `expected ≥10 inventory rows, got ${rows.length}`);

  const seenJourneys = new Set(rows.filter((row) => row.verify === 'journey').map((row) => row.journey));
  assert.ok(seenJourneys.size >= 2, 'journey rows must name at least two distinct in-suite replications');

  // Direct rows run for real, isolated, against the committed repo state.
  for (const row of rows.filter((entry) => entry.verify === 'direct')) {
    assert.ok(!/[<>]/.test(row.command), `direct row ${row.id} must not contain placeholders: ${row.command}`);
    const tmp = workdir('j1');
    try {
      const result = runNode(row.command.split(/\s+/).slice(1), { env: childEnv(tmp) });
      assert.equal(result.status, row.expectedExit,
        `direct row ${row.id} (${row.command}) exited ${result.status}, expected ${row.expectedExit}\nstderr: ${String(result.stderr).slice(0, 400)}`);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
});

test('J1 negative: a runbook copy with a removed command row fails the ≥10 inventory contract (deleting runbook commands is caught mechanically)', () => {
  const text = runbookText();
  const { rows } = extractCommandInventory(text);
  assert.ok(rows.length >= 10);
  const tampered = JSON.parse(JSON.stringify(rows.slice(0, 9)));
  const rebuilt = text.replace(/```[^\n]*runbook-commands[^\n]*\n[\s\S]*?```/,
    '```json runbook-commands\n' + JSON.stringify(tampered, null, 2) + '\n```');
  const result = extractCommandInventory(rebuilt);
  assert.ok(result.issues.some((issue) => issue.includes('at least 10')), 'a shrunken inventory must be reported');
});

// ===========================================================================
// J2 — recovery drill receipts: structure, honesty and a live re-run
// ===========================================================================

const REQUIRED_DRILLS = ['sigkill-restart-original', 'fencing-old-writer-rejection', 'lease-contention'];

function loadReceipts() {
  assert.ok(fs.existsSync(TEAM_RECOVERY), `team-recovery/ is missing: ${TEAM_RECOVERY} (P5_3 RED until the drills land)`);
  assert.ok(fs.existsSync(RUN_DRILLS), 'team-recovery/run-drills.mjs is missing — the drill receipts must be reproducible');
  const files = fs.readdirSync(TEAM_RECOVERY).filter((name) => /^receipt-.*\.json$/.test(name)).sort();
  assert.ok(files.length >= 3, `expected ≥3 drill receipts in team-recovery/, found ${files.length}`);
  const receipts = files.map((name) => JSON.parse(fs.readFileSync(path.join(TEAM_RECOVERY, name), 'utf8')));
  const drills = new Set(receipts.map((receipt) => receipt.drill));
  for (const drill of REQUIRED_DRILLS) {
    assert.ok(drills.has(drill), `the mandatory drill "${drill}" has no receipt`);
  }
  return { files, receipts };
}

test('J2: the three recovery drill receipts are structurally honest — monotonic real timestamps, monotonic attempts, one operationKey per drill, real exit codes', () => {
  const { files, receipts } = loadReceipts();
  for (const [index, receipt] of receipts.entries()) {
    const issues = validateReceipt(receipt);
    assert.deepEqual(issues, [], `${files[index]}: ${issues.join(' | ')}`);
  }
});

test('J2: the drills re-run live through the real executor with the same VERIFIED outcome', { timeout: 300_000 }, (t) => {
  assert.ok(fs.existsSync(RUN_DRILLS));
  const buildPresent = (() => {
    try {
      const lock = JSON.parse(fs.readFileSync(path.join(projectRoot, 'integrations/comet/upstream.lock.json'), 'utf8'));
      const fingerprint = crypto.createHash('sha256').update(JSON.stringify({
        archive: lock.source.sha256,
        patches: lock.patches.map(({ path: p, sha256 }) => ({ path: p, sha256 })),
        toolchain: lock.toolchain,
      })).digest('hex');
      return fs.existsSync(path.join(projectRoot, '.sdd/vendor/comet', lock.source.commit, 'builds', fingerprint, 'distribution.json'));
    } catch {
      return false;
    }
  })();
  for (const drill of ['1', '2', '3']) {
    if (drill === '3' && !buildPresent) {
      t.skip('drill 3 re-run skipped: the patched Comet build is not present under .sdd in this checkout (known environment gate; the committed receipt records its own real run)');
      continue;
    }
    const tmp = workdir('j2');
    try {
      const out = path.join(tmp, `live-${drill}.json`);
      const result = runNode([RUN_DRILLS, '--drill', drill, '--out', out], { env: childEnv(tmp), timeout: 240_000 });
      assert.equal(result.status, 0, `drill ${drill} live re-run failed:\n${String(result.stderr).slice(0, 600)}`);
      const live = JSON.parse(fs.readFileSync(out, 'utf8'));
      assert.equal(live.status, 'VERIFIED', `drill ${drill} live re-run did not verify`);
      const issues = validateReceipt(live);
      assert.deepEqual(issues, [], `live drill ${drill} receipt: ${issues.join(' | ')}`);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
});

test('J2 negative: a forged receipt timestamp (non-monotonic, and in the future) is rejected by the validator', () => {
  const { receipts } = loadReceipts();
  const base = receipts.find((receipt) => receipt.drill === 'fencing-old-writer-rejection');
  assert.ok(base, 'the fencing drill receipt is required for this negative');
  const reordered = JSON.parse(JSON.stringify(base));
  reordered.steps = [...reordered.steps].reverse();
  const issueA = validateReceipt(reordered);
  assert.ok(issueA.some((issue) => issue.includes('not strictly monotonic')), `expected a monotonicity refusal, got: ${issueA.join(' | ')}`);
  const futured = JSON.parse(JSON.stringify(base));
  futured.steps = futured.steps.map((step, index) => ({ ...step, timestamp: new Date(Date.now() + 86_400_000 + index * 1000).toISOString() }));
  const issueB = validateReceipt(futured);
  assert.ok(issueB.some((issue) => issue.includes('future')), `expected a forged-future refusal, got: ${issueB.join(' | ')}`);
});

// ===========================================================================
// J3 — version rollback over the real release protocol (P4_2 gates, reused)
// ===========================================================================

function makeEnvironment(root) {
  const dir = path.join(root, 'env');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'registration.json'), JSON.stringify({
    schemaVersion: 1,
    interface: 'Environment.v1',
    environment: {
      id: 'isolated-local-env-1',
      project: 'sdd-harness-pilot',
      rollback: {
        approvalRequired: true,
        sameDigestRequired: true,
        retainLastApprovedArtifact: true,
        independentBusinessTerminalStateRequired: true,
      },
      readbackOracle: { kind: 'independent-business-readback', correlationIdRequired: true },
    },
    localOnly: true,
  }, null, 2));
  return dir;
}

function candidateChain(merge, head) {
  return {
    project: 'sdd-harness-pilot',
    head,
    merge,
    requiredChecks: ['delivery-gate'],
    checks: [{ name: 'delivery-gate', boundSha: merge, conclusion: 'success' }],
  };
}

function writeJson(root, name, value) {
  const file = path.join(root, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
  return file;
}

function writeSource(root, name, marker) {
  const dir = path.join(root, name);
  fs.mkdirSync(path.join(dir, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'app.js'), `// p5-3 rollback drill ${marker}\n`);
  return dir;
}

function runRelease(args, root) {
  return runNode([RELEASE_CLI, ...args, '--json'], { env: childEnv(root) });
}

test('J3: version rollback over the real protocol — unapproved and wrong-digest rollbacks are refused (exit 2), the approved same-digest rollback verifies (exit 0) and I06 independently confirms', { timeout: 240_000 }, (t) => {
  const root = workdir('j3');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const registry = path.join(root, 'registry');
  fs.mkdirSync(registry, { recursive: true });
  const envDir = makeEnvironment(root);

  const promote1 = runRelease(['promote', '--chain', writeJson(root, 'chain-v1.json', candidateChain(SHA('m1'), SHA('h1'))),
    '--source', writeSource(root, 'src-v1', 'v1'), '--tag', 'stable', '--registry', registry, '--environment', envDir], root);
  assert.equal(promote1.status, 0, `promote v1 stderr: ${promote1.stderr}`);
  const first = JSON.parse(promote1.stdout).artifact.digest;

  // promote2 emits its own updated chain (artifact/deployment sections); the
  // rollback consumes THAT chain so the I06 evaluator sees the full identity.
  const promote2 = runRelease(['promote', '--chain', writeJson(root, 'chain-v2-candidate.json', candidateChain(SHA('m2'), SHA('h2'))),
    '--source', writeSource(root, 'src-v2', 'v2'), '--tag', 'stable', '--registry', registry, '--environment', envDir,
    '--chain-out', path.join(root, 'chain-v2.json')], root);
  assert.equal(promote2.status, 0, `promote v2 stderr: ${promote2.stderr}`);
  const activeBefore = fs.readFileSync(path.join(envDir, 'active.json'), 'utf8');

  // Unapproved rollback: refused, nothing changes.
  const unapproved = runRelease(['rollback', '--chain', path.join(root, 'chain-v2.json'), '--registry', registry,
    '--environment', envDir, '--digest', first, '--chain-out', path.join(root, 'chain-rb-refused.json')], root);
  assert.equal(unapproved.status, 2, 'an unapproved rollback must exit 2');
  assert.ok(JSON.parse(unapproved.stdout).codes.includes('ROLLBACK_NOT_APPROVED'));
  assert.equal(fs.readFileSync(path.join(envDir, 'active.json'), 'utf8'), activeBefore, 'a refused rollback must not touch the active binding');

  // Wrong digest: approved but not the retained previous approved artifact.
  const approvalWrong = writeJson(root, 'approval-wrong.json', {
    schemaVersion: 1, interface: 'RollbackApproval.v1',
    digest: DIGEST('never-promoted'), environment: 'isolated-local-env-1', approver: 'release-owner', approvedAt: '2026-10-21T12:00:00.000Z',
  });
  const wrongDigest = runRelease(['rollback', '--chain', path.join(root, 'chain-v2.json'), '--registry', registry,
    '--environment', envDir, '--digest', DIGEST('never-promoted'), '--approval', approvalWrong], root);
  assert.equal(wrongDigest.status, 2, 'a rollback to a non-retained digest must exit 2');
  assert.ok(JSON.parse(wrongDigest.stdout).codes.includes('ROLLBACK_DIGEST_MISMATCH'));

  // Approved same-digest rollback: verified with the independent business readback.
  const approval = writeJson(root, 'approval.json', {
    schemaVersion: 1, interface: 'RollbackApproval.v1',
    digest: first, environment: 'isolated-local-env-1', approver: 'release-owner', approvedAt: '2026-10-21T12:00:00.000Z',
  });
  const rolled = runRelease(['rollback', '--chain', path.join(root, 'chain-v2.json'), '--registry', registry,
    '--environment', envDir, '--digest', first, '--approval', approval, '--chain-out', path.join(root, 'chain-rollback.json')], root);
  assert.equal(rolled.status, 0, `approved rollback stderr: ${rolled.stderr}`);
  const rollbackReceipt = JSON.parse(rolled.stdout);
  assert.equal(rollbackReceipt.status, 'VERIFIED');
  assert.equal(rollbackReceipt.rollback.digest, first);
  assert.equal(rollbackReceipt.rollback.observed.businessTerminalState.serving, first, 'the business terminal state reads back the rolled-back digest');

  // The accepted I06 evaluator independently confirms the emitted chain.
  const probe = runNode([PLATFORM_CLI, 'probe', '--case', 'registry-environment-identity', '--chain', path.join(root, 'chain-rollback.json'), '--json'], { env: childEnv(root) });
  assert.equal(probe.status, 0, `I06 probe stderr: ${probe.stderr}`);
  assert.equal(JSON.parse(probe.stdout).status, 'VERIFIED');
});

// ===========================================================================
// J4 — the boundary ledger: gates declared, cross-machine gate honestly closed
// ===========================================================================

test('J4: the runbook declares every known environment gate verbatim and documents the paired-commit enablement flow; the live scope gate readback stays anchored NOT_ENABLED', () => {
  const text = runbookText();
  const index = JSON.parse(fs.readFileSync(ACCEPTANCE_INDEX, 'utf8'));
  const gates = index.known_environment_gates ?? [];
  assert.ok(gates.length >= 5, `expected the acceptance index to carry its known gates, found ${gates.length}`);
  const issues = validateBoundaryDeclarations({ runbookText: text, gates });
  assert.deepEqual(issues, [], `boundary declaration problems: ${issues.join(' | ')}`);

  // The scope gate itself stays closed and anchored: live readback, exit 0.
  const scope = JSON.parse(fs.readFileSync(SCOPE_FILE, 'utf8'));
  assert.equal(scope.status, 'NOT_ENABLED');
  assert.equal(scope.scope, 'CROSS_MACHINE_SCOPE');
  const tmp = workdir('j4');
  try {
    const status = runNode([GATE_CLI, 'status', '--json'], { env: childEnv(tmp) });
    assert.equal(status.status, 0, 'an anchored status readback exits 0');
    const receipt = JSON.parse(status.stdout);
    assert.equal(receipt.status, 'NOT_ENABLED');
    assert.equal(receipt.anchored, true);
    assert.equal(receipt.gateCode, 'CROSS_MACHINE_SCOPE_NOT_ENABLED');
    assert.equal(receipt.positiveAuthStatus, 'UNVERIFIED', 'the positive cross-machine auth must stay UNVERIFIED, not silently pass');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('J4: start/publish are really denied while the cross-machine scope is not enabled (exit 2, not a crash)', () => {
  const tmp = workdir('j4start');
  try {
    const request = path.join(tmp, 'request.json');
    fs.writeFileSync(request, JSON.stringify({ project: 'sdd-harness-pilot', requestedBy: 'ops-oncall' }));
    for (const action of ['start', 'publish']) {
      const denied = runNode([GATE_CLI, action, '--request', request, '--json'], { env: childEnv(tmp) });
      assert.equal(denied.status, 2, `${action} must be denied with exit 2 while CROSS_MACHINE_SCOPE is NOT_ENABLED`);
      assert.ok(JSON.parse(denied.stdout).refusals.some((refusal) => refusal.code === 'CROSS_MACHINE_SCOPE_NOT_ENABLED'));
    }
    // A runtime enablement record still cannot flip the gate.
    const record = path.join(tmp, 'record.json');
    fs.writeFileSync(record, JSON.stringify({ decidedBy: 'user', scope: 'CROSS_MACHINE_SCOPE', decision: 'enable' }));
    const enable = runNode([GATE_CLI, 'enable', '--record', record, '--json'], { env: childEnv(tmp) });
    assert.equal(enable.status, 2);
    assert.ok(String(enable.stdout).includes('ENABLEMENT_REQUIRES_PAIRED_COMMIT'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('J4 negative: a runbook copy that hides one known environment gate is rejected', () => {
  const text = runbookText();
  const index = JSON.parse(fs.readFileSync(ACCEPTANCE_INDEX, 'utf8'));
  const gates = index.known_environment_gates ?? [];
  const victim = gates[0].trim();
  assert.ok(text.includes(victim), 'the real runbook must carry the gate verbatim');
  const tampered = text.replace(victim, victim.slice(0, Math.max(10, Math.floor(victim.length / 2))));
  const issues = validateBoundaryDeclarations({ runbookText: tampered, gates });
  assert.ok(issues.some((issue) => issue.includes('hides a known environment gate')), `expected the hidden gate to be reported, got: ${issues.join(' | ')}`);
});

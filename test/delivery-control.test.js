// P5_2 unit coverage — rework (rework-seven-p1-r1), branch rework/p5-2, base f13af35.
//
// F10 conditional-enablement gate in the CROSS_MACHINE_SCOPE_NOT_ENABLED state
// (tasks.md P5_2 前置: CROSS_MACHINE_SCOPE_NOT_ENABLED; 条件性启用门——启用前真实
// 验证拒绝启动/拒绝发布). The rework supersedes the old-run digest-anchored guard
// (DeliveryControl.ScopeGate.v1) with the adjudication-record model, same-source
// with the P5_1 machine matrix rule (team-host-matrix/matrix.json
// machine_dimension.enablement_gate: enabled=true 当且仅当存在可解析的明确启用
// 裁决). The deliverable under test:
//   - committed enablement.json: scope=CROSS_MACHINE, enabled=false,
//     decision_record=null, refuse=[start, release, implement],
//     f10_state=UNVERIFIED_NOT_ENABLED;
//   - start / release / implement are REALLY denied by real spawned processes
//     (exit 2, CROSS_MACHINE_SCOPE_NOT_ENABLED, refusal receipt carrying the
//     request digest — the receipt is the trace);
//   - enabled flipped true with no decision record is still denied
//     (ENABLEMENT_DECISION_RECORD_REQUIRED — no hand-edit bypass);
//   - a decision_record that does not resolve to an open_decisions adjudication
//     entry is still denied (ENABLEMENT_DECISION_RECORD_UNRESOLVED);
//   - marking F10 PASS/SUPPORTED while not enabled is a schema violation and
//     fails closed (every action, including the status readback, denied);
//   - stripping the refuse semantics (empty/missing refuse) fails closed:
//     default-deny still refuses all three actions;
//   - environment variables can never flip the gate; a runtime enable record is
//     digested as evidence and never trusted; a missing request file is invalid
//     input (exit 1), distinct from the scope denial (exit 2).
//
// Positive cross-machine construction (project isolation / credential
// revocation / restore-time re-auth / API-disconnect cached-green denial) is
// NOT built here and stays UNVERIFIED — "not enabled" never counts as F10
// pass. The journey-level boundary assertions live in
// test/delivery-cases/5_2.mjs.
//
// Zero new npm dependencies; fixtures under os.tmpdir(); nothing outside
// $TMPDIR is written; spawned processes get an isolated HOME/TMPDIR/PATH.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVICE_DIR = path.join(projectRoot, 'services', 'delivery-control');
const GATE_CLI = path.join(SERVICE_DIR, 'gate.mjs');
const ENABLEMENT_FILE = path.join(SERVICE_DIR, 'enablement.json');
const MATRIX_FILE = path.join(projectRoot, 'openspec', 'changes', 'delivery-foundation-rearchitecture', 'team-host-matrix', 'matrix.json');

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const REFUSE_TRIO = ['start', 'release', 'implement'];

// ---------------------------------------------------------------- helpers ---
function workdir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `sdd-p52-unit-${label}-`));
}

function isolatedEnv(tmp, extra = {}) {
  const env = { ...process.env, HOME: tmp, TMPDIR: tmp, PATH: '/usr/bin:/bin', ...extra };
  delete env.NODE_TEST_CONTEXT;
  return env;
}

function runGate(args, { env, cwd } = {}) {
  const tmp = workdir('run');
  return spawnSync(process.execPath, [GATE_CLI, ...args], {
    encoding: 'utf8',
    env: env ?? isolatedEnv(tmp),
    cwd: cwd ?? tmp,
    timeout: 60_000,
  });
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
  return file;
}

function requestFixture(dir, name = 'request.json', action = 'team-control-launch') {
  return writeJson(path.join(dir, name), {
    schemaVersion: 1,
    action,
    runId: 'run-p52-unit',
    requester: 'worker-p5-2',
    requestedAt: '2026-10-21T00:00:00.000Z',
  });
}

// A coherent hand-flip of the committed gate file into the enabled shape
// (everything but the adjudication) — the raw material for the tamper proofs.
function enabledShape(dir, overrides = {}) {
  const committed = JSON.parse(fs.readFileSync(ENABLEMENT_FILE, 'utf8'));
  return writeJson(path.join(dir, 'enablement.json'), {
    ...committed,
    enabled: true,
    f10_state: 'UNVERIFIED_ENABLED_CONSTRUCTION_PENDING',
    ...overrides,
  });
}

function assertDenied(run, code, label) {
  assert.equal(run.status, 2, `${label} must be DENIED with exit 2, stderr: ${run.stderr}`);
  assert.match(run.stderr, new RegExp(code), `${label} denial must carry code ${code}`);
  const receipt = JSON.parse(run.stdout);
  assert.equal(receipt.status, 'DENIED');
  assert.ok(receipt.refusals.some((r) => r.code === code), `${label} receipt must record ${code}`);
  assert.equal(receipt.positiveAuthStatus, 'UNVERIFIED');
  return receipt;
}

// --------------------------------------------------------------- committed ---
test('committed enablement.json is the rework gate declaration: CROSS_MACHINE, enabled=false, decision_record=null, refuse=[start,release,implement], f10_state=UNVERIFIED_NOT_ENABLED', () => {
  assert.ok(fs.existsSync(ENABLEMENT_FILE), 'enablement gate declaration missing: services/delivery-control/enablement.json (RED until implemented)');
  const gate = JSON.parse(fs.readFileSync(ENABLEMENT_FILE, 'utf8'));
  assert.equal(gate.schemaVersion, 2);
  assert.equal(gate.service, 'delivery-control');
  assert.equal(gate.scope, 'CROSS_MACHINE');
  assert.equal(gate.enabled, false);
  assert.equal(gate.decision_record, null, 'no adjudication exists in this run: decision_record must be null');
  assert.deepEqual(gate.refuse, REFUSE_TRIO);
  assert.equal(gate.f10_state, 'UNVERIFIED_NOT_ENABLED');

  // same-source consistency with the P5_1 machine matrix: the wildcard host is
  // default-deny NOT_ENABLED with refuse_start/refuse_release, and the only
  // enabled host explicitly excludes the cross-machine scope.
  const matrix = JSON.parse(fs.readFileSync(MATRIX_FILE, 'utf8')).machine_dimension;
  const wildcard = matrix.hosts.find((h) => h.host === '*');
  assert.equal(wildcard.enabled, false);
  assert.equal(wildcard.refusals.refuse_start.status, 'NOT_ENABLED');
  assert.equal(wildcard.refusals.refuse_release.status, 'NOT_ENABLED');
  const concrete = matrix.hosts.find((h) => h.host !== '*');
  assert.match(concrete.enablement.scope, /不含任何跨机器/, 'the enabled host must exclude the cross-machine scope');
});

test('start request is REALLY denied: real process, exit 2, CROSS_MACHINE_SCOPE_NOT_ENABLED, receipt carries the request digest as the trace', () => {
  assert.ok(fs.existsSync(GATE_CLI), 'gate entry missing: services/delivery-control/gate.mjs (RED until implemented)');
  const tmp = workdir('start');
  const request = requestFixture(tmp);
  const run = runGate(['start', '--request', request, '--json']);
  const receipt = assertDenied(run, 'CROSS_MACHINE_SCOPE_NOT_ENABLED', 'start');
  assert.equal(receipt.f10State, 'UNVERIFIED_NOT_ENABLED');
  assert.equal(receipt.requestDigest, sha256(fs.readFileSync(request)), 'the refusal receipt traces the exact denied request bytes');
});

test('release request is REALLY denied: real process, exit 2, CROSS_MACHINE_SCOPE_NOT_ENABLED (refuse_release, P5_1 wildcard semantics)', () => {
  const tmp = workdir('release');
  const request = requestFixture(tmp, 'release.json', 'team-control-release');
  const run = runGate(['release', '--request', request, '--json']);
  assertDenied(run, 'CROSS_MACHINE_SCOPE_NOT_ENABLED', 'release');
});

test('implement request is REALLY denied: real process, exit 2, CROSS_MACHINE_SCOPE_NOT_ENABLED (no team capability may be implemented cross-machine before enablement)', () => {
  const tmp = workdir('implement');
  const request = requestFixture(tmp, 'implement.json', 'team-control-implement');
  const run = runGate(['implement', '--request', request, '--json']);
  assertDenied(run, 'CROSS_MACHINE_SCOPE_NOT_ENABLED', 'implement');
});

test('M1 tamper — enabled flipped true with no decision record is still denied (ENABLEMENT_DECISION_RECORD_REQUIRED); an incoherent bare flip fails closed', () => {
  const tmp = workdir('m1');
  // coherent hand-flip: enabled=true + construction-pending state, record left null
  const coherent = enabledShape(tmp);
  for (const action of REFUSE_TRIO) {
    const run = runGate([action, '--request', requestFixture(tmp, `${action}.json`), '--enablement-file', coherent, '--json']);
    assertDenied(run, 'ENABLEMENT_DECISION_RECORD_REQUIRED', `${action} with enabled=true but decision_record=null`);
  }
  // bare flip (state left in the not-enabled value) is a schema violation: fail closed
  const bare = writeJson(path.join(tmp, 'bare.json'), {
    ...JSON.parse(fs.readFileSync(ENABLEMENT_FILE, 'utf8')),
    enabled: true,
  });
  const bareRun = runGate(['start', '--request', requestFixture(tmp, 'bare-req.json'), '--enablement-file', bare, '--json']);
  assertDenied(bareRun, 'GATE_FILE_FAIL_CLOSED', 'bare enabled flip with a stale f10_state');
});

test('M2 tamper — a decision_record that does not resolve to an open_decisions adjudication is still denied (ENABLEMENT_DECISION_RECORD_UNRESOLVED); path escape refused', () => {
  const tmp = workdir('m2');
  const source = 'openspec/changes/delivery-foundation-rearchitecture/execution-state.json';

  // (a) decision id that does not exist in the registry
  const unknownId = enabledShape(tmp, {
    decision_record: { source, decision_id: 'NO_SUCH_CROSS_MACHINE_DECISION' },
  });
  const unknownRun = runGate(['start', '--request', requestFixture(tmp, 'r1.json'), '--enablement-file', unknownId, '--json']);
  assertDenied(unknownRun, 'ENABLEMENT_DECISION_RECORD_UNRESOLVED', 'decision id absent from open_decisions');

  // (b) a decision that exists but is an OPEN question, not an enablement adjudication
  const openId = enabledShape(tmp, {
    decision_record: { source, decision_id: 'UTILS_SECRET_REF' },
  });
  const openRun = runGate(['start', '--request', requestFixture(tmp, 'r2.json'), '--enablement-file', openId, '--json']);
  assertDenied(openRun, 'ENABLEMENT_DECISION_RECORD_UNRESOLVED', 'open question is not an adjudication');

  // (c) source outside the repo (absolute path escape)
  const escape = enabledShape(tmp, {
    decision_record: { source: '/etc/passwd', decision_id: 'X' },
  });
  const escapeRun = runGate(['start', '--request', requestFixture(tmp, 'r3.json'), '--enablement-file', escape, '--json']);
  assertDenied(escapeRun, 'ENABLEMENT_DECISION_RECORD_UNRESOLVED', 'absolute source path escape');

  // (d) traversal escape
  const traversal = enabledShape(tmp, {
    decision_record: { source: '../../etc/passwd', decision_id: 'X' },
  });
  const traversalRun = runGate(['implement', '--request', requestFixture(tmp, 'r4.json'), '--enablement-file', traversal, '--json']);
  assertDenied(traversalRun, 'ENABLEMENT_DECISION_RECORD_UNRESOLVED', 'relative traversal source escape');
});

test('M3 tamper — NOT_ENABLED marked PASS fails closed: every action including the status readback is denied (GATE_FILE_FAIL_CLOSED)', () => {
  const tmp = workdir('m3');
  const passClaim = writeJson(path.join(tmp, 'enablement.json'), {
    ...JSON.parse(fs.readFileSync(ENABLEMENT_FILE, 'utf8')),
    f10_state: 'PASS',
  });
  for (const args of [
    ['status'],
    ['start', '--request', requestFixture(tmp, 'r1.json')],
    ['release', '--request', requestFixture(tmp, 'r2.json')],
    ['implement', '--request', requestFixture(tmp, 'r3.json')],
  ]) {
    const run = runGate([...args, '--enablement-file', passClaim, '--json']);
    assertDenied(run, 'GATE_FILE_FAIL_CLOSED', `PASS-claiming gate file must poison ${args[0]}`);
  }
  // a supported/verified claim is the same poison
  const supportedClaim = writeJson(path.join(tmp, 'supported.json'), {
    ...JSON.parse(fs.readFileSync(ENABLEMENT_FILE, 'utf8')),
    f10_state: 'SUPPORTED',
  });
  const supportedRun = runGate(['status', '--enablement-file', supportedClaim, '--json']);
  assertDenied(supportedRun, 'GATE_FILE_FAIL_CLOSED', 'SUPPORTED-claiming gate file');
});

test('M4 tamper — refuse semantics stripped fails closed: default-deny still refuses all three actions', () => {
  const tmp = workdir('m4');
  const committed = JSON.parse(fs.readFileSync(ENABLEMENT_FILE, 'utf8'));
  for (const [label, refuse] of [['empty refuse', []], ['missing refuse', undefined]]) {
    const stripped = { ...committed };
    if (refuse === undefined) delete stripped.refuse;
    else stripped.refuse = refuse;
    const file = writeJson(path.join(tmp, `${label.replace(/\s+/g, '-')}.json`), stripped);
    for (const action of REFUSE_TRIO) {
      const run = runGate([action, '--request', requestFixture(tmp, `${action}.json`), '--enablement-file', file, '--json']);
      assertDenied(run, 'GATE_FILE_FAIL_CLOSED', `${label}: ${action} must stay denied`);
    }
  }
});

test('environment variables can never flip the gate; a runtime enable record is digested, never trusted (ENABLEMENT_REQUIRES_REGISTERED_DECISION); a missing request file is invalid input (exit 1), not a denial', () => {
  const tmp = workdir('hygiene');

  // (1) hostile env must not change the decision
  const envRun = runGate(['start', '--request', requestFixture(tmp, 'env.json')], {
    env: isolatedEnv(tmp, {
      CROSS_MACHINE_SCOPE: 'ENABLED',
      SDD_CROSS_MACHINE_SCOPE: 'ENABLED',
      DELIVERY_CONTROL_ENABLED: 'true',
      DELIVERY_CONTROL_CROSS_MACHINE: '1',
      ENABLED: 'true',
    }),
  });
  assertDenied(envRun, 'CROSS_MACHINE_SCOPE_NOT_ENABLED', 'start under hostile env');

  // (2) a runtime enable record (even claiming decided_by=user) is refused;
  //     it is digested as evidence, never trusted as approval
  const record = writeJson(path.join(tmp, 'enablement-record.json'), {
    schemaVersion: 1,
    decision: 'ENABLE_CROSS_MACHINE_SCOPE',
    decided_by: 'user', // forged authority: a runtime file cannot speak for the user
    decided_at: '2026-10-21T00:00:00.000Z',
  });
  const enableRun = runGate(['enable', '--record', record, '--json']);
  assert.equal(enableRun.status, 2, `runtime enablement must exit 2, stderr: ${enableRun.stderr}`);
  assert.match(enableRun.stderr, /ENABLEMENT_REQUIRES_REGISTERED_DECISION/);
  const receipt = JSON.parse(enableRun.stdout);
  assert.equal(receipt.recordTrusted, false);
  assert.equal(receipt.recordDigest, sha256(fs.readFileSync(record)), 'the refused record is still digested as evidence');

  // (3) input hygiene: missing request is exit 1, distinct from denial exit 2
  const badInput = runGate(['start', '--request', path.join(tmp, 'absent.json')]);
  assert.equal(badInput.status, 1);
  assert.match(badInput.stderr, /request file/);
});

test('status readback reports the NOT_ENABLED state honestly (exit 0, UNVERIFIED_NOT_ENABLED, positive auth UNVERIFIED); the gate builds no positive cross-machine surface; the service dir ships exactly the gate artifacts + README', async () => {
  const gateModule = await import(`file://${GATE_CLI}`);
  assert.deepEqual([...gateModule.GATE_ACTIONS].sort(), [...REFUSE_TRIO].sort(), 'the gate action set is exactly start/release/implement');

  const statusRun = runGate(['status', '--json']);
  assert.equal(statusRun.status, 0, `status must exit 0 for the committed NOT_ENABLED gate, stderr: ${statusRun.stderr}`);
  const body = JSON.parse(statusRun.stdout);
  assert.equal(body.enabled, false);
  assert.equal(body.f10State, 'UNVERIFIED_NOT_ENABLED');
  assert.ok(!['PASS', 'SUPPORTED', 'VERIFIED'].includes(body.f10State), 'F10 must never be reported in a pass position under NOT_ENABLED');
  assert.equal(body.positiveAuthStatus, 'UNVERIFIED');

  // no positive construction: the service directory holds exactly the gate
  // artifacts and no server/database/identity code
  const entries = fs.readdirSync(SERVICE_DIR).sort();
  assert.deepEqual(entries, ['README.md', 'enablement.json', 'gate.mjs'], 'not-enabled state ships only the gate artifacts');
  const gateSource = fs.readFileSync(GATE_CLI, 'utf8');
  assert.doesNotMatch(gateSource, /createServer|net\.connect|postgres|\bpg\b|knex|mongodb|listen\(/i,
    'the gate must not build positive cross-machine surface (no server/db/identity code)');
  assert.match(gateSource, /CROSS_MACHINE_SCOPE_NOT_ENABLED/, 'the gate code carries the frozen denial code');
});

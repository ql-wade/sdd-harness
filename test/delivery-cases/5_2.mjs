// P5_2 delivery case — rework (rework-seven-p1-r1), branch rework/p5-2, base f13af35.
//
// F10 in the CROSS_MACHINE_SCOPE_NOT_ENABLED state.
//
// tasks.md P5_2 前置: CROSS_MACHINE_SCOPE_NOT_ENABLED. 条件性启用门: 只有逐宿主/
// 跨机器范围被明确启用后才实施对应团队能力; 启用前真实验证拒绝启动/拒绝发布;
// 未执行的正向隔离恢复认证保留 UNVERIFIED, 不能以"未启用"判 F10 通过.
//
// This run's user did NOT enable the cross-machine scope (execution-state.json
// open_decisions holds no cross-machine adjudication; the P5_1 machine matrix
// wildcard host is default-deny NOT_ENABLED), so the journey proves the
// conditional-enablement gate for real — every denial is a real spawned
// process with a real exit code, stderr code and a receipt, never a mock:
//   J1  denial journey: start / release / implement are denied (exit 2,
//       CROSS_MACHINE_SCOPE_NOT_ENABLED, receipt traces the request digest);
//       a hand-flip enabled=true without an adjudication is still denied
//       (ENABLEMENT_DECISION_RECORD_REQUIRED); a decision_record that does not
//       resolve to an open_decisions adjudication entry is still denied
//       (ENABLEMENT_DECISION_RECORD_UNRESOLVED — no hand-edit bypass);
//       environment variables cannot flip the gate; a runtime enable record is
//       digested as evidence and never trusted.
//   J2  same-source journey: the gate and the P5_1 machine matrix
//       (team-host-matrix/matrix.json machine_dimension) agree — the wildcard
//       host is default-deny with refuse_start/refuse_release NOT_ENABLED, the
//       not_enabled_never_pass rule is present, the only enabled host's
//       enablement scope explicitly excludes the cross-machine, and
//       enablement.json cites the matrix as its semantics source.
//   J3  F10 boundary journey: F10 is mechanically pinned to
//       UNVERIFIED_NOT_ENABLED — the gate status readback reports it, the
//       acceptance-index F10 entry stays UNVERIFIED (never PASS/SUPPORTED/
//       VERIFIED, deployment NOT_DELIVERED, P5_2 REOPENED_RETEST_REQUIRED), a
//       PASS-claiming tampered gate file poisons even the status readback
//       (the mutation bites), the tasks.md gate text is intact, and the
//       service directory builds no positive cross-machine surface.
//   J4  future-path honesty journey: the README documents the real enablement
//       path (user adjudication -> open_decisions record -> decision_record ->
//       service-body rebuild -> 5.2.a/5.2.b capabilities) and keeps the
//       not-built holders (API body, PostgreSQL/evidence-storage/identity
//       wiring, step-scheduling takeover) explicit instead of claiming them.
//
// Fixtures under os.tmpdir(); read-only over live configuration
// (acceptance-index.json / tasks.md / matrix.json are read, never written);
// isolated HOME/TMPDIR/PATH for every spawned process. Zero new dependencies.
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
const SERVICE_DIR = path.join(projectRoot, 'services', 'delivery-control');
const GATE_CLI = path.join(SERVICE_DIR, 'gate.mjs');
const ENABLEMENT_FILE = path.join(SERVICE_DIR, 'enablement.json');
const README_FILE = path.join(SERVICE_DIR, 'README.md');
const MATRIX_FILE = path.join(CHANGE_DIR, 'team-host-matrix', 'matrix.json');
const ACCEPTANCE_INDEX = path.join(CHANGE_DIR, 'acceptance-index.json');
const EXECUTION_STATE = path.join(CHANGE_DIR, 'execution-state.json');
const TASKS_MD = path.join(CHANGE_DIR, 'tasks.md');

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const REFUSE_TRIO = ['start', 'release', 'implement'];

function workdir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `sdd-p52-${label}-`));
}

function isolatedEnv(tmp, extra = {}) {
  const env = { ...process.env, HOME: tmp, TMPDIR: tmp, PATH: '/usr/bin:/bin', ...extra };
  delete env.NODE_TEST_CONTEXT;
  return env;
}

// Run the REAL gate entry as a subprocess; the absence of the entry is a real
// RED (spawn ENOENT surfaced as an assertion with the contract in the message).
function runGate(args, { env } = {}) {
  assert.ok(
    fs.existsSync(GATE_CLI),
    'F10 conditional-enablement gate missing: services/delivery-control/gate.mjs must exist (RED until implemented)',
  );
  const tmp = workdir('spawn');
  return spawnSync(process.execPath, [GATE_CLI, ...args], {
    encoding: 'utf8',
    env: env ?? isolatedEnv(tmp),
    cwd: tmp,
    timeout: 60_000,
  });
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
  return file;
}

function request(dir, name, action, runId) {
  return writeJson(path.join(dir, name), {
    schemaVersion: 1,
    action,
    runId,
    requester: 'worker-p5-2',
    requestedAt: '2026-10-21T00:00:00.000Z',
  });
}

function assertDenied(run, code, label) {
  assert.equal(run.status, 2, `${label} must be DENIED with exit 2, stderr: ${run.stderr}`);
  assert.match(run.stderr, new RegExp(code), `${label} denial must carry code ${code}`);
  const receipt = JSON.parse(run.stdout);
  assert.equal(receipt.status, 'DENIED');
  assert.ok(receipt.refusals.some((r) => r.code === code), `${label} receipt must record ${code}`);
  return receipt;
}

// ------------------------------------------------------------- J1 denials ---
test('F10 J1 denial journey: start/release/implement really denied; hand-flip without adjudication denied; unresolvable decision_record denied; env flip impossible; runtime record never trusted', () => {
  assert.ok(fs.existsSync(ENABLEMENT_FILE), 'enablement declaration missing: services/delivery-control/enablement.json (RED until implemented)');
  const tmp = workdir('j1');

  // (1) the three gated actions are each really denied, each receipt tracing
  //     the exact denied request bytes
  const actions = [
    ['start', 'team-control-launch'],
    ['release', 'team-control-release'],
    ['implement', 'team-control-implement'],
  ];
  for (const [action, kind] of actions) {
    const req = request(tmp, `${action}.json`, kind, 'run-p52-j1');
    const run = runGate([action, '--request', req, '--json']);
    const receipt = assertDenied(run, 'CROSS_MACHINE_SCOPE_NOT_ENABLED', `${action} (not enabled)`);
    assert.equal(receipt.f10State, 'UNVERIFIED_NOT_ENABLED', `${action} receipt pins F10 to UNVERIFIED_NOT_ENABLED`);
    assert.equal(receipt.requestDigest, sha256(fs.readFileSync(req)), `${action} receipt traces the denied request bytes`);
  }

  // (2) hand-edit bypass #1: enabled=true with no decision record
  const committed = JSON.parse(fs.readFileSync(ENABLEMENT_FILE, 'utf8'));
  const flipped = writeJson(path.join(tmp, 'flipped.json'), {
    ...committed,
    enabled: true,
    f10_state: 'UNVERIFIED_ENABLED_CONSTRUCTION_PENDING',
  });
  const flippedRun = runGate(['start', '--request', request(tmp, 'f1.json', 'team-control-launch', 'run-p52-j1-flip'), '--enablement-file', flipped, '--json']);
  assertDenied(flippedRun, 'ENABLEMENT_DECISION_RECORD_REQUIRED', 'enabled=true without decision_record');

  // (3) hand-edit bypass #2: a decision_record that does not resolve to a real
  //     open_decisions adjudication entry
  const forged = writeJson(path.join(tmp, 'forged.json'), {
    ...committed,
    enabled: true,
    f10_state: 'UNVERIFIED_ENABLED_CONSTRUCTION_PENDING',
    decision_record: {
      source: 'openspec/changes/delivery-foundation-rearchitecture/execution-state.json',
      decision_id: 'FORGED_CROSS_MACHINE_ENABLEMENT',
    },
  });
  const forgedRun = runGate(['release', '--request', request(tmp, 'f2.json', 'team-control-release', 'run-p52-j1-forged'), '--enablement-file', forged, '--json']);
  assertDenied(forgedRun, 'ENABLEMENT_DECISION_RECORD_UNRESOLVED', 'forged decision_record');

  // (4) environment variables can never flip the gate
  const envRun = runGate(['implement', '--request', request(tmp, 'f3.json', 'team-control-implement', 'run-p52-j1-env')], {
    env: isolatedEnv(tmp, {
      CROSS_MACHINE_SCOPE: 'ENABLED',
      DELIVERY_CONTROL_ENABLED: 'true',
      SDD_ENABLEMENT: 'ENABLED',
    }),
  });
  assertDenied(envRun, 'CROSS_MACHINE_SCOPE_NOT_ENABLED', 'implement under hostile env');

  // (5) a runtime enable record is digested as evidence and never trusted —
  //     opening the gate is a user adjudication registered by the control
  //     plane, never a caller-supplied file
  const record = writeJson(path.join(tmp, 'enablement-record.json'), {
    decision: 'ENABLE_CROSS_MACHINE_SCOPE',
    decided_by: 'user',
    decided_at: '2026-10-21T00:00:00.000Z',
  });
  const enableRun = runGate(['enable', '--record', record, '--json']);
  assert.equal(enableRun.status, 2, `runtime enablement must exit 2, stderr: ${enableRun.stderr}`);
  assert.match(enableRun.stderr, /ENABLEMENT_REQUIRES_REGISTERED_DECISION/);
  const enableReceipt = JSON.parse(enableRun.stdout);
  assert.equal(enableReceipt.recordTrusted, false);
  assert.equal(enableReceipt.recordDigest, sha256(fs.readFileSync(record)));
});

// ------------------------------------------- J2 same-source with P5_1 matrix --
test('F10 J2 same-source journey: gate semantics and the P5_1 machine matrix agree (wildcard default-deny NOT_ENABLED, refusals, never-pass rule, no cross-machine enablement anywhere)', () => {
  const matrix = JSON.parse(fs.readFileSync(MATRIX_FILE, 'utf8')).machine_dimension;
  const gate = JSON.parse(fs.readFileSync(ENABLEMENT_FILE, 'utf8'));

  // (1) the wildcard host is default-deny with the refusal semantics
  const wildcard = matrix.hosts.find((h) => h.host === '*');
  assert.equal(wildcard.kind, 'default-deny-wildcard');
  assert.equal(wildcard.enabled, false, 'wildcard host must stay disabled (P5_1 fact, not modified here)');
  assert.equal(wildcard.refusals.refuse_start.status, 'NOT_ENABLED');
  assert.equal(wildcard.refusals.refuse_release.status, 'NOT_ENABLED');
  for (const [capability, cell] of Object.entries(wildcard.capabilities)) {
    assert.equal(cell.status, 'NOT_ENABLED', `wildcard capability ${capability} must stay NOT_ENABLED`);
  }

  // (2) the matrix never-pass rule exists and matches the gate behavior
  assert.match(matrix.enablement_gate.not_enabled_never_pass, /NOT_ENABLED/);
  assert.match(matrix.enablement_gate.not_enabled_never_pass, /绝不|never/);
  assert.match(matrix.enablement_gate.rule, /当且仅当/, 'enablement rule: enabled iff a resolvable adjudication exists');
  assert.match(matrix.enablement_gate.rule, /可解析/, 'the adjudication must be resolvable — the gate decision_record requirement');

  // (3) the only enabled host explicitly excludes the cross-machine scope:
  //     no cross-machine enablement exists anywhere in the matrix
  const concrete = matrix.hosts.filter((h) => h.host !== '*' && h.enabled === true);
  assert.equal(concrete.length, 1, 'exactly one host is enabled (this machine)');
  assert.match(concrete[0].enablement.scope, /不含任何跨机器/);

  // (4) the gate cites the matrix as its semantics source and its refusal set
  //     covers the wildcard refusals plus the P5_2 implement action
  assert.match(gate.semantics_source, /team-host-matrix\/matrix\.json/);
  assert.match(gate.semantics_source, /machine_dimension/);
  assert.deepEqual(gate.refuse, REFUSE_TRIO);
  assert.equal(gate.enabled, false);
});

// ---------------------------------------------------- J3 F10 boundary -------
test('F10 J3 boundary journey: F10 mechanically pinned to UNVERIFIED_NOT_ENABLED — status readback, acceptance-index entry, PASS-tamper bite, tasks.md text, no positive surface', () => {
  // (1) the real gate status readback pins F10
  const statusRun = runGate(['status', '--json']);
  assert.equal(statusRun.status, 0, `status must exit 0 for the committed NOT_ENABLED gate, stderr: ${statusRun.stderr}`);
  const status = JSON.parse(statusRun.stdout);
  assert.equal(status.enabled, false);
  assert.equal(status.f10State, 'UNVERIFIED_NOT_ENABLED');
  assert.equal(status.positiveAuthStatus, 'UNVERIFIED');
  assert.match(status.positiveAuthHolder, /用户跨机器范围裁决/);

  // (2) the PASS-tamper mutation bites at journey level: a gate file claiming
  //     F10=PASS poisons even the status readback (exit 2, fail closed)
  const tmp = workdir('j3');
  const passClaim = writeJson(path.join(tmp, 'enablement.json'), {
    ...JSON.parse(fs.readFileSync(ENABLEMENT_FILE, 'utf8')),
    f10_state: 'PASS',
  });
  const passRun = runGate(['status', '--enablement-file', passClaim, '--json']);
  assertDenied(passRun, 'GATE_FILE_FAIL_CLOSED', 'PASS-claiming gate file readback');

  // (3) the acceptance-index F10 entry stays UNVERIFIED with its rework
  //     disposition — "not enabled" never becomes F10 pass
  const index = JSON.parse(fs.readFileSync(ACCEPTANCE_INDEX, 'utf8'));
  const f10 = index.scenarios?.F10;
  assert.ok(f10, 'acceptance-index.json must carry scenarios.F10');
  assert.equal(f10.scenario_status, 'UNVERIFIED', 'F10 must stay UNVERIFIED in the not-enabled run');
  // reconciled at acceptance (review B-2): P5_2 accepted at fd5c8a2 with the
  // honest NOT_ENABLED gate — component layer now carries the mechanism
  // evidence while the capability itself stays UNVERIFIED (env/same-run
  // layers + gate read-back below keep the not-enabled pinning).
  assert.equal(f10.component_pass?.status, 'MECHANISM_AT_DECLARED_SCOPE');
  assert.equal(f10.deployment_status, 'NOT_DELIVERED');
  assert.equal(f10.component_pass?.tasks?.P5_2, 'ACCEPTED', 'P5_2 accepted with the gate; F10 capability stays UNVERIFIED_NOT_ENABLED');
  assert.equal(f10.case_module, 'test/delivery-cases/5_2.mjs');
  for (const field of [f10.scenario_status, f10.component_pass?.status, f10.env_qualification?.status, f10.same_run_finality?.status]) {
    assert.ok(!['PASS', 'SUPPORTED', 'VERIFIED'].includes(field), 'no F10 layer may claim a pass position under NOT_ENABLED');
  }

  // (4) the control plane registers no cross-machine adjudication (the exact
  //     precondition of this task) — read-only check
  const state = JSON.parse(fs.readFileSync(EXECUTION_STATE, 'utf8'));
  const crossMachineDecisions = (state.open_decisions ?? []).filter((d) =>
    /CROSS_MACHINE|跨机器/.test(`${d.id} ${d.summary ?? ''} ${d.question ?? ''} ${d.decision ?? ''}`) && d.decision === 'ENABLE_CROSS_MACHINE_SCOPE',
  );
  assert.equal(crossMachineDecisions.length, 0, 'no open_decisions entry may claim a cross-machine enablement adjudication in this run');

  // (5) the tasks.md gate text is intact (read-only check)
  const tasks = fs.readFileSync(TASKS_MD, 'utf8');
  assert.match(tasks, /CROSS_MACHINE_SCOPE_NOT_ENABLED/);
  assert.match(tasks, /未执行的正向隔离恢复认证保留 ?UNVERIFIED/);
  assert.match(tasks, /不能以["“]未启用["”]判 ?F10 ?通过/);

  // (6) no positive construction: the service directory holds exactly the gate
  //     artifacts and no server/database/identity code
  const entries = fs.readdirSync(SERVICE_DIR).sort();
  assert.deepEqual(entries, ['README.md', 'enablement.json', 'gate.mjs'], 'not-enabled state ships only the gate artifacts');
  const gateSource = fs.readFileSync(GATE_CLI, 'utf8');
  assert.doesNotMatch(gateSource, /createServer|net\.connect|postgres|\bpg\b|knex|mongodb|listen\(/i,
    'the gate must not build positive cross-machine surface (no server/db/identity code)');
});

// ------------------------------------------------ J4 future-path honesty ----
test('F10 J4 future-path honesty: README documents the real enablement path and keeps the not-built holders explicit (no capability overclaim)', () => {
  assert.ok(fs.existsSync(README_FILE), 'services/delivery-control/README.md missing (RED until implemented)');
  const readme = fs.readFileSync(README_FILE, 'utf8');

  // (1) the enablement path is the documented sequence: user adjudication ->
  //     open_decisions record -> decision_record -> service-body rebuild ->
  //     the 5.2.a/5.2.b API capabilities
  assert.match(readme, /裁决/, 'the enablement path starts with the user adjudication');
  assert.match(readme, /open_decisions/, 'the adjudication must be registered in open_decisions');
  assert.match(readme, /decision_record/, 'the gate file must be pointed at the record');
  assert.match(readme, /5\.2\.a[\s\S]*5\.2\.b|5\.2\.b[\s\S]*5\.2\.a/, 'the post-enable construction scope (5.2.a/5.2.b) is named');

  // (2) the construction boundary is preserved: reuse existing infrastructure,
  //     API never takes over step scheduling
  assert.match(readme, /PostgreSQL/);
  assert.match(readme, /证据存储|evidence storage/i);
  assert.match(readme, /身份服务|identity service/i);
  assert.match(readme, /不接管|never takes over/i, 'the API scheduling boundary is stated');

  // (3) the not-built holders are explicit (API body / DB / identity / storage
  //     wiring / scheduling takeover stay unbuilt until enablement)
  assert.match(readme, /UNVERIFIED/, 'the positive auth items stay UNVERIFIED');
  assert.match(readme, /team-host-matrix\/matrix\.json/, 'the P5_1 matrix is cited as the same-source semantics');
  assert.match(readme, /NOT_ENABLED/);

  // (4) no capability overclaim: the README must not pretend the service exists
  assert.doesNotMatch(readme, /is running|已上线|已部署|live API|API server is up/i,
    'the README must not claim a built service — nothing positive is constructed here');
});

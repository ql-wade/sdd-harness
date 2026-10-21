// P5_2 delivery case — F10 in the CROSS_MACHINE_SCOPE_NOT_ENABLED state.
//
// tasks.md P5_2 前置: CROSS_MACHINE_SCOPE_NOT_ENABLED. 条件性启用门: 只有逐宿主/
// 跨机器范围被明确启用后才实施对应团队能力; 启用前真实验证拒绝启动/拒绝发布;
// 未执行的正向隔离恢复认证保留 UNVERIFIED, 不能以"未启用"判 F10 通过.
//
// This run's user did NOT enable the cross-machine scope, so the journey proves
// the NOT_ENABLED guard for real (every denial is a real spawned process with a
// real exit code and stderr — never a mock, never a declared skip):
//   J1  gate denial journey: start and publish are denied (exit 2,
//       CROSS_MACHINE_SCOPE_NOT_ENABLED); a forged scope file with status
//       ENABLED and a recomputed self-digest is refused by the anchor check
//       (SCOPE_FILE_NOT_ANCHORED); environment variables cannot silently flip
//       the gate; a runtime enablement record cannot open the gate
//       (ENABLEMENT_REQUIRES_PAIRED_COMMIT) — opening requires the explicitly
//       registered paired commit carrying the user decision.
//   J2  anchor integrity journey: the committed scope-gate.json bytes are
//       re-digested independently inside this suite (own canonical JSON +
//       sha256) and must equal both the file's contentDigest and the digest
//       shipped inside gate.mjs — the paired-mutation invariant (configVersion
//       lesson: no boolean flag, no silent flip, no env override).
//   J3  F10 boundary journey: the acceptance-index F10 entry stays UNVERIFIED
//       with its existing holder (P5_2 owner + 用户跨机器范围裁决), the
//       tasks.md gate text is intact, and the delivery builds no positive
//       cross-machine surface (services/delivery-control holds exactly the
//       two guard artifacts; no server/database/identity code) — "未启用"
//       never becomes F10 pass.
//
// Fixtures under os.tmpdir(); read-only over live configuration
// (acceptance-index.json / tasks.md are read, never written); isolated
// HOME/TMPDIR/PATH for every spawned process. Zero new npm dependencies.
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
const SCOPE_FILE = path.join(SERVICE_DIR, 'scope-gate.json');
const ACCEPTANCE_INDEX = path.join(CHANGE_DIR, 'acceptance-index.json');
const TASKS_MD = path.join(CHANGE_DIR, 'tasks.md');

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

// Independent canonical JSON (authored in this suite on purpose — the anchor
// chain gets a second oracle that does not come from the gate implementation).
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

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
    'F10 not-enabled guard missing: services/delivery-control/gate.mjs must exist (RED until implemented)',
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

// ------------------------------------------------------------- J1 denials ---
test('F10 J1 not-enabled gate: start/publish really denied, forged scope refused, env flip impossible, runtime enable refused', () => {
  assert.ok(fs.existsSync(SCOPE_FILE), 'scope registry missing: services/delivery-control/scope-gate.json (RED until implemented)');
  const tmp = workdir('j1');

  // (1) start denial — real process, exit 2, explicit code
  const startRun = runGate(['start', '--request', request(tmp, 'start.json', 'team-control-launch', 'run-p52-j1'), '--json']);
  assert.equal(startRun.status, 2, `start must exit 2, stderr: ${startRun.stderr}`);
  assert.match(startRun.stderr, /CROSS_MACHINE_SCOPE_NOT_ENABLED/);
  const startReceipt = JSON.parse(startRun.stdout);
  assert.equal(startReceipt.status, 'DENIED');
  assert.ok(startReceipt.refusals.some((r) => r.code === 'CROSS_MACHINE_SCOPE_NOT_ENABLED'));

  // (2) publish denial — real process, exit 2, explicit code
  const publishRun = runGate(['publish', '--request', request(tmp, 'publish.json', 'team-control-release', 'run-p52-j1'), '--json']);
  assert.equal(publishRun.status, 2, `publish must exit 2, stderr: ${publishRun.stderr}`);
  assert.match(publishRun.stderr, /CROSS_MACHINE_SCOPE_NOT_ENABLED/);
  const publishReceipt = JSON.parse(publishRun.stdout);
  assert.ok(publishReceipt.refusals.some((r) => r.code === 'CROSS_MACHINE_SCOPE_NOT_ENABLED'));

  // (3) forged scope: status ENABLED with a recomputed self-digest — the
  //     forger makes the file self-consistent, the shipped anchor still
  //     refuses it (enabled-state validation, not a filename check).
  const committed = JSON.parse(fs.readFileSync(SCOPE_FILE, 'utf8'));
  const forgedPayload = { ...committed, status: 'ENABLED' };
  delete forgedPayload.contentDigest;
  const forgedScope = writeJson(path.join(tmp, 'scope-gate.json'), {
    ...forgedPayload,
    contentDigest: sha256(canonical(forgedPayload)),
  });
  const forgedRun = runGate(['start', '--request', request(tmp, 'start2.json', 'team-control-launch', 'run-p52-j1-forged'), '--scope-file', forgedScope, '--json']);
  assert.equal(forgedRun.status, 2, `forged scope must exit 2, stderr: ${forgedRun.stderr}`);
  assert.match(forgedRun.stderr, /SCOPE_FILE_NOT_ANCHORED/);
  assert.ok(JSON.parse(forgedRun.stdout).refusals.some((r) => r.code === 'SCOPE_FILE_NOT_ANCHORED'));

  // (4) silent env flip: hostile env vars must not change the decision
  const envRun = runGate(['publish', '--request', request(tmp, 'publish2.json', 'team-control-release', 'run-p52-j1-env')], {
    env: isolatedEnv(tmp, {
      CROSS_MACHINE_SCOPE: 'ENABLED',
      SDD_CROSS_MACHINE_SCOPE: 'ENABLED',
      DELIVERY_CONTROL_SCOPE: 'enabled',
      DELIVERY_CONTROL_CROSS_MACHINE: '1',
      SCOPE: 'ENABLED',
    }),
  });
  assert.equal(envRun.status, 2, `env vars must not flip the gate, stderr: ${envRun.stderr}`);
  assert.match(envRun.stderr, /CROSS_MACHINE_SCOPE_NOT_ENABLED/);

  // (5) gate opening needs the explicit registered record: a runtime record
  //     (even one claiming decidedBy=user) is refused — the record is
  //     digested, never trusted (caller-supplied identity is not review).
  const record = writeJson(path.join(tmp, 'enablement-record.json'), {
    schemaVersion: 1,
    decision: 'ENABLE',
    scope: 'CROSS_MACHINE_SCOPE',
    decidedBy: 'user', // forged authority: a runtime file cannot speak for the user
    decidedAt: '2026-10-21T00:00:00.000Z',
    reason: 'forged runtime enablement',
  });
  const enableRun = runGate(['enable', '--record', record, '--json']);
  assert.equal(enableRun.status, 2, `runtime enablement must exit 2, stderr: ${enableRun.stderr}`);
  assert.match(enableRun.stderr, /ENABLEMENT_REQUIRES_PAIRED_COMMIT/);
  const enableReceipt = JSON.parse(enableRun.stdout);
  assert.equal(enableReceipt.recordTrusted, false);
  assert.ok(enableReceipt.recordDigest, 'the refused record is still digested as evidence');
  assert.equal(enableReceipt.recordDigest, sha256(fs.readFileSync(record)));

  // (6) input hygiene: a missing request file is exit 1 (invalid input),
  //     distinct from the scope denial exit 2 — the denial is never faked by
  //     crashing on input.
  const badInput = runGate(['start', '--request', path.join(tmp, 'absent.json')]);
  assert.equal(badInput.status, 1);
  assert.match(badInput.stderr, /request file/);
});

// ------------------------------------------------- J2 anchor integrity ------
test('F10 J2 anchor integrity: committed scope bytes re-digested independently match contentDigest and the shipped gate digest', async () => {
  assert.ok(fs.existsSync(SCOPE_FILE), 'scope registry missing (RED until implemented)');
  assert.ok(fs.existsSync(GATE_CLI), 'gate entry missing (RED until implemented)');
  const scope = JSON.parse(fs.readFileSync(SCOPE_FILE, 'utf8'));
  const { contentDigest } = scope;
  const payload = { ...scope };
  delete payload.contentDigest;

  const recomputed = sha256(canonical(payload));
  assert.equal(recomputed, contentDigest, 'committed contentDigest does not cover the committed bytes');

  // the shipped anchor must equal the committed digest (paired mutation)
  const gateSource = fs.readFileSync(GATE_CLI, 'utf8');
  const anchorMatch = gateSource.match(/EXPECTED_SCOPE_DIGEST\s*=\s*'([0-9a-f]{64})'/);
  assert.ok(anchorMatch, 'gate.mjs must ship the 64-hex EXPECTED_SCOPE_DIGEST anchor');
  assert.equal(anchorMatch[1], contentDigest, 'gate.mjs anchor drifted from scope-gate.json — scope flips are paired commits only');

  // behavioral cross-check through the real CLI: status readback is anchored
  const statusRun = runGate(['status', '--json']);
  assert.equal(statusRun.status, 0, `status must exit 0, stderr: ${statusRun.stderr}`);
  const receipt = JSON.parse(statusRun.stdout);
  assert.equal(receipt.anchored, true);
  assert.equal(receipt.status, 'NOT_ENABLED');
  assert.equal(receipt.scope, 'CROSS_MACHINE_SCOPE');

  // and pointing the CLI at a tampered copy (content edited, digest left
  // stale) is a SCOPE_DIGEST_MISMATCH refusal, exit 2
  const tmp = workdir('j2');
  const tampered = writeJson(path.join(tmp, 'scope-gate.json'), { ...scope, status: 'ENABLED' });
  const tamperedRun = runGate(['status', '--scope-file', tampered, '--json']);
  assert.equal(tamperedRun.status, 2, `tampered scope must exit 2, stderr: ${tamperedRun.stderr}`);
  assert.match(tamperedRun.stderr, /SCOPE_DIGEST_MISMATCH/);
});

// ---------------------------------------------------- J3 F10 boundary -------
test('F10 J3 boundary: F10 stays UNVERIFIED with the existing holder; gate text intact; no positive cross-machine surface built', () => {
  // (1) the acceptance-index F10 entry keeps UNVERIFIED + the existing
  //     holder — this delivery never rewrites it to pass via "not enabled".
  const index = JSON.parse(fs.readFileSync(ACCEPTANCE_INDEX, 'utf8'));
  const f10 = index.F10 ?? index.entries?.F10 ?? index.acceptance?.F10;
  assert.ok(f10, 'acceptance-index.json must carry the F10 entry');
  assert.equal(f10.status, 'UNVERIFIED', 'F10 must stay UNVERIFIED in the not-enabled run');
  assert.match(f10.holder, /P5_2 owner/);
  assert.match(f10.holder, /用户跨机器范围裁决/);
  assert.match(String(f10.notes ?? ''), /CROSS_MACHINE_SCOPE_NOT_ENABLED/);

  // (2) the tasks.md gate text is intact (read-only check)
  const tasks = fs.readFileSync(TASKS_MD, 'utf8');
  assert.match(tasks, /CROSS_MACHINE_SCOPE_NOT_ENABLED/);
  assert.match(tasks, /不能以["“]未启用["”]判F10通过|不能以["“]未启用["”]判 ?F10 ?通过|未执行的正向隔离恢复认证保留 ?UNVERIFIED/);

  // (3) no positive construction: the service directory holds exactly the
  //     two guard artifacts and no server/database/identity code.
  const entries = fs.readdirSync(SERVICE_DIR).sort();
  assert.deepEqual(entries, ['gate.mjs', 'scope-gate.json'], 'not-enabled state ships only the guard artifacts');
  const gateSource = fs.readFileSync(GATE_CLI, 'utf8');
  assert.doesNotMatch(gateSource, /createServer|net\.connect|postgres|\bpg\b|knex|mongodb|listen\(/i,
    'the gate must not build positive cross-machine surface (no server/db/identity code)');
  assert.match(gateSource, /CROSS_MACHINE_SCOPE_NOT_ENABLED/, 'the gate code carries the frozen denial code');

  // (4) the registered scope keeps the post-enable construction scope honest:
  //     reuse PostgreSQL/evidence storage/identity service, API only manages
  //     evidence/approvals/receipts, never step scheduling (tasks.md 5.2.a),
  //     and the positive auth items stay listed as UNVERIFIED until run.
  const scope = JSON.parse(fs.readFileSync(SCOPE_FILE, 'utf8'));
  const post = JSON.stringify(scope.postEnableScope ?? {});
  assert.match(post, /PostgreSQL/);
  assert.match(post, /evidence storage/);
  assert.match(post, /identity service/);
  assert.match(post, /never takes over step scheduling|不接管/);
  const unverified = JSON.stringify(scope.postEnableScope?.staysUnverifiedUntilRun ?? []);
  for (const item of ['isolation', 'revocation', 'restore', 'API-disconnect']) {
    assert.match(unverified, new RegExp(item, 'i'), `post-enable scope must keep ${item} listed as UNVERIFIED-until-run`);
  }
});

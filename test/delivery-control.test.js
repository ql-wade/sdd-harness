// P5_2 unit coverage — F10 in the CROSS_MACHINE_SCOPE_NOT_ENABLED state.
//
// The frozen plan gates services/delivery-control/ behind an explicit
// cross-machine scope decision by the user (tasks.md P5_2: 前置
// CROSS_MACHINE_SCOPE_NOT_ENABLED; 条件性启用门——启用前真实验证拒绝启动/拒绝
// 发布). This run's user did NOT enable the cross-machine scope, so the
// deliverable under test is the NOT_ENABLED guard itself:
//   - start / publish requests are REALLY denied (spawned real processes,
//     exit 2, explicit code CROSS_MACHINE_SCOPE_NOT_ENABLED on stderr);
//   - a forged scope file (status flipped to ENABLED, self-digest recomputed)
//     is rejected by the enabled-state anchoring check — the scope file must
//     carry a content digest anchored to the gate binary (configVersion
//     lesson: paired mutation, no silent flip);
//   - environment variables can never silently flip the gate;
//   - opening the gate requires an explicitly registered record — a runtime
//     record alone is refused (ENABLEMENT_REQUIRES_PAIRED_COMMIT);
//   - the committed scope file is anchored: its content digest matches the
//     digest shipped inside gate.mjs (drift between the two = broken pairing).
//
// Positive cross-machine construction (isolation / revocation / restore-time
// re-auth / API-disconnect cached-green denial) is NOT built here and stays
// UNVERIFIED — "not enabled" never counts as F10 pass. The journey-level
// boundary assertion lives in test/delivery-cases/5_2.mjs.
//
// Zero new npm dependencies; fixtures under os.tmpdir(); nothing outside
// $TMPDIR is written; spawned processes get an isolated HOME/TMPDIR.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVICE_DIR = path.join(projectRoot, 'services', 'delivery-control');
const GATE_CLI = path.join(SERVICE_DIR, 'gate.mjs');
const SCOPE_FILE = path.join(SERVICE_DIR, 'scope-gate.json');

// ---------------------------------------------------------------- helpers ---
function workdir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `sdd-p52-unit-${label}-`));
}

function isolatedEnv(tmp) {
  const env = { ...process.env, HOME: tmp, TMPDIR: tmp, PATH: '/usr/bin:/bin' };
  delete env.NODE_TEST_CONTEXT;
  return env;
}

function runGate(args, { env, cwd } = {}) {
  const tmp = workdir('run');
  return spawnSync(process.execPath, [GATE_CLI, ...args], {
    encoding: 'utf8',
    env: env ?? isolatedEnv(tmp),
    cwd: cwd ?? tmp,
  });
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
  return file;
}

function requestFixture(dir, name = 'request.json') {
  return writeJson(path.join(dir, name), {
    schemaVersion: 1,
    action: 'team-control-launch',
    runId: 'run-p52-unit',
    requester: 'worker-p5-2',
    requestedAt: '2026-10-21T00:00:00.000Z',
  });
}

// Load the gate module dynamically so its absence is a per-test real RED.
async function loadGate() {
  assert.ok(fs.existsSync(GATE_CLI), `gate entry missing: services/delivery-control/gate.mjs (RED until implemented)`);
  return import(`file://${GATE_CLI}`);
}

// Independent canonical-JSON digest (same scheme, authored here on purpose so
// the anchor chain has a second, independent oracle).
function independentCanonical(value) {
  if (Array.isArray(value)) return `[${value.map(independentCanonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${independentCanonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
const independentDigest = (value) =>
  import('node:crypto').then(({ createHash }) => createHash('sha256').update(independentCanonical(value)).digest('hex'));

// ------------------------------------------------- anchor pairing (t1–t3) ---
test('committed scope-gate.json is anchored: contentDigest is self-consistent and equals the digest shipped in gate.mjs', async () => {
  const gate = await loadGate();
  assert.ok(fs.existsSync(SCOPE_FILE), 'scope registry missing: services/delivery-control/scope-gate.json (RED until implemented)');
  const scope = JSON.parse(fs.readFileSync(SCOPE_FILE, 'utf8'));

  const { contentDigest } = scope;
  const payload = { ...scope };
  delete payload.contentDigest;

  // independent recomputation from the committed bytes
  assert.equal(await independentDigest(payload), contentDigest, 'contentDigest does not match the committed payload (tampered or stale)');
  // shipped anchor — paired-mutation invariant (configVersion lesson)
  assert.equal(gate.EXPECTED_SCOPE_DIGEST, contentDigest, 'gate.mjs anchor digest drifted from the committed scope file; scope flips must be a paired commit');
  // registered state
  assert.equal(scope.scope, 'CROSS_MACHINE_SCOPE');
  assert.equal(scope.status, 'NOT_ENABLED');
});

test('canonical stringify is key-order independent (digest stability)', async () => {
  const gate = await loadGate();
  const a = { z: 1, a: { y: [1, { b: 2, a: 1 }], x: 's' }, n: null };
  const b = { a: { x: 's', y: [1, { a: 1, b: 2 }] }, n: null, z: 1 };
  assert.equal(gate.canonicalStringify(a), gate.canonicalStringify(b));
  assert.equal(gate.canonicalStringify(a), independentCanonical(a));
});

test('verifyScopeAnchoring refuses tampered content with a stale digest (SCOPE_DIGEST_MISMATCH)', async () => {
  const gate = await loadGate();
  const scope = JSON.parse(fs.readFileSync(SCOPE_FILE, 'utf8'));
  const forged = { ...scope, status: 'NOT_ENABLED', notEnabledBehavior: { ...scope.notEnabledBehavior, note: 'tampered in place' } };
  const verdict = gate.verifyScopeAnchoring(forged);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, 'SCOPE_DIGEST_MISMATCH');
});

// --------------------------------------- real denial paths (t4–t8, spawn) ---
test('start request is REALLY denied: real process, exit 2, code CROSS_MACHINE_SCOPE_NOT_ENABLED', () => {
  const tmp = workdir('start');
  const request = requestFixture(tmp);
  const run = runGate(['start', '--request', request, '--json']);
  assert.equal(run.status, 2, `expected exit 2, stderr: ${run.stderr}`);
  assert.match(run.stderr, /CROSS_MACHINE_SCOPE_NOT_ENABLED/);
  const receipt = JSON.parse(run.stdout);
  assert.equal(receipt.status, 'DENIED');
  assert.ok(receipt.refusals.some((r) => r.code === 'CROSS_MACHINE_SCOPE_NOT_ENABLED'));
});

test('publish request is REALLY denied: real process, exit 2, code CROSS_MACHINE_SCOPE_NOT_ENABLED', () => {
  const tmp = workdir('publish');
  const request = requestFixture(tmp, 'publish-request.json');
  const run = runGate(['publish', '--request', request]);
  assert.equal(run.status, 2, `expected exit 2, stderr: ${run.stderr}`);
  assert.match(run.stderr, /CROSS_MACHINE_SCOPE_NOT_ENABLED/);
});

test('forged scope file (status ENABLED with a recomputed self-digest) is rejected by the anchor check', async () => {
  const gate = await loadGate();
  const tmp = workdir('forged');
  const scope = JSON.parse(fs.readFileSync(SCOPE_FILE, 'utf8'));
  // a real forger recomputes the self-consistency digest after flipping status
  const forgedPayload = { ...scope, status: 'ENABLED' };
  delete forgedPayload.contentDigest;
  const forged = { ...forgedPayload, contentDigest: await independentDigest(forgedPayload) };
  const forgedFile = writeJson(path.join(tmp, 'scope-gate.json'), forged);

  const request = requestFixture(tmp);
  const run = runGate(['start', '--request', request, '--scope-file', forgedFile, '--json']);
  assert.equal(run.status, 2, `expected exit 2, stderr: ${run.stderr}`);
  assert.match(run.stderr, /SCOPE_FILE_NOT_ANCHORED/);
  const receipt = JSON.parse(run.stdout);
  assert.ok(receipt.refusals.some((r) => r.code === 'SCOPE_FILE_NOT_ANCHORED'));
  // the shipped anchor is what the forged digest fails against
  assert.notEqual(forged.contentDigest, gate.EXPECTED_SCOPE_DIGEST);
});

test('environment variables can never silently flip the gate (still denied under scope-ENABLED env)', () => {
  const tmp = workdir('envflip');
  const request = requestFixture(tmp);
  const env = {
    ...isolatedEnv(tmp),
    CROSS_MACHINE_SCOPE: 'ENABLED',
    SDD_CROSS_MACHINE_SCOPE: 'ENABLED',
    DELIVERY_CONTROL_SCOPE: 'enabled',
    DELIVERY_CONTROL_CROSS_MACHINE: '1',
  };
  const run = runGate(['start', '--request', request, '--json'], { env });
  assert.equal(run.status, 2, `env vars must not flip the gate; stderr: ${run.stderr}`);
  assert.match(run.stderr, /CROSS_MACHINE_SCOPE_NOT_ENABLED/);
});

test('opening the gate requires an explicitly registered record: runtime enable record is refused (ENABLEMENT_REQUIRES_PAIRED_COMMIT)', () => {
  const tmp = workdir('enable');
  const record = writeJson(path.join(tmp, 'enablement-record.json'), {
    schemaVersion: 1,
    decision: 'ENABLE',
    scope: 'CROSS_MACHINE_SCOPE',
    decidedBy: 'worker-p5-2', // a worker/caller NEVER holds this authority
    decidedAt: '2026-10-21T00:00:00.000Z',
    reason: 'attempted runtime enablement',
  });
  const run = runGate(['enable', '--record', record, '--json']);
  assert.equal(run.status, 2, `expected exit 2, stderr: ${run.stderr}`);
  assert.match(run.stderr, /ENABLEMENT_REQUIRES_PAIRED_COMMIT/);
  const receipt = JSON.parse(run.stdout);
  // the caller-supplied record is digested as evidence, never trusted as approval
  assert.equal(receipt.recordTrusted, false);
});

// ----------------------------------------------------- input hygiene (t9) ---
test('missing request file is invalid input (exit 1), not a scope denial', () => {
  const run = runGate(['start', '--request', path.join(workdir('missing'), 'nope.json')]);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /request file/);
});

// --------------------------------------------------- status readback (t10) ---
test('status readback reports the anchored NOT_ENABLED scope and keeps positive auth UNVERIFIED', () => {
  const run = runGate(['status', '--json']);
  assert.equal(run.status, 0, `expected exit 0, stderr: ${run.stderr}`);
  const receipt = JSON.parse(run.stdout);
  assert.equal(receipt.scope, 'CROSS_MACHINE_SCOPE');
  assert.equal(receipt.status, 'NOT_ENABLED');
  assert.equal(receipt.anchored, true);
  assert.equal(receipt.positiveAuthStatus, 'UNVERIFIED');
  assert.match(receipt.positiveAuthHolder, /P5_2 owner/);
  assert.match(receipt.positiveAuthHolder, /用户跨机器范围裁决/);
  // receipts carry no host paths
  assert.doesNotMatch(run.stdout, /\/Users\//);
});

// P5_3 delivery case — rework (rework-seven-p1-r1), branch rework/p5-3, base
// 129cfdf. Operations runbook, team recovery, the capability boundary ledger
// and the version-rollback recipe for the managed Comet driver (A10/A11/H09).
//
// The run's user did NOT enable the cross-machine scope (precondition
// CROSS_MACHINE_SCOPE_NOT_ENABLED: enablement.json enabled=false + refuse
// [start,release,implement] + f10_state UNVERIFIED_NOT_ENABLED; the P5_1
// machine matrix wildcard host is default-deny with the same refusals), so
// this journey verifies what is really shipped: the LOCAL single-authority
// capabilities (lease, fencing, background supervision, version rollback) are
// re-proven with real processes, and the cross-machine boundary stays honestly
// closed instead of being faked with a shared local directory (tasks.md P5_3
// 禁令: 共享本地目录假装分布式 = 明确禁止).
//
// Rework delta vs the old-run 5_3.mjs: the legacy ScopeGate.v1
// (services/delivery-control/scope-gate.json + the code-anchored
// EXPECTED_SCOPE_DIGEST) was superseded by DeliveryControl.EnablementGate.v2
// (P5_2 rework GREEN 0eb9959), so every gate assertion here is rewritten to
// the v2 form — enablement.json readback, refusal semantics, decision-record
// enablement path, same-source with the machine matrix (P5_2 review N1/N2:
// the old assertions were base-unsatisfiable assertion bugs, not runbook
// bugs). The runbook assertions track the actual manual content.
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
//   J3  version rollback (protocol level): the real tools/ci/release.mjs
//       promotes two digests and walks the rollback gates for real —
//       unapproved rollback refused (exit 2, ROLLBACK_NOT_APPROVED),
//       wrong-digest rollback refused (exit 2, ROLLBACK_DIGEST_MISMATCH),
//       approved same-digest rollback VERIFIED (exit 0) with the independent
//       business readback, and the accepted I06 evaluator independently
//       confirms the emitted chain.
//   J3b version rollback (git/.sdd level, 5.3.b recipe): team-recovery/
//       rollback-recipe.json pins the real candidate-rollback drill —
//       fingerprint-pinned .sdd build, full regression signature before the
//       rollback, git checkout of the previous acceptance commit, signature
//       re-run at the rolled-back candidate (known set still fail-closed),
//       the acceptance-index judge --generate idempotency, and the return to
//       the branch head. Deleting a mandatory recovery step is a RED.
//   J4  capability boundary ledger (5.3.a): team-recovery/
//       capability-boundary.json verifies the single-host lease/fencing/
//       background/rollback capabilities against on-disk evidence, records
//       the cross-machine half (A10/A11 cross-machine + H09 team release)
//       as NOT_ENABLED with the daemon-mode and distributed-lease-surface
//       absence evidence, carries the masquerade prohibition, and registers
//       the recheck triggers (when this boundary must be re-reviewed). The
//       runbook declares the v2 gate form, every known environment gate from
//       acceptance-index.json verbatim (hiding one is a RED), and the
//       rework-run boundaries; no stale legacy scope-gate reference survives.
//       Mutations: a NOT_ENABLED capability marked pass-like, a shared-local-
//       directory masquerade, and deleted recheck triggers are all refused.
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
const BOUNDARY_FILE = path.join(TEAM_RECOVERY, 'capability-boundary.json');
const ROLLBACK_RECIPE = path.join(TEAM_RECOVERY, 'rollback-recipe.json');
const ACCEPTANCE_INDEX = path.join(CHANGE_DIR, 'acceptance-index.json');
const GATE_CLI = path.join(projectRoot, 'services', 'delivery-control', 'gate.mjs');
const ENABLEMENT_FILE = path.join(projectRoot, 'services', 'delivery-control', 'enablement.json');
const MATRIX_FILE = path.join(CHANGE_DIR, 'team-host-matrix', 'matrix.json');
const RELEASE_CLI = path.join(projectRoot, 'tools', 'ci', 'release.mjs');
const PLATFORM_CLI = path.join(projectRoot, 'tools', 'infra', 'platform.mjs');

const SHA = (label) => crypto.createHash('sha256').update(`p53-${label}`).digest('hex').slice(0, 40);
const DIGEST = (label) => `sha256:${crypto.createHash('sha256').update(`p53-${label}`).digest('hex')}`;
const RUN_TIMEOUT_MS = 120_000;

const REFUSE_TRIO = ['start', 'release', 'implement'];
const PASS_LIKE = new Set(['VERIFIED', 'SUPPORTED', 'PASS']);
const CROSS_MACHINE_CAPABILITIES = [
  'a10-cross-machine-concurrency',
  'a11-cross-machine-recovery',
  'a12-cross-machine-parent-revalidation',
  'team-release',
];
const ROLLBACK_MANDATORY_STEPS = [
  'record-before-signature',
  'checkout-previous-candidate',
  'record-rolled-back-signature',
  'return-to-head',
];

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

// Repo-relative evidence paths only: absolute paths and .. escapes are a
// portability/honesty defect in a committed ledger (zero host-path leaks).
function checkEvidencePath(where, ev, issues) {
  if (typeof ev !== 'string' || ev.length === 0 || path.isAbsolute(ev) || ev.split('/').includes('..')) {
    issues.push(`${where}: evidence must be a repo-relative path, got ${JSON.stringify(ev)}`);
    return;
  }
  if (!fs.existsSync(path.join(projectRoot, ev))) issues.push(`${where}: evidence does not exist on disk: ${ev}`);
}

function validateBoundaryRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return ['capability boundary record is not an object'];
  const issues = [];
  if (record.interface !== 'TeamRecovery.CapabilityBoundary.v1') issues.push('interface must be TeamRecovery.CapabilityBoundary.v1');
  if (record.scope !== 'CROSS_MACHINE') issues.push('scope must be CROSS_MACHINE');

  // The gate block is same-source with the live enablement.json: while the
  // scope is closed the ledger may not carry any open-gate claim.
  const gate = record.gate ?? {};
  if (gate.source !== 'services/delivery-control/enablement.json') issues.push('gate.source must point at services/delivery-control/enablement.json');
  if (gate.enabled !== false) issues.push('gate.enabled must be false while the cross-machine scope is closed');
  if (gate.f10_state !== 'UNVERIFIED_NOT_ENABLED') issues.push('gate.f10_state must be UNVERIFIED_NOT_ENABLED (not-enabled never passes)');
  if (JSON.stringify(gate.refuse) !== JSON.stringify(REFUSE_TRIO)) issues.push('gate.refuse must be exactly [start, release, implement] (same source as enablement.json)');

  // verified_local: only really-proven single-host capabilities, each with
  // existing on-disk evidence.
  const verified = record.verified_local ?? [];
  if (verified.length < 3) issues.push(`at least three single-host capabilities must be carried as VERIFIED, found ${verified.length}`);
  for (const entry of verified) {
    if (!entry.capability) issues.push('verified_local entry: capability name is required');
    if (entry.status !== 'VERIFIED') issues.push(`verified_local ${entry.capability}: only real VERIFIED entries belong here, got ${entry.status}`);
    if (!Array.isArray(entry.evidence) || entry.evidence.length === 0) issues.push(`${entry.capability}: at least one evidence pointer is required`);
    for (const ev of entry.evidence ?? []) checkEvidencePath(`${entry.capability}`, ev, issues);
  }

  // not_enabled: exactly the matrix wildcard cross-machine set, never
  // pass-like, never based on a shared local directory (masquerade).
  const notEnabled = record.not_enabled ?? [];
  const ids = notEnabled.map((entry) => entry.capability);
  for (const id of CROSS_MACHINE_CAPABILITIES) {
    if (!ids.includes(id)) issues.push(`cross-machine capability missing from the ledger: ${id}`);
  }
  for (const entry of notEnabled) {
    if (!CROSS_MACHINE_CAPABILITIES.includes(entry.capability)) issues.push(`unknown cross-machine capability in the ledger: ${entry.capability}`);
    if (PASS_LIKE.has(entry.status)) {
      issues.push(`MASQUERADE: ${entry.capability} claims pass-like status "${entry.status}" while the cross-machine gate is disabled — not-enabled never passes`);
    } else if (entry.status !== 'NOT_ENABLED') {
      issues.push(`${entry.capability}: status must be NOT_ENABLED while the gate is closed, got ${entry.status}`);
    }
    if (typeof entry.basis === 'string' && /shared[- ]local|共享\s*本地|本地\s*共享|mounted\s+(state|dir)/i.test(entry.basis)) {
      issues.push(`MASQUERADE: ${entry.capability} bases a cross-machine claim on a shared local directory — forbidden by tasks.md P5_3`);
    }
  }

  if (typeof record.masquerade_forbidden !== 'string' || record.masquerade_forbidden.length < 20) {
    issues.push('masquerade_forbidden must state the prohibition: shared local directories / single-host state must never be marked distributed or team-level');
  }

  // Honest absence records with real on-disk evidence.
  const boundary = record.boundary ?? {};
  for (const key of ['daemon_mode', 'distributed_lease_surface']) {
    const entry = boundary[key];
    if (!entry || typeof entry !== 'object') {
      issues.push(`boundary.${key} must record the honest absence (present:false + evidence)`);
      continue;
    }
    if (entry.present !== false) issues.push(`boundary.${key}: present must be false (honest absence, not a capability claim)`);
    checkEvidencePath(`boundary.${key}`, entry.evidence, issues);
  }

  // Recheck triggers: when this boundary must be re-reviewed. The two
  // mandatory topics are the enablement adjudication and an upstream
  // service-mode/lease-surface change (tasks.md P5_3 复审触发器).
  const triggers = record.recheck_triggers ?? [];
  if (!Array.isArray(triggers) || triggers.length < 2) {
    issues.push(`at least two recheck triggers are required, found ${Array.isArray(triggers) ? triggers.length : 'none'}`);
  }
  const joined = (triggers ?? []).map((trigger) => `${trigger.id ?? ''} ${trigger.condition ?? ''}`).join(' ');
  if (!/启用裁决|enablement|enabled\s*=\s*true/i.test(joined)) {
    issues.push('recheck triggers must cover the cross-machine enablement adjudication landing');
  }
  if (!/服务模式|service\s*mode|上游|upstream|patch/i.test(joined)) {
    issues.push('recheck triggers must cover an upstream change introducing a service mode or distributed lease surface');
  }
  for (const [index, trigger] of triggers.entries()) {
    if (!trigger.id || !trigger.condition || !trigger.action) issues.push(`recheck trigger ${index + 1}: id, condition and action are required`);
  }
  return issues;
}

function validateRollbackRecipe(recipe) {
  if (!recipe || typeof recipe !== 'object' || Array.isArray(recipe)) return ['rollback recipe is not an object'];
  const issues = [];
  if (recipe.interface !== 'TeamRecovery.RollbackRecipe.v1') issues.push('interface must be TeamRecovery.RollbackRecipe.v1');
  if (!recipe.operationKey) issues.push('operationKey is required (one identity for the whole drill)');
  const steps = recipe.steps ?? [];
  if (!Array.isArray(steps) || steps.length < 4) issues.push('rollback recipe needs at least four real steps');
  const ids = steps.map((step) => step.id);
  for (const id of ROLLBACK_MANDATORY_STEPS) {
    if (!ids.includes(id)) issues.push(`rollback recipe is missing the mandatory recovery step: ${id}`);
  }
  for (const step of steps) {
    if (typeof step.command !== 'string' || step.command.length === 0) {
      issues.push(`step ${step.id ?? '?'}: command is required`);
      continue;
    }
    const nodeMatch = step.command.match(/^node (\S+)/);
    if (nodeMatch && !nodeMatch[1].includes('<')) {
      const entry = path.resolve(projectRoot, nodeMatch[1]);
      if (!fs.existsSync(entry)) issues.push(`step ${step.id}: referenced entry does not exist: ${nodeMatch[1]}`);
    }
    if (typeof step.verify !== 'string' || step.verify.length === 0) issues.push(`step ${step.id}: verify (success criterion) is required`);
  }
  // Fail-closed expectation: the drill must expect the KNOWN-SET regression
  // signature at both time points, never a zero-fail fantasy.
  const signature = recipe.expected_signature ?? {};
  if (signature.rule !== 'KNOWN_SET_FAIL_CLOSED') issues.push('expected_signature.rule must be KNOWN_SET_FAIL_CLOSED (rollback keeps the known environment failures honestly failing, it does not hide them)');
  if (!Array.isArray(signature.known_failures) || signature.known_failures.length < 2) {
    issues.push('expected_signature.known_failures must name the known environment failures preserved across the rollback');
  }
  for (const known of signature.known_failures ?? []) {
    if (typeof known !== 'string' || known.length < 5) issues.push('known failure entries must be descriptive strings');
  }
  if (!/475[\s\S]*472/.test(String(signature.baseline ?? ''))) {
    issues.push('expected_signature.baseline must pin the documented npm test baseline (475 tests / 472 pass / 2 fail / 1 skipped)');
  }
  return issues;
}

function validateRunbookBoundary({ runbookText: text, gatedStrings }) {
  const issues = [];
  // v2 gate form (P5_2 rework): enablement.json + refusal semantics +
  // decision-record enablement path + F10 pinning.
  for (const fact of [
    'services/delivery-control/enablement.json',
    'DeliveryControl.EnablementGate.v2',
    'CROSS_MACHINE_SCOPE_NOT_ENABLED',
    'UNVERIFIED_NOT_ENABLED',
    'UNVERIFIED_ENABLED_CONSTRUCTION_PENDING',
    'ENABLEMENT_REQUIRES_REGISTERED_DECISION',
    'ENABLE_CROSS_MACHINE_SCOPE',
  ]) {
    if (!text.includes(fact)) issues.push(`runbook must declare the v2 gate fact: ${fact}`);
  }
  if (!/refuse[\s\S]{0,120}start[\s\S]{0,40}release[\s\S]{0,40}implement/.test(text)) {
    issues.push('runbook must declare the refusal trio (refuse start/release/implement, same source as enablement.json)');
  }
  // No stale legacy reference survives: the deleted ScopeGate.v1 artifacts
  // must not be presented as current state (P5_2 review N1/N2).
  if (text.includes('services/delivery-control/scope-gate.json')) {
    issues.push('runbook still functionally references the deleted legacy scope-gate.json path — the v2 gate is enablement.json');
  }
  if (text.includes('EXPECTED_SCOPE_DIGEST')) {
    issues.push('runbook still references the superseded EXPECTED_SCOPE_DIGEST code anchor (v2 binds enablement to a user adjudication record)');
  }
  if (text.includes('ENABLEMENT_REQUIRES_PAIRED_COMMIT')) {
    issues.push('runbook still cites the superseded v1 refusal code ENABLEMENT_REQUIRES_PAIRED_COMMIT (v2: ENABLEMENT_REQUIRES_REGISTERED_DECISION)');
  }
  // Masquerade prohibition + rework-run boundaries.
  if (!/共享本地目录|shared local director/i.test(text)) {
    issues.push('runbook must carry the masquerade prohibition (shared local directories must never be marked distributed/team-level)');
  }
  if (!/无\s*daemon|没有\s*daemon|无服务模式|no daemon|service mode/i.test(text)) {
    issues.push('runbook must declare the S5 boundary: the comet CLI has no daemon/service mode');
  }
  if (!text.includes('s5-runner-help.txt')) issues.push('runbook must cite the S5 runner-help evidence (worker-reports/I02-rework/evidence/s5-runner-help.txt)');
  if (!text.includes('S7') || !text.includes('S8')) issues.push('runbook must declare the I02 S7/S8 pending-credential boundary');
  if (!text.includes('F10')) issues.push('runbook must declare the F10 NOT_ENABLED boundary');
  for (const entry of ['compose', 'Outline', '--generate']) {
    if (!text.includes(entry)) issues.push(`runbook must document the rework-run ops surface entry: ${entry}`);
  }
  // Environment gates: hiding one known gate is a RED (verbatim, from the
  // accepted acceptance-index.json structure).
  for (const gate of gatedStrings) {
    if (!text.includes(gate)) issues.push(`runbook hides a known environment gate (verbatim string missing): ${String(gate).slice(0, 60)}…`);
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
// J3b — the git/.sdd-level rollback recipe (5.3.b): machine-checkable steps,
// fail-closed known-set expectation. The drill itself is executed for real by
// the P5_3 worker; its two-timepoint evidence lives in
// worker-reports/P5_3-rework/evidence/.
// ===========================================================================

function loadRollbackRecipe() {
  assert.ok(fs.existsSync(ROLLBACK_RECIPE), 'team-recovery/rollback-recipe.json is missing (P5_3 RED until the rollback drill recipe lands)');
  return JSON.parse(fs.readFileSync(ROLLBACK_RECIPE, 'utf8'));
}

test('J3b: the git-level rollback recipe (5.3.b) is machine-checkable — mandatory steps, real entries, known-set fail-closed expectation', () => {
  const issues = validateRollbackRecipe(loadRollbackRecipe());
  assert.deepEqual(issues, [], `rollback recipe problems: ${issues.join(' | ')}`);
});

test('J3b negative (mutation M4): a rollback recipe with a mandatory recovery step deleted is refused', () => {
  const recipe = loadRollbackRecipe();
  const tampered = JSON.parse(JSON.stringify(recipe));
  tampered.steps = tampered.steps.filter((step) => step.id !== 'record-rolled-back-signature');
  const issues = validateRollbackRecipe(tampered);
  assert.ok(issues.some((issue) => issue.includes('record-rolled-back-signature')),
    `deleting the rolled-back signature step must be reported, got: ${issues.join(' | ')}`);
});

// ===========================================================================
// J4 — the capability boundary ledger (5.3.a): single-host VERIFIED with real
// evidence, cross-machine honestly NOT_ENABLED, local-dir masquerade
// mechanically refused — plus the v2 gate readback and same-source checks.
// ===========================================================================

function loadBoundaryRecord() {
  assert.ok(fs.existsSync(BOUNDARY_FILE), 'team-recovery/capability-boundary.json is missing (P5_3 RED until the capability boundary ledger lands)');
  return JSON.parse(fs.readFileSync(BOUNDARY_FILE, 'utf8'));
}

test('J4: the capability boundary ledger verifies single-host lease/fencing/background/rollback with on-disk evidence and records the cross-machine boundary honestly', () => {
  const record = loadBoundaryRecord();
  const issues = validateBoundaryRecord(record);
  assert.deepEqual(issues, [], `capability boundary problems: ${issues.join(' | ')}`);
});

test('J4 negative (mutation M1): marking a NOT_ENABLED cross-machine capability as VERIFIED is refused (not-enabled never passes)', () => {
  const record = loadBoundaryRecord();
  const tampered = JSON.parse(JSON.stringify(record));
  tampered.not_enabled[0].status = 'VERIFIED';
  const issues = validateBoundaryRecord(tampered);
  assert.ok(issues.some((issue) => issue.includes('MASQUERADE') && issue.includes('pass-like')),
    `a pass-like cross-machine claim must be refused, got: ${issues.join(' | ')}`);
});

test('J4 negative (mutation M2): a shared-local-directory masquerade of a cross-machine capability is refused', () => {
  const record = loadBoundaryRecord();
  const tampered = JSON.parse(JSON.stringify(record));
  tampered.not_enabled[0] = {
    capability: 'a10-cross-machine-concurrency',
    status: 'SUPPORTED',
    basis: 'shared-local-directory (mounted state dir shared between sessions)',
    note: 'the local state directory doubles as the team store',
  };
  const issues = validateBoundaryRecord(tampered);
  assert.ok(issues.some((issue) => issue.includes('MASQUERADE') && issue.includes('pass-like')),
    `the pass-like masquerade must be refused, got: ${issues.join(' | ')}`);
  assert.ok(issues.some((issue) => issue.includes('shared local directory')),
    `the shared-local-directory basis must be refused, got: ${issues.join(' | ')}`);
});

test('J4 negative (mutation M3): deleting the recheck triggers (or leaving them topic-incomplete) is refused', () => {
  const record = loadBoundaryRecord();
  const emptied = JSON.parse(JSON.stringify(record));
  emptied.recheck_triggers = [];
  const issuesA = validateBoundaryRecord(emptied);
  assert.ok(issuesA.some((issue) => issue.includes('at least two recheck triggers')),
    `emptying the triggers must be reported, got: ${issuesA.join(' | ')}`);
  const single = JSON.parse(JSON.stringify(record));
  single.recheck_triggers = single.recheck_triggers.filter((trigger) => !/启用裁决|enablement|enabled\s*=\s*true/i.test(`${trigger.id} ${trigger.condition}`));
  const issuesB = validateBoundaryRecord(single);
  assert.ok(issuesB.some((issue) => issue.includes('enablement adjudication')),
    `dropping the enablement-adjudication trigger must be reported, got: ${issuesB.join(' | ')}`);
});

test('J4: the v2 enablement gate readback stays honestly closed — status OK with UNVERIFIED_NOT_ENABLED, start/release/implement denied, runtime records never trusted', () => {
  const tmp = workdir('j4');
  try {
    const status = runNode([GATE_CLI, 'status', '--json'], { env: childEnv(tmp) });
    assert.equal(status.status, 0, `gate status readback must exit 0, stderr: ${String(status.stderr).slice(0, 300)}`);
    const receipt = JSON.parse(status.stdout);
    assert.equal(receipt.interface, 'DeliveryControl.EnablementGate.v2');
    assert.equal(receipt.status, 'OK');
    assert.equal(receipt.enabled, false);
    assert.deepEqual(receipt.refuse, REFUSE_TRIO);
    assert.equal(receipt.f10State, 'UNVERIFIED_NOT_ENABLED', 'F10 stays pinned to UNVERIFIED_NOT_ENABLED while the scope is closed');
    assert.equal(receipt.construction, 'NOT_BUILT');
    assert.equal(receipt.positiveAuthStatus, 'UNVERIFIED', 'the positive cross-machine auth must stay UNVERIFIED, not silently pass');

    const request = path.join(tmp, 'request.json');
    fs.writeFileSync(request, JSON.stringify({ project: 'sdd-harness-pilot', requestedBy: 'ops-oncall' }));
    for (const action of REFUSE_TRIO) {
      const denied = runNode([GATE_CLI, action, '--request', request, '--json'], { env: childEnv(tmp) });
      assert.equal(denied.status, 2, `${action} must be denied with exit 2 while the cross-machine scope is not enabled`);
      const body = JSON.parse(denied.stdout);
      assert.ok(body.refusals.some((refusal) => refusal.code === 'CROSS_MACHINE_SCOPE_NOT_ENABLED'),
        `${action} refusal must carry CROSS_MACHINE_SCOPE_NOT_ENABLED`);
      assert.equal(body.positiveAuthStatus, 'UNVERIFIED', `a ${action} denial must not silently pass F10`);
    }

    // A runtime enablement record is digested as evidence and never trusted.
    const record = path.join(tmp, 'record.json');
    fs.writeFileSync(record, JSON.stringify({ decidedBy: 'user', scope: 'CROSS_MACHINE_SCOPE', decision: 'enable' }));
    const enable = runNode([GATE_CLI, 'enable', '--record', record, '--json'], { env: childEnv(tmp) });
    assert.equal(enable.status, 2, 'a runtime enable record must not open the gate');
    const enableReceipt = JSON.parse(enable.stdout);
    assert.equal(enableReceipt.refusals[0].code, 'ENABLEMENT_REQUIRES_REGISTERED_DECISION');
    assert.equal(enableReceipt.recordTrusted, false, 'a runtime record is digested, never trusted');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('J4: gate, machine matrix and capability ledger are same-source on the wildcard default-deny', () => {
  const gate = JSON.parse(fs.readFileSync(ENABLEMENT_FILE, 'utf8'));
  assert.equal(gate.enabled, false);
  assert.equal(gate.decision_record, null);
  assert.equal(gate.f10_state, 'UNVERIFIED_NOT_ENABLED');
  assert.deepEqual(gate.refuse, REFUSE_TRIO);
  assert.ok(/team-host-matrix\/matrix\.json/.test(gate.semantics_source ?? ''), 'enablement.json must cite the machine matrix as its semantics source');

  const matrix = JSON.parse(fs.readFileSync(MATRIX_FILE, 'utf8'));
  const wildcard = (matrix.machine_dimension?.hosts ?? []).find((host) => host.host === '*');
  assert.ok(wildcard, 'the machine matrix must keep the default-deny wildcard host');
  assert.equal(wildcard.enabled, false);
  assert.equal(wildcard.refusals?.refuse_start?.status, 'NOT_ENABLED');
  assert.equal(wildcard.refusals?.refuse_release?.status, 'NOT_ENABLED');
  for (const id of CROSS_MACHINE_CAPABILITIES) {
    assert.equal(wildcard.capabilities?.[id]?.status, 'NOT_ENABLED', `matrix wildcard capability ${id} must stay NOT_ENABLED`);
  }

  const record = loadBoundaryRecord();
  assert.deepEqual(
    [...record.not_enabled.map((entry) => entry.capability)].sort(),
    [...CROSS_MACHINE_CAPABILITIES].sort(),
    'the ledger not_enabled set must be the matrix wildcard cross-machine capability set',
  );
});

test('J4: the runbook carries the v2 gate form, every known environment gate verbatim and the rework-run boundaries; no stale legacy reference survives', () => {
  const text = runbookText();
  const index = JSON.parse(fs.readFileSync(ACCEPTANCE_INDEX, 'utf8'));
  const gatedStrings = (index.environment_gates?.from_partial_nodes ?? [])
    .flatMap((entry) => Object.values(entry.gated ?? {}))
    .map((value) => String(value));
  assert.ok(gatedStrings.length >= 4, `expected the acceptance index to carry its known environment gates, found ${gatedStrings.length}`);
  const issues = validateRunbookBoundary({ runbookText: text, gatedStrings });
  assert.deepEqual(issues, [], `runbook boundary declaration problems: ${issues.join(' | ')}`);
});

test('J4 negative: a runbook copy that hides one known environment gate is rejected', () => {
  const text = runbookText();
  const index = JSON.parse(fs.readFileSync(ACCEPTANCE_INDEX, 'utf8'));
  const gatedStrings = (index.environment_gates?.from_partial_nodes ?? [])
    .flatMap((entry) => Object.values(entry.gated ?? {}))
    .map((value) => String(value));
  const victim = gatedStrings[0];
  assert.ok(text.includes(victim), 'the real runbook must carry the gate verbatim');
  const tampered = text.replace(victim, victim.slice(0, Math.max(10, Math.floor(victim.length / 2))));
  const issues = validateRunbookBoundary({ runbookText: tampered, gatedStrings });
  assert.ok(issues.some((issue) => issue.includes('hides a known environment gate')), `expected the hidden gate to be reported, got: ${issues.join(' | ')}`);
});

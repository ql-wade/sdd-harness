#!/usr/bin/env node
// Pilot recovery/reconciliation executor (task P3_3) — recovery and
// reconciliation semantics built on the SAME chain as P3_2's role-chain
// executor: the run-bound launch authority (lib/adapters/comet.js
// cometLaunchAuthority, P1_3), the driver exclusivity layer
// (lib/adapters/harness.js), the trusted launcher + admission
// (lib/delivery/evidence.js, P2_2 Runner.Dispatch.v1 with attempt/epoch in
// every binding), the pure gate (lib/delivery/gate.js) and the real RED
// classifier (lib/delivery/test-contract.js) are imported unmodified.
//
// What this executor adds on the same chain (single environment semantics):
//   - single control ledger  : control/run-state.json is the only control-plane
//                              artifact; every mutation is a disk read-modify-
//                              write through an atomic tmp+rename, and every
//                              state judgment reads the bytes back from disk.
//   - epoch gate             : controller takeovers bump the ledger epoch
//                              (P2_4 runtime epoch-gate semantics, D08:
//                              concurrent writers are serialized by the state
//                              lock + epoch threshold). A receipt whose
//                              dispatch carries a superseded epoch is refused
//                              (STALE_EPOCH); a receipt bound to a superseded
//                              attempt is refused (STALE_ATTEMPT). The refusals
//                              are asserted at the gate layer through the
//                              imported admission machinery and leave an audit
//                              trace; they never mutate the ledger (byte-level:
//                              digest before == digest after).
//   - duplicate discipline   : the dispatch key is (leaf operation, candidate
//                              generation). A same-key second dispatch is
//                              refused (DUPLICATE_DISPATCH, A10); a replayed
//                              envelope is refused by the imported admission
//                              layer (DUPLICATE_ISSUANCE, P2_2). After a real
//                              candidate rotation the same operation is
//                              re-dispatched under a new key (full
//                              re-verification, never carry-over).
//   - concurrent advance     : real runner processes race for the run advance
//                              through an atomic claim file (the pilot mirror
//                              of Comet's .comet-state.lock); exactly one wins,
//                              the loser is refused with the winner's claim, a
//                              stale-epoch claimant is refused and must release
//                              the claim it took. The ledger keeps a single
//                              writer: the controller records the advance after
//                              reading the claim/result bytes back from disk.
//   - kill-process recovery  : a real leaf worker process is SIGKILLed in its
//                              post-observation/pre-handover window
//                              (tools/infra/monitor.mjs injection technique:
//                              kill -> confirm old writer gone). The takeover
//                              recovers the ORIGINAL operation from the
//                              authoritative disk state: completed leaves keep
//                              their exact dispatch execution and receipt
//                              digest, no leaf is reopened, the dead attempt's
//                              late receipt is refused, and the run completes
//                              under the resumed binding (attempt+1, new epoch).
//   - lost contact           : leaf subtasks may all pass individually while
//                              the integrated parent journey fails for real —
//                              the parent stays blocked (release refused) and
//                              only a genuinely new candidate with full
//                              re-verification of every leaf reaches a passing
//                              gate (A12 / F07).
//
// Leaf work is real: every leaf worker is a real child process that really
// runs `node --test` on the fixture suite and writes its observation (TAP
// included) for the controller to admit. Real logs (worker TAP, refusals,
// injections) persist in the evidence JSON.
//
// One scenario choreography per invocation:
//   0 = every expected checkpoint observed (OBSERVED)
//   1 = invalid input (unknown scenario, missing options)
//   2 = the choreography diverged from its expected checkpoints (DIVERGED)
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';

import { parseContract } from '../../../../contracts/delivery/index.js';
import { admitEvidence, envelopeDigest } from '../../../../lib/delivery/evidence.js';
import { evaluate } from '../../../../lib/delivery/gate.js';
import { classifyRunOutcome, parseTapSummary } from '../../../../lib/delivery/test-contract.js';
import { RUNNER_ID, cometLaunchAuthority, gateTestContractFixture } from '../../../../lib/adapters/comet.js';
import { HarnessError, createRunner, defineDriver } from '../../../../lib/adapters/harness.js';

const SCENARIOS = ['duplicate', 'stale', 'concurrent', 'kill-recovery', 'parent-block'];
const LEAF_SUITES = {
  L1: 'test/leaf-slugify.test.js',
  L2: 'test/leaf-render.test.js',
  'L-INT': 'test/integration.test.js',
};
const HANDOVER_TIMEOUT_MS = 300; // stale scenario: the controller declares an unresponsive handover well before the worker's 1200 ms write
const WORKER_PRE_HOLD_MS = 1200; // the delayed-write window late receipts arrive from
const APPEAR_TIMEOUT_MS = 20_000; // bound for waiting on a worker observation file

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const digestFile = (file) => sha256(fs.readFileSync(file));
const now = () => new Date().toISOString();
const short = (digest) => (typeof digest === 'string' ? `${digest.slice(0, 12)}…` : String(digest));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForFile(file, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(file)) return true;
    await sleep(20);
  }
  return fs.existsSync(file);
}

const isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

// Real leaf worker: a real child process that really runs the leaf suite
// (node --test) and writes its observation file — the receipt handover the
// controller admits from. RECOVERY_PRE_WRITE_HOLD_MS delays the write (the
// window stale/late receipts arrive from); RECOVERY_HOLD_AFTER_WRITE=1 keeps
// the process alive after the write so the controller can inject a real
// SIGKILL before any handover happened.
const WORKER_SCRIPT = `
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const [obsFile, cwd, testRel, opId, execution] = process.argv.slice(1); // node -e: argv[1] is the first script argument
const started = Date.now();
// 2026-10-27 VERIFY repair (G-T1-01): node>=24 changed the piped default
// reporter from TAP to spec, so the "# tests N" summary lines disappeared
// from the observation and classifyRunOutcome fail-closed every leaf as
// environment-failure ("unverified", 0 valid executions). Pin the reporter
// explicitly — same convention delivery-journey.mjs already applies to its
// own spawns. Oracle semantics unchanged; only the consumed format is pinned.
const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap', testRel], { cwd, encoding: 'utf8', timeout: 60000 });
const observation = {
  opId,
  execution,
  workerPid: process.pid,
  leafExitCode: run.status,
  tap: String(run.stdout ?? '') + String(run.stderr ?? ''),
  durationMs: Date.now() - started,
  observedAt: new Date().toISOString(),
};
const preHold = Number(process.env.RECOVERY_PRE_WRITE_HOLD_MS ?? '0');
setTimeout(() => {
  fs.mkdirSync(path.dirname(obsFile), { recursive: true });
  fs.writeFileSync(obsFile, JSON.stringify(observation, null, 2));
  if (process.env.RECOVERY_HOLD_AFTER_WRITE === '1') {
    const hold = setInterval(() => {}, 1000);
    setTimeout(() => { clearInterval(hold); process.exit(0); }, 30000);
  } else {
    process.exit(run.status === 0 ? 0 : 3);
  }
}, preHold);
`;

// Real advance runner: a real child process racing for the run advance through
// an atomic O_EXCL claim (the pilot mirror of the Comet state lock). The
// winner validates the epoch under its claim; a stale-epoch claimant releases
// the claim and refuses. The ledger itself stays single-writer (controller).
const ADVANCE_RUNNER_SCRIPT = `
const fs = require('node:fs');
const path = require('node:path');
const [claimFile, resultFile, outFile, ledgerFile, execution, epochArg] = process.argv.slice(1); // node -e: argv[1] is the first script argument
const epoch = Number(epochArg);
const writeOut = (payload) => {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(payload, null, 2));
};
let fd = null;
try {
  fd = fs.openSync(claimFile, 'wx');
} catch (error) {
  // The winner may still be mid-write when the EEXIST lands: poll briefly
  // for the parseable claim instead of reporting an empty existing claim.
  let existing = null;
  for (let attempt = 0; attempt < 2000 && existing === null; attempt += 1) {
    try {
      const raw = fs.readFileSync(claimFile, 'utf8');
      if (raw.trim()) existing = JSON.parse(raw);
    } catch {}
  }
  writeOut({ outcome: 'refused', code: 'CONCURRENT_ADVANCE_REFUSED', execution, epoch, existing });
  process.exit(2);
}
const claim = { execution, epoch, pid: process.pid, claimedAt: new Date().toISOString() };
fs.writeSync(fd, JSON.stringify(claim, null, 2));
fs.closeSync(fd);
let ledger = null;
try { ledger = JSON.parse(fs.readFileSync(ledgerFile, 'utf8')); } catch {}
if (!ledger || ledger.epoch !== epoch) {
  fs.unlinkSync(claimFile);
  writeOut({ outcome: 'refused', code: 'CLAIM_EPOCH_STALE', execution, epoch, ledgerEpoch: ledger ? ledger.epoch : null, claimReleased: true });
  process.exit(2);
}
if (ledger.advance) {
  fs.unlinkSync(claimFile);
  writeOut({ outcome: 'refused', code: 'ADVANCE_ALREADY_TAKEN', execution, epoch, existingAdvance: ledger.advance, claimReleased: true });
  process.exit(2);
}
const from = Number(ledger.advanceSeq ?? 0);
fs.writeFileSync(resultFile, JSON.stringify({ execution, epoch, op: 'advance-run', from, to: from + 1, advancedAt: new Date().toISOString() }, null, 2));
writeOut({ outcome: 'advanced', execution, epoch });
process.exit(0);
`;

class RecoveryChain {
  constructor({ scenario, project }) {
    this.scenario = scenario;
    this.project = project;
    this.runId = `p33-${crypto.randomBytes(6).toString('hex')}`;
    this.environment = 'pilot-recovery-local-tmpdir';
    this.toolchain = `node ${process.version}`;
    this.seq = 0;
    this.checkpoints = [];
    this.transitions = [];
    this.refusals = [];
    this.admitted = [];
    this.admittedEntries = [];
    this.workers = [];
    this.advanceRunners = {};
    this.gate = {};
    this.journeyPhases = null;
    this.advanceEvidence = null;
    this.snapshots = {};

    // PlanBundle: the controller derives its role path bounds from it.
    const planBytes = fs.readFileSync(path.join(project, 'plan-bundle.json'));
    this.planRaw = JSON.parse(planBytes);
    const parsedPlan = parseContract('SDD.Delivery.PlanBundle', this.planRaw);
    this.plan = { ok: parsedPlan.ok, errors: parsedPlan.ok ? [] : parsedPlan.errors, bundle: this.planRaw };
    this.policy = { ref: 'policy/managed-pilot-recovery', digest: sha256(planBytes) };

    this.candidateFiles = ['src/feature.js', 'src/pipeline.js'];
    this.candidateDigestBefore = this.candidateDigest();

    // Runner.Dispatch.v1: run-bound authority, the HMAC secret never leaves
    // this controller closure.
    this.authority = cometLaunchAuthority({ secret: crypto.randomBytes(32).toString('hex'), runId: this.runId });
    this.writerDriver = defineDriver({
      id: 'recovery-managed-writer',
      kind: 'managed-write',
      execute: (op) => this.managedWrite(op),
    });
    this.runner = createRunner({ authority: this.authority, driver: this.writerDriver });
    this.rolePaths = {
      builder: ['src/'],
      'test-author': ['test/'],
      whitebox: ['workers/', 'artifacts/'],
    };

    this.ledgerFile = path.join(project, 'control', 'run-state.json');
    this.controlDir = path.join(project, 'control');
  }

  // --- candidates ------------------------------------------------------------

  candidateDigest() {
    const hash = crypto.createHash('sha256');
    for (const rel of this.candidateFiles) hash.update(fs.readFileSync(path.join(this.project, rel)));
    return hash.digest('hex');
  }

  // --- ledger (single control-plane artifact; always disk read-modify-write) --

  openLedger() {
    const state = {
      schemaVersion: 1,
      runId: this.runId,
      epoch: 1,
      planDigest: this.policy.digest,
      candidateDigest: this.candidateDigestBefore,
      leaves: Object.keys(LEAF_SUITES).map((id) => ({
        id,
        status: 'pending',
        attempt: 0,
        dispatchExecution: null,
        dispatchEpoch: null,
        receiptCandidateDigest: null,
        receiptDigest: null,
      })),
      dispatchLedger: [],
      receiptDigests: [],
      issuedExecutions: [],
      evidenceExecutions: [],
      advance: null,
      advanceSeq: 0,
      history: [{ event: 'run-open', epoch: 1, at: now() }],
      updatedAt: now(),
    };
    this.saveLedgerState(state);
    this.stageLeafSuites();
    this.snapshot('initial');
    return state;
  }

  // The controller lands the staged authoring suites through the managed
  // writer (test-author role, path-bound): the leaf workers run the landed
  // bytes, never the staging sources.
  stageLeafSuites() {
    for (const suiteName of Object.values(LEAF_SUITES).map((rel) => path.basename(rel))) {
      const staged = path.join('test-sources', suiteName);
      if (!fs.existsSync(path.join(this.project, staged))) {
        throw new Error(`staged authoring suite missing: ${staged} — the fixture must stage every leaf suite`);
      }
      this.writerDriver.execute({ role: 'test-author', relPath: path.join('test', suiteName), sourcePath: staged });
    }
    this.transition({
      role: 'test-author',
      action: 'stage-suites',
      inputSummary: Object.values(LEAF_SUITES).join(', '),
      verdict: 'written',
      basis: { kind: 'authoring', note: 'leaf suites landed from staged sources through the managed writer' },
    });
  }

  loadLedger() {
    return JSON.parse(fs.readFileSync(this.ledgerFile, 'utf8'));
  }

  saveLedgerState(state) {
    state.updatedAt = now();
    const tmp = `${this.ledgerFile}.tmp`;
    fs.mkdirSync(this.controlDir, { recursive: true });
    fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
    fs.renameSync(tmp, this.ledgerFile);
  }

  mutateLedger(mutator) {
    const state = this.loadLedger();
    mutator(state);
    this.saveLedgerState(state);
    return state;
  }

  ledgerDigest() {
    return fs.existsSync(this.ledgerFile) ? digestFile(this.ledgerFile) : null;
  }

  snapshot(label) {
    this.snapshots[label] = { label, digest: this.ledgerDigest(), state: this.loadLedger() };
    return this.snapshots[label];
  }

  bumpEpoch(reason) {
    let epoch = null;
    this.mutateLedger((state) => {
      state.epoch += 1;
      epoch = state.epoch;
      state.history.push({ event: 'epoch-advance', epoch, reason, at: now() });
    });
    this.transition({
      role: 'controller',
      action: 'takeover',
      inputSummary: { reason },
      verdict: `epoch-${epoch}`,
      basis: { kind: 'epoch-advance', note: reason },
    });
    return epoch;
  }

  // --- choreography primitives -------------------------------------------------

  check(id, ok, detail) {
    this.checkpoints.push({ id, ok: ok === true, detail: String(detail ?? '') });
    return ok === true;
  }

  // A refusal is a trace, never a mutation: the ledger digest is recorded on
  // both sides of the refusal and must be identical.
  refuse(where, code, reason, extra = {}) {
    const digestBefore = this.ledgerDigest();
    const record = {
      seq: ++this.seq,
      where,
      code,
      reason: String(reason),
      ledgerDigestBefore: digestBefore,
      ledgerDigestAfter: null,
      ...extra,
    };
    record.ledgerDigestAfter = this.ledgerDigest();
    this.refusals.push(record);
    return record;
  }

  transition({ role, action, inputSummary, verdict, basis, ...extra }) {
    this.seq += 1;
    const record = {
      seq: this.seq,
      role,
      action,
      inputSummary,
      verdict,
      basis: basis ?? null,
      ...extra,
    };
    this.transitions.push(record);
    return record;
  }

  // Managed write executor (driver execute surface): writes outside the role's
  // assigned prefixes are refused.
  managedWrite({ role, relPath, sourcePath, bytes }) {
    const allowed = (this.rolePaths[role] ?? []).some((prefix) => relPath.startsWith(prefix));
    if (!allowed) {
      throw new HarnessError('ROLE_PATH_REFUSED', `role ${role} is dispatched for ${JSON.stringify(this.rolePaths[role] ?? [])} and cannot write ${relPath}`);
    }
    const abs = path.join(this.project, relPath);
    const content = bytes ?? fs.readFileSync(path.join(this.project, sourcePath));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    return { written: true, relPath, sha256: sha256(content) };
  }

  leafOf(gate) {
    const match = /^leaf:(.+)$/.exec(String(gate ?? ''));
    return match ? match[1] : null;
  }

  // Dispatch one leaf operation. The dispatch key is (leaf, candidate
  // generation): a same-key second dispatch is refused (A10); after a real
  // candidate rotation the same operation is re-dispatched (re-verification).
  // A live dispatch may only be superseded by naming its execution — the
  // controller's recovery/handover-timeout decision.
  dispatchLeaf(opId, { reason, supersedeExecution } = {}) {
    const state = this.loadLedger();
    const op = state.leaves.find((leaf) => leaf.id === opId);
    if (!op) {
      this.refuse('dispatch', 'OP_NOT_FOUND', `unknown leaf operation ${opId}`);
      return null;
    }
    if (op.status === 'done') {
      if (state.candidateDigest === (op.receiptCandidateDigest ?? state.candidateDigest)) {
        this.refuse('dispatch', 'DUPLICATE_DISPATCH', `leaf ${opId} is already done for candidate ${short(state.candidateDigest)} (attempt ${op.attempt}, receipt ${short(op.receiptDigest)}); a same-key second dispatch is refused (A10: duplicate idempotent)`);
        this.check(`duplicate-dispatch-refused-${opId}`, true, 'the same-key re-dispatch was refused');
        return null;
      }
      // Candidate rotated: the same operation re-dispatches under a new key.
    } else if (op.status === 'dispatched') {
      if (supersedeExecution !== op.dispatchExecution) {
        this.refuse('dispatch', 'DUPLICATE_DISPATCH', `leaf ${opId} already has a live dispatch (${op.dispatchExecution}, attempt ${op.attempt}); a same-key re-dispatch before a terminal receipt is refused`);
        this.check(`duplicate-dispatch-refused-${opId}`, true, 'the live-dispatch re-dispatch was refused');
        return null;
      }
      this.mutateLedger((s) => {
        s.history.push({ event: 'attempt-superseded', epoch: s.epoch, leaf: opId, execution: op.dispatchExecution, attempt: op.attempt, at: now() });
      });
    }
    const attempt = op.attempt + 1;
    const execution = `exec-${opId}-a${attempt}-${crypto.randomBytes(3).toString('hex')}`;
    const binding = {
      runnerId: RUNNER_ID,
      run: this.runId,
      gate: `leaf:${opId}`,
      inputDigest: state.candidateDigest,
      policyDigest: this.policy.digest,
      attempt,
      epoch: state.epoch,
      role: 'verifier',
      execution,
    };
    const record = this.runner.dispatch(binding);
    this.mutateLedger((s) => {
      const target = s.leaves.find((leaf) => leaf.id === opId);
      target.status = 'dispatched';
      target.attempt = attempt;
      target.dispatchExecution = execution;
      target.dispatchEpoch = s.epoch;
      s.dispatchLedger.push(record);
      s.issuedExecutions.push(execution);
      s.history.push({ event: 'dispatch', epoch: s.epoch, leaf: opId, attempt, execution, at: now() });
    });
    this.transition({
      role: 'whitebox',
      action: 'dispatch',
      inputSummary: { opId, attempt, epoch: binding.epoch, gate: binding.gate },
      verdict: 'dispatched',
      dispatch: ledgerView(record),
      basis: { kind: 'dispatch', note: reason ?? 'leaf verification dispatch' },
    });
    return record;
  }

  // Gate-layer admission: correlation id, epoch currency, attempt currency and
  // the leaf-bound execution are asserted BEFORE the imported lib admission
  // (P2_4 runtime epoch-gate semantics, asserted through the gate layer).
  admitEnvelope({ dispatch, envelope }) {
    const opId = this.leafOf(dispatch.gate);
    const state = this.loadLedger();
    const op = state.leaves.find((leaf) => leaf.id === opId);
    let envelopeDigestValue = null;
    try {
      envelopeDigestValue = envelopeDigest(envelope);
    } catch {
      envelopeDigestValue = null;
    }
    const refuseNow = (code, reason) => {
      this.refuse('admit', code, reason, { envelope, dispatch, envelopeDigest: envelopeDigestValue });
      return { ok: false, error: code, reason };
    };
    if (!op) return refuseNow('OP_NOT_FOUND', `dispatch ${dispatch.gate} names unknown leaf operation ${opId}`);
    if (envelope.caseId !== opId) {
      return refuseNow('CORRELATION_MISMATCH', `envelope caseId ${JSON.stringify(envelope.caseId)} does not correlate to the dispatched operation ${JSON.stringify(opId)} (F07: 关联 ID 核对)`);
    }
    const verified = this.authority.verifyDispatch(dispatch);
    if (!verified.ok) {
      return refuseNow(verified.error, verified.error === 'MALFORMED_DISPATCH'
        ? `dispatch record is malformed: ${verified.errors.join('; ')}`
        : 'dispatch record fails launcher integrity verification; only the trusted launcher can issue dispatches');
    }
    if (dispatch.epoch !== state.epoch) {
      return refuseNow('STALE_EPOCH', `dispatch epoch ${dispatch.epoch} is superseded; the current run epoch is ${state.epoch} (A11: 旧 epoch 回执拒绝并留痕)`);
    }
    if (dispatch.attempt !== op.attempt) {
      return refuseNow('STALE_ATTEMPT', `dispatch attempt ${dispatch.attempt} is not current; leaf ${opId} is on attempt ${op.attempt} (乱序回执拒绝)`);
    }
    if (op.dispatchExecution !== dispatch.execution) {
      return refuseNow('EXECUTION_BINDING_MISMATCH', `leaf ${opId} is bound to execution ${op.dispatchExecution}, not ${dispatch.execution}`);
    }
    const result = admitEvidence({
      envelope,
      dispatch,
      authority: this.authority,
      current: { inputDigest: state.candidateDigest, policyDigest: this.policy.digest, environment: this.environment },
      issuedExecutions: state.evidenceExecutions,
    });
    if (!result.ok) return refuseNow(result.error, result.reason);
    this.mutateLedger((s) => {
      const target = s.leaves.find((leaf) => leaf.id === opId);
      target.status = 'done';
      target.receiptCandidateDigest = s.candidateDigest;
      target.receiptDigest = result.entry.digest;
      s.evidenceExecutions.push(dispatch.execution);
      s.receiptDigests.push(result.entry.digest);
      s.history.push({ event: 'receipt', epoch: s.epoch, leaf: opId, attempt: dispatch.attempt, execution: dispatch.execution, result: envelope.result, at: now() });
    });
    this.admittedEntries.push(result.entry);
    this.admitted.push({
      seq: ++this.seq,
      opId,
      attempt: dispatch.attempt,
      epoch: dispatch.epoch,
      execution: dispatch.execution,
      role: dispatch.role,
      class: result.entry.class,
      check: envelope.check,
      result: envelope.result,
      envelopeDigest: result.entry.digest,
    });
    return { ok: true, entry: result.entry, envelope, dispatch };
  }

  // Build the envelope for a worker observation and admit it.
  admitLeaf({ dispatch, observationUri }) {
    const obsAbs = path.join(this.project, observationUri);
    const obsBytes = fs.readFileSync(obsAbs);
    const obs = JSON.parse(obsBytes.toString('utf8'));
    const run = classifyRunOutcome({ exitCode: obs.leafExitCode, output: obs.tap });
    const result = run.kind === 'pass' ? 'pass' : run.kind === 'behavior-red' ? 'red' : 'unverified';
    const summary = run.summary ?? parseTapSummary(obs.tap);
    const envelope = {
      schemaVersion: 1,
      candidateDigest: dispatch.inputDigest,
      caseId: this.leafOf(dispatch.gate),
      check: dispatch.gate,
      origin: { kind: 'registered-runner', id: RUNNER_ID },
      execution: { id: dispatch.execution },
      environment: this.environment,
      toolchain: this.toolchain,
      executions: { total: summary?.tests ?? 0, valid: (summary?.pass ?? 0) + (summary?.fail ?? 0) },
      result,
      evidence: [{ uri: observationUri, sha256: sha256(obsBytes) }],
      expiry: new Date(Date.now() + 3_600_000).toISOString(),
    };
    return this.admitEnvelope({ dispatch, envelope });
  }

  // --- leaf workers (real child processes) --------------------------------------

  workerEnv(extra = {}) {
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    return { ...env, ...extra };
  }

  observationUri(opId, execution) {
    return `workers/${opId}/observation-${execution}.json`;
  }

  // Spawn the leaf worker for an already-issued dispatch.
  spawnLeafWorker({ opId, execution, preHoldMs = 0, holdAfterWrite = false }) {
    const uri = this.observationUri(opId, execution);
    const obsAbs = path.join(this.project, uri);
    const record = {
      opId,
      execution,
      mode: holdAfterWrite ? 'hold-after-write' : preHoldMs > 0 ? 'delayed-write' : 'complete',
      preHoldMs,
      observationUri: uri,
      observationSha256: null,
      outcome: null,
      exitCode: null,
      signal: null,
      pid: null,
      injection: null,
      reason: holdAfterWrite
        ? 'held in its post-observation/pre-handover window for a real kill injection'
        : 'runs the leaf suite for real and hands the observation over',
    };
    const child = spawn(process.execPath, ['-e', WORKER_SCRIPT, obsAbs, this.project, LEAF_SUITES[opId], opId, execution], {
      cwd: this.project,
      env: this.workerEnv({
        RECOVERY_PRE_WRITE_HOLD_MS: String(preHoldMs),
        ...(holdAfterWrite ? { RECOVERY_HOLD_AFTER_WRITE: '1' } : {}),
      }),
    });
    record.pid = child.pid;
    this.workers.push(record);
    const exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
    return { child, record, exited, obsAbs };
  }

  async collectWorker({ child, record, exited, obsAbs }, { expect = 'completed' } = {}) {
    const { code, signal } = await exited;
    record.exitCode = code;
    record.signal = signal;
    record.outcome = code === 0 ? 'completed' : code === 3 ? 'leaf-failed' : code === null ? `signal-${signal ?? 'unknown'}` : `exit-${code}`;
    if (fs.existsSync(obsAbs)) record.observationSha256 = digestFile(obsAbs);
    this.check(`worker-${record.execution}`, expect === 'completed' ? record.outcome === 'completed' || record.outcome === 'leaf-failed' : true,
      `worker outcome ${record.outcome} (exit ${code}, signal ${signal ?? '-'})`);
    return record;
  }

  // Dispatch -> real worker -> admit: the happy-path leaf completion.
  async completeLeaf(opId, { reason } = {}) {
    const dispatch = this.dispatchLeaf(opId, { reason });
    if (!dispatch) return null;
    const worker = this.spawnLeafWorker({ opId, execution: dispatch.execution });
    const record = await this.collectWorker(worker);
    const admitted = this.admitLeaf({ dispatch, observationUri: record.observationUri });
    this.check(`admitted-${opId}-${dispatch.attempt}`, admitted.ok === true, admitted.ok ? `leaf ${opId} attempt ${dispatch.attempt} admitted (${admitted.envelope.result})` : `${admitted.error}: ${admitted.reason}`);
    return { dispatch, record, admitted, envelope: admitted.envelope ?? null };
  }

  // Complete a leaf for an ALREADY-ISSUED dispatch (rotation/recovery paths).
  async completeLeafFor(dispatch, { reason } = {}) {
    const opId = this.leafOf(dispatch.gate);
    const worker = this.spawnLeafWorker({ opId, execution: dispatch.execution });
    const record = await this.collectWorker(worker);
    const admitted = this.admitLeaf({ dispatch, observationUri: record.observationUri });
    this.check(`admitted-${opId}-${dispatch.attempt}`, admitted.ok === true, admitted.ok ? `leaf ${opId} attempt ${dispatch.attempt} admitted (${admitted.envelope.result})` : `${admitted.error}: ${admitted.reason}`);
    return { dispatch, record, admitted, envelope: admitted.envelope ?? null };
  }

  // --- advance race (real runner processes) ---------------------------------------

  async runAdvanceRunner({ execution, epoch, phase }) {
    const outUri = `control/runner-${execution}.json`;
    const outFile = path.join(this.project, outUri);
    const child = spawn(process.execPath, ['-e', ADVANCE_RUNNER_SCRIPT,
      path.join(this.controlDir, 'advance-claim.json'),
      path.join(this.controlDir, 'advance-result.json'),
      outFile,
      this.ledgerFile,
      execution,
      String(epoch),
    ], { cwd: this.project, env: this.workerEnv() });
    const { code, signal } = await new Promise((resolve) => child.once('exit', (c, s) => resolve({ code: c, signal: s })));
    let outcome = { outcome: 'lost' };
    if (fs.existsSync(outFile)) outcome = JSON.parse(fs.readFileSync(outFile, 'utf8'));
    this.advanceRunners[execution] = {
      execution,
      phase,
      epoch,
      exitCode: code,
      signal: signal ?? null,
      outUri,
      outcome: outcome.outcome ?? 'unknown',
      code: outcome.code ?? null,
      existing: outcome.existing ?? null,
      claimReleased: outcome.claimReleased ?? null,
    };
    return this.advanceRunners[execution];
  }

  // --- gate -----------------------------------------------------------------------

  requiredChecks(leafIds) {
    return leafIds.map((id) => ({ level: id === 'L-INT' ? 'integration' : 'unit', capability: `leaf:${id}` }));
  }

  gateEvaluate(leafIds, receipts) {
    return evaluate(
      {
        inputDigest: this.loadLedger().candidateDigest,
        testContract: gateTestContractFixture(this.requiredChecks(leafIds)),
        builderExecution: 'exec-builder-candidate',
      },
      receipts,
      this.policy,
    );
  }

  // A v1-era receipt cannot serve a rotated candidate: re-admission through
  // the imported lib against the CURRENT state is refused (imported gate
  // layer, B05 discipline).
  probeStaleCandidate({ envelope, dispatch }) {
    const state = this.loadLedger();
    const result = admitEvidence({
      envelope,
      dispatch,
      authority: this.authority,
      current: { inputDigest: state.candidateDigest, policyDigest: this.policy.digest, environment: this.environment },
      issuedExecutions: state.evidenceExecutions,
    });
    if (!result.ok) {
      this.refuse('admit-stale-probe', result.error, result.reason, { envelope, dispatch });
    }
    return result;
  }

  finish(journey) {
    const ok = this.checkpoints.length > 0 && this.checkpoints.every((checkpoint) => checkpoint.ok);
    this.snapshot('final');
    const evidence = {
      schemaVersion: 1,
      tool: 'openspec/changes/delivery-foundation-rearchitecture/pilot-recovery/run-recovery-chain.mjs',
      scenario: this.scenario,
      runId: this.runId,
      controller: { runnerId: RUNNER_ID },
      environment: this.environment,
      toolchain: this.toolchain,
      policy: this.policy,
      plan: this.plan,
      candidate: { files: this.candidateFiles, digestBefore: this.candidateDigestBefore, digestAfter: this.candidateDigest() },
      ledger: {
        file: 'control/run-state.json',
        final: this.snapshots.final,
        snapshots: this.snapshots,
      },
      transitions: this.transitions,
      dispatchLedger: this.loadLedger().dispatchLedger,
      refusals: this.refusals,
      admitted: this.admitted,
      workers: this.workers,
      advance: this.advanceEvidence,
      gate: this.gate,
      journeyPhases: this.journeyPhases,
      checkpoints: this.checkpoints,
      journey,
      verdict: ok ? 'OBSERVED' : 'DIVERGED',
      finishedAt: now(),
    };
    return { evidence, exitCode: ok ? 0 : 2 };
  }
}

function ledgerView(dispatch) {
  const { execution, role, attempt, epoch, gate, inputDigest, policyDigest, integrity } = dispatch;
  return { execution, role, attempt, epoch, gate, inputDigest, policyDigest, integrity };
}

// --- scenario choreographies ------------------------------------------------------

// duplicate (A10) — 同 key 二次派发 → 拒绝；重放回执 → DUPLICATE_ISSUANCE；
// 拒绝不改账本字节（幂等留痕）。
async function runDuplicate(chain) {
  chain.check('plan-validated', chain.plan.ok, chain.plan.errors.join('; ') || 'PlanBundle v1 validates');
  chain.openLedger();

  const r1 = await chain.completeLeaf('L1', { reason: 'leaf L1 verification (A10 duplicate baseline)' });
  chain.check('l1-done', Boolean(r1 && r1.admitted.ok), r1 ? `L1 ${r1.admitted.envelope.result}` : 'L1 dispatch refused');

  // Same-key second dispatch while L1 is done on the same candidate.
  chain.dispatchLeaf('L1', { reason: 'duplicate dispatch probe (same key)' });

  const r2 = await chain.completeLeaf('L2', { reason: 'leaf L2 verification' });
  chain.check('l2-done', Boolean(r2 && r2.admitted.ok), r2 ? `L2 ${r2.admitted.envelope.result}` : 'L2 dispatch refused');

  // Replay the exact admitted envelope through the same dispatch: the imported
  // admission layer refuses the second issuance from the same execution.
  const replay = chain.admitEnvelope({ dispatch: r2.dispatch, envelope: r2.admitted.envelope });
  chain.check('replay-refused', replay.ok === false && replay.error === 'DUPLICATE_ISSUANCE', replay.ok ? 'the replayed envelope was admitted?!' : `${replay.error}: ${replay.reason}`);

  const gate = chain.gateEvaluate(['L1', 'L2'], chain.admittedEntries);
  chain.gate.final = { verdict: gate.verdict, receipt: gate.receipt };
  chain.check('gate-pass-non-duplicate-receipts', gate.verdict === 'pass' && gate.receipt.requiredDenominator.valid === 2,
    `gate ${gate.verdict}, valid ${gate.receipt.requiredDenominator.valid}`);

  return 'duplicate-refused-idempotent';
}

// stale (A11) — 旧 epoch 回执、乱序旧 attempt 回执 → 拒绝并留痕；推进只经当前绑定。
async function runStale(chain) {
  chain.check('plan-validated', chain.plan.ok, chain.plan.errors.join('; ') || 'PlanBundle v1 validates');
  chain.openLedger();

  // L1 attempt 1 at epoch 1 — its observation is delayed (late arrival).
  const d1 = chain.dispatchLeaf('L1', { reason: 'leaf L1 attempt 1 (epoch 1)' });
  const w1 = chain.spawnLeafWorker({ opId: 'L1', execution: d1.execution, preHoldMs: WORKER_PRE_HOLD_MS });

  // Controller takeover BEFORE the receipt arrives: the epoch rotates.
  chain.bumpEpoch('supervisor-takeover: the controller seat rotates before the epoch-1 handover arrives');

  const appeared = await waitForFile(w1.obsAbs, APPEAR_TIMEOUT_MS);
  await chain.collectWorker(w1, { expect: 'late' });
  chain.check('late-observation-arrived', appeared, `late L1 observation appeared=${appeared}`);

  // The epoch-1 receipt arrives late and is refused.
  const late1 = chain.admitLeaf({ dispatch: d1, observationUri: w1.record.observationUri });
  chain.check('late-epoch-receipt-refused', late1.ok === false && late1.error === 'STALE_EPOCH', late1.ok ? 'a superseded-epoch receipt was admitted?!' : `${late1.error}: ${late1.reason}`);

  // The operation re-dispatches under the takeover epoch: the dead epoch-1
  // attempt is superseded by name.
  const d1b = chain.dispatchLeaf('L1', { reason: 'leaf L1 attempt 2 under the takeover epoch', supersedeExecution: d1.execution });
  const r1 = d1b ? await chain.completeLeafFor(d1b, { reason: 'leaf L1 attempt 2 under the takeover epoch' }) : null;
  chain.check('l1-admitted-current-epoch', Boolean(r1 && r1.admitted.ok && r1.dispatch.epoch === 2), r1 ? `L1 attempt ${r1.dispatch.attempt} epoch ${r1.dispatch.epoch}` : 'L1 re-dispatch failed');

  // L2 attempt 1: the handover times out; the controller rotates the attempt
  // (same epoch), the replacement completes, and the LATE attempt-1 receipt
  // arrives out of order afterwards and is refused.
  const d2 = chain.dispatchLeaf('L2', { reason: 'leaf L2 attempt 1' });
  const w2 = chain.spawnLeafWorker({ opId: 'L2', execution: d2.execution, preHoldMs: WORKER_PRE_HOLD_MS });
  const handedOver = await waitForFile(w2.obsAbs, HANDOVER_TIMEOUT_MS);
  if (!handedOver) {
    chain.transition({
      role: 'controller',
      action: 'handover-timeout',
      inputSummary: { opId: 'L2', execution: d2.execution, waitedMs: HANDOVER_TIMEOUT_MS },
      verdict: 'unresponsive',
      basis: { kind: 'handover-timeout', note: `no observation within ${HANDOVER_TIMEOUT_MS} ms — the controller rotates the attempt` },
    });
  }
  const d2b = chain.dispatchLeaf('L2', { reason: 'attempt rotated after handover timeout', supersedeExecution: d2.execution });
  chain.check('attempt-rotated', Boolean(d2b) && d2b.attempt === 2, d2b ? `L2 attempt ${d2b.attempt} execution ${d2b.execution}` : 'rotation refused');
  const r2 = await chain.completeLeafFor(d2b, { reason: 'leaf L2 attempt 2 after rotation' });
  chain.check('l2-admitted-after-rotation', Boolean(r2 && r2.admitted.ok), r2 ? `L2 ${r2.admitted.envelope.result}` : 'L2 completion failed');

  const late2Appeared = await waitForFile(w2.obsAbs, APPEAR_TIMEOUT_MS);
  await chain.collectWorker(w2, { expect: 'late' });
  chain.check('out-of-order-observation-arrived', late2Appeared, `late L2 attempt-1 observation appeared=${late2Appeared}`);
  const late2 = chain.admitLeaf({ dispatch: d2, observationUri: w2.record.observationUri });
  chain.check('late-attempt-receipt-refused', late2.ok === false && late2.error === 'STALE_ATTEMPT', late2.ok ? 'a superseded-attempt receipt was admitted?!' : `${late2.error}: ${late2.reason}`);

  const gate = chain.gateEvaluate(['L1', 'L2'], chain.admittedEntries);
  chain.gate.final = { verdict: gate.verdict, receipt: gate.receipt };
  chain.check('gate-pass-current-bindings-only', gate.verdict === 'pass' && gate.receipt.requiredDenominator.valid === 2,
    `gate ${gate.verdict}, valid ${gate.receipt.requiredDenominator.valid}`);

  return 'stale-refused-traced';
}

// concurrent (A12) — 并发双 runner 推进同一 run：恰一个成功；旧 epoch 领取者被拒；
// 控制面单一写者；无第二 currentPhase。
async function runConcurrent(chain) {
  chain.check('plan-validated', chain.plan.ok, chain.plan.errors.join('; ') || 'PlanBundle v1 validates');
  const state = chain.openLedger();

  // 1) A stale-epoch claimant runs first: it takes the claim, fails the epoch
  //    gate under it, releases the claim and refuses.
  const staleClaimant = await chain.runAdvanceRunner({ execution: 'r-stale-epoch', epoch: 0, phase: 'pre-race' });
  chain.check('stale-epoch-claim-refused', staleClaimant.code === 'CLAIM_EPOCH_STALE' && staleClaimant.claimReleased === true,
    `${staleClaimant.code} (ledger epoch ${state.epoch}, claimant epoch ${staleClaimant.epoch}, released=${staleClaimant.claimReleased})`);

  // 2) The real race: two real runner processes claim the same advance.
  const [race1, race2] = await Promise.all([
    chain.runAdvanceRunner({ execution: 'r-race-1', epoch: state.epoch, phase: 'race' }),
    chain.runAdvanceRunner({ execution: 'r-race-2', epoch: state.epoch, phase: 'race' }),
  ]);
  const raceRunners = [race1, race2];
  const winners = raceRunners.filter((runner) => runner.outcome === 'advanced');
  chain.check('race-exactly-one-winner', winners.length === 1,
    `race outcomes: ${raceRunners.map((runner) => `${runner.execution}=${runner.outcome}${runner.code ? `(${runner.code})` : ''}`).join(', ')}`);
  const winner = winners[0];
  const loser = raceRunners.find((runner) => runner.code === 'CONCURRENT_ADVANCE_REFUSED');
  chain.check('loser-refused-with-winner-claim', Boolean(loser) && loser.execution !== winner.execution && loser.existing?.execution === winner.execution,
    loser ? `loser ${loser.execution} observed the winner claim of ${loser.existing?.execution}` : 'no loser recorded');

  // 3) Byte readback of the race artifacts before the ledger records anything.
  const claim = JSON.parse(fs.readFileSync(path.join(chain.controlDir, 'advance-claim.json'), 'utf8'));
  const advanceResult = JSON.parse(fs.readFileSync(path.join(chain.controlDir, 'advance-result.json'), 'utf8'));
  chain.check('claim-and-result-consistent', claim.execution === winner.execution && advanceResult.execution === winner.execution
    && advanceResult.from === 0 && advanceResult.to === 1,
    `claim ${claim.execution} @epoch ${claim.epoch}; result ${advanceResult.execution} ${advanceResult.from}->${advanceResult.to}`);

  // 4) Single-writer control plane: the controller records the advance it read
  //    back from disk; the runner processes never touch the ledger.
  chain.mutateLedger((s) => {
    s.advance = { execution: claim.execution, epoch: claim.epoch, claimedAt: claim.claimedAt };
    s.advanceSeq = advanceResult.to;
    s.history.push({ event: 'advance-claimed', epoch: s.epoch, execution: claim.execution, at: now() });
  });
  chain.check('advance-recorded-once', chain.loadLedger().advanceSeq === 1, `advanceSeq ${chain.loadLedger().advanceSeq}`);

  // 5) A post-advance second claim is refused — the advance is single-owner.
  const duplicateClaimant = await chain.runAdvanceRunner({ execution: 'r-duplicate', epoch: state.epoch, phase: 'post-advance' });
  chain.check('post-advance-claim-refused', duplicateClaimant.code === 'CONCURRENT_ADVANCE_REFUSED',
    `${duplicateClaimant.code} (existing claim owner ${duplicateClaimant.existing?.execution})`);

  // 6) No second currentPhase: an advance binding carrying a phase field is
  //    refused by the runner surface.
  try {
    chain.runner.dispatch({
      runnerId: RUNNER_ID, run: chain.runId, gate: 'advance', inputDigest: chain.loadLedger().candidateDigest,
      policyDigest: chain.policy.digest, attempt: 1, epoch: state.epoch, role: 'verifier', execution: 'exec-phase-probe',
      phase: 'advance',
    });
    chain.check('phase-field-refused', false, 'the runner accepted an advance binding with a phase field');
  } catch (error) {
    chain.refuse('runner-dispatch', error.code ?? 'ERROR', error.message);
    chain.check('phase-field-refused', error.code === 'RUNNER_PHASE_FIELD_REFUSED', error.message);
  }

  chain.advanceEvidence = {
    winnerExecution: winner.execution,
    claim: { uri: 'control/advance-claim.json', execution: claim.execution, epoch: claim.epoch, pid: claim.pid, claimedAt: claim.claimedAt },
    result: { uri: 'control/advance-result.json', execution: advanceResult.execution, from: advanceResult.from, to: advanceResult.to },
    runners: chain.advanceRunners,
  };
  return 'single-advance-winner';
}

// kill-recovery (F07/A11) — 真实 SIGKILL 注入；从权威磁盘状态恢复原 operation，
// 不重开叶子任务；死亡 attempt 的迟到回执被拒。
async function runKillRecovery(chain) {
  chain.check('plan-validated', chain.plan.ok, chain.plan.errors.join('; ') || 'PlanBundle v1 validates');
  chain.openLedger();

  // L1 completes normally at epoch 1.
  const r1 = await chain.completeLeaf('L1', { reason: 'leaf L1 completes before the interruption' });
  chain.check('l1-done-before-interruption', Boolean(r1 && r1.admitted.ok), r1 ? `L1 ${r1.admitted.envelope.result}` : 'L1 failed');
  const l1Before = chain.loadLedger().leaves.find((leaf) => leaf.id === 'L1');

  // L2 is dispatched; its worker writes the observation and HOLDS — the
  // receipt handover never completes. Real SIGKILL injection in that window.
  const d2 = chain.dispatchLeaf('L2', { reason: 'leaf L2 attempt 1 (will be interrupted mid-handover)' });
  const w2 = chain.spawnLeafWorker({ opId: 'L2', execution: d2.execution, holdAfterWrite: true });
  const appeared = await waitForFile(w2.obsAbs, APPEAR_TIMEOUT_MS);
  chain.check('interrupted-observation-written', appeared, `the killed worker wrote its observation before the kill: ${appeared}`);
  w2.child.kill('SIGKILL');
  const { code, signal } = await w2.exited;
  const gone = !isAlive(w2.child.pid);
  w2.record.outcome = 'killed';
  w2.record.exitCode = code;
  w2.record.signal = signal;
  w2.record.observationSha256 = digestFile(w2.obsAbs);
  w2.record.reason = 'SIGKILLed in the held post-observation window — receipt handover never completed';
  w2.record.injection = { method: 'SIGKILL', signal: 'SIGKILL', confirmedGone: gone, killedAt: now() };
  chain.check('old-writer-confirmed-gone', gone === true, `worker ${w2.record.pid} SIGKILLed (exit ${code}, signal ${signal}); old writer gone=${gone}`);
  chain.transition({
    role: 'controller',
    action: 'process-interrupted',
    inputSummary: { opId: 'L2', execution: d2.execution, pid: w2.record.pid },
    verdict: 'killed',
    basis: { kind: 'sigkill-injection', note: 'real SIGKILL mid-handover; the observation is on disk, the receipt was never admitted' },
  });

  // Takeover: snapshot, bump the epoch, snapshot.
  chain.snapshot('beforeRecovery');
  chain.bumpEpoch('recovery-takeover: the previous controller execution died mid-handover');
  chain.snapshot('afterRecovery');

  // The dead attempt's late receipt is refused (its epoch is superseded).
  const late = chain.admitLeaf({ dispatch: d2, observationUri: w2.record.observationUri });
  chain.check('dead-attempt-receipt-refused', late.ok === false && late.error === 'STALE_EPOCH', late.ok ? 'the dead attempt receipt was admitted?!' : `${late.error}: ${late.reason}`);

  // Resume the ORIGINAL operation: same leaf id, attempt 2, new epoch binding.
  const d2b = chain.dispatchLeaf('L2', { reason: 'recovery: resume the original operation (attempt 2)', supersedeExecution: d2.execution });
  chain.check('original-operation-resumed', Boolean(d2b) && d2b.attempt === 2 && d2b.epoch === 2, d2b ? `L2 resumed as ${d2b.execution}` : 'resume refused');
  const r2 = await chain.completeLeafFor(d2b, { reason: 'leaf L2 completes under the recovery epoch' });
  chain.check('resumed-operation-admitted', Boolean(r2 && r2.admitted.ok), r2 ? `L2 ${r2.admitted.envelope.result}` : 'resumed completion failed');

  // No leaf reopened, done leaf preserved byte-for-byte.
  const after = chain.loadLedger();
  const l1After = after.leaves.find((leaf) => leaf.id === 'L1');
  chain.check('leaf-set-unchanged', JSON.stringify(after.leaves.map((leaf) => leaf.id)) === JSON.stringify(chain.snapshots.beforeRecovery.state.leaves.map((leaf) => leaf.id)),
    `leaves on disk: ${after.leaves.map((leaf) => leaf.id).join(',')} — identical to the pre-recovery plan set, nothing reopened or added`);
  chain.check('done-leaf-preserved', JSON.stringify(l1After) === JSON.stringify(l1Before),
    `L1 dispatch ${l1After.dispatchExecution} and receipt ${short(l1After.receiptDigest)} identical across recovery`);

  const gate = chain.gateEvaluate(['L1', 'L2'], chain.admittedEntries);
  chain.gate.final = { verdict: gate.verdict, receipt: gate.receipt };
  chain.check('gate-pass-after-recovery', gate.verdict === 'pass', `gate ${gate.verdict}: ${gate.receipt.blocked.join(' | ') || 'no blocked reasons'}`);

  return 'resumed-original-operation';
}

// parent-block (A12/F07 失联) — 叶子各自通过、集成后父 Journey 真实失败；
// 父任务阻断不放行；新候选全量重验后才通过。
async function runParentBlock(chain) {
  chain.check('plan-validated', chain.plan.ok, chain.plan.errors.join('; ') || 'PlanBundle v1 validates');
  chain.openLedger();

  // The leaves pass individually on candidate v1 (defective pipeline).
  const r1 = await chain.completeLeaf('L1', { reason: 'leaf L1 on candidate v1' });
  const r2 = await chain.completeLeaf('L2', { reason: 'leaf L2 on candidate v1' });
  chain.check('leaves-passed-individually', Boolean(r1 && r1.admitted.ok && r1.admitted.envelope.result === 'pass')
    && Boolean(r2 && r2.admitted.ok && r2.admitted.envelope.result === 'pass'), 'both leaf receipts pass independently');

  // Correlation discipline: a receipt naming the wrong operation is refused.
  const mismatch = chain.admitEnvelope({ dispatch: r2.dispatch, envelope: { ...r2.admitted.envelope, caseId: 'L1' } });
  chain.check('correlation-mismatch-refused', mismatch.ok === false && mismatch.error === 'CORRELATION_MISMATCH', mismatch.ok ? 'a mis-correlated envelope was admitted?!' : `${mismatch.error}: ${mismatch.reason}`);

  // The integrated parent journey fails for real.
  const dInt = chain.dispatchLeaf('L-INT', { reason: 'parent journey verification on candidate v1' });
  const wInt = chain.spawnLeafWorker({ opId: 'L-INT', execution: dInt.execution });
  const intRecord = await chain.collectWorker(wInt, { expect: 'any' });
  const intAdmitted = chain.admitLeaf({ dispatch: dInt, observationUri: intRecord.observationUri });
  chain.check('parent-red-observed', Boolean(intAdmitted.ok && intAdmitted.envelope.result === 'red'),
    intAdmitted.ok ? `parent observation ${intAdmitted.envelope.result} (real integration RED)` : `${intAdmitted.error}: ${intAdmitted.reason}`);

  // The parent gate is blocked although the leaves passed; a release attempt
  // is refused — children do not release a failed parent.
  const blockedGate = chain.gateEvaluate(['L1', 'L2', 'L-INT'], chain.admittedEntries);
  chain.gate.blockedPhase = { verdict: blockedGate.verdict, receipt: blockedGate.receipt };
  chain.check('parent-gate-blocked', blockedGate.verdict === 'blocked'
    && blockedGate.receipt.blocked.some((line) => /UNVERIFIED_CAPABILITY: leaf:L-INT/.test(line)),
    `blocked-phase gate ${blockedGate.verdict}: ${blockedGate.receipt.blocked.join(' | ')}`);
  chain.journeyPhases = {
    blocked: { parentResult: 'red', leavesPassed: ['L1', 'L2'], at: now() },
  };
  chain.refuse('journey', 'RELEASE_REFUSED', 'the parent journey failed on the integrated observation (red); individually passed leaf receipts do not release the parent (A12/F07 失联调和)');

  // The builder rotates the candidate through the managed writer (path-bound).
  const write = chain.writerDriver.execute({ role: 'builder', relPath: 'src/pipeline.js', sourcePath: 'variants/pipeline-correct.js' });
  chain.transition({
    role: 'builder',
    action: 'write',
    inputSummary: `write src/pipeline.js from variants/pipeline-correct.js (sha256 ${write.sha256})`,
    verdict: 'written',
    basis: { kind: 'candidate', note: 'the builder produces a genuinely new candidate; the candidate digest rotates' },
  });
  const newDigest = chain.candidateDigest();
  chain.check('candidate-rotated', newDigest !== chain.candidateDigestBefore, `candidate ${short(chain.candidateDigestBefore)} -> ${short(newDigest)}`);
  chain.mutateLedger((s) => {
    s.candidateDigest = newDigest;
    s.history.push({ event: 'candidate-rotation', epoch: s.epoch, digest: newDigest, at: now() });
  });

  // The v1 receipt cannot serve the new candidate (gate-layer probe).
  const stale = chain.probeStaleCandidate({ envelope: r1.admitted.envelope, dispatch: r1.dispatch });
  chain.check('v1-receipt-stale-on-new-candidate', stale.ok === false && stale.error === 'STALE_CANDIDATE', stale.ok ? 'a v1 receipt was admitted on the new candidate?!' : `${stale.error}: ${stale.reason}`);

  // Full re-verification: every leaf re-dispatches on the new candidate.
  for (const opId of ['L1', 'L2', 'L-INT']) {
    const done = await chain.completeLeaf(opId, { reason: `re-verify ${opId} on the new candidate` });
    chain.check(`reverified-${opId}`, Boolean(done && done.admitted.ok && done.dispatch.epoch === chain.loadLedger().epoch && done.dispatch.attempt === 2),
      done ? `${opId} attempt ${done.dispatch.attempt} ${done.admitted.envelope.result}` : `${opId} re-verification failed`);
  }

  // Stale receipts cannot satisfy the gate either (all-receipts probe).
  const allReceiptsGate = chain.gateEvaluate(['L1', 'L2', 'L-INT'], chain.admittedEntries);
  chain.gate.staleProbe = { verdict: allReceiptsGate.verdict, blocked: allReceiptsGate.receipt.blocked };

  // The final gate consumes only the current-candidate receipts.
  const currentEntries = chain.admittedEntries.filter((entry) => entry.dispatch.inputDigest === chain.loadLedger().candidateDigest);
  const gate = chain.gateEvaluate(['L1', 'L2', 'L-INT'], currentEntries);
  chain.gate.final = { verdict: gate.verdict, receipt: gate.receipt };
  chain.check('gate-pass-new-candidate', gate.verdict === 'pass' && gate.receipt.inputDigest === newDigest && gate.receipt.requiredDenominator.valid === 3,
    `gate ${gate.verdict}, valid ${gate.receipt.requiredDenominator.valid}, bound ${short(gate.receipt.inputDigest)}`);

  return 're-accepted-on-new-candidate';
}


const CHOREOGRAPHIES = {
  duplicate: runDuplicate,
  stale: runStale,
  concurrent: runConcurrent,
  'kill-recovery': runKillRecovery,
  'parent-block': runParentBlock,
};

function usage() {
  return [
    'Usage: node run-recovery-chain.mjs --scenario <duplicate|stale|concurrent|kill-recovery|parent-block>',
    '       --project <fixture project dir> --evidence <evidence.json> [--json]',
    '',
    'Exit codes: 0=choreography observed, 1=invalid input, 2=diverged.',
  ].join('\n');
}

async function main() {
  let options;
  try {
    options = parseArgs({
      strict: true,
      options: {
        scenario: { type: 'string' },
        project: { type: 'string' },
        evidence: { type: 'string' },
        json: { type: 'boolean', default: false },
      },
    }).values;
  } catch (error) {
    console.error(JSON.stringify({ error: 'INVALID_INPUT', message: String(error?.message ?? error) }, null, 2));
    console.error(usage());
    return 1;
  }
  if (!options.scenario || !options.project || !options.evidence) {
    console.error(JSON.stringify({ error: 'INVALID_INPUT', message: '--scenario, --project and --evidence are required' }, null, 2));
    console.error(usage());
    return 1;
  }
  if (!SCENARIOS.includes(options.scenario)) {
    console.error(JSON.stringify({ error: 'UNKNOWN_SCENARIO', message: `unknown scenario ${JSON.stringify(options.scenario)} — registered scenarios: ${SCENARIOS.join(', ')}` }, null, 2));
    console.error(usage());
    return 1;
  }
  if (!fs.existsSync(options.project) || !fs.statSync(options.project).isDirectory()) {
    console.error(JSON.stringify({ error: 'INVALID_INPUT', message: `--project is not a directory: ${options.project}` }, null, 2));
    return 1;
  }

  const chain = new RecoveryChain({ scenario: options.scenario, project: path.resolve(options.project) });
  let journey = null;
  try {
    journey = await CHOREOGRAPHIES[options.scenario](chain);
  } catch (error) {
    chain.checkpoints.push({ id: 'choreography-error', ok: false, detail: String(error?.stack ?? error) });
  }

  const { evidence, exitCode } = chain.finish(journey ?? 'incomplete');
  fs.mkdirSync(path.dirname(path.resolve(options.evidence)), { recursive: true });
  const tmp = `${options.evidence}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(evidence, null, 2)}\n`);
  fs.renameSync(tmp, options.evidence);
  if (options.json) console.log(JSON.stringify(evidence, null, 2));
  else console.log(`recovery-chain ${options.scenario}: ${evidence.verdict} (${evidence.journey}) exit=${exitCode}`);
  return exitCode;
}

main().then((code) => process.exit(code)).catch((error) => {
  console.error(JSON.stringify({ error: 'EXECUTOR_FAILURE', message: String(error?.stack ?? error) }, null, 2));
  process.exit(2);
});

// P3_3 delivery case: duplicate/out-of-order receipts, stale attempt/epoch,
// concurrent advance, kill-process recovery and lost-contact reconciliation —
// on the SAME role chain as P3_2 (pilot-recovery executor builds on the
// accepted P1_3/P2_2/P2_4/P3_2 infrastructure, imported unmodified).
//
// Coverage (spec.md is the single semantic source; every case below runs the
// real recovery-chain executor as a subprocess with an isolated HOME/PATH/
// TMPDIR and verifies the persisted ledger and byte-level oracles from disk):
//   V_A10  duplicate receipts: a same-key second dispatch is refused
//          (DUPLICATE_DISPATCH) and a replayed envelope is refused by the
//          imported admission layer (DUPLICATE_ISSUANCE); refusals leave the
//          control ledger byte-identical (idempotent) and leave a trace.
//   V_A11  stale/out-of-order receipts: a receipt from an epoch that was
//          superseded by a controller takeover is refused (STALE_EPOCH) and a
//          late attempt-1 receipt arriving after attempt 2 was admitted is
//          refused (STALE_ATTEMPT); both keep the audit trace and the run
//          still completes only through the current bindings.
//   V_A12  concurrent advance: two real runner processes race to advance the
//          same run through an atomic claim — exactly one wins, the loser is
//          refused (CONCURRENT_ADVANCE_REFUSED), a stale-epoch claimant is
//          refused (CLAIM_EPOCH_STALE) and the control plane keeps a single
//          writer (no phase field survives a runner dispatch).
//   V_F07  kill-process recovery: a real leaf worker is SIGKILLed mid-handover
//          (monitor.mjs injection technique); the takeover recovers the
//          ORIGINAL operation from the authoritative disk state — completed
//          leaves keep their exact dispatch execution and receipt digest, no
//          leaf task is reopened, the dead attempt's late receipt is refused
//          and the run completes under the resumed binding.
//   V_A12b lost-contact reconciliation (spec A12): leaf subtasks pass
//          individually but the integrated parent journey fails for real —
//          the parent stays blocked (release refused), and only a genuinely
//          new candidate with full re-verification of every leaf on the new
//          candidate digest reaches a passing gate.
//   V_RW_REAL_COMET_RECOVERY (rework construction slice, recipe
//          pilot-recovery/real-comet-recovery.case.json): the REAL managed
//          Comet CLI (repo lock fingerprint d4370930) — real SIGKILL inside
//          the classic state transaction's pre-commit and post-commit
//          windows with the engine's own journal/lock recovery (roll-back /
//          roll-forward), same-operation dispatch recovery without duplicate
//          dispatch, old-attempt replay refusals, lock-layer old-writer
//          fencing (live pid refuses, dead pid auto-recovers), and Run /
//          journal / approval basis / continuation readback. The live
//          Outline unknown-result window and external monitoring/backup
//          qualification are NOT here: they stay execution_owner=VERIFY
//          (same-run-delivery.journey.json step 9).
//
// Fixtures are generated under os.tmpdir(); no live configuration or
// change-control file is written by this suite. Zero new npm dependencies.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { admitEvidence } from '../../lib/delivery/evidence.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const recoveryCli = path.join(projectRoot, 'openspec/changes/delivery-foundation-rearchitecture/pilot-recovery/run-recovery-chain.mjs');
const RUN_TIMEOUT_MS = 180_000;
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const digestFile = (file) => sha256(fs.readFileSync(file));
const escapeRegExp = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Isolated child environment: the chain must not depend on the caller's
// HOME/PATH and nested `node --test` children must really run (repo
// convention: strip NODE_TEST_CONTEXT).
function isolatedEnv(tmpHome, tmpTmp) {
  const env = { ...process.env, HOME: tmpHome, PATH: '/usr/bin:/bin', TMPDIR: tmpTmp };
  delete env.NODE_TEST_CONTEXT;
  return env;
}

function makeWorkdir(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `sdd-p33-${label}-`));
  fs.mkdirSync(path.join(root, 'home'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tmp'), { recursive: true });
  return root;
}

// --- fixture project (the suite is the fixture author; the chain only
// consumes it) -----------------------------------------------------------------

const VARIANTS = {
  'feature-correct.js': [
    "export function slugify(input) {",
    "  return String(input).trim().toLowerCase().replace(/\\s+/g, '-');",
    "}",
    '',
    "export function renderSlug(input) {",
    "  return `slug:${slugify(input)}`;",
    "}",
    '',
  ].join('\n'),
  // Parent-journey defect: the composition is broken while both units are
  // individually correct — leaf suites pass, the integration suite is RED.
  'pipeline-defective.js': [
    "import { renderSlug } from './feature.js';",
    '',
    "export function pipeline(input) {",
    "  return renderSlug(input).toUpperCase();",
    "}",
    '',
  ].join('\n'),
  'pipeline-correct.js': [
    "import { slugify, renderSlug } from './feature.js';",
    '',
    "export function pipeline(input) {",
    "  return renderSlug(slugify(input));",
    "}",
    '',
  ].join('\n'),
};

const SUITES = {
  'leaf-slugify.test.js': [
    "import assert from 'node:assert/strict';",
    "import test from 'node:test';",
    "import { slugify } from '../src/feature.js';",
    '',
    "test('leaf L1: slugify lowercases and dashes', () => {",
    "  assert.equal(slugify('Hello World'), 'hello-world');",
    "});",
    '',
  ].join('\n'),
  'leaf-render.test.js': [
    "import assert from 'node:assert/strict';",
    "import test from 'node:test';",
    "import { renderSlug } from '../src/feature.js';",
    '',
    "test('leaf L2: rendered slug is wrapped', () => {",
    "  assert.equal(renderSlug('Hello World'), 'slug:hello-world');",
    "});",
    '',
  ].join('\n'),
  'integration.test.js': [
    "import assert from 'node:assert/strict';",
    "import test from 'node:test';",
    "import { pipeline } from '../src/pipeline.js';",
    '',
    "test('parent journey: integrated pipeline keeps the slug contract', () => {",
    "  assert.equal(pipeline('Hello World'), 'slug:hello-world');",
    "});",
    '',
  ].join('\n'),
};

function makeProject(label, { pipeline = 'pipeline-defective.js' } = {}) {
  const project = path.join(makeWorkdir(label), 'project');
  fs.mkdirSync(path.join(project, 'variants'), { recursive: true });
  fs.mkdirSync(path.join(project, 'test-sources'), { recursive: true });
  fs.mkdirSync(path.join(project, 'src'), { recursive: true });
  fs.writeFileSync(path.join(project, 'package.json'), `${JSON.stringify({ type: 'module' }, null, 2)}\n`);
  for (const [name, body] of Object.entries(VARIANTS)) {
    fs.writeFileSync(path.join(project, 'variants', name), body);
  }
  for (const [name, body] of Object.entries(SUITES)) {
    fs.writeFileSync(path.join(project, 'test-sources', name), body);
  }
  fs.writeFileSync(path.join(project, 'src', 'feature.js'), VARIANTS['feature-correct.js']);
  fs.writeFileSync(path.join(project, 'src', 'pipeline.js'), VARIANTS[pipeline]);
  fs.writeFileSync(path.join(project, 'plan-bundle.json'), `${JSON.stringify({
    schemaVersion: 1,
    change: 'pilot-recovery-fixture',
    schedulerOwner: 'comet-classic',
    tasks: [
      { id: 'L1', dependsOn: [] },
      { id: 'L2', dependsOn: [] },
      { id: 'L-INT', dependsOn: ['L1', 'L2'] },
    ],
    allowedPaths: ['src/', 'test/', 'workers/', 'artifacts/'],
    worktree: 'worktree/impl-p3-3 (fixture mirror; recovery chain confined to assigned path prefixes)',
    acceptanceRefs: ['A10', 'A11', 'A12', 'F07'],
  }, null, 2)}\n`);
  return project;
}

// --- recovery runner + independent readback helpers -----------------------------

function runRecovery(scenario, project) {
  const workdir = path.dirname(project);
  const evidenceFile = path.join(workdir, 'recovery-evidence.json');
  const run = spawnSync(process.execPath, [
    recoveryCli, '--scenario', scenario, '--project', project, '--evidence', evidenceFile, '--json',
  ], {
    cwd: projectRoot,
    encoding: 'utf8',
    timeout: RUN_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
    env: isolatedEnv(path.join(workdir, 'home'), path.join(workdir, 'tmp')),
  });
  let evidence = null;
  if (fs.existsSync(evidenceFile)) {
    evidence = JSON.parse(fs.readFileSync(evidenceFile, 'utf8'));
  }
  return { run, evidence, evidenceFile };
}

function assertObserved(result, label) {
  assert.equal(result.run.status, 0, `${label}: the recovery run must exit 0, got ${result.run.status}\nstderr: ${result.run.stderr}\nstdout: ${result.run.stdout}`);
  assert.ok(result.evidence, `${label}: persisted recovery evidence must exist`);
  assert.equal(result.evidence.verdict, 'OBSERVED', `${label}: every expected checkpoint must be observed: ${JSON.stringify(result.evidence.checkpoints ?? [])}`);
  return result.evidence;
}

function refusalCodes(evidence) {
  return (evidence.refusals ?? []).map((refusal) => refusal.code);
}

function refusalByCode(evidence, code) {
  return (evidence.refusals ?? []).filter((refusal) => refusal.code === code);
}

function readDiskLedger(project) {
  return JSON.parse(fs.readFileSync(path.join(project, 'control', 'run-state.json'), 'utf8'));
}

// The suite runs the fixture's own suites itself — an independent real
// execution that does not trust the chain's claims.
function runFixtureTest(project, testFile, cwd = project) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, ['--test', path.join('test', testFile)], {
    cwd, encoding: 'utf8', timeout: 60_000, env,
  });
}

// The executed toolchain and the current candidate digest must be recorded
// (verification-case-plan oracle tail: 记录当前候选和环境).
function assertCandidateAndEnvironmentRecorded(evidence) {
  assert.match(evidence.toolchain, new RegExp(`node ${escapeRegExp(process.version)}`), 'the executed toolchain must be recorded');
  assert.match(evidence.candidate.digestAfter, /^[a-f0-9]{64}$/, 'the current candidate digest must be recorded');
  assert.equal(evidence.environment.length > 0, true, 'the execution environment must be recorded');
}

// The persisted control ledger on disk must be exactly the snapshot the
// evidence claims — byte-level readback, never in-memory trust.
function assertFinalLedgerOnDisk(project, evidence) {
  const ledgerFile = path.join(project, 'control', 'run-state.json');
  const diskState = readDiskLedger(project);
  assert.equal(evidence.ledger.final.digest, digestFile(ledgerFile), 'the evidence final ledger digest must equal the disk bytes');
  assert.deepEqual(diskState, evidence.ledger.final.state, 'the disk ledger must equal the evidence final snapshot');
  return diskState;
}

// --- V_A10 ---------------------------------------------------------------------

test('V_A10: a same-key second dispatch is refused, a replayed receipt is refused by the admission layer, and refusals leave the ledger byte-identical', () => {
  const project = makeProject('a10-duplicate');
  const result = runRecovery('duplicate', project);
  const evidence = assertObserved(result, 'V_A10');

  assert.equal(evidence.scenario, 'duplicate');
  assert.equal(evidence.journey, 'duplicate-refused-idempotent');
  assertCandidateAndEnvironmentRecorded(evidence);

  // Same-key second dispatch refused with a trace.
  const duplicateDispatch = refusalByCode(evidence, 'DUPLICATE_DISPATCH');
  assert.equal(duplicateDispatch.length, 1, `exactly one duplicate-dispatch refusal: ${refusalCodes(evidence).join(',')}`);
  assert.match(duplicateDispatch[0].reason, /L1/);

  // Replayed envelope refused by the imported admission layer (P2_2 semantics).
  const duplicateIssuance = refusalByCode(evidence, 'DUPLICATE_ISSUANCE');
  assert.equal(duplicateIssuance.length, 1, `exactly one duplicate-issuance refusal: ${refusalCodes(evidence).join(',')}`);
  assert.ok(duplicateIssuance[0].envelope, 'the refusal must carry the replayed envelope for re-derivation');
  assert.ok(duplicateIssuance[0].dispatch, 'the refusal must carry the dispatch binding for re-derivation');

  // Refusals left the control ledger byte-identical (idempotent duplicates).
  for (const refusal of evidence.refusals) {
    assert.equal(refusal.ledgerDigestBefore, refusal.ledgerDigestAfter, `refusal ${refusal.code} must not mutate the ledger`);
  }

  // Byte-level disk readback: L1 keeps exactly one dispatch and one receipt.
  const ledger = assertFinalLedgerOnDisk(project, evidence);
  assert.equal(ledger.epoch, 1, 'no takeover happened in the duplicate scenario');
  const l1 = ledger.leaves.find((leaf) => leaf.id === 'L1');
  assert.equal(l1.status, 'done');
  assert.equal(l1.attempt, 1, 'L1 stays on its first attempt — the duplicate never landed');
  assert.equal(ledger.dispatchLedger.length, 2, 'exactly two dispatches exist (L1 + L2)');
  assert.equal(new Set(ledger.issuedExecutions).size, ledger.issuedExecutions.length, 'issued executions are unique');
  assert.equal(ledger.receiptDigests.length, 2, 'exactly two receipts are counted');

  // Structural gate-layer assertion: the recorded replay envelope fails
  // admission outside the executor too (no authority is available to the
  // suite — the honest first refusal is UNREGISTERED_SOURCE; the live
  // DUPLICATE_ISSUANCE trace above was produced through the real authority).
  const duplicateIssuanceRefusal = refusalByCode(evidence, 'DUPLICATE_ISSUANCE')[0];
  const replay = admitEvidence({
    envelope: duplicateIssuanceRefusal.envelope,
    dispatch: duplicateIssuanceRefusal.dispatch,
    authority: undefined,
    current: {
      inputDigest: evidence.candidate.digestAfter,
      policyDigest: evidence.policy.digest,
      environment: evidence.environment,
    },
    issuedExecutions: ledger.issuedExecutions,
  });
  assert.equal(replay.ok, false, 'the replayed envelope must not be admitted');
  assert.equal(replay.error, 'UNREGISTERED_SOURCE', 'without the launcher authority no suite-side replay can be admitted (A05)');

  // Independent fixture behavior: both leaf suites really pass on this fixture.
  for (const suite of ['leaf-slugify.test.js', 'leaf-render.test.js']) {
    const independent = runFixtureTest(project, suite);
    assert.equal(independent.status, 0, `fixture precondition: ${suite} passes (got exit ${independent.status})`);
  }

  assert.equal(evidence.gate.final.verdict, 'pass', 'the gate passes on the two non-duplicate receipts');
  assert.equal(evidence.gate.final.receipt.requiredDenominator.valid, 2);
});

// --- V_A11 ---------------------------------------------------------------------

test('V_A11: a receipt from a superseded epoch is refused (STALE_EPOCH) and a late attempt-1 receipt after attempt 2 was admitted is refused (STALE_ATTEMPT), both traced', () => {
  const project = makeProject('a11-stale');
  const result = runRecovery('stale', project);
  const evidence = assertObserved(result, 'V_A11');

  assert.equal(evidence.scenario, 'stale');
  assert.equal(evidence.journey, 'stale-refused-traced');
  assertCandidateAndEnvironmentRecorded(evidence);

  const staleEpoch = refusalByCode(evidence, 'STALE_EPOCH');
  const staleAttempt = refusalByCode(evidence, 'STALE_ATTEMPT');
  assert.equal(staleEpoch.length, 1, `exactly one stale-epoch refusal: ${refusalCodes(evidence).join(',')}`);
  assert.equal(staleAttempt.length, 1, `exactly one stale-attempt refusal: ${refusalCodes(evidence).join(',')}`);
  assert.match(staleEpoch[0].reason, /epoch/, 'the stale-epoch refusal names the epoch mismatch');
  assert.match(staleAttempt[0].reason, /attempt/, 'the stale-attempt refusal names the attempt mismatch');
  for (const refusal of [...staleEpoch, ...staleAttempt]) {
    assert.equal(refusal.ledgerDigestBefore, refusal.ledgerDigestAfter, `refusal ${refusal.code} must not mutate the ledger`);
    assert.ok(refusal.dispatch, 'the stale refusal carries the refused dispatch binding (留痕)');
  }

  // The takeover is recorded in the persisted ledger history.
  const ledger = assertFinalLedgerOnDisk(project, evidence);
  assert.equal(ledger.epoch, 2, 'the takeover bumped the epoch to 2');
  const epochEvents = ledger.history.filter((event) => event.event === 'epoch-advance');
  assert.equal(epochEvents.length, 1, 'exactly one epoch-advance event');
  assert.match(epochEvents[0].reason, /takeover/i);

  // Out-of-order proof: the attempt-2 receipt was admitted BEFORE the late
  // attempt-1 receipt was refused (sequence numbers).
  const l2Admission = (evidence.admitted ?? []).find((entry) => entry.opId === 'L2' && entry.attempt === 2);
  assert.ok(l2Admission, 'the current-attempt L2 receipt was admitted');
  assert.ok(l2Admission.seq < staleAttempt[0].seq, 'the late attempt-1 receipt arrives after the attempt-2 admission (out of order)');

  // The late observations exist on disk and the refusals pin their bytes.
  for (const refusal of [...staleEpoch, ...staleAttempt]) {
    const obsFile = path.join(project, refusal.envelope.evidence[0].uri);
    assert.equal(fs.existsSync(obsFile), true, `late observation ${refusal.envelope.evidence[0].uri} exists on disk`);
    assert.equal(refusal.envelope.evidence[0].sha256, digestFile(obsFile), 'the refused envelope pins the real late-observation bytes');
  }

  // The run completes only through current bindings (the leaves this
  // choreography exercised; the remaining plan leaves stay untouched).
  for (const leafId of ['L1', 'L2']) {
    const leaf = ledger.leaves.find((entry) => entry.id === leafId);
    assert.equal(leaf.status, 'done');
    assert.equal(leaf.dispatchEpoch, 2, `leaf ${leafId} was completed under the current epoch`);
  }
  assert.equal(evidence.gate.final.verdict, 'pass', 'the gate passes on the current-epoch receipts only');
});

// --- V_A12 ---------------------------------------------------------------------

test('V_A12: two real runner processes race to advance the same run — exactly one wins, the loser and a stale-epoch claimant are refused, the control plane keeps one writer', () => {
  const project = makeProject('a12-concurrent');
  const result = runRecovery('concurrent', project);
  const evidence = assertObserved(result, 'V_A12');

  assert.equal(evidence.scenario, 'concurrent');
  assert.equal(evidence.journey, 'single-advance-winner');
  assertCandidateAndEnvironmentRecorded(evidence);

  // Byte readback of the race artifacts.
  const controlDir = path.join(project, 'control');
  const claim = JSON.parse(fs.readFileSync(path.join(controlDir, 'advance-claim.json'), 'utf8'));
  const advanceResult = JSON.parse(fs.readFileSync(path.join(controlDir, 'advance-result.json'), 'utf8'));
  const winner = evidence.advance.winnerExecution;
  assert.equal(claim.execution, winner, 'the claim on disk belongs to the recorded winner');
  assert.equal(claim.epoch, 1, 'the winning claim was taken at the current epoch');
  assert.equal(advanceResult.execution, winner, 'exactly the winner wrote the advance result');
  assert.equal(advanceResult.from, 0);
  assert.equal(advanceResult.to, 1);

  // Exactly one runner advanced; the loser was refused with the winner's claim.
  const advanced = Object.values(evidence.advance.runners).filter((runner) => runner.outcome === 'advanced');
  assert.equal(advanced.length, 1, `exactly one runner advanced: ${JSON.stringify(evidence.advance.runners)}`);
  const loser = Object.values(evidence.advance.runners).find((runner) => runner.code === 'CONCURRENT_ADVANCE_REFUSED' && runner.phase === 'race');
  assert.ok(loser, 'the race loser was refused');
  assert.equal(loser.execution !== winner, true, 'the loser is a different execution than the winner');
  assert.equal(loser.existing.execution, winner, 'the loser observed the winner claim');

  // The stale-epoch claimant was refused before the race and released its claim.
  const staleClaimant = Object.values(evidence.advance.runners).find((runner) => runner.code === 'CLAIM_EPOCH_STALE');
  assert.ok(staleClaimant, 'a stale-epoch advance claim was refused (epoch gate at the advance layer)');
  assert.equal(staleClaimant.claimReleased, true, 'the stale claimant released the claim it took');
  assert.equal(staleClaimant.epoch, 0, 'the stale claimant carried a superseded epoch');

  // A post-advance duplicate claim is refused — the advance is single-owner.
  const duplicateClaimant = Object.values(evidence.advance.runners).find((runner) => runner.code === 'CONCURRENT_ADVANCE_REFUSED' && runner.phase === 'post-advance');
  assert.ok(duplicateClaimant, 'a post-advance second claim is refused (duplicate idempotent)');

  // The control ledger records exactly one advance with a single writer.
  const ledger = assertFinalLedgerOnDisk(project, evidence);
  assert.equal(ledger.advanceSeq, 1, 'exactly one advance is recorded');
  assert.equal(ledger.advance.execution, winner);
  assert.equal(ledger.advance.epoch, 1);
  assert.ok(ledger.history.some((event) => event.event === 'advance-claimed' && event.execution === winner));

  // No second currentPhase: the runner refuses phase fields outright.
  assert.ok(refusalCodes(evidence).includes('RUNNER_PHASE_FIELD_REFUSED'), 'an advance binding with a phase field must be refused');
});

// --- V_F07 ---------------------------------------------------------------------

test('V_F07: a real SIGKILLed leaf worker is recovered from the authoritative disk state — completed leaves keep their identity, no leaf is reopened, the dead attempt is refused', () => {
  const project = makeProject('f07-kill-recovery');
  const result = runRecovery('kill-recovery', project);
  const evidence = assertObserved(result, 'V_F07');

  assert.equal(evidence.scenario, 'kill-recovery');
  assert.equal(evidence.journey, 'resumed-original-operation');
  assertCandidateAndEnvironmentRecorded(evidence);

  // The kill was real: a held worker process, SIGKILL injection, old writer
  // confirmed gone before the takeover.
  const killed = (evidence.workers ?? []).find((worker) => worker.outcome === 'killed');
  assert.ok(killed, 'one leaf worker was really killed');
  assert.equal(killed.injection.method, 'SIGKILL');
  assert.equal(killed.injection.confirmedGone, true);
  assert.match(killed.reason, /handover/, 'the kill hit the mid-handover window');

  // The killed worker's observation exists on disk and is pinned byte-level.
  const obsFile = path.join(project, killed.observationUri);
  assert.equal(fs.existsSync(obsFile), true, 'the killed worker left its observation on disk');
  assert.equal(killed.observationSha256, digestFile(obsFile), 'the recorded observation digest equals the disk bytes');

  // Recovery preserved the done leaf byte-for-byte and reopened nothing.
  const before = evidence.ledger.snapshots.beforeRecovery.state;
  const after = evidence.ledger.snapshots.afterRecovery.state;
  assert.equal(before.epoch, 1);
  assert.equal(after.epoch, 2, 'the takeover bumped the epoch');
  const l1Before = before.leaves.find((leaf) => leaf.id === 'L1');
  const l1After = after.leaves.find((leaf) => leaf.id === 'L1');
  assert.deepEqual(l1After, l1Before, 'the completed leaf keeps its exact dispatch execution and receipt digest across recovery');
  assert.deepEqual(before.leaves.map((leaf) => leaf.id), after.leaves.map((leaf) => leaf.id), 'no leaf task was reopened or added');

  // The dead attempt's late receipt was refused (STALE_EPOCH), traced.
  const staleEpoch = refusalByCode(evidence, 'STALE_EPOCH');
  assert.equal(staleEpoch.length, 1, `the dead attempt's late receipt is refused: ${refusalCodes(evidence).join(',')}`);
  assert.equal(staleEpoch[0].dispatch.execution, killed.execution, 'the refused dispatch is exactly the killed attempt binding');

  // The ORIGINAL operation was resumed, not restarted as a new leaf.
  const ledger = assertFinalLedgerOnDisk(project, evidence);
  const l2 = ledger.leaves.find((leaf) => leaf.id === 'L2');
  assert.equal(l2.status, 'done');
  assert.equal(l2.attempt, 2, 'the interrupted operation resumed on attempt 2 under the new epoch');
  assert.equal(l2.dispatchEpoch, 2);
  assert.notEqual(l2.dispatchExecution, killed.execution, 'the resumed binding differs from the dead one');

  assert.equal(evidence.gate.final.verdict, 'pass', 'the gate passes after recovery');
  assert.equal(evidence.gate.final.receipt.inputDigest, evidence.candidate.digestAfter);
});

// --- V_A12b (spec A12 lost-contact reconciliation) ------------------------------

test('V_A12b: leaves pass individually but the parent journey fails for real — the parent stays blocked and only a new candidate with full re-verification passes', () => {
  const project = makeProject('a12b-parent-block');
  const result = runRecovery('parent-block', project);
  const evidence = assertObserved(result, 'V_A12b');

  assert.equal(evidence.scenario, 'parent-block');
  assert.equal(evidence.journey, 're-accepted-on-new-candidate');
  assertCandidateAndEnvironmentRecorded(evidence);

  // The candidate really rotated.
  assert.notEqual(evidence.candidate.digestBefore, evidence.candidate.digestAfter, 'the builder produced a genuinely new candidate');
  const pipelineFile = path.join(project, 'src', 'pipeline.js');
  assert.equal(sha256(fs.readFileSync(pipelineFile)), sha256(fs.readFileSync(path.join(project, 'variants', 'pipeline-correct.js'))), 'the rotated pipeline is the correct variant, byte for byte');

  // Parent blocked although both leaves passed: the blocked-phase gate refused
  // on the failed integration observation and the release was refused.
  assert.equal(evidence.gate.blockedPhase.verdict, 'blocked', 'the parent gate is blocked while the integrated journey fails');
  assert.match(evidence.gate.blockedPhase.receipt.blocked.join('\n'), /UNVERIFIED_CAPABILITY: leaf:L-INT/, 'the failing parent observation cannot satisfy the integration check');
  assert.ok(evidence.journeyPhases.blocked, 'the blocked journey phase is recorded');
  const releaseRefused = refusalByCode(evidence, 'RELEASE_REFUSED');
  assert.equal(releaseRefused.length, 1, `the parent release is refused: ${refusalCodes(evidence).join(',')}`);
  assert.match(releaseRefused[0].reason, /parent/i);

  // Correlation discipline: a leaf receipt naming the wrong operation is refused.
  assert.ok(refusalCodes(evidence).includes('CORRELATION_MISMATCH'), 'a receipt correlated to the wrong leaf is refused');

  // The old candidate receipt cannot serve the new candidate.
  assert.ok(refusalCodes(evidence).includes('STALE_CANDIDATE'), 'the v1 receipt is refused on the new candidate (re-verify, not carry-over)');

  // Full re-verification happened on the new candidate.
  const ledger = assertFinalLedgerOnDisk(project, evidence);
  assert.equal(ledger.candidateDigest, evidence.candidate.digestAfter);
  for (const leaf of ledger.leaves) {
    assert.equal(leaf.status, 'done');
    assert.equal(leaf.attempt, 2, `leaf ${leaf.id} was re-verified on the new candidate (attempt 2)`);
  }
  assert.equal(evidence.gate.final.verdict, 'pass', 'the gate passes only after the new candidate is fully re-verified');
  assert.equal(evidence.gate.final.receipt.inputDigest, evidence.candidate.digestAfter, 'the passing gate receipt is bound to the new candidate digest');
  assert.equal(evidence.gate.final.receipt.requiredDenominator.valid, 3, 'all three checks closed independently');

  // Independent reproduction of the lost-contact semantics: on the DEFECTIVE
  // pipeline bytes (the recorded v1 candidate), leaves pass but the parent
  // suite is really RED; on the final fixture state the parent really passes.
  const reproDir = path.join(path.dirname(project), 'parent-red-repro');
  fs.cpSync(project, reproDir, { recursive: true });
  fs.copyFileSync(path.join(project, 'variants', 'pipeline-defective.js'), path.join(reproDir, 'src', 'pipeline.js'));
  const leafRedRepro = runFixtureTest(reproDir, 'leaf-slugify.test.js');
  assert.equal(leafRedRepro.status, 0, 'on the v1 candidate the leaf really passes individually');
  const parentRedRepro = runFixtureTest(reproDir, 'integration.test.js');
  assert.notEqual(parentRedRepro.status, 0, 'on the v1 candidate the parent journey really fails');
  assert.match(parentRedRepro.stdout, /# fail [1-9]/, 'the parent failure is a real behavior failure, not zero execution');
  const parentFinal = runFixtureTest(project, 'integration.test.js');
  assert.equal(parentFinal.status, 0, 'on the final candidate the parent journey really passes');
});

// ============================================================================
// V_RW_REAL_COMET_RECOVERY construction slice — the real managed Comet CLI.
//
// The recovery engine under test is the CLI's own classic-state face: every
// mutation runs under .comet-state.lock and is journaled to
// .comet-state-transaction.json (schema comet.classic.state-transaction.v1);
// the .comet.yaml rename is the commit point; the NEXT real CLI operation
// recovers an interrupted transaction (roll-back before the commit point,
// roll-forward after it). This slice triggers and OBSERVES that engine only —
// it never hand-writes control state, never fabricates a journal, and never
// substitutes counter workers: every fault is a real SIGKILL on a real child
// process (node spawn + process.kill, the monitor.mjs/I07 technique), every
// landing is classified from disk bytes after the old writer is confirmed
// dead, and every recovery is performed by a fresh real CLI process. The kill
// windows are genuine races: a bounded attempt budget with honest per-attempt
// classification keeps the verdict deterministic (land, or fail with
// diagnostics) while never fabricating a landing. Per-window evidence (pid,
// run identity, transaction digests, recovery readback) is persisted next to
// the fixture and mirrored to P33_KILL_EVIDENCE_DIR when that environment
// variable is set. Same-environment boundary: single-host directory form;
// cross-machine fencing stays with I08 and the live Outline unknown-result
// window stays execution_owner=VERIFY.
// ============================================================================

const GATE_ROLE_OF = { R: 'requirements-owner', A: 'reviewer', T: 'reviewer', P: 'planner', V: 'verifier', K: 'knowledge-publisher' };

const cometLockPath = path.join(projectRoot, 'integrations/comet/upstream.lock.json');
const cometLock = JSON.parse(fs.readFileSync(cometLockPath, 'utf8'));
const cometFingerprint = sha256(JSON.stringify({
  archive: cometLock.source.sha256,
  patches: cometLock.patches.map(({ path: patchPath, sha256: patchSha }) => ({ path: patchPath, sha256: patchSha })),
  toolchain: cometLock.toolchain,
}));
const cometBuildDir = path.join(projectRoot, '.sdd/vendor/comet', cometLock.source.commit, 'builds', cometFingerprint);
const cometEntrypoint = path.join(cometBuildDir, 'work/bin/comet.js');
const cometBuildPresent = fs.existsSync(cometEntrypoint)
  && fs.existsSync(path.join(cometBuildDir, 'distribution.json'))
  && fs.existsSync(path.join(projectRoot, '.sdd/vendor/comet', cometLock.source.commit, 'provenance.json'));
const COMET_BUILD_SKIP = cometBuildPresent
  ? false
  : `patched Comet build ${cometFingerprint.slice(0, 8)} is not present in this project; run tools/comet/prepare-source.mjs && tools/comet/build.mjs --archive first`;

let cometNode = process.execPath;
if (process.versions.node !== cometLock.toolchain.node) {
  const pinned = path.join(process.env.HOME ?? '', '.nvm/versions/node', `v${cometLock.toolchain.node}`, 'bin/node');
  if (spawnSync(pinned, ['--version'], { encoding: 'utf8' }).status === 0) cometNode = pinned;
}

// This run's real multi-agent consensus receipt (read-only positive control),
// bound to each dispatched inputDigest at use time — same consumption shape as
// the accepted 3_2 slice.
const r3ConsensusDir = path.join(projectRoot, 'openspec/changes/delivery-foundation-rearchitecture/consensus/2026-10-22-plan-r3');
const r3Tally = JSON.parse(fs.readFileSync(path.join(r3ConsensusDir, 'tally.json'), 'utf8'));
const r3Manifest = JSON.parse(fs.readFileSync(path.join(r3ConsensusDir, 'manifest.json'), 'utf8'));

const KILL_BUDGET = { dispatch: 40, preCommit: 60, postCommit: 60 };
const CHILD_TIMEOUT_MS = 120_000;

// --- shared scratch world (one comet init; one managed change per window) -----

let sliceWorldState = null;

function cometStubs(workdir) {
  const stubs = path.join(workdir, 'stubs');
  fs.mkdirSync(stubs, { recursive: true });
  // Same stub face as the accepted 2_4/3_2 harnesses: the openspec stub
  // creates the layout comet init needs; npm/npx are neutralized.
  fs.writeFileSync(path.join(stubs, 'openspec'), `#!/bin/sh
pos1=""; pos2=""; count=0
for arg in "$@"; do
  case "$arg" in --*) ;; *) count=$((count+1)); if [ "$count" -eq 1 ]; then pos1="$arg"; elif [ "$count" -eq 2 ]; then pos2="$arg"; fi ;; esac
done
if [ "$pos1" = "init" ] && [ -n "$pos2" ]; then
  mkdir -p "$pos2/openspec" "$pos2/.claude/commands" "$pos2/.claude/skills"
  printf 'schema: openspec-1.0\\n' > "$pos2/openspec/config.yaml"
  echo "fake skill" > "$pos2/.claude/commands/openspec.md"
fi
if [ "$pos1" = "archive" ] && [ -n "$pos2" ] && [ -n "$COMET_PROJECT_ROOT" ]; then
  cd "$COMET_PROJECT_ROOT" || exit 0
  if [ -d "docs/openspec/changes/$pos2" ]; then
    mkdir -p "docs/openspec/changes/archive"
    mv "docs/openspec/changes/$pos2" "docs/openspec/changes/archive/$(date +%Y-%m-%d)-$pos2"
  fi
fi
exit 0
`, { mode: 0o755 });
  for (const name of ['npm', 'npx']) {
    fs.writeFileSync(path.join(stubs, name), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  }
  return stubs;
}

function sliceEnv(workdir, stubs) {
  const env = {
    ...process.env,
    HOME: path.join(workdir, 'home'),
    COMET_PROJECT_ROOT: path.join(workdir, 'managed'),
    PATH: `${stubs}:${process.env.PATH ?? ''}`,
    TMPDIR: workdir,
  };
  delete env.NODE_TEST_CONTEXT;
  return env;
}

function ensureSliceWorld() {
  if (sliceWorldState) return sliceWorldState;
  const workdir = makeWorkdir('cli-slice');
  const project = path.join(workdir, 'managed');
  fs.mkdirSync(project, { recursive: true });
  const stubs = cometStubs(workdir);
  const env = sliceEnv(workdir, stubs);
  const comet = (args, { timeout = 240_000 } = {}) => {
    const result = spawnSync(cometNode, [cometEntrypoint, ...args], {
      cwd: project, encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024, env,
    });
    let json = null;
    try { json = JSON.parse(result.stdout ?? ''); } catch { /* non-JSON output stays raw */ }
    return { ...result, json };
  };
  const spawnComet = (args) => spawn(cometNode, [cometEntrypoint, ...args], {
    cwd: project, env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const init = comet(['init', project, '--yes', '--scope', 'project', '--workflow', 'classic', '--platform', 'claude', '--codegraph', 'skip', '--language', 'en'], { timeout: 300_000 });
  if (init.status !== 0) throw new Error(`comet init (classic) failed: ${plain(init.stderr).slice(0, 400)}`);
  sliceWorldState = { workdir, project, stubs, env, comet, spawnComet, changes: {} };
  return sliceWorldState;
}

const cliRefusalText = (result) => `${(result.json?.data?.issues ?? []).map((issue) => issue.message ?? '').join('\n')}\n${result.stderr ?? ''}\n${result.stdout ?? ''}`.replace(/\x1b\[[0-9;]*m/g, '');

const changeDirOf = (project, change) => path.join(project, 'docs/openspec/changes', change);
const journalFileOf = (project, change) => path.join(changeDirOf(project, change), '.comet-state-transaction.json');
const yamlFileOf = (project, change) => path.join(changeDirOf(project, change), '.comet.yaml');
const runStateFileOf = (project, change) => path.join(changeDirOf(project, change), '.comet', 'run-state.json');
const registryFileOf = (project, change) => path.join(changeDirOf(project, change), '.comet', 'gate-dispatches.json');

function writeSliceArtifacts(project, change) {
  const dir = changeDirOf(project, change);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'proposal.md'), '# Proposal\n\nReal-Comet recovery window probe.\n');
  fs.writeFileSync(path.join(dir, 'tasks.md'), '# Tasks\n\n- [ ] 1.1 Implement slice probe product code\n');
  fs.writeFileSync(path.join(dir, 'design.md'), `---\ncomet_change: ${change}\nrole: technical-design\ncanonical_spec: openspec\n---\n\n# Design\n\nRecovery window probe design v1.\n`);
  fs.writeFileSync(path.join(dir, 'test-intent.md'), '# Test Intent\n\ncases: c1\noracle: probe behavior observed\n');
  const plansDir = path.join(project, 'docs/superpowers/plans');
  fs.mkdirSync(plansDir, { recursive: true });
  fs.writeFileSync(path.join(plansDir, `${change}-plan.md`), '# Plan\n\n- 1.1 Implement slice probe product code\n');
  return dir;
}

function ensureSliceChange(label) {
  const world = ensureSliceWorld();
  if (world.changes[label]) return { world, change: world.changes[label] };
  const change = `p33-${label}`;
  writeSliceArtifacts(world.project, change);
  const inited = world.comet(['state', 'init', change, 'full', '--managed-delivery', '--knowledge-closeout-required', 'true', '--json']);
  if (inited.json?.exitCode !== 0) throw new Error(`state init failed: ${cliRefusalText(inited).slice(0, 400)}`);
  const rel = `docs/openspec/changes/${change}`;
  if (world.comet(['state', 'set', change, 'design_doc', `${rel}/design.md`, 'test_intent', `${rel}/test-intent.md`, 'plan', `docs/superpowers/plans/${change}-plan.md`, '--json']).json?.exitCode !== 0) {
    throw new Error('state set artifacts failed');
  }
  world.changes[label] = change;
  return { world, change };
}

// A compliant gate result for the dispatched binding (Runtime-issued fields
// echoed back; the report digest is the report's real sha256).
function slicePassResult(gate, binding, extra = {}) {
  const report = `# Gate ${gate} recovery-slice review\n\nReviewed by ${GATE_ROLE_OF[gate]} over the dispatched inputs (${binding.inputDigest.slice(0, 12)}…).\n`;
  return {
    execution: binding.execution,
    attempt: binding.attempt,
    verdict: 'pass',
    role: GATE_ROLE_OF[gate],
    inputDigest: binding.inputDigest,
    report,
    reportDigest: sha256(report),
    ...extra,
  };
}

const r3ConsensusForSlice = (binding, overrides = {}) => ({
  reviewId: r3Manifest.review_id,
  rule: 'unanimous',
  status: 'CLOSED',
  participants: (r3Manifest.participants ?? []).slice(),
  ballots: (r3Tally.ballots ?? []).map((ballot) => ({
    agent: ballot.agent,
    verdict: ballot.verdict,
    blockingFindings: ballot.blocking_findings,
    summaryDigest: sha256(String(ballot.summary ?? '')),
  })),
  artifactDigest: binding.inputDigest,
  ...overrides,
});

const strongTestDesignForSlice = (binding, overrides = {}) => ({
  verdict: 'sufficient',
  oracle: 'strong',
  inputDigest: binding.inputDigest,
  reviewer: 'test-authoring',
  findings: [],
  ...overrides,
});

// --- real SIGKILL injection machinery -----------------------------------------

// Confirm the old writer is GONE before any readback (monitor.mjs discipline).
function confirmProcessGone(pid, { timeoutMs = 5_000 } = {}) {
  const started = Date.now();
  for (;;) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    if (Date.now() - started > timeoutMs) return false;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
  }
}

// Poll the target control-plane file and SIGKILL the child the moment the
// trigger condition is observed (fs.watch is unavailable in this sandbox —
// the watch syscall is denied — so the injection polls stat identity at the
// millisecond scale; the kill windows are milliseconds wide and each attempt
// is honestly classified from disk bytes afterwards). Resolves on real
// process exit.
function watchAndKill(child, targetFile, mode) {
  return new Promise((resolve) => {
    const identity = (file) => {
      try {
        const stat = fs.statSync(file);
        return `${stat.size}:${stat.mtimeNs}:${stat.ino}`;
      } catch {
        return null;
      }
    };
    const baseline = mode === 'exists' ? null : identity(targetFile);
    let killed = false;
    let done = false;
    const finish = (payload) => {
      if (done) return;
      done = true;
      clearInterval(poller);
      resolve(payload);
    };
    const poller = setInterval(() => {
      if (done || killed) return;
      const current = identity(targetFile);
      const triggered = mode === 'exists' ? current !== null : (current !== null && current !== baseline);
      if (triggered) {
        killed = true;
        try { child.kill('SIGKILL'); } catch { /* died first */ }
      }
    }, 1);
    const timer = setTimeout(() => {
      if (!killed) {
        killed = true;
        try { child.kill('SIGKILL'); } catch { /* already gone */ }
      }
    }, CHILD_TIMEOUT_MS);
    child.once('error', () => {});
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      finish({ code, signal, killedByWatch: killed && signal === 'SIGKILL' });
    });
  });
}

const readBytesIfExists = (file) => { try { return fs.readFileSync(file); } catch { return null; } };

function mirrorKillEvidence(name, evidence) {
  const mirrorDir = process.env.P33_KILL_EVIDENCE_DIR;
  if (!mirrorDir) return;
  try {
    fs.mkdirSync(mirrorDir, { recursive: true });
    fs.writeFileSync(path.join(mirrorDir, name), `${JSON.stringify(evidence, null, 2)}\n`);
  } catch { /* the mirror is best-effort; the workdir copy is authoritative */ }
}

function gateReceiptsFromCli(world, change) {
  const raw = (world.comet(['state', 'get', change, 'gate_receipts']).stdout ?? '').trim();
  return JSON.parse(raw.length > 0 ? raw : '[]');
}

function dispatchGateOnce(world, change, gate) {
  const dispatched = world.comet(['state', 'dispatch-gate', change, gate, '--json']);
  if (dispatched.json?.exitCode !== 0) {
    throw new Error(`dispatch-gate ${gate} failed: ${cliRefusalText(dispatched).slice(0, 300)}`);
  }
  return dispatched.json?.data?.dispatch ?? JSON.parse((dispatched.stdout ?? '').trim().split('\n').pop());
}

// --- V_RW_REAL_COMET_RECOVERY:L11-core-transaction -----------------------------

test('V_RW_REAL_COMET_RECOVERY:L11-core-transaction — real SIGKILL inside the real managed Comet CLI state transaction: a pre-commit kill rolls back (no receipt, no phase change, replay of the killed attempt refused), a post-commit kill rolls forward (committed receipt exactly once, replay refused, recovery rewrites no committed bytes), and a kill during dispatch recovers the SAME open execution on re-dispatch (no duplicate dispatch)', { skip: COMET_BUILD_SKIP }, async () => {
  // Shared world; the change is driven through a real R acceptance first so
  // the kill experiments run against a non-trivial run (approval basis live).
  const { world, change } = ensureSliceChange('core-txn');
  const changeDir = changeDirOf(world.project, change);
  const yamlFile = yamlFileOf(world.project, change);
  const journalFile = journalFileOf(world.project, change);
  const runStateFile = runStateFileOf(world.project, change);
  const registryFile = registryFileOf(world.project, change);

  const rBinding = dispatchGateOnce(world, change, 'R');
  const rResultFile = path.join(world.workdir, `result-r-${rBinding.execution}.json`);
  fs.writeFileSync(rResultFile, JSON.stringify(slicePassResult('R', rBinding)));
  if (world.comet(['state', 'accept-gate', change, 'R', '--file', rResultFile, '--json']).json?.exitCode !== 0) {
    throw new Error('the clean R acceptance must proceed before the kill windows');
  }
  if (world.comet(['state', 'transition', change, 'open-complete', '--json']).json?.exitCode !== 0) {
    throw new Error('open-complete must proceed after the clean R acceptance');
  }
  assert.equal(world.comet(['state', 'get', change, 'phase']).stdout?.trim(), 'design');

  const killEvidenceDir = path.join(world.workdir, 'kill-evidence');
  fs.mkdirSync(killEvidenceDir, { recursive: true });

  // --- window 1: kill during dispatch. The same (gate, input version) job
  // key must recover its ORIGINAL open execution — never a duplicate mint.
  let dispatchWindow = null;
  let dispatchAttempts = 0;
  while (!dispatchWindow && dispatchAttempts < KILL_BUDGET.dispatch) {
    dispatchAttempts += 1;
    assert.equal(fs.existsSync(journalFile), false, 'no journal may exist before a dispatch attempt');
    const child = world.spawnComet(['state', 'dispatch-gate', change, 'A', '--json']);
    const pid = child.pid;
    const { signal } = await watchAndKill(child, registryFile, 'changed');
    const gone = confirmProcessGone(pid);
    const registry = JSON.parse(readBytesIfExists(registryFile) ?? '{"dispatches":[]}');
    const openA = (registry.dispatches ?? []).filter((entry) => entry.gate === 'A' && entry.state === 'open');
    if (signal === 'SIGKILL' && gone && openA.length === 1) {
      dispatchWindow = { pid, signal, openExecution: openA[0].execution, openAttempt: openA[0].attempt };
    } else if (openA.length >= 1) {
      // The child completed first (or the kill landed before the registry
      // write): absorb the minted dispatch with a clean acceptance and retry.
      const cleanupFile = path.join(world.workdir, `result-a-cleanup-${openA[0].execution}.json`);
      fs.writeFileSync(cleanupFile, JSON.stringify(slicePassResult('A', openA[0], { consensus: r3ConsensusForSlice(openA[0]) })));
      const accepted = world.comet(['state', 'accept-gate', change, 'A', '--file', cleanupFile, '--json']);
      if (accepted.json?.exitCode !== 0) throw new Error(`retry cleanup acceptance failed: ${cliRefusalText(accepted).slice(0, 300)}`);
    }
  }
  assert.ok(dispatchWindow, `the dispatch kill window never landed within ${KILL_BUDGET.dispatch} real attempts — a SIGKILL race that never wins is a diagnosis, not a pass`);
  assert.ok(confirmProcessGone(dispatchWindow.pid), 'the killed dispatcher must be confirmed gone');

  // Same-operation recovery: re-dispatching the same job key returns the SAME
  // open execution (recovered:true) — one open owner per job key.
  const redispatch = world.comet(['state', 'dispatch-gate', change, 'A', '--json']);
  assert.equal(redispatch.json?.exitCode, 0, `re-dispatch after the kill must recover: ${cliRefusalText(redispatch).slice(0, 300)}`);
  assert.equal(redispatch.json?.data?.recovered, true, 'the re-dispatch must RECOVER the open dispatch, not mint attempt 2');
  assert.equal(redispatch.json.data.dispatch.execution, dispatchWindow.openExecution, 'the recovered execution is the killed attempt\'s own execution');
  const registryAfterRecovery = JSON.parse(fs.readFileSync(registryFile, 'utf8'));
  assert.equal(registryAfterRecovery.dispatches.filter((entry) => entry.gate === 'A' && entry.state === 'open').length, 1, 'exactly one open dispatch for the job key survives recovery');

  const dispatchEvidence = {
    window: 'dispatch-recovery',
    change,
    killedPid: dispatchWindow.pid,
    signal: dispatchWindow.signal,
    confirmedGone: true,
    recoveredExecution: redispatch.json.data.dispatch.execution,
    recoveredAttempt: redispatch.json.data.dispatch.attempt,
    recoveredEpoch: redispatch.json.data.dispatch.epoch,
    recoveredGeneration: redispatch.json.data.dispatch.generation,
    changeStateSha256: sha256(fs.readFileSync(yamlFile)),
    openDispatchesAfter: 1,
    attempts: dispatchAttempts,
  };
  fs.writeFileSync(path.join(killEvidenceDir, 'dispatch-recovery.json'), `${JSON.stringify(dispatchEvidence, null, 2)}\n`);
  mirrorKillEvidence('dispatch-recovery.json', dispatchEvidence);

  // --- window 2: kill inside the acceptance BEFORE the commit point.
  // Watched file: the transaction journal appearing. Classified after the old
  // writer is confirmed dead: journal present AND .comet.yaml still the
  // pre-transaction bytes.
  let aActiveBinding = redispatch.json.data.dispatch;
  let aActiveResultFile = path.join(world.workdir, `result-a-kill-${aActiveBinding.execution}.json`);
  fs.writeFileSync(aActiveResultFile, JSON.stringify(slicePassResult('A', aActiveBinding, { consensus: r3ConsensusForSlice(aActiveBinding) })));

  let preWindow = null;
  const preAttemptLog = [];
  while (!preWindow && preAttemptLog.length < KILL_BUDGET.preCommit) {
    assert.equal(fs.existsSync(journalFile), false, 'no journal may exist before a pre-commit attempt');
    const yamlBefore = fs.readFileSync(yamlFile);
    const runStateBefore = readBytesIfExists(runStateFile);
    const receiptsBefore = gateReceiptsFromCli(world, change);
    const targetBinding = aActiveBinding;
    const child = world.spawnComet(['state', 'accept-gate', change, 'A', '--file', aActiveResultFile, '--json']);
    const pid = child.pid;
    const { signal } = await watchAndKill(child, journalFile, 'exists');
    const gone = confirmProcessGone(pid);
    const journalBytes = readBytesIfExists(journalFile);
    const yamlAtKill = fs.readFileSync(yamlFile);
    const committed = !yamlAtKill.equals(yamlBefore);
    const kind = journalBytes && !committed ? 'pre-commit'
      : journalBytes && committed ? 'post-commit'
        : committed ? 'missed-committed' : 'missed-early';
    preAttemptLog.push({ pid, kind, gone });
    if (kind === 'pre-commit' && gone) {
      preWindow = { pid, signal, yamlBefore, runStateBefore, journalBytes, yamlAtKill, receiptsBefore, binding: targetBinding, resultFile: aActiveResultFile };
    } else if (kind === 'post-commit' || kind === 'missed-committed') {
      // The kill landed after the commit point (or the child finished first):
      // the acceptance is committed — absorb it and re-dispatch for the next
      // attempt (a fresh Runtime binding at attempt n+1).
      assert.equal(world.comet(['state', 'get', change, 'phase']).status, 0, 'the state stays readable after a committed attempt');
      const next = world.comet(['state', 'dispatch-gate', change, 'A', '--json']);
      if (next.json?.exitCode !== 0) throw new Error(`re-dispatch for the next pre-commit attempt failed: ${cliRefusalText(next).slice(0, 300)}`);
      aActiveBinding = next.json.data.dispatch;
      aActiveResultFile = path.join(world.workdir, `result-a-kill-${aActiveBinding.execution}.json`);
      fs.writeFileSync(aActiveResultFile, JSON.stringify(slicePassResult('A', aActiveBinding, { consensus: r3ConsensusForSlice(aActiveBinding) })));
    }
    // 'missed-early' (killed before the transaction started): nothing to clean.
  }
  assert.ok(preWindow, `the pre-commit kill window never landed within ${KILL_BUDGET.preCommit} real attempts: ${JSON.stringify(preAttemptLog)}`);
  assert.equal(preWindow.signal, 'SIGKILL');

  // Recovery is performed by a fresh real CLI operation — the engine's own
  // journal/lock face, never a test-side rewrite.
  const phaseAfterPreRecovery = world.comet(['state', 'get', change, 'phase']);
  assert.equal(phaseAfterPreRecovery.status, 0, 'the first post-kill CLI operation must recover and succeed');
  assert.equal(fs.existsSync(journalFile), false, 'the recovery must consume the transaction journal');
  assert.ok(fs.readFileSync(yamlFile).equals(preWindow.yamlBefore), 'the recovery must leave the pre-transaction yaml bytes (the transaction never happened)');
  assert.ok(readBytesIfExists(runStateFile)?.equals(preWindow.runStateBefore) ?? preWindow.runStateBefore === null, 'the run identity must be exactly the pre-transaction run state');
  assert.equal(phaseAfterPreRecovery.stdout?.trim(), 'design', 'a rolled-back acceptance leaves the phase untouched');
  const receiptsAfterPreRecovery = gateReceiptsFromCli(world, change);
  assert.deepEqual(receiptsAfterPreRecovery, preWindow.receiptsBefore, 'a rolled-back acceptance publishes NO receipt');
  const registryPre = JSON.parse(fs.readFileSync(registryFile, 'utf8'));
  const killedADispatch = registryPre.dispatches.find((entry) => entry.gate === 'A' && entry.execution === preWindow.binding.execution);
  assert.equal(killedADispatch.state, 'consumed', 'the interrupted acceptance had already consumed its dispatch (outside the journal)');
  assert.equal(receiptsAfterPreRecovery.filter((receipt) => receipt.execution === preWindow.binding.execution).length, 0, 'the killed execution has no receipt anywhere — nothing half-published');

  // Old-attempt replay: the consumed dispatch from the killed transaction can
  // never accept again (no duplicate publish through recovery).
  const replayPre = world.comet(['state', 'accept-gate', change, 'A', '--file', preWindow.resultFile, '--json']);
  assert.notEqual(replayPre.status, 0, 'a replay of the killed attempt must be refused');
  assert.match(cliRefusalText(replayPre), /already .*consumed|exactly one result/i);
  assert.ok(fs.readFileSync(yamlFile).equals(preWindow.yamlBefore), 'the refused replay must not touch the recovered bytes');

  const preEvidence = {
    window: 'pre-commit-kill',
    change,
    killedPid: preWindow.pid,
    signal: preWindow.signal,
    confirmedGone: true,
    journalSchema: JSON.parse(preWindow.journalBytes).schema,
    killedExecution: preWindow.binding.execution,
    killedAttempt: preWindow.binding.attempt,
    yamlSha256AtKill: sha256(preWindow.yamlAtKill),
    yamlSha256Before: sha256(preWindow.yamlBefore),
    runStateAtKill: preWindow.runStateBefore === null ? null : JSON.parse(preWindow.runStateBefore),
    recovery: { op: 'comet state get phase', exitCode: phaseAfterPreRecovery.status, journalPresentAfter: false },
    receiptCountForKilledExecution: 0,
    replayRefusal: (cliRefusalText(replayPre).split('\n').find((line) => /consumed/.test(line)) ?? '').trim(),
    attempts: preAttemptLog.length,
  };
  fs.writeFileSync(path.join(killEvidenceDir, 'pre-commit-kill.json'), `${JSON.stringify(preEvidence, null, 2)}\n`);
  mirrorKillEvidence('pre-commit-kill.json', preEvidence);

  // Safe retry: a fresh Runtime binding accepts cleanly — exactly ONE receipt
  // for the retry execution; the killed execution never publishes.
  const retryBinding = dispatchGateOnce(world, change, 'A');
  const retryResultFile = path.join(world.workdir, `result-a-retry-${retryBinding.execution}.json`);
  fs.writeFileSync(retryResultFile, JSON.stringify(slicePassResult('A', retryBinding, { consensus: r3ConsensusForSlice(retryBinding) })));
  const retryAccepted = world.comet(['state', 'accept-gate', change, 'A', '--file', retryResultFile, '--json']);
  assert.equal(retryAccepted.json?.exitCode, 0, `the fresh-dispatch retry must proceed: ${cliRefusalText(retryAccepted).slice(0, 300)}`);
  const receiptsAfterRetry = gateReceiptsFromCli(world, change);
  assert.equal(receiptsAfterRetry.filter((receipt) => receipt.gate === 'A' && receipt.execution === retryBinding.execution).length, 1, 'the retry execution is published exactly once');
  assert.equal(receiptsAfterRetry.filter((receipt) => receipt.gate === 'A' && receipt.execution === preWindow.binding.execution).length, 0, 'the killed execution never publishes, before or after recovery');

  // --- window 3: kill inside the acceptance AFTER the commit point.
  // Watched file: .comet.yaml itself (the rename IS the commit). Classified
  // after the old writer is confirmed dead: journal still present AND the
  // yaml already holds the committed bytes.
  let tActiveBinding = dispatchGateOnce(world, change, 'T');
  let tActiveResultFile = path.join(world.workdir, `result-t-kill-${tActiveBinding.execution}.json`);
  fs.writeFileSync(tActiveResultFile, JSON.stringify(slicePassResult('T', tActiveBinding, { testDesignReview: strongTestDesignForSlice(tActiveBinding) })));

  let postWindow = null;
  const postAttemptLog = [];
  while (!postWindow && postAttemptLog.length < KILL_BUDGET.postCommit) {
    assert.equal(fs.existsSync(journalFile), false, 'no journal may exist before a post-commit attempt');
    const yamlBefore = fs.readFileSync(yamlFile);
    const targetBinding = tActiveBinding;
    const targetResultFile = tActiveResultFile;
    const child = world.spawnComet(['state', 'accept-gate', change, 'T', '--file', tActiveResultFile, '--json']);
    const pid = child.pid;
    const { signal } = await watchAndKill(child, yamlFile, 'changed');
    const gone = confirmProcessGone(pid);
    const journalBytes = readBytesIfExists(journalFile);
    const yamlAtKill = fs.readFileSync(yamlFile);
    const committed = !yamlAtKill.equals(yamlBefore);
    const kind = journalBytes && committed ? 'post-commit' : committed ? 'missed-committed' : journalBytes ? 'pre-commit' : 'missed-early';
    postAttemptLog.push({ pid, kind, gone });
    if (kind === 'post-commit' && gone) {
      postWindow = { pid, signal, yamlAtKill, journalBytes, binding: targetBinding, resultFile: targetResultFile };
    } else {
      // The acceptance committed (child finished first or the kill landed
      // late): absorb it and retry with a fresh T dispatch.
      assert.equal(world.comet(['state', 'get', change, 'phase']).status, 0, 'the state stays readable after a committed attempt');
      const next = world.comet(['state', 'dispatch-gate', change, 'T', '--json']);
      if (next.json?.exitCode !== 0) throw new Error(`re-dispatch T failed: ${cliRefusalText(next).slice(0, 300)}`);
      tActiveBinding = next.json.data.dispatch;
      tActiveResultFile = path.join(world.workdir, `result-t-kill-${tActiveBinding.execution}.json`);
      fs.writeFileSync(tActiveResultFile, JSON.stringify(slicePassResult('T', tActiveBinding, { testDesignReview: strongTestDesignForSlice(tActiveBinding) })));
    }
  }
  assert.ok(postWindow, `the post-commit kill window never landed within ${KILL_BUDGET.postCommit} real attempts: ${JSON.stringify(postAttemptLog)}`);
  assert.equal(postWindow.signal, 'SIGKILL');

  // Roll-FORWARD recovery: the committed transaction survives; the journal is
  // consumed; recovery rewrites NO committed bytes.
  const yamlDigestAtKill = sha256(postWindow.yamlAtKill);
  const gatesAfterRecovery = world.comet(['state', 'gates', change, '--json']);
  assert.equal(gatesAfterRecovery.status, 0, 'the first post-kill CLI operation must recover and succeed');
  assert.equal(fs.existsSync(journalFile), false, 'the recovery must consume the transaction journal');
  assert.equal(sha256(fs.readFileSync(yamlFile)), yamlDigestAtKill, 'recovery must not rewrite the committed yaml bytes');
  const receiptsFinal = gateReceiptsFromCli(world, change);
  const tReceiptsForExecution = receiptsFinal.filter((receipt) => receipt.gate === 'T' && receipt.execution === postWindow.binding.execution);
  assert.equal(tReceiptsForExecution.length, 1, 'the committed acceptance is published EXACTLY ONCE — recovery must not duplicate it');
  assert.equal(tReceiptsForExecution[0].attempt, postWindow.binding.attempt, 'the committed receipt carries the killed attempt number');
  assert.ok(Number.isInteger(tReceiptsForExecution[0].epoch) && Number.isInteger(tReceiptsForExecution[0].generation), 'the committed receipt carries epoch and generation (P1-03)');

  const replayPost = world.comet(['state', 'accept-gate', change, 'T', '--file', postWindow.resultFile, '--json']);
  assert.notEqual(replayPost.status, 0, 'a replay of the committed execution must be refused (a dispatch accepts exactly one result)');
  assert.match(cliRefusalText(replayPost), /already .*consumed|exactly one result/i);
  assert.equal(sha256(fs.readFileSync(yamlFile)), yamlDigestAtKill, 'the refused replay must not touch the committed bytes');

  // Recovery readback: Run identity, journal absence, approval basis and the
  // continuation face all read back consistent from a fresh CLI process.
  const runStateReadback = readBytesIfExists(runStateFile);
  const runStateJson = runStateReadback === null ? null : JSON.parse(runStateReadback);
  if (runStateJson !== null) assert.ok(runStateJson.runId, 'the run identity survives recovery with its runId');
  assert.equal(world.comet(['state', 'get', change, 'phase']).stdout?.trim(), 'design', 'acceptances do not transition the phase; the readback stays consistent');
  const next = world.comet(['state', 'next', change, '--json']);
  assert.equal(next.json?.exitCode, 0, cliRefusalText(next).slice(0, 300));
  const nextAction = next.json?.data?.nextAction;
  assert.ok(nextAction && typeof nextAction.kind === 'string', `the recovery face records a continuation: ${JSON.stringify(nextAction)}`);
  assert.match(String(next.json?.data?.continuation?.skill ?? ''), /^comet-/, 'the continuation projection names the resume skill');
  const gatesData = gatesAfterRecovery.json?.data ?? {};
  assert.ok((gatesData.receipts ?? []).some((receipt) => receipt.gate === 'T' && receipt.execution === postWindow.binding.execution), 'the approval-basis readback names the recovered receipt');

  const postEvidence = {
    window: 'post-commit-kill',
    change,
    killedPid: postWindow.pid,
    signal: postWindow.signal,
    confirmedGone: true,
    journalSchema: JSON.parse(postWindow.journalBytes).schema,
    committedExecution: postWindow.binding.execution,
    committedAttempt: postWindow.binding.attempt,
    yamlSha256AtKill: yamlDigestAtKill,
    yamlSha256AfterRecovery: sha256(fs.readFileSync(yamlFile)),
    runStateAfterRecovery: runStateJson,
    receiptCountForCommittedExecution: tReceiptsForExecution.length,
    replayRefusal: (cliRefusalText(replayPost).split('\n').find((line) => /consumed/.test(line)) ?? '').trim(),
    continuation: { kind: nextAction.kind, skill: next.json?.data?.continuation?.skill ?? null },
    attempts: postAttemptLog.length,
  };
  fs.writeFileSync(path.join(killEvidenceDir, 'post-commit-kill.json'), `${JSON.stringify(postEvidence, null, 2)}\n`);
  mirrorKillEvidence('post-commit-kill.json', postEvidence);
});

// --- V_RW_REAL_COMET_RECOVERY:L11-fencing --------------------------------------

test('V_RW_REAL_COMET_RECOVERY:L11-fencing — lock-layer old-writer fencing on the real CLI: a live old writer (real spawned pid in the lock owner record) fences a real CLI operation until timeout refusal, and after a real SIGKILL with gone-confirmation the dead writer\'s lock is auto-recovered and the same operation proceeds', { skip: COMET_BUILD_SKIP }, async () => {
  const { world, change } = ensureSliceChange('fencing');
  const lockFile = path.join(changeDirOf(world.project, change), '.comet-state.lock');

  // The live old writer is a REAL spawned process; the lock owner record
  // carries its real pid (the i08 fence-evidence shape: real pid, never a
  // fabricated one).
  const oldWriter = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 120000)'], { stdio: 'ignore' });
  const owner = {
    pid: oldWriter.pid,
    nonce: crypto.randomUUID(),
    createdAt: Date.now(),
    hostname: os.hostname(),
  };
  fs.writeFileSync(lockFile, JSON.stringify(owner));
  try {
    // The fenced operation is a real state-lock mutation (state set with the
    // SAME artifact value — semantically idempotent, but it takes the writer
    // lock like any control-plane write).
    const yamlBeforeFence = fs.readFileSync(yamlFileOf(world.project, change));
    const sameValue = `docs/openspec/changes/${change}/design.md`;
    // While the old writer is LIVE the CLI refuses (lock timeout), and the
    // refusal leaves the change state untouched.
    const fenced = world.comet(['state', 'set', change, 'design_doc', sameValue, '--json'], { timeout: 120_000 });
    assert.notEqual(fenced.status, 0, 'a live old writer must fence the real CLI operation');
    assert.match(cliRefusalText(fenced), /lock/i, 'the refusal names the lock');
    assert.ok(process.kill(oldWriter.pid, 0), 'the old writer was really alive while fencing');
    assert.ok(fs.readFileSync(yamlFileOf(world.project, change)).equals(yamlBeforeFence), 'the fenced refusal leaves the state bytes untouched');

    // Real SIGKILL + gone-confirmation (old writer must be confirmed dead).
    oldWriter.kill('SIGKILL');
    const exited = await new Promise((resolve) => oldWriter.once('exit', (code, signal) => resolve({ code, signal })));
    assert.equal(exited.signal, 'SIGKILL');
    assert.ok(confirmProcessGone(oldWriter.pid), 'the dead old writer must be confirmed gone before recovery');

    // The dead writer's lock is auto-recovered by the next real CLI operation.
    const recovered = world.comet(['state', 'set', change, 'design_doc', sameValue, '--json'], { timeout: 120_000 });
    assert.equal(recovered.status, 0, `the same operation proceeds after the dead writer's lock is recovered: ${cliRefusalText(recovered).slice(0, 300)}`);
    assert.equal(fs.existsSync(lockFile), false, 'the recovered lock leaves no stale lock file behind');
    assert.ok(fs.readFileSync(yamlFileOf(world.project, change)).equals(yamlBeforeFence), 'the idempotent re-set leaves the state bytes untouched');
  } finally {
    try { oldWriter.kill('SIGKILL'); } catch { /* already gone */ }
    try { fs.rmSync(lockFile, { force: true }); } catch { /* cleanup */ }
  }
  mirrorKillEvidence('old-writer-fencing.json', {
    window: 'old-writer-fencing',
    change,
    liveWriterPid: owner.pid,
    fencedRefusalExit: 'nonzero (lock timeout)',
    killedSignal: 'SIGKILL',
    recoveredOperationExit: 0,
    staleLockLeftBehind: false,
  });
});

// --- V_RW_REAL_COMET_RECOVERY:recipe-tracking ----------------------------------

test('V_RW_REAL_COMET_RECOVERY:recipe-tracking — the real-comet-recovery recipe is registered and bound (owner P3_3, required check V_RW_REAL_COMET_RECOVERY), coordinates with the same-run journey step 9 fault window (VERIFY-owned tail untouched), and the runner still refuses unknown journeys', () => {
  const base = 'openspec/changes/delivery-foundation-rearchitecture';
  const plan = JSON.parse(fs.readFileSync(path.join(projectRoot, base, 'verification-case-plan.json'), 'utf8'));
  const registration = plan.journey_definitions?.['real-comet-recovery'];
  assert.ok(registration, 'real-comet-recovery is registered in verification-case-plan journey_definitions');
  assert.equal(registration.owner, 'P3_3');
  assert.equal(registration.required_check, 'V_RW_REAL_COMET_RECOVERY');
  assert.equal(registration.path, `${base}/pilot-recovery/real-comet-recovery.case.json`);

  const recipe = JSON.parse(fs.readFileSync(path.join(projectRoot, registration.path), 'utf8'));
  assert.equal(recipe.scenario, 'L11', 'the registered contract command names scenario L11 and the recipe declares it');
  assert.equal(recipe.caseModule, 'test/delivery-cases/3_3.mjs');
  for (const id of ['D08', 'H01', 'H03', 'H07', 'L10', 'L11']) {
    assert.ok(recipe.acceptanceIds.includes(id), `the recipe carries acceptance id ${id}`);
  }
  for (const pin of ['V_RW_REAL_COMET_RECOVERY:L11-core-transaction', 'V_RW_REAL_COMET_RECOVERY:L11-fencing', 'V_RW_REAL_COMET_RECOVERY:recipe-tracking']) {
    assert.ok(recipe.requiredAssertions.includes(pin), `the recipe pins ${pin} to an executed test point`);
  }

  // Coordination with P3_2: the fault window lives INSIDE the same-run
  // journey (step 9) and stays execution_owner=VERIFY there; this recipe owns
  // only the bounded core-transaction slice.
  const hostJourney = JSON.parse(fs.readFileSync(path.join(projectRoot, base, 'pilot-journey/same-run-delivery.journey.json'), 'utf8'));
  const step9 = hostJourney.steps.find((step) => step.id === '9-outline-unknown-recovery');
  assert.ok(step9, 'the same-run journey embeds the recovery fault window as step 9');
  assert.equal(step9.executionOwner, 'VERIFY', 'the live fault window stays VERIFY-owned in the host journey');
  assert.match(step9.gate, /P3_3 recipe/, 'the host journey names this recipe as the run-level recovery slice owner');
  const recoveryJourney = JSON.parse(fs.readFileSync(path.join(projectRoot, base, 'pilot-recovery/real-comet-recovery.journey.json'), 'utf8'));
  assert.equal(recoveryJourney.journey, 'real-comet-recovery');
  assert.equal(recoveryJourney.recipeOwner, 'P3_3');
  assert.equal(recoveryJourney.executionOwner, 'VERIFY');
  assert.equal(recoveryJourney.sameRunCoordination.hostJourney, 'pilot-journey/same-run-delivery.journey.json step 9-outline-unknown-recovery');
  for (const stepId of ['2-kill-pre-commit', '3-kill-post-commit', '4-old-writer-fencing', '5-stale-refusal', '6-recovery-readback']) {
    const step = recoveryJourney.steps.find((entry) => entry.id === stepId);
    assert.ok(step, `the landed construction step ${stepId} exists`);
    assert.match(step.executionOwner, /P3_3/, `${stepId} is owned by P3_3 (landed construction scope)`);
  }
  for (const stepId of ['1-run-in-progress', '7-outline-unknown-result', '8-monitoring-backup-qualification', '9-resumed-run-completed']) {
    const step = recoveryJourney.steps.find((entry) => entry.id === stepId);
    assert.ok(step, `the journey step ${stepId} exists`);
    assert.equal(step.executionOwner, 'VERIFY', `${stepId} stays VERIFY-owned — recipe validation never closes the live window`);
  }

  // The registration surface is the binding: an unknown journey name is a
  // structured nonzero refusal, never a default-success path (real runner).
  const workdir = makeWorkdir('journey-negative');
  const run = spawnSync(process.execPath, [
    path.join(projectRoot, 'tools/verify/delivery-journey.mjs'),
    '--journey', 'real-comet-recovery-unknown', '--profile', 'managed-pilot',
    '--evidence-dir', path.join(workdir, 'ev'), '--json',
  ], { cwd: projectRoot, encoding: 'utf8', timeout: 120_000, maxBuffer: 64 * 1024 * 1024 });
  assert.equal(run.status, 2, 'an unknown journey refuses with exit 2');
  assert.match(run.stdout, /journey-not-registered/, 'the refusal is the structured journey-not-registered reason');
});

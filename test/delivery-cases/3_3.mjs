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
//   V_RW_REAL_COMET_RECOVERY (comet-050 revision, recipe
//          pilot-recovery/real-comet-recovery.case.json): the REAL managed
//          composition Run — `comet runtime dispatch --application-file` on
//          the sdd-managed-delivery package (pinned 0.5.0 build) — proving
//          the five same-Run recovery semantics: interrupt-then-recover via
//          the original request (real SIGKILL in the persistence window,
//          run exists exactly once and continues), idempotent replay of the
//          same recovery request (start/approval replays, RUN_CONFLICT on
//          rebinding), package content change refused (WORKFLOW_CHANGED on
//          both faces, restoration resumes the SAME run), stale evidence
//          refused (wrong claimToken / superseded attempt receipts are
//          STALE_ACTION and never land), and single-writer ownership
//          (second claim, trusted-executor takeover and stale revisions all
//          refused). The live Outline unknown-result window and external
//          monitoring/backup qualification are NOT here: they stay
//          execution_owner=VERIFY (same-run-delivery.journey.json step 9).
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

// Best-effort mirror of the world evidence for this run (the /tmp workdir
// copy is authoritative; P33_KILL_EVIDENCE_DIR only duplicates it).
function mirrorKillEvidence(name, evidence) {
  const mirrorDir = process.env.P33_KILL_EVIDENCE_DIR;
  if (!mirrorDir) return;
  try {
    fs.mkdirSync(mirrorDir, { recursive: true });
    fs.writeFileSync(path.join(mirrorDir, name), `${JSON.stringify(evidence, null, 2)}\n`);
  } catch { /* best-effort only */ }
}


// ============================================================================
// V_RW_REAL_COMET_RECOVERY — revision 2026-10-26-comet-050-adoption-v1.
//
// The retired 0.4.5 classic face (comet state init/dispatch-gate/accept-gate
// under .comet-state.lock) is GONE in the pinned 0.5.0 supply (build
// de39629a…, aeb1a659+0005): the real RED recorded in this change shows
// `state init <change> full --managed-delivery` now refuses with a usage
// error. The managed delivery run is a comet-050 composition Run driven
// through `comet runtime dispatch --application-file <sdd-managed-delivery
// package>` — the exact face P3_2 drove for the R→P slice. This revision
// proves the FIVE same-Run recovery semantics of task P3_3 against that
// face, all with the real CLI in one-shot /tmp worlds (isolated HOME/TMPDIR,
// pinned node, real child processes; every fault is a real SIGKILL, every
// landing is classified from disk bytes after the old writer is confirmed
// dead, every recovery is a fresh CLI process):
//
//   C050-interrupt-resume    a real SIGKILL lands while the run record is
//                            being persisted; the recovery entry re-issues
//                            the ORIGINAL request (same runId, same package,
//                            same input) — the run exists exactly once with
//                            the requested identity/input, and the run then
//                            continues normally (trusted prepare, approval
//                            resolved once, next step scheduled).
//   C050-idempotent-recovery the same recovery request replayed N times does
//                            no duplicate side work: byte-identical start
//                            replays return the same run (one checkpoint on
//                            disk, no re-minted actions), the same approval
//                            decision replayed N times leaves the revision
//                            untouched with one wait decision, and a same-key
//                            start with DIFFERENT input is refused
//                            (RUN_CONFLICT — a runId never silently rebinds).
//   C050-workflow-changed    mutated package content at the recovery entry is
//                            refused with WORKFLOW_CHANGED for BOTH mutation
//                            and inspect faces, the refusal leaves the run
//                            checkpoint bytes untouched, and restoring the
//                            original bytes lets the SAME run continue (the
//                            run record's application identity — contentHash
//                            structural, never a pinned value — names the
//                            original package as the immutable owner).
//   C050-stale-evidence      receipts from a superseded attempt/writer are
//                            refused by the engine before any business
//                            validator runs: a wrong-claimToken outcome is
//                            STALE_ACTION, and after mark-unknown →
//                            retry(reconciliation) bumps the attempt, the
//                            dead attempt-1 receipt stays STALE_ACTION
//                            forever — receipts for the action remain zero
//                            (conservative invalidation: old evidence never
//                            revives through recovery).
//   C050-single-writer       the composition Run keeps exactly one writer: a
//                            second host claim is ACTION_ALREADY_CLAIMED, the
//                            engine's own trusted executor cannot take over a
//                            host-claimed action, the same-identity re-claim
//                            is idempotent, a stale expectedRevision is
//                            REVISION_CONFLICT, and the disk checkpoint
//                            records exactly one claim owner.
//
// The refused-mutation CLI face also exposes the documented recovery request
// surface (classic composition recovery request: inspect after a refused
// write; the classic run_checkpoint face names {operation:"next"} for state
// recovery) — asserted live on the CLI response. The world wiring mirrors
// the installer's managed runtime link (node_modules/@rpamis/comet -> the
// pinned build) without claiming an install happened. The composition
// package is snapshotted into the world at test start, so parallel package
// work never mutates under a running case; no compositionHash/contentHash
// concrete value is ever pinned. The live Outline unknown-result window and
// external monitoring/backup qualification stay execution_owner=VERIFY
// (same-run-delivery.journey.json step 9).
// ============================================================================

const COMPOSITION_PACKAGE_SRC = path.join(projectRoot, 'integrations/comet/application/package');
const CLI_TIMEOUT_MS = 240_000;

// Full canonical classic-full initial state (pristine 0.5.0 schema): the
// composition requires every field — including isolation:'current' (runs
// here start isolated; the isolation=null deadlock P3_2 recorded upstream
// belongs to the deep full.build.configure validators, never reached here).
const initialCompositionState = {
  workflow: 'full',
  language: null,
  phase: 'open',
  contextCompression: null,
  buildMode: null,
  buildPause: null,
  subagentDispatch: null,
  tddMode: null,
  reviewMode: null,
  isolation: 'current',
  boundBranch: null,
  verifyMode: null,
  autoTransition: null,
  baseRef: null,
  designDoc: null,
  plan: null,
  verifyResult: 'pending',
  verifyFailures: 0,
  verificationReport: null,
  branchStatus: null,
  createdAt: null,
  verifiedAt: null,
  archiveConfirmation: null,
  archived: false,
  directOverride: null,
  handoffContext: null,
  handoffHash: null,
  classicProfile: null,
  classicMigration: null,
};

function startRequestFor(runId, change) {
  return {
    operation: 'start',
    runId,
    workflow: { id: 'comet-classic-full', version: '1' },
    input: { change, changeDir: `docs/openspec/changes/${change}` },
    initialState: initialCompositionState,
  };
}

// --- one-shot /tmp world: project + snapshotted composition package ------

const c050Worlds = new Map();

function compositionWorld(label) {
  if (c050Worlds.has(label)) return c050Worlds.get(label);
  const workdir = makeWorkdir(`c050-${label}`);
  const project = path.join(workdir, 'project');
  fs.mkdirSync(path.join(project, '.comet'), { recursive: true });
  fs.writeFileSync(path.join(project, '.comet', 'config.yaml'),
    'schema: comet.project.v1\ndefault_workflow: classic\nworkflows: [classic]\nclassic:\n  artifact_layout: docs\n');
  const git = spawnSync('git', ['init', '-q', '-b', 'main', project], { encoding: 'utf8' });
  if (git.status !== 0) throw new Error(`git init failed in world ${label}: ${git.stderr}`);
  const pkgDir = path.join(workdir, 'pkg');
  fs.cpSync(COMPOSITION_PACKAGE_SRC, pkgDir, { recursive: true });
  // Managed runtime link — the same wiring `comet application install`
  // creates via ensureApplicationRuntimeDependency (node_modules/@rpamis/comet
  // -> the pinned runtime build). This world never claims an install.
  const namespace = path.join(workdir, 'node_modules', '@rpamis');
  fs.mkdirSync(namespace, { recursive: true });
  fs.symlinkSync(path.join(cometBuildDir, 'work'), path.join(namespace, 'comet'), 'dir');
  const env = {
    ...process.env,
    HOME: path.join(workdir, 'home'),
    TMPDIR: workdir,
    PATH: '/usr/bin:/bin',
  };
  delete env.NODE_TEST_CONTEXT;
  const requestFile = (request, name) => {
    const file = path.join(workdir, `req-${name}.json`);
    fs.writeFileSync(file, `${JSON.stringify(request)}\n`);
    return file;
  };
  const cliArgs = (file) => [
    cometEntrypoint, 'runtime', 'dispatch',
    '--application-file', path.join(pkgDir, 'application.json'),
    '--project-root', project,
    '--request', file,
    '--json', '--details',
  ];
  const comet = (request, name, { timeout = CLI_TIMEOUT_MS } = {}) => {
    const result = spawnSync(cometNode, cliArgs(requestFile(request, name)), {
      cwd: project, encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024, env,
    });
    let json = null;
    try { json = JSON.parse(result.stdout ?? ''); } catch { /* keep raw */ }
    return { ...result, json };
  };
  const spawnComet = (request, name) => spawn(cometNode, cliArgs(requestFile(request, name)), {
    cwd: project, env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const world = { label, workdir, project, pkgDir, env, comet, spawnComet };
  c050Worlds.set(label, world);
  return world;
}

// --- run-record readback (authoritative disk bytes, never CLI memory) ----

function storeV2Root(world) {
  const workspaces = path.join(world.env.HOME, '.comet', 'workspaces');
  for (const wsid of fs.readdirSync(workspaces)) {
    const candidate = path.join(workspaces, wsid, 'runtime', 'applications', 'sdd-managed-delivery', '.runtime-store-v2');
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error('no sdd-managed-delivery runtime store under the isolated HOME');
}

function readRunCheckpoints(world) {
  const checkpoints = [];
  const root = storeV2Root(world);
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.name === 'checkpoint.json') {
        checkpoints.push({ file: full, record: JSON.parse(fs.readFileSync(full, 'utf8')).record });
      }
    }
  };
  visit(root);
  return checkpoints;
}

const checkpointsFor = (world, runId) => readRunCheckpoints(world).filter((entry) => entry.record.runId === runId);

function checkpointFor(world, runId) {
  const matches = checkpointsFor(world, runId);
  assert.equal(matches.length, 1, `exactly one disk checkpoint exists for run ${runId} (found ${matches.length})`);
  return matches[0];
}

const cliErrorCode = (result) => result.json?.error?.code ?? null;
const cliRefusalText = (result) => `${result.json?.error?.code ?? ''}: ${result.json?.error?.message ?? ''}\n${result.stderr ?? ''}\n${result.stdout ?? ''}`;

function assertSucceeded(result, label) {
  assert.equal(result.status, 0, `${label}: the CLI dispatch must exit 0, got ${result.status}\n${cliRefusalText(result).slice(0, 600)}`);
  assert.equal(result.json?.status, 'succeeded', `${label}: the dispatch response must be succeeded`);
  return result.json.data;
}

function assertRefused(result, code, label) {
  assert.notEqual(result.status, 0, `${label}: the CLI dispatch must be refused`);
  assert.equal(result.json?.status, 'failed', `${label}: the refusal is a structured failed response`);
  assert.equal(cliErrorCode(result), code, `${label}: expected refusal ${code}, got ${cliRefusalText(result).slice(0, 400)}`);
  return result.json;
}

const prepareActionOf = (run, runId) => {
  const actions = (run.actions ?? []).filter((action) => action.stepId === 'classic.composition.prepare');
  assert.equal(actions.length, 1, `exactly one composition.prepare action on ${runId}`);
  return actions[0];
};

// Drive a run to the approval wait via the TRUSTED launcher face
// (Runner.Dispatch.v1: the engine's own registered executor — hosts cannot
// forge the work proposal the composition validator pins to that executor).
function driveToApprovalWait(world, runId, change, label) {
  const started = world.comet(startRequestFor(runId, change), `${label}-start`);
  const run = assertSucceeded(started, `${label} start`);
  assert.equal(run.runId, runId);
  const prepare = prepareActionOf(run, runId);
  assert.equal(prepare.status, 'pending', 'the composition prepare action is scheduled at start');
  const executed = world.comet({
    operation: 'execute', runId, expectedRevision: run.revision,
    actionId: prepare.id, executorId: 'comet-classic-composition-prepare',
  }, `${label}-execute`);
  const afterExecute = assertSucceeded(executed, `${label} execute`);
  const prepareAfter = prepareActionOf(afterExecute, runId);
  assert.equal(prepareAfter.status, 'succeeded', 'the trusted launcher completed prepare');
  assert.equal((prepareAfter.receipts ?? []).length, 1, 'prepare has exactly one receipt');
  const waits = (afterExecute.waits ?? []).filter((wait) => wait.stepId === 'classic.composition.confirm' && wait.status === 'pending');
  assert.equal(waits.length, 1, 'the composition confirmation wait is open');
  return { run: afterExecute, prepare: prepareAfter, wait: waits[0] };
}

const approvalRequest = (runId, revision, wait, decisionId) => ({
  operation: 'resolve-wait', runId, expectedRevision: revision,
  waitId: wait.id, proposalHash: wait.proposalHash, decisionId, choice: 'approved',
});

// --- V_RW_REAL_COMET_RECOVERY:C050-interrupt-resume ----------------------------

test('V_RW_REAL_COMET_RECOVERY:C050-interrupt-resume — a real SIGKILL inside the composition Run persistence window recovers through the original request: the run exists exactly once, identity/input survive byte-level, the run continues (trusted prepare, approval resolved exactly once, next step scheduled), and a refused write exposes the documented inspect recovery face', { skip: COMET_BUILD_SKIP }, async () => {
  const world = compositionWorld('interrupt');
  const attemptLog = [];

  // Bounded attempts across fresh runIds until a real SIGKILL lands inside
  // the persistence window (the window is a genuine race; every attempt is
  // honestly classified from disk bytes after the writer is confirmed dead).
  // The watcher polls the store directory identity (readdir), never parsing
  // run records in the hot loop; classification parses once after the kill.
  const storeDir = () => {
    try { return storeV2Root(world); } catch { return null; }
  };
  const listing = () => {
    const root = storeDir();
    if (root === null) return '';
    try { return fs.readdirSync(root).join(','); } catch { return ''; }
  };
  let landed = null;
  for (let attempt = 1; attempt <= 6 && !landed; attempt += 1) {
    const runId = `p33-c050-a${attempt}`;
    const request = startRequestFor(runId, runId);
    const before = listing();
    const child = world.spawnComet(request, `kill-${attempt}`);
    const pid = child.pid;
    // Kill the moment the store listing changes for this attempt (the CAS
    // commit is an atomic rename; a new store entry == persisted to disk).
    const observed = await new Promise((resolve) => {
      let killed = false;
      const poller = setInterval(() => {
        if (killed) return;
        if (listing() !== before) {
          killed = true;
          try { child.kill('SIGKILL'); } catch { /* died first */ }
        }
      }, 2);
      const timer = setTimeout(() => {
        killed = true;
        try { child.kill('SIGKILL'); } catch { /* already gone */ }
      }, 120_000);
      child.once('error', () => {});
      child.once('exit', (code, signal) => {
        clearTimeout(timer);
        clearInterval(poller);
        resolve({ code, signal, killedByWatch: signal === 'SIGKILL' && killed });
      });
    });
    const gone = confirmProcessGone(pid);
    let onDisk = null;
    try { onDisk = checkpointsFor(world, runId)[0] ?? null; } catch { /* store absent */ }
    const landing = observed.signal === 'SIGKILL' && gone && onDisk
      ? 'killed-after-commit'
      : observed.signal === 'SIGKILL' && gone && !onDisk
        ? 'killed-before-commit'
        : 'child-completed-first';
    attemptLog.push({
      attempt, runId, pid, signal: observed.signal ?? null, confirmedGone: gone,
      landing, revisionOnDisk: onDisk?.record.revision ?? null,
    });
    if (observed.signal === 'SIGKILL' && gone) landed = { runId, request, landing, pid };
    else if (onDisk) landed = { runId, request, landing, pid: null };
    // killed-before-commit: nothing persisted; the recovery entry below
    // re-issues the SAME request — that is exactly the resume path.
  }
  assert.ok(landed, `the SIGKILL persistence window never landed within the attempt budget: ${JSON.stringify(attemptLog)}`);
  const { runId, request, landing } = landed;

  // Recovery entry: a FRESH real CLI process re-issues the ORIGINAL request
  // (same runId, same package, same input) — never a second run identity.
  const recovery = world.comet(request, 'recovery-start');
  const recoveredRun = assertSucceeded(recovery, 'recovery start re-issue');
  assert.equal(recoveredRun.runId, runId, 'the recovery entry returns the ORIGINAL run identity');
  assert.equal(recoveredRun.workflow.id, 'comet-classic-full', 'the recovered run keeps the original workflow identity');
  assert.deepEqual(recoveredRun.input, request.input, 'the recovered run keeps the original input binding');
  const checkpoint = checkpointFor(world, runId);
  assert.equal(checkpoint.record.run.revision, recoveredRun.revision, 'the CLI view equals the authoritative disk revision');
  assert.match(String(checkpoint.record.application.contentHash), /^[a-f0-9]{64}$/, 'the run record pins its owning package identity structurally (never a pinned value)');
  assert.equal(checkpointsFor(world, runId).length, 1, 'the interrupted run exists exactly once on disk — the kill and the recovery never minted a second run');

  if (landing === 'killed-after-commit' || landing === 'child-completed-first') {
    const bytesAfterRecovery = fs.readFileSync(checkpoint.file);
    const confirming = world.comet(request, 'recovery-start-confirm');
    assertSucceeded(confirming, 'confirming re-issue');
    assert.equal(sha256(fs.readFileSync(checkpoint.file)), sha256(bytesAfterRecovery),
      'an idempotent recovery re-issue must not rewrite the committed run bytes');
  } else {
    assert.equal(recoveredRun.revision, 1, 'a rolled-back start was re-created exactly once by the recovery entry');
  }

  // The run CONTINUES under the recovered binding: trusted prepare, approval
  // resolved exactly once, next step scheduled.
  const { run: afterExecute, wait } = driveToApprovalWait(world, runId, runId, 'recovered');
  const prepareBeforeApproval = prepareActionOf(afterExecute, runId);
  const resolved = world.comet(approvalRequest(runId, afterExecute.revision, wait, 'p33-c050-approval'), 'recovered-approval');
  const afterApproval = assertSucceeded(resolved, 'approval resolution');
  const confirmWait = (afterApproval.waits ?? []).find((entry) => entry.id === wait.id);
  assert.equal(confirmWait.status, 'resolved', 'the approval wait resolved');
  assert.equal(confirmWait.decision.id, 'p33-c050-approval', 'exactly the issued decision landed');
  const prepareFinal = prepareActionOf(afterApproval, runId);
  assert.equal((prepareFinal.receipts ?? []).length, 1, 'prepare still has exactly one receipt — recovery did not reopen completed work');
  assert.deepEqual(prepareFinal.receipts, prepareBeforeApproval.receipts, 'the completed prepare receipt identity survived the whole recovery journey');
  assert.ok((afterApproval.actions ?? []).some((action) => action.stepId === 'full.open' && action.status === 'pending'),
    'the next workflow step (full.open) is scheduled — the recovered run advances');

  // The refused-write recovery face: a stale-revision approval replay is
  // refused AND the CLI names the documented recovery request (inspect) —
  // the classic composition recovery surface, never a blind retry.
  const staleReplay = world.comet(approvalRequest(runId, afterExecute.revision, wait, 'p33-c050-approval'), 'stale-approval');
  assertRefused(staleReplay, 'REVISION_CONFLICT', 'stale-revision approval');
  assert.equal(staleReplay.json.continuation?.request?.operation, 'inspect', 'a refused write exposes the inspect recovery request face');
  assert.match(String(staleReplay.json.continuation?.instruction ?? ''), /读取当前 Run|不盲目重试/u,
    'the continuation instructs read-then-continue, not blind retry');

  const killEvidenceDir = path.join(world.workdir, 'kill-evidence');
  fs.mkdirSync(killEvidenceDir, { recursive: true });
  const evidence = {
    window: 'composition-run-persistence',
    landing,
    attempts: attemptLog,
    recoveredRunId: runId,
    runRecordSha256: sha256(fs.readFileSync(checkpointFor(world, runId).file)),
    applicationContentHashShape: 'sha256-hex (structural, value never pinned)',
    approvalDecisions: 1,
    refusedWriteRecoveryFace: staleReplay.json.continuation?.request,
  };
  fs.writeFileSync(path.join(killEvidenceDir, 'interrupt-resume.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  mirrorKillEvidence('c050-interrupt-resume.json', evidence);
});

// --- V_RW_REAL_COMET_RECOVERY:C050-idempotent-recovery -------------------------

test('V_RW_REAL_COMET_RECOVERY:C050-idempotent-recovery — the same recovery request replayed N times does no duplicate side work: byte-identical start replays return the same single run, the same approval replayed N times never bumps the revision or mints a second decision, and a same-key start with different input is refused (RUN_CONFLICT)', { skip: COMET_BUILD_SKIP }, () => {
  const world = compositionWorld('idempotent');
  const runId = 'p33-c050-b';
  const request = startRequestFor(runId, runId);

  const first = assertSucceeded(world.comet(request, 'idem-start-1'), 'first start');
  const firstCheckpointBytes = fs.readFileSync(checkpointFor(world, runId).file);
  for (let replay = 2; replay <= 4; replay += 1) {
    const again = assertSucceeded(world.comet(request, `idem-start-${replay}`), `start replay ${replay}`);
    assert.equal(again.runId, runId, `replay ${replay} returns the original run`);
    assert.equal(again.revision, first.revision, `replay ${replay} does not advance the revision`);
    assert.deepEqual(again.actions ?? [], first.actions ?? [], `replay ${replay} mints no new actions`);
  }
  assert.equal(sha256(fs.readFileSync(checkpointFor(world, runId).file)), sha256(firstCheckpointBytes),
    'N byte-identical start requests leave the run record bytes untouched after the first');
  assert.equal(checkpointsFor(world, runId).length, 1,
    'exactly one run checkpoint exists — the replays never created a second run');

  // Same key, DIFFERENT input: refused. A runId never silently rebinds.
  const rebound = { ...request, input: { change: runId, changeDir: 'docs/openspec/changes/somewhere-else' } };
  assertRefused(world.comet(rebound, 'idem-rebind'), 'RUN_CONFLICT', 'same-runId different-input start');

  // Approval idempotency: the same decision replayed N times resolves once.
  const { run: afterExecute, wait } = driveToApprovalWait(world, runId, runId, 'idem');
  const resolved = assertSucceeded(world.comet(approvalRequest(runId, afterExecute.revision, wait, 'p33-c050-b-decision'), 'idem-approval-1'), 'first approval');
  const revisionAfterFirst = resolved.revision;
  for (let replay = 2; replay <= 4; replay += 1) {
    const data = assertSucceeded(world.comet(approvalRequest(runId, revisionAfterFirst, wait, 'p33-c050-b-decision'), `idem-approval-${replay}`), `approval replay ${replay}`);
    assert.equal(data.revision, revisionAfterFirst, `approval replay ${replay} does not advance the revision`);
    const confirmWait = (data.waits ?? []).find((entry) => entry.id === wait.id);
    assert.equal(confirmWait.status, 'resolved');
    assert.equal(confirmWait.decision.id, 'p33-c050-b-decision', `replay ${replay} keeps exactly the one decision`);
  }
  // A DIFFERENT decision for the same wait is a conflict, never a re-roll.
  assertRefused(world.comet({
    operation: 'resolve-wait', runId, expectedRevision: revisionAfterFirst,
    waitId: wait.id, proposalHash: wait.proposalHash, decisionId: 'p33-c050-b-evil', choice: 'rejected',
  }, 'idem-approval-conflict'), 'DECISION_CONFLICT', 'conflicting decision');

  const checkpoint = checkpointFor(world, runId);
  const diskWait = checkpoint.record.run.waits.filter((entry) => entry.id === wait.id);
  assert.equal(diskWait.length, 1);
  assert.equal(diskWait[0].decision?.id, 'p33-c050-b-decision', 'the disk record holds exactly the one decision');

  mirrorKillEvidence('c050-idempotent-recovery.json', {
    window: 'idempotent-replay',
    runId,
    startReplays: 4,
    approvalReplays: 4,
    revisionAfterApprovals: revisionAfterFirst,
    reboundRefusal: 'RUN_CONFLICT',
    conflictingDecisionRefusal: 'DECISION_CONFLICT',
  });
});

// --- V_RW_REAL_COMET_RECOVERY:C050-workflow-changed ----------------------------

test('V_RW_REAL_COMET_RECOVERY:C050-workflow-changed — mutated package content at the recovery entry is refused with WORKFLOW_CHANGED on both the mutation and inspect faces, the refusals leave the run bytes untouched, and restoring the original bytes lets the SAME run continue under its original package ownership', { skip: COMET_BUILD_SKIP }, () => {
  const world = compositionWorld('drift'); // own package snapshot — this test mutates it
  const runId = 'p33-c050-c';
  const { run: afterExecute, wait } = driveToApprovalWait(world, runId, runId, 'drift');

  const checkpoint = checkpointFor(world, runId);
  const bytesBeforeDrift = fs.readFileSync(checkpoint.file);
  assert.equal(checkpoint.record.application.packageRoot, fs.realpathSync(world.pkgDir),
    'the run record names the original package directory (realpath form) as its immutable owner');
  assert.match(String(checkpoint.record.application.contentHash), /^[a-f0-9]{64}$/, 'structural content identity');

  // Drift one packaged byte (a trailing comment in the entry Skill).
  const skillFile = path.join(world.pkgDir, 'SKILL.md');
  const originalSkill = fs.readFileSync(skillFile);
  fs.appendFileSync(skillFile, '\n<!-- p3_3 drift probe -->\n');

  const nextRequest = { operation: 'next', runId, expectedRevision: afterExecute.revision };
  assertRefused(world.comet(nextRequest, 'drift-next'), 'WORKFLOW_CHANGED', 'mutation face under drift');
  assert.match(String(assertRefused(world.comet(nextRequest, 'drift-next-2'), 'WORKFLOW_CHANGED', 'mutation face under drift, again').error?.message ?? ''), /恢复原应用包/u,
    'the refusal names the restoration path');
  assertRefused(world.comet({ operation: 'inspect', runId }, 'drift-inspect'), 'WORKFLOW_CHANGED', 'inspect face under drift');
  assert.equal(sha256(fs.readFileSync(checkpoint.file)), sha256(bytesBeforeDrift),
    'the WORKFLOW_CHANGED refusals leave the run checkpoint bytes untouched');
  assert.equal(readRunCheckpoints(world).length, 1, 'no second run appeared while the package drifted');

  // Restore the original bytes: the SAME run continues under the SAME request.
  fs.writeFileSync(skillFile, originalSkill);
  const resumed = assertSucceeded(world.comet(nextRequest, 'drift-restored-next'), 'restored next');
  assert.equal(resumed.runId, runId, 'the same run continues after restoration');
  const resolved = assertSucceeded(world.comet(approvalRequest(runId, resumed.revision, wait, 'p33-c050-c-decision'), 'drift-approval'), 'approval after restoration');
  const confirmWait = (resolved.waits ?? []).find((entry) => entry.id === wait.id);
  assert.equal(confirmWait.decision.id, 'p33-c050-c-decision', 'the run accepted real progress after the original bytes returned');
  assert.ok((resolved.actions ?? []).some((action) => action.stepId === 'full.open' && action.status === 'pending'),
    'the workflow advanced past the approval after restoration');

  mirrorKillEvidence('c050-workflow-changed.json', {
    window: 'package-drift',
    runId,
    driftedFile: 'SKILL.md',
    refusalFaces: ['next (mutation)', 'inspect'],
    refusalCode: 'WORKFLOW_CHANGED',
    runBytesUntouchedDuringRefusals: true,
    restoredThenContinued: true,
  });
});

// --- V_RW_REAL_COMET_RECOVERY:C050-stale-evidence ------------------------------

test('V_RW_REAL_COMET_RECOVERY:C050-stale-evidence — receipts from a superseded writer or attempt are refused by the engine before any business validator: wrong claimToken and post-retry attempt-1 receipts are STALE_ACTION and never land (receipts stay zero — old evidence does not revive through recovery)', { skip: COMET_BUILD_SKIP }, () => {
  const world = compositionWorld('stale');
  const runId = 'p33-c050-d';
  const started = assertSucceeded(world.comet(startRequestFor(runId, runId), 'stale-start'), 'stale start');
  const prepare = prepareActionOf(started, runId);
  const inputHash = prepare.inputHash;

  // Writer 1 claims attempt 1.
  const claim1 = assertSucceeded(world.comet({
    operation: 'claim', runId, expectedRevision: started.revision,
    actionId: prepare.id, attempt: 1, inputHash, executorId: 'p33-stale-host-1', claimToken: 'p33-stale-token-1',
  }, 'stale-claim-1'), 'claim attempt 1');

  // A receipt naming a DIFFERENT claimToken is refused outright.
  assertRefused(world.comet({
    operation: 'record-outcome', runId, expectedRevision: claim1.revision,
    outcome: { actionId: prepare.id, attempt: 1, inputHash, claimToken: 'p33-stale-token-IMPOSTOR', outcomeId: 'p33-stale-o1', status: 'succeeded', output: { note: 'impostor' } },
  }, 'stale-outcome-impostor'), 'STALE_ACTION', 'wrong-claimToken receipt');

  // Lost contact → reconcile as not-executed → retry bumps the attempt.
  const unknown = assertSucceeded(world.comet({
    operation: 'mark-unknown', runId, expectedRevision: claim1.revision,
    actionId: prepare.id, attempt: 1, reason: 'p3_3 probe: writer lost contact mid-flight',
  }, 'stale-mark-unknown'), 'mark unknown');
  assert.equal(prepareActionOf(unknown, runId).status, 'unknown', 'the attempt is in the unknown state');
  const retried = assertSucceeded(world.comet({
    operation: 'retry', runId, expectedRevision: unknown.revision,
    actionId: prepare.id, attempt: 1,
    reconciliation: { resolution: 'not-executed', evidence: 'p3_3 probe: no side effect was observed before the loss' },
  }, 'stale-retry'), 'retry with reconciliation');
  const prepareAfterRetry = prepareActionOf(retried, runId);
  assert.equal(prepareAfterRetry.attempt, 2, 'the retry bumped the action to attempt 2');
  assert.equal(prepareAfterRetry.status, 'pending');
  assert.equal(prepareAfterRetry.claim, undefined, 'the dead writer claim was cleared');

  // The OLD attempt's late receipt (with its own once-valid token) is refused.
  const lateOldAttempt = world.comet({
    operation: 'record-outcome', runId, expectedRevision: retried.revision,
    outcome: { actionId: prepare.id, attempt: 1, inputHash, claimToken: 'p33-stale-token-1', outcomeId: 'p33-stale-o1', status: 'succeeded', output: { note: 'late from the killed writer' } },
  }, 'stale-outcome-late');
  assertRefused(lateOldAttempt, 'STALE_ACTION', 'late attempt-1 receipt after retry');
  assert.match(String(lateOldAttempt.json?.error?.message ?? ''), /执行尝试或输入版本/u, 'the refusal names the attempt/input binding');

  // Even after writer 2 legitimately claims attempt 2, the old receipt still
  // cannot land — and nothing was admitted anywhere.
  const claim2 = assertSucceeded(world.comet({
    operation: 'claim', runId, expectedRevision: retried.revision,
    actionId: prepare.id, attempt: 2, inputHash, executorId: 'p33-stale-host-2', claimToken: 'p33-stale-token-2',
  }, 'stale-claim-2'), 'claim attempt 2');
  assertRefused(world.comet({
    operation: 'record-outcome', runId, expectedRevision: claim2.revision,
    outcome: { actionId: prepare.id, attempt: 1, inputHash, claimToken: 'p33-stale-token-1', outcomeId: 'p33-stale-o1', status: 'succeeded', output: { note: 'late again' } },
  }, 'stale-outcome-late-2'), 'STALE_ACTION', 'late attempt-1 receipt after attempt-2 claim');

  // Disk readback: no receipt for the action ever landed; one action, attempt 2.
  const checkpoint = checkpointFor(world, runId);
  const diskPrepare = checkpoint.record.run.actions.find((action) => action.id === prepare.id);
  assert.equal((diskPrepare.receipts ?? []).length, 0, 'the stale receipts never landed on disk');
  assert.equal((diskPrepare.rejectedOutcomes ?? []).length, 0, 'the stale receipts were refused before admission, not recorded as rejected work');
  assert.equal(diskPrepare.attempt, 2);
  assert.equal(checkpoint.record.run.actions.filter((action) => action.stepId === 'classic.composition.prepare').length, 1,
    'the stale evidence never re-opened the action as a new one');

  mirrorKillEvidence('c050-stale-evidence.json', {
    window: 'stale-attempt-writer',
    runId,
    refusals: [
      { face: 'wrong claimToken', code: 'STALE_ACTION' },
      { face: 'late attempt-1 after retry', code: 'STALE_ACTION' },
      { face: 'late attempt-1 after attempt-2 claim', code: 'STALE_ACTION' },
    ],
    receiptsOnDisk: 0,
    finalAttempt: 2,
  });
});

// --- V_RW_REAL_COMET_RECOVERY:C050-single-writer -------------------------------

test('V_RW_REAL_COMET_RECOVERY:C050-single-writer — the composition Run keeps exactly one writer: a second host claim is ACTION_ALREADY_CLAIMED, the engine\'s own trusted executor cannot take over a host-claimed action, the same-identity re-claim is idempotent, a stale expectedRevision is REVISION_CONFLICT, and the disk record holds exactly one claim owner', { skip: COMET_BUILD_SKIP }, () => {
  const world = compositionWorld('writer');
  const runId = 'p33-c050-e';
  const started = assertSucceeded(world.comet(startRequestFor(runId, runId), 'writer-start'), 'writer start');
  const prepare = prepareActionOf(started, runId);
  const inputHash = prepare.inputHash;
  const claimRequest = (executorId, claimToken, expectedRevision) => ({
    operation: 'claim', runId, expectedRevision,
    actionId: prepare.id, attempt: 1, inputHash, executorId, claimToken,
  });

  const first = assertSucceeded(world.comet(claimRequest('p33-writer-a', 'p33-writer-token-a', started.revision), 'writer-claim-a'), 'first writer claim');
  assert.equal(prepareActionOf(first, runId).status, 'running');

  // A SECOND writer (different executor identity) is refused — no takeover.
  assertRefused(world.comet(claimRequest('p33-writer-b', 'p33-writer-token-b', first.revision), 'writer-claim-b'),
    'ACTION_ALREADY_CLAIMED', 'second writer claim');

  // Even the engine's own trusted executor cannot take over the host claim.
  assertRefused(world.comet({
    operation: 'execute', runId, expectedRevision: first.revision,
    actionId: prepare.id, executorId: 'comet-classic-composition-prepare',
  }, 'writer-execute-takeover'), 'ACTION_ALREADY_CLAIMED', 'trusted-executor takeover of a host-claimed action');

  // The ORIGINAL writer re-claiming its own identity is idempotent.
  const reClaim = assertSucceeded(world.comet(claimRequest('p33-writer-a', 'p33-writer-token-a', first.revision), 'writer-reclaim-a'), 'same-identity re-claim');
  assert.equal(reClaim.revision, first.revision, 'the idempotent re-claim does not advance the revision');

  // A stale expectedRevision is refused — the CAS race protection. The
  // start revision is now strictly behind the post-claim revision.
  assert.ok(first.revision > started.revision, 'the claim advanced the revision (precondition for a stale revision probe)');
  assertRefused(world.comet(claimRequest('p33-writer-a', 'p33-writer-token-a', started.revision), 'writer-stale-revision'),
    'REVISION_CONFLICT', 'stale-expectedRevision claim');

  // Disk readback: exactly one claim owner, nothing else moved.
  const checkpoint = checkpointFor(world, runId);
  const diskPrepare = checkpoint.record.run.actions.find((action) => action.id === prepare.id);
  assert.deepEqual(diskPrepare.claim, { executorId: 'p33-writer-a', token: 'p33-writer-token-a' },
    'the disk record holds exactly the single claim owner');
  assert.equal(diskPrepare.status, 'running');
  assert.equal(checkpoint.record.run.actions.length, (started.actions ?? []).length, 'no action was duplicated or re-opened');

  mirrorKillEvidence('c050-single-writer.json', {
    window: 'single-writer',
    runId,
    refusals: [
      { face: 'second host claim', code: 'ACTION_ALREADY_CLAIMED' },
      { face: 'trusted-executor takeover', code: 'ACTION_ALREADY_CLAIMED' },
      { face: 'stale expectedRevision', code: 'REVISION_CONFLICT' },
    ],
    idempotentReclaim: true,
    diskClaimOwner: 'p33-writer-a',
  });
});

// --- V_RW_REAL_COMET_RECOVERY:recipe-tracking (050 revision) -------------------

test('V_RW_REAL_COMET_RECOVERY:L11-recipe-tracking — the real-comet-recovery recipe stays registered for the comet-050 revision with the five same-Run recovery pins bound to executed test points, the same-run journey step 9 stays VERIFY-owned, and the journey surface refuses unknown journeys and unfrozen registrations (never a default-success path)', () => {
  const base = 'openspec/changes/delivery-foundation-rearchitecture';
  const plan = JSON.parse(fs.readFileSync(path.join(projectRoot, base, 'verification-case-plan.json'), 'utf8'));
  const registration = plan.journey_definitions?.['real-comet-recovery'];
  assert.ok(registration, 'real-comet-recovery is registered in verification-case-plan journey_definitions');
  assert.equal(registration.owner, 'P3_3');
  assert.equal(registration.required_check, 'V_RW_REAL_COMET_RECOVERY');
  assert.equal(registration.path, `${base}/pilot-recovery/real-comet-recovery.case.json`);

  const recipe = JSON.parse(fs.readFileSync(path.join(projectRoot, registration.path), 'utf8'));
  assert.equal(recipe.caseModule, 'test/delivery-cases/3_3.mjs', 'the recipe names this case module');
  assert.ok(Array.isArray(recipe.requiredAssertions) && recipe.requiredAssertions.length >= 5, 'the recipe pins its assertion denominator');
  for (const pin of [
    'V_RW_REAL_COMET_RECOVERY:C050-interrupt-resume',
    'V_RW_REAL_COMET_RECOVERY:C050-idempotent-recovery',
    'V_RW_REAL_COMET_RECOVERY:C050-workflow-changed',
    'V_RW_REAL_COMET_RECOVERY:C050-stale-evidence',
    'V_RW_REAL_COMET_RECOVERY:C050-single-writer',
  ]) {
    assert.ok(recipe.requiredAssertions.includes(pin), `the recipe pins ${pin} to an executed test point`);
  }
  const spawnAction = recipe.actions.find((action) => action.type === 'spawn');
  assert.ok(spawnAction, 'the recipe declares a real spawn action');
  assert.equal(spawnAction.command, 'node --test test/delivery-cases/3_3.mjs');
  assert.equal(spawnAction.expect?.kind, 'tapRequiredAssertions');
  // No concrete compositionHash/contentHash value is frozen anywhere in the
  // recipe (parallel composition work must never be pinned by this file).
  assert.doesNotMatch(JSON.stringify(recipe), /"[a-f0-9]{64}"/, 'the recipe pins no concrete package hash value');

  // Coordination with the same-run journey: the live fault window stays
  // VERIFY-owned there; this recipe owns only the bounded recovery slice.
  const hostJourney = JSON.parse(fs.readFileSync(path.join(projectRoot, base, 'pilot-journey/same-run-delivery.journey.json'), 'utf8'));
  const step9 = hostJourney.steps.find((step) => step.id === '9-outline-unknown-recovery');
  assert.ok(step9, 'the same-run journey embeds the recovery fault window as step 9');
  assert.equal(step9.executionOwner, 'VERIFY', 'the live fault window stays VERIFY-owned in the host journey');

  // The recovery journey record declares the 050 construction scope honestly.
  const recoveryJourney = JSON.parse(fs.readFileSync(path.join(projectRoot, base, 'pilot-recovery/real-comet-recovery.journey.json'), 'utf8'));
  assert.equal(recoveryJourney.recipeOwner, 'P3_3');
  for (const step of recoveryJourney.steps) {
    if (/^c050-/.test(step.id)) assert.equal(step.executionOwner, 'P3_3', `the landed construction step ${step.id} is P3_3-owned`);
  }
  for (const stepId of ['1-run-in-progress', '7-outline-unknown-result', '8-monitoring-backup-qualification', '9-resumed-run-completed']) {
    const step = recoveryJourney.steps.find((entry) => entry.id === stepId);
    assert.ok(step, `the journey step ${stepId} exists`);
    assert.equal(step.executionOwner, 'VERIFY', `${stepId} stays VERIFY-owned — recipe validation never closes the live window`);
  }

  // The journey runner surface: unknown journeys refuse structurally; the
  // registered-but-unfrozen journey refuses NOT-EXERCISED (the denominator
  // registration is a VERIFY-owned step — recorded honestly, never a pass).
  const workdir = makeWorkdir('journey-negative');
  const runJourney = (journeyName) => spawnSync(process.execPath, [
    path.join(projectRoot, 'tools/verify/delivery-journey.mjs'),
    '--journey', journeyName, '--profile', 'comet-managed-v2',
    '--evidence-dir', path.join(workdir, journeyName), '--json',
  ], { cwd: projectRoot, encoding: 'utf8', timeout: 120_000, maxBuffer: 64 * 1024 * 1024 });
  const unknown = runJourney('real-comet-recovery-unknown');
  assert.equal(unknown.status, 2, 'an unknown journey refuses with exit 2');
  const unknownVerdict = JSON.parse(fs.readFileSync(path.join(workdir, 'real-comet-recovery-unknown', 'verdict.json'), 'utf8'));
  assert.equal(unknownVerdict.verdict, 'NOT-EXERCISED');
  assert.match(unknownVerdict.reason, /journey-not-registered/, 'the refusal is the structured journey-not-registered reason');

  const registered = runJourney('real-comet-recovery');
  assert.equal(registered.status, 2, 'the registered journey is nonzero unless the frozen denominator exists');
  const registeredVerdict = JSON.parse(fs.readFileSync(path.join(workdir, 'real-comet-recovery', 'verdict.json'), 'utf8'));
  assert.notEqual(registeredVerdict.verdict, 'PASS', 'a recipe without its frozen denominator never passes');
  assert.match(String(registeredVerdict.reason), /journey-recipe-freeze|case_definition_sha256|journey-recipe-not-implemented|journey-registration-incomplete/u,
    `the honest refusal names the missing prerequisite: ${registeredVerdict.reason}`);
});

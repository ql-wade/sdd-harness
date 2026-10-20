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
//
// Fixtures are generated under os.tmpdir(); no live configuration or
// change-control file is written by this suite. Zero new npm dependencies.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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

  // The run completes only through current bindings.
  for (const leaf of ledger.leaves) {
    assert.equal(leaf.status, 'done');
    assert.equal(leaf.dispatchEpoch, 2, `leaf ${leaf.id} was completed under the current epoch`);
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

// Architecture-review adapter (task P2_5, work packages 2.5.a/2.5.b;
// E03/E04/H06). The architecture gate is admitted only by an independent
// unanimous consensus over a FROZEN review package:
//
//   - the exact quorum, thresholds and rubric are replicated from the P0-era
//     receipt (openspec/changes/delivery-foundation-rearchitecture/
//     architecture-review/receipt.json): participants [claude-code, zcode,
//     codex-agent], overall >= 8.0, every criterion >= 7.0, all-APPROVE, one
//     shared artifact digest, zero blocking findings — field for field;
//   - the mechanical tally/finalize are the REAL gate
//     (.agents/skills/multi-agent-consensus-review/scripts/review_gate.py),
//     executed as a subprocess; a passed receipt digests the real tally.json
//     and finalize report bytes (mechanical_tally_sha256/final_report_sha256);
//   - grill-me load-bearing questions must all be closed before the gate can
//     pass — consensus alone never advances it (E03);
//   - a requirements or design change freezes a NEW revision: old ballots are
//     refused for the new package (the real gate rejects their review_id), a
//     restored digest never auto-revives an old receipt, and downstream
//     evidence bound to the review is invalidated with it (E04);
//   - production recovery uses the original Native pending dispatch (H06).
//     The legacy seat below is component registration only and cannot sign
//     managed acceptance; it stores no product phase or dispatch authority.
//
// A fixed protected host supplies `managed` context to the existing consume
// seams during long readback. A binds original grill and three independent
// collected ballot sources to real mechanical evidence; T binds one collected
// semantic sufficiency report to its target TestContract. Preparation returns
// a pure verifyReview(request, currentProtectedContext) query. Native alone
// consumes its current intent. Dispatch-only compatibility has finite scope.
//
// Boundary: pure judgment + registration + consumption. The adapter never
// dispatches an agent, never writes phase or control state, and holds no
// second job — Comet.Run.managedDelivery.v1 and SDD.Gate.v1 are left untouched.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseContract } from '../../contracts/delivery/index.js';
import { admitEvidence, envelopeDigest } from '../delivery/evidence.js';

const SHA256_RE = /^[a-f0-9]{64}$/;
const REVIEW_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value) => typeof value === 'string' && value.trim().length > 0;
const exact = (left, right) => {
  try { return left !== undefined && right !== undefined && envelopeDigest(left) === envelopeDigest(right); }
  catch { return false; }
};

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const GATE_SCRIPT = path.join(projectRoot, '.agents/skills/multi-agent-consensus-review/scripts/review_gate.py');

// The P0 exact consensus structure. REVIEW_THRESHOLDS is compared with
// deepEqual semantics: { overall, criterion } and nothing else.
export const REVIEW_PARTICIPANTS = Object.freeze(['claude-code', 'zcode', 'codex-agent']);
export const REVIEW_THRESHOLDS = Object.freeze({ overall: 8, criterion: 7 });
export const ARCHITECTURE_CRITERIA = Object.freeze(['requirements_fit', 'boundaries', 'reliability', 'security_operations', 'evolution_testability']);
// Baseline kind under which downstream evidence binds this review (P2_1
// boundDigests/boundRevisions shape).
export const ARCHITECTURE_REVIEW_BASELINE_KIND = 'architecture-review';

const ADAPTER_NOTE = 'mechanical gate admission only; no ballot rewritten by the adapter';
const roundDirName = (round) => `round-${String(round).padStart(2, '0')}`;
const isPositiveInt = (value) => Number.isInteger(value) && value >= 1;

function fail(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  throw error;
}

function inputObject(value) {
  if (!object(value)) fail('INPUT_INVALID', 'review options must be an object');
  return value;
}

function reviewInputs(pkg, runRoot, round = 0) {
  if (!object(pkg) || typeof pkg.reviewId !== 'string' || !REVIEW_ID_RE.test(pkg.reviewId) || !text(pkg.artifactPath)
    || !SHA256_RE.test(pkg.artifactSha256 ?? '') || !isPositiveInt(pkg.revision)
    || !exact(pkg.quorum, REVIEW_PARTICIPANTS) || !exact(pkg.thresholds, REVIEW_THRESHOLDS)
    || !exact(pkg.criteria, ARCHITECTURE_CRITERIA)) fail('PACKAGE_INVALID', 'a frozen review package is required');
  if (!text(runRoot)) fail('RUN_ROOT_INVALID', 'a local review evidence directory is required');
  if (!Number.isInteger(round) || round < 0 || round > 2) fail('ROUND_INVALID', 'round must be an integer from 0 through 2');
}

function runGate(args) {
  const result = spawnSync('python3', [GATE_SCRIPT, ...args], { encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024 });
  let payload = null;
  try { payload = JSON.parse(result.stdout ?? ''); } catch { payload = null; }
  return { exitCode: result.status ?? 2, stdout: result.stdout ?? '', stderr: result.stderr ?? '', payload };
}

function readJson(file) {
  try {
    return JSON.parse(fsSync.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function recheckFinalize(runDir, tallyPath, reportPath) {
  let temporary;
  try {
    temporary = fsSync.mkdtempSync(path.join(os.tmpdir(), 'sdd-review-recheck-'));
    const output = path.join(temporary, 'report.md');
    const debate = path.join(runDir, 'debate', path.basename(path.dirname(tallyPath)) + '.md');
    const result = runGate(['finalize', '--manifest', path.join(runDir, 'manifest.json'), '--tally', tallyPath,
      '--conclusion-file', path.join(runDir, 'conclusion.md'), '--next-plan-file', path.join(runDir, 'next-plan.md'), '--output', output,
      ...(path.basename(path.dirname(tallyPath)) !== 'round-00' ? ['--debate-log', debate] : [])]);
    return result.exitCode === 0 && fsSync.readFileSync(output).equals(fsSync.readFileSync(reportPath));
  } catch {
    return false;
  } finally {
    if (temporary) fsSync.rmSync(temporary, { recursive: true, force: true });
  }
}

// --- 2.5.a: freeze the review package ----------------------------------------

// The frozen package: the artifact's plain-content sha256 (the same digest
// review_gate.py records for file artifacts), bound to a monotonically
// increasing revision and the exact quorum/thresholds/rubric.
export function freezeReviewPackage(options = {}) {
  const { reviewId, artifactPath, revision } = inputObject(options);
  if (typeof reviewId !== 'string' || !REVIEW_ID_RE.test(reviewId)) {
    fail('PACKAGE_REVIEW_ID_INVALID', 'freezeReviewPackage requires a non-empty reviewId');
  }
  if (!isPositiveInt(revision)) {
    fail('PACKAGE_REVISION_INVALID', 'freezeReviewPackage requires an integer revision >= 1');
  }
  let artifact = null;
  try {
    artifact = fsSync.statSync(artifactPath);
  } catch {
    artifact = null;
  }
  if (!artifact || !artifact.isFile()) {
    fail('ARTIFACT_MISSING', 'the review artifact is unavailable or is not a regular file');
  }
  return Object.freeze({
    reviewId,
    artifactPath: fsSync.realpathSync(artifactPath),
    artifactSha256: sha256(fsSync.readFileSync(artifactPath)),
    revision,
    quorum: Object.freeze([...REVIEW_PARTICIPANTS]),
    thresholds: Object.freeze({ ...REVIEW_THRESHOLDS }),
    criteria: Object.freeze([...ARCHITECTURE_CRITERIA]),
  });
}

// --- the real mechanical gate drivers ----------------------------------------

// Initialize the consensus run for the frozen package. The gate itself
// refuses a held run directory (same job_key never re-reviews, H06).
export function initConsensusRun(options = {}) {
  const { package: pkg, runRoot, initiator, decision, maxRounds = 3, questions } = inputObject(options);
  reviewInputs(pkg, runRoot);
  if (maxRounds !== 3) fail('REVIEW_POLICY_INVALID', 'the protected architecture policy permits exactly three rounds');
  if (questions !== undefined) {
    const closure = loadBearingStatus(questions);
    if (questions.length === 0 || closure.open.length > 0) return { ok: false, exitCode: 2, error: 'LOAD_BEARING_OPEN' };
  }
  if (!initiator || !REVIEW_PARTICIPANTS.includes(initiator)) {
    fail('INITIATOR_INVALID', `initiator must be one of ${REVIEW_PARTICIPANTS.join(', ')}`);
  }
  fsSync.mkdirSync(runRoot, { recursive: true });
  const runDir = path.join(runRoot, pkg.reviewId);
  const ran = runGate([
    'init',
    '--run-dir', runDir,
    '--review-type', 'architecture',
    '--initiator', initiator,
    '--participants', REVIEW_PARTICIPANTS.join(','),
    '--artifact', pkg.artifactPath,
    '--scope', `frozen review package ${pkg.reviewId} (revision ${pkg.revision})`,
    '--decision', decision ?? 'authorize the architecture gate only on unanimous mechanical consensus',
    '--min-score', String(REVIEW_THRESHOLDS.overall),
    '--min-criterion-score', String(REVIEW_THRESHOLDS.criterion),
    '--max-rounds', String(maxRounds),
  ]);
  if (ran.exitCode !== 0) {
    return { ok: false, exitCode: ran.exitCode, stderr: ran.stderr, stdout: ran.stdout };
  }
  const manifest = readJson(path.join(runDir, 'manifest.json'));
  const drift = (detail) => ({ ok: false, exitCode: 2, error: 'MANIFEST_PACKAGE_MISMATCH', detail, stderr: ran.stderr });
  if (!manifest) return drift('the gate wrote no readable manifest');
  if (manifest.review_id !== pkg.reviewId) return drift(`manifest review_id ${manifest.review_id} does not match the frozen package ${pkg.reviewId}`);
  if (manifest.artifact_sha256 !== pkg.artifactSha256) return drift('manifest artifact_sha256 does not match the frozen package digest');
  if (JSON.stringify(manifest.participants) !== JSON.stringify(REVIEW_PARTICIPANTS)) return drift('manifest participants drifted from the exact quorum');
  if (!exact(manifest.thresholds, REVIEW_THRESHOLDS)) {
    return drift('manifest thresholds drifted from the exact P0 thresholds');
  }
  return { ok: true, exitCode: 0, manifest, runDir };
}

// Write one ballot into the round directory and let the REAL gate validate
// it. Refusals are the gate's own errors — the adapter adds nothing.
export function admitBallot(options = {}) {
  const { package: pkg, runRoot, participant, ballot, round = 0 } = inputObject(options);
  reviewInputs(pkg, runRoot, round);
  if (!REVIEW_PARTICIPANTS.includes(participant)) {
    fail('PARTICIPANT_INVALID', `participant ${String(participant)} is not part of the exact quorum`);
  }
  if (!object(ballot)) fail('BALLOT_INVALID', 'admitBallot requires a ballot object');
  const roundDir = path.join(runRoot, pkg.reviewId, roundDirName(round));
  fsSync.mkdirSync(roundDir, { recursive: true });
  const ballotPath = path.join(roundDir, `ballot-${participant}.json`);
  const ballotBytes = Buffer.from(JSON.stringify(ballot, null, 2) + '\n');
  try { fsSync.writeFileSync(ballotPath, ballotBytes, { flag: 'wx' }); }
  catch (error) {
    if (error.code !== 'EEXIST') fail('BALLOT_WRITE_FAILED', 'cannot preserve the ballot');
    if (!fsSync.readFileSync(ballotPath).equals(ballotBytes)) return { ok: false, exitCode: 2, error: 'BALLOT_IMMUTABLE', errors: ['a changed ballot requires a new round'] };
  }
  const ran = runGate(['validate', '--manifest', path.join(runRoot, pkg.reviewId, 'manifest.json'), '--ballot', ballotPath, '--round', String(round)]);
  if (ran.exitCode === 0) {
    return { ok: true, exitCode: 0, ballotPath, path: `${pkg.reviewId}/${roundDirName(round)}/ballot-${participant}.json` };
  }
  return {
    ok: false,
    exitCode: ran.exitCode,
    errors: Array.isArray(ran.payload?.errors) ? ran.payload.errors : [ran.stderr.trim() || `gate validate exited ${ran.exitCode}`],
    ballotPath,
  };
}

// The authoritative mechanical tally (the gate's own verdict; exit 0 only on
// unanimous approval over unchanged artifacts).
export function mechanicalTally(options = {}) {
  const { package: pkg, runRoot, round = 0 } = inputObject(options);
  reviewInputs(pkg, runRoot, round);
  const ran = runGate(['tally', '--manifest', path.join(runRoot, pkg.reviewId, 'manifest.json'), '--round-dir', path.join(runRoot, pkg.reviewId, roundDirName(round))]);
  return {
    ok: ran.exitCode === 0,
    exitCode: ran.exitCode,
    status: ran.payload?.status ?? null,
    tally: ran.payload,
    tallyPath: path.join(runRoot, pkg.reviewId, roundDirName(round), 'tally.json'),
    stderr: ran.stderr,
  };
}

// The real finalize: fresh-ballot recheck inside the gate, then the report.
export function mechanicalFinalize(options = {}) {
  const { package: pkg, runRoot, round = 0, conclusion, nextPlan } = inputObject(options);
  reviewInputs(pkg, runRoot, round);
  if (typeof conclusion !== 'string' || conclusion.trim().length === 0) fail('CONCLUSION_REQUIRED', 'mechanicalFinalize requires a non-empty conclusion');
  if (typeof nextPlan !== 'string' || nextPlan.trim().length === 0) fail('PLAN_REQUIRED', 'mechanicalFinalize requires a non-empty next-step plan');
  const runDir = path.join(runRoot, pkg.reviewId);
  const conclusionFile = path.join(runDir, 'conclusion.md');
  const planFile = path.join(runDir, 'next-plan.md');
  const reportPath = path.join(runDir, 'final-report.md');
  for (const [file, content] of [[conclusionFile, conclusion + '\n'], [planFile, nextPlan + '\n']]) {
    try { fsSync.writeFileSync(file, content, { flag: 'wx' }); }
    catch (error) {
      if (error.code !== 'EEXIST') fail('FINALIZE_WRITE_FAILED', 'cannot preserve finalization material');
      if (!fsSync.readFileSync(file).equals(Buffer.from(content))) return { ok: false, exitCode: 2, error: 'FINALIZE_IMMUTABLE', reportPath };
    }
  }
  const tallyPath = path.join(runDir, roundDirName(round), 'tally.json');
  if (fsSync.existsSync(reportPath)) {
    const ok = recheckFinalize(runDir, tallyPath, reportPath);
    return { ok, exitCode: ok ? 0 : 2, reportPath };
  }
  const ran = runGate([
    'finalize',
    '--manifest', path.join(runDir, 'manifest.json'),
    '--tally', tallyPath,
    '--conclusion-file', conclusionFile,
    '--next-plan-file', planFile,
    '--output', reportPath,
    ...(round > 0 ? ['--debate-log', path.join(runDir, 'debate', roundDirName(round) + '.md')] : []),
  ]);
  return { ok: ran.exitCode === 0, exitCode: ran.exitCode, reportPath, stderr: ran.stderr };
}

// --- grill-me load-bearing questions (E03) -----------------------------------

export function openLoadBearingQuestions(questions) {
  if (!Array.isArray(questions) || questions.length === 0) {
    fail('QUESTION_INVALID', 'openLoadBearingQuestions requires a non-empty list of { id, question }');
  }
  const seen = new Set();
  return Object.freeze(questions.map((entry) => {
    if (!entry || typeof entry.id !== 'string' || entry.id.length === 0 || typeof entry.question !== 'string' || entry.question.trim().length === 0) {
      fail('QUESTION_INVALID', 'each load-bearing question needs a non-empty id and question');
    }
    if (seen.has(entry.id)) fail('QUESTION_INVALID', `duplicate load-bearing question id: ${entry.id}`);
    seen.add(entry.id);
    return Object.freeze({ id: entry.id, question: entry.question, closed: false, resolution: null });
  }));
}

export function closeLoadBearingQuestion(questions, id, resolution) {
  loadBearingStatus(questions);
  if (typeof resolution !== 'string' || resolution.trim().length === 0) {
    fail('RESOLUTION_REQUIRED', `closing ${String(id)} requires a real resolution, not an empty one`);
  }
  let found = false;
  const closed = (questions ?? []).map((entry) => {
    if (entry.id !== id) return entry;
    found = true;
    return entry.closed ? entry : Object.freeze({ ...entry, closed: true, resolution });
  });
  if (!found) fail('UNKNOWN_QUESTION', `no load-bearing question registered with id ${String(id)}`);
  return Object.freeze(closed);
}

export function loadBearingStatus(questions) {
  if (!Array.isArray(questions) || questions.some((entry) => !object(entry) || !text(entry.id) || !text(entry.question)
    || typeof entry.closed !== 'boolean' || entry.closed && !text(entry.resolution))
    || new Set(questions.map((entry) => entry.id)).size !== questions.length) fail('QUESTION_INVALID', 'grill questions must have unique identities and explicit closure evidence');
  const open = [];
  const closed = [];
  for (const entry of questions ?? []) (entry.closed ? closed : open).push(entry.id);
  return { open, closed };
}

// --- the pure judge -----------------------------------------------------------

// Re-judges a consensus run from its REAL files (manifest.json, tally.json,
// ballot-*.json, final-report.md). Structural drift between the frozen
// package and the run's manifest short-circuits the judgment: a broken
// agreement is refused before any tally is honored.
export function judgeArchitectureGate(options = {}) {
  const { package: pkg, runRoot, round = 0, questions = [] } = inputObject(options);
  reviewInputs(pkg, runRoot, round);
  loadBearingStatus(questions);
  const runDir = path.join(runRoot, pkg.reviewId);
  const receipt = {
    schema_version: 1,
    status: 'BLOCKED',
    decision: null,
    artifact_sha256: pkg.artifactSha256,
    review_id: pkg.reviewId,
    round: null,
    quorum: [...REVIEW_PARTICIPANTS],
    ballots: [],
    blocking_findings: [],
    nonblocking_findings: 0,
    raw_evidence_root: pkg.reviewId,
    mechanical_tally_sha256: null,
    final_report_sha256: null,
    adapters: ADAPTER_NOTE,
  };
  const refusals = [];
  const refuse = (code, detail) => refusals.push(Object.freeze({ code, detail }));

  // Structural agreement: the run must be exactly this frozen package.
  const manifestPath = path.join(runDir, 'manifest.json');
  const manifest = readJson(manifestPath);
  if (!manifest) {
    refuse('MECHANICAL_RUN_MISSING', `no consensus run manifest for ${pkg.reviewId} under ${runRoot}; only the real mechanical gate can produce one`);
    return frozenVerdict(receipt, refusals);
  }
  receipt.decision = manifest.decision ?? null;
  if (manifest.review_id !== pkg.reviewId || manifest.scope !== `frozen review package ${pkg.reviewId} (revision ${pkg.revision})`) {
    refuse('REVIEW_REVISION_MISMATCH', `run manifest belongs to review ${manifest.review_id}, not the frozen package ${pkg.reviewId} (revision ${pkg.revision}); a newer revision never inherits an older consensus (E04)`);
    return frozenVerdict(receipt, refusals);
  }
  if (manifest.artifact_sha256 !== pkg.artifactSha256) {
    refuse('PACKAGE_DIGEST_MISMATCH', `manifest artifact ${manifest.artifact_sha256} does not match the frozen package ${pkg.artifactSha256}`);
    return frozenVerdict(receipt, refusals);
  }
  if (typeof manifest.artifact !== 'string' || path.resolve(manifest.artifact) !== path.resolve(pkg.artifactPath)) {
    refuse('PACKAGE_PATH_MISMATCH', 'the mechanical manifest is not bound to the frozen artifact');
    return frozenVerdict(receipt, refusals);
  }
  try {
    if (sha256(fsSync.readFileSync(pkg.artifactPath)) !== pkg.artifactSha256) refuse('ARTIFACT_CHANGED', 'the frozen artifact changed after review');
  } catch { refuse('STALE_PACKAGE_ARTIFACT', 'the frozen artifact is unavailable'); }
  if (JSON.stringify(manifest.participants) !== JSON.stringify(REVIEW_PARTICIPANTS)) {
    refuse('QUORUM_DRIFT', `manifest participants ${JSON.stringify(manifest.participants)} drifted from the exact quorum`);
    return frozenVerdict(receipt, refusals);
  }
  if (!exact(manifest.thresholds, REVIEW_THRESHOLDS)) {
    refuse('THRESHOLD_DRIFT', `manifest thresholds ${JSON.stringify(manifest.thresholds)} drifted from the exact P0 thresholds ${JSON.stringify(REVIEW_THRESHOLDS)}`);
    return frozenVerdict(receipt, refusals);
  }
  if (JSON.stringify(manifest.criteria) !== JSON.stringify(ARCHITECTURE_CRITERIA)) {
    refuse('CRITERIA_DRIFT', `manifest criteria drifted from the exact architecture rubric`);
    return frozenVerdict(receipt, refusals);
  }

  // The mechanical verdict.
  const tallyPath = path.join(runDir, roundDirName(round), 'tally.json');
  const tally = readJson(tallyPath);
  if (!tally) {
    refuse('MECHANICAL_TALLY_REQUIRED', 'no mechanical tally exists for this run; the gate has not judged it');
    return frozenVerdict(receipt, refusals);
  }
  receipt.round = tally.round ?? null;
  receipt.mechanical_tally_sha256 = sha256(fsSync.readFileSync(tallyPath));
  if (tally.review_id !== manifest.review_id) refuse('TALLY_REVIEW_MISMATCH', `tally belongs to review ${tally.review_id}, manifest to ${manifest.review_id}`);
  if (tally.artifact_error) refuse('STALE_PACKAGE_ARTIFACT', String(tally.artifact_error));
  if (tally.artifact_changed) refuse('ARTIFACT_CHANGED', 'the frozen review package changed after the run was initialized; the votes no longer bind it (E04)');

  // Quorum: every participant present exactly once, all APPROVE.
  const missing = Array.isArray(tally.missing_agents) ? tally.missing_agents : [];
  if (missing.length > 0) refuse('MISSING_BALLOT', `missing ballots from: ${missing.join(', ')}`);
  const invalid = Array.isArray(tally.invalid_ballots) ? tally.invalid_ballots : [];
  if (invalid.length > 0) refuse('INVALID_BALLOT', `${invalid.length} ballot(s) failed the mechanical validation`);
  const approveVotes = tally.votes?.APPROVE ?? 0;
  const dissenters = Array.isArray(tally.dissenters) ? tally.dissenters : [];
  if (approveVotes !== REVIEW_PARTICIPANTS.length || dissenters.length > 0) {
    refuse('QUORUM_NOT_UNANIMOUS', `APPROVE votes ${approveVotes}/${REVIEW_PARTICIPANTS.length}${dissenters.length > 0 ? `; dissenters: ${dissenters.join(', ')}` : ''} — a majority never advances the architecture gate (E03)`);
  }

  // Ballots, re-read from disk: digest, thresholds, blockers.
  const roundDir = path.join(runDir, roundDirName(round));
  for (const participant of REVIEW_PARTICIPANTS) {
    const ballotPath = path.join(roundDir, `ballot-${participant}.json`);
    const ballot = readJson(ballotPath);
    if (!ballot) continue;
    const bytes = fsSync.readFileSync(ballotPath);
    receipt.ballots.push(Object.freeze({
      participant,
      verdict: ballot.verdict ?? null,
      score: Object.freeze({ criteria: Object.freeze({ ...(ballot.score?.criteria ?? {}) }), overall: ballot.score?.overall ?? null }),
      sha256: sha256(bytes),
      path: `${pkg.reviewId}/${roundDirName(round)}/ballot-${participant}.json`,
    }));
    if (ballot.review_id !== manifest.review_id) {
      refuse('BALLOT_REVIEW_MISMATCH', `ballot of ${participant} cites review ${ballot.review_id}, not this run's ${manifest.review_id}`);
    }
    if (ballot.artifact_sha256 !== manifest.artifact_sha256) {
      refuse('STALE_DIGEST', `ballot of ${participant} cites artifact ${ballot.artifact_sha256}, not the frozen ${manifest.artifact_sha256} — old ballots never bind a new package (E04)`);
    }
    if (typeof ballot.score?.overall !== 'number' || ballot.score.overall < REVIEW_THRESHOLDS.overall
      || ARCHITECTURE_CRITERIA.some((criterion) => (ballot.score?.criteria?.[criterion] ?? -1) < REVIEW_THRESHOLDS.criterion)) {
      refuse('THRESHOLD_SHORT', `ballot of ${participant} is below the exact thresholds (overall >= ${REVIEW_THRESHOLDS.overall}, every criterion >= ${REVIEW_THRESHOLDS.criterion})`);
    }
    for (const finding of Array.isArray(ballot.findings) ? ballot.findings : []) {
      if (finding?.blocking === true) {
        receipt.blocking_findings.push(Object.freeze({ agent: participant, ...finding }));
      } else {
        receipt.nonblocking_findings += 1;
      }
    }
  }
  if (receipt.blocking_findings.length > 0) {
    refuse('BLOCKING_FINDINGS', `unclosed blocker(s): ${receipt.blocking_findings.map((finding) => finding.id).join(', ')} — the gate cannot pass over an open blocker (E03)`);
  }

  // grill-me load-bearing questions: every one closed before passing.
  const openQuestions = loadBearingStatus(questions).open;
  if (openQuestions.length > 0) {
    refuse('LOAD_BEARING_OPEN', `grill-me load-bearing question(s) still open: ${openQuestions.join(', ')} — consensus alone does not advance the gate (E03)`);
  }

  // A passed receipt carries the real finalize report digest.
  const reportPath = path.join(runDir, 'final-report.md');
  if (fsSync.existsSync(reportPath)) {
    receipt.final_report_sha256 = sha256(fsSync.readFileSync(reportPath));
    if (refusals.length === 0 && !recheckFinalize(runDir, tallyPath, reportPath)) {
      refuse('MECHANICAL_RECHECK_FAILED', 'the real fresh-ballot finalize does not reproduce the recorded report');
    }
  } else if (refusals.length === 0) {
    refuse('FINAL_REPORT_REQUIRED', 'the mechanical consensus passed but was never finalized; no receipt without the real finalize output');
  }

  return frozenVerdict(receipt, refusals);
}

function frozenVerdict(receipt, refusals) {
  const status = refusals.length === 0 ? 'PASSED' : 'REFUSED';
  return Object.freeze({
    status,
    receipt: Object.freeze({ ...receipt, status: refusals.length === 0 ? 'PASSED' : 'BLOCKED', ballots: Object.freeze(receipt.ballots), blocking_findings: Object.freeze(receipt.blocking_findings) }),
    refusals: Object.freeze(refusals),
  });
}

// --- H06: the one review job the Comet run owns -------------------------------

// Component-only registration exercises one logical seat, with no managed
// authority. Production uses Native's existing pending intent. The job_key resumes the
// original job; a re-ballot round bumps the attempt; a changed package is a
// NEW revision with an independent manifest and supersedes the old job; the
// old job's records are kept, never rewritten.
export function createReviewJobSeat() {
  let current = null;
  const checkBinding = (options = {}) => {
    const { jobKey, reviewId, artifactSha256, revision, attempt = 1 } = inputObject(options);
    if (typeof jobKey !== 'string' || jobKey.length === 0 || typeof reviewId !== 'string' || reviewId.length === 0
      || !SHA256_RE.test(artifactSha256 ?? '') || !isPositiveInt(revision) || !isPositiveInt(attempt)) {
      fail('SEAT_BINDING_INVALID', 'the seat requires { jobKey, reviewId, artifactSha256, revision >= 1, attempt >= 1 }');
    }
  };
  const makeJob = ({ jobKey, reviewId, artifactSha256, revision, attempt }) => {
    const job = { jobKey, reviewId, artifactSha256, revision, attempt, completed: false, superseded: null };
    return job;
  };
  const view = (job) => Object.freeze({ ...job, scope: 'component/review-registration', managedClosureEligible: false });
  return Object.freeze({
    currentJob() {
      return current ? view(current) : null;
    },
    claim(binding) {
      checkBinding(binding);
      const { jobKey, reviewId, artifactSha256, revision, attempt = 1 } = binding;
      if (!current) {
        current = makeJob({ jobKey, reviewId, artifactSha256, revision, attempt });
        return { ok: true, resumed: false, job: view(current) };
      }
      if (current.jobKey !== jobKey) {
        return { ok: false, error: 'SINGLE_REVIEW_JOB', detail: `the run already holds review job ${current.jobKey} (${current.reviewId}); Comet holds exactly one review job, and a second is refused (H06)` };
      }
      if (current.reviewId === reviewId) {
        if (current.artifactSha256 !== artifactSha256 || current.revision !== revision) {
          return { ok: false, error: 'JOB_BINDING_CONFLICT', detail: `review ${reviewId} is already held with a different frozen package binding` };
        }
        if (attempt === current.attempt) {
          return { ok: true, resumed: true, job: view(current) };
        }
        if (attempt === current.attempt + 1) {
          current.attempt = attempt; // re-ballot round on the same manifest
          return { ok: true, resumed: true, job: view(current) };
        }
        return { ok: false, error: 'ATTEMPT_MISMATCH', detail: `held attempt is ${current.attempt}; claimed ${attempt}` };
      }
      if (revision <= current.revision) {
        return { ok: false, error: 'REVISION_REGRESSION', detail: `a new review must freeze revision > ${current.revision}; observed ${revision} — restoring old bytes does not reopen the old revision (E04)` };
      }
      const superseded = current.reviewId;
      current = makeJob({ jobKey, reviewId, artifactSha256, revision, attempt });
      current.superseded = superseded;
      return { ok: true, resumed: false, superseded, job: view(current) };
    },
    admitResult(binding) {
      const { jobKey, reviewId, artifactSha256, revision, attempt = 1, tally } = binding ?? {};
      checkBinding({ jobKey, reviewId, artifactSha256, revision, attempt });
      if (!current || current.jobKey !== jobKey) {
        return { ok: false, error: 'UNKNOWN_JOB', detail: `no held review job for ${String(jobKey)}; a late result is observed, never completing` };
      }
      if (reviewId !== current.reviewId) {
        return { ok: false, error: 'STALE_REVIEW', detail: `result belongs to review ${reviewId} but the held job is ${current.reviewId}; results of a superseded manifest cannot complete the new revision (H06)` };
      }
      if (artifactSha256 !== current.artifactSha256 || revision !== current.revision) {
        return { ok: false, error: 'STALE_INPUT', detail: 'the result is bound to another frozen package revision and cannot complete the held job (H06)' };
      }
      if (attempt < current.attempt) {
        return { ok: false, error: 'STALE_ATTEMPT', detail: `attempt ${attempt} arrived after attempt ${current.attempt}; late attempts are observed only (H06)` };
      }
      if (attempt > current.attempt) {
        return { ok: false, error: 'UNKNOWN_ATTEMPT', detail: `attempt ${attempt} was never issued; the held attempt is ${current.attempt}` };
      }
      if (!tally || typeof tally !== 'object') {
        return { ok: false, error: 'TALLY_REQUIRED', detail: 'only the real mechanical tally result can complete a review job' };
      }
      if (tally.review_id !== undefined && tally.review_id !== reviewId) {
        return { ok: false, error: 'TALLY_REVIEW_MISMATCH', detail: `tally cites review ${tally.review_id}, not ${reviewId}` };
      }
      if (tally.status !== 'PASSED') {
        return { ok: false, error: 'NOT_PASSED', detail: `mechanical status ${String(tally.status)} does not complete the job` };
      }
      current.completed = true;
      return { ok: true, completed: true, job: view(current), scope: 'component/review-registration', managedClosureEligible: false };
    },
  });
}

// --- consumption (rework P1-02/P1-03) -----------------------------------------

// Refusal record shaped like the seat's results: the caller observes the
// reason, nothing is thrown for expected refusals.
const boundary = { scope: 'component/completed-review-binding', managedClosureEligible: false };
const consumed = (extra) => ({ ...boundary, ok: true, consumed: true, ...extra });
const refused = (error, detail = error) => ({ ...boundary, ok: false, consumed: false, error, detail });
const bytes = (value) => Buffer.isBuffer(value) || value instanceof Uint8Array ? Buffer.from(value) : null;

function sourceReview(managed, authority, gate, role = 'reviewer', purpose = 'independent-acceptance') {
  if (!object(managed) || !object(managed.packet) || !object(managed.admissionOptions)
    || !object(authority) || typeof authority.verifyCollection !== 'function') return refused('PROTECTED_REVIEW_CONTEXT_REQUIRED');
  const action = parseContract('SDD.Delivery.ActionBinding', managed.actionBinding);
  const contract = parseContract('SDD.Delivery.TestContract', managed.testContract);
  const gateContract = parseContract('SDD.Delivery.TestContract', managed.gateTestContract ?? managed.testContract);
  const policy = managed.policy;
  if (!action.ok || !contract.ok || !gateContract.ok || contract.value.commandBindingsRequired !== true
    || gateContract.value.commandBindingsRequired !== true || !object(policy) || !text(policy.ref) || !SHA256_RE.test(policy.digest ?? '')
    || !text(managed.jobKey) || action.value.profile !== 'comet-managed-v2' || action.value.gate !== gate
    || action.value.role !== role || action.value.policyDigest !== policy.digest) return refused('PROTECTED_REVIEW_CONTEXT_REQUIRED');
  if (!exact(managed.packet.dispatch?.actionBinding, action.value)) return refused('STALE_ACTION_BINDING');
  let admitted;
  try {
    admitted = admitEvidence(managed.packet, { ...managed.admissionOptions, actionBinding: action.value,
      authority, requireManaged: true, purpose });
  } catch { return refused('INVALID_SOURCE_CONTEXT'); }
  if (!admitted.ok) return refused(admitted.error);
  if (managed.packet.envelope?.result !== 'pass') return refused('COMPLETED_REVIEW_REQUIRED');
  let result, trace;
  try {
    const resultBytes = bytes(managed.packet.resultBytes), traceBytes = bytes(managed.packet.methodTraceBytes);
    if (!resultBytes || !traceBytes || resultBytes.length > 1024 * 1024 || traceBytes.length > 1024 * 1024) return refused('REVIEW_BYTES_INVALID');
    result = JSON.parse(resultBytes.toString('utf8'));
    trace = JSON.parse(traceBytes.toString('utf8'));
  } catch { return refused('REVIEW_JSON_INVALID'); }
  if (!object(result) || !object(trace) || trace.schemaVersion !== 1 || trace.run !== action.value.run
    || trace.execution !== action.value.execution || trace.actionDigest !== envelopeDigest(action.value)
    || !Array.isArray(trace.methods) || trace.methods.length !== action.value.methods.length
    || trace.methods.some((method, index) => !object(method) || method.status !== 'completed'
      || !exact(Object.fromEntries(['name', 'version', 'ref', 'digest'].map((key) => [key, method[key]])), action.value.methods[index]))) return refused('METHOD_TRACE_REQUIRED');
  return { ok: true, managed, action: action.value, policy: structuredClone(policy), contract: structuredClone(contract.value),
    gateContract: structuredClone(gateContract.value), entry: admitted.entry, result, trace };
}

function protectedReviewDigest(current) {
  if (!object(current) || !object(current.admissionOptions)) return null;
  const options = current.admissionOptions;
  try {
    return envelopeDigest({ actionBinding: current.actionBinding, policy: current.policy, jobKey: current.jobKey,
      testContract: current.testContract, gateTestContract: current.gateTestContract ?? current.testContract,
      environment: options.environment, builderExecution: options.builderExecution, builderPrincipal: options.builderPrincipal,
      authoringExecutions: options.authoringExecutions, authoringPrincipals: options.authoringPrincipals,
      sourceQualification: options.sourceQualification, sourceBindings: current.sourceBindings ?? [] });
  } catch { return null; }
}

// Preparation runs in the original host's long readResult, outside its lock.
// The returned query holds immutable completed evidence, no job/phase state.
function completedReview(prepared, authority, sufficient, evidence) {
  const { action, policy, gateContract, entry } = prepared;
  const packet = entry.sourcePacket, collection = packet.collection;
  const protectedDigest = protectedReviewDigest(prepared.managed);
  const expiries = [packet.envelope.expiry, ...[prepared.managed.grill, ...(prepared.managed.reviewers ?? [])]
    .filter((item) => item?.packet).map((item) => item.packet.envelope?.expiry)];
  const identity = { collectionId: entry.collectionId, envelopeDigest: entry.digest, actionDigest: collection.actionDigest,
    reportDigest: collection.reportDigest, resultDigest: collection.resultDigest, methodTraceDigest: collection.methodTraceDigest };
  const result = Object.freeze({ ...boundary, ok: true, sufficient, evidenceDigest: envelopeDigest({ ...identity, evidence }),
    envelopeDigest: entry.digest, reportDigest: collection.reportDigest, actionDigest: collection.actionDigest,
    execution: entry.execution, principal: collection.source.facts.principal });
  const verifyReview = ({ entry: submitted, inputs, policy: currentPolicy } = {}, current) => {
    try {
      const now = Date.parse(current?.admissionOptions?.now);
      const qualifications = [current?.admissionOptions?.sourceQualification, ...(current?.sourceBindings ?? []).map((item) => item?.sourceQualification)];
      if (!protectedDigest || protectedReviewDigest(current) !== protectedDigest || !Number.isFinite(now)
        || [...expiries, ...qualifications.map((item) => item?.expiresAt)].some((value) => !Number.isFinite(Date.parse(value)) || Date.parse(value) <= now)
        || qualifications.some((item) => item?.scope !== 'protected-source' || item.status !== 'qualified')) return refused('STALE_PREPARED_REVIEW');
      if (!object(submitted) || !object(inputs) || inputs.inputDigest !== action.inputDigest
        || !exact(inputs.testContract, gateContract) || !exact(currentPolicy, policy)
        || submitted.class !== 'independent-acceptance' || submitted.collectionId !== identity.collectionId
        || submitted.digest !== identity.envelopeDigest || envelopeDigest(submitted.envelope) !== identity.envelopeDigest
        || !exact(submitted.dispatch?.actionBinding, action) || !authority.verifyDispatch(submitted.dispatch).ok) return refused('STALE_PREPARED_REVIEW');
      const source = submitted.sourcePacket;
      if (!object(source) || !exact(source.dispatch, submitted.dispatch) || !exact(source.envelope, submitted.envelope)
        || !authority.verifyCollection(source).ok || source.collection.collectionId !== identity.collectionId
        || ['actionDigest', 'reportDigest', 'resultDigest', 'methodTraceDigest'].some((key) => source.collection[key] !== identity[key])) return refused('STALE_PREPARED_REVIEW');
      return result;
    } catch { return refused('STALE_PREPARED_REVIEW'); }
  };
  return { ...boundary, ok: true, prepared: true, consumed: false, sufficient, execution: entry.execution, verifyReview };
}

function prepareTestDesignReview(managed, authority) {
  const prepared = sourceReview(managed, authority, 'T');
  if (!prepared.ok) return prepared;
  const { result, action, contract } = prepared;
  if (!action.inputs.some((input) => input.name === 'test-contract' && input.digest === envelopeDigest(contract))) return refused('TEST_CONTRACT_BINDING_REQUIRED');
  const cases = contract.cases.filter((item) => item.required !== false);
  if (result.schemaVersion !== 1 || result.candidateDigest !== action.inputDigest || result.contractDigest !== envelopeDigest(contract)
    || typeof result.sufficient !== 'boolean' || !text(result.summary) || !text(result.oracleStrength)
    || !Array.isArray(result.caseReviews) || result.caseReviews.length !== cases.length
    || new Set(result.caseReviews.map((item) => item?.caseId)).size !== cases.length
    || cases.some((item) => {
      const review = result.caseReviews.find((candidate) => candidate?.caseId === item.id);
      return !object(review) || !Array.isArray(review.checkIds) || !exact(review.checkIds, item.checkIds)
        || review.oracle !== item.oracle || typeof review.sufficient !== 'boolean' || !text(review.rationale);
    }) || !object(result.environmentReview) || result.environmentReview.digest !== action.environmentDigest
    || typeof result.environmentReview.sufficient !== 'boolean' || !text(result.environmentReview.rationale)
    || !object(result.cleanupReview) || result.cleanupReview.environment !== contract.cleanup.environment
    || result.cleanupReview.data !== contract.cleanup.data || typeof result.cleanupReview.sufficient !== 'boolean' || !text(result.cleanupReview.rationale)
    || !Array.isArray(result.findings) || result.findings.some((finding) => !object(finding) || !text(finding.id)
      || !text(finding.rationale) || typeof finding.blocking !== 'boolean')) return refused('SEMANTIC_REVIEW_REQUIRED');
  const sufficient = result.sufficient && ADEQUATE_ORACLE_STRENGTHS.includes(result.oracleStrength)
    && result.caseReviews.every((item) => item.sufficient) && result.environmentReview.sufficient && result.cleanupReview.sufficient
    && !result.findings.some((item) => item.blocking);
  return completedReview(prepared, authority, sufficient, { kind: 'independent-test-design-review', contractDigest: result.contractDigest });
}

function prepareArchitectureReview({ package: pkg, runRoot, round, questions, managed, authority }) {
  const prepared = sourceReview(managed, authority, 'A');
  if (!prepared.ok) return prepared;
  if (!Array.isArray(managed.reviewers) || managed.reviewers.length !== REVIEW_PARTICIPANTS.length
    || managed.reviewers.some((item) => !object(item) || !REVIEW_PARTICIPANTS.includes(item.participant))
    || new Set(managed.reviewers.map((item) => item.participant)).size !== REVIEW_PARTICIPANTS.length) return refused('REVIEWER_COLLECTIONS_REQUIRED');
  if (!Array.isArray(managed.sourceBindings) || managed.sourceBindings.some((item) => !object(item)
    || !parseContract('SDD.Delivery.ActionBinding', item.actionBinding).ok)
    || new Set(managed.sourceBindings.map((item) => item.actionBinding.execution)).size !== managed.sourceBindings.length
    || !object(managed.grill) || !object(managed.grill.packet)) return refused('CURRENT_REVIEW_SOURCES_REQUIRED');
  const { action, result } = prepared;
  const child = (packet, role) => {
    const binding = managed.sourceBindings.find((item) => item.actionBinding.execution === packet?.dispatch?.execution);
    if (!binding) return refused('CURRENT_REVIEW_SOURCES_REQUIRED');
    const current = binding.actionBinding;
    if (['profile', 'run', 'gate', 'revision', 'attempt', 'epoch', 'policyDigest', 'environmentDigest'].some((key) => current[key] !== action[key])
      || current.workPackage.id !== action.workPackage.id || role === 'reviewer' && current.inputDigest !== action.inputDigest) return refused('STALE_REVIEW_ACTION');
    return sourceReview({ ...managed, packet, actionBinding: current,
      admissionOptions: { ...managed.admissionOptions, sourceQualification: binding.sourceQualification } }, authority, 'A', role,
    role === 'architect' ? 'authoring-self-check' : 'independent-acceptance');
  };
  const grill = child(managed.grill.packet, 'architect');
  if (!grill.ok) return grill;
  const closure = grill.result;
  if (closure.schemaVersion !== 1 || !Array.isArray(closure.questions) || closure.questions.length === 0
    || closure.questions.some((item) => !object(item) || !text(item.id) || !text(item.question) || item.closed !== true || !text(item.resolution))
    || new Set(closure.questions.map((item) => item.id)).size !== closure.questions.length
    || !exact(questions, closure.questions) || !grill.action.methods.some((method) => method.name === 'grill-me')) return refused('LOAD_BEARING_OPEN');
  if (!object(pkg) || !text(pkg.reviewId) || !text(pkg.artifactPath) || !SHA256_RE.test(pkg.artifactSha256 ?? '')
    || !isPositiveInt(pkg.revision) || !Number.isInteger(round) || round < 0 || round > 2) return refused('PACKAGE_INVALID');
  const artifact = readJson(pkg.artifactPath);
  const grillDigest = sha256(bytes(managed.grill.packet.resultBytes));
  const bound = (name, digest) => action.inputs.some((input) => input.name === name && input.digest === digest);
  if (!object(artifact) || artifact.grillDigest !== grillDigest || artifact.requirementsDigest !== closure.requirementsDigest
    || artifact.designDigest !== closure.designDigest || !SHA256_RE.test(artifact.requirementsDigest ?? '') || !SHA256_RE.test(artifact.designDigest ?? '')
    || !bound('architecture-package', pkg.artifactSha256) || !bound('grill-closure', grillDigest)
    || !bound('requirements', artifact.requirementsDigest) || !bound('design', artifact.designDigest)
    || !grill.action.inputs.some((input) => input.name === 'requirements' && input.digest === artifact.requirementsDigest)
    || !grill.action.inputs.some((input) => input.name === 'design' && input.digest === artifact.designDigest)
    || !action.methods.some((method) => method.name === 'multi-agent-consensus-review')) return refused('FROZEN_REVIEW_BINDING_REQUIRED');
  const principals = new Set([grill.entry.sourcePacket.collection.source.facts.principal]);
  const executions = new Set([grill.entry.execution]);
  const reviewerDigests = [];
  for (const participant of REVIEW_PARTICIPANTS) {
    const source = managed.reviewers.find((item) => item.participant === participant);
    const reviewed = child(source.packet, 'reviewer');
    if (!reviewed.ok) return reviewed;
    const principal = reviewed.entry.sourcePacket.collection.source.facts.principal;
    if (principals.has(principal) || executions.has(reviewed.entry.execution)) return refused('REVIEWER_IDENTITY_CONFLICT');
    principals.add(principal); executions.add(reviewed.entry.execution);
    if (!exact(reviewed.action.inputs, action.inputs) || !reviewed.action.methods.some((method) => method.name === 'multi-agent-consensus-review')) return refused('FROZEN_REVIEW_BINDING_REQUIRED');
    const file = path.join(runRoot, pkg.reviewId, roundDirName(round), `ballot-${participant}.json`);
    try {
      if (!bytes(source.packet.resultBytes).equals(fsSync.readFileSync(file)) || reviewed.result.agent !== participant) return refused('BALLOT_SOURCE_MISMATCH');
    } catch { return refused('BALLOT_SOURCE_MISMATCH'); }
    reviewerDigests.push(reviewed.entry.collectionId);
  }
  const primaryPrincipal = prepared.entry.sourcePacket.collection.source.facts.principal;
  if (primaryPrincipal === grill.entry.sourcePacket.collection.source.facts.principal) return refused('REVIEWER_IDENTITY_CONFLICT');
  const judged = judgeArchitectureGate({ package: pkg, runRoot, round, questions: closure.questions });
  const runDir = path.join(runRoot, pkg.reviewId), tally = readJson(path.join(runDir, roundDirName(round), 'tally.json'));
  const manifest = readJson(path.join(runDir, 'manifest.json'));
  if (!object(manifest) || manifest.max_rounds !== 3 || !exact(manifest.thresholds, REVIEW_THRESHOLDS)
    || !exact(manifest.participants, REVIEW_PARTICIPANTS) || !exact(manifest.criteria, ARCHITECTURE_CRITERIA)) return refused('REVIEW_POLICY_DRIFT');
  const semanticRejection = judged.status === 'REFUSED' && tally?.status === 'DEBATE_REQUIRED'
    && judged.refusals.every((item) => ['QUORUM_NOT_UNANIMOUS', 'THRESHOLD_SHORT', 'BLOCKING_FINDINGS'].includes(item.code));
  if (judged.status !== 'PASSED' && !semanticRejection) return { ...refused('CONSENSUS_NOT_ADMITTED'), judged, refusals: judged.refusals };
  const reportDigest = judged.receipt.final_report_sha256;
  if (result.schemaVersion !== 1 || result.reviewId !== pkg.reviewId || result.artifactSha256 !== pkg.artifactSha256
    || result.revision !== pkg.revision || result.round !== round || result.grillDigest !== grillDigest
    || result.manifestDigest !== sha256(fsSync.readFileSync(path.join(runDir, 'manifest.json')))
    || result.tallyDigest !== judged.receipt.mechanical_tally_sha256 || result.finalReportDigest !== reportDigest
    || judged.status === 'PASSED' && sha256(bytes(managed.packet.reportBytes)) !== reportDigest) return refused('MECHANICAL_SOURCE_MISMATCH');
  return completedReview(prepared, authority, judged.status === 'PASSED', { kind: 'grill-exact-unanimous-consensus',
    reviewId: pkg.reviewId, revision: pkg.revision, round, manifestDigest: result.manifestDigest,
    tallyDigest: result.tallyDigest, finalReportDigest: reportDigest, grillCollection: grill.entry.collectionId, reviewerCollections: reviewerDigests });
}

// A gate: admit the architecture consensus through the REAL intake. The
// judged receipt (mechanical tally + finalize + grill closure) is consumed
// only when a trusted-launcher dispatch carries it, the dispatch binds the
// frozen artifactDigest, and the execution is not the builder's. Refusals of
// the mechanical judgment pass through unchanged — consumption never
// overrides the judgment, it only adds the origin and binding checks.
export function consumeArchitectureGate(options = {}) {
  const { package: pkg, runRoot, round = 0, questions = [], dispatch, authority, managed } = inputObject(options);
  if (managed !== undefined) return prepareArchitectureReview({ package: pkg, runRoot, round, questions, managed, authority });
  if (!pkg || !SHA256_RE.test(pkg.artifactSha256 ?? '')) return refused('PACKAGE_INVALID', 'consumeArchitectureGate requires a frozen package from freezeReviewPackage');
  if (!dispatch || !authority || typeof authority.verifyDispatch !== 'function') {
    return refused('UNREGISTERED_SOURCE', 'no authority-issued dispatch binds this consensus; a self-declared review is not a registered source (P1-02)');
  }
  const verified = authority.verifyDispatch(dispatch);
  if (!verified.ok) {
    return refused(verified.error, verified.error === 'MALFORMED_DISPATCH'
      ? `dispatch record is malformed: ${(verified.errors ?? []).join('; ')}`
      : 'dispatch record fails launcher integrity verification; only the trusted launcher can issue review dispatches (Runner.Dispatch.v1)');
  }
  if (dispatch.role === 'builder') {
    return refused('IDENTITY_CONFLICT', `builder execution ${dispatch.execution} cannot sign the architecture acceptance; the review must come from an independent execution`);
  }
  if (dispatch.inputDigest !== pkg.artifactSha256) {
    return refused('ARTIFACT_DIGEST_MISMATCH', `the dispatch binds artifact ${dispatch.inputDigest}, not the frozen package ${pkg.artifactSha256} — a one-shot authorization never covers other material (E04)`);
  }
  const judged = judgeArchitectureGate({ package: pkg, runRoot, round, questions });
  if (judged.status !== 'PASSED') {
    return { ...refused('CONSENSUS_NOT_ADMITTED', `the mechanical judgment is ${judged.status}, not a closed unanimous consensus`), judged, refusals: judged.refusals };
  }
  return consumed({ judged, refusals: judged.refusals, execution: dispatch.execution, dispatch });
}

// The attested oracle strengths the T gate admits; anything else (weak,
// unknown, missing) is refused — a weak oracle routes back to the test author.
export const ADEQUATE_ORACLE_STRENGTHS = Object.freeze(['strong', 'adequate']);

// T gate: consume ONE independent test design review — the sufficiency
// conclusion plus the attested oracle strength. There is no quorum surface
// here by construction: a single review object is the whole input, so T keeps
// its single automatic review and is never extended to the consensus quorum.
// The original one-shot dispatch authorization never covers new material: the
// dispatch must bind the current candidate and the review must cite it.
export function consumeTestDesignReview(options = {}) {
  const { dispatch, authority, current, review, authorExecution = null, managed } = inputObject(options);
  if (managed !== undefined) return prepareTestDesignReview(managed, authority);
  if (!dispatch || !authority || typeof authority.verifyDispatch !== 'function') {
    return refused('UNREGISTERED_SOURCE', 'no authority-issued dispatch binds this review; a self-declared test design review is not a registered source (P1-02)');
  }
  const verified = authority.verifyDispatch(dispatch);
  if (!verified.ok) {
    return refused(verified.error, verified.error === 'MALFORMED_DISPATCH'
      ? `dispatch record is malformed: ${(verified.errors ?? []).join('; ')}`
      : 'dispatch record fails launcher integrity verification; only the trusted launcher can issue review dispatches (Runner.Dispatch.v1)');
  }
  if (dispatch.role === 'builder') {
    return refused('IDENTITY_CONFLICT', `builder execution ${dispatch.execution} cannot sign the test design review`);
  }
  if (authorExecution !== null && dispatch.execution === authorExecution) {
    return refused('SELF_REVIEW', `execution ${dispatch.execution} authored the test design and cannot attest its own review; authoring self-checks never sign acceptance (B03)`);
  }
  if (!current || dispatch.inputDigest !== current.inputDigest) {
    return refused('STALE_AUTHORIZATION', `the dispatch binds candidate ${dispatch.inputDigest} but the current candidate is ${current?.inputDigest ?? 'unknown'} — the original one-shot authorization does not automatically cover new material (P1-03)`);
  }
  if (!review || typeof review !== 'object') {
    return refused('REVIEW_MATERIAL_MISMATCH', 'no review result is bound to the dispatch; only the real review can complete the job');
  }
  if (review.candidateDigest !== dispatch.inputDigest) {
    return refused('REVIEW_MATERIAL_MISMATCH', `the review cites candidate ${review.candidateDigest}, not the dispatched ${dispatch.inputDigest}`);
  }
  if (review.sufficient !== true) {
    return refused('SUFFICIENCY_CONCLUSION_REQUIRED', `the sufficiency conclusion is ${JSON.stringify(review.sufficient ?? null)}; the T gate consumes only an affirmative sufficiency conclusion`);
  }
  if (typeof review.summary !== 'string' || review.summary.trim().length === 0) {
    return refused('REVIEW_SUMMARY_REQUIRED', 'a sufficiency conclusion without a written review is not a conclusion');
  }
  if (!ADEQUATE_ORACLE_STRENGTHS.includes(review.oracleStrength)) {
    return refused('ORACLE_STRENGTH_REFUSED', `attested oracle strength ${JSON.stringify(review.oracleStrength ?? null)} is not admitted; only ${ADEQUATE_ORACLE_STRENGTHS.join(' | ')} consume, a weak oracle routes back to the test author`);
  }
  return consumed({ oracleStrength: review.oracleStrength, execution: dispatch.execution, dispatch });
}

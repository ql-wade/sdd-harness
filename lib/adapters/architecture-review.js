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
//   - the seat below is the ONE review job the Comet run owns: same job_key
//     resumes the original job, a second job is refused, results of stale
//     attempts or superseded manifests cannot complete a new revision, and a
//     new revision keeps an independent manifest (H06).
//
// Boundary: pure judgment + registration. The adapter never dispatches an
// agent, never writes phase or control state, and holds no second job —
// Comet.Run.managedDelivery.v1 and SDD.Gate.v1 are left untouched.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SHA256_RE = /^[a-f0-9]{64}$/;
const sha256 = (data) => createHash('sha256').update(data).digest('hex');

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

function runGate(args) {
  const result = spawnSync('python3', [GATE_SCRIPT, ...args], { encoding: 'utf8', timeout: 120_000 });
  let payload = null;
  try { payload = JSON.parse(result.stdout ?? ''); } catch { payload = null; }
  return { exitCode: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '', payload };
}

function readJson(file) {
  try {
    return JSON.parse(fsSync.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

// --- 2.5.a: freeze the review package ----------------------------------------

// The frozen package: the artifact's plain-content sha256 (the same digest
// review_gate.py records for file artifacts), bound to a monotonically
// increasing revision and the exact quorum/thresholds/rubric.
export function freezeReviewPackage({ reviewId, artifactPath, revision }) {
  if (typeof reviewId !== 'string' || reviewId.length === 0) {
    fail('PACKAGE_REVIEW_ID_INVALID', 'freezeReviewPackage requires a non-empty reviewId');
  }
  if (!isPositiveInt(revision)) {
    fail('PACKAGE_REVISION_INVALID', `freezeReviewPackage requires an integer revision >= 1; observed ${String(revision)}`);
  }
  let artifact = null;
  try {
    artifact = fsSync.statSync(artifactPath);
  } catch {
    artifact = null;
  }
  if (!artifact || !artifact.isFile()) {
    fail('ARTIFACT_MISSING', `the review package artifact does not exist or is not a regular file: ${String(artifactPath)}`);
  }
  return Object.freeze({
    reviewId,
    artifactPath,
    artifactSha256: sha256(fsSync.readFileSync(artifactPath)),
    revision,
    quorum: [...REVIEW_PARTICIPANTS],
    thresholds: { ...REVIEW_THRESHOLDS },
    criteria: [...ARCHITECTURE_CRITERIA],
  });
}

// --- the real mechanical gate drivers ----------------------------------------

// Initialize the consensus run for the frozen package. The gate itself
// refuses a held run directory (same job_key never re-reviews, H06).
export function initConsensusRun({ package: pkg, runRoot, initiator, decision, maxRounds = 3 }) {
  if (!pkg || typeof pkg.reviewId !== 'string' || !SHA256_RE.test(pkg.artifactSha256 ?? '') || !isPositiveInt(pkg.revision)) {
    fail('PACKAGE_INVALID', 'initConsensusRun requires a frozen package from freezeReviewPackage');
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
  const drift = (detail) => ({ ok: false, exitCode: 0, error: 'MANIFEST_PACKAGE_MISMATCH', detail, stderr: ran.stderr });
  if (!manifest) return drift('the gate wrote no readable manifest');
  if (manifest.review_id !== pkg.reviewId) return drift(`manifest review_id ${manifest.review_id} does not match the frozen package ${pkg.reviewId}`);
  if (manifest.artifact_sha256 !== pkg.artifactSha256) return drift('manifest artifact_sha256 does not match the frozen package digest');
  if (JSON.stringify(manifest.participants) !== JSON.stringify(REVIEW_PARTICIPANTS)) return drift('manifest participants drifted from the exact quorum');
  if (manifest.thresholds?.overall !== REVIEW_THRESHOLDS.overall || manifest.thresholds?.criterion !== REVIEW_THRESHOLDS.criterion) {
    return drift('manifest thresholds drifted from the exact P0 thresholds');
  }
  return { ok: true, exitCode: 0, manifest, runDir };
}

// Write one ballot into the round directory and let the REAL gate validate
// it. Refusals are the gate's own errors — the adapter adds nothing.
export function admitBallot({ package: pkg, runRoot, participant, ballot, round = 0 }) {
  if (!pkg || typeof pkg.reviewId !== 'string') fail('PACKAGE_INVALID', 'admitBallot requires a frozen package');
  if (!REVIEW_PARTICIPANTS.includes(participant)) {
    fail('PARTICIPANT_INVALID', `participant ${String(participant)} is not part of the exact quorum`);
  }
  if (!ballot || typeof ballot !== 'object') fail('BALLOT_INVALID', 'admitBallot requires a ballot object');
  const roundDir = path.join(runRoot, pkg.reviewId, roundDirName(round));
  fsSync.mkdirSync(roundDir, { recursive: true });
  const ballotPath = path.join(roundDir, `ballot-${participant}.json`);
  fsSync.writeFileSync(ballotPath, JSON.stringify(ballot, null, 2) + '\n');
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
export function mechanicalTally({ package: pkg, runRoot, round = 0 }) {
  if (!pkg || typeof pkg.reviewId !== 'string') fail('PACKAGE_INVALID', 'mechanicalTally requires a frozen package');
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
export function mechanicalFinalize({ package: pkg, runRoot, round = 0, conclusion, nextPlan }) {
  if (!pkg || typeof pkg.reviewId !== 'string') fail('PACKAGE_INVALID', 'mechanicalFinalize requires a frozen package');
  if (typeof conclusion !== 'string' || conclusion.trim().length === 0) fail('CONCLUSION_REQUIRED', 'mechanicalFinalize requires a non-empty conclusion');
  if (typeof nextPlan !== 'string' || nextPlan.trim().length === 0) fail('PLAN_REQUIRED', 'mechanicalFinalize requires a non-empty next-step plan');
  const runDir = path.join(runRoot, pkg.reviewId);
  const conclusionFile = path.join(runDir, 'conclusion.md');
  const planFile = path.join(runDir, 'next-plan.md');
  const reportPath = path.join(runDir, 'final-report.md');
  fsSync.writeFileSync(conclusionFile, conclusion + '\n');
  fsSync.writeFileSync(planFile, nextPlan + '\n');
  const ran = runGate([
    'finalize',
    '--manifest', path.join(runDir, 'manifest.json'),
    '--tally', path.join(runDir, roundDirName(round), 'tally.json'),
    '--conclusion-file', conclusionFile,
    '--next-plan-file', planFile,
    '--output', reportPath,
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
export function judgeArchitectureGate({ package: pkg, runRoot, round = 0, questions = [] }) {
  if (!pkg || typeof pkg.reviewId !== 'string' || !SHA256_RE.test(pkg.artifactSha256 ?? '') || !isPositiveInt(pkg.revision)) {
    fail('PACKAGE_INVALID', 'judgeArchitectureGate requires a frozen package from freezeReviewPackage');
  }
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
  if (manifest.review_id !== pkg.reviewId) {
    refuse('REVIEW_REVISION_MISMATCH', `run manifest belongs to review ${manifest.review_id}, not the frozen package ${pkg.reviewId} (revision ${pkg.revision}); a newer revision never inherits an older consensus (E04)`);
    return frozenVerdict(receipt, refusals);
  }
  if (manifest.artifact_sha256 !== pkg.artifactSha256) {
    refuse('PACKAGE_DIGEST_MISMATCH', `manifest artifact ${manifest.artifact_sha256} does not match the frozen package ${pkg.artifactSha256}`);
    return frozenVerdict(receipt, refusals);
  }
  if (JSON.stringify(manifest.participants) !== JSON.stringify(REVIEW_PARTICIPANTS)) {
    refuse('QUORUM_DRIFT', `manifest participants ${JSON.stringify(manifest.participants)} drifted from the exact quorum`);
    return frozenVerdict(receipt, refusals);
  }
  if (manifest.thresholds?.overall !== REVIEW_THRESHOLDS.overall || manifest.thresholds?.criterion !== REVIEW_THRESHOLDS.criterion) {
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

// A seat holds at most ONE review job (the Comet run's single review job;
// there is no second job and no dispatch here). The same job_key resumes the
// original job; a re-ballot round bumps the attempt; a changed package is a
// NEW revision with an independent manifest and supersedes the old job; the
// old job's records are kept, never rewritten.
export function createReviewJobSeat() {
  let current = null;
  const checkBinding = ({ jobKey, reviewId, artifactSha256, revision, attempt = 1 }) => {
    if (typeof jobKey !== 'string' || jobKey.length === 0 || typeof reviewId !== 'string' || reviewId.length === 0
      || !SHA256_RE.test(artifactSha256 ?? '') || !isPositiveInt(revision) || !isPositiveInt(attempt)) {
      fail('SEAT_BINDING_INVALID', 'the seat requires { jobKey, reviewId, artifactSha256, revision >= 1, attempt >= 1 }');
    }
  };
  const makeJob = ({ jobKey, reviewId, artifactSha256, revision, attempt }) => {
    const job = { jobKey, reviewId, artifactSha256, revision, attempt, completed: false, superseded: null };
    return job;
  };
  const view = (job) => Object.freeze({ ...job });
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
      return { ok: true, completed: true, job: view(current) };
    },
  });
}

// Architecture-review adapter (task P2_5, work packages 2.5.a/2.5.b; E03/E04/H06).
//
// The adapter binds architecture gate acceptance to an independent unanimous
// consensus over a FROZEN review package. The exact structure is replicated
// from the P0-era receipt artifact (openspec/changes/delivery-foundation-
// rearchitecture/architecture-review/receipt.json): three-party quorum
// [claude-code, zcode, codex-agent], per-criterion threshold 7.0, overall
// threshold 8.0, all-APPROVE, one shared artifact digest, zero blocking
// findings — and the mechanical tally/finalize are the REAL gate
// (.agents/skills/multi-agent-consensus-review/scripts/review_gate.py),
// executed as a subprocess in every test. Zero mocks: ballots are data, the
// judgment surface is the real script plus this adapter's pure judge.
//
// Boundaries honored here: the adapter is pure judgment + registration — it
// never dispatches an agent and never holds a second review job (the seat is
// the one job Comet owns); test T (SDD.Gate.v1) keeps its single automatic
// review and is never extended to the consensus quorum.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GATE_SCRIPT = path.join(projectRoot, '.agents/skills/multi-agent-consensus-review/scripts/review_gate.py');
const { REVIEW_PARTICIPANTS, REVIEW_THRESHOLDS, ARCHITECTURE_CRITERIA, ARCHITECTURE_REVIEW_BASELINE_KIND,
  freezeReviewPackage, initConsensusRun, admitBallot, mechanicalTally, mechanicalFinalize,
  openLoadBearingQuestions, closeLoadBearingQuestion, loadBearingStatus,
  judgeArchitectureGate, createReviewJobSeat } = await import(path.join(projectRoot, 'lib/adapters/architecture-review.js'));
const { admitEvidence, createLaunchAuthority } = await import(path.join(projectRoot, 'lib/delivery/evidence.js'));
const { evaluate } = await import(path.join(projectRoot, 'lib/delivery/gate.js'));
const { parseTapSummary } = await import(path.join(projectRoot, 'lib/delivery/test-contract.js'));
const { invalidateOnScopeChange } = await import(path.join(projectRoot, 'lib/delivery/baseline.js'));

const sha = (data) => crypto.createHash('sha256').update(data).digest('hex');
const shaFile = (file) => sha(fsSync.readFileSync(file));

// --- the exact P0 structure this adapter must replicate ----------------------
const P0_QUORUM = ['claude-code', 'zcode', 'codex-agent'];
const P0_THRESHOLDS = { overall: 8, criterion: 7 };
const P0_CRITERIA = ['requirements_fit', 'boundaries', 'reliability', 'security_operations', 'evolution_testability'];
const P0_RECEIPT_FIELDS = ['schema_version', 'status', 'decision', 'artifact_sha256', 'review_id', 'round',
  'quorum', 'ballots', 'blocking_findings', 'nonblocking_findings', 'raw_evidence_root',
  'mechanical_tally_sha256', 'final_report_sha256', 'adapters'];
const P0_BALLOT_FIELDS = ['participant', 'verdict', 'score', 'sha256', 'path'];

test('precondition: the real mechanical gate script is present', () => {
  assert.ok(fsSync.existsSync(GATE_SCRIPT), `review_gate.py missing at ${GATE_SCRIPT}`);
  assert.deepEqual(REVIEW_PARTICIPANTS, P0_QUORUM, 'quorum must be the exact P0 three-party quorum');
  assert.deepEqual(REVIEW_THRESHOLDS, P0_THRESHOLDS, 'thresholds must be the exact P0 thresholds');
  assert.deepEqual([...ARCHITECTURE_CRITERIA].sort(), [...P0_CRITERIA].sort(), 'criteria must be the exact P0 architecture criteria');
});

// --- fixtures ----------------------------------------------------------------
function makeTmp(label) {
  return fsSync.mkdtempSync(path.join(os.tmpdir(), label));
}

// A real frozen review package file: requirements + design digests are bound
// in the content, so any requirements/design change moves the artifact digest.
function writePackageFile(dir, { requirementsDigest, designDigest, note = 'frozen review package' }) {
  const file = path.join(dir, 'architecture-package.json');
  fsSync.writeFileSync(file, JSON.stringify({
    change: 'delivery-foundation-rearchitecture',
    scope: 'architecture gate acceptance for the delivery foundation',
    requirementsDigest,
    designDigest,
    note,
  }, null, 2) + '\n');
  return file;
}

function ballot({ reviewId, agent, artifactSha256, verdict = 'APPROVE', overall = 9, criteria, findings = [], round = 0, summary }) {
  return {
    review_id: reviewId,
    round,
    agent,
    artifact_sha256: artifactSha256,
    verdict,
    score: { overall, criteria: criteria ?? Object.fromEntries(P0_CRITERIA.map((name) => [name, 9])) },
    findings,
    assumptions: [],
    confidence: 0.9,
    summary: summary ?? (agent + ' independent cold-start architecture review'),
  };
}

const BLOCKING_FINDING = (id) => ({
  id, severity: 'BLOCKER',
  claim: 'a load-bearing boundary is unsubstantiated',
  evidence: 'the package shows no ownership for the failing path',
  recommendation: 'close the question or fix the design before passing',
  blocking: true,
});
const MINOR_FINDING = (id) => ({ ...BLOCKING_FINDING(id), severity: 'MINOR', claim: 'a minor note', blocking: false });

// Full real mechanical journey: freeze → init → 3 validated ballots → tally
// → finalize. Every step runs the real python gate; returns the run world.
function runConsensus({ dir, reviewId, requirementsDigest, designDigest, ballots, thresholdsOverride, finalize = true, questions = [] }) {
  fsSync.mkdirSync(dir, { recursive: true });
  const artifactPath = writePackageFile(dir, { requirementsDigest, designDigest });
  const pkg = freezeReviewPackage({ reviewId, artifactPath, revision: 1 });
  const runRoot = path.join(dir, 'review-runs');
  const init = initConsensusRun({ package: pkg, runRoot, initiator: 'claude-code' });
  assert.equal(init.ok, true, `init must succeed against the real gate: ${init.stderr ?? ''}`);
  const manifest = JSON.parse(fsSync.readFileSync(path.join(runRoot, reviewId, 'manifest.json'), 'utf8'));
  if (thresholdsOverride) { // a hand-relaxed manifest: the tamper negative
    manifest.thresholds = thresholdsOverride;
    fsSync.writeFileSync(path.join(runRoot, reviewId, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  }
  const admitted = (ballots ?? P0_QUORUM.map((agent) => ballot({ reviewId, agent, artifactSha256: pkg.artifactSha256 })))
    .map((paper) => admitBallot({ package: pkg, runRoot, participant: paper.agent, ballot: paper }));
  const tally = mechanicalTally({ package: pkg, runRoot });
  let fin = null;
  if (finalize && tally.ok) {
    fin = mechanicalFinalize({ package: pkg, runRoot, conclusion: 'architecture accepted on unanimous mechanical consensus', nextPlan: 'carry the non-blocking notes into implementation tasks' });
  }
  const judged = judgeArchitectureGate({ package: pkg, runRoot, questions });
  return { pkg, runRoot, init, manifest, admitted, tally, fin, judged };
}

const refusalCodes = (judged) => judged.refusals.map((refusal) => refusal.code);

// --- 2.5.a: freeze the review package, bind the exact quorum -----------------

test('freezeReviewPackage binds the real file digest deterministically and refuses invalid revisions', () => {
  const dir = makeTmp('sdd-p25-freeze-');
  const artifactPath = writePackageFile(dir, { requirementsDigest: sha('req-r1'), designDigest: sha('design-r1') });
  const pkg = freezeReviewPackage({ reviewId: 'arch-dfr-r1', artifactPath, revision: 1 });
  assert.equal(pkg.artifactSha256, shaFile(artifactPath), 'the frozen digest is the plain sha256 of the package bytes (same as review_gate.py digest_path for files)');
  assert.equal(pkg.reviewId, 'arch-dfr-r1');
  assert.equal(pkg.revision, 1);
  assert.deepEqual(freezeReviewPackage({ reviewId: 'arch-dfr-r1', artifactPath, revision: 1 }), pkg, 'identical inputs freeze an identical package');

  for (const bad of [0, -1, 1.5, '1', null]) {
    assert.throws(() => freezeReviewPackage({ reviewId: 'x', artifactPath, revision: bad }), /PACKAGE_REVISION_INVALID/, `revision ${String(bad)} must be refused`);
  }
  assert.throws(() => freezeReviewPackage({ reviewId: 'x', artifactPath: path.join(dir, 'missing.json'), revision: 1 }), /ARTIFACT_MISSING/);
});

test('the full mechanical journey passes and the receipt replicates the P0 receipt field-for-field', () => {
  const dir = makeTmp('sdd-p25-pass-');
  const { pkg, runRoot, manifest, tally, judged } = runConsensus({ dir, reviewId: 'arch-dfr-r1', requirementsDigest: sha('req-r1'), designDigest: sha('design-r1') });

  assert.equal(manifest.participants.length, 3, 'the real manifest carries the three-party quorum');
  assert.deepEqual(manifest.participants, P0_QUORUM);
  assert.deepEqual(manifest.thresholds, P0_THRESHOLDS, 'the real manifest carries the exact P0 thresholds');
  assert.equal(manifest.artifact_sha256, pkg.artifactSha256, 'the manifest binds the frozen package digest');
  assert.equal(tally.exitCode, 0, 'the real tally must exit 0 on unanimous approval');
  assert.equal(tally.status, 'PASSED');

  assert.equal(judged.status, 'PASSED');
  assert.deepEqual(refusalCodes(judged), [], 'a perfect run has no refusals');
  const receipt = judged.receipt;
  for (const field of P0_RECEIPT_FIELDS) assert.ok(field in receipt, `receipt must carry P0 field ${field}`);
  assert.deepEqual(Object.keys(receipt).sort(), [...P0_RECEIPT_FIELDS].sort(), 'the receipt must not carry fields beyond the P0 shape');
  assert.equal(receipt.schema_version, 1);
  assert.equal(receipt.status, 'PASSED');
  assert.equal(receipt.review_id, 'arch-dfr-r1');
  assert.deepEqual(receipt.quorum, P0_QUORUM);
  assert.equal(receipt.artifact_sha256, pkg.artifactSha256);
  assert.equal(receipt.blocking_findings.length, 0);
  assert.equal(receipt.round, 0);
  assert.equal(receipt.ballots.length, 3);
  for (const entry of receipt.ballots) {
    for (const field of P0_BALLOT_FIELDS) assert.ok(field in entry, `receipt ballot must carry P0 field ${field}`);
    assert.equal(entry.verdict, 'APPROVE', 'every ballot is APPROVE — all-APPROVE, not majority');
    assert.ok(fsSync.existsSync(path.join(runRoot, entry.path)), `ballot path resolves inside the run: ${entry.path}`);
    assert.equal(entry.sha256, shaFile(path.join(runRoot, entry.path)), 'ballot digest is the real file digest');
  }
  const runDir = path.join(runRoot, 'arch-dfr-r1');
  assert.equal(receipt.mechanical_tally_sha256, shaFile(path.join(runDir, 'round-00', 'tally.json')), 'the tally digest binds the real tally.json bytes');
  assert.equal(receipt.final_report_sha256, shaFile(path.join(runDir, 'final-report.md')), 'the report digest binds the real finalize output');
  assert.deepEqual(judgeArchitectureGate({ package: pkg, runRoot, questions: [] }), judged, 'the judge is deterministic over the same real files');
});

test('a hand-relaxed manifest (lowered thresholds or reduced quorum) is refused by the judge', () => {
  const relaxed = runConsensus({ dir: makeTmp('sdd-p25-relax-'), reviewId: 'arch-relax-r1', requirementsDigest: sha('req-r1'), designDigest: sha('design-r1'), thresholdsOverride: { overall: 6, criterion: 5 } });
  assert.deepEqual(refusalCodes(relaxed.judged), ['THRESHOLD_DRIFT'], 'the exact P0 thresholds cannot be quietly lowered');

  const dir = makeTmp('sdd-p25-quorum-');
  const { pkg, runRoot } = runConsensus({ dir, reviewId: 'arch-quorum-r1', requirementsDigest: sha('req-r1'), designDigest: sha('design-r1') });
  const manifestPath = path.join(runRoot, 'arch-quorum-r1', 'manifest.json');
  const manifest = JSON.parse(fsSync.readFileSync(manifestPath, 'utf8'));
  manifest.participants = ['claude-code', 'zcode'];
  fsSync.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  const rejudged = judgeArchitectureGate({ package: pkg, runRoot, questions: [] });
  assert.deepEqual(refusalCodes(rejudged), ['QUORUM_DRIFT'], 'a reduced quorum is refused — the three-party quorum is exact');
});

// --- E03: unclosed grill-me load-bearing questions and imperfect consensus ---

test('E03: an unclosed grill-me load-bearing question blocks the architecture gate even under unanimous PASSED consensus', () => {
  const dir = makeTmp('sdd-p25-e03-');
  const questions = openLoadBearingQuestions([
    { id: 'q-tenant', question: 'does the run state survive a second controller?' },
    { id: 'q-digest', question: 'is the package digest the substitution boundary?' },
  ]);
  assert.deepEqual(loadBearingStatus(questions), { open: ['q-tenant', 'q-digest'], closed: [] });
  const { judged } = runConsensus({ dir, reviewId: 'arch-e03-r1', requirementsDigest: sha('req-r1'), designDigest: sha('design-r1'), questions });
  assert.equal(judged.status, 'REFUSED');
  assert.deepEqual(refusalCodes(judged), ['LOAD_BEARING_OPEN'], 'the gate does not advance on consensus alone');

  const pkg = freezeReviewPackage({ reviewId: 'arch-e03-r1', artifactPath: path.join(dir, 'architecture-package.json'), revision: 1 });
  const runRoot = path.join(dir, 'review-runs');
  const closed = closeLoadBearingQuestion(questions, 'q-tenant', 'resolved: the single RunState owns the phase; adapter stores none');
  const stillOpen = judgeArchitectureGate({ package: pkg, runRoot, questions: closed });
  assert.deepEqual(refusalCodes(stillOpen), ['LOAD_BEARING_OPEN'], 'one open question is enough — partial closure does not pass');
  const allClosed = closeLoadBearingQuestion(closed, 'q-digest', 'resolved: artifact_sha256 is the boundary; ballots cite it');
  const accepted = judgeArchitectureGate({ package: pkg, runRoot, questions: allClosed });
  assert.equal(accepted.status, 'PASSED', 'closure of every load-bearing question admits the same consensus');

  assert.throws(() => closeLoadBearingQuestion(questions, 'q-unknown', 'x'), /UNKNOWN_QUESTION/, 'closing an unregistered question is refused');
  assert.throws(() => closeLoadBearingQuestion(questions, 'q-tenant', '   '), /RESOLUTION_REQUIRED/, 'closure without a real resolution is refused');
});

test('E03: absent ballot, majority-only approval, low score, blocking finding and stale-digest ballot each refuse the gate (real gate exits)', () => {
  // absent ballot → INCOMPLETE
  const absentPkg = freezeReviewPackage({ reviewId: 'arch-absent-r1', artifactPath: writePackageFile(makeTmp('sdd-p25-absent-pkg-'), { requirementsDigest: sha('req'), designDigest: sha('design') }), revision: 1 });
  const absent = runConsensus({
    dir: makeTmp('sdd-p25-absent-'), reviewId: 'arch-absent-r1', requirementsDigest: sha('req'), designDigest: sha('design'),
    ballots: P0_QUORUM.slice(0, 2).map((agent) => ballot({ reviewId: 'arch-absent-r1', agent, artifactSha256: absentPkg.artifactSha256 })),
  });
  assert.equal(absent.tally.exitCode, 1, 'the real tally exits 1 on a missing ballot');
  assert.equal(absent.tally.status, 'INCOMPLETE');
  assert.equal(absent.judged.status, 'REFUSED');
  assert.ok(refusalCodes(absent.judged).includes('MISSING_BALLOT'), 'missing ballot is named');

  // majority (2 of 3 APPROVE) → DEBATE_REQUIRED, never a pass
  const dir = makeTmp('sdd-p25-majority-');
  const artifactPath = writePackageFile(dir, { requirementsDigest: sha('req'), designDigest: sha('design') });
  const pkg = freezeReviewPackage({ reviewId: 'arch-majority-r1', artifactPath, revision: 1 });
  const runRoot = path.join(dir, 'review-runs');
  initConsensusRun({ package: pkg, runRoot, initiator: 'claude-code' });
  const votes = { 'claude-code': 'APPROVE', 'zcode': 'APPROVE', 'codex-agent': 'REJECT' };
  for (const agent of P0_QUORUM) {
    admitBallot({ package: pkg, runRoot, participant: agent, ballot: ballot({ reviewId: pkg.reviewId, agent, artifactSha256: pkg.artifactSha256, verdict: votes[agent] }) });
  }
  const majority = mechanicalTally({ package: pkg, runRoot });
  assert.equal(majority.exitCode, 1, 'the real tally exits 1 when one participant dissents');
  assert.equal(majority.status, 'DEBATE_REQUIRED', 'majority consent is a debate, not a pass');
  const majorityJudged = judgeArchitectureGate({ package: pkg, runRoot, questions: [] });
  assert.equal(majorityJudged.status, 'REFUSED');
  assert.ok(refusalCodes(majorityJudged).includes('QUORUM_NOT_UNANIMOUS'), 'majority votes do not advance the architecture gate');

  // low score (one overall 7.9 < 8.0)
  const lowPkg = freezeReviewPackage({ reviewId: 'arch-low-r1', artifactPath: writePackageFile(makeTmp('sdd-p25-low-pkg-'), { requirementsDigest: sha('req'), designDigest: sha('design') }), revision: 1 });
  const low = runConsensus({
    dir: makeTmp('sdd-p25-low-'), reviewId: 'arch-low-r1', requirementsDigest: sha('req'), designDigest: sha('design'),
    ballots: P0_QUORUM.map((agent, index) => ballot({ reviewId: 'arch-low-r1', agent, artifactSha256: lowPkg.artifactSha256, overall: index === 2 ? 7.9 : 9 })),
  });
  assert.equal(low.tally.exitCode, 1, 'the real tally exits 1 under threshold');
  assert.equal(low.judged.status, 'REFUSED');
  assert.ok(refusalCodes(low.judged).includes('THRESHOLD_SHORT'), 'below-threshold score is named');

  // blocking finding (unresolved blocker in one APPROVE ballot)
  const blockedPkg = freezeReviewPackage({ reviewId: 'arch-blocked-r1', artifactPath: writePackageFile(makeTmp('sdd-p25-blocked-pkg-'), { requirementsDigest: sha('req'), designDigest: sha('design') }), revision: 1 });
  const blocked = runConsensus({
    dir: makeTmp('sdd-p25-blocked-'), reviewId: 'arch-blocked-r1', requirementsDigest: sha('req'), designDigest: sha('design'),
    ballots: P0_QUORUM.map((agent, index) => ballot({ reviewId: 'arch-blocked-r1', agent, artifactSha256: blockedPkg.artifactSha256, findings: index === 1 ? [BLOCKING_FINDING('b-1')] : [MINOR_FINDING('n-' + index)] })),
  });
  assert.equal(blocked.tally.exitCode, 1, 'the real tally exits 1 with an open blocker');
  assert.equal(blocked.judged.status, 'REFUSED');
  assert.ok(refusalCodes(blocked.judged).includes('BLOCKING_FINDINGS'), 'the unclosed blocker is named');
  assert.ok(blocked.judged.receipt.blocking_findings.length === 1 && blocked.judged.receipt.blocking_findings[0].id === 'b-1', 'the blocker surfaces in the receipt');

  // stale-digest ballot (a vote on a different artifact revision)
  const staleDir = makeTmp('sdd-p25-stale-');
  const stalePath = writePackageFile(staleDir, { requirementsDigest: sha('req'), designDigest: sha('design') });
  const stalePkg = freezeReviewPackage({ reviewId: 'arch-stale-r1', artifactPath: stalePath, revision: 1 });
  const staleRoot = path.join(staleDir, 'review-runs');
  initConsensusRun({ package: stalePkg, runRoot: staleRoot, initiator: 'claude-code' });
  const oldDigest = sha('design-old-revision');
  admitBallot({ package: stalePkg, runRoot: staleRoot, participant: 'claude-code', ballot: ballot({ reviewId: 'arch-stale-r1', agent: 'claude-code', artifactSha256: oldDigest }) });
  const staleAdmit = admitBallot({ package: stalePkg, runRoot: staleRoot, participant: 'zcode', ballot: ballot({ reviewId: 'arch-stale-r1', agent: 'zcode', artifactSha256: oldDigest }) });
  assert.equal(staleAdmit.ok, false, 'a ballot citing a foreign digest is refused at admission');
  assert.match(staleAdmit.errors.join(' '), /artifact_sha256|digest/i, 'the refusal names the digest mismatch');
  const staleTally = mechanicalTally({ package: stalePkg, runRoot: staleRoot });
  assert.equal(staleTally.exitCode, 1, 'the real tally refuses the run with stale-digest ballots');
  const staleJudged = judgeArchitectureGate({ package: stalePkg, runRoot: staleRoot, questions: [] });
  assert.equal(staleJudged.status, 'REFUSED');
  assert.ok(refusalCodes(staleJudged).includes('STALE_DIGEST'), 'old-digest ballots are named as stale');
});

test('a review package edited after init is caught by the real tally (artifact_changed) and refused', () => {
  const dir = makeTmp('sdd-p25-drift-');
  const { pkg, runRoot } = runConsensus({ dir, reviewId: 'arch-drift-r1', requirementsDigest: sha('req'), designDigest: sha('design'), finalize: false });
  writePackageFile(dir, { requirementsDigest: sha('req'), designDigest: sha('design-CHANGED') }); // the artifact moves under the frozen run
  const drift = mechanicalTally({ package: pkg, runRoot });
  assert.equal(drift.exitCode, 1, 'the real tally exits 1 when the frozen artifact changed');
  assert.equal(drift.status, 'BLOCKED');
  assert.equal(drift.tally.artifact_changed, true, 'the tally records artifact_changed');
  const judged = judgeArchitectureGate({ package: pkg, runRoot, questions: [] });
  assert.equal(judged.status, 'REFUSED');
  assert.ok(refusalCodes(judged).includes('ARTIFACT_CHANGED'), 'the drift is named');
});

// --- E04: requirements/design change conservatively invalidates --------------

test('E04: a design change invalidates every old ballot for the new package; the real gate refuses mixing them in', () => {
  const dir = makeTmp('sdd-p25-e04-');
  const first = runConsensus({ dir: path.join(dir, 'r1'), reviewId: 'arch-e04-r1', requirementsDigest: sha('req-r1'), designDigest: sha('design-r1') });
  assert.equal(first.judged.status, 'PASSED', 'precondition: revision 1 passed');

  // design changes → new frozen revision, cold start
  const newArtifact = writePackageFile(dir, { requirementsDigest: sha('req-r1'), designDigest: sha('design-r2') });
  const pkg2 = freezeReviewPackage({ reviewId: 'arch-e04-r2', artifactPath: newArtifact, revision: 2 });
  assert.notEqual(pkg2.artifactSha256, first.pkg.artifactSha256, 'the design change moved the frozen digest');

  const runRoot2 = path.join(dir, 'r2', 'review-runs');
  initConsensusRun({ package: pkg2, runRoot: runRoot2, initiator: 'claude-code' });
  // every old ballot is invalid for the new review package — the real gate
  // refuses them by review_id, so they can never be mixed into the new round
  for (const agent of P0_QUORUM) {
    const oldPaper = ballot({ reviewId: 'arch-e04-r1', agent, artifactSha256: first.pkg.artifactSha256 });
    const outcome = admitBallot({ package: pkg2, runRoot: runRoot2, participant: agent, ballot: oldPaper });
    assert.equal(outcome.ok, false, `old ballot of ${agent} is refused for the new package`);
    assert.match(outcome.errors.join(' '), /review_id/i, 'the real gate names the review_id mismatch');
  }
  const coldTally = mechanicalTally({ package: pkg2, runRoot: runRoot2 });
  assert.equal(coldTally.exitCode, 1, 'the real tally refuses the cold-start round: only stale ballots are present');
  assert.equal(coldTally.status, 'INCOMPLETE');
  const judged2 = judgeArchitectureGate({ package: pkg2, runRoot: runRoot2, questions: [] });
  assert.equal(judged2.status, 'REFUSED', 'the new revision cold-starts: no inherited approval');
  assert.ok(refusalCodes(judged2).includes('MISSING_BALLOT'), 'the new round has no valid ballots of its own');
  assert.ok(refusalCodes(judged2).includes('INVALID_BALLOT'), 'the forwarded old ballots count only as invalid');

  // the old receipt, presented as the new package's evidence (its run dir
  // forwarded under the new revision's name), is refused by review identity
  fsSync.cpSync(path.join(first.runRoot, 'arch-e04-r1'), path.join(first.runRoot, 'arch-e04-r2'), { recursive: true });
  const oldReceiptOnNew = judgeArchitectureGate({ package: pkg2, runRoot: first.runRoot, questions: [] });
  assert.equal(oldReceiptOnNew.status, 'REFUSED');
  assert.ok(refusalCodes(oldReceiptOnNew).includes('REVIEW_REVISION_MISMATCH'), 'an old run manifest never satisfies a new frozen package');
  assert.match(fsSync.readFileSync(path.join(first.runRoot, 'arch-e04-r1', 'round-00', 'ballot-claude-code.json'), 'utf8'), /arch-e04-r1/, 'old ballots are untouched on disk — no digest rewriting');
});

test('E04: restoring the old design bytes does not auto-revive the old consensus; downstream evidence bound to the review is invalidated', () => {
  const dir = makeTmp('sdd-p25-revive-');
  const first = runConsensus({ dir: path.join(dir, 'r1'), reviewId: 'arch-e04-r1', requirementsDigest: sha('req-r1'), designDigest: sha('design-r1') });
  const changed = writePackageFile(dir, { requirementsDigest: sha('req-r1'), designDigest: sha('design-r2') });
  const pkg2 = freezeReviewPackage({ reviewId: 'arch-e04-r2', artifactPath: changed, revision: 2 });

  // restore the exact old bytes (same digest) — but the revision moved
  const restored = writePackageFile(dir, { requirementsDigest: sha('req-r1'), designDigest: sha('design-r1') });
  const pkg3 = freezeReviewPackage({ reviewId: 'arch-e04-r3', artifactPath: restored, revision: 3 });
  assert.equal(pkg3.artifactSha256, first.pkg.artifactSha256, 'the restored bytes digest back to the original');

  // the real presentation path: the old run directory forwarded under the new
  // revision's name — the judge refuses it by review identity, not by digest
  const forwarded = path.join(first.runRoot, 'arch-e04-r3');
  fsSync.cpSync(path.join(first.runRoot, 'arch-e04-r1'), forwarded, { recursive: true });
  const oldReceiptJudged = judgeArchitectureGate({ package: pkg3, runRoot: first.runRoot, questions: [] });
  assert.equal(oldReceiptJudged.status, 'REFUSED', 'restoring the digest does not auto-revive the old receipt');
  assert.ok(refusalCodes(oldReceiptJudged).includes('REVIEW_REVISION_MISMATCH'), 'the old review never matches a newer frozen revision');

  // downstream evidence bound to the architecture review follows the same
  // conservative invalidation (P2_1 baseline semantics, reused unmodified)
  const downstream = [
    { id: 'gate-receipt-on-review', boundDigests: { [ARCHITECTURE_REVIEW_BASELINE_KIND]: first.pkg.artifactSha256 }, boundRevisions: { [ARCHITECTURE_REVIEW_BASELINE_KIND]: 1 } },
    { id: 'unrelated-product-receipt', boundDigests: { product: sha('product-r1') } },
  ];
  const result = invalidateOnScopeChange({ changed: { kind: ARCHITECTURE_REVIEW_BASELINE_KIND, digest: pkg2.artifactSha256, revision: 2 }, receipts: downstream });
  assert.deepEqual(result.invalidated.map((entry) => entry.id), ['gate-receipt-on-review'], 'all downstream evidence bound to the review is invalidated by the design change');
  assert.deepEqual(result.valid.map((entry) => entry.id), ['unrelated-product-receipt'], 'receipts bound to other baselines keep their validity');
});

// --- H06: one review job per Comet; resume, supersede and stale results ------

test('H06: the seat holds exactly one review job — same job_key resumes it and a second job is refused', () => {
  const seat = createReviewJobSeat();
  assert.equal(seat.currentJob(), null, 'a fresh seat holds no job');
  const pkg = { reviewId: 'arch-h06-r1', artifactSha256: sha('pkg-r1'), revision: 1 };
  const first = seat.claim({ jobKey: 'architecture-review:dfr', reviewId: pkg.reviewId, artifactSha256: pkg.artifactSha256, revision: pkg.revision });
  assert.equal(first.ok, true);
  assert.equal(first.resumed, false, 'the first claim holds the job');

  const resume = seat.claim({ jobKey: 'architecture-review:dfr', reviewId: pkg.reviewId, artifactSha256: pkg.artifactSha256, revision: pkg.revision });
  assert.equal(resume.ok, true);
  assert.equal(resume.resumed, true, 'the same job_key resumes the original job');
  assert.deepEqual(resume.job, first.job, 'resuming returns the same job, not a second one');

  const second = seat.claim({ jobKey: 'architecture-review:other-change', reviewId: 'arch-other-r1', artifactSha256: sha('other'), revision: 1 });
  assert.equal(second.ok, false, 'a second review job is refused');
  assert.equal(second.error, 'SINGLE_REVIEW_JOB', 'Comet holds only one review job');
  assert.deepEqual(seat.currentJob(), first.job, 'the original job is untouched by the refused claim');
});

test('H06: stale attempts and superseded revisions cannot complete the job; a new revision keeps an independent manifest', () => {
  const seat = createReviewJobSeat();
  const key = 'architecture-review:dfr';
  seat.claim({ jobKey: key, reviewId: 'arch-h06-r1', artifactSha256: sha('pkg-r1'), revision: 1 });
  assert.equal(seat.claim({ jobKey: key, reviewId: 'arch-h06-r1', artifactSha256: sha('pkg-r1'), revision: 1, attempt: 2 }).ok, true, 'a re-ballot round bumps the attempt on the same job');

  const lateAttempt = seat.admitResult({ jobKey: key, reviewId: 'arch-h06-r1', artifactSha256: sha('pkg-r1'), revision: 1, attempt: 1, tally: { status: 'PASSED' } });
  assert.equal(lateAttempt.ok, false, 'a late result of the old attempt cannot complete the job');
  assert.equal(lateAttempt.error, 'STALE_ATTEMPT');

  const wrongDigest = seat.admitResult({ jobKey: key, reviewId: 'arch-h06-r1', artifactSha256: sha('pkg-OLD'), revision: 1, attempt: 2, tally: { status: 'PASSED' } });
  assert.equal(wrongDigest.ok, false, 'a result bound to another input digest cannot complete the job');
  assert.equal(wrongDigest.error, 'STALE_INPUT');

  const notPassed = seat.admitResult({ jobKey: key, reviewId: 'arch-h06-r1', artifactSha256: sha('pkg-r1'), revision: 1, attempt: 2, tally: { status: 'DEBATE_REQUIRED' } });
  assert.equal(notPassed.ok, false, 'a non-PASSED mechanical result does not complete the job');

  // the design moves → a new revision with an independent manifest supersedes
  const superseded = seat.claim({ jobKey: key, reviewId: 'arch-h06-r2', artifactSha256: sha('pkg-r2'), revision: 2 });
  assert.equal(superseded.ok, true);
  assert.equal(superseded.resumed, false, 'the new revision is a new job, not a resume');
  assert.equal(superseded.superseded, 'arch-h06-r1', 'the old job is superseded, its record kept');
  assert.equal(seat.currentJob().reviewId, 'arch-h06-r2');

  const oldManifest = seat.admitResult({ jobKey: key, reviewId: 'arch-h06-r1', artifactSha256: sha('pkg-r1'), revision: 1, attempt: 2, tally: { status: 'PASSED' } });
  assert.equal(oldManifest.ok, false, 'a result of the superseded manifest cannot complete the new task');
  assert.equal(oldManifest.error, 'STALE_REVIEW');

  const regression = seat.claim({ jobKey: key, reviewId: 'arch-h06-r3', artifactSha256: sha('pkg-r3'), revision: 1 });
  assert.equal(regression.ok, false, 'a new review must be a new revision — no revision regression');
  assert.equal(regression.error, 'REVISION_REGRESSION');

  const complete = seat.admitResult({ jobKey: key, reviewId: 'arch-h06-r2', artifactSha256: sha('pkg-r2'), revision: 2, attempt: 1, tally: { status: 'PASSED', review_id: 'arch-h06-r2' } });
  assert.equal(complete.ok, true, 'the matching mechanical PASSED result completes the current job');
  assert.equal(complete.completed, true);
  assert.equal(seat.currentJob().completed, true);
});

test('H06: re-initializing the same review run is refused by the real gate (no duplicate review)', () => {
  const dir = makeTmp('sdd-p25-dupe-');
  const artifactPath = writePackageFile(dir, { requirementsDigest: sha('req'), designDigest: sha('design') });
  const pkg = freezeReviewPackage({ reviewId: 'arch-dupe-r1', artifactPath, revision: 1 });
  const runRoot = path.join(dir, 'review-runs');
  const first = initConsensusRun({ package: pkg, runRoot, initiator: 'claude-code' });
  assert.equal(first.ok, true);
  const second = initConsensusRun({ package: pkg, runRoot, initiator: 'claude-code' });
  assert.equal(second.ok, false, 'the real gate refuses to re-init a held run');
  assert.match(second.stderr, /already exists/i, 'the real refusal names the existing run directory');
  const paper = ballot({ reviewId: pkg.reviewId, agent: 'claude-code', artifactSha256: pkg.artifactSha256 });
  const admitted = admitBallot({ package: pkg, runRoot, participant: 'claude-code', ballot: paper });
  assert.equal(admitted.ok, true, 'the original job continues on its own manifest after the refused duplicate');
});

// --- boundary: test T keeps its single automatic review ----------------------

const PASSING_TEST = [
  "import assert from 'node:assert/strict';",
  "import test from 'node:test';",
  "test('observed behavior matches the oracle', () => {",
  '  assert.equal(2 + 2, 4);',
  '});',
  '',
].join('\n');

test('boundary: test T stays a single automatic review — the delivery gate is not extended to the consensus quorum', () => {
  // one real node --test run, one verifier receipt → the delivery gate passes
  const root = makeTmp('sdd-p25-tboundary-');
  fsSync.writeFileSync(path.join(root, 'pass.test.js'), PASSING_TEST);
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const raw = spawnSync(process.execPath, ['--test', 'pass.test.js'], { cwd: root, encoding: 'utf8', timeout: 60_000, env });
  assert.equal(raw.status, 0, 'precondition: the real automatic review run passes');
  const artifactDir = makeTmp('sdd-p25-tartifact-');
  const artifactPath = path.join(artifactDir, 'run.tap.txt');
  fsSync.writeFileSync(artifactPath, raw.stdout ?? '');
  const summary = parseTapSummary(raw.stdout ?? '');
  assert.ok((summary?.pass ?? 0) > 0, 'precondition: real TAP executions observed');
  const NOW = '2026-10-20T12:00:00.000Z';
  const INPUT = sha('t-boundary-input');
  const POLICY = { ref: 'policy/managed-pilot', digest: sha('policy/managed-pilot@r1') };
  const envelope = {
    schemaVersion: 1,
    candidateDigest: INPUT,
    caseId: 'c1',
    check: 'unit:node:test',
    origin: { kind: 'registered-runner', id: 'runner-1' },
    execution: { id: 'exec-verifier-t' },
    environment: 'local-node-test-env',
    toolchain: `node ${process.version}`,
    executions: { total: summary.tests, valid: (summary.pass ?? 0) + (summary.fail ?? 0) },
    result: 'pass',
    evidence: [{ uri: 'run.tap.txt', sha256: shaFile(artifactPath) }],
    expiry: '2026-11-01T00:00:00.000Z',
  };
  const launcher = createLaunchAuthority({ secret: crypto.randomBytes(32).toString('hex') });
  const dispatch = launcher.issueDispatch({
    runnerId: 'runner-1', run: 'run-1', gate: 'V', inputDigest: INPUT, policyDigest: POLICY.digest,
    attempt: 1, epoch: 1, role: 'verifier', execution: 'exec-verifier-t',
  });
  const admitted = admitEvidence({ envelope, dispatch, authority: launcher, current: { inputDigest: INPUT, policyDigest: POLICY.digest, environment: 'local-node-test-env' }, now: NOW });
  assert.equal(admitted.ok, true, `precondition: the single automatic review evidence admits: ${admitted.reason ?? ''}`);
  const gateResult = evaluate({
    inputDigest: INPUT,
    testContract: {
      schemaVersion: 1, project: 'sdd-harness', change: 'delivery-foundation-rearchitecture',
      cases: [{ id: 'c1', ac: 'E03', oracle: 'boundary: the automatic test review is not a consensus' }],
      requiredChecks: [{ level: 'unit', capability: 'unit:node:test' }],
      executionDenominator: { totalCases: 1 },
      cleanup: { environment: 'temp dirs removed', data: 'none persisted' },
      dependencyBaselines: [{ kind: 'product', digest: sha('product-r1') }],
    },
    builderExecution: 'exec-builder-1',
  }, [admitted.entry], POLICY);
  assert.equal(gateResult.verdict, 'pass', 'test T passes with ONE independent receipt — no quorum is imposed on it');

  // and that single receipt can never stand in for the architecture consensus:
  // without a real mechanical run the judge refuses outright.
  const shortcutPkg = freezeReviewPackage({ reviewId: 'arch-shortcut-r1', artifactPath: writePackageFile(makeTmp('sdd-p25-short-'), { requirementsDigest: sha('r'), designDigest: sha('d') }), revision: 1 });
  const empty = judgeArchitectureGate({ package: shortcutPkg, runRoot: makeTmp('sdd-p25-empty-'), questions: [] });
  assert.equal(empty.status, 'REFUSED');
  assert.deepEqual(refusalCodes(empty), ['MECHANICAL_RUN_MISSING'], 'a single automatic review cannot be substituted for the unanimous mechanical consensus');
});

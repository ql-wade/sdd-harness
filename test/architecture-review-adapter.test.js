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
import test, { afterEach } from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GATE_SCRIPT = path.join(projectRoot, '.agents/skills/multi-agent-consensus-review/scripts/review_gate.py');
const { REVIEW_PARTICIPANTS, REVIEW_THRESHOLDS, ARCHITECTURE_CRITERIA, ARCHITECTURE_REVIEW_BASELINE_KIND,
  freezeReviewPackage, initConsensusRun, admitBallot, mechanicalTally, mechanicalFinalize,
  openLoadBearingQuestions, closeLoadBearingQuestion, loadBearingStatus,
  judgeArchitectureGate, createReviewJobSeat, buildGateReceiptBundle } = await import(path.join(projectRoot, 'lib/adapters/architecture-review.js'));
const { admitEvidence, createLaunchAuthority, envelopeDigest } = await import(path.join(projectRoot, 'lib/delivery/evidence.js'));
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
const privateRoots = new Set();
function makeTmp(label) {
  const directory = fsSync.mkdtempSync(path.join(os.tmpdir(), label));
  privateRoots.add(directory);
  return directory;
}
afterEach(() => {
  for (const directory of privateRoots) fsSync.rmSync(directory, { recursive: true, force: true });
  privateRoots.clear();
});

// A real frozen review package file: requirements + design digests are bound
// in the content, so any requirements/design change moves the artifact digest.
function writePackageFile(dir, { requirementsDigest, designDigest, note = 'frozen review package' }) {
  fsSync.mkdirSync(dir, { recursive: true });
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

test('a passed tally without the real finalize output refuses with exactly FINAL_REPORT_REQUIRED, and finalizing the same run admits it', () => {
  const dir = makeTmp('sdd-p25-nofinal-');
  // real mechanical journey without finalize: tally exit 0, refusals empty, no report
  const { pkg, runRoot, tally } = runConsensus({ dir, reviewId: 'arch-nofinal-r1', requirementsDigest: sha('req'), designDigest: sha('design'), finalize: false });
  assert.equal(tally.exitCode, 0, 'precondition: the mechanical tally itself passed');
  const judged = judgeArchitectureGate({ package: pkg, runRoot, questions: [] });
  assert.equal(judged.status, 'REFUSED');
  assert.deepEqual(refusalCodes(judged), ['FINAL_REPORT_REQUIRED'], 'no receipt without the real finalize output');
  assert.equal(judged.receipt.final_report_sha256, null, 'the receipt carries no fabricated report digest');

  // finalizing the SAME run admits it — the refusal is completable, not fatal
  const fin = mechanicalFinalize({ package: pkg, runRoot, conclusion: 'unanimous approval finalized after the gate demanded the report', nextPlan: 'non-blocking notes tracked in implementation tasks' });
  assert.equal(fin.ok, true, `real finalize: ${fin.stderr ?? ''}`);
  const accepted = judgeArchitectureGate({ package: pkg, runRoot, questions: [] });
  assert.equal(accepted.status, 'PASSED');
  assert.equal(accepted.receipt.final_report_sha256, shaFile(path.join(runRoot, 'arch-nofinal-r1', 'final-report.md')));
  assert.deepEqual(refusalCodes(accepted), []);
});

test('completed consensus rechecks current artifact, ballots and finalize bytes without rewriting the original evidence', () => {
  const changed = runConsensus({ dir: makeTmp('sdd-p25-after-final-'), reviewId: 'arch-after-final', requirementsDigest: sha('req'), designDigest: sha('design') });
  const runDir = path.join(changed.runRoot, changed.pkg.reviewId);
  const tallyPath = path.join(runDir, 'round-00/tally.json');
  const originalTally = fsSync.readFileSync(tallyPath);
  fsSync.appendFileSync(changed.pkg.artifactPath, '\nchanged after finalize\n');
  assert.equal(judgeArchitectureGate({ package: changed.pkg, runRoot: changed.runRoot }).status, 'REFUSED', 'a previously passing tally cannot hide changed artifact bytes');
  assert.deepEqual(fsSync.readFileSync(tallyPath), originalTally, 'verification must preserve the original tally');

  const late = runConsensus({ dir: makeTmp('sdd-p25-ballot-after-'), reviewId: 'arch-ballot-after', requirementsDigest: sha('req'), designDigest: sha('design') });
  const paperPath = path.join(late.runRoot, late.pkg.reviewId, 'round-00/ballot-zcode.json');
  const paper = JSON.parse(fsSync.readFileSync(paperPath));
  paper.verdict = 'REJECT';
  fsSync.writeFileSync(paperPath, JSON.stringify(paper));
  assert.equal(judgeArchitectureGate({ package: late.pkg, runRoot: late.runRoot }).status, 'REFUSED', 'a late dissent cannot inherit the old tally approval');

  const forged = runConsensus({ dir: makeTmp('sdd-p25-report-after-'), reviewId: 'arch-report-after', requirementsDigest: sha('req'), designDigest: sha('design') });
  fsSync.writeFileSync(path.join(forged.runRoot, forged.pkg.reviewId, 'final-report.md'), 'PASSED strong independent review');
  assert.equal(judgeArchitectureGate({ package: forged.pkg, runRoot: forged.runRoot }).status, 'REFUSED', 'report existence and a strong label are not mechanical finalize evidence');
});

test('a newer frozen revision cannot reuse the same old review ID and artifact bytes', () => {
  const f = runConsensus({ dir: makeTmp('sdd-p25-same-id-'), reviewId: 'same-review-id', requirementsDigest: sha('req'), designDigest: sha('design') });
  assert.equal(f.judged.status, 'PASSED');
  const newer = freezeReviewPackage({ reviewId: f.pkg.reviewId, artifactPath: f.pkg.artifactPath, revision: 2 });
  const judged = judgeArchitectureGate({ package: newer, runRoot: f.runRoot });
  assert.equal(judged.status, 'REFUSED', 'revision identity is required even when the restored content hash and review ID match');
  assert.ok(refusalCodes(judged).includes('REVIEW_REVISION_MISMATCH'));
});

test('E04: the frozen new revision completes its own cold-start review end to end', () => {
  const dir = makeTmp('sdd-p25-e04journey-');
  const first = runConsensus({ dir: path.join(dir, 'r1'), reviewId: 'arch-e04j-r1', requirementsDigest: sha('req-r1'), designDigest: sha('design-r1') });
  assert.equal(first.judged.status, 'PASSED', 'precondition: revision 1 passed');

  // design changes → revision 2 freezes its own package and reviews cold
  const pkg2 = freezeReviewPackage({ reviewId: 'arch-e04j-r2', artifactPath: writePackageFile(path.join(dir, 'r2'), { requirementsDigest: sha('req-r1'), designDigest: sha('design-r2') }), revision: 2 });
  const runRoot2 = path.join(dir, 'r2', 'review-runs');
  const init2 = initConsensusRun({ package: pkg2, runRoot: runRoot2, initiator: 'claude-code' });
  assert.equal(init2.ok, true, 'the new revision inits its own independent manifest');
  for (const agent of P0_QUORUM) {
    const admitted = admitBallot({ package: pkg2, runRoot: runRoot2, participant: agent, ballot: ballot({ reviewId: 'arch-e04j-r2', agent, artifactSha256: pkg2.artifactSha256 }) });
    assert.equal(admitted.ok, true, `a fresh ballot of ${agent} validates against the new revision`);
  }
  const tally2 = mechanicalTally({ package: pkg2, runRoot: runRoot2 });
  assert.equal(tally2.exitCode, 0, 'the cold-start revision reaches unanimous PASSED on its own ballots');
  const fin2 = mechanicalFinalize({ package: pkg2, runRoot: runRoot2, conclusion: 'revision 2 re-reviewed from scratch after the design change', nextPlan: 'carry forward only the still-valid non-blocking notes' });
  assert.equal(fin2.ok, true, `real finalize for revision 2: ${fin2.stderr ?? ''}`);
  const judged2 = judgeArchitectureGate({ package: pkg2, runRoot: runRoot2, questions: [] });
  assert.equal(judged2.status, 'PASSED', 're-freezing a new revision and re-reviewing is completable');
  assert.equal(judged2.receipt.review_id, 'arch-e04j-r2');
  assert.notEqual(judged2.receipt.mechanical_tally_sha256, first.judged.receipt.mechanical_tally_sha256, 'the new revision keeps its own manifest and tally — nothing inherited from revision 1');
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
  assert.equal(notPassed.error, 'NOT_PASSED', 'the refusal names the missing unanimity like its sibling stale refusals');

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
  const raw = spawnSync(process.execPath, ['--test', '--test-reporter=tap', 'pass.test.js'], { cwd: root, encoding: 'utf8', timeout: 60_000, env });
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

// --- rework P1-02/P1-03: the consumption surfaces -----------------------------
//
// The intake entry (lib/delivery/evidence.js — the Runner.Dispatch.v1 local
// equivalent) stays untouched; the adapter consumes its dispatches. A consumes
// the closed unanimous consensus only through a launcher-issued dispatch bound
// to the frozen artifactDigest; T consumes the sufficiency conclusion and the
// attested oracle strength of ONE independent review (never a quorum).

const { consumeArchitectureGate, consumeTestDesignReview, ADEQUATE_ORACLE_STRENGTHS } = await import(path.join(projectRoot, 'lib/adapters/architecture-review.js'));

test('consumeArchitectureGate admits a closed consensus only through a launcher-issued dispatch bound to the frozen artifactDigest', () => {
  const authority = createLaunchAuthority({ secret: crypto.randomBytes(32).toString('hex') });
  const { pkg, runRoot, judged } = runConsensus({ dir: makeTmp('sdd-p25-consume-'), reviewId: 'arch-consume-r1', requirementsDigest: sha('req'), designDigest: sha('design') });
  assert.equal(judged.status, 'PASSED', 'precondition: the real consensus is closed and unanimous');
  const dispatchFor = (inputDigest, overrides = {}) => authority.issueDispatch({
    runnerId: 'review-runner-1', run: 'run-arch', gate: 'A', role: 'verifier',
    execution: 'exec-arch-review-1', inputDigest, policyDigest: sha('policy/arch'),
    attempt: 1, epoch: 1, ...overrides,
  });

  const consumed = consumeArchitectureGate({ package: pkg, runRoot, questions: [], dispatch: dispatchFor(pkg.artifactSha256), authority });
  assert.equal(consumed.ok, true);
  assert.equal(consumed.consumed, true);
  assert.equal(consumed.execution, 'exec-arch-review-1', 'the trusted execution identity binds the consumption');
  assert.equal(consumed.judged.status, 'PASSED');
  assert.deepEqual(consumed.judged, judged, 'consumption carries the real judgment, never a re-write');

  // fake origins
  const rogue = createLaunchAuthority({ secret: crypto.randomBytes(32).toString('hex') });
  const forged = consumeArchitectureGate({ package: pkg, runRoot, questions: [], dispatch: rogue.issueDispatch({
    runnerId: 'review-runner-1', run: 'run-arch', gate: 'A', role: 'verifier',
    execution: 'exec-arch-review-1', inputDigest: pkg.artifactSha256, policyDigest: sha('policy/arch'),
    attempt: 1, epoch: 1,
  }), authority });
  assert.deepEqual({ ok: forged.ok, error: forged.error }, { ok: false, error: 'FORGED_DISPATCH' });
  const malformed = consumeArchitectureGate({ package: pkg, runRoot, questions: [], dispatch: { execution: 'x' }, authority });
  assert.equal(malformed.ok, false);
  assert.equal(malformed.error, 'MALFORMED_DISPATCH');
  const none = consumeArchitectureGate({ package: pkg, runRoot, questions: [] });
  assert.equal(none.error, 'UNREGISTERED_SOURCE');

  // binding and identity
  const unbound = consumeArchitectureGate({ package: pkg, runRoot, questions: [], dispatch: dispatchFor(sha('other-material')), authority });
  assert.equal(unbound.error, 'ARTIFACT_DIGEST_MISMATCH');
  const builder = consumeArchitectureGate({ package: pkg, runRoot, questions: [], dispatch: dispatchFor(pkg.artifactSha256, { role: 'builder', execution: 'exec-builder-1' }), authority });
  assert.equal(builder.error, 'IDENTITY_CONFLICT');

  // consumption never overrides the judgment: every judged refusal surfaces
  const questions = openLoadBearingQuestions([{ id: 'q-1', question: 'is the boundary real?' }]);
  const openConsumed = consumeArchitectureGate({ package: pkg, runRoot, questions, dispatch: dispatchFor(pkg.artifactSha256), authority });
  assert.deepEqual({ ok: openConsumed.ok, error: openConsumed.error }, { ok: false, error: 'CONSENSUS_NOT_ADMITTED' });
  const rejudgedOpen = judgeArchitectureGate({ package: pkg, runRoot, questions });
  assert.deepEqual(openConsumed.refusals, rejudgedOpen.refusals, 'the underlying refusals pass through unchanged');
});

test('consumeTestDesignReview admits ONE independent review on sufficiency plus strong|adequate oracle strength; weak or stale never', () => {
  const authority = createLaunchAuthority({ secret: crypto.randomBytes(32).toString('hex') });
  assert.deepEqual([...ADEQUATE_ORACLE_STRENGTHS], ['strong', 'adequate'], 'the admitted strengths are exactly strong and adequate');
  const current = { inputDigest: sha('candidate-r1') };
  const dispatch = authority.issueDispatch({
    runnerId: 'review-runner-2', run: 'run-t', gate: 'T', role: 'verifier',
    execution: 'exec-test-review-1', inputDigest: current.inputDigest, policyDigest: sha('policy/t'),
    attempt: 1, epoch: 1,
  });
  const review = { candidateDigest: current.inputDigest, sufficient: true, oracleStrength: 'strong', summary: 'oracle observes the contract boundary; RED is behavior-grounded' };
  const consumed = consumeTestDesignReview({ dispatch, authority, current, review, authorExecution: 'exec-test-author-1' });
  assert.deepEqual({ ok: consumed.ok, consumed: consumed.consumed, oracleStrength: consumed.oracleStrength }, { ok: true, consumed: true, oracleStrength: 'strong' });

  for (const strength of ['weak', 'strict', undefined]) {
    const refused = consumeTestDesignReview({ dispatch, authority, current, review: { ...review, oracleStrength: strength }, authorExecution: 'exec-test-author-1' });
    assert.deepEqual({ ok: refused.ok, error: refused.error }, { ok: false, error: 'ORACLE_STRENGTH_REFUSED' }, `oracleStrength ${String(strength)} is refused`);
  }
  const insufficient = consumeTestDesignReview({ dispatch, authority, current, review: { ...review, sufficient: false }, authorExecution: 'exec-test-author-1' });
  assert.equal(insufficient.error, 'SUFFICIENCY_CONCLUSION_REQUIRED');
  const unwritten = consumeTestDesignReview({ dispatch, authority, current, review: { ...review, summary: '' }, authorExecution: 'exec-test-author-1' });
  assert.equal(unwritten.error, 'REVIEW_SUMMARY_REQUIRED');

  // staleness: the old authorization never covers new material, in either direction
  const staleCurrent = consumeTestDesignReview({ dispatch, authority, current: { inputDigest: sha('candidate-r2') }, review, authorExecution: 'exec-test-author-1' });
  assert.equal(staleCurrent.error, 'STALE_AUTHORIZATION');
  const foreign = consumeTestDesignReview({ dispatch, authority, current, review: { ...review, candidateDigest: sha('candidate-r0') }, authorExecution: 'exec-test-author-1' });
  assert.equal(foreign.error, 'REVIEW_MATERIAL_MISMATCH');

  // identity: the author cannot self-attest; the builder cannot sign. Both
  // mis-dispatches are issued by the launcher itself (a worker cannot rebind
  // an execution without breaking the signature).
  const selfDispatch = authority.issueDispatch({
    runnerId: 'review-runner-2', run: 'run-t', gate: 'T', role: 'verifier',
    execution: 'exec-test-author-1', inputDigest: current.inputDigest, policyDigest: sha('policy/t'),
    attempt: 1, epoch: 1,
  });
  const self = consumeTestDesignReview({ dispatch: selfDispatch, authority, current, review, authorExecution: 'exec-test-author-1' });
  assert.equal(self.error, 'SELF_REVIEW');
  const builderDispatch = authority.issueDispatch({
    runnerId: 'review-runner-2', run: 'run-t', gate: 'T', role: 'builder',
    execution: 'exec-builder-2', inputDigest: current.inputDigest, policyDigest: sha('policy/t'),
    attempt: 1, epoch: 1,
  });
  const builder = consumeTestDesignReview({ dispatch: builderDispatch, authority, current, review, authorExecution: 'exec-test-author-1' });
  assert.equal(builder.error, 'IDENTITY_CONFLICT');

  // fake origins
  const rogue = createLaunchAuthority({ secret: crypto.randomBytes(32).toString('hex') });
  const forged = consumeTestDesignReview({ dispatch: rogue.issueDispatch({
    runnerId: 'review-runner-2', run: 'run-t', gate: 'T', role: 'verifier',
    execution: 'exec-test-review-1', inputDigest: current.inputDigest, policyDigest: sha('policy/t'),
    attempt: 1, epoch: 1,
  }), authority, current, review, authorExecution: 'exec-test-author-1' });
  assert.equal(forged.error, 'FORGED_DISPATCH');
  const none = consumeTestDesignReview({ current, review });
  assert.equal(none.error, 'UNREGISTERED_SOURCE');

  // no quorum: exactly one review object is the whole input — the surface has
  // no participant list to fill, so T is never extended to the consensus quorum
  assert.equal(typeof review, 'object', 'the T consumption takes a single review');
});

// Signed, isolated data fixtures exercise the SDK's real collection protocol.
// They deliberately provide no real reviewer, OS, model or source qualification.
async function managedReviewFixture(gate = 'T') {
  const records = new Map();
  const policy = { ref: 'fixture/protected-policy', digest: sha('fixture-policy'), revision: 1 };
  const actionBinding = {
    schemaVersion: 1, profile: 'comet-managed-v2', runnerId: 'fixture-recorder-NOT-PRODUCTION',
    run: 'fixture-native-run', gate, action: gate === 'T' ? 'test-design-review' : 'architecture-review',
    execution: `fixture-${gate}-review`, role: 'reviewer', revision: 'revision-1', attempt: 1, epoch: 1,
    inputDigest: sha('fixture-current-input'), policyDigest: policy.digest, environmentDigest: sha('fixture-environment'),
    workPackage: { id: `fixture-${gate}-job`, taskIds: ['2.5'] },
    methods: [{ name: 'test-authoring', version: 'fixture-only', ref: '.agents/skills/test-authoring/SKILL.md', digest: sha('fixture-method') }],
    allowedPaths: ['.whitebox'], allowedTools: ['read_file'],
    inputs: [{ name: 'test-intent', ref: 'openspec/changes/fixture/test-intent.md', digest: sha('fixture-test-intent') }],
    outputs: [{ name: 'review', ref: '.whitebox/review.md' }],
  };
  const qualification = { id: 'fixture-source-NOT-PRODUCTION', sourceId: 'fixture-source', revision: 'fixture-1',
    scope: 'protected-source', status: 'qualified', expiresAt: '2099-01-01T00:00:00Z',
    evidenceRefs: [{ ref: 'fixture/data-only', digest: sha('no-real-qualification') }] };
  const testContract = {
    schemaVersion: 1, commandBindingsRequired: true, project: 'fixture', change: 'fixture',
    cases: [{ id: 'design.case', ac: 'T-review', oracle: 'denied source cannot satisfy an independent review', checkIds: ['design.check'] }],
    requiredChecks: [{ id: 'design.check', level: 'review', capability: 'test-design-review', command: 'fixture:semantic-review', caseIds: ['design.case'] }],
    executionDenominator: { totalCases: 1 }, cleanup: { environment: 'remove private fixture', data: 'no production data' },
    dependencyBaselines: [{ kind: 'test-intent', digest: sha('fixture-test-intent') }],
  };
  actionBinding.inputs.push({ name: 'test-contract', ref: 'openspec/changes/fixture/test-contract.json', digest: envelopeDigest(testContract) });
  const authority = createLaunchAuthority({ secret: crypto.randomBytes(32).toString('hex'), sourceVerifier: async (request) => {
    const known = records.get(request.dispatch.execution);
    if (!known || ['reportBytes', 'resultBytes', 'methodTraceBytes'].some((key) => !Buffer.from(known[key]).equals(Buffer.from(request[key])))) return { ok: false };
    const { dispatch, envelope, launchRecord, reportBytes, resultBytes, methodTraceBytes } = known;
    return { ok: true, qualification, facts: {
      actionDigest: envelopeDigest(dispatch.actionBinding), dispatchDigest: envelopeDigest(dispatch), envelopeDigest: envelopeDigest(envelope),
      launchDigest: envelopeDigest(launchRecord), reportDigest: sha(reportBytes), resultDigest: sha(resultBytes), methodTraceDigest: sha(methodTraceBytes),
      run: dispatch.run, execution: dispatch.execution, launchId: launchRecord.launchId, environmentDigest: dispatch.actionBinding.environmentDigest,
      principal: known.principal, observations: [{ caseId: envelope.caseId, check: envelope.check, command: 'fixture:semantic-review', result: envelope.result, executions: envelope.executions }],
    } };
  } });
  const source = async ({ action = actionBinding, result, rawResult, report = 'Independent fixture analysis: the oracle rejects an unauthenticated source at the public intake; coverage, environment and cleanup are reviewed.', principal = 'fixture-independent-principal', trace } = {}) => {
    const dispatch = authority.issueDispatch({ ...action, actionBinding: action });
    const reportBytes = Buffer.from(report), resultBytes = rawResult ?? Buffer.from(JSON.stringify(result));
    const methodTraceBytes = Buffer.from(JSON.stringify(trace ?? { schemaVersion: 1, run: action.run, execution: action.execution,
      actionDigest: envelopeDigest(action), methods: action.methods.map((method) => ({ ...method, status: 'completed' })) }));
    const envelope = { schemaVersion: 1, candidateDigest: action.inputDigest, caseId: 'design.case', check: 'test-design-review',
      origin: { kind: 'registered-runner', id: action.runnerId }, execution: { id: action.execution }, environment: 'fixture-environment',
      toolchain: `node ${process.version}`, executions: { total: 1, valid: 1 }, result: 'pass', evidence: [{ uri: '.whitebox/review.md', sha256: sha(reportBytes) }], expiry: '2099-01-01T00:00:00Z' };
    const packet = { dispatch, envelope, launchRecord: { launchId: `fixture-launch:${action.execution}`, execution: action.execution }, reportBytes, resultBytes, methodTraceBytes };
    records.set(action.execution, { ...packet, principal });
    const collected = await authority.collectResult(packet);
    assert.equal(collected.ok, true, 'the real SDK collects the isolated data fixture');
    return { ...packet, collection: collected.collection };
  };
  const review = {
    schemaVersion: 1, candidateDigest: actionBinding.inputDigest, contractDigest: envelopeDigest(testContract), sufficient: true,
    oracleStrength: 'strong', summary: 'Independent case and oracle sufficiency review with explicit environment and cleanup findings.',
    caseReviews: [{ caseId: 'design.case', checkIds: ['design.check'], oracle: testContract.cases[0].oracle,
      sufficient: true, rationale: 'The deny case has an observable public refusal and cannot pass on a self-declared label.' }],
    environmentReview: { digest: actionBinding.environmentDigest, sufficient: true, rationale: 'The private fixture environment is specified; production qualification is not claimed.' },
    cleanupReview: { ...testContract.cleanup, sufficient: true, rationale: 'Private fixtures are removed in finally.' }, findings: [],
  };
  const packet = await source({ result: review });
  const managed = { actionBinding, policy, testContract, packet, jobKey: 'fixture-native-job',
    admissionOptions: { sourceQualification: qualification, environment: 'fixture-environment', purpose: 'independent-acceptance',
      builderExecution: 'fixture-builder', builderPrincipal: 'fixture-builder-principal', authoringExecutions: ['fixture-test-author'],
      authoringPrincipals: ['fixture-test-author-principal'], consumedCollections: [], issuedExecutions: [], now: '2026-10-25T12:00:00Z' } };
  return { authority, actionBinding, policy, qualification, testContract, packet, managed, review, source };
}

test('managed T consumes original collected semantic review bytes, never a dispatch plus a strong label or empty report', async () => {
  const f = await managedReviewFixture();
  const consume = (managed) => consumeTestDesignReview({ dispatch: f.packet.dispatch, authority: f.authority,
    current: { inputDigest: f.actionBinding.inputDigest }, review: f.review, authorExecution: 'fixture-test-author', managed });
  const missing = consume({ ...f.managed, packet: { ...f.packet, collection: null } });
  assert.equal(missing.ok, false, 'protected T must not ignore a missing original collection');
  assert.equal(missing.error, 'INVALID_COLLECTION');
  const empty = consume({ ...f.managed, packet: { ...f.packet, reportBytes: Buffer.from(' ') } });
  assert.equal(empty.ok, false, 'an empty raw review never becomes sufficient from a strong label');
  const good = consume(f.managed);
  assert.equal(good.ok, true, good.error);
  assert.equal(typeof good.verifyReview, 'function', 'long source preparation exposes only a pure exact-record query');
  const admitted = admitEvidence(f.packet, { ...f.managed.admissionOptions, actionBinding: f.actionBinding, authority: f.authority, requireManaged: true });
  assert.equal(admitted.ok, true);
  const query = { entry: admitted.entry, inputs: { inputDigest: f.actionBinding.inputDigest, testContract: f.testContract }, policy: f.policy };
  assert.equal(good.verifyReview(query, f.managed).sufficient, true, 'one independent collected review is sufficient without any quorum surface');
  assert.equal(good.verifyReview({ ...query, policy: { ...f.policy, digest: sha('next-policy') } }, f.managed).ok, false, 'old policy preparation cannot revive');
});

async function managedArchitectureFixture({ dissent = false } = {}) {
  const f = await managedReviewFixture('A');
  const root = makeTmp('sdd-p25-managed-a-');
  const questions = closeLoadBearingQuestion(openLoadBearingQuestions([{ id: 'ownership', question: 'Who owns state and recovery?' }]), 'ownership', 'The original Comet Run alone owns both; the adapter has no phase or retry store.');
  const grillResult = { schemaVersion: 1, requirementsDigest: sha('req'), designDigest: sha('design'), questions };
  const grillAction = { ...f.actionBinding, execution: 'fixture-grill-author', role: 'architect',
    inputs: [{ name: 'requirements', ref: 'proposal.md', digest: grillResult.requirementsDigest }, { name: 'design', ref: 'design.md', digest: grillResult.designDigest }],
    methods: [{ name: 'grill-me', version: 'fixture-only', ref: '.agents/skills/grill-me/SKILL.md', digest: sha('fixture-grill-method') }] };
  const grill = await f.source({ action: grillAction, result: grillResult, principal: 'fixture-architect-principal' });
  const artifactPath = writePackageFile(root, { requirementsDigest: sha('req'), designDigest: sha('design') });
  const artifact = JSON.parse(fsSync.readFileSync(artifactPath));
  artifact.grillDigest = sha(grill.resultBytes);
  fsSync.writeFileSync(artifactPath, JSON.stringify(artifact));
  const pkg = freezeReviewPackage({ reviewId: 'fixture-current-architecture', artifactPath, revision: 1 });
  // This first isolated counterexample shares the input digest for compatibility
  // with the old dispatch seam. Native tests use its distinct original digest.
  f.actionBinding.inputDigest = pkg.artifactSha256;
  f.actionBinding.inputs = [{ name: 'requirements', ref: 'proposal.md', digest: artifact.requirementsDigest },
    { name: 'design', ref: 'design.md', digest: artifact.designDigest },
    { name: 'architecture-package', ref: '.whitebox/package.json', digest: pkg.artifactSha256 },
    { name: 'grill-closure', ref: '.whitebox/grill.json', digest: artifact.grillDigest }];
  f.actionBinding.methods = [{ name: 'multi-agent-consensus-review', version: 'fixture-only', ref: '.agents/skills/multi-agent-consensus-review/SKILL.md', digest: sha('fixture-consensus-method') }];
  const runRoot = path.join(root, 'runs');
  assert.equal(initConsensusRun({ package: pkg, runRoot, initiator: 'codex-agent' }).ok, true);
  const reviewers = [];
  for (const participant of P0_QUORUM) {
    assert.equal(admitBallot({ package: pkg, runRoot, participant, ballot: ballot({ reviewId: pkg.reviewId, agent: participant, artifactSha256: pkg.artifactSha256,
      verdict: dissent && participant === 'zcode' ? 'REJECT' : 'APPROVE' }) }).ok, true);
    const rawResult = fsSync.readFileSync(path.join(runRoot, pkg.reviewId, 'round-00', `ballot-${participant}.json`));
    const action = { ...f.actionBinding, execution: `fixture-review:${participant}` };
    reviewers.push({ participant, packet: await f.source({ action, rawResult, principal: `fixture-principal:${participant}` }) });
  }
  assert.equal(mechanicalTally({ package: pkg, runRoot }).ok, !dissent);
  if (!dissent) assert.equal(mechanicalFinalize({ package: pkg, runRoot, conclusion: 'Fixture unanimous decision; no actual model review.', nextPlan: 'Independent runtime qualification remains unverified.' }).ok, true);
  const runDir = path.join(runRoot, pkg.reviewId);
  const result = { schemaVersion: 1, reviewId: pkg.reviewId, artifactSha256: pkg.artifactSha256, revision: pkg.revision, round: 0,
    manifestDigest: shaFile(path.join(runDir, 'manifest.json')), tallyDigest: shaFile(path.join(runDir, 'round-00/tally.json')),
    finalReportDigest: dissent ? null : shaFile(path.join(runDir, 'final-report.md')), grillDigest: artifact.grillDigest };
  const packet = await f.source({ result, report: dissent ? 'Fixture independent rejection: architecture requires revision.' : fsSync.readFileSync(path.join(runDir, 'final-report.md')) });
  const sourceBindings = [{ actionBinding: grillAction, sourceQualification: f.qualification }, ...reviewers.map(({ packet }) => ({ actionBinding: packet.dispatch.actionBinding, sourceQualification: f.qualification }))];
  const managed = { ...f.managed, actionBinding: f.actionBinding, packet, reviewers, grill: { packet: grill }, sourceBindings };
  return { ...f, pkg, runRoot, questions, packet, reviewers, grill, managed };
}

test('managed A refuses missing or same-principal reviewer collections despite a real unanimous tally', async () => {
  const f = await managedArchitectureFixture();
  const rawJudgment = judgeArchitectureGate({ package: f.pkg, runRoot: f.runRoot, questions: f.questions });
  assert.equal(rawJudgment.status, 'PASSED', JSON.stringify(rawJudgment.refusals));
  const consume = (managed) => consumeArchitectureGate({ package: f.pkg, runRoot: f.runRoot, questions: f.questions, dispatch: f.packet.dispatch, authority: f.authority, managed });
  const missing = consume({ ...f.managed, reviewers: f.reviewers.slice(0, 2) });
  assert.equal(missing.ok, false, 'a valid aggregate dispatch and tally cannot replace one missing independent source');
  assert.equal(missing.error, 'REVIEWER_COLLECTIONS_REQUIRED');
  const good = consume(f.managed);
  assert.equal(good.ok, true, good.error);
  assert.equal(typeof good.verifyReview, 'function');
  const same = await f.source({ action: f.reviewers[1].packet.dispatch.actionBinding, rawResult: f.reviewers[1].packet.resultBytes, principal: 'fixture-principal:claude-code' });
  const conflict = consume({ ...f.managed, reviewers: [f.reviewers[0], { participant: 'zcode', packet: same }, f.reviewers[2]] });
  assert.equal(conflict.ok, false, 'different labels and executions cannot make one principal independent');
  assert.equal(conflict.error, 'REVIEWER_IDENTITY_CONFLICT');
});

test('prepared review query requires fresh protected action, source qualification and clock on every Native readback', async () => {
  const f = await managedReviewFixture();
  const prepared = consumeTestDesignReview({ authority: f.authority, managed: f.managed });
  const admitted = admitEvidence(f.packet, { ...f.managed.admissionOptions, actionBinding: f.actionBinding, authority: f.authority, requireManaged: true });
  const request = { entry: admitted.entry, inputs: { inputDigest: f.actionBinding.inputDigest, testContract: f.testContract }, policy: f.policy };
  assert.equal(prepared.verifyReview(request).ok, false, 'a cached prepared result is not a current source/identity lookup');
  assert.equal(prepared.verifyReview(request, f.managed).sufficient, true);
  for (const [name, current] of [
    ['qualification revoked', { ...f.managed, admissionOptions: { ...f.managed.admissionOptions, sourceQualification: { ...f.qualification, status: 'revoked' } } }],
    ['qualification expired', { ...f.managed, admissionOptions: { ...f.managed.admissionOptions, now: '2100-01-01T00:00:00Z' } }],
    ['late attempt', { ...f.managed, actionBinding: { ...f.actionBinding, attempt: 2 } }],
    ['changed revision', { ...f.managed, actionBinding: { ...f.actionBinding, revision: 'revision-2' } }],
    ['foreign Run', { ...f.managed, actionBinding: { ...f.actionBinding, run: 'another-native-run' } }],
  ]) assert.equal(prepared.verifyReview(request, current).ok, false, name);
});

test('review evidence is immutable on duplicate admission and malformed package/round/grill inputs are refused before execution', () => {
  const dir = makeTmp('sdd-p25-inputs-');
  const artifactPath = writePackageFile(dir, { requirementsDigest: sha('req'), designDigest: sha('design') });
  assert.throws(() => freezeReviewPackage({ reviewId: '../escaped-review', artifactPath, revision: 1 }), /PACKAGE_REVIEW_ID_INVALID/);
  const pkg = freezeReviewPackage({ reviewId: 'immutable-review', artifactPath, revision: 1 });
  const runRoot = path.join(dir, 'runs');
  const open = openLoadBearingQuestions([{ id: 'unresolved', question: 'Who owns recovery?' }]);
  assert.equal(initConsensusRun({ package: pkg, runRoot, initiator: 'codex-agent', questions: open }).ok, false, 'open grill questions refuse review submission');
  assert.equal(fsSync.existsSync(runRoot), false, 'no review run is created before grill closure');
  const closed = closeLoadBearingQuestion(open, 'unresolved', 'The original Comet Run owns recovery.');
  assert.equal(initConsensusRun({ package: pkg, runRoot, initiator: 'codex-agent', questions: closed }).ok, true);
  const paper = ballot({ reviewId: pkg.reviewId, agent: 'zcode', artifactSha256: pkg.artifactSha256 });
  const admitted = admitBallot({ package: pkg, runRoot, participant: 'zcode', ballot: paper });
  assert.equal(admitted.ok, true);
  const original = fsSync.readFileSync(admitted.ballotPath);
  assert.equal(admitBallot({ package: pkg, runRoot, participant: 'zcode', ballot: paper }).ok, true, 'duplicate identical admission resumes evidence');
  const changed = admitBallot({ package: pkg, runRoot, participant: 'zcode', ballot: { ...paper, verdict: 'REJECT' } });
  assert.equal(changed.ok, false, 'changed review material must use a new round, never overwrite the original vote');
  assert.deepEqual(fsSync.readFileSync(admitted.ballotPath), original);
  for (const round of [null, -1, 0.5, '0', 3, {}, []]) {
    assert.throws(() => mechanicalTally({ package: pkg, runRoot, round }), /ROUND_INVALID/);
  }
  for (const questions of [null, {}, [null], [{ id: 'x', question: 'q', closed: 'yes' }], [{ id: 'x', question: 'q', closed: true, resolution: '' }]]) {
    assert.throws(() => loadBearingStatus(questions), /QUESTION_INVALID/);
    assert.throws(() => initConsensusRun({ package: pkg, runRoot, initiator: 'codex-agent', questions }), /QUESTION_INVALID/);
  }
  for (const entry of [freezeReviewPackage, initConsensusRun, admitBallot, mechanicalTally, mechanicalFinalize,
    judgeArchitectureGate, consumeArchitectureGate, consumeTestDesignReview]) assert.throws(() => entry(null), /INPUT_INVALID/);
  assert.equal(consumeTestDesignReview({ dispatch: {}, authority: {} }).ok, false);
  assert.equal(consumeArchitectureGate({ package: pkg, runRoot, dispatch: {}, authority: {} }).ok, false);
  assert.equal(createReviewJobSeat().claim({ jobKey: 'component', reviewId: pkg.reviewId, artifactSha256: pkg.artifactSha256, revision: 1 }).job.managedClosureEligible, false);
});

test('managed T requires a full independent semantic conclusion, not field counts, and handles all external collection shapes safely', async (t) => {
  const f = await managedReviewFixture();
  const malformed = [
    ['schema missing', { ...f.review, schemaVersion: undefined }], ['future schema', { ...f.review, schemaVersion: 2 }],
    ['root array', []], ['root null', null], ['no case review', { ...f.review, caseReviews: [] }],
    ['case map', { ...f.review, caseReviews: {} }], ['null case', { ...f.review, caseReviews: [null] }],
    ['no rationale', { ...f.review, caseReviews: [{ ...f.review.caseReviews[0], rationale: '' }] }],
    ['different oracle', { ...f.review, caseReviews: [{ ...f.review.caseReviews[0], oracle: 'file exists' }] }],
    ['wrong check', { ...f.review, caseReviews: [{ ...f.review.caseReviews[0], checkIds: ['different-check'] }] }],
    ['different material', { ...f.review, candidateDigest: sha('old-candidate') }],
    ['different test contract', { ...f.review, contractDigest: sha('old-test-contract') }],
    ['no environment review', { ...f.review, environmentReview: null }],
    ['different cleanup', { ...f.review, cleanupReview: { ...f.review.cleanupReview, data: 'erase another project' } }],
    ['null finding', { ...f.review, findings: [null] }], ['no written conclusion', { ...f.review, summary: ' ' }],
  ];
  for (const [name, result] of malformed) await t.test(name, async () => {
    const action = { ...f.actionBinding, execution: `fixture-malformed:${name}` };
    const packet = await f.source({ action, result });
    assert.equal(consumeTestDesignReview({ authority: f.authority, managed: { ...f.managed, actionBinding: action, packet } }).ok, false);
  });
  for (const [name, result] of [
    ['explicit insufficient', { ...f.review, sufficient: false }],
    ['weak oracle', { ...f.review, oracleStrength: 'weak' }],
    ['case is insufficient', { ...f.review, caseReviews: [{ ...f.review.caseReviews[0], sufficient: false }] }],
    ['environment is insufficient', { ...f.review, environmentReview: { ...f.review.environmentReview, sufficient: false } }],
    ['cleanup is insufficient', { ...f.review, cleanupReview: { ...f.review.cleanupReview, sufficient: false } }],
    ['blocking finding', { ...f.review, findings: [{ id: 'weak-oracle', blocking: true, rationale: 'The deny oracle can pass without observing a denial.' }] }],
  ]) await t.test(name, async () => {
    const action = { ...f.actionBinding, execution: `fixture-insufficient:${name}` }, packet = await f.source({ action, result });
    const managed = { ...f.managed, actionBinding: action, packet };
    const prepared = consumeTestDesignReview({ authority: f.authority, managed });
    assert.equal(prepared.ok, true, 'a completed authenticated negative review is observable for Native rework');
    assert.equal(prepared.prepared, true);
    assert.equal(prepared.consumed, false, 'the adapter does not consume the original Native intent');
    const admitted = admitEvidence(packet, { ...managed.admissionOptions, actionBinding: action, authority: f.authority, requireManaged: true });
    const queried = prepared.verifyReview({ entry: admitted.entry, inputs: { inputDigest: action.inputDigest, testContract: f.testContract }, policy: f.policy }, managed);
    assert.equal(queried.ok, true);
    assert.equal(queried.sufficient, false, 'complete fields and a strong label cannot override an independent insufficiency conclusion');
  });
  for (const [name, managed] of [
    ['null context', null], ['array context', []], ['null packet', { ...f.managed, packet: null }],
    ['null binding', { ...f.managed, actionBinding: null }], ['future binding', { ...f.managed, actionBinding: { ...f.actionBinding, schemaVersion: 2 } }],
    ['null contract', { ...f.managed, testContract: null }], ['array contract', { ...f.managed, testContract: [] }],
    ['null policy', { ...f.managed, policy: null }], ['null admission', { ...f.managed, admissionOptions: null }],
    ['old trace', { ...f.managed, packet: { ...f.packet, methodTraceBytes: Buffer.from('old trace') } }],
  ]) await t.test(name, () => assert.equal(consumeTestDesignReview({ authority: f.authority, managed }).ok, false));
});

test('managed A retains an authenticated dissent for Native rework and refuses stale policy, closure or raw source evidence', async () => {
  const negative = await managedArchitectureFixture({ dissent: true });
  const prepared = consumeArchitectureGate({ package: negative.pkg, runRoot: negative.runRoot, questions: negative.questions, authority: negative.authority, managed: negative.managed });
  assert.equal(prepared.ok, true, prepared.error);
  assert.equal(prepared.sufficient, false);
  assert.equal(prepared.consumed, false);
  const f = await managedArchitectureFixture();
  const consume = (managed, questions = f.questions) => consumeArchitectureGate({ package: f.pkg, runRoot: f.runRoot, questions, authority: f.authority, managed });
  assert.equal(consume(f.managed, []).error, 'LOAD_BEARING_OPEN');
  assert.equal(consume({ ...f.managed, reviewers: [f.reviewers[0], f.reviewers[0], f.reviewers[2]] }).error, 'REVIEWER_COLLECTIONS_REQUIRED');
  assert.equal(consume({ ...f.managed, sourceBindings: null }).error, 'CURRENT_REVIEW_SOURCES_REQUIRED');
  assert.equal(consume({ ...f.managed, policy: { ...f.policy, digest: sha('new-policy') } }).ok, false);
  assert.equal(consume({ ...f.managed, packet: { ...f.packet, resultBytes: Buffer.from('{"status":"PASSED"}') } }).ok, false);
  assert.equal(consume({ ...f.managed, reviewers: [f.reviewers[0], { ...f.reviewers[1], packet: { ...f.reviewers[1].packet, collection: null } }, f.reviewers[2]] }).ok, false);
  const passing = consume(f.managed);
  const admitted = admitEvidence(f.packet, { ...f.managed.admissionOptions, actionBinding: f.actionBinding, authority: f.authority, requireManaged: true });
  const query = { entry: admitted.entry, inputs: { inputDigest: f.actionBinding.inputDigest, testContract: f.testContract }, policy: f.policy };
  const read = fsSync.readFileSync;
  fsSync.readFileSync = () => { throw new Error('query attempted filesystem IO'); };
  try { assert.equal(passing.verifyReview(query, f.managed).sufficient, true, 'prepared query has no filesystem or subprocess work'); }
  finally { fsSync.readFileSync = read; }
  assert.equal(passing.verifyReview(query, { ...f.managed, sourceBindings: f.managed.sourceBindings.map((item, index) => index === 1
    ? { ...item, sourceQualification: { ...item.sourceQualification, status: 'revoked' } } : item) }).ok, false, 'a revoked child reviewer invalidates the prepared aggregate');
});

// --- 0.5.0 composition docking: the A receipt bundle (D02/N04) ----------------
//
// The comet-050 classic-full composition expresses the A gate as the
// architecture-consensus extension on full.design.evidence (P2_4, ADR-0022):
// the extension execution writes ONE project-relative artifact of kind
// gate-receipt-bundle, hash-bound through artifactHashes, and its result
// carries { verdict, sourceHash, artifactHashes, gateEvidence }; acceptance
// belongs ONLY to the sdd.delivery.gate.a validator
// (integrations/comet/application/bindings.mjs delegating to
// lib/delivery/gate.js evaluate). The adapter stays the evidence producer:
// buildGateReceiptBundle formats an ALREADY admitted unanimous consensus into
// exactly that input shape. The P2_4 artifacts below are read-only imports —
// the acceptance decision is the real validator's, never this adapter's.
const applicationRoot = path.join(projectRoot, 'integrations/comet/application');
const architectureExtension = JSON.parse(fsSync.readFileSync(path.join(applicationRoot, 'extensions/architecture-consensus.json'), 'utf8'));
const compositionDocument = JSON.parse(fsSync.readFileSync(path.join(applicationRoot, 'composition.json'), 'utf8'));
const DECLARED_REF = architectureExtension.artifactRefs[0].ref;
const compositionValidators = (await (await import(path.join(applicationRoot, 'bindings.mjs'))).createBindings({ probe: 'p2_5-docking' })).validators;
const validatorFor = (gate) => compositionValidators.find((validator) => validator.id === `sdd.delivery.gate.${gate.toLowerCase()}`);

// The A-extension docking world: a real unanimous (or dissenting) consensus,
// a real launcher dispatch bound to the frozen package digest, and the three
// original ballots admitted as independent-acceptance evidence through the
// REAL intake.
function dockingWorld({ dissent = false } = {}) {
  const authority = createLaunchAuthority({ secret: crypto.randomBytes(32).toString('hex') });
  const POLICY = { ref: 'policy/comet-managed-p2_5', digest: sha('policy/comet-managed-p2_5@r1') };
  const dir = makeTmp(dissent ? 'sdd-p25-dock-no-' : 'sdd-p25-dock-');
  const reviewId = dissent ? 'arch-dock-dissent' : 'arch-dock-r1';
  const pkg = freezeReviewPackage({ reviewId, artifactPath: writePackageFile(dir, { requirementsDigest: sha('req-dock'), designDigest: sha('design-dock') }), revision: 1 });
  const world = runConsensus({ dir, reviewId, requirementsDigest: sha('req-dock'), designDigest: sha('design-dock'),
    ballots: P0_QUORUM.map((agent) => ballot({ reviewId, agent, artifactSha256: pkg.artifactSha256, verdict: dissent && agent === 'zcode' ? 'REJECT' : 'APPROVE' })) });
  const testContract = {
    schemaVersion: 1, project: 'sdd-harness', change: 'delivery-foundation-rearchitecture',
    cases: [{ id: 'design.architecture', ac: 'D02', oracle: 'the architecture gate passes only on the frozen unanimous mechanical consensus of the exact P0 quorum' }],
    requiredChecks: [{ id: 'arch-consensus', level: 'review', capability: 'architecture-consensus', caseIds: ['design.architecture'] }],
    executionDenominator: { totalCases: 1 },
    cleanup: { environment: 'private review run dirs removed in finally', data: 'none persisted' },
    dependencyBaselines: [{ kind: ARCHITECTURE_REVIEW_BASELINE_KIND, digest: pkg.artifactSha256 }],
  };
  const dispatchFor = (overrides = {}) => authority.issueDispatch({ runnerId: 'review-runner-a', run: 'run-p2_5-dock', gate: 'A', role: 'verifier',
    execution: 'exec-arch-consensus-1', inputDigest: pkg.artifactSha256, policyDigest: POLICY.digest, attempt: 1, epoch: 1, ...overrides });
  const inputs = { inputDigest: pkg.artifactSha256, testContract, builderExecution: 'exec-design-author-1' };
  const receipts = P0_QUORUM.map((participant) => {
    const ballotBytes = fsSync.readFileSync(path.join(world.runRoot, reviewId, 'round-00', `ballot-${participant}.json`));
    const admitted = admitEvidence({
      envelope: { schemaVersion: 1, candidateDigest: pkg.artifactSha256, caseId: 'design.architecture', check: 'architecture-consensus',
        origin: { kind: 'registered-runner', id: 'review-runner-a' }, execution: { id: `exec-arch-${participant}` },
        environment: 'p2_5-docking-env', toolchain: `node ${process.version}`, executions: { total: 1, valid: 1 }, result: 'pass',
        evidence: [{ uri: `${reviewId}/round-00/ballot-${participant}.json`, sha256: sha(ballotBytes) }],
        expiry: '2026-11-26T00:00:00.000Z' },
      dispatch: dispatchFor({ execution: `exec-arch-${participant}` }),
      authority, current: { inputDigest: pkg.artifactSha256, policyDigest: POLICY.digest, environment: 'p2_5-docking-env' },
      now: '2026-10-26T12:00:00.000Z',
    });
    assert.equal(admitted.ok, true, `the original ballot of ${participant} admits through the real intake: ${admitted.reason ?? ''}`);
    return admitted.entry;
  });
  return { ...world, pkg, authority, POLICY, dispatchFor, inputs, receipts };
}

test('buildGateReceiptBundle formats the admitted consensus as the composition gate-receipt-bundle; the real sdd.delivery.gate.a validator accepts it', async () => {
  // docking preconditions: the P2_4 typed declaration and the compiler-shaped
  // composition entry pin the same artifact ref and validator (read-only).
  assert.equal(architectureExtension.gate, 'A');
  assert.equal(architectureExtension.afterStep, 'full.design.evidence');
  assert.equal(architectureExtension.artifactRefs[0].kind, 'gate-receipt-bundle');
  assert.equal(architectureExtension.artifactRefs[0].hashBinding, 'artifactHashes');
  assert.equal(architectureExtension.artifactRefs[0].writtenBy, 'extension-execution');
  const compositionEntry = compositionDocument.composition.extensions.find((entry) => entry.id === architectureExtension.id);
  assert.deepEqual(compositionEntry.artifactRefs, [DECLARED_REF], 'the composition pins the declared bundle ref');
  assert.deepEqual(compositionEntry.validator, architectureExtension.validator, 'the composition pins the declared validator');
  assert.ok(validatorFor('A'), 'bindings.mjs registers the declared A validator');

  const world = dockingWorld();
  assert.equal(world.judged.status, 'PASSED', 'precondition: the real consensus is closed and unanimous');
  const payload = buildGateReceiptBundle({ package: world.pkg, runRoot: world.runRoot, questions: [], dispatch: world.dispatchFor(),
    authority: world.authority, artifactRef: DECLARED_REF, inputs: world.inputs, receipts: world.receipts, policy: world.POLICY });
  assert.equal(payload.ok, true, payload.error);

  // bundle shape: exactly the declared artifact typing and hash binding
  assert.equal(payload.bundle.schema, 'sdd.delivery.gate.receipt-bundle.v1');
  assert.equal(payload.bundle.kind, 'gate-receipt-bundle');
  assert.equal(payload.bundle.gate, 'A');
  assert.equal(payload.bundle.artifactRef, DECLARED_REF);
  assert.equal(payload.bundle.hashBinding, 'artifactHashes');
  assert.equal(payload.bundle.writtenBy, 'extension-execution');
  // the judged receipt rides verbatim — manifest/ballots/tally/report digests unchanged
  assert.deepEqual(payload.bundle.review, world.judged.receipt);
  assert.deepEqual(payload.bundle.review.ballots.map((entry) => entry.participant), P0_QUORUM);
  assert.equal(payload.bundle.package.reviewId, world.pkg.reviewId);
  assert.equal(payload.bundle.package.revision, world.pkg.revision);
  assert.equal(payload.bundle.package.artifactSha256, world.pkg.artifactSha256);
  assert.equal(payload.bundle.manifestSha256, shaFile(path.join(world.runRoot, world.pkg.reviewId, 'manifest.json')), 'the bundle binds the real manifest bytes');
  // artifactHashes binds the declared ref to the exact bundle bytes, deterministically
  assert.deepEqual(payload.artifactHashes, { [DECLARED_REF]: sha(payload.bundleBytes) });
  const rebuilt = buildGateReceiptBundle({ package: world.pkg, runRoot: world.runRoot, questions: [], dispatch: world.dispatchFor(),
    authority: world.authority, artifactRef: DECLARED_REF, inputs: world.inputs, receipts: world.receipts, policy: world.POLICY });
  assert.deepEqual(rebuilt, payload, 'the bundle is deterministic over the same admitted evidence');
  // tampering the written bytes breaks the recorded hash binding
  const tampered = Buffer.from(payload.bundleBytes.toString('utf8').replace('PASSED', 'BLOCKED'));
  assert.notEqual(sha(tampered), payload.artifactHashes[DECLARED_REF]);
  // the extension result protocol shape bindings.mjs judges
  assert.deepEqual(payload.output, { verdict: 'pass', sourceHash: world.pkg.artifactSha256, artifactHashes: payload.artifactHashes,
    gateEvidence: { gate: 'A', inputs: world.inputs, receipts: world.receipts, policy: world.POLICY } });

  // THE docking: the real composition validator accepts through its pure delegation
  const decision = await validatorFor('A').validate({ run: { runId: 'run-p2_5-dock' }, action: { id: 'action-architecture-consensus', stepId: 'classic.extension.A' },
    outcome: { actionId: 'action-architecture-consensus', status: 'succeeded', output: payload.output } });
  assert.deepEqual(decision, { accepted: true }, `the sdd.delivery.gate.a validator must accept the assembled payload: ${decision.reason ?? ''}`);

  // cross-gate replay: the same payload never satisfies another gate extension
  const replay = await validatorFor('R').validate({ run: { runId: 'run-p2_5-dock' }, action: { id: 'action-requirements-open', stepId: 'classic.extension.R' },
    outcome: { actionId: 'action-requirements-open', status: 'succeeded', output: payload.output } });
  assert.equal(replay.accepted, false, 'gate evidence cannot be replayed across extensions');
  assert.match(replay.reason, /bound to gate A/);
});

test('buildGateReceiptBundle refuses refused consensuses, builder identity, rebound digests and invalid refs — no bundle exists for a refused gate', async () => {
  const world = dockingWorld();
  const build = (overrides = {}) => buildGateReceiptBundle({ package: world.pkg, runRoot: world.runRoot, questions: [], dispatch: world.dispatchFor(),
    authority: world.authority, artifactRef: DECLARED_REF, inputs: world.inputs, receipts: world.receipts, policy: world.POLICY, ...overrides });

  // a refused consensus (dissent) never produces a bundle; the refusal surfaces
  const dissent = dockingWorld({ dissent: true });
  const dissentBuild = buildGateReceiptBundle({ package: dissent.pkg, runRoot: dissent.runRoot, questions: [], dispatch: dissent.dispatchFor(),
    authority: dissent.authority, artifactRef: DECLARED_REF, inputs: dissent.inputs, receipts: dissent.receipts, policy: dissent.POLICY });
  assert.equal(dissentBuild.ok, false, 'a majority verdict is not a pass bundle');
  assert.equal(dissentBuild.error, 'CONSENSUS_NOT_ADMITTED');
  assert.ok(dissentBuild.intake.refusals.some((refusal) => refusal.code === 'QUORUM_NOT_UNANIMOUS'), 'the mechanical refusal surfaces through the build');

  // a passed tally without the real finalize never completes the bundle
  const dir = makeTmp('sdd-p25-dock-nofin-');
  const noFinal = runConsensus({ dir, reviewId: 'arch-dock-nofin', requirementsDigest: sha('req-nf'), designDigest: sha('design-nf'), finalize: false });
  const noFinalDispatch = world.authority.issueDispatch({ runnerId: 'review-runner-a', run: 'run-p2_5-dock', gate: 'A', role: 'verifier',
    execution: 'exec-arch-consensus-1', inputDigest: noFinal.pkg.artifactSha256, policyDigest: world.POLICY.digest, attempt: 1, epoch: 1 });
  const noFinalBuild = buildGateReceiptBundle({ package: noFinal.pkg, runRoot: noFinal.runRoot, questions: [], dispatch: noFinalDispatch,
    authority: world.authority, artifactRef: DECLARED_REF, inputs: { ...world.inputs, inputDigest: noFinal.pkg.artifactSha256 }, receipts: world.receipts, policy: world.POLICY });
  assert.equal(noFinalBuild.ok, false, 'no bundle without the real finalize output');
  assert.ok(noFinalBuild.intake.refusals.some((refusal) => refusal.code === 'FINAL_REPORT_REQUIRED'));

  // the builder execution (the design author) cannot sign the consensus bundle
  const self = build({ dispatch: world.dispatchFor({ role: 'builder', execution: 'exec-design-author-1' }) });
  assert.equal(self.ok, false);
  assert.equal(self.error, 'IDENTITY_CONFLICT');

  // a dispatch bound to another artifact digest is a rebound summary at the intake
  const reboundDispatch = build({ dispatch: world.dispatchFor({ inputDigest: sha('another-design') }) });
  assert.equal(reboundDispatch.ok, false);
  assert.equal(reboundDispatch.error, 'ARTIFACT_DIGEST_MISMATCH');

  // a payload built for another input digest is a rebound summary at the docking layer
  const reboundPayload = build({ inputs: { ...world.inputs, inputDigest: sha('another-design') } });
  assert.equal(reboundPayload.ok, false);
  assert.equal(reboundPayload.error, 'PAYLOAD_INPUT_REBOUND');

  // the artifact ref keeps the upstream project-relative constraint
  for (const ref of ['/absolute/bundle.json', '../escape.json', 'C:\\escape\\bundle.json', '']) {
    assert.throws(() => build({ artifactRef: ref }), /BUNDLE_REF_INVALID/, `ref ${ref} must be refused`);
  }
  // the gateEvidence receipts are the extension's admission entries, not a free-form list
  assert.throws(() => build({ receipts: { participant: 'zcode' } }), /BUNDLE_INPUT_INVALID/);
  // invalid inputs
  assert.throws(() => buildGateReceiptBundle(null), /INPUT_INVALID/);
});

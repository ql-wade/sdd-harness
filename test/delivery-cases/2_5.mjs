// P2_5 delivery case: the architecture gate (E03/E04/H06) over a FROZEN
// review package with an independent unanimous consensus. 2.5.a: grill-me
// load-bearing questions must be closed before submission, and the real
// quorum/thresholds/policy bind the frozen package digest. 2.5.b: the
// mechanical consensus result is consumed only through the REAL
// review_gate.py (init/validate/tally/finalize subprocesses — zero mocks);
// missing ballots, dissents and old digests never pass; the same job_key
// resumes the original review job (no duplicate review); a requirements or
// design change conservatively invalidates the old ballots and downstream
// evidence, and restoring the old bytes never auto-revives the old receipt;
// test T keeps its single automatic review and is not extended to the
// consensus quorum. All state lives under $TMPDIR; the host is untouched.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { REVIEW_PARTICIPANTS, REVIEW_THRESHOLDS, ARCHITECTURE_CRITERIA, ARCHITECTURE_REVIEW_BASELINE_KIND,
  freezeReviewPackage, initConsensusRun, admitBallot, mechanicalTally, mechanicalFinalize,
  openLoadBearingQuestions, closeLoadBearingQuestion,
  judgeArchitectureGate, createReviewJobSeat } = await import(path.join(projectRoot, 'lib/adapters/architecture-review.js'));
const { invalidateOnScopeChange } = await import(path.join(projectRoot, 'lib/delivery/baseline.js'));

const sha = (data) => crypto.createHash('sha256').update(data).digest('hex');
const shaFile = (file) => sha(fsSync.readFileSync(file));
const P0_QUORUM = ['claude-code', 'zcode', 'codex-agent'];

function makeTmp(label) {
  return fsSync.mkdtempSync(path.join(os.tmpdir(), label));
}

function writePackageFile(dir, { requirementsDigest, designDigest }) {
  fsSync.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'architecture-package.json');
  fsSync.writeFileSync(file, JSON.stringify({
    change: 'delivery-foundation-rearchitecture',
    scope: 'architecture gate acceptance case 2_5',
    requirementsDigest,
    designDigest,
  }, null, 2) + '\n');
  return file;
}

function ballot({ reviewId, agent, artifactSha256, verdict = 'APPROVE', overall = 9 }) {
  return {
    review_id: reviewId,
    round: 0,
    agent,
    artifact_sha256: artifactSha256,
    verdict,
    score: { overall, criteria: Object.fromEntries(ARCHITECTURE_CRITERIA.map((name) => [name, 9])) },
    findings: [],
    assumptions: [],
    confidence: 0.9,
    summary: `${agent} cold-start architecture review of ${reviewId}`,
  };
}

// A complete real mechanical run (real gate subprocesses, real files).
function fullRun({ root, reviewId, requirementsDigest, designDigest, questions = [], verdictFor }) {
  fsSync.mkdirSync(root, { recursive: true });
  const artifactPath = writePackageFile(root, { requirementsDigest, designDigest });
  const pkg = freezeReviewPackage({ reviewId, artifactPath, revision: 1 });
  const runRoot = path.join(root, 'review-runs');
  const init = initConsensusRun({ package: pkg, runRoot, initiator: 'claude-code' });
  assert.equal(init.ok, true, `real init: ${init.stderr ?? ''}`);
  for (const agent of P0_QUORUM) {
    const outcome = admitBallot({ package: pkg, runRoot, participant: agent, ballot: ballot({ reviewId, agent, artifactSha256: pkg.artifactSha256, verdict: verdictFor?.(agent) ?? 'APPROVE' }) });
    if (verdictFor) { /* dissents are expected to fail validate-free tally below */ }
    assert.equal(outcome.ok, true, `real ballot admission for ${agent}`);
  }
  const tally = mechanicalTally({ package: pkg, runRoot });
  let fin = null;
  if (tally.ok) {
    fin = mechanicalFinalize({ package: pkg, runRoot, conclusion: 'unanimous approval recorded by the real gate', nextPlan: 'non-blocking notes tracked in the implementation tasks' });
    assert.equal(fin.ok, true, `real finalize: ${fin.stderr ?? ''}`);
  }
  return { pkg, runRoot, init, tally, fin };
}

const codes = (judged) => judged.refusals.map((refusal) => refusal.code);

// --- 2.5.a — grill-me closure first, then the frozen quorum ------------------

test('2.5.a E03: unclosed grill-me load-bearing questions refuse submission; closure admits the unanimous real consensus', () => {
  const root = makeTmp('sdd-p25case-a-');
  const questions = openLoadBearingQuestions([
    { id: 'q-single-owner', question: 'does the review adapter write any phase or control state?' },
    { id: 'q-boundary', question: 'is the frozen package digest the substitution boundary?' },
  ]);
  const ran = fullRun({ root, reviewId: 'arch-case25-r1', requirementsDigest: sha('req-1'), designDigest: sha('design-1'), questions });
  assert.equal(ran.tally.exitCode, 0, 'precondition: the mechanical consensus itself is unanimous and PASSED');
  const judgedOpen = judgeArchitectureGate({ package: ran.pkg, runRoot: ran.runRoot, questions });
  assert.equal(judgedOpen.status, 'REFUSED', 'a unanimous consensus still does not pass with open load-bearing questions');
  assert.deepEqual(codes(judgedOpen), ['LOAD_BEARING_OPEN']);

  const pkg = freezeReviewPackage({ reviewId: 'arch-case25-r1', artifactPath: path.join(root, 'architecture-package.json'), revision: 1 });
  const closedOne = closeLoadBearingQuestion(questions, 'q-single-owner', 'resolved: the adapter is pure judgment + registration; no phase write surface exists');
  const step1 = judgeArchitectureGate({ package: pkg, runRoot: ran.runRoot, questions: closedOne });
  assert.equal(step1.status, 'REFUSED', 'partial closure keeps the gate closed');
  const accepted = judgeArchitectureGate({ package: pkg, runRoot: ran.runRoot, questions: closeLoadBearingQuestion(closedOne, 'q-boundary', 'resolved: artifact_sha256 is the boundary every ballot cites') });
  assert.equal(accepted.status, 'PASSED', 'closure of every load-bearing question admits the consensus');
});

test('2.5.a E03: the real quorum, thresholds and policy bind the frozen package digest — every field exact', () => {
  const root = makeTmp('sdd-p25case-bind-');
  const ran = fullRun({ root, reviewId: 'arch-case25-bind', requirementsDigest: sha('req-1'), designDigest: sha('design-1') });
  const manifest = JSON.parse(fsSync.readFileSync(path.join(ran.runRoot, 'arch-case25-bind', 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest.participants, P0_QUORUM, 'the frozen run carries the exact three-party quorum');
  assert.deepEqual(manifest.thresholds, REVIEW_THRESHOLDS, 'the frozen run carries the exact thresholds');
  assert.deepEqual(manifest.criteria, [...ARCHITECTURE_CRITERIA], 'the frozen run carries the exact per-criterion rubric');
  assert.equal(manifest.artifact_sha256, ran.pkg.artifactSha256, 'the run binds the frozen package digest');
  const judged = judgeArchitectureGate({ package: ran.pkg, runRoot: ran.runRoot, questions: [] });
  assert.equal(judged.status, 'PASSED');
  const receipt = judged.receipt;
  assert.deepEqual(receipt.quorum, P0_QUORUM);
  assert.equal(receipt.ballots.filter((entry) => entry.verdict === 'APPROVE').length, 3, 'all-APPROVE — a majority never substitutes');
  assert.equal(receipt.mechanical_tally_sha256, shaFile(path.join(ran.runRoot, 'arch-case25-bind', 'round-00', 'tally.json')), 'the tally digest is the real file');
  assert.equal(receipt.final_report_sha256, shaFile(path.join(ran.runRoot, 'arch-case25-bind', 'final-report.md')), 'the report digest is the real finalize output');
});

// --- 2.5.b — consume the mechanical result, resume the job, reject stale -----

test('2.5.b E03: missing ballots, dissents and old digests never pass the gate (real gate exits)', () => {
  // missing ballot
  const missingRoot = makeTmp('sdd-p25case-miss-');
  const missingPkg = freezeReviewPackage({ reviewId: 'arch-case25-miss', artifactPath: writePackageFile(missingRoot, { requirementsDigest: sha('r'), designDigest: sha('d') }), revision: 1 });
  const missingRun = path.join(missingRoot, 'review-runs');
  initConsensusRun({ package: missingPkg, runRoot: missingRun, initiator: 'claude-code' });
  for (const agent of P0_QUORUM.slice(0, 2)) {
    admitBallot({ package: missingPkg, runRoot: missingRun, participant: agent, ballot: ballot({ reviewId: missingPkg.reviewId, agent, artifactSha256: missingPkg.artifactSha256 }) });
  }
  const missingTally = mechanicalTally({ package: missingPkg, runRoot: missingRun });
  assert.equal(missingTally.exitCode, 1);
  assert.equal(missingTally.status, 'INCOMPLETE');
  assert.ok(codes(judgeArchitectureGate({ package: missingPkg, runRoot: missingRun, questions: [] })).includes('MISSING_BALLOT'), 'absence is a refusal, not an abstention-pass');

  // dissent → the majority never advances
  const dissent = fullRun({ root: makeTmp('sdd-p25case-dissent-'), reviewId: 'arch-case25-dissent', requirementsDigest: sha('r'), designDigest: sha('d'), verdictFor: (agent) => (agent === 'zcode' ? 'REJECT' : 'APPROVE') });
  assert.equal(dissent.tally.exitCode, 1);
  assert.equal(dissent.tally.status, 'DEBATE_REQUIRED');
  const dissentJudged = judgeArchitectureGate({ package: dissent.pkg, runRoot: dissent.runRoot, questions: [] });
  assert.equal(dissentJudged.status, 'REFUSED');
  assert.ok(codes(dissentJudged).includes('QUORUM_NOT_UNANIMOUS'), 'majority votes do not pass');

  // old digest: a ballot citing a superseded revision of the package
  const staleRoot = makeTmp('sdd-p25case-stale-');
  const stalePkg = freezeReviewPackage({ reviewId: 'arch-case25-stale', artifactPath: writePackageFile(staleRoot, { requirementsDigest: sha('r'), designDigest: sha('d') }), revision: 1 });
  const staleRun = path.join(staleRoot, 'review-runs');
  initConsensusRun({ package: stalePkg, runRoot: staleRun, initiator: 'claude-code' });
  const oldDigest = sha('the-previous-package-revision');
  for (const agent of P0_QUORUM) {
    admitBallot({ package: stalePkg, runRoot: staleRun, participant: agent, ballot: ballot({ reviewId: stalePkg.reviewId, agent, artifactSha256: oldDigest }) });
  }
  const staleTally = mechanicalTally({ package: stalePkg, runRoot: staleRun });
  assert.equal(staleTally.exitCode, 1, 'the real gate refuses every stale-digest ballot');
  const staleJudged = judgeArchitectureGate({ package: stalePkg, runRoot: staleRun, questions: [] });
  assert.equal(staleJudged.status, 'REFUSED');
  assert.ok(codes(staleJudged).includes('STALE_DIGEST'), 'the old digest is named as stale');
});

test('2.5.b H06: the same job_key resumes the original review job — no duplicate review is created', () => {
  const seat = createReviewJobSeat();
  const root = makeTmp('sdd-p25case-resume-');
  const ran = fullRun({ root, reviewId: 'arch-case25-job', requirementsDigest: sha('r'), designDigest: sha('d') });
  const claim = seat.claim({ jobKey: 'architecture-review:dfr', reviewId: ran.pkg.reviewId, artifactSha256: ran.pkg.artifactSha256, revision: 1 });
  assert.equal(claim.ok, true);
  // session resume / repeated trigger: the same job_key returns the SAME job
  const resume = seat.claim({ jobKey: 'architecture-review:dfr', reviewId: ran.pkg.reviewId, artifactSha256: ran.pkg.artifactSha256, revision: 1 });
  assert.equal(resume.resumed, true, 'same job_key resumes the original job');
  assert.deepEqual(resume.job, claim.job);
  // a duplicate review on the same manifest is refused by the real gate
  const dupe = initConsensusRun({ package: ran.pkg, runRoot: ran.runRoot, initiator: 'claude-code' });
  assert.equal(dupe.ok, false, 'no second review job for the same package');
  assert.match(dupe.stderr, /already exists/i);
  // a second job on the single seat is refused outright
  const other = seat.claim({ jobKey: 'architecture-review:elsewhere', reviewId: 'arch-elsewhere', artifactSha256: sha('x'), revision: 1 });
  assert.equal(other.ok, false);
  assert.equal(other.error, 'SINGLE_REVIEW_JOB');
  // the matching mechanical result completes the one job
  const done = seat.admitResult({ jobKey: 'architecture-review:dfr', reviewId: ran.pkg.reviewId, artifactSha256: ran.pkg.artifactSha256, revision: 1, attempt: 1, tally: { status: 'PASSED', review_id: ran.pkg.reviewId } });
  assert.equal(done.ok, true);
  assert.equal(done.completed, true);
});

test('2.5.b E04: a requirements/design change conservatively invalidates; restored bytes never auto-revive', () => {
  const root = makeTmp('sdd-p25case-e04-');
  const first = fullRun({ root: path.join(root, 'v1'), reviewId: 'arch-case25-v1', requirementsDigest: sha('req-1'), designDigest: sha('design-1') });
  assert.equal(first.tally.status, 'PASSED', 'precondition: v1 passed unanimously');

  // design change → old ballots invalid for the new frozen package
  const pkg2 = freezeReviewPackage({ reviewId: 'arch-case25-v2', artifactPath: writePackageFile(path.join(root, 'v2'), { requirementsDigest: sha('req-1'), designDigest: sha('design-2') }), revision: 2 });
  const run2 = path.join(root, 'v2', 'review-runs');
  initConsensusRun({ package: pkg2, runRoot: run2, initiator: 'claude-code' });
  for (const agent of P0_QUORUM) {
    const rejected = admitBallot({ package: pkg2, runRoot: run2, participant: agent, ballot: ballot({ reviewId: first.pkg.reviewId, agent, artifactSha256: first.pkg.artifactSha256 }) });
    assert.equal(rejected.ok, false, `old ballot of ${agent} cannot enter the new revision`);
  }
  const judgedNew = judgeArchitectureGate({ package: pkg2, runRoot: run2, questions: [] });
  assert.equal(judgedNew.status, 'REFUSED', 'the new revision cold-starts with no inherited approval');
  fsSync.cpSync(path.join(first.runRoot, 'arch-case25-v1'), path.join(first.runRoot, 'arch-case25-v2'), { recursive: true });
  const oldOnNew = judgeArchitectureGate({ package: pkg2, runRoot: first.runRoot, questions: [] });
  assert.ok(codes(oldOnNew).includes('REVIEW_REVISION_MISMATCH'), 'the old receipt never satisfies the new package');

  // restore the exact old design bytes — no auto-revival
  const restored = freezeReviewPackage({ reviewId: 'arch-case25-v3', artifactPath: writePackageFile(path.join(root, 'v3'), { requirementsDigest: sha('req-1'), designDigest: sha('design-1') }), revision: 3 });
  assert.equal(restored.artifactSha256, first.pkg.artifactSha256, 'the restored digest equals the original');
  fsSync.cpSync(path.join(first.runRoot, 'arch-case25-v1'), path.join(first.runRoot, 'arch-case25-v3'), { recursive: true });
  const revived = judgeArchitectureGate({ package: restored, runRoot: first.runRoot, questions: [] });
  assert.equal(revived.status, 'REFUSED', 'restoring the digest does not revive the old consensus');
  assert.ok(codes(revived).includes('REVIEW_REVISION_MISMATCH'));

  // downstream evidence bound to the review is invalidated with it (P2_1 reuse)
  const result = invalidateOnScopeChange({
    changed: { kind: ARCHITECTURE_REVIEW_BASELINE_KIND, digest: pkg2.artifactSha256, revision: 2 },
    receipts: [
      { id: 'review-bound-receipt', boundDigests: { [ARCHITECTURE_REVIEW_BASELINE_KIND]: first.pkg.artifactSha256 }, boundRevisions: { [ARCHITECTURE_REVIEW_BASELINE_KIND]: 1 } },
      { id: 'product-bound-receipt', boundDigests: { product: sha('product-1') } },
    ],
  });
  assert.deepEqual(result.invalidated.map((entry) => entry.id), ['review-bound-receipt']);
  assert.deepEqual(result.valid.map((entry) => entry.id), ['product-bound-receipt']);
});

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
import test, { afterEach } from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { REVIEW_PARTICIPANTS, REVIEW_THRESHOLDS, ARCHITECTURE_CRITERIA, ARCHITECTURE_REVIEW_BASELINE_KIND,
  freezeReviewPackage, initConsensusRun, admitBallot, mechanicalTally, mechanicalFinalize,
  openLoadBearingQuestions, closeLoadBearingQuestion,
  judgeArchitectureGate, createReviewJobSeat, consumeArchitectureGate, consumeTestDesignReview }
  = await import(path.join(projectRoot, 'lib/adapters/architecture-review.js'));
const { invalidateOnScopeChange } = await import(path.join(projectRoot, 'lib/delivery/baseline.js'));
const { createLaunchAuthority } = await import(path.join(projectRoot, 'lib/delivery/evidence.js'));

const sha = (data) => crypto.createHash('sha256').update(data).digest('hex');
const shaFile = (file) => sha(fsSync.readFileSync(file));
const P0_QUORUM = ['claude-code', 'zcode', 'codex-agent'];

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
function fullRun({ root, reviewId, requirementsDigest, designDigest, questions = [], verdictFor, finalize }) {
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
  if (tally.ok && finalize !== false) {
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

// --- rework P1-02/P1-03: consumption through the REAL intake (not the pure
// adapter alone): the launcher-issued dispatch (Runner.Dispatch.v1 local
// equivalent) carries the trusted execution identity and binds the frozen
// artifactDigest; the T gate consumes sufficiency + attested oracle strength
// from ONE independent review; consumption is monotonic in the revision. -----

test('2.5.b E03: the architecture gate consumes the consensus only through a launcher-issued dispatch bound to the frozen artifactDigest — fake origins and missing reports never pass', () => {
  const authority = createLaunchAuthority({ secret: crypto.randomBytes(32).toString('hex') });
  const dispatchFor = (inputDigest, overrides = {}) => authority.issueDispatch({
    runnerId: 'review-runner-1', run: 'run-arch-dfr', gate: 'A', role: 'verifier',
    execution: 'exec-arch-review-1', inputDigest, policyDigest: sha('policy/arch-r1'),
    attempt: 1, epoch: 1, ...overrides,
  });
  const consume = (pkg, runRoot, dispatch) => consumeArchitectureGate({ package: pkg, runRoot, questions: [], dispatch, authority });

  // positive: closed unanimous consensus + dispatch bound to the frozen digest
  const root = makeTmp('sdd-p25case-intake-');
  const ran = fullRun({ root, reviewId: 'arch-case25-intake', requirementsDigest: sha('req-i'), designDigest: sha('design-i') });
  assert.equal(ran.tally.exitCode, 0, 'precondition: the real consensus is closed and unanimous');
  const consumed = consume(ran.pkg, ran.runRoot, dispatchFor(ran.pkg.artifactSha256));
  assert.equal(consumed.ok, true, `the launcher-issued dispatch consumes the closed consensus: ${consumed.error ?? ''}`);
  assert.equal(consumed.judged.status, 'PASSED', 'the consumed judgment is the real mechanical one');
  assert.equal(consumed.execution, 'exec-arch-review-1', 'the trusted execution identity travels with the receipt');

  // fake origin: an identically-bound dispatch the launcher never signed
  const rogue = createLaunchAuthority({ secret: crypto.randomBytes(32).toString('hex') });
  const forged = consume(ran.pkg, ran.runRoot, rogue.issueDispatch({
    runnerId: 'review-runner-1', run: 'run-arch-dfr', gate: 'A', role: 'verifier',
    execution: 'exec-arch-review-1', inputDigest: ran.pkg.artifactSha256, policyDigest: sha('policy/arch-r1'),
    attempt: 1, epoch: 1,
  }));
  assert.equal(forged.ok, false, 'a worker-minted dispatch never consumes the consensus');
  assert.equal(forged.error, 'FORGED_DISPATCH', 'the refusal names the missing launcher integrity');
  // fake origin: no dispatch at all — a self-declared review is not a registered source
  const none = consumeArchitectureGate({ package: ran.pkg, runRoot: ran.runRoot, questions: [] });
  assert.equal(none.ok, false);
  assert.equal(none.error, 'UNREGISTERED_SOURCE');

  // the builder execution cannot sign the architecture acceptance
  const builder = consume(ran.pkg, ran.runRoot, dispatchFor(ran.pkg.artifactSha256, { role: 'builder', execution: 'exec-builder-9' }));
  assert.equal(builder.ok, false);
  assert.equal(builder.error, 'IDENTITY_CONFLICT');

  // a dispatch bound to another artifactDigest never consumes this package
  const unbound = consume(ran.pkg, ran.runRoot, dispatchFor(sha('some-other-material')));
  assert.equal(unbound.ok, false);
  assert.equal(unbound.error, 'ARTIFACT_DIGEST_MISMATCH', 'the artifactDigest is bound to the dispatch');

  // missing report: a passed tally without the real finalize never completes the intake
  const noFin = fullRun({ root: makeTmp('sdd-p25case-nofin-'), reviewId: 'arch-case25-nofin', requirementsDigest: sha('r'), designDigest: sha('d'), finalize: false });
  assert.equal(noFin.tally.exitCode, 0, 'precondition: the tally itself passed');
  const noFinJudged = judgeArchitectureGate({ package: noFin.pkg, runRoot: noFin.runRoot, questions: [] });
  assert.deepEqual(codes(noFinJudged), ['FINAL_REPORT_REQUIRED'], 'precondition: the judge names the missing report');
  const noFinConsumed = consume(noFin.pkg, noFin.runRoot, dispatchFor(noFin.pkg.artifactSha256));
  assert.equal(noFinConsumed.ok, false, 'consumption never overrides the judgment');
  assert.equal(noFinConsumed.error, 'CONSENSUS_NOT_ADMITTED');
  assert.ok(noFinConsumed.refusals.some((refusal) => refusal.code === 'FINAL_REPORT_REQUIRED'), 'the underlying refusal surfaces through the intake');

  // a refused consensus (one rejection) with a perfectly valid dispatch is still not consumed
  const dissent = fullRun({ root: makeTmp('sdd-p25case-dintake-'), reviewId: 'arch-case25-dintake', requirementsDigest: sha('r'), designDigest: sha('d'), verdictFor: (agent) => (agent === 'zcode' ? 'REJECT' : 'APPROVE') });
  const dissentConsumed = consume(dissent.pkg, dissent.runRoot, dispatchFor(dissent.pkg.artifactSha256));
  assert.equal(dissentConsumed.ok, false);
  assert.equal(dissentConsumed.error, 'CONSENSUS_NOT_ADMITTED');
  assert.ok(dissentConsumed.refusals.some((refusal) => refusal.code === 'QUORUM_NOT_UNANIMOUS'));
});

test('2.5.b E04: consumption is monotonic in the frozen revision — the old one-shot dispatch never covers new or restored material; a new revision re-reviews and re-binds', () => {
  const authority = createLaunchAuthority({ secret: crypto.randomBytes(32).toString('hex') });
  const dispatchFor = (inputDigest, execution) => authority.issueDispatch({
    runnerId: 'review-runner-1', run: 'run-arch-dfr', gate: 'A', role: 'verifier',
    execution, inputDigest, policyDigest: sha('policy/arch-r1'), attempt: 1, epoch: 1,
  });
  const consume = (pkg, runRoot, dispatch) => consumeArchitectureGate({ package: pkg, runRoot, questions: [], dispatch, authority });

  const root = makeTmp('sdd-p25case-monotonic-');
  const first = fullRun({ root: path.join(root, 'v1'), reviewId: 'arch-case25-mono-v1', requirementsDigest: sha('req-1'), designDigest: sha('design-1') });
  assert.equal(first.tally.status, 'PASSED', 'precondition: revision 1 passed unanimously');
  const firstDispatch = dispatchFor(first.pkg.artifactSha256, 'exec-arch-review-v1');
  const firstConsumed = consume(first.pkg, first.runRoot, firstDispatch);
  assert.equal(firstConsumed.ok, true, 'precondition: revision 1 consumes through its own dispatch');

  // design change → the old dispatch (one-shot authorization) does not cover the new material
  const pkg2 = freezeReviewPackage({ reviewId: 'arch-case25-mono-v2', artifactPath: writePackageFile(path.join(root, 'v2'), { requirementsDigest: sha('req-1'), designDigest: sha('design-2') }), revision: 2 });
  const oldOnNew = consume(pkg2, path.join(root, 'v2', 'review-runs'), firstDispatch);
  assert.equal(oldOnNew.ok, false, 'the revision-1 dispatch is not valid authorization for revision 2');
  assert.equal(oldOnNew.error, 'ARTIFACT_DIGEST_MISMATCH');

  // restore the exact v1 bytes under a NEW revision: same digest, old consensus, old dispatch — no revival.
  // The real presentation path: the old consensus run is forwarded under the new revision's name.
  const restored = freezeReviewPackage({ reviewId: 'arch-case25-mono-v3', artifactPath: writePackageFile(path.join(root, 'v3'), { requirementsDigest: sha('req-1'), designDigest: sha('design-1') }), revision: 3 });
  assert.equal(restored.artifactSha256, first.pkg.artifactSha256, 'the restored bytes digest back to the original');
  fsSync.cpSync(path.join(first.runRoot, 'arch-case25-mono-v1'), path.join(first.runRoot, 'arch-case25-mono-v3'), { recursive: true });
  const revived = consume(restored, first.runRoot, firstDispatch);
  assert.equal(revived.ok, false, 'restoring the bytes never re-consumes the old consensus');
  assert.equal(revived.error, 'CONSENSUS_NOT_ADMITTED');
  assert.ok(revived.refusals.some((refusal) => refusal.code === 'REVIEW_REVISION_MISMATCH'), 'the refusal is the revision identity, not the digest');

  // the new revision re-reviews cold and re-binds a NEW dispatch — admitted again
  const second = fullRun({ root: path.join(root, 'v2-review'), reviewId: 'arch-case25-mono-v2', requirementsDigest: sha('req-1'), designDigest: sha('design-2') });
  assert.equal(second.pkg.artifactSha256, pkg2.artifactSha256, 'the re-review freezes the same revision-2 digest');
  assert.equal(second.tally.status, 'PASSED', 'precondition: revision 2 re-reviewed unanimously on its own ballots');
  const secondConsumed = consume(second.pkg, second.runRoot, dispatchFor(pkg2.artifactSha256, 'exec-arch-review-v2'));
  assert.equal(secondConsumed.ok, true, 'a fresh review with a fresh dispatch is completable');
  assert.equal(secondConsumed.judged.receipt.artifact_sha256, pkg2.artifactSha256, 'the consumed receipt binds the new revision digest');
  assert.notEqual(secondConsumed.judged.receipt.artifact_sha256, firstConsumed.judged.receipt.artifact_sha256, 'nothing is inherited across revisions');
  assert.notEqual(secondConsumed.judged.receipt.mechanical_tally_sha256, firstConsumed.judged.receipt.mechanical_tally_sha256, 'the new revision keeps its own real tally bytes');
});

test('2.5.b H06: late results of old attempts and superseded manifests are observed only — they never complete the review job', () => {
  const root = makeTmp('sdd-p25case-late-');
  const ran = fullRun({ root, reviewId: 'arch-case25-late-v1', requirementsDigest: sha('r'), designDigest: sha('d') });
  assert.equal(ran.tally.status, 'PASSED', 'precondition: the consensus passed');
  const seat = createReviewJobSeat();
  const binding = (attempt, reviewId = ran.pkg.reviewId, artifactSha256 = ran.pkg.artifactSha256, revision = 1) =>
    ({ jobKey: 'architecture-review:dfr', reviewId, artifactSha256, revision, attempt });
  assert.equal(seat.claim(binding(1)).ok, true, 'the job is claimed at attempt 1');
  assert.equal(seat.claim(binding(2)).ok, true, 'a re-ballot round bumps the attempt on the same job');

  const late = seat.admitResult({ ...binding(1), tally: { status: 'PASSED', review_id: ran.pkg.reviewId } });
  assert.equal(late.ok, false, 'a late result of the old attempt never completes the job');
  assert.equal(late.error, 'STALE_ATTEMPT');

  // the design changes: revision 2 supersedes the held job
  const pkg2 = freezeReviewPackage({ reviewId: 'arch-case25-late-v2', artifactPath: writePackageFile(path.join(root, 'v2'), { requirementsDigest: sha('r'), designDigest: sha('d2') }), revision: 2 });
  const superseded = seat.claim(binding(1, pkg2.reviewId, pkg2.artifactSha256, 2));
  assert.equal(superseded.ok, true);
  assert.equal(superseded.superseded, ran.pkg.reviewId, 'the old job is superseded, its record kept');
  const oldManifest = seat.admitResult({ ...binding(1), tally: { status: 'PASSED', review_id: ran.pkg.reviewId } });
  assert.equal(oldManifest.ok, false, 'a result of the superseded manifest cannot complete the new task');
  assert.equal(oldManifest.error, 'STALE_REVIEW');

  // only the current manifest's own mechanical result completes
  const done = seat.admitResult({ ...binding(1, pkg2.reviewId, pkg2.artifactSha256, 2), tally: { status: 'PASSED', review_id: pkg2.reviewId } });
  assert.equal(done.ok, true);
  assert.equal(done.completed, true);
});

test('boundary: the T gate consumes sufficiency and attested oracle strength from ONE independent review — weak oracles refused, no consensus quorum imposed on T', () => {
  const authority = createLaunchAuthority({ secret: crypto.randomBytes(32).toString('hex') });
  const current = { inputDigest: sha('test-contract-input-r1') };
  const dispatchFor = (inputDigest, overrides = {}) => authority.issueDispatch({
    runnerId: 'review-runner-2', run: 'run-test-design', gate: 'T', role: 'verifier',
    execution: 'exec-test-review-1', inputDigest, policyDigest: sha('policy/test-design-r1'),
    attempt: 1, epoch: 1, ...overrides,
  });
  const reviewFor = (overrides = {}) => ({
    candidateDigest: current.inputDigest,
    sufficient: true,
    oracleStrength: 'strong',
    summary: 'the case observes the WHEN/THEN oracle at the contract boundary; the RED is behavior-grounded',
    ...overrides,
  });
  const consume = (review, dispatch = dispatchFor(current.inputDigest), now = current) =>
    consumeTestDesignReview({ dispatch, authority, current: now, review, authorExecution: 'exec-test-author-1' });

  // one independent review with a strong attested oracle is fully sufficient
  const strong = consume(reviewFor());
  assert.equal(strong.ok, true, `a single strong-oracle review consumes: ${strong.error ?? ''}`);
  assert.equal(strong.execution, 'exec-test-review-1');
  assert.equal(strong.oracleStrength, 'strong');
  const adequate = consume(reviewFor({ oracleStrength: 'adequate' }));
  assert.equal(adequate.ok, true, 'an adequate attested oracle also admits — the T gate stays a single automatic review');

  // weak, unknown and missing oracle strengths are refused
  for (const [strength, label] of [['weak', 'weak'], ['aggressive', 'unknown'], [undefined, 'missing']]) {
    const refused = consume(reviewFor({ oracleStrength: strength }));
    assert.equal(refused.ok, false, `the ${label} oracle strength never consumes`);
    assert.equal(refused.error, 'ORACLE_STRENGTH_REFUSED', `the ${label} refusal names the oracle strength`);
  }

  // the sufficiency conclusion must be affirmative and written
  const insufficient = consume(reviewFor({ sufficient: false }));
  assert.equal(insufficient.ok, false);
  assert.equal(insufficient.error, 'SUFFICIENCY_CONCLUSION_REQUIRED');
  const unwritten = consume(reviewFor({ summary: '   ' }));
  assert.equal(unwritten.ok, false);
  assert.equal(unwritten.error, 'REVIEW_SUMMARY_REQUIRED');

  // the original one-shot authorization does not automatically cover new material
  const newMaterial = { inputDigest: sha('test-contract-input-r2') };
  const stale = consume(reviewFor(), dispatchFor(current.inputDigest), newMaterial);
  assert.equal(stale.ok, false, 'the revision-1 dispatch does not authorize the revision-2 review');
  assert.equal(stale.error, 'STALE_AUTHORIZATION');
  const foreign = consume(reviewFor({ candidateDigest: sha('something-else') }));
  assert.equal(foreign.ok, false, 'a review citing other material is not a review of the dispatched candidate');
  assert.equal(foreign.error, 'REVIEW_MATERIAL_MISMATCH');

  // identity: the test author cannot attest their own design; neither can the builder
  const self = consume(reviewFor(), dispatchFor(current.inputDigest, { execution: 'exec-test-author-1' }));
  assert.equal(self.ok, false);
  assert.equal(self.error, 'SELF_REVIEW');
  const builder = consume(reviewFor(), dispatchFor(current.inputDigest, { role: 'builder', execution: 'exec-builder-2' }));
  assert.equal(builder.ok, false);
  assert.equal(builder.error, 'IDENTITY_CONFLICT');

  // fake origin: a dispatch the launcher never signed
  const rogue = createLaunchAuthority({ secret: crypto.randomBytes(32).toString('hex') });
  const forged = consume(reviewFor(), rogue.issueDispatch({
    runnerId: 'review-runner-2', run: 'run-test-design', gate: 'T', role: 'verifier',
    execution: 'exec-test-review-1', inputDigest: current.inputDigest, policyDigest: sha('policy/test-design-r1'),
    attempt: 1, epoch: 1,
  }));
  assert.equal(forged.ok, false);
  assert.equal(forged.error, 'FORGED_DISPATCH');
  const none = consumeTestDesignReview({ current, review: reviewFor() });
  assert.equal(none.ok, false);
  assert.equal(none.error, 'UNREGISTERED_SOURCE');
});

// Run in fresh Node processes so the original Native module owns one fixed
// host per process. Reviewer records below are explicit DATA fixtures, not
// production principals, actual model reviews or OS isolation evidence.
async function nativeReviewScenario(config) {
  const assert = (await import('node:assert/strict')).default;
  const fs = (await import('node:fs')).default;
  const path = (await import('node:path')).default;
  const crypto = (await import('node:crypto')).default;
  const { pathToFileURL } = await import('node:url');
  const { createLaunchAuthority, admitEvidence, envelopeDigest } = await import(pathToFileURL(path.join(config.repository, 'lib/delivery/evidence.js')));
  const { evaluate } = await import(pathToFileURL(path.join(config.repository, 'lib/delivery/gate.js')));
  const { taskDefinitionDigest } = await import(pathToFileURL(path.join(config.repository, 'lib/delivery/baseline.js')));
  const review = await import(pathToFileURL(path.join(config.repository, 'lib/adapters/architecture-review.js')));
  const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');
  assert.equal(sha(fs.readFileSync(config.nativePath)), config.nativeSha, 'exact accepted Native aggregate bytes');
  const native = await import(pathToFileURL(config.nativePath));
  const project = path.join(config.scratch, 'project'), artifacts = path.join(config.scratch, 'artifacts');
  for (const directory of [project, artifacts]) fs.mkdirSync(directory, { recursive: true });
  const change = path.join(project, 'openspec/changes/fixture');
  const lockHeld = () => fs.existsSync(path.join(change, '.comet-state.lock'));
  const commands = [], packets = new Map(), prepared = new Map(), contexts = new Map();
  const records = new Map();
  const qualification = { id: 'fixture-only-NOT-PRODUCTION', sourceId: 'fixture-recorded-source', revision: 'fixture-1',
    scope: 'protected-source', status: 'qualified', expiresAt: '2099-01-01T00:00:00Z',
    evidenceRefs: [{ ref: 'fixture/data-records', digest: sha('no-real-reviewer-or-OS-qualification') }] };
  const policy = { ...config.policy, openSpecBinding: config.openSpecBinding };
  const targetContract = { schemaVersion: 1, commandBindingsRequired: true, project: 'fixture', change: 'fixture',
    cases: [{ id: 'design-denial', ac: 'E03', oracle: 'an unregistered review cannot pass the architecture or test-design gate', checkIds: ['semantic-review'] }],
    requiredChecks: [{ id: 'semantic-review', level: 'review', capability: 'design-review', command: 'fixture:review-target-design', caseIds: ['design-denial'] }],
    executionDenominator: { totalCases: 1 }, cleanup: { environment: 'remove private fixture', data: 'no production data' },
    dependencyBaselines: [{ kind: 'fixture-design', digest: sha('fixture-design') }] };
  const method = (name) => ({ name, version: 'vendored-construction-only', ref: `.agents/skills/${name}/SKILL.md`,
    digest: sha(fs.readFileSync(path.join(config.repository, '.agents/skills', name, 'SKILL.md'))) });
  const methods = { R: [method('grill-me')], A: [method('multi-agent-consensus-review')], T: [method('test-authoring')], P: [method('claude-parallel-tdd-planner')] };
  let architecture = null, missingSource = false;
  if (config.stage === 'resume') architecture = JSON.parse(fs.readFileSync(path.join(artifacts, 'architecture-binding.json')));
  const baseOptions = () => ({ sourceQualification: qualification, environment: 'fixture-environment', purpose: 'independent-acceptance',
    builderExecution: 'fixture-builder', builderPrincipal: 'fixture-builder-principal', authoringExecutions: ['fixture-test-author'],
    authoringPrincipals: ['fixture-test-author-principal'], consumedCollections: [], issuedExecutions: [], now: new Date().toISOString() });
  const context = (intent) => {
    const run = intent.runId ?? intent.actionBinding?.run;
    const action = { schemaVersion: 1, profile: 'comet-managed-v2', runnerId: 'fixture-native-source', run, gate: intent.gate,
      action: `${intent.gate}-review`, execution: intent.execution, role: intent.role, revision: `r${intent.generation}`,
      attempt: intent.attempt, epoch: intent.epoch, inputDigest: intent.inputDigest, policyDigest: policy.digest,
      environmentDigest: policy.controllerEnvironmentDigest, workPackage: { id: intent.jobKey ?? intent.execution, taskIds: ['2.5'] },
      methods: methods[intent.gate], allowedPaths: ['.whitebox'], allowedTools: ['read_file'],
      inputs: intent.gate === 'A' ? architecture.inputs : [{ name: 'test-contract', ref: '.whitebox/target-contract.json', digest: envelopeDigest(targetContract) }],
      outputs: [{ name: 'review', ref: '.whitebox/review.md' }] };
    return { actionBinding: action, policy, admissionOptions: baseOptions(), testContract: {
      ...targetContract, cases: [{ id: `native.${intent.gate}`, ac: 'P2_5-native-mechanism', oracle: 'the original completed source is bound to the current Native gate', checkIds: ['native-review'] }],
      requiredChecks: [{ id: 'native-review', level: 'review', capability: `native:${intent.gate}`, command: `fixture:original-review:${intent.gate}`, caseIds: [`native.${intent.gate}`] }],
    } };
  };
  const authority = createLaunchAuthority({ secret: 'public-test-fixture-key-not-a-production-credential', sourceVerifier: async (request) => {
    const known = records.get(request.dispatch.execution);
    if (!known || ['reportBytes', 'resultBytes', 'methodTraceBytes'].some((key) => !Buffer.from(known[key]).equals(Buffer.from(request[key])))) return { ok: false };
    const { dispatch, envelope, launchRecord, reportBytes, resultBytes, methodTraceBytes } = known;
    return { ok: true, qualification, facts: { actionDigest: envelopeDigest(dispatch.actionBinding), dispatchDigest: envelopeDigest(dispatch),
      envelopeDigest: envelopeDigest(envelope), launchDigest: envelopeDigest(launchRecord), reportDigest: sha(reportBytes), resultDigest: sha(resultBytes), methodTraceDigest: sha(methodTraceBytes),
      run: dispatch.run, execution: dispatch.execution, launchId: launchRecord.launchId, environmentDigest: dispatch.actionBinding.environmentDigest,
      principal: known.principal, observations: [{ caseId: envelope.caseId, check: envelope.check, command: `fixture:original-review:${dispatch.gate}`, result: envelope.result, executions: envelope.executions }] } };
  } });
  const source = async (action, { result, rawResult, report = 'Fixture completed original source; no actual model review is claimed.', principal = 'fixture-independent-principal', dispatch } = {}) => {
    const signed = dispatch ?? authority.issueDispatch({ ...action, actionBinding: action }); // private data signer only
    const reportBytes = Buffer.from(report), resultBytes = rawResult ?? Buffer.from(JSON.stringify(result));
    const methodTraceBytes = Buffer.from(JSON.stringify({ schemaVersion: 1, run: action.run, execution: action.execution,
      actionDigest: envelopeDigest(action), methods: action.methods.map((item) => ({ ...item, status: 'completed' })) }));
    const envelope = { schemaVersion: 1, candidateDigest: action.inputDigest, caseId: `native.${action.gate}`, check: `native:${action.gate}`,
      origin: { kind: 'registered-runner', id: action.runnerId }, execution: { id: action.execution }, environment: 'fixture-environment',
      toolchain: `node ${process.version}`, executions: { total: 1, valid: 1 }, result: 'pass', evidence: [{ uri: '.whitebox/review.md', sha256: sha(reportBytes) }], expiry: '2099-01-01T00:00:00Z' };
    const packet = { dispatch: signed, envelope, launchRecord: { launchId: `fixture-launch:${action.execution}`, execution: action.execution }, reportBytes, resultBytes, methodTraceBytes };
    records.set(action.execution, { ...packet, principal });
    const collected = await authority.collectResult(packet);
    assert.equal(collected.ok, true);
    return { ...packet, collection: collected.collection };
  };
  const host = { authority: { ...authority, issueDispatch(binding) { assert.equal(lockHeld(), true, 'only original Native registers the primary job under its short lock'); return authority.issueDispatch(binding); } },
    policy: () => policy, context, definitionDigest: taskDefinitionDigest, authorizeWrite: () => ({ allowed: false }), admitEvidence, evaluate,
    readResult: async (intent) => {
      assert.equal(lockHeld(), false, 'collection and mechanical recheck run outside the original state lock');
      const packet = packets.get(intent.execution);
      if (!packet) throw new Error('UNVERIFIED: original source has no completed result');
      if (intent.gate === 'A' || intent.gate === 'T') {
        const current = contexts.get(intent.execution);
        const actual = missingSource && intent.gate === 'A' ? { ...current, reviewers: current.reviewers.slice(0, 2) } : current;
        const result = intent.gate === 'A'
          ? review.consumeArchitectureGate({ package: architecture.pkg, runRoot: architecture.runRoot, questions: architecture.questions, authority, managed: actual })
          : review.consumeTestDesignReview({ authority, managed: actual });
        if (!result.ok) throw new Error(`UNVERIFIED: ${result.error}`);
        prepared.set(intent.execution, result);
      }
      return packet;
    },
    verifyReview: (request) => {
      const entry = request.entry;
      if (['A', 'T'].includes(entry.dispatch.gate)) {
        const known = prepared.get(entry.execution);
        const current = contexts.get(entry.execution);
        return known?.verifyReview(request, { ...current, admissionOptions: baseOptions() }) ?? { ok: false };
      }
      // R/P here exercise existing Core source mechanics only. They are not
      // substitutes for their original owners' real methods/semantic reviews.
      return { ok: true, sufficient: true, evidenceDigest: sha('fixture-R-P-component-only'), envelopeDigest: entry.digest,
        reportDigest: entry.sourcePacket.collection.reportDigest, actionDigest: entry.sourcePacket.collection.actionDigest,
        execution: entry.execution, principal: entry.sourcePacket.collection.source.facts.principal };
    } };
  native.installManagedDeliveryHost(host);
  const invoke = async (argv) => {
    const result = await native.runClassicCli(['--json', 'state', ...argv], undefined, { projectRoot: project, invocationCwd: project });
    const json = JSON.parse(result.stdout ?? '{}');
    commands.push({ argv: ['state', ...argv], exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr });
    fs.appendFileSync(path.join(config.auditDir, `${config.stage}-commands.raw.jsonl`), JSON.stringify({ at: new Date().toISOString(), ...commands.at(-1) }) + '\n');
    return { ...result, json };
  };
  const ok = async (argv) => { const result = await invoke(argv); assert.equal(result.exitCode, 0, JSON.stringify(result.json)); return result; };
  const issue = async (gate) => (await ok(['dispatch-gate', 'fixture', gate])).json.data.dispatch;
  const accept = async (intent) => {
    const file = path.join(artifacts, 'proposal-result.json');
    fs.writeFileSync(file, JSON.stringify({ execution: intent.execution, attempt: intent.attempt, verdict: 'pass' }));
    return invoke(['accept-gate', 'fixture', intent.gate, '--file', file]);
  };
  const originalRun = () => JSON.parse(fs.readFileSync(path.join(change, '.comet/run-state.json'))).runId;
  const observeSimple = async (intent) => { const c = context(intent); packets.set(intent.execution, await source(c.actionBinding, { result: { fixture: true }, dispatch: intent.protectedDispatch })); };
  if (config.stage === 'start') {
    fs.mkdirSync(path.join(project, '.comet'), { recursive: true });
    fs.writeFileSync(path.join(project, '.comet/config.yaml'), 'schema: comet.project.v1\ndefault_workflow: classic\nworkflows: [classic]\nclassic:\n  artifact_layout: legacy\n');
    fs.mkdirSync(path.join(project, 'openspec'), { recursive: true });
    fs.writeFileSync(path.join(project, 'openspec/config.yaml'), 'schema: spec-driven\n');
    await ok(['init', 'fixture', 'full', '--managed-delivery']);
    fs.writeFileSync(path.join(change, 'proposal.md'), '# Requirements\n\nOnly the original Comet Run owns delivery state and recovery.\n');
    const r = await issue('R'); await observeSimple(r); assert.equal((await accept(r)).exitCode, 0);
    fs.writeFileSync(path.join(change, 'tasks.md'), '- [ ] Validate original review mechanisms. <!-- comet-task:task1 -->\n');
    await ok(['transition', 'fixture', 'open-complete']);
    fs.mkdirSync(path.join(project, 'docs/comet/plans'), { recursive: true });
    fs.writeFileSync(path.join(project, 'docs/design.md'), '---\ncomet_change: fixture\nrole: technical-design\ncanonical_spec: openspec\n---\n# Design\n\nOne Native Run owns the review job.\n');
    fs.writeFileSync(path.join(change, 'design.md'), '# Design\n\nNo second controller.\n');
    fs.writeFileSync(path.join(change, 'test-intent.md'), '# Test design\n\nCheck current source, oracle, environment and cleanup.\n');
    await ok(['set', 'fixture', 'design_doc', 'docs/design.md', 'test_intent', 'openspec/changes/fixture/test-intent.md']);
    const questions = review.closeLoadBearingQuestion(review.openLoadBearingQuestions([{ id: 'owner', question: 'Who resumes a review?' }]), 'owner', 'The original Native pending dispatch resumes; no second phase or job ledger.');
    const closure = { schemaVersion: 1, requirementsDigest: sha(fs.readFileSync(path.join(change, 'proposal.md'))), designDigest: sha(fs.readFileSync(path.join(project, 'docs/design.md'))), questions };
    const grillBytes = Buffer.from(JSON.stringify(closure));
    const artifactPath = path.join(artifacts, 'architecture-package.json');
    fs.writeFileSync(artifactPath, JSON.stringify({ requirementsDigest: closure.requirementsDigest, designDigest: closure.designDigest, grillDigest: sha(grillBytes) }));
    const pkg = review.freezeReviewPackage({ reviewId: 'native-current-architecture-r1', artifactPath, revision: 1 });
    const inputs = [{ name: 'requirements', ref: 'openspec/changes/fixture/proposal.md', digest: closure.requirementsDigest },
      { name: 'design', ref: 'docs/design.md', digest: closure.designDigest }, { name: 'architecture-package', ref: '.whitebox/package.json', digest: pkg.artifactSha256 },
      { name: 'grill-closure', ref: '.whitebox/grill.json', digest: sha(grillBytes) }];
    architecture = { pkg, inputs, questions, closure, runRoot: path.join(artifacts, 'consensus') };
    fs.writeFileSync(path.join(artifacts, 'architecture-binding.json'), JSON.stringify(architecture));
    const a = await issue('A');
    assert.equal((await issue('A')).execution, a.execution, 'same original pending job is returned on a repeated trigger');
    return { stage: 'start', runId: originalRun(), execution: a.execution, attempt: a.attempt, generation: a.generation,
      jobKey: a.jobKey ?? null, commands, scope: 'component/native-review-mechanism', actualRolesMethodsOS: 'UNVERIFIED' };
  }
  const a = await issue('A');
  assert.equal(originalRun(), config.expected.runId, 'a fresh process resumes the same original Run');
  assert.equal(a.execution, config.expected.execution, 'fresh host resumes the original execution without new dispatch');
  assert.equal(a.attempt, config.expected.attempt);
  const cA = context(a), action = cA.actionBinding;
  const grillAction = { ...action, execution: `${a.execution}:grill`, role: 'architect', methods: [method('grill-me')], inputs: architecture.inputs.slice(0, 2) };
  const grill = await source(grillAction, { result: architecture.closure, principal: 'fixture-architect-principal' });
  assert.equal(review.initConsensusRun({ package: architecture.pkg, runRoot: architecture.runRoot, initiator: 'codex-agent', questions: architecture.questions }).ok, true);
  const reviewers = [];
  for (const participant of review.REVIEW_PARTICIPANTS) {
    const paper = { review_id: architecture.pkg.reviewId, round: 0, agent: participant, artifact_sha256: architecture.pkg.artifactSha256,
      verdict: 'APPROVE', score: { overall: 9, criteria: Object.fromEntries(review.ARCHITECTURE_CRITERIA.map((key) => [key, 9])) }, findings: [], assumptions: [], confidence: 0.9,
      summary: 'Private fixture ballot; no external model was called.' };
    assert.equal(review.admitBallot({ package: architecture.pkg, runRoot: architecture.runRoot, participant, ballot: paper }).ok, true);
    const rawResult = fs.readFileSync(path.join(architecture.runRoot, architecture.pkg.reviewId, 'round-00', `ballot-${participant}.json`));
    const childAction = { ...action, execution: `${a.execution}:${participant}` };
    reviewers.push({ participant, packet: await source(childAction, { rawResult, principal: `fixture-independent:${participant}` }) });
  }
  assert.equal(review.mechanicalTally({ package: architecture.pkg, runRoot: architecture.runRoot }).ok, true);
  assert.equal(review.mechanicalFinalize({ package: architecture.pkg, runRoot: architecture.runRoot,
    conclusion: 'Private fixture unanimous decision; not actual three-party review.', nextPlan: 'Production role qualification remains required.' }).ok, true);
  const runDir = path.join(architecture.runRoot, architecture.pkg.reviewId);
  const result = { schemaVersion: 1, reviewId: architecture.pkg.reviewId, artifactSha256: architecture.pkg.artifactSha256, revision: 1, round: 0,
    manifestDigest: sha(fs.readFileSync(path.join(runDir, 'manifest.json'))), tallyDigest: sha(fs.readFileSync(path.join(runDir, 'round-00/tally.json'))),
    finalReportDigest: sha(fs.readFileSync(path.join(runDir, 'final-report.md'))), grillDigest: sha(grill.resultBytes) };
  const packet = await source(action, { result, report: fs.readFileSync(path.join(runDir, 'final-report.md')), dispatch: a.protectedDispatch });
  packets.set(a.execution, packet);
  const managedA = { actionBinding: action, policy, packet, testContract: targetContract, gateTestContract: cA.testContract,
    admissionOptions: baseOptions(), jobKey: a.jobKey ?? a.execution, grill: { packet: grill }, reviewers,
    sourceBindings: [{ actionBinding: grillAction, sourceQualification: qualification }, ...reviewers.map(({ packet }) => ({ actionBinding: packet.dispatch.actionBinding, sourceQualification: qualification }))] };
  contexts.set(a.execution, managedA);
  missingSource = true;
  const denied = await accept(a);
  assert.notEqual(denied.exitCode, 0, 'the actual Native intake refuses missing original reviewer evidence');
  assert.match(JSON.stringify(denied.json), /REVIEWER_COLLECTIONS_REQUIRED/);
  assert.equal((await issue('A')).execution, a.execution, 'source readback failure retains the original pending job');
  missingSource = false;
  assert.equal((await accept(a)).json.data.verdict, 'pass');
  assert.notEqual((await accept(a)).exitCode, 0, 'a consumed original execution is not accepted twice');
  const observeT = async (intent, sufficient) => {
    const c = context(intent), action = c.actionBinding;
    const result = { schemaVersion: 1, candidateDigest: action.inputDigest, contractDigest: envelopeDigest(targetContract), sufficient,
      oracleStrength: sufficient ? 'strong' : 'weak', summary: 'Independent fixture semantic review of the target TestContract, environment and cleanup.',
      caseReviews: [{ caseId: 'design-denial', checkIds: ['semantic-review'], oracle: targetContract.cases[0].oracle, sufficient,
        rationale: sufficient ? 'The oracle observes the actual public denial boundary.' : 'The oracle would accept an unregistered source and is insufficient.' }],
      environmentReview: { digest: action.environmentDigest, sufficient: true, rationale: 'Private fixture environment; production identity remains unverified.' },
      cleanupReview: { ...targetContract.cleanup, sufficient: true, rationale: 'All private resources are removed in finally.' },
      findings: sufficient ? [] : [{ id: 'weak-oracle', blocking: true, rationale: 'Test author must strengthen the observable oracle.' }] };
    const packet = await source(action, { result, dispatch: intent.protectedDispatch });
    packets.set(intent.execution, packet);
    contexts.set(intent.execution, { actionBinding: action, policy, packet, testContract: targetContract, gateTestContract: c.testContract,
      admissionOptions: baseOptions(), jobKey: intent.jobKey ?? intent.execution });
  };
  const weak = await issue('T'); await observeT(weak, false);
  const rejected = await accept(weak);
  assert.equal(rejected.exitCode, 0, JSON.stringify(rejected.json));
  assert.equal(rejected.json.data.verdict, 'reject', 'Native consumes the authenticated insufficiency as a rejection, despite submitted pass');
  // Design already permits its author to revise the current test intent.
  assert.equal(originalRun(), config.expected.runId);
  fs.appendFileSync(path.join(change, 'test-intent.md'), '\nRequire the oracle to observe the original intake refusal.\n');
  const fresh = await issue('T');
  assert.notEqual(fresh.execution, weak.execution);
  await observeT(fresh, true);
  assert.equal((await accept(fresh)).json.data.verdict, 'pass', 'ONE fresh independent semantic review is sufficient');
  assert.notEqual((await accept(weak)).exitCode, 0, 'a late previous T attempt cannot revive');
  await ok(['complete-design', 'fixture', '--design-doc', 'docs/design.md']);
  fs.writeFileSync(path.join(project, 'docs/comet/plans/derived-plan.md'), '# Plan\n\n- [ ] Validate original review mechanisms. <!-- comet-task:task1 -->\n');
  await ok(['set', 'fixture', 'plan', 'docs/comet/plans/derived-plan.md', 'build_mode', 'autonomous', 'tdd_mode', 'tdd', 'isolation', 'current']);
  const p = await issue('P'); await observeSimple(p); assert.equal((await accept(p)).json.data.verdict, 'pass');
  const good = (await ok(['gates', 'fixture'])).json.data;
  assert.equal(good.phase, 'build');
  assert.equal(good.evaluation.allowed, true, JSON.stringify(good.evaluation));
  const design = path.join(project, 'docs/design.md'), original = fs.readFileSync(design);
  fs.appendFileSync(design, '\nChanged architecture ownership.\n');
  assert.deepEqual((await ok(['gates', 'fixture'])).json.data.evaluation.stale, ['A', 'T', 'P']);
  fs.writeFileSync(design, original);
  const restored = (await ok(['gates', 'fixture'])).json.data;
  assert.deepEqual(restored.evaluation.stale, ['A', 'T', 'P'], 'restoring bytes never restores old A/T/P evidence');
  assert.equal(originalRun(), config.expected.runId);
  return { stage: 'resume', runId: originalRun(), execution: a.execution, jobKey: a.jobKey ?? null,
    commands, assertions: ['same-run-fresh-process-resume', 'same-pending-execution', 'missing-reviewer-refused', 'duplicate-consumption-refused',
      'authenticated-T-insufficiency-rejected', 'same-run-T-repair', 'one-independent-T-review', 'R-A-T-P-boundary', 'design-restore-does-not-revive'],
    scope: 'component/native-review-mechanism', actualRolesMethodsOS: 'UNVERIFIED', runtimeScenariosAccepted: 0 };
}

test('P2_5 Native same-Run review chain: resume exact job, refuse missing sources, rework T independently and invalidate restored design', async () => {
  const artifactRoot = path.resolve(process.env.P25_NATIVE_ARTIFACT_ROOT ?? projectRoot);
  const lock = JSON.parse(fsSync.readFileSync(path.join(projectRoot, 'integrations/comet/upstream.lock.json')));
  const { verifyCometDistribution } = await import(path.join(projectRoot, 'tools/comet/build.mjs'));
  const verified = await verifyCometDistribution({ projectRoot: artifactRoot, lock });
  const fingerprint = '6da90e893105b4b00fc756260076b49e12bdbe40bc4426e4908a75e1d5732a9a';
  assert.equal(verified.fingerprint, fingerprint, 'the exact controller-accepted construction build');
  const build = path.join(artifactRoot, '.sdd/vendor/comet', lock.source.commit, 'builds', fingerprint);
  const manifest = JSON.parse(fsSync.readFileSync(path.join(build, 'distribution.json')));
  const nativePath = path.join(build, 'work/assets/skills/comet/scripts/comet-runtime.mjs');
  const scratch = makeTmp('sdd-p25-native-'), artifacts = path.join(scratch, 'artifacts');
  fsSync.mkdirSync(artifacts, { recursive: true });
  const audit = path.join(projectRoot, '.local/P2_5-convergence/native-audits', crypto.randomUUID());
  fsSync.mkdirSync(audit, { recursive: true });
  const installationRoot = fsSync.realpathSync(path.join(artifactRoot, '.sdd/tools/openspec-1.11.0/node_modules'));
  const packageInfo = JSON.parse(fsSync.readFileSync(path.join(installationRoot, '@fission-ai/openspec/package.json')));
  assert.equal(packageInfo.version, '1.11.0');
  const entries = [];
  const walk = (directory) => {
    for (const item of fsSync.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(directory, item.name), name = path.relative(installationRoot, absolute).replaceAll('\\', '/');
      if (item.isSymbolicLink()) {
        const relative = path.relative(installationRoot, fsSync.realpathSync(absolute));
        assert.ok(!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep));
        entries.push({ path: name, type: 'link', sha256: sha(fsSync.readlinkSync(absolute)) });
      } else if (item.isDirectory()) { entries.push({ path: name, type: 'directory' }); walk(absolute); }
      else { assert.ok(item.isFile()); entries.push({ path: name, type: 'file', sha256: sha(fsSync.readFileSync(absolute)) }); }
    }
  };
  walk(installationRoot);
  const artifactSha = '84820b173b57204bd7582a47ddae65e85fd492724172acc8e434e97ea1c05c3f';
  assert.equal(shaFile(path.join(artifactRoot, '.sdd/cache/artifacts/openspec-1.11.0.tgz')), artifactSha);
  const manifestPath = path.join(artifacts, 'openspec-manifest.json');
  fsSync.writeFileSync(manifestPath, JSON.stringify({ schema: 'comet.openspec.installation-manifest.v1', artifactSha256: artifactSha, entries }));
  const nodePath = fsSync.realpathSync(process.execPath), nodeSha = shaFile(nodePath), environmentDigest = sha(JSON.stringify({ nodeSha, closure: shaFile(manifestPath), platform: process.platform, arch: process.arch }));
  const openSpecBinding = { schema: 'comet.openspec.binding.v1', scope: 'component-mechanism',
    artifact: { name: packageInfo.name, version: packageInfo.version, tarballSha256: artifactSha,
      evidenceRef: 'openspec/changes/delivery-foundation-rearchitecture/toolchain-baseline.json#openspec.npm_artifact' },
    qualification: { ref: null, digest: null, production: 'UNVERIFIED' }, node: { path: nodePath, sha256: nodeSha },
    installationRoot, cliEntry: '@fission-ai/openspec/bin/openspec.js', manifest: { path: manifestPath, sha256: shaFile(manifestPath) }, environmentDigest };
  const config = { repository: projectRoot, scratch, auditDir: audit, nativePath, nativeSha: manifest.files['assets/skills/comet/scripts/comet-runtime.mjs'].sha256, openSpecBinding,
    policy: { executionScope: 'component-mechanism', controllerEnvironmentDigest: environmentDigest,
      ref: 'foundation/profiles/comet-managed.json', digest: shaFile(path.join(projectRoot, 'foundation/profiles/comet-managed.json')),
      revision: 'fixture-qualification-only', projectKnowledgeRequired: true, teamKnowledgeRequired: true, plansRoot: 'docs/comet/plans' } };
  const run = (stage, expected) => {
    const env = { ...process.env };
    for (const key of ['NODE_TEST_CONTEXT', 'NODE_OPTIONS', 'NODE_PATH']) delete env[key];
    const script = path.join(audit, `${stage}-child.mjs`);
    fsSync.writeFileSync(script, `const result=await (${nativeReviewScenario.toString()})(${JSON.stringify({ ...config, stage, expected })});process.stdout.write(JSON.stringify(result));`);
    const startedAt = new Date().toISOString();
    const child = spawnSync(process.execPath, [script],
      { cwd: projectRoot, env, encoding: 'utf8', timeout: 120_000, maxBuffer: 16 * 1024 * 1024 });
    fsSync.writeFileSync(path.join(audit, `${stage}-stdout.raw.txt`), child.stdout ?? '');
    fsSync.writeFileSync(path.join(audit, `${stage}-stderr.raw.txt`), child.stderr ?? '');
    fsSync.writeFileSync(path.join(audit, `${stage}-command.raw.json`), JSON.stringify({ startedAt, endedAt: new Date().toISOString(),
      cwd: projectRoot, argv: [process.execPath, script], scriptSha256: shaFile(script), exitCode: child.status, signal: child.signal, fingerprint }, null, 2));
    fsSync.cpSync(scratch, path.join(audit, `${stage}-fixture-snapshot`), { recursive: true, force: false, errorOnExist: true });
    assert.equal(child.status, 0, child.stderr);
    return JSON.parse(child.stdout);
  };
  const started = run('start');
  const resumed = run('resume', started);
  assert.equal(resumed.runId, started.runId);
  assert.equal(resumed.execution, started.execution);
  fsSync.writeFileSync(path.join(audit, 'commands.raw.json'), JSON.stringify({ fingerprint, started, resumed }, null, 2) + '\n');
  assert.equal(resumed.runtimeScenariosAccepted, 0, 'a local Native fixture cannot close real-role or business acceptance');
});

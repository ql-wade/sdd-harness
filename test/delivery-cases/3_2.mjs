// P3_2 delivery case: the Comet single controller arranges the role chain
// (test-author -> builder -> whitebox) over a real fixture project and the
// independent Whitebox judgment is real end to end.
//
// Coverage (spec.md is the single semantic source; every case below runs the
// real role-chain executor as a subprocess with an isolated HOME/PATH/TMPDIR
// and verifies the persisted evidence plus byte-level oracles independently):
//   V_B01  plan-only request -> the planner (read-only driver) outputs only a
//          validated PlanBundle; no builder/verifier dispatch, no run-state
//          change (byte-level), read-only drivers carry no execute surface,
//          no phase field survives a runner dispatch (no second currentPhase).
//   V_B02  feature missing -> the author's real node --test run is a valid
//          behavior RED (requireValidRed), the RED is kept and routed to the
//          Builder, and the author cannot touch product source (allowed-paths
//          refusal + byte-identical product file).
//   V_B03  author self-check green -> admitted only as authoring-self-check;
//          the gate stays blocked with AUTHORING_SELF_CHECK_ONLY and no
//          independent acceptance is signed.
//   V_B04  Whitebox mutation probe against a real defective candidate: the
//          weak oracle passes on the defect (weak-oracle gap -> routed back
//          to the test author), the strong oracle fails on it (no gap); the
//          frozen tests stay byte-identical.
//   V_B05  Whitebox finds the product defect (real RED) -> Builder produces a
//          new candidate -> re-verification happens on the NEW candidate
//          digest; the old candidate's receipt is refused (STALE_CANDIDATE /
//          STALE_INPUT) and cannot carry acceptance over to the new candidate.
//   V_B06  a service log cannot close a required console check (dispatch/
//          envelope check-binding refusal) while the DOM check closes; the
//          console closes only after a real captured console run.
//   V_B07  a legacy schemaVersion-0 journey record is refused explicitly
//          (INVALID_ENVELOPE, nothing fabricated); the v1 record imports.
//   V_F08  same-session correlation of capture + request record + independent
//          business readback closes the CLI interaction check; a partial
//          session (readback missing) is refused; the absent native-browser
//          capability stays UNVERIFIED and blocks the gate (never a pass).
//   V_A15  a builder save claim is validated by an independent persistence
//          readback; a claim without bytes fails the journey and routes back
//          to the Builder.
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

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const chainCli = path.join(projectRoot, 'openspec/changes/delivery-foundation-rearchitecture/pilot-journey/run-role-chain.mjs');
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `sdd-p32-${label}-`));
  fs.mkdirSync(path.join(root, 'home'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tmp'), { recursive: true });
  return root;
}

// --- fixture project (the suite is the fixture author; the chain only
// consumes it) -----------------------------------------------------------------

const VARIANTS = {
  'stub.js': [
    "export function slugify() {",
    "  throw new Error('NOT_IMPLEMENTED: slugify is not implemented yet');",
    "}",
    '',
  ].join('\n'),
  'defective.js': [
    "// Flawed candidate: identity function — violates the slugify AC",
    "// (no lowercasing, no whitespace collapsing) but still returns a string.",
    "export function slugify(input) {",
    "  return input;",
    "}",
    '',
  ].join('\n'),
  'correct.js': [
    "import fs from 'node:fs';",
    "import path from 'node:path';",
    "import { pathToFileURL } from 'node:url';",
    '',
    "export function slugify(input) {",
    "  return String(input).trim().toLowerCase().replace(/\\s+/g, '-');",
    "}",
    '',
    "export function renderSlug(input) {",
    "  return `slug:${slugify(input)}`;",
    "}",
    '',
    "const asMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;",
    "if (asMain) {",
    "  const result = slugify('Hello World');",
    "  console.log(`console: slugify('Hello World') -> ${result}`);",
    "  const stateFile = process.argv[2];",
    "  if (stateFile) {",
    "    fs.mkdirSync(path.dirname(stateFile), { recursive: true });",
    "    fs.writeFileSync(stateFile, `${JSON.stringify({ input: 'Hello World', result })}\\n`);",
    "  }",
    "}",
    '',
  ].join('\n'),
};

const FROZEN_TESTS = {
  'feature.strong.test.js': [
    "import assert from 'node:assert/strict';",
    "import test from 'node:test';",
    "import { slugify } from '../src/feature.js';",
    '',
    "test('strong oracle: slugify lowercases and dashes', () => {",
    "  assert.equal(slugify('Hello World'), 'hello-world');",
    "});",
    "test('strong oracle: collapses whitespace', () => {",
    "  assert.equal(slugify('a  b'), 'a-b');",
    "});",
    '',
  ].join('\n'),
  'feature.weak.test.js': [
    "import assert from 'node:assert/strict';",
    "import test from 'node:test';",
    "import { slugify } from '../src/feature.js';",
    '',
    "// Weak oracle: passes on the identity defect — cannot detect the AC violation.",
    "test('weak oracle: slugify returns a non-empty string', () => {",
    "  const out = slugify('Hello World');",
    "  assert.equal(typeof out, 'string');",
    "  assert.ok(out.length > 0);",
    "});",
    '',
  ].join('\n'),
  'dom.test.js': [
    "import assert from 'node:assert/strict';",
    "import test from 'node:test';",
    "import { renderSlug } from '../src/feature.js';",
    '',
    "test('dom: rendered slug is displayed', () => {",
    "  assert.match(renderSlug('Hello World'), /^slug:hello-world$/);",
    "});",
    '',
  ].join('\n'),
};

function makeProject(label, initialImpl) {
  const project = path.join(makeWorkdir(label), 'project');
  fs.mkdirSync(path.join(project, 'variants'), { recursive: true });
  fs.mkdirSync(path.join(project, 'test-sources'), { recursive: true });
  fs.mkdirSync(path.join(project, 'src'), { recursive: true });
  fs.writeFileSync(path.join(project, 'package.json'), `${JSON.stringify({ type: 'module' }, null, 2)}\n`);
  for (const [name, body] of Object.entries(VARIANTS)) {
    fs.writeFileSync(path.join(project, 'variants', name), body);
  }
  for (const [name, body] of Object.entries(FROZEN_TESTS)) {
    fs.writeFileSync(path.join(project, 'test-sources', name), body);
  }
  fs.writeFileSync(path.join(project, 'src', 'feature.js'), VARIANTS[initialImpl]);
  fs.writeFileSync(path.join(project, 'plan-bundle.json'), `${JSON.stringify({
    schemaVersion: 1,
    change: 'pilot-role-chain-fixture',
    schedulerOwner: 'comet-classic',
    tasks: [
      { id: 't-author-tests', dependsOn: [] },
      { id: 't-build-feature', dependsOn: ['t-author-tests'] },
      { id: 't-independent-acceptance', dependsOn: ['t-build-feature'] },
    ],
    allowedPaths: ['test/', 'src/', 'probe/', 'artifacts/', 'state/'],
    worktree: 'worktree/impl-p3-2 (fixture mirror; roles confined to assigned path prefixes)',
    acceptanceRefs: ['B01', 'B02', 'B03', 'B04', 'B05', 'B06', 'B07', 'F08', 'A15'],
  }, null, 2)}\n`);
  return project;
}

// --- chain runner + independent readback helpers -------------------------------

function runChain(scenario, project, { variant } = {}) {
  const workdir = path.dirname(project);
  const evidenceFile = path.join(workdir, 'chain-evidence.json');
  const args = [chainCli, '--scenario', scenario, '--project', project, '--evidence', evidenceFile, '--json'];
  if (variant) args.push('--variant', variant);
  const run = spawnSync(process.execPath, args, {
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
  assert.equal(result.run.status, 0, `${label}: the chain run must exit 0, got ${result.run.status}\nstderr: ${result.run.stderr}\nstdout: ${result.run.stdout}`);
  assert.ok(result.evidence, `${label}: persisted chain evidence must exist`);
  assert.equal(result.evidence.verdict, 'OBSERVED', `${label}: every expected checkpoint must be observed: ${JSON.stringify(result.evidence.checkpoints ?? [])}`);
  return result.evidence;
}

function refusalCodes(evidence) {
  return (evidence.refusals ?? []).map((refusal) => refusal.code);
}

function transitionByRole(evidence, role) {
  return (evidence.transitions ?? []).filter((transition) => transition.role === role);
}

// The executed toolchain and the current candidate digest must be recorded
// (verification-case-plan oracle tail: 记录当前候选和环境).
function assertCandidateAndEnvironmentRecorded(evidence) {
  assert.match(evidence.toolchain, new RegExp(`node ${escapeRegExp(process.version)}`), 'the executed toolchain must be recorded');
  assert.match(evidence.candidate.digestAfter, /^[a-f0-9]{64}$/, 'the current candidate digest must be recorded');
}

// The suite runs the fixture's own test suite itself — an independent real
// execution that does not trust the chain's claims.
function runFixtureTest(project, testFile) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, ['--test', path.join('test', testFile)], {
    cwd: project, encoding: 'utf8', timeout: 60_000, env,
  });
}

// --- V_B01 ---------------------------------------------------------------------

test('V_B01: a plan-only request outputs a validated PlanBundle with zero builder/verifier dispatches, zero run-state change and no phase write surface', () => {
  const project = makeProject('b01', 'correct.js');
  const runStateFile = path.join(project, 'control', 'run-state.json');
  const before = fs.existsSync(runStateFile) ? digestFile(runStateFile) : null;

  const result = runChain('B01', project);
  const evidence = assertObserved(result, 'V_B01');

  // The planner output is the validated PlanBundle — and nothing else.
  assert.equal(evidence.plan.ok, true, 'the PlanBundle must validate against SDD.Delivery.PlanBundle v1');
  assert.equal(evidence.plan.bundle.change, 'pilot-role-chain-fixture');
  assert.ok((evidence.plan.bundle.tasks ?? []).length >= 3, 'the plan bundle output carries the arranged tasks');
  const plannerSteps = transitionByRole(evidence, 'planner');
  assert.ok(plannerSteps.length >= 1, 'the planner transition must be recorded');

  // 不派发：no role dispatch happened at all on the plan-only request.
  assert.equal((evidence.dispatchLedger ?? []).length, 0, 'a plan-only request must not dispatch any role');

  // 监控/改运行状态：the single RunState is byte-identical across the plan step.
  assert.equal(evidence.runState.unchanged, true, 'the chain must report no run-state change');
  const after = fs.existsSync(runStateFile) ? digestFile(runStateFile) : null;
  assert.equal(after, before, 'run-state bytes must be unchanged by a plan-only request (byte-level oracle)');

  // The read-only planner driver physically carries no execute surface.
  assert.ok(refusalCodes(evidence).includes('DRIVER_WRITE_REFUSED'), 'requireWriteDriver must refuse the read-only planner');
  // No second currentPhase: the runner refuses phase fields outright.
  assert.ok(refusalCodes(evidence).includes('RUNNER_PHASE_FIELD_REFUSED'), 'a dispatch binding with a phase field must be refused');
});

// --- V_B02 ---------------------------------------------------------------------

test('V_B02: with the product feature missing the author finds a valid behavior RED, keeps it, routes it to the Builder and cannot touch product source', () => {
  const project = makeProject('b02', 'stub.js');
  const productFile = path.join(project, 'src', 'feature.js');
  const productBefore = digestFile(productFile);

  const result = runChain('B02', project);
  const evidence = assertObserved(result, 'V_B02');

  // The RED is real: the suite reproduces it with its own node --test run.
  const independent = runFixtureTest(project, 'feature.strong.test.js');
  assert.notEqual(independent.status, 0, 'fixture precondition: the strong suite is RED against the missing feature');
  assert.match(independent.stdout, /# fail [1-9]/, 'the independent run must show real behavior failures, not zero execution');

  const authorSteps = transitionByRole(evidence, 'test-author');
  const redStep = authorSteps.find((step) => step.verdict === 'red');
  assert.ok(redStep, 'the author transition must record the behavioral RED');
  assert.equal(redStep.basis.kind, 'behavior-red', 'the RED must classify as behavior-red, not environment failure');
  assert.equal(redStep.basis.validRed, true, 'requireValidRed must hold: real failures with a TAP denominator');

  // 保留 RED 并交 Builder: the routing target is the builder, with the RED kept.
  const routing = authorSteps.find((step) => step.route);
  assert.ok(routing, 'the author->builder routing transition must be recorded');
  assert.equal(routing.route, 'builder');
  assert.match(routing.basis.note ?? routing.basis.reason ?? '', /RED/i);

  // 不擅改产品源码: the author's out-of-scope write is refused and the product
  // bytes are unchanged.
  assert.ok(refusalCodes(evidence).includes('ROLE_PATH_REFUSED'), 'the author write into src/ must be refused by the managed writer');
  assert.equal(digestFile(productFile), productBefore, 'product source must stay byte-identical');

  // The written test is byte-identical to the staged authoring source.
  const staged = fs.readFileSync(path.join(project, 'test-sources', 'feature.strong.test.js'));
  const written = fs.readFileSync(path.join(project, 'test', 'feature.strong.test.js'));
  assert.ok(written.equals(staged), 'the author write must land the staged test bytes unchanged');

  assertCandidateAndEnvironmentRecorded(evidence);
});

// --- V_B03 ---------------------------------------------------------------------

test('V_B03: an all-green author self-check is admitted only as authoring-self-check and the gate refuses to sign independent acceptance with it', () => {
  const project = makeProject('b03', 'correct.js');
  const result = runChain('B03', project);
  const evidence = assertObserved(result, 'V_B03');

  const authorReceipt = (evidence.admitted ?? []).find((entry) => entry.role === 'test-author');
  assert.ok(authorReceipt, 'the author self-check must be admitted');
  assert.equal(authorReceipt.class, 'authoring-self-check', 'author evidence class must be authoring-self-check');

  assert.equal(evidence.gate.verdict, 'blocked', 'the gate must not accept on the authoring self-check alone');
  assert.match(evidence.gate.receipt.blocked.join('\n'), /AUTHORING_SELF_CHECK_ONLY/);
  assert.equal(evidence.gate.receipt.requiredDenominator.valid, 0, 'no required check is independently closed by authoring evidence');
  assert.equal(evidence.journey, 'blocked-authoring-self-check-only', 'no independent acceptance is signed');
});

// --- V_B04 ---------------------------------------------------------------------

test('V_B04: the Whitebox mutation probe finds the weak oracle (passes on a real defective candidate), routes the gap back to the test author, and the frozen tests stay byte-identical', () => {
  const project = makeProject('b04', 'correct.js');
  const weakFile = path.join(project, 'test', 'feature.weak.test.js');
  const strongFile = path.join(project, 'test', 'feature.strong.test.js');
  // The frozen tests are landed by the author role during the run; the
  // byte-level oracle is against the staged authoring sources.
  const stagedWeak = digestFile(path.join(project, 'test-sources', 'feature.weak.test.js'));
  const stagedStrong = digestFile(path.join(project, 'test-sources', 'feature.strong.test.js'));

  const result = runChain('B04', project);
  const evidence = assertObserved(result, 'V_B04');

  const gaps = evidence.gaps ?? [];
  assert.equal(gaps.length, 1, 'exactly the weak suite must raise a gap');
  assert.equal(gaps[0].kind, 'weak-oracle');
  assert.match(gaps[0].suite, /feature\.weak\.test\.js/);
  assert.equal(gaps[0].probeOutcome, 'pass', 'the weak suite really passed on the defective probe candidate');

  const strongProbe = (evidence.probes ?? []).find((probe) => /strong/.test(probe.suite));
  assert.ok(strongProbe, 'the strong suite must be probed too');
  assert.equal(strongProbe.probeOutcome, 'red', 'the strong suite really fails on the defective probe candidate');
  assert.equal(strongProbe.gap, null, 'the strong oracle raises no gap');

  // 返回测试作者: the gap routes to the test author, never silently patched.
  const routing = (evidence.transitions ?? []).find((step) => step.route && step.basis?.kind === 'weak-oracle');
  assert.ok(routing, 'the weak-oracle routing transition must be recorded');
  assert.equal(routing.route, 'test-author');

  // 不偷偷改冻结测试: the landed tests are byte-identical to the staged
  // authoring sources, and stay that way through the probe.
  assert.equal(digestFile(weakFile), stagedWeak, 'the frozen weak test must stay byte-identical to the authoring source');
  assert.equal(digestFile(strongFile), stagedStrong, 'the frozen strong test must stay byte-identical to the authoring source');
  for (const frozen of evidence.frozenTests ?? []) {
    assert.equal(frozen.digestBefore, frozen.digestAfter, `frozen test ${frozen.file} unchanged`);
  }
  // The probe really ran: its TAP artifacts are on disk.
  for (const probe of evidence.probes ?? []) {
    const artifact = path.join(project, probe.artifact.uri);
    assert.ok(fs.existsSync(artifact) && fs.statSync(artifact).size > 0, `probe artifact ${probe.artifact.uri} must be persisted`);
  }
});

// --- V_B05 ---------------------------------------------------------------------

test('V_B05: the Whitebox finds the product defect, the Builder produces a new candidate, and re-verification happens on the new candidate — old receipts cannot carry over', () => {
  const project = makeProject('b05', 'defective.js');
  const productFile = path.join(project, 'src', 'feature.js');
  const v1Digest = digestFile(productFile);

  const result = runChain('B05', project);
  const evidence = assertObserved(result, 'V_B05');

  // Two real candidates: the defective v1 and the Builder's fixed v2.
  assert.equal(evidence.candidate.digestBefore, v1Digest, 'candidate v1 digest is the defective bytes');
  assert.notEqual(evidence.candidate.digestAfter, evidence.candidate.digestBefore, 'the Builder produced a genuinely new candidate');
  const independent = runFixtureTest(project, 'feature.strong.test.js');
  assert.equal(independent.status, 0, 'fixture precondition: the strong suite is green on the new candidate');

  // Whitebox found the defect on v1 (real RED) and routed to the builder.
  const whiteboxSteps = transitionByRole(evidence, 'whitebox');
  const defectStep = whiteboxSteps.find((step) => step.verdict === 'red');
  assert.ok(defectStep, 'the whitebox v1 verification must record a real RED');
  const builderSteps = transitionByRole(evidence, 'builder');
  assert.ok(builderSteps.some((step) => step.verdict === 'written' && /src\/feature\.js/.test(step.inputSummary)), 'the builder write of the new candidate must be recorded');

  // 候选改变重验: the old receipt cannot serve the new candidate.
  assert.ok(refusalCodes(evidence).includes('STALE_CANDIDATE'), 'the v1-era envelope must be refused for the rotated candidate');
  assert.ok((evidence.gateStale?.blocked ?? []).some((reason) => /STALE_INPUT/.test(reason)), 'the v1-era receipt must be stale at the v2 gate');

  // Re-verification: a fresh whitebox dispatch on the NEW candidate digest closes the gate.
  const reverify = whiteboxSteps.find((step) => step.verdict === 'pass');
  assert.ok(reverify, 'the whitebox must re-verify the new candidate');
  assert.equal(reverify.dispatch.inputDigest, evidence.candidate.digestAfter, 'the re-verification dispatch is bound to the new candidate digest');
  assert.equal(reverify.dispatch.attempt, 2, 'the re-verification is a new attempt, not a replay');
  assert.equal(evidence.gate.verdict, 'pass', 'the gate passes on the new candidate with fresh independent evidence');
  assert.equal(evidence.gate.receipt.inputDigest, evidence.candidate.digestAfter, 'the gate receipt is bound to the new candidate');
  assert.ok(evidence.gate.receipt.evidence.length > 0);

  // Single control plane: the RunState dispatch ledger is the one ledger, and
  // no second phase-like control file appeared in the fixture tree.
  const runState = JSON.parse(fs.readFileSync(path.join(project, 'control', 'run-state.json'), 'utf8'));
  assert.deepEqual(runState.dispatchLedger, evidence.dispatchLedger, 'the RunState ledger and the evidence ledger must be the same list');
  const controlLike = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/phase|current/i.test(entry.name)) controlLike.push(entry.name);
    }
  };
  walk(project);
  assert.deepEqual(controlLike, [], 'no second phase/control file may appear in the fixture tree');
});

// --- V_B06 ---------------------------------------------------------------------

test('V_B06: a service log cannot close a required console check while the DOM check closes; the console closes only after a real captured console run', () => {
  const project = makeProject('b06', 'correct.js');
  const result = runChain('B06', project);
  const evidence = assertObserved(result, 'V_B06');

  // Negative phase: the service-log execution tries to claim the console check.
  assert.ok(refusalCodes(evidence).includes('CHECK_BINDING_MISMATCH'), 'the envelope check must stay bound to the dispatched check');
  const negativeGate = evidence.gatePhases?.negative;
  assert.ok(negativeGate, 'the negative-phase gate judgment must be recorded');
  assert.equal(negativeGate.verdict, 'blocked', 'the required console check stays open');
  assert.match(negativeGate.receipt.blocked.join('\n'), /MISSING_OBSERVATION: required check ui\/console/);
  assert.doesNotMatch(negativeGate.receipt.blocked.join('\n'), /MISSING_OBSERVATION: required check ui\/dom/, 'the DOM check is closed by its real receipt');

  // Positive phase: the console closes after a real captured console run.
  const consoleStep = transitionByRole(evidence, 'whitebox').find((step) => step.inputSummary?.check === 'console');
  assert.ok(consoleStep, 'the console capture transition must be recorded');
  const consoleArtifact = path.join(project, consoleStep.artifacts[0].uri);
  assert.ok(fs.existsSync(consoleArtifact), 'the console capture artifact must be persisted');
  const consoleBytes = fs.readFileSync(consoleArtifact, 'utf8');
  assert.match(consoleBytes, /console: slugify\('Hello World'\) -> hello-world/, 'the capture must contain the real console stream');
  assert.equal(evidence.gate.verdict, 'pass', 'both required checks close with real evidence');
  assert.equal(evidence.gate.receipt.requiredDenominator.valid, 2, 'console + dom both independently closed');
});

// --- V_B07 ---------------------------------------------------------------------

test('V_B07: a legacy journey record with an incompatible contract version is refused explicitly and nothing is fabricated; the v1 record imports', () => {
  const project = makeProject('b07', 'correct.js');
  const result = runChain('B07', project);
  const evidence = assertObserved(result, 'V_B07');

  const legacyRefusal = (evidence.refusals ?? []).find((refusal) => refusal.code === 'INVALID_ENVELOPE');
  assert.ok(legacyRefusal, 'the legacy schemaVersion-0 import must be refused');
  assert.match(legacyRefusal.reason, /older than supported/, 'the refusal names the incompatible version explicitly');

  assert.equal((evidence.admitted ?? []).length, 1, 'exactly the v1 record is admitted');
  assert.equal(evidence.admitted[0].class, 'independent-acceptance');
  assert.equal(evidence.journey, 'legacy-refused-v1-admitted');
});

// --- V_F08 ---------------------------------------------------------------------

test('V_F08: correlated capture + request + independent readback closes the CLI interaction check; a partial session is refused and the absent browser capability stays UNVERIFIED', () => {
  const project = makeProject('f08', 'correct.js');
  const result = runChain('F08', project);
  const evidence = assertObserved(result, 'V_F08');

  // Same-session correlation across the three observation kinds.
  const sessions = evidence.sessions ?? [];
  const complete = sessions.find((session) => session.complete === true);
  assert.ok(complete, 'one fully correlated session must exist');
  assert.deepEqual([...complete.kinds].sort(), ['capture', 'readback', 'request'], 'capture, request and independent business readback are all correlated');
  assert.ok(complete.sessionId, 'the correlated records share one session id');
  for (const artifact of complete.artifacts) {
    const file = path.join(project, artifact.uri);
    assert.ok(fs.existsSync(file) && fs.statSync(file).size > 0, `correlated artifact ${artifact.uri} must be persisted`);
  }
  // The readback is business readback: the suite verifies the state bytes itself.
  const readbackRecord = complete.artifacts.find((artifact) => artifact.kind === 'readback');
  const stateFile = path.join(project, 'state', 'business-state.json');
  assert.ok(fs.existsSync(stateFile), 'the business state is really on disk');
  assert.equal(readbackRecord.sha256, digestFile(stateFile), 'the recorded readback digest matches the persisted state bytes');

  // Partial session: capture + request without a readback is refused, never a pass.
  const partial = sessions.find((session) => session.complete !== true);
  assert.ok(partial, 'the incomplete session must be recorded');
  assert.ok(refusalCodes(evidence).includes('CORRELATION_INCOMPLETE'), 'the partial session must be refused');

  // Missing capability: the native browser is absent in this pilot — unverified.
  const unverified = (evidence.admitted ?? []).find((entry) => entry.result === 'unverified');
  assert.ok(unverified, 'the browser check must be admitted as unverified');
  assert.equal(unverified.check, 'browser-console');
  assert.equal(evidence.gate.verdict, 'blocked', 'the gate stays blocked: a required capability is unverified');
  assert.match(evidence.gate.receipt.blocked.join('\n'), /UNVERIFIED_CAPABILITY: browser-console/);
  assert.equal(evidence.gate.receipt.requiredDenominator.valid, 1, 'only the correlated CLI check closed');
  const capability = (evidence.capabilityInventory ?? []).find((entry) => entry.capability === 'native-browser');
  assert.ok(capability && capability.available === false && capability.basis, 'the absent capability is recorded honestly with its basis');
});

// --- V_A15 ---------------------------------------------------------------------

test('V_A15: a persisted builder save claim survives the independent readback; a claim-only save fails the journey and routes back to the Builder', () => {
  const stateFile = (project) => path.join(project, 'state', 'saved-state.json');

  // Positive: the write really landed.
  const persistedProject = makeProject('a15-persisted', 'correct.js');
  const persisted = runChain('A15', persistedProject, { variant: 'persisted' });
  const persistedEvidence = assertObserved(persisted, 'V_A15 persisted');
  assert.equal(persistedEvidence.journey, 'persisted-readback-ok');
  assert.ok(fs.existsSync(stateFile(persistedProject)), 'the suite confirms independently: the save claim reached disk');
  const readback = (persistedEvidence.transitions ?? []).find((step) => step.action === 'independent-readback');
  assert.ok(readback, 'the independent readback transition must be recorded');
  assert.equal(readback.verdict, 'ok');
  assert.equal(readback.artifacts[0].sha256, digestFile(stateFile(persistedProject)), 'the readback digest matches the real bytes');

  // Negative: the claim without bytes fails the journey and routes back.
  const claimProject = makeProject('a15-claim', 'correct.js');
  const claimOnly = runChain('A15', claimProject, { variant: 'claim-only' });
  const claimEvidence = assertObserved(claimOnly, 'V_A15 claim-only');
  assert.equal(claimEvidence.journey, 'journey-failed-not-persisted', 'not persisted means the journey fails, regardless of the claim');
  assert.equal(fs.existsSync(stateFile(claimProject)), false, 'the suite confirms independently: nothing reached disk');
  const failRouting = (claimEvidence.transitions ?? []).find((step) => step.route);
  assert.ok(failRouting, 'the failed readback must produce a routing transition');
  assert.equal(failRouting.route, 'builder');
  assert.match(failRouting.basis.note ?? '', /not persisted/i);
});

// --- V_E06 rework: the real managed Comet CLI — same-run R→V role slice -------
//
// The rework boundary (tasks.md P3_2 Step 7/8 and execution-contract
// journey_execution.construction_task_scopes.P3_2): the fixture choreography
// above proves the role-chain JUDGMENTS through independent mechanisms; it is
// not Comet dispatch and must not stand in for one. This section drives the
// real patched Comet CLI (repo lock fingerprint d4370930…, the six-patch
// chain) through the same-run role slice R confirm → A (grill + unanimous
// consensus) → T (independent review) → P → TDD build → Whitebox V on a
// scratch project under $TMPDIR, over the CLI's real gate / transition /
// resume surfaces. The Kp → real OpenSpec archive → Outline unknown-result /
// restart recovery → Kt → completed tail is execution_owner=VERIFY
// (journey_execution) and is neither executed nor claimed here: the slice
// stops at the archive boundary with knowledge_closeout_required still true
// and nothing archived.

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

// This run's real multi-agent consensus receipt (read-only positive control):
// the architecture-gate evidence shape is taken verbatim from the genuinely
// executed unanimous plan review of this rework run; the artifactDigest is
// re-bound to the dispatched inputDigest because the artifact under review in
// the scratch change is the dispatched gate input, not the plan bundle.
const r3ConsensusDir = path.join(projectRoot, 'openspec/changes/delivery-foundation-rearchitecture/consensus/2026-10-22-plan-r3');
const r3Tally = JSON.parse(fs.readFileSync(path.join(r3ConsensusDir, 'tally.json'), 'utf8'));
const r3Manifest = JSON.parse(fs.readFileSync(path.join(r3ConsensusDir, 'manifest.json'), 'utf8'));

const cliWorkdir = makeWorkdir('cli');
const cliWorld = path.join(cliWorkdir, 'managed');
const cliHome = path.join(cliWorkdir, 'home');
const cliStubs = path.join(cliWorkdir, 'stubs');
fs.mkdirSync(cliWorld, { recursive: true });
fs.mkdirSync(cliStubs, { recursive: true });
// The openspec stub creates the layout comet init needs and performs the
// archive move exactly like the upstream CLI; npm/npx are neutralized
// (registered B6 gap). Identical to the 2_4 harness stubs.
fs.writeFileSync(path.join(cliStubs, 'openspec'), `#!/bin/sh
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
  fs.writeFileSync(path.join(cliStubs, name), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
}

function cliEnv(extra = {}) {
  const env = {
    ...process.env,
    HOME: cliHome,
    COMET_PROJECT_ROOT: cliWorld,
    PATH: `${cliStubs}:${process.env.PATH ?? ''}`,
    TMPDIR: cliWorkdir,
  };
  delete env.NODE_TEST_CONTEXT;
  return { ...env, ...extra };
}

function comet(args, { env = {}, timeout = 240_000, cwd = cliWorld } = {}) {
  const result = spawnSync(cometNode, [cometEntrypoint, ...args], {
    cwd, encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024, env: cliEnv(env),
  });
  let json = null;
  try { json = JSON.parse(result.stdout ?? ''); } catch { /* non-JSON output stays raw */ }
  return { ...result, json };
}

const cliIssues = (result) => (result.json?.data?.issues ?? []).map((issue) => issue.message ?? '').join('\n');
const cliRefusal = (result) => `${cliIssues(result)}\n${result.stderr ?? ''}\n${result.stdout ?? ''}`
  .replace(/\x1b\[[0-9;]*m/g, '');

const cliChangeDir = (change) => path.join(cliWorld, 'docs/openspec/changes', change);

function writeCliArtifacts(change) {
  const dir = cliChangeDir(change);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'proposal.md'), '# Proposal\n\nSame-run R to V role slice probe.\n');
  fs.writeFileSync(path.join(dir, 'tasks.md'), '# Tasks\n\n- [ ] 1.1 Implement slice probe product code\n');
  fs.writeFileSync(path.join(dir, 'design.md'), `---\ncomet_change: ${change}\nrole: technical-design\ncanonical_spec: openspec\n---\n\n# Design\n\nRole-slice probe design v1.\n`);
  fs.writeFileSync(path.join(dir, 'test-intent.md'), '# Test Intent\n\ncases: c1\noracle: probe behavior observed\n');
  const plansDir = path.join(cliWorld, 'docs/superpowers/plans');
  fs.mkdirSync(plansDir, { recursive: true });
  fs.writeFileSync(path.join(plansDir, `${change}-plan.md`), '# Plan\n\n- 1.1 Implement slice probe product code\n');
  fs.mkdirSync(path.join(cliWorld, 'src'), { recursive: true });
  fs.writeFileSync(path.join(cliWorld, 'src/feature.js'), 'export const v1 = 1;\n');
  return dir;
}

let cliProjectReady = false;
function ensureCliProject() {
  if (cliProjectReady) return;
  const init = comet(['init', cliWorld, '--yes', '--scope', 'project', '--workflow', 'classic', '--platform', 'claude', '--codegraph', 'skip', '--language', 'en'], { timeout: 300_000 });
  assert.equal(init.status, 0, `comet init (classic) failed: ${cliRefusal(init).slice(0, 400)}`);
  cliProjectReady = true;
}

function managedSliceChange(change) {
  ensureCliProject();
  writeCliArtifacts(change);
  assert.equal(comet(['state', 'init', change, 'full', '--managed-delivery', '--knowledge-closeout-required', 'true', '--json']).json?.exitCode, 0);
  assert.equal(comet(['state', 'select', change, '--json']).json?.exitCode, 0);
  const rel = `docs/openspec/changes/${change}`;
  assert.equal(comet(['state', 'set', change, 'design_doc', `${rel}/design.md`, 'test_intent', `${rel}/test-intent.md`, 'plan', `docs/superpowers/plans/${change}-plan.md`, '--json']).json?.exitCode, 0);
}

// The real Runtime dispatch: a fresh binding every call (execution/attempt/
// inputDigest/epoch are machine-assigned; the test never fabricates them).
function dispatchGate(change, gate) {
  const dispatched = comet(['state', 'dispatch-gate', change, gate, '--json']);
  assert.equal(dispatched.json?.exitCode, 0, `dispatch-gate ${gate} failed: ${cliRefusal(dispatched).slice(0, 250)}`);
  return dispatched.json?.data?.dispatch
    ?? JSON.parse((dispatched.stdout ?? '').trim().split('\n').pop());
}

function acceptGateFile(change, gate, result) {
  const resultFile = path.join(cliWorkdir, `result-${change}-${gate}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(resultFile, JSON.stringify(result));
  return comet(['state', 'accept-gate', change, gate, '--file', resultFile, '--json']);
}

const reportFor = (gate, binding) => `# Gate ${gate} independent review\n\nReviewed by ${GATE_ROLE_OF[gate]} over the dispatched inputs (${binding.inputDigest.slice(0, 12)}…).\n`;

// A compliant pass result: the dispatched binding echoed back, a real report
// plus its digest; A additionally carries the unanimous consensus evidence,
// T the independent test-design review (P1-02 acceptance algebra).
function passResult(gate, binding, extra = {}) {
  const report = reportFor(gate, binding);
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

const r3ConsensusForBinding = (binding, overrides = {}) => ({
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

const strongTestDesignForBinding = (binding, overrides = {}) => ({
  verdict: 'sufficient',
  oracle: 'strong',
  inputDigest: binding.inputDigest,
  reviewer: 'test-authoring',
  findings: [],
  ...overrides,
});

function gateReceipts(change) {
  const raw = (comet(['state', 'get', change, 'gate_receipts']).stdout ?? '').trim();
  return JSON.parse(raw.length > 0 ? raw : '[]');
}

function lastReceiptFor(change, gate) {
  const receipts = gateReceipts(change).filter((receipt) => receipt.gate === gate);
  return receipts[receipts.length - 1] ?? null;
}

test('V_E06:rv-slice-real-cli — the same-run R→V role slice executes on the real managed Comet CLI: enter-design refuses without an accepted R, A consumes this run\'s real r3 unanimous consensus (majorities and short quorums refused), T enforces oracle strength, and the accepted V stops at the archive boundary with the VERIFY tail untouched', { skip: COMET_BUILD_SKIP }, () => {
  const change = 'p32-rv-slice';
  managedSliceChange(change);

  // --- R confirm (step 1): entering design is gated on a current R receipt.
  const withoutR = comet(['state', 'transition', change, 'open-complete', '--json']);
  assert.equal(withoutR.json?.exitCode, 1, 'open-complete without an accepted R receipt must be refused (exit 1: precondition)');
  assert.match(cliRefusal(withoutR), /R/, 'the refusal names the missing R premise');
  assert.equal(comet(['state', 'get', change, 'phase']).stdout?.trim(), 'open', 'the refusal leaves the phase untouched');

  const rBinding = dispatchGate(change, 'R');
  assert.equal(rBinding.gate, 'R');
  assert.equal(rBinding.role, 'requirements-owner');
  assert.match(rBinding.inputDigest, /^[a-f0-9]{64}$/);
  assert.ok(Number.isInteger(rBinding.attempt) && rBinding.attempt >= 1, 'the Runtime assigns the attempt');
  assert.ok(Number.isInteger(rBinding.epoch) && rBinding.epoch >= 0, 'the dispatch carries an input-generation epoch');
  const rAccepted = acceptGateFile(change, 'R', passResult('R', rBinding));
  assert.equal(rAccepted.json?.exitCode, 0, `the evidenced R pass is accepted: ${cliRefusal(rAccepted).slice(0, 300)}`);
  assert.equal(comet(['state', 'transition', change, 'open-complete', '--json']).json?.exitCode, 0, 'with the trusted R receipt the same transition proceeds');
  assert.equal(comet(['state', 'get', change, 'phase']).stdout?.trim(), 'design');
  const rReceipt = lastReceiptFor(change, 'R');
  assert.equal(rReceipt.execution, rBinding.execution, 'the persisted receipt is bound to the dispatch execution');

  // --- A gate (step 2): grill closed + REAL unanimous consensus only.
  // 2a: a 2:1 majority is not a unanimous consensus — refused, no receipt.
  const majorityBinding = dispatchGate(change, 'A');
  const majority = r3ConsensusForBinding(majorityBinding);
  majority.ballots = majority.ballots.map((ballot, index) => (index === majority.ballots.length - 1
    ? { ...ballot, verdict: 'REJECT', blockingFindings: 1 }
    : ballot));
  const majorityRefused = acceptGateFile(change, 'A', { ...passResult('A', majorityBinding), consensus: majority });
  assert.notEqual(majorityRefused.json?.exitCode, 0, 'a 2:1 majority must never advance the architecture gate');
  assert.match(cliRefusal(majorityRefused), /unanimous|ballot|consensus/i);
  assert.equal(lastReceiptFor(change, 'A'), null, 'a refused consensus leaves no A receipt');

  // 2b: a short quorum (missing ballot) is refused — coverage is mechanical.
  const shortBinding = dispatchGate(change, 'A');
  const shortQuorum = r3ConsensusForBinding(shortBinding);
  shortQuorum.ballots = shortQuorum.ballots.slice(0, shortQuorum.ballots.length - 1);
  const shortRefused = acceptGateFile(change, 'A', { ...passResult('A', shortBinding), consensus: shortQuorum });
  assert.notEqual(shortRefused.json?.exitCode, 0, 'a quorum with a missing ballot must be refused');
  assert.match(cliRefusal(shortRefused), /participant|ballot|coverage|missing|unanimous/i);

  // 2c positive control: this run's real r3 receipts (read-only) close A.
  const aBinding = dispatchGate(change, 'A');
  assert.equal(aBinding.role, 'reviewer');
  const aResult = passResult('A', aBinding);
  aResult.consensus = r3ConsensusForBinding(aBinding);
  const aAccepted = acceptGateFile(change, 'A', aResult);
  assert.equal(aAccepted.json?.exitCode, 0, `the real r3 unanimous consensus is consumed: ${cliRefusal(aAccepted).slice(0, 300)}`);
  const aReceipt = lastReceiptFor(change, 'A');
  assert.equal(aReceipt.execution, aBinding.execution);
  assert.equal(aReceipt.digest, aBinding.inputDigest, 'the receipt is bound to the dispatched inputs');
  assert.equal(aReceipt.reportDigest, aResult.reportDigest, 'the persisted report digest is the accepted report');

  // --- T gate (step 3): independent test-design review, adequate oracle only.
  const tWeakBinding = dispatchGate(change, 'T');
  const weakOracle = passResult('T', tWeakBinding);
  weakOracle.testDesignReview = strongTestDesignForBinding(tWeakBinding, { oracle: 'weak' });
  const weakRefused = acceptGateFile(change, 'T', weakOracle);
  assert.notEqual(weakRefused.json?.exitCode, 0, 'a weak oracle must not pass the test-design gate');
  assert.match(cliRefusal(weakRefused), /oracle/i);
  const tBinding = dispatchGate(change, 'T');
  const tAccepted = acceptGateFile(change, 'T', passResult('T', tBinding, {
    testDesignReview: strongTestDesignForBinding(tBinding),
  }));
  assert.equal(tAccepted.json?.exitCode, 0, `the strong-oracle review is consumed: ${cliRefusal(tAccepted).slice(0, 300)}`);

  // --- P gate (step 4), then design confirmation enters the build phase.
  const pBinding = dispatchGate(change, 'P');
  const pAccepted = acceptGateFile(change, 'P', passResult('P', pBinding));
  assert.equal(pAccepted.json?.exitCode, 0, `P is accepted: ${cliRefusal(pAccepted).slice(0, 300)}`);
  const completeDesign = comet(['state', 'complete-design', change, '--design-doc', `docs/openspec/changes/${change}/design.md`, '--json']);
  assert.equal(completeDesign.json?.exitCode, 0, cliRefusal(completeDesign).slice(0, 300));
  assert.equal(comet(['state', 'get', change, 'phase']).stdout?.trim(), 'build');

  // --- TDD build (step 5): registered check identity, no escape hatches.
  assert.equal(comet(['state', 'set', change, 'build_mode', 'executing-plans', 'tdd_mode', 'tdd', 'isolation', 'current', '--json']).json?.exitCode, 0);
  fs.mkdirSync(path.join(cliWorld, '.comet'), { recursive: true });
  fs.writeFileSync(path.join(cliWorld, '.comet/check-policy.json'), JSON.stringify({
    version: 2,
    commands: [
      { argv: ['node', '-e', 'process.stdout.write("build-ok\\n")'], cwd: '.', requiredScope: 'build', files: ['src/feature.js'] },
      { argv: ['node', '-e', 'process.stdout.write("verify-ok\\n")'], cwd: '.', requiredScope: 'verify', files: ['src/feature.js'] },
    ],
  }, null, 2));
  const tasksJson = comet(['state', 'tasks', change, '--assign-ids', '--json']).json;
  const taskId = tasksJson?.data?.tasks?.[0]?.id;
  assert.ok(taskId, 'task ids are assigned from the plan');
  assert.equal(comet(['state', 'task-complete', change, taskId, '--expect', tasksJson?.data?.revision, '--json']).json?.exitCode, 0);
  const pRebind = dispatchGate(change, 'P');
  assert.equal(acceptGateFile(change, 'P', passResult('P', pRebind)).json?.exitCode, 0, 'P is re-accepted against the current plan definition');
  const buildCheck = comet(['check', 'run', change, 'build', '--local', '--', 'node', '-e', 'process.stdout.write("build-ok\\n")']);
  assert.equal(buildCheck.status, 0, cliRefusal(buildCheck).slice(0, 250));
  const buildComplete = comet(['state', 'transition', change, 'build-complete', '--json']);
  assert.equal(buildComplete.json?.exitCode, 0, cliRefusal(buildComplete).slice(0, 300));
  assert.equal(comet(['state', 'get', change, 'phase']).stdout?.trim(), 'verify');

  // --- Whitebox V (step 6): verification evidence and the V gate.
  fs.writeFileSync(path.join(cliChangeDir(change), 'verification.md'), '# Verification Report\n\nSlice probe verified.\n');
  assert.equal(comet(['state', 'set', change, 'verification_report', `docs/openspec/changes/${change}/verification.md`, '--json']).json?.exitCode, 0);
  const verifyCheck = comet(['check', 'run', change, 'verify', '--local', '--', 'node', '-e', 'process.stdout.write("verify-ok\\n")']);
  assert.equal(verifyCheck.status, 0, cliRefusal(verifyCheck).slice(0, 250));
  const vBinding = dispatchGate(change, 'V');
  assert.equal(vBinding.role, 'verifier');
  const vAccepted = acceptGateFile(change, 'V', passResult('V', vBinding));
  assert.equal(vAccepted.json?.exitCode, 0, `the Whitebox V receipt is accepted: ${cliRefusal(vAccepted).slice(0, 300)}`);
  const verifyPass = comet(['state', 'transition', change, 'verify-pass', '--json']);
  assert.equal(verifyPass.json?.exitCode, 0, cliRefusal(verifyPass).slice(0, 300));

  // --- R→V boundary: the verify-pass entrance itself re-checked the
  // enter-archive premises (R,A,T,P,V current — that is why it passed); the
  // persisted ledger proves each slice receipt; the VERIFY tail is untouched
  // (nothing archived, the run-level knowledge seat still blocks completion).
  const gates = comet(['state', 'gates', change, '--json']);
  assert.equal(gates.json?.exitCode, 0, `state gates must read back cleanly: ${cliRefusal(gates).slice(0, 300)}`);
  const gatesData = gates.json?.data ?? {};
  assert.equal(gatesData.phase, 'archive', 'verify-pass moved the run to the archive phase — the exact R→V slice boundary');
  assert.equal(gatesData.completionBlocked, true, 'the run-level knowledge seat (Kt) still blocks completion: the tail is VERIFY-owned');
  assert.equal(gatesData.knowledgeCloseoutRecorded, false, 'Kp/Kt is not recorded by the construction slice');
  for (const gate of ['R', 'A', 'T', 'P', 'V']) {
    const receipt = (gatesData.receipts ?? []).filter((entry) => entry.gate === gate).pop();
    assert.ok(receipt, `the ${gate} receipt is persisted`);
    assert.equal(receipt.verdict, 'pass');
    assert.ok(Number.isInteger(receipt.attempt) && receipt.attempt >= 1, `the ${gate} receipt carries its dispatch attempt`);
    assert.ok(Number.isInteger(receipt.epoch) && receipt.epoch >= 0, `the ${gate} receipt carries its input-generation epoch`);
    assert.ok(Number.isInteger(receipt.generation), `the ${gate} receipt carries its acceptance generation (P1-03)`);
  }
  const next = comet(['state', 'next', change, '--json']);
  const nextAction = next.json?.data?.nextAction;
  assert.ok(nextAction && typeof nextAction.kind === 'string', `the resume face records the next action for the final journey: ${JSON.stringify(nextAction)}`);
  const archiveDir = path.join(cliWorld, 'docs/openspec/changes/archive');
  const archivedEntries = fs.existsSync(archiveDir) ? fs.readdirSync(archiveDir) : [];
  assert.equal(archivedEntries.some((entry) => entry.endsWith(change)), false, 'the construction slice archives nothing: the change is not in the archive');
  assert.ok(fs.existsSync(cliChangeDir(change)), 'the change stays in place for the VERIFY-owned tail');
  assert.equal(comet(['state', 'get', change, 'knowledge_closeout_required']).stdout?.trim(), 'true', 'the Kp/Kt knowledge obligation is untouched by the slice');
  // Resume face: a fresh CLI process (every comet() call is one) reads the
  // same persisted ledger — the slice survives cross-process resume reads.
  const resumedReceipts = gateReceipts(change);
  const resumedGates = new Set(resumedReceipts.filter((receipt) => receipt.verdict === 'pass').map((receipt) => receipt.gate));
  for (const gate of ['R', 'A', 'T', 'P', 'V']) {
    assert.ok(resumedGates.has(gate), `the ${gate} acceptance survives the fresh-process resume read`);
  }
});

test('V_E06:p25-consensus-consumption — the P2_5 consumption contract admits this run\'s real r3 unanimous consensus only through a trusted-launcher dispatch bound to the reviewed artifact, and the mechanical judgment — not the caller — decides', async () => {
  const review = await import(path.join(projectRoot, 'lib/adapters/architecture-review.js'));
  const { createLaunchAuthority } = await import(path.join(projectRoot, 'lib/delivery/evidence.js'));

  // The real r3 ballots (read-only) replayed through the real mechanical gate:
  // the votes, agents and blocking-finding counts are the run's own receipts.
  const root = path.join(makeWorkdir('cli-p25'), 'project');
  fs.mkdirSync(root, { recursive: true });
  const artifactPath = path.join(root, 'architecture-package.json');
  fs.writeFileSync(artifactPath, `${JSON.stringify({
    change: 'delivery-foundation-rearchitecture',
    scope: 'P3_2 same-run slice: r3 positive control over the A consumption contract',
    requirementsDigest: sha256('slice-req'),
    designDigest: sha256('slice-design'),
  }, null, 2)}\n`);
  const pkg = review.freezeReviewPackage({ reviewId: 'p32-rv-slice-r3-control', artifactPath, revision: 1 });
  const runRoot = path.join(root, 'review-runs');
  const init = review.initConsensusRun({ package: pkg, runRoot, initiator: r3Manifest.participants[0] });
  assert.equal(init.ok, true, `real consensus run init: ${init.stderr ?? ''}`);
  for (const agent of r3Manifest.participants) {
    const source = (r3Tally.ballots ?? []).find((ballot) => ballot.agent === agent);
    assert.ok(source, `the r3 receipts contain a ballot for ${agent}`);
    assert.equal(source.blocking_findings, 0, 'the r3 positive control carries zero blocking findings');
    const outcome = review.admitBallot({
      package: pkg, runRoot, participant: agent,
      ballot: {
        review_id: pkg.reviewId,
        round: 0,
        agent,
        artifact_sha256: pkg.artifactSha256,
        verdict: source.verdict,
        score: { overall: 9, criteria: { requirements_fit: 9, boundaries: 9, reliability: 9, security_operations: 9, evolution_testability: 9 } },
        findings: [],
        assumptions: [],
        confidence: 0.9,
        summary: String(source.summary ?? `${agent} r3 positive-control ballot`),
      },
    });
    assert.equal(outcome.ok, true, `real ballot admission for ${agent}: ${(outcome.errors ?? [outcome.stderr]).join('; ')}`);
  }
  const tally = review.mechanicalTally({ package: pkg, runRoot });
  assert.equal(tally.exitCode, 0, 'the real mechanical tally is closed and unanimous');
  const finalize = review.mechanicalFinalize({ package: pkg, runRoot, conclusion: 'r3 positive control: unanimous approval replayed by the P3_2 slice', nextPlan: 'tracked in the journey recipe' });
  assert.equal(finalize.ok, true, `real finalize: ${finalize.stderr ?? ''}`);

  const authority = createLaunchAuthority({ secret: crypto.randomBytes(32).toString('hex') });
  const dispatch = authority.issueDispatch({
    runnerId: 'review-runner-p32', run: 'run-same-run-delivery', gate: 'A', role: 'verifier',
    execution: 'exec-p32-rv-slice-a', inputDigest: pkg.artifactSha256, policyDigest: sha256('policy/p32-slice'),
    attempt: 1, epoch: 1,
  });
  const consumed = review.consumeArchitectureGate({ package: pkg, runRoot, questions: [], dispatch, authority });
  assert.equal(consumed.ok, true, `the launcher-issued dispatch consumes the real consensus: ${consumed.error ?? ''}`);
  assert.equal(consumed.judged.status, 'PASSED', 'the consumed judgment is the real mechanical one');
  assert.equal(consumed.execution, 'exec-p32-rv-slice-a', 'the trusted execution identity travels with the receipt');

  // The judgment — not the consumption — decides: with the finalize report
  // withheld the same dispatch cannot carry the gate.
  const unfinished = review.judgeArchitectureGate({ package: pkg, runRoot: path.join(root, 'no-such-run'), questions: [] });
  assert.equal(unfinished.status, 'REFUSED', 'a missing mechanical run is refused by the judgment itself');
  // A forged origin (identical binding fields, wrong launcher) is refused.
  const rogue = createLaunchAuthority({ secret: crypto.randomBytes(32).toString('hex') });
  const forged = review.consumeArchitectureGate({
    package: pkg, runRoot, questions: [],
    dispatch: rogue.issueDispatch({
      runnerId: 'review-runner-p32', run: 'run-same-run-delivery', gate: 'A', role: 'verifier',
      execution: 'exec-p32-rv-slice-a', inputDigest: pkg.artifactSha256, policyDigest: sha256('policy/p32-slice'),
      attempt: 1, epoch: 1,
    }),
    authority,
  });
  assert.equal(forged.ok, false, 'a dispatch the trusted launcher never signed is refused');
  assert.equal(forged.error, 'FORGED_DISPATCH');
  // Cross-material binding: the one-shot authorization never covers a second
  // artifact (E04).
  const otherArtifact = path.join(root, 'other-package.json');
  fs.writeFileSync(otherArtifact, `${JSON.stringify({ scope: 'other material' }, null, 2)}\n`);
  const otherPkg = review.freezeReviewPackage({ reviewId: 'p32-rv-slice-other', artifactPath: otherArtifact, revision: 1 });
  const mismatch = review.consumeArchitectureGate({ package: otherPkg, runRoot, questions: [], dispatch, authority });
  assert.equal(mismatch.ok, false, 'the dispatch bound to artifact A never consumes artifact B');
  assert.equal(mismatch.error, 'ARTIFACT_DIGEST_MISMATCH');
});

test('V_E06:recipe-tracking — the same-run-delivery journey recipe is registered and bound, its full step plan keeps the VERIFY tail owned by VERIFY, and the journey registration surface refuses unknown and unlanded journeys', () => {
  // 1. The registration is the binding (journey_definitions).
  const plan = JSON.parse(fs.readFileSync(path.join(projectRoot, 'openspec/changes/delivery-foundation-rearchitecture/verification-case-plan.json'), 'utf8'));
  const registration = plan.journey_definitions?.['same-run-delivery'];
  assert.ok(registration, 'same-run-delivery is registered in verification-case-plan journey_definitions');
  assert.equal(registration.owner, 'P3_2');
  assert.equal(registration.required_check, 'V_SAME_RUN_DELIVERY');
  const recipePath = path.join(projectRoot, registration.path);
  assert.ok(fs.existsSync(recipePath), 'the registered recipe exists on disk (no journey-recipe-not-implemented)');

  // 2. The recipe is the case definition: scenario/caseModule/assertions bind.
  const recipe = JSON.parse(fs.readFileSync(recipePath, 'utf8'));
  assert.equal(recipe.schemaVersion, 1);
  assert.equal(recipe.scenario, 'E06');
  assert.equal(recipe.caseModule, 'test/delivery-cases/3_2.mjs');
  assert.ok(fs.existsSync(path.join(projectRoot, recipe.caseModule)), 'the recipe case module exists');
  const checkAcceptance = ['C01', 'C02', 'C03', 'E01', 'E02', 'E03', 'E06', 'D06', 'D07', 'H01', 'H03'];
  for (const id of checkAcceptance) {
    assert.ok(recipe.acceptanceIds.includes(id), `the recipe carries acceptance id ${id} of V_SAME_RUN_DELIVERY`);
  }
  for (const pin of ['E06', 'V_E06:rv-slice-real-cli', 'V_E06:p25-consensus-consumption', 'V_E06:recipe-tracking']) {
    assert.ok(recipe.requiredAssertions.includes(pin), `the recipe pins its target denominator: ${pin}`);
  }
  const spawnAction = recipe.actions.find((action) => action.type === 'spawn');
  assert.ok(spawnAction, 'the recipe declares a real spawn action');
  assert.equal(spawnAction.command, 'node --test test/delivery-cases/3_2.mjs');
  assert.equal(spawnAction.expect?.kind, 'exitCode');
  assert.deepEqual(recipe.evidence?.artifacts?.filter((name) => name === 'verdict.json'), ['verdict.json'], 'the evidence contract includes the verdict');
  for (const key of ['PASS', 'FAIL', 'NOT-EXERCISED', 'NOT-APPLICABLE']) {
    assert.ok(typeof recipe.verdictSemantics?.[key] === 'string' && recipe.verdictSemantics[key].length > 0, `verdictSemantics.${key} is declared`);
  }
  assert.match(recipe.verdictSemantics.PASS, /VERIFY/i, 'the PASS semantics scope the construction slice and reserve the tail for VERIFY');

  // 3. The full step plan: frozen order, per-step role/dispatch/gate/epoch/
  // record fields, and the Kp→archive→Outline→Kt→completed tail owned by VERIFY.
  const manifestPath = path.join(projectRoot, 'openspec/changes/delivery-foundation-rearchitecture/pilot-journey/same-run-delivery.journey.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.journey, 'same-run-delivery');
  assert.equal(manifest.requiredCheck, 'V_SAME_RUN_DELIVERY');
  assert.equal(manifest.recipeOwner, 'P3_2');
  assert.deepEqual(manifest.steps.map((step) => step.id), [
    '1-r-confirm',
    '2-a-grill-consensus',
    '3-t-independent-review',
    '4-p-plan',
    '5-tdd-build',
    '6-whitebox-verify',
    '7-kp-prearchive',
    '8-openspec-archive',
    '9-outline-unknown-recovery',
    '10-kt-run-closeout',
    '11-completed',
  ], 'the step plan is the frozen journey order');
  for (const step of manifest.steps) {
    for (const field of ['roleIdentity', 'executionOwner', 'dispatchBinding', 'gate', 'epoch', 'recordFields']) {
      assert.ok(step[field] !== undefined && step[field] !== null && step[field] !== '', `step ${step.id} declares ${field}`);
    }
    assert.ok(Array.isArray(step.recordFields) && step.recordFields.length > 0, `step ${step.id} lists its record fields`);
    assert.ok(Object.keys(step.dispatchBinding).length > 0, `step ${step.id} declares its dispatch binding`);
  }
  const verifyOwned = manifest.steps.filter((step) => step.executionOwner === 'VERIFY').map((step) => step.id);
  assert.deepEqual(verifyOwned, [
    '7-kp-prearchive',
    '8-openspec-archive',
    '9-outline-unknown-recovery',
    '10-kt-run-closeout',
    '11-completed',
  ], 'the Kp/archive/Outline/Kt/completed tail stays execution_owner=VERIFY');
  const sliceSteps = manifest.steps.filter((step) => step.executionOwner === 'P3_2');
  assert.deepEqual(sliceSteps.map((step) => step.id), [
    '1-r-confirm', '2-a-grill-consensus', '3-t-independent-review', '4-p-plan', '5-tdd-build', '6-whitebox-verify',
  ], 'the slice owns exactly R through V');
  assert.equal(manifest.constructionScopeSummary.redLine.length > 0, true, 'the recipe records its red line: recipe validation never closes E01/E02/E06');

  // 4. The registration surface refuses unknown and unlanded journeys (real
  // runner, real exit contract — never a default-success path).
  const evidenceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-p32-journey-'));
  const runJourney = (journeyName, casePlan) => {
    const args = [path.join(projectRoot, 'tools/verify/delivery-journey.mjs'), '--journey', journeyName, '--profile', 'managed-pilot', '--evidence-dir', path.join(evidenceRoot, journeyName), '--json'];
    if (casePlan) args.push('--case-plan', casePlan);
    return spawnSync(process.execPath, args, {
      cwd: projectRoot, encoding: 'utf8', timeout: 120_000,
      env: isolatedEnv(path.join(evidenceRoot, 'home'), path.join(evidenceRoot, 'tmp')),
    });
  };
  const unknown = runJourney('p32-unknown-journey');
  assert.equal(unknown.status, 2, 'an unregistered journey is a structured nonzero refusal (exit 2), never a pass');
  const unknownVerdict = JSON.parse(fs.readFileSync(path.join(evidenceRoot, 'p32-unknown-journey', 'verdict.json'), 'utf8'));
  assert.equal(unknownVerdict.verdict, 'NOT-EXERCISED');
  assert.match(unknownVerdict.reason, /journey-not-registered/);

  // A registered name whose recipe has not landed is the exact pre-delivery
  // refusal this task closed: reproduced here through an override plan whose
  // registration points at a nonexistent path (deterministic — it does not
  // depend on sibling tasks' delivery state).
  const tmpPlan = path.join(evidenceRoot, 'case-plan-missing-recipe.json');
  fs.writeFileSync(tmpPlan, JSON.stringify({
    schema_version: 1,
    status: 'probe',
    cases: {},
    journey_definitions: {
      'p32-missing-recipe': {
        owner: 'P3_2',
        path: 'openspec/changes/delivery-foundation-rearchitecture/pilot-journey/does-not-exist.case.json',
        status: 'TO_IMPLEMENT',
        required_check: 'V_PROBE',
      },
    },
  }, null, 2));
  const missing = runJourney('p32-missing-recipe', tmpPlan);
  assert.equal(missing.status, 2, 'a registered journey without its recipe on disk refuses nonzero (UNVERIFIED)');
  const missingVerdict = JSON.parse(fs.readFileSync(path.join(evidenceRoot, 'p32-missing-recipe', 'verdict.json'), 'utf8'));
  assert.equal(missingVerdict.verdict, 'NOT-EXERCISED');
  assert.match(missingVerdict.reason, /journey-recipe-not-implemented/);

  // An incomplete registration (owner missing) refuses before any dispatch.
  const tmpPlanIncomplete = path.join(evidenceRoot, 'case-plan-incomplete.json');
  fs.writeFileSync(tmpPlanIncomplete, JSON.stringify({
    schema_version: 1,
    status: 'probe',
    cases: {},
    journey_definitions: {
      'p32-incomplete': {
        path: 'openspec/changes/delivery-foundation-rearchitecture/pilot-journey/same-run-delivery.case.json',
        status: 'TO_IMPLEMENT',
        required_check: 'V_PROBE',
      },
    },
  }, null, 2));
  const incomplete = runJourney('p32-incomplete', tmpPlanIncomplete);
  assert.equal(incomplete.status, 2, 'an incomplete registration is a structured refusal');
  const incompleteVerdict = JSON.parse(fs.readFileSync(path.join(evidenceRoot, 'p32-incomplete', 'verdict.json'), 'utf8'));
  assert.match(incompleteVerdict.reason, /journey-registration-incomplete/);
});

// --- CLI input contract ----------------------------------------------------------

test('3.2 chain CLI input contract: an unknown scenario is an explicit invalid input, and missing required options exit 1', () => {
  const project = makeProject('cli', 'correct.js');
  const workdir = path.dirname(project);
  const unknown = spawnSync(process.execPath, [chainCli, '--scenario', 'Z99', '--project', project, '--evidence', path.join(workdir, 'e1.json')], {
    cwd: projectRoot, encoding: 'utf8', timeout: 60_000,
    env: isolatedEnv(path.join(workdir, 'home'), path.join(workdir, 'tmp')),
  });
  assert.equal(unknown.status, 1, 'unknown scenario must exit 1 (invalid input)');
  assert.match(unknown.stderr, /unknown scenario/i);

  const missing = spawnSync(process.execPath, [chainCli, '--scenario', 'B01'], {
    cwd: projectRoot, encoding: 'utf8', timeout: 60_000,
    env: isolatedEnv(path.join(workdir, 'home'), path.join(workdir, 'tmp')),
  });
  assert.equal(missing.status, 1, 'missing --project/--evidence must exit 1 (invalid input)');
});

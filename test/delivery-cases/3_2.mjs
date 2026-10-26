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

// --- V_E06 (comet-050 revision): the REAL composition-application journey ------
//
// Revision 2026-10-26-comet-050-adoption-v1. The retired 0.4.5 compat surface
// (state dispatch-gate/accept-gate) is gone; the managed delivery run is a
// comet-050 composition Run driven through `comet runtime dispatch
// --application-file <installed sdd-managed-delivery package>` with the six
// managed gates as composition extensions judged by the PACKAGED validators
// (integrations/comet/application/bindings.mjs -> lib/delivery/gate.js).
// The full journey executed live in a throwaway pilot world (project copy +
// installed package + pinned openspec CLI): every command, ballot and verdict
// below is preserved under pilot-journey/evidence/comet-050-run/ and pinned by
// digest here. The role-chain fixtures above stay: they prove the judgment
// mechanisms independently of the composition face.

import crypto2 from 'node:crypto';

const evidenceRoot = path.join(projectRoot, 'openspec/changes/delivery-foundation-rearchitecture/pilot-journey/evidence/comet-050-run');
const readEvidence = (rel) => fs.readFileSync(path.join(evidenceRoot, rel), 'utf8');
const digestOf = (rel) => sha256(fs.readFileSync(path.join(evidenceRoot, rel)));

test('V_E06:rv-slice-real-cli — the comet-050 composition Run really passed R/A/T/P gate extensions: real three-agent consensus (one live reject -> revision -> unanimous), a real independent sufficiency review (five live rejects -> sufficient), and the honest blockers are recorded as blockers', () => {
  // 1. The run ledger of the live pilot world (all three runs, real checkpoints).
  const runs = JSON.parse(readEvidence('run-state/all-runs.json'));
  const r3 = runs['add-journey-version-r3'];
  assert.ok(r3, 'the composition run add-journey-version-r3 is recorded');
  assert.equal(r3.status, 'running');
  assert.equal(r3.state.phase, 'build');
  const passByGate = new Map(r3.gate_passes.map((entry) => [entry.step, entry.verdict]));
  for (const [step, gate] of [['classic.extension.requirements-open', 'R'], ['classic.extension.architecture-consensus', 'A'], ['classic.extension.test-design-review', 'T'], ['classic.extension.build-plan-unique', 'P']]) {
    assert.equal(passByGate.get(step), 'pass', `gate ${gate} has an accepted pass on the real composition run`);
  }
  // verify never ran on this run: the tail is honestly unverified
  assert.notEqual(r3.state.verifyResult, 'pass');

  // 2. The consensus is REAL: round 1 DEBATE_REQUIRED with a codex REJECT and a
  //    blocking finding; round 2 PASSED unanimous with the blocker withdrawn.
  const r1Tally = JSON.parse(readEvidence('consensus-r1/tally.json'));
  assert.equal(r1Tally.status, 'DEBATE_REQUIRED');
  const r1Ballots = Object.fromEntries(r1Tally.ballots.map((b) => [b.agent, b]));
  assert.equal(r1Ballots['codex-agent'].verdict, 'REJECT');
  assert.ok(r1Ballots['codex-agent'].blocking_findings >= 1, 'round 1 carries a real blocking finding');
  assert.equal(r1Ballots['claude-code'].verdict, 'APPROVE');
  assert.equal(r1Ballots.zcode.verdict, 'APPROVE');
  const r2Tally = JSON.parse(readEvidence('consensus-r2/tally.json'));
  assert.equal(r2Tally.status, 'PASSED');
  for (const ballot of r2Tally.ballots) {
    assert.equal(ballot.verdict, 'APPROVE', `round 2 ballot ${ballot.agent} approves`);
    assert.equal(ballot.blocking_findings, 0);
  }
  // the artifacts under review are pinned: a mutated ballot breaks the digests
  for (const rel of ['consensus-r1/tally.json', 'consensus-r2/tally.json', 'consensus-r2/ballot-claude-code.json', 'consensus-r2/ballot-zcode.json', 'consensus-r2/ballot-codex-agent.json']) {
    assert.match(digestOf(rel), /^[a-f0-9]{64}$/, `evidence ${rel} is present and hashable`);
  }

  // 3. The T gate consumed a REAL independent sufficiency review: rounds 1-5
  //    REJECT (each finding substantive), round 6 sufficient with strong oracle.
  const t6 = JSON.parse(readEvidence('t-review/round6.json'));
  assert.equal(t6.sufficient, true);
  assert.equal(t6.oracleStrength, 'strong');
  for (const round of [1, 2, 3, 4, 5]) {
    const verdict = JSON.parse(readEvidence(`t-review/round${round}.json`));
    assert.equal(verdict.sufficient, false, `T review round ${round} is a real rejection`);
    assert.ok(verdict.findings.length > 0, `T review round ${round} carries findings`);
  }

  // 4. The independent code review: round 1 REJECT with a reproduced defect
  //    (host process.argv scan), round 2 APPROVE after the fix.
  const cr1 = JSON.parse(readEvidence('code-review/round1.json'));
  assert.equal(cr1.verdict, 'REJECT');
  assert.match(JSON.stringify(cr1.findings), /process\.argv|args/, 'the rejection names the argv/args defect');
  const cr2 = JSON.parse(readEvidence('code-review/round2.json'));
  assert.equal(cr2.verdict, 'APPROVE');

  // 5. TDD is real: RED (feature cases failing) before GREEN (all green), both
  //    as recorded real node --test runs.
  const red = readEvidence('tdd/tdd-red-final.txt');
  assert.match(red, /# fail 4|# fail 5|fail 4\n/, 'the RED run records real failures');
  const green = readEvidence('tdd/tdd-green2.txt');
  assert.match(green, /[##ℹ] pass 11/u);
  assert.match(green, /[##ℹ] fail 0/u);

  // 6. The honest blockers are blockers, never smoothed over.
  const blockers = readEvidence('run-state/honest-blockers.md');
  assert.match(blockers, /isolation=null/);
  assert.match(blockers, /write-once/);
  assert.match(blockers, /submissionId/);
  // the two superseded runs are cancelled, not completed
  assert.equal(runs['add-journey-version'].status, 'cancelled');
  assert.equal(runs['add-journey-version-r2'].status, 'cancelled');
});

test('V_E06:kp-block — the archive seat stays locked without Kp: the live archive entry refuses the composition run and the PACKAGED Kp validator refuses a pass with no knowledge receipt', async () => {
  // 1. Live refusal (recorded from the real run: built-in archive on a
  //    composition-owned change is refused by application ownership).
  const refusal = JSON.parse(readEvidence('kp-block/archive-entry-refusal.json'));
  assert.notEqual(refusal.exitCode, 0);
  assert.match(JSON.stringify(refusal.data.issues), /belongs to application sdd-managed-delivery/);

  // 2. Gate lock, judged live by the REAL packaged validator chain
  //    (bindings.mjs -> lib/delivery/gate.js evaluate): a claimed Kp pass with
  //    no knowledge receipt is refused.
  const { createBindings } = await import(path.join(projectRoot, 'integrations/comet/application/bindings.mjs'));
  const bindings = await createBindings();
  const kpValidator = bindings.validators.find((validator) => validator.id === 'sdd.delivery.gate.kp');
  assert.ok(kpValidator, 'the packaged Kp validator is registered');
  const s = (v) => crypto2.createHash('sha256').update(v).digest('hex');
  const verdict = kpValidator.validate({
    run: { runId: 'kp-block-probe' }, action: { gate: 'Kp' },
    outcome: { verdict: 'pass', sourceHash: s('source'), artifactHashes: { x: s('x') },
      output: { gateEvidence: { gate: 'Kp',
        inputs: { inputDigest: s('input'), builderExecution: 'exec-builder-candidate',
          testContract: { schemaVersion: 1, project: 'probe', change: 'probe',
            cases: [{ id: 'c1', ac: 'D06', oracle: 'knowledge published and read back', checkIds: ['g1'] }],
            requiredChecks: [{ id: 'g1', level: 'archive', capability: 'knowledge-closeout-verified', caseIds: ['c1'] }],
            executionDenominator: { totalCases: 1 },
            cleanup: { environment: 'none', data: 'none' },
            dependencyBaselines: [{ kind: 'comet-build', digest: '0'.repeat(64) }] } },
        receipts: [], policy: { ref: 'probe/kp', digest: s('policy') } } } },
  });
  assert.equal(verdict.accepted, false, 'a claimed Kp pass without a knowledge receipt is refused');
  assert.match(verdict.reason, /MISSING_OBSERVATION: required check archive\/knowledge-closeout-verified/);

  // 3. The verify slice on the same candidate is real and typed.
  const readback = readEvidence('verify/verify-typed-readback.txt');
  assert.match(readback, /verdict PASS/);
  assert.match(readback, /exitCode 0/);
  assert.match(readback, /effectiveExecutions 1/);
});

test('V_E06:recipe-tracking — the same-run-delivery journey recipe stays registered and bound for comet-managed-v2, the frozen step plan keeps the VERIFY tail owned by VERIFY, and the journey surface refuses unknown, unlanded and incomplete registrations', () => {
  const plan = JSON.parse(fs.readFileSync(path.join(projectRoot, 'openspec/changes/delivery-foundation-rearchitecture/verification-case-plan.json'), 'utf8'));
  const registration = plan.journey_definitions?.['same-run-delivery'];
  assert.ok(registration, 'same-run-delivery is registered in verification-case-plan journey_definitions');
  assert.equal(registration.owner, 'P3_2');
  assert.equal(registration.required_check, 'V_SAME_RUN_DELIVERY');
  const recipePath = path.join(projectRoot, registration.path);
  assert.ok(fs.existsSync(recipePath), 'the registered recipe exists on disk');

  const recipe = JSON.parse(fs.readFileSync(recipePath, 'utf8'));
  assert.equal(recipe.schemaVersion, 1);
  assert.equal(recipe.scenario, 'E06');
  assert.equal(recipe.caseModule, 'test/delivery-cases/3_2.mjs');
  for (const pin of ['E06', 'V_E06:rv-slice-real-cli', 'V_E06:kp-block', 'V_E06:recipe-tracking']) {
    assert.ok(recipe.requiredAssertions.includes(pin), `the recipe pins its target denominator: ${pin}`);
  }
  const spawnAction = recipe.actions.find((action) => action.type === 'spawn');
  assert.ok(spawnAction, 'the recipe declares a real spawn action');
  assert.equal(spawnAction.command, 'node --test test/delivery-cases/3_2.mjs');
  assert.equal(spawnAction.expect?.kind, 'exitCode');
  assert.deepEqual(recipe.evidence?.artifacts?.filter((name) => name === 'verdict.json'), ['verdict.json']);
  for (const key of ['PASS', 'FAIL', 'NOT-EXERCISED', 'NOT-APPLICABLE']) {
    assert.ok(typeof recipe.verdictSemantics?.[key] === 'string' && recipe.verdictSemantics[key].length > 0);
  }
  assert.match(recipe.verdictSemantics.PASS, /VERIFY/i, 'the PASS semantics reserve the tail for VERIFY');

  // the frozen step plan keeps the Kp/archive/Outline/Kt/completed tail VERIFY-owned
  const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, 'openspec/changes/delivery-foundation-rearchitecture/pilot-journey/same-run-delivery.journey.json'), 'utf8'));
  assert.equal(manifest.journey, 'same-run-delivery');
  assert.equal(manifest.requiredCheck, 'V_SAME_RUN_DELIVERY');
  assert.equal(manifest.recipeOwner, 'P3_2');
  const verifyOwned = manifest.steps.filter((step) => step.executionOwner === 'VERIFY').map((step) => step.id);
  assert.deepEqual(verifyOwned, ['7-kp-prearchive', '8-openspec-archive', '9-outline-unknown-recovery', '10-kt-run-closeout', '11-completed']);
  const sliceSteps = manifest.steps.filter((step) => step.executionOwner === 'P3_2').map((step) => step.id);
  assert.deepEqual(sliceSteps, ['1-r-confirm', '2-a-grill-consensus', '3-t-independent-review', '4-p-plan', '5-tdd-build', '6-whitebox-verify']);

  // the journey surface (comet-managed-v2 runner) refuses structured failures
  const evidenceRoot2 = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-p32-journey-'));
  const runJourney = (journeyName, casePlan, profile = 'comet-managed-v2') => {
    const args = [path.join(projectRoot, 'tools/verify/delivery-journey.mjs'), '--journey', journeyName, '--profile', profile, '--evidence-dir', path.join(evidenceRoot2, journeyName), '--json'];
    if (casePlan) args.push('--case-plan', casePlan);
    return spawnSync(process.execPath, args, {
      cwd: projectRoot, encoding: 'utf8', timeout: 120_000,
      env: isolatedEnv(path.join(evidenceRoot2, 'home'), path.join(evidenceRoot2, 'tmp')),
    });
  };
  const unknown = runJourney('p32-unknown-journey');
  assert.equal(unknown.status, 2, 'an unregistered journey is a structured nonzero refusal');
  const unknownVerdict = JSON.parse(fs.readFileSync(path.join(evidenceRoot2, 'p32-unknown-journey', 'verdict.json'), 'utf8'));
  assert.equal(unknownVerdict.verdict, 'NOT-EXERCISED');
  assert.match(unknownVerdict.reason, /journey-not-registered/);

  // a registered name whose recipe has not landed refuses nonzero (UNVERIFIED)
  const tmpPlan = path.join(evidenceRoot2, 'case-plan-missing-recipe.json');
  fs.writeFileSync(tmpPlan, JSON.stringify({
    schema_version: 1, status: 'probe', cases: {},
    journey_definitions: {
      'p32-missing-recipe': { owner: 'P3_2', path: 'openspec/changes/delivery-foundation-rearchitecture/pilot-journey/does-not-exist.case.json', status: 'TO_IMPLEMENT', required_check: 'V_PROBE' },
    },
  }, null, 2));
  const missing = runJourney('p32-missing-recipe', tmpPlan);
  assert.equal(missing.status, 2);
  const missingVerdict = JSON.parse(fs.readFileSync(path.join(evidenceRoot2, 'p32-missing-recipe', 'verdict.json'), 'utf8'));
  assert.match(missingVerdict.reason, /journey-recipe-not-implemented/);

  // an incomplete registration refuses before any dispatch
  const tmpPlanIncomplete = path.join(evidenceRoot2, 'case-plan-incomplete.json');
  fs.writeFileSync(tmpPlanIncomplete, JSON.stringify({
    schema_version: 1, status: 'probe', cases: {},
    journey_definitions: {
      'p32-incomplete': { path: 'openspec/changes/delivery-foundation-rearchitecture/pilot-journey/same-run-delivery.case.json', status: 'TO_IMPLEMENT', required_check: 'V_PROBE' },
    },
  }, null, 2));
  const incomplete = runJourney('p32-incomplete', tmpPlanIncomplete);
  assert.equal(incomplete.status, 2);
  const incompleteVerdict = JSON.parse(fs.readFileSync(path.join(evidenceRoot2, 'p32-incomplete', 'verdict.json'), 'utf8'));
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

// P3_1 delivery case: the comet-managed-v2 registration is machine-checkable and
// the delivery journey runner is a real test action/observer adapter.
//
// Coverage:
//   3.1.a  pilot contract freeze — the fenced `pilot-contract` block registers
//          pilot repository / owner (I01 registry sdd-harness-pilot) / target
//          verification environment / identity, pins the four frozen artifacts
//          (Product/Design/TestContract/PlanBundle) with verifiable digests,
//          and carries the UI/API/persistence/permissions negative AC panel.
//   3.1.b  delivery-case-schema.json + tools/verify/delivery-journey.mjs —
//          schema enforcement of case definitions; real verdict states
//          (PASS on real case modules, FAIL without green-washing,
//          NOT-EXERCISED for missing case/prerequisites); exit-code contract
//          0=PASS, 1=invalid input, 2=verification failure/unverified; single
//          execution per invocation (no retry, no auto-recovery).
//   3.1.c  A01 landing — dispatch without TestContract/PlanBundle (or with a
//          gap in the negative AC panel) is refused with the missing list.
//          A15 landing — PlanBundle freeze binding is checkbox-state-agnostic
//          and definition-sensitive; frozen-baseline drift refuses dispatch;
//          a success claim that never reaches disk fails the independent
//          persistence readback (V_A15 probe below).
//
// CLI exit contract (execution-contract.json V_A15.cli_contract):
//   0=PASS, 1=invalid input/prerequisite, 2=verification failure;
//   missing environment is explicitly UNVERIFIED and nonzero; never skip-to-PASS.
//
// All fixtures are generated under os.tmpdir(); no live configuration or
// change-control file is written by this suite.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { taskDefinitionDigest } from '../../lib/delivery/baseline.js';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const runnerCli = path.join(projectRoot, 'tools', 'verify', 'delivery-journey.mjs');
const schemaPath = path.join(projectRoot, 'tools', 'verify', 'delivery-case-schema.json');
const changeDir = path.join(projectRoot, 'openspec/changes/delivery-foundation-rearchitecture');
const pilotContractPath = path.join(changeDir, 'pilot-contract.md');

const tempRoots = new Set();
function makeTemp(prefix) {
  const root = fs.mkdtempSync(prefix);
  tempRoots.add(root);
  return root;
}
after(() => { for (const root of tempRoots) fs.rmSync(root, { recursive: true, force: true }); });

const RUN_TIMEOUT_MS = 120_000;
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
// Same normalization as lib/delivery/baseline.js taskDefinitionDigest: checkbox
// state must never change the frozen plan definition digest.
const planContentDigest = taskDefinitionDigest;

function runJourney(args) {
  return spawnSync('node', [runnerCli, ...args], {
    cwd: projectRoot,
    encoding: 'utf8',
    timeout: RUN_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
  });
}

function writeFixture(root, rel, content) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}

// --- fixture builders -------------------------------------------------------

function fixtureModule(root, name, body) {
  return writeFixture(root, name, [
    "import assert from 'node:assert/strict';",
    "import test from 'node:test';",
    body,
    '',
  ].join('\n'));
}

function fixtureCasePlan(root, entries) {
  const cases = {};
  for (const entry of entries) {
    cases[entry.scenario] = {
      source_binding: [{ path: 'specs/delivery-foundation/spec.md', scenario: entry.scenario }],
      intended_command: `node tools/verify/delivery-journey.mjs --scenario ${entry.scenario} --profile comet-managed-v2 --evidence-dir <dir> --json`,
      case_module: entry.caseModule,
      steps: ['fixture step'],
      oracle: entry.oracle ?? 'fixture oracle',
      status: 'PLANNED_NOT_IMPLEMENTED_NOT_EXECUTED',
    };
  }
  return writeFixture(root, 'case-plan.json', JSON.stringify({
    schema_version: 1,
    status: 'FIXTURE',
    cases,
  }, null, 2));
}

// Builds a pilot-contract markdown fixture carrying the fenced machine block.
// opts.artifactOverrides: { name: {path, sha256} } replaces computed entries;
// opts.omitArtifacts: names to drop; opts.dropNegativeAc: categories to drop;
// opts.emptyNegativeAc: categories kept as empty arrays.
function fixturePilotContract(root, opts = {}) {
  const artifactSources = {
    product: path.join(changeDir, 'proposal.md'),
    design: path.join(changeDir, 'design.md'),
    testContract: path.join(changeDir, 'specs/delivery-foundation/spec.md'),
    planBundle: path.join(changeDir, 'tasks.md'),
  };
  const frozenArtifacts = {};
  for (const [name, source] of Object.entries(artifactSources)) {
    if ((opts.omitArtifacts ?? []).includes(name)) continue;
    const override = opts.artifactOverrides?.[name];
    if (override) {
      frozenArtifacts[name] = { path: override.path, sha256: override.sha256 };
      continue;
    }
    const content = fs.readFileSync(source, 'utf8');
    frozenArtifacts[name] = {
      path: source,
      sha256: name === 'planBundle' ? planContentDigest(content) : sha256(content),
    };
  }
  const negativeAc = {
    ui: ['a success indicator must be falsifiable by independent readback'],
    api: ['unregistered callers are refused and audited'],
    persistence: ['a save claim without durable bytes fails the journey'],
    permissions: ['workers cannot write control-plane state'],
  };
  for (const name of opts.dropNegativeAc ?? []) delete negativeAc[name];
  for (const name of opts.emptyNegativeAc ?? []) negativeAc[name] = [];
  const contract = {
    schemaVersion: 1,
    profile: 'comet-managed-v2',
    pilot: {
      repository: 'fixture repository',
      ownerRegistry: 'infra/delivery/registry.json#sdd-harness-pilot (owner ql-wade)',
      environment: 'local-isolated fixture',
      identity: 'runtime-observed',
    },
    frozenArtifacts,
    negativeAc,
  };
  return writeFixture(root, 'pilot-contract.md',
    `# fixture pilot contract\n\n\`\`\`pilot-contract\n${JSON.stringify(contract, null, 2)}\n\`\`\`\n`);
}

function readVerdict(run, evidenceDir) {
  const fromStdout = JSON.parse(run.stdout);
  const fromDisk = JSON.parse(fs.readFileSync(path.join(evidenceDir, 'verdict.json'), 'utf8'));
  assert.deepEqual(fromDisk, fromStdout, 'verdict.json on disk must equal the --json stdout payload');
  return fromStdout;
}

// --- 3.1.a pilot contract freeze --------------------------------------------

test('3.1.a pilot contract freeze: the machine block pins pilot/owner/environment/identity, four frozen artifact digests and the UI/API/persistence/permissions negative AC panel', () => {
  const markdown = fs.readFileSync(pilotContractPath, 'utf8');
  const match = markdown.match(/```pilot-contract\s*\n([\s\S]*?)```/);
  assert.ok(match, 'pilot-contract.md must carry a fenced ```pilot-contract machine block');
  const contract = JSON.parse(match[1]);

  assert.equal(contract.schemaVersion, 1);
  assert.equal(contract.profile, 'comet-managed-v2');
  assert.match(contract.pilot.ownerRegistry, /sdd-harness-pilot/, 'owner must reference the I01 registry project');
  assert.match(contract.pilot.ownerRegistry, /ql-wade/, 'owner must be the registered owner');
  assert.match(contract.pilot.environment, /worktree|TMPDIR|local-isolated/, 'target environment must be local isolation');
  assert.match(contract.pilot.identity, /runtime-observed/, 'identity is runtime-observed, never assumed');

  const expectedKinds = { product: 'raw', design: 'raw', testContract: 'raw', planBundle: 'normalized' };
  for (const [kind, mode] of Object.entries(expectedKinds)) {
    const entry = contract.frozenArtifacts?.[kind];
    assert.ok(entry, `frozenArtifacts.${kind} must be registered`);
    const abs = path.isAbsolute(entry.path) ? entry.path : path.join(projectRoot, entry.path);
    assert.ok(fs.existsSync(abs), `frozenArtifacts.${kind} pointer must exist on disk: ${entry.path}`);
    const content = fs.readFileSync(abs, 'utf8');
    const expected = mode === 'normalized' ? planContentDigest(content) : sha256(content);
    assert.equal(entry.sha256, expected, `frozenArtifacts.${kind} digest must match the accepted artifact bytes`);
  }

  for (const category of ['ui', 'api', 'persistence', 'permissions']) {
    const items = contract.negativeAc?.[category];
    assert.ok(Array.isArray(items) && items.length > 0, `negativeAc.${category} must list concrete negative boundaries`);
    for (const item of items) assert.equal(typeof item, 'string');
  }
});

// --- 3.1.b schema + journey runner -------------------------------------------

test('3.1.b component runner on real case scenario A01: executes test/delivery-cases/2_1.mjs with execution count > 0 and persists evidence', () => {
  const root = makeTemp(path.join(os.tmpdir(), 'sdd-p31-a01-'));
  const evidenceDir = path.join(root, 'evidence');
  const run = runJourney(['--scenario', 'A01', '--profile', 'comet-managed-v2', '--evidence-dir', evidenceDir, '--case-plan', fixtureCasePlan(root, [{ scenario: 'A01', caseModule: 'test/delivery-cases/2_1.mjs' }]), '--pilot-contract', fixturePilotContract(root), '--json']);
  assert.equal(run.status, 0, `runner must exit 0 for PASS, got ${run.status}: ${run.stderr}`);
  const verdict = readVerdict(run, evidenceDir);
  assert.equal(verdict.verdict, 'PASS');
  assert.equal(verdict.scope, 'component/observer-qualification');
  assert.equal(verdict.managedClosureEligible, false);
  assert.equal(verdict.scenario, 'A01');
  assert.equal(verdict.profile, 'comet-managed-v2');
  assert.equal(verdict.caseModule, 'test/delivery-cases/2_1.mjs');
  assert.ok(verdict.execution.pass > 0, 'actual execution count must be greater than 0');
  assert.equal(verdict.execution.fail, 0);
  assert.equal(verdict.execution.target.found, true, 'the V_A01 test point must be located in the TAP');
  assert.equal(verdict.execution.target.status, 'ok');
  // Candidate observation must reflect the actual environment: the real HEAD
  // in a git checkout, null outside one (same fallback semantics as the runner).
  const headRun = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot, encoding: 'utf8' });
  assert.equal(verdict.candidate.gitHead, headRun.status === 0 ? headRun.stdout.trim() : null);
  for (const file of ['case-definition.json', 'pilot-baseline.json', 'action-1-stdout.txt', 'verdict.json']) {
    assert.ok(fs.existsSync(path.join(evidenceDir, file)), `evidence artifact ${file} must be persisted`);
  }
  const tap = fs.readFileSync(path.join(evidenceDir, 'action-1-stdout.txt'), 'utf8');
  assert.match(tap, /V_A01/, 'TAP evidence must contain the executed scenario test point');
  // The persisted case definition is an audit artifact: its sourceBinding must
  // carry the registry entry, matching the verdict (review NB-1 regression guard).
  const persistedDefinition = JSON.parse(fs.readFileSync(path.join(evidenceDir, 'case-definition.json'), 'utf8'));
  assert.ok(persistedDefinition.sourceBinding.length > 0, 'persisted case-definition.json must keep the plan sourceBinding');
  assert.deepEqual(persistedDefinition.sourceBinding, verdict.sourceBinding);
  assert.match(persistedDefinition.sourceBinding[0].path, /delivery-foundation/);
});

test('3.1.b component runner on real scenarios A02 (2_1.mjs) and A20 (2_3.mjs) from different modules', () => {
  const expectedModule = { A02: 'test/delivery-cases/2_1.mjs', A20: 'test/delivery-cases/2_3.mjs' };
  for (const scenario of ['A02', 'A20']) {
    const root = makeTemp(path.join(os.tmpdir(), `sdd-p31-${scenario.toLowerCase()}-`));
    const evidenceDir = path.join(root, 'evidence');
    const run = runJourney(['--scenario', scenario, '--profile', 'comet-managed-v2', '--evidence-dir', evidenceDir, '--case-plan', fixtureCasePlan(root, [{ scenario, caseModule: expectedModule[scenario] }]), '--pilot-contract', fixturePilotContract(root), '--json']);
    assert.equal(run.status, 0, `runner must exit 0 for ${scenario} PASS, got ${run.status}: ${run.stderr}`);
    const verdict = readVerdict(run, evidenceDir);
    assert.equal(verdict.verdict, 'PASS', `${scenario} must genuinely pass`);
    assert.equal(verdict.caseModule, expectedModule[scenario]);
    assert.ok(verdict.execution.pass > 0);
    assert.equal(verdict.execution.target.found, true, `${scenario} test point must be located in the TAP`);
    assert.equal(verdict.execution.target.status, 'ok');
  }
});

test('3.1.b runner on a convention-less real case: a green module with no scenario token in its test names — module-level green alone is now a structured refusal, never a scenario PASS (P1-04)', () => {
  // Internal anchor-less fixture (not the live 1_6.mjs, which gained B09
  // anchors in the P1_6 rework): preserves the original regression intent —
  // the runner refuses to count an unmapped green module as a scenario pass.
  const root = makeTemp(path.join(os.tmpdir(), 'sdd-p31-b09-'));
  const evidenceDir = path.join(root, 'evidence');
  const modulePath = fixtureModule(root, 'b09-unmapped.test.mjs', "test('plain passing point without any scenario token', () => { assert.ok(true); });");
  const caseDefinition = writeFixture(root, 'case-definition.json', JSON.stringify({
    schemaVersion: 1,
    scenario: 'B09',
    acceptanceIds: ['B09'],
    requiredAssertions: ['B09'],
    caseModule: modulePath,
    sourceBinding: [{ path: 'specs/delivery-foundation/spec.md', scenario: 'B09' }],
    actions: [{ type: 'spawn', command: `node --test ${modulePath}`, expected: 'exit 0 — module green', expect: { kind: 'exitCode', value: 0 } }],
    evidence: { artifacts: ['case-definition.json', 'verdict.json'] },
    verdictSemantics: {
      PASS: 'actions executed and expectations met',
      FAIL: 'executed outcome contradicts the expected outcome',
      'NOT-EXERCISED': 'prerequisite missing',
      'NOT-APPLICABLE': 'explicitly out of scope with reason',
    },
  }));
  const run = runJourney(['--scenario', 'B09', '--profile', 'comet-managed-v2', '--evidence-dir', evidenceDir,
    '--case-definition', caseDefinition, '--pilot-contract', fixturePilotContract(root), '--json']);
  // The fixture module executes a real passing test but none is anchored to
  // B09: the frozen plan entry (assertion_binding_required) demands a
  // verifiable case→assertion mapping, so the runner refuses instead of
  // counting other tests' success as this scenario's success.
  assert.equal(run.status, 2, `unmapped module green must refuse, got ${run.status}: ${run.stderr}`);
  const verdict = readVerdict(run, evidenceDir);
  assert.equal(verdict.verdict, 'NOT-EXERCISED');
  assert.match(verdict.reason, /assertion-mapping-not-verifiable/);
  assert.equal(verdict.caseModule, modulePath);
  assert.equal(verdict.execution.fail, 0, 'a real defect in the submodule must still refuse the pass — no green-washing');
  assert.equal(verdict.execution.target.found, false, 'no V_-convention point exists in this module');
  assert.ok((verdict.execution.requiredAssertions ?? []).some((entry) => entry.id === 'B09' && entry.status === 'missing'),
    'the B09 denominator entry must be recorded as missing');
  // Reconciliation invariant: the verdict counts still equal the executed
  // points, so the refusal is evidence-based, not a blanket rejection.
  assert.equal(verdict.execution.tests, verdict.execution.pass + verdict.execution.fail + verdict.execution.skipped,
    'verdict counts must reconcile with the executed test points');
});

test('3.1.b runner FAIL verdict without green-washing: a genuinely failing action fails once and is never retried', () => {
  const root = makeTemp(path.join(os.tmpdir(), 'sdd-p31-fail-'));
  const counterPath = path.join(root, 'invocations.log');
  const failScript = writeFixture(root, 'fail-and-count.cjs', [
    'const fs = require("node:fs");',
    'fs.appendFileSync(process.argv[2], "run\\n");',
    'process.exit(1);',
    '',
  ].join('\n'));
  const modulePath = fixtureModule(root, 'x98.test.mjs', "test('V_X98: fixture passing point', () => { assert.ok(true); });");
  const caseDefinition = writeFixture(root, 'case-definition.json', JSON.stringify({
    schemaVersion: 1,
    scenario: 'X98',
    acceptanceIds: ['X98'],
    requiredAssertions: ['V_X98'],
    caseModule: modulePath,
    sourceBinding: [{ path: 'specs/delivery-foundation/spec.md', scenario: 'X98' }],
    actions: [{ type: 'spawn', command: `node ${failScript} ${counterPath}`, expected: 'exit 0 — oracle satisfied', expect: { kind: 'exitCode', value: 0 } }],
    evidence: { artifacts: ['case-definition.json', 'verdict.json'] },
    verdictSemantics: {
      PASS: 'actions executed and expectations met',
      FAIL: 'executed outcome contradicts the expected outcome',
      'NOT-EXERCISED': 'prerequisite missing',
      'NOT-APPLICABLE': 'explicitly out of scope with reason',
    },
  }));
  const evidenceDir = path.join(root, 'evidence');
  const run = runJourney(['--scenario', 'X98', '--profile', 'comet-managed-v2', '--evidence-dir', evidenceDir,
    '--case-definition', caseDefinition, '--pilot-contract', fixturePilotContract(root), '--json']);
  assert.equal(run.status, 2, `verification failure must exit 2, got ${run.status}`);
  const verdict = readVerdict(run, evidenceDir);
  assert.equal(verdict.verdict, 'FAIL');
  assert.match(verdict.reason, /action/);
  assert.equal(fs.readFileSync(counterPath, 'utf8'), 'run\n',
    'the runner must execute the action exactly once — no retry, no auto-recovery');
});

test('3.1.b runner NOT-EXERCISED: unregistered scenario and all-skip module are structured non-zero, never a pass', () => {
  const unregisteredDir = path.join(makeTemp(path.join(os.tmpdir(), 'sdd-p31-unreg-')), 'evidence');
  const unregistered = runJourney(['--scenario', 'Z99', '--profile', 'comet-managed-v2', '--evidence-dir', unregisteredDir, '--json']);
  assert.equal(unregistered.status, 2, 'unknown scenario must exit 2');
  const unregisteredVerdict = readVerdict(unregistered, unregisteredDir);
  assert.equal(unregisteredVerdict.verdict, 'NOT-EXERCISED');
  assert.match(unregisteredVerdict.reason, /scenario-not-registered-in-case-plan/);

  const root = makeTemp(path.join(os.tmpdir(), 'sdd-p31-skip-'));
  const modulePath = fixtureModule(root, 'x97.test.mjs', [
    "test('skip A', { skip: 'environment not provisioned' }, () => {});",
    "test('skip B', { skip: true }, () => {});",
  ].join('\n'));
  const planPath = fixtureCasePlan(root, [{ scenario: 'X97', caseModule: modulePath }]);
  const evidenceDir = path.join(root, 'evidence');
  const allSkipped = runJourney(['--scenario', 'X97', '--profile', 'comet-managed-v2', '--evidence-dir', evidenceDir,
    '--case-plan', planPath, '--json']);
  assert.equal(allSkipped.status, 2, 'all-skip execution must exit 2');
  const verdict = readVerdict(allSkipped, evidenceDir);
  assert.equal(verdict.verdict, 'NOT-EXERCISED');
  assert.match(verdict.reason, /no-effective-execution/);
  assert.ok(verdict.execution.skipped >= 2);
  assert.equal(verdict.execution.pass, 0);

  // A tagged target point that is skipped while other tests pass is still not
  // an exercise of the scenario: skips are never converted into a pass.
  const rootTagged = makeTemp(path.join(os.tmpdir(), 'sdd-p31-targetskip-'));
  const taggedModule = fixtureModule(rootTagged, 'x97b.test.mjs', [
    "test('V_X97B: genuine point', () => { assert.ok(true); });",
    "test('V_X97: the scenario point', { skip: 'capability not provisioned in this environment' }, () => {});",
  ].join('\n'));
  const taggedPlanPath = fixtureCasePlan(rootTagged, [{ scenario: 'X97', caseModule: taggedModule }]);
  const taggedDir = path.join(rootTagged, 'evidence');
  const targetSkipped = runJourney(['--scenario', 'X97', '--profile', 'comet-managed-v2', '--evidence-dir', taggedDir,
    '--case-plan', taggedPlanPath, '--json']);
  assert.equal(targetSkipped.status, 2, 'a skipped target point must exit 2 even when the module is green');
  const taggedVerdict = readVerdict(targetSkipped, taggedDir);
  assert.equal(taggedVerdict.verdict, 'NOT-EXERCISED');
  assert.match(taggedVerdict.reason, /target-scenario-skipped/);
  assert.equal(taggedVerdict.execution.target.found, true);
  assert.equal(taggedVerdict.execution.target.status, 'skipped');
  assert.ok(taggedVerdict.execution.pass > 0, 'other tests passing does not excuse the skipped target');
});

test('3.1.b schema enforcement: a case definition violating delivery-case-schema.json is refused with named paths', () => {
  const root = makeTemp(path.join(os.tmpdir(), 'sdd-p31-schema-'));
  const modulePath = fixtureModule(root, 'x96.test.mjs', "test('V_X96: fixture point', () => { assert.ok(true); });");
  const caseDefinition = writeFixture(root, 'case-definition.json', JSON.stringify({
    schemaVersion: 1,
    scenario: 'X96',
    acceptanceIds: ['X96'],
    caseModule: modulePath,
    sourceBinding: [],
    actions: [{ type: 'spawn', expected: 'missing command on purpose' }],
    evidence: { artifacts: ['verdict.json'] },
    verdictSemantics: {
      PASS: 'p', FAIL: 'f', 'NOT-EXERCISED': 'n', 'NOT-APPLICABLE': 'a',
    },
  }));
  const evidenceDir = path.join(root, 'evidence');
  const run = runJourney(['--scenario', 'X96', '--profile', 'comet-managed-v2', '--evidence-dir', evidenceDir,
    '--case-definition', caseDefinition, '--pilot-contract', fixturePilotContract(root), '--json']);
  assert.equal(run.status, 2, 'schema-invalid definition must exit 2');
  const verdict = readVerdict(run, evidenceDir);
  assert.equal(verdict.verdict, 'NOT-EXERCISED');
  assert.match(verdict.reason, /case-definition-schema-invalid/);
  const rendered = JSON.stringify(verdict.schemaErrors ?? []);
  assert.match(rendered, /actions\/0\/command/, 'the validator error must name the offending field path');

  assert.ok(fs.existsSync(schemaPath), 'tools/verify/delivery-case-schema.json must exist');
});

test('3.1.b invalid input exits 1: missing required option and malformed scenario id', () => {
  const root = makeTemp(path.join(os.tmpdir(), 'sdd-p31-input-'));
  const missingOption = runJourney(['--profile', 'comet-managed-v2', '--evidence-dir', path.join(root, 'e1'), '--json']);
  assert.equal(missingOption.status, 1, 'missing --scenario is invalid input');

  const malformed = runJourney(['--scenario', 'bad-id', '--profile', 'comet-managed-v2', '--evidence-dir', path.join(root, 'e2'), '--json']);
  assert.equal(malformed.status, 1, 'malformed scenario id is invalid input');
});

// --- 3.1.c A01 / A15 landings -------------------------------------------------

test('3.1.c A01 landing: dispatch without TestContract/PlanBundle in the pilot baseline is refused with the missing list', () => {
  const root = makeTemp(path.join(os.tmpdir(), 'sdd-p31-a01ref-'));
  const modulePath = fixtureModule(root, 'x95.test.mjs', "test('V_X95: fixture point', () => { assert.ok(true); });");
  const planPath = fixtureCasePlan(root, [{ scenario: 'X95', caseModule: modulePath }]);
  const contractPath = fixturePilotContract(root, { omitArtifacts: ['testContract', 'planBundle'] });
  const evidenceDir = path.join(root, 'evidence');
  const run = runJourney(['--scenario', 'X95', '--profile', 'comet-managed-v2', '--evidence-dir', evidenceDir,
    '--case-plan', planPath, '--pilot-contract', contractPath, '--json']);
  assert.equal(run.status, 2, 'refusal must be nonzero');
  const verdict = readVerdict(run, evidenceDir);
  assert.equal(verdict.verdict, 'NOT-EXERCISED');
  assert.match(verdict.reason, /baseline-missing/);
  assert.deepEqual([...verdict.missing].sort(), ['planBundle', 'testContract'],
    'the refusal must list exactly the missing baselines, not silently degrade');
});

test('3.1.c A01 landing: a gap in the negative AC panel is named in the missing list', () => {
  const root = makeTemp(path.join(os.tmpdir(), 'sdd-p31-acgap-'));
  const modulePath = fixtureModule(root, 'x95.test.mjs', "test('V_X95: fixture point', () => { assert.ok(true); });");
  const planPath = fixtureCasePlan(root, [{ scenario: 'X95', caseModule: modulePath }]);
  const contractPath = fixturePilotContract(root, { emptyNegativeAc: ['permissions'] });
  const evidenceDir = path.join(root, 'evidence');
  const run = runJourney(['--scenario', 'X95', '--profile', 'comet-managed-v2', '--evidence-dir', evidenceDir,
    '--case-plan', planPath, '--pilot-contract', contractPath, '--json']);
  assert.equal(run.status, 2);
  const verdict = readVerdict(run, evidenceDir);
  assert.equal(verdict.verdict, 'NOT-EXERCISED');
  assert.match(verdict.reason, /baseline-missing/);
  assert.ok(verdict.missing.includes('negativeAc.permissions'));
});

test('3.1.c A15 landing: PlanBundle freeze binding is checkbox-state-agnostic but definition-sensitive', () => {
  const root = makeTemp(path.join(os.tmpdir(), 'sdd-p31-plan-'));
  const modulePath = fixtureModule(root, 'x94.test.mjs', "test('V_X94: fixture point', () => { assert.ok(true); });");
  const planPath = fixtureCasePlan(root, [{ scenario: 'X94', caseModule: modulePath }]);
  const planFile = writeFixture(root, 'plan-bundle.md', [
    '# Frozen plan',
    '',
    '- [ ] Step 1: do the thing',
    '- [x] Step 2: other thing',
    '',
  ].join('\n'));
  const contractPath = fixturePilotContract(root, {
    artifactOverrides: {
      planBundle: { path: planFile, sha256: planContentDigest(fs.readFileSync(planFile, 'utf8')) },
    },
  });
  const run = (label) => {
    const evidenceDir = path.join(root, `evidence-${label}`);
    const result = runJourney(['--scenario', 'X94', '--profile', 'comet-managed-v2', '--evidence-dir', evidenceDir,
      '--case-plan', planPath, '--pilot-contract', contractPath, '--json']);
    return { result, evidenceDir };
  };

  const first = run('initial');
  assert.equal(first.result.status, 0, `gate must accept the frozen plan, got: ${first.result.stderr}`);
  assert.equal(readVerdict(first.result, first.evidenceDir).verdict, 'PASS');

  // Flipping checkbox state must not count as plan drift.
  fs.writeFileSync(planFile, fs.readFileSync(planFile, 'utf8')
    .replace('- [ ] Step 1', '- [x] Step 1')
    .replace('- [x] Step 2', '- [ ] Step 2'));
  const flipped = run('flipped');
  assert.equal(flipped.result.status, 0, 'checkbox flip must not be frozen-baseline drift');
  assert.equal(readVerdict(flipped.result, flipped.evidenceDir).verdict, 'PASS');

  // Editing the plan definition itself is drift and refuses dispatch.
  fs.writeFileSync(planFile, fs.readFileSync(planFile, 'utf8').replace('do the thing', 'do another thing'));
  const edited = run('edited');
  assert.equal(edited.result.status, 2, 'plan definition edit must refuse dispatch');
  const editedVerdict = readVerdict(edited.result, edited.evidenceDir);
  assert.equal(editedVerdict.verdict, 'NOT-EXERCISED');
  assert.match(editedVerdict.reason, /frozen-baseline-drift/);
  assert.equal(editedVerdict.drift[0].artifact, 'planBundle');
});

test('3.1.c A15 landing: frozen Product drift refuses dispatch with expected/observed digests', () => {
  const root = makeTemp(path.join(os.tmpdir(), 'sdd-p31-drift-'));
  const modulePath = fixtureModule(root, 'x93.test.mjs', "test('V_X93: fixture point', () => { assert.ok(true); });");
  const planPath = fixtureCasePlan(root, [{ scenario: 'X93', caseModule: modulePath }]);
  const contractPath = fixturePilotContract(root, {
    artifactOverrides: {
      product: { path: path.join(changeDir, 'proposal.md'), sha256: sha256('not the accepted bytes') },
    },
  });
  const evidenceDir = path.join(root, 'evidence');
  const run = runJourney(['--scenario', 'X93', '--profile', 'comet-managed-v2', '--evidence-dir', evidenceDir,
    '--case-plan', planPath, '--pilot-contract', contractPath, '--json']);
  assert.equal(run.status, 2);
  const verdict = readVerdict(run, evidenceDir);
  assert.equal(verdict.verdict, 'NOT-EXERCISED');
  assert.match(verdict.reason, /frozen-baseline-drift/);
  assert.equal(verdict.drift[0].artifact, 'product');
  assert.ok(verdict.drift[0].expected && verdict.drift[0].observed && verdict.drift[0].expected !== verdict.drift[0].observed);
});

// --- V_A15 probe: the persistence readback journey ---------------------------

// The V_A15 scenario recipe binds this module (case_module
// test/delivery-cases/3_1.mjs). The probe realizes the frozen THEN locally:
// GIVEN a tool layer reports save success, WHEN the persistence is checked
// independently of the writer, THEN a missing write fails the journey.
function independentReadback(file, expectedBytes) {
  if (!fs.existsSync(file)) {
    return { verdict: 'FAIL', reason: 'not-persisted', observed: null };
  }
  const observed = fs.readFileSync(file, 'utf8');
  return observed === expectedBytes
    ? { verdict: 'PASS', reason: 'persisted-bytes-match', observed: sha256(observed) }
    : { verdict: 'FAIL', reason: 'persisted-bytes-mismatch', observed: sha256(observed) };
}


// --- RW_TARGET_REQUIRED: the P1-04 target denominator (V_RW_TARGET_REQUIRED) --
//
// P1-04 (docs/research/2026-10-22-delivery-implementation-grill.md): the
// acceptance runner could judge a nonexistent target scenario as PASS — a
// registered A01 executing only `assert.equal(1+1,2)` returned
// exitCode=0/verdict=PASS/target.found=false. Every shape below must be a
// structured nonzero refusal: missing target, zero target, wrong mapping,
// composite case missing a required sub-assertion, all-skip, unrelated
// all-green suite. Suite-level green is never scenario-level pass.

function fixtureCaseDefinition(root, name, overrides = {}) {
  const defaults = {
    schemaVersion: 1,
    scenario: 'X90',
    acceptanceIds: ['X90'],
    caseModule: '',
    requiredAssertions: ['V_X90'],
    sourceBinding: [{ path: 'specs/delivery-foundation/spec.md', scenario: 'X90' }],
    actions: [],
    evidence: { artifacts: ['case-definition.json', 'verdict.json'] },
    verdictSemantics: {
      PASS: 'actions executed and expectations met',
      FAIL: 'executed outcome contradicts the expected outcome',
      'NOT-EXERCISED': 'prerequisite missing',
      'NOT-APPLICABLE': 'explicitly out of scope with reason',
    },
  };
  return writeFixture(root, name, JSON.stringify({ ...defaults, ...overrides }));
}

test('RW_TARGET_REQUIRED: P1-04 counterexample — scenario A01 registered to an unrelated all-green arithmetic suite must exit nonzero, never PASS', () => {
  const root = makeTemp(path.join(os.tmpdir(), 'sdd-p31-rw-unrelated-'));
  // The exact grill counterexample body: an unrelated suite that is fully green.
  const modulePath = fixtureModule(root, 'unrelated.test.mjs',
    "test('arithmetic', () => { assert.equal(1 + 1, 2); });");
  const planPath = fixtureCasePlan(root, [{ scenario: 'A01', caseModule: modulePath }]);
  const contractPath = fixturePilotContract(root);
  const evidenceDir = path.join(root, 'evidence');
  const run = runJourney(['--scenario', 'A01', '--profile', 'comet-managed-v2', '--evidence-dir', evidenceDir,
    '--case-plan', planPath, '--pilot-contract', contractPath, '--json']);
  assert.notEqual(run.status, 0,
    `an unrelated green suite must never sign the registered scenario; got exit ${run.status}`);
  const verdict = readVerdict(run, evidenceDir);
  assert.notEqual(verdict.verdict, 'PASS');
  assert.match(verdict.reason, /assertion-mapping-not-verifiable/,
    'the refusal must name the unresolvable assertion mapping, not silently pass');
  const unresolved = (verdict.execution.requiredAssertions ?? []).filter((entry) => entry.status !== 'satisfied');
  assert.ok(unresolved.length > 0 && unresolved.some((entry) => /A01/.test(entry.id)),
    'the registered scenario assertion must be reported as unresolved');
});

test('RW_TARGET_REQUIRED: a declared required assertion with no matching test point (missing target / wrong mapping) is refused nonzero', () => {
  const root = makeTemp(path.join(os.tmpdir(), 'sdd-p31-rw-missing-'));
  const modulePath = fixtureModule(root, 'x90.test.mjs',
    "test('V_OTHER: a different scenario entirely', () => { assert.ok(true); });");
  const definitionPath = fixtureCaseDefinition(root, 'case-definition.json', {
    caseModule: modulePath,
    actions: [{ type: 'spawn', command: `node --test ${modulePath}`, expected: 'module green', expect: { kind: 'exitCode', value: 0 } }],
  });
  const evidenceDir = path.join(root, 'evidence');
  const run = runJourney(['--scenario', 'X90', '--profile', 'comet-managed-v2', '--evidence-dir', evidenceDir,
    '--case-definition', definitionPath, '--pilot-contract', fixturePilotContract(root), '--json']);
  assert.notEqual(run.status, 0, 'a suite green on OTHER assertions must not pass this scenario');
  const verdict = readVerdict(run, evidenceDir);
  assert.notEqual(verdict.verdict, 'PASS');
  assert.match(verdict.reason, /assertion-mapping-not-verifiable/);
});

test('RW_TARGET_REQUIRED: zero-target denominator (empty requiredAssertions) is refused at the schema layer', () => {
  const root = makeTemp(path.join(os.tmpdir(), 'sdd-p31-rw-zero-'));
  const modulePath = fixtureModule(root, 'x91.test.mjs', "test('V_X91: point', () => { assert.ok(true); });");
  const definitionPath = fixtureCaseDefinition(root, 'case-definition.json', {
    scenario: 'X91',
    acceptanceIds: ['X91'],
    requiredAssertions: [],
    caseModule: modulePath,
    actions: [{ type: 'spawn', command: `node --test ${modulePath}`, expected: 'module green', expect: { kind: 'exitCode', value: 0 } }],
  });
  const evidenceDir = path.join(root, 'evidence');
  const run = runJourney(['--scenario', 'X91', '--profile', 'comet-managed-v2', '--evidence-dir', evidenceDir,
    '--case-definition', definitionPath, '--pilot-contract', fixturePilotContract(root), '--json']);
  assert.notEqual(run.status, 0, 'an empty target denominator can never be a valid case');
  const verdict = readVerdict(run, evidenceDir);
  assert.equal(verdict.verdict, 'NOT-EXERCISED');
  const rendered = JSON.stringify(verdict.schemaErrors ?? []);
  assert.match(rendered, /requiredAssertions/, 'the schema must name the empty denominator');
});

test('RW_TARGET_REQUIRED: composite scenario missing any required sub-assertion is refused nonzero', () => {
  const root = makeTemp(path.join(os.tmpdir(), 'sdd-p31-rw-composite-'));
  // Composite fixture: only the persist sub-assertion exists; the readback
  // sub-assertion is absent from the executed module.
  const modulePath = fixtureModule(root, 'x89.test.mjs', [
    "test('V_X89:persist writes durable bytes', () => { assert.ok(true); });",
  ].join('\n'));
  const definitionPath = fixtureCaseDefinition(root, 'case-definition.json', {
    scenario: 'X89',
    acceptanceIds: ['X89'],
    requiredAssertions: ['V_X89:persist', 'V_X89:readback'],
    caseModule: modulePath,
    actions: [{ type: 'spawn', command: `node --test ${modulePath}`, expected: 'both sub-assertions execute green', expect: { kind: 'exitCode', value: 0 } }],
  });
  const evidenceDir = path.join(root, 'evidence');
  const run = runJourney(['--scenario', 'X89', '--profile', 'comet-managed-v2', '--evidence-dir', evidenceDir,
    '--case-definition', definitionPath, '--pilot-contract', fixturePilotContract(root), '--json']);
  assert.notEqual(run.status, 0, 'a composite scenario missing any required sub-assertion must not pass');
  const verdict = readVerdict(run, evidenceDir);
  assert.notEqual(verdict.verdict, 'PASS');
  assert.match(verdict.reason, /assertion-mapping-not-verifiable/);
  const unresolved = (verdict.execution.requiredAssertions ?? []).filter((entry) => entry.status !== 'satisfied');
  assert.ok(unresolved.some((entry) => entry.id.includes('readback')),
    'the missing sub-assertion id must be named individually');
});

test('RW_TARGET_REQUIRED: all-skip module stays nonzero; a complete verifiable mapping passes', () => {
  // All-skip entire module: zero effective execution.
  const rootSkip = makeTemp(path.join(os.tmpdir(), 'sdd-p31-rw-allskip-'));
  const skipModule = fixtureModule(rootSkip, 'x88.test.mjs', [
    "test('V_X88: point', { skip: 'environment not provisioned' }, () => {});",
  ].join('\n'));
  const skipPlan = fixtureCasePlan(rootSkip, [{ scenario: 'X88', caseModule: skipModule }]);
  const skipRun = runJourney(['--scenario', 'X88', '--profile', 'comet-managed-v2',
    '--evidence-dir', path.join(rootSkip, 'evidence'), '--case-plan', skipPlan,
    '--pilot-contract', fixturePilotContract(rootSkip), '--json']);
  assert.equal(skipRun.status, 2, 'all-skip must exit 2');
  const skipVerdict = readVerdict(skipRun, path.join(rootSkip, 'evidence'));
  assert.match(skipVerdict.reason, /no-effective-execution|target-scenario-skipped/);

  // Positive control: the same scenario with a genuinely matching, ok test
  // point passes — the strengthened denominator still admits real evidence.
  const rootOk = makeTemp(path.join(os.tmpdir(), 'sdd-p31-rw-ok-'));
  const okModule = fixtureModule(rootOk, 'x88b.test.mjs',
    "test('V_X88: real point', () => { assert.ok(true); });");
  const okPlan = fixtureCasePlan(rootOk, [{ scenario: 'X88', caseModule: okModule }]);
  const okRun = runJourney(['--scenario', 'X88', '--profile', 'comet-managed-v2',
    '--evidence-dir', path.join(rootOk, 'evidence'), '--case-plan', okPlan,
    '--pilot-contract', fixturePilotContract(rootOk), '--json']);
  assert.equal(okRun.status, 0, `a verifiable mapping must still pass: ${okRun.stderr}`);
  const okVerdict = readVerdict(okRun, path.join(rootOk, 'evidence'));
  assert.equal(okVerdict.verdict, 'PASS');
  assert.ok((okVerdict.execution.requiredAssertions ?? []).every((entry) => entry.status === 'satisfied'));
});

// --- RW_OBSERVATION_REQUIRED: typed final-state readback (V_RW_OBSERVATION_REQUIRED)

test('RW_OBSERVATION_REQUIRED: a required inspect whose live probe contradicts the typed expectation fails the journey — inspections are not free', () => {
  const root = makeTemp(path.join(os.tmpdir(), 'sdd-p31-rw-inspect-'));
  const modulePath = fixtureModule(root, 'x87.test.mjs', "test('V_X87: point', () => { assert.ok(true); });");
  const definitionPath = fixtureCaseDefinition(root, 'case-definition.json', {
    scenario: 'X87',
    acceptanceIds: ['X87'],
    requiredAssertions: ['V_X87'],
    caseModule: modulePath,
    actions: [
      { type: 'spawn', command: `node --test ${modulePath}`, expected: 'module green', expect: { kind: 'exitCode', value: 0 } },
      {
        type: 'inspect',
        command: 'node --version',
        expected: 'observed toolchain version equals the frozen expectation',
        expect: { kind: 'equals', value: 'v0.0.0-fake-stale-readback' },
      },
    ],
  });
  const evidenceDir = path.join(root, 'evidence');
  const run = runJourney(['--scenario', 'X87', '--profile', 'comet-managed-v2', '--evidence-dir', evidenceDir,
    '--case-definition', definitionPath, '--pilot-contract', fixturePilotContract(root), '--json']);
  assert.notEqual(run.status, 0, 'a live observation contradicting the frozen expectation must fail');
  const verdict = readVerdict(run, evidenceDir);
  assert.equal(verdict.verdict, 'FAIL');
  assert.match(verdict.reason, /inspect/);
  const inspectAction = verdict.execution.actions.find((action) => action.type === 'inspect');
  assert.equal(inspectAction.ok, false);
  assert.notEqual(inspectAction.observed, 'v0.0.0-fake-stale-readback',
    'the observed side must be the real live probe output, not the expected echo');
});

test('RW_OBSERVATION_REQUIRED: a required inspect whose probe command itself fails (commandSucceeds) fails the journey', () => {
  const root = makeTemp(path.join(os.tmpdir(), 'sdd-p31-rw-inspectfail-'));
  const modulePath = fixtureModule(root, 'x86.test.mjs', "test('V_X86: point', () => { assert.ok(true); });");
  const definitionPath = fixtureCaseDefinition(root, 'case-definition.json', {
    scenario: 'X86',
    acceptanceIds: ['X86'],
    requiredAssertions: ['V_X86'],
    caseModule: modulePath,
    actions: [
      { type: 'spawn', command: `node --test ${modulePath}`, expected: 'module green', expect: { kind: 'exitCode', value: 0 } },
      {
        type: 'inspect',
        command: 'node -e process.exit(3)',
        expected: 'the required environment probe succeeds',
        expect: { kind: 'commandSucceeds' },
      },
    ],
  });
  const evidenceDir = path.join(root, 'evidence');
  const run = runJourney(['--scenario', 'X86', '--profile', 'comet-managed-v2', '--evidence-dir', evidenceDir,
    '--case-definition', definitionPath, '--pilot-contract', fixturePilotContract(root), '--json']);
  assert.notEqual(run.status, 0, 'a failing required probe must fail the journey');
  const verdict = readVerdict(run, evidenceDir);
  assert.equal(verdict.verdict, 'FAIL');
});

test('RW_OBSERVATION_REQUIRED: a non-empty state file whose bytes contradict the typed readback cannot sign PASS (fake/stale readback refused)', () => {
  const root = makeTemp(path.join(os.tmpdir(), 'sdd-p31-rw-stale-'));
  const modulePath = fixtureModule(root, 'x85.test.mjs', "test('V_X85: point', () => { assert.ok(true); });");
  // Stale domain bytes are independently read; this invocation gets fresh evidence.
  const evidenceDir = path.join(root, 'evidence');
  const staleFile = path.join(root, 'journey-state.txt');
  fs.writeFileSync(staleFile, 'stale-bytes-from-an-older-run');
  const definitionPath = fixtureCaseDefinition(root, 'case-definition.json', {
    scenario: 'X85',
    acceptanceIds: ['X85'],
    requiredAssertions: ['V_X85'],
    caseModule: modulePath,
    actions: [
      { type: 'spawn', command: `node --test ${modulePath}`, expected: 'module green', expect: { kind: 'exitCode', value: 0 } },
      {
        type: 'readState',
        path: staleFile,
        expected: 'independently read persisted terminal state equals the frozen bytes',
        expect: { kind: 'equals', value: 'journey-state-v1' },
      },
    ],
  });
  const run = runJourney(['--scenario', 'X85', '--profile', 'comet-managed-v2', '--evidence-dir', evidenceDir,
    '--case-definition', definitionPath, '--pilot-contract', fixturePilotContract(root), '--json']);
  assert.notEqual(run.status, 0, 'file existence alone must not satisfy a typed readback');
  const verdict = readVerdict(run, evidenceDir);
  assert.equal(verdict.verdict, 'FAIL');
  assert.match(verdict.reason, /readState/);
});

test('RW_OBSERVATION_REQUIRED: observed-version assertions anchor to an independent live probe (nb-3: registered value never self-attests)', () => {
  const root = makeTemp(path.join(os.tmpdir(), 'sdd-p31-rw-live-'));
  const modulePath = fixtureModule(root, 'x84.test.mjs', "test('V_X84: point', () => { assert.ok(true); });");
  // The expectation value is derived by an INDEPENDENT probe in this test —
  // not copied from any baseline file. The runner must itself run the live
  // probe and record its own observation for the journey to pass.
  const independent = spawnSync('node', ['--version'], { encoding: 'utf8' });
  assert.equal(independent.status, 0);
  const expectedVersion = independent.stdout.trim();
  const definitionPath = fixtureCaseDefinition(root, 'case-definition.json', {
    scenario: 'X84',
    acceptanceIds: ['X84'],
    requiredAssertions: ['V_X84'],
    caseModule: modulePath,
    actions: [
      { type: 'spawn', command: `node --test ${modulePath}`, expected: 'module green', expect: { kind: 'exitCode', value: 0 } },
      {
        type: 'inspect',
        command: 'node --version',
        expected: 'live toolchain version equals the independently probed value',
        expect: { kind: 'equals', value: expectedVersion },
      },
    ],
  });
  const evidenceDir = path.join(root, 'evidence');
  const run = runJourney(['--scenario', 'X84', '--profile', 'comet-managed-v2', '--evidence-dir', evidenceDir,
    '--case-definition', definitionPath, '--pilot-contract', fixturePilotContract(root), '--json']);
  assert.equal(run.status, 0, `a true live observation must pass: ${run.stderr}`);
  const verdict = readVerdict(run, evidenceDir);
  assert.equal(verdict.verdict, 'PASS');
  const inspectAction = verdict.execution.actions.find((action) => action.type === 'inspect');
  assert.equal(inspectAction.observed, expectedVersion,
    'the verdict observation must come from the runner actually running the probe');
  assert.equal(inspectAction.ok, true);
});

test('RW_OBSERVATION_REQUIRED: wrong candidate is refused — a typed equals expectation on the live git HEAD mismatch fails nonzero', () => {
  const root = makeTemp(path.join(os.tmpdir(), 'sdd-p31-rw-candidate-'));
  const modulePath = fixtureModule(root, 'x83.test.mjs', "test('V_X83: point', () => { assert.ok(true); });");
  const definitionPath = fixtureCaseDefinition(root, 'case-definition.json', {
    scenario: 'X83',
    acceptanceIds: ['X83'],
    requiredAssertions: ['V_X83'],
    caseModule: modulePath,
    actions: [
      { type: 'spawn', command: `node --test ${modulePath}`, expected: 'module green', expect: { kind: 'exitCode', value: 0 } },
      {
        type: 'inspect',
        command: 'git rev-parse HEAD',
        expected: 'the observed candidate matches the frozen candidate binding',
        expect: { kind: 'equals', value: '0000000000000000000000000000000000000000' },
      },
    ],
  });
  const evidenceDir = path.join(root, 'evidence');
  const run = runJourney(['--scenario', 'X83', '--profile', 'comet-managed-v2', '--evidence-dir', evidenceDir,
    '--case-definition', definitionPath, '--pilot-contract', fixturePilotContract(root), '--json']);
  const headRun = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot, encoding: 'utf8' });
  if (headRun.status === 0) {
    assert.notEqual(run.status, 0, 'an executed journey against the wrong candidate must refuse');
    const verdict = readVerdict(run, evidenceDir);
    assert.equal(verdict.verdict, 'FAIL');
  } else {
    // No git repository: the probe itself fails, which is also a required
    // inspect failure — still nonzero, never a pass.
    assert.notEqual(run.status, 0);
  }
});

// --- --journey observation interface (execution-contract.observer_contract) ----

function fixtureJourneyPlan(root, journey) {
  const cases = {
    [journey.scenario]: {
      source_binding: [{ path: 'specs/delivery-foundation/spec.md', scenario: journey.scenario }],
      intended_command: `node tools/verify/delivery-journey.mjs --journey ${journey.name} --profile comet-managed-v2 --evidence-dir <dir> --json`,
      case_module: journey.caseModule,
      steps: ['fixture step'],
      oracle: 'fixture oracle',
      status: 'FIXTURE',
    },
  };
  return writeFixture(root, 'journey-plan.json', JSON.stringify({
    schema_version: 1,
    status: 'FIXTURE',
    cases,
    journey_definitions: {
      [journey.name]: {
        owner: journey.owner,
        path: journey.recipePath,
        status: journey.status ?? 'IMPLEMENTED_FIXTURE',
        required_check: journey.requiredCheck,
      },
    },
  }, null, 2));
}

test('--journey interface: an unknown journey name is a structured nonzero refusal, and the registered real journeys without implemented recipes exit nonzero UNVERIFIED with their owner recorded', () => {
  const root = makeTemp(path.join(os.tmpdir(), 'sdd-p31-rw-journey-'));
  // Unknown name: never a default-success path.
  const unknownRun = runJourney(['--journey', 'no-such-journey', '--profile', 'comet-managed-v2',
    '--evidence-dir', path.join(root, 'e-unknown'), '--json']);
  assert.notEqual(unknownRun.status, 0, 'unknown journey must be refused');
  const unknownVerdict = JSON.parse(unknownRun.stdout);
  assert.notEqual(unknownVerdict.verdict, 'PASS');
  assert.match(unknownVerdict.reason, /journey-not-registered/);

  // Isolate missing-recipe behavior from existing historical recipe files.
  // The fixtures preserve the registered owners and exercise actual absence.
  for (const [name, owner] of [
    ['same-run-delivery', 'P3_2'],
    ['real-comet-recovery', 'P3_3'],
    ['post-delivery-permissions', 'P4_8'],
  ]) {
    const planPath = fixtureJourneyPlan(root, { name, owner, scenario: 'A01', caseModule: 'test/delivery-cases/2_1.mjs', recipePath: path.join(root, `${name}-absent.case.json`), requiredCheck: `V_${name.toUpperCase().replaceAll('-', '_')}` });
    const run = runJourney(['--journey', name, '--profile', 'comet-managed-v2',
      '--evidence-dir', path.join(root, `e-${name}`), '--case-plan', planPath, '--json']);
    assert.equal(run.status, 2, `${name} without an implemented recipe must exit 2`);
    const verdict = JSON.parse(run.stdout);
    assert.equal(verdict.verdict, 'NOT-EXERCISED');
    assert.match(verdict.reason, /journey-recipe-not-implemented/);
    assert.match(verdict.reason, /UNVERIFIED/, 'missing resources are explicitly UNVERIFIED');
    assert.equal(verdict.journey.owner, owner, 'the holder of the missing recipe must be recorded');
  }
});

test('--journey interface: a fixture journey executes the bound scenario set → required check → assertion ids with the full target denominator', () => {
  const root = makeTemp(path.join(os.tmpdir(), 'sdd-p31-rw-jfix-'));
  const modulePath = fixtureModule(root, 'j01.test.mjs', [
    "test('V_J01:observe real transition', () => { assert.ok(true); });",
    "test('V_J01:readback terminal state', () => { assert.ok(true); });",
  ].join('\n'));
  const verdictSemantics = {
    PASS: 'actions executed and expectations met',
    FAIL: 'executed outcome contradicts the expected outcome',
    'NOT-EXERCISED': 'prerequisite missing',
    'NOT-APPLICABLE': 'explicitly out of scope with reason',
  };
  const recipePath = writeFixture(root, 'journey-recipe.json', JSON.stringify({
    schemaVersion: 1,
    scenario: 'J01',
    acceptanceIds: ['J01'],
    requiredAssertions: ['V_J01:observe', 'V_J01:readback'],
    caseModule: modulePath,
    sourceBinding: [{ path: 'specs/delivery-foundation/spec.md', scenario: 'J01' }],
    actions: [{ type: 'spawn', command: `node --test ${modulePath}`, expected: 'journey slice green', expect: { kind: 'exitCode', value: 0 } }],
    evidence: { artifacts: ['case-definition.json', 'action-1-stdout.txt', 'verdict.json'] },
    verdictSemantics,
  }));
  const planPath = fixtureJourneyPlan(root, {
    name: 'fixture-journey',
    scenario: 'J01',
    caseModule: modulePath,
    owner: 'FIXTURE',
    recipePath,
    requiredCheck: 'V_FIXTURE_JOURNEY',
  });
  const evidenceDir = path.join(root, 'evidence');
  const run = runJourney(['--journey', 'fixture-journey', '--profile', 'comet-managed-v2',
    '--evidence-dir', evidenceDir, '--case-plan', planPath,
    '--pilot-contract', fixturePilotContract(root), '--json']);
  assert.equal(run.status, 0, `fixture journey with complete mapping must pass: ${run.stderr}`);
  const verdict = readVerdict(run, evidenceDir);
  assert.equal(verdict.verdict, 'PASS');
  assert.equal(verdict.journey.name, 'fixture-journey');
  assert.equal(verdict.journey.requiredCheck, 'V_FIXTURE_JOURNEY');
  assert.ok((verdict.execution.requiredAssertions ?? []).length === 2
    && verdict.execution.requiredAssertions.every((entry) => entry.status === 'satisfied'));

  // Negative: the same journey whose executed module realizes only one of the
  // two required sub-assertions is refused — the denominator binds the recipe,
  // not the module's own green.
  const partialModule = fixtureModule(root, 'j01-partial.test.mjs', [
    "test('V_J01:observe real transition', () => { assert.ok(true); });",
  ].join('\n'));
  const partialRecipe = writeFixture(root, 'journey-recipe-partial.json', JSON.stringify({
    schemaVersion: 1,
    scenario: 'J01',
    acceptanceIds: ['J01'],
    requiredAssertions: ['V_J01:observe', 'V_J01:readback'],
    caseModule: partialModule,
    sourceBinding: [{ path: 'specs/delivery-foundation/spec.md', scenario: 'J01' }],
    actions: [{ type: 'spawn', command: `node --test ${partialModule}`, expected: 'journey slice green', expect: { kind: 'exitCode', value: 0 } }],
    evidence: { artifacts: ['case-definition.json', 'action-1-stdout.txt', 'verdict.json'] },
    verdictSemantics,
  }));
  const planPartialPath = fixtureJourneyPlan(root, {
    name: 'partial-journey',
    scenario: 'J01',
    caseModule: partialModule,
    owner: 'FIXTURE',
    recipePath: partialRecipe,
    requiredCheck: 'V_PARTIAL_JOURNEY',
  });
  const partialRun = runJourney(['--journey', 'partial-journey', '--profile', 'comet-managed-v2',
    '--evidence-dir', path.join(root, 'evidence-partial'), '--case-plan', planPartialPath,
    '--pilot-contract', fixturePilotContract(root), '--json']);
  assert.notEqual(partialRun.status, 0, 'a journey recipe whose module misses a required sub-assertion must refuse');
  const partialVerdict = JSON.parse(partialRun.stdout);
  assert.match(partialVerdict.reason, /assertion-mapping-not-verifiable/);
  assert.ok((partialVerdict.execution.requiredAssertions ?? []).some((entry) => entry.id === 'V_J01:readback' && entry.status === 'missing'));
});

test('V_A15: an independent persistence readback fails the journey when a success claim never reached disk', () => {
  const root = makeTemp(path.join(os.tmpdir(), 'sdd-p31-a15-'));
  const stateFile = path.join(root, 'journey-state.txt');
  const writer = writeFixture(root, 'claimant.cjs', [
    'const fs = require("node:fs");',
    'const [, , mode, file] = process.argv;',
    'if (mode === "persist") fs.writeFileSync(file, "journey-state-v1");',
    'console.log(JSON.stringify({ success: true, bytes: 17 }));',
    '',
  ].join('\n'));

  const claim = (mode) => JSON.parse(spawnSync('node', [writer, mode, stateFile], {
    cwd: root, encoding: 'utf8', timeout: 30_000,
  }).stdout);

  // Persisting claimant + independent readback: the journey holds.
  assert.equal(claim('persist').success, true, 'fixture precondition: writer reports success');
  const persisted = independentReadback(stateFile, 'journey-state-v1');
  assert.equal(persisted.verdict, 'PASS');

  // Claim-only claimant: the UI-style success report lies; the independent
  // readback of the (missing) persisted state must fail the journey.
  fs.rmSync(stateFile, { force: true });
  assert.equal(claim('claim-only').success, true, 'fixture precondition: claimant still reports success');
  const notPersisted = independentReadback(stateFile, 'journey-state-v1');
  assert.equal(notPersisted.verdict, 'FAIL', 'not persisted means the journey fails, regardless of the success claim');
  assert.equal(notPersisted.reason, 'not-persisted');
});

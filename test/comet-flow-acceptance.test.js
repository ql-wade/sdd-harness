import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { taskDefinitionDigest } from '../lib/delivery/baseline.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(repo, 'tools/verify/delivery-journey.mjs');
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-p31-current-'));
  const write = (name, value) => {
    const file = path.join(root, name);
    fs.writeFileSync(file, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
    return file;
  };
  const artifacts = {};
  for (const kind of ['product', 'design', 'testContract', 'planBundle']) {
    const content = kind === 'planBundle' ? '- [ ] a frozen task\n' : `frozen ${kind}\n`;
    artifacts[kind] = { path: write(`${kind}.md`, content), sha256: kind === 'planBundle' ? taskDefinitionDigest(content) : hash(content) };
  }
  const pilot = {
    schemaVersion: 1, profile: 'comet-managed-v2',
    pilot: { repository: 'fixture', ownerRegistry: 'fixture owner', environment: 'isolated fixture', identity: 'component-only' },
    frozenArtifacts: artifacts,
    negativeAc: { ui: ['reject false success'], api: ['reject unregistered caller'], persistence: ['read durable data'], permissions: ['reject control writes'] },
  };
  const module = write('case.test.mjs', "import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('V_A01: component fixture', () => assert.equal(2 + 3, 5));\n");
  const definition = {
    schemaVersion: 1, scenario: 'A01', acceptanceIds: ['A01'], requiredAssertions: ['V_A01'], caseModule: module,
    actions: [{ type: 'spawn', command: `${process.execPath} --test --test-reporter=tap ${module}`, expected: 'component test executes', expect: { kind: 'exitCode', value: 0 } }],
    evidence: { artifacts: ['case-definition.json', 'action-1-stdout.txt', 'verdict.json'] },
    verdictSemantics: { PASS: 'component expectations met', FAIL: 'expectation contradicted', 'NOT-EXERCISED': 'not observed', 'NOT-APPLICABLE': 'outside scope' },
  };
  const execute = (changes = {}, { profile = 'comet-managed-v2', pilotChanges = {}, casePlan = null, sourceFixture = null, prepareEvidence = null, useRegisteredDefinition = false, cwd = repo } = {}) => {
    const pilotFile = write('pilot.md', `\`\`\`pilot-contract\n${JSON.stringify({ ...pilot, ...pilotChanges })}\n\`\`\`\n`);
    const definitionFile = write('definition.json', { ...definition, ...changes });
    const evidence = path.join(root, `evidence-${crypto.randomUUID()}`);
    if (prepareEvidence) prepareEvidence(evidence);
    const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
    const args = [cli, '--scenario', 'A01', '--profile', profile, '--pilot-contract', pilotFile, '--case-definition', definitionFile, '--evidence-dir', evidence, '--json'];
    if (casePlan) args.push('--case-plan', write('case-plan.json', casePlan));
    if (useRegisteredDefinition) args.splice(args.indexOf('--case-definition'), 2);
    if (sourceFixture) {
      const wrapper = write('source-wrapper.mjs', `import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { runDeliveryJourney } from ${JSON.stringify(cli)};
const source = ${JSON.stringify(sourceFixture)};
process.exitCode = await runDeliveryJourney({ args: process.argv.slice(2), observeProtectedSource: async ({ evidenceDir, stage }) => {
  if (source.fakeOnly) return { ok: true, role: 'verifier' };
  if (stage === 'preflight') return source.preflightDenied ? null : { workspace: source.workspace, authorityRegistration: source.authorityRegistration, policy: source.policy, evidenceRefs: source.entryEvidence };
  const envelope = { schemaVersion: 1, candidateDigest: source.wrongCandidate ? 'f'.repeat(64) : source.binding.inputDigest, caseId: 'A01', check: 'V_A01', origin: { kind: 'fixture', id: source.binding.runnerId }, execution: { id: source.binding.execution }, environment: 'component fixture', toolchain: process.version, executions: { total: 1, valid: 1 }, result: 'pass', evidence: fs.readdirSync(evidenceDir).filter((name) => !source.partialRaw || !name.endsWith('-readback.txt')).map((name) => { const file = path.join(evidenceDir, name); return { uri: file, sha256: source.staleRaw ? '0'.repeat(64) : crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') }; }), expiry: new Date(Date.now() + 60000).toISOString() };
  return { binding: source.binding, workspace: source.workspace, admission: { ok: true, entry: { class: source.wrongRole ? 'authoring-self-check' : 'independent-acceptance', envelope, dispatch: source.binding } } };
} });
`);
      args[0] = wrapper;
    }
    const result = spawnSync(process.execPath, args, { cwd, env, encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
    assert.equal(result.error, undefined, result.error?.message);
    return { ...result, verdict: result.stdout.trim() ? JSON.parse(result.stdout) : null, evidence };
  };
  try { return run({ root, write, pilot, module, definition, execute }); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test('P31 unsupported expectation cannot pass a required readState action', () => fixture(({ write, definition, execute }) => {
  const file = write('state.txt', 'existing but unchecked state');
  const result = execute({ actions: [...definition.actions, { type: 'readState', path: file, expected: 'unsupported expectation must be rejected', expect: { kind: 'exitCode', value: 0 } }] });
  assert.equal(result.status, 2, 'a nonempty file must not satisfy an exitCode expectation');
  assert.notEqual(result.verdict.verdict, 'PASS');
}));

test('P31 explicit definition cannot replace its scenario target with an unrelated passing assertion', () => fixture(({ write, execute }) => {
  const module = write('other.test.mjs', "import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('V_OTHER: unrelated arithmetic', () => assert.equal(3 * 3, 9));\n");
  const result = execute({ caseModule: module, requiredAssertions: ['V_OTHER'], actions: [{ type: 'spawn', command: `${process.execPath} --test --test-reporter=tap ${module}`, expected: 'unrelated suite is green', expect: { kind: 'exitCode', value: 0 } }] });
  assert.equal(result.status, 2, 'explicit definition must retain the requested scenario target');
  assert.notEqual(result.verdict.verdict, 'PASS');
}));

test('P31 TODO target is unexecuted even when node exits zero', () => fixture(({ write, execute }) => {
  const module = write('todo.test.mjs', "import test from 'node:test';\ntest('V_A01: pending work', { todo: 'not implemented' }, () => {});\n");
  const result = execute({ caseModule: module, actions: [{ type: 'spawn', command: `${process.execPath} --test --test-reporter=tap ${module}`, expected: 'TODO cannot satisfy execution', expect: { kind: 'exitCode', value: 0 } }] });
  assert.equal(result.status, 2, 'a TODO target cannot satisfy the mandatory denominator');
  assert.notEqual(result.verdict.verdict, 'PASS');
}));

test('P31 retired profile cannot be re-enabled by a caller-supplied pilot contract', () => fixture(({ execute }) => {
  const result = execute({}, { profile: 'managed-pilot', pilotChanges: { profile: 'managed-pilot' } });
  assert.equal(result.status, 2, 'retired profile must stay rejected even when caller metadata matches');
  assert.notEqual(result.verdict.verdict, 'PASS');
}));


test('P31 explicit definition cannot delete a frozen composite sub-assertion', () => fixture(({ write, execute }) => {
  const module = write('partial.test.mjs', "import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('V_A01:persist', () => assert.equal(5 - 2, 3));\n");
  const result = execute({ caseModule: module, requiredAssertions: ['V_A01:persist'], actions: [{ type: 'spawn', command: `${process.execPath} --test --test-reporter=tap ${module}`, expected: 'only persist executed', expect: { kind: 'exitCode', value: 0 } }] }, {
    casePlan: { cases: { A01: { case_module: module, required_assertions: ['V_A01:persist', 'V_A01:readback'] } } },
  });
  assert.equal(result.status, 2, 'a definition cannot weaken the independent registry denominator');
  assert.notEqual(result.verdict.verdict, 'PASS');
}));

test('P31 typed JSON readback compares actual fields and rejects wrong run or primitive output', () => fixture(({ write, definition, execute }) => {
  const file = write('runtime-observation.json', { run: 'run-current', attempt: 2, epoch: 3, revision: 'r4', candidate: 'candidate-current', extra: 'irrelevant metadata' });
  const readback = { id: 'runtime-readback', type: 'readState', path: file, expected: 'actual runtime identity fields match the frozen values', expect: { kind: 'jsonFields', value: { run: 'run-current', attempt: 2, epoch: 3, revision: 'r4', candidate: 'candidate-current' } } };
  const matched = execute({ actions: [...definition.actions, readback] });
  assert.equal(matched.status, 0, 'matching typed JSON fields should satisfy the component readback');
  for (const wrong of [{ ...readback, expect: { kind: 'jsonFields', value: { run: 'another-run' } } }, { ...readback, expect: { kind: 'jsonFields', value: {} } }]) {
    const refused = execute({ actions: [...definition.actions, wrong] });
    assert.equal(refused.status, 2);
    assert.notEqual(refused.verdict.verdict, 'PASS');
  }
  write('runtime-observation.json', '"not an object"');
  assert.equal(execute({ actions: [...definition.actions, readback] }).status, 2);
}));

test('P31 node test actions execute with explicit TAP reporter on the current host', () => fixture(({ module, execute }) => {
  const result = execute({ actions: [{ type: 'spawn', command: `${process.execPath} --test ${module}`, expected: 'the observer requests a stable TAP protocol', expect: { kind: 'exitCode', value: 0 } }] });
  assert.equal(result.status, 0, 'the host default reporter cannot erase executed target evidence');
  assert.ok(result.verdict.execution.actions[0].argv.includes('--test-reporter=tap'), 'actual argv must explicitly select TAP');
}));

test('P31 formal managed scenario refuses component tests without a protected runtime source', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-p31-formal-'));
  try {
    const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, [cli, '--scenario', 'A01', '--profile', 'comet-managed-v2', '--evidence-dir', root, '--json'], { cwd: repo, env, encoding: 'utf8', timeout: 30000 });
    assert.equal(result.error, undefined);
    const verdict = JSON.parse(result.stdout);
    assert.equal(result.status, 2, 'formal required scenario cannot turn component green into runtime acceptance');
    assert.match(verdict.reason, /protected-source|proof-registration/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});


function runtimeFixture(write, root) {
  const binding = {
    schemaVersion: 1, profile: 'comet-managed-v2', runnerId: 'comet-classic', run: 'run-current',
    action: 'verify', gate: 'V', execution: 'execution-current', role: 'verifier', revision: 'r4', attempt: 2, epoch: 3,
    inputDigest: 'a'.repeat(64), policyDigest: 'b'.repeat(64), environmentDigest: 'c'.repeat(64),
    methods: [{ name: 'whitebox-verify', version: '1.0.0', ref: '.agents/skills/whitebox-verify/SKILL.md', digest: 'd'.repeat(64) }],
    workPackage: { id: 'fixture.verify', taskIds: ['fixture'] }, allowedPaths: ['evidence'], allowedTools: ['node.test'],
    inputs: [{ name: 'candidate', ref: 'candidate.json', digest: 'a'.repeat(64) }], outputs: [{ name: 'report', ref: 'evidence/report.json' }],
  };
  const change = path.join(root, 'authority/docs/openspec/changes/fixture');
  fs.mkdirSync(path.join(change, '.comet'), { recursive: true });
  const workspace = { projectRoot: path.join(root, 'authority'), runStateFile: path.join(change, '.comet/run-state.json') };
  fs.writeFileSync(workspace.runStateFile, JSON.stringify({ runId: binding.run }));
  const dispatchFile = path.join(change, '.comet/gate-dispatches.json');
  const dispatch = { gate: binding.gate, role: binding.role, execution: binding.execution, attempt: binding.attempt, epoch: binding.epoch, inputDigest: binding.inputDigest, generation: 4, state: 'consumed', verdict: 'pass' };
  fs.writeFileSync(dispatchFile, JSON.stringify({ schema: 'comet.classic.gate-dispatches.v1', dispatches: [dispatch] }));
  const reference = (file) => ({ ref: file, digest: hash(fs.readFileSync(file)) });
  const authorityFile = write('entry-authority.json', { schemaVersion: 1, interface: 'Authority.v1', project: 'fixture', authority: { id: 'fixture-authority', workspaceId: 'fixture-workspace', controllerPrincipal: 'fixture-controller', status: 'VERIFIED' }, registrations: [{ registrationId: 'fixture-registration', authorityId: 'fixture-authority', workspaceId: 'fixture-workspace', instanceId: 'fixture-instance', stateOrigin: 'authoritative', writerExclusivity: 'single' }] });
  const policy = reference(write('entry-policy.json', { profile: 'comet-managed-v2', purpose: 'component-only entry evidence' }));
  const entryEvidence = ['capability', 'permission'].map((kind) => ({ kind, ...reference(write(`entry-${kind}.json`, { scope: 'component fixture only', kind })) }));
  return { binding, workspace, dispatch, dispatchFile, authorityRegistration: reference(authorityFile), policy, entryEvidence };
}

test('P31 runtime observation correlates original Run/dispatch/current raw evidence; fixture cannot become managed acceptance', () => fixture(({ root, write, execute }) => {
  const source = runtimeFixture(write, root);
  const definition = { runtimeBinding: source.binding };
  const matched = execute(definition, { sourceFixture: source });
  assert.equal(matched.status, 0, 'the component interface should consume matching native-shaped observations');
  assert.equal(matched.verdict.scope, 'component/observer-qualification');
  assert.equal(matched.verdict.managedClosureEligible, false, 'test fixture is never an authenticated managed source');
  for (const changes of [{ fakeOnly: true }, { wrongRole: true }, { wrongCandidate: true }, { staleRaw: true }, { binding: { ...source.binding, revision: 'old-revision' } }]) {
    const refused = execute(definition, { sourceFixture: { ...source, ...changes } });
    assert.equal(refused.status, 2, JSON.stringify(changes));
  }
  fs.writeFileSync(source.workspace.runStateFile, JSON.stringify({ runId: 'wrong-run' }));
  assert.equal(execute(definition, { sourceFixture: source }).status, 2);
  fs.writeFileSync(source.workspace.runStateFile, JSON.stringify({ runId: source.binding.run }));
  fs.writeFileSync(source.dispatchFile, JSON.stringify({ schema: 'comet.classic.gate-dispatches.v1', dispatches: [{ ...source.dispatch, attempt: 1 }] }));
  assert.equal(execute(definition, { sourceFixture: source }).status, 2);
}));

test('P31 frozen typed readback cannot be replaced by file existence, omitted, duplicated or changed oracle', () => fixture(({ write, module, definition, execute }) => {
  const file = write('readback.json', { run: 'current', version: 4 });
  const plan = { cases: { A01: { case_module: module, required_assertions: ['V_A01'], required_proof_level: 'component', required_readbacks: [{ id: 'terminal', type: 'readState', expect: 'jsonFields', fields: ['run', 'version'], value: { version: 4 } }] } } };
  const readback = { id: 'terminal', type: 'readState', path: file, expected: 'registered terminal version', expect: { kind: 'jsonFields', value: { run: 'current', version: 4 } } };
  const weak = execute({ actions: [...definition.actions, { ...readback, expect: { kind: 'nonEmptyFile' } }] }, { casePlan: plan });
  assert.equal(weak.status, 2, 'file existence cannot replace the frozen typed terminal oracle');
  assert.equal(execute({ actions: [...definition.actions, readback] }, { casePlan: plan }).status, 0);
  assert.equal(execute({}, { casePlan: plan }).status, 2, 'missing terminal readback must refuse');
  assert.equal(execute({ actions: [...definition.actions, readback, readback] }, { casePlan: plan }).status, 2, 'duplicate readback identity must refuse');
  write('readback.json', { run: 'current', version: 3 });
  assert.equal(execute({ actions: [...definition.actions, { ...readback, expect: { kind: 'jsonFields', value: { run: 'current', version: 3 } } }] }, { casePlan: plan }).status, 2, 'a caller cannot change the frozen terminal version to fit stale data');
}));

test('P31 component overrides cannot satisfy a registry requirement for platform proof', () => fixture(({ module, execute }) => {
  const result = execute({}, { casePlan: { cases: { A01: { case_module: module, required_assertions: ['V_A01'], required_proof_level: 'platform' } } } });
  assert.equal(result.status, 2, 'component execution must not close a required platform layer');
  assert.equal(result.verdict.managedClosureEligible, false);
}));


test('P31 malformed frozen readback is a structured refusal, never an uncaught observer crash', () => fixture(({ module, execute }) => {
  const result = execute({}, { casePlan: { cases: { A01: { case_module: module, required_assertions: ['V_A01'], required_proof_level: 'component', required_readbacks: [null] } } } });
  assert.equal(result.status, 2, 'malformed registry must fail as verification-unavailable');
  assert.equal(result.verdict.verdict, 'NOT-EXERCISED');
  assert.match(result.verdict.reason, /readback-registration-invalid/);
}));


test('P31 evidence output cannot follow existing symlinks or overwrite a previous trial', () => fixture(({ root, write, execute }) => {
  const protectedFile = write('must-remain.txt', 'original bytes');
  const linked = execute({}, { prepareEvidence(evidence) { fs.mkdirSync(evidence); fs.symlinkSync(protectedFile, path.join(evidence, 'action-1-stdout.txt')); } });
  assert.equal(fs.readFileSync(protectedFile, 'utf8'), 'original bytes', 'raw evidence must never overwrite a linked target');
  assert.equal(linked.status, 1);
  let priorPath;
  const previous = execute({}, { prepareEvidence(evidence) { fs.mkdirSync(evidence); priorPath = path.join(evidence, 'verdict.json'); fs.writeFileSync(priorPath, 'prior trial bytes'); } });
  assert.equal(previous.status, 1);
  assert.equal(fs.readFileSync(priorPath, 'utf8'), 'prior trial bytes');
  const target = path.join(root, 'empty-target'); fs.mkdirSync(target);
  assert.equal(execute({}, { prepareEvidence(evidence) { fs.symlinkSync(target, evidence); } }).status, 1);
  assert.deepEqual(fs.readdirSync(target), []);
}));

test('P31 truncated test protocol cannot pass from a surviving ok line without its summary', () => fixture(({ write, module, execute }) => {
  const wrapper = write('truncated.cjs', `const {spawnSync}=require('node:child_process');\nconst r=spawnSync(process.execPath,['--test','--test-reporter=tap',process.argv[2]],{encoding:'utf8'});\nprocess.stdout.write(r.stdout.split('\\n').filter(line=>/^ok \\d+ - /.test(line)).join('\\n')+'\\n');\n`);
  const result = execute({ actions: [{ type: 'spawn', command: `${process.execPath} ${wrapper} ${module}`, expected: 'partial transport cannot attest a completed test execution', expect: { kind: 'exitCode', value: 0 } }] });
  assert.equal(result.status, 2, 'a target ok line without a complete TAP summary is not a valid execution');
  assert.notEqual(result.verdict.verdict, 'PASS');
}));

test('P31 exact frozen test names can bind a scenario without renaming the reusable test', () => fixture(({ write, execute }) => {
  const name = 'missing product design and usecase baselines refuse implementation dispatch';
  const module = write('named.test.mjs', `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport {requireImplementationBaselines} from ${JSON.stringify(path.join(repo, 'lib/delivery/baseline.js'))};\ntest(${JSON.stringify(name)},()=>{const result=requireImplementationBaselines({baselines:[]});assert.equal(result.ok,false);assert.deepEqual(result.missing,['product','design','usecase']);});\n`);
  const result = execute({ caseModule: module, requiredAssertions: [name], actions: [{ type: 'spawn', command: `${process.execPath} --test --test-reporter=tap ${module}`, expected: 'exact registered reusable test runs', expect: { kind: 'exitCode', value: 0 } }] }, { casePlan: { cases: { A01: { case_module: module, required_assertions: [name] } } } });
  assert.equal(result.status, 0, 'a frozen exact mapping is authoritative without requiring a scenario token in the title');
  assert.equal(result.verdict.execution.target.found, true);
  assert.equal(result.verdict.execution.target.status, 'ok');
  assert.equal(result.verdict.managedClosureEligible, false);
}));

test('P31 native dispatch observation cannot follow a replacement symlink outside its authority', () => fixture(({ root, write, execute }) => {
  const source = runtimeFixture(write, root);
  const outside = write('copied-dispatches.json', fs.readFileSync(source.dispatchFile, 'utf8'));
  fs.unlinkSync(source.dispatchFile); fs.symlinkSync(outside, source.dispatchFile);
  const result = execute({ runtimeBinding: source.binding }, { sourceFixture: source });
  assert.equal(result.status, 2, 'a matching copied dispatch file outside native authority must not qualify');
  assert.notEqual(result.verdict.verdict, 'PASS');
}));


test('P31 protected observation binds typed readback snapshots as well as test output', () => fixture(({ root, write, definition, execute }) => {
  const source = runtimeFixture(write, root);
  const file = write('terminal-data.json', { run: source.binding.run, version: 4 });
  const readback = { id: 'terminal', type: 'readState', path: file, expected: 'the independent terminal version is observed', expect: { kind: 'jsonFields', value: { run: source.binding.run, version: 4 } } };
  const data = { runtimeBinding: source.binding, actions: [...definition.actions, readback] };
  assert.equal(execute(data, { sourceFixture: { ...source, partialRaw: true } }).status, 2, 'omitting typed readback bytes from source evidence must refuse');
  const matched = execute(data, { sourceFixture: source });
  assert.equal(matched.status, 0);
  assert.ok(matched.verdict.evidence.files.includes('action-2-readback.txt'));
  assert.equal(fs.readFileSync(path.join(matched.evidence, 'action-2-readback.txt'), 'utf8'), fs.readFileSync(file, 'utf8'));
}));

test('P31 declared evidence cannot escape the invocation directory or use a directory as persisted proof', () => fixture(({ root, write, definition, execute }) => {
  const outside = write('unrelated-old-evidence.txt', 'pre-existing bytes');
  const escaped = execute({ evidence: { artifacts: [...definition.evidence.artifacts, outside] } });
  assert.equal(escaped.status, 2, 'an external existing file is not this invocation evidence');
  const directory = execute({ evidence: { artifacts: [...definition.evidence.artifacts, '.'] } });
  assert.equal(directory.status, 2, 'directory presence does not prove an evidence artifact');
}));

test('P31 canonical registry can bind an existing case recipe by exact hash without a CLI definition override', () => fixture(({ root, write, module, definition, execute }) => {
  const data = write('version.json', { version: 4 });
  const recipe = { ...definition, actions: [...definition.actions, { id: 'terminal', type: 'readState', path: data, expected: 'frozen actual terminal version', expect: { kind: 'jsonFields', value: { version: 4 } } }] };
  const file = write('registered-case.json', recipe);
  const plan = { cases: { A01: { case_module: module, required_assertions: ['V_A01'], required_proof_level: 'component', required_readbacks: [{ id: 'terminal', type: 'readState', expect: 'jsonFields', fields: ['version'], value: { version: 4 } }], case_definition: file, case_definition_sha256: hash(fs.readFileSync(file)) } } };
  const matched = execute({}, { casePlan: plan, useRegisteredDefinition: true });
  assert.equal(matched.status, 0, 'the registered recipe must supply its typed actions');
  assert.ok(matched.verdict.execution.actions.some((action) => action.id === 'terminal'));
  fs.appendFileSync(file, ' ');
  const changed = execute({}, { casePlan: plan, useRegisteredDefinition: true });
  assert.equal(changed.status, 2, 'a changed registered recipe cannot silently refresh its frozen hash');
}));

test('P31 adapter dynamic binding is observed, never minted by a definition (component seam)', () => fixture(({ root, write, execute }) => {
  const source = runtimeFixture(write, root);
  const result = execute({}, { sourceFixture: source });
  assert.equal(result.status, 0);
  assert.equal(result.verdict.sourceObservation?.binding.run, source.binding.run);
  assert.equal(result.verdict.sourceObservation?.binding.execution, source.binding.execution);
  assert.equal(result.verdict.managedClosureEligible, false, 'an injected component adapter never becomes a managed source');
}));

test('P31 denied entry preflight stops the declared command before it starts', () => fixture(({ root, write, execute }) => {
  const source = runtimeFixture(write, root);
  const marker = path.join(root, 'must-not-be-created');
  const module = write('probe.test.mjs', `import test from 'node:test';\nimport fs from 'node:fs';\ntest('V_A01: entry probe',()=>fs.writeFileSync(${JSON.stringify(marker)},'started'));\n`);
  const result = execute({ caseModule: module, actions: [{ type: 'spawn', command: `${process.execPath} --test --test-reporter=tap ${module}`, expected: 'execute only after entry is qualified', expect: { kind: 'exitCode', value: 0 } }] }, { sourceFixture: { ...source, preflightDenied: true } });
  assert.equal(result.status, 2, 'missing entry qualification must stop execution');
  assert.equal(fs.existsSync(marker), false);
}));


test('P31 rework nonEmptyFile inspection refuses an empty directory', () => fixture(({ root, definition, execute }) => {
  const directory = path.join(root, 'empty-directory');
  fs.mkdirSync(directory);
  const result = execute({ actions: [...definition.actions, { type: 'inspect', path: directory, expected: 'only a non-empty regular file satisfies nonEmptyFile', expect: { kind: 'nonEmptyFile' } }] });
  assert.equal(result.status, 2, `directory stat is not file content: ${JSON.stringify(result.verdict)}`);
  assert.notEqual(result.verdict.verdict, 'PASS');
}));

test('P31 rework commandSucceeds inspection refuses a filesystem executable path', () => fixture(({ root, write, definition, execute }) => {
  const marker = path.join(root, 'executable-ran');
  const executable = write('exit-seven', `#!/bin/sh\nprintf ran > '${marker}'\nexit 7\n`);
  fs.chmodSync(executable, 0o755);
  const result = execute({ actions: [...definition.actions, { type: 'inspect', path: executable, expected: 'file existence never proves a command succeeded', expect: { kind: 'commandSucceeds' } }] });
  assert.equal(fs.existsSync(marker), false, 'a filesystem observation does not execute its path');
  assert.equal(result.status, 2, `unexecuted executable must not pass: ${JSON.stringify(result.verdict)}`);
  assert.notEqual(result.verdict.verdict, 'PASS');
}));


test('P31 rework explicit inspection commands execute and check the real exit', () => fixture(({ root, write, definition, execute }) => {
  const marker = path.join(root, 'explicit-command-ran');
  const executable = write('explicit-exit-seven', `#!/bin/sh\nprintf ran > '${marker}'\nexit 7\n`);
  fs.chmodSync(executable, 0o755);
  const action = { type: 'inspect', command: executable, expected: 'a real nonzero command cannot satisfy commandSucceeds', expect: { kind: 'commandSucceeds' } };
  const rejected = execute({ actions: [...definition.actions, action] });
  assert.equal(rejected.status, 2);
  assert.equal(fs.readFileSync(marker, 'utf8'), 'ran', 'explicit inspection command must actually execute');
  assert.notEqual(rejected.verdict.verdict, 'PASS');
}));

for (const type of ['spawn', 'readState', 'inspect']) {
  test(`P31 rework ${type} rejects mixed command and path fields`, () => fixture(({ write, definition, execute }) => {
    const file = write('file.json', { version: 4 });
    const action = { type, path: file, command: `${process.execPath} --version`, expected: 'the unused field cannot silently hide a different intended operation', expect: type === 'spawn' ? { kind: 'commandSucceeds' } : { kind: 'jsonFields', value: { version: 4 } } };
    const result = execute({ actions: [...definition.actions, action] });
    assert.equal(result.status, 2, `${type} cannot accept both command and filesystem path`);
    assert.equal(result.verdict.execution.actions.length, 0, 'invalid combinations are rejected before any action executes');
  }));
}


for (const type of ['readState', 'inspect']) {
  for (const state of ['empty-file', 'directory', 'missing']) {
    test(`P31 rework ${type} typed file expectations reject ${state}`, () => fixture(({ root, write, definition, execute }) => {
      const file = state === 'empty-file' ? write('empty-file', '') : path.join(root, state);
      if (state === 'directory') fs.mkdirSync(file);
      for (const expect of [{ kind: 'nonEmptyFile' }, { kind: 'equals', value: 'required bytes' }, { kind: 'jsonFields', value: { version: 4 } }]) {
        const result = execute({ actions: [...definition.actions, { type, path: file, expected: 'the typed requirement needs actual matching regular file bytes', expect }] });
        assert.equal(result.status, 2, `${type}/${state}/${expect.kind} must not pass`);
        assert.equal(result.verdict.execution.actions.at(-1).ok, false);
      }
    }));
  }
  test(`P31 rework ${type} reads actual regular files with whitespace in their names`, () => fixture(({ write, definition, execute }) => {
    const file = write('file with whitespace.json', '{"version":4}\n');
    for (const expect of [{ kind: 'nonEmptyFile' }, { kind: 'equals', value: '{"version":4}\n' }, { kind: 'jsonFields', value: { version: 4 } }]) {
      const result = execute({ actions: [...definition.actions, { type, path: file, expected: 'existing file names with spaces remain file observations', expect }] });
      assert.equal(result.status, 0, `${type}/${expect.kind}: ${result.stdout}`);
      const action = result.verdict.execution.actions.at(-1);
      assert.equal(action.ok, true);
      assert.equal(action.command, null, 'a real file path must never become a command');
      assert.equal(result.verdict.legacyInspectionActions, undefined);
      assert.equal(result.verdict.managedClosureEligible, false);
    }
  }));
}

test('P31 rework explicit command inspections evaluate real stdout and exit', () => fixture(({ write, definition, execute }) => {
  const probe = write('probe.cjs', `process.stdout.write('{"version":4}\\n');\n`);
  const command = `${process.execPath} ${probe}`;
  for (const expect of [{ kind: 'commandSucceeds' }, { kind: 'equals', value: '{"version":4}' }, { kind: 'jsonFields', value: { version: 4 } }]) {
    const result = execute({ actions: [...definition.actions, { type: 'inspect', command, expected: 'actual command stdout and exit are observed', expect }] });
    assert.equal(result.status, 0, result.stdout);
    const action = result.verdict.execution.actions.at(-1);
    assert.equal(action.exitCode, 0);
    assert.deepEqual(action.argv, [process.execPath, probe]);
    assert.equal(action.ok, true);
    assert.equal(result.verdict.managedClosureEligible, false);
  }
  const empty = write('empty-probe.cjs', 'process.exit(0);\n');
  assert.equal(execute({ actions: [...definition.actions, { type: 'inspect', command: `${process.execPath} ${empty}`, expected: 'successful commands need no output unless typed output is required', expect: { kind: 'commandSucceeds' } }] }).status, 0);
  for (const expect of [{ kind: 'equals', value: 'required bytes' }, { kind: 'jsonFields', value: { version: 4 } }]) {
    assert.equal(execute({ actions: [...definition.actions, { type: 'inspect', command: `${process.execPath} ${empty}`, expected: 'empty stdout cannot meet a typed value expectation', expect }] }).status, 2);
  }
}));

test('P31 rework command inspection rejects nonEmptyFile before executing', () => fixture(({ root, write, definition, execute }) => {
  const marker = path.join(root, 'incompatible-probe-ran');
  const probe = write('incompatible.cjs', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran');\n`);
  const command = `${process.execPath} ${probe}`;
  for (const selector of [{ command }, { path: command }]) {
    const result = execute({ actions: [...definition.actions, { type: 'inspect', ...selector, expected: 'command output cannot prove a non-empty regular file', expect: { kind: 'nonEmptyFile' } }] });
    assert.equal(result.status, 2);
    assert.equal(result.verdict.execution.actions.length, 0);
    assert.equal(fs.existsSync(marker), false);
  }
}));

test('P31 rework legacy command paths stay component only', () => fixture(({ definition, execute }) => {
  const result = execute({ actions: [...definition.actions, { type: 'inspect', path: `${process.execPath} --version`, expected: 'historical command paths have an explicitly limited compatibility scope', expect: { kind: 'equals', value: process.version } }] });
  assert.equal(result.status, 0);
  assert.deepEqual(result.verdict.legacyInspectionActions, { scope: 'component/legacy-compatibility', indexes: [2] });
  assert.equal(result.verdict.scope, 'component/observer-qualification');
  assert.equal(result.verdict.managedClosureEligible, false);
}));

test('P31 rework unsupported action expectation and selector combinations fail before execution', () => fixture(({ write, definition, execute }) => {
  const file = write('typed.json', { version: 4 });
  const command = `${process.execPath} --version`;
  const selectors = [{ type: 'spawn', command }, { type: 'readState', path: file }, { type: 'inspect', path: file }, { type: 'inspect', command }];
  const allowed = [['exitCode', 'commandSucceeds', 'tapRequiredAssertions'], ['equals', 'nonEmptyFile', 'jsonFields'], ['equals', 'nonEmptyFile', 'jsonFields'], ['commandSucceeds', 'equals', 'jsonFields']];
  const expectations = [{ kind: 'exitCode', value: 0 }, { kind: 'commandSucceeds' }, { kind: 'equals', value: 'required' }, { kind: 'nonEmptyFile' }, { kind: 'jsonFields', value: { version: 4 } }, { kind: 'tapRequiredAssertions', assertions: ['V_A01'] }, { kind: 'unknownTypedRequirement' }, {}, undefined];
  selectors.forEach((selector, index) => {
    for (const expect of expectations.filter((item) => !allowed[index].includes(item?.kind))) {
      const result = execute({ actions: [...definition.actions, { ...selector, expected: 'unsupported typed requirements cannot fall through to default success', ...(expect ? { expect } : {}) }] });
      assert.equal(result.status, 2, `${JSON.stringify(selector)}/${JSON.stringify(expect)}`);
      assert.equal(result.verdict.execution.actions.length, 0);
    }
  });
  for (const action of [
    { type: 'spawn', command: '' }, { type: 'spawn', command: '   ' }, { type: 'spawn' },
    { type: 'readState', path: '' }, { type: 'readState', path: '   ' }, { type: 'readState' },
    { type: 'inspect', command: '' }, { type: 'inspect', command: '   ' },
    { type: 'inspect', path: '' }, { type: 'inspect', path: '   ' }, { type: 'inspect' },
  ]) {
    const result = execute({ actions: [...definition.actions, { ...action, expected: 'missing or empty selectors cannot attest an operation', expect: { kind: 'equals', value: 'required' } }] });
    assert.equal(result.status, 2);
    assert.equal(result.verdict.execution.actions.length, 0);
  }
  assert.equal(execute({ actions: [...definition.actions, { type: 'inspect', path: file, required: false, expected: 'optional status does not make an unknown typed requirement valid', expect: { kind: 'unknownTypedRequirement' } }] }).status, 2);
}));


test('P31 root relative inspect rejects same-name bytes from another process cwd', () => fixture(({ root, write, definition, execute }) => {
  write('package.json', { cwdOnlyProof: 'private-cwd-shadow' });
  const result = execute({ actions: [...definition.actions, { type: 'inspect', path: 'package.json', expected: 'relative inspection observes the repository file, never a cwd collision', expect: { kind: 'jsonFields', value: { cwdOnlyProof: 'private-cwd-shadow' } } }] }, { cwd: root });
  assert.equal(result.status, 2, `cwd file must not supply the repository proof: ${JSON.stringify(result.verdict)}`);
  assert.notEqual(result.verdict.verdict, 'PASS');
  const action = result.verdict.execution.actions.at(-1);
  assert.equal(action.observed.path, 'package.json');
  assert.equal(fs.readFileSync(path.join(result.evidence, action.rawEvidence[0]), 'utf8'), fs.readFileSync(path.join(repo, 'package.json'), 'utf8'));
}));

test('P31 root relative inspect reads and displays the same repository target across cwd', () => fixture(({ root, write, definition, execute }) => {
  write('package.json', { cwdOnlyProof: 'different-short-content' });
  const expected = fs.readFileSync(path.join(repo, 'package.json'), 'utf8');
  const result = execute({ actions: [...definition.actions, { type: 'inspect', path: 'package.json', expected: 'stat, bytes and display refer to the specified repository target', expect: { kind: 'equals', value: expected } }] }, { cwd: root });
  assert.equal(result.status, 0, `repository content must remain independent of cwd: ${JSON.stringify(result.verdict)}`);
  const action = result.verdict.execution.actions.at(-1);
  assert.equal(action.observed.path, 'package.json');
  assert.equal(action.observed.bytes, Buffer.byteLength(expected));
  assert.equal(action.observed.value, expected);
  assert.equal(fs.readFileSync(path.join(result.evidence, action.rawEvidence[0]), 'utf8'), expected);
  assert.equal(result.verdict.managedClosureEligible, false);
}));


test('P31 root absolute inspection targets preserve their requested file across cwd', () => fixture(({ root, write, definition, execute }) => {
  const file = write('absolute-target.json', '{"target":"absolute-file"}\n');
  for (const cwd of [repo, root]) {
    const result = execute({ actions: [...definition.actions, { type: 'inspect', path: file, expected: 'an explicit absolute path keeps its existing target', expect: { kind: 'jsonFields', value: { target: 'absolute-file' } } }] }, { cwd });
    assert.equal(result.status, 0, result.stdout);
    const action = result.verdict.execution.actions.at(-1);
    assert.equal(action.observed.bytes, Buffer.byteLength('{"target":"absolute-file"}\n'));
    assert.equal(fs.readFileSync(path.join(result.evidence, action.rawEvidence[0]), 'utf8'), '{"target":"absolute-file"}\n');
    assert.equal(result.verdict.legacyInspectionActions, undefined);
    assert.equal(result.verdict.managedClosureEligible, false);
  }
}));

test('P31 root relative file names with whitespace use the same target for classification and bytes', () => fixture(({ root, write, definition, execute }) => {
  const file = write('file with whitespace.json', '{"target":"spaced-file"}\n');
  const relative = path.relative(repo, file);
  const actions = [...definition.actions, { type: 'inspect', path: relative, expected: 'an existing repo-relative whitespace path remains a file even from a different cwd', expect: { kind: 'equals', value: '{"target":"spaced-file"}\n' } }];
  const result = execute({ actions }, { cwd: root });
  assert.equal(result.status, 0, result.stdout);
  const observed = result.verdict.execution.actions.at(-1);
  assert.equal(observed.observed.bytes, Buffer.byteLength('{"target":"spaced-file"}\n'));
  assert.equal(observed.command, null);
  assert.equal(fs.readFileSync(path.join(result.evidence, observed.rawEvidence[0]), 'utf8'), '{"target":"spaced-file"}\n');
  assert.equal(result.verdict.legacyInspectionActions, undefined);
}));

test('P31 root cwd whitespace collisions do not redefine the component legacy command target', () => fixture(({ root, write, definition, execute }) => {
  write('node --version', 'cwd file is not the repository target');
  const result = execute({ actions: [...definition.actions, { type: 'inspect', path: 'node --version', expected: 'legacy compatibility classification still uses the repository root', expect: { kind: 'equals', value: process.version } }] }, { cwd: root });
  assert.equal(result.status, 0, result.stdout);
  assert.deepEqual(result.verdict.legacyInspectionActions, { scope: 'component/legacy-compatibility', indexes: [2] });
  assert.equal(result.verdict.execution.actions.at(-1).observed, process.version);
  assert.equal(result.verdict.managedClosureEligible, false);
}));

test('P31 root readState relative targets retain the evidence directory across cwd collisions', () => fixture(({ root, write, definition, execute }) => {
  write('action-1-stdout.txt', '{"cwdOnlyProof":"private-shadow"}\n');
  const action = { type: 'readState', path: 'action-1-stdout.txt', expected: 'readState observes this invocation evidence, independently of cwd and repository file roots', expect: { kind: 'nonEmptyFile' } };
  const result = execute({ actions: [...definition.actions, action] }, { cwd: root });
  assert.equal(result.status, 0, result.stdout);
  const readback = result.verdict.execution.actions.at(-1);
  const expected = fs.readFileSync(path.join(result.evidence, 'action-1-stdout.txt'), 'utf8');
  assert.equal(fs.readFileSync(path.join(result.evidence, readback.rawEvidence[0]), 'utf8'), expected);
  assert.equal(readback.observed.bytes, Buffer.byteLength(expected));
  assert.notEqual(expected, '{"cwdOnlyProof":"private-shadow"}\n');
  const rejected = execute({ actions: [...definition.actions, { ...action, expect: { kind: 'jsonFields', value: { cwdOnlyProof: 'private-shadow' } } }] }, { cwd: root });
  assert.equal(rejected.status, 2);
  assert.equal(rejected.verdict.execution.actions.at(-1).ok, false);
}));

test('P31 root a cwd regular file cannot hide a repository directory', () => fixture(({ root, write, definition, execute }) => {
  write('test', 'cwd nonempty regular file');
  assert.equal(fs.statSync(path.join(repo, 'test')).isDirectory(), true);
  const result = execute({ actions: [...definition.actions, { type: 'inspect', path: 'test', expected: 'the repository directory is never a non-empty regular file', expect: { kind: 'nonEmptyFile' } }] }, { cwd: root });
  assert.equal(result.status, 2);
  const action = result.verdict.execution.actions.at(-1);
  assert.equal(action.observed.path, 'test');
  assert.equal(action.ok, false);
  assert.equal(action.rawEvidence, undefined);
}));

test('P31 root a cwd file cannot hide a missing repository target', () => fixture(({ root, write, definition, execute }) => {
  const name = `cwd-only-${crypto.randomUUID()}.json`;
  write(name, { cwdOnlyProof: 'nonempty private file' });
  assert.equal(fs.existsSync(path.join(repo, name)), false);
  const result = execute({ actions: [...definition.actions, { type: 'inspect', path: name, expected: 'a missing repository target is observed as missing regardless of cwd files', expect: { kind: 'nonEmptyFile' } }] }, { cwd: root });
  assert.equal(result.status, 2);
  const action = result.verdict.execution.actions.at(-1);
  assert.deepEqual(action.observed, { path: name, exists: false });
  assert.equal(action.ok, false);
  assert.equal(action.rawEvidence, undefined);
}));

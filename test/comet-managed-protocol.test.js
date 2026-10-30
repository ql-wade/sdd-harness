import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseTapSummary } from '../lib/delivery/test-contract.js';
import { admitEvidence, createLaunchAuthority, envelopeDigest } from '../lib/delivery/evidence.js';
import { evaluate } from '../lib/delivery/gate.js';
import { readPlanSource, verifyPlanSource } from '../lib/adapters/plan-source.js';
const { createBindings } = await import(process.env.P24_BASELINE_BINDINGS || '../integrations/comet/application/bindings.mjs');
const sha = (label) => crypto.createHash('sha256').update(label).digest('hex');
const NOW = '2026-10-20T12:00:00.000Z';
const INPUT = sha('full-input-r1');
const POLICY_DIGEST = sha('policy/managed-pilot@r1');
const POLICY = { ref: 'policy/managed-pilot', digest: POLICY_DIGEST };

function contractFixture(requiredChecks) {
  return {
    schemaVersion: 1,
    project: 'sdd-harness',
    change: 'delivery-foundation-rearchitecture',
    cases: [{ id: 'c1', ac: 'A18', oracle: 'required capabilities are observed before pass' }],
    requiredChecks,
    executionDenominator: { totalCases: 1 },
    cleanup: { environment: 'temp dir removed after run', data: 'none persisted' },
    dependencyBaselines: [{ kind: 'product', digest: sha('product-r1') }],
  };
}

function envelopeFixture(overrides = {}) {
  return {
    schemaVersion: 1,
    candidateDigest: INPUT,
    caseId: 'c1',
    check: 'unit:node:test',
    origin: { kind: 'registered-runner', id: 'runner-1' },
    execution: { id: 'exec-verifier-1' },
    environment: 'managed-pilot-env-1',
    toolchain: 'node v22.13.1',
    executions: { total: 3, valid: 2 },
    result: 'pass',
    evidence: [{ uri: '.whitebox/c1/tap.txt', sha256: sha('tap-output') }],
    expiry: '2026-11-01T00:00:00.000Z',
    ...overrides,
  };
}

function inputsFixture(requiredChecks) {
  return {
    inputDigest: INPUT,
    testContract: contractFixture(requiredChecks),
    builderExecution: 'exec-builder-1',
  };
}
async function managedProtocolEntry(testCount = 1, { executionId = 'exec-verifier-1', caseId = 'c1', capability = 'unit:node:test', deterministicReport = false, gate = 'V', observationMethod } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p22-gate-source-'));
  const canonical = (v) => v && typeof v === 'object' ? Array.isArray(v) ? v.map(canonical) : Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])])) : v;
  const hash = (v) => crypto.createHash('sha256').update(v).digest('hex');
  const jsonHash = (v) => hash(JSON.stringify(canonical(v)));
  try {
    const file = path.join(root, 'actual.test.mjs');
    // One fixed five-example command; a short run omits examples rather
    // than adding unrelated assertions to manufacture the frozen denominator.
    const examples = [['42', 42], ['0', 0], ['-7', -7], ['007', 7], ['invalid', null]];
    fs.writeFileSync(file, "import test from 'node:test'; import assert from 'node:assert/strict';\n" + examples.slice(0, testCount).map(([input, expected], i) =>
      `test('actual recorded assertion ${executionId} ${i}', () => assert.equal(${expected === null ? `Number.isNaN(Number.parseInt(${JSON.stringify(input)}, 10))` : `Number.parseInt(${JSON.stringify(input)}, 10)`}, ${expected === null ? true : expected}));\n`).join(''));
    const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
    const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap', 'actual.test.mjs'], { cwd: root, env, encoding: 'utf8' }); assert.equal(run.status, 0);
    const measured = parseTapSummary(run.stdout);
    // A legitimate recorder can emit deterministic summary reports. Full
    // native TAP remains in the bound trace; counts are parsed from that run.
    const reportBytes = Buffer.from(deterministicReport ? JSON.stringify(measured) : run.stdout);
    const resultBytes = Buffer.from(JSON.stringify(deterministicReport ? { exitCode: run.status, summary: measured } : { exitCode: run.status, stdout: run.stdout }));
    const methodTraceBytes = Buffer.from(JSON.stringify({ processId: run.pid, ...(deterministicReport ? { nativeTap: run.stdout } : {}), methodApplication: 'UNVERIFIED' }));
    const actionBinding = { schemaVersion: 1, profile: 'comet-managed-v2', runnerId: 'runner-1', run: 'run-1', action: 'verify-case', gate, execution: executionId, role: 'verifier', revision: 'r1', attempt: 1, epoch: 1,
      inputDigest: INPUT, policyDigest: POLICY_DIGEST, environmentDigest: sha('env'), workPackage: { id: 'wp-1', taskIds: ['2.2.b'] },
      methods: [{ name: 'whitebox-verify', version: '1.0.0', ref: '.agents/skills/whitebox-verify/SKILL.md', digest: sha('method') }], allowedPaths: ['.whitebox'], allowedTools: ['read_file'], inputs: [{ name: 'input', ref: 'src/app.js', digest: INPUT }], outputs: [{ name: 'report', ref: '.whitebox/report.json' }] };
    // Protocol-only test source port. This does NOT attest OS isolation or
    // real skill application; every semantic/business Gate below stays open.
    const qualification = { id: 'unit-source-interface-not-deployment', sourceId: 'unit-source', revision: 'q1', scope: 'protected-source', status: 'qualified', expiresAt: '2026-11-01T00:00:00.000Z', evidenceRefs: [{ ref: 'unit-only/process-readback', digest: hash(reportBytes) }] };
    const authority = createLaunchAuthority({ secret: crypto.randomBytes(32).toString('hex'), sourceVerifier: async (request) => {
      if (hash(request.reportBytes) !== hash(reportBytes) || hash(request.resultBytes) !== hash(resultBytes) || hash(request.methodTraceBytes) !== hash(methodTraceBytes)) return { ok: false };
      return { ok: true, qualification, facts: { actionDigest: jsonHash(actionBinding), dispatchDigest: jsonHash(dispatch), envelopeDigest: envelopeDigest(envelope), launchDigest: jsonHash(packet.launchRecord), reportDigest: hash(reportBytes), resultDigest: hash(resultBytes), methodTraceDigest: hash(methodTraceBytes), run: 'run-1', execution: actionBinding.execution, launchId: packet.launchRecord.launchId, environmentDigest: actionBinding.environmentDigest, principal: 'unit-process-principal', observations: [{ caseId: envelope.caseId, check: envelope.check, command: 'node --test --test-reporter=tap actual.test.mjs', ...(observationMethod ? {method:observationMethod} : {}), result: run.status === 0 ? 'pass' : 'fail', executions: { total: measured.tests, valid: measured.pass + measured.fail } }] } };
    } });
    const dispatch = authority.issueDispatch({ ...actionBinding, actionBinding });
    const envelope = envelopeFixture({ caseId, check: capability, execution: { id: executionId }, executions: { total: measured.tests, valid: measured.pass + measured.fail }, evidence: [{ uri: '.whitebox/report.json', sha256: hash(reportBytes) }] });
    const packet = { dispatch, envelope, launchRecord: { launchId: `unit-real-process-${executionId}`, execution: actionBinding.execution, processId: run.pid }, reportBytes, resultBytes, methodTraceBytes };
    const collected = await authority.collectResult(packet); assert.equal(collected.ok, true);
    const context = { authority, actionBinding, sourceQualification: qualification, environment: envelope.environment, purpose: 'independent-acceptance', builderExecution: 'exec-builder-1', builderPrincipal: 'builder-principal', authoringExecutions: ['R','A','T','P'].includes(gate) ? ['fixture-author'] : [], authoringPrincipals: ['R','A','T','P'].includes(gate) ? ['fixture-author-principal'] : [], consumedCollections: [], issuedExecutions: [], now: NOW };
    const admitted = admitEvidence({ ...packet, collection: collected.collection }, { ...context, requireManaged: true }); assert.equal(admitted.ok, true);
    return { context, entry: admitted.entry };
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

function managedInputsFixture() {
  const inputs = inputsFixture([{ id: 'check-1', level: 'unit', capability: 'unit:node:test', command: 'node --test --test-reporter=tap actual.test.mjs', caseIds: ['c1'] }]);
  inputs.testContract.commandBindingsRequired = true;
  inputs.testContract.cases[0].checkIds = ['check-1'];
  return inputs;
}

test('T accepts a bound independent test-design review without requiring product test execution', async()=>{
  const { context, entry } = await managedProtocolEntry(1, { gate:'T', capability:'review:test-design' });
  const inputs=managedInputsFixture();
  inputs.testContract.cases.push({id:'c2',ac:'A19',oracle:'a separate denial stays denied',checkIds:['check-2']});
  inputs.testContract.requiredChecks.push({id:'check-2',level:'unit',capability:'unit:second',command:'node --test second.test.mjs',caseIds:['c2']});
  inputs.testContract.executionDenominator.totalCases=2;
  inputs.testContract.sourceReadiness='design_only';
  inputs.testContract.dependencyBaselines.push({kind:'domain-cases/v1:testpack',digest:sha('testpack')});
  const source=entry.sourcePacket.collection;
  const review={ok:true,sufficient:true,kind:'independent-test-design-review',contractDigest:envelopeDigest(inputs.testContract),
    evidenceDigest:sha('design-review'),envelopeDigest:entry.digest,reportDigest:source.reportDigest,
    actionDigest:source.actionDigest,execution:entry.execution,principal:source.source.facts.principal};
  const options={requireManaged:true,currentRunId:'run-1',currentGate:'T',admissionOptionsFor:()=>context,verifyReview:()=>review};
  const result=evaluate(inputs,[entry],POLICY,options);
  assert.equal(result.verdict,'pass',result.receipt.blocked.join('; '));
  assert.deepEqual(result.receipt.requiredDenominator,{required:1,valid:1},'T counts the review, not unexecuted product tests');
  assert.equal(result.managedClosureEligible,false,'a component judgment is not a real Comet gate passage');
  for(const badReview of [{...review,kind:'independent-architecture-review'}, {...review,contractDigest:sha('different-contract')}, {...review,sufficient:false}]) {
    assert.equal(evaluate(inputs,[entry],POLICY,{...options,verifyReview:()=>badReview}).verdict,'blocked');
  }
  assert.equal(evaluate(inputs,[entry],POLICY,{...options,currentGate:'V'}).verdict,'blocked','design review cannot substitute for V');
  const ports={verifyGateInputs:({run,gate})=>run.runId==='run-1' && gate==='T',
    admissionOptionsFor:()=>context,verifyReview:()=>review,readSourcePacket:()=>entry.sourcePacket};
  const factory={manifest:{bindings:[]},skills:new Map(),createSkillExecutor:x=>x};
  const validator=(await createBindings(factory,ports)).validators.find(v=>v.id==='sdd.delivery.gate.t');
  const input={run:{runId:'run-1'},action:{id:'fixture'},outcome:{output:{gateEvidence:{gate:'T',inputs,receipts:[entry],policy:POLICY}}}};
  assert.equal((await validator.validate(input)).accepted,true,'the packaged T validator must consume the independent review');
  assert.equal((await validator.validate({...input,run:{runId:'other-run'}})).accepted,false,'a different Run cannot reuse the review');
});

test('test-design review precedes builder execution and still rejects the author as reviewer', async()=>{
  const { context, entry } = await managedProtocolEntry(1, { gate:'T', capability:'review:test-design' });
  const inputs = managedInputsFixture();
  delete inputs.builderExecution;
  const preBuild = { ...context, authoringExecutions:['test-author-execution'], authoringPrincipals:['test-author-principal'] };
  delete preBuild.builderExecution;
  delete preBuild.builderPrincipal;
  const source = entry.sourcePacket.collection;
  const review = { ok:true, sufficient:true, kind:'independent-test-design-review', contractDigest:envelopeDigest(inputs.testContract),
    evidenceDigest:sha('independent-review'), envelopeDigest:entry.digest, reportDigest:source.reportDigest,
    actionDigest:source.actionDigest, execution:entry.execution, principal:source.source.facts.principal };
  const options = { requireManaged:true, currentRunId:'run-1', currentGate:'T', admissionOptionsFor:()=>preBuild, verifyReview:()=>review };
  assert.equal(evaluate(inputs,[entry],POLICY,options).verdict,'pass');
  const ports = {verifyGateInputs:({run,gate})=>run.runId==='run-1' && gate==='T',
    admissionOptionsFor:()=>preBuild,verifyReview:()=>review,readSourcePacket:()=>entry.sourcePacket};
  const factory = {manifest:{bindings:[]},skills:new Map(),createSkillExecutor:x=>x};
  const validator = (await createBindings(factory,ports)).validators.find((value)=>value.id==='sdd.delivery.gate.t');
  const request = {run:{runId:'run-1'},action:{id:'fixture'},outcome:{output:{gateEvidence:{gate:'T',inputs,receipts:[entry],policy:POLICY}}}};
  assert.equal((await validator.validate(request)).accepted,true,'the application validator must consume the pre-build review');
  assert.equal((await validator.validate({...request,run:{runId:'other-run'}})).accepted,false);
  const selfReview = { ...preBuild, authoringPrincipals:[source.source.facts.principal] };
  assert.equal(evaluate(inputs,[entry],POLICY,{...options,admissionOptionsFor:()=>selfReview}).verdict,'blocked');
  const unknownAuthor = { ...preBuild, authoringPrincipals:[] };
  assert.equal(evaluate(inputs,[entry],POLICY,{...options,admissionOptionsFor:()=>unknownAuthor}).verdict,'blocked');
  const unknownAuthorWithBuilder = {...context,authoringExecutions:[],authoringPrincipals:[]};
  assert.equal(evaluate(inputs,[entry],POLICY,{...options,admissionOptionsFor:()=>unknownAuthorWithBuilder}).verdict,'blocked');
  const partialBuilder = { ...preBuild, builderExecution:'some-builder' };
  assert.equal(evaluate(inputs,[entry],POLICY,{...options,admissionOptionsFor:()=>partialBuilder}).verdict,'blocked');
  assert.throws(()=>evaluate(inputs,[entry],POLICY,{...options,currentGate:'V'}),/builderExecution/);
});

test('requirements and architecture reviews precede builder execution and reject author self-review', async()=>{
  for (const [gate, kind] of [['R','requirements-scope-confirmation'],['A','grill-exact-unanimous-consensus']]) {
    const {context, entry} = await managedProtocolEntry(1,{gate,capability:`review:${gate}`});
    const preBuild = {...context,authoringExecutions:['author-execution'],authoringPrincipals:['author-principal']};
    delete preBuild.builderExecution;
    delete preBuild.builderPrincipal;
    const source = entry.sourcePacket.collection;
    const review = {ok:true,sufficient:true,kind,evidenceDigest:sha(`review-${gate}`),envelopeDigest:entry.digest,
      reportDigest:source.reportDigest,actionDigest:source.actionDigest,execution:entry.execution,principal:source.source.facts.principal};
    const inputs = {inputDigest:INPUT};
    const options = {requireManaged:true,currentRunId:'run-1',currentGate:gate,admissionOptionsFor:()=>preBuild,verifyReview:()=>review};
    const result = evaluate(inputs,[entry],POLICY,options);
    assert.equal(result.verdict,'pass',`${gate}: ${result.receipt.blocked.join('; ')}`);
    const selfReview = {...preBuild,authoringExecutions:[entry.execution]};
    assert.equal(evaluate(inputs,[entry],POLICY,{...options,admissionOptionsFor:()=>selfReview}).verdict,'blocked',gate);
  }
});

test('P accepts a current canonical plan review before product execution and rejects stale or foreign plans', async(t)=>{
  const {context, entry} = await managedProtocolEntry(1,{gate:'P',capability:'review:plan'});
  const preBuild = {...context}; delete preBuild.builderExecution; delete preBuild.builderPrincipal;
  const planBundle = {schemaVersion:1,change:'example-change',schedulerOwner:'comet-classic',
    tasks:[{id:'write-tests',dependsOn:[]},{id:'implement',dependsOn:['write-tests']}],
    allowedPaths:['src/','test/'],worktree:'current',acceptanceRefs:['AC1']};
  const changeDir='openspec/changes/example-change';
  const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'sdd-plan-gate-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const dir=path.join(root,changeDir);fs.mkdirSync(dir,{recursive:true});
  const taskText='### Task write-tests: tests\n\n**Dependencies:** none\n\n- [ ] write tests\n\n### Task implement: code\n\n**Dependencies:** write-tests\n\n- [ ] implement\n';
  const dag={schema_version:2,plan_path:'tasks.md',tasks:[{id:'write-tests',depends_on:[]},{id:'implement',depends_on:['write-tests']}]};
  fs.writeFileSync(path.join(dir,'tasks.md'),taskText);fs.writeFileSync(path.join(dir,'task-dag.json'),JSON.stringify(dag));
  const run={runId:'run-1',input:{change:'example-change',changeDir}};
  const observed=readPlanSource({projectRoot:root,run,planBundle});assert.equal(observed.ok,true,observed.reason);
  fs.writeFileSync(path.join(dir,'tasks.md'),taskText.replace('**Dependencies:** write-tests','**Dependencies:** none'));
  assert.equal(readPlanSource({projectRoot:root,run,planBundle}).ok,false,'a freshly hashed plan must not contradict its own DAG');
  fs.writeFileSync(path.join(dir,'tasks.md'),taskText.replace('**Dependencies:** write-tests','**Dependencies:** write-tests\n**Dependencies:** none'));
  assert.equal(readPlanSource({projectRoot:root,run,planBundle}).ok,false,'duplicate dependency declarations are ambiguous');
  fs.writeFileSync(path.join(dir,'tasks.md'),taskText);
  const planSources=observed.planSources;
  const inputs={inputDigest:INPUT,planBundle,planSources};
  const source=entry.sourcePacket.collection;
  const review={ok:true,sufficient:true,kind:'plan-unique-review',planDigest:envelopeDigest(planBundle),change:planBundle.change,
    tasksDigest:planSources.tasks.digest,dagDigest:planSources.dag.digest,
    evidenceDigest:sha('plan-review'),envelopeDigest:entry.digest,reportDigest:source.reportDigest,
    actionDigest:source.actionDigest,execution:entry.execution,principal:source.source.facts.principal};
  const options={requireManaged:true,currentRunId:'run-1',currentGate:'P',currentChange:'example-change',currentChangeDir:changeDir,
    admissionOptionsFor:()=>preBuild,verifyReview:()=>review};
  const result=evaluate(inputs,[entry],POLICY,options);
  assert.equal(result.verdict,'pass',result.receipt.blocked.join('; '));
  assert.deepEqual(result.receipt.requiredDenominator,{required:1,valid:1});
  assert.equal(evaluate(inputs,[],POLICY,options).verdict,'blocked');
  assert.throws(()=>evaluate(inputs,[entry],POLICY,{...options,currentGate:'V'}),/INVALID_TEST_CONTRACT/);
  for (const invalid of [
    {inputs:{...inputs,planBundle:{...planBundle,change:'other-change'}},options},
    {inputs:{...inputs,planBundle:{...planBundle,schedulerOwner:'another-controller'}},options},
    {inputs,options:{...options,currentChange:'other-change'}},
    {inputs,options:{...options,verifyReview:()=>({...review,planDigest:sha('stale-plan')})}},
    {inputs,options:{...options,verifyReview:()=>({...review,dagDigest:sha('stale-dag')})}},
    {inputs:{...inputs,planSources:{...planSources,dag:{...planSources.dag,ref:'openspec/changes/other/task-dag.json'}}},options},
    {inputs,options:{...options,verifyReview:()=>({...review,kind:'independent-test-design-review'})}},
    {inputs,options:{...options,admissionOptionsFor:()=>({...preBuild,authoringPrincipals:[]})}},
    {inputs,options:{...options,admissionOptionsFor:()=>({...preBuild,authoringExecutions:[entry.execution]})}},
  ]) assert.notEqual(evaluate(invalid.inputs,[entry],POLICY,invalid.options).verdict,'pass');
  for (const tasks of [
    [{id:'duplicate',dependsOn:[]},{id:'duplicate',dependsOn:[]}],
    [{id:'implement',dependsOn:['missing']}],
    [{id:'first',dependsOn:['second']},{id:'second',dependsOn:['first']}],
  ]) {
    const badPlan={...planBundle,tasks};
    const badReview={...review,planDigest:envelopeDigest(badPlan)};
    assert.notEqual(evaluate({...inputs,planBundle:badPlan},[entry],POLICY,{...options,verifyReview:()=>badReview}).verdict,'pass');
  }
  const badChange='../foreign'; const badDir=`openspec/changes/${badChange}`;
  const escapedPlan={...planBundle,change:badChange};
  const escapedSources={tasks:{...planSources.tasks,ref:`${badDir}/tasks.md`},dag:{...planSources.dag,ref:`${badDir}/task-dag.json`}};
  assert.notEqual(evaluate({...inputs,planBundle:escapedPlan,planSources:escapedSources},[entry],POLICY,
    {...options,currentChange:badChange,currentChangeDir:badDir,verifyReview:()=>({...review,change:badChange,planDigest:envelopeDigest(escapedPlan)})}).verdict,'pass');
  const factory={projectRoot:root,manifest:{bindings:[]},skills:new Map(),createSkillExecutor:x=>x};
  const ports={verifyGateInputs:({run,gate,inputs:current})=>{
      if(run.runId!=='run-1' || gate!=='P') return false;
      return verifyPlanSource({projectRoot:root,run,inputs:current});
    },
    admissionOptionsFor:()=>preBuild,verifyReview:()=>review,readSourcePacket:()=>entry.sourcePacket};
  const validator=(await createBindings(factory,ports)).validators.find(v=>v.id==='sdd.delivery.gate.p');
  const request={run,action:{id:'fixture'},
    outcome:{output:{gateEvidence:{gate:'P',inputs,receipts:[entry],policy:POLICY}}}};
  assert.equal((await validator.validate(request)).accepted,true);
  assert.equal((await validator.validate({...request,run:{runId:'run-1',input:{change:'other-change'}}})).accepted,false);
  fs.writeFileSync(path.join(dir,'tasks.md'),taskText.replace('[ ] write tests','[x] write tests'));
  assert.equal((await validator.validate(request)).accepted,true,'progress does not stale plan definitions');
  fs.writeFileSync(path.join(dir,'tasks.md'),taskText.replace('write tests','write better tests'));
  assert.equal((await validator.validate(request)).accepted,false,'changed plan definitions invalidate the review');
  const lyingValidator=(await createBindings(factory,{...ports,verifyGateInputs:()=>true})).validators.find(v=>v.id==='sdd.delivery.gate.p');
  assert.equal((await lyingValidator.validate(request)).accepted,false,'an inaccurate source callback must not mask changed plan files');
  fs.writeFileSync(path.join(dir,'tasks.md'),taskText);
  fs.writeFileSync(path.join(dir,'task-dag.json'),JSON.stringify({...dag,tasks:[dag.tasks[0],{id:'implement',depends_on:[]}]}));
  assert.equal((await validator.validate(request)).accepted,false,'changed DAG is not the reviewed plan');
  fs.writeFileSync(path.join(dir,'task-dag.json'),JSON.stringify(dag));
  const archiveRoot=path.join(root,'openspec/changes/archive');fs.mkdirSync(archiveRoot);
  fs.renameSync(dir,path.join(archiveRoot,'2026-10-30-example-change'));
  const archiving={...run,actions:[{ref:'classic-archive',status:'running'}]};
  assert.equal((await validator.validate({...request,run:archiving})).accepted,true,'the same in-flight archive retains its plan review');
  const archived={...run,actions:[{ref:'classic-archive',status:'succeeded',outcome:{output:{archiveDirectory:'openspec/changes/archive/2026-10-30-example-change'}}}]};
  assert.equal((await validator.validate({...request,run:archived})).accepted,true,'the completed archive is resolved by its recorded output');
});


test('synthetic protected source admits a current V receipt and rejects mismatched run or policy', async()=>{
  const packet=await managedProtocolEntry();const {context,entry}=packet;const source=entry.sourcePacket.collection;
  const review={ok:true,sufficient:true,evidenceDigest:sha('protocol-only-review'),envelopeDigest:entry.digest,reportDigest:source.reportDigest,actionDigest:source.actionDigest,execution:entry.execution,principal:source.source.facts.principal};
  const ports={verifyGateInputs:({run,gate,inputs,policy})=>run.runId==='run-1' && gate==='V' && inputs.inputDigest===INPUT && policy.digest===POLICY_DIGEST,
    admissionOptionsFor:()=>context,verifyReview:()=>review,readSourcePacket:()=>entry.sourcePacket};
  const evidence={gate:'V',inputs:managedInputsFixture(),receipts:[entry],policy:POLICY,options:{requireManaged:false}};
  const options={requireManaged:true,currentRunId:'run-1',currentGate:'V',admissionOptionsFor:ports.admissionOptionsFor,verifyReview:ports.verifyReview};
  const direct=evaluate(evidence.inputs,evidence.receipts,evidence.policy,options);assert.equal(direct.verdict,'pass',direct.receipt.blocked.join('; '));assert.equal(direct.managedClosureEligible,false);
  const b=await createBindings({manifest:{bindings:[]},skills:new Map(),createSkillExecutor:x=>x},ports);const v=b.validators.find(x=>x.id==='sdd.delivery.gate.v');
  const input={run:{runId:'run-1'},action:{id:'fixture',stepId:'classic.extension.V'},outcome:{output:{gateEvidence:evidence}}};
  assert.equal((await v.validate(input)).accepted,true);
  assert.equal((await v.validate({...input,run:{runId:'different-run'}})).accepted,false);
  assert.equal((await v.validate({...input,outcome:{output:{gateEvidence:{...evidence,policy:{...POLICY,digest:sha('different-policy')}}}}})).accepted,false);
});

test('a design-only Markdown contract cannot pass V even with otherwise admitted synthetic evidence', async()=>{
  const { context, entry } = await managedProtocolEntry();
  const source = entry.sourcePacket.collection;
  const review = { ok:true, sufficient:true, evidenceDigest:sha('protocol-only-review'), envelopeDigest:entry.digest,
    reportDigest:source.reportDigest, actionDigest:source.actionDigest, execution:entry.execution, principal:source.source.facts.principal };
  const ports = { verifyGateInputs:()=>true, admissionOptionsFor:()=>context, verifyReview:()=>review, readSourcePacket:()=>entry.sourcePacket };
  const inputs = managedInputsFixture();
  inputs.testContract.sourceReadiness = 'design_only';
  inputs.testContract.dependencyBaselines.push({ kind:'domain-cases/v1:testpack', digest:sha('testpack') });
  const b = await createBindings({ manifest:{bindings:[]}, skills:new Map(), createSkillExecutor:x=>x }, ports);
  const verdict = await b.validators.find(x=>x.id==='sdd.delivery.gate.v').validate({ run:{runId:'run-1'},
    action:{id:'fixture',stepId:'classic.extension.V'}, outcome:{output:{gateEvidence:{gate:'V',inputs,receipts:[entry],policy:POLICY}}} });
  assert.equal(verdict.accepted, false);
  assert.match(verdict.reason, /TEST_DESIGN_ONLY_NOT_EXECUTABLE/);
});

test('Markdown automation requires current protected author evidence and independent V execution', async()=>{
  const {context,entry}=await managedProtocolEntry();context.authoringExecutions=['author-execution'];context.authoringPrincipals=['author-principal'];
  const source=entry.sourcePacket.collection;
  const review={ok:true,sufficient:true,evidenceDigest:sha('independent-review'),envelopeDigest:entry.digest,
    reportDigest:source.reportDigest,actionDigest:source.actionDigest,execution:entry.execution,principal:source.source.facts.principal};
  const inputs=managedInputsFixture();inputs.testContract.sourceReadiness='design_only';inputs.testContract.requiredChecks[0].mode='automated';
  inputs.testContract.dependencyBaselines.push({kind:'domain-cases/v1:testpack',digest:sha('testpack')});
  const promotion={ok:true,kind:'verified-domain-automation',runId:'run-1',inputDigest:INPUT,policyDigest:POLICY_DIGEST,
    contractDigest:envelopeDigest(inputs.testContract),testPackDigest:sha('testpack'),caseIds:['c1'],authorExecution:'author-execution',
    authorPrincipal:'author-principal',selfCheckDigest:sha('author-selfcheck'),automationMapDigest:sha('automation-map'),designReviewDigest:sha('design-review'),
    sourceQualified:true,managedClosureEligible:false,designReviewRunId:'run-1',designReviewContractDigest:envelopeDigest(inputs.testContract),
    designReviewActionId:'run-1:test-design',designReviewerExecution:'design-reviewer',designReviewerPrincipal:'design-reviewer-principal',
    qualification:{id:'author-source',sourceId:'author-host',revision:'1',scope:'protected-source',status:'qualified',expiresAt:'2026-11-01T00:00:00.000Z',evidenceRefs:[{ref:'author-event',digest:sha('source-event')}]}};
  context.domainAutomation=structuredClone(promotion);
  const base={verifyGateInputs:()=>true,admissionOptionsFor:()=>context,verifyReview:()=>review,readSourcePacket:()=>entry.sourcePacket};
  const request={run:{runId:'run-1'},action:{id:'fixture',stepId:'classic.extension.V'},outcome:{output:{gateEvidence:{gate:'V',inputs,receipts:[entry],policy:POLICY}}}};
  const validate=async ports=>(await createBindings({manifest:{bindings:[]},skills:new Map(),createSkillExecutor:x=>x},ports)).validators.find(v=>v.id==='sdd.delivery.gate.v').validate(request);
  assert.equal((await validate(base)).accepted,false,'missing protected author source must refuse');
  const hosted=await validate({...base,verifyDomainAutomation:()=>promotion});assert.equal(hosted.accepted,false,'hosted promotion remains closed until native T and receipt readback are implemented');
  const options={requireManaged:true,currentRunId:'run-1',currentGate:'V',admissionOptionsFor:()=>context,verifyReview:()=>review,verifyDomainAutomation:()=>promotion};
  const judged=evaluate(inputs,[entry],POLICY,options);assert.equal(judged.verdict,'pass');
  for(const digest of [promotion.selfCheckDigest,promotion.automationMapDigest,promotion.designReviewDigest,envelopeDigest(promotion)]) assert.ok(judged.receipt.evidence.includes(digest));
  for(const bad of [{...promotion,runId:'other'}, {...promotion,contractDigest:sha('stale')},{...promotion,testPackDigest:sha('other')},
    {...promotion,inputDigest:sha('changed')},{...promotion,policyDigest:sha('other')},{...promotion,caseIds:['other']},
    {...promotion,selfCheckDigest:'missing'},{...promotion,automationMapDigest:'missing'},{...promotion,designReviewDigest:'missing'},
    {...promotion,selfCheckDigest:sha('other-valid')},{...promotion,automationMapDigest:sha('other-valid')},{...promotion,designReviewDigest:sha('other-valid')},
    {...promotion,sourceQualified:false},{...promotion,managedClosureEligible:true},
    {...promotion,qualification:{...promotion.qualification,status:'unqualified'}},
    {...promotion,qualification:{...promotion.qualification,expiresAt:'2026-01-01T00:00:00.000Z'}},
    {...promotion,designReviewerPrincipal:'author-principal'}, {...promotion,designReviewerExecution:'author-execution'},
    {...promotion,designReviewRunId:'other'},{...promotion,designReviewContractDigest:sha('stale')},
    {...promotion,authorExecution:entry.execution},{...promotion,authorPrincipal:source.source.facts.principal}]) {
    assert.equal(evaluate(inputs,[entry],POLICY,{...options,verifyDomainAutomation:()=>bad}).verdict,'blocked');
  }
  assert.equal((await validate({...base,verifyDomainAutomation:()=>Promise.resolve(promotion)})).accepted,false);
  const forged=structuredClone(request);forged.outcome.output.gateEvidence.options={verifyDomainAutomation:()=>promotion};
  const withoutHost=(await createBindings({manifest:{bindings:[]},skills:new Map(),createSkillExecutor:x=>x},base)).validators.find(v=>v.id==='sdd.delivery.gate.v');
  assert.equal((await withoutHost.validate(forged)).accepted,false,'worker options cannot promote their own design');
  const missingAuthor={...base,admissionOptionsFor:()=>({...context,authoringExecutions:[],authoringPrincipals:[]}),verifyDomainAutomation:()=>promotion};
  assert.equal((await validate(missingAuthor)).accepted,false,'unknown author must not establish independent verification');
  const selfReviewed={...promotion,designReviewerExecution:'another-author',designReviewerPrincipal:'another-author-principal'};
  const multiAuthor={...context,authoringExecutions:['author-execution','another-author'],authoringPrincipals:['author-principal','another-author-principal'],domainAutomation:selfReviewed};
  assert.equal((await validate({...base,admissionOptionsFor:()=>multiAuthor,verifyDomainAutomation:()=>selfReviewed})).accepted,false,'another author cannot independently review their shared design');
});

test('approved manual design needs protected current approval and independent manual observations', async()=>{
  // This exercises the source-port protocol only. The process-backed fixture
  // explicitly simulates a manual observation and is not a human acceptance.
  const {context,entry}=await managedProtocolEntry(1,{observationMethod:'manual'});
  context.authoringExecutions=['test-author'];context.authoringPrincipals=['author-principal'];
  const inputs=managedInputsFixture();
  inputs.testContract.sourceReadiness='design_only';
  inputs.testContract.dependencyBaselines.push({kind:'domain-cases/v1:testpack',digest:sha('testpack')});
  inputs.testContract.requiredChecks[0].mode='manual';
  const source=entry.sourcePacket.collection;
  const review={ok:true,sufficient:true,evidenceDigest:sha('manual-independent-review'),envelopeDigest:entry.digest,
    reportDigest:source.reportDigest,actionDigest:source.actionDigest,execution:entry.execution,principal:source.source.facts.principal};
  const approval={ok:true,authority:'human',principal:'authorized-owner',runId:'run-1',inputDigest:INPUT,policyDigest:POLICY_DIGEST,
    contractDigest:envelopeDigest(inputs.testContract),caseIds:['c1'],evidenceDigest:sha('manual-approval')};
  const base={verifyGateInputs:()=>true,admissionOptionsFor:()=>context,verifyReview:()=>review,readSourcePacket:()=>entry.sourcePacket};
  const factory={manifest:{bindings:[]},skills:new Map(),createSkillExecutor:x=>x};
  const request={run:{runId:'run-1'},action:{id:'fixture',stepId:'classic.extension.V'},
    outcome:{output:{gateEvidence:{gate:'V',inputs,receipts:[entry],policy:POLICY}}}};
  const validate=async ports => (await createBindings(factory,ports)).validators.find(x=>x.id==='sdd.delivery.gate.v').validate(request);
  const result=await validate({...base,verifyManualApproval:()=>approval});
  assert.equal(result.accepted,true,result.reason);
  for (const rejected of [undefined, {...approval,runId:'other'}, {...approval,contractDigest:sha('stale')},
    {...approval,inputDigest:sha('old-input')}, {...approval,policyDigest:sha('old')}, {...approval,caseIds:['other']},
    {...approval,caseIds:['c1','c1']}, {...approval,evidenceDigest:'invalid'}, {...approval,authority:'agent'}]) {
    const verdict=await validate({...base,verifyManualApproval:()=>rejected});
    assert.equal(verdict.accepted,false,JSON.stringify(rejected));
  }
  const forged={...request,outcome:{output:{gateEvidence:{...request.outcome.output.gateEvidence,options:{verifyManualApproval:()=>approval}}}}};
  const validator=(await createBindings(factory,base)).validators.find(x=>x.id==='sdd.delivery.gate.v');
  assert.equal((await validator.validate(forged)).accepted,false,'worker options cannot approve their own manual scope');
  assert.equal((await validate({...base,verifyManualApproval:()=>({...approval,principal:'unit-process-principal'})})).accepted,true,
    'an authorized human distinct from authors and builder may also independently execute the manual case');
  assert.equal((await validate({...base,verifyManualApproval:()=>({...approval,principal:'author-principal'})})).accepted,true,
    'an authorized human may approve their own authored cases when a different verifier executes them');
  const unknownAuthors=(await createBindings(factory,{...base,admissionOptionsFor:()=>({...context,authoringPrincipals:[]}),
    verifyManualApproval:()=>approval})).validators.find(x=>x.id==='sdd.delivery.gate.v');
  assert.equal((await unknownAuthors.validate(request)).accepted,false,'unknown authors cannot establish approver independence');
  const asynchronous=(await createBindings(factory,{...base,verifyManualApproval:()=>Promise.resolve(approval)})).validators.find(x=>x.id==='sdd.delivery.gate.v');
  assert.equal((await asynchronous.validate(request)).accepted,false,'asynchronous approval is not a protected readback');
  const automated=structuredClone(request);
  automated.outcome.output.gateEvidence.inputs.testContract.requiredChecks[0].mode='automated';
  const currentApproval={...approval,contractDigest:envelopeDigest(automated.outcome.output.gateEvidence.inputs.testContract)};
  const automaticValidator=(await createBindings(factory,{...base,verifyManualApproval:()=>currentApproval})).validators.find(x=>x.id==='sdd.delivery.gate.v');
  assert.equal((await automaticValidator.validate(automated)).accepted,false,'approval of manual cases cannot waive an automated check');
  const noMethod=await managedProtocolEntry();
  const noMethodSource=noMethod.entry.sourcePacket.collection;
  const noMethodReview={...review,envelopeDigest:noMethod.entry.digest,reportDigest:noMethodSource.reportDigest,
    actionDigest:noMethodSource.actionDigest,execution:noMethod.entry.execution,principal:noMethodSource.source.facts.principal};
  const noMethodContext={...noMethod.context,authoringExecutions:['test-author'],authoringPrincipals:['author-principal']};
  const noMethodPorts={...base,admissionOptionsFor:()=>noMethodContext,verifyReview:()=>noMethodReview,
    readSourcePacket:()=>noMethod.entry.sourcePacket,verifyManualApproval:()=>approval};
  const noMethodRequest={...request,outcome:{output:{gateEvidence:{...request.outcome.output.gateEvidence,receipts:[noMethod.entry]}}}};
  const noMethodValidator=(await createBindings(factory,noMethodPorts)).validators.find(x=>x.id==='sdd.delivery.gate.v');
  assert.equal((await noMethodValidator.validate(noMethodRequest)).accepted,false,'unqualified observation method is not manual execution');
});

test('SDK JSON receipt needs protected current-Run raw readback; forged worker bytes never prove source', async()=>{
  const packet=await managedProtocolEntry();const {context,entry}=packet;const source=entry.sourcePacket.collection;
  const review={ok:true,sufficient:true,evidenceDigest:sha('protocol-only-review'),envelopeDigest:entry.digest,reportDigest:source.reportDigest,actionDigest:source.actionDigest,execution:entry.execution,principal:source.source.facts.principal};
  const provider={verifyGateInputs:({run,gate,inputs,policy})=>run.runId==='run-1' && gate==='V' && inputs.inputDigest===INPUT && policy.digest===POLICY_DIGEST,
    admissionOptionsFor:()=>context,verifyReview:()=>review,readSourcePacket:({run,gate})=>run.runId==='run-1' && gate==='V' ? entry.sourcePacket : null};
  const wire=JSON.parse(JSON.stringify(entry));
  // An attacker supplies unrelated bytes on the JSON channel. Only the fake
  // protected readback has the actual packet. This is a protocol fixture,
  // not evidence that a real source or human permission exists.
  wire.sourcePacket.reportBytes={'0':255};
  const evidence={gate:'V',inputs:managedInputsFixture(),receipts:[wire],policy:POLICY,options:{requireManaged:false}};
  const originalWire=JSON.stringify(evidence);
  const deepFreeze=x=>{if(x && typeof x==='object'){Object.values(x).forEach(deepFreeze);Object.freeze(x);}return x;};
  deepFreeze(evidence);
  const factory={manifest:{bindings:[]},skills:new Map(),createSkillExecutor:x=>x};
  const v=async(ports)=> (await createBindings(factory,ports)).validators.find(x=>x.id==='sdd.delivery.gate.v');
  const input={run:{runId:'run-1'},action:{id:'fixture',stepId:'classic.extension.V'},outcome:{output:{gateEvidence:evidence}}};
  assert.equal((await (await v(provider)).validate(input)).accepted,true,'synthetic raw readback must survive SDK JSON outcome');
  assert.equal((await (await v(provider)).validate(input)).accepted,true,'identical revalidation re-reads the source');
  assert.equal((await (await v(provider)).validate({...input,action:{...input.action,status:'succeeded'}})).accepted,true,'synthetic history-shaped recheck re-reads without changing receipt');
  assert.equal(JSON.stringify(evidence),originalWire,'validator must not alter immutable SDK outcome');
  // Recovery readback is allowed only when the owning Run's protected
  // projection identifies this exact already-consumed receipt. This is a
  // protocol fixture, not a real cold-restart or archive test.
  const recordedContext={...context,acceptedEntry:wire,consumedCollections:[entry.collectionId],issuedExecutions:[entry.execution]};
  assert.equal((await (await v({...provider,admissionOptionsFor:()=>recordedContext})).validate(input)).accepted,true,'same already-recorded receipt may be revalidated');
  for(const [name,current,reason] of [
    ['missing consumed collection',{...recordedContext,consumedCollections:[]},/RECOVERY_REQUIRED/],
    ['missing issued execution',{...recordedContext,issuedExecutions:[]},/RECOVERY_REQUIRED/],
    ['different accepted entry',{...recordedContext,acceptedEntry:{...entry,digest:sha('forged-entry')}},/RECOVERY_REQUIRED/],
    ['unrecorded replay',{...recordedContext,acceptedEntry:undefined},/REPLAYED_COLLECTION/],
  ]) {
    const check=await (await v({...provider,admissionOptionsFor:()=>current})).validate(input);
    assert.equal(check.accepted,false,`${name} must not reuse the source collection`);assert.match(check.reason,reason,name);
  }
  for (const ports of [
    {...provider,readSourcePacket:undefined},
    {...provider,readSourcePacket:()=>null},
    {...provider,readSourcePacket:()=>Promise.resolve(entry.sourcePacket)},
    {...provider,readSourcePacket:()=>Promise.reject(new Error('unqualified readback'))},
    {...provider,readSourcePacket:()=>({...entry.sourcePacket,reportBytes:new Uint8Array([0])})},
    {...provider,readSourcePacket:()=>({...entry.sourcePacket,dispatch:{...entry.dispatch,run:'other-run'}})},
    {...provider,readSourcePacket:()=>({...entry.sourcePacket,collection:{...entry.sourcePacket.collection,collectionId:sha('other')}})},
    {...provider,verifyReview:()=>({ok:false})},
  ]) assert.equal((await (await v(ports)).validate(input)).accepted,false,'wrong or unavailable host source must block');
  assert.equal((await (await v(provider)).validate({...input,run:{runId:'other-run'}})).accepted,false);
  await new Promise(resolve=>setImmediate(resolve));
});

test('SDK-shaped unfrozen outcome and Run cannot be mutated by protected-source callbacks',async()=>{
 const {context,entry}=await managedProtocolEntry();const source=entry.sourcePacket.collection;
 const review={ok:true,sufficient:true,evidenceDigest:sha('protocol-only-review'),envelopeDigest:entry.digest,reportDigest:source.reportDigest,actionDigest:source.actionDigest,execution:entry.execution,principal:source.source.facts.principal};
 const factory={manifest:{bindings:[]},skills:new Map(),createSkillExecutor:x=>x};
 const createInput=()=>({run:{runId:'run-1',state:{checkEpoch:3}},action:{id:'fixture',stepId:'classic.extension.V',attempt:1},outcome:{output:{gateEvidence:{gate:'V',inputs:managedInputsFixture(),receipts:[JSON.parse(JSON.stringify(entry))],policy:{...POLICY}}}}});
 const base={verifyGateInputs:()=>true,readSourcePacket:()=>entry.sourcePacket,admissionOptionsFor:()=>context,verifyReview:()=>review};
 const probes=[
  ['input-check', {...base,verifyGateInputs:({run,action,inputs,policy})=>{run.runId='evil';action.id='evil';inputs.testContract.cases[0].id='evil';policy.digest=sha('evil');return true;}}],
  ['source-read', {...base,readSourcePacket:({run,action,entry:worker})=>{run.runId='evil';action.id='evil';worker.dispatch.run='evil';worker.envelope.caseId='evil';return entry.sourcePacket;}}],
  ['admission', {...base,admissionOptionsFor:submitted=>{submitted.dispatch.run='evil';submitted.envelope.caseId='evil';return context;}}],
  ['review', {...base,verifyReview:({entry:admitted,inputs,policy})=>{admitted.envelope.caseId='evil';inputs.testContract.cases[0].id='evil';policy.digest=sha('evil');return review;}}],
 ];
 for(const [name,ports] of probes) {
  const input=createInput(), before=JSON.stringify(input);
  const validator=(await createBindings(factory,ports)).validators.find(v=>v.id==='sdd.delivery.gate.v');
  const result=await validator.validate(input);
  assert.equal(JSON.stringify(input),before,`${name} must not mutate original SDK snapshots`);
  assert.equal(result.accepted,true,`${name} mutations must not affect the verified frozen inputs`);
  assert.equal((await validator.validate(input)).accepted,true,`${name} repeat remains stable`);
  assert.equal(JSON.stringify(input),before,`${name} repeat must remain side-effect free`);
 }
 const input=createInput(),before=JSON.stringify(input);
 const failure=(await createBindings(factory,{...base,readSourcePacket:({run,action,entry:worker})=>{run.runId='evil';action.id='evil';worker.dispatch.run='evil';return null;}})).validators.find(v=>v.id==='sdd.delivery.gate.v');
 assert.equal((await failure.validate(input)).accepted,false);
 assert.equal(JSON.stringify(input),before,'refused readback must not mutate SDK input');
});

test('SDK recorded wire acceptedEntry revalidates only with exact owning-Run source and complete replay projection',async(t)=>{
 const {context,entry}=await managedProtocolEntry();const source=entry.sourcePacket.collection;
 const review={ok:true,sufficient:true,evidenceDigest:sha('wire-review'),envelopeDigest:entry.digest,reportDigest:source.reportDigest,actionDigest:source.actionDigest,execution:entry.execution,principal:source.source.facts.principal};
 const wire=JSON.parse(JSON.stringify(entry));wire.sourcePacket.reportBytes={'0':255};
 const frozenRecord=JSON.parse(JSON.stringify(wire));
 const base={verifyGateInputs:({run,gate})=>run.runId==='run-1' && gate==='V',readSourcePacket:()=>entry.sourcePacket,
   admissionOptionsFor:()=>({...context,acceptedEntry:frozenRecord,consumedCollections:[entry.collectionId],issuedExecutions:[entry.execution]}),verifyReview:()=>review};
 const evidence={gate:'V',inputs:managedInputsFixture(),receipts:[wire],policy:{...POLICY}};
 const factory={manifest:{bindings:[]},skills:new Map(),createSkillExecutor:x=>x};
 const validator=(await createBindings(factory,base)).validators.find(x=>x.id==='sdd.delivery.gate.v');
 const input={run:{runId:'run-1',state:{checkEpoch:2}},action:{id:'fixture',stepId:'classic.extension.V',status:'succeeded'},outcome:{output:{gateEvidence:evidence}}};
 const before=JSON.stringify(input);
 const same=await validator.validate(input);
 assert.equal(same.accepted,true,`same recorded wire must revalidate: ${same.reason}`);
 assert.equal((await validator.validate(input)).accepted,true,'repeat must be stable');
 assert.equal(JSON.stringify(input),before,'SDK recorded outcome must not be mutated');
 const altered=structuredClone(input);altered.outcome.output.gateEvidence.receipts[0].sourcePacket.reportBytes={'0':123};
 assert.equal((await validator.validate(altered)).accepted,false,'modified historical wire is not the recorded acceptedEntry');
 const stale=structuredClone(input);stale.action.status='running';stale.action.input={activation:{source:{checkEpoch:1,event:{kind:'action-outcome'}}}};
 assert.equal((await validator.validate(stale)).accepted,false,'old activation epoch cannot be re-used');
 t.diagnostic('fixture: acceptedEntry=exact SDK wire; consumedCollections=[collectionId]; issuedExecutions=[execution]; modified wire and stale checkEpoch refused');
});

test('synthetic host gets current action, claim, attempt and epoch and rejects each mismatch',async()=>{
 const {context,entry}=await managedProtocolEntry();const source=entry.sourcePacket.collection;
 const review={ok:true,sufficient:true,evidenceDigest:sha('protected-review'),envelopeDigest:entry.digest,reportDigest:source.reportDigest,actionDigest:source.actionDigest,execution:entry.execution,principal:source.source.facts.principal};
 const factory={manifest:{bindings:[]},skills:new Map(),createSkillExecutor:x=>x};
 const input={run:{runId:'run-1',state:{checkEpoch:7}},action:{id:'gate-action-1',attempt:2,claim:{executorId:'fixture-host',token:'synthetic-claim'}},outcome:{output:{gateEvidence:{gate:'V',inputs:managedInputsFixture(),receipts:[JSON.parse(JSON.stringify(entry))],policy:{...POLICY}}}}};
 const ports={
  verifyGateInputs:({run,action,gate})=>run.runId==='run-1' && run.state.checkEpoch===7 && gate==='V' && action.id==='gate-action-1' && action.attempt===2 && action.claim.executorId==='fixture-host' && action.claim.token==='synthetic-claim',
  readSourcePacket:({run,action,gate})=>run.runId==='run-1' && run.state.checkEpoch===7 && gate==='V' && action.id==='gate-action-1' && action.attempt===2 && action.claim.token==='synthetic-claim' ? entry.sourcePacket : null,
  admissionOptionsFor:()=>context,verifyReview:()=>review
 };
 const v=(await createBindings(factory,ports)).validators.find(x=>x.id==='sdd.delivery.gate.v');
 assert.equal((await v.validate(input)).accepted,true,'synthetic current action and source must pass');
 for(const patch of [
  {action:{...input.action,id:'other-action'}},
  {action:{...input.action,attempt:3}},
  {action:{...input.action,claim:{...input.action.claim,token:'other-claim'}}},
  {run:{...input.run,state:{checkEpoch:8}}},
 ]) assert.equal((await v.validate({...input,...patch})).accepted,false,'stale/mismatched current context must fail');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const { createBindings } = await import(process.env.P24_BASELINE_BINDINGS || '../integrations/comet/application/bindings.mjs');
import { createLaunchAuthority, admitEvidence } from '../lib/delivery/evidence.js';
import { evaluate } from '../lib/delivery/gate.js';

const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const current = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const composition = JSON.parse(fs.readFileSync(path.join(current,'integrations/comet/application/composition.json')));
function canonicalize(v) { if (Array.isArray(v)) return v.map(canonicalize); if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k => [k,canonicalize(v[k])])); return v; }
export function fixture(options, gate = 'R') {
  const inputDigest=sha('candidate'); const policyDigest=sha('policy');
  const authority=createLaunchAuthority({secret:crypto.randomBytes(32).toString('hex')});
  const dispatch=authority.issueDispatch({runnerId:'runner-1',run:'synthetic-run',gate,inputDigest,policyDigest,attempt:1,epoch:1,role:'verifier',execution:'verify-1'});
  const envelope={schemaVersion:1,candidateDigest:inputDigest,caseId:'c1',check:'unit:node:test',origin:{kind:'registered-runner',id:'runner-1'},execution:{id:'verify-1'},environment:'synthetic',toolchain:'node',executions:{total:1,valid:1},result:'pass',evidence:[{uri:'proof.txt',sha256:sha('proof')}],expiry:'2026-11-26T00:00:00.000Z'};
  const admission=admitEvidence({envelope,dispatch,authority,current:{inputDigest,policyDigest,environment:'synthetic'},now:'2026-10-26T12:00:00.000Z'}); assert.equal(admission.ok,true,admission.reason);
  const inputs={inputDigest,builderExecution:'builder-1',testContract:{schemaVersion:1,project:'project',change:'change',cases:[{id:'c1',ac:'A1',oracle:'observed output equals expected'}],requiredChecks:[{level:'unit',capability:'unit:node:test'}],executionDenominator:{totalCases:1},cleanup:{environment:'cleaned',data:'none'},dependencyBaselines:[{kind:'product',digest:sha('product')}]}};
  const policy={ref:'policy',digest:policyDigest}; const receipts=[admission.entry]; const evidence={gate,inputs,receipts,policy,...options};
  const verdict=evaluate(inputs,receipts,policy); assert.equal(verdict.verdict,'pass');
  const extension=composition.composition.extensions.find(e=>e.validator.id===`sdd.delivery.gate.${gate.toLowerCase()}`); const artifactRef=extension.artifactRefs[0];
  const bundle={schema:'sdd.delivery.gate.receipt-bundle.v1',kind:'gate-receipt-bundle',gate,artifactRef,hashBinding:'artifactHashes',writtenBy:'extension-execution',inputs,receipts,policy,evaluatedBy:`sdd.delivery.gate.${gate.toLowerCase()}@1 (packaged bindings -> lib/delivery/gate.js evaluate)`,verdict:verdict.verdict,receipt:verdict.receipt};
  const artifactHashes={[artifactRef]:sha(Buffer.from(JSON.stringify(canonicalize(bundle),null,2)+'\n'))};
  return {run:{runId:'synthetic-run'},action:{id:'a',stepId:`classic.extension.${gate}`},outcome:{actionId:'a',status:'succeeded',output:{verdict:'pass',sourceHash:'domain-checked',artifactHashes,gateEvidence:evidence}}};
}
const context={manifest:{bindings:[]},skills:new Map(),createSkillExecutor: x=>x};
test('R is anchored after the native confirmation and rejects stale confirmed artifacts before host admission',async()=>{
  const spec=composition.composition.extensions.find(x=>x.id==='requirements-open');
  assert.equal(spec.afterStep,'full.open.revalidate','R must reuse Comet\'s native Open confirmation');
  const digest=sha('requirements');const ref='openspec/changes/synthetic';
  const original={id:'run:r',stepId:'full.open.revalidate',status:'succeeded',outcome:{actionId:'run:r',status:'succeeded',claimToken:'fixture',output:{contentHash:digest}}};
  const run={runId:'synthetic-run',input:{change:'synthetic',changeDir:ref},actions:[original],
    outputs:{'full.open.evidence':{value:{ref,contentHash:digest}},'full.open.confirm':{value:{choice:'approved',proposal:{outputs:{'full.open.evidence':{ref,contentHash:digest}}}}}}};
  const action={id:'run:gate',input:{activation:{source:{event:{kind:'action-outcome',stepId:'full.open.revalidate',outcome:{...original.outcome,claimToken:'source-reference'}}}}}};
  const request={run,action,outcome:{output:{verdict:'pass',gateEvidence:{gate:'R',inputs:{},receipts:[],policy:{}}}}};
  let hostCalls=0;const host={verifyGateInputs:()=>{hostCalls++;return false;},admissionOptionsFor:()=>null,verifyReview:()=>null};
  const v=(await createBindings(context,host)).validators.find(x=>x.id==='sdd.delivery.gate.r');
  for(const bad of [
    {...request,run:{...run,outputs:{}}},
    {...request,run:{...run,outputs:{...run.outputs,'full.open.confirm':{value:{...run.outputs['full.open.confirm'].value,choice:'rejected'}}}}},
    {...request,run:{...run,outputs:{...run.outputs,'full.open.evidence':{value:{ref,contentHash:sha('changed')}}}}},
    {...request,action:{...action,input:{activation:{source:{event:{kind:'evidence-recorded',stepId:'full.open.evidence'}}}}}},
  ]) {const result=await v.validate(bad);assert.equal(result.accepted,false);assert.match(result.reason,/native Open confirmation/i);}
  assert.equal(hostCalls,0,'invalid native confirmation must not reach source admission');
  const result=await v.validate(request);assert.equal(result.accepted,false);assert.match(result.reason,/protected Run/);assert.equal(hostCalls,1);
});
test('hosted validators reject component evidence regardless of worker options', async()=>{
  const b=await createBindings(context);
  for (const gate of ['R','A','T','P','V','Kp']) {
    const validator=b.validators.find(v=>v.id===`sdd.delivery.gate.${gate.toLowerCase()}`);
    assert.ok(validator,gate);
    for (const options of [{},{options:{requireManaged:false}},{options:{requireManaged:true}}]) assert.equal((await validator.validate(fixture(options,gate))).accepted,false,gate);
  }
});
test('repository component evaluation remains available, without managed closure',async()=>{
  const b=await createBindings();const v=b.validators.find(x=>x.id==='sdd.delivery.gate.r');assert.equal((await v.validate(fixture({}))).accepted,true);
});
test('protected gate input port rejects asynchronous results without crashing or invoking thenables', (t) => {
  // Run under strict unhandled-rejection semantics so an observed validator
  // refusal cannot hide a subsequent process crash. No models or real Run.
  const moduleUri = process.env.P24_BINDING_MODULE || new URL('../integrations/comet/application/bindings.mjs', import.meta.url).href;
  const script = `
    import assert from 'node:assert/strict';
    import vm from 'node:vm';
    import { createBindings } from ${JSON.stringify(moduleUri)};
    const ctx={manifest:{bindings:[]},skills:new Map(),createSkillExecutor:x=>x};
    const input={run:{runId:'synthetic'},action:{id:'a'},outcome:{output:{gateEvidence:{gate:'R',inputs:{},receipts:[],policy:{}}}}};
    let touched=0;
    const thenable={get then(){touched++;throw Error('thenable getter must not run');}};
    const callableThenable={then(){touched++;throw Error('thenable method must not run');}};
    const cases=[
      ['native-resolve',()=>Promise.resolve(true),'protected'],
      ['native-reject',()=>Promise.reject(Error('native reject')),'protected'],
      ['native-overridden-then',()=>{const p=Promise.reject(Error('override reject'));p.then=()=>{touched++;throw Error('overridden then');};return p;},'protected'],
      ['realm-resolve',()=>vm.runInNewContext('Promise.resolve(true)'),'protected'],
      ['realm-reject',()=>vm.runInNewContext('Promise.reject(new Error("realm reject"))'),'protected'],
      ['thenable-getter',()=>thenable,'protected'],
      ['thenable-method',()=>callableThenable,'protected'],
      ['sync-false',()=>false,'protected'],
      ['sync-throw',()=>{throw Error('sync failure')},'sync failure'],
      ['sync-true',()=>true,'INVALID_INPUTS'],
    ];
    for(const [name,verify,expected] of cases.filter(([name])=>!process.env.P24_CASE || name===process.env.P24_CASE)) {
      const b=await createBindings(ctx,{verifyGateInputs:verify,admissionOptionsFor:()=>({}),verifyReview:()=>false});
      const verdict=await b.validators.find(x=>x.id==='sdd.delivery.gate.r').validate(input);
      assert.equal(verdict.accepted,false,name);
      assert.match(verdict.reason,new RegExp(expected),name);
    }
    assert.equal(touched,0,'thenable getter must not be read');
    await new Promise(resolve=>setImmediate(resolve));
    console.log(JSON.stringify({cases:cases.map(x=>x[0]),thenableTouches:touched}));
  `;
  const result=spawnSync(process.execPath,['--unhandled-rejections=strict','--input-type=module','-e',script],{cwd:current,encoding:'utf8'});
  assert.equal(result.status,0,`strict child failed: ${result.stderr}`);
  assert.equal(JSON.parse(result.stdout).thenableTouches,0);
  t.diagnostic(result.stdout.trim());
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {envelopeDigest} from '../lib/delivery/evidence.js';
const script=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../tools/comet/phase-entry.mjs');
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'phase-entry-')); const bindir=path.join(root,'bin');fs.mkdirSync(bindir);const log=path.join(root,'calls');const data=path.join(root,'run.json');
 fs.mkdirSync(path.join(root,'.comet'));fs.writeFileSync(path.join(root,'.comet/current-change.json'),JSON.stringify({workflow:'application',applicationId:'sdd-managed-delivery',change:'fixture-change'}));
 const state={protocolVersion:1,runId:'fixture-change',revision:7,workflow:{id:'comet-classic-full',version:'1'},state:{phase:'open'},status:'running',current:{actions:[{id:'fixture-change:3',stepId:'full.open',status:'pending'}],waits:[],evidenceWaits:[]}};fs.writeFileSync(data,JSON.stringify(state));
 const fake=path.join(bindir,'comet');fs.writeFileSync(fake,`#!/bin/bash\nif [ "$1" = --version ];then printf '0.5.1\\n';exit 0;fi\nwhile [ "$#" -gt 0 ];do if [ "$1" = --request ];then shift; request=$1;fi;shift;done\nexec '${process.execPath}' -e 'const fs=require("fs");const r=JSON.parse(fs.readFileSync(process.argv[1]));fs.appendFileSync(process.env.FAKE_LOG,JSON.stringify(r)+"\\n");if(r.operation==="next"&&process.env.FAKE_NEXT_FAIL){process.stdout.write(JSON.stringify({status:"failed",error:{code:"REVISION_CONFLICT",message:"revision changed"}}));process.exit(65)}let data=JSON.parse(fs.readFileSync(process.env.FAKE_RUN));if(r.operation==="next"&&process.env.FAKE_NEXT_TRANSITION){data={...data,revision:data.revision+1,state:{phase:"design"},current:{actions:[{id:"fixture-change:4",stepId:"full.design.handoff",status:"pending"}],waits:[],evidenceWaits:[]}};fs.writeFileSync(process.env.FAKE_RUN,JSON.stringify(data));if(process.env.FAKE_NEXT_UNKNOWN){process.stdout.write("truncated");process.exit(0)}}if(r.operation==="inspect"&&process.env.FAKE_INSPECT_CONFLICT&&data.state.phase==="design"){process.stdout.write(JSON.stringify({status:"failed",error:{code:"REVISION_CONFLICT",message:"inspect conflict"}}));process.exit(65)}if(r.operation==="inspect"&&process.env.FAKE_READBACK_FAIL&&data.state.phase==="design"){process.stdout.write("unreadable");process.exit(0)}const result=r.operation==="next"?{runId:data.runId,revision:data.revision,workflow:data.workflow,status:data.status,current:data.current}:data;process.stdout.write(JSON.stringify({status:"succeeded",application:{id:"sdd-managed-delivery",contentHash:"fixture-content"},skillWork:[{actionId:"fixture-change:3",skill:{id:"comet-open-full-open",root:"/fixture/skill",contentHash:"fixture-skill-hash"}}],data:result}));' "$request"\n`,{mode:0o755});
 const call=(stage,args=[],extraEnv={})=>spawnSync(process.execPath,[script,stage,'--run-id','fixture-change','--project-root',root,...args],{encoding:'utf8',env:{...process.env,PATH:bindir,FAKE_LOG:log,FAKE_RUN:data,...extraEnv},timeout:5000});
 return {root,data,log,state,call,cleanup:()=>fs.rmSync(root,{recursive:true,force:true})};
}
test('open entry reads and returns current application Run and action',()=>{const f=fixture();try{const r=f.call('/comet-open');assert.equal(r.status,0,r.stderr);const out=JSON.parse(r.stdout);assert.equal(out.runId,'fixture-change');assert.equal(out.phase,'open');assert.equal(out.current.actions[0].stepId,'full.open');}finally{f.cleanup();}});

test('Open displays the exact native confirmation question without advancing its pending wait',()=>{const f=fixture();try{
 const ref='openspec/changes/fixture-change',evidence={ref,contentHash:'a'.repeat(64)};
 const proposal={outputs:{'full.open.evidence':evidence}},wait={id:'fixture-change:5',stepId:'full.open.confirm',status:'pending',sequence:5,
  proposal,proposalHash:envelopeDigest(proposal),choices:['approved','rejected'],results:{'full.open.evidence':{sequence:4,value:evidence}}};
 const state={...f.state,input:{change:'fixture-change',changeDir:ref},outputs:{'full.open.evidence':{sequence:4,value:evidence}},waits:[wait],current:{actions:[],waits:[wait],evidenceWaits:[]}};
 fs.writeFileSync(f.data,JSON.stringify(state));
 const r=f.call('/comet-open',['--continue']);assert.equal(r.status,0,r.stderr);const out=JSON.parse(r.stdout);
 assert.equal(out.blocked,true);assert.equal(out.confirmationPrompt.waitId,wait.id);
 assert.deepEqual(out.confirmationPrompt.options,['确认需求并继续审查','退回需求澄清']);
 assert.ok(out.confirmationPrompt.title.includes(wait.proposalHash));
 assert.deepEqual(fs.readFileSync(f.log,'utf8').trim().split('\n').map(JSON.parse).map(x=>x.operation),['inspect']);
}finally{f.cleanup();}});

test('an inconsistent native Open wait fails closed before any progression',()=>{const f=fixture();try{
 const ref='openspec/changes/fixture-change',evidence={ref,contentHash:'a'.repeat(64)};
 const proposal={outputs:{'full.open.evidence':evidence}},wait={id:'fixture-change:5',stepId:'full.open.confirm',status:'pending',sequence:5,
  proposal,proposalHash:'b'.repeat(64),choices:['approved','rejected'],results:{'full.open.evidence':{sequence:4,value:evidence}}};
 const state={...f.state,input:{change:'fixture-change',changeDir:ref},outputs:{'full.open.evidence':{sequence:4,value:evidence}},waits:[wait],current:{actions:[],waits:[wait],evidenceWaits:[]}};
 fs.writeFileSync(f.data,JSON.stringify(state));
 const r=f.call('/comet-open',['--continue']);assert.equal(r.status,2);assert.equal(JSON.parse(r.stderr).code,'OPEN_CONFIRMATION_UNAVAILABLE');
 assert.deepEqual(fs.readFileSync(f.log,'utf8').trim().split('\n').map(JSON.parse).map(x=>x.operation),['inspect']);
}finally{f.cleanup();}});

test('Open choice observation requires the real rooted host source and never advances on missing evidence',()=>{const f=fixture();try{
 const ref='openspec/changes/fixture-change',evidence={ref,contentHash:'a'.repeat(64)};
 const proposal={outputs:{'full.open.evidence':evidence}},wait={id:'fixture-change:5',stepId:'full.open.confirm',status:'pending',sequence:5,
  proposal,proposalHash:envelopeDigest(proposal),choices:['approved','rejected'],results:{'full.open.evidence':{sequence:4,value:evidence}}};
 fs.writeFileSync(f.data,JSON.stringify({...f.state,input:{change:'fixture-change',changeDir:ref},outputs:{'full.open.evidence':{sequence:4,value:evidence}},waits:[wait],current:{actions:[],waits:[wait],evidenceWaits:[]}}));
 const thread='01a15314-be07-77f2-b11d-93ad347f9420';
 const args=['--observe-open-call','call_0123456789abcdef','--session-path',`/private/tmp/fake-${thread}.jsonl`,'--answer','approved'];
 const r=f.call('/comet-open',args,{CODEX_THREAD_ID:thread});assert.equal(r.status,2);assert.equal(JSON.parse(r.stderr).code,'OPEN_CHOICE_SOURCE_UNAVAILABLE');
 assert.deepEqual(fs.readFileSync(f.log,'utf8').trim().split('\n').map(JSON.parse).map(x=>x.operation),['inspect']);
}finally{f.cleanup();}});

test('choice observation cannot be combined with progression or another phase',()=>{const f=fixture();try{
 const args=['--observe-open-call','call_0123456789abcdef','--session-path','/private/tmp/fake.jsonl','--answer','approved'];
 const r=f.call('/comet-open',[...args,'--continue']);assert.equal(r.status,2);assert.equal(JSON.parse(r.stderr).code,'INPUT_INVALID');assert.equal(fs.existsSync(f.log),false);
 const other=f.call('/comet-design',args);assert.equal(other.status,2);assert.equal(JSON.parse(other.stderr).code,'INPUT_INVALID');assert.equal(fs.existsSync(f.log),false);
 const invalid=f.call('/comet-open',[...args,'--question-index','3']);assert.equal(invalid.status,2);assert.equal(JSON.parse(invalid.stderr).code,'INPUT_INVALID');assert.equal(fs.existsSync(f.log),false);
}finally{f.cleanup();}});

test('choice observation cannot cross or recreate an unrelated Run selection',()=>{const f=fixture();try{
 const thread='01a15314-be07-77f2-b11d-93ad347f9420';
 const args=['--observe-open-call','call_0123456789abcdef','--session-path',`/private/tmp/fake-${thread}.jsonl`,'--answer','approved'];
 fs.writeFileSync(path.join(f.root,'.comet/current-change.json'),JSON.stringify({workflow:'application',applicationId:'sdd-managed-delivery',change:'other-run'}));
 const r=f.call('/comet-open',args,{CODEX_THREAD_ID:thread});assert.equal(r.status,2);assert.equal(JSON.parse(r.stderr).code,'CURRENT_SELECTION_EXISTS');assert.equal(fs.existsSync(f.log),false);
}finally{f.cleanup();}});

test('all five named entries accept only the matching current phase',()=>{const f=fixture();try{
 for(const phase of ['open','design','build','verify','archive']) {fs.writeFileSync(f.data,JSON.stringify({...f.state,state:{phase}}));const r=f.call('/comet-'+phase);assert.equal(r.status,0,phase+': '+r.stderr);assert.equal(JSON.parse(r.stdout).phase,phase);}
 const general=f.call('/comet');assert.equal(general.status,0);assert.equal(JSON.parse(general.stdout).phase,'archive');
}finally{f.cleanup();}});

test('wrong phase returns current action and never schedules next',()=>{const f=fixture();try{
 const r=f.call('/comet-design',['--continue']);assert.equal(r.status,2);const err=JSON.parse(r.stderr);assert.equal(err.code,'PHASE_MISMATCH');assert.equal(err.current.phase,'open');assert.equal(err.current.current.actions[0].stepId,'full.open');
 assert.deepEqual(fs.readFileSync(f.log,'utf8').trim().split('\n').map(JSON.parse).map(x=>x.operation),['inspect']);
}finally{f.cleanup();}});

test('continuation delegates once to Comet with current Run revision',()=>{const f=fixture();try{
 const r=f.call('/comet-open',['--continue']);assert.equal(r.status,0,r.stderr);const events=fs.readFileSync(f.log,'utf8').trim().split('\n').map(JSON.parse);assert.deepEqual(events.map(x=>x.operation),['inspect','next','inspect']);assert.equal(events[1].runId,'fixture-change');assert.equal(events[1].expectedRevision,7);assert.equal(JSON.parse(r.stdout).continuation,'comet-next');
}finally{f.cleanup();}});

test('waiting and running work are shown without redispatch',()=>{const f=fixture();try{
 for(const item of [{...f.state,status:'waiting',current:{actions:[],waits:[{id:'w1',stepId:'confirm',status:'pending'}],evidenceWaits:[]}},{...f.state,current:{actions:[{id:'a1',stepId:'full.open',status:'running'}],waits:[],evidenceWaits:[]}}]){
  fs.writeFileSync(f.data,JSON.stringify(item));const r=f.call('/comet-open',['--continue']);assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).blocked,true);assert.ok(JSON.parse(r.stdout).blockers.length>0);
 }
 assert.deepEqual(fs.readFileSync(f.log,'utf8').trim().split('\n').map(JSON.parse).map(x=>x.operation),['inspect','inspect']);
}finally{f.cleanup();}});

test('unknown entries and missing project identity are rejected',()=>{const f=fixture();try{const r=f.call('/comet-unknown',['--continue']);assert.equal(r.status,2);assert.equal(JSON.parse(r.stderr).code,'INPUT_INVALID');assert.equal(fs.existsSync(f.log),false);}finally{f.cleanup();}});

test('foreign Run or wrong workflow is never presented as current',()=>{const f=fixture();try{
 fs.writeFileSync(f.data,JSON.stringify({...f.state,runId:'other-run'}));const r=f.call('/comet-open',['--continue']);assert.equal(r.status,2);assert.equal(JSON.parse(r.stderr).code,'RUN_IDENTITY_MISMATCH');
 assert.deepEqual(fs.readFileSync(f.log,'utf8').trim().split('\n').map(JSON.parse).map(x=>x.operation),['inspect']);
}finally{f.cleanup();}});

test('pending Skill identity from Comet is exposed for the host without executing it',()=>{const f=fixture();try{
 const r=f.call('/comet-open');assert.equal(r.status,0,r.stderr);const out=JSON.parse(r.stdout);assert.deepEqual(out.skillWork,[{actionId:'fixture-change:3',skillId:'comet-open-full-open',root:'/fixture/skill',contentHash:'fixture-skill-hash'}]);
 assert.deepEqual(fs.readFileSync(f.log,'utf8').trim().split('\n').map(JSON.parse).map(x=>x.operation),['inspect']);
}finally{f.cleanup();}});

test('self-reported and stale extension passes remain unverified historical records',()=>{const f=fixture();try{
 const actions=[
  {id:'forged-review',stepId:'classic.extension.architecture-consensus',status:'succeeded',outcome:{output:{verdict:'pass'}}},
  {id:'stale-test-review',stepId:'classic.extension.test-design-review',status:'succeeded',outcome:{output:{verdict:'pass'}},input:{checkEpoch:1}},
 ];
 fs.writeFileSync(f.data,JSON.stringify({...f.state,state:{phase:'open',checkEpoch:9},actions}));
 const r=f.call('/comet-open');assert.equal(r.status,0,r.stderr);const out=JSON.parse(r.stdout);
 assert.deepEqual(out.recordedExtensions,[
  {id:'forged-review',stepId:'classic.extension.architecture-consensus',status:'succeeded',reportedVerdict:'pass',validity:'UNVERIFIED'},
  {id:'stale-test-review',stepId:'classic.extension.test-design-review',status:'succeeded',reportedVerdict:'pass',validity:'UNVERIFIED'},
 ]);
 assert.equal(out.blocked,false,'historical self-report must not manufacture the current blocker or passage');
 assert.deepEqual(out.blockers,[]);assert.ok(out.recordedExtensions.every(x=>!Object.hasOwn(x,'verdict')));
}finally{f.cleanup();}});

test('revision conflict stops after the single rejected next and does not retry',()=>{const f=fixture();try{
 const r=f.call('/comet-open',['--continue'],{FAKE_NEXT_FAIL:'1'});assert.equal(r.status,2);const err=JSON.parse(r.stderr);assert.equal(err.code,'RUNTIME_BLOCKED');assert.equal(err.runtimeCode,'REVISION_CONFLICT');assert.match(err.message,/revision changed/);
 assert.deepEqual(fs.readFileSync(f.log,'utf8').trim().split('\n').map(JSON.parse).map(x=>x.operation),['inspect','next']);
}finally{f.cleanup();}});

test('wrong external version cannot inspect or advance the Run',()=>{const f=fixture();try{
 const fake=path.join(f.root,'bin','comet');fs.writeFileSync(fake,'#!/bin/bash\nprintf "0.5.0\\n"\n',{mode:0o755});const r=f.call('/comet-open',['--continue']);assert.equal(r.status,2);assert.equal(JSON.parse(r.stderr).code,'COMET_VERSION_UNAVAILABLE');assert.equal(fs.existsSync(f.log),false);
}finally{f.cleanup();}});

test('Comet advancing Open to Design returns the new same-Run phase and action',()=>{const f=fixture();try{
 const r=f.call('/comet-open',['--continue'],{FAKE_NEXT_TRANSITION:'1'});assert.equal(r.status,0,r.stderr);const out=JSON.parse(r.stdout);assert.equal(out.runId,'fixture-change');assert.equal(out.revision,8);assert.equal(out.phase,'design');assert.equal(out.current.actions[0].stepId,'full.design.handoff');assert.deepEqual(out.transition,{from:'open',to:'design'});
}finally{f.cleanup();}});

test('lost next output marks UNKNOWN and reads back the same Run without retry',()=>{const f=fixture();try{
 const r=f.call('/comet-open',['--continue'],{FAKE_NEXT_TRANSITION:'1',FAKE_NEXT_UNKNOWN:'1'});assert.equal(r.status,2);const err=JSON.parse(r.stderr);assert.equal(err.code,'NEXT_OUTCOME_UNKNOWN');assert.equal(err.recovery.runId,'fixture-change');assert.equal(err.recovery.beforeRevision,7);assert.equal(err.recovery.readback.phase,'design');assert.equal(err.recovery.readback.revision,8);assert.match(err.message,/inspect.*before retry/i);
 const events=fs.readFileSync(f.log,'utf8').trim().split('\n').map(JSON.parse);assert.deepEqual(events.map(x=>x.operation),['inspect','next','inspect']);assert.equal(events.filter(x=>x.operation==='next').length,1);
}finally{f.cleanup();}});

test('lost next output with unavailable readback remains UNKNOWN and never retries next',()=>{const f=fixture();try{
 const r=f.call('/comet-open',['--continue'],{FAKE_NEXT_TRANSITION:'1',FAKE_NEXT_UNKNOWN:'1',FAKE_READBACK_FAIL:'1'});assert.equal(r.status,2);const err=JSON.parse(r.stderr);assert.equal(err.code,'NEXT_OUTCOME_UNKNOWN');assert.equal(err.recovery.runId,'fixture-change');assert.equal(err.recovery.beforeRevision,7);assert.equal(err.recovery.readback,null);
 const events=fs.readFileSync(f.log,'utf8').trim().split('\n').map(JSON.parse);assert.deepEqual(events.map(x=>x.operation),['inspect','next','inspect']);assert.equal(events.filter(x=>x.operation==='next').length,1);
}finally{f.cleanup();}});

test('inspect failure after a successful next is UNKNOWN even if it reports a revision conflict',()=>{const f=fixture();try{
 const r=f.call('/comet-open',['--continue'],{FAKE_NEXT_TRANSITION:'1',FAKE_INSPECT_CONFLICT:'1'});assert.equal(r.status,2);const err=JSON.parse(r.stderr);assert.equal(err.code,'NEXT_OUTCOME_UNKNOWN');assert.equal(err.recovery.runId,'fixture-change');assert.equal(err.recovery.readback,null);
 const events=fs.readFileSync(f.log,'utf8').trim().split('\n').map(JSON.parse);assert.deepEqual(events.map(x=>x.operation),['inspect','next','inspect','inspect']);assert.equal(events.filter(x=>x.operation==='next').length,1);
}finally{f.cleanup();}});

test('diagnostic wrapper on PATH reports actionable blocked entry without bypass',()=>{const f=fixture();try{
 const dir=path.join(f.root,'wrapper');fs.mkdirSync(dir);const fake=path.join(dir,'comet');
 fs.writeFileSync(fake,`#!/bin/bash\nprintf 'wrapper:%s\\n' "$1" >> "$FAKE_LOG"\nif [ "$1" = --version ];then printf '0.5.1\\n';exit 0;fi\nprintf '%s\\n' 'Comet workflow commands are blocked until the managed gates are qualified.' >&2\nexit 2\n`,{mode:0o755});
 const r=f.call('/comet-open',['--continue'],{PATH:dir+':'+path.join(f.root,'bin')});assert.equal(r.status,2);const err=JSON.parse(r.stderr);assert.equal(err.code,'LOCAL_DIAGNOSTIC_WRAPPER_BLOCKED');assert.match(err.message,/PATH.*external.*0\.5\.1/i);
 assert.deepEqual(fs.readFileSync(f.log,'utf8').trim().split('\n'),['wrapper:--version','wrapper:runtime']);
}finally{f.cleanup();}});

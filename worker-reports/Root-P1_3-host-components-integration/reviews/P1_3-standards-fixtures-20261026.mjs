import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const A='/Volumes/mac-extend/codex/worktrees/comet-registry-qualification/sdd-harness';
const B='/Volumes/mac-extend/codex/worktrees/comet-delivery-contracts/sdd-harness';
const {createCodexStdioTransport}=await import(A+'/lib/adapters/harness.js');
const {createManagedSpecAdapter}=await import(B+'/lib/adapters/spec.js');
const sha=v=>crypto.createHash('sha256').update(v).digest('hex');
const text=fs.readFileSync(A+'/test/comet-driver.test.js','utf8');
const helpers=text.slice(text.indexOf('function stdioPeerProgram('),text.indexOf("test('native stdio transport drives"));
const make=new Function('fs','path','os','sha','process',helpers+';return nativeTransportFixture;')(fs,path,os,sha,process);
const tick=()=>new Promise(r=>setTimeout(r,2));
const wait=async pred=>{const limit=Date.now()+15000;while(!pred()){assert.ok(Date.now()<limit,'fixture condition deadline');await tick();}};
const output=[];
for(const mode of ['empty-turn','stale-after-ready','initialize-only','overflow']){
 const f=make();let transport,op;
 const release=path.join(f.scratch,'release');
 const peer=`#!${process.execPath}\nimport readline from 'node:readline';import fs from 'node:fs';
 const mode=${JSON.stringify(mode)},log=${JSON.stringify(f.log)},release=${JSON.stringify(release)};
 const send=v=>process.stdout.write(JSON.stringify(v)+'\\n');
 const lines=readline.createInterface({input:process.stdin});
 lines.on('line',line=>{const m=JSON.parse(line);fs.appendFileSync(log,JSON.stringify(m)+'\\n');
 if(m.method==='initialize'){
 const frame=JSON.stringify({id:m.id,result:{userAgent:'standards-private-peer'}})+'\\n';
 if(mode==='overflow'){const pad=2*1024*1024-Buffer.byteLength(line+'\\n')-Buffer.byteLength(frame)-1;process.stderr.write(Buffer.alloc(pad,65));const timer=setInterval(()=>{if(fs.existsSync(release)){clearInterval(timer);process.stdout.write(frame);}},2);}else process.stdout.write(frame);
 }else if(m.method==='thread/start'){if(m.params.dynamicTools.length!==0)process.exit(81);send({id:m.id,result:{thread:{id:'t'}}});}
 else if(m.method==='turn/start'){send({id:m.id,result:{turn:{id:'u',status:'inProgress'}}});send({method:'turn/completed',params:{threadId:'t',turn:{id:'u',status:'completed'}}});}
 });\n`;
 fs.writeFileSync(f.peer,peer,{mode:0o755});f.options.registration.sha256=sha(fs.readFileSync(f.peer));f.options.registration.timeoutMs=20000;f.context.dynamicTools=[];
 if(mode==='initialize-only')f.options.registration.startPolicy='initialize-only';
 try{
 transport=createCodexStdioTransport(f.options);op=transport.connect();assert.equal(transport.connect(),op);
 if(mode==='overflow'){
 const frame=JSON.stringify({id:'comet:init',result:{userAgent:'standards-private-peer'}})+'\n';
 await wait(()=>{const s=transport.observe(op.handle);return s.raw.stdin.length>0&&s.raw.stderr.length===2*1024*1024-s.raw.stdin.length-Buffer.byteLength(frame)-1;});
 fs.writeFileSync(release,'go');const ready=await op.ready;const done=await op.done;
 for(const s of [ready,done,transport.observe(op.handle)]){assert.equal(s.status,'UNKNOWN');assert.equal(s.initialized,false);assert.equal(s.reason,'NATIVE_CAPTURE_LIMIT');}
 assert.equal(transport.start(),op);assert.throws(()=>transport.begin(op.handle),e=>e.code==='NATIVE_NOT_INITIALIZED');
 }else{
 const ready=await op.ready;assert.equal(ready.status,'INITIALIZED');assert.equal(ready.threadId,null);
 if(mode==='initialize-only'){assert.throws(()=>transport.start(),e=>e.code==='NATIVE_TURN_SCOPE_REQUIRED');assert.throws(()=>transport.begin(op.handle),e=>e.code==='NATIVE_TURN_SCOPE_REQUIRED');}
 else if(mode==='stale-after-ready'){const changed=structuredClone(f.context);changed.actionBinding.epoch++;f.setCurrent(changed);transport.begin(op.handle);assert.equal((await op.done).reason,'NATIVE_CONTEXT_STALE');f.setCurrent(f.context);transport.start();assert.equal(transport.observe(op.handle).status,'UNKNOWN');}
 else{assert.throws(()=>transport.begin({...op.handle}),e=>e.code==='NATIVE_HANDLE_REQUIRED');transport.begin(op.handle);const terminal=await op.closed;assert.equal(terminal.status,'OBSERVED_TERMINAL');assert.equal(terminal.protocolComplete,true);transport.start();assert.equal(transport.observe(op.handle).status,'OBSERVED_TERMINAL');}
 }
 assert.equal(f.calls(),0);const wire=fs.readFileSync(f.log,'utf8').trim().split('\n').map(JSON.parse).map(m=>m.method);output.push({candidate:'A',case:mode,wire,status:transport.observe(op.handle).status,reason:transport.observe(op.handle).reason,scope:'component/private-node-peer'});
 }finally{if(op){transport.cancel(op.handle);await op.closed;}f.cleanup();}
}
for(const mode of ['archive-and-closure','move-during-native','missing-before-native','symlink-lock']){
 const root=fs.mkdtempSync('/private/tmp/p13-standards-context-');const active=path.join(root,'openspec/changes/demo');let calls=0;
 const runfile=dir=>path.join(dir,'.comet/run-state.json');const write=dir=>{fs.mkdirSync(path.dirname(runfile(dir)),{recursive:true});fs.writeFileSync(runfile(dir),JSON.stringify({runId:'review-run',status:'running'}));};write(active);
 const archived=path.join(root,'openspec/changes/archive/2026-10-26-demo');
 const instance=createManagedSpecAdapter({projectRoot:root,runtime:{runClassicCli(){throw Error('FORBIDDEN_CLI');},async ensureClassicRuntimeRun(dir){calls++;if(mode==='move-during-native'){fs.mkdirSync(path.dirname(archived),{recursive:true});fs.renameSync(dir,archived);}return {run:{runId:'review-run',status:'running'},classic:{phase:'open'}};}}});
 try{
 if(mode==='missing-before-native'){fs.rmSync(active,{recursive:true});await assert.rejects(instance.readRunContext({change:'demo',expectedRunId:'review-run'}),e=>e.code==='CHANGE_MISSING');assert.equal(calls,0);}
 else if(mode==='move-during-native')await assert.rejects(instance.readRunContext({change:'demo',expectedRunId:'review-run'}),e=>e.code==='RUN_LOCATION_CHANGED');
 else {const request={change:'demo',expectedRunId:'review-run'},context=await instance.readRunContext(request);
 if(mode==='symlink-lock'){const outside=path.join(root,'outside-lock');fs.writeFileSync(outside,'x');fs.symlinkSync(outside,path.join(active,'.comet-state.lock'));assert.throws(()=>context.assertCurrent(),e=>e.code==='PROJECT_PATH_UNSAFE');}
 else{request.expectedRunId='changed';context.run.runId='changed';assert.equal(context.assertCurrent().run.runId,'review-run');fs.mkdirSync(path.dirname(archived),{recursive:true});fs.renameSync(active,archived);assert.throws(()=>context.assertCurrent(),e=>e.code==='RUN_LOCATION_CHANGED');const after=await instance.readRunContext({change:'demo',expectedRunId:'review-run'});assert.equal(after.archived,true);assert.equal(after.changeDir,archived);assert.equal(fs.existsSync(active),false);}}
 output.push({candidate:'B',case:mode,calls,result:'PASS',scope:'component/mock-native-reader-no-cli'});
 }finally{fs.rmSync(root,{recursive:true,force:true});}
}
console.log(JSON.stringify({node:process.version,checks:output.length,fail:0,results:output},null,2));

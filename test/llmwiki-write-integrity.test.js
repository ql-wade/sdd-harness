import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {buildKpOperation,invokeMcpPublish,refuseDuplicateCreate} from '../lib/adapters/llmwiki.js';

const sha=value=>crypto.createHash('sha256').update(value,'utf8').digest('hex');
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'kp-integrity-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const trace=path.join(root,'calls.jsonl'),launcher=path.join(root,'mcp-fixture.js');
  const program=`#!${process.execPath}\nconst fs=require('node:fs'),readline=require('node:readline');
const trace=${JSON.stringify(trace)},send=value=>process.stdout.write(JSON.stringify(value)+'\\n');
fs.appendFileSync(trace,JSON.stringify({event:'spawn'})+'\\n');let body='';
const rl=readline.createInterface({input:process.stdin});
rl.on('line',line=>{
 const msg=JSON.parse(line);
 if(msg.method==='initialize'){
  const valid={jsonrpc:'2.0',id:msg.id,result:{protocolVersion:'2025-11-25',capabilities:{},serverInfo:{name:'fixture',version:'1'}}};
  const aheadCreate={jsonrpc:'2.0',id:2,result:{content:[{type:'text',text:'created'}]}};
  const aheadRead={jsonrpc:'2.0',id:3,result:{content:[{type:'text',text:'metadata\\n'+${JSON.stringify(body)}}]}};
  if(process.env.SYNTHETIC_NOTIFY_BATCH==='1'){process.stdout.write(JSON.stringify(valid)+'\\n'+JSON.stringify({jsonrpc:'2.0',method:'notifications/message',params:{level:'info'}})+'\\n');return;}
  if(process.env.SYNTHETIC_NOTIFY_SPLIT==='1'){const note=JSON.stringify({jsonrpc:'2.0',method:'notifications/message',params:{level:'info'}});process.stdout.write(JSON.stringify(valid)+'\\n'+note.slice(0,8));setTimeout(()=>{fs.appendFileSync(trace,JSON.stringify({event:'notification'})+'\\n');process.stdout.write(note.slice(8)+'\\n')},50);return;}
  if(process.env.SYNTHETIC_PREFETCH_BURST==='1'){process.stdout.write([valid,aheadCreate,aheadRead].map(x=>JSON.stringify(x)).join('\\n')+'\\n');return;}
  if(process.env.SYNTHETIC_PREFETCH_PARTIAL==='1'){const later=JSON.stringify(aheadCreate);process.stdout.write(JSON.stringify(valid)+'\\n'+later.slice(0,8));setTimeout(()=>process.stdout.write(later.slice(8)+'\\n'+JSON.stringify(aheadRead)+'\\n'),50);return;}
  if(process.env.SYNTHETIC_PREFETCH_LATER==='1'){send(valid);setTimeout(()=>send(aheadCreate),50);return;}
  if(process.env.SYNTHETIC_INIT_PARTIAL_ERROR==='1'){process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:msg.id,error:{code:-32603,message:'fixture init failure'}}));setTimeout(()=>process.stdout.write('\\n'),50);}
  else if(process.env.SYNTHETIC_INIT_ERROR==='1')send({jsonrpc:'2.0',id:msg.id,error:{code:-32603,message:'fixture init failure'}});
  else if(process.env.SYNTHETIC_INIT_MALFORMED==='1')send({jsonrpc:'2.0',id:msg.id,result:{}});
  else if(process.env.SYNTHETIC_INIT_WRONG_VERSION==='1')send({jsonrpc:'2.0',id:msg.id,result:{protocolVersion:'1999-01-01',capabilities:{},serverInfo:{name:'fixture',version:'1'}}});
  else if(process.env.SYNTHETIC_CLOSE_INPUT==='1'){process.stdin.destroy();send({jsonrpc:'2.0',id:msg.id,result:{protocolVersion:'2025-11-25',capabilities:{},serverInfo:{name:'fixture',version:'1'}}});setInterval(()=>{},1000);}
  else send({jsonrpc:'2.0',id:msg.id,result:{protocolVersion:'2025-11-25',capabilities:{},serverInfo:{name:'fixture',version:'1'}}});
  return;
 }
 if(msg.method==='tools/call' && msg.params?.name==='create'){
  body=msg.params.arguments.content;fs.appendFileSync(trace,JSON.stringify({event:'create',body})+'\\n');
  if(process.env.SYNTHETIC_EXIT_AFTER_CREATE==='1')process.exit(9);
  if(process.env.SYNTHETIC_PREFETCH_LATER==='1')return;
  if(process.env.SYNTHETIC_PREFETCH_AFTER_CREATE==='1'){const a={jsonrpc:'2.0',id:msg.id,result:{content:[{type:'text',text:'created'}]}};const b={jsonrpc:'2.0',id:3,result:{content:[{type:'text',text:'metadata\\n'+body}]}};process.stdout.write(JSON.stringify(a)+'\\n'+JSON.stringify(b)+'\\n');return;}
  if(process.env.SYNTHETIC_CREATE_ERROR==='1')send({jsonrpc:'2.0',id:msg.id,error:{code:-32603,message:'fixture create failure'}});
  else if(process.env.SYNTHETIC_CREATE_IS_ERROR==='1')send({jsonrpc:'2.0',id:msg.id,result:{isError:true,content:[{type:'text',text:'fixture tool failure'}]}});
  else if(process.env.SYNTHETIC_CREATE_MALFORMED==='1')send({jsonrpc:'2.0',id:msg.id,result:{}});
  else send({jsonrpc:'2.0',id:msg.id,result:{content:[{type:'text',text:'created'}]}});
  return;
 }
 if(msg.method==='tools/call' && msg.params?.name==='read'){
  fs.appendFileSync(trace,JSON.stringify({event:'read'})+'\\n');
  if(process.env.SYNTHETIC_EXIT_AFTER_READ==='1')process.exit(9);
  if(process.env.SYNTHETIC_READ_ERROR==='1')send({jsonrpc:'2.0',id:msg.id,error:{code:-32603,message:'fixture read failure'}});
  else if(process.env.SYNTHETIC_READ_IS_ERROR==='1')send({jsonrpc:'2.0',id:msg.id,result:{isError:true,content:[{type:'text',text:'metadata\\n'+body}]}});
  else if(process.env.SYNTHETIC_INVALID_UTF8==='1'){
   const result=Buffer.from(JSON.stringify({jsonrpc:'2.0',id:msg.id,result:{content:[{type:'text',text:'metadata\\n'+body}]}})+'\\n','utf8');const replacement=Buffer.from('�');const at=result.indexOf(replacement);
   process.stdout.write(Buffer.concat([result.subarray(0,at),Buffer.from([255]),result.subarray(at+replacement.length)]));
  }
  else if(process.env.SYNTHETIC_SPLIT_UTF8==='1'){
   const result=Buffer.from(JSON.stringify({jsonrpc:'2.0',id:msg.id,result:{content:[{type:'text',text:'metadata\\n'+body}]}})+'\\n','utf8');const at=result.indexOf(Buffer.from('🧭'));
   process.stdout.write(result.subarray(0,at+2));setTimeout(()=>process.stdout.write(result.subarray(at+2)),50);
  }
  else send({jsonrpc:'2.0',id:msg.id,result:{content:[{type:'text',text:'metadata\\n'+(process.env.SYNTHETIC_READ_DRIFT==='1'?body+'-changed':body)}]}});
 }
});`;

  fs.writeFileSync(launcher,program,{mode:0o700});return {root,trace,launcher,env:{PATH:[path.dirname(process.execPath),'/usr/bin','/bin'].join(path.delimiter),LANG:'C.UTF-8'}};
}
const body='verified project knowledge 🧭\n';
function operation(){return buildKpOperation({change:'synthetic-change',entry:{capability:'verified-note',digest:sha(body)}});}
const readTrace=f=>fs.existsSync(f.trace)?fs.readFileSync(f.trace,'utf8').trim().split('\n').map(line=>JSON.parse(line)):[];

test('matching frozen UTF-8 content is written once and read back in the same MCP session',async t=>{
  const f=fixture(t),op=operation();const result=await invokeMcpPublish({operation:op,launcherPath:f.launcher,content:body,env:f.env,timeoutMs:5000});
  assert.equal(result.status,'RESPONDED');assert.equal(result.readbackConsistent,true);assert.equal(result.operationId,op.operationId);
  assert.match(result.readbackRequestId,/^[a-f0-9]{32}$/);
  const frames=result.response.split('\n').filter(Boolean).map(line=>JSON.parse(line));
  assert.equal(frames.filter(frame=>frame.id===result.readbackRequestId).length,1);
  assert.equal(new Set(frames.map(frame=>frame.id).filter(id=>id!==undefined)).size,3);
  assert.deepEqual(readTrace(f),[{event:'spawn'},{event:'create',body},{event:'read'}]);
  assert.equal(refuseDuplicateCreate({issuedOperationIds:[op.operationId],operationId:op.operationId}).refused,true);
});

test('content drift refuses before starting the launcher or writing',async t=>{
  const f=fixture(t),result=await invokeMcpPublish({operation:operation(),launcherPath:f.launcher,content:body+'drift',env:f.env,timeoutMs:5000});
  assert.deepEqual(readTrace(f),[],'invalid input must never start the launcher or write');assert.equal(result.status,'INPUT_INVALID');assert.equal(result.code,'KP_CONTENT_DIGEST_MISMATCH');
});

test('missing or malformed frozen digest refuses before starting the launcher or writing',async t=>{
  for(const digest of [undefined,null,'bad','A'.repeat(64)]){
    const f=fixture(t),op={...operation(),contentDigest:digest};const result=await invokeMcpPublish({operation:op,launcherPath:f.launcher,content:body,env:f.env,timeoutMs:5000});
    assert.deepEqual(readTrace(f),[],'invalid input must never start the launcher or write');assert.equal(result.status,'INPUT_INVALID');assert.equal(result.code,'KP_CONTENT_DIGEST_INVALID');
  }
});

test('missing, empty, or non-string content refuses before starting the launcher or writing',async t=>{
  for(const content of [undefined,null,'',Buffer.from(body)]){
    const f=fixture(t),result=await invokeMcpPublish({operation:operation(),launcherPath:f.launcher,content,env:f.env,timeoutMs:5000});
    assert.deepEqual(readTrace(f),[],'invalid input must never start the launcher or write');assert.equal(result.status,'INPUT_INVALID');assert.equal(result.code,'KP_CONTENT_REQUIRED');
  }
});

test('different bytes on readback remain a mismatch',async t=>{
  const f=fixture(t),result=await invokeMcpPublish({operation:operation(),launcherPath:f.launcher,content:body,env:{...f.env,SYNTHETIC_READ_DRIFT:'1'},timeoutMs:5000});
  assert.equal(result.status,'RESPONDED');assert.equal(result.readbackConsistent,false);
  assert.deepEqual(readTrace(f),[{event:'spawn'},{event:'create',body},{event:'read'}]);
});

test('initialize JSON-RPC error refuses without sending create',async t=>{
  const f=fixture(t),result=await invokeMcpPublish({operation:operation(),launcherPath:f.launcher,content:body,env:{...f.env,SYNTHETIC_INIT_ERROR:'1'},timeoutMs:5000});
  assert.deepEqual(readTrace(f),[{event:'spawn'}]);assert.equal(result.status,'INITIALIZE_FAILED');assert.equal(result.code,'MCP_INITIALIZE_FAILED');
});
test('create JSON-RPC error is explicit unknown and never repeats create',async t=>{
  const f=fixture(t),result=await invokeMcpPublish({operation:operation(),launcherPath:f.launcher,content:body,env:{...f.env,SYNTHETIC_CREATE_ERROR:'1'},timeoutMs:5000});
  assert.equal(result.status,'CREATE_FAILED');assert.equal(result.code,'MCP_CREATE_FAILED');assert.equal(result.outcome,'UNKNOWN');
  assert.deepEqual(readTrace(f),[{event:'spawn'},{event:'create',body}]);
});
test('create MCP isError is explicit unknown and never repeats create',async t=>{
  const f=fixture(t),result=await invokeMcpPublish({operation:operation(),launcherPath:f.launcher,content:body,env:{...f.env,SYNTHETIC_CREATE_IS_ERROR:'1'},timeoutMs:5000});
  assert.equal(result.status,'CREATE_FAILED');assert.equal(result.code,'MCP_CREATE_FAILED');assert.equal(result.outcome,'UNKNOWN');
  assert.deepEqual(readTrace(f),[{event:'spawn'},{event:'create',body}]);
});
test('read JSON-RPC error or MCP isError is explicit and never accepted',async t=>{
  for(const name of ['SYNTHETIC_READ_ERROR','SYNTHETIC_READ_IS_ERROR']){
    const f=fixture(t),result=await invokeMcpPublish({operation:operation(),launcherPath:f.launcher,content:body,env:{...f.env,[name]:'1'},timeoutMs:5000});
    assert.equal(result.status,'READ_FAILED');assert.equal(result.code,'MCP_READ_FAILED');assert.equal(result.outcome,'UNKNOWN');
    assert.deepEqual(readTrace(f),[{event:'spawn'},{event:'create',body},{event:'read'}]);
  }
});
test('unpaired Unicode surrogates are rejected before spawning MCP',async t=>{
  for(const content of ['\uD800','\uDC00','x\uD800y']){
    const f=fixture(t),op=buildKpOperation({change:'synthetic-change',entry:{capability:'verified-note',digest:sha(content)}});
    const result=await invokeMcpPublish({operation:op,launcherPath:f.launcher,content,env:f.env,timeoutMs:5000});
    assert.equal(result.status,'INPUT_INVALID');assert.equal(result.code,'KP_CONTENT_UNICODE_INVALID');assert.deepEqual(readTrace(f),[]);
  }
});

test('malformed initialize response refuses before create',async t=>{
  const f=fixture(t),result=await invokeMcpPublish({operation:operation(),launcherPath:f.launcher,content:body,env:{...f.env,SYNTHETIC_INIT_MALFORMED:'1'},timeoutMs:5000});
  assert.equal(result.status,'INITIALIZE_FAILED');assert.equal(result.code,'MCP_INITIALIZE_FAILED');assert.deepEqual(readTrace(f),[{event:'spawn'}]);
});
test('malformed create result remains unknown and is never repeated',async t=>{
  const f=fixture(t),result=await invokeMcpPublish({operation:operation(),launcherPath:f.launcher,content:body,env:{...f.env,SYNTHETIC_CREATE_MALFORMED:'1'},timeoutMs:5000});
  assert.equal(result.status,'CREATE_FAILED');assert.equal(result.outcome,'UNKNOWN');assert.deepEqual(readTrace(f),[{event:'spawn'},{event:'create',body}]);
});
test('UTF-8 readback split across process chunks preserves the exact content',async t=>{
  const f=fixture(t),result=await invokeMcpPublish({operation:operation(),launcherPath:f.launcher,content:body,env:{...f.env,SYNTHETIC_SPLIT_UTF8:'1'},timeoutMs:5000});
  assert.equal(result.status,'RESPONDED');assert.equal(result.readbackConsistent,true);assert.deepEqual(readTrace(f),[{event:'spawn'},{event:'create',body},{event:'read'}]);
});

test('unsupported initialized protocol version refuses before create',async t=>{
  const f=fixture(t),result=await invokeMcpPublish({operation:operation(),launcherPath:f.launcher,content:body,env:{...f.env,SYNTHETIC_INIT_WRONG_VERSION:'1'},timeoutMs:5000});
  assert.equal(result.status,'INITIALIZE_FAILED');assert.equal(result.code,'MCP_INITIALIZE_FAILED');assert.deepEqual(readTrace(f),[{event:'spawn'}]);
});

test('unterminated initialize error is never treated as permission to create',async t=>{
  const f=fixture(t),result=await invokeMcpPublish({operation:operation(),launcherPath:f.launcher,content:body,env:{...f.env,SYNTHETIC_INIT_PARTIAL_ERROR:'1'},timeoutMs:5000});
  assert.equal(result.status,'INITIALIZE_FAILED');assert.deepEqual(readTrace(f),[{event:'spawn'}]);
});
test('invalid UTF-8 readback cannot match a valid replacement character',async t=>{
  const content='valid replacement � content',op=buildKpOperation({change:'synthetic-change',entry:{capability:'verified-note',digest:sha(content)}});
  const f=fixture(t),result=await invokeMcpPublish({operation:op,launcherPath:f.launcher,content,env:{...f.env,SYNTHETIC_INVALID_UTF8:'1'},timeoutMs:5000});
  assert.equal(result.status,'READ_FAILED');assert.equal(result.outcome,'UNKNOWN');assert.notEqual(result.readbackConsistent,true);
  assert.deepEqual(readTrace(f),[{event:'spawn'},{event:'create',body:content},{event:'read'}]);
});

test('launcher exit after sending create remains unknown and never retries',async t=>{
  const f=fixture(t),result=await invokeMcpPublish({operation:operation(),launcherPath:f.launcher,content:body,env:{...f.env,SYNTHETIC_EXIT_AFTER_CREATE:'1'},timeoutMs:5000});
  assert.equal(result.status,'CREATE_FAILED');assert.equal(result.outcome,'UNKNOWN');assert.deepEqual(readTrace(f),[{event:'spawn'},{event:'create',body}]);
});
test('launcher exit after sending read remains unknown and never retries',async t=>{
  const f=fixture(t),result=await invokeMcpPublish({operation:operation(),launcherPath:f.launcher,content:body,env:{...f.env,SYNTHETIC_EXIT_AFTER_READ:'1'},timeoutMs:5000});
  assert.equal(result.status,'READ_FAILED');assert.equal(result.outcome,'UNKNOWN');assert.deepEqual(readTrace(f),[{event:'spawn'},{event:'create',body},{event:'read'}]);
});

test('closed launcher input is reported as unknown without crashing the host',t=>{
  const f=fixture(t),module=pathToFileURL(path.resolve('lib/adapters/llmwiki.js')).href;
  const script=`import {buildKpOperation,invokeMcpPublish} from ${JSON.stringify(module)};import crypto from 'node:crypto';const body='synthetic';const op=buildKpOperation({change:'test',entry:{capability:'note',digest:crypto.createHash('sha256').update(body).digest('hex')}});const result=await invokeMcpPublish({operation:op,launcherPath:process.argv[1],content:body,env:{PATH:process.env.PATH,SYNTHETIC_CLOSE_INPUT:'1'},timeoutMs:2000});console.log(JSON.stringify(result));`;
  const child=spawnSync(process.execPath,['--input-type=module','-e',script,f.launcher],{cwd:process.cwd(),env:f.env,encoding:'utf8',timeout:6000});
  assert.equal(child.status,0,child.stderr);const result=JSON.parse(child.stdout.trim());assert.notEqual(result.status,'RESPONDED');assert.equal(result.outcome,'UNKNOWN');
});

test('pre-sent create/read responses in the initialize chunk cannot authorize a write',async t=>{
  const f=fixture(t),result=await invokeMcpPublish({operation:operation(),launcherPath:f.launcher,content:body,env:{...f.env,SYNTHETIC_PREFETCH_BURST:'1'},timeoutMs:5000});
  assert.notEqual(result.status,'RESPONDED');assert.equal(result.outcome,'NOT_STARTED');assert.deepEqual(readTrace(f),[{event:'spawn'}]);
});
test('a partial pre-sent response blocks create until the frame is classified',async t=>{
  const f=fixture(t),result=await invokeMcpPublish({operation:operation(),launcherPath:f.launcher,content:body,env:{...f.env,SYNTHETIC_PREFETCH_PARTIAL:'1'},timeoutMs:5000});
  assert.notEqual(result.status,'RESPONDED');assert.equal(result.outcome,'NOT_STARTED');assert.deepEqual(readTrace(f),[{event:'spawn'}]);
});
test('a later pre-sent response is never accepted for a newly issued create',async t=>{
  const f=fixture(t),result=await invokeMcpPublish({operation:operation(),launcherPath:f.launcher,content:body,env:{...f.env,SYNTHETIC_PREFETCH_LATER:'1'},timeoutMs:5000});
  assert.notEqual(result.status,'RESPONDED');assert.equal(result.outcome,'UNKNOWN');const calls=readTrace(f);assert.ok(calls.filter(x=>x.event==='create').length<=1);assert.equal(calls.some(x=>x.event==='read'),false);
});
test('pre-sent read response after create cannot establish readback',async t=>{
  const f=fixture(t),result=await invokeMcpPublish({operation:operation(),launcherPath:f.launcher,content:body,env:{...f.env,SYNTHETIC_PREFETCH_AFTER_CREATE:'1'},timeoutMs:5000});
  assert.notEqual(result.status,'RESPONDED');assert.equal(result.outcome,'UNKNOWN');assert.deepEqual(readTrace(f),[{event:'spawn'},{event:'create',body}]);
});

test('a valid notification in the same initialize batch does not block publication',async t=>{
  const f=fixture(t),result=await invokeMcpPublish({operation:operation(),launcherPath:f.launcher,content:body,env:{...f.env,SYNTHETIC_NOTIFY_BATCH:'1'},timeoutMs:5000});
  assert.equal(result.status,'RESPONDED');assert.equal(result.readbackConsistent,true);assert.deepEqual(readTrace(f),[{event:'spawn'},{event:'create',body},{event:'read'}]);
});
test('a split notification is fully received before the create request',async t=>{
  const f=fixture(t),result=await invokeMcpPublish({operation:operation(),launcherPath:f.launcher,content:body,env:{...f.env,SYNTHETIC_NOTIFY_SPLIT:'1'},timeoutMs:5000});
  assert.equal(result.status,'RESPONDED');assert.equal(result.readbackConsistent,true);assert.deepEqual(readTrace(f),[{event:'spawn'},{event:'notification'},{event:'create',body},{event:'read'}]);
});

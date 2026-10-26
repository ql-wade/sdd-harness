import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';import * as harness from '/Volumes/mac-extend/codex/worktrees/comet-registry-qualification/sdd-harness/lib/adapters/harness.js';const sha=(v)=>crypto.createHash('sha256').update(v).digest('hex');
function stdioPeerProgram(mode, log) {
  return `#!${process.execPath}\nimport readline from 'node:readline';import fs from 'node:fs';import assert from 'node:assert/strict';
const mode=${JSON.stringify(mode)},log=${JSON.stringify(log)};
assert.deepEqual(process.argv.slice(2),['app-server','--listen','stdio://']);
const send=(v)=>process.stdout.write(JSON.stringify(v)+'\\n');
const note=(m)=>fs.appendFileSync(log,JSON.stringify(m)+'\\n');
let initialized=false;const thread='thread-stdio-1',turn='turn-stdio-1';
const call=()=>({id:71,method:'item/tool/call',params:{threadId:thread,turnId:turn,callId:'call-1',tool:'write_note',arguments:{path:'note.txt',text:'written by the protected callback'}}});
const ordinary=()=>mode.startsWith('notifications');
const telemetry=()=>{const usage={cachedInputTokens:0,inputTokens:1,outputTokens:2,reasoningOutputTokens:0,totalTokens:3};if(mode==='notifications-invalid-usage')usage.totalTokens='3';send({method:'thread/tokenUsage/updated',params:{threadId:thread,turnId:turn,tokenUsage:{last:usage,total:usage,modelContextWindow:1000}}});send({method:'item/reasoning/summaryPartAdded',params:{threadId:thread,turnId:turn,itemId:'reasoning-1',summaryIndex:0}});send({method:'turn/diff/updated',params:{threadId:thread,turnId:mode==='notifications-wrong-turn'?'foreign-turn':turn,diff:'--- note.txt\\n+++ note.txt\\n'}});send({method:'turn/plan/updated',params:{threadId:thread,turnId:turn,explanation:null,plan:[{step:'private action only',status:'inProgress'}]}});};
const toolEvent=(method,status)=>send({method,params:{threadId:thread,turnId:turn,...(method==='item/started'?{startedAtMs:1}:{completedAtMs:2}),item:{id:'call-1',type:'dynamicToolCall',tool:'write_note',arguments:call().params.arguments,status,contentItems:null,success:null}}});
const finish=()=>{if(ordinary())toolEvent('item/completed','completed');send({method:'item/agentMessage/delta',params:{threadId:thread,turnId:turn,itemId:'message-1',delta:'model text is not a tool request'}});send({method:'turn/completed',params:{threadId:thread,turn:{id:turn,status:'completed',items:[],error:null}}});if(ordinary())send({method:'thread/status/changed',params:{threadId:thread,status:{type:'idle'}}});if(mode==='exit7')process.exitCode=7;};
const issue=()=>{if(mode==='eof'){process.stdin.destroy();return;}if(mode==='truncated'){process.stdout.write('{"method":"turn/completed"');process.stdin.destroy();return;}if(mode==='oversized'){process.stdout.write('X'.repeat(300*1024)+'\\n');return;}if(mode==='stderr-limit'){process.stderr.write('Z'.repeat(2*1024*1024+1024));return;}
if(mode==='approval'||mode==='permission'){send({id:81,method:mode==='approval'?'item/commandExecution/requestApproval':'item/permissions/requestApproval',params:{threadId:thread,turnId:turn,itemId:'builtin-1'}});return;}
if(mode==='builtin'||mode==='collaboration'){send({method:'item/started',params:{threadId:thread,turnId:turn,startedAtMs:1,item:{id:'builtin-1',type:mode==='builtin'?'commandExecution':'collabToolCall'}}});return;}
const c=call();if(mode==='wrong-turn')c.params.turnId='foreign-turn';if(mode==='wrong-thread')c.params.threadId='foreign-thread';if(mode==='unknown-tool')c.params.tool='undeclared_tool';if(mode==='namespace')c.params.namespace='foreign';if(mode==='path-denied')c.params.arguments.path='../outside.txt';if(mode==='split'){c.params.arguments.text='written 写入🧵';const b=Buffer.from(JSON.stringify(c)+'\\n'),at=b.indexOf(Buffer.from('写'));process.stdout.write(b.subarray(0,at+1));setTimeout(()=>process.stdout.write(b.subarray(at+1)),10);return;}if(ordinary())toolEvent('item/started','inProgress');send(c);
if(mode==='rpc-id-reused'){const second=call();second.params.callId='call-2';send(second);}if(mode==='duplicate')send(call());};
const lines=readline.createInterface({input:process.stdin});
lines.on('line',(line)=>{try{const m=JSON.parse(line);note(m);
if(m.error){process.stdin.destroy();return;}
if(m.method==='initialize'){assert.equal(m.params.capabilities.experimentalApi,true);if(mode==='wait')return;if(mode==='wrong-id'){send({id:'foreign-id',result:{}});return;}if(mode==='duplicate-key'){process.stdout.write('{"id":"foreign","id":"comet:init","result":{}}\\n');return;}if(mode==='malformed'){process.stdout.write('{"P13_NON_SECRET_DIAGNOSTIC":oops}\\n');return;}send({id:m.id,result:{userAgent:'private-peer-not-a-model'}});}
else if(m.method==='initialized')initialized=true;
else if(m.method==='thread/start'){assert.equal(initialized,true);assert.deepEqual(m.params.environments,[]);assert.equal(m.params.dynamicTools[0].name,'write_note');if(ordinary()){assert.equal(m.params.multiAgentMode,undefined);send({method:'thread/status/changed',params:{threadId:thread,status:{type:'idle'}}});}send({id:m.id,result:{thread:{id:thread,cliVersion:'0.163.0',createdAt:1,cwd:process.cwd(),ephemeral:true,modelProvider:'private-peer',preview:'',projectId:null,sessionId:thread,source:'exec',status:{type:'idle'},turns:[],updatedAt:1}}});}
else if(m.method==='turn/start'){assert.equal(m.params.threadId,thread);assert.deepEqual(m.params.environments,[]);if(ordinary()){assert.equal(m.params.multiAgentMode,undefined);send({method:'turn/started',params:{threadId:thread,turn:{id:turn,status:'inProgress',items:[],error:null}}});send({method:'thread/status/changed',params:{threadId:thread,status:{type:'active',activeFlags:[]}}});telemetry();if(mode==='notifications-early-tool')issue();}send({id:m.id,result:{turn:{id:turn,status:'inProgress',items:[],error:null}}});if(!ordinary())send({method:'turn/started',params:{threadId:thread,turn:{id:turn,status:'inProgress',items:[],error:null}}});if(mode!=='notifications-early-tool')issue();}
else if(m.id===71){assert.equal(m.result.success,mode!=='path-denied');if(mode==='path-denied')assert.equal(m.result.contentItems[0].text,'PATH_REFUSED');else assert.match(m.result.contentItems[0].text,/written/);finish();}
else throw new Error('unexpected client frame');
}catch{process.stderr.write('PRIVATE_PEER_PROTOCOL_ASSERTION\\n');process.exitCode=90;lines.close();process.stdin.destroy();}});
process.stdin.on('end',()=>{process.exitCode=process.exitCode??0;});
`;
}

function nativeTransportFixture(mode = 'happy') {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'p13-native-stdio-'));
  const workspace = path.join(scratch, 'workspace'); fs.mkdirSync(workspace);
  const log = path.join(scratch, 'peer-wire.jsonl'), peer = path.join(scratch, 'peer.mjs');
  fs.writeFileSync(peer, stdioPeerProgram(mode, log), { mode: 0o755 });
  const actionBinding = { schemaVersion: 1, profile: 'comet-managed-v2', runnerId: 'comet-classic', run: 'stdio-run-1',
    action: 'write-private-note', gate: 'Build', execution: 'stdio-execution-1', role: 'test-author', revision: 'r1', attempt: 1, epoch: 1,
    inputDigest: sha('approved-pre-output-input'), policyDigest: sha('component-policy'), environmentDigest: sha('private-stdio-peer'),
    workPackage: { id: 'component-native-transport', taskIds: ['1.3.a'] },
    methods: [{ name: 'test-authoring', version: '1.0.0', ref: '.agents/skills/test-authoring/SKILL.md', digest: sha('component-method-not-applied') }],
    allowedPaths: ['note.txt'], allowedTools: ['write_note'], inputs: [{ name: 'material', ref: 'input.txt', digest: sha('public fixture text') }],
    outputs: [{ name: 'note', ref: 'note.txt' }] };
  const context = { actionBinding, model: 'private-peer-NOT-A-MODEL', cwd: workspace,
    input: [{ type: 'text', text: 'public fixture text' }],
    dynamicTools: [{ type: 'function', name: 'write_note', description: 'Write the declared private fixture output',
      inputSchema: { type: 'object', properties: { path: { type: 'string' }, text: { type: 'string' } }, required: ['path', 'text'], additionalProperties: false } }] };
  let current = context, calls = 0;
  const options = { registration: { executable: peer, sha256: sha(fs.readFileSync(peer)), argv: ['app-server', '--listen', 'stdio://'],
    env: { PATH: process.env.PATH ?? '', LANG: 'C.UTF-8' }, timeoutMs: 3000 }, context,
    currentContext: () => current,
    invokeTool: async (request) => {
      assert.equal(request.run, 'stdio-run-1'); assert.equal(request.execution, 'stdio-execution-1');
      assert.equal(request.threadId, 'thread-stdio-1'); assert.equal(request.turnId, 'turn-stdio-1'); assert.equal(request.callId, 'call-1');
      assert.equal(request.actionBinding.inputDigest, sha('approved-pre-output-input'));
      calls++;
      if (request.arguments.path !== 'note.txt') return { success: false, contentItems: [{ type: 'inputText', text: 'PATH_REFUSED' }] };
      fs.writeFileSync(path.join(workspace, 'note.txt'), request.arguments.text);
      return { success: true, contentItems: [{ type: 'inputText', text: fs.readFileSync(path.join(workspace, 'note.txt'), 'utf8') }] };
    } };
  return { scratch, workspace, log, peer, options, context, calls: () => calls, setCurrent(value) { current = value; },
    cleanup() { fs.rmSync(scratch, { recursive: true, force: true }); } };
}


const f=nativeTransportFixture('wait');let t,op;
const peer=`#!${process.execPath}
import readline from 'node:readline';import fs from 'node:fs';const nl=String.fromCharCode(10);const lines=readline.createInterface({input:process.stdin});lines.on('line',(line)=>{const m=JSON.parse(line);fs.appendFileSync(${JSON.stringify(f.log)},line+nl);if(m.method==='initialize'){const result=JSON.stringify({id:m.id,result:{}})+nl;const pad=2*1024*1024-Buffer.byteLength(line+nl)-Buffer.byteLength(result)-1;process.stderr.write(Buffer.alloc(pad,65),()=>setTimeout(()=>process.stdout.write(result),100));}});`;
fs.writeFileSync(f.peer,peer);f.options.registration.sha256=sha(fs.readFileSync(f.peer));
try{t=harness.createCodexStdioTransport(f.options);op=t.connect();const ready=await op.ready;const done=await op.done;const observed=t.observe(op.handle);const out={ready:{status:ready.status,reason:ready.reason,initialized:ready.initialized},done:{status:done.status,reason:done.reason,initialized:done.initialized},observed:{status:observed.status,reason:observed.reason,initialized:observed.initialized,truncated:observed.truncated},raw:Object.fromEntries(Object.entries(observed.raw).map(([k,v])=>[k,v.length])),stderrPreview:observed.raw.stderr.subarray(0,500).toString(),wire:fs.existsSync(f.log)?fs.readFileSync(f.log,'utf8').trim().split(String.fromCharCode(10)).map(JSON.parse).map(m=>m.method):[]};console.log(JSON.stringify(out,null,2));assert.equal(ready.reason,'NATIVE_CAPTURE_LIMIT');assert.equal(observed.status,'UNKNOWN','UNKNOWN must remain sticky after initialized-write capture overflow');}finally{if(op){t.cancel(op.handle);await op.closed;}f.cleanup();}

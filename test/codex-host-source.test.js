import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { parseCodexCommandEvent, parseCodexTestEvent, parseCodexClaimedTest, readCodexClaimedTest, readCodexCommandEvent, projectCodexClaimObservation, matchCodexClaimEvent, parseCodexHumanChoice, readCodexHumanChoice, scanCodexHumanChoiceRecords, locateCodexHumanChoice, parseCodexIndependentTurn, readCodexIndependentTurn, buildCodexOpenConfirmation, deriveCodexOpenDecision, matchCodexOpenDecision } from '../lib/adapters/codex-host-source.js';
import { envelopeDigest } from '../lib/delivery/evidence.js';

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const threadId='01a15314-be07-77f2-b11d-93ad347f9420';
const turnId='01a18b71-dd2c-7321-a4d7-e0fe1b621ea7';
const itemId='exec-248379cf-5d2c-48ca-a39f-72299c91ff20';
const item={type:'CommandExecution',id:itemId,status:'completed',exit_code:0,command:['/bin/zsh','-lc','node --test test.mjs'],cwd:'/fixture',aggregated_output:'TAP version 13\n# Subtest: case one\nok 1 - case one\n1..1\n# tests 1\n# pass 1\n# fail 0\n'};
const record={type:'event_msg',payload:{type:'item_completed',thread_id:threadId,turn_id:turnId,item}};
const expected={threadId,turnId,itemId,commandDigest:hash(JSON.stringify({argv:item.command,cwd:item.cwd}))};

test('host test observation measures the actual TAP without granting acceptance',()=>{
 const got=parseCodexTestEvent(Buffer.from(JSON.stringify(record)),expected);
 assert.equal(got.ok,true);assert.equal(got.outcome,'pass');assert.equal(got.summary.tests,1);assert.equal(got.summary.pass,1);
 assert.equal(got.outputDigest,hash(item.aggregated_output));assert.equal(got.sourceQualified,false);assert.equal(got.managedClosureEligible,false);
 assert.equal(Object.hasOwn(got,'output'),false);
 const red={...record,payload:{...record.payload,item:{...item,status:'failed',exit_code:1,aggregated_output:'TAP version 13\n# Subtest: case one\nnot ok 1 - case one\n1..1\n# tests 1\n# pass 0\n# fail 1\n'}}};
 const failure=parseCodexTestEvent(Buffer.from(JSON.stringify(red)),expected);
 assert.equal(failure.ok,true);assert.equal(failure.outcome,'behavior-red');assert.equal(failure.summary.fail,1);
 const literal={...record,payload:{...record.payload,item:{...item,aggregated_output:'TAP version 13\n# Subtest: literal \\# TODO words\nok 1 - literal \\# TODO words\n1..1\n# tests 1\n# pass 1\n# fail 0\n'}}};
 assert.equal(parseCodexTestEvent(Buffer.from(JSON.stringify(literal)),expected).ok,true,'escaped literal is not a TODO directive');
 for(const bad of [
  {...record,payload:{...record.payload,item:{...item,aggregated_output:'not TAP'}}},
  {...record,payload:{...record.payload,item:{...item,aggregated_output:'# tests 1\n# pass 1\n'}}},
  {...record,payload:{...record.payload,item:{...item,aggregated_output:'TAP version 13\n1..1\n# tests 1\n# pass 1\n'}}},
  {...record,payload:{...record.payload,item:{...item,aggregated_output:'TAP version 13\nok 1 - partial\n# tests 1\n# pass 1\n'}}},
  {...record,payload:{...record.payload,item:{...item,aggregated_output:'TAP version 13\nnot ok 1 - failed\n1..1\n# tests 1\n# pass 0\n# fail 1\n'+item.aggregated_output}}},
  {...record,payload:{...record.payload,item:{...item,aggregated_output:'TAP version 13\n# Subtest: outer\n    # Subtest: inner\n    not ok 1 - inner\nok 1 - outer\n1..1\n# tests 1\n# pass 1\n# fail 0\n'}}},
  {...record,payload:{...record.payload,item:{...item,aggregated_output:item.aggregated_output+'Bail out! fatal\n'}}},
  {...record,payload:{...record.payload,item:{...item,aggregated_output:'TAP version 13\nok 1 - only one\n1..1\n# tests 100\n# pass 100\n# fail 0\n'}}},
  {...record,payload:{...record.payload,item:{...item,aggregated_output:'TAP version 13\n    ok 1 - hidden # SKIP\n    1..1\nok 1 - outer\n1..1\n# tests 2\n# pass 2\n# fail 0\n# skipped 0\n'}}},
  {...record,payload:{...record.payload,item:{...item,aggregated_output:'TAP version 13\n    ok 1 - first\n    ok 1 - second\n    1..2\nok 1 - outer\n1..1\n# tests 3\n# pass 3\n# fail 0\n'}}},
  {...record,payload:{...record.payload,item:{...item,aggregated_output:'TAP version 13\n    ok 1 - child\nok 1 - outer\n1..1\n# tests 2\n# pass 2\n# fail 0\n'}}},
  {...record,payload:{...record.payload,item:{...item,aggregated_output:'TAP version 13\n    # Subtest: phantom\n    ok 1 - phantom\n    1..1\nok 1 - actual\n1..1\n# tests 2\n# pass 2\n# fail 0\n'}}},
  {...record,payload:{...record.payload,item:{...item,aggregated_output:'TAP version 13\n# tests 0\n# pass 0\n'}}},
  {...record,payload:{...record.payload,item:{...item,aggregated_output:'TAP version 13\n# tests 2\n# pass 1\n'}}},
  {...record,payload:{...record.payload,item:{...item,command:['echo','forged']}}},
 ]) assert.equal(parseCodexTestEvent(Buffer.from(JSON.stringify(bad)),expected).ok,false);
});

test('host command projection binds the exact event and exposes no raw log or acceptance verdict',()=>{
 const got=parseCodexCommandEvent(Buffer.from(JSON.stringify(record)),expected);
 assert.equal(got.ok,true);assert.equal(got.commandDigest,expected.commandDigest);assert.equal(got.outputDigest,hash(item.aggregated_output));
 assert.equal(got.exitCode,0);assert.equal(got.sourceQualified,false);assert.equal(got.managedClosureEligible,false);
 assert.equal(Object.hasOwn(got,'output'),false);assert.equal(Object.hasOwn(got,'verdict'),false);
});

test('Codex file-URI working directories are preserved and bound exactly',()=>{
 const uriItem={...item,cwd:'file:///fixture'};
 const uriRecord={...record,payload:{...record.payload,item:uriItem}};
 const uriExpected={...expected,commandDigest:hash(JSON.stringify({argv:uriItem.command,cwd:uriItem.cwd}))};
 assert.equal(parseCodexCommandEvent(Buffer.from(JSON.stringify(uriRecord)),uriExpected).ok,true);
 const invalid={...uriRecord,payload:{...uriRecord.payload,item:{...uriItem,cwd:'file:///fixture?other=1'}}};
 assert.equal(parseCodexCommandEvent(Buffer.from(JSON.stringify(invalid)),uriExpected).ok,false);
});

test('identity, command and terminal status mismatches fail closed',()=>{
 const variants=[
  {...record,payload:{...record.payload,thread_id:'other'}},
  {...record,payload:{...record.payload,turn_id:'other'}},
  {...record,payload:{...record.payload,type:'item_started'}},
  {...record,payload:{...record.payload,item:{...item,id:'exec-other'}}},
  {...record,payload:{...record.payload,item:{...item,command:['echo','fake']}}},
  {...record,payload:{...record.payload,item:{...item,cwd:'/other'}}},
  {...record,payload:{...record.payload,item:{...item,status:'inProgress',exit_code:null}}},
  {...record,payload:{...record.payload,item:{...item,aggregated_output:null}}},
 ];
 for(const value of variants) assert.equal(parseCodexCommandEvent(Buffer.from(JSON.stringify(value)),expected).ok,false);
 assert.equal(parseCodexCommandEvent(Buffer.from('{bad-json'),expected).ok,false);
 assert.equal(parseCodexCommandEvent(Buffer.alloc(2*1024*1024+1,32),expected).ok,false);
});

test('a worker-selected file outside the OS user sessions root cannot become host source',()=>{
 const loc={sessionPath:`/private/tmp/fake-${threadId}.jsonl`,offset:0,length:1,...expected};
 assert.equal(readCodexCommandEvent(loc).ok,false);
 for(const invalid of [{...loc,offset:-1},{...loc,length:0},{...loc,length:2*1024*1024+1},
   {...loc,sessionPath:'relative.jsonl'},{...loc,threadId:'../../escape'}]) {
  assert.equal(readCodexCommandEvent(invalid).ok,false);
 }
});

test('claim observation binds the same Run, revision, action and host session without exposing the token',()=>{
 const token='fixture-sensitive-token-never-output';
 const actionInput={change:'run-1',outputs:{design:'fixture'}};
 const action={id:'run-1:5',stepId:'full.verify.run',attempt:1,input:actionInput,inputHash:envelopeDigest(actionInput),status:'running',claim:{sessionId:threadId,executorId:'skill-host',token}};
 const workflow={id:'comet-classic-full',version:'1'};
 const record={runId:'run-1',revision:9,application:{id:'sdd-managed-delivery',runtimeVersion:'0.5.1',contentHash:'a'.repeat(64)},run:{runId:'run-1',revision:9,status:'running',workflow,actions:[action]}};
 const query={runId:'run-1',revision:9,status:'running',workflow,actions:[structuredClone(action)]};
 const input={runId:'run-1',actionId:action.id,threadId,expectedRevision:9,expectedApplicationHash:'a'.repeat(64),record,query};
 const result=projectCodexClaimObservation(input);
 assert.equal(result.ok,true);assert.equal(result.claimTokenDigest,hash(token));assert.equal(result.sourceQualified,false);
 assert.equal(result.stepId,'full.verify.run');
 assert.equal(result.actionInputHash,envelopeDigest(actionInput));
 assert.equal(result.managedClosureEligible,false);assert.doesNotMatch(JSON.stringify(result),/fixture-sensitive-token/);
 for(const bad of [
  {...input,threadId:turnId}, {...input,runId:'other'}, {...input,actionId:'other'},
  {...input,expectedRevision:8}, {...input,expectedApplicationHash:'c'.repeat(64)},
  {...input,query:{...query,revision:10}}, {...input,record:{...record,application:{...record.application,runtimeVersion:'0.5.0'}}},
  {...input,query:{...query,actions:[{...action,claim:{...action.claim,token:'different'}}]}},
  {...input,query:{...query,actions:[{...action,inputHash:'c'.repeat(64)}]}},
  {...input,query:{...query,actions:[{...action,input:{change:'other'}}]},record:{...record,run:{...record.run,actions:[{...action,input:{change:'other'}}]}}},
  {...input,query:{...query,actions:[{...action,input:undefined}]},record:{...record,run:{...record.run,actions:[{...action,input:undefined}]}}},
  {...input,query:{...query,actions:[{...action,claim:{...action.claim,executorId:'other'}}]}},
  {...input,query:{...query,actions:[{...action,status:'succeeded'}]}},
  {...input,query:{...query,actions:[action,action]}},
 ]) assert.equal(projectCodexClaimObservation(bad).ok,false);
});

test('a host event only matches the exact same-Run claim projection and remains unqualified',()=>{
 const claim={ok:true,scope:'codex-host-observation',sourceQualified:false,managedClosureEligible:false,
  threadId,runId:'run-1',actionId:'run-1:5',stepId:'full.verify.run',revision:9,applicationHash:'a'.repeat(64),actionInputHash:'c'.repeat(64),claimTokenDigest:'b'.repeat(64)};
 const event={ok:true,scope:'codex-host-observation',sourceQualified:false,managedClosureEligible:false,
  threadId,turnId,itemId,commandDigest:'c'.repeat(64),outputDigest:hash(JSON.stringify(claim)+'\n'),exitCode:0,status:'completed'};
 const value=matchCodexClaimEvent({claim,event});
 assert.equal(value.ok,true);assert.equal(value.sourceQualified,false);assert.equal(value.managedClosureEligible,false);
 for(const bad of [
  {claim:{...claim,revision:10},event}, {claim,event:{...event,threadId:turnId}},
  {claim,event:{...event,outputDigest:'d'.repeat(64)}}, {claim,event:{...event,exitCode:1}},
  {claim:{...claim,sourceQualified:true},event}, {claim,event:{...event,managedClosureEligible:true}},
 ]) assert.equal(matchCodexClaimEvent(bad).ok,false);
});

test('one test observation is bounded by matching before and after Comet claims in the same host turn',()=>{
 const claim={ok:true,scope:'codex-host-observation',sourceQualified:false,managedClosureEligible:false,
  threadId,runId:'run-1',actionId:'run-1:5',stepId:'full.verify.run',revision:9,applicationHash:'a'.repeat(64),actionInputHash:'c'.repeat(64),claimTokenDigest:'b'.repeat(64)};
 const beforeId='exec-11111111-1111-1111-1111-111111111111',afterId='exec-22222222-2222-2222-2222-222222222222';
 const eventFor=id=>({...record,payload:{...record.payload,item:{...item,id,aggregated_output:JSON.stringify(claim)+'\n'}}});
 const input={before:Buffer.from(JSON.stringify(eventFor(beforeId))),test:Buffer.from(JSON.stringify(record)),after:Buffer.from(JSON.stringify(eventFor(afterId))),
  expectedBefore:{...expected,itemId:beforeId},expectedTest:expected,expectedAfter:{...expected,itemId:afterId},claimBefore:claim,claimAfter:{...claim}};
 const result=parseCodexClaimedTest(input);
 assert.equal(result.ok,true);assert.equal(result.runId,'run-1');assert.equal(result.summary.tests,1);
 assert.equal(result.sourceQualified,false);assert.equal(result.managedClosureEligible,false);
 for(const bad of [{...input,claimAfter:{...claim,revision:10}},{...input,claimAfter:{...claim,actionId:'run-1:6'}},{...input,claimAfter:{...claim,stepId:'full.open'}},{...input,claimAfter:{...claim,actionInputHash:'d'.repeat(64)}},
  {...input,expectedAfter:{...expected,turnId:threadId}},{...input,expectedTest:{...expected,commandDigest:'c'.repeat(64)}}])
  assert.equal(parseCodexClaimedTest(bad).ok,false);
});

test('claimed-test reader rejects external sources and reordered or overlapping events',()=>{
 const span=n=>({offset:n,length:10}),sessionPath=`/private/tmp/fake-${threadId}.jsonl`;
 for(const [before,observed,after] of [[span(0),span(20),span(40)],[span(20),span(0),span(40)],[span(0),span(5),span(40)]])
  assert.equal(readCodexClaimedTest({sessionPath,before,test:observed,after,expectedBefore:expected,expectedTest:expected,expectedAfter:expected}).ok,false);
});

test('human choice observation links the original question to the exact user selection without granting approval',()=>{
 const callId='call_0123456789abcdef';const replyItemId='01a1531f-12c1-76e2-9218-407d01b0c281';
 const title='Approve this frozen scope?';const answer='Approve';
 const question={type:'response_item',payload:{type:'function_call',name:'request_user_input_async',call_id:callId,
  arguments:JSON.stringify({questions:[{title,options:[answer,'Reject']}]})}};
 const body=JSON.stringify([{questionItemId:JSON.stringify(['request_user_input_async',callId,0]),question:title,answer}]);
 const reply={type:'event_msg',payload:{type:'item_completed',thread_id:threadId,turn_id:turnId,
  item:{type:'UserMessage',id:replyItemId,client_id:'user-client',content:[{type:'text',text:`<send_user_message_question_reply>\n${body}\n</send_user_message_question_reply>`}]}}};
 const expected={threadId,turnId,replyItemId,callId,index:0,questionDigest:hash(title),optionsDigest:hash(JSON.stringify([answer,'Reject'])),answerDigest:hash(answer)};
 const parse=(q,r,e=expected)=>parseCodexHumanChoice(Buffer.from(JSON.stringify(q)),Buffer.from(JSON.stringify(r)),e);
 const got=parse(question,reply);assert.equal(got.ok,true);assert.equal(got.sourceQualified,false);assert.equal(got.managedClosureEligible,false);
 assert.equal(got.questionDigest,expected.questionDigest);assert.equal(got.optionsDigest,expected.optionsDigest);assert.equal(got.answerDigest,expected.answerDigest);
 assert.equal(Object.hasOwn(got,'answer'),false);assert.equal(Object.hasOwn(got,'approval'),false);
 for(const bad of [
  {...expected,questionDigest:hash('another')}, {...expected,optionsDigest:hash('other-options')}, {...expected,answerDigest:hash('Reject')}, {...expected,index:1},
  {...expected,callId:'call_another123'}, {...expected,threadId:turnId}, {...expected,replyItemId:turnId},
 ]) assert.equal(parse(question,reply,bad).ok,false);
 assert.equal(parse(question,{...reply,payload:{...reply.payload,item:{...reply.payload.item,client_id:null}}}).ok,false);
 const forged=JSON.stringify([{questionItemId:JSON.stringify(['request_user_input_async',callId,0]),question:title,answer:'Unknown'}]);
 assert.equal(parse(question,{...reply,payload:{...reply.payload,item:{...reply.payload.item,content:[{type:'text',text:`<send_user_message_question_reply>${forged}</send_user_message_question_reply>`}]}}}).ok,false);
 const duplicate=JSON.stringify(JSON.parse(body).concat(JSON.parse(body)));
 assert.equal(parse(question,{...reply,payload:{...reply.payload,item:{...reply.payload.item,content:[{type:'text',text:`<send_user_message_question_reply>${duplicate}</send_user_message_question_reply>`}]}}}).ok,false);
 const ambiguous={...question,payload:{...question.payload,arguments:`{"questions":[{"title":"Other","title":"${title}","options":["${answer}","Reject"]}]}`}};
 assert.equal(parse(ambiguous,reply).ok,false,'duplicate decoded fields cannot define the approved question');
 const duplicateOptions={...question,payload:{...question.payload,arguments:JSON.stringify({questions:[{title,options:[answer,answer]}]})}};
 assert.equal(parse(duplicateOptions,reply).ok,false,'duplicate choices do not uniquely identify a selection');
 const escaped={...question,payload:{...question.payload,arguments:`{"questions":[{"t\\u0069tle":"Other","title":"${title}","options":["${answer}","Reject"]}]}`}};
 assert.equal(parse(escaped,reply).ok,false,'escaped duplicate names cannot bypass the check');
 const duplicateAnswer=`[{"questionItemId":${JSON.stringify(JSON.stringify(['request_user_input_async',callId,0]))},"question":${JSON.stringify(title)},"answer":"Reject","answer":"${answer}"}]`;
 assert.equal(parse(question,{...reply,payload:{...reply.payload,item:{...reply.payload.item,content:[{type:'text',text:`<send_user_message_question_reply>${duplicateAnswer}</send_user_message_question_reply>`}]}}}).ok,false);
});

test('a worker-selected external file or reversed event order cannot become human-choice source',()=>{
 const params={sessionPath:`/private/tmp/fake-${threadId}.jsonl`,question:{offset:0,length:1},reply:{offset:2,length:1},
  threadId,turnId,replyItemId:turnId,callId:'call_0123456789abcdef',index:0,questionDigest:'a'.repeat(64),optionsDigest:'c'.repeat(64),answerDigest:'b'.repeat(64)};
 assert.equal(readCodexHumanChoice(params).ok,false);
 assert.equal(readCodexHumanChoice({...params,question:{offset:2,length:1},reply:{offset:0,length:1}}).ok,false);
});

test('choice locator finds exactly one ordered host question and reply without revealing contents',()=>{
 const callId='call_0123456789abcdef',replyItemId='01a1531f-12c1-76e2-9218-407d01b0c281',title='Fixture question',answer='Yes';
 const q={type:'response_item',payload:{type:'function_call',name:'request_user_input_async',call_id:callId,arguments:JSON.stringify({questions:[{title,options:[answer,'No']}]})}};
 const body=JSON.stringify([{questionItemId:JSON.stringify(['request_user_input_async',callId,0]),question:title,answer}]);
 const r={type:'event_msg',payload:{type:'item_completed',thread_id:threadId,turn_id:turnId,item:{type:'UserMessage',id:replyItemId,client_id:'user-client',content:[{type:'text',text:`<send_user_message_question_reply>${body}</send_user_message_question_reply>`}]}}};
 const qline=Buffer.from(JSON.stringify(q)+'\n'),rline=Buffer.from(JSON.stringify(r)+'\n');
 const data=Buffer.concat([Buffer.from('{}\n'),qline,Buffer.from('{}\n'),rline]);
 const result=scanCodexHumanChoiceRecords(data,{baseOffset:100,threadId,callId,index:0});
 assert.equal(result.ok,true);assert.equal(result.question.offset,103);assert.equal(result.question.length,qline.length-1);
 assert.equal(result.reply.offset,103+qline.length+3);assert.equal(result.reply.length,rline.length-1);assert.equal(result.replyItemId,replyItemId);
 assert.equal(result.sourceQualified,false);assert.equal(result.managedClosureEligible,false);assert.doesNotMatch(JSON.stringify(result),/Fixture question|Yes/);
 for(const bad of [Buffer.concat([data,rline]),Buffer.concat([rline,qline]),data.subarray(0,data.length-1),Buffer.alloc(16*1024*1024+1)]) {
  assert.equal(scanCodexHumanChoiceRecords(bad,{baseOffset:100,threadId,callId,index:0}).ok,false);
 }
});

test('host choice locator refuses arbitrary external paths and invalid scan offsets',()=>{
 const input={sessionPath:`/private/tmp/fake-${threadId}.jsonl`,threadId,callId:'call_0123456789abcdef',index:0,scanStart:0};
 assert.equal(locateCodexHumanChoice(input).ok,false);
 assert.equal(locateCodexHumanChoice({...input,scanStart:-1}).ok,false);
 assert.equal(locateCodexHumanChoice({...input,sessionPath:'relative.jsonl'}).ok,false);
});

test('independent Agent turn links host spawn, child identity, completed turn and report digest without granting review',()=>{
 const child='01a154c5-4e8d-7d02-aee6-254a335888b9',childTurn='01a154c5-5056-7871-baef-9111b5f892ae';
 const spawnId='call_eb45a47c2f3b4f7abd051b4f438c3797',agentPath='/root/reviewer',message='fixture review result';
 const event=(kind,item)=>({type:'event_msg',payload:{type:'item_completed',thread_id:threadId,turn_id:turnId,item:{type:'SubAgentActivity',kind,agent_thread_id:child,agent_path:agentPath,...item}}});
 const spawn=event('started',{id:spawnId}),complete=event('completed',{id:`subagent-completed-${childTurn}`});
 const meta={type:'session_meta',payload:{id:child,session_id:threadId,thread_source:'subagent',source:{subagent:{thread_spawn:{parent_thread_id:threadId,agent_path:agentPath}}}}};
 const start={type:'event_msg',payload:{type:'task_started',turn_id:childTurn,root_turn_id:turnId,started_at:10}};
 const end={type:'event_msg',payload:{type:'task_complete',turn_id:childTurn,root_turn_id:turnId,started_at:10,completed_at:20,last_agent_message:message}};
 const expected={rootThreadId:threadId,parentTurnId:turnId,childThreadId:child,childTurnId:childTurn,authorThreadId:threadId,spawnId,reportDigest:hash(message)};
 const parse=(s=spawn,m=meta,a=start,b=end,c=complete,e=expected)=>parseCodexIndependentTurn(...[s,m,a,b,c].map(v=>Buffer.from(JSON.stringify(v))),e);
 const got=parse();assert.equal(got.ok,true);assert.equal(got.sourceQualified,false);assert.equal(got.managedClosureEligible,false);
 assert.equal(Object.hasOwn(got,'report'),false);assert.equal(Object.hasOwn(got,'verdict'),false);
 for(const bad of [{...expected,authorThreadId:child},{...expected,reportDigest:hash('stale')},{...expected,childTurnId:turnId},
  {...expected,rootThreadId:child},{...expected,spawnId:'call_other123'}]) assert.equal(parse(spawn,meta,start,end,complete,bad).ok,false);
 assert.equal(parse(spawn,{...meta,payload:{...meta.payload,thread_source:'user'}}).ok,false);
 assert.equal(parse(spawn,meta,start,{...end,payload:{...end.payload,root_turn_id:childTurn}}).ok,false);
 assert.equal(parse(spawn,meta,start,end,event('completed',{id:`subagent-completed-${turnId}`})).ok,false);
});

test('independent-turn reader refuses external paths and reversed event order',()=>{
 const child='01a154c5-4e8d-7d02-aee6-254a335888b9',childTurn='01a154c5-5056-7871-baef-9111b5f892ae';
 const input={parentSessionPath:`/private/tmp/root-${threadId}.jsonl`,childSessionPath:`/private/tmp/child-${child}.jsonl`,
  spawn:{offset:2,length:1},completion:{offset:4,length:1},childMeta:{offset:0,length:1},start:{offset:2,length:1},finish:{offset:4,length:1},
  rootThreadId:threadId,parentTurnId:turnId,childThreadId:child,childTurnId:childTurn,authorThreadId:threadId,spawnId:'call_0123456789abcdef',reportDigest:'a'.repeat(64)};
 assert.equal(readCodexIndependentTurn(input).ok,false);
 assert.equal(readCodexIndependentTurn({...input,spawn:{offset:5,length:1}}).ok,false);
 assert.equal(readCodexIndependentTurn({...input,start:{offset:5,length:1}}).ok,false);
 assert.equal(readCodexIndependentTurn({...input,childMeta:{offset:1,length:1}}).ok,false);
});

test('the native Open confirmation prompt binds the exact Run, wait and frozen requirement proposal',()=>{
 const ref='openspec/changes/example-change';const contentHash='a'.repeat(64);
 const proposal={outputs:{'full.open.evidence':{ref,contentHash}}};
 const evidence={ref,contentHash};
 const wait={id:'example-change:wait-1',stepId:'full.open.confirm',status:'pending',sequence:5,proposal,proposalHash:envelopeDigest(proposal),choices:['approved','rejected'],results:{'full.open.evidence':{sequence:4,value:evidence}}};
 const run={runId:'example-change',input:{change:'example-change',changeDir:ref},outputs:{'full.open.evidence':{sequence:4,value:evidence}},waits:[wait]};
 const result=buildCodexOpenConfirmation({run,waitId:wait.id});
 assert.equal(result.ok,true);assert.equal(result.sourceQualified,false);assert.equal(result.managedClosureEligible,false);
 assert.equal(result.questionDigest,hash(result.title));assert.equal(result.optionsDigest,hash(JSON.stringify(result.options)));
 assert.match(result.title,/example-change/);assert.ok(result.title.includes(wait.proposalHash));
 assert.deepEqual(result.options,['确认需求并继续审查','退回需求澄清']);
 const revised={...wait,id:'example-change:wait-2',sequence:6};
 const later=buildCodexOpenConfirmation({run:{...run,waits:[revised]},waitId:revised.id});
 assert.equal(later.ok,true);assert.notEqual(later.questionDigest,result.questionDigest,'an old answer cannot target a new wait');
 assert.equal(buildCodexOpenConfirmation({run:{...run,waits:[wait,revised]},waitId:wait.id}).ok,false,'a superseded native wait cannot be confirmed');
 const resolved={...wait,status:'resolved',decision:{id:'fixture-decision',choice:'approved',proposalHash:wait.proposalHash}};
 const resolvedRun={...run,waits:[resolved],outputs:{...run.outputs,'full.open.confirm':{sequence:wait.sequence,value:{choice:'approved',proposal}}}};
 assert.equal(buildCodexOpenConfirmation({run:resolvedRun,waitId:wait.id}).questionDigest,result.questionDigest,'confirmation keeps the same frozen question');
 assert.equal(buildCodexOpenConfirmation({run:{...resolvedRun,outputs:{...resolvedRun.outputs,'full.open.confirm':{sequence:wait.sequence,value:{choice:'rejected',proposal}}}},waitId:wait.id}).ok,false,'a mismatched native decision is not the approved wait');
 for (const bad of [
  {run:{...run,input:{...run.input,changeDir:'openspec/changes/other'}},waitId:wait.id},
  {run:{...run,waits:[{...wait,proposal:{outputs:{'full.open.evidence':{ref,contentHash:'b'.repeat(64)}}}}]},waitId:wait.id},
  {run:{...run,outputs:{'full.open.evidence':{sequence:4,value:{ref,contentHash:'b'.repeat(64)}}}},waitId:wait.id},
  {run:{...run,waits:[{...wait,choices:['approved']}]},waitId:wait.id},
  {run:{...run,waits:[wait,wait]},waitId:wait.id}, {run,waitId:'missing'},
 ]) assert.equal(buildCodexOpenConfirmation(bad).ok,false);
});

test('a Codex user choice matches only its native Open wait and never itself grants a gate',()=>{
 const ref='openspec/changes/example-change',evidence={ref,contentHash:'a'.repeat(64)};
 const proposal={outputs:{'full.open.evidence':evidence}},wait={id:'example-change:wait-1',stepId:'full.open.confirm',status:'pending',sequence:5,proposal,proposalHash:envelopeDigest(proposal),choices:['approved','rejected'],results:{'full.open.evidence':{sequence:4,value:evidence}}};
 const run={runId:'example-change',input:{change:'example-change',changeDir:ref},outputs:{'full.open.evidence':{sequence:4,value:evidence}},waits:[wait]};
 const prompt=buildCodexOpenConfirmation({run,waitId:wait.id});const callId='call_0123456789abcdef',replyItemId='01a1531f-12c1-76e2-9218-407d01b0c281';
 const question={type:'response_item',payload:{type:'function_call',name:'request_user_input_async',call_id:callId,arguments:JSON.stringify({questions:[{title:prompt.title,options:prompt.options}]})}};
 const answer=prompt.options[0],body=JSON.stringify([{questionItemId:JSON.stringify(['request_user_input_async',callId,0]),question:prompt.title,answer}]);
 const reply={type:'event_msg',payload:{type:'item_completed',thread_id:threadId,turn_id:turnId,item:{type:'UserMessage',id:replyItemId,client_id:'user-client',content:[{type:'text',text:`<send_user_message_question_reply>${body}</send_user_message_question_reply>`}]}}};
 const choice=parseCodexHumanChoice(Buffer.from(JSON.stringify(question)),Buffer.from(JSON.stringify(reply)),{threadId,turnId,replyItemId,callId,index:0,questionDigest:prompt.questionDigest,optionsDigest:prompt.optionsDigest,answerDigest:prompt.approvedAnswerDigest});
 const decision=deriveCodexOpenDecision({run,waitId:wait.id,choice});assert.equal(decision.ok,true);assert.equal(decision.nativeChoice,'approved');assert.equal(decision.sourceQualified,false);
 const resolved={...wait,status:'resolved',decision:{id:decision.decisionId,choice:'approved',proposalHash:wait.proposalHash}};
 const resolvedRun={...run,waits:[resolved],outputs:{...run.outputs,'full.open.confirm':{sequence:wait.sequence,value:{choice:'approved',proposal}}}};
 const matched=matchCodexOpenDecision({run:resolvedRun,waitId:wait.id,choice});assert.equal(matched.ok,true);assert.equal(matched.sourceQualified,false);assert.equal(matched.managedClosureEligible,false);
 assert.equal(matchCodexOpenDecision({run,waitId:wait.id,choice}).ok,false,'an unresolved native wait is not a recorded decision');
 const rejectBody=JSON.stringify([{questionItemId:JSON.stringify(['request_user_input_async',callId,0]),question:prompt.title,answer:prompt.options[1]}]);
 const rejectReply={...reply,payload:{...reply.payload,item:{...reply.payload.item,content:[{type:'text',text:`<send_user_message_question_reply>${rejectBody}</send_user_message_question_reply>`}]}}};
 const rejectedChoice=parseCodexHumanChoice(Buffer.from(JSON.stringify(question)),Buffer.from(JSON.stringify(rejectReply)),{threadId,turnId,replyItemId,callId,index:0,questionDigest:prompt.questionDigest,optionsDigest:prompt.optionsDigest,answerDigest:prompt.rejectedAnswerDigest});
 const rejected=deriveCodexOpenDecision({run,waitId:wait.id,choice:rejectedChoice});assert.equal(rejected.nativeChoice,'rejected');assert.notEqual(rejected.decisionId,decision.decisionId);
 for(const bad of [
  {run:resolvedRun,waitId:wait.id,choice:{...choice,decisionDigest:'f'.repeat(64)}},
  {run:resolvedRun,waitId:wait.id,choice:{...choice,optionsDigest:'e'.repeat(64)}},
  {run:{...resolvedRun,waits:[{...resolved,decision:{...resolved.decision,id:'forged'}}]},waitId:wait.id,choice},
  {run:{...resolvedRun,waits:[resolved,{...wait,id:'example-change:wait-2',sequence:6}]},waitId:wait.id,choice},
 ]) assert.equal(matchCodexOpenDecision(bad).ok,false);
});

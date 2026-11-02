// Read-only Codex host event observation. This module does not qualify an
// identity, approve a scope, dispatch an agent, or grant a Comet gate.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { envelopeDigest } from '../delivery/evidence.js';
import { measureCodexTestOutput } from './codex-test-observation.js';

const LIMIT = 2 * 1024 * 1024;
const SCAN_LIMIT = 16 * 1024 * 1024;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{64}$/;
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const refusal = () => ({ok:false,scope:'codex-host-observation',sourceQualified:false,managedClosureEligible:false});
const strictJson = source => {
  if (typeof source!=='string' || Buffer.byteLength(source)>LIMIT) throw Error('invalid JSON size');
  const result=JSON.parse(source),stack=[];
  for (let i=0;i<source.length;i++) {
    const c=source[i];
    if (c==='"') {
      const start=i;
      while (++i<source.length) { if(source[i]==='\\')i++;else if(source[i]==='"')break; }
      const top=stack.at(-1);
      if(top?.keys && top.expectKey) {
        const key=JSON.parse(source.slice(start,i+1));
        if(top.keys.has(key))throw Error('duplicate JSON key');
        top.keys.add(key);top.expectKey=false;
      }
    } else if(c==='{'||c==='[')stack.push(c==='{'?{keys:new Set(),expectKey:true}:{});
    else if(c==='}'||c===']')stack.pop();
    else if(c===',' && stack.at(-1)?.keys)stack.at(-1).expectKey=true;
  }
  return result;
};
const absoluteHostCwd = value => {
  if (typeof value!=='string') return false;
  if (path.isAbsolute(value)) return true;
  try {
    const url=new URL(value);
    return url.protocol==='file:' && !url.search && !url.hash && path.isAbsolute(fileURLToPath(url));
  } catch { return false; }
};

// Derive the exact user-facing question from Comet's own pending/resolved
// Open wait. The displayed confirmation identifier makes an old response
// unsuitable for a new wait even if requirement bytes later return to an
// earlier value. Building a question does not approve or qualify anything.
export function buildCodexOpenConfirmation({run,waitId} = {}) {
  try {
    const change=run?.input?.change,ref=run?.input?.changeDir;
    if (typeof change!=='string' || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(change)
      || run.runId!==change || ![`openspec/changes/${change}`,`docs/openspec/changes/${change}`].includes(ref)
      || typeof waitId!=='string' || !/^[A-Za-z0-9._:-]{1,200}$/.test(waitId) || !Array.isArray(run.waits)) return refusal();
    const waits=run.waits.filter(wait=>wait?.id===waitId);
    if (waits.length!==1) return refusal();
    const wait=waits[0], evidence=wait?.proposal?.outputs?.['full.open.evidence'];
    const openWaits=run.waits.filter(value=>value?.stepId==='full.open.confirm');
    const currentEvidence=run.outputs?.['full.open.evidence'];
    if (wait.stepId!=='full.open.confirm' || !['pending','resolved'].includes(wait.status)
      || !Number.isSafeInteger(wait.sequence) || wait.sequence<1 || !SHA.test(wait.proposalHash ?? '')
      || openWaits.some(value=>!Number.isSafeInteger(value.sequence) || value.sequence<1)
      || new Set(openWaits.map(value=>value.sequence)).size!==openWaits.length
      || openWaits.some(value=>value.sequence>wait.sequence)
      || !Array.isArray(wait.choices) || !isDeepStrictEqual([...wait.choices].sort(),['approved','rejected'])
      || envelopeDigest(wait.proposal)!==wait.proposalHash || evidence?.ref!==ref || !SHA.test(evidence?.contentHash ?? '')
      || !Number.isSafeInteger(currentEvidence?.sequence) || currentEvidence.sequence<1
      || wait.results?.['full.open.evidence']?.sequence!==currentEvidence.sequence
      || !isDeepStrictEqual(wait.results['full.open.evidence'].value,currentEvidence.value)
      || !isDeepStrictEqual(evidence,currentEvidence.value)
      || wait.status==='resolved' && (!['approved','rejected'].includes(wait.decision?.choice)
        || wait.decision.proposalHash!==wait.proposalHash
        || run.outputs?.['full.open.confirm']?.sequence!==wait.sequence
        || !isDeepStrictEqual(run.outputs['full.open.confirm'].value,{choice:wait.decision.choice,proposal:wait.proposal}))) return refusal();
    const title=`请确认变更「${change}」的需求：查看 ${ref} 中的目标、范围、非目标和验收标准。确认编号：${wait.id}；需求版本：${evidence.contentHash}；确认基线：${wait.proposalHash}。`;
    const options=['确认需求并继续审查','退回需求澄清'];
    return {ok:true,scope:'codex-open-confirmation-prompt',sourceQualified:false,managedClosureEligible:false,
      runId:change,waitId:wait.id,title,options,questionDigest:hash(title),optionsDigest:hash(JSON.stringify(options)),
      approvedAnswerDigest:hash(options[0]),rejectedAnswerDigest:hash(options[1])};
  } catch { return refusal(); }
}

// Link a host-observed choice to one immutable native Open wait. This computes
// a reproducible SDK decision ID; it does not authenticate the observation
// or itself resolve the wait. The protected caller must establish source and
// user authority before using it to satisfy R.
export function deriveCodexOpenDecision({run,waitId,choice} = {}) {
  try {
    const prompt=buildCodexOpenConfirmation({run,waitId});
    if (!prompt.ok || choice?.ok!==true || choice.scope!=='codex-host-choice-observation'
      || choice.sourceQualified!==false || choice.managedClosureEligible!==false
      || !ID.test(choice.threadId ?? '') || !ID.test(choice.turnId ?? '') || !ID.test(choice.replyItemId ?? '')
      || !/^call_[A-Za-z0-9]{8,128}$/.test(choice.callId ?? '') || !Number.isSafeInteger(choice.index) || choice.index<0 || choice.index>2
      || choice.questionDigest!==prompt.questionDigest || choice.optionsDigest!==prompt.optionsDigest
      || !SHA.test(choice.decisionDigest ?? '')) return refusal();
    const actual=hash(JSON.stringify({threadId:choice.threadId,turnId:choice.turnId,replyItemId:choice.replyItemId,
      callId:choice.callId,index:choice.index,questionDigest:choice.questionDigest,optionsDigest:choice.optionsDigest,answerDigest:choice.answerDigest}));
    if (actual!==choice.decisionDigest) return refusal();
    const nativeChoice=choice.answerDigest===prompt.approvedAnswerDigest ? 'approved'
      : choice.answerDigest===prompt.rejectedAnswerDigest ? 'rejected' : null;
    if (!nativeChoice) return refusal();
    const decisionId=`codex-user-choice:${hash(JSON.stringify({runId:prompt.runId,waitId:prompt.waitId,
      questionDigest:prompt.questionDigest,decisionDigest:choice.decisionDigest}))}`;
    return {ok:true,scope:'codex-open-decision-observation',sourceQualified:false,managedClosureEligible:false,
      runId:prompt.runId,waitId:prompt.waitId,nativeChoice,decisionId};
  } catch { return refusal(); }
}

export function matchCodexOpenDecision({run,waitId,choice} = {}) {
  try {
    const derived=deriveCodexOpenDecision({run,waitId,choice});
    if (!derived.ok) return refusal();
    const waits=run.waits.filter(value=>value?.id===waitId);
    if (waits.length!==1 || waits[0].status!=='resolved' || waits[0].decision?.id!==derived.decisionId
      || waits[0].decision.choice!==derived.nativeChoice) return refusal();
    return {ok:true,scope:'codex-open-decision-match',sourceQualified:false,managedClosureEligible:false,
      runId:derived.runId,waitId:derived.waitId,nativeChoice:derived.nativeChoice,decisionId:derived.decisionId};
  } catch { return refusal(); }
}

// Compare two independently obtained Comet snapshots without exposing the
// claim token. This is a projection, not host identity authentication: both
// inputs may be worker-supplied until a protected source verifies them.
export function projectCodexClaimObservation({runId,actionId,threadId,expectedRevision,expectedApplicationHash,record,query} = {}) {
  try {
    if (typeof runId!=='string' || !runId.trim() || typeof actionId!=='string' || !actionId.trim()
      || !ID.test(threadId ?? '') || record?.runId!==runId || record?.run?.runId!==runId || query?.runId!==runId
      || record?.application?.id!=='sdd-managed-delivery' || record.application.runtimeVersion!=='0.5.1'
      || !SHA.test(expectedApplicationHash ?? '') || record.application.contentHash!==expectedApplicationHash
      || !Number.isSafeInteger(expectedRevision) || expectedRevision<0 || record.revision!==expectedRevision
      || record.revision!==record.run.revision || record.revision!==query.revision
      || record.run.status!=='running' || query.status!=='running'
      || typeof record.run.workflow?.id!=='string' || !record.run.workflow.id
      || typeof record.run.workflow?.version!=='string' || !record.run.workflow.version
      || record.run.workflow.id!==query.workflow?.id || record.run.workflow.version!==query.workflow?.version
      || !Array.isArray(record.run.actions) || !Array.isArray(query.actions)) return refusal();
    const a=record.run.actions.filter(value=>value?.id===actionId);
    const b=query.actions.filter(value=>value?.id===actionId);
    if (a.length!==1 || b.length!==1 || a[0].status!=='running' || b[0].status!=='running'
      || typeof a[0].stepId!=='string' || !a[0].stepId || a[0].stepId!==b[0].stepId
      || !Number.isSafeInteger(a[0].attempt) || a[0].attempt<1 || a[0].attempt!==b[0].attempt
      || !SHA.test(a[0].inputHash ?? '') || a[0].inputHash!==b[0].inputHash
      || a[0].input===undefined || b[0].input===undefined || !isDeepStrictEqual(a[0].input,b[0].input)
      || envelopeDigest(a[0].input)!==a[0].inputHash || envelopeDigest(b[0].input)!==b[0].inputHash
      || typeof a[0].claim?.executorId!=='string' || !a[0].claim.executorId || a[0].claim.executorId!==b[0].claim?.executorId
      || a[0].claim?.sessionId!==threadId || b[0].claim?.sessionId!==threadId
      || typeof a[0].claim?.token!=='string' || !a[0].claim.token || a[0].claim.token!==b[0].claim?.token) return refusal();
    return {ok:true,scope:'codex-host-observation',sourceQualified:false,managedClosureEligible:false,
      threadId,runId,actionId,stepId:a[0].stepId,revision:record.revision,applicationHash:record.application.contentHash,
      actionInputHash:a[0].inputHash,claimTokenDigest:hash(a[0].claim.token)};
  } catch { return refusal(); }
}

// Cross-check an observed host command against the exact sanitized Comet
// snapshot it printed. Neither input is an authority; the match is useful
// evidence for a future protected host binding, not a gate verdict.
export function matchCodexClaimEvent({claim,event} = {}) {
  try {
    if (claim?.ok!==true || event?.ok!==true || claim.scope!=='codex-host-observation' || event.scope!=='codex-host-observation'
      || claim.sourceQualified!==false || event.sourceQualified!==false
      || claim.managedClosureEligible!==false || event.managedClosureEligible!==false
      || !ID.test(claim.threadId ?? '') || claim.threadId!==event.threadId
      || !ID.test(event.turnId ?? '') || !new RegExp(`^exec-${ID.source.slice(1,-1)}$`).test(event.itemId ?? '')
      || typeof claim.runId!=='string' || !claim.runId.trim() || typeof claim.actionId!=='string' || !claim.actionId.trim()
      || typeof claim.stepId!=='string' || !claim.stepId.trim()
      || !Number.isSafeInteger(claim.revision) || claim.revision<0
      || !SHA.test(claim.applicationHash ?? '') || !SHA.test(claim.actionInputHash ?? '') || !SHA.test(claim.claimTokenDigest ?? '')
      || !SHA.test(event.commandDigest ?? '') || !SHA.test(event.outputDigest ?? '')
      || event.exitCode!==0 || event.status!=='completed') return refusal();
    const projection={ok:true,scope:'codex-host-observation',sourceQualified:false,managedClosureEligible:false,
      threadId:claim.threadId,runId:claim.runId,actionId:claim.actionId,stepId:claim.stepId,revision:claim.revision,
      applicationHash:claim.applicationHash,actionInputHash:claim.actionInputHash,claimTokenDigest:claim.claimTokenDigest};
    if (hash(`${JSON.stringify(projection)}\n`)!==event.outputDigest) return refusal();
    return {ok:true,scope:'codex-host-claim-crosscheck',sourceQualified:false,managedClosureEligible:false,
      threadId:claim.threadId,runId:claim.runId,actionId:claim.actionId,revision:claim.revision,
      eventId:event.itemId,eventOutputDigest:event.outputDigest};
  } catch { return refusal(); }
}

// Correlate one host-recorded choice with its original question. Callers must
// still verify the containing user-owned session, current Comet binding and
// authorization. Neither worker-supplied bytes nor this projection approves a gate.
export function parseCodexHumanChoice(questionBytes,replyBytes,expected = {}) {
  try {
    if (!Buffer.isBuffer(questionBytes) || !Buffer.isBuffer(replyBytes)
      || !questionBytes.length || !replyBytes.length || questionBytes.length>LIMIT || replyBytes.length>LIMIT
      || !ID.test(expected.threadId ?? '') || !ID.test(expected.turnId ?? '') || !ID.test(expected.replyItemId ?? '')
      || !/^call_[A-Za-z0-9]{8,128}$/.test(expected.callId ?? '')
      || !Number.isSafeInteger(expected.index) || expected.index<0 || expected.index>2
      || !SHA.test(expected.questionDigest ?? '') || !SHA.test(expected.optionsDigest ?? '') || !SHA.test(expected.answerDigest ?? '')) return refusal();
    const decode=bytes=>strictJson(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    const request=decode(questionBytes);const response=decode(replyBytes);const payload=request?.payload;
    if (request?.type!=='response_item' || payload?.type!=='function_call' || payload.name!=='request_user_input_async'
      || payload.call_id!==expected.callId || typeof payload.arguments!=='string') return refusal();
    const args=strictJson(payload.arguments);const questions=args?.questions;
    if (!Array.isArray(questions) || questions.length<1 || questions.length>3) return refusal();
    const question=questions[expected.index];
    if (typeof question?.title!=='string' || !question.title.trim() || hash(question.title)!==expected.questionDigest
      || !Array.isArray(question.options) || question.options.length<1
      || question.options.some(option=>typeof option!=='string'||!option.trim())
      || new Set(question.options).size!==question.options.length
      || hash(JSON.stringify(question.options))!==expected.optionsDigest) return refusal();
    const p=response?.payload;const item=p?.item;
    if (response?.type!=='event_msg' || p?.type!=='item_completed' || p.thread_id!==expected.threadId
      || p.turn_id!==expected.turnId || item?.type!=='UserMessage' || item.id!==expected.replyItemId
      || typeof item.client_id!=='string' || !item.client_id.trim() || !Array.isArray(item.content) || item.content.length!==1
      || item.content[0]?.type!=='text' || typeof item.content[0].text!=='string') return refusal();
    const match=/^\s*<send_user_message_question_reply>\s*([\s\S]*?)\s*<\/send_user_message_question_reply>\s*$/.exec(item.content[0].text);
    if (!match) return refusal();
    const replies=strictJson(match[1]);if (!Array.isArray(replies)) return refusal();
    const selected=replies.filter(row=>{
      try { return JSON.stringify(strictJson(row?.questionItemId))===JSON.stringify(['request_user_input_async',expected.callId,expected.index]); }
      catch { return false; }
    });
    if (selected.length!==1 || selected[0].question!==question.title || typeof selected[0].answer!=='string'
      || !question.options.includes(selected[0].answer) || hash(selected[0].answer)!==expected.answerDigest) return refusal();
    const decisionDigest=hash(JSON.stringify({threadId:expected.threadId,turnId:expected.turnId,replyItemId:expected.replyItemId,
      callId:expected.callId,index:expected.index,questionDigest:expected.questionDigest,optionsDigest:expected.optionsDigest,answerDigest:expected.answerDigest}));
    return {ok:true,scope:'codex-host-choice-observation',sourceQualified:false,managedClosureEligible:false,
      threadId:expected.threadId,turnId:expected.turnId,replyItemId:expected.replyItemId,callId:expected.callId,index:expected.index,
      questionDigest:expected.questionDigest,optionsDigest:expected.optionsDigest,answerDigest:expected.answerDigest,decisionDigest};
  } catch { return refusal(); }
}

// Locate one question/reply pair in already aligned bounded JSONL bytes. This
// reveals only offsets and host IDs; matching a locator is not authorization.
export function scanCodexHumanChoiceRecords(bytes,{baseOffset,threadId,callId,index} = {}) {
  try {
    if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length>SCAN_LIMIT || bytes.at(-1)!==10
      || !Number.isSafeInteger(baseOffset) || baseOffset<0 || !ID.test(threadId ?? '')
      || !/^call_[A-Za-z0-9]{8,128}$/.test(callId ?? '') || !Number.isSafeInteger(index) || index<0 || index>2) return refusal();
    const token=Buffer.from(callId);let from=0;const questions=[],replies=[];
    while(from<bytes.length) {
      const end=bytes.indexOf(10,from);if(end<0)return refusal();
      const line=bytes.subarray(from,end),offset=baseOffset+from;from=end+1;
      if(!line.includes(token))continue;
      if(line.length>LIMIT)return refusal();
      const record=strictJson(new TextDecoder('utf-8',{fatal:true}).decode(line)),payload=record?.payload;
      if(record?.type==='response_item' && payload?.type==='function_call'
        && payload.name==='request_user_input_async' && payload.call_id===callId) {
        questions.push({offset,length:line.length});continue;
      }
      const item=payload?.item;
      if(record?.type!=='event_msg' || payload?.type!=='item_completed' || payload.thread_id!==threadId
        || !ID.test(payload.turn_id ?? '') || item?.type!=='UserMessage' || !ID.test(item.id ?? '')
        || typeof item.client_id!=='string' || !item.client_id.trim() || !Array.isArray(item.content) || item.content.length!==1
        || item.content[0]?.type!=='text' || typeof item.content[0].text!=='string')continue;
      const match=/^\s*<send_user_message_question_reply>\s*([\s\S]*?)\s*<\/send_user_message_question_reply>\s*$/.exec(item.content[0].text);
      if(!match)continue;
      const rows=strictJson(match[1]);if(!Array.isArray(rows))return refusal();
      const selected=rows.filter(row=>{
        try{return JSON.stringify(strictJson(row?.questionItemId))===JSON.stringify(['request_user_input_async',callId,index]);}
        catch{return false;}
      });
      if(selected.length>1)return refusal();
      if(selected.length===1)replies.push({offset,length:line.length,turnId:payload.turn_id,replyItemId:item.id});
    }
    if(questions.length!==1 || replies.length!==1 || questions[0].offset>=replies[0].offset)return refusal();
    return {ok:true,scope:'codex-host-choice-locator',sourceQualified:false,managedClosureEligible:false,
      threadId,callId,index,question:questions[0],reply:{offset:replies[0].offset,length:replies[0].length},
      turnId:replies[0].turnId,replyItemId:replies[0].replyItemId};
  } catch { return refusal(); }
}

// Observe a specific child turn from matching parent and child host events.
// The expected author identity, task scope, reviewed content and policy are
// not authenticated by this projection; it must never act as a review gate.
export function parseCodexIndependentTurn(spawnBytes,metaBytes,startBytes,finishBytes,completionBytes,expected = {}) {
  try {
    if ([spawnBytes,metaBytes,startBytes,finishBytes,completionBytes].some(bytes=>!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>LIMIT)
      || ![expected.rootThreadId,expected.parentTurnId,expected.childThreadId,expected.childTurnId,expected.authorThreadId].every(value=>ID.test(value ?? ''))
      || expected.childThreadId===expected.rootThreadId || expected.childThreadId===expected.authorThreadId
      || !/^call_[A-Za-z0-9]{8,128}$/.test(expected.spawnId ?? '') || !SHA.test(expected.reportDigest ?? '')) return refusal();
    const decode=bytes=>strictJson(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    const spawn=decode(spawnBytes),meta=decode(metaBytes),start=decode(startBytes),finish=decode(finishBytes),completion=decode(completionBytes);
    const parentEvent=(event,kind)=>event?.type==='event_msg' && event.payload?.type==='item_completed'
      && event.payload.thread_id===expected.rootThreadId && event.payload.turn_id===expected.parentTurnId
      && event.payload.item?.type==='SubAgentActivity' && event.payload.item.kind===kind
      && event.payload.item.agent_thread_id===expected.childThreadId;
    if (!parentEvent(spawn,'started') || spawn.payload.item.id!==expected.spawnId
      || typeof spawn.payload.item.agent_path!=='string' || !spawn.payload.item.agent_path.trim()
      || !parentEvent(completion,'completed') || completion.payload.item.id!==`subagent-completed-${expected.childTurnId}`
      || completion.payload.item.agent_path!==spawn.payload.item.agent_path) return refusal();
    const child=meta?.payload;
    if (meta?.type!=='session_meta' || child?.id!==expected.childThreadId || child.session_id!==expected.rootThreadId
      || child.thread_source!=='subagent' || child.source?.subagent?.thread_spawn?.parent_thread_id!==expected.rootThreadId
      || child.source.subagent.thread_spawn.agent_path!==spawn.payload.item.agent_path) return refusal();
    const begun=start?.payload,ended=finish?.payload;
    if (start?.type!=='event_msg' || finish?.type!=='event_msg' || begun?.type!=='task_started' || ended?.type!=='task_complete'
      || begun.turn_id!==expected.childTurnId || ended.turn_id!==expected.childTurnId
      || begun.root_turn_id!==expected.parentTurnId || ended.root_turn_id!==expected.parentTurnId
      || !Number.isSafeInteger(begun.started_at) || begun.started_at<0 || begun.started_at!==ended.started_at
      || !Number.isSafeInteger(ended.completed_at) || ended.completed_at<begun.started_at
      || typeof ended.last_agent_message!=='string' || !ended.last_agent_message.trim()
      || hash(ended.last_agent_message)!==expected.reportDigest) return refusal();
    return {ok:true,scope:'codex-host-independent-turn-observation',sourceQualified:false,managedClosureEligible:false,
      rootThreadId:expected.rootThreadId,parentTurnId:expected.parentTurnId,childThreadId:expected.childThreadId,
      childTurnId:expected.childTurnId,spawnId:expected.spawnId,reportDigest:expected.reportDigest};
  } catch { return refusal(); }
}

// A worker-provided JSON object can be parsed here, but its origin is never
// authenticated by this pure function. The expected digest must come from the
// future protected Comet/source binding, not from the same worker's claim.
export function parseCodexCommandEvent(bytes, expected) {
  try {
    if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > LIMIT
      || !ID.test(expected?.threadId ?? '') || !ID.test(expected?.turnId ?? '')
      || !new RegExp(`^exec-${ID.source.slice(1,-1)}$`).test(expected?.itemId ?? '')
      || !SHA.test(expected?.commandDigest ?? '')) return refusal();
    const data=strictJson(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    const payload=data?.payload;const item=payload?.item;
    if (data?.type!=='event_msg' || payload?.type!=='item_completed'
      || payload.thread_id!==expected.threadId || payload.turn_id!==expected.turnId
      || item?.type!=='CommandExecution' || item.id!==expected.itemId
      || !['completed','failed'].includes(item.status) || !Number.isSafeInteger(item.exit_code)
      || item.exit_code<0 || (item.status==='completed')!==(item.exit_code===0)
      || !Array.isArray(item.command) || !item.command.length || item.command.some(x=>typeof x!=='string')
      || !absoluteHostCwd(item.cwd)
      || typeof item.aggregated_output!=='string') return refusal();
    const commandDigest=hash(JSON.stringify({argv:item.command,cwd:item.cwd}));
    if (commandDigest!==expected.commandDigest) return refusal();
    return {ok:true,scope:'codex-host-observation',sourceQualified:false,managedClosureEligible:false,
      threadId:expected.threadId,turnId:expected.turnId,itemId:expected.itemId,
      commandDigest,outputDigest:hash(item.aggregated_output),exitCode:item.exit_code,status:item.status};
  } catch { return refusal(); }
}

// The observed test counts come from the same host event as the terminal
// command, not from a separately submitted report. This is still not an
// authorization, an independent-review decision, or a Comet gate receipt.
export function parseCodexTestEvent(bytes, expected) {
  try {
    const command=parseCodexCommandEvent(bytes,expected);
    if (!command.ok) return refusal();
    const event=strictJson(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    const measured=measureCodexTestOutput(command.exitCode,event.payload.item.aggregated_output);
    if (!measured) return refusal();
    return {...command,scope:'codex-host-test-observation',outcome:measured.kind,summary:measured.summary};
  } catch { return refusal(); }
}

// Correlation is not a protected source decision: caller-provided expected
// inputs and raw bytes still require host and policy authentication.
export function parseCodexClaimedTest({before,test,after,expectedBefore,expectedTest,expectedAfter,claimBefore,claimAfter} = {}) {
  try {
    if (!isDeepStrictEqual(claimBefore,claimAfter)) return refusal();
    const first=parseCodexCommandEvent(before,expectedBefore), measured=parseCodexTestEvent(test,expectedTest),
      last=parseCodexCommandEvent(after,expectedAfter);
    if (!first.ok || !measured.ok || !last.ok || first.threadId!==measured.threadId || first.threadId!==last.threadId
      || first.turnId!==measured.turnId || first.turnId!==last.turnId
      || new Set([first.itemId,measured.itemId,last.itemId]).size!==3
      || !matchCodexClaimEvent({claim:claimBefore,event:first}).ok
      || !matchCodexClaimEvent({claim:claimAfter,event:last}).ok) return refusal();
    return {ok:true,scope:'codex-claimed-test-observation',sourceQualified:false,managedClosureEligible:false,
      threadId:first.threadId,turnId:first.turnId,runId:claimBefore.runId,actionId:claimBefore.actionId,stepId:claimBefore.stepId,
      revision:claimBefore.revision,applicationHash:claimBefore.applicationHash,actionInputHash:claimBefore.actionInputHash,commandDigest:measured.commandDigest,outputDigest:measured.outputDigest,
      outcome:measured.outcome,summary:measured.summary};
  } catch { return refusal(); }
}

// Read only an exact caller-located JSONL record under the logged-in OS user's
// normal Codex sessions root. File location and record identity are checked;
// the result still does not prove Run binding, independent review or human
// approval. Custom host roots deliberately remain unsupported until their
// ownership and authorization can be verified without trusting worker input.
function openCodexSession({sessionPath,threadId,userRoot=false}) {
  let fd;
  try {
    if (typeof sessionPath!=='string' || !path.isAbsolute(sessionPath)
      || !ID.test(threadId ?? '') || !sessionPath.endsWith(`-${threadId}.jsonl`)
      || typeof fs.constants.O_NOFOLLOW!=='number') return null;
    const root=fs.realpathSync(path.join(os.userInfo().homedir,'.codex','sessions'));
    const target=fs.realpathSync(sessionPath);const relative=path.relative(root,target);
    if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
      || fs.lstatSync(sessionPath).isSymbolicLink()) return null;
    fd=fs.openSync(target,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
    const stat=fs.fstatSync(fd);
    if (!stat.isFile()) throw Error('session is not a file');
    const head=Buffer.alloc(Math.min(stat.size,LIMIT));
    if (fs.readSync(fd,head,0,head.length,0)!==head.length) throw Error('session metadata unavailable');
    const newline=head.indexOf(10);if (newline<0) throw Error('session metadata unavailable');
    const metadata=strictJson(new TextDecoder('utf-8',{fatal:true}).decode(head.subarray(0,newline)));
    if (metadata?.type!=='session_meta' || metadata.payload?.id!==threadId
      || userRoot && (metadata.payload.thread_source!=='user' || metadata.payload.session_id!==threadId
        || typeof metadata.payload.creator_user_id!=='string' || !metadata.payload.creator_user_id.trim())) throw Error('session identity mismatch');
    return {fd,size:stat.size};
  } catch { if(fd!==undefined)fs.closeSync(fd);return null; }
}

function readSessionRecords({sessionPath,threadId,spans,userRoot=false}) {
  if (!Array.isArray(spans) || !spans.length || spans.some(span=>!span || !Number.isSafeInteger(span.offset) || span.offset<0
    || !Number.isSafeInteger(span.length) || span.length<1 || span.length>LIMIT)) return null;
  const opened=openCodexSession({sessionPath,threadId,userRoot});if(!opened)return null;
  const {fd,size}=opened;
  try {
    if (spans.some(({offset,length})=>offset+length>size)) return null;
    return spans.map(({offset,length})=>{
      if (offset>0) {const preceding=Buffer.alloc(1);if(fs.readSync(fd,preceding,0,1,offset-1)!==1 || preceding[0]!==10)throw Error('record boundary');}
      const event=Buffer.alloc(length);if(fs.readSync(fd,event,0,length,offset)!==length)throw Error('record unavailable');
      if (offset+length<size) {const following=Buffer.alloc(1);if(fs.readSync(fd,following,0,1,offset+length)!==1 || following[0]!==10)throw Error('record boundary');}
      return event;
    });
  } catch { return null; }
  finally { fs.closeSync(fd); }
}

// Locate recent question and reply records without scanning or exposing the
// whole conversation. The bounded window and caller-supplied locator do not
// qualify the user, question, response or current Comet Run.
export function locateCodexHumanChoice({sessionPath,threadId,callId,index,scanStart} = {}) {
  if (scanStart!==undefined && (!Number.isSafeInteger(scanStart) || scanStart<0)) return refusal();
  const opened=openCodexSession({sessionPath,threadId,userRoot:true});if(!opened)return refusal();
  const {fd,size}=opened;
  try {
    let start=scanStart ?? Math.max(0,size-SCAN_LIMIT);
    if(start>=size)return refusal();
    const length=Math.min(SCAN_LIMIT,size-start),bytes=Buffer.alloc(length);
    if(fs.readSync(fd,bytes,0,length,start)!==length)return refusal();
    let first=0;
    if(start>0) {
      const previous=Buffer.alloc(1);if(fs.readSync(fd,previous,0,1,start-1)!==1)return refusal();
      if(previous[0]!==10) {first=bytes.indexOf(10)+1;if(first===0)return refusal();}
    }
    const end=bytes.lastIndexOf(10)+1;if(end<=first)return refusal();
    start+=first;
    return scanCodexHumanChoiceRecords(bytes.subarray(first,end),{baseOffset:start,threadId,callId,index});
  } catch { return refusal(); }
  finally { fs.closeSync(fd); }
}

export function readCodexCommandEvent({sessionPath,offset,length,...expected} = {}) {
  const records=readSessionRecords({sessionPath,threadId:expected.threadId,spans:[{offset,length}]});
  return records ? parseCodexCommandEvent(records[0],expected) : refusal();
}

export function readCodexTestEvent({sessionPath,offset,length,...expected} = {}) {
  const records=readSessionRecords({sessionPath,threadId:expected.threadId,spans:[{offset,length}]});
  return records ? parseCodexTestEvent(records[0],expected) : refusal();
}

export function readCodexClaimedTest({sessionPath,before,test,after,expectedBefore,expectedTest,expectedAfter,claimBefore,claimAfter} = {}) {
  if (!before || !test || !after || !Number.isSafeInteger(before.offset) || !Number.isSafeInteger(test.offset)
    || !Number.isSafeInteger(after.offset) || before.offset+before.length>=test.offset || test.offset+test.length>=after.offset) return refusal();
  const records=readSessionRecords({sessionPath,threadId:expectedBefore?.threadId,spans:[before,test,after]});
  return records ? parseCodexClaimedTest({before:records[0],test:records[1],after:records[2],
    expectedBefore,expectedTest,expectedAfter,claimBefore,claimAfter}) : refusal();
}

// Only a root user-owned session can supply a candidate human choice. The
// actual identity, question-to-Run policy binding and authorization still need
// independent protected verification before any gate may accept it.
export function readCodexHumanChoice({sessionPath,question,reply,...expected} = {}) {
  if (!question || !reply || !Number.isSafeInteger(question.offset) || !Number.isSafeInteger(reply.offset)
    || question.offset>=reply.offset) return refusal();
  const records=readSessionRecords({sessionPath,threadId:expected.threadId,spans:[question,reply],userRoot:true});
  return records ? parseCodexHumanChoice(records[0],records[1],expected) : refusal();
}

// Match parent spawn/completion events to the same child session and turn.
// This confirms only a host-recorded relationship, not that the task was an
// independent review of the current Comet artifact or was semantically sound.
export function readCodexIndependentTurn({parentSessionPath,childSessionPath,spawn,completion,childMeta,start,finish,...expected} = {}) {
  if (!spawn || !completion || !childMeta || !start || !finish
    || childMeta.offset!==0 || !Number.isSafeInteger(spawn.offset) || !Number.isSafeInteger(completion.offset)
    || !Number.isSafeInteger(start.offset) || !Number.isSafeInteger(finish.offset)
    || spawn.offset>=completion.offset || start.offset>=finish.offset || start.offset<=childMeta.offset) return refusal();
  const parent=readSessionRecords({sessionPath:parentSessionPath,threadId:expected.rootThreadId,spans:[spawn,completion],userRoot:true});
  const child=readSessionRecords({sessionPath:childSessionPath,threadId:expected.childThreadId,spans:[childMeta,start,finish]});
  return parent && child ? parseCodexIndependentTurn(parent[0],child[0],child[1],child[2],parent[1],expected) : refusal();
}

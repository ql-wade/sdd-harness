import { KNOWLEDGE_ACTIONS, knowledgeAction, knowledgeDefinition, knowledgeTuple, knowledgeIntent, knowledgeContract, knowledgeWriterResult, knowledgeSnapshot, knowledgeCreated, knowledgeWork } from './classic-managed-knowledge.js';
import { readArtifacts } from '../engine/run-store.js';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { readTrajectory } from '../engine/run-store.js';
import { readSkillSnapshot } from '../skill/snapshot.js';
import { MANAGED_ACTION_PROTOCOL, type RunState } from '../engine/types.js';
import { readProtectedProjectFile } from '../workflow-contract/protected-project-path.js';
import { restoreManagedEntry, decodeProducerInputs, type ManagedDeliveryHost, type ManagedRecord } from './classic-managed-host.js';

const obj = (value: unknown): value is ManagedRecord => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const hash = (bytes: string | Buffer): string => createHash('sha256').update(bytes).digest('hex');
const same = isDeepStrictEqual;
const authorKinds = ['R','A','T','P','test.automate','build',...KNOWLEDGE_ACTIONS] as const;
const own: Record<string, readonly string[]> = {R:['R'],A:['A'],T:['T'],P:['P'],V:['test.automate','build'],Kp:['Kp.create','Kp'],Kt:['Kt.create','Kt']};
type Fact = { ref: ManagedRecord; binding: ManagedRecord; inputs: ManagedRecord[]; outputs: ManagedRecord[]; success: boolean; intent: ManagedRecord; packet: ManagedRecord; producer: ManagedRecord };


function factOf(event: ManagedRecord, run: RunState, profile: ManagedRecord, policy: ManagedRecord, host: Readonly<ManagedDeliveryHost>, relevant:readonly string[]): Fact | null {
  if (event.type !== 'action_completed' || event.runId !== run.runId) return null;
  const action = event.data?.action, m = action?.managed;
  if (!m || m.protocol !== MANAGED_ACTION_PROTOCOL) return null;
  const hints=[m.intent?.action,m.actionBinding?.action,m.protectedDispatch?.actionBinding?.action,event.data?.producer?.action,event.data?.producer?.sourcePacket?.dispatch?.actionBinding?.action];
  if(!hints.some(kind=>relevant.includes(kind)))return null;
  if (!authorKinds.includes(m.intent?.action)) return null;
  const producer = event.data?.producer;
  if (!obj(producer) || !obj(m.intent) || !obj(producer.sourcePacket)) throw new Error('producer completion source is missing');
  const packet = restoreManagedEntry({sourcePacket:producer.sourcePacket}).sourcePacket;
  const verified = host.authority.verifyCollection(packet), binding = packet.dispatch?.actionBinding;
  const knowledge=knowledgeAction(m.intent.action);
  const definition = knowledge ? [knowledgeDefinition(profile,policy,m.intent.action)] : profile.actions.filter((row: ManagedRecord) => row.action === m.intent.action);
  if (definition.length !== 1 || !obj(binding) || !verified.ok || !host.authority.verifyDispatch(packet.dispatch).ok
    || event.data.outcome?.actionId !== action.id || !['succeeded','failed'].includes(event.data.outcome?.status)
    || (knowledge?.stage!=='review' && (event.data.outcome.status === 'succeeded') !== (packet.envelope?.result === 'pass'))
    || (event.data.outcome.status==='succeeded' && packet.envelope?.result!=='pass')
    || !obj(verified.source?.facts) || !text(verified.source.facts.principal)
    || verified.source.facts.run !== run.runId || verified.source.facts.execution !== binding.execution
    || binding.profile !== 'comet-managed-v2' || binding.run !== run.runId || binding.action !== m.intent.action
    || binding.role !== definition[0].role || binding.execution !== m.intent.execution || binding.inputDigest !== m.intent.inputDigest
    || binding.policyDigest !== policy.digest || binding.epoch !== m.intent.epoch || binding.attempt !== m.intent.attempt
    || m.intent.nativeRunId !== run.runId || !same(binding,m.actionBinding)
    || m.protectedDispatch?.integrity !== packet.dispatch.integrity
    || producer.principal !== verified.source.facts.principal || m.principal !== verified.source.facts.principal
    || producer.execution !== binding.execution || !same(producer.workPackage,binding.workPackage)
    || m.launch?.state !== 'terminal' || m.launch.launchId !== packet.launchRecord?.launchId
    || !Number.isInteger(m.launch.exitCode) || (m.launch.exitCode === 0) !== (packet.envelope?.result === 'pass')
    || !same(m.sourceQualification,verified.source.qualification)
    || verified.source.qualification?.scope !== 'protected-source' || verified.source.qualification?.status !== 'qualified'
    || !Array.isArray(binding.outputs) || !Array.isArray(binding.inputs) || !Array.isArray(m.contract?.inputs)
    || !same(binding.outputs,m.contract.outputs) || !Array.isArray(producer.outputs)) throw new Error('producer completion source/binding is inconsistent');
  // Authorship is a historical fact, not an expiring permission. Current Gate
  // source qualification is still checked by admission; expiry must not erase
  // this already authenticated creator identity.
  if(knowledge){
    if(!same(binding.methods,[definition[0].code]) || action.type!=='call_tool' || action.ref!==definition[0].tool
)throw new Error('knowledge CODE/operation binding is inconsistent');
    knowledgeSnapshot(m.intent,binding,definition[0].code);knowledgeTuple(m.intent.knowledge,knowledge.gate,knowledge.stage==='create');knowledgeContract(m.intent,m.contract,definition[0].code);
    if(knowledge.stage==='write')knowledgeWriterResult(packet,m.intent.knowledge);
  }else if (!Array.isArray(binding.methods) || !same(binding.methods.map((row:ManagedRecord)=>row.name),definition[0].methods)
    || binding.methods.some((row:ManagedRecord)=>row.digest !== profile.methods?.[row.name]?.sha256)) throw new Error('producer method binding is inconsistent');
  const outputs:ManagedRecord[]=[];
  if (event.data.outcome.status === 'succeeded') for (const output of binding.outputs) {
    const recorded=producer.outputs.find((row:ManagedRecord)=>row.name===output.name&&row.ref===output.ref);
    if (!recorded || !/^[a-f0-9]{64}$/u.test(recorded.digest??'')
      || !packet.envelope.evidence?.some((row:ManagedRecord)=>row.uri===output.ref&&row.sha256===recorded.digest)) throw new Error('producer output provenance is missing');
    outputs.push({...output,digest:recorded.digest});
  }
  if(knowledge&&!same(producer.knowledge,knowledge.stage==='create'&&event.data.outcome.status==='succeeded'?knowledgeCreated(m.intent,outputs):m.intent.knowledge))throw new Error('original collected creator payload binding was altered');
  for (const input of m.contract.inputs) if (!binding.inputs.some((row:ManagedRecord)=>same(row,input))) throw new Error('producer input provenance is inconsistent');
  return {ref:{action:binding.action,execution:binding.execution,principal:verified.source.facts.principal,collectionId:verified.collectionId,actionDigest:packet.collection.actionDigest},
    binding,inputs:m.contract.inputs,outputs,success:event.data.outcome.status==='succeeded',intent:m.intent,packet,producer};
}

export async function readAuthenticatedProducerFacts(options: {changeDir:string;run:RunState;profile:ManagedRecord;policy:ManagedRecord;host:Readonly<ManagedDeliveryHost>},relevant:readonly string[]):Promise<Fact[]> {
  const history=await readTrajectory(options.changeDir,options.run.trajectoryRef),facts:Fact[]=[];
  for(const [index,event]of history.entries()){
    if(event.sequence!==index+1)throw new Error('original trajectory is incomplete');
    const fact=factOf(event,options.run,options.profile,options.policy,options.host,relevant);if(fact)facts.push(fact);
  }
  const executions=new Set<string>();for(const fact of facts){if(executions.has(fact.ref.execution))throw new Error('duplicate original producer completion');executions.add(fact.ref.execution);}
  return facts;
}

export async function collectProducerSources(options: {
  projectRoot:string;changeDir:string;run:RunState|null;gate:string;policy:ManagedRecord;host:Readonly<ManagedDeliveryHost>;
  base:ManagedRecord;targets:string[];dependencies:ManagedRecord[];receipts:ManagedRecord[];frozen?:ManagedRecord;
}): Promise<ManagedRecord> {
  const {host,run,gate}=options;
  const empty = (reason:string):ManagedRecord => ({schema:'comet.classic.producer-sources.v1',runId:run?.runId??null,gate,status:'unverified',roots:[],contributors:[],missing:[reason]});
  try {
    const profile=options.policy.producerProfile;
    if (!run || !obj(profile) || profile.id!=='comet-managed-v2' || !Array.isArray(profile.actions) || !obj(profile.methods)) return empty('MANAGED_PRODUCER_PROFILE_REQUIRED');
    const pkg=await readSkillSnapshot(options.changeDir,run.skillHash);
    if (!pkg.definition.goal.inputs.some(input=>input.name===MANAGED_ACTION_PROTOCOL)) return empty('ORIGINAL_PRODUCER_PROTOCOL_REQUIRED');
    const relevant:Record<string,readonly string[]>={R:['R'],A:['R','A'],T:['R','A','T'],P:['R','A','T','P'],V:['R','A','T','P','test.automate','build'],Kp:['R','A','T','P','test.automate','build','Kp.create','Kp.review','Kp'],Kt:authorKinds};
    if(!relevant[gate])return empty('UNKNOWN_INDEPENDENT_GATE');
    const facts=await readAuthenticatedProducerFacts({changeDir:options.changeDir,run,profile,policy:options.policy,host},relevant[gate]);
    const byId=new Map(facts.map(fact=>[fact.ref.execution,fact]));
    const selected=new Set<Fact>();
    const takeScope=(scope:ManagedRecord):void=>{
      if(scope?.schema!=='comet.classic.producer-sources.v1'||scope.runId!==run.runId||scope.status!=='verified'||!Array.isArray(scope.contributors)||!scope.contributors.length)throw new Error('original author scope is incomplete');
      for(const ref of scope.contributors){const fact=byId.get(ref.execution);if(!fact||!same(fact.ref,ref))throw new Error('original author collection disappeared or changed');selected.add(fact);}
    };
    let knowledge:ManagedRecord|null=null;
    if(gate==='Kp'||gate==='Kt'){
      const tuple=options.frozen ? knowledgeTuple(options.frozen.extra?.nativeProducers?.knowledge?.operation,gate)
        : knowledgeIntent(host,{purpose:'producer',action:gate,gate,runId:run.runId,nativeRunId:run.runId,stepId:run.currentStep,epoch:options.base?.extra?.epoch});
      const work=await knowledgeWork({projectRoot:options.projectRoot,host,tuple,action:gate,facts,artifacts:await readArtifacts(options.changeDir,run.artifactsRef)});
      if(!work.creator||!work.review||!work.writer)return empty('AUTHENTICATED_KNOWLEDGE_CREATOR_REVIEW_WRITER_REQUIRED');
      knowledge={operation:work.operation,creator:work.creator.ref,review:work.review.ref,writer:work.writer.ref};
      selected.add(work.creator);selected.add(work.writer);
    }
    if(options.frozen){takeScope(options.frozen.extra?.nativeProducers);if(knowledge&&!same(knowledge,options.frozen.extra?.nativeProducers?.knowledge))throw new Error('original knowledge provenance changed');return options.frozen.extra.nativeProducers;}
    for(const dependency of options.dependencies){const value=decodeProducerInputs({...dependency.intent,nativeRunId:run.runId},host);takeScope(value.extra.nativeProducers);}
    // Exact semantic Gate input equality permits the original controller's
    // task-checkbox projection; it never creates a new author/source record.
    let fallback:ManagedRecord|null=null;
    for(const receipt of [...options.receipts].reverse()){
      if(receipt.gate!==gate||!receipt.intent)continue;
      if(!receipt.intent.inputSnapshot)continue; // An old receipt never supplies authors; current producer facts remain mandatory.
      const value=decodeProducerInputs({...receipt.intent,nativeRunId:run.runId},host);
      // A bound earlier receipt proves those facts existed. Missing them is
      // recovery-required, even if some later writer has the same bytes.
      for(const ref of value.extra.nativeProducers.contributors){const fact=byId.get(ref.execution);if(!fact||!same(fact.ref,ref))throw new Error('accepted author collection disappeared');}
      const base={...value,extra:{...value.extra}};delete base.extra.nativeProducers;
      if(same(base,options.base)){const scope=value.extra.nativeProducers as ManagedRecord;takeScope(scope);fallback=scope;break;}
    }
    const ownKinds=own[gate];if(!ownKinds)return empty('UNKNOWN_INDEPENDENT_GATE');
    const ownFacts=facts.filter(fact=>ownKinds.includes(fact.ref.action));
    const targetRefs=new Set(options.targets);
    for(const fact of ownFacts)for(const output of fact.binding.outputs)targetRefs.add(output.ref);
    const current=new Map<string,string>();
    for(const ref of targetRefs){try{const file=await readProtectedProjectFile(options.projectRoot,ref,64*1024*1024,{label:'Original producer artifact'});current.set(ref,hash(file.bytes));}catch{/* Missing input is handled by coverage, not silently trusted. */}}
    const roots:ManagedRecord[]=[];
    const visit=(ref:string,digest:string):boolean=>{
      const writers=facts.filter(fact=>fact.success&&knowledgeAction(fact.ref.action)?.stage!=='review'&&fact.outputs.some(output=>output.ref===ref&&output.digest===digest));
      for(const writer of writers){if(selected.has(writer))continue;selected.add(writer);for(const input of writer.inputs)visit(input.ref,input.digest);}
      return writers.length>0;
    };
    const missing:string[]=[];
    if(fallback){for(const root of fallback.roots??[]){roots.push(root);visit(root.ref,root.digest);}}
    else for(const ref of [...targetRefs].sort()){
      const digest=current.get(ref);
      if(!digest||!visit(ref,digest)){missing.push('CURRENT_ARTIFACT_AUTHOR_REQUIRED:'+ref);continue;}
      roots.push({ref,digest});
    }
    // Failed authenticated writers remain excluded for the exact current
    // artifact scope, but never supply successful output coverage.
    for(const fact of ownFacts)if(fact.binding.outputs.some((output:ManagedRecord)=>targetRefs.has(output.ref)))selected.add(fact);
    for(const kind of ownKinds)if(![...selected].some(fact=>fact.success&&fact.ref.action===kind))missing.push('CURRENT_PRODUCER_REQUIRED:'+kind);
    if(['V','Kp','Kt'].includes(gate)&&!selected.size)missing.push('CURRENT_CANDIDATE_AUTHORS_REQUIRED');
    return {schema:'comet.classic.producer-sources.v1',runId:run.runId,gate,status:missing.length?'unverified':'verified',roots,
      ...(knowledge?{knowledge}:{}),contributors:[...selected].map(fact=>fact.ref).sort((a,b)=>a.execution.localeCompare(b.execution)),missing};
  } catch { return empty('ORIGINAL_PRODUCER_PROVENANCE_UNVERIFIED'); }
}

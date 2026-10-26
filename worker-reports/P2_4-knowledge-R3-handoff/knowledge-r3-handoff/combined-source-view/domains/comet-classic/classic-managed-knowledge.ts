import { stableStringify } from './classic-stable-json.js';
import path from 'node:path';
import { latestCommandCheck } from './classic-command-checks.js';
import { readCheckPolicy } from './classic-check-policy.js';
import { checkEnvironmentFingerprint } from './classic-check-snapshot.js';
import { readArtifacts, readTrajectory } from '../engine/run-store.js';
import type { RunState } from '../engine/types.js';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual as same } from 'node:util';
import { readProtectedProjectFile } from '../workflow-contract/protected-project-path.js';
import { managedDeliveryHost, type ManagedRecord, type ManagedDeliveryHost } from './classic-managed-host.js';

export const KNOWLEDGE_ACTIONS = ['Kp.create', 'Kp.review', 'Kp', 'Kt.create', 'Kt.review', 'Kt'] as const;
const obj = (value: unknown): value is ManagedRecord => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
function fail(reason: string): never { throw new Error('UNVERIFIED: ' + reason); }
export function knowledgeAction(action: string): { gate: 'Kp' | 'Kt'; stage: 'create' | 'review' | 'write' } | null {
  if (!(KNOWLEDGE_ACTIONS as readonly string[]).includes(action)) return null;
  return { gate: action.startsWith('Kp') ? 'Kp' : 'Kt', stage: action.endsWith('.create') ? 'create' : action.endsWith('.review') ? 'review' : 'write' };
}
export const knowledgeTool = (action: string): string => 'managed.knowledge.' + action;
export function knowledgeDefinition(profile: ManagedRecord, policy: ManagedRecord, action: string): ManagedRecord {
  const kind = knowledgeAction(action); if (!kind) return fail('unknown fixed knowledge action');
  const rows = profile.actions?.filter((row: ManagedRecord) => row.action === kind.gate && row.nativePhase === 'archive');
  const code = policy.producerTools?.[action];
  if (!Array.isArray(rows) || rows.length !== 1 || !Array.isArray(rows[0].methods) || rows[0].methods.length
    || !text(rows[0].role) || !Array.isArray(rows[0].outputs) || !rows[0].outputs.length || !obj(code)
    || Object.keys(code).sort().join(',') !== 'digest,name,ref,version' || ![code.name, code.version, code.ref].every(text)
    || !digest(code.digest) || code.ref.endsWith('/SKILL.md') || code.ref.startsWith('/') || code.ref.includes('\\')
    || code.ref.split('/').some((part: string) => !part || part === '.' || part === '..')) return fail('fixed knowledge CODE is not registered');
  const outputs = kind.stage === 'create' ? ['knowledge-payload'] : kind.stage === 'review' ? ['knowledge-content-review'] : [...rows[0].outputs, 'knowledge-write-result'];
  return { ...rows[0], action, methods: [code.name], code: structuredClone(code), tool: knowledgeTool(action), outputs,
    role: kind.stage === 'create' ? 'knowledge-content-creator' : kind.stage === 'review' ? 'independent-knowledge-content-reviewer' : rows[0].role };
}
export function knowledgeTools(profile: ManagedRecord, policy: ManagedRecord): ManagedRecord[] {
  if (policy.producerTools === undefined) return [];
  if (!obj(policy.producerTools) || Object.keys(policy.producerTools).some(action => !knowledgeAction(action))) fail('unknown protected knowledge CODE registration');
  return Object.keys(policy.producerTools).map(action => { const item = knowledgeDefinition(profile, policy, action);
    return { id: item.tool, kind: 'function', source: item.code.ref, code: item.code, sideEffect: knowledgeAction(action)!.stage === 'write' ? 'external' : 'write' }; });
}

export async function knowledgeOutputScope(projectRoot:string,changeDir:string,run:RunState|null,policy:ManagedRecord):Promise<ManagedRecord|null>{
  const host=managedDeliveryHost();if(!run||!host||!policy.producerTools)return null;
  const record=await latestCommandCheck(projectRoot,changeDir,run,'verify');
  if(!record||record.runId!==run.runId||record.provenance!=='runtime'||record.exitCode!==0||!record.argv?.length||!record.inputBefore||record.inputBefore!==record.inputAfter)return null;
  const identity={argv:record.argv,cwd:record.cwd},check=await readCheckPolicy(projectRoot,identity);
  if(!check.outputs?.length||record.environment!==await checkEnvironmentFingerprint(record.argv,path.resolve(projectRoot,record.cwd),check))return null;
  const artifacts=await readArtifacts(changeDir,run.artifactsRef);
  let archive:ManagedRecord|null=null;
  if(artifacts.managed_archive_input_bridge){
    const saved=JSON.parse(artifacts.managed_archive_input_bridge),bridge=saved.bridge,signature=saved.signature;
    if(bridge?.runId===run.runId&&bridge.archived===path.relative(projectRoot,changeDir).replaceAll('\\','/')&&signature?.actionBinding?.action==='archive-transformation-only'
      &&signature.run===run.runId&&host.authority.verifyDispatch(signature).ok
      &&signature.actionBinding.inputDigest===createHash('sha256').update(stableStringify(bridge)).digest('hex'))archive=bridge;
  }
  for(const [ref,expected]of [[record.logRef,record.logHash],[record.manifestRef,record.manifestHash]]){
    if(!text(ref)||!digest(expected))return null;
    const relative=archive&&ref.startsWith(archive.active+'/.comet/checks/')?archive.archived+ref.slice(archive.active.length):ref;
    let bytes;try{bytes=(await readProtectedProjectFile(projectRoot,relative,64*1024*1024,{label:'Original verify output authority'})).bytes;}catch{return null;}
    if(createHash('sha256').update(bytes).digest('hex')!==expected)return null;
  }
  const contracts:ManagedRecord[]=[],outputs=new Set<string>(),protectedInputs=new Set<string>(Object.values(policy.producerTools).map((code:any)=>code.ref));
  for(const action of Object.keys(policy.producerTools)){
    const item=knowledgeDefinition(policy.producerProfile,policy,action);
    const contract=host.context({projectRoot,changeDir,runId:run.runId,nativeRunId:run.runId,purpose:'producer',action,role:item.role,gate:item.gate}).producerContract;
    if(!obj(contract)||!Array.isArray(contract.outputs)||!Array.isArray(contract.inputs)||!Array.isArray(contract.allowedPaths)
      ||contract.outputs.length!==item.outputs.length||new Set(contract.outputs.map((output:ManagedRecord)=>output.name)).size!==item.outputs.length
      ||!item.outputs.every((name:string)=>contract.outputs.some((output:ManagedRecord)=>output.name===name)))fail('original fixed knowledge output contract is missing');
    for(const input of contract.inputs)if(input.name!=='knowledge-payload')protectedInputs.add(input.ref);
    for(const output of contract.outputs){if(!text(output.ref)||!contract.allowedPaths.includes(output.ref))fail('knowledge command output is not exactly authorized');outputs.add(output.ref);}
    contracts.push({action,code:item.code,outputs:contract.outputs,allowedPaths:contract.allowedPaths,sourceRefs:contract.inputs.filter((input:ManagedRecord)=>input.name!=='knowledge-payload').map((input:ManagedRecord)=>input.ref)});
  }
  for(const event of await readTrajectory(changeDir,run.trajectoryRef)){const data=event.data as ManagedRecord;if(event.runId===run.runId&&data?.producer&&!knowledgeAction(data.producer.action))for(const output of data.producer.outputs??[])protectedInputs.add(output.ref);}
  if([...outputs].some(ref=>protectedInputs.has(ref))||!same([...outputs].sort(),[...new Set(check.outputs)].sort()))fail('verify outputs must match exact knowledge evidence outputs without CODE/source/authorization inputs');
  return {identity,contracts};
}
const tupleKeys = ['gate','operationKey','knowledgeId','payloadRef','payloadDigest','target','baseRevision','authorizationRef','authorizationDigest','sourcePermissionsRef','sourcePermissionsDigest','targetAudienceRef','targetAudienceDigest'];
export function knowledgeTuple(value: unknown, gate: string, draft = false): ManagedRecord {
  const keys=draft && obj(value) && !Object.hasOwn(value,'payloadDigest') ? tupleKeys.filter(key=>key!=='payloadDigest') : tupleKeys;
  if (!obj(value) || value.gate !== gate || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')
    || keys.some(key => !text(value[key])) || keys.filter(key=>key.endsWith('Digest')).some(key => !digest(value[key]))) return fail('exact knowledge operation/authorization tuple is missing');
  for (const key of ['payloadRef','authorizationRef','sourcePermissionsRef','targetAudienceRef']) {
    const ref = value[key]; if (ref.startsWith('/') || ref.includes('\\') || ref.split('/').some((part: string) => !part || part === '.' || part === '..')) fail('knowledge input is not a project reference');
  }
  return structuredClone(value);
}
export function knowledgeIntent(host: Readonly<ManagedDeliveryHost>, intent: ManagedRecord): ManagedRecord {
  const kind = knowledgeAction(intent.action); if (!kind) return fail('unknown knowledge intent');
  return knowledgeTuple(host.context(intent).knowledgeOperation, kind.gate, true);
}
export function knowledgeContract(intent: ManagedRecord, contract: ManagedRecord, code: ManagedRecord): void {
  const kind = knowledgeAction(intent.action)!; const tuple = knowledgeTuple(intent.knowledge, kind.gate, kind.stage==='create');
  const required = [{ name: 'producer-code', ref: code.ref, digest: code.digest },
    { name: 'knowledge-authorization', ref: tuple.authorizationRef, digest: tuple.authorizationDigest },
    { name: 'knowledge-source-permissions', ref: tuple.sourcePermissionsRef, digest: tuple.sourcePermissionsDigest },
    { name: 'knowledge-target-audience', ref: tuple.targetAudienceRef, digest: tuple.targetAudienceDigest }];
  if (kind.stage !== 'create') required.push({ name: 'knowledge-payload', ref: tuple.payloadRef, digest: tuple.payloadDigest });
  if (!required.every(input => contract.inputs.some((row: ManagedRecord) => same(row,input)))) fail('knowledge work does not bind current CODE/payload/authorization/permissions/audience');
  const immutable=new Set([code.ref,tuple.authorizationRef,tuple.sourcePermissionsRef,tuple.targetAudienceRef,...(kind.stage==='create'?[]:[tuple.payloadRef])]);
  if(contract.outputs.some((output:ManagedRecord)=>immutable.has(output.ref)))fail('knowledge output cannot overwrite its CODE/payload/authorization inputs');
  if (kind.stage === 'create' && !contract.outputs.some((output: ManagedRecord) => output.name === 'knowledge-payload' && output.ref === tuple.payloadRef)) fail('knowledge creator does not own the exact payload');
}
export function knowledgeDraft(tuple: ManagedRecord): ManagedRecord { const {payloadDigest,...draft}=tuple;return draft; }
export function knowledgeCreated(intent: ManagedRecord, outputs: ManagedRecord[]): ManagedRecord {
  const draft=knowledgeTuple(intent.knowledge,knowledgeAction(intent.action)!.gate,true);
  const produced=outputs.filter(output=>output.name==='knowledge-payload'&&output.ref===draft.payloadRef);
  if(produced.length!==1||!digest(produced[0].digest)||(Object.hasOwn(draft,'payloadDigest')&&draft.payloadDigest!==produced[0].digest))fail('original creator did not produce one exact authenticated payload');
  return {...knowledgeDraft(draft),payloadDigest:produced[0].digest};
}
export function knowledgeSnapshot(intent: ManagedRecord, binding: ManagedRecord, code: ManagedRecord): void {
  if(typeof intent.producerSnapshot!=='string' || createHash('sha256').update(intent.producerSnapshot).digest('hex')!==binding.inputDigest)fail('knowledge producer snapshot is missing or unbound');
  let frozen:ManagedRecord;try{frozen=JSON.parse(intent.producerSnapshot);}catch{return fail('knowledge producer snapshot is malformed');}
  if(!obj(frozen)||frozen.action!==binding.action||frozen.policyDigest!==binding.policyDigest||frozen.epoch!==binding.epoch
    || !same(frozen.knowledge,intent.knowledge)||!same(frozen.knowledgeSources,intent.knowledgeSources)||!same(frozen.methods,[code])
    || !same(frozen.workPackage,binding.workPackage)||!same(frozen.outputs,binding.outputs)||!same(frozen.allowedPaths,binding.allowedPaths)
    || !same(frozen.allowedTools,binding.allowedTools)||!Array.isArray(frozen.inputs)||!frozen.inputs.every((input:ManagedRecord)=>binding.inputs.some((actual:ManagedRecord)=>same(actual,input))))fail('knowledge source tuple/CODE/inputs do not match its signed snapshot');
}
export function knowledgeWriterResult(packet: ManagedRecord, tuple: ManagedRecord): ManagedRecord {
  let result: ManagedRecord; try { result = JSON.parse(packet.resultBytes.toString('utf8')).knowledge; } catch { return fail('original writer result is missing'); }
  if (!obj(result) || !same(result.operation,tuple) || !['written','not-written','unknown'].includes(result.outcome)) return fail('writer result does not bind the exact knowledge operation');
  if (result.outcome === 'unknown') return fail('knowledge write outcome remains unknown; observe the same pending operation');
  if (result.outcome === 'written' && (!text(result.revision) || result.contentDigest !== tuple.payloadDigest)) return fail('writer target revision/content readback is missing');
  if ((packet.envelope.result === 'pass') !== (result.outcome === 'written')) return fail('writer effect disagrees with its authenticated process result');
  return result;
}
export function knowledgeReview(host: Readonly<ManagedDeliveryHost>, packet: ManagedRecord, intent: ManagedRecord, creator: ManagedRecord): boolean {
  let authorization: ManagedRecord;
  try { authorization=JSON.parse(packet.resultBytes.toString('utf8')).knowledgeAuthorization; } catch { return fail('content review has no collected authorization decision'); }
  if(!obj(authorization)||!same(authorization.operation,intent.knowledge)||authorization.decision!=='allow')fail('content review did not authorize this exact payload/target/audience');
  const context = host.context({ ...intent, actionBinding: packet.dispatch.actionBinding, protectedDispatch: packet.dispatch });
  const verified = host.authority.verifyCollection(packet), principal = verified.source?.facts?.principal;
  if (!verified.ok || !text(principal) || principal === creator.ref.principal || intent.execution === creator.ref.execution
    || !same(context.admissionOptions?.sourceQualification,verified.source.qualification)
    || !Number.isFinite(Date.parse(context.admissionOptions?.now)) || !Number.isFinite(Date.parse(verified.source.qualification?.expiresAt))
    || Date.parse(verified.source.qualification.expiresAt) <= Date.parse(context.admissionOptions.now)) fail('current independent knowledge reviewer source is unavailable');
  const options = { ...context.admissionOptions, requireManaged: true, authority: host.authority, actionBinding: packet.dispatch.actionBinding,
    purpose: 'independent-acceptance', builderExecution: creator.ref.execution, builderPrincipal: creator.ref.principal,
    authoringExecutions: [creator.ref.execution], authoringPrincipals: [creator.ref.principal], consumedCollections: [], issuedExecutions: [] };
  const admitted = host.admitEvidence(packet,options); if (!admitted.ok) return fail('independent knowledge content review source was not admitted');
  const inputs = { inputDigest: packet.dispatch.actionBinding.inputDigest, testContract: context.testContract, builderExecution: creator.ref.execution };
  const review = host.verifyReview({ entry: admitted.entry, inputs, policy: context.policy });
  if (!review?.ok || !digest(review.evidenceDigest) || review.envelopeDigest !== admitted.entry.digest || review.reportDigest !== packet.collection.reportDigest
    || review.actionDigest !== packet.collection.actionDigest) return fail('completed independent knowledge content review is missing or unbound');
  return host.evaluate(inputs,[admitted.entry],context.policy,{ requireManaged: true, admissionOptionsFor: () => options, verifyReview: host.verifyReview }).verdict === 'pass';
}
export async function knowledgeWork(options: { projectRoot: string; host: Readonly<ManagedDeliveryHost>; tuple: ManagedRecord; action: string; facts: ManagedRecord[]; artifacts: ManagedRecord }): Promise<ManagedRecord> {
  const { host } = options;
  const facts = options.facts.filter(fact => knowledgeAction(fact.ref.action) && same(knowledgeDraft(fact.producer.knowledge),knowledgeDraft(options.tuple)));
  const pointer = (fact: ManagedRecord): void => { for (const output of fact.outputs) if (options.artifacts[fact.ref.action + ':' + output.name] !== output.ref) fail('original knowledge artifact reference is missing'); };
  const creator = [...facts].reverse().find(fact => fact.success && knowledgeAction(fact.ref.action)?.stage === 'create'
    && fact.outputs.some((output: ManagedRecord) => output.name === 'knowledge-payload' && output.ref === fact.producer.knowledge.payloadRef && output.digest === fact.producer.knowledge.payloadDigest));
  if (!creator) return { creator: null, review: null, writer: null, rejected: 0, revise: false };
  pointer(creator);
  const tuple=knowledgeTuple(creator.producer.knowledge,knowledgeAction(options.action)!.gate);
  if(Object.hasOwn(options.tuple,'payloadDigest')&&!same(options.tuple,tuple))fail('frozen knowledge payload/version changed');
  if(knowledgeAction(options.action)?.stage!=='create'){
    const payload = await readProtectedProjectFile(options.projectRoot,tuple.payloadRef,64*1024*1024,{label:'Original knowledge payload'});
    if(createHash('sha256').update(payload.bytes).digest('hex') !== tuple.payloadDigest) fail('original knowledge payload changed');
  }
  const reviews = facts.filter(fact => knowledgeAction(fact.ref.action)?.stage === 'review');
  let review: ManagedRecord | null = null, rejected = 0, lastRejection: ManagedRecord | null = null;
  for (const fact of reviews) {
    if (fact.packet.envelope.result !== 'pass') continue;
    const author = facts.find(candidate => same(candidate.ref,fact.intent.knowledgeSources?.creator));
    if (!author || !author.success || knowledgeAction(author.ref.action)?.stage !== 'create') fail('original content reviewer lost its creator source');
    const accepted = knowledgeReview(host,fact.packet,fact.intent,author);
    if (accepted !== fact.success) fail('original knowledge review outcome was altered');
    if (accepted && same(author.ref,creator.ref)) { pointer(fact); review = fact; }
    else if (!accepted) { rejected++; if(same(author.ref,creator.ref))lastRejection=fact.ref; }
  }
  const writer = review ? [...facts].reverse().find(fact => fact.success && knowledgeAction(fact.ref.action)?.stage === 'write'
    && same(fact.intent.knowledgeSources,{creator:creator.ref,review:review!.ref})) : null;
  if (writer) { pointer(writer); knowledgeWriterResult(writer.packet,tuple); }
  return { operation:tuple, creator, review, writer, rejected, lastRejection, revise: lastRejection !== null && !review };
}

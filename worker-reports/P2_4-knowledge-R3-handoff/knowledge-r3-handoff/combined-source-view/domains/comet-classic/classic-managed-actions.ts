import { KNOWLEDGE_ACTIONS, knowledgeAction, knowledgeDefinition, knowledgeIntent, knowledgeContract, knowledgeWork, knowledgeReview, knowledgeWriterResult, knowledgeSnapshot, knowledgeCreated } from './classic-managed-knowledge.js';
import { readAuthenticatedProducerFacts } from './classic-producer-sources.js';
import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import { readClassicState, writeClassicState, withClassicStateLock } from './classic-store.js';
import { managedDeliveryHost, requireManagedDeliveryHost, ManagedSourceUnverifiedError, restoreManagedEntry, decodeProducerInputs, type ManagedRecord } from './classic-managed-host.js';
import { discoverClassicProject } from './classic-layout.js';
import { ensureClassicRuntimeRun } from './classic-runtime-run.js';
import { collectClassicEvidence } from './classic-evidence.js';
import { resolveClassicStepId } from './classic-resolver.js';
import { stableStringify, requireRunAuthority, syncGateInvalidationsLocked, evaluateGatePremises, parseGateInvalidations, readGateDispatches, writeGateDispatches, computeGateInputs, GATE_ROLES, parseGateReceipts } from './classic-gate-runtime.js';
import { parseClassicTasks } from './classic-tasks.js';
import { readProtectedProjectFile, inspectProtectedProjectPath } from '../workflow-contract/protected-project-path.js';
import { decideWithResolver, recordOutcomeWithResolver } from '../engine/loop.js';
import { MANAGED_ACTION_PROTOCOL, type EngineAction, type RunState } from '../engine/types.js';
import { readPendingAction, readTrajectory, readArtifacts } from '../engine/run-store.js';
import { readSkillSnapshot } from '../skill/snapshot.js';
import type { SkillPackage } from '../skill/types.js';

const hash = (value: unknown): string => createHash('sha256').update(typeof value === 'string' ? value : stableStringify(value)).digest('hex');
const kinds = ['R', 'A', 'T', 'P', 'test.automate', 'build', 'code.review', ...KNOWLEDGE_ACTIONS] as const;
type Kind = typeof kinds[number];
const parentGate: Record<Kind, string> = { R: 'R', A: 'A', T: 'T', P: 'P', 'test.automate': 'V', build: 'V', 'code.review': 'V', 'Kp.create':'Kp', 'Kp.review':'Kp', Kp:'Kp', 'Kt.create':'Kt', 'Kt.review':'Kt', Kt:'Kt' };
const parentIds: Record<Kind, string[]> = { R: [], A: ['R'], T: ['R', 'A'], P: ['R', 'A', 'T'], 'test.automate': ['R', 'A', 'T', 'P'], build: ['R', 'A', 'T', 'P'], 'code.review': ['R', 'A', 'T', 'P'], 'Kp.create':['R','A','T','P','V'], 'Kp.review':['R','A','T','P','V'], Kp:['R','A','T','P','V'], 'Kt.create':['R','A','T','P','V','Kp'], 'Kt.review':['R','A','T','P','V','Kp'], Kt:['R','A','T','P','V','Kp'] };
function fail(reason: string): never { throw new ManagedSourceUnverifiedError('UNVERIFIED: ' + reason); }
const object = (value: unknown): value is ManagedRecord => value !== null && typeof value === 'object' && !Array.isArray(value);
const same = (left: unknown, right: unknown): boolean => stableStringify(left) === stableStringify(right);
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

function reference(value: unknown, writable = false): string {
  if (!text(value) || value.includes('\\') || path.posix.isAbsolute(value) || value.split('/').some((part) => !part || part === '.' || part === '..')) fail('invalid project artifact reference');
  if (writable && (value.split('/').some((part) => ['.git', '.comet', '.sdd', '.agents', '.claude', '.codex', '.zcode', 'foundation'].includes(part)) || /(?:^|\/)\.comet(?:\.|\/|$)/u.test(value) || value.startsWith('openspec/changes/archive/'))) fail('producer cannot own controller, method, registration or archived paths');
  return value;
}

async function fileDigest(root: string, ref: string): Promise<string> {
  const source = await readProtectedProjectFile(root, reference(ref), 64 * 1024 * 1024, { label: 'Managed action artifact' });
  return createHash('sha256').update(source.bytes).digest('hex');
}

async function state(changeDir: string) {
  await requireRunAuthority(changeDir);
  const host = requireManagedDeliveryHost();
  const root = await discoverClassicProject(changeDir);
  await syncGateInvalidationsLocked(changeDir, root);
  const projection = await readClassicState(changeDir, { migrate: false });
  if (!projection.classic?.managedDelivery || !projection.run) fail('original synchronized managed Run is required');
  const nativeKt = projection.classic.phase === 'archive' && projection.classic.archived && projection.run.currentStep === 'full.closeout.knowledge';
  if ((projection.classic.archived && !nativeKt) || projection.run.status === 'completed') fail('producer actions cannot reopen archive or completed lifecycle');
  const policy = structuredClone(host.policy({ projectRoot: root, changeDir, runId: projection.run.runId }));
  const profile = policy?.producerProfile;
  if (!object(profile) || profile.id !== 'comet-managed-v2' || !Array.isArray(profile.actions) || !object(profile.methods)
    || !same(policy, JSON.parse(projection.classic.deliveryPolicy ?? 'null'))) fail('current protected producer profile/policy is unavailable');
  return { host, projection, run: projection.run, classic: projection.classic, root, policy, profile, changeDir };
}
type Current = Awaited<ReturnType<typeof state>>;

function itemFor(current: Current, kind: Kind): ManagedRecord {
  if (knowledgeAction(kind)) return knowledgeDefinition(current.profile,current.policy,kind);
  const rows = current.profile.actions.filter((entry: ManagedRecord) => entry.action === kind && entry.nativePhase === current.classic.phase);
  if (rows.length !== 1 || !Array.isArray(rows[0].outputs) || !text(rows[0].role) || !Array.isArray(rows[0].methods) || rows[0].methods.length === 0
    || rows[0].methods.some((name: unknown) => !text(name) || name.startsWith('comet-') || !object(current.profile.methods[name]))) fail('phase/action/method is not declared by the protected profile');
  if (kind === 'P' && rows[0].methods.some((name: string) => current.profile.methods[name].load !== 'references-only')) fail('planner P is plan-only and requires references-only methods, never a full controller body');
  return rows[0];
}

async function gateCurrent(current: Current, gate: string): Promise<boolean> {
  const dependencyOf: Record<string, string> = { R: 'A', A: 'T', T: 'P', P: 'V' };
  return (await evaluateGatePremises({ projectRoot: current.root, changeDir: currentChange(current), classic: current.classic as unknown as ManagedRecord,
    run: current.run, action: 'enter-design', dependencyOf: dependencyOf[gate] as any })).allowed;
}
function currentChange(current: Current): string { return current.changeDir; }

async function taskId(current: Current): Promise<string | null> {
  if (current.classic.phase !== 'build') return null;
  const ref = path.relative(current.root, path.join(currentChange(current), 'tasks.md')).replaceAll('\\', '/');
  const bytes = await readProtectedProjectFile(current.root, ref, 64 * 1024 * 1024, { label: 'Original managed task authority' });
  const tasks = parseClassicTasks(bytes.bytes.toString('utf8'));
  if (tasks.some((task) => !task.id)) fail('original tasks require stable IDs before production dispatch');
  return tasks.find((task) => !task.completed)?.id ?? null;
}

async function intentFor(current: Current, kind: Kind, task: string | null): Promise<ManagedRecord> {
  const item = itemFor(current, kind);
  const invalidations = parseGateInvalidations(current.classic.gateInvalidations);
  const intent = { purpose: 'producer', action: kind, role: item.role, gate: item.gate, runId: current.run.runId, nativeRunId: current.run.runId,
    stepId: current.run.currentStep, iteration: current.run.iteration, taskId: task,
    epoch: current.classic.checkEpoch ?? 0, generation: Object.fromEntries(parentIds[kind].map((gate) => [gate, invalidations[gate as keyof typeof invalidations]?.count ?? 0])),
    projectRoot: current.root, changeDir: currentChange(current) };
  const knowledge=knowledgeAction(kind);if(!knowledge)return intent;
  const draft={...intent,knowledge:knowledgeIntent(current.host,intent)};
  if(knowledge.stage==='create')return draft;
  const work=await currentKnowledge(current,draft);if(!work.creator)fail('original knowledge creator has not produced a payload');
  return {...draft,knowledge:work.operation};
}

async function contractFor(current: Current, intent: ManagedRecord) {
  const context = current.host.context(intent);
  const contract = context.producerContract;
  if (!object(contract) || !object(contract.workPackage) || !text(contract.workPackage.id) || !Array.isArray(contract.workPackage.taskIds) || !contract.workPackage.taskIds.length
    || !text(context.producerPrincipal) || !Array.isArray(contract.inputs) || !contract.inputs.length || !Array.isArray(contract.outputs) || !contract.outputs.length
    || !Array.isArray(contract.allowedPaths) || !contract.allowedPaths.length || !Array.isArray(contract.allowedTools) || !contract.allowedTools.length) fail('protected producer work contract is unavailable');
  if (intent.taskId && !contract.workPackage.taskIds.includes(intent.taskId)) fail('work package does not bind the original next task');
  const item = itemFor(current, intent.action);
  if (!item.outputs.every((name: string) => contract.outputs.some((output: ManagedRecord) => output.name === name))) fail('required producer outputs are not registered');
  const inputRefs = new Set<string>(), outputNames = new Set<string>();
  for (const input of contract.inputs) {
    if (!object(input) || !text(input.name) || inputRefs.has(input.name)) fail('invalid producer input names');
    inputRefs.add(input.name); reference(input.ref);
    if (typeof input.digest !== 'string' || !/^[a-f0-9]{64}$/u.test(input.digest)) fail('producer input digest is not registered');
  }
  for (const output of contract.outputs) {
    if (!object(output) || !text(output.name) || outputNames.has(output.name)) fail('invalid producer output names');
    outputNames.add(output.name); reference(output.ref, true);
    if (!contract.allowedPaths.some((allowed: string) => { reference(allowed, true); return output.ref === allowed || output.ref.startsWith(allowed + '/'); })) fail('producer output is outside the protected write scope');
  }
  for (const ref of contract.allowedPaths) reference(ref, true);
  if (contract.allowedTools.some((tool: unknown) => !text(tool) || !/^[-A-Za-z0-9_.:]+$/u.test(tool))) fail('exact producer tools are required');
  if (knowledgeAction(intent.action)) knowledgeContract(intent,contract,item.code);
  if (intent.action === 'P' && contract.allowedTools.some((tool: string) => /(?:^|__|[.:/])(?:create_goal|update_goal|spawn_agent|send_message_to_thread|automation_update|dispatch|schedule|archive[^.:/]*|publish[^.:/]*)$/u.test(tool))) fail('planner P is plan-only; controller capabilities are forbidden');
  return { context, contract: structuredClone(contract), principal: context.producerPrincipal };
}

function qualification(context: ManagedRecord): ManagedRecord {
  const q = context.admissionOptions?.sourceQualification, now = Date.parse(context.admissionOptions?.now);
  if (!object(q) || q.scope !== 'protected-source' || q.status !== 'qualified' || !Number.isFinite(now) || !text(q.expiresAt) || !Number.isFinite(Date.parse(q.expiresAt)) || Date.parse(q.expiresAt) <= now
    || !Array.isArray(q.evidenceRefs) || !q.evidenceRefs.length || !['id','sourceId','revision'].every((key) => text(q[key]))
    || q.evidenceRefs.some((ref: ManagedRecord) => !object(ref) || !text(ref.ref) || typeof ref.digest !== 'string' || !/^[a-f0-9]{64}$/u.test(ref.digest))) fail('current protected source eligibility is missing or expired');
  return q;
}

function reviewCycle(current: Current, kind: Kind): ManagedRecord | null {
  if (!['R','A','T','P'].includes(kind)) return null;
  // A past authenticated rejection is an input to fresh author work, never a
  // reused approval. Keep its original identity even while outputs change.
  const rejected = [...parseGateReceipts(current.classic.gateReceipts)].reverse().find((receipt) => receipt.gate === kind
    && receipt.verdict === 'reject' && receipt.intent?.runId === current.run.runId);
  if (!rejected) return null;
  if (!object(rejected.sourceEntry) || !object(rejected.intent?.protectedDispatch)) fail('original review rejection has no authenticated source');
  const packet = restoreManagedEntry(rejected.sourceEntry).sourcePacket;
  if (!current.host.authority.verifyCollection(packet).ok || packet.dispatch?.execution !== rejected.execution
    || packet.dispatch?.integrity !== rejected.intent?.protectedDispatch?.integrity || packet.collection?.reportDigest !== rejected.reportDigest) fail('original review rejection history is not authentic');
  return { execution: rejected.execution, attempt: rejected.attempt, epoch: rejected.epoch, generation: rejected.generation, digest: rejected.digest, reportDigest: rejected.reportDigest };
}


function methodContext(current: Current, item: ManagedRecord): ManagedRecord[] {
  return item.code ? [item.code] : item.methods.map((name: string) => ({ name, ...current.profile.methods[name] }));
}
async function currentKnowledge(current: Current, intent: ManagedRecord): Promise<ManagedRecord> {
  return knowledgeWork({projectRoot:current.root,host:current.host,tuple:intent.knowledge,action:intent.action,
    facts:await readAuthenticatedProducerFacts({changeDir:currentChange(current),run:current.run,profile:current.profile,policy:current.policy,host:current.host},KNOWLEDGE_ACTIONS),
    artifacts:await readArtifacts(currentChange(current),current.run.artifactsRef)});
}
async function knowledgeSources(current: Current, intent: ManagedRecord): Promise<ManagedRecord> {
  const kind=knowledgeAction(intent.action)!;const work=await currentKnowledge(current,intent);
  if(kind.stage==='create')return work.revise?{revisionReview:work.lastRejection}:{};
  if(!work.creator)fail('original knowledge content creator is missing');
  if(kind.stage==='review')return {creator:work.creator.ref};
  if(!work.review)fail('original independent knowledge content review/authorization is missing');
  return {creator:work.creator.ref,review:work.review.ref};
}

async function identities(current: Current, intent: ManagedRecord, contract: ManagedRecord) {
  const outputs = new Set(contract.outputs.map((output: ManagedRecord) => output.ref));
  const inputs = [];
  for (const input of contract.inputs) {
    const digest = await fileDigest(current.root, input.ref);
    inputs.push({ ...input, digest });
  }
  const item = itemFor(current, intent.action), methods = methodContext(current,item);
  const sources = knowledgeAction(intent.action) ? await knowledgeSources(current,intent) : null;
  const base = { action: intent.action, taskId: intent.taskId, workPackage: contract.workPackage, policyDigest: current.policy.digest,
    ...(sources?{knowledge:intent.knowledge,knowledgeSources:sources}:{}), epoch: intent.epoch, generation: intent.generation, reviewCycle: reviewCycle(current, intent.action), methods, outputs: contract.outputs, allowedPaths: contract.allowedPaths, allowedTools: contract.allowedTools, inputs: inputs.filter((input) => !outputs.has(input.ref)) };
  const snapshot=stableStringify({ ...base, inputs, outputs: contract.outputs, allowedPaths: contract.allowedPaths, allowedTools: contract.allowedTools, skillHash: current.run.skillHash });
  return { inputs, ...(sources?{knowledgeSources:sources,producerSnapshot:snapshot}:{}), base: hash(base), digest: hash(snapshot) };
}

function sourcePacket(value: ManagedRecord): ManagedRecord { return restoreManagedEntry({ sourcePacket: value }).sourcePacket; }

async function previous(current: Current, intent: ManagedRecord, contract: ManagedRecord): Promise<ManagedRecord | null> {
  const identity = await identities(current, intent, contract);
  const trajectory = (await readTrajectory(currentChange(current), current.run.trajectoryRef)).map((event) => ({ ...event, data: event.data as ManagedRecord }));
  const event = [...trajectory].reverse().find((event) => event.runId === current.run.runId && event.type === 'action_completed'
    && event.data.producer?.action === intent.action && event.data.producer?.base === identity.base);
  if (!event || event.data.outcome?.status !== 'succeeded') return null;
  const producer = event.data.producer;
  const packet = sourcePacket(producer.sourcePacket);
  if (!current.host.authority.verifyCollection(packet).ok) fail('original producer collection history is not authentic');
  const pastIntent = event.data.action?.managed?.intent;
  if (!object(pastIntent)) fail('original producer history has no native intent');
  const context = current.host.context({ ...pastIntent, actionBinding: packet.dispatch.actionBinding, protectedDispatch: packet.dispatch });
  if (!same(qualification(context), packet.collection.source.qualification) || context.producerPrincipal !== producer.principal || !same(context.policy, current.policy)) fail('original producer source is no longer eligible');
  for (const output of producer.outputs) if (await fileDigest(current.root, output.ref) !== output.digest) return null;
  return producer;
}

async function selected(current: Current): Promise<{ kind: Kind; task: string | null } | null> {
  if (current.classic.phase === 'archive') {
    const gate = !current.classic.archived && current.run.currentStep === 'full.archive.execute' ? 'Kp'
      : current.classic.archived && current.run.currentStep === 'full.closeout.knowledge' ? 'Kt' : null;
    if (!gate) return null;
    const evaluation = await evaluateGatePremises({projectRoot:current.root,changeDir:currentChange(current),classic:current.classic as unknown as ManagedRecord,
      run:current.run,action:gate==='Kp'?'archive-spec':'complete'});
    if(evaluation.allowed)return null;
    const intent=await intentFor(current,gate+'.create' as Kind,null),work=await currentKnowledge(current,intent);
    const pkg=await readSkillSnapshot(currentChange(current),current.run.skillHash);
    if(work.rejected>=pkg.guardrails.maxRetriesPerAction)fail('original knowledge content rework budget exhausted');
    if(!work.creator||work.revise)return {kind:gate+'.create' as Kind,task:null};
    if(!work.review)return {kind:gate+'.review' as Kind,task:null};
    return {kind:gate,task:null};
  }
  if (current.classic.phase === 'open') return await gateCurrent(current, 'R') ? null : { kind: 'R', task: null };
  if (current.classic.phase === 'design') return await gateCurrent(current, 'T') ? null : { kind: await gateCurrent(current, 'A') ? 'T' : 'A', task: null };
  if (current.classic.phase !== 'build') return null;
  if (!(await gateCurrent(current, 'P'))) return { kind: 'P', task: null };
  const task = await taskId(current); if (!task) return null;
  const history = (await readTrajectory(currentChange(current), current.run.trajectoryRef)).map((event) => ({ ...event, data: event.data as ManagedRecord }));
  const taskEvents = history.filter((event) => event.data.producer?.workPackage?.taskIds?.includes(task));
  const lastBuild = [...taskEvents].reverse().find((event) => event.data.producer?.action === 'build' && event.data.outcome?.status === 'succeeded');
  const rejected = taskEvents.filter((event) => event.data.producer?.action === 'code.review' && event.data.producer.reviewRejected === true);
  if (lastBuild && rejected.at(-1) && rejected.at(-1)!.sequence > lastBuild.sequence) {
    const pkg = await readSkillSnapshot(currentChange(current), current.run.skillHash);
    if (rejected.length >= pkg.guardrails.maxRetriesPerAction) fail('independent review rework budget exhausted; original Run needs a decision');
    return { kind: 'build', task };
  }
  for (const kind of ['test.automate', 'build', 'code.review'] as const) {
    const intent = await intentFor(current, kind, task), { contract } = await contractFor(current, intent);
    if (!(await previous(current, intent, contract))) return { kind, task };
  }
  return null;
}

export async function describeCurrentManagedAction(changeDir: string): Promise<ManagedRecord> {
  return withClassicStateLock(changeDir, async () => { try {
    const current = await state(changeDir); current.changeDir = changeDir;
    const pending = await readPendingAction(changeDir, current.run.pendingRef);
    if (current.run.pending) {
      if (!pending || pending.id !== current.run.pending || pending.managed?.protocol !== MANAGED_ACTION_PROTOCOL) fail('original pending action is missing or incompatible');
      return { status: 'PENDING', nativeRunId: current.run.runId, ...pending.managed.intent, methods: pending.managed.methodNames,
        launchAuthorized: false, directive: 'observe', transport: pending.managed.launch };
    }
    if (pending) fail('orphan original pending file requires reconciliation');
    const selection = await selected(current);
    if (!selection) return { status: 'WAIT_NATIVE_TRANSITION_OR_REVIEW', nativeRunId: current.run.runId, launchAuthorized: false };
    const item = itemFor(current, selection.kind), intent = await intentFor(current, selection.kind, selection.task);
    let completed = false;
    try { const { contract } = await contractFor(current, intent); completed = Boolean(await previous(current, intent, contract)); } catch { /* preparation must report the unavailable protected contract */ }
    return { status: completed ? 'NEEDS_INDEPENDENT_REVIEW' : 'NEEDS_DISPATCH', nativeRunId: current.run.runId, action: selection.kind,
      role: item.role, methods: item.methods, taskId: selection.task, launchAuthorized: false };
  } catch (error) { return { status: 'UNVERIFIED', reason: error instanceof Error ? error.message : 'Original managed action is unavailable', launchAuthorized: false }; } });
}

function methodsMatch(current: Current, item: ManagedRecord, binding: ManagedRecord): boolean {
  if(item.code)return same(binding.methods,[item.code]);
  if (!Array.isArray(binding.methods) || binding.methods.length !== item.methods.length) return false;
  return item.methods.every((name: string) => {
    const source = current.profile.methods[name], actual = binding.methods.find((method: ManagedRecord) => method.name === name);
    if (!actual || actual.digest !== source.sha256 || !text(actual.version)) return false;
    if (source.load === 'references-only') return Array.isArray(source.references) && source.references.some((ref: ManagedRecord) => actual.ref === source.snapshot + '/' + ref.path)
      && !actual.ref.endsWith('/SKILL.md');
    return actual.ref === source.snapshot + '/' + source.entry;
  });
}

export async function prepareCurrentManagedAction(changeDir: string): Promise<ManagedRecord> {
  return withClassicStateLock(changeDir, async () => {
    await requireRunAuthority(changeDir);
    let projection = await readClassicState(changeDir, { migrate: false });
    if (!projection.run) await ensureClassicRuntimeRun(changeDir);
    await syncGateInvalidationsLocked(changeDir, await discoverClassicProject(changeDir));
    const current = await state(changeDir); current.changeDir = changeDir;
    if (current.run.pending) return readManagedExecutionLocked(current, current.run.pending, true);
    if (await readPendingAction(changeDir, current.run.pendingRef)) fail('orphan original pending file requires reconciliation');
    const pkg = await readSkillSnapshot(changeDir, current.run.skillHash);
    if (!pkg.definition.goal.inputs.some((input) => input.name === MANAGED_ACTION_PROTOCOL)) fail('old Run snapshot has no producer protocol; explicit controlled migration is required');
    const selection = await selected(current); if (!selection) fail('no original producer action is ready');
    const item = itemFor(current, selection.kind), initial = await intentFor(current, selection.kind, selection.task);
    if(item.code && (!same(pkg.definition.tools.find(tool=>tool.id===item.tool)?.code,item.code)||!pkg.guardrails.allowedTools.includes(item.tool)))fail('original Run snapshot does not bind the fixed knowledge CODE');
    const parents = await evaluateGatePremises({ projectRoot: current.root, changeDir, classic: current.classic as unknown as ManagedRecord,
      run: current.run, action: 'enter-design', dependencyOf: parentGate[selection.kind] as any });
    if (!parents.allowed) fail('producer prerequisite gates are not current: ' + parents.details.join('; '));
    const { contract, principal } = await contractFor(current, initial);
    if (selection.kind !== 'build' && await previous(current, initial, contract)) fail('current producer output is complete; independent review is required');
    const identity = await identities(current, initial, contract);
    const evidence = await collectClassicEvidence(changeDir, current.projection);
    const stepId = resolveClassicStepId(current.classic, evidence);
    const resolver = { resolveStep: () => { const step = pkg.definition.orchestration.steps?.find((step) => step.id === stepId);
      return step ? { ...step, action: item.code ? {type:'call_tool' as const,ref:item.tool} : { type: 'invoke_skill' as const, ref: item.methods[0] } } : undefined; }, resolveNext: () => stepId };
    const decision = decideWithResolver(pkg, current.run, new Set<string>(), resolver, undefined);
    if (!decision.action) fail(decision.reason ?? 'original engine refused producer action');
    const attempt = (current.run.retries[decision.action.id] ?? 0) + 1;
    const intent: ManagedRecord = { ...initial, stepId: decision.action.stepId, execution: `producer-${selection.kind.toLowerCase().replaceAll('.', '-')}-${randomBytes(12).toString('hex')}`,
      ...(knowledgeAction(selection.kind)?{knowledgeSources:identity.knowledgeSources,producerSnapshot:identity.producerSnapshot}:{}), attempt, inputDigest: identity.digest, revision: `${current.run.iteration}:${identity.base}`, producerInputs: identity.inputs };
    const context = current.host.context(intent), binding = context.actionBinding;
    const q = qualification(context);
    if (!object(binding) || binding.profile !== 'comet-managed-v2' || binding.run !== current.run.runId || binding.action !== selection.kind || binding.gate !== item.gate
      || binding.execution !== intent.execution || binding.role !== item.role || binding.inputDigest !== identity.digest || binding.policyDigest !== current.policy.digest
      || binding.attempt !== attempt || binding.epoch !== intent.epoch || binding.revision !== intent.revision || !methodsMatch(current, item, binding)
      || !same(binding.allowedPaths, contract.allowedPaths) || !same(binding.allowedTools, contract.allowedTools) || !same(binding.outputs, contract.outputs)
      || !same(binding.workPackage, contract.workPackage) || context.producerPrincipal !== principal
      || !identity.inputs.every((input) => binding.inputs?.some((actual: ManagedRecord) => same(actual, input)))) fail('protected producer ActionBinding does not match the original intent');
    const job = binding.inputs?.find((input: ManagedRecord) => input.name === 'runner-job');
    if (!job || !/^[a-f0-9]{64}$/u.test(job.digest)) fail('fixed physical operation input is not bound');
    const dispatch = current.host.authority.issueDispatch({ ...binding, actionBinding: binding });
    const action: EngineAction = { ...decision.action, managed: { protocol: MANAGED_ACTION_PROTOCOL, intent, contract, principal,
      base: identity.base, methodNames: item.methods, methodContext: methodContext(current,item), sourceQualification: q, actionBinding: binding, protectedDispatch: dispatch,
      launch: { state: 'prepared', operationDigest: job.digest } } };
    await writeClassicState(changeDir, { ...current.projection, run: decision.state }, { pendingAction: action });
    return { action, dispatch, nativeRunId: current.run.runId, execution: intent.execution, launchAuthorized: false, directive: 'claim-launch' };
  });
}

async function invalidate(current: Current, pending: EngineAction, reason: string): Promise<never> {
  if (pending.managed && !pending.managed.invalidated) {
    pending.managed.invalidated = reason;
    await writeClassicState(currentChange(current), current.projection, { pendingAction: pending });
  }
  return fail(reason);
}

async function execution(current: Current, executionId: string, byPendingId = false): Promise<ManagedRecord> {
  const pending = await readPendingAction(currentChange(current), current.run.pendingRef);
  if (current.run.pending) {
    if (!pending || pending.id !== current.run.pending || pending.managed?.protocol !== MANAGED_ACTION_PROTOCOL) fail('original pending record is missing or incompatible');
    if (pending.managed.intent.execution !== executionId && !(byPendingId && pending.id === executionId)) fail('execution is not the original pending action');
    const m = pending.managed, intent = m.intent;
    if (m.invalidated) fail('original producer binding was invalidated: ' + m.invalidated);
    const kind = intent.action as Kind;
    if (!kinds.includes(kind) || intent.nativeRunId !== current.run.runId || intent.stepId !== current.run.currentStep || intent.iteration !== current.run.iteration
      || intent.epoch !== (current.classic.checkEpoch ?? 0) || intent.role !== itemFor(current, kind).role) return invalidate(current, pending, 'stale original Run/step/epoch/role');
    const knowledge=knowledgeAction(kind);
    if(knowledge && (current.classic.phase!=='archive' || current.run.currentStep!==(knowledge.gate==='Kp'?'full.archive.execute':'full.closeout.knowledge')
      || Boolean(current.classic.archived)!==(knowledge.gate==='Kt') || pending.type!=='call_tool' || pending.ref!==itemFor(current,kind).tool))return invalidate(current,pending,'knowledge action escaped its fixed original Step');
    const fresh = await intentFor(current, kind, intent.taskId);
    if(knowledge && !same(fresh.knowledge,intent.knowledge))return invalidate(current,pending,'knowledge operation/payload/authorization changed');
    if (!same(fresh.generation, intent.generation)) return invalidate(current, pending, 'upstream evidence generation changed');
    try {
      const { contract } = await contractFor(current, { ...intent, actionBinding: m.actionBinding, protectedDispatch: m.protectedDispatch });
      const binding=m.actionBinding;
      if(!object(m.contract)||!Array.isArray(m.contract.inputs)||!same(m.contract.outputs,binding.outputs)||!same(m.contract.allowedPaths,binding.allowedPaths)
        ||!same(m.contract.allowedTools,binding.allowedTools)||!same(m.contract.workPackage,binding.workPackage)
        ||!m.contract.inputs.every((input:ManagedRecord)=>binding.inputs?.some((actual:ManagedRecord)=>same(actual,input))))return invalidate(current,pending,'original pending contract differs from its authenticated ActionBinding');
      const identity = await identities(current, fresh, contract);
      if(binding.revision!==`${intent.iteration}:${m.base}`||intent.revision!==binding.revision||intent.inputDigest!==binding.inputDigest)return invalidate(current,pending,'original producer base/revision/input binding changed');
      if(knowledge){
        knowledgeSnapshot(intent,m.actionBinding,itemFor(current,kind).code);
        const pkg=await readSkillSnapshot(currentChange(current),current.run.skillHash);
        if(!same(pkg.definition.tools.find(tool=>tool.id===itemFor(current,kind).tool)?.code,itemFor(current,kind).code)||!pkg.guardrails.allowedTools.includes(itemFor(current,kind).tool))return invalidate(current,pending,'original Run snapshot knowledge CODE changed');
      }
      if (knowledge && (!same(identity.knowledgeSources,intent.knowledgeSources) || !methodsMatch(current,itemFor(current,kind),m.actionBinding))) return invalidate(current,pending,'original knowledge creator/reviewer/CODE changed');
      if (identity.base !== m.base) return invalidate(current, pending, 'protected producer inputs or methods changed');
      const context = current.host.context({ ...intent, actionBinding: m.actionBinding, protectedDispatch: m.protectedDispatch });
      if (!same(qualification(context), m.sourceQualification) || !same(context.actionBinding, m.actionBinding) || context.producerPrincipal !== m.principal
        || !same(context.policy, current.policy) || !current.host.authority.verifyDispatch(m.protectedDispatch).ok) return invalidate(current, pending, 'protected source/action binding changed');
      return { kind: 'producer', intent, binding: m.actionBinding, dispatch: m.protectedDispatch, transport: m.launch,
        pending, context, save: async () => writeClassicState(currentChange(current), current.projection, { pendingAction: pending }) };
    } catch (error) {
      if (pending.managed?.invalidated) throw error;
      return invalidate(current, pending, 'original protected work contract/input/source became unverified');
    }

  }
  const registry = await readGateDispatches(currentChange(current));
  const gate = registry.dispatches.find((dispatch) => dispatch.execution === executionId);
  if (!gate || gate.state !== 'open' || gate.runId !== current.run.runId || gate.epoch !== (current.classic.checkEpoch ?? 0)) fail('original gate execution is not current');
  const inputs = await computeGateInputs({ projectRoot: current.root, changeDir: currentChange(current), gate: gate.gate, state: current.classic, run: current.run });
  const generations = parseGateInvalidations(current.classic.gateInvalidations);
  if (gate.role !== GATE_ROLES[gate.gate] || gate.inputDigest !== inputs.digest || gate.generation !== (generations[gate.gate]?.count ?? 0)) fail('original gate input/generation/role is stale');
  if (!gate.actionBinding || !gate.protectedDispatch) fail('original gate protected binding is missing');
  decodeProducerInputs({ ...gate, nativeRunId: current.run.runId }, current.host);
  if (gate.inputSnapshot !== inputs.inputSnapshot) fail('original gate producer input snapshot is stale');
  const intent = { ...gate, nativeRunId: current.run.runId }, context = current.host.context(intent);
  if (!same(context.actionBinding, gate.actionBinding) || !same(qualification(context), gate.sourceQualification) || !current.host.authority.verifyDispatch(gate.protectedDispatch).ok) fail('original gate source binding is stale');
  const operation = gate.actionBinding?.inputs?.find((input: ManagedRecord) => input.name === 'runner-job')?.digest;
  if (!/^[a-f0-9]{64}$/u.test(operation)) fail('original gate operation input is not bound');
  gate.transport ??= { state: 'prepared', operationDigest: operation };
  return { kind: 'gate', intent, binding: gate.actionBinding, dispatch: gate.protectedDispatch, transport: gate.transport, context,
    save: async () => writeGateDispatches(currentChange(current), registry) };
}

function verifyOperation(record: ManagedRecord): void {
  const job = record.context.job;
  if (!object(job) || Object.keys(job).sort().join(',') !== 'argv,execution,run,schemaVersion' || job.schemaVersion !== 1
    || job.execution !== record.intent.execution || job.run !== record.binding.run || !Array.isArray(job.argv) || !job.argv.length || job.argv.length > 64
    || job.argv.some((arg: unknown) => typeof arg !== 'string' || arg.length > 4096 || arg.includes('\0'))
    || Buffer.byteLength(stableStringify(job)) > 65536 || hash(job) !== record.transport.operationDigest) fail('fixed physical operation/job differs from its original binding');
}

async function readManagedExecutionLocked(current: Current, id: string, byPendingId = false) {
  const record = await execution(current, id, byPendingId);
  return { ...(record.kind === 'producer' ? { action: record.pending } : {}), kind: record.kind, execution: record.intent.execution, nativeRunId: current.run.runId, intent: record.intent,
    dispatch: record.dispatch, actionBinding: record.binding, transport: structuredClone(record.transport), launchAuthorized: false, directive: 'observe' };
}

export async function readManagedExecution(changeDir: string, executionId: string): Promise<ManagedRecord> {
  return withClassicStateLock(changeDir, async () => { const current = await state(changeDir); current.changeDir = changeDir;
    return readManagedExecutionLocked(current, executionId); });
}

export async function claimManagedLaunch(changeDir: string, executionId: string): Promise<ManagedRecord> {
  return withClassicStateLock(changeDir, async () => { const current = await state(changeDir); current.changeDir = changeDir;
    const record = await execution(current, executionId);
    if (typeof current.host.readExecution !== 'function') fail('fixed physical execution observation port is unavailable');
    verifyOperation(record);
    if (record.transport.state !== 'prepared') return { ...(await readManagedExecutionLocked(current, executionId)), launchAuthorized: false, directive: 'observe' };
    record.transport.state = 'starting';
    await record.save();
    return { kind: record.kind, execution: executionId, nativeRunId: current.run.runId, intent: record.intent, dispatch: record.dispatch,
      actionBinding: record.binding, transport: structuredClone(record.transport), launchAuthorized: true, directive: 'launch-original-execution' };
  });
}

export async function recordManagedLaunch(changeDir: string, executionId: string): Promise<ManagedRecord> {
  const original = await withClassicStateLock(changeDir, async () => { const current = await state(changeDir); current.changeDir = changeDir;
    const record = await execution(current, executionId);
    if (record.transport.state === 'prepared') fail('physical launch was not claimed');
    verifyOperation(record);
    return { intent: { ...record.intent, actionBinding: record.binding, protectedDispatch: record.dispatch, operationDigest: record.transport.operationDigest },
      read: current.host.readExecution }; });
  if (typeof original.read !== 'function') fail('fixed execution observation port is unavailable');
  const observed = await original.read(original.intent);
  return withClassicStateLock(changeDir, async () => { const current = await state(changeDir); current.changeDir = changeDir;
    const record = await execution(current, executionId);
    if (!object(observed) || observed.execution !== executionId || observed.nativeRunId !== current.run.runId || observed.operationDigest !== record.transport.operationDigest
      || observed.actionDigest !== hash(record.binding) || observed.dispatchDigest !== hash(record.dispatch)) fail('physical observation is not bound to the original execution');
    if (observed.status === 'unknown' || observed.status === 'absent') {
      record.transport.state = 'unknown'; record.transport.reason = 'original launch is unverified; absence is not restart authority';
    } else {
      if (!['started', 'terminal'].includes(observed.status) || !object(observed.handle) || !text(observed.launchId)) fail('actual original launch handle is unavailable');
      if (record.transport.handle && !same(record.transport.handle, observed.handle)) fail('physical handle changed for the same execution');
      if (record.transport.launchId && record.transport.launchId !== observed.launchId) fail('physical launch ID changed for the same execution');
      if (record.transport.exitCode !== undefined && (observed.status !== 'terminal' || record.transport.exitCode !== observed.exitCode)) fail('original terminal process fact changed');
      if (observed.status === 'terminal' && !Number.isInteger(observed.exitCode)) fail('actual process terminal result is unavailable');
      record.transport.state = observed.status; record.transport.handle = observed.handle; record.transport.launchId = observed.launchId;
      if (observed.status === 'terminal') record.transport.exitCode = observed.exitCode;
    }
    await record.save();
    return readManagedExecutionLocked(current, executionId);
  });
}

export async function acceptManagedAction(changeDir: string, executionId: string): Promise<ManagedRecord> {
  const snapshot = await withClassicStateLock(changeDir, async () => { const current = await state(changeDir); current.changeDir = changeDir;
    const record = await execution(current, executionId);
    if (record.kind !== 'producer' || record.transport.state !== 'terminal') fail('producer execution has no authenticated terminal observation');
    return { intent: { ...record.intent, actionBinding: record.binding, protectedDispatch: record.dispatch }, read: current.host.readResult, collect: current.host.authority.collectResult }; });
  const raw = await snapshot.read(snapshot.intent, {});
  const collectedPacket: ManagedRecord = { ...raw, dispatch: snapshot.intent.protectedDispatch };
  if (!collectedPacket.collection) {
    const observed = await snapshot.collect(collectedPacket);
    if (!observed.ok) fail('protected original producer result was not collected');
    collectedPacket.collection = observed.collection;
  }
  return withClassicStateLock(changeDir, async () => { const current = await state(changeDir); current.changeDir = changeDir;
    const record = await execution(current, executionId), pending = record.pending as EngineAction;
    if (record.kind !== 'producer' || !pending?.managed || record.transport.state !== 'terminal') fail('original producer is no longer pending');
    const packet: ManagedRecord = { ...collectedPacket, dispatch: record.dispatch };
    const verified = current.host.authority.verifyCollection(packet);
    const envelope = packet.envelope, q = qualification(record.context), now = Date.parse(record.context.admissionOptions.now);
    if (!verified.ok || !same(verified.source?.qualification, q) || verified.source?.facts?.principal !== pending.managed.principal
      || packet.launchRecord?.launchId !== record.transport.launchId || packet.launchRecord?.execution !== executionId
      || !object(envelope) || envelope.execution?.id !== executionId || envelope.origin?.id !== record.binding.runnerId || envelope.candidateDigest !== record.binding.inputDigest
      || envelope.environment !== record.context.admissionOptions.environment || !Number.isFinite(Date.parse(envelope.expiry)) || Date.parse(envelope.expiry) <= now
      || !['pass', 'fail'].includes(envelope.result) || !Number.isInteger(envelope.executions?.total) || !Number.isInteger(envelope.executions?.valid)
      || envelope.executions.valid < 1 || envelope.executions.valid > envelope.executions.total) fail('original producer collection/result is not authenticated');
    if ((record.transport.exitCode === 0) !== (envelope.result === 'pass')) fail('producer result disagrees with actual terminal status');
    const history = (await readTrajectory(changeDir, current.run.trajectoryRef)).map((event) => ({ ...event, data: event.data as ManagedRecord }));
    if (history.some((event) => event.data.producer?.collectionId === verified.collectionId)) fail('producer collection was already consumed');
    const outputs = [];
    if (envelope.result === 'pass') for (const output of pending.managed.contract.outputs) {
      const digest = await fileDigest(current.root, output.ref);
      if (!Array.isArray(envelope.evidence) || !envelope.evidence.some((entry: ManagedRecord) => entry.uri === output.ref && entry.sha256 === digest)) fail('producer output readback is missing or changed');
      outputs.push({ ...output, digest });
    }
    let reviewAccepted = false, reviewRejected = false;
    const knowledge=knowledgeAction(record.intent.action);
    if(knowledge){
      const work=knowledge.stage==='create'?null:await currentKnowledge(current,record.intent);
      if(knowledge.stage==='create' && envelope.result==='pass')knowledgeCreated(record.intent,outputs);
      if(knowledge.stage==='review' && envelope.result==='pass'){
        if(!work?.creator||!same(record.intent.knowledgeSources?.creator,work.creator.ref))fail('original knowledge creator changed');
        reviewAccepted=knowledgeReview(current.host,packet,record.intent,work.creator);reviewRejected=!reviewAccepted;
      }
      if(knowledge.stage==='write'){
        if(!work?.review||!same(record.intent.knowledgeSources,{creator:work.creator.ref,review:work.review.ref}))fail('original knowledge content review changed');
        knowledgeWriterResult(packet,record.intent.knowledge);
      }
    }
    if (record.intent.action === 'code.review' && envelope.result === 'pass') {
      const builder = [...history].reverse().find((event) => event.data.producer?.action === 'build' && event.data.outcome?.status === 'succeeded')?.data.producer;
      if (!builder || builder.principal === pending.managed.principal || builder.execution === executionId) fail('code review must be independent of Builder');
      const authors = history.filter((event) => event.data.producer && event.data.producer.action !== 'code.review').map((event) => event.data.producer);
      const options = { ...record.context.admissionOptions, requireManaged: true, authority: current.host.authority, actionBinding: record.binding,
        purpose: 'independent-acceptance', builderExecution: builder.execution, builderPrincipal: builder.principal,
        consumedCollections: history.map((event) => event.data.producer?.collectionId).filter(Boolean), issuedExecutions: [],
        authoringExecutions: authors.map((producer) => producer.execution), authoringPrincipals: authors.map((producer) => producer.principal) };
      const admitted = current.host.admitEvidence(packet, options);
      if (!admitted.ok) fail('independent code review source was not admitted');
      const inputs = { inputDigest: record.binding.inputDigest, testContract: record.context.testContract, builderExecution: builder.execution };
      const review = current.host.verifyReview({ entry: admitted.entry, inputs, policy: record.context.policy });
      if (!review?.ok || !/^[a-f0-9]{64}$/u.test(review.evidenceDigest ?? '') || review.envelopeDigest !== admitted.entry.digest
        || review.reportDigest !== packet.collection.reportDigest || review.actionDigest !== packet.collection.actionDigest) fail('completed independent code review is missing or unbound');
      const evaluated = current.host.evaluate(inputs, [admitted.entry], record.context.policy, { requireManaged: true, admissionOptionsFor: () => options, verifyReview: current.host.verifyReview });
      reviewAccepted = evaluated.verdict === 'pass'; reviewRejected = !reviewAccepted;
    }
    const pkg = await readSkillSnapshot(changeDir, current.run.skillHash);
    const evidence = await collectClassicEvidence(changeDir, current.projection);
    const currentStep = resolveClassicStepId(current.classic, evidence);
    const resolver = { resolveStep: () => pkg.definition.orchestration.steps?.find((step) => step.id === current.run.currentStep), resolveNext: () => currentStep };
    const outcome = { actionId: pending.id, status: envelope.result === 'pass' && !reviewRejected ? 'succeeded' as const : 'failed' as const, summary: 'Authenticated producer result; no Gate approval issued' };
    const next = recordOutcomeWithResolver(pkg, current.run, outcome, resolver, undefined);
    const producer = { ...(knowledge?{knowledge:knowledge.stage==='create'&&outcome.status==='succeeded'?knowledgeCreated(record.intent,outputs):record.intent.knowledge}:{}), action: record.intent.action, base: pending.managed.base, execution: executionId,
      workPackage: record.binding.workPackage, principal: pending.managed.principal, reviewAccepted, reviewRejected, outputs, collectionId: verified.collectionId, sourcePacket: packet };
    const artifacts = { ...(await readArtifacts(changeDir, current.run.artifactsRef)) };
    for (const output of outputs) artifacts[record.intent.action + ':' + output.name] = output.ref;
    await writeClassicState(changeDir, { ...current.projection, run: next }, { pendingAction: null, managedCompletion: packet, artifacts,
      trajectoryEvent: { sequence: history.length + 1, timestamp: new Date().toISOString(), type: 'action_completed', runId: current.run.runId,
        data: { action: pending, outcome, producer } } });
    return { run: next, outcome, execution: executionId, gateApproved: false };
  });
}

export async function requireManagedTaskReview(changeDir: string, id: string): Promise<void> {
  return withClassicStateLock(changeDir, async () => {
    const host = managedDeliveryHost();
    const projection = await readClassicState(changeDir, { migrate: false });
    if (!projection.classic?.managedDelivery) return;
    const current = await state(changeDir);
    if (current.run.pending || await taskId(current) !== id) fail('original task completion has an active or foreign producer');
    const intent = await intentFor(current, 'code.review', id), { contract } = await contractFor(current, intent);
    const completed = await previous(current, intent, contract);
    if (!completed?.reviewAccepted) fail('original task needs its current independent code review');
  });
}

export async function requireManagedGateTerminal(changeDir: string, dispatch: ManagedRecord, packet?: ManagedRecord): Promise<void> {
  const host = managedDeliveryHost(), projection = await readClassicState(changeDir, { migrate: false });
  if (!projection.classic?.managedDelivery) return;
  if (!host || !projection.run) fail('original managed gate source is unavailable');
  decodeProducerInputs({ ...dispatch, nativeRunId: projection.run.runId }, host);
  if (projection.run.pending || dispatch.transport?.state !== 'terminal') fail('gate source has no original terminal execution observation');
  if (packet && (packet.launchRecord?.execution !== dispatch.execution || packet.launchRecord?.launchId !== dispatch.transport.launchId)) fail('gate source differs from the original launch');
  if (packet && ((dispatch.transport.exitCode === 0) !== (packet.envelope?.result === 'pass'))) fail('gate source result disagrees with the actual terminal process status');
}

export async function inspectManagedProducerWrite(changeDir: string, dispatch: ManagedRecord, request: ManagedRecord): Promise<boolean | null> {
  return withClassicStateLock(changeDir, async () => {
    const host = managedDeliveryHost(), projection = await readClassicState(changeDir, { migrate: false });
    if (!host?.policy({ projectRoot: await discoverClassicProject(changeDir), changeDir, runId: projection.run?.runId })?.producerProfile) return null;
    const current = await state(changeDir), record = await execution(current, dispatch.execution);
    if (record.kind !== 'producer' || !['starting','started'].includes(record.transport.state) || record.dispatch.integrity !== dispatch.integrity
      || !record.binding.allowedTools.includes(request.toolName) || !Array.isArray(request.targets)) fail('no current producer execution owns this write');
    for (const target of request.targets) {
      const ref = path.relative(current.root, target).replaceAll('\\', '/');
      if (!record.pending.managed.contract.outputs.some((output: ManagedRecord) => output.ref === ref)) fail('producer write is not a declared output');
      await inspectProtectedProjectPath(current.root, ref, {label:'Original producer output write',expected:'file'});
    }
    const parents = await evaluateGatePremises({ projectRoot: current.root, changeDir, classic: current.classic as unknown as ManagedRecord, run: current.run,
      action: 'enter-design', dependencyOf: parentGate[record.intent.action as Kind] as any });
    if (!parents.allowed) fail('producer input gates are not current');
    return true;
  });
}

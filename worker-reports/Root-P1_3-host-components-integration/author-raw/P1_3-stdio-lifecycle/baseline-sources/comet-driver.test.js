// P1_3 — Comet managed driver layering, Runner binding without a phase write
// surface, and single spec/verification closeout ownership (F05/F07, A09
// unit-level base, OV01/OV03 judgments; task 1.3.a and 1.3.c).
//
// Boundary (delivery-foundation spec + classic-closeout-and-hook-contract.md):
// a write driver and a read-only observer must be machine-distinguishable
// (F05: a read-only prompt driver asked to write product files is refused and
// the verified managed write executor is named); the Runner binds
// run/gate/input/policy/attempt/epoch via the P2_2 trusted launcher
// (Runner.Dispatch.v1) and stores no phase of its own — there is no phase
// write surface on the runner interface; closeout is single-owner (one
// verification execution, one archive seal) with an explicit refusal for a
// duplicate archive request (Comet.Run.managedDelivery.v1: no second
// controller). Channel-specific probing lives in test/delivery-cases/1_3.mjs.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const harness = await import('../lib/adapters/harness.js');
const comet = await import('../lib/adapters/comet.js');
const { createLaunchAuthority } = await import('../lib/delivery/evidence.js');
const gateModule = await import('../lib/delivery/gate.js');

const sha = (label) => crypto.createHash('sha256').update(label).digest('hex');
const SECRET = crypto.randomBytes(32).toString('hex');

const bindingFixture = (overrides = {}) => ({
  runnerId: 'comet-classic',
  run: 'run-31430922',
  gate: 'V',
  inputDigest: sha('candidate-input-r1'),
  policyDigest: sha('policy/managed-pilot@r1'),
  attempt: 1,
  epoch: 1,
  role: 'verifier',
  execution: 'exec-verifier-1',
  ...overrides,
});

function envelopeFixture(overrides = {}) {
  return {
    schemaVersion: 1,
    candidateDigest: sha('candidate-input-r1'),
    caseId: 'case-1',
    origin: { kind: 'harness', id: 'comet-classic' },
    execution: { id: 'exec-verifier-1' },
    environment: 'env-1',
    toolchain: 'node-24',
    executions: { total: 3, valid: 3 },
    result: 'pass',
    evidence: [{ uri: 'file:///tmp/obs.log', sha256: sha('obs-log-bytes') }],
    expiry: '2099-01-01T00:00:00.000Z',
    ...overrides,
  };
}

test('F05: drivers are machine-distinguishable by a frozen kind marker', () => {
  assert.deepEqual(harness.DRIVER_KINDS, ['managed-write', 'read-only']);
  const observer = harness.defineDriver({ id: 'prompt-observer', kind: 'read-only' });
  const writer = harness.defineDriver({
    id: 'comet-managed',
    kind: 'managed-write',
    execute: () => ({ exitCode: 0 }),
  });
  assert.equal(observer.kind, 'read-only');
  assert.equal(writer.kind, 'managed-write');
  assert.ok(Object.isFrozen(observer) && Object.isFrozen(writer));
});

test('F05: a read-only driver cannot carry an execute surface at all', () => {
  assert.throws(
    () => harness.defineDriver({ id: 'fake-observer', kind: 'read-only', execute: () => {} }),
    (error) => error.code === 'DRIVER_SURFACE_REFUSED',
  );
  const observer = harness.defineDriver({ id: 'prompt-observer', kind: 'read-only' });
  assert.equal(observer.execute, undefined, 'read-only driver must not expose an execute surface');
});

test('F05: using a read-only driver for product writes is refused and names the managed executor', () => {
  const observer = harness.defineDriver({ id: 'prompt-observer', kind: 'read-only' });
  assert.throws(
    () => harness.requireWriteDriver(observer, 'write product tests'),
    (error) => error.code === 'DRIVER_WRITE_REFUSED'
      && /managed write executor/.test(error.message)
      && /prompt-observer/.test(error.message),
  );
  const writer = harness.defineDriver({
    id: 'comet-managed',
    kind: 'managed-write',
    execute: () => ({ exitCode: 0 }),
  });
  assert.equal(harness.requireWriteDriver(writer, 'write product tests'), writer);
});

test('Runner.Dispatch.v1: the runner binds run/gate/input/policy/attempt/epoch/execution', () => {
  const authority = createLaunchAuthority({ secret: SECRET });
  const writer = harness.defineDriver({
    id: 'comet-managed',
    kind: 'managed-write',
    execute: () => ({ exitCode: 0 }),
  });
  const runner = harness.createRunner({ authority, driver: writer });
  const dispatch = runner.dispatch(bindingFixture());
  for (const key of ['runnerId', 'run', 'gate', 'inputDigest', 'policyDigest', 'attempt', 'epoch', 'role', 'execution', 'integrity']) {
    assert.ok(dispatch[key] !== undefined, `dispatch must bind ${key}`);
  }
  assert.equal(authority.verifyDispatch(dispatch).ok, true);
});

test('Runner.Dispatch.v1: the runner interface has no phase write surface', () => {
  const authority = createLaunchAuthority({ secret: SECRET });
  const writer = harness.defineDriver({
    id: 'comet-managed',
    kind: 'managed-write',
    execute: () => ({ exitCode: 0 }),
  });
  const runner = harness.createRunner({ authority, driver: writer });
  assert.deepEqual(
    Object.keys(runner).sort(),
    ['admit', 'dispatch', 'verify'],
    'the runner must expose only dispatch/verify/admit — no phase storage, no control-state writer',
  );
  assert.throws(
    () => runner.dispatch(bindingFixture({ phase: 'build' })),
    (error) => error.code === 'RUNNER_PHASE_FIELD_REFUSED',
    'a phase field in a dispatch binding is a control-state write attempt and must be refused',
  );
  assert.throws(
    () => runner.dispatch(bindingFixture({ currentPhase: 'build' })),
    (error) => error.code === 'RUNNER_PHASE_FIELD_REFUSED',
  );
});

test('Runner.Dispatch.v1: a read-only driver cannot back a dispatching runner', () => {
  const authority = createLaunchAuthority({ secret: SECRET });
  const observer = harness.defineDriver({ id: 'prompt-observer', kind: 'read-only' });
  assert.throws(
    () => harness.createRunner({ authority, driver: observer }),
    (error) => error.code === 'DRIVER_WRITE_REFUSED',
  );
});

test('F07: dispatch and verification are refused when run or runner identity does not match the bound authority', () => {
  const authority = comet.cometLaunchAuthority({ secret: SECRET, runId: 'run-A' });
  assert.throws(
    () => authority.issueDispatch(bindingFixture({ run: 'run-B' })),
    (error) => error.code === 'RUN_MISMATCH',
    'a dispatch bound to another run must be refused (F07: 核对 backend/attempt/关联 ID)',
  );
  assert.throws(
    () => authority.issueDispatch(bindingFixture({ run: 'run-A', runnerId: 'other-runner' })),
    (error) => error.code === 'RUNNER_MISMATCH',
    'a dispatch claiming another runner id must be refused',
  );
  const foreign = authority.verifyDispatch(bindingFixture({ run: 'run-B' }));
  assert.equal(foreign.ok, false);
  assert.equal(foreign.error, 'RUN_MISMATCH', 'verification of a foreign-run dispatch record must return RUN_MISMATCH, not ok');
});

test('F07: a replayed receipt from the same execution is refused, not double-counted', () => {
  const authority = comet.cometLaunchAuthority({ secret: SECRET, runId: 'run-31430922' });
  const writer = harness.defineDriver({
    id: 'comet-managed',
    kind: 'managed-write',
    execute: () => ({ exitCode: 0 }),
  });
  const runner = harness.createRunner({ authority, driver: writer });
  const dispatch = runner.dispatch(bindingFixture({ runnerId: 'comet-classic', run: 'run-31430922' }));
  const current = {
    inputDigest: sha('candidate-input-r1'),
    policyDigest: sha('policy/managed-pilot@r1'),
    environment: 'env-1',
  };
  const first = runner.admit({ envelope: envelopeFixture(), dispatch, current });
  assert.equal(first.ok, true, `first admission should succeed: ${JSON.stringify(first)}`);
  const replay = runner.admit({ envelope: envelopeFixture(), dispatch, current, issuedExecutions: ['exec-verifier-1'] });
  assert.equal(replay.ok, false);
  assert.equal(replay.error, 'DUPLICATE_ISSUANCE', 'a duplicate receipt must be refused (F07: duplicate/out-of-order receipts)');
});

test('F07: a receipt whose input rotated after dispatch is refused as stale', () => {
  const authority = comet.cometLaunchAuthority({ secret: SECRET, runId: 'run-31430922' });
  const writer = harness.defineDriver({
    id: 'comet-managed',
    kind: 'managed-write',
    execute: () => ({ exitCode: 0 }),
  });
  const runner = harness.createRunner({ authority, driver: writer });
  const dispatch = runner.dispatch(
    bindingFixture({ runnerId: 'comet-classic', run: 'run-31430922', inputDigest: sha('candidate-input-r1') }),
  );
  const current = {
    inputDigest: sha('candidate-input-r2'),
    policyDigest: sha('policy/managed-pilot@r1'),
    environment: 'env-1',
  };
  const stale = runner.admit({ envelope: envelopeFixture(), dispatch, current });
  assert.equal(stale.ok, false);
  assert.equal(stale.error, 'STALE_CANDIDATE');
});

test('F07/A06: the builder execution cannot sign verification evidence', () => {
  const authority = comet.cometLaunchAuthority({ secret: SECRET, runId: 'run-31430922' });
  const writer = harness.defineDriver({
    id: 'comet-managed',
    kind: 'managed-write',
    execute: () => ({ exitCode: 0 }),
  });
  const runner = harness.createRunner({ authority, driver: writer });
  const builderDispatch = runner.dispatch(
    bindingFixture({ runnerId: 'comet-classic', run: 'run-31430922', role: 'builder', execution: 'exec-builder-1' }),
  );
  const refused = runner.admit({
    envelope: envelopeFixture({ execution: { id: 'exec-builder-1' } }),
    dispatch: builderDispatch,
    current: { inputDigest: sha('candidate-input-r1'), policyDigest: sha('policy/managed-pilot@r1'), environment: 'env-1' },
  });
  assert.equal(refused.ok, false);
  assert.equal(refused.error, 'IDENTITY_CONFLICT');
});

test('1.3.c: closeout requires the knowledge obligation before the archive seal', () => {
  const seal = {
    change: 'probe-change',
    phase: 'archive',
    verifyResult: 'pass',
    archiveConfirmation: 'confirmed',
    archived: false,
    checkEpoch: 5,
  };
  assert.throws(
    () => comet.sealCloseout({ seal, execution: 'exec-closeout-1' }),
    (error) => error.code === 'KNOWLEDGE_CLOSEOUT_REQUIRED',
    'Knowledge.Closeout.v1: Kp must precede the archive seal',
  );
  const receipt = comet.sealCloseout({ seal, execution: 'exec-closeout-1', knowledgeCloseout: { id: 'Kp-1', digest: sha('kp') } });
  assert.equal(receipt.change, 'probe-change');
  assert.equal(receipt.execution, 'exec-closeout-1');
  assert.ok(Object.isFrozen(receipt));
});

test('1.3.c: a duplicate archive request from a second execution is refused at the driver layer', () => {
  const seal = {
    change: 'probe-change',
    phase: 'archive',
    verifyResult: 'pass',
    archiveConfirmation: 'confirmed',
    archived: false,
    checkEpoch: 5,
  };
  const first = comet.sealCloseout({ seal, execution: 'exec-closeout-1', knowledgeCloseout: { id: 'Kp-1', digest: sha('kp') } });
  assert.equal(first.archived, true);
  // After the first closeout the managed readback shows the change sealed;
  // the driver judges on that readback, so any second closeout — a different
  // execution or a replay by the same one — is refused.
  const sealed = { ...seal, archived: true };
  assert.throws(
    () => comet.sealCloseout({ seal: sealed, execution: 'exec-closeout-2', knowledgeCloseout: { id: 'Kp-1', digest: sha('kp') } }),
    (error) => error.code === 'ARCHIVE_ALREADY_SEALED',
    'the second closeout execution must be refused even though the upstream CLI converges idempotently',
  );
  assert.throws(
    () => comet.sealCloseout({ seal: sealed, execution: 'exec-closeout-1', knowledgeCloseout: { id: 'Kp-1', digest: sha('kp') } }),
    (error) => error.code === 'ARCHIVE_ALREADY_SEALED',
    'even a replay by the same execution is a second closeout and is refused',
  );
});

test('1.3.c/SDD.Gate.v1: the driver reuses the pure gate judgment unmodified and it is deterministic', () => {
  assert.equal(comet.evaluateGate, gateModule.evaluate, 'evaluateGate must be the delivery gate itself (import, not a copy)');
  const authority = comet.cometLaunchAuthority({ secret: SECRET, runId: 'run-31430922' });
  const writer = harness.defineDriver({
    id: 'comet-managed',
    kind: 'managed-write',
    execute: () => ({ exitCode: 0 }),
  });
  const runner = harness.createRunner({ authority, driver: writer });
  const dispatch = runner.dispatch(bindingFixture({ runnerId: 'comet-classic', run: 'run-31430922' }));
  const current = {
    inputDigest: sha('candidate-input-r1'),
    policyDigest: sha('policy/managed-pilot@r1'),
    environment: 'env-1',
  };
  const admitted = runner.admit({ envelope: envelopeFixture({ check: 'console' }), dispatch, current });
  assert.equal(admitted.ok, true);
  const inputs = { inputDigest: sha('candidate-input-r1'), builderExecution: 'exec-builder-1', testContract: comet.gateTestContractFixture([{ level: 'independent', capability: 'console' }]) };
  const policy = { ref: 'policy/managed-pilot@r1', digest: sha('policy/managed-pilot@r1') };
  const first = comet.evaluateGate(inputs, [admitted.entry], policy);
  const second = comet.evaluateGate(inputs, [admitted.entry], policy);
  assert.equal(first.verdict, 'pass');
  assert.equal(first.verdict, second.verdict);
  assert.deepEqual(first.receipt, second.receipt, 'identical inputs must produce a byte-identical receipt');
});

// This is an actual bounded stdio executable, not the installed Agent CLI.
// It speaks the selected0.163 protocol and waits for a real protected tool reply.
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

test('native stdio transport drives a real peer and a protected tool on the original action without declaring business success', async () => {
  assert.equal(typeof harness.createCodexStdioTransport, 'function', 'the fixed native stdio transport is required');
  const fixture = nativeTransportFixture(); let transport, operation;
  try {
    transport = harness.createCodexStdioTransport(fixture.options);
    operation = transport.start();
    assert.equal(transport.start(), operation, 'repeat start must return the original execution, not another child');
    const result = await operation.done;
    assert.equal(result.status, 'OBSERVED_TERMINAL', result.reason);
    assert.equal(result.process.exitCode, 0);
    assert.equal(result.turnStatus, 'completed');
    assert.equal(result.handle.execution, 'stdio-execution-1'); assert.equal(result.handle.run, 'stdio-run-1');
    assert.equal(result.managedClosureEligible, false); assert.equal(result.runtimeQualified, false);
    assert.equal(result.verdict, undefined, 'a completed turn and exit0 are not a gate verdict');
    assert.equal(fixture.calls(), 1);
    assert.equal(fs.readFileSync(path.join(fixture.workspace, 'note.txt'), 'utf8'), 'written by the protected callback');
    const frames = fs.readFileSync(fixture.log, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    assert.deepEqual(frames.filter((m) => m.method).map((m) => m.method), ['initialize', 'initialized', 'thread/start', 'turn/start']);
    assert.equal(result.raw.stdin.toString(), frames.map((m) => JSON.stringify(m) + '\n').join(''));
    assert.match(result.raw.stdout.toString(), /turn\/completed/);
    assert.equal(transport.observe(operation.handle).process.closed, true);
  } finally { if (operation) { transport.cancel(operation.handle); await operation.closed; } fixture.cleanup(); }
});

test('native transport rejects malformed public input without getter diagnostics, unknown environment or hidden argv selection', async (t) => {
  const fixture = nativeTransportFixture();
  try {
    const copy = () => ({ ...fixture.options, registration: structuredClone(fixture.options.registration), context: structuredClone(fixture.context) });
    const cases = [
      ['null options', () => null], ['array options', () => []], ['extra provider', () => ({ ...copy(), provider: 'P13_PRIVATE_NOTE_NOT_SECRET' })],
      ['null registration', () => ({ ...copy(), registration: null })],
      ['network listener', () => { const v = copy(); v.registration.argv = ['app-server', '--listen', 'ws://127.0.0.1:9999']; return v; }],
      ['external command', () => { const v = copy(); v.registration.argv = ['exec', 'P13_PRIVATE_NOTE_NOT_SECRET']; return v; }],
      ['hidden argv key', () => { const v = copy(); v.registration.argv.provider = 'P13_PRIVATE_NOTE_NOT_SECRET'; return v; }],
      ['null env', () => { const v = copy(); v.registration.env = null; return v; }],
      ...['HOME', 'CODEX_HOME', 'NODE_OPTIONS', 'NODE_PATH', 'API_KEY', 'TOKEN', 'ROLE', 'AUTHORITY', 'PROVIDER', 'MODULE'].map((key) => [key, () => {
        const v = copy(); v.registration.env[key] = 'P13_PRIVATE_NOTE_NOT_SECRET'; return v;
      }]),
      ['sparse input', () => { const v = copy(); v.context.input = Array(1); return v; }],
      ['null tool', () => { const v = copy(); v.context.dynamicTools = [null]; return v; }],
      ['unknown tool', () => { const v = copy(); v.context.dynamicTools[0].name = 'unregistered'; return v; }],
      ['root getter', () => Object.defineProperty({ ...copy() }, 'registration', { enumerable: true, get() { throw new Error('P13_PRIVATE_NOTE_NOT_SECRET'); } })],
    ];
    for (const [name, value] of cases) await t.test(name, () => {
      assert.throws(() => harness.createCodexStdioTransport(value()), (error) => /^NATIVE_/.test(error.code ?? '')
        && !error.message.includes('P13_PRIVATE_NOTE_NOT_SECRET'));
      assert.equal(fs.existsSync(fixture.log), false);
    });
  } finally { fixture.cleanup(); }
});

test('one RPC id cannot authorize a different tool call on the same action', async () => {
  const fixture = nativeTransportFixture('rpc-id-reused'); let transport, operation;
  const observed = [];
  fixture.options.invokeTool = async (request) => {
    observed.push(request.callId);
    fs.appendFileSync(path.join(fixture.workspace, 'effects.txt'), request.callId + '\n');
    return { success: true, contentItems: [{ type: 'inputText', text: 'written private effect' }] };
  };
  try {
    transport = harness.createCodexStdioTransport(fixture.options); operation = transport.start();
    const result = await operation.done;
    assert.equal(result.status, 'UNKNOWN');
    assert.equal(observed.includes('call-2'), false, 'reused RPC id must not reach the second protected operation');
    assert.equal(new Set(observed).size <= 1, true);
  } finally { if (operation) { transport.cancel(operation.handle); await operation.closed; } fixture.cleanup(); }
});

test('native control-stream violations never reach a protected tool and retain the original unknown handle', async (t) => {
  for (const mode of ['wrong-id', 'wrong-turn', 'wrong-thread', 'unknown-tool', 'namespace', 'approval', 'permission',
    'builtin', 'collaboration', 'malformed', 'duplicate-key', 'oversized', 'truncated', 'eof']) await t.test(mode, async () => {
    const fixture = nativeTransportFixture(mode); let transport, operation;
    try {
      transport = harness.createCodexStdioTransport(fixture.options); operation = transport.start();
      const result = await operation.done;
      assert.equal(result.status, 'UNKNOWN'); assert.equal(result.handle, operation.handle);
      assert.equal(fixture.calls(), 0); assert.equal(fs.existsSync(path.join(fixture.workspace, 'note.txt')), false);
      assert.doesNotMatch(result.reason, /P13_NON_SECRET_DIAGNOSTIC|foreign/);
      assert.equal(transport.start(), operation, 'a violation cannot cause another process or reconnect');
      if (mode === 'approval' || mode === 'permission') {
        const replies = result.raw.stdin.toString().trim().split('\n').map((line) => JSON.parse(line));
        assert.equal(replies.at(-1).id, 81); assert.equal(replies.at(-1).error.message, 'REQUEST_REFUSED');
        assert.equal(replies.at(-1).result, undefined);
      }
      if (mode === 'truncated') assert.match(result.raw.stdout.toString(), /\{"method":"turn\/completed"$/);
      if (mode === 'eof' || mode === 'truncated') {
        const closed = await operation.closed; assert.equal(closed.process.exitCode, 0);
        assert.equal(closed.reason, 'NATIVE_EOF_UNKNOWN'); assert.equal(closed.protocolComplete, false);
      }
    } finally { if (operation) { transport.cancel(operation.handle); await operation.closed; } fixture.cleanup(); }
  });
});

test('native exact in-flight duplicates execute one real callback and a declared output does not rebase the input', async () => {
  const fixture = nativeTransportFixture('duplicate'); let transport, operation;
  const preOutputDigest = fixture.context.actionBinding.inputDigest;
  const originalTool = fixture.options.invokeTool; let release;
  const barrier = new Promise((resolve) => { release = resolve; });
  fixture.options.invokeTool = async (...args) => { await barrier; return originalTool(...args); };
  try {
    transport = harness.createCodexStdioTransport(fixture.options);
    const starts = await Promise.all(Array.from({ length: 6 }, async () => transport.start())); operation = starts[0];
    assert.equal(starts.every((value) => value === operation), true);
    const deadline = Date.now() + 2000;
    while (transport.observe(operation.handle).events.filter((event) => event.method === 'item/tool/call').length < 2) {
      assert.equal(Date.now() < deadline, true, 'the fixture must deliver both duplicate requests before completing its protected operation');
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    release();
    const result = await operation.done;
    assert.equal(result.status, 'OBSERVED_TERMINAL', result.reason); assert.equal(fixture.calls(), 1);
    assert.equal(fixture.context.actionBinding.inputDigest, preOutputDigest);
    assert.equal(fs.readFileSync(path.join(fixture.workspace, 'note.txt'), 'utf8'), 'written by the protected callback');
    assert.equal(result.contextDigest, operation.handle.contextDigest);
    const initialize = fs.readFileSync(fixture.log, 'utf8').split('\n').filter(Boolean).map(JSON.parse).filter((m) => m.method === 'initialize');
    assert.equal(initialize.length, 1);
  } finally { release(); if (operation) { transport.cancel(operation.handle); await operation.closed; } fixture.cleanup(); }
});

test('a known protected path refusal is returned as a failed tool result without a write or a gate verdict', async () => {
  const fixture = nativeTransportFixture('path-denied'); let transport, operation;
  try {
    transport = harness.createCodexStdioTransport(fixture.options); operation = transport.start();
    const result = await operation.done;
    assert.equal(result.process.exitCode, 0); assert.equal(result.turnStatus, 'completed'); assert.equal(fixture.calls(), 1);
    assert.equal(fs.existsSync(path.join(fixture.scratch, 'outside.txt')), false);
    assert.equal(fs.existsSync(path.join(fixture.workspace, 'note.txt')), false);
    assert.equal(result.verdict, undefined); assert.match(result.raw.stdin.toString(), /"success":false/);
  } finally { if (operation) { transport.cancel(operation.handle); await operation.closed; } fixture.cleanup(); }
});

test('native exit7 is preserved after a completed turn and cannot be advertised as successful transport', async () => {
  const fixture = nativeTransportFixture('exit7'); let transport, operation;
  try {
    transport = harness.createCodexStdioTransport(fixture.options); operation = transport.start();
    const result = await operation.done;
    assert.equal(result.turnStatus, 'completed'); assert.equal(result.process.exitCode, 7);
    assert.equal(result.status, 'UNKNOWN'); assert.equal(result.verdict, undefined); assert.equal(result.managedClosureEligible, false);
  } finally { if (operation) { transport.cancel(operation.handle); await operation.closed; } fixture.cleanup(); }
});

test('native timeout is unknown while the actual peer is alive and only its original handle can cancel it', async () => {
  const fixture = nativeTransportFixture('wait'); fixture.options.registration.timeoutMs = 500; let transport, operation;
  try {
    transport = harness.createCodexStdioTransport(fixture.options); operation = transport.start();
    const result = await operation.done;
    assert.equal(result.status, 'UNKNOWN'); assert.equal(result.reason, 'NATIVE_TIMEOUT_UNKNOWN');
    assert.equal(result.process.closed, false); assert.equal(result.process.exitCode, null);
    assert.doesNotThrow(() => process.kill(operation.handle.processId, 0));
    assert.equal(transport.start(), operation);
    for (const forged of [{ ...operation.handle }, { processId: operation.handle.processId }, null]) {
      assert.throws(() => transport.cancel(forged), (error) => error.code === 'NATIVE_HANDLE_REQUIRED');
    }
    assert.doesNotThrow(() => process.kill(operation.handle.processId, 0), 'forged handles cannot terminate the original peer');
    transport.cancel(operation.handle); const closed = await operation.closed;
    assert.equal(closed.process.closed, true); assert.equal(closed.status, 'UNKNOWN');
    assert.equal(closed.handle, operation.handle); assert.equal(closed.reason, 'NATIVE_TIMEOUT_UNKNOWN');
  } finally { if (operation) { transport.cancel(operation.handle); await operation.closed; } fixture.cleanup(); }
});

test('a stale preflight cannot be restored into a new launch using the same transport attempt', async () => {
  const fixture = nativeTransportFixture(); let transport, operation;
  try {
    transport = harness.createCodexStdioTransport(fixture.options);
    const changed = structuredClone(fixture.context); changed.actionBinding.epoch++;
    fixture.setCurrent(changed);
    const start = () => { operation = transport.start(); };
    assert.throws(start, (error) => error.code === 'NATIVE_CONTEXT_STALE');
    fixture.setCurrent(fixture.context);
    assert.throws(start, (error) => error.code === 'NATIVE_CONTEXT_STALE', 'Native must authorize a fresh attempt; old bytes alone cannot revive this failed attempt');
    assert.equal(fs.existsSync(fixture.log), false);
  } finally { if (operation) { transport.cancel(operation.handle); await operation.closed; } fixture.cleanup(); }
});

test('changed current input after tool execution suppresses the reply and cannot revive after restoring old input', async () => {
  const fixture = nativeTransportFixture(); let transport, operation;
  fixture.options.invokeTool = async (request) => {
    fs.writeFileSync(path.join(fixture.workspace, 'note.txt'), 'actual declared output before invalidation');
    const changed = structuredClone(fixture.context); changed.actionBinding.inputDigest = sha('external-new-input'); fixture.setCurrent(changed);
    return { success: true, contentItems: [{ type: 'inputText', text: 'written declared output' }] };
  };
  try {
    transport = harness.createCodexStdioTransport(fixture.options); operation = transport.start();
    const result = await operation.done; assert.equal(result.status, 'UNKNOWN');
    assert.equal(fs.readFileSync(path.join(fixture.workspace, 'note.txt'), 'utf8'), 'actual declared output before invalidation');
    assert.equal(result.raw.stdin.toString().includes('written declared output'), false);
    fixture.setCurrent(fixture.context); assert.equal(transport.start(), operation);
    assert.equal(transport.observe(operation.handle).status, 'UNKNOWN');
    assert.equal(transport.observe(operation.handle).contextDigest, operation.handle.contextDigest);
  } finally { if (operation) { transport.cancel(operation.handle); await operation.closed; } fixture.cleanup(); }
});

test('native tool callback failure or malformed replies fail closed without serializing private diagnostics', async (t) => {
  for (const mode of ['throw', 'wrong-type', 'extra-role', 'oversized-result']) await t.test(mode, async () => {
    const fixture = nativeTransportFixture(); let transport, operation;
    fixture.options.invokeTool = async () => {
      if (mode === 'throw') throw new Error('/P13_SHORT_PRIVATE_NOTE');
      if (mode === 'wrong-type') return { success: 'true', contentItems: [] };
      if (mode === 'extra-role') return { success: true, contentItems: [], role: 'controller' };
      return { success: true, contentItems: [{ type: 'inputText', text: 'P13_SHORT_PRIVATE_NOTE'.repeat(4000) }] };
    };
    try {
      transport = harness.createCodexStdioTransport(fixture.options); operation = transport.start();
      const result = await operation.done; assert.equal(result.status, 'UNKNOWN');
      assert.doesNotMatch(result.reason, /P13_SHORT_PRIVATE_NOTE/); assert.doesNotMatch(result.raw.stdin.toString(), /P13_SHORT_PRIVATE_NOTE/);
      assert.equal(fs.existsSync(path.join(fixture.workspace, 'note.txt')), false);
    } finally { if (operation) { transport.cancel(operation.handle); await operation.closed; } fixture.cleanup(); }
  });
});

test('native raw capture survives a UTF8 character split across process writes', async () => {
  const fixture = nativeTransportFixture('split'); let transport, operation;
  try {
    transport = harness.createCodexStdioTransport(fixture.options); operation = transport.start();
    const result = await operation.done;
    assert.equal(result.status, 'OBSERVED_TERMINAL', result.reason);
    assert.equal(fs.readFileSync(path.join(fixture.workspace, 'note.txt'), 'utf8'), 'written 写入🧵');
    assert.equal(result.raw.stdout.includes(Buffer.from('写入🧵')), true); assert.equal(result.truncated, false);
  } finally { if (operation) { transport.cancel(operation.handle); await operation.closed; } fixture.cleanup(); }
});

test('native output overflow is explicitly truncated and unknown without invoking a tool', async () => {
  const fixture = nativeTransportFixture('stderr-limit'); let transport, operation;
  try {
    transport = harness.createCodexStdioTransport(fixture.options); operation = transport.start();
    const result = await operation.done; assert.equal(result.status, 'UNKNOWN'); assert.equal(result.truncated, true);
    assert.equal(result.reason, 'NATIVE_CAPTURE_LIMIT');
    assert.equal(Object.values(result.raw).reduce((n, bytes) => n + bytes.length, 0) <= 2 * 1024 * 1024, true);
    assert.equal(fixture.calls(), 0);
  } finally { if (operation) { transport.cancel(operation.handle); await operation.closed; } fixture.cleanup(); }
});

test('native fixed executable bytes, type and static start arguments are checked before creating a child', async (t) => {
  for (const mode of ['changed-bytes', 'symlink', 'start-options']) await t.test(mode, async () => {
    const fixture = nativeTransportFixture(); let transport, operation;
    try {
      transport = harness.createCodexStdioTransport(fixture.options);
      if (mode === 'changed-bytes') fs.appendFileSync(fixture.peer, '\n// changed executable bytes\n');
      if (mode === 'symlink') { const real = fixture.peer + '.real'; fs.renameSync(fixture.peer, real); fs.symlinkSync(real, fixture.peer); }
      const start = () => { operation = mode === 'start-options' ? transport.start({ role: 'controller' }) : transport.start(); };
      assert.throws(start, (error) => error.code === (mode === 'start-options' ? 'NATIVE_START_ARGUMENTS_REFUSED' : 'NATIVE_BINARY_UNVERIFIED'));
      assert.equal(fs.existsSync(fixture.log), false);
    } finally { if (operation) { transport.cancel(operation.handle); await operation.closed; } fixture.cleanup(); }
  });
});

test('native schema ordinary lifecycle notifications preserve exact binding across response order without becoming actions', async (t) => {
  for (const mode of ['notifications', 'notifications-early-tool']) await t.test(mode, async () => {
    const fixture = nativeTransportFixture(mode); let transport, operation;
    try {
      transport = harness.createCodexStdioTransport(fixture.options); operation = transport.start();
      const result = await operation.done;
      assert.equal(result.status, 'OBSERVED_TERMINAL', result.reason); assert.equal(result.process.exitCode, 0);
      assert.equal(fixture.calls(), 1);
      assert.equal(fs.readFileSync(path.join(fixture.workspace, 'note.txt'), 'utf8'), 'written by the protected callback');
      for (const method of ['thread/status/changed', 'thread/tokenUsage/updated', 'item/reasoning/summaryPartAdded', 'turn/diff/updated', 'turn/plan/updated']) {
        assert.equal(result.events.some((event) => event.method === method), true, method);
      }
      assert.equal(result.verdict, undefined); assert.equal(result.managedClosureEligible, false);
    } finally { if (operation) { transport.cancel(operation.handle); await operation.closed; } fixture.cleanup(); }
  });
});

test('ordinary native notification fields and provisional turn identities fail closed when malformed', async (t) => {
  for (const mode of ['notifications-invalid-usage', 'notifications-wrong-turn']) await t.test(mode, async () => {
    const fixture = nativeTransportFixture(mode); let transport, operation;
    try {
      transport = harness.createCodexStdioTransport(fixture.options); operation = transport.start();
      const result = await operation.done; assert.equal(result.status, 'UNKNOWN'); assert.equal(fixture.calls(), 0);
    } finally { if (operation) { transport.cancel(operation.handle); await operation.closed; } fixture.cleanup(); }
  });
});

test('native close rechecks the original tuple without rewriting process facts or reviving unknown results', async (t) => {
  for (const mode of ['stable', 'epoch-changed', 'current-throws', 'timeout-restored']) await t.test(mode, async () => {
    const fixture = nativeTransportFixture('notifications'); let transport, operation;
    const ready = path.join(fixture.scratch, 'close-ready'), release = path.join(fixture.scratch, 'close-release');
    // Conditions, not elapsed time, release the peer. No host watch resource
    // is needed; EOF proves the client processed turn/completed first.
    fs.appendFileSync(fixture.peer, `
const closeDeadline=Date.now()+10000;
const closePoll=setInterval(()=>{if(fs.existsSync(${JSON.stringify(release)}))clearInterval(closePoll);else if(Date.now()>closeDeadline){process.stderr.write('PRIVATE_CLOSE_BARRIER_EXPIRED\\n');process.exitCode=91;clearInterval(closePoll);}},5);
process.stdin.on('end',()=>fs.writeFileSync(${JSON.stringify(ready)},'original peer at close barrier'));
`);
    fixture.options.registration.sha256 = sha(fs.readFileSync(fixture.peer));
    if (mode === 'timeout-restored') fixture.options.registration.timeoutMs = 1000;
    const readCurrent = fixture.options.currentContext; let throwCurrent = false;
    fixture.options.currentContext = () => {
      if (throwCurrent) throw new Error('/SHORT_CLOSE_CALLBACK_NOTE');
      return readCurrent();
    };
    try {
      transport = harness.createCodexStdioTransport(fixture.options); operation = transport.start();
      const deadline = Date.now() + 2000;
      while (!transport.observe(operation.handle).protocolComplete || !fs.existsSync(ready)) {
        const observed = transport.observe(operation.handle);
        assert.notEqual(observed.status, 'UNKNOWN', observed.reason);
        assert.equal(observed.process.closed, false, 'the original peer must remain alive at the barrier');
        assert.equal(Date.now() < deadline, true, 'the peer must reach its EOF close barrier');
        await new Promise((resolve) => setImmediate(resolve));
      }
      const before = transport.observe(operation.handle), digest = before.contextDigest;
      assert.equal(before.protocolComplete, true); assert.equal(before.process.closed, false);
      assert.equal(before.turnStatus, 'completed'); assert.equal(fixture.calls(), 1);
      assert.doesNotThrow(() => process.kill(operation.handle.processId, 0));
      assert.equal(fs.readFileSync(path.join(fixture.workspace, 'note.txt'), 'utf8'), 'written by the protected callback');
      const changed = structuredClone(fixture.context); changed.actionBinding.epoch++;
      if (mode === 'epoch-changed') fixture.setCurrent(changed);
      if (mode === 'current-throws') throwCurrent = true;
      if (mode === 'timeout-restored') {
        const timedOut = await operation.done;
        assert.equal(timedOut.status, 'UNKNOWN'); assert.equal(timedOut.reason, 'NATIVE_TIMEOUT_UNKNOWN');
        assert.equal(timedOut.process.closed, false);
        fixture.setCurrent(changed); fixture.setCurrent(fixture.context);
      }
      fs.writeFileSync(release, 'release this original peer');
      const [result, closed] = await Promise.all([operation.done, operation.closed]);
      const expectedReason = mode === 'stable' ? null : mode === 'timeout-restored' ? 'NATIVE_TIMEOUT_UNKNOWN' : 'NATIVE_CONTEXT_STALE';
      for (const view of [result, closed]) {
        assert.equal(view.status, mode === 'stable' ? 'OBSERVED_TERMINAL' : 'UNKNOWN');
        assert.equal(view.reason, expectedReason); assert.equal(view.contextDigest, digest);
        assert.equal(view.protocolComplete, true); assert.equal(view.turnStatus, 'completed');
        assert.equal(view.handle, operation.handle); assert.equal(view.managedClosureEligible, false);
        assert.equal(view.runtimeQualified, false); assert.equal(view.verdict, undefined);
      }
      assert.deepEqual(closed.process, { pid: operation.handle.processId, exitCode: 0, signal: null, closed: true });
      if (mode !== 'timeout-restored') assert.deepEqual(result.process, closed.process);
      assert.doesNotMatch(String(closed.reason) + closed.raw.stdin.toString(), /SHORT_CLOSE_CALLBACK_NOTE/);
      throwCurrent = false; fixture.setCurrent(fixture.context);
      assert.equal(transport.start(), operation, 'restoring bytes cannot create another attempt');
      assert.equal(transport.observe(operation.handle).status, closed.status);
      assert.equal(transport.observe(operation.handle).reason, expectedReason);
      assert.equal(transport.observe(operation.handle).contextDigest, digest); assert.equal(fixture.calls(), 1);
      if (mode === 'stable') {
        fixture.setCurrent(changed);
        assert.equal(transport.observe(operation.handle).status, 'OBSERVED_TERMINAL', 'closed observations stay historical; Native must recheck at later admission');
      }
    } finally {
      fs.writeFileSync(release, 'release this original peer');
      if (operation) { transport.cancel(operation.handle); await operation.closed; }
      fixture.cleanup();
    }
  });
});

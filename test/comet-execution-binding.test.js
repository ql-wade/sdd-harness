import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createRunner, defineDriver } from '../lib/adapters/harness.js';
import { createLaunchAuthority } from '../lib/delivery/evidence.js';

const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');

test('fixed runner admission refuses a caller-supplied authority even when its foreign dispatch is valid', () => {
  const fixed = createLaunchAuthority({ secret: crypto.randomBytes(32).toString('hex') });
  const foreign = createLaunchAuthority({ secret: crypto.randomBytes(32).toString('hex') });
  const runner = createRunner({ authority: fixed, driver: defineDriver({
    id: 'component-authority-boundary', kind: 'managed-write',
    execute() { throw new Error('this component admission regression must never execute a process'); },
  }) });
  const dispatch = foreign.issueDispatch({ runnerId: 'comet-classic', run: 'component-run', gate: 'V',
    inputDigest: sha('component-candidate'), policyDigest: sha('component-policy'),
    attempt: 1, epoch: 1, role: 'verifier', execution: 'component-verifier' });
  const args = {
    envelope: { schemaVersion: 1, candidateDigest: sha('component-candidate'), caseId: 'component-case',
      origin: { kind: 'harness', id: 'comet-classic' }, execution: { id: 'component-verifier' },
      environment: 'component-env', toolchain: 'component-node', executions: { total: 1, valid: 1 },
      result: 'pass', evidence: [{ uri: 'file:///tmp/component-declaration-only', sha256: sha('component-bytes') }],
      expiry: '2099-01-01T00:00:00.000Z' },
    dispatch, current: { inputDigest: sha('component-candidate'), policyDigest: sha('component-policy'), environment: 'component-env' },
  };
  assert.equal(runner.admit(args).error, 'FORGED_DISPATCH', 'the fixed authority actually rejects the foreign signature');
  const attempted = runner.admit({ ...args, authority: foreign });
  assert.equal(attempted.ok, false, 'caller data must never replace the fixed authority');
  assert.equal(attempted.error, 'FORGED_DISPATCH');
  assert.equal(attempted.managedClosureEligible, false, 'a component declaration never becomes managed evidence');
});

test('the bound Comet authority exposes the original collector without admitting foreign Run packets', async () => {
  const { cometLaunchAuthority } = await import('../lib/adapters/comet.js');
  const authority = cometLaunchAuthority({ secret: crypto.randomBytes(32).toString('hex'), runId: 'fixed-native-run' });
  assert.equal(typeof authority.collectResult, 'function', 'the fixed host needs the original P2_2 collector, not dispatch-only labels');
  assert.equal(typeof authority.verifyCollection, 'function');
  assert.equal((await authority.collectResult({ dispatch: { run: 'foreign-run' } })).error, 'RUN_MISMATCH');
  assert.equal(authority.verifyCollection({ dispatch: { run: 'foreign-run' } }).error, 'RUN_MISMATCH');
});

test('the original Comet adapter exposes a fixed executor that refuses unregistered construction before launch', async () => {
  const comet = await import('../lib/adapters/comet.js');
  assert.equal(typeof comet.createCometExecutor, 'function', 'P1_3 currently has no fixed host/executor implementation');
  assert.throws(() => comet.createCometExecutor(), (error) => error.code === 'HOST_REGISTRATION_REQUIRED');
});

test('fixed host constructor rejects non-object options and caller qualification switches structurally', async () => {
  const { createCometExecutor } = await import('../lib/adapters/comet.js');
  for (const options of [null, [], 'untrusted', { qualified: true }, { registration: null, testingBypass: true }]) {
    assert.throws(() => createCometExecutor(options), (error) => error.code === 'HOST_OPTIONS_INVALID');
  }
});

test('fixed host rejects malformed registration data before consulting code or process ports', async (t) => {
  const { createCometExecutor } = await import('../lib/adapters/comet.js');
  const base = () => ({ schemaVersion: 1, projectRoot: process.cwd(), change: 'demo', runId: 'component-run', runner: { roles: [] },
    docker: { executable: process.execPath, sha256: 'a'.repeat(64) }, actions: [{ gate: 'R', roleBindingId: 'reviewer', argv: ['component'] }] });
  const cases = [
    ['root array', () => []], ['unknown version', () => ({ ...base(), schemaVersion: 9 })],
    ['change number', () => ({ ...base(), change: 123 })], ['change object', () => ({ ...base(), change: {} })],
    ['project not string', () => ({ ...base(), projectRoot: [] })], ['run not string', () => ({ ...base(), runId: {} })],
    ['runner null', () => ({ ...base(), runner: null })], ['roles not array', () => ({ ...base(), runner: { roles: {} } })],
    ['docker null', () => ({ ...base(), docker: null })], ['digest array', () => ({ ...base(), docker: { executable: process.execPath, sha256: ['a'.repeat(64)] } })],
    ['actions null', () => ({ ...base(), actions: null })], ['action null', () => ({ ...base(), actions: [null] })],
    ['argv null', () => ({ ...base(), actions: [{ gate: 'R', roleBindingId: 'reviewer', argv: null }] })],
    ['argv null item', () => ({ ...base(), actions: [{ gate: 'R', roleBindingId: 'reviewer', argv: [null] }] })],
    ['worker qualification field', () => ({ ...base(), qualified: true })],
  ];
  for (const [name, mutate] of cases) await t.test(name, () => {
    assert.throws(() => createCometExecutor({ registration: mutate() }), (error) => error.code === 'HOST_REGISTRATION_INVALID');
  });
});

// The actual Native aggregate and public OpenSpec closure are controller-fixed
// artifacts. This is a test-material root, never a product consumer loader.
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function nativeProcessFixture(material, resume = null) {
  const fs = await import('node:fs'), path = await import('node:path'), crypto = await import('node:crypto');
  const { pathToFileURL } = await import('node:url');
  const { spawnSync } = await import('node:child_process');
  const assert = (await import('node:assert/strict')).default;
  const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
  const { createCometExecutor, cometLaunchAuthority } = await import(pathToFileURL(path.join(material.repository, 'lib/adapters/comet.js')));
  const { envelopeDigest } = await import(pathToFileURL(path.join(material.repository, 'lib/delivery/evidence.js')));
  const { parseTapSummary } = await import(pathToFileURL(path.join(material.repository, 'lib/delivery/test-contract.js')));
  const runtimeFile = path.join(material.artifacts, '.sdd/vendor/comet/c90af44a4474662d7853aae76ce785404974fb0a/builds/6da90e893105b4b00fc756260076b49e12bdbe40bc4426e4908a75e1d5732a9a/work/assets/skills/comet/scripts/comet-runtime.mjs');
  assert.equal(sha(fs.readFileSync(runtimeFile)), '04795080295d7174af82913757254426b82037ea5028296a3602b86d200559dd', 'actual frozen6da source is required');
  const native = await import(pathToFileURL(runtimeFile));
  const project = material.project, change = path.join(project, 'openspec/changes/demo');
  const priorHome = process.env.HOME;
  process.env.HOME = path.join(material.scratch, 'home'); fs.mkdirSync(process.env.HOME, { recursive: true });
  const invoke = async (argv) => {
    const result = await native.runClassicCli(['--json', 'state', ...argv], undefined, { projectRoot: project, invocationCwd: project });
    return { ...result, json: JSON.parse(result.stdout) };
  };
  try {
    if (!resume) {
      fs.mkdirSync(path.join(project, '.comet'), { recursive: true }); fs.mkdirSync(path.join(project, 'openspec'), { recursive: true });
      fs.writeFileSync(path.join(project, '.comet/config.yaml'), 'schema: comet.project.v1\ndefault_workflow: classic\nworkflows: [classic]\nclassic:\n  artifact_layout: legacy\n');
      fs.writeFileSync(path.join(project, 'openspec/config.yaml'), 'schema: spec-driven\n');
      assert.equal((await invoke(['init', 'demo', 'full', '--managed-delivery'])).exitCode, 0);
      fs.writeFileSync(path.join(change, 'proposal.md'), '# Why\n\nExercise an original Native worker-receipt refusal.\n');
      fs.writeFileSync(path.join(change, 'tasks.md'), '- [ ] 1.1 Original Native component observation\n');
    }
    const initial = await native.ensureClassicRuntimeRun(change), runId = initial.run.runId;
    const manifest = path.join(material.scratch, 'toolchain-manifest.json');
    const installationRoot = fs.realpathSync(path.join(material.artifacts, '.sdd/tools/openspec-1.11.0/node_modules'));
    const artifactSha = '84820b173b57204bd7582a47ddae65e85fd492724172acc8e434e97ea1c05c3f';
    assert.equal(sha(fs.readFileSync(path.join(material.artifacts, '.sdd/cache/artifacts/openspec-1.11.0.tgz'))), artifactSha);
    const entries = [];
    const walk = (directory) => { for (const item of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const target = path.join(directory, item.name), relative = path.relative(installationRoot, target).replaceAll('\\', '/');
      if (item.isSymbolicLink()) { assert.ok(fs.realpathSync(target).startsWith(installationRoot + path.sep)); entries.push({ path: relative, type: 'link', sha256: sha(fs.readlinkSync(target)) }); }
      else if (item.isDirectory()) { entries.push({ path: relative, type: 'directory' }); walk(target); }
      else { assert.equal(item.isFile(), true); entries.push({ path: relative, type: 'file', sha256: sha(fs.readFileSync(target)) }); }
    } };
    walk(installationRoot);
    if (!resume) fs.writeFileSync(manifest, JSON.stringify({ schema: 'comet.openspec.installation-manifest.v1', artifactSha256: artifactSha, entries }) + '\n');
    const nodePath = fs.realpathSync(process.execPath), nodeSha = sha(fs.readFileSync(nodePath));
    const environment = sha(JSON.stringify({ scope: 'component-mechanism', node: nodeSha, artifact: artifactSha, closure: sha(fs.readFileSync(manifest)), platform: process.platform, arch: process.arch }));
    const binding = { schema: 'comet.openspec.binding.v1', scope: 'component-mechanism', artifact: { name: '@fission-ai/openspec', version: '1.11.0', tarballSha256: artifactSha,
      evidenceRef: 'openspec/changes/delivery-foundation-rearchitecture/toolchain-baseline.json#openspec.npm_artifact' },
    qualification: { ref: null, digest: null, production: 'UNVERIFIED' }, node: { path: nodePath, sha256: nodeSha }, installationRoot,
    cliEntry: '@fission-ai/openspec/bin/openspec.js', manifest: { path: manifest, sha256: sha(fs.readFileSync(manifest)) }, environmentDigest: environment };
    const policy = { executionScope: 'component-mechanism', controllerEnvironmentDigest: environment, openSpecBinding: binding,
      ref: 'foundation/profiles/comet-managed.json', digest: sha(fs.readFileSync(path.join(material.repository, 'foundation/profiles/comet-managed.json'))),
      revision: 'component-owned-source', projectKnowledgeRequired: true, teamKnowledgeRequired: true, plansRoot: 'docs/comet/plans' };
    const qualification = { id: 'component-owned-record-not-production', sourceId: 'fixed-component-source', revision: '1', scope: 'protected-source', status: 'qualified',
      expiresAt: '2099-01-01T00:00:00Z', evidenceRefs: [{ ref: 'test-only/actual-process-and-native-contract', digest: sha('component-is-not-role-or-OS-qualification') }] };
    const commandFile = path.join(material.scratch, 'actual-observer.test.mjs');
    const command = JSON.stringify([process.execPath, '--test', '--test-reporter=tap', commandFile]);
    if (!resume) fs.writeFileSync(commandFile, `import test from 'node:test';import assert from 'node:assert/strict';import {runClassicCli} from ${JSON.stringify(pathToFileURL(runtimeFile).href)};test('actual Native refuses worker-owned gate receipt writes',async()=>{const r=await runClassicCli(['--json','state','set','demo','gate_receipts','[]'],undefined,{projectRoot:${JSON.stringify(project)},invocationCwd:${JSON.stringify(project)}});assert.notEqual(r.exitCode,0);assert.match(r.stdout,/machine-owned/);});\n`);
    const namespace = 'sdd-harness-i02-component';
    const roles = ['controller', 'author', 'test-author', 'reviewer', 'publisher', 'isolator'].map((containerRole) => ({ id: containerRole,
      containerRole, actionRole: containerRole === 'reviewer' ? 'requirements-owner' : containerRole,
      principalId: 'component-' + containerRole + '-NOT-A-REAL-ROLE', workspaceVolume: namespace + '_' + containerRole.replaceAll('-', '_') }));
    const runner = { schemaVersion: 1, project: 'sdd-harness-pilot', authorityId: 'component-original-authority', workspaceId: 'component-workspace', namespace,
      engineId: 'component-engine', dockerContext: 'component', imageDigest: 'sha256:' + 'a'.repeat(64), sdkFingerprint: '6da90e893105b4b00fc756260076b49e12bdbe40bc4426e4908a75e1d5732a9a',
      bootstrapDigest: sha('fixture-bootstrap-not-production'), controlVolumes: { state: namespace + '_state', receipts: namespace + '_receipts', issuance: namespace + '_issuance' }, roles };
    const physicalFile = path.join(material.scratch, 'physical-cli.mjs'), stateFile = path.join(material.scratch, 'physical-state.json'), logFile = path.join(material.scratch, 'physical-calls.jsonl');
    if (!resume) fs.writeFileSync(physicalFile, `#!${process.execPath}\nimport fs from 'node:fs';import crypto from 'node:crypto';import{spawnSync}from'node:child_process';const reg=${JSON.stringify(runner)},project=${JSON.stringify(project)},stateFile=${JSON.stringify(stateFile)},log=${JSON.stringify(logFile)},commandFile=${JSON.stringify(commandFile)},node=${JSON.stringify(process.execPath)};const a=process.argv.slice(2);if(a.shift()!=='--context'||a.shift()!==reg.dockerContext)process.exit(96);fs.appendFileSync(log,JSON.stringify(a)+'\\n');const get=()=>fs.existsSync(stateFile)?JSON.parse(fs.readFileSync(stateFile)):null;const put=(s)=>fs.writeFileSync(stateFile,JSON.stringify(s));const out=(s)=>process.stdout.write(JSON.stringify(s));if(a[0]==='info')out(reg.engineId);else if(a[0]==='image')out({id:reg.imageDigest,os:'linux',architecture:'arm64',sdk:reg.sdkFingerprint,bootstrap:reg.bootstrapDigest});else if(a[0]==='volume')out({name:a[2],driver:'local',hasOptions:false,project:reg.project,authority:reg.authorityId,workspace:reg.workspaceId});else if(a[0]==='container'){const s=get();if(s)out(s.id);}else if(a[0]==='inspect')out(get());else if(a[0]==='create'){const labels=Object.fromEntries(a.flatMap((x,i)=>x==='--label'?[a[i+1].split('=')]:[]));const mounts=a.flatMap((x,i)=>x==='--mount'?[Object.fromEntries(a[i+1].split(',').map(v=>v.split('=')))]:[]).map(m=>({type:'volume',name:m.source,destination:m.target,rw:true}));const s={id:crypto.createHash('sha256').update(labels['sdd.execution']).digest('hex'),name:'/'+a[a.indexOf('--name')+1],image:reg.imageDigest,state:'created',exitCode:0,user:'10001:10001',cwd:'/workspace',readOnly:true,privileged:false,capDrop:['ALL'],capAdd:null,securityOpt:['no-new-privileges:true'],network:'none',project:labels['sdd.project'],authority:labels['sdd.authority'],workspace:labels['sdd.workspace'],execution:labels['sdd.execution'],run:labels['sdd.run'],registration:labels['sdd.registration'],mounts};put(s);process.stdout.write(s.id);}else if(a[0]==='start'){const chunks=[];for await(const c of process.stdin)chunks.push(c);const frame=JSON.parse(Buffer.concat(chunks));const s=get();s.state='running';put(s);const result=spawnSync(node,['--test','--test-reporter=tap',commandFile],{cwd:project,encoding:'utf8',env:{PATH:process.env.PATH,HOME:${JSON.stringify(process.env.HOME)},LANG:'C.UTF-8'}});s.state='exited';s.exitCode=result.status;put(s);const report=Buffer.from(result.stdout),value=Buffer.from(JSON.stringify({exitCode:result.status,output:result.stdout})),trace=Buffer.from(JSON.stringify({processId:result.pid,command:JSON.stringify([node,'--test','--test-reporter=tap',commandFile]),methodApplied:'UNVERIFIED',roleIsolation:'UNVERIFIED'}));const hash=crypto.createHash('sha256').update(report).digest('hex');if(${JSON.stringify(Boolean(material.malformedPacket))})process.stdout.write('P13_COMPONENT_NON_JSON');else out({schemaVersion:1,run:frame.job.run,execution:frame.job.execution,envelope:{schemaVersion:1,candidateDigest:frame.dispatch.inputDigest,caseId:'component.R',check:'component:R',origin:{kind:'registered-runner',id:frame.dispatch.runnerId},execution:{id:frame.job.execution},environment:${JSON.stringify('component-env')},toolchain:process.version,executions:{total:1,valid:result.status===0?1:0},result:result.status===0?'pass':'fail',evidence:[{uri:'.whitebox/result.txt',sha256:hash}],expiry:'2099-01-01T00:00:00Z'},reportBase64:report.toString('base64'),resultBase64:value.toString('base64'),methodTraceBase64:trace.toString('base64')});}else if(a[0]==='stop'){const s=get();s.state='exited';s.exitCode=143;put(s);}else process.exit(98);\n`, { mode: 0o755 });
    let executor;
    const authority = cometLaunchAuthority({ secret: 'public-component-fixture-key-not-production', runId, sourceVerifier: async (request) => {
      const known = executor.readSourceRecord({ execution: request.dispatch.execution });
      for (const key of ['reportBytes', 'resultBytes', 'methodTraceBytes']) if (!known[key].equals(request[key])) return { ok: false };
      const tap = parseTapSummary(known.reportBytes.toString()); if (tap.tests !== 1 || tap.pass !== 1 || known.terminal.exitCode !== 0) return { ok: false };
      return { ok: true, qualification, facts: { actionDigest: envelopeDigest(known.dispatch.actionBinding), dispatchDigest: envelopeDigest(known.dispatch),
        envelopeDigest: envelopeDigest(known.envelope), launchDigest: envelopeDigest(known.launchRecord), reportDigest: sha(known.reportBytes), resultDigest: sha(known.resultBytes),
        methodTraceDigest: sha(known.methodTraceBytes), run: known.dispatch.run, execution: known.dispatch.execution, launchId: known.launchRecord.launchId,
        environmentDigest: known.dispatch.actionBinding.environmentDigest, principal: roles[3].principalId,
        observations: [{ caseId: known.envelope.caseId, check: known.envelope.check, command, result: 'pass', executions: known.envelope.executions }] } };
    } });
    const source = { policy: () => policy, authorizeWrite: () => ({ allowed: false }),
      context: (intent) => ({ actionBinding: { schemaVersion: 1, profile: 'comet-managed-v2', runnerId: 'comet-classic', run: runId,
        gate: intent.gate, action: 'original-native-component-observation', execution: intent.execution, role: intent.role, revision: 'r' + intent.generation,
        attempt: intent.attempt, epoch: intent.epoch, inputDigest: intent.inputDigest, policyDigest: policy.digest, environmentDigest: environment,
        workPackage: { id: 'original-native-gate-component', taskIds: ['1.3.a'] }, methods: [{ name: 'whitebox-verify', version: 'component-NOT-APPLIED',
          ref: '.agents/skills/whitebox-verify/SKILL.md', digest: sha(fs.readFileSync(path.join(material.repository, '.agents/skills/whitebox-verify/SKILL.md'))) }],
        allowedPaths: ['.whitebox'], allowedTools: ['read_file'], inputs: [{ name: 'proposal', ref: 'openspec/changes/demo/proposal.md', digest: sha(fs.readFileSync(path.join(change, 'proposal.md'))) }], outputs: [{ name: 'report', ref: '.whitebox/result.txt' }] }, policy,
      admissionOptions: { sourceQualification: qualification, environment: 'component-env', purpose: 'independent-acceptance', builderExecution: 'component-builder', builderPrincipal: 'component-builder',
        authoringExecutions: [], authoringPrincipals: [], now: new Date().toISOString() },
      testContract: { schemaVersion: 1, project: 'p13-component', change: 'demo', commandBindingsRequired: true,
        cases: [{ id: 'component.R', ac: 'component.binding', oracle: 'actual Node executes the Native receipt-write refusal', checkIds: ['native-check'] }],
        requiredChecks: [{ id: 'native-check', level: 'unit', capability: 'component:R', command, caseIds: ['component.R'] }], executionDenominator: { totalCases: 1 }, cleanup: { environment: 'finally', data: 'finally' }, dependencyBaselines: [{ kind: 'fixture', digest: policy.digest }] } }),
      verifyReview: ({ entry }) => ({ ok: true, sufficient: parseTapSummary(Buffer.from(entry.sourcePacket.reportBytes).toString()).pass === 1,
        evidenceDigest: sha('component-native-contract-not-semantic-review'), envelopeDigest: entry.digest, reportDigest: entry.sourcePacket.collection.reportDigest,
        actionDigest: entry.sourcePacket.collection.actionDigest, execution: entry.execution, principal: roles[3].principalId }) };
    executor = createCometExecutor({ native, authority, source, registration: { schemaVersion: 1, projectRoot: project, change: 'demo', runId, runner,
      docker: { executable: physicalFile, sha256: sha(fs.readFileSync(physicalFile)) }, actions: [{ gate: 'R', roleBindingId: 'reviewer', argv: ['observe-original-native-contract'] }] } });
    executor.install();
    if (resume) {
      const before = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '';
      await assert.rejects(executor.execute({ execution: resume.execution }), (error) => error.code === 'NATIVE_EXECUTION_RECOVERY_PORT_REQUIRED');
      assert.equal(fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '', before);
      return { runId, coldRecovery: 'UNVERIFIED_NO_RELAUNCH', sourceKeyIsPublicFixtureOnly: true };
    }
    await assert.rejects(executor.invokeNative(['--json', 'state', 'init', 'foreign', 'full', '--managed-delivery']),
      (error) => error.code === 'NATIVE_COMMAND_SCOPE_REQUIRED', 'a bound executor must never forward a different Run registration');
    assert.equal(fs.existsSync(path.join(project, 'openspec/changes/foreign')), false);
    const issued = await executor.invokeNative(['--json', 'state', 'dispatch-gate', 'demo', 'R']);
    assert.equal(issued.exitCode, 0, issued.stdout);
    let intent = JSON.parse(issued.stdout).data.dispatch;
    qualification.status = 'unqualified';
    await assert.rejects(executor.execute({ execution: intent.execution }),
      (error) => ['SOURCE_UNQUALIFIED', 'ORIGINAL_INTENT_NOT_CURRENT'].includes(error.code));
    assert.equal(fs.existsSync(logFile), false, 'unqualified source must be refused before any physical operation');
    qualification.status = 'qualified';
    await assert.rejects(async () => {
      const attempt = await executor.execute({ execution: intent.execution });
      if (attempt.terminal) await attempt.terminal;
    }, (error) => error.code === 'ORIGINAL_INTENT_NOT_CURRENT', 'restoring old source status must not revive an observed old intent');
    const renewed = await executor.invokeNative(['--json', 'state', 'dispatch-gate', 'demo', 'R']);
    assert.equal(renewed.exitCode, 0, renewed.stdout); intent = JSON.parse(renewed.stdout).data.dispatch;
    for (const extra of [{ currentActionBinding: intent.actionBinding }, { role: 'controller' }, { phase: 'build' },
      { qualified: true }, { authority }, { handle: { containerId: 'forged' } }, { module: 'arbitrary-consumer.mjs' }]) {
      await assert.rejects(executor.execute({ execution: intent.execution, ...extra }), (error) => error.code === 'EXECUTION_REQUEST_INVALID');
    }
    const launch = await executor.execute({ execution: intent.execution });
    const terminal = await launch.terminal;
    assert.equal(terminal.clientExitCode, 0, terminal.stderrBytes.toString());
    assert.equal(launch.managedClosureEligible, false);
    assert.equal(executor.observe({ execution: intent.execution }).observation.state, 'exited');
    if (material.malformedPacket) {
      assert.throws(() => executor.readSourceRecord({ execution: intent.execution }), (error) => error.code === 'ORIGINAL_RESULT_UNVERIFIED');
      const proposal = path.join(project, 'unknown-result.json'); fs.writeFileSync(proposal, JSON.stringify({ execution: intent.execution, attempt: intent.attempt, verdict: 'pass' }));
      const refusal = await executor.invokeNative(['--json', 'state', 'accept-gate', 'demo', 'R', '--file', proposal]);
      assert.notEqual(refusal.exitCode, 0, 'a successful client with unknown worker bytes must never become a gate receipt');
      assert.match(refusal.stdout, /ORIGINAL_EXECUTION_UNVERIFIED/); assert.doesNotMatch(refusal.stdout, /P13_COMPONENT_NON_JSON/);
      await executor.execute({ execution: intent.execution });
      const starts = fs.readFileSync(logFile, 'utf8').split('\n').filter((line) => line && JSON.parse(line)[0] === 'start').length;
      assert.equal(starts, 1, 'unknown result readback never starts a replacement process');
      assert.equal((await executor.describeCurrent()).phase, 'open');
      return { runId, result: 'UNVERIFIED_UNKNOWN_WORKER_OUTPUT', starts, realDocker: false, productionQualified: false };
    }
    const record = executor.readSourceRecord({ execution: intent.execution });
    assert.equal(parseTapSummary(record.reportBytes.toString()).pass, 1);
    assert.equal((await authority.collectResult(record)).ok, true, 'the actual registered raw process bytes must pass the original collector');
    const starts = () => fs.readFileSync(logFile, 'utf8').split('\n').filter((line) => line && JSON.parse(line)[0] === 'start').length;
    const count = starts(); await executor.execute({ execution: intent.execution }); assert.equal(starts(), count, 'repeat observes exact original execution');
    executor.stop({ execution: intent.execution }); assert.equal(starts(), count, 'stop never starts work');
    const proposal = path.join(project, 'proposal-result.json'); fs.writeFileSync(proposal, JSON.stringify({ execution: intent.execution, attempt: intent.attempt, verdict: 'pass' }));
    const accepted = await executor.invokeNative(['--json', 'state', 'accept-gate', 'demo', 'R', '--file', proposal]);
    assert.equal(accepted.exitCode, 0, accepted.stdout);
    assert.equal(JSON.parse(accepted.stdout).data.verdict, 'pass', accepted.stdout);
    assert.equal(JSON.parse(accepted.stdout).data.receipt.sourceEntry.managedClosureEligible, false);
    await assert.rejects(executor.execute({ execution: intent.execution }), (error) => error.code === 'ORIGINAL_INTENT_NOT_CURRENT', 'consumed attempt cannot execute again');
    const current = await executor.describeCurrent();
    assert.equal(current.run.runId, runId);
    assert.equal(current.phase, 'open', 'Gate acceptance never invents a phase transition');
    assert.equal(current.continuation.skill, 'comet-open', 'entry comes from the original Runtime continuation');
    assert.equal(current.authoring.status, 'UNVERIFIED', 'Gate mechanics do not fill the missing native author/Builder port');
    fs.appendFileSync(path.join(change, 'proposal.md'), '\nNew source revision.\n');
    const pending = await executor.invokeNative(['--json', 'state', 'dispatch-gate', 'demo', 'R']); assert.equal(pending.exitCode, 0, pending.stdout);
    return { runId, execution: intent.execution, strictGate: JSON.parse(accepted.stdout).data.verdict, starts: count,
      pendingExecution: JSON.parse(pending.stdout).data.dispatch.execution, methodApplied: 'UNVERIFIED', modelRoleOS: 'UNVERIFIED' };
  } finally { if (priorHome === undefined) delete process.env.HOME; else process.env.HOME = priorHome; }
}

test('original Native intent runs through the fixed I02 three-port implementation and returns real process evidence to the same Run', async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'p13-fixed-host-'));
  try {
    const material = { repository, artifacts: process.env.P1_3_ACCEPTED_ARTIFACT_ROOT ?? repository, scratch, project: path.join(scratch, 'project') };
    const result = await nativeProcessFixture(material);
    const program = path.join(scratch, 'cold-readback.mjs');
    fs.writeFileSync(program, `const f=${nativeProcessFixture.toString()};console.log(JSON.stringify(await f(${JSON.stringify(material)},${JSON.stringify({ execution: result.pendingExecution })})));\n`);
    const cold = spawnSync(process.execPath, [program], { encoding: 'utf8', timeout: 60_000 });
    assert.equal(cold.status, 0, cold.stderr);
    const recovered = JSON.parse(cold.stdout); assert.equal(recovered.runId, result.runId); assert.equal(recovered.coldRecovery, 'UNVERIFIED_NO_RELAUNCH');
    assert.equal(fs.readFileSync(path.join(scratch, 'physical-calls.jsonl'), 'utf8').split('\n').filter((line) => line && JSON.parse(line)[0] === 'start').length, result.starts);
    console.log(JSON.stringify({ component: 'fixed-host-native-three-port', ...result, cold: recovered, realDocker: false, productionQualified: false }));
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
});

test('client exit zero with unknown worker bytes cannot authorize an original Native gate or a retry', () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'p13-unknown-result-'));
  try {
    const material = { repository, artifacts: process.env.P1_3_ACCEPTED_ARTIFACT_ROOT ?? repository, scratch,
      project: path.join(scratch, 'project'), malformedPacket: true };
    const program = path.join(scratch, 'unknown-result.mjs');
    fs.writeFileSync(program, `const f=${nativeProcessFixture.toString()};console.log(JSON.stringify(await f(${JSON.stringify(material)})));\n`);
    const child = spawnSync(process.execPath, [program], { encoding: 'utf8', timeout: 60_000 });
    assert.equal(child.status, 0, child.stderr);
    assert.equal(JSON.parse(child.stdout).result, 'UNVERIFIED_UNKNOWN_WORKER_OUTPUT');
    console.log(child.stdout.trim());
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
});

test('the packaged executable and its fixed symlink refuse an unbound controller despite environment role labels', () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'p13-bootstrap-entry-'));
  try {
    const entry = path.join(repository, 'lib/adapters/comet-executor.js');
    const linked = path.join(scratch, 'runner-host.mjs');
    const marker = path.join(scratch, 'untrusted-module-loaded');
    const untrusted = path.join(scratch, 'untrusted-bootstrap.mjs');
    fs.writeFileSync(untrusted, `import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(marker)},'loaded');\n`);
    fs.writeFileSync(path.join(scratch, '.env'), 'P13_SYNTHETIC_NOT_A_CREDENTIAL\n');
    fs.symlinkSync(entry, linked);
    const before = fs.readdirSync(scratch).sort();
    for (const executable of [entry, linked]) {
      const result = spawnSync(process.execPath, [executable, '--json', 'state', 'next', 'demo'], {
        cwd: scratch, encoding: 'utf8', timeout: 10_000,
        env: { PATH: process.env.PATH, HOME: scratch, LANG: 'C.UTF-8',
          P1_3_GUARD_TRACE: process.env.P1_3_GUARD_TRACE ?? '', COMET_ROLE: 'controller',
          SDD_RUNNER_ROLE: 'controller', COMET_BOOTSTRAP_MODULE: untrusted },
      });
      assert.equal(result.signal, null);
      assert.equal(result.status, 2, 'a missing protected bootstrap must not silently exit successfully');
      const status = JSON.parse(result.stdout);
      assert.equal(status.status, 'UNVERIFIED');
      assert.equal(status.code, 'PROTECTED_BOOTSTRAP_REQUIRED');
      assert.equal(status.managedClosureEligible, false);
      assert.equal(status.productionQualified, false);
      assert.equal(result.stderr, '');
      assert.doesNotMatch(result.stdout, /P13_SYNTHETIC|untrusted-bootstrap/);
    }
    assert.equal(fs.existsSync(marker), false, 'the entry must never load a caller-selected module');
    assert.deepEqual(fs.readdirSync(scratch).sort(), before, 'no original Run, provider or credential file is created');
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
});

test('the executable rejects malformed or authority-selecting arguments before any bootstrap', async (t) => {
  const { runCometHostMain } = await import('../lib/adapters/comet-executor.js');
  const cases = [
    ['undefined', undefined], ['null', null], ['object', {}], ['string', 'state next demo'], ['empty', []],
    ['null item', ['state', null, 'demo']], ['zero byte', ['state', 'next', 'de\0mo']],
    ['sparse argument', ['state', 'set', 'demo', 'proposal', ,]],
    ['overlong item', ['state', 'next', 'x'.repeat(4097)]], ['too many items', Array(65).fill('state')],
    ['unknown command', ['/comet-build']], ['unknown state operation', ['state', 'init', 'demo', 'full']],
    ['get without required field', ['state', 'get', 'demo']],
    ['escaped change', ['state', 'next', '../foreign']],
    ['json option twice', ['--json', '--json', 'state', 'next', 'demo']],
    ['json option misplaced', ['state', '--json', 'next', 'demo']],
    ['controller option', ['state', 'next', 'demo', '--role', 'controller']],
    ['provider option', ['state', 'next', 'demo', '--provider', 'P13_ARBITRARY_SHORT_NOTE']],
    ['module option', ['state', 'next', 'demo', '--module', './P13_ARBITRARY_SHORT_NOTE.mjs']],
    ['project override', ['state', 'next', 'demo', '--project-root', '/P13_ARBITRARY_SHORT_NOTE']],
    ['cwd override', ['state', 'next', 'demo', '--cwd', '/P13_ARBITRARY_SHORT_NOTE']],
    ['external forwarding', ['state', 'next', 'demo', '--', 'node']],
  ];
  for (const [name, argv] of cases) await t.test(name, async () => {
    const result = await runCometHostMain(argv);
    assert.equal(result.exitCode, 1, 'invalid input must be distinguished from absent qualification');
    const status = JSON.parse(result.stdout);
    assert.equal(status.status, 'INPUT_INVALID');
    assert.equal(status.code, 'NATIVE_ARGUMENTS_INVALID');
    assert.doesNotMatch(result.stdout, /P13_ARBITRARY_SHORT_NOTE|4097|foreign/);
  });
});

// Separate entry fixture: the historical 559 Gate fixture above is unchanged.
// These CODE ports carry no source qualification and never launch a worker.
async function bootstrapReadFixture(material) {
  const fs = await import('node:fs'), path = await import('node:path'), crypto = await import('node:crypto');
  const { pathToFileURL } = await import('node:url');
  const assert = (await import('node:assert/strict')).default;
  const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
  const { createCometExecutor, runCometHostMain } = await import(pathToFileURL(path.join(material.repository, 'lib/adapters/comet-executor.js')));
  const { cometLaunchAuthority } = await import(pathToFileURL(path.join(material.repository, 'lib/adapters/comet.js')));
  const sdkFingerprint = '6da90e893105b4b00fc756260076b49e12bdbe40bc4426e4908a75e1d5732a9a';
  const runtimeFile = path.join(material.artifacts, '.sdd/vendor/comet/c90af44a4474662d7853aae76ce785404974fb0a/builds', sdkFingerprint, 'work/assets/skills/comet/scripts/comet-runtime.mjs');
  assert.equal(sha(fs.readFileSync(runtimeFile)), '04795080295d7174af82913757254426b82037ea5028296a3602b86d200559dd');
  const native = await import(pathToFileURL(runtimeFile));
  const priorHome = process.env.HOME;
  process.env.HOME = path.join(material.scratch, 'home'); fs.mkdirSync(process.env.HOME);
  try {
    const project = path.join(material.scratch, 'project');
    fs.mkdirSync(path.join(project, '.comet'), { recursive: true }); fs.mkdirSync(path.join(project, 'openspec'));
    fs.writeFileSync(path.join(project, '.comet/config.yaml'), 'schema: comet.project.v1\ndefault_workflow: classic\nworkflows: [classic]\nclassic:\n  artifact_layout: legacy\n');
    fs.writeFileSync(path.join(project, 'openspec/config.yaml'), 'schema: spec-driven\n');
    const options = { projectRoot: project, invocationCwd: project };
    const init = await native.runClassicCli(['--json', 'state', 'init', 'demo', 'full', '--managed-delivery'], undefined, options);
    assert.equal(init.exitCode, 0, init.stdout);
    const change = path.join(project, 'openspec/changes/demo');
    const { run } = await native.ensureClassicRuntimeRun(change);
    const namespace = 'sdd-harness-i02-entry-component';
    const roles = ['controller', 'author', 'test-author', 'reviewer', 'publisher', 'isolator'].map((role) => ({
      id: role, actionRole: role, containerRole: role, principalId: 'component-NOT-PRODUCTION-' + role,
      workspaceVolume: namespace + '_' + role.replaceAll('-', '_') }));
    const runner = { schemaVersion: 1, project: 'sdd-harness-pilot', authorityId: 'component-only-authority',
      workspaceId: 'component-only-workspace', namespace, engineId: 'NOT-A-REAL-ENGINE', dockerContext: 'component',
      imageDigest: 'sha256:' + 'a'.repeat(64), sdkFingerprint, bootstrapDigest: sha('component-not-a-packaged-image'), roles,
      controlVolumes: { state: namespace + '_state', receipts: namespace + '_receipts', issuance: namespace + '_issuance' } };
    const sentinel = 'P13_SHORT_NON_CREDENTIAL_NOTE';
    const producer = material.fault ? { ...native, runClassicCli() {
      if (material.fault === 'throw') throw Object.assign(new Error(sentinel), { code: sentinel });
      if (material.fault === 'bad-result') return { exitCode: 0, stdout: { value: sentinel } };
      if (material.fault === 'unknown-exit') return { exitCode: 64, stdout: sentinel };
      return { exitCode: 2, stdout: '{"status":"UNVERIFIED","code":"NATIVE_FIXTURE_REFUSAL"}\n', productionQualified: true };
    } } : native;
    const authority = cometLaunchAuthority({ secret: 'public-entry-fixture-key-not-a-production-credential', runId: run.runId });
    const source = { policy: () => ({}), context: () => ({}), authorizeWrite: () => ({ allowed: false }), verifyReview: () => ({ ok: false }) };
    const physicalMarker = path.join(material.scratch, 'unexpected-physical-command');
    const physicalGuard = path.join(material.scratch, 'forbidden-physical-cli.mjs');
    fs.writeFileSync(physicalGuard, `#!${process.execPath}\nimport fs from 'node:fs';fs.appendFileSync(${JSON.stringify(physicalMarker)},'attempt\\n');process.exitCode=97;\n`, { mode: 0o755 });
    const physicalAttempts = () => fs.existsSync(physicalMarker) ? fs.readFileSync(physicalMarker, 'utf8').trim().split('\n').length : 0;
    const executor = createCometExecutor({ native: producer, authority, source,
      registration: { schemaVersion: 1, projectRoot: project, change: 'demo', runId: run.runId, runner,
        docker: { executable: physicalGuard, sha256: sha(fs.readFileSync(physicalGuard)) },
        actions: [{ gate: 'R', roleBindingId: 'reviewer', argv: ['UNBOUND-WORKER-MUST-NOT-LAUNCH'] }] } });
    const argv = ['--json', 'state', 'get', 'demo', 'phase'];
    if (material.fault) {
      const result = await runCometHostMain(argv, executor);
      assert.equal(result.exitCode, material.fault === 'native-refusal' ? 2 : 1, result.stdout);
      assert.equal(result.productionQualified ?? JSON.parse(result.stdout).productionQualified, false);
      assert.doesNotMatch(result.stdout, new RegExp(sentinel));
      if (material.fault !== 'native-refusal') assert.equal(JSON.parse(result.stdout).status, 'INTERNAL_FAILURE');
      assert.equal(physicalAttempts(), 0);
      return { fault: material.fault, exitCode: result.exitCode, status: result.stdout.trim(), productionQualified: false };
    }
    const expected = await native.runClassicCli(argv, undefined, options);
    assert.equal(expected.exitCode, 0, expected.stdout); assert.equal(JSON.parse(expected.stdout).stdout.trim(), 'open');
    const results = [await runCometHostMain(argv, executor), ...await Promise.all([
      runCometHostMain(argv, executor), runCometHostMain(argv, executor), runCometHostMain(argv, executor) ])];
    for (const result of results) {
      assert.equal(result.exitCode, 0, result.stdout); assert.equal(result.stdout, expected.stdout);
      assert.equal(result.managedClosureEligible, false); assert.equal(result.productionQualified, false);
    }
    for (const copied of [{ ...executor }, new Proxy(executor, {})]) {
      const refusal = await runCometHostMain(argv, copied);
      assert.equal(refusal.exitCode, 1); assert.equal(JSON.parse(refusal.stdout).code, 'FIXED_HOST_CAPABILITY_REQUIRED');
    }
    let invoked = false;
    const fake = { install() { invoked = true; }, invokeNative() { invoked = true; } };
    assert.equal((await runCometHostMain(argv, fake)).exitCode, 1); assert.equal(invoked, false);
    const foreign = await runCometHostMain(['--json', 'state', 'get', 'foreign', 'phase'], executor);
    assert.equal(foreign.exitCode, 1); assert.equal(JSON.parse(foreign.stdout).code, 'NATIVE_COMMAND_SCOPE_REQUIRED');
    assert.equal(fs.existsSync(path.join(project, 'openspec/changes/foreign')), false);
    const current = await runCometHostMain(['--json', 'state', 'get', 'demo', 'run_id'], executor);
    assert.equal(current.exitCode, 0, current.stdout); assert.equal(JSON.parse(current.stdout).stdout.trim(), run.runId);
    assert.equal(physicalAttempts(), 0);
    return { sdkFingerprint, entryRead: 'open', repeatedReads: results.length, run: run.runId,
      sourceQualification: 'ABSENT', physicalCommandAttempts: physicalAttempts(), productionQualified: false };
  } finally { if (priorHome === undefined) delete process.env.HOME; else process.env.HOME = priorHome; }
}

test('the CODE-bound main delegates repeat and concurrent reads to one original Native Host on the same private Run', () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'p13-bootstrap-read-'));
  try {
    const material = { repository, artifacts: process.env.P1_3_ACCEPTED_ARTIFACT_ROOT ?? repository, scratch };
    const program = path.join(scratch, 'read-entry.mjs');
    fs.writeFileSync(program, `const f=${bootstrapReadFixture.toString()};console.log(JSON.stringify(await f(${JSON.stringify(material)})));\n`);
    const child = spawnSync(process.execPath, [program], { encoding: 'utf8', timeout: 30_000 });
    assert.equal(child.status, 0, child.stderr);
    const result = JSON.parse(child.stdout); assert.equal(result.entryRead, 'open'); assert.equal(result.repeatedReads, 4);
    assert.equal(result.physicalCommandAttempts, 0); assert.equal(result.productionQualified, false);
    console.log(child.stdout.trim());
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
});

test('the main distinguishes Native refusal from malformed results and unknown exceptions without echoing producer diagnostics', async (t) => {
  for (const fault of ['throw', 'bad-result', 'unknown-exit', 'native-refusal']) await t.test(fault, () => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'p13-bootstrap-result-'));
    try {
      const material = { repository, artifacts: process.env.P1_3_ACCEPTED_ARTIFACT_ROOT ?? repository, scratch, fault };
      const program = path.join(scratch, 'result-entry.mjs');
      fs.writeFileSync(program, `const f=${bootstrapReadFixture.toString()};console.log(JSON.stringify(await f(${JSON.stringify(material)})));\n`);
      const child = spawnSync(process.execPath, [program], { encoding: 'utf8', timeout: 30_000 });
      assert.equal(child.status, 0, child.stderr);
      const result = JSON.parse(child.stdout);
      assert.equal(result.exitCode, fault === 'native-refusal' ? 2 : 1);
      assert.equal(result.productionQualified, false);
      assert.doesNotMatch(child.stdout, /P13_SHORT_NON_CREDENTIAL_NOTE/);
      console.log(child.stdout.trim());
    } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
  });
});

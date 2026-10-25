// Native gate/transaction MECHANISMS, not deployed source/role/method/Journey
// qualification. Child sources assert the actual built Native implementation.
// Consumer code is imported statically here; production exposes no test flag,
// env/path consumer loader, injected kernel handler or generic signing API.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  createLaunchAuthority,
  admitEvidence,
  envelopeDigest,
} from '../../lib/delivery/evidence.js';
import { evaluate } from '../../lib/delivery/gate.js';
import { taskDefinitionDigest } from '../../lib/delivery/baseline.js';
import { parseTapSummary } from '../../lib/delivery/test-contract.js';
import { verifyCometDistribution } from '../../tools/comet/build.mjs';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// Build-pin seam for controller-reviewed pre-integration patches only. It
// cannot choose host consumers: all callbacks below are this test's code.
const lock = JSON.parse(
  fs.readFileSync(
    process.env.COMET_UPSTREAM_LOCK ??
      path.join(repository, 'integrations/comet/upstream.lock.json'),
    'utf8',
  ),
);
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const fingerprint = sha(
  JSON.stringify({
    archive: lock.source.sha256,
    patches: lock.patches.map(({ path, sha256 }) => ({ path, sha256 })),
    toolchain: lock.toolchain,
  }),
);
const work = path.join(
  repository,
  '.sdd/vendor/comet',
  lock.source.commit,
  'builds',
  fingerprint,
  'work',
);
const nativeUrl = pathToFileURL(
  path.join(work, 'assets/skills/comet/scripts/comet-runtime.mjs'),
).href;
const scenario = process.argv.indexOf('--mechanism-case');
const restartMode = process.argv.indexOf('--mechanism-restart');
const scenarios = {
  forwarding:
    'C07: managed raw/agent/implicit/store/unknown OpenSpec mutations cannot bypass archive',
  control: 'managed malformed state never falls back to a wider legacy write scope',
  registration: 'Design registration cannot be repointed by a standalone unprotected caller',
  authorwrite: 'Design registered test intent uses exact authenticated writer scope',
  intentlinks: 'managed lexical write targets cannot escape through the external exemption',
  designroutes: 'Design A/T rejection points to author revision without a forbidden phase transition',
  origin: 'D01: actual collected source, exact Run readback and replay refusal',
  pending:
    'D02/RW_REVISION_NO_REVIVE: first pending revision and restored bytes never revive the old attempt',
  longread: 'D02: A/T long collector releases lock and rejects changed design/test intent',
  review: 'A/T: missing or insufficient completed review cannot become a passing gate',
  candidate:
    'D05: actual accepted V becomes stale on non-JS candidate change without revoking RATP',
  planning: 'D05: original Build plan step precedes P; real progress preserves definitions',
  design: 'D04: design drift invalidates downstream and survives byte restoration',
  repairA: 'D03: controlled architecture repair keeps the same original Run',
  repairT: 'D03: controlled test-design repair keeps the same original Run',
  repairAverify: 'D03: Verify architecture repair retains its original event and Run',
  repairTverify: 'D03: Verify test repair retains its original event and Run',
  repair: 'D03: controlled requirements/architecture/test repair keeps the same Run',
  versions: 'current source/method/policy versions cannot resurrect an observed old approval',
  concurrent: 'same native intent has one owner and only one atomic acceptance',
  plans: 'managed fixed derived plan root accepts only docs/comet/plans; missing host rejects',
  toolpaths: 'registered real CLI ignores unavailable environment-selected locations',
  toolmissing: 'missing protected tool binding refuses a public read request',
  tooldigest: 'changed closure-manifest data refuses a public read request',
  tooldata: 'changed installed ordinary data refuses a public read request',
  toolrecheck: 'a subsequent public call revalidates the complete installed tree',
  postgit:
    'Git-tracked active inputs preserve the original Run and current Kt after controlled archive',
  postcrash: 'actual SIGKILL after Kt commit restores the original Run in a new Native process',
  postdeliverypending:
    'independently current Kt cannot complete while original delivery verification fails',
  postreceipttamper: 'native delivery receipt tampering still blocks completion after valid Kt',
  postreceiptforeign: 'foreign delivery receipt identity never completes the same Run',
  postauthorization: 'missing native delivery authorization blocks completion after valid Kt',
  postdelta: 'actual pinned OpenSpec delta merge preserves same Run Kt continuation',
  posttamper: 'post-archive bridge edits cannot authenticate an altered input mapping',
  postdesign: 'post-archive design changes block Kt on the original Run',
  postprotosource: 'ordinary root filename __proto__ remains a bound source input after archive',
  postsource: 'post-archive source changes block Kt on the original Run',
  postmethod: 'post-archive method changes block old approvals',
  postenvironment: 'post-archive environment changes block old approvals',
  postqualification:
    'component source qualification revocation blocks old approvals; actual ACL remains UNVERIFIED',
  postarchive: 'D07: actual Spec archive preserves the same pending Run and resumes Kt',
  archive: 'D07: stale Kp cannot start the real archive operation',
  throughverify: 'C07: actual Native commands and R/A/T/P/V/Kp enter Archive phase',
};

function actualOpenSpecBinding(artifacts, isolated) {
  const artifactSha = '84820b173b57204bd7582a47ddae65e85fd492724172acc8e434e97ea1c05c3f';
  const tar = path.join(repository, '.sdd/cache/artifacts/openspec-1.11.0.tgz');
  assert.equal(
    sha(fs.readFileSync(tar)),
    artifactSha,
    'UNVERIFIED: actual pinned P1_1 tool artifact missing or changed',
  );
  const original = fs.realpathSync(
    path.join(repository, '.sdd/tools/openspec-1.11.0/node_modules'),
  );
  let installationRoot = isolated ? path.join(artifacts, 'toolchain/node_modules') : original;
  if (isolated) {
    fs.mkdirSync(path.dirname(installationRoot), { recursive: true });
    fs.cpSync(original, installationRoot, { recursive: true, verbatimSymlinks: true });
    installationRoot = fs.realpathSync(installationRoot);
    // npm may create absolute in-tree launch links. Preserve their meaning
    // in the private copy instead of pointing back at the original install.
    const relocate = (directory) => {
      for (const item of fs.readdirSync(directory,{withFileTypes:true})) {
        const target=path.join(directory,item.name);
        if (item.isDirectory()) relocate(target);
        else if (item.isSymbolicLink()) {
          const resolved=fs.realpathSync(target);
          const copied=path.relative(installationRoot,resolved);
          if (!path.isAbsolute(copied)&&copied!=='..'&&!copied.startsWith('..'+path.sep)) continue;
          const origin=path.relative(original,resolved);
          assert.ok(!path.isAbsolute(origin)&&origin!=='..'&&!origin.startsWith('..'+path.sep),'only genuine original in-tree links may relocate');
          fs.unlinkSync(target);
          fs.symlinkSync(path.relative(path.dirname(target),path.join(installationRoot,origin)),target);
        }
      }
    };
    relocate(installationRoot);
  }
  const pkg = JSON.parse(
    fs.readFileSync(path.join(installationRoot, '@fission-ai/openspec/package.json'), 'utf8'),
  );
  assert.equal(pkg.name, '@fission-ai/openspec');
  assert.equal(pkg.version, '1.11.0');
  const entries = [];
  const walk = (directory) => {
    for (const item of fs
      .readdirSync(directory, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const target = path.join(directory, item.name),
        name = path.relative(installationRoot, target).replaceAll('\\', '/');
      if (item.isSymbolicLink()) {
        const rel = path.relative(installationRoot, fs.realpathSync(target));
        assert.ok(!path.isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + path.sep));
        entries.push({ path: name, type: 'link', sha256: sha(fs.readlinkSync(target)) });
      } else if (item.isDirectory()) {
        entries.push({ path: name, type: 'directory' });
        walk(target);
      } else {
        assert.ok(item.isFile());
        entries.push({ path: name, type: 'file', sha256: sha(fs.readFileSync(target)) });
      }
    }
  };
  walk(installationRoot);
  const manifestPath = path.join(artifacts, 'toolchain-manifest.json');
  fs.writeFileSync(
    manifestPath,
    JSON.stringify({
      schema: 'comet.openspec.installation-manifest.v1',
      artifactSha256: artifactSha,
      entries,
    }) + '\n',
  );
  const nodePath = fs.realpathSync(process.execPath),
    nodeSha = sha(fs.readFileSync(nodePath));
  return {
    schema: 'comet.openspec.binding.v1',
    scope: 'component-mechanism',
    artifact: {
      name: pkg.name,
      version: pkg.version,
      tarballSha256: artifactSha,
      evidenceRef:
        'openspec/changes/delivery-foundation-rearchitecture/toolchain-baseline.json#openspec.npm_artifact',
    },
    qualification: { ref: null, digest: null, production: 'UNVERIFIED' },
    node: { path: nodePath, sha256: nodeSha },
    installationRoot: fs.realpathSync(installationRoot),
    cliEntry: '@fission-ai/openspec/bin/openspec.js',
    manifest: { path: manifestPath, sha256: sha(fs.readFileSync(manifestPath)) },
    environmentDigest: sha(
      JSON.stringify({
        scope: 'component-mechanism',
        node: nodeSha,
        artifact: artifactSha,
        closure: sha(fs.readFileSync(manifestPath)),
        platform: process.platform,
        arch: process.arch,
      }),
    ),
  };
}

async function fixture({
  withDelta = false,
  gitTracked = false,
  isolatedToolchain = false,
  resume = null,
} = {}) {
  assert.equal(
    process.versions.node,
    lock.toolchain.node,
    'run the exact locked Node, not a host alias',
  );
  const native = await import(nativeUrl); // exact manifest-pinned built module, never caller-selected consumer code
  const scratch = resume?.scratch ?? fs.mkdtempSync(path.join(os.tmpdir(), 'native-2-4-'));
  const project = path.join(scratch, 'project');
  const artifacts = path.join(scratch, 'artifacts');
  const home = path.join(scratch, 'home');
  for (const dir of [project, artifacts, home]) fs.mkdirSync(dir, { recursive: true });
  const prior = {
    HOME: process.env.HOME,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
  };
  process.env.HOME = home;
  process.env.XDG_CONFIG_HOME = path.join(home, '.config');
  const records = new Map(resume?.records ?? []),
    commands = [],
    assertions = [];
  const openSpecBinding =
    resume?.openSpecBinding ?? actualOpenSpecBinding(artifacts, isolatedToolchain);
  const policy = {
    executionScope: 'component-mechanism',
    controllerEnvironmentDigest: openSpecBinding.environmentDigest,
    openSpecBinding,
    ref: 'foundation/profiles/comet-managed.json',
    digest: sha(fs.readFileSync(path.join(repository, 'foundation/profiles/comet-managed.json'))),
    revision: 'fixture-registry-1',
    projectKnowledgeRequired: true,
    teamKnowledgeRequired: true,
    plansRoot: 'docs/comet/plans',
  };
  const methodDigest = sha(
    fs.readFileSync(path.join(repository, '.agents/skills/whitebox-verify/SKILL.md')),
  );
  let environment = openSpecBinding.environmentDigest;
  for (const record of records.values())
    for (const key of ['reportBytes', 'resultBytes', 'methodTraceBytes'])
      record[key] = Buffer.from(record[key].data);
  const fixtureSecret = resume?.secret ?? crypto.randomBytes(32).toString('hex');
  let inputDigest = resume?.inputDigest ?? sha('not-created'),
    readHook = null,
    reviewMode = 'sufficient',
    methodVersion = methodDigest;
  const qualification = {
    id: 'component-registry-not-deployment',
    sourceId: 'native-contract-source',
    revision: '1',
    scope: 'protected-source',
    status: 'qualified',
    expiresAt: '2099-01-01T00:00:00Z',
    evidenceRefs: [
      {
        ref: 'test-only/source-record',
        digest: sha('no-OS-or-role-qualification'),
      },
    ],
  };
  const commandArgv = [
    process.execPath,
    '--test',
    '--test-reporter=tap',
    path.join(artifacts, 'observer.test.mjs'),
  ];
  const commandIdentity = JSON.stringify(commandArgv);
  const actionFor = (intent) => ({
    schemaVersion: 1,
    profile: 'comet-managed-v2',
    runnerId: 'native-contract-source',
    run: intent.runId ?? intent.actionBinding?.run,
    gate: intent.gate,
    action: 'observe-native-contract',
    execution: intent.execution,
    role: intent.role,
    revision: `r${intent.generation}`,
    attempt: intent.attempt,
    epoch: intent.epoch,
    inputDigest: intent.inputDigest,
    policyDigest: policy.digest,
    environmentDigest: environment,
    workPackage: { id: 'component-2.4', taskIds: ['2.4.a'] },
    methods: [
      {
        name: 'whitebox-verify',
        version: 'fixture-method-NOT-APPLIED',
        ref: '.agents/skills/whitebox-verify/SKILL.md',
        digest: methodVersion,
      },
    ],
    allowedPaths: ['.whitebox'],
    allowedTools: ['read_file'],
    inputs: [
      {
        name: 'proposal',
        ref: 'openspec/changes/demo/proposal.md',
        digest: inputDigest,
      },
    ],
    outputs: [{ name: 'report', ref: '.whitebox/record.txt' }],
  });
  const context = (intent) => ({
    actionBinding: actionFor(intent),
    policy,
    admissionOptions: {
      sourceQualification: records.get(intent.execution)?.qualification ?? qualification,
      environment: 'component-env',
      purpose: 'independent-acceptance',
      builderExecution: 'fixture-builder-NOT-A-REAL-ROLE',
      builderPrincipal: 'fixture-builder-NOT-A-REAL-PRINCIPAL',
      authoringExecutions: [],
      authoringPrincipals: [],
      now: new Date().toISOString(),
    },
    testContract: {
      schemaVersion: 1,
      project: 'native-component-contract',
      change: 'demo',
      commandBindingsRequired: true,
      cases: [
        {
          id: `component.${intent.gate}`,
          ac: 'component.binding',
          oracle: 'original Native contract assertion runs and its byte-bound result is admitted',
          checkIds: ['native-check'],
        },
      ],
      requiredChecks: [
        {
          id: 'native-check',
          level: 'unit',
          capability: `component:${intent.gate}`,
          command: commandIdentity,
          caseIds: [`component.${intent.gate}`],
        },
      ],
      executionDenominator: { totalCases: 1 },
      cleanup: { environment: 'finally removed', data: 'finally removed' },
      dependencyBaselines: [{ kind: 'fixture', digest: policy.digest }],
    },
  });
  const actualAuthority = createLaunchAuthority({
    secret: fixtureSecret,
    sourceVerifier: async (request) => {
      const known = records.get(request.dispatch.execution);
      if (
        !known ||
        !known.reportBytes.equals(request.reportBytes) ||
        !known.resultBytes.equals(request.resultBytes) ||
        !known.methodTraceBytes.equals(request.methodTraceBytes)
      )
        return { ok: false };
      const { dispatch, envelope, launchRecord, reportBytes, resultBytes, methodTraceBytes } =
        known;
      return {
        ok: true,
        qualification: known.qualification,
        facts: {
          actionDigest: envelopeDigest(dispatch.actionBinding),
          dispatchDigest: envelopeDigest(dispatch),
          envelopeDigest: envelopeDigest(envelope),
          launchDigest: envelopeDigest(launchRecord),
          reportDigest: sha(reportBytes),
          resultDigest: sha(resultBytes),
          methodTraceDigest: sha(methodTraceBytes),
          run: dispatch.run,
          execution: dispatch.execution,
          launchId: launchRecord.launchId,
          environmentDigest: dispatch.actionBinding.environmentDigest,
          principal: 'component-recorder-NOT-A-REAL-ROLE',
          observations: [
            {
              caseId: envelope.caseId,
              check: envelope.check,
              command: commandIdentity,
              result: 'pass',
              executions: envelope.executions,
            },
          ],
        },
      };
    },
  });
  const authority = {
    ...actualAuthority,
    issueDispatch: (binding) => {
      const roots = [path.join(project, 'openspec/changes/demo')];
      const archive = path.join(project, 'openspec/changes/archive');
      if (fs.existsSync(archive))
        for (const name of fs.readdirSync(archive)) {
          const directory = path.join(archive, name);
          const state = path.join(directory, '.comet/run-state.json');
          if (
            fs.existsSync(state) &&
            JSON.parse(fs.readFileSync(state, 'utf8')).runId === binding.run
          )
            roots.push(directory);
        }
      assert.equal(
        roots.some((directory) => fs.existsSync(path.join(directory, '.comet-state.lock'))),
        true,
        'authority signs only under the same original Run short lock, including its controlled archive move',
      );
      return actualAuthority.issueDispatch(binding);
    },
  };
  // This map is a fixture-owned source record, not caller-supplied identity.
  // Real author launch/OS qualification remains UNVERIFIED.
  const writeDrivers = new Map();
  let activeWriteDriver = null;
  const authorizeFixtureWrite = ({ nativeRunId, request }) => {
    const known = writeDrivers.get(activeWriteDriver);
    if (!known || request?.intent !== 'write' || request.toolName !== 'Write'
      || !known.tools.includes(request.toolName) || !actualAuthority.verifyDispatch(known.dispatch).ok
      || known.dispatch.actionBinding.run !== nativeRunId) return { allowed: false };
    const requested = request.targets.map((file) => path.relative(project, file).replaceAll('\\', '/'));
    const paths = known.dispatch.actionBinding.allowedPaths;
    if (requested.some((target) => !paths.some((allow) => target === allow || target.startsWith(allow + '/')))) return { allowed: false };
    return { allowed: true, dispatch: known.dispatch };
  };
  const host = {
    authority,
    policy: () => policy,
    context,
    definitionDigest: taskDefinitionDigest,
    authorizeWrite: authorizeFixtureWrite,
    admitEvidence,
    evaluate,
    readResult: async (intent) => {
      assert.equal(
        fs.existsSync(path.join(project, 'openspec/changes/demo/.comet-state.lock')),
        false,
        'long readback must not hold native lock',
      );
      if (readHook) await readHook(intent);
      const record = records.get(intent.execution);
      if (!record)
        throw new Error('UNVERIFIED: registered source is not complete; do not relaunch');
      return record;
    },
    verifyReview: ({ entry }) =>
      reviewMode === 'missing'
        ? { ok: false }
        : {
            ok: true,
            sufficient: reviewMode === 'sufficient',
            evidenceDigest: sha('component-only-completed-native-check'),
            envelopeDigest: entry.digest,
            reportDigest: entry.sourcePacket.collection.reportDigest,
            actionDigest: entry.sourcePacket.collection.actionDigest,
            execution: entry.execution,
            principal: 'component-recorder-NOT-A-REAL-ROLE',
          },
  };
  native.installManagedDeliveryHost(host);
  assert.throws(() => native.installManagedDeliveryHost(host), /replacement is forbidden/);
  const refresh = () => {
    const file = path.join(project, 'openspec/changes/demo/proposal.md');
    if (fs.existsSync(file)) inputDigest = sha(fs.readFileSync(file));
  };
  const invoke = async (argv) => {
    refresh();
    const started = new Date().toISOString();
    const result = await native.runClassicCli(['--json', ...argv], undefined, {
      projectRoot: project,
      invocationCwd: project,
    });
    const json = JSON.parse(result.stdout ?? '{}');
    commands.push({
      argv,
      started,
      ended: new Date().toISOString(),
      exitCode: result.exitCode,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
    });
    return { ...result, json };
  };
  const state = (argv) => invoke(['state', ...argv]);
  const ok = async (argv) => {
    const result = await state(argv);
    assert.equal(
      result.exitCode,
      0,
      JSON.stringify(result.json.data?.issues ?? result.json.stderr),
    );
    return result;
  };
  const get = async (field) => JSON.parse((await ok(['get', 'demo', field])).stdout).stdout.trim();
  const change = path.join(project, 'openspec/changes/demo');
  if (!resume) {
    fs.mkdirSync(path.join(project, '.comet'), { recursive: true });
    fs.writeFileSync(
      path.join(project, '.comet/config.yaml'),
      'schema: comet.project.v1\ndefault_workflow: classic\nworkflows: [classic]\nclassic:\n  artifact_layout: legacy\n',
    );
    fs.mkdirSync(path.join(project, 'openspec'), { recursive: true });
    fs.writeFileSync(path.join(project, 'openspec/config.yaml'), 'schema: spec-driven\n');
    const existingSpec = path.join(project, 'openspec/specs/existing/spec.md');
    fs.mkdirSync(path.dirname(existingSpec), { recursive: true });
    fs.writeFileSync(
      existingSpec,
      '# Existing main spec\n\nThis content must remain unchanged on denied archive.\n',
    );
    await ok(['init', 'demo', 'full', '--managed-delivery']);
    fs.writeFileSync(
      path.join(change, 'proposal.md'),
      '# Candidate requirements\n\nValidate the actual Native control contract.\n',
    );
    if (withDelta) {
      const delta = path.join(change, 'specs/native-proof/spec.md');
      fs.mkdirSync(path.dirname(delta), { recursive: true });
      fs.writeFileSync(
        delta,
        '## ADDED Requirements\n\n### Requirement: Preserve the original Run\nThe system SHALL preserve the same Run through archive and closeout.\n\n#### Scenario: Resume knowledge closeout\n- **WHEN** a verified change is archived\n- **THEN** knowledge closeout resumes on the same Run\n',
      );
    }
    if (gitTracked) {
      for (const argv of [
        ['init', '-b', 'main'],
        ['config', 'user.email', 'fixture@example.invalid'],
        ['config', 'user.name', 'Native Fixture'],
        [
          'add',
          'openspec/config.yaml',
          'openspec/specs/existing/spec.md',
          'openspec/changes/demo/proposal.md',
          'openspec/changes/demo/.comet.yaml',
        ],
        ['commit', '-m', 'Track original archive inputs'],
      ]) {
        const result = spawnSync('git', argv, { cwd: project, encoding: 'utf8' });
        assert.equal(result.status, 0, result.stderr);
      }
    }
    const observer = `import test from 'node:test';import assert from 'node:assert/strict';import{runClassicCli}from ${JSON.stringify(nativeUrl)};test('actual Native refuses worker receipt writes',async()=>{const r=await runClassicCli(['state','set','demo','gate_receipts','[]','--json'],undefined,{projectRoot:${JSON.stringify(project)},invocationCwd:${JSON.stringify(project)}});assert.notEqual(r.exitCode,0);assert.match(r.stdout,/machine-owned/);});\n`;
    fs.writeFileSync(commandArgv.at(-1), observer);
  }
  const observe = async (intent) => {
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const child = spawnSync(process.execPath, commandArgv.slice(1), {
      cwd: project,
      env,
      encoding: 'utf8',
    });
    assert.equal(child.status, 0, child.stdout + child.stderr);
    const summary = parseTapSummary(child.stdout);
    assert.equal(summary.tests, 1);
    const reportBytes = Buffer.from(child.stdout),
      resultBytes = Buffer.from(JSON.stringify({ exitCode: child.status, output: child.stdout })),
      methodTraceBytes = Buffer.from(
        JSON.stringify({
          processId: child.pid,
          methodApplied: 'UNVERIFIED',
          roleIsolation: 'UNVERIFIED',
        }),
      );
    const envelope = {
      schemaVersion: 1,
      candidateDigest: intent.inputDigest,
      caseId: `component.${intent.gate}`,
      check: `component:${intent.gate}`,
      origin: { kind: 'registered-runner', id: 'native-contract-source' },
      execution: { id: intent.execution },
      environment: 'component-env',
      toolchain: process.version,
      executions: { total: summary.tests, valid: summary.pass },
      result: 'pass',
      evidence: [{ uri: '.whitebox/record.txt', sha256: sha(reportBytes) }],
      expiry: '2099-01-01T00:00:00Z',
    };
    const record = {
      dispatch: intent.protectedDispatch,
      envelope,
      launchRecord: {
        launchId: `observed:${intent.execution}`,
        execution: intent.execution,
        processId: child.pid,
      },
      reportBytes,
      resultBytes,
      methodTraceBytes,
      qualification,
    };
    records.set(intent.execution, record);
    return record;
  };
  const issue = async (gate) => (await ok(['dispatch-gate', 'demo', gate])).json.data.dispatch;
  const accept = async (intent) => {
    const file = path.join(artifacts, `${intent.execution}.json`);
    fs.writeFileSync(
      file,
      JSON.stringify({
        execution: intent.execution,
        attempt: intent.attempt,
        verdict: 'pass',
      }),
    );
    return state(['accept-gate', 'demo', intent.gate, '--file', file]);
  };
  const submit = async (gate) => {
    const intent = await issue(gate);
    await observe(intent);
    const result = await accept(intent);
    assert.equal(result.exitCode, 0, JSON.stringify(result.json.data?.issues));
    return { intent, result };
  };
  const readback = async () => {
    const r = await ok(['gates', 'demo']);
    return r.json.data;
  };
  const prepareDesign = async () => {
    await submit('R');
    fs.writeFileSync(
      path.join(change, 'tasks.md'),
      '- [ ] Validate the actual Native kernel. <!-- comet-task:task1 -->\n',
    );
    await ok(['transition', 'demo', 'open-complete']);
    fs.mkdirSync(path.join(project, 'docs/comet/plans'), { recursive: true });
    fs.writeFileSync(
      path.join(change, 'design.md'),
      '# Design\n\nOne original Runtime owns the source-bound gate transaction.\n',
    );
    fs.writeFileSync(
      path.join(project, 'docs/design.md'),
      '---\ncomet_change: demo\nrole: technical-design\ncanonical_spec: openspec\n---\n# Architecture\n\nOne Runtime owns the control contract.\n',
    );
    fs.writeFileSync(
      path.join(change, 'test-intent.md'),
      '# Test intent\n\nAssert original source bytes, current versions and transaction recovery.\n',
    );
    await ok([
      'set',
      'demo',
      'design_doc',
      'docs/design.md',
      'test_intent',
      'openspec/changes/demo/test-intent.md',
    ]);
  };
  const prepareP = async () => {
    await prepareDesign();
    await submit('A');
    await submit('T');
    await ok(['complete-design', 'demo', '--design-doc', 'docs/design.md']);
    fs.writeFileSync(
      path.join(project, 'docs/comet/plans/derived-plan.md'),
      '# Plan\n\n- [ ] Validate Native source binding. <!-- comet-task:task1 -->\n',
    );
    await ok([
      'set',
      'demo',
      'plan',
      'docs/comet/plans/derived-plan.md',
      'build_mode',
      'autonomous',
      'tdd_mode',
      'tdd',
      'isolation',
      'current',
    ]);
    await submit('P');
  };
  const proof = (id, expected, actual, observed = null) => {
    assert.deepEqual(actual, expected, id);
    assertions.push({ id, expected, actual, ...(observed ? { observed } : {}) });
  };
  const close = () => {
    const directory = path.join(repository, '.local/P2_4/case-audit', crypto.randomUUID());
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(
      path.join(directory, 'commands.json'),
      JSON.stringify(commands, null, 2) + '\n',
    );
    fs.writeFileSync(
      path.join(directory, 'proof.json'),
      JSON.stringify(
        {
          scope: 'component/native-runtime-mechanism',
          fingerprint,
          assertions,
          commands: commands.length,
          sourceProcesses: [...records.values()].map((r) => r.launchRecord.processId),
          actualRolesMethodsOS: 'UNVERIFIED',
          acceptedBusinessScenarios: 0,
        },
        null,
        2,
      ) + '\n',
    );
    if (!resume) fs.rmSync(scratch, { recursive: true, force: true });
    for (const key of Object.keys(prior)) {
      if (prior[key] === undefined) delete process.env[key];
      else process.env[key] = prior[key];
    }
    return path.relative(repository, directory);
  };
  return {
    native,
    restartData: () => ({
      scratch,
      secret: fixtureSecret,
      inputDigest,
      records: [...records],
      openSpecBinding,
    }),
    project,
    change,
    artifacts,
    records,
    qualification,
    registerWriteDriver: async (id, paths, { readonly = false, foreignRun = false, corruptSignature = false } = {}) => {
      const run = JSON.parse(fs.readFileSync(path.join(change, '.comet/run-state.json'), 'utf8'));
      const tools = readonly ? ['read_file'] : ['Write'];
      const binding = { ...actionFor({ gate: 'T', runId: foreignRun ? 'foreign-run' : run.runId,
        execution: `component-only:${id}`, role: readonly ? 'reviewer' : 'test-author',
        generation: 0, attempt: 1, epoch: Number(await get('check_epoch')), inputDigest: sha('component-author-grant') }),
        action: 'component-test-intent-author', allowedPaths: paths, allowedTools: tools,
        outputs: [{ name: 'test-intent', ref: path.extname(paths[0]) ? paths[0] : 'openspec/changes/demo/test-intent.md' }] };
      const dispatch = actualAuthority.issueDispatch({ ...binding, actionBinding: binding });
      if (corruptSignature) dispatch.integrity = '0'.repeat(64);
      writeDrivers.set(id, Object.freeze({ tools, dispatch }));
      return dispatch;
    },
    useWriteDriver: (id) => { activeWriteDriver = id; },
    setEnvironment: (value) => {
      environment = value;
    },
    policy,
    openSpecBinding,
    state,
    invoke,
    ok,
    get,
    issue,
    observe,
    accept,
    submit,
    readback,
    prepareP,
    prepareDesign,
    proof,
    close,
    commandArgv,
    setReadHook: (fn) => {
      readHook = fn;
    },
    setReview: (mode) => {
      reviewMode = mode;
    },
    setMethod: (digest) => {
      methodVersion = digest;
    },
  };
}

async function crashAndRestartKt(f, moved, before) {
  const parse = createRequire(path.join(work, 'package.json'))('yaml').parse;
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const child = spawn(
    process.execPath,
    [fileURLToPath(import.meta.url), '--mechanism-restart', 'accept-kt'],
    { cwd: repository, env, stdio: ['pipe', 'pipe', 'pipe', 'ipc'] },
  );
  let terminal = null,
    stderr = '',
    stdout = '';
  child.stderr.on('data', (value) => {
    stderr += value;
  });
  child.stdout.on('data', (value) => {
    stdout += value;
  });
  child.on('message', (message) => {
    if (message.kind !== 'original-source-observed') return;
    const record = message.record;
    for (const key of ['reportBytes', 'resultBytes', 'methodTraceBytes'])
      record[key] = Buffer.from(record[key].data);
    f.records.set(message.execution, record);
  });
  const exited = new Promise((resolve) =>
    child.once('exit', (code, signal) => {
      terminal = { code, signal };
      resolve(terminal);
    }),
  );
  child.stdin.end(JSON.stringify(f.restartData()));
  try {
    let committed = false;
    const deadline = Date.now() + 60000;
    while (!terminal && Date.now() < deadline) {
      try {
        const state = parse(fs.readFileSync(path.join(moved, '.comet.yaml'), 'utf8'));
        const receipts =
          typeof state.gate_receipts === 'string'
            ? JSON.parse(state.gate_receipts)
            : state.gate_receipts;
        const run = JSON.parse(fs.readFileSync(path.join(moved, '.comet/run-state.json'), 'utf8'));
        if (
          receipts?.some((entry) => entry.gate === 'Kt' && entry.verdict === 'pass') &&
          run.status === 'waiting'
        ) {
          committed = true;
          child.kill('SIGKILL');
          break;
        }
      } catch {
        /* writer may be between its original atomic filesystem operations */
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(committed, true, JSON.stringify({ terminal, stdout, stderr }));
    const stopped = await exited;
    f.proof('KT_COMMIT_WRITER_SIGKILL', 'SIGKILL', stopped.signal, { writerPid: child.pid });
    const pending = JSON.parse(fs.readFileSync(path.join(moved, '.comet/run-state.json'), 'utf8'));
    f.proof('KT_CRASH_ORIGINAL_RUN', before.runId, pending.runId);
    f.proof('KT_CRASH_BEFORE_RECONCILE', 'waiting', pending.status);
    const resumed = spawnSync(
      process.execPath,
      [fileURLToPath(import.meta.url), '--mechanism-restart', 'next'],
      {
        cwd: repository,
        env,
        input: JSON.stringify(f.restartData()),
        encoding: 'utf8',
        timeout: 60000,
      },
    );
    assert.equal(resumed.status, 0, resumed.stdout + resumed.stderr);
    const readback = JSON.parse(resumed.stdout.trim().split('\n').at(-1));
    f.proof('RESTART_SAME_PERSISTENT_RUN', before.runId, readback.runId);
    f.proof('RESTART_NATIVE_COMPLETED', 'completed', readback.status, { restartPid: readback.pid });
    assert.notEqual(readback.pid, child.pid);
  } finally {
    if (!terminal) {
      child.kill('SIGKILL');
      await exited;
    }
  }
}

async function runScenario(id) {
  const f = await fixture({
    withDelta: id === 'postdelta',
    gitTracked: id === 'postgit',
    isolatedToolchain: ['tooldata', 'toolrecheck'].includes(id),
  });
  let audit;
  try {
    if (id.startsWith('tool')) {
      const argv = ['openspec', '--', 'status', '--change', 'demo', '--json'];
      const baseline = await f.invoke(argv);
      f.proof('GENUINE_BOUND_CLI_BASELINE', 0, baseline.exitCode);
      assert.equal(baseline.json.data.toolIdentity.scope, 'component-mechanism');
      const main = path.join(f.project, 'openspec/specs/existing/spec.md');
      const before = sha(fs.readFileSync(main));
      if (id === 'toolpaths') {
        const prior = {
          COMET_OPENSPEC: process.env.COMET_OPENSPEC,
          PATH: process.env.PATH,
          NODE_OPTIONS: process.env.NODE_OPTIONS,
          NODE_PATH: process.env.NODE_PATH,
        };
        try {
          process.env.COMET_OPENSPEC = path.join(f.artifacts, 'unavailable-location');
          process.env.PATH = path.join(f.artifacts, 'unavailable-search-directory');
          process.env.NODE_OPTIONS = '--not-a-supported-node-setting';
          process.env.NODE_PATH = path.join(f.artifacts, 'unavailable-module-directory');
          const result = await f.invoke(argv);
          f.proof('ENVIRONMENT_DOES_NOT_SELECT_MANAGED_PROGRAM', 0, result.exitCode);
          f.proof(
            'SAME_BOUND_IDENTITY',
            baseline.json.data.toolIdentity.bindingDigest,
            result.json.data.toolIdentity.bindingDigest,
          );
        } finally {
          for (const key of Object.keys(prior)) {
            if (prior[key] === undefined) delete process.env[key];
            else process.env[key] = prior[key];
          }
        }
      } else {
        if (id === 'toolmissing') delete f.policy.openSpecBinding;
        else if (id === 'tooldigest') fs.appendFileSync(f.openSpecBinding.manifest.path, '\n');
        else if (id === 'tooldata') {
          assert.ok(
            f.openSpecBinding.installationRoot.startsWith(fs.realpathSync(f.artifacts) + path.sep),
            'test changes must stay in the private fixture',
          );
          const pkg = path.join(f.openSpecBinding.installationRoot, '@fission-ai/openspec');
          const file = fs.readdirSync(pkg).find((name) => /^readme/i.test(name));
          assert.ok(file, 'ordinary pinned package data must exist');
          fs.appendFileSync(path.join(pkg, file), '\ncomponent data observation\n');
        } else {
          assert.ok(
            f.openSpecBinding.installationRoot.startsWith(fs.realpathSync(f.artifacts) + path.sep),
            'test changes must stay in the private fixture',
          );
          fs.writeFileSync(
            path.join(f.openSpecBinding.installationRoot, 'additional-data.txt'),
            'component data observation\n',
          );
        }
        const denied = await f.invoke(argv);
        assert.notEqual(denied.exitCode, 0);
        assert.match(JSON.stringify(denied), /UNVERIFIED/);
        f.proof('CHANGED_OR_MISSING_BINDING_REFUSED', true, denied.exitCode !== 0);
      }
      f.proof('READ_REQUEST_NEVER_CHANGED_MAIN_SPEC', before, sha(fs.readFileSync(main)));
    } else if (id === 'forwarding') {
      await f.native.ensureClassicRuntimeRun(f.change);
      fs.writeFileSync(path.join(f.change, 'design.md'), '# Unreviewed design\n');
      fs.writeFileSync(path.join(f.change, 'tasks.md'), '- [x] Attack fixture only\n');
      const main = path.join(f.project, 'openspec/specs/existing/spec.md');
      const digest = sha(fs.readFileSync(main));
      for (const argv of [
        ['openspec', '--', 'archive', 'demo', '--yes'],
        ['openspec', '--agent-json', 'archive', 'demo', '--yes'],
        ['openspec', '--', 'archive', '--yes'],
        ['openspec', '--', '--store', 'unregistered', 'archive', 'demo', '--yes'],
        ['openspec', '--', '--store=unregistered', 'archive', 'another-name', '--yes'],
        ['openspec', '--', 'arch', 'demo', '--yes'],
        ['openspec', '--', 'new', 'change', 'forbidden-nested'],
      ]) {
        const result = await f.invoke(argv);
        assert.notEqual(result.exitCode, 0);
        assert.match(JSON.stringify(result), /UNVERIFIED/);
        assert.equal(fs.existsSync(f.change), true);
        assert.equal(sha(fs.readFileSync(main)), digest);
      }
      f.proof('FORWARDED_ARCHIVE_NO_MOVE', true, fs.existsSync(f.change));
      f.proof('FORWARDED_ARCHIVE_MAIN_SPEC_UNCHANGED', digest, sha(fs.readFileSync(main)));
      f.proof('FORWARDED_ARCHIVE_RUN_NOT_ARCHIVED', 'false', await f.get('archived'));
      const status = await f.invoke(['openspec', '--', 'status', '--change', 'demo', '--json']);
      f.proof('KNOWN_READ_ONLY_USES_SDK_SCOPE', 0, status.exitCode);
    } else if (id === 'control') {
      await f.prepareP();
      const stateFile = path.join(f.change, '.comet.yaml');
      const original = fs.readFileSync(stateFile, 'utf8');
      assert.match(original, /check_epoch: \d+/);
      fs.writeFileSync(stateFile, original.replace(/check_epoch: \d+/, 'check_epoch: invalid'));
      for (const target of [
        'src/feature.ts',
        'docs/change.md',
        '.comet/config.yaml',
        'openspec/changes/demo/.comet.yaml',
      ]) {
        const decision = await f.native.inspectClassicHookGuard(f.project, 'demo', {
          intent: 'write',
          targets: [path.join(f.project, target)],
          toolName: 'Write',
        });
        f.proof(`MALFORMED_STATE_DENIES_${target}`, false, decision.allowed);
      }
    } else if (id === 'registration') {
      await f.prepareDesign();
      const registered = await f.get('test_intent');
      const neighbor = 'openspec/changes/demo/neighbor-test-intent.md';
      fs.writeFileSync(path.join(f.project, neighbor), '# Neighbor artifact\n');
      const attempt = spawnSync(process.execPath, [path.join(work, 'assets/skills/comet/scripts/comet-state.mjs'),
        'set', 'demo', 'test_intent', neighbor, '--json'], { cwd: f.project, encoding: 'utf8', timeout: 15000 });
      assert.notEqual(attempt.status, 0, 'standalone caller must not repoint the managed registered write target: ' + attempt.stdout + attempt.stderr);
      f.proof('UNPROTECTED_REGISTRATION_UNCHANGED', registered, await f.get('test_intent'));
      const previousAuthority = process.env.COMET_RUN_AUTHORITY;
      try {
        process.env.COMET_RUN_AUTHORITY = 'component-foreign-environment';
        const foreign = await f.state(['set', 'demo', 'test_intent', neighbor]);
        assert.notEqual(foreign.exitCode, 0);
        f.proof('FOREIGN_REGISTRATION_UNCHANGED', registered, await f.get('test_intent'));
      } finally {
        if (previousAuthority === undefined) delete process.env.COMET_RUN_AUTHORITY;
        else process.env.COMET_RUN_AUTHORITY = previousAuthority;
      }
      await f.ok(['set', 'demo', 'test_intent', neighbor]);
      f.proof('ORIGINAL_RUNTIME_REGISTRATION_ALLOWED', neighbor, await f.get('test_intent'));
      await f.ok(['set', 'demo', 'test_intent', registered]);

    } else if (id === 'authorwrite') {
      await f.prepareDesign();
      const target = 'openspec/changes/demo/test-intent.md';
      const inspect = (relative = target) => f.native.inspectClassicHookGuard(f.project, 'demo', {
        intent: 'write', targets: [path.join(f.project, relative)], toolName: 'Write',
      });
      f.proof('DEFAULT_FIXED_HOST_DENIES', false, (await inspect()).allowed);
      const unbound = spawnSync(process.execPath, [path.join(work, 'assets/skills/comet/scripts/comet-hook-guard.mjs'),
        '--project-root', f.project], { cwd: f.project, encoding: 'utf8', env: { ...process.env, FILE_PATH: path.join(f.project, target) } });
      assert.notEqual(unbound.status, 0, 'a separate public guard process has no installed protected host');
      assert.match(unbound.stdout + unbound.stderr, /UNVERIFIED/);

      const author = await f.registerWriteDriver('writer', [target]);
      f.useWriteDriver('writer');
      const before = fs.readFileSync(path.join(f.project, target));
      const decision = await inspect();
      assert.equal(decision.allowed, true, 'registered authenticated Design writer must reach the actual hook: ' + decision.reason);
      fs.appendFileSync(path.join(f.project, target), '\nApproved fixture author revision.\n');
      f.proof('REAL_FIXTURE_WRITE_CHANGED', false, before.equals(fs.readFileSync(path.join(f.project, target))));
      f.proof('HMAC_FIXTURE_NOT_ROLE_QUALIFICATION', true, Boolean(author.integrity));
      await f.registerWriteDriver('readonly', [target], { readonly: true }); f.useWriteDriver('readonly');
      f.proof('READ_ONLY_DRIVER_DENIES', false, (await inspect()).allowed);
      f.proof('READ_ONLY_NON_WRITE_STAYS_ALLOWED', true, (await f.native.inspectClassicHookGuard(f.project, 'demo', {
        intent: 'non-write', targets: [], toolName: 'read_file',
      })).allowed);

      await f.registerWriteDriver('foreign', [target], { foreignRun: true }); f.useWriteDriver('foreign');
      f.proof('FOREIGN_RUN_DENIES', false, (await inspect()).allowed);
      await f.registerWriteDriver('unsigned', [target], { corruptSignature: true }); f.useWriteDriver('unsigned');
      f.proof('UNSIGNED_DRIVER_DENIES', false, (await inspect()).allowed);
      await f.registerWriteDriver('broad', ['openspec/changes/demo']); f.useWriteDriver('broad');
      f.proof('DIRECTORY_SCOPE_IS_NOT_EXACT_GRANT', false, (await inspect()).allowed);
      f.useWriteDriver('writer');
      f.proof('NEIGHBOR_DENIES', false, (await inspect('openspec/changes/demo/test-intent.md.other')).allowed);
      f.proof('CONTROL_NAMESPACE_DENIES', false, (await inspect('openspec/changes/demo/.comet.yaml')).allowed);
      const neighbor = 'openspec/changes/demo/neighbor-test-intent.md';
      fs.writeFileSync(path.join(f.project, neighbor), '# Neighbor intent fixture\n');
      await f.registerWriteDriver('neighbor', [neighbor]); f.useWriteDriver('neighbor');
      f.proof('SIGNED_NEIGHBOR_IS_NOT_REGISTERED', false, (await inspect(neighbor)).allowed);
      f.useWriteDriver('writer');
      await f.ok(['set', 'demo', 'test_intent', neighbor]);
      f.proof('REGISTRATION_CANNOT_WIDEN_ANOTHER_EXACT_GRANT', false, (await inspect()).allowed);
      await f.ok(['set', 'demo', 'test_intent', target]);
      const stored = fs.readFileSync(path.join(f.project, target));
      for (const kind of ['inside-link', 'dangling-link', 'directory']) {
        const file = path.join(f.project, target);
        try {
          fs.unlinkSync(file);
          if (kind === 'directory') fs.mkdirSync(file);
          else fs.symlinkSync(path.join(f.project, kind === 'inside-link' ? neighbor : 'missing-owned.md'), file);
          const decision = await inspect();
          f.proof(`REGISTERED_UNSAFE_${kind}_STRUCTURED_DENY`, false, decision.allowed);
        } finally {
          fs.rmSync(file, { recursive: true, force: true }); fs.writeFileSync(file, stored);
        }
      }

      await f.ok(['set', 'demo', 'test_intent', 'null']);
      f.proof('CONVENTIONAL_FILENAME_IS_NOT_REGISTRATION', false, (await inspect()).allowed);
      await f.ok(['set', 'demo', 'test_intent', target]);
      f.setMethod(sha('requirements source is no longer current'));
      f.proof('NO_CURRENT_R_DENIES', false, (await inspect()).allowed);
    } else if (id === 'intentlinks') {
      await f.prepareDesign();
      const outside = path.join(f.artifacts, 'outside-test-intent.md');
      fs.writeFileSync(outside, '# Outside owned fixture data\n');
      const targets = ['openspec/changes/demo/test-intent.md', 'docs/design.md',
        'src/linked-source.ts', 'docs/linked-note.md', 'openspec/changes/demo/.comet/linked-control.md',
        'openspec/changes/archive/2026-01-01-history/linked-history.md'];
      await f.registerWriteDriver('link-writer', [targets[0]]); f.useWriteDriver('link-writer');
      const failures = [];
      for (const relative of targets) {
        const target = path.join(f.project, relative);
        const original = fs.existsSync(target) ? fs.readFileSync(target) : null;
        fs.mkdirSync(path.dirname(target), { recursive: true });
        try {
          if (original !== null) fs.unlinkSync(target);
          fs.symlinkSync(outside, target);
          const decision = await f.native.inspectClassicHookGuard(f.project, 'demo', {
            intent: 'write', targets: [target], toolName: 'Write',
          });
          if (decision.allowed !== false) failures.push({ relative, decision });
        } finally {
          fs.unlinkSync(target); if (original !== null) fs.writeFileSync(target, original);
        }
      }
      const external = await f.native.inspectClassicHookGuard(f.project, 'demo', {
        intent: 'write', targets: [outside], toolName: 'Write',
      });
      f.proof('TRUE_EXTERNAL_SCOPE_UNCHANGED_NOT_A_MANAGED_GRANT', true, external.allowed);
      const legacy = path.join(f.artifacts, 'legacy-project');
      fs.mkdirSync(path.join(legacy, '.comet'), { recursive: true });
      fs.mkdirSync(path.join(legacy, 'openspec'), { recursive: true });
      fs.writeFileSync(path.join(legacy, '.comet/config.yaml'), 'schema: comet.project.v1\ndefault_workflow: classic\nworkflows: [classic]\nclassic:\n  artifact_layout: legacy\n');
      fs.writeFileSync(path.join(legacy, 'openspec/config.yaml'), 'schema: spec-driven\n');
      assert.equal((await f.native.runClassicCli(['--json', 'state', 'init', 'legacy', 'full'], undefined,
        { projectRoot: legacy, invocationCwd: legacy })).exitCode, 0);
      const legacyTarget = path.join(legacy, 'legacy-link.md'); fs.symlinkSync(outside, legacyTarget);
      const legacyScope = await f.native.inspectClassicHookGuard(legacy, 'legacy', {
        intent: 'write', targets: [legacyTarget], toolName: 'Write',
      });
      f.proof('NON_MANAGED_EXTERNAL_SCOPE_UNCHANGED', true, legacyScope.allowed);
      assert.deepEqual(failures, [], 'lexical ownership must precede the physical external exemption: ' + JSON.stringify(failures));
      f.proof('OUTSIDE_LINK_SOURCE_UNCHANGED', '# Outside owned fixture data\n', fs.readFileSync(outside, 'utf8'));
    } else if (id === 'designroutes') {
      await f.prepareDesign();
      for (const gate of ['A', 'T']) {
        const intent = await f.issue(gate); await f.observe(intent); f.setReview('insufficient');
        const rejected = await f.accept(intent);
        assert.equal(rejected.exitCode, 0); assert.equal(rejected.json.data.verdict, 'reject');
        const route = rejected.json.stderr;
        assert.match(route, /Design/);
        assert.match(route, /author/);
        assert.doesNotMatch(route, /state transition <change> (architecture-repair|test-design-repair)/);
        const invalid = await f.state(['transition', 'demo', gate === 'A' ? 'architecture-repair' : 'test-design-repair']);
        assert.notEqual(invalid.exitCode, 0);
        f.proof(`${gate}_STAYS_IN_DESIGN`, 'design', await f.get('phase'));
        f.setReview('sufficient'); await f.submit(gate);
      }
    } else if (id === 'origin') {
      const { intent, result } = await f.submit('R');
      f.proof('R_SOURCE_ADMITTED', 'pass', result.json.data.verdict);
      f.proof('R_RECORDED_CURRENT', true, (await f.readback()).evaluation.allowed);
      const replay = await f.accept(intent);
      assert.notEqual(replay.exitCode, 0);
      f.proof('R_REPLAY_NOT_CONSUMED_TWICE', 1, JSON.parse(await f.get('gate_receipts')).length);
      f.proof(
        'NO_INDEPENDENT_GATE_STORE',
        false,
        fs.existsSync(path.join(f.change, '.comet/gate-dispatches.json')),
      );
    } else if (id === 'pending') {
      const intent = await f.issue('R');
      await f.observe(intent);
      const file = path.join(f.change, 'proposal.md'),
        bytes = fs.readFileSync(file);
      fs.appendFileSync(file, 'Changed\n');
      await f.readback();
      fs.writeFileSync(file, bytes);
      assert.notEqual((await f.accept(intent)).exitCode, 0);
      f.proof(
        'OLD_PENDING_STALE',
        'stale',
        JSON.parse(await f.get('gate_dispatches')).dispatches[0].state,
      );
    } else if (id === 'longread') {
      await f.prepareDesign();
      for (const gate of ['A', 'T']) {
        if (gate === 'T') await f.submit('A');
        const intent = await f.issue(gate);
        await f.observe(intent);
        const target =
          gate === 'A'
            ? path.join(f.project, 'docs/design.md')
            : path.join(f.change, 'test-intent.md');
        f.setReadHook(async () => {
          const query = spawnSync(
            process.execPath,
            [
              path.join(work, 'assets/skills/comet/scripts/comet-state.mjs'),
              'gates',
              'demo',
              '--json',
            ],
            { cwd: f.project, encoding: 'utf8', timeout: 5000 },
          );
          assert.equal(query.status, 0, query.stderr);
          fs.appendFileSync(target, 'Changed during unlocked collector\n');
        });
        assert.notEqual((await f.accept(intent)).exitCode, 0);
        f.setReadHook(null);
        const receipts = JSON.parse(await f.get('gate_receipts'));
        f.proof(
          `${gate}_STALE_RESULT_NOT_CURRENT`,
          false,
          receipts.some((r) => r.execution === intent.execution),
        );
      }
    } else if (id === 'review') {
      await f.prepareDesign();
      for (const gate of ['A', 'T']) {
        const intent = await f.issue(gate);
        await f.observe(intent);
        f.setReview('missing');
        assert.notEqual((await f.accept(intent)).exitCode, 0);
        f.proof(
          `${gate}_MISSING_REVIEW_UNCONSUMED`,
          'open',
          JSON.parse(await f.get('gate_dispatches')).dispatches.find(
            (entry) => entry.execution === intent.execution,
          ).state,
        );
        f.setReview('insufficient');
        const rejected = await f.accept(intent);
        assert.equal(rejected.exitCode, 0);
        f.proof(`${gate}_INSUFFICIENT_REVIEW_REJECT`, 'reject', rejected.json.data.verdict);
        assert.ok((await f.readback()).evaluation.rejected.includes(gate));
        f.setReview('sufficient');
        await f.submit(gate);
      }
      f.proof('CORRECTED_A_T_ALLOW_DESIGN_HANDOFF', true, (await f.readback()).evaluation.allowed);
    } else if (id === 'planning') {
      await f.prepareP();
      f.proof('SAME_NATIVE_BUILD', 'build', await f.get('phase'));
      fs.mkdirSync(path.join(f.project, 'src'), { recursive: true });
      fs.writeFileSync(
        path.join(f.project, 'src/implementation.ts'),
        'export const candidate = "changed";\n',
      );
      fs.writeFileSync(path.join(f.project, 'dependency.lock'), 'non-js dependency changed\n');
      for (const file of [
        path.join(f.change, 'tasks.md'),
        path.join(f.project, 'docs/comet/plans/derived-plan.md'),
      ])
        fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('[ ]', '[x]'));
      f.proof('CODE_AND_PROGRESS_KEEP_RATP', true, (await f.readback()).evaluation.allowed);
    } else if (id === 'design') {
      await f.prepareP();
      const file = path.join(f.project, 'docs/design.md'),
        bytes = fs.readFileSync(file);
      fs.appendFileSync(file, 'Design boundary changed\n');
      const changed = await f.readback();
      assert.deepEqual(changed.evaluation.stale, ['A', 'T', 'P']);
      fs.writeFileSync(file, bytes);
      f.proof(
        'RESTORED_DESIGN_STILL_STALE',
        ['A', 'T', 'P'],
        (await f.readback()).evaluation.stale,
      );
    } else if (['repair', 'repairA', 'repairT', 'repairAverify', 'repairTverify'].includes(id)) {
      await f.prepareP();
      if (id.endsWith('verify')) {
        const tasks = path.join(f.change, 'tasks.md');
        fs.writeFileSync(tasks, fs.readFileSync(tasks, 'utf8').replace('[ ]', '[x]'));
        assert.equal((await f.invoke(['check', 'run', 'demo', 'build', '--', ...f.commandArgv])).exitCode, 0);
        await f.ok(['transition', 'demo', 'build-complete']);
        f.proof('ORIGINAL_VERIFY_PHASE', 'verify', await f.get('phase'));
      }

      const before = JSON.parse(
        fs.readFileSync(path.join(f.change, '.comet/run-state.json'), 'utf8'),
      ).runId;
      const event =
        id.startsWith('repairA')
          ? 'architecture-repair'
          : id.startsWith('repairT')
            ? 'test-design-repair'
            : 'requirements-repair';
      await f.ok(['transition', 'demo', event]);
      f.proof('CONTROLLED_REPAIR_PHASE', id === 'repair' ? 'open' : 'design', await f.get('phase'));
      f.proof(
        'ORIGINAL_RUN',
        before,
        JSON.parse(fs.readFileSync(path.join(f.change, '.comet/run-state.json'), 'utf8')).runId,
      );
      assert.equal((await f.readback()).evaluation.allowed, false);
    } else if (id === 'versions') {
      await f.submit('R');
      f.setMethod(sha('changed method'));
      assert.equal((await f.readback()).evaluation.allowed, false);
      f.setMethod(
        sha(fs.readFileSync(path.join(repository, '.agents/skills/whitebox-verify/SKILL.md'))),
      );
      f.proof('RESTORED_METHOD_STILL_STALE', false, (await f.readback()).evaluation.allowed);
    } else if (id === 'concurrent') {
      const [a, b] = await Promise.all([f.issue('R'), f.issue('R')]);
      f.proof('ONE_ORIGINAL_EXECUTION', a.execution, b.execution);
      await f.observe(a);
      const results = await Promise.all([f.accept(a), f.accept(b)]);
      f.proof('ONE_ATOMIC_ACCEPT', 1, results.filter((r) => r.exitCode === 0).length);
      f.proof('ONE_RECEIPT', 1, JSON.parse(await f.get('gate_receipts')).length);
    } else if (id === 'plans') {
      await f.prepareP();
      const good = 'docs/comet/plans/derived-plan.md';
      const next = await f.ok(['next', 'demo']);
      f.proof('FIXED_PLAN_VIEW_ROOT', 'docs/comet/plans', next.json.data.artifactRefs.plansRoot);
      for (const bad of ['docs/superpowers/plans/old.md', 'docs/user-selected/plans/custom.md']) {
        fs.mkdirSync(path.dirname(path.join(f.project, bad)), {
          recursive: true,
        });
        fs.writeFileSync(path.join(f.project, bad), '# Unapproved plan root\n');
        await f.ok(['set', 'demo', 'plan', bad]);
        const failed = await f.state(['transition', 'demo', 'build-complete']);
        assert.notEqual(failed.exitCode, 0);
        assert.match(
          failed.json.stderr ?? JSON.stringify(failed.json.data?.issues),
          /plan|prerequisite|gate/i,
        );
      }
      await f.ok(['set', 'demo', 'plan', good]);
      const missing = spawnSync(
        process.execPath,
        [path.join(work, 'assets/skills/comet/scripts/comet-state.mjs'), 'next', 'demo', '--json'],
        { cwd: f.project, encoding: 'utf8' },
      );
      assert.notEqual(missing.status, 0);
      assert.match(missing.stdout + missing.stderr, /UNVERIFIED/);
      f.policy.plansRoot = 'docs/user-selected/plans';
      const wrong = await f.state(['next', 'demo']);
      assert.notEqual(wrong.exitCode, 0);
      assert.match(wrong.stdout, /UNVERIFIED/);
    } else if (
      id === 'throughverify' ||
      id === 'candidate' ||
      id === 'archive' ||
      id.startsWith('post')
    ) {
      await f.prepareP();
      fs.writeFileSync(
        path.join(f.change, 'tasks.md'),
        fs.readFileSync(path.join(f.change, 'tasks.md'), 'utf8').replace('[ ]', '[x]'),
      );
      assert.equal(
        (await f.invoke(['check', 'run', 'demo', 'build', '--', ...f.commandArgv])).exitCode,
        0,
      );
      await f.ok(['transition', 'demo', 'build-complete']);
      fs.mkdirSync(path.join(f.project, '.whitebox'), { recursive: true });
      fs.writeFileSync(
        path.join(f.project, '.whitebox/verification.md'),
        '# Component verification\n\nOnly Native target behavior is exercised; actual method/OS/roles are not qualified.\n',
      );
      await f.ok(['set', 'demo', 'verification_report', '.whitebox/verification.md']);
      assert.equal(
        (await f.invoke(['check', 'run', 'demo', 'verify', '--', ...f.commandArgv])).exitCode,
        0,
      );
      await f.submit('V');
      if (id === 'candidate') {
        const changed = path.join(f.project, 'new-source.py');
        fs.writeFileSync(changed, "candidate = 'changed'\n");
        f.proof('CANDIDATE_ONLY_V_STALE', ['V'], (await f.readback()).evaluation.stale);
        fs.rmSync(changed);
        f.proof('RESTORED_CANDIDATE_V_NOT_REVIVED', ['V'], (await f.readback()).evaluation.stale);
        const invalidations = JSON.parse(await f.get('gate_invalidations'));
        for (const gate of ['R', 'A', 'T', 'P']) assert.equal(invalidations[gate], undefined);
      } else {
        await f.ok(['transition', 'demo', 'verify-pass']);
        await f.ok(['transition', 'demo', 'archive-confirm']);
        const mainSpec = path.join(f.project, 'openspec/specs/existing/spec.md');
        const beforeSpec = sha(fs.readFileSync(mainSpec));
        const denied = await f.invoke(['archive', 'demo']);
        assert.notEqual(
          denied.exitCode,
          0,
          'Kp blocks real Spec side effects, not entering Archive work',
        );
        f.proof('MISSING_KP_NO_MOVE', true, fs.existsSync(f.change));
        f.proof('MISSING_KP_MAIN_SPEC_UNCHANGED', beforeSpec, sha(fs.readFileSync(mainSpec)));
        f.proof('MISSING_KP_NOT_ARCHIVED', 'false', await f.get('archived'));
        await f.submit('Kp');
        f.proof('ARCHIVE_PHASE', 'archive', await f.get('phase'));
        f.proof('KT_STILL_PENDING', true, (await f.readback()).completionBlocked);
        if (id.startsWith('post')) {
          if (id !== 'postgit') {
            const deliveryInput = path.join(f.change, '.comet/native-document-delivery.json');
            fs.writeFileSync(deliveryInput, JSON.stringify({ action: 'archive-only' }));
            await f.ok(['delivery', 'demo', '--file', deliveryInput]);
          }
          const archived = await f.invoke(['archive', 'demo']);
          assert.equal(
            archived.exitCode,
            0,
            JSON.stringify(archived.json.data?.issues ?? archived.json.stderr),
          );
          if (id === 'postdelta') {
            const main = fs.readFileSync(
              path.join(f.project, 'openspec/specs/native-proof/spec.md'),
              'utf8',
            );
            assert.match(main, /### Requirement: Preserve the original Run/);
            assert.doesNotMatch(main, /## ADDED Requirements/);
            f.proof(
              'ACTUAL_OPENSPEC_DELTA_MERGED',
              true,
              main.includes('### Requirement: Preserve the original Run'),
            );
          }
          const next = await f.ok(['next', 'demo']);
          assert.notEqual(next.json.data?.completion, 'completed');
          const directories = fs.readdirSync(path.join(f.project, 'openspec/changes/archive'));
          const moved = path.join(
            f.project,
            'openspec/changes/archive',
            directories.find((name) => name.endsWith('-demo')),
          );
          const before = JSON.parse(
            fs.readFileSync(path.join(moved, '.comet/run-state.json'), 'utf8'),
          );
          const originalArtifacts = JSON.parse(
            fs.readFileSync(path.join(moved, before.artifactsRef), 'utf8'),
          );
          const originalBridge = JSON.parse(originalArtifacts.managed_archive_input_bridge);
          f.proof(
            'PREVIEW_FORMAL_CAPTURED_TOOL_IDENTITY',
            envelopeDigest(f.openSpecBinding),
            originalBridge.bridge.toolBindingDigest,
          );

          f.proof('SPEC_ARCHIVE_SAME_RUN_PENDING', 'waiting', before.status);
          if (
            ![
              'postarchive',
              'postdelta',
              'postgit',
              'postcrash',
              'postdeliverypending',
              'postreceipttamper',
              'postreceiptforeign',
              'postauthorization',
            ].includes(id)
          ) {
            if (id === 'posttamper') {
              const file = path.join(moved, before.artifactsRef);
              const artifacts = JSON.parse(fs.readFileSync(file, 'utf8'));
              const mapping = JSON.parse(artifacts.managed_archive_input_bridge);
              mapping.bridge.after['docs/design.md'] = sha('self-approved map');
              artifacts.managed_archive_input_bridge = JSON.stringify(mapping);
              fs.writeFileSync(file, JSON.stringify(artifacts));
            } else if (id === 'postdesign')
              fs.appendFileSync(
                path.join(f.project, 'docs/design.md'),
                'Unauthorized design change after archive\n',
              );
            else if (id === 'postsource') {
              fs.mkdirSync(path.join(f.project, 'src'), { recursive: true });
              fs.writeFileSync(path.join(f.project, 'src/changed.py'), 'changed = True\n');
            } else if (id === 'postprotosource')
              fs.writeFileSync(
                path.join(f.project, '__proto__'),
                'Changed ordinary source input\n',
              );
            else if (id === 'postmethod') f.setMethod(sha('changed after archive'));
            else if (id === 'postenvironment') f.setEnvironment(sha('changed after archive'));
            else if (id === 'postqualification') f.qualification.status = 'revoked';
            const refused = await f.state(['dispatch-gate', 'demo', 'Kt']);
            assert.notEqual(refused.exitCode, 0);
            const current = JSON.parse(
              fs.readFileSync(path.join(moved, '.comet/run-state.json'), 'utf8'),
            );
            f.proof('POST_CHANGE_PRESERVES_ORIGINAL_RUN', before.runId, current.runId);
            f.proof('POST_CHANGE_NEVER_COMPLETES', 'waiting', current.status);
            assert.equal(
              JSON.parse(await f.get('gate_receipts')).some((entry) => entry.gate === 'Kt'),
              false,
            );
          } else {
            if (id === 'postdeliverypending') {
              const artifacts = JSON.parse(
                fs.readFileSync(path.join(moved, before.artifactsRef), 'utf8'),
              );
              const mapping = JSON.parse(artifacts.managed_archive_input_bridge);
              const file = path.join(f.project, mapping.bridge.controlOutput);
              const receipt = JSON.parse(fs.readFileSync(file, 'utf8'));
              receipt.archiveFiles[Object.keys(receipt.archiveFiles)[0]] = '0'.repeat(64);
              fs.writeFileSync(file, JSON.stringify(receipt));
            }
            if (id === 'postcrash') await crashAndRestartKt(f, moved, before);
            else await f.submit('Kt');
            const established = JSON.parse(
              fs.readFileSync(path.join(moved, '.comet/run-state.json'), 'utf8'),
            );
            const historyBefore = fs.readFileSync(
              path.join(moved, established.trajectoryRef),
              'utf8',
            );
            const completions = (text) =>
              text
                .trim()
                .split('\n')
                .filter(Boolean)
                .map(JSON.parse)
                .filter(
                  (event) =>
                    event.type === 'state_transitioned' && event.data.toStep === 'completed',
                );
            const completionBefore = completions(historyBefore);
            if (
              [
                'postdeliverypending',
                'postreceipttamper',
                'postreceiptforeign',
                'postauthorization',
              ].includes(id)
            ) {
              const artifacts = JSON.parse(
                fs.readFileSync(path.join(moved, before.artifactsRef), 'utf8'),
              );
              const mapping = JSON.parse(artifacts.managed_archive_input_bridge);
              const receipt = path.join(
                f.project,
                mapping.bridge.controlOutput ??
                  `.comet/classic-deliveries/${sha(mapping.bridge.deliveryIdentity)}.json`,
              );
              if (id === 'postdeliverypending') {
                /* Already failed BEFORE Kt: a current Kt must not waive delivery. */
              } else if (id === 'postauthorization')
                fs.rmSync(path.join(moved, '.comet/delivery.json'));
              else {
                const data = JSON.parse(fs.readFileSync(receipt, 'utf8'));
                if (id === 'postreceiptforeign') data.changeIdentity = 'another-unrelated-run';
                else {
                  const key = Object.keys(data.archiveFiles)[0];
                  data.archiveFiles[key] = '0'.repeat(64);
                }
                fs.writeFileSync(receipt, JSON.stringify(data));
              }
              const refused = await f.state(['next', 'demo']);
              const observed = JSON.parse(
                fs.readFileSync(path.join(moved, '.comet/run-state.json'), 'utf8'),
              );
              f.proof('DELIVERY_FAILURE_SAME_RUN', before.runId, observed.runId);
              if (id === 'postdeliverypending') {
                f.proof('FIRST_COMPLETION_DELIVERY_BLOCKS', 'waiting', observed.status);
                assert.equal(completionBefore.length, 0);
                assert.ok(
                  refused.exitCode !== 0 ||
                    refused.json.data?.delivery?.verification?.status !== 'complete',
                );
              } else {
                f.proof('LEGAL_COMPLETION_PRECEDES_FAULT', 'completed', established.status);
                assert.ok(completionBefore.length > 0);
                f.proof('LIFECYCLE_HISTORY_RETAINED', 'completed', observed.status);
                f.proof('TERMINAL_STEP_RETAINED', established.currentStep, observed.currentStep);
                const historyAfter = fs.readFileSync(
                  path.join(moved, observed.trajectoryRef),
                  'utf8',
                );
                assert.equal(historyAfter.startsWith(historyBefore), true);
                f.proof(
                  'ORIGINAL_COMPLETION_EVENTS_RETAINED',
                  completionBefore,
                  completions(historyAfter),
                );
                assert.notEqual(refused.exitCode, 0);
                f.proof(
                  'CURRENT_INTEGRITY_UNVERIFIED',
                  'UNVERIFIED',
                  refused.json.data.currentIntegrity.status,
                );
                assert.equal(
                  refused.json.data.issues.some((issue) => issue.code === 'RECOVERY_REQUIRED'),
                  true,
                );
                assert.equal(refused.json.agent.continuation, null);
                assert.notEqual(refused.json.data.nextAction?.kind, 'done');
                const events = historyAfter.trim().split('\n').filter(Boolean).map(JSON.parse);
                assert.equal(
                  events.some(
                    (event) =>
                      event.type === 'eval_completed' &&
                      event.data.evalId === 'classic-current-integrity' &&
                      event.data.passed === false,
                  ),
                  true,
                );
              }
            } else {
              const resumed = await f.ok(['next', 'demo']);
              const after = JSON.parse(
                fs.readFileSync(path.join(moved, '.comet/run-state.json'), 'utf8'),
              );
              f.proof('POST_ARCHIVE_ORIGINAL_RUN', before.runId, after.runId);
              if (id === 'postgit') {
                f.proof('GIT_ARCHIVE_KT_CURRENT', true, (await f.readback()).evaluation.allowed);
                f.proof('GIT_RUN_AWAITS_NATIVE_DELIVERY', 'waiting', after.status);
              } else {
                f.proof('POST_ARCHIVE_COMPLETED', 'completed', after.status);
                if (id === 'postarchive') {
                  const packet = path.join(
                    f.artifacts,
                    fs
                      .readdirSync(f.artifacts)
                      .find((name) => name.startsWith('gate-kt-') && name.endsWith('.json')),
                  );
                  for (const argv of [
                    ['dispatch-gate', 'demo', 'Kt'],
                    ['accept-gate', 'demo', 'Kt', '--file', packet],
                  ]) {
                    const denied = await f.state(argv);
                    assert.notEqual(denied.exitCode, 0);
                    assert.equal(
                      denied.json.data.issues.some((issue) => issue.code === 'RUN_COMPLETED'),
                      true,
                    );
                  }
                  fs.writeFileSync(
                    path.join(f.project, 'changed-after-completion.py'),
                    'changed = True\n',
                  );
                  const fault = await f.state(['next', 'demo']);
                  assert.notEqual(fault.exitCode, 0);
                  assert.equal(fault.json.data.currentIntegrity.status, 'UNVERIFIED');
                  const retained = JSON.parse(
                    fs.readFileSync(path.join(moved, '.comet/run-state.json'), 'utf8'),
                  );
                  f.proof('POST_COMPLETION_SOURCE_HISTORY_RETAINED', 'completed', retained.status);
                  assert.deepEqual(
                    completions(fs.readFileSync(path.join(moved, retained.trajectoryRef), 'utf8')),
                    completionBefore,
                  );
                  assert.equal(fault.json.agent.continuation, null);
                }
              }
            }
          }
        }
        if (id === 'archive') {
          fs.appendFileSync(path.join(f.project, 'docs/design.md'), 'Changed after Kp\n');
          const cwd = process.cwd();
          let archived;
          try {
            process.chdir(f.project);
            archived = await f.invoke(['archive', 'demo']);
          } finally {
            process.chdir(cwd);
          }
          assert.notEqual(archived.exitCode, 0);
          f.proof('STALE_KP_NO_SPEC_MOVE', true, fs.existsSync(f.change));
          f.proof('STALE_KP_MAIN_SPEC_UNCHANGED', beforeSpec, sha(fs.readFileSync(mainSpec)));
          f.proof('STALE_KP_NOT_ARCHIVED', 'false', await f.get('archived'));
          const changed = await f.readback();
          assert.equal(changed.evaluation.allowed, false);
          const design = path.join(f.project, 'docs/design.md');
          fs.writeFileSync(
            design,
            fs.readFileSync(design, 'utf8').replace('Changed after Kp\n', ''),
          );
          f.proof(
            'RESTORED_DESIGN_KP_STAYS_INVALID',
            false,
            (await f.readback()).evaluation.allowed,
          );
          const state = JSON.parse(
            fs.readFileSync(path.join(f.change, '.comet/run-state.json'), 'utf8'),
          );
          f.proof('STALE_KP_NO_NEW_PENDING', null, state.pending);
        }
      }
    } else throw new Error('unknown test scenario');
  } finally {
    audit = f.close();
  }
  console.log(
    JSON.stringify({
      case: id,
      audit,
      scope: 'component/native-runtime-mechanism',
      actualRolesMethodsOS: 'UNVERIFIED',
      acceptedBusinessScenarios: 0,
    }),
  );
}

if (restartMode >= 0) {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const f = await fixture({ resume: JSON.parse(input) });
  try {
    if (process.argv[restartMode + 1] === 'accept-kt') {
      const intent = await f.issue('Kt');
      const record = await f.observe(intent);
      process.send?.({ kind: 'original-source-observed', execution: intent.execution, record });
      const result = await f.accept(intent);
      assert.equal(result.exitCode, 0, JSON.stringify(result.json.data?.issues));
    } else {
      await f.ok(['next', 'demo']);
      const name = fs
        .readdirSync(path.join(f.project, 'openspec/changes/archive'))
        .find((value) => value.endsWith('-demo'));
      const state = JSON.parse(
        fs.readFileSync(
          path.join(f.project, 'openspec/changes/archive', name, '.comet/run-state.json'),
          'utf8',
        ),
      );
      console.log(
        JSON.stringify({
          scope: 'component/native-process-recovery',
          runId: state.runId,
          status: state.status,
          pid: process.pid,
        }),
      );
    }
  } finally {
    f.close();
    process.disconnect?.();
  }
} else if (scenario >= 0) {
  await runScenario(process.argv[scenario + 1]);
} else {
  test('fixed six-patch Native distribution is actually present and integrity-verified', async () => {
    assert.equal(process.versions.node, lock.toolchain.node);
    const result = await verifyCometDistribution({
      projectRoot: repository,
      lock,
    });
    assert.equal(result.status, 'PASS');
  });
  for (const [id, name] of Object.entries(scenarios))
    test(name, { timeout: 120000 }, () => {
      const env = { ...process.env };
      delete env.NODE_TEST_CONTEXT;
      const child = spawnSync(
        process.execPath,
        [fileURLToPath(import.meta.url), '--mechanism-case', id],
        { cwd: repository, env, encoding: 'utf8', timeout: 110000 },
      );
      assert.equal(child.status, 0, child.stdout + child.stderr);
      const proof = JSON.parse(child.stdout.trim().split('\n').at(-1));
      assert.equal(proof.scope, 'component/native-runtime-mechanism');
      assert.equal(proof.acceptedBusinessScenarios, 0);
    });
}

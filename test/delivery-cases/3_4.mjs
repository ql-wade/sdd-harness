// P3_4 delivery case: the Spec Adapter is the single closeout writer over the
// real openspec CLI in a real temporary OpenSpec project.
//
// Coverage:
//   V_A11 (3.4.a/3.4.b) — dispatch-to-archive interruption story: a rehearsal
//     in a cloned project previews the target summary without touching the
//     real change; a closeout interrupted before the CLI archive recovers by
//     reclaiming the stale writer lock and re-running; a closeout interrupted
//     AFTER the CLI archive (which already synced main specs and moved the
//     change) recovers from the on-disk authoritative state, reads the main
//     specs back and completes WITHOUT repeating the sync — main specs stay
//     byte-identical and exactly one archive directory exists.
//   V_B08 (3.4.b) — concurrent drift blocking: after the acceptance passed,
//     another Change's edit to the main specs between rehearsal and closeout
//     is caught by summary comparison (SPEC_DRIFT), nothing is archived, and
//     the flow proceeds only after a fresh rehearsal, preserving the old
//     scenario ("Invalid login") that the truncated delta would have dropped
//     (historical 1.3.1 archived such a delta; pinned 1.11 refuses — the case proves
//     that loss and the adapter guard against it).
//
// All fixtures are generated under os.tmpdir(); no live configuration or
// change-control file is written by this suite. The host openspec CLI must be
// on PATH; when it is absent the case fails UNVERIFIED (nonzero), never skips
// to pass.
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {createLaunchAuthority, admitEvidence, envelopeDigest} from '../../lib/delivery/evidence.js';
import {evaluate} from '../../lib/delivery/gate.js';
import {taskDefinitionDigest} from '../../lib/delivery/baseline.js';
import {parseTapSummary} from '../../lib/delivery/test-contract.js';
import {verifyCometDistribution} from '../../tools/comet/build.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const adapterPath = path.join(projectRoot, 'lib/adapters/spec.js');
const adapter = await import(adapterPath);

const OPENSPEC_CLI = path.join(projectRoot, '.sdd/tools/openspec-1.11.0/node_modules/.bin/openspec');
const CLI_TIMEOUT_MS = 120_000;
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

const hostVersion = spawnSync(OPENSPEC_CLI, ['--version'], { encoding: 'utf8', timeout: 30_000 });
const hostCliAvailable = hostVersion.status === 0 && Boolean(hostVersion.stdout);
const cliEnv = () => ({ ...process.env, CI: 'true', OPENSPEC_TELEMETRY: '0', DO_NOT_TRACK: '1' });

const MAIN_SPEC = [
  '# cap-a Specification',
  '',
  '## Purpose',
  'Purpose of cap-a is the delivery case fixture.',
  '',
  '## Requirements',
  '',
  '### Requirement: Existing auth flow',
  'The system SHALL authenticate users.',
  '',
  '#### Scenario: Valid login',
  '- **WHEN** valid credentials',
  '- **THEN** access granted',
  '',
  '#### Scenario: Invalid login',
  '- **WHEN** invalid credentials',
  '- **THEN** access denied',
  '',
].join('\n');

// Delta that keeps both existing scenarios plus an added requirement.
const COMPLETE_DELTA = [
  '## MODIFIED Requirements',
  '',
  '### Requirement: Existing auth flow',
  'The system SHALL authenticate users with rate limiting.',
  '',
  '#### Scenario: Valid login',
  '- **WHEN** valid credentials',
  '- **THEN** access granted',
  '',
  '#### Scenario: Invalid login',
  '- **WHEN** invalid credentials',
  '- **THEN** access denied',
  '',
  '## ADDED Requirements',
  '',
  '### Requirement: Audit trail',
  'The system SHALL log auth events.',
  '',
  '#### Scenario: Login logged',
  '- **WHEN** any login attempt',
  '- **THEN** audit record written',
  '',
].join('\n');

// Delta that drops the "Invalid login" scenario — what a careless author would
// ship and what the host CLI would archive without complaint.
const LOSSY_DELTA = COMPLETE_DELTA.split('#### Scenario: Invalid login')[0];

function writeProject({ delta }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'delivery-case-3-4-'));
  for (const rel of [
    'openspec/config.yaml',
    'openspec/project.md',
    'openspec/specs/cap-a/spec.md',
    'openspec/changes/demo/proposal.md',
    'openspec/changes/demo/tasks.md',
    'openspec/changes/demo/specs/cap-a/spec.md',
  ]) {
    fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
  }
  fs.writeFileSync(path.join(root, 'openspec/config.yaml'), 'schema: spec-driven\n');
  fs.writeFileSync(path.join(root, 'openspec/project.md'), '# Project\nDelivery case 3_4 fixture project.\n');
  fs.writeFileSync(path.join(root, 'openspec/specs/cap-a/spec.md'), MAIN_SPEC);
  fs.writeFileSync(path.join(root, 'openspec/changes/demo/proposal.md'), [
    '## Why', 'Delivery case 3_4 needs a real OpenSpec change for the closeout rehearsal.', '',
    '## What Changes', 'Modify the auth flow with complete scenarios and add the audit trail.', '',
    '## Impact', 'cap-a.', '',
  ].join('\n'));
  fs.writeFileSync(path.join(root, 'openspec/changes/demo/tasks.md'), '## 1. Implementation\n- [ ] 1.1 Do the thing\n');
  fs.writeFileSync(path.join(root, 'openspec/changes/demo/specs/cap-a/spec.md'), delta);
  return root;
}

const KNOWLEDGE = { id: 'kp-3-4', digest: sha256('delivery-case-3-4-kp') };
const EXECUTION = 'delivery-case-3-4-execution';
const archiveDirsOf = (root) => {
  const archive = path.join(root, 'openspec/changes/archive');
  return fs.existsSync(archive) ? fs.readdirSync(archive).filter((name) => name.endsWith('-demo')).sort() : [];
};
const readMainSpec = (root) => fs.readFileSync(path.join(root, 'openspec/specs/cap-a/spec.md'), 'utf8');
const deadPid = () => {
  const child = spawnSync(process.execPath, ['-e', 'process.exit(0)'], { timeout: 30_000 });
  assert.equal(child.status, 0);
  return child.pid;
};


// Fixture-only source ports reused verbatim from test/delivery-cases/2_4.mjs
// at ddb7849. All Gate/crypto/Run behavior is the actual original library/SDK.
// No production registration, role, method, ACL or remote knowledge is proved.
const repository = projectRoot;
const lock = JSON.parse(fs.readFileSync(path.join(repository,'integrations/comet/upstream.lock.json')));
const sha = sha256;
const fingerprint = sha(JSON.stringify({archive:lock.source.sha256,
  patches:lock.patches.map(({path,sha256})=>({path,sha256})),toolchain:lock.toolchain}));
const work = path.join(repository,'.sdd/vendor/comet',lock.source.commit,'builds',fingerprint,'work');
const nativeUrl = pathToFileURL(path.join(work,'assets/skills/comet/scripts/comet-runtime.mjs')).href;
const specCase = process.argv.indexOf('--spec-mechanism');
const specRestart = process.argv.indexOf('--spec-restart');

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
  const scratch = resume?.scratch ?? fs.mkdtempSync(path.join(os.tmpdir(), 'spec-3-4-'));
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
  const host = {
    authority,
    policy: () => policy,
    context,
    definitionDigest: taskDefinitionDigest,
    authorizeWrite: () => ({ allowed: false }),
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
    const directory = path.join(repository, '.local/P3_4-convergence/case-audit', crypto.randomUUID());
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

if (specCase < 0 && specRestart < 0) {
test('V_A11: archive interruption recovery continues from authoritative state without repeating side effects', { skip: hostCliAvailable ? false : `UNVERIFIED: host CLI ${OPENSPEC_CLI} unavailable` }, (t) => {
  const root = writeProject({ delta: COMPLETE_DELTA });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  // Rehearsal: real CLI on a full clone, target summary previewed, real
  // project provably untouched.
  const rehearsal = adapter.rehearseArchive({ projectRoot: root, change: 'demo', openspecCli: OPENSPEC_CLI });
  assert.equal(rehearsal.ok, true, `rehearsal failed: ${rehearsal.error ?? ''}`);
  assert.ok(fs.existsSync(path.join(root, 'openspec/changes/demo/proposal.md')));
  assert.equal(readMainSpec(root), MAIN_SPEC);
  assert.deepEqual(archiveDirsOf(root), []);

  // Interruption before the CLI archive: stale lock with a dead holder.
  assert.equal(adapter.acquireArchiveLock({ projectRoot: root, change: 'demo', writerId: 'interrupted' }).ok, true);
  fs.writeFileSync(path.join(root, 'openspec/changes/demo/.spec-closeout.lock'), JSON.stringify({ writerId: 'interrupted', pid: deadPid(), change: 'demo', acquiredAt: new Date().toISOString() }));
  const pre = adapter.recoverCloseout({ projectRoot: root, change: 'demo', openspecCli: OPENSPEC_CLI, knowledgeCloseout: KNOWLEDGE, execution: EXECUTION });
  assert.equal(pre.resumed, 'pre-archive');
  assert.equal(pre.lockReclaimed, true);

  // The closeout completes after recovery: exactly one archive, readback ok.
  const result = adapter.closeoutSpecs({ projectRoot: root, change: 'demo', openspecCli: OPENSPEC_CLI, rehearsal, knowledgeCloseout: KNOWLEDGE, execution: EXECUTION });
  assert.equal(result.ok, true, `closeout after recovery failed: ${result.error ?? ''}`);
  assert.equal(archiveDirsOf(root).length, 1);
  const mainAfter = readMainSpec(root);
  assert.match(mainAfter, /#### Scenario: Invalid login/);
  assert.match(mainAfter, /### Requirement: Audit trail/);
  const readback = adapter.readBackMainSpecs({ projectRoot: root, summary: rehearsal.summary, expectedMainSpecs: rehearsal.expectedMainSpecs });
  assert.equal(readback.ok, true, JSON.stringify(readback.mismatches));
});

test('V_A11: post-archive interruption recovery does not repeat the sync (archive already contains it)', { skip: hostCliAvailable ? false : `UNVERIFIED: host CLI ${OPENSPEC_CLI} unavailable` }, (t) => {
  const root = writeProject({ delta: COMPLETE_DELTA });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  // The interrupted writer got as far as the CLI archive completing.
  assert.equal(adapter.acquireArchiveLock({ projectRoot: root, change: 'demo', writerId: 'interrupted' }).ok, true);
  fs.writeFileSync(path.join(root, 'openspec/changes/demo/.spec-closeout-state.json'), JSON.stringify({ change: 'demo', execution: 'interrupted', stage: 'archiving', archived: false, startedAt: new Date().toISOString() }));
  fs.writeFileSync(path.join(root, 'openspec/changes/demo/.spec-closeout.lock'), JSON.stringify({ writerId: 'interrupted', pid: deadPid(), change: 'demo', acquiredAt: new Date().toISOString() }));
  const cli = spawnSync(OPENSPEC_CLI, ['archive', 'demo', '-y'], { cwd: root, encoding: 'utf8', timeout: CLI_TIMEOUT_MS, env: cliEnv() });
  assert.equal(cli.status, 0, `fixture CLI archive failed: ${cli.stderr}`);
  const mainAfterCli = readMainSpec(root);

  // Recovery reads the external state instead of repeating the archive.
  const recovery = adapter.recoverCloseout({ projectRoot: root, change: 'demo', openspecCli: OPENSPEC_CLI, knowledgeCloseout: KNOWLEDGE, execution: EXECUTION });
  assert.equal(recovery.resumed, 'post-archive');
  assert.equal(recovery.reArchived, false);
  assert.equal(readMainSpec(root), mainAfterCli, 'recovery must not rewrite the synced main specs');
  assert.equal(archiveDirsOf(root).length, 1, 'recovery must not produce a second archive');
  assert.equal(recovery.readback.ok, true, JSON.stringify(recovery.readback?.mismatches));

  const state = JSON.parse(fs.readFileSync(path.join(root, 'openspec/changes/archive', archiveDirsOf(root)[0], '.spec-closeout-state.json'), 'utf8'));
  assert.equal(state.stage, 'complete');
});

test('V_B08: main-spec drift after acceptance blocks closeout until a fresh rehearsal, and old scenarios survive', { skip: hostCliAvailable ? false : `UNVERIFIED: host CLI ${OPENSPEC_CLI} unavailable` }, (t) => {
  // Pinned 1.11 independently blocks the loss; preserve the historical failing
  // oracle in evidence, not as a required silent-success behavior.
  const lossyRoot = writeProject({ delta: LOSSY_DELTA });
  t.after(() => fs.rmSync(lossyRoot, { recursive: true, force: true }));
  const lossyCli = spawnSync(OPENSPEC_CLI, ['archive', 'demo', '-y'], { cwd: lossyRoot, encoding: 'utf8', timeout: CLI_TIMEOUT_MS, env: cliEnv() });
  assert.equal(lossyCli.status, 1, 'pinned 1.11 refuses a missing existing scenario');
  assert.equal(readMainSpec(lossyRoot), MAIN_SPEC);
  assert.equal(fs.existsSync(path.join(lossyRoot, 'openspec/changes/demo')), true);
  assert.deepEqual(archiveDirsOf(lossyRoot), []);

  // The guarded flow: complete delta, rehearsed, then another Change edits the
  // main specs before closeout.
  const root = writeProject({ delta: COMPLETE_DELTA });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const rehearsal = adapter.rehearseArchive({ projectRoot: root, change: 'demo', openspecCli: OPENSPEC_CLI });
  assert.equal(rehearsal.ok, true);
  const concurrentEdit = readMainSpec(root).replace('The system SHALL authenticate users.', 'The system SHALL authenticate users via SSO.');
  fs.writeFileSync(path.join(root, 'openspec/specs/cap-a/spec.md'), concurrentEdit);

  // Summary conflict blocks: nothing archived, nothing synced.
  assert.throws(
    () => adapter.closeoutSpecs({ projectRoot: root, change: 'demo', openspecCli: OPENSPEC_CLI, rehearsal, knowledgeCloseout: KNOWLEDGE, execution: EXECUTION }),
    (error) => error.code === 'SPEC_DRIFT',
  );
  assert.deepEqual(archiveDirsOf(root), []);
  assert.equal(readMainSpec(root), concurrentEdit, 'the blocked closeout must not touch the drifted main specs');

  // B08 THEN: after the conflict is resolved (edit reverted), re-rehearse and
  // close out; the old scenario is preserved in the main specs.
  fs.writeFileSync(path.join(root, 'openspec/specs/cap-a/spec.md'), MAIN_SPEC);
  const fresh = adapter.rehearseArchive({ projectRoot: root, change: 'demo', openspecCli: OPENSPEC_CLI });
  assert.equal(fresh.ok, true);
  const result = adapter.closeoutSpecs({ projectRoot: root, change: 'demo', openspecCli: OPENSPEC_CLI, rehearsal: fresh, knowledgeCloseout: KNOWLEDGE, execution: EXECUTION });
  assert.equal(result.ok, true, `closeout after re-rehearsal failed: ${result.error ?? ''}`);
  const main = readMainSpec(root);
  assert.match(main, /#### Scenario: Valid login/);
  assert.match(main, /#### Scenario: Invalid login/, 'the old scenario must survive the closeout');
  assert.equal(archiveDirsOf(root).length, 1);
});

test('V_B08: native 1.11 and adapter refuse the same lossy MODIFIED delta', { skip: hostCliAvailable ? false : `UNVERIFIED: host CLI ${OPENSPEC_CLI} unavailable` }, (t) => {
  const root = writeProject({ delta: LOSSY_DELTA });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const nativeValidate = spawnSync(OPENSPEC_CLI, ['validate', 'demo', '--type', 'change', '--strict', '--json'], {
    cwd: root, encoding: 'utf8', timeout: CLI_TIMEOUT_MS, env: cliEnv(),
  });
  assert.equal(nativeValidate.status, 1);
  assert.equal(JSON.parse(nativeValidate.stdout).items[0].valid, false);
  assert.match(nativeValidate.stdout, /Invalid login/);
  assert.equal(readMainSpec(root), MAIN_SPEC);
  assert.equal(fs.existsSync(path.join(root, 'openspec/changes/demo')), true);
  const preservation = adapter.verifyScenarioPreservation({ projectRoot: root, change: 'demo' });
  assert.equal(preservation.ok, false);
  const dropped = preservation.violations.find((violation) => violation.type === 'SCENARIO_DROPPED');
  assert.ok(dropped, `expected SCENARIO_DROPPED, got ${JSON.stringify(preservation.violations)}`);
  assert.deepEqual(dropped.missing, ['Invalid login']);
});

}

async function prepareArchive(f) {
  // Complete real OpenSpec delta with two existing scenarios.
  fs.mkdirSync(path.join(f.project,'openspec/specs/cap-a'),{recursive:true});
  fs.writeFileSync(path.join(f.project,'openspec/specs/cap-a/spec.md'), MAIN_SPEC);
  fs.mkdirSync(path.join(f.change,'specs/cap-a'),{recursive:true});
  fs.writeFileSync(path.join(f.change,'specs/cap-a/spec.md'), COMPLETE_DELTA);
  await f.prepareP();
  fs.writeFileSync(path.join(f.change,'tasks.md'),fs.readFileSync(path.join(f.change,'tasks.md'),'utf8').replace('[ ]','[x]'));
  assert.equal((await f.invoke(['check','run','demo','build','--',...f.commandArgv])).exitCode,0);
  await f.ok(['transition','demo','build-complete']);
  fs.mkdirSync(path.join(f.project,'.whitebox'),{recursive:true});
  fs.writeFileSync(path.join(f.project,'.whitebox/verification.md'),'# Component evidence\nActual Native mechanism only; production roles and methods remain UNVERIFIED.\n');
  await f.ok(['set','demo','verification_report','.whitebox/verification.md']);
  assert.equal((await f.invoke(['check','run','demo','verify','--',...f.commandArgv])).exitCode,0);
  await f.submit('V');
  await f.ok(['transition','demo','verify-pass']);
  await f.ok(['transition','demo','archive-confirm']);
}

async function crashAfterArchive(f) {
  const env={...process.env}; delete env.NODE_TEST_CONTEXT;
  const child=spawn(process.execPath,[fileURLToPath(import.meta.url),'--spec-restart','archive'],
    {cwd:repository,env,stdio:['pipe','pipe','pipe','ipc']});
  const output=[]; child.stdout.on('data',chunk=>output.push(chunk)); child.stderr.on('data',chunk=>output.push(chunk));
  const ended=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));});
  const committed=new Promise((resolve,reject)=>{
    child.once('message',resolve); child.once('exit',()=>reject(new Error('archive child exited before its commit notification')));
  });
  child.stdin.end(JSON.stringify(f.restartData())); // component fixture key only via private stdin, never a log/file
  try {
    const record=await committed;
    assert.equal(record.kind,'archive-committed',Buffer.concat(output).toString());
    assert.equal(record.ok,true);
    assert.equal(child.kill('SIGKILL'),true);
    const terminal=await ended;
    assert.equal(terminal.signal,'SIGKILL');
    return {pid:child.pid,signal:terminal.signal,runId:record.runId};
  } finally {
    if(child.exitCode===null && child.signalCode===null) {child.kill('SIGKILL'); await ended;}
  }
}

async function nativeSpecScenario(id) {
  const f = await fixture();
  let audit;
  try {
    await prepareArchive(f);
    const spec = adapter.createManagedSpecAdapter({runtime:f.native,projectRoot:f.project});
    const initial = spec.inspect({change:'demo'});
    const main = path.join(f.project,'openspec/specs/cap-a/spec.md');
    const before = fs.readFileSync(main,'utf8');
    // Real Native archive-confirm enters work; it does not waive current Kp.
    const denied = await spec.closeout({change:'demo'});
    f.proof('MISSING_KP_NATIVE_REFUSAL',false,denied.ok);
    assert.match(denied.native.stdout,/Kp|gate|prerequisite/i);
    f.proof('MISSING_KP_ACTIVE_UNMOVED',true,fs.existsSync(f.change));
    f.proof('MISSING_KP_MAIN_UNCHANGED',before,fs.readFileSync(main,'utf8'));
    f.proof('ORIGINAL_RUN_AFTER_REFUSAL',initial.runId,spec.inspect({change:'demo'}).runId);
    await f.submit('Kp');
    if(id==='archive') {
      const script=`import {createManagedSpecAdapter} from ${JSON.stringify(pathToFileURL(adapterPath).href)};
        import * as runtime from ${JSON.stringify(nativeUrl)};
        const a=createManagedSpecAdapter({runtime,projectRoot:${JSON.stringify(f.project)}});
        console.log(JSON.stringify(await a.closeout({change:'demo'})));`;
      const env={...process.env}; delete env.NODE_TEST_CONTEXT;
      const absent=spawnSync(process.execPath,['--input-type=module','-e',script],{cwd:f.project,env,encoding:'utf8',timeout:30000});
      assert.equal(absent.status,0,absent.stderr);
      const rejected=JSON.parse(absent.stdout.trim());
      assert.equal(rejected.ok,false); assert.match(rejected.native.stdout,/UNVERIFIED/);
      f.proof('SEPARATE_PROCESS_MISSING_HOST_NO_ARCHIVE',true,fs.existsSync(f.change));
      f.proof('SEPARATE_PROCESS_MISSING_HOST_MAIN_UNCHANGED',before,fs.readFileSync(main,'utf8'));
    }
    if(id==='premove') {
      const collision=path.join(f.project,'openspec/changes/archive',new Date().toISOString().slice(0,10)+'-demo');
      // Empty target isolates a filesystem availability failure; adding a
      // product file here would correctly invalidate candidate-bound V/Kp.
      fs.mkdirSync(collision,{recursive:true});
      try {
        const native=await f.invoke(['archive','demo']);
        assert.notEqual(native.exitCode,0); assert.match(native.stdout,/gate V:.*stale.*gate Kp:.*stale/i);
        await assert.rejects(spec.closeout({change:'demo'}),e=>e.code==='AMBIGUOUS_ARCHIVE');
        f.proof('BEFORE_MOVE_FAILURE_ACTIVE_UNMOVED',true,fs.existsSync(f.change));
        f.proof('BEFORE_MOVE_FAILURE_MAIN_UNCHANGED',before,fs.readFileSync(main,'utf8'));
      } finally {fs.rmSync(collision,{recursive:true,force:true});}
      const recovered=await spec.recover({change:'demo'});
      f.proof('BEFORE_MOVE_RECOVERY_ORIGINAL_RUN',initial.runId,recovered.runId);
      f.proof('BEFORE_MOVE_RECOVERY_NOT_COMPLETED','running',recovered.status);
      f.proof('BEFORE_MOVE_RECOVERY_STILL_ACTIVE',true,fs.existsSync(f.change));
      f.proof('BEFORE_MOVE_OLD_EVIDENCE_NOT_REVIVED',false,(await spec.closeout({change:'demo'})).ok);
      // A directory name is candidate input too. Use the existing official
      // six-patch archive-reopen transition; never rewrite phase or old votes.
      await f.ok(['transition','demo','archive-reopen']);
      f.proof('CONTROLLED_REOPEN_VERIFY','verify',await f.get('phase'));
      f.proof('CONTROLLED_REOPEN_SAME_RUN',initial.runId,spec.inspect({change:'demo'}).runId);
      assert.equal((await f.invoke(['check','run','demo','verify','--',...f.commandArgv])).exitCode,0);
      await f.submit('V');
      await f.ok(['transition','demo','verify-pass']);
      await f.ok(['transition','demo','archive-confirm']);
      await f.submit('Kp');

    }
    if (id === 'drift') {
      const inspected = spec.inspect({change:'demo'});
      const changed = before.replace('authenticate users.','authenticate users via SSO.');
      fs.writeFileSync(main,changed);
      await assert.rejects(spec.closeout({change:'demo',expectedSummaryDigest:inspected.digest}),e=>e.code==='SPEC_DRIFT');
      const stale = await spec.closeout({change:'demo'});
      f.proof('CURRENT_DRIFT_NATIVE_REFUSAL',false,stale.ok);
      f.proof('CONCURRENT_MAIN_NOT_OVERWRITTEN',changed,fs.readFileSync(main,'utf8'));
      fs.writeFileSync(main,before);
      f.proof('RESTORED_BYTES_OLD_KP_NOT_REVIVED',false,(await spec.closeout({change:'demo'})).ok);
      f.proof('DRIFT_ACTIVE_UNMOVED',true,fs.existsSync(f.change));
    } else {
      const input = path.join(f.change,'.comet/native-document-delivery.json');
      fs.writeFileSync(input,JSON.stringify({action:'archive-only'}));
      await f.ok(['delivery','demo','--file',input]);
      const inspect = spec.inspect({change:'demo'});
      let crash=null;
      if (id==='restart') crash=await crashAfterArchive(f);
      const result = id==='restart' ? await spec.recover({change:'demo'})
        : await spec.closeout({change:'demo',expectedSummaryDigest:inspect.digest});
      if(crash) {f.proof('ACTUAL_ARCHIVE_WRITER_SIGKILL','SIGKILL',crash.signal,{pid:crash.pid});
        f.proof('RESTART_RETAINS_COMMITTED_RUN',initial.runId,crash.runId);}
      assert.equal(result.ok,true,JSON.stringify(result.native));
      f.proof('ARCHIVED_SAME_RUN',initial.runId,result.runId);
      f.proof('ARCHIVED_KT_PENDING','waiting',result.status);
      f.proof('ARCHIVED_MAIN_READBACK',true,result.readback.ok);
      f.proof('NO_ADAPTER_OVERALL_ACCEPTANCE',false,result.overallCompletionEligible);
      assert.match(fs.readFileSync(main,'utf8'),/#### Scenario: Valid login/);
      assert.match(fs.readFileSync(main,'utf8'),/#### Scenario: Invalid login/);
      assert.match(fs.readFileSync(main,'utf8'),/### Requirement: Audit trail/);
      const archivedBytes=fs.readFileSync(main);
      const pending=await spec.recover({change:'demo'});
      f.proof('KT_FAILURE_RECOVERS_SAME_RUN',initial.runId,pending.runId);
      f.proof('KT_PENDING_NOT_COMPLETED','waiting',pending.status);
      const archivedReopen=await f.state(['transition','demo','archive-reopen']);
      assert.notEqual(archivedReopen.exitCode,0); assert.match(archivedReopen.stdout,/already archived|cannot transition/i);
      f.proof('ARCHIVED_REOPEN_RETAINS_RUN',initial.runId,spec.inspect({change:'demo'}).runId);
      f.proof('RECOVERY_DOES_NOT_RESYNC',sha(archivedBytes),sha(fs.readFileSync(main)));
      const dirs=fs.readdirSync(path.join(f.project,'openspec/changes/archive'));
      const moved=path.join(f.project,'openspec/changes/archive',dirs.find(n=>n.endsWith('-demo')));
      f.proof('NO_LEGACY_ADAPTER_JOURNAL',false,fs.existsSync(path.join(moved,'.spec-closeout-state.json')));
      f.proof('NO_LEGACY_ADAPTER_LOCK',false,fs.existsSync(path.join(moved,'.spec-closeout.lock')));
      await f.submit('Kt');
      const complete=await spec.recover({change:'demo'});
      f.proof('KT_COMPLETED_SAME_RUN',initial.runId,complete.runId);
      f.proof('ORIGINAL_RUNTIME_COMPLETES','completed',complete.status);
      const terminalReopen=await f.state(['transition','demo','archive-reopen']);
      assert.notEqual(terminalReopen.exitCode,0);
      f.proof('TERMINAL_REOPEN_HISTORY_IMMUTABLE','completed',JSON.parse(fs.readFileSync(path.join(moved,'.comet/run-state.json'),'utf8')).status);
      f.proof('ONE_REAL_ARCHIVE',1,fs.readdirSync(path.join(f.project,'openspec/changes/archive')).filter(n=>n.endsWith('-demo')).length);
      f.proof('KT_RECOVERY_MAIN_STABLE',sha(archivedBytes),sha(fs.readFileSync(main)));
    }
  } finally { audit=f.close(); }
  console.log(JSON.stringify({case:id,fingerprint,scope:'component/original-comet-spec-operation',acceptedBusinessScenarios:0,audit}));
}

if(specRestart>=0) {
  let input=''; for await(const part of process.stdin) input+=part;
  const f=await fixture({resume:JSON.parse(input)});
  const spec=adapter.createManagedSpecAdapter({runtime:f.native,projectRoot:f.project});
  const result=await spec.closeout({change:'demo'});
  process.send?.({kind:'archive-committed',ok:result.ok,runId:result.runId});
  // Simulate the controller losing the response after the real commit. The
  // parent terminates this exact temporary writer; no SDK failpoint is added.
  setInterval(()=>{},1000);
} else if (specCase >= 0) {
  await nativeSpecScenario(process.argv[specCase+1]);
} else {
  test('P3_4 exact official SDK distribution is verified',async()=>{
    assert.equal(process.versions.node,lock.toolchain.node);
    assert.equal((await verifyCometDistribution({projectRoot:repository,lock})).status,'PASS');
    assert.equal(hostVersion.stdout.trim(),'1.11.0');
  });
  for (const [id,name] of [['archive','A11/N07: actual Adapter archive preserves original pending Run and resumes Kt'],['drift','B08/N07: main-spec drift and restored bytes cannot revive current archive permission'],['restart','A11: actual archive writer crash resumes the original committed Run without repeat sync'],['premove','A11: before-move archive target conflict recovers on the same original Run']]) {
    test(name,{timeout:120000},()=>{
      const env={...process.env}; delete env.NODE_TEST_CONTEXT;
      const result=spawnSync(process.execPath,[fileURLToPath(import.meta.url),'--spec-mechanism',id],{cwd:repository,env,encoding:'utf8',timeout:110000});
      assert.equal(result.status,0,result.stdout+result.stderr);
      const proof=JSON.parse(result.stdout.trim().split('\n').at(-1));
      assert.equal(proof.fingerprint,fingerprint);
      assert.equal(proof.scope,'component/original-comet-spec-operation');
      assert.equal(proof.acceptedBusinessScenarios,0);
    });
  }
}
